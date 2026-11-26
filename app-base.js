/* WalletWeb — base: estado, almacenamiento local, utilidades de interfaz, bloqueo. */
'use strict';
const C = window.WWCore;
const APP_VERSION = '1.40.0';
const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const money = (n, cls) => `<span class="amt ${cls || ''}">${esc(C.formatMoney(n))}</span>`;
const signed = (n, inflow) => `<span class="amt ${inflow ? 'pos' : ''}">${inflow ? '+' : '−'}${esc(C.formatMoney(Math.abs(n)))}</span>`;
const today = () => C.todayISO();
const thisMonth = () => C.monthKey(today());

const NATURES = { need: 'Necesario', fun: 'Entretenimiento', invest: 'Inversión', loan: 'Préstamo', tax: 'Impuesto', other: 'Otro' };
const TYPES = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia', adjust: 'Ajuste', loan_out: 'Préstamo entregado', loan_in: 'Préstamo recibido', repay_in: 'Abono recibido', repay_out: 'Abono pagado', collect: 'Cobro de gasto compartido' };
const INFLOW = new Set(['income', 'loan_in', 'repay_in', 'collect']);
const STATUS = { draft: 'Borrador', pending: 'Pendiente de revisión', confirmed: 'Confirmado' };
const SOURCES = { manual: 'Manual', paste: 'Texto pegado', shortcut: 'Atajo', csv: 'Importación CSV', recurring: 'Regla recurrente', loan: 'Préstamo', receivable: 'Gasto compartido' };
const ACC_TYPES = { bank: 'Cuenta bancaria', wallet: 'Billetera digital', credit: 'Tarjeta de crédito', cash: 'Efectivo' };
const ACC_ICONS = { bank: 'bank', wallet: 'phone', credit: 'card', cash: 'cash' };
const COLORS = ['#2E6B52', '#C8553D', '#D99A2B', '#3D6FB4', '#7A5BA6', '#B8487A', '#4F8C8C', '#8C6A3F', '#6B6B6B', '#1F1F1F'];
/* ---------- Color por categoría ----------
   Cada categoría tiene una familia de color; sus subcategorías usan tonos de esa familia
   (Necesario en rojos: Mercado rojo brillante, Transporte borgoña…). */
const CAT_FAMILIES = {
  red:      { name: 'Rojo',     base: '#E5383B', shades: ['#FF453A', '#8E1B2E', '#D0313D', '#F2727F', '#B3203A', '#6B1426', '#E8505B', '#A8323E'] },
  violet:   { name: 'Violeta',  base: '#8B5CF6', shades: ['#A78BFA', '#6D28D9', '#C084FC', '#5B21B6', '#9F67FF', '#7E57C2', '#D8B4FE'] },
  green:    { name: 'Verde',    base: '#22A06B', shades: ['#34C759', '#0F7B4A', '#7BD88F', '#1E5E3A', '#4CAF7A'] },
  amber:    { name: 'Ámbar',    base: '#F59E0B', shades: ['#FBBF24', '#C2410C', '#D97706', '#FCD34D', '#A16207'] },
  blue:     { name: 'Azul',     base: '#0A84FF', shades: ['#0A84FF', '#5AC8FA', '#2453C9', '#64A8FF', '#1E3A8A'] },
  teal:     { name: 'Turquesa', base: '#14B8A6', shades: ['#2DD4BF', '#0F766E', '#5EEAD4', '#115E59'] },
  indigo:   { name: 'Índigo',   base: '#5856D6', shades: ['#7D7AFF', '#3634A3', '#A5A3FF', '#4B49C0'] },
  orange:   { name: 'Naranja',  base: '#FF7A1A', shades: ['#FF9F0A', '#C2560C', '#FFB86B', '#E8590C'] },
  pink:     { name: 'Rosa',     base: '#EC4899', shades: ['#F472B6', '#BE185D', '#F9A8D4', '#DB2777'] },
  brown:    { name: 'Café',     base: '#A2845E', shades: ['#C8A27A', '#7A5C3E', '#D9BFA0', '#5E4630'] },
  graphite: { name: 'Grafito',  base: '#8E8E93', shades: ['#AEAEB2', '#636366', '#C7C7CC', '#48484A'] }
};
const NATURE_FAMILY = { need: 'red', fun: 'violet', invest: 'green', loan: 'amber' };
const INCOME_FAMILY = { 'Salario': 'blue', 'Freelance': 'teal', 'Reembolsos': 'indigo', 'Intereses': 'orange', 'Otros ingresos': 'graphite' };
// Asigna una familia a las categorías que no la tienen, sin repetir mientras queden libres.
function assignPalettes(cats) {
  const used = new Set(cats.map(c => c.palette).filter(Boolean));
  const free = () => Object.keys(CAT_FAMILIES).find(k => !used.has(k)) || 'graphite';
  for (const c of cats) {
    if (c.palette && CAT_FAMILIES[c.palette]) continue;
    let p = c.kind === 'expense' ? NATURE_FAMILY[c.defaultNature] : INCOME_FAMILY[c.name];
    if (!p || used.has(p)) p = free();
    c.palette = p; used.add(p);
  }
  return cats;
}
const catFamily = c => CAT_FAMILIES[c?.palette] || CAT_FAMILIES.graphite;
const catColor = c => c ? (c.colorHex || catFamily(c).base) : null;
// Mezcla un color con blanco (t > 0) o negro (t < 0) para sacar tonos de un color elegido a mano.
function mixHex(hex, t) {
  const n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return hex;
  const to = t > 0 ? 255 : 0, a = Math.abs(t), ch = k => Math.round(((n >> k) & 255) * (1 - a) + to * a);
  return '#' + [16, 8, 0].map(k => ch(k).toString(16).padStart(2, '0')).join('');
}
function famShades(c) {
  if (c?.colorHex) return [mixHex(c.colorHex, .22), mixHex(c.colorHex, -.38), c.colorHex, mixHex(c.colorHex, .45), mixHex(c.colorHex, -.18), mixHex(c.colorHex, -.55), mixHex(c.colorHex, .32)];
  return catFamily(c).shades;
}
function subColor(c, subId) {
  if (!c) return null;
  const i = c.subs.findIndex(s => s.id === subId);
  if (i < 0) return catColor(c);
  if (c.subs[i].color) return c.subs[i].color;
  const sh = famShades(c); return sh[i % sh.length];
}
function txColor(t) {
  if (t.type !== 'expense' && t.type !== 'income') return null;
  const c = catById(t.categoryId); if (!c) return null;
  return t.subcategoryId ? subColor(c, t.subcategoryId) : catColor(c);
}
const DEFAULT_INST = ['Davivienda', 'Bancolombia', 'Lulo Bank', 'Nequi', 'Dale!', 'DaviPlata', 'Ualá', 'RappiPay'];

