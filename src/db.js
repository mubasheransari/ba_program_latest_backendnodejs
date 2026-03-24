const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DEFAULT_SUB_ADMIN_PERMISSIONS, normalizePermissions } = require('./permissions');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function round3(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
}

function parseWeightToKg(weight, unit) {
  if (weight === undefined || weight === null || weight === '') return 0;
  const raw = String(weight).trim().toLowerCase();
  const numeric = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  const normalizedUnit = String(unit || '').trim().toLowerCase();
  if (normalizedUnit === 'gram' || normalizedUnit === 'grams' || normalizedUnit === 'g' || raw.includes('gram') || /\bgr\b/.test(raw) || raw.endsWith('g')) {
    return round3(numeric / 1000);
  }
  return round3(numeric);
}

function formatWeightKg(value) {
  const n = round3(value);
  return `${n} KG`;
}

function normalizeProduct(product) {
  const weightKg = product.weightKg && Number(product.weightKg) > 0 ? round3(product.weightKg) : parseWeightToKg(product.weight, product.weightUnit);
  return {
    ...product,
    quantity: Number(product.quantity || 0),
    weightKg,
    weight: formatWeightKg(weightKg),
    weightUnit: 'kg',
  };
}

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], cities: [], locations: [], products: [], journeyPlans: [], sales: [], salesCart: [] }, null, 2),
      'utf8'
    );
  }
}

function ensureCollections(db) {
  db.users = Array.isArray(db.users) ? db.users : [];
  db.cities = Array.isArray(db.cities) ? db.cities : [];
  db.locations = Array.isArray(db.locations) ? db.locations : [];
  db.products = Array.isArray(db.products) ? db.products : [];
  db.journeyPlans = Array.isArray(db.journeyPlans) ? db.journeyPlans : [];
  db.sales = Array.isArray(db.sales) ? db.sales : [];
  db.salesCart = Array.isArray(db.salesCart) ? db.salesCart : [];

  db.users = db.users.map((user) => ({
    isActive: user.isActive !== false,
    ...(user.role === 'sub_admin'
      ? { permissions: normalizePermissions(user.permissions || DEFAULT_SUB_ADMIN_PERMISSIONS) }
      : {}),
    ...user,
  }));

  db.products = db.products.map(normalizeProduct);

  return db;
}

function readDb() {
  ensureDbFile();
  return ensureCollections(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
}

function writeDb(db) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(ensureCollections(db), null, 2), 'utf8');
}

function nextId(list) {
  const max = (list || []).reduce((m, x) => Math.max(m, Number(x.id || 0)), 0);
  return max + 1;
}

async function ensureSeedAdmin() {
  const db = readDb();
  const hasAdmin = (db.users || []).some((u) => u.role === 'admin');
  if (hasAdmin) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@baprogram.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const name = process.env.ADMIN_NAME || 'System Admin';

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = {
    id: nextId(db.users),
    role: 'admin',
    name,
    email,
    passwordHash,
    passwordPlain: password,
    isApproved: true,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  db.users.push(admin);
  writeDb(db);
}

module.exports = {
  readDb,
  writeDb,
  nextId,
  ensureSeedAdmin,
  ensureCollections,
  DB_PATH,
  parseWeightToKg,
  formatWeightKg,
  normalizeProduct,
};
