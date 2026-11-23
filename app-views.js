/* WalletWeb — cálculos de pantalla, alertas por reglas y vistas. */
'use strict';
const ui = { month: thisMonth(), movPerson: '', movQ: '', movType: 'all', movPeriod: 'month', movAccount: '', movCategory: '', movLimit: 60, loanTab: 'given', showArchived: false, budgetMonth: thisMonth() };
let route = 'inicio';

/* ---------- Cálculos ---------- */
function monthStats(key) {
  const mode = S.settings.budgetMode;
  let expense = 0, income = 0, expensePurchase = 0, collected = 0, outflow = 0;
  const byCat = {};
  for (const t of S.transactions) {
    if (!C.isActive(t)) continue;
    const e = C.expenseInMonth(t, key, mode);
    if (e) { expense += e; byCat[t.categoryId || 'none'] = (byCat[t.categoryId || 'none'] || 0) + e; }
    expensePurchase += C.expenseInMonth(t, key, 'purchase');
    income += C.incomeInMonth(t, key);
    if (C.monthKey(t.date) === key) { if (t.type === 'collect') collected += t.amount; if (t.type === 'expense') outflow += t.amount; }
  }
  const exp = S.expected.filter(x => x.kind === 'income' && C.monthKey(x.due) === key && !['cancelled', 'skipped'].includes(x.status));
  return { expense, income, expensePurchase, collected, outflow, byCat, expectedIncome: C.sum(exp.map(x => x.amount)), expectedList: exp };
}
// ¿En quién gasto más? Gasto personal del mes repartido entre las personas etiquetadas.
function spendByPerson(key) {
  const out = {};
  for (const t of S.transactions) {
    if (!C.isActive(t) || t.type !== 'expense' || !t.people?.length) continue;
    const amt = C.expenseInMonth(t, key, S.settings.budgetMode);
    if (!amt) continue;
    for (const a of C.attributeToPeople(amt, t.people)) { const o = out[a.id] = out[a.id] || { amount: 0, count: 0 }; o.amount += a.amount; o.count++; }
  }
  return Object.entries(out).map(([id, o]) => ({ id, ...o })).sort((a, b) => b.amount - a.amount);
}
function budgetCtx(key) {
  const st = monthStats(key), t = today();
  const [y, m] = key.split('-').map(Number);
  return { expectedIncome: st.expectedIncome, receivedIncome: st.income, isCurrent: key === C.monthKey(t), dayOfMonth: C.parts(t).d, daysInMonth: C.daysInMonth(y, m) };
}
function budgetConsumed(b, key) {
  let c = 0;
  for (const t of S.transactions) if (C.isActive(t) && t.type === 'expense' && C.txMatchesScope(t, b)) c += C.expenseInMonth(t, key, S.settings.budgetMode);
  return c;
}
function budgetsFor(key) {
  const ctx = budgetCtx(key);
  return S.budgets.filter(b => !b.archived).map(b => ({ b, r: C.budgetStatus(b, budgetConsumed(b, key), ctx, S.settings.warnPct), prev: budgetConsumed(b, C.addMonthsKey(key, -1)) }));
}
function allReceivables() { return S.transactions.flatMap(t => C.receivableParts(t)); }
function expectedStatus(x) { return x.status === 'expected' && x.due < today() ? 'late' : x.status; }
const EXP_LABEL = { expected: 'Esperado', partial: 'Parcial', received: 'Recibido', late: 'Atrasado', skipped: 'Omitido', cancelled: 'Cancelado', paid: 'Pagado' };
const EXP_PILL = { expected: 'info', partial: 'warn', received: 'ok', paid: 'ok', late: 'bad', skipped: '', cancelled: '' };
const LOAN_LABEL = { draft: 'Borrador', active: 'Activo', partial: 'Parcialmente pagado', overdue: 'Vencido', paid: 'Pagado', forgiven: 'Condonado', cancelled: 'Cancelado' };
const LOAN_PILL = { active: 'info', partial: 'warn', overdue: 'bad', paid: 'ok', forgiven: '', cancelled: '', draft: '' };
const BUDGET_LABEL = { ok: 'En control', near: 'Cerca del límite', over: 'Excedido', nodata: 'Sin datos' };
const BUDGET_PILL = { ok: 'ok', near: 'warn', over: 'bad', nodata: '' };

// Genera ingresos/pagos esperados a partir de reglas recurrentes. Nunca los marca como recibidos.
function ensureExpected() {
  const t = today(), [ny, nm] = C.addMonthsKey(C.monthKey(t), 1).split('-').map(Number), to = C.iso(ny, nm, C.daysInMonth(ny, nm));
  const from = C.addDays(t, -62);
  let added = 0;
  for (const r of S.rules) {
    if (!r.active) continue;
    for (const o of C.occurrences(r, from, to, S.settings.holidayEx)) {
      if (S.expected.some(x => x.ruleId === r.id && x.nominal === o.nominal)) continue;
      S.expected.push({ id: uid(), ruleId: r.id, kind: r.kind, name: r.name, nominal: o.nominal, due: o.due, amount: r.amount, accountId: r.accountId, categoryId: r.categoryId, subcategoryId: r.subcategoryId || null, payer: r.payer || '', status: 'expected', receivedAmount: null, txId: null });
      added++;
    }
  }
  if (added) save();
}