// Categorías de gasto: las cuatro naturalezas. El detalle (Mercado, Restaurantes…) son subcategorías opcionales.
const EXPENSE_CATS = [
  ['Necesario', 'home', 'need', ['Mercado', 'Transporte', 'Hogar', 'Servicios', 'Salud', 'Mascotas', 'Impuestos']],
  ['Entretenimiento', 'film', 'fun', ['Restaurantes', 'Cine y salidas', 'Suscripciones', 'Viajes', 'Compras', 'Regalos']],
  ['Inversión', 'trend', 'invest', ['Educación', 'Ahorro', 'Negocio']],
  ['Préstamo', 'hand', 'loan', ['Familia', 'Amigos', 'Otros']]
];
function defaultCategories() {
  const I = [['Salario', 'briefcase'], ['Freelance', 'laptop'], ['Reembolsos', 'undo'], ['Intereses', 'trend'], ['Otros ingresos', 'plus']];
  let o = 0;
  return assignPalettes([
    ...EXPENSE_CATS.map(([name, icon, nat, subs], k) => ({ id: uid(), name, icon, color: COLORS[k % COLORS.length], kind: 'expense', defaultNature: nat, subs: subs.map(n => ({ id: uid(), name: n })), archived: false, order: o++ })),
    ...I.map(([name, icon], k) => ({ id: uid(), name, icon, color: COLORS[(k + 3) % COLORS.length], kind: 'income', defaultNature: null, subs: [], archived: false, order: o++ }))
  ]);
}
// Menú inferior editable: 4 botones (2 a cada lado del +)
const DEFAULT_TABS = ['inicio', 'movimientos', 'presupuestos', 'ajustes'];
const TAB_OPTIONS = { inicio: ['Inicio', 'home'], movimientos: ['Movimientos', 'list'], presupuestos: ['Presupuestos', 'pie'], prestamos: ['Préstamos', 'hand'], metas: ['Quiero comprar', 'bag'],
  cuentas: ['Cuentas', 'card'], recurrentes: ['Recurrentes', 'repeat'], personas: ['Personas', 'users'], categorias: ['Categorías', 'tag'], alertas: ['Alertas', 'bell'], ajustes: ['Ajustes', 'gear'] };
