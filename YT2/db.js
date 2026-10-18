const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const isProduction = process.env.NODE_ENV === 'production';
const isNeon = databaseUrl.includes('neon.tech');
const wantsSsl = isProduction || isNeon || /sslmode=require/i.test(databaseUrl);
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: wantsSsl ? { rejectUnauthorized } : false,
  max: 5,
  connectionTimeoutMillis: 8000
});

// Idle-client errors (e.g. Neon dropping an idle connection) are survivable: the pool
// discards the client. Log and carry on rather than exiting.
pool.on('error', err => {
  console.error('Unexpected database error:', err.message);
});

// Deliberately does not log queries (they can contain search terms).
async function query(text, params) {
  return pool.query(text, params);
}

process.on('SIGTERM', async () => {
  await pool.end().catch(() => {});
});

module.exports = { query, pool };
