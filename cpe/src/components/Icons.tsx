import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
  ...props,
});

export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const Pause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const Back = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" strokeLinecap="square" />
    <text x="12" y="15.2" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontFamily="var(--font-mono)">15</text>
  </svg>
);
export const Forward = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" strokeLinecap="square" />
    <text x="12" y="15.2" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontFamily="var(--font-mono)">15</text>
  </svg>
);
export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 12.5l5 5L20 6" strokeWidth={2.5} strokeLinecap="square" />
  </svg>
);
export const Arrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="square" />
  </svg>
);
export const Search = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L21 21" strokeLinecap="square" />
  </svg>
);
export const Lock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" strokeLinecap="square" />
  </svg>
);
export const Close = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="square" />
  </svg>
);
export const Download = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" strokeLinecap="square" />
  </svg>
);
export const Home = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z" strokeLinejoin="round" />
  </svg>
);
export const Ledger = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="3.5" width="16" height="17" />
    <path d="M12 3.5v17M4 8h16M7 12h2.5M14.5 12H17M7 15.5h2.5M14.5 15.5H17" />
  </svg>
);
