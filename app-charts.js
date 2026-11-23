/* WalletWeb — gráficos con filtros: los del Inicio y "Mis gráficos" (creados por el usuario).
   Cada gráfico tiene su propio juego de filtros (periodo, categoría, persona, cuenta, tienda).
   Tocar o deslizar el dedo sobre un gráfico muestra debajo los movimientos que lo forman. */
'use strict';

/* ---------- Definiciones ---------- */
const CH_PERIODS = () => [['month', C.monthLabel(ui.month)], ['3m', 'Últimos 3 meses'], ['6m', 'Últimos 6 meses'], ['12m', 'Últimos 12 meses'], ['year', 'Este año'], ['all', 'Todo'], ['custom', 'Fechas…']];
const CH_GROUPS = [['category', 'Categoría'], ['sub', 'Subcategoría'], ['person', 'Persona'], ['merchant', 'Tienda'], ['account', 'Cuenta']];
const CH_MEASURES = [['expense', 'Gastos'], ['income', 'Ingresos'], ['both', 'Ingresos y gastos']];
const CH_SLOTS = 8;
// Gráficos fijos del Inicio. Sus filtros se guardan en S.settings.homeCharts.
const HOME_CHARTS = {
  trend: { name: 'Flujo de caja', kind: 'time', measure: 'both', f: { period: '6m' } },
  cats: { name: 'Gasto por categoría', kind: 'group', measure: 'expense', groupBy: 'category', f: { period: 'month' } },
  people: { name: 'Gasto por persona', kind: 'group', measure: 'expense', groupBy: 'person', f: { period: 'month' } }
};
const CH_MODEL = {}, CH_SEL = {}, CH_READ = {}, CH_DRILL = {};
const DIM_TITLE = { category: 'por categoría', sub: 'por subcategoría', person: 'por persona', merchant: 'por comercio', account: 'por cuenta' };
const dimTitle = (dim, measure) => (measure === 'income' ? 'Ingresos ' : 'Gasto ') + DIM_TITLE[dim];
let CHF = null; // borrador del formulario de gráfico

function chartDef(id) {
  if (HOME_CHARTS[id]) {
    const saved = (S.settings.homeCharts || {})[id] || {};
    const d = Object.assign({ id, home: true }, HOME_CHARTS[id], { f: Object.assign({}, HOME_CHARTS[id].f, saved) });
    if (d.kind === 'group' && d.f.gb && d.f.gb !== d.groupBy) { d.groupBy = d.f.gb; d.name = dimTitle(d.groupBy, d.measure).replace(/^./, c => c.toUpperCase()); }
    return d;
  }
  const c = (S.charts || []).find(x => x.id === id);
  if (!c) return null;
  const d = Object.assign({ f: {} }, c);
  if (d.kind === 'group' && d.f.gb) d.groupBy = d.f.gb;
  return d;
}
function chartFilterSave(id, f) {
  if (HOME_CHARTS[id]) { S.settings.homeCharts = Object.assign({}, S.settings.homeCharts, { [id]: f }); }
  else { const c = S.charts.find(x => x.id === id); if (c) c.f = f; }
  save();
}

