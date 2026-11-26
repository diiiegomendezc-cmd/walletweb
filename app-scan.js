/* WalletWeb — escáner de facturas: cámara propia, recorte automático, limpieza tipo escáner y PDF buscable.
   Todo ocurre en el teléfono: no hay servidores ni librerías externas. */
'use strict';

/* ================= Procesamiento de imagen ================= */
// Caja de desenfoque con imagen integral (O(n) sin importar el radio)
function sBoxBlur(src, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}
// Máximo / mínimo en ventana cuadrada (separable)
function sMorph(src, w, h, r, isMax) {
  if (r >= 3) return sMorphFast(src, w, h, r, isMax);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const pick = isMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = src[y * w + x]; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[y * w + k]); tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = tmp[y * w + x]; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]); out[y * w + x] = v; }
  return out;
}
function sMorphFast(src, w, h, r, isMax) {
  const k = 2 * r + 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h), pick = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
  const pass = (get, set, len, count) => {
    const L = len + 2 * r, g = new Float32Array(L), hh = new Float32Array(L), f = new Float32Array(L);
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < L; i++) { const j = Math.max(0, Math.min(len - 1, i - r)); f[i] = get(c, j); }
      for (let i = 0; i < L; i++) g[i] = i % k === 0 ? f[i] : pick(g[i - 1], f[i]);
      for (let i = L - 1; i >= 0; i--) hh[i] = (i === L - 1 || (i + 1) % k === 0) ? f[i] : pick(hh[i + 1], f[i]);
      for (let i = 0; i < len; i++) set(c, i, pick(hh[i], g[i + 2 * r]));
    }
  };
  pass((y, x) => src[y * w + x], (y, x, v) => { tmp[y * w + x] = v; }, w, h);
  pass((x, y) => tmp[y * w + x], (x, y, v) => { out[y * w + x] = v; }, h, w);
  return out;
}
// Piel (dedos) en espacio YCbCr: excluye papel blanco o amarillento
function sIsSkin(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b;
  return y > 50 && y < 240 && cr > 146 && cr < 182 && cb > 80 && cb < 128;
}
function sOtsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; t = i; }
  }
  return t;
}
function sPolyArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }

/* ---------- Detección del papel ----------
   1) Balance de blancos automático: con luz cálida el papel se ve amarillo y se confundía con piel.
   2) Se prueban varias "vistas" de la foto y varios umbrales:
      · brillo · "blancura" (brillo menos color: separa el papel de mesas beige o manteles de colores)
      · diferencia con el color del borde de la foto (el fondo)
   3) Se elige la segmentación con mejor calidad: forma de cuadrilátero × contraste entre papel y fondo. */
const _detCanvas = document.createElement('canvas');
function sReadSmall(source, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(16, Math.round(sw * k)), h = Math.max(16, Math.round(sh * k)), n = w * h;
  _detCanvas.width = w; _detCanvas.height = h;
  const ctx = _detCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { d: ctx.getImageData(0, 0, w, h).data, w, h, n, k };
}
// Ganancias de balance de blancos a partir de lo más claro (normalmente el papel)
function sWhiteGains(d, n) {
  // percentil 88 del brillo con un histograma (rápido aunque la foto sea grande)
  const hist = new Uint32Array(766); let m5 = 0;
  for (let i = 0; i < n; i += 5) { hist[d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]]++; m5++; }
  let t = 765; for (let v = 0, acc = 0; v < 766; v++) { acc += hist[v]; if (acc > m5 * 0.88) { t = v; break; } }
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const L = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; if (L >= t && L < 760) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; c++; } }
  if (!c) return [1, 1, 1];
  const m = (r + g + b) / 3 / c, cl = v => Math.max(0.7, Math.min(2.2, v));
  return [cl(m / (r / c)), cl(m / (g / c)), cl(m / (b / c))];
}
function sFeatures(d, w, h, gains) {
  const n = w * h, gray = new Float32Array(n), white = new Float32Array(n), skin = new Uint8Array(n), R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, d[i * 4] * gains[0]), g = Math.min(255, d[i * 4 + 1] * gains[1]), b = Math.min(255, d[i * 4 + 2] * gains[2]);
    R[i] = r; G[i] = g; B[i] = b;
    const y = 0.299 * r + 0.587 * g + 0.114 * b; gray[i] = y;
    white[i] = Math.max(0, y - 1.3 * (Math.max(r, g, b) - Math.min(r, g, b)));
    skin[i] = sIsSkin(r, g, b) ? 1 : 0;
  }
  // color típico del borde de la foto (el fondo)
  const br = [], bgc = [], bb = [];
  const addB = i => { br.push(R[i]); bgc.push(G[i]); bb.push(B[i]); };
  for (let x = 0; x < w; x += 2) { addB(x); addB((h - 1) * w + x); } for (let y = 0; y < h; y += 2) { addB(y * w); addB(y * w + w - 1); }
  const med = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const mr = med(br), mg = med(bgc), mb = med(bb), diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = Math.min(255, Math.hypot(R[i] - mr, G[i] - mg, B[i] - mb));
  return { gray, white, diff, skin };
}
// Umbral → mayor región conectada (sin piel), cerrada y sin huecos
function sSegment(F, thr, skin, w, h, rc, blurR) {
  const n = w * h, Fb = blurR ? sBoxBlur(F, w, h, blurR) : F;
  let m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = Fb[i] > thr && !skin[i] ? 1 : 0;
  m = sMorph(sMorph(m, w, h, rc, true), w, h, rc, false);
  const lab = new Int32Array(n), stack = new Int32Array(n);
  let bestId = 0, bestArea = 0, id = 0;
  for (let s = 0; s < n; s++) {
    if (!m[s] || lab[s]) continue;
    id++; let sp = 0, area = 0; stack[sp++] = s; lab[s] = id;
    while (sp) { const p = stack[--sp]; area++; const x = p % w, y = (p / w) | 0;
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; } }
    if (area > bestArea) { bestArea = area; bestId = id; }
  }
  const pm = new Uint8Array(n); if (!bestId) return { pm, area: 0, touch: 0, Fb };
  for (let p = 0; p < n; p++) if (lab[p] === bestId) pm[p] = 1;
  // huecos (texto, sombras dentro del papel): todo lo que no se alcanza desde el marco por fuera del papel
  const out = new Uint8Array(n); let sp = 0;
  const seed = q => { if (!pm[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp) { const p = stack[--sp], x = p % w, y = (p / w) | 0;
    if (x > 0) seed(p - 1); if (x < w - 1) seed(p + 1); if (y > 0) seed(p - w); if (y < h - 1) seed(p + w); }
  let area = 0, touch = 0;
  for (let p = 0; p < n; p++) { pm[p] = out[p] ? 0 : 1; if (pm[p]) { area++; const x = p % w, y = (p / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch++; } }
  return { pm, area, touch, Fb };
}
// Esquinas: puntos extremos del contorno en 16 direcciones → cuadrilátero de mayor área
function sQuadFromMask(pm, w, h) {
  const dirs = []; for (let a = 0; a < 16; a++) { const th = a * Math.PI / 8; dirs.push([Math.cos(th), Math.sin(th)]); }
  const best = dirs.map(() => ({ v: -Infinity, p: null }));
  for (let p = 0; p < pm.length; p++) {
    if (!pm[p]) continue; const x = p % w, y = (p / w) | 0;
    if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && pm[p - 1] && pm[p + 1] && pm[p - w] && pm[p + w]) continue;
    for (let j = 0; j < 16; j++) { const v = x * dirs[j][0] + y * dirs[j][1]; if (v > best[j].v) { best[j].v = v; best[j].p = [x + 0.5, y + 0.5]; } }
  }
  const cand = best.map(b => b.p); if (cand.some(c => !c)) return null;
  let bq = null, ba = -1;
  for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) for (let c = b + 1; c < 16; c++) for (let e = c + 1; e < 16; e++) {
    const q = [cand[a], cand[b], cand[c], cand[e]], ar = sPolyArea(q); if (ar > ba) { ba = ar; bq = q; }
  }
  const cx = bq.reduce((s, p) => s + p[0], 0) / 4, cy = bq.reduce((s, p) => s + p[1], 0) / 4;
  bq.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let st = 0, sb = Infinity; bq.forEach((p, i) => { const s = p[0] + p[1]; if (s < sb) { sb = s; st = i; } });
  return { q: [0, 1, 2, 3].map(i => bq[(st + i) % 4]), area: ba };
}
// Contraste papel/fondo: media del papel (sin su orilla) contra una franja justo afuera, en la vista usada
function sSeparation(Fb, pm, w, h, range) {
  const n = w * h, rr = Math.max(2, Math.round(Math.min(w, h) * 0.02)), pf = Float32Array.from(pm);
  const ero = sMorph(pf, w, h, rr, false), dil = sMorph(pf, w, h, rr * 2, true);
  let si = 0, ci = 0, so = 0, co = 0;
  for (let p = 0; p < n; p++) { if (ero[p]) { si += Fb[p]; ci++; } else if (dil[p] && !pm[p]) { so += Fb[p]; co++; } }
  if (!ci || !co) return 0;
  return (si / ci - so / co) / Math.max(10, range);
}
// Nitidez del borde: cambio de brillo promedio justo en el contorno (un borde de papel es un salto; la luz desigual es gradual)
function sEdgeSharpness(Fb, pm, w, h, range) {
  let s = 0, c = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const p = y * w + x; if (!pm[p]) continue;
    if (pm[p - 1] && pm[p + 1] && pm[p - w] && pm[p + w]) continue;
    const gx = Fb[p + 2] - Fb[p - 2], gy = Fb[p + 2 * w] - Fb[p - 2 * w]; s += Math.hypot(gx, gy) / 4; c++;
  }
  return c ? s / c / Math.max(10, range) : 0;
}
function sEvalSeg(seg, w, h, range) {
  const n = w * h;
  if (!seg.area || seg.area < n * 0.04 || seg.area > n * 0.93) return { quality: 0 };
  if (seg.touch > (w + h) * 1.2) return { quality: 0 }; // toca casi todo el marco
  const qd = sQuadFromMask(seg.pm, w, h); if (!qd) return { quality: 0 };
  const rect = Math.min(1, seg.area / qd.area), sep = sSeparation(seg.Fb, seg.pm, w, h, range), sharp = sEdgeSharpness(seg.Fb, seg.pm, w, h, range);
  // contraste y nitidez mínimos: con la hoja llenando la foto o con luz desigual no hay borde real
  const quality = rect * Math.max(0, Math.min(1, (sep - 0.28) / 0.17)) * Math.max(0, Math.min(1, (sharp - 0.04) / 0.035)) * (seg.area > n * 0.85 ? 0.7 : 1);
  return { quality, rect, sep, sharp, qd };
}
const _vlist = ['white', 'gray', 'diff'];
/* ---------- Detección del papel por su texto + inundación (watershed) ----------
   Pensada para tirillas sostenidas en la mano, sobre paredes blancas, mesas claras, madera o ropa:
   1) Se busca dónde hay texto impreso: trazos oscuros y finos sobre fondo claro y poco saturado
      (en la pared, la madera, la ropa o la piel no hay eso). Esa zona es "papel seguro".
   2) "Fondo seguro": el borde de la foto lejos del texto, la piel (dedos, palma) y lo muy saturado u oscuro.
   3) Desde ambas semillas se inunda la imagen por orden de intensidad del borde: la frontera queda en el
      contorno real del papel aunque el papel y la pared sean casi del mismo blanco. */
function sIsWarm(r, g, b) { return r > g && g >= b && r - b > 30 && r > 70 && r < 250 && (r - b) / r > 0.14; }
function sWatershed(G, w, h, lab) {
  const n = w * h, buckets = Array.from({ length: 256 }, () => []), inq = new Uint8Array(n), nq = new Int32Array(4);
  const nb = p => { const x = p % w; let k = 0; if (x > 0) nq[k++] = p - 1; if (x < w - 1) nq[k++] = p + 1; if (p >= w) nq[k++] = p - w; if (p < n - w) nq[k++] = p + w; return k; };
  for (let p = 0; p < n; p++) if (lab[p]) { const k = nb(p); for (let j = 0; j < k; j++) { const q = nq[j]; if (!lab[q] && !inq[q]) { inq[q] = 1; buckets[G[q]].push(q); } } }
  for (let lv = 0; lv < 256; lv++) {
    const bk = buckets[lv];
    for (let i = 0; i < bk.length; i++) {
      const p = bk[i]; let l = 0, k = nb(p);
      for (let j = 0; j < k; j++) if (lab[nq[j]]) { l = lab[nq[j]]; break; }
      lab[p] = l || 2;
      k = nb(p);
      for (let j = 0; j < k; j++) { const q = nq[j]; if (!lab[q] && !inq[q]) { inq[q] = 1; const g = G[q]; (g < lv ? bk : buckets[g]).push(q); } }
    }
    buckets[lv] = null;
  }
  return lab;
}
function sSegmentWS(source, sw, sh, side) {
  const S = sReadSmall(source, sw, sh, side || 640), { d, w, h, n } = S, gains = sWhiteGains(d, n);
  const L = new Float32Array(n), sat = new Float32Array(n), skin = new Uint8Array(n), Rc = new Float32Array(n), Bc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, d[i * 4] * gains[0]), g = Math.min(255, d[i * 4 + 1] * gains[1]), b = Math.min(255, d[i * 4 + 2] * gains[2]);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b; sat[i] = mx > 0 ? (mx - mn) / mx : 0; Rc[i] = r - g; Bc[i] = (r + g) / 2 - b;
    skin[i] = sIsSkin(r, g, b) || sIsWarm(r, g, b) ? 1 : 0;
  }
  // 1) Trazos de texto: "sombrero negro" (cierre − imagen) sobre fondo claro y neutro
  const r1 = Math.max(2, Math.round(w / 170));
  const clo = sMorph(sMorph(L, w, h, r1, true), w, h, r1, false);
  const satB = sBoxBlur(sat, w, h, Math.max(2, r1 * 2));
  const stroke = new Float32Array(n);
  for (let i = 0; i < n; i++) stroke[i] = (clo[i] - L[i] > 16 && clo[i] > 105 && satB[i] < 0.22 && !skin[i]) ? 1 : 0;
  // Las líneas largas y finas no son letras: ranuras y manijas de muebles, bordes de baldosas, vetas
  {
    // tramos rectos horizontales o verticales más largos que cualquier palabra (aunque toquen el papel)
    const Lh = Math.max(24, Math.round(w * 0.05)), cutM = new Uint8Array(n);
    for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x <= w; x++) { if (x < w && stroke[y * w + x]) r++; else { if (r >= Lh) for (let k = x - r; k < x; k++) cutM[y * w + k] = 1; r = 0; } } }
    for (let x = 0; x < w; x++) { let r = 0; for (let y = 0; y <= h; y++) { if (y < h && stroke[y * w + x]) r++; else { if (r >= Lh) for (let k = y - r; k < y; k++) cutM[k * w + x] = 1; r = 0; } } }
    for (let i = 0; i < n; i++) if (cutM[i]) stroke[i] = 0;
    const sm = new Uint8Array(n); for (let i = 0; i < n; i++) sm[i] = stroke[i] ? 1 : 0;
    const { lab: sl, C: sc } = sComponents(sm, w, h, stroke), drop = new Uint8Array(sc.length + 1), lim = Math.max(28, w * 0.06);
    for (const c of sc) { const long = Math.max(c.w, c.h); if (long > lim && (c.area / long < 3.2 || c.major > 7 * Math.max(1, c.minor))) drop[c.id] = 1; }
    for (let i = 0; i < n; i++) if (sl[i] && drop[sl[i]]) stroke[i] = 0;
  }
  const R = Math.max(6, Math.round(w / 40));
  const dens = sBoxBlur(stroke, w, h, R);
  // zona de texto más fuerte (componente con más "tinta")
  const lab0 = new Int32Array(n), stack = new Int32Array(n); let best = 0, bestScore = 0, id = 0; const scores = [0], boxes = [null];
  for (let s = 0; s < n; s++) {
    if (lab0[s] || dens[s] < 0.045) continue;
    id++; let sp = 0, sc = 0; stack[sp++] = s; lab0[s] = id; const bx = [w, h, 0, 0];
    while (sp) { const p = stack[--sp]; sc += dens[p]; const x = p % w, y = (p / w) | 0; if (x < bx[0]) bx[0] = x; if (y < bx[1]) bx[1] = y; if (x > bx[2]) bx[2] = x; if (y > bx[3]) bx[3] = y;
      if (x > 0 && !lab0[p - 1] && dens[p - 1] >= 0.045) { lab0[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && !lab0[p + 1] && dens[p + 1] >= 0.045) { lab0[p + 1] = id; stack[sp++] = p + 1; }
      if (p >= w && !lab0[p - w] && dens[p - w] >= 0.045) { lab0[p - w] = id; stack[sp++] = p - w; }
      if (p < n - w && !lab0[p + w] && dens[p + w] >= 0.045) { lab0[p + w] = id; stack[sp++] = p + w; } }
    scores.push(sc); boxes.push(bx); if (sc > bestScore) { bestScore = sc; best = id; }
  }
  if (!best || bestScore < n * 0.004) return null; // no hay texto suficiente: que decida el método clásico
  // Otros bloques de texto alineados con el principal (encabezado separado por un renglón en blanco, pie de página)
  const keep = new Uint8Array(id + 1); keep[best] = 1;
  const mb = boxes[best], mh = mb[3] - mb[1] + 1;
  for (let k = 1; k <= id; k++) {
    if (k === best || scores[k] < bestScore * 0.04) continue;
    const b = boxes[k], ov = Math.min(b[2], mb[2]) - Math.max(b[0], mb[0]), wmin = Math.min(b[2] - b[0], mb[2] - mb[0]) + 1;
    const gap = Math.max(0, b[1] - mb[3], mb[1] - b[3]);
    if (ov >= wmin * 0.5 && gap <= Math.max(R * 3, mh * 0.3)) keep[k] = 1;
  }
  const blob = new Float32Array(n); let blobA = 0; for (let i = 0; i < n; i++) if (keep[lab0[i]]) { blob[i] = 1; blobA++; }
  const seedP = sMorph(blob, w, h, Math.round(R * 0.9), false);      // papel seguro (dentro del texto)
  const nearP = sMorph(blob, w, h, Math.round(R * 3), true);          // zona donde el borde de la foto puede ser papel
  // 2) Fondo seguro
  const lab = new Uint8Array(n);
  const skinE = sMorph(Float32Array.from(skin), w, h, 2, false);
  const satE = new Float32Array(n); for (let i = 0; i < n; i++) satE[i] = (sat[i] > 0.42 || L[i] < 45) ? 1 : 0;
  const satEE = sMorph(satE, w, h, 2, false);
  for (let i = 0; i < n; i++) { if (skinE[i] || (satEE[i] && !nearP[i])) lab[i] = 2; }
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const p = y * w + x; if (!nearP[p]) lab[p] = 2; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const p = y * w + x; if (!nearP[p]) lab[p] = 2; }
  let seedA = 0; for (let i = 0; i < n; i++) if (seedP[i] && !skin[i]) { lab[i] = 1; seedA++; }
  if (seedA < 20) return null;
  const labS = lab.slice();
  // 3) Intensidad de borde (brillo + color) sobre la imagen suavizada
  const Lb = sBoxBlur(L, w, h, 1), Rb = sBoxBlur(Rc, w, h, 1), Bb = sBoxBlur(Bc, w, h, 1), G = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = (a, k) => a[k + 1] - a[k - 1], gy = (a, k) => a[k + w] - a[k - w];
    const gl = Math.hypot(gx(Lb, p), gy(Lb, p)), gc = Math.hypot(gx(Rb, p), gy(Rb, p)) + Math.hypot(gx(Bb, p), gy(Bb, p));
    G[p] = Math.min(255, Math.round((gl + 0.8 * gc) * 2));
  }
  const flood = lab => {
  sWatershed(G, w, h, lab);
  // papel = etiqueta 1; se rellenan huecos (logos de color, sellos) y se queda el componente principal
  const pm = new Uint8Array(n); for (let i = 0; i < n; i++) pm[i] = lab[i] === 1 ? 1 : 0;
  const hole = new Int32Array(n); let hid = 0;
  for (let s = 0; s < n; s++) {
    if (pm[s] || hole[s]) continue;
    hid++; let sp = 0, touch = false, sk = 0; const px = []; stack[sp++] = s; hole[s] = hid;
    while (sp) { const p = stack[--sp]; px.push(p); const x = p % w, y = (p / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true; if (skin[p]) sk++;
      if (x > 0 && !pm[p - 1] && !hole[p - 1]) { hole[p - 1] = hid; stack[sp++] = p - 1; }
      if (x < w - 1 && !pm[p + 1] && !hole[p + 1]) { hole[p + 1] = hid; stack[sp++] = p + 1; }
      if (y > 0 && !pm[p - w] && !hole[p - w]) { hole[p - w] = hid; stack[sp++] = p - w; }
      if (y < h - 1 && !pm[p + w] && !hole[p + w]) { hole[p + w] = hid; stack[sp++] = p + w; } }
    if (!touch && sk < px.length * 0.5) for (const p of px) pm[p] = 1;
  }
  // suavizado leve (quita hilos de unión con el fondo)
  const pmo = sMorph(sMorph(Float32Array.from(pm), w, h, 1, false), w, h, 1, true);
  const comp = new Int32Array(n); let cbest = 0, cbestA = 0, cid = 0;
  for (let s = 0; s < n; s++) {
    if (!pmo[s] || comp[s]) continue;
    cid++; let sp = 0, a = 0, hasSeed = 0; stack[sp++] = s; comp[s] = cid;
    while (sp) { const p = stack[--sp]; a++; if (seedP[p]) hasSeed++; const x = p % w;
      if (x > 0 && pmo[p - 1] && !comp[p - 1]) { comp[p - 1] = cid; stack[sp++] = p - 1; }
      if (x < w - 1 && pmo[p + 1] && !comp[p + 1]) { comp[p + 1] = cid; stack[sp++] = p + 1; }
      if (p >= w && pmo[p - w] && !comp[p - w]) { comp[p - w] = cid; stack[sp++] = p - w; }
      if (p < n - w && pmo[p + w] && !comp[p + w]) { comp[p + w] = cid; stack[sp++] = p + w; } }
    if (hasSeed && a > cbestA) { cbestA = a; cbest = cid; }
  }
  if (!cbest) return null;
  const mask = new Uint8Array(n); let area = 0; for (let i = 0; i < n; i++) if (comp[i] === cbest) { mask[i] = 1; area++; }
  return { mask, area };
  };
  // Lejos del texto no hay papel: si el papel "se derramó" sobre un mueble o una pared blanca pegada a la tirilla
  // (mucho más grande que el rectángulo del texto), se repite con el papel limitado a un margen alrededor del texto.
  const br = sMinRectQuad(blob, w, h);
  if (typeof window !== 'undefined' && window.__wsDebug) Object.assign(window.__wsDebug, { blob: Uint8Array.from(blob), br, w, h });
  let res = flood(labS.slice());
  if (!res) return null;
  if (br) {
    const [p0, p1, , p3] = br.q, ax = [p1[0] - p0[0], p1[1] - p0[1]], ay = [p3[0] - p0[0], p3[1] - p0[1]];
    const la = Math.hypot(ax[0], ax[1]) || 1, lb = Math.hypot(ay[0], ay[1]) || 1, ua = [ax[0] / la, ax[1] / la], ub = [ay[0] / lb, ay[1] / lb];
    // a los lados de los renglones el papel casi no tiene margen; arriba y abajo un poco más (logo, corte)
    const sh = Math.min(la, lb), shortA = la <= lb, ma = (shortA ? 0.1 : 0.28) * sh + R * 1.5, mb = (shortA ? 0.28 : 0.1) * sh + R * 1.5;
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - p0[0], dy = y - p0[1], a = dx * ua[0] + dy * ua[1], b = dx * ub[0] + dy * ub[1];
      if (a < -ma || a > la + ma || b < -mb || b > lb + mb) out[y * w + x] = 1;
    }
    // ¿lo que quedó por fuera es papel con letras (tirilla larga, parte arrugada) o un mueble/pared casi vacío?
    let ext = 0, dExt = 0, dBlob = 0; for (let i = 0; i < n; i++) { if (res.mask[i] && out[i]) { ext++; dExt += dens[i]; } if (blob[i]) dBlob += dens[i]; }
    const zone = (la + 2 * ma) * (lb + 2 * mb);
    if (ext > zone * 0.12 && dExt / ext < 0.3 * dBlob / Math.max(1, blobA)) {
      const lab2 = labS.slice();
      for (let i = 0; i < n; i++) if (out[i] && lab2[i] !== 1) lab2[i] = 2;
      const r2 = flood(lab2); if (r2 && r2.area > blobA * 0.6) res = r2;
    }
  }
  const { mask, area } = res;
  return { pm: mask, w, h, k: S.k, area, F: Lb, blobA, seedA };
}
// Rectángulo de área mínima que envuelve el papel (no se deja engañar por mordidas de dedos ni sombras)
function sMinRectQuad(pm, w, h) {
  const pts = [];
  for (let y = 0; y < h; y += 2) { let x0 = -1, x1 = -1; for (let x = 0; x < w; x++) if (pm[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; } if (x0 >= 0) { pts.push([x0, y], [x1 + 1, y]); } }
  if (pts.length < 6) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of hull) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const ar = (u1 - u0) * (v1 - v0); if (!best || ar < best.ar) best = { ar, ux, uy, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uy, u0, u1, v0, v1 } = best, P = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  q.sort((p, r) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(r[1] - cy, r[0] - cx));
  let st = 0, sb = Infinity; q.forEach((p, i) => { const s = p[0] + p[1]; if (s < sb) { sb = s; st = i; } });
  const qq = [0, 1, 2, 3].map(i => q[(st + i) % 4]);
  return { q: qq, area: sPolyArea(qq) };
}
function sDetectWS(source, sw, sh, side) {
  const seg = sSegmentWS(source, sw, sh, side); if (!seg) return null;
  const { pm, w, h, k, area } = seg;
  if (area < w * h * 0.02) return null;
  let qd = sQuadFromMask(pm, w, h); if (!qd) return null;
  let byLines = false;
  const mr = sMinRectQuad(pm, w, h);
  // rectas por cada lado partiendo del rectángulo mínimo; una segunda pasada con las esquinas ya corregidas
  let lq = mr ? sQuadLines(pm, w, h, mr.q) : null; if (lq) lq = sQuadLines(pm, w, h, lq.q) || lq;
  if (!lq) lq = sQuadLines(pm, w, h, qd.q);
  if (lq && area / lq.area >= 0.78 && lq.area >= area * 0.97) { qd = lq; byLines = true; }
  else if (mr && area / mr.area >= 0.8) qd = mr;
  const quad = qd.q.map(([x, y]) => [x / k, y / k]), rect = Math.min(1, area / qd.area);
  return { quad, byLines, score: Math.max(0.65, rect), cover: area / (w * h), edgeRatio: 1, view: 'ws', mask: { m: pm, w, h, k, F: seg.F } };
}
/* Esquinas por rectas (como los escáneres de Adobe y Samsung): cada lado del papel se ajusta como una recta
   usando solo la parte del borde que se ve bien (RANSAC), y las esquinas son los cruces de esas rectas.
   Así una esquina en sombra, doblada o tapada por un dedo no deforma el recorte. */
