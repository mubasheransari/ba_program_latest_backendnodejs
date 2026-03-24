// Load env vars (optional). If dotenv is not installed, app can still run with real OS env vars.
try {
  require('dotenv').config();
} catch (e) {
  console.warn('[warn] dotenv not found. Run: npm install (or npm i dotenv) if you want .env support.');
}

const app = require('./src/app');
const { ensureSeedAdmin } = require('./src/db');

const PORT = process.env.PORT || 3000;

(async () => {
  await ensureSeedAdmin();
  app.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
  });
})();