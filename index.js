// ForestWatch prototype using NodeJS + React + Google Maps API
// Backend setup (NodeJS with Express) and frontend (React)

// === Backend: index.js ===
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(__dirname, '.env.vercel') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(__dirname, 'client', '.env') }); } catch (_) {}
const express = require('express');
const chatHandler = require('./api/chat');
const authHandler = require('./api/auth');
const adminHandler = require('./api/admin');
const reportsHandler = require('./api/reports');
const alertsHandler = require('./api/alerts');
const storyMapsHandler = require('./api/storymaps');
const app = express();
// Use PORT 3001 for local dev so CRA dev server can run on 3000 simultaneously
const PORT = process.env.PORT || 3001;

// The chat request carries map context -- drawn geometry, active layers, the
// FMU list -- which overruns express.json()'s 100 kB default and surfaces as an
// opaque 413 in the UI. 1 MB is generous for that payload while still refusing
// anything pathological.
app.use(express.json({ limit: '1mb' }));

// Names the offender when a request is unexpectedly large. A 413 says only
// "too big"; this says which part grew, which is the thing worth knowing.
app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    const size = (v) => JSON.stringify(v ?? null).length;
    const total = size(req.body);
    if (total > 100_000) {
      const parts = Object.entries(req.body)
        .map(([k, v]) => `${k}=${(size(v) / 1024).toFixed(1)}kB`)
        .join(' ');
      console.warn(`[chat] large request body: ${(total / 1024).toFixed(1)}kB (${parts})`);
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'client', 'build')));

// API routes
app.all('/api/auth', authHandler);
app.all('/api/admin', adminHandler);
app.all('/api/reports', reportsHandler);
app.all('/api/alerts', alertsHandler);
app.all('/api/storymaps', storyMapsHandler);

// Public story map URLs (on Vercel these are rewrites in vercel.json)
app.get('/stories/:username/:slug/preview.jpg', (req, res) => {
  req.params.action = 'og';
  return storyMapsHandler(req, res);
});
app.get('/stories/:username/:slug', (req, res) => {
  req.params.action = 'view';
  return storyMapsHandler(req, res);
});
app.all('/api/chat', chatHandler);

app.get('/{*any}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
