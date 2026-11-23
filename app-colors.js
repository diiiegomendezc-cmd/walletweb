/* WalletWeb — personalizar los colores de categorías y subcategorías (Ajustes → Colores de categorías). */
'use strict';

function catColorsBody() {
  const block = (kind, title) => {
    const list = S.categories.filter(c => c.kind === kind && !c.archived).sort((a, b) => a.order - b.order);
    if (!list.length) return '';
    return `<div class="sub-h">${esc(title)}</div>${list.map(c => `<div class="cc-cat">
      <div class="cc-head"><span class="ico" style="--cc:${catColor(c)}">${ic(ICONS[c.icon] ? c.icon : 'tag')}</span><b class="grow">${esc(c.name)}</b>
        <label class="cc-swatch" style="--cc:${catColor(c)}" title="Elegir otro color"><input type="color" value="${catColor(c)}" data-cc-cat="${c.id}" aria-label="Color de ${esc(c.name)}"><i></i>${ic('edit', 'sm')}</label></div>
      <div class="cc-fams" role="group" aria-label="Familia de color de ${esc(c.name)}">${Object.entries(CAT_FAMILIES).map(([k, fm]) => `<button type="button" class="fam-pick sm" data-act="ccFam" data-id="${c.id}" data-v="${k}" aria-pressed="${!c.colorHex && c.palette === k}" aria-label="${esc(fm.name)}" title="${esc(fm.name)}" style="--cc:${fm.base}"><i></i></button>`).join('')}</div>
      ${c.subs.filter(s => !s.archived).length ? `<div class="cc-subs">${c.subs.filter(s => !s.archived).map(s => `<label class="cc-sub" style="--cc:${subColor(c, s.id)}"><input type="color" value="${subColor(c, s.id)}" data-cc-sub="${c.id}|${s.id}" aria-label="Color de ${esc(s.name)}"><i></i>${esc(s.name)}${s.color ? `<button type="button" class="cc-x" data-act="ccSubReset" data-id="${c.id}" data-v="${s.id}" aria-label="Volver al tono automático de ${esc(s.name)}">${ic('x', 'sm')}</button>` : ''}</label>`).join('')}</div>` : ''}
    </div>`).join('')}`;
  };
  return `<p class="muted small" style="margin-top:0">Toca un círculo de familia para cambiar la categoría completa (sus subcategorías toman tonos de ese color), o toca el color de la categoría o de una subcategoría para elegir uno exacto.</p>
    ${block('expense', 'Gastos')}${block('income', 'Ingresos')}`;
}
function catColorsSheet() {
  const s = sheets.find(x => x.id === 'ccol');
  if (s) s.setBody(catColorsBody());
  else openSheet({ id: 'ccol', title: 'Colores de categorías', body: catColorsBody(), footer: `<button class="btn" data-act="ccResetAll">Restablecer colores</button><button class="btn primary" data-act="closeSheet">Listo</button>` });
}
// Vista en vivo mientras se mueve el selector; se guarda al soltar
document.addEventListener('input', e => {
  const t = e.target; if (t.type !== 'color' || (!t.dataset.ccCat && !t.dataset.ccSub)) return;
  const lab = t.closest('.cc-swatch, .cc-sub'); if (lab) lab.style.setProperty('--cc', t.value);
  if (t.dataset.ccCat) { const ico = t.closest('.cc-cat')?.querySelector('.cc-head .ico'); if (ico) ico.style.setProperty('--cc', t.value); }
});
document.addEventListener('change', e => {
  const t = e.target; if (t.type !== 'color') return;
  if (t.dataset.ccCat) { const c = catById(t.dataset.ccCat); if (!c) return; c.colorHex = t.value; c.subs.forEach(s => { /* los tonos automáticos siguen al nuevo color */ }); }
  else if (t.dataset.ccSub) { const [cid, sid] = t.dataset.ccSub.split('|'); const s = catById(cid)?.subs.find(x => x.id === sid); if (!s) return; s.color = t.value; }
  else return;
  save(); catColorsSheet(); render();
});
Object.assign(ACT, {
  catColors: () => catColorsSheet(),
  ccFam: el => { const c = catById(el.dataset.id); if (!c) return; c.palette = el.dataset.v; delete c.colorHex; c.subs.forEach(s => delete s.color); save(); catColorsSheet(); render(); },
  ccSubReset: (el, ev) => { ev?.preventDefault(); const s = catById(el.dataset.id)?.subs.find(x => x.id === el.dataset.v); if (!s) return; delete s.color; save(); catColorsSheet(); render(); },
  ccResetAll: async () => {
    if (!(await confirmDialog('Todas las categorías vuelven a sus colores automáticos.', { title: 'Restablecer colores', confirmText: 'Restablecer' }))) return;
    S.categories.forEach(c => { delete c.palette; delete c.colorHex; c.subs.forEach(s => delete s.color); });
    assignPalettes(S.categories); save(); catColorsSheet(); render(); toast('Colores restablecidos');
  }
});
