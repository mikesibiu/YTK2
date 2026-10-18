const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const isProduction = process.env.NODE_ENV === 'production';
const isNeon = databaseUrl.includes('neon.tech');
const wantsSsl = process.env.DB_SSL === 'false'
  ? false
  : isProduction || isNeon || /sslmode=require/i.test(databaseUrl);
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

// Neon and most managed Postgres providers require TLS. Certificates are verified
// unless DB_SSL_REJECT_UNAUTHORIZED=false is set.
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: wantsSsl ? { rejectUnauthorized } : false
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(1);
});

async function query(text, params) {
  try {
    return await pool.query(text, params);
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
