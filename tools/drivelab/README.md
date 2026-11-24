# Laboratorio de Google Drive (solo desarrollo)

Prueba de punta a punta de **Ajustes → Facturas en Google Drive** sin tocar Google:

- El programa de Apps Script es exactamente el que la app copia al portapapeles (`C.driveScript`), y corre en Node
  sobre el Drive simulado de `tests/drive-mock.cjs`.
- Un servidor HTTPS local se hace pasar por `script.google.com` y `script.googleusercontent.com` y responde como
  Google (POST → redirección 302 → JSON con CORS). Así se prueban también la CSP y la redirección real del navegador.
- La app se abre en Chromium a 390×844 y se recorre: conectar (con errores de URL y de clave), subida inicial, editar
  (mueve y renombra), eliminar y restaurar, nombres repetidos, cambiar y quitar la factura, sin Internet, papelera vaciada
  sin Internet, recargar, perfil de demostración, subida automática apagada, restaurar copia y desconectar.

```bash
node tools/drivelab/e2e.js
```

Necesita Playwright con Chromium, `openssl` y poder abrir el puerto 443 (usuario root, como en el contenedor de
desarrollo). Crea un certificado temporal en `tools/drivelab/.cert/` y capturas en `tools/drivelab/out/` (ambos
ignorados por git). Debe terminar en `TODO OK`.

Las pruebas rápidas del programa de Apps Script (sin navegador) están en `tests/core.test.cjs`.
