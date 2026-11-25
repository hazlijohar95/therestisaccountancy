import { SEGMENTS, klDate, runs } from './state.js';

// The social card, 1080 × 1350, drawn on a canvas so the frame on screen is the PNG that downloads.
// With a photo: black and white, full bleed across the top, torn off above the newsprint that carries the headline.
// Without one: all newsprint, and the headline takes the page. No outlines and no drop shadows.
const W = 1080;
const H = 1350;
const PAD = 72;
const PHOTO = { h: 760 };
const HEAD = { y: 816, h: 380, sizes: [168, 56], leading: .92 };
const HEAD_ALONE = { y: 250, h: 900, sizes: [230, 80], leading: .92, centre: true };
const FOOT = { y: 1236, h: 62, logo: 260 };
const TORN = '../assets/devices/torn-edge.svg';
const TAG = { y: 70, sizes: [56, 30], room: W - PAD * 2 };
// The wordmark, not the lockup: at footer size the tape label would not read.
const LOGO = '../assets/logos/sta-wordmark-color.svg';
const BRUSH = '../assets/devices/brush.svg';
const SANS = '"Instrument Sans"';
const DISPLAY = 'Anton';

const tokens = getComputedStyle(document.documentElement);
const color = (name) => tokens.getPropertyValue(`--color-${name}`).trim();
const radians = (name) => parseFloat(tokens.getPropertyValue(`--rotate-${name}`)) * Math.PI / 180;

const cache = new Map();
const image = (src) => {
  if (!cache.has(src)) cache.set(src, new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }));
  return cache.get(src);
};

// An SVG shape drawn at a size and filled with one colour: the canvas form of a CSS mask.
const tint = (img, w, h, fill) => {
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); x.globalCompositeOperation = 'source-in'; x.fillStyle = fill; x.fillRect(0, 0, w, h);
  return c;
};

const grain = (() => {
  let tile = null;
  return (cx) => {
    if (!tile) {
      tile = document.createElement('canvas'); tile.width = tile.height = 160;
      const x = tile.getContext('2d'); const img = x.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 16; }
      x.putImageData(img, 0, 0);
    }
    return cx.createPattern(tile, 'repeat');
  };
})();

const setFont = (cx, font, { stretch = 'normal', tracking = 0 } = {}) => { cx.font = font; cx.fontStretch = stretch; cx.letterSpacing = `${tracking}px`; };

// A headline is words; a word is pieces of plain or marked text, so "*audit*?" keeps its "?" attached.
const words = (raw) => {
  const out = [];
  let open = false;
  for (const run of runs(raw)) {
    // Split on ordinary spaces only: a no-break space (RM\u00a0500,000) holds its word together.
    for (const part of run.text.split(/([ \t\n]+)/)) {
      if (!part) continue;
      if (/^[ \t\n]+$/.test(part)) { open = false; continue; }
      if (open) out.at(-1).push({ text: part, mark: run.mark }); else out.push([{ text: part, mark: run.mark }]);
      open = true;
    }
  }
  return out;
};

const fitHeadline = (cx, raw, box) => {
  const list = words(raw.toUpperCase());
  const maxW = W - PAD * 2;
  for (let size = box.sizes[0]; size >= box.sizes[1]; size -= 2) {
    setFont(cx, `400 ${size}px ${DISPLAY}`, { tracking: 0.005 * size });
    const space = cx.measureText(' ').width;
    const measured = list.map((pieces) => { const sized = pieces.map((p) => ({ ...p, w: cx.measureText(p.text).width })); return { pieces: sized, w: sized.reduce((sum, p) => sum + p.w, 0) }; });
    const lines = [[]];
    let width = 0;
    for (const word of measured) {
      if (lines.at(-1).length && width + space + word.w > maxW) { lines.push([]); width = 0; }
      width += (lines.at(-1).length ? space : 0) + word.w;
      lines.at(-1).push(word);
    }
    // A single word left alone on the last line is an orphan: take the next size down instead.
    const orphan = lines.length > 1 && lines.at(-1).length === 1;
    const fits = measured.every((word) => word.w <= maxW) && lines.length * size * box.leading <= box.h && !orphan;
    if (fits || size === box.sizes[1]) return { size, space, lines };
  }
  return null;
};

