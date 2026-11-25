"""Fotos sintéticas "difíciles", como las fotos reales que fallaban (v1.35):
- tirilla de parqueadero arrugada (papel térmico con decenas de pliegues, texto tenue, montos con ,00)
- comprobante con logo grande y total enorme entre asteriscos (**** $ 389.000 ****), pago con nota crédito y cambio
- factura de almacén (la de siempre, gen.py)
con fondos de mueble blanco, piso de madera clara y tela negra, mano debajo del papel o dedos encima,
otra hoja grapada detrás y tirillas que se salen de la foto. Todos los datos son inventados.
Uso: python3 gen_mix.py N [semilla] [prefijo]  -> imgs/<prefijo>###.jpg, gt/<prefijo>###.png, gt/<prefijo>###.json
"""
import json, math, os, random, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.spatial import cKDTree
import gen  # reutiliza la factura de almacén, el fondo y la mano

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = gen.W, gen.H
THIN = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
        '/usr/share/fonts/truetype/freefont/FreeMono.ttf', '/usr/share/texmf/fonts/opentype/public/lm/lmmonolt10-regular.otf']
BOLDISH = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
           '/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf', '/usr/share/texmf/fonts/opentype/public/lm/lmmonolt10-bold.otf']
SERIF = ['/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
         '/usr/share/fonts/truetype/freefont/FreeSerif.ttf']
MALLS = ['LAS PALMAS', 'EL ROBLE', 'SAN MARCOS', 'LOS ALPES', 'LA COLINA', 'EL PORVENIR', 'SANTA ANA', 'LOS CEDROS', 'PUERTA REAL', 'LAS AMERICAS']
BRANDS = ['MONTERO', 'ALDANA', 'BRAVO', 'SALAZAR', 'NAVARRO', 'GALEANO', 'ROSALES', 'QUINTERO', 'ARANGO', 'TOBON']
FAKE = ['LOPEZ RIOS ANDREA', 'GARCIA MORA PABLO', 'RAMIREZ SOTO LAURA', 'CASTRO VEGA JULIAN', 'MORALES DIAZ CAMILA', 'HERRERA PAEZ SANTIAGO']


def pesos(v):  # 126.05 -> "126,05"; 1500 -> "1.500,00"
    c = int(round(v * 100)); ent, dec = divmod(c, 100)
    return f'{ent:,}'.replace(',', '.') + f',{dec:02d}'


def js_round(x): return int(math.floor(x + 0.5))


def nit(rng): return f'{rng.randint(800, 901)}.{rng.randint(0, 999):03d}.{rng.randint(0, 999):03d}-{rng.randint(0, 9)}'


