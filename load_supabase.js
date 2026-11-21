// Nạp các file CSV trong output/ vào PostgreSQL (Supabase).
// Cách dùng: node load_supabase.js [đường_dẫn_thư_mục_output]
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parse } = require('csv-parse/sync');

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[^#=]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
// process.env.DB_SCHEMA ưu tiên (vd. node run_draft.js load_supabase.js → global_draft)
const SCHEMA = process.env.DB_SCHEMA || env.DB_SCHEMA || 'global';
const OUT_DIR = process.argv[2] || path.join(__dirname, 'output');

const TABLES = {
  dim_date: {
    columns: {
      ngay: 'date', nam: 'int', quy: 'text', thang: 'int', ky_bao_cao: 'text', ten_thang: 'text',
      ngay_trong_thang: 'int', so_ngay_thang: 'int', cuoi_thang: 'date', la_cuoi_thang: 'int',
      thu: 'text', thu_so: 'int', tuan_iso: 'int', ngay_chot_tuan: 'date',
    },
    key: ['ngay'],
    fullReplace: true,
  },
  dim_kho: {
    columns: { kho: 'text', kho_id: 'text', ma_quoc_gia: 'text' },
    key: ['kho'],
    fullReplace: true,
  },
  dim_spu: {
    columns: {
      spu_key: 'text', ten_san_pham: 'text', chung_loai: 'text', chung_loai_pos: 'text', loai_ma: 'text', ngay_tao_ma: 'date',
      ma_cu_moi: 'text', trong_danh_muc: 'text', spu_goc: 'text',
      // Phân khúc + SL 30 ngày gắn vào dim (không tách bảng riêng); nạp CSV có thể để trống, refresh sau khi có fact
      phan_khuc: 'text', sl_30_ngay: 'numeric', ngay_chot_phan_khuc: 'date',
      // spunew = mã_cũ-mã_mới (sheet mapping); không có mapping thì = spu_key
      spunew: 'text',
      // false = không bán trong tháng chốt & hết tồn — giữ row để join lịch sử (ma_cu_moi), không vào Tổng SPU
      active: 'boolean',
    },
    key: ['spu_key'],
    // Thay cả bảng mỗi lần nạp để không còn mã cũ còn dấu - (B9043-C004…) sau khi đã cắt
    fullReplace: true,
  },
  fact_doanh_thu: {
    columns: {
      ngay: 'date', kho: 'text', sku: 'text', spu_key: 'text', size: 'text', don_chot: 'int',
      so_luong: 'numeric', order_revenue_vnd: 'numeric', revenue_truoc_hoan: 'numeric', doanh_thu_hoan: 'numeric',
    },
    key: ['ngay', 'kho', 'sku'],
    versioned: true,
  },
  // Đơn chốt / DT theo ngày×kho (khớp POS Thống kê → Doanh thu). Không tách SKU.
  fact_don_kho: {
    columns: {
      ngay: 'date', kho: 'text', don_chot: 'int', so_luong: 'numeric',
      order_revenue_vnd: 'numeric', revenue_truoc_hoan: 'numeric', doanh_thu_hoan: 'numeric',
    },
    key: ['ngay', 'kho'],
    versioned: true,
  },
  fact_ton_kho: {
    columns: {
      ngay: 'date', kho: 'text', sku: 'text', spu_key: 'text', size: 'text', begin_qty: 'numeric',
      import_qty: 'numeric', sell_export_qty: 'numeric', inventory_qty: 'numeric', inventory_value: 'numeric',
    },
    key: ['ngay', 'kho', 'sku'],
    versioned: true,
  },
  // Snapshot danh sách PO: so_luong_con_thieu = hàng đang về. Join dim_spu qua spu_key.
  fact_po: {
    columns: {
      ngay: 'date', ma_po: 'text', loai_don: 'text', trang_thai: 'text',
      ngay_tao: 'date', ngay_dat: 'date', han_giao: 'date',
      nha_cung_cap: 'text', ma_ncc: 'text', nguoi_tao: 'text', nguoi_phu_trach: 'text',
      team_dat_hang: 'text', ghi_chu_po: 'text',
      sku: 'text', spu_key: 'text', ten_san_pham: 'text', ma_sp_goc: 'text', phan_loai_bien_the: 'text',
      so_luong_dat: 'numeric', so_luong_da_nhan: 'numeric', so_luong_con_thieu: 'numeric',
      thong_so_ky_thuat: 'text',
    },
    key: ['ngay', 'ma_po', 'sku'],
    versioned: true,
  },
};

const q = (id) => `"${id}"`;
const fq = (t) => `${q(SCHEMA)}.${q(t)}`;

// Bảng fact giữ mọi lần nạp (cột lan_tai); view <bảng>_moi_nhat = đúng 1 lần nạp mới nhất (cả file),
// không ghép nhiều kỳ cũ để tránh lẫn ngày ngoài khoảng (vd. kéo tới 18/10 nhưng vẫn thấy tháng 11).
async function ensureTable(client, name, def) {
  const cols = Object.entries(def.columns).map(([c, t]) => `${q(c)} ${t}`);
  const key = def.versioned ? ['lan_tai', ...def.key] : def.key;
  if (def.versioned) cols.unshift(`${q('lan_tai')} timestamptz NOT NULL`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${fq(name)} (${cols.join(', ')}, PRIMARY KEY (${key.map(q).join(', ')}))`);
  for (const [c, t] of Object.entries(def.columns)) {
    await client.query(`ALTER TABLE ${fq(name)} ADD COLUMN IF NOT EXISTS ${q(c)} ${t}`);
  }
  if (def.versioned) {
    await client.query(`CREATE OR REPLACE VIEW ${fq(`${name}_moi_nhat`)} AS
      SELECT f.* FROM ${fq(name)} f
      WHERE f.lan_tai = (
        SELECT max(l.lan_tai) FROM ${fq('lich_su_nap')} l WHERE l.bang = '${name}'
      )`);
  }
}

async function ensureLoadLog(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${fq('lich_su_nap')} (
    lan_tai timestamptz NOT NULL, bang text NOT NULL, tu_ngay date NOT NULL, den_ngay date NOT NULL,
    file text, so_dong int, PRIMARY KEY (lan_tai, bang, file))`);
}

function filesFor(name) {
  return fs.readdirSync(OUT_DIR)
    .filter((f) => f === `${name}.csv` || (f.startsWith(`${name}_`) && f.endsWith('.csv')))
    .map((f) => path.join(OUT_DIR, f));
}

function fileRange(file, rows, def) {
  const dates = rows.map((r) => r[0]).sort();
  const m = path.basename(file).match(/_(\d{8})_(\d{8})\.csv$/);
  if (def.snapshot || !m) return [dates[0], dates[dates.length - 1]];
  const toIso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return [toIso(m[1]), toIso(m[2])];
}

function readRows(file, def) {
  const records = parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true });
  const cols = Object.keys(def.columns);
  const seen = new Map();
  for (const r of records) {
    const row = cols.map((c) => (r[c] === undefined || r[c] === '' ? null : r[c]));
    // Gộp dòng trùng khóa (PostgreSQL không cho upsert 2 lần cùng khóa trong một lệnh)
    seen.set(def.key.map((k) => r[k]).join('\u0001'), row);
  }
  return [...seen.values()];
}

