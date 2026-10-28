# Guía de consultas y respuestas

Esta API es un puente de lectura entre una cuenta de Strava y un cliente propio. Convierte algunas unidades y resume respuestas; no calcula planes, pronósticos, zonas ni PR.

## Autenticación

Las rutas `/api/*` requieren `Authorization: Bearer TU_API_KEY`. Esa clave es la que definís en tu servidor, no el token de Strava. Los tokens de Strava permanecen en PostgreSQL y se renuevan cuando hace falta.

Ejemplos para Bash/macOS/Linux (Postman puede usar las mismas URL con Authorization → Bearer Token):

```bash
BASE_URL='http://localhost:3000'
read -r -s -p 'API key: ' RUNNING_API_KEY
printf '\n'
export RUNNING_API_KEY
curl --fail-with-body "$BASE_URL/api/runs/latest" \
  -H "Authorization: Bearer $RUNNING_API_KEY"
```

La variable evita escribir la clave literalmente en el historial de comandos, pero no debe compartirse ni mostrarse en capturas. No usar la consola pública ni logs para imprimir secretos.

## Qué consulta elegir

| Método y ruta | Para qué sirve | Qué devuelve / límite |
|---|---|---|
| `GET /` | Comprobar que el servidor responde | Nombre del servicio, estado y enlace de conexión a Strava; no comprueba por sí solo la base ni la autorización |
| `GET /privacy` | Ver el texto de privacidad de referencia | HTML; adaptarlo antes de distribuir el servicio |
| `GET /strava/login` | Autorizar tu cuenta | Redirección al consentimiento de Strava; abrir en navegador, no usar como consulta de actividades |
| `GET /strava/callback` | Completar OAuth | Recibe `code`, intercambia credenciales y guarda tokens; lo usa Strava, no es una ruta para consultar manualmente |
| `GET /api/activities` | Revisar las actividades más recientes de cualquier tipo | Array de hasta 10 actividades; incluye fuerza si aparece en esa ventana, pero sin análisis especializado de fuerza |
| `GET /api/runs/latest` | Resumen rápido de la última corrida | Busca el primer `type: Run` entre las 30 actividades más recientes |
| `GET /api/runs/latest/detail` | Ver el resumen y parciales de la última corrida | Busca entre 30 actividades y después consulta el detalle; devuelve `summary` y `splits` normalizados |
| `GET /api/runs/recent` | Comparar corridas recientes | Hasta 10 corridas `Run` entre las 50 actividades más recientes |
| `GET /api/runs/:id` | Consultar una actividad concreta y sus vueltas | Detalle por ID, `splits` y `laps` originales; pese al nombre de la ruta no valida que la actividad sea running |

No hay paginación configurable, filtros por fechas ni historial completo implementados. No agregar `?per_page=100` esperando ampliar estas ventanas: el servidor no usa ese parámetro. La búsqueda de running filtra `type === Run`, sin lógica adicional por `sport_type`.

## Ejemplos de consultas

```bash
# Todas las actividades recientes (hasta 10)
curl --fail-with-body "$BASE_URL/api/activities" -H "Authorization: Bearer $RUNNING_API_KEY"

# Última corrida resumida
curl --fail-with-body "$BASE_URL/api/runs/latest" -H "Authorization: Bearer $RUNNING_API_KEY"

# Última corrida con parciales
curl --fail-with-body "$BASE_URL/api/runs/latest/detail" -H "Authorization: Bearer $RUNNING_API_KEY"

# Hasta 10 corridas recientes
curl --fail-with-body "$BASE_URL/api/runs/recent" -H "Authorization: Bearer $RUNNING_API_KEY"

# Reemplazar 123456789 por un ID real recibido de las consultas anteriores
curl --fail-with-body "$BASE_URL/api/runs/123456789" -H "Authorization: Bearer $RUNNING_API_KEY"
```

Para analizar series: consultar `latest/detail`, obtener el `id`, pedir `/api/runs/ID` y mirar `laps`. Los parciales kilométricos no equivalen a las repeticiones de 400/800/1000 metros del entrenamiento.

## Respuesta ilustrativa de `/api/runs/latest`

Datos inventados solo para explicar el formato:

```json
{
  "id": 123456789,
  "name": "Rodaje de ejemplo",
  "date": "2026-10-28T07:30:00Z",
  "distance_km": 8,
  "moving_time_minutes": 48,
  "pace": "6:00/km",
  "avg_hr": 142,
  "max_hr": 158,
  "elevation_gain_m": 25
}
```

## Diccionario de campos normalizados

No todas las rutas incluyen todos los campos.

| Campo | Unidad / significado | Observación |
|---|---|---|
| `id` | Identificador de actividad en Strava | No es la posición en el listado. MCP lo pide como cadena para conservar precisión |
| `name` | Título de la actividad | Es texto personal del atleta |
| `date` | `start_date_local` de Strava | Tratar como fecha/hora local de la actividad; no aplicar una segunda conversión de zona solo por su representación con Z |
| `type` | Tipo de actividad recibido de Strava | Por ejemplo Run o WeightTraining; solo algunas rutas lo incluyen |
| `distance_km` | Kilómetros | Distancia en metros dividida entre 1000, redondeada a dos decimales |
| `moving_time_minutes` | Minutos en movimiento | Redondeados a un decimal; no es HH:MM ni el tiempo transcurrido total |
| `moving_time_seconds` | Segundos en movimiento | Incluido en detalle y en `summary`; 3000 equivale a 50 minutos |
| `elapsed_time_seconds` | Segundos transcurridos | Incluye el tiempo total de la actividad, con detenciones |
| `pace` | Ritmo promedio min:seg/km | Calculado con tiempo en movimiento y distancia; valor menor significa más rápido. Si no hay distancia es null |
| `avg_hr` | Frecuencia cardíaca media, latidos/minuto | null si no está disponible; no confundir con una zona de FC |
| `max_hr` | Frecuencia cardíaca máxima, latidos/minuto | null si no está disponible |
| `elevation_gain_m` | Desnivel positivo acumulado, metros | No es altitud máxima ni diferencia entre inicio y final |
| `calories` | Kilocalorías informadas por Strava | Estimación del proveedor; puede faltar |
| `suffer_score` | Métrica de esfuerzo recibida de Strava | Se transmite sin recalcular ni interpretar; puede ser null, no equivale a RPE declarado por el atleta |
| `summary` | Objeto de resumen en `latest/detail` | Ahí están sus métricas globales; en `/api/runs/:id` están en la raíz |
| `splits` | Array de parciales | Su formato cambia según la ruta; ver debajo |
| `laps` | Array de vueltas originales | Solo en detalle por ID; pueden representar repeticiones, recuperaciones o autolaps según el reloj |