function sQuadLines(pm, w, h, q0) {
  const bd = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (pm[p] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !pm[p - 1] || !pm[p + 1] || !pm[p - w] || !pm[p + w])) bd.push(x + 0.5, y + 0.5); }
  if (bd.length < 80) return null;
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const A = q0[s], B = q0[(s + 1) % 4], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy); if (L < 10) return null;
    const ux = dx / L, uy = dy / L, tol = Math.max(3, L * 0.09), pts = [];
    for (let i = 0; i < bd.length; i += 2) { const px = bd[i] - A[0], py = bd[i + 1] - A[1], t = (px * ux + py * uy) / L, dn = Math.abs(px * uy - py * ux); if (t > 0.04 && t < 0.96 && dn < tol) pts.push([bd[i], bd[i + 1]]); }
    if (pts.length < 12) return null;
    const inl = Math.max(1.2, L * 0.006);
    let best = null, bestN = -1, seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let it = 0; it < 160; it++) {
      const a = pts[(rnd() * pts.length) | 0], b = pts[(rnd() * pts.length) | 0]; const ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey);
      if (el < L * 0.15) continue;
      if (Math.abs((ex * ux + ey * uy) / el) < 0.9) continue; // casi paralela al lado esperado
      const nx = -ey / el, ny = ex / el; let c = 0; for (const p of pts) if (Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) < inl) c++;
      if (c > bestN) { bestN = c; best = { a, nx, ny }; }
    }
    if (!best || bestN < pts.length * 0.35) return null;
    // Ajuste por mínimos cuadrados (recta total) sobre los puntos que coinciden
    const ins = pts.filter(p => Math.abs((p[0] - best.a[0]) * best.nx + (p[1] - best.a[1]) * best.ny) < inl * 1.5);
    let mx = 0, my = 0; for (const p of ins) { mx += p[0]; my += p[1]; } mx /= ins.length; my /= ins.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of ins) { const a = p[0] - mx, b = p[1] - my; sxx += a * a; syy += b * b; sxy += a * b; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); lines.push({ x: mx, y: my, dx: Math.cos(th), dy: Math.sin(th) });
  }
  const cross = (l1, l2) => { const den = l1.dx * l2.dy - l1.dy * l2.dx; if (Math.abs(den) < 1e-6) return null; const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / den; return [l1.x + l1.dx * t, l1.y + l1.dy * t]; };
  // Si un lado es el borde de la foto (la tirilla sigue por fuera), ese lado se traza paralelo al lado opuesto
  // por el punto de papel visible más lejano: así el recorte no tuerce los renglones de una tirilla inclinada.
  let cut = false;
  for (let s = 0; s < 4; s++) {
    const l = lines[s], onB = (Math.abs(l.dy) < 0.02 && (l.y < 2 || l.y > h - 3)) || (Math.abs(l.dx) < 0.02 && (l.x < 2 || l.x > w - 3));
    if (!onB) continue;
    // dirección: perpendicular al promedio de los dos lados largos vecinos (más confiables que el borde opuesto)
    const a1 = lines[(s + 1) % 4], a2 = lines[(s + 3) % 4];
    let mx = a1.dx + (a1.dx * a2.dx + a1.dy * a2.dy >= 0 ? a2.dx : -a2.dx), my = a1.dy + (a1.dx * a2.dx + a1.dy * a2.dy >= 0 ? a2.dy : -a2.dy);
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const dx = -my, dy = mx, o = lines[(s + 2) % 4];
    let nx = mx, ny = my; const sg = ((l.x - o.x) * nx + (l.y - o.y) * ny) >= 0 ? 1 : -1; nx *= sg; ny *= sg;
    let far = -1e9, fp = null;
    for (let i = 0; i < bd.length; i += 2) { const dd = (bd[i] - o.x) * nx + (bd[i + 1] - o.y) * ny; if (dd > far) { far = dd; fp = [bd[i], bd[i + 1]]; } }
    if (fp) { lines[s] = { x: fp[0], y: fp[1], dx, dy }; cut = true; }
  }
  const q = [0, 1, 2, 3].map(i => cross(lines[(i + 3) % 4], lines[i]));
  if (q.some(p => !p || p[0] < -w * (cut ? 0.6 : 0.08) || p[1] < -h * (cut ? 0.6 : 0.08) || p[0] > w * (cut ? 1.6 : 1.08) || p[1] > h * (cut ? 1.6 : 1.08))) return null;
  // convexo y con la misma orientación que el original
  const crossZ = i => { const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); };
  const sg = Math.sign(crossZ(0)); if ([1, 2, 3].some(i => Math.sign(crossZ(i)) !== sg)) return null;
  return { q, area: sPolyArea(q) };
}
function scanDetect(source, sw, sh, maxSide) {
  maxSide = maxSide || 360;
  if (maxSide > 360) { const ws = sDetectWS(source, sw, sh); if (ws) return ws; } // foto: primero el método por texto
  // Paso 1: elegir vista y umbral a baja resolución
  const S = sReadSmall(source, sw, sh, 360), gains = sWhiteGains(S.d, S.n), Fs = sFeatures(S.d, S.w, S.h, gains);
  const sc0 = S.w / 360, rc0 = Math.max(2, Math.round(2 * sc0)), bl0 = Math.max(1, Math.round(2 * sc0));
  const cands = [];
  for (const vname of _vlist) {
    const F = Fs[vname], Fb = sBoxBlur(F, S.w, S.h, bl0);
    const hist = new Uint32Array(256); for (let i = 0; i < S.n; i++) hist[Math.max(0, Math.min(255, Fb[i] | 0))]++;
    const sv = Array.from(Fb.filter((_, i) => !(i % 7))).sort((a, b) => a - b), range = sv[Math.floor(sv.length * 0.97)] - sv[Math.floor(sv.length * 0.03)];
    const t = sOtsu(hist, S.n);
    let s0 = 0, c0 = 0, s1 = 0, c1 = 0; for (let i = 0; i < 256; i++) { if (i <= t) { s0 += i * hist[i]; c0 += hist[i]; } else { s1 += i * hist[i]; c1 += hist[i]; } }
    const mu0 = c0 ? s0 / c0 : 0, mu1 = c1 ? s1 / c1 : 255;
    const thrs = [t, mu0 + 0.3 * (mu1 - mu0)];
    if (vname === 'gray') thrs.push(Math.pow(Math.max(8, mu0), 0.7) * Math.pow(mu1, 0.3)); // sombras profundas
    for (const thr of thrs) {
      if (!(thr > 0)) continue;
      const seg = sSegment(F, thr, Fs.skin, S.w, S.h, rc0, bl0), ev = sEvalSeg(seg, S.w, S.h, range);
      if (ev.quality > 0) cands.push({ vname, thr, seg, ev, range });
    }
  }
  if (!cands.length) return null;
  // Entre las de calidad casi máxima se elige la que abarca más papel (no deja por fuera la parte en sombra)
  const top = cands.reduce((a, b) => (b.ev.quality > a.ev.quality ? b : a));
  let best = top;
  for (const c of cands.slice().sort((a, b) => a.seg.area - b.seg.area)) if (c.ev.quality >= top.ev.quality - 0.05 && c.ev.rect >= top.ev.rect - 0.03 && c.seg.touch <= top.seg.touch + 2 && c.seg.area > best.seg.area * 1.04 && c.seg.area <= top.seg.area * 1.5) best = c;
  // Paso 2: misma vista y umbral a la resolución pedida (máscara más fina para medir bordes curvos)
  let w = S.w, h = S.h, k = S.k, seg = best.seg, qd = best.ev.qd;
  if (maxSide > 360) {
    const B = sReadSmall(source, sw, sh, maxSide), FB = sFeatures(B.d, B.w, B.h, gains), sc = B.w / 360;
    const s2 = sSegment(FB[best.vname], best.thr, FB.skin, B.w, B.h, Math.max(2, Math.round(2 * sc)), Math.max(1, Math.round(2 * sc)));
    const q2 = s2.area ? sQuadFromMask(s2.pm, B.w, B.h) : null;
    const expA = seg.area * (B.n / S.n);
    if (q2 && s2.area > expA * 0.8 && s2.area < expA * 1.2) { w = B.w; h = B.h; k = B.k; seg = s2; qd = q2; }
  }
  // Esquinas por cruce de rectas cuando el papel tiene una esquina mordida (sombra, doblez, dedo)
  const lq = sQuadLines(seg.pm, w, h, qd.q);
  let byLines = false;
  if (lq && lq.area >= qd.area * 0.97 && lq.area <= seg.area * 1.35) { qd = lq; byLines = true; }
  const quad = qd.q.map(([x, y]) => [x / k, y / k]), n = w * h;
  const cover = seg.area / n, rect = Math.min(1, seg.area / qd.area);
  return { quad, byLines, score: rect * Math.min(1, best.ev.quality / Math.max(0.01, best.ev.rect) + 0.15), cover, edgeRatio: best.ev.sep, view: best.vname, mask: { m: seg.pm, w, h, k, F: seg.Fb } };
}
function scanFullQuad(w, h) { const m = Math.min(w, h) * 0.01; return [[m, m], [w - m, m], [w - m, h - m], [m, h - m]]; } // sin bordes visibles: toda la foto
function scanDefaultQuad(w, h) { const mx = w * 0.06, my = h * 0.06; return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]]; }

// Homografía: lleva src (4 puntos) a dst (4 puntos)
function sHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / A[i][i]);
}
const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
function sApplyH(H, x, y) { const z = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z]; }

/* Bordes curvos. La factura se describe con sus 4 esquinas (homografía) más cuánto se desvía cada borde
   de la línea recta, medido en el plano "enderezado" (0..1). curve = { t, r, b, l } con CURVE_N muestras.
   top: y = t[i]   right: x = 1 + r[i]   bottom: y = 1 + b[i]   left: x = l[i]   (i recorre el borde de 0 a 1) */
const CURVE_N = 33;
function curveZero() { const z = () => new Array(CURVE_N).fill(0); return { t: z(), r: z(), b: z(), l: z() }; }
function curveSample(arr, s) { const f = Math.max(0, Math.min(1, s)) * (CURVE_N - 1), i = Math.min(CURVE_N - 2, Math.floor(f)), a = f - i; return arr[i] * (1 - a) + arr[i + 1] * a; }
// Punto (u, v) del plano enderezado → posición dentro del contorno curvo (parche de Coons)
function coons(curve, u, v) {
  return [u + (1 - u) * curveSample(curve.l, v) + u * curveSample(curve.r, v), v + (1 - v) * curveSample(curve.t, u) + v * curveSample(curve.b, u)];
}
// Mide los bordes reales sobre la máscara del papel (rayos desde afuera hacia adentro)
function scanCurve(det) { return scanRefine(det).curve; }
// Mide los bordes reales: rayos desde afuera hacia adentro sobre la máscara del papel; luego cada punto se
// "pega" al cambio de brillo más fuerte cercano (borde verdadero, más preciso que la máscara).
// Primera pasada: corrige las esquinas con lo medido. Segunda: mide la curvatura respecto a las esquinas nuevas.
function scanRefine(det) {
  if (!det || !det.mask) return { quad: det ? det.quad : null, curve: curveZero() };
  const { m, w, h, k, F } = det.mask;
  const R = 0.18, steps = 120, stepO = 2 * R / steps;
  const pass = (quad, pin) => {
    const c = curveZero(), H = sHomography(UNIT, quad);
    const toPx = (u, v) => { const [x, y] = sApplyH(H, u, v); return [x * k - 0.5, y * k - 0.5]; };
    const at = (u, v) => { const [x, y] = toPx(u, v), px = Math.round(x), py = Math.round(y); return px >= 0 && py >= 0 && px < w && py < h ? m[py * w + px] : 0; };
    const fAt = (u, v) => { const [x, y] = toPx(u, v); if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN; const x0 = x | 0, y0 = y | 0, ax = x - x0, ay = y - y0, i = y0 * w + x0; return (F[i] * (1 - ax) + F[i + 1] * ax) * (1 - ay) + (F[i + w] * (1 - ax) + F[i + w + 1] * ax) * ay; };
    const measure = (pt, dir) => {
      const out = [];
      for (let i = 0; i < CURVE_N; i++) {
        const s = i / (CURVE_N - 1); let j0 = -1;
        for (let j = 0; j <= steps; j++) { const o = dir * (-R + stepO * j); const [u, v] = pt(s, o); if (at(u, v)) { j0 = j; break; } }
        if (j0 < 0) { out.push(NaN); continue; }
        let bj = j0, bd = 0;
        if (F) for (let j = Math.max(2, j0 - 8); j <= Math.min(steps - 2, j0 + 8); j++) {
          const [u1, v1] = pt(s, dir * (-R + stepO * (j - 2))), [u2, v2] = pt(s, dir * (-R + stepO * (j + 2)));
          const dlt = fAt(u2, v2) - fAt(u1, v1); if (dlt > bd) { bd = dlt; bj = j; }
        }
        out.push(dir * (-R + stepO * (bd > 10 ? bj : j0)));
      }
      return out;
    };
    const raw = { t: measure((s, o) => [s, o], 1), b: measure((s, o) => [s, 1 + o], -1), l: measure((s, o) => [o, s], 1), r: measure((s, o) => [1 + o, s], -1) };
    const ends = {};
    for (const key of ['t', 'r', 'b', 'l']) {
      let a = raw[key];
      const ok = a.map(v => Number.isFinite(v)); if (ok.filter(Boolean).length < CURVE_N / 3) { ends[key] = [0, 0]; continue; }
      for (let i = 0; i < CURVE_N; i++) if (!ok[i]) { let p = i - 1, q = i + 1; while (p >= 0 && !ok[p]) p--; while (q < CURVE_N && !ok[q]) q++; a[i] = p < 0 ? a[q] : q >= CURVE_N ? a[p] : a[p] + (a[q] - a[p]) * (i - p) / (q - p); }
      const med = a.map((_, i) => { const win = []; for (let j = Math.max(0, i - 3); j <= Math.min(CURVE_N - 1, i + 3); j++) win.push(a[j]); win.sort((x, y) => x - y); return win[win.length >> 1]; });
      a = med.map((v, i) => { const lo = med[Math.max(0, i - 4)], hi = med[Math.min(CURVE_N - 1, i + 4)], ref = (lo + hi) / 2; const inward = key === 't' || key === 'l' ? v - ref : ref - v; return inward > 0.025 ? ref : v; });
      const sm = a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(CURVE_N - 1, i + 2); j++) { s += a[j]; n++; } return s / n; });
      // extremos: se extrapola con una recta por las muestras 2..6 (la esquina misma suele estar redondeada)
      const ext = (i0, i1, at0) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, nn = 0; for (let i = i0; i <= i1; i++) { sx += i; sy += sm[i]; sxx += i * i; sxy += i * sm[i]; nn++; } const sl = (nn * sxy - sx * sy) / Math.max(1e-9, nn * sxx - sx * sx); return (sy - sl * sx) / nn + sl * at0; };
      ends[key] = [ext(2, 6, 0), ext(CURVE_N - 7, CURVE_N - 3, CURVE_N - 1)];
      if (pin) { const a0 = sm[0], a1 = sm[CURVE_N - 1]; c[key] = sm.map((v, i) => { const r = v - (a0 + (a1 - a0) * i / (CURVE_N - 1)); return Math.max(-0.16, Math.min(0.16, Math.abs(r) < 0.002 ? 0 : r)); }); }
    }
    return { c, ends, H };
  };
  // Si las esquinas salieron del cruce de rectas, son confiables: no se mueven hacia adentro y los bordes
  // solo pueden curvarse hacia afuera (una "mordida" de sombra o dedo no debe deformar el texto).
  if (det.byLines) {
    const c = pass(det.quad, true).c;
    for (const key of ['t', 'l']) c[key] = c[key].map(v => Math.min(0, v));
    for (const key of ['b', 'r']) c[key] = c[key].map(v => Math.max(0, v));
    return { quad: det.quad, curve: c };
  }
  const p1 = pass(det.quad, false), e = p1.ends, cl = v => Math.max(-0.06, Math.min(0.06, v));
  const nq = [[cl(e.l[0]), cl(e.t[0])], [1 + cl(e.r[0]), cl(e.t[1])], [1 + cl(e.r[1]), 1 + cl(e.b[1])], [cl(e.l[1]), 1 + cl(e.b[0])]].map(([u, v]) => sApplyH(p1.H, u, v));
  const quad = sPolyArea(nq) > sPolyArea(det.quad) * 0.8 ? nq : det.quad;
  return { quad, curve: pass(quad, true).c };
}
// Puntos del contorno (para dibujarlo) en coordenadas de la fuente
function curveOutline(quad, curve, per) {
  const H = sHomography(UNIT, quad), pts = [], N = per || 24;
  const push = (u, v) => { const [x, y] = coons(curve, u, v); pts.push(sApplyH(H, x, y)); };
  for (let i = 0; i < N; i++) push(i / N, 0);
  for (let i = 0; i < N; i++) push(1, i / N);
  for (let i = N; i > 0; i--) push(i / N, 1);
  for (let i = N; i > 0; i--) push(0, i / N);
  return pts;
}
function curveRotate(c) { // giro de 90° a la derecha (igual que scanRotate)
  const rev = a => a.slice().reverse(), neg = a => a.map(v => -v);
  return { t: rev(c.l), r: neg(c.t), b: rev(c.r), l: neg(c.b) };
}
function sCurveLen(quad, curve, edge) {
  const H = sHomography(UNIT, quad); let L = 0, prev = null;
  for (let i = 0; i <= 40; i++) { const s = i / 40, uv = edge === 't' ? [s, 0] : edge === 'b' ? [s, 1] : edge === 'l' ? [0, s] : [1, s];
    const [x, y] = coons(curve, uv[0], uv[1]), p = sApplyH(H, x, y); if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
  return L;
}
// Recorte: lleva el contorno (esquinas + bordes curvos) a un rectángulo
function scanWarp(srcCanvas, quad, maxSide, curve) {
  curve = curve || curveZero();
  let W = Math.max(sCurveLen(quad, curve, 't'), sCurveLen(quad, curve, 'b')), H = Math.max(sCurveLen(quad, curve, 'l'), sCurveLen(quad, curve, 'r'));
  const s = Math.min(1, (maxSide || 2200) / Math.max(W, H)); W = Math.max(40, Math.round(W * s)); H = Math.max(40, Math.round(H * s));
  const Hm = sHomography(UNIT, quad);
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const sd = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'); const od = octx.createImageData(W, H); const o = od.data;
  // desvíos precalculados por columna (bordes de arriba/abajo) y por fila (izquierda/derecha)
  const ct = new Float32Array(W), cb = new Float32Array(W), cl = new Float32Array(H), cr = new Float32Array(H);
  for (let u = 0; u < W; u++) { const s = (u + 0.5) / W; ct[u] = curveSample(curve.t, s); cb[u] = curveSample(curve.b, s); }
  for (let v = 0; v < H; v++) { const s = (v + 0.5) / H; cl[v] = curveSample(curve.l, s); cr[v] = curveSample(curve.r, s); }
  for (let v = 0; v < H; v++) {
    const vv = (v + 0.5) / H;
    for (let u = 0; u < W; u++) {
      const uu = (u + 0.5) / W, px = uu + (1 - uu) * cl[v] + uu * cr[v], py = vv + (1 - vv) * ct[u] + vv * cb[u];
      const z = Hm[6] * px + Hm[7] * py + 1, x = (Hm[0] * px + Hm[1] * py + Hm[2]) / z - 0.5, y = (Hm[3] * px + Hm[4] * py + Hm[5]) / z - 0.5;
      const oi = (v * W + u) * 4;
      if (x < -1 || y < -1 || x > sw || y > sh) { o[oi] = o[oi + 1] = o[oi + 2] = 250; o[oi + 3] = 255; continue; } // la tirilla sigue fuera de la foto
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(y))), fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) o[oi + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      o[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* Enderezar el texto (giro): aunque el papel quede derecho, el texto puede venir inclinado (foto ya recortada,
   tirilla mal impresa o recorte manual). Se busca el ángulo en el que los renglones dan un perfil horizontal
   más "nítido" (suma de cuadrados de la proyección) y se gira la imagen ese ángulo. */
function scanDeskew(canvas) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(1, 700 / Math.max(W, H)), w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k)), n = w * h;
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const tc = tmp.getContext('2d', { willReadFrequently: true }); tc.drawImage(canvas, 0, 0, w, h);
  const d = tc.getImageData(0, 0, w, h).data, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const bg = sBoxBlur(sMorph(g, w, h, 5, true), w, h, 6);
  const xs = [], ys = [], ws = [];
  const mg = Math.round(Math.min(w, h) * 0.03); // se ignora el borde (restos de la mesa)
  const inkM = new Float32Array(n);
  for (let y = mg; y < h - mg; y++) for (let x = mg; x < w - mg; x++) { const i = y * w + x; if (g[i] / Math.max(20, bg[i]) < 0.55) inkM[i] = 1; }
  sCleanLongStrokes(inkM, w, h); // los dobleces son líneas largas: no deben decidir el ángulo
  for (let i = 0; i < n; i++) if (inkM[i]) { xs.push((i % w) - w / 2); ys.push(((i / w) | 0) - h / 2); ws.push(1); }
  if (xs.length < 200) return { canvas, angle: 0 };
  const D = Math.ceil(Math.hypot(w, h)) + 2, prof = new Float32Array(D);
  const score = deg => {
    const a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a); prof.fill(0);
    for (let i = 0; i < xs.length; i++) { const yy = -xs[i] * s + ys[i] * c + D / 2; const y0 = Math.floor(yy), f = yy - y0; if (y0 >= 0 && y0 < D - 1) { prof[y0] += ws[i] * (1 - f); prof[y0 + 1] += ws[i] * f; } }
    let e = 0; for (let i = 0; i < D; i++) e += prof[i] * prof[i]; return e;
  };
  let best = 0, bs = score(0);
  for (let a = -20; a <= 20; a += 1) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  const b0 = best; for (let a = b0 - 1; a <= b0 + 1.001; a += 0.1) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  // solo si el ángulo da un perfil claramente mejor que sin girar
  if (Math.abs(best) < 0.35 || bs < score(0) * 1.08) return { canvas, angle: 0 };
  const a = best * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  const NW = Math.round(W * cs + H * sn), NH = Math.round(W * sn + H * cs);
  // color del papel (para rellenar las esquinas nuevas)
  const sd = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, ch = [[], [], []];
  for (let i = 0; i < W * H; i += 97) for (let c = 0; c < 3; c++) ch[c].push(sd[i * 4 + c]);
  const paper = ch.map(v => { v.sort((x, y) => x - y); return v[Math.floor(v.length * 0.9)]; });
  const out = document.createElement('canvas'); out.width = NW; out.height = NH;
  const oc = out.getContext('2d'); oc.fillStyle = `rgb(${paper.join(',')})`; oc.fillRect(0, 0, NW, NH);
  oc.imageSmoothingQuality = 'high'; oc.translate(NW / 2, NH / 2); oc.rotate(-a); oc.drawImage(canvas, -W / 2, -H / 2);
  return { canvas: out, angle: best };
}

