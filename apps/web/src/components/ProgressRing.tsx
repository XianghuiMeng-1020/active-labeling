let ringIdCounter = 0;

export function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  const offset = circ * (1 - pct);
  const gradientId = `progressGradient_${ringIdCounter++}`;
  return (
    <div className="progress-ring">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        <circle className="ring-bg" cx="22" cy="22" r={r} />
        <circle className="ring-fill" cx="22" cy="22" r={r} strokeDasharray={circ} strokeDashoffset={offset} stroke={`url(#${gradientId})`} />
      </svg>
      <div className="ring-text">{done}/{total}</div>
    </div>
  );
}
