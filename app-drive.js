'use strict';
/* ================= Facturas en Google Drive =================
   Copia cada comprobante a la cuenta de Google de la persona, ordenado así (C.driveTarget):
     WalletWeb / Año / "MM Mes" / Gasto · Ingreso · Transferencia · Préstamo / Categoría / "AAAAMMDD Persona Tienda.pdf"
   No hay servidor de WalletWeb: la app habla con un programa de Google Apps Script que la persona instala una vez en
   su propia cuenta (C.driveScript, con una clave secreta solo para esta app). Solo funciona si lo conecta, y el perfil
   de demostración nunca sube nada.
   Estado (por perfil):
     S.settings.drive = { url, key, account, folderUrl, scriptVersion, connectedAt, lastSyncAt, lastError }
     S.settings.driveAuto (true salvo que se apague)
     S.driveFiles = { [id del movimiento]: { id, url, name, key, ver, trashed, at } } → lo que ya está en Drive. Va aparte del
       movimiento para que borrar, restaurar, editar o cambiar la factura (o vaciar la papelera) también se refleje en Drive.
   Nunca se sube nada sin conexión configurada; los errores se reintentan solos. */

const DRIVE_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/[\w-]{20,}\/exec$/;
const DRIVE_STOP = new Set(['red', 'tiempo', 'ocupado', 'cuota', 'clave', 'acceso', 'respuesta']); // fallaría todo igual
const DRIVE_RETRY = new Set(['red', 'tiempo', 'ocupado', 'cuota']);                                  // se arregla solo
const DRIVE = { busy: false, again: false, timer: null, retry: null, backoff: 0, err: {}, left: 0, quiet: false };

function driveCfg() {
  let c = S.settings.drive;
  if (!c || typeof c !== 'object') c = S.settings.drive = { url: '', key: '' };
  return c;
}
const driveAllowed = () => !S.demo && !PROFILE.demo && !IN_FRAME;
function driveReady() { const c = S.settings.drive; return !!(c && c.url && c.key && driveAllowed() && !Store.readOnly); }
const driveAutoOn = () => S.settings.driveAuto !== false;
function driveNewKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// La carpeta principal: "WalletWeb" para el perfil personal, "WalletWeb - Nombre" para los demás
const driveRoot = () => PROFILE.id === 'main' ? 'WalletWeb' : 'WalletWeb - ' + (C.driveSafe(PROFILE.name, 40) || 'Perfil');
const drivePeople = t => (t.personId ? [t.personId] : (t.people || [])).map(id => personById(id)?.name).filter(Boolean);
function driveWant(t) {
  return C.driveTarget({ root: driveRoot(), date: t.date, type: t.type, category: catById(t.categoryId)?.name, sub: subName(t), people: drivePeople(t),
    merchant: t.merchant, mime: t.receipt?.type, fileName: t.receipt?.name, fallback: TYPES[t.type] });
}
// Versión del archivo: cambia solo cuando se guarda otra factura en el movimiento
function driveVer(t) {
  const r = t.receipt || {};
  return [(Date.parse(r.addedAt) || 0).toString(36), (Number(r.size) || 0).toString(36), String(r.hash || '').replace(/\W/g, '').slice(0, 8)].join('-');
}
function driveDesc(t) {
  const cat = catLabel(t), who = drivePeople(t).join(', ');
  return [`${TYPES[t.type] || 'Movimiento'} de ${C.formatMoney(t.amount)}${cat ? ' · ' + cat : ''}`, [t.merchant, who].filter(Boolean).join(' · '), 'Fecha: ' + fdFull(t.date), 'Guardado con WalletWeb']
    .filter(Boolean).join('\n');
}
const driveIsSynced = (t, f) => !!(f && f.id && !f.trashed && f.ver === driveVer(t));

