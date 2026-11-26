import { useId, type ReactNode } from "react";
import { formatHours } from "../domain/courses.ts";
import type { Course, CoverMotif } from "../domain/types.ts";

/**
 * Cover art in the club's image language: a black grid panel, a halftone cut-out object,
 * a strip of tape with a hand-written label and the red tick. No text beyond the tape.
 */
export function Cover({ course, size = "md" }: { course: Course; size?: "sm" | "md" | "lg" }) {
  return (
    <Panel size={size} label={size === "sm" ? undefined : `${formatHours(course.credits)} CPE`}>
      {(ht) => <Glyph motif={course.motif} ht={ht} />}
    </Panel>
  );
}

export type ShowMotif = "mic" | "papers";

export function ShowCover({ motif, size = "md" }: { motif: ShowMotif; size?: "md" | "lg" }) {
  return (
    <Panel size={size}>
      {(ht) => (motif === "mic" ? <Mic ht={ht} /> : <Papers ht={ht} />)}
    </Panel>
  );
}

interface Halftone {
  dense: string;
  light: string;
}

function Panel({ size, label, children }: { size: string; label?: string; children: (ht: Halftone) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  const ht = { dense: `url(#d${id})`, light: `url(#l${id})` };
  return (
    <div className={`cover cover--${size}`}>
      <svg viewBox="0 0 400 400" aria-hidden className="cover__art">
        <defs>
          <pattern id={`d${id}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx="4.5" cy="4.5" r="3.1" className="a-paper" />
          </pattern>
          <pattern id={`l${id}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx="4.5" cy="4.5" r="1.5" className="a-paper" />
          </pattern>
        </defs>
        <rect width="400" height="400" className="a-night" />
        {[80, 160, 240, 320].map((v) => (
          <g key={v} className="a-grid">
            <line x1={v} x2={v} y1="0" y2="400" />
            <line y1={v} y2={v} x1="0" x2="400" />
          </g>
        ))}
        {children(ht)}
        <path d="M318 62l14 16 30-36" className="a-tick" />
      </svg>
      {label && <span className="tape cover__tape">{label}</span>}
    </div>
  );
}

function Glyph({ motif, ht }: { motif: CoverMotif; ht: Halftone }) {
  switch (motif) {
    case "stamp":
      return (
        <g>
          <rect x="194" y="112" width="12" height="196" className="a-paper" />
          <rect x="138" y="300" width="124" height="14" className="a-paper" />
          <g transform="rotate(-7 200 120)">
            <rect x="78" y="114" width="244" height="10" className="a-paper" />
            <line x1="90" y1="124" x2="62" y2="226" className="a-wire" />
            <line x1="90" y1="124" x2="118" y2="226" className="a-wire" />
            <line x1="310" y1="124" x2="282" y2="226" className="a-wire" />
            <line x1="310" y1="124" x2="338" y2="226" className="a-wire" />
            <path d="M48 226h84a42 30 0 0 1-84 0z" fill={ht.dense} className="a-edge" />
            <path d="M268 226h84a42 30 0 0 1-84 0z" fill={ht.light} className="a-edge" />
          </g>
          <circle cx="200" cy="106" r="12" className="a-paper" />
        </g>
      );
    case "ledger":
      return (
        <g>
          <rect x="60" y="118" width="280" height="10" className="a-paper" />
          <rect x="195" y="118" width="10" height="210" className="a-paper" />
          <text x="128" y="104" className="a-label">DR</text>
          <text x="252" y="104" className="a-label">CR</text>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="78" y={150 + i * 40} width={[104, 74, 92, 58][i]} height="22" fill={ht.dense} />
          ))}
          {[0, 1].map((i) => (
            <rect key={i} x="222" y={150 + i * 40} width={[96, 70][i]} height="22" fill={ht.light} />
          ))}
          <line x1="222" x2="322" y1="252" y2="252" className="a-wire" />
          <line x1="222" x2="322" y1="258" y2="258" className="a-wire" />
        </g>
      );
    case "grid":
      return (
        <g>
          {[0, 1, 2, 3, 4].map((i) => {
            const y = 300 - i * 30;
            return (
              <g key={i}>
                <path d={`M100 ${y}v18a90 22 0 0 0 180 0v-18`} fill={ht.dense} className="a-edge" />
                <ellipse cx="190" cy={y} rx="90" ry="22" fill={ht.light} className="a-edge" />
              </g>
            );
          })}
          <path d="M300 214l42-58M326 154h18v18" className="a-arrow" />
        </g>
      );
    case "dither":
      return (
        <g>
          <rect x="70" y="80" width="180" height="236" fill={ht.light} className="a-edge" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="92" y={108 + i * 26} width={[120, 96, 132, 80, 110][i]} height="8" className="a-paper" />
          ))}
          <line x1="292" y1="290" x2="346" y2="344" className="a-handle" />
          <circle cx="250" cy="248" r="72" fill={ht.dense} className="a-lens" />
        </g>
      );
  }
}

function Mic({ ht }: { ht: Halftone }) {
  return (
    <g>
      <rect x="148" y="64" width="104" height="176" rx="52" fill={ht.dense} className="a-edge" />
      {[110, 140, 170, 200].map((y) => (
        <line key={y} x1="152" x2="248" y1={y} y2={y} className="a-grille" />
      ))}
      <path d="M118 170v20a82 82 0 0 0 164 0v-20" className="a-stand" />
      <rect x="194" y="272" width="12" height="50" className="a-paper" />
      <rect x="140" y="318" width="120" height="14" className="a-paper" />
    </g>
  );
}

function Papers({ ht }: { ht: Halftone }) {
  return (
    <g>
      <rect x="96" y="96" width="190" height="240" transform="rotate(-8 190 216)" fill={ht.light} className="a-edge" />
      <rect x="110" y="84" width="190" height="240" transform="rotate(4 205 204)" className="a-night a-edge" />
      <rect x="110" y="84" width="190" height="240" transform="rotate(4 205 204)" fill={ht.dense} className="a-edge" />
      <rect x="168" y="70" width="80" height="26" transform="rotate(-3 208 83)" className="a-tape" />
    </g>
  );
}
