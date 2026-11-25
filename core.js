/*
 * WalletWeb — núcleo financiero (sin interfaz).
 * Reglas: el dinero se maneja SIEMPRE como enteros de pesos (COP no usa centavos en la práctica).
 * Los cálculos que podrían superar 2^53 usan BigInt. No hay floats en saldos, presupuestos ni préstamos.
 * Este archivo funciona en el navegador (window.WWCore) y en Node (pruebas).
 */
(function (root) {
  'use strict';
  const TZ = 'America/Bogota';

  /* ---------------- Dinero ---------------- */
  const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const fmtInt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  // Moneda del perfil. Los montos se guardan siempre como enteros (sin centavos); solo cambia el símbolo.
  const CUR_SYMBOLS = { COP: '$', USD: 'US$', EUR: '€', MXN: 'MX$', ARS: 'AR$', CLP: 'CLP$', PEN: 'S/', BRL: 'R$', GBP: '£' };
  const CUR = { code: 'COP', symbol: '$' };
  function setCurrency(code) { if (!CUR_SYMBOLS[code]) code = 'COP'; CUR.code = code; CUR.symbol = CUR_SYMBOLS[code]; }
  function formatMoney(n) {
    if (!Number.isFinite(n)) return '—';
    if (CUR.code === 'COP') return fmtCOP.format(n).replace(/ /g, ' ');
    return (n < 0 ? '-' : '') + CUR.symbol + ' ' + fmtInt.format(Math.abs(n));
  }
  function isMoney(n) { return Number.isSafeInteger(n); }

  // Convierte un número escrito en formato colombiano a valor numérico.
  // "1.250.000" -> 1250000 ; "25,5" -> 25.5 ; "12.5" -> 12.5 ; "12.000" -> 12000
  function parseNumberToken(t) {
    t = t.trim();
    if (!t) return NaN;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t) && t.split(',').every((p, i) => i === 0 || p.slice(0, 3).length === 3)) {
      // "1,250,000" estilo inglés
      return Number(t.replace(/,/g, ''));
    }
    if (/^\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
    return NaN;
  }

  // Calculadora segura (sin eval): + - * / ( ) y "x". Devuelve entero de pesos o null.
  function evalAmount(input) {
    if (input == null) return null;
    let s = String(input).replace(/cop|\$/gi, '').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
    if (!s) return null;
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if ('+-*/()'.includes(ch)) { tokens.push(ch); i++; continue; }
      const m = /^[\d.,]+/.exec(s.slice(i));
      if (!m) return null;
      const v = parseNumberToken(m[0]);
      if (!Number.isFinite(v)) return null;
      tokens.push(v); i += m[0].length;
    }
    let p = 0;
    function expr() { let v = term(); while (tokens[p] === '+' || tokens[p] === '-') { const op = tokens[p++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
    function term() { let v = factor(); while (tokens[p] === '*' || tokens[p] === '/') { const op = tokens[p++]; const r = factor(); if (op === '/' && r === 0) throw new Error('div0'); v = op === '*' ? v * r : v / r; } return v; }
    function factor() {
      const t = tokens[p];
      if (t === '-') { p++; return -factor(); }
      if (t === '(') { p++; const v = expr(); if (tokens[p++] !== ')') throw new Error('paren'); return v; }
      if (typeof t === 'number') { p++; return t; }
      throw new Error('syntax');
    }
    try {
      const v = expr();
      if (p !== tokens.length) return null;
      if (!Number.isFinite(v)) return null;
      const r = Math.round(v);
      return Number.isSafeInteger(r) ? r : null;
    } catch (e) { return null; }
  }

  // Divide un total en n partes enteras. El residuo va a las primeras partes (la del usuario primero). Determinista.
  function splitEven(total, n) {
    if (!isMoney(total) || n < 1) return [];
    const base = Math.floor(total / n);
    let rem = total - base * n;
    const out = [];
    for (let k = 0; k < n; k++) { out.push(base + (rem > 0 ? 1 : 0)); if (rem > 0) rem--; }
    return out;
  }
  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

  // percent de un monto en puntos básicos (bp) con redondeo half-up usando BigInt.
  function mulDivRound(a, b, d) {
    const A = BigInt(a), B = BigInt(b), D = BigInt(d);
    const num = A * B;
    const q = num / D, r = num % D;
    const adj = (r * 2n >= D) ? 1n : 0n;
    return Number(q + adj);
  }

  /* ---------------- Fechas (ISO 'YYYY-MM-DD', zona America/Bogota) ---------------- */
  const dFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const tFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  function todayISO(d) { return dFmt.format(d || new Date()); }
  function nowTime(d) { return tFmt.format(d || new Date()); }
  function parts(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
  function toUTC(iso) { const { y, m, d } = parts(iso); return Date.UTC(y, m - 1, d); }
  function fromUTC(ms) { const dt = new Date(ms); return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function addDays(isoS, n) { return fromUTC(toUTC(isoS) + n * 86400000); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); } // b - a
  function dow(isoS) { return new Date(toUTC(isoS)).getUTCDay(); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function monthKey(isoS) { return isoS.slice(0, 7); }
  function addMonthsKey(key, n) { let [y, m] = key.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + String(m).padStart(2, '0'); }
  function monthDiff(a, b) { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); }
  function addMonthsISO(isoS, n, dayWanted) {
    const { d } = parts(isoS);
    const key = addMonthsKey(monthKey(isoS), n);
    const [y, m] = key.split('-').map(Number);
    return iso(y, m, Math.min(dayWanted || d, daysInMonth(y, m)));
  }
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  function monthLabel(key) { const [y, m] = key.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; }

  /* ---------------- Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani") ---------------- */
  function easter(y) { // algoritmo gregoriano anónimo
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(y, month, day);
  }
  function nextMonday(isoS) { const w = dow(isoS); return w === 1 ? isoS : addDays(isoS, (8 - w) % 7); }
  const holidayCache = {};
  function holidaysCO(y) {
    if (holidayCache[y]) return holidayCache[y];
    const H = {};
    const add = (d, n) => { H[d] = n; };
    add(iso(y, 1, 1), 'Año Nuevo'); add(iso(y, 5, 1), 'Día del Trabajo'); add(iso(y, 7, 20), 'Día de la Independencia');
    add(iso(y, 8, 7), 'Batalla de Boyacá'); add(iso(y, 12, 8), 'Inmaculada Concepción'); add(iso(y, 12, 25), 'Navidad');
    [[1, 6, 'Reyes Magos'], [3, 19, 'San José'], [6, 29, 'San Pedro y San Pablo'], [8, 15, 'Asunción de la Virgen'],
     [10, 12, 'Día de la Raza'], [11, 1, 'Todos los Santos'], [11, 11, 'Independencia de Cartagena']]
      .forEach(([m, d, n]) => add(nextMonday(iso(y, m, d)), n));
    const E = easter(y);
    add(addDays(E, -3), 'Jueves Santo'); add(addDays(E, -2), 'Viernes Santo');
    add(addDays(E, 43), 'Ascensión del Señor'); add(addDays(E, 64), 'Corpus Christi'); add(addDays(E, 71), 'Sagrado Corazón');
    holidayCache[y] = H;
    return H;
  }
  function holidayName(isoS, ex) {
    ex = ex || {};
    if ((ex.workdays || []).includes(isoS)) return null;
    const extra = (ex.extraHolidays || []).find(h => h.date === isoS);
    if (extra) return extra.name || 'Festivo manual';
    return holidaysCO(parts(isoS).y)[isoS] || null;
  }
  function isBusinessDay(isoS, ex) { const w = dow(isoS); if (w === 0 || w === 6) return false; return !holidayName(isoS, ex); }
  function prevBusinessDay(isoS, ex) { let d = isoS; let guard = 0; while (!isBusinessDay(d, ex) && guard++ < 15) d = addDays(d, -1); return d; }
  function nextBusinessDay(isoS, ex) { let d = isoS; let guard = 0; while (!isBusinessDay(d, ex) && guard++ < 15) d = addDays(d, 1); return d; }

  /* ---------------- Recurrencias ---------------- */
  // rule: { freq:'monthly_days'|'weekly'|'biweekly'|'dates', days:[15,30], startDate, dates:[], adjust:'prev'|'next'|'none' }
  function occurrences(rule, from, to, ex) {
    const out = [];
    const adj = (d) => rule.adjust === 'prev' ? prevBusinessDay(d, ex) : rule.adjust === 'next' ? nextBusinessDay(d, ex) : d;
    const start = rule.startDate || from;
    if (rule.freq === 'monthly_days') {
      let key = monthKey(from < start ? start : from);
      const endKey = monthKey(to);
      while (key <= endKey) {
        const [y, m] = key.split('-').map(Number);
        const seen = new Set();
        (rule.days || []).slice().sort((a, b) => a - b).forEach(day => {
          const nominal = iso(y, m, Math.min(day, daysInMonth(y, m)));
          if (seen.has(nominal)) return; seen.add(nominal);
          if (nominal >= start && nominal >= from && nominal <= to) out.push({ nominal, due: adj(nominal) });
        });
        key = addMonthsKey(key, 1);
      }
    } else if (rule.freq === 'weekly' || rule.freq === 'biweekly') {
      const step = rule.freq === 'weekly' ? 7 : 14;
      let d = start;
      if (d < from) d = addDays(d, Math.ceil(diffDays(d, from) / step) * step);
      for (; d <= to; d = addDays(d, step)) out.push({ nominal: d, due: adj(d) });
    } else if (rule.freq === 'dates') {
      (rule.dates || []).filter(d => d >= from && d <= to).sort().forEach(d => out.push({ nominal: d, due: adj(d) }));
    }
    return out;
  }

  /* ---------------- Movimientos ---------------- */
  // Efecto de un movimiento confirmado sobre el saldo de cada cuenta.
  function txEffects(tx) {
    const a = tx.amount;
    switch (tx.type) {
      case 'expense': case 'loan_out': case 'repay_out': return [[tx.accountId, -a]];
      case 'income': case 'loan_in': case 'repay_in': case 'collect': return [[tx.accountId, a]];
      case 'transfer': return [[tx.accountId, -a], [tx.toAccountId, a]];
      case 'adjust': return [[tx.accountId, a]]; // ajuste firmado
      default: return [];
    }
  }
  function isActive(tx) { return !tx.deletedAt && tx.status === 'confirmed'; }
  function accountBalance(acc, txs) {
    let b = acc.initialBalance || 0;
    for (const tx of txs) { if (!isActive(tx)) continue; for (const [id, v] of txEffects(tx)) if (id === acc.id) b += v; }
    return b;
  }
  // Parte personal de un gasto = mi parte + partes marcadas como regalo/asumidas.
  function personalAmount(tx) {
    if (!tx.split || !tx.split.parts || !tx.split.parts.length) return tx.amount;
    return tx.split.myShare + sum(tx.split.parts.filter(p => p.gift).map(p => p.amount));
  }
  function receivableParts(tx) {
    if (!tx.split || !tx.split.parts || !isActive(tx)) return [];
    return tx.split.parts.filter(p => !p.gift && (p.amount - (p.collected || 0)) > 0).map(p => ({ ...p, pending: p.amount - (p.collected || 0), txId: tx.id }));
  }
  // Impacto de gasto personal en un mes. mode: 'purchase' (todo en la fecha de compra) | 'installment' (cada cuota en su mes)
  function expenseInMonth(tx, key, mode) {
    if (tx.type !== 'expense' || !isActive(tx)) return 0;
    const personal = personalAmount(tx);
    if (mode === 'installment' && tx.installments && tx.installments.n > 1) {
      const first = tx.installments.firstMonth || monthKey(tx.date);
      const k = monthDiff(first, key);
      if (k < 0 || k >= tx.installments.n) return 0;
      return splitEven(personal, tx.installments.n)[k];
    }
    return monthKey(tx.date) === key ? personal : 0;
  }
  // Ingreso económico del mes: ingresos + intereses cobrados. Los abonos de capital y cobros de gastos compartidos NO son ingreso.
  function incomeInMonth(tx, key) {
    if (!isActive(tx) || monthKey(tx.date) !== key) return 0;
    if (tx.type === 'income') return tx.amount;
    if (tx.type === 'repay_in') return tx.interest || 0;
    return 0;
  }
  function installmentStatus(tx, todayKey) {
    if (!tx.installments || tx.installments.n < 2) return null;
    const n = tx.installments.n, first = tx.installments.firstMonth || monthKey(tx.date);
    const parts_ = splitEven(tx.amount, n);
    const elapsed = Math.max(0, Math.min(n, monthDiff(first, todayKey) + 1));
    const paid = sum(parts_.slice(0, elapsed));
    return { n, value: parts_[0], paidCount: elapsed, pendingCount: n - elapsed, pendingAmount: tx.amount - paid };
  }

  // Reparte un importe entre varias personas etiquetadas (partes iguales, residuo a las primeras). Para "¿en quién gasto más?".
  function attributeToPeople(amount, ids) {
    const uniq = [...new Set(ids || [])];
    if (!uniq.length || !isMoney(amount)) return [];
    const parts = splitEven(amount, uniq.length);
    return uniq.map((id, k) => ({ id, amount: parts[k] }));
  }

  /* ---------------- Préstamos ---------------- */
  // loan: { principal, rateBp (mensual, 250 = 2,5 %), interestMode:'none'|'simple'|'compound', termMonths, installments, firstDue, payments:[] }
  function loanTotalInterest(loan) {
    const P = loan.principal, r = loan.rateBp || 0, t = loan.termMonths || 0;
    if (loan.interestMode === 'simple') return mulDivRound(P, r * t, 10000);
    if (loan.interestMode === 'compound') { let bal = P; for (let k = 0; k < t; k++) bal += mulDivRound(bal, r, 10000); return bal - P; }
    return 0;
  }
  function loanSchedule(loan) {
    const n = Math.max(1, loan.installments || 1);
    const I = loanTotalInterest(loan), total = loan.principal + I;
    const amounts = splitEven(total, n), interests = splitEven(I, n);
    const day = parts(loan.firstDue).d;
    return amounts.map((amt, k) => ({ k: k + 1, due: addMonthsISO(loan.firstDue, k, day), amount: amt, interest: interests[k], capital: amt - interests[k] }));
  }
  function loanSummary(loan, today) {
    const I = loanTotalInterest(loan), total = loan.principal + I;
    const pays = (loan.payments || []);
    const paid = sum(pays.map(p => p.amount)), paidInterest = sum(pays.map(p => p.interest || 0));
    const balance = Math.max(0, total - paid);
    const sched = loanSchedule(loan);
    let cum = 0, next = null;
    for (const s of sched) { cum += s.amount; if (cum > paid) { next = s; break; } }
    const daysLate = next && today > next.due ? diffDays(next.due, today) : 0;
    let status;
    if (loan.statusOverride) status = loan.statusOverride; // 'forgiven' | 'cancelled' | 'draft'
    else if (balance === 0) status = 'paid';
    else if (daysLate > 0) status = 'overdue';
    else if (paid > 0) status = 'partial';
    else status = 'active';
    return { interest: I, total, paid, paidInterest, paidCapital: paid - paidInterest, balance, capitalBalance: loan.principal - (paid - paidInterest), next, daysLate, status, schedule: sched };
  }
  // Reparte un abono siguiendo el cronograma: en cada cuota, primero su interés y luego su capital. No permite pagar de más.
  function allocatePayment(loan, amount) {
    const s = loanSummary(loan, '0000-00-00');
    if (!isMoney(amount) || amount <= 0) return { error: 'El valor debe ser mayor que cero.' };
    if (amount > s.balance) return { error: 'El abono supera el saldo pendiente (' + formatMoney(s.balance) + ').' };
    let pos = s.paid, end = s.paid + amount, cursor = 0, interest = 0;
    for (const row of s.schedule) {
      const segs = [[row.interest, true], [row.capital, false]];
      for (const [len, isInt] of segs) {
        const a = Math.max(cursor, pos), b = Math.min(cursor + len, end);
        if (b > a && isInt) interest += b - a;
        cursor += len;
      }
      if (cursor >= end) break;
    }
    return { interest, capital: amount - interest };
  }

  /* ---------------- Presupuestos ---------------- */
  function budgetBase(b, ctx) {
    if (b.method === 'pctExpected') return mulDivRound(ctx.expectedIncome, b.value, 100);
    if (b.method === 'pctReceived') return mulDivRound(ctx.receivedIncome, b.value, 100);
    return b.value;
  }
  function budgetStatus(b, consumed, ctx, warnPct) {
    const amount = budgetBase(b, ctx);
    const available = amount - consumed;
    const pct = amount > 0 ? consumed / amount * 100 : 0;
    let state = 'ok';
    if (amount <= 0) state = 'nodata';
    else if (consumed > amount) state = 'over';
    else if (pct >= (warnPct || 80)) state = 'near';
    const r = { amount, consumed, available, pct, state, exceeded: Math.max(0, consumed - amount) };
    if (ctx.isCurrent) {
      const daysLeft = ctx.daysInMonth - ctx.dayOfMonth + 1;
      r.dailyPace = available > 0 ? Math.floor(available / daysLeft) : 0;
      r.projection = ctx.dayOfMonth > 0 ? Math.round(consumed / ctx.dayOfMonth * ctx.daysInMonth) : consumed;
    }
    return r;
  }
  function txMatchesScope(tx, b) {
    switch (b.scope) {
      case 'global': return true;
      case 'category': return tx.categoryId === b.ref;
      case 'nature': return tx.nature === b.ref;
      case 'subcategory': return tx.subcategoryId === b.ref;
      case 'tag': return (tx.tags || []).includes(b.ref);
      case 'account': return tx.accountId === b.ref;
      default: return false;
    }
  }

  /* ---------------- Metas ---------------- */
  function goalSummary(g, today) {
    const saved = sum((g.contributions || []).map(c => c.amount));
    const remaining = Math.max(0, g.target - saved);
    const pct = g.target > 0 ? Math.min(100, saved / g.target * 100) : 0;
    let eta = null;
    if (remaining === 0) eta = today;
    else if (g.monthly > 0) eta = addMonthsISO(today, Math.ceil(remaining / g.monthly));
    let monthlyNeeded = null;
    if (g.targetDate && remaining > 0) { const months = Math.max(1, monthDiff(monthKey(today), monthKey(g.targetDate))); monthlyNeeded = Math.ceil(remaining / months); }
    return { saved, remaining, pct, eta, monthlyNeeded };
  }

  /* ---------------- Lista de deseos: fondo mensual y plan ----------------
     fund = { start: 'AAAA-MM', history: [{ from: 'AAAA-MM', amount }], adjustments: [{ amount }], horizon: 'AAAA-MM-DD' }
     wish = { price, priority (1 alta, 2 media, 3 baja), order, status: 'active'|'bought'|'discarded', paid, fromFund } */
  function wishMonthly(fund, key) {
    let v = 0; for (const h of (fund.history || []).slice().sort((a, b) => a.from.localeCompare(b.from))) if (h.from <= key) v = h.amount;
    return v;
  }
  function wishPlan(fund, wishes, today) {
    fund = fund || {}; const cur = monthKey(today), start = fund.start || cur;
    let accrued = 0;
    for (let k = start; k <= cur; k = addMonthsKey(k, 1)) accrued += wishMonthly(fund, k);
    accrued += sum((fund.adjustments || []).map(a => a.amount || 0));
    const spent = sum(wishes.filter(w => w.status === 'bought' && w.fromFund !== false).map(w => w.paid || 0));
    const available = accrued - spent, monthly = wishMonthly(fund, cur);
    const hKey = monthKey(fund.horizon || (cur.slice(0, 4) + '-12-31'));
    const monthsLeft = Math.max(0, monthDiff(cur, hKey));
    let future = 0; for (let i = 1; i <= monthsLeft; i++) future += wishMonthly(fund, addMonthsKey(cur, i));
    const projection = available + future;
    const act = wishes.filter(w => w.status === 'active').slice().sort((a, b) => (a.priority || 2) - (b.priority || 2) || (a.order || 0) - (b.order || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    let cum = 0; const items = [];
    for (const w of act) {
      cum += w.price || 0;
      let eta = null;
      if (cum <= available) eta = cur;
      else if (monthly > 0) { let lvl = available; for (let i = 1; i <= 240; i++) { lvl += wishMonthly(fund, addMonthsKey(cur, i)) || monthly; if (lvl >= cum) { eta = addMonthsKey(cur, i); break; } } }
      items.push({ w, cum, now: cum <= available, fits: cum <= projection, eta });
    }
    const fitting = items.filter(x => x.fits);
    const fitCost = fitting.length ? fitting[fitting.length - 1].cum : 0;
    return { monthly, accrued, spent, available, horizonKey: hKey, monthsLeft, projection, items,
      fitCount: fitting.length, total: items.length, totalCost: cum, leftover: projection - fitCost, shortfall: Math.max(0, cum - projection) };
  }

  /* ---------------- Duplicados ---------------- */
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
  function duplicateScore(a, b) {
    let s = 0;
    if (a.amount === b.amount) s += 45;
    const dd = Math.abs(diffDays(a.date, b.date));
    if (dd === 0) s += 25; else if (dd === 1) s += 15; else if (dd <= 3) s += 5;
    const ma = norm(a.merchant || a.note), mb = norm(b.merchant || b.note);
    if (ma && mb && (ma === mb || ma.includes(mb) || mb.includes(ma))) s += 20;
    if (a.accountId && a.accountId === b.accountId) s += 5;
    if (a.reference && a.reference === b.reference) s += 5;
    return Math.min(100, s);
  }

  /* ---------------- Texto pegado (notificaciones, correos) ---------------- */
  function parsePastedText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const out = {};
    const m = /(?:\$|COP)\s?([\d.,]+)/i.exec(t) || /([\d]{1,3}(?:\.\d{3})+(?:,\d+)?)/.exec(t);
    if (m) { const v = evalAmount(m[1]); if (v) out.amount = v; }
    const mm = /\b(?:en|a|de)\s+([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ&.\- ]{1,40}?)(?=\s+(?:por|el|con|fecha|desde|\d)|[.,]|$)/.exec(t);
    if (mm) out.merchant = mm[1].trim();
    const md = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(t);
    if (md) { let y = Number(md[3]); if (y < 100) y += 2000; const mo = Number(md[2]), d = Number(md[1]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.date = iso(y, mo, d); }
    if (/recib|abono|consignaci|te envi|transferencia recibida|ingres/i.test(t)) out.type = 'income';
    else if (m) out.type = 'expense';
    return out;
  }

  /* ---------------- Lectura de facturas (texto OCR → campos) ---------------- */
  // Convierte "12.345", "12,345", "$ 12.345,00" o "12345" en pesos enteros. Devuelve null si no es un importe.
  function parseAmountToken(tok) {
    let t = String(tok || '').replace(/[$\s]/g, '').replace(/^[-–]/, '');
    let m, int, dec;
    if ((m = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(t))) { int = m[1].replace(/[.,]/g, ''); dec = m[2]; }
    else if ((m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t))) { int = m[1]; dec = m[2]; }
    else return null;
    const v = Number(int) + (dec ? Number(dec) / Math.pow(10, dec.length) : 0);
    return Number.isFinite(v) ? Math.round(v) : null;
  }
  // Números de una línea con su posición. Se ignoran porcentajes, fechas/horas y números pegados a letras
  // (códigos como S04E-31877 o 1_FAC).
  function amountTokens(line) {
    const re = /[-–]?\$?\s?\d[\d.,]*/g, out = []; let m;
    while ((m = re.exec(line))) {
      const raw = m[0], lead = raw.search(/\d/), ds = m.index + lead;
      let de = m.index + raw.length; while (de > ds && /[.,]/.test(line[de - 1])) de--;
      const before = line[m.index - 1] || ' ', bd = line[ds - 1] || ' ', after = line[de] || ' ';
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñ_]/.test(before) && !/^\s/.test(raw)) continue;       // pegado a letras: código
      if (/[\/:]/.test(bd) && !/\s/.test(raw.slice(0, lead)) || /[\/:]/.test(after)) continue; // fechas y horas (10/05/26, 13:40)
      if (/\d-$/.test(line.slice(Math.max(0, ds - 2), ds)) || /^-\d/.test(line.slice(de, de + 2))) continue; // 2026-10-12, 12-10-26, 123-45-...
      if (/^\s?%/.test(line.slice(de, de + 2))) continue;                            // porcentajes (19 %)
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(after) && !/[xX×]/.test(after)) continue;     // 1KG, 500MG, 4X
      const tok = line.slice(ds, de), v = parseAmountToken(tok);
      if (v === null) continue;
      out.push({ value: v, index: m.index, end: de, raw: tok, sep: /\d[.,]\d{3}(?!\d)/.test(tok), negative: /^[-–]/.test(raw.trim()) && /[\s$(]/.test(before) });
    }
    return out;
  }
  function lastAmount(line) { const t = amountTokens(line); return t.length ? t[t.length - 1] : null; }
  function plain(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  const LETTERS = /[A-Za-zÁÉÍÓÚÑáéíóúñ]/g;
  const nLetters = s => (String(s).match(LETTERS) || []).length;
  // Nombre de la tienda: "TIENDA KOAJ PLAZA NORTE" → KOAJ; razón social (LTDA, S.A.S.) seguida de la marca → la marca
  // Palabras frecuentes en nombres de negocios: corrigen lecturas como "CONERCIA" → COMERCIAL o "EDIFlCIO" → EDIFICIO
  const BIZ_WORDS = ['EDIFICIO', 'CENTRO', 'COMERCIAL', 'HÉROES', 'PARQUEADERO', 'PARQUEADEROS', 'ALMACÉN', 'ALMACENES', 'TIENDA', 'TIENDAS',
    'DROGUERÍA', 'DROGUERÍAS', 'FARMACIA', 'SUPERMERCADO', 'SUPERMERCADOS', 'MERCADO', 'MERCADOS', 'RESTAURANTE', 'PANADERÍA', 'CAFETERÍA',
    'FERRETERÍA', 'PAPELERÍA', 'CARNICERÍA', 'LIBRERÍA', 'PIZZERÍA', 'HELADERÍA', 'LAVANDERÍA', 'PELUQUERÍA', 'JOYERÍA', 'CLÍNICA', 'ÓPTICA',
    'CONJUNTO', 'RESIDENCIAL', 'COPROPIEDAD', 'PROPIEDAD', 'HORIZONTAL', 'ESTACIÓN', 'SERVICIO', 'SERVICIOS', 'DISTRIBUIDORA', 'COMERCIALIZADORA',
    'INVERSIONES', 'COMPAÑÍA', 'COLOMBIA', 'BOGOTÁ', 'MEDELLÍN', 'OLÍMPICA', 'HOTEL', 'PLAZA', 'NORTE', 'ANDINO', 'UNICENTRO', 'GRAN', 'CINE', 'CINES'];
  const BIZ_PLAIN = BIZ_WORDS.map(w => plain(w).toUpperCase());
  function editDist(a, b) {
    const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  // Cifras que el lector confunde con letras dentro de un nombre ("109" → "LOS"): solo palabras cortas conocidas
  const DIGIT_LET = { 0: 'OD', 1: 'LI', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B', 9: 'SG' };
  const NAME_WORDS = ['LOS', 'LAS', 'DEL', 'SAN', 'SOL', 'EL', 'LA', 'DE'];
  // ¿El impuesto es el 19, 8 o 5 % del subtotal? (tolerancia de redondeo: 1 peso o 0,1 % del impuesto)
  const rateOk = (tax, sub) => tax > 0 && sub > 0 && [0.19, 0.08, 0.05].some(k => Math.abs(tax - sub * k) <= Math.max(1, sub * k * 0.001));
  const digitWord = t => NAME_WORDS.find(w => w.length === t.length && [...t].every((d, i) => (DIGIT_LET[d] || '').includes(w[i]))) || null;
  // Nombre ya guardado por el usuario que se parece al leído (la lectura de la foto se corrige con lo que él ya escribió)
  function knownName(read, known) {
    const norm = v => plain(String(v || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), r = norm(read);
    if (r.length < 6) return null;
    let best = null, bs = 0;
    for (const k of known || []) {
      const q = norm(k); if (q.length < 6 || Math.abs(q.length - r.length) > Math.max(q.length, r.length) * 0.3) continue;
      let prev = Array.from({ length: q.length + 1 }, (_, j) => j);
      for (let i = 1; i <= r.length; i++) { const cur = [i]; for (let j = 1; j <= q.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === q[j - 1] ? 0 : 1)); prev = cur; }
      const sim = 1 - prev[q.length] / Math.max(q.length, r.length);
      if (sim > bs) { bs = sim; best = k; }
    }
    return bs >= 0.75 ? best : null;
  }
  function fixBizWords(line, strict) {
    return line.split(/\s+/).map(w => {
      const core = plain(w).toUpperCase().replace(/[^A-Z]/g, ''); if (core.length < (strict ? 8 : 4) || /\d/.test(w)) return w;
      let best = -1, bd = 9; BIZ_PLAIN.forEach((v, k) => { const dd = editDist(core, v); if (dd < bd) { bd = dd; best = k; } });
      if (best < 0 || bd > (strict ? 1 : core.length >= 8 ? 2 : 1)) return w;
      const fixed = BIZ_WORDS[best], up = w === w.toUpperCase(), cap = !up && w[0] === w[0].toUpperCase();
      return up ? fixed : cap ? fixed.charAt(0) + fixed.slice(1).toLowerCase() : fixed.toLowerCase();
    }).join(' ').replace(/\bP[.,]?\s?H[.,]?(?=\s|$)/i, 'P.H.');
  }
  function receiptMerchant(lines) {
    const ADDR = /\b(calle|cll|cl|carrera|cra|kr|avenida|av|diagonal|dg|transversal|tv|centro|cc|c\.c|local|piso|barrio|no|km)\b|#|\d/;
    const SKIPM = /(nit|tel|ciudad|caja|factura|fecha|hora|cliente|vendedor|consecutivo|regimen|resoluci|iva|responsable|codigo|descripcion|direcci|www|\.com|cajero|turno|\b[a-z0-9]?ecur(?:i|1|\*)|acce?ss|bienvenid|gracias|welcome|\bcant\b|precio|\bdcto\b|\btotal\b)/;
    const SUFFIX = /\b(ltda|limitada|s\.?\s?a\.?\s?s|s\.?a\.?|sas|e\.?u\.?|& cia|y cia)\b\.?/;
    // "&" mal leído ("CREPES 6 WAFFLES", "£", "€") entre dos palabras que no son una dirección ("CALLE 6 SUR" no se toca)
    const amp = l => l.replace(/€/g, '&').replace(/\b([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}) [68£] ([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})\b/g, (m, a, b) => ADDR.test(plain(a)) || /^(sur|norte|este|oeste|bis)$/i.test(b) ? m : a + ' & ' + b);
    const cands = [], top = lines.slice(0, 14).map(amp);
    // Edificios, centros comerciales y conjuntos (propiedad horizontal, "P.H."): el renglón completo es el nombre
    for (let k = 0; k < top.length; k++) {
      const f0 = fixBizWords(top[k].replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9&]+/, '')), ph = /\bp\.h\./.test(plain(f0));
      // con "P.H." el renglón es el nombre: cifras sueltas se leen como letras y lo que sigue a "P.H." sobra
      const fixed = ph ? f0.replace(/\b\d{2,3}\b/g, t => digitWord(t) || t).replace(/(\bP\.H\.).*$/, '$1').replace(/\b(CENTRO) CO[A-ZÁÉÍÓÚÑ]{1,8}[.,]?(?= )/i, (m, c) => c + ' COMERCIAL') : f0, low = plain(fixed);
      if (SKIPM.test(low) || (!ph && (fixed.match(/\d/g) || []).length > 2)) continue;
      if (/\bp\.h\.$/.test(low) || /\b(edificio|centro comercial|conjunto residencial|copropiedad|parqueaderos?)\b/.test(low) && nLetters(fixed) >= 10) {
        let name = fixed.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9.&)]+$/, '').trim();
        // primera palabra partida en el renglón de arriba ("EDIF" / "...CENTRO COMERCIAL ...")
        const prev = k > 0 ? top[k - 1].trim() : '';
        if (/^[A-Za-zÁÉÍÓÚÑ]{3,8}$/.test(prev)) { const pv = plain(prev).toUpperCase(), full = BIZ_WORDS.find(w => plain(w).toUpperCase().startsWith(pv)); if (full && !plain(name).toUpperCase().startsWith(plain(full).toUpperCase())) name = full + ' ' + name.split(/\s+/).filter((wd, i) => i > 0 || BIZ_PLAIN.includes(plain(wd).toUpperCase())).join(' '); }
        const L = name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ''), U = name.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
        return (U.length >= L.length * 0.6 ? name.toUpperCase() : name).slice(0, 60);
      }
    }
    for (let k = 0; k < top.length; k++) {
      const l = top[k], low = plain(l);
      const t = /^tienda\s+(.+)$/.exec(low);
      if (t) {
        const words = []; for (const wd of t[1].split(/\s+/)) { if (ADDR.test(wd) && words.length) break; words.push(wd); }
        const brand = l.split(/\s+/).slice(1, 1 + words.length).join(' ').replace(/[^\wÁÉÍÓÚÑáéíóúñ&'.\s-]/g, '').trim();
        const full = top.slice(k + 1, k + 3).map(x => x.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9&]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9.&)]+$/g, '').trim()).find(x => x && !/\d/.test(x) && x.split(/\s+/).length <= 4 && plain(x).startsWith(plain(brand.split(' ')[0])));
        if (full || brand) return full || brand;
      }
      if (SKIPM.test(low) || nLetters(l) < 3 || (l.match(/\d/g) || []).length > 4) continue;
      if (lastAmount(l)) continue;
      cands.push(l.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9&]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9.&)]+$/g, '').trim());
      if (cands.length >= 4) break;
    }
    if (!cands.length) return null;
    const first = cands[0];
    if (SUFFIX.test(plain(first))) {
      const brand = cands.slice(1, 3).find(c => !SUFFIX.test(plain(c)) && c.split(/\s+/).length <= 3 && !/\d/.test(c));
      if (brand) return brand;
      return first.replace(new RegExp(SUFFIX.source + '.*$', 'i'), '').trim() || first;
    }
    return first;
  }
  function receiptLinesFromWords(words) {
    const ws = (words || []).filter(w => w && w.text && w.text.trim() && w.bbox).map(w => ({ t: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, yc: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 }));
    if (!ws.length) return [];
    const hs = ws.filter(w => w.t.length >= 2).map(w => w.h).sort((a, b) => a - b), H = hs[hs.length >> 1] || 20;
    ws.sort((a, b) => a.yc - b.yc);
    const rows = [];
    for (const w of ws) {
      let best = null, bd = 1e9;
      for (const r of rows) { const dy = Math.abs(r.yc - w.yc); if (dy < H * 0.55 && dy < bd && !r.ws.some(o => !(w.x1 < o.x0 || w.x0 > o.x1))) { bd = dy; best = r; } }
      if (best) { best.ws.push(w); best.yc = best.ws.reduce((s, o) => s + o.yc, 0) / best.ws.length; } else rows.push({ yc: w.yc, ws: [w] });
    }
    rows.sort((a, b) => a.yc - b.yc);
    return rows.map(r => r.ws.sort((a, b) => a.x0 - b.x0).map(w => w.t).join(' '));
  }
  // Une dos lecturas de la misma factura: cada dato se toma de la lectura en la que cuadra con los demás
  // Qué tan creíble es un nombre de tienda leído: razón social o palabras de negocio suben; letras sueltas y símbolos bajan
  function merchantScore(m) {
    if (!m) return -9;
    const words = String(m).split(/\s+/).filter(Boolean), low = plain(m);
    let sc = 0;
    if (/\bp\.h\.$/.test(low) || /\b(ltda|s\.?a\.?s|s\.a\.)\b/.test(low)) sc += 3;
    sc += words.filter(w => BIZ_PLAIN.includes(plain(w).toUpperCase().replace(/[^A-Z]/g, ''))).length;
    sc -= words.filter(w => nLetters(w) <= 2 && !/^(d1|&|p\.h\.|s\.a\.)$/i.test(w)).length * 0.7;
    sc -= (String(m).match(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s.&'-]/g) || []).length * 0.8;
    sc -= words.filter(w => /[A-Za-z]/.test(w) && /\d/.test(w) && !/^d1$/i.test(w)).length * 0.8; // "K0OAJ": cifra metida en una palabra
    if (nLetters(m) < 4) sc -= 2;
    if (words.length === 1 && /^(TIENDAS?|ALMACEN(ES)?|CENTRO|COMERCIAL|EDIFICIO|SERVICIOS?|(SUPER)?MERCADOS?|RESTAURANTE|FARMACIA|DROGUERIAS?|PARQUEADEROS?|CONJUNTO|PLAZA|HOTEL|CINES?|COLOMBIA|NORTE|GRAN)$/.test(plain(m).toUpperCase().replace(/[^A-Z]/g, ''))) sc -= 2; // "TIENDA" sola no es un nombre
    return sc;
  }
  function mergeReceiptReads(a, b) {
    if (!a) return b; if (!b) return a;
    const sumIt = r => r.items.reduce((s, i) => s + i.amount, 0) + (r.tip || 0) + (r.shipping || 0) - (r.discount || 0);
    const votes = new Map(), add = (v, w) => { if (v) votes.set(v, (votes.get(v) || 0) + w); };
    add(a.total, a.totalSource === 'sum' ? 0.5 : 2); add(b.total, b.totalSource === 'sum' ? 0.5 : 2); add(sumIt(a), 0.75); add(sumIt(b), 0.75);
    const pair = r => rateOk(r.tax, r.subtotal); // subtotal e IVA que se confirman
    for (const r of [a, b]) if (r.subtotal && r.tax) add(r.subtotal + r.tax + (pair(r) ? (r.tip || 0) + (r.shipping || 0) : 0), pair(r) ? 2.5 : 1);
    if ((a.iva19 || b.iva19) && !(a.subtotal && a.tax) && !(b.subtotal && b.tax)) { const s0 = a.subtotal || b.subtotal; if (s0) add(s0 + Math.round(s0 * 0.19), 1); } // subtotal + IVA 19 %
    let total = a.total || b.total, bw = 0; for (const [v, w] of votes) if (w > bw || (w === bw && v === a.total)) { bw = w; total = v; }
    const okTax = (t, s) => t && total && (Math.abs(t - (total - Math.round(total / 1.19))) <= 2 || (s && Math.abs(total - s - t) <= 2));
    const okSub = s => s && total && s <= total && s >= total * 0.5;
    const subtotal = okSub(a.subtotal) ? a.subtotal : okSub(b.subtotal) ? b.subtotal : (a.subtotal || b.subtotal);
    let tax = okTax(a.tax, a.subtotal) ? a.tax : okTax(b.tax, b.subtotal) ? b.tax : null;
    // Ningún IVA leído cuadra: si total − subtotal es un impuesto normal (19, 8 o 5 %), ese es; si no, se deja lo leído si es creíble
    const rest = total && okSub(subtotal) ? total - subtotal - (a.tip ?? b.tip ?? 0) - (a.shipping ?? b.shipping ?? 0) : 0;
    if (!tax && rateOk(rest, subtotal)) tax = rest;
    if (!tax) { const t0 = a.tax || b.tax; tax = t0 && (!total || t0 < total * 0.3) ? t0 : null; }
    const goals = [total, tax ? total - tax : null, subtotal].filter(Boolean);
    const fits = r => r.items.length && goals.some(g => Math.abs(sumIt(r) - g) <= 1);
    const near = r => { const its = r.items.filter(i => !total || i.amount <= total * 1.02); const sm = its.reduce((t, i) => t + i.amount, 0); return { its, d: Math.min(...goals.map(g => Math.abs(sm - g)), Infinity) }; };
    const na = near(a), nb = near(b);
    const items = fits(a) ? a.items : fits(b) ? b.items : (nb.d < na.d ? nb.its : na.its);
    const recent = d => { if (!d) return false; const age = diffDays(d, todayISO()); return age >= -1 && age <= 400; };
    const date = a.date && (recent(a.date) || !recent(b.date)) ? a.date : (b.date || a.date);
    // Si una lectura es la otra más una palabra corta ("STUDIO" / "STUDIO F"), se queda la completa
    const nm = v => plain(String(v || '')).toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim(), na2 = nm(a.merchant), nb2 = nm(b.merchant);
    const ext = (x, y) => x.length > y.length && y.length >= 4 && x.startsWith(y) && /^ [a-z&]{1,12}$/.test(x.slice(y.length));
    const merchant = ext(na2, nb2) ? a.merchant : ext(nb2, na2) ? b.merchant : merchantScore(b.merchant) > merchantScore(a.merchant) ? b.merchant : (a.merchant || b.merchant);
    return Object.assign({}, a, { total, tax, subtotal, items, date, merchant, nit: a.nit || b.nit, tip: a.tip ?? b.tip, discount: a.discount ?? b.discount, shipping: a.shipping ?? b.shipping });
  }
  function parseReceiptText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/[—–]+/g, ' ').replace(/[|“”"¦]/g, ' ').replace(/\s+/g, ' ').replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9$-]+/, '').trim()).filter(Boolean);
    // Montos impresos medio renglón más arriba o más abajo que su etiqueta ("6280" / "Iva 19%"): se unen
    const KV = /(sub\s*-?\s*t[o0]ta[l1]|t[o0]ta[l1]|\b[il1!]?va\b|impoconsumo|impuesto|propina|descuento|domicilio|cambio|efectivo|\btef\b|\bcred|\bdeb)/;
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j]; if (nLetters(l) > 1) continue;
      const tk = amountTokens(l); if (tk.length !== 1) continue;
      const lab = k => k >= 0 && k < lines.length && KV.test(plain(lines[k])) && !amountTokens(lines[k]).some(t => t.value > 0) && nLetters(lines[k]) >= 3;
      const to = lab(j + 1) ? j + 1 : lab(j - 1) ? j - 1 : -1;
      if (to >= 0) { lines[to] = lines[to] + ' ' + tk[0].raw; lines.splice(j, 1); j--; }
    }
    const r = { items: [], subtotal: null, tax: null, tip: null, discount: null, shipping: null, total: null, nit: null, date: null, merchant: null };
    let taxSum = 0, tipSum = 0, discSum = 0, shipSum = 0, totalPay = null, total = null, totalRow = null, payCard = null, paid = null, change = null;
    // Tirillas con centavos ("6.554,62", "2.000,00"): una coma seguida de tres cifras al final ("7.800,007") es "7.800,00" con
    // una marca de más (doblez o letra pegada). Los números largos sin separadores (documentos, placas) no son montos.
    const rawToks = lines.flatMap(l => amountTokens(l).map(t => t.raw));
    const cents = rawToks.filter(t => /\d,\d{2}$/.test(t)).length >= 2;
    const sepStyle = rawToks.filter(t => /\d[.,]\d{2,3}$/.test(t)).length >= 2;
    const toksOf = l => amountTokens(l).map(t => { const m = cents && /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\d$/.exec(t.raw); return m ? Object.assign({}, t, { value: Math.round(Number(m[1].replace(/\./g, '')) + Number(m[2]) / 100), sep: true }) : t; });
    const isCode = (t, line) => !/[.,]/.test(t.raw) && (t.raw.length >= 9 || (t.raw.length >= 5 && sepStyle && !/\$/.test(line.slice(Math.max(0, t.index - 2), t.index + 2))));
    const dates = []; let afterTotal = false;
    const SKIP = /(cambio|efectivo|recibido|tarjeta|debito|\bdeb\b|credito|\bcred\b|\btef\b|visa|master|nequi|daviplata|vueltas|pago|cuotas|aprobaci|autoriz|redondeo|\bbase\b|exent|excluid|gravad|bruto|\bneto\b|saldo|puntos|tel[eé]?f|telefono|\btel\b|fecha|hora|\bcaja\b|cajero|factura|resoluci|\bres\b|decreto|autorreten|retenedor|\bnit\b|consecutivo|vendedor|cliente|ciudad|\bcalle\b|carrera|\bcra\b|direcci|\bpiso\b|codigo|descripcion|\bunid|t\.unid|medio de|\bitems?\b|articulos|cantidad|\bcant\b|documento|\bdoc\b|placa|p\W?[o0]?[l1i|]{1,2}za\b|\bdian\b|prefijo|entrada|salida|tiempo|min[uo]t|tarifa|alor por|punto fact|concepto|equivalente|desglose|forma de pago)/;
    const TAXW = /(\b[il1!|]?va\b|i\.v\.a|impoconsumo|imp\.?\s*consumo|\binc\b|impuesto|\bico\b|\b[il1!|(]?mpu\b)/;
    const isHeader = low => /(cant|precio|valor|total|descripcion|codigo|dto|dcto)/.test(low) && !lastAmount(low);
    let pendingQty = null;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li], low = plain(line);
      const nit = /nit[\s.:#-]*([\d.]{6,}[\s-]*\d?)/.exec(low); if (nit && !r.nit && li < 8) r.nit = nit[1].replace(/\s/g, '');
      // Fechas: primero el formato año-mes-día (2026-10-12, si no "26-10-12" se leería como 26 de octubre de 2012)
      const di = /(?<!\d)(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)/.exec(line) || /(?<!\d)(20\d{2})[\/\-.](\d{1,2}) (\d{1,2})(?![\d:])/.exec(line); // también "2026-10 12" (guion perdido)
      const d = di ? null : /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/.exec(line);
      if (di || d) {
        let y = Number(di ? di[1] : d[3]); if (y < 100) y += 2000; const mo = Number(di ? di[2] : d[2]), dd = Number(di ? di[3] : d[1]);
        if (y >= 2000 && y < 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) dates.push({ v: iso(y, mo, dd), w: /fecha/.test(low) ? 2 : 1 });
      }
      if (/\bde pag[o0]\b|(^|\s)[ck]?a[mn]bi[o0]\b|\brecibido\b/.test(low)) afterTotal = true; // forma de pago, recibido y cambio: ya no hay productos
      const toks = toksOf(line), a = toks[toks.length - 1];
      // Fila de totales bajo un encabezado "... TOTAL" (ej.: "4 39.330 0 39.330")
      if (li > 0 && /t[o0]ta[l1i]/.test(plain(lines[li - 1])) && isHeader(plain(lines[li - 1])) && a && nLetters(line) < 3) { totalRow = a.value; continue; }
      if (!a || a.value === 0) { const q = /^(\d{1,3})\s*[xX×*]\s*$/.exec(line); if (q) pendingQty = Number(q[1]); continue; }
      const v = a.value;
      if (/(^|\s)(?:[ck]?a[mn]bi[o0]|vueltas?)\b/.test(low)) { change = v; continue; }
      if (/(^|\s)(?:r?e?[cs]?[il1]b[il1]d[o0]|recibe|efectivo recibido|pago con)\b/.test(low)) { paid = v; continue; }
      if (/sub\s*-?\s*t[o0]ta[l1]/.test(low) || /^[cs5][uv][bhl]?t[o0][tlir]/.test(low)) { r.subtotal = v; continue; }
      if (/^b?ase\s+(?:[s5]?[ea]r?v|grav|impon|iva)/.test(low)) { if (!r.subtotal) r.subtotal = v; continue; } // base gravable o "Base Servicio"
      if (/(^|\s)(?:[t7]|l|i)?[o0]ta[l1i]?\s*a\s*pagar|valor a pagar|neto a pagar/.test(low)) { totalPay = v; afterTotal = true; continue; }
      if (/(propina|servicio voluntario|^servicio\b|\btip\b)/.test(low)) { tipSum += v; continue; }
      if (/(descuento|dcto|\bdesc\b|ahorro|promocion|rebaja)/.test(low)) { discSum += v; continue; }
      if (/(domicilio|\benvio\b|despacho|flete)/.test(low)) { shipSum += v; continue; }
      if ((TAXW.test(low) || /\b(19|5|8)\s?%/.test(low)) && !/(base|excluid|exent|no gravad|antes|total|responsable|regimen)/.test(low)) { taxSum += v; continue; }
      if (/t[o0]ta[l1i]/.test(low) && !/sub/.test(low)) { if (/a pagar|neto|factura|valor total|vr\.? ?total|total\s*:/.test(low)) { totalPay = v; afterTotal = true; } else if (!/(iva|impuesto|items|unidades|articulos|unid)/.test(low)) { total = v; afterTotal = true; } continue; }
      // "2 x 3.500" y el producto en la línea siguiente
      const qx = /^(\d{1,3})\s*[xX×*]\s*\$?\s*[\d.,]+$/.exec(line); if (qx && nLetters(line) <= 1) { pendingQty = Number(qx[1]); continue; }
      if (/(\btef\b|tarjeta|credito|debito|\bcred\b|\bdeb\b|visa|master|nequi|daviplata|datafono|\bpse\b|transferencia)/.test(low) && !/(cambio|cuotas)/.test(low)) payCard = v;
      if (SKIP.test(low) || afterTotal) { pendingQty = null; continue; } // después del TOTAL vienen pagos, impuestos y desgloses, no productos
      // Producto en dos líneas: nombre (con código) y debajo la fila de números "948 08 94 1 29.940 29.940"
      const next = lines[li + 1], nextToks = next ? amountTokens(next).filter(t => t.value >= 100 || t.raw.length <= 2) : [];
      const nameOnly = nLetters(line) >= 3 && (!a.sep && (a.value >= 1000 || /\d\/\d/.test(line.slice(a.index))) || /^\d{6,}/.test(line));
      while (nextToks.length && nextToks[nextToks.length - 1].value < 100) nextToks.pop(); // "4.70": dígito perdido al final
      if (nameOnly && next && nLetters(next) < 3 && nextToks.length && nextToks[nextToks.length - 1].value >= 100) {
        const nt = nextToks, tot = nt[nt.length - 1].value, price = nt.length >= 2 ? nt[nt.length - 2].value : null;
        let qty = 1; if (nt.length >= 3 && nt[nt.length - 3].value >= 1 && nt[nt.length - 3].value <= 99 && price && Math.abs(price * nt[nt.length - 3].value - tot) <= 1) qty = nt[nt.length - 3].value;
        let name = line.replace(/^\s*\d{4,}\s*/, '').replace(/(\s+\d[\d\/.,-]*)+\s*\S?$/, '').replace(/\s{2,}/g, ' ').trim();
        if (nLetters(name) >= 3) {
          const alts = [tot]; if (price) { if (nt.length >= 3 && nt[nt.length - 3].value <= 99) alts.push(price * nt[nt.length - 3].value); alts.push(price); }
          r.items.push({ name: name.slice(0, 60), qty, amount: tot, alts: [...new Set(alts.filter(x => x >= 100))] });
        }
        li++; pendingQty = null; continue;
      }
      if (v < 100) continue; // ningún producto cuesta menos de $100: es un número de dirección, NIT o similar
      if (isCode(a, line)) continue; // "222222222222", "12345678": documento, placa o código
      let name = line.slice(0, a.index).replace(/^\s*\d{4,}\s*/, '').replace(/[$*]+\s*$/, '').replace(/[\[{(][^\]})\s]{1,8}[\]})]/g, ' ').replace(/(^|\s)[\[{(][A-Za-z0-9]{2,8}(?=\s)/g, '$1').replace(/^(\d{1,2}\s+)\S{1,6}\]\s*/, '$1').replace(/\s{2,}/g, ' ').trim();
      let qty = pendingQty || 1; pendingQty = null;
      // "NOMBRE  2  7.000" o "NOMBRE 2 3.500 7.000" (cantidad, precio, total)
      const alts = [v];
      if (toks.length >= 2) { const p2 = toks[toks.length - 2]; if (p2.value >= 1 && p2.value <= 99 && name.endsWith(p2.raw)) { qty = p2.value; name = name.slice(0, name.length - p2.raw.length).trim(); } else if (p2.value >= 100 && toks.length >= 3 && toks[toks.length - 3].value <= 99 && Math.abs(p2.value * toks[toks.length - 3].value - v) <= 1) { qty = toks[toks.length - 3].value; alts.push(p2.value * qty); name = line.slice(0, toks[toks.length - 3].index).trim(); } }
      const q = /^(\d{1,3})\s*(?:x|un|und|unid|\*)\s+/i.exec(name) || /^(\d{1,2})\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/.exec(name) || /\s(\d{1,3})\s*(?:x|un|und|unid)\s*$/i.exec(name);
      if (q) { qty = Number(q[1]); name = name.replace(q[0], ' ').trim(); }
      name = name.replace(/[\[{(][^\]})\s]{1,8}[\]})]/g, ' ').replace(/(^|\s)[\[{(][A-Za-z0-9]{2,8}(?=\s)/g, ' ').replace(/^\S{1,6}\]\s*/, '').replace(/^(?:[x×*]+\s+)+/i, '').replace(/\s{2,}/g, ' ').replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/, '').replace(/[\s.:=-]+$/, '').trim();
      if (nLetters(name) < 3) continue;
      if (a.negative) { discSum += v; continue; }
      if (cents && !/[.,]\d{2}\d?$/.test(a.raw)) continue; // tirilla con centavos: un precio sin ",00" es otro número mal leído
      r.items.push({ name: name.slice(0, 60), qty, amount: v, alts });
    }
    if (tipSum) r.tip = tipSum; if (discSum) r.discount = discSum; if (shipSum) r.shipping = shipSum;
    const iva19 = lines.some(l => /\b19[.,]?0{0,2}\s?%/.test(l) && TAXW.test(plain(l))); // "IVA 19 %" impreso
    if (iva19) r.iva19 = true;
    // Total por votación entre fuentes independientes (un número mal leído o tapado por un dedo no decide solo)
    {
      const c = new Map(), add = (v, wgt) => { if (v && v >= 100) c.set(v, (c.get(v) || 0) + wgt); };
      // Un total impreso menor que el subtotal perdió la primera cifra ("$50,00" por "$250,00"): se busca la que cuadra con el IVA
      const fixLead = v => { if (!v || !r.subtotal || v >= r.subtotal) return v;
        const ok = [];
        for (let d = 1; d <= 9; d++) { const w = d * 10 ** String(v).length + v; if ([1, 1.05, 1.08, 1.19].some(k => Math.abs(w - r.subtotal * k) <= Math.max(2, w * 0.004)) || (taxSum && Math.abs(w - r.subtotal - taxSum) <= 2)) ok.push(w); }
        return ok.length === 1 ? ok[0] : v; };
      totalPay = fixLead(totalPay); total = fixLead(total);
      add(totalPay, 3); add(total, 2.5); add(totalRow, 2); add(payCard, 2);
      if (paid && change !== null && paid > change) add(paid - change, 2); // efectivo recibido − cambio
      // Subtotal e IVA que cuadran exacto (19, 8 o 5 %) son dos lecturas que se confirman: pesan más que un total mal leído
      if (rateOk(taxSum, r.subtotal)) add(r.subtotal + taxSum + tipSum + shipSum, 3.5);
      else if (r.subtotal && taxSum) add(r.subtotal + taxSum, 1.5);
      // Sin total legible pero con subtotal y "IVA 19 %" impreso: se propone subtotal + 19 % (el usuario lo confirma)
      else if (r.subtotal && !totalPay && !total && iva19) add(r.subtotal + Math.round(r.subtotal * 0.19), 1.25);
      const isum = r.items.reduce((s, i) => s + i.amount, 0); add(isum + (tipSum || 0) + (shipSum || 0) - (discSum || 0), 1);
      const cand = r.items.filter(i => ![totalPay, total, totalRow, payCard].includes(i.amount));
      const maxItem = Math.max(0, ...cand.map(i => Math.min(i.amount, ...(i.alts || [i.amount]))));
      let best = null, bw = 0;
      for (const [v, wgt] of c) {
        const plaus = v >= maxItem && (!r.subtotal || v >= r.subtotal * 0.98 || r.subtotal > v * 2) && (!maxItem || v <= maxItem * 40) && v < 1e9;
        const s = wgt + (plaus ? 0 : -2.5); if (s > bw) { bw = s; best = v; }
      }
      r.total = bw > 0 ? best : null;
      r.totalSource = r.total === null ? null : [totalPay, total, totalRow, payCard].includes(r.total) ? 'line' : 'sum';
    }
    // El IVA se valida contra el total (19 % incluido): corrige lecturas como "Sua 19%" o un dígito perdido
    if (r.total && taxSum > r.total * 0.3) { // ese valor era el subtotal (quedó junto a la etiqueta equivocada)
      if (Math.abs(taxSum - Math.round(r.total / 1.19)) <= 2 && (!r.subtotal || r.subtotal > r.total)) { r.subtotal = taxSum; taxSum = r.total - taxSum; } else taxSum = 0;
    }
    if (r.total) {
      const exp19 = r.total - Math.round(r.total / 1.19);
      if (taxSum && Math.abs(taxSum - exp19) > 2 && (!r.subtotal || Math.abs(r.total - r.subtotal - taxSum) > 2)) {
        if (r.subtotal && Math.abs(r.total - r.subtotal - exp19) <= 2) taxSum = exp19;                       // "6290" con subtotal que cuadra
        else if (!r.subtotal && Math.abs(taxSum - exp19) <= Math.max(10, exp19 * 0.01) && String(taxSum).length === String(exp19).length) taxSum = exp19; // un dígito errado
      }
      if (r.subtotal && (r.subtotal > r.total || r.subtotal < r.total * 0.5) && taxSum && Math.abs(r.total - taxSum - Math.round(r.total / 1.19)) <= 2) r.subtotal = r.total - taxSum;
    }
    const rest = r.total && r.subtotal ? r.total - r.subtotal - tipSum - shipSum : 0; // lo que queda para impuestos
    if (rest > 0 && (!taxSum || Math.abs(rest - taxSum) > 2) && (!taxSum || Math.abs(taxSum - (r.total - Math.round(r.total / 1.19))) > 2)
      && rateOk(rest, r.subtotal)) taxSum = rest; // el IVA leído no cuadra y total − subtotal sí
    if (taxSum) r.tax = taxSum;
    // Productos: cuadrar con el total probando las alternativas de cada línea (un dígito mal leído)
    if (r.total && r.items.length) {
      const targets = [r.total, r.total - (r.tip || 0) - (r.shipping || 0) + (r.discount || 0)];
      if (taxSum) targets.push(r.total - taxSum); if (r.subtotal) targets.push(r.subtotal);
      const sumNow = r.items.reduce((s, i) => s + i.amount, 0);
      if (!targets.includes(sumNow) && r.items.length <= 12) {
        const opts = r.items.map(i => [...new Set([i.amount, ...(i.alts || [])])]);
        let found = null;
        const dfs = (k, acc, pick) => { if (found) return; if (k === opts.length) { if (targets.includes(acc)) found = pick.slice(); return; } for (const o of opts[k]) { pick.push(o); dfs(k + 1, acc + o, pick); pick.pop(); } };
        if (opts.reduce((p, o) => p * o.length, 1) <= 4096) dfs(0, 0, []);
        if (found) r.items.forEach((it, k) => { it.amount = found[k]; });
      }
      r.items = r.items.filter(i => i.amount <= r.total * 1.02);
      // filas de totales o pagos leídas como producto
      if (r.items.length > 1) r.items = r.items.filter(i => i.amount !== r.total);
      if (r.items.length > 1) r.items = r.items.filter(i => i.amount !== r.subtotal && i.amount !== r.tax);
    }
    r.items.forEach(i => { delete i.alts; i.name = fixBizWords(i.name.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9)%]+$/, '').trim(), true); });
    if (r.total === null && r.items.length) r.total = sum(r.items.map(i => i.amount)) + (r.tip || 0) + (r.shipping || 0) - (r.discount || 0);
    if (dates.length) {
      const t = todayISO(), sc = new Map();
      for (const x of dates) { const age = diffDays(x.v, t); if (age < -31) continue; sc.set(x.v, (sc.get(x.v) || 0) + x.w + (age >= -1 && age <= 400 ? 2 : 0)); } // fechas futuras: mal leídas
      if (sc.size) r.date = [...sc.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    r.merchant = receiptMerchant(lines);
    return r;
  }

  /* ---------------- CSV ---------------- */
  function csvSafe(v) {
    if (typeof v === 'number') return String(v);
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // protección contra inyección de fórmulas
    if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) { return '﻿' + rows.map(r => r.map(csvSafe).join(',')).join('\r\n'); }
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { delim, rows: rows.filter(r => r.some(c => c.trim() !== '')) };
  }
  // Interpreta fechas comunes: 2026-01-31, 31/01/2026, 31-01-26, 01/31/2026 (si se indica formato)
  function parseDateFlexible(s, fmt) {
    s = String(s || '').trim();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return iso(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s))) {
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      const [d, mo] = fmt === 'MDY' ? [b, a] : [a, b];
      if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
      return iso(y, mo, d);
    }
    if (/^\d{5}$/.test(s)) { return fromUTC(Date.UTC(1899, 11, 30) + Number(s) * 86400000); } // serial de Excel
    return null;
  }

  /* ---------------- Cifrado de backups (WebCrypto) ---------------- */
  // AES-256-GCM con clave derivada por PBKDF2-SHA256 (600.000 iteraciones). Argon2id no existe en WebCrypto nativo.
  const KDF_ITER = 600000;
  function b64(bytes) { let s = ''; const c = 0x8000; for (let i = 0; i < bytes.length; i += c) s += String.fromCharCode.apply(null, bytes.subarray(i, i + c)); return btoa(s); }
  function unb64(str) { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  async function deriveKey(password, salt, iterations) {
    const subtle = root.crypto.subtle;
    const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptBackup(obj, password) {
    const salt = root.crypto.getRandomValues(new Uint8Array(16)), iv = root.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, KDF_ITER);
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    return { format: 'walletweb-backup', version: 1, createdAt: new Date().toISOString(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(ct) };
  }
  async function decryptBackup(file, password) {
    if (!file || file.format !== 'walletweb-backup') throw new Error('El archivo no es un backup de WalletWeb.');
    const key = await deriveKey(password, unb64(file.kdf.salt), file.kdf.iterations);
    let plain;
    try { plain = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.cipher.iv) }, key, unb64(file.data)); }
    catch (e) { throw new Error('Contraseña incorrecta o archivo dañado (falló la verificación de integridad).'); }
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function hashPin(pin, saltB64) {
    const salt = saltB64 ? unb64(saltB64) : root.crypto.getRandomValues(new Uint8Array(16));
    const base = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await root.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, base, 256));
    return { hash: b64(bits), salt: b64(salt) };
  }

  /* ---------------- Google Drive: carpeta y nombre de cada comprobante ----------------
     WalletWeb / Año / "MM Mes" / Movimiento / Categoría / "AAAAMMDD Persona Tienda.ext"
     (el número del mes va adelante para que Drive los ordene en orden de calendario) */
  const DRIVE_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DRIVE_KIND = { expense: ['Gasto'], income: ['Ingreso'], transfer: ['Transferencia'], adjust: ['Ajuste'], loan_out: ['Préstamo', 'Entregados'], loan_in: ['Préstamo', 'Recibidos'],
    repay_in: ['Préstamo', 'Abonos recibidos'], repay_out: ['Préstamo', 'Abonos pagados'], collect: ['Ingreso', 'Cobros de gastos compartidos'] };
  // Quita lo que Drive o los sistemas de archivos no aceptan en un nombre (/ \ : * ? " < > |) y espacios repetidos
  function driveSafe(s, max = 80) {
    return String(s ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }
  function driveExt(mime, name) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('pdf')) return '.pdf';
    if (m.includes('png')) return '.png';
    if (m.includes('heic') || m.includes('heif')) return '.heic';
    if (m.includes('webp')) return '.webp';
    if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
    const x = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
    return x ? '.' + x[1].toLowerCase() : '';
  }
  // o = { root, date, type, category, sub, people: [nombres], merchant, mime, fileName, fallback }
  function driveTarget(o) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : todayISO();
    const m = Number(date.slice(5, 7));
    const kind = DRIVE_KIND[o.type] || ['Otros'];
    const path = [driveSafe(o.root, 60) || 'WalletWeb', date.slice(0, 4), String(m).padStart(2, '0') + ' ' + DRIVE_MONTHS[m - 1], kind[0]];
    if (kind[1]) path.push(kind[1]);
    else if (o.type === 'expense' || o.type === 'income') path.push(driveSafe(o.category) || 'Sin categoría');
    const names = (o.people || []).map(p => driveSafe(p, 40)).filter(Boolean);
    const who = names.length > 3 ? names.slice(0, 2).join(', ') + ' y ' + (names.length - 2) + ' más'
      : names.length > 1 ? names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1] : (names[0] || '');
    const d = date.replace(/-/g, '');
    let base = [d, who, driveSafe(o.merchant, 60)].filter(Boolean).join(' ');
    if (base === d) base += ' ' + (driveSafe(o.sub, 40) || (o.type === 'expense' ? 'Factura' : driveSafe(o.fallback, 40) || 'Comprobante'));
    const name = base.slice(0, 120).trim() + driveExt(o.mime, o.fileName);
    return { path, name, key: path.join('/') + '/' + name };
  }
  /* Programa que el usuario pega en Google Apps Script (en su propia cuenta) y publica como aplicación web.
     Recibe los comprobantes de la app y solo toca archivos que él mismo creó dentro de la carpeta WalletWeb:
     cada archivo lleva en su descripción "WalletWeb ref:<id del movimiento>" y cada carpeta suya una marca. */
  const DRIVE_SCRIPT_VERSION = 1;
  const DRIVE_GS = String.raw`/**
 * WalletWeb Drive (versión 1)
 * Recibe las facturas y soportes que envía tu app WalletWeb y los guarda ordenados en tu Google Drive:
 *   WalletWeb / Año / Mes / Gasto, Ingreso o Transferencia / Categoría / AAAAMMDD Persona Tienda.pdf
 * Solo crea, renombra, mueve o manda a la papelera archivos que él mismo creó dentro de la carpeta WalletWeb.
 * La CLAVE es secreta y es la misma que tiene tu app: no la cambies ni compartas este código.
 */
var CLAVE = '__CLAVE__';
var VERSION = 1;
var MARCA_CARPETA = 'Carpeta creada por WalletWeb';
var TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

function doGet() {
  return ContentService.createTextOutput('WalletWeb Drive está funcionando. Copia la dirección de esta página (termina en /exec) y pégala en la app: Ajustes > Facturas en Google Drive.');
}

function doPost(e) {
  var candado = LockService.getScriptLock(), tengo = false;
  try {
    var p = JSON.parse(e && e.postData ? e.postData.contents : '{}');
    if (!p || p.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
    tengo = candado.tryLock(30000);
    if (!tengo) return salida({ ok: false, error: 'ocupado' });
    if (p.accion === 'probar') return salida({ ok: true, version: VERSION, cuenta: cuenta(), carpeta: raiz(p.raiz).getUrl() });
    if (p.accion === 'subir') return salida(subir(p));
    if (p.accion === 'papelera') return salida(papelera(p));
    return salida({ ok: false, error: 'accion' });
  } catch (err) {
    return salida({ ok: false, error: 'script', mensaje: String(err && err.message ? err.message : err).slice(0, 300) });
  } finally {
    if (tengo) candado.releaseLock();
  }
}

function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function cuenta() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function limpio(s, max) {
  return String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

// Carpeta principal: "WalletWeb" (o "WalletWeb - Perfil"). Se recuerda aunque la muevas dentro de tu Drive.
function raiz(nombre) {
  nombre = limpio(nombre || 'WalletWeb', 80);
  if (!/^WalletWeb( - .+)?$/.test(nombre)) nombre = 'WalletWeb';
  var props = PropertiesService.getScriptProperties(), k = 'raiz:' + nombre, id = props.getProperty(k);
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
  }
  var c = hija(DriveApp.getRootFolder(), nombre);
  props.setProperty(k, c.getId());
  return c;
}

function carpeta(ruta) {
  if (!ruta || !ruta.length || ruta.length > 8) throw new Error('Ruta no válida');
  var c = raiz(ruta[0]);
  for (var i = 1; i < ruta.length; i++) c = hija(c, limpio(ruta[i], 80) || 'Otros');
  return c;
}

function hija(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  var nueva = padre.createFolder(nombre);
  nueva.setDescription(MARCA_CARPETA);
  return nueva;
}

function firma(ref) { return 'WalletWeb ref:' + ref + ' '; }

// Solo devuelve archivos creados por WalletWeb para ese movimiento
function buscar(id, ref) {
  if (!id || !ref) return null;
  var f;
  try { f = DriveApp.getFileById(String(id)); } catch (e) { return null; }
  return String(f.getDescription() || '').indexOf(firma(ref)) >= 0 ? f : null;
}

function padres(f) {
  var out = [], it = f.getParents();
  while (it.hasNext()) out.push(it.next());
  return out;
}

function vivos(it) {
  while (it.hasNext()) if (!it.next().isTrashed()) return true;
  return false;
}

function ocupado(c, nombre, propio) {
  var it = c.getFilesByName(nombre);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed() && f.getId() !== propio) return true; }
  return false;
}

// "20261124 Laura Koaj.pdf" → si ya existe otro con ese nombre: "20261124 Laura Koaj (2).pdf"
function libre(c, nombre, propio) {
  var punto = nombre.lastIndexOf('.'), base = punto > 0 ? nombre.slice(0, punto) : nombre, ext = punto > 0 ? nombre.slice(punto) : '';
  for (var k = 1; k < 100; k++) {
    var n = k === 1 ? nombre : base + ' (' + k + ')' + ext;
    if (!ocupado(c, n, propio)) return n;
  }
  return base + ' (' + new Date().getTime() + ')' + ext;
}

// Manda a la papelera las carpetas de WalletWeb que quedaron vacías (nunca la principal ni carpetas tuyas)
function limpiar(c) {
  for (var i = 0; i < 8 && c; i++) {
    if (c.isTrashed() || String(c.getDescription() || '') !== MARCA_CARPETA || /^WalletWeb( - .+)?$/.test(c.getName())) return;
    if (vivos(c.getFiles()) || vivos(c.getFolders())) return;
    var ps = c.getParents(), padre = ps.hasNext() ? ps.next() : null;
    c.setTrashed(true);
    c = padre;
  }
}

function respuesta(f) {
  return { ok: true, id: f.getId(), url: f.getUrl(), nombre: f.getName(), version: VERSION };
}

function subir(p) {
  var ref = String(p.ref || '');
  if (!/^[\w-]{6,80}$/.test(ref)) return { ok: false, error: 'ref' };
  var ver = String(p.ver || '').replace(/[^\w-]/g, '').slice(0, 60);
  var destino = carpeta(p.ruta), nombre = limpio(p.nombre, 140) || 'Comprobante';
  var desc = String(p.descripcion || '').slice(0, 1500) + '\n\n' + firma(ref) + 'v:' + ver;
  var f = buscar(p.id, ref), antes;
  if (!p.datos) { // mover, renombrar o sacar de la papelera
    if (!f) return { ok: false, error: 'noexiste' };
    antes = padres(f);
    if (f.isTrashed()) f.setTrashed(false);
    if (!antes.some(function (x) { return x.getId() === destino.getId(); })) f.moveTo(destino);
    var n = libre(destino, nombre, f.getId());
    if (f.getName() !== n) f.setName(n);
    f.setDescription(desc);
    antes.forEach(function (x) { if (x.getId() !== destino.getId()) limpiar(x); });
    return respuesta(f);
  }
  // Reintento de una subida que sí llegó (se perdió la respuesta): no duplicar
  var cache = CacheService.getScriptCache(), ck = 'w:' + ref + ':' + ver;
  var previo = buscar(cache.get(ck), ref);
  if (previo && !previo.isTrashed()) return respuesta(previo);
  var it = destino.getFilesByName(nombre);
  while (it.hasNext()) {
    var x = it.next();
    if (!x.isTrashed() && String(x.getDescription() || '').indexOf(firma(ref) + 'v:' + ver) >= 0) { cache.put(ck, x.getId(), 21600); return respuesta(x); }
  }
  antes = [];
  if (f) { antes = padres(f); if (!f.isTrashed()) f.setTrashed(true); } // la versión anterior va a la papelera
  var tipo = TIPOS.indexOf(p.tipo) >= 0 ? p.tipo : 'application/octet-stream';
  var nuevo = destino.createFile(Utilities.newBlob(Utilities.base64Decode(p.datos), tipo, libre(destino, nombre, null)));
  nuevo.setDescription(desc);
  cache.put(ck, nuevo.getId(), 21600);
  antes.forEach(function (x) { if (x.getId() !== destino.getId()) limpiar(x); });
  return respuesta(nuevo);
}

function papelera(p) {
  var f = buscar(p.id, String(p.ref || ''));
  if (!f) return { ok: true, noexiste: true };
  if (!f.isTrashed()) {
    var antes = padres(f);
    f.setTrashed(true);
    antes.forEach(limpiar);
  }
  return { ok: true };
}
`;
  function driveScript(key) {
    if (!/^[\w-]{16,128}$/.test(String(key || ''))) throw new Error('Clave no válida');
    return DRIVE_GS.replace('__CLAVE__', key);
  }


  /* ---------------- Copias restauradas: revisión de formato ----------------
     Los identificadores, fechas, colores y algunos números se insertan en el HTML sin escapar porque siempre los genera la
     app. Una copia manipulada podría traer otra cosa: antes de restaurarla se revisa que tengan el formato esperado.
     Devuelve la lista de campos con formato raro (vacía si todo está bien). */
  const RX_ID = /^[\w.:@-]{1,200}$/, RX_DATE = /^\d{4}-\d{2}(-\d{2})?$/, RX_COLOR = /^#[0-9a-fA-F]{3,8}$/, RX_NUM = /^-?\d+(\.\d+)?$/;
  const STATE_DATE_KEYS = new Set(['date', 'due', 'nominal', 'firstDue', 'startDate', 'firstMonth', 'start', 'from', 'to', 'end', 'horizon']);
  const STATE_NUM_KEYS = new Set(['cuotas', 'transparency', 'blur', 'refract']);
  function unsafeStateFields(st) {
    const bad = [];
    const walk = (o, path, depth) => {
      if (bad.length >= 10) return;
      if (depth > 16) { bad.push(path); return; }
      for (const [k, v] of Object.entries(o)) {
        const p = path + (Array.isArray(o) ? '[' + k + ']' : '.' + k);
        if (v === null || v === undefined || v === '' || typeof v === 'boolean') continue;
        if (typeof v === 'object') {
          if (p === 'copia.settings.passkey') continue; // la app conserva la del dispositivo
          const prim = Array.isArray(v) && v.every(x => x === null || typeof x !== 'object');
          if (prim && (k === 'people' || k === 'splitPeople') && v.some(x => !RX_ID.test(String(x)))) bad.push(p);
          else if (prim && (k === 'extraHolidays' || k === 'workdays') && v.some(x => !RX_DATE.test(String(x)))) bad.push(p);
          else walk(v, p, depth + 1);
          continue;
        }
        const s = String(v);
        if ((k === 'id' || /Id$/.test(k)) && !RX_ID.test(s)) bad.push(p);
        else if (STATE_DATE_KEYS.has(k) && typeof v === 'string' && !RX_DATE.test(s)) bad.push(p);
        else if ((k === 'color' || k === 'colorHex') && !RX_COLOR.test(s)) bad.push(p);
        else if (STATE_NUM_KEYS.has(k) && typeof v !== 'number' && !RX_NUM.test(s)) bad.push(p);
      }
    };
    if (st && typeof st === 'object') walk(st, 'copia', 0); else bad.push('copia');
    return bad;
  }

  const api = {
    TZ, formatMoney, isMoney, evalAmount, parseNumberToken, splitEven, sum, mulDivRound,
    setCurrency, CUR, CUR_SYMBOLS, todayISO, nowTime, addDays, diffDays, dow, daysInMonth, monthKey, addMonthsKey, monthDiff, addMonthsISO, monthLabel, MONTHS, iso, parts,
    easter, holidaysCO, holidayName, isBusinessDay, prevBusinessDay, nextBusinessDay, occurrences,
    attributeToPeople, txEffects, isActive, accountBalance, personalAmount, receivableParts, expenseInMonth, incomeInMonth, installmentStatus,
    loanTotalInterest, loanSchedule, loanSummary, allocatePayment,
    budgetBase, budgetStatus, txMatchesScope, goalSummary, wishPlan, wishMonthly,
    duplicateScore, parsePastedText, parseReceiptText, receiptLinesFromWords, mergeReceiptReads, parseAmountToken, csvSafe, toCSV, parseCSV, parseDateFlexible,
    encryptBackup, decryptBackup, hashPin, b64, unb64,
    driveSafe, driveTarget, driveScript, DRIVE_SCRIPT_VERSION, DRIVE_MONTHS, unsafeStateFields, merchantScore, knownName
  };
  root.WWCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
