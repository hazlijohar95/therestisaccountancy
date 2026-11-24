import { CHANNEL, DEFAULTS, LAYOUTS, SEGMENTS, parse, serialize } from './state.js';

const $ = (id) => document.getElementById(id);
const STORE = 'sta-broadcast';
const channel = new BroadcastChannel(CHANNEL);
const names = (table) => Object.fromEntries(Object.entries(table).map(([key, entry]) => [key, entry.suggested ? `${entry.name} (suggested)` : entry.name]));

// Every control, in order. `on` names the views a control applies to.
const FIELDS = [
  { key: 'view', label: 'View', options: { show: 'Show', countdown: 'Countdown', card: 'Card' } },
  { key: 'layout', label: 'Layout', options: names(LAYOUTS), on: ['show'] },
  { key: 'segment', label: 'Segment', options: names(SEGMENTS), on: ['show', 'card'] },
  { key: 'mode', label: 'Lower third', options: { story: 'Headline', title: 'Segment title' }, on: ['show'] },
  { key: 'headline', label: 'Headline', rows: 2, max: 120, hint: '*Asterisks* mark a word.' },
  { key: 'hosts', label: 'Hosts', max: 80, on: ['show', 'card'] },
  { key: 'guest', label: 'Guest', max: 40, on: ['show', 'card'] },
  { key: 'role', label: 'Guest role', max: 60, on: ['show', 'card'] },
  { key: 'status', label: 'Clock label', options: { rec: 'Rec', live: 'Live', off: 'Off' }, on: ['show'] },
  { key: 'sponsor', label: 'Presented by', max: 40, on: ['show'], hint: 'Empty shows the club endorsement.' },
  { key: 'ticker', label: 'Ticker', rows: 3, max: 600, on: ['show', 'countdown'], hint: 'Separate items with |. A figure in (brackets) prints in redline.' },
  { key: 'count', label: 'Countdown, seconds', max: 5, on: ['countdown'], lazy: true, hint: 'Restarts when you leave the field.' },
];

const stored = () => { try { return localStorage.getItem(STORE) ?? ''; } catch { return ''; } };
let state = parse(location.hash || stored());
// A photo is a blob URL, which dies with the page that made it.
if (state.photo.startsWith('blob:')) state.photo = '';

const form = $('controls');
const preview = $('preview');
const field = (f) => {
  const id = `f-${f.key}`;
  const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
  if (f.options) {
    const chips = Object.entries(f.options).map(([value, text]) => `<button class="chip" type="button" data-key="${f.key}" data-value="${value}">${text}</button>`).join('');
    return `<div class="field" data-field="${f.key}" role="group" aria-label="${f.label}"><span class="label">${f.label}</span><div class="options">${chips}</div>${hint}</div>`;
  }
  const input = f.rows
    ? `<textarea class="input" id="${id}" data-key="${f.key}" rows="${f.rows}" maxlength="${f.max}"></textarea>`
    : `<input class="input" id="${id}" data-key="${f.key}" maxlength="${f.max}"${f.lazy ? ' data-lazy inputmode="numeric"' : ''}>`;
  return `<div class="field" data-field="${f.key}"><label for="${id}">${f.label}</label>${input}${hint}</div>`;
};
form.innerHTML = `${FIELDS.map(field).join('')}<div class="field" data-field="photo"><label for="f-photo">Card photo</label><input id="f-photo" type="file" accept="image/*"><span class="hint">Stays in this browser. Empty shows the placeholder.</span></div>`;

const overlayUrl = () => { const hash = serialize(state); return `${new URL('overlay.html', location.href)}${hash ? `#${hash}` : ''}`; };

const reflect = () => {
  for (const chip of form.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(state[chip.dataset.key] === chip.dataset.value));
  for (const input of form.querySelectorAll('.input')) if (input.value !== state[input.dataset.key]) input.value = state[input.dataset.key];
  for (const f of FIELDS) form.querySelector(`[data-field="${f.key}"]`).hidden = Boolean(f.on && !f.on.includes(state.view));
  form.querySelector('[data-field="photo"]').hidden = state.view !== 'card';
  $('restart').hidden = state.view !== 'countdown';
  $('save').hidden = state.view !== 'card';
  $('screen').dataset.view = state.view;
  $('url').textContent = overlayUrl();
  $('open').href = overlayUrl();
};

const persist = () => {
  const hash = serialize(state);
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  try { localStorage.setItem(STORE, hash); } catch { /* storage unavailable */ }
  reflect();
  return hash;
};

// A draft shows in the preview only. Going to air sends it to every overlay in this browser.
const draft = (patch) => {
  state = { ...state, ...patch };
  preview.contentWindow.postMessage({ type: 'state', hash: persist() }, location.origin);
};
const air = (patch = {}) => {
  state = { ...state, ...patch };
  channel.postMessage({ type: 'state', hash: persist() });
};

form.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) air({ [chip.dataset.key]: chip.dataset.value });
});
// Typing is a draft; leaving the field puts it on air. A lazy field skips the draft, so a half-typed count never runs.
form.addEventListener('input', (event) => {
  const { key, lazy } = event.target.dataset;
  if (key && lazy === undefined) draft({ [key]: event.target.value });
});
form.addEventListener('change', (event) => {
  const { key } = event.target.dataset;
  if (key) air({ [key]: event.target.value });
});
// Only the photo this page made is released when it is replaced; another control room's stays theirs.
let ownPhoto = '';
const dropPhoto = () => { if (ownPhoto) URL.revokeObjectURL(ownPhoto); ownPhoto = ''; };
$('f-photo').addEventListener('change', (event) => {
  const [file] = event.target.files;
  dropPhoto();
  if (file) ownPhoto = URL.createObjectURL(file);
  air({ photo: ownPhoto });
});

$('stinger').addEventListener('click', () => channel.postMessage({ type: 'stinger' }));
$('restart').addEventListener('click', () => channel.postMessage({ type: 'restart' }));
$('reset').addEventListener('click', () => { $('f-photo').value = ''; dropPhoto(); air({ ...DEFAULTS }); });
$('save').addEventListener('click', async () => {
  // A photo from another origin taints the canvas, and a tainted canvas cannot be read back.
  const blob = await new Promise((resolve) => {
    try { preview.contentDocument.getElementById('card').toBlob(resolve, 'image/png'); } catch { resolve(null); }
  });
  if (!blob) {
    $('save').textContent = 'Blocked';
    setTimeout(() => { $('save').textContent = 'Download PNG'; }, 1200);
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `sta-card-${state.segment}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(overlayUrl()); $('copy').textContent = 'Copied'; } catch { $('copy').textContent = 'Blocked'; }
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1200);
});

// The overlay ends its own countdown and says so; follow it.
channel.addEventListener('message', ({ data }) => {
  if (data?.type === 'state') state = parse(data.hash);
  else if (data?.type === 'cut') state = { ...state, view: data.view };
  else return;
  persist();
});

// The preview reads its state from the hash; opening the control room puts nothing on air.
preview.src = `overlay.html?demo#${serialize(state)}`;
reflect();
