const { fq, withDb, parseRange } = require('./db');

/** Mã loại khỏi Tổng SPU (thủ công) — hiện trong danh sách bỏ */
const SPU_BO_THU_CONG = ['C500391'];

function pushParams(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function sqlInList(params, values) {
  if (!values.length) return null;
  return values.map((v) => pushParams(params, v)).join(', ');
}

function isBoThuCong(spuKey) {
  return SPU_BO_THU_CONG.includes(String(spuKey || '').toUpperCase());
}

/** Kho + phân khúc + phân nhóm (chung_loai). Trả join/where gắn vào fact alias.
 *  opts.skipKho = true khi bảng không có cột kho (vd. fact_po). */
function factFilters(q, params, alias = 'f', dimAlias = 'dfl', opts = {}) {
  let join = '';
  let where = '';
  if (!opts.skipKho && q.kho && q.kho !== 'All') {
    where += ` AND ${alias}.kho = ${pushParams(params, q.kho)}`;
  }
  const needPk = q.phan_khuc && q.phan_khuc !== 'All';
  const needNhom = q.phan_nhom && q.phan_nhom !== 'All';
  if (needPk || needNhom) {
    join = ` JOIN ${fq('dim_spu')} ${dimAlias} ON ${dimAlias}.spu_key = ${alias}.spu_key`;
    if (needPk) where += ` AND ${dimAlias}.phan_khuc = ${pushParams(params, q.phan_khuc)}`;
    if (needNhom) where += ` AND ${dimAlias}.chung_loai = ${pushParams(params, q.phan_nhom)}`;
  }
  return { join, where };
}

function dimWhere(q, params, alias = 'd') {
  let where = '';
  if (q.phan_khuc && q.phan_khuc !== 'All') {
    where += ` AND ${alias}.phan_khuc = ${pushParams(params, q.phan_khuc)}`;
  }
  if (q.phan_nhom && q.phan_nhom !== 'All') {
    where += ` AND ${alias}.chung_loai = ${pushParams(params, q.phan_nhom)}`;
  }
  return where;
}

/** Tổng SPU / list giữ-bỏ: chỉ mã active (còn bán tháng chốt hoặc còn tồn). */
function dimActive(alias = 'd') {
  return ` AND coalesce(${alias}.active, true)`;
}

async function filterOptions() {
  return withDb(async (c) => {
    const pk = (
      await c.query(
        `SELECT DISTINCT phan_khuc AS v FROM ${fq('dim_spu')}
         WHERE phan_khuc IS NOT NULL AND btrim(phan_khuc) <> ''
         ORDER BY 1`
      )
    ).rows.map((r) => r.v);
    const nhom = (
      await c.query(
        `SELECT DISTINCT chung_loai AS v FROM ${fq('dim_spu')}
         WHERE chung_loai IS NOT NULL AND btrim(chung_loai) <> ''
         ORDER BY 1`
      )
    ).rows.map((r) => r.v);
    return {
      kho: ['KHO NHẬT BẢN', 'KHO THÁI LAN'],
      phan_khuc: pk,
      phan_nhom: nhom,
    };
  });
}

async function overview(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const p = [from, to];
    const ff = factFilters(q, p, 'f');

    const kpi = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt,
             coalesce(sum(f.don_chot),0)::float AS don,
             coalesce(sum(f.so_luong),0)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${ff.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}`,
        p
      )
    ).rows[0];

    // Tổng SPU = dim (bỏ TG/DV) + lọc phân khúc/nhóm; có kho thì chỉ mã có DT hoặc tồn ở kho đó
    const spuP = [];
    const spuDim = dimWhere(q, spuP, 'd');
    let khoSpu = '';
    if (q.kho && q.kho !== 'All') {
      const pFrom = pushParams(spuP, from);
      const pTo = pushParams(spuP, to);
      const k = pushParams(spuP, q.kho);
      khoSpu = `
        AND (
          EXISTS (
            SELECT 1 FROM ${fq('fact_doanh_thu_moi_nhat')} f
            WHERE f.spu_key = d.spu_key AND f.kho = ${k}
              AND f.ngay BETWEEN ${pFrom}::date AND ${pTo}::date
          )
          OR EXISTS (
            SELECT 1 FROM ${fq('fact_ton_kho_moi_nhat')} t
            WHERE t.spu_key = d.spu_key AND t.kho = ${k}
              AND t.ngay = (
                SELECT max(t2.ngay) FROM ${fq('fact_ton_kho_moi_nhat')} t2
                WHERE t2.ngay BETWEEN ${pFrom}::date AND ${pTo}::date AND t2.kho = ${k}
              )
              AND coalesce(t.inventory_qty,0) <> 0
          )
        )`;
    }
    // Placeholders cho list bỏ thủ công — tạo 1 lần, dùng lại trong các query (cùng mảng spuP)
    const boKeys = SPU_BO_THU_CONG.map((k) => k.toUpperCase());
    const boIn = sqlInList(spuP, boKeys); // vd $1,$2
    const notBo = boIn ? `AND upper(d.spu_key) NOT IN (${boIn})` : '';
    const isBo = boIn ? `upper(d.spu_key) IN (${boIn})` : 'false';
    const orBo = boIn ? `OR ${isBo}` : '';

    const spuBreak = (
      await c.query(
        `
      SELECT
        count(*)::int AS tong_dim,
        count(*) FILTER (
          WHERE coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
            ${notBo.replace(/^\s*AND/, 'AND')}
        )::int AS so_spu,
        count(*) FILTER (WHERE d.phan_khuc = 'Mã trung gian')::int AS bo_trung_gian,
        count(*) FILTER (WHERE d.phan_khuc = 'Dịch vụ/Đặt hàng')::int AS bo_dich_vu,
        count(*) FILTER (WHERE ${isBo})::int AS bo_thu_cong
      FROM ${fq('dim_spu')} d
      WHERE 1=1 ${spuDim} ${dimActive('d')} ${khoSpu}`,
        spuP
      )
    ).rows[0];

    const spuByPk = (
      await c.query(
        `
      SELECT coalesce(d.phan_khuc,'(trống)') AS phan_khuc,
             count(*)::int AS so_ma,
             CASE
               WHEN coalesce(d.phan_khuc,'') IN ('Mã trung gian','Dịch vụ/Đặt hàng') THEN false
               ELSE true
             END AS tinh_vao_tong
      FROM ${fq('dim_spu')} d
      WHERE 1=1 ${spuDim} ${dimActive('d')} ${khoSpu} ${notBo}
      GROUP BY d.phan_khuc
      ORDER BY tinh_vao_tong DESC, so_ma DESC`,
        spuP
      )
    ).rows;

    const pFromBo = pushParams(spuP, from);
    const pToBo = pushParams(spuP, to);
    let banKho = '';
    if (q.kho && q.kho !== 'All') {
      banKho = `AND f.kho = ${pushParams(spuP, q.kho)}`;
    }
    const spuBo = (
      await c.query(
        `
      SELECT d.spu_key, d.ten_san_pham, d.loai_ma, d.phan_khuc, d.chung_loai_pos,
             (${isBo}) AS bo_thu_cong,
             coalesce(ban.dt, 0)::float AS dt
      FROM ${fq('dim_spu')} d
      LEFT JOIN (
        SELECT f.spu_key, sum(f.order_revenue_vnd)::float AS dt
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay BETWEEN ${pFromBo}::date AND ${pToBo}::date ${banKho}
        GROUP BY f.spu_key
      ) ban ON ban.spu_key = d.spu_key
      WHERE (
          coalesce(d.phan_khuc,'') IN ('Mã trung gian','Dịch vụ/Đặt hàng')
          ${orBo}
        ) ${spuDim} ${dimActive('d')} ${khoSpu}
      ORDER BY bo_thu_cong DESC, coalesce(ban.dt,0) DESC, d.phan_khuc, d.spu_key`,
        spuP
      )
    ).rows;

    const spuBanKy = (
      await c.query(
        `
      SELECT count(DISTINCT f.spu_key)::int AS so_spu_co_ban
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${ff.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}`,
        p
      )
    ).rows[0];

    const byKho = (
      await c.query(
        `
      SELECT f.kho,
             sum(f.order_revenue_vnd)::float AS dt,
             sum(f.don_chot)::float AS don,
             sum(f.so_luong)::float AS sl,
             CASE WHEN sum(f.don_chot)=0 THEN NULL
                  ELSE sum(f.order_revenue_vnd)/sum(f.don_chot) END AS tb_don
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${ff.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
      GROUP BY f.kho ORDER BY dt DESC`,
        p
      )
    ).rows;

    const pMa = [from, to];
    const ffMa = factFilters(q, pMa, 'f', 'dx');
    const byMa = (
      await c.query(
        `
      SELECT coalesce(nullif(btrim(d.ma_cu_moi),''),'Mã cũ') AS ma_cu_moi,
             sum(f.order_revenue_vnd)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      ${ffMa.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffMa.where}
      GROUP BY 1 ORDER BY dt DESC`,
        pMa
      )
    ).rows;

    const daily = (
      await c.query(
        `
      SELECT f.ngay::text AS ngay, sum(f.order_revenue_vnd)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      ${ff.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ff.where}
      GROUP BY f.ngay ORDER BY f.ngay`,
        p
      )
    ).rows;

    const pTg = [from, to];
    const ffTg = factFilters(q, pTg, 'f', 'dx');
    const trungGian = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      ${ffTg.join}
      WHERE f.ngay BETWEEN $1::date AND $2::date ${ffTg.where}
        AND d.phan_khuc = 'Mã trung gian'`,
        pTg
      )
    ).rows[0];

    // Giống PBI: fact_po_moi_nhat + quá hạn so với TODAY() (PO không có cột kho)
    const pPo = [];
    const ffPo = factFilters(q, pPo, 'po', 'd', { skipKho: true });
    const po = (
      await c.query(
        `
      SELECT coalesce(sum(po.so_luong_con_thieu),0)::float AS dang_ve,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao < CURRENT_DATE),0)::float AS qua_han
      FROM ${fq('fact_po_moi_nhat')} po
      ${ffPo.join}
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${ffPo.where}`,
        pPo
      )
    ).rows[0];

    const benchmark = daily.length ? daily.reduce((s, r) => s + r.dt, 0) / daily.length : 0;

    return {
      from,
      to,
      kpi: {
        ...kpi,
        so_spu: spuBreak.so_spu,
        tb_don: kpi.don ? kpi.dt / kpi.don : null,
        benchmark,
        dt_trung_gian: trungGian.dt,
        hang_dang_ve: po.dang_ve,
        sl_qua_han: po.qua_han,
      },
      spuMeta: {
        tong_dim: spuBreak.tong_dim,
        so_spu: spuBreak.so_spu,
        bo_trung_gian: spuBreak.bo_trung_gian,
        bo_dich_vu: spuBreak.bo_dich_vu,
        so_spu_co_ban: spuBanKy.so_spu_co_ban,
        byPk: spuByPk,
        bo: spuBo,
        bo_thu_cong: spuBreak.bo_thu_cong,
        cong_thuc: `${spuBreak.tong_dim} dim − ${spuBreak.bo_dich_vu} DV − ${spuBreak.bo_trung_gian} TG − ${spuBreak.bo_thu_cong || 0} thủ công = ${spuBreak.so_spu}`,
      },
      byKho,
      byMa,
      daily,
    };
  });
}

