const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'fieldvoice',
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : (process.env.PGSSL === 'false' ? false : (process.env.PGHOST && process.env.PGHOST !== 'localhost' ? { rejectUnauthorized: false } : false)),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
