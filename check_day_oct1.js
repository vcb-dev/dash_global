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
  const r = await c.query(`
    SELECT
      count(*)::int AS snap,
      count(d.spu_key)::int AS con_trong_dim,
      count(*) FILTER (WHERE coalesce(v.ton_hien_tai,0) <> 0)::int AS con_ton,
      count(*) FILTER (WHERE coalesce(v.sl_ban_sau_chot,0) <> 0)::int AS da_ban
    FROM "${S}".snapshot_ton_xau s
    LEFT JOIN "${S}".dim_spu d ON d.spu_key = s.spu_key
    LEFT JOIN "${S}".vw_day_ton_xau v ON v.spu_key = s.spu_key AND v.ngay_snapshot = s.ngay_snapshot
    WHERE s.ngay_snapshot = DATE '2026-10-01'`);
  console.log(r.rows[0]);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
