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
  const S = 'global';

  const kpi = (
    await c.query(`
    SELECT coalesce(sum(order_revenue_vnd),0)::float dt,
           coalesce(sum(don_chot),0)::float don,
           coalesce(sum(so_luong),0)::float sl
    FROM ${S}.fact_doanh_thu_moi_nhat
    WHERE ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'`)
  ).rows[0];

  const byKho = (
    await c.query(`
    SELECT kho, sum(order_revenue_vnd)::float dt, sum(so_luong)::float sl, sum(don_chot)::float don
    FROM ${S}.fact_doanh_thu_moi_nhat
    WHERE ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
    GROUP BY kho ORDER BY dt DESC`)
  ).rows;

  const byPk = (
    await c.query(`
    SELECT d.phan_khuc, sum(f.order_revenue_vnd)::float dt, sum(f.so_luong)::float sl
    FROM ${S}.fact_doanh_thu_moi_nhat f
    JOIN ${S}.dim_spu d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
      AND d.phan_khuc IN ('Bán chạy','Bán thường','Bán chậm','Tồn xấu','Hàng mới')
    GROUP BY 1 ORDER BY dt DESC`)
  ).rows;

  const trungGian = (
    await c.query(`
    SELECT coalesce(sum(f.order_revenue_vnd),0)::float dt
    FROM ${S}.fact_doanh_thu_moi_nhat f
    JOIN ${S}.dim_spu d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
      AND d.phan_khuc = 'Mã trung gian'`)
  ).rows[0];

  const daily = (
    await c.query(`
    SELECT ngay::text, sum(order_revenue_vnd)::float dt
    FROM ${S}.fact_doanh_thu_moi_nhat
    WHERE ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
    GROUP BY 1 ORDER BY 1`)
  ).rows;

  const ton = (
    await c.query(`
    WITH dmax AS (SELECT max(ngay) d FROM ${S}.fact_ton_kho_moi_nhat WHERE ngay <= DATE '2026-11-19')
    SELECT d.phan_khuc,
           sum(t.inventory_qty)::float sl,
           sum(t.inventory_value)::float gt
    FROM ${S}.fact_ton_kho_moi_nhat t
    JOIN dmax ON t.ngay = dmax.d
    JOIN ${S}.dim_spu d ON d.spu_key = t.spu_key
    WHERE coalesce(t.inventory_qty,0) <> 0
    GROUP BY 1 ORDER BY gt DESC`)
  ).rows;

  const tonXauKho = (
    await c.query(`
    WITH dmax AS (SELECT max(ngay) d FROM ${S}.fact_ton_kho_moi_nhat WHERE ngay <= DATE '2026-11-19')
    SELECT t.kho, sum(t.inventory_qty)::float sl, sum(t.inventory_value)::float gt
    FROM ${S}.fact_ton_kho_moi_nhat t
    JOIN dmax ON t.ngay = dmax.d
    JOIN ${S}.dim_spu d ON d.spu_key = t.spu_key
    WHERE d.phan_khuc = 'Tồn xấu' AND coalesce(t.inventory_qty,0) <> 0
    GROUP BY 1 ORDER BY 1`)
  ).rows;

  const po = (
    await c.query(`
    SELECT
      count(DISTINCT ma_po)::int so_po,
      coalesce(sum(so_luong_con_thieu),0)::float dang_ve,
      coalesce(sum(so_luong_con_thieu) FILTER (WHERE han_giao < DATE '2026-11-19'),0)::float qua_han,
      coalesce(sum(so_luong_con_thieu) FILTER (WHERE han_giao >= DATE '2026-11-19' AND han_giao <= DATE '2026-11-19'+7),0)::float sap_han
    FROM ${S}.fact_po`)
  ).rows[0];

  const topSp = (
    await c.query(`
    SELECT f.spu_key, left(coalesce(d.ten_san_pham,''),40) ten, d.phan_khuc,
           sum(f.order_revenue_vnd)::float dt, sum(f.so_luong)::float sl
    FROM ${S}.fact_doanh_thu_moi_nhat f
    JOIN ${S}.dim_spu d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
    GROUP BY 1,2,3 ORDER BY dt DESC LIMIT 8`)
  ).rows;

  const chung = (
    await c.query(`
    SELECT coalesce(nullif(d.chung_loai,''),'(trống)') nhom,
           sum(f.order_revenue_vnd)::float dt
    FROM ${S}.fact_doanh_thu_moi_nhat f
    JOIN ${S}.dim_spu d ON d.spu_key = f.spu_key
    WHERE f.ngay BETWEEN DATE '2026-11-01' AND DATE '2026-11-19'
    GROUP BY 1 ORDER BY dt DESC LIMIT 6`)
  ).rows;

  const avg = kpi.dt / daily.length;
  console.log(JSON.stringify({ kpi, avg_ngay: avg, byKho, byPk, trungGian, ton, tonXauKho, po, topSp, chung, daily_tail: daily.slice(-5) }, null, 2));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
