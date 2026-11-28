// Quy trình (chỉ ghi global_draft khi chạy qua run_draft.js):
// 1) Ngày họp/chốt: list tồn xấu = còn tồn + 0 bán trong 30 ngày trước mốc (loại hàng mới).
// 2) Đo đẩy từ NGÀY SAU ngày chốt → realtime đến ngày data mới nhất (không cố định mùng 1).
//    → mã nào đã bán, SL/DT, còn tồn / đẩy hết chưa.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = process.env.DB_SCHEMA || env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;

// Ngày họp/chốt list (có thể đổi bằng SNAP_DATE=YYYY-MM-DD)
const SNAP = process.env.SNAP_DATE || '2026-10-31';

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const maxBan = await c.query(`SELECT max(ngay)::text AS d FROM ${fq('fact_doanh_thu_moi_nhat')}`);
  const maxTon = await c.query(`SELECT max(ngay)::text AS d FROM ${fq('fact_ton_kho_moi_nhat')}`);
  const CHECK = maxBan.rows[0].d; // realtime đến ngày data mới nhất
  const trackFromRow = await c.query(`SELECT ($1::date + 1)::text AS d`, [SNAP]);
  const TRACK_FROM = process.env.TRACK_FROM || trackFromRow.rows[0].d; // mặc định = ngày sau chốt
  console.log(`[${SCHEMA}] Chốt list ${SNAP} → đo đẩy từ ${TRACK_FROM} → ${CHECK}`);
  console.log(`Data bán đến ${CHECK}, tồn đến ${maxTon.rows[0].d}`);

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

  // Chỉ giữ 1 list họp hiện hành
  await c.query(`DELETE FROM ${fq('snapshot_ton_xau')}`);

  const ngayTon = await c.query(
    `SELECT coalesce(max(ngay), $1::date)::date AS d FROM ${fq('fact_ton_kho_moi_nhat')} WHERE ngay <= $1::date`,
    [SNAP]
  );
  const tonAt = ngayTon.rows[0].d;

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
      SELECT t.spu_key, sum(t.inventory_qty) AS ton_qty, sum(t.inventory_value) AS ton_value
      FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_ton
      GROUP BY t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    first_import AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty, 0) <> 0) AS ngay_nhap_dau
      FROM ${fq('fact_ton_kho_moi_nhat')}
      GROUP BY spu_key
    ),
    dim AS (
      SELECT DISTINCT ON (spu_key) spu_key, ten_san_pham, loai_ma, ngay_tao_ma
      FROM ${fq('dim_spu')}
      ORDER BY spu_key
    )
    INSERT INTO ${fq('snapshot_ton_xau')}
      (ngay_snapshot, spu_key, ten_san_pham, ton_qty, ton_value, sl_30_tai_chot, ngay_nhap_dau)
    SELECT ref.ngay_chot, t.spu_key, coalesce(d.ten_san_pham, t.spu_key),
           t.ton_qty, t.ton_value, coalesce(b.sl_30n, 0), fi.ngay_nhap_dau
    FROM ton t
    CROSS JOIN ref
    LEFT JOIN ban30 b ON b.spu_key = t.spu_key
    LEFT JOIN dim d ON d.spu_key = t.spu_key
    LEFT JOIN first_import fi ON fi.spu_key = t.spu_key
    WHERE coalesce(b.sl_30n, 0) = 0
      AND coalesce(d.loai_ma, 'Sản phẩm') = 'Sản phẩm'
      AND upper(replace(t.spu_key, ' ', '')) NOT LIKE '%MATRUNGGIANBAC%'
      AND NOT (
        (fi.ngay_nhap_dau IS NOT NULL AND fi.ngay_nhap_dau >= ref.ngay_chot - 29)
        OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ref.ngay_chot - 29)
      )
    RETURNING spu_key, ton_qty`,
    [SNAP, tonAt]
  );
  console.log(`List họp chốt ${SNAP} (tồn @${tonAt}): ${ins.rowCount} mã`);

  await c.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau_tong')}`);
  await c.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau')}`);

  // Theo dõi từ mùng 1 tháng sau → realtime (CHECK)
  await c.query(`
    CREATE VIEW ${fq('vw_day_ton_xau')} AS
    WITH s AS (
      SELECT * FROM ${fq('snapshot_ton_xau')} WHERE ngay_snapshot = DATE '${SNAP}'
    ),
    ban AS (
      SELECT s.spu_key,
             coalesce(sum(f.so_luong), 0) AS sl_ban_sau_chot,
             coalesce(sum(f.order_revenue_vnd), 0) AS dt_sau_chot
      FROM s
      LEFT JOIN ${fq('fact_doanh_thu_moi_nhat')} f
        ON f.spu_key = s.spu_key
       AND f.ngay >= DATE '${TRACK_FROM}'
       AND f.ngay <= DATE '${CHECK}'
      GROUP BY s.spu_key
    ),
    ton_hien AS (
      SELECT t.spu_key,
             sum(t.inventory_qty) AS ton_hien_tai,
             sum(t.inventory_value) AS gt_ton_hien_tai
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      WHERE t.ngay = (SELECT max(ngay) FROM ${fq('fact_ton_kho_moi_nhat')})
      GROUP BY t.spu_key
    )
    SELECT s.ngay_snapshot,
           DATE '${TRACK_FROM}' AS ngay_bat_dau_theo_doi,
           DATE '${CHECK}' AS ngay_kiem_tra,
           s.spu_key,
           s.ten_san_pham,
           s.ton_qty AS ton_luc_chot,
           s.ton_value AS gt_luc_chot,
           s.sl_30_tai_chot,
           s.ngay_nhap_dau,
           b.sl_ban_sau_chot,
           b.dt_sau_chot,
           CASE
             WHEN coalesce(b.sl_ban_sau_chot, 0) > 0 AND coalesce(th.ton_hien_tai, 0) = 0 THEN 'Đã đẩy hết'
             WHEN coalesce(b.sl_ban_sau_chot, 0) > 0 THEN 'Đang đẩy'
             ELSE 'Chưa đẩy'
           END AS trang_thai_day,
           coalesce(th.ton_hien_tai, 0) AS ton_hien_tai,
           coalesce(th.gt_ton_hien_tai, 0) AS gt_ton_hien_tai,
           greatest(s.ton_qty - coalesce(th.ton_hien_tai, 0), 0) AS sl_giam_ton
    FROM s
    LEFT JOIN ban b ON b.spu_key = s.spu_key
    LEFT JOIN ton_hien th ON th.spu_key = s.spu_key`);

  await c.query(`
    CREATE VIEW ${fq('vw_day_ton_xau_tong')} AS
    SELECT ngay_snapshot, ngay_bat_dau_theo_doi, ngay_kiem_tra,
           count(*)::int AS so_ma,
           count(*) FILTER (WHERE trang_thai_day = 'Đã đẩy hết')::int AS so_ma_day_het,
           count(*) FILTER (WHERE trang_thai_day = 'Đang đẩy')::int AS so_ma_dang_day,
           count(*) FILTER (WHERE trang_thai_day = 'Chưa đẩy')::int AS so_ma_chua_day,
           sum(ton_luc_chot) AS ton_luc_chot,
           sum(gt_luc_chot) AS gt_luc_chot,
           sum(sl_ban_sau_chot) AS sl_ban_sau_chot,
           sum(dt_sau_chot) AS dt_sau_chot,
           sum(ton_hien_tai) AS ton_hien_tai,
           sum(sl_giam_ton) AS sl_giam_ton
    FROM ${fq('vw_day_ton_xau')}
    GROUP BY ngay_snapshot, ngay_bat_dau_theo_doi, ngay_kiem_tra`);

  const tong = await c.query(`SELECT * FROM ${fq('vw_day_ton_xau_tong')}`);
  console.log('Realtime tổng:', tong.rows[0]);

  const mau = await c.query(`
    SELECT spu_key, ten_san_pham, ton_luc_chot, trang_thai_day, sl_ban_sau_chot, dt_sau_chot, ton_hien_tai
    FROM ${fq('vw_day_ton_xau')}
    ORDER BY
      CASE trang_thai_day WHEN 'Đã đẩy hết' THEN 0 WHEN 'Đang đẩy' THEN 1 ELSE 2 END,
      dt_sau_chot DESC
    LIMIT 15`);
  console.log('Mẫu:');
  mau.rows.forEach((r) => {
    console.log(
      `  ${r.trang_thai_day.padEnd(12)} ${r.spu_key} | chốt ${r.ton_luc_chot} | bán ${r.sl_ban_sau_chot} | DT ${r.dt_sau_chot} | tồn nay ${r.ton_hien_tai} | ${String(r.ten_san_pham || '').slice(0, 36)}`
    );
  });

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
