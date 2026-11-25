// Limpieza sola sobre una imagen ya recortada: node debug_pre.js salida/ pre1.png ... [--box x0,y0,x1,y1]
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const outDir = process.argv[2]; fs.mkdirSync(outDir, { recursive: true });
  const args = process.argv.slice(3); const bi = args.indexOf('--box'); let box = null; if (bi >= 0) { box = args[bi + 1].split(',').map(Number); args.splice(bi, 2); }
  const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8820) + '/tools/scanlab/harness.html'); await p.waitForTimeout(300);
  for (const f of args) {
    const data = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    const r = await p.evaluate(async ({ data, box }) => {
      const img = new Image(); img.src = data; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0);
      window.__scanDebug = {}; const t0 = performance.now(); const res = scanClean(cv, 'clean'); const ms = Math.round(performance.now() - t0);
      const D = window.__scanDebug; window.__scanDebug = null;
      const c = document.createElement('canvas'); c.width = D.w; c.height = D.h; const x = c.getContext('2d'); const id = x.createImageData(D.w, D.h);
      for (let i = 0; i < D.w * D.h; i++) { const k = D.mask[i], ink = D.ink[i], o = i * 4;
        if (k) { const col = [[0,0,0],[0,140,0],[0,0,230],[0,170,170],[200,0,200],[255,140,0],[150,100,0]][k] || [0,0,0]; id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; } else if (ink) { id.data[o] = 230; id.data[o + 1] = 30; id.data[o + 2] = 30; } else { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; } id.data[o + 3] = 255; }
      x.putImageData(id, 0, 0);
      const comps = box ? D.C.filter(c => c.x1 >= box[0] && c.x0 <= box[2] && c.y1 >= box[1] && c.y0 <= box[3]).map(c => ({ id: c.id, bb: [c.x0, c.y0, c.w, c.h], area: c.area, keep: c.keep, mn: +c.mn.toFixed(2), maj: +c.major.toFixed(1), min: +c.minor.toFixed(1), ang: Math.round(c.ang), clip: c.clip, grp: c.grp, thick: c.thick, fr: c.fr })) : null;
      return { png: res.canvas.toDataURL('image/png'), dbg: c.toDataURL('image/png'), info: { sw: D.sw, r1: D.r1, Ts: +D.Ts.toFixed(2), Tw: +D.Tw.toFixed(2), p0: D.p0, L: D.L, comps: D.comps, kept: D.kept, ms }, comps };
    }, { data, box });
    const name = path.basename(f, path.extname(f));
    fs.writeFileSync(path.join(outDir, name + '_out.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(outDir, name + '_dbg.png'), Buffer.from(r.dbg.split(',')[1], 'base64'));
    console.log(name, JSON.stringify(r.info));
    if (r.comps) for (const c of r.comps) console.log('  ', JSON.stringify(c));
  }
  await b.close();
})();
