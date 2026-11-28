import { fmt } from '../lib/format';

const COLORS = {
  chot: '#5b4cdb',
  xuat: '#3b82f6',
  thanh_cong: '#22c55e',
};

/**
 * Phễu hình thang 3 tầng (SVG) + % chuyển + callout rơi — khớp mock.
 * Độ rộng tầng theo DT / max(DT); nếu xuất > chốt vẫn vẽ đúng tỷ lệ.
 */
export default function FunnelVisual({ stages = [], drops = [] }) {
  if (!stages.length) return null;
  const maxDt = Math.max(...stages.map((s) => Number(s.dt) || 0), 1);
  const n = stages.length;
  const stageH = 86;
  const gap = 28;
  const vbW = 400;
  const padX = 12;
  const usable = vbW - padX * 2;
  const minW = usable * 0.42;

  const widths = stages.map((s) => {
    const w = ((Number(s.dt) || 0) / maxDt) * usable;
    return Math.max(minW, Math.min(usable, w));
  });

  const vbH = n * stageH + (n - 1) * gap + 8;

  return (
    <div className="funnel-visual">
      <div className="funnel-col">
        <svg className="funnel-svg" viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label="Phễu doanh thu">
          {stages.map((s, i) => {
            const wTop = widths[i];
            const wBot = widths[i + 1] != null ? widths[i + 1] : Math.max(minW, wTop * 0.82);
            const y = i * (stageH + gap);
            const xTop = (vbW - wTop) / 2;
            const xBot = (vbW - wBot) / 2;
            const color = COLORS[s.key] || s.color || COLORS.chot;
            const pts = `${xTop},${y} ${xTop + wTop},${y} ${xBot + wBot},${y + stageH} ${xBot},${y + stageH}`;
            const cx = vbW / 2;
            const cy = y + stageH / 2;
            const pct = i === 0 ? null : s.pct_tren;
            const bridgeY = y - gap / 2;

            return (
              <g key={s.key || i}>
                {i > 0 ? (
                  <g>
                    <line
                      x1={vbW / 2}
                      y1={y - gap + 2}
                      x2={vbW / 2}
                      y2={y - 2}
                      stroke="#cbd5e1"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <rect
                      x={cx - 78}
                      y={bridgeY - 11}
                      width={156}
                      height={22}
                      rx={11}
                      fill="#fff"
                      stroke="#e2e8f0"
                    />
                    <text
                      x={cx}
                      y={bridgeY + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill="#475569"
                      fontFamily="Be Vietnam Pro, sans-serif"
                    >
                      {pct == null
                        ? '—'
                        : `${(Number(pct) * 100).toFixed(1)}% so với ${stages[i - 1].label}`}
                    </text>
                  </g>
                ) : null}
                <polygon points={pts} fill={color} />
                <text
                  x={cx}
                  y={cy - 16}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill="#fff"
                  fontFamily="Be Vietnam Pro, sans-serif"
                  opacity="0.95"
                >
                  {s.title || `DT ${s.label}`}
                </text>
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  fontSize="20"
                  fontWeight="800"
                  fill="#fff"
                  fontFamily="Be Vietnam Pro, sans-serif"
                >
                  {fmt.money(s.dt)}
                </text>
                <text
                  x={cx}
                  y={cy + 22}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#fff"
                  fontFamily="Be Vietnam Pro, sans-serif"
                  opacity="0.92"
                >
                  {fmt.num(s.don)} đơn
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="funnel-callouts">
        {drops.map((d, i) =>
          d ? (
            <div key={i} className="funnel-callout">
              <div className="funnel-callout-arrow" aria-hidden>
                →
              </div>
              <div className="funnel-callout-card">
                <strong>
                  {d.overflow
                    ? `+ ${fmt.money(Math.abs(d.dt))}`
                    : d.dt > 0
                      ? `~ ${fmt.money(d.dt)}`
                      : '—'}
                  {d.don != null ? ` (${fmt.num(Math.abs(d.don))} đơn)` : ''}
                </strong>
                <span>{d.label}</span>
                {d.hint ? <span className="muted">{d.hint}</span> : null}
              </div>
            </div>
          ) : (
            <div key={i} className="funnel-callout is-empty" />
          )
        )}
      </div>
    </div>
  );
}
