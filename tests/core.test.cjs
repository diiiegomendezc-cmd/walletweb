// Ejecutar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('calculadora de importes en formato colombiano', () => {
  assert.equal(C.evalAmount('200000 / 4'), 50000);
  assert.equal(C.evalAmount('200.000/4'), 50000);
  assert.equal(C.evalAmount('$ 1.250.000'), 1250000);
  assert.equal(C.evalAmount('12.000 + 3.500'), 15500);
  assert.equal(C.evalAmount('(10000+5000)*2'), 30000);
  assert.equal(C.evalAmount('25,5'), 26); // redondeo a peso
  assert.equal(C.evalAmount('100/0'), null);
  assert.equal(C.evalAmount('alert(1)'), null);
  assert.equal(C.evalAmount(''), null);
});

test('división determinista de gastos compartidos', () => {
  assert.deepEqual(C.splitEven(200000, 4), [50000, 50000, 50000, 50000]);
  const p = C.splitEven(100000, 3);
  assert.deepEqual(p, [33334, 33333, 33333]);
  assert.equal(C.sum(p), 100000);
});

test('ejemplo del prompt: cuenta de 200.000 entre 4', () => {
  const tx = { type: 'expense', status: 'confirmed', amount: 200000, date: '2026-11-10', accountId: 'a',
    split: { myShare: 50000, parts: [{ personId: 'p1', amount: 50000 }, { personId: 'p2', amount: 50000 }, { personId: 'p3', amount: 50000 }] } };
  assert.equal(C.personalAmount(tx), 50000);
  assert.equal(C.sum(C.receivableParts(tx).map(r => r.pending)), 150000);
  assert.equal(C.accountBalance({ id: 'a', initialBalance: 0 }, [tx]), -200000);
  // cobro posterior: entra dinero pero NO es ingreso económico
  const collect = { type: 'collect', status: 'confirmed', amount: 50000, date: '2026-11-12', accountId: 'a' };
  assert.equal(C.incomeInMonth(collect, '2026-11'), 0);
  assert.equal(C.accountBalance({ id: 'a', initialBalance: 0 }, [tx, collect]), -150000);
  // parte marcada como regalo cuenta como gasto personal
  tx.split.parts[0].gift = true;
  assert.equal(C.personalAmount(tx), 100000);
});

test('festivos de Colombia 2026 (Ley Emiliani y Semana Santa)', () => {
  const h = C.holidaysCO(2026);
  for (const d of ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18',
    '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
    '2026-11-16', '2026-12-08', '2026-12-25']) assert.ok(h[d], 'falta festivo ' + d);
  assert.equal(Object.keys(h).length, 18);
});

test('salario 15 y 30: día hábil anterior', () => {
  const rule = { freq: 'monthly_days', days: [15, 30], adjust: 'prev', startDate: '2026-01-01' };
  const occ = C.occurrences(rule, '2026-11-01', '2027-02-28');
  const map = Object.fromEntries(occ.map(o => [o.nominal, o.due]));
  assert.equal(map['2026-11-15'], '2026-11-13'); // domingo -> viernes
  assert.equal(map['2026-11-30'], '2026-11-30'); // lunes hábil
  assert.equal(map['2027-01-30'], '2027-01-29'); // sábado -> viernes
  assert.equal(map['2027-02-28'], '2027-02-26'); // febrero: día 30 -> 28 (domingo) -> viernes 26
  // festivo: 2026-06-15 (Sagrado Corazón, lunes) -> viernes 12
  assert.equal(C.occurrences(rule, '2026-06-01', '2026-06-30')[0].due, '2026-06-12');
});

