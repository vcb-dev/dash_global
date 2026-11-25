/**
 * Idempotent SQL migrator for schema `global` (or DB_SCHEMA).
 * Tracks applied files in "<schema>"."_migrations".
 *
 * Usage: SUPABASE_DB_URL=... npm run migrate
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
const URL = ENV.DATABASE_DIRECT || ENV.SUPABASE_DB_URL;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

if (!URL) {
  console.error('Missing DATABASE_DIRECT or SUPABASE_DB_URL');
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${SCHEMA}"."_migrations" (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('No migrations directory, nothing to do.');
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+.*\.sql$/i.test(f))
      .sort();

    const applied = await client.query(
      `SELECT id FROM "${SCHEMA}"."_migrations" ORDER BY id`
    );
    const done = new Set(applied.rows.map((r) => r.id));

    let ran = 0;
    for (const file of files) {
      if (done.has(file)) {
        console.log(`skip  ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').trim();
      if (!sql) {
        console.log(`skip  ${file} (empty)`);
        await client.query(
          `INSERT INTO "${SCHEMA}"."_migrations" (id) VALUES ($1)`,
          [file]
        );
        continue;
      }

      console.log(`apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "${SCHEMA}"."_migrations" (id) VALUES ($1)`,
          [file]
        );
        await client.query('COMMIT');
        ran += 1;
        console.log(`ok    ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log(`migrate done: ${ran} applied, ${files.length - ran} skipped`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err.message);
  process.exit(1);
});