function getTabs() { const t = (S && S.settings && Array.isArray(S.settings.tabs) ? S.settings.tabs : DEFAULT_TABS).filter(x => TAB_OPTIONS[x]); return t.length === 4 && new Set(t).size === 4 ? t : DEFAULT_TABS.slice(); }
function tabbarHTML(tabs, preview) {
  const tab = k => `<${preview ? 'span' : 'a'} class="tab" ${preview ? '' : `href="#${k}" data-act="go" data-v="${k}" data-tab="${k}"`}>${ic(TAB_OPTIONS[k][1])}${esc(TAB_OPTIONS[k][0])}</${preview ? 'span' : 'a'}>`;
  return tab(tabs[0]) + tab(tabs[1]) + `<${preview ? 'span' : 'button'} class="tab-plus" ${preview ? '' : 'data-act="newTx" aria-label="Nuevo movimiento"'}>${ic('plus')}</${preview ? 'span' : 'button'}>` + tab(tabs[2]) + tab(tabs[3]);
}
function defaultWishFund() {
  const t = new Date(), key = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
  return { start: key, history: [], adjustments: [], horizon: (t.getMonth() === 11 ? t.getFullYear() + 1 : t.getFullYear()) + '-12-31' };
}
function defaultState() {
  return {
    schema: 8, createdAt: new Date().toISOString(), demo: false,
    settings: { theme: 'auto', lockMinutes: 1, lockOnHide: true, privacy: false, budgetMode: 'installment', warnPct: 80, pin: null, passkey: null,
      pinFails: 0, lockUntil: 0, holidayEx: { extraHolidays: [], workdays: [] }, lastBackupAt: null, onboarded: false, notifDetail: 'private',
      glass: { transparency: 65, blur: 3, wallpaper: 'waves', refract: 70 }, scanAuto: true, scanMode: 'clean', tabs: DEFAULT_TABS.slice(), homeCharts: {}, drive: null, driveAuto: true },
    institutions: DEFAULT_INST.slice(), accounts: [], categories: defaultCategories(), people: [], transactions: [], budgets: [], goals: [], wishes: [], wishFund: defaultWishFund(),
    loans: [], rules: [], expected: [], audit: [], charts: [], driveFiles: {}, draft: null
  };
}

/* ---------- Almacenamiento en el dispositivo (IndexedDB) ---------- */
const Store = {
  db: null, ok: false, readOnly: false,
  // En iPhone la base de datos a veces tarda en abrir al volver a la app: se reintenta antes de rendirse.
  _open1() {
    return new Promise(res => {
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      try {
        const r = indexedDB.open('walletweb', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; this.ok = true; this.db.onclose = () => { this.ok = false; this.db = null; }; fin(true); };
        r.onerror = () => fin(false);
        r.onblocked = () => setTimeout(() => fin(false), 2500); // esperar a que se libere en vez de fallar enseguida
        setTimeout(() => fin(false), 4000);
      } catch (e) { fin(false); }
    });
  },
  async open() {
    for (let i = 0; i < 4; i++) { if (await this._open1()) return true; await new Promise(r => setTimeout(r, 200 * (i + 1))); }
    return false;
  },
  // Lectura que distingue "no hay nada guardado" de "no se pudo leer"
  getStrict(k) {
    return new Promise(res => {
      if (!this.db) return res({ ok: false });
      try { const t = this.db.transaction('kv', 'readonly'); const q = t.objectStore('kv').get(k); t.oncomplete = () => res({ ok: true, value: q.result }); t.onerror = t.onabort = () => res({ ok: false }); }
      catch (e) { res({ ok: false }); }
    });
  },
  _tx(mode, fn) {
    return new Promise(res => {
      if (!this.db || (mode === 'readwrite' && this.readOnly)) return res(null);
      try { const t = this.db.transaction('kv', mode); const st = t.objectStore('kv'); const q = fn(st); t.oncomplete = () => res(q && 'result' in q ? q.result : true); t.onerror = () => res(null); }
      catch (e) { res(null); }
    });
  },
  get(k) { return this._tx('readonly', st => st.get(k)); },
  set(k, v) { return this._tx('readwrite', st => st.put(v, k)); },
  del(k) { return this._tx('readwrite', st => st.delete(k)); },
  keys() { return this._tx('readonly', st => st.getAllKeys()); },
  clear() { return this._tx('readwrite', st => st.clear()); }
};

let S = defaultState();
let saveTimer = null;
// Copia espejo del estado en el almacenamiento local: si la base de datos falla al abrir, se recupera de aquí.
const MIRROR_KEY = 'walletweb-state-mirror';
/* ---------- Perfiles ----------
   Cada perfil guarda sus datos aparte. "main" usa las claves de siempre (compatibilidad); el perfil de
   demostración siempre existe y se llena con datos ficticios. */
