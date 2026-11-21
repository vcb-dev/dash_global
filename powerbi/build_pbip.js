// Sinh dự án Power BI (.pbip, TMDL) kết nối Supabase schema global.
// Chạy: node build_pbip.js  -> mở Pancake_Supabase.pbip bằng Power BI Desktop.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = 'Pancake_Supabase';
const SERVER = 'aws-0-ap-southeast-1.pooler.supabase.com:5432';
const DATABASE = 'postgres';
const SCHEMA = 'global';
const ROOT = __dirname;
const SM = path.join(ROOT, `${NAME}.SemanticModel`);
const RP = path.join(ROOT, `${NAME}.Report`);

const T = '\t';
const uuid = () => crypto.randomUUID();
const q = (s) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`);

const TYPE = {
  date: { dt: 'dateTime', m: 'type date', fmt: 'dd/MM/yyyy' },
  text: { dt: 'string', m: 'type text' },
  integer: { dt: 'int64', m: 'Int64.Type', fmt: '#,0' },
  bigint: { dt: 'int64', m: 'Int64.Type', fmt: '#,0' },
  numeric: { dt: 'double', m: 'type number', fmt: '#,0' },
  boolean: { dt: 'boolean', m: 'type logical' },
};

// view/bảng nguồn -> tên bảng trong Power BI; cột lan_tai bỏ đi vì view *_moi_nhat đã lọc lần tải mới nhất
const TABLES = [
  {
    name: 'dim_date', source: 'dim_date', isDate: true,
    cols: [['ngay', 'date'], ['nam', 'integer'], ['quy', 'text'], ['thang', 'integer'], ['ky_bao_cao', 'text'],
      ['ten_thang', 'text'], ['ngay_trong_thang', 'integer'], ['so_ngay_thang', 'integer'], ['cuoi_thang', 'date'],
      ['la_cuoi_thang', 'integer'], ['thu', 'text'], ['thu_so', 'integer'], ['tuan_iso', 'integer'], ['ngay_chot_tuan', 'date']],
  },
  { name: 'dim_kho', source: 'dim_kho', cols: [['kho', 'text'], ['kho_id', 'text'], ['ma_quoc_gia', 'text']] },
  {
    name: 'dim_spu', source: 'dim_spu',
    cols: [['spu_key', 'text'], ['ten_san_pham', 'text'], ['chung_loai', 'text'], ['loai_ma', 'text'], ['ngay_tao_ma', 'date'],
      ['ma_cu_moi', 'text'], ['trong_danh_muc', 'text'], ['spu_goc', 'text'], ['chung_loai_pos', 'text'],
      ['phan_khuc', 'text'], ['sl_30_ngay', 'numeric'], ['ngay_chot_phan_khuc', 'date'], ['spunew', 'text']],
    measures: [
      // Đếm qua fact để slicer kho/ngày làm thay đổi số (filter không chảy ngược lên dim)
      ['Số SPU', 'VAR ban = CALCULATETABLE(VALUES(fact_doanh_thu[spu_key])) VAR ton = CALCULATETABLE(VALUES(fact_ton_kho[spu_key])) RETURN COUNTROWS(DISTINCT(UNION(ban, ton)))', '#,0'],
      ['Số SPU bán', 'DISTINCTCOUNT(fact_doanh_thu[spu_key])', '#,0'],
      ['Số SPU còn tồn', 'VAR d = MAX(fact_ton_kho[ngay]) RETURN CALCULATE(DISTINCTCOUNT(fact_ton_kho[spu_key]), fact_ton_kho[ngay] = d, fact_ton_kho[inventory_qty] <> 0)', '#,0'],
      ['Số SPU theo phân khúc', 'CALCULATE([Số SPU], NOT ISBLANK(dim_spu[phan_khuc]))', '#,0'],
    ],
  },
  {
    name: 'fact_doanh_thu', source: 'fact_doanh_thu_moi_nhat', drop: ['lan_tai'],
    cols: [['ngay', 'date'], ['kho', 'text'], ['sku', 'text'], ['spu_key', 'text'], ['size', 'text'], ['don_chot', 'integer'],
      ['so_luong', 'numeric'], ['order_revenue_vnd', 'numeric'], ['revenue_truoc_hoan', 'numeric'], ['doanh_thu_hoan', 'numeric']],
    measures: [
      ['Doanh thu', 'SUM(fact_doanh_thu[order_revenue_vnd])', '#,0'],
      ['Doanh thu trước hoàn', 'SUM(fact_doanh_thu[revenue_truoc_hoan])', '#,0'],
      ['Doanh thu hoàn', 'SUM(fact_doanh_thu[doanh_thu_hoan])', '#,0'],
      ['Đơn chốt', 'SUM(fact_doanh_thu[don_chot])', '#,0'],
      ['Số lượng bán', 'SUM(fact_doanh_thu[so_luong])', '#,0'],
      ['Số dòng mã', 'COUNTROWS(fact_doanh_thu)', '#,0'],
      ['Giá trị TB/đơn', "DIVIDE([Doanh thu], [Đơn chốt])", '#,0'],
      ['Doanh thu MTD', "TOTALMTD([Doanh thu], dim_date[ngay])", '#,0'],
      ['Đơn chốt MTD', "TOTALMTD([Đơn chốt], dim_date[ngay])", '#,0'],
      ['Tỷ trọng doanh thu', "DIVIDE([Doanh thu], CALCULATE([Doanh thu], ALLSELECTED(dim_spu)))", '0.0%'],
      ['Benchmark DT/ngày', 'AVERAGEX(ALLSELECTED(dim_date[ngay]), CALCULATE([Doanh thu]))', '#,0'],
      // So sánh: mục tiêu + tháng trước + TB ngày (Benchmark)
      ['Doanh thu tháng trước', 'CALCULATE([Doanh thu], DATEADD(dim_date[ngay], -1, MONTH))', '#,0'],
      ['% vs tháng trước', 'DIVIDE([Doanh thu] - [Doanh thu tháng trước], [Doanh thu tháng trước])', '0.0%'],
      ['Mục tiêu DT', 'LOOKUPVALUE(dim_muc_tieu[muc_tieu_dt], dim_muc_tieu[thang], DATE(YEAR(MIN(dim_date[ngay])), MONTH(MIN(dim_date[ngay])), 1))', '#,0'],
      ['% vs mục tiêu', 'DIVIDE([Doanh thu], [Mục tiêu DT])', '0.0%'],
      ['⚠ DT mã trung gian', 'CALCULATE([Doanh thu], dim_spu[phan_khuc] = "Mã trung gian")', '#,0'],
    ],
  },
  {
    name: 'dim_muc_tieu', source: 'dim_muc_tieu',
    cols: [['thang', 'date'], ['muc_tieu_dt', 'numeric'], ['ghi_chu', 'text']],
  },
  {
    // Snapshot list tồn xấu cố định + tiến độ đẩy sau ngày chốt
    name: 'day_ton_xau', source: 'vw_day_ton_xau',
    cols: [
      ['ngay_snapshot', 'date'], ['spu_key', 'text'], ['ten_san_pham', 'text'],
      ['ton_luc_chot', 'numeric'], ['gt_luc_chot', 'numeric'], ['sl_30_tai_chot', 'numeric'], ['ngay_nhap_dau', 'date'],
      ['sl_ban_sau_chot', 'numeric'], ['dt_sau_chot', 'numeric'],
      ['ton_hien_tai', 'numeric'], ['gt_ton_hien_tai', 'numeric'], ['sl_giam_ton', 'numeric'],
    ],
    measures: [
      ['SL đẩy tồn (snapshot)', 'SUM(day_ton_xau[sl_ban_sau_chot])', '#,0'],
      ['DT đẩy tồn (snapshot)', 'SUM(day_ton_xau[dt_sau_chot])', '#,0'],
      ['Tồn lúc chốt', 'SUM(day_ton_xau[ton_luc_chot])', '#,0'],
      ['Tồn hiện (snapshot)', 'SUM(day_ton_xau[ton_hien_tai])', '#,0'],
      ['Số mã tồn xấu chốt', 'DISTINCTCOUNT(day_ton_xau[spu_key])', '#,0'],
    ],
  },
  {
    name: 'fact_ton_kho', source: 'fact_ton_kho_moi_nhat', drop: ['lan_tai'],
    cols: [['ngay', 'date'], ['kho', 'text'], ['sku', 'text'], ['spu_key', 'text'], ['size', 'text'], ['begin_qty', 'numeric'],
      ['import_qty', 'numeric'], ['sell_export_qty', 'numeric'], ['inventory_qty', 'numeric'], ['inventory_value', 'numeric']],
    measures: [
      ['Tồn cuối kỳ (SL)', 'VAR d = MAX(fact_ton_kho[ngay]) RETURN CALCULATE(SUM(fact_ton_kho[inventory_qty]), dim_date[ngay] = d)', '#,0'],
      ['Giá trị tồn cuối kỳ', 'VAR d = MAX(fact_ton_kho[ngay]) RETURN CALCULATE(SUM(fact_ton_kho[inventory_value]), dim_date[ngay] = d)', '#,0'],
      ['Nhập kho', 'SUM(fact_ton_kho[import_qty])', '#,0'],
      ['Xuất bán', 'SUM(fact_ton_kho[sell_export_qty])', '#,0'],
    ],
  },
  {
    name: 'fact_po', source: 'fact_po_moi_nhat', drop: ['lan_tai'],
    cols: [
      ['ngay', 'date'], ['ma_po', 'text'], ['loai_don', 'text'], ['trang_thai', 'text'],
      ['ngay_tao', 'date'], ['ngay_dat', 'date'], ['han_giao', 'date'],
      ['nha_cung_cap', 'text'], ['ma_ncc', 'text'], ['nguoi_tao', 'text'], ['nguoi_phu_trach', 'text'],
      ['team_dat_hang', 'text'], ['ghi_chu_po', 'text'],
      ['sku', 'text'], ['spu_key', 'text'], ['ten_san_pham', 'text'], ['ma_sp_goc', 'text'], ['phan_loai_bien_the', 'text'],
      ['so_luong_dat', 'numeric'], ['so_luong_da_nhan', 'numeric'], ['so_luong_con_thieu', 'numeric'],
      ['thong_so_ky_thuat', 'text'],
    ],
    measures: [
      ['Hàng đang về', 'SUM(fact_po[so_luong_con_thieu])', '#,0'],
      ['SL đặt PO', 'SUM(fact_po[so_luong_dat])', '#,0'],
      ['SL đã nhận PO', 'SUM(fact_po[so_luong_da_nhan])', '#,0'],
      ['Số dòng PO', 'COUNTROWS(fact_po)', '#,0'],
      ['Số PO', 'DISTINCTCOUNT(fact_po[ma_po])', '#,0'],
      ['Số ngày tới ETA', 'VAR eta = MAX(fact_po[han_giao]) RETURN IF(ISBLANK(eta), BLANK(), DATEDIFF(TODAY(), eta, DAY))', '#,0'],
      // Flag ETA = calculated column trong fact_po.tmdl (không tạo measure trùng tên)
      ['SL quá hạn', 'CALCULATE([Hàng đang về], fact_po[han_giao] < TODAY())', '#,0'],
      ['SL sắp đến hạn', 'CALCULATE([Hàng đang về], fact_po[han_giao] >= TODAY() && fact_po[han_giao] <= TODAY() + 7)', '#,0'],
      ['SL còn hạn', 'CALCULATE([Hàng đang về], fact_po[han_giao] > TODAY() + 7)', '#,0'],
      ['Dòng quá hạn', 'CALCULATE([Số dòng PO], fact_po[han_giao] < TODAY())', '#,0'],
      ['Gợi ý', 'VAR pk = SELECTEDVALUE(dim_spu[phan_khuc]) VAR po = [Hàng đang về] VAR gt = [Giá trị tồn cuối kỳ] RETURN SWITCH(TRUE(), pk = "Bán chạy" && po > 0, "Ưu tiên nhận/QC/lên kệ", pk = "Bán chạy", "Giữ stock — cân nhắc đặt nếu thiếu", pk = "Tồn xấu" && gt > 0, "Xả tồn / cắt đặt", pk = "Bán chậm" && gt > 0, "Theo dõi — hạn chế nhập", pk = "Bán thường", "Duy trì tồn tiêu chuẩn", BLANK())', null],
    ],
  },
];

const RELATIONSHIPS = [
  ['fact_doanh_thu', 'ngay', 'dim_date', 'ngay'],
  ['fact_doanh_thu', 'kho', 'dim_kho', 'kho'],
  ['fact_doanh_thu', 'spu_key', 'dim_spu', 'spu_key'],
  ['fact_ton_kho', 'ngay', 'dim_date', 'ngay'],
  ['fact_ton_kho', 'kho', 'dim_kho', 'kho'],
  ['fact_ton_kho', 'spu_key', 'dim_spu', 'spu_key'],
  // PO nối dim qua SPU; han_giao dùng làm cột/trục (không ép quan hệ dim_date để slicer ngày doanh thu không lọc nhầm PO)
  ['fact_po', 'spu_key', 'dim_spu', 'spu_key'],
  ['day_ton_xau', 'spu_key', 'dim_spu', 'spu_key'],
];

function tableTmdl(t) {
  const L = [`table ${q(t.name)}`, `${T}lineageTag: ${uuid()}`];
  if (t.isDate) L.push(`${T}dataCategory: Time`);
  L.push('');
  for (const [name, expr, fmt] of t.measures || []) {
    L.push(`${T}measure ${q(name)} = ${expr}`);
    if (fmt) L.push(`${T}${T}formatString: ${fmt}`);
    L.push(`${T}${T}lineageTag: ${uuid()}`, '');
  }
  for (const [c, pgType] of t.cols) {
    const ty = TYPE[pgType];
    L.push(`${T}column ${q(c)}`, `${T}${T}dataType: ${ty.dt}`);
    if (t.isDate && c === 'ngay') L.push(`${T}${T}isKey`);
    if (ty.fmt) L.push(`${T}${T}formatString: ${ty.fmt}`);
    L.push(`${T}${T}lineageTag: ${uuid()}`, `${T}${T}summarizeBy: none`, `${T}${T}sourceColumn: ${c}`, '');
  }
  const typeList = t.cols.map(([c, p]) => `{"${c}", ${TYPE[p].m}}`).join(', ');
  const m = [
    'let',
    `    Source = PostgreSQL.Database("${SERVER}", "${DATABASE}"),`,
    `    Nguon = Source{[Schema="${SCHEMA}", Item="${t.source}"]}[Data],`,
    t.drop ? `    Bo = Table.RemoveColumns(Nguon, {${t.drop.map((d) => `"${d}"`).join(', ')}}),` : '    Bo = Nguon,',
    `    KieuDuLieu = Table.TransformColumnTypes(Bo, {${typeList}})`,
    'in',
    '    KieuDuLieu',
  ];
  L.push(`${T}partition ${q(t.name)} = m`, `${T}${T}mode: import`, `${T}${T}source =`);
  for (const line of m) L.push(`${T}${T}${T}${T}${line}`);
  L.push('');
  return L.join('\r\n');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

fs.rmSync(SM, { recursive: true, force: true });
fs.rmSync(RP, { recursive: true, force: true });

write(path.join(ROOT, `${NAME}.pbip`), JSON.stringify({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json',
  version: '1.0',
  artifacts: [{ report: { path: `${NAME}.Report` } }],
  settings: { enableAutoRecovery: true },
}, null, 2));

write(path.join(SM, 'definition.pbism'), JSON.stringify({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json',
  version: '4.0',
  settings: {},
}, null, 2));

write(path.join(SM, 'definition', 'database.tmdl'), 'database\r\n\tcompatibilityLevel: 1567\r\n');

write(path.join(SM, 'definition', 'model.tmdl'), [
  'model Model',
  '\tculture: en-US',
  '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
  '\tsourceQueryCulture: vi-VN',
  '\tdataAccessOptions',
  '\t\tlegacyRedirects',
  '\t\treturnErrorValuesAsNull',
  '',
  ...TABLES.map((t) => `ref table ${q(t.name)}`),
  '',
].join('\r\n'));

write(path.join(SM, 'definition', 'relationships.tmdl'), RELATIONSHIPS.map(([ft, fc, tt, tc]) => [
  `relationship ${uuid()}`,
  `\tfromColumn: ${q(ft)}.${q(fc)}`,
  `\ttoColumn: ${q(tt)}.${q(tc)}`,
  '',
].join('\r\n')).join('\r\n'));

for (const t of TABLES) write(path.join(SM, 'definition', 'tables', `${t.name}.tmdl`), tableTmdl(t));

write(path.join(RP, 'definition.pbir'), JSON.stringify({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json',
  version: '4.0',
  datasetReference: { byPath: { path: `../${NAME}.SemanticModel` } },
}, null, 2));

write(path.join(RP, 'report.json'), JSON.stringify({
  config: JSON.stringify({ version: '5.59', themeCollection: {}, activeSectionIndex: 0 }),
  layoutOptimization: 0,
  resourcePackages: [],
  sections: [{
    config: '{}', displayName: 'Trang 1', displayOption: 1, filters: '[]',
    height: 720, width: 1280, name: 'ReportSection', visualContainers: [],
  }],
}, null, 2));

console.log(`Đã tạo ${path.join(ROOT, NAME + '.pbip')}`);
