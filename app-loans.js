/* WalletWeb — préstamos en el Inicio, abonos desde Ingresos (con soporte) y filtros compactos de Movimientos. */
'use strict';

/* ---------- Préstamos: utilidades ---------- */
function activeGivenLoans() {
  const t = today();
  return S.loans.filter(l => l.direction === 'given' && !l.statusOverride).map(l => ({ l, s: C.loanSummary(l, t) })).filter(x => x.s.balance > 0);
}
// Préstamo activo de una persona (el más antiguo con saldo)
function loanOfPerson(pid) {
  return activeGivenLoans().filter(x => x.l.personId === pid).sort((a, b) => (a.l.startDate || '').localeCompare(b.l.startDate || ''))[0] || null;
}
// En un ingreso, marcar a una persona que te debe lo convierte en abono de su préstamo. No se adivina nada.
function syncLoanFromPeople() {
  if (!D || D.type !== 'income' || D.id) return;
  const cur = loanById(D.loanId);
  if (D.loanMode && cur && D.people.includes(cur.personId)) return;
  const hit = D.people.filter(p => p !== D.loanOptOut).map(loanOfPerson).find(Boolean);
  if (hit) {
    D.loanMode = true; D.loanId = hit.l.id; D.categoryId = ''; D.subcategoryId = '';
    if (!D.merchant) D.merchant = personName(hit.l.personId);
    if (!C.evalAmount(D.amountText)) D.amountText = String(Math.min(hit.s.next?.amount || hit.s.balance, hit.s.balance));
  } else if (D.loanMode && cur && !D.people.includes(cur.personId)) { D.loanMode = false; D.loanId = ''; }
}
function loanPreviewText() {
  const l = loanById(D?.loanId); if (!l) return '';
  const v = C.evalAmount(D.amountText), s = C.loanSummary(l, today());
  if (!v) return `Escribe el valor que te devolvió. Cuota sugerida: <b>${esc(C.formatMoney(Math.min(s.next?.amount || s.balance, s.balance)))}</b>.`;
  const a = C.allocatePayment(l, v);
  if (a.error) return `<span class="neg">${esc(a.error)}</span>`;
  return `${l.interestMode !== 'none' ? `<b>${esc(C.formatMoney(a.interest))}</b> a interés y ` : ''}<b>${esc(C.formatMoney(a.capital))}</b> a capital. Saldo después: <b>${esc(C.formatMoney(Math.max(0, s.balance - v)))}</b>${s.balance - v <= 0 ? ' · ¡Queda pagado!' : ''}`;
}
// Bloque del formulario de ingreso: botón "Pago de préstamo" y, al elegirlo, quién te devuelve
function loanIncomeButton() {
  if (!D || D.type !== 'income' || D.id || !activeGivenLoans().length) return '';
  return `<button type="button" class="cat-btn" style="--cc:${CAT_FAMILIES.amber.base}" data-act="dloan" aria-pressed="${!!D.loanMode}"><span class="e" aria-hidden="true">${ic('hand')}</span>Pago de préstamo</button>`;
}
function loanIncomeBlock() {
  if (!D || D.type !== 'income' || D.id || !D.loanMode) return '';
  const list = activeGivenLoans();
  return `<div class="loan-pick">
    <div class="lbl small" style="margin:14px 4px 8px;font-weight:650;color:var(--ink-2)">¿Quién te está devolviendo?</div>
    <div class="loan-opts">${list.map(({ l, s }) => `<button type="button" class="loan-opt" data-act="dloanPick" data-v="${l.id}" aria-pressed="${D.loanId === l.id}">
      <span class="loan-av" style="--cc:${CAT_FAMILIES.amber.base}">${esc(personName(l.personId).charAt(0).toUpperCase())}</span>
      <span class="grow"><span class="t">${esc(personName(l.personId))}</span><span class="s">Te debe ${esc(C.formatMoney(s.balance))}${s.next ? ' · cuota ' + esc(C.formatMoney(s.next.amount)) + ' · ' + esc(fdShort(s.next.due)) : ''}${s.daysLate ? ' · ' + s.daysLate + ' días de atraso' : ''}</span></span>
      ${ic('check', 'sm')}</button>`).join('')}</div>
    ${D.loanId ? `<div class="loan-who">${ic('hand', 'sm')}<span class="grow">Se descuenta del préstamo de <b>${esc(personName(loanById(D.loanId)?.personId))}</b></span><button type="button" class="link-btn" data-act="dloanOff" style="min-height:0;padding:2px 0;font-size:13px">No es un abono</button></div><p class="loan-prev" id="loanPrev">${loanPreviewText()}</p>` : ''}
    <p class="hint">Se guarda como abono del préstamo: la devolución del capital no cuenta como ingreso; solo el interés. Puedes adjuntar el soporte abajo. Marcar en "Personas" a alguien que te debe también lo descuenta de su préstamo.</p></div>`;
}
const _lnUpdateTxLive = updateTxLive;
updateTxLive = function () {
  _lnUpdateTxLive.apply(this, arguments);
  const pv = document.getElementById('loanPrev'); if (pv) pv.innerHTML = loanPreviewText();
};

