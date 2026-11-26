/* WalletWeb — formularios y hojas de detalle. */
'use strict';

/* ================= Nuevo / editar movimiento ================= */
let D = null; // borrador activo
const DRAFT_KEYS = ['id', 'items', 'rows', 'customRows', 'people', 'type', 'amountText', 'accountId', 'toAccountId', 'categoryId', 'subcategoryId', 'nature', 'merchant', 'date', 'time', 'note', 'tagsText', 'status', 'source', 'splitOn', 'splitMode', 'splitPeople', 'gifts', 'customParts', 'instN', 'firstMonth', 'tip', 'tax', 'discount', 'shipping', 'location', 'mapsUrl', 'productUrl', 'paymentMethod', 'reference'];
const stripD = d => Object.fromEntries(DRAFT_KEYS.map(k => [k, d[k]]));
function newDraft(over) {
  const lastExp = S.transactions.filter(t => !t.deletedAt && t.type === 'expense').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).pop();
  const accs = activeAccounts();
  return Object.assign({ id: null, type: 'expense', amountText: '', accountId: (lastExp && accById(lastExp.accountId) && !accById(lastExp.accountId).archived ? lastExp.accountId : accs[0]?.id) || '', toAccountId: '', categoryId: '', subcategoryId: '', nature: '',
    merchant: '', date: today(), time: C.nowTime(), note: '', tagsText: '', status: 'confirmed', source: 'manual', more: false, splitOn: false, splitMode: 'equal', splitPeople: [], gifts: {}, customParts: {},
    items: [{ name: '', qty: '', unit: '' }], rows: ['tax', 'discount', 'tip', 'shipping'], customRows: [], people: [], newSubOpen: false, newPersonOpen: false, instN: 1, firstMonth: C.addMonthsKey(thisMonth(), 1), tip: '', tax: '', discount: '', shipping: '', location: '', mapsUrl: '', productUrl: '', paymentMethod: '', reference: '', receiptBlob: null, receiptMeta: null }, over || {});
}
function draftFromTx(t) {
  const d = newDraft({ id: t.id, type: t.type, amountText: String(t.amount), accountId: t.accountId, toAccountId: t.toAccountId || '', categoryId: t.categoryId || '', subcategoryId: t.subcategoryId || '', nature: t.nature || '',
    merchant: t.merchant || '', date: t.date, time: t.time || '', note: t.note || '', tagsText: (t.tags || []).join(', '), status: t.status, source: t.source || 'manual',
    instN: t.installments?.n || 1, firstMonth: t.installments?.firstMonth || C.addMonthsKey(C.monthKey(t.date), 1), tip: t.extras?.tip ? String(t.extras.tip) : '', tax: t.extras?.tax ? String(t.extras.tax) : '',
    discount: t.extras?.discount ? String(t.extras.discount) : '', shipping: t.extras?.shipping ? String(t.extras.shipping) : '', location: t.location || '', mapsUrl: t.type === 'expense' ? (t.mapsUrl || t.productUrl || '') : (t.mapsUrl || ''), productUrl: t.type === 'expense' ? (t.mapsUrl && t.productUrl ? t.productUrl : '') : (t.productUrl || ''), paymentMethod: t.paymentMethod || '', reference: t.reference || '' });
  d.people = (t.people || []).slice();
  d.customRows = (t.extras?.custom || []).map(c => ({ label: c.label, value: String(c.amount) }));
  d.items = (t.items || []).map(it => ({ name: it.name, qty: String(it.qty), unit: Number(it.unitPrice).toLocaleString('es-CO') }));
  if (!d.items.length) d.items = [{ name: '', qty: '', unit: '' }];
  if (t.split?.parts?.length) {
    d.splitOn = true; d.splitPeople = t.split.parts.map(p => p.personId); d.splitMode = t.split.mode || 'custom';
    t.split.parts.forEach(p => { d.customParts[p.personId] = String(p.amount); d.gifts[p.personId] = !!p.gift; });
  }
  d.more = !!(t.note || t.tags?.length || t.extras || t.location || t.receipt);
  return d;
}
function openTxForm(over, fromTx) {
  if (fromTx) D = draftFromTx(fromTx);
  else if (S.draft && !over) { D = newDraft(S.draft); toast('Recuperamos el borrador que dejaste sin guardar.', 'Descartar', () => { S.draft = null; save(); closeAllSheets(); openTxForm(); }); }
  else D = newDraft(over);
  D._orig = fromTx ? JSON.stringify(stripD(D)) : JSON.stringify(stripD(newDraft()));
  openSheet({ id: 'tx', title: fromTx ? 'Editar movimiento' : 'Nuevo movimiento', body: txFormBody(), footer: txFooter(),
    dirty: () => D && JSON.stringify(stripD(D)) !== D._orig, onClose: () => { if (D && !D.id) { S.draft = null; save(); } D = null; } });
  updateTxLive();
}
function txFooter() { return `<button class="btn primary" data-act="txSave">${ic('check', 'sm')} ${D.id ? 'Guardar cambios' : 'Guardar'}</button>`; }
function rerenderTx() { const s = sheets.find(x => x.id === 'tx'); if (s) { s.setBody(txFormBody()); updateTxLive(); loadThumb(); const n = $('#note.db-text'); if (n) { n.style.height = 'auto'; n.style.height = n.scrollHeight + 'px'; } $$('.it-name').forEach(fitName); } persistDraft(); }
function persistDraft() { if (D && !D.id) { S.draft = stripD(D); save(); } }
function txFormBody() {
  const d = D, accs = activeAccounts();
  const kind = d.type === 'income' ? 'income' : 'expense';
  const cat = catById(d.categoryId);
  const acc = accById(d.accountId);
  const merchants = [...new Set(S.transactions.filter(t => t.merchant).map(t => t.merchant))].slice(-200);
  const accOpts = (val, exclude) => `<option value="">Elegir…</option>${accs.filter(a => a.id !== exclude || a.id === val).map(a => `<option value="${a.id}" ${a.id === val ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="__new">+ Nueva cuenta…</option>`;
  const refField = `<div class="field"><label for="refIn">Referencia de pago</label><input id="refIn" class="input" data-f="reference" value="${esc(d.reference)}" placeholder="Nº de aprobación" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>`;
  const withCat = d.type === 'expense' || d.type === 'income';
  const accBlock = `<div class="grid2 acc-ref"><div class="field"><label for="accSel">Cuenta</label><select id="accSel" class="input" data-f="accountId" data-rerender>${accOpts(d.accountId, null)}</select></div>${refField}</div><p class="hint" id="refHint" style="margin:-8px 4px 12px"></p>`;
  return `
    ${seg('Tipo de movimiento', [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']], ['expense', 'income', 'transfer'].includes(d.type) ? d.type : '', 'dtype')}
    ${!['expense', 'income', 'transfer'].includes(d.type) ? `<p class="hint">Tipo: <b>${esc(TYPES[d.type])}</b> (creado desde ${esc(SOURCES[d.source] || d.source)}).</p>` : ''}
    <div class="amount-wrap">
      <label for="amt" class="sr-only">Importe</label>
      <input id="amt" class="amount-input" data-f="amountText" inputmode="decimal" autocomplete="off" placeholder="$ 0" value="${esc(d.amountText)}" data-autofocus aria-describedby="amtPrev">
      <div class="amount-preview" id="amtPrev" aria-live="polite"></div>
      <div class="ops" aria-label="Operaciones">${[['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']].map(([o, l]) => `<button type="button" data-act="op" data-v="${o}" aria-label="Operador ${l}">${l}</button>`).join('')}<button type="button" data-act="pasteSheet" aria-label="Pegar texto de una notificación" style="width:auto;padding:0 12px;font-size:14px">${ic('paste', 'sm')}</button></div>
    </div>
    <div class="field"><span class="lbl">Fecha</span><div style="display:flex;gap:8px;align-items:center"><button type="button" class="chip" data-act="dset" data-k="date" data-v="${today()}" aria-pressed="${d.date === today()}">Hoy</button><button type="button" class="chip" data-act="dset" data-k="date" data-v="${C.addDays(today(), -1)}" aria-pressed="${d.date === C.addDays(today(), -1)}">Ayer</button><input type="date" class="input${d.ocrFilled?.date ? ' ocr-filled' : ''}" data-f="date" value="${esc(d.date)}" aria-label="Fecha" style="flex:1;min-width:0"></div>${d.ocrFilled?.date ? '<p class="hint" style="margin:6px 4px 0">Fecha leída de la factura <span class="ocr-tag">foto</span></p>' : ''}</div>
    ${d.type === 'transfer'
      ? `<div class="grid2"><div class="field"><label for="accFrom">Desde</label><select id="accFrom" class="input" data-f="accountId" data-rerender>${accOpts(d.accountId, null)}</select></div><div class="field"><label for="accTo">Hacia</label><select id="accTo" class="input" data-f="toAccountId" data-rerender>${accOpts(d.toAccountId, d.accountId)}</select></div></div>${refField}<p class="hint" id="refHint" style="margin:-8px 4px 12px"></p>`
      : withCat ? '' : accBlock}
    ${d.type === 'expense' || d.type === 'income' ? `<div class="field"><span class="lbl">Categoría</span><div class="cat-grid ${kind === 'expense' ? 'cat-main' : ''}">${loanIncomeButton()}${cats(kind).map(c => `<button type="button" class="cat-btn" style="--cc:${catColor(c)}" data-act="dcat" data-v="${c.id}" aria-pressed="${d.categoryId === c.id}"><span class="e" aria-hidden="true">${ic(ICONS[c.icon] ? c.icon : 'tag')}</span>${esc(c.name)}</button>`).join('')}</div>
      ${d.type === 'expense' ? subPicker(cat) : (cat && cat.subs.length ? `<div class="lbl muted small" style="margin:12px 4px 6px;font-weight:650">Subcategoría (opcional)</div><div class="chips">${cat.subs.filter(s => !s.archived).map(s => `<button type="button" class="chip" data-act="dset" data-k="subcategoryId" data-v="${s.id}" aria-pressed="${d.subcategoryId === s.id}">${esc(s.name)}</button>`).join('')}</div>` : '')}${loanIncomeBlock()}</div>
      ${accBlock}
      ${d.type === 'income'
        ? `<div class="field"><label for="merch">Pagador o entidad</label><input id="merch" class="input" data-f="merchant" value="${esc(d.merchant)}" list="merchList" autocomplete="off" placeholder="Ej. Empresa"><datalist id="merchList">${merchants.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>`
        : `<div class="field"><label for="merch">Tienda <span class="muted" style="font-weight:500">(opcional)</span>${d.ocrFilled?.merchant ? ' <span class="ocr-tag" title="Leído de la foto">foto</span>' : ''}</label><input id="merch" class="input${d.ocrFilled?.merchant ? ' ocr-filled' : ''}" data-f="merchant" value="${esc(d.merchant)}" list="merchList" autocomplete="off" placeholder="Ej. Éxito Calle 80"><datalist id="merchList">${merchants.map(m => `<option value="${esc(m)}">`).join('')}</datalist></div>
      <div class="field"><label for="mapsIn">Link <span class="muted" style="font-weight:500">(opcional · Google Maps o página del artículo)</span></label>
        <input id="mapsIn" class="input" data-f="mapsUrl" value="${esc(d.mapsUrl)}" placeholder="https://…" inputmode="url" autocomplete="off" spellcheck="false">
        <div class="link-tools">
          <button type="button" class="btn" data-act="mapPicker">${ic('pin', 'sm')} Mapa</button>
          <a class="btn" id="gmapsBtn" href="${esc(gmapsSearchUrl(d.merchant, d.location))}" target="_blank" rel="noopener noreferrer">Google Maps</a>
          <button type="button" class="btn" data-act="linkPaste">${ic('paste', 'sm')} Pegar</button>
        </div>
        <p class="hint" id="mapsHint"></p></div>`}` : ''}
    ${d.type === 'expense' || d.type === 'income' ? peoplePicker() : ''}
    ${receiptBlock()}
    <div class="sec-title">${d.type === 'expense' ? 'Detalle de la compra' : 'Detalle'}</div>
      ${detailBox()}
    ${d.type === 'expense' ? '<div class="sec-title">Pago</div>' : ''}
    ${d.type === 'expense' ? splitSection() : ''}
    ${d.type === 'expense' && acc?.type === 'credit' ? instField() : ''}
      <div class="sub-h">Otros datos</div>
      ${d.type !== 'expense' || d.productUrl ? `<div class="field"><label for="purl">${d.type === 'expense' ? 'Otro enlace' : 'Enlace del producto o sitio'}</label><input id="purl" class="input" data-f="productUrl" value="${esc(d.productUrl)}" inputmode="url" placeholder="https://…" autocomplete="off"></div>` : ''}
      ${d.type === 'expense' && acc?.type !== 'credit' ? instField() : ''}
      <div class="field"><span class="lbl">Estado</span>${seg('Estado', [['confirmed', 'Confirmado'], ['pending', 'Por revisar'], ['draft', 'Borrador']], d.status, 'dstatus')}</div>
    <div id="txErr" class="err" role="alert"></div>`;
}
function isLendDraft() { return !!(D && D.type === 'expense' && !D.id && catById(D.categoryId)?.defaultNature === 'loan'); }
function lendExtras() {
  const d = D;
  return `<div class="grid2"><div class="field"><label for="lendN">Cuotas</label><select id="lendN" class="input" data-f="lendN">${optionList([1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24].map(n => [String(n), n === 1 ? '1 (un solo pago)' : n + ' cuotas']), String(d.lendN || '1'))}</select></div>
    <div class="field"><label for="lendDue">${Number(d.lendN || 1) > 1 ? 'Primera cuota' : 'Te paga el'}</label><input id="lendDue" type="date" class="input" data-f="lendDue" value="${esc(d.lendDue || C.addMonthsISO(d.date || today(), 1))}"></div></div>
    <p class="hint" style="margin-top:-4px">Sin interés. Si quieres cobrar interés, regístralo desde Préstamos → Registrar dinero prestado.</p>`;
}
function peoplePicker() {
  const d = D, loanOnly = d.type === 'income' && d.loanMode && !d.id, lend = isLendDraft();
  if (lend && d.people.length > 1) d.people = [d.people[d.people.length - 1]];
  const debtors = loanOnly ? new Set(activeGivenLoans().map(x => x.l.personId)) : null;
  const active = S.people.filter(p => !p.archived && (!loanOnly || debtors.has(p.id) || d.people.includes(p.id)));
  const groups = {};
  active.forEach(p => { if (p.group) (groups[p.group] = groups[p.group] || []).push(p.id); });
  const groupChips = loanOnly || lend ? '' : Object.entries(groups).filter(([, ids]) => ids.length >= 2).map(([g, ids]) => {
    const all = ids.every(id => d.people.includes(id));
    return `<button type="button" class="chip" data-act="pgroup" data-v="${esc(g)}" aria-pressed="${all}">${ic('users', 'sm')} ${esc(g)} · ${ids.length}</button>`;
  }).join('');
  const groupsList = [...new Set(S.people.map(p => p.group).filter(Boolean))];
  return `${lend ? '<div class="lend-box">' : ''}<div class="field"><span class="lbl">${lend ? '¿A quién le prestas? <span class="muted" style="font-weight:500">(elige una persona)</span>' : 'Personas <span class="muted" style="font-weight:500">(opcional)</span>'}</span>
    <div class="chips wrap" role="group" aria-label="Personas">${groupChips}${active.map(p => `<button type="button" class="chip" data-act="ptoggle" data-v="${p.id}" aria-pressed="${d.people.includes(p.id)}">${esc(p.name)}</button>`).join('')}
      ${d.newPersonOpen || loanOnly ? '' : `<button type="button" class="chip" data-act="pNew">${ic('plus', 'sm')} Nueva</button>`}</div>
    ${d.newPersonOpen ? `<div class="grid2" style="margin-top:4px"><input id="newPersonTag" class="input" placeholder="Nombre (ej. Mi novia)" autocomplete="off" maxlength="40" style="min-height:44px"><input id="newPersonGroup" class="input" placeholder="Grupo (opcional)" list="groupList" autocomplete="off" maxlength="30" style="min-height:44px"></div><datalist id="groupList">${groupsList.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="btn-row" style="margin-top:8px"><button type="button" class="btn primary" data-act="pAdd" style="min-height:44px">Agregar persona</button><button type="button" class="btn" data-act="pCancel" style="min-height:44px">Cancelar</button></div>` : ''}
    <p class="hint">${lend ? 'Se registra como préstamo en Préstamos → Me deben, no como gasto.' : loanOnly ? 'Solo aparecen las personas que te deben. Toca a quien te está pagando.' : d.type === 'income' ? 'De quién recibiste el dinero.' : 'Con quién o en quién gastaste. Si eliges varias, el gasto se reparte entre ellas en el resumen.'}${Object.keys(groups).length ? '' : ' Ponles un grupo (ej. Familia) para marcarlos a todos de un toque.'}</p></div>${lend ? lendExtras() + '</div>' : ''}`;
}
// Cuadro de detalle: "Items" para escribir y una tablita de cargos que se pueden borrar o volver a agregar
const EXTRA_ROWS = [['tax', 'Impuestos', 'IVA, INC'], ['discount', 'Descuentos', ''], ['tip', 'Propina', ''], ['shipping', 'Envío', 'Domicilio']];
function fitName(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function itemQty(it) { const raw = String(it.qty || '').replace(/\D/g, ''); return raw === '' ? 1 : parseInt(raw, 10); }
function itemTotal(it) { const q = itemQty(it); const u = C.evalAmount(it.unit); return q > 0 && u !== null && u >= 0 ? q * u : null; }
function itemsSum() { return C.sum(D.items.map(itemTotal).filter(v => v !== null)); }
function detailBox() {
  const d = D, exp = d.type === 'expense';
  const tag = k => d.ocrFilled?.[k] ? ' <span class="ocr-tag" title="Leído de la foto">foto</span>' : '';
  const hidden = exp ? EXTRA_ROWS.filter(([k]) => !d.rows.includes(k)) : [];
  const sum = exp ? itemsSum() : 0;
  return `<div class="field">
    <div class="detail-box">
      ${exp ? `<div class="db-h">Ítems <span class="muted" style="font-weight:500">(opcional)</span>${tag('items')}</div>
      <div class="it-wrap"><div class="it-table" role="table" aria-label="Ítems comprados">
        <div class="it-row it-head" role="row"><span role="columnheader">Ítem</span><span role="columnheader">Nombre del ítem</span><span role="columnheader" class="num">Cant.</span><span role="columnheader" class="num">Precio unit.</span><span role="columnheader" class="num">Valor total</span><span></span></div>
        ${d.items.map((it, i) => { const tot = itemTotal(it); return `<div class="it-row" role="row">
          <span class="it-n" role="cell">${i + 1}</span>
          <textarea class="it-in it-name" rows="1" data-it="${i}" data-itk="name" placeholder="Producto" aria-label="Nombre del ítem ${i + 1}" autocomplete="off" spellcheck="true">${esc(it.name)}</textarea>
          <input class="it-in num" data-it="${i}" data-itk="qty" value="${esc(it.qty)}" inputmode="numeric" pattern="[0-9]*" placeholder="1" aria-label="Cantidad del ítem ${i + 1}" autocomplete="off">
          <input class="it-in num" data-it="${i}" data-itk="unit" value="${esc(it.unit)}" inputmode="decimal" placeholder="$ 0" aria-label="Precio unitario del ítem ${i + 1}" autocomplete="off">
          <span class="it-tot num amt" id="itTot${i}" role="cell">${tot !== null ? esc(C.formatMoney(tot)) : '—'}</span>
          <button type="button" class="db-del" data-act="itemDel" data-v="${i}" aria-label="Quitar ítem ${i + 1}">${ic('x', 'sm')}</button></div>`; }).join('')}
      </div></div>
      <div class="it-foot"><button type="button" class="chip" data-act="itemAdd">${ic('plus', 'sm')} Agregar ítem</button><span class="small">Suma de ítems <b class="amt" id="itSum">${esc(C.formatMoney(sum))}</b></span></div>
      <div class="db-table" role="table" aria-label="Cargos de la factura">
        ${d.rows.map(k => { const [, l, ph] = EXTRA_ROWS.find(r => r[0] === k); return `<div class="db-row" role="row"><label for="x${k}" role="rowheader">${l}:${tag(k)}</label><input id="x${k}" class="db-val${d.ocrFilled?.[k] ? ' ocr-filled' : ''}" inputmode="decimal" data-f="${k}" value="${esc(d[k])}" placeholder="${ph || '$ 0'}" autocomplete="off"><button type="button" class="db-del" data-act="rowDel" data-v="${k}" aria-label="Quitar ${l}">${ic('x', 'sm')}</button></div>`; }).join('')}
        ${d.customRows.map((r, i) => `<div class="db-row" role="row"><input class="db-lbl" data-cr="${i}" data-crk="label" value="${esc(r.label)}" placeholder="Apartado" aria-label="Nombre del apartado" autocomplete="off"><input class="db-val" inputmode="decimal" data-cr="${i}" data-crk="value" value="${esc(r.value)}" placeholder="$ 0" aria-label="Valor" autocomplete="off"><button type="button" class="db-del" data-act="customDel" data-v="${i}" aria-label="Quitar apartado">${ic('x', 'sm')}</button></div>`).join('')}
      </div>
      <div class="db-add">${hidden.map(([k, l]) => `<button type="button" class="chip" data-act="rowAdd" data-v="${k}">${ic('plus', 'sm')} ${l}</button>`).join('')}<button type="button" class="chip" data-act="customAdd">${ic('plus', 'sm')} Otro apartado</button></div>` : ''}
      <div class="db-h${exp ? ' db-h-sep' : ''}">Comentarios adicionales</div>
      <textarea id="note" class="db-text" data-f="note" rows="2" aria-label="Comentarios adicionales" placeholder="Escribe aquí cualquier comentario adicional (opcional)">${esc(d.note)}</textarea>
    </div>
    ${exp ? '<p class="hint">El valor total de cada ítem se calcula solo (cantidad × precio unitario). Borra con × lo que no aplique. Con la foto de la factura todo se llena solo.</p>' : ''}</div>`;
}
function receiptBlock() {
  const d = D, saved = d.id && txById(d.id)?.receipt && !d.removeReceipt ? txById(d.id).receipt : null, has = d.receiptMeta || saved;
  const meta = d.receiptMeta || saved || {};
  const isPdf = (meta.type || '').includes('pdf'), scanned = !!(meta.scanned || d._scan);
  const sub = scanned ? 'PDF escaneado' + (d.ocr?.state === 'done' && d._pdfWords ? ' · con texto buscable' : '') : isPdf ? 'PDF adjunto (no se lee automáticamente)' : 'Imagen guardada';
  const mini = 'style="min-height:34px;padding:4px 10px;font-size:13px"';
  return `<div class="field"><span class="lbl">${d.type === 'expense' ? 'Factura' : 'Soporte'}</span>
    ${has ? `<div class="rcpt-prev">${isPdf && !scanned && !d._thumbUrl ? `<span class="ico">${ic('doc')}</span>` : `<button type="button" class="rcpt-open" data-act="rcptView" aria-label="Ver cómo quedó la factura"><img id="rcptThumb" alt="Factura" ${d._thumbUrl ? `src="${d._thumbUrl}"` : ''}></button>`}<div class="grow" style="min-width:0"><div class="t" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(meta.name || 'Factura')}</div>
      <div class="small muted">${esc(sub)}${meta.size ? ' · ' + Math.round(meta.size / 1024) + ' KB' : ''}</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${d._scan ? `<button type="button" class="btn" data-act="scanAdjust" ${mini}>Ajustar recorte</button>` : ''}${d._ocrFile ? `<button type="button" class="btn" data-act="ocrRerun" ${mini}>Volver a leer</button>` : ''}<button type="button" class="btn" data-act="rcptRemove" ${mini}>Quitar</button></div></div></div>` : ''}
    <div class="grid2"><button type="button" class="btn primary" data-act="scanOpen">${ic('camera', 'sm')} Escanear</button>
      <label class="btn" style="cursor:pointer">${ic('clip', 'sm')} Adjuntar<input type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" data-act-change="receiptPick" class="sr-only"></label></div>
    <div id="ocrStatus" class="ocr-status" ${d.ocr ? '' : 'hidden'}>${ocrStatusHTML()}</div>
    ${d.ocr ? '' : `<p class="hint">${d.type === 'expense' ? 'Escanear abre la cámara: recorta la factura sola, la limpia (fondo blanco, sin dedos ni dobleces), la guarda en PDF y llena ítems, impuestos, propina, descuento y envío. Todo en tu teléfono.' : 'Se guarda en PDF en este dispositivo.'}${typeof driveReady === 'function' && driveReady() ? ' Al guardar, se copia a tu Google Drive.' : ''}</p>`}</div>`;
}
// Abre el visor: con la factura del formulario (D) o con la guardada de un movimiento (id)
async function viewReceipt(id) {
  let image = null, pdf = null, name = 'Factura', sub = '', canAdjust = false;
  if (id) {
    const t = txById(id); if (!t?.receipt) return;
    const b = await Store.get('rcpt:' + id); if (!b) { toast('El archivo ya no está en este dispositivo.'); return; }
    name = t.receipt.name || name;
    if (b.type === 'application/pdf') { pdf = b; image = await pdfExtractJpeg(b); } else image = b;
    sub = [t.receipt.scanned ? (t.receipt.mode === 'color' ? 'Color' : 'Versión mejorada') : '', Math.round(b.size / 1024) + ' KB'].filter(Boolean).join(' · ');
  } else if (D) {
    const saved = D.id && !D.removeReceipt ? txById(D.id)?.receipt : null, meta = D.receiptMeta || saved || {};
    name = meta.name || name; canAdjust = !!D._scan;
    if (D.receiptBlob) { if (D.receiptBlob.type === 'application/pdf') pdf = D.receiptBlob; else image = D.receiptBlob; }
    else if (saved) { const b = await Store.get('rcpt:' + D.id); if (b?.type === 'application/pdf') pdf = b; else image = b || null; }
    if (D._scanJpeg) image = D._scanJpeg; else if (!image && pdf) image = await pdfExtractJpeg(pdf);
    sub = [meta.scanned || D._scan ? (meta.mode === 'color' ? 'Color' : 'Versión mejorada') : '', meta.size ? Math.round(meta.size / 1024) + ' KB' : ''].filter(Boolean).join(' · ');
  }
  if (!image && !pdf) return;
  openViewer({ image, pdf, name, sub, canAdjust });
}
// Resultado del escáner → JPEG limpio, miniatura y PDF; luego se lee el texto
async function useScan(res) {
  if (!D) return;
  const cv = res.canvas;
  const jpeg = await canvasToBlob(cv, 'image/jpeg', 0.82);
  const thumb = await canvasToBlob(scaleCanvas(cv, 420), 'image/jpeg', 0.72);
  const pdf = await buildReceiptPdf(jpeg, cv.width, cv.height, []);
  if (D._thumbUrl) URL.revokeObjectURL(D._thumbUrl);
  D._thumbBlob = thumb; D._thumbUrl = URL.createObjectURL(thumb); D._scanJpeg = jpeg; D._scanSize = [cv.width, cv.height]; D._pdfWords = null;
  D._scan = { src: res.src, quad: res.quad, curve: res.curve, userCurve: res.userCurve };
  D.receiptBlob = pdf;
  D.receiptMeta = { name: 'Factura.pdf', type: 'application/pdf', size: pdf.size, hash: D._srcHash || await blobHash(jpeg), scanned: true, mode: res.mode };
  D._srcHash = null;
  D.removeReceipt = false; D._ocrFile = cv; D._scanCharH = res.charH || 0; D._ocrFlat = res.flatSrc ? { flatSrc: res.flatSrc, flatMode: res.flatMode } : null; D.more = true;
  if (res.fingers > 50) toast('Se borraron los dedos que tapaban el borde.');
  // Foto de poca resolución (cámara en vivo) y letra pequeña: con la cámara del teléfono a resolución completa se lee mucho mejor
  else if (res.charH && res.charH < 17 && res.src && Math.max(res.src.width, res.src.height) < 2600) toast('La letra quedó pequeña. Para leerla mejor, escanea con "Foto HD".', null, null, 6000);
  if (D.type === 'expense' || D.type === 'income') runOcr(cv, res.charH, D._ocrFlat); else rerenderTx();
}
async function blobHash(b) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))).map(x => x.toString(16).padStart(2, '0')).join(''); }
function ocrStatusHTML() {
  const o = D?.ocr; if (!o) return '';
  if (o.state === 'running') return `<div class="small" style="font-weight:600">${esc(o.step || 'Leyendo la factura…')}</div><div style="margin-top:8px">${progress(Math.round((o.progress || 0) * 100))}</div>`;
  if (o.state === 'error') return `<div class="small neg" style="font-weight:600">${esc(o.msg)}</div>`;
  const r = o.r, f = v => C.formatMoney(v);
  const bits = [r.merchant ? ocrMerchant(r.merchant) : '', r.date ? fdShort(r.date) : '', r.total ? 'Total ' + f(r.total) : '', r.tax ? 'Impuestos ' + f(r.tax) : '', r.tip ? 'Propina ' + f(r.tip) : '', r.discount ? 'Descuento ' + f(r.discount) : '', r.shipping ? 'Envío ' + f(r.shipping) : '', r.items.length ? r.items.length + ' producto(s)' : ''].filter(Boolean);
  if (!bits.length) return `<div class="small" style="font-weight:600">No pude leer datos claros en la foto.</div><div class="small muted">Prueba con más luz y la factura derecha, o escríbelos a mano.</div>`;
  const amt = C.evalAmount(D.amountText), sug = [];
  if (r.total && amt && amt !== r.total) sug.push(`<button type="button" class="chip" data-act="ocrUse" data-k="amount">Usar total ${esc(f(r.total))}</button>`);
  if (r.date && r.date !== D.date) sug.push(`<button type="button" class="chip" data-act="ocrUse" data-k="date">Fecha ${esc(fdShort(r.date))}</button>`);
  if (r.items.length && D.items.some(it => String(it.name).trim()) && !D.ocrFilled?.items) sug.push(`<button type="button" class="chip" data-act="ocrUse" data-k="items">Agregar ${r.items.length} ítem(s) de la foto</button>`);
  return `<div class="small" style="font-weight:650">${o.source === 'texto' ? 'Leído del texto' : 'Leído de la foto'}</div><div class="small muted" style="margin-top:2px">${esc(bits.join(' · '))}</div>
    ${sug.length ? `<div class="chips wrap" style="margin-top:8px">${sug.join('')}</div>` : ''}<div class="tiny muted" style="margin-top:6px">Los campos marcados “de la foto” se pueden corregir.</div>`;
}
// "ARTURO CALLE" → "Arturo Calle"; siglas cortas (D1, KOAJ) se dejan tal cual
// "EDIFICIO CENTRO COMERCIAL LOS PINOS P.H." → "Edificio Centro Comercial Los Pinos P.H."; siglas cortas (D1, KOAJ, P.H.) se dejan igual
const NICE_LOWER = new Set(['de', 'del', 'y', 'e', 'en', 'a', 'al', 'con', 'por', 'para']), NICE_WORDS = new Set(['la', 'las', 'los', 'el', 'san', 'sur', 'mi', 'su', 'sin', 'mas', 'gran', 'casa', 'mar', 'sol', 'luz', 'paz']);
// Tienda leída de la foto: si se parece a una que el usuario ya escribió antes, se usa como él la escribió
function ocrMerchant(m) {
  const known = [...new Set(S.transactions.filter(t => t.merchant && !t.deletedAt).map(t => t.merchant))].slice(-300);
  return C.knownName(m, known) || C.matchMerchant(m, known) || niceName(m);
}
function niceName(s) {
  s = String(s || '').trim();
  return s.split(/\s+/).map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && NICE_LOWER.has(lw)) return lw;
    if (w.length <= 4 && /^[A-Z0-9&.]+$/.test(w) && !NICE_WORDS.has(lw)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ').slice(0, 60);
}
function receiptItems(items) { return items.map(i => ({ name: i.name.charAt(0) + i.name.slice(1).toLowerCase(), qty: String(i.qty || 1), unit: Math.round(i.amount / (i.qty || 1)).toLocaleString('es-CO') })); }
function itemsText(items) { return items.map(i => `${i.qty > 1 ? i.qty + ' × ' : ''}${i.name.charAt(0) + i.name.slice(1).toLowerCase()} — ${C.formatMoney(i.amount)}`).join('\n'); }
// Llena solo los campos vacíos; lo que ya escribiste no se toca
function applyReceiptData(r, source) {
  D.ocrFilled = D.ocrFilled || {};
  const fmt = n => Number(n).toLocaleString('es-CO');
  for (const k of ['tax', 'tip', 'discount', 'shipping']) if (r[k] && !String(D[k] || '').trim()) { D[k] = fmt(r[k]); D.ocrFilled[k] = true; if (!D.rows.includes(k)) D.rows = EXTRA_ROWS.map(x => x[0]).filter(x => D.rows.includes(x) || x === k); }
  if (r.total && !C.evalAmount(D.amountText)) { D.amountText = fmt(r.total); D.ocrFilled.amount = true; }
  if (r.items.length && !D.items.some(it => String(it.name).trim())) { D.items = receiptItems(r.items); D.ocrFilled.items = true; }
  if (r.merchant && !String(D.merchant || '').trim() && D.type === 'expense') { D.merchant = ocrMerchant(r.merchant); D.ocrFilled.merchant = true; }
  if (r.date && D.date === today() && !D.id && r.date <= today() && C.diffDays(r.date, today()) <= 400) { D.date = r.date; D.ocrFilled.date = true; }
  D.ocr = { state: 'done', r, source };
  D.more = true;
}
let ocrWorker = null, ocrLogger = null, ocrScript = null;
function loadScriptOnce(src) {
  if (ocrScript) return ocrScript;
  ocrScript = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { ocrScript = null; rej(new Error('script')); }; document.head.appendChild(s); });
  return ocrScript;
}
async function getOcrWorker() {
  await loadScriptOnce('vendor/tesseract/tesseract.min.js');
  if (!ocrWorker) {
    const base = new URL('vendor/tesseract/', location.href).href;
    ocrWorker = await Tesseract.createWorker('spa', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', workerBlobURL: false, gzip: true, logger: m => ocrLogger && ocrLogger(m) });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  }
  return ocrWorker;
}
// Prepara la imagen para leer mejor: tamaño adecuado, escala de grises y más contraste
async function ocrCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long > 2000 ? 2000 / long : long < 1200 ? 1200 / long : 1;
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const px = ctx.getImageData(0, 0, cv.width, cv.height), dta = px.data;
    let min = 255, max = 0;
    for (let i = 0; i < dta.length; i += 4) { const g = 0.299 * dta[i] + 0.587 * dta[i + 1] + 0.114 * dta[i + 2]; dta[i] = g; if (g < min) min = g; if (g > max) max = g; }
    const span = Math.max(1, max - min);
    for (let i = 0; i < dta.length; i += 4) { const g = Math.min(255, Math.max(0, (dta[i] - min) * 255 / span * 1.15 - 10)); dta[i] = dta[i + 1] = dta[i + 2] = g; }
    ctx.putImageData(px, 0, 0);
    return cv;
  } finally { URL.revokeObjectURL(url); }
}
function paintOcr() { const el = $('#ocrStatus'); if (el) { el.hidden = !D?.ocr; el.innerHTML = ocrStatusHTML(); } }
async function runOcr(src, charH, flat) {
  const me = D;
  if (!me) return;
  me.ocr = { state: 'running', progress: 0, step: 'Preparando la foto…' }; me.more = true; rerenderTx();
  try {
    // Factura escaneada con letra pequeña: el lector recibe una copia ampliada (lee mucho mejor con letras de ~26 px)
    const isCv = src instanceof HTMLCanvasElement;
    const canvas = isCv ? (charH && typeof scanForOcr === 'function' ? scanForOcr({ canvas: src, charH }) : src) : await ocrCanvas(src);
    const kOcr = isCv ? canvas.width / src.width : 1;
    ocrLogger = m => {
      if (D !== me || !me.ocr || me.ocr.state !== 'running') return;
      if (m.status === 'recognizing text') { me.ocr.step = 'Leyendo la factura…'; me.ocr.progress = m.progress; }
      else me.ocr.step = ocrWorker ? 'Leyendo la factura…' : 'Preparando el lector (la primera vez tarda un poco más)…';
      paintOcr();
    };
    const w = await getOcrWorker();
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    if (D !== me) return;
    let r = C.parseReceiptText(data.text);
    const sumOk = x => x.total && x.items.length && Math.abs(x.items.reduce((s, i) => s + i.amount, 0) + (x.tip || 0) + (x.shipping || 0) - (x.discount || 0) - x.total) <= 1;
    if (!r.total || !r.tax || !sumOk(r) || !r.date || !r.merchant) {
      // Segunda lectura palabra por palabra: arregla montos impresos un poco más arriba o abajo que su etiqueta
      me.ocr.step = 'Revisando los datos…'; me.ocr.progress = 0; paintOcr();
      try {
        await w.setParameters({ tessedit_pageseg_mode: '11' });
        const d2 = (await w.recognize(canvas, {}, { text: true, blocks: true })).data;
        r = C.mergeReceiptReads(r, C.parseReceiptText(C.receiptLinesFromWords(ocrWords(d2)).join('\n')));
      } finally { await w.setParameters({ tessedit_pageseg_mode: '6' }); }
      if (D !== me) return;
    }
    if ((!r.total || !r.tax || !sumOk(r) || !r.date || !r.merchant) && flat && typeof scanFlat === 'function') {
      // Tirilla arrugada: lectura de respaldo de la foto sin enderezar renglones (una columna mal alineada no se pierde)
      me.ocr.step = 'Revisando otra vez…'; me.ocr.progress = 0; paintOcr();
      await new Promise(ok => setTimeout(ok, 30));
      const fr = scanFlat(flat);
      if (fr) r = C.mergeReceiptReads(r, C.parseReceiptText((await w.recognize(scanForOcr(fr), {}, { text: true })).data.text));
      if (D !== me) return;
    }
    applyReceiptData(r, 'foto');
    if (me._scanJpeg) { // PDF con texto invisible encima de la imagen: se puede buscar y copiar
      const words = ocrWords(data).map(w => kOcr === 1 ? w : Object.assign({}, w, { bbox: { x0: w.bbox.x0 / kOcr, x1: w.bbox.x1 / kOcr, y0: w.bbox.y0 / kOcr, y1: w.bbox.y1 / kOcr } }));
      if (words.length) { const pdf = await buildReceiptPdf(me._scanJpeg, me._scanSize[0], me._scanSize[1], words); me.receiptBlob = pdf; me.receiptMeta.size = pdf.size; me._pdfWords = words.length; }
    }
  } catch (e) {
    if (D !== me) return;
    me.ocr = { state: 'error', msg: IN_FRAME ? 'La lectura automática no está disponible en la vista previa de Claude. Funciona en la app instalada.' : 'No se pudo leer la foto. Escribe los datos a mano.' };
  }
  ocrLogger = null;
  rerenderTx(); persistDraft();
}
function loadThumb() {
  if (!D) return;
  if (D.receiptBlob && !D._thumbUrl && (D.receiptMeta?.type || '').startsWith('image/')) D._thumbUrl = URL.createObjectURL(D.receiptBlob);
  const img = $('#rcptThumb'); if (!img) return;
  if (D._thumbUrl) { img.src = D._thumbUrl; return; }
  const t = D.id && txById(D.id);
  if (t?.receipt && !D.removeReceipt) Promise.all([Store.get('rcptthumb:' + t.id), Store.get('rcpt:' + t.id)]).then(([th, b]) => { const pic = th || (b && b.type.startsWith('image/') ? b : null); if (pic && D && D.id === t.id) { D._thumbUrl = URL.createObjectURL(pic); const i2 = $('#rcptThumb'); if (i2) i2.src = D._thumbUrl; } });
}
function subPicker(cat) {
  const d = D;
  if (!cat) return `<p class="hint" style="margin-top:10px">Elige una categoría para ver sus subcategorías.</p>`;
  return `<div class="lbl small" style="margin:14px 4px 6px;font-weight:650;color:var(--ink-2)">Subcategoría <span class="muted" style="font-weight:500">(opcional)</span></div>
    <div class="chips wrap" role="group" aria-label="Subcategoría">${cat.subs.filter(s => !s.archived).map(s => `<button type="button" class="chip sub-chip" style="--cc:${subColor(cat, s.id)}" data-act="dset" data-k="subcategoryId" data-v="${s.id}" aria-pressed="${d.subcategoryId === s.id}"><i></i>${esc(s.name)}</button>`).join('')}
      ${d.newSubOpen ? '' : `<button type="button" class="chip" data-act="subNew">${ic('plus', 'sm')} Nueva</button>`}</div>
    ${d.newSubOpen ? `<div style="display:flex;gap:8px;margin-top:4px"><input id="newSubName" class="input" placeholder="Nueva subcategoría en ${esc(cat.name)}" autocomplete="off" maxlength="40" style="min-height:44px"><button type="button" class="btn primary" data-act="subAdd" style="min-height:44px">Agregar</button><button type="button" class="btn" data-act="subCancel" aria-label="Cancelar" style="min-height:44px">${ic('x', 'sm')}</button></div>` : ''}`;
}
function instField() {
  const d = D;
  return `<div class="field"><label for="instN">Cuotas</label><div class="grid2"><select id="instN" class="input" data-f="instN" data-rerender>${optionList([1, 2, 3, 4, 5, 6, 9, 10, 12, 18, 24, 36].map(n => [String(n), n === 1 ? '1 (contado)' : n + ' cuotas']), String(d.instN))}</select>${Number(d.instN) > 1 ? `<input type="month" class="input" data-f="firstMonth" value="${esc(d.firstMonth)}" aria-label="Mes de la primera cuota">` : ''}</div>${Number(d.instN) > 1 ? `<p class="hint" id="instPrev"></p>` : ''}</div>`;
}
function refDuplicate(ref, selfId) {
  const r = String(ref || '').trim().toLowerCase();
  if (!r) return null;
  return S.transactions.find(t => !t.deletedAt && t.id !== selfId && String(t.reference || '').trim().toLowerCase() === r) || null;
}
function splitSection() {
  const d = D, people = S.people.filter(p => !p.archived);
  if (!d.splitOn) return `<div class="toggle-row"><div><div style="font-weight:600">Dividir gasto</div><div class="hint" style="margin:2px 0 0">Pagaste por otros: registra lo que te deben</div></div><label class="switch"><input type="checkbox" data-act-change="splitToggle" aria-label="Dividir gasto"><span></span></label></div>`;
  return `<div class="card flat" style="padding:14px"><div class="toggle-row" style="padding-top:0"><div style="font-weight:700">Dividir gasto</div><label class="switch"><input type="checkbox" checked data-act-change="splitToggle" aria-label="Dividir gasto"><span></span></label></div>
    <div class="chips wrap">${people.map(p => `<button type="button" class="chip" data-act="splitPerson" data-v="${p.id}" aria-pressed="${d.splitPeople.includes(p.id)}">${esc(p.name)}</button>`).join('')}</div>
    <div style="display:flex;gap:8px;margin:6px 0 12px"><input class="input" id="newPersonName" placeholder="Nueva persona" autocomplete="off" style="min-height:42px"><button type="button" class="btn" data-act="splitAddPerson">Agregar</button></div>
    ${d.splitPeople.length ? `${seg('Modo', [['equal', 'Partes iguales'], ['custom', 'Personalizado']], d.splitMode, 'splitMode')}
      <div style="margin-top:12px">
        <div class="split-row"><b>Tú</b><span id="myShare" class="amt" style="text-align:right;font-weight:700"></span><span></span></div>
        ${d.splitPeople.map(pid => `<div class="split-row"><span>${esc(personName(pid))}</span>
          ${d.splitMode === 'custom' ? `<input class="input" inputmode="decimal" data-f="part:${pid}" value="${esc(d.customParts[pid] || '')}" placeholder="$ 0" aria-label="Parte de ${esc(personName(pid))}">` : `<span class="amt" data-part="${pid}" style="text-align:right"></span>`}
          <label title="Regalo o gasto asumido" style="display:grid;place-items:center"><input type="checkbox" data-act-change="splitGift" data-v="${pid}" ${d.gifts[pid] ? 'checked' : ''} aria-label="Marcar parte de ${esc(personName(pid))} como regalo"> <span class="tiny">Regalo</span></label></div>`).join('')}
      </div><div class="hint" id="splitSum"></div>` : '<p class="hint">Elige con quién compartiste el gasto.</p>'}</div>`;
}
function computeSplit(amount) {
  const d = D;
  if (!d.splitOn || !d.splitPeople.length || !amount) return null;
  let parts;
  if (d.splitMode === 'equal') {
    const p = C.splitEven(amount, d.splitPeople.length + 1);
    parts = d.splitPeople.map((pid, k) => ({ personId: pid, amount: p[k + 1], gift: !!d.gifts[pid] }));
    return { mode: 'equal', myShare: p[0], parts };
  }
  parts = d.splitPeople.map(pid => ({ personId: pid, amount: C.evalAmount(d.customParts[pid]) ?? 0, gift: !!d.gifts[pid] }));
  const others = C.sum(parts.map(p => p.amount));
  if (parts.some(p => p.amount < 0)) return { error: 'Las partes no pueden ser negativas.' };
  if (others > amount) return { error: 'Las partes de otros superan el total.' };
  return { mode: 'custom', myShare: amount - others, parts };
}
function updateTxLive() {
  if (!D) return;
  const amount = C.evalAmount(D.amountText);
  const prev = $('#amtPrev');
  if (prev) prev.textContent = !D.amountText ? 'Puedes escribir operaciones: 200000/4' : amount === null ? 'Revisa el importe' : (/[+\-*/x×÷]/.test(D.amountText.replace(/^-/, '')) ? '= ' : '') + C.formatMoney(amount);
  const sp = computeSplit(amount);
  if (sp && !sp.error) {
    const my = $('#myShare'); if (my) my.textContent = C.formatMoney(sp.myShare);
    sp.parts.forEach(p => { const el = $(`[data-part="${p.personId}"]`); if (el) el.textContent = C.formatMoney(p.amount); });
    const gifts = C.sum(sp.parts.filter(p => p.gift).map(p => p.amount));
    const s = $('#splitSum'); if (s) s.innerHTML = `Salida total <b>${esc(C.formatMoney(amount))}</b> · Tu gasto <b>${esc(C.formatMoney(sp.myShare + gifts))}</b> · Por cobrar <b>${esc(C.formatMoney(amount - sp.myShare - gifts))}</b>`;
  } else if (sp?.error) { const s = $('#splitSum'); if (s) s.innerHTML = `<span class="neg">${esc(sp.error)}</span>`; }
  if (D.type === 'expense') {
    const mi = $('#mapsIn');
    if (mi && (!D.mapsUrl || D._autoMaps)) {
      const last = lastMapsFor(D.merchant, D.id);
      if (last && last !== D.mapsUrl) { D.mapsUrl = last; D._autoMaps = true; mi.value = last; }
      else if (!last && D._autoMaps) { D.mapsUrl = ''; D._autoMaps = false; mi.value = ''; }
    }
    const mh = $('#mapsHint');
    if (mh) {
      const u = (D.mapsUrl || '').trim();
      const nu = normUrl(u);
      let host = ''; try { host = new URL(nu).hostname.replace(/^www\./, ''); } catch (e) { /* */ }
      mh.innerHTML = !u ? '<b>Mapa</b>: busca o toca el lugar aquí. <b>Google Maps</b>: abre la app con el nombre de la tienda; allí toca Compartir → Copiar enlace y vuelve a <b>Pegar</b>.'
        : !validUrl(nu) ? '<span class="neg">Escribe una dirección web completa (https://…).</span>'
        : isMapsUrl(nu) ? `${D._autoMaps ? 'Tomado de tu última compra en esta tienda · ' : 'Ubicación · '}<a href="${esc(nu)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>`
        : `Página web · <a href="${esc(nu)}" target="_blank" rel="noopener noreferrer">Abrir ${esc(host)}</a>`;
    }
    const gb = $('#gmapsBtn'); if (gb) gb.href = gmapsSearchUrl(D.merchant, D.location);
    const me = $('#merch'); if (me && D.merchant.trim()) me.removeAttribute('aria-invalid');
  }
  const rh = $('#refHint');
  if (rh) { const dup = refDuplicate(D.reference, D.id); rh.innerHTML = dup ? `<span class="neg">Esta referencia ya está en: ${esc(txTitle(dup))} · ${esc(fdShort(dup.date))} · ${esc(C.formatMoney(dup.amount))}</span>` : ''; rh.hidden = !dup; }
  const ip = $('#instPrev');
  if (ip && amount) { const p = C.splitEven(amount, Number(D.instN)); ip.textContent = `${D.instN} cuotas de ${C.formatMoney(p[0])} desde ${C.monthLabel(D.firstMonth)}. Sin interés (ajústalo en notas si aplica).`; }
}
// Acepta enlaces de Google Maps: google.com/maps, maps.google.*, maps.app.goo.gl y goo.gl/maps
function isMapsUrl(u) {
  try {
    const x = new URL(u.trim());
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    const h = x.hostname.toLowerCase();
    if (h === 'maps.app.goo.gl') return true;
    if (h === 'goo.gl' && x.pathname.startsWith('/maps')) return true;
    if (/^maps\.google\.[a-z.]+$/.test(h)) return true;
    if (/^(www\.)?google\.[a-z.]+$/.test(h) && x.pathname.startsWith('/maps')) return true;
    return false;
  } catch (e) { return false; }
}
// Último link de Maps usado para una tienda (para llenarlo solo)
function lastMapsFor(name, selfId) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const hit = S.transactions.filter(t => !t.deletedAt && t.id !== selfId && t.mapsUrl && isMapsUrl(t.mapsUrl) && String(t.merchant || '').trim().toLowerCase() === n).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')))[0];
  return hit ? hit.mapsUrl : null;
}
function normUrl(u) { u = String(u || '').trim(); if (u && !/^[a-z]+:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+/.test(u)) u = 'https://' + u; return u; }
function gmapsSearchUrl(name, extra) { const q = [name, extra].map(x => String(x || '').trim()).filter(Boolean).join(' '); return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || 'tiendas cerca'); }
function validUrl(u) { if (!u) return true; try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch (e) { return false; } }
async function txSave() {
  const d = D, err = m => { $('#txErr').textContent = m; return false; };
  const amount = C.evalAmount(d.amountText);
  // Único campo obligatorio: el monto, de 1 peso en adelante (los ajustes pueden ser negativos).
  if (amount === null || (d.type !== 'adjust' && amount < 1) || amount === 0) { $('#amt')?.focus(); return err('Escribe un monto de $ 1 o más.'); }
  if (d.type === 'transfer' && (!accById(d.accountId) || !accById(d.toAccountId) || d.toAccountId === d.accountId)) return err('Para una transferencia elige la cuenta de origen y una de destino distinta.');
  const c0 = catById(d.categoryId);
  if (c0 && d.subcategoryId && !c0.subs.some(s => s.id === d.subcategoryId)) d.subcategoryId = '';
  if (d.type === 'expense') {
    // Ítems opcionales: se guardan solo las filas con nombre; cantidad 1 y precio 0 si no son válidos.
    const named = d.items.filter(it => String(it.name).trim());
    if (named.length === 1 && !String(named[0].unit).trim()) { const q = itemQty(named[0]) || 1; named[0].qty = String(q); named[0].unit = Math.round(amount / q).toLocaleString('es-CO'); }
    for (const it of named) { if (!itemQty(it) || itemQty(it) < 1) it.qty = '1'; if (C.evalAmount(it.unit) === null || C.evalAmount(it.unit) < 0) it.unit = '0'; }
  }
  if (!accById(d.accountId)) d.accountId = '';
  d.mapsUrl = normUrl(d.mapsUrl); d.productUrl = normUrl(d.productUrl);
  if (!validUrl(d.mapsUrl)) d.mapsUrl = ''; if (!validUrl(d.productUrl)) d.productUrl = '';
  let split = null;
  if (d.type === 'expense' && d.splitOn && d.splitPeople.length) { split = computeSplit(amount); if (split.error) return err(split.error); }
  const extras = {};
  const LBL = { tip: 'la propina', tax: 'los impuestos', discount: 'los descuentos', shipping: 'el envío' };
  for (const k of ['tip', 'tax', 'discount', 'shipping']) if (d[k] && (d.type !== 'expense' || d.rows.includes(k))) { const v = C.evalAmount(d[k]); if (v !== null && v >= 0) extras[k] = v; }
  const custom = [];
  for (const r of d.customRows || []) {
    if (!String(r.label || '').trim() && !String(r.value || '').trim()) continue;
    const v = String(r.value || '').trim() ? C.evalAmount(r.value) : 0;
    if (v === null || v < 0) continue;
    custom.push({ label: (String(r.label || '').trim() || 'Otro').slice(0, 40), amount: v });
  }
  if (custom.length) extras.custom = custom;
  const items = d.type === 'expense' ? d.items.filter(it => String(it.name).trim()).map(it => { const q = itemQty(it) || 1, u = C.evalAmount(it.unit) || 0; return { name: String(it.name).trim().slice(0, 80), qty: q, unitPrice: u, total: q * u }; }) : [];
  const lendTo = isLendDraft() ? d.people[d.people.length - 1] : null;
  if (isLendDraft() && !personById(lendTo)) { $('.lend-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return err('Elige a quién le prestaste el dinero.'); }
  const loan = d.type === 'income' && !d.id && d.loanMode ? loanById(d.loanId) : null;
  const alloc = loan ? C.allocatePayment(loan, amount) : null;
  if (alloc?.error) return err(alloc.error);
  const dupRef = refDuplicate(d.reference, d.id);
  if (dupRef && !(await confirmDialog(`La referencia "${d.reference.trim()}" ya está registrada en ${txTitle(dupRef)} (${fdShort(dupRef.date)}, ${C.formatMoney(dupRef.amount)}). ¿Guardar de todos modos?`, { title: 'Referencia repetida', confirmText: 'Guardar' }))) return;
  const prevTx = d.id ? txById(d.id) : null;
  const tx = Object.assign(prevTx ? JSON.parse(JSON.stringify(prevTx)) : { id: uid(), idempotencyKey: uid(), createdAt: new Date().toISOString(), source: d.source || 'manual', currency: 'COP' }, {
    type: d.type, amount, accountId: d.accountId, toAccountId: d.type === 'transfer' ? d.toAccountId : null,
    categoryId: d.type === 'expense' || d.type === 'income' ? (d.categoryId || null) : (prevTx?.categoryId || null), subcategoryId: d.subcategoryId || null,
    nature: d.type === 'expense' ? (catById(d.categoryId)?.defaultNature || 'other') : null,
    merchant: d.merchant.trim(), date: d.date || today(), time: d.time || '', timezone: C.TZ, note: d.note.trim(), tags: d.tagsText.split(',').map(s => s.trim()).filter(Boolean),
    status: d.status, location: d.location.trim(), mapsUrl: d.type === 'expense' ? (isMapsUrl(normUrl(d.mapsUrl)) ? normUrl(d.mapsUrl) : '') : d.mapsUrl.trim(), productUrl: d.type === 'expense' && d.mapsUrl.trim() && !isMapsUrl(normUrl(d.mapsUrl)) ? normUrl(d.mapsUrl) : d.productUrl.trim(), paymentMethod: d.paymentMethod, reference: d.reference.trim(),
    extras: Object.keys(extras).length ? extras : null, items, updatedAt: new Date().toISOString(), version: (prevTx?.version || 0) + 1 });
  tx.people = (d.type === 'expense' || d.type === 'income') ? d.people.filter(id => personById(id)) : [];
  if (split) {
    const prevParts = prevTx?.split?.parts || [];
    split.parts.forEach(p => { const old = prevParts.find(x => x.personId === p.personId); p.collected = old?.collected || 0; if (p.collected > p.amount) p.collected = p.amount; });
    tx.split = split;
  } else tx.split = null;
  tx.installments = d.type === 'expense' && Number(d.instN) > 1 ? { n: Number(d.instN), firstMonth: d.firstMonth, interestBp: 0 } : null;
  if (d.removeReceipt && !d.receiptBlob && tx.receipt) { await Store.del('rcpt:' + tx.id); await Store.del('rcptthumb:' + tx.id); tx.receipt = null; }
  if (d.receiptBlob) {
    if (d.receiptMeta?.scanned) { // AAAAMMDD_Tienda_Importe.pdf
      const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
      d.receiptMeta.name = `${tx.date.replace(/-/g, '')}_${clean(tx.merchant) || 'Factura'}_${tx.amount}.pdf`;
    }
    if (d._thumbBlob) await Store.set('rcptthumb:' + tx.id, d._thumbBlob);
    await Store.set('rcpt:' + tx.id, d.receiptBlob);
    tx.receipt = Object.assign({}, d.receiptMeta, { addedAt: new Date().toISOString(), driveStatus: 'local' });
    if (d.ocr?.state === 'done') { const r = d.ocr.r; tx.receipt.read = { total: r.total, tax: r.tax, tip: r.tip, discount: r.discount, shipping: r.shipping, items: r.items.length, nit: r.nit }; } // resumen, sin el texto completo
  }
  let newLoan = null;
  if (lendTo) {
    const n = Math.max(1, Number(d.lendN) || 1);
    newLoan = { id: uid(), principal: amount, rateBp: 0, interestMode: 'none', termMonths: n, installments: n, firstDue: d.lendDue || C.addMonthsISO(tx.date, 1), payments: [],
      direction: 'given', personId: lendTo, accountId: tx.accountId || '', startDate: tx.date, note: tx.note || tx.merchant || '', createdAt: new Date().toISOString(), statusOverride: null, rulesVersion: 1, txId: tx.id };
    S.loans.push(newLoan);
    Object.assign(tx, { type: 'loan_out', loanId: newLoan.id, personId: lendTo, nature: null, split: null, installments: null, source: tx.source === 'manual' ? 'loan' : tx.source });
    audit('loan.created', 'loan', newLoan.id, `Préstamo entregado a ${personName(lendTo)} por ${C.formatMoney(amount)}`);
  }
  if (loan) {
    Object.assign(tx, { type: 'repay_in', categoryId: null, subcategoryId: null, nature: null, loanId: loan.id, personId: loan.personId, interest: alloc.interest, capital: alloc.capital, source: tx.source === 'manual' ? 'loan' : tx.source });
    loan.payments = loan.payments || [];
    loan.payments.push({ id: uid(), date: tx.date, amount, interest: alloc.interest, capital: alloc.capital, accountId: tx.accountId, txId: tx.id, note: tx.note });
    audit('loan.payment', 'loan', loan.id, `Abono de ${C.formatMoney(amount)} recibido de ${personName(loan.personId)}${tx.receipt ? ' (con soporte)' : ''}`);
  }
  if (prevTx) {
    const idx = S.transactions.findIndex(t => t.id === prevTx.id);
    S.transactions[idx] = tx;
    if (prevTx.status === 'confirmed') {
      const ch = ['amount', 'date', 'accountId', 'type', 'categoryId', 'status'].filter(k => JSON.stringify(prevTx[k]) !== JSON.stringify(tx[k]));
      audit('transaction.updated', 'transaction', tx.id, `Editado movimiento confirmado (${ch.join(', ') || 'detalles'})` + (ch.includes('amount') ? `: ${C.formatMoney(prevTx.amount)} → ${C.formatMoney(tx.amount)}` : ''));
    }
  } else S.transactions.push(tx);
  const isNew = !prevTx;
  S.draft = null; D._orig = JSON.stringify(stripD(D));
  save(); await closeSheet(true); render();
  if (newLoan) { toast(`Préstamo a ${personName(newLoan.personId)} registrado`, 'Ver', () => loanDetail(newLoan.id)); return; }
  if (loan) { toast(`Abono de ${personName(loan.personId)} guardado`, 'Deshacer', () => { const t = txById(tx.id); if (t) { S.transactions = S.transactions.filter(x => x.id !== tx.id); loan.payments = loan.payments.filter(p => p.txId !== tx.id); Store.del('rcpt:' + tx.id); Store.del('rcptthumb:' + tx.id); save(); render(); } }); return; }
  toast(isNew ? `${TYPES[tx.type]} guardado` : 'Cambios guardados', isNew ? 'Deshacer' : null, () => { const t = txById(tx.id); if (t) { t.deletedAt = new Date().toISOString(); save(); render(); } });
}
async function receiptPick(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f || !D) return;
  if (f.size > 20 * 1024 * 1024) { toast('El archivo supera 20 MB.'); return; }
  const head = new Uint8Array(await readFileAs(f.slice(0, 16)));
  const hex = Array.from(head.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
  const brand = new TextDecoder().decode(head.slice(4, 12));
  let kind = null;
  if (hex.startsWith('ffd8ff')) kind = 'image'; else if (hex === '89504e47') kind = 'image';
  else if (hex === '25504446') kind = 'pdf'; else if (/ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) kind = 'image';
  if (!kind) { toast('Formato no permitido. Usa JPG, PNG, HEIC o PDF.'); return; }
  let blob, name = f.name.replace(/[^\w.\-áéíóúñ ]/gi, '_').slice(0, 80);
  if (kind === 'image') {
    let cv;
    try { cv = await imageFileToCanvas(f, 3000); } catch (e) { toast('No se pudo leer la imagen (¿archivo dañado o HEIC fuera de Safari?).'); return; }
    const srcHash = await blobHash(f);
    const dupI = S.transactions.find(t => t.receipt?.hash === srcHash && t.id !== D.id && !t.deletedAt);
    if (dupI && !(await confirmDialog(`Esta foto ya está adjunta a "${txTitle(dupI)}" (${fdShort(dupI.date)}). ¿Usarla de todos modos?`, { title: 'Posible duplicado', confirmText: 'Usar' }))) return;
    D._srcHash = srcHash;
    openScanner(useScan, { canvas: cv });
    return;
  }
  {
    const buf = new Uint8Array(await readFileAs(f));
    const txt = new TextDecoder('latin1').decode(buf);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction\s*<<[^>]*\/JS)\b/.test(txt)) { toast('PDF rechazado: contiene contenido activo.'); return; }
    if (!/%%EOF\s*$/.test(txt.slice(-1024))) { toast('PDF rechazado: parece dañado o incompleto.'); return; }
    if (f.size > 10 * 1024 * 1024) { toast('El PDF supera 10 MB.'); return; }
    blob = new Blob([buf], { type: 'application/pdf' });
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
  const dup = S.transactions.find(t => t.receipt?.hash === hash && t.id !== D.id && !t.deletedAt);
  if (dup && !(await confirmDialog(`Este comprobante ya está adjunto a "${txTitle(dup)}" (${fdShort(dup.date)}). ¿Adjuntarlo de todos modos?`, { title: 'Posible duplicado', confirmText: 'Adjuntar' }))) return;
  if (D._thumbUrl) { URL.revokeObjectURL(D._thumbUrl); D._thumbUrl = null; }
  D.receiptBlob = blob; D.receiptMeta = { name, type: blob.type, size: blob.size, hash }; D.removeReceipt = false; D._scan = null; D._scanJpeg = null; D._thumbBlob = null; D._ocrFile = kind === 'image' ? f : null; D._ocrFlat = null; D.more = true;
  if (kind === 'image' && (D.type === 'expense' || D.type === 'income')) runOcr(f);
  else { rerenderTx(); toast('Factura adjunta (' + Math.round(blob.size / 1024) + ' KB)'); }
}
function pasteSheet() {
  const s = openSheet({ title: 'Pegar texto', body: `<p class="muted small" style="margin-top:0">Pega el texto de una notificación de compra, un correo o una factura digital. Se llenan los campos y tú revisas antes de guardar.</p>
    <textarea class="input" id="pasteTxt" style="min-height:120px" placeholder="Ej.: Compraste $25.900 en EXITO con tu tarjeta"></textarea>
    <button class="btn block" style="margin-top:10px" data-act="readClipboard">${ic('paste', 'sm')} Leer del portapapeles</button>`, footer: `<button class="btn primary" data-act="applyPaste">Usar este texto</button>` });
  return s;
}
async function applyPaste() {
  const txt = $('#pasteTxt').value;
  const r = C.parsePastedText(txt);
  if (!r.amount) { toast('No encontré un importe en el texto.'); return; }
  await closeSheet(true);
  if (!D) { openTxForm({ source: 'paste', status: 'confirmed' }); }
  Object.assign(D, { amountText: String(r.amount), source: D.source === 'manual' ? 'paste' : D.source });
  if (r.merchant) D.merchant = r.merchant; if (r.date) D.date = r.date; if (r.type) D.type = r.type;
  const rr = C.parseReceiptText(txt);
  if (rr.tax || rr.tip || rr.discount || rr.shipping || rr.items.length) applyReceiptData(rr, 'texto');
  else D.note = D.note || txt.slice(0, 280);
  rerenderTx();
}

/* ================= Detalle de movimiento ================= */
function txDetail(id) {
  const t = txById(id); if (!t) return;
  const inflow = INFLOW.has(t.type);
  const sp = t.split?.parts?.length ? t.split : null;
  const inst = C.installmentStatus(t, thisMonth());
  const linkA = (u, l) => u && validUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)}</a>` : '';
  openSheet({ title: TYPES[t.type], body: `
    <div style="text-align:center;padding:6px 0 14px"><div style="font-size:34px;font-weight:750;letter-spacing:-.03em">${t.type === 'transfer' ? money(t.amount) : signed(t.amount, inflow)}</div><div class="muted">${esc(txTitle(t))}</div>${statusPill(t)}</div>
    <div class="card"><dl class="kv">
      <dt>Fecha</dt><dd>${esc(fdLong(t.date))}${t.time ? ' · ' + esc(t.time) : ''}</dd>
      <dt>Cuenta</dt><dd>${esc(accById(t.accountId)?.name || '—')}${t.toAccountId ? ' → ' + esc(accById(t.toAccountId)?.name || '') : ''}</dd>
      ${t.categoryId ? `<dt>Categoría</dt><dd>${esc(catById(t.categoryId)?.name || '')}</dd>${subName(t) ? `<dt>Subcategoría</dt><dd>${esc(subName(t))}</dd>` : ''}` : ''}
      ${t.tags?.length ? `<dt>Etiquetas</dt><dd>${t.tags.map(x => `<span class="pill">${esc(x)}</span>`).join(' ')}</dd>` : ''}
      ${t.personId ? `<dt>Persona</dt><dd>${esc(personName(t.personId))}</dd>` : ''}
      ${t.people?.length ? `<dt>Personas</dt><dd>${esc(t.people.map(personName).join(', '))}</dd>` : ''}
      ${t.type === 'repay_in' || t.type === 'repay_out' ? `<dt>Capital</dt><dd>${money(t.capital || 0)}</dd><dt>Interés</dt><dd>${money(t.interest || 0)}</dd>` : ''}
      ${t.extras ? Object.entries(t.extras).filter(([k]) => k !== 'custom').map(([k, v]) => `<dt>${esc({ tip: 'Propina', tax: 'Impuestos', discount: 'Descuentos', shipping: 'Envío' }[k])}</dt><dd>${money(v)}</dd>`).join('') + (t.extras.custom || []).map(c => `<dt>${esc(c.label)}</dt><dd>${money(c.amount)}</dd>`).join('') : ''}
      ${t.type === 'expense' && t.merchant ? `<dt>Tienda</dt><dd>${esc(t.merchant)}</dd>` : ''}
      ${t.location || t.mapsUrl ? `<dt>${t.type === 'expense' ? 'Dónde es' : 'Ubicación'}</dt><dd>${esc(t.location)} ${linkA(t.mapsUrl, 'Abrir en Google Maps')}</dd>` : ''}
      ${t.productUrl ? `<dt>Página</dt><dd>${linkA(t.productUrl, (() => { try { return 'Abrir ' + new URL(t.productUrl).hostname.replace(/^www\./, ''); } catch (e) { return 'Abrir sitio'; } })())}</dd>` : ''}
      ${t.reference ? `<dt>Referencia</dt><dd>${esc(t.reference)}</dd>` : ''}
      <dt>Fuente</dt><dd>${esc(SOURCES[t.source] || t.source || 'Manual')}</dd>
      <dt>Creado</dt><dd>${esc(fdt(t.createdAt))}</dd>
      ${t.version > 1 ? `<dt>Editado</dt><dd>${esc(fdt(t.updatedAt))}</dd>` : ''}
    </dl>${t.items?.length ? `<div class="db-h" style="padding:16px 0 6px">Ítems</div><table class="sched it-view"><thead><tr><th>Ítem</th><th>Nombre</th><th>Cant.</th><th>P. unit.</th><th>Total</th></tr></thead><tbody>${t.items.map((it, i) => `<tr><td>${i + 1}</td><td style="text-align:left">${esc(it.name)}</td><td>${it.qty}</td><td class="amt">${esc(C.formatMoney(it.unitPrice))}</td><td class="amt">${esc(C.formatMoney(it.total))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4" style="text-align:left;font-weight:650">Suma</td><td class="amt" style="font-weight:650">${esc(C.formatMoney(C.sum(t.items.map(x => x.total))))}</td></tr></tfoot></table>` : ''}${t.note ? `<div class="db-h" style="padding:14px 0 4px">${t.type === 'expense' ? 'Comentarios adicionales' : 'Notas'}</div><p style="margin:0;white-space:pre-wrap">${esc(t.note)}</p>` : ''}</div>
    ${sp ? `<div class="card"><b>Gasto compartido</b><dl class="kv" style="margin-top:8px"><dt>Salida total</dt><dd>${money(t.amount)}</dd><dt>Tu gasto</dt><dd>${money(C.personalAmount(t))}</dd><dt>Por cobrar</dt><dd>${money(C.sum(C.receivableParts(t).map(r => r.pending)))}</dd></dl>
      <div style="margin-top:10px">${sp.parts.map(p => `<div class="row-item" style="padding:8px 0"><span class="grow"><span class="t">${esc(personName(p.personId))}</span><span class="s">${p.gift ? 'Regalo / asumido' : (p.collected || 0) >= p.amount ? 'Cobrado' : (p.collected ? 'Cobrado ' + esc(C.formatMoney(p.collected)) : 'Pendiente')}</span></span><span class="r">${money(p.amount)}</span>${!p.gift && (p.collected || 0) < p.amount && C.isActive(t) ? `<button class="btn" style="min-height:38px;padding:6px 12px" data-act="collectForm" data-id="${t.id}" data-v="${p.personId}">Cobrar</button>` : ''}</div>`).join('')}</div></div>` : ''}
    ${inst ? `<div class="card"><b>Compra a cuotas</b><dl class="kv" style="margin-top:8px"><dt>Cuotas</dt><dd>${inst.n} de ${money(inst.value)}</dd><dt>Cuotas causadas</dt><dd>${inst.paidCount}</dd><dt>Pendientes</dt><dd>${inst.pendingCount} · ${money(inst.pendingAmount)}</dd><dt>Primera cuota</dt><dd>${esc(C.monthLabel(t.installments.firstMonth))}</dd></dl></div>` : ''}
    ${t.receipt ? `<div class="card"><b>Comprobante</b> ${typeof driveReceiptPill === 'function' ? driveReceiptPill(t) : '<span class="pill">En este dispositivo</span>'}<div id="rcptView" style="margin-top:10px" class="muted small">Cargando…</div>${typeof driveReceiptLink === 'function' ? driveReceiptLink(t) : ''}</div>` : ''}`,
    footer: `${t.status !== 'confirmed' ? `<button class="btn primary" data-act="txConfirm" data-id="${t.id}">${ic('check', 'sm')} Confirmar</button>` : ''}
      ${['expense', 'income', 'transfer', 'adjust'].includes(t.type) ? `<button class="btn" data-act="txEdit" data-id="${t.id}">${ic('edit', 'sm')} Editar</button><button class="btn" data-act="txDup" data-id="${t.id}" aria-label="Duplicar">${ic('copy', 'sm')}</button>` : ''}
      <button class="btn danger" data-act="txDelete" data-id="${t.id}" aria-label="Eliminar">${ic('trash', 'sm')}</button>` });
  if (t.receipt) Promise.all([Store.get('rcpt:' + t.id), Store.get('rcptthumb:' + t.id)]).then(([b, th]) => {
    const el = $('#rcptView'); if (!el) return;
    if (!b) { el.textContent = 'El archivo ya no está en este dispositivo.'; return; }
    const url = URL.createObjectURL(b), pic = th ? URL.createObjectURL(th) : (b.type.startsWith('image/') ? url : null);
    el.innerHTML = `${pic ? `<button type="button" class="thumb-open" data-act="rcptView" data-id="${t.id}" aria-label="Ver cómo quedó la factura"><img class="thumb" src="${pic}" alt="Factura"></button><div class="small muted vw-tip">Toca la factura para verla completa</div>` : ''}${b.type === 'application/pdf' ? `<button type="button" class="btn block" style="margin-top:10px" data-act="rcptView" data-id="${t.id}">${ic('doc', 'sm')} Ver factura (${Math.round(b.size / 1024)} KB)</button>` : ''}`;
  });
}
async function txDelete(id) {
  const t = txById(id); if (!t) return;
  if (t.loanId) { toast('Este movimiento pertenece a un préstamo. Gestiónalo desde el préstamo.'); return; }
  t.deletedAt = new Date().toISOString();
  if (t.type === 'collect' && t.refTxId) { const src = txById(t.refTxId); const part = src?.split?.parts.find(p => p.personId === t.personId); if (part) part.collected = Math.max(0, (part.collected || 0) - t.amount); }
  if (t.expectedId) { const x = S.expected.find(e => e.id === t.expectedId); if (x) { x.status = 'expected'; x.receivedAmount = null; x.txId = null; } }
  audit('transaction.deleted', 'transaction', id, `Movimiento enviado a la papelera: ${TYPES[t.type]} de ${C.formatMoney(t.amount)}`);
  save(); await closeSheet(true); render();
  toast('Enviado a la papelera', 'Deshacer', () => { t.deletedAt = null; save(); render(); });
}

/* ================= Cuentas (solo como etiqueta del movimiento) ================= */
let AF = null;
function accountForm(id, target) {
  const a = id ? accById(id) : null;
  AF = a ? JSON.parse(JSON.stringify(a)) : { id: null, name: '', type: 'bank', currency: 'COP', _target: target || null };
  openSheet({ id: 'acc', title: a ? 'Editar cuenta' : 'Nueva cuenta', body: accountBody(), footer: `<button class="btn primary" data-act="accountSave">Guardar</button>${a ? `<button class="btn" data-act="accountArchive" data-id="${a.id}">${a.archived ? 'Reactivar' : 'Archivar'}</button>` : ''}`, onClose: () => { AF = null; } });
}
function accountBody() {
  const f = AF;
  return `<div class="field"><label for="an">Nombre</label><input id="an" class="input" data-af="name" value="${esc(f.name)}" placeholder="Ej. Nequi, Bancolombia, RappiCard" autocomplete="off" data-autofocus></div>
    <div class="field"><span class="lbl">Tipo</span>${seg('Tipo', Object.entries({ bank: 'Banco', wallet: 'Billetera', credit: 'Tarjeta', cash: 'Efectivo' }), f.type, 'afType')}<p class="hint">Si es tarjeta, el formulario muestra las cuotas de una vez.</p></div>
    <div id="accErr" class="err" role="alert"></div>`;
}
function accountSave() {
  const f = AF, err = m => { $('#accErr').textContent = m; };
  const name = (f.name || '').trim();
  if (!name) return err('Escribe un nombre.');
  if (S.accounts.some(a => a.id !== f.id && !a.archived && a.name.toLowerCase() === name.toLowerCase())) return err('Ya existe una cuenta con ese nombre.');
  const old = f.id ? accById(f.id) : null;
  const rec = Object.assign(old || { id: uid(), initialBalance: 0, currency: 'COP', archived: false, createdAt: new Date().toISOString() }, { name, type: f.type });
  if (!old) S.accounts.push(rec);
  const target = f._target;
  save(); closeSheet(true);
  if (D) { if (target) D[target] = rec.id; else if (!D.accountId) D.accountId = rec.id; rerenderTx(); }
  render(); toast('Cuenta guardada');
}

/* ================= Préstamos ================= */
let LF = null;
function loanForm(dir) {
  LF = { direction: dir || 'given', personId: '', principalText: '', accountId: activeAccounts()[0]?.id || '', date: today(), interestMode: 'none', rateText: '', termMonths: '1', installments: '1', firstDue: C.addMonthsISO(today(), 1), note: '' };
  openSheet({ id: 'loan', title: 'Nuevo préstamo', body: loanBody(), footer: `<button class="btn primary" data-act="loanSave">Guardar préstamo</button>`, onClose: () => { LF = null; } });
}
function loanCalc() {
  const P = C.evalAmount(LF.principalText) || 0;
  const rate = LF.interestMode === 'none' ? 0 : Math.round((C.parseNumberToken(String(LF.rateText || '0').replace('%', '')) || 0) * 100);
  const l = { principal: P, rateBp: rate, interestMode: LF.interestMode, termMonths: Number(LF.termMonths) || 1, installments: Number(LF.installments) || 1, firstDue: LF.firstDue || today(), payments: [] };
  return l;
}
function loanPreviewHTML() {
  const f = LF, l = loanCalc(), I = C.loanTotalInterest(l), sch = l.principal ? C.loanSchedule(l) : [];
  return l.principal ? `<dl class="kv"><dt>Interés total</dt><dd>${money(I)}</dd><dt>Total a ${f.direction === 'given' ? 'recibir' : 'pagar'}</dt><dd>${money(l.principal + I)}</dd><dt>Cuota</dt><dd>${money(sch[0]?.amount || 0)} × ${sch.length}</dd><dt>Última cuota</dt><dd>${esc(fdFull(sch[sch.length - 1]?.due))}</dd></dl>` : '<span class="muted small">Escribe el valor para ver el cronograma.</span>';
}
function loanBody() {
  const f = LF;
  return `${seg('Dirección', [['given', 'Yo presté'], ['received', 'Me prestaron']], f.direction, 'lfDir')}
    <div class="field" style="margin-top:14px"><label for="lp">Persona</label><div style="display:flex;gap:8px"><select id="lp" class="input" data-lf="personId">${optionList(S.people.filter(p => !p.archived).map(p => [p.id, p.name]), f.personId, 'Elegir…')}</select><button type="button" class="btn" data-act="quickPerson" aria-label="Nueva persona">${ic('plus', 'sm')}</button></div></div>
    <div class="field"><label for="lpr">Valor prestado</label><input id="lpr" class="input" inputmode="decimal" data-lf="principalText" value="${esc(f.principalText)}" placeholder="$ 0"></div>
    <div class="field"><label for="lac">${f.direction === 'given' ? 'Sale de la cuenta' : 'Entra a la cuenta'}</label><select id="lac" class="input" data-lf="accountId">${optionList(activeAccounts().map(a => [a.id, a.name]), f.accountId)}</select></div>
    <div class="field"><label for="ld">Fecha</label><input id="ld" type="date" class="input" data-lf="date" value="${esc(f.date)}"></div>
    <div class="field"><span class="lbl">Interés</span>${seg('Interés', [['none', 'Sin interés'], ['simple', 'Simple'], ['compound', 'Compuesto']], f.interestMode, 'lfInt')}
      ${f.interestMode === 'compound' ? '<p class="hint warn">El interés compuesto solo debe usarse si se acordó expresamente.</p>' : ''}</div>
    ${f.interestMode !== 'none' ? `<div class="grid2"><div class="field"><label for="lr">Tasa mensual (%)</label><input id="lr" class="input" inputmode="decimal" data-lf="rateText" value="${esc(f.rateText)}" placeholder="2"></div><div class="field"><label for="lt">Plazo (meses)</label><input id="lt" class="input" inputmode="numeric" data-lf="termMonths" value="${esc(f.termMonths)}"></div></div>` : ''}
    <div class="grid2"><div class="field"><label for="li">Nº de cuotas</label><input id="li" class="input" inputmode="numeric" data-lf="installments" value="${esc(f.installments)}"></div><div class="field"><label for="lf1">Primera cuota</label><input id="lf1" type="date" class="input" data-lf="firstDue" value="${esc(f.firstDue)}"></div></div>
    <div class="field"><label for="ln">Nota</label><input id="ln" class="input" data-lf="note" value="${esc(f.note)}" autocomplete="off"></div>
    <div class="card flat" id="loanPrev">${loanPreviewHTML()}</div>
    <div id="loanErr" class="err" role="alert"></div>`;
}
function loanSave() {
  const f = LF, l = loanCalc(), err = m => { $('#loanErr').textContent = m; };
  if (!personById(f.personId)) return err('Elige o crea la persona.');
  if (!l.principal || l.principal <= 0) return err('Escribe un valor válido.');
  if (!accById(f.accountId)) return err('Elige una cuenta.');
  if (l.installments < 1 || l.installments > 120 || l.termMonths < 1 || l.termMonths > 360) return err('Revisa cuotas y plazo.');
  if (f.interestMode !== 'none' && (!l.rateBp || l.rateBp > 2000)) return err('Revisa la tasa mensual (entre 0,01 % y 20 %).');
  const loan = Object.assign(l, { id: uid(), direction: f.direction, personId: f.personId, accountId: f.accountId, startDate: f.date, note: f.note.trim(), createdAt: new Date().toISOString(), statusOverride: null, rulesVersion: 1 });
  const tx = { id: uid(), idempotencyKey: uid(), type: f.direction === 'given' ? 'loan_out' : 'loan_in', amount: l.principal, accountId: f.accountId, personId: f.personId, loanId: loan.id, date: f.date, time: C.nowTime(), status: 'confirmed', source: 'loan', currency: 'COP', note: f.note.trim(), tags: [], createdAt: new Date().toISOString(), version: 1 };
  const src = f.fromTxId ? txById(f.fromTxId) : null;
  if (src) { // se convierte el gasto existente (conserva su soporte e historial)
    Object.assign(src, { type: tx.type, amount: tx.amount, accountId: tx.accountId, personId: tx.personId, loanId: loan.id, date: tx.date, source: 'loan', nature: null, split: null, installments: null, updatedAt: new Date().toISOString(), version: (src.version || 0) + 1 });
    loan.txId = src.id; S.loans.push(loan);
  } else { loan.txId = tx.id; S.loans.push(loan); S.transactions.push(tx); }
  audit('loan.created', 'loan', loan.id, `Préstamo ${f.direction === 'given' ? 'entregado a' : 'recibido de'} ${personName(f.personId)} por ${C.formatMoney(l.principal)}`);
  save(); closeSheet(true); ui.loanTab = f.direction; render(); toast('Préstamo registrado');
}
function loanDetail(id) {
  const l = loanById(id); if (!l) return;
  const s = C.loanSummary(l, today());
  let cum = 0;
  openSheet({ id: 'loanD', title: (l.direction === 'given' ? 'Prestado a ' : 'Me prestó ') + personName(l.personId), body: `
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="muted small">Saldo pendiente</div><div style="font-size:30px;font-weight:750">${money(s.balance)}</div></div><span class="pill ${LOAN_PILL[s.status]}">${LOAN_LABEL[s.status]}</span></div>
      <div style="margin:12px 0">${progress(s.total ? s.paid / s.total * 100 : 0, s.status === 'overdue' ? 'over' : '')}</div>
      <dl class="kv"><dt>Principal</dt><dd>${money(l.principal)}</dd>${l.interestMode !== 'none' ? `<dt>Tasa</dt><dd>${(l.rateBp / 100).toLocaleString('es-CO')} % mensual ${l.interestMode === 'simple' ? 'simple' : 'compuesto'}</dd>` : ''}<dt>Interés total</dt><dd>${money(s.interest)}</dd>
      <dt>Pagado</dt><dd>${money(s.paid)}</dd><dt>· a capital</dt><dd>${money(s.paidCapital)}</dd><dt>· a interés</dt><dd>${money(s.paidInterest)}</dd>
      ${s.next && s.balance ? `<dt>Próxima fecha</dt><dd>${esc(fdFull(s.next.due))}</dd>` : ''}${s.daysLate ? `<dt>Días de atraso</dt><dd class="neg">${s.daysLate}</dd>` : ''}
      <dt>Cuenta</dt><dd>${esc(accById(l.accountId)?.name || '—')}</dd><dt>Desde</dt><dd>${esc(fdFull(l.startDate))}</dd></dl>${l.note ? `<p class="muted">${esc(l.note)}</p>` : ''}</div>
    ${sectionH('Cronograma')}<div class="card" style="padding:8px 14px"><table class="sched"><thead><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota</th></tr></thead><tbody>
      ${s.schedule.map(r => { cum += r.amount; return `<tr class="${cum <= s.paid ? 'paid' : ''}"><td>${r.k}</td><td>${esc(fdShort(r.due))}</td><td class="amt">${esc(C.formatMoney(r.capital))}</td><td class="amt">${esc(C.formatMoney(r.interest))}</td><td class="amt">${esc(C.formatMoney(r.amount))}</td></tr>`; }).join('')}</tbody></table></div>
    ${sectionH('Abonos')}<div class="list">${(l.payments || []).length ? l.payments.slice().reverse().map(p => `<div class="row-item" ${p.txId && txById(p.txId) ? `data-act="txDetail" data-id="${p.txId}" role="button" tabindex="0" style="cursor:pointer"` : ''}><span class="ico">${ic(txById(p.txId)?.receipt ? 'clip' : 'coin')}</span><span class="grow"><span class="t">${esc(fdLong(p.date))}</span><span class="s">Capital ${esc(C.formatMoney(p.capital))} · interés ${esc(C.formatMoney(p.interest))} · ${esc(accById(p.accountId)?.name || '')}</span></span><span class="r">${money(p.amount)}</span></div>`).join('') : '<p class="muted small" style="padding:14px;margin:0">Sin abonos todavía.</p>'}</div>
    ${!l.statusOverride && s.balance > 0 ? `<div class="btn-row"><button class="btn" data-act="loanOverride" data-id="${l.id}" data-v="forgiven">Condonar</button><button class="btn" data-act="loanOverride" data-id="${l.id}" data-v="cancelled">Cancelar</button></div>` : (l.statusOverride ? `<button class="btn block" data-act="loanOverride" data-id="${l.id}" data-v="">Reactivar</button>` : '')}
    <p class="hint">La devolución de capital no se cuenta como ingreso en los reportes; solo el interés.</p>`,
    footer: s.balance > 0 && !l.statusOverride ? (l.direction === 'given' ? `<button class="btn primary" data-act="loanPayIncome" data-id="${l.id}">${ic('plus', 'sm')} Registrar abono con soporte</button>` : `<button class="btn primary" data-act="paymentForm" data-id="${l.id}">${ic('plus', 'sm')} Registrar abono</button>`) : '' });
}
function paymentForm(id) {
  const l = loanById(id), s = C.loanSummary(l, today());
  const def = Math.min(s.next?.amount || s.balance, s.balance);
  openSheet({ id: 'pay', title: l.direction === 'given' ? 'Abono recibido' : 'Abono pagado', body: `
    <div class="field"><label for="pa">Valor</label><input id="pa" class="input" inputmode="decimal" value="${def}" data-live="payPrev" data-id="${l.id}"></div>
    <div class="field"><label for="pacc">${l.direction === 'given' ? '¿En qué cuenta lo recibiste?' : '¿Desde qué cuenta pagaste?'}</label><select id="pacc" class="input">${optionList(activeAccounts().map(a => [a.id, a.name]), '', 'Elegir cuenta…')}</select></div>
    <div class="field"><label for="pd">Fecha</label><input id="pd" type="date" class="input" value="${today()}"></div>
    <div class="field"><label for="pn">Nota</label><input id="pn" class="input" autocomplete="off"></div>
    <div class="card flat small" id="payPrev"></div><div id="payErr" class="err" role="alert"></div>`, footer: `<button class="btn primary" data-act="paymentSave" data-id="${l.id}">Guardar abono</button>` });
  payPreview(l.id);
}
function payPreview(id) {
  const l = loanById(id), v = C.evalAmount($('#pa')?.value), el = $('#payPrev'); if (!el) return;
  const a = v ? C.allocatePayment(l, v) : null;
  el.innerHTML = !a ? 'Escribe el valor.' : a.error ? `<span class="neg">${esc(a.error)}</span>` : `Se aplica <b>${esc(C.formatMoney(a.interest))}</b> a interés y <b>${esc(C.formatMoney(a.capital))}</b> a capital. Saldo después: <b>${esc(C.formatMoney(C.loanSummary(l, today()).balance - v))}</b>.`;
}
function paymentSave(id) {
  const l = loanById(id), v = C.evalAmount($('#pa').value), acc = $('#pacc').value, date = $('#pd').value || today(), err = m => { $('#payErr').textContent = m; };
  const a = v ? C.allocatePayment(l, v) : { error: 'Escribe un valor válido.' };
  if (a.error) return err(a.error);
  if (!accById(acc)) return err('Elige la cuenta.');
  const tx = { id: uid(), idempotencyKey: uid(), type: l.direction === 'given' ? 'repay_in' : 'repay_out', amount: v, interest: a.interest, capital: a.capital, accountId: acc, personId: l.personId, loanId: l.id, date, time: C.nowTime(), status: 'confirmed', source: 'loan', currency: 'COP', note: $('#pn').value.trim(), tags: [], createdAt: new Date().toISOString(), version: 1 };
  l.payments = l.payments || [];
  l.payments.push({ id: uid(), date, amount: v, interest: a.interest, capital: a.capital, accountId: acc, txId: tx.id, note: tx.note });
  S.transactions.push(tx);
  audit('loan.payment', 'loan', l.id, `Abono de ${C.formatMoney(v)} (${l.direction === 'given' ? 'recibido de' : 'pagado a'} ${personName(l.personId)})`);
  save(); closeSheet(true); closeSheet(true); render(); loanDetail(l.id); toast('Abono registrado');
}

/* ================= Gastos compartidos: cobros ================= */
function receivablePerson(pid) {
  const rs = allReceivables().filter(r => r.personId === pid);
  openSheet({ title: 'Te debe ' + personName(pid), body: `<div class="list">${rs.map(r => { const t = txById(r.txId); return `<div class="row-item"><span class="ico">${ic(txIcon(t))}</span><span class="grow"><span class="t">${esc(txTitle(t))}</span><span class="s">${esc(fdShort(t.date))} · parte ${esc(C.formatMoney(r.amount))}</span></span><span class="r">${money(r.pending)}</span><button class="btn" style="min-height:38px;padding:6px 12px" data-act="collectForm" data-id="${t.id}" data-v="${pid}">Cobrar</button></div>`; }).join('')}</div>
    <p class="hint">Cobrar registra la entrada de dinero en tu cuenta sin contarla como ingreso: solo reduce lo que te deben.</p>` });
}
function collectForm(txId, pid) {
  const t = txById(txId), p = t.split.parts.find(x => x.personId === pid), pending = p.amount - (p.collected || 0);
  openSheet({ title: 'Cobrar a ' + personName(pid), body: `<p class="muted" style="margin-top:0">${esc(txTitle(t))} · pendiente <b>${money(pending)}</b></p>
    <div class="field"><label for="ca">Valor recibido</label><input id="ca" class="input" inputmode="decimal" value="${pending}"></div>
    <div class="field"><label for="cacc">¿En qué cuenta lo recibiste?</label><select id="cacc" class="input">${optionList(activeAccounts().map(a => [a.id, a.name]), t.accountId)}</select></div>
    <div class="field"><label for="cd">Fecha</label><input id="cd" type="date" class="input" value="${today()}"></div><div id="colErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="collectSave" data-id="${txId}" data-v="${pid}">Registrar cobro</button><button class="btn" data-act="markGift" data-id="${txId}" data-v="${pid}">Lo asumo yo</button>` });
}

/* ================= Presupuestos ================= */
function budgetForm(id) {
  const b = id ? S.budgets.find(x => x.id === id) : null;
  const f = b ? { ...b, valueText: String(b.value) } : { name: '', scope: 'global', ref: '', method: 'fixed', valueText: '', fromMonth: ui.month || thisMonth() };
  const d = b ? C.budgetDuration(b) : { kind: 'forever' };
  f.dur = d.kind === 'months' ? 'm' + d.n : d.kind; f.untilText = d.until || ''; f.fromMonth = f.fromMonth || '';
  window.BF = f;
  openSheet({ id: 'bud', title: b ? 'Editar presupuesto' : 'Nuevo presupuesto', body: budgetBody(), footer: `<button class="btn primary" data-act="budgetSave">Guardar</button>${b ? `<button class="btn danger" data-act="budgetDelete" data-id="${b.id}" aria-label="Eliminar">${ic('trash', 'sm')}</button>` : ''}` });
}
function budgetBody() {
  const f = window.BF;
  const refSel = { category: S.categories.filter(c => c.kind === 'expense' && !c.archived).map(c => [c.id, c.name]), subcategory: S.categories.filter(c => c.kind === 'expense' && !c.archived).flatMap(c => c.subs.map(s => [s.id, c.name + ' › ' + s.name])), nature: Object.entries(NATURES), account: S.accounts.map(a => [a.id, a.name]) }[f.scope];
  return `<div class="field"><label for="bs">Aplica a</label><select id="bs" class="input" data-bf="scope" data-rerender>${optionList([['global', 'Todo el gasto (global)'], ['category', 'Una categoría'], ['subcategory', 'Una subcategoría'], ['tag', 'Una etiqueta'], ['account', 'Una cuenta']], f.scope)}</select></div>
    ${refSel ? `<div class="field"><label for="br">¿Cuál?</label><select id="br" class="input" data-bf="ref">${optionList(refSel, f.ref, 'Elegir…')}</select></div>` : f.scope === 'tag' ? `<div class="field"><label for="br">Etiqueta</label><input id="br" class="input" data-bf="ref" value="${esc(f.ref)}" autocomplete="off"></div>` : ''}
    <div class="field"><label for="bn">Nombre</label><input id="bn" class="input" data-bf="name" value="${esc(f.name)}" placeholder="Se completa solo si lo dejas vacío" autocomplete="off"></div>
    <div class="field"><label for="bm2">Método</label><select id="bm2" class="input" data-bf="method" data-rerender>${optionList([['fixed', 'Valor fijo mensual'], ['pctExpected', '% de ingresos esperados'], ['pctReceived', '% de ingresos recibidos']], f.method)}</select></div>
    <div class="field"><label for="bv">${f.method === 'fixed' ? 'Valor' : 'Porcentaje (%)'}</label><input id="bv" class="input" inputmode="decimal" data-bf="valueText" value="${esc(f.valueText)}" placeholder="${f.method === 'fixed' ? '$ 0' : '30'}"></div>
    <div class="field"><label for="bd">¿Por cuánto tiempo?</label><select id="bd" class="input" data-bf="dur" data-rerender>${optionList(BUDGET_DUR, f.dur)}</select></div>
    <div class="grid2"><div class="field"><label for="bfm">Desde</label><input id="bfm" type="month" class="input" data-bf="fromMonth" data-rerender value="${esc(f.fromMonth)}"></div>
      ${f.dur === 'until' ? `<div class="field"><label for="bum">Hasta</label><input id="bum" type="month" class="input" data-bf="untilText" data-rerender value="${esc(f.untilText)}" min="${esc(f.fromMonth)}"></div>` : ''}</div>
    <p class="hint">${esc(budgetRangeText(budgetFormRange(f)))}${f.id ? '. Si cambias el valor, se corrige en todos los meses del presupuesto.' : ''}</p>
    <div id="budErr" class="err" role="alert"></div>`;
}
const BUDGET_DUR = [['once', 'Solo un mes'], ['m3', '3 meses'], ['m6', '6 meses'], ['m12', 'Un año (12 meses)'], ['until', 'Hasta un mes que elijas'], ['forever', 'Indefinido (todos los meses)']];
const RX_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// Del formulario a { fromMonth, untilMonth }. Sin "Desde" (presupuestos anteriores) aplica desde siempre.
function budgetFormRange(f) {
  const kind = f.dur.startsWith('m') ? 'months' : f.dur, from = RX_MONTH.test(f.fromMonth) ? f.fromMonth : null;
  const start = from || (kind === 'forever' || kind === 'until' ? null : ui.month || thisMonth());
  const until = RX_MONTH.test(f.untilText) ? f.untilText : null;
  return { fromMonth: start, untilMonth: start ? C.budgetUntil(start, kind, Number(f.dur.slice(1)), until) : (kind === 'until' ? until : null) };
}
function budgetRangeText(r) {
  const L = k => C.monthLabel(k).toLowerCase();
  if (!r.untilMonth) return r.fromMonth ? 'Todos los meses desde ' + L(r.fromMonth) : 'Todos los meses';
  if (r.fromMonth === r.untilMonth) return 'Solo ' + L(r.fromMonth);
  const n = r.fromMonth ? C.monthDiff(r.fromMonth, r.untilMonth) + 1 : 0;
  return (r.fromMonth ? 'De ' + L(r.fromMonth) + ' a ' : 'Hasta ') + L(r.untilMonth) + (n ? ' (' + n + ' meses)' : '');
}

/* ================= Metas ================= */
/* ================= Quiero comprar ================= */
const PRI = [['1', 'Alta'], ['2', 'Media'], ['3', 'Baja']];
function condText(w) {
  const c = w.cond || {}, out = [];
  if (c.price) out.push('Cuando baje a ' + C.formatMoney(c.price));
  if (c.cuotas) out.push('A ' + c.cuotas + ' cuotas sin interés');
  if (c.text) out.push(c.text);
  return out.join(' · ');
}
function wishForm(id) {
  const w = id ? S.wishes.find(x => x.id === id) : null, c = w?.cond || {};
  openSheet({ id: 'wish', title: w ? 'Editar deseo' : 'Quiero comprar', body: `
    <div class="field"><label for="wn">¿Qué quieres comprar? *</label><input id="wn" class="input" value="${esc(w?.name || '')}" placeholder="Ej. Audífonos inalámbricos" autocomplete="off"></div>
    <div class="field"><label for="wp">Precio aproximado *</label><input id="wp" class="input" inputmode="decimal" value="${w ? esc(Number(w.price).toLocaleString('es-CO')) : ''}" placeholder="$ 0" autocomplete="off"></div>
    <div class="field"><label for="wl">Link de compra</label><div style="display:flex;gap:8px"><input id="wl" class="input" inputmode="url" value="${esc(w?.link || '')}" placeholder="https://…" autocomplete="off" spellcheck="false" style="flex:1;min-width:0"><button type="button" class="btn" data-act="wishPaste">${ic('paste', 'sm')} Pegar</button></div></div>
    <div class="field"><span class="lbl">Prioridad</span><div class="chips">${PRI.map(([v, l]) => `<button type="button" class="chip" data-act="wishPri" data-v="${v}" aria-pressed="${String(w?.priority || 2) === v}">${l}</button>`).join('')}</div></div>
    <div class="grid2">
      <div class="field"><label for="wy">Por qué comprarlo</label><textarea id="wy" class="input" rows="4" placeholder="Lo uso todos los días…">${esc(w?.why || '')}</textarea></div>
      <div class="field"><label for="wyn">Por qué no comprarlo</label><textarea id="wyn" class="input" rows="4" placeholder="El que tengo aún sirve…">${esc(w?.whyNot || '')}</textarea></div>
    </div>
    <div class="sub-h">Condiciones de compra</div>
    <div class="grid2">
      <div class="field"><label for="wcp">Comprarlo cuando baje a</label><input id="wcp" class="input" inputmode="decimal" value="${c.price ? esc(Number(c.price).toLocaleString('es-CO')) : ''}" placeholder="$ precio objetivo" autocomplete="off"></div>
      <div class="field"><label for="wcq">Cuotas sin interés</label><input id="wcq" class="input" inputmode="numeric" value="${c.cuotas || ''}" placeholder="Ej. 12" autocomplete="off"></div>
    </div>
    <div class="field"><label for="wct">Otra condición</label><input id="wct" class="input" value="${esc(c.text || '')}" placeholder="Ej. Esperar el Black Friday, que salga el modelo nuevo…" autocomplete="off"></div>
    <div id="wishErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="wishSave" data-id="${w?.id || ''}">${ic('check', 'sm')} Guardar</button>` });
}
function wishStatusText(x, p) {
  if (x.now) return { t: 'Te alcanza hoy', cls: 'ok' };
  if (x.fits) return { t: 'Te alcanza en ' + C.monthLabel(x.eta || p.horizonKey).toLowerCase(), cls: 'ok' };
  return { t: x.eta ? 'Alcanza en ' + C.monthLabel(x.eta).toLowerCase() : 'Define un presupuesto mensual', cls: 'warn' };
}
function wishDetail(id) {
  const w = S.wishes.find(x => x.id === id); if (!w) return;
  const p = C.wishPlan(S.wishFund, S.wishes, today()), x = p.items.find(i => i.w.id === id), st = x ? wishStatusText(x, p) : null;
  const ct = condText(w), lk = w.link && validUrl(w.link);
  const host = lk ? (() => { try { return new URL(w.link).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })() : '';
  openSheet({ id: 'wishD', title: w.name, body: `
    <div class="card"><div class="muted small">${w.status === 'bought' ? 'Pagaste' : 'Precio'}</div><div style="font-size:30px;font-weight:750">${money(w.status === 'bought' ? w.paid : w.price)}</div>
      <div class="small" style="margin-top:6px">${w.status === 'active' ? `<span class="pill ${st.cls}">${esc(st.t)}</span> <span class="muted">· Prioridad ${PRI[(w.priority || 2) - 1][1].toLowerCase()}</span>` : w.status === 'bought' ? `<span class="pill ok">Comprado${w.boughtDate ? ' el ' + esc(fdShort(w.boughtDate)) : ''}</span>${w.fromFund === false ? ' <span class="muted">· no se descontó del fondo</span>' : ''}` : '<span class="pill">Descartado</span>'}</div>
      ${w.status === 'active' && x ? `<p class="muted small" style="margin:10px 0 0">Con lo que está antes en tu lista necesitas ${money(x.cum)} en total. Hoy tienes ${money(p.available)} en el fondo.</p>` : ''}
      ${lk ? `<a class="btn block" style="margin-top:12px" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">${ic('cart', 'sm')} Comprar${host ? ' en ' + esc(host) : ''}</a>` : ''}</div>
    ${ct ? `<div class="card"><div class="db-h" style="padding:0 0 6px">Condiciones de compra</div><p style="margin:0">${esc(ct)}</p></div>` : ''}
    ${w.why || w.whyNot ? `<div class="grid2 wish-pc">
      <div class="card"><div class="db-h" style="padding:0 0 6px">Por qué comprarlo</div><p style="margin:0;white-space:pre-wrap">${esc(w.why || '—')}</p></div>
      <div class="card"><div class="db-h" style="padding:0 0 6px">Por qué no</div><p style="margin:0;white-space:pre-wrap">${esc(w.whyNot || '—')}</p></div></div>` : ''}
    <div class="btn-row">${w.status === 'active' ? `<button class="btn primary" data-act="wishBought" data-id="${w.id}">${ic('check', 'sm')} Lo compré</button><button class="btn" data-act="wishDiscard" data-id="${w.id}">Descartar</button>` : `<button class="btn" data-act="wishRestore" data-id="${w.id}">${ic('undo', 'sm')} Volver a la lista</button>`}</div>`,
    footer: `<button class="btn" data-act="wishEdit" data-id="${w.id}">${ic('edit', 'sm')} Editar</button><button class="btn danger" data-act="wishDelete" data-id="${w.id}" aria-label="Eliminar">${ic('trash', 'sm')}</button>` });
}
function wishBoughtForm(id) {
  const w = S.wishes.find(x => x.id === id); if (!w) return;
  openSheet({ id: 'wishB', title: 'Lo compré', body: `
    <p class="muted" style="margin-top:0">${esc(w.name)}</p>
    <div class="grid2"><div class="field"><label for="wbp">¿Cuánto pagaste?</label><input id="wbp" class="input" inputmode="decimal" value="${esc(Number(w.price).toLocaleString('es-CO'))}" autocomplete="off"></div>
      <div class="field"><label for="wbd">Fecha</label><input id="wbd" type="date" class="input" value="${today()}"></div></div>
    <div class="toggle-row"><div><div style="font-weight:600">Descontar del fondo</div><div class="hint" style="margin:2px 0 0">Apágalo si lo pagaste con otra plata</div></div><label class="switch"><input type="checkbox" id="wbf" checked aria-label="Descontar del fondo"><span></span></label></div>
    <div class="toggle-row"><div><div style="font-weight:600">Registrar también el gasto</div><div class="hint" style="margin:2px 0 0">Abre un movimiento nuevo con el valor y el link</div></div><label class="switch"><input type="checkbox" id="wbt" checked aria-label="Registrar también el gasto"><span></span></label></div>
    <div id="wbErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="wishBoughtSave" data-id="${w.id}">${ic('check', 'sm')} Guardar</button>` });
}
function wishFundForm() {
  const f = S.wishFund, cur = C.wishMonthly(f, C.monthKey(today())), y = Number(today().slice(0, 4));
  const opts = [[y + '-12-31', 'Fin de año'], [C.addMonthsISO(today(), 6), 'En 6 meses'], [C.addMonthsISO(today(), 12), 'En 1 año'], [(y + 1) + '-12-31', 'Fin del próximo año']];
  openSheet({ id: 'wishF', title: 'Fondo para lo que quiero', body: `
    <div class="field"><label for="wfm">Presupuesto mensual</label><input id="wfm" class="input" inputmode="decimal" value="${cur ? esc(Number(cur).toLocaleString('es-CO')) : ''}" placeholder="$ cada mes" autocomplete="off">
      <p class="hint">Lo que apartas cada mes para tus deseos. Si lo cambias, cuenta desde este mes; lo acumulado antes no cambia.</p></div>
    <div class="field"><label for="wfh">Planear hasta</label><input id="wfh" type="date" class="input" value="${esc(f.horizon)}">
      <div class="chips" style="margin-top:8px">${opts.map(([v, l]) => `<button type="button" class="chip" data-act="wishHz" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="sub-h">Ajuste (opcional)</div>
    <div class="grid2"><div class="field"><label for="wfa">Agregar o quitar</label><input id="wfa" class="input" inputmode="decimal" placeholder="Ej. 500000 o -200000" autocomplete="off"></div>
      <div class="field"><label for="wfn">Nota</label><input id="wfn" class="input" placeholder="Ej. Prima de diciembre" autocomplete="off"></div></div>
    ${(f.adjustments || []).length ? `<div class="list">${f.adjustments.slice().reverse().slice(0, 6).map(a => `<div class="row-item"><span class="grow"><span class="t">${esc(a.note || 'Ajuste')}</span><span class="s">${esc(fdShort(a.date))}</span></span><span class="r">${money(a.amount)}</span></div>`).join('')}</div>` : ''}
    <div id="wfErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="wishFundSave">${ic('check', 'sm')} Guardar</button>` });
}

/* ================= Reglas recurrentes ================= */
function ruleForm(idOrPreset) {
  const r = S.rules.find(x => x.id === idOrPreset);
  const salaryCat = S.categories.find(c => c.kind === 'income' && c.name === 'Salario');
  const f = r ? { ...r, daysText: (r.days || []).join(', '), datesText: (r.dates || []).join(', ') } : idOrPreset === 'salary'
    ? { kind: 'income', name: 'Salario', amount: '', accountId: activeAccounts()[0]?.id || '', categoryId: salaryCat?.id || '', payer: '', freq: 'monthly_days', daysText: '15, 30', startDate: thisMonth() + '-01', datesText: '', adjust: 'prev', active: true, notes: '' }
    : { kind: 'expense', name: '', amount: '', accountId: activeAccounts()[0]?.id || '', categoryId: '', payer: '', freq: 'monthly_days', daysText: '1', startDate: today(), datesText: '', adjust: 'none', active: true, notes: '' };
  window.RF = f;
  openSheet({ id: 'rule', title: r ? 'Editar regla' : 'Nueva regla recurrente', body: ruleBody(), footer: `<button class="btn primary" data-act="ruleSave">Guardar</button>${r ? `<button class="btn danger" data-act="ruleDelete" data-id="${r.id}" aria-label="Eliminar">${ic('trash', 'sm')}</button>` : ''}` });
}
function ruleBody() {
  const f = window.RF;
  return `${seg('Tipo', [['income', 'Ingreso'], ['expense', 'Pago']], f.kind, 'rfKind')}
    <div class="field" style="margin-top:14px"><label for="rn">Concepto</label><input id="rn" class="input" data-rf="name" value="${esc(f.name)}" autocomplete="off"></div>
    <div class="field"><label for="ra">Valor esperado</label><input id="ra" class="input" inputmode="decimal" data-rf="amount" value="${esc(f.amount)}" placeholder="$ 0"><p class="hint">Valor de cada pago. Podrás ajustarlo al confirmar.</p></div>
    <div class="grid2"><div class="field"><label for="racc">Cuenta</label><select id="racc" class="input" data-rf="accountId">${optionList(activeAccounts().map(a => [a.id, a.name]), f.accountId)}</select></div>
      <div class="field"><label for="rc">Categoría</label><select id="rc" class="input" data-rf="categoryId" data-rerender>${optionList(cats(f.kind).map(c => [c.id, c.name]), f.categoryId, '—')}</select></div></div>
    ${f.kind === 'expense' && catById(f.categoryId) ? `<div class="field"><label for="rsub">Subcategoría *</label><select id="rsub" class="input" data-rf="subcategoryId">${optionList(catById(f.categoryId).subs.filter(s => !s.archived).map(s => [s.id, s.name]), f.subcategoryId || '', 'Elegir…')}</select></div>` : ''}
    <div class="field"><label for="rp">${f.kind === 'income' ? 'Pagador' : 'A quién se paga'}</label><input id="rp" class="input" data-rf="payer" value="${esc(f.payer)}" autocomplete="off"></div>
    <div class="field"><label for="rfq">Frecuencia</label><select id="rfq" class="input" data-rf="freq" data-rerender>${optionList([['monthly_days', 'Días fijos del mes'], ['weekly', 'Semanal'], ['biweekly', 'Cada 14 días'], ['dates', 'Fechas específicas']], f.freq)}</select></div>
    ${f.freq === 'monthly_days' ? `<div class="field"><label for="rd">Días del mes</label><input id="rd" class="input" data-rf="daysText" value="${esc(f.daysText)}" placeholder="15, 30"><p class="hint">El 30 o 31 en meses cortos se toma como el último día.</p></div>` : ''}
    ${f.freq === 'dates' ? `<div class="field"><label for="rds">Fechas (AAAA-MM-DD, separadas por coma)</label><input id="rds" class="input" data-rf="datesText" value="${esc(f.datesText)}"></div>` : ''}
    <div class="field"><label for="rsd">${f.freq === 'weekly' || f.freq === 'biweekly' ? 'Primera fecha' : 'Desde'}</label><input id="rsd" type="date" class="input" data-rf="startDate" value="${esc(f.startDate)}"></div>
    <div class="field"><label for="radj">Si cae en fin de semana o festivo</label><select id="radj" class="input" data-rf="adjust">${optionList([['prev', 'Usar el día hábil anterior'], ['next', 'Usar el día hábil siguiente'], ['none', 'No ajustar']], f.adjust)}</select></div>
    <div class="field"><label for="rno">Notas (descuentos, retenciones, aportes…)</label><textarea id="rno" class="input" data-rf="notes">${esc(f.notes || '')}</textarea></div>
    <div class="toggle-row"><span style="font-weight:600">Regla activa</span><label class="switch"><input type="checkbox" data-rf="active" ${f.active ? 'checked' : ''} aria-label="Regla activa"><span></span></label></div><div id="ruleErr" class="err" role="alert"></div>`;
}
function expectedAct(id) {
  const x = S.expected.find(e => e.id === id); if (!x) return;
  const st = expectedStatus(x);
  openSheet({ id: 'exp', title: x.name, body: `<p class="muted" style="margin-top:0">${x.kind === 'income' ? 'Ingreso' : 'Pago'} esperado el <b>${esc(fdLong(x.due))}</b>${x.due !== x.nominal ? ` (fecha nominal ${esc(fdShort(x.nominal))}, ajustada por fin de semana o festivo)` : ''}. Valor esperado ${money(x.amount)}. <span class="pill ${EXP_PILL[st]}">${EXP_LABEL[st]}</span></p>
    ${x.receivedAmount != null ? `<p>Registrado: <b>${money(x.receivedAmount)}</b></p>` : ''}
    <div class="field"><label for="ea">${x.kind === 'income' ? 'Valor recibido' : 'Valor pagado'}</label><input id="ea" class="input" inputmode="decimal" value="${x.amount - (x.receivedAmount || 0)}"></div>
    <div class="field"><label for="eacc">Cuenta</label><select id="eacc" class="input">${optionList(activeAccounts().map(a => [a.id, a.name]), x.accountId)}</select></div>
    <div class="field"><label for="ed">Fecha real</label><input id="ed" type="date" class="input" value="${today() < x.due ? x.due : today()}"></div>
    <div class="field"><label for="edd">Cambiar fecha esperada</label><div style="display:flex;gap:8px"><input id="edd" type="date" class="input" value="${x.due}"><button class="btn" data-act="expMove" data-id="${x.id}">Mover</button></div></div>
    <div class="btn-row"><button class="btn" data-act="expStatus" data-id="${x.id}" data-v="skipped">Omitir</button><button class="btn" data-act="expStatus" data-id="${x.id}" data-v="cancelled">Cancelar</button></div><div id="expErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="expConfirm" data-id="${x.id}">${ic('check', 'sm')} ${x.kind === 'income' ? 'Confirmar recibido' : 'Registrar pago'}</button>` });
}

/* ================= Categorías y personas ================= */
function categoryForm(id) {
  const c = id ? catById(id) : null;
  window.CF = c ? JSON.parse(JSON.stringify(c)) : { id: null, name: '', icon: 'tag', color: COLORS[0], kind: 'expense', defaultNature: 'other', subs: [], archived: false };
  if (!window.CF.palette) window.CF.palette = assignPalettes([...S.categories.map(x => ({ palette: x.palette })), { kind: 'new' }]).pop().palette;
  openSheet({ id: 'cat', title: c ? 'Editar categoría' : 'Nueva categoría', body: categoryBody(), footer: `<button class="btn primary" data-act="categorySave">Guardar</button>` });
}
function categoryBody() {
  const f = window.CF;
  return `${seg('Tipo', [['expense', 'Gasto'], ['income', 'Ingreso']], f.kind, 'cfKind')}
    <div class="field" style="margin-top:14px"><label for="cn">Nombre</label><input id="cn" class="input" data-cf="name" value="${esc(f.name)}" autocomplete="off"></div>
    <div class="field"><span class="lbl">Ícono</span><div class="icon-grid">${CAT_ICON_KEYS.map(k => `<button type="button" class="icon-pick" data-act="cfIcon" data-v="${k}" aria-pressed="${f.icon === k}" aria-label="${k}">${ic(k)}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Color</span><div class="fam-grid">${Object.entries(CAT_FAMILIES).map(([k, fm]) => `<button type="button" class="fam-pick" data-act="cfPal" data-v="${k}" aria-pressed="${!f.colorHex && f.palette === k}" aria-label="${esc(fm.name)}" title="${esc(fm.name)}" style="--cc:${fm.base}"><i></i></button>`).join('')}</div>
      <div class="fam-prev" id="famPrev">${famPreview(f)}</div><p class="hint">Las subcategorías toman tonos de este color, en el orden en que aparecen.</p></div>
    ${f.kind === 'expense' ? `<div class="field"><label for="cnat">Naturaleza por defecto</label><select id="cnat" class="input" data-cf="defaultNature">${optionList(Object.entries(NATURES), f.defaultNature)}</select></div>` : ''}
    <div class="field"><span class="lbl">Subcategorías</span>${f.subs.map((s, k) => `<div style="display:flex;gap:8px;margin-bottom:8px"><input class="input" data-cfsub="${k}" value="${esc(s.name)}" aria-label="Subcategoría"><button class="btn" data-act="cfSubDel" data-v="${k}" aria-label="Quitar">${ic('x', 'sm')}</button></div>`).join('')}<button class="btn block" data-act="cfSubAdd">${ic('plus', 'sm')} Subcategoría</button></div>
    <div class="toggle-row"><span style="font-weight:600">Archivada</span><label class="switch"><input type="checkbox" data-cf="archived" ${f.archived ? 'checked' : ''} aria-label="Archivada"><span></span></label></div><div id="catErr" class="err" role="alert"></div>`;
}
function famPreview(f) {
  const sh = famShades(f), subs = (f.subs || []).filter(s => s.name.trim());
  return `<span class="fam-chip" style="--cc:${catColor(f)}"><i></i>${esc(f.name || 'Categoría')}</span>${subs.map((s, i) => `<span class="fam-chip" style="--cc:${s.color || sh[i % sh.length]}"><i></i>${esc(s.name)}</span>`).join('')}<button type="button" class="link-btn" data-act="catColors" style="min-height:0;padding:4px 0;font-size:13px">Personalizar colores exactos</button>`;
}
function personForm(id) {
  const p = id ? personById(id) : null;
  const loans = p ? S.loans.filter(l => l.personId === p.id).length : 0, shared = p ? S.transactions.filter(t => !t.deletedAt && t.split?.parts?.some(x => x.personId === p.id)).length : 0;
  openSheet({ id: 'person', title: p ? p.name : 'Nueva persona', body: `
    <div class="field"><label for="pn1">Nombre</label><input id="pn1" class="input" value="${esc(p?.name || '')}" autocomplete="off"></div>
    <div class="grid2"><div class="field"><label for="pa1">Alias</label><input id="pa1" class="input" value="${esc(p?.alias || '')}" autocomplete="off"></div><div class="field"><label for="pg1">Grupo</label><input id="pg1" class="input" value="${esc(p?.group || '')}" placeholder="Familia, pareja, trabajo…" list="pgList" autocomplete="off"><datalist id="pgList">${[...new Set(S.people.map(x => x.group).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist></div></div>
    <div class="field"><label for="pno1">Notas</label><textarea id="pno1" class="input">${esc(p?.notes || '')}</textarea></div>
    ${p ? `<div class="toggle-row"><span style="font-weight:600">Archivada</span><label class="switch"><input type="checkbox" id="par1" ${p.archived ? 'checked' : ''} aria-label="Archivada"><span></span></label></div><p class="hint">${loans} préstamo(s) · ${shared} gasto(s) compartido(s)</p>` : ''}<div id="perErr" class="err" role="alert"></div>`,
    footer: `<button class="btn primary" data-act="personSave" data-id="${p?.id || ''}">Guardar</button>` });
}

/* ================= Seguridad ================= */
function securitySheet() {
  const st = S.settings;
  openSheet({ id: 'sec', title: 'Bloqueo y desbloqueo', body: `
    <div class="card"><b>PIN de WalletWeb</b><p class="muted small">${st.pin ? 'Activo (' + st.pin.len + ' dígitos). Se guarda solo como hash.' : 'Sin PIN: cualquiera con tu teléfono desbloqueado podría ver tus datos.'}</p>
      <div class="grid2"><input class="input" id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="Nuevo PIN (4–6)" autocomplete="new-password" aria-label="Nuevo PIN"><input class="input" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Repetir" autocomplete="new-password" aria-label="Repetir PIN"></div>
      <button class="btn block" style="margin-top:10px" data-act="pinSave">${st.pin ? 'Cambiar PIN' : 'Crear PIN'}</button><div id="pinErr" class="err" role="alert"></div></div>
    <div class="card"><b>Desbloqueo del dispositivo (passkey)</b><p class="muted small">Usa Face ID, Touch ID, huella o Windows Hello si tu dispositivo lo permite. WalletWeb nunca recibe datos biométricos. El PIN sigue siendo la alternativa.</p>
      ${st.passkey ? `<p class="small">Activo desde ${esc(fdt(st.passkey.createdAt))} · ${esc(st.passkey.device || '')}</p><button class="btn block" data-act="passkeyRemove">Quitar passkey</button>` : `<button class="btn block" data-act="passkeyAdd" ${st.pin ? '' : 'disabled'}>${ic('face', 'sm')} Activar</button>${st.pin ? '' : '<p class="hint">Primero crea un PIN.</p>'}`}</div>
    <div class="card"><div class="field"><label for="lm">Bloquear tras inactividad</label><select id="lm" class="input" data-bind="settings.lockMinutes">${optionList([1, 2, 5, 10, 15].map(n => [String(n), n + (n === 1 ? ' minuto' : ' minutos')]), String(st.lockMinutes))}</select><p class="hint">No se puede desactivar.</p></div>
      ${sw('settings.lockOnHide', st.lockOnHide, 'Bloquear al salir de la app', 'Oculta importes de inmediato al cambiar de app')}
      ${sw('settings.privacy', st.privacy, 'Modo privacidad', 'Difumina importes y gráficos (también con el ícono del ojo)')}
      <button class="btn block" data-act="lockNow" ${st.pin ? '' : 'disabled'}>${ic('lock', 'sm')} Bloquear ahora</button></div>
    <p class="hint">Importante: el bloqueo protege la pantalla. Los datos guardados en el navegador no están cifrados con el PIN; protege también tu teléfono con código.</p>` });
}
function onboarding() {
  openSheet({ id: 'onb', title: 'Configurar WalletWeb', body: `
    <p style="margin-top:0">Tus finanzas se guardan <b>solo en este dispositivo</b>. Nada se envía a Internet.</p>
    <div class="card"><b>1. Crea un PIN</b><p class="muted small">Protege la app cuando no la usas. Es obligatorio.</p>
      <div class="grid2"><input class="input" id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="PIN (4–6)" autocomplete="new-password" aria-label="PIN"><input class="input" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Repetir" autocomplete="new-password" aria-label="Repetir PIN"></div><div id="pinErr" class="err" role="alert"></div></div>
    <div class="card"><b>2. ¿Con qué pagas?</b><p class="muted small">Toca las cuentas que usas para elegirlas rápido al registrar un movimiento. También puedes crearlas desde el formulario.</p>
      <div class="chips wrap" id="quickAccs">${[...S.institutions, 'Efectivo'].map(i => `<button type="button" class="chip" data-act="quickAcc" data-v="${esc(i)}" aria-pressed="${S.accounts.some(a => a.institution === i || (i === 'Efectivo' && a.type === 'cash'))}">${esc(i)}</button>`).join('')}</div>
      <p class="hint">¿Tarjeta de crédito? En el formulario elige “+ Nueva cuenta” y marca Tarjeta para registrar cuotas.</p></div>`,
    footer: `<button class="btn primary" data-act="onbFinish">Empezar</button>` });
}

/* ================= Selector de ubicación (OpenStreetMap + Leaflet, sin clave) ================= */
let leafletReady = null, MAP = null, mapPick = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js'; s.onload = res; s.onerror = () => { leafletReady = null; rej(new Error('leaflet')); }; document.head.appendChild(s);
  });
  return leafletReady;
}
function coordsFromLink(u) {
  const m = /[?&](?:q|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(u || '') || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}
// Proveedores de mapa gratuitos, en orden. Si uno falla se pasa al siguiente.
const TILE_PROVIDERS = [
  { id: 'carto', url: () => `https://{s}.basemaps.cartocdn.com/${document.documentElement.dataset.theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, opts: { subdomains: 'abcd', maxZoom: 20, attribution: '© OpenStreetMap © CARTO' } },
  { id: 'osm', url: () => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '© OpenStreetMap' } }
];
function mapMessage(html, retry) {
  const box = $('#mapBox'); if (!box) return;
  box.querySelectorAll('.map-msg').forEach(m => m.remove());
  if (!html) return;
  const m = document.createElement('div'); m.className = 'map-msg';
  m.innerHTML = `<div><p style="margin:0 0 12px">${html}</p>${retry ? '<button type="button" class="btn" data-act="mapRetry" style="pointer-events:auto">Reintentar</button> ' : ''}<a class="btn" style="pointer-events:auto" href="${esc(gmapsSearchUrl(D?.merchant, D?.location))}" target="_blank" rel="noopener noreferrer">Abrir Google Maps</a></div>`;
  box.appendChild(m);
}
function mapLoadTiles(k) {
  if (!MAP) return;
  if (window._tiles) { window._tiles.remove(); window._tiles = null; }
  const p = TILE_PROVIDERS[k];
  if (!p) {
    mapMessage(navigator.onLine === false ? 'Tu teléfono está sin conexión a internet.' : 'Los servidores de mapas no respondieron. Puede ser una red que los bloquea (por ejemplo la del trabajo).', true);
    return;
  }
  const box = $('#mapBox'); if (!box) return; // el mapa ya se cerró
  box.classList.toggle('osm', p.id === 'osm');
  let ok = 0, bad = 0;
  const layer = L.tileLayer(p.url(), Object.assign({ referrerPolicy: 'strict-origin-when-cross-origin', crossOrigin: false }, p.opts));
  layer.on('tileload', () => { if (!ok++) mapMessage(''); });
  layer.on('tileerror', () => { if (++bad >= 4 && !ok) mapLoadTiles(k + 1); });
  layer.addTo(MAP); window._tiles = layer;
  // si en 8 s no llegó ninguna imagen, probar el siguiente proveedor
  setTimeout(() => { if (MAP && window._tiles === layer && !ok) mapLoadTiles(k + 1); }, 8000);
}
async function mapPicker() {
  mapPick = null;
  const q = [D?.merchant].filter(Boolean).join(' ');
  openSheet({ id: 'map', title: 'Ubicar la tienda', body: `
    <div class="map-search"><input id="mapQ" class="input" placeholder="Nombre de la tienda o dirección" value="${esc(q)}" autocomplete="off" enterkeyhint="search"><button type="button" class="btn primary" data-act="mapSearch" aria-label="Buscar">${ic('search', 'sm')}</button></div>
    <div id="mapResults" class="list map-results" hidden></div>
    <div id="mapBox" class="map-box" role="application" aria-label="Mapa: toca para marcar el lugar"><div class="map-msg">Cargando mapa…</div></div>
    <p class="hint" id="mapInfo">Busca por nombre o toca el mapa para marcar el lugar.</p>
    <p class="tiny muted" style="margin:4px 4px 0">Mapa: © OpenStreetMap y CARTO. Búsqueda: OpenStreetMap / Photon. Solo se envía lo que buscas y la zona que ves, nunca tus datos financieros.</p>`,
    footer: `<button class="btn" data-act="mapLocate" aria-label="Mi ubicación">${ic('pin', 'sm')}</button><button class="btn primary" data-act="mapUse" id="mapUseBtn" disabled>${ic('check', 'sm')} Usar este lugar</button>`,
    onClose: () => { if (MAP) { MAP.remove(); MAP = null; window._tiles = null; } } });
  if (IN_FRAME) {
    $('#mapBox').innerHTML = '';
    mapMessage('La <b>vista previa de Claude</b> bloquea los mapas externos, aunque tengas internet. En la app instalada desde tu enlace de GitHub Pages el mapa sí funciona.', false);
    return;
  }
  try { await loadLeaflet(); }
  catch (e) { $('#mapBox').innerHTML = ''; mapMessage('No se pudo abrir el componente del mapa. Recarga la app.', false); return; }
  const box = $('#mapBox'); if (!box) return;
  box.innerHTML = '';
  const start = coordsFromLink(D?.mapsUrl) || [4.6533, -74.0836]; // Bogotá
  MAP = L.map(box, { zoomControl: true, attributionControl: true }).setView(start, coordsFromLink(D?.mapsUrl) ? 17 : 12);
  MAP.attributionControl.setPrefix(false);
  mapLoadTiles(0);
  if (coordsFromLink(D?.mapsUrl)) setPick(start[0], start[1], null);
  MAP.on('click', e => setPick(e.latlng.lat, e.latlng.lng, null, true));
  setTimeout(() => MAP && MAP.invalidateSize(), 250);
  if (q) mapSearch();
}
const pinIcon = () => L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] });
let revTimer = null;
function setPick(lat, lng, label, reverse) {
  if (!MAP) return;
  mapPick = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), label: label || null };
  if (mapPick.marker) mapPick.marker.remove();
  if (window._mapMarker) window._mapMarker.remove();
  window._mapMarker = L.marker([lat, lng], { icon: pinIcon() }).addTo(MAP);
  $('#mapUseBtn').disabled = false;
  $('#mapInfo').textContent = label ? label : `Punto marcado (${mapPick.lat}, ${mapPick.lng})`;
  if (reverse) {
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const lbl = await reverseGeocode(mapPick.lat, mapPick.lng);
      if (lbl && mapPick) { mapPick.label = lbl; $('#mapInfo').textContent = lbl; }
    }, 700); // respeta el límite de 1 consulta por segundo
  }
}
function shortPlace(j) {
  const a = j.address || {};
  const name = j.name || a.shop || a.amenity || '';
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const zone = a.suburb || a.neighbourhood || a.city_district || '';
  return [name, street, zone, a.city || a.town || ''].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || j.display_name.split(',').slice(0, 3).join(',');
}
const FETCH_OPTS = { referrerPolicy: 'strict-origin-when-cross-origin', credentials: 'omit' };
async function fetchJSON(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 8000);
  try { const r = await fetch(url, Object.assign({ signal: ctl.signal }, FETCH_OPTS)); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
// Photon devuelve GeoJSON; se convierte al formato de Nominatim que usa la interfaz
function photonToResults(j) {
  return (j.features || []).map(ft => { const p = ft.properties || {}; return { lat: String(ft.geometry.coordinates[1]), lon: String(ft.geometry.coordinates[0]), name: p.name || '', display_name: [p.name, p.street, p.district, p.city].filter(Boolean).join(', '), address: { shop: p.name, road: p.street, house_number: p.housenumber, suburb: p.district || p.locality, city: p.city } }; });
}
async function reverseGeocode(lat, lng) {
  try { const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=es`, 6000); if (j && j.display_name) return shortPlace(j); } catch (e) { /* respaldo */ }
  try { const r = photonToResults(await fetchJSON(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, 6000)); if (r[0]) return shortPlace(r[0]); } catch (e) { /* sin dirección */ }
  return null;
}
let lastSearch = 0;
async function mapSearch() {
  const q = ($('#mapQ')?.value || '').trim();
  if (!q || !MAP) return;
  const wait = 1100 - (Date.now() - lastSearch); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSearch = Date.now();
  const box = $('#mapResults'); box.hidden = false; box.innerHTML = '<p class="muted small" style="padding:12px 14px;margin:0">Buscando…</p>';
  const c = MAP.getCenter(), b = MAP.getBounds();
  let res = null, failed = 0;
  try { res = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=co&accept-language=es&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&q=${encodeURIComponent(q)}`); } catch (e) { failed++; }
  if (!res || !res.length) {
    try { res = photonToResults(await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat}&lon=${c.lng}`)).filter(r => Math.abs(Number(r.lat) - c.lat) < 8 && Math.abs(Number(r.lon) - c.lng) < 8); } catch (e) { failed++; }
  }
  if (failed === 2) { box.innerHTML = `<p class="muted small" style="padding:12px 14px;margin:0">${navigator.onLine === false ? 'Sin conexión a internet.' : 'Los buscadores de mapas no respondieron.'} Toca el mapa para marcar el lugar o usa el botón Google Maps.</p>`; return; }
  if (!res || !res.length) { box.innerHTML = '<p class="muted small" style="padding:12px 14px;margin:0">Sin resultados en el mapa libre. Prueba con la dirección, toca el mapa o usa el botón Google Maps.</p>'; return; }
  window._mapResults = res;
  box.innerHTML = res.map((r, k) => `<button type="button" class="row-item" data-act="mapResult" data-v="${k}" style="min-height:52px"><span class="ico">${ic('pin', 'sm')}</span><span class="grow"><span class="t">${esc(r.name || r.display_name.split(',')[0])}</span><span class="s">${esc(shortPlace(r))}</span></span></button>`).join('');
}

/* ================= Menú inferior ================= */
let TE = null;
function tabsEditor() {
  TE = getTabs().slice();
  openSheet({ id: 'tabs', title: 'Menú inferior', body: tabsBody(), footer: `<button class="btn" data-act="tabsReset">Restablecer</button><button class="btn primary" data-act="tabsSave">${ic('check', 'sm')} Guardar</button>` });
}
function tabsBody() {
  const slot = i => `<div class="field"><label for="ts${i}">${['Botón 1 · izquierda', 'Botón 2 · izquierda', 'Botón 3 · derecha', 'Botón 4 · derecha'][i]}</label>
    <select id="ts${i}" class="input" data-act-change="tabsPick" data-i="${i}">${Object.entries(TAB_OPTIONS).map(([k, [l]]) => `<option value="${k}" ${TE[i] === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  return `<p class="muted small" style="margin-top:0">Elige qué pantallas van en la barra de abajo. Lo que no esté en la barra sigue en Ajustes.${TE.includes('ajustes') ? '' : ' Como quitaste Ajustes, aparecerá un botón de engranaje arriba.'}</p>
    <div class="tabbar tab-preview" aria-hidden="true">${tabbarHTML(TE, true)}</div>
    <div class="grid2">${slot(0)}${slot(1)}</div><div class="grid2">${slot(2)}${slot(3)}</div>
    <p class="hint">También puedes abrir esto manteniendo presionada la barra de abajo.</p>`;
}
