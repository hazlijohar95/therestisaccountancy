import { memo, useEffect, useState } from "react";

/**
 * Adapted from ElevenLabs UI's BarVisualizer (MIT, see LICENSE in this folder): its demo mode only,
 * restyled without Tailwind. There is no microphone or analyser here; the bars are a playing indicator,
 * moving while audio plays and resting flat when it stops.
 */

type State = "speaking" | "idle";

function useBands(state: State, count: number): number[] {
  const [bands, setBands] = useState(() => new Array<number>(count).fill(0.2));
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (state !== "speaking" || still) {
      setBands(new Array<number>(count).fill(state === "speaking" ? 0.6 : 0.2));
      return;
    }
    let raf = 0;
    let last = 0;
    const start = performance.now() / 1000;
    const tick = (now: number) => {
      if (now - last >= 50) {
        const t = now / 1000 - start;
        setBands(Array.from({ length: count }, (_, i) => Math.max(0.1, Math.min(1, Math.sin(t * 2 + i * 0.5) * 0.3 + 0.5 + Math.random() * 0.2))));
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, count]);
  return bands;
}

export const BarVisualizer = memo(function BarVisualizer({ state, barCount = 15, className }: { state: State; barCount?: number; className?: string }) {
  const bands = useBands(state, barCount);
  return (
    <div className={`el-bars${className ? ` ${className}` : ""}`} data-state={state} aria-hidden>
      {bands.map((v, i) => (
        <span key={i} className="el-bars__bar" style={{ height: `${Math.min(100, Math.max(20, v * 100 + 5))}%` }} />
      ))}
    </div>
  );
});