async function sanPham(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const p = [from, to];
    if (q.kho && q.kho !== 'All') p; // kho via where below
    let where = '';
    if (q.kho && q.kho !== 'All') where += ` AND f.kho = ${pushParams(p, q.kho)}`;
    where += dimWhere(q, p, 'd');

    const byPk = (
      await c.query(
        `
      SELECT d.phan_khuc, sum(f.order_revenue_vnd)::float AS dt, sum(f.so_luong)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND d.phan_khuc IN ('Bán chạy','Bán thường','Bán chậm')
      GROUP BY 1 ORDER BY dt DESC`,
        p
      )
    ).rows;

    // Tỷ trọng = DT nhóm / tổng DT các nhóm × 100
    const byNhom = (
      await c.query(
        `
      WITH cur AS (
        SELECT coalesce(nullif(d.chung_loai,''),'(trống)') AS nhom,
               sum(f.order_revenue_vnd)::float AS dt
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
        WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
          AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
        GROUP BY 1
      ),
      tot AS (SELECT nullif(sum(dt),0) AS tong FROM cur)
      SELECT c.nhom, c.dt,
             round((c.dt / tot.tong * 100)::numeric, 1)::float AS ty_trong_pct
      FROM cur c, tot
      ORDER BY c.dt DESC
      LIMIT 10`,
        p
      )
    ).rows;

    const top = (
      await c.query(
        `
      SELECT f.spu_key, d.spunew, d.ten_san_pham, d.phan_khuc,
             sum(f.order_revenue_vnd)::float AS dt, sum(f.so_luong)::float AS sl
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND coalesce(d.phan_khuc,'') NOT IN ('Mã trung gian','Dịch vụ/Đặt hàng')
      GROUP BY 1,2,3,4 ORDER BY dt DESC LIMIT 50`,
        p
      )
    ).rows;

    const warn = (
      await c.query(
        `
      SELECT coalesce(sum(f.order_revenue_vnd),0)::float AS dt
      FROM ${fq('fact_doanh_thu_moi_nhat')} f
      JOIN ${fq('dim_spu')} d ON d.spu_key = f.spu_key
      WHERE f.ngay BETWEEN $1::date AND $2::date ${where}
        AND d.phan_khuc = 'Mã trung gian'`,
        p
      )
    ).rows[0];

    return { from, to, byPk, byNhom, top, warn_dt: warn.dt };
  });
}

