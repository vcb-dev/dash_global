const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const s of ['global', 'global_draft']) {
    const t = await c.query(
      `SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'`,
      [s]
    );
    const d = await c.query(`SELECT max(ngay)::text AS max_dt FROM "${s}"."fact_doanh_thu_moi_nhat"`);
    const snap = await c.query(`SELECT count(*)::int AS n FROM "${s}"."snapshot_ton_xau"`);
    console.log(`${s}: tables=${t.rows[0].tables} | DT max=${d.rows[0].max_dt} | snapshot_ton_xau=${snap.rows[0].n}`);
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
