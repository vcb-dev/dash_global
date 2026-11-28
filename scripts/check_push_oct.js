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

  const pk = await c.query(`
    SELECT phan_khuc, count(*)::int n FROM global.dim_spu
    WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`);
  console.log('phan_khuc global:', pk.rows);

  // Tồn cuối kỳ kiểu PBI: MAX(ngay) trong slicer 1/10-31/10 trên fact_ton_kho đầy đủ?
  const raw = await c.query(`
    SELECT count(*)::int rows_kho, count(DISTINCT t.spu_key)::int spu
    FROM global.fact_ton_kho t
    JOIN global.dim_spu d ON d.spu_key = t.spu_key AND d.phan_khuc = 'Tồn xấu'
    WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho WHERE ngay BETWEEN DATE '2026-10-01' AND DATE '2026-10-31')
      AND coalesce(t.inventory_qty,0) <> 0`);
  console.log('fact_ton_kho (full) Oct:', raw.rows[0]);

  // SKU level?
  const sku = await c.query(`
    SELECT count(*)::int rows, count(DISTINCT t.sku)::int skus, count(DISTINCT t.spu_key)::int spus
    FROM global.fact_ton_kho_moi_nhat t
    JOIN global.dim_spu d ON d.spu_key = t.spu_key AND d.phan_khuc = 'Tồn xấu'
    WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho_moi_nhat WHERE ngay <= DATE '2026-10-31')
      AND coalesce(t.inventory_qty,0) <> 0`);
  console.log('SKU-level Oct xấu:', sku.rows[0]);

  // Có thể user đếm mọi mã 0 bán 30 ngày trong Oct không cần pk
  const zero = await c.query(`
    WITH ref AS (SELECT DATE '2026-10-31' AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d-29 AND ref.d GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d GROUP BY t.kho, t.spu_key HAVING sum(t.inventory_qty) <> 0
    )
    SELECT count(*)::int rows_kho, count(DISTINCT ton.spu_key)::int spu
    FROM ton LEFT JOIN ban b ON b.spu_key = ton.spu_key
    WHERE coalesce(b.sl,0)=0`);
  console.log('Mọi mã 0 bán @31/10 còn tồn (không lọc loai/hang moi):', zero.rows[0]);

  const zeroNov = await c.query(`
    WITH ref AS (SELECT DATE '2026-11-19' AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d-29 AND ref.d GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d GROUP BY t.kho, t.spu_key HAVING sum(t.inventory_qty) <> 0
    )
    SELECT count(*)::int rows_kho, count(DISTINCT ton.spu_key)::int spu
    FROM ton LEFT JOIN ban b ON b.spu_key = ton.spu_key
    WHERE coalesce(b.sl,0)=0`);
  console.log('Mọi mã 0 bán @19/11 còn tồn:', zeroNov.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