/* Enderezar renglones: aunque el borde quede recto, un papel abombado, doblado u ondulado (en "S") deja los
   renglones curvos. Se calculan dos correcciones y se compara qué tan nítidos quedan los renglones
   (perfil horizontal de tinta) con cada una y sin ninguna; se aplica solo la que mejora:
   A) Registro por franjas: cada franja vertical se alinea con el promedio de todas (iterativo, sigue
      ondas de cualquier forma, también en S).
   B) Modelo suave (polinomio) a partir de comparar franjas vecinas: bueno para curvas amplias. */
function sInkSmall(canvas, Wd) {
  const W = canvas.width, H = canvas.height; Wd = Math.min(Wd, W);
  const f = W / Wd, Hd = Math.max(20, Math.round(H / f)), nd = Wd * Hd;
  const tmp = document.createElement('canvas'); tmp.width = Wd; tmp.height = Hd;
  const tctx = tmp.getContext('2d', { willReadFrequently: true }); tctx.drawImage(canvas, 0, 0, Wd, Hd);
  const dd = tctx.getImageData(0, 0, Wd, Hd).data, g = new Float32Array(nd);
  for (let i = 0; i < nd; i++) g[i] = 0.299 * dd[i * 4] + 0.587 * dd[i * 4 + 1] + 0.114 * dd[i * 4 + 2];
  const bg = sBoxBlur(sMorph(g, Wd, Hd, 4, true), Wd, Hd, 5);
  const ink = new Float32Array(nd); for (let i = 0; i < nd; i++) ink[i] = Math.max(0, Math.min(1, (0.78 - g[i] / Math.max(20, bg[i])) / 0.4));
  // dobleces y separadores largos no deben guiar la corrección
  const strong = new Float32Array(nd); for (let i = 0; i < nd; i++) strong[i] = ink[i] > 0.5 ? 1 : 0;
  const keep = strong.slice(); sCleanLongStrokes(keep, Wd, Hd);
  for (let i = 0; i < nd; i++) if (strong[i] && !keep[i]) ink[i] = 0;
  return { ink, Wd, Hd, f };
}
// Nitidez de renglones: con renglones rectos el perfil horizontal tiene picos altos y valles limpios
function sRowSharpness(ink, Wd, Hd, dyAt, xa = 0, xb = Wd) {
  const prof = new Float32Array(Hd + 2); let tot = 0;
  for (let y = 0; y < Hd; y++) for (let x = xa; x < xb; x++) {
    const v = ink[y * Wd + x]; if (!v) continue;
    const yy = dyAt ? y - dyAt(x, y) : y; const y0 = Math.floor(yy), fr = yy - y0; if (y0 < 0 || y0 >= Hd) continue;
    prof[y0] += v * (1 - fr); prof[y0 + 1] += v * fr; tot += v;
  }
  let e = 0; for (let y = 0; y < prof.length; y++) e += prof[y] * prof[y];
  return tot ? e / (tot * tot) * Hd : 0;
}
function scanStraighten(canvas) {
  const W = canvas.width, H = canvas.height;
  const { ink, Wd, Hd, f } = sInkSmall(canvas, 400);
  const S = 12, sw = Wd / S;
  const P = []; for (let s = 0; s < S; s++) { const x0 = Math.round(s * sw), x1 = Math.round((s + 1) * sw), p = new Float32Array(Hd);
    for (let y = 0; y < Hd; y++) { let t = 0; for (let x = x0; x < x1; x++) t += ink[y * Wd + x]; p[y] = t / (x1 - x0); }
    const q = new Float32Array(Hd); for (let y = 0; y < Hd; y++) q[y] = (p[Math.max(0, y - 1)] + 2 * p[y] + p[Math.min(Hd - 1, y + 1)]) / 4; P.push(q); }
  // interlineado por autocorrelación del perfil total
  const T = new Float32Array(Hd); P.forEach(p => { for (let y = 0; y < Hd; y++) T[y] += p[y]; });
  let mT = 0; for (let y = 0; y < Hd; y++) mT += T[y]; mT /= Hd;
  let L = Math.round(Hd / 25), bestAc = -Infinity, prevAc = Infinity, rising = false;
  for (let lag = 4; lag < Hd / 5; lag++) { let a = 0; for (let y = 0; y + lag < Hd; y++) a += (T[y] - mT) * (T[y + lag] - mT); a /= (Hd - lag);
    if (a > prevAc) rising = true; if (rising && a > bestAc) { bestAc = a; L = lag; } if (rising && a < bestAc * 0.7) break; prevAc = a; }
  L = Math.max(5, L);
  const step = Math.max(3, Math.round(L * 0.8)), half = Math.round(L * 1.6);
  const nb = Math.max(1, Math.ceil(Hd / step));
  const sampleP = (p, y) => { const y0 = Math.floor(y), fr = y - y0; if (y0 < 0 || y0 >= Hd - 1) return 0; return p[y0] * (1 - fr) + p[y0 + 1] * fr; };
  // grilla → función de desplazamiento (píxeles reducidos); nodos en centros de franja y de banda
  const gridFn = G => (x, y) => {
    const fs = Math.max(0, Math.min(S - 1.001, x / sw - 0.5)), s0 = Math.floor(fs), a = fs - s0;
    const fj = Math.max(0, Math.min(nb - 1.001, (y - step / 2) / step)), j0 = Math.floor(fj), b = fj - j0, A0 = G[j0], A1 = G[Math.min(nb - 1, j0 + 1)];
    return (A0[s0] * (1 - a) + A0[s0 + 1] * a) * (1 - b) + (A1[s0] * (1 - a) + A1[s0 + 1] * a) * b;
  };
  // energía de tinta por banda y franja
  const E = [], Emax = [];
  for (let j = 0; j < nb; j++) { const yc = j * step + step / 2, y0 = Math.max(0, Math.round(yc - half)), y1 = Math.min(Hd, Math.round(yc + half));
    const e = P.map(p => { let t = 0; for (let y = y0; y < y1; y++) t += p[y]; return t; }); E.push(e); Emax.push(Math.max(...e)); }
  const fnA = null;
  /* ---- B) modelo suave a partir de franjas vecinas ---- */
  const obs = [];
  for (let j = 0; j < nb; j++) {
    const yc = j * step + step / 2, y0 = Math.max(0, Math.round(yc - half)), y1 = Math.min(Hd, Math.round(yc + half));
    const inked = []; E[j].forEach((e, s) => { if (Emax[j] > 0.6 && e > Emax[j] * 0.2) inked.push(s); });
    for (let i = 1; i < inked.length; i++) {
      const a = inked[i - 1], b = inked[i], lm = Math.min(L * 0.7, L * 0.42 * Math.min(2, b - a));
      let best = 0, bv = -Infinity; const sc = [];
      for (let dlt = -Math.ceil(lm); dlt <= Math.ceil(lm); dlt++) {
        let num = 0, da = 0, db = 0;
        for (let y = y0; y < y1; y++) { const yb = y + dlt; if (yb < 0 || yb >= Hd) continue; num += P[a][y] * P[b][yb]; da += P[a][y] * P[a][y]; db += P[b][yb] * P[b][yb]; }
        const v = da && db ? num / Math.sqrt(da * db) : 0; sc.push(v); if (v > bv) { bv = v; best = dlt; }
      }
      if (bv < 0.5 || Math.abs(best) >= Math.ceil(lm)) continue;
      const ci = best + Math.ceil(lm); let sub = best;
      if (ci > 0 && ci < sc.length - 1) { const l = sc[ci - 1], c0 = sc[ci], r = sc[ci + 1], den = l - 2 * c0 + r; if (den < 0) sub = best + 0.5 * (l - r) / den; }
      obs.push({ xa: ((a + 0.5) / S) * 2 - 1, xb: ((b + 0.5) / S) * 2 - 1, y: (yc / Hd) * 2 - 1, d: sub, w: bv });
    }
  }
  let fnB = null;
  if (obs.length >= 10) {
    // con muchas observaciones se permite un modelo más flexible (ondas en S que cambian a lo largo de la factura)
    const DX = obs.length > 120 ? 4 : 3, DY = obs.length > 120 ? 3 : 2;
    const basis = (x, y) => { const r = []; for (let i = 1; i <= DX; i++) for (let m = 0; m <= DY; m++) r.push(Math.pow(x, i) * Math.pow(y, m)); return r; };
    const K = DX * (DY + 1); let coef = null;
    const rows = obs.map(o => { const pa = basis(o.xa, o.y), pb = basis(o.xb, o.y); return pb.map((v, k) => v - pa[k]); });
    let wts = obs.map(o => o.w);
    for (let it = 0; it < 4; it++) {
      const A = Array.from({ length: K }, () => new Array(K).fill(0)), bb = new Array(K).fill(0);
      rows.forEach((r, i) => { const wv = wts[i]; for (let p = 0; p < K; p++) { bb[p] += wv * r[p] * obs[i].d; for (let q = 0; q < K; q++) A[p][q] += wv * r[p] * r[q]; } });
      for (let p = 0; p < K; p++) A[p][p] += 1e-3 * obs.length;
      coef = sSolve(A, bb); if (!coef) break;
      const res = rows.map((r, i) => obs[i].d - r.reduce((s, v, k) => s + v * coef[k], 0));
      const mad = res.map(Math.abs).sort((x, y) => x - y)[res.length >> 1] || 0.5;
      wts = res.map((e, i) => obs[i].w / (1 + Math.pow(e / (2.5 * Math.max(0.3, mad)), 2)));
    }
    if (coef) fnB = (x, y) => Math.max(-0.12 * Hd, Math.min(0.12 * Hd, basis((x / Wd) * 2 - 1, (y / Hd) * 2 - 1).reduce((s, v, k) => s + v * coef[k], 0)));
  }
  /* ---- elegir: la que deja los renglones más nítidos ---- */
  // dyAt da "de dónde se toma" cada punto; para medir se mueve la tinta al revés (y - dy)
  // Un cambio brusco entre columnas vecinas significaría "saltar" a otro renglón: esa corrección se descarta
  const jumpy = fn => { for (let y = step / 2; y < Hd; y += step) { let prev = fn(0, y); for (let x = Wd / 24; x < Wd; x += Wd / 24) { const v = fn(x, y); if (Math.abs(v - prev) > L * 0.45) return true; prev = v; } } return false; };
  const s0 = sRowSharpness(ink, Wd, Hd, null), cands = [];
  for (const [name, fn] of [['A', fnA], ['B', fnB]]) if (fn && !jumpy(fn)) cands.push({ name, fn, s: sRowSharpness(ink, Wd, Hd, fn) });
  if (!cands.length) return canvas;
  const best = cands.reduce((a, b) => (b.s > a.s ? b : a));
  if (best.s < s0 * 1.01) return canvas;
  // aplicar a resolución completa con una grilla fina
  const nb2 = 48, S2 = 32, Gs = [];
  for (let j = 0; j < nb2; j++) { const row = []; for (let s = 0; s < S2; s++) row.push(best.fn((s / (S2 - 1)) * (Wd - 1), (j / (nb2 - 1)) * (Hd - 1))); Gs.push(row); }
  // aplicar a resolución completa
  const sctx = canvas.getContext('2d', { willReadFrequently: true }), sd = sctx.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
  const colA = new Float32Array(W), colI = new Int32Array(W);
  for (let x = 0; x < W; x++) { const fs = Math.min(S2 - 1.001, (x / (W - 1)) * (S2 - 1)); colI[x] = Math.floor(fs); colA[x] = fs - colI[x]; }
  for (let y = 0; y < H; y++) {
    const fj = Math.min(nb2 - 1.001, (y / (H - 1)) * (nb2 - 1)), j0 = Math.floor(fj), bj = fj - j0, A0 = Gs[j0], A1 = Gs[j0 + 1];
    for (let x = 0; x < W; x++) {
      const s0 = colI[x], a = colA[x];
      const dy = ((A0[s0] * (1 - a) + A0[s0 + 1] * a) * (1 - bj) + (A1[s0] * (1 - a) + A1[s0 + 1] * a) * bj) * f;
      const yy = y + dy, y0 = Math.floor(yy), fy = yy - y0, oi = (y * W + x) * 4;
      if (y0 < 0 || y0 >= H - 1) { o[oi] = o[oi + 1] = o[oi + 2] = 255; o[oi + 3] = 255; continue; }
      const i0 = (y0 * W + x) * 4, i1 = i0 + W * 4;
      o[oi] = sd[i0] * (1 - fy) + sd[i1] * fy; o[oi + 1] = sd[i0 + 1] * (1 - fy) + sd[i1 + 1] * fy; o[oi + 2] = sd[i0 + 2] * (1 - fy) + sd[i1 + 2] * fy; o[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* Renglones rectos en papel arrugado. Se buscan las letras (manchas del tamaño de un carácter), se encadenan en tramos
   de renglón y se mide la inclinación local de cada tramo (mediana de pendientes entre letras cercanas: aguanta tildes,
   puntos y letras con cola). Con esas inclinaciones se arma un campo suave en toda la hoja y se recorre desde el centro:
   cada columna sube o baja lo necesario para que los renglones queden horizontales, aunque cada parte de la tirilla esté
   torcida distinto. Solo se aplica si los renglones quedan más nítidos que antes. */
// Componentes conexas (8 vecinos) con sus medidas
function sComponents(mask, w, h, nv) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), C = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s]) continue;
    id++; let sp = 0; stack[sp++] = s; lab[s] = id;
    let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, mn = 9, sv = 0;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; const v = nv[p]; sv += v; if (v < mn) mn = v;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const xl = x > 0, xr = x < w - 1, yu = y > 0, yd = y < h - 1;
      if (xl && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (xr && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (yu) { const q = p - w; if (mask[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; } if (xl && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; } if (xr && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; } }
      if (yd) { const q = p + w; if (mask[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; } if (xl && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; } if (xr && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; } }
    }
    const mx = sx / area, my = sy / area, cxx = sxx / area - mx * mx, cyy = syy / area - my * my, cxy = sxy / area - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    const ang = Math.atan2(l1 - cxx, cxy || 1e-9) * 180 / Math.PI; // ángulo del eje mayor respecto a la horizontal
    C.push({ id, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, mn, mean: sv / area,
      major: 4 * Math.sqrt(l1), minor: 4 * Math.sqrt(l2), ang: ((ang % 180) + 180) % 180, keep: 0, grp: -1 });
  }
  return { lab, C };
}
function sBlobs(mask, w, h) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), comps = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s]) continue;
    const id = comps.length + 1; let sp = 0; stack[sp++] = s; lab[s] = id;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, area = 0;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0; area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx; if (mask[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
        }
      }
    }
    comps.push({ id, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  return { lab, comps };
}
// Tamaño típico de letra (alto de las manchas que parecen caracteres)
// (mediana ponderada por tinta de las manchas compactas: los pedazos finos de arrugas pesan poco)
function sCharHeight(comps, Hd) {
  const solid = comps.filter(c => c.h >= 5 && c.h <= Hd * 0.06 && c.w <= c.h * 2.5 && c.area / Math.max(c.w, c.h) >= c.h * 0.2 && c.area / (c.w * c.h) >= 0.18);
  if (solid.length < 25) return 0;
  solid.sort((a, b) => a.h - b.h);
  const tot = solid.reduce((t, c) => t + c.area, 0); let acc = 0;
  for (const c of solid) { acc += c.area; if (acc >= tot * 0.55) return c.h; }
  return solid[solid.length - 1].h;
}
/* Mediciones de renglón: las letras de cada palabra se unen en manchas horizontales y se sigue su línea central.
   Devuelve el alto típico de letra (Hc) y, cada media letra, la inclinación local del renglón (recta en una ventana). */
function sLineObs(ink, Wd, Hd, HcFixed) {
  const n = Wd * Hd;
  // Tinta con histéresis: núcleos oscuros que crecen por el borde del trazo (las letras finas no se parten)
  const m = new Uint8Array(n), stk = new Int32Array(n); let sp = 0;
  for (let i = 0; i < n; i++) if (ink[i] > 0.6) { m[i] = 1; stk[sp++] = i; }
  while (sp) {
    const p = stk[--sp], x = p % Wd;
    if (x > 0 && !m[p - 1] && ink[p - 1] > 0.3) { m[p - 1] = 1; stk[sp++] = p - 1; }
    if (x < Wd - 1 && !m[p + 1] && ink[p + 1] > 0.3) { m[p + 1] = 1; stk[sp++] = p + 1; }
    if (p >= Wd && !m[p - Wd] && ink[p - Wd] > 0.3) { m[p - Wd] = 1; stk[sp++] = p - Wd; }
    if (p + Wd < n && !m[p + Wd] && ink[p + Wd] > 0.3) { m[p + Wd] = 1; stk[sp++] = p + Wd; }
  }
  const { lab, comps } = sBlobs(m, Wd, Hd);
  const Hc = HcFixed || sCharHeight(comps, Hd);
  if (!Hc) return null;
  // Solo manchas que pueden ser texto: fuera el código QR y los logos (muy grandes) y las arrugas (largas y finas)
  const ok = new Uint8Array(comps.length + 1);
  for (const c of comps) {
    const len = Math.hypot(c.w, c.h), tau = c.area / Math.max(c.w, c.h);
    ok[c.id] = c.area >= 3 && c.h <= Hc * 2.4 && c.w <= Hc * 6 && !(len > Hc * 2 && tau < Hc * 0.16) ? 1 : 0;
  }
  const T = new Uint8Array(n); for (let i = 0; i < n; i++) if (lab[i] && ok[lab[i]]) T[i] = 1;
  // Las letras de una palabra o de un tramo de renglón se unen en una mancha horizontal (huecos cortos de cada fila)
  const gap = Math.round(Hc * 1.1), B = T.slice();
  for (let y = 0; y < Hd; y++) {
    const r = y * Wd; let last = -1;
    for (let x = 0; x < Wd; x++) if (T[r + x]) { if (last >= 0 && x - last > 1 && x - last <= gap) for (let k = last + 1; k < x; k++) B[r + k] = 1; last = x; }
  }
  const { lab: lb, comps: blobs } = sBlobs(B, Wd, Hd);
  const obs = [], segs = [], byBlob = new Map();
  for (const bl of blobs) if (bl.w >= Hc * 2.5 && bl.area / bl.w <= Hc * 2) byBlob.set(bl.id, { b: bl, sy: new Float32Array(bl.w), sn: new Float32Array(bl.w), ymin: new Float32Array(bl.w).fill(1e9), ymax: new Float32Array(bl.w).fill(-1) });
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    const i = y * Wd + x; if (!T[i]) continue;
    const e = byBlob.get(lb[i]); if (!e) continue;
    const k = x - e.b.x0; e.sy[k] += y; e.sn[k]++; if (y < e.ymin[k]) e.ymin[k] = y; if (y > e.ymax[k]) e.ymax[k] = y;
  }
  // Inclinación por la línea base (el borde inferior de las letras): letras grandes y chicas del mismo renglón comparten
  // la base; las colas (p, g, q, y, coma) quedan por debajo y se descartan en un segundo ajuste.
  const half = Math.max(4, Math.round(Hc * 2.6));
  const fit = (pts, x) => { let s0 = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [px, py] of pts) { if (Math.abs(px - x) > half) continue; s0++; sx += px; sy += py; sxx += px * px; sxy += px * py; }
    const den = s0 * sxx - sx * sx; if (s0 < Hc * 2 || den <= 0) return null;
    const sl = (s0 * sxy - sx * sy) / den; return { sl, y0: (sy - sl * sx) / s0, n: s0 }; };
  const ends = []; // extremos de cada tramo de renglón (para unir etiqueta y monto separados por un blanco)
  for (const e of byBlob.values()) {
    const { b: bl, sn, ymin, ymax } = e, pts = [];
    for (let k = 0; k < bl.w; k++) if (sn[k] && ymax[k] - ymin[k] <= Hc * 1.8) pts.push([bl.x0 + k, ymax[k]]);
    if (pts.length < Hc * 1.5) continue;
    const line = [];
    for (let k = 0; k < pts.length; k += Math.max(1, Math.round(Hc / 2))) {
      const x = pts[k][0]; const f1 = fit(pts, x); if (!f1) continue;
      const keep = pts.filter(([px, py]) => Math.abs(px - x) <= half && py <= f1.y0 + f1.sl * px + Hc * 0.2);
      const f2 = fit(keep, x) || f1;
      if (Math.abs(f2.sl) > 0.45) continue;
      const yc = f2.y0 + f2.sl * x - Hc * 0.4;
      obs.push({ x, y: yc, s: f2.sl, w: Math.min(3, f2.n / (Hc * 2)) }); line.push([x, yc, f2.sl]);
    }
    if (line.length) { segs.push(line); const a = line[0], z = line[line.length - 1]; ends.push({ xa: Math.max(bl.x0, a[0] - half), ya: a[1] + a[2] * (Math.max(bl.x0, a[0] - half) - a[0]), sa: a[2], xb: Math.min(bl.x1, z[0] + half), yb: z[1] + z[2] * (Math.min(bl.x1, z[0] + half) - z[0]), sb: z[2] }); }
  }
  // Puentes: un tramo y el siguiente a su derecha en el mismo renglón (prolongando la inclinación de ambos extremos).
  // Si la pareja es clara, el blanco entre ellos debe subir o bajar justo lo que se mide: así no se descuadran columnas.
  const bridges = [];
  for (const A of ends) {
    const cand = [];
    for (const B of ends) {
      const gap = B.xa - A.xb; if (B === A || gap < Hc * 0.8 || gap > Wd * 0.75) continue;
      const err = Math.abs(B.ya - (A.yb + (A.sb + B.sa) / 2 * gap)); if (err < Hc * 1.6) cand.push({ B, gap, err });
    }
    if (!cand.length) continue;
    const g0 = Math.min(...cand.map(c => c.gap)), near = cand.filter(c => c.gap <= g0 + Hc * 2).sort((p, q) => p.err - q.err);
    if (near[0].err < Hc * 0.4 && (near.length < 2 || near[1].err > Hc * 0.9)) bridges.push({ x1: A.xb, x2: near[0].B.xa, y: (A.yb + near[0].B.ya) / 2, m: (near[0].B.ya - A.yb) / (near[0].B.xa - A.xb) });
  }
  return { Hc, obs, segs, bridges };
}
/* Malla de inclinaciones: tramos lineales a lo ancho (6) y a lo largo (cada ~2 renglones), ajustada con suavidad y
   pesos robustos (lo que no encaja pesa menos). El desplazamiento D(x, y) es la inclinación acumulada desde el centro de
   la hoja: cada columna baja o sube lo necesario para que el renglón quede horizontal. Se limita cuánto puede cambiar la
   altura de los renglones (sin pliegues ni letras estiradas). */