/* ---------- Alertas basadas en reglas (sin IA, auditables) ---------- */
function insights() {
  const out = [], t = today(), key = C.monthKey(t);
  for (const { b, r } of budgetsFor(key)) {
    if (r.state === 'over') out.push({ level: 'danger', icon: 'alert', title: `${b.name} superó el presupuesto en ${C.formatMoney(r.exceeded)}`, data: `Consumido ${C.formatMoney(r.consumed)} de ${C.formatMoney(r.amount)}`, period: C.monthLabel(key), rule: 'Consumo > 100 % del presupuesto', action: ['Ver presupuestos', 'go', 'presupuestos'] });
    else if (r.state === 'near') out.push({ level: 'warn', icon: 'pie', title: `${b.name} alcanzó el ${Math.round(r.pct)} % del presupuesto`, data: `Disponible ${C.formatMoney(r.available)}; ritmo sugerido ${C.formatMoney(r.dailyPace || 0)}/día`, period: C.monthLabel(key), rule: `Consumo ≥ ${S.settings.warnPct} % (umbral configurable)`, action: ['Ver presupuestos', 'go', 'presupuestos'] });
  }
  // Comparación justa: mismo número de días del mes anterior.
  const day = C.parts(t).d, prevKey = C.addMonthsKey(key, -1);
  const upTo = (k) => { const res = {}; const [y, m] = k.split('-').map(Number); const lim = C.iso(y, m, Math.min(day, C.daysInMonth(y, m)));
    for (const x of S.transactions) if (C.isActive(x) && x.type === 'expense' && C.monthKey(x.date) === k && x.date <= lim) res[x.categoryId] = (res[x.categoryId] || 0) + C.personalAmount(x); return res; };
  const cur = upTo(key), prev = upTo(prevKey);
  for (const cid of Object.keys(cur)) {
    if (cur[cid] < 50000 || !prev[cid]) continue;
    const g = (cur[cid] - prev[cid]) / prev[cid] * 100;
    if (g >= 15) out.push({ level: 'info', icon: 'info', title: `${catById(cid)?.name || 'Sin categoría'}: +${Math.round(g)} % frente al mes anterior`, data: `${C.formatMoney(cur[cid])} vs ${C.formatMoney(prev[cid])} en los primeros ${day} días`, period: `${C.monthLabel(key)} vs ${C.monthLabel(prevKey)}`, rule: 'Aumento ≥ 15 % y gasto ≥ $50.000 en el mismo tramo de días', action: ['Ver movimientos', 'filterCat', cid] });
  }
  const pendingExp = S.expected.filter(x => x.kind === 'income' && x.status === 'expected' && x.due <= t);
  if (pendingExp.length) out.push({ level: 'warn', icon: 'cal', title: pendingExp.length === 1 ? 'Tienes un ingreso esperado sin confirmar' : `Tienes ${pendingExp.length} ingresos esperados sin confirmar`, data: pendingExp.slice(0, 3).map(x => `${x.name} (${fdShort(x.due)})`).join(', '), period: 'Hasta hoy', rule: 'Ingreso esperado con fecha ≤ hoy y no confirmado', action: ['Revisar', 'go', 'recurrentes'] });
  const pendingPay = S.expected.filter(x => x.kind === 'expense' && x.status === 'expected' && x.due <= C.addDays(t, 3));
  if (pendingPay.length) out.push({ level: 'info', icon: 'repeat', title: `${pendingPay.length} pago(s) recurrente(s) próximos o vencidos`, data: pendingPay.slice(0, 3).map(x => `${x.name} (${relDay(x.due)})`).join(', '), period: 'Próximos 3 días', rule: 'Pago recurrente con fecha ≤ hoy + 3 días', action: ['Revisar', 'go', 'recurrentes'] });
  for (const l of S.loans) {
    const s = C.loanSummary(l, t);
    if (s.status === 'overdue') out.push({ level: 'danger', icon: 'hand', title: `Préstamo ${l.direction === 'given' ? 'a' : 'de'} ${personName(l.personId)} con ${s.daysLate} días de atraso`, data: `Cuota del ${fdShort(s.next.due)}; saldo ${C.formatMoney(s.balance)}`, period: 'Hoy', rule: 'Cuota con fecha anterior a hoy no cubierta por los abonos', action: ['Ver préstamo', 'loanDetail', l.id] });
  }
  const rec = allReceivables().filter(r => C.diffDays(txById(r.txId).date, t) >= 7);
  if (rec.length) out.push({ level: 'info', icon: 'users', title: `Te deben ${C.formatMoney(C.sum(rec.map(r => r.pending)))} de gastos compartidos`, data: `${rec.length} parte(s) pendientes con más de 7 días`, period: 'Acumulado', rule: 'Partes no cobradas con antigüedad ≥ 7 días', action: ['Ver', 'go', 'prestamos'] });
  const pend = S.transactions.filter(x => !x.deletedAt && x.status === 'pending');
  if (pend.length) out.push({ level: 'warn', icon: 'list', title: pend.length === 1 ? 'Tienes un movimiento pendiente de revisión' : `Tienes ${pend.length} movimientos pendientes de revisión`, data: 'Creados por atajo, texto pegado o importación', period: 'Acumulado', rule: 'Estado = pendiente de revisión', action: ['Revisar', 'filterPending', ''] });
  if (S.transactions.length >= 5 && !S.demo) {
    const last = S.settings.lastBackupAt ? Date.parse(S.settings.lastBackupAt) : 0;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (days === null || days >= 7) out.push({ level: 'warn', icon: 'shield', title: days === null ? 'Aún no tienes una copia de seguridad' : `Tu última copia tiene ${days} días`, data: 'Tus datos viven solo en este dispositivo', period: 'Hoy', rule: 'Sin copia cifrada en los últimos 7 días', action: ['Crear copia', 'backupSheet', ''] });
  }
  return out;
}
function insightHTML(x) {
  return `<div class="insight ${x.level}"><span class="dot">${ic(x.icon, 'sm')}</span><div class="grow" style="flex:1;min-width:0">
    <div style="font-weight:650">${esc(x.title)}</div>
    <details><summary>Por qué veo esto</summary><dl><dt>Dato</dt><dd>${esc(x.data)}</dd><dt>Periodo</dt><dd>${esc(x.period)}</dd><dt>Regla</dt><dd>${esc(x.rule)}</dd></dl></details>
    ${x.action ? `<button class="link-btn" style="padding-left:0" data-act="${x.action[1]}" data-v="${esc(x.action[2])}">${esc(x.action[0])} →</button>` : ''}</div></div>`;
}

/* ---------- Gráficos SVG livianos ---------- */
function pctChange(a, b) { if (!b) return null; return Math.round((a - b) / b * 100); }
function changeText(p) { if (p === null) return '<span class="muted">sin datos</span>'; return `<span class="${p > 0 ? 'neg' : 'pos'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)} %</span>`; }

