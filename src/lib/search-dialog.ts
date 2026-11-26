/*
 * The header's search, in a native dialog: a combobox over a listbox of people and posts. Arrow keys move the active
 * option, Enter opens it, Escape closes the dialog. Results come from the search page as JSON and are written as text,
 * never as HTML. Without this script the search button is a link to that page.
 */

interface Person {
  readonly href: string;
  readonly name: string;
  readonly handle: string;
  readonly topics: readonly string[];
  readonly track: string;
  readonly sealed: boolean;
}

interface Post {
  readonly href: string;
  readonly title: string;
}

interface Results {
  readonly people: readonly Person[];
  readonly posts: readonly Post[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function parse(value: unknown): Results | null {
  if (!isRecord(value) || !Array.isArray(value.people) || !Array.isArray(value.posts)) return null;
  const people = value.people.flatMap((p: unknown): Person[] =>
    isRecord(p) && typeof p.href === 'string' && typeof p.name === 'string' && typeof p.handle === 'string'
      ? [{ href: p.href, name: p.name, handle: p.handle, topics: strings(p.topics), track: typeof p.track === 'string' ? p.track : 'field', sealed: p.sealed === true }]
      : [],
  );
  const posts = value.posts.flatMap((p: unknown): Post[] => (isRecord(p) && typeof p.href === 'string' && typeof p.title === 'string' ? [{ href: p.href, title: p.title }] : []));
  return { people, posts };
}

const SVG = 'http://www.w3.org/2000/svg';
const icon = (id: string, className: string) => {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
};
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word][0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function initSearch(): void {
  const dialog = document.getElementById('search');
  const input = document.getElementById('s-q');
  const list = document.getElementById('s-list');
  const hint = document.getElementById('s-hint');
  const count = document.getElementById('s-count');
  if (!(dialog instanceof HTMLDialogElement) || !(input instanceof HTMLInputElement) || !list || !hint || !count) return;
  const endpoint = dialog.dataset.endpoint ?? '/search';
  const nominate = dialog.dataset.nominate ?? '/nominate';
  const emptyHint = hint.textContent ?? '';
  let pending: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const options = () => [...list.querySelectorAll('[role="option"]')].flatMap((node) => (node instanceof HTMLElement ? [node] : []));
  const go = (option: HTMLElement | undefined) => {
    if (option?.dataset.href) location.href = option.dataset.href;
  };

  const option = (href: string, id: number, content: readonly Node[]) => {
    const node = element('div', 's-opt');
    node.id = `s-opt-${id}`;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', 'false');
    node.dataset.href = href;
    for (const child of content) node.appendChild(child);
    node.addEventListener('click', () => go(node));
    return node;
  };

  const personOption = (person: Person, id: number) => {
    const avatar = element('span', 'avatar xs', initials(person.name));
    avatar.dataset.track = person.track;
    avatar.setAttribute('aria-hidden', 'true');
    const name = element('b', 'name-line', person.name);
    if (person.sealed) {
      const seal = icon('seal', 'seal');
      seal.setAttribute('role', 'img');
      seal.removeAttribute('aria-hidden');
      seal.setAttribute('aria-label', 'Ticked');
      name.appendChild(seal);
    }
    const label = element('span', '');
    label.appendChild(name);
    label.appendChild(document.createTextNode(' '));
    label.appendChild(element('span', 'muted', `@${person.handle}${person.topics.length ? ` · ${person.topics.join(', ')}` : ''}`));
    return option(person.href, id, [avatar, label]);
  };

  const postOption = (post: Post, id: number) => option(post.href, id, [icon('i-reply', 'ic'), element('span', '', post.title)]);

  const render = (query: string, results: Results | null) => {
    list.textContent = '';
    input.removeAttribute('aria-activedescendant');
    let id = 0;
    const groups: [string, HTMLElement[]][] = results
      ? [
          ['People', results.people.map((p) => personOption(p, id++))],
          ['Posts', results.posts.map((p) => postOption(p, id++))],
        ]
      : [];
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      const group = element('div', '');
      group.setAttribute('role', 'group');
      const heading = element('p', 'kicker s-group', label);
      heading.id = `s-group-${label.toLowerCase()}`;
      group.setAttribute('aria-labelledby', heading.id);
      group.appendChild(heading);
      for (const row of rows) group.appendChild(row);
      list.appendChild(group);
    }
    input.setAttribute('aria-expanded', String(id > 0));
    count.textContent = query ? (id ? `${id} ${id === 1 ? 'result' : 'results'}` : 'No results') : '';
    hint.hidden = id > 0;
    if (!query) hint.textContent = emptyHint;
    else if (results && !id) {
      const link = element('a', '', 'Nominate someone');
      link.setAttribute('href', nominate);
      hint.textContent = `No matches for “${query}”. `;
      hint.appendChild(link);
      hint.appendChild(document.createTextNode(' who posts about it.'));
    }
  };

  const search = async (query: string) => {
    pending?.abort();
    if (!query) return render('', null);
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' }, signal: controller.signal });
      const results = response.ok ? parse(await response.json()) : null;
      if (pending === controller) render(query, results ?? { people: [], posts: [] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) render(query, { people: [], posts: [] });
    }
  };

  const move = (step: number) => {
    const all = options();
    if (!all.length) return;
    const current = all.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    const next = (current + step + all.length) % all.length;
    all.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
    all[next]?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', all[next]?.id ?? '');
  };

  const open = () => {
    if (dialog.open) return input.focus();
    dialog.showModal();
    input.select();
  };

  document.querySelector('[data-search-open]')?.addEventListener('click', (event) => {
    event.preventDefault();
    open();
  });
  dialog.querySelector('[data-search-close]')?.addEventListener('click', () => dialog.close());
  /* A click on the backdrop lands on the dialog itself, outside its box. */
  dialog.addEventListener('click', (event) => {
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (event.target === dialog && outside) dialog.close();
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(input.value.trim()), 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const all = options();
      go(all.find((o) => o.getAttribute('aria-selected') === 'true') ?? all[0]);
    }
  });
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open();
    } else if (event.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      open();
    }
  });
}
