/* WalletWeb — movimiento y vidrio líquido.
   - Menú inferior: un lente de vidrio se desliza y se estira como agua hasta la pantalla elegida;
     también se puede arrastrar con el dedo sobre la barra.
   - Reflejos: el brillo y el borde de luz del vidrio se desplazan suavemente al hacer scroll.
   - Ondas al tocar botones, transiciones suaves entre pantallas y tinte de color en el formulario
     de movimiento según la categoría elegida.
   Todo respeta "reducir movimiento" del sistema. */
'use strict';
const FX_REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

/* ---------- Lente del menú inferior ---------- */
let lensX = null, lensDrag = null, lensDragEnd = 0;
function lensEl() {
  const tb = $('#tabbar'); if (!tb) return null;
  let l = tb.querySelector('.tab-lens');
  if (!l) { l = document.createElement('span'); l.className = 'tab-lens'; l.setAttribute('aria-hidden', 'true'); tb.prepend(l); lensX = null; }
  return l;
}
function placeLens() {
  const tb = $('#tabbar'), l = lensEl(); if (!tb || !l || lensDrag) return;
  const a = tb.querySelector('.tab[aria-current="page"]');
  if (!a || !a.offsetWidth) { l.style.opacity = '0'; return; }
  const x = a.offsetLeft, w = a.offsetWidth;
  l.style.width = w + 'px'; l.style.height = a.offsetHeight + 'px'; l.style.top = a.offsetTop + 'px';
  l.style.transform = `translateX(${x}px)`; l.style.opacity = '1';
  if (lensX !== null && Math.abs(lensX - x) > 2 && !FX_REDUCED) { l.classList.remove('moving'); void l.offsetWidth; l.classList.add('moving'); }
  lensX = x;
}
const _fxRender = render;
render = function () { _fxRender.apply(this, arguments); requestAnimationFrame(placeLens); };
addEventListener('resize', () => { lensX = null; placeLens(); });