function sSolveBanded(A, b, M, bw) { // A: filas de 2·bw+1 (simétrica definida positiva), sin pivoteo
  const W2 = 2 * bw + 1, at = (i, j) => i * W2 + (j - i + bw);
  for (let k = 0; k < M; k++) {
    const piv = A[at(k, k)]; if (!(Math.abs(piv) > 1e-12)) return null;
    for (let i = k + 1; i <= Math.min(M - 1, k + bw); i++) {
      const fct = A[at(i, k)] / piv; if (!fct) continue;
      for (let j = k; j <= Math.min(M - 1, k + bw); j++) A[at(i, j)] -= fct * A[at(k, j)];
      b[i] -= fct * b[k];
    }
  }
  const x = new Float64Array(M);
  for (let i = M - 1; i >= 0; i--) { let t = b[i]; for (let j = i + 1; j <= Math.min(M - 1, i + bw); j++) t -= A[at(i, j)] * x[j]; x[i] = t / A[at(i, i)]; }
  return x;
}
function sSlopeModel(obs, Wd, Hd, Hc, bridges = []) {
  const NX = 7, Kx = Wd / (NX - 1), Ky = Math.max(8, Hc * 2), NY = Math.ceil(Hd / Ky) + 1, M = NX * NY, bw = 2 * NX, W2 = 2 * bw + 1;
  const hat = (v, K, N) => { const f = Math.max(0, Math.min(N - 1.0001, v / K)), a = Math.floor(f); return [a, 1 - (f - a), f - a]; };
  const at4 = (x, y) => { const [a, x0, x1] = hat(x, Kx, NX), [bb, y0, y1] = hat(y, Ky, NY); return [[bb * NX + a, x0 * y0], [bb * NX + a + 1, x1 * y0], [(bb + 1) * NX + a, x0 * y1], [(bb + 1) * NX + a + 1, x1 * y1]]; };
  // Un puente es la inclinación media a lo largo del blanco (promedio de 12 puntos): cuenta como una medición más
  const brObs = bridges.map(b => { const acc = new Map(); for (let m = 0; m < 12; m++) for (const [k, v] of at4(b.x1 + (m + 0.5) * (b.x2 - b.x1) / 12, b.y)) acc.set(k, (acc.get(k) || 0) + v / 12); return { x: (b.x1 + b.x2) / 2, y: b.y, s: b.m, w: 3, nd: [...acc] }; });
  obs = obs.concat(brObs);
  const nodes = obs.map(o => o.nd || at4(o.x, o.y));
  const sAt = (c, nd) => nd.reduce((t, [k, w]) => t + c[k] * w, 0);
  // D a partir de los valores en los nodos: integral (exacta, por trapecios) desde la columna central
  const makeD = c => {
    const ac = (NX - 1) / 2;
    return (x, y) => {
      const [bb, y0, y1] = hat(y, Ky, NY), S = k => c[bb * NX + k] * y0 + c[(bb + 1) * NX + k] * y1;
      const fx = Math.max(0, Math.min(NX - 1, x / Kx)), a = Math.min(NX - 2, Math.floor(fx)), t = fx - a;
      let D = 0;
      if (a >= ac) { for (let k = ac; k < a; k++) D += Kx * (S(k) + S(k + 1)) / 2; }
      else { for (let k = a + 1; k < ac; k++) D -= Kx * (S(k) + S(k + 1)) / 2; D -= Kx * (S(a) + S(a + 1)) / 2; }
      const s0 = S(a), s1 = S(a + 1); return D + Kx * (s0 * t + (s1 - s0) * t * t / 2);
    };
  };
  let wts = obs.map(o => o.w), reg = 1, c = null;
  for (let it = 0; it < 10; it++) {
    const A = new Float64Array(M * W2), b = new Float64Array(M), at = (i, j) => i * W2 + (j - i + bw);
    let wsum = 0;
    obs.forEach((o, i) => { const nd = nodes[i], wi = wts[i]; wsum += wi;
      for (const [p, vp] of nd) { b[p] += wi * vp * o.s; for (const [q, vq] of nd) A[at(p, q)] += wi * vp * vq; } });
    const per = wsum / M, ly = per * reg * 0.1, lx = per * reg * 0.05, mu = per * 0.002;
    for (let k = 0; k < M; k++) A[at(k, k)] += mu;
    for (let bb = 0; bb < NY; bb++) for (let a = 0; a < NX; a++) {
      if (bb > 0 && bb < NY - 1) { const id = [(bb - 1) * NX + a, bb * NX + a, (bb + 1) * NX + a], cf = [1, -2, 1]; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) A[at(id[p], id[q])] += ly * cf[p] * cf[q]; }
      if (a > 0 && a < NX - 1) { const id = [bb * NX + a - 1, bb * NX + a, bb * NX + a + 1], cf = [1, -2, 1]; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) A[at(id[p], id[q])] += lx * cf[p] * cf[q]; }
    }
    c = sSolveBanded(A, b, M, bw); if (!c) return null;
    const D = makeD(c);
    let worst = 0;
    for (let y = Ky; y < Hd - Ky; y += Ky / 3) for (let x = 0; x <= Wd; x += Wd / 12) worst = Math.max(worst, Math.abs((D(x, y + 2) - D(x, y - 2)) / 4));
    if (worst > 0.6) { reg *= 2; continue; }
    const res = obs.map((o, i) => o.s - sAt(c, nodes[i]));
    const mad = res.map(Math.abs).sort((x, y) => x - y)[res.length >> 1] || 0.01;
    wts = obs.map((o, i) => o.w / (1 + (res[i] / (4 * Math.max(0.01, mad))) ** 2));
    if (it >= 3) break;
  }
  return c ? makeD(c) : null;
}
// Mueve un mapa de tinta reducido con el desplazamiento (para medir el resultado antes de aplicarlo)
function sWarpField(src, Wd, Hd, dyAt) {
  const out = new Float32Array(Wd * Hd);
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) { const yy = y + dyAt(x, y), y0 = Math.floor(yy), fy = yy - y0; if (y0 < 0 || y0 >= Hd - 1) continue; out[y * Wd + x] = src[y0 * Wd + x] * (1 - fy) + src[(y0 + 1) * Wd + x] * fy; }
  return out;
}
/* Renglones rígidos: dentro de cada renglón el desplazamiento casi no cambia de arriba abajo (las letras no se estiran ni
   se encogen) y lo que haga falta estirar o encoger para dejar los renglones rectos se va al blanco entre renglones.
   Por cada columna de la malla se resuelve un ajuste 1D: seguir el campo suave donde hay tinta, rígido dentro del
   renglón y flexible en el blanco. La tinta se mide en una ventana ancha, así columnas vecinas no se rasgan. */
function sRigidLines(G, GX, GY, gx, gy, fn, ink, Wd, Hd, Hc) {
  const Wk = sWarpField(ink, Wd, Hd, fn), W1 = Wd + 1, II = new Float64Array(W1 * (Hd + 1));
  for (let y = 0; y < Hd; y++) { let row = 0; for (let x = 0; x < Wd; x++) { if (Wk[y * Wd + x] > 0.5) row++; II[(y + 1) * W1 + x + 1] = II[y * W1 + x + 1] + row; } }
  const G2 = new Float32Array(GX * GY), hw = Math.max(2, Math.round(Hc)), R = 60, kb = 0.05;
  const c = new Float64Array(GY), k = new Float64Array(GY), dg = new Float64Array(GY), up = new Float64Array(GY), rhs = new Float64Array(GY);
  for (let i = 0; i < GX; i++) {
    const x = i * gx, xa = Math.max(0, Math.round(x - hw)), xb = Math.min(Wd, Math.round(x + hw));
    for (let j = 0; j < GY; j++) {
      const ya = Math.max(0, Math.round(j * gy - gy / 2)), yb = Math.min(Hd, Math.round(j * gy + gy / 2)), area = (xb - xa) * (yb - ya);
      c[j] = area > 0 ? Math.min(1, (II[yb * W1 + xb] - II[ya * W1 + xb] - II[yb * W1 + xa] + II[ya * W1 + xa]) / area / 0.04) : 0;
    }
    for (let j = 0; j < GY - 1; j++) k[j] = R * Math.min(c[j], c[j + 1]) + kb;
    // Sistema tridiagonal: (w + k_izq + k_der)·g_j − k_izq·g_(j−1) − k_der·g_(j+1) = w·G_j  (algoritmo de Thomas)
    for (let j = 0; j < GY; j++) { const w = c[j] + 0.01, kl = j > 0 ? k[j - 1] : 0, kr = j < GY - 1 ? k[j] : 0; dg[j] = w + kl + kr; up[j] = -kr; rhs[j] = w * G[j * GX + i]; }
    for (let j = 1; j < GY; j++) { const m = -k[j - 1] / dg[j - 1]; dg[j] -= m * up[j - 1]; rhs[j] -= m * rhs[j - 1]; }
    let v = rhs[GY - 1] / dg[GY - 1]; G2[(GY - 1) * GX + i] = v;
    for (let j = GY - 2; j >= 0; j--) { v = (rhs[j] - up[j] * v) / dg[j]; G2[j * GX + i] = v; }
  }
  return G2;
}
function scanDewarp(canvas, passes = 3) {
  const W = canvas.width, H = canvas.height;
  const { ink, Wd, Hd, f } = sInkSmall(canvas, 700);
  const wmed = arr => { arr.sort((a, b) => a[0] - b[0]); const tot = arr.reduce((t, v) => t + v[1], 0); let acc = 0; for (const [v, ww] of arr) { acc += ww; if (acc >= tot / 2) return v; } return 0; };
  let L0 = sLineObs(ink, Wd, Hd);
  if (!L0 || L0.obs.length < 20) return canvas;
  const Hc = L0.Hc, gx = Math.max(2, Hc / 3), gy = Math.max(2, Hc / 3), GX = Math.ceil(Wd / gx) + 1, GY = Math.ceil(Hd / gy) + 1;
  const gridFn = G => (x, y) => { const fx = Math.max(0, Math.min(GX - 1.001, x / gx)), fy = Math.max(0, Math.min(GY - 1.001, y / gy)), i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j;
    return (G[j * GX + i] * (1 - ax) + G[j * GX + i + 1] * ax) * (1 - ay) + (G[(j + 1) * GX + i] * (1 - ax) + G[(j + 1) * GX + i + 1] * ax) * ay; };
  // Inclinación sistemática: promedio por celdas (el ruido de cada medición se cancela; lo que queda es el giro real)
  const sys = L => { const cw = Hc * 5, ch = Hc * 3, cells = new Map();
    for (const o of L.obs) { const k = Math.floor(o.x / cw) + ',' + Math.floor(o.y / ch), c = cells.get(k) || [0, 0]; c[0] += o.s * o.w; c[1] += o.w; cells.set(k, c); }
    let a2 = 0, t = 0; for (const [sw, ww] of cells.values()) { if (ww < 2) continue; a2 += Math.abs(sw / ww) * ww; t += ww; } return t ? a2 / t : 0; };
  // Varias pasadas sobre la imagen reducida (cada una mide lo que quedó torcido); al final se aplica una sola vez
  let acc = null, accFn = null, tiltFirst = sys(L0), tiltLast = tiltFirst;
  for (let pass = 0; pass < passes; pass++) {
    const D = sSlopeModel(L0.obs, Wd, Hd, Hc, L0.bridges);
    if (!D) break;
    const G = new Float32Array(GX * GY);
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const x = i * gx, y = j * gy, d = Math.max(-Hd * 0.2, Math.min(Hd * 0.2, D(x, y)));
      G[j * GX + i] = accFn ? d + accFn(x, y + d) : d; // la nueva corrección se suma a las anteriores
    }
    const fn = gridFn(G), L1 = sLineObs(sWarpField(ink, Wd, Hd, fn), Wd, Hd, Hc);
    const t0 = sys(L0), t1 = L1 && L1.obs.length ? sys(L1) : 1;
    const m0 = wmed(L0.obs.map(o => [Math.abs(o.s), o.w])), m1 = L1 && L1.obs.length ? wmed(L1.obs.map(o => [Math.abs(o.s), o.w])) : 1;
    if (!(t0 > 0.02 && t1 < t0 * 0.85 && m1 <= m0 * 1.05 && L1.obs.length >= L0.obs.length * 0.6)) break;
    acc = G; accFn = fn; L0 = L1; tiltLast = t1;
  }
  if (typeof window !== 'undefined' && window.SCAN_DEBUG) window.__dewarp = { Hc, Wd, Hd, f, segs: L0.segs, obs: L0.obs.length, tilt0: tiltFirst, tilt1: tiltLast, good: !!acc };
  if (!acc) return canvas;
  const dyAt = gridFn(sRigidLines(acc, GX, GY, gx, gy, accFn, ink, Wd, Hd, Hc));
  // Aplicar a resolución completa (una sola vez)
  const sctx = canvas.getContext('2d', { willReadFrequently: true }), sd = sctx.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const yy = y + dyAt(x / f, y / f) * f, y0 = Math.floor(yy), fy = yy - y0, oi = (y * W + x) * 4;
      if (y0 < 0 || y0 >= H - 1) { o[oi] = o[oi + 1] = o[oi + 2] = 255; o[oi + 3] = 255; continue; }
      const i0 = (y0 * W + x) * 4, i1 = i0 + W * 4;
      o[oi] = sd[i0] * (1 - fy) + sd[i1] * fy; o[oi + 1] = sd[i0 + 1] * (1 - fy) + sd[i1 + 1] * fy; o[oi + 2] = sd[i0 + 2] * (1 - fy) + sd[i1 + 2] * fy; o[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

// Recorta el blanco sobrante alrededor del texto (queda un margen parejo)
function scanTrim(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 480) { rows[y]++; cols[x]++; } }
  const minRow = Math.max(2, w * 0.004), minCol = Math.max(2, h * 0.002);
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h && rows[y0] < minRow) y0++; while (y1 > y0 && rows[y1] < minRow) y1--;
  while (x0 < w && cols[x0] < minCol) x0++; while (x1 > x0 && cols[x1] < minCol) x1--;
  if (y1 - y0 < h * 0.2 || x1 - x0 < w * 0.2) return canvas; // casi vacío: no tocar
  const m = Math.round(Math.max(x1 - x0, 200) * 0.06);
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nw * nh > w * h * 0.92) return canvas;
  const out = document.createElement('canvas'); out.width = nw; out.height = nh;
  out.getContext('2d').drawImage(canvas, x0, y0, nw, nh, 0, 0, nw, nh); return out;
}
function sSolve(A, b) { // Gauss con pivoteo; null si es singular
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; } }
  return M.map((r, i) => r[n] / r[i]);
}

/* Limpieza tipo escáner.
   - Dedos: piel pegada al borde → papel.
   - Luz: se estima el brillo del papel sin texto (cierre morfológico a menor resolución + desenfoque) y se divide.
     Eso aplana sombras y la parte ancha de los dobleces.
   - Dobleces finos y manchas: lo que es solo "gris" (nunca tan oscuro como la tinta) y no está pegado a un trazo
     de texto se vuelve blanco (umbral con histéresis).
   mode 'clean' → blanco y negro; 'color' → color con la luz aplanada. */
/* Limpieza tipo escáner de documentos (como Adobe Scan / Samsung):
   1) Se estima la luz del papel en cada zona (cierre morfológico grande + suavizado): sombras, dobleces
      suaves y luz desigual quedan en ese "fondo".
   2) Cada píxel se divide por su fondo: el papel queda parejo y el texto conserva su forma y sus grises.
   3) Se enfoca el texto (máscara de enfoque) y se ajustan niveles: el papel pasa a blanco puro y la tinta a
      negro, sin binarizar, así el texto tenue (tirillas térmicas gastadas) no se borra.
   4) Dedos que tapan el borde y restos del fondo se blanquean; las marcas de dobleces largas y finas se quitan. */
/* "Recién impreso": en el modo mejorado se dibuja solo lo que tiene forma de impresión — letras ordenadas en renglones,
   el código QR o logos compactos, y guiones o reglas horizontales (separadores). Sombras, dobleces y arrugas no tienen esa
   estructura y quedan en blanco, también entre renglones. Devuelve 1 = se dibuja, 0 = papel (null si no hay texto claro). */