test('préstamo de 1.000.000 con interés simple y abono parcial', () => {
  const loan = { principal: 1000000, rateBp: 200, interestMode: 'simple', termMonths: 5, installments: 5, firstDue: '2026-12-10', payments: [] };
  assert.equal(C.loanTotalInterest(loan), 100000);
  const sch = C.loanSchedule(loan);
  assert.equal(sch.length, 5);
  assert.equal(C.sum(sch.map(s => s.amount)), 1100000);
  const alloc = C.allocatePayment(loan, 300000);
  assert.deepEqual(alloc, { interest: 40000, capital: 260000 }); // cuota 1 completa (20k+200k) + interés cuota 2 (20k) + 60k capital
  loan.payments.push({ amount: 300000, ...alloc });
  const s = C.loanSummary(loan, '2026-12-01');
  assert.equal(s.balance, 800000);
  assert.equal(s.capitalBalance, 740000);
  assert.equal(s.status, 'partial');
  // el capital devuelto no cuenta como ingreso; el interés sí
  const tx = { type: 'repay_in', status: 'confirmed', amount: 300000, interest: 100000, capital: 200000, date: '2026-12-01' };
  assert.equal(C.incomeInMonth(tx, '2026-12'), 100000);
  assert.ok(C.allocatePayment(loan, 900000).error);
  // vencido
  const late = C.loanSummary(loan, '2027-03-17');
  assert.equal(late.status, 'overdue');
  assert.ok(late.daysLate > 0);
});

test('interés compuesto con redondeo mensual entero', () => {
  const loan = { principal: 1000000, rateBp: 100, interestMode: 'compound', termMonths: 2, installments: 1, firstDue: '2026-12-01', payments: [] };
  assert.equal(C.loanTotalInterest(loan), 20100);
});

test('compras a cuotas: vista por compra vs por cuota', () => {
  const tx = { type: 'expense', status: 'confirmed', amount: 300000, date: '2026-11-05', installments: { n: 3, firstMonth: '2026-12' } };
  assert.equal(C.expenseInMonth(tx, '2026-11', 'purchase'), 300000);
  assert.equal(C.expenseInMonth(tx, '2026-11', 'installment'), 0);
  assert.equal(C.expenseInMonth(tx, '2026-12', 'installment'), 100000);
  assert.equal(C.expenseInMonth(tx, '2027-03', 'installment'), 0);
});

test('presupuesto: estados y proyección', () => {
  const ctx = { expectedIncome: 4000000, receivedIncome: 2000000, isCurrent: true, dayOfMonth: 10, daysInMonth: 30 };
  const b = C.budgetStatus({ method: 'fixed', value: 1000000 }, 850000, ctx, 80);
  assert.equal(b.state, 'near');
  assert.equal(b.available, 150000);
  assert.equal(b.projection, 2550000);
  assert.equal(C.budgetStatus({ method: 'pctReceived', value: 30 }, 700000, ctx, 80).state, 'over');
  assert.equal(C.budgetStatus({ method: 'pctExpected', value: 0 }, 0, ctx, 80).state, 'nodata');
});

