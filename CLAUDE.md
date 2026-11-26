# CLAUDE.md — WalletWeb

App personal de finanzas (Colombia), en español. PWA 100 % local para iPhone: sin backend, sin
dependencias que instalar, sin paso de compilación. Se publica tal cual en GitHub Pages. Los datos viven
en IndexedDB del dispositivo. Opcional: facturas a su propio Google Drive (Apps Script del usuario, `app-drive.js`).

Antes de cambiar algo grande, lee `PROJECT_STATUS.md` (decisiones y límites) y `README.md` (funciones).

## Archivos
| Archivo | Qué tiene |
|---|---|
| `index.html` | Estructura, CSP, orden de los `<script>` (clásicos, comparten variables globales). `init()` (app-main.js) arranca en `DOMContentLoaded`, cuando ya cargaron todos |
| `core.js` | Lógica pura y probada: dinero, calculadora, festivos de Colombia, recurrencias, préstamos, presupuestos, lista de deseos (`wishPlan`), lector de facturas (`parseReceiptText`), CSV, carpeta y nombre en Drive (`driveTarget`) y el programa de Apps Script (`driveScript`). Exporta `C` |
| `app-base.js` | Estado `S`, valores por defecto, íconos (`ICONS`/`ic()`), almacenamiento, hojas (`openSheet`), menú inferior editable (`TAB_OPTIONS`), `APP_VERSION` |
| `app-views.js` | Pantallas (`VIEWS`, `PARENT`, `render()`, `go()`) |
| `app-forms.js` | Formularios: movimiento (`txForm`), factura, deseos, presupuestos, etc. |
| `app-scan.js` | Escáner de facturas: detección del papel, bordes curvos, recorte, enderezado (`scanDeskew`; renglones de papel arrugado con `scanDewarp`: línea base de las palabras → malla de inclinaciones con "puentes" entre etiqueta y monto para no descuadrar columnas; `sRigidLines`: las letras se mueven enteras y el estiramiento va al blanco entre renglones), limpieza (`scanClean`; en el modo mejorado solo queda lo impreso, `sTextKeep`; la detección de muebles blancos viene de la versión de la otra sesión), copia ampliada para el lector (`scanForOcr`), lectura de respaldo sin enderezar renglones (`scanFlat`, solo si a la primera lectura le falta algo), PDF, visor |
| `app-charts.js` | Gráficos con filtros: los del Inicio (`HOME_CHARTS`, filtros en `S.settings.homeCharts`) y "Mis gráficos" (`S.charts`). Tocar/deslizar muestra los movimientos. Se carga después de `app-main.js` |
| `app-fx.js` | Movimiento y vidrio: lente del menú inferior, reflejos con el scroll, ondas, transición entre pantallas, tinte del formulario por categoría. Envuelve `render`, `go`, `openTxForm` y `rerenderTx`. Se carga al final |
| `app-loans.js` | Préstamos en el Inicio, historial de pagos, abonos desde el formulario de Ingreso (detección de quién devuelve, `D.loanMode`/`D.loanId`, se guarda como `repay_in` en `txSave`) y filtros compactos de Movimientos. Envuelve `updateTxLive` |
| `app-colors.js` | Ajustes → Colores de categorías: familia (`palette`), color exacto (`colorHex`) y color por subcategoría (`sub.color`) |
| `app-profiles.js` | Perfiles: botón de la barra superior, cambiar/crear/editar/eliminar, perfil Demostración. El registro (`PROFILES`, `PROFILE`, `stateKey()`, `snapPrefix()`, `mirrorKey()`) vive en `app-base.js`; el perfil `main` usa las claves antiguas. Moneda con `C.setCurrency` (montos enteros) |
| `app-main.js` | Acciones (`ACT`, delegadas por `data-act`), migraciones (`migrate`), datos de demostración |
| `app-drive.js` | Facturas en Google Drive: conexión (`S.settings.drive`, clave, URL `/exec`), lo que ya está en Drive (`S.driveFiles`, aparte del movimiento), sincronización una a la vez (subir, mover/renombrar, papelera), hoja de Ajustes y estado del comprobante. Envuelve `save` para revisar unos segundos después. Se carga al final |
| `styles.css` | Estilo "liquid glass" monocromático |
| `sw.js` | Service worker (caché del shell). **Subir `VERSION` en cada entrega** |
| `vendor/` | Leaflet y Tesseract.js (con `spa.traineddata.gz`) locales |
| `tests/core.test.cjs` | Pruebas del núcleo (incluye el programa de Apps Script con el Drive simulado de `tests/drive-mock.cjs`) |
| `tools/drivelab/` | Prueba de punta a punta de Drive con un "Google" local (HTTPS, redirección y CORS reales). Ver su README |
| `tools/scanlab/` | Laboratorio del escáner (solo desarrollo): generador de fotos sintéticas, ejecución con el mismo código de la app y evaluador. Ver su README. Nunca subir fotos de facturas reales |

