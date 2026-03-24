const router = require('express').Router();
const { readDb, writeDb, parseWeightToKg, formatWeightKg, normalizeProduct } = require('../db');
const { requireAuth, requireAccess } = require('../middleware/auth');

router.get('/', requireAuth, requireAccess('products'), (_req, res) => {
  const db = readDb();
  return res.json({ isSuccess: true, message: 'OK', result: (db.products || []).map(normalizeProduct) });
});

router.post('/', requireAuth, requireAccess('products'), (req, res) => {
  const { id, name, description, brandName, quantity, weight, weightUnit } = req.body || {};
  if (!id || !name || !description || !brandName || quantity === undefined || weight === undefined) {
    return res.status(400).json({ isSuccess: false, message: 'All product fields are required' });
  }
  const db = readDb();
  db.products = db.products || [];
  const exists = db.products.some((p) => String(p.id) === String(id));
  if (exists) return res.status(409).json({ isSuccess: false, message: 'Product id already exists' });

  const weightKg = parseWeightToKg(weight, weightUnit);
  if (weightKg <= 0) return res.status(400).json({ isSuccess: false, message: 'Weight must be greater than 0' });

  const product = normalizeProduct({
    id: String(id).trim(),
    name: String(name).trim(),
    description: String(description).trim(),
    brandName: String(brandName).trim(),
    quantity: Number(quantity || 0),
    weightKg,
    weight: formatWeightKg(weightKg),
    weightUnit: 'kg',
    createdAt: new Date().toISOString(),
  });
  db.products.push(product);
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Product added', result: product });
});

router.patch('/:id', requireAuth, requireAccess('products'), (req, res) => {
  const db = readDb();
  const product = (db.products || []).find((p) => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ isSuccess: false, message: 'Product not found' });

  if (req.body?.newId && String(req.body.newId) !== String(product.id)) {
    const exists = (db.products || []).some((p) => String(p.id) === String(req.body.newId));
    if (exists) return res.status(409).json({ isSuccess: false, message: 'Product id already exists' });
    product.id = String(req.body.newId).trim();
  }

  if (req.body?.name !== undefined) product.name = String(req.body.name).trim();
  if (req.body?.description !== undefined) product.description = String(req.body.description).trim();
  if (req.body?.brandName !== undefined) product.brandName = String(req.body.brandName).trim();
  if (req.body?.quantity !== undefined) product.quantity = Number(req.body.quantity || 0);
  if (req.body?.weight !== undefined) {
    const weightKg = parseWeightToKg(req.body.weight, req.body.weightUnit);
    if (weightKg <= 0) return res.status(400).json({ isSuccess: false, message: 'Weight must be greater than 0' });
    product.weightKg = weightKg;
    product.weight = formatWeightKg(weightKg);
    product.weightUnit = 'kg';
  }
  product.updatedAt = new Date().toISOString();

  db.sales = (db.sales || []).map((sale) => ({
    ...sale,
    items: (sale.items || []).map((item) => String(item.productId) === String(req.params.id)
      ? { ...item, productId: product.id, name: product.name, brandName: product.brandName, weight: product.weight }
      : item),
  }));
  db.salesCart = (db.salesCart || []).map((item) => String(item.productId) === String(req.params.id)
    ? { ...item, productId: product.id, name: product.name, brandName: product.brandName, weight: product.weight }
    : item);

  writeDb(db);
  return res.json({ isSuccess: true, message: 'Product updated', result: normalizeProduct(product) });
});

router.delete('/:id', requireAuth, requireAccess('products'), (req, res) => {
  const db = readDb();
  const exists = (db.products || []).some((p) => String(p.id) === String(req.params.id));
  if (!exists) return res.status(404).json({ isSuccess: false, message: 'Product not found' });
  db.products = (db.products || []).filter((p) => String(p.id) !== String(req.params.id));
  db.salesCart = (db.salesCart || []).filter((item) => String(item.productId) !== String(req.params.id));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Product deleted', result: { id: String(req.params.id) } });
});

module.exports = router;
