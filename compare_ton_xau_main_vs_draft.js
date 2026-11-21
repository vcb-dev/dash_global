const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

async function tonXauByKho(c, schema, ngay) {
  const r = await c.query(
    `
    WITH ton AS (
      SELECT t.kho, t.spu_key, sum(t.inventory_qty) AS qty, sum(t.inventory_value) AS gt
      FROM "${schema}"."fact_ton_kho_moi_nhat" t
      WHERE t.ngay = $1::date
      GROUP BY t.kho, t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    )
    SELECT ton.kho,
           count(*)::int AS so_ma,
           sum(ton.qty)::float AS sl,
           sum(ton.gt)::float AS gt
    FROM ton
    JOIN "${schema}"."dim_spu" d ON d.spu_key = ton.spu_key
    WHERE d.phan_khuc = 'Tồn xấu'
    GROUP BY ton.kho
    ORDER BY ton.kho`,
    [ngay]
  );
  return r.rows;
}

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const s of ['global', 'global_draft']) {
    const maxd = await c.query(`SELECT max(ngay)::text AS d FROM "${s}"."fact_ton_kho_moi_nhat"`);
    const pk = await c.query(
      `SELECT phan_khuc, count(*)::int n FROM "${s}"."dim_spu" WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`
    );
    console.log(`\n=== ${s} | tồn max=${maxd.rows[0].d} ===`);
    console.log('phan_khuc:', pk.rows.map((r) => `${r.phan_khuc}=${r.n}`).join(', '));

    const now = await tonXauByKho(c, s, maxd.rows[0].d);
    console.log('Tồn xấu rolling @max:');
    now.forEach((r) => console.log(`  ${r.kho}: ${r.so_ma} mã | SL ${r.sl} | GT ${r.gt}`));

    const oct = await tonXauByKho(c, s, '2026-10-31');
    console.log('Tồn xấu rolling @31/10 (theo phan_khuc HIỆN TẠI của dim):');
    oct.forEach((r) => console.log(`  ${r.kho}: ${r.so_ma} mã | SL ${r.sl} | GT ${r.gt}`));
  }

  // Snapshot họp trên draft
  const snap = await c.query(`
    SELECT count(*)::int so_ma, sum(ton_luc_chot)::float sl, sum(gt_luc_chot)::float gt,
           min(ngay_snapshot)::text snap, min(ngay_bat_dau_theo_doi)::text tu
    FROM global_draft.vw_day_ton_xau`);
  console.log('\n=== global_draft list họp (vw_day_ton_xau) ===');
  console.log(snap.rows[0]);

  const diff = await c.query(`
    WITH snap AS (SELECT spu_key, ton_qty FROM global_draft.snapshot_ton_xau),
    main AS (
      SELECT d.spu_key
      FROM global.dim_spu d
      WHERE d.phan_khuc = 'Tồn xấu'
    ),
    ton_main AS (
      SELECT t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t
      WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho_moi_nhat)
      GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    )
    SELECT
      (SELECT count(*) FROM snap)::int AS snap_n,
      (SELECT count(*) FROM main m JOIN ton_main t ON t.spu_key = m.spu_key)::int AS main_ton_xau_con_ton,
      (SELECT count(*) FROM snap s JOIN main m ON m.spu_key = s.spu_key)::int AS giao,
      (SELECT count(*) FROM snap s LEFT JOIN main m ON m.spu_key = s.spu_key WHERE m.spu_key IS NULL)::int AS chi_snap,
      (SELECT count(*) FROM main m JOIN ton_main t ON t.spu_key = m.spu_key
        LEFT JOIN snap s ON s.spu_key = m.spu_key WHERE s.spu_key IS NULL)::int AS chi_main`);
  console.log('So list họp draft vs Tồn xấu rolling global (còn tồn):', diff.rows[0]);

  const chiMain = await c.query(`
    WITH snap AS (SELECT spu_key FROM global_draft.snapshot_ton_xau),
    main AS (
      SELECT d.spu_key, d.ten_san_pham, d.sl_30_ngay, d.ngay_tao_ma::text
      FROM global.dim_spu d
      WHERE d.phan_khuc = 'Tồn xấu'
    ),
    ton AS (
      SELECT t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t
      WHERE t.ngay = (SELECT max(ngay) FROM global.fact_ton_kho_moi_nhat)
      GROUP BY t.spu_key HAVING sum(t.inventory_qty) <> 0
    )
    SELECT m.spu_key, left(coalesce(m.ten_san_pham,''),40) ten, m.sl_30_ngay, ton.qty, m.ngay_tao_ma
    FROM main m
    JOIN ton ON ton.spu_key = m.spu_key
    LEFT JOIN snap s ON s.spu_key = m.spu_key
    WHERE s.spu_key IS NULL
    ORDER BY ton.qty DESC
    LIMIT 15`);
  console.log('Mẫu chỉ rolling bản chính, không nằm list họp:');
  chiMain.rows.forEach((r) => console.log(`  ${r.spu_key} | SL tồn ${r.qty} | sl30=${r.sl_30_ngay} | tạo ${r.ngay_tao_ma} | ${r.ten}`));

  // Reconstruct: nếu chốt 31/10 bằng rule hiện tại trên global, SL tồn theo kho = ?
  const recon = await c.query(`
    WITH ref AS (SELECT DATE '2026-10-31' AS ngay_chot),
    ban30 AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.ngay_chot
      GROUP BY t.kho, t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    first_import AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty,0)<>0) AS ngay_nhap_dau
      FROM global.fact_ton_kho_moi_nhat GROUP BY spu_key
    ),
    dim AS (SELECT spu_key, loai_ma, ngay_tao_ma FROM global.dim_spu)
    SELECT ton.kho, count(*)::int so_ma, sum(ton.qty)::float sl
    FROM ton
    CROSS JOIN ref
    LEFT JOIN ban30 b ON b.spu_key = ton.spu_key
    LEFT JOIN dim d ON d.spu_key = ton.spu_key
    LEFT JOIN first_import fi ON fi.spu_key = ton.spu_key
    WHERE coalesce(b.sl,0)=0
      AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
      AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
      AND NOT (
        (fi.ngay_nhap_dau IS NOT NULL AND fi.ngay_nhap_dau >= ref.ngay_chot - 29)
        OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.ngay_chot - 29)
      )
    GROUP BY ton.kho
    ORDER BY 1`);
  console.log('\nReconstruct list họp @31/10 trên global (rule siết Hàng mới), tồn theo kho:');
  recon.rows.forEach((r) => console.log(`  ${r.kho}: ${r.so_ma} mã | SL ${r.sl}`));
  const sum = recon.rows.reduce((a, r) => a + r.sl, 0);
  console.log('  TOTAL SL=', sum);

  // Rule CŨ không loại hàng mới
  const old = await c.query(`
    WITH ref AS (SELECT DATE '2026-10-31' AS ngay_chot),
    ban30 AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong),0) sl
      FROM global.fact_doanh_thu_moi_nhat f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.kho, t.spu_key, sum(t.inventory_qty) qty
      FROM global.fact_ton_kho_moi_nhat t, ref
      WHERE t.ngay = ref.ngay_chot
      GROUP BY t.kho, t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    dim AS (SELECT spu_key, loai_ma FROM global.dim_spu)
    SELECT ton.kho, count(*)::int so_ma, sum(ton.qty)::float sl
    FROM ton
    LEFT JOIN ban30 b ON b.spu_key = ton.spu_key
    LEFT JOIN dim d ON d.spu_key = ton.spu_key
    WHERE coalesce(b.sl,0)=0
      AND coalesce(d.loai_ma,'Sản phẩm')='Sản phẩm'
      AND upper(replace(ton.spu_key,' ','')) NOT LIKE '%MATRUNGGIANBAC%'
    GROUP BY ton.kho ORDER BY 1`);
  console.log('Rule CŨ @31/10 (không loại Hàng mới):');
  old.rows.forEach((r) => console.log(`  ${r.kho}: ${r.so_ma} mã | SL ${r.sl}`));
  console.log('  TOTAL SL=', old.rows.reduce((a, r) => a + r.sl, 0));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