## Reglas
- Interfaz en español de Colombia; dinero en pesos como **enteros** (sin decimales), formato `$ 1.234.567`.
- Estilo: interfaz monocromática, sin emojis; **las categorías tienen color** (`CAT_FAMILIES` en `app-base.js`: familia por categoría, tonos por subcategoría; `catColor`, `subColor`, `txColor`) y **los gráficos también** (paleta categórica fija `--c1`…`--c8` en `styles.css`, validada para daltonismo; el color sigue a la entidad, no a su puesto), liquid glass (transparencia/desenfoque configurables en Ajustes).
- Privacidad (del documento original): nunca guardar números completos de tarjeta, CVV, PIN bancario ni contraseñas.
  Nada sale del dispositivo salvo el mapa (CARTO/OSM, solo el texto buscado) y, si el usuario lo conecta, sus facturas a su
  propio Google Drive (Apps Script en su cuenta; el programa solo toca archivos que él creó). Sin analítica ni cookies.
- Nunca guardar dinero automáticamente: lo leído de facturas, portapapeles o reglas se propone en el formulario y el usuario lo guarda. Desde v1.18 el formulario abre siempre con estado Confirmado (pedido del dueño); los campos Hora y Dirección/sede (v1.18) y Etiquetas y Método de pago (v1.19) se quitaron del formulario; los datos antiguos se conservan.
- Cambios de modelo de datos: subir `schema` en `defaultState()` y migrar en `migrate()` (app-main.js) sin perder datos.
- Si cambias el programa de Apps Script (`DRIVE_GS` en core.js), sube `DRIVE_SCRIPT_VERSION`: la app le pide al usuario copiarlo
  de nuevo y publicarlo como versión nueva (Implementar → Gestionar implementaciones → Editar → Versión nueva, misma URL).
- Sin dependencias nuevas ni build. Si algo necesita backend, anotarlo en `PROJECT_STATUS.md`.
- **El repositorio es público**: nunca subir datos personales (correos, nombres reales, fotos o textos de facturas reales, números de
  documento, direcciones). Pruebas y ejemplos con datos ficticios. Si algo se filtra, quitarlo también del historial.
- Seguridad: todo texto del usuario va con `esc()` al HTML; ids, fechas, colores y números internos se insertan sin escapar y por
  eso las copias restauradas se revisan con `C.unsafeStateFields`. Nada de `onclick` en línea (la CSP lo bloquea): usar `data-act`.
  En Demostración no se tocan otros perfiles.

## Al entregar una versión
1. Subir `VERSION` en `sw.js` y `APP_VERSION` en `app-base.js` (mismo número).
2. `node --check` a cada `.js` y `node tests/core.test.cjs` (todas deben pasar). Si tocaste Drive: `node tools/drivelab/e2e.js` (debe decir `TODO OK`).
3. Probar en un navegador de 390×844 (iPhone): `python3 -m http.server` en esta carpeta.
4. Actualizar `README.md` / `PROJECT_STATUS.md` si cambió una función o una decisión.

## Pendiente que quedó en conversación
- Fondo de ahorro: el dueño de la app deja como inversión lo que le sobra del mes. Se le ofreció (a) hacerlo a mano con
  una cuenta "Fondo de ahorro" y transferencias, o (b) un fondo automático que al cierre del mes guarde el
  sobrante. Falta que elija qué cuenta como "sobrante": lo que queda del presupuesto Global (tope − gastado)
  o lo real (recibido − gastado).
- Escáner: con cada foto real que falle, pásala por `tools/scanlab/run_one.js` (sin subirla al repo) y vuelve a medir los conjuntos
  sintéticos `syn_`, `val_` y `arr_` (arrugadas) para no empeorar (meta > 90 % en `syn_`/`val_`). Las fotos que llegan por el chat
  vienen reducidas (~1500×2000): la lectura real en la app, con Foto HD (12 MP), es mejor que en esas pruebas.
- Historial de git: ya se reescribió en GitHub (v1.35) para quitar datos personales de commits viejos; no subir ramas basadas en el historial anterior.
