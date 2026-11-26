/* WalletWeb — acciones, copias, importación/exportación, demo e inicio. */
'use strict';

/* ================= Acciones (delegación de eventos) ================= */
const ACT = {
  go: el => { closeAllSheets(); go(el.dataset.v); },
  month: el => { ui.month = C.addMonthsKey(ui.month, Number(el.dataset.v)); render(); },
  movType: el => { ui.movType = el.dataset.v; ui.movLimit = 60; render(); },
  moreMovs: () => { ui.movLimit += 60; render(); },
  loanTab: el => { ui.loanTab = el.dataset.v; render(); },
  toggleArchived: () => { ui.showArchived = !ui.showArchived; render(); },
  filterCat: el => { ui.movCategory = el.dataset.v; ui.movType = 'all'; ui.movPeriod = 'month'; go('movimientos'); },
  filterPerson: el => { closeAllSheets(); ui.movPerson = el.dataset.v; ui.movType = 'all'; go('movimientos'); },
  clearPerson: () => { ui.movPerson = ''; render(); },
  filterPending: () => { closeAllSheets(); ui.movType = 'pending'; ui.movPeriod = 'all'; go('movimientos'); },
  closeSheet: () => closeSheet(),
  bannerAct: () => bannerAction && bannerAction(),
  privToggle: () => { S.settings.privacy = !S.settings.privacy; applyPrivacy(); save(); },
  pinKey: el => pinKey(el.dataset.k),
  passkeyUnlock: () => passkeyUnlock(false),
  reauthCancel: () => { $('#lock').hidden = true; $('#lock').innerHTML = ''; const r = reauthResolver; reauthResolver = null; locked = false; if (r) r(false); },
  lockNow: () => { closeAllSheets(); lockNow(); },
  setWall: async el => { S.settings.glass = Object.assign({}, GLASS_DEFAULT, S.settings.glass, { wallpaper: el.dataset.v }); await applyGlass(); save(); render();
    if (el.dataset.v === 'photo' && !(await Store.get('wallpaper'))) toast('Elige una foto para el fondo.'); },
  glassReset: () => { S.settings.glass = Object.assign({}, GLASS_DEFAULT); applyGlass(); save(); render(); toast('Apariencia restablecida'); },
  setTheme: el => { S.settings.theme = el.dataset.v; applyTheme(); save(); render(); },

  // Movimientos
  newTx: () => openTxForm(),
  txDetail: el => txDetail(el.dataset.id),
  txEdit: async el => { const t = txById(el.dataset.id); await closeSheet(true); openTxForm(null, t); },
  txDup: async el => { const t = txById(el.dataset.id); await closeSheet(true); const d = draftFromTx(t); openTxForm(Object.assign(stripD(d), { id: null, date: today(), time: C.nowTime(), status: 'confirmed', source: 'manual' })); },
  txDelete: el => txDelete(el.dataset.id),
  txConfirm: async el => { const t = txById(el.dataset.id);
    t.status = 'confirmed'; t.updatedAt = new Date().toISOString(); audit('transaction.confirmed', 'transaction', t.id, `Confirmado: ${txTitle(t)} ${C.formatMoney(t.amount)}`); save(); await closeSheet(true); render(); toast('Movimiento confirmado'); },
  txSave: () => txSave(),
  dtype: el => { D.type = el.dataset.v; D.categoryId = ''; D.subcategoryId = ''; D.loanMode = false; D.loanId = ''; if (D.type !== 'expense') D.splitOn = false; rerenderTx(); },
  dset: el => { const k = el.dataset.k; D[k] = el.dataset.v; if (D.ocrFilled) delete D.ocrFilled[k]; if (k === 'type' && el.dataset.v !== 'income') { D.loanMode = false; D.loanId = ''; } if (k === 'accountId' && D.toAccountId === D.accountId) D.toAccountId = ''; rerenderTx(); },
  dcat: el => { const v = el.dataset.v; D.loanMode = false; D.loanId = ''; D.categoryId = D.categoryId === v ? '' : v; D.subcategoryId = ''; const c = catById(D.categoryId); if (c?.defaultNature) D.nature = c.defaultNature; rerenderTx(); },
  dmore: () => { D.more = !D.more; rerenderTx(); },
  itemAdd: () => { D.items.push({ name: '', qty: '', unit: '' }); rerenderTx(); setTimeout(() => $(`[data-it="${D.items.length - 1}"][data-itk="name"]`)?.focus(), 30); },
  itemDel: el => { D.items.splice(Number(el.dataset.v), 1); if (!D.items.length) D.items.push({ name: '', qty: '', unit: '' }); if (D.ocrFilled) delete D.ocrFilled.items; rerenderTx(); },
  rowDel: el => { const k = el.dataset.v; D.rows = D.rows.filter(x => x !== k); D[k] = ''; if (D.ocrFilled) delete D.ocrFilled[k]; rerenderTx(); },
  rowAdd: el => { const k = el.dataset.v; D.rows = ['tax', 'discount', 'tip', 'shipping'].filter(x => D.rows.includes(x) || x === k); rerenderTx(); setTimeout(() => $('#x' + k)?.focus(), 30); },
  customAdd: () => { D.customRows.push({ label: '', value: '' }); rerenderTx(); setTimeout(() => { const l = $$('[data-crk="label"]'); l[l.length - 1]?.focus(); }, 30); },
  customDel: el => { D.customRows.splice(Number(el.dataset.v), 1); rerenderTx(); },
  scanOpen: () => { if (!D) return; D._srcHash = null; openScanner(useScan); },
  rcptView: el => viewReceipt(el.dataset.id || null),
  scanAdjust: () => { if (D?._scan) openScanner(useScan, { canvas: D._scan.src, quad: D._scan.quad, curve: D._scan.curve, userCurve: D._scan.userCurve, manual: D._scan.manual }); },
  rcptRemove: () => { if (D._thumbUrl) URL.revokeObjectURL(D._thumbUrl); D._thumbUrl = null; D.receiptBlob = null; D.receiptMeta = null; D.removeReceipt = true; D.ocr = null; D._ocrFile = null; D._ocrFlat = null; D._scan = null; D._scanJpeg = null; D._thumbBlob = null; rerenderTx(); },
  ocrRerun: () => { if (D?._ocrFile) runOcr(D._ocrFile, D._scanCharH, D._ocrFlat); },
  ocrUse: el => { const r = D.ocr?.r; if (!r) return; const k = el.dataset.k;
    if (k === 'amount') { D.amountText = Number(r.total).toLocaleString('es-CO'); D.ocrFilled.amount = true; }
    if (k === 'date') D.date = r.date;
    if (k === 'items') { D.items = D.items.filter(it => String(it.name).trim() || String(it.unit).trim()).concat(receiptItems(r.items)); D.ocrFilled.items = true; }
    rerenderTx(); },
  ptoggle: el => { const v = el.dataset.v, i = D.people.indexOf(v); if (i >= 0) D.people.splice(i, 1); else D.people.push(v); rerenderTx(); },
  pgroup: el => { const ids = S.people.filter(p => !p.archived && p.group === el.dataset.v).map(p => p.id); const all = ids.every(id => D.people.includes(id)); D.people = all ? D.people.filter(id => !ids.includes(id)) : [...new Set([...D.people, ...ids])]; rerenderTx(); },
  pNew: () => { D.newPersonOpen = true; rerenderTx(); setTimeout(() => $('#newPersonTag')?.focus(), 30); },
  pCancel: () => { D.newPersonOpen = false; rerenderTx(); },
  pAdd: () => {
    const inp = $('#newPersonTag'), name = (inp?.value || '').trim().replace(/\s+/g, ' '), group = ($('#newPersonGroup')?.value || '').trim();
    if (!name) { inp?.focus(); return; }
    let p = S.people.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p) { p.archived = false; if (group && !p.group) p.group = group; }
    else { p = { id: uid(), name, alias: '', group, notes: '', archived: false, createdAt: new Date().toISOString() }; S.people.push(p); }
    if (!D.people.includes(p.id)) D.people.push(p.id);
    D.newPersonOpen = false; save(); rerenderTx(); toast(`"${name}" guardada para futuros movimientos`);
  },
  mapPicker: () => mapPicker(),
  mapSearch: () => mapSearch(),
  mapRetry: () => { const k = 0; mapMessage(''); mapLoadTiles(k); },
  mapResult: el => { const r = window._mapResults[Number(el.dataset.v)]; $('#mapResults').hidden = true; MAP.setView([Number(r.lat), Number(r.lon)], 18); setPick(Number(r.lat), Number(r.lon), shortPlace(r)); },
  mapLocate: () => { if (!navigator.geolocation) { toast('Ubicación no disponible.'); return; } navigator.geolocation.getCurrentPosition(p => { if (!MAP) return; MAP.setView([p.coords.latitude, p.coords.longitude], 18); setPick(p.coords.latitude, p.coords.longitude, null, true); }, () => toast('Permiso de ubicación rechazado.'), { timeout: 10000, maximumAge: 60000 }); },
  mapUse: async () => {
    if (!mapPick || !D) return;
    D.mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapPick.lat},${mapPick.lng}`; D._autoMaps = false;
    if (mapPick.label && !D.location) D.location = mapPick.label.slice(0, 120);
    await closeSheet(true); rerenderTx(); toast('Ubicación guardada como link de Google Maps');
  },
  linkPaste: async () => {
    try { const t = (await navigator.clipboard.readText() || '').trim(); const m = /https?:\/\/\S+/.exec(t); if (!m) { toast('El portapapeles no tiene un link.'); return; } D.mapsUrl = m[0]; D._autoMaps = false; rerenderTx(); }
    catch (e) { toast('No se pudo leer el portapapeles. Mantén presionado el campo y elige Pegar.'); }
  },
  subNew: () => { D.newSubOpen = true; rerenderTx(); setTimeout(() => $('#newSubName')?.focus(), 30); },
  subCancel: () => { D.newSubOpen = false; rerenderTx(); },
  subAdd: () => {
    const c = catById(D.categoryId), inp = $('#newSubName'), name = (inp?.value || '').trim().replace(/\s+/g, ' ');
    if (!c || !name) { inp?.focus(); return; }
    let s = c.subs.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (s) s.archived = false; else { s = { id: uid(), name }; c.subs.push(s); audit('category.sub_added', 'category', c.id, `Subcategoría creada: ${c.name} › ${name}`); }
    D.subcategoryId = s.id; D.newSubOpen = false; save(); rerenderTx(); toast(`"${name}" agregada a ${c.name}`);
  },
  dstatus: el => { D.status = el.dataset.v; rerenderTx(); },
  op: el => { const i = $('#amt'); D.amountText = (D.amountText || '').replace(/\s+$/, '') + ' ' + el.dataset.v + ' '; i.value = D.amountText; i.focus(); updateTxLive(); persistDraft(); },
  pasteSheet: () => pasteSheet(),
  readClipboard: async () => { try { $('#pasteTxt').value = await navigator.clipboard.readText(); } catch (e) { toast('No se pudo leer el portapapeles. Pega manualmente.'); } },
  applyPaste: () => applyPaste(),
  useLocation: () => {
    if (!navigator.geolocation) { toast('Ubicación no disponible en este navegador.'); return; }
    navigator.geolocation.getCurrentPosition(p => {
      const lat = p.coords.latitude.toFixed(5), lng = p.coords.longitude.toFixed(5);
      D.mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`; D._autoMaps = false; if (!D.location && D.type !== 'expense') D.location = 'Ubicación actual'; rerenderTx();
    }, () => toast('Permiso de ubicación rechazado. Puedes escribirla o pegar un enlace.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  },
  splitPerson: el => { const v = el.dataset.v, i = D.splitPeople.indexOf(v); if (i >= 0) D.splitPeople.splice(i, 1); else D.splitPeople.push(v); rerenderTx(); },
  splitAddPerson: () => { const n = $('#newPersonName').value.trim(); if (!n) return; let p = S.people.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!p) { p = { id: uid(), name: n, alias: '', group: '', notes: '', archived: false, createdAt: new Date().toISOString() }; S.people.push(p); } if (!D.splitPeople.includes(p.id)) D.splitPeople.push(p.id); save(); rerenderTx(); },
  splitMode: el => { D.splitMode = el.dataset.v; if (D.splitMode === 'custom') { const a = C.evalAmount(D.amountText); const sp = a ? C.splitEven(a, D.splitPeople.length + 1) : []; D.splitPeople.forEach((pid, k) => { if (!D.customParts[pid]) D.customParts[pid] = sp[k + 1] ? String(sp[k + 1]) : ''; }); } rerenderTx(); },

  // Cuentas
  accountForm: () => accountForm(),
  accountEdit: async el => { await closeSheet(true); accountForm(el.dataset.id); },
  accountSave: () => accountSave(),
  accountArchive: async el => { const a = accById(el.dataset.id); a.archived = !a.archived; audit('account.' + (a.archived ? 'archived' : 'restored'), 'account', a.id, (a.archived ? 'Cuenta archivada: ' : 'Cuenta reactivada: ') + a.name); save(); await closeSheet(true); render(); },
  afType: el => { AF.name = ($('#an')?.value) ?? AF.name; AF.type = el.dataset.v; const s = sheets.find(x => x.id === 'acc'); s.setBody(accountBody()); },
  afColor: el => { AF.color = el.dataset.v; $$('[data-act="afColor"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === AF.color))); },
  loanForm: el => loanForm(el.dataset.v),
  lfDir: el => { LF.direction = el.dataset.v; sheets.find(x => x.id === 'loan').setBody(loanBody()); },
  lfInt: el => { LF.interestMode = el.dataset.v; sheets.find(x => x.id === 'loan').setBody(loanBody()); },
  quickPerson: () => openSheet({ id: 'qp', title: 'Nueva persona', body: `<div class="field"><label for="qpn">Nombre</label><input id="qpn" class="input" autocomplete="off"></div>`, footer: `<button class="btn primary" data-act="quickPersonSave">Agregar</button>` }),
  quickPersonSave: async () => { const n = $('#qpn').value.trim(); if (!n) return; const p = { id: uid(), name: n, alias: '', group: '', notes: '', archived: false, createdAt: new Date().toISOString() }; S.people.push(p); save(); await closeSheet(true); if (LF) { LF.personId = p.id; sheets.find(x => x.id === 'loan').setBody(loanBody()); } },
  loanSave: () => loanSave(),
  loanDetail: el => { closeAllSheets(); loanDetail(el.dataset.id || el.dataset.v); },
  loanOverride: async el => {
    const l = loanById(el.dataset.id), v = el.dataset.v || null;
    if (v && !(await confirmDialog(v === 'forgiven' ? 'El saldo pendiente se dará por perdonado. Queda registrado en la auditoría.' : 'El préstamo se marcará como cancelado.', { title: v === 'forgiven' ? 'Condonar préstamo' : 'Cancelar préstamo', confirmText: 'Confirmar', danger: true }))) return;
    l.statusOverride = v; audit('loan.status', 'loan', l.id, `Préstamo de ${personName(l.personId)}: ${v ? LOAN_LABEL[v] : 'reactivado'}`);
    save(); await closeSheet(true); render(); loanDetail(l.id);
  },
  paymentForm: el => paymentForm(el.dataset.id),
  paymentSave: el => paymentSave(el.dataset.id),
  receivablePerson: el => receivablePerson(el.dataset.id),
  collectForm: el => collectForm(el.dataset.id, el.dataset.v),
  collectSave: async el => {
    const t = txById(el.dataset.id), pid = el.dataset.v, p = t.split.parts.find(x => x.personId === pid), pending = p.amount - (p.collected || 0);
    const v = C.evalAmount($('#ca').value), acc = $('#cacc').value;
    if (!v || v <= 0 || v > pending) { $('#colErr').textContent = 'El valor debe estar entre $1 y ' + C.formatMoney(pending) + '.'; return; }
    p.collected = (p.collected || 0) + v;
    S.transactions.push({ id: uid(), idempotencyKey: uid(), type: 'collect', amount: v, accountId: acc, personId: pid, refTxId: t.id, date: $('#cd').value || today(), time: C.nowTime(), status: 'confirmed', source: 'receivable', currency: 'COP', note: 'Cobro: ' + txTitle(t), tags: [], createdAt: new Date().toISOString(), version: 1 });
    audit('receivable.collected', 'transaction', t.id, `Cobro de ${C.formatMoney(v)} a ${personName(pid)}`);
    save(); closeAllSheets(); render(); toast('Cobro registrado');
  },
  markGift: async el => {
    const t = txById(el.dataset.id), p = t.split.parts.find(x => x.personId === el.dataset.v);
    if (!(await confirmDialog(`La parte pendiente de ${personName(p.personId)} pasará a ser gasto tuyo y dejará de estar por cobrar.`, { title: 'Asumir esta parte', confirmText: 'Asumir' }))) return;
    p.gift = true; audit('receivable.gift', 'transaction', t.id, `Parte de ${personName(p.personId)} marcada como asumida`); save(); closeAllSheets(); render();
  },

  // Presupuestos
  budgetForm: el => budgetForm(el.dataset.id),
  budgetSave: async () => {
    const f = window.BF, err = m => { $('#budErr').textContent = m; };
    if (f.scope !== 'global' && !f.ref) return err('Elige a qué aplica.');
    const value = f.method === 'fixed' ? C.evalAmount(f.valueText) : Math.round(C.parseNumberToken(String(f.valueText).replace('%', '')) || 0);
    if (!value || value <= 0 || (f.method !== 'fixed' && value > 100)) return err(f.method === 'fixed' ? 'Escribe un valor válido.' : 'Escribe un porcentaje entre 1 y 100.');
    const subRef = S.categories.flatMap(c => c.subs).find(s => s.id === f.ref);
    const refName = { global: 'Global', category: catById(f.ref)?.name, subcategory: subRef?.name, nature: NATURES[f.ref], tag: '#' + f.ref, account: accById(f.ref)?.name }[f.scope];
    if (f.dur === 'until' && !RX_MONTH.test(f.untilText)) return err('Elige hasta qué mes.');
    const range = budgetFormRange(f);
    if (range.fromMonth && range.untilMonth && range.untilMonth < range.fromMonth) return err('El mes final debe ser igual o posterior al inicial.');
    const old = f.id ? S.budgets.find(x => x.id === f.id) : null;
    const b = { ...(old || {}), id: f.id || uid(), name: f.name.trim() || refName, scope: f.scope, ref: f.scope === 'global' ? null : f.ref, method: f.method, value, period: 'month', archived: false, rulesVersion: 1, fromMonth: range.fromMonth, untilMonth: range.untilMonth };
    const i = S.budgets.findIndex(x => x.id === b.id); if (i >= 0) S.budgets[i] = b; else S.budgets.push(b);
    save(); await closeSheet(true); render(); toast('Presupuesto guardado');
  },
  budgetDelete: async el => { if (!(await confirmDialog('Se eliminará este presupuesto. Tus movimientos no cambian.', { title: 'Eliminar presupuesto', confirmText: 'Eliminar', danger: true }))) return; S.budgets = S.budgets.filter(b => b.id !== el.dataset.id); save(); await closeSheet(true); render(); },

  // Menú inferior
  tabsEdit: () => tabsEditor(),
  tabsReset: () => { TE = DEFAULT_TABS.slice(); sheets.find(x => x.id === 'tabs').setBody(tabsBody()); },
  tabsSave: async () => { S.settings.tabs = TE.slice(); save(); await closeSheet(true); render(); toast('Menú actualizado'); },

  // Quiero comprar (lista de deseos con fondo mensual)
  wishForm: el => wishForm(el.dataset.id),
  wishEdit: async el => { await closeSheet(true); wishForm(el.dataset.id); },
  wishPri: el => { $$('[data-act="wishPri"]').forEach(b => b.setAttribute('aria-pressed', String(b === el))); },
  wishPaste: async () => { try { const t = (await navigator.clipboard.readText() || '').trim(); const u = (t.match(/https?:\/\/\S+/) || [t])[0]; $('#wl').value = u; } catch (e) { toast('No se pudo leer el portapapeles. Mantén presionado el campo y elige Pegar.'); } },
  wishSave: async el => {
    const err = m => { $('#wishErr').textContent = m; };
    const name = $('#wn').value.trim(), price = C.evalAmount($('#wp').value), link = normUrl($('#wl').value);
    const pri = Number(($('[data-act="wishPri"][aria-pressed="true"]') || {}).dataset?.v || 2);
    const cp = $('#wcp').value.trim() ? C.evalAmount($('#wcp').value) : null, cq = $('#wcq').value.trim() ? Number($('#wcq').value) : null;
    if (!name) return err('Escribe qué quieres comprar.');
    if (!price || price <= 0) return err('Escribe el precio aproximado.');
    if (!validUrl(link)) return err('El link debe empezar por https://');
    if (cp !== null && (!cp || cp <= 0)) return err('Revisa el precio al que lo comprarías.');
    if (cq !== null && (!Number.isInteger(cq) || cq < 2 || cq > 48)) return err('Las cuotas sin interés deben ser un número entre 2 y 48.');
    const old = S.wishes.find(w => w.id === el.dataset.id);
    const w = Object.assign(old || { id: uid(), status: 'active', paid: null, fromFund: true, order: S.wishes.length, createdAt: new Date().toISOString() },
      { name, price, link, priority: pri, why: $('#wy').value.trim(), whyNot: $('#wyn').value.trim(), cond: { text: $('#wct').value.trim(), price: cp, cuotas: cq } });
    if (!old) S.wishes.push(w);
    save(); await closeSheet(true); render(); wishDetail(w.id); toast(old ? 'Deseo actualizado' : 'Deseo agregado');
  },
  wishDetail: el => wishDetail(el.dataset.id),
  wishMove: el => { // subir o bajar dentro de su prioridad
    const w = S.wishes.find(x => x.id === el.dataset.id); if (!w) return;
    const same = S.wishes.filter(x => x.status === 'active' && (x.priority || 2) === (w.priority || 2)).sort((a, b) => (a.order || 0) - (b.order || 0));
    same.forEach((x, i) => { x.order = i; });
    const i = same.indexOf(w), j = i + Number(el.dataset.v); if (j < 0 || j >= same.length) return;
    [same[i].order, same[j].order] = [same[j].order, same[i].order]; save(); render();
  },
  wishBought: el => wishBoughtForm(el.dataset.id),
  wishBoughtSave: async el => {
    const w = S.wishes.find(x => x.id === el.dataset.id); const paid = C.evalAmount($('#wbp').value);
    if (!paid || paid <= 0) { $('#wbErr').textContent = 'Escribe cuánto pagaste.'; return; }
    w.status = 'bought'; w.paid = paid; w.boughtDate = $('#wbd').value || today(); w.fromFund = $('#wbf').checked;
    const reg = $('#wbt').checked; save(); await closeSheet(true); render();
    if (reg) openTxForm({ amountText: String(paid), date: w.boughtDate, items: [{ name: w.name, qty: '1', unit: Number(paid).toLocaleString('es-CO') }], mapsUrl: w.link || '', note: 'Lista de deseos' });
    else toast('¡Comprado! Se descontó ' + (w.fromFund ? 'del fondo' : 'de nada (fuera del fondo)'));
  },
  wishDiscard: async el => { const w = S.wishes.find(x => x.id === el.dataset.id); w.status = 'discarded'; w.discardedAt = today(); save(); await closeSheet(true); render(); toast('Descartado', 'Deshacer', () => { w.status = 'active'; save(); render(); }); },
  wishRestore: async el => { const w = S.wishes.find(x => x.id === el.dataset.id); w.status = 'active'; w.paid = null; save(); await closeSheet(true); render(); toast('De vuelta en la lista'); },
  wishDelete: async el => { if (!(await confirmDialog('Se eliminará este deseo.', { title: 'Eliminar', confirmText: 'Eliminar', danger: true }))) return; S.wishes = S.wishes.filter(w => w.id !== el.dataset.id); save(); await closeSheet(true); render(); },
  wishFundForm: () => wishFundForm(),
  wishHz: el => { $('#wfh').value = el.dataset.v; },
  wishFundSave: async () => {
    const err = m => { $('#wfErr').textContent = m; };
    const mo = $('#wfm').value.trim() ? C.evalAmount($('#wfm').value) : 0, hz = $('#wfh').value, adj = $('#wfa').value.trim() ? C.evalAmount($('#wfa').value) : 0;
    if (mo === null || mo < 0) return err('Revisa el presupuesto mensual.'); if (!hz) return err('Elige hasta cuándo quieres planear.'); if (adj === null) return err('Revisa el valor del ajuste.');
    const f = S.wishFund, key = C.monthKey(today());
    if (C.wishMonthly(f, key) !== mo) { f.history = (f.history || []).filter(h => h.from !== key); f.history.push({ from: key, amount: mo }); if (!f.start || f.start > key) f.start = key; }
    f.horizon = hz;
    if (adj) f.adjustments.push({ id: uid(), date: today(), amount: adj, note: $('#wfn').value.trim() || (adj > 0 ? 'Dinero extra' : 'Retiro del fondo') });
    save(); await closeSheet(true); render(); toast('Fondo actualizado');
  },
  wishCsv: () => {
    const p = C.wishPlan(S.wishFund, S.wishes, today());
    const rows = [['Prioridad', 'Deseo', 'Precio', 'Acumulado', 'Estado', 'Alcanza en', 'Por qué comprarlo', 'Por qué no', 'Condiciones', 'Link']];
    p.items.forEach(x => rows.push([['Alta', 'Media', 'Baja'][(x.w.priority || 2) - 1], x.w.name, x.w.price, x.cum, x.now ? 'Te alcanza hoy' : x.fits ? 'Te alcanza a ' + C.monthLabel(p.horizonKey) : 'No alcanza a ' + C.monthLabel(p.horizonKey), x.eta ? C.monthLabel(x.eta) : '', x.w.why || '', x.w.whyNot || '', condText(x.w), x.w.link || '']));
    S.wishes.filter(w => w.status !== 'active').forEach(w => rows.push(['', w.name, w.paid || w.price, '', w.status === 'bought' ? 'Comprado' : 'Descartado', '', w.why || '', w.whyNot || '', condText(w), w.link || '']));
    const blob = new Blob([C.toCSV(rows)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'quiero-comprar-' + today() + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  // Recurrentes
  ruleForm: el => ruleForm(el.dataset.id || el.dataset.v),
  rfKind: el => { window.RF.kind = el.dataset.v; window.RF.categoryId = ''; window.RF.subcategoryId = ''; sheets.find(x => x.id === 'rule').setBody(ruleBody()); },
  ruleSave: async () => {
    const f = window.RF, err = m => { $('#ruleErr').textContent = m; };
    const amount = C.evalAmount(f.amount);
    if (!f.name.trim()) return err('Escribe el concepto.'); if (!amount || amount <= 0) return err('Escribe el valor esperado.'); if (!accById(f.accountId)) return err('Elige una cuenta.');
    const days = String(f.daysText || '').split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= 31);
    const dates = String(f.datesText || '').split(/[,\s]+/).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (f.kind === 'expense' && (!catById(f.categoryId) || !catById(f.categoryId).subs.some(s => s.id === f.subcategoryId))) return err('Elige categoría y subcategoría del pago.');
    if (f.freq === 'monthly_days' && !days.length) return err('Escribe al menos un día del mes.');
    if (f.freq === 'dates' && !dates.length) return err('Escribe al menos una fecha válida.');
    const r = { id: f.id || uid(), kind: f.kind, name: f.name.trim(), amount, accountId: f.accountId, categoryId: f.categoryId || null, subcategoryId: f.kind === 'expense' ? (f.subcategoryId || null) : null, payer: f.payer.trim(), freq: f.freq, days, dates, startDate: f.startDate || today(), adjust: f.adjust, active: !!f.active, notes: (f.notes || '').trim(), rulesVersion: 1 };
    const i = S.rules.findIndex(x => x.id === r.id);
    if (i >= 0) { S.rules[i] = r; S.expected = S.expected.filter(x => x.ruleId !== r.id || x.status !== 'expected' || x.due < today()); } else S.rules.push(r);
    ensureExpected(); save(); await closeSheet(true); render(); toast('Regla guardada. Recibirás recordatorios en el Inicio.');
  },
  ruleDelete: async el => { if (!(await confirmDialog('Se eliminará la regla y sus próximos esperados. Los ya confirmados se conservan.', { title: 'Eliminar regla', confirmText: 'Eliminar', danger: true }))) return; S.rules = S.rules.filter(r => r.id !== el.dataset.id); S.expected = S.expected.filter(x => x.ruleId !== el.dataset.id || x.txId); save(); await closeSheet(true); render(); },
  expectedAct: el => expectedAct(el.dataset.id),
  expMove: async el => { const x = S.expected.find(e => e.id === el.dataset.id), d = $('#edd').value; if (!d) return; x.due = d; x.dueManual = true; save(); await closeSheet(true); render(); toast('Fecha actualizada'); },
  expStatus: async el => { const x = S.expected.find(e => e.id === el.dataset.id); x.status = el.dataset.v; save(); await closeSheet(true); render(); },
  expConfirm: async el => {
    const x = S.expected.find(e => e.id === el.dataset.id), v = C.evalAmount($('#ea').value), acc = $('#eacc').value;
    if (!v || v <= 0) { $('#expErr').textContent = 'Escribe el valor.'; return; }
    if (!accById(acc)) { $('#expErr').textContent = 'Elige la cuenta.'; return; }
    const tx = { id: uid(), idempotencyKey: 'exp:' + x.id + ':' + ((x.receivedAmount || 0) + v), type: x.kind === 'income' ? 'income' : 'expense', amount: v, accountId: acc, categoryId: x.categoryId, subcategoryId: x.subcategoryId || null, items: x.kind === 'expense' ? [{ name: x.name, qty: 1, unitPrice: v, total: v }] : [], nature: x.kind === 'expense' ? (catById(x.categoryId)?.defaultNature || 'other') : null, merchant: x.payer || x.name, date: $('#ed').value || today(), time: C.nowTime(), status: 'confirmed', source: 'recurring', expectedId: x.id, currency: 'COP', note: x.name + ' (esperado ' + C.formatMoney(x.amount) + ')', tags: [], createdAt: new Date().toISOString(), version: 1 };
    if (S.transactions.some(t => t.idempotencyKey === tx.idempotencyKey && !t.deletedAt)) { toast('Este pago ya estaba registrado.'); return; }
    S.transactions.push(tx);
    x.receivedAmount = (x.receivedAmount || 0) + v; x.txId = tx.id;
    x.status = x.receivedAmount >= x.amount ? (x.kind === 'income' ? 'received' : 'paid') : 'partial';
    save(); await closeSheet(true); render(); toast(x.kind === 'income' ? 'Ingreso confirmado' : 'Pago registrado');
  },

  // Categorías / personas
  categoryForm: el => categoryForm(el.dataset.id),
  cfKind: el => { window.CF.kind = el.dataset.v; sheets.find(x => x.id === 'cat').setBody(categoryBody()); },
  cfPal: el => { window.CF.palette = el.dataset.v; delete window.CF.colorHex; $$('[data-act="cfPal"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === window.CF.palette))); const p = $('#famPrev'); if (p) p.innerHTML = famPreview(window.CF); },
  cfIcon: el => { window.CF.icon = el.dataset.v; $$('[data-act="cfIcon"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === window.CF.icon))); },
  cfColor: el => { window.CF.color = el.dataset.v; $$('[data-act="cfColor"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === window.CF.color))); },
  cfSubAdd: () => { window.CF.subs.push({ id: uid(), name: '' }); sheets.find(x => x.id === 'cat').setBody(categoryBody()); },
  cfSubDel: el => { window.CF.subs.splice(Number(el.dataset.v), 1); sheets.find(x => x.id === 'cat').setBody(categoryBody()); },
  categorySave: async () => {
    const f = window.CF; if (!f.name.trim()) { $('#catErr').textContent = 'Escribe un nombre.'; return; }
    f.subs = f.subs.filter(s => s.name.trim()).map(s => Object.assign({ id: s.id, name: s.name.trim() }, s.color ? { color: s.color } : {}));
    if (f.id) { const i = S.categories.findIndex(c => c.id === f.id); S.categories[i] = Object.assign(S.categories[i], f, { name: f.name.trim() }); }
    else S.categories.push(Object.assign(f, { id: uid(), name: f.name.trim(), order: S.categories.length }));
    save(); await closeSheet(true); render();
  },
  catMove: el => { const c = catById(el.dataset.id), list = S.categories.filter(x => x.kind === c.kind).sort((a, b) => a.order - b.order); const i = list.indexOf(c), j = i + Number(el.dataset.v); if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; list.forEach((x, k) => { x.order = k; }); save(); render(); },
  personForm: el => personForm(el.dataset.id),
  personSave: async el => {
    const n = $('#pn1').value.trim(); if (!n) { $('#perErr').textContent = 'Escribe un nombre.'; return; }
    const old = personById(el.dataset.id);
    const p = Object.assign(old || { id: uid(), createdAt: new Date().toISOString() }, { name: n, alias: $('#pa1').value.trim(), group: $('#pg1').value.trim(), notes: $('#pno1').value.trim(), archived: old ? $('#par1').checked : false });
    if (!old) S.people.push(p);
    save(); await closeSheet(true); render();
  },

  // Seguridad
  securitySheet: () => securitySheet(),
  pinSave: async () => {
    const a = $('#pin1').value, b = $('#pin2').value;
    if (!/^\d{4,6}$/.test(a)) { $('#pinErr').textContent = 'El PIN debe tener entre 4 y 6 números.'; return; }
    if (a !== b) { $('#pinErr').textContent = 'Los PIN no coinciden.'; return; }
    if (/^(\d)\1+$/.test(a) || '0123456789'.includes(a) || '9876543210'.includes(a)) { $('#pinErr').textContent = 'Evita PIN obvios (1111, 1234…).'; return; }
    if (S.settings.pin && !(await reauth('Confirma tu PIN actual para cambiarlo.'))) return;
    const h = await C.hashPin(a);
    S.settings.pin = { hash: h.hash, salt: h.salt, len: a.length, setAt: new Date().toISOString() };
    audit('security.pin_changed', 'security', null, 'PIN configurado o cambiado'); save();
    await closeSheet(true); securitySheet(); toast('PIN guardado');
  },
  passkeyAdd: async () => { if (await passkeyRegister()) { await closeSheet(true); securitySheet(); } },
  passkeyRemove: async () => { if (!(await reauth('Confirma para quitar el desbloqueo del dispositivo.'))) return; S.settings.passkey = null; audit('security.passkey_removed', 'security', null, 'Passkey eliminada'); save(); await closeSheet(true); securitySheet(); },
  quickAcc: el => {
    const inst = el.dataset.v;
    const ex = S.accounts.find(a => inst === 'Efectivo' ? a.type === 'cash' : a.institution === inst);
    if (ex) { if (!S.transactions.some(t => t.accountId === ex.id || t.toAccountId === ex.id)) S.accounts = S.accounts.filter(a => a !== ex); }
    else S.accounts.push({ id: uid(), name: inst, type: inst === 'Efectivo' ? 'cash' : ['Nequi', 'DaviPlata', 'Dale!', 'RappiPay'].includes(inst) ? 'wallet' : 'bank', institution: inst === 'Efectivo' ? '' : inst, last4: '', color: COLORS[S.accounts.length % COLORS.length], icon: '', initialBalance: 0, notes: '', currency: 'COP', archived: false, createdAt: new Date().toISOString() });
    save(); el.setAttribute('aria-pressed', String(!ex)); render();
  },
  onbFinish: async () => {
    const a = $('#pin1').value, b = $('#pin2').value, e = $('#pinErr');
    if (!/^\d{4,6}$/.test(a)) { e.textContent = 'El PIN debe tener entre 4 y 6 números.'; return; }
    if (a !== b) { e.textContent = 'Los PIN no coinciden.'; return; }
    if (/^(\d)\1+$/.test(a) || '0123456789'.includes(a) || '9876543210'.includes(a)) { e.textContent = 'Evita PIN obvios (1111, 1234…).'; return; }
    const h = await C.hashPin(a);
    S.settings.pin = { hash: h.hash, salt: h.salt, len: a.length, setAt: new Date().toISOString() }; S.settings.onboarded = true;
    audit('security.pin_changed', 'security', null, 'PIN creado en la configuración inicial'); save();
    await closeSheet(true); render();
    if (window.PublicKeyCredential && await confirmDialog('Puedes desbloquear con Face ID, Touch ID o huella en lugar del PIN. WalletWeb nunca recibe tus datos biométricos.', { title: '¿Activar desbloqueo del dispositivo?', confirmText: 'Activar', cancelText: 'Ahora no' })) passkeyRegister();
  },

  // Datos
  backupSheet: () => backupSheet(), genKey: () => genKey(), backupCreate: () => backupCreate(),
  restoreSheet: () => restoreSheet(), restoreRun: () => restoreRun(),
  exportCSV: () => exportCSV(), exportAudit: () => exportAudit(),
  importSheet: () => importSheet(), importRun: () => importRun(),
  wipeAll: () => wipeAll(), loadDemo: () => { loadDemoData(); save(); render(); },
  restoreTx: el => { const t = txById(el.dataset.id); t.deletedAt = null; if (t.type === 'collect' && t.refTxId) { const src = txById(t.refTxId); const p = src?.split?.parts.find(x => x.personId === t.personId); if (p) p.collected = (p.collected || 0) + t.amount; } audit('transaction.restored', 'transaction', t.id, 'Movimiento restaurado de la papelera'); save(); render(); toast('Movimiento restaurado'); },
  emptyTrash: async () => {
    const del = S.transactions.filter(t => t.deletedAt);
    if (!(await confirmDialog(`Se eliminarán definitivamente ${del.length} movimiento(s) y sus comprobantes locales.`, { title: 'Vaciar papelera', confirmText: 'Vaciar', danger: true }))) return;
    for (const t of del) if (t.receipt) { await Store.del('rcpt:' + t.id); await Store.del('rcptthumb:' + t.id); }
    S.transactions = S.transactions.filter(t => !t.deletedAt);
    audit('trash.emptied', 'transaction', null, `Papelera vaciada (${del.length})`); save(); render();
  },
  toggleWorkday: el => { const w = S.settings.holidayEx.workdays, d = el.dataset.v, i = w.indexOf(d); if (i >= 0) w.splice(i, 1); else w.push(d); recomputeExpected(); save(); render(); },
  removeHoliday: el => { S.settings.holidayEx.extraHolidays = S.settings.holidayEx.extraHolidays.filter(h => h.date !== el.dataset.v); recomputeExpected(); save(); render(); },
  addHoliday: () => { const d = $('#hDate').value, n = $('#hName').value.trim() || 'Festivo manual'; if (!d) { toast('Elige una fecha.'); return; } S.settings.holidayEx.extraHolidays.push({ date: d, name: n }); recomputeExpected(); save(); render(); }
};
function recomputeExpected() {
  for (const x of S.expected) { if (x.status !== 'expected' || x.dueManual) continue; const r = S.rules.find(y => y.id === x.ruleId); if (!r) continue; const o = C.occurrences({ ...r, startDate: x.nominal }, x.nominal, x.nominal, S.settings.holidayEx)[0]; if (o) x.due = o.due; }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act];
  if (fn) { e.preventDefault(); fn(t, e); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.actChange) {
    const name = t.dataset.actChange;
    if (name === 'receiptPick') receiptPick(t);
    if (name === 'splitToggle') { D.splitOn = t.checked; rerenderTx(); }
    if (name === 'splitGift') { D.gifts[t.dataset.v] = t.checked; updateTxLive(); persistDraft(); }
    if (name === 'restoreFile') restoreFileChosen(t);
    if (name === 'importFile') importFileChosen(t);
    if (name === 'wallPick') wallPick(t);
    if (name === 'tabsPick') { // si la pantalla ya estaba en otro botón, se intercambian
      const i = Number(t.dataset.i), j = TE.indexOf(t.value); if (j >= 0 && j !== i) TE[j] = TE[i]; TE[i] = t.value;
      sheets.find(x => x.id === 'tabs').setBody(tabsBody());
    }
    return;
  }
  if (t.dataset.bind) {
    const [scope, key] = t.dataset.bind.split('.');
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (['lockMinutes', 'warnPct'].includes(key)) v = Number(v);
    if (scope === 'ui') { ui[key] = v; ui.movLimit = 60; render(); }
    else if (key) { S.settings[key] = v; save(); if (key === 'privacy') applyPrivacy(); if (!sheets.length) render(); }
    return;
  }
  if (t.dataset.rerender !== undefined) {
    if (t.dataset.f && D) { if (t.value === '__new') { t.value = D[t.dataset.f] || ''; accountForm(null, t.dataset.f); return; } D[t.dataset.f] = t.value; if (t.dataset.f === 'accountId' && D.toAccountId === D.accountId) D.toAccountId = ''; rerenderTx(); }
    if (t.dataset.bf) { window.BF[t.dataset.bf] = t.value; if (t.dataset.bf === 'scope') window.BF.ref = ''; sheets.find(x => x.id === 'bud').setBody(budgetBody()); }
    if (t.dataset.rf) { window.RF[t.dataset.rf] = t.value; if (t.dataset.rf === 'categoryId') window.RF.subcategoryId = ''; sheets.find(x => x.id === 'rule').setBody(ruleBody()); }
  }
  if (t.dataset.af === 'institution' && t.value === '__new') {
    openSheet({ id: 'inst', title: 'Nueva institución', body: `<div class="field"><label for="instN2">Nombre</label><input id="instN2" class="input" autocomplete="off"></div>`, footer: `<button class="btn primary" data-act="instSave">Agregar</button>` });
  }
  if (t.dataset.rf === 'active') window.RF.active = t.checked;
  if (t.dataset.cf === 'archived') window.CF.archived = t.checked;
});
ACT.instSave = async () => { const n = $('#instN2').value.trim(); if (!n) return; if (!S.institutions.includes(n)) S.institutions.push(n); AF.institution = n; save(); await closeSheet(true); sheets.find(x => x.id === 'acc').setBody(accountBody()); };
let qTimer = null;
// En cantidad y precio, al tocar se selecciona el número para reemplazarlo de una vez
document.addEventListener('focusin', e => { const t = e.target; if (t.classList?.contains('num') && t.classList.contains('it-in') || t.classList?.contains('db-val')) setTimeout(() => { try { t.select(); } catch (er) { /* */ } }, 0); });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'movQ') { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.movQ = t.value; ui.movLimit = 60; const pos = t.selectionStart; render(); const n = $('#movQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* */ } } }, 220); return; }
  if (t.dataset.it !== undefined && D) {
    const i = Number(t.dataset.it), k = t.dataset.itk;
    if (k === 'qty') { const clean = t.value.replace(/\D/g, '').slice(0, 5); if (clean !== t.value) t.value = clean; }
    D.items[i][k] = k === 'name' ? t.value.replace(/\n/g, ' ') : t.value;
    if (k === 'name') fitName(t);
    const tot = itemTotal(D.items[i]); const c = $('#itTot' + i); if (c) c.textContent = tot !== null ? C.formatMoney(tot) : '—';
    const s = $('#itSum'); if (s) s.textContent = C.formatMoney(itemsSum());
    persistDraft(); return;
  }
  if (t.dataset.cr !== undefined && D) { D.customRows[Number(t.dataset.cr)][t.dataset.crk] = t.value; persistDraft(); return; }
  if (t.classList?.contains('db-text')) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  if (t.dataset.f && D && t.dataset.rerender === undefined) {
    const f = t.dataset.f;
    if (f.startsWith('part:')) D.customParts[f.slice(5)] = t.value; else D[f] = t.value;
    if (f === 'mapsUrl') D._autoMaps = false;
    if (D.ocrFilled && D.ocrFilled[f === 'amountText' ? 'amount' : f]) { delete D.ocrFilled[f === 'amountText' ? 'amount' : f]; const inp = t; inp.classList.remove('ocr-filled'); (inp.closest('.db-row') || inp.closest('.field'))?.querySelector('.ocr-tag')?.remove(); }
    updateTxLive(); persistDraft(); return;
  }
  if (t.dataset.af && AF && t.dataset.af !== 'institution') { AF[t.dataset.af] = t.value; return; }
  if (t.dataset.af === 'institution' && AF && t.value !== '__new') { AF.institution = t.value; return; }
  if (t.dataset.lf && LF) { LF[t.dataset.lf] = t.value; const p = $('#loanPrev'); if (p) p.innerHTML = loanPreviewHTML(); return; }
  if (t.dataset.bf && window.BF && t.dataset.rerender === undefined) { window.BF[t.dataset.bf] = t.value; return; }
  if (t.dataset.rf && window.RF && t.type !== 'checkbox' && t.dataset.rerender === undefined) { window.RF[t.dataset.rf] = t.value; return; }
  if (t.dataset.cf && window.CF && t.type !== 'checkbox') { window.CF[t.dataset.cf] = t.value; return; }
  if (t.dataset.cfsub !== undefined && window.CF) { window.CF.subs[Number(t.dataset.cfsub)].name = t.value; return; }
  if (t.dataset.live === 'payPrev') payPreview(t.dataset.id);
  if (t.dataset.glass) {
    const k = t.dataset.glass, v = Number(t.value);
    S.settings.glass = Object.assign({}, GLASS_DEFAULT, S.settings.glass, { [k]: v });
    applyGlass(); save();
    t.style.setProperty('--p', ((v - Number(t.min)) / (Number(t.max) - Number(t.min)) * 100).toFixed(1) + '%');
    const o = document.getElementById('out-' + k); if (o) o.textContent = v + t.dataset.unit;
  }
});
document.addEventListener('keydown', e => {
  if (locked && !$('#lock').hidden) { if (/^\d$/.test(e.key)) { pinKey(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { pinKey('del'); e.preventDefault(); } return; }
  if (e.target.dataset?.it !== undefined && e.key === 'Enter') { e.preventDefault(); const i = Number(e.target.dataset.it), order = ['name', 'qty', 'unit'], k = order.indexOf(e.target.dataset.itk); if (k < 2) $(`[data-it="${i}"][data-itk="${order[k + 1]}"]`)?.focus(); else if (i === D.items.length - 1) ACT.itemAdd(); else $(`[data-it="${i + 1}"][data-itk="name"]`)?.focus(); return; }
  if (e.target.id === 'mapQ' && e.key === 'Enter') { e.preventDefault(); mapSearch(); return; }
  if (e.target.id === 'newSubName' && e.key === 'Enter') { e.preventDefault(); ACT.subAdd(); return; }
  if ((e.target.id === 'newPersonTag' || e.target.id === 'newPersonGroup') && e.key === 'Enter') { e.preventDefault(); ACT.pAdd(); return; }
  if (e.key === 'Escape' && sheets.length) { closeSheet(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' && !sheets.length) { e.preventDefault(); openTxForm(); }
  if (e.key === '/' && !sheets.length) { e.preventDefault(); go('movimientos'); setTimeout(() => $('#movQ')?.focus(), 30); }
});
window.addEventListener('popstate', () => { const r = location.hash.slice(1); route = VIEWS[r] ? r : 'inicio'; closeAllSheets(); render(); });

/* ================= Fondo de pantalla ================= */
async function wallPick(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (f.size > 25 * 1024 * 1024) { toast('La imagen supera 25 MB.'); return; }
  try {
    const url = URL.createObjectURL(f);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82)); // re-codificar elimina metadatos (GPS)
    await Store.set('wallpaper', blob);
    if (wallUrl) URL.revokeObjectURL(wallUrl); wallUrl = null;
    S.settings.glass = Object.assign({}, GLASS_DEFAULT, S.settings.glass, { wallpaper: 'photo' });
    await applyGlass(); save(); render(); toast('Fondo actualizado');
  } catch (e) { toast('No se pudo leer la imagen.'); }
}

/* ================= Copias cifradas ================= */
function backupSheet() {
  openSheet({ id: 'bk', title: 'Copia de seguridad cifrada', body: `
    <p class="muted" style="margin-top:0">Genera un archivo cifrado con todos tus datos. Guárdalo en Archivos, Google Drive o donde prefieras. Sin la contraseña no se puede abrir: no hay forma de recuperarla.</p>
    <div class="field"><label for="bp1">Contraseña de la copia (mínimo 10 caracteres)</label><input id="bp1" class="input" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="bp2">Repetir contraseña</label><input id="bp2" class="input" type="password" autocomplete="new-password"></div>
    <button class="btn block" data-act="genKey">Generar clave de recuperación</button><div id="genOut" class="card flat" hidden style="margin-top:10px;font-family:ui-monospace,monospace;font-size:17px;text-align:center;word-break:break-all"></div>
    ${sw('bkReceipts', true, 'Incluir comprobantes', 'Hace el archivo más pesado')}
    <div id="bkErr" class="err" role="alert"></div>
    <p class="hint">Formato: JSON con AES-256-GCM, sal aleatoria de 16 bytes, nonce de 12 bytes y PBKDF2-SHA256 (600.000 iteraciones). Documentado en el README.</p>`,
    footer: `<button class="btn primary" data-act="backupCreate">${ic('shield', 'sm')} Crear copia</button>` });
}
function genKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(24));
  const k = Array.from(r, b => A[b % A.length]).join('').match(/.{4}/g).join('-');
  $('#bp1').value = k; $('#bp2').value = k; $('#bp1').type = 'text';
  const o = $('#genOut'); o.hidden = false; o.innerHTML = esc(k) + `<button class="btn block" style="margin-top:10px" data-act="copyKey">${ic('copy', 'sm')} Copiar</button><div class="hint">Guárdala en tu gestor de contraseñas. No se almacena en la app.</div>`;
}
ACT.copyKey = async () => { try { await navigator.clipboard.writeText($('#bp1').value); toast('Clave copiada'); } catch (e) { toast('Cópiala manualmente.'); } };
async function snapshotForBackup(includeReceipts) {
  const data = JSON.parse(JSON.stringify(S));
  data.settings.passkey = null; data.draft = null;
  const receipts = {};
  if (includeReceipts) for (const t of S.transactions) if (t.receipt) { const b = await Store.get('rcpt:' + t.id); if (b) receipts[t.id] = { type: b.type, data: C.b64(new Uint8Array(await b.arrayBuffer())) }; }
  return { app: 'WalletWeb', appVersion: APP_VERSION, schema: S.schema, exportedAt: new Date().toISOString(), state: data, receipts,
    manifest: S.transactions.filter(t => t.receipt).map(t => ({ txId: t.id, name: t.receipt.name, hash: t.receipt.hash, size: t.receipt.size, included: !!receipts[t.id] })) };
}
async function backupCreate() {
  const a = $('#bp1').value, b = $('#bp2').value, err = m => { $('#bkErr').textContent = m; };
  if (a.length < 10) return err('Usa al menos 10 caracteres.'); if (a !== b) return err('Las contraseñas no coinciden.');
  const inc = $('[data-bind="bkReceipts"]').checked;
  if (!(await reauth('Desbloquea para exportar todos tus datos.'))) return;
  toast('Cifrando…', null, null, 1500);
  const file = await C.encryptBackup(await snapshotForBackup(inc), a);
  const name = 'walletweb-copia-' + today().replace(/-/g, '') + '.json';
  const ok = await deliverFile(name, 'application/json', JSON.stringify(file));
  if (ok) { S.settings.lastBackupAt = new Date().toISOString(); audit('data.backup', 'data', null, 'Copia cifrada exportada' + (inc ? ' con comprobantes' : '')); save(); await closeSheet(true); render(); toast('Copia creada. Guárdala en un lugar seguro.'); }
}
let RESTORE = null;
function restoreSheet() {
  RESTORE = null;
  openSheet({ id: 'rs', title: 'Restaurar copia', body: `<p class="muted" style="margin-top:0">Reemplaza <b>todos</b> los datos de este dispositivo por los de la copia. Antes de aplicar se guarda automáticamente una copia local de lo que tienes ahora.</p>
    <div class="field"><label class="btn block" style="cursor:pointer">${ic('upload', 'sm')} Elegir archivo de copia<input type="file" accept=".json,application/json" data-act-change="restoreFile" class="sr-only"></label><p class="hint" id="rsName"></p></div>
    <div class="field"><label for="rp">Contraseña de la copia</label><input id="rp" class="input" type="password" autocomplete="off"></div>
    <div id="rsPrev"></div><div id="rsErr" class="err" role="alert"></div>`, footer: `<button class="btn primary" data-act="restoreRun">Verificar copia</button>` });
}
async function restoreFileChosen(input) {
  const f = input.files[0]; if (!f) return;
  if (f.size > 200 * 1024 * 1024) { $('#rsErr').textContent = 'Archivo demasiado grande.'; return; }
  try { RESTORE = { file: JSON.parse(await readFileAs(f, 'text')) }; $('#rsName').textContent = f.name; $('#rsErr').textContent = ''; }
  catch (e) { $('#rsErr').textContent = 'El archivo no es una copia válida.'; }
}
async function restoreRun() {
  const err = m => { $('#rsErr').textContent = m; };
  if (!RESTORE?.file) return err('Elige el archivo.');
  if (!RESTORE.data) {
    try { RESTORE.data = await C.decryptBackup(RESTORE.file, $('#rp').value); }
    catch (e) { return err(e.message); }
    const st = RESTORE.data.state;
    if (!st || !Array.isArray(st.transactions) || !Array.isArray(st.accounts)) { RESTORE.data = null; return err('La copia no tiene el formato esperado.'); }
    const odd = C.unsafeStateFields(st);
    if (odd.length) { RESTORE.data = null; return err('La copia tiene datos con un formato no válido y no se restauró (posible archivo alterado): ' + odd.slice(0, 3).join(', ')); }
    $('#rsPrev').innerHTML = `<div class="card"><b>Integridad verificada</b><dl class="kv" style="margin-top:8px"><dt>Creada</dt><dd>${esc(fdt(RESTORE.data.exportedAt))}</dd><dt>Versión</dt><dd>${esc(RESTORE.data.appVersion)} · esquema ${esc(st.schema)}</dd><dt>Movimientos</dt><dd>${st.transactions.length}</dd><dt>Cuentas</dt><dd>${st.accounts.length}</dd><dt>Préstamos</dt><dd>${st.loans.length}</dd><dt>Comprobantes incluidos</dt><dd>${Object.keys(RESTORE.data.receipts || {}).length}</dd></dl></div>`;
    topSheet().setFooter(`<button class="btn danger" data-act="restoreRun">Reemplazar mis datos</button><button class="btn" data-act="closeSheet">Cancelar</button>`);
    return;
  }
  if (!(await confirmDialog('Tus datos actuales se reemplazarán por los de la copia. Se guardará antes una copia local de seguridad.', { title: 'Restaurar copia', confirmText: 'Restaurar', danger: true }))) return;
  if (!(await reauth('Desbloquea para restaurar una copia completa.'))) return;
  await Store.set('snapshot:pre-restore', { at: new Date().toISOString(), state: JSON.parse(JSON.stringify(S)) });
  const keepSecurity = { pin: S.settings.pin, passkey: S.settings.passkey };
  const next = migrate(RESTORE.data.state);
  if (keepSecurity.pin) next.settings.pin = keepSecurity.pin;
  next.settings.passkey = keepSecurity.passkey; next.settings.onboarded = true;
  if (typeof driveKeepOnRestore === 'function') driveKeepOnRestore(next);
  for (const [id, r] of Object.entries(RESTORE.data.receipts || {})) await Store.set('rcpt:' + id, new Blob([C.unb64(r.data)], { type: r.type }));
  const ids = new Set(next.audit.map(a => a.id));
  next.audit = next.audit.concat(S.audit.filter(a => !ids.has(a.id))).sort((a, b) => b.at.localeCompare(a.at));
  S = next;
  audit('data.restore', 'data', null, `Copia restaurada (${S.transactions.length} movimientos, creada ${fdt(RESTORE.data.exportedAt)})`);
  await Store.set(stateKey(), JSON.parse(JSON.stringify(S)));
  RESTORE = null; closeAllSheets(); ensureExpected(); applyTheme(); render(); toast('Copia restaurada');
}

/* ================= Exportar / importar CSV ================= */
async function exportCSV() {
  if (!(await reauth('Desbloquea para exportar tus movimientos.'))) return;
  const rows = [['Fecha', 'Hora', 'Tipo', 'Importe', 'Moneda', 'Cuenta', 'Cuenta destino', 'Categoría', 'Subcategoría', 'Naturaleza', 'Comercio', 'Etiquetas', 'Personas', 'Gasto personal', 'Ítems', 'Referencia', 'Google Maps', 'Página web', 'Estado', 'Fuente', 'Nota', 'ID']];
  for (const t of S.transactions.filter(x => !x.deletedAt).sort((a, b) => a.date.localeCompare(b.date))) {
    const c = catById(t.categoryId);
    rows.push([t.date, t.time || '', TYPES[t.type], t.amount, C.CUR.code, accById(t.accountId)?.name || '', accById(t.toAccountId)?.name || '', c?.name || '', c?.subs.find(s => s.id === t.subcategoryId)?.name || '', NATURES[t.nature] || '', t.merchant || '', (t.tags || []).join('; '),
      [...new Set([...(t.people || []), ...(t.split?.parts || []).map(p => p.personId), ...(t.personId ? [t.personId] : [])])].map(personName).join('; '), t.type === 'expense' ? C.personalAmount(t) : '', (t.items || []).map(it => `${it.qty} x ${it.name} @ ${it.unitPrice} = ${it.total}`).join('; '), t.reference || '', t.mapsUrl || '', t.productUrl || '', STATUS[t.status], SOURCES[t.source] || t.source || '', t.note || '', t.id]);
  }
  if (await deliverFile('walletweb-movimientos-' + today().replace(/-/g, '') + '.csv', 'text/csv', C.toCSV(rows))) { audit('data.export_csv', 'data', null, `CSV exportado (${rows.length - 1} movimientos)`); save(); }
}
async function exportAudit() {
  const rows = [['Fecha', 'Acción', 'Detalle', 'Dispositivo']].concat(S.audit.map(a => [a.at, a.action, a.detail, a.device]));
  await deliverFile('walletweb-auditoria.csv', 'text/csv', C.toCSV(rows));
}
let IMP = null;
function importSheet() {
  IMP = { rows: null, header: 0, map: {}, fmt: 'DMY', sign: 'positive_expense', accountId: activeAccounts()[0]?.id || '', pending: false, includeDup: false };
  openSheet({ id: 'imp', title: 'Importar movimientos', body: importBody(), footer: '' });
}
function importBody() {
  if (!IMP.rows) return `<p class="muted" style="margin-top:0">Importa un archivo <b>.csv</b>. Desde Excel: Archivo → Guardar como → <i>CSV UTF-8</i>. Nada se guarda hasta que confirmes. Las fórmulas, macros y enlaces nunca se ejecutan. Los gastos sin subcategoría reconocida o sin tienda entran como <b>por revisar</b> para que los completes.</p>
    <label class="btn block" style="cursor:pointer">${ic('upload', 'sm')} Elegir archivo CSV<input type="file" accept=".csv,text/csv,.txt" data-act-change="importFile" class="sr-only"></label><div id="impErr" class="err" role="alert"></div>`;
  const hdr = IMP.rows[IMP.header] || [];
  const cols = hdr.map((h, k) => [String(k), (h || 'Columna ' + (k + 1)).slice(0, 30)]);
  const fieldSel = (k, label, opt) => `<div class="field"><label>${label}</label><select class="input" data-imp="${k}">${optionList(cols, IMP.map[k], opt ? '— No usar —' : 'Elegir…')}</select></div>`;
  const prev = importPreview();
  return `<div class="field"><label>Fila de encabezados</label><select class="input" data-imp="header">${optionList(IMP.rows.slice(0, 6).map((r, k) => [String(k), (k + 1) + ': ' + r.slice(0, 3).join(' | ').slice(0, 40)]), String(IMP.header))}</select></div>
    <div class="grid2">${fieldSel('date', 'Fecha')}${fieldSel('amount', 'Importe')}${fieldSel('desc', 'Descripción / comercio', true)}${fieldSel('category', 'Categoría', true)}</div>
    <div class="grid2"><div class="field"><label>Formato de fecha</label><select class="input" data-imp="fmt">${optionList([['DMY', 'Día/Mes/Año'], ['MDY', 'Mes/Día/Año']], IMP.fmt)}</select></div>
      <div class="field"><label>Signo del importe</label><select class="input" data-imp="sign">${optionList([['positive_expense', 'Todos son gastos'], ['negative_expense', 'Negativo = gasto, positivo = ingreso']], IMP.sign)}</select></div></div>
    <div class="field"><label>Cuenta</label><select class="input" data-imp="accountId">${optionList(activeAccounts().map(a => [a.id, a.name]), IMP.accountId)}</select></div>
    <div class="toggle-row"><span style="font-weight:600">Importar como "por revisar"</span><label class="switch"><input type="checkbox" data-imp="pending" ${IMP.pending ? 'checked' : ''} aria-label="Importar como por revisar"><span></span></label></div>
    <div class="toggle-row"><span style="font-weight:600">Incluir posibles duplicados</span><label class="switch"><input type="checkbox" data-imp="includeDup" ${IMP.includeDup ? 'checked' : ''} aria-label="Incluir posibles duplicados"><span></span></label></div>
    ${prev.html}<div id="impErr" class="err" role="alert"></div>`;
}
function importParsed() {
  const out = [];
  if (IMP.map.date === undefined || IMP.map.amount === undefined || IMP.map.date === '' || IMP.map.amount === '') return out;
  for (let k = IMP.header + 1; k < IMP.rows.length; k++) {
    const r = IMP.rows[k];
    const date = C.parseDateFlexible(r[IMP.map.date], IMP.fmt);
    let raw = String(r[IMP.map.amount] || '').trim(), neg = /^-|^\(.*\)$/.test(raw);
    raw = raw.replace(/^[-(]|\)$/g, '').replace(/[$\s]|COP/gi, '');
    const amt = C.evalAmount(raw);
    const desc = IMP.map.desc !== undefined && IMP.map.desc !== '' ? String(r[IMP.map.desc] || '').trim().slice(0, 120) : '';
    const catName = IMP.map.category !== undefined && IMP.map.category !== '' ? String(r[IMP.map.category] || '').trim() : '';
    const type = IMP.sign === 'negative_expense' ? (neg ? 'expense' : 'income') : 'expense';
    const errMsg = !date ? 'Fecha inválida' : (!amt || amt <= 0) ? 'Importe inválido' : null;
    const cand = { amount: amt, date, merchant: desc, accountId: IMP.accountId };
    const dup = !errMsg && S.transactions.find(t => !t.deletedAt && C.duplicateScore(cand, t) >= 85);
    out.push({ row: k + 1, date, amount: amt, desc, catName, type, error: errMsg, dup });
  }
  return out;
}
function importPreview() {
  const rows = importParsed();
  if (!rows.length) return { html: '<p class="hint">Elige al menos las columnas de fecha e importe para ver la vista previa.</p>', rows };
  const ok = rows.filter(r => !r.error && (!r.dup || IMP.includeDup));
  return { rows, html: `<div class="card" style="padding:8px 12px"><table class="sched"><thead><tr><th>Fila</th><th>Fecha</th><th>Descripción</th><th>Importe</th></tr></thead><tbody>
    ${rows.slice(0, 15).map(r => `<tr><td>${r.row}</td><td>${esc(r.date || '—')}</td><td style="text-align:left">${esc(r.desc)}${r.error ? ` <span class="pill bad">${esc(r.error)}</span>` : r.dup ? ' <span class="pill warn">Posible duplicado</span>' : ''}</td><td class="amt">${r.amount ? esc((r.type === 'income' ? '+' : '') + C.formatMoney(r.amount)) : '—'}</td></tr>`).join('')}</tbody></table>
    ${rows.length > 15 ? `<p class="hint">…y ${rows.length - 15} filas más.</p>` : ''}</div>
    <p class="small"><b>${ok.length}</b> filas se importarán · ${rows.filter(r => r.error).length} con error · ${rows.filter(r => r.dup && !r.error).length} posibles duplicados</p>` };
}
async function importFileChosen(input) {
  const f = input.files[0]; if (!f) return;
  if (/\.xlsx?$/i.test(f.name)) { $('#impErr').textContent = 'Guarda tu Excel como CSV UTF-8 e impórtalo de nuevo.'; return; }
  if (f.size > 10 * 1024 * 1024) { $('#impErr').textContent = 'Archivo demasiado grande (máx. 10 MB).'; return; }
  const parsed = C.parseCSV(await readFileAs(f, 'text'));
  if (parsed.rows.length < 2) { $('#impErr').textContent = 'El archivo no tiene filas.'; return; }
  IMP.rows = parsed.rows.slice(0, 20000); IMP.fileName = f.name;
  const h = IMP.rows[0].map(x => String(x).toLowerCase());
  const find = re => { const i = h.findIndex(x => re.test(x)); return i >= 0 ? String(i) : undefined; };
  IMP.map = { date: find(/fecha|date/), amount: find(/importe|valor|monto|amount|total/), desc: find(/desc|comercio|concepto|detalle|merchant/), category: find(/categor/) };
  refreshImport();
}
function refreshImport() { const s = sheets.find(x => x.id === 'imp'); if (!s) return; s.setBody(importBody()); s.setFooter(IMP.rows ? `<button class="btn primary" data-act="importRun">Importar</button>` : ''); }
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset.imp || !IMP) return;
  const k = t.dataset.imp;
  if (t.type === 'checkbox') IMP[k] = t.checked; else if (k === 'header') IMP.header = Number(t.value); else if (['fmt', 'sign', 'accountId'].includes(k)) IMP[k] = t.value; else IMP.map[k] = t.value;
  refreshImport();
});
async function importRun() {
  const rows = importParsed().filter(r => !r.error && (!r.dup || IMP.includeDup));
  if (!rows.length) { $('#impErr').textContent = 'No hay filas válidas para importar.'; return; }
  if (!accById(IMP.accountId)) { $('#impErr').textContent = 'Elige una cuenta.'; return; }
  if (!(await confirmDialog(`Se crearán ${rows.length} movimientos en ${accById(IMP.accountId).name}.`, { title: 'Confirmar importación', confirmText: 'Importar' }))) return;
  const jobId = uid(), now = new Date().toISOString(), byName = {}, bySub = {};
  S.categories.forEach(c => { byName[c.name.toLowerCase()] = c.id; c.subs.forEach(s => { bySub[s.name.toLowerCase()] = [c.id, s.id]; }); });
  const created = rows.map(r => ({ id: uid(), idempotencyKey: 'imp:' + jobId + ':' + r.row, importJobId: jobId, type: r.type, amount: r.amount, accountId: IMP.accountId, items: r.type === 'expense' && r.desc ? [{ name: r.desc.slice(0, 80), qty: 1, unitPrice: r.amount, total: r.amount }] : [], categoryId: byName[r.catName.toLowerCase()] || bySub[r.catName.toLowerCase()]?.[0] || null, subcategoryId: bySub[r.catName.toLowerCase()]?.[1] || null, nature: r.type === 'expense' ? (catById(byName[r.catName.toLowerCase()] || bySub[r.catName.toLowerCase()]?.[0])?.defaultNature || 'other') : null, merchant: r.desc, date: r.date, time: '', status: IMP.pending || (r.type === 'expense' && (!bySub[r.catName.toLowerCase()] || !r.desc)) ? 'pending' : 'confirmed', source: 'csv', currency: 'COP', note: '', tags: [], createdAt: now, version: 1 }));
  S.transactions.push(...created);
  audit('data.import', 'import', jobId, `Importación CSV "${IMP.fileName}": ${created.length} creados, ${importParsed().length - created.length} omitidos`);
  save(); closeAllSheets(); render(); toast(`${created.length} movimientos importados`);
}

/* ================= Borrado total ================= */
// Borra solo los datos del perfil actual (estado, instantáneas, comprobantes y copia espejo)
async function clearProfileData(id = PROFILE.id, txs = S.transactions) {
  clearTimeout(saveTimer);
  const keys = (await Store.keys()) || [], ids = new Set(txs.map(t => t.id));
  for (const k of keys) { const ks = String(k); if (ks === stateKey(id) || ks.startsWith(snapPrefix(id)) || ((ks.startsWith('rcpt:') || ks.startsWith('rcptthumb:')) && ids.has(ks.split(':')[1]))) await Store.del(k); }
  try { localStorage.removeItem(mirrorKey(id)); } catch (e) { /* */ }
}
async function wipeAll() {
  const sum = `${S.transactions.length} movimientos, ${S.accounts.length} cuentas, ${S.loans.length} préstamos y la auditoría. Las copias que exportaste no se ven afectadas.`;
  if (!(await reauth('Desbloquea para borrar todos los datos.'))) return;
  if (!(await confirmDialog('Se eliminará de este dispositivo: ' + sum, { title: 'Borrar todos los datos', confirmText: 'Borrar todo', danger: true, typed: 'BORRAR TODO' }))) return;
  await clearProfileData();
  try { sessionStorage.clear(); } catch (e) { /* */ }
  location.hash = ''; location.reload();
}
async function wipeDemo() {
  if (!(await confirmDialog('Se borrarán los datos de demostración para empezar con tus datos reales.', { title: 'Empezar de cero', confirmText: 'Borrar demo', danger: true }))) return;
  const keep = S.settings; await clearProfileData(); S = defaultState(); S.settings.theme = keep.theme;
  setBanner(''); save(); render();
  if (!IN_FRAME) onboarding();
}

/* ================= Datos de demostración (ficticios) ================= */
function loadDemoData() {
  S = defaultState(); S.demo = true; S.settings.onboarded = !IN_FRAME ? false : true;
  const mk = (name, type, inst, color, init) => { const a = { id: uid(), name, type, institution: inst, last4: type === 'credit' ? '4821' : '', color, icon: '', initialBalance: init, notes: '', currency: 'COP', archived: false, createdAt: new Date().toISOString() }; S.accounts.push(a); return a; };
  const nequi = mk('Nequi', 'wallet', 'Nequi', '#7A5BA6', 180000), banco = mk('Bancolombia Ahorros', 'bank', 'Bancolombia', '#D99A2B', 1500000), card = mk('Tarjeta RappiPay', 'credit', 'RappiPay', '#C8553D', 0);
  const P = n => { const p = { id: uid(), name: n, alias: '', group: 'Amigos', notes: '', archived: false, createdAt: new Date().toISOString() }; S.people.push(p); return p; };
  const camilo = P('Camilo'), laura = P('Laura'), andres = P('Andrés');
  const fam = ['Mamá', 'Papá', 'Sofía'].map(n => { const p = P(n); p.group = 'Familia'; return p.id; });
  laura.group = 'Pareja';
  const pick = n => { for (const c of S.categories) { if (c.name === n) return { categoryId: c.id, subcategoryId: null }; const s = c.subs.find(x => x.name === n); if (s) return { categoryId: c.id, subcategoryId: s.id }; } return { categoryId: null, subcategoryId: null }; };
  const cat = n => pick(n).categoryId;
  const t = today(), mk0 = C.monthKey(t);
  const add = (o) => { if (o.type === 'expense' && !o.items) o.items = [{ name: o.note || subName({ categoryId: o.categoryId, subcategoryId: o.subcategoryId }) || 'Compra', qty: 1, unitPrice: o.amount, total: o.amount }];
  const tx = Object.assign({ id: uid(), idempotencyKey: uid(), status: 'confirmed', source: 'manual', currency: 'COP', tags: [], note: '', time: '12:30', createdAt: new Date().toISOString(), version: 1 }, o); if (tx.type === 'expense') tx.nature = catById(tx.categoryId)?.defaultNature || 'other'; S.transactions.push(tx); };
  const salary = S.categories.find(c => c.name === 'Salario');
  const rule = { id: uid(), kind: 'income', name: 'Salario', amount: 2400000, accountId: banco.id, categoryId: salary.id, payer: 'Empresa S.A.S.', freq: 'monthly_days', days: [15, 30], dates: [], startDate: C.addMonthsKey(mk0, -3) + '-01', adjust: 'prev', active: true, notes: '' };
  S.rules.push(rule);
  ensureExpected();
  // Confirmar salarios pasados
  for (const x of S.expected.filter(x => x.due <= t && x.due >= C.addDays(t, -62))) {
    const id = uid(); add({ id, type: 'income', amount: 2400000, accountId: banco.id, categoryId: salary.id, merchant: 'Empresa S.A.S.', date: x.due, source: 'recurring', expectedId: x.id });
    x.status = 'received'; x.receivedAmount = 2400000; x.txId = id;
  }
  const seed = [['Mercado', 'Éxito', 186400, 'need'], ['Restaurantes', 'Crepes & Waffles', 92000, 'fun'], ['Transporte', 'Uber', 18500, 'need'], ['Suscripciones', 'Spotify', 16900, 'fun'], ['Servicios', 'Enel Codensa', 98700, 'need'],
    ['Mercado', 'D1', 54300, 'need'], ['Cine y salidas', 'Cine Colombia', 46000, 'fun'], ['Transporte', 'Recarga TuLlave', 50000, 'need'], ['Restaurantes', 'Rappi', 38900, 'fun'], ['Salud', 'Farmatodo', 27800, 'need'], ['Compras', 'Falabella', 129900, 'other'], ['Hogar', 'Homecenter', 64500, 'need']];
  for (let m = 2; m >= 0; m--) {
    const key = C.addMonthsKey(mk0, -m), [y, mo] = key.split('-').map(Number), lim = m === 0 ? C.parts(t).d : C.daysInMonth(y, mo);
    seed.forEach(([c, merch, amt, nat], k) => {
      const day = Math.max(1, Math.min(lim, 1 + Math.floor((k * 2.3 + m * 1.7) % lim)));
      if (m === 0 && day > lim) return;
      add({ type: 'expense', amount: Math.round(amt * (1 + ((k + m) % 3 - 1) * 0.12) / 100) * 100, accountId: k % 3 === 0 ? card.id : k % 3 === 1 ? nequi.id : banco.id, ...pick(c), nature: nat, merchant: merch, date: C.iso(y, mo, day), paymentMethod: k % 3 === 0 ? 'card' : 'qr', mapsUrl: ['Éxito', 'D1', 'Crepes & Waffles', 'Farmatodo'].includes(merch) ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(merch + ' Bogotá') : '' });
    });
  }
  // Etiquetas de personas en algunos gastos
  S.transactions.filter(x => x.type === 'expense').forEach((x, k) => {
    if (subName(x) === 'Restaurantes' || subName(x) === 'Cine y salidas') x.people = k % 2 ? [laura.id] : fam.slice();
    else if (subName(x) === 'Mercado' && k % 2) x.people = fam.slice();
  });
  const d1 = C.addDays(t, -6);
  add({ type: 'expense', amount: 200000, accountId: banco.id, ...pick('Restaurantes'), nature: 'fun', merchant: 'Andrés Carne de Res', date: d1, note: 'Cena de cumpleaños', people: [camilo.id, laura.id, andres.id],
    split: { mode: 'equal', myShare: 50000, parts: [{ personId: camilo.id, amount: 50000, gift: false, collected: 50000 }, { personId: laura.id, amount: 50000, gift: false, collected: 0 }, { personId: andres.id, amount: 50000, gift: false, collected: 0 }] } });
  const shared = S.transactions[S.transactions.length - 1];
  add({ type: 'collect', amount: 50000, accountId: nequi.id, personId: camilo.id, refTxId: shared.id, date: C.addDays(t, -5), source: 'receivable', note: 'Cobro: Andrés Carne de Res' });
  add({ type: 'expense', amount: 1890000, accountId: card.id, ...pick('Compras'), nature: 'fun', merchant: 'Ktronix', date: C.addDays(t, -20), installments: { n: 6, firstMonth: C.addMonthsKey(C.monthKey(C.addDays(t, -20)), 1), interestBp: 0 }, note: 'Celular a 6 cuotas' });
  add({ type: 'transfer', amount: 300000, accountId: banco.id, toAccountId: nequi.id, date: C.addDays(t, -3) });
  add({ type: 'expense', items: [], amount: 25900, accountId: card.id, categoryId: null, merchant: 'EXITO CALLE 80', date: t, status: 'pending', source: 'paste', note: 'Compraste $25.900 en EXITO CALLE 80' });
  // Préstamos
  const loan = { id: uid(), direction: 'given', personId: camilo.id, principal: 1000000, rateBp: 200, interestMode: 'simple', termMonths: 5, installments: 5, firstDue: C.addMonthsISO(C.addDays(t, -75), 1), accountId: banco.id, startDate: C.addDays(t, -75), note: 'Para el arreglo de la moto', payments: [], createdAt: new Date().toISOString(), statusOverride: null };
  S.loans.push(loan);
  add({ type: 'loan_out', amount: 1000000, accountId: banco.id, personId: camilo.id, loanId: loan.id, date: loan.startDate, source: 'loan' });
  const a1 = C.allocatePayment(loan, 220000), ptx = uid();
  add({ id: ptx, type: 'repay_in', amount: 220000, interest: a1.interest, capital: a1.capital, accountId: nequi.id, personId: camilo.id, loanId: loan.id, date: C.addDays(t, -42), source: 'loan' });
  loan.payments.push({ id: uid(), date: C.addDays(t, -42), amount: 220000, interest: a1.interest, capital: a1.capital, accountId: nequi.id, txId: ptx });
  const loan2 = { id: uid(), direction: 'received', personId: laura.id, principal: 500000, rateBp: 0, interestMode: 'none', termMonths: 2, installments: 2, firstDue: C.addDays(t, 9), accountId: nequi.id, startDate: C.addDays(t, -21), note: '', payments: [], createdAt: new Date().toISOString(), statusOverride: null };
  S.loans.push(loan2);
  add({ type: 'loan_in', amount: 500000, accountId: nequi.id, personId: laura.id, loanId: loan2.id, date: loan2.startDate, source: 'loan' });
  S.budgets.push({ id: uid(), name: 'Global', scope: 'global', ref: null, method: 'fixed', value: 2200000, period: 'month', archived: false },
    { id: uid(), name: 'Entretenimiento', scope: 'category', ref: cat('Entretenimiento'), method: 'fixed', value: 260000, period: 'month', archived: false },
    { id: uid(), name: 'Mercado', scope: 'subcategory', ref: pick('Mercado').subcategoryId, method: 'pctExpected', value: 6, period: 'month', archived: false });
  S.wishFund = { start: C.addMonthsKey(C.monthKey(t), -4), history: [{ from: C.addMonthsKey(C.monthKey(t), -4), amount: 250000 }], adjustments: [], horizon: (t.slice(5, 7) === '12' ? Number(t.slice(0, 4)) + 1 : t.slice(0, 4)) + '-12-31' };
  const wish = (name, price, priority, extra) => S.wishes.push(Object.assign({ id: uid(), name, price, link: '', priority, order: S.wishes.length, why: '', whyNot: '', cond: { text: '', price: null, cuotas: null }, status: 'active', paid: null, fromFund: true, createdAt: new Date().toISOString() }, extra || {}));
  wish('Audífonos con cancelación de ruido', 650000, 1, { why: 'Trabajo desde casa y hay mucho ruido\nLos actuales ya fallan', whyNot: 'Los actuales todavía sirven', cond: { text: 'Esperar el Black Friday', price: 550000, cuotas: null }, link: 'https://www.ejemplo.com/audifonos' });
  wish('Silla ergonómica', 900000, 2, { why: 'Dolor de espalda', whyNot: 'Ocupa espacio', cond: { text: '', price: null, cuotas: 12 } });
  wish('Bicicleta de ruta', 2800000, 3, { why: 'Salir los domingos', whyNot: 'Es cara y casi no tengo tiempo' });
  wish('Libro de finanzas', 85000, 1, { status: 'bought', paid: 79000 });
  audit('demo.loaded', 'data', null, 'Datos de demostración cargados');
}

/* ================= Inicio ================= */
function migrateCategoriesV2(st) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const NAT_PARENT = { need: 'need', fun: 'fun', invest: 'invest', loan: 'loan', tax: 'need', other: 'need' };
  const oldExp = st.categories.filter(c => c.kind === 'expense');
  const parents = {};
  EXPENSE_CATS.forEach(([name, icon, nat], k) => {
    const ex = oldExp.find(c => norm(c.name) === norm(name));
    parents[nat] = { id: ex?.id || uid(), name, icon, color: COLORS[k % COLORS.length], kind: 'expense', defaultNature: nat, subs: ex ? ex.subs.slice() : [], archived: false, order: k };
  });
  const parentIds = new Set(Object.values(parents).map(p => p.id));
  const map = {}; // id de categoría vieja -> { categoryId, subcategoryId, subs }
  for (const c of oldExp) {
    if (parentIds.has(c.id)) { map[c.id] = { categoryId: c.id, subcategoryId: null, subs: {} }; continue; }
    const p = parents[NAT_PARENT[c.defaultNature] || 'need'];
    p.subs.push({ id: c.id, name: c.name });
    const subs = {};
    for (const s of c.subs || []) { p.subs.push({ id: s.id, name: c.name + ' · ' + s.name }); subs[s.id] = s.id; }
    map[c.id] = { categoryId: p.id, subcategoryId: c.id, subs };
  }
  const remap = o => { const r = map[o.categoryId]; if (!r) return; const sub = o.subcategoryId && r.subs[o.subcategoryId] ? o.subcategoryId : r.subcategoryId; o.categoryId = r.categoryId; o.subcategoryId = sub || (o.subcategoryId && parentIds.has(r.categoryId) && r.subcategoryId === null ? o.subcategoryId : null); };
  for (const t of st.transactions) { remap(t); if (t.type === 'expense') t.nature = Object.values(parents).find(p => p.id === t.categoryId)?.defaultNature || t.nature || 'other'; }
  for (const r of st.rules) remap(r);
  for (const x of st.expected) remap(x);
  for (const b of st.budgets) {
    if (b.scope === 'category' && map[b.ref]) { const r = map[b.ref]; if (r.subcategoryId) { b.scope = 'subcategory'; b.ref = r.subcategoryId; } else b.ref = r.categoryId; }
    else if (b.scope === 'nature' && parents[NAT_PARENT[b.ref]]) { b.scope = 'category'; b.ref = parents[NAT_PARENT[b.ref]].id; }
  }
  st.categories = [...Object.values(parents), ...st.categories.filter(c => c.kind !== 'expense').map((c, k) => Object.assign(c, { order: 10 + k }))];
  const pr = parents.loan; if (!pr.subs.length) pr.subs = ['Familia', 'Amigos', 'Otros'].map(n => ({ id: uid(), name: n }));
  st.schema = 3;
}
// v4: las "metas" (cada una con su aporte) pasan a ser deseos con un solo fondo mensual
function migrateGoalsToWishes(st) {
  const goals = st.goals || [], key = C.monthKey(today());
  if (!goals.length) return;
  let saved = 0, monthly = 0;
  goals.forEach((g, i) => {
    const contrib = C.sum((g.contributions || []).map(c => c.amount));
    if (g.status === 'active') { saved += contrib; monthly += g.monthly || 0; }
    st.wishes.push({ id: g.id || uid(), name: g.name, price: g.target || 0, link: g.link || '', priority: Math.min(3, Math.max(1, g.priority || 2)), order: i,
      why: [g.description, g.notes].filter(Boolean).join('\n'), whyNot: '', cond: { text: '', price: null, cuotas: null },
      status: g.status === 'bought' ? 'bought' : g.status === 'active' ? 'active' : 'discarded', paid: g.status === 'bought' ? g.target : null, fromFund: false,
      createdAt: g.createdAt || new Date().toISOString() });
  });
  if (saved) st.wishFund.adjustments.push({ id: uid(), date: today(), amount: saved, note: 'Ahorrado en las metas anteriores' });
  if (monthly) st.wishFund.history.push({ from: key, amount: monthly });
  st.goals = [];
}
function migrate(st) {
  const base = defaultState();
  const out = Object.assign(base, st);
  out.settings = Object.assign(defaultState().settings, st.settings || {});
  out.settings.glass = Object.assign({}, GLASS_DEFAULT, out.settings.glass || {});
  out.settings.holidayEx = Object.assign({ extraHolidays: [], workdays: [] }, out.settings.holidayEx || {});
  for (const c of out.categories || []) if (!ICONS[c.icon]) c.icon = EMOJI_TO_ICON[c.icon] || 'tag';
  if ((out.schema || 1) < 3 && (out.schema || 1) >= 2) { const pr = out.categories.find(c => c.kind === 'expense' && c.defaultNature === 'loan'); if (pr && !pr.subs.length) pr.subs = ['Familia', 'Amigos', 'Otros'].map(n => ({ id: uid(), name: n })); out.schema = 3; }
  if ((out.schema || 1) < 2) { migrateCategoriesV2(out); audit && setTimeout(() => { audit('data.migrated', 'data', null, 'Categorías de gasto reorganizadas en Necesario, Entretenimiento, Inversión y Préstamo'); save(); }, 0); }
  for (const k of ['accounts', 'categories', 'people', 'transactions', 'budgets', 'goals', 'wishes', 'loans', 'rules', 'expected', 'audit', 'institutions', 'charts']) if (!Array.isArray(out[k])) out[k] = base[k];
  if (!out.wishFund || typeof out.wishFund !== 'object') out.wishFund = defaultWishFund();
  out.wishFund = Object.assign(defaultWishFund(), out.wishFund);
  if ((out.schema || 1) < 4) { migrateGoalsToWishes(out); out.schema = 4; }
  if (out.schema < 5) out.schema = 5; // v1.20: gráficos propios (S.charts) y filtros de los del Inicio
  assignPalettes(out.categories); if (out.schema < 6) out.schema = 6; // v1.23: familia de color por categoría
  if (!out.driveFiles || typeof out.driveFiles !== 'object' || Array.isArray(out.driveFiles)) out.driveFiles = {};
  if (out.schema < 7) out.schema = 7; // v1.33: facturas en Google Drive (S.settings.drive y S.driveFiles)
  if (out.schema < 8) out.schema = 8; // v1.37: vigencia de presupuestos (fromMonth/untilMonth; sin ellos aplica siempre, como antes)
  return out;
}
async function purgeTrash() {
  const cutoff = Date.now() - 30 * 86400000;
  const old = S.transactions.filter(t => t.deletedAt && Date.parse(t.deletedAt) < cutoff);
  if (!old.length) return;
  for (const t of old) if (t.receipt) { await Store.del('rcpt:' + t.id); await Store.del('rcptthumb:' + t.id); }
  S.transactions = S.transactions.filter(t => !old.includes(t));
  audit('trash.purged', 'transaction', null, `${old.length} movimiento(s) eliminados definitivamente tras 30 días`); save();
}
async function dailySnapshot() {
  if (!Store.ok || S.demo) return;
  const key = snapPrefix() + today();
  const keys = (await Store.keys()) || [];
  if (!keys.includes(key) && S.transactions.length) await Store.set(key, JSON.parse(JSON.stringify(S)));
  const snaps = keys.filter(k => String(k).startsWith(snapPrefix())).sort();
  for (const k of snaps.slice(0, Math.max(0, snaps.length - 7))) await Store.del(k);
}
const afterUnlock = [];
const _baseUnlock = unlock;
unlock = function () { _baseUnlock(); afterUnlock.splice(0).forEach(f => { try { f(); } catch (e) { /* */ } }); };
function handleUrlParams() {
  let q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (![...q.keys()].length) return;
  const imp = q.get('importe'), txt = q.get('texto');
  const over = { source: 'shortcut', status: 'confirmed', type: q.get('tipo') === 'ingreso' ? 'income' : 'expense', amountText: imp ? String(C.evalAmount(imp) || '') : '', merchant: (q.get('comercio') || '').slice(0, 80), note: (q.get('nota') || txt || '').slice(0, 280) };
  const f = q.get('fecha'); if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) over.date = f;
  if (txt && !imp) { const r = C.parsePastedText(txt); if (r.amount) over.amountText = String(r.amount); if (r.merchant && !over.merchant) over.merchant = r.merchant; }
  history.replaceState(null, '', location.pathname + location.hash); // no dejar datos en la URL
  const run = () => openTxForm(over);
  if (locked) afterUnlock.push(run); else run();
}
async function loadState() {
  await Store.open();
  let read = { ok: false };
  if (!PROFILES_FROM_LS && Store.ok) { const pr = await Store.getStrict('profiles'); if (pr.ok && pr.value) { PROFILES = normProfiles(pr.value); PROFILE = PROFILES.list.find(x => x.id === PROFILES.active); C.setCurrency(PROFILE.currency); saveProfiles(); } }
  for (let i = 0; i < 3 && Store.ok; i++) { read = await Store.getStrict(stateKey()); if (read.ok) break; await new Promise(r => setTimeout(r, 250 * (i + 1))); }
  const mirror = readMirror();
  const newer = (a, b) => (a?.savedAt || '') >= (b?.savedAt || '') ? a : b;
  if (read.ok && read.value) return { st: mirror ? newer(read.value, mirror) : read.value };
  if (mirror) return { st: mirror, recovered: true };
  if (read.ok) return { st: null }; // de verdad no hay datos: primera vez
  // No se pudo leer: probar la instantánea diaria más reciente
  if (Store.ok) { const keys = ((await Store.keys()) || []).filter(k => String(k).startsWith(snapPrefix())).sort(); if (keys.length) { const s2 = await Store.getStrict(keys.pop()); if (s2.ok && s2.value) return { st: s2.value, recovered: true }; } }
  return { st: null, failed: true };
}
function renderLoadError() {
  Store.readOnly = true;
  $('#view').innerHTML = `<div class="card" style="margin-top:20px">${emptyState('alert', 'No pudimos abrir tus datos', 'El iPhone no entregó la base de datos a tiempo. Tus datos no se han tocado: vuelve a intentarlo.', '<button class="btn primary" data-act="reloadApp">Reintentar</button>')}</div>`;
}
ACT.reloadApp = () => location.reload(); // sin onclick en línea: la CSP (script-src 'self') lo bloquearía
async function init() {
  const ld = await loadState();
  if (ld.failed && !IN_FRAME) { applyTheme(); renderLoadError(); return; }
  if (ld.st) S = migrate(ld.st);
  else if (IN_FRAME || PROFILE.demo) { loadDemoData(); if (PROFILE.demo && !IN_FRAME) { S.settings.onboarded = true; save(); } }
  if (PROFILE.demo) { S.demo = true; S.settings.onboarded = true; }
  if (ld.recovered) { save(); setTimeout(() => toast('Recuperamos tus datos de la copia de seguridad interna.'), 600); }
  if (!Store.ok) setBanner('Este navegador no permite guardar datos. Lo que registres se perderá al cerrar.', null, null);
  applyTheme();
  if (hasLock()) { locked = true; renderLock('Introduce tu PIN para continuar'); }
  await purgeTrash();
  ensureExpected();
  const r = location.hash.slice(1); route = VIEWS[r] ? r : 'inicio';
  try { history.scrollRestoration = 'manual'; } catch (e) { /* */ }
  render(); window.scrollTo(0, 0);
  if (!hasLock() && !S.settings.onboarded && !IN_FRAME && !S.demo) onboarding();
  else if (S.demo && !IN_FRAME && !S.settings.pin && !S.settings.onboarded) onboarding();
  handleUrlParams();
  dailySnapshot();
  if (typeof driveBoot === 'function') driveBoot();
  try { if (navigator.storage?.persist) navigator.storage.persist(); } catch (e) { /* */ }
  if (!IN_FRAME && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* la app funciona igual sin SW */ });
  }
}
// Los archivos que se cargan después de este (gráficos, efectos, préstamos, colores, perfiles, Drive) deben estar listos antes de
// dibujar: si la base de datos abría más rápido que el navegador cargaba esos archivos, el Inicio fallaba y se veía "sin datos".
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();

// Mantener presionada la barra inferior abre el editor del menú
(() => {
  let timer = null, sx = 0, sy = 0;
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#tabbar') || sheets.length) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { timer = null; if (navigator.vibrate) navigator.vibrate(10); window.__tabLP = Date.now(); tabsEditor(); }, 600);
  });
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  document.addEventListener('pointerup', cancel); document.addEventListener('pointercancel', cancel);
  document.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  // tras la pulsación larga no se sigue el enlace del botón
  document.addEventListener('click', e => { if (window.__tabLP && Date.now() - window.__tabLP < 800 && e.target.closest('#tabbar')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  document.addEventListener('contextmenu', e => { if (e.target.closest('#tabbar')) e.preventDefault(); });
})();
