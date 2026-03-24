const router = require('express').Router();

const { readDb, writeDb, nextId } = require('../db');
const { requireAuth, requireAccess } = require('../middleware/auth');

/**
 * Journey Plan data model (stored in db.json):
 * {
 *   id: number,
 *   supervisorId: number|string,
 *   periodType: "weekly"|"monthly",
 *   startDate: "YYYY-MM-DD",
 *   endDate: "YYYY-MM-DD",
 *   days: { "YYYY-MM-DD": [locationId, ...] },
 *   locationsSnapshot: { [locationId]: { id, name, lat, lng, radiusMeters } },
 *   daysCount: number,
 *   selectedDaysCount: number,
 *   copiedFrom?: "weekly" | null,
 *   createdAt: ISOString,
 *   updatedAt: ISOString
 * }
 */

// -------- helpers --------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYmd(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    // allow YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // try Date parse
    const d = new Date(s);
    if (!isNaN(d)) return toYmd(d);
  }
  return null;
}

function isBetweenInclusive(dateYmd, startYmd, endYmd) {
  if (!dateYmd || !startYmd || !endYmd) return false;
  return dateYmd >= startYmd && dateYmd <= endYmd;
}

function normalizeDaysMap(daysAny) {
  const out = {};
  if (!daysAny || typeof daysAny !== 'object') return out;

  for (const [k, v] of Object.entries(daysAny)) {
    const dayKey = toYmd(k);
    if (!dayKey) continue;

    const ids = Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    // unique + sort
    out[dayKey] = Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

function selectedDaysCount(daysMap) {
  let c = 0;
  for (const v of Object.values(daysMap || {})) {
    if (Array.isArray(v) && v.length) c++;
  }
  return c;
}

function ensureJourneyPlansArray(db) {
  db.journeyPlans = db.journeyPlans || [];
  return db.journeyPlans;
}

function findPlanBySupervisor(db, supervisorId) {
  const plans = ensureJourneyPlansArray(db);
  return plans.find((p) => String(p.supervisorId) === String(supervisorId)) || null;
}

function findPlanIndexById(db, id) {
  const plans = ensureJourneyPlansArray(db);
  return plans.findIndex((p) => Number(p.id) === Number(id));
}

function isSupervisorUser(db, supervisorId) {
  const u = (db.users || []).find((x) => String(x.id) === String(supervisorId));
  return !!u && u.role === 'supervisor';
}

// ================= ADMIN =================

// List plans (admin)
// GET /api/journey-plans?limit=30&supervisorId=123
router.get('/', requireAuth, requireAccess('admin'), (req, res) => {
  const limit = Math.min(Number(req.query.limit || 30), 200);
  const supervisorId = req.query.supervisorId ? String(req.query.supervisorId) : null;

  const db = readDb();
  const plans = ensureJourneyPlansArray(db)
    .filter((p) => (supervisorId ? String(p.supervisorId) === supervisorId : true))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, limit);

  return res.json({ isSuccess: true, message: 'OK', result: plans });
});

// Create/Update plan for supervisor (admin, upsert one-plan-per-supervisor)
// POST /api/journey-plans
router.post('/', requireAuth, requireAccess('admin'), (req, res) => {
  const body = req.body || {};

  const supervisorId = body.supervisorId ?? body.supervisor_id ?? body.supervisor;
  const periodType = String(body.periodType || 'weekly').toLowerCase();
  const startDate = toYmd(body.startDate);
  const endDate = toYmd(body.endDate);

  if (!supervisorId) return res.status(400).json({ isSuccess: false, message: 'supervisorId is required' });
  if (periodType !== 'weekly' && periodType !== 'monthly') {
    return res.status(400).json({ isSuccess: false, message: 'periodType must be weekly or monthly' });
  }
  if (!startDate || !endDate) return res.status(400).json({ isSuccess: false, message: 'Invalid startDate/endDate' });
  if (endDate < startDate) return res.status(400).json({ isSuccess: false, message: 'endDate must be >= startDate' });

  const daysMap = normalizeDaysMap(body.days);
  const planned = selectedDaysCount(daysMap);
  if (planned === 0) {
    return res.status(400).json({ isSuccess: false, message: 'Select at least one location in at least one day' });
  }

  // locationsSnapshot is optional but recommended (for supervisor offline view)
  const locationsSnapshot =
    body.locationsSnapshot && typeof body.locationsSnapshot === 'object' ? body.locationsSnapshot : {};

  const db = readDb();

  // validate supervisor exists
  if (!isSupervisorUser(db, supervisorId)) {
    return res.status(400).json({ isSuccess: false, message: 'Supervisor not found (or not a supervisor)' });
  }

  const existing = findPlanBySupervisor(db, supervisorId);
  const nowIso = new Date().toISOString();

  let plan;
  if (existing) {
    existing.periodType = periodType;
    existing.startDate = startDate;
    existing.endDate = endDate;
    existing.days = daysMap;
    existing.locationsSnapshot = locationsSnapshot;
    existing.daysCount = Object.keys(daysMap).length;
    existing.selectedDaysCount = planned;
    existing.copiedFrom = body.copiedFrom ?? existing.copiedFrom ?? null;
    existing.updatedAt = nowIso;
    plan = existing;
  } else {
    plan = {
      id: nextId(db.journeyPlans || []),
      supervisorId,
      periodType,
      startDate,
      endDate,
      days: daysMap,
      locationsSnapshot,
      daysCount: Object.keys(daysMap).length,
      selectedDaysCount: planned,
      copiedFrom: body.copiedFrom ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    ensureJourneyPlansArray(db).push(plan);
  }

  writeDb(db);
  return res.json({ isSuccess: true, message: 'Plan saved', result: plan });
});

// Delete plan (admin)
// DELETE /api/journey-plans/:id
router.delete('/:id', requireAuth, requireAccess('admin'), (req, res) => {
  const id = Number(req.params.id);
  const db = readDb();
  const idx = findPlanIndexById(db, id);
  if (idx === -1) return res.status(404).json({ isSuccess: false, message: 'Plan not found' });

  const removed = db.journeyPlans.splice(idx, 1)[0];
  writeDb(db);
  return res.json({ isSuccess: true, message: 'Plan deleted', result: removed });
});

// ================= SUPERVISOR =================

// Get my active plan for a date (or today). Supervisor only.
// GET /api/journey-plans/my/active?date=YYYY-MM-DD
router.get('/my/active', requireAuth, requireAccess('supervisor'), (req, res) => {
  const date = toYmd(req.query.date || new Date());
  if (!date) return res.status(400).json({ isSuccess: false, message: 'Invalid date' });

  const db = readDb();
  const myId = req.user.id;

  const plans = ensureJourneyPlansArray(db)
    .filter((p) => String(p.supervisorId) === String(myId))
    .filter((p) => p.startDate && p.endDate && isBetweenInclusive(date, p.startDate, p.endDate))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  if (!plans.length) {
    return res.json({ isSuccess: true, message: 'No plan for this date', result: null });
  }

  const plan = plans[0];
  const locationIds = Array.isArray(plan.days?.[date]) ? plan.days[date] : [];
  const locations = locationIds
    .map((id) => (plan.locationsSnapshot || {})[String(id)] || (plan.locationsSnapshot || {})[id])
    .filter(Boolean);

  return res.json({
    isSuccess: true,
    message: 'OK',
    result: { plan, date, locationIds, locations },
  });
});

// Get plan by id (admin OR owner supervisor)
// GET /api/journey-plans/:id
router.get('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const db = readDb();
  const plan = ensureJourneyPlansArray(db).find((p) => Number(p.id) === id);
  if (!plan) return res.status(404).json({ isSuccess: false, message: 'Plan not found' });

  const isAdmin = req.user?.role === 'admin';
  const isOwner = String(plan.supervisorId) === String(req.user?.id);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ isSuccess: false, message: 'Forbidden' });
  }

  return res.json({ isSuccess: true, message: 'OK', result: plan });
});

module.exports = router;