/* ---------- Qué falta hacer en Drive ---------- */
function driveWork() {
  const files = S.driveFiles || (S.driveFiles = {}), byId = new Map(S.transactions.map(t => [t.id, t])), out = [];
  for (const [txId, f] of Object.entries(files)) {
    const t = byId.get(txId);
    if (!t || !t.receipt) out.push({ op: 'forget', txId, f, sig: 'forget:' + txId });              // movimiento borrado para siempre o factura quitada
    else if (t.deletedAt && f.id && !f.trashed) out.push({ op: 'trash', txId, f, sig: 'trash:' + txId }); // en la papelera de la app
  }
  const up = [];
  for (const t of S.transactions) {
    if (!t.receipt || t.deletedAt) continue;
    const f = files[t.id], w = driveWant(t), ver = driveVer(t);
    if (!f || !f.id || f.ver !== ver) up.push({ op: 'upload', txId: t.id, t, w, ver, f, sig: 'upload:' + t.id + ':' + ver });
    else if (f.key !== w.key || f.trashed) up.push({ op: 'move', txId: t.id, t, w, ver, f, sig: 'move:' + t.id + ':' + w.key });
  }
  up.sort((a, b) => (b.t.date + (b.t.createdAt || '')).localeCompare(a.t.date + (a.t.createdAt || ''))); // lo más reciente primero
  return out.concat(up);
}

