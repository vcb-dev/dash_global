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

  // DT theo chủng loại (kèm blank)
  const byCl = await c.query(`
    SELECT coalesce(nullif(btrim(d.chung_loai), ''), '(blank)') AS chung_loai,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.don_chot),0)::bigint AS don,
           coalesce(sum(f.so_luong),0)::float AS sl,
           count(DISTINCT f.spu_key)::int AS so_ma
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01'
    GROUP BY 1
    ORDER BY dt DESC`);
  console.log('=== DT T11 theo chủng loại ===');
  byCl.rows.forEach((r) => console.log(`  ${r.chung_loai}: DT ${Number(r.dt).toLocaleString('vi-VN')} | đơn ${r.don} | SL ${r.sl} | ${r.so_ma} mã`));

  // Các mã blank chủng loại / không join dim
  const blank = await c.query(`
    SELECT f.spu_key,
           d.ten_san_pham,
           d.chung_loai,
           d.chung_loai_pos,
           d.loai_ma,
           d.phan_khuc,
           d.ma_cu_moi,
           count(*)::int AS dong,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.don_chot),0)::bigint AS don,
           coalesce(sum(f.so_luong),0)::float AS sl,
           string_agg(DISTINCT f.sku, ' | ' ORDER BY f.sku) AS sku_mau
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01'
      AND (d.spu_key IS NULL OR nullif(btrim(coalesce(d.chung_loai,'')), '') IS NULL)
    GROUP BY f.spu_key, d.ten_san_pham, d.chung_loai, d.chung_loai_pos, d.loai_ma, d.phan_khuc, d.ma_cu_moi
    ORDER BY dt DESC
    LIMIT 40`);
  console.log('\n=== Mã blank chủng loại / không có dim (T11) ===');
  blank.rows.forEach((r) => {
    console.log(
      `  ${r.spu_key} | ${String(r.ten_san_pham || '').slice(0, 45)} | pos=${r.chung_loai_pos || '-'} | loai=${r.loai_ma || '-'} | pk=${r.phan_khuc || '-'} | DT ${Number(r.dt).toLocaleString('vi-VN')} | đơn ${r.don} | SL ${r.sl}`
    );
    if (r.sku_mau) console.log(`      sku: ${String(r.sku_mau).slice(0, 120)}`);
  });

  const tongBlank = await c.query(`
    SELECT coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.don_chot),0)::bigint AS don,
           count(DISTINCT f.spu_key)::int AS so_ma
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE f.ngay >= DATE '2026-11-01'
      AND (d.spu_key IS NULL OR nullif(btrim(coalesce(d.chung_loai,'')), '') IS NULL)`);
  const tongAll = await c.query(`
    SELECT coalesce(sum(order_revenue_vnd),0)::bigint AS dt
    FROM ${fq('fact_doanh_thu_moi_nhat')} WHERE ngay >= DATE '2026-11-01'`);
  const b = tongBlank.rows[0];
  const pct = tongAll.rows[0].dt ? (100 * Number(b.dt) / Number(tongAll.rows[0].dt)) : 0;
  console.log(`\nTổng blank T11: DT ${Number(b.dt).toLocaleString('vi-VN')} (${pct.toFixed(1)}%) | đơn ${b.don} | ${b.so_ma} mã`);

  // Blank cả kỳ data
  const blankAll = await c.query(`
    SELECT f.spu_key, d.ten_san_pham, d.chung_loai_pos, d.loai_ma,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(f.don_chot),0)::bigint AS don
    FROM ${fq('fact_doanh_thu_moi_nhat')} f
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
    WHERE d.spu_key IS NULL OR nullif(btrim(coalesce(d.chung_loai,'')), '') IS NULL
    GROUP BY 1,2,3,4
    ORDER BY dt DESC
    LIMIT 15`);
  console.log('\n=== Top blank cả kỳ (01/10–19/11) ===');
  blankAll.rows.forEach((r) => console.log(`  ${r.spu_key} | ${String(r.ten_san_pham||'').slice(0,40)} | pos=${r.chung_loai_pos||'-'} | DT ${Number(r.dt).toLocaleString('vi-VN')}`));

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