async function insertRows(client, name, def, rows, lanTai) {
  const cols = Object.keys(def.columns);
  const types = cols.map((c) => def.columns[c]);
  const key = [...def.key];
  if (def.versioned) {
    cols.unshift('lan_tai');
    types.unshift('timestamptz');
    key.unshift('lan_tai');
    rows = rows.map((r) => [lanTai, ...r]);
  }
  const nonKey = cols.filter((c) => !key.includes(c));
  const batch = Math.floor(60000 / cols.length);
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params = [];
    const values = chunk.map((row) => {
      const ph = row.map((v, j) => { params.push(v); return `$${params.length}::${types[j]}`; });
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${fq(name)} (${cols.map(q).join(', ')}) VALUES ${values.join(', ')}
       ON CONFLICT (${key.map(q).join(', ')}) DO UPDATE SET ${nonKey.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}`,
      params
    );
  }
}

// Cửa sổ hoạt động: tối đa 30 ngày nhưng không vượt quá đầu tháng của ngày chốt
// (tránh kéo Oct vào khi đã có fact dài → phình Tổng SPU / lệch phân khúc).
function sqlBanWindow(refAlias = 'ref') {
  return `GREATEST(${refAlias}.ngay_chot - 29, date_trunc('month', ${refAlias}.ngay_chot)::date)`;
}

// Ghi phân khúc vào dim_spu (chung_loai + phan_khuc cùng một dim, không tách bảng).
// Quy tắc SL trong cửa sổ tháng chốt (gộp 2 kho Nhật+Thái):
//   <0 Khác | =0 Tồn xấu | 1–9 Bán chậm | 10–30 Bán thường | >30 Bán chạy
// Siết Tồn xấu: hàng mới nhập / mới tạo mã trong cửa sổ → "Hàng mới".
async function refreshDimSpuPhanKhuc(client) {
  const tu = sqlBanWindow('ref');
  await client.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban AS (
      SELECT f.spu_key, coalesce(sum(f.so_luong), 0) AS sl_30n
      FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ${tu} AND ref.ngay_chot
      GROUP BY f.spu_key
    ),
    first_import AS (
      SELECT spu_key, min(ngay) FILTER (WHERE coalesce(import_qty, 0) <> 0) AS ngay_nhap_dau
      FROM ${fq('fact_ton_kho_moi_nhat')}
      GROUP BY spu_key
    ),
    calc AS (
      SELECT d.spu_key, ref.ngay_chot, coalesce(b.sl_30n, 0) AS sl_30n,
        CASE
          WHEN upper(replace(d.spu_key, ' ', '')) LIKE '%MATRUNGGIANBAC%' THEN 'Mã trung gian'
          WHEN d.loai_ma IS DISTINCT FROM 'Sản phẩm' THEN 'Dịch vụ/Đặt hàng'
          WHEN coalesce(b.sl_30n, 0) < 0 THEN 'Khác'
          WHEN coalesce(b.sl_30n, 0) = 0
            AND (
              (fi.ngay_nhap_dau IS NOT NULL AND fi.ngay_nhap_dau >= ${tu})
              OR (d.ngay_tao_ma IS NOT NULL AND d.ngay_tao_ma >= ${tu})
            )
            THEN 'Hàng mới'
          WHEN coalesce(b.sl_30n, 0) = 0 THEN 'Tồn xấu'
          WHEN coalesce(b.sl_30n, 0) < 10 THEN 'Bán chậm'
          WHEN coalesce(b.sl_30n, 0) <= 30 THEN 'Bán thường'
          ELSE 'Bán chạy'
        END AS phan_khuc
      FROM ${fq('dim_spu')} d
      CROSS JOIN ref
      LEFT JOIN ban b ON b.spu_key = d.spu_key
      LEFT JOIN first_import fi ON fi.spu_key = d.spu_key
    )
    UPDATE ${fq('dim_spu')} d SET
      sl_30_ngay = c.sl_30n,
      ngay_chot_phan_khuc = c.ngay_chot,
      phan_khuc = c.phan_khuc
    FROM calc c
    WHERE d.spu_key = c.spu_key`);
  await client.query(`DROP VIEW IF EXISTS ${fq('spu_phan_khuc')}`);
  await client.query(`DROP VIEW IF EXISTS ${fq('phan_khuc_spu')}`);
  await client.query(`DROP VIEW IF EXISTS ${fq('phan_khuc_spu_kho')}`);
}

// Snapshot tồn xấu cố định (không dùng cửa sổ 30 ngày trượt để đo đẩy tồn).
// Chốt danh sách mỗi 15 ngày (ngày 1 & 16, hoặc khi snapshot mới nhất đã ≥ 15 ngày).
// Theo dõi chính list đó: bán bao nhiêu, thu bao nhiêu tiền sau ngày chốt.
async function ensureSnapshotTonXau(client) {
  await client.query(`
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${fq('dim_muc_tieu')} (
      thang date PRIMARY KEY,
      muc_tieu_dt numeric,
      ghi_chu text
    )`);
}

async function refreshSnapshotTonXau(client, { force = false } = {}) {
  await ensureSnapshotTonXau(client);
  const ref = await client.query(`SELECT max(ngay)::date AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}`);
  const ngayChot = ref.rows[0].ngay_chot;
  if (!ngayChot) {
    console.log('snapshot_ton_xau: chưa có tồn → bỏ qua');
    return null;
  }

  const last = await client.query(`SELECT max(ngay_snapshot)::date AS d FROM ${fq('snapshot_ton_xau')}`);
  const lastSnap = last.rows[0].d;
  const day = Number(String(ngayChot).slice(8, 10)) || new Date(ngayChot).getDate();
  const isAnchor = day === 1 || day === 16;
  let needNew = force || !lastSnap;
  if (lastSnap) {
    const age = await client.query(`SELECT ($1::date - $2::date)::int AS days`, [ngayChot, lastSnap]);
    if (age.rows[0].days >= 15 && isAnchor) needNew = true;
    if (age.rows[0].days >= 15 && !lastSnap) needNew = true;
    // Nếu chưa từng chốt trong kỳ 15 ngày gần nhất
    if (age.rows[0].days >= 15) needNew = true;
  }
  // Tránh chốt trùng cùng ngày
  if (lastSnap && String(lastSnap) === String(ngayChot)) needNew = false;

  if (!needNew && !force) {
    console.log(`snapshot_ton_xau: giữ snapshot ${lastSnap} (chốt tồn ${ngayChot})`);
  } else {
    const ins = await client.query(`
      WITH ref AS (SELECT $1::date AS ngay_chot),
      ton AS (
        SELECT t.spu_key,
               sum(t.inventory_qty) AS ton_qty,
               sum(t.inventory_value) AS ton_value
        FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
        WHERE t.ngay = ref.ngay_chot
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
      SELECT ref.ngay_chot, d.spu_key, d.ten_san_pham, t.ton_qty, t.ton_value, d.sl_30_ngay, fi.ngay_nhap_dau
      FROM ${fq('dim_spu')} d
      CROSS JOIN ref
      INNER JOIN ton t ON t.spu_key = d.spu_key
      LEFT JOIN first_import fi ON fi.spu_key = d.spu_key
      WHERE d.phan_khuc = 'Tồn xấu'
      ON CONFLICT (ngay_snapshot, spu_key) DO UPDATE SET
        ten_san_pham = EXCLUDED.ten_san_pham,
        ton_qty = EXCLUDED.ton_qty,
        ton_value = EXCLUDED.ton_value,
        sl_30_tai_chot = EXCLUDED.sl_30_tai_chot,
        ngay_nhap_dau = EXCLUDED.ngay_nhap_dau
      RETURNING spu_key`, [ngayChot]);
    console.log(`snapshot_ton_xau: chốt ${ngayChot} → ${ins.rowCount} mã tồn xấu`);
  }

  // View tiến độ — DROP trước vì CREATE OR REPLACE không đổi được danh sách cột
  await client.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau_tong')}`);
  await client.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau_15ngay')}`);
  await client.query(`DROP VIEW IF EXISTS ${fq('vw_day_ton_xau')}`);
  await client.query(`
    CREATE VIEW ${fq('vw_day_ton_xau')} AS
    WITH snap AS (
      SELECT * FROM ${fq('snapshot_ton_xau')}
    ),
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
           (SELECT max(ngay) FROM ${fq('fact_ton_kho_moi_nhat')}) AS ngay_kiem_tra,
           s.spu_key, s.ten_san_pham,
           s.ton_qty AS ton_luc_chot, s.ton_value AS gt_luc_chot,
           s.sl_30_tai_chot, s.ngay_nhap_dau,
           b.sl_ban_sau_chot, b.dt_sau_chot,
           CASE WHEN coalesce(b.sl_ban_sau_chot, 0) > 0 THEN 'Đã đẩy' ELSE 'Chưa đẩy' END AS trang_thai_day,
           coalesce(th.ton_hien_tai, 0) AS ton_hien_tai,
           coalesce(th.gt_ton_hien_tai, 0) AS gt_ton_hien_tai,
           greatest(s.ton_qty - coalesce(th.ton_hien_tai, 0), 0) AS sl_giam_ton
    FROM snap s
    LEFT JOIN ban b ON b.ngay_snapshot = s.ngay_snapshot AND b.spu_key = s.spu_key
    LEFT JOIN ton_hien th ON th.spu_key = s.spu_key`);

  await client.query(`
    CREATE VIEW ${fq('vw_day_ton_xau_tong')} AS
    SELECT ngay_snapshot, ngay_kiem_tra,
           count(*)::int AS so_ma,
           count(*) FILTER (WHERE trang_thai_day = 'Đã đẩy')::int AS so_ma_da_day,
           count(*) FILTER (WHERE trang_thai_day = 'Chưa đẩy')::int AS so_ma_chua_day,
           sum(ton_luc_chot) AS ton_luc_chot,
           sum(gt_luc_chot) AS gt_luc_chot,
           sum(sl_ban_sau_chot) AS sl_ban_sau_chot,
           sum(dt_sau_chot) AS dt_sau_chot,
           sum(ton_hien_tai) AS ton_hien_tai,
           sum(sl_giam_ton) AS sl_giam_ton
    FROM ${fq('vw_day_ton_xau')}
    GROUP BY ngay_snapshot, ngay_kiem_tra
    ORDER BY ngay_snapshot`);

  const tong = await client.query(`SELECT * FROM ${fq('vw_day_ton_xau_tong')} ORDER BY ngay_snapshot DESC LIMIT 3`);
  for (const r of tong.rows) {
    console.log(
      `  đẩy tồn @${r.ngay_snapshot}: ${r.so_ma} mã | bán ${r.sl_ban_sau_chot} | DT ${Number(r.dt_sau_chot).toLocaleString('vi-VN')} | giảm tồn ${r.sl_giam_ton}`
    );
  }
  return ngayChot;
}

// Chỉ giữ SPU còn “sống” theo cửa sổ 30 ngày (cùng mốc với phân khúc) HOẶC còn tồn cuối kỳ.
// - Có bán (SL/đơn/DT) trong 30 ngày tính đến ngày tồn mới nhất
// - HOẶC tồn cuối kỳ <> 0
// Không bán trong tháng chốt VÀ hết tồn → active=false (giữ row để join DT lịch sử / ma_cu_moi).
async function pruneDimSpuInactive(client) {
  const tu = sqlBanWindow('ref');
  await client.query(`ALTER TABLE ${fq('dim_spu')} ADD COLUMN IF NOT EXISTS active boolean`);
  const r = await client.query(`
    WITH ref AS (SELECT max(ngay) AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}),
    ban AS (
      SELECT f.spu_key
      FROM ${fq('fact_doanh_thu_moi_nhat')} f, ref
      WHERE f.ngay BETWEEN ${tu} AND ref.ngay_chot
      GROUP BY f.spu_key
      HAVING sum(f.so_luong) <> 0 OR sum(f.don_chot) <> 0 OR sum(f.order_revenue_vnd) <> 0
    ),
    ton AS (
      SELECT t.spu_key
      FROM ${fq('fact_ton_kho_moi_nhat')} t, ref
      WHERE t.ngay = ref.ngay_chot
      GROUP BY t.spu_key
      HAVING sum(t.inventory_qty) <> 0
    ),
    giu AS (
      SELECT spu_key FROM ban
      UNION
      SELECT spu_key FROM ton
    )
    UPDATE ${fq('dim_spu')} d
    SET active = EXISTS (SELECT 1 FROM giu g WHERE g.spu_key = d.spu_key)
    RETURNING d.spu_key, d.active`);
  const on = r.rows.filter((x) => x.active).length;
  const off = r.rows.length - on;
  const chot = await client.query(`SELECT max(ngay)::text AS ngay_chot FROM ${fq('fact_ton_kho_moi_nhat')}`);
  console.log(`dim_spu prune (tháng chốt, soft): active=${on}, ẩn=${off}, tổng=${r.rows.length}, chốt=${chot.rows[0].ngay_chot}`);
}

// spunew từ sheet mã cũ→mã mới: NM101 + N0006 → NM101-N0006; không có trong sheet thì = spu_key
async function refreshDimSpuNew(client) {
  const mapFile = path.join(__dirname, 'spu_new_map.csv');
  await client.query(`UPDATE ${fq('dim_spu')} SET spunew = spu_key`);
  if (!fs.existsSync(mapFile)) {
    console.log('spunew: không có spu_new_map.csv → giữ spunew = spu_key');
    return;
  }
  const pairs = parse(fs.readFileSync(mapFile, 'utf8').replace(/^\uFEFF/, ''), {
    columns: true, skip_empty_lines: true,
  }).filter((r) => r.spu_cu && r.spu_moi && r.spunew);
  // Match theo spu_key = mã mới hoặc mã cũ, hoặc spu_goc chứa mã cũ/mới
  let hit = 0;
  for (const p of pairs) {
    const cu = String(p.spu_cu).trim().toUpperCase();
    const moi = String(p.spu_moi).trim().toUpperCase();
    const spunew = String(p.spunew).trim().toUpperCase();
    const r = await client.query(
      `UPDATE ${fq('dim_spu')} SET spunew = $1
       WHERE upper(spu_key) = $2 OR upper(spu_key) = $3
          OR upper(spu_key) = ('TL-' || $3)
          OR ('|' || upper(coalesce(spu_goc,'')) || '|') LIKE ('%|' || $2 || '|%')
          OR ('|' || upper(coalesce(spu_goc,'')) || '|') LIKE ('%|' || $3 || '|%')`,
      [spunew, moi, cu]
    );
    hit += r.rowCount;
  }
  const dist = await client.query(
    `SELECT count(*) FILTER (WHERE spunew IS DISTINCT FROM spu_key) AS co_map,
            count(*) FILTER (WHERE spunew IS NOT DISTINCT FROM spu_key) AS giu_nguyen
     FROM ${fq('dim_spu')}`
  );
  console.log(`spunew: ${pairs.length} cặp sheet, cập nhật ${hit} lần | có map=${dist.rows[0].co_map}, giữ nguyên=${dist.rows[0].giu_nguyen}`);
}

async function main() {
  const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const lanTai = new Date().toISOString();
  const doneDir = path.join(OUT_DIR, 'da_nap');
  try {
    await ensureLoadLog(client);
    for (const [name, def] of Object.entries(TABLES)) {
      await ensureTable(client, name, def);
      for (const file of filesFor(name)) {
        const rows = readRows(file, def);
        if (!rows.length) continue;
        await client.query('BEGIN');
        try {
          if (def.fullReplace) await client.query(`DELETE FROM ${fq(name)}`);
          await insertRows(client, name, def, rows, lanTai);
          if (def.versioned) {
            const [from, to] = fileRange(file, rows, def);
            await client.query(
              `INSERT INTO ${fq('lich_su_nap')} VALUES ($1, $2, $3, $4, $5, $6)`,
              [lanTai, name, from, to, path.basename(file), rows.length]
            );
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
        // File fact đã nạp được cất đi để lần chạy sau không nạp lại; file dim giữ nguyên vì script xuất cần gộp tiếp
        if (def.versioned) {
          fs.mkdirSync(doneDir, { recursive: true });
          fs.renameSync(file, path.join(doneDir, path.basename(file)));
        }
        console.log(`${SCHEMA}.${name}: ${rows.length} dòng từ ${path.basename(file)}`);
      }
    }
    await refreshDimSpuPhanKhuc(client);
    await pruneDimSpuInactive(client);
    // Gán lại phân khúc sau khi đã cắt dim (tránh số liệu trên mã đã xóa)
    await refreshDimSpuPhanKhuc(client);
    await refreshDimSpuNew(client);
    // Chốt list tồn xấu cố định + view đẩy tồn (không đo bằng cửa sổ 30 ngày trượt)
    await refreshSnapshotTonXau(client);
    const pk = await client.query(`SELECT phan_khuc, count(*) n FROM ${fq('dim_spu')} WHERE phan_khuc IS NOT NULL GROUP BY 1 ORDER BY 1`);
    console.log('dim_spu.phan_khuc:', pk.rows.map((r) => `${r.phan_khuc}=${r.n}`).join(', ') || '(trống)');
    const n = await client.query(`SELECT count(*) n, count(*) FILTER (WHERE loai_ma='Sản phẩm') sp FROM ${fq('dim_spu')}`);
    console.log(`dim_spu tổng=${n.rows[0].n} (Sản phẩm=${n.rows[0].sp})`);
  } finally {
    await client.end();
  }
}

module.exports = { refreshDimSpuPhanKhuc, refreshSnapshotTonXau, pruneDimSpuInactive, ensureSnapshotTonXau };

if (require.main === module) {
  main().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
}
