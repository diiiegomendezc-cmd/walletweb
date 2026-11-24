// Uso: node run_one.js imgs/real.jpg [nombreSalida]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const img = process.argv[2], name = process.argv[3] || path.basename(img, path.extname(img));
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  const r = await p.evaluate(u => runScan(u), '/tools/scanlab/' + img);
  fs.writeFileSync(path.join(__dirname, 'out', name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
  delete r.png;
  fs.writeFileSync(path.join(__dirname, 'out', name + '.json'), JSON.stringify(r));
  console.log(JSON.stringify({ score: r.score, byLines: r.byLines, quad: r.quad && r.quad.map(q => q.map(Math.round)), src: [r.srcW, r.srcH], out: [r.outW, r.outH], ms: [r.msDetect, r.msProcess, r.msOcr], fingers: r.fingers, conf: r.conf }));
  console.log('--- TEXTO ---\n' + r.text);
  console.log('--- DATOS ---\n' + JSON.stringify(r.parsed, null, 1));
  if (errs.length) console.log('ERRORES', errs);
  await b.close();
})();
