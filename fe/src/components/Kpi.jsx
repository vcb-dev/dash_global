export default function Kpi({ label, value, sub, tone, className = '' }) {
  return (
    <div className={`kpi ${tone || ''} ${className}`.trim()}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}
