/**
 * BanNhap / global_draft: chốt cohort tồn xấu theo ngày (đóng băng list).
 * Rule: 30 ngày 0 bán tới ngày chốt + còn tồn + loại hàng mới/mã TG.
 * Bán SAU ngày chốt = đẩy; không phân loại lại cohort.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const SCHEMA = 'global_draft';
const fq = (t) => `"${SCHEMA}"."${t}"`;

async function chotMotNgay(c, ngayChot) {
  const tonAt = (
    await c.query(
      `SELECT coalesce(max(ngay), $1::date)::date AS d
       FROM ${fq('fact_ton_kho_moi_nhat')} WHERE ngay <= $1::date`,
      [ngayChot]
    )
  ).rows[0].d;

  const ins = await c.query(
    `
    WITH ref AS (SELECT $1::date AS ngay_chot, $2::date AS ngay_ton),
    ban30 AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong), 0) AS sl_30n
      FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ref.ngay_chot - 29 AND ref.ngay_chot
      GROUP BY f.spu_key
    ),
    ton AS (
      SELECT t.spu_key,
             sum(t.inventory_qty) AS ton_qty,
             sum(t.inventory_value) AS ton_value
      FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_ton
      GROUP BY t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    first_import AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty, 0) <> 0) AS ngay_nhap_dau
      FROM ${fq('fact_ton_kho_moi_nhat')}
      GROUP BY spu_key
    )
    INSERT INTO ${fq('snapshot_ton_xau')}
      (ngay_snapshot, spu_key, ten_san_pham, ton_qty, ton_value, sl_30_tai_chot, ngay_nhap_dau)
    SELECT ref.ngay_chot, t.spu_key, coalesce(d.ten_san_pham, t.spu_key),
           t.ton_qty, t.ton_value, coalesce(b.sl_30n, 0), fi.ngay_nhap_dau
    FROM ton t
    CROSS JOIN ref
    LEFT JOIN ban30 b ON b.spu_key = t.spu_key
    LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = t.spu_key
    LEFT JOIN first_import fi ON fi.spu_key = t.spu_key
    WHERE coalesce(b.sl_30n, 0) = 0
      AND coalesce(d.loai_ma, 'Sản phẩm') = 'Sản phẩm'
      AND upper(replace(t.spu_key, ' ', '')) NOT LIKE '%MATRUNGGIANBAC%'
      AND NOT (
        (fi.ngay_nhap_dau IS NOT NULL AND fi.ngay_nhap_dau >= ref.ngay_chot - 29)
        OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.ngay_chot - 29)
      )
    ON CONFLICT (ngay_snapshot, spu_key) DO UPDATE SET
      ten_san_pham = EXCLUDED.ten_san_pham,
      ton_qty = EXCLUDED.ton_qty,
      ton_value = EXCLUDED.ton_value,
      sl_30_tai_chot = EXCLUDED.sl_30_tai_chot,
      ngay_nhap_dau = EXCLUDED.ngay_nhap_dau
    RETURNING spu_key`,
    [ngayChot, tonAt]
  );
  console.log(`  chốt ${ngayChot} (tồn @${tonAt}): ${ins.rowCount} mã`);
  return ins.rowCount;
}

async function rebuildView(c) {
  await c.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau_tong')}`);
  await c.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau_15ngay')}`);
  await c.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau')}`);
  await c.query(`
    CREATE VIEW ${fq('vw_day_ton_xau')} AS
    WITH snap AS (SELECT * FROM ${fq('snapshot_ton_xau')}),
    ban AS (
      SELECT s.ngay_snapshot, s.spu_key,
             coalesce(sum(f.so_luong), 0) AS sl_ban_sau_chot,
             coalesce(sum(f.order_revenue_vnd), 0) AS dt_sau_chot
      FROM snap s
      LEFT JOIN ${fq('fact_doanh_thu_moi_nhat')} f
        ON f.spu_key = s.spu_key AND f.ngay > s.ngay_snapshot
      GROUP BY s.ngay_snapshot, s.spu_key
    ),
    ton_hien AS (
      SELECT t.spu_key, sum(t.inventory_qty) AS ton_hien_tai, sum(t.inventory_value) AS gt_ton_hien_tai
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      WHERE t.ngay = (SELECT max(ngay) FROM ${fq('fact_ton_kho_moi_nhat')})
      GROUP BY t.spu_key
    )
    SELECT s.ngay_snapshot,
           (s.ngay_snapshot + 1) AS ngay_bat_dau_theo_doi,
           (SELECT max(ngay) FROM ${fq('fact_ton_kho_moi_nhat')}) AS ngay_kiem_tra,
           s.spu_key, s.ten_san_pham,
           s.ton_qty AS ton_luc_chot, s.ton_value AS gt_luc_chot,
           s.sl_30_tai_chot, s.ngay_nhap_dau,
           coalesce(b.sl_ban_sau_chot, 0) AS sl_ban_sau_chot,
           coalesce(b.dt_sau_chot, 0) AS dt_sau_chot,
           CASE
             WHEN coalesce(b.sl_ban_sau_chot, 0) > 0
               AND greatest(s.ton_qty - coalesce(b.sl_ban_sau_chot, 0), 0) = 0
               THEN 'Đã đẩy hết lô'
             WHEN coalesce(b.sl_ban_sau_chot, 0) > 0 THEN 'Đang đẩy'
             ELSE 'Chưa đẩy'
           END AS trang_thai_day,
           coalesce(th.ton_hien_tai, 0) AS ton_hien_tai,
           coalesce(th.gt_ton_hien_tai, 0) AS gt_ton_hien_tai,
           greatest(s.ton_qty - coalesce(b.sl_ban_sau_chot, 0), 0) AS sl_giam_ton
    FROM snap s
    LEFT JOIN ban b ON b.ngay_snapshot = s.ngay_snapshot AND b.spu_key = s.spu_key
    LEFT JOIN ton_hien th ON th.spu_key = s.spu_key`);
  console.log('vw_day_ton_xau rebuilt (multi-snapshot, ton còn lại lô = ton_chot - SL đẩy)');
}

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await c.query(`
    CREATE TABLE IF NOT EXISTS ${fq('snapshot_ton_xau')} (
      ngay_snapshot date NOT NULL,
      spu_key text NOT NULL,
      ten_san_pham text,
      ton_qty numeric,
      ton_value numeric,
      sl_30_tai_chot numeric,
      ngay_nhap_dau date,
      PRIMARY KEY (ngay_snapshot, spu_key)
    )`);

  await c.query(`DELETE FROM ${fq('snapshot_ton_xau')}`);

  const maxD = (await c.query(`SELECT max(ngay)::text AS d FROM ${fq('fact_ton_kho_moi_nhat')}`)).rows[0].d;
  const dates = ['2026-10-31', '2026-11-01', '2026-11-16'];
  if (maxD && !dates.includes(maxD)) dates.push(maxD);

  console.log(`Schema ${SCHEMA} | max ton ${maxD}`);
  for (const d of dates) {
    if (d <= maxD) await chotMotNgay(c, d);
  }

  await rebuildView(c);

  const sum = await c.query(`
    SELECT ngay_snapshot::text,
           count(*)::int AS so_ma,
           sum(ton_luc_chot)::float AS ton0,
           sum(sl_ban_sau_chot)::float AS sl_day,
           sum(dt_sau_chot)::float AS dt_day,
           sum(sl_giam_ton)::float AS ton_con_lai_sai_ten,
           count(*) FILTER (WHERE sl_ban_sau_chot > 0)::int AS ma_co_day
    FROM ${fq('vw_day_ton_xau')}
    GROUP BY 1 ORDER BY 1`);
  console.log('Tóm tắt cohort:');
  sum.rows.forEach((r) => console.log(' ', r));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
