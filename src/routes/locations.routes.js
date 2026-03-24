const router = require('express').Router();
const { readDb, writeDb, nextId } = require('../db');
const { requireAuth, requireAccess } = require('../middleware/auth');

router.get('/', requireAuth, requireAccess('locations'), (req, res) => {
  const { cityId, city } = req.query;
  const db = readDb();
  let list = db.locations || [];
  if (cityId) list = list.filter((x) => String(x.cityId) === String(cityId));
  if (city) list = list.filter((x) => String(x.cityName || '').toLowerCase() === String(city).toLowerCase());
  return res.json({ isSuccess: true, message: 'OK', result: list });
});

router.post('/', requireAuth, requireAccess('locations'), (req, res) => {
  const { martName, area, cityId, city, lat, lng } = req.body || {};
  if (!martName || !area || (!cityId && !city) || lat === undefined || lng === undefined) {
    return res.status(400).json({
      isSuccess: false,
      message: 'martName, area, city/cityId, lat, lng are required',
    });
  }

  const db = readDb();
  db.locations = db.locations || [];
  db.cities = db.cities || [];

  let cityObj = null;
  if (cityId) cityObj = db.cities.find((c) => String(c.id) === String(cityId));
  if (!cityObj && city) cityObj = db.cities.find((c) => String(c.name).toLowerCase() === String(city).toLowerCase());

  const loc = {
    id: nextId(db.locations),
    martName: String(martName).trim(),
    area: String(area).trim(),
    cityId: cityObj ? cityObj.id : cityId,
    cityName: cityObj ? cityObj.name : city,
    lat: Number(lat),
    lng: Number(lng),
    createdAt: new Date().toISOString(),
  };
  db.locations.push(loc);
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Location added', result: loc });
});

router.patch('/:id', requireAuth, requireAccess('locations'), (req, res) => {
  const { martName, area, cityId, city, lat, lng } = req.body || {};
  const db = readDb();
  const loc = (db.locations || []).find((x) => Number(x.id) === Number(req.params.id));
  if (!loc) return res.status(404).json({ isSuccess: false, message: 'Location not found' });

  let cityObj = null;
  if (cityId) cityObj = (db.cities || []).find((c) => String(c.id) === String(cityId));
  if (!cityObj && city) cityObj = (db.cities || []).find((c) => String(c.name).toLowerCase() === String(city).toLowerCase());

  loc.martName = martName !== undefined ? String(martName).trim() : loc.martName;
  loc.area = area !== undefined ? String(area).trim() : loc.area;
  loc.cityId = cityObj ? cityObj.id : (cityId !== undefined ? cityId : loc.cityId);
  loc.cityName = cityObj ? cityObj.name : (city !== undefined ? city : loc.cityName);
  loc.lat = lat !== undefined ? Number(lat) : loc.lat;
  loc.lng = lng !== undefined ? Number(lng) : loc.lng;
  loc.updatedAt = new Date().toISOString();
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Location updated', result: loc });
});

router.delete('/:id', requireAuth, requireAccess('locations'), (req, res) => {
  const db = readDb();
  const exists = (db.locations || []).some((x) => Number(x.id) === Number(req.params.id));
  if (!exists) return res.status(404).json({ isSuccess: false, message: 'Location not found' });
  db.locations = (db.locations || []).filter((x) => Number(x.id) !== Number(req.params.id));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Location deleted', result: { id: Number(req.params.id) } });
});

module.exports = router;
