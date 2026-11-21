import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getJson } from './lib/api';
import HangDangVe from './pages/HangDangVe';
import HanhDong from './pages/HanhDong';
import Overview from './pages/Overview';
import SanPham from './pages/SanPham';
import TonKho from './pages/TonKho';

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

const KHOS = [
  { id: 'All', label: 'Tất cả' },
  { id: 'KHO NHẬT BẢN', label: 'Nhật' },
  { id: 'KHO THÁI LAN', label: 'Thái' },
];

export default function App() {
  const [page, setPage] = useState(() => {
    const hash = location.hash.replace('#', '');
    return PAGES.some((p) => p.id === hash) ? hash : 'overview';
  });
  const [from, setFrom] = useState('2026-10-01');
  const [to, setTo] = useState('2026-11-20');
  const [kho, setKho] = useState('All');
  const [phanKhuc, setPhanKhuc] = useState('All');
  const [phanNhom, setPhanNhom] = useState('All');
  const [applied, setApplied] = useState({
    from: '2026-10-01',
    to: '2026-11-20',
    kho: 'All',
    phan_khuc: 'All',
    phan_nhom: 'All',
  });
  const [user, setUser] = useState({ name: 'Pancake BI' });
  const [filterOpts, setFilterOpts] = useState({ phan_khuc: [], phan_nhom: [] });

  useEffect(() => {
    getJson('/api/me')
      .then((me) => setUser(me.user || { name: 'Pancake BI' }))
      .catch(() => setUser({ name: 'Pancake BI' }));
    api('/api/filters', applied)
      .then(setFilterOpts)
      .catch(() => setFilterOpts({ phan_khuc: [], phan_nhom: [] }));
  }, []);

  useEffect(() => {
    location.hash = page;
  }, [page]);

  const filters = useMemo(() => applied, [applied]);
  const meta = PAGES.find((p) => p.id === page) || {};
  const debounceRef = useRef(null);

  function applyNow(next) {
    clearTimeout(debounceRef.current);
    setApplied(next);
  }

  function applySoon(next) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setApplied(next), 180);
  }

  function apply() {
    applyNow({ from, to, kho, phan_khuc: phanKhuc, phan_nhom: phanNhom });
  }

  function setKhoNow(next) {
    setKho(next);
    applySoon({ from, to, kho: next, phan_khuc: phanKhuc, phan_nhom: phanNhom });
  }

  function setPkNow(next) {
    setPhanKhuc(next);
    applySoon({ from, to, kho, phan_khuc: next, phan_nhom: phanNhom });
  }

  function setNhomNow(next) {
    setPhanNhom(next);
    applySoon({ from, to, kho, phan_khuc: phanKhuc, phan_nhom: next });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Pancake BI</div>
        <nav className="nav">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className={page === p.id ? 'active' : ''}
              onClick={(e) => {
                e.preventDefault();
                setPage(p.id);
              }}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <div className="user-box">
          <div>{user?.name || 'Pancake BI'}</div>
          <div className="muted" style={{ color: '#cbd5e1' }}>
            Nội bộ
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <h1>{meta.title || meta.label}</h1>
            <p className="page-note" hidden={!meta.note}>
              {meta.note || ''}
            </p>
          </div>
          <div className="filters">
            <label className="field">
              Từ ngày
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              Đến ngày
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="field">
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
            <button className="btn" type="button" onClick={apply}>
              Áp dụng
            </button>
          </div>
        </div>
        <div className="content">
          {page === 'overview' ? <Overview filters={filters} /> : null}
          {page === 'san-pham' ? <SanPham filters={filters} /> : null}
          {page === 'ton-kho' ? <TonKho filters={filters} /> : null}
          {page === 'hang-dang-ve' ? <HangDangVe filters={filters} /> : null}
          {page === 'hanh-dong' ? <HanhDong filters={filters} /> : null}
        </div>
      </main>
    </div>
  );
}
