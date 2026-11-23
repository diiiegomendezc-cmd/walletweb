/* WalletWeb — perfiles (varios usuarios o usos en el mismo teléfono), moneda por perfil y perfil de demostración. */
'use strict';

const profInitial = p => (p.name || '?').trim().charAt(0).toUpperCase() || '?';
const profColor = p => p.demo ? CAT_FAMILIES.amber.base : p.id === 'main' ? CAT_FAMILIES.blue.base : (Object.values(CAT_FAMILIES)[[...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 9] || CAT_FAMILIES.violet).base;

// Botón del perfil en la barra superior: muestra en qué perfil estás y lo cambia de un toque
function profButton() {
  const bar = document.querySelector('.topbar'); if (!bar) return;
  let b = document.getElementById('profBtn');
  if (!b) { b = document.createElement('button'); b.id = 'profBtn'; b.className = 'icon-btn prof-btn'; b.dataset.act = 'profiles'; bar.insertBefore(b, document.getElementById('privBtn')); }
  b.setAttribute('aria-label', 'Perfil: ' + PROFILE.name + '. Cambiar de perfil');
  b.style.setProperty('--cc', profColor(PROFILE));
  b.innerHTML = `<span>${esc(profInitial(PROFILE))}</span>`;
}

function profilesBody() {
  return `<div class="list">${PROFILES.list.map(p => `<div class="row-item prof-row">
      <button class="prof-pick" data-act="profSwitch" data-v="${esc(p.id)}" aria-current="${p.id === PROFILE.id}">
        <span class="prof-av" style="--cc:${profColor(p)}">${esc(profInitial(p))}</span>
        <span class="grow"><span class="t">${esc(p.name)}${p.id === PROFILE.id ? ' <span class="pill info">En uso</span>' : ''}</span><span class="s">${esc(p.currency)} · ${p.demo ? 'Datos ficticios para mostrar la app' : p.id === 'main' ? 'Perfil principal' : 'Perfil adicional'}</span></span>
      </button>
      <button class="icon-btn" data-act="profEdit" data-v="${esc(p.id)}" aria-label="Editar ${esc(p.name)}">${ic('edit', 'sm')}</button></div>`).join('')}</div>
    <p class="hint">Cada perfil tiene sus propios movimientos, categorías, préstamos, ajustes y PIN. Para mostrar la app usa <b>Demostración</b>: al volver a tu perfil se pide tu PIN si lo tienes.</p>`;
}
function profilesSheet() {
  const s = sheets.find(x => x.id === 'prof');
  if (s) s.setBody(profilesBody());
  else openSheet({ id: 'prof', title: 'Perfiles', body: profilesBody(), footer: `<button class="btn primary" data-act="profNew">${ic('plus', 'sm')} Nuevo perfil</button>` });
}
function profEditSheet(id) {
  const p = id ? PROFILES.list.find(x => x.id === id) : null;
  openSheet({ id: 'profE', title: p ? 'Editar perfil' : 'Nuevo perfil', body: `
    <div class="field"><label for="pfN">Nombre</label><input id="pfN" class="input" value="${esc(p?.name || '')}" placeholder="Ej.: Negocio, Viaje, Mamá" maxlength="30" autocomplete="off"></div>
    <div class="field"><label for="pfC">Moneda</label><select id="pfC" class="input">${optionList(CURRENCIES.map(([c, n]) => [c, `${c} · ${n} (${C.CUR_SYMBOLS[c]})`]), p?.currency || 'COP')}</select>
      <p class="hint">Cambia el símbolo con que se muestran los montos. Los valores se manejan sin centavos.</p></div>
    ${p?.demo ? `<button class="btn block" data-act="profDemoReset">${ic('undo', 'sm')} Restablecer datos ficticios</button>` : ''}
    ${p && p.id !== 'main' && !p.demo ? `<button class="btn block" style="margin-top:10px;color:var(--neg)" data-act="profDelete" data-v="${esc(p.id)}">${ic('trash', 'sm')} Eliminar perfil y sus datos</button>` : ''}
    <div id="pfErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="profSave" data-v="${esc(p?.id || '')}">${p ? 'Guardar' : 'Crear y abrir'}</button>` });
}
// Guarda ya el perfil actual y abre el otro (se recarga para empezar limpio, con su PIN y su moneda)
async function switchProfile(id) {
  if (id === PROFILE.id) { closeAllSheets(); return; }
  clearTimeout(saveTimer);
  if (!Store.readOnly) {
    const snap = JSON.parse(JSON.stringify(S));
    try { localStorage.setItem(mirrorKey(), JSON.stringify(snap)); } catch (e) { /* */ }
    await Store.set(stateKey(), snap);
  }
  PROFILES.active = id; saveProfiles();
  document.body.classList.add('cover');
  location.hash = 'inicio'; location.reload();
}
async function resetDemoProfile() {
  if (!(await confirmDialog('Se vuelven a crear los datos ficticios de la demostración.', { title: 'Restablecer demostración', confirmText: 'Restablecer' }))) return;
  const theme = S.settings.theme;
  await clearProfileData();
  loadDemoData(); S.demo = true; S.settings.onboarded = true; S.settings.theme = theme;
  save(); closeAllSheets(); render(); toast('Datos ficticios restablecidos');
}

Object.assign(ACT, {
  profiles: () => profilesSheet(),
  profSwitch: el => switchProfile(el.dataset.v),
  profNew: () => profEditSheet(null),
  profEdit: el => profEditSheet(el.dataset.v),
  profDemoReset: async () => { if (!PROFILE.demo) { toast('Abre el perfil de demostración para restablecerlo.'); return; } await resetDemoProfile(); },
  profSave: async el => {
    const name = $('#pfN').value.trim(), cur = $('#pfC').value;
    if (!name) { $('#pfErr').textContent = 'Escribe un nombre.'; return; }
    const id = el.dataset.v;
    if (id) {
      const p = PROFILES.list.find(x => x.id === id); p.name = name.slice(0, 30); p.currency = cur; saveProfiles();
      if (p.id === PROFILE.id) { C.setCurrency(cur); profButton(); }
      await closeSheet(true); profilesSheet(); render(); toast('Perfil actualizado');
    } else {
      const p = { id: uid().slice(0, 12), name: name.slice(0, 30), currency: cur };
      PROFILES.list.splice(PROFILES.list.findIndex(x => x.demo), 0, p); saveProfiles();
      await switchProfile(p.id);
    }
  },
  profDelete: async el => {
    const p = PROFILES.list.find(x => x.id === el.dataset.v); if (!p || p.id === 'main' || p.demo) return;
    if (!(await confirmDialog(`Se borrarán todos los datos del perfil "${p.name}" de este teléfono. Esto no se puede deshacer.`, { title: 'Eliminar perfil', confirmText: 'Eliminar', danger: true, typed: 'ELIMINAR' }))) return;
    const st = await Store.getStrict(stateKey(p.id));
    await clearProfileData(p.id, st.ok && st.value ? st.value.transactions || [] : []);
    PROFILES.list = PROFILES.list.filter(x => x.id !== p.id); saveProfiles();
    if (p.id === PROFILE.id) { await switchProfile('main'); return; }
    await closeSheet(true); profilesSheet(); render(); toast('Perfil eliminado');
  }
});

const _pfRender = render;
render = function () { _pfRender.apply(this, arguments); profButton(); };
profButton();
