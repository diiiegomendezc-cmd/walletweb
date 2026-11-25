// Solo detección (rápido): node run_detect.js prefijo [desde] [hasta] -> out_det/<nombre>.json con el recorte
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const outDir = path.join(__dirname, process.env.OUT || 'out_det'); fs.mkdirSync(outDir, { recursive: true });
  const prefix = process.argv[2] || 'syn_', from = Number(process.argv[3] || 0), to = Number(process.argv[4] || 1e9);
  const files = fs.readdirSync(path.join(__dirname, 'imgs')).filter(f => f.startsWith(prefix) && /\.jpe?g$/.test(f)).sort().slice(from, to);
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  for (const f of files) {
    const r = await p.evaluate(async u => { const cv = await loadImg(u); const t0 = performance.now(); const a = scanAutoDetect(cv); return { quad: a.quad, srcW: cv.width, srcH: cv.height, ms: Math.round(performance.now() - t0), view: a.det && a.det.view, byLines: a.det && a.det.byLines }; }, '/tools/scanlab/imgs/' + f);
    fs.writeFileSync(path.join(outDir, path.basename(f, path.extname(f)) + '.json'), JSON.stringify(r));
  }
  await b.close();
})();