/* ---------- Datos ---------- */
function chRange(f) {
  const t = today(), mk = C.monthKey(t);
  switch (f.period) {
    case 'month': { const [y, m] = ui.month.split('-').map(Number); return { from: ui.month + '-01', to: ui.month + '-' + String(C.daysInMonth(y, m)).padStart(2, '0') }; }
    case '3m': return { from: C.addMonthsKey(mk, -2) + '-01', to: t };
    case '6m': return { from: C.addMonthsKey(mk, -5) + '-01', to: t };
    case '12m': return { from: C.addMonthsKey(mk, -11) + '-01', to: t };
    case 'year': return { from: t.slice(0, 4) + '-01-01', to: t };
    case 'custom': return { from: f.from || null, to: f.to || null };
    default: return { from: null, to: null };
  }
}
function chPrevRange(f, r) {
  if (!r.from || !r.to) return null;
  if (f.period === 'month') { const pk = C.addMonthsKey(ui.month, -1), [y, m] = pk.split('-').map(Number); return { from: pk + '-01', to: pk + '-' + String(C.daysInMonth(y, m)).padStart(2, '0') }; }
  const span = C.diffDays(r.from, r.to) + 1;
  return { from: C.addDays(r.from, -span), to: C.addDays(r.from, -1) };
}
// Una entrada = un movimiento (o la parte de una persona) con su importe para el gráfico.
function chEntries(def, r) {
  const f = def.f || {}, out = [], q = (f.merchant || '').trim().toLowerCase();
  for (const t of S.transactions) {
    if (!C.isActive(t)) continue;
    const kind = t.type === 'expense' ? 'expense' : t.type === 'income' ? 'income' : null;
    if (!kind || (def.measure !== 'both' && def.measure !== kind)) continue;
    if (r.from && t.date < r.from) continue; if (r.to && t.date > r.to) continue;
    if (f.cat) { if (f.cat.startsWith('sub:')) { if (t.subcategoryId !== f.cat.slice(4)) continue; } else if (t.categoryId !== f.cat) continue; }
    if (f.account && t.accountId !== f.account) continue;
    if (q && !String(t.merchant || '').toLowerCase().includes(q)) continue;
    const amt = kind === 'expense' ? C.personalAmount(t) : t.amount;
    if (f.person) {
      if (!(t.people || []).includes(f.person)) continue;
      const part = C.attributeToPeople(amt, t.people).find(a => a.id === f.person);
      out.push({ t, kind, amount: part ? part.amount : 0, person: f.person });
    } else if (def.kind === 'group' && def.groupBy === 'person') {
      for (const a of C.attributeToPeople(amt, t.people || [])) out.push({ t, kind, amount: a.amount, person: a.id });
    } else out.push({ t, kind, amount: amt });
  }
  return out;
}
function chGroupKey(def, e) {
  const t = e.t;
  switch (def.groupBy) {
    case 'category': return t.categoryId || 'none';
    case 'sub': return t.subcategoryId ? t.categoryId + '|' + t.subcategoryId : 'none';
    case 'person': return e.person || 'none';
    case 'merchant': return String(t.merchant || '').trim().toUpperCase() || 'none';
    case 'account': return t.accountId || 'none';
  }
  return 'none';
}
function chGroupLabel(def, key, e) {
  if (key === 'none') return { category: 'Sin categoría', sub: 'Sin subcategoría', person: 'Sin persona', merchant: 'Sin tienda', account: 'Sin cuenta' }[def.groupBy];
  switch (def.groupBy) {
    case 'category': return catById(key)?.name || 'Categoría';
    case 'sub': return subName(e.t) || 'Subcategoría';
    case 'person': return personName(key);
    case 'merchant': return String(e.t.merchant).trim();
    case 'account': return accById(key)?.name || 'Cuenta';
  }
  return key;
}
// El color sigue a la entidad (su posición en la lista guardada), nunca a su puesto en el ranking.
function chGroupColor(def, key) {
  if (key !== 'none' && key !== '__other') {
    if (def.groupBy === 'category') { const c = catById(key); if (c) return catColor(c); }
    if (def.groupBy === 'sub') { const [cid, sid] = key.split('|'); const c = catById(cid); if (c) return subColor(c, sid); }
  }
  return key === '__other' ? 'var(--c0)' : `var(--c${chGroupSlot(def, key)})`;
}
function chGroupSlot(def, key) {
  let i = -1;
  if (key === 'none') return 0;
  if (def.groupBy === 'category') i = S.categories.filter(c => c.kind === 'expense' || c.kind === 'income').findIndex(c => c.id === key);
  else if (def.groupBy === 'sub') { const [cid, sid] = key.split('|'); i = (catById(cid)?.subs || []).findIndex(s => s.id === sid); }
  else if (def.groupBy === 'person') i = S.people.findIndex(p => p.id === key);
  else if (def.groupBy === 'account') i = S.accounts.findIndex(a => a.id === key);
  else return 1;
  return i >= 0 && i < CH_SLOTS ? i + 1 : 0;
}
function chBuckets(r, entries) {
  let from = r.from, to = r.to || today();
  if (!from) { from = entries.reduce((m, e) => e.t.date < m ? e.t.date : m, to); from = from.slice(0, 7) + '-01'; }
  const span = C.diffDays(from, to) + 1, out = [];
  let unit = span <= 45 ? 'day' : span <= 140 ? 'week' : 'month';
  if (unit === 'day') for (let d = from; d <= to; d = C.addDays(d, 1)) out.push({ from: d, to: d, label: String(Number(d.slice(8))), long: fdShort(d) });
  else if (unit === 'week') {
    let d = C.addDays(from, -((C.dow(from) + 6) % 7));
    for (; d <= to; d = C.addDays(d, 7)) { const e = C.addDays(d, 6); out.push({ from: d < from ? from : d, to: e > to ? to : e, label: fdShort(d), long: 'Semana del ' + fdShort(d) }); }
  } else {
    for (let k = from.slice(0, 7); k <= to.slice(0, 7); k = C.addMonthsKey(k, 1)) {
      const [y, m] = k.split('-').map(Number), last = k + '-' + String(C.daysInMonth(y, m)).padStart(2, '0');
      out.push({ from: k + '-01' < from ? from : k + '-01', to: last > to ? to : last, label: C.MONTHS[m - 1].slice(0, 3), long: C.monthLabel(k) });
    }
  }
  return { unit, list: out };
}
function chartModel(def, rOver) {
  const r = rOver || chRange(def.f || {}), entries = chEntries(def, r);
  const m = { def, r, entries, total: { expense: 0, income: 0 } };
  for (const e of entries) m.total[e.kind] += e.amount;
  const pr = rOver ? null : chPrevRange(def.f || {}, r);
  if (pr) { m.prev = { expense: 0, income: 0 }; for (const e of chEntries(def, pr)) m.prev[e.kind] += e.amount; }
  if (def.kind === 'time') {
    const b = chBuckets(r, entries);
    m.unit = b.unit;
    m.buckets = b.list.map(x => Object.assign(x, { expense: 0, income: 0, items: [] }));
    let j = 0;
    const sorted = entries.slice().sort((a, b2) => a.t.date.localeCompare(b2.t.date));
    for (const e of sorted) { while (j < m.buckets.length - 1 && e.t.date > m.buckets[j].to) j++; const bk = m.buckets[j]; if (bk && e.t.date >= bk.from && e.t.date <= bk.to) { bk[e.kind] += e.amount; bk.items.push(e); } }
  } else {
    const g = {};
    for (const e of entries) { const k = chGroupKey(def, e); const o = g[k] = g[k] || { key: k, label: chGroupLabel(def, k, e), amount: 0, items: [] }; o.amount += e.amount; o.items.push(e); }
    let list = Object.values(g).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
    if (def.groupBy === 'person') list = list.filter(x => x.key !== 'none');
    if (list.length > 7) { const rest = list.slice(6); list = list.slice(0, 6).concat([{ key: '__other', label: `Otros (${rest.length})`, amount: C.sum(rest.map(x => x.amount)), items: rest.flatMap(x => x.items), other: true }]); }
    m.groups = list;
  }
  return m;
}