const PROFILES_KEY = 'walletweb-profiles';
const CURRENCIES = [['COP', 'Peso colombiano'], ['USD', 'Dólar estadounidense'], ['EUR', 'Euro'], ['MXN', 'Peso mexicano'], ['ARS', 'Peso argentino'], ['CLP', 'Peso chileno'], ['PEN', 'Sol peruano'], ['BRL', 'Real brasileño'], ['GBP', 'Libra esterlina']];
function normProfiles(p) {
  if (!p || !Array.isArray(p.list) || !p.list.length) p = { active: 'main', list: [] };
  if (!p.list.some(x => x.id === 'main')) p.list.unshift({ id: 'main', name: 'Personal', currency: 'COP' });
  if (!p.list.some(x => x.demo)) p.list.push({ id: 'demo', name: 'Demostración', currency: 'COP', demo: true });
  if (!p.list.some(x => x.id === p.active)) p.active = 'main';
  return p;
}
let PROFILES_FROM_LS = false;
let PROFILES = normProfiles((() => { try { const v = JSON.parse(localStorage.getItem(PROFILES_KEY)); PROFILES_FROM_LS = !!v; return v; } catch (e) { return null; } })());
let PROFILE = PROFILES.list.find(x => x.id === PROFILES.active);
C.setCurrency(PROFILE.currency);
function saveProfiles() { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(PROFILES)); } catch (e) { /* */ } if (Store.ok) Store.set('profiles', JSON.parse(JSON.stringify(PROFILES))); }
const stateKey = (id = PROFILE.id) => id === 'main' ? 'state' : 'state:' + id;
const snapPrefix = (id = PROFILE.id) => id === 'main' ? 'snap:' : 'psnap:' + id + ':';
const mirrorKey = (id = PROFILE.id) => id === 'main' ? MIRROR_KEY : MIRROR_KEY + ':' + id;
function readMirror() { try { const t = localStorage.getItem(mirrorKey()); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function save() {
  if (Store.readOnly) return; // nunca guardar encima de datos que no se pudieron leer
  S.savedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const snap = JSON.parse(JSON.stringify(S));
    if (!IN_FRAME || !S.demo) { try { localStorage.setItem(mirrorKey(), JSON.stringify(snap)); } catch (e) { /* sin espacio: queda la base de datos */ } }
    if (!Store.ok && !Store.readOnly) await Store.open();
    const ok = await Store.set(stateKey(), snap);
    if (!ok) setBanner('No se pudo guardar en este navegador. Exporta una copia para no perder datos.', 'Exportar', () => go('ajustes'));
  }, 250);
}
function audit(action, entity, entityId, detail) {
  S.audit.unshift({ id: uid(), at: new Date().toISOString(), action, entity, entityId: entityId || null, detail: detail || '', device: deviceLabel() });
  const cutoff = Date.now() - 365 * 86400000;
  S.audit = S.audit.filter(a => Date.parse(a.at) >= cutoff).slice(0, 5000);
}
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Otro';
  const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : 'Navegador';
  return os + ' · ' + br + ' (aprox.)';
}

/* ---------- Búsquedas ---------- */
const accById = id => S.accounts.find(a => a.id === id);
const catById = id => S.categories.find(c => c.id === id);
const personById = id => S.people.find(p => p.id === id);
const loanById = id => S.loans.find(l => l.id === id);
const txById = id => S.transactions.find(t => t.id === id);
const activeAccounts = () => S.accounts.filter(a => !a.archived);
const cats = kind => S.categories.filter(c => !c.archived && (c.kind === kind || c.kind === 'both')).sort((a, b) => a.order - b.order);
const personName = id => personById(id)?.name || 'Persona';
const subName = t => t.subcategoryId ? catById(t.categoryId)?.subs.find(s => s.id === t.subcategoryId)?.name : '';
const catLabel = t => [catById(t.categoryId)?.name, subName(t)].filter(Boolean).join(' · ');
function txTitle(t) {
  if (t.merchant) return t.merchant;
  if (subName(t)) return subName(t);
  if (t.type === 'transfer') return 'Transferencia a ' + (accById(t.toAccountId)?.name || 'cuenta');
  if (t.personId) return TYPES[t.type] + ' · ' + personName(t.personId);
  return catById(t.categoryId)?.name || TYPES[t.type];
}
function txIcon(t) {
  if (t.type === 'transfer') return 'swap';
  if (t.type === 'loan_out' || t.type === 'loan_in' || t.type === 'repay_in' || t.type === 'repay_out') return 'hand';
  if (t.type === 'collect') return 'undo';
  if (t.type === 'adjust') return 'plusminus';
  const k = catById(t.categoryId)?.icon;
  return ICONS[k] ? k : (t.type === 'income' ? 'plus' : 'dots');
}

