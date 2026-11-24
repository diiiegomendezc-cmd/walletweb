# PROJECT_STATUS — WalletWeb

Fecha: 2026-11-16 · Versión 1.0.0 ("v1 local")

## Decisión principal
El documento pide primero un Hito 0 (solo diseño) y una arquitectura React + FastAPI + PostgreSQL con Google OIDC. El usuario pidió una app usable en el iPhone ya. Se construyó una **v1 100 % local** (sin servidor) que cubre el núcleo financiero de los hitos 3, 4, 5 (sin push), 6, 8 y parte de 9 y 10. Sirve como prototipo funcional y como especificación ejecutable del modelo de datos para la futura versión con backend.

| Requisito del documento | Estado en v1 | Motivo / plan |
|---|---|---|
| React + TypeScript + Vite | JavaScript sin dependencias | Se publica sin compilar ni instalar nada. Migrar a React/TS cuando exista backend. |
| Backend FastAPI + PostgreSQL | No aplica | No hay servidor. Datos en IndexedDB. |
| Login con Google (solo la cuenta del dueño) | **No incluido** | Requiere backend para validar el `sub` de forma segura. Sin servidor no hay a quién proteger del acceso remoto: los datos no salen del teléfono. |
| Passkey / biometría | Passkey local (WebAuthn, verificación de usuario) + PIN obligatorio | Es un bloqueo de pantalla; no cifra los datos guardados. |
| Argon2id | PBKDF2-SHA256 (210k para PIN, 600k para copias) | WebCrypto no trae Argon2id; evitar dependencias externas. |
| IndexedDB cifrado | **No cifrado** | Requeriría pedir el PIN para derivar la clave en cada apertura; pendiente (WebAuthn PRF). Mitigación: código del iPhone + bloqueo de la app. |
| OCR de facturas | **Incluido (v1.9)**: Tesseract.js 7 local con español (`vendor/tesseract`, ~14 MB, se carga solo al usar la foto) | Parser de facturas colombianas en `core.js` con pruebas. Probado con una factura generada (lectura en ~2 s en Chrome); falta validar con fotos reales del iPhone. |
| Google Drive, Gmail, IA | No incluidos | Requieren backend/OAuth. Los comprobantes se guardan en el dispositivo y viajan dentro de la copia cifrada. |
| Web Push | Centro de alertas interno | Push necesita servidor con VAPID. |
| Importación .xlsx | Solo CSV | Evita librerías con vulnerabilidades conocidas; Excel → Guardar como CSV UTF-8. |
| Sesiones/dispositivos | No aplica | Sin servidor no hay sesiones remotas. |
| Inglés | Pendiente | La interfaz está solo en español. |
| Sección Cuentas con saldos | **Eliminada** (v1.3, a pedido) | La cuenta queda solo como etiqueta del movimiento, junto a la referencia de pago con aviso de duplicados. Ajustes y Cuentas pasan a la barra inferior. |
| Categoría y naturaleza separadas | **Unificadas** (v1.4, a pedido) | Las categorías de gasto son las 4 naturalezas; el detalle va en subcategorías. Migración automática (esquema 2) y presupuestos por subcategoría. |
| Escáner de facturas | **v1.32**: detección por texto + watershed (tirillas en la mano sobre fondos claros, dedos encima de los bordes, tirillas cortadas por la foto), esquinas por rectángulo mínimo + rectas, máscara del papel para borrar dedos y fondo, limpieza por luz del papel sin binarizar, lectura en dos pasadas con cuadre contra el total y llenado de tienda y fecha. | Medido con `tools/scanlab` (generador de fotos sintéticas + evaluador): 92 % de éxito en el conjunto de ajuste y 95 % en 60 fotos nuevas; la foto real de KOAJ queda limpia y con todos sus datos. Falta: más fotos reales del iPhone (las sintéticas no cubren todo: palmas muy claras sobre fondo claro aún pueden confundirse). Tiempo en computador ≈ 2 s de procesamiento + 1,5–3 s de lectura; en el iPhone puede ser 2–3 veces más. |
| Selector de mapa | OpenStreetMap + Leaflet (v1.8) | El mapa propio de Google exige clave con facturación. OSM es gratis; el resultado se guarda como link de Google Maps. Única conexión externa de la app, solo al abrir el mapa; declarada en la política de privacidad y en la CSP. No probado contra los servidores reales desde el entorno de desarrollo (sin salida a OSM); flujo verificado con respuestas simuladas. |
| Estado de préstamo "Condenado" | Interpretado como **"Condonado"** | Parece errata. |
| Navegación: Ajustes en la barra inferior | Ajustes en el engranaje superior | Seis botones con "+" central no caben bien en un iPhone. |

## Pruebas
- `node --test tests/` → 14 pruebas del núcleo (calculadora, divisiones, festivos 2026, salario 15/30, préstamo con abono parcial, interés compuesto, cuotas, presupuestos, CSV, texto pegado, duplicados, copia cifrada y manipulación, metas).
- Pruebas end-to-end con Chrome sin interfaz (390×844 y 1280×860): configuración inicial, PIN incorrecto/correcto, gasto compartido 200.000/4, abono de préstamo, regla de salario, URL de atajo (queda "por revisar" y se borra de la URL), importación CSV con fila inválida, copia cifrada → borrado → restauración, modo privacidad, modo oscuro, funcionamiento sin conexión con service worker. Sin errores de consola.
- No probado en un iPhone físico: Face ID por passkey, selector de cámara, menú Compartir.

## Riesgos conocidos
1. **Pérdida de datos** si se borra la app o Safari limpia el almacenamiento → copia semanal + aviso + instantáneas diarias + `navigator.storage.persist()`.
2. Los datos del ícono instalado y de Safari están separados en iOS.
3. Sin sincronización entre iPhone y Mac (solo vía copia/restauración).
4. Los festivos se calculan por ley; si el Gobierno cambia uno, usar excepciones manuales.

## Siguiente hito sugerido
Backend mínimo (FastAPI + PostgreSQL) con Google OIDC restringido al `sub` autorizado, sincronización con cola offline, Drive (`drive.file`) para comprobantes y copias, Web Push. El modelo de datos de `core.js` y el estado de `app-base.js` sirven de base.
