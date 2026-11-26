import GithubSlugger from 'github-slugger';
import { Marked, type Token, type Tokens } from 'marked';
import { parse as parseYaml } from 'yaml';

/*
 * The site's Markdown files as Astro renders them: GitHub-flavoured, with smart quotes, an id on every heading and
 * classed task lists. The members' pages style that markup, and a template's copy button reads it, so the app renders
 * the same HTML. Pure functions, so a check can compare them with Astro's output outside Vite.
 */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** A file's frontmatter, parsed but not yet checked, and the Markdown after it. */
export function splitFile(raw: string): { readonly frontmatter: unknown; readonly body: string } {
  const found = FRONTMATTER.exec(raw);
  if (!found) return { frontmatter: {}, body: raw };
  /* Astro's body leaves out the blank lines after the frontmatter and the file's final line break. */
  return { frontmatter: parseYaml(found[1] ?? '') ?? {}, body: raw.slice(found[0].length).replace(/^(\r?\n)+/, '').replace(/\r?\n$/, '') };
}

const OPENS_AFTER = /[\s([{‘“–—-]/u;

/** Straight quotes made typographic, the way SmartyPants reads them: opening after a space or bracket, closing otherwise. */
function educate(text: string, before: string): string {
  let out = '';
  let previous = before;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    const opening = previous === '' || OPENS_AFTER.test(previous);
    if (char === '"') out += opening ? '“' : '”';
    else if (char === "'") out += opening && !/\d/.test(text[i + 1] ?? '') ? '‘' : '’';
    else out += char;
    previous = char;
  }
  return out;
}

/**
 * Walks the tokens in reading order, educating the quotes in each run of text. Each block, and each table cell, starts
 * with no character before it, so a quote that opens one is an opening quote.
 */
/* marked's Token union ends in a generic token whose type is any string, so a switch on type does not narrow it. */
const isTable = (token: Token): token is Tokens.Table => token.type === 'table';
const isList = (token: Token): token is Tokens.List => token.type === 'list';

function educateTokens(tokens: readonly Token[], context: { last: string }): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'code':
      case 'codespan':
      case 'html':
        continue;
      case 'text':
      case 'escape':
        if (!('tokens' in token && token.tokens)) {
          token.text = educate(token.text, context.last);
          context.last = token.text.at(-1) ?? context.last;
          continue;
        }
        break;
      case 'table': {
        if (isTable(token)) for (const cell of [...token.header, ...token.rows.flat()]) educateTokens(cell.tokens, { last: '' });
        continue;
      }
      case 'list':
        if (isList(token)) for (const item of token.items) educateTokens(item.tokens, { last: '' });
        continue;
      case 'paragraph':
      case 'heading':
      case 'blockquote':
        educateTokens(token.tokens ?? [], { last: '' });
        continue;
    }
    if ('tokens' in token && token.tokens) educateTokens(token.tokens, context);
  }
}

/** The text a heading reads as, for its id. */
const plainText = (tokens: readonly Token[]): string =>
  tokens.map((token) => ('tokens' in token && token.tokens ? plainText(token.tokens) : 'text' in token ? token.text : '')).join('');

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Renders one Markdown document to HTML. Heading ids are unique within it. */
export function renderMarkdown(markdown: string): string {
  const slugger = new GithubSlugger();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        return `<h${depth} id="${escapeHtml(slugger.slug(plainText(tokens)))}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      list(token) {
        const tag = token.ordered ? 'ol' : 'ul';
        const start = token.ordered && token.start !== 1 && token.start !== '' ? ` start="${token.start}"` : '';
        const tasks = token.items.some((item) => item.task) ? ' class="contains-task-list"' : '';
        return `<${tag}${start}${tasks}>\n${token.items.map((item) => this.listitem(item)).join('')}</${tag}>\n`;
      },
      listitem(item) {
        const body = this.parser.parse(item.tokens, item.loose).replace(/\n$/, '');
        if (!item.task) return `<li>${body}</li>\n`;
        return `<li class="task-list-item"><input type="checkbox"${item.checked ? ' checked' : ''} disabled> ${body}</li>\n`;
      },
      table(token) {
        const row = (cells: readonly Tokens.TableCell[]) => `<tr>\n${cells.map((cell) => this.tablecell(cell)).join('')}</tr>\n`;
        const body = token.rows.length ? `<tbody>\n${token.rows.map(row).join('')}</tbody>\n` : '';
        return `<table>\n<thead>\n${row(token.header)}</thead>\n${body}</table>\n`;
      },
      br() {
        return '<br>\n';
      },
      tablecell(token) {
        const tag = token.header ? 'th' : 'td';
        const align = token.align ? ` align="${token.align}"` : '';
        return `<${tag}${align}>${this.parser.parseInline(token.tokens)}</${tag}>\n`;
      },
    },
  });
  const tokens = marked.lexer(markdown);
  educateTokens(tokens, { last: '' });
  return marked.parser(tokens).trimEnd();
}
