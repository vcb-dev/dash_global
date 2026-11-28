// Đảm bảo mọi mã trong snapshot_ton_xau đều có trong dim_spu (schema đang dùng).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = process.env.DB_SCHEMA || env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`
    INSERT INTO ${fq('dim_spu')} (spu_key, ten_san_pham, chung_loai, loai_ma, phan_khuc)
    SELECT s.spu_key,
           coalesce(nullif(btrim(s.ten_san_pham), ''), s.spu_key),
           'Các sản phẩm khác',
           'Sản phẩm',
           'Tồn xấu'
    FROM ${fq('snapshot_ton_xau')} s
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = s.spu_key
    WHERE d.spu_key IS NULL
    ON CONFLICT (spu_key) DO NOTHING
    RETURNING spu_key`);
  console.log(`[${SCHEMA}] thêm vào dim_spu: ${r.rowCount} mã`);
  const miss = await c.query(`
    SELECT count(*)::int AS n
    FROM ${fq('snapshot_ton_xau')} s
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = s.spu_key
    WHERE d.spu_key IS NULL`);
  console.log(`còn thiếu trong dim: ${miss.rows[0].n}`);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