def content_parking(rng):
    mall = rng.choice(MALLS)
    y, mo, d = 2026, rng.randint(1, 12), rng.randint(1, 28)
    h1, m1 = rng.randint(7, 20), rng.randint(0, 59)
    minutes = rng.choice([1, 2, 5, 12, 25, 38, 47, 60, 75, 95, 128, 180, 240])
    rate = rng.choice([110, 120, 130, 150])
    total = int(math.ceil(minutes * rate / 50.0) * 50)
    base = round(total / 1.19, 2); iva = round(total - base, 2)
    h2 = (h1 * 60 + m1 + minutes) // 60 % 24; m2 = (m1 + minutes) % 60
    date = f'{y}-{mo:02d}-{d:02d}'
    paid = total if rng.random() < 0.3 else int(math.ceil(total / 1000.0) * 1000) + rng.choice([0, 0, 500, 1000, 9000])
    if paid < total: paid = total
    S = lambda: ('L', '- ' * 18, 'sep')
    comp = f'EDIFICIO CENTRO COMERCIAL {mall} P.H.'
    L = [('C', 'Security Access', 'small'), ('C', '', 'qr'),
         ('C', comp, '') if len(comp) <= 40 else ('C', f'EDIFICIO CENTRO COMERCIAL', ''),
         ]
    if len(comp) > 40: L.append(('C', f'{mall} P.H.', ''))
    L += [('C', 'Entidad sin animo de Lucro', ''), ('C', f'NIT: {nit(rng)}', ''), ('C', f'KR. {rng.randint(10, 99)}- {rng.randint(10, 99)}-{rng.randint(10, 99)}', ''),
          ('C', f'Tel: 601-{rng.randint(2000000, 7999999)}', ''), S(),
          ('L', f'Documento equivalente No.PQA  {rng.randint(10000, 99999)}', ''),
          ('L', f'Fecha            :     {date}', ''), ('L', 'Punto fact.      :     001', ''), S(),
          ('L', 'Concepto    : PARQUEO - Normal', ''), ('L', f'Placa/Codigo :      {rng.randint(10 ** 7, 10 ** 8 - 1)}', ''),
          ('L', f'Entrada     :  {date} {h1:02d}:{m1:02d}', ''), ('L', f'Salida      :  {date} {h2:02d}:{m2:02d}', ''),
          ('L', f'Tiempo      :            {minutes // 60:02d}:{minutes % 60:02d}', ''), ('L', f'{minutes} minuto(s)', ''),
          ('L', f'Tarifa      :            {rng.choice(["CARRO", "MOTO"])}', ''), ('L', f'Valor por MINUTO         ${rate}', ''), S(),
          ('L', 'Placa :', ''), ('L', 'Nombre    : CONSUMIDOR FINAL', ''), ('L', 'Documento : 222222222222', ''), S(),
          ('L', 'Cnt Cod.  Descripcion       Subtotal', ''), S(),
          ('L', f'1  [PARQ] Parqueadero    $ {pesos(base)}', ''), S(),
          ('L', f'Subtotal:               $ {pesos(base)}', ''), ('R', '=' * 16, 'sep')]
    ti = len(L); L.append(('L', f'TOTAL A PAGAR  ===>     $ {pesos(total)}', ''))
    L += [S(), ('C', 'DESGLOSE DE SERVICIO', ''), S(), ('L', f'Base Servicio:          $ {pesos(base)}', '')]
    xi = len(L); L.append(('L', f'Impu: 19.00% IVA         $ {pesos(iva)}', ''))
    L += [S(), ('L', 'Forma de pago:            Efectivo', ''), ('L', f'Recibido:             $ {pesos(paid)}', ''),
          ('L', f'Cambio :              $ {pesos(paid - total)}', ''), ('L', '', ''),
          ('L', 'El Valor final se aproxima al siguiente', ''), ('L', 'multiplo de 50 pesos segun decreto', ''),
          ('L', '217/2017 de la Alcaldia Mayor de Bogota', ''), ('C', 'Seguro de areas comunes Aseguradora', ''),
          ('C', 'Solidaria de Colombia', ''), ('C', f'NIT {nit(rng)}', ''), ('C', f'TELEFONO: # {rng.randint(100, 999)}', ''),
          ('L', f'Poliza No. {rng.randint(100, 999)}-{rng.randint(10, 99)}-{rng.randint(10 ** 10, 10 ** 11 - 1)}', ''), ('L', f'RESOLUCION DIAN NO.{rng.randint(10 ** 13, 10 ** 14 - 1)}', ''),
          ('L', 'CON EL PREFIJO "PQA" AUTORIZADO', '')]
    fields = {'merchant': mall, 'total': total, 'tax': js_round(iva), 'subtotal': js_round(base), 'date': date,
              'items': [{'name': 'Parqueadero', 'qty': 1, 'amount': js_round(base)}]}
    return L, fields, {'total': ti, 'tax': xi}


