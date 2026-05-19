let ringIdCounter = 0;

export function ProgressRing({ done, total }: { done: number; total: number }) {
  const size = 56;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const safeDone = Math.max(0, Math.min(done, total));
  const pct = total > 0 ? safeDone / total : 0;
  const offset = circ * (1 - pct);
  const gradientId = `progressGradient_${ringIdCounter++}`;
  return (
    <div
      className="progress-ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={safeDone}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        <circle className="ring-bg" cx={size / 2} cy={size / 2} r={r} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          stroke={`url(#${gradientId})`}
        />
      </svg>
      <div className="ring-text">
        <span className="ring-text-done">{safeDone}</span>
        <span className="ring-text-sep">/</span>
        <span className="ring-text-total">{total}</span>
      </div>
    </div>
  );
}
