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

  for (const s of ['global', 'global_draft']) {
    const pk = await c.query(`
      SELECT phan_khuc, count(*)::int n FROM ${s}.dim_spu
      WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`);
    console.log(`\n=== ${s} phan_khuc ===`);
    console.log(pk.rows.map((r) => `${r.phan_khuc}=${r.n}`).join(' | '));

    const maxd = (await c.query(`SELECT max(ngay)::text d FROM ${s}.fact_ton_kho_moi_nhat`)).rows[0].d;

    const a = await c.query(`
      WITH ton AS (
        SELECT t.kho, t.spu_key, sum(t.inventory_qty) qty
        FROM ${s}.fact_ton_kho_moi_nhat t
        WHERE t.ngay = $1::date
        GROUP BY t.kho, t.spu_key HAVING sum(t.inventory_qty) <> 0
      )
      SELECT count(*)::int rows_kho,
             count(DISTINCT ton.spu_key)::int spu,
             sum(ton.qty)::float tong_sl
      FROM ton
      JOIN ${s}.dim_spu d ON d.spu_key = ton.spu_key
      WHERE d.phan_khuc = 'Tồn xấu'`, [maxd]);
    console.log(`pk=Tồn xấu + tồn @${maxd}:`, a.rows[0]);

    const b = await c.query(`
      SELECT count(*)::int rows_sku,
             count(DISTINCT t.spu_key)::int spu,
             sum(t.inventory_qty)::float tong_sl
      FROM ${s}.fact_ton_kho_moi_nhat t
      JOIN ${s}.dim_spu d ON d.spu_key = t.spu_key AND d.phan_khuc = 'Tồn xấu'
      WHERE t.ngay = $1::date AND coalesce(t.inventory_qty,0) <> 0`, [maxd]);
    console.log(`SKU-level dòng tồn:`, b.rows[0]);

    const snap = await c.query(`
      SELECT ngay_snapshot::text, count(*)::int so_ma, sum(ton_qty)::float tong_sl
      FROM ${s}.snapshot_ton_xau GROUP BY 1 ORDER BY 1`);
    console.log('snapshot:', snap.rows);
  }

  // Rule as-of 19/11 không loại hàng mới / có loại
  const rules = await c.query(`
    WITH ref AS (SELECT DATE '2026-11-19' AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d-29 AND ref.d GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d GROUP BY t.kho, t.spu_key HAVING sum(t.inventory_qty) <> 0
    ),
    fi AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty,0)<>0) ngay_nhap
      FROM global.fact_ton_kho_moi_nhat GROUP BY spu_key
    )
    SELECT
      count(*) FILTER (WHERE coalesce(b.sl,0)=0)::int rows_0ban,
      count(DISTINCT ton.spu_key) FILTER (WHERE coalesce(b.sl,0)=0)::int spu_0ban,
      sum(ton.qty) FILTER (WHERE coalesce(b.sl,0)=0)::float sl_0ban,
      count(*) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
      )::int rows_sp,
      count(DISTINCT ton.spu_key) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
      )::int spu_sp,
      sum(ton.qty) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
      )::float sl_sp,
      count(*) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
          AND NOT (
            (fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d-29)
            OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d-29)
          )
      )::int rows_siet,
      count(DISTINCT ton.spu_key) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
          AND NOT (
            (fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d-29)
            OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d-29)
          )
      )::int spu_siet,
      sum(ton.qty) FILTER (
        WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
          AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
          AND NOT (
            (fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d-29)
            OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d-29)
          )
      )::float sl_siet
    FROM ton
    CROSS JOIN ref
    LEFT JOIN ban b ON b.spu_key = ton.spu_key
    LEFT JOIN global.dim_spu d ON d.spu_key = ton.spu_key
    LEFT JOIN fi ON fi.spu_key = ton.spu_key`);
  console.log('\nAs-of 19/11 breakdown:', rules.rows[0]);

  // Hàng mới + Tồn xấu cùng 0 bán?
  const hm = await c.query(`
    SELECT d.phan_khuc, count(*)::int n, coalesce(sum(t.qty),0)::float sl
    FROM global.dim_spu d
    LEFT JOIN (
      SELECT spu_key, sum(inventory_qty) qty FROM global.fact_ton_kho_moi_nhat
      WHERE ngay = DATE '2026-11-19' GROUP BY spu_key HAVING sum(inventory_qty)<>0
    ) t ON t.spu_key = d.spu_key
    WHERE d.phan_khuc IN ('Tồn xấu','Hàng mới')
    GROUP BY 1`);
  console.log('Tồn xấu + Hàng mới còn tồn:', hm.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
