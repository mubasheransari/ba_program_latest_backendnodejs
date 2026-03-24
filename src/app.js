const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const citiesRoutes = require('./routes/cities.routes');
const locationsRoutes = require('./routes/locations.routes');
const productsRoutes = require('./routes/products.routes');
const journeyPlansRoutes = require('./routes/journey_plans.routes');
const salesRoutes = require('./routes/sales.routes');

const app = express();

// Allow the Next.js admin panel to call APIs.
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'ba-program-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cities', citiesRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/journey-plans', journeyPlansRoutes);
app.use('/api/sales', salesRoutes);

module.exports = app;