/* ---------- Fechas ---------- */
const dfLong = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dfShort = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dfFull = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dtFull = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: C.TZ });
const toD = iso => new Date(iso + 'T00:00:00Z');
const fdLong = iso => iso ? dfLong.format(toD(iso)) : '';
const fdShort = iso => iso ? dfShort.format(toD(iso)).replace('.', '') : '';
const fdFull = iso => iso ? dfFull.format(toD(iso)).replace('.', '') : '';
const fdt = isoTs => isoTs ? dtFull.format(new Date(isoTs)) : '';
function relDay(iso) { const d = C.diffDays(today(), iso); if (d === 0) return 'Hoy'; if (d === -1) return 'Ayer'; if (d === 1) return 'Mañana'; return fdShort(iso); }

/* ---------- Íconos (trazos propios) ---------- */
const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  hand: '<path d="M7 12l3-3a2 2 0 0 1 3 0l5 5"/><path d="M2 14l4-4 4 4-2 2a2 2 0 0 1-3 0z"/><path d="M14 10l2-2 6 6-3 3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>', check: '<path d="M20 6L9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1M15 9v1M12 9v4h-1M9 16s1 1 3 1 3-1 3-1"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  clip: '<path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>', upload: '<path d="M12 20V8M6 14l6-6 6 6M4 4h16"/>',
  cloud: '<path d="M7.5 18H7a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.7 9.1 4.5 4.5 0 0 1 17 18h-.5"/><path d="M12 20v-8M9 15l3-3 3 3"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  cart: '<path d="M3 4h2l2.4 11h10.8l2-8H6.2"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  utensils: '<path d="M6 3v6a3 3 0 0 0 6 0V3M9 3v18M17 21V3c-2.5 1.5-3.5 4-3.5 8H17"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/><path d="M8 14.5h.01M16 14.5h.01"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  pill: '<path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7z"/><path d="M7 7l7 7"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 2l4 4 4-4"/>',
  plane: '<path d="M21 15l-8-5V4.5a1.5 1.5 0 0 0-3 0V10l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4.5l8 2.5z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8c-1-3-5-4-5-1.5S10 8 12 8zM12 8c1-3 5-4 5-1.5S14 8 12 8z"/>',
  paw: '<circle cx="5.5" cy="10" r="1.7"/><circle cx="9.5" cy="5.5" r="1.7"/><circle cx="14.5" cy="5.5" r="1.7"/><circle cx="18.5" cy="10" r="1.7"/><path d="M12 11.5c-3 0-5.5 3.5-5.5 6 0 1.5 1.2 2.5 2.7 2.2l2.8-.7 2.8.7c1.5.3 2.7-.7 2.7-2.2 0-2.5-2.5-6-5.5-6z"/>',
  receipt: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
  laptop: '<rect x="5" y="4" width="14" height="11" rx="1.5"/><path d="M2 19h20"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  car: '<path d="M5 17v-6l2-5h10l2 5v6zM5 11h14M5 17v2h3v-2M16 17v2h3v-2"/><path d="M8 14h.01M16 14h.01"/>',
  heart: '<path d="M12 20s-7-4.5-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.5-9 9-9 9z"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  shirt: '<path d="M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
  dumbbell: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.1 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.4-4-7.8-9-7.8z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  bank: '<path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 21h18"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  plusminus: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  backspace: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/>',
  baby: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>'
};
const CAT_ICON_KEYS = ['cart', 'utensils', 'coffee', 'bus', 'car', 'fuel', 'home', 'bolt', 'phone', 'pill', 'heart', 'dumbbell', 'film', 'music', 'tv', 'bag', 'shirt', 'book', 'plane', 'gift', 'paw', 'baby', 'receipt', 'briefcase', 'laptop', 'undo', 'trend', 'coin', 'cash', 'card', 'bank', 'tag', 'plus', 'dots'];
const EMOJI_TO_ICON = { '🛒': 'cart', '🍽️': 'utensils', '🚌': 'bus', '🏠': 'home', '💡': 'bolt', '💊': 'pill', '🎬': 'film', '🛍️': 'bag', '📚': 'book', '📺': 'tv', '✈️': 'plane', '🎁': 'gift', '🐾': 'paw', '🧾': 'receipt', '•': 'dots', '💼': 'briefcase', '🧑‍💻': 'laptop', '↩️': 'undo', '📈': 'trend', '➕': 'plus', '🏷️': 'tag' };
const ic = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- Componentes ---------- */
function emptyState(e, title, text, btn) {
  return `<div class="empty"><div class="e" aria-hidden="true">${ic(e)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div>`;
}
function progress(pct, state) { return `<div class="bar ${state || ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></i></div>`; }
function sectionH(title, act, label) { return `<div class="section-h"><h2>${esc(title)}</h2>${act ? `<button class="link-btn" data-act="${act}">${esc(label || 'Ver todo')}</button>` : ''}</div>`; }
function seg(name, options, value, act) {
  return `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(l)}</button>`).join('')}</div>`;
}
function sw(name, checked, label, hint) {
  return `<div class="toggle-row"><div><div style="font-weight:600">${esc(label)}</div>${hint ? `<div class="hint" style="margin:2px 0 0">${esc(hint)}</div>` : ''}</div>
  <label class="switch"><input type="checkbox" data-bind="${esc(name)}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label></div>`;
}
function optionList(items, value, empty) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') + items.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
function statusPill(t) {
  if (t.status === 'confirmed') return '';
  return `<span class="pill ${t.status === 'pending' ? 'warn' : ''}">${esc(STATUS[t.status] || t.status)}</span>`;
}
function txRow(t) {
  const inflow = INFLOW.has(t.type) || (t.type === 'adjust' && t.amount > 0);
  const acc = accById(t.accountId);
  const bits = [acc?.name, t.type !== 'expense' && t.type !== 'income' ? TYPES[t.type] : catLabel(t)];
  if (t.split?.parts?.length) bits.push('Compartido');
  if (t.installments?.n > 1) bits.push(t.installments.n + ' cuotas');
  if (t.people?.length) bits.push(t.people.length <= 2 ? t.people.map(personName).join(', ') : personName(t.people[0]) + ' +' + (t.people.length - 1));
  if (t.reference) bits.push('Ref. ' + t.reference);
  return `<button class="row-item" data-act="txDetail" data-id="${t.id}">
    <span class="ico" aria-hidden="true"${txColor(t) ? ` style="--cc:${txColor(t)}"` : ''}>${ic(txIcon(t))}</span>
    <span class="grow"><span class="t">${esc(txTitle(t))}</span><span class="s">${esc(bits.filter(Boolean).join(' · '))}</span></span>
    <span class="r">${t.type === 'transfer' ? money(t.amount) : signed(t.amount, inflow)}<br>${statusPill(t)}</span></button>`;
}