/** Giống PBI: VAR d = MAX(fact_ton_kho[ngay]) trong kỳ → chỉ SUM tồn ngày d (không cộng cả kỳ). */
async function tonCuoiKyNgay(c, from, to, kho) {
  const p = [from, to];
  let khoSql = '';
  if (kho && kho !== 'All') khoSql = ` AND t.kho = ${pushParams(p, kho)}`;

  let asOf = (
    await c.query(
      `SELECT max(t.ngay)::text AS d
       FROM ${fq('fact_ton_kho_moi_nhat')} t
       WHERE t.ngay BETWEEN $1::date AND $2::date ${khoSql}`,
      p
    )
  ).rows[0].d;

  // Không có dòng trong kỳ → lùi về ngày tồn gần nhất ≤ cuối kỳ
  if (!asOf) {
    const p2 = [to];
    let kho2 = '';
    if (kho && kho !== 'All') kho2 = ` AND t.kho = ${pushParams(p2, kho)}`;
    asOf = (
      await c.query(
        `SELECT max(t.ngay)::text AS d
         FROM ${fq('fact_ton_kho_moi_nhat')} t
         WHERE t.ngay <= $1::date ${kho2}`,
        p2
      )
    ).rows[0].d;
  }

  return asOf;
}

async function tonKho(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const asOf = await tonCuoiKyNgay(c, from, to, q.kho);
    if (!asOf) {
      return {
        from,
        to,
        asOf: null,
        kpi: { sl: 0, gt: 0 },
        byKho: [],
        matrix: [],
        tonXau: [],
      };
    }

    const p = [asOf];
    let where = '';
    if (q.kho && q.kho !== 'All') where += ` AND t.kho = ${pushParams(p, q.kho)}`;
    const needDim =
      (q.phan_khuc && q.phan_khuc !== 'All') || (q.phan_nhom && q.phan_nhom !== 'All');
    const dimJoin = needDim
      ? ` JOIN ${fq('dim_spu')} dfl ON dfl.spu_key = t.spu_key`
      : '';
    if (needDim) where += dimWhere(q, p, 'dfl');

    const kpi = (
      await c.query(
        `
      SELECT coalesce(sum(t.inventory_qty),0)::float AS sl,
             coalesce(sum(t.inventory_value),0)::float AS gt
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      ${dimJoin}
      WHERE t.ngay = $1::date ${where}`,
        p
      )
    ).rows[0];

    const byKho = (
      await c.query(
        `
      SELECT t.kho,
             sum(t.inventory_qty)::float AS sl,
             sum(t.inventory_value)::float AS gt
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      ${dimJoin}
      WHERE t.ngay = $1::date ${where}
      GROUP BY t.kho ORDER BY gt DESC`,
        p
      )
    ).rows;

    const pMx = [asOf];
    let wMx = '';
    if (q.kho && q.kho !== 'All') wMx += ` AND t.kho = ${pushParams(pMx, q.kho)}`;
    wMx += dimWhere(q, pMx, 'd');
    const matrix = (
      await c.query(
        `
      SELECT t.kho, d.phan_khuc,
             sum(t.inventory_qty)::float AS sl,
             sum(t.inventory_value)::float AS gt
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      JOIN ${fq('dim_spu')} d ON d.spu_key = t.spu_key
      WHERE t.ngay = $1::date ${wMx}
        AND coalesce(t.inventory_qty,0) <> 0
        AND d.phan_khuc IS NOT NULL
      GROUP BY t.kho, d.phan_khuc
      ORDER BY t.kho, d.phan_khuc`,
        pMx
      )
    ).rows;

    const tonXau = (
      await c.query(
        `
      SELECT t.spu_key, d.ten_san_pham, d.phan_khuc, d.chung_loai, t.kho,
             sum(t.inventory_qty)::float AS sl,
             sum(t.inventory_value)::float AS gt
      FROM ${fq('fact_ton_kho_moi_nhat')} t
      JOIN ${fq('dim_spu')} d ON d.spu_key = t.spu_key
      WHERE t.ngay = $1::date ${wMx}
        AND d.phan_khuc = 'Tồn xấu'
        AND coalesce(t.inventory_qty,0) <> 0
      GROUP BY t.spu_key, d.ten_san_pham, d.phan_khuc, d.chung_loai, t.kho
      ORDER BY sl DESC, gt DESC
      LIMIT 200`,
        pMx
      )
    ).rows;

    return { from, to, asOf, kpi, byKho, matrix, tonXau };
  });
}