function sTextKeep(sharp, w, h, darkAt, lightAt, margin, coreAbs) {
  const n = w * h, D = new Uint8Array(n);
  for (let i = 0; i < n; i++) D[i] = sharp[i] < darkAt(i) ? 1 : 0;
  const { lab, comps } = sBlobs(D, w, h);
  const Hc = sCharHeight(comps, h);
  if (!Hc || comps.length < 30) return null;
  const minV = new Float32Array(comps.length + 1).fill(9);
  for (let i = 0; i < n; i++) if (lab[i] && sharp[i] < minV[lab[i]]) minV[lab[i]] = sharp[i];
  const kind = new Uint8Array(comps.length + 1); // 1 letra, 2 gráfico, 3 guion o regla, 4 punto o tilde
  for (const c of comps) {
    const len = Math.hypot(c.w, c.h), tau = c.area / Math.max(c.w, c.h), dens = c.area / (c.w * c.h);
    if (c.h >= Hc * 0.35 && c.h <= Hc * 2.4 && c.w <= Hc * 6 && c.area >= Hc * Hc * 0.05 && !(len > Hc * 2 && tau < Hc * 0.16) && !(c.h < Hc * 0.6 && c.w > Hc * 1.8)) kind[c.id] = 1;
    else if (c.w >= Hc * 2 && c.h >= Hc * 2 && dens >= 0.3 && tau >= Hc * 0.3) kind[c.id] = 2;
    else if (c.h <= Hc * 0.36 && c.w >= c.h * 1.5 && c.w <= Hc * 40) kind[c.id] = 3;
    else if (c.area < Hc * Hc * 0.05) kind[c.id] = 4;
  }
  // Franja de renglón alrededor de cada letra (rectángulos sumados con una tabla de diferencias)
  const ex = Math.round(Hc * 1.2), ey = Math.round(Hc * 0.35), acc = new Int32Array((w + 1) * (h + 1));
  for (const c of comps) {
    if (kind[c.id] !== 1) continue;
    const x0 = Math.max(0, c.x0 - ex), x1 = Math.min(w, c.x1 + 1 + ex), y0 = Math.max(0, c.y0 - ey), y1 = Math.min(h, c.y1 + 1 + ey);
    acc[y0 * (w + 1) + x0]++; acc[y0 * (w + 1) + x1]--; acc[y1 * (w + 1) + x0]--; acc[y1 * (w + 1) + x1]++;
  }
  for (let y = 0; y <= h; y++) for (let x = 1; x <= w; x++) acc[y * (w + 1) + x] += acc[y * (w + 1) + x - 1];
  for (let y = 1; y <= h; y++) for (let x = 0; x <= w; x++) acc[y * (w + 1) + x] += acc[(y - 1) * (w + 1) + x];
  // Guiones alineados (separadores "- - - -" o "====") y reglas largas: se conservan aunque estén lejos del texto
  const dash = comps.filter(c => kind[c.id] === 3).sort((a, b) => a.cy - b.cy || a.x0 - b.x0), keepComp = new Uint8Array(comps.length + 1);
  for (let i = 0; i < dash.length; i++) {
    const row = [dash[i]];
    for (let j = i + 1; j < dash.length && dash[j].cy - dash[i].cy <= Hc * 0.3; j++) row.push(dash[j]);
    row.sort((a, b) => a.x0 - b.x0);
    let run = [row[0]];
    const flush = () => { const span = run[run.length - 1].x1 - run[0].x0; if ((run.length >= 3 && span >= Hc * 3) || span >= Hc * 4) run.forEach(c => { keepComp[c.id] = 1; }); };
    for (let k = 1; k < row.length; k++) { if (row[k].x0 - run[run.length - 1].x1 <= Hc * 1.5) run.push(row[k]); else { flush(); run = [row[k]]; } }
    flush();
  }
  // Oscuridad de referencia de cada renglón: la tinta más oscura de las letras vecinas del mismo renglón (rejilla gruesa).
  // Una mancha mucho más clara que las letras de su renglón es sombra de un doblez; un renglón entero desteñido se conserva.
  const cw = Math.max(2, Hc / 2), chh = Math.max(2, Hc), GXr = Math.ceil(w / cw) + 1, GYr = Math.ceil(h / chh) + 1, ref = new Float32Array(GXr * GYr).fill(9);
  for (const c of comps) {
    if (kind[c.id] !== 1) continue;
    const gx0 = Math.max(0, Math.floor((c.x0 - Hc * 6) / cw)), gx1 = Math.min(GXr - 1, Math.floor((c.x1 + Hc * 6) / cw)), gy0 = Math.max(0, Math.floor((c.cy - Hc * 0.5) / chh)), gy1 = Math.min(GYr - 1, Math.floor((c.cy + Hc * 0.5) / chh));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const k = gy * GXr + gx; if (minV[c.id] < ref[k]) ref[k] = minV[c.id]; }
  }
  const refAt = c => ref[Math.min(GYr - 1, Math.floor(c.cy / chh)) * GXr + Math.min(GXr - 1, Math.floor(c.cx / cw))];
  const mX = Math.round(w * 0.04), mY = Math.round(h * 0.035), drop = new Uint8Array(comps.length + 1);
  for (const c of comps) {
    const len = Math.hypot(c.w, c.h), tau = c.area / Math.max(c.w, c.h), flat = c.h <= c.w * 0.27;
    const atEdge = c.x0 < mX || c.y0 < mY || c.x1 >= w - mX || c.y1 >= h - mY;
    const inTopBot = c.y0 < mY || c.y1 >= h - mY;
    const r0 = refAt(c), lim = r0 < 9 ? Math.max(coreAbs, r0 + margin) : coreAbs;
    if (minV[c.id] > lim && c.area < Hc * Hc * 2 && kind[c.id] !== 4) drop[c.id] = 1;  // nunca tan oscura como la tinta ni como su renglón: sombra o doblez (los puntos se salvan)
    else if (atEdge && kind[c.id] !== 1) drop[c.id] = 1;                               // borde roto, sombra o fondo
    else if (inTopBot && (c.h < Hc * 0.65 || c.w > Hc * 4)) drop[c.id] = 1;            // sombra plana del borde de arriba o de abajo
    else if (kind[c.id] === 0 && !keepComp[c.id] && c.h < Hc * 0.6 && c.w > Hc * 1.8) drop[c.id] = 1; // mancha plana que no es separador
    else if (kind[c.id] !== 1 && kind[c.id] !== 2 && !keepComp[c.id] && len > Hc * 1.2 && tau < Hc * 0.2 && !flat) drop[c.id] = 1; // raya de doblez
  }
  const K = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!D[i] || drop[lab[i]]) continue; const k = kind[lab[i]];
    if (k === 2 || keepComp[lab[i]] || acc[y * (w + 1) + x] > 0) K[i] = 1;
  }
  // Letras completas: desde lo oscuro se crece por el gris del mismo trazo (unos píxeles), sin pasar a sombras lejanas
  const R = K.slice(), gr = Math.max(1, Math.round(Hc * 0.15)), dist = new Uint8Array(n), q = [];
  for (let i = 0; i < n; i++) if (K[i]) q.push(i);
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi], x = p % w, dd = dist[p] + 1; if (dd > gr) continue;
    for (const nb of [p - 1, p + 1, p - w, p + w]) {
      if (nb < 0 || nb >= n || R[nb] || (nb === p - 1 && x === 0) || (nb === p + 1 && x === w - 1)) continue;
      if (sharp[nb] < lightAt(nb)) { R[nb] = 1; dist[nb] = dd; q.push(nb); }
    }
  }
  // y un píxel más para el borde suave
  const R2 = R.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!R[i] && (R[i - 1] || R[i + 1] || R[i - w] || R[i + w])) R2[i] = 1; }
  if (typeof window !== 'undefined' && window.SCAN_DEBUG) window.__textKeep = { Hc, comps: comps.length, letters: comps.filter(c => kind[c.id] === 1).length };
  R2.charH = Hc;
  return R2;
}
function scanClean(canvas, mode) {
  const w = canvas.width, h = canvas.height, n = w * h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const g = new Float32Array(n), skin = new Uint8Array(n);
  const wb = sWhiteGains(d, n); // con luz cálida el papel no debe confundirse con piel ni verse amarillo
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, d[i * 4] * wb[0]), gg = Math.min(255, d[i * 4 + 1] * wb[1]), b = Math.min(255, d[i * 4 + 2] * wb[2]);
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b; skin[i] = sIsSkin(r, gg, b) || (r > gg && gg > b && r - b > 48 && r > 95) ? 1 : 0;
  }
  // Dedos: piel conectada con el borde del recorte
  const finger = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
  const seedF = p => { if (skin[p] && !finger[p]) { finger[p] = 1; stack[sp++] = p; } };
  // Semillas en una franja junto al borde (el recorte puede dejar una línea de mesa entre el dedo y el borde)
  const fb = Math.max(2, Math.round(Math.min(w, h) * 0.025));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < fb || y < fb || x >= w - fb || y >= h - fb) seedF(y * w + x);
  while (sp) { const p = stack[--sp], x = p % w, y = (p / w) | 0;
    if (x > 0) seedF(p - 1); if (x < w - 1) seedF(p + 1); if (y > 0) seedF(p - w); if (y < h - 1) seedF(p + w); }
  const q = Math.max(1, Math.round(Math.min(w, h) / 500)), wq = Math.ceil(w / q), hq = Math.ceil(h / q);
  let fCount = 0; const fq = new Float32Array(wq * hq);
  for (let i = 0; i < n; i++) if (finger[i]) { fCount++; fq[(((i / w) | 0) / q | 0) * wq + ((i % w) / q | 0)] = 1; }
  // Dedo: núcleo (se borra), franja cercana (se borra: sombra del dedo) y franja amplia (solo se borra lo que no es tinta)
  const fGrown = new Uint8Array(n), fBand = new Uint8Array(n);
  if (fCount) {
    const rc = Math.max(1, Math.round(w / 250 / q)), fqC = sMorph(fq, wq, hq, rc, true), fqB = sMorph(fq, wq, hq, Math.max(2, Math.round(w / 45 / q)), true);
    for (let y = 0; y < h; y++) { const row = ((y / q) | 0) * wq; for (let x = 0; x < w; x++) { const j = row + ((x / q) | 0); fGrown[y * w + x] = fqC[j] ? 1 : 0; fBand[y * w + x] = fqB[j] ? 1 : 0; } }
  }
  // 1) Fondo (luz del papel) a baja resolución
  const gq = new Float32Array(wq * hq);
  for (let y = 0; y < hq; y++) for (let x = 0; x < wq; x++) { let t = 0, c = 0; for (let yy = y * q; yy < Math.min(h, y * q + q); yy++) for (let xx = x * q; xx < Math.min(w, x * q + q); xx++) { const i = yy * w + xx; t += fBand[i] ? 245 : g[i]; c++; } gq[y * wq + x] = t / c; }
  const rT = Math.max(3, Math.round(wq * 0.02)); // más ancho que cualquier trazo de letra
  const closed = sMorph(sMorph(gq, wq, hq, rT, true), wq, hq, Math.round(rT * 0.7), false);
  const bgq = sBoxBlur(closed, wq, hq, Math.max(2, Math.round(rT * 0.8)));
  const bgAt = (x, y) => { const fx = Math.max(0, Math.min(wq - 1.001, x / q - 0.5)), fy = Math.max(0, Math.min(hq - 1.001, y / q - 0.5)), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    return (bgq[y0 * wq + x0] * (1 - ax) + bgq[y0 * wq + x0 + 1] * ax) * (1 - ay) + (bgq[(y0 + 1) * wq + x0] * (1 - ax) + bgq[(y0 + 1) * wq + x0 + 1] * ax) * ay; };
  // 2) Luz pareja: cada píxel dividido por su fondo
  const bg = new Float32Array(n), nv = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, b = Math.max(30, bgAt(x, y)); bg[i] = b; nv[i] = fGrown[i] ? 1 : Math.min(1.15, g[i] / b); }
  // 3) Enfoque: realza los bordes de las letras sin inflar el grano del papel
  const sr = Math.max(1, Math.round(w / 900)), soft = sBoxBlur(nv, w, h, sr), sharp = new Float32Array(n);
  for (let i = 0; i < n; i++) { const dlt = nv[i] - soft[i]; sharp[i] = nv[i] + (Math.abs(dlt) > 0.02 ? 0.85 : 0.25) * dlt; }
  // Niveles: blanco = papel típico; negro = la tinta más oscura (percentil bajo)
  const hist = new Uint32Array(121); let cnt = 0;
  const mx = Math.round(w * 0.06), my = Math.round(h * 0.05);
  for (let y = my; y < h - my; y++) for (let x = mx + (y & 1); x < w - mx; x += 2) { const i = y * w + x; if (fGrown[i]) continue; hist[Math.max(0, Math.min(120, Math.round(sharp[i] * 100)))]++; cnt++; }
  const pct = f => { let a = 0; for (let b = 0; b <= 120; b++) { a += hist[b]; if (a >= cnt * f) return b / 100; } return 1; };
  const paper = pct(0.5), B = Math.min(0.5, Math.max(0.05, pct(0.004)));
  const W = Math.max(B + 0.25, Math.min(0.93, paper - 0.07));
  // En zonas que estaban en sombra el grano del papel se amplifica: ahí el blanco empieza un poco antes
  const bgs = Float32Array.from(bgq).sort(), bgRef = bgs[Math.floor(bgs.length * 0.75)] || 255;
  const Wat = i => Math.max(B + 0.2, W - 0.12 * (1 - Math.min(1, bg[i] / bgRef)));
  // Curva que oscurece la tinta tenue (tirillas desteñidas) sin ensuciar el papel
  const lv = (v, Wi) => { let t = (v - B) / (Wi - B); t = Math.max(0, Math.min(1, t)); return Math.pow(t, 1.8); };
  // 4) Marcas de dobleces y arrugas: componentes muy largas y finas (no hay letras así), oscuras o tenues
  const darkMask = new Float32Array(n); for (let i = 0; i < n; i++) darkMask[i] = sharp[i] < B + (Wat(i) - B) * 0.85 ? 1 : 0;
  const tc0 = performance.now();
  const crease = sFindCreases(darkMask, w, h);
  const tc1 = performance.now();
  const txt = mode === 'color' ? null : sTextKeep(sharp, w, h, i => B + (Wat(i) - B) * 0.55, i => B + (Wat(i) - B) * 0.85, (W - B) * 0.3, B + (W - B) * 0.38);
  const tc2 = performance.now();
  // un píxel de holgura alrededor de cada doblez (solo si hubo dobleces)
  let creaseG = crease;
  if (crease.some(v => v)) { creaseG = new Uint8Array(n); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (crease[i] || (x > 0 && crease[i - 1]) || (x < w - 1 && crease[i + 1]) || (y > 0 && crease[i - w]) || (y < h - 1 && crease[i + w])) creaseG[i] = 1; } }
  const o = d;
  for (let i = 0; i < n; i++) {
    // junto al dedo solo sobrevive la tinta clara y oscura del texto (no la sombra ni la piel)
    const white = fGrown[i] || creaseG[i] || (txt && !txt[i]) || (fBand[i] && (skin[i] || sharp[i] > B + (Wat(i) - B) * 0.45));
    const L = white ? 255 : Math.round(lv(sharp[i], Wat(i)) * 255);
    if (mode === 'color' && L < 255) {
      // Color: la luminosidad es la misma del modo mejorado; se conserva el tono original (sellos, logos, tinta azul)
      const k = 255 / Math.max(30, bg[i]), f = [0, 1, 2].map(c => Math.min(255, d[i * 4 + c] * wb[c] * k)), fl = 0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2];
      for (let c = 0; c < 3; c++) o[i * 4 + c] = Math.max(0, Math.min(255, Math.round(L + (f[c] - fl) * 1.15 * (1 - L / 255))));
    } else { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = L; }
    o[i * 4 + 3] = 255;
  }
  // Restos del fondo pegados al borde (franja del 4 %)
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.04)), band2 = Math.max(2, Math.round(Math.min(w, h) * 0.015)), seen = new Uint8Array(n), st = [];
  const inBand = (x, y) => x < band || y < band || x >= w - band || y >= h - band;
  const inBand2 = (x, y) => x < band2 || y < band2 || x >= w - band2 || y >= h - band2;
  const lum = i => 0.299 * o[i * 4] + 0.587 * o[i * 4 + 1] + 0.114 * o[i * 4 + 2];
  for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
  while (st.length) {
    const i = st.pop(); if (seen[i]) continue; seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (lum(i) > 170) {
      if (inBand2(x, y)) { if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w); }
      continue;
    }
    if (!inBand(x, y)) continue;
    o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255;
    if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w);
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').putImageData(id, 0, 0);
  if (typeof window !== 'undefined' && window.SCAN_DEBUG) window.__cleanT = { creases: Math.round(tc1 - tc0), textKeep: Math.round(tc2 - tc1) };
  return { canvas: out, fingers: C.sum(Array.from(finger)), charH: txt ? txt.charH : 0 };
}

/* Dobleces y arrugas: líneas largas, finas y suaves que cruzan la hoja. Se busca la curva del doblez dentro de
   cada componente larga y se borran solo los puntos finos sobre esa curva; las letras que la cruzan se conservan
   (su trazo vertical es mucho más alto que el grosor del doblez). */
function sFindCreases(mask, w, h) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), out = new Uint8Array(n);
  const t = Math.max(2, Math.round(w / 300)); // grosor máximo de un doblez
  let id = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (!mask[s0] || lab[s0]) continue;
    id++; let sp = 0; stack[sp++] = s0; lab[s0] = id; const px = []; let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (sp) { const p = stack[--sp]; px.push(p); const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1]) { if (q < 0 || q >= n || !mask[q] || lab[q]) continue; if (Math.abs((q % w) - x) > 1) continue; lab[q] = id; stack[sp++] = q; } }
    const horiz = (x1 - x0) >= (y1 - y0), span = horiz ? x1 - x0 : y1 - y0;
    if (span < (horiz ? w : h) * 0.18) continue; // los dobleces tenues llegan partidos en tramos
    // Posición del doblez en cada columna (o fila): la mediana de los puntos de la componente
    const L = span + 1, buckets = Array.from({ length: L }, () => []);
    for (const p of px) { const x = p % w, y = (p / w) | 0; if (horiz) buckets[x - x0].push(y); else buckets[y - y0].push(x); }
    const pts = [];
    for (let k = 0; k < L; k += 2) { const b = buckets[k]; if (!b.length) continue; b.sort((a, c) => a - c); pts.push([k, b[b.length >> 1]]); }
    if (pts.length < L * 0.25) continue;
    // Ajuste robusto de una curva suave (parábola) a esas posiciones
    let coef = null, use = pts;
    for (let it = 0; it < 3; it++) {
      let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
      for (const [k, v] of use) { const u = k / L, f = [1, u, u * u]; for (let a = 0; a < 3; a++) { R[a] += f[a] * v; for (let c = 0; c < 3; c++) S[a][c] += f[a] * f[c]; } }
      coef = sSolve(S, R); if (!coef) break;
      const res = use.map(([k, v]) => Math.abs(v - (coef[0] + coef[1] * k / L + coef[2] * (k / L) ** 2)));
      const lim = Math.max(t * 1.5, res.slice().sort((a, b) => a - b)[Math.floor(res.length * 0.6)] * 2);
      use = use.filter((_, i) => res[i] <= lim);
    }
    if (!coef) continue;
    const at = k => coef[0] + coef[1] * k / L + coef[2] * (k / L) ** 2;
    // ¿Es de verdad una línea? La mayoría de columnas debe tener un punto sobre la curva
    let on = 0, tot = 0;
    for (let k = 0; k < L; k++) { const b = buckets[k]; if (!b.length) continue; tot++; if (b.some(v => Math.abs(v - at(k)) <= t * 1.5)) on++; }
    if (tot < L * 0.5 || on / tot < 0.75) continue;
    // Recorrido real del doblez (sigue curvas suaves, no solo la parábola), suavizado
    const raw = new Array(L).fill(NaN);
    for (let k = 0; k < L; k++) { const c = at(k), b = buckets[k].filter(v => Math.abs(v - c) <= t * 4); if (b.length) raw[k] = b[b.length >> 1]; }
    let last = NaN; for (let k = 0; k < L; k++) { if (Number.isFinite(raw[k])) last = raw[k]; else raw[k] = Number.isFinite(last) ? last : at(k); }
    const cen = raw.map((_, k) => { let s = 0, m = 0; for (let j = Math.max(0, k - 12); j <= Math.min(L - 1, k + 12); j++) { s += raw[j]; m++; } return s / m; });
    // Borrar solo los puntos finos sobre el doblez, y solo donde no hay texto cerca
    const near = new Uint8Array(L), Hn = t * 6;
    for (let k = 0; k < L; k++) { const c = cen[k]; if (buckets[k].some(v => Math.abs(v - c) > t * 2.5 && Math.abs(v - c) <= Hn)) near[k] = 1; }
    const nearW = new Uint8Array(L); for (let k = 0; k < L; k++) if (near[k]) for (let j = Math.max(0, k - Hn); j <= Math.min(L - 1, k + Hn); j++) nearW[j] = 1;
    for (let k = 0; k < L; k++) {
      if (nearW[k]) continue;
      const c = Math.round(cen[k]);
      for (let dv = -t * 2; dv <= t * 2; dv++) {
        const v = c + dv, x = horiz ? x0 + k : v, y = horiz ? v : y0 + k;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x; if (lab[p] !== id) continue;
        let run = 1;
        if (horiz) { for (let yy = y - 1; yy >= 0 && mask[yy * w + x]; yy--) run++; for (let yy = y + 1; yy < h && mask[yy * w + x]; yy++) run++; }
        else { for (let xx = x - 1; xx >= 0 && mask[y * w + xx]; xx--) run++; for (let xx = x + 1; xx < w && mask[y * w + xx]; xx++) run++; }
        if (run <= t * 2.2) out[p] = 1;
      }
    }
  }
  return out;
}
// Quita de la máscara de tinta las componentes que son líneas largas y finas (dobleces marcados)
function sCleanLongStrokes(mask, w, h) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n); let id = 0;
  const stroke = Math.max(2, w / 220); // grosor típico de un trazo
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s]) continue;
    id++; let sp = 0; stack[sp++] = s; lab[s] = id; const px = [];
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (sp) { const p = stack[--sp]; px.push(p); const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1]) { if (q < 0 || q >= n || !mask[q] || lab[q]) continue; const qx = q % w; if (Math.abs(qx - x) > 1) continue; lab[q] = id; stack[sp++] = q; } }
    const len = Math.hypot(x1 - x0, y1 - y0);
    // una componente más larga que 1/3 del ancho y muy delgada en promedio no es texto
    if (len > w * 0.33 && px.length / len < stroke * 2.2) for (const p of px) mask[p] = 0;
  }
}

