"""Generador de fotos sintéticas de tirillas sostenidas en la mano (como las de un almacén de ropa).
Uso: python3 gen.py N [semilla]  -> imgs/syn_###.jpg, gt/syn_###.png (máscara del papel), gt/syn_###.json
"""
import json, math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf',
         '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
         '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf']
W, H = 1512, 2016

STORES = [
    ('PERMODA LTDA.', 'KOAJ', '860.516.806 - 5'), ('ALMACENES EXITO S.A.', 'EXITO', '890.900.608 - 9'),
    ('TIENDAS D1 S.A.S.', 'D1', '900.276.962 - 1'), ('FALABELLA DE COLOMBIA S.A.', 'FALABELLA', '900.017.447 - 8'),
    ('ARTURO CALLE S.A.S.', 'ARTURO CALLE', '860.002.536 - 5'), ('FARMATODO COLOMBIA S.A.', 'FARMATODO', '900.140.502 - 7'),
    ('CREPES & WAFFLES S.A.', 'CREPES & WAFFLES', '860.076.820 - 1'), ('OLIMPICA S.A.', 'OLIMPICA', '890.107.487 - 3'),
    ('STUDIO F COLOMBIA S.A.S.', 'STUDIO F', '900.053.290 - 0'), ('DROGUERIAS CRUZ VERDE S.A.S.', 'CRUZ VERDE', '800.149.695 - 1')]
PRODUCTS = ['SHORT KOAJ MAUS', 'MEDIAS KOAJ TOBILLERA', 'CAMISETA BASICA', 'JEAN SLIM AZUL', 'BOLSA PAPEL', 'ARROZ DIANA 1KG',
            'LECHE ALQUERIA 1L', 'PAN TAJADO BIMBO', 'HUEVOS AA X30', 'QUESO CAMPESINO', 'CAFE SELLO ROJO', 'ACETAMINOFEN 500MG',
            'CREMA DENTAL COLGATE', 'GASEOSA POSTOBON 1.5L', 'CHOCOLATINA JET', 'BUSO CAPOTA GRIS', 'GORRA NEGRA', 'PANTALON DRIL',
            'JABON REY X3', 'ATUN VAN CAMPS', 'ACEITE GIRASOL 1L', 'CERVEZA CLUB COLOMBIA', 'BLUSA FLORES', 'CORREA CUERO']
CITIES = ['Cundinamarca', 'Bogota D.C.', 'Medellin', 'Cali', 'Barranquilla', 'Bucaramanga']
NAMES = ['LUISA FERNANDEZ', 'JUAN PEREZ', 'MARIA GOMEZ', 'CARLOS RUIZ', 'ANA TORRES', 'CONSUMIDOR FINAL']


def money(v, sep='.'):
    return f'{v:,}'.replace(',', sep)