test('CSV: protección contra inyección y lectura con punto y coma', () => {
  assert.equal(C.csvSafe('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(C.csvSafe('@SUM'), "'@SUM");
  assert.equal(C.csvSafe(-5000), '-5000');
  const r = C.parseCSV('fecha;valor;desc\n31/01/2026;"12.000";"Café; leche"\n');
  assert.equal(r.delim, ';');
  assert.deepEqual(r.rows[1], ['31/01/2026', '12.000', 'Café; leche']);
  assert.equal(C.parseDateFlexible('31/01/2026'), '2026-01-31');
  assert.equal(C.parseDateFlexible('45658'), '2025-01-01');
  assert.equal(C.parseDateFlexible('31/02/2026'), null);
});

test('texto pegado de una notificación', () => {
  const r = C.parsePastedText('Compraste $25.900 en EXITO CALLE 80 con tu RappiCard');
  assert.equal(r.amount, 25900);
  assert.equal(r.type, 'expense');
  assert.match(r.merchant, /EXITO/);
});

test('duplicados probables', () => {
  const a = { amount: 54000, date: '2026-11-10', merchant: 'Éxito', accountId: 'x' };
  assert.ok(C.duplicateScore(a, { amount: 54000, date: '2026-11-10', merchant: 'EXITO', accountId: 'x' }) >= 90);
  assert.ok(C.duplicateScore(a, { amount: 12000, date: '2026-10-01', merchant: 'Rappi' }) < 30);
});

test('backup cifrado: ida y vuelta, y rechazo con contraseña incorrecta', async () => {
  const data = { hola: 'mundo', n: 123 };
  const f = await C.encryptBackup(data, 'clave-larga-de-prueba');
  assert.equal(f.cipher.name, 'AES-GCM');
  assert.deepEqual(await C.decryptBackup(f, 'clave-larga-de-prueba'), data);
  await assert.rejects(() => C.decryptBackup(f, 'otra'));
  const tampered = { ...f, data: f.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => C.decryptBackup(tampered, 'clave-larga-de-prueba'));
});

test('metas: fecha estimada', () => {
  const g = { target: 3000000, monthly: 500000, contributions: [{ amount: 1000000 }] };
  const s = C.goalSummary(g, '2026-11-16');
  assert.equal(s.remaining, 2000000);
  assert.equal(s.eta, '2027-03-16');
});

test('presupuesto por subcategoría', () => {
  const tx = { categoryId: 'nec', subcategoryId: 'mercado', nature: 'need' };
  assert.equal(C.txMatchesScope(tx, { scope: 'subcategory', ref: 'mercado' }), true);
  assert.equal(C.txMatchesScope(tx, { scope: 'subcategory', ref: 'hogar' }), false);
  assert.equal(C.txMatchesScope(tx, { scope: 'category', ref: 'nec' }), true);
});

test('gasto etiquetado con varias personas se reparte en partes iguales', () => {
  assert.deepEqual(C.attributeToPeople(200000, ['mama', 'papa', 'sofi', 'mama']), [{ id: 'mama', amount: 66667 }, { id: 'papa', amount: 66667 }, { id: 'sofi', amount: 66666 }]);
  assert.deepEqual(C.attributeToPeople(90000, ['novia']), [{ id: 'novia', amount: 90000 }]);
  assert.deepEqual(C.attributeToPeople(1000, []), []);
});

test('lectura de factura: productos, IVA, propina, descuento y total', () => {
  const txt = `RESTAURANTE EL CORRAL
NIT 800.123.456-7
Fecha: 15/11/2026 Hora 13:45
2 x HAMBURGUESA CLASICA   46.000
PAPAS FRANCESAS 9.900
1 LIMONADA NATURAL $ 8.500
DESCUENTO CUMPLE -5.000
SUBTOTAL 59.400
IMPOCONSUMO 8%   4.752
PROPINA SUGERIDA 10% 5.940
TOTAL A PAGAR $ 70.092
EFECTIVO 80.000
CAMBIO 9.908`;
  const r = C.parseReceiptText(txt);
  assert.equal(r.total, 70092);
  assert.equal(r.tax, 4752);
  assert.equal(r.tip, 5940);
  assert.equal(r.discount, 5000);
  assert.equal(r.subtotal, 59400);
  assert.equal(r.date, '2026-11-15');
  assert.equal(r.nit, '800.123.456-7');
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.amount]), [['HAMBURGUESA CLASICA', 2, 46000], ['PAPAS FRANCESAS', 1, 9900], ['LIMONADA NATURAL', 1, 8500]]);
});
test('lectura de factura: supermercado con IVA y domicilio, sin inventar', () => {
  const r = C.parseReceiptText(`ARROZ DIANA 1KG 4.850 A\nLECHE ENTERA 6.200\nIVA 19% 1.178\nDOMICILIO 3.000\nTOTAL 15.228`);
  assert.equal(r.total, 15228); assert.equal(r.tax, 1178); assert.equal(r.shipping, 3000);
  assert.equal(r.tip, null); assert.equal(r.discount, null);
  assert.equal(r.items.length, 2);
  assert.equal(C.parseReceiptText('foto borrosa sin numeros').total, null);
});

