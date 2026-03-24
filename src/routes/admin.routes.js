const router = require('express').Router();
const bcrypt = require('bcryptjs');

const { readDb, writeDb, nextId } = require('../db');
const { requireAuth, requireRole, requireAccess } = require('../middleware/auth');
const { NAV_KEYS, DEFAULT_SUB_ADMIN_PERMISSIONS, normalizePermissions } = require('../permissions');

function toPublicUser(u) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    email: u.email,
    city: u.city,
    location: u.location,
    employeeCnic: u.employeeCnic,
    cnicNumber: u.cnicNumber,
    isApproved: u.isApproved,
    isActive: u.isActive !== false,
    createdAt: u.createdAt,
    passwordPlain: u.passwordPlain || '',
    permissions: u.role === 'sub_admin' ? normalizePermissions(u.permissions || DEFAULT_SUB_ADMIN_PERMISSIONS) : undefined,
  };
}

router.get('/users', requireAuth, requireAccess('users'), (req, res) => {
  const { status } = req.query;
  const db = readDb();
  let users = (db.users || [])
    .filter((u) => u.role !== 'admin')
    .map(toPublicUser);

  if (status === 'pending') {
    users = users.filter((u) => u.role === 'employee' && u.isApproved !== true);
  }

  return res.json({ isSuccess: true, message: 'OK', result: users });
});

router.get('/stats', requireAuth, requireAccess('dashboard'), (req, res) => {
  const db = readDb();
  const employees = db.users.filter((u) => u.role === 'employee').length;
  const supervisors = db.users.filter((u) => u.role === 'supervisor').length;
  const subAdmins = db.users.filter((u) => u.role === 'sub_admin').length;
  const pending = db.users.filter((u) => u.role === 'employee' && u.isApproved !== true).length;
  const activeUsers = db.users.filter((u) => u.role !== 'admin' && u.isActive !== false).length;
  const sales = db.sales || [];
  const totalQuantityKg = sales.reduce((sum, sale) => sum + Number(sale.totalQuantityKg || 0), 0);
  return res.json({
    isSuccess: true,
    message: 'OK',
    result: {
      pending,
      employees,
      supervisors,
      subAdmins,
      activeUsers,
      cities: db.cities.length,
      locations: db.locations.length,
      products: db.products.length,
      sales: sales.length,
      totalSalesKg: Math.round((totalQuantityKg + Number.EPSILON) * 100) / 100,
    },
  });
});

router.post('/users/:id/approve', requireAuth, requireAccess('users'), (req, res) => {
  const db = readDb();
  const id = Number(req.params.id);
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ isSuccess: false, message: 'User not found' });
  if (user.role !== 'employee') {
    return res.status(400).json({ isSuccess: false, message: 'Only employees require approval' });
  }

  user.isApproved = true;
  writeDb(db);
  return res.json({ isSuccess: true, message: 'User approved', result: { id: user.id } });
});

router.patch('/users/:id/status', requireAuth, requireAccess('users'), (req, res) => {
  const db = readDb();
  const id = Number(req.params.id);
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ isSuccess: false, message: 'User not found' });
  if (user.role === 'admin') {
    return res.status(400).json({ isSuccess: false, message: 'Super admin status cannot be changed here' });
  }

  user.isActive = req.body?.isActive !== false;
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Status updated', result: toPublicUser(user) });
});

router.delete('/users/:id', requireAuth, requireAccess('users'), (req, res) => {
  const db = readDb();
  const id = Number(req.params.id);
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ isSuccess: false, message: 'User not found' });
  if (user.role === 'admin') {
    return res.status(400).json({ isSuccess: false, message: 'Super admin cannot be deleted' });
  }

  db.users = db.users.filter((u) => Number(u.id) !== id);
  writeDb(db);
  return res.json({ isSuccess: true, message: 'User deleted', result: { id } });
});

router.post('/supervisors', requireAuth, requireAccess('supervisors'), async (req, res) => {
  const { name, email, cnicNumber, city, password, confirmPassword } = req.body || {};
  if (!name || !email || !cnicNumber || !city || !password || !confirmPassword) {
    return res.status(400).json({ isSuccess: false, message: 'All fields are required' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ isSuccess: false, message: 'Passwords do not match' });
  }

  const db = readDb();
  const em = String(email).toLowerCase();
  const exists = (db.users || []).some((u) => u.email === em);
  if (exists) return res.status(409).json({ isSuccess: false, message: 'Email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: nextId(db.users),
    role: 'supervisor',
    name,
    email: em,
    cnicNumber,
    city,
    passwordHash,
    passwordPlain: String(password),
    isApproved: true,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDb(db);

  return res.json({
    isSuccess: true,
    message: 'Supervisor created',
    result: toPublicUser(user),
  });
});

router.patch('/supervisors/:id', requireAuth, requireAccess('supervisors'), (req, res) => {
  const db = readDb();
  const user = (db.users || []).find((u) => Number(u.id) === Number(req.params.id) && u.role === 'supervisor');
  if (!user) return res.status(404).json({ isSuccess: false, message: 'Supervisor not found' });

  user.isActive = req.body?.isActive !== false;
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Supervisor updated', result: toPublicUser(user) });
});

router.delete('/supervisors/:id', requireAuth, requireAccess('supervisors'), (req, res) => {
  const db = readDb();
  const user = (db.users || []).find((u) => Number(u.id) === Number(req.params.id) && u.role === 'supervisor');
  if (!user) return res.status(404).json({ isSuccess: false, message: 'Supervisor not found' });

  db.users = db.users.filter((u) => Number(u.id) !== Number(req.params.id));
  db.journeyPlans = (db.journeyPlans || []).filter((p) => Number(p.supervisorId) !== Number(req.params.id));
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Supervisor deleted', result: { id: Number(req.params.id) } });
});

router.get('/sub-admins', requireAuth, requireRole('admin'), (req, res) => {
  const db = readDb();
  const rows = (db.users || []).filter((u) => u.role === 'sub_admin').map(toPublicUser);
  return res.json({ isSuccess: true, message: 'OK', result: { navKeys: NAV_KEYS, rows } });
});

router.post('/sub-admins', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, city, password, confirmPassword, permissions } = req.body || {};
  if (!name || !email || !password || !confirmPassword) {
    return res.status(400).json({ isSuccess: false, message: 'Name, email and passwords are required' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ isSuccess: false, message: 'Passwords do not match' });
  }

  const db = readDb();
  const em = String(email).trim().toLowerCase();
  if ((db.users || []).some((u) => u.email === em)) {
    return res.status(409).json({ isSuccess: false, message: 'Email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: nextId(db.users),
    role: 'sub_admin',
    name: String(name).trim(),
    email: em,
    city: city ? String(city).trim() : '',
    passwordHash,
    passwordPlain: String(password),
    permissions: normalizePermissions(permissions || DEFAULT_SUB_ADMIN_PERMISSIONS),
    isApproved: true,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDb(db);

  return res.json({ isSuccess: true, message: 'Sub admin created', result: toPublicUser(user) });
});

router.patch('/sub-admins/:id/permissions', requireAuth, requireRole('admin'), (req, res) => {
  const db = readDb();
  const user = (db.users || []).find((u) => Number(u.id) === Number(req.params.id) && u.role === 'sub_admin');
  if (!user) return res.status(404).json({ isSuccess: false, message: 'Sub admin not found' });

  user.permissions = normalizePermissions(req.body?.permissions || {});
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Permissions updated', result: toPublicUser(user) });
});

module.exports = router;