def make_content(rng):
    company, brand, nit = rng.choice(STORES)
    sep = '.' if rng.random() < 0.85 else ','
    n_items = rng.randint(2, 6)
    style = rng.choice(['two', 'two', 'one', 'one', 'qty'])
    items, lines = [], []
    d, m, y = rng.randint(1, 28), rng.randint(1, 12), rng.choice([25, 26])
    hh, mm, ss = rng.randint(8, 21), rng.randint(0, 59), rng.randint(0, 59)
    lines.append(('C', company, 'big'))
    lines.append(('C', f'NIT: {nit}', ''))
    if rng.random() < 0.7: lines.append(('L', f'TIENDA {brand} CALLE {rng.randint(10, 99)} CENTRO', ''))
    lines.append(('L', brand, ''))
    lines.append(('L', f'Calle {rng.randint(1, 120)} # {rng.randint(1, 99)}B-{rng.randint(10, 99)} Piso {rng.randint(1, 3)}', ''))
    lines.append(('L', '', ''))
    lines.append(('L', f'Ciudad: {rng.choice(CITIES)} Tel.:', ''))
    lines.append(('L', f'Caja: S{rng.randint(1, 30)}', ''))
    fac = f'S{rng.randint(1, 30)}E-{rng.randint(10000, 99999)}'
    lines.append(('L', f'1_FAC ELECTRONICA VENTA   {fac}', ''))
    lines.append(('L', f'Consecutivo:{fac}', ''))
    lines.append(('L', f'Vendedor. {rng.choice(NAMES)}', ''))
    lines.append(('L', f'Fecha: {d:02d}/{m:02d}/{y:02d}   Hora: {hh:02d}:{mm:02d}:{ss:02d}', ''))
    lines.append(('L', f'Cliente:{rng.choice(NAMES)}', ''))
    lines.append(('L', f'Nit:  {rng.randint(10000000, 99999999)}', ''))
    lines.append(('L', '=' * 42, 'sep'))
    if style == 'two':
        lines.append(('L', 'CODIGO           DESCRIPCION', ''))
        lines.append(('L', 'COLOR TALLA UM  CANT PRECIO DCTO TOTAL', ''))
    else:
        lines.append(('L', 'DESCRIPCION               CANT   VALOR', ''))
    lines.append(('L', '=' * 42, 'sep'))
    for _ in range(n_items):
        name = rng.choice(PRODUCTS)
        unit = rng.choice([700, 3950, 4740, 4900, 5200, 7800, 9400, 12300, 18900, 29940, 45900, 59900, 89900, 119900])
        qty = 1 if rng.random() < 0.8 else rng.randint(2, 3)
        amt = unit * qty
        items.append({'name': name, 'qty': qty, 'amount': amt})
        if style == 'two':
            code = str(rng.randint(10 ** 11, 10 ** 12 - 1))
            lines.append(('L', f'{code} {name} {rng.randint(10000, 29999)} {rng.randint(1, 12)}/{rng.randint(10, 30)}', ''))
            lines.append(('L', f'{rng.randint(100, 999):<6}{rng.choice(["08", "9-11", "S", "M", "32"]):>5}  94 {qty:>2}  {money(unit, sep):>7} {money(amt, sep):>7}', ''))
        elif style == 'one':
            lines.append(('L', f'{name:<26}{qty:>2} {money(amt, sep):>9}', ''))
        else:
            lines.append(('L', f'{qty} x {money(unit, sep)}', ''))
            lines.append(('L', f'  {name:<25}{money(amt, sep):>9}', ''))
    total = sum(i['amount'] for i in items)
    sub = round(total / 1.19)
    iva = total - sub
    lines.append(('L', '=' * 42, 'sep'))
    lines.append(('L', 'T.Unid.  VALOR   DTO.LIN    TOTAL', ''))
    lines.append(('L', f' {sum(i["qty"] for i in items)}    {money(total, sep)}     0     {money(total, sep)}', ''))
    lines.append(('C', '-------INFORMACION TRIBUTARIA-------', ''))
    sub_s, iva_s = (str(sub), str(iva)) if rng.random() < 0.5 else (money(sub, sep), money(iva, sep))
    lines.append(('L', f'Vta.Subtotal              {sub_s}', ''))
    lines.append(('L', f'Iva 19%                   {iva_s}', ''))
    lines.append(('L', 'Vta.Exenta  Iva 0%         0', ''))
    lines.append(('C', '----------PAGO CLIENTE----------', ''))
    lines.append(('R', f'TOTAL :    {money(total, sep)}', 'bold'))
    lines.append(('R', 'MEDIO DE PAGO', ''))
    pay = rng.choice(['TEF CRED', 'TEF DEB', 'EFECTIVO'])
    paid = total if pay != 'EFECTIVO' else int(math.ceil(total / 10000.0) * 10000)
    lines.append(('R', f'{pay}    {money(paid, sep)}', ''))
    lines.append(('R', f'CAMBIO    {money(paid - total, sep) if paid > total else "0"}', ''))
    lines.append(('C', 'F.PAGO CONTADO', ''))
    lines.append(('L', '', ''))
    for t in ['" La representacion grafica y XML de la', 'factura se envia correo electronico', 'informado durante la compra. "', '      RESPONSABLE DE IVA',
              'AUTORRETENEDORES DE RENTA RES.007241 DEL', '23 JUN 2011 Y DECRETO 2201 DE 2016 Y']:
        lines.append(('L', t, ''))
    fields = {'merchant': brand, 'company': company, 'total': total, 'tax': iva, 'subtotal': sub, 'date': f'20{y:02d}-{m:02d}-{d:02d}', 'items': items, 'nit': nit}
    return lines, fields


