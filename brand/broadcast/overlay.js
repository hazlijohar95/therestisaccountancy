import { drawCard } from './card.js';
import { CHANNEL, LAYOUTS, SEGMENTS, STAGES, escape, klClock, klDate, marked, parse, serialize, tickerItem } from './state.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const stinger = $('stinger');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Camera placeholders are a preview aid, so they belong to this window, not to the broadcast state.
const demo = new URLSearchParams(location.search).has('demo');
// Preview feeds per camera window: photos from the show, never part of the packaged brand.
const FEEDS = { '1up': ['wide'], '2full': ['host-a', 'host-b'], '2up': ['host-a', 'host-b'], '3up': ['host-a', 'screen', 'host-b'] };
const channel = new BroadcastChannel(CHANNEL);

const STINGER_COVERED_MS = 640;
const STINGER_TOTAL_MS = 1700;

let shown = null;
let target = parse(location.hash);
let cutting = false;
let countdownEnds = 0;

const scaleStage = () => {
  const { W, H } = STAGES[stage.dataset.view];
  const scale = Math.min(innerWidth / W, innerHeight / H);
  stage.style.setProperty('--W', `${W}px`);
  stage.style.setProperty('--H', `${H}px`);
  stage.style.setProperty('--scale', scale);
  stage.style.setProperty('--tx', `${(innerWidth - W * scale) / 2}px`);
  stage.style.setProperty('--ty', `${(innerHeight - H * scale) / 2}px`);
};

// The first size that fits, from short lists: one line first, then wrapped. A headline takes a set size, never an in-between one.
const fit = (el, oneLine, wrapped) => {
  const box = el.parentElement;
  const style = getComputedStyle(box);
  const maxW = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const maxH = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  el.style.whiteSpace = 'nowrap';
  el.style.lineHeight = '';
  for (const size of oneLine) {
    el.style.fontSize = `${size}px`;
    if (el.scrollWidth <= maxW && el.offsetHeight <= maxH) return;
  }
  // Wrapped capitals need open leading, or the lines touch.
  el.style.whiteSpace = 'normal';
  el.style.lineHeight = '1.04';
  for (const size of wrapped) {
    el.style.fontSize = `${size}px`;
    if (el.scrollWidth <= maxW && el.offsetHeight <= maxH) return;
  }
};

// The strip's detail line steps down to 18px for a long name and role, then ends in an ellipsis.
const fitKicker = () => {
  const line = $('kicker');
  for (let size = 24; size >= 18; size -= 1) {
    line.style.fontSize = `${size}px`;
    if (line.scrollWidth <= line.clientWidth) return;
  }
};

const replay = (el, name) => { el.classList.remove(name); void el.offsetWidth; el.classList.add(name); };

const setTicker = (el, raw) => {
  const items = raw.split('|').map((item) => item.trim()).filter(Boolean);
  const track = items.map((item) => `<span class="item">${tickerItem(item)}</span><span class="sep">✕</span>`).join('');
  const repeats = Math.max(1, Math.ceil(200 / Math.max(1, raw.length)));
  el.innerHTML = `<div>${track.repeat(repeats)}</div><div aria-hidden="true">${track.repeat(repeats)}</div>`;
  el.style.setProperty('--dur', `${Math.max(24, raw.length * repeats * 0.2)}s`);
};

// What the lower third says. Title mode names the segment (or the guest); story mode carries the headline.
// Title mode puts the segment (or the guest) in the headline; story mode puts it in the strip and the story below.
// Names and labels carry no full stop; only a headline that is a sentence does.
const lowerThird = (s) => {
  const segment = SEGMENTS[s.segment];
  const name = segment.label ?? klDate(new Date());
  const guest = s.guest.trim();
  const role = s.role.trim();
  const interview = s.segment === 'interview';
  const titled = s.mode === 'title' || !s.headline.trim();
  const guestTitle = titled && interview && guest;
  const head = guestTitle ? escape(guest) : titled ? escape(name) : marked(s.headline);
  const detail = interview ? [!guestTitle && guest, role].filter(Boolean).join(', ') : '';
  const label = titled && !guestTitle ? '' : name;
  return { head, titled, label, kicker: detail || s.hosts };
};

