// Prueba de punta a punta de "Facturas en Google Drive" dentro de la app (390×844), con un Google simulado:
// el programa de Apps Script es el que la app copia al portapapeles, corriendo sobre el Drive simulado de tests/drive-mock.cjs,
// y las respuestas imitan las de Google (POST → 302 a script.googleusercontent.com → JSON con CORS).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const C = require(path.join(ROOT, 'core.js'));
const { makeDrive, loadScript } = require(path.join(ROOT, 'tests/drive-mock.cjs'));
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 8830);
// Certificado temporal para hacerse pasar por Google (no se sube al repositorio)
const CERT = path.join(__dirname, '.cert');
if (!fs.existsSync(path.join(CERT, 'cert.pem'))) {
  fs.mkdirSync(CERT, { recursive: true });
  require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(CERT, 'key.pem'), '-out', path.join(CERT, 'cert.pem'), '-days', '30',
    '-subj', '/CN=script.google.com', '-addext', 'subjectAltName=DNS:script.google.com,DNS:script.googleusercontent.com'], { stdio: 'ignore' });
}
// Servidor de la app (archivos del repositorio tal cual)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
const appSrv = require('http').createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname), f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const URL1 = 'https://script.google.com/macros/s/AKfycbTESTdeploymentIDabcdefghij1234567890/exec';
const pdf = tag => { const f = path.join(OUT, tag + '.pdf'); fs.writeFileSync(f, `%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`); return f; };
const log = (...a) => console.log('·', ...a);

