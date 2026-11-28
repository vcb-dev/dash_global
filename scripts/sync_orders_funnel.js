/**
 * Kéo Pancake POS orders → global.fact_don_hang (+ ct)
 * kèm ngay_xuat (status=2 shipped) và ngay_thanh_cong (status=3 delivered)
 * từ status_history — khớp Ngày xuất / Ngày thành công trên báo cáo POS.
 *
 * Usage:
 *   node scripts/sync_orders_funnel.js
 *   node scripts/sync_orders_funnel.js 2026-09-01 2026-11-28
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'be', 'node_modules', 'pg')); // eslint-disable-line

function loadEnv(p) {
  const env = { ...process.env };
  if (!fs.existsSync(p)) return env;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([^#=]+)=(.*)$/);
    if (m && env[m[1].trim()] === undefined) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

const ENV = {
  ...loadEnv(path.join(__dirname, '..', 'be', '.env')),
  ...loadEnv(path.join('D:', 'Cursor', 'Global', 'pancake', '.env')),
};
const SCHEMA = ENV.DB_SCHEMA || 'global';
const API_KEY = ENV.PANCAKE_API_KEY;
const SHOP_ID = ENV.PANCAKE_SHOP_ID;
const BASE = `https://pos.pages.fm/api/v1/shops/${SHOP_ID}`;
/** Tên kho trên POS → tên chuẩn trong schema global (khớp fact_doanh_thu).
 *  Nhật chỉ lấy CÓ VAT — không kéo KHÔNG VAT. */
const KHO_MAP = {
  'KHO THÁI LAN': 'KHO THÁI LAN',
  'KHO NHẬT BẢN CÓ VAT': 'KHO NHẬT BẢN',
};
const WANTED = new Set(Object.keys(KHO_MAP));

const STATUS_XUAT = 2; // shipped
const STATUS_TC = new Set([3]); // delivered (+ received_money nếu có trong history)

/**
 * Fallback tỷ giá POS→VND (tỷ giá cấu hình trên shop Pancake, không phải market).
 * Override: FX_JPY / FX_THB / FX_USD trong .env.
 * USD shop ≈ 256 (đã suy từ analytics residual), không dùng ~25000.
 */
const FX_FALLBACK = {
  VND: 1,
  JPY: Number(ENV.FX_JPY) || 159.09,
  THB: Number(ENV.FX_THB) || 7.4227,
  USD: Number(ENV.FX_USD) || 256,
};

function fq(t) {
  return `"${SCHEMA}"."${t}"`;
}

function fxOf(cur) {
  const c = String(cur || 'VND').toUpperCase();
  return FX_FALLBACK[c] != null ? FX_FALLBACK[c] : 1;
}

function toVnDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // POS timestamps are UTC; business day VN = UTC+7
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

function firstStatusAt(history, want) {
  const arr = Array.isArray(history) ? history : history ? [history] : [];
  let best = null;
  for (const h of arr) {
    const st = Number(h.status);
    const ok = typeof want === 'number' ? st === want : want.has(st);
    if (!ok) continue;
    const t = h.updated_at || null;
    if (!t) continue;
    if (!best || String(t) < String(best)) best = t;
  }
  return toVnDate(best);
}

function spuKey(spuGoc, sku) {
  const g = String(spuGoc || '')
    .trim()
    .trimEnd(',')
    .toUpperCase();
  if (g) return g.includes('-') ? g.split('-')[0] : g;
  const s = String(sku || '')
    .trim()
    .trimEnd(',')
    .toUpperCase();
  return s.includes('-') ? s.split('-')[0] : s || 'KHONG_XAC_DINH';
}

async function apiGet(pathname, params) {
  const u = new URL(`${BASE}/${pathname}`);
  u.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, String(v));
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