/* ---------- Inicio: préstamos e historial de pagos ---------- */
function homeLoansSection() {
  if (!S.loans.length) return lendExpenses().length ? sectionH('Préstamos') + lendExpensesCard() : '';
  const t = today(), all = S.loans.map(l => ({ l, s: C.loanSummary(l, t) }));
  const owed = C.sum(all.filter(x => x.l.direction === 'given' && !x.l.statusOverride).map(x => x.s.balance));
  const owe = C.sum(all.filter(x => x.l.direction === 'received' && !x.l.statusOverride).map(x => x.s.balance));
  const active = all.filter(x => !x.l.statusOverride && x.s.balance > 0).sort((a, b) => (a.s.next?.due || '9').localeCompare(b.s.next?.due || '9'));
  const pays = loanPayments().slice(0, 4);
  return `${sectionH('Préstamos', 'loansHistory', 'Historial')}
    <div class="card loans-home">
      <div class="grid2"><div><div class="muted tiny">Te deben</div><div class="lh-v">${money(owed)}</div></div><div><div class="muted tiny">Debes</div><div class="lh-v">${money(owe)}</div></div></div>
      ${active.slice(0, 3).map(({ l, s }) => `<button class="lh-loan" data-act="loanDetail" data-id="${l.id}">
        <span class="loan-av" style="--cc:${l.direction === 'given' ? CAT_FAMILIES.amber.base : CAT_FAMILIES.indigo.base}">${esc(personName(l.personId).charAt(0).toUpperCase())}</span>
        <span class="grow"><span class="lh-t"><span>${l.direction === 'given' ? 'Te debe' : 'Le debes a'} <b>${esc(personName(l.personId))}</b></span><span class="amt">${esc(C.formatMoney(s.balance))}</span></span>
          <span class="lh-bar"><i style="--w:${Math.max(s.paid ? 2 : 0, s.total ? s.paid / s.total * 100 : 0).toFixed(1)}%"></i></span>
          <span class="lh-s">${esc(C.formatMoney(s.paid))} pagado de ${esc(C.formatMoney(s.total))}${s.next ? ' · próxima ' + esc(fdShort(s.next.due)) : ''}${s.daysLate ? ` · <span class="neg">${s.daysLate} días de atraso</span>` : ''}</span></span></button>`).join('')}
      ${pays.length ? `<div class="lh-sub">Últimos pagos</div>${pays.map(loanPayRow).join('')}` : ''}
      ${lendExpenses().length ? `<button class="lh-fix" data-act="go" data-v="prestamos">${ic('alert', 'sm')}<span>${lendExpenses().length} gasto(s) en la categoría Préstamo sin registrar como préstamo</span>${ic('right', 'sm')}</button>` : ''}
      <div class="btn-row" style="margin-top:10px">${activeGivenLoans().length ? `<button class="btn" data-act="loanPayIncome">${ic('plus', 'sm')} Registrar pago</button>` : ''}<button class="btn" data-act="go" data-v="prestamos">Ver préstamos</button></div>
    </div>`;
}
function loanPayments() {
  return S.transactions.filter(t => !t.deletedAt && (t.type === 'repay_in' || t.type === 'repay_out')).sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
}
function loanPayRow(t) {
  const inn = t.type === 'repay_in';
  return `<button class="row-item lh-pay" data-act="txDetail" data-id="${t.id}"><span class="ico" style="--cc:${inn ? CAT_FAMILIES.green.base : CAT_FAMILIES.red.base}">${ic(inn ? 'down' : 'up', 'sm')}</span>
    <span class="grow"><span class="t">${inn ? esc(personName(t.personId)) + ' te pagó' : 'Pagaste a ' + esc(personName(t.personId))}</span><span class="s">${esc(fdShort(t.date))} · capital ${esc(C.formatMoney(t.capital ?? t.amount))}${t.interest ? ' · interés ' + esc(C.formatMoney(t.interest)) : ''}</span></span>
    ${t.receipt ? `<span class="lh-clip" title="Con soporte">${ic('clip', 'sm')}</span>` : ''}<span class="r ${inn ? 'pos' : ''}">${money(t.amount)}</span></button>`;
}
function loansHistory(pid) {
  const pays = loanPayments().filter(t => !pid || t.personId === pid);
  const people = [...new Set(loanPayments().map(t => t.personId))];
  const totIn = C.sum(pays.filter(t => t.type === 'repay_in').map(t => t.amount)), totOut = C.sum(pays.filter(t => t.type === 'repay_out').map(t => t.amount));
  const body = `${people.length > 1 ? `<div class="chips" style="margin-bottom:10px"><button class="chip" data-act="loansHistory" data-v="" aria-pressed="${!pid}">Todos</button>${people.map(p => `<button class="chip" data-act="loansHistory" data-v="${p}" aria-pressed="${pid === p}">${esc(personName(p))}</button>`).join('')}</div>` : ''}
    <div class="grid2" style="margin-bottom:12px"><div class="stat"><div class="k">Te han pagado</div><div class="v pos">${money(totIn)}</div></div><div class="stat"><div class="k">Has pagado</div><div class="v">${money(totOut)}</div></div></div>
    ${pays.length ? `<div class="list">${pays.map(loanPayRow).join('')}</div><p class="hint">Toca un pago para ver su detalle y el soporte adjunto.</p>` : `<div class="card">${emptyState('hand', 'Sin pagos todavía', 'Cuando registres abonos aparecerán aquí con su soporte.')}</div>`}`;
  const s = sheets.find(x => x.id === 'lhist');
  if (s) s.setBody(body); else openSheet({ id: 'lhist', title: 'Historial de pagos de préstamos', body });
}

