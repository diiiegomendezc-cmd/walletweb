# WalletWeb (nombre provisional)

PWA privada de finanzas personales: gastos, ingresos, presupuestos, cuentas, tarjetas a cuotas, gastos compartidos, préstamos, lista de deseos con fondo mensual, recurrencias con festivos colombianos, copias cifradas e importación CSV.

**Todo se guarda en el dispositivo** (IndexedDB). No hay servidor, no hay cuentas, no se envía nada a Internet.

## Instalar en el iPhone (gratis, ~10 minutos)

Para instalarse como app, una PWA tiene que publicarse en una dirección `https://`. La forma gratuita más simple es GitHub Pages:

1. Crea una cuenta en github.com (si no tienes).
2. Crea un repositorio nuevo, por ejemplo `walletweb` (puede ser público: el código no contiene datos tuyos; tus datos viven solo en tu teléfono).
3. Sube **todo el contenido** de esta carpeta (`index.html`, `*.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, carpeta `icons/`). En la web de GitHub: *Add file → Upload files*, arrastra todo y luego *Commit*.
4. Ve a *Settings → Pages*. En *Source* elige `Deploy from a branch`, rama `main`, carpeta `/ (root)` → *Save*.
5. Espera 1–2 minutos. Tu app estará en `https://TU-USUARIO.github.io/walletweb/`.
6. En el iPhone, abre esa dirección **en Safari** → botón Compartir → **Agregar a pantalla de inicio**.
7. Abre WalletWeb desde el ícono. Crea tu PIN y activa Face ID cuando te lo pregunte.

> ⚠️ Los datos del ícono de la pantalla de inicio y los de Safari son **independientes** en iOS. Usa siempre el ícono.

Alternativas gratuitas equivalentes: Cloudflare Pages o Netlify (arrastrar la carpeta). Ninguna garantiza que siga siendo gratis para siempre.

### Probar en el computador
```bash
python3 -m http.server 8765    # dentro de esta carpeta
# abre http://localhost:8765
node --test tests/              # pruebas del núcleo financiero
```

## Copias de seguridad (importante)
Como los datos viven solo en el teléfono, **si borras la app o el navegador limpia su almacenamiento, se pierden**. Haz una copia cifrada cada semana: *Ajustes → Copia de seguridad cifrada* → se abre el menú Compartir del iPhone → *Guardar en Archivos* o *Drive*. La app te avisa si llevas más de 7 días sin copia. Además guarda una copia diaria interna (últimos 7 días) para recuperarte de errores.

Formato del archivo (JSON):
```
{ format: "walletweb-backup", version: 1, createdAt,
  kdf:    { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: base64(16 bytes) },
  cipher: { name: "AES-GCM", iv: base64(12 bytes) },
  data:   base64(AES-256-GCM(JSON del estado + comprobantes + manifiesto)) }
```

## Atajo de iPhone (para compras con tarjeta)
En iOS, un Atajo que abre una URL lo hace en Safari, **no** en la app instalada (y Safari tiene otros datos). Por eso el flujo recomendado usa el portapapeles:
1. App Atajos → Automatización → **Transacción** (Wallet) o cualquier disparador.
2. Acción *Copiar en portapapeles*: `Compraste [Importe] en [Comercio]`.
3. Acción *Mostrar notificación*: "Abre WalletWeb para registrarlo".
4. En WalletWeb: **+** → ícono de portapapeles → *Leer del portapapeles* → *Usar este texto*. El gasto se abre ya lleno, con estado **Confirmado**; revisas y guardas.

También puedes pegar ahí el texto de una notificación de Rappi, Nequi o un correo.

## Qué incluye esta versión
- Inicio: disponible del mes, presupuestos, ingresos esperados vs recibidos, alertas por reglas (con "por qué veo esto"), pendientes, recientes, lista de deseos (fondo, proyección y para cuántos te alcanza), tendencia 6 meses, comparación mensual e interanual, proyección, categorías principales, compras a cuotas (compromiso total y flujo mensual), próximos pagos.
- Cuentas: ya no hay sección de cuentas ni saldos. Al registrar un movimiento eliges la cuenta (para verificar con qué pagaste) y escribes la **referencia de pago**; la app avisa si esa referencia ya existe. Los nombres de cuentas se corrigen en Ajustes → Cuentas.
- Categorías de gasto: **Necesario, Entretenimiento, Inversión y Préstamo**, con subcategoría opcional en cada gasto (Mercado, Restaurantes, Educación…). Puedes crear subcategorías nuevas desde el mismo formulario con "+ Nueva" o en Ajustes → Categorías. Los datos anteriores se reorganizan solos.
- Tienda en gastos: nombre opcional y un link opcional que puede ser de Google Maps o la página web del artículo. Botón **Mapa** (OpenStreetMap, gratis y sin clave: buscar por nombre o tocar el mapa, genera el link de Google Maps), botón **Google Maps** (abre la app de Google con el nombre de la tienda) y **Pegar**. Si repites tienda, el link de Maps se llena con el de tu última compra ahí.
- Detalle de la compra (siempre visible, sin desplegar): factura (**Escanear** / **Adjuntar**, ver escáner abajo), tabla de **ítems** opcional (Ítem n.º, Nombre, Cantidad entera, Precio unitario y Valor total calculado solo), tablita de **Impuestos, Descuentos, Propina y Envío** (cada renglón se borra con × y se puede agregar "Otro apartado") y **Comentarios adicionales** al final. Si hay un solo ítem sin precio, toma el importe.
- Personas en gastos e ingresos: etiquetas de una o varias personas que se guardan para el futuro, con grupos (Familia, Pareja…) que se marcan de un toque. El Inicio muestra "¿En quién gastas más?" (si hay varias personas, el gasto se reparte en partes iguales) y en Ajustes → Personas ves el total por persona.
- **Escáner de facturas** (pantalla propia, `app-scan.js`): cámara en vivo que detecta la tirilla y marca sus bordes; modo **Auto** dispara solo cuando la factura queda quieta ~1,5 s. Recorte con corrección de perspectiva **y de papel curvo o doblado**: detecta los bordes reales (no solo 4 esquinas) y los aplana; después **gira el texto** si viene inclinado (ángulo con el perfil de renglones más nítido, sin dejarse engañar por dobleces; funciona aunque la foto ya esté recortada y no se vean los bordes), endereza los renglones que sigan curvos u ondulados en "S" (modelo suave a partir de franjas vecinas, hasta 4 pasadas) y **solo aplica cada corrección si los renglones quedan más nítidos** (perfil horizontal de tinta); lo mismo con la curvatura de bordes detectada (si no mejora, se usa el recorte plano). Recorta el blanco sobrante. En el editor, círculos grandes = esquinas y 1 a 3 puntos pequeños por borde (3 en los bordes largos) que deforman solo su tramo para seguir formas irregulares; botón rotar. Detección de la hoja: balance de blancos automático (luz cálida), varias vistas de la foto (brillo, "blancura" = brillo menos color, diferencia con el fondo) y varios umbrales; gana la de mejor forma × contraste × nitidez del borde; luego cada punto del contorno se pega al borde real y se corrigen las esquinas. Acabado **Mejorada** (blanco y negro: quita sombras profundas y dobleces aunque sean oscuros, borra dedos que tapan el borde y restos del fondo) o **Color** (color con la luz aplanada y el fondo blanco). Se guarda como **PDF con texto buscable** (capa invisible del OCR) llamado `AAAAMMDD_Tienda_Valor.pdf`, con miniatura. Todo se procesa en el teléfono. Fotos de galería pasan por el mismo editor. Al tocar la miniatura (en el formulario o en el detalle del gasto) se abre un **visor a pantalla completa** con zoom (pellizcar, doble toque, rueda del mouse), Abrir PDF, Compartir/Guardar y, antes de guardar, Ajustar recorte. La imagen del visor sale del mismo PDF guardado (no se guarda doble).
- Movimientos: gasto, ingreso, transferencia, ajuste; calculadora (`200000/4`); categoría y subcategoría, comercio, enlaces, propina/impuestos/descuento/envío, estado (confirmado, por revisar, borrador), comprobante (foto/PDF validado por firma, imágenes re-codificadas sin metadatos), borrador autoguardado, deshacer, papelera de 30 días, auditoría de ediciones.
- Gasto compartido contable: salida total, tu gasto, por cobrar; partes iguales o personalizadas; redondeo determinista; regalo/asumido; cobros que **no** cuentan como ingreso.
- Tarjetas de crédito: compras a cuotas, pago de tarjeta como transferencia (no se cuenta dos veces), opción de presupuesto por cuota o por compra.
- Préstamos entregados y recibidos: sin interés, simple o compuesto (explícito), cronograma, abonos parciales que separan interés y capital, vencidos con días de atraso, condonar/cancelar.
- Recurrencias: salario 15 y 30 con día hábil anterior (fines de semana y festivos de Colombia calculados localmente, con excepciones manuales). Nunca se confirman solas.
- Presupuestos: global, categoría, naturaleza, etiqueta, cuenta; valor fijo o % de ingresos esperados/recibidos; ritmo diario y proyección.
- **Quiero comprar** (lista de deseos): un presupuesto mensual para deseos que se acumula en un fondo (si lo cambias, cuenta desde ese mes; ajustes manuales para dinero extra); fecha hasta la que planeas (fin de año por defecto). Cada deseo tiene precio, link de compra, prioridad, por qué comprarlo, por qué no, y condiciones (precio objetivo, cuotas sin interés, otra condición). El plan ordena por prioridad y marca hasta dónde te alcanza a la fecha elegida (línea "Hasta aquí te alcanza") y en qué mes te alcanzaría cada uno. "Lo compré" descuenta del fondo (opcional) y puede abrir el gasto ya lleno; "Descartar" lo saca del plan; "Descargar plan" baja un CSV. Las metas antiguas se convierten solas (sus aportes quedan como saldo del fondo).
- **Análisis financiero** (v1.22): en el Inicio cada gráfico muestra solo título, total y gráfica (Flujo de caja, Gasto por categoría, Gasto por persona y Análisis personalizados). Al **tocarlo** se abre una ventana: arriba los filtros (quedan fijos al desplazar), luego el total, la variación, la gráfica grande y la lectura; los **movimientos** quedan casi invisibles debajo y aparecen suavemente al **deslizar hacia abajo**. Deslizar de lado sobre la gráfica recorre los puntos; tocar una barra muestra solo sus movimientos. Animaciones suaves (la línea se dibuja, las barras crecen, los cambios de filtro se funden).
- **Gráficos con filtros** (v1.20): Flujo de caja, Gasto por categoría y Gasto por persona tienen filtros propios de periodo (mes, 3/6/12 meses, año, todo o fechas), categoría o subcategoría, persona y cuenta; se recuerdan. Al tocar o **deslizar el dedo** sobre un gráfico aparecen debajo los movimientos de ese día, semana, mes, persona o categoría, con "Ver en Movimientos". Cada gráfico dice el total, la variación frente al periodo anterior y una lectura corta (promedio, pico, quién concentra más). Al final del Inicio, **Mis gráficos**: crea los tuyos (en el tiempo o comparando por categoría, subcategoría, persona, tienda o cuenta), por ejemplo "Mercado con Papá", con vista previa y sugerencias armadas con tus datos.
- **Perfiles y moneda** (v1.30): varios perfiles en el mismo teléfono, cada uno con sus datos, PIN y moneda (COP, USD, EUR, MXN, ARS, CLP, PEN, BRL o GBP; montos sin centavos). Se cambian con el círculo de la inicial arriba a la derecha o en Ajustes → Perfiles. Siempre existe el perfil **Demostración**, con datos ficticios para mostrar la app (se puede restablecer). Borrar datos afecta solo al perfil abierto.
- **Prestar desde Nuevo movimiento** (v1.29): un gasto con la categoría **Préstamo** pregunta a quién le prestas (una persona), en cuántas cuotas y cuándo te paga, y se guarda como préstamo en Préstamos → Me deben (no como gasto). Los gastos que ya estaban en esa categoría aparecen en Préstamos y en el Inicio con el botón **Convertir**, que los vuelve préstamo conservando su soporte.
- **Estabilidad** (v1.28): al abrir, la base de datos se abre y se lee con reintentos; el estado se guarda también en una copia espejo local, y si la base de datos falla se recupera de ella o de la instantánea diaria. Si nada se puede leer, la app muestra "No pudimos abrir tus datos" con Reintentar y no guarda nada encima. También se corrige la pantalla corrida (el saludo más abajo) al cerrar el teclado o volver a la app. En Ingreso → Pago de préstamo, la lista de Personas muestra solo a quienes te deben.
- **Colores personalizables** (v1.27): Ajustes → Colores de categorías. Para cada categoría eliges una familia (sus subcategorías toman tonos de ella) o un color exacto, y cada subcategoría puede tener su propio color; "Restablecer colores" vuelve a los automáticos.
- **Solo el monto es obligatorio** (v1.26): un movimiento se guarda con solo escribir un monto de $ 1 o más. Categoría, subcategoría, tienda, ítems, cuenta y enlaces son opcionales (las transferencias sí necesitan las dos cuentas). Los datos mal escritos en ítems o en impuestos/propina se corrigen o se ignoran en vez de bloquear el guardado.
- **Movimientos compactos** (v1.25): arriba solo el buscador con un botón de filtros (con contador), una fila de chips (los filtros activos primero, con ×, y el tipo: Todos, Gastos, Ingresos, Otros, Revisar) y una barra fina con el mes y las entradas/salidas. Periodo, categoría, cuenta y persona se eligen en la ventana "Filtrar movimientos", que dice cuántos resultados hay.
- **Préstamos en el Inicio** (v1.25): cuánto te deben y cuánto debes, cada préstamo activo con su avance, próxima fecha y atraso, los últimos pagos (con un clip si tienen soporte) y el **Historial** completo de pagos, filtrable por persona; cada pago abre su detalle con el soporte.
- **Abonos desde Ingresos** (v1.25): en Nuevo movimiento → Ingreso aparece "Pago de préstamo"; eliges quién te está devolviendo (con saldo, cuota y atraso), la app muestra cuánto va a interés y a capital y el saldo que queda, y puedes adjuntar el soporte (foto o PDF del comprobante). Desde v1.27 la app no adivina: en un ingreso, al marcar en "Personas" a alguien que te debe, el valor se descuenta automáticamente de su préstamo (con "No es un abono" para dejarlo como ingreso normal). El abono queda en el préstamo y la devolución de capital no cuenta como ingreso.
- **Filtros cruzados, como en un tablero** (v1.24): en la ventana de un gráfico, tocar una barra la vuelve filtro y abre debajo otra gráfica con esa selección. Gasto por persona → tocar a Laura muestra en qué categorías gastas con ella; Gasto por categoría → tocar Entretenimiento (o Restaurantes, con "Ver por: Subcategoría") muestra con quién gastas más. Se puede seguir bajando (categoría → subcategoría → comercio → cuenta) y cambiar la dimensión con los botones "Categoría / Subcategoría / Persona / Tienda / Cuenta". Los filtros aplicados aparecen como etiquetas con ×. En Flujo de caja, tocar un mes muestra su gasto por categoría. Los movimientos de abajo siguen siempre la selección.
- **Color por categoría** (v1.23): cada categoría tiene una familia de color y sus subcategorías usan tonos de esa familia (Necesario en rojos: Mercado rojo brillante, Transporte borgoña; Entretenimiento en violetas; Inversión en verdes; Préstamo en ámbar; cada ingreso con su propio color). Se ve en los íconos de los movimientos, en el formulario (que además se tiñe suavemente del color elegido) y en los gráficos. Se cambia en Ajustes → Categorías → Color.
- **Vidrio líquido en movimiento** (v1.23): en el menú inferior un lente de vidrio se desliza y se estira como agua hasta la pantalla elegida (también se arrastra con el dedo); los reflejos del vidrio se mueven al desplazar; ondas al tocar, botones con rebote suave, ventanas que suben con resorte y transición entre pantallas. Respeta "Reducir movimiento" del iPhone.
- **Menú inferior editable**: 4 botones alrededor del + (por defecto Inicio, Movimientos, Presupuestos, Ajustes). Se cambia en Ajustes → Apariencia → Menú inferior o manteniendo presionada la barra. Si quitas Ajustes aparece un engranaje arriba; lo que no está en la barra sigue en Ajustes (incluido Préstamos).
- Personas, categorías editables, tema claro/oscuro/automático, modo privacidad, bloqueo por PIN + passkey (Face ID/Touch ID/huella), bloqueo al minuto y al salir de la app.
- Exportación CSV (protegida contra inyección de fórmulas), importación CSV con mapeo, vista previa y detección de duplicados; copia cifrada y restauración verificada; borrado total con confirmación escrita.

## Decisiones y diferencias frente al documento de requisitos
Ver `PROJECT_STATUS.md`.