def content_logo(rng):
    brand = rng.choice(BRANDS); kind = rng.choice(['CUEROS', 'CALZADO', 'MODA', 'ACCESORIOS'])
    d, mo, y = rng.randint(1, 28), rng.randint(1, 12), 26
    store = rng.randint(1000, 9999)
    n = rng.choice([1, 1, 2, 3])
    items = []
    for _ in range(n):
        amt = rng.choice([49900, 89900, 129900, 189500, 249900, 389000, 459900, 72450])
        items.append({'name': rng.choice(['PAGO EN TIENDA VTEX', 'BILLETERA CUERO', 'CORREA NEGRA', 'BOLSO MANO', 'TENIS BLANCO', 'MORRAL']), 'qty': 1, 'amount': amt})
    total = sum(i['amount'] for i in items)
    method = rng.choice(['Nota Credito', 'Tarjeta Debito', 'Efectivo', 'Nota Credito'])
    paid = total + rng.choice([25000, 60500, 112000, 5000]) if method != 'Tarjeta Debito' else total
    S = lambda: ('L', '-' * 40, 'sep')
    L = [('C', ' '.join(brand), 'logo'), ('C', f'{kind} {brand} S.A.S', ''), ('C', f'{store}-PV  CS CENTRO 1', ''),
         ('C', f'AV CL {rng.randint(10, 99)} # {rng.randint(10, 99)}-{rng.randint(10, 99)} CC PLAZA CENTRAL  LC {rng.randint(1000, 2999)}', 'small'),
         ('C', f'NIT: {rng.randint(800000000, 900999999)}-{rng.randint(0, 9)}', ''), ('C', 'SEDE PRINCIPAL MEDELLIN', ''),
         ('C', f'Cll {rng.randint(10, 99)} # {rng.randint(10, 99)} - {rng.randint(10, 199)}', ''), ('C', 'RESPONSABLE DE IVA', ''),
         ('R', 'v 1.4', ''), ('L', '', ''),
         ('L', 'Ticket  Fecha    Hora  Tienda  Caja', ''),
         ('L', f'{rng.randint(100000, 999999)}  {d:02d}/{mo:02d}/{y:02d} {rng.randint(6, 21):02d}:{rng.randint(0, 59):02d} {store}  {store}{rng.randint(1, 9):02d}', ''),
         ('L', '', ''), ('L', 'COMPROBANTE DE PAGO:', ''), ('L', 'Vendedor :', ''),
         ('L', f'Cajero :  {rng.choice(FAKE)}', ''), ('L', f'Cliente : {rng.choice(FAKE)}', ''),
         ('L', f'Documento {rng.randint(10 ** 9, 10 ** 10 - 1)}', ''), S(),
         ('L', 'Ctd Ref      Descripcion      Importe IV', ''), S()]
    for it in items:
        L.append(('L', f'1   {it["name"][:24]:<24} {it["amount"]:>9,}'.replace(',', '.'), ''))
    L.append(S())
    ti = len(L); L.append(('C', f'**** $ {total:,} ****'.replace(',', '.'), 'huge'))
    L += [S(), ('C', 'Pago', 'big'), S(), ('L', 'Medio de pago   Valor    Num./Apro Fecha', '')]
    L.append(('L', f'{method:<15} {paid:,}    {d:02d}/{mo:02d}/20{y}'.replace(',', '.'), ''))
    if paid > total: L.append(('L', f'Cambio en {method} ${paid - total:,}'.replace(',', '.'), ''))
    L += [('L', '', ''), ('L', 'Forma de pago : Contado', '')]
    fields = {'merchant': brand, 'total': total, 'tax': None, 'subtotal': None, 'date': f'20{y}-{mo:02d}-{d:02d}', 'items': items}
    return L, fields, {'total': ti, 'tax': None}


def content_store(rng):
    lines, fields = gen.make_content(rng)
    L = [(a, t, s) for a, t, s in lines]
    ti = next(i for i, l in enumerate(L) if 'TOTAL :' in l[1]); xi = next(i for i, l in enumerate(L) if l[1].startswith('Iva 19%'))
    return L, fields, {'total': ti, 'tax': xi}


def qr_image(rng, size):
    n = 25; m = np.array([[rng.random() < 0.5 for _ in range(n)] for _ in range(n)])
    for (r0, c0) in [(0, 0), (0, n - 7), (n - 7, 0)]:
        m[r0:r0 + 7, c0:c0 + 7] = 0; m[r0:r0 + 7, c0] = m[r0:r0 + 7, c0 + 6] = 1; m[r0, c0:c0 + 7] = m[r0 + 6, c0:c0 + 7] = 1; m[r0 + 2:r0 + 5, c0 + 2:c0 + 5] = 1
    im = Image.fromarray((m * 255).astype(np.uint8)).resize((size, size), Image.NEAREST)
    return im


