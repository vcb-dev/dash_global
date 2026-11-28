import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiOrigin, clearApiCache, getJson } from './lib/api';
import { ChartFilterContext, toFullKho } from './lib/chartFilter';
import DayTonXau from './pages/DayTonXau';
import HangDangVe from './pages/HangDangVe';
import HanhDong from './pages/HanhDong';
import Login from './pages/Login';
import Overview from './pages/Overview';
import PhanTichDt from './pages/PhanTichDt';
import PheuDoanhThu from './pages/PheuDoanhThu';
import SanPham from './pages/SanPham';
import TonKho from './pages/TonKho';
import DateField, { nearestValid } from './components/DateField';

const PAGES = [
  {
    id: 'pheu-doanh-thu',
    label: 'Phễu doanh thu',
    short: 'Phễu DT',
    group: 'Điều hành',
    title: 'Phễu doanh thu',
    note: 'Theo dõi hành trình đơn hàng từ chốt → xuất → thành công',
  },
  { id: 'overview', label: 'Tổng quan điều hành', short: 'Tổng quan', group: 'Điều hành' },
  {
    id: 'hanh-dong',
    label: 'Hành động tuần này',
    short: 'Hành động',
    group: 'Điều hành',
    title: 'Hành động tuần này',
  },
  {
    id: 'phan-tich-dt',
    label: 'Phân tích doanh thu',
    short: 'PT DT',
    group: 'Kinh doanh & sản phẩm',
    title: 'Phân tích doanh thu',
    note: 'So kỳ trước cùng độ dài · DT tổng đã loại Dịch vụ/Đặt hàng · Mã trung gian vẫn tính',
  },
  { id: 'san-pham', label: 'Sản phẩm & phân khúc', short: 'Sản phẩm', group: 'Kinh doanh & sản phẩm' },
  { id: 'ton-kho', label: 'Tồn kho cuối kỳ', short: 'Tồn kho', group: 'Tồn kho & cung ứng' },
  {
    id: 'day-ton-xau',
    label: 'Hiệu quả đẩy tồn xấu',
    short: 'Đẩy tồn',
    group: 'Tồn kho & cung ứng',
    title: 'Hiệu quả đẩy tồn xấu',
  },
  {
    id: 'hang-dang-ve',
    label: 'Hàng đang về & ETA',
    short: 'ETA',
    group: 'Tồn kho & cung ứng',
    title: 'Hàng đang về & ETA',
    note: 'Đỏ = Quá hạn · Cam = Sắp đến hạn (≤7 ngày) · Xanh = Còn hạn',
  },
];

const KHOS = [
  { id: 'All', label: 'Tất cả' },
  { id: 'KHO NHẬT BẢN', label: 'Nhật' },
  { id: 'KHO THÁI LAN', label: 'Thái' },
];

const DEFAULT_FROM = '2026-10-01';
const DEFAULT_TO = '2026-11-26';