// Arrastrar el lente con el dedo sobre la barra (como en iOS)
(() => {
  const tabs = () => $$('#tabbar .tab');
  const nearest = x => { let best = null, bd = 1e9; for (const t of tabs()) { const r = t.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - x); if (d < bd) { bd = d; best = t; } } return best; };
  document.addEventListener('pointerdown', e => {
    const tb = e.target.closest?.('#tabbar'); if (!tb || e.target.closest('.tab-plus') || sheets.length) return;
    lensDrag = { x0: e.clientX, moved: false, tb };
  });
  document.addEventListener('pointermove', e => {
    if (!lensDrag) return;
    if (!lensDrag.moved && Math.abs(e.clientX - lensDrag.x0) < 8) return;
    const l = lensEl(); if (!l) return;
    lensDrag.moved = true; l.classList.add('drag'); l.style.opacity = '1';
    const r = lensDrag.tb.getBoundingClientRect(), w = l.offsetWidth || 70;
    const x = Math.max(4, Math.min(r.width - w - 4, e.clientX - r.left - w / 2));
    l.style.transform = `translateX(${x}px)`;
    const n = nearest(e.clientX); tabs().forEach(t => t.classList.toggle('hot', t === n));
  });
  const end = e => {
    if (!lensDrag) return;
    const d = lensDrag; lensDrag = null;
    const l = lensEl(); if (l) l.classList.remove('drag');
    tabs().forEach(t => t.classList.remove('hot'));
    if (d.moved) { lensDragEnd = Date.now(); const n = nearest(e.clientX); lensX = null; if (n && n.dataset.v && n.dataset.v !== route) go(n.dataset.v); else placeLens(); }
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => { if (lensDrag) { lensDrag = null; const l = lensEl(); if (l) l.classList.remove('drag'); tabs().forEach(t => t.classList.remove('hot')); placeLens(); } });
  // Tras arrastrar no se cuenta como toque sobre un botón
  document.addEventListener('click', e => { if (Date.now() - lensDragEnd < 400 && e.target.closest('#tabbar')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
})();

/* ---------- Reflejos que se mueven con el scroll ---------- */
(() => {
  if (FX_REDUCED) return;
  let raf = 0;
  const upd = () => {
    raf = 0;
    const y = window.scrollY || 0, root = document.documentElement.style;
    root.setProperty('--shx', (Math.sin(y / 240) * 16).toFixed(2) + '%');
    root.setProperty('--shy', (Math.cos(y / 320) * 10).toFixed(2) + '%');
    root.setProperty('--sha', (Math.sin(y / 300) * 28).toFixed(1) + 'deg');
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
  upd();
})();

/* ---------- Ondas al tocar ---------- */
const RIPPLE_SEL = '.btn, .chip, .tab-plus, .row-item, .cat-btn, .ch-bar, .ch-row, .fam-pick';
document.addEventListener('pointerdown', e => {
  if (FX_REDUCED) return;
  const el = e.target.closest?.(RIPPLE_SEL); if (!el || el.disabled) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span'); s.className = 'fx-ripple';
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(s);
  const a = s.animate([{ transform: 'scale(0)', opacity: .32 }, { transform: 'scale(1)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  a.onfinish = () => s.remove();
}, { passive: true });

/* ---------- Transición entre pantallas ---------- */
const _fxGo = go;
go = function (r) {
  const prev = route; _fxGo.apply(this, arguments);
  if (prev === route || FX_REDUCED) return;
  const v = $('#view'); if (!v || !v.animate) return;
  v.animate([{ opacity: 0, transform: 'translateY(12px) scale(.992)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 460, easing: 'cubic-bezier(.22, 1, .36, 1)' });
};

/* ---------- Tinte del formulario de movimiento según la categoría ---------- */
function txTint() {
  const s = sheets.find(x => x.id === 'tx'); if (!s || !D) return;
  const sh = s.el.querySelector('.sheet'); if (!sh) return;
  let t = sh.querySelector('.sheet-tint');
  if (!t) { t = document.createElement('div'); t.className = 'sheet-tint'; t.setAttribute('aria-hidden', 'true'); sh.prepend(t); }
  const c = catById(D.categoryId);
  const col = (D.type === 'expense' || D.type === 'income') && c ? (D.subcategoryId ? subColor(c, D.subcategoryId) : catColor(c)) : null;
  t.style.setProperty('--cat-col', col || 'transparent');
  sh.classList.toggle('tinted', !!col);
}
const _fxOpenTx = openTxForm;
openTxForm = function () { _fxOpenTx.apply(this, arguments); txTint(); };
const _fxRerenderTx = rerenderTx;
rerenderTx = function () { _fxRerenderTx.apply(this, arguments); txTint(); };

requestAnimationFrame(placeLens);

/* ---------- Pantalla corrida en iPhone ----------
   Al cerrar el teclado o volver a la app, iOS a veces deja la vista desplazada (el saludo aparece más abajo).
   Se corrige empujando el scroll a una posición válida. */
function fixViewport() {
  if (sheets.length) return;
  const y = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
  window.scrollTo(window.scrollX, y + 1); window.scrollTo(window.scrollX, y);
  if (window.visualViewport && window.visualViewport.offsetTop > 0) window.scrollTo(0, y);
}
(() => {
  const vv = window.visualViewport; let lastH = vv ? vv.height : 0;
  if (vv) vv.addEventListener('resize', () => { if (vv.height > lastH + 80) setTimeout(fixViewport, 60); lastH = vv.height; });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) fixViewport(); }, 120));
  addEventListener('pageshow', () => setTimeout(fixViewport, 50));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(fixViewport, 80); });
  const _cs = closeSheet;
  closeSheet = async function () { const r = await _cs.apply(this, arguments); if (!sheets.length) setTimeout(fixViewport, 80); return r; };
})();