/* ---------- Vistas ---------- */
function monthSwitcher(key, act) {
  return `<div class="month-sw"><button class="icon-btn" data-act="${act}" data-v="-1" aria-label="Mes anterior">${ic('left')}</button><strong>${esc(C.monthLabel(key))}</strong><button class="icon-btn" data-act="${act}" data-v="1" aria-label="Mes siguiente">${ic('right')}</button></div>`;
}
function vInicio() {
  if (!S.accounts.length && !S.transactions.length) {
    return `<div class="card">${emptyState('wallet', 'Bienvenido a WalletWeb', 'Registra tu primer gasto o ingreso con el botón +. Tus datos se guardan solo en este dispositivo.',
      `<div class="btn-row" style="max-width:360px;margin:0 auto"><button class="btn primary" data-act="newTx">Registrar movimiento</button></div>
       <p class="small" style="margin-top:16px">¿Solo quieres explorar? <button class="link-btn" data-act="loadDemo">Cargar datos de demostración</button></p>`)}</div>`;
  }
  const key = ui.month, st = monthStats(key), t = today(), isCur = key === C.monthKey(t);
  const available = st.income - st.expense;
  const bud = budgetsFor(key).sort((a, b) => b.r.pct - a.r.pct);
  const global = bud.find(x => x.b.scope === 'global');
  const recv = allReceivables(), recvTotal = C.sum(recv.map(r => r.pending));
  const ins = insights();
  const recent = S.transactions.filter(x => !x.deletedAt).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 5);
  const pend = S.transactions.filter(x => !x.deletedAt && (x.status === 'pending' || x.status === 'draft'));
  const wp = C.wishPlan(S.wishFund, S.wishes, t);
  const prev = monthStats(C.addMonthsKey(key, -1)), yoy = monthStats(C.addMonthsKey(key, -12));
  const ctx = budgetCtx(key);
  const projection = isCur && ctx.dayOfMonth ? Math.round(st.expense / ctx.dayOfMonth * ctx.daysInMonth) : st.expense;
  const commit = S.transactions.filter(x => C.isActive(x) && x.installments?.n > 1).map(x => C.installmentStatus(x, C.monthKey(t))).filter(Boolean);
  const commitTotal = C.sum(commit.map(c => c.pendingAmount));
  const upcoming = [];
  for (const l of S.loans) { const s = C.loanSummary(l, t); if (s.next && s.balance > 0 && !l.statusOverride && C.diffDays(t, s.next.due) <= 14) upcoming.push({ date: s.next.due, label: (l.direction === 'given' ? 'Te paga ' : 'Pagas a ') + personName(l.personId), amount: s.next.amount }); }
  for (const x of S.expected) if (x.kind === 'expense' && x.status === 'expected' && C.diffDays(t, x.due) <= 14 && C.diffDays(t, x.due) >= -7) upcoming.push({ date: x.due, label: x.name, amount: x.amount });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const receipts = S.transactions.filter(x => !x.deletedAt && x.receipt && x.receipt.driveStatus === 'pending').length;

  const left = `
    ${monthSwitcher(key, 'month')}
    <section class="card hero" aria-label="Disponible del mes">
      <div class="label">Disponible del mes</div>
      <div class="big">${money(available)}</div>
      <div class="row"><span>Recibido<b>${money(st.income)}</b></span><span>Gasto personal<b>${money(st.expense)}</b></span>${global ? `<span>Presupuesto restante<b>${money(global.r.available)}</b></span>` : ''}</div>
    </section>
    <div class="grid2">
      <div class="stat"><div class="k">Salida de dinero</div><div class="v">${money(st.outflow)}</div></div>
      <div class="stat"><div class="k">Por cobrar</div><div class="v">${money(recvTotal + C.sum(S.loans.filter(l => l.direction === 'given' && !l.statusOverride).map(l => C.loanSummary(l, t).balance)))}</div></div>
    </div>
    ${sectionH('Presupuestos', 'go', 'Ver todos').replace('data-act="go"', 'data-act="go" data-v="presupuestos"')}
    <div class="card">${bud.length ? bud.slice(0, 3).map(x => budgetHTML(x, true)).join('') : `<div class="empty" style="padding:14px"><p>Crea un presupuesto para ver tu ritmo de gasto.</p><button class="btn" data-act="budgetForm">Crear presupuesto</button></div>`}</div>
    ${sectionH('Ingresos del mes', 'go', 'Recurrentes').replace('data-act="go"', 'data-act="go" data-v="recurrentes"')}
    <div class="card">${st.expectedList.length ? `
      <div class="budget top" style="border:0;padding:0 0 10px"><div class="top"><span class="muted small">Recibido vs esperado</span><span class="small"><b>${money(st.income)}</b> / ${money(st.expectedIncome)}</span></div>${progress(st.expectedIncome ? st.income / st.expectedIncome * 100 : 0)}</div>
      ${st.expectedList.sort((a, b) => a.due.localeCompare(b.due)).map(expectedRow).join('')}` : `<p class="muted small" style="margin:0">Sin ingresos esperados. <button class="link-btn" data-act="ruleForm" data-v="salary">Configurar salario 15 y 30</button></p>`}</div>
    ${homeLoansSection()}
    ${ins.length ? sectionH('Alertas', 'go', 'Ver todas').replace('data-act="go"', 'data-act="go" data-v="alertas"') + `<div class="list">${ins.slice(0, 3).map(insightHTML).join('')}</div>` : ''}
    ${pend.length || receipts ? `${sectionH('Acciones pendientes')}<div class="list">
      ${pend.length ? `<button class="row-item" data-act="filterPending"><span class="ico">${ic('edit')}</span><span class="grow"><span class="t">${pend.length} movimiento(s) por revisar</span><span class="s">Borradores y pendientes de revisión</span></span>${ic('right')}</button>` : ''}
    </div>` : ''}`;
  const right = `
    ${sectionH('Recientes', 'go', 'Ver todos').replace('data-act="go"', 'data-act="go" data-v="movimientos"')}
    <div class="list">${recent.length ? recent.map(txRow).join('') : '<p class="muted small" style="padding:14px;margin:0">Aún no hay movimientos.</p>'}</div>
    ${sectionH('Quiero comprar', 'go', 'Ver lista').replace('data-act="go"', 'data-act="go" data-v="metas"')}
    <div class="card">${wp.total || wp.monthly ? `<div class="wish-mini"><div><div class="muted tiny">En el fondo</div><b>${money(wp.available)}</b></div><div><div class="muted tiny">A ${esc(C.monthLabel(wp.horizonKey).toLowerCase())}</div><b>${money(wp.projection)}</b></div><div><div class="muted tiny">Te alcanza para</div><b>${wp.fitCount} de ${wp.total}</b></div></div>
      ${wp.items.slice(0, 3).map(x => wishRow(x, wp, true)).join('')}` : `<p class="muted small" style="margin:0">Asigna un presupuesto mensual a lo que quieres comprar y mira para qué te alcanza. <button class="link-btn" data-act="go" data-v="metas">Empezar</button></p>`}</div>
    ${sectionH('Análisis financiero')}
    ${chartCard('trend', CH_EXTRA.trend = `<div class="ch-compare grid2">
        <div><div class="ch-k">Gasto vs mes anterior</div><div class="ch-cv">${changeText(pctChange(st.expense, prev.expense))}</div></div>
        <div><div class="ch-k">Vs mismo mes del año anterior</div><div class="ch-cv">${changeText(pctChange(st.expense, yoy.expense))}</div></div>
        ${isCur ? `<div><div class="ch-k">Proyección de cierre</div><div class="ch-cv chart-sensitive">${money(projection)}</div></div>` : ''}
        <div><div class="ch-k">Salida total de dinero</div><div class="ch-cv chart-sensitive">${money(st.outflow)}</div></div>
      </div>`)}
    ${chartCard('cats')}
    ${S.people.length ? chartCard('people') : ''}
    ${commit.length ? `${sectionH('Compras a cuotas')}<div class="card"><div class="grid2"><div><div class="muted tiny">Compromiso pendiente</div><div style="font-weight:700">${money(commitTotal)}</div></div><div><div class="muted tiny">Flujo de cuotas este mes</div><div style="font-weight:700">${money(C.sum(S.transactions.filter(x => C.isActive(x) && x.installments?.n > 1).map(x => C.expenseInMonth(x, key, 'installment'))))}</div></div></div><p class="hint">Los presupuestos usan: <b>${S.settings.budgetMode === 'installment' ? 'cada cuota en su mes' : 'el total en la fecha de compra'}</b>. Puedes cambiarlo en Ajustes.</p></div>` : ''}
    ${upcoming.length ? `${sectionH('Próximos pagos')}<div class="list">${upcoming.slice(0, 6).map(u => `<div class="row-item"><span class="ico">${ic('cal')}</span><span class="grow"><span class="t">${esc(u.label)}</span><span class="s">${esc(relDay(u.date))}</span></span><span class="r">${money(u.amount)}</span></div>`).join('')}</div>` : ''}`;
  return `<div class="home-grid"><div>${left}</div><div>${right}</div></div>${myChartsSection()}`;
}
function expectedRow(x) {
  const s = expectedStatus(x);
  const canAct = s === 'expected' || s === 'late' || s === 'partial';
  return `<button class="row-item" style="padding-left:0;padding-right:0" data-act="expectedAct" data-id="${x.id}" ${canAct ? '' : 'disabled'}><span class="ico">${ic(x.kind === 'income' ? 'briefcase' : 'repeat')}</span>
    <span class="grow"><span class="t">${esc(x.name)}</span><span class="s">${esc(relDay(x.due))}${x.due !== x.nominal ? ' · movido del ' + esc(fdShort(x.nominal)) : ''}${canAct ? ' · toca para confirmar' : ''}</span></span>
    <span class="r">${money(x.receivedAmount ?? x.amount)}<br><span class="pill ${EXP_PILL[s]}">${EXP_LABEL[s]}</span></span></button>`;
}
function budgetHTML({ b, r, prev }, compact) {
  const name = esc(b.name);
  return `<div class="budget"><div class="top"><button class="link-btn" style="color:var(--ink);padding:0;min-height:0;font-weight:700" data-act="budgetForm" data-id="${b.id}">${name}</button><span class="pill ${BUDGET_PILL[r.state]}">${BUDGET_LABEL[r.state]}</span></div>
    ${progress(r.pct, r.state === 'ok' ? '' : r.state)}
    <div class="meta"><span>${money(r.consumed)} de ${money(r.amount)} · ${Math.round(r.pct)} %</span><span>${r.available >= 0 ? 'Disponible ' + money(r.available) : '<span class="neg">Excedido ' + money(r.exceeded) + '</span>'}</span></div>
    ${!compact ? `<div class="meta">${r.dailyPace !== undefined ? `<span>Ritmo sugerido: ${money(r.dailyPace)}/día</span><span>Proyección: ${money(r.projection)}</span>` : ''}<span>Mes anterior: ${money(prev)}</span></div>` : ''}</div>`;
}
function wishRow(x, p, compact) {
  const w = x.w, st = wishStatusText(x, p), ct = condText(w);
  return `<div class="wish-row ${x.fits ? '' : 'out'}"><button class="wish-main" data-act="wishDetail" data-id="${w.id}">
      <span class="wish-pri p${w.priority || 2}" aria-label="Prioridad ${PRI[(w.priority || 2) - 1][1]}"></span>
      <span class="grow"><span class="t">${esc(w.name)}</span><span class="s">${esc(st.t)}${!compact && ct ? ' · ' + esc(ct) : ''}</span></span>
      <span class="r">${money(w.price)}</span></button>
    ${compact ? '' : `<span class="wish-mv"><button class="icon-btn" data-act="wishMove" data-id="${w.id}" data-v="-1" aria-label="Subir">${ic('up', 'sm')}</button><button class="icon-btn" data-act="wishMove" data-id="${w.id}" data-v="1" aria-label="Bajar">${ic('down', 'sm')}</button></span>`}</div>`;
}

