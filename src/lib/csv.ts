/**
 * A CSV cell. Quoted when it holds a comma, quote or line break. A cell a spreadsheet would read as a formula
 * (starting =, +, -, @, tab or carriage return) gets a leading apostrophe, so a typed name can never run as one.
 */
export const cell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rows of cells as CSV text, CRLF line endings, with a byte-order mark so Excel reads it as UTF-8. */
export const csv = (rows: readonly (readonly string[])[]) => `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