const renderShow = (s, prev) => {
  const layout = LAYOUTS[s.layout];
  const segment = SEGMENTS[s.segment];
  const changed = (...keys) => !prev || prev.view !== 'show' || keys.some((key) => prev[key] !== s[key]);

  if (changed('layout')) {
    const holes = layout.cams.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}Z`).join(' ');
    $('backdrop').hidden = !layout.framed;
    $('backdrop').style.clipPath = `path(evenodd, "M0 0H1920V1080H0Z ${holes}")`;
    const box = ([x, y, w, h]) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    const feed = (i) => {
      const name = FEEDS[s.layout]?.[i];
      if (!demo || !name) return ['', ''];
      if (name === 'screen') return [' screen', `<span>${layout.labels?.[i] ?? 'Screen'}</span>`];
      return [` demo" data-feed="${name}`, ''];
    };
    $('cams').innerHTML = layout.cams.map((rect, i) => { const [cls, inner] = feed(i); return `<div class="cam${layout.framed ? ' framed' : ''}${cls}" style="${box(rect)}">${inner}</div>`; }).join('')
      + layout.rules.map((rect) => `<div class="cam-rule" style="${box(rect)}"></div>`).join('');
  }

  $('status').hidden = s.status === 'off';
  $('status').textContent = s.status === 'live' ? 'Live' : 'Rec';
  if (changed('sponsor')) {
    $('from').innerHTML = s.sponsor.trim()
      ? `<small>Presented by</small><b>${escape(s.sponsor.trim())}</b>`
      : '<small>A podcast from</small><img src="../assets/logos/tria-wordmark-reversed.svg" alt="The Rest Is Accountancy">';
  }

  const lt = $('lt');
  lt.dataset.ground = segment.ground;
  lt.dataset.mode = s.mode;
  if (changed('segment', 'mode', 'headline', 'hosts', 'guest', 'role')) {
    const { head, titled, label, kicker } = lowerThird(s);
    $('label').textContent = label;
    $('label').hidden = !label;
    $('kicker').textContent = kicker;
    fitKicker();
    $('head').innerHTML = head;
    fit($('head'), [104, 80], [60, 52, 44]);
    replay(lt, 'in');
  }
  if (changed('ticker')) setTicker($('ticker'), s.ticker);
};

const renderCountdown = (s, prev) => {
  if (!prev || prev.view !== 'countdown' || prev.count !== s.count) restartCountdown(s);
  $('cd-next').innerHTML = marked(s.headline);
  fit($('cd-next'), [84, 64], [72, 60, 52, 44, 40]);
  setTicker($('cd-ticker'), s.ticker);
  tick();
};

const renderCard = (s) => drawCard($('card'), s);

const VIEWS = { show: renderShow, countdown: renderCountdown, card: renderCard };

const paint = () => {
  const prev = shown;
  shown = target;
  stage.dataset.view = shown.view;
  scaleStage();
  VIEWS[shown.view](shown, prev);
};

const playStinger = () => {
  if (reduced) return;
  replay(stinger, 'play');
  clearTimeout(playStinger.timer);
  playStinger.timer = setTimeout(() => stinger.classList.remove('play'), STINGER_TOTAL_MS);
};

// A change of view or layout is a cut: the stinger covers the frame and the new one is painted underneath.
const apply = (next) => {
  target = next;
  if (cutting) return;
  const cut = shown && (shown.view !== next.view || shown.layout !== next.layout);
  if (!cut || reduced) { paint(); return; }
  cutting = true;
  playStinger();
  setTimeout(() => { cutting = false; paint(); }, STINGER_COVERED_MS);
};

// No positive count means no countdown: the clock holds at 00:00 and nothing cuts.
const restartCountdown = (s) => { const seconds = Number(s.count); countdownEnds = seconds > 0 ? Date.now() + seconds * 1000 : 0; };

const tick = () => {
  const now = new Date();
  const clock = klClock(now);
  $('clock-time').textContent = clock.time;
  $('clock-period').textContent = `${clock.period} MYT`;
  $('clock-day').textContent = clock.day;
  if (shown?.view !== 'countdown') return;
  const left = Math.max(0, Math.ceil((countdownEnds - now) / 1000));
  const readout = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  $('cd-clock').innerHTML = [...readout].map((c) => (c === ':' ? '<i class="colon">:</i>' : `<i>${c}</i>`)).join('');
  $('cd-clock').setAttribute('aria-label', readout);
  if (left === 0 && countdownEnds && target.view === 'countdown') {
    channel.postMessage({ type: 'cut', view: 'show' });
    MESSAGES.cut({ view: 'show' });
  }
};

const MESSAGES = {
  state: ({ hash }) => { history.replaceState(null, '', `#${hash}`); apply(parse(hash)); },
  // A cut changes the view only, so an overlay holding a draft does not put the draft on air.
  cut: ({ view }) => MESSAGES.state({ hash: serialize({ ...target, view }) }),
  stinger: () => playStinger(),
  restart: () => { restartCountdown(target); tick(); },
};
channel.addEventListener('message', ({ data }) => MESSAGES[data?.type]?.(data));
// The control room previews a draft here before it goes to air on the channel.
addEventListener('message', (event) => { if (event.origin === location.origin) MESSAGES[event.data?.type]?.(event.data); });
addEventListener('hashchange', () => apply(parse(location.hash)));

await Promise.all([document.fonts.load('100px Anton'), document.fonts.load('700 30px "Instrument Sans"'), document.fonts.load('30px "Geist Pixel"'), document.fonts.load('30px "Gochi Hand"')]);
paint();
// The stage has no view to size until the first paint names one.
addEventListener('resize', scaleStage);
setInterval(tick, 1000);
tick();