def render_paper(rng, lines):
    font_path = rng.choice(FONTS)
    fs = rng.randint(27, 33)
    font = ImageFont.truetype(font_path, fs)
    big = ImageFont.truetype(font_path, int(fs * 1.25))
    lh = int(fs * rng.uniform(1.18, 1.32))
    pw = 780
    top_blank = rng.randint(40, 160)
    ph = top_blank + lh * len(lines) + rng.randint(60, 200)
    condense = rng.uniform(0.78, 0.95)
    base = np.array([rng.randint(236, 250), rng.randint(236, 250), rng.randint(238, 252)], dtype=np.float32)
    paper = Image.new('RGB', (pw, ph), tuple(int(c) for c in base))
    # Texto del reverso que se transparenta (arriba)
    if rng.random() < 0.6:
        back = Image.new('L', (pw, top_blank + lh * 4), 0)
        bd = ImageDraw.Draw(back)
        for i in range(6):
            bd.text((40, 10 + i * int(lh * 0.8)), rng.choice(['Al hacer cambios conserve su factura original', 'Los productos deben estar sin uso', 'El plazo para cambios es de 30 dias', 'GARANTIA: presente este tiquete']), fill=255, font=ImageFont.truetype(font_path, int(fs * 0.7)))
        back = back.transpose(Image.FLIP_LEFT_RIGHT).filter(ImageFilter.GaussianBlur(1.2))
        a = np.array(back, dtype=np.float32) / 255.0 * rng.uniform(0.10, 0.22)
        p = np.array(paper, dtype=np.float32)
        p[:a.shape[0]] = p[:a.shape[0]] * (1 - a[..., None]) + 60 * a[..., None]
        paper = Image.fromarray(p.clip(0, 255).astype(np.uint8))
    # Texto (se dibuja ancho y se comprime en horizontal: letra angosta de impresora térmica)
    txt = Image.new('L', (int(pw / condense), ph), 0)
    td = ImageDraw.Draw(txt)
    line_boxes = []
    fade = rng.random() < 0.25
    y = top_blank
    for i, (al, t, sty) in enumerate(lines):
        f = big if sty == 'big' else font
        tw = td.textlength(t, font=f)
        x = 40 / condense if al == 'L' else (txt.width - tw) / 2 if al == 'C' else txt.width - tw - 40 / condense
        ink = 255 if not fade else int(255 * (0.55 + 0.45 * (1 - abs(math.sin(i * 0.4)))))
        td.text((x, y), t, fill=ink, font=f)
        if sty == 'bold': td.text((x + 1, y), t, fill=ink, font=f)
        line_boxes.append([y, y + lh])
        y += lh
    txt = txt.resize((pw, ph), Image.LANCZOS)
    a = np.array(txt, dtype=np.float32) / 255.0
    inkc = np.array([rng.randint(15, 45)] * 3, dtype=np.float32)
    p = np.array(paper, dtype=np.float32)
    p = p * (1 - a[..., None]) + inkc * a[..., None]
    p += np.random.default_rng(rng.randint(0, 10 ** 9)).normal(0, 2.0, p.shape)
    return Image.fromarray(p.clip(0, 255).astype(np.uint8)), line_boxes, lh


