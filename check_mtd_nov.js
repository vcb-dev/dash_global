const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const S = env.DB_SCHEMA || 'global';
const fq = (t) => `"${S}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const range = await c.query(`
    SELECT min(ngay)::text AS min_d, max(ngay)::text AS max_d
    FROM ${fq('fact_doanh_thu_moi_nhat')}
    WHERE ngay >= DATE '2026-11-01'`);
  console.log('Kỳ DT tháng 11:', range.rows[0]);

  // Ưu tiên fact_don_kho nếu khớp POS; fallback fact_doanh_thu
  const donKho = await c.query(`
    SELECT coalesce(sum(don_chot),0)::bigint AS don_chot,
           coalesce(sum(order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(so_luong),0)::float AS sl,
           min(ngay)::text AS min_d, max(ngay)::text AS max_d
    FROM ${fq('fact_don_kho_moi_nhat')}
    WHERE ngay >= DATE '2026-11-01'`);
  console.log('fact_don_kho (tháng 11):', donKho.rows[0]);

  const dt = await c.query(`
    SELECT coalesce(sum(don_chot),0)::bigint AS don_chot,
           coalesce(sum(order_revenue_vnd),0)::bigint AS dt,
           coalesce(sum(so_luong),0)::float AS sl,
           count(DISTINCT spu_key)::int AS so_ma_ban
    FROM ${fq('fact_doanh_thu_moi_nhat')}
    WHERE ngay >= DATE '2026-11-01'`);
  console.log('fact_doanh_thu (tháng 11):', dt.rows[0]);

  const theoKho = await c.query(`
    SELECT kho,
           coalesce(sum(don_chot),0)::bigint AS don_chot,
           coalesce(sum(order_revenue_vnd),0)::bigint AS dt
    FROM ${fq('fact_doanh_thu_moi_nhat')}
    WHERE ngay >= DATE '2026-11-01'
    GROUP BY kho ORDER BY kho`);
  console.log('Theo kho (fact_doanh_thu):');
  theoKho.rows.forEach((r) => console.log(`  ${r.kho}: đơn ${r.don_chot} | DT ${Number(r.dt).toLocaleString('vi-VN')}`));

  // Mã mới: ưu tiên cột ma_cu_moi; đồng thời mã tạo trong tháng 11 / NewCodeDays
  const maMoi = await c.query(`
    WITH ban AS (
      SELECT DISTINCT spu_key
      FROM ${fq('fact_doanh_thu_moi_nhat')}
      WHERE ngay >= DATE '2026-11-01'
    ),
    ton AS (
      SELECT DISTINCT spu_key
      FROM ${fq('fact_ton_kho_moi_nhat')}
      WHERE ngay = (SELECT max(ngay) FROM ${fq('fact_ton_kho_moi_nhat')})
        AND coalesce(inventory_qty,0) <> 0
    )
    SELECT
      count(*) FILTER (WHERE d.ma_cu_moi = 'Mã mới')::int AS ma_moi_trong_dim,
      count(*) FILTER (WHERE d.ma_cu_moi = 'Mã mới' AND b.spu_key IS NOT NULL)::int AS ma_moi_co_ban_t11,
      count(*) FILTER (WHERE d.ngay_tao_ma >= DATE '2026-11-01')::int AS tao_ma_trong_t11,
      count(*) FILTER (WHERE d.ngay_tao_ma >= DATE '2026-11-01' AND b.spu_key IS NOT NULL)::int AS tao_t11_co_ban,
      count(*) FILTER (WHERE d.ngay_tao_ma >= DATE '2026-11-01' AND t.spu_key IS NOT NULL)::int AS tao_t11_con_ton
    FROM ${fq('dim_spu')} d
    LEFT JOIN ban b ON b.spu_key = d.spu_key
    LEFT JOIN ton t ON t.spu_key = d.spu_key`);
  console.log('Mã mới:', maMoi.rows[0]);

  const listMoi = await c.query(`
    SELECT d.spu_key, d.ten_san_pham, d.ngay_tao_ma::text, d.ma_cu_moi, d.phan_khuc,
           coalesce(sum(f.so_luong),0)::float AS sl_t11,
           coalesce(sum(f.order_revenue_vnd),0)::bigint AS dt_t11
    FROM ${fq('dim_spu')} d
    LEFT JOIN ${fq('fact_doanh_thu_moi_nhat')} f
      ON f.spu_key = d.spu_key AND f.ngay >= DATE '2026-11-01'
    WHERE d.ma_cu_moi = 'Mã mới'
    GROUP BY d.spu_key, d.ten_san_pham, d.ngay_tao_ma, d.ma_cu_moi, d.phan_khuc
    ORDER BY dt_t11 DESC, d.spu_key
    LIMIT 20`);
  console.log('Top mã mới (theo DT T11):');
  listMoi.rows.forEach((r) => {
    console.log(`  ${r.spu_key} | ${String(r.ten_san_pham||'').slice(0,40)} | tạo ${r.ngay_tao_ma} | SL ${r.sl_t11} | DT ${Number(r.dt_t11).toLocaleString('vi-VN')}`);
  });

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
