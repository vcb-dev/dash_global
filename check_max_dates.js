const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const S = env.DB_SCHEMA || 'global';
(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const t of ['fact_doanh_thu_moi_nhat', 'fact_ton_kho_moi_nhat', 'fact_don_kho_moi_nhat', 'dim_date']) {
    const r = await c.query(`SELECT min(ngay)::text AS min_d, max(ngay)::text AS max_d, count(*)::int AS n FROM "${S}"."${t}"`);
    console.log(t, r.rows[0]);
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