test('lectura de tirilla de almacén: ítems en dos líneas, dígito mal leído, IVA corrido y tienda', () => {
  // Texto como lo entrega el lector: "79,940" es un 29.940 mal leído y el IVA quedó medio renglón arriba
  const txt = `PERMODA LTDA.
NIT: 860.516.806 - 5
TIENDA KOAJ CALLE 12 CENTRO
KOAJ
Calle 7 # 12B-58 Piso 1
1_FAC ELECTRONICA VENTA S17E-56012
Consecutivo:S17E-56012
Fecha: 30/08/26 Hora: 13:40:57
CODIGO DESCRIPCION
COLOR TALLA UM CANT PRECIO DCTO TOTAL
105236761012 SHORT KOAJ MAUS 27963 4/25
948 08 94 1 29.940 79,940
105255761120 MEDIAS KOAJ TOBILLERA 29145
910 9-11 94 1 4.740 4.70
291318 BOLSA PAPEL
999 S 94 1 700 700
T.Unid. VALOR DTO.LIN TOTAL
3 35.380 0 35.380
33050
Vta.Subtotal
5650
Iva 19%
TOTAL : 35.380
TEF CRED 35.380
CAMBIO 0
AUTORRETENEDORES DE RENTA RES.007241 DEL`;
  const r = C.parseReceiptText(txt);
  assert.equal(r.total, 35380);
  assert.equal(r.merchant, 'KOAJ');
  assert.equal(r.date, '2026-08-30');
  assert.deepEqual(r.items.map(i => [i.name, i.amount]), [['SHORT KOAJ MAUS', 29940], ['MEDIAS KOAJ TOBILLERA', 4740], ['BOLSA PAPEL', 700]]);
  assert.equal(r.tax, 5650);              // 35.380 − 35.380/1,19
  assert.equal(r.discount, null);         // "S17E-56012" es un código, no un descuento
});
test('lectura: total con dos puntos, marca completa y dos lecturas que se completan', () => {
  const a = C.parseReceiptText('ARTURO CALLE S.A.S.\nTIENDA ARTURO CALLE CALLE 45 CENTRO\nARTURO CALLE\nCAMISA OXFORD 1 89.900\nTOTAL :    89.900\nTEF DEB 89.900');
  assert.equal(a.total, 89900); assert.equal(a.merchant, 'ARTURO CALLE');
  // la primera lectura perdió el IVA; la segunda lo tiene y cuadra con el total
  const r1 = C.parseReceiptText('CAMISA OXFORD 89.900\nTOTAL : 89.900'), r2 = C.parseReceiptText('CAMISA OXFORD 89.900\nIva 19% 14.354\nTOTAL : 89.900');
  const m = C.mergeReceiptReads(r1, r2);
  assert.equal(m.total, 89900); assert.equal(m.tax, 14354);
  // renglones rearmados con la posición de las palabras
  const w = (t, x, y) => ({ text: t, bbox: { x0: x, x1: x + t.length * 10, y0: y, y1: y + 20 } });
  assert.deepEqual(C.receiptLinesFromWords([w('Iva', 10, 100), w('19%', 60, 101), w('6280', 300, 92)]), ['Iva 19% 6280']);
});

test('lista de deseos: fondo mensual, plan por prioridad y fecha en que alcanza', () => {
  const fund = { start: '2026-09', history: [{ from: '2026-09', amount: 300000 }], adjustments: [{ amount: 200000 }], horizon: '2026-12-31' };
  const wishes = [
    { id: 'a', name: 'Audífonos', price: 900000, priority: 1, status: 'active' },
    { id: 'b', name: 'Silla', price: 700000, priority: 2, status: 'active' },
    { id: 'c', name: 'Consola', price: 2500000, priority: 3, status: 'active' },
    { id: 'd', name: 'Libro', price: 100000, priority: 1, status: 'bought', paid: 80000 },
    { id: 'e', name: 'Reloj', price: 500000, priority: 1, status: 'discarded' }
  ];
  const p = C.wishPlan(fund, wishes, '2026-11-21');
  // sep, oct, nov = 900.000 + 200.000 de ajuste − 80.000 gastados
  assert.equal(p.available, 1020000);
  assert.equal(p.monthsLeft, 1);
  assert.equal(p.projection, 1320000);
  assert.deepEqual(p.items.map(x => x.w.id), ['a', 'b', 'c']);
  assert.equal(p.items[0].now, true);
  assert.equal(p.items[1].fits, false);           // 1.600.000 > 1.320.000
  assert.equal(p.items[1].eta, '2027-01');         // 1.020.000 + 300.000·2 = 1.620.000
  assert.equal(p.fitCount, 1);
  assert.equal(p.leftover, 420000);
  // cambiar el presupuesto desde diciembre no cambia lo acumulado
  fund.history.push({ from: '2026-12', amount: 500000 });
  const q = C.wishPlan(fund, wishes, '2026-11-21');
  assert.equal(q.available, 1020000);
  assert.equal(q.projection, 1520000);
});
