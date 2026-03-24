const router = require('express').Router();
const { readDb, writeDb, nextId } = require('../db');
const { requireAuth, requireAccess } = require('../middleware/auth');

router.get('/', requireAuth, requireAccess('cities'), (_req, res) => {
  const db = readDb();
  return res.json({ isSuccess: true, message: 'OK', result: db.cities || [] });
});

router.post('/', requireAuth, requireAccess('cities'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ isSuccess: false, message: 'City name is required' });

  const db = readDb();
  db.cities = db.cities || [];
  const exists = db.cities.some((c) => String(c.name).toLowerCase() === String(name).trim().toLowerCase());
  if (exists) return res.status(409).json({ isSuccess: false, message: 'City already exists' });

  const city = { id: nextId(db.cities), name: String(name).trim() };
  db.cities.push(city);
  writeDb(db);

  return res.json({ isSuccess: true, message: 'City added', result: city });
});

router.patch('/:id', requireAuth, requireAccess('cities'), (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ isSuccess: false, message: 'City name is required' });
  const db = readDb();
  const city = (db.cities || []).find((c) => Number(c.id) === Number(req.params.id));
  if (!city) return res.status(404).json({ isSuccess: false, message: 'City not found' });

  const trimmed = String(name).trim();
  const exists = (db.cities || []).some((c) => Number(c.id) !== Number(req.params.id) && String(c.name).toLowerCase() === trimmed.toLowerCase());
  if (exists) return res.status(409).json({ isSuccess: false, message: 'City already exists' });

  const oldName = city.name;
  city.name = trimmed;
  db.locations = (db.locations || []).map((loc) => ({ ...loc, cityName: Number(loc.cityId) === Number(city.id) ? trimmed : loc.cityName }));
  db.users = (db.users || []).map((user) => ({ ...user, city: String(user.city || '').toLowerCase() === String(oldName || '').toLowerCase() ? trimmed : user.city }));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'City updated', result: city });
});

router.delete('/:id', requireAuth, requireAccess('cities'), (req, res) => {
  const db = readDb();
  const cityId = Number(req.params.id);
  const city = (db.cities || []).find((c) => Number(c.id) === cityId);
  if (!city) return res.status(404).json({ isSuccess: false, message: 'City not found' });

  db.cities = (db.cities || []).filter((c) => Number(c.id) !== cityId);
  db.locations = (db.locations || []).filter((loc) => Number(loc.cityId) !== cityId);
  db.users = (db.users || []).map((user) => ({ ...user, city: String(user.city || '').toLowerCase() === String(city.name).toLowerCase() ? '' : user.city }));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'City deleted', result: { id: cityId } });
});

module.exports = router;