// Set from the top of the box down, cap height to cap height, so short and long headlines share a top edge.
const drawHeadline = (cx, raw, box, brush) => {
  const { size, space, lines } = fitHeadline(cx, raw, box);
  const cap = size * 0.735;
  // Alone on the page the headline sits in the middle of its space; under a photo it hangs from the top edge.
  const drop = box.centre ? (box.h - ((lines.length - 1) * size * box.leading + cap)) / 2 : 0;
  cx.textBaseline = 'alphabetic';
  lines.forEach((line, row) => {
    const base = box.y + drop + cap + row * size * box.leading;
    const place = (paint) => {
      let x = PAD;
      line.forEach((word, i) => {
        word.pieces.forEach((piece, j) => {
          const bridges = j === word.pieces.length - 1 && line[i + 1]?.pieces[0].mark;
          paint(piece, x, bridges ? space : 0);
          x += piece.w;
        });
        x += space;
      });
    };
    // The highlighter is a pen stroke across the lower part of the capitals, ragged at both ends, a degree off level.
    place((piece, x, bridge) => {
      if (!piece.mark) return;
      const w = piece.w + size * 0.3 + bridge;
      // The brush artwork fills only the middle band of its box, so the box is drawn taller than the stroke it shows.
      const h = cap * 1.35;
      cx.save();
      cx.translate(x - size * 0.15 + w / 2, base - cap * 0.3);
      cx.rotate(-Math.PI / 180);
      cx.drawImage(tint(brush, w, h, color('highlighter')), -w / 2, -h / 2, w, h);
      cx.restore();
    });
    cx.fillStyle = color('ink');
    place((piece, x) => cx.fillText(piece.text, x, base));
  });
};

const drawPhoto = (cx, photo, torn) => {
  cx.save();
  cx.beginPath(); cx.rect(0, 0, W, PHOTO.h); cx.clip();
  const scale = Math.max(W / photo.naturalWidth, PHOTO.h / photo.naturalHeight);
  const dw = photo.naturalWidth * scale;
  const dh = photo.naturalHeight * scale;
  cx.filter = 'grayscale(1) contrast(1.1) brightness(1.02)';
  cx.drawImage(photo, (W - dw) / 2, (PHOTO.h - dh) * 0.25, dw, dh);
  cx.filter = 'none';
  cx.fillStyle = grain(cx); cx.fillRect(0, 0, W, PHOTO.h);
  cx.restore();
  // The newsprint tears across the bottom of the photo: the torn-edge device, turned to face up.
  cx.save();
  cx.translate(0, PHOTO.h + 14);
  cx.scale(1, -1);
  cx.drawImage(tint(torn, W, 34, color('stock')), 0, 0, W, 34);
  cx.restore();
};

// The tag shares the top edge with nothing, but a long one, such as a date, still steps down to fit.
const drawTape = (cx, tape, text) => {
  let size = TAG.sizes[0];
  const width = () => { setFont(cx, `${size}px "Gochi Hand"`); return cx.measureText(text).width + size * 1.4; };
  while (width() > TAG.room && size > TAG.sizes[1]) size -= 2;
  const w = width();
  const h = size * 1.5;
  cx.save();
  cx.translate(PAD + w / 2, TAG.y + h / 2);
  cx.rotate(radians('tape'));
  cx.drawImage(tint(tape, w, h, color('tape')), -w / 2, -h / 2);
  const sheen = cx.createLinearGradient(0, -h / 2, 0, h / 2); sheen.addColorStop(0, 'rgb(255 255 255 / .28)'); sheen.addColorStop(.5, 'rgb(255 255 255 / 0)');
  cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = sheen; cx.fillRect(-w / 2, -h / 2, w, h); cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = color('ink'); cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(text, 0, size * 0.04);
  cx.restore();
};

