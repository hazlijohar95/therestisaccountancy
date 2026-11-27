export type Piece = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'link'; readonly text: string; readonly href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
/** Punctuation that ends a sentence, not a URL: "see https://example.com." A ")" stays when the URL opened one. */
const TRAILING = /[.,;:!?\]}]+$/;

const trimUrl = (raw: string): string => {
  let url = raw.replace(TRAILING, '');
  while (url.endsWith(')') && (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length) url = url.slice(0, -1).replace(TRAILING, '');
  return url;
};

/** Line endings made plain, edges trimmed, and runs of blank lines kept to one. */
export const tidy = (body: string) =>
  body
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Paragraphs are separated by a blank line. Single line breaks stay inside a paragraph. */
export const paragraphs = (body: string): string[] =>
  body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

const safeHref = (candidate: string): string | null => {
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** Splits plain text into text and http(s) links. Nothing here is HTML: the page escapes every piece. */
export const pieces = (paragraph: string): Piece[] => {
  const out: Piece[] = [];
  let cursor = 0;
  for (const match of paragraph.matchAll(URL_PATTERN)) {
    const raw = trimUrl(match[0]);
    const href = safeHref(raw);
    if (!href) continue;
    if (match.index > cursor) out.push({ kind: 'text', text: paragraph.slice(cursor, match.index) });
    out.push({ kind: 'link', text: raw, href });
    cursor = match.index + raw.length;
  }
  if (cursor < paragraph.length) out.push({ kind: 'text', text: paragraph.slice(cursor) });
  return out;
};