/* ---------- Movimientos: filtros compactos ---------- */
const MOV_PERIODS = [['month', 'Mes'], ['week', 'Semana'], ['year', 'Año'], ['custom', 'Fechas'], ['all', 'Todo']];
function movActiveFilters() {
  const out = [];
  if (ui.movPeriod !== 'month') out.push(['movPeriod', ui.movPeriod === 'custom' ? [ui.movFrom ? fdShort(ui.movFrom) : 'inicio', ui.movTo ? fdShort(ui.movTo) : 'hoy'].join(' – ') : MOV_PERIODS.find(p => p[0] === ui.movPeriod)[1], 'cal']);
  if (ui.movAccount) out.push(['movAccount', accById(ui.movAccount)?.name || 'Cuenta', 'card']);
  if (ui.movCategory) out.push(['movCategory', ui.movCategory.startsWith('sub:') ? (S.categories.flatMap(c => c.subs).find(s => s.id === ui.movCategory.slice(4))?.name || 'Subcategoría') : (catById(ui.movCategory)?.name || 'Categoría'), 'tag']);
  if (ui.movPerson) out.push(['movPerson', personName(ui.movPerson), 'user']);
  return out;
}
function movFilterBody() {
  return `<div class="field"><span class="lbl">Periodo</span>${seg('Periodo', MOV_PERIODS, ui.movPeriod, 'movPeriodSet')}</div>
    ${ui.movPeriod === 'custom' ? `<div class="grid2"><div class="field"><label for="mfF">Desde</label><input id="mfF" type="date" class="input" data-bind="ui.movFrom" value="${esc(ui.movFrom || '')}"></div><div class="field"><label for="mfT">Hasta</label><input id="mfT" type="date" class="input" data-bind="ui.movTo" value="${esc(ui.movTo || '')}"></div></div>` : ''}
    <div class="field"><label for="mfC">Categoría</label><select id="mfC" class="input" data-bind="ui.movCategory">${optionList(S.categories.filter(c => !c.archived).flatMap(c => [[c.id, c.name], ...c.subs.map(s => ['sub:' + s.id, '  › ' + s.name])]), ui.movCategory, 'Todas')}</select></div>
    <div class="grid2"><div class="field"><label for="mfA">Cuenta</label><select id="mfA" class="input" data-bind="ui.movAccount">${optionList(S.accounts.map(a => [a.id, a.name]), ui.movAccount, 'Todas')}</select></div>
      <div class="field"><label for="mfP">Persona</label><select id="mfP" class="input" data-bind="ui.movPerson">${optionList(S.people.filter(p => !p.archived).map(p => [p.id, p.name]), ui.movPerson, 'Todas')}</select></div></div>
    <p class="hint" id="mfCount"></p>`;
}
function movFilterCount() { const el = document.getElementById('mfCount'); if (el) { const n = S.transactions.filter(movFilterFn()).length; el.textContent = `${n} movimiento${n === 1 ? '' : 's'} con estos filtros.`; } }
document.addEventListener('change', e => {
  if (!e.target.closest?.('.sheet') || !sheets.find(x => x.id === 'movf')) return;
  if (e.target.dataset.bind === 'ui.movPeriod') sheets.find(x => x.id === 'movf').setBody(movFilterBody());
  setTimeout(movFilterCount, 0);
});

