const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/config.js', (req, res) => {
  const apiBase = process.env.FILTER_API_BASE_URL || 'https://ytk2.farace.net';
  res.type('application/javascript').send(
    `window.YTK2_WEB_CONFIG = ${JSON.stringify({ API_BASE_URL: apiBase })};`
  );
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`YTK2 web frontend listening on ${PORT}`);
});