/* ---------- Hojas, diálogos y avisos ---------- */
const sheets = [];
function openSheet({ title, body, footer, dirty, onClose, id }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-act="closeSheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Cerrar">${ic('x')}</button></header>
      <div class="sheet-b"></div><footer class="sheet-f" ${footer ? '' : 'hidden'}></footer></section>`;
  $('#sheets').appendChild(wrap);
  const s = { el: wrap, id, dirty, onClose,
    setBody(h) { const b = $('.sheet-b', wrap); const top = b.scrollTop; b.innerHTML = h; b.scrollTop = top; },
    setFooter(h) { const f = $('.sheet-f', wrap); f.innerHTML = h || ''; f.hidden = !h; },
    setTitle(t) { $('.sheet-h h2', wrap).textContent = t; } };
  s.setBody(body || ''); s.setFooter(footer || '');
  sheets.push(s);
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = $('.sheet-b input:not([type=checkbox]):not([type=file]), .sheet-b select', wrap); if (f && f.dataset.autofocus !== undefined) f.focus(); }, 60);
  return s;
}
const topSheet = () => sheets[sheets.length - 1];
async function closeSheet(force) {
  const s = topSheet();
  if (!s) return;
  if (!force && s.dirty && s.dirty()) { if (!(await confirmDialog('Tienes cambios sin guardar. ¿Quieres descartarlos?', { title: 'Descartar cambios', confirmText: 'Descartar', danger: true }))) return; }
  sheets.pop(); s.el.remove();
  if (!sheets.length) document.body.style.overflow = '';
  if (s.onClose) s.onClose();
}
function closeAllSheets() { while (sheets.length) { const s = sheets.pop(); s.el.remove(); } document.body.style.overflow = ''; }
function confirmDialog(message, { title = 'Confirmar', confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false, typed = null } = {}) {
  return new Promise(resolve => {
    const w = document.createElement('div');
    w.className = 'dialog-wrap';
    w.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlgT"><h3 id="dlgT">${esc(title)}</h3><p>${esc(message)}</p>
      ${typed ? `<div class="field"><label for="dlgIn">Escribe <b>${esc(typed)}</b> para continuar</label><input id="dlgIn" class="input" autocomplete="off" autocapitalize="characters"></div>` : ''}
      <div class="btn-row"><button class="btn" data-r="0">${esc(cancelText)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1" ${typed ? 'disabled' : ''}>${esc(confirmText)}</button></div></div>`;
    document.body.appendChild(w);
    const okBtn = $('[data-r="1"]', w);
    if (typed) { const inp = $('#dlgIn', w); inp.addEventListener('input', () => { okBtn.disabled = inp.value.trim() !== typed; }); setTimeout(() => inp.focus(), 50); } else okBtn.focus();
    w.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b || b.disabled) return; w.remove(); resolve(b.dataset.r === '1'); });
    w.addEventListener('keydown', e => { if (e.key === 'Escape') { w.remove(); resolve(false); } });
  });
}
function toast(msg, actionLabel, actionFn, ms = 4500) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  $('#toasts').appendChild(t);
  if (actionLabel) $('button', t).onclick = () => { t.remove(); actionFn(); };
  setTimeout(() => t.remove(), ms);
}
let bannerAction = null;
function setBanner(html, label, fn) {
  bannerAction = fn;
  $('#banner').innerHTML = html ? `<div class="banner"><span>${html}</span>${label ? `<button data-act="bannerAct">${esc(label)}</button>` : ''}</div>` : '';
}

