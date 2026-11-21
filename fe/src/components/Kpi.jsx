export default function Kpi({ label, value, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
