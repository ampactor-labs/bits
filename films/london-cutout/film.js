// A Journey Through London — a ten-second cutout film.
// Everything is generated at load from seeded noise, so every frame is deterministic:
// renderFrame(t) draws the film at time t (seconds) and nothing else holds state.
(() => {
  'use strict';
  const W = 1280, H = 720, FPS = 24, DUR = 10;
  const Q = new URLSearchParams(location.search);
  const RES = +(Q.get('res') || (Math.min(screen.width, 2560) * (devicePixelRatio || 1) >= 1600 ? 1.5 : 1));
  const TAU = Math.PI * 2;
  const INK = '#241c15', PAPER = '#ecdfc0';

  // ---------- numbers ----------
  function rng(s) {
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const eio = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const eout = (t) => 1 - Math.pow(1 - t, 3);
  const ein = (t) => t * t * t;
  const back = (t, c = 2.4) => (t <= 0 ? 0 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2));
  const twos = (t) => Math.floor(t * 12 + 1e-6) / 12; // puppets move on twos
  const wob = (d, f, k) => (d < 0 ? 0 : Math.exp(-d * k) * Math.sin(d * f)); // damped hinge wobble
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  // ---------- paper, grain ----------
  function makePaper() {
    const n = 1024, c = mk(n, n), x = c.getContext('2d');
    const id = x.createImageData(n, n), d = id.data;
    for (let y = 0; y < n; y++)
      for (let X = 0; X < n; X++) {
        const i = (y * n + X) * 4;
        const v = 244 - 16 * vnoise(X / 70, y / 70, 3) - 9 * vnoise(X / 8, y / 8, 5) + (hash2(X, y, 9) - 0.5) * 14;
        d[i] = v + 3; d[i + 1] = v; d[i + 2] = v - 7; d[i + 3] = 255;
      }
    x.putImageData(id, 0, 0);
    const r = rng(11);
    for (let k = 0; k < 900; k++) {
      x.strokeStyle = r() < 0.55 ? 'rgba(90,66,36,.12)' : 'rgba(255,250,236,.3)';
      x.lineWidth = 0.5 + r() * 0.8;
      x.beginPath();
      let px = r() * n, py = r() * n, an = r() * TAU;
      x.moveTo(px, py);
      for (let j = 0; j < 5; j++) { an += (r() - 0.5) * 1.3; px += Math.cos(an) * 5; py += Math.sin(an) * 5; x.lineTo(px, py); }
      x.stroke();
    }
    for (let k = 0; k < 34; k++) {
      const px = r() * n, py = r() * n, rr = 5 + r() * 46;
      const g = x.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, 'rgba(150,96,36,.17)');
      g.addColorStop(0.7, 'rgba(150,96,36,.06)');
      g.addColorStop(1, 'rgba(150,96,36,0)');
      x.fillStyle = g;
      x.fillRect(px - rr, py - rr, 2 * rr, 2 * rr);
    }
    return c;
  }
  let PAPERTEX;

  // ---------- engraving toolkit (all drawn in sprite-content coordinates) ----------
  let RR = rng(1);
  const bb = (f, b) => ((f.b = b), f); // paths carry their bounds so hatching stays local
  const P = {
    ell: (cx, cy, rx, ry, rot = 0) => bb((a) => { a.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot)); a.ellipse(cx, cy, rx, ry, rot, 0, TAU); }, [cx - Math.max(rx, ry), cy - Math.max(rx, ry), cx + Math.max(rx, ry), cy + Math.max(rx, ry)]),
    circ: (cx, cy, r) => P.ell(cx, cy, r, r),
    ring: (cx, cy, R, r) => bb((a) => { a.moveTo(cx + R, cy); a.arc(cx, cy, R, 0, TAU); a.moveTo(cx + r, cy); a.arc(cx, cy, r, 0, TAU, true); }, [cx - R, cy - R, cx + R, cy + R]),
    poly: (p) => {
      const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
      return bb((a) => { a.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) a.lineTo(p[i], p[i + 1]); a.closePath(); }, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    },
    rect: (x, y, w, h) => bb((a) => a.rect(x, y, w, h), [x, y, x + w, y + h]),
    rr: (x, y, w, h, r) => bb((a) => a.roundRect(x, y, w, h, r), [x, y, x + w, y + h]),
    rrCCW: (x, y, w, h, r) => bb((a) => {
      a.moveTo(x + r, y);
      a.arc(x + r, y + r, r, -Math.PI / 2, Math.PI, true);
      a.lineTo(x, y + h - r);
      a.arc(x + r, y + h - r, r, Math.PI, Math.PI / 2, true);
      a.lineTo(x + w - r, y + h);
      a.arc(x + w - r, y + h - r, r, Math.PI / 2, 0, true);
      a.lineTo(x + w, y + r);
      a.arc(x + w - r, y + r, r, 0, -Math.PI / 2, true);
      a.closePath();
    }, [x, y, x + w, y + h]),
    all: (...fs) => bb((a) => fs.forEach((f) => f(a)), fs.every((f) => f.b) ? [Math.min(...fs.map((f) => f.b[0])), Math.min(...fs.map((f) => f.b[1])), Math.max(...fs.map((f) => f.b[2])), Math.max(...fs.map((f) => f.b[3]))] : undefined),
  };
  const boxOf = (p, o) => o.box || (p.b ? [p.b[0] - 12, p.b[1] - 12, p.b[2] + 12, p.b[3] + 12] : undefined);
  function fillP(a, p, col, alpha = 1) {
    a.save(); a.globalAlpha *= alpha; a.fillStyle = col; a.beginPath(); p(a); a.fill(); a.restore();
  }
  function inkP(a, p, lw = 2.2, col = INK) {
    a.save(); a.lineJoin = 'round'; a.lineCap = 'round'; a.strokeStyle = col; a.lineWidth = lw;
    a.beginPath(); p(a); a.stroke();
    a.globalAlpha *= 0.3; a.translate(0.9, 0.7); a.beginPath(); p(a); a.stroke();
    a.restore();
  }
  function lines(a, o = {}) {
    const r = o.r || RR;
    const box = o.box || [-80, -80, a.canvas.width / RES + 80, a.canvas.height / RES + 80];
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, R = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + 10;
    const sp = o.sp || 5, w = o.wob ?? 0.5, step = o.step || 22;
    a.save(); a.translate(cx, cy); a.rotate(o.ang ?? 0.8);
    a.strokeStyle = o.col || INK; a.globalAlpha *= o.alpha ?? 0.7; a.lineWidth = o.lw || 1; a.lineCap = 'round';
    a.beginPath();
    for (let y = -R; y <= R; y += sp) {
      a.moveTo(-R, y);
      for (let x = -R + step; x <= R + step; x += step) a.lineTo(x, y + (r() - 0.5) * w * 2);
    }
    a.stroke(); a.restore();
  }
  function hatchP(a, p, o) { a.save(); a.beginPath(); p(a); a.clip(); lines(a, { ...o, box: boxOf(p, o) }); a.restore(); }
  function shadeP(a, p, dx, dy, o) {
    a.save(); a.beginPath(); p(a); a.clip();
    a.beginPath(); a.rect(-5000, -5000, 10000, 10000); a.translate(dx, dy); p(a); a.translate(-dx, -dy); a.clip('evenodd');
    lines(a, { ...o, box: boxOf(p, o) }); a.restore();
  }
  function tintP(a, p, col, alpha = 0.55, dx = 2.5, dy = -2) {
    a.save(); a.globalAlpha *= alpha; a.fillStyle = col; a.translate(dx, dy); a.beginPath(); p(a); a.fill(); a.restore();
  }
  // one call: base fill, overall hatch, crescent cross-hatched shade, inked outline
  function eng(a, p, o = {}) {
    if (o.fill) fillP(a, p, o.fill, o.fa ?? 1);
    if (o.hatch) hatchP(a, p, { ang: o.ang ?? 0.8, sp: o.hatch, lw: o.hlw ?? 0.8, alpha: o.ha ?? 0.4, wob: o.wob });
    if (o.shade) {
      const [dx, dy] = o.shade, ang = o.ang ?? 0.8, sp = o.ssp ?? 4;
      shadeP(a, p, dx, dy, { ang, sp, lw: o.slw ?? 1, alpha: 0.55 });
      shadeP(a, p, dx * 0.5, dy * 0.5, { ang: ang + 1.2, sp: sp * 0.85, lw: o.slw ?? 1, alpha: 0.6 });
    }
    if (o.ink !== 0) inkP(a, p, o.ink ?? 2.2);
  }
  function strokes(a, pts, lw = 2, col = INK, alpha = 1) {
    a.save(); a.globalAlpha *= alpha; a.strokeStyle = col; a.lineWidth = lw; a.lineCap = 'round'; a.lineJoin = 'round';
    a.beginPath(); a.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) a.lineTo(pts[i], pts[i + 1]); a.stroke(); a.restore();
  }

  // ---------- the scissors: turn artwork into a torn paper cutout ----------
  let SEED = 17;
  function dilate(src, r) {
    const d = mk(src.width, src.height), g = d.getContext('2d', { willReadFrequently: true });
    const n = Math.max(10, Math.ceil(r * 1.6));
    for (const k of [1, 0.55]) for (let i = 0; i < n; i++) { const an = (i / n) * TAU; g.drawImage(src, Math.cos(an) * r * k, Math.sin(an) * r * k); }
    g.drawImage(src, 0, 0);
    return g.getImageData(0, 0, d.width, d.height).data;
  }
  function cut(w, h, draw, o = {}) {
    const T0 = performance.now(); try { return cut0(w, h, draw, o); } finally { if (window.__prof) console.log('cut', w, h, Math.round(performance.now() - T0)); }
  }
  function cut0(w, h, draw, o = {}) {
    const res = o.res || RES;
    const seed = o.seed ?? (SEED += 7919);
    const e = o.edge ?? 5, rg = o.rough ?? 6;
    const pad = Math.ceil(e + rg + 26);
    const cw = Math.ceil((w + 2 * pad) * res), ch = Math.ceil((h + 2 * pad) * res);
    const art = mk(cw, ch), a = art.getContext('2d');
    a.scale(res, res); a.translate(pad, pad);
    RR = rng(seed);
    draw(a, RR);
    let M = art;
    if (!o.noEdge) {
      const d1 = dilate(art, e * res), d2 = dilate(art, (e + rg) * res);
      const m0 = mk(cw, ch), mx = m0.getContext('2d');
      const id = mx.createImageData(cw, ch), od = id.data;
      const f1 = 0.05 / res, f2 = 0.24 / res;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const i = (y * cw + x) * 4;
          let al = d1[i + 3] > 24;
          if (!al && d2[i + 3] > 24) al = vnoise(x * f1, y * f1, seed) * 0.72 + vnoise(x * f2, y * f2, seed + 1) * 0.28 > 0.5;
          if (al) { od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 255; }
        }
      mx.putImageData(id, 0, 0);
      M = mk(cw, ch);
      const g = M.getContext('2d'); g.filter = `blur(${0.45 * res}px)`; g.drawImage(m0, 0, 0);
    }
    const c = mk(cw, ch), x = c.getContext('2d');
    x.drawImage(M, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = o.paper || PAPER; x.fillRect(0, 0, cw, ch);
    x.globalCompositeOperation = 'multiply';
    const pat = x.createPattern(PAPERTEX, 'repeat');
    pat.setTransform(new DOMMatrix().translate(-(seed * 37) % 1024, -(seed * 91) % 1024).scale(res / 1.5));
    x.fillStyle = pat; x.fillRect(0, 0, cw, ch);
    x.drawImage(art, 0, 0);
    if (!o.noEdge) {
      // the torn fibre edge catches a little shadow
      const edge = mk(cw, ch), eg = edge.getContext('2d');
      eg.drawImage(M, 0, 0); eg.globalCompositeOperation = 'source-in'; eg.fillStyle = '#6b5236'; eg.fillRect(0, 0, cw, ch);
      eg.globalCompositeOperation = 'destination-out'; eg.filter = `blur(${1.6 * res}px)`; eg.drawImage(M, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.55; x.drawImage(edge, 0, 0); x.globalAlpha = 1;
    }
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(M, 0, 0);
    let out = c;
    if (o.shadow !== false) {
      out = mk(cw, ch);
      const s = out.getContext('2d');
      const sil = mk(cw, ch), sg = sil.getContext('2d');
      sg.drawImage(M, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#1a120a'; sg.fillRect(0, 0, cw, ch);
      s.filter = `blur(${4 * res}px)`; s.globalAlpha = o.shadowA ?? 0.5;
      s.drawImage(sil, 7 * res, 9 * res);
      s.filter = 'none'; s.globalAlpha = 1; s.drawImage(c, 0, 0);
    }
    return { c: out, w, h, pad, res };
  }
  // an old halftone photograph: soft drawing, then sepia, contrast, grain, screen
  function photo(w, h, draw, o = {}) {
    const res = RES, c = mk(w * res, h * res), x = c.getContext('2d', { willReadFrequently: true });
    x.scale(res, res); draw(x);
    const id = x.getImageData(0, 0, c.width, c.height), d = id.data, tone = o.tone || [1.02, 0.86, 0.66];
    const seed = SEED += 31, con = o.contrast ?? 1.3;
    for (let y = 0; y < c.height; y++)
      for (let X = 0; X < c.width; X++) {
        const i = (y * c.width + X) * 4;
        if (!d[i + 3]) continue;
        let l = (0.3 * d[i] + 0.55 * d[i + 1] + 0.15 * d[i + 2]) / 255;
        l = (l - 0.5) * con + 0.52 + (hash2(X, y, seed) - 0.5) * 0.16;
        l += (Math.sin(X * 1.05) * Math.sin(y * 1.05)) * 0.035; // faint halftone screen
        l = clamp(l);
        const k = o.keep ?? 0; // keep some original colour (hand-tinted photo)
        d[i] = clamp(lerp(l * tone[0], d[i] / 255, k)) * 255;
        d[i + 1] = clamp(lerp(l * tone[1], d[i + 1] / 255, k)) * 255;
        d[i + 2] = clamp(lerp(l * tone[2], d[i + 2] / 255, k)) * 255;
      }
    x.putImageData(id, 0, 0);
    return c;
  }
  function put(ctx, S, x, y, o = {}) {
    const s = o.s ?? 1;
    ctx.save();
    ctx.translate(x, y);
    if (o.r) ctx.rotate(o.r);
    ctx.scale((o.sx ?? 1) * s, (o.sy ?? 1) * s);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    const k = 1 / S.res;
    ctx.drawImage(S.c, -S.pad - (o.ax ?? 0.5) * S.w, -S.pad - (o.ay ?? 0.5) * S.h, S.c.width * k, S.c.height * k);
    ctx.restore();
  }

  // ---------- the cast ----------
  const C = {
    red: '#bf5a40', red2: '#a24533', blue: '#8eaab3', glass: '#b8cdcc', sky: '#a8bdb4', green: '#8ea27a', thames: '#7d998e',
    ochre: '#cfa65c', gold: '#d8b050', brass: '#caa04a', stone: '#d2b98c', brown: '#8d6c49', dark: '#2e2620', pink: '#d99c88',
    white: '#f5eddb', grey: '#a8a49a', violet: '#a59cb0', olive: '#a3a864', slate: '#6f6a70', maroon: '#8b3c2f',
  };
  const A = {};

  function cloud(w, h, seed) {
    return cut(w, h, (a, r) => {
      const cs = [];
      const n = 5 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), rr = (0.25 + 0.2 * Math.sin(t * Math.PI) + r() * 0.08) * h;
        cs.push([lerp(rr, w - rr, t), h - rr - 6 - Math.sin(t * Math.PI) * h * 0.18, rr]);
      }
      cs.push([w / 2, h - h * 0.22, w * 0.42, h * 0.2]);
      const p = (x) => cs.forEach((q) => (q.length === 4 ? P.ell(q[0], q[1], q[2], q[3])(x) : P.circ(q[0], q[1], q[2])(x)));
      inkP(a, p, 5);
      fillP(a, p, C.white);
      shadeP(a, p, 0, -h * 0.16, { ang: 0.15, sp: 3.6, alpha: 0.55 });
      shadeP(a, p, 0, -h * 0.07, { ang: -0.6, sp: 3.4, alpha: 0.5 });
      tintP(a, p, '#c9d3d6', 0.35, 5, 4);
    }, { seed });
  }

  function skylineArt(a, r, w, h, col) {
    const pieces = [];
    const add = (p, o = {}) => pieces.push([p, o]);
    // houses and chimneys
    for (let x = 0; x < w; ) {
      const bw = 50 + r() * 70, bh = 50 + r() * 90;
      add(P.rect(x, h - bh, bw, bh + 2));
      if (r() < 0.7) add(P.rect(x + bw * 0.2 + r() * bw * 0.5, h - bh - 22, 12, 24));
      x += bw * 0.85;
    }
    // Palace of Westminster
    const px0 = 180, px1 = 1000;
    add(P.rect(px0, h - 110, px1 - px0, 112));
    for (let x = px0; x < px1; x += 32) add(P.poly([x, h - 110, x + 6, h - 138, x + 12, h - 110]));
    add(P.rect(170, h - 230, 70, 232));
    for (let i = 0; i < 4; i++) add(P.poly([170 + i * 20, h - 230, 178 + i * 20, h - 262, 186 + i * 20, h - 230]));
    add(P.poly([580, h - 110, 596, h - 210, 612, h - 110]));
    // the Elizabeth Tower, small and far away
    add(P.rect(1000, h - 250, 42, 252));
    add(P.rect(994, h - 290, 54, 44));
    add(P.poly([996, h - 290, 1021, h - 360, 1046, h - 290]));
    add(P.circ(1021, h - 268, 13), { clock: 1 });
    // St Paul's
    add(P.rect(1380, h - 140, 150, 142));
    add(P.rect(1405, h - 200, 100, 62));
    add((x) => { x.moveTo(1405, h - 198); x.ellipse(1455, h - 198, 50, 64, 0, Math.PI, 0); x.closePath(); });
    add(P.rect(1447, h - 290, 16, 30));
    add(P.poly([1450, h - 290, 1455, h - 306, 1460, h - 290]));
    add(P.rect(1360, h - 190, 22, 192)); add(P.rect(1528, h - 190, 22, 192));
    for (const [p, o] of pieces) {
      if (o.clock) { eng(a, p, { fill: '#efe5c8', ink: 1.5 }); continue; }
      eng(a, p, { fill: col, hatch: 3.4, ang: Math.PI / 2, ha: 0.45, shade: [-8, 0], ssp: 3, ink: 1.4 });
    }
    // windows
    a.save(); a.globalAlpha = 0.6;
    for (let x = px0 + 10; x < px1 - 10; x += 16) strokes(a, [x, h - 90, x, h - 60], 3, INK);
    a.restore();
  }

  function waterBand(w, h, base, rowSp = 9) {
    return (a, r) => {
      fillP(a, P.rect(0, 0, w, h), base);
      for (let y = 6; y < h; y += rowSp * (0.7 + (y / h) * 0.8)) {
        const amp = 1.5 + (y / h) * 3, k = 0.04 + r() * 0.02, ph = r() * 10;
        const pts = [];
        for (let x = -10; x <= w + 10; x += 8) pts.push(x, y + Math.sin(x * k + ph) * amp);
        strokes(a, pts, 0.9 + (y / h) * 0.9, INK, 0.55);
      }
      for (let i = 0; i < w / 18; i++) {
        const x = r() * w, y = r() * h;
        strokes(a, [x, y, x + 12 + r() * 20, y - 1], 2, '#f7f1df', 0.8);
      }
    };
  }

  function drawPodBody(a, cx, cy, rx, ry) {
    const egg = P.ell(cx, cy, rx, ry);
    eng(a, egg, { fill: C.glass, shade: [-rx * 0.25, -ry * 0.3], ssp: 3.4, ink: 2.4 });
    // ribs of the capsule frame
    for (let i = -2; i <= 2; i++) {
      const x = cx + (i * rx) / 2.6;
      a.save(); a.beginPath(); egg(a); a.clip();
      strokes(a, [x, cy - ry, x + i * 2, cy + ry], 2.6, '#6c6353', 0.9);
      a.restore();
    }
    strokes(a, [cx - rx, cy + ry * 0.35, cx + rx, cy + ry * 0.35], 3, '#6c6353', 0.9);
    a.save(); a.beginPath(); egg(a); a.clip();
    fillP(a, P.rect(cx - rx, cy + ry * 0.35, rx * 2, ry), '#8e8676', 0.55);
    strokes(a, [cx - rx * 0.6, cy - ry * 0.6, cx - rx * 0.2, cy - ry * 0.75], 3, '#fbf6e8', 0.9);
    a.restore();
  }

  async function buildCast() {
    await Y();
    // ===== sky, sun, clouds, skyline, river =====
    A.sky = cut(1900, 1500, (a, r) => {
      const g = a.createLinearGradient(0, 0, 0, 1500);
      g.addColorStop(0, '#91aaa8'); g.addColorStop(0.42, '#bccbbd'); g.addColorStop(0.6, '#e8d9b4'); g.addColorStop(1, '#e8d6b0');
      a.fillStyle = g; a.fillRect(0, 0, 1900, 1500);
      for (let y = 0; y < 1500; y += 2.6 + (y / 1500) * 10) {
        const pts = []; for (let x = 0; x <= 1900; x += 30) pts.push(x, y + (r() - 0.5) * 1.3);
        strokes(a, pts, 0.8, INK, 0.2 * (1 - y / 1600));
      }
    }, { noEdge: true, shadow: false });

    const sunFace = (alarm) => cut(260, 260, (a, r) => {
      const cx = 130, cy = 130, pts = [];
      for (let i = 0; i < 36; i++) { const an = (i / 36) * TAU, R = i % 2 ? 84 : 126; pts.push(cx + Math.cos(an) * R, cy + Math.sin(an) * R); }
      eng(a, P.poly(pts), { fill: '#e2b24e', hatch: 3.5, ang: 0.3, shade: [-18, -18] });
      const f = P.circ(cx, cy, 82);
      eng(a, f, { fill: '#ecc56a', shade: [-22, -18], ssp: 3.6 });
      tintP(a, P.all(P.circ(88, 150, 16), P.circ(172, 150, 16)), '#d9785a', 0.45, 0, 0);
      if (!alarm) {
        for (const ex of [100, 160]) {
          eng(a, P.ell(ex, 118, 16, 10), { fill: '#fbf6e8', ink: 2 });
          fillP(a, P.circ(ex + 7, 121, 5), INK);
          eng(a, (x) => { x.moveTo(ex - 17, 118); x.ellipse(ex, 118, 17, 11, 0, Math.PI, 0); x.closePath(); }, { fill: '#ddb058', ink: 2 });
          strokes(a, [ex - 18, 98, ex, 92, ex + 18, 100], 3);
        }
        strokes(a, [96, 162, 118, 172, 146, 170, 168, 158, 174, 150], 3.2);
      } else {
        for (const ex of [100, 160]) {
          eng(a, P.circ(ex, 116, 16), { fill: '#fbf6e8', ink: 2 });
          fillP(a, P.circ(ex, 116, 3.5), INK);
          strokes(a, [ex - 16, 88, ex, 80, ex + 16, 88], 3);
        }
        eng(a, P.ell(130, 168, 14, 19), { fill: '#3a211c', ink: 2.2 });
      }
    });
    A.sun = sunFace(false);
    A.sunO = sunFace(true);
    A.cloud1 = cloud(300, 150, 101);
    A.cloud2 = cloud(230, 120, 202);
    A.cloud3 = cloud(360, 160, 303);

    A.skyline = cut(1900, 370, (a, r) => skylineArt(a, r, 1900, 370, C.violet), { edge: 4, rough: 5 });
    A.thames = cut(2000, 260, waterBand(2000, 260, C.thames), { edge: 3, rough: 5, shadow: false });

    A.steamer = cut(130, 80, (a) => {
      eng(a, P.poly([0, 55, 130, 55, 118, 78, 10, 78]), { fill: C.dark, hatch: 3, ink: 2 });
      eng(a, P.rect(20, 38, 90, 18), { fill: C.white, ink: 1.8 });
      for (let x = 28; x < 105; x += 12) fillP(a, P.circ(x, 47, 3), INK);
      eng(a, P.rect(56, 6, 16, 33), { fill: C.red, shade: [-5, 0], ink: 1.8 });
      fillP(a, P.rect(56, 6, 16, 6), INK);
      eng(a, P.circ(90, 58, 18), { fill: C.ochre, ink: 1.8 });
      for (let i = 0; i < 8; i++) strokes(a, [90, 58, 90 + Math.cos(i) * 18, 58 + Math.sin(i) * 18], 1.4);
    }, { edge: 3, rough: 3 });

    await Y();
    // ===== the Eye =====
    A.wheel = cut(1700, 1700, (a) => {
      const c = 850, R = 820;
      for (let i = 0; i < 64; i++) {
        const an = (i / 64) * TAU;
        strokes(a, [c + Math.cos(an) * 60, c + Math.sin(an) * 60, c + Math.cos(an) * (R - 60), c + Math.sin(an) * (R - 60)], 1.6, INK, 0.85);
      }
      eng(a, P.ring(c, c, R - 18, R - 62), { fill: '#e6e0d0', ink: 2.6 });
      const pts = [];
      for (let i = 0; i <= 240; i++) { const an = (i / 240) * TAU, rr = i % 2 ? R - 20 : R - 60; pts.push(c + Math.cos(an) * rr, c + Math.sin(an) * rr); }
      strokes(a, pts, 1.8, INK, 0.9);
      for (let i = 0; i < 32; i++) {
        const an = (i / 32) * TAU + 0.05, px = c + Math.cos(an) * (R - 2), py = c + Math.sin(an) * (R - 2);
        a.save(); a.translate(px, py); a.rotate(an + Math.PI / 2);
        drawPodBody(a, 0, 0, 36, 21);
        a.restore();
      }
      const hub = P.circ(c, c, 76);
      eng(a, hub, { fill: '#a39a8a', shade: [-20, -20], ink: 3 });
      inkP(a, P.circ(c, c, 50), 2.4); inkP(a, P.circ(c, c, 22), 2.4);
      for (let i = 0; i < 12; i++) fillP(a, P.circ(c + Math.cos(i / 1.91) * 63, c + Math.sin(i / 1.91) * 63, 4), INK);
    }, { edge: 3, rough: 3, res: 1.15, shadowA: 0.35 });

    A.legs = cut(760, 960, (a) => {
      const leg = (x0, y0, x1, y1, wd) => {
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = (-dy / L) * wd, ny = (dx / L) * wd;
        const p = P.poly([x0 + nx, y0 + ny, x1 + nx * 1.6, y1 + ny * 1.6, x1 - nx * 1.6, y1 - ny * 1.6, x0 - nx, y0 - ny]);
        eng(a, p, { fill: '#e6e0d0', ink: 2.4 });
        for (let t = 0.04; t < 1; t += 0.035) {
          const px = lerp(x0, x1, t), py = lerp(y0, y1, t), k = 1 + t * 0.6, s = (t * 28.5) % 2 < 1 ? 1 : -1;
          strokes(a, [px + nx * k, py + ny * k, px - nx * k + dx * 0.02 * s, py - ny * k + dy * 0.02 * s], 1.4, INK, 0.8);
        }
      };
      leg(700, 40, 60, 950, 16);
      leg(700, 40, 330, 950, 14);
    }, { edge: 3, rough: 3 });

    await Y();
    // ===== the capsule we ride in =====
    A.podFrame = cut(1440, 880, (a) => {
      const hole = P.rrCCW(150, 130, 1140, 560, 150);
      const frame = P.all(P.rect(0, 0, 1440, 880), hole);
      eng(a, frame, { fill: '#9a907c', hatch: 3.2, ang: 0.3, ha: 0.35, ink: 0 });
      shadeP(a, P.rect(0, 0, 1440, 880), 0, 0, {});
      // bevel
      a.save(); a.beginPath(); frame(a); a.clip();
      inkP(a, P.rr(132, 112, 1176, 596, 166), 10, '#5b5243');
      inkP(a, P.rr(150, 130, 1140, 560, 150), 3.2);
      inkP(a, P.rr(122, 102, 1196, 616, 176), 2);
      a.restore();
      for (let i = 0; i < 44; i++) {
        const t = i / 44, per = 2 * (1140 + 560);
        let d = t * per, x, y;
        if (d < 1196) { x = 122 + d; y = 88; } else if ((d -= 1196) < 616) { x = 1336; y = 102 + d; } else if ((d -= 616) < 1196) { x = 1318 - d; y = 730; } else { d -= 1196; x = 104; y = 718 - d; }
        if (x > 250 && x < 1190 || y > 240 && y < 600) { eng(a, P.circ(x, y, 6), { fill: '#c7bca4', shade: [-2, -2], ink: 1.6 }); }
      }
      // the bench panel below the glass
      eng(a, P.rect(0, 700, 1440, 180), { fill: '#7a6e5c', hatch: 3, ang: 0, ha: 0.4, ink: 2.4 });
    }, { edge: 4, rough: 7, shadowA: 0.55 });
    A.rail = cut(1200, 34, (a) => {
      const p = P.rr(0, 0, 1200, 34, 17);
      eng(a, p, { fill: C.brass, shade: [0, -12], ang: 0.02, ink: 2.2 });
      strokes(a, [20, 9, 1180, 9], 3, '#fff6d6', 0.9);
    }, { edge: 3, rough: 3 });
    const glove = photo(210, 200, (x) => {
      x.fillStyle = '#1d1a18';
      x.beginPath(); x.moveTo(40, 200); x.lineTo(58, 150); x.lineTo(152, 150); x.lineTo(172, 200); x.fill();
      x.fillStyle = '#e8e8e8'; x.fillRect(52, 136, 108, 22);
      const g = x.createRadialGradient(84, 80, 8, 104, 100, 96);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#cfcfcf'); g.addColorStop(1, '#8a8a8a');
      x.fillStyle = g; x.beginPath(); x.ellipse(105, 105, 60, 44, 0, 0, TAU); x.fill();
      for (let i = 0; i < 4; i++) {
        const fx = 58 + i * 26, top = 20 + Math.abs(i - 1.5) * 8;
        const gg = x.createLinearGradient(fx, 0, fx + 25, 0);
        gg.addColorStop(0, '#9a9a9a'); gg.addColorStop(0.45, '#ffffff'); gg.addColorStop(1, '#8a8a8a');
        x.fillStyle = gg; x.beginPath(); x.roundRect(fx, top, 25, 90 - top + 20, 12); x.fill();
      }
      x.save(); x.translate(46, 118); x.rotate(-0.7); x.fillStyle = g; x.beginPath(); x.roundRect(-13, -44, 27, 66, 13); x.fill(); x.restore();
      x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(86 + i * 18, 88); x.lineTo(88 + i * 18, 126); x.stroke(); }
      for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(70 + i * 26, 64 + Math.abs(i - 1.5) * 4, 9, 0.3, 2.8); x.stroke(); }
    });
    A.hand = cut(210, 200, (a) => a.drawImage(glove, 0, 0, 210, 200), { edge: 5, rough: 5 });
    A.bolt = cut(46, 46, (a) => {
      const p = []; for (let i = 0; i < 6; i++) p.push(23 + Math.cos((i * TAU) / 6) * 21, 23 + Math.sin((i * TAU) / 6) * 21);
      eng(a, P.poly(p), { fill: '#9d968a', shade: [-5, -5], ink: 2 });
      eng(a, P.circ(23, 23, 8), { fill: '#5e574c', ink: 1.6 });
    }, { edge: 3, rough: 2 });

    A.splash = cut(1500, 1000, (a, r) => {
      const pts = [0, 1000];
      for (let i = 0; i <= 26; i++) {
        const x = (i / 26) * 1500;
        pts.push(x - 20, 330 + r() * 160, x + 10, 40 + r() * 170 + Math.abs(i - 13) * 12);
      }
      pts.push(1500, 1000);
      const p = P.poly(pts);
      eng(a, p, { fill: '#e7eee6', shade: [0, -60], ang: 0.1, ink: 3 });
      tintP(a, p, '#9fbcb8', 0.35, 8, 6);
      for (let y = 420; y < 1000; y += 22) {
        const q = []; for (let x = 0; x <= 1500; x += 10) q.push(x, y + Math.sin(x * 0.03 + y) * 5);
        a.save(); a.beginPath(); p(a); a.clip(); strokes(a, q, 1.5, INK, 0.45); a.restore();
      }
      for (let i = 0; i < 26; i++) {
        const x = r() * 1500, y = r() * 300, rr = 8 + r() * 22;
        eng(a, P.ell(x, y, rr * 0.8, rr), { fill: '#e7eee6', shade: [-4, -5], ink: 2 });
      }
    }, { edge: 6, rough: 8 });

    await Y();
    // ===== under the Thames =====
    A.under = cut(1560, 960, (a, r) => {
      const g = a.createLinearGradient(0, 0, 0, 960);
      g.addColorStop(0, '#a9c2ab'); g.addColorStop(0.5, '#7f9f86'); g.addColorStop(1, '#4f6b57');
      a.fillStyle = g; a.fillRect(0, 0, 1560, 960);
      for (let y = 4; y < 960; y += 6 + (y / 960) * 3) {
        const pts = [], k = 0.012 + r() * 0.01, ph = r() * 9;
        for (let x = -10; x <= 1570; x += 12) pts.push(x, y + Math.sin(x * k + ph) * 4);
        strokes(a, pts, 0.8 + (y / 960) * 0.9, INK, 0.28 + (y / 960) * 0.35);
      }
      a.save(); a.globalCompositeOperation = 'screen';
      for (let i = 0; i < 6; i++) {
        const x = 150 + i * 260 + r() * 80;
        fillP(a, P.poly([x, -10, x + 90, -10, x + 330, 980, x + 180, 980]), '#fff8e0', 0.14);
      }
      a.restore();
      for (let i = 0; i < 40; i++) {
        const x = r() * 1560, hgt = 90 + r() * 210, pts = [];
        for (let k = 0; k <= 10; k++) pts.push(x + Math.sin(k * 0.8 + i) * 12 * (k / 10), 960 - (k / 10) * hgt);
        strokes(a, pts, 5 + r() * 4, '#3b4f37', 0.85);
      }
    }, { noEdge: true, shadow: false });
    A.bowler = cut(130, 80, (a) => {
      eng(a, P.ell(65, 66, 64, 12), { fill: '#3a332c', ink: 2 });
      eng(a, (x) => { x.moveTo(18, 66); x.ellipse(65, 64, 47, 58, 0, Math.PI, 0); x.closePath(); }, { fill: '#3a332c', shade: [-14, -10], ink: 2.2 });
      fillP(a, P.rect(19, 52, 92, 9), C.maroon);
    });
    A.teacup = cut(100, 70, (a) => {
      eng(a, P.circ(85, 30, 14), { ink: 4 });
      const p = (x) => { x.moveTo(8, 10); x.lineTo(84, 10); x.bezierCurveTo(84, 50, 64, 64, 46, 64); x.bezierCurveTo(28, 64, 8, 50, 8, 10); x.closePath(); };
      eng(a, p, { fill: C.white, shade: [-12, 0], ink: 2.2 });
      for (let i = 0; i < 5; i++) fillP(a, P.circ(22 + i * 12, 30 + (i % 2) * 6, 3.4), '#5770a6', 0.8);
      eng(a, P.ell(46, 10, 38, 6), { fill: '#a7784e', ink: 1.8 });
    });

    await Y();
    // ===== the fish =====
    const fishBody = (x) => {
      x.moveTo(40, 205);
      x.bezierCurveTo(95, 55, 420, 30, 690, 170);
      x.lineTo(700, 200); x.lineTo(700, 255);
      x.bezierCurveTo(470, 420, 150, 410, 40, 250);
      x.closePath();
    };
    A.fishSide = cut(900, 440, (a, r) => {
      const dorsal = P.poly([300, 70, 350, 8, 430, 2, 520, 18, 580, 104]);
      eng(a, dorsal, { fill: C.ochre, ink: 2.2 });
      for (let i = 0; i < 8; i++) strokes(a, [320 + i * 34, 70 + i * 4, 350 + i * 28, 8 + i * 2], 1.6, INK, 0.8);
      eng(a, P.poly([430, 370, 470, 430, 560, 420, 540, 340]), { fill: C.ochre, hatch: 3, ang: 1.2, ink: 2 });
      fillP(a, fishBody, '#b6b477');
      a.save(); a.beginPath(); fishBody(a); a.clip();
      fillP(a, P.ell(360, 380, 360, 120), '#ecdfb5', 0.9);
      for (let y = 60, row = 0; y < 400; y += 22, row++)
        for (let x = 200 + (row % 2) * 13; x < 700; x += 26) {
          a.beginPath(); a.arc(x, y, 14, -Math.PI / 2, Math.PI / 2); a.strokeStyle = INK; a.globalAlpha = 0.55; a.lineWidth = 1.3; a.stroke(); a.globalAlpha = 1;
        }
      for (let i = 0; i < 7; i++) fillP(a, P.ell(260 + i * 60, 120 + Math.sin(i) * 20, 10, 16, 0.3), '#6f6a3a', 0.35);
      a.restore();
      shadeP(a, fishBody, 0, -46, { ang: 0.25, sp: 3.8, alpha: 0.55 });
      shadeP(a, fishBody, 0, -22, { ang: -0.7, sp: 3.4, alpha: 0.55 });
      tintP(a, fishBody, '#9fae5f', 0.3, 3, -3);
      inkP(a, fishBody, 2.8);
      strokes(a, [214, 110, 236, 190, 230, 300], 3.2);
      strokes(a, [238, 124, 256, 200, 250, 290], 1.6, INK, 0.7);
      const pec = P.poly([270, 250, 380, 230, 400, 300, 330, 320]);
      eng(a, pec, { fill: C.ochre, ink: 2 });
      for (let i = 0; i < 5; i++) strokes(a, [272, 252, 385 + i * 4, 236 + i * 16], 1.3, INK, 0.8);
      eng(a, P.circ(150, 150, 34), { fill: '#fbf5e3', ink: 2.6 });
      inkP(a, P.circ(150, 150, 40), 1.4);
      strokes(a, [110, 106, 146, 94, 190, 110], 4.5); // one magnificent eyebrow
      // lips and barbel moustache
      eng(a, P.ell(48, 228, 26, 36), { fill: C.pink, shade: [-6, -8], ink: 2.4 });
      strokes(a, [24, 228, 70, 228], 2.4);
      strokes(a, [60, 212, 40, 190, 10, 184, -2, 196, 6, 208, 18, 204], 3.2);
      strokes(a, [60, 244, 40, 268, 12, 276, 0, 262, 8, 250, 20, 256], 3.2);
    }, { seed: 4242 });
    A.fishTail = cut(230, 280, (a) => {
      const p = (x) => { x.moveTo(0, 110); x.quadraticCurveTo(110, 40, 220, 0); x.quadraticCurveTo(170, 140, 225, 280); x.quadraticCurveTo(110, 240, 0, 170); x.closePath(); };
      eng(a, p, { fill: C.ochre, shade: [-10, -20], ink: 2.4 });
      for (let i = 0; i < 11; i++) strokes(a, [0, 140, 200 - Math.abs(i - 5) * 14, i * 27], 1.3, INK, 0.75);
    });
    const hatArt = (a, w, h) => {
      const crown = P.poly([w * 0.2, h * 0.84, w * 0.16, h * 0.05, w * 0.84, h * 0.05, w * 0.8, h * 0.84]);
      eng(a, crown, { fill: '#2f2a26', shade: [-w * 0.18, 0], ang: 1.5, ssp: 3, ink: 2.2 });
      eng(a, P.ell(w * 0.5, h * 0.05, w * 0.34, h * 0.06), { fill: '#48403a', ink: 1.8 });
      fillP(a, P.rect(w * 0.19, h * 0.62, w * 0.62, h * 0.14), C.maroon);
      eng(a, P.ell(w * 0.5, h * 0.86, w * 0.5, h * 0.09), { fill: '#2f2a26', ink: 2.2 });
      strokes(a, [w * 0.3, h * 0.12, w * 0.3, h * 0.58], 3, '#ffffff', 0.5);
    };
    A.hat = cut(130, 140, (a) => hatArt(a, 130, 140));
    A.monocle = cut(70, 70, (a) => {
      eng(a, P.ring(35, 35, 30, 23), { fill: C.gold, shade: [-4, -4], ink: 1.8 });
      fillP(a, P.circ(35, 35, 23), '#dfeaea', 0.4);
      strokes(a, [22, 22, 30, 16], 3, '#ffffff', 0.9);
    }, { edge: 3, rough: 2 });
    A.lid = cut(80, 44, (a) => {
      const p = (x) => { x.moveTo(0, 4); x.ellipse(40, 4, 40, 38, 0, Math.PI, 0, true); x.closePath(); };
      eng(a, p, { fill: '#b7b378', hatch: 3.2, ang: 0.2, ink: 2.4 });
      for (let i = 0; i < 6; i++) strokes(a, [10 + i * 12, 40, 6 + i * 13, 48], 2);
    }, { edge: 2, rough: 2, shadow: false });

    A.fishFront = cut(1000, 860, (a) => {
      const face = (x) => { x.moveTo(500, 150); x.bezierCurveTo(860, 150, 930, 450, 820, 690); x.bezierCurveTo(740, 850, 260, 850, 180, 690); x.bezierCurveTo(70, 450, 140, 150, 500, 150); x.closePath(); };
      for (const s of [-1, 1]) {
        const fin = P.poly([500 + s * 330, 560, 500 + s * 480, 470, 500 + s * 470, 700, 500 + s * 310, 690]);
        eng(a, fin, { fill: C.ochre, ink: 2.2 });
        for (let i = 0; i < 6; i++) strokes(a, [500 + s * 330, 620, 500 + s * 470, 480 + i * 42], 1.3, INK, 0.7);
      }
      fillP(a, face, '#b6b477');
      a.save(); a.beginPath(); face(a); a.clip();
      fillP(a, P.ell(500, 780, 300, 180), '#ecdfb5', 0.9);
      for (let y = 180, row = 0; y < 840; y += 24, row++)
        for (let x = 150 + (row % 2) * 15; x < 870; x += 30) {
          a.beginPath(); a.arc(x, y, 15, 0, Math.PI); a.strokeStyle = INK; a.globalAlpha = 0.45; a.lineWidth = 1.2; a.stroke(); a.globalAlpha = 1;
        }
      a.restore();
      shadeP(a, face, 0, -60, { ang: 0.1, sp: 3.8, alpha: 0.55 });
      shadeP(a, face, 26, -20, { ang: -0.8, sp: 3.6, alpha: 0.5 });
      tintP(a, face, '#9fae5f', 0.3, 3, -3);
      inkP(a, face, 3);
      for (const [ex, s] of [[190, -1], [810, 1]]) {
        eng(a, P.circ(ex, 330, 92), { fill: '#b6b477', shade: [s * 22, -24], ink: 2.6 });
        eng(a, P.circ(ex, 330, 64), { fill: '#fbf5e3', ink: 2.6 });
        strokes(a, [ex - 70, 250 - s * 8, ex, 226, ex + 70, 250 + s * 8], 6);
      }
      // gill lines like mutton-chop whiskers
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) strokes(a, [500 + s * (230 + i * 18), 470, 500 + s * (250 + i * 18), 600, 500 + s * (230 + i * 16), 700], 2.2, INK, 0.8);
      // the monocle lives on this face, too
      eng(a, P.ring(810, 330, 76, 66), { fill: C.gold, shade: [-8, -8], ink: 2 });
      strokes(a, [870, 380, 900, 480, 880, 560, 910, 640], 1.6);
      a.save(); a.translate(355, -40); hatArt(a, 290, 250); a.restore();
    }, { seed: 777 });
    A.lipTop = cut(700, 170, (a) => {
      const p = (x) => { x.moveTo(110, 150); x.bezierCurveTo(150, 30, 550, 30, 590, 150); x.bezierCurveTo(470, 110, 230, 110, 110, 150); x.closePath(); };
      eng(a, p, { fill: C.pink, shade: [0, -26], ang: 0.1, ink: 2.8 });
      for (let i = 0; i < 7; i++) eng(a, P.rr(240 + i * 32, 120, 26, 34, 5), { fill: '#f6efdc', ink: 1.8 });
      strokes(a, [140, 110, 90, 70, 30, 90, 10, 60, 30, 40], 5);
      strokes(a, [560, 110, 610, 70, 670, 90, 690, 60, 670, 40], 5);
    });
    A.lipBot = cut(520, 160, (a) => {
      const p = (x) => { x.moveTo(20, 10); x.bezierCurveTo(140, 50, 380, 50, 500, 10); x.bezierCurveTo(470, 150, 50, 150, 20, 10); x.closePath(); };
      eng(a, p, { fill: C.pink, shade: [0, 30], ang: 0.1, ink: 2.8 });
    });
    A.throat = cut(640, 520, (a) => {
      eng(a, P.ell(320, 260, 320, 260), { fill: '#4a2420', ink: 3 });
      for (let i = 1; i < 7; i++) inkP(a, P.ell(320, 250 + i * 6, 320 - i * 44, 260 - i * 36), 3, '#160d0b');
      fillP(a, P.ell(320, 280, 80, 70), '#0d0806');
      eng(a, P.ell(320, 60, 22, 40), { fill: '#c77f6c', ink: 2 });
    }, { edge: 2, rough: 2, shadow: false });

    await Y();
    // ===== riverbed cross-section =====
    A.riverbed = cut(1400, 830, (a, r) => {
      a.translate(60, 50);
      fillP(a, P.rect(-60, -50, 1400, 100), '#dcd6bd');
      a.save(); a.translate(-60, 45); waterBand(1400, 415, '#86a597', 11)(a, r); a.restore();
      strokes(a, (() => { const q = []; for (let x = -60; x < 1340; x += 10) q.push(x, 45 + Math.sin(x * 0.05) * 4); return q; })(), 3);
      const mud = P.rect(-60, 455, 1400, 60);
      eng(a, mud, { fill: '#9a7e58', hatch: 3.6, ang: 0.05, ha: 0.5, ink: 2 });
      for (let i = 0; i < 70; i++) eng(a, P.ell(r() * 1340 - 60, 462 + r() * 46, 4 + r() * 7, 3 + r() * 4), { fill: '#c9b48c', ink: 1.2 });
      const soil = (y0, y1, col, ang) => eng(a, P.rect(-60, y0, 1400, y1 - y0), { fill: col, hatch: 3.2, ang, ha: 0.5, ink: 1.6 });
      soil(505, 545, '#8b6e4d', 0.4); soil(700, 790, '#7c5f40', -0.3);
      // an ammonite in the strata
      a.save(); a.translate(1150, 745); const sp = []; for (let k = 0; k < 80; k++) { const an = k * 0.3, rr = 2 + k * 0.28; sp.push(Math.cos(an) * rr, Math.sin(an) * rr); } strokes(a, sp, 2); a.restore();
      // the tunnel
      const tun = P.rect(-60, 545, 1400, 155);
      eng(a, tun, { fill: '#4b4036', hatch: 3.4, ang: 0.02, ha: 0.55, ink: 2.4 });
      for (let y = 548; y < 700; y += 16) for (let x = -60 + ((y / 16) % 2) * 20; x < 1340; x += 40) inkP(a, P.rect(x, y, 40, 16), 0.9, '#1c1611');
      fillP(a, P.rect(-60, 682, 1400, 18), '#2a231d');
      strokes(a, [-60, 680, 1340, 680], 4, '#c9c1b0'); strokes(a, [-60, 688, 1340, 688], 2, INK);
      for (let x = -40; x < 1340; x += 30) fillP(a, P.rect(x, 684, 14, 10), '#6b5236');
      // roundel on the tunnel wall
      eng(a, P.ring(300, 610, 40, 26), { fill: C.red, ink: 2 });
      eng(a, P.rect(248, 601, 104, 18), { fill: '#2f4f86', ink: 2 });
      eng(a, P.rect(620, 575, 60, 80), { fill: '#e8dcc0', ink: 2 });
      // the shaft from riverbed to tunnel roof
      eng(a, P.rect(852, 455, 76, 92), { fill: '#241c16', ink: 2.4 });
      for (let y = 460; y < 545; y += 14) { inkP(a, P.rect(842, y, 10, 14), 1); inkP(a, P.rect(928, y, 10, 14), 1); }
      // riverbed junk
      eng(a, P.poly([1180, 440, 1210, 380, 1222, 382, 1200, 440]), { fill: '#6d7b5c', ink: 2 });
      a.save(); a.translate(110, 452); a.rotate(-0.4);
      eng(a, (x) => { x.moveTo(-30, 0); x.lineTo(30, 0); }, { ink: 5 });
      eng(a, (x) => { x.moveTo(0, 0); x.lineTo(0, -70); }, { ink: 5 });
      eng(a, (x) => { x.arc(0, -10, 28, 0.2, Math.PI - 0.2); }, { ink: 5 });
      eng(a, P.ring(0, -78, 10, 5), { fill: '#6f6a60', ink: 2 });
      a.restore();
    }, { noEdge: true, shadow: false });

    A.diver = cut(110, 200, (a) => {
      eng(a, P.rr(20, 70, 70, 110, 20), { fill: '#a8a192', shade: [-12, -8], ink: 2.2 });
      eng(a, P.rect(24, 170, 28, 30), { fill: '#3c3530', ink: 2 }); eng(a, P.rect(58, 170, 28, 30), { fill: '#3c3530', ink: 2 });
      eng(a, P.rr(4, 80, 20, 70, 9), { fill: '#a8a192', ink: 2 });
      eng(a, P.rr(86, 80, 20, 70, 9), { fill: '#a8a192', ink: 2 });
      eng(a, P.circ(55, 50, 42), { fill: C.brass, shade: [-12, -12], ink: 2.4 });
      eng(a, P.circ(58, 52, 20), { fill: '#d7e2dc', ink: 2.2 });
      fillP(a, P.circ(58, 52, 6), INK, 0.8);
      for (let i = 0; i < 6; i++) fillP(a, P.circ(55 + Math.cos(i) * 34, 50 + Math.sin(i) * 34, 3), INK);
    });

    A.puff = cut(200, 140, (a) => {
      const p = P.all(P.circ(60, 80, 42), P.circ(110, 60, 50), P.circ(150, 90, 38), P.circ(95, 100, 40));
      inkP(a, p, 5); fillP(a, p, '#efe9da');
      shadeP(a, p, -10, -14, { ang: 0.4, sp: 3.6, alpha: 0.5 });
    });

    await Y();
    // ===== capsule → carriage =====
    A.pod = cut(220, 130, (a) => drawPodBody(a, 110, 65, 108, 62));
    A.podL = cut(110, 130, (a) => { a.save(); a.beginPath(); a.rect(0, -10, 110, 150); a.clip(); drawPodBody(a, 110, 65, 108, 62); a.restore(); strokes(a, [110, 3, 110, 127], 3); });
    A.podR = cut(110, 130, (a) => { a.save(); a.beginPath(); a.rect(0, -10, 110, 150); a.clip(); drawPodBody(a, 0, 65, 108, 62); a.restore(); strokes(a, [0, 3, 0, 127], 3); });
    A.carMid = cut(520, 120, (a) => {
      const body = P.rect(0, 4, 520, 116);
      eng(a, body, { fill: C.red, shade: [0, -26], ang: 0.05, ink: 2.6 });
      fillP(a, P.rect(0, 4, 520, 16), '#6b6258');
      for (let i = 0; i < 5; i++) {
        const x = 26 + i * 100;
        eng(a, P.rr(x, 32, 62, 44, 8), { fill: '#e9ddb4', shade: [-8, -6], ink: 2.2 });
        strokes(a, [x + 31, 32, x + 31, 76], 2);
      }
      eng(a, P.ring(260, 96, 14, 9), { fill: '#e8dcc0', ink: 1.6 });
      fillP(a, P.rect(240, 93, 40, 6), '#2f4f86');
      strokes(a, [0, 86, 520, 86], 1.6, INK, 0.8);
    });
    A.bogie = cut(140, 56, (a) => {
      eng(a, P.rect(10, 0, 120, 22), { fill: '#443c35', hatch: 3, ink: 2 });
      for (const x of [34, 106]) { eng(a, P.circ(x, 30, 24), { fill: '#6f675d', shade: [-6, -6], ink: 2.2 }); inkP(a, P.circ(x, 30, 8), 2); for (let i = 0; i < 6; i++) strokes(a, [x, 30, x + Math.cos(i) * 22, 30 + Math.sin(i) * 22], 1.4); }
    });
    A.tunnelSide = cut(1400, 840, (a, r) => {
      a.translate(60, 60);
      fillP(a, P.rect(-60, -60, 1400, 840), '#6b4a36');
      for (let y = -60; y < 780; y += 24) for (let x = -60 + ((y / 24) % 2) * 30; x < 1340; x += 60) {
        const b = P.rect(x + 1, y + 1, 58, 22);
        fillP(a, b, r() < 0.5 ? '#855b41' : '#77503a');
        hatchP(a, b, { ang: 0.4 + r() * 0.3, sp: 3.6, alpha: 0.35, box: [x, y, x + 60, y + 24] });
        inkP(a, b, 1.2, '#20150e');
      }
      // arched ceiling shadow and the hole we fall through
      a.save(); a.globalCompositeOperation = 'multiply';
      const g = a.createLinearGradient(0, -60, 0, 300); g.addColorStop(0, 'rgba(20,12,8,.8)'); g.addColorStop(1, 'rgba(20,12,8,0)');
      a.fillStyle = g; a.fillRect(-60, -60, 1400, 360);
      const g2 = a.createLinearGradient(0, 560, 0, 780); g2.addColorStop(0, 'rgba(20,12,8,0)'); g2.addColorStop(1, 'rgba(20,12,8,.7)');
      a.fillStyle = g2; a.fillRect(-60, 560, 1400, 220);
      a.restore();
      eng(a, P.ell(640, -10, 120, 60), { fill: '#120d09', ink: 3 });
      // roundel (no words: the shape says it) and a portrait of our distinguished fish
      eng(a, P.ring(280, 300, 92, 60), { fill: C.red, shade: [-14, -14], ink: 2.6 });
      eng(a, P.rect(160, 280, 240, 42), { fill: '#335693', shade: [0, -10], ink: 2.6 });
      eng(a, P.rect(900, 170, 240, 300), { fill: '#e9dcbc', ink: 3 });
      eng(a, P.rect(914, 184, 212, 272), { fill: '#d6c7a0', ink: 1.6 });
      a.save(); a.translate(1020, 330); a.rotate(-0.2); a.scale(0.24, 0.24);
      a.drawImage(A.fishSide.c, -450 - A.fishSide.pad, -220 - A.fishSide.pad, A.fishSide.c.width / A.fishSide.res, A.fishSide.c.height / A.fishSide.res);
      a.drawImage(A.hat.c, -250 - A.hat.pad, -180 - A.hat.pad, A.hat.c.width / A.hat.res * 1.2, A.hat.c.height / A.hat.res * 1.2);
      a.restore();
      // cables and lamps
      for (const y of [120, 138, 152]) strokes(a, [-60, y, 1340, y + 8], 3, '#1d1510', 0.9);
      for (const x of [110, 560, 1240]) { eng(a, P.circ(x, 90, 20), { fill: '#f3dd95', ink: 2 }); }
      // platform and rails
      eng(a, P.rect(-60, 612, 1400, 170), { fill: '#3b3029', hatch: 3.6, ang: 0.05, ha: 0.6, ink: 2.4 });
      for (let x = -40; x < 1340; x += 44) fillP(a, P.rect(x, 622, 26, 14), '#6f5438');
      strokes(a, [-60, 616, 1340, 616], 6, '#d3cbb8'); strokes(a, [-60, 622, 1340, 622], 2, INK);
    }, { noEdge: true, shadow: false });
    A.lamp = cut(160, 160, (a) => {
      const g = a.createRadialGradient(80, 80, 4, 80, 80, 80); g.addColorStop(0, 'rgba(255,238,170,1)'); g.addColorStop(1, 'rgba(255,238,170,0)');
      a.fillStyle = g; a.fillRect(0, 0, 160, 160);
    }, { noEdge: true, shadow: false });

    await Y();
    // ===== tunnel and trumpet rings =====
    A.ringBrick = cut(900, 900, (a, r) => {
      const p = P.ring(450, 450, 450, 372);
      fillP(a, p, '#7b5238');
      a.save(); a.beginPath(); p(a); a.clip();
      for (let k = 0; k < 4; k++) {
        const r0 = 372 + k * 19.5, n = 44 + k * 3;
        for (let i = 0; i < n; i++) {
          const a0 = ((i + (k % 2) * 0.5) / n) * TAU, a1 = a0 + TAU / n;
          const q = (x) => { x.moveTo(450 + Math.cos(a0) * r0, 450 + Math.sin(a0) * r0); x.arc(450, 450, r0 + 19.5, a0, a1); x.arc(450, 450, r0, a1, a0, true); x.closePath(); };
          fillP(a, q, r() < 0.5 ? '#8c5e41' : '#6f4a33');
          inkP(a, q, 1.2, '#1c120b');
        }
      }
      shadeP(a, p, 0, -30, { ang: 0.2, sp: 3.2, alpha: 0.6 });
      a.restore();
      inkP(a, P.circ(450, 450, 372), 3); inkP(a, P.circ(450, 450, 449), 2);
      eng(a, P.circ(450, 40, 16), { fill: '#f1d68a', ink: 2 });
    }, { edge: 2, rough: 3, shadow: false });
    A.ringBrass = cut(900, 900, (a) => {
      const p = P.ring(450, 450, 450, 396);
      fillP(a, p, '#c69a3e');
      a.save(); a.beginPath(); p(a); a.clip();
      lines(a, { ang: 0.3, sp: 4, alpha: 0.35 });
      shadeP(a, p, 0, -40, { ang: 1.4, sp: 3.2, alpha: 0.6 });
      a.globalCompositeOperation = 'screen';
      fillP(a, P.ell(300, 120, 180, 40, -0.5), '#fff2c0', 0.8);
      a.restore();
      inkP(a, P.circ(450, 450, 396), 3); inkP(a, P.circ(450, 450, 449), 2);
    }, { edge: 2, rough: 2, shadow: false });
    A.valve = cut(220, 700, (a) => {
      eng(a, P.rr(40, 40, 140, 660, 18), { fill: C.brass, shade: [-40, 0], ang: 1.5, ink: 2.6 });
      eng(a, P.ell(110, 40, 100, 34), { fill: '#f0e6cf', shade: [0, -10], ink: 2.6 });
      for (let y = 140; y < 700; y += 90) strokes(a, [40, y, 180, y], 3);
    });
    A.carRear = cut(300, 240, (a) => {
      eng(a, P.rr(0, 30, 300, 190, 40), { fill: C.red, shade: [-36, -20], ang: 0.1, ink: 2.6 });
      eng(a, P.ell(150, 36, 120, 48), { fill: C.glass, shade: [-20, -10], ink: 2.4 });
      eng(a, P.rr(90, 70, 120, 70, 12), { fill: '#e9ddb4', ink: 2.2 });
      for (const x of [40, 260]) eng(a, P.circ(x, 170, 18), { fill: '#e9543e', ink: 2.2 });
      eng(a, P.rect(20, 212, 260, 20), { fill: '#3b3029', ink: 2 });
      eng(a, P.ring(150, 176, 20, 12), { fill: '#e8dcc0', ink: 1.6 });
    });

    await Y();
    // ===== Westminster =====
    A.tower = cut(260, 960, (a) => {
      const stone = { fill: C.stone, hatch: 3.6, ang: Math.PI / 2, ha: 0.35, shade: [-12, 0], ssp: 3.2 };
      eng(a, P.rect(56, 470, 148, 490), stone);
      for (let y = 500; y < 960; y += 70) for (const x of [70, 108, 146]) eng(a, P.rr(x, y, 26, 50, 12), { fill: '#8d7b5b', ink: 1.6 });
      eng(a, P.rect(38, 280, 184, 196), stone);
      eng(a, P.rect(48, 290, 164, 176), { fill: '#d8b456', hatch: 3, ang: 0.8, ha: 0.4, ink: 2 });
      eng(a, P.circ(130, 378, 72), { fill: '#f3ebd6', ink: 2.8 });
      inkP(a, P.circ(130, 378, 62), 1.4);
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; strokes(a, [130 + Math.cos(an) * 52, 378 + Math.sin(an) * 52, 130 + Math.cos(an) * 62, 378 + Math.sin(an) * 62], 3); }
      strokes(a, [130, 378, 130, 330], 4); strokes(a, [130, 378, 160, 392], 5);
      eng(a, P.rect(56, 200, 148, 84), stone);
      for (const x of [70, 108, 146]) eng(a, P.rr(x, 214, 28, 60, 13), { fill: '#3b3530', ink: 1.6 });
      eng(a, P.poly([44, 204, 80, 140, 180, 140, 216, 204]), { fill: C.slate, hatch: 3, ang: 1.2, ha: 0.5, shade: [-10, 0], ink: 2.2 });
      eng(a, P.rect(100, 100, 60, 42), { fill: '#d8b456', ink: 2 });
      eng(a, P.poly([104, 102, 130, 0, 156, 102]), { fill: C.slate, shade: [-8, 0], ang: 1.4, ink: 2.2 });
      for (const x of [44, 216]) eng(a, P.poly([x - 8, 204, x, 150, x + 8, 204]), { fill: '#d8b456', ink: 1.6 });
    });
    A.clockPop = cut(150, 150, (a) => {
      eng(a, P.circ(75, 75, 72), { fill: '#f3ebd6', ink: 2.8 });
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; strokes(a, [75 + Math.cos(an) * 52, 75 + Math.sin(an) * 52, 75 + Math.cos(an) * 62, 75 + Math.sin(an) * 62], 3); }
      strokes(a, [75, 75, 75, 27], 4); strokes(a, [75, 75, 105, 89], 5);
    }, { edge: 2, rough: 2 });
    A.pavement = cut(1500, 110, (a) => {
      eng(a, P.rect(0, 0, 1500, 110), { fill: '#b8ab92', hatch: 3.6, ang: 0.02, ha: 0.5, ink: 2.2 });
      for (let x = 0; x < 1500; x += 90) strokes(a, [x, 0, x - 30, 110], 1.6);
    }, { edge: 3, rough: 5 });

    // the guardsman: a photograph's face under an engraved bearskin
    const facePh = photo(170, 210, (x) => {
      const g = x.createRadialGradient(70, 80, 10, 85, 105, 110);
      g.addColorStop(0, '#f2d2bb'); g.addColorStop(0.7, '#c99a80'); g.addColorStop(1, '#8a6250');
      x.fillStyle = g; x.beginPath(); x.ellipse(85, 108, 72, 96, 0, 0, TAU); x.fill();
      x.fillStyle = '#fff'; for (const ex of [55, 115]) { x.beginPath(); x.ellipse(ex, 88, 17, 13, 0, 0, TAU); x.fill(); }
      x.strokeStyle = '#2a1d16'; x.lineWidth = 3; for (const ex of [55, 115]) { x.beginPath(); x.ellipse(ex, 88, 17, 13, 0, 0, TAU); x.stroke(); }
      x.lineWidth = 5; x.beginPath(); x.moveTo(34, 64); x.lineTo(74, 60); x.moveTo(96, 60); x.lineTo(136, 64); x.stroke();
      const ng = x.createLinearGradient(75, 0, 100, 0); ng.addColorStop(0, '#b27f66'); ng.addColorStop(1, '#f0cdb3');
      x.fillStyle = ng; x.beginPath(); x.moveTo(84, 90); x.lineTo(72, 140); x.lineTo(98, 140); x.fill();
      x.fillStyle = '#3a2a20';
      x.beginPath(); x.moveTo(85, 145); x.bezierCurveTo(60, 138, 30, 150, 12, 132); x.bezierCurveTo(20, 162, 60, 162, 85, 156); x.bezierCurveTo(110, 162, 150, 162, 158, 132); x.bezierCurveTo(140, 150, 110, 138, 85, 145); x.fill();
      x.fillStyle = '#7a3b30'; x.beginPath(); x.ellipse(85, 170, 13, 9, 0, 0, TAU); x.fill();
      x.strokeStyle = '#2a1d16'; x.lineWidth = 3; x.beginPath(); x.moveTo(20, 150); x.quadraticCurveTo(85, 230, 150, 150); x.stroke();
    }, { keep: 0.25 });
    A.face = cut(170, 210, (a) => a.drawImage(facePh, 0, 0, 170, 210), { edge: 5, rough: 5 });
    const cheekPh = photo(90, 90, (x) => {
      const g = x.createRadialGradient(36, 34, 4, 45, 45, 45); g.addColorStop(0, '#f6dcc6'); g.addColorStop(0.6, '#d9a489'); g.addColorStop(1, '#9d6c58');
      x.fillStyle = g; x.beginPath(); x.arc(45, 45, 44, 0, TAU); x.fill();
    }, { keep: 0.35 });
    A.cheek = cut(90, 90, (a) => a.drawImage(cheekPh, 0, 0, 90, 90), { edge: 3, rough: 3 });
    A.bearskin = cut(280, 330, (a, r) => {
      const p = (x) => { x.moveTo(20, 330); x.bezierCurveTo(-10, 140, 40, 0, 140, 0); x.bezierCurveTo(240, 0, 290, 140, 260, 330); x.closePath(); };
      eng(a, p, { fill: '#221d1a', ink: 2 });
      a.save(); a.beginPath(); p(a); a.clip();
      for (let i = 0; i < 900; i++) {
        const x = r() * 280, y = r() * 330, an = -Math.PI / 2 + (r() - 0.5) * 1.2, L = 8 + r() * 14;
        strokes(a, [x, y, x + Math.cos(an) * L, y + Math.sin(an) * L], 1.2, r() < 0.5 ? '#6b625a' : '#0f0c0a', 0.8);
      }
      a.restore();
      for (let i = 0; i < 160; i++) {
        const t = r(), x = lerp(20, 260, t), y = 330 - Math.sin(t * Math.PI) * 320 - 4, an = Math.atan2(y - 200, x - 140) + (r() - 0.5);
        strokes(a, [x, y, x + Math.cos(an) * 12, y + Math.sin(an) * 12], 1.6, '#1b1714');
      }
    }, { edge: 5, rough: 8 });
    A.guardBody = cut(420, 620, (a) => {
      // trousers
      eng(a, P.poly([110, 380, 310, 380, 300, 620, 220, 620, 210, 440, 200, 620, 120, 620]), { fill: '#2a2a33', hatch: 3.4, ang: 1.4, ha: 0.5, ink: 2.4 });
      strokes(a, [124, 400, 128, 620], 5, C.red2); strokes(a, [296, 400, 292, 620], 5, C.red2);
      // tunic
      const tunic = P.poly([80, 40, 340, 40, 330, 400, 90, 400]);
      eng(a, tunic, { fill: C.red, shade: [-40, -10], ssp: 3.4, ink: 2.6 });
      eng(a, P.rect(88, 290, 244, 36), { fill: C.white, shade: [0, -8], ink: 2.2 });
      eng(a, P.rr(190, 292, 40, 32, 5), { fill: C.gold, ink: 2 });
      for (let y = 70; y < 400; y += 44) if (y < 280 || y > 330) eng(a, P.circ(210, y, 8), { fill: C.gold, ink: 1.6 });
      eng(a, P.rect(150, 18, 120, 36), { fill: '#28305a', ink: 2.2 });
      strokes(a, [150, 26, 270, 26], 3, C.gold);
      for (const x of [60, 300]) eng(a, P.rr(x, 30, 60, 26, 10), { fill: C.gold, hatch: 3, ang: 1.5, ink: 2 });
      // arms reaching up to the trumpet
      for (const [x0, x1, y1] of [[90, 205, 18], [330, 330, -20]]) {
        const arm = P.poly([x0 - 30, 60, x0 + 20, 50, x1 + 22, y1 + 10, x1 - 18, y1 + 30]);
        eng(a, arm, { fill: C.red2, shade: [-10, -10], ink: 2.4 });
        eng(a, P.circ(x1, y1 + 10, 22), { fill: '#f1ece0', shade: [-6, -6], ink: 2 });
      }
    });
    A.trumpet = cut(480, 170, (a) => {
      const tube = (x) => { x.moveTo(0, 74); x.lineTo(380, 70); x.bezierCurveTo(420, 66, 450, 20, 478, 4); x.lineTo(478, 166); x.bezierCurveTo(450, 150, 420, 104, 380, 100); x.lineTo(0, 92); x.closePath(); };
      eng(a, P.rr(120, 96, 240, 50, 25), { fill: C.brass, ink: 2.2 });
      eng(a, tube, { fill: C.brass, shade: [0, -12], ang: 0.1, ink: 2.4 });
      for (const x of [190, 225, 260]) { eng(a, P.rect(x, 30, 22, 90), { fill: '#d8b456', shade: [-6, 0], ink: 2 }); eng(a, P.ell(x + 11, 30, 16, 7), { fill: '#f1ece0', ink: 1.8 }); }
      eng(a, P.ell(476, 85, 12, 82), { fill: '#3a2c14', ink: 2.4 });
      strokes(a, [20, 78, 370, 75], 3, '#fff6d6', 0.8);
    });
    A.blast = cut(340, 340, (a, r) => {
      const pts = []; for (let i = 0; i < 26; i++) { const an = (i / 26) * TAU, R = i % 2 ? 90 + r() * 30 : 160 + r() * 10; pts.push(170 + Math.cos(an) * R, 170 + Math.sin(an) * R); }
      eng(a, P.poly(pts), { fill: '#f3e3a6', hatch: 3.2, ang: 0.5, ha: 0.3, ink: 3 });
      tintP(a, P.poly(pts), '#e08a4a', 0.35, 6, 4);
    });
    A.note = cut(60, 90, (a) => {
      eng(a, P.ell(18, 72, 16, 12, -0.4), { fill: INK, ink: 1.5 });
      strokes(a, [32, 70, 32, 6, 56, 22, 52, 40], 4);
    }, { edge: 3, rough: 2 });

    await Y();
    // ===== the clock at close quarters =====
    A.clockBg = cut(1500, 900, (a, r) => {
      a.translate(110, 90);
      eng(a, P.rect(-110, -90, 1500, 900), { fill: C.stone, hatch: 3.6, ang: Math.PI / 2, ha: 0.35, ink: 0 });
      for (let y = -90; y < 810; y += 60) strokes(a, [-110, y, 1390, y], 1.6, INK, 0.6);
      const sq = P.rect(330, 50, 620, 640);
      eng(a, sq, { fill: '#d8b456', hatch: 3.2, ang: 0.8, ha: 0.45, ink: 3 });
      for (const [cx, cy] of [[370, 90], [910, 90], [370, 650], [910, 650]]) {
        for (let k = 0; k < 3; k++) inkP(a, P.circ(cx, cy, 16 + k * 10), 2);
        eng(a, P.poly([cx - 8, cy, cx, cy - 8, cx + 8, cy, cx, cy + 8]), { fill: C.maroon, ink: 1.5 });
      }
      for (const x of [140, 1140]) {
        const lancet = (q) => { q.moveTo(x - 70, 760); q.lineTo(x - 70, 150); q.quadraticCurveTo(x - 70, 20, x, -30); q.quadraticCurveTo(x + 70, 20, x + 70, 150); q.lineTo(x + 70, 760); q.closePath(); };
        eng(a, lancet, { fill: '#8d7b5b', shade: [-20, 0], ang: 1.5, ink: 3 });
        for (const dx of [-35, 0, 35]) strokes(a, [x + dx, 120, x + dx, 760], 3);
      }
      eng(a, P.rect(-110, 710, 1500, 100), { fill: '#b89c6c', hatch: 3, ang: 0.05, ha: 0.5, ink: 2.4 });
    }, { noEdge: true, shadow: false });
    A.clockFace = cut(560, 560, (a) => {
      const c = 280;
      eng(a, P.circ(c, c, 278), { fill: '#d8b456', shade: [-30, -30], ink: 3 });
      eng(a, P.circ(c, c, 246), { fill: '#f4eedb', ink: 2.6 });
      a.save(); a.beginPath(); P.ring(c, c, 175, 70)(a); a.clip();
      for (let i = 0; i < 60; i++) { const an = (i / 60) * TAU; strokes(a, [c + Math.cos(an) * 70, c + Math.sin(an) * 70, c + Math.cos(an) * 175, c + Math.sin(an) * 175], 1.2, INK, 0.7); }
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; inkP(a, P.circ(c + Math.cos(an) * 124, c + Math.sin(an) * 124, 30), 1.8); }
      a.restore();
      inkP(a, P.circ(c, c, 175), 2.2); inkP(a, P.circ(c, c, 70), 2.2);
      for (let i = 0; i < 60; i++) { const an = (i / 60) * TAU, L = i % 5 ? 8 : 16; strokes(a, [c + Math.cos(an) * 238, c + Math.sin(an) * 238, c + Math.cos(an) * (238 - L), c + Math.sin(an) * (238 - L)], i % 5 ? 1.6 : 3.2); }
      const num = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      a.fillStyle = INK; a.textAlign = 'center'; a.textBaseline = 'middle'; a.font = '600 34px "Times New Roman", Georgia, serif';
      for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; a.save(); a.translate(c + Math.sin(an) * 202, c - Math.cos(an) * 202); a.rotate(an); a.fillText(num[i], 0, 0); a.restore(); }
      shadeP(a, P.circ(c, c, 246), -18, -18, { ang: 0.8, sp: 3.6, alpha: 0.35 });
    }, { edge: 4, rough: 4 });
    A.handMin = cut(40, 250, (a) => {
      eng(a, P.poly([20, 0, 34, 40, 24, 50, 24, 240, 16, 240, 16, 50, 6, 40]), { fill: '#2b2622', ink: 1.8 });
      inkP(a, P.circ(20, 120, 10), 2);
    }, { edge: 2, rough: 2 });
    A.handHour = cut(56, 180, (a) => {
      eng(a, P.poly([28, 0, 50, 36, 32, 48, 32, 170, 24, 170, 24, 48, 6, 36]), { fill: '#2b2622', ink: 1.8 });
      inkP(a, P.circ(28, 32, 10), 2);
    }, { edge: 2, rough: 2 });
    A.cavity = cut(500, 500, (a) => {
      eng(a, P.circ(250, 250, 248), { fill: '#3e2a1c', ink: 3 });
      a.save(); a.beginPath(); P.circ(250, 250, 248)(a); a.clip();
      for (let x = 0; x < 500; x += 38) strokes(a, [x, 0, x, 500], 2.4, '#1d130c');
      const gear = (cx, cy, R, n) => {
        const pts = []; for (let i = 0; i < n * 2; i++) { const an = (i / (n * 2)) * TAU, rr = i % 2 ? R : R * 0.84; pts.push(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); }
        eng(a, P.poly(pts), { fill: '#a3823e', shade: [-8, -8], ink: 2 });
        inkP(a, P.circ(cx, cy, R * 0.3), 2);
      };
      gear(110, 130, 70, 14); gear(390, 170, 56, 11); gear(380, 380, 80, 16); gear(120, 390, 50, 10);
      a.globalCompositeOperation = 'multiply';
      const g = a.createRadialGradient(250, 250, 40, 250, 250, 250); g.addColorStop(0, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(0,0,0,.75)');
      a.fillStyle = g; a.fillRect(0, 0, 500, 500);
      a.restore();
    }, { edge: 2, rough: 2, shadow: false });
    A.doorEdge = cut(40, 560, (a) => eng(a, P.rr(0, 0, 40, 560, 20), { fill: '#a3823e', hatch: 3, ang: 1.5, ink: 2.4 }), { edge: 2, rough: 2 });

    // the pigeon: photograph body, engraved crown
    const pigeonPh = photo(260, 220, (x) => {
      const g = x.createRadialGradient(110, 80, 10, 130, 120, 140); g.addColorStop(0, '#d6d6de'); g.addColorStop(0.7, '#8b8b98'); g.addColorStop(1, '#4b4b56');
      x.fillStyle = g; x.beginPath(); x.ellipse(130, 125, 110, 82, -0.12, 0, TAU); x.fill();
      const n = x.createLinearGradient(80, 40, 170, 110); n.addColorStop(0, '#6aa38f'); n.addColorStop(0.5, '#8a6ab0'); n.addColorStop(1, '#8b8b98');
      x.fillStyle = n; x.beginPath(); x.ellipse(128, 70, 56, 46, 0, 0, TAU); x.fill();
      x.fillStyle = '#5c5c68'; x.beginPath(); x.moveTo(150, 110); x.quadraticCurveTo(250, 120, 258, 190); x.quadraticCurveTo(200, 170, 130, 170); x.fill();
      x.strokeStyle = '#2b2b33'; x.lineWidth = 6; for (const y of [130, 152]) { x.beginPath(); x.moveTo(160, y); x.quadraticCurveTo(200, y + 6, 240, y + 24); x.stroke(); }
      x.strokeStyle = '#c0605a'; x.lineWidth = 6; for (const fx of [110, 150]) { x.beginPath(); x.moveTo(fx, 196); x.lineTo(fx, 216); x.moveTo(fx - 12, 218); x.lineTo(fx + 12, 218); x.stroke(); }
    }, { keep: 0.45, tone: [0.95, 0.9, 0.86] });
    A.pigeon = cut(260, 220, (a) => a.drawImage(pigeonPh, 0, 0, 260, 220), { edge: 5, rough: 5 });
    const headSidePh = photo(140, 120, (x) => {
      const g = x.createRadialGradient(70, 50, 6, 76, 60, 60); g.addColorStop(0, '#d9d9e2'); g.addColorStop(1, '#6d6d7a');
      x.fillStyle = g; x.beginPath(); x.ellipse(80, 62, 50, 44, 0, 0, TAU); x.fill();
      x.fillStyle = '#3a3036'; x.beginPath(); x.moveTo(34, 56); x.lineTo(2, 70); x.lineTo(34, 74); x.fill();
      x.fillStyle = '#f2efe6'; x.beginPath(); x.ellipse(40, 58, 9, 7, 0, 0, TAU); x.fill();
      x.fillStyle = '#e07d2e'; x.beginPath(); x.arc(70, 52, 11, 0, TAU); x.fill();
      x.fillStyle = '#111'; x.beginPath(); x.arc(68, 52, 5, 0, TAU); x.fill();
    }, { keep: 0.55, tone: [0.95, 0.9, 0.86] });
    A.headSide = cut(140, 120, (a) => a.drawImage(headSidePh, 0, 0, 140, 120), { edge: 4, rough: 4 });
    const stern = (lid) => photo(150, 130, (x) => {
      const g = x.createRadialGradient(70, 52, 6, 75, 66, 70); g.addColorStop(0, '#dcdce4'); g.addColorStop(1, '#666673');
      x.fillStyle = g; x.beginPath(); x.ellipse(75, 68, 64, 56, 0, 0, TAU); x.fill();
      for (const [ex, s] of [[44, 1], [106, -1]]) {
        x.fillStyle = '#e07d2e'; x.beginPath(); x.arc(ex, 58, 15, 0, TAU); x.fill();
        x.fillStyle = '#0c0c0c'; x.beginPath(); x.arc(ex + s * 3, 60, 6.5, 0, TAU); x.fill();
        // a heavy, disapproving lid
        const q = -s; x.fillStyle = '#4e4e5a'; x.beginPath(); x.moveTo(ex - 21, 34); x.lineTo(ex + 21, 34); x.lineTo(ex + 21, 44 + 10 * lid - q * 7); x.lineTo(ex - 21, 44 + 10 * lid + q * 7); x.fill();
        x.strokeStyle = '#141414'; x.lineWidth = 4; x.beginPath(); x.moveTo(ex - 21, 44 + 10 * lid + q * 7); x.lineTo(ex + 21, 44 + 10 * lid - q * 7); x.stroke();
        x.lineWidth = 6; x.beginPath(); x.moveTo(ex - 22, 30 + q * 9); x.lineTo(ex + 22, 30 - q * 9); x.stroke();
      }
      x.fillStyle = '#3a3036'; x.beginPath(); x.moveTo(64, 80); x.lineTo(86, 80); x.lineTo(75, 110); x.fill();
      x.fillStyle = '#f2efe6'; x.beginPath(); x.ellipse(75, 80, 13, 6, 0, 0, TAU); x.fill();
    }, { keep: 0.55, tone: [0.95, 0.9, 0.86] });
    const s1 = stern(1), s2 = stern(1.55);
    A.stern1 = cut(150, 130, (a) => a.drawImage(s1, 0, 0, 150, 130), { edge: 4, rough: 4 });
    A.stern2 = cut(150, 130, (a) => a.drawImage(s2, 0, 0, 150, 130), { edge: 4, rough: 4 });
    A.crown = cut(96, 84, (a) => {
      const p = P.poly([6, 70, 2, 16, 22, 40, 34, 6, 48, 36, 62, 6, 74, 40, 94, 16, 90, 70]);
      eng(a, p, { fill: C.gold, shade: [-10, -6], ssp: 3, ink: 2 });
      for (const [x, y] of [[34, 10], [62, 10], [48, 38]]) eng(a, P.circ(x, y, 5), { fill: '#c0392b', ink: 1.2 });
      eng(a, P.rr(2, 62, 92, 20, 8), { fill: '#f5efe0', ink: 1.8 });
      for (let x = 12; x < 90; x += 16) fillP(a, P.ell(x, 72, 2.5, 4), INK);
      eng(a, P.circ(48, 52, 6), { fill: '#3f67a8', ink: 1.2 });
    }, { edge: 3, rough: 3 });
    A.carWindow = cut(1440, 880, (a) => {
      const frame = P.all(P.rect(0, 0, 1440, 880), P.rrCCW(170, 120, 1100, 610, 70));
      eng(a, frame, { fill: '#9c4a38', hatch: 3.2, ang: 0.4, ha: 0.35, ink: 0 });
      a.save(); a.beginPath(); frame(a); a.clip();
      inkP(a, P.rr(150, 100, 1140, 650, 86), 12, '#5c2a20');
      inkP(a, P.rr(170, 120, 1100, 610, 70), 3.4);
      a.restore();
      eng(a, P.rect(0, 760, 1440, 120), { fill: '#6a5040', hatch: 3, ang: 0, ha: 0.5, ink: 2.4 });
      for (let x = 30; x < 1440; x += 80) eng(a, P.circ(x, 60, 7), { fill: '#d6b25a', ink: 1.6 });
      // a strip map with no names, just coloured lines
      eng(a, P.rect(360, 22, 720, 60), { fill: '#efe6cc', ink: 2 });
      strokes(a, [380, 52, 1060, 52], 6, '#c24b34');
      for (let x = 400; x < 1060; x += 60) eng(a, P.circ(x, 52, 7), { fill: '#f5efe0', ink: 2 });
    }, { edge: 4, rough: 7, shadowA: 0.55 });
    A.strap = cut(70, 200, (a) => {
      eng(a, P.rect(26, 0, 18, 130), { fill: '#6d4b31', hatch: 3, ang: 1.5, ink: 2 });
      eng(a, P.ring(35, 160, 34, 22), { fill: '#e9dcc0', shade: [-6, -6], ink: 2.2 });
    });

    await Y();
    // ===== film =====
    A.grain = [0, 1, 2].map((k) => {
      const c = mk(640, 360), x = c.getContext('2d'), id = x.createImageData(640, 360), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (hash2(i, k, 77) - 0.5) * 90; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      x.putImageData(id, 0, 0);
      return c;
    });
    A.vignette = (() => {
      const c = mk(W, H), x = c.getContext('2d');
      const g = x.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 820);
      g.addColorStop(0, 'rgba(40,24,10,0)'); g.addColorStop(1, 'rgba(40,24,10,.62)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      return c;
    })();
  }

  // ---------- scene helpers ----------
  const jit = (f, k, amp) => (hash2(f >> 1, k, 5) - 0.5) * 2 * amp; // jitter held on twos
  function stringTo(c, x, y, len = 1400) { c.save(); c.strokeStyle = 'rgba(36,28,21,.75)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - len); c.stroke(); c.restore(); }
  function bubble(c, x, y, r) {
    c.save(); c.strokeStyle = INK; c.lineWidth = 2; c.globalAlpha = 0.8;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(250,245,230,.45)'; c.fill();
    c.fillStyle = '#fffaf0'; c.beginPath(); c.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, TAU); c.fill();
    c.restore();
  }
  function speedLines(c, x0, y0, x1, y1, n, f, len) {
    c.save(); c.strokeStyle = INK; c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const y = lerp(y0, y1, hash2(i, f >> 1, 3)), x = lerp(x0, x1, hash2(i, f >> 1, 4));
      c.lineWidth = 1.5 + hash2(i, 1, 9) * 3; c.globalAlpha = 0.7;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + len * (0.5 + hash2(i, 2, 9)), y); c.stroke();
    }
    c.restore();
  }
  function drawCar(c, x, y, s, o = {}) {
    // x,y: centre of the body; spread: half-width of the red middle (0 = still a capsule)
    const spread = o.spread ?? 260, fold = o.fold ?? 0;
    c.save(); c.translate(x, y); if (o.r) c.rotate(o.r); c.scale(s * (o.sx ?? 1), s);
    for (const bx of [-spread * 0.62, spread * 0.62]) if (spread > 40) put(c, A.bogie, bx, 50, { ax: 0.5, ay: 0.05, r: -fold * Math.PI / 2 * Math.sign(bx) });
    if (spread > 0) {
      c.save(); c.beginPath(); c.rect(-spread, -80, spread * 2, 160); c.clip();
      put(c, A.carMid, 0, 0, { ax: 0.5, ay: 0.5, sy: 1 });
      c.restore();
    }
    put(c, A.podL, -spread, 0, { ax: 1, ay: 0.5 });
    put(c, A.podR, spread, 0, { ax: 0, ay: 0.5 });
    if (o.lamp) put(c, A.lamp, -spread - 96, 12, { s: o.lamp });
    c.restore();
  }
  function splash(c, t) {
    if (t < 2.02 || t > 2.46) return;
    const y = t < 2.2 ? lerp(1000, -40, eout(seg(t, 2.02, 2.2))) : lerp(-40, -1100, ein(seg(t, 2.2, 2.46)));
    put(c, A.splash, 640, y, { ax: 0.5, ay: 0, s: 1.05 });
  }
  function podCab(c, t, f, shake, roll) {
    c.save();
    c.translate(640 + shake * jit(f, 1, 1), 360 + shake * jit(f, 2, 1)); c.rotate(roll);
    // glints on the glass
    c.save(); c.globalAlpha = 0.14; c.fillStyle = '#fffbe8';
    c.beginPath(); c.moveTo(-420, -300); c.lineTo(-330, -300); c.lineTo(-520, 240); c.lineTo(-610, 240); c.fill();
    c.beginPath(); c.moveTo(-270, -300); c.lineTo(-240, -300); c.lineTo(-430, 240); c.lineTo(-460, 240); c.fill();
    c.restore();
    put(c, A.podFrame, 0, 0, { ax: 0.5, ay: 0.5 });
    c.restore();
  }

  // ---------- scene 1: the Eye (0 – 2.2) ----------
  function sceneEye(c, t, f) {
    const tp = twos(t);
    const clunk = t >= 1.05 ? 1 : 0;
    const tip = eio(seg(t, 1.36, 1.6));
    const fl = seg(t, 1.6, 2.2);
    let rot = tip * 0.42 + (fl > 0 ? -0.9 * eio(fl) : 0);
    const focusX = lerp(640, 760, ein(fl)), focusY = lerp(360, 610, eio(fl));
    const sc = 1 + ein(fl) * 5.5;
    const lift = Math.sin(Math.PI * clamp(fl * 1.6)) * 220 * (1 - fl);
    const jolt = clunk * (t < 1.36 ? 16 * (1 - wob(t - 1.05, 30, 9) * 0.6) : 16);
    const shake = t > 1.05 && t < 1.36 ? 3 : 0;
    c.save();
    c.translate(640 + jit(f, 3, shake), 360 + jit(f, 4, shake) - jolt + lift);
    c.rotate(rot);
    c.scale(sc, sc);
    c.translate(-focusX, -focusY);
    // the world
    const rise = eio(seg(t, 0, 1.05)) * 28;
    put(c, A.sky, 640, 380 + rise * 0.3, { ax: 0.5, ay: 0.55 });
    const sunY = 170 + rise * 0.4;
    stringTo(c, 1050, sunY - 120);
    put(c, t > 1.12 ? A.sunO : A.sun, 1050, sunY, { r: Math.sin(tp * 3) * 0.06 + (t > 1.12 ? wob(t - 1.12, 30, 6) * 0.2 : 0) });
    for (const [S, x, y, ph] of [[A.cloud1, 330, 190, 0], [A.cloud2, 760, 120, 2], [A.cloud3, 1390, 260, 4]]) {
      const cx = x + Math.sin(tp * 1.3 + ph) * 12 - tp * 14, cy = y + rise * 0.5;
      stringTo(c, cx - 60, cy - 30); stringTo(c, cx + 60, cy - 30);
      put(c, S, cx, cy);
    }
    put(c, A.skyline, 640, 505 + rise, { ax: 0.5, ay: 1, s: 0.9 });
    put(c, A.thames, 640, 495 + rise, { ax: 0.5, ay: 0 });
    put(c, A.steamer, 340 + tp * 22, 505 + rise, { ax: 0.5, ay: 0.8, s: 0.7, r: Math.sin(tp * 5) * 0.05 });
    if (fl < 0.35) { // we leave the wheel behind as we fly
      put(c, A.legs, 250, 150, { ax: 700 / 760, ay: 40 / 960 });
      const wr = (t < 1.05 ? t : 1.05) * 0.1 + (t > 1.05 ? wob(t - 1.05, 25, 8) * 0.01 : 0);
      put(c, A.wheel, 250, 150, { r: wr + 0.3 });
    }
    // the bolt that should not have come loose
    if (t > 1.2 && t < 1.8) {
      const u = t - 1.2;
      put(c, A.bolt, 640 + u * 900, 250 - u * 500 + u * u * 1400, { r: u * 20 });
    }
    c.restore();
    splash(c, t);
    // our capsule and our gloved hands
    const roll = tip * 0.08 - eio(fl) * 0.12;
    podCab(c, t, f, shake * 1.2, roll);
    c.save();
    c.translate(640, 360); c.rotate(roll); c.translate(-640, -360);
    const railY = 612 + (t > 1.05 && t < 1.36 ? jit(f, 7, 2) : 0);
    put(c, A.rail, 640, railY, { ax: 0.5, ay: 0.5 });
    const hf = seg(t, 1.4, 1.95);
    for (const [hx, s, k] of [[430, 1, 0], [850, -1, 1]]) {
      const grip = t > 1.05 && t < 1.4 ? 0.94 : 1;
      const bob = Math.sin(tp * 4 + k) * 3;
      const hy = railY + 30 + bob - ein(hf) * 900 + Math.sin(hf * 9 + k) * 30 * hf;
      put(c, A.hand, hx - s * eio(hf) * 160, hy, { sx: s * grip, sy: grip, ax: 0.5, ay: 0.35, r: s * (hf * 2.6 + Math.sin(tp * 30) * 0.3 * hf) });
    }
    c.restore();
  }

  // ---------- scene 2: under the Thames (2.2 – 3.4) ----------
  function sceneFish(c, t, f) {
    const tp = twos(t);
    const lung = seg(t, 3.06, 3.36);
    const sway = Math.sin(t * 2.2) * 10;
    put(c, A.under, 640 + sway, 380, { ax: 0.5, ay: 0.5 });
    // drifting débris: a bowler hat and a teacup, going about their business
    put(c, A.bowler, 180 + (t - 2.2) * 90, 170 + Math.sin(tp * 3) * 8, { r: -0.4 + (t - 2.2) * 0.6, s: 0.9 });
    put(c, A.teacup, 1080 - (t - 2.2) * 60, 560 + Math.sin(tp * 2.5) * 10, { r: 0.8 - (t - 2.2) * 0.5, s: 0.9 });
    // our own bubbles
    for (let i = 0; i < 14; i++) {
      const u = t - 2.2 - hash2(i, 1, 2) * 0.25;
      if (u < 0) continue;
      const x = 640 + (hash2(i, 2, 2) - 0.5) * 700 + Math.sin(u * 8 + i) * 12, y = 700 - u * (500 + hash2(i, 3, 2) * 500);
      if (y > -40) bubble(c, x, y, 6 + hash2(i, 4, 2) * 16);
    }
    if (t < 2.96) {
      const u = seg(t, 2.32, 2.78);
      const x = lerp(1650, 700, eout(u)), y = 330 + Math.sin(tp * 5) * 6;
      const s = 0.82, tailR = Math.sin(tp * 18) * 0.3 * (1 - u * 0.7);
      c.save(); c.translate(x, y); c.scale(s, s);
      put(c, A.fishTail, 700 - 450 - 10, 228 - 220, { ax: 0, ay: 0.5, r: tailR });
      put(c, A.fishSide, 0, 0, { ax: 0.5, ay: 0.5 });
      put(c, A.hat, 196 - 450, 86 - 220, { ax: 0.5, ay: 0.9, r: -0.25 });
      // the eye swivels round to find us
      const look = t > 2.8 ? 1 : 0;
      const ex = 150 - 450, ey = 150 - 220;
      c.fillStyle = INK; c.beginPath(); c.arc(ex - 12 + look * 12, ey + 2, look ? 15 : 12, 0, TAU); c.fill();
      if (t > 2.88 && t < 2.93) put(c, A.lid, ex, ey - 36, { ax: 0.5, ay: 0, sy: 1.8 });
      put(c, A.monocle, ex + 2, ey + 2, { s: 1.1 });
      c.restore();
    } else {
      const ant = eio(seg(t, 2.96, 3.06));
      const s = 0.52 - ant * 0.04 + ein(lung) * 5.8;
      const mo = eout(seg(t, 3.04, 3.3));
      const mx = 640, my = lerp(460, 380, eio(lung)) + ant * 10;
      const jx = jit(f, 11, 2 * (1 - lung));
      c.save(); c.translate(mx + jx, my); c.scale(s, s);
      put(c, A.fishFront, 0, 0, { ax: 0.5, ay: 590 / 860 });
      for (const ex of [-310, 310]) { c.fillStyle = INK; c.beginPath(); c.arc(ex * 0.99 - Math.sign(ex) * 14, 330 - 590 + 6, 24, 0, TAU); c.fill(); }
      put(c, A.throat, 0, 10, { ax: 0.5, ay: 0.5, sx: 0.25 + 0.75 * mo, sy: 0.05 + mo * 1.05 });
      put(c, A.lipTop, 0, -mo * 250, { ax: 0.5, ay: 0.9 });
      put(c, A.lipBot, 0, mo * 250, { ax: 0.5, ay: 0.1, sx: 1 + 0.2 * mo });
      c.restore();
    }
    splash(c, t);
    // hands return, clutching the rail, the moment the fish looks round
    const back = seg(t, 2.84, 2.96);
    podCab(c, t, f, t > 2.96 ? 4 : 0, 0);
    put(c, A.rail, 640, 612, { ax: 0.5, ay: 0.5 });
    if (back > 0) for (const [hx, s] of [[470, 1], [810, -1]]) put(c, A.hand, hx + jit(f, hx, 3), lerp(900, 648, eout(back)) + jit(f, hx + 1, 3), { sx: s, ax: 0.5, ay: 0.35 });
    if (t > 3.3) { c.fillStyle = `rgba(8,5,3,${seg(t, 3.3, 3.36)})`; c.fillRect(0, 0, W, H); }
  }

  // ---------- scene 3: the fish, in section (3.4 – 4.7) ----------
  function sceneSection(c, t, f) {
    const tp = twos(t);
    const push = eio(seg(t, 4.46, 4.72));
    c.save();
    c.translate(890, 640); c.scale(1 + push * 1.2, 1 + push * 1.2); c.translate(-890, -640 + push * 60);
    put(c, A.riverbed, -60, -50, { ax: 0, ay: 0 });
    put(c, A.steamer, 200 + (t - 3.4) * 70, 50, { ax: 0.5, ay: 0.85, s: 0.9, r: Math.sin(tp * 6) * 0.06 });
    // the diver, who has seen things
    const hop = t > 4.22 ? Math.max(0, Math.sin(seg(t, 4.22, 4.46) * Math.PI)) * 40 : 0;
    put(c, A.diver, 240, 455 - hop, { ax: 0.5, ay: 1, s: 0.9, r: t > 4.22 && t < 4.5 ? -0.12 : 0 });
    for (let i = 0; i < 3; i++) { const u = ((t - 3.4 + i * 0.4) % 1.2); bubble(c, 262 + Math.sin(u * 9) * 6, 380 - u * 300, 5 + i * 2); }
    // strain
    const strain = seg(t, 3.56, 4.06), frozen = t >= 4.06 && t < 4.22, popped = t >= 4.22;
    const amp = frozen ? 0 : popped ? 0 : Math.pow(strain, 1.4) * 5;
    const puffY = popped ? 1 + 0.045 * (1 - seg(t, 4.22, 4.3)) - wob(t - 4.3, 30, 7) * 0.02 : 1 + 0.045 * eio(strain);
    const fx = 429 + jit(f, 21, amp), fy = 162 + jit(f, 22, amp);
    const nod = popped ? -wob(t - 4.45, 12, 4) * 0.04 : -0.03 * eio(strain);
    const s = 0.72;
    c.save();
    c.translate(fx + 360 * s, fy + 420 * s); c.rotate(nod); c.scale(1 / Math.sqrt(puffY), puffY); c.translate(-360 * s, -420 * s);
    c.scale(s, s);
    put(c, A.fishTail, 690, 228, { ax: 0, ay: 0.5, r: popped ? wob(t - 4.22, 22, 4) * 0.5 : Math.sin(tp * 4) * 0.08 });
    put(c, A.fishSide, 0, 0, { ax: 0, ay: 0 });
    const ex = 150, ey = 150;
    const squeeze = t > 3.62 && t < 4.3;
    c.fillStyle = INK; c.beginPath(); c.arc(ex - 8, ey + 2, 13, 0, TAU); c.fill();
    if (squeeze) put(c, A.lid, ex, ey - 36, { ax: 0.5, ay: 0, sy: 1.75 });
    else if (popped && t < 4.7) put(c, A.lid, ex, ey - 36, { ax: 0.5, ay: 0, sy: 0.9 }); // a contented half-lid
    // hat: rises with the effort, pops at the moment, lands askew
    let hatY = -eio(strain) * 18 * (popped ? 0 : 1), hatR = -0.2;
    if (popped) { const u = seg(t, 4.22, 4.46); hatY = -Math.sin(u * Math.PI) * 120; hatR = -0.2 + u * 0.3 + (t > 4.46 ? wob(t - 4.46, 30, 8) * 0.2 : 0); }
    put(c, A.hat, 204, 90 + hatY, { ax: 0.5, ay: 0.9, r: hatR, s: 1.05 });
    // strain marks and a bead of effort
    if (strain > 0.3 && !popped) for (let i = 0; i < 3; i++) strokes(c, [80 + i * 26, 30 - i * 6, 70 + i * 30, 6 - i * 10], 3.4, INK, 0.9);
    if (t > 3.9 && !popped) { c.save(); c.fillStyle = '#a9c7d6'; c.strokeStyle = INK; c.lineWidth = 2; const dy = (t - 3.9) * 120; c.beginPath(); c.moveTo(250, 110 + dy); c.quadraticCurveTo(262, 136 + dy, 250, 140 + dy); c.quadraticCurveTo(238, 136 + dy, 250, 110 + dy); c.fill(); c.stroke(); c.restore(); }
    // the monocle gives way first
    if (t < 3.86) put(c, A.monocle, ex + 2, ey + 2, { s: 1.1 });
    else {
      const u = t - 3.86, drop = Math.min(1, u * 8);
      const ang = 0.9 * Math.exp(-u * 2) * Math.cos(u * 11);
      const ax = ex + 30, ay = ey - 20, L = 40 + drop * 70;
      const mx = ax + Math.sin(ang) * L, my = ay + Math.cos(ang) * L;
      strokes(c, [ax, ay, mx, my - 30], 1.6);
      put(c, A.monocle, mx, my, { s: 1.1 });
    }
    c.restore();
    // the capsule arrives in the world, underground
    if (popped) {
      const u = t - 4.22;
      const pu = seg(t, 4.22, 4.5);
      put(c, A.puff, 890, 395, { s: 0.25 + eout(pu) * 0.9, alpha: 1 - seg(t, 4.4, 4.6), r: u * 1.2 });
      for (let i = 0; i < 5; i++) {
        const an = -Math.PI / 2 + (i - 2) * 0.5, d = eout(pu) * 80;
        if (pu < 1) strokes(c, [890 + Math.cos(an) * (d + 20), 400 + Math.sin(an) * (d + 20), 890 + Math.cos(an) * (d + 36), 400 + Math.sin(an) * (d + 36)], 3);
      }
      let py;
      if (u < 0.05) py = 400 + u * 400;
      else if (t < 4.44) py = 420 + ein(seg(t, 4.27, 4.44)) * 242;
      else py = 662 - Math.abs(Math.sin(seg(t, 4.44, 4.58) * Math.PI)) * 18 * (t < 4.58 ? 1 : 0);
      put(c, A.pod, 890, py - 19, { s: 0.3, r: u < 0.2 ? Math.sin(u * 40) * 0.3 : 0 });
    }
    c.restore();
  }

  // ---------- scene 4a: capsule becomes carriage (4.7 – 5.33) ----------
  function sceneUnfold(c, t, f) {
    put(c, A.tunnelSide, -60, -60, { ax: 0, ay: 0 });
    let cy = 546, cx = 640;
    if (t < 4.8) { const u = seg(t, 4.7, 4.8); cy = lerp(-80, 546, ein(u)); }
    else cy = 546 - Math.abs(Math.sin(seg(t, 4.8, 4.88) * Math.PI)) * 14;
    const spread = lerp(0, 130, eout(seg(t, 4.86, 4.92))) + lerp(0, 130, eout(seg(t, 4.97, 5.03)));
    const fold = 1 - back(seg(t, 5.05, 5.13));
    const lift = (1 - fold) * 38;
    const lean = t < 5.25 ? eio(seg(t, 5.15, 5.25)) * 0.06 : 0.06 * (1 - seg(t, 5.25, 5.3));
    const go = ein(seg(t, 5.24, 5.33));
    cx -= go * 1300;
    c.save(); c.translate(cx + spread + 100, cy - lift + 50); c.rotate(lean); c.translate(-(cx + spread + 100), -(cy - lift + 50));
    drawCar(c, cx, cy - lift, 1, { spread, fold: t < 5.05 ? 1 : fold, lamp: t > 5.14 ? 0.8 + Math.sin(t * 60) * 0.1 : 0, sx: 1 + go * 0.25 });
    c.restore();
    if (go > 0) speedLines(c, cx + spread + 60, 460, cx + spread + 500, 640, 16, f, 260);
    if (t < 4.82) for (let i = 0; i < 6; i++) { const u = seg(t, 4.74, 4.9); bubble(c, 640 + (i - 3) * 40, 20 + u * 200 + i * 10, 5); }
  }

  // ---------- scene 4b: tunnel into trumpet (5.33 – 6.6) ----------
  const TUN = { t0: 5.33, t1: 6.6 };
  const trav = (tt) => 12.5 * tt + 5.2 * tt * tt;
  const S_END = trav(TUN.t1 - TUN.t0), X_EXIT = S_END + 0.3, K_BRASS = X_EXIT - 7.5, K_BELL = X_EXIT - 3.2;
  function sceneTunnel(c, t, f) {
    const tt = t - TUN.t0, s = trav(tt);
    c.fillStyle = '#16110d'; c.fillRect(0, 0, W, H);
    const off = (k) => [0.4 * Math.sin(k * 0.33), 0.12 * Math.sin(k * 0.21 + 1)];
    const [ox, oy] = off(s);
    const proj = (k, x, y) => { const z = k - s, [dx, dy] = off(k); return [640 + (dx - ox + x) * 520 / z, 330 + (dy - oy + y) * 520 / z]; };
    const bell = (k) => 1 + Math.pow(Math.max(0, k - K_BELL), 2) * 0.16;
    // the light at the end of the trumpet
    const ze = X_EXIT - s;
    if (ze < 12) {
      const [lx, ly] = proj(X_EXIT, 0, 0), R = (520 / ze) * bell(X_EXIT) * 0.95;
      const zb = K_BRASS - s;
      if (zb > 0.3 && zb < 12) { const [bx, by] = proj(K_BRASS, 0, 0); c.fillStyle = '#4a3714'; c.beginPath(); c.arc(bx, by, (520 / zb) * 0.95, 0, TAU); c.fill(); }
      else if (zb <= 0.3) { c.fillStyle = '#4a3714'; c.fillRect(0, 0, W, H); }
      const g = c.createRadialGradient(lx, ly, 0, lx, ly, R);
      g.addColorStop(0, '#fffbe9'); g.addColorStop(0.7, '#f3e6c0'); g.addColorStop(1, '#e2cc92');
      c.fillStyle = g; c.beginPath(); c.arc(lx, ly, R, 0, TAU); c.fill();
    }
    // rails, as far as the brass
    const rail = (x) => {
      c.save(); c.strokeStyle = '#b9b09c'; c.lineWidth = 3; c.beginPath();
      let first = true;
      for (let k = s + 0.35; k < Math.min(s + 12, K_BRASS); k += 0.25) { const [px, py] = proj(k, x, 0.8); first ? c.moveTo(px, py) : c.lineTo(px, py); first = false; }
      c.stroke(); c.restore();
    };
    for (let k = Math.ceil((s + 0.4) * 2) / 2; k < Math.min(s + 12, K_BRASS); k += 0.5) {
      const [ax, ay] = proj(k, -0.42, 0.82), [bx, by] = proj(k, 0.42, 0.82);
      c.save(); c.globalAlpha = clamp(1.2 - (k - s) / 10); c.strokeStyle = '#5a4432'; c.lineWidth = Math.max(1, 30 / (k - s)); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.restore();
    }
    rail(-0.3); rail(0.3);
    // rings, far to near
    const kFar = Math.floor(Math.min(s + 11, X_EXIT - 0.01) * 2) / 2, kNear = Math.ceil((s + 0.32) * 2) / 2;
    for (let k = kFar; k >= kNear; k -= 0.5) {
      const z = k - s, [px, py] = proj(k, 0, 0);
      const brass = k >= K_BRASS;
      const S = brass ? A.ringBrass : A.ringBrick;
      const sc = ((520 / z) / 450) * (brass ? bell(k) : 1.08);
      put(c, S, px, py, { s: sc, alpha: clamp(1.25 - z / 10) });
      // valve pistons plunge through the brass, pressed by an unseen giant finger
      if (brass && (k === Math.floor(K_BRASS) + 2 || k === Math.floor(K_BRASS) + 3 || k === Math.floor(K_BRASS) + 4)) {
        const n = k - Math.floor(K_BRASS) - 2, press = Math.max(0, Math.sin((tt * 7 - n * 0.9) * Math.PI)) * 0.35;
        put(c, A.valve, px, py - (0.9 - press) * 520 / z, { ax: 0.5, ay: 1, s: (520 / z) / 900, alpha: clamp(1.25 - z / 10) });
      }
    }
    // the carriage ahead of us
    const away = seg(t, 6.28, 6.58);
    const zc = 1.25 + ein(away) * 8;
    const [qx, qy] = proj(s + zc, 0, 0.62);
    const cs = (1.25 / zc) * 0.9;
    const bump = jit(f, 31, 3);
    put(c, A.carRear, qx + jit(f, 32, 2), qy + bump - 70 * cs, { s: cs, ay: 0.95, r: Math.sin(t * 9) * 0.03 });
    // sparks off the wheels, while there are rails
    if (s + zc < K_BRASS) for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, u = hash2(i, f, 8);
      const x = qx + side * (110 * cs + u * 80), y = qy - 6 + hash2(i, f, 9) * 30;
      c.save(); c.fillStyle = '#f7d774'; c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath();
      for (let j = 0; j < 8; j++) { const an = (j / 8) * TAU, R = j % 2 ? 3 : 9; c.lineTo(x + Math.cos(an) * R, y + Math.sin(an) * R); }
      c.closePath(); c.fill(); c.stroke(); c.restore();
    }
    if (t > 6.5) { c.fillStyle = `rgba(252,246,228,${seg(t, 6.5, 6.6)})`; c.fillRect(0, 0, W, H); }
  }

  // ---------- scene 5: Horse Guards' trumpet, Big Ben (6.6 – 7.56) ----------
  function sceneGuard(c, t, f) {
    const tp = twos(t);
    const push = ein(seg(t, 7.26, 7.56));
    const clockX = 1010, clockY = 282;
    c.save();
    const sc = 1 + push * 2.6;
    c.translate(lerp(clockX, 640, push), lerp(clockY, 360, push)); c.scale(sc, sc); c.translate(-clockX, -clockY);
    put(c, A.sky, 640, 330, { ax: 0.5, ay: 0.55 });
    stringTo(c, 520, 90); stringTo(c, 700, 90);
    put(c, A.cloud3, 610, 110 + Math.sin(tp * 2) * 5, { s: 0.9 });
    put(c, A.skyline, 1000, 610, { ax: 0.5, ay: 1, s: 0.75 });
    put(c, A.thames, 640, 606, { ax: 0.5, ay: 0, s: 0.8 });
    put(c, A.pavement, 640, 660, { ax: 0.5, ay: 0 });
    // Big Ben, startled
    const jump = t > 7.06 ? Math.sin(seg(t, 7.06, 7.2) * Math.PI) * 30 : 0;
    const squash = t > 7.06 ? 1 + wob(t - 7.06, 40, 7) * 0.05 : 1;
    put(c, A.tower, clockX, 748 - jump, { ax: 0.5, ay: 1, sy: squash, sx: 2 - squash, s: 0.8 });
    if (t > 7.06 && t < 7.4) {
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * TAU + 0.2, r0 = 120, r1 = 170 + (f % 2) * 8;
        strokes(c, [clockX + Math.cos(an) * r0, clockY - jump + Math.sin(an) * r0, clockX + Math.cos(an) * (r0 + 20) + 8, clockY - jump + Math.sin(an) * (r0 + 20) - 8, clockX + Math.cos(an) * r1, clockY - jump + Math.sin(an) * r1], 4);
      }
    }
    // the giant guardsman
    const blow = t < 7.06 ? 1 : 1 - seg(t, 7.06, 7.2) * 0.5;
    const recoil = -wob(t - 6.6, 26, 6) * 0.03;
    c.save();
    c.translate(330, 740); c.rotate(recoil); c.translate(-330, -740);
    put(c, A.guardBody, 330, 420, { ax: 0.5, ay: 0, s: 1 });
    put(c, A.face, 330, 330, { s: 1.15 });
    const lookR = t > 7.12 ? 1 : 0;
    for (const ex of [-34, 34]) { c.fillStyle = INK; c.beginPath(); c.arc(330 + ex + lookR * 8 - 2, 311 - lookR * 2, 6.5, 0, TAU); c.fill(); }
    put(c, A.cheek, 330 - 66, 392, { s: 0.45 + 0.4 * blow });
    put(c, A.cheek, 330 + 66, 392, { s: 0.45 + 0.4 * blow });
    put(c, A.bearskin, 334, 262, { ax: 0.5, ay: 1, s: 1.02 });
    strokes(c, [254, 250, 262, 360, 330, 452, 398, 360, 406, 250], 3, C.gold);
    put(c, A.trumpet, 345, 408, { ax: 0, ay: 0.5, r: -0.3 });
    c.restore();
    const bellX = 345 + Math.cos(-0.3) * 476, bellY = 408 + Math.sin(-0.3) * 476;
    // the blast, the notes, and us
    const bu = seg(t, 6.6, 6.82);
    if (bu < 1) put(c, A.blast, bellX + 30, bellY, { s: 0.3 + eout(bu) * 1.0, r: bu * 1.5, alpha: 1 - ein(bu) });
    for (let i = 0; i < 4; i++) {
      const u = seg(t, 6.62 + i * 0.06, 7.3 + i * 0.05);
      if (u > 0 && u < 1) put(c, A.note, bellX + u * (160 + i * 60), bellY - 40 - u * (200 - i * 40) + Math.sin(u * 12 + i) * 16, { s: 0.8, r: Math.sin(u * 10 + i) * 0.4, alpha: 1 - ein(u) });
    }
    const fu = seg(t, 6.62, 7.06);
    if (t >= 6.62) {
      let px, py, pr;
      if (fu < 1) {
        const e = eout(fu), x0 = bellX + 20, y0 = bellY, x1 = clockX - 30, y1 = clockY + 20, qx = 930, qy = 70;
        px = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * qx + e * e * x1;
        py = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * qy + e * e * y1;
        pr = lerp(-0.7, 0.1, e) + Math.sin(fu * 30) * 0.1;
      } else { px = clockX - 30 + jit(f, 41, t < 7.2 ? 4 : 0); py = clockY + 20; pr = 0.1 + wob(t - 7.06, 30, 6) * 0.2; }
      drawCar(c, px, py, 0.22, { spread: 260, fold: 0, r: pr });
      if (fu < 0.9) speedLines(c, px - 220, py - 30, px - 100, py + 30, 5, f, 90);
    }
    c.restore();
    if (t < 6.68) { c.fillStyle = `rgba(252,246,228,${1 - seg(t, 6.6, 6.68)})`; c.fillRect(0, 0, W, H); }
  }

  // ---------- scene 6: the royal pigeon (7.56 – 9.62) ----------
  function scenePigeon(c, t, f) {
    const tp = twos(t);
    const push = eio(seg(t, 8.8, 9.62));
    const e = back(seg(t, 8.14, 8.36), 2.8) + (t > 8.36 ? wob(t - 8.36, 38, 6) * 0.12 : 0);
    const e2 = twos(0) + e;
    const pyP = 360 + 170 * e2;
    const sc = 1 + push * 0.55;
    c.save();
    c.translate(640, lerp(360, 360, push)); c.scale(sc, sc); c.translate(-640, -lerp(360, pyP - 200, push));
    const rattle = t < 7.86 ? 3 * (1 - seg(t, 7.56, 7.86)) : 0;
    put(c, A.clockBg, -110 + jit(f, 51, rattle * 0.5), -90, { ax: 0, ay: 0 });
    const cx = 640 + jit(f, 52, rattle), cy = 360 + jit(f, 53, rattle);
    put(c, A.cavity, cx, cy);
    // the door: clock face swings open on its left hinge
    const th = 1.32 * back(seg(t, 8.04, 8.2), 1.7);
    const bulge = t > 7.9 && t < 8.04 ? 1 + Math.sin(seg(t, 7.9, 8.04) * Math.PI) * 0.035 : 1;
    // the pigeon rides out on lazy tongs
    if (t > 8.12) {
      const n = 4, top = cy - 10, bot = pyP - 20, w = 30 + 34 * (1 - e2);
      c.save(); c.lineCap = 'round';
      for (const [lw, col] of [[10, INK], [6, '#8d6c49']]) {
        c.strokeStyle = col; c.lineWidth = lw;
        for (let i = 0; i < n; i++) {
          const y0 = lerp(top, bot, i / n), y1 = lerp(top, bot, (i + 1) / n);
          c.beginPath(); c.moveTo(cx - w, y0); c.lineTo(cx + w, y1); c.moveTo(cx + w, y0); c.lineTo(cx - w, y1); c.stroke();
        }
      }
      c.restore();
      const ps = 0.9 + e2 * 0.5;
      const settle = t > 8.76 ? wob(t - 8.76, 30, 8) * 0.04 : 0;
      put(c, A.pigeon, cx, bot + 30, { ax: 0.5, ay: 0.95, s: ps, sy: 1 - settle });
      const hx = cx - 8 * ps, hy = bot + 30 - 170 * ps;
      let head = A.headSide, hsx = 1, crownX = 12, crownY = -62, crownR = -0.1;
      if (t >= 8.62 && t < 8.76) hsx = -1;
      if (t >= 8.76) { head = t >= 9.18 ? A.stern2 : A.stern1; crownX = 0; crownY = -66; crownR = 0; }
      if (t >= 9.18 && t < 9.36) crownR = 0.26; // the crown slips...
      if (t >= 9.36) crownR = wob(t - 9.36, 30, 10) * 0.08; // ...and is set right with a look
      put(c, head, hx, hy, { s: ps, sx: hsx, ay: 0.55 });
      put(c, A.crown, hx + crownX * ps * hsx, hy + crownY * ps + (t >= 9.18 && t < 9.36 ? 6 : 0), { s: ps * 0.62, r: crownR * hsx, ay: 0.9 });
    }
    c.save();
    c.translate(cx - 280, cy);
    c.transform(Math.cos(th), -Math.sin(th) * 0.18, 0, 1, 0, 0);
    c.scale(bulge, bulge);
    put(c, A.clockFace, 280, 0);
    c.restore();
    if (t < 8.04) {
      const k = 1 - eout(seg(t, 7.56, 7.86));
      put(c, A.handHour, cx, cy, { ax: 0.5, ay: 32 / 180 * 0 + 0.93, r: k * TAU * 1.25, s: 1 });
      put(c, A.handMin, cx, cy, { ax: 0.5, ay: 0.95, r: k * TAU * 4, s: 1 });
    }
    c.restore();
    // we are in the carriage, looking out
    const swing = 0.35 * Math.exp(-(t - 7.56) * 2.2) * Math.cos((t - 7.56) * 7);
    c.save(); c.translate(640 + jit(f, 61, rattle * 1.5), 360 + jit(f, 62, rattle * 1.5));
    put(c, A.strap, -470, -262, { ax: 0.5, ay: 0, r: swing });
    put(c, A.strap, 470, -262, { ax: 0.5, ay: 0, r: swing * 0.8 });
    put(c, A.carWindow, 0, 0);
    c.restore();
  }

  // ---------- film ----------
  let ctx, canvas, ready = false;
  function renderFrame(time) {
    const f = Math.floor(time * FPS + 1e-6), t = f / FPS;
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.fillStyle = '#0d0a07'; ctx.fillRect(0, 0, W, H);
    const weave = [jit(f, 91, 0.9), jit(f, 92, 0.9)];
    ctx.save(); ctx.translate(weave[0], weave[1]);
    if (t < 2.2) sceneEye(ctx, t, f);
    else if (t < 3.4) sceneFish(ctx, t, f);
    else if (t < 4.7) sceneSection(ctx, t, f);
    else if (t < 5.33) sceneUnfold(ctx, t, f);
    else if (t < 6.6) sceneTunnel(ctx, t, f);
    else if (t < 7.56) sceneGuard(ctx, t, f);
    else if (t < 9.62) scenePigeon(ctx, t, f);
    ctx.restore();
    // the print: vignette, flicker, grain, dust
    ctx.drawImage(A.vignette, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.42;
    const g = A.grain[f % 3];
    ctx.drawImage(g, -(f * 97) % 200, -(f * 53) % 120, 1280 * 1.3, 720 * 1.3);
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.05 + hash2(f, 0, 12) * 0.05;
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = '#1a120b'; ctx.fillStyle = '#1a120b';
    for (let i = 0; i < 5; i++) {
      if (hash2(f, i, 13) > 0.55) continue;
      const x = hash2(f, i, 14) * W, y = hash2(f, i, 15) * H;
      ctx.globalAlpha = 0.5;
      if (i === 0) { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 12, y + 8, x + 6, y + 26); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(x, y, 0.8 + hash2(f, i, 16) * 1.8, 0, TAU); ctx.fill(); }
    }
    if (hash2(f >> 2, 0, 17) < 0.35) { const x = hash2(f >> 2, 1, 17) * W; ctx.globalAlpha = 0.18; ctx.fillStyle = '#f6ecd0'; ctx.fillRect(x, 0, 1.4, H); }
    ctx.restore();
  }

  const Y = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  // while the cast is cut out: a film leader's sweep, no numbers
  function leader(now) {
    const x = ctx; x.setTransform(RES, 0, 0, RES, 0, 0);
    x.fillStyle = '#17110c'; x.fillRect(0, 0, W, H);
    const an = (now / 1000) * TAU;
    x.fillStyle = 'rgba(236,223,192,.10)'; x.beginPath(); x.moveTo(640, 360); x.arc(640, 360, 900, -Math.PI / 2, -Math.PI / 2 + (an % TAU)); x.fill();
    x.strokeStyle = 'rgba(236,223,192,.35)'; x.lineWidth = 3;
    for (const r of [150, 190]) { x.beginPath(); x.arc(640, 360, r, 0, TAU); x.stroke(); }
    x.beginPath(); x.moveTo(640, 0); x.lineTo(640, 720); x.moveTo(0, 360); x.lineTo(1280, 360); x.stroke();
  }
  async function boot() {
    canvas = document.getElementById('film');
    canvas.width = W * RES; canvas.height = H * RES;
    ctx = canvas.getContext('2d');
    let loading = true;
    const lead = (now) => { if (!loading) return; leader(now); requestAnimationFrame(lead); };
    if (!Q.has('record')) requestAnimationFrame(lead);
    await Y();
    PAPERTEX = makePaper();
    await buildCast();
    loading = false;
    ready = true;
    window.__film = { renderFrame, DUR, FPS, W, H, RES, ready: true };
    if (Q.has('t')) { renderFrame(+Q.get('t')); return; }
    if (Q.has('record')) return;
    let t0 = null;
    const tick = (now) => {
      if (t0 == null) t0 = now;
      renderFrame(((now - t0) / 1000) % DUR);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.addEventListener('load', () => setTimeout(boot, 30));
})();