async function hangDangVe(q) {
  const { to } = parseRange(q);
  return withDb(async (c) => {
    const p = [];
    let where = dimWhere(q, p, 'd');
    if (q.kho && q.kho !== 'All') {
      // PO không có cột kho — bỏ qua kho filter trên PO
    }

    const kpi = (
      await c.query(
        `
      SELECT count(DISTINCT po.ma_po)::int AS so_po,
             coalesce(sum(po.so_luong_con_thieu),0)::float AS dang_ve,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao < CURRENT_DATE),0)::float AS qua_han,
             coalesce(sum(po.so_luong_con_thieu) FILTER (
               WHERE po.han_giao >= CURRENT_DATE AND po.han_giao <= CURRENT_DATE + 7),0)::float AS sap_han,
             coalesce(sum(po.so_luong_con_thieu) FILTER (WHERE po.han_giao > CURRENT_DATE + 7),0)::float AS con_han
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}`,
        p
      )
    ).rows[0];

    const bySpu = (
      await c.query(
        `
      SELECT po.spu_key, coalesce(d.ten_san_pham, po.spu_key) AS ten,
             sum(po.so_luong_con_thieu)::float AS sl
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}
      GROUP BY po.spu_key, coalesce(d.ten_san_pham, po.spu_key)
      ORDER BY sl DESC LIMIT 15`,
        p
      )
    ).rows;

    const rows = (
      await c.query(
        `
      SELECT po.ma_po, po.spu_key, po.sku, po.nha_cung_cap,
             po.han_giao::text AS han_giao,
             po.so_luong_con_thieu::float AS dang_ve,
             d.phan_khuc,
             CASE
               WHEN po.han_giao < CURRENT_DATE THEN 'Quá hạn'
               WHEN po.han_giao <= CURRENT_DATE + 7 THEN 'Sắp đến hạn'
               ELSE 'Còn hạn'
             END AS flag_eta
      FROM ${fq('fact_po_moi_nhat')} po
      LEFT JOIN ${fq('dim_spu')} d ON d.spu_key = po.spu_key
      WHERE coalesce(po.so_luong_con_thieu,0) > 0 ${where}
      ORDER BY
        CASE
          WHEN po.han_giao < CURRENT_DATE THEN 0
          WHEN po.han_giao <= CURRENT_DATE + 7 THEN 1
          ELSE 2
        END,
        po.han_giao,
        po.so_luong_con_thieu DESC
      LIMIT 300`,
        p
      )
    ).rows;

    return { asOf: to, kpi, bySpu, rows };
  });
}