/* ---------- Tema y privacidad ---------- */
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  applyGlass();
  const t = S.settings.theme === 'auto' ? (mqDark.matches ? 'dark' : 'light') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  const m = $('meta[name="theme-color"]'); if (m) m.content = t === 'dark' ? '#0A0B0D' : '#ECEEF1';
}
mqDark.addEventListener?.('change', applyTheme);
const IS_CHROMIUM = !!(navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.some(x => /Chromium/.test(x.brand)));
const GLASS_DEFAULT = { transparency: 65, blur: 3, wallpaper: 'waves', refract: 70 };
let wallUrl = null;
// Vidrio líquido: transparencia 0–100 → opacidad del vidrio .82–.02; desenfoque en px; refracción solo en Chromium.
async function applyGlass() {
  const g = Object.assign({}, GLASS_DEFAULT, S.settings.glass || {});
  const root = document.documentElement;
  root.style.setProperty('--ga', (0.82 * (1 - g.transparency / 100) + 0.02).toFixed(3));
  root.style.setProperty('--gb', g.blur + 'px');
  root.dataset.wall = g.wallpaper;
  root.classList.toggle('refract', IS_CHROMIUM && g.refract > 0);
  const disp = document.getElementById('lgDisp'); if (disp) disp.setAttribute('scale', (g.refract / 100 * 0.14).toFixed(3));
  if (g.wallpaper === 'photo') {
    if (!wallUrl) { const blob = await Store.get('wallpaper'); if (blob) { wallUrl = URL.createObjectURL(blob); } }
    if (wallUrl) root.style.setProperty('--wall-img', `url("${wallUrl}")`); else root.dataset.wall = 'waves';
  }
}
function applyPrivacy() { document.body.classList.toggle('privacy', !!S.settings.privacy); const b = $('#privBtn'); if (b) { b.innerHTML = ic(S.settings.privacy ? 'eyeoff' : 'eye'); b.setAttribute('aria-pressed', String(!!S.settings.privacy)); } }

