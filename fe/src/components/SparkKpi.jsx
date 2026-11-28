function Sparkline({ values = [], color = '#5b4cdb' }) {
  const w = 88;
  const h = 36;
  const nums = values.map((v) => Number(v) || 0);
  if (!nums.length) {
    return <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden />;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = nums.length > 1 ? w / (nums.length - 1) : w;
  const pts = nums.map((v, i) => {
    const x = i * step;
    const y = h - 4 - ((v - min) / span) * (h - 8);
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id={`spark-fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-fill-${color.replace('#', '')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** KPI có sparkline + % so với kỳ trước cùng độ dài bộ lọc. */
export default function SparkKpi({
  label,
  value,
  sub,
  icon,
  tone,
  color = '#5b4cdb',
  pct,
  spark = [],
  compareHint = 'vs kỳ trước',
}) {
  const up = pct != null && pct >= 0;
  const down = pct != null && pct < 0;
  return (
    <div className={`kpi kpi-spark-card ${tone || ''}`.trim()}>
      <div className="kpi-head">
        <span className="label">{label}</span>
        <span className="kpi-ico" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="value">{value}</div>
      <div className="kpi-sub">{sub}</div>
      <div className="kpi-trend-row">
        <div className={`kpi-delta ${up ? 'up' : ''} ${down ? 'down' : ''}`.trim()}>
          {pct == null ? (
            <span className="muted">—</span>
          ) : (
            <>
              <span aria-hidden>{up ? '↑' : '↓'}</span>{' '}
              {up ? '+' : ''}
              {(Number(pct) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%
              <span className="kpi-delta-hint"> {compareHint}</span>
            </>
          )}
        </div>
        <Sparkline values={spark} color={color} />
      </div>
    </div>
  );
}
