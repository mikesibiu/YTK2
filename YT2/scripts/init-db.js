// Applies database/schema.sql to DATABASE_URL.  Usage: npm run init-db
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  await db.query(sql);
  const { rows } = await db.query('SELECT * FROM filter_summary');
  console.log('Schema applied.', rows[0]);
  await db.pool.end();
})().catch(err => {
  console.error('Failed to apply schema:', err.message);
  process.exit(1);
});
