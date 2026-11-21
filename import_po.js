// Đọc file Excel Danh sách PO → CSV fact_po → nạp Supabase.
// Hàng đang về = so_luong_con_thieu. Join dim_spu qua spu_key (cắt từ SKU / Mã SP gốc).
// Cách dùng: node import_po.js "d:\GLOBAL\Danh_Sach_PO_85_PO_2026-11-18.xlsx"
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const excelPath = process.argv[2] || 'd:/GLOBAL/Danh_Sach_PO_85_PO_2026-11-18.xlsx';
const OUT_DIR = path.join(__dirname, 'output');

function getSpuKey(spu, sku) {
  let x = String(spu || '').trim().replace(/,+$/, '').toUpperCase();
  if (!x) x = String(sku || '').trim().replace(/,+$/, '').toUpperCase();
  if (!x) return null;
  if (x.includes('|')) x = x.split('|')[0].trim();
  x = x.replace(/^VN-/, '');
  let prefix = '';
  const tl = x.match(/^TL-\s*(.+)$/);
  if (tl) { prefix = 'TL-'; x = tl[1].trim(); }
  if (x.includes('-')) x = x.split('-')[0].trim();
  return prefix + x || null;
}

function parseDate(v) {
  if (v == null || v === '' || v === '—') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function num(v) {
  if (v == null || v === '' || v === '—') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const snapFromName = path.basename(excelPath).match(/(\d{4}-\d{2}-\d{2})/);
const ngaySnapshot = snapFromName ? snapFromName[1] : new Date().toISOString().slice(0, 10);

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });

const cols = [
  'ngay', 'ma_po', 'loai_don', 'trang_thai', 'ngay_tao', 'ngay_dat', 'han_giao',
  'nha_cung_cap', 'ma_ncc', 'nguoi_tao', 'nguoi_phu_trach', 'team_dat_hang', 'ghi_chu_po',
  'sku', 'spu_key', 'ten_san_pham', 'ma_sp_goc', 'phan_loai_bien_the',
  'so_luong_dat', 'so_luong_da_nhan', 'so_luong_con_thieu', 'thong_so_ky_thuat',
];

