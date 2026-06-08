// ForestWatch prototype using NodeJS + React + Google Maps API
// Backend setup (NodeJS with Express) and frontend (React)

// === Backend: index.js ===
require('dotenv').config({ path: require('path').join(__dirname, 'client', '.env') });
const express = require('express');
const path = require('path');
const chatHandler = require('./api/chat');
const app = express();
// Use PORT 3001 for local dev so CRA dev server can run on 3000 simultaneously
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'build')));

// AI chat proxy — keeps ANTHROPIC_API_KEY server-side
app.post('/api/chat', chatHandler);

app.get('/{*any}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