(async () => {
  const drive = makeDrive(); let script = null, offline = false; const calls = [], results = new Map(), echoes = []; let rn = 0;
  // "Google" local: HTTPS en el puerto 443 para script.google.com y script.googleusercontent.com (mismo flujo que el real:
  // POST /macros/s/…/exec → 302 a script.googleusercontent.com/macros/echo → GET con el JSON, ambos con CORS)
  const https = require('https');
  const srv = https.createServer({ key: fs.readFileSync(path.join(CERT, 'key.pem')), cert: fs.readFileSync(path.join(CERT, 'cert.pem')) }, (req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const host = req.headers.host, url = new URL(req.url, 'https://' + host);
    if (host === 'script.google.com' && req.method === 'POST' && /^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) {
      let data = ''; req.on('data', c => { data += c; });
      req.on('end', () => {
        const body = JSON.parse(data);
        calls.push({ accion: body.accion, ruta: (body.ruta || []).join('/'), nombre: body.nombre, id: body.id || null, datos: body.datos ? Buffer.from(body.datos, 'base64').length : 0, ct: req.headers['content-type'], referer: req.headers['referer'] || '', cookie: req.headers['cookie'] || '', origin: req.headers.origin });
        const out = script ? script.post(body) : { ok: false, error: 'clave' };
        const k = String(++rn); results.set(k, out);
        res.writeHead(302, { Location: 'https://script.googleusercontent.com/macros/echo?user_content_key=' + k + '&lib=MTEST', 'Access-Control-Allow-Origin': '*' }); res.end();
      });
      return;
    }
    if (host === 'script.googleusercontent.com' && req.method === 'GET' && url.pathname === '/macros/echo') {
      echoes.push(req.headers.origin || '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(results.get(url.searchParams.get('user_content_key')) || { ok: false, error: 'x' })); return;
    }
    res.writeHead(404); res.end('no');
  });
  await new Promise(r => srv.listen(443, '127.0.0.1', r));
  await new Promise(r => appSrv.listen(PORT, '127.0.0.1', r));
  const NOPROXY = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  const b = await chromium.launch({ env: NOPROXY, args: ['--no-proxy-server', '--host-resolver-rules=MAP script.google.com 127.0.0.1, MAP script.googleusercontent.com 127.0.0.1'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'], ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/sw\.js|Failed to load resource|net::ERR_/.test(m.text())) errs.push(m.text()); });
  const idle = (fn, arg, ms = 25000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 200 });
  const synced = () => idle(() => driveReady() && !DRIVE.busy && !DRIVE.timer && driveWork().filter(x => !DRIVE.err[x.sig]).length === 0);

  await p.goto('http://localhost:' + PORT + '/index.html'); await p.waitForTimeout(1500);
  const ids = await p.evaluate(() => {
    closeAllSheets(); S.settings.onboarded = true;
    const mk = n => { const x = { id: uid(), name: n, alias: '', group: 'Amigos', notes: '', archived: false, createdAt: new Date().toISOString() }; S.people.push(x); return x.id; };
    const o = { laura: mk('Laura'), pedro: mk('Pedro'), nec: cats('expense').find(c => c.name === 'Necesario').id, ent: cats('expense').find(c => c.name === 'Entretenimiento').id };
    save(); render(); return o;
  });
  const newTx = async (o, file) => {
    await p.evaluate(o => { closeAllSheets(); openTxForm(o); }, o); await p.waitForTimeout(400);
    if (file) { await p.setInputFiles('input[data-act-change="receiptPick"]', file); await p.waitForTimeout(700); }
    await p.click('[data-act="txSave"]'); await p.waitForTimeout(700);
    return p.evaluate(m => S.transactions.filter(t => t.merchant === m && !t.deletedAt).pop().id, o.merchant);
  };
  // 1) Factura guardada ANTES de conectar: no sale nada
  const t1 = await newTx({ type: 'expense', amountText: '39330', merchant: 'Koaj', date: '2026-11-24', categoryId: ids.nec, people: [ids.laura] }, pdf('koaj'));
  await p.waitForTimeout(6000);
  assert.equal(calls.length, 0, 'sin conexión configurada no se envía nada');
  log('sin conectar: 0 envíos');

  // 2) Ajustes → Facturas en Google Drive
  await p.evaluate(() => go('ajustes')); await p.waitForTimeout(700);
  const rowTxt = await p.textContent('[data-act="driveSheet"]'); assert.match(rowTxt, /Sin conectar/);
  await p.evaluate(() => { const r = document.querySelector('[data-act="driveSheet"]'); r.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/0_ajustes.png' });
  await p.click('[data-act="driveSheet"]'); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/1_pasos.png' });
  await p.evaluate(() => { document.querySelector('.sheet-b').scrollTop = 99999; }); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/1b_pasos.png' });
  const tree = await p.$$eval('.drv-node', n => n.map(x => x.textContent.trim()));
  assert.deepEqual(tree, ['WalletWeb', '2026', '11 Noviembre', 'Gasto', 'Necesario', '20261124 Laura Koaj.pdf']);
  log('árbol de ejemplo:', tree.join(' › '));
  const key = await p.evaluate(() => S.settings.drive.key);
  assert.match(key, /^[\w-]{32}$/);
  await p.click('[data-act="driveCopy"]'); await p.waitForTimeout(200);
  const code = await p.evaluate(() => navigator.clipboard.readText());
  assert.ok(code.includes("var CLAVE = '" + key + "'"), 'el código copiado trae la clave de la app');

  // 3) Errores al conectar: URL /dev y clave equivocada
  await p.fill('#drvUrl', URL1.replace(/exec$/, 'dev')); await p.click('[data-act="driveConnect"]'); await p.waitForTimeout(200);
  assert.match(await p.textContent('#drvErr'), /\/dev/);
  await p.fill('#drvUrl', 'https://example.com/x'); await p.click('[data-act="driveConnect"]'); await p.waitForTimeout(200);
  assert.match(await p.textContent('#drvErr'), /script\.google\.com/);
  script = loadScript(C.driveScript('x'.repeat(32)), drive);
  await p.fill('#drvUrl', URL1); await p.click('[data-act="driveConnect"]'); await p.waitForTimeout(1500);
  assert.match(await p.textContent('#drvErr'), /clave no coincide/);
  log('errores de conexión: /dev, URL ajena y clave distinta → mensajes claros');

  // 4) Conectar con el código copiado: sube la factura que ya existía
  script = loadScript(code, drive);
  await p.click('[data-act="driveConnect"]');
  await idle(() => !!S.settings.drive.url); await synced();
  assert.deepEqual(drive.files(), ['WalletWeb/2026/11 Noviembre/Gasto/Necesario/20261124 Laura Koaj.pdf']);
  const size1 = await p.evaluate(id => Store.get('rcpt:' + id).then(b => b.size), t1);
  const up1 = calls.find(c => c.accion === 'subir' && c.datos);
  assert.equal(up1.datos, size1, 'llega el archivo completo');
  assert.ok(/^text\/plain/.test(up1.ct) && !up1.referer && !up1.cookie, 'texto plano, sin referer ni cookies');
  await p.waitForTimeout(400); await p.screenshot({ path: OUT + '/2_conectado.png' });
  log('conectado y subida inicial:', drive.files()[0]);

  // 5) Detalle del movimiento: "En Google Drive" + enlace
  await p.evaluate(id => { closeAllSheets(); txDetail(id); }, t1); await p.waitForTimeout(700);
  assert.match(await p.textContent('.sheet'), /En Google Drive/);
  assert.ok(await p.$('.drv-open[href^="https://drive.google.com/"]'));
  await p.evaluate(() => { const e = document.querySelector('#rcptView'); e && e.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/3_detalle.png' });

  // 6) Editar en el formulario (otra categoría y otra persona): se mueve y se renombra solo, sin volver a subir
  const nUp = calls.filter(c => c.datos).length;
  await p.evaluate(o => { closeAllSheets(); openTxForm(null, txById(o.t1)); D.categoryId = o.ent; D.subcategoryId = ''; D.people = [o.pedro]; rerenderTx(); }, { t1, ...ids }); await p.waitForTimeout(400);
  await p.click('[data-act="txSave"]');
  await idle(id => (S.driveFiles[id] || {}).key?.includes('/Entretenimiento/20261124 Pedro Koaj.pdf'), t1); await synced();
  assert.deepEqual(drive.files(), ['WalletWeb/2026/11 Noviembre/Gasto/Entretenimiento/20261124 Pedro Koaj.pdf']);
  assert.equal(calls.filter(c => c.datos).length, nUp, 'mover no vuelve a subir el archivo');
  assert.ok(!drive.folders().includes('WalletWeb/2026/11 Noviembre/Gasto/Necesario'), 'la carpeta vacía se limpia');
  log('editado (subida automática tras guardar):', drive.files()[0]);

  // 7) Eliminar → papelera de Drive; restaurar → vuelve a su lugar
  await p.evaluate(id => txDelete(id), t1); await idle(id => S.driveFiles[id]?.trashed, t1); await synced();
  assert.deepEqual(drive.files(), []); assert.equal(drive.trashedFiles().length, 1);
  await p.evaluate(id => ACT.restoreTx({ dataset: { id } }), t1); await idle(id => S.driveFiles[id] && !S.driveFiles[id].trashed, t1); await synced();
  assert.deepEqual(drive.files(), ['WalletWeb/2026/11 Noviembre/Gasto/Entretenimiento/20261124 Pedro Koaj.pdf']);
  log('eliminar → papelera de Drive, restaurar → vuelve');

  // 8) Otro movimiento con el mismo nombre ese día → (2)
  const t2 = await newTx({ type: 'expense', amountText: '12000', merchant: 'Koaj', date: '2026-11-24', categoryId: ids.ent, people: [ids.pedro] }, pdf('koaj2'));
  await idle(id => !!S.driveFiles[id], t2); await synced();
  assert.ok(drive.files().includes('WalletWeb/2026/11 Noviembre/Gasto/Entretenimiento/20261124 Pedro Koaj (2).pdf'));
  log('mismo nombre:', drive.files().join(' | '));

  // 9) Cambiar la factura del primero: la anterior a la papelera, la nueva con el mismo nombre
  const oldId = await p.evaluate(id => S.driveFiles[id].id, t1);
  await p.evaluate(id => { closeAllSheets(); openTxForm(null, txById(id)); }, t1); await p.waitForTimeout(400);
  await p.setInputFiles('input[data-act-change="receiptPick"]', pdf('koaj-nueva')); await p.waitForTimeout(700);
  await p.click('[data-act="txSave"]');
  await idle(o => S.driveFiles[o.t1] && S.driveFiles[o.t1].id !== o.oldId, { t1, oldId }); await synced();
  assert.equal(drive.byId(oldId).trashed, true);
  const f1 = await p.evaluate(id => S.driveFiles[id], t1);
  assert.equal(drive.pathOf(drive.byId(f1.id)), 'WalletWeb/2026/11 Noviembre/Gasto/Entretenimiento/20261124 Pedro Koaj.pdf');
  log('factura reemplazada: anterior en la papelera, nueva con el mismo nombre');

  // 10) Quitar la factura del segundo → su archivo a la papelera y se olvida
  await p.evaluate(id => { closeAllSheets(); openTxForm(null, txById(id)); }, t2); await p.waitForTimeout(400);
  await p.click('[data-act="rcptRemove"]'); await p.waitForTimeout(300); await p.click('[data-act="txSave"]');
  await idle(id => !S.driveFiles[id], t2); await synced();
  assert.deepEqual(drive.files(), ['WalletWeb/2026/11 Noviembre/Gasto/Entretenimiento/20261124 Pedro Koaj.pdf']);
  log('factura quitada → papelera de Drive');

  // 11) Sin Internet: queda pendiente con aviso y se recupera sola / con "Sincronizar ahora"
  offline = true;
  const t3 = await newTx({ type: 'income', amountText: '500000', merchant: 'Empresa', date: '2026-11-15', categoryId: await p.evaluate(() => cats('income')[0].id) }, pdf('nomina'));
  await idle(() => S.settings.drive.lastError?.kind === 'red', null, 20000);
  await p.evaluate(() => { closeAllSheets(); go('ajustes'); }); await p.waitForTimeout(500);
  assert.match(await p.textContent('[data-act="driveSheet"]'), /pendiente.*Revisar/);
  await p.click('[data-act="driveSheet"]'); await p.waitForTimeout(500);
  assert.match(await p.textContent('#drvStatus'), /No se pudo sincronizar/);
  await p.screenshot({ path: OUT + '/4_sin_internet.png' });
  offline = false;
  await p.click('[data-act="driveSyncNow"]'); await synced();
  assert.ok(drive.files().includes('WalletWeb/2026/11 Noviembre/Ingreso/Salario/20261115 Empresa.pdf'));
  assert.equal(await p.evaluate(() => S.settings.drive.lastError), null);
  await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/5_al_dia.png' });
  log('sin Internet → aviso; al volver → subido:', 'Ingreso/Salario/20261115 Empresa.pdf');

  // 12) Eliminado y papelera vaciada estando sin Internet → al volver, también va a la papelera de Drive
  offline = true;
  await p.evaluate(id => { closeAllSheets(); return txDelete(id); }, t3); await p.waitForTimeout(800);
  await p.evaluate(() => { S.transactions = S.transactions.filter(t => !t.deletedAt); save(); }); // como "Vaciar papelera"
  await p.waitForTimeout(6500);
  offline = false;
  await p.evaluate(() => driveSync({ force: true })); await synced();
  assert.ok(!drive.files().some(f => f.includes('Empresa')), 'el archivo del movimiento borrado para siempre fue a la papelera');
  assert.equal(await p.evaluate(id => !!S.driveFiles[id], t3), false);
  log('papelera vaciada sin Internet → también se refleja');

  // 13) Persistencia: al recargar la app sigue conectada y sube lo pendiente al abrir
  const t4id = await p.evaluate(async o => { const id = uid(); const blob = new Blob(['%PDF-1.4\n% recarga\n%%EOF\n'], { type: 'application/pdf' });
    await Store.set('rcpt:' + id, blob);
    S.transactions.push({ id, type: 'transfer', amount: 100000, date: '2026-10-02', status: 'confirmed', merchant: '', people: [], createdAt: new Date().toISOString(), receipt: { name: 'x.pdf', type: 'application/pdf', size: blob.size, hash: 'abc', addedAt: new Date().toISOString() } });
    DRIVE.quiet = true; save(); DRIVE.quiet = false; return id; }, ids);
  await p.waitForTimeout(800);
  await p.reload(); await p.waitForTimeout(1200);
  try { await idle(id => typeof S !== 'undefined' && !!S.driveFiles?.[id], t4id, 20000); }
  catch (e) { console.log('ERRS', JSON.stringify(errs)); console.log('ONLINE', await p.evaluate(() => navigator.onLine), 'calls', calls.length); await p.evaluate(() => driveSyncSoon(0)); await p.waitForTimeout(4000); console.log('AFTER manual', calls.length, JSON.stringify(await p.evaluate(() => ({ work: driveWork().length, busy: DRIVE.busy, retry: !!DRIVE.retry, backoff: DRIVE.backoff })))); console.log('DIAG', JSON.stringify(await p.evaluate(id => ({ ready: driveReady(), url: S.settings.drive && S.settings.drive.url, lastError: S.settings.drive && S.settings.drive.lastError, work: driveWork().map(w => w.sig), busy: DRIVE.busy, timer: !!DRIVE.timer, err: DRIVE.err, has: !!txById(id), files: Object.keys(S.driveFiles || {}).length, demo: S.demo, prof: PROFILE.id }), t4id))); throw e; }
  await synced();
  assert.ok(drive.files().includes('WalletWeb/2026/10 Octubre/Transferencia/20261002 Transferencia.pdf'));
  log('tras recargar: sigue conectada y sube lo pendiente');

  // 14) Perfil de demostración: nunca se conecta
  const demoTxt = await p.evaluate(() => { closeAllSheets(); S.demo = true; driveSheet(); const t = document.querySelector('.sheet').textContent; const ready = driveReady(); closeAllSheets(); S.demo = false; return { t, ready }; });
  assert.ok(/demostración nunca se conecta/.test(demoTxt.t) && !demoTxt.ready);
  log('demostración: no se conecta');

  // 14b) "Subir automáticamente" apagado: no sube solo; "Sincronizar ahora" sí
  await p.evaluate(() => { closeAllSheets(); go('ajustes'); }); await p.waitForTimeout(400);
  await p.click('[data-act="driveSheet"]'); await p.waitForTimeout(400);
  await p.evaluate(() => { const i = document.querySelector('[data-bind="settings.driveAuto"]'); i.scrollIntoView({ block: 'center' }); });
  await p.evaluate(() => document.querySelector('[data-bind="settings.driveAuto"]').click()); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => S.settings.driveAuto), false);
  const c0 = calls.length;
  const t5 = await newTx({ type: 'expense', amountText: '15000', merchant: 'Farmacia', date: '2026-11-21', categoryId: ids.nec }, pdf('farmacia'));
  await p.waitForTimeout(6500); assert.equal(calls.length, c0, 'con la subida automática apagada no sube solo');
  await p.evaluate(() => { closeAllSheets(); go('ajustes'); }); await p.waitForTimeout(400);
  await p.click('[data-act="driveSheet"]'); await p.waitForTimeout(400);
  assert.match(await p.textContent('#drvStatus'), /Subida automática apagada/);
  await p.click('[data-act="driveSyncNow"]'); await idle(id => !!S.driveFiles[id] && !DRIVE.busy, t5);
  assert.ok(drive.files().includes('WalletWeb/2026/11 Noviembre/Gasto/Necesario/20261121 Farmacia.pdf'));
  await p.evaluate(() => { const i = document.querySelector('[data-bind="settings.driveAuto"]'); i.scrollIntoView({ block: 'center' }); });
  await p.evaluate(() => document.querySelector('[data-bind="settings.driveAuto"]').click()); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => S.settings.driveAuto), true);
  log('subida automática apagada → solo con "Sincronizar ahora"');
  // 14c) Restaurar una copia: se conserva la conexión de este teléfono y lo que ya está en Drive
  const rs = await p.evaluate(o => { const next = JSON.parse(JSON.stringify(S)); next.settings.drive = { url: '', key: 'vieja' }; next.driveFiles = {};
    next.transactions = next.transactions.filter(t => t.id !== o.t5); driveKeepOnRestore(next);
    return { url: next.settings.drive.url, key: next.settings.drive.key === S.settings.drive.key, files: Object.keys(next.driveFiles).length, t5: !!next.driveFiles[o.t5], now: Object.keys(S.driveFiles).length }; }, { t5 });
  assert.ok(rs.url && rs.key && !rs.t5 && rs.files === rs.now - 1);
  log('restaurar copia: conserva conexión y archivos conocidos');
  // 15) Desconectar: deja de subir y lo de Drive se queda
  await p.evaluate(() => { closeAllSheets(); go('ajustes'); }); await p.waitForTimeout(400);
  await p.click('[data-act="driveSheet"]'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-act="driveDisconnect"]').scrollIntoView()); await p.click('[data-act="driveDisconnect"]'); await p.waitForTimeout(300); await p.click('.dialog [data-r="1"]'); await p.waitForTimeout(500);
  const before = calls.length, nfiles = drive.files().length;
  await newTx({ type: 'expense', amountText: '8000', merchant: 'Tienda', date: '2026-11-20', categoryId: ids.nec }, pdf('tienda')); await p.waitForTimeout(6500);
  assert.equal(calls.length, before); assert.equal(drive.files().length, nfiles);
  log('desconectado: no envía nada; Drive conserva', nfiles, 'archivos');

  console.log('\nDrive final:\n  ' + drive.files().join('\n  ') + '\nPapelera de Drive:\n  ' + drive.trashedFiles().join('\n  '));
  console.log('peticiones:', calls.length, '| errores de consola:', errs.length ? errs : 'ninguno');
  console.log('redirecciones seguidas:', echoes.length, '(origen tras la redirección:', JSON.stringify(echoes[0]), ')');
  await b.close(); srv.close(); appSrv.close();
  console.log('\nTODO OK');
})().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
