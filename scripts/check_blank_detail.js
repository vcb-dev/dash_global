const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const S = env.DB_SCHEMA || 'global';
const fq = (t) => `"${S}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('=== "Các sản phẩm khác" T11 — từng mã ===');
  const khac = await c.query(`
    SELECT f.spu_key, d.ten_san_pham, d.chung_loai_pos, d.loai_ma, d.phan_khuc,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.so_luong),0)::float AS sl,
           coalesce(sum(f.don_chot),0)::bigint AS don,
           string_agg(DISTINCT left(f.sku,60), ' | ') AS sku
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01' AND d.chung_loai = 'Các sản phẩm khác'
    GROUP BY 1,2,3,4,5
    ORDER BY dt DESC`);
  khac.rows.forEach((r) => {
    console.log(`  ${r.spu_key} | ${r.ten_san_pham} | pos=${r.chung_loai_pos} | loai=${r.loai_ma} | DT ${Number(r.dt).toLocaleString('vi-VN')} | SL ${r.sl}`);
    console.log(`      sku: ${r.sku}`);
  });

  // Orphan fact: có bán nhưng đã bị prune khỏi dim → trên BI hiện blank chủng loại
  console.log('\n=== Fact T11 không join được dim (BI = blank) ===');
  const orphan = await c.query(`
    SELECT f.spu_key,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.so_luong),0)::float AS sl,
           coalesce(sum(f.don_chot),0)::bigint AS don,
           string_agg(DISTINCT left(f.sku,80), ' | ') AS sku,
           min(f.ngay)::text AS tu, max(f.ngay)::text AS den
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01' AND d.spu_key IS NULL
    GROUP BY f.spu_key
    ORDER BY dt DESC`);
  console.log('số mã orphan:', orphan.rows.length);
  orphan.rows.forEach((r) => console.log(`  ${r.spu_key} | DT ${Number(r.dt).toLocaleString('vi-VN')} | SL ${r.sl} | ${r.tu}→${r.den} | ${r.sku}`));

  // Blank chung_loai_pos
  console.log('\n=== Blank / null chung_loai_pos T11 ===');
  const posBlank = await c.query(`
    SELECT coalesce(nullif(btrim(d.chung_loai_pos), ''), '(blank pos)') AS pos,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           count(DISTINCT f.spu_key)::int AS so_ma
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01'
    GROUP BY 1
    ORDER BY dt DESC`);
  posBlank.rows.forEach((r) => console.log(`  ${r.pos}: DT ${Number(r.dt).toLocaleString('vi-VN')} | ${r.so_ma} mã`));

  const posDetail = await c.query(`
    SELECT f.spu_key, d.ten_san_pham, d.chung_loai, d.chung_loai_pos, d.loai_ma,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.so_luong),0)::float AS sl
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01'
      AND (d.spu_key IS NULL OR nullif(btrim(coalesce(d.chung_loai_pos,'')), '') IS NULL)
    GROUP BY 1,2,3,4,5
    ORDER BY dt DESC
    LIMIT 25`);
  console.log('\nChi tiết blank pos / orphan:');
  posDetail.rows.forEach((r) => console.log(`  ${r.spu_key} | ${String(r.ten_san_pham||'').slice(0,40)} | cl=${r.chung_loai||'-'} | pos=${r.chung_loai_pos||'(blank)'} | DT ${Number(r.dt).toLocaleString('vi-VN')}`));

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