function scanRotate(canvas, quad, curve) {
  const w = canvas.width, h = canvas.height, out = document.createElement('canvas'); out.width = h; out.height = w;
  const c = out.getContext('2d'); c.translate(h, 0); c.rotate(Math.PI / 2); c.drawImage(canvas, 0, 0);
  const q = quad ? quad.map(([x, y]) => [h - y, x]) : null;
  return { canvas: out, quad: q ? [q[3], q[0], q[1], q[2]] : null, curve: curve ? curveRotate(curve) : null };
}
function canvasToBlob(cv, type, q) { return new Promise(res => cv.toBlob(res, type, q)); }
function scaleCanvas(src, maxSide) {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height)); if (k === 1) return src;
  const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}
async function imageFileToCanvas(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, (maxSide || 3000) / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  } finally { URL.revokeObjectURL(url); }
}

/* ================= PDF (una página con la imagen y el texto leído invisible para poder buscarlo) ================= */
function pdfStr(s) { // WinAnsi básico: latin-1 directo, lo demás como "?"
  let o = ''; for (const ch of String(s)) { const c = ch.charCodeAt(0); const cc = c < 256 ? ch : '?'; o += cc === '(' || cc === ')' || cc === '\\' ? '\\' + cc : cc; } return o;
}
async function buildReceiptPdf(jpegBlob, pxW, pxH, words) {
  const jpg = new Uint8Array(await jpegBlob.arrayBuffer());
  const W = 226.77, H = +(W * pxH / pxW).toFixed(2); // ancho de tirilla de 80 mm
  const sx = W / pxW, sy = H / pxH;
  let text = '';
  for (const wd of words || []) {
    const t = String(wd.text || '').trim(); if (!t || !wd.bbox) continue;
    const { x0, y0, x1, y1 } = wd.bbox, fs = Math.max(2, (y1 - y0) * sy * 0.92), wpt = (x1 - x0) * sx;
    const tz = Math.max(20, Math.min(300, 100 * wpt / Math.max(1, 0.5 * fs * t.length)));
    text += `BT /F1 ${fs.toFixed(2)} Tf 3 Tr ${tz.toFixed(1)} Tz ${(x0 * sx).toFixed(2)} ${(H - y1 * sy + (y1 - y0) * sy * 0.2).toFixed(2)} Td (${pdfStr(t)}) Tj ET\n`;
  }
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n${text}`;
  const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  const parts = [], offsets = []; let len = 0;
  const push = p => { const u = typeof p === 'string' ? enc(p) : p; parts.push(u); len += u.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
  const cb = enc(content);
  obj(5, [`<< /Length ${cb.length} >>\nstream\n`, cb, '\nendstream']);
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const xref = len;
  let x = 'xref\n0 7\n0000000000 65535 f \n'; for (let i = 1; i <= 6; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x); push(`trailer\n<< /Size 7 /Root 1 0 R /Info << /Producer (WalletWeb) /Title (Factura) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
function ocrWords(data) {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

/* ================= Interfaz del escáner ================= */
const SC = { el: null, stream: null, timer: null, last: null, stable: 0, auto: true, onDone: null, src: null, quad: null, curve: null, mode: 'clean', drag: -1 };
function openScanner(onDone, preset) {
  closeScanner();
  SC.onDone = onDone; SC.auto = S.settings.scanAuto !== false; SC.mode = S.settings.scanMode || 'clean';
  const el = document.createElement('div'); el.className = 'scanner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Escanear factura');
  document.body.appendChild(el); SC.el = el; document.body.style.overflow = 'hidden';
  if (preset) { scanEditor(preset.canvas, preset.quad, preset.curve, preset.userCurve, preset.manual); return; }
  el.innerHTML = `<div class="sc-top"><button class="sc-btn" data-sc="close" aria-label="Cerrar">${ic('x')}</button><div class="sc-title">Escanear factura</div><button class="sc-btn sc-auto" data-sc="auto" aria-pressed="${SC.auto}">Auto</button></div>
    <div class="sc-stage"><video playsinline muted autoplay></video><canvas class="sc-ov"></canvas><div class="sc-msg" role="status">Abriendo la cámara…</div></div>
    <div class="sc-hint">Pon la tirilla estirada sobre una superficie oscura. ${SC.auto ? 'Se toma sola cuando la detecta quieta.' : 'Toca el botón para tomarla.'}</div>
    <div class="sc-bar"><label class="sc-side">${ic('upload')}<span>Galería</span><input type="file" accept="image/*" class="sr-only" data-sc-file></label>
      <button class="sc-shutter" data-sc="shot" aria-label="Tomar foto"><span></span></button><label class="sc-side">${ic('camera')}<span>Foto HD</span><input type="file" accept="image/*" capture="environment" class="sr-only" data-sc-file></label></div>`;
  startCamera();
}
async function startCamera() {
  const v = $('video', SC.el), msg = $('.sc-msg', SC.el);
  if (!navigator.mediaDevices?.getUserMedia) { msg.innerHTML = 'Este navegador no permite usar la cámara aquí.<br>Usa <b>Galería</b>.'; return; }
  try {
    SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false });
    try { const tr = SC.stream.getVideoTracks()[0], cap = tr.getCapabilities ? tr.getCapabilities() : {}; if (cap.focusMode && cap.focusMode.includes('continuous')) await tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* */ }
    if (!SC.el) { stopCamera(); return; }
    v.srcObject = SC.stream; await v.play().catch(() => {});
    msg.textContent = 'Buscando la factura…';
    SC.timer = setInterval(scanTick, 200);
  } catch (e) {
    msg.innerHTML = (IN_FRAME ? 'La vista previa de Claude no permite la cámara.' : e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en Ajustes del iPhone → Safari → Cámara.' : 'No se pudo abrir la cámara.') + '<br>Usa <b>Galería</b>.';
  }
}
function stopCamera() { clearInterval(SC.timer); SC.timer = null; if (SC.stream) SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
function closeScanner() { stopCamera(); if (SC.el) { SC.el.remove(); SC.el = null; } if (!sheets.length) document.body.style.overflow = ''; }
// Dibuja sobre el video el contorno detectado y dispara la captura automática cuando está quieto
function scanTick() {
  const v = $('video', SC.el), ov = $('.sc-ov', SC.el), msg = $('.sc-msg', SC.el);
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  const vw = v.videoWidth, vh = v.videoHeight, r = v.getBoundingClientRect();
  ov.width = r.width * devicePixelRatio; ov.height = r.height * devicePixelRatio;
  const k = Math.min(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
  // Primero el método por texto (versión liviana); si no hay texto visible, el clásico por contraste
  const det = sDetectWS(v, vw, vh, 320) || scanDetect(v, vw, vh);
  const c = ov.getContext('2d'); c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); c.clearRect(0, 0, r.width, r.height);
  const good = det && det.score > 0.82 && det.cover > 0.12;
  if (det && det.score > 0.6) {
    c.beginPath(); det.quad.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](ox + x * k, oy + y * k)); c.closePath();
    c.fillStyle = good ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)'; c.fill();
    c.setLineDash(good ? [] : [8, 6]);
    c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.45)'; c.stroke();
    c.lineWidth = 3; c.strokeStyle = good ? '#fff' : 'rgba(255,255,255,.7)'; c.stroke();
    c.setLineDash([]);
    det.quad.forEach(([x, y]) => { c.beginPath(); c.arc(ox + x * k, oy + y * k, 7, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.5)'; c.stroke(); });
  }
  if (good && SC.last) {
    const mv = Math.max(...det.quad.map((p, i) => Math.hypot(p[0] - SC.last[i][0], p[1] - SC.last[i][1]))) / Math.hypot(vw, vh);
    SC.stable = mv < 0.02 ? SC.stable + 1 : 0;
  } else SC.stable = 0;
  SC.last = good ? det.quad : null;
  const need = 7; // ~1,4 s quieto
  msg.textContent = !det || det.score <= 0.6 ? 'Buscando la factura…' : !good ? 'Acércate un poco y pon la tirilla sobre un fondo oscuro' : SC.auto ? (SC.stable >= 2 ? 'Quieto… tomando la foto' : 'Factura detectada · mantén quieto') : 'Factura detectada · toca el botón';
  const sh = $('.sc-shutter', SC.el); if (sh) sh.style.setProperty('--p', SC.auto ? Math.min(1, SC.stable / need) : 0);
  if (SC.auto && good && SC.stable >= need) scanShot(det.quad);
}
async function scanShot(quad) {
  const v = $('video', SC.el); if (!v || !v.videoWidth) { toast('La cámara aún no está lista.'); return; }
  if (SC.shooting) return; SC.shooting = true;
  const vw = v.videoWidth, vh = v.videoHeight;
  let cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
  cv.getContext('2d').drawImage(v, 0, 0);
  // Foto completa del sensor cuando el navegador lo permite (Android); en iPhone se usa el cuadro de mayor resolución
  try {
    const tr = SC.stream?.getVideoTracks()[0];
    if (tr && window.ImageCapture) {
      const blob = await new ImageCapture(tr).takePhoto();
      const img = await createImageBitmap(blob);
      if (img.width * img.height > vw * vh * 1.3) {
        const k = img.width / vw, big = document.createElement('canvas'); big.width = img.width; big.height = img.height;
        big.getContext('2d').drawImage(img, 0, 0); cv = big;
        if (quad) quad = quad.map(([x, y]) => [x * k, y * (img.height / vh)]);
      }
    }
  } catch (e) { /* se queda el cuadro del video */ }
  SC.shooting = false;
  stopCamera();
  if (navigator.vibrate) navigator.vibrate(30);
  scanEditor(cv, quad || null);
}
// Pantalla para ajustar el recorte: esquinas (círculos grandes) y curvatura de cada borde (círculos pequeños del medio)
function scanEditor(canvas, quad, curve, userCurve, manual) {
  SC.src = canvas;
  SC.det = null; SC.autoQuad = null; SC.autoInit = null; SC.manual = !!manual;
  if (!curve && !manual) { const a = scanAutoDetect(canvas); if (a.quad) { quad = a.quad; curve = a.curve; SC.det = a.det; SC.autoQuad = a.quad.map(p => p.slice()); } } // detección fina sobre la foto tomada
  SC.quad = (quad || scanFullQuad(canvas.width, canvas.height)).map(p => p.slice());
  SC.curve = curve ? JSON.parse(JSON.stringify(curve)) : curveZero(); SC.userCurve = !!userCurve;
  if (!manual) SC.autoInit = { quad: SC.quad.map(p => p.slice()), curve: JSON.parse(JSON.stringify(SC.curve)) };
  if (SC.manual) scanSetRect(quad ? sQuadBox(SC.quad) : scanStartRect());
  SC.el.innerHTML = `<div class="sc-top"><button class="sc-btn" data-sc="retake" aria-label="Repetir">${ic('left')}</button><div class="sc-title">Ajusta el recorte</div><button class="sc-btn" data-sc="rotate" aria-label="Rotar">${ic('repeat')}</button></div>
    <div class="sc-stage"><canvas class="sc-edit" aria-label="Foto con el recorte. Arrastra las esquinas para ajustarlo."></canvas></div>
    <div class="sc-hint"></div>
    <div class="sc-manual-row"><button type="button" class="sc-btn sc-manual" data-sc="manual"></button></div>
    <div class="sc-bar2"><div class="seg sc-seg" role="group" aria-label="Acabado">${[['clean', 'Mejorada'], ['color', 'Color']].map(([v, l]) => `<button type="button" data-sc="mode" data-v="${v}" aria-pressed="${SC.mode === v}">${l}</button>`).join('')}</div>
      <button class="btn primary sc-done" data-sc="done">${ic('check', 'sm')} Usar</button></div>`;
  const ec = $('.sc-edit', SC.el);
  const pos = e => { const r = ec.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ec.addEventListener('pointerdown', e => {
    const [px, py] = pos(e), t = SC.view; if (!t) return;
    let best = -1, bd = 34;
    scanHandles().forEach((hd, i) => { const dd = Math.hypot(t.ox + hd.x * t.k - px, t.oy + hd.y * t.k - py) - (i < 4 ? 6 : 0); if (dd < bd) { bd = dd; best = i; } });
    if (best < 0 && SC.manual) { // rectángulo manual: tocar adentro y arrastrar lo mueve entero
      const sx = (px - t.ox) / t.k, sy = (py - t.oy) / t.k, r = SC.rect;
      if (sx > r.x0 && sx < r.x1 && sy > r.y0 && sy < r.y1) { best = 8; SC.moveFrom = { sx, sy, r: { ...r } }; }
    }
    if (best >= 0) { SC.drag = best; SC.dragH = best < 8 ? scanHandles()[best] : null; if (best >= 4 && !SC.manual) SC.userCurve = true; SC.base = JSON.parse(JSON.stringify(SC.curve)); ec.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  ec.addEventListener('pointermove', e => {
    if (SC.drag < 0) return; const [px, py] = pos(e), t = SC.view;
    const sx = Math.max(0, Math.min(SC.src.width, (px - t.ox) / t.k)), sy = Math.max(0, Math.min(SC.src.height, (py - t.oy) / t.k));
    if (SC.manual) scanRectDrag(SC.drag, sx, sy, (px - t.ox) / t.k, (py - t.oy) / t.k);
    else if (SC.drag < 4) SC.quad[SC.drag] = [sx, sy];
    else {
      // punto de borde: deforma solo su tramo (campana que llega a cero en los puntos vecinos)
      const hd = SC.dragH, key = hd.key, s0 = hd.s, half = hd.half;
      const [u, v] = sApplyH(sHomography(SC.quad, UNIT), sx, sy);
      const want = key === 't' ? v : key === 'b' ? v - 1 : key === 'l' ? u : u - 1;
      const delta = want - curveSample(SC.base[key], s0);
      SC.curve[key] = SC.base[key].map((o, i) => { const d = Math.abs(i / (CURVE_N - 1) - s0) / half, kk = d < 1 ? Math.pow(Math.cos(Math.PI / 2 * d), 2) : 0; return Math.max(-0.3, Math.min(0.3, o + delta * kk)); });
    }
    drawEditor(); e.preventDefault();
  });
  const up = () => { SC.drag = -1; drawEditor(); };
  ec.addEventListener('pointerup', up); ec.addEventListener('pointercancel', up);
  scanEditorUI();
  requestAnimationFrame(drawEditor);
}
/* Recorte manual en rectángulo (capturas de pantalla, o cuando la detección automática se equivoca): el recorte es un
   rectángulo recto que se ajusta con las esquinas, los lados o arrastrándolo; la imagen se recorta tal cual, sin
   enderezar renglones ni quitar dedos. */
function scanEditorUI() {
  const h = $('.sc-hint', SC.el), b = $('.sc-manual', SC.el); if (!h || !b) return;
  h.textContent = SC.manual ? 'Arrastra las esquinas o los lados del rectángulo. Toca adentro y arrastra para moverlo.' : 'Círculos grandes: esquinas. Puntos pequeños: arrástralos para seguir la forma del papel.';
  b.setAttribute('aria-pressed', String(SC.manual));
  b.innerHTML = SC.manual ? `${ic('repeat', 'sm')} Volver al recorte automático` : `${ic('edit', 'sm')} Ajustar a mano (rectángulo)`;
}
function sQuadBox(q) { const xs = q.map(p => p[0]), ys = q.map(p => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
function scanStartRect() { const w = SC.src.width, h = SC.src.height, m = Math.round(Math.min(w, h) * 0.03); return { x0: m, y0: m, x1: w - m, y1: h - m }; }
function scanSetRect(r) {
  const w = SC.src.width, h = SC.src.height;
  r = { x0: Math.max(0, Math.min(w, r.x0)), y0: Math.max(0, Math.min(h, r.y0)), x1: Math.max(0, Math.min(w, r.x1)), y1: Math.max(0, Math.min(h, r.y1)) };
  if (r.x1 - r.x0 < 8 || r.y1 - r.y0 < 8) r = scanStartRect();
  SC.rect = r; SC.quad = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]; SC.curve = curveZero(); SC.userCurve = false;
}
// drag: 0–3 esquinas (como en SC.quad), 4–7 lados (arriba, derecha, abajo, izquierda), 8 mover todo
function scanRectDrag(drag, sx, sy, rx, ry) {
  const r = { ...SC.rect }, w = SC.src.width, h = SC.src.height, min = Math.max(24, Math.min(w, h) * 0.04);
  if (drag === 8) {
    const f = SC.moveFrom, bw = f.r.x1 - f.r.x0, bh = f.r.y1 - f.r.y0;
    r.x0 = Math.max(0, Math.min(w - bw, f.r.x0 + rx - f.sx)); r.y0 = Math.max(0, Math.min(h - bh, f.r.y0 + ry - f.sy)); r.x1 = r.x0 + bw; r.y1 = r.y0 + bh;
  } else {
    const L = drag === 0 || drag === 3 || drag === 7, R = drag === 1 || drag === 2 || drag === 5, T = drag === 0 || drag === 1 || drag === 4, B = drag === 2 || drag === 3 || drag === 6;
    if (L) r.x0 = Math.min(sx, r.x1 - min); if (R) r.x1 = Math.max(sx, r.x0 + min);
    if (T) r.y0 = Math.min(sy, r.y1 - min); if (B) r.y1 = Math.max(sy, r.y0 + min);
  }
  SC.rect = r; SC.quad = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
}
function scanToggleManual() {
  if (SC.manual) {
    SC.manual = false;
    if (!SC.autoInit) { const a = scanAutoDetect(SC.src); SC.det = a.det; SC.autoQuad = a.quad ? a.quad.map(p => p.slice()) : null; SC.autoInit = { quad: (a.quad || scanFullQuad(SC.src.width, SC.src.height)).map(p => p.slice()), curve: a.curve || curveZero() }; }
    SC.quad = SC.autoInit.quad.map(p => p.slice()); SC.curve = JSON.parse(JSON.stringify(SC.autoInit.curve)); SC.userCurve = false;
  } else { SC.manual = true; scanSetRect(scanStartRect()); }
  scanEditorUI(); drawEditor();
}
// Puntos de control: 0–3 esquinas; después varios puntos por borde (más en los bordes largos) para dar formas irregulares
function scanHandles() {
  if (SC.manual) { const r = SC.rect, mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    return [...SC.quad.map(([x, y]) => ({ x, y, corner: true })), { x: mx, y: r.y0 }, { x: r.x1, y: my }, { x: mx, y: r.y1 }, { x: r.x0, y: my }]; }
  const H = sHomography(UNIT, SC.quad), k = SC.view ? SC.view.k : 1, out = SC.quad.map(([x, y]) => ({ x, y, corner: true }));
  const len = (a, b) => Math.hypot(SC.quad[a][0] - SC.quad[b][0], SC.quad[a][1] - SC.quad[b][1]) * k;
  const edges = [['t', len(0, 1)], ['r', len(1, 2)], ['b', len(3, 2)], ['l', len(0, 3)]];
  for (const [key, L] of edges) {
    const nh = Math.max(1, Math.min(3, Math.floor(L / 95))), half = 1 / (nh + 1);
    for (let j = 1; j <= nh; j++) {
      const s = j * half, uv = key === 't' ? [s, 0] : key === 'b' ? [s, 1] : key === 'l' ? [0, s] : [1, s];
      const [px, py] = coons(SC.curve, uv[0], uv[1]), [x, y] = sApplyH(H, px, py);
      out.push({ x, y, key, s, half });
    }
  }
  return out;
}
function drawEditor() {
  const ec = SC.el && $('.sc-edit', SC.el); if (!ec) return;
  const r = ec.getBoundingClientRect(); ec.width = r.width * devicePixelRatio; ec.height = r.height * devicePixelRatio;
  const c = ec.getContext('2d'); c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); c.clearRect(0, 0, r.width, r.height);
  const k = Math.min(r.width / SC.src.width, r.height / SC.src.height), ox = (r.width - SC.src.width * k) / 2, oy = (r.height - SC.src.height * k) / 2;
  SC.view = { k, ox, oy };
  c.drawImage(SC.src, ox, oy, SC.src.width * k, SC.src.height * k);
  const P = curveOutline(SC.quad, SC.curve, 24).map(([x, y]) => [ox + x * k, oy + y * k]);
  c.save(); c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.rect(0, 0, r.width, r.height); P.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y)); c.closePath(); c.fill('evenodd'); c.restore();
  c.beginPath(); P.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y)); c.closePath();
  c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.35)'; c.stroke(); c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke();
  scanHandles().forEach((hd, i) => {
    const X = ox + hd.x * k, Y = oy + hd.y * k, big = i < 4, rad = (big ? 12 : 7) + (SC.drag === i ? 4 : 0);
    c.beginPath(); c.arc(X, Y, rad, 0, Math.PI * 2); c.fillStyle = big ? 'rgba(255,255,255,.35)' : '#fff'; c.fill();
    c.lineWidth = big ? 3 : 2; c.strokeStyle = big ? '#fff' : 'rgba(0,0,0,.45)'; c.stroke();
  });
}
// Detección automática sobre una foto (la misma que usa el editor de recorte)
function scanAutoDetect(canvas) {
  const det = scanDetect(canvas, canvas.width, canvas.height, 900);
  if (det && det.score > 0.6) { const rf = scanRefine(det); return { quad: rf.quad, curve: rf.curve, det }; }
  return { quad: null, curve: null, det };
}
// Máscara del papel (de la detección) llevada al recorte: 1 = papel, 0 = dedos, mano o fondo
function sWarpMask(mask, quad, curve, W, H) {
  const { m, w, h, k } = mask, Hm = sHomography(UNIT, quad), out = new Uint8Array(W * H);
  const md = sMorph(Float32Array.from(m), w, h, 1, true); // un píxel de holgura: no recortar letras del borde
  const ct = new Float32Array(W), cb = new Float32Array(W), cl = new Float32Array(H), cr = new Float32Array(H);
  for (let u = 0; u < W; u++) { const s = (u + 0.5) / W; ct[u] = curveSample(curve.t, s); cb[u] = curveSample(curve.b, s); }
  for (let v = 0; v < H; v++) { const s = (v + 0.5) / H; cl[v] = curveSample(curve.l, s); cr[v] = curveSample(curve.r, s); }
  for (let v = 0; v < H; v++) {
    const vv = (v + 0.5) / H;
    for (let u = 0; u < W; u++) {
      const uu = (u + 0.5) / W, px = uu + (1 - uu) * cl[v] + uu * cr[v], py = vv + (1 - vv) * ct[u] + vv * cb[u];
      const z = Hm[6] * px + Hm[7] * py + 1, x = Math.round((Hm[0] * px + Hm[1] * py + Hm[2]) / z * k - 0.5), y = Math.round((Hm[3] * px + Hm[4] * py + Hm[5]) / z * k - 0.5);
      out[v * W + u] = x >= 0 && y >= 0 && x < w && y < h ? (md[y * w + x] ? 1 : 0) : 0;
    }
  }
  return out;
}
// Procesamiento completo de "Usar": recorte con perspectiva/curva, enderezado y limpieza.
// det: detección automática; si el recorte no se movió a mano, todo lo que no es papel (dedos, mano, fondo) queda en blanco.
function scanProcess(src, quad, curve, userCurve, mode, det, manual) {
  quad = quad || scanFullQuad(src.width, src.height); curve = curve || curveZero();
  const side = scanTargetSide(src, quad);
  if (manual) { // rectángulo manual: recorte tal cual (una captura de pantalla ya está derecha)
    const crop = scanWarp(src, quad, side, curveZero()), res = scanClean(crop, mode || 'clean');
    res.flatSrc = crop; res.flatMode = mode || 'clean';
    return res;
  }
  let warped = scanWarp(src, quad, side, curve), used = curve;
  // Si la curva vino de la detección (no la tocaste), se verifica que de verdad mejore: con bordes mal medidos
  // la curva podría torcer el texto en "S". Se queda la versión con renglones más nítidos.
  if (!userCurve && ['t', 'r', 'b', 'l'].some(k => curve[k].some(v => Math.abs(v) > 0.004))) {
    const flat = scanWarp(src, quad, side, curveZero());
    const sh = cv => { const s = sInkSmall(cv, 300); return sRowSharpness(s.ink, s.Wd, s.Hd, null); };
    if (sh(warped) < sh(flat) * 1.04) { warped = flat; used = curveZero(); } // la curva solo se usa si mejora claramente
  }
  if (det && det.view === 'ws' && det.mask) {
    const W = warped.width, H = warped.height, pm = sWarpMask(det.mask, quad, used, W, H);
    let keep = 0; for (let i = 0; i < pm.length; i++) keep += pm[i];
    if (keep > pm.length * 0.6) { // con una máscara razonable: lo que no es papel se pinta del color del papel
      const ctx = warped.getContext('2d', { willReadFrequently: true }), id = ctx.getImageData(0, 0, W, H), dd = id.data, ch = [[], [], []];
      for (let i = 0; i < W * H; i += 53) if (pm[i]) for (let c = 0; c < 3; c++) ch[c].push(dd[i * 4 + c]);
      const paper = ch.map(v => { v.sort((x, y) => x - y); return v[Math.floor(v.length * 0.85)] || 245; });
      for (let i = 0; i < W * H; i++) if (!pm[i]) { dd[i * 4] = paper[0]; dd[i * 4 + 1] = paper[1]; dd[i * 4 + 2] = paper[2]; }
      ctx.putImageData(id, 0, 0);
    }
  }
  const T = [performance.now()];
  let level = scanDeskew(warped).canvas; T.push(performance.now()); // gira el texto si viene inclinado
  const pre = level; level = scanDewarp(level, 3); T.push(performance.now()); // endereza cada renglón (papel arrugado), hasta 3 pasadas
  let straight = level; for (let i = 0; i < 4; i++) { const nx = scanStraighten(straight); if (nx === straight) break; straight = nx; } T.push(performance.now()); // endereza renglones (hasta 4 pasadas, solo si mejora)
  const res = scanClean(straight, mode || 'clean'); T.push(performance.now()); res.canvas = scanTrim(res.canvas);
  res.flatSrc = pre; res.flatMode = mode || 'clean'; // lectura de respaldo: sin enderezar renglones y con la otra limpieza
  if (typeof window !== 'undefined' && window.SCAN_DEBUG) window.__scanT = { deskew: Math.round(T[1] - T[0]), dewarp: Math.round(T[2] - T[1]), straighten: Math.round(T[3] - T[2]), clean: Math.round(T[4] - T[3]) };
  return res;
}
// Copia para el lector de texto: con letras pequeñas (menos de ~26 px de alto) lee mucho mejor si se amplía
// La misma foto sin enderezar renglones: si la primera lectura queda incompleta, se lee también esta y se combinan
// Limpieza de la versión publicada (v1.35, otra sesión): luz en dos escalas y umbral por zonas. Se usa en la lectura de
// respaldo: lee mejor algunos tiquetes que la limpieza principal y viceversa.
function sInkScale(ink, w, h) {
  const runs = [];
  for (let y = 0; y < h; y += 2) { let r = 0; for (let x = 0; x <= w; x++) { if (x < w && ink[y * w + x]) r++; else { if (r >= 1 && r <= 40) runs.push(r); r = 0; } } }
  // moda (no mediana): las letras dan muchos trazos del mismo grosor; sombras y manchas dan largos dispersos
  const cnt = new Float32Array(42); for (const r of runs) cnt[r]++;
  let best = 0, sw = 2;
  for (let r = 2; r <= 40; r++) { const v = cnt[r - 1] * 0.25 + cnt[r] + cnt[r + 1] * 0.5; if (v > best) { best = v; sw = r; } } // los trazos de 1 px son ruido o bordes
  if (!runs.length) sw = 2;
  sw = Math.max(1.2, Math.min(14, sw));
  return { sw };
}
function sPrintedMask(ink, nv, w, h, sw, fGrown) {
  const { lab, C } = sComponents(ink, w, h, nv);
  const minH = Math.max(4, sw * 2.2);
  // Grosor de cada pieza (distancia al borde): las letras son trazos finos; las sombras de los pliegues, manchas macizas
  {
    const dt = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) dt[p] = ink[p] ? 255 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (!dt[p]) continue;
      const m = Math.min(x > 0 ? dt[p - 1] : 0, y > 0 ? dt[p - w] : 0, x > 0 && y > 0 ? dt[p - w - 1] : 0, x < w - 1 && y > 0 ? dt[p - w + 1] : 0); if (m + 1 < dt[p]) dt[p] = m + 1; }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const p = y * w + x; if (!dt[p]) continue;
      const m = Math.min(x < w - 1 ? dt[p + 1] : 0, y < h - 1 ? dt[p + w] : 0, x < w - 1 && y < h - 1 ? dt[p + w + 1] : 0, x > 0 && y < h - 1 ? dt[p + w - 1] : 0); if (m + 1 < dt[p]) dt[p] = m + 1; }
    const th = new Uint8Array(C.length + 1); for (let p = 0; p < w * h; p++) { const id = lab[p]; if (id && dt[p] > th[id]) th[id] = dt[p]; }
    for (const c of C) c.thick = th[c.id];
  }
  // Alto típico de letra: solo cuentan las piezas que tienen al lado otra de alto parecido a la misma altura
  // (los pedacitos de pliegues no forman filas; las letras sí)
  const pre = C.filter(c => c.h >= minH && c.area >= sw * sw * 1.5 && c.w <= c.h * 9);
  let L = 20, thickL = Math.max(1, Math.round(sw / 2 + 0.5));
  {
    const cs = 32, gw0 = Math.ceil(w / cs) + 1, g0 = new Map();
    pre.forEach((c, i) => { const k = ((c.cy / cs) | 0) * gw0 + ((c.cx / cs) | 0); if (!g0.has(k)) g0.set(k, []); g0.get(k).push(i); });
    const hs = [], ths = [];
    pre.forEach(a => {
      const R = Math.ceil(a.h * 2.5 / cs) + 1, gx = (a.cx / cs) | 0, gy = (a.cy / cs) | 0, Ry = Math.ceil(a.h / cs) + 1;
      let ok = false;
      for (let yy = gy - Ry; yy <= gy + Ry && !ok; yy++) for (let xx = gx - R; xx <= gx + R && !ok; xx++) {
        const lst = g0.get(yy * gw0 + xx); if (!lst) continue;
        for (const j of lst) { const b = pre[j]; if (b === a) continue;
          if (Math.max(a.h, b.h) > 1.5 * Math.min(a.h, b.h) || Math.abs(a.cy - b.cy) > 0.35 * Math.max(a.h, b.h)) continue;
          const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1); if (gap > 1.5 * Math.max(a.h, b.h) || gap < -0.3 * Math.min(a.w, b.w)) continue;
          ok = true; break; }
      }
      if (ok) { hs.push(a.h); ths.push(a.thick); }
    });
    hs.sort((a, b) => a - b); ths.sort((a, b) => a - b);
    if (ths.length >= 8) thickL = ths[ths.length >> 1];
    if (hs.length >= 8) L = hs[hs.length >> 1];
    else { const h2 = pre.map(c => c.h).sort((a, b) => a - b); if (h2.length) L = h2[Math.floor(h2.length * 0.6)]; }
  }
  // Trazo largo, fino y torcido: pliegue (una letra, aunque sea "I", "l" o "/", no es más alta que un renglón)
  const isStroke = c => {
    const len = c.major, thick = c.area / Math.max(1, len), horiz = c.ang < 3 || c.ang > 177, vert = Math.abs(c.ang - 90) < 12;
    // una "C" o "(" grande es curva; una "I", "l" o "1" grande es vertical y no más alta que unas pocas letras
    return len > (vert ? 3.2 : 2.2) * L && thick < sw * 1.9 && len > 6 * thick && !horiz && c.minor < 0.35 * len; // más cortas: ver isDiag
  };
  // Mancha maciza (sombra de un pliegue): gruesa y con forma de hoja (llena poco su recuadro). Una "M" negrita o un
  // cuadrito del QR son gruesos pero llenan su recuadro
  const isBlob = c => c.thick > Math.max(3.5, thickL + 2, 1.8 * thickL) * Math.max(1, c.h / (1.6 * L)) && c.area / (c.w * c.h) < 0.6;
  // Raya diagonal fina (marca de pliegue o "/"): se decide aparte, mirando si está entre letras como un "/"
  const isDiag = c => { const a = c.ang; return c.major <= 2.2 * L && c.major > 3.2 * Math.max(1, c.minor) && ((a > 18 && a < 75) || (a > 105 && a < 162)); };
  const cand = pre.filter(c => !isStroke(c) && !isBlob(c) && !isDiag(c) && c.h <= 5 * L);
  // Renglones: unir letras vecinas de alto parecido y centradas a la misma altura (sirve para cualquier tamaño)
  const cell = Math.max(8, Math.round(L * 2)), gw = Math.ceil(w / cell) + 1, grid = new Map();
  cand.forEach((c, i) => { const k = ((c.cy / cell) | 0) * gw + ((c.cx / cell) | 0); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const par = cand.map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const deg = new Uint16Array(cand.length), edges = [];
  cand.forEach((a, i) => {
    const R = Math.ceil((a.w / 2 + Math.max(a.h, L) * 3.2 + 2.5 * L) / cell), gx = (a.cx / cell) | 0, gy = (a.cy / cell) | 0; // palabras pegadas: piezas anchas
    for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - R; xx <= gx + R; xx++) {
      const lst = grid.get(yy * gw + xx); if (!lst) continue;
      for (const j of lst) {
        if (j <= i) continue; const b = cand[j];
        const hr = Math.max(a.h, b.h) / Math.min(a.h, b.h); if (hr > 1.9) continue;
        const hm = Math.max(a.h, b.h);
        if (Math.abs(a.cy - b.cy) > 0.42 * hm && Math.abs(a.y1 - b.y1) > 0.25 * hm) continue; // misma línea base o mismo centro
        const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        if (gap > 3.0 * hm) continue;
        if (gap < -0.5 * Math.min(a.w, b.w)) continue; // encimadas: no son letras vecinas
        par[find(i)] = find(j); deg[i]++; deg[j]++; edges.push(i, j);
      }
    }
  });
  const gsize = new Map(); cand.forEach((_, i) => { const r = find(i); gsize.set(r, (gsize.get(r) || 0) + 1); });
  const groups = new Map();
  cand.forEach((c, i) => { const r = find(i); if (gsize.get(r) >= 2) { c.keep = 1; c.grp = r; if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); } });
  // Gráficos compactos y oscuros (QR, logos, sellos)
  for (const c of C) {
    if (c.keep) continue;
    const fill = c.area / (c.w * c.h);
    if (c.h > 1.6 * L && c.w > 1.6 * L && fill > 0.28 && c.mn < 0.55 && c.w < c.h * 3 && c.h < c.w * 3 && c.thick <= 0.2 * Math.min(c.w, c.h) + 2) c.keep = 2;
  }
  // Rayas de separación: muchas rayitas bajas en una misma fila
  const dashes = C.filter(c => !c.keep && c.h <= Math.max(sw * 2.6, 0.5 * L) && c.w >= c.h && c.w <= 3 * L && c.mn < 0.75);
  if (dashes.length >= 3) {
    dashes.sort((a, b) => a.cy - b.cy);
    for (let i = 0; i < dashes.length;) {
      let j = i; while (j + 1 < dashes.length && dashes[j + 1].cy - dashes[i].cy < 0.35 * L) j++;
      const row = dashes.slice(i, j + 1), span = Math.max(...row.map(c => c.x1)) - Math.min(...row.map(c => c.x0));
      if (row.length >= 3 && span >= 4 * L) for (const c of row) c.keep = 3;
      i = j + 1;
    }
  }
  // Líneas rectas impresas (subrayados, recuadros): largas, horizontales y de grosor parejo
  for (const c of C) if (!c.keep && (c.ang < 2.5 || c.ang > 177.5) && c.w > 2 * L && c.h <= sw * 3.5 && c.mn < 0.6) c.keep = 4;
  // Franja de cada renglón: se arma con cada par de letras vecinas (sigue renglones curvos y no mezcla renglones
  // aunque un grupo haya unido dos). Lo que cae dentro puede ser letra pegada a un pliegue.
  const band = new Int32Array(w * h).fill(-1), hhOf = new Map();
  for (const [r, g] of groups) hhOf.set(r, g.map(c => c.h).sort((x, y) => x - y)[g.length >> 1]);
  for (let e = 0; e < edges.length; e += 2) {
    let a = cand[edges[e]], b = cand[edges[e + 1]]; if (a.cx > b.cx) { const t = a; a = b; b = t; }
    const hh = hhOf.get(a.grp) || Math.max(a.h, b.h), ok = c => c.h <= 1.35 * hh;
    // letra con cola de pliegue (más alta que el renglón): se usa la vecina como referencia
    const A = ok(a) ? a : ok(b) ? b : null, B = ok(b) ? b : ok(a) ? a : null;
    const xa = Math.max(0, Math.floor(a.cx - a.w / 2 - 0.6 * hh)), xb = Math.min(w - 1, Math.ceil(b.cx + b.w / 2 + 0.6 * hh)), span = Math.max(1, b.cx - a.cx);
    for (let x = xa; x <= xb; x++) {
      const t = Math.max(0, Math.min(1, (x - a.cx) / span));
      let top, bot;
      if (A && B) { top = A.y0 * (1 - t) + B.y0 * t; bot = A.y1 * (1 - t) + B.y1 * t; const mid = (top + bot) / 2; top = Math.min(top, mid - hh / 2); bot = Math.max(bot, mid + hh / 2); }
      else { const cy = a.cy * (1 - t) + b.cy * t; top = cy - 0.6 * hh; bot = cy + 0.6 * hh; }
      const ya = Math.max(0, Math.floor(top - 0.12 * hh)), yb = Math.min(h - 1, Math.ceil(bot + 0.12 * hh));
      for (let y = ya; y <= yb; y++) band[y * w + x] = 1;
    }
  }
  // "/" de una fecha o de "Placa/Codigo": entre dos letras a la misma altura y muy cerca de ambas
  const kgrid = new Map(), kc = Math.max(8, Math.round(L * 2)), kgw = Math.ceil(w / kc) + 1;
  for (const c of C) if (c.keep === 1) { const k = ((c.cy / kc) | 0) * kgw + ((c.cx / kc) | 0); if (!kgrid.has(k)) kgrid.set(k, []); kgrid.get(k).push(c); }
  const slashOk = c => {
    let left = false, right = false; const gx = (c.cx / kc) | 0, gy = (c.cy / kc) | 0;
    for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - 2; xx <= gx + 2; xx++) for (const o of kgrid.get(yy * kgw + xx) || []) {
      if (o.h < 0.55 * c.h || o.h > 1.4 * c.h || Math.abs(o.y1 - c.y1) > 0.3 * c.h) continue;
      if (o.x1 <= c.x0 + 0.25 * c.w && c.x0 - o.x1 <= 0.6 * c.h) left = true;
      if (o.x0 >= c.x1 - 0.25 * c.w && o.x0 - c.x1 <= 0.6 * c.h) right = true;
    }
    return left && right;
  };
  const inB = new Uint32Array(C.length + 1);
  for (let p = 0; p < w * h; p++) if (lab[p] && band[p] >= 0) inB[lab[p]]++;
  for (const c of C) {
    if (c.keep) { if (c.keep === 1 && inB[c.id] < c.area * 0.85) c.clip = 1; continue; } // letra con cola de pliegue: solo lo del renglón
    if (c.h < minH * 0.5 || !inB[c.id]) continue;
    const fr = inB[c.id] / c.area; c.fr = fr;
    if (isBlob(c) || (isDiag(c) && !slashOk(c))) continue;                       // mancha o raya de pliegue
    if (fr > 0.85 && c.h <= 2.2 * L && !isStroke(c)) { c.keep = 5; continue; }   // suelta dentro del renglón (":", "1", "$", "/")
    if (fr >= 0.15 && !isStroke(c) && c.mn < 0.62) { c.keep = 6; c.clip = 1; }  // pegada a un pliegue: solo la parte del renglón
  }
  const keepId = new Uint8Array(C.length + 1), clipId = new Uint8Array(C.length + 1), bc = new Float32Array(C.length + 1);
  for (const c of C) { keepId[c.id] = c.keep; clipId[c.id] = c.clip ? 1 : 0; bc[c.id] = c.mn + 0.25 * (c.mean - c.mn); }
  // Pliegue que atraviesa letras: se quitan los píxeles que forman una línea larga y recta en la dirección de la pieza
  const cut = new Uint8Array(w * h);
  for (const c of C) {
    if (!(c.keep === 6 || (c.keep === 1 && c.clip))) continue;
    const t = c.ang * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t), need = 1.3 * L, far = Math.ceil(3 * L);
    const hit = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const p = y * w + x; if (lab[p] !== c.id) continue;
      let run = 1;
      for (let sgn = -1; sgn <= 1; sgn += 2) for (let k = 1; k < far; k++) {
        const xx = Math.round(x + sgn * k * dx), yy = Math.round(y + sgn * k * dy);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || lab[yy * w + xx] !== c.id) break; run++;
      }
      if (run >= need) hit.push(p);
    }
    for (const p of hit) { cut[p] = 1; const x = p % w;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && lab[q] === c.id && Math.abs((q % w) - x) <= 1) cut[q] = 1; }
  }
  const out = new Uint8Array(w * h), left = new Uint32Array(C.length + 1);
  for (let p = 0; p < w * h; p++) {
    const id = lab[p]; if (!id) continue; const k = keepId[id]; if (!k) continue;
    if (clipId[id] && band[p] < 0) continue;
    if (cut[p]) continue;
    out[p] = k; left[id]++;
  }
  // lo que queda de una pieza recortada y cortada: si son migajas, era pliegue
  const crumbs = Math.max(12, 0.15 * L * L);
  for (let p = 0; p < w * h; p++) { const id = lab[p]; if (out[p] && clipId[id] && left[id] < crumbs) out[p] = 0; }
  if (typeof window !== 'undefined' && window.__scanDebug) Object.assign(window.__scanDebug, { C, slashOk, kgrid, kc, kgw });
  return { mask: out, lab, bc, L, comps: C.length, kept: C.filter(c => c.keep).length };
}
function scanCleanPrinted(canvas, mode) {
  const w = canvas.width, h = canvas.height, n = w * h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const g = new Float32Array(n), skin = new Uint8Array(n);
  const wb = sWhiteGains(d, n); // con luz cálida el papel no debe confundirse con piel ni verse amarillo
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, d[i * 4] * wb[0]), gg = Math.min(255, d[i * 4 + 1] * wb[1]), b = Math.min(255, d[i * 4 + 2] * wb[2]);
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b; skin[i] = sIsSkin(r, gg, b) || (r > gg && gg > b && r - b > 48 && r > 95) ? 1 : 0;
  }
  // Dedos: piel conectada con el borde del recorte
  const finger = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
  const seedF = p => { if (skin[p] && !finger[p]) { finger[p] = 1; stack[sp++] = p; } };
  // Semillas en una franja junto al borde (el recorte puede dejar una línea de mesa entre el dedo y el borde)
  const fb = Math.max(2, Math.round(Math.min(w, h) * 0.025));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < fb || y < fb || x >= w - fb || y >= h - fb) seedF(y * w + x);
  while (sp) { const p = stack[--sp], x = p % w, y = (p / w) | 0;
    if (x > 0) seedF(p - 1); if (x < w - 1) seedF(p + 1); if (y > 0) seedF(p - w); if (y < h - 1) seedF(p + w); }
  const q = Math.max(1, Math.round(Math.min(w, h) / 500)), wq = Math.ceil(w / q), hq = Math.ceil(h / q);
  let fCount = 0; const fq = new Float32Array(wq * hq);
  for (let i = 0; i < n; i++) if (finger[i]) { fCount++; fq[(((i / w) | 0) / q | 0) * wq + ((i % w) / q | 0)] = 1; }
  // Dedo: núcleo (se borra), franja cercana (se borra: sombra del dedo) y franja amplia (solo se borra lo que no es tinta)
  const fGrown = new Uint8Array(n), fBand = new Uint8Array(n);
  if (fCount) {
    const rc = Math.max(1, Math.round(w / 250 / q)), fqC = sMorph(fq, wq, hq, rc, true), fqB = sMorph(fq, wq, hq, Math.max(2, Math.round(w / 45 / q)), true);
    for (let y = 0; y < h; y++) { const row = ((y / q) | 0) * wq; for (let x = 0; x < w; x++) { const j = row + ((x / q) | 0); fGrown[y * w + x] = fqC[j] ? 1 : 0; fBand[y * w + x] = fqB[j] ? 1 : 0; } }
  }
  // 1) Luz del papel a baja resolución (sombras amplias, degradados)
  const gq = new Float32Array(wq * hq);
  for (let y = 0; y < hq; y++) for (let x = 0; x < wq; x++) { let t = 0, c = 0; for (let yy = y * q; yy < Math.min(h, y * q + q); yy++) for (let xx = x * q; xx < Math.min(w, x * q + q); xx++) { const i = yy * w + xx; t += fBand[i] ? 245 : g[i]; c++; } gq[y * wq + x] = t / c; }
  const rT = Math.max(3, Math.round(wq * 0.02)); // más ancho que cualquier trazo de letra
  const closed = sMorph(sMorph(gq, wq, hq, rT, true), wq, hq, Math.round(rT * 0.7), false);
  const bgq = sBoxBlur(closed, wq, hq, Math.max(2, Math.round(rT * 0.8)));
  const bgAt = (x, y) => { const fx = Math.max(0, Math.min(wq - 1.001, x / q - 0.5)), fy = Math.max(0, Math.min(hq - 1.001, y / q - 0.5)), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    return (bgq[y0 * wq + x0] * (1 - ax) + bgq[y0 * wq + x0 + 1] * ax) * (1 - ay) + (bgq[(y0 + 1) * wq + x0] * (1 - ax) + bgq[(y0 + 1) * wq + x0 + 1] * ax) * ay; };
  const bgC = new Float32Array(n), gF = new Float32Array(n), ink0 = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, b = Math.max(30, bgAt(x, y)); bgC[i] = b; gF[i] = fGrown[i] ? b : g[i]; ink0[i] = !fGrown[i] && g[i] / b < 0.6 ? 1 : 0; }
  // 2) Luz fina: sigue cada faceta del papel arrugado (cierre del tamaño de unos pocos trazos)
  const { sw } = sInkScale(ink0, w, h);
  const r1 = Math.max(2, Math.min(18, Math.round(sw * 1.7 + 1)));
  let bgF = sMorph(sMorph(gF, w, h, r1, true), w, h, r1, false);
  bgF = sBoxBlur(bgF, w, h, Math.max(1, r1 >> 1));
  const bg = new Float32Array(n), nv = new Float32Array(n);
  for (let i = 0; i < n; i++) { const b = Math.max(30, bgF[i], g[i], 0.88 * bgC[i]); bg[i] = b; nv[i] = fGrown[i] ? 1 : Math.min(1.1, g[i] / b); }
  // 3) Umbrales de tinta según lo más oscuro de la factura (las tirillas desteñidas tienen la tinta gris)
  const hist = new Uint32Array(111); let cnt = 0;
  for (let i = 0; i < n; i += 2) { if (fGrown[i]) continue; hist[Math.max(0, Math.min(110, Math.round(nv[i] * 100)))]++; cnt++; }
  const pct = f => { let a = 0; for (let b = 0; b <= 110; b++) { a += hist[b]; if (a >= cnt * f) return b / 100; } return 1; };
  const p0 = Math.min(0.8, pct(0.004));
  // Umbrales generosos (no partir letras tenues) y por zona: lo más oscuro de cada zona decide. Un QR muy
  // negro no vuelve invisible el texto gris de al lado. Lo que no es texto lo quita el paso 4.
  const tsOf = p => Math.max(0.6, Math.min(0.84, Math.max(0.58 + 0.25 * p, 0.5 + 0.5 * p)));
  const cs = Math.max(12, Math.round(Math.min(w, h) / 36)), gxn = Math.ceil(w / cs), gyn = Math.ceil(h / cs), Pc = new Float32Array(gxn * gyn);
  {
    const hc = new Uint32Array(111);
    for (let cy = 0; cy < gyn; cy++) for (let cx = 0; cx < gxn; cx++) {
      hc.fill(0); let c = 0;
      for (let y = cy * cs; y < Math.min(h, cy * cs + cs); y += 1) for (let x = cx * cs; x < Math.min(w, cx * cs + cs); x += 1) { const i = y * w + x; if (fGrown[i]) continue; hc[Math.max(0, Math.min(110, Math.round(nv[i] * 100)))]++; c++; }
      let a = 0, pv = 1; if (c) for (let b = 0; b <= 110; b++) { a += hc[b]; if (a >= c * 0.02) { pv = b / 100; break; } }
      Pc[cy * gxn + cx] = pv;
    }
  }
  const TsC = new Float32Array(gxn * gyn);
  for (let cy = 0; cy < gyn; cy++) for (let cx = 0; cx < gxn; cx++) {
    // cada zona con tinta usa su propio nivel; una zona sin tinta toma el de sus vecinas (bordes de letras)
    let m = Pc[cy * gxn + cx];
    if (m > 0.8) for (let yy = Math.max(0, cy - 1); yy <= Math.min(gyn - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(gxn - 1, cx + 1); xx++) m = Math.min(m, Pc[yy * gxn + xx]);
    TsC[cy * gxn + cx] = tsOf(m);
  }
  const TsP = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(gyn - 1.001, y / cs - 0.5)), y0 = fy | 0, ay = fy - y0, y1 = Math.min(gyn - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(gxn - 1.001, x / cs - 0.5)), x0 = fx | 0, ax = fx - x0, x1 = Math.min(gxn - 1, x0 + 1);
      TsP[y * w + x] = (TsC[y0 * gxn + x0] * (1 - ax) + TsC[y0 * gxn + x1] * ax) * (1 - ay) + (TsC[y1 * gxn + x0] * (1 - ax) + TsC[y1 * gxn + x1] * ax) * ay;
    }
  }
  const Ts = tsOf(p0), Tw = Math.min(0.92, Ts + 0.19); // valores globales, solo para depurar
  // Enfoque suave: los trazos finos y tenues se oscurecen un poco respecto a su entorno
  const nvb = sBoxBlur(nv, w, h, 1); for (let i = 0; i < n; i++) if (!fGrown[i]) nv[i] = Math.max(0, nv[i] + 0.6 * (nv[i] - nvb[i]));
  const strong = new Float32Array(n); for (let i = 0; i < n; i++) strong[i] = nv[i] < TsP[i] ? 1 : 0;
  const near = sMorph(strong, w, h, Math.max(1, Math.round(sw * 0.6)), true);
  const ink = new Uint8Array(n); for (let i = 0; i < n; i++) ink[i] = strong[i] || (near[i] && nv[i] < Math.min(0.92, TsP[i] + 0.19)) ? 1 : 0;
  // 4) Solo lo impreso: letras en renglones, rayas de separación, QR y logos
  const pm = sPrintedMask(ink, nv, w, h, sw, fGrown);
  if (typeof window !== 'undefined' && window.__scanDebug) Object.assign(window.__scanDebug, { sw, r1, Ts, Tw, p0, L: pm.L, comps: pm.comps, kept: pm.kept, mask: pm.mask, ink, w, h });
  // 5) Tinta negra pareja sobre blanco (las letras desteñidas quedan oscuras y legibles)
  const o = d;
  for (let i = 0; i < n; i++) {
    let L = 255;
    if (pm.mask[i]) { const ts = TsP[i], tw = Math.min(0.92, ts + 0.19), Bi = Math.min(ts - 0.12, Math.max(0.02, pm.bc[pm.lab[i]])); let t = (nv[i] - Bi) / (tw - Bi); t = t < 0 ? 0 : t > 1 ? 1 : t; L = Math.round(Math.pow(t, 1.5) * 255); }
    if (mode === 'color' && L < 255) {
      // Color: misma luminosidad del modo mejorado; se conserva el tono original (sellos, logos, tinta azul)
      const k = 255 / Math.max(30, bg[i]), f = [0, 1, 2].map(c => Math.min(255, d[i * 4 + c] * wb[c] * k)), fl = 0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2];
      for (let c = 0; c < 3; c++) o[i * 4 + c] = Math.max(0, Math.min(255, Math.round(L + (f[c] - fl) * 1.15 * (1 - L / 255))));
    } else { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = L; }
    o[i * 4 + 3] = 255;
  }
  // Restos del fondo pegados al borde (franja del 4 %)
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.04)), band2 = Math.max(2, Math.round(Math.min(w, h) * 0.015)), seen = new Uint8Array(n), st = [];
  const inBand = (x, y) => x < band || y < band || x >= w - band || y >= h - band;
  const inBand2 = (x, y) => x < band2 || y < band2 || x >= w - band2 || y >= h - band2;
  const lum = i => 0.299 * o[i * 4] + 0.587 * o[i * 4 + 1] + 0.114 * o[i * 4 + 2];
  for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
  while (st.length) {
    const i = st.pop(); if (seen[i]) continue; seen[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (lum(i) > 170) {
      if (inBand2(x, y)) { if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w); }
      continue;
    }
    if (!inBand(x, y)) continue;
    o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255;
    if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w);
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').putImageData(id, 0, 0);
  return { canvas: out, fingers: C.sum(Array.from(finger)) };
}