`null` indica dato no disponible. No reemplazarlo por cero ni inferir pulsaciones, calorías o esfuerzo. Si la distancia es cero, no hay ritmo válido. El formateador actual redondea segundos de forma independiente y en ciertos límites puede mostrar `5:60/km`; es una limitación heredada, no un ritmo fisiológico distinto.

## Parciales normalizados: `/api/runs/latest/detail`

| Campo dentro de `splits[]` | Significado |
|---|---|
| `km` | Número de parcial (`split` de Strava); el último puede ser fracción de kilómetro |
| `distance_km` | Distancia de ese parcial en kilómetros |
| `moving_time_seconds` | Tiempo en movimiento de ese parcial |
| `pace` | Ritmo de ese parcial calculado por la API |
| `elevation_difference_m` | Diferencia de elevación del parcial, en metros; puede ser negativa |
| `avg_speed_mps` | Velocidad media en metros/segundo |
| `grade_adjusted_speed_mps` | Velocidad ajustada por pendiente, en metros/segundo, si está disponible |

La velocidad ajustada por pendiente no es ritmo: si se desea convertirla, el ritmo en segundos/km es `1000 / velocidad_mps`, solo para velocidad mayor que cero.

## Parciales y vueltas originales: `/api/runs/:id`

Esta ruta conserva `activity.splits_metric` como `splits` y `activity.laps` como `laps`, sin normalizar unidades ni eliminar sus campos adicionales.

- `distance`: metros, no kilómetros.
- `moving_time` y `elapsed_time`: segundos.
- `average_speed` / `max_speed`, cuando estén presentes: metros/segundo.
- `average_heartrate` / `max_heartrate`, cuando estén presentes: latidos/minuto.
- `lap_index`, `split`, `name`, `start_index`, `end_index`: metadatos originales según el objeto disponible.

Leer la referencia de Strava para la lista completa. Los objetos originales pueden incluir información personal adicional. El filtro recursivo de ubicaciones se aplica en MCP, no en estas respuestas REST.

## Errores y diagnóstico

| HTTP | Significado en esta implementación | Qué revisar |
|---|---|---|
| 401 en `/api/*` | Falta encabezado Authorization | Agregar Bearer con la API_KEY del servidor |
| 403 en `/api/*` | Clave incorrecta o formato inválido | No usar el token de Strava ni MCP_API_KEY |
| 404 en `latest` o `latest/detail` | No se encontró un Run en las últimas 30 actividades | Ver actividades y ventana de búsqueda |
| 404 en otra ruta | Ruta inexistente de Express, según URL | Revisar método y ruta |
| 500 en rutas de actividad | Fallo de conexión, permisos, tokens, ID o proveedor | Revisar autorización, PostgreSQL y logs del servidor; se oculta el detalle al cliente |
| 401 en `/mcp` | MCP_API_KEY ausente o incorrecta | Configurar el encabezado Bearer del cliente MCP |
| 405 en `/mcp` | Método de transporte no admitido | Esta implementación usa POST |

Los errores de Strava, incluso rate limits o actividad inaccesible, no se propagan con su mismo código HTTP: normalmente se convierten en 500. El servicio no implementa reintentos ni caché de actividades. Evitar consultar en bucle.

## MCP opcional

La URL es `BASE_URL/mcp`, con HTTPS si se habilita. Exige una clave distinta de API_KEY en `MCP_API_KEY`. No es una integración OAuth completa para clientes MCP.

| Herramienta | REST interno | Argumentos |
|---|---|---|
| `getLatestRun` | `/api/runs/latest` | `{}` |
| `getLatestRunDetail` | `/api/runs/latest/detail` | `{}` |
| `getRecentRuns` | `/api/runs/recent` | `{}` |
| `getRunById` | `/api/runs/:id` | `{"id":"123456789"}` |

Ejemplo de configuración conceptual para clientes que soporten headers Bearer (adaptar nombres al cliente):

```json
{
  "url": "https://tu-dominio.example/mcp",
  "headers": {
    "Authorization": "Bearer TU_MCP_API_KEY"
  }
}
```

El cliente debe inicializar la sesión MCP antes de invocar herramientas. No basta con abrir `/mcp` en el navegador. MCP filtra campos de ubicación y mapas conocidos, pero títulos, fechas, pulsaciones y otras métricas siguen siendo personales. La salida no es anónima.

## Fuentes y alcance

Las rutas, límites y transformaciones descritos se verificaron contra `server.js` y `mcp.js` de esta plantilla. Unidades y OAuth de Strava:

- https://developers.strava.com/docs/reference/
- https://developers.strava.com/docs/authentication/

Última revisión de esta guía: 28/10/2026. Las respuestas dependen de los datos disponibles y permisos concedidos.
