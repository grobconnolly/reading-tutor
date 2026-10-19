"use client";

/** Words-per-minute trend with reference lines for her grade's fall average and her baseline. */
export function WcpmChart({ values, gradeAvg, gradeLabel, baseline }: {
  values: number[];
  gradeAvg?: number;
  gradeLabel: string;
  baseline: number | null;
}) {
  if (values.length < 2) return <p className="muted">The chart appears after two stories with a words-per-minute score.</p>;
  const W = 600, H = 140, pad = 24;
  const max = Math.max(130, ...values, gradeAvg ?? 0, baseline ?? 0) * 1.05;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (values.length - 1);
  const y = (v: number) => H - pad - (v * (H - 2 * pad)) / max;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Words per minute trend">
      {gradeAvg != null && (
        <>
          <line x1={pad} x2={W - pad} y1={y(gradeAvg)} y2={y(gradeAvg)} stroke="var(--line)" strokeDasharray="4 4" />
          <text x={W - pad} y={y(gradeAvg) - 5} textAnchor="end" fontSize="11" fill="var(--muted)">{gradeAvg} = {gradeLabel} fall avg</text>
        </>
      )}
      {baseline != null && (
        <>
          <line x1={pad} x2={W - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--help)" strokeDasharray="2 5" />
          <text x={pad} y={y(baseline) - 5} fontSize="11" fill="var(--help)">{baseline} = her baseline</text>
        </>
      )}
      <polyline points={pts} fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="5" fill="var(--ok)" />
      <text x={x(values.length - 1)} y={y(last) - 10} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--ink)">{last}</text>
    </svg>
  );
}