def render(rng, lines, kind):
    thin = kind == 'parking' or rng.random() < 0.3
    font_path = rng.choice(THIN if thin else BOLDISH + THIN[:2])
    fs = rng.randint(26, 32)
    F = lambda k, p=None: ImageFont.truetype(p or font_path, max(8, int(fs * k)))
    font, small, big, huge = F(1), F(0.82), F(1.25), F(1.75, rng.choice(BOLDISH))
    logo = F(2.4, rng.choice(SERIF))
    lh = int(fs * rng.uniform(1.12, 1.3))
    pw = 780
    hts = {'qr': int(lh * 4.6), 'logo': int(lh * 2.6), 'huge': int(lh * 2.0), 'big': int(lh * 1.3)}
    top = rng.randint(40, 140)
    ph = top + sum(hts.get(s, lh) for _, _, s in lines) + rng.randint(50, 160)
    condense = rng.uniform(0.8, 0.95)
    base = np.array([rng.randint(232, 250), rng.randint(232, 250), rng.randint(234, 252)], np.float32)
    txt = Image.new('L', (int(pw / condense), ph), 0); td = ImageDraw.Draw(txt)
    fade = rng.random() < (0.55 if kind == 'parking' else 0.2)
    boxes = []; y = top
    for i, (al, t, sty) in enumerate(lines):
        hh = hts.get(sty, lh)
        if sty == 'qr':
            q = qr_image(rng, int(lh * 4)).resize((int(lh * 4 / condense), int(lh * 4)))
            txt.paste(q, (int((txt.width - q.width) / 2), y + int(lh * 0.3)))
        elif t:
            f = {'small': small, 'big': big, 'huge': huge, 'logo': logo}.get(sty, font)
            tw = td.textlength(t, font=f)
            x = 40 / condense if al == 'L' else (txt.width - tw) / 2 if al == 'C' else txt.width - tw - 40 / condense
            ink = 255 if not fade else int(255 * rng.uniform(0.5, 0.95))
            td.text((x, y + (hh - lh) * 0.3), t, fill=ink, font=f)
            if sty in ('bold', 'huge'): td.text((x + 1, y + (hh - lh) * 0.3), t, fill=ink, font=f)
            if sty == 'logo':  # rayita bajo el logo
                td.line([(txt.width / 2 - 60, y + hh - 8), (txt.width / 2 + 60, y + hh - 8)], fill=ink, width=4)
        boxes.append([y, y + hh]); y += hh
    txt = txt.resize((pw, ph), Image.LANCZOS)
    a = np.array(txt, np.float32) / 255.0
    if thin and rng.random() < 0.5:  # impresora térmica: trazo de puntos
        yy, xx = np.mgrid[0:ph, 0:pw]
        dots = (0.75 + 0.25 * np.cos(xx * 2 * np.pi / 3.2) * np.cos(yy * 2 * np.pi / 3.2))
        a = a * dots
    inkc = np.array([rng.randint(15, 60)] * 3, np.float32)
    p = np.ones((ph, pw, 3), np.float32) * base
    p = p * (1 - a[..., None]) + inkc * a[..., None]
    p += np.random.default_rng(rng.randint(0, 10 ** 9)).normal(0, 2.0, p.shape)
    return Image.fromarray(p.clip(0, 255).astype(np.uint8)), boxes, lh


