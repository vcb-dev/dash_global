const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`SELECT spu_key, ten_san_pham, ton_luc_chot, sl_ban_sau_chot, dt_sau_chot, trang_thai_day, ton_hien_tai FROM global.vw_day_ton_xau WHERE spu_key = 'B001268'`);
  console.log('B001268:', r.rows);
  const t = await c.query(`SELECT count(*)::int n, sum(ton_luc_chot)::float ton, sum(sl_ban_sau_chot)::float sl, sum(dt_sau_chot)::float dt FROM global.vw_day_ton_xau`);
  console.log('Tổng list:', t.rows[0]);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
