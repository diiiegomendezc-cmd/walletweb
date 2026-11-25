"""Mide qué tan "escáner" quedó cada foto sintética y si los datos se leyeron bien.
Uso: python3 evaluate.py [prefijo]
Éxito = recorte correcto (IoU >= 0.85) + sin restos de fondo/dedos (basura <= 1.5 %) + texto legible
        (>= 85 % de las palabras y montos visibles) + total correcto (si el total quedó dentro de la foto).
"""
import json, os, re, sys, unicodedata
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))


def norm(s):
    s = unicodedata.normalize('NFD', s.upper())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def tokens(lines):
    out = []
    for l in lines:
        for t in re.findall(r'[A-Z]{3,}|\d[\d.,]*\d', norm(l)):
            out.append(t)
    return out


def digits(t): return re.sub(r'\D', '', t)


def junk_ratio(png):
    g = np.array(Image.open(png).convert('L'), np.float32)
    h, w = g.shape
    dark = g < 140
    lab, n = ndimage.label(dark)
    if n == 0: return 0.0
    sl = ndimage.find_objects(lab)
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    junk = 0
    lim = (0.06 * w) ** 2
    for i, s in enumerate(sl):
        bh, bw = s[0].stop - s[0].start, s[1].stop - s[1].start
        fill = sizes[i] / max(1, bh * bw)
        # manchas grandes y rellenas (no letras ni líneas finas)
        if bh * bw > lim and fill > 0.25 and min(bh, bw) > 0.03 * w: junk += sizes[i]
    return junk / (h * w)


