# Laboratorio del escáner de facturas

Herramientas de desarrollo (no forman parte de la app) para medir el escáner con fotos parecidas a las reales:
tirillas sostenidas en la mano, dedos sobre los bordes, paredes blancas, madera, ropa, curvatura, sombras,
luz cálida o fría, texto del reverso transparentado y tirillas cortadas por el borde de la foto.

Requisitos (solo para desarrollar): Python 3 con `numpy`, `Pillow` y `scipy`; Node con `playwright` y Chromium.

```bash
cd tools/scanlab
python3 gen.py 40 2000                 # 40 fotos sintéticas (syn_) + la respuesta correcta (gt/)
python3 gen.py 60 777000 val_          # 60 fotos nuevas para validar (prefijo val_)
python3 gen.py 30 5000 arr_ --arrugada # 30 tirillas arrugadas: pliegues con sombra y renglones torcidos
(cd ../.. && python3 -m http.server 8820 &)   # o PORT=xxxx para otro puerto
node run_batch.js syn_ 0 40            # mismo código de la app: detectar → recortar → enderezar → limpiar → leer
VAR=parsed python3 evaluate.py syn_    # éxito, recorte (IoU), basura, texto, total, IVA, fecha, tienda, ítems
node run_one.js imgs/mi_foto.jpg       # una foto real: guarda out/mi_foto.png y muestra lo leído
node reparse.js && node parse_eval.js  # re-interpreta los textos ya leídos sin volver a escanear
```

Éxito = recorte correcto (IoU ≥ 0,85) + sin restos de fondo o dedos + ≥ 85 % del texto visible legible + total correcto.
Resultados de la versión 1.32.0: 92 % en el conjunto de ajuste (semillas 2000–2039) y 95 % en 60 fotos nuevas (semillas 777000+).
Versión 1.35.0: 95 % y 97 %; en 30 tirillas arrugadas (`arr_`, semillas 5000+) 30 % de éxito (v1.34: 17 %), total correcto 76 % (62 %),
fecha 87 % (67 %), tienda 67 % (47 %) e IVA 80 % (igual). El evaluador usa la lectura final (`parsed`: dos pasadas + respaldo).

No subas fotos de facturas reales al repositorio (traen nombres, NIT y montos): `imgs/`, `gt/` y `out/` están en `.gitignore`.
