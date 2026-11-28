const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

async function countAsOf(c, schema, d, { hangMoi = true } = {}) {
  const r = await c.query(
    `
    WITH ref AS (SELECT $1::date AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong), 0) sl
      FROM ${schema}.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d - 29 AND ref.d
      GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key, sum(t.inventory_qty) qty
      FROM ${schema}.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d
      GROUP BY t.kho, t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    fi AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty, 0) <> 0) ngay_nhap
      FROM ${schema}.fact_ton_kho_moi_nhat
      GROUP BY spu_key
    )
    SELECT count(*)::int AS rows_kho,
           count(DISTINCT ton.spu_key)::int AS spu
    FROM ton
    CROSS JOIN ref
    JOIN ${schema}.dim_spu d ON d.spu_key = ton.spu_key
    LEFT JOIN ban b ON b.spu_key = ton.spu_key
    LEFT JOIN fi ON fi.spu_key = ton.spu_key
    WHERE coalesce(b.sl, 0) = 0
      AND coalesce(d.loai_ma, 'Sản phẩm') = 'Sản phẩm'
      AND upper(replace(ton.spu_key, ' ', '')) NOT LIKE '%MATRUNGGIANBAC%'
      AND (
        NOT $2::bool
        OR NOT (
          (fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d - 29)
          OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d - 29)
        )
      )`,
    [d, hangMoi]
  );
  return r.rows[0];
}

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const max = (await c.query(`SELECT max(ngay)::text m FROM global.fact_ton_kho_moi_nhat`)).rows[0].m;
  console.log('max ton', max);

  for (const d of ['2026-10-31', '2026-11-19', max]) {
    const a = await countAsOf(c, 'global', d, { hangMoi: true });
    const b = await countAsOf(c, 'global', d, { hangMoi: false });
    console.log(`@${d} siết Hàng mới:`, a, '| không siết:', b);
  }

  // pk hiện tại + tồn mọi ngày trong Oct (có dòng tồn)
  const anyOct = await c.query(`
    SELECT count(DISTINCT t.spu_key)::int spu,
           count(DISTINCT t.kho || '|' || t.spu_key)::int rows_kho
    FROM global.fact_ton_kho_moi_nhat t
    JOIN global.dim_spu d ON d.spu_key = t.spu_key AND d.phan_khuc = 'Tồn xấu'
    WHERE t.ngay BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
      AND coalesce(t.inventory_qty,0) <> 0`);
  console.log('pk hiện tại có tồn bất kỳ ngày Oct:', anyOct.rows[0]);

  // push cho xấu @31/10
  const push = await c.query(`
    WITH ref AS (SELECT DATE '2026-10-31' AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d-29 AND ref.d GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.spu_key FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    ),
    fi AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty,0)<>0) ngay_nhap
      FROM global.fact_ton_kho_moi_nhat GROUP BY spu_key
    ),
    list AS (
      SELECT ton.spu_key FROM ton
      CROSS JOIN ref
      JOIN global.dim_spu d ON d.spu_key = ton.spu_key
      LEFT JOIN ban b ON b.spu_key = ton.spu_key
      LEFT JOIN fi ON fi.spu_key = ton.spu_key
      WHERE coalesce(b.sl,0)=0
        AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
        AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
        AND NOT (
          (fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d-29)
          OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d-29)
        )
    )
    SELECT
      (SELECT count(*) FROM list)::int spu_xau_oct,
      (SELECT count(DISTINCT f.spu_key) FROM list l
         JOIN global.fact_doanh_thu_moi_nhat f ON f.spu_key=l.spu_key AND f.ngay > DATE '2026-10-31'
         WHERE coalesce(f.so_luong,0)<>0)::int spu_da_day,
      (SELECT coalesce(sum(f.so_luong),0)::float FROM list l
         JOIN global.fact_doanh_thu_moi_nhat f ON f.spu_key=l.spu_key AND f.ngay > DATE '2026-10-31') sl,
      (SELECT coalesce(sum(f.order_revenue_vnd),0)::float FROM list l
         JOIN global.fact_doanh_thu_moi_nhat f ON f.spu_key=l.spu_key AND f.ngay > DATE '2026-10-31') dt,
      (SELECT count(*) FROM list l
         JOIN global.fact_ton_kho_moi_nhat t ON t.spu_key=l.spu_key
         WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho_moi_nhat)
         GROUP BY l.spu_key HAVING sum(t.inventory_qty)=0)::int -- invalid
  `);
  console.log('cohort Oct + push (query1):', push.rows[0]);

  const tonNow = await c.query(`
    WITH ref AS (SELECT DATE '2026-10-31' AS d),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.d-29 AND ref.d GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.spu_key FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.d GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    ),
    fi AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty,0)<>0) ngay_nhap
      FROM global.fact_ton_kho_moi_nhat GROUP BY spu_key
    ),
    list AS (
      SELECT ton.spu_key FROM ton CROSS JOIN ref
      JOIN global.dim_spu d ON d.spu_key = ton.spu_key
      LEFT JOIN ban b ON b.spu_key = ton.spu_key
      LEFT JOIN fi ON fi.spu_key = ton.spu_key
      WHERE coalesce(b.sl,0)=0 AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
        AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
        AND NOT ((fi.ngay_nhap IS NOT NULL AND fi.ngay_nhap >= ref.d-29)
          OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.d-29))
    ),
    now AS (
      SELECT t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t
      WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho_moi_nhat)
      GROUP BY t.spu_key
    )
    SELECT
      count(*) FILTER (WHERE coalesce(n.qty,0)=0)::int het_ton,
      count(*) FILTER (WHERE coalesce(n.qty,0)>0)::int con_ton,
      count(*) FILTER (WHERE d.phan_khuc = 'Tồn xấu')::int van_xau,
      count(*) FILTER (WHERE d.phan_khuc IS DISTINCT FROM 'Tồn xấu')::int roi_xau
    FROM list l
    JOIN global.dim_spu d ON d.spu_key = l.spu_key
    LEFT JOIN now n ON n.spu_key = l.spu_key`);
  console.log('Cohort Oct giờ ra sao:', tonNow.rows[0]);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