function movFilterFn() {
  const q = ui.movQ.trim().toLowerCase(), t = today();
  let from = null, to = null;
  if (ui.movPeriod === 'month') { from = ui.month + '-01'; to = ui.month + '-31'; }
  else if (ui.movPeriod === 'week') { from = C.addDays(t, -((C.dow(t) + 6) % 7)); to = C.addDays(from, 6); }
  else if (ui.movPeriod === 'year') { from = ui.month.slice(0, 4) + '-01-01'; to = ui.month.slice(0, 4) + '-12-31'; }
  else if (ui.movPeriod === 'custom') { from = ui.movFrom || null; to = ui.movTo || null; }
  return x => {
    if (x.deletedAt) return false;
    if (ui.movType === 'pending' && x.status === 'confirmed') return false;
    if (ui.movType === 'expense' && x.type !== 'expense') return false;
    if (ui.movType === 'income' && x.type !== 'income') return false;
    if (ui.movType === 'other' && (x.type === 'expense' || x.type === 'income')) return false;
    if (from && x.date < from) return false; if (to && x.date > to) return false;
    if (ui.movPerson && !(x.people || []).includes(ui.movPerson) && !(x.split?.parts || []).some(p => p.personId === ui.movPerson) && x.personId !== ui.movPerson) return false;
    if (ui.movAccount && x.accountId !== ui.movAccount && x.toAccountId !== ui.movAccount) return false;
    if (ui.movCategory) { if (ui.movCategory.startsWith('sub:')) { if (x.subcategoryId !== ui.movCategory.slice(4)) return false; } else if (x.categoryId !== ui.movCategory) return false; }
    if (q) {
      const hay = [x.merchant, x.note, x.reference, subName(x), ...(x.people || []).map(personName), catById(x.categoryId)?.name, accById(x.accountId)?.name, ...(x.tags || []), ...(x.split?.parts || []).map(p => personName(p.personId)), x.personId ? personName(x.personId) : '', String(x.amount)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
}
function vMovimientos() {
  const list = S.transactions.filter(movFilterFn()).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const inflow = C.sum(list.filter(x => x.status === 'confirmed' && INFLOW.has(x.type)).map(x => x.amount));
  const outflow = C.sum(list.filter(x => x.status === 'confirmed' && ['expense', 'loan_out', 'repay_out'].includes(x.type)).map(x => x.amount));
  const shown = list.slice(0, ui.movLimit);
  const groups = [];
  for (const x of shown) { const g = groups[groups.length - 1]; if (g && g.date === x.date) g.items.push(x); else groups.push({ date: x.date, items: [x] }); }
  return `
    <div class="mov-top"><div class="searchbar">${ic('search', 'sm')}<input type="search" id="movQ" placeholder="Buscar comercio, nota, persona…" value="${esc(ui.movQ)}" aria-label="Buscar movimientos" enterkeyhint="search"></div>
      <button class="mov-fbtn mglass" data-act="movFilters" aria-label="Filtros${movActiveFilters().length ? ' (' + movActiveFilters().length + ' activos)' : ''}">${ic('sliders')}${movActiveFilters().length ? `<span class="badge">${movActiveFilters().length}</span>` : ''}</button></div>
    <div class="mov-chips" role="group" aria-label="Tipo y filtros">${movActiveFilters().map(([k, l, i]) => `<button class="mchip on" data-act="movClear" data-k="${k}" aria-label="Quitar filtro ${esc(l)}">${ic(i, 'sm')}${esc(l)}${ic('x', 'sm')}</button>`).join('')}
      ${[['all', 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['other', 'Otros'], ['pending', 'Revisar']].map(([v, l]) => `<button class="mchip" data-act="movType" data-v="${v}" aria-pressed="${ui.movType === v}">${l}</button>`).join('')}</div>
    <div class="mov-bar mglass">
      ${ui.movPeriod === 'month' || ui.movPeriod === 'year' ? `<button class="mb-nav" data-act="month" data-v="${ui.movPeriod === 'year' ? -12 : -1}" aria-label="Anterior">${ic('left', 'sm')}</button><b class="mb-label">${esc(ui.movPeriod === 'year' ? ui.month.slice(0, 4) : C.monthLabel(ui.month))}</b><button class="mb-nav" data-act="month" data-v="${ui.movPeriod === 'year' ? 12 : 1}" aria-label="Siguiente">${ic('right', 'sm')}</button>` : `<b class="mb-label" style="padding-left:12px">${esc(movActiveFilters().find(x => x[0] === 'movPeriod')?.[1] || '')}</b>`}
      <span class="mb-tot"><span class="pos">+${esc(moneyShort(inflow).replace(C.CUR.symbol + ' ', C.CUR.symbol))}</span><span>−${esc(moneyShort(outflow).replace(C.CUR.symbol + ' ', C.CUR.symbol))}</span></span></div>
    ${groups.length ? groups.map(g => {
      const day = C.sum(g.items.filter(x => x.status === 'confirmed').map(x => INFLOW.has(x.type) ? x.amount : (x.type === 'transfer' ? 0 : -x.amount)));
      return `<div class="day-h"><span>${esc(relDay(g.date) === 'Hoy' || relDay(g.date) === 'Ayer' ? relDay(g.date) + ', ' + fdShort(g.date) : fdLong(g.date))}</span><span class="amt">${esc(C.formatMoney(day))}</span></div><div class="list">${g.items.map(txRow).join('')}</div>`;
    }).join('') : `<div class="card">${emptyState('receipt', 'Sin movimientos', 'No hay movimientos con estos filtros.', '<button class="btn primary" data-act="newTx">Registrar movimiento</button>')}</div>`}
    ${list.length > shown.length ? `<button class="btn block" data-act="moreMovs">Mostrar más (${list.length - shown.length})</button>` : ''}`;
}
function vCuentas() {
  const list = S.accounts.filter(a => ui.showArchived || !a.archived);
  const count = id => S.transactions.filter(t => !t.deletedAt && (t.accountId === id || t.toAccountId === id)).length;
  return `<p class="hint" style="margin-top:0">Las cuentas solo sirven para marcar con qué pagaste o dónde recibiste cada movimiento. No se calculan saldos.</p>
    <div class="list">${list.length ? list.map(a => `<button class="row-item" data-act="accountEdit" data-id="${a.id}"><span class="ico">${ic(ACC_ICONS[a.type] || 'card')}</span>
      <span class="grow"><span class="t">${esc(a.name)} ${a.archived ? '<span class="pill">Archivada</span>' : ''}</span><span class="s">${count(a.id)} movimiento(s)</span></span>${ic('right', 'sm')}</button>`).join('') : '<p class="muted small" style="padding:14px;margin:0">Aún no hay cuentas. Créalas desde el formulario de movimiento.</p>'}</div>
    <div class="btn-row"><button class="btn primary" data-act="accountForm">${ic('plus', 'sm')} Nueva cuenta</button>${S.accounts.some(a => a.archived) ? `<button class="btn" data-act="toggleArchived">${ui.showArchived ? 'Ocultar archivadas' : 'Ver archivadas'}</button>` : ''}</div>`;
}
function vPrestamos() {
  const t = today(), dir = ui.loanTab;
  const loans = S.loans.filter(l => l.direction === dir && !l.deletedAt).map(l => ({ l, s: C.loanSummary(l, t) }))
    .sort((a, b) => ({ overdue: 0, partial: 1, active: 2, draft: 3, paid: 4, forgiven: 5, cancelled: 6 }[a.s.status] - { overdue: 0, partial: 1, active: 2, draft: 3, paid: 4, forgiven: 5, cancelled: 6 }[b.s.status]));
  const open = loans.filter(x => !['paid', 'forgiven', 'cancelled'].includes(x.s.status));
  const total = C.sum(open.map(x => x.s.balance));
  const rec = dir === 'given' ? allReceivables() : [];
  const byPerson = {};
  for (const r of rec) (byPerson[r.personId] = byPerson[r.personId] || []).push(r);
  return `${seg('Dirección', [['given', 'Me deben'], ['received', 'Debo']], dir, 'loanTab')}
    ${dir === 'given' ? `<div style="margin-top:14px">${lendExpensesCard()}</div>` : ''}
    <section class="card hero" style="margin-top:14px"><div class="label">${dir === 'given' ? 'Pendiente por cobrar' : 'Pendiente por pagar'}</div><div class="big">${money(total + C.sum(rec.map(r => r.pending)))}</div>
      <div class="row"><span>Préstamos<b>${money(total)}</b></span>${dir === 'given' ? `<span>Gastos compartidos<b>${money(C.sum(rec.map(r => r.pending)))}</b></span>` : ''}<span>Vencidos<b>${open.filter(x => x.s.status === 'overdue').length}</b></span></div></section>
    ${sectionH('Préstamos')}
    ${loans.length ? `<div class="list">${loans.map(({ l, s }) => `<button class="row-item" data-act="loanDetail" data-id="${l.id}" style="flex-wrap:wrap">
      <span class="ico">${ic('hand')}</span><span class="grow"><span class="t">${esc(personName(l.personId))}</span><span class="s">${s.next && s.balance ? 'Próxima: ' + esc(fdShort(s.next.due)) + (s.daysLate ? ` · ${s.daysLate} días de atraso` : '') : esc(l.note || '')}</span></span>
      <span class="r">${money(s.balance)}<br><span class="pill ${LOAN_PILL[s.status]}">${LOAN_LABEL[s.status]}</span></span>
      <span style="flex-basis:100%;padding-left:52px">${progress(s.total ? s.paid / s.total * 100 : 0, s.status === 'overdue' ? 'over' : '')}</span></button>`).join('')}</div>`
      : `<div class="card">${emptyState('hand', dir === 'given' ? 'Nadie te debe' : 'No tienes deudas registradas', 'Registra préstamos con o sin interés y sus abonos parciales.', '')}</div>`}
    <button class="btn primary block" data-act="loanForm" data-v="${dir}">${ic('plus', 'sm')} ${dir === 'given' ? 'Registrar dinero prestado' : 'Registrar dinero que debo'}</button>
    ${dir === 'given' && rec.length ? `${sectionH('Por cobrar de gastos compartidos')}<div class="list">${Object.entries(byPerson).map(([pid, rs]) => `<button class="row-item" data-act="receivablePerson" data-id="${esc(pid)}"><span class="ico">${ic('user')}</span><span class="grow"><span class="t">${esc(personName(pid))}</span><span class="s">${rs.length} gasto(s) compartido(s)</span></span><span class="r">${money(C.sum(rs.map(r => r.pending)))}</span></button>`).join('')}</div>` : ''}`;
}
function settingsRow(icon, label, value, act, v) { return `<button class="row-item" data-act="${act}" ${v ? `data-v="${esc(v)}"` : ''}><span class="ico">${ic(icon, 'sm')}</span><span class="grow"><span class="t">${esc(label)}</span>${value ? `<span class="s">${value}</span>` : ''}</span>${ic('right', 'sm')}</button>`; }
function vAjustes() {
  const st = S.settings;
  const lastB = st.lastBackupAt ? 'Última: ' + esc(fdt(st.lastBackupAt)) : '<span class="warn">Nunca</span>';
  return `
    ${sectionH('Perfil')}<div class="list">${settingsRow('users', 'Perfiles', esc(PROFILE.name) + ' · ' + esc(PROFILE.currency) + ' · ' + PROFILES.list.length + ' perfiles', 'profiles')}</div>
    ${sectionH('Planificación')}<div class="list">
      ${settingsRow('pie', 'Presupuestos', S.budgets.length + ' activos', 'go', 'presupuestos')}
      ${settingsRow('hand', 'Préstamos', S.loans.length + ' registrados', 'go', 'prestamos')}
      ${settingsRow('target', 'Quiero comprar', S.wishes.filter(w => w.status === 'active').length + ' deseos', 'go', 'metas')}
      ${settingsRow('repeat', 'Ingresos y pagos recurrentes', S.rules.filter(r => r.active).length + ' reglas', 'go', 'recurrentes')}
      ${settingsRow('bell', 'Centro de alertas', '', 'go', 'alertas')}</div>
    ${sectionH('Datos')}<div class="list">
      ${settingsRow('card', 'Cuentas', activeAccounts().length + ' para marcar movimientos', 'go', 'cuentas')}
      ${settingsRow('tag', 'Categorías y subcategorías', cats('expense').length + cats('income').length + ' categorías', 'go', 'categorias')}
      ${settingsRow('palette', 'Colores de categorías', 'Familia y tono de cada categoría y subcategoría', 'catColors')}
      ${settingsRow('users', 'Personas', S.people.filter(p => !p.archived).length + ' personas', 'go', 'personas')}
      ${settingsRow('cal', 'Festivos de Colombia', 'Excepciones manuales: ' + (st.holidayEx.extraHolidays.length + st.holidayEx.workdays.length), 'go', 'festivos')}
      ${settingsRow('trash', 'Papelera', S.transactions.filter(t => t.deletedAt).length + ' elementos · 30 días', 'go', 'papelera')}</div>
    ${sectionH('Seguridad y privacidad')}<div class="list">
      ${settingsRow('lock', 'Bloqueo y desbloqueo', (st.pin ? 'PIN activo' : '<span class="warn">Sin PIN</span>') + (st.passkey ? ' · desbloqueo del dispositivo' : '') + ' · ' + st.lockMinutes + ' min', 'securitySheet')}
      ${settingsRow('history', 'Auditoría', S.audit.length + ' eventos (1 año)', 'go', 'auditoria')}
      ${settingsRow('shield', 'Política de privacidad', 'Qué guarda la app y dónde', 'go', 'privacidad')}</div>
    ${sectionH('Copias y portabilidad')}<div class="list">
      ${settingsRow('shield', 'Copia de seguridad cifrada', lastB, 'backupSheet')}
      ${settingsRow('upload', 'Restaurar copia', 'Requiere desbloqueo', 'restoreSheet')}
      ${settingsRow('download', 'Exportar movimientos (CSV)', 'Abre en Excel o Google Sheets', 'exportCSV')}
      ${settingsRow('doc', 'Importar desde CSV / Excel', 'Guarda tu Excel como CSV', 'importSheet')}</div>
    ${sectionH('Apariencia')}<div class="list" style="margin-bottom:12px">${settingsRow('dots', 'Menú inferior', getTabs().map(k => TAB_OPTIONS[k][0]).join(' · '), 'tabsEdit')}</div>${appearanceCard()}
    ${sectionH('Preferencias')}<div class="card">
      <div class="field"><label for="bm">Compras a cuotas en presupuestos</label><select id="bm" class="input" data-bind="settings.budgetMode">${optionList([['installment', 'Cada cuota en su mes (recomendado)'], ['purchase', 'Todo en la fecha de compra']], st.budgetMode)}</select><p class="hint">El Inicio muestra siempre ambas vistas: compromiso total y flujo mensual.</p></div>
      <div class="field" style="margin:0"><label for="wp">Alerta de presupuesto al</label><select id="wp" class="input" data-bind="settings.warnPct">${optionList([[70, '70 %'], [75, '75 %'], [80, '80 %'], [85, '85 %'], [90, '90 %']].map(([a, b]) => [String(a), b]), String(st.warnPct))}</select></div></div>
    ${sectionH('Zona delicada')}<div class="list">${settingsRow('trash', 'Borrar todos los datos de este dispositivo', 'Requiere desbloqueo y confirmación escrita', 'wipeAll')}</div>
    <p class="muted tiny" style="text-align:center;margin:18px 0">WalletWeb ${APP_VERSION} · datos guardados solo en este dispositivo${Store.ok ? '' : ' · almacenamiento no disponible'}</p>`;
}
function appearanceCard() {
  const st = S.settings, g = Object.assign({}, GLASS_DEFAULT, st.glass || {});
  const range = (k, label, min, max, unit, hint) => `<div class="field"><div class="range-row"><label for="gl-${k}">${label}</label><output id="out-${k}">${g[k]}${unit}</output></div>
    <input type="range" class="range" id="gl-${k}" data-glass="${k}" data-unit="${unit}" min="${min}" max="${max}" step="1" value="${g[k]}" style="--p:${((g[k] - min) / (max - min) * 100).toFixed(1)}%">${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
  const bars = [38, 62, 45, 80, 55, 92, 70, 50, 85, 66].map(h => `<i style="height:${h}%"></i>`).join('');
  return `<div class="card">
    <div class="glass-preview" aria-hidden="true"><div class="bg-text">$ 1.250<br>.000</div><div class="bg-bars">${bars}</div>
      <div class="glass-pill"><span>Disponible</span><span class="amt">$ 1.223.200</span></div></div>
    <p class="hint" style="margin:-4px 4px 14px">Mueve las barras: el vidrio de toda la app cambia en vivo.</p>
    ${range('transparency', 'Transparencia', 0, 100, ' %')}
    ${range('blur', 'Desenfoque', 0, 24, ' px')}
    ${IS_CHROMIUM ? range('refract', 'Refracción de bordes', 0, 100, ' %', 'Deforma lo que hay detrás en los bordes del vidrio. Disponible en Chrome y Android; en iPhone se usa brillo y desenfoque.') : ''}
    <div class="field"><span class="lbl">Fondo</span>${seg('Fondo', [['waves', 'Ondas'], ['lines', 'Líneas'], ['plain', 'Liso'], ['photo', 'Foto']], g.wallpaper, 'setWall')}
      ${g.wallpaper === 'photo' ? `<label class="btn block wall-photo-btn" style="cursor:pointer">${ic('upload', 'sm')} Elegir foto de fondo<input type="file" accept="image/*" data-act-change="wallPick" class="sr-only"></label><p class="hint">La foto se guarda solo en este dispositivo.</p>` : ''}</div>
    <div class="field"><span class="lbl">Tema</span>${seg('Tema', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], st.theme, 'setTheme')}</div>
    <button class="btn block" data-act="glassReset">Restablecer apariencia</button></div>`;
}
function vPresupuestos() {
  const key = ui.month, list = budgetsFor(key);
  return `${monthSwitcher(key, 'month')}<div class="card">${list.length ? list.map(x => budgetHTML(x, false)).join('') : emptyState('pie', 'Sin presupuestos', 'Define límites globales, por categoría, naturaleza, etiqueta o cuenta. Pueden ser un valor fijo o un % de tus ingresos.', '')}</div>
    <button class="btn primary block" data-act="budgetForm">${ic('plus', 'sm')} Nuevo presupuesto</button>
    <p class="hint">El consumo usa tu gasto personal: en gastos compartidos solo cuenta tu parte (y las partes que marcaste como regalo).</p>`;
}
function vMetas() {
  const p = C.wishPlan(S.wishFund, S.wishes, today()), hz = C.monthLabel(p.horizonKey).toLowerCase();
  const bought = S.wishes.filter(w => w.status === 'bought'), disc = S.wishes.filter(w => w.status === 'discarded');
  const lastFit = p.items.map(x => x.fits).lastIndexOf(true);
  const pct = p.totalCost ? Math.min(100, p.projection / p.totalCost * 100) : 0;
  return `<section class="card hero" aria-label="Fondo para lo que quiero">
      <div class="label">Presupuesto mensual para deseos</div>
      <div class="big">${money(p.monthly)}<span style="font-size:16px;font-weight:600;opacity:.7"> /mes</span></div>
      <div class="row"><span>En el fondo hoy<b>${money(p.available)}</b></span><span>A ${esc(hz)}<b>${money(p.projection)}</b></span><span>Te alcanza para<b>${p.fitCount} de ${p.total}</b></span></div>
      ${p.total ? `<div style="margin-top:12px">${progress(pct)}<div class="meta small" style="display:flex;justify-content:space-between;margin-top:6px;opacity:.85"><span>Todo cuesta ${money(p.totalCost)}</span><span>${p.shortfall ? 'Faltan ' + money(p.shortfall) : 'Te alcanza para todo'}</span></div></div>` : ''}
      <button class="btn" style="margin-top:14px" data-act="wishFundForm">${ic('edit', 'sm')} ${p.monthly ? 'Cambiar presupuesto' : 'Asignar presupuesto mensual'}</button>
    </section>
    ${sectionH('Tu plan hasta ' + hz)}
    ${p.total ? `<div class="card wish-list">${p.items.map((x, i) => wishRow(x, p) + (i === lastFit && i < p.items.length - 1 ? `<div class="wish-cut"><span>Hasta aquí te alcanza a ${esc(hz)}${p.leftover > 0 ? ' · sobran ' + money(p.leftover) : ''}</span></div>` : '')).join('')}
      ${lastFit < 0 ? `<div class="wish-cut first"><span>A ${esc(hz)} todavía no te alcanza para el primero</span></div>` : ''}</div>
      <p class="hint">El orden es por prioridad (alta, media, baja); usa las flechas para ordenar dentro de cada una. Lo que queda debajo de la línea lo puedes esperar o descartar.</p>`
    : `<div class="card">${emptyState('bag', 'Tu lista está vacía', 'Agrega lo que quieres comprar con su precio, el link, por qué comprarlo, por qué no y tus condiciones de compra.', '')}</div>`}
    <div class="btn-row"><button class="btn primary" data-act="wishForm">${ic('plus', 'sm')} Agregar deseo</button>${p.total || bought.length ? `<button class="btn" data-act="wishCsv">${ic('download', 'sm')} Descargar plan</button>` : ''}</div>
    ${bought.length ? sectionH('Comprados') + `<div class="list">${bought.map(w => `<button class="row-item" data-act="wishDetail" data-id="${w.id}"><span class="ico">${ic('check')}</span><span class="grow"><span class="t">${esc(w.name)}</span><span class="s">${w.boughtDate ? esc(fdShort(w.boughtDate)) : 'Comprado'}${w.fromFund === false ? ' · fuera del fondo' : ''}</span></span><span class="r">${money(w.paid || w.price)}</span></button>`).join('')}</div>` : ''}
    ${disc.length ? sectionH('Descartados') + `<div class="list">${disc.map(w => `<button class="row-item" data-act="wishDetail" data-id="${w.id}"><span class="ico">${ic('x')}</span><span class="grow"><span class="t">${esc(w.name)}</span><span class="s">Descartado</span></span><span class="r muted">${money(w.price)}</span></button>`).join('')}</div>` : ''}`;
}
function vRecurrentes() {
  const t = today();
  const exp = S.expected.filter(x => C.diffDays(t, x.due) <= 45 && C.diffDays(t, x.due) >= -62).sort((a, b) => a.due.localeCompare(b.due));
  return `${sectionH('Reglas')}<div class="list">${S.rules.length ? S.rules.map(r => `<button class="row-item" data-act="ruleForm" data-id="${r.id}"><span class="ico">${ic(r.kind === 'income' ? 'briefcase' : 'repeat')}</span><span class="grow"><span class="t">${esc(r.name)} ${r.active ? '' : '<span class="pill">Pausada</span>'}</span><span class="s">${esc(ruleText(r))}</span></span><span class="r">${money(r.amount)}</span></button>`).join('') : '<p class="muted small" style="padding:14px;margin:0">Sin reglas. Crea tu salario para recibir recordatorios.</p>'}</div>
    <div class="btn-row"><button class="btn primary" data-act="ruleForm" data-v="salary">Salario 15 y 30</button><button class="btn" data-act="ruleForm">Otra regla</button></div>
    ${sectionH('Esperados (últimos 2 meses y próximos 45 días)')}
    <div class="card">${exp.length ? exp.map(expectedRow).join('') : '<p class="muted small" style="margin:0">Nada por ahora.</p>'}</div>
    <p class="hint">Los ingresos esperados nunca se marcan como recibidos solos: tú confirmas cada uno y puedes ajustar el valor.</p>`;
}
function ruleText(r) {
  const adj = { prev: 'día hábil anterior', next: 'día hábil siguiente', none: 'sin ajuste' }[r.adjust];
  if (r.freq === 'monthly_days') return 'Días ' + r.days.join(' y ') + ' de cada mes · ' + adj;
  if (r.freq === 'weekly') return 'Semanal desde ' + fdShort(r.startDate) + ' · ' + adj;
  if (r.freq === 'biweekly') return 'Cada 14 días desde ' + fdShort(r.startDate) + ' · ' + adj;
  return 'Fechas específicas (' + (r.dates || []).length + ')';
}
function vCategorias() {
  const block = (kind, title) => `${sectionH(title)}<div class="list">${S.categories.filter(c => c.kind === kind).sort((a, b) => a.order - b.order).map((c, k, arr) => `<div class="row-item">
    <span class="ico" style="--cc:${catColor(c)}">${ic(ICONS[c.icon] ? c.icon : 'tag')}</span>
    <button class="grow" style="border:0;background:none;text-align:left;padding:0;color:inherit" data-act="categoryForm" data-id="${c.id}"><span class="t" style="display:block">${esc(c.name)} ${c.archived ? '<span class="pill">Archivada</span>' : ''}</span><span class="s" style="display:block">${c.subs.length ? esc(c.subs.map(s => s.name).join(', ')) : (c.defaultNature ? 'Naturaleza: ' + esc(NATURES[c.defaultNature]) : '')}</span></button>
    <button class="icon-btn" data-act="catMove" data-id="${c.id}" data-v="-1" aria-label="Subir" ${k === 0 ? 'disabled' : ''}>▲</button><button class="icon-btn" data-act="catMove" data-id="${c.id}" data-v="1" aria-label="Bajar" ${k === arr.length - 1 ? 'disabled' : ''}>▼</button></div>`).join('')}</div>`;
  return block('expense', 'Gastos') + block('income', 'Ingresos') + `<button class="btn primary block" data-act="categoryForm">${ic('plus', 'sm')} Nueva categoría</button><p class="hint">Cambiar un nombre actualiza la presentación sin reescribir tu historial.</p>`;
}
function vPersonas() {
  const t = today(), month = Object.fromEntries(spendByPerson(C.monthKey(t)).map(x => [x.id, x.amount]));
  const total = {};
  for (const x of S.transactions) if (C.isActive(x) && x.type === 'expense' && x.people?.length) for (const a of C.attributeToPeople(C.personalAmount(x), x.people)) total[a.id] = (total[a.id] || 0) + a.amount;
  const people = S.people.filter(p => ui.showArchived || !p.archived).sort((a, b) => (total[b.id] || 0) - (total[a.id] || 0));
  const byGroup = {};
  people.forEach(p => (byGroup[p.group || ''] = byGroup[p.group || ''] || []).push(p));
  const row = p => {
    const rec = C.sum(allReceivables().filter(r => r.personId === p.id).map(r => r.pending));
    const owesMe = C.sum(S.loans.filter(l => l.personId === p.id && l.direction === 'given' && !l.statusOverride).map(l => C.loanSummary(l, t).balance));
    const iOwe = C.sum(S.loans.filter(l => l.personId === p.id && l.direction === 'received' && !l.statusOverride).map(l => C.loanSummary(l, t).balance));
    const sub = [month[p.id] ? 'Este mes ' + C.formatMoney(month[p.id]) : '', rec + owesMe ? 'Te debe ' + C.formatMoney(rec + owesMe) : '', iOwe ? 'Le debes ' + C.formatMoney(iOwe) : ''].filter(Boolean).join(' · ');
    return `<div class="row-item"><span class="ico">${ic('user')}</span><button class="grow" style="border:0;background:none;text-align:left;padding:0;color:inherit" data-act="personForm" data-id="${p.id}"><span class="t">${esc(p.name)}${p.archived ? ' <span class="pill">Archivada</span>' : ''}</span><span class="s amt">${esc(sub || 'Sin gastos registrados')}</span></button>
      <button class="r link-btn" style="text-decoration:none" data-act="filterPerson" data-v="${p.id}" aria-label="Ver movimientos de ${esc(p.name)}"><span class="tiny muted" style="display:block;font-weight:500">Total</span>${money(total[p.id] || 0)}</button></div>`;
  };
  return `<p class="hint" style="margin-top:0">Toca el total para ver sus movimientos. Los grupos permiten marcar a varias personas de un toque.</p>
    ${people.length ? Object.entries(byGroup).sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b)).map(([g, ps]) => `${sectionH(g || 'Sin grupo')}<div class="list">${ps.map(row).join('')}</div>`).join('') : '<div class="card"><p class="muted small" style="margin:0">Aún no hay personas. Créalas desde el formulario de gasto o ingreso con "+ Nueva".</p></div>'}
    <button class="btn primary block" data-act="personForm">${ic('plus', 'sm')} Nueva persona</button>`;
}
function vPapelera() {
  const del = S.transactions.filter(t => t.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return del.length ? `<div class="list">${del.map(t => `<div class="row-item"><span class="ico">${ic(txIcon(t))}</span><span class="grow"><span class="t">${esc(txTitle(t))}</span><span class="s">${esc(fdShort(t.date))} · se borra en ${Math.max(0, 30 - Math.floor((Date.now() - Date.parse(t.deletedAt)) / 86400000))} días</span></span><span class="r">${money(t.amount)}</span><button class="btn" style="min-height:40px;padding:8px 12px" data-act="restoreTx" data-id="${t.id}">Restaurar</button></div>`).join('')}</div>
    <button class="btn danger block" data-act="emptyTrash">Vaciar papelera</button>` : `<div class="card">${emptyState('trash', 'Papelera vacía', 'Los movimientos eliminados se guardan aquí durante 30 días.', '')}</div>`;
}
function vAuditoria() {
  return `<p class="hint" style="margin-top:0">Registro de acciones sensibles durante un año. No incluye PIN, claves ni contenido de copias.</p>
    <div class="list">${S.audit.slice(0, 300).map(a => `<div class="row-item"><span class="ico">${ic('history', 'sm')}</span><span class="grow"><span class="t" style="white-space:normal">${esc(a.detail || a.action)}</span><span class="s">${esc(fdt(a.at))} · ${esc(a.device || '')}</span></span></div>`).join('') || '<p class="muted small" style="padding:14px;margin:0">Sin eventos.</p>'}</div>
    <button class="btn block" data-act="exportAudit">${ic('download', 'sm')} Exportar auditoría (CSV)</button>`;
}
function vAlertas() {
  const ins = insights();
  return `<p class="hint" style="margin-top:0">Alertas calculadas con reglas visibles, sin IA. No son asesoría financiera profesional.</p>
    <div class="list">${ins.length ? ins.map(insightHTML).join('') : `<div class="empty"><div class="e">${ic('check')}</div><h3>Todo en orden</h3><p>No hay alertas por ahora.</p></div>`}</div>
    <div class="card flat small muted">Las notificaciones push requieren un servidor (fase siguiente). Por ahora las alertas aparecen aquí y en el Inicio cada vez que abres la app.</div>`;
}
function vFestivos() {
  const y = Number(ui.month.slice(0, 4)), H = C.holidaysCO(y), ex = S.settings.holidayEx;
  return `<div class="month-sw"><button class="icon-btn" data-act="month" data-v="-12" aria-label="Año anterior">${ic('left')}</button><strong>Festivos ${y}</strong><button class="icon-btn" data-act="month" data-v="12" aria-label="Año siguiente">${ic('right')}</button></div>
    <div class="list">${Object.entries(H).sort().map(([d, n]) => `<div class="row-item"><span class="ico">${ic('cal')}</span><span class="grow"><span class="t">${esc(n)}</span><span class="s">${esc(fdLong(d))}</span></span>${ex.workdays.includes(d) ? '<span class="pill warn">Laboral (manual)</span>' : ''}<button class="link-btn" data-act="toggleWorkday" data-v="${d}">${ex.workdays.includes(d) ? 'Restablecer' : 'Marcar laboral'}</button></div>`).join('')}</div>
    ${sectionH('Festivos manuales')}<div class="list">${ex.extraHolidays.map(h => `<div class="row-item"><span class="ico">${ic('plus')}</span><span class="grow"><span class="t">${esc(h.name)}</span><span class="s">${esc(fdLong(h.date))}</span></span><button class="link-btn" data-act="removeHoliday" data-v="${h.date}">Quitar</button></div>`).join('') || '<p class="muted small" style="padding:14px;margin:0">Ninguno.</p>'}</div>
    <div class="card"><div class="grid2"><input type="date" class="input" id="hDate" aria-label="Fecha"><input class="input" id="hName" placeholder="Nombre" aria-label="Nombre del festivo"></div><button class="btn block" style="margin-top:10px" data-act="addHoliday">Agregar festivo manual</button></div>
    <p class="hint">Calculados localmente según la Ley 51 de 1983 (traslado a lunes) y la fecha de Pascua. Si el Gobierno cambia un festivo, usa las excepciones.</p>`;
}
function vPrivacidad() {
  return `<div class="card" style="line-height:1.55">
    <h3 style="margin-top:0">Política de privacidad de WalletWeb</h3>
    <p><b>Qué se recopila.</b> Solo lo que tú escribes: cuentas (nombre, institución, últimos 4 dígitos opcionales), movimientos, categorías, personas, presupuestos, lista de deseos (con sus notas y links), préstamos, reglas recurrentes, comprobantes que adjuntes y un registro de auditoría de acciones sensibles.</p>
    <p><b>Dónde se almacena.</b> En el almacenamiento del navegador de este dispositivo (IndexedDB). No hay servidor de WalletWeb: tus datos financieros nunca se envían por Internet. Otro dispositivo no ve estos datos salvo que restaures allí una copia.</p>
    <p><b>Qué nunca se guarda.</b> Números completos de tarjeta, CVV, PIN bancario, contraseñas o credenciales de banca. Tu PIN de WalletWeb se guarda solo como hash (PBKDF2). La biometría nunca llega a la app: el desbloqueo lo hace tu dispositivo.</p>
    <p><b>Google, Drive e IA.</b> Esta versión no se conecta a Google, Drive, Gmail ni a ningún proveedor de IA. Cuando se agreguen, serán opcionales, pedirán permiso por separado y esta política se actualizará.</p>
    <p><b>Lectura de facturas.</b> Cuando tomas o adjuntas la foto de una factura, el texto se lee en tu propio teléfono con Tesseract (código abierto). La foto no se envía a ningún servidor ni a ninguna IA. El escáner usa la cámara solo mientras está abierto; el recorte y la limpieza se hacen en el teléfono. Se guarda un PDF de la factura (con el texto leído como capa invisible para poder buscarlo), una miniatura y un resumen de lo leído (total, impuestos, propina, descuento).</p>
    <p><b>Mapa.</b> Solo cuando abres “Mapa” en un gasto, la app pide imágenes del mapa a CARTO (basemaps.cartocdn.com) u OpenStreetMap (tile.openstreetmap.org) y busca lugares en nominatim.openstreetmap.org o photon.komoot.io. Se envía únicamente el texto que buscas y la zona del mapa que miras; nunca importes, cuentas ni personas. El botón “Google Maps” abre la app de Google con el nombre de la tienda.</p>
    <p><b>Ubicación.</b> Solo si tocas "Usar mi ubicación" al registrar un movimiento; nunca en segundo plano. Los comprobantes en imagen se re-codifican y pierden sus metadatos (incluido GPS).</p>
    <p><b>Cookies y analítica.</b> No hay cookies, rastreadores, anuncios ni analítica. Las fuentes y librerías son locales.</p>
    <p><b>Copias.</b> Las copias se cifran con AES-256-GCM y una clave derivada de tu contraseña (PBKDF2-SHA256, 600.000 iteraciones). Si olvidas la contraseña, la copia no se puede abrir. Tú decides dónde guardarlas (Archivos, Drive, etc.).</p>
    <p><b>Retención y eliminación.</b> Los movimientos eliminados quedan 30 días en la papelera. La auditoría se conserva un año. "Borrar todos los datos" elimina todo de este dispositivo; las copias que hayas exportado siguen existiendo donde las guardaste hasta que las borres.</p>
    <p style="margin-bottom:0"><b>Tus derechos.</b> Eres el único propietario: puedes exportar (CSV o copia completa), corregir y eliminar tus datos en cualquier momento.</p></div>`;
}

const VIEWS = {
  inicio: ['Inicio', vInicio], movimientos: ['Movimientos', vMovimientos], cuentas: ['Cuentas', vCuentas], prestamos: ['Préstamos', vPrestamos], ajustes: ['Ajustes', vAjustes],
  presupuestos: ['Presupuestos', vPresupuestos], metas: ['Quiero comprar', vMetas], recurrentes: ['Recurrentes', vRecurrentes], categorias: ['Categorías', vCategorias],
  personas: ['Personas', vPersonas], papelera: ['Papelera', vPapelera], auditoria: ['Auditoría', vAuditoria], alertas: ['Alertas', vAlertas], festivos: ['Festivos', vFestivos], privacidad: ['Privacidad', vPrivacidad]
};
const PARENT = { prestamos: 'ajustes', cuentas: 'ajustes', presupuestos: 'ajustes', metas: 'ajustes', recurrentes: 'ajustes', categorias: 'ajustes', personas: 'ajustes', papelera: 'ajustes', auditoria: 'ajustes', alertas: 'inicio', festivos: 'ajustes', privacidad: 'ajustes' };
function go(r) { if (!VIEWS[r]) r = 'inicio'; if (location.hash !== '#' + r) { history.pushState(null, '', '#' + r); } route = r; render(); window.scrollTo(0, 0); }
function render() {
  const [title, fn] = VIEWS[route] || VIEWS.inicio;
  const tabs = getTabs(), inBar = tabs.includes(route);
  // una pantalla que está en el menú inferior no lleva flecha de volver
  const parent = inBar ? null : (PARENT[route] || (route !== tabs[0] ? tabs[0] : null));
  const tab = inBar ? route : (PARENT[route] && tabs.includes(PARENT[route]) ? PARENT[route] : route);
  const tb = $('#tabbar'), key = tabs.join(',');
  if (tb && tb.dataset.k !== key) { tb.innerHTML = tabbarHTML(tabs); tb.dataset.k = key; }
  const gear = $('#gearBtn'); if (gear) { gear.hidden = tabs.includes('ajustes') || route === 'ajustes'; if (!gear.innerHTML) gear.innerHTML = ic('gear'); }
  $('#title').textContent = route === 'inicio' ? saludo() : title;
  $('#tbLeft').innerHTML = parent ? `<button class="icon-btn" data-act="go" data-v="${parent}" aria-label="Volver">${ic('left')}</button>` : '';
  $$('[data-tab]').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  const n = insights().filter(x => x.level !== 'info').length;
  $('#bellBadge').textContent = n; $('#bellBadge').hidden = !n;
  $('#view').innerHTML = fn();
  applyPrivacy();
  if (S.demo) { if (PROFILE.demo) setBanner('Perfil de <b>demostración</b>: todos los datos son ficticios.', 'Restablecer', () => resetDemoProfile()); else setBanner('Estás viendo <b>datos de demostración</b>.', 'Borrar y empezar', () => wipeDemo()); }
}
function saludo() { const h = Number(C.nowTime().slice(0, 2)); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }
