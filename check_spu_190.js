const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const S = 'global';
const fq = (t) => `"${S}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const byPk = await c.query(`
    SELECT coalesce(phan_khuc,'(null)') pk, count(*)::int n
    FROM ${fq('dim_spu')}
    GROUP BY 1 ORDER BY n DESC`);
  console.log('dim_spu by phan_khuc', byPk.rows);

  const ex = await c.query(`
    SELECT spu_key, ten_san_pham, loai_ma, phan_khuc, chung_loai_pos, trong_danh_muc
    FROM ${fq('dim_spu')}
    WHERE coalesce(phan_khuc,'') IN ('Mã trung gian','Dịch vụ/Đặt hàng')
    ORDER BY phan_khuc, spu_key`);
  console.log('\n=== BỎ (không vào 190) ===');
  ex.rows.forEach((r) => console.log(`  ${r.spu_key} | ${r.ten_san_pham} | ${r.loai_ma} | ${r.phan_khuc}`));

  const c50 = await c.query(`
    SELECT spu_key, ten_san_pham, loai_ma, phan_khuc, chung_loai, chung_loai_pos, ma_cu_moi, sl_30_ngay, trong_danh_muc
    FROM ${fq('dim_spu')} WHERE spu_key ILIKE '%C500391%' OR spu_goc ILIKE '%C500391%'`);
  console.log('\n=== C500391 ===', c50.rows);

  const keep = await c.query(`
    SELECT coalesce(phan_khuc,'(null)') pk, count(*)::int n
    FROM ${fq('dim_spu')}
    WHERE coalesce(phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
    GROUP BY 1 ORDER BY n DESC`);
  console.log('\n=== GIỮ (190) by pk ===', keep.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
