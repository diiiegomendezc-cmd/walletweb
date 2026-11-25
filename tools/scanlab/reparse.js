// Vuelve a interpretar los textos ya leídos (sin OCR) con el core actual: node reparse.js [prefijo]
const fs = require('fs'), path = require('path');
const C = require(path.join(__dirname, '../../core.js'));
const dir = path.join(__dirname, 'out'), pre = process.argv[2] || '';
for (const f of fs.readdirSync(dir).filter(f => f.startsWith(pre) && f.endsWith('.json'))) {
  const p = path.join(dir, f), r = JSON.parse(fs.readFileSync(p));
  if (!r.text) continue;
  r.parsedT6 = C.parseReceiptText(r.text);
  if (r.lines11) { r.parsedG11 = C.parseReceiptText(r.lines11.join('\n')); r.parsedM = C.mergeReceiptReads(r.parsedT6, r.parsedG11); }
  r.parsed = r.parsedM || r.parsedT6;
  if (r.textFlat) { r.parsedFlat = C.parseReceiptText(r.textFlat); r.parsed = C.mergeReceiptReads(r.parsed, r.parsedFlat); } // lectura de respaldo sin enderezar
  fs.writeFileSync(p, JSON.stringify(r));
}
