import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { PageHead } from '../../../components/ui/PageHead.tsx';
import { Actions } from '../../../components/ui/Section.tsx';
import { membersResource } from '../../../functions/members-learning.ts';
import { clubTitle } from '../../../lib/title.ts';
import s from './$id.module.css';

export const Route = createFileRoute('/members/resources/$id')({
  loader: ({ params }) => membersResource({ data: params.id }),
  head: ({ loaderData }) => ({ meta: clubTitle(loaderData?.title) }),
  component: Template,
});

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The template as Word and Google Docs take a paste: they keep inline styles and drop the page's stylesheet. */
function forPaste(sheet: HTMLElement): string {
  const doc = document.createElement('div');
  doc.innerHTML = sheet.innerHTML;
  const ink = token('--color-ink');
  for (const mark of doc.querySelectorAll('mark')) mark.style.cssText = `background-color: ${token('--color-highlighter')}; color: ${ink};`;
  for (const list of doc.querySelectorAll('ul.contains-task-list')) {
    list.replaceWith(
      ...Array.from(list.children, (item) => {
        const line = document.createElement('p');
        const words = Array.from(item.childNodes).filter((node) => !(node instanceof HTMLInputElement));
        const first = words[0];
        if (first instanceof Text) first.data = first.data.trimStart();
        line.style.margin = '0 0 4pt';
        line.replaceChildren('☐ ', ...words);
        return line;
      }),
    );
  }
  for (const quote of doc.querySelectorAll('blockquote')) quote.style.cssText = `margin: 0 0 8pt 12pt; padding-left: 10pt; border-left: 2pt solid ${ink};`;
  for (const table of doc.querySelectorAll('table')) table.style.cssText = 'border-collapse: collapse; width: 100%;';
  for (const cell of doc.querySelectorAll<HTMLTableCellElement>('th, td')) cell.style.cssText = `border: 1px solid ${ink}; padding: 4pt 6pt; text-align: left; vertical-align: top;`;
  for (const tagged of doc.querySelectorAll('[class], [id]')) {
    tagged.removeAttribute('class');
    tagged.removeAttribute('id');
  }
  return `<meta charset="utf-8">${doc.innerHTML}`;
}

/** The template as plain text, for anywhere that takes a paste without formatting. */
function asText(sheet: HTMLElement): string {
  const flat = (node: Element) => (node instanceof HTMLElement ? node.innerText : (node.textContent ?? '')).replace(/[ \t]+/g, ' ').trim();
  const marker = (list: Element, item: Element, i: number) => (item.classList.contains('task-list-item') ? '☐' : list instanceof HTMLOListElement ? `${list.start + i}.` : '-');
  return Array.from(sheet.children, (block) => {
    if (block instanceof HTMLUListElement || block instanceof HTMLOListElement) {
      return Array.from(block.children, (item, i) => `${marker(block, item, i)} ${flat(item)}`).join('\n');
    }
    if (block instanceof HTMLTableElement) {
      return Array.from(block.rows, (row) => Array.from(row.cells, flat))
        .filter((cells) => cells.some((cell) => cell.length > 0))
        .map((cells) => cells.join(' | '))
        .join('\n');
    }
    return flat(block);
  })
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/* Nothing is awaited before the first write: Safari only lets a page copy inside the click itself. */
async function copyTemplate(sheet: HTMLElement): Promise<string> {
  const text = asText(sheet);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([forPaste(sheet)], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return 'Copied. Paste it into Word or Google Docs.';
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return 'Copied as plain text. This browser would not copy the formatting.';
    } catch {
      return 'This browser would not let the page copy. Select the template and copy it yourself.';
    }
  }
}

function Template() {
  const t = Route.useLoaderData();
  const sheet = useRef<HTMLElement>(null);
  const [status, setStatus] = useState('');
  /* Copy and Print need the page's script, so they appear once it runs. Copy also needs a clipboard. */
  const [tools, setTools] = useState({ copy: false, print: false });
  useEffect(() => setTools({ copy: window.isSecureContext && 'clipboard' in navigator, print: true }), []);

  /* Cleared first, so a second copy is announced again. */
  const say = (message: string) => {
    setStatus('');
    window.setTimeout(() => setStatus(message), 80);
  };

  return (
    <>
      <div className={s.head}>
        <PageHead
          label={
            <span>
              <a href="/members/resources">Templates</a> / <a href={t.programme.href}>{t.programme.name}</a> · Module {t.module} · {t.topic}
            </span>
          }
          title={t.title}
          lead={t.summary}
        />
      </div>
      <div className={`wrap ${s.layout}`}>
        <aside className={s.rail} aria-label="Use this template">
          <Actions>
            <button className="btn" type="button" hidden={!tools.copy} onClick={() => sheet.current && void copyTemplate(sheet.current).then(say)}>
              Copy
            </button>
            <a className="btn ghost" href={t.download} download>
              Download (.md)
            </a>
            <button className="btn ghost" type="button" hidden={!tools.print} onClick={() => window.print()}>
              Print
            </button>
          </Actions>
          <p className={`small ${s.status}`} role="status" aria-live="polite">
            {status}
          </p>
          {t.note && (
            <section className={s.note} aria-labelledby="note-title">
              <h2 className="label" id="note-title">
                Before you use it
              </h2>
              <div dangerouslySetInnerHTML={{ __html: t.note }} />
            </section>
          )}
        </aside>
        <article className={s.template} aria-labelledby="page-title" data-template="" ref={sheet} dangerouslySetInnerHTML={{ __html: t.body }} />
      </div>
      <nav className={`wrap ${s.back}`} aria-label="More templates">
        <a href={t.programme.href}>
          <span className="label">Back to the programme</span>
          <span className="serif">{t.programme.name}</span>
        </a>
        <a className={s.end} href="/members/resources">
          <span className="label">Every template</span>
          <span className="serif">Templates</span>
        </a>
      </nav>
    </>
  );
}
