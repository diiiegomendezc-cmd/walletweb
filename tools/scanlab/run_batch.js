// Uso: node run_batch.js [prefijo] [desde] [hasta]   -> out/<nombre>.png y out/<nombre>.json
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const prefix = process.argv[2] || 'syn_', from = Number(process.argv[3] || 0), to = Number(process.argv[4] || 1e9);
  const files = fs.readdirSync(path.join(__dirname, 'imgs')).filter(f => f.startsWith(prefix) && /\.jpe?g$/.test(f)).sort().slice(from, to);
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  for (const f of files) {
    const name = path.basename(f, path.extname(f));
    try {
      const r = await p.evaluate(u => runScan(u), '/tools/scanlab/imgs/' + f);
      fs.writeFileSync(path.join(__dirname, 'out', name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      delete r.png;
      fs.writeFileSync(path.join(__dirname, 'out', name + '.json'), JSON.stringify(r));
      process.stdout.write(`${name} ${r.msDetect}+${r.msProcess}+${r.msOcr}ms\n`);
    } catch (e) { process.stdout.write(`${name} ERROR ${e.message}\n`); }
  }
  if (errs.length) console.log('ERRORES', errs.slice(0, 5));
  await b.close();
})();
