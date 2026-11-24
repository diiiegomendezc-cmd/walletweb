# Laboratorio del escáner de facturas

Herramientas de desarrollo (no forman parte de la app) para medir el escáner con fotos parecidas a las reales:
tirillas sostenidas en la mano, dedos sobre los bordes, paredes blancas, madera, ropa, curvatura, sombras,
luz cálida o fría, texto del reverso transparentado y tirillas cortadas por el borde de la foto.

Requisitos (solo para desarrollar): Python 3 con `numpy`, `Pillow` y `scipy`; Node con `playwright` y Chromium.

```bash
cd tools/scanlab
python3 gen.py 40 2000                 # 40 fotos sintéticas + la respuesta correcta (gt/)
(cd ../.. && python3 -m http.server 8820 &)   # o PORT=xxxx para otro puerto
node run_batch.js syn_ 0 40            # mismo código de la app: detectar → recortar → limpiar → leer
VAR=parsedM python3 evaluate.py syn_   # éxito, recorte (IoU), basura, texto, total, IVA, fecha, tienda, ítems
node run_one.js imgs/mi_foto.jpg       # una foto real: guarda out/mi_foto.png y muestra lo leído
node reparse.js && node parse_eval.js  # re-interpreta los textos ya leídos sin volver a escanear
```

Éxito = recorte correcto (IoU ≥ 0,85) + sin restos de fondo o dedos + ≥ 85 % del texto visible legible + total correcto.
Resultados de la versión 1.32.0: 92 % en el conjunto de ajuste (semillas 2000–2039) y 95 % en 60 fotos nuevas (semillas 777000+).

No subas fotos de facturas reales al repositorio (traen nombres, NIT y montos): `imgs/`, `gt/` y `out/` están en `.gitignore`.
