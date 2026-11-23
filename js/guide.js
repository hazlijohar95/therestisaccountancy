{
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  /* ---------- Host photos fall back to the drawn placeholder ---------- */
  const placeholder = 'assets/hosts/placeholder.svg';
  const useFallback = (img) => { if (!img.src.endsWith(placeholder)) img.src = placeholder; };
  for (const img of $$('img[data-fallback]')) {
    img.addEventListener('error', () => useFallback(img));
    if (img.complete && img.naturalWidth === 0) useFallback(img);
  }

  /* ---------- Tokens: palette, contrast, ladder, facts, spacing ---------- */
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`; };
  const own = (o) => Object.entries(o).filter(([k]) => !k.startsWith('$'));
  const names = { ink: 'Ink', night: 'Night', paper: 'Paper', tape: 'Tape', highlighter: 'Highlighter', redline: 'Redline' };

  fetch('tokens/tokens.json').then((r) => r.json()).then((t) => {
    const palette = own(t.color);
    const hexOf = Object.fromEntries(palette.map(([k, v]) => [k, v.$value]));
    $('#palette').innerHTML = palette.map(([k, v]) => {
      const hex = v.$value;
      const ink = contrast(hex, '#231F20') >= contrast(hex, '#FFFFFF') ? '#231F20' : '#FFFFFF';
      return `<button class="chiprow" type="button" style="background:${hex};color:${ink}" data-hex="${hex}" aria-label="Copy ${names[k] || k}, ${hex}"><span class="nm">${names[k] || k}</span><span class="meta"><span class="hex">${hex}</span><span>RGB ${rgb(hex)}</span><span>${v.$description}</span></span></button>`;
    }).join('');
    for (const b of $$('.chiprow')) b.addEventListener('click', (e) => copy(b.dataset.hex, b, e));

    const resolve = (ref) => (ref.startsWith('#') ? ref : hexOf[ref]);
    const cols = [['club', 0], ['club', 1], ['podcast', 0], ['podcast', 1]];
    let passed = 0;
    let total = 0;
    $('#pairs tbody').innerHTML = t.contract.pairs.map(([fg, bg, min]) => {
      const cells = cols.map(([brand, i]) => {
        const f = resolve(t.theme[brand][fg][i]);
        const b = resolve(t.theme[brand][bg][i]);
        const r = contrast(f, b);
        total += 1;
        if (r >= min) passed += 1;
        return `<td><span class="pair-chip" style="color:${f};background:${b}">Aa</span> <span class="${r >= min ? 'pass' : 'neg'}">${r.toFixed(1)}</span></td>`;
      }).join('');
      return `<tr><td>${fg} on ${bg}</td>${cells}<td>${min}:1</td></tr>`;
    }).join('');

    const facts = { brands: own(t.theme).length, colours: palette.length, faces: own(t.font).length, checks: passed };
    for (const [k, v] of Object.entries(facts)) $(`[data-fact="${k}"]`).textContent = v;
    $('[data-fact="checks"]').nextElementSibling.textContent = `of ${total} contrast checks pass`;

    const sample = { poster: 'Taxes.', title: 'One system, two voices.', head: 'Who signs off the AI audit?', lead: 'Lecturers, graduates and a hiring partner on the gap.', body: 'Body copy sits at 17px with 1.55 leading, under 70 characters a line.', small: 'Captions, hints and table text.', label: 'Labels and meta' };
    const serif = ['poster', 'title', 'head'];
    $('#ladder').innerHTML = own(t.size).map(([k, v]) => `<div class="step"><span class="label"><b>${k}</b><span>${v.$value.replace('clamp', '')}</span></span><div class="${serif.includes(k) ? `display ${k}` : k}" style="font-size:var(--size-${k})">${sample[k]}</div></div>`).join('');

    $('#spaces').innerHTML = own(t.space).map(([k, v]) => `<div><i style="width:${v.$value}"></i><code>space-${k} · ${v.$value}</code></div>`).join('');
  }).catch(() => {
    $('#palette').innerHTML = '<p class="small" style="padding:16px">Serve this folder over http (python3 -m http.server) to load tokens/tokens.json.</p>';
  });

  /* ---------- Logo files, rendered from assets/logos/catalog.json ---------- */
  const layoutName = { lockup: 'lockup', tagline: 'with tagline', wordmark: 'wordmark' };
  const variantName = { color: 'Colour', reversed: 'Reversed', mono: 'Mono' };
  const ground = { color: ['var(--color-paper)', 'var(--color-ink)'], reversed: ['var(--color-night)', 'var(--color-paper)'], mono: ['var(--color-tape)', 'var(--color-ink)'] };
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  fetch('assets/logos/catalog.json').then((r) => r.json()).then((catalog) => {
    $('#logo-files').innerHTML = catalog.map((e, i) => {
      // Mono shows on the brand's own ground: tape for the podcast (to show the knockout), paper for the club.
      const [bg, fg] = e.variant === 'mono' && e.brand === 'club' ? ground.color : ground[e.variant];
      const brandName = e.brand === 'club' ? 'The Rest Is Accountancy' : 'Stick to Accounting';
      const art = e.variant === 'mono'
        ? `<span class="mono-art" style="aspect-ratio:${e.aspect};-webkit-mask-image:url('${e.file}');mask-image:url('${e.file}')" role="img" aria-label="${brandName}, mono"></span>`
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
  const busy = 'repeating-linear-gradient(45deg,#c7b9a3 0 18px,#5d7d8c 18px 36px,#d9c7a0 36px 54px)';
  const grounds = [
    { label: 'Paper', bg: '#FFFFFF', tone: 'light', ok: { club: true, podcast: true }, note: { club: 'Clean paper. The club in ink.', podcast: 'Paper is the logo’s ground. The yellow is for the page around it.' } },
    { label: 'Night', bg: '#000000', tone: 'dark', ok: { club: true, podcast: true }, note: { club: 'The club’s home ground. Reversed wordmark.', podcast: 'Use the reversed file. Its tape is tuned darker.' } },
    { label: 'Tape', bg: '#F7D52A', tone: 'light', ok: { club: false, podcast: false }, note: { club: 'The club never uses yellow.', podcast: 'Tape on tape: the label vanishes. Put the logo on a white or black panel inside the yellow.' } },
    { label: 'Red', bg: '#C8291D', tone: 'dark', ok: { club: false, podcast: false }, note: { club: 'Redline is for corrections only. Never a ground.', podcast: 'Redline is for corrections only. Never a ground.' } },
    { label: 'Photo', bg: busy, tone: 'light', ok: { club: false, podcast: false }, note: { club: 'Busy photos swallow the mark. Use a solid band.', podcast: 'Busy photos swallow the mark. Use a solid band or a torn strip.' } },
  ];
  const gSeg = $('#grounds');
  gSeg.insertAdjacentHTML('beforeend', grounds.map((g, i) => `<button type="button" aria-pressed="${i === 0}">${g.label}</button>`).join(''));
  let groundIndex = 0;
  const drawGround = () => {
    const g = grounds[groundIndex];
    const brand = root.dataset.brand === 'podcast' ? 'podcast' : 'club';
    const fg = g.tone === 'dark' ? '#FFFFFF' : '#231F20';
    const stage = $('#ground-stage');
    stage.style.background = g.bg;
    $('#ground-logo').innerHTML = brand === 'club'
      ? `<span class="logo-tria" style="color:${fg}" role="img" aria-label="The Rest Is Accountancy"></span>`
      : `<img src="assets/logos/sta-lockup-${g.tone === 'dark' ? 'reversed' : 'color'}.svg" alt="Stick to Accounting">`;
    const ok = g.ok[brand];
    const stamp = $('#ground-stamp');
    stamp.textContent = ok ? 'Approved' : 'Rejected';
    stamp.style.color = ok ? fg : '';
    stamp.style.borderColor = ok ? fg : '';
    stamp.style.background = ok ? 'transparent' : '';
    stamp.classList.remove('hit'); void stamp.offsetWidth; stamp.classList.add('hit');
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
  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
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
  const fitTitle = (words, fontFor, maxW, maxH, start, lh) => {
    for (let size = start; size >= 28; size -= 2) {
      cx.font = fontFor(size); cx.letterSpacing = `${-0.035 * size}px`;
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
  let assets = null;
  const assetsReady = Promise.all([
    loadImg('assets/logos/sta-lockup-color.svg'), loadImg('assets/logos/tria-wordmark-mono.svg'), loadImg('assets/devices/scribble-x.svg'),
    document.fonts.load('900 100px Fraunces'), document.fonts.load('380 100px Fraunces'), document.fonts.load('40px "Gochi Hand"'), document.fonts.load('600 40px "Instrument Sans"'),
  ]).then(([sta, tria, x]) => { assets = { sta, tria, x }; });

  const renderCover = () => {
    if (!assets) return;
    const f = formats[mk.format];
    const { W, H, pad } = f;
    canvas.width = W; canvas.height = H;
    $('#mk-size').textContent = `${W} × ${H}`;
    cx.textBaseline = 'alphabetic'; cx.letterSpacing = '0px';
    const words = parseTitle(mk.title || ' ');
    if (mk.brand === 'podcast') {
      cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, W, H);
      cx.fillStyle = cx.createPattern(grainTile, 'repeat'); cx.fillRect(0, 0, W, H);
      const lw = W * f.logo; const lh = lw / 3.4226;
      cx.drawImage(assets.sta, W - pad - lw, H - pad - lh, lw, lh);
      const xs = f.tape * 2.1;
      cx.drawImage(tint(assets.x, xs, xs * 1.2, '#231F20'), W - pad - xs, pad - 10, xs, xs * 1.2);
      let titleTop = pad;
      if (mk.label) {
        cx.font = `${f.tape}px "Gochi Hand"`;
        const tw = cx.measureText(mk.label).width + f.tape * 1.3; const th = f.tape * 1.45;
        cx.save(); cx.translate(pad, pad + 10); cx.rotate(-3 * Math.PI / 180);
        const p = tapePath(tw, th); cx.fillStyle = '#F7D52A'; cx.fill(p);
        const g = cx.createLinearGradient(0, 0, tw, th); g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.06)');
        cx.fillStyle = g; cx.fill(p);
        cx.fillStyle = '#231F20'; cx.fillText(mk.label, f.tape * 0.65, th * 0.72);
        cx.restore();
        titleTop = pad + th + f.tape * 1.1;
      }
      const stacked = mk.format === 'story';
      const noteH = stacked && mk.note ? f.note * 1.6 : 0;
      const titleBottom = H - pad - lh - f.tape - noteH;
      const fit = fitTitle(words, (s) => `900 ${s}px Fraunces`, W - pad * 2, titleBottom - titleTop, f.title, 0.92);
      if (fit) {
        const blockH = fit.lines.length * fit.size * 0.92;
        drawTitle(fit, pad, titleTop + (titleBottom - titleTop - blockH) / 2, 0.92, '#231F20', '#F4DD6C', '#231F20');
      }
      if (mk.note) {
        cx.letterSpacing = '0px'; cx.font = `${f.note}px "Gochi Hand"`; cx.fillStyle = '#231F20';
        if (stacked) cx.fillText(wrapText(mk.note, W - pad * 2, 1)[0] || '', pad, H - pad - lh - f.tape * 0.9);
        else {
          const lines = wrapText(mk.note, W - pad * 2 - lw - 40, 2);
          lines.forEach((t, i) => cx.fillText(t, pad, H - pad - (lines.length - 1 - i) * f.note * 1.15));
        }
      }
    } else {
      cx.fillStyle = '#000000'; cx.fillRect(0, 0, W, H);
      const lw = W * (mk.format === 'thumb' ? 0.34 : 0.44); const lh = lw / 4.2739;
      cx.drawImage(tint(assets.tria, lw, lh, '#FFFFFF'), pad, pad, lw, lh);
      if (mk.label) {
        cx.font = `600 ${Math.round(f.note * 0.8)}px "Instrument Sans"`; cx.fillStyle = '#FFFFFF'; cx.textAlign = 'right';
        cx.fillText(mk.label, W - pad, pad + lh * 0.55); cx.textAlign = 'left';
      }
      const noteH = mk.note ? f.note * 2.2 : 0;
      const titleTop = pad + lh + f.note * 1.5;
      const titleBottom = H - pad - noteH - f.note * 0.8;
      const fit = fitTitle(words, (s) => `380 ${s}px Fraunces`, W - pad * 2, titleBottom - titleTop, f.title * 1.05, 0.98);
      if (fit) {
        const blockH = fit.lines.length * fit.size * 0.98;
        drawTitle(fit, pad, titleBottom - blockH, 0.98, '#FFFFFF', '#FFFFFF', '#000000');
      }
      if (mk.note) {
        cx.letterSpacing = '0px';
        cx.fillStyle = '#FFFFFF'; cx.fillRect(pad, H - pad - noteH, W - pad * 2, 2);
        cx.font = `400 ${Math.round(f.note * 0.85)}px "Instrument Sans"`; cx.fillStyle = '#FFFFFF';
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