Object.assign(ACT, {
  dloan: () => { D.loanMode = !D.loanMode; if (D.loanMode) { D.categoryId = ''; D.subcategoryId = ''; const g = activeGivenLoans(); if (g.length === 1) ACT.dloanPick({ dataset: { v: g[0].l.id } }, null, true); } else D.loanId = ''; rerenderTx(); },
  dloanPick: (el, ev, silent) => {
    const l = loanById(el.dataset.v); if (!l || !D) return;
    const prevP = loanById(D.loanId)?.personId;
    D.loanMode = true; D.loanId = l.id; D.categoryId = ''; D.subcategoryId = '';
    D.merchant = personName(l.personId);
    D.people = D.people.filter(p => p !== prevP || p === l.personId);
    if (!D.people.includes(l.personId)) D.people = D.people.concat(l.personId);
    if (!C.evalAmount(D.amountText)) { const s = C.loanSummary(l, today()); D.amountText = String(Math.min(s.next?.amount || s.balance, s.balance)); }
    D.loanOptOut = '';
    if (silent !== true) rerenderTx();
  },
  dloanOff: () => { const l = loanById(D.loanId); D.loanOptOut = l?.personId || ''; D.loanMode = false; D.loanId = ''; rerenderTx(); toast('Se guardará como ingreso normal'); },
  ptoggle: el => { const v = el.dataset.v, i = D.people.indexOf(v);
    if (isLendDraft()) { D.people = i >= 0 ? [] : [v]; rerenderTx(); return; }
    if (D.type === 'income' && D.loanMode && i < 0) { const h = loanOfPerson(v); if (h) { const prev = loanById(D.loanId)?.personId; D.people = D.people.filter(p => p !== prev); D.people.push(v); D.loanId = h.l.id; D.merchant = personName(v); D.amountText = String(Math.min(h.s.next?.amount || h.s.balance, h.s.balance)); rerenderTx(); return; } }
    if (i >= 0) D.people.splice(i, 1); else D.people.push(v); if (D.loanOptOut === v && i >= 0) D.loanOptOut = ''; syncLoanFromPeople(); rerenderTx(); },
  pgroup: el => { const ids = S.people.filter(p => !p.archived && p.group === el.dataset.v).map(p => p.id); const all = ids.every(id => D.people.includes(id)); D.people = all ? D.people.filter(id => !ids.includes(id)) : [...new Set([...D.people, ...ids])]; syncLoanFromPeople(); rerenderTx(); },
  loansHistory: el => loansHistory(el.dataset.v || ''),
  loanPayIncome: el => { closeAllSheets(); openTxForm({ type: 'income', loanMode: true, loanId: el?.dataset?.id || '' }); const g = activeGivenLoans(); if (!D.loanId && g.length === 1) ACT.dloanPick({ dataset: { v: g[0].l.id } }); else if (D.loanId) ACT.dloanPick({ dataset: { v: D.loanId } }); },
  movFilters: () => { openSheet({ id: 'movf', title: 'Filtrar movimientos', body: movFilterBody(), footer: `<button class="btn" data-act="movClearAll">Limpiar</button><button class="btn primary" data-act="closeSheet">Ver resultados</button>` }); movFilterCount(); },
  movPeriodSet: el => { ui.movPeriod = el.dataset.v; ui.movLimit = 60; if (el.dataset.v === 'custom' && !ui.movFrom) { ui.movFrom = C.addDays(today(), -30); ui.movTo = today(); } render(); const s = sheets.find(x => x.id === 'movf'); if (s) { s.setBody(movFilterBody()); movFilterCount(); } },
  movClear: el => { const k = el.dataset.k; ui[k] = k === 'movPeriod' ? 'month' : ''; ui.movLimit = 60; render(); },
  movClearAll: () => { Object.assign(ui, { movPeriod: 'month', movAccount: '', movCategory: '', movPerson: '', movFrom: '', movTo: '', movLimit: 60 }); render(); const s = sheets.find(x => x.id === 'movf'); if (s) { s.setBody(movFilterBody()); movFilterCount(); } }
});