def iou(quad, gt_png):
    gt = np.array(Image.open(gt_png)) > 127
    h, w = gt.shape
    m = Image.new('L', (w, h), 0)
    if quad: ImageDraw.Draw(m).polygon([tuple(p) for p in quad], fill=255)
    d = np.array(m) > 127
    inter = (d & gt).sum(); uni = (d | gt).sum()
    return inter / max(1, uni)


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else 'syn_'
    rows = []
    for f in sorted(os.listdir(os.path.join(HERE, 'out'))):
        if not (f.startswith(prefix) and f.endswith('.json')): continue
        name = f[:-5]
        gtj = os.path.join(HERE, 'gt', name + '.json')
        if not os.path.exists(gtj): continue
        meta = json.load(open(gtj)); r = json.load(open(os.path.join(HERE, 'out', f)))
        # el recorte detectado está en píxeles de la imagen cargada (puede estar escalada)
        sx = 1512 / r['srcW']; sy = 2016 / r['srcH']
        quad = [[p[0] * sx, p[1] * sy] for p in r['quad']] if r.get('quad') else None
        io = iou(quad, os.path.join(HERE, 'gt', name + '.png'))
        jr = junk_ratio(os.path.join(HERE, 'out', name + '.png'))
        vis_lines = [l for l, v in zip(meta['lines'], meta['visible']) if v]
        gt_tok = tokens(vis_lines)
        ocr = norm(r.get('text', ''))
        ocr_tok = set(re.findall(r'[A-Z]{3,}|\d[\d.,]*\d', ocr)); ocr_dig = set(digits(t) for t in ocr_tok)
        found = sum(1 for t in gt_tok if (t in ocr_tok) or (t[0].isdigit() and digits(t) in ocr_dig))
        recall = found / max(1, len(gt_tok))
        F = meta['fields']; P = r.get(os.environ.get('VAR', 'parsed')) or {}
        if 'total_line' in meta:  # fotos de gen_mix.py: la línea del total y la del IVA vienen marcadas
            total_line_vis = meta['visible'][meta['total_line']]
            tax_line_vis = meta['tax_line'] is not None and meta['visible'][meta['tax_line']]
        else:
            total_line_vis = any(v and 'TOTAL :' in l for l, v in zip(meta['lines'], meta['visible']))
            tax_line_vis = any(v and l.startswith('Iva 19%') for l, v in zip(meta['lines'], meta['visible']))
        tot_ok = (P.get('total') == F['total']) if total_line_vis else None
        tax_ok = (P.get('tax') == F['tax']) if tax_line_vis else None
        date_ok = P.get('date') == F['date']
        merch = norm(P.get('merchant') or '').replace(' ', '')
        merch_ok = bool(merch) and norm(F['merchant']).replace(' ', '') in merch
        gi = sorted(i['amount'] for i in F['items']); pi = [i['amount'] for i in P.get('items', [])]
        items_ok = sum(1 for a in gi if a in pi) / max(1, len(gi))
        items_extra = max(0, len(pi) - len(gi))
        ok = io >= 0.85 and jr <= 0.015 and recall >= 0.85 and (tot_ok is not False)
        rows.append(dict(name=name, kind=meta.get('kind', 'store'), bg=meta['bg'], hand=meta['hand'], iou=io, junk=jr, recall=recall, tot=tot_ok, tax=tax_ok, date=date_ok, merch=merch_ok, items=items_ok, extra=items_extra, ok=ok, conf=r.get('conf'), ms=r.get('msDetect', 0) + r.get('msProcess', 0)))
    if not rows: print('sin resultados'); return
    fmt = lambda b: '—' if b is None else ('sí' if b else 'NO')
    print(f"{'foto':9} {'fondo':11} {'IoU':>5} {'basura':>6} {'texto':>6} {'total':>5} {'iva':>4} {'fecha':>5} {'tienda':>6} {'ítems':>6} {'ms':>5}  ok")
    for x in rows:
        print(f"{x['name']:9} {x['bg']:11} {x['iou']:5.2f} {x['junk']*100:5.1f}% {x['recall']*100:5.0f}% {fmt(x['tot']):>5} {fmt(x['tax']):>4} {fmt(x['date']):>5} {fmt(x['merch']):>6} {x['items']*100:5.0f}% {x['ms']:5d}  {'✔' if x['ok'] else '✘'}")
    n = len(rows)
    def pct(k, cond=lambda v: v): vals = [x[k] for x in rows if x[k] is not None]; return 100 * sum(1 for v in vals if cond(v)) / max(1, len(vals))
    print(f"\nRESUMEN ({n} fotos): ÉXITO {100*sum(x['ok'] for x in rows)/n:.0f}%  |  recorte IoU≥0.85 {pct('iou', lambda v: v >= 0.85):.0f}%  |  sin basura {pct('junk', lambda v: v <= 0.015):.0f}%  |  texto≥85% {pct('recall', lambda v: v >= 0.85):.0f}%")
    print(f"auto-llenado: total {pct('tot'):.0f}%  iva {pct('tax'):.0f}%  fecha {pct('date'):.0f}%  tienda {pct('merch'):.0f}%  ítems(prom) {100*np.mean([x['items'] for x in rows]):.0f}%  ítems sobrantes(prom) {np.mean([x['extra'] for x in rows]):.1f}")
    full = [x for x in rows if x['tot'] is not None]
    print(f"datos completos (total + fecha + tienda correctos, con el total a la vista): {100*np.mean([bool(x['tot'] and x['date'] and x['merch']) for x in full]) if full else 0:.0f}%  ({len(full)} fotos)")
    print(f"tiempo medio detección+limpieza {np.mean([x['ms'] for x in rows]):.0f} ms")
    kinds = sorted(set(x['kind'] for x in rows))
    if len(kinds) > 1:
        for k in kinds:
            rs = [x for x in rows if x['kind'] == k]
            tv = [x['tot'] for x in rs if x['tot'] is not None]
            print(f"  {k:8} {len(rs):3d} fotos  éxito {100*sum(x['ok'] for x in rs)/len(rs):3.0f}%  recorte {100*np.mean([x['iou']>=0.85 for x in rs]):3.0f}%  limpio {100*np.mean([x['junk']<=0.015 for x in rs]):3.0f}%  texto {100*np.mean([x['recall']>=0.85 for x in rs]):3.0f}%  total {100*np.mean(tv) if tv else 0:3.0f}%  fecha {100*np.mean([x['date'] for x in rs]):3.0f}%  tienda {100*np.mean([x['merch'] for x in rs]):3.0f}%")


if __name__ == '__main__':
    main()
