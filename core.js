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
  // (códigos como S17E-56012 o 1_FAC).
  function amountTokens(line) {
    const re = /[-–]?\$?\s?\d[\d.,]*/g, out = []; let m;
    while ((m = re.exec(line))) {
      const raw = m[0], lead = raw.search(/\d/), ds = m.index + lead;
      let de = m.index + raw.length; while (de > ds && /[.,]/.test(line[de - 1])) de--;
      const before = line[m.index - 1] || ' ', bd = line[ds - 1] || ' ', after = line[de] || ' ';
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñ_]/.test(before) && !/^\s/.test(raw)) continue;       // pegado a letras: código
      if (/[\/:]/.test(bd) && !/\s/.test(raw.slice(0, lead)) || /[\/:]/.test(after)) continue; // fechas y horas (10/05/26, 13:40)
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
  // Nombre de la tienda: "TIENDA KOAJ CALLE 12" → KOAJ; razón social (LTDA, S.A.S.) seguida de la marca → la marca
  function receiptMerchant(lines) {
    const ADDR = /\b(calle|cll|cl|carrera|cra|kr|avenida|av|diagonal|dg|transversal|tv|centro|cc|c\.c|local|piso|barrio|no|km)\b|#|\d/;
    const SKIPM = /(nit|tel|ciudad|caja|factura|fecha|hora|cliente|vendedor|consecutivo|regimen|resoluci|iva|responsable|codigo|descripcion|direcci|www|\.com|cajero|turno)/;
    const SUFFIX = /\b(ltda|limitada|s\.?\s?a\.?\s?s|s\.?a\.?|sas|e\.?u\.?|& cia|y cia)\b\.?/;
    const cands = [], top = lines.slice(0, 12).map(l => l.replace(/€/g, '&'));
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
  function mergeReceiptReads(a, b) {
    if (!a) return b; if (!b) return a;
    const sumIt = r => r.items.reduce((s, i) => s + i.amount, 0) + (r.tip || 0) + (r.shipping || 0) - (r.discount || 0);
    const votes = new Map(), add = (v, w) => { if (v) votes.set(v, (votes.get(v) || 0) + w); };
    add(a.total, a.totalSource === 'sum' ? 0.5 : 2); add(b.total, b.totalSource === 'sum' ? 0.5 : 2); add(sumIt(a), 0.75); add(sumIt(b), 0.75);
    if (a.subtotal && a.tax) add(a.subtotal + a.tax, 1); if (b.subtotal && b.tax) add(b.subtotal + b.tax, 1);
    let total = a.total || b.total, bw = 0; for (const [v, w] of votes) if (w > bw || (w === bw && v === a.total)) { bw = w; total = v; }
    const okTax = (t, s) => t && total && (Math.abs(t - (total - Math.round(total / 1.19))) <= 2 || (s && Math.abs(total - s - t) <= 2));
    const tax = okTax(a.tax, a.subtotal) ? a.tax : okTax(b.tax, b.subtotal) ? b.tax : (a.tax || b.tax);
    const okSub = s => s && total && s <= total && s >= total * 0.5;
    const subtotal = okSub(a.subtotal) ? a.subtotal : okSub(b.subtotal) ? b.subtotal : (a.subtotal || b.subtotal);
    const fits = r => r.items.length && Math.abs(sumIt(r) - total) <= 1;
    const items = fits(a) ? a.items : fits(b) ? b.items : (b.items.length > a.items.length ? b.items : a.items);
    return Object.assign({}, a, { total, tax, subtotal, items, date: a.date || b.date, merchant: a.merchant || b.merchant, nit: a.nit || b.nit, tip: a.tip ?? b.tip, discount: a.discount ?? b.discount, shipping: a.shipping ?? b.shipping });
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
    let taxSum = 0, tipSum = 0, discSum = 0, shipSum = 0, totalPay = null, total = null, totalRow = null, payCard = null;
    const SKIP = /(cambio|efectivo|recibido|tarjeta|debito|\bdeb\b|credito|\bcred\b|\btef\b|visa|master|nequi|daviplata|vueltas|pago|cuotas|aprobaci|autoriz|redondeo|\bbase\b|exent|excluid|gravad|bruto|\bneto\b|saldo|puntos|tel[eé]?f|telefono|\btel\b|fecha|hora|\bcaja\b|cajero|factura|resoluci|\bres\b|decreto|autorreten|retenedor|\bnit\b|consecutivo|vendedor|cliente|ciudad|\bcalle\b|carrera|\bcra\b|direcci|\bpiso\b|codigo|descripcion|\bunid|t\.unid|medio de|\bitems?\b|articulos|cantidad|\bcant\b)/;
    const TAXW = /(\b[il1!|]?va\b|i\.v\.a|impoconsumo|imp\.?\s*consumo|\binc\b|impuesto|\bico\b)/;
    const isHeader = low => /(cant|precio|valor|total|descripcion|codigo|dto|dcto)/.test(low) && !lastAmount(low);
    let pendingQty = null;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li], low = plain(line);
      const nit = /nit[\s.:#-]*([\d.]{6,}[\s-]*\d?)/.exec(low); if (nit && !r.nit && li < 8) r.nit = nit[1].replace(/\s/g, '');
      const d = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/.exec(line);
      if (d && (!r.date || /fecha/.test(low))) { let y = Number(d[3]); if (y < 100) y += 2000; const mo = Number(d[2]), dd = Number(d[1]); if (y >= 2000 && y < 2100 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31 && (!r.date || /fecha/.test(low))) r.date = iso(y, mo, dd); }
      const toks = amountTokens(line), a = toks[toks.length - 1];
      // Fila de totales bajo un encabezado "... TOTAL" (ej.: "4 39.330 0 39.330")
      if (li > 0 && /t[o0]ta[l1i]/.test(plain(lines[li - 1])) && isHeader(plain(lines[li - 1])) && a && nLetters(line) < 3) { totalRow = a.value; continue; }
      if (!a || a.value === 0) { const q = /^(\d{1,3})\s*[xX×*]\s*$/.exec(line); if (q) pendingQty = Number(q[1]); continue; }
      const v = a.value;
      if (/sub\s*-?\s*t[o0]ta[l1]/.test(low)) { r.subtotal = v; continue; }
      if (/(propina|servicio voluntario|^servicio\b|\btip\b)/.test(low)) { tipSum += v; continue; }
      if (/(descuento|dcto|\bdesc\b|ahorro|promocion|rebaja)/.test(low)) { discSum += v; continue; }
      if (/(domicilio|\benvio\b|despacho|flete)/.test(low)) { shipSum += v; continue; }
      if ((TAXW.test(low) || /\b(19|5|8)\s?%/.test(low)) && !/(base|excluid|exent|no gravad|antes|total|responsable|regimen)/.test(low)) { taxSum += v; continue; }
      if (/t[o0]ta[l1i]/.test(low) && !/sub/.test(low)) { if (/a pagar|neto|factura|valor total|vr\.? ?total|total\s*:/.test(low)) totalPay = v; else if (!/(iva|impuesto|items|unidades|articulos|unid)/.test(low)) total = v; continue; }
      // "2 x 3.500" y el producto en la línea siguiente
      const qx = /^(\d{1,3})\s*[xX×*]\s*\$?\s*[\d.,]+$/.exec(line); if (qx && nLetters(line) <= 1) { pendingQty = Number(qx[1]); continue; }
      if (/(\btef\b|tarjeta|credito|debito|\bcred\b|\bdeb\b|visa|master|nequi|daviplata|datafono|\bpse\b|transferencia)/.test(low) && !/(cambio|cuotas)/.test(low)) payCard = v;
      if (SKIP.test(low)) { pendingQty = null; continue; }
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
      let name = line.slice(0, a.index).replace(/^\s*\d{4,}\s*/, '').replace(/[$*]+\s*$/, '').trim();
      let qty = pendingQty || 1; pendingQty = null;
      // "NOMBRE  2  7.000" o "NOMBRE 2 3.500 7.000" (cantidad, precio, total)
      const alts = [v];
      if (toks.length >= 2) { const p2 = toks[toks.length - 2]; if (p2.value >= 1 && p2.value <= 99 && name.endsWith(p2.raw)) { qty = p2.value; name = name.slice(0, name.length - p2.raw.length).trim(); } else if (p2.value >= 100 && toks.length >= 3 && toks[toks.length - 3].value <= 99 && Math.abs(p2.value * toks[toks.length - 3].value - v) <= 1) { qty = toks[toks.length - 3].value; alts.push(p2.value * qty); name = line.slice(0, toks[toks.length - 3].index).trim(); } }
      const q = /^(\d{1,3})\s*(?:x|un|und|unid|\*)\s+/i.exec(name) || /^(\d{1,2})\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/.exec(name) || /\s(\d{1,3})\s*(?:x|un|und|unid)\s*$/i.exec(name);
      if (q) { qty = Number(q[1]); name = name.replace(q[0], ' ').trim(); }
      name = name.replace(/^(?:[x×*]+\s+)+/i, '').replace(/\s{2,}/g, ' ').replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/, '').replace(/[\s.:=-]+$/, '').trim();
      if (nLetters(name) < 3) continue;
      if (a.negative) { discSum += v; continue; }
      r.items.push({ name: name.slice(0, 60), qty, amount: v, alts });
    }
    if (tipSum) r.tip = tipSum; if (discSum) r.discount = discSum; if (shipSum) r.shipping = shipSum;
    // Total por votación entre fuentes independientes (un número mal leído o tapado por un dedo no decide solo)
    {
      const c = new Map(), add = (v, wgt) => { if (v && v >= 100) c.set(v, (c.get(v) || 0) + wgt); };
      add(totalPay, 3); add(total, 2.5); add(totalRow, 2); add(payCard, 2);
      if (r.subtotal && taxSum) add(r.subtotal + taxSum, 1.5);
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
    if (taxSum) r.tax = taxSum;
    // Productos: cuadrar con el total probando las alternativas de cada línea (un dígito mal leído)
    if (r.total && r.items.length) {
      const targets = [r.total, r.total - (r.tip || 0) - (r.shipping || 0) + (r.discount || 0)];
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
      if (r.items.length > 1) r.items = r.items.filter(i => i.amount !== r.total && i.amount !== r.subtotal && i.amount !== r.tax);
    }
    r.items.forEach(i => delete i.alts);
    if (r.total === null && r.items.length) r.total = sum(r.items.map(i => i.amount)) + (r.tip || 0) + (r.shipping || 0) - (r.discount || 0);
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

  const api = {
    TZ, formatMoney, isMoney, evalAmount, parseNumberToken, splitEven, sum, mulDivRound,
    setCurrency, CUR, CUR_SYMBOLS, todayISO, nowTime, addDays, diffDays, dow, daysInMonth, monthKey, addMonthsKey, monthDiff, addMonthsISO, monthLabel, MONTHS, iso, parts,
    easter, holidaysCO, holidayName, isBusinessDay, prevBusinessDay, nextBusinessDay, occurrences,
    attributeToPeople, txEffects, isActive, accountBalance, personalAmount, receivableParts, expenseInMonth, incomeInMonth, installmentStatus,
    loanTotalInterest, loanSchedule, loanSummary, allocatePayment,
    budgetBase, budgetStatus, txMatchesScope, goalSummary, wishPlan, wishMonthly,
    duplicateScore, parsePastedText, parseReceiptText, receiptLinesFromWords, mergeReceiptReads, parseAmountToken, csvSafe, toCSV, parseCSV, parseDateFlexible,
    encryptBackup, decryptBackup, hashPin, b64, unb64
  };
  root.WWCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
