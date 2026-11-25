{
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rootStyle = getComputedStyle(root);
  const color = (name) => rootStyle.getPropertyValue(`--color-${name}`).trim();
  const getJson = (path) => fetch(path).then((r) => r.json());
  const tokensReady = getJson('tokens/tokens.json');
  const catalogReady = getJson('assets/logos/catalog.json');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  /* ---------- Segmented controls ---------- */
  const setSeg = (seg, i) => {
    const buttons = $$('button', seg);
    seg.style.setProperty('--i', i);
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  };
  const bindSeg = (seg, onPick) => {
    $$('button', seg).forEach((b, i) => b.addEventListener('click', () => { setSeg(seg, i); onPick(b.dataset.v ?? b.dataset.pick ?? b.textContent, i); }));
  };

  /* ---------- Stamp feedback ---------- */
  const stampAt = (x, y, text) => {
    const fly = document.createElement('div');
    fly.className = 'fly';
    fly.style.left = `${x}px`;
    fly.style.top = `${y}px`;
    fly.innerHTML = `<span class="stamp hit">${text}</span>`;
    document.body.append(fly);
    setTimeout(() => fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.then(() => fly.remove()), 700);
  };
  const stampOn = (el, text) => { const r = el.getBoundingClientRect(); stampAt(r.left + r.width / 2, r.top + r.height / 2, text); };
  const copy = async (text, el, ev) => {
    try {
      await navigator.clipboard.writeText(text);
      if (ev && ev.clientX) stampAt(ev.clientX, ev.clientY, 'Copied'); else stampOn(el, 'Copied');
    } catch { stampOn(el, 'Blocked'); }
  };

  /* ---------- Downloads: the platform's save prompt inside claude.ai, a plain link elsewhere ---------- */
  const downloadsReady = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  const saveBlob = async (blob, filename, el) => {
    const downloads = await downloadsReady;
    if (downloads) {
      try { await downloads.save({ filename, data: blob }); stampOn(el, 'Saved'); return 'saved'; }
      catch (err) { return err?.code === 'declined' ? 'declined' : 'unavailable'; }
    }
    if (window.top !== window) return 'unavailable';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    stampOn(el, 'Saved');
    return 'saved';
  };

  /* ---------- Brand switch ---------- */
  const brandSeg = $('.brand-switch');
  const pick = (brand) => {
    root.dataset.brand = brand;
    setSeg(brandSeg, brand === 'podcast' ? 1 : 0);
    store.set('tria-brand', brand);
  };
  pick(store.get('tria-brand', 'club'));
  for (const b of $$('[data-pick]')) {
    b.addEventListener('click', () => pick(b.dataset.pick));
  }

  /* ---------- Compare table: label cells for the stacked phone layout ---------- */
  for (const table of $$('.compare')) {
    const heads = $$('thead th', table).map((th) => th.textContent);
    for (const tr of $$('tbody tr', table)) $$('td', tr).forEach((td, i) => { td.dataset.l = heads[i + 1] || ''; });
  }

  /* ---------- Marquee: the second track is a copy of the first ---------- */
  for (const track of $$('.marquee > div')) track.after(track.cloneNode(true));

  /* ---------- Tokens: palette, contrast, ladder, facts, spacing ---------- */
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`; };
  const own = (o) => Object.entries(o).filter(([k]) => !k.startsWith('$'));
  const words = (key) => key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

  tokensReady.then((t) => {
    const palette = own(t.color);
    const hexOf = Object.fromEntries(palette.map(([k, v]) => [k, v.$value]));
    $('#palette').innerHTML = palette.map(([k, v]) => {
      const hex = v.$value;
      const ink = contrast(hex, hexOf.ink) >= contrast(hex, hexOf.paper) ? hexOf.ink : hexOf.paper;
      return `<button class="chiprow" type="button" style="background:${hex};color:${ink}" data-hex="${hex}" aria-label="Copy ${words(k)}, ${hex}"><span class="nm">${words(k)}</span><span class="meta"><span class="hex">${hex}</span><span>RGB ${rgb(hex)}</span></span></button>`;
    }).join('');
    for (const b of $$('.chiprow')) b.addEventListener('click', (e) => copy(b.dataset.hex, b, e));

    const cols = [['club', 0], ['club', 1], ['podcast', 0], ['podcast', 1]];
    let passed = 0;
    let total = 0;
    $('#pairs tbody').innerHTML = t.contract.pairs.map(([fg, bg, min]) => {
      const cells = cols.map(([brand, i]) => {
        const f = hexOf[t.theme[brand][fg][i]];
        const b = hexOf[t.theme[brand][bg][i]];
        const r = contrast(f, b);
        total += 1;
        if (r >= min) passed += 1;
        return `<td><span class="pair-chip" style="color:${f};background:${b}">Aa</span> <span class="${r >= min ? 'pass' : 'neg'}">${r.toFixed(1)}</span></td>`;
      }).join('');
      return `<tr><td>${fg} on ${bg}</td>${cells}<td>${min}:1</td></tr>`;
    }).join('');

    const facts = { brands: own(t.theme).length, colours: palette.length, faces: own(t.font).length, checks: passed };
    for (const [k, v] of Object.entries(facts)) $(`[data-fact="${k}"]`).textContent = v;
    $('[data-fact="checks"]').nextElementSibling.textContent = `of ${total} contrast checks`;

    const sample = { poster: 'Taxes.', title: 'Two voices.', head: 'Who signs off the AI audit?', lead: 'Lecturers, graduates and a hiring partner on the gap.', body: 'Body copy sits at 17px with 1.55 leading, under 70 characters a line.', small: 'Captions, hints and table text.', label: 'Labels and meta' };
    const serif = ['poster', 'title', 'head'];
    // A fluid size shows its range, a fixed one its value, both in px at the default 16px root.
    const range = (value) => { const px = value.match(/[\d.]+(?=rem)/g).map((rem) => Math.round(rem * 16)); return px.length > 1 ? `${px[0]}–${px.at(-1)}px` : `${px[0]}px`; };
    $('#ladder').innerHTML = own(t.size).map(([k, v]) => `<div class="step"><span class="label"><b>${k}</b><span>${range(v.$value)}</span></span><div class="${serif.includes(k) ? `display ${k}` : k}" style="font-size:var(--size-${k})">${sample[k]}</div></div>`).join('');

    $('#spaces').innerHTML = own(t.space).map(([k, v]) => `<div><i style="width:${v.$value}"></i><code>space-${k} · ${v.$value}</code></div>`).join('');
  }).catch(() => {
    $('#palette').innerHTML = '<p class="small" style="padding:16px">Serve this folder over http (python3 -m http.server) to load tokens/tokens.json.</p>';
  });

  /* ---------- Logo files, rendered from assets/logos/catalog.json ---------- */
  const layoutName = { lockup: 'lockup', tagline: 'with tagline', wordmark: 'wordmark' };
  const variantName = { color: 'Colour', reversed: 'Reversed', mono: 'Mono' };
  const ground = { color: ['var(--color-paper)', 'var(--color-ink)'], reversed: ['var(--color-night)', 'var(--color-paper)'], mono: ['var(--color-tape)', 'var(--color-ink)'] };
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  catalogReady.then((catalog) => {
    $('#logo-files').innerHTML = catalog.map((e, i) => {
      // Mono shows on the brand's own ground: tape for the podcast (to show the knockout), paper for the club.
      const [bg, fg] = e.variant === 'mono' && e.brand === 'club' ? ground.color : ground[e.variant];
      const brandName = e.brand === 'club' ? 'The Rest Is Accountancy' : 'Stick to Accounting';
      const art = e.variant === 'mono'
        ? `<span class="mono-art" style="aspect-ratio:${e.aspect};mask-image:url('${e.file}')" role="img" aria-label="${brandName}, mono"></span>`
        : `<img src="${e.file}" alt="${brandName}, ${variantName[e.variant].toLowerCase()}" style="aspect-ratio:${e.aspect}">`;
      const png = e.png ? `<button class="chip" type="button" data-save="${i}" data-format="png">PNG</button>` : '';
      const size = e.pngSize ? ` · PNG ${e.pngSize.join(' × ')}` : ' · currentColor';
      return `<figure class="logo-file"><div class="stage" style="background:${bg};color:${fg}">${art}</div><figcaption><span><b>${e.brand === 'club' ? 'Club' : 'Podcast'} ${layoutName[e.layout]}</b> · ${variantName[e.variant]}</span><span class="facts-line">SVG ${kb(e.bytes)}${size}</span><span class="row"><button class="chip" type="button" data-save="${i}" data-format="svg">SVG</button>${png}<button class="chip" type="button" data-copy-svg="${i}">Copy SVG</button></span></figcaption></figure>`;
    }).join('');
    for (const b of $$('[data-save]')) {
      b.addEventListener('click', async () => {
        const e = catalog[Number(b.dataset.save)];
        const path = b.dataset.format === 'png' ? e.png : e.file;
        const blob = await fetch(path).then((r) => r.blob());
        const result = await saveBlob(blob, path.split('/').pop(), b);
        if (result === 'unavailable') stampOn(b, 'Blocked');
      });
    }
    for (const b of $$('[data-copy-svg]')) {
      b.addEventListener('click', async (ev) => copy(await fetch(catalog[Number(b.dataset.copySvg)].file).then((r) => r.text()), b, ev));
    }
  }).catch(() => { $('#logo-files').innerHTML = '<p class="small" style="padding:16px">Serve this folder over http to load the logo catalog.</p>'; });

  /* ---------- Logo ground test ---------- */
  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const busy = 'repeating-linear-gradient(45deg,#c7b9a3 0 18px,#5d7d8c 18px 36px,#d9c7a0 36px 54px)';
  const grounds = [
    { label: 'Paper', bg: color('paper'), tone: 'light', ok: { club: true, podcast: true }, note: { club: 'Clean paper. The club in ink.', podcast: 'Paper is the logo’s ground. The yellow is for the page around it.' } },
    { label: 'Night', bg: color('night'), tone: 'dark', ok: { club: true, podcast: true }, note: { club: 'The club’s home ground. Reversed wordmark.', podcast: 'Use the reversed file: paper letters, the same tape.' } },
    { label: 'Tape', bg: color('tape'), tone: 'light', ok: { club: false, podcast: false }, note: { club: 'The club never uses yellow.', podcast: 'Tape on tape: the label vanishes. Put the logo on a white or black panel inside the yellow.' } },
    { label: 'Red', bg: color('redline'), tone: 'dark', ok: { club: false, podcast: false }, note: { club: 'Redline is for corrections only. Never a ground.', podcast: 'Redline is for corrections only. Never a ground.' } },
    { label: 'Photo', bg: busy, tone: 'light', ok: { club: false, podcast: false }, note: { club: 'Busy photos swallow the mark. Use a solid band.', podcast: 'Busy photos swallow the mark. Use a solid band or a torn strip.' } },
  ];
  const gSeg = $('#grounds');
  gSeg.insertAdjacentHTML('beforeend', grounds.map((g, i) => `<button type="button" aria-pressed="${i === 0}">${g.label}</button>`).join(''));
  let groundIndex = 0;
  const drawGround = () => {
    const g = grounds[groundIndex];
    const brand = root.dataset.brand === 'podcast' ? 'podcast' : 'club';
    const stage = $('#ground-stage');
    stage.style.background = g.bg;
    stage.style.color = color(g.tone === 'dark' ? 'paper' : 'ink');
    $('#ground-logo').innerHTML = brand === 'club'
      ? '<span class="logo-tria" role="img" aria-label="The Rest Is Accountancy"></span>'
      : `<img src="assets/logos/sta-lockup-${g.tone === 'dark' ? 'reversed' : 'color'}.svg" alt="Stick to Accounting">`;
    const ok = g.ok[brand];
    const stamp = $('#ground-stamp');
    stamp.textContent = ok ? 'Approved' : 'Rejected';
    stamp.classList.toggle('pass', ok);
    replay(stamp, 'hit');
    $('#ground-note').innerHTML = `<b>${ok ? 'Approved.' : 'Rejected.'}</b> ${g.note[brand]}`;
  };
  setSeg(gSeg, groundIndex);
  bindSeg(gSeg, (_, i) => { groundIndex = i; drawGround(); });
  drawGround();
  new MutationObserver(drawGround).observe(root, { attributes: true, attributeFilter: ['data-brand'] });

  /* ---------- Type tester ---------- */
  const ttText = $('#tt-text');
  const ttSize = $('#tt-size');
  const ttApply = () => {
    for (const s of $$('.tt-sample')) { s.textContent = ttText.value || ' '; s.style.setProperty('--tt', `${ttSize.value}px`); }
    $('#tt-size-out').textContent = ttSize.value;
  };
  ttText.addEventListener('input', ttApply);
  ttSize.addEventListener('input', ttApply);
  ttApply();

  /* ---------- Player: real <audio>, generated jingle ---------- */
  const player = $('#player');
  const audio = new Audio();
  audio.preload = 'auto';
  const wave = $('.wave', player);
  const BARS = 96;
  const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  const encodeWav = (buf) => {
    const data = buf.getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + data.length * 2));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); out.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true);
    out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, data.length * 2, true);
    data.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    return new Blob([out], { type: 'audio/wav' });
  };
  const makeJingle = async () => {
    const sr = 22050;
    const beat = 60 / 96;
    const dur = beat * 24;
    const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.9, 0);
    master.gain.setValueAtTime(0.9, dur - 1.2);
    master.gain.linearRampToValueAtTime(0, dur);
    master.connect(ctx.destination);
    const hz = (m) => 440 * 2 ** ((m - 69) / 12);
    const note = (m, t, len, type, peak) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = hz(m);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.05);
    };
    const noise = ctx.createBuffer(1, sr * 0.1, sr);
    noise.getChannelData(0).forEach((_, i, a) => { a[i] = Math.random() * 2 - 1; });
    const hat = (t) => {
      const s = ctx.createBufferSource(); const f = ctx.createBiquadFilter(); const g = ctx.createGain();
      s.buffer = noise; f.type = 'highpass'; f.frequency.value = 7000;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f).connect(g).connect(master); s.start(t);
    };
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
    for (let bar = 0; bar < 6; bar += 1) {
      const c = chords[bar % 4];
      for (let i = 0; i < 8; i += 1) {
        const t = (bar * 4 + i / 2) * beat;
        note(c[[0, 1, 2, 3, 2, 1, 3, 2][i]] + 12, t, 0.42, 'triangle', 0.16);
        if (i % 2 === 1) hat(t);
      }
      note(c[0] - 12, bar * 4 * beat, beat * 1.8, 'sine', 0.32);
      note(c[0] - 12, (bar * 4 + 2) * beat, beat * 1.6, 'sine', 0.26);
    }
    return ctx.startRendering();
  };
  const paint = () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    const on = Math.round(p * BARS);
    $$('i', wave).forEach((b, i) => b.classList.toggle('on', i < on));
    $('.cur', player).textContent = fmt(audio.currentTime);
    wave.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    wave.setAttribute('aria-valuetext', `${fmt(audio.currentTime)} of ${fmt(audio.duration)}`);
  };
  makeJingle().then((buf) => {
    const d = buf.getChannelData(0);
    const step = Math.floor(d.length / BARS);
    const peaks = Array.from({ length: BARS }, (_, i) => { let m = 0; for (let j = i * step; j < (i + 1) * step; j += 16) m = Math.max(m, Math.abs(d[j])); return m; });
    const max = Math.max(...peaks) || 1;
    wave.innerHTML = peaks.map((v) => `<i style="--h:${Math.max(8, Math.round((v / max) * 100))}%"></i>`).join('');
    audio.src = URL.createObjectURL(encodeWav(buf));
    player.dataset.state = 'paused';
  }).catch(() => { player.dataset.state = 'error'; $('.meta b', player).textContent = 'Audio is unavailable in this browser.'; });
  audio.addEventListener('loadedmetadata', () => { $('.dur', player).textContent = fmt(audio.duration); paint(); });
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('play', () => { player.dataset.state = 'playing'; $('.play', player).setAttribute('aria-label', 'Pause'); $('.live', player).hidden = false; });
  audio.addEventListener('pause', () => { player.dataset.state = 'paused'; $('.play', player).setAttribute('aria-label', 'Play'); $('.live', player).hidden = true; });
  audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); });
  $('.play', player).addEventListener('click', () => {
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => { $('.meta b', player).textContent = 'The browser blocked playback. Tap play again.'; });
    else audio.pause();
  });
  const seekTo = (clientX) => {
    if (!audio.duration) return;
    const r = wave.getBoundingClientRect();
    audio.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * audio.duration;
    paint();
  };
  wave.addEventListener('pointerdown', (e) => { wave.setPointerCapture(e.pointerId); seekTo(e.clientX); });
  wave.addEventListener('pointermove', (e) => { if (wave.hasPointerCapture(e.pointerId)) seekTo(e.clientX); });
  wave.addEventListener('keydown', (e) => {
    if (!audio.duration) return;
    const jumps = { ArrowRight: 2, ArrowLeft: -2, ArrowUp: 2, ArrowDown: -2 };
    if (e.key in jumps) audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + jumps[e.key]));
    else if (e.key === 'Home') audio.currentTime = 0;
    else if (e.key === 'End') audio.currentTime = audio.duration - 0.05;
    else if (e.key === ' ') { if (audio.paused) audio.play(); else audio.pause(); }
    else return;
    e.preventDefault(); paint();
  });
  const speeds = [1, 1.25, 1.5, 2, 0.75];
  $('.speed', player).addEventListener('click', (e) => {
    const next = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
    audio.playbackRate = next;
    e.currentTarget.textContent = `${next}×`;
  });

  /* ---------- Member card tilt ---------- */
  const member = $('#member');
  if (!reduced) {
    member.addEventListener('pointermove', (e) => {
      const r = member.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      member.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
      member.style.setProperty('--rx', `${(0.5 - py) * 12}deg`);
      member.style.setProperty('--gx', `${px * 100}%`);
      member.style.setProperty('--gy', `${py * 100}%`);
    });
    member.addEventListener('pointerleave', () => { for (const p of ['--rx', '--ry', '--gx', '--gy']) member.style.removeProperty(p); });
  }

  /* ---------- Motion replays ---------- */
  for (const b of $$('[data-replay]')) {
    const el = document.getElementById(b.dataset.replay);
    const cls = el.classList.contains('stamp') ? 'hit' : 'slap';
    b.addEventListener('click', () => replay(el, cls));
  }
  replay($('#m-tape'), 'slap');
  const mSeg = $('#m-seg');
  bindSeg(mSeg, () => {});

  /* ---------- Cover maker ---------- */
  const formats = {
    square: { W: 1080, H: 1080, pad: 84, tape: 46, logo: 0.4, note: 40, title: 150 },
    thumb: { W: 1280, H: 720, pad: 64, tape: 42, logo: 0.3, note: 36, title: 140 },
    story: { W: 1080, H: 1920, pad: 96, tape: 56, logo: 0.62, note: 46, title: 170 },
  };
  const defaults = { brand: 'podcast', format: 'square', label: 'Ep. 44', title: 'Who signs off the *AI audit*?', note: 'with Hazli, Shukri & Abu' };
  const mk = { ...defaults, ...store.get('tria-maker', {}) };
  const canvas = $('#mk-canvas');
  const cx = canvas.getContext('2d');
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const tint = (img, w, h, colour) => {
    const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); x.globalCompositeOperation = 'source-in'; x.fillStyle = colour; x.fillRect(0, 0, w, h);
    return c;
  };
  const grainTile = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 160;
    const x = c.getContext('2d'); const img = x.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22; }
    x.putImageData(img, 0, 0); return c;
  })();
  // A title is words; a word is runs of plain or marked text, so "*audit*?" keeps its "?" attached.
  const parseTitle = (raw) => {
    let hl = false;
    return raw.split(/\s+/).filter(Boolean).map((word) => {
      const runs = [];
      for (const part of word.split(/(\*)/)) {
        if (part === '*') { hl = !hl; continue; }
        if (part) runs.push({ text: part, hl });
      }
      return { runs };
    }).filter((w) => w.runs.length);
  };
  const fitTitle = (words, { font, tracking }, maxW, maxH, start, lh) => {
    for (let size = start; size >= 28; size -= 2) {
      cx.font = font(size); cx.letterSpacing = `${tracking * size}px`;
      const space = cx.measureText(' ').width;
      const measured = words.map((w) => { const runs = w.runs.map((r) => ({ ...r, w: cx.measureText(r.text).width })); return { runs, w: runs.reduce((a, r) => a + r.w, 0) }; });
      const lines = []; let line = []; let width = 0;
      const tooWide = measured.some((w) => w.w > maxW);
      for (const w of measured) {
        if (line.length && width + space + w.w > maxW) { lines.push(line); line = []; width = 0; }
        width += (line.length ? space : 0) + w.w; line.push(w);
      }
      if (line.length) lines.push(line);
      if (!tooWide && lines.length * size * lh <= maxH) return { size, lines, space };
    }
    return null;
  };
  const drawTitle = (fit, x, top, lh, ink, hlBg, hlInk) => {
    if (!fit) return;
    const { size, lines, space } = fit;
    lines.forEach((ln, li) => {
      const base = top + size * 0.82 + li * size * lh;
      let px = x;
      ln.forEach((w, wi) => {
        let rx = px;
        w.runs.forEach((r, ri) => {
          if (r.hl) {
            const bridges = ri === w.runs.length - 1 && ln[wi + 1]?.runs[0].hl;
            cx.fillStyle = hlBg;
            cx.fillRect(rx - size * 0.05, base - size * 0.76, r.w + size * 0.1 + (bridges ? space : 0), size * 0.94);
          }
          rx += r.w;
        });
        px += w.w + space;
      });
      px = x;
      ln.forEach((w) => {
        let rx = px;
        w.runs.forEach((r) => { cx.fillStyle = r.hl ? hlInk : ink; cx.fillText(r.text, rx, base); rx += r.w; });
        px += w.w + space;
      });
    });
  };
  const tapePath = (w, h) => {
    const p = new Path2D(); let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    p.moveTo(0, 0); p.lineTo(w, h * 0.04);
    for (let y = 0; y <= h; y += h / 9) p.lineTo(w - r() * h * 0.14, y);
    p.lineTo(4, h);
    for (let y = h; y >= 0; y -= h / 9) p.lineTo(r() * h * 0.14, y);
    p.closePath(); return p;
  };
  const wrapText = (text, maxW, maxLines) => {
    const words = text.split(/\s+/).filter(Boolean); const lines = []; let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (cx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines.slice(0, maxLines);
  };
  // A logo drawn on the canvas: the file, and the aspect ratio the catalog records for it.
  const loadLogo = async (file) => ({ img: await loadImg(file), aspect: (await catalogReady).find((e) => e.file === file).aspect });
  const ink = color('ink'); const paper = color('paper'); const night = color('night');
  let assets = null;
  const assetsReady = tokensReady.then(async (t) => {
    // Each brand's display face as a canvas font: its weight and the family stack its --font-* token names.
    const display = Object.fromEntries(own(t.style).map(([brand, s]) => {
      const family = t.font[s.displayFont.match(/--font-(\w+)/)[1]].$value;
      return [brand, { font: (size) => `${s.displayWeight} ${size}px ${family}`, tracking: parseFloat(s.displayTracking), upper: s.displayCase === 'uppercase' }];
    }));
    const [sta, tria, x] = await Promise.all([
      loadLogo('assets/logos/sta-lockup-color.svg'), loadLogo('assets/logos/tria-wordmark-mono.svg'), loadImg('assets/devices/scribble-x.svg'),
      ...Object.values(display).map((d) => document.fonts.load(d.font(100))), document.fonts.load('40px "Gochi Hand"'), document.fonts.load('600 40px "Instrument Sans"'),
    ]);
    assets = { sta, tria, x, display };
  });

  const renderCover = () => {
    if (!assets) return;
    const f = formats[mk.format];
    const { W, H, pad } = f;
    canvas.width = W; canvas.height = H;
    $('#mk-size').textContent = `${W} × ${H}`;
    cx.textBaseline = 'alphabetic'; cx.letterSpacing = '0px';
    const display = assets.display[mk.brand];
    const title = parseTitle(display.upper ? (mk.title || ' ').toUpperCase() : mk.title || ' ');
    if (mk.brand === 'podcast') {
      cx.fillStyle = color('stock'); cx.fillRect(0, 0, W, H);
      cx.fillStyle = cx.createPattern(grainTile, 'repeat'); cx.fillRect(0, 0, W, H);
      const lw = W * f.logo; const lh = lw / assets.sta.aspect;
      cx.drawImage(assets.sta.img, W - pad - lw, H - pad - lh, lw, lh);
      const xs = f.tape * 2.1;
      cx.drawImage(tint(assets.x, xs, xs * 1.2, ink), W - pad - xs, pad - 10, xs, xs * 1.2);
      let titleTop = pad;
      if (mk.label) {
        cx.font = `${f.tape}px "Gochi Hand"`;
        const tw = cx.measureText(mk.label).width + f.tape * 1.3; const th = f.tape * 1.45;
        cx.save(); cx.translate(pad, pad + 10); cx.rotate(parseFloat(rootStyle.getPropertyValue('--rotate-tape')) * Math.PI / 180);
        const p = tapePath(tw, th); cx.fillStyle = color('tape'); cx.fill(p);
        const g = cx.createLinearGradient(0, 0, tw, th); g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.06)');
        cx.fillStyle = g; cx.fill(p);
        cx.fillStyle = ink; cx.fillText(mk.label, f.tape * 0.65, th * 0.72);
        cx.restore();
        titleTop = pad + th + f.tape * 1.1;
      }
      const stacked = mk.format === 'story';
      const noteH = stacked && mk.note ? f.note * 1.6 : 0;
      const titleBottom = H - pad - lh - f.tape - noteH;
      const fit = fitTitle(title, display, W - pad * 2, titleBottom - titleTop, f.title, 0.92);
      if (fit) {
        const blockH = fit.lines.length * fit.size * 0.92;
        drawTitle(fit, pad, titleTop + (titleBottom - titleTop - blockH) / 2, 0.92, ink, color('highlighter'), ink);
      }
      if (mk.note) {
        cx.letterSpacing = '0px'; cx.font = `${f.note}px "Gochi Hand"`; cx.fillStyle = ink;
        if (stacked) cx.fillText(wrapText(mk.note, W - pad * 2, 1)[0] || '', pad, H - pad - lh - f.tape * 0.9);
        else {
          const lines = wrapText(mk.note, W - pad * 2 - lw - 40, 2);
          lines.forEach((t, i) => cx.fillText(t, pad, H - pad - (lines.length - 1 - i) * f.note * 1.15));
        }
      }
    } else {
      cx.fillStyle = night; cx.fillRect(0, 0, W, H);
      const lw = W * (mk.format === 'thumb' ? 0.34 : 0.44); const lh = lw / assets.tria.aspect;
      cx.drawImage(tint(assets.tria.img, lw, lh, paper), pad, pad, lw, lh);
      cx.fillStyle = paper;
      if (mk.label) {
        cx.font = `600 ${Math.round(f.note * 0.8)}px "Instrument Sans"`; cx.textAlign = 'right';
        cx.fillText(mk.label, W - pad, pad + lh * 0.55); cx.textAlign = 'left';
      }
      const noteH = mk.note ? f.note * 2.2 : 0;
      const titleTop = pad + lh + f.note * 1.5;
      const titleBottom = H - pad - noteH - f.note * 0.8;
      const fit = fitTitle(title, display, W - pad * 2, titleBottom - titleTop, f.title * 1.05, 0.98);
      if (fit) {
        const blockH = fit.lines.length * fit.size * 0.98;
        drawTitle(fit, pad, titleBottom - blockH, 0.98, paper, paper, night);
      }
      if (mk.note) {
        cx.letterSpacing = '0px'; cx.fillStyle = paper;
        cx.fillRect(pad, H - pad - noteH, W - pad * 2, 2);
        cx.font = `400 ${Math.round(f.note * 0.85)}px "Instrument Sans"`;
        cx.fillText(wrapText(mk.note, W - pad * 2, 1)[0] || '', pad, H - pad - noteH * 0.22);
      }
    }
  };
  const mkFields = { label: $('#mk-label'), title: $('#mk-title'), note: $('#mk-note') };
  const syncInputs = () => {
    for (const [k, el] of Object.entries(mkFields)) el.value = mk[k];
    setSeg($('#mk-brand'), mk.brand === 'club' ? 1 : 0);
    setSeg($('#mk-format'), ['square', 'thumb', 'story'].indexOf(mk.format));
  };
  const update = () => { store.set('tria-maker', mk); renderCover(); };
  for (const [k, el] of Object.entries(mkFields)) el.addEventListener('input', () => { mk[k] = el.value; update(); });
  bindSeg($('#mk-brand'), (v) => { mk.brand = v; update(); });
  bindSeg($('#mk-format'), (v) => { mk.format = v; update(); });
  $('#mk-reset').addEventListener('click', () => { Object.assign(mk, defaults); syncInputs(); update(); });
  syncInputs();
  assetsReady.then(renderCover).catch(() => { $('#mk-msg').textContent = 'Could not load the logo files for the preview.'; });

  const msg = $('#mk-msg');
  $('#mk-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const slug = (mk.title.replace(/\*/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cover').slice(0, 48);
    const filename = `${mk.brand === 'club' ? 'tria' : 'sta'}-${slug}-${mk.format}.png`;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { msg.textContent = 'The preview could not be exported.'; return; }
    const result = await saveBlob(blob, filename, btn);
    msg.textContent = { saved: `Saved ${filename}.`, declined: 'Download cancelled.', unavailable: 'Downloads are unavailable here. Right-click the preview and save the image.' }[result];
  });

  /* ---------- Artboards ---------- */
  const frames = $$('.frame');
  const fit = () => {
    for (const f of frames) {
      const b = $('.board', f);
      if (!b || b.closest('.fullsize')) continue;
      const scale = f.clientWidth / b.offsetWidth;
      b.style.transform = `scale(${scale})`;
      f.style.height = `${b.offsetHeight * scale}px`;
    }
  };
  const frameObserver = new ResizeObserver(fit);
  for (const f of frames) frameObserver.observe(f);
  document.fonts?.ready.then(fit);
  for (const btn of $$('[data-full]')) {
    btn.addEventListener('click', () => {
      const board = $('.board', btn.closest('.board-wrap'));
      const frame = board.parentElement;
      const overlay = document.createElement('div');
      overlay.className = 'fullsize';
      overlay.innerHTML = '<button class="btn close" type="button">Close</button>';
      overlay.append(board);
      document.body.append(overlay);
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      const close = () => { frame.append(board); overlay.remove(); fit(); btn.focus(); document.removeEventListener('keydown', onKey); };
      $('.close', overlay).addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      $('.close', overlay).focus();
    });
  }

  /* ---------- Export a board as an image ---------- */
  // The page renders the board itself: a clone, with every stylesheet, font and image inlined as data,
  // drawn through an SVG foreignObject onto a canvas at the board's real pixel size.
  const urlPattern = /url\(\s*["']?([^"')]+?)["']?\s*\)/g;
  const dataUrls = new Map();
  const toDataUrl = (url) => {
    if (!dataUrls.has(url)) {
      dataUrls.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.blob(); })
        .then((blob) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); }))
        // A failure is not remembered: the next export fetches again.
        .catch((err) => { dataUrls.delete(url); throw err; }));
    }
    return dataUrls.get(url);
  };
  const inlineUrls = async (css, base) => {
    // Data URLs are inline already; a fragment (#n, or %23n inside the grain texture) points into its own SVG.
    const urls = [...new Set([...css.matchAll(urlPattern)].map((m) => m[1]).filter((u) => !/^(data:|#|%23)/.test(u)))];
    const found = new Map(await Promise.all(urls.map(async (u) => [u, await toDataUrl(new URL(u, base).href)])));
    return css.replace(urlPattern, (whole, u) => (found.has(u) ? `url("${found.get(u)}")` : whole));
  };
  // The stylesheet files as written, not the CSSOM: Chrome drops a font shorthand holding var() from cssText
  // when a later longhand in the same rule overrides part of it.
  const fileCss = async (href) => {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`${href}: ${response.status}`);
    const text = await response.text();
    const imports = [...text.matchAll(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;/g)];
    const inlined = await Promise.all(imports.map((m) => fileCss(new URL(m[1], href).href)));
    const body = imports.reduce((css, m, i) => css.replace(m[0], inlined[i]), text);
    return inlineUrls(body, href);
  };
  let pageCss = null;
  const renderBoard = async (board) => {
    pageCss ??= Promise.all([...document.styleSheets].map((sheet) => (sheet.href ? fileCss(sheet.href) : inlineUrls(sheet.ownerNode.textContent, location.href)))).then((parts) => parts.join('\n'))
      .catch((err) => { pageCss = null; throw err; });
    const css = await pageCss;
    const W = board.offsetWidth;
    const H = board.offsetHeight;
    const scale = Number(board.dataset.exportWidth || W) / W;
    const clone = board.cloneNode(true);
    clone.style.transform = 'none';
    clone.style.left = '0';
    clone.style.top = '0';
    for (const el of clone.querySelectorAll('[contenteditable]')) el.setAttribute('contenteditable', 'false');
    const images = [...board.querySelectorAll('img')];
    await Promise.all([...clone.querySelectorAll('img')].map(async (img, i) => img.setAttribute('src', await toDataUrl(images[i].currentSrc || images[i].src))));
    const brand = board.closest('[data-brand]')?.dataset.brand ?? 'club';
    // Outside the page there is no body to inherit from, so the board's text settings travel with it.
    const around = getComputedStyle(board.parentElement);
    const inherited = ['font-family', 'font-size', 'font-weight', 'line-height', 'color'].map((p) => `${p}: ${around.getPropertyValue(p)};`).join(' ').replaceAll('"', "'");
    const markup = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" data-brand="${brand}" style="position: relative; width: ${W}px; height: ${H}px; color-scheme: light; ${inherited}"><style><![CDATA[${css}]]></style>${markup}</div></foreignObject></svg>`;
    // A data: URL, not a blob: one: Chrome taints the canvas for a foreignObject SVG loaded from a blob.
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    // The SVG document loads its own fonts; a short wait lets them settle before the raster is taken.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = board.dataset.exportType === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('empty canvas'))), type, 0.92));
  };
  const exportName = (board) => {
    const brand = board.closest('[data-brand]')?.dataset.brand === 'podcast' ? 'sta' : 'tria';
    const name = [...board.classList].find((c) => c.startsWith('b-')).slice(2);
    const size = board.dataset.exportWidth ? `${board.dataset.exportWidth}` : `${board.offsetWidth}x${board.offsetHeight}`;
    return `${brand}-${name}-${size}.${board.dataset.exportType === 'jpeg' ? 'jpg' : 'png'}`;
  };
  for (const wrap of $$('.board-wrap')) {
    const full = $('[data-full]', wrap);
    if (!full) continue;
    const board = $('.board', wrap);
    const format = board.dataset.exportType === 'jpeg' ? 'JPG' : 'PNG';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = format;
    button.setAttribute('aria-label', `Download ${$('header b', wrap).textContent} as ${format}`);
    full.before(button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Rendering';
      try {
        const result = await saveBlob(await renderBoard(board), exportName(board), button);
        if (result === 'unavailable') stampOn(button, 'Blocked');
      } catch (err) {
        console.error(err);
        stampOn(button, 'Failed');
      } finally {
        button.disabled = false;
        button.textContent = format;
      }
    });
  }

  /* ---------- Copy, form, nav ---------- */
  for (const btn of $$('[data-copy]')) btn.addEventListener('click', (e) => copy($('#' + btn.dataset.copy).textContent, btn, e));

  $('#join').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#join-email');
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    email.setAttribute('aria-invalid', String(!valid));
    $('#join-error').hidden = valid;
    if (valid) stampOn(e.submitter || email, 'Received'); else email.focus();
  });

  const nav = $('.notes-nav');
  const links = new Map($$('.notes-nav a').map((a) => [a.getAttribute('href').slice(1), a]));
  const noteObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      for (const [id, a] of links) a.setAttribute('aria-current', String(id === en.target.id));
      const a = links.get(en.target.id);
      if (a) nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
    }
  }, { rootMargin: '-35% 0px -60% 0px' });
  for (const id of links.keys()) { const el = document.getElementById(id); if (el) noteObserver.observe(el); }
}
