// ForestWatch prototype using NodeJS + React + Google Maps API
// Backend setup (NodeJS with Express) and frontend (React)

// === Backend: index.js ===
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'client', 'build')));

app.get('/{*any}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 