async function main() {
  if (!API_KEY || !SHOP_ID) throw new Error('Thiếu PANCAKE_API_KEY / PANCAKE_SHOP_ID');
  if (!ENV.SUPABASE_DB_URL) throw new Error('Thiếu SUPABASE_DB_URL');

  const from = process.argv[2] || '2026-09-01';
  // Mặc định = hôm nay theo giờ VN (tránh UTC làm den_ngay +1)
  const to =
    process.argv[3] ||
    new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
  const startIso = `${from}T00:00:00+07:00`;
  const endIso = `${to}T23:59:59+07:00`;
  console.log(`Sync orders funnel ${from} → ${to} (schema=${SCHEMA})`);

  const whRes = await apiGet('warehouses', {});
  const warehouses = (whRes.data || []).filter((w) => WANTED.has(String(w.name || '').trim()));
  const whMap = Object.fromEntries(
    warehouses.map((w) => {
      const raw = String(w.name || '').trim();
      return [w.id, KHO_MAP[raw] || raw];
    })
  );
  console.log(
    'warehouses',
    warehouses.map((w) => `${w.name}→${KHO_MAP[String(w.name).trim()] || w.name}`).join(', ')
  );

  const orders = new Map();
  const items = [];

  for (const w of warehouses) {
    let page = 1;
    let totalPages = 1;
    do {
      const res = await apiGet('orders', {
        page_size: 100,
        page_number: page,
        start_date_time_iso: startIso,
        end_date_time_iso: endIso,
        warehouse_id: w.id,
      });
      totalPages = res.total_pages || 1;
      for (const o of res.data || []) {
        const oid = String(o.id);
        if (orders.has(oid)) continue;
        const kho =
          whMap[o.warehouse_id] ||
          KHO_MAP[String(o.warehouse_info?.name || '').trim()] ||
          '';
        if (!kho) continue;
        const ngay = toVnDate(o.inserted_at);
        const ngayXuat =
          firstStatusAt(o.status_history, STATUS_XUAT) ||
          (o.time_send_partner ? toVnDate(o.time_send_partner) : null);
        const ngayTc = firstStatusAt(o.status_history, STATUS_TC);
        const currency = String(o.order_currency || 'VND').toUpperCase();
        orders.set(oid, {
          ngay,
          order_id: oid,
          system_id: o.system_id != null ? String(o.system_id) : '',
          kho,
          warehouse_id: o.warehouse_id || w.id,
          order_currency: currency,
          trang_thai: Number(o.status) || 0,
          trang_thai_ten: o.status_name || '',
          customer_id: o.customer?.customer_id != null ? String(o.customer.customer_id) : '',
          customer_code: o.customer?.customer_id != null ? String(o.customer.customer_id) : '',
          bill_phone: o.bill_phone_number || '',
          bill_name: o.bill_full_name || o.customer?.name || '',
          kenh: o.order_sources_name || '',
          ads_source: o.ads_source || '',
          nv_ban: o.assigning_seller?.name || '',
          nv_tao: o.creator?.name || '',
          tong_tien: Number(o.total_price) || 0,
          tong_giam: Number(o.total_discount) || 0,
          tong_sau_giam: Number(o.total_price_after_sub_discount) || 0,
          so_luong: Number(o.total_quantity) || 0,
          is_livestream: o.is_livestream || o.is_live_shopping ? 1 : 0,
          ly_do_tra: o.returned_reason_name || '',
          inserted_at: o.inserted_at || '',
          ngay_xuat: ngayXuat,
          ngay_thanh_cong: ngayTc,
        });
        let line = 0;
        for (const it of o.items || []) {
          line += 1;
          const vi = it.variation_info || {};
          const sku = String(vi.display_id || vi.barcode || '')
            .trim()
            .trimEnd(',');
          const spuGoc = vi.product_display_id || sku;
          items.push({
            ngay,
            order_id: oid,
            line_no: line,
            kho,
            sku,
            spu_key: spuKey(spuGoc, sku),
            ten_san_pham: vi.name || '',
            size: '',
            so_luong: Number(it.quantity) || 0,
            gia_niem_yet: Number(vi.retail_price) || 0,
            gia_niem_yet_goc: vi.retail_price_original != null ? Number(vi.retail_price_original) : null,
            gia_von_tb: Number(vi.avg_price) || 0,
            giam_moi_sp: Number(it.discount_each_product) || 0,
            giam_theo_phan_tram: it.is_discount_percent ? 1 : 0,
            tong_giam_dong: Number(it.total_discount) || 0,
            so_luong_tra: Number(it.returned_count) || 0,
            is_bonus: it.is_bonus_product ? 1 : 0,
          });
        }
      }
      process.stdout.write(`\r  ${w.name} page ${page}/${totalPages} orders=${orders.size}   `);
      page += 1;
    } while (page <= totalPages);
    console.log('');
  }

  // Tỷ giá theo ngày×kho từ analytics/sale (VND) — chỉ nhận ngày đơn-tiền tệ, khớp số đơn
  console.log('Fetching analytics rates (VND)...');
  const sale = await apiGet('analytics/sale', {
    since: `${from}T00:00:00`,
    until: `${to}T23:59:59`,
    success_record: 'inserted_at',
    success_status: 0,
    returned_record: 'success_record',
    user_type: 'update',
    'select_fields[]': ['revenue', 'success_order_count'],
    'split_by[]': ['Time.day', 'Order.warehouse_id'],
  });
  const analyticsByDayWh = new Map(); // `${day}|${whId}` → {vnd, don}
  for (const r of sale.data || []) {
    const day = r['Time.day'];
    const whId = r['Order.warehouse_id'];
    if (!day || !whId) continue;
    analyticsByDayWh.set(`${day}|${whId}`, {
      vnd: Number(r.result?.revenue) || 0,
      don: Number(r.result?.success_order_count) || 0,
    });
  }

  const nativeByDayWh = new Map(); // key → { n, byCur: {CUR: sum} }
  for (const o of orders.values()) {
    if (!o.ngay || !o.warehouse_id) continue;
    const k = `${o.ngay}|${o.warehouse_id}`;
    const cur = nativeByDayWh.get(k) || { n: 0, byCur: {} };
    const ccy = String(o.order_currency || 'VND').toUpperCase();
    cur.n += 1;
    cur.byCur[ccy] = (cur.byCur[ccy] || 0) + (o.tong_sau_giam || 0);
    nativeByDayWh.set(k, cur);
  }

  const rateByDayWhCur = new Map(); // `${day}|${whId}|${CUR}` → rate
  const rateByCurrency = {}; // weighted từ ngày sạch 1-currency
  for (const [k, native] of nativeByDayWh) {
    const a = analyticsByDayWh.get(k);
    if (!a || !(a.vnd > 0)) continue;
    const curs = Object.keys(native.byCur);
    const donOk = a.don > 0 && Math.abs(a.don - native.n) <= Math.max(1, Math.round(a.don * 0.05));
    if (!donOk) continue;

    if (curs.length === 1) {
      const ccy = curs[0];
      const sum = native.byCur[ccy];
      if (!(sum > 0)) continue;
      const rate = a.vnd / sum;
      if (ccy === 'JPY' && (rate < 80 || rate > 250)) continue;
      if (ccy === 'THB' && (rate < 3 || rate > 20)) continue;
      if (ccy === 'VND' && (rate < 0.5 || rate > 2)) continue;
      if (ccy === 'USD' && (rate < 50 || rate > 2000)) continue;
      rateByDayWhCur.set(`${k}|${ccy}`, rate);
      rateByCurrency[ccy] = rateByCurrency[ccy] || { vnd: 0, native: 0 };
      rateByCurrency[ccy].vnd += a.vnd;
      rateByCurrency[ccy].native += sum;
      continue;
    }

    // Ngày lẫn tiền: residual cho currency lạ sau khi trừ JPY/THB/VND theo fallback tạm
    const known = { VND: 1, JPY: FX_FALLBACK.JPY, THB: FX_FALLBACK.THB };
    let used = 0;
    let unknown = null;
    for (const ccy of curs) {
      if (known[ccy] != null) {
        used += native.byCur[ccy] * known[ccy];
      } else if (!unknown) {
        unknown = ccy;
      } else {
        unknown = null; // >1 unknown → bỏ
        break;
      }
    }
    if (unknown && native.byCur[unknown] > 0) {
      const residual = a.vnd - used;
      const rate = residual / native.byCur[unknown];
      if (rate > 0 && Number.isFinite(rate)) {
        if (unknown === 'USD' && rate >= 50 && rate <= 2000) {
          rateByDayWhCur.set(`${k}|${unknown}`, rate);
          rateByCurrency[unknown] = rateByCurrency[unknown] || { vnd: 0, native: 0 };
          rateByCurrency[unknown].vnd += residual;
          rateByCurrency[unknown].native += native.byCur[unknown];
        }
      }
      for (const ccy of curs) {
        if (known[ccy] != null) rateByDayWhCur.set(`${k}|${ccy}`, known[ccy]);
      }
    }
  }
  const currencyRate = { ...FX_FALLBACK };
  for (const [c, a] of Object.entries(rateByCurrency)) {
    if (a.native) currencyRate[c] = a.vnd / a.native;
  }
  console.log(
    'FX rates',
    Object.fromEntries(
      Object.entries(currencyRate)
        .filter(([c]) => ['JPY', 'THB', 'USD', 'VND'].includes(c))
        .map(([c, r]) => [c, Number(Number(r).toFixed(4))])
    ),
    `dayWhCur=${rateByDayWhCur.size}`
  );

  function rateForOrder(o) {
    const ccy = String(o.order_currency || 'VND').toUpperCase();
    const k = `${o.ngay}|${o.warehouse_id}|${ccy}`;
    if (rateByDayWhCur.has(k)) return rateByDayWhCur.get(k);
    return currencyRate[ccy] != null ? currencyRate[ccy] : fxOf(ccy);
  }

  for (const o of orders.values()) {
    const rate = rateForOrder(o);
    o.tong_tien = (o.tong_tien || 0) * rate;
    o.tong_giam = (o.tong_giam || 0) * rate;
    o.tong_sau_giam = (o.tong_sau_giam || 0) * rate;
    o._fx = rate;
  }
  const rateByOrder = new Map([...orders.values()].map((o) => [o.order_id, o._fx || 1]));
  for (const it of items) {
    const rate = rateByOrder.get(it.order_id) || 1;
    it.gia_niem_yet = (it.gia_niem_yet || 0) * rate;
    if (it.gia_niem_yet_goc != null) it.gia_niem_yet_goc = it.gia_niem_yet_goc * rate;
    it.gia_von_tb = (it.gia_von_tb || 0) * rate;
    it.giam_moi_sp = (it.giam_moi_sp || 0) * rate;
    it.tong_giam_dong = (it.tong_giam_dong || 0) * rate;
  }

  const orderRows = [...orders.values()].map(({ warehouse_id, order_currency, _fx, ...rest }) => rest);
  const withXuat = orderRows.filter((r) => r.ngay_xuat).length;
  const withTc = orderRows.filter((r) => r.ngay_thanh_cong).length;
  const dtXuat = orderRows
    .filter((r) => r.ngay_xuat && r.ngay_xuat >= from && r.ngay_xuat <= to)
    .reduce((s, r) => s + (r.tong_sau_giam || 0), 0);
  const dtTc = orderRows
    .filter((r) => r.ngay_thanh_cong && r.ngay_thanh_cong >= from && r.ngay_thanh_cong <= to)
    .reduce((s, r) => s + (r.tong_sau_giam || 0), 0);
  console.log(
    `orders=${orderRows.length} có ngày xuất=${withXuat} có ngày TC=${withTc} ct=${items.length}`
  );
  console.log(`VND xuất(trong kỳ)=${Math.round(dtXuat)} TC(trong kỳ)=${Math.round(dtTc)}`);

  const client = new Client({
    connectionString: ENV.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const lanTai = new Date().toISOString();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${fq('lich_su_nap')} (
        lan_tai timestamptz NOT NULL, bang text NOT NULL, tu_ngay date NOT NULL, den_ngay date NOT NULL,
        file text, so_dong int, PRIMARY KEY (lan_tai, bang, file))`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${fq('fact_don_hang')} (
        lan_tai timestamptz NOT NULL,
        ngay date, order_id text NOT NULL, system_id text, kho text,
        trang_thai int, trang_thai_ten text,
        customer_id text, customer_code text, bill_phone text, bill_name text,
        kenh text, ads_source text, nv_ban text, nv_tao text,
        tong_tien numeric, tong_giam numeric, tong_sau_giam numeric, so_luong numeric,
        is_livestream int, ly_do_tra text, inserted_at text,
        ngay_xuat date, ngay_thanh_cong date,
        PRIMARY KEY (lan_tai, order_id)
      )`);
    await client.query(`ALTER TABLE ${fq('fact_don_hang')} ADD COLUMN IF NOT EXISTS ngay_xuat date`);
    await client.query(`ALTER TABLE ${fq('fact_don_hang')} ADD COLUMN IF NOT EXISTS ngay_thanh_cong date`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${fq('fact_don_hang_ct')} (
        lan_tai timestamptz NOT NULL,
        ngay date, order_id text NOT NULL, line_no int NOT NULL, kho text,
        sku text, spu_key text, ten_san_pham text, size text,
        so_luong numeric, gia_niem_yet numeric, gia_niem_yet_goc numeric, gia_von_tb numeric,
        giam_moi_sp numeric, giam_theo_phan_tram int, tong_giam_dong numeric,
        so_luong_tra numeric, is_bonus int,
        PRIMARY KEY (lan_tai, order_id, line_no)
      )`);

    async function insertBatch(table, cols, rows) {
      const batch = Math.max(1, Math.floor(20000 / cols.length));
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const params = [];
        const values = chunk
          .map((r) => {
            const vals = cols.map((c) => r[c]);
            const start = params.length;
            params.push(...vals);
            return `(${cols.map((_, j) => `$${start + j + 1}`).join(',')})`;
          })
          .join(',');
        await client.query(
          `INSERT INTO ${fq(table)} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${values}`,
          params
        );
      }
    }

    const ohCols = [
      'lan_tai',
      'ngay',
      'order_id',
      'system_id',
      'kho',
      'trang_thai',
      'trang_thai_ten',
      'customer_id',
      'customer_code',
      'bill_phone',
      'bill_name',
      'kenh',
      'ads_source',
      'nv_ban',
      'nv_tao',
      'tong_tien',
      'tong_giam',
      'tong_sau_giam',
      'so_luong',
      'is_livestream',
      'ly_do_tra',
      'inserted_at',
      'ngay_xuat',
      'ngay_thanh_cong',
    ];
    await insertBatch(
      'fact_don_hang',
      ohCols,
      orderRows.map((r) => ({ ...r, lan_tai: lanTai }))
    );

    const ctCols = [
      'lan_tai',
      'ngay',
      'order_id',
      'line_no',
      'kho',
      'sku',
      'spu_key',
      'ten_san_pham',
      'size',
      'so_luong',
      'gia_niem_yet',
      'gia_niem_yet_goc',
      'gia_von_tb',
      'giam_moi_sp',
      'giam_theo_phan_tram',
      'tong_giam_dong',
      'so_luong_tra',
      'is_bonus',
    ];
    await insertBatch(
      'fact_don_hang_ct',
      ctCols,
      items.map((r) => ({ ...r, lan_tai: lanTai }))
    );

    await client.query(
      `INSERT INTO ${fq('lich_su_nap')} (lan_tai, bang, tu_ngay, den_ngay, file, so_dong)
       VALUES ($1,'fact_don_hang',$2::date,$3::date,'sync_orders_funnel.js',$4)`,
      [lanTai, from, to, orderRows.length]
    );
    await client.query(
      `INSERT INTO ${fq('lich_su_nap')} (lan_tai, bang, tu_ngay, den_ngay, file, so_dong)
       VALUES ($1,'fact_don_hang_ct',$2::date,$3::date,'sync_orders_funnel.js',$4)`,
      [lanTai, from, to, items.length]
    );

    await client.query(`
      CREATE OR REPLACE VIEW ${fq('fact_don_hang_moi_nhat')} AS
      SELECT f.* FROM ${fq('fact_don_hang')} f
      WHERE f.lan_tai = (SELECT max(l.lan_tai) FROM ${fq('lich_su_nap')} l WHERE l.bang = 'fact_don_hang')`);
    await client.query(`
      CREATE OR REPLACE VIEW ${fq('fact_don_hang_ct_moi_nhat')} AS
      SELECT f.* FROM ${fq('fact_don_hang_ct')} f
      WHERE f.lan_tai = (SELECT max(l.lan_tai) FROM ${fq('lich_su_nap')} l WHERE l.bang = 'fact_don_hang_ct')`);

    const check = await client.query(`
      SELECT
        count(*)::int AS n,
        count(ngay_xuat)::int AS co_xuat,
        count(ngay_thanh_cong)::int AS co_tc
      FROM ${fq('fact_don_hang_moi_nhat')}
      WHERE ngay BETWEEN $1::date AND $2::date`, [from, to]);
    console.log('DB moi_nhat', check.rows[0]);
    console.log('OK lan_tai', lanTai);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