def curl(img, rng):
    """Curva suave del papel: bordes ondulados y abombado."""
    w, h = img.size
    ax = rng.uniform(0, 18); kx = rng.uniform(0.5, 1.6); px = rng.uniform(0, math.pi)
    ay = rng.uniform(0, 14)
    pad = int(ax + ay + 6)
    W2, H2 = w + 2 * pad, h + 2 * pad
    src = Image.new('RGBA', (W2, H2), (0, 0, 0, 0)); src.paste(img.convert('RGBA'), (pad, pad))
    def inv(x, y):  # destino -> origen
        v = (y - pad) / h; u = (x - pad) / w
        dx = ax * math.sin(math.pi * kx * v + px)
        dy = ay * math.sin(math.pi * u)
        return (x - dx, y - dy)
    nx, ny = 6, 30
    mesh = []
    for j in range(ny):
        for i in range(nx):
            x0, x1 = int(W2 * i / nx), int(W2 * (i + 1) / nx)
            y0, y1 = int(H2 * j / ny), int(H2 * (j + 1) / ny)
            q = inv(x0, y0) + inv(x0, y1) + inv(x1, y1) + inv(x1, y0)
            mesh.append(((x0, y0, x1, y1), q))
    out = src.transform((W2, H2), Image.MESH, mesh, Image.BICUBIC)
    return out


def crumple(img, rng):
    """Papel arrugado: pliegues (quiebres con sombra a un lado y brillo al otro) y ondas pequeñas en todas direcciones.
    Los renglones quedan torcidos distinto en cada parte, como una tirilla que estuvo en un bolsillo."""
    from scipy import ndimage
    a = np.array(img.convert('RGB'), np.float32); h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.zeros((h, w), np.float32); dy = np.zeros((h, w), np.float32); shade = np.ones((h, w), np.float32)
    for _ in range(rng.randint(8, 16)):
        ang = rng.uniform(0, math.pi); nx, ny = math.cos(ang), math.sin(ang)
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        d = (xx - cx) * nx + (yy - cy) * ny                         # distancia con signo al pliegue
        step = 1 / (1 + np.exp(np.clip(-d / rng.uniform(1.5, 4), -60, 60)))  # quiebre suave
        amp = rng.uniform(1.5, 7) * rng.choice([-1, 1])
        tx, ty = -ny, nx                                            # el papel se corre a lo largo y de lado
        k = rng.uniform(-0.6, 0.6)
        dx += step * amp * (nx + k * tx); dy += step * amp * (ny + k * ty)
        sg = rng.uniform(3, 30); s1 = rng.uniform(0.04, 0.22)
        shade *= np.where(d > 0, 1 - s1 * np.exp(np.clip(-d / sg, -60, 0)), 1 + s1 * 0.4 * np.exp(np.clip(d / (sg * 0.6), -60, 0)))
    nz = np.random.default_rng(rng.randint(0, 9 ** 9))
    for amp, cell in ((rng.uniform(4, 11), rng.randint(90, 200)), (rng.uniform(2, 5), rng.randint(50, 90)), (rng.uniform(0.5, 1.5), rng.randint(15, 35))):
        gh, gw = h // cell + 2, w // cell + 2
        dx += ndimage.zoom(nz.normal(0, amp, (gh, gw)), (h / gh, w / gw), order=3)[:h, :w]
        dy += ndimage.zoom(nz.normal(0, amp, (gh, gw)), (h / gh, w / gw), order=3)[:h, :w]
    blot = ndimage.zoom(nz.normal(0, 0.05, (h // 40 + 2, w // 40 + 2)), (h / (h // 40 + 2), w / (w // 40 + 2)), order=3)[:h, :w]
    out = np.stack([ndimage.map_coordinates(a[..., c], [yy + dy, xx + dx], order=1, mode='nearest') for c in range(3)], -1)
    out = out * (shade * (1 + blot))[..., None]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def persp_coeffs(dst, src):
    A, B = [], []
    for (x, y), (X, Y) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y]); B.append(X)
        A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y]); B.append(Y)
    return np.linalg.solve(np.array(A, dtype=np.float64), np.array(B, dtype=np.float64)).tolist()


