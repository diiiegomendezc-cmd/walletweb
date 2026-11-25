// Uso: node debug_clean.js salida/ imgs/a.jpg imgs/b.jpg ...  -> <nombre>.png (resultado) y <nombre>_dbg.png (verde = se conserva, rojo = se borra)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const outDir = process.argv[2]; fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  for (const img of process.argv.slice(3)) {
    const r = await p.evaluate(async u => {
      window.__scanDebug = {};
      const t0 = performance.now(); const res = await runScan(u, { ocr: false }); const ms = Math.round(performance.now() - t0);
      const D = window.__scanDebug; window.__scanDebug = null;
      const c = document.createElement('canvas'); c.width = D.w; c.height = D.h; const x = c.getContext('2d'); const id = x.createImageData(D.w, D.h);
      for (let i = 0; i < D.w * D.h; i++) { const k = D.mask[i], ink = D.ink[i]; const o = i * 4;
        if (k) { id.data[o] = 0; id.data[o + 1] = 140; id.data[o + 2] = 0; } else if (ink) { id.data[o] = 230; id.data[o + 1] = 30; id.data[o + 2] = 30; } else { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; }
        id.data[o + 3] = 255; }
      x.putImageData(id, 0, 0);
      return { png: res.png, dbg: c.toDataURL('image/png'), info: { sw: D.sw, r1: D.r1, Ts: +D.Ts.toFixed(2), Tw: +D.Tw.toFixed(2), p0: D.p0, L: D.L, comps: D.comps, kept: D.kept, ms, out: [res.outW, res.outH] } };
    }, '/tools/scanlab/' + img);
    const name = path.basename(img, path.extname(img));
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(outDir, name + '_dbg.png'), Buffer.from(r.dbg.split(',')[1], 'base64'));
    console.log(name, JSON.stringify(r.info));
  }
  await b.close();
})();
