const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const isProduction = process.env.NODE_ENV === 'production';
const isNeon = databaseUrl.includes('neon.tech');
const wantsSsl = isProduction || isNeon || /sslmode=require/i.test(databaseUrl);
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

// Neon and most managed Postgres providers require TLS. We disable cert verification
// for compatibility with common provider-issued cert chains in container environments.
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: wantsSsl ? { rejectUnauthorized } : false
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(1);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Query executed', { text: text.substring(0, 50), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connection...');
  await pool.end();
});

module.exports = {
  query,
  pool
};