const rows = [];
const dimExtra = new Map(); // spu_key → { ten, goc }
let boTeam = 0;
for (const r of raw) {
  // BI Global: chỉ lấy Team đặt hàng có chữ Global (vd. Viễn Chí Bảo Global)
  const team = String(r['Team đặt hàng'] || '').replace(/^—$/, '').trim();
  if (!/global/i.test(team)) { boTeam++; continue; }
  const sku = String(r['Mã SKU'] || '').trim();
  const goc = String(r['Mã SP gốc'] || '').trim();
  const spuKey = getSpuKey(goc, sku);
  if (!spuKey || !sku) continue;
  const ten = String(r['Tên sản phẩm'] || '').trim();
  rows.push({
    ngay: ngaySnapshot,
    ma_po: String(r['Mã PO'] || '').trim(),
    loai_don: String(r['Loại đơn (NK/SX)'] || '').trim(),
    trang_thai: String(r['Trạng thái'] || '').trim(),
    ngay_tao: parseDate(r['Ngày tạo']),
    ngay_dat: parseDate(r['Ngày đặt hàng']),
    han_giao: parseDate(r['Hạn giao (ETA)']),
    nha_cung_cap: String(r['Nhà cung cấp'] || '').trim(),
    ma_ncc: String(r['Mã NCC'] || '').trim(),
    nguoi_tao: String(r['Người tạo'] || '').trim(),
    nguoi_phu_trach: String(r['Người phụ trách'] || '').trim(),
    team_dat_hang: team,
    ghi_chu_po: String(r['Ghi chú PO'] || '').replace(/^—$/, '').trim(),
    sku,
    spu_key: spuKey,
    ten_san_pham: ten,
    ma_sp_goc: goc,
    phan_loai_bien_the: String(r['Phân loại / Biến thể'] || '').trim(),
    so_luong_dat: num(r['Số lượng đặt']),
    so_luong_da_nhan: num(r['Số lượng đã nhận']),
    so_luong_con_thieu: num(r['Số lượng còn thiếu']),
    thong_so_ky_thuat: String(r['Thông số kỹ thuật'] || '').trim(),
  });
  if (!dimExtra.has(spuKey)) dimExtra.set(spuKey, { ten, goc });
  else {
    const e = dimExtra.get(spuKey);
    if (!e.ten && ten) e.ten = ten;
    if (goc && !String(e.goc).split('|').includes(goc)) e.goc = [e.goc, goc].filter(Boolean).join('|');
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const tag = ngaySnapshot.replace(/-/g, '');
const outFile = path.join(OUT_DIR, `fact_po_${tag}.csv`);
const lines = [cols.join(',')];
for (const row of rows) lines.push(cols.map((c) => csvEscape(row[c])).join(','));
fs.writeFileSync(outFile, '\uFEFF' + lines.join('\n'), 'utf8');

const thieu = rows.reduce((s, r) => s + r.so_luong_con_thieu, 0);
console.log(`fact_po: ${rows.length} dòng Global → ${outFile} (đã bỏ ${boTeam} dòng team khác)`);
console.log(`  Snapshot ${ngaySnapshot} | SL còn thiếu (hàng đang về): ${thieu}`);
console.log(`  SPU unique: ${dimExtra.size}`);

// Bổ sung SPU chưa có trong dim_spu.csv (giữ chung_loai theo chữ cái đầu)
const dimFile = path.join(OUT_DIR, 'dim_spu.csv');
const chung = (k) => {
  const m = { N: 'Nhẫn', B: 'Bông tai', K: 'Kiềng', L: 'Lắc tay', D: 'Dây chuyền', G: 'Đá quý', M: 'Mặt dây', C: 'Charm', V: 'Vòng', O: 'Chốt bông tai' };
  return m[k[0]] || 'Các sản phẩm khác';
};
const loaiMa = (k) => (/^[A-Z]{1,2}\d/.test(k) ? 'Sản phẩm' : 'Khác/Dịch vụ');

if (fs.existsSync(dimFile)) {
  const { parse } = require('csv-parse/sync');
  const dimRows = parse(fs.readFileSync(dimFile, 'utf8').replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true });
  const have = new Set(dimRows.map((r) => r.spu_key));
  let added = 0;
  for (const [spuKey, info] of dimExtra) {
    if (have.has(spuKey)) continue;
    const lm = loaiMa(spuKey);
    dimRows.push({
      spu_key: spuKey,
      ten_san_pham: info.ten || '',
      chung_loai: lm === 'Sản phẩm' ? chung(spuKey) : 'Các sản phẩm khác',
      chung_loai_pos: '',
      loai_ma: lm,
      ngay_tao_ma: '',
      ma_cu_moi: 'Mã cũ',
      trong_danh_muc: 'Không',
      spu_goc: info.goc || spuKey,
      phan_khuc: '',
      sl_30_ngay: '',
      ngay_chot_phan_khuc: '',
    });
    have.add(spuKey);
    added++;
  }
  if (added) {
    const dcols = Object.keys(dimRows[0]);
    const dlines = [dcols.join(',')];
    for (const r of dimRows) dlines.push(dcols.map((c) => csvEscape(r[c] ?? '')).join(','));
    fs.writeFileSync(dimFile, '\uFEFF' + dlines.join('\n'), 'utf8');
    console.log(`dim_spu: +${added} SPU từ PO`);
  }
}

// Không kéo dim_date theo ETA PO (tháng 12…). Lịch chỉ theo kỳ doanh thu/tồn (9/2026 → hiện tại).

const load = spawnSync(process.execPath, [path.join(__dirname, 'load_supabase.js'), OUT_DIR], { stdio: 'inherit' });
process.exit(load.status || 0);
