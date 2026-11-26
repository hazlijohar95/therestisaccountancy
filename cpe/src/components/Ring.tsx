import type { ReactNode } from "react";

export interface Slice {
  value: number;
  tone: string;
}

/** A donut of slices against a total. Each slice draws in its own tone; the rest of the track stays empty. */
export function Ring({ slices, total, size = 120, stroke = 12, children }: { slices: readonly Slice[]; total: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((s, x) => s + x.value, 0);
  const scale = Math.max(total, sum) || 1;
  let offset = 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring__track" strokeWidth={stroke} />
        {slices.map((s, i) => {
          const len = (s.value / scale) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.tone}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="ring__slice"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  );
}