const drawStamp = (cx, text, size) => {
  setFont(cx, `700 ${size}px ${SANS}`, { stretch: 'condensed', tracking: size * 0.08 });
  const w = cx.measureText(text).width + size * 1.2;
  const h = size * 1.5;
  cx.save();
  cx.translate(PAD + w / 2 + 8, TAG.y + h / 2 + 6);
  cx.rotate(radians('stamp'));
  cx.fillStyle = 'rgb(255 255 255 / .92)'; cx.fillRect(-w / 2, -h / 2, w, h);
  cx.strokeStyle = cx.fillStyle = color('redline');
  cx.lineWidth = 2;
  cx.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
  cx.lineWidth = 1;
  cx.strokeRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18);
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(text, size * 0.04, size * 0.06);
  cx.restore();
};

const drawNametag = (cx, role, name) => {
  const size = 50;
  const roleSize = 26;
  cx.save();
  cx.translate(PAD, PHOTO.h - 44);
  cx.rotate(radians('tag'));
  cx.textAlign = 'left'; cx.textBaseline = 'middle';
  setFont(cx, `400 ${size}px ${DISPLAY}`, { tracking: size * 0.02 });
  const nameH = size * 1.36;
  const nameW = cx.measureText(name.toUpperCase()).width + size * 0.8;
  cx.fillStyle = color('tape'); cx.fillRect(0, -nameH, nameW, nameH);
  cx.fillStyle = color('ink'); cx.fillText(name.toUpperCase(), size * 0.4, -nameH / 2 + size * 0.04);
  setFont(cx, `600 ${roleSize}px ${SANS}`, { tracking: roleSize * 0.08 });
  const roleH = roleSize * 1.7;
  const roleW = cx.measureText(role.toUpperCase()).width + roleSize;
  cx.fillStyle = color('night'); cx.fillRect(0, -nameH - roleH, roleW, roleH);
  cx.fillStyle = color('paper'); cx.fillText(role.toUpperCase(), roleSize * 0.5, -nameH - roleH / 2 + roleSize * 0.06);
  cx.restore();
};

const drawFoot = (cx, logo) => {
  const lh = FOOT.logo * logo.naturalHeight / logo.naturalWidth;
  cx.drawImage(logo, PAD, FOOT.y + (FOOT.h - lh) / 2, FOOT.logo, lh);
  setFont(cx, `600 28px ${SANS}`, { tracking: 28 * 0.08 });
  cx.fillStyle = color('ink'); cx.textAlign = 'right'; cx.textBaseline = 'middle';
  cx.fillText('YOUTUBE · SPOTIFY · APPLE PODCASTS', W - PAD, FOOT.y + FOOT.h / 2);
  cx.textAlign = 'left';
};

let latest = 0;

export const drawCard = async (canvas, state) => {
  const turn = ++latest;
  const [logo, tape, torn, brush] = await Promise.all([LOGO, '../assets/devices/tape.svg', TORN, BRUSH].map(image));
  // A photo is a blob URL from the control room; if it has died, the card goes typographic.
  const photo = state.photo ? await image(state.photo).catch(() => null) : null;
  const segment = SEGMENTS[state.segment];
  const guest = state.guest.trim();
  const tag = segment.label ?? klDate(new Date());
  const role = state.role.trim() || (guest ? 'guest' : 'podcaster');
  const name = guest || state.hosts.split('·')[0].trim();
  const headline = state.headline.trim() || `${tag}.`;
  // A canvas does not redraw when a font subset arrives late, so load the subsets these strings need first.
  await Promise.all([[`100px ${DISPLAY}`, headline.toUpperCase() + name.toUpperCase()], [`600 26px ${SANS}`, role.toUpperCase()], ['54px "Gochi Hand"', tag]].map(([font, text]) => document.fonts.load(font, text)));
  if (turn !== latest) return;

  const cx = canvas.getContext('2d');
  cx.fillStyle = color('stock'); cx.fillRect(0, 0, W, H);
  cx.fillStyle = grain(cx); cx.fillRect(0, 0, W, H);
  if (photo) drawPhoto(cx, photo, torn);
  if (segment.tag === 'stamp') drawStamp(cx, tag.toUpperCase(), photo ? 44 : 64); else drawTape(cx, tape, tag);
  if (photo) drawNametag(cx, role, name);
  drawHeadline(cx, headline, photo ? HEAD : HEAD_ALONE, brush);
  drawFoot(cx, logo);
};