async function hanhDong(q) {
  const { from, to } = parseRange(q);
  return withDb(async (c) => {
    const asOf = await tonCuoiKyNgay(c, from, to, q.kho);
    if (!asOf) {
      return {
        asOf: null,
        from,
        to,
        banChay: { rows: [], total: { ton_sl: 0, ton_gt: 0, dt: 0, sl_ban: 0, dang_ve: 0 } },
        tonXau: { rows: [], total: { ton_sl: 0, ton_gt: 0, dt: 0, sl_ban: 0, dang_ve: 0 } },
        banCham: { rows: [], total: { ton_sl: 0, ton_gt: 0, dt: 0, sl_ban: 0, dang_ve: 0 } },
      };
    }

    const p = [from, to, asOf];
    let khoSqlT = '';
    let khoSqlF = '';
    if (q.kho && q.kho !== 'All') {
      khoSqlT = ` AND t.kho = $4`;
      khoSqlF = ` AND f.kho = $4`;
      p.push(q.kho);
    }

    const rows = (
      await c.query(
        `
      WITH ton AS (
        SELECT t.spu_key, t.kho,
               sum(t.inventory_qty)::float AS ton_sl,
               sum(t.inventory_value)::float AS ton_gt
        FROM ${fq('fact_ton_kho_moi_nhat')} t
        WHERE t.ngay = $3::date ${khoSqlT}
        GROUP BY t.spu_key, t.kho
        HAVING sum(t.inventory_qty) <> 0
      ),
      ban AS (
        SELECT f.spu_key, f.kho,
               sum(f.order_revenue_vnd)::float AS dt,
               sum(f.so_luong)::float AS sl
        FROM ${fq('fact_doanh_thu_moi_nhat')} f
        WHERE f.ngay BETWEEN $1::date AND $2::date ${khoSqlF}
        GROUP BY f.spu_key, f.kho
      ),
      po AS (
        SELECT po.spu_key, sum(po.so_luong_con_thieu)::float AS dang_ve
        FROM ${fq('fact_po_moi_nhat')} po
        WHERE coalesce(po.so_luong_con_thieu,0) > 0
        GROUP BY po.spu_key
      )
      SELECT d.spu_key, d.ten_san_pham, d.phan_khuc, ton.kho,
             ton.ton_sl, ton.ton_gt,
             coalesce(ban.dt,0)::float AS dt,
             coalesce(ban.sl,0)::float AS sl_ban,
             coalesce(po.dang_ve,0)::float AS dang_ve,
             CASE
               WHEN d.phan_khuc = 'Bán chạy' THEN 'Ưu tiên nhận/QC/lên kệ'
               WHEN d.phan_khuc = 'Tồn xấu' THEN 'Xả tồn / cắt đặt'
               WHEN d.phan_khuc = 'Bán chậm' THEN 'Theo dõi — hạn chế nhập'
               ELSE ''
             END AS goi_y
      FROM ton
      JOIN ${fq('dim_spu')} d ON d.spu_key = ton.spu_key
      LEFT JOIN ban ON ban.spu_key = ton.spu_key AND ban.kho = ton.kho
      LEFT JOIN po ON po.spu_key = ton.spu_key
      WHERE d.phan_khuc IN ('Bán chạy','Tồn xấu','Bán chậm')
        ${q.phan_nhom && q.phan_nhom !== 'All' ? `AND d.chung_loai = $${p.length + 1}` : ''}
        ${q.phan_khuc && q.phan_khuc !== 'All' ? `AND d.phan_khuc = $${p.length + (q.phan_nhom && q.phan_nhom !== 'All' ? 2 : 1)}` : ''}
      ORDER BY
        CASE d.phan_khuc WHEN 'Bán chạy' THEN 0 WHEN 'Tồn xấu' THEN 1 ELSE 2 END,
        ton.ton_gt DESC`,
        (() => {
          const params = [...p];
          if (q.phan_nhom && q.phan_nhom !== 'All') params.push(q.phan_nhom);
          if (q.phan_khuc && q.phan_khuc !== 'All') params.push(q.phan_khuc);
          return params;
        })()
      )
    ).rows;

    const group = (pk) => rows.filter((r) => r.phan_khuc === pk);
    const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);

    const pack = (pk) => {
      const list = group(pk);
      return {
        rows: list.slice(0, 40),
        total: {
          ton_sl: sum(list, 'ton_sl'),
          ton_gt: sum(list, 'ton_gt'),
          dt: sum(list, 'dt'),
          sl_ban: sum(list, 'sl_ban'),
          dang_ve: sum(list, 'dang_ve'),
        },
      };
    };

    return {
      asOf,
      from,
      to,
      banChay: pack('Bán chạy'),
      tonXau: pack('Tồn xấu'),
      banCham: pack('Bán chậm'),
    };
  });
}

