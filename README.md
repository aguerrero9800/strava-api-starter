# Strava API Starter

Copia independiente para una sola cuenta de Strava. No incluye historial Git, secretos, tokens, base de datos ni actividades del proyecto original.

## Configurar

1. Instalar Node.js 20.19 o superior y disponer de una base PostgreSQL propia.
2. Ejecutar `npm ci`.
3. Copiar `.env.example` a `.env` y completar valores propios:
   - `STRAVA_CLIENT_ID` y `STRAVA_CLIENT_SECRET`: de tu propia aplicación de Strava.
   - `DATABASE_URL`: conexión a tu propia base PostgreSQL.
   - `API_KEY`: clave aleatoria para proteger `/api/*`.
   - `BASE_URL`: URL de tu despliegue, sin barra final.
4. En tu app de Strava configurar el dominio de callback del despliegue. El callback es `BASE_URL/strava/callback`.
5. Ejecutar `npm start`. Se crea la tabla `strava_tokens` en la base propia.
6. Abrir `BASE_URL/strava/login` y autorizar TU cuenta.
7. Consultar las rutas con `Authorization: Bearer TU_API_KEY`.

Para generar una clave local: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. No la pegues en el repositorio.

## Rutas

- `GET /api/activities`: últimas actividades.
- `GET /api/runs/latest`: última corrida.
- `GET /api/runs/latest/detail`: resumen y parciales.
- `GET /api/runs/recent`: corridas recientes.
- `GET /api/runs/:id`: detalle y vueltas.

## MCP opcional

Desactivado por defecto. Para habilitarlo, usar `MCP_ENABLED=true`, una `BASE_URL` HTTPS y una clave nueva en `MCP_API_KEY`. El cliente debe enviar `Authorization: Bearer TU_MCP_API_KEY` a `BASE_URL/mcp`. No usar la clave interna API_KEY como clave del cliente.

MCP expone cuatro herramientas de solo lectura y elimina algunos campos de ubicación. Sigue devolviendo métricas deportivas personales; no es contenido público ni anónimo. Un cliente MCP debe permitir configurar el encabezado Bearer; esta plantilla no incluye un servidor OAuth para el cliente MCP.

## Alcance y precauciones

- Una sola cuenta por despliegue: los tokens se almacenan con `id=1`. Otra autorización los sustituye. No es un backend multiusuario.
- Las rutas de conexión OAuth no son un portal multiusuario: restringir acceso al despliegue al conectar la cuenta. La plantilla heredada no incluye validación OAuth state ni una sesión de administrador; se deben incorporar antes de ofrecer conexiones a terceros.
- No copiar la base ni los valores de entorno de otra persona.
- El archivo .env, tokens, respaldos SQL y node_modules quedan excluidos del repositorio.
- La configuración de TLS de PostgreSQL se conserva del proyecto original; revisar validación de certificados según el proveedor antes de producción.
- Los textos de privacidad son una base y deben adaptarse al uso real.
- No incluye despliegue automático ni acceso al servicio original.

## Verificar

`npm test` ejecuta pruebas con datos simulados. No consulta cuentas reales de Strava.

## Instructivo de consultas

Leé **[docs/API.md](docs/API.md)**: incluye el mapa de endpoints, ejemplos cURL/Postman, diferencias entre parciales y vueltas, unidades de cada campo, herramientas MCP y resolución de errores.

### Inicio rápido

```bash
git clone https://github.com/aguerrero9800/strava-api-starter.git
cd strava-api-starter
npm ci
cp .env.example .env
# Completar .env con credenciales propias antes de iniciar
npm start
```

En Windows podés copiar `.env.example` como `.env` desde el explorador o con PowerShell: `Copy-Item .env.example .env`.

Para un despliegue Node: comando de instalación `npm ci`, inicio `npm start`; definir las variables en el panel del proveedor, sin subir .env. Cada persona debe usar su propia base PostgreSQL y conectar su propia cuenta Strava. No reutilizar la URL ni las claves de otra instalación.
