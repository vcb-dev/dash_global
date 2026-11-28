/**
 * Xóa toàn bộ schema bản nháp global_draft trên Supabase.
 * Không đụng schema global (bản chính).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const DRAFT = 'global_draft';

(async () => {
  const c = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const before = await c.query(
    `SELECT table_name, table_type
     FROM information_schema.tables
     WHERE table_schema = $1
     ORDER BY 1`,
    [DRAFT]
  );
  console.log(`Trước khi xóa: ${DRAFT} có ${before.rows.length} object(s)`);
  before.rows.forEach((r) => console.log(`  - ${r.table_name} (${r.table_type})`));

  if (before.rows.length === 0) {
    const exists = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [DRAFT]);
    if (!exists.rowCount) {
      console.log(`Schema ${DRAFT} không tồn tại — không cần xóa.`);
      await c.end();
      return;
    }
  }

  await c.query(`DROP SCHEMA IF EXISTS ${DRAFT} CASCADE`);
  console.log(`Đã DROP SCHEMA ${DRAFT} CASCADE`);

  const after = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [DRAFT]);
  console.log(
    after.rowCount ? `CẢNH BÁO: ${DRAFT} vẫn còn` : `OK: ${DRAFT} đã xóa sạch`
  );

  const main = await c.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'global'`
  );
  console.log(`Schema global (bản chính) còn ${main.rows[0].n} object(s) — không bị đụng.`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
