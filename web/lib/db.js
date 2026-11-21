const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', '..', 'node_modules', 'pg'));

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

async function withDb(fn) {
  const c = new Client({
    connectionString: ENV.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
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

module.exports = { ENV, SCHEMA, fq, withDb, parseRange, khoFilter };
