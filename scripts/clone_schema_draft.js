// Clone schema global → global_draft (bảng + view) để bản nháp tách DB.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const SRC = 'global';
const DST = 'global_draft';

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`CREATE SCHEMA IF NOT EXISTS "${DST}"`);

  // 1) Tables (base tables only)
  const tables = await c.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [SRC]
  );

  for (const { table_name } of tables.rows) {
    const dst = `"${DST}"."${table_name}"`;
    const src = `"${SRC}"."${table_name}"`;
    await c.query(`DROP TABLE IF EXISTS ${dst} CASCADE`);
    await c.query(`CREATE TABLE ${dst} (LIKE ${src} INCLUDING ALL)`);
    await c.query(`INSERT INTO ${dst} SELECT * FROM ${src}`);
    const n = await c.query(`SELECT count(*)::int AS n FROM ${dst}`);
    console.log(`TABLE ${table_name}: ${n.rows[0].n} rows`);
  }

  // 2) Views — recreate in draft by rewriting schema-qualified names
  const views = await c.query(
    `SELECT table_name, view_definition
     FROM information_schema.views
     WHERE table_schema = $1
     ORDER BY table_name`,
    [SRC]
  );

  // Drop existing draft views first
  for (const { table_name } of views.rows) {
    await c.query(`DROP VIEW IF EXISTS "${DST}"."${table_name}" CASCADE`);
  }

  // Create views: replace "global". / global. with global_draft
  for (const { table_name, view_definition } of views.rows) {
    let def = view_definition.trim().replace(/;+\s*$/, '');
    // Rewrite schema refs to draft
    def = def.replace(/"global"/gi, `"${DST}"`);
    def = def.replace(/\bglobal\./gi, `${DST}.`);
    try {
      await c.query(`CREATE VIEW "${DST}"."${table_name}" AS ${def}`);
      console.log(`VIEW ${table_name}: ok`);
    } catch (e) {
      console.error(`VIEW ${table_name}: FAIL`, e.message);
      // fallback: try pg_get_viewdef
      const vd = await c.query(`SELECT pg_get_viewdef('"${SRC}"."${table_name}"'::regclass, true) AS d`);
      let d2 = vd.rows[0].d.replace(/"global"/gi, `"${DST}"`).replace(/\bglobal\./gi, `${DST}.`);
      await c.query(`CREATE VIEW "${DST}"."${table_name}" AS ${d2}`);
      console.log(`VIEW ${table_name}: ok (pg_get_viewdef)`);
    }
  }

  // Grant usage (Supabase pooler / authenticated roles often need this)
  try {
    await c.query(`GRANT USAGE ON SCHEMA "${DST}" TO anon, authenticated, service_role, postgres`);
    await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${DST}" TO anon, authenticated, service_role, postgres`);
  } catch (e) {
    console.log('grant skip:', e.message);
  }

  const check = await c.query(
    `SELECT
       (SELECT count(*) FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE')::int AS tables,
       (SELECT count(*) FROM information_schema.views WHERE table_schema=$1)::int AS views`,
    [DST]
  );
  console.log(`DONE ${DST}:`, check.rows[0]);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
