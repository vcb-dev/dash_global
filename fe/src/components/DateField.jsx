import { useEffect, useMemo, useRef, useState } from 'react';

const VI_MONTHS = [
  'Tháng Một',
  'Tháng Hai',
  'Tháng Ba',
  'Tháng Tư',
  'Tháng Năm',
  'Tháng Sáu',
  'Tháng Bảy',
  'Tháng Tám',
  'Tháng Chín',
  'Tháng Mười',
  'Tháng Mười Một',
  'Tháng Mười Hai',
];

function parseYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(dt) {
  if (!dt) return '';
  // Lịch dashboard theo ngày VN, không dùng UTC
  return dt.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
}

function todayVnYmd() {
  return formatYmd(new Date());
}

function formatVi(ymd) {
  const dt = parseYmd(ymd);
  if (!dt) return '';
  const d = dt.getUTCDate();
  const m = dt.getUTCMonth() + 1;
  const y = dt.getUTCFullYear();
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function nearestValid(ymd, validSet, preferLater) {
  if (!validSet?.size) return ymd;
  if (validSet.has(ymd)) return ymd;
  const sorted = [...validSet].sort();
  if (preferLater) {
    const next = sorted.find((d) => d >= ymd);
    return next || sorted[sorted.length - 1];
  }
  const prev = [...sorted].reverse().find((d) => d <= ymd);
  return prev || sorted[0];
}

function isSelectable(ymd, validSet, bounds, todayYmd) {
  if (!ymd) return false;
  if (ymd > todayYmd) return false;
  if (bounds?.min && ymd < bounds.min) return false;
  if (bounds?.max && ymd > bounds.max) return false;
  if (validSet.size && !validSet.has(ymd)) return false;
  return true;
}

export default function DateField({ label, value, onChange, validDays = [], bounds }) {
  const validSet = useMemo(() => new Set(validDays || []), [validDays]);
  const todayYmd = todayVnYmd();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = parseYmd(value) || parseYmd(bounds?.min) || new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  useEffect(() => {
    const d = parseYmd(value);
    if (d) setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cells = useMemo(() => {
    const { y, m } = view;
    const first = new Date(Date.UTC(y, m, 1));
    const startDow = (first.getUTCDay() + 6) % 7;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const grid = [];
    const pad = (n) => String(n).padStart(2, '0');
    for (let i = 0; i < startDow; i++) {
      const prev = new Date(Date.UTC(y, m, -startDow + i + 1));
      const ymd = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
      grid.push({
        ymd,
        day: prev.getUTCDate(),
        muted: true,
        valid: isSelectable(ymd, validSet, bounds, todayYmd),
      });
    }
    for (let day = 1; day <= dim; day++) {
      const ymd = `${y}-${pad(m + 1)}-${pad(day)}`;
      grid.push({
        ymd,
        day,
        muted: false,
        valid: isSelectable(ymd, validSet, bounds, todayYmd),
      });
    }
    while (grid.length % 7 !== 0) {
      const idx = grid.length - (startDow + dim) + 1;
      const next = new Date(Date.UTC(y, m + 1, idx));
      const ymd = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
      grid.push({
        ymd,
        day: next.getUTCDate(),
        muted: true,
        valid: isSelectable(ymd, validSet, bounds, todayYmd),
      });
    }
    return grid;
  }, [view, validSet, bounds, todayYmd]);

  function pick(ymd) {
    if (!isSelectable(ymd, validSet, bounds, todayYmd)) return;
    onChange(ymd);
    setOpen(false);
  }

  const canToday = isSelectable(todayYmd, validSet, bounds, todayYmd);

  return (
    <label className="field date-field" ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="date-field-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{formatVi(value) || '—'}</span>
        <span className="date-field-icon" aria-hidden="true" />
      </button>
      {open ? (
        <div className="date-popover" role="dialog" aria-label={label}>
          <div className="date-popover-head">
            <button
              type="button"
              className="date-nav"
              aria-label="Tháng trước"
              onClick={() =>
                setView((v) => {
                  const d = new Date(Date.UTC(v.y, v.m - 1, 1));
                  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
                })
              }
            >
              ‹
            </button>
            <span className="date-popover-title">
              {VI_MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              className="date-nav"
              aria-label="Tháng sau"
              onClick={() =>
                setView((v) => {
                  const d = new Date(Date.UTC(v.y, v.m + 1, 1));
                  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
                })
              }
            >
              ›
            </button>
          </div>
          <div className="date-dow">
            {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="date-grid">
            {cells.map((c) => {
              const disabled = !c.valid;
              const selected = c.ymd === value;
              return (
                <button
                  key={c.ymd + String(c.muted)}
                  type="button"
                  className={[
                    'date-day',
                    c.muted ? 'is-muted' : '',
                    disabled ? 'is-disabled' : '',
                    selected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={disabled}
                  onClick={() => pick(c.ymd)}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          <div className="date-popover-foot">
            <button
              type="button"
              className="date-foot-btn"
              disabled={!canToday}
              onClick={() => pick(todayYmd)}
            >
              Hôm nay
            </button>
          </div>
        </div>
      ) : null}
    </label>
  );
}

export { formatVi, nearestValid };