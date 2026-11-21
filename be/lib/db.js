const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

function loadEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  const env = { ...process.env };
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => {
      const m = l.match(/^\s*([^#=]+)=(.*)$/);
      if (m && env[m[1].trim()] === undefined) env[m[1].trim()] = m[2].trim();
    });
  }
  return env;
}

const ENV = loadEnv();
const SCHEMA = ENV.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;

const pool = new Pool({
  connectionString: ENV.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(ENV.DB_POOL_MAX || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  options: '-c statement_timeout=20000',
});

function dbQuery(sql, params) {
  return pool.query(sql, params);
}

async function withDb(fn) {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

function parseRange(q) {
  const from = q.from || '2026-10-01';
  const to = q.to || '2026-11-20';
  return { from, to };
}

function khoFilter(q, alias = 'f') {
  if (!q.kho || q.kho === 'All') return { sql: '', params: [] };
  return { sql: ` AND ${alias}.kho = $K`, params: [q.kho], key: 'kho' };
}

module.exports = { ENV, SCHEMA, fq, pool, dbQuery, withDb, parseRange, khoFilter };
