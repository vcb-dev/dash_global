// Xuất CSV để team mở trên Google Sheet (File → Import), tự lọc theo mã.
// Chạy: node export_sheet.js
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
const OUT = path.join(__dirname, '..', 'output', 'google_sheet');

function toCsv(rows, cols) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return lines.join('\n');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const c = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1) Tiến độ đẩy tồn theo snapshot cố định
  const day = await c.query(`SELECT * FROM ${fq('vw_day_ton_xau')} ORDER BY ngay_snapshot DESC, spu_key`);
  fs.writeFileSync(
    path.join(OUT, 'day_ton_xau.csv'),
    toCsv(day.rows, [
      'ngay_snapshot', 'spu_key', 'ten_san_pham', 'ton_luc_chot', 'gt_luc_chot',
      'sl_ban_sau_chot', 'dt_sau_chot', 'ton_hien_tai', 'sl_giam_ton', 'ngay_nhap_dau',
    ]),
    'utf8'
  );

  const tong = await c.query(`SELECT * FROM ${fq('vw_day_ton_xau_tong')} ORDER BY ngay_snapshot DESC`);
  fs.writeFileSync(
    path.join(OUT, 'day_ton_xau_tong.csv'),
    toCsv(tong.rows, [
      'ngay_snapshot', 'so_ma', 'ton_luc_chot', 'gt_luc_chot',
      'sl_ban_sau_chot', 'dt_sau_chot', 'ton_hien_tai', 'sl_giam_ton',
    ]),
    'utf8'
  );

  // 2) Danh sách mã + phân khúc (để mọi người tự lọc)
  const dim = await c.query(`
    SELECT spu_key, spunew, ten_san_pham, chung_loai, loai_ma, phan_khuc, sl_30_ngay,
           ngay_tao_ma, ngay_chot_phan_khuc
    FROM ${fq('dim_spu')}
    ORDER BY phan_khuc, spu_key`);
  fs.writeFileSync(
    path.join(OUT, 'danh_sach_ma.csv'),
    toCsv(dim.rows, [
      'spu_key', 'spunew', 'ten_san_pham', 'chung_loai', 'loai_ma', 'phan_khuc',
      'sl_30_ngay', 'ngay_tao_ma', 'ngay_chot_phan_khuc',
    ]),
    'utf8'
  );

  // 3) PO còn thiếu theo mã
  const po = await c.query(`
    SELECT spu_key, ten_san_pham, ma_po, sku, so_luong_dat, so_luong_da_nhan, so_luong_con_thieu,
           han_giao, nha_cung_cap, team_dat_hang, ngay
    FROM ${fq('fact_po_moi_nhat')}
    WHERE coalesce(so_luong_con_thieu, 0) <> 0
    ORDER BY so_luong_con_thieu DESC, spu_key`);
  fs.writeFileSync(
    path.join(OUT, 'po_con_thieu.csv'),
    toCsv(po.rows, [
      'spu_key', 'ten_san_pham', 'ma_po', 'sku', 'so_luong_dat', 'so_luong_da_nhan',
      'so_luong_con_thieu', 'han_giao', 'nha_cung_cap', 'team_dat_hang', 'ngay',
    ]),
    'utf8'
  );

  // 4) Cảnh báo hàng thiếu mã / mã trung gian (không phân tích được)
  const warn = await c.query(`
    SELECT spu_key, ten_san_pham, loai_ma, phan_khuc,
           CASE
             WHEN upper(replace(spu_key,' ','')) LIKE '%MATRUNGGIANBAC%' THEN 'Mã trung gian — cần gán mã thật'
             WHEN spu_key IS NULL OR btrim(spu_key) = '' THEN 'Thiếu mã'
             WHEN ten_san_pham IS NULL OR btrim(ten_san_pham) = '' THEN 'Thiếu tên'
             ELSE 'Khác'
           END AS canh_bao
    FROM ${fq('dim_spu')}
    WHERE upper(replace(spu_key,' ','')) LIKE '%MATRUNGGIANBAC%'
       OR spu_key IS NULL OR btrim(coalesce(spu_key,'')) = ''
       OR ten_san_pham IS NULL OR btrim(coalesce(ten_san_pham,'')) = ''
    ORDER BY canh_bao, spu_key`);
  fs.writeFileSync(
    path.join(OUT, 'canh_bao_thieu_ma.csv'),
    toCsv(warn.rows, ['spu_key', 'ten_san_pham', 'loai_ma', 'phan_khuc', 'canh_bao']),
    'utf8'
  );

  // 5) Mục tiêu DT (điền tay trên Sheet rồi nạp lại nếu cần)
  const mt = await c.query(`SELECT thang, muc_tieu_dt, ghi_chu FROM ${fq('dim_muc_tieu')} ORDER BY thang`);
  fs.writeFileSync(
    path.join(OUT, 'muc_tieu_dt.csv'),
    toCsv(mt.rows.length ? mt.rows : [{ thang: '2026-11-01', muc_tieu_dt: '', ghi_chu: 'Điền mục tiêu tháng' }], [
      'thang', 'muc_tieu_dt', 'ghi_chu',
    ]),
    'utf8'
  );

  console.log(`Đã xuất ${OUT}`);
  console.log(`  day_ton_xau: ${day.rows.length} dòng | tong: ${tong.rows.length} snapshot`);
  console.log(`  danh_sach_ma: ${dim.rows.length} | po_con_thieu: ${po.rows.length} | cảnh báo: ${warn.rows.length}`);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
