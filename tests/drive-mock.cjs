// Drive simulado para probar el programa de Apps Script (core.js → driveScript) sin Google.
// Imita lo que usa el programa de DriveApp, Utilities, CacheService, PropertiesService, LockService,
// ContentService y Session. Lo usan tests/core.test.cjs y la prueba de la app en el navegador.
function makeDrive() {
  let n = 0;
  const items = new Map();
  const mk = (kind, name, parent) => {
    const o = { id: (kind === 'folder' ? 'D' : 'F') + String(++n).padStart(4, '0'), kind, name, parents: parent ? [parent] : [], trashed: false, desc: '', bytes: null, type: null, gone: false };
    items.set(o.id, o); return o;
  };
  const root = mk('folder', 'Mi unidad', null);
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => wrap(arr[i++]) }; };
  const kids = (o, kind) => [...items.values()].filter(x => !x.gone && x.kind === kind && x.parents.includes(o.id));
  const common = o => ({
    getId: () => o.id, getName: () => o.name, setName: v => { o.name = String(v); }, isTrashed: () => o.trashed, setTrashed: v => { o.trashed = !!v; },
    getDescription: () => o.desc, setDescription: v => { o.desc = String(v); }, getParents: () => iter(o.parents.map(id => items.get(id))),
    getUrl: () => 'https://drive.google.com/' + (o.kind === 'folder' ? 'drive/folders/' : 'file/d/') + o.id
  });
  const wrap = o => o.kind === 'folder' ? Object.assign(common(o), {
    getFoldersByName: nm => iter(kids(o, 'folder').filter(x => x.name === nm)), getFilesByName: nm => iter(kids(o, 'file').filter(x => x.name === nm)),
    getFiles: () => iter(kids(o, 'file')), getFolders: () => iter(kids(o, 'folder')),
    createFolder: nm => wrap(mk('folder', String(nm), o.id)),
    createFile: blob => { const f = mk('file', blob.name, o.id); f.bytes = blob.bytes; f.type = blob.type; return wrap(f); }
  }) : Object.assign(common(o), { moveTo: dest => { o.parents = [dest.getId()]; return wrap(o); } });
  const get = (id, kind) => { const o = items.get(String(id)); if (!o || o.gone || o.kind !== kind) throw new Error('No item with the given ID could be found.'); return wrap(o); };
  const cache = new Map(), props = new Map();
  const env = {
    DriveApp: { getRootFolder: () => wrap(root), getFileById: id => get(id, 'file'), getFolderById: id => get(id, 'folder') },
    Utilities: { base64Decode: s => Array.from(Buffer.from(String(s), 'base64')), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => { cache.set(k, v); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k, v) => { props.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'cuenta@example.com' }) }
  };
  // Árbol legible: rutas de archivos (y carpetas) que no están en la papelera
  const pathOf = o => { const out = []; let c = o; while (c && c !== root) { out.unshift(c.name); c = items.get(c.parents[0]); } return out.join('/'); };
  const inTrash = o => { let c = o; while (c && c !== root) { if (c.trashed) return true; c = items.get(c.parents[0]); } return false; };
  return {
    env, items, root, pathOf, inTrash, cache,
    files: () => [...items.values()].filter(x => x.kind === 'file' && !x.gone && !inTrash(x)).map(pathOf).sort(),
    trashedFiles: () => [...items.values()].filter(x => x.kind === 'file' && !x.gone && inTrash(x)).map(pathOf).sort(),
    folders: () => [...items.values()].filter(x => x.kind === 'folder' && x !== root && !inTrash(x)).map(pathOf).sort(),
    byId: id => items.get(id),
    // Archivo o carpeta creada por la persona (no por WalletWeb)
    userFile: (parent, name) => mk('file', name, parent.id),
    userFolder: (parent, name) => mk('folder', name, parent.id)
  };
}
// Carga el programa (texto de driveScript) con el Drive simulado y devuelve una función post(cuerpo) → respuesta
function loadScript(code, drive) {
  const names = Object.keys(drive.env);
  const api = new Function(...names, code + '\nreturn { doPost: doPost, doGet: doGet };')(...names.map(k => drive.env[k]));
  return {
    api,
    post: body => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text)
  };
}
module.exports = { makeDrive, loadScript };