/* ---------- Gastos que en realidad eran préstamos ---------- */
function lendExpenses() {
  return S.transactions.filter(t => !t.deletedAt && t.type === 'expense' && !t.loanId && catById(t.categoryId)?.defaultNature === 'loan').sort((a, b) => b.date.localeCompare(a.date));
}
function lendExpensesCard() {
  const list = lendExpenses(); if (!list.length) return '';
  return `<div class="card lend-fix"><div class="lend-fix-h">${ic('alert', 'sm')}<b>${list.length} gasto${list.length > 1 ? 's' : ''} en la categoría Préstamo</b></div>
    <p class="muted small" style="margin:4px 0 8px">Se guardaron como gasto y no aparecen en tus préstamos. Conviértelos para llevar el control de quién te debe.</p>
    ${list.slice(0, 6).map(t => `<div class="lend-fix-row"><span class="grow"><span class="t">${esc(t.people?.length ? personName(t.people[0]) : (t.merchant || subName(t) || 'Sin persona'))}</span><span class="s">${esc(fdShort(t.date))} · ${esc(C.formatMoney(t.amount))}</span></span><button class="btn sm primary" data-act="lendConvert" data-id="${t.id}">Convertir</button></div>`).join('')}</div>`;
}
Object.assign(ACT, {
  lendConvert: el => {
    const t = txById(el.dataset.id); if (!t) return;
    closeAllSheets(); loanForm('given');
    Object.assign(LF, { personId: t.people?.[0] || '', principalText: String(t.amount), accountId: t.accountId || LF.accountId, date: t.date, firstDue: C.addMonthsISO(t.date, 1), note: t.note || t.merchant || '', fromTxId: t.id });
    const s = sheets.find(x => x.id === 'loan'); if (s) { s.setTitle('Convertir en préstamo'); s.setBody(loanBody()); }
  }
});
