/** A template as its page shows it: an optional note to the member, then the template they copy, print and send. */
export interface TemplateParts {
  /** When to use it and what to change, as HTML. Shown beside the template, never copied or printed. */
  readonly note: string | null;
  /** The template itself, as HTML, with its placeholders marked. */
  readonly body: string;
}

/** Text in square brackets with at least one letter in it. "[ ]" is a checkbox and "[1]" a reference, not a blank. */
const PLACEHOLDER = /\[[^\[\]<>\n]*\p{L}[^\[\]<>\n]*\]/gu;

/** Wraps each [Placeholder] in the text of rendered HTML in <mark>. Tags and their attributes are left as they are. */
export const markPlaceholders = (html: string): string =>
  html
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(PLACEHOLDER, (found) => `<mark>${found}</mark>`)))
    .join('');

const NOTE = /^\s*<blockquote>([\s\S]*?)<\/blockquote>/;

/** Splits a rendered template. A body that opens with a quote opens with a note to the member; the rest is the template. */
export function templateParts(html: string): TemplateParts {
  const note = NOTE.exec(html);
  const inside = note?.[1]?.trim();
  return {
    note: inside ? markPlaceholders(inside) : null,
    body: markPlaceholders((note ? html.slice(note[0].length) : html).trim()),
  };
}
