# Laboratorio del escáner de facturas

Herramientas de desarrollo (no forman parte de la app) para medir el escáner con fotos parecidas a las reales:
tirillas sostenidas en la mano, dedos sobre los bordes, paredes y muebles blancos, madera, ropa, curvatura, sombras,
luz cálida o fría, texto del reverso transparentado, tirillas cortadas por el borde de la foto y **tirillas arrugadas**.

Requisitos (solo para desarrollar): Python 3 con `numpy`, `Pillow` y `scipy`; Node con `playwright` y Chromium.

```bash
cd tools/scanlab
python3 gen.py 40 2000                 # 40 fotos sintéticas de tirillas de almacén (syn_) + la respuesta correcta (gt/)
python3 gen_mix.py 60 5000 mix_        # tiquetes de parqueadero arrugados, comprobantes con logo y total entre asteriscos,
                                       # almacén; muebles blancos, mano encima o debajo, hoja grapada detrás, luz cálida
(cd ../.. && python3 -m http.server 8820 &)   # o PORT=xxxx para otro puerto
node run_batch.js mix_                 # mismo código de la app: detectar → recortar → limpiar → leer (dos pasadas)
python3 evaluate.py mix_               # éxito, recorte (IoU), basura, texto, total, IVA, fecha, tienda, ítems (y por tipo)
node run_detect.js mix_ && python3 eval_detect.py mix_   # solo la detección del papel (rápido)
node debug_clean.js /tmp/dbg imgs/mix_003.jpg            # resultado + máscara: verde = se conserva, rojo = se borra
node capture_pre.js /tmp/dbg imgs/mix_003.jpg           # el recorte justo antes de limpiar (pre_mix_003.png)
node debug_pre.js /tmp/dbg /tmp/dbg/pre_mix_003.png --box x0,y0,x1,y1   # limpieza de ese recorte y medidas de cada pieza
python3 gen.py 60 777000 val_          # 60 fotos nuevas para validar (prefijo val_)
python3 gen.py 30 5000 arr_ --arrugada # 30 tirillas arrugadas: pliegues con sombra y renglones torcidos
node run_one.js imgs/mi_foto.jpg       # una foto real: guarda out/mi_foto.png y muestra lo leído
node reparse.js mix_ && python3 evaluate.py mix_         # re-interpreta los textos ya leídos sin volver a escanear
```

Éxito = recorte correcto (IoU ≥ 0,85) + sin restos de fondo o dedos + ≥ 85 % del texto visible legible + total correcto.
Resultados de la versión 1.32.0: 92 % en el conjunto de ajuste (semillas 2000–2039) y 95 % en 60 fotos nuevas (semillas 777000+).
Versión 1.35.0: 95 % y 97 %; en 30 tirillas arrugadas (`arr_`, semillas 5000+) 30 % de éxito (v1.34: 17 %), total correcto 76 % (62 %),
fecha 87 % (67 %), tienda 67 % (47 %) e IVA 80 % (igual). El evaluador usa la lectura final (`parsed`: dos pasadas + respaldo).

## Resultados (v1.35.0)

| Conjunto | Fotos | Éxito v1.34 → v1.35 | Datos completos* v1.34 → v1.35 | Total correcto v1.35 |
|---|---|---|---|---|
| Control `holdA_` (parqueaderos arrugados, comprobantes con logo, almacén) | 75 | 29 % → **77 %** | 15 % → **85 %** | 92 % |
| Control `hsyn_` (tirillas de almacén) | 40 | 100 % → **100 %** | 95 % → **95 %** | 100 % |
| Ajuste `mix_` | 60 | 22 % → 87 % | 10 % → 86 % | 95 % |
| Ajuste `holdB_` (se usó para afinar la tienda) | 75 | 16 % → 67 % | 11 % → 79 % | 87 % |
| Ajuste `syn_` | 40 | 92 % → 92 % | 87 % → 89 % | 100 % |

\* Total, fecha y tienda correctos a la vez (cuando el total quedó dentro de la foto).
En el control `holdA_`: recorte correcto 93 %, texto legible ≥ 85 % en 81 %, fecha 96 %, tienda 89 %, IVA 86 %.
Lo que más falla: el recorte cuando el papel y el fondo casi no se distinguen (pared beige, mueble blanco con la mano
encima) y la lectura de tiquetes muy arrugados (el texto queda limpio, pero el lector confunde letras). Tiempo en un
computador: ≈ 2,3 s detección + limpieza y ≈ 1 s de lectura; en un iPhone puede ser 2–3 veces más.

Las fotos de ajuste (`syn_`, `mix_`, `holdB_`) se usaron para calibrar; las de control (`holdA_` = `gen_mix.py 75 90000 holdA_`
y `hsyn_` = `gen.py 40 97000 hsyn_`) se generaron al final y no se miraron para ajustar nada. Las 6 fotos reales de prueba
(3 tiquetes de parqueadero arrugados y 3 comprobantes con logo) sí se usaron para calibrar: con ellas el total y la fecha
salen bien en las 6 (con v1.34: el total en ninguna y la fecha en 1).

No subas fotos de facturas reales al repositorio (traen nombres, NIT, montos, lugares y horas): `imgs/`, `gt/`, `out/` y
`out_det/` están en `.gitignore`. Para probar con una foto real, ponla en `imgs/` con el prefijo `real_` y no la agregues a git.