/* ---------- Bloqueo (PIN + passkey del dispositivo) ---------- */
let locked = false, lastActivity = Date.now(), pinBuf = '', reauthResolver = null;
const hasLock = () => !!S.settings.pin;
function lockNow() { if (!hasLock() || locked) return; locked = true; reauthResolver = null; renderLock('Introduce tu PIN para continuar'); }
function renderLock(subtitle, cancellable) {
  const L = $('#lock');
  pinBuf = '';
  const pk = !!S.settings.passkey && !!window.PublicKeyCredential;
  L.innerHTML = `<div class="lock-logo">${ic('lock')}</div>
    <div style="text-align:center"><div style="font-weight:750;font-size:20px">WalletWeb</div><div class="muted small" id="lockSub">${esc(subtitle)}</div></div>
    <div class="pin-dots" id="pinDots" aria-live="polite">${'<i></i>'.repeat(S.settings.pin?.len || 4)}</div>
    <div class="keypad" role="group" aria-label="Teclado de PIN">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="pinKey" data-k="${n}" aria-label="${n}">${n}</button>`).join('')}
      ${pk ? `<button class="txt" data-act="passkeyUnlock" aria-label="Usar desbloqueo del dispositivo">${ic('face')}</button>` : (cancellable ? `<button class="txt" data-act="reauthCancel">Cancelar</button>` : '<span></span>')}
      <button data-act="pinKey" data-k="0" aria-label="0">0</button>
      <button class="txt" data-act="pinKey" data-k="del" aria-label="Borrar">${ic('backspace')}</button></div>
    ${pk ? `<button class="btn ghost" data-act="passkeyUnlock">${ic('face', 'sm')} Usar desbloqueo del dispositivo</button>` : ''}
    ${cancellable && pk ? `<button class="link-btn" data-act="reauthCancel">Cancelar</button>` : ''}`;
  L.hidden = false;
  document.body.classList.remove('cover');
  if (pk && !cancellable && document.visibilityState === 'visible') setTimeout(() => { if (locked) passkeyUnlock(true); }, 350);
}
function updateDots(shake) {
  const d = $('#pinDots'); if (!d) return;
  $$('i', d).forEach((el, k) => el.classList.toggle('on', k < pinBuf.length));
  if (shake) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); }
}
async function pinKey(k) {
  const now = Date.now();
  if (S.settings.lockUntil > now) { $('#lockSub').textContent = 'Demasiados intentos. Espera ' + Math.ceil((S.settings.lockUntil - now) / 1000) + ' s.'; return; }
  if (k === 'del') { pinBuf = pinBuf.slice(0, -1); updateDots(); return; }
  const len = S.settings.pin.len || 4;
  if (pinBuf.length >= len) return;
  pinBuf += k; updateDots();
  if (pinBuf.length === len) {
    const h = await C.hashPin(pinBuf, S.settings.pin.salt);
    if (h.hash === S.settings.pin.hash) { S.settings.pinFails = 0; save(); unlock(); }
    else {
      S.settings.pinFails = (S.settings.pinFails || 0) + 1;
      if (S.settings.pinFails >= 5) { const wait = Math.min(900, 30 * Math.pow(2, S.settings.pinFails - 5)); S.settings.lockUntil = Date.now() + wait * 1000; $('#lockSub').textContent = 'PIN incorrecto. Espera ' + wait + ' s.'; }
      else $('#lockSub').textContent = 'PIN incorrecto (' + S.settings.pinFails + '/5)';
      save(); pinBuf = ''; updateDots(true);
    }
  }
}
function unlock() {
  locked = false; lastActivity = Date.now();
  $('#lock').hidden = true; $('#lock').innerHTML = '';
  if (reauthResolver) { const r = reauthResolver; reauthResolver = null; r(true); }
}
function reauth(reason) {
  if (!hasLock()) return confirmDialog(reason + ' Configura un PIN en Ajustes → Seguridad para proteger esta acción.', { title: 'Acción protegida', confirmText: 'Continuar' });
  return new Promise(res => { reauthResolver = res; renderLock(reason, true); });
}
async function passkeyRegister() {
  if (!window.PublicKeyCredential) { toast('Este navegador no admite passkeys.'); return false; }
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'WalletWeb' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'walletweb', displayName: 'WalletWeb' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, attestation: 'none' } });
    S.settings.passkey = { id: C.b64(new Uint8Array(cred.rawId)), createdAt: new Date().toISOString(), device: deviceLabel() };
    audit('security.passkey_added', 'security', null, 'Passkey registrada en ' + deviceLabel()); save();
    toast('Desbloqueo del dispositivo activado');
    return true;
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Registro cancelado.' : 'No se pudo registrar la passkey en este navegador.'); return false; }
}
let pkBusy = false;
async function passkeyUnlock(silent) {
  if (pkBusy || !S.settings.passkey) return;
  pkBusy = true;
  try {
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: C.unb64(S.settings.passkey.id) }], userVerification: 'required', timeout: 60000 } });
    const ad = new Uint8Array(a.response.authenticatorData);
    if ((ad[32] & 0x04) === 0) throw new Error('uv');
    unlock();
  } catch (e) { if (!silent) toast('No se pudo verificar. Usa tu PIN.'); }
  finally { pkBusy = false; }
}
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => { if (!locked && hasLock() && Date.now() - lastActivity > S.settings.lockMinutes * 60000) lockNow(); }, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { document.body.classList.add('cover'); if (S.settings.lockOnHide && hasLock()) lockNow(); }
  else { if (!locked) document.body.classList.remove('cover'); }
});
window.addEventListener('pagehide', () => { if (hasLock() && S.settings.lockOnHide) lockNow(); });

/* ---------- Descargas / compartir archivos ---------- */
async function deliverFile(filename, mime, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return true; }
  } catch (e) { if (e.name === 'AbortError') return false; }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (IN_FRAME) toast('Si la descarga no empieza, usa la app instalada (la vista previa bloquea descargas).');
    return true;
  } catch (e) { toast('No se pudo descargar el archivo.'); return false; }
}
function readFileAs(file, how) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); if (how === 'text') r.readAsText(file); else r.readAsArrayBuffer(file); });
}