def crumple(img, rng, strength):
    """Papel arrugado: muchas facetas pequeñas (cada una es un plano inclinado con su propia luz), pliegues finos
    irregulares (oscuros y con brillo a un lado), en dos escalas, y el texto ondulado por la deformación."""
    a = np.array(img, np.float32); h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    def field(gw, gh, amp):
        f = np.array([[rng.gauss(0, 1) for _ in range(gw)] for _ in range(gh)], np.float32)
        return cv2.resize(f, (w, h), interpolation=cv2.INTER_CUBIC) * amp
    # 1) el texto se ondula (el papel no queda plano): grande y suave + fino
    amp = rng.uniform(2.0, 5.0) * strength
    mx = xx + field(6, 16, amp) + field(14, 40, amp * 0.35)
    my = yy + field(6, 16, amp) + field(14, 40, amp * 0.45)
    a = cv2.remap(a, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    shade = np.ones((h, w), np.float32)
    pts = np.column_stack([xx.ravel(), yy.ravel()])
    wig = field(20, 60, 1.6)  # los pliegues no son rectas perfectas
    for scale, count, dk0 in [(1.0, rng.uniform(30, 70), 0.30), (0.45, rng.uniform(60, 140), 0.16)]:
        n = int(count * strength * (h * w) / (780 * 1500)) + 6
        seeds = np.column_stack([np.array([rng.uniform(-40, w + 40) for _ in range(n)]), np.array([rng.uniform(-40, h + 40) for _ in range(n)])])
        dist, idx = cKDTree(seeds).query(pts, k=2)
        i1, i2 = idx[:, 0], idx[:, 1]; s1, s2 = seeds[i1], seeds[i2]
        d1 = ((pts - s1) ** 2).sum(1); d2 = ((pts - s2) ** 2).sum(1)
        db = ((d2 - d1) / (2 * np.maximum(1e-3, np.sqrt(((s1 - s2) ** 2).sum(1))))).reshape(h, w) + wig * scale
        # cada faceta es un plano inclinado: luz con pendiente propia
        c0 = np.array([rng.gauss(0, 0.06 * strength * scale) for _ in range(n)], np.float32)
        gxv = np.array([rng.gauss(0, 0.0012 * strength) for _ in range(n)], np.float32); gyv = np.array([rng.gauss(0, 0.0012 * strength) for _ in range(n)], np.float32)
        I1 = i1.reshape(h, w)
        fac = 1 + c0[I1] + gxv[I1] * (xx - seeds[I1, 0]) + gyv[I1] * (yy - seeds[I1, 1])
        fac = np.clip(fac, 0.78, 1.1)
        pair = ((np.minimum(i1, i2) * 7919 + np.maximum(i1, i2) * 104729) % 1000 / 1000.0).reshape(h, w)
        show = pair < 0.6 + 0.35 * strength
        dark = (dk0 * (0.4 + 0.8 * ((pair * 37.3) % 1.0))) * strength
        wid = 0.7 + 1.4 * ((pair * 91.7) % 1.0)
        along = 0.6 + 0.4 * np.sin(xx * 0.05 * (1 + pair) + yy * 0.03)  # el pliegue se marca más en unos tramos
        line = np.exp(-(db / wid) ** 2) * dark * show * along
        side = (i1 > i2).reshape(h, w)
        hi = np.exp(-((db - 2.0 * wid) / (1.5 * wid)) ** 2) * 0.08 * strength * show * side
        shade *= fac * (1 - line) * (1 + hi)
    for _ in range(rng.randint(0, 3)):  # dobleces largos que cruzan la hoja
        ang = rng.uniform(0, math.pi); cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        dd = (xx - cx) * math.sin(ang) - (yy - cy) * math.cos(ang) + wig
        k = rng.uniform(0.15, 0.4) * strength; wd2 = rng.uniform(1.0, 2.5)
        shade *= (1 - k * np.exp(-(dd / wd2) ** 2)) * np.where(dd > 0, 1 - k * 0.25, 1.0)
    out = a * shade[..., None]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def bg_home(rng):
    """Fondo de casa: mueble blanco con cajones, piso de madera clara y tela/silla negra."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.zeros((H, W, 3), np.float32)
    # piso de madera clara
    plank = rng.uniform(110, 200); c = np.array([rng.randint(185, 215), rng.randint(165, 190), rng.randint(130, 160)], np.float32)
    rot = rng.uniform(-0.5, 0.5)
    u = xx * math.cos(rot) + yy * math.sin(rot)
    grain = np.sin(u * 0.05 + np.sin(yy * 0.01) * 2) * 6 + ((u % plank) < 3) * -40
    img[:] = c + grain[..., None] * np.array([1, 0.9, 0.8])
    # mueble blanco (arriba a la izquierda)
    fx, fy = rng.uniform(0.35, 0.8) * W, rng.uniform(0.3, 0.75) * H
    furn = (xx < fx + (yy - fy) * rng.uniform(-0.3, 0.3)) & (yy < fy + (xx - fx) * rng.uniform(-0.2, 0.2))
    wc = np.array([rng.randint(185, 228) if rng.random() < 0.8 else rng.randint(225, 240)] * 3, np.float32) + np.array([0, 2, 5], np.float32)  # el mueble suele verse un poco más gris que el papel
    g = 1 - 0.15 * (xx / W) - 0.1 * (yy / H)
    white = wc * g[..., None]
    gap = rng.uniform(140, 260)
    white[((yy % gap) < 6)] *= 0.55
    for k in range(3):  # manijas negras
        hy = gap * (k + 0.5); hx = rng.uniform(0.15, 0.5) * W
        handle = (np.abs(yy - hy - 0.00015 * (xx - hx) ** 2) < 7) & (np.abs(xx - hx) < 140)
        white[handle] = 30
    img[furn] = white[furn]
    # tela o silla negra con textura (a la derecha)
    if rng.random() < 0.7:
        mx0 = rng.uniform(0.6, 0.85) * W
        mesh = xx > mx0 + (yy - H / 2) * rng.uniform(-0.25, 0.25)
        tri = (np.sin(xx * 0.09) + np.sin((xx * 0.5 + yy * 0.87) * 0.09) + np.sin((xx * 0.5 - yy * 0.87) * 0.09))
        img[mesh] = (np.array([28, 28, 32], np.float32) + (tri > 1.2)[..., None] * 35)[mesh]
    img += np.random.default_rng(rng.randint(0, 9 ** 9)).normal(0, 3, img.shape)
    return img.clip(0, 255), 'home'


def make(idx, seed, prefix):
    rng = random.Random(seed)
    kind = rng.choice(['parking', 'logo', 'store', 'parking', 'logo'])
    lines, fields, keys = {'parking': content_parking, 'logo': content_logo, 'store': content_store}[kind](rng)
    paper, boxes, lh = render(rng, lines, kind)
    pw, ph = paper.size
    strength = rng.uniform(0.5, 1.0) if (kind == 'parking' and rng.random() < 0.85) or rng.random() < 0.25 else 0.0
    if strength: paper = crumple(paper, rng, strength)
    cur = gen.curl(paper, rng); cw, chh = cur.size
    long_ = kind == 'parking'
    scale = rng.uniform(0.62, 0.92) * (H * rng.uniform(1.0, 1.5 if long_ else 1.2)) / ph
    if kind == 'logo': scale = rng.uniform(0.5, 0.8) * H / ph
    w_s, h_s = cw * scale, chh * scale
    cx = W * rng.uniform(0.38, 0.6); top = H * rng.uniform(0.05, 0.22)
    cy = top + h_s / 2
    th = math.radians(rng.uniform(-24, 24) if rng.random() < 0.3 else rng.uniform(-9, 9))
    corners = [(-w_s / 2, -h_s / 2), (w_s / 2, -h_s / 2), (w_s / 2, h_s / 2), (-w_s / 2, h_s / 2)]
    jit = [(rng.uniform(-0.04, 0.04) * w_s, rng.uniform(-0.02, 0.02) * h_s) for _ in range(4)]
    dst = [(cx + (x + j[0]) * math.cos(th) - (y + j[1]) * math.sin(th), cy + (x + j[0]) * math.sin(th) + (y + j[1]) * math.cos(th)) for (x, y), j in zip(corners, jit)]
    co = gen.persp_coeffs(dst, [(0, 0), (cw, 0), (cw, chh), (0, chh)])
    layer = cur.transform((W, H), Image.PERSPECTIVE, co, Image.BICUBIC)
    la = np.array(layer, np.float32); pa = la[..., 3:4] / 255.0
    bgk = rng.random()
    bg, bkind = bg_home(rng) if bgk < 0.55 else gen.background(rng)
    # otra hoja grapada detrás, asomándose
    if rng.random() < (0.35 if kind == 'logo' else 0.12):
        ox, oy = rng.uniform(-40, 40), rng.uniform(20, 120)
        d2 = [(x + ox, y + oy) for x, y in dst]
        sheet = Image.new('RGBA', (cw, chh), (rng.randint(228, 245),) * 3 + (255,))
        co2 = gen.persp_coeffs(d2, [(0, 0), (cw, 0), (cw, chh), (0, chh)])
        s2 = np.array(sheet.transform((W, H), Image.PERSPECTIVE, co2, Image.BICUBIC), np.float32)
        a2 = s2[..., 3:4] / 255.0
        bg = bg * (1 - a2) + s2[..., :3] * a2 * 0.97
    hand = rng.random() < 0.85
    under = hand and rng.random() < 0.5
    if hand:
        col, a_front, a_palm = gen.draw_hand(rng, dst, None)
        behind = np.maximum(a_palm, a_front) if under else a_palm
        bg = bg * (1 - behind[..., None]) + col * behind[..., None]
    img = bg * (1 - pa) + la[..., :3] * pa
    sh = Image.fromarray((pa[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
    sha = np.array(sh, np.float32)[..., None] / 255.0 * (1 - pa) * rng.uniform(0.1, 0.35)
    img = img * (1 - sha)
    gt_paper = pa[..., 0] > 0.5
    if hand and not under:
        img = img * (1 - a_front[..., None]) + col * a_front[..., None]
        gt_paper = gt_paper & (a_front < 0.5)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ang = rng.uniform(0, 2 * math.pi)
    g = 1 + rng.uniform(0.05, 0.3) * (((xx - W / 2) * math.cos(ang) + (yy - H / 2) * math.sin(ang)) / (W / 2))
    img = img * g[..., None]
    if rng.random() < 0.45:
        sm = Image.new('L', (W, H), 0); sd = ImageDraw.Draw(sm)
        x0, y0 = rng.randint(0, W), rng.randint(0, H // 2)
        sd.polygon([(x0, y0), (x0 + rng.randint(300, 900), y0 + rng.randint(-200, 200)), (x0 + rng.randint(200, 900), y0 + rng.randint(500, 1200)), (x0 - rng.randint(0, 300), y0 + rng.randint(400, 1000))], fill=255)
        s = np.array(sm.filter(ImageFilter.GaussianBlur(rng.randint(30, 90))), np.float32) / 255.0 * rng.uniform(0.15, 0.45)
        img = img * (1 - s[..., None])
    tint = rng.uniform(-0.07, 0.07) if rng.random() < 0.8 else rng.uniform(0.08, 0.16)  # a veces luz cálida
    img = img * np.array([1 + tint, 1, 1 - tint])
    img += np.random.default_rng(seed).normal(0, rng.uniform(2, 5), img.shape)
    out = Image.fromarray(img.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    os.makedirs(os.path.join(HERE, 'imgs'), exist_ok=True); os.makedirs(os.path.join(HERE, 'gt'), exist_ok=True)
    name = f'{prefix}{idx:03d}'
    out.save(os.path.join(HERE, 'imgs', name + '.jpg'), quality=rng.randint(72, 92))
    Image.fromarray((gt_paper * 255).astype(np.uint8)).save(os.path.join(HERE, 'gt', name + '.png'))
    pad = (cw - pw) / 2
    vis = []
    for (y0, y1), (al, t, sty) in zip(boxes, lines):
        v = ((y0 + y1) / 2 + pad) / chh
        tl, tr, br, bl = dst
        py = (tl[1] + tr[1]) / 2 + ((bl[1] + br[1]) / 2 - (tl[1] + tr[1]) / 2) * v
        vis.append(bool(t.strip()) and sty not in ('qr', 'sep') and py < H - lh * scale * 0.8 and py > lh * scale * 0.5)
    meta = {'name': name, 'seed': seed, 'kind': kind, 'bg': bkind, 'hand': hand, 'under': under, 'crumple': round(strength, 2),
            'lines': [l[1] for l in lines], 'styles': [l[2] for l in lines], 'visible': vis, 'fields': fields,
            'total_line': keys['total'], 'tax_line': keys['tax'], 'quad': [list(map(float, p)) for p in dst], 'cut_bottom': bool(max(p[1] for p in dst) > H)}
    json.dump(meta, open(os.path.join(HERE, 'gt', name + '.json'), 'w'), ensure_ascii=False)
    return meta


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    seed0 = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    prefix = sys.argv[3] if len(sys.argv) > 3 else 'mix_'
    for i in range(n):
        m = make(i, seed0 + i, prefix)
        print(m['name'], m['kind'], m['bg'], 'mano' + ('-debajo' if m['under'] else '') if m['hand'] else '', 'arrugada' if m['crumple'] else '', 'cortada' if m['cut_bottom'] else '')
