// Seed snapshot đầu tháng (để KPI đẩy tồn tháng này có số ngay, không chờ 15 ngày).
// Dùng list Tồn xấu hiện tại (đã siết Hàng mới), gắn ngay_snapshot = ngày 1 tháng của ngày tồn chốt.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = {};
fs.readFileSync(path.join(__dirname, '..', 'be', '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const SCHEMA = env.DB_SCHEMA || 'global';
const fq = (t) => `"${SCHEMA}"."${t}"`;

(async () => {
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ref = await c.query(`SELECT max(ngay)::date AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}`);
  const ngayChot = ref.rows[0].ngay_chot;
  const dauThang = await c.query(`SELECT date_trunc('month', $1::date)::date AS d`, [ngayChot]);
  const snap = dauThang.rows[0].d;

  // Tồn tại ngày gần nhất ≤ đầu tháng (nếu không có thì dùng tồn hiện tại làm proxy)
  const tonNgay = await c.query(
    `SELECT max(ngay)::date AS d FROM ${fq('fact_ton_kho_moi_nhat')} WHERE ngay <= $1`,
    [snap]
  );
  const ngayTon = tonNgay.rows[0].d || ngayChot;

  const ins = await c.query(
    `
    WITH ton AS (
      SELECT t.spu_key, sum(t.inventory_qty) AS ton_qty, sum(t.inventory_value) AS ton_value
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      WHERE t.ngay = $2
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
    SELECT $1::date, d.spu_key, d.ten_san_pham, t.ton_qty, t.ton_value, d.sl_30_ngay, fi.ngay_nhap_dau
    FROM ${fq('dim_spu')} d
    INNER JOIN ton t ON t.spu_key = d.spu_key
    LEFT JOIN first_import fi ON fi.spu_key = d.spu_key
    WHERE d.phan_khuc = 'Tồn xấu'
    ON CONFLICT (ngay_snapshot, spu_key) DO UPDATE SET
      ten_san_pham = EXCLUDED.ten_san_pham,
      ton_qty = EXCLUDED.ton_qty,
      ton_value = EXCLUDED.ton_value,
      sl_30_tai_chot = EXCLUDED.sl_30_tai_chot,
      ngay_nhap_dau = EXCLUDED.ngay_nhap_dau
    RETURNING spu_key`,
    [snap, ngayTon]
  );

  // Refresh view (đã có từ refresh trước)
  const tong = await c.query(
    `SELECT * FROM ${fq('vw_day_ton_xau_tong')} WHERE ngay_snapshot = $1`,
    [snap]
  );
  console.log(`Seed snapshot đầu tháng ${snap} (tồn @${ngayTon}): ${ins.rowCount} mã`);
  console.log(tong.rows[0] || '(chưa có view — chạy refresh_ton_xau.js)');
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
