"""IoU del recorte (solo detección): python3 eval_detect.py prefijo [carpeta]"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
pre = sys.argv[1]; d = sys.argv[2] if len(sys.argv) > 2 else 'out_det'
rows = []
for f in sorted(os.listdir(os.path.join(HERE, d))):
    if not (f.startswith(pre) and f.endswith('.json')): continue
    name = f[:-5]; gtp = os.path.join(HERE, 'gt', name + '.png')
    if not os.path.exists(gtp): continue
    r = json.load(open(os.path.join(HERE, d, f))); gt = np.array(Image.open(gtp)) > 127; h, w = gt.shape
    m = Image.new('L', (w, h), 0)
    if r.get('quad'): ImageDraw.Draw(m).polygon([(p[0] * w / r['srcW'], p[1] * h / r['srcH']) for p in r['quad']], fill=255)
    dm = np.array(m) > 127; io = (dm & gt).sum() / max(1, (dm | gt).sum())
    meta = json.load(open(os.path.join(HERE, 'gt', name + '.json')))
    rows.append((name, meta.get('kind', 'store'), meta['bg'], io, r.get('view'), r.get('ms')))
for x in rows:
    if x[3] < 0.85: print(f'{x[0]} {x[1]:8} {x[2]:11} IoU {x[3]:.2f} {x[4]}')
ious = np.array([x[3] for x in rows])
print(f'{pre}: {len(rows)} fotos  IoU≥0.85 {100*np.mean(ious>=0.85):.0f}%  IoU≥0.9 {100*np.mean(ious>=0.9):.0f}%  media {ious.mean():.3f}  ms {np.mean([x[5] for x in rows]):.0f}')
