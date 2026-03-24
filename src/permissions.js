const NAV_KEYS = ['dashboard', 'users', 'supervisors', 'cities', 'locations', 'products', 'sales', 'journeyPlans', 'settings'];

const DEFAULT_SUB_ADMIN_PERMISSIONS = {
  dashboard: true,
  users: false,
  supervisors: false,
  cities: false,
  locations: false,
  products: false,
  sales: false,
  journeyPlans: false,
  settings: false,
};

function normalizePermissions(input = {}) {
  const out = { ...DEFAULT_SUB_ADMIN_PERMISSIONS };
  for (const key of NAV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      out[key] = Boolean(input[key]);
    }
  }
  return out;
}

function hasAccess(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'sub_admin') return false;
  return Boolean(normalizePermissions(user.permissions)[key]);
}

module.exports = {
  NAV_KEYS,
  DEFAULT_SUB_ADMIN_PERMISSIONS,
  normalizePermissions,
  hasAccess,
};
