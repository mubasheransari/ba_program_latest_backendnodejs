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

function buildCartItem(product, quantityKg) {
  return {
    productId: String(product.id),
    name: product.name,
    brandName: product.brandName,
    weight: product.weight || `${product.weightKg} KG`,
    quantityKg: round2(quantityKg),
    addedAt: new Date().toISOString(),
  };
}

function cartTotals(items) {
  const totalQuantityKg = round2(items.reduce((sum, item) => sum + toNumber(item.quantityKg), 0));
  return {
    items,
    itemsCount: items.length,
    totalQuantityKg,
  };
}

function dailySeries(sales, days = 7) {
  const now = new Date();
  const map = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, totalQuantityKg: 0, orders: 0 });
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
      };
      existing.totalQuantityKg = round2(existing.totalQuantityKg + toNumber(item.quantityKg));
      acc.set(key, existing);
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.totalQuantityKg - a.totalQuantityKg).slice(0, limit);
}

router.get('/cart', requireAuth, requireAccess('sales'), (_req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  return res.json({ isSuccess: true, message: 'OK', result: cartTotals(db.salesCart) });
});

router.post('/cart/items', requireAuth, requireAccess('sales'), (req, res) => {
  const { productId, quantityKg } = req.body || {};
  const db = readDb();
  ensureSalesCollections(db);

  const product = findProduct(db, productId);
  if (!product) return res.status(404).json({ isSuccess: false, message: 'Product not found' });

  const qty = round2(toNumber(quantityKg));
  if (qty <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });

  const existing = db.salesCart.find((item) => String(item.productId) === String(productId));
  if (existing) {
    existing.quantityKg = round2(toNumber(existing.quantityKg) + qty);
    existing.updatedAt = new Date().toISOString();
  } else {
    db.salesCart.push(buildCartItem(product, qty));
  }

  writeDb(db);
  return res.json({ isSuccess: true, message: 'Item added to cart', result: cartTotals(db.salesCart) });
});

router.patch('/cart/items/:productId', requireAuth, requireAccess('sales'), (req, res) => {
  const { quantityKg } = req.body || {};
  const db = readDb();
  ensureSalesCollections(db);
  const item = db.salesCart.find((x) => String(x.productId) === String(req.params.productId));
  if (!item) return res.status(404).json({ isSuccess: false, message: 'Cart item not found' });

  const qty = round2(toNumber(quantityKg));
  if (qty <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });
  item.quantityKg = qty;
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
    const qty = round2(toNumber(raw.quantityKg));
    if (qty <= 0) return res.status(400).json({ isSuccess: false, message: 'quantityKg must be greater than 0' });
    saleItems.push(buildCartItem(product, qty));
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

  db.sales.unshift(sale);
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Sale created', result: sale });
});

router.get('/summary', requireAuth, requireAccess('sales'), (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 7), 1), 30);
  const db = readDb();
  ensureSalesCollections(db);
  const sales = db.sales || [];
  const totalQuantityKg = round2(sales.reduce((sum, sale) => sum + toNumber(sale.totalQuantityKg), 0));
  return res.json({
    isSuccess: true,
    message: 'OK',
    result: {
      totalSales: sales.length,
      totalQuantityKg,
      daily: dailySeries(sales, days),
      topProducts: topProducts(sales, 5),
    },
  });
});

router.get('/', requireAuth, requireAccess('sales'), (req, res) => {
  const db = readDb();
  ensureSalesCollections(db);
  return res.json({ isSuccess: true, message: 'OK', result: db.sales || [] });
});

module.exports = router;