/* ---------- Formato ---------- */
function moneyShort(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  const y = C.CUR.symbol + ' ';
  if (a >= 1e6) return s + y + (a / 1e6).toLocaleString('es-CO', { maximumFractionDigits: a >= 1e7 ? 0 : 1 }) + ' M';
  if (a >= 1e3) return s + y + Math.round(a / 1e3).toLocaleString('es-CO') + ' mil';
  return s + y + Math.round(a);
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function chFiltersText(def) {
  const f = def.f || {}, bits = [];
  if (f.cat) bits.push(f.cat.startsWith('sub:') ? (S.categories.flatMap(c => c.subs).find(s => s.id === f.cat.slice(4))?.name || 'Subcategoría') : (catById(f.cat)?.name || 'Categoría'));
  if (f.person) bits.push(personName(f.person));
  if (f.account) bits.push(accById(f.account)?.name || 'Cuenta');
  if (f.merchant) bits.push('“' + f.merchant + '”');
  return bits;
}
function chPeriodText(def) {
  const f = def.f || {};
  if (f.period === 'custom') return [f.from ? fdShort(f.from) : 'inicio', f.to ? fdShort(f.to) : 'hoy'].join(' – ');
  return (CH_PERIODS().find(p => p[0] === f.period) || CH_PERIODS()[0])[1];
}

/* ---------- Tarjeta del Inicio ----------
   Solo título, total y gráfica. Al tocarla se abre la ventana de análisis (filtros arriba, gráfica,
   y los movimientos debajo, que aparecen suavemente al deslizar hacia abajo). */
const CH_EXTRA = {}, CH_LIMIT = {};
function chartCard(id, extra) {
  if (extra !== undefined) CH_EXTRA[id] = extra;
  const def = chartDef(id);
  if (!def) return '';
  const m = chartModel(def);
  const main = def.measure === 'income' ? 'income' : 'expense';
  const head = def.measure === 'both' ? ['Flujo neto', m.total.income - m.total.expense] : [main === 'income' ? 'Total ingresos' : 'Total gastado', m.total[main]];
  const nf = chFiltersText(def).length;
  return `<div class="card ch-card ch-tap" id="ch-${esc(id)}" role="button" tabindex="0" data-act="chartOpen" data-v="${esc(id)}" aria-label="Abrir análisis ${esc(def.name)}">
    <div class="ch-head">
      <div class="ch-title"><h3>${esc(def.name)}</h3><div class="ch-sub">${ic('cal', 'sm')}<span>${esc(chPeriodText(def))}${nf ? ` · ${nf} filtro${nf > 1 ? 's' : ''}` : ''}</span></div></div>
      <div class="ch-hv"><div class="ch-k">${esc(head[0])}</div><div class="ch-v chart-sensitive">${money(head[1])}</div></div>
    </div>
    <div class="ch-stage chart-sensitive">${def.kind === 'time' ? timeChartSVG(id, m, true) : groupChartHTML(id, m, true)}</div>
    ${def.measure === 'both' ? '' : ''}
  </div>`;
}
function chRerender(id) { const el = document.getElementById('ch-' + id); if (el) { el.outerHTML = chartCard(id); applyPrivacy(); } }

/* ---------- Ventana de análisis ---------- */
let CHS = null; // { id, sheet }
function chartOpen(id) {
  const def = chartDef(id); if (!def) return;
  CH_SEL[id] = null; CH_READ[id] = false; CH_LIMIT[id] = 40; CH_DRILL[id] = { path: [], next: null };
  const s = openSheet({ id: 'chv', title: def.name, body: `<div class="chv-filters" id="chvf">${chSheetFilters(id)}</div><div class="chv-main" id="chvm">${chSheetMain(id)}</div>`,
    onClose: () => { CHS = null; chRerender(id); } });
  CHS = { id, sheet: s };
  const sh = s.el.querySelector('.sheet'), b = s.el.querySelector('.sheet-b');
  sh.classList.add('chv-sheet');
  b.addEventListener('scroll', () => chReveal(b), { passive: true });
  chReveal(b); applyPrivacy();
}
function chSheetFilters(id) {
  const def = chartDef(id);
  return `<div class="chv-fh"><span>Filtros</span>${def.home ? '' : `<button class="link-btn" data-act="chartEdit" data-v="${esc(id)}">${ic('edit', 'sm')} Editar análisis</button>`}</div>${chFilterRow(id, def)}`;
}
function chSheetMain(id) {
  const def = chartDef(id), m = CH_MODEL[id] = chartModel(def);
  if (m.buckets && CH_SEL[id] != null && CH_SEL[id] >= m.buckets.length) CH_SEL[id] = null;
  const dst = chDrillState(id);
  if (m.groups && dst.path[0] && !m.groups.some(g => g.key === dst.path[0].key)) dst.path = [];
  const main = def.measure === 'income' ? 'income' : 'expense';
  const tot = m.total[main], prevTot = m.prev ? m.prev[main] : null;
  const p = prevTot ? Math.round((tot - prevTot) / prevTot * 100) : null, good = main === 'income' ? p > 0 : p < 0;
  const delta = p === null || !isFinite(p) ? '' : p === 0 ? `<span class="ch-delta">Sin variación frente al periodo anterior</span>` : `<span class="ch-delta ${good ? 'up' : 'down'}">${ic(p > 0 ? 'up' : 'down', 'sm')}${Math.abs(p)} % frente al periodo anterior</span>`;
  const kpi = def.measure === 'both'
    ? `<div class="chv-kpis"><div><div class="ch-k">Flujo neto</div><div class="chv-big chart-sensitive">${money(m.total.income - m.total.expense)}</div></div><div><div class="ch-k">Ingresos</div><div class="chv-mid pos chart-sensitive">${money(m.total.income)}</div></div><div><div class="ch-k">Gastos</div><div class="chv-mid chart-sensitive">${money(m.total.expense)}</div></div></div>`
    : `<div class="chv-kpis"><div><div class="ch-k">${main === 'income' ? 'Total ingresos' : 'Total gastado'}</div><div class="chv-big chart-sensitive">${money(tot)}</div></div></div>`;
  return `${kpi}${delta ? `<div class="chv-delta">${delta}</div>` : ''}
    ${def.kind === 'group' ? `<div class="drill-dims gb" role="group" aria-label="Ver por">${CH_GROUPS.filter(([g]) => g !== 'account' || S.accounts.length > 1).map(([g, l]) => `<button class="drill-dim" data-act="chartGb" data-v="${esc(id)}" data-d="${g}" aria-pressed="${g === def.groupBy}">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="ch-wrap"><div class="ch-stage chart-sensitive" data-scrub="${esc(id)}">${def.kind === 'time' ? timeChartSVG(id, m) : groupChartHTML(id, m)}</div><div class="ch-read" id="chr-${esc(id)}" hidden></div></div>
    <p class="ch-insight">${esc(chInsight(m))}</p>
    <div class="chv-drill" id="chdrill-${esc(id)}">${chDrillHTML(id)}</div>
    ${CH_EXTRA[id] || ''}
    <section class="chv-movs" aria-label="Movimientos">
      <div class="chv-hint" aria-hidden="true">${ic('down', 'sm')}<span>Desliza hacia abajo para ver los movimientos</span></div>
      <div class="ch-detail" id="chd-${esc(id)}" aria-live="polite">${chDetailHTML(id)}</div>
    </section>`;
}
// Revelado progresivo: los movimientos pasan de casi invisibles a nítidos según cuánto se deslice.
function chReveal(b) {
  const mv = b.querySelector('.chv-movs'); if (!mv) return;
  const start = Math.max(0, mv.offsetTop - b.clientHeight + 40);
  const rev = Math.max(0, Math.min(1, (b.scrollTop - start + 30) / 160));
  mv.style.setProperty('--rev', rev.toFixed(3));
  mv.classList.toggle('in', rev > .35);
}
function chApplyFilter(id, f) {
  chartFilterSave(id, f); CH_SEL[id] = null; CH_READ[id] = false; CH_DRILL[id] = { path: [], next: null };
  if (CHS && CHS.id === id) {
    const fe = document.getElementById('chvf'), me = document.getElementById('chvm');
    if (fe) fe.innerHTML = chSheetFilters(id);
    if (me) { me.classList.add('swap'); setTimeout(() => { me.innerHTML = chSheetMain(id); applyPrivacy(); requestAnimationFrame(() => { me.classList.remove('swap'); const b = me.closest('.sheet-b'); if (b) chReveal(b); }); }, 170); }
  } else chRerender(id);
}
function chFilterRow(id, def) {
  const f = def.f || {}, sel = (k, items, v, empty, label) => `<label class="ch-pill ${v ? 'on' : ''}"><span class="sr-only">${esc(label)}</span><select data-chf="${esc(id)}" data-k="${k}" aria-label="${esc(label)}">${optionList(items, v || '', empty)}</select></label>`;
  const cats = S.categories.filter(c => !c.archived && (def.measure === 'both' || c.kind === def.measure)).flatMap(c => [[c.id, c.name], ...c.subs.map(s => ['sub:' + s.id, '› ' + s.name])]);
  return `<div class="ch-filters" role="group" aria-label="Filtros de ${esc(def.name)}">
    ${sel('period', CH_PERIODS(), f.period || 'month', undefined, 'Periodo')}
    ${sel('cat', cats, f.cat, 'Categoría', 'Categoría')}
    ${S.people.length ? sel('person', S.people.filter(x => !x.archived).map(x => [x.id, x.name]), f.person, 'Persona', 'Persona') : ''}
    ${S.accounts.length > 1 ? sel('account', S.accounts.map(a => [a.id, a.name]), f.account, 'Cuenta', 'Cuenta') : ''}
    ${f.cat || f.person || f.account || f.merchant ? `<button class="ch-pill ch-clear" data-act="chartClear" data-v="${esc(id)}">${ic('x', 'sm')} Quitar filtros</button>` : ''}
  </div>
  ${f.period === 'custom' ? `<div class="ch-dates"><input type="date" class="input" data-chf="${esc(id)}" data-k="from" value="${esc(f.from || '')}" aria-label="Desde"><input type="date" class="input" data-chf="${esc(id)}" data-k="to" value="${esc(f.to || '')}" aria-label="Hasta"></div>` : ''}`;
}
function chInsight(m) {
  const def = m.def;
  if (def.kind === 'group') {
    if (!m.groups.length) return 'No hay movimientos con estos filtros.';
    const tot = C.sum(m.groups.map(g => g.amount)), top = m.groups[0];
    const pct = tot ? Math.round(top.amount / tot * 100) : 0;
    return m.groups.length === 1 ? `Todo el valor está en ${top.label}. Tócalo para ver el detalle.` : `${top.label} concentra el ${pct} % (${moneyShort(top.amount)}). Toca una barra para filtrar y ver su detalle en otra gráfica.`;
  }
  const k = def.measure === 'income' ? 'income' : 'expense';
  const b = m.buckets.filter(x => x.from <= today());
  if (!m.entries.length) return 'No hay movimientos con estos filtros.';
  const peak = m.buckets.reduce((a, x) => x[k] > a[k] ? x : a, m.buckets[0]);
  const avg = b.length ? Math.round(m.total[k] / b.length) : 0;
  const per = { day: 'día', week: 'semana', month: 'mes' }[m.unit];
  return `Promedio por ${per}: ${moneyShort(avg)}. Pico: ${peak.long.startsWith('Semana') ? 'semana' + peak.long.slice(6) : peak.long} (${moneyShort(peak[k])}). Desliza el dedo de lado sobre la gráfica para ver cada ${per}.`;
}

/* ---------- Gráfico en el tiempo (línea + área) ---------- */
const CHW = 340, CHH = 168, CHL = 6, CHR = 6, CHT = 14, CHB = 24;
function chX(m, i) { const n = m.buckets.length; return n <= 1 ? CHW / 2 : CHL + (CHW - CHL - CHR) * i / (n - 1); }
function chSeriesColor(def, k) {
  if (def.measure === 'both') return k === 'income' ? 'var(--c1)' : 'var(--c2)';
  const cat = def.f?.cat; // filtrado por una categoría o subcategoría: la línea toma su color
  if (cat) { if (cat.startsWith('sub:')) { const c = S.categories.find(x => x.subs.some(s => s.id === cat.slice(4))); if (c) return subColor(c, cat.slice(4)); } else if (catById(cat)) return catColor(catById(cat)); }
  return 'var(--c1)';
}
function timeChartSVG(id, m, mini) {
  const def = m.def, keys = def.measure === 'both' ? ['income', 'expense'] : [def.measure];
  const max = niceMax(Math.max(1, ...m.buckets.flatMap(b => keys.map(k => b[k]))));
  m.max = max; m.keys = keys;
  const H = mini ? 132 : CHH, y = v => CHT + (H - CHT - CHB) * (1 - v / max);
  const grid = [0, .5, 1].map(r => { const yy = y(max * r); return `<line x1="0" x2="${CHW}" y1="${yy}" y2="${yy}" class="ch-gl${r === 0 ? ' base' : ''}"/>${r && !mini ? `<text x="2" y="${yy - 4}" class="ch-tick">${esc(moneyShort(max * r))}</text>` : ''}`; }).join('');
  const n = m.buckets.length, idxs = n <= 1 ? [0] : n <= 7 ? m.buckets.map((_, i) => i) : [0, Math.round((n - 1) / 2), n - 1];
  const xl = idxs.map(i => `<text x="${chX(m, i)}" y="${H - 6}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}" class="ch-tick">${esc(m.buckets[i].label)}</text>`).join('');
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const series = keys.map((k, j) => {
    const col = chSeriesColor(def, k), pts = m.buckets.map((b, i) => [chX(m, i), y(b[k])]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = n > 1 ? `<defs><linearGradient id="${gid + j}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${col};stop-opacity:.28"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs><path d="${line} L${pts[n - 1][0].toFixed(1)} ${y(0)} L${pts[0][0].toFixed(1)} ${y(0)} Z" fill="url(#${gid + j})"/>` : '';
    return area + (n > 1 ? `<path d="${line}" style="stroke:${col}" class="ch-line" pathLength="1"/>` : `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4" style="fill:${col}"/>`);
  }).join('');
  const legend = def.measure === 'both' ? `<div class="ch-legend"><span><i style="background:var(--c1)"></i>Ingresos</span><span><i style="background:var(--c2)"></i>Gastos</span></div>` : '';
  if (mini) return `${legend}<svg class="ch-svg mini" viewBox="0 0 ${CHW} ${H}" aria-hidden="true">${grid}${series}${xl}</svg>`;
  const si = CH_SEL[id], on = si != null && m.buckets[si], sx = on ? chX(m, si) : -20;
  const markers = keys.map(k => `<circle r="5" cx="${sx}" cy="${on ? y(m.buckets[si][k]) : -20}" class="ch-dot" data-k="${k}" style="fill:${chSeriesColor(def, k)}"/>`).join('');
  return `${legend}<svg class="ch-svg" data-chart="${esc(id)}" viewBox="0 0 ${CHW} ${H}" role="img" aria-label="${esc(def.name)} en el tiempo. Usa las flechas para recorrerlo." tabindex="0">
    ${grid}${series}<line class="ch-cross ${on ? 'on' : ''}" x1="${sx}" x2="${sx}" y1="${CHT - 6}" y2="${y(0)}"/>${markers}${xl}
    <rect x="0" y="0" width="${CHW}" height="${H}" fill="transparent"/></svg>`;
}
function chMoveCross(id) {
  const m = CH_MODEL[id], i = CH_SEL[id], svg = document.querySelector(`.ch-svg[data-chart="${CSS.escape(id)}"]`);
  if (!m || !svg || !m.buckets) return;
  const rd = document.getElementById('chr-' + id);
  if (i == null || !m.buckets[i]) { svg.querySelector('.ch-cross')?.classList.remove('on'); svg.querySelectorAll('.ch-dot').forEach(d => d.setAttribute('cy', -20)); if (rd) rd.hidden = true; return; }
  const x = chX(m, i), y = v => CHT + (CHH - CHT - CHB) * (1 - v / m.max);
  const cr = svg.querySelector('.ch-cross'); cr.setAttribute('x1', x); cr.setAttribute('x2', x); cr.classList.add('on');
  svg.querySelectorAll('.ch-dot').forEach(d => { d.setAttribute('cx', x); d.setAttribute('cy', y(m.buckets[i][d.dataset.k])); });
  if (rd && CH_READ[id]) {
    const b = m.buckets[i], pct = x / CHW * 100;
    rd.innerHTML = `<b>${esc(b.long)}</b>${m.keys.map(k => `<span><i style="background:${chSeriesColor(m.def, k)}"></i>${esc(moneyShort(b[k]))}</span>`).join('')}`;
    rd.style.left = pct + '%'; rd.style.transform = `translateX(${pct < 22 ? '0' : pct > 78 ? '-100%' : '-50%'})`; rd.hidden = false;
  }
}

/* ---------- Gráfico por grupos (barras horizontales) ---------- */
function groupChartHTML(id, m, mini, lvl, owner) {
  if (!m.groups.length) return `<div class="ch-empty">Sin movimientos para mostrar con estos filtros.</div>`;
  const max = m.groups[0].amount, tot = C.sum(m.groups.map(g => g.amount));
  const gs = mini ? m.groups.slice(0, 4) : m.groups;
  const row = g => { const col = g.other ? 'var(--c0)' : chGroupColor(m.def, g.key);
    return `<span class="ch-bl"><span class="ch-sw" style="background:${col}"></span><span class="ch-bn">${esc(g.label)}</span><span class="ch-bp">${tot ? Math.round(g.amount / tot * 100) : 0} %</span><span class="ch-bv">${money(g.amount)}</span></span>
      <span class="ch-track"><i style="--w:${Math.max(1.5, g.amount / max * 100).toFixed(1)}%;background:${col}"></i></span>`; };
  if (mini) return `<div class="ch-bars mini">${gs.map(g => `<div class="ch-bar">${row(g)}</div>`).join('')}${m.groups.length > 4 ? `<div class="ch-more-n">+${m.groups.length - 4} más</div>` : ''}</div>`;
  const own = owner || id, level = lvl || 0, path = (CH_DRILL[own] || { path: [] }).path;
  return `<div class="ch-bars" role="list">${gs.map(g => {
    const sel = !owner && path[0]?.key === g.key, col = g.other ? 'var(--c0)' : chGroupColor(m.def, g.key);
    if (g.other || g.key === 'none') return `<div class="ch-bar ch-bar-off" role="listitem">${row(g)}</div>`;
    return `<button class="ch-bar ${sel ? 'sel' : ''}" role="listitem" data-act="chartPick" data-chart="${esc(own)}" data-lvl="${level}" data-dim="${m.def.groupBy}" data-label="${esc(g.label)}" data-col="${esc(col)}" data-v="${esc(g.key)}" aria-pressed="${sel}">${row(g)}</button>`; }).join('')}</div>
    ${m.def.groupBy === 'person' ? '<p class="hint" style="margin:8px 0 0">Si un gasto tiene varias personas, se reparte entre ellas en partes iguales.</p>' : ''}`;
}

/* ---------- Filtros cruzados ----------
   Tocar una barra la convierte en filtro y abre debajo otro gráfico con esa selección,
   agrupado por otra dimensión (persona → categorías; categoría → personas…). Se puede seguir bajando. */
const DIM_NEXT = {
  person: ['category', 'sub', 'merchant', 'account'], category: ['person', 'sub', 'merchant', 'account'], sub: ['person', 'merchant', 'account'],
  merchant: ['category', 'sub', 'person', 'account'], account: ['category', 'sub', 'person', 'merchant'], time: ['category', 'sub', 'person', 'merchant', 'account']
};
function chPathFilter(path) {
  const f = {};
  for (const p of path) {
    if (p.dim === 'category') f.cat = p.key;
    else if (p.dim === 'sub') f.cat = 'sub:' + p.key.split('|')[1];
    else if (p.dim === 'person') f.person = p.key;
    else if (p.dim === 'merchant') f.merchant = p.label;
    else if (p.dim === 'account') f.account = p.key;
  }
  return f;
}
function chDrillState(id) { return CH_DRILL[id] || (CH_DRILL[id] = { path: [], next: null }); }
function chBaseRange(id) {
  const m = CH_MODEL[id]; if (!m) return null;
  if (m.def.kind === 'time' && m.buckets[CH_SEL[id]]) { const b = m.buckets[CH_SEL[id]]; return { from: b.from, to: b.to, label: b.long }; }
  return m.r;
}
function chDims(base, path) {
  const used = new Set(path.map(p => p.dim)); if (base.kind === 'group') used.add(base.groupBy);
  const f = base.f || {}, catFixed = f.cat || used.has('category') || used.has('sub'), subFixed = (f.cat || '').startsWith('sub:') || used.has('sub');
  return DIM_NEXT[base.kind === 'group' ? base.groupBy : 'time'].filter(d => {
    if (used.has(d)) return false;
    if (d === 'category' && catFixed) return false;
    if (d === 'sub' && subFixed) return false;
    if (d === 'person' && (f.person || !S.people.length)) return false;
    if (d === 'account' && (f.account || S.accounts.length < 2)) return false;
    if (d === 'merchant' && f.merchant) return false;
    return true;
  });
}
function chDrillModel(id) {
  const m = CH_MODEL[id]; if (!m) return null;
  const st = chDrillState(id), base = m.def;
  if (base.kind === 'group' ? !st.path.length : CH_SEL[id] == null) return null;
  const avail = chDims(base, st.path), next = avail.includes(st.next) ? st.next : avail[0];
  if (!next) return { avail, next: null };
  const measure = base.measure === 'both' ? 'expense' : base.measure;
  const def = { id: id + '__d', kind: 'group', groupBy: next, measure, f: Object.assign({}, base.f, chPathFilter(st.path)) };
  return { avail, next, m: CH_MODEL[def.id] = chartModel(def, chBaseRange(id)) };
}
function chCrumbs(id) {
  const st = chDrillState(id), r = chBaseRange(id), m = CH_MODEL[id];
  const chips = [];
  if (m?.def.kind === 'time' && r?.label) chips.push(`<button class="crumb" data-act="chartCrumb" data-v="${esc(id)}" data-i="-1">${ic('cal', 'sm')}${esc(r.label)}${ic('x', 'sm')}</button>`);
  st.path.forEach((p, i) => chips.push(`<button class="crumb" style="--cc:${p.color}" data-act="chartCrumb" data-v="${esc(id)}" data-i="${i}"><i></i>${esc(p.label)}${ic('x', 'sm')}</button>`));
  return chips.length ? `<div class="crumbs" aria-label="Filtros aplicados desde las gráficas">${chips.join('<span class="crumb-sep" aria-hidden="true">›</span>')}</div>` : '';
}
function chDrillHTML(id) {
  const dm = chDrillModel(id); if (!dm) return '';
  const st = chDrillState(id);
  const dims = dm.avail.length > 1 ? `<div class="drill-dims" role="group" aria-label="Ver por">${dm.avail.map(d => `<button class="drill-dim" data-act="chartDim" data-v="${esc(id)}" data-d="${d}" aria-pressed="${d === dm.next}">${esc(CH_GROUPS.find(g => g[0] === d)[1])}</button>`).join('')}</div>` : '';
  const body = dm.m ? groupChartHTML(id + '__d', dm.m, false, st.path.length, id) : '';
  return `<div class="drill-card">
    <div class="drill-top">${ic('right', 'sm')}<span>Filtrado desde la gráfica</span></div>
    ${chCrumbs(id)}
    ${dm.m ? `<div class="drill-h"><h4>${esc(dimTitle(dm.next, dm.m.def.measure).replace(/^./, c => c.toUpperCase()))}</h4><div class="drill-v chart-sensitive">${money(dm.m.total[dm.m.def.measure])}</div></div>${dims}<div class="drill-body chart-sensitive">${body}</div>` : ''}
  </div>`;
}
function chRefreshDrill(id, scroll) {
  const box = document.getElementById('chdrill-' + id);
  const st = chDrillState(id), m = CH_MODEL[id];
  if (m?.def.kind === 'group') document.querySelectorAll(`.ch-bar[data-chart="${CSS.escape(id)}"]`).forEach(b => { const on = st.path[0]?.key === b.dataset.v; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
  if (box) {
    box.classList.add('swap');
    setTimeout(() => {
      box.innerHTML = chDrillHTML(id); applyPrivacy();
      requestAnimationFrame(() => box.classList.remove('swap'));
      if (scroll && box.innerHTML.trim()) { const b = box.closest('.sheet-b'); if (b) setTimeout(() => b.scrollTo({ top: box.offsetTop - 120, behavior: 'smooth' }), 60); }
    }, 160);
  }
  chRefreshDetail(id);
}

/* ---------- Movimientos: de todo el periodo, o del punto / barra elegida ---------- */
function chDetailHTML(id) {
  const m = CH_MODEL[id]; if (!m) return '';
  const lim = CH_LIMIT[id] || 40, st = chDrillState(id), r = chBaseRange(id) || m.r;
  const picked = st.path.length || (m.def.kind === 'time' && CH_SEL[id] != null);
  let items, title;
  if (picked) {
    const d = Object.assign({}, m.def, { kind: 'group', groupBy: '__none', f: Object.assign({}, m.def.f, chPathFilter(st.path)) });
    items = chEntries(d, r);
    title = [r.label, ...st.path.map(p => p.label)].filter(Boolean).join(' · ');
  } else { title = 'Movimientos del periodo'; items = m.entries; }
  const byTx = new Map();
  for (const e of items) { const o = byTx.get(e.t.id) || { t: e.t, amount: 0 }; o.amount += e.amount; byTx.set(e.t.id, o); }
  const list = [...byTx.values()].sort((a, b) => b.t.date.localeCompare(a.t.date) || b.amount - a.amount);
  const sumBy = k => C.sum(items.filter(e => e.kind === k).map(e => e.amount));
  const head = m.def.measure === 'both' ? `<div class="ch-dv2"><span class="muted">Ingresos</span> <span class="pos">${money(sumBy('income'))}</span></div><div class="ch-dv2"><span class="muted">Gastos</span> ${money(sumBy('expense'))}</div>` : money(C.sum(items.map(e => e.amount)));
  const pf = chPathFilter(st.path);
  m.link = { from: r.from, to: r.to, cat: pf.cat, person: pf.person, account: pf.account, q: pf.merchant };
  return `<div class="ch-dh"><div><div class="ch-dt">${esc(title)}</div><div class="muted small">${list.length} movimiento${list.length === 1 ? '' : 's'}${picked && id !== '__preview' ? ` · <button class="link-btn ch-reset" data-act="chartAll" data-v="${esc(id)}">Quitar selección</button>` : ''}</div></div><div class="ch-dv chart-sensitive">${head}</div></div>
    ${list.length ? `<div class="ch-dl">${list.slice(0, lim).map((x, i) => chTxRow(x, i)).join('')}</div>` : `<div class="ch-empty">Sin movimientos.</div>`}
    ${list.length ? `<button class="link-btn ch-all" data-act="chartToMovs" data-v="${esc(id)}">${list.length > lim ? `Ver los ${list.length} en Movimientos` : 'Abrir en Movimientos'} ${ic('right', 'sm')}</button>` : ''}`;
}
function chTxRow({ t, amount }, i) {
  const inflow = t.type === 'income', share = amount !== t.amount && t.type === 'expense';
  return `<button class="ch-row" style="--i:${Math.min(i || 0, 12)}" data-act="txDetail" data-id="${t.id}"><span class="ch-rd">${esc(fdShort(t.date))}</span>
    <span class="ch-rt"><span class="t">${esc(txTitle(t))}</span><span class="s">${esc([catLabel(t), share ? 'parte de ' + C.formatMoney(personalAmountSafe(t)) : ''].filter(Boolean).join(' · '))}</span></span>
    <span class="ch-ra ${inflow ? 'pos' : ''}">${money(amount)}</span></button>`;
}
function personalAmountSafe(t) { try { return C.personalAmount(t); } catch (e) { return t.amount; } }
function chRefreshDrillSoon(id) { clearTimeout(chRefreshDrillSoon[id]); chRefreshDrillSoon[id] = setTimeout(() => chRefreshDrill(id), 120); }
function chRefreshDetail(id) {
  const d = document.getElementById('chd-' + id); if (!d) return;
  clearTimeout(d._t); d.classList.add('swap');
  d._t = setTimeout(() => { d.innerHTML = chDetailHTML(id); applyPrivacy(); requestAnimationFrame(() => d.classList.remove('swap')); }, 140);
}

/* ---------- Deslizar de lado sobre la gráfica (en la ventana y en la vista previa) ---------- */
(() => {
  let g = null;
  const pickAt = (st, ev) => {
    const id = st.dataset.scrub, m = CH_MODEL[id], svg = st.querySelector('.ch-svg'); if (!m || !m.buckets?.length || !svg) return;
    const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * CHW;
    const n = m.buckets.length, i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((x - CHL) / (CHW - CHL - CHR) * (n - 1))));
    CH_READ[id] = true;
    if (CH_SEL[id] === i) return;
    CH_SEL[id] = i; chMoveCross(id); chRefreshDrillSoon(id);
    if (navigator.vibrate) try { navigator.vibrate(4); } catch (e) { /* */ }
  };
  document.addEventListener('pointerdown', e => { const st = e.target.closest?.('[data-scrub]'); if (st && st.querySelector('.ch-svg')) g = { st, x: e.clientX, y: e.clientY, mode: null }; });
  document.addEventListener('pointermove', e => {
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.mode && Math.hypot(dx, dy) > 6) g.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (g.mode === 'h') { g.st.classList.add('scrub'); pickAt(g.st, e); }
  });
  document.addEventListener('pointerup', e => { if (!g) return; if (!g.mode) pickAt(g.st, e); g.st.classList.remove('scrub'); g = null; });
  document.addEventListener('pointercancel', () => { if (g) { g.st.classList.remove('scrub'); g = null; } });
  document.addEventListener('keydown', e => {
    const card = e.target.closest?.('.ch-tap');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); chartOpen(card.dataset.v); return; }
    const s = e.target.closest?.('[data-scrub]'); if (!s || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const id = s.dataset.scrub, m = CH_MODEL[id]; if (!m?.buckets) return;
    e.preventDefault(); CH_READ[id] = true;
    CH_SEL[id] = Math.max(0, Math.min(m.buckets.length - 1, (CH_SEL[id] ?? m.buckets.length) + (e.key === 'ArrowLeft' ? -1 : 1))); chMoveCross(id); chRefreshDrillSoon(id);
  });
  document.addEventListener('change', e => {
    const t = e.target; if (!t.dataset || t.dataset.chf === undefined) return;
    const id = t.dataset.chf;
    if (id === '__form') { if (t.dataset.k === '__groupBy') CHF.groupBy = t.value; else CHF.f[t.dataset.k] = t.value; if (t.dataset.k === 'period' && t.value === 'custom' && !CHF.f.from) { CHF.f.from = C.addDays(today(), -30); CHF.f.to = today(); } chFormRefresh(); return; }
    const def = chartDef(id); if (!def) return;
    const f = Object.assign({}, def.f, { [t.dataset.k]: t.value });
    if (t.dataset.k === 'period' && t.value === 'custom' && !f.from) { f.from = C.addDays(today(), -30); f.to = today(); }
    chApplyFilter(id, f);
  });
})();

/* ---------- Mis gráficos: sección y formulario ---------- */
function myChartsSection() {
  const list = S.charts || [];
  const sugg = chSuggestions();
  return `<section class="my-charts" aria-label="Mis gráficos">
    <div class="section-h"><h2>Análisis personalizados</h2><button class="link-btn" data-act="chartNew">${ic('plus', 'sm')} Nuevo gráfico</button></div>
    ${list.length ? `<div class="ch-list">${list.map(c => chartCard(c.id)).join('')}</div>` : `<div class="card ch-new">
      <div class="ch-new-t">Crea tus propios análisis</div>
      <p class="muted small" style="margin:4px 0 12px">Elige qué medir y filtra por persona, categoría, tienda, cuenta y fechas. Por ejemplo, cuánto has gastado en comida con tu papá.</p>
      <button class="btn primary" data-act="chartNew">${ic('plus', 'sm')} Crear gráfico</button></div>`}
    ${sugg.length ? `<div class="ch-sugg"><span class="muted small">Sugeridos para ti</span><div class="chips">${sugg.map((s, i) => `<button class="chip" data-act="chartSuggest" data-v="${i}">${ic('plus', 'sm')} ${esc(s.name)}</button>`).join('')}</div></div>` : ''}
  </section>`;
}
// Sugerencias a partir de los datos: la persona y la subcategoría donde más se gasta, etc.
function chSuggestions() {
  const out = [], have = new Set((S.charts || []).map(c => c.name));
  const since = C.addMonthsKey(C.monthKey(today()), -5) + '-01';
  const exp = S.transactions.filter(t => C.isActive(t) && t.type === 'expense' && t.date >= since);
  const tally = (fn) => { const o = {}; for (const t of exp) for (const k of [].concat(fn(t) || [])) o[k] = (o[k] || 0) + C.personalAmount(t); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const topPerson = tally(t => t.people)[0], topSub = tally(t => t.subcategoryId)[0];
  const subObj = id => S.categories.flatMap(c => c.subs).find(s => s.id === id);
  if (topPerson && topSub) {
    const pt = tally(t => (t.people || []).includes(topPerson[0]) ? t.subcategoryId : null)[0];
    if (pt) out.push({ name: `${subObj(pt[0])?.name || 'Gasto'} · ${personName(topPerson[0])}`, kind: 'time', measure: 'expense', f: { period: '6m', person: topPerson[0], cat: 'sub:' + pt[0] } });
  }
  if (topSub) out.push({ name: `Evolución de ${(subObj(topSub[0])?.name || 'gasto').toLowerCase()}`, kind: 'time', measure: 'expense', f: { period: '6m', cat: 'sub:' + topSub[0] } });
  if (exp.some(t => t.merchant)) out.push({ name: 'Gasto por comercio', kind: 'group', measure: 'expense', groupBy: 'merchant', f: { period: '3m' } });
  if (S.people.length) out.push({ name: 'Gasto por persona · año', kind: 'group', measure: 'expense', groupBy: 'person', f: { period: 'year' } });
  return out.filter(s => !have.has(s.name)).slice(0, 3);
}
function chFormBody() {
  const d = CHF, f = d.f;
  const cats = S.categories.filter(c => !c.archived && (d.measure === 'both' || c.kind === d.measure)).flatMap(c => [[c.id, c.name], ...c.subs.map(s => ['sub:' + s.id, '› ' + s.name])]);
  return `<div class="field"><label for="chN">Nombre</label><input id="chN" class="input" data-chn value="${esc(d.name)}" placeholder="Ej.: Alimentación · Papá" autocomplete="off" maxlength="60"></div>
    <div class="field"><span class="lbl">Tipo de gráfico</span>${seg('Tipo', [['time', 'En el tiempo'], ['group', 'Comparar']], d.kind, 'chfKind')}
      <p class="hint">${d.kind === 'time' ? 'Una línea que muestra cómo sube o baja por día, semana o mes.' : 'Barras que comparan quién, qué o dónde suma más.'}</p></div>
    <div class="field"><span class="lbl">Qué medir</span>${seg('Medir', CH_MEASURES.filter(x => d.kind === 'time' || x[0] !== 'both'), d.measure, 'chfMeasure')}</div>
    ${d.kind === 'group' ? `<div class="field"><label for="chG">Comparar por</label><select id="chG" class="input" data-chf="__form" data-k="__groupBy">${optionList(CH_GROUPS, d.groupBy)}</select></div>` : ''}
    <div class="sub-h">Filtros</div>
    <div class="grid2">
      <div class="field"><label for="chP">Periodo</label><select id="chP" class="input" data-chf="__form" data-k="period">${optionList(CH_PERIODS(), f.period || '6m')}</select></div>
      <div class="field"><label for="chC">Categoría</label><select id="chC" class="input" data-chf="__form" data-k="cat">${optionList(cats, f.cat || '', 'Todas')}</select></div>
      <div class="field"><label for="chPe">Persona</label><select id="chPe" class="input" data-chf="__form" data-k="person">${optionList(S.people.filter(x => !x.archived).map(x => [x.id, x.name]), f.person || '', 'Todas')}</select></div>
      <div class="field"><label for="chA">Cuenta</label><select id="chA" class="input" data-chf="__form" data-k="account">${optionList(S.accounts.map(a => [a.id, a.name]), f.account || '', 'Todas')}</select></div>
    </div>
    ${f.period === 'custom' ? `<div class="grid2"><div class="field"><label for="chF">Desde</label><input id="chF" type="date" class="input" data-chf="__form" data-k="from" value="${esc(f.from || '')}"></div><div class="field"><label for="chT">Hasta</label><input id="chT" type="date" class="input" data-chf="__form" data-k="to" value="${esc(f.to || '')}"></div></div>` : ''}
    <div class="field"><label for="chM">Tienda contiene</label><input id="chM" class="input" data-chm value="${esc(f.merchant || '')}" placeholder="Ej.: Éxito, Rappi" autocomplete="off"></div>
    <div class="sub-h">Vista previa</div>
    <div id="chPrev">${chPreview()}</div>`;
}
function chPreview() {
  const id = '__preview';
  const prev = Object.assign({ id, name: CHF.name || 'Vista previa' }, CHF, { f: Object.assign({}, CHF.f) });
  const m = CH_MODEL[id] = chartModel(prev);
  CH_SEL[id] = null; CH_READ[id] = false; CH_LIMIT[id] = 4;
  const main = prev.measure === 'income' ? 'income' : 'expense';
  return `<div class="card flat ch-card ch-preview"><div class="ch-kpi"><div><div class="ch-k">Total</div><div class="ch-v">${money(m.total[main])}</div></div></div>
    <div class="ch-wrap"><div class="ch-stage" data-scrub="__preview">${prev.kind === 'time' ? timeChartSVG(id, m) : groupChartHTML(id, m)}</div><div class="ch-read" id="chr-__preview" hidden></div></div><p class="ch-insight">${esc(chInsight(m))}</p><div class="ch-detail" id="chd-${id}">${chDetailHTML(id)}</div></div>`;
}
function chFormRefresh() {
  const s = sheets.find(x => x.id === 'chart'); if (!s) return;
  s.setBody(chFormBody());
}
function chartForm(id, preset) {
  const c = id ? S.charts.find(x => x.id === id) : null;
  CHF = c ? JSON.parse(JSON.stringify(c)) : Object.assign({ id: null, name: '', kind: 'time', measure: 'expense', groupBy: 'category', f: { period: '6m' } }, preset ? JSON.parse(JSON.stringify(preset)) : {});
  CHF.f = CHF.f || {};
  openSheet({ id: 'chart', title: c ? 'Editar gráfico' : 'Nuevo gráfico', body: chFormBody(),
    footer: `${c ? `<button class="btn" data-act="chartDelete" data-v="${esc(c.id)}">${ic('trash', 'sm')} Eliminar</button>` : ''}<button class="btn primary" data-act="chartSave">${ic('check', 'sm')} Guardar</button>` });
}
function chAutoName(d) {
  const f = d.f, sub = f.cat ? chFiltersText({ f: { cat: f.cat } })[0] : null;
  let n = sub || (d.measure === 'income' ? 'Ingresos' : d.measure === 'both' ? 'Flujo de caja' : 'Gasto');
  if (d.kind === 'group') n += ' por ' + (CH_GROUPS.find(g => g[0] === d.groupBy)?.[1] || '').toLowerCase();
  if (f.person) n += ' · ' + personName(f.person);
  return n;
}
document.addEventListener('input', e => {
  const t = e.target; if (!CHF) return;
  if (t.dataset.chn !== undefined) CHF.name = t.value;
  if (t.dataset.chm !== undefined) { CHF.f.merchant = t.value; clearTimeout(chFormRefresh.t); chFormRefresh.t = setTimeout(() => { const p = $('#chPrev'); if (p) p.innerHTML = chPreview(); }, 250); }
});

Object.assign(ACT, {
  chartOpen: el => chartOpen(el.dataset.v),
  chartPick: el => {
    const id = el.dataset.chart, lvl = Number(el.dataset.lvl || 0), st = chDrillState(id);
    if (!CH_MODEL[id]) return;
    if (id === '__preview') return;
    const same = st.path[lvl]?.key === el.dataset.v && st.path.length === lvl + 1;
    st.path = st.path.slice(0, lvl);
    if (!same) st.path.push({ dim: el.dataset.dim, key: el.dataset.v, label: el.dataset.label, color: el.dataset.col });
    st.next = null;
    chRefreshDrill(id, !same);
  },
  chartCrumb: el => {
    const id = el.dataset.v, i = Number(el.dataset.i), st = chDrillState(id);
    if (i < 0) { CH_SEL[id] = null; CH_READ[id] = false; chMoveCross(id); } else st.path = st.path.slice(0, i);
    st.next = null; chRefreshDrill(id);
  },
  chartDim: el => { const st = chDrillState(el.dataset.v); st.next = el.dataset.d; chRefreshDrill(el.dataset.v); },
  chartGb: el => { const id = el.dataset.v, def = chartDef(id); if (def.groupBy === el.dataset.d) return; chApplyFilter(id, Object.assign({}, def.f, { gb: el.dataset.d })); if (CHS?.id === id) CHS.sheet.setTitle(chartDef(id).name); },
  chartAll: el => { const id = el.dataset.v; CH_SEL[id] = null; CH_READ[id] = false; CH_DRILL[id] = { path: [], next: null }; chMoveCross(id); chRefreshDrill(id); },
  chartClear: el => { const id = el.dataset.v, def = chartDef(id); chApplyFilter(id, { period: def.f.period, from: def.f.from, to: def.f.to }); },
  chartToMovs: el => {
    const l = CH_MODEL[el.dataset.v]?.link, def = CH_MODEL[el.dataset.v]?.def; if (!l) return;
    closeAllSheets();
    Object.assign(ui, { movPeriod: l.from || l.to ? 'custom' : 'all', movFrom: l.from || '', movTo: l.to || '', movCategory: l.cat || def.f.cat || '', movPerson: l.person || def.f.person || '', movAccount: l.account || def.f.account || '', movQ: l.q || def.f.merchant || '', movType: def.measure === 'both' ? (l.cat || l.person ? 'expense' : 'all') : def.measure, movLimit: 60 });
    go('movimientos');
  },
  chartNew: () => chartForm(null),
  chartSuggest: el => { const s = chSuggestions()[Number(el.dataset.v)]; if (s) chartForm(null, s); },
  chartEdit: el => chartForm(el.dataset.v),
  chfKind: el => { CHF.kind = el.dataset.v; if (CHF.kind === 'group' && CHF.measure === 'both') CHF.measure = 'expense'; chFormRefresh(); },
  chfMeasure: el => { CHF.measure = el.dataset.v; CHF.f.cat = ''; chFormRefresh(); },
  chartSave: async () => {
    const name = (CHF.name || '').trim() || chAutoName(CHF);
    const rec = { id: CHF.id || uid(), name: name.slice(0, 60), kind: CHF.kind, measure: CHF.measure, groupBy: CHF.kind === 'group' ? CHF.groupBy : undefined, f: CHF.f, createdAt: CHF.createdAt || new Date().toISOString() };
    if (!Array.isArray(S.charts)) S.charts = [];
    const i = S.charts.findIndex(x => x.id === rec.id);
    if (i >= 0) S.charts[i] = rec; else S.charts.push(rec);
    save(); CHF = null; await closeSheet(true); render(); toast(i >= 0 ? 'Gráfico actualizado' : 'Gráfico creado');
    if (CHS && CHS.id === rec.id) { CHS.sheet.setTitle(rec.name); chApplyFilter(rec.id, rec.f); return; }
    setTimeout(() => document.getElementById('ch-' + rec.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  },
  chartDelete: async el => {
    const id = el.dataset.v, c = S.charts.find(x => x.id === id); if (!c) return;
    if (!(await confirmDialog(`Se eliminará el gráfico "${c.name}". Tus movimientos no cambian.`, { title: 'Eliminar gráfico', confirmText: 'Eliminar', danger: true }))) return;
    const at = S.charts.indexOf(c); S.charts.splice(at, 1); save(); CHF = null; await closeSheet(true); if (CHS && CHS.id === id) await closeSheet(true); render();
    toast('Gráfico eliminado', 'Deshacer', () => { S.charts.splice(at, 0, c); save(); render(); });
  }
});