function scanFlat(res) {
  if (!res || !res.flatSrc) return null;
  let s = res.flatSrc; for (let i = 0; i < 4; i++) { const nx = scanStraighten(s); if (nx === s) break; s = nx; }
  const r2 = scanCleanPrinted(s, res.flatMode || 'clean'); r2.canvas = scanTrim(r2.canvas); return r2;
}
function scanForOcr(res) {
  const cv = res.canvas, hc = res.charH || 0;
  const k = hc ? Math.max(1, Math.min(2.5, 26 / hc)) : 1;
  if (k < 1.15 || cv.width * k * cv.height * k > 16e6) { res.ocrScale = 1; return cv; }
  const o = document.createElement('canvas'); o.width = Math.round(cv.width * k); o.height = Math.round(cv.height * k);
  const x = o.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, o.width, o.height);
  res.ocrScale = o.width / cv.width; return o;
}
// Lado mayor del resultado: ~3,5 millones de píxeles y 3000 px como máximo (≈300 ppp en una tirilla), sin inventar más resolución de la que tiene la foto
function scanTargetSide(src, quad) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const qw = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, qh = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  const long = Math.max(qw, qh), short = Math.max(1, Math.min(qw, qh)), aspect = long / short;
  return Math.round(Math.max(1600, Math.min(long * 1.15, Math.sqrt(3.5e6 * aspect), 3000)));
}
async function scanFinish() {
  const btn = $('.sc-done', SC.el); if (btn) { btn.disabled = true; btn.innerHTML = 'Procesando…'; }
  await new Promise(r => setTimeout(r, 30));
  try {
    const moved = !SC.autoQuad || SC.quad.some((p, i) => Math.hypot(p[0] - SC.autoQuad[i][0], p[1] - SC.autoQuad[i][1]) > 2);
    const res = scanProcess(SC.src, SC.quad, SC.curve, SC.userCurve, SC.mode, moved || SC.userCurve || SC.manual ? null : SC.det, SC.manual);
    const done = SC.onDone, src = SC.src, quad = SC.quad.map(p => p.slice()), curve = JSON.parse(JSON.stringify(SC.curve)), mode = SC.mode, userCurve = SC.userCurve, manual = !!SC.manual;
    closeScanner();
    if (done) await done({ canvas: res.canvas, src, quad, curve, userCurve, manual, mode, fingers: res.fingers, charH: res.charH, flatSrc: res.flatSrc, flatMode: res.flatMode });
  } catch (e) { toast('No se pudo procesar la foto. Intenta de nuevo.'); if (btn) { btn.disabled = false; btn.innerHTML = 'Usar'; } }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sc]'); if (!b || !SC.el || !SC.el.contains(b)) return;
  const a = b.dataset.sc;
  if (a === 'close') closeScanner();
  if (a === 'auto') { SC.auto = !SC.auto; S.settings.scanAuto = SC.auto; save(); b.setAttribute('aria-pressed', String(SC.auto)); SC.stable = 0; const h = $('.sc-hint', SC.el); if (h) h.textContent = 'Pon la tirilla estirada sobre una superficie oscura. ' + (SC.auto ? 'Se toma sola cuando la detecta quieta.' : 'Toca el botón para tomarla.'); }
  if (a === 'shot') scanShot(SC.last);
  if (a === 'retake') { const cb = SC.onDone; openScanner(cb); }
  if (a === 'rotate') { SC.det = null; SC.autoQuad = null; SC.autoInit = null; const r = scanRotate(SC.src, SC.quad, SC.curve); SC.src = r.canvas; SC.quad = r.quad; SC.curve = r.curve; if (SC.manual) scanSetRect(sQuadBox(SC.quad)); drawEditor(); }
  if (a === 'manual') scanToggleManual();
  if (a === 'mode') { SC.mode = b.dataset.v; S.settings.scanMode = SC.mode; save(); $$('[data-sc="mode"]', SC.el).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === SC.mode))); }
  if (a === 'done') scanFinish();
});
document.addEventListener('change', async e => {
  if (!e.target.matches('[data-sc-file]') || !SC.el) return;
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const cv = await imageFileToCanvas(f, 4200); stopCamera(); scanEditor(cv, null, null, false, f.type === 'image/png'); } // PNG = captura de pantalla: empieza con el rectángulo manual
  catch (er) { toast('No se pudo abrir la imagen.'); }
});
window.addEventListener('resize', () => { if (SC.el && $('.sc-edit', SC.el)) drawEditor(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) closeScanner(); });