function groupPages() {
  const groups = [];
  for (const p of PAGES) {
    let g = groups.find((x) => x.title === p.group);
    if (!g) {
      g = { title: p.group, items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }
  return groups;
}

export default function App() {
  const [page, setPage] = useState(() => {
    const hash = location.hash.replace('#', '');
    return PAGES.some((p) => p.id === hash) ? hash : 'pheu-doanh-thu';
  });
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [kho, setKho] = useState('All');
  const [phanKhuc, setPhanKhuc] = useState('All');
  const [phanNhom, setPhanNhom] = useState('All');
  const [maCuMoi, setMaCuMoi] = useState('All');
  const [spu, setSpu] = useState('All');
  const [spuInput, setSpuInput] = useState('');
  const [ngaySnapshot, setNgaySnapshot] = useState('');
  const [trangThaiDay, setTrangThaiDay] = useState('All');
  const [flagEta, setFlagEta] = useState('All');
  const [trangThai, setTrangThai] = useState('All');
  const [rangeBackup, setRangeBackup] = useState(null);
  const [rangeReady, setRangeReady] = useState(false);
  const [applied, setApplied] = useState({
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    kho: 'All',
    phan_khuc: 'All',
    phan_nhom: 'All',
    ma_cu_moi: 'All',
    spu: 'All',
    ngay_snapshot: '',
    trang_thai_day: 'All',
    flag_eta: 'All',
    trang_thai: 'All',
  });
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [filterOpts, setFilterOpts] = useState({ phan_khuc: [], phan_nhom: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debounceRef = useRef(null);
  const stateRef = useRef({});
  const filters = useMemo(() => applied, [applied]);
  const meta = PAGES.find((p) => p.id === page) || {};
  const navGroups = useMemo(() => groupPages(), []);

  stateRef.current = {
    from,
    to,
    kho,
    phanKhuc,
    phanNhom,
    maCuMoi,
    spu,
    spuInput,
    ngaySnapshot,
    trangThaiDay,
    flagEta,
    trangThai,
    rangeBackup,
  };

  useEffect(() => {
    getJson('/api/me')
      .then((me) => {
        setUser(me.authenticated ? me.user : null);
        setAuthReady(true);
      })
      .catch(() => {
        setUser(null);
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    api('/api/filters', applied)
      .then(setFilterOpts)
      .catch(() => setFilterOpts({ phan_khuc: [], phan_nhom: [], data_days: [], date_bounds: null }));
  }, [user]);

  const validDays = filterOpts.data_days || [];
  const dateBounds = filterOpts.date_bounds;

  useEffect(() => {
    if (!user || rangeReady || !dateBounds?.min || !dateBounds?.max) return;
    const { min, max } = dateBounds;
    const stillDefault = from === DEFAULT_FROM && to === DEFAULT_TO;
    let nextFrom = stillDefault ? min : from;
    let nextTo = stillDefault ? max : to;
    // Clamp nếu đang chọn vượt mốc data đã kéo (vd. 28 khi DT chỉ tới 25)
    if (nextTo > max) nextTo = max;
    if (nextFrom > max) nextFrom = min;
    if (nextFrom < min) nextFrom = min;
    if (nextFrom > nextTo) nextFrom = nextTo;
    setFrom(nextFrom);
    setTo(nextTo);
    if (stillDefault) setRangeBackup(null);
    setApplied((prev) => ({ ...prev, from: nextFrom, to: nextTo }));
    setRangeReady(true);
  }, [user, dateBounds, rangeReady, from, to]);

  function todayVn() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
  }

  function commitFrom(ymd) {
    const set = new Set(validDays);
    const cap = dateBounds?.max && dateBounds.max < todayVn() ? dateBounds.max : todayVn();
    let next = nearestValid(ymd, set, true);
    if (dateBounds?.min && next < dateBounds.min) next = dateBounds.min;
    if (next > cap) next = cap;
    if (to && next > to) next = nearestValid(to, set, false);
    setFrom(next);
    applySoon(buildFilters({ from: next }));
  }

  function commitTo(ymd) {
    const set = new Set(validDays);
    const cap = dateBounds?.max && dateBounds.max < todayVn() ? dateBounds.max : todayVn();
    let next = nearestValid(ymd, set, false);
    if (dateBounds?.min && next < dateBounds.min) next = dateBounds.min;
    if (next > cap) next = cap;
    if (from && next < from) next = nearestValid(from, set, true);
    setTo(next);
    applySoon(buildFilters({ to: next }));
  }
  useEffect(() => {
    location.hash = page;
  }, [page]);

  async function logout() {
    try {
      await fetch(`${apiOrigin()}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    clearApiCache();
    setUser(null);
  }

  function buildFilters(patch = {}) {
    const s = stateRef.current;
    return {
      from: s.from,
      to: s.to,
      kho: s.kho,
      phan_khuc: s.phanKhuc,
      phan_nhom: s.phanNhom,
      ma_cu_moi: s.maCuMoi,
      spu: s.spu,
      ngay_snapshot: s.ngaySnapshot,
      trang_thai_day: s.trangThaiDay,
      flag_eta: s.flagEta,
      trang_thai: s.trangThai,
      ...patch,
    };
  }

  /** Click chart/legend → lọc toàn trang (toggle lại = bỏ lọc). */
  const applyChartFilter = useCallback((patch) => {
    const s = stateRef.current;
    let nextFrom = s.from;
    let nextTo = s.to;
    let nextKho = s.kho;
    let nextPk = s.phanKhuc;
    let nextNhom = s.phanNhom;
    let nextMa = s.maCuMoi;
    let nextSpu = s.spu;
    let nextFlag = s.flagEta;
    let nextTrangThai = s.trangThai;
    let nextBackup = s.rangeBackup;
    let changed = false;

    for (const [key, raw] of Object.entries(patch || {})) {
      if (raw == null || raw === '') continue;
      if (key === 'kho') {
        const v = toFullKho(raw);
        nextKho = s.kho === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'day') {
        const day = String(raw).slice(0, 10);
        if (s.from === day && s.to === day) {
          if (s.rangeBackup) {
            nextFrom = s.rangeBackup.from;
            nextTo = s.rangeBackup.to;
            nextBackup = null;
          }
        } else {
          nextBackup = s.rangeBackup || { from: s.from, to: s.to };
          nextFrom = day;
          nextTo = day;
        }
        changed = true;
        continue;
      }
      if (key === 'phan_khuc') {
        const v = String(raw);
        nextPk = s.phanKhuc === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'phan_nhom') {
        const v = String(raw);
        nextNhom = s.phanNhom === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'ma_cu_moi') {
        const v = String(raw);
        nextMa = s.maCuMoi === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'spu') {
        const v = String(raw).trim().toUpperCase();
        nextSpu = s.spu === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'flag_eta') {
        const v = String(raw);
        nextFlag = s.flagEta === v ? 'All' : v;
        changed = true;
        continue;
      }
      if (key === 'trang_thai') {
        const v = String(raw);
        nextTrangThai = s.trangThai === v ? 'All' : v;
        changed = true;
      }
    }
    if (!changed) return;

    setFrom(nextFrom);
    setTo(nextTo);
    setKho(nextKho);
    setPhanKhuc(nextPk);
    setPhanNhom(nextNhom);
    setMaCuMoi(nextMa);
    setSpu(nextSpu);
    setSpuInput(nextSpu === 'All' ? '' : nextSpu);
    setFlagEta(nextFlag);
    setTrangThai(nextTrangThai);
    setRangeBackup(nextBackup);
    clearApiCache();
    clearTimeout(debounceRef.current);
    setApplied({
      from: nextFrom,
      to: nextTo,
      kho: nextKho,
      phan_khuc: nextPk,
      phan_nhom: nextNhom,
      ma_cu_moi: nextMa,
      spu: nextSpu,
      ngay_snapshot: s.ngaySnapshot,
      trang_thai_day: s.trangThaiDay,
      flag_eta: nextFlag,
      trang_thai: nextTrangThai,
    });
  }, []);

  function applyNow(next) {
    clearTimeout(debounceRef.current);
    setApplied(next);
  }

  function applySoon(next) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setApplied(next), 180);
  }

  function apply() {
    const q = String(spuInput || '')
      .trim()
      .toUpperCase();
    setSpu(q || 'All');
    setSpuInput(q);
    applyNow(buildFilters({ spu: q || 'All' }));
    if (window.matchMedia('(max-width: 900px)').matches) setFiltersOpen(false);
  }

  function setKhoNow(next) {
    setKho(next);
    applySoon(buildFilters({ kho: next }));
  }

  function setPkNow(next) {
    setPhanKhuc(next);
    applySoon(buildFilters({ phan_khuc: next }));
  }

  function setNhomNow(next) {
    setPhanNhom(next);
    applySoon(buildFilters({ phan_nhom: next }));
  }

  function setMaNow(next) {
    setMaCuMoi(next);
    applySoon(buildFilters({ ma_cu_moi: next }));
  }

  function setSnapNow(next) {
    setNgaySnapshot(next);
    applyNow(buildFilters({ ngay_snapshot: next }));
  }

  function setDayStatusNow(next) {
    setTrangThaiDay(next);
    applyNow(buildFilters({ trang_thai_day: next }));
  }

  function clearChip(key) {
    if (key === 'day' && rangeBackup) {
      setFrom(rangeBackup.from);
      setTo(rangeBackup.to);
      setRangeBackup(null);
      applyNow(buildFilters({ from: rangeBackup.from, to: rangeBackup.to }));
      return;
    }
    if (key === 'kho') {
      setKho('All');
      applyNow(buildFilters({ kho: 'All' }));
    } else if (key === 'phan_khuc') {
      setPhanKhuc('All');
      applyNow(buildFilters({ phan_khuc: 'All' }));
    } else if (key === 'phan_nhom') {
      setPhanNhom('All');
      applyNow(buildFilters({ phan_nhom: 'All' }));
    } else if (key === 'ma_cu_moi') {
      setMaCuMoi('All');
      applyNow(buildFilters({ ma_cu_moi: 'All' }));
    } else if (key === 'spu') {
      setSpu('All');
      setSpuInput('');
      applyNow(buildFilters({ spu: 'All' }));
    } else if (key === 'flag_eta') {
      setFlagEta('All');
      applyNow(buildFilters({ flag_eta: 'All' }));
    } else if (key === 'trang_thai') {
      setTrangThai('All');
      applyNow(buildFilters({ trang_thai: 'All' }));
    } else if (key === 'all') {
      const restore = rangeBackup;
      setKho('All');
      setPhanKhuc('All');
      setPhanNhom('All');
      setMaCuMoi('All');
      setSpu('All');
      setSpuInput('');
      setFlagEta('All');
      setTrangThai('All');
      if (restore) {
        setFrom(restore.from);
        setTo(restore.to);
        setRangeBackup(null);
      }
      applyNow(
        buildFilters({
          kho: 'All',
          phan_khuc: 'All',
          phan_nhom: 'All',
          ma_cu_moi: 'All',
          spu: 'All',
          flag_eta: 'All',
          trang_thai: 'All',
          ...(restore ? { from: restore.from, to: restore.to } : {}),
        })
      );
    }
  }

  const chips = [];
  if (applied.kho !== 'All') chips.push({ key: 'kho', label: `Kho: ${applied.kho.replace('KHO ', '')}` });
  if (applied.phan_khuc !== 'All') chips.push({ key: 'phan_khuc', label: `PK: ${applied.phan_khuc}` });
  if (applied.phan_nhom !== 'All') chips.push({ key: 'phan_nhom', label: `Nhóm: ${applied.phan_nhom}` });
  if (applied.ma_cu_moi !== 'All') chips.push({ key: 'ma_cu_moi', label: applied.ma_cu_moi });
  if (applied.flag_eta !== 'All') chips.push({ key: 'flag_eta', label: `ETA: ${applied.flag_eta}` });
  if (applied.trang_thai && applied.trang_thai !== 'All') {
    chips.push({ key: 'trang_thai', label: `TT: ${applied.trang_thai}` });
  }
  if (applied.spu !== 'All') chips.push({ key: 'spu', label: `SPU: ${applied.spu}` });
  if (rangeBackup && applied.from === applied.to) {
    chips.push({ key: 'day', label: `Ngày: ${applied.from}` });
  }

  if (!authReady) {
    return (
      <div className="login-page">
        <div className="login-card">Đang tải…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onSuccess={(u) => {
          clearApiCache();
          setUser(u);
        }}
      />
    );
  }

  return (
    <ChartFilterContext.Provider value={applyChartFilter}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Pancake BI</div>
        <nav className="nav">
          {navGroups.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-group-title">{g.title}</div>
              {g.items.map((p) => (
                <a
                  key={p.id}
                  href={`#${p.id}`}
                  className={page === p.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(p.id);
                  }}
                >
                  <span className="nav-full">{p.label}</span>
                  <span className="nav-short">{p.short || p.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="user-box">
          <div>{user?.name || user?.username || 'User'}</div>
          <div className="muted" style={{ color: '#cbd5e1' }}>
            {user?.username || user?.email || 'Nội bộ'}
          </div>
          <button type="button" className="logout" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="topbar-title">
            <h1>{meta.title || meta.label}</h1>
            <p className="page-note" hidden={!meta.note}>
              {meta.note || ''}
            </p>
          </div>
          <button
            type="button"
            className="btn ghost filter-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Bộ lọc
          </button>
          <div className={`filters ${filtersOpen ? 'is-open' : ''}`} id="filtersPanel">
            <DateField
              label="Từ ngày"
              value={from}
              validDays={validDays}
              bounds={dateBounds}
              onChange={commitFrom}
            />
            <DateField
              label="Đến ngày"
              value={to}
              validDays={validDays}
              bounds={dateBounds}
              onChange={commitTo}
            />
            <div className="field field-kho">
              <span>Kho</span>
              <div className="seg">
                {KHOS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={`seg-btn ${kho === k.id ? 'on' : ''}`}
                    onClick={() => setKhoNow(k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              Phân khúc
              <select value={phanKhuc} onChange={(e) => setPkNow(e.target.value)}>
                <option value="All">Tất cả</option>
                {(filterOpts.phan_khuc || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Phân nhóm
              <select value={phanNhom} onChange={(e) => setNhomNow(e.target.value)}>
                <option value="All">Tất cả</option>
                {(filterOpts.phan_nhom || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Mã cũ / mới
              <select value={maCuMoi} onChange={(e) => setMaNow(e.target.value)}>
                <option value="All">Tất cả</option>
                <option value="Mã cũ">Mã cũ</option>
                <option value="Mã mới">Mã mới</option>
              </select>
            </label>
            <label className="field field-spu-search">
              Tìm SPU
              <input
                type="search"
                value={spuInput}
                placeholder="B0049 · Enter lọc trang"
                autoComplete="off"
                onChange={(e) => setSpuInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply();
                }}
              />
            </label>
            <button className="btn" type="button" onClick={apply}>
              Áp dụng
            </button>
          </div>
        </div>

        {chips.length ? (
          <div className="chart-filter-bar">
            <span className="muted">Lọc đang áp dụng</span>
            {chips.map((c) => (
              <button key={c.key} type="button" className="chip" onClick={() => clearChip(c.key)}>
                {c.label} ×
              </button>
            ))}
            <button type="button" className="chip chip-clear" onClick={() => clearChip('all')}>
              Xóa lọc
            </button>
          </div>
        ) : null}

        <div className="content">
          {page === 'overview' ? <Overview filters={filters} /> : null}
          {page === 'hanh-dong' ? (
            <HanhDong filters={filters} onSnapChange={setSnapNow} />
          ) : null}
          {page === 'phan-tich-dt' ? <PhanTichDt filters={filters} /> : null}
          {page === 'pheu-doanh-thu' ? <PheuDoanhThu filters={filters} /> : null}
          {page === 'san-pham' ? <SanPham filters={filters} /> : null}
          {page === 'ton-kho' ? <TonKho filters={filters} /> : null}
          {page === 'day-ton-xau' ? (
            <DayTonXau
              filters={filters}
              onSnapChange={setSnapNow}
              onStatusChange={setDayStatusNow}
            />
          ) : null}
          {page === 'hang-dang-ve' ? <HangDangVe filters={filters} /> : null}
        </div>
      </main>
    </div>
    </ChartFilterContext.Provider>
  );
}
