const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;
(async () => {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const before = await client.query(`SELECT count(*)::int n FROM ${fq('dim_spu')}`);
  const sample = await client.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban30 AS (
      SELECT f.spu_key FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
      HAVING sum(f.so_luong) <> 0 OR sum(f.don_chot) <> 0 OR sum(f.order_revenue_vnd) <> 0
    ),
    ton AS (
      SELECT t.spu_key FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_chot GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    )
    SELECT count(*)::int AS se_xoa FROM ${fq('dim_spu')} d
    WHERE NOT EXISTS (SELECT 1 FROM ban30 b WHERE b.spu_key = d.spu_key)
      AND NOT EXISTS (SELECT 1 FROM ton t WHERE t.spu_key = d.spu_key)`);
  console.log('dim trước=', before.rows[0].n, '| sẽ xóa (30d không bán + hết tồn)=', sample.rows[0].se_xoa);
  // apply prune from load_supabase by spawning requires - duplicate SQL
  const r = await client.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban AS (
      SELECT f.spu_key FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
      HAVING sum(f.so_luong) <> 0 OR sum(f.don_chot) <> 0 OR sum(f.order_revenue_vnd) <> 0
    ),
    ton AS (
      SELECT t.spu_key FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_chot GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    ),
    giu AS (SELECT spu_key FROM ban UNION SELECT spu_key FROM ton)
    DELETE FROM ${fq('dim_spu')} d
    WHERE NOT EXISTS (SELECT 1 FROM giu g WHERE g.spu_key = d.spu_key)
    RETURNING d.spu_key`);
  const after = await client.query(`SELECT count(*)::int n FROM ${fq('dim_spu')}`);
  const pk = await client.query(`SELECT phan_khuc, count(*) n FROM ${fq('dim_spu')} WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`);
  console.log('đã xóa=', r.rowCount, '| dim còn=', after.rows[0].n);
  console.log('phan_khuc:', pk.rows.map((x) => x.phan_khuc + '=' + x.n).join(', '));
  // refresh phan khuc after prune
  await client.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong), 0) AS sl_30n
      FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
    ),
    calc AS (
      SELECT d.spu_key, ref.ngay_chot, coalesce(b.sl_30n, 0) AS sl_30n,
        CASE
          WHEN upper(replace(d.spu_key, ' ', '')) LIKE '%MATRUNGGIANBAC%' THEN 'Mã trung gian'
          WHEN d.loai_ma IS DISTINCT FROM 'Sản phẩm' THEN 'Dịch vụ/Đặt hàng'
          WHEN coalesce(b.sl_30n, 0) < 0 THEN 'Khác'
          WHEN coalesce(b.sl_30n, 0) = 0 THEN 'Tồn xấu'
          WHEN coalesce(b.sl_30n, 0) < 10 THEN 'Bán chậm'
          WHEN coalesce(b.sl_30n, 0) <= 30 THEN 'Bán thường'
          ELSE 'Bán chạy'
        END AS phan_khuc
      FROM ${fq('dim_spu')} d CROSS JOIN ref
      LEFT JOIN ban b ON b.spu_key = d.spu_key
    )
    UPDATE ${fq('dim_spu')} d SET
      sl_30_ngay = c.sl_30n, ngay_chot_phan_khuc = c.ngay_chot, phan_khuc = c.phan_khuc
    FROM calc c WHERE d.spu_key = c.spu_key`);
  console.log('đã refresh phân khúc');
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
