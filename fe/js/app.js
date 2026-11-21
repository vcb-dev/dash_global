const state = {
  page: 'overview',
  from: '2026-10-01',
  to: '2026-11-20',
  kho: 'All',
  phan_khuc: 'All',
  phan_nhom: 'All',
  user: null,
  filterOpts: { phan_khuc: [], phan_nhom: [] },
};

const PAGES = [
  { id: 'overview', label: 'Tổng quan điều hành' },
  { id: 'san-pham', label: 'Sản phẩm & phân khúc' },
  { id: 'ton-kho', label: 'Tồn kho cuối kỳ' },
  {
    id: 'hang-dang-ve',
    label: 'Hàng đang về — ETA',
    title: 'Hàng đang về — theo dõi ETA',
    note: 'Đỏ = Quá hạn · Cam = Sắp đến hạn (≤7 ngày) · Xanh = Còn hạn',
  },
  { id: 'hanh-dong', label: 'Hành động tuần này' },
];

function apiOrigin() {
  const base = (window.API_BASE || '').replace(/\/$/, '');
  return base || location.origin;
}

async function api(path) {
  const u = new URL(path, apiOrigin() + '/');
  u.searchParams.set('from', state.from);
  u.searchParams.set('to', state.to);
  if (state.kho && state.kho !== 'All') u.searchParams.set('kho', state.kho);
  if (state.phan_khuc && state.phan_khuc !== 'All') u.searchParams.set('phan_khuc', state.phan_khuc);
  if (state.phan_nhom && state.phan_nhom !== 'All') u.searchParams.set('phan_nhom', state.phan_nhom);
  const res = await fetch(u.toString(), { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function optList(values, selected) {
  return `<option value="All" ${selected === 'All' ? 'selected' : ''}>Tất cả</option>${(values || [])
    .map((v) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${v}</option>`)
    .join('')}`;
}

function badgePk(pk) {
  const map = {
    'Tồn xấu': 'xau',
    'Bán chạy': 'chay',
    'Bán chậm': 'cham',
    'Bán thường': 'thuong',
  };
  return `<span class="badge ${map[pk] || ''}">${pk || ''}</span>`;
}

function shell(title, note) {
  return `
  <aside class="sidebar">
    <div class="brand">Pancake BI</div>
    <nav class="nav">
      ${PAGES.map(
        (p) =>
          `<a href="#${p.id}" class="${state.page === p.id ? 'active' : ''}" data-page="${p.id}">${p.label}</a>`
      ).join('')}
    </nav>
    <div class="user-box">
      <div>${state.user?.name || 'Pancake BI'}</div>
      <div class="muted" style="color:#cbd5e1">Nội bộ</div>
    </div>
  </aside>
  <main class="main">
    <div class="topbar">
      <div>
        <h1>${title}</h1>
        <p class="page-note"${note ? '' : ' hidden'}>${note || ''}</p>
      </div>
      <div class="filters">
        <label class="field">Từ ngày<input type="date" id="from" value="${state.from}"></label>
        <label class="field">Đến ngày<input type="date" id="to" value="${state.to}"></label>
        <div class="field">
          <span>Kho</span>
          <div class="seg" id="khoSeg">
            <button type="button" class="seg-btn ${state.kho === 'All' ? 'on' : ''}" data-kho="All">Tất cả</button>
            <button type="button" class="seg-btn ${state.kho === 'KHO NHẬT BẢN' ? 'on' : ''}" data-kho="KHO NHẬT BẢN">Nhật</button>
            <button type="button" class="seg-btn ${state.kho === 'KHO THÁI LAN' ? 'on' : ''}" data-kho="KHO THÁI LAN">Thái</button>
          </div>
        </div>
        <label class="field">Phân khúc
          <select id="phan_khuc">${optList(state.filterOpts.phan_khuc, state.phan_khuc)}</select>
        </label>
        <label class="field">Phân nhóm
          <select id="phan_nhom">${optList(state.filterOpts.phan_nhom, state.phan_nhom)}</select>
        </label>
        <button class="btn" id="apply">Áp dụng</button>
      </div>
    </div>
    <div id="content"><div class="loading">Đang tải…</div></div>
  </main>`;
}

function readFiltersFromDom() {
  const from = document.getElementById('from');
  const to = document.getElementById('to');
  const pk = document.getElementById('phan_khuc');
  const nh = document.getElementById('phan_nhom');
  if (from) state.from = from.value;
  if (to) state.to = to.value;
  if (pk) state.phan_khuc = pk.value;
  if (nh) state.phan_nhom = nh.value;
}

function bindChrome() {
  document.querySelectorAll('[data-page]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      state.page = a.dataset.page;
      location.hash = state.page;
      render({ full: true });
    });
  });
  document.querySelectorAll('#khoSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.kho = btn.dataset.kho;
      readFiltersFromDom();
      document.querySelectorAll('#khoSeg .seg-btn').forEach((b) => b.classList.toggle('on', b === btn));
      render({ soft: true });
    });
  });
  document.getElementById('phan_khuc')?.addEventListener('change', () => {
    readFiltersFromDom();
    render({ soft: true });
  });
  document.getElementById('phan_nhom')?.addEventListener('change', () => {
    readFiltersFromDom();
    render({ soft: true });
  });
  document.getElementById('apply')?.addEventListener('click', () => {
    readFiltersFromDom();
    render({ soft: true });
  });
}

async function softSwap(html) {
  const el = document.getElementById('content');
  if (!el) return;
  el.classList.add('content-fade-out');
  await new Promise((r) => setTimeout(r, 140));
  el.innerHTML = html;
  el.classList.remove('content-fade-out');
  el.classList.add('content-fade-in');
  void el.offsetWidth;
  el.classList.remove('content-fade-in');
}

async function renderOverview(opts = {}) {
  const data = await api('/api/overview');
  const k = data.kpi;
  const m = data.spuMeta || {};
  const html = `
    <div class="kpi-row">
      <div class="kpi">
        <div class="label">Tổng SPU</div>
        <div class="value">${fmt.num(k.so_spu)}</div>
      </div>
      <div class="kpi"><div class="label">Doanh thu</div><div class="value">${fmt.money(k.dt)}</div></div>
      <div class="kpi"><div class="label">Đơn chốt</div><div class="value">${fmt.num(k.don)}</div></div>
      <div class="kpi"><div class="label">Số lượng bán</div><div class="value">${fmt.num(k.sl)}</div></div>
      <div class="kpi"><div class="label">Giá trị TB/đơn</div><div class="value">${fmt.moneyFull(k.tb_don)}</div></div>
      <div class="kpi warn"><div class="label">DT mã trung gian</div><div class="value">${fmt.money(k.dt_trung_gian)}</div></div>
      <div class="kpi danger"><div class="label">SL quá hạn</div><div class="value">${fmt.num(k.sl_qua_han)}</div></div>
      <div class="kpi ok"><div class="label">Hàng đang về</div><div class="value">${fmt.num(k.hang_dang_ve)}</div></div>
    </div>
    <div class="grid-3">
      <div class="card"><h2>Doanh thu theo kho</h2><div class="chart-box tall"><canvas id="cKho"></canvas></div></div>
      <div class="card"><h2>Tỷ trọng mã cũ và mã mới</h2><div class="chart-box tall"><canvas id="cMa"></canvas></div></div>
      <div class="card"><h2>Doanh thu theo ngày</h2><div class="chart-box tall"><canvas id="cDay"></canvas></div></div>
    </div>
    <div class="card">
      <h2>Chi tiết theo kho</h2>
      <div class="table-wrap">
        <table class="data" id="tblByKho">
          <thead><tr><th>Kho</th><th class="num">Doanh thu</th><th class="num">Đơn</th><th class="num">SL</th><th class="num">TB/đơn</th></tr></thead>
          <tbody>
            ${data.byKho
              .map(
                (r) => `<tr>
              <td>${r.kho}</td>
              <td class="num">${fmt.moneyFull(r.dt)}</td>
              <td class="num">${fmt.num(r.don)}</td>
              <td class="num">${fmt.num(r.sl)}</td>
              <td class="num">${fmt.moneyFull(r.tb_don)}</td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Tổng SPU — đang giữ / đang bỏ</h2>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <label class="muted">Tra mã</label>
        <input id="spuLookup" type="text" placeholder="C500391" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;min-width:160px" />
        <span id="spuLookupResult" class="muted"></span>
      </div>
      <div class="grid-2">
        <div>
          <h3 style="margin:0 0 8px;font-size:14px">Theo phân khúc</h3>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Phân khúc</th><th class="num">Số mã</th></tr></thead>
              <tbody>
                ${(m.byPk || [])
                  .map(
                    (r) => `<tr>
                  <td>${badgePk(r.phan_khuc)}</td>
                  <td class="num">${fmt.num(r.so_ma)}</td>
                </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 style="margin:0 0 8px;font-size:14px">Danh sách đang bỏ (${fmt.num((m.bo || []).length)})</h3>
          <div class="table-wrap">
            <table class="data" id="spuBoTable">
              <thead><tr><th>SPU</th><th>Tên</th><th>Loại mã</th><th>Phân khúc</th><th class="num">Doanh số</th></tr></thead>
              <tbody>
                ${(m.bo || [])
                  .map(
                    (r) => `<tr data-spu="${(r.spu_key || '').toUpperCase()}">
                  <td>${r.spu_key}${r.bo_thu_cong ? ' <span class="tag-danger">thủ công</span>' : ''}</td>
                  <td>${r.ten_san_pham || ''}</td>
                  <td>${r.loai_ma || ''}</td>
                  <td>${badgePk(r.phan_khuc)}</td>
                  <td class="num">${fmt.moneyFull(r.dt)}</td>
                </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;

  await setContent(html, opts);
  bindSpuLookup();
  tableUtil.enhance(document.getElementById('tblByKho'), { sortCols: [1, 2, 3, 4] });
  tableUtil.enhance(document.getElementById('spuBoTable'), { sortCols: [4] });
  charts.bar(
    'cKho',
    data.byKho.map((r) => r.kho.replace('KHO ', '')),
    data.byKho.map((r) => r.dt),
    { horizontal: true, color: '#252e80', thick: true, maxBarThickness: 56 }
  );
  charts.doughnut(
    'cMa',
    data.byMa.map((r) => r.ma_cu_moi),
    data.byMa.map((r) => r.dt),
    ['#1e3a8a', '#0f766e', '#64748b'],
    { legendNamesOnly: true }
  );
  charts.line(
    'cDay',
    data.daily.map((r) => r.ngay.slice(8) + '/' + r.ngay.slice(5, 7)),
    data.daily.map((r) => r.dt),
    k.benchmark
  );
}

function bindSpuLookup() {
  const lookup = document.getElementById('spuLookup');
  const lookupOut = document.getElementById('spuLookupResult');
  if (!lookup) return;
  let lookupTimer = null;
  lookup.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    const q = lookup.value.trim();
    if (!q) {
      lookupOut.textContent = '';
      return;
    }
    lookupTimer = setTimeout(async () => {
      try {
        const res = await api(`/api/spu-check?key=${encodeURIComponent(q)}`);
        if (!res.found) {
          lookupOut.innerHTML = `<b>${q}</b> — <span class="danger">không có trong dim_spu</span>`;
          return;
        }
        lookupOut.innerHTML = res.rows
          .map((r) => {
            const tag = r.tinh_vao_tong
              ? '<span class="tag-ok">GIỮ trong Tổng SPU</span>'
              : '<span class="tag-danger">BỎ khỏi Tổng SPU</span>';
            const note = r.bo_thu_cong ? ' (thủ công)' : '';
            return `<b>${r.spu_key}</b> · ${r.ten_san_pham || ''} · ${badgePk(r.phan_khuc)} · ${tag}${note}`;
          })
          .join('<br/>');
      } catch (e) {
        lookupOut.textContent = String(e.message || e);
      }
    }, 250);
  });
}

async function renderSanPham(opts = {}) {
  const data = await api('/api/san-pham');
  const html = `
    <div class="kpi-row">
      <div class="kpi warn"><div class="label">⚠ Doanh thu mã trung gian</div><div class="value">${fmt.money(data.warn_dt)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Doanh thu theo phân khúc</h2><div class="chart-box tall"><canvas id="cPk"></canvas></div></div>
      <div class="card"><h2>Doanh thu theo phân nhóm</h2><div class="chart-box tall"><canvas id="cNhom"></canvas></div></div>
    </div>
    <div class="card">
      <h2>Top sản phẩm</h2>
      <div class="table-wrap">
        <table class="data" id="tblTopSp">
          <thead><tr>
            <th>Phân khúc</th><th>SPU</th><th>SPU new</th><th>Tên sản phẩm</th>
            <th class="num">Doanh thu</th><th class="num">SL bán</th>
          </tr></thead>
          <tbody>
            ${(data.top || [])
              .map(
                (r) => `<tr>
              <td>${badgePk(r.phan_khuc)}</td>
              <td>${r.spu_key}</td>
              <td>${r.spunew || ''}</td>
              <td>${r.ten_san_pham || ''}</td>
              <td class="num">${fmt.moneyFull(r.dt)}</td>
              <td class="num">${fmt.num(r.sl)}</td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  await setContent(html, opts);
  tableUtil.enhance(document.getElementById('tblTopSp'), {
    sortCols: [4, 5],
    searchCols: [1, 2],
    searchTh: 1,
    searchPlaceholder: 'Tìm SPU…',
  });
  charts.doughnut(
    'cPk',
    data.byPk.map((r) => r.phan_khuc),
    data.byPk.map((r) => r.dt),
    ['#2563eb', '#16a34a', '#ea580c'],
    { legendNamesOnly: true }
  );
  charts.barLineShare(
    'cNhom',
    data.byNhom.map((r) => r.nhom),
    data.byNhom.map((r) => r.dt),
    data.byNhom.map((r) => r.ty_trong_pct)
  );
}

async function renderTonKho(opts = {}) {
  const data = await api('/api/ton-kho');
  const pks = [...new Set(data.matrix.map((r) => r.phan_khuc))];
  const khos = [...new Set(data.matrix.map((r) => r.kho))];
  const cell = (kho, pk) => data.matrix.find((r) => r.kho === kho && r.phan_khuc === pk);

  const html = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">Giá trị tồn cuối kỳ</div><div class="value">${fmt.moneyFull(data.kpi.gt)}</div></div>
      <div class="kpi"><div class="label">Số lượng tồn cuối kỳ</div><div class="value">${fmt.num(data.kpi.sl)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Giá trị tồn theo kho</h2><div class="chart-box"><canvas id="cTonKho"></canvas></div></div>
      <div class="card">
        <h2>Phân khúc theo kho</h2>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th>Kho</th>${pks.map((p) => `<th class="num">${p}</th>`).join('')}<th class="num">Tổng SL</th></tr>
            </thead>
            <tbody>
              ${khos
                .map((kho) => {
                  let sum = 0;
                  const tds = pks
                    .map((pk) => {
                      const c = cell(kho, pk);
                      const sl = c ? Number(c.sl) : 0;
                      sum += sl;
                      return `<td class="num">${c ? `${fmt.num(c.sl)}<div class="muted">${fmt.money(c.gt)}</div>` : '—'}</td>`;
                    })
                    .join('');
                  return `<tr><td>${kho}</td>${tds}<td class="num"><b>${fmt.num(sum)}</b></td></tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Chi tiết tồn xấu</h2>
      <div class="table-wrap">
        <table class="data" id="tblTonXau">
          <thead><tr><th>SPU</th><th>Tên sản phẩm</th><th>Phân khúc</th><th>Phân nhóm</th><th>Kho</th><th class="num">Tồn cuối kỳ (SL)</th><th class="num">GT tồn</th></tr></thead>
          <tbody>
            ${data.tonXau
              .map(
                (r) => `<tr>
              <td>${r.spu_key}</td>
              <td>${r.ten_san_pham || ''}</td>
              <td>${badgePk(r.phan_khuc)}</td>
              <td>${r.chung_loai || ''}</td>
              <td>${r.kho}</td>
              <td class="num">${fmt.num(r.sl)}</td>
              <td class="num">${fmt.moneyFull(r.gt)}</td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  await setContent(html, opts);
  tableUtil.enhance(document.getElementById('tblTonXau'), {
    sortCols: [5, 6],
    searchCols: [0],
    searchTh: 0,
    searchPlaceholder: 'Tìm SPU…',
  });
  charts.bar(
    'cTonKho',
    data.byKho.map((r) => r.kho.replace('KHO ', '')),
    data.byKho.map((r) => r.gt),
    { horizontal: true, color: '#1d4ed8' }
  );
}

async function renderHangDangVe(opts = {}) {
  const data = await api('/api/hang-dang-ve');
  const k = data.kpi;
  const html = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">Số PO</div><div class="value">${fmt.num(k.so_po)}</div></div>
      <div class="kpi ok"><div class="label">Hàng đang về</div><div class="value">${fmt.num(k.dang_ve)}</div></div>
      <div class="kpi danger"><div class="label">SL quá hạn</div><div class="value">${fmt.num(k.qua_han)}</div></div>
      <div class="kpi warn"><div class="label">SL sắp đến hạn (≤7 ngày)</div><div class="value">${fmt.num(k.sap_han)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Hàng đang về by Flag ETA</h2><div class="chart-box"><canvas id="cEta"></canvas></div></div>
      <div class="card"><h2>Hàng đang về theo SPU</h2><div class="chart-box"><canvas id="cSpu"></canvas></div></div>
    </div>
    <div class="card">
      <h2>Chi tiết PO</h2>
      <div class="table-wrap">
        <table class="data" id="tblPo">
          <thead><tr><th>Flag ETA</th><th>Hạn giao</th><th>Mã PO</th><th>SPU</th><th>SKU</th><th>Phân khúc</th><th class="num">Hàng đang về</th><th>NCC</th></tr></thead>
          <tbody>
            ${data.rows
              .map((r) => {
                const cls =
                  r.flag_eta === 'Quá hạn' ? 'eta-qh' : r.flag_eta === 'Sắp đến hạn' ? 'eta-sh' : 'eta-ch';
                return `<tr>
                <td><span class="badge ${cls}">${r.flag_eta}</span></td>
                <td>${r.han_giao || ''}</td>
                <td>${r.ma_po || ''}</td>
                <td>${r.spu_key || ''}</td>
                <td>${r.sku || ''}</td>
                <td>${r.phan_khuc || ''}</td>
                <td class="num">${fmt.num(r.dang_ve)}</td>
                <td>${r.nha_cung_cap || ''}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  await setContent(html, opts);
  tableUtil.enhance(document.getElementById('tblPo'), {
    sortCols: [6],
    searchCols: [3, 4, 2],
    searchTh: 3,
    searchPlaceholder: 'Tìm SPU…',
  });
  charts.doughnut(
    'cEta',
    ['Quá hạn', 'Sắp đến hạn', 'Còn hạn'],
    [k.qua_han, k.sap_han, k.con_han],
    ['#dc2626', '#ea580c', '#16a34a'],
    { format: 'num', legendNamesOnly: true }
  );
  charts.bar(
    'cSpu',
    data.bySpu.map((r) => r.spu_key),
    data.bySpu.map((r) => r.sl),
    { horizontal: true, color: '#0f766e', format: 'num' }
  );
}

function actionTable(title, pack, tableId) {
  const t = pack.total;
  return `
    <div class="card" style="min-height:auto;margin-bottom:14px">
      <h2>${title}</h2>
      <div class="table-wrap">
        <table class="data" id="${tableId}">
          <thead>
            <tr>
              <th>SPU</th><th>Tên sản phẩm</th><th>Phân khúc</th><th>Kho</th>
              <th class="num">Tồn cuối kỳ (SL)</th><th class="num">GT tồn</th>
              <th class="num">Doanh thu</th><th class="num">SL bán</th>
              <th class="num">Hàng đang về</th><th>Gợi ý</th>
            </tr>
          </thead>
          <tbody>
            ${pack.rows
              .map(
                (r) => `<tr>
              <td>${r.spu_key}</td>
              <td>${r.ten_san_pham || ''}</td>
              <td>${badgePk(r.phan_khuc)}</td>
              <td>${r.kho}</td>
              <td class="num">${fmt.num(r.ton_sl)}</td>
              <td class="num">${fmt.moneyFull(r.ton_gt)}</td>
              <td class="num">${fmt.moneyFull(r.dt)}</td>
              <td class="num">${fmt.num(r.sl_ban)}</td>
              <td class="num">${fmt.num(r.dang_ve)}</td>
              <td>${r.goi_y || ''}</td>
            </tr>`
              )
              .join('')}
          </tbody>
          <tfoot>
            <tr class="row-total">
              <td colspan="4">Tổng</td>
              <td class="num">${fmt.num(t.ton_sl)}</td>
              <td class="num">${fmt.moneyFull(t.ton_gt)}</td>
              <td class="num">${fmt.moneyFull(t.dt)}</td>
              <td class="num">${fmt.num(t.sl_ban)}</td>
              <td class="num">${fmt.num(t.dang_ve)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

async function renderHanhDong(opts = {}) {
  const data = await api('/api/hanh-dong');
  const html = `
    ${actionTable('Ưu tiên về hàng / giữ stock (Bán chạy)', data.banChay, 'tblHdBanChay')}
    ${actionTable('Xả tồn / cắt đặt (Tồn xấu)', data.tonXau, 'tblHdTonXau')}
    ${actionTable('Theo dõi (Bán chậm)', data.banCham, 'tblHdBanCham')}
  `;
  await setContent(html, opts);
  ['tblHdBanChay', 'tblHdTonXau', 'tblHdBanCham'].forEach((id) => {
    tableUtil.enhance(document.getElementById(id), {
      sortCols: [4, 5, 6, 7, 8],
      searchCols: [0],
      searchTh: 0,
      searchPlaceholder: 'Tìm SPU…',
    });
  });
}

async function setContent(html, opts = {}) {
  const el = document.getElementById('content');
  if (!el) return;
  if (opts.soft) {
    el.classList.add('is-loading');
    await softSwap(html);
    el.classList.remove('is-loading');
  } else {
    el.innerHTML = html;
  }
}

async function render(opts = {}) {
  const soft = !!opts.soft && !opts.full && document.getElementById('content');
  const pageMeta = PAGES.find((p) => p.id === state.page) || {};
  const pageTitle = pageMeta.title || pageMeta.label || '';

  if (!soft) {
    document.getElementById('app').innerHTML = `<div class="app-shell">${shell(pageTitle, pageMeta.note)}</div>`;
    bindChrome();
  } else {
    const h1 = document.querySelector('.topbar h1');
    if (h1) h1.textContent = pageTitle;
    const noteEl = document.querySelector('.topbar .page-note');
    if (noteEl) {
      if (pageMeta.note) {
        noteEl.hidden = false;
        noteEl.textContent = pageMeta.note;
      } else {
        noteEl.hidden = true;
        noteEl.textContent = '';
      }
    }
  }

  try {
    const pageOpts = soft ? { soft: true } : {};
    if (state.page === 'overview') await renderOverview(pageOpts);
    else if (state.page === 'san-pham') await renderSanPham(pageOpts);
    else if (state.page === 'ton-kho') await renderTonKho(pageOpts);
    else if (state.page === 'hang-dang-ve') await renderHangDangVe(pageOpts);
    else if (state.page === 'hanh-dong') await renderHanhDong(pageOpts);
  } catch (e) {
    const el = document.getElementById('content');
    if (el) el.innerHTML = `<div class="error">${e.message || e}</div>`;
  }
}

async function boot() {
  try {
    const me = await fetch(`${apiOrigin()}/api/me`, { credentials: 'include' }).then((r) => r.json());
    state.user = me.user || { name: 'Pancake BI', email: 'local' };
  } catch (_) {
    state.user = { name: 'Pancake BI', email: 'local' };
  }
  try {
    state.filterOpts = await api('/api/filters');
  } catch (_) {
    state.filterOpts = { phan_khuc: [], phan_nhom: [] };
  }
  const hash = location.hash.replace('#', '');
  if (PAGES.some((p) => p.id === hash)) state.page = hash;
  await render();
}

boot();
