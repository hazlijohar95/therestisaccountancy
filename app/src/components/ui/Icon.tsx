/** Line icons on a 24px grid, drawn in currentColor. Decorative: the text beside each one carries the meaning. */
const paths = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M18 15c2.5.5 4 2.5 4 6',
  check: 'M4 12.5l5 5L20 6.5',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  play: 'M7 4l13 8-13 8z',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  repeat: 'M4 11V8a2 2 0 0 1 2-2h13M16 3l3 3-3 3M20 13v3a2 2 0 0 1-2 2H5M8 21l-3-3 3-3',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="square" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
