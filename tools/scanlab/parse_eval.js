// Re-evalúa solo la interpretación del texto (sin volver a escanear): node parse_eval.js [verbose]
const fs = require('fs'), path = require('path');
const C = require(path.join(__dirname, '../../core.js'));
const dir = path.join(__dirname, 'out'), gt = path.join(__dirname, 'gt');
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let n = 0, tot = 0, totN = 0, tax = 0, taxN = 0, date = 0, merch = 0, itemsHit = 0, itemsN = 0, extra = 0;
const verbose = process.argv[2];
for (const f of fs.readdirSync(dir).filter(f => /^syn_\d+\.json$/.test(f)).sort()) {
  const name = f.slice(0, -5), r = JSON.parse(fs.readFileSync(path.join(dir, f))), m = JSON.parse(fs.readFileSync(path.join(gt, name + '.json')));
  if (!r.text) continue;
  const P = C.parseReceiptText(r.text), F = m.fields; n++;
  const totVis = m.lines.some((l, i) => m.visible[i] && l.includes('TOTAL :')), taxVis = m.lines.some((l, i) => m.visible[i] && l.startsWith('Iva 19%'));
  if (totVis) { totN++; if (P.total === F.total) tot++; else if (verbose) console.log(name, 'TOTAL', P.total, '≠', F.total); }
  if (taxVis) { taxN++; if (P.tax === F.tax) tax++; else if (verbose) console.log(name, 'IVA', P.tax, '≠', F.tax); }
  if (P.date === F.date) date++; else if (verbose) console.log(name, 'FECHA', P.date, '≠', F.date);
  if (P.merchant && norm(P.merchant).includes(norm(F.merchant))) merch++; else if (verbose) console.log(name, 'TIENDA', P.merchant, '≠', F.merchant);
  const pa = P.items.map(i => i.amount);
  for (const it of F.items) { itemsN++; if (pa.includes(it.amount)) itemsHit++; }
  extra += Math.max(0, P.items.length - F.items.length);
  if (verbose === 'items') console.log(name, JSON.stringify(P.items.map(i => [i.name, i.qty, i.amount])), '| esperado', JSON.stringify(F.items.map(i => [i.name, i.qty, i.amount])));
}
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(0) + '%';
console.log(`fotos ${n}: total ${pc(tot, totN)} (${tot}/${totN})  iva ${pc(tax, taxN)}  fecha ${pc(date, n)}  tienda ${pc(merch, n)}  ítems ${pc(itemsHit, itemsN)}  sobrantes/foto ${(extra / Math.max(1, n)).toFixed(2)}`);
// la foto real (KOAJ)
const real = path.join(dir, 'real.json');
if (fs.existsSync(real)) { const t = JSON.parse(fs.readFileSync(real)).text; if (t) { const P = C.parseReceiptText(t); console.log('REAL:', JSON.stringify({ merchant: P.merchant, total: P.total, tax: P.tax, subtotal: P.subtotal, date: P.date, items: P.items.map(i => [i.name, i.qty, i.amount]) })); } }