/* ---------- Visor de la factura (pantalla completa, con zoom) ---------- */
// Saca la foto (JPEG) que va dentro de un PDF. Sirve para los PDF del escáner y para muchos PDF escaneados de otras apps.
async function pdfExtractJpeg(blob) {
  try {
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
    let best = null, at = 0;
    while ((at = s.indexOf('/DCTDecode', at)) >= 0) {
      const d0 = s.lastIndexOf('<<', at), d1 = s.indexOf('stream', at);
      if (d0 < 0 || d1 < 0) break;
      const dict = s.slice(d0, d1);
      let p = d1 + 6; if (s[p] === '\r') p++; if (s[p] === '\n') p++;
      const m = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      let len = m && !m[2] ? +m[1] : -1;
      if (len < 0 || u[p] !== 0xFF || u[p + 1] !== 0xD8) { const e = s.indexOf('endstream', p); len = e > p ? s.lastIndexOf('\xFF\xD9', e) + 2 - p : -1; }
      const W = +(/\/Width\s+(\d+)/.exec(dict) || [])[1] || 0, H = +(/\/Height\s+(\d+)/.exec(dict) || [])[1] || 0;
      if (len > 0 && u[p] === 0xFF && u[p + 1] === 0xD8 && (!best || W * H > best.W * best.H)) best = { p, len, W, H };
      at = d1;
    }
    return best ? new Blob([u.subarray(best.p, best.p + best.len)], { type: 'image/jpeg' }) : null;
  } catch { return null; }
}
const VW = { el: null, urls: [], s: 1, x: 0, y: 0, pts: new Map(), pinch: null, lastTap: 0 };
// opts: { image: Blob|null, pdf: Blob|null, name, sub, canAdjust }
function openViewer(opts) {
  closeViewer();
  const el = document.createElement('div'); el.className = 'viewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Factura');
  const url = b => { const u = URL.createObjectURL(b); VW.urls.push(u); return u; };
  const canShare = !!(opts.pdf && navigator.canShare && navigator.canShare({ files: [new File([opts.pdf], opts.name || 'Factura.pdf', { type: 'application/pdf' })] }));
  el.innerHTML = `<div class="sc-top"><button class="sc-btn" data-vw="close" aria-label="Cerrar">${ic('x')}</button>
      <div class="vw-title"><div class="sc-title">${esc(opts.name || 'Factura')}</div>${opts.sub ? `<div class="vw-sub">${esc(opts.sub)}</div>` : ''}</div>
      <button class="sc-btn" data-vw="zoom" aria-label="Acercar">${ic('zoom')}</button></div>
    <div class="vw-stage">${opts.image ? `<img class="vw-img" alt="Factura escaneada" draggable="false" src="${url(opts.image)}">` : `<div class="vw-empty">${ic('doc')}<p>Este PDF no trae una imagen que se pueda mostrar aquí.</p></div>`}</div>
    <div class="sc-hint">${opts.image ? 'Pellizca o toca dos veces para acercar.' : ''}</div>
    <div class="sc-bar2">${opts.canAdjust ? `<button class="sc-btn" data-vw="adjust" style="flex:1">${ic('edit', 'sm')} Ajustar</button>` : ''}
      ${opts.pdf ? `<a class="sc-btn" style="flex:1;text-decoration:none" href="${url(opts.pdf)}" target="_blank" rel="noopener">${ic('doc', 'sm')} Abrir PDF</a>` : ''}
      ${canShare ? `<button class="sc-btn sc-done" data-vw="share" style="flex:1">${ic('share', 'sm')} Compartir</button>` : opts.pdf ? `<a class="sc-btn sc-done" style="flex:1;text-decoration:none" href="${url(opts.pdf)}" download="${esc(opts.name || 'Factura.pdf')}">${ic('download', 'sm')} Guardar</a>` : ''}</div>`;
  document.body.appendChild(el); VW.el = el; VW.opts = opts; document.body.style.overflow = 'hidden';
  VW.s = 1; VW.x = 0; VW.y = 0; VW.pts.clear(); VW.pinch = null;
  const img = $('.vw-img', el); if (img) img.onload = () => vwApply();
}
function closeViewer() {
  if (!VW.el) return;
  VW.el.remove(); VW.el = null; VW.urls.forEach(u => URL.revokeObjectURL(u)); VW.urls = [];
  if (!SC.el) document.body.style.overflow = '';
}
function vwApply(anim) {
  const img = VW.el && $('.vw-img', VW.el); if (!img) return;
  const st = $('.vw-stage', VW.el).getBoundingClientRect(), w = img.offsetWidth * VW.s, h = img.offsetHeight * VW.s;
  const mx = Math.max(0, (w - st.width) / 2), my = Math.max(0, (h - st.height) / 2);
  VW.x = Math.max(-mx, Math.min(mx, VW.x)); VW.y = Math.max(-my, Math.min(my, VW.y));
  img.style.transition = anim ? 'transform .22s ease' : 'none';
  img.style.transform = `translate(${VW.x}px, ${VW.y}px) scale(${VW.s})`;
}
// Acercar dejando quieto el punto (cx, cy) de la pantalla
function vwZoomAt(ns, cx, cy, anim) {
  const st = $('.vw-stage', VW.el).getBoundingClientRect();
  ns = Math.max(1, Math.min(6, ns));
  const ox = cx - (st.left + st.width / 2), oy = cy - (st.top + st.height / 2), k = ns / VW.s;
  VW.x = ox - (ox - VW.x) * k; VW.y = oy - (oy - VW.y) * k; VW.s = ns;
  if (ns === 1) { VW.x = 0; VW.y = 0; }
  vwApply(anim);
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-vw]'); if (!b || !VW.el) return;
  const a = b.dataset.vw;
  if (a === 'close') closeViewer();
  else if (a === 'zoom') { const st = $('.vw-stage', VW.el).getBoundingClientRect(); vwZoomAt(VW.s > 1.05 ? 1 : 2.5, st.left + st.width / 2, st.top + st.height / 3, true); }
  else if (a === 'adjust') { closeViewer(); if (D?._scan) openScanner(useScan, { canvas: D._scan.src, quad: D._scan.quad, curve: D._scan.curve, userCurve: D._scan.userCurve, manual: D._scan.manual }); }
  else if (a === 'share') {
    const o = VW.opts; try { await navigator.share({ files: [new File([o.pdf], o.name || 'Factura.pdf', { type: 'application/pdf' })], title: o.name || 'Factura' }); } catch (err) { if (err?.name !== 'AbortError') toast('No se pudo compartir.'); }
  }
});
document.addEventListener('pointerdown', e => {
  if (!VW.el || !e.target.closest('.vw-stage') || !$('.vw-img', VW.el)) return;
  e.preventDefault();
  VW.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (VW.pts.size === 2) { const [p, q] = [...VW.pts.values()]; VW.pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), s: VW.s, cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2 }; }
  if (VW.pts.size === 1) {
    const now = Date.now();
    if (now - VW.lastTap < 300) { vwZoomAt(VW.s > 1.05 ? 1 : 2.5, e.clientX, e.clientY, true); VW.lastTap = 0; } else VW.lastTap = now;
  }
}, { passive: false });
document.addEventListener('pointermove', e => {
  if (!VW.el || !VW.pts.has(e.pointerId)) return;
  const prev = VW.pts.get(e.pointerId); VW.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (VW.pts.size >= 2 && VW.pinch) {
    const [p, q] = [...VW.pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const cx = (p[0] + q[0]) / 2, cy = (p[1] + q[1]) / 2;
    VW.x += cx - VW.pinch.cx; VW.y += cy - VW.pinch.cy; VW.pinch.cx = cx; VW.pinch.cy = cy;
    vwZoomAt(VW.pinch.s * d / VW.pinch.d, cx, cy);
  } else if (VW.s > 1) { VW.x += e.clientX - prev[0]; VW.y += e.clientY - prev[1]; vwApply(); }
});
const vwUp = e => { if (!VW.el) return; VW.pts.delete(e.pointerId); if (VW.pts.size < 2) VW.pinch = null; if (VW.s < 1.05 && VW.s !== 1) vwZoomAt(1, 0, 0, true); };
document.addEventListener('pointerup', vwUp); document.addEventListener('pointercancel', vwUp);
document.addEventListener('wheel', e => { if (!VW.el || !e.target.closest('.vw-stage')) return; e.preventDefault(); vwZoomAt(VW.s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY); }, { passive: false });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && VW.el) closeViewer(); });
window.addEventListener('resize', () => { if (VW.el) vwApply(); });