async function spuCheck(q) {
  const key = String(q.key || q.spu || '')
    .trim()
    .toUpperCase();
  if (!key) return { key: '', found: false };
  return withDb(async (c) => {
    const r = (
      await c.query(
        `
      SELECT spu_key, ten_san_pham, loai_ma, phan_khuc, chung_loai, chung_loai_pos,
             ma_cu_moi, sl_30_ngay::float AS sl_30_ngay, trong_danh_muc
      FROM ${fq('dim_spu')}
      WHERE upper(spu_key) = $1
         OR upper(coalesce(spu_goc,'')) LIKE '%' || $1 || '%'
      ORDER BY CASE WHEN upper(spu_key)=$1 THEN 0 ELSE 1 END
      LIMIT 5`,
        [key]
      )
    ).rows;
    if (!r.length) return { key, found: false, rows: [] };
    const rows = r.map((x) => ({
      ...x,
      tinh_vao_tong:
        !['Mã trung gian', 'Dịch vụ/Đặt hàng'].includes(x.phan_khuc || '') &&
        !isBoThuCong(x.spu_key),
      bo_thu_cong: isBoThuCong(x.spu_key),
    }));
    return { key, found: true, rows };
  });
}

module.exports = {
  overview,
  sanPham,
  tonKho,
  hangDangVe,
  hanhDong,
  spuCheck,
  filterOptions,
};
