const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { readDb, writeDb, nextId } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { DEFAULT_SUB_ADMIN_PERMISSIONS } = require('../permissions');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, name: user.name },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRES || '7d' },
  );
}

router.post('/signup', async (req, res) => {
  const { name, email, city, employeeCnic, location, password, confirmPassword } = req.body || {};

  if (!name || !email || !city || !employeeCnic || !location || !password || !confirmPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  const db = readDb();
  const exists = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) {
    return res.status(409).json({ message: 'Email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: nextId(db.users),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    role: 'employee',
    city: String(city).trim(),
    employeeCnic: String(employeeCnic).trim(),
    location: String(location).trim(),
    isApproved: false,
    isActive: true,
    passwordHash,
    passwordPlain: String(password),
    createdAt: new Date().toISOString(),
  };

  db.users.push(user);
  writeDb(db);

  return res.status(201).json({ ok: true, message: 'Signup successful. Awaiting admin approval.' });
});

async function doLogin(req, res, { role, adminPanel } = {}) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const db = readDb();
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  if (role && user.role !== role) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (adminPanel && !['admin', 'sub_admin'].includes(user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (user.isActive === false) {
    return res.status(403).json({ message: 'Your account has been disabled' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  if (user.role === 'employee' && !user.isApproved) {
    return res.status(403).json({
      message: 'Admin approval is needed asked your manager to approve your account',
    });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      isActive: user.isActive !== false,
      permissions: user.role === 'sub_admin' ? (user.permissions || DEFAULT_SUB_ADMIN_PERMISSIONS) : undefined,
    },
  });
}

router.post('/login', async (req, res) => doLogin(req, res));
router.post('/admin/login', async (req, res) => doLogin(req, res, { adminPanel: true }));

router.get('/me', requireAuth, async (req, res) => {
  const me = req.currentUser;
  return res.json({
    user: {
      id: me.id,
      name: me.name,
      email: me.email,
      role: me.role,
      isApproved: me.isApproved,
      isActive: me.isActive !== false,
      permissions: me.role === 'sub_admin' ? me.permissions : undefined,
    },
  });
});

module.exports = router;
