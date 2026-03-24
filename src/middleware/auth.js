const jwt = require('jsonwebtoken');
const { readDb } = require('../db');
const { hasAccess } = require('../permissions');

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) {
    return res.status(401).json({ isSuccess: false, message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const db = readDb();
    const currentUser = (db.users || []).find((u) => String(u.id) === String(payload.id));
    if (!currentUser) return res.status(401).json({ isSuccess: false, message: 'Invalid token' });
    if (currentUser.isActive === false) return res.status(403).json({ isSuccess: false, message: 'Your account has been disabled' });
    req.user = payload;
    req.currentUser = currentUser;
    return next();
  } catch (_e) {
    return res.status(401).json({ isSuccess: false, message: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).json({ isSuccess: false, message: 'Unauthorized' });
    }
    if (req.currentUser.role !== role) {
      return res.status(403).json({ isSuccess: false, message: 'Forbidden' });
    }
    return next();
  };
}

function requireAccess(key) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).json({ isSuccess: false, message: 'Unauthorized' });
    }
    if (!hasAccess(req.currentUser, key)) {
      return res.status(403).json({ isSuccess: false, message: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, requireAccess };