/* ---------- Conversación con el programa de Apps Script ---------- */
function driveError(kind, detail) { const e = new Error(kind); e.kind = kind; e.detail = String(detail || '').slice(0, 200); return e; }
async function drivePost(cfg, body, ms = 90000) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
  let res, text = '';
  try {
    // text/plain evita la consulta previa de CORS; Google responde con una redirección que el navegador sigue solo
    res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ clave: cfg.key }, body)),
      signal: ctl.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer' });
    text = await res.text();
  } catch (e) {
    throw driveError(e && e.name === 'AbortError' ? 'tiempo' : 'red');
  } finally { clearTimeout(tm); }
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* no es JSON */ }
  if (!j || typeof j !== 'object') {
    if (res.status === 429 || /too many times|quota|cuota|l[ií]mite/i.test(text)) throw driveError('cuota');
    throw driveError(/accounts\.google\.com|ServiceLogin|Iniciar sesi[oó]n|Sign in/i.test(text) ? 'acceso' : 'respuesta');
  }
  if (!j.ok) {
    if (/too many times|quota|Service invoked|limit exceeded|l[ií]mite/i.test(j.mensaje || '')) throw driveError('cuota', j.mensaje);
    throw driveError(String(j.error || 'script'), j.mensaje);
  }
  return j;
}
function driveErrText(e, connecting) {
  switch (e && e.kind) {
    case 'red': return connecting ? 'Google no respondió. Revisa tu conexión y que en "Quién tiene acceso" hayas elegido "Cualquier usuario".' : 'Sin conexión con Google. Se reintentará solo.';
    case 'tiempo': return 'Google tardó demasiado en responder. Se reintentará solo.';
    case 'ocupado': return 'Google estaba ocupado. Se reintentará solo.';
    case 'cuota': return 'Google limitó las subidas por un rato. Se reintentará más tarde.';
    case 'clave': return 'La clave no coincide con la de esta app. Copia el código otra vez, pégalo en Apps Script y publica una versión nueva.';
    case 'acceso': return 'Google pidió iniciar sesión: en la implementación, "Quién tiene acceso" debe ser "Cualquier usuario".';
    case 'respuesta': return 'Google respondió algo inesperado. Revisa que la URL sea la de la aplicación web (termina en /exec).';
    case 'archivo': return 'El archivo ya no está en este dispositivo.';
    default: return 'El programa de Google falló' + (e && e.detail ? ': ' + e.detail : '.');
  }
}
function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
}
async function driveRun(w, st, cfg) {
  const files = st.driveFiles, now = () => new Date().toISOString();
  if (w.op === 'forget' || w.op === 'trash') {
    if (w.f.id && !w.f.trashed) await drivePost(cfg, { accion: 'papelera', ref: w.txId, id: w.f.id });
    if (S !== st) return;
    if (w.op === 'forget') delete files[w.txId]; else Object.assign(files[w.txId], { trashed: true, at: now() });
    return;
  }
  const t = w.t, body = { accion: 'subir', ref: t.id, ruta: w.w.path, nombre: w.w.name, ver: w.ver, descripcion: driveDesc(t) };
  if (w.f && w.f.id) body.id = w.f.id;
  if (w.op === 'upload') {
    const blob = await Store.get('rcpt:' + t.id);
    if (!blob) throw driveError('archivo');
    body.tipo = blob.type || 'application/octet-stream';
    body.datos = await blobToB64(blob);
  }
  let r;
  try { r = await drivePost(cfg, body); }
  catch (e) { if (e.kind === 'noexiste' && w.op === 'move') { if (S === st) delete files[t.id]; return; } throw e; } // lo borraron en Drive: se vuelve a subir
  if (S !== st) return;
  if (!r.id) throw driveError('respuesta');
  if (r.version) cfg.scriptVersion = Number(r.version) || cfg.scriptVersion;
  files[t.id] = { id: String(r.id || ''), url: /^https:\/\/drive\.google\.com\//.test(r.url || '') ? r.url : '', name: String(r.nombre || w.w.name), key: w.w.key, ver: w.ver, trashed: false, at: now() };
}

/* ---------- Sincronización: una a la vez, lo más reciente primero ---------- */
function driveSave() { DRIVE.quiet = true; try { save(); } finally { DRIVE.quiet = false; } }
async function driveSync(opts = {}) {
  if (!driveReady()) return { ok: false, why: 'off' };
  if (DRIVE.busy) { DRIVE.again = true; return { ok: false, why: 'busy' }; }
  if (navigator.onLine === false) { driveRetryLater(); return { ok: false, error: driveError('red') }; }
  const st = S, cfg = driveCfg(), count = { upload: 0, move: 0, trash: 0 };
  DRIVE.busy = true; DRIVE.again = false; clearTimeout(DRIVE.retry);
  if (opts.force) DRIVE.err = {};
  let stop = null, done = 0;
  driveUI();
  try {
    for (let guard = 0; guard < 5000; guard++) {
      if (S !== st || !driveReady()) break;
      const work = driveWork().filter(x => !DRIVE.err[x.sig]);
      DRIVE.left = work.length; driveUI();
      if (!work.length) break;
      const w = work[0];
      try {
        await driveRun(w, st, cfg);
        done++; count[w.op === 'forget' ? 'trash' : w.op]++;
        if (S === st) { cfg.lastSyncAt = new Date().toISOString(); if (done % 5 === 0) driveSave(); } // el resto se guarda al terminar
      } catch (e) {
        if (S !== st) break;
        if (DRIVE_STOP.has(e.kind)) { stop = e; break; }
        DRIVE.err[w.sig] = { txId: w.txId, msg: driveErrText(e) };
      }
    }
  } finally { DRIVE.busy = false; DRIVE.left = 0; }
  if (S === st) {
    const before = JSON.stringify(cfg.lastError || null);
    cfg.lastError = stop ? { at: new Date().toISOString(), kind: stop.kind, msg: driveErrText(stop) } : null;
    if (done) audit('drive.sync', 'settings', null, 'Google Drive: ' + [count.upload ? count.upload + ' subido(s)' : '', count.move ? count.move + ' movido(s) o renombrado(s)' : '', count.trash ? count.trash + ' a la papelera' : ''].filter(Boolean).join(', '));
    if (done || before !== JSON.stringify(cfg.lastError)) driveSave();
  }
  if (stop && DRIVE_RETRY.has(stop.kind)) driveRetryLater(); else if (!stop) DRIVE.backoff = 0;
  driveUI();
  if (DRIVE.again) driveSyncSoon(1500);
  return { ok: !stop, done, error: stop };
}
function driveSyncSoon(ms = 5000) {
  if (!driveReady() || !driveAutoOn()) return;
  if (DRIVE.busy) { DRIVE.again = true; return; }
  clearTimeout(DRIVE.timer);
  DRIVE.timer = setTimeout(() => { DRIVE.timer = null; driveSync(); }, ms);
}
function driveRetryLater() {
  if (!driveAutoOn()) return;
  clearTimeout(DRIVE.retry);
  DRIVE.backoff = Math.min(DRIVE.backoff ? DRIVE.backoff * 2 : 60, 900); // 1, 2, 4, 8 y luego cada 15 minutos
  DRIVE.retry = setTimeout(() => { if (document.visibilityState !== 'hidden') driveSyncSoon(0); }, DRIVE.backoff * 1000);
}
// Al guardar cualquier cambio se revisa (unos segundos después) si hay algo que subir, mover o mandar a la papelera
const _driveBaseSave = save;
save = function () { const r = _driveBaseSave.apply(this, arguments); if (!DRIVE.quiet) driveSyncSoon(); return r; };
function driveBoot() { driveSyncSoon(3000); }
// init() puede terminar de leer los datos antes de que cargue este archivo: también se revisa al terminar de cargar la página
window.addEventListener('load', () => driveSyncSoon(3000));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') driveSyncSoon(1500); });
window.addEventListener('online', () => driveSyncSoon(1000));
// El interruptor "Subir automáticamente" lo guarda el manejador general (data-bind); aquí solo se refleja
document.addEventListener('change', e => { if (e.target?.dataset?.bind === 'settings.driveAuto') { if (e.target.checked) driveSyncSoon(500); driveUI(); } });
// Al restaurar una copia: la conexión es la de este dispositivo y se conserva lo que ya se sabe que está en Drive
function driveKeepOnRestore(next) {
  if (S.settings.drive && S.settings.drive.url) { next.settings.drive = JSON.parse(JSON.stringify(S.settings.drive)); next.settings.driveAuto = S.settings.driveAuto; }
  const ids = new Set((next.transactions || []).map(t => t.id)), merged = Object.assign({}, next.driveFiles || {}, S.driveFiles || {});
  next.driveFiles = Object.fromEntries(Object.entries(merged).filter(([id]) => ids.has(id)));
}

/* ---------- Pantalla de Ajustes → Facturas en Google Drive ---------- */
function driveCounts() {
  let ok = 0, pend = 0; const files = S.driveFiles || {};
  for (const t of S.transactions) { if (!t.receipt || t.deletedAt) continue; if (driveIsSynced(t, files[t.id])) ok++; else pend++; }
  return { ok, pend, err: Object.keys(DRIVE.err).length };
}
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
function driveRowValue() {
  if (!driveAllowed()) return PROFILE.demo || S.demo ? 'No disponible en la demostración' : 'Sin conectar';
  if (!driveReady()) return 'Sin conectar';
  const n = driveCounts();
  if (DRIVE.busy) return `Subiendo… ${n.ok} en Drive`;
  return [`${n.ok} en Drive`, n.pend ? plural(n.pend, 'pendiente', 'pendientes') : '', driveCfg().lastError || n.err ? '<span class="warn">Revisar</span>' : ''].filter(Boolean).join(' · ');
}
function driveTreeHTML() {
  const t = S.transactions.filter(x => x.receipt && !x.deletedAt).sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')))[0];
  const w = t ? driveWant(t) : C.driveTarget({ root: driveRoot(), date: today(), type: 'expense', category: 'Necesario', people: ['Laura'], merchant: 'Koaj', mime: 'application/pdf' });
  const node = (icon, txt, d, cls) => `<div class="drv-node ${cls || ''}" style="--d:${d}">${ic(icon, 'sm')}<span>${esc(txt)}</span></div>`;
  return `<div class="drv-tree" role="img" aria-label="${esc(w.key.split('/').join(', '))}">${w.path.map((p, i) => node('folder', p, i)).join('')}${node('doc', w.name, w.path.length, 'file')}</div>
    <p class="hint">${t ? 'Así queda tu factura más reciente.' : 'Ejemplo: gasto de hoy con Laura en Koaj.'} Si cambias la fecha, el tipo, la categoría, las personas o la tienda, el archivo se mueve y se renombra solo.</p>`;
}
function driveCodeHTML(open) {
  return `<details class="drv-code" ${open ? 'open' : ''}><summary>${open ? 'Código' : 'Ver el código'}</summary><textarea class="input" readonly rows="8" spellcheck="false" aria-label="Código para Google Apps Script">${esc(C.driveScript(driveCfg().key))}</textarea></details>`;
}
function driveStatusHTML() {
  const c = driveCfg(), n = driveCounts();
  const head = DRIVE.busy ? `<b>Sincronizando…</b>${DRIVE.left ? ` <span class="muted">quedan ${DRIVE.left}</span>` : ''}`
    : c.lastError ? `<b>No se pudo sincronizar</b><div class="small" style="margin-top:2px">${esc(c.lastError.msg)}</div>`
    : `<b>${n.pend ? (driveAutoOn() ? 'Por subir' : 'Subida automática apagada') : 'Todo al día'}</b>`;
  const sub = [plural(n.ok, 'factura en Drive', 'facturas en Drive'), n.pend ? plural(n.pend, 'pendiente', 'pendientes') : '', n.err ? n.err + ' con error' : '', c.lastSyncAt ? 'último cambio ' + fdt(c.lastSyncAt) : ''].filter(Boolean).join(' · ');
  const errs = Object.values(DRIVE.err).slice(0, 3).map(x => { const t = txById(x.txId); return `<div class="small" style="margin-top:4px">${esc(t ? txTitle(t) + ', ' + fdShort(t.date) : 'Movimiento')}: ${esc(x.msg)}</div>`; }).join('');
  const old = (c.scriptVersion || 1) < C.DRIVE_SCRIPT_VERSION ? '<div class="small" style="margin-top:6px"><b>Hay una versión nueva del programa.</b> Abre "Ver el código", cópialo, reemplázalo en Apps Script y publícalo en Implementar → Gestionar implementaciones → Editar → Versión nueva.</div>' : '';
  return `${head}<div class="small muted" style="margin-top:2px">${esc(sub)}</div>${errs}${old}`;
}
function driveBody() {
  const c = driveCfg();
  if (!driveAllowed()) return `${driveTreeHTML()}<div class="card flat" style="margin-top:12px">${PROFILE.demo || S.demo ? 'El perfil de demostración nunca se conecta a Google Drive: sus datos son ficticios. Cambia a tu perfil para conectarlo.' : 'En esta vista previa no se puede conectar. Hazlo desde la app instalada en tu teléfono.'}</div>`;
  if (!c.url) {
    const n = S.transactions.filter(t => t.receipt && !t.deletedAt).length;
    return `<p class="muted" style="margin-top:0">Cada factura o soporte que guardes se copia sola a tu Google Drive, ordenada por año, mes, tipo de movimiento y categoría${n ? (n === 1 ? '. También se subirá la que ya tienes' : `. También se subirán las ${n} que ya tienes`) : ''}.</p>
      ${driveTreeHTML()}
      <div class="db-h" style="padding:16px 0 4px">Conéctalo una sola vez</div>
      <ol class="drv-steps">
        <li><b>Copia el código de tu conexión.</b> Trae una clave secreta que solo conoce esta app. Los pasos 2 a 4 son más fáciles en un computador: envíatelo por AirDrop, Notas o correo.
          <div class="drv-btns"><button class="btn" data-act="driveCopy">${ic('copy', 'sm')} Copiar código</button>${navigator.share ? `<button class="btn" data-act="driveShare">${ic('share', 'sm')} Compartir</button>` : ''}</div></li>
        <li>Entra a <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com</a> con tu cuenta de Google (abre un proyecto nuevo). Arriba, donde dice <i>Proyecto sin título</i>, ponle de nombre <b>WalletWeb Drive</b>. Borra lo que trae el editor, <b>pega el código</b> y guarda con el ícono del disquete.</li>
        <li>Arriba a la derecha toca <b>Implementar → Nueva implementación</b>. En el engranaje elige <b>Aplicación web</b>, deja <b>Ejecutar como: Yo</b>, en <b>Quién tiene acceso</b> elige <b>Cualquier usuario</b> y toca <b>Implementar</b>.</li>
        <li>Google te pide permiso para tu Drive: <b>Autorizar acceso</b> → tu cuenta → <b>Configuración avanzada</b> → <b>Ir a WalletWeb Drive (no seguro)</b> → <b>Permitir</b>. Ese aviso sale porque el programa es tuyo y no está publicado en ninguna tienda.</li>
        <li>Copia la <b>URL de la aplicación web</b> (termina en <code>/exec</code>) y pégala aquí:
          <input id="drvUrl" class="input" style="margin-top:8px" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></li>
      </ol>
      <div id="drvErr" class="err" role="alert"></div>
      ${driveCodeHTML(false)}
      <p class="hint">Privacidad: las facturas viajan cifradas (HTTPS) directo de tu teléfono a tu Drive, sin pasar por servidores de WalletWeb ni de terceros. El programa solo crea, ordena y manda a la papelera archivos que él mismo creó en la carpeta WalletWeb.</p>`;
  }
  return `<div class="card flat" style="margin-bottom:12px"><div style="display:flex;gap:10px;align-items:center">${ic('check')}<div class="grow" style="min-width:0"><b>Conectado a Google Drive</b>
      <div class="small muted" style="overflow-wrap:anywhere">${esc(c.account || 'Tu cuenta de Google')}${c.connectedAt ? ' · desde ' + esc(fdt(c.connectedAt)) : ''}</div></div></div>
      ${c.folderUrl ? `<a class="btn block" style="margin-top:12px" href="${esc(c.folderUrl)}" target="_blank" rel="noopener noreferrer">${ic('folder', 'sm')} Abrir la carpeta ${esc(driveRoot())}</a>` : ''}</div>
    <div id="drvStatus" class="ocr-status" style="margin:0 0 6px">${driveStatusHTML()}</div>
    ${sw('settings.driveAuto', driveAutoOn(), 'Subir automáticamente', 'Al guardar un movimiento con factura y al abrir la app. Si lo apagas, usa "Sincronizar ahora".')}
    <div class="db-h" style="padding:12px 0 4px">Cómo se ordena</div>
    ${driveTreeHTML()}
    <p class="hint">Si eliminas un movimiento, su archivo va a la papelera de Drive; si lo restauras, vuelve a su carpeta. Si quitas la conexión, lo que ya está en Drive se queda allá.</p>
    ${driveCodeHTML(false)}
    <button class="btn danger block" style="margin-top:14px" data-act="driveDisconnect">Desconectar Google Drive</button>`;
}
function driveFooter() {
  if (!driveAllowed()) return '';
  if (!driveCfg().url) return `<button class="btn primary" data-act="driveConnect">${ic('check', 'sm')} Conectar</button>`;
  return `<button class="btn primary" data-act="driveSyncNow" ${DRIVE.busy ? 'disabled' : ''}>${ic('upload', 'sm')} Sincronizar ahora</button>`;
}
function driveRefreshSheet(top) { const s = sheets.find(x => x.id === 'drive'); if (!s) return; s.setBody(driveBody()); s.setFooter(driveFooter()); if (top) $('.sheet-b', s.el).scrollTop = 0; }
// Actualiza lo que esté a la vista (estado de la hoja y la fila de Ajustes) sin redibujar la pantalla
function driveUI() {
  const st = $('#drvStatus'); if (st) st.innerHTML = driveStatusHTML();
  const b = $('.sheet-f [data-act="driveSyncNow"]'); if (b) b.disabled = DRIVE.busy;
  const row = $('#view [data-act="driveSheet"] .s'); if (row) row.innerHTML = driveRowValue();
}
function driveSheet() {
  const c = driveCfg();
  if (driveAllowed() && !c.key) { c.key = driveNewKey(); driveSave(); }
  openSheet({ id: 'drive', title: 'Facturas en Google Drive', body: driveBody(), footer: driveFooter(), onClose: () => { if (route === 'ajustes' && !sheets.length) render(); } });
}
async function driveConnect(btn) {
  const err = m => { const e = $('#drvErr'); if (e) e.textContent = m; };
  const url = String($('#drvUrl')?.value || '').replace(/\s+/g, '');
  err('');
  if (!url) return err('Pega la URL de la aplicación web.');
  if (/\/dev\/?$/.test(url)) return err('Esa es la URL de prueba (termina en /dev). Usa la de la implementación, que termina en /exec.');
  if (!DRIVE_URL_RE.test(url)) return err('La URL debe empezar por https://script.google.com/ y terminar en /exec.');
  const c = driveCfg(), label = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Conectando…';
  try {
    const r = await drivePost({ url, key: c.key }, { accion: 'probar', raiz: driveRoot() }, 45000);
    Object.assign(c, { url, account: String(r.cuenta || '').slice(0, 120), folderUrl: /^https:\/\/drive\.google\.com\//.test(r.carpeta || '') ? r.carpeta : '',
      scriptVersion: Number(r.version) || 1, connectedAt: new Date().toISOString(), lastError: null });
    DRIVE.err = {}; DRIVE.backoff = 0;
    audit('drive.connected', 'settings', null, 'Facturas conectadas a Google Drive');
    driveSave(); driveRefreshSheet(true);
    toast('Conectado a Google Drive');
    driveSync();
  } catch (e) { err(driveErrText(e, true)); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}
async function driveSyncNow() {
  if (!driveReady()) return;
  if (DRIVE.busy) { toast('Ya se está sincronizando.'); return; }
  const r = await driveSync({ force: true });
  driveRefreshSheet();
  if (r.error) toast(driveErrText(r.error));
  else { const n = driveCounts(); toast(n.err ? plural(n.err, 'factura no se pudo subir', 'facturas no se pudieron subir') : r.done ? 'Listo: ' + plural(r.done, 'cambio', 'cambios') + ' en Drive' : 'Todo está al día'); }
}
async function driveDisconnect() {
  if (!(await confirmDialog('La app dejará de copiar facturas a Google Drive. Lo que ya está en tu Drive se queda allá. Si quieres, borra también el proyecto en script.google.com.', { title: 'Desconectar Google Drive', confirmText: 'Desconectar', danger: true }))) return;
  const c = driveCfg();
  Object.assign(c, { url: '', account: '', folderUrl: '', lastError: null }); // la clave se conserva por si vuelves a conectar el mismo programa
  DRIVE.err = {}; clearTimeout(DRIVE.timer); clearTimeout(DRIVE.retry);
  audit('drive.disconnected', 'settings', null, 'Google Drive desconectado');
  driveSave(); driveRefreshSheet(true);
  toast('Google Drive desconectado');
}
async function driveCopy() {
  try { await navigator.clipboard.writeText(C.driveScript(driveCfg().key)); toast('Código copiado. Pégalo en Apps Script.'); }
  catch (e) { const d = $('.drv-code'); if (d) { d.open = true; const ta = $('textarea', d); ta.focus(); ta.select(); } toast('Cópialo desde el recuadro.'); }
}
async function driveShare() {
  try { await navigator.share({ title: 'Código de WalletWeb Drive', text: C.driveScript(driveCfg().key) }); }
  catch (e) { if (!e || e.name !== 'AbortError') driveCopy(); }
}
// Estado del comprobante en el detalle del movimiento
function driveReceiptPill(t) {
  const f = (S.driveFiles || {})[t.id];
  if (driveIsSynced(t, f)) return '<span class="pill">En Google Drive</span>';
  if (driveReady()) return `<span class="pill">${DRIVE.busy ? 'Subiendo a Drive…' : driveAutoOn() ? 'Se subirá a Drive' : 'Sin subir a Drive'}</span>`;
  return '<span class="pill">En este dispositivo</span>';
}
function driveReceiptLink(t) {
  const f = (S.driveFiles || {})[t.id];
  return driveIsSynced(t, f) && f.url ? `<a class="btn block drv-open" style="margin-top:10px" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${ic('cloud', 'sm')} Abrir en Google Drive</a>` : '';
}
Object.assign(ACT, {
  driveSheet: () => driveSheet(), driveConnect: el => driveConnect(el), driveSyncNow: () => driveSyncNow(), driveDisconnect: () => driveDisconnect(),
  driveCopy: () => driveCopy(), driveShare: () => driveShare()
});
