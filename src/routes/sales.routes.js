const router = require('express').Router();
const { readDb, writeDb, nextId, normalizeProduct } = require('../db');
const { requireAuth, requireAccess } = require('../middleware/auth');

function ensureSalesCollections(db) {
  db.sales = Array.isArray(db.sales) ? db.sales : [];
  db.salesCart = Array.isArray(db.salesCart) ? db.salesCart : [];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function invoiceNo(list) {
  const next = (list?.length || 0) + 1;
  return `SAL-${String(next).padStart(4, '0')}`;
}

function findProduct(db, productId) {
  return normalizeProduct((db.products || []).find((p) => String(p.id) === String(productId)));
}

function buildCartItem(product, quantityKg, productQuantity = 0) {
  return {
    productId: String(product.id),
    name: product.name,
    brandName: product.brandName,
    weight: product.weight || `${product.weightKg} KG`,
    quantityKg: round2(quantityKg),
    productQuantity: Math.max(0, Math.round(toNumber(productQuantity))),
    addedAt: new Date().toISOString(),
  };
}

function cartTotals(items) {
  const totalQuantityKg = round2(items.reduce((sum, item) => sum + toNumber(item.quantityKg), 0));
  const totalProductQuantity = items.reduce((sum, item) => sum + Math.max(0, Math.round(toNumber(item.productQuantity))), 0);
  return {
    items,
    itemsCount: items.length,
    totalQuantityKg,
    totalProductQuantity,
  };
}

function filterSalesByDate(sales, startDate, endDate) {
  const start = startDate ? `${String(startDate).slice(0, 10)}T00:00:00.000Z` : null;
  const end = endDate ? `${String(endDate).slice(0, 10)}T23:59:59.999Z` : null;
  return (sales || []).filter((sale) => {
    const createdAt = String(sale.createdAt || '');
    if (!createdAt) return false;
    if (start && createdAt < start) return false;
    if (end && createdAt > end) return false;
    return true;
  });
}

function dailySeries(sales, startDate, endDate) {
  const map = new Map();

  let start;
  let end;
  if (startDate && endDate) {
    start = new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
    end = new Date(`${String(endDate).slice(0, 10)}T00:00:00.000Z`);
  } else {
    end = new Date();
    start = new Date();
    start.setDate(end.getDate() - 6);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    map.set(key, { date: key, totalQuantityKg: 0, orders: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const sale of sales) {
    const key = String(sale.createdAt || '').slice(0, 10);
    if (!map.has(key)) continue;
    const current = map.get(key);
    current.totalQuantityKg = round2(current.totalQuantityKg + toNumber(sale.totalQuantityKg));
    current.orders += 1;
  }

  return Array.from(map.values());
}

function topProducts(sales, limit = 5) {
  const acc = new Map();
  for (const sale of sales) {
    for (const item of sale.items || []) {
      const key = String(item.productId);
      const existing = acc.get(key) || {
        productId: key,
        name: item.name,
        brandName: item.brandName,
        totalQuantityKg: 0,
        totalUnits: 0,
      };
      existing.totalQuantityKg = round2(existing.totalQuantityKg + toNumber(item.quantityKg));
      existing.totalUnits += Math.max(0, Math.round(toNumber(item.productQuantity)));
      acc.set(key, existing);
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.totalQuantityKg - a.totalQuantityKg).slice(0, limit);
}

function validateRequestedStock(product, requestedUnits, currentUnits = 0) {
  const stock = Math.max(0, Math.round(toNumber(product.quantity)));
  if (requestedUnits <= 0) return 'productQuantity must be greater than 0';
  if (requestedUnits + currentUnits > stock) {
    return `Only ${Math.max(stock - currentUnits, 0)} item(s) available in stock`;
  }
  return null;
}

function decreaseProductStock(db, items) {
  for (const item of items || []) {
    const product = (db.products || []).find((p) => String(p.id) === String(item.productId));
    if (!product) continue;
    const soldUnits = Math.max(0, Math.round(toNumber(item.productQuantity)));
    product.quantity = Math.max(0, Math.round(toNumber(product.quantity)) - soldUnits);
    product.updatedAt = new Date().toISOString();
  }
}

router.get('/cart', requireAuth, requireAccess('sales'), (_req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  return res.json({ isSuccess: true, message: 'OK', result: cartTotals(db.salesCart) });
});

router.post('/cart/items', requireAuth, requireAccess('sales'), (req, res) => {
  const { productId, quantityKg, productQuantity } = req.body || {};
  const db = readDb();
  ensureSalesCollections(db);

  const product = findProduct(db, productId);
  if (!product) return res.status(404).json({ isSuccess: false, message: 'Product not found' });

  const units = Math.max(0, Math.round(toNumber(productQuantity)));
  const qtyKg = round2(toNumber(quantityKg) || (units * toNumber(product.weightKg)));
  if (qtyKg <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });

  const existing = db.salesCart.find((item) => String(item.productId) === String(productId));
  const existingUnits = existing ? Math.max(0, Math.round(toNumber(existing.productQuantity))) : 0;
  const stockError = validateRequestedStock(product, units, existingUnits);
  if (stockError) return res.status(400).json({ isSuccess: false, message: stockError });

  if (existing) {
    existing.quantityKg = round2(toNumber(existing.quantityKg) + qtyKg);
    existing.productQuantity = existingUnits + units;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.salesCart.push(buildCartItem(product, qtyKg, units));
  }

  writeDb(db);
  return res.json({ isSuccess: true, message: 'Item added to cart', result: cartTotals(db.salesCart) });
});

router.patch('/cart/items/:productId', requireAuth, requireAccess('sales'), (req, res) => {
  const { quantityKg, productQuantity } = req.body || {};
  const db = readDb();
  ensureSalesCollections(db);
  const item = db.salesCart.find((x) => String(x.productId) === String(req.params.productId));
  if (!item) return res.status(404).json({ isSuccess: false, message: 'Cart item not found' });

  const product = findProduct(db, req.params.productId);
  if (!product) return res.status(404).json({ isSuccess: false, message: 'Product not found' });

  const units = Math.max(0, Math.round(toNumber(productQuantity)));
  const qtyKg = round2(toNumber(quantityKg) || (units * toNumber(product.weightKg)));
  if (qtyKg <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });

  const stockError = validateRequestedStock(product, units, 0);
  if (stockError) return res.status(400).json({ isSuccess: false, message: stockError });

  item.quantityKg = qtyKg;
  item.productQuantity = units;
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Cart updated', result: cartTotals(db.salesCart) });
});

router.delete('/cart/items/:productId', requireAuth, requireAccess('sales'), (req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  db.salesCart = db.salesCart.filter((x) => String(x.productId) !== String(req.params.productId));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Item removed', result: cartTotals(db.salesCart) });
});

router.delete('/cart', requireAuth, requireAccess('sales'), (_req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  db.salesCart = [];
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Cart cleared', result: cartTotals(db.salesCart) });
});

router.post('/checkout', requireAuth, requireAccess('sales'), (req, res) => {
  const { customerName, customerPhone, notes } = req.body || {};
  const db = readDb();
  ensureSalesCollections(db);

  if (!db.salesCart.length) return res.status(400).json({ isSuccess: false, message: 'Cart is empty' });

  for (const item of db.salesCart) {
    const product = findProduct(db, item.productId);
    if (!product) return res.status(404).json({ isSuccess: false, message: `Product not found: ${item.productId}` });
    const stockError = validateRequestedStock(product, Math.max(0, Math.round(toNumber(item.productQuantity))), 0);
    if (stockError) return res.status(400).json({ isSuccess: false, message: `${item.name}: ${stockError}` });
  }

  const items = db.salesCart.map((item) => ({ ...item }));
  const totals = cartTotals(items);
  const sale = {
    id: nextId(db.sales),
    invoiceNo: invoiceNo(db.sales),
    customerName: customerName ? String(customerName).trim() : 'Walk-in Customer',
    customerPhone: customerPhone ? String(customerPhone).trim() : '',
    notes: notes ? String(notes).trim() : '',
    items,
    itemsCount: totals.itemsCount,
    totalQuantityKg: totals.totalQuantityKg,
    createdBy: req.user?.email || 'admin',
    createdAt: new Date().toISOString(),
  };

  decreaseProductStock(db, items);
  db.sales.unshift(sale);
  db.salesCart = [];
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Sale created', result: sale });
});

router.post('/', requireAuth, requireAccess('sales'), (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ isSuccess: false, message: 'At least one sale item is required' });

  const db = readDb();
  ensureSalesCollections(db);

  const saleItems = [];
  for (const raw of items) {
    const product = findProduct(db, raw.productId);
    if (!product) return res.status(404).json({ isSuccess: false, message: `Product not found: ${raw.productId}` });
    const units = Math.max(0, Math.round(toNumber(raw.productQuantity)));
    const qty = round2(toNumber(raw.quantityKg) || (units * toNumber(product.weightKg)));
    if (qty <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });
    const stockError = validateRequestedStock(product, units, 0);
    if (stockError) return res.status(400).json({ isSuccess: false, message: `${product.name}: ${stockError}` });
    saleItems.push(buildCartItem(product, qty, units));
  }

  const totals = cartTotals(saleItems);
  const sale = {
    id: nextId(db.sales),
    invoiceNo: invoiceNo(db.sales),
    customerName: body.customerName ? String(body.customerName).trim() : 'Walk-in Customer',
    customerPhone: body.customerPhone ? String(body.customerPhone).trim() : '',
    notes: body.notes ? String(body.notes).trim() : '',
    items: saleItems,
    itemsCount: totals.itemsCount,
    totalQuantityKg: totals.totalQuantityKg,
    createdBy: req.user?.email || 'admin',
    createdAt: new Date().toISOString(),
  };

  decreaseProductStock(db, saleItems);
  db.sales.unshift(sale);
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Sale created', result: sale });
});

router.get('/summary', requireAuth, requireAccess('sales'), (req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  const startDate = req.query.startDate ? String(req.query.startDate).slice(0, 10) : null;
  const endDate = req.query.endDate ? String(req.query.endDate).slice(0, 10) : null;
  const sales = filterSalesByDate(db.sales || [], startDate, endDate);
  const totalQuantityKg = round2(sales.reduce((sum, sale) => sum + toNumber(sale.totalQuantityKg), 0));
  return res.json({
    isSuccess: true,
    message: 'OK',
    result: {
      totalSales: sales.length,
      totalQuantityKg,
      dateRange: { startDate, endDate },
      daily: dailySeries(sales, startDate, endDate),
      topProducts: topProducts(sales, 5),
    },
  });
});

router.get('/', requireAuth, requireAccess('sales'), (req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  const startDate = req.query.startDate ? String(req.query.startDate).slice(0, 10) : null;
  const endDate = req.query.endDate ? String(req.query.endDate).slice(0, 10) : null;
  return res.json({ isSuccess: true, message: 'OK', result: filterSalesByDate(db.sales || [], startDate, endDate) });
});

module.exports = router;
