const { Pool } = require('pg');
require('dotenv').config();

const pgPackageVersion = require('pg/package.json').version;

// SSL config: use SSL for RDS (remote DB), disable for local PostgreSQL
const sslConfig = process.env.DB_HOST === '127.0.0.1' || process.env.DB_HOST === 'localhost'
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'edupulse',
  user:     process.env.DB_USER || 'edupulse_admin',
  password: process.env.DB_PASSWORD || 'Edu#Pulse@Srv2025!xK9',
  ssl:      sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
});

pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Returns both server and client-side PostgreSQL version details.
pool.getVersionInfo = async () => {
  const { rows } = await pool.query(
    `SELECT version() AS server_full, current_setting('server_version') AS server_version`
  );

  return {
    serverVersion: rows[0].server_version,
    serverFull: rows[0].server_full,
    clientDriverVersion: pgPackageVersion,
  };
};

// Optional startup probe to print active server/client versions once.
(async () => {
  try {
    const info = await pool.getVersionInfo();
    console.log(`  ✓ PostgreSQL server: ${info.serverVersion}`);
    console.log(`  ✓ pg driver: ${info.clientDriverVersion}`);
  } catch (err) {
    console.warn('  ⚠ PostgreSQL version probe skipped:', err.message);
  }
})();

module.exports = pool;