def wood(rng, w, h):
    base = np.array([rng.randint(150, 200), rng.randint(85, 120), rng.randint(40, 70)], dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    grain = np.sin(xx * rng.uniform(0.02, 0.06) + np.sin(yy * 0.01) * 3) * 10 + np.random.default_rng(rng.randint(0, 9 ** 9)).normal(0, 4, (h, w))
    img = base[None, None, :] + grain[..., None] * np.array([1, 0.7, 0.4])
    return img.clip(0, 255)


def background(rng):
    kind = rng.choice(['wall_shelf', 'wall_shelf', 'wall', 'table_wood', 'dark', 'light_desk', 'clothes'])
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if kind in ('wall_shelf', 'wall', 'light_desk'):
        c0 = np.array([rng.randint(200, 240), rng.randint(205, 242), rng.randint(210, 248)], dtype=np.float32)
        g = 1 - 0.25 * (xx / W) * rng.uniform(0.3, 1) - 0.15 * (yy / H) * rng.uniform(0, 1)
        img = c0[None, None, :] * g[..., None]
        if kind == 'wall_shelf':
            # repisa de madera en diagonal a la derecha + ropa oscura abajo
            x0 = rng.randint(int(W * 0.45), int(W * 0.75))
            mask = (xx > x0 + (yy - H * 0.2) * rng.uniform(-0.3, 0.2)) & (yy > H * rng.uniform(0.05, 0.3))
            img[mask] = wood(rng, W, H)[mask]
            m2 = (yy > H * rng.uniform(0.6, 0.8)) & (xx > W * rng.uniform(0.55, 0.8))
            cl = np.random.default_rng(rng.randint(0, 9 ** 9)).integers(10, 90, (H, W, 1)).astype(np.float32)
            img[m2] = (np.array([40, 38, 45]) + cl * np.array([0.6, 0.5, 0.7]))[m2]
    elif kind == 'table_wood':
        img = wood(rng, W, H)
    elif kind == 'clothes':
        img = np.zeros((H, W, 3), np.float32) + np.array([rng.randint(30, 90), rng.randint(30, 80), rng.randint(40, 110)], np.float32)
        for _ in range(12):
            x0, y0 = rng.randint(0, W), rng.randint(0, H); x1, y1 = x0 + rng.randint(80, 500), y0 + rng.randint(80, 600)
            img[y0:y1, x0:x1] = np.array([rng.randint(20, 200) for _ in range(3)], np.float32)
        img = np.array(Image.fromarray(img.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32)
    else:
        img = np.zeros((H, W, 3), np.float32) + np.array([rng.randint(25, 70)] * 3, np.float32)
    img += np.random.default_rng(rng.randint(0, 9 ** 9)).normal(0, 3, img.shape)
    return img.clip(0, 255), kind


SKINS = [(232, 192, 166), (214, 168, 138), (196, 146, 112), (168, 118, 86), (128, 88, 64), (224, 178, 150)]


def capsule(draw, p0, p1, r, fill):
    draw.line([p0, p1], fill=fill, width=int(2 * r))
    draw.ellipse([p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r], fill=fill)
    draw.ellipse([p1[0] - r, p1[1] - r, p1[0] + r, p1[1] + r], fill=fill)


def draw_hand(rng, quad, layer_rgba):
    """Pulgar sobre el borde izquierdo, palma abajo a la izquierda y dedos sobre el borde derecho."""
    skin = np.array(rng.choice(SKINS), np.float32) * rng.uniform(0.9, 1.05)
    mp = Image.new('L', (W, H), 0); dp = ImageDraw.Draw(mp)
    m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m)
    tl, tr, br, bl = quad
    def along(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    # palma + muñeca desde abajo a la izquierda
    t0 = rng.uniform(0.42, 0.62)
    pL = along(tl, bl, t0)
    palm = [(pL[0] - rng.randint(10, 60), pL[1] - 40), (pL[0] + rng.randint(120, 380), pL[1] + 160), (pL[0] + rng.randint(200, 520), H + 50), (-60, H + 50), (-60, pL[1] + rng.randint(0, 200))]
    dp.polygon(palm, fill=255)
    # pulgar: sube por el borde izquierdo, montado sobre el papel
    over = rng.uniform(5, 30)
    ex, ey = tl[0] - bl[0], tl[1] - bl[1]; L = math.hypot(ex, ey); ux, uy = ex / L, ey / L
    nx_, ny_ = -uy, ux  # normal hacia afuera (izquierda)
    if nx_ > 0: nx_, ny_ = -nx_, -ny_
    base = along(tl, bl, t0 + 0.05)
    tipt = along(tl, bl, t0 - rng.uniform(0.12, 0.22))
    r = rng.uniform(55, 72)
    p0 = (base[0] + nx_ * (r * 0.6), base[1] + ny_ * (r * 0.6))
    p1 = (tipt[0] + nx_ * (r - over), tipt[1] + ny_ * (r - over))
    capsule(d, p0, p1, r, 255)
    # dedos sobre el borde derecho
    fingers = []
    n = rng.randint(2, 4)
    ta = rng.uniform(0.38, 0.55)
    ex2, ey2 = br[0] - tr[0], br[1] - tr[1]; L2 = math.hypot(ex2, ey2)
    nrx, nry = ey2 / L2, -ex2 / L2
    if nrx < 0: nrx, nry = -nrx, -nry  # normal hacia afuera (derecha)
    for k in range(n):
        t = ta + k * rng.uniform(0.07, 0.1)
        if t > 0.95: break
        c = along(tr, br, t)
        ov = rng.uniform(-10, 28)  # cuánto tapa el papel (el borde, no el texto)
        rr = rng.uniform(40, 52)
        tip = (c[0] - nrx * ov + nrx * rr * 0.1, c[1] - nry * ov)
        root = (tip[0] + nrx * rng.uniform(180, 260), tip[1] + nry * 60 + rng.uniform(-30, 30))
        capsule(d, tip, root, rr, 255)
        fingers.append((tip, rr))
    m = m.filter(ImageFilter.GaussianBlur(1.6))
    a = np.array(m, np.float32) / 255.0
    ap = np.array(mp.filter(ImageFilter.GaussianBlur(2.5)), np.float32) / 255.0
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    shade = 0.82 + 0.25 * np.sin(xx / rng.uniform(90, 160)) * np.cos(yy / rng.uniform(120, 220))
    col = skin[None, None, :] * shade[..., None]
    col += np.random.default_rng(rng.randint(0, 9 ** 9)).normal(0, 4, col.shape)
    # uñas
    nails = Image.new('L', (W, H), 0); nd = ImageDraw.Draw(nails)
    for tip, rr in fingers:
        nd.ellipse([tip[0] - rr * 0.55, tip[1] - rr * 0.45, tip[0] + rr * 0.45, tip[1] + rr * 0.45], fill=200)
    na = (np.array(nails.filter(ImageFilter.GaussianBlur(3)), np.float32) / 255.0)[..., None]
    col = col * (1 - na) + (col * 0.55 + np.array([250, 225, 215]) * 0.45) * na
    return col, a, ap


def make_sample(idx, seed, prefix='syn_', crumpled=False):
    rng = random.Random(seed)
    lines, fields = make_content(rng)
    paper, boxes, lh = render_paper(rng, lines)
    if crumpled:
        paper = crumple(paper, rng)
    pw, ph = paper.size
    cur = curl(paper, rng)
    cw, chh = cur.size
    # posición en la escena
    scale = rng.uniform(0.62, 0.9) * (H * rng.uniform(1.0, 1.45)) / ph
    w_s, h_s = cw * scale, chh * scale
    cx = W * rng.uniform(0.38, 0.58); top = H * rng.uniform(0.06, 0.2)
    cy = top + h_s / 2
    th = math.radians(rng.uniform(-9, 9))
    corners = [(-w_s / 2, -h_s / 2), (w_s / 2, -h_s / 2), (w_s / 2, h_s / 2), (-w_s / 2, h_s / 2)]
    jit = [(rng.uniform(-0.04, 0.04) * w_s, rng.uniform(-0.02, 0.02) * h_s) for _ in range(4)]
    dst = [(cx + (x + j[0]) * math.cos(th) - (y + j[1]) * math.sin(th), cy + (x + j[0]) * math.sin(th) + (y + j[1]) * math.cos(th)) for (x, y), j in zip(corners, jit)]
    co = persp_coeffs(dst, [(0, 0), (cw, 0), (cw, chh), (0, chh)])
    layer = cur.transform((W, H), Image.PERSPECTIVE, co, Image.BICUBIC)
    la = np.array(layer, np.float32)
    pa = la[..., 3:4] / 255.0
    bg, kind = background(rng)
    hand = rng.random() < 0.85
    if hand:
        col, a_front, a_palm = draw_hand(rng, dst, None)
        bg = bg * (1 - a_palm[..., None]) + col * a_palm[..., None]  # la palma queda detrás del papel
    img = bg * (1 - pa) + la[..., :3] * pa
    # sombra de contacto alrededor del papel
    sh = Image.fromarray((pa[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
    sha = np.array(sh, np.float32)[..., None] / 255.0 * (1 - pa) * rng.uniform(0.1, 0.35)
    img = img * (1 - sha)
    gt_paper = pa[..., 0] > 0.5
    if hand:  # pulgar y dedos delante, tapando los bordes
        img = img * (1 - a_front[..., None]) + col * a_front[..., None]
    # luz: degradado, sombra del teléfono, temperatura de color
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
    tint = rng.uniform(-0.07, 0.07)
    img = img * np.array([1 + tint, 1, 1 - tint])
    img += np.random.default_rng(seed).normal(0, rng.uniform(2, 5), img.shape)
    out = Image.fromarray(img.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    os.makedirs(os.path.join(HERE, 'imgs'), exist_ok=True); os.makedirs(os.path.join(HERE, 'gt'), exist_ok=True)
    name = f'{prefix}{idx:03d}'
    out.save(os.path.join(HERE, 'imgs', name + '.jpg'), quality=rng.randint(72, 92))
    Image.fromarray((gt_paper * 255).astype(np.uint8)).save(os.path.join(HERE, 'gt', name + '.png'))
    # ¿qué líneas quedaron visibles? (centro de la línea dentro de la foto)
    Hi = np.linalg.inv(np.array(persp_coeffs([(0, 0), (cw, 0), (cw, chh), (0, chh)], dst)).tolist() + [1] if False else None) if False else None
    pad = (cw - pw) / 2
    vis = []
    for (y0, y1), (al, t, sty) in zip(boxes, lines):
        u, v = 0.5, ((y0 + y1) / 2 + pad) / chh
        # bilineal sobre el cuadrilátero de destino (aprox. suficiente para saber si está en la foto)
        tl, tr, br, bl = dst
        top_p = (tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u); bot_p = (bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u)
        py = top_p[1] + (bot_p[1] - top_p[1]) * v
        vis.append(bool(t.strip()) and py < H - lh * scale * 0.8)
    meta = {'name': name, 'seed': seed, 'bg': kind, 'hand': hand, 'lines': [l[1] for l in lines], 'visible': vis, 'fields': fields,
            'quad': [list(map(float, p)) for p in dst], 'cut_bottom': bool(max(p[1] for p in dst) > H)}
    json.dump(meta, open(os.path.join(HERE, 'gt', name + '.json'), 'w'), ensure_ascii=False)
    return meta


if __name__ == '__main__':
    # python3 gen.py N SEMILLA [PREFIJO] [--arrugada]
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    n = int(args[0]) if len(args) > 0 else 10
    seed0 = int(args[1]) if len(args) > 1 else 1000
    prefix = args[2] if len(args) > 2 else 'syn_'
    crumpled = '--arrugada' in sys.argv
    for i in range(n):
        m = make_sample(i, seed0 + i, prefix, crumpled)
        print(m['name'], m['bg'], 'mano' if m['hand'] else '', 'cortada' if m['cut_bottom'] else '')
