// One state object drives every view: the lower third, the layouts, the countdown and the card.
// It travels as the URL hash, so an overlay URL is a complete, reproducible frame.

export const STAGES = {
  show: { W: 1920, H: 1080 },
  countdown: { W: 1920, H: 1080 },
  card: { W: 1080, H: 1350 },
};

// Camera windows per layout, in stage pixels. `framed` layouts paint the tape backdrop around the windows.
export const LAYOUTS = {
  '1up': { name: '1-up', framed: false, cams: [[0, 0, 1920, 1080]], rules: [] },
  '2full': { name: '2-up full', framed: false, cams: [[0, 0, 958, 1080], [962, 0, 958, 1080]], rules: [[958, 0, 4, 1080]] },
  '2up': { name: '2-up', framed: true, cams: [[48, 124, 897, 612], [969, 124, 897, 612]], rules: [] },
  '3up': { name: '3-up', framed: true, cams: [[48, 124, 393, 612], [465, 124, 984, 612], [1473, 124, 393, 612]], labels: ['Cam 1', 'Screen', 'Cam 2'], rules: [] },
  blank: { name: 'Blank', framed: true, cams: [], rules: [] },
};

// A segment is a ground for the strip above the headline; the headline itself is always paper.
// Night is the default, tape marks the news, redline a correction. `tag` is how the card labels it.
// News, Analysis and Interview are the show's own labels; Correction is a suggestion.
export const SEGMENTS = {
  date: { name: 'Date', label: null, ground: 'night', tag: 'tape' },
  news: { name: 'News', label: 'News', ground: 'tape', tag: 'tape' },
  analysis: { name: 'Analysis', label: 'Analysis', ground: 'night', tag: 'tape' },
  interview: { name: 'Interview', label: 'Interview', ground: 'night', tag: 'tape' },
  correction: { name: 'Correction', label: 'Correction', ground: 'redline', tag: 'stamp', suggested: true },
};

export const DEFAULTS = {
  view: 'show',
  layout: '1up',
  segment: 'news',
  mode: 'story',
  headline: 'Who signs off the *AI audit*?',
  hosts: 'Hazli Johar · Shukri Yusof · Abu Musa',
  guest: '',
  role: '',
  status: 'rec',
  sponsor: '',
  ticker: 'Ep. 42 What’s going wrong in our accounting schools? 52:10 | Ep. 43 E-invoicing: who is actually ready? 38:44 | Ep. 44 Who signs off the AI audit? 41:02',
  count: '300',
  photo: '',
};

const ALLOWED = {
  view: Object.keys(STAGES),
  layout: Object.keys(LAYOUTS),
  segment: Object.keys(SEGMENTS),
  mode: ['title', 'story'],
  status: ['rec', 'live', 'off'],
};

export const parse = (hash) => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    if (ALLOWED[key] && !ALLOWED[key].includes(value)) continue;
    state[key] = value;
  }
  return state;
};

export const serialize = (state) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (key in DEFAULTS && value !== DEFAULTS[key]) params.set(key, value);
  return params.toString();
};

export const CHANNEL = 'sta-broadcast';

export const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// *Asterisks* mark words, the cover maker's convention. `runs` is the same text for a canvas.
// A currency and its figure never part across a line: RM 500,000 stays whole.
const bind = (raw) => raw.replace(/\b(RM|USD|SGD)\s+(?=[\d(])/g, '$1\u00a0');
export const marked = (raw) => escape(bind(raw)).replace(/\*([^*]+)\*/g, '<span class="mark">$1</span>');
export const runs = (raw) => bind(raw).split('*').map((text, i) => ({ text, mark: i % 2 === 1 })).filter((run) => run.text);

// A ticker item: a trailing timecode sets in the pixel face; a figure in (brackets) prints in redline.
export const tickerItem = (raw) => escape(raw.trim())
  .replace(/\(([\d.,]+)\)/g, '<span class="neg">$1</span>')
  .replace(/(\d+:\d\d)$/, '<span class="tc">$1</span>');

const KL = 'Asia/Kuala_Lumpur';
export const klDate = (now) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: KL }).format(now).replace(',', '');
export const klClock = (now) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric', month: 'short', timeZone: KL }).formatToParts(now).map((p) => [p.type, p.value]));
  return { time: `${parts.hour}:${parts.minute}`, period: parts.dayPeriod.toUpperCase(), day: `${parts.day} ${parts.month}`.toUpperCase() };
};
