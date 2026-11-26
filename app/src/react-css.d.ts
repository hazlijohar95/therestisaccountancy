import 'react';

/* Custom properties in inline styles, which the brand's components read (the logo's mask, a bar's width). */
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
