// Guarda la imagen justo antes de la limpieza (ya recortada y enderezada) para revisar la limpieza con debug_pre.js:
//   node capture_pre.js /tmp/dbg imgs/mix_003.jpg ...   -> /tmp/dbg/pre_mix_003.png
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const outDir = process.argv[2]; fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  for (const img of process.argv.slice(3)) {
    const r = await p.evaluate(async u => {
      const orig = window.scanClean; let cap = null;
      window.scanClean = (c, m) => { cap = c.toDataURL('image/png'); return orig(c, m); };
      try { const res = await runScan(u, { ocr: false }); return { cap, quad: res.quad }; } finally { window.scanClean = orig; }
    }, '/tools/scanlab/' + img);
    const name = path.basename(img, path.extname(img));
    fs.writeFileSync(path.join(outDir, 'pre_' + name + '.png'), Buffer.from(r.cap.split(',')[1], 'base64'));
    console.log(name, JSON.stringify((r.quad || []).map(q => q.map(Math.round))));
  }
  await b.close();
})();
