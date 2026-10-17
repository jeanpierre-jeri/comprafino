# Prompt 04A: entorno aislado de Vercel

Estado al 16 de octubre de 2026: **ejecución remota aplazada por decisión del responsable del proyecto, dado el bajo uso actual**. Se conserva la preparación local; **no se han creado recursos remotos ni se ha desplegado este kit**. La inspección del hosting y los criterios para retomar el trabajo están en el [reporte de 04A](history/hosting-request-budgets-2026-10-16.md#decisión-posterior-verificación-remota-aplazada). Las pruebas remotas de carga, cancelación del servidor, timeout SQL y recuperación de escrituras siguen sin verificar.

Los pasos de publicación y limpieza siguientes se conservan como referencia futura. No ejecutarlos ni aprovisionar servicios mientras el trabajo siga aplazado. Al retomarlo, revisar commit, adaptadores, cuotas y estimaciones; generar credenciales nuevas únicamente para el entorno aislado.

## Qué contiene la preparación

Las herramientas se agrupan por propósito: `scripts/hosting/` prepara la copia, `packages/db/src/testing/hosting/` gestiona configuración y datos sintéticos, y `apps/web/testing/hosting/` contiene el cliente HTTP. Ver el [mapa y orden de lectura](README.md#leer-el-kit-04a-sin-recorrer-todos-sus-archivos). Las copias exportadas antes de esta organización conservan sus rutas originales.

`pnpm exec node scripts/hosting/prepare.mjs COMMIT_COMPLETO` exporta exclusivamente un commit revisado con `git archive`, en `.artifacts/hosting-04a/RUN_ID/source`. No copia `.env`, credenciales, archivos sin seguimiento ni cambios sin commit. Produce `plan.json` con el commit, identificador aleatorio, nombres propuestos y hashes SHA-256 de cada archivo añadido o adaptado. No invoca Vercel ni Neon.

Se preparó el commit `969a6f773e673e9093a8796be6bd3f2772b3c64f`, que corresponde al despliegue inspeccionado. Durante el trabajo apareció el commit local posterior `6172047`; no se incluyó silenciosamente. Para validar otra revisión debe generarse otro kit y revisar los adaptadores.

Solo la copia exportada recibe:

- Un adaptador de conexión con el transporte HTTP real de Neon y los mismos presupuestos, pero con un esquema aleatorio propio en una base separada. La selección de esquema añade un `set_config` dentro de cada transacción; debe anotarse este pequeño coste adicional al comparar con producción. No se modifica ninguna consulta de comparación.
- Un proxy de acceso con secreto nuevo de al menos 32 caracteres, expiración de hasta 12 horas y prohibición de usar la configuración de producción. Todas las rutas quedan protegidas. OAuth queda deshabilitado en esta copia; no requiere credenciales de Google reales.
- Un endpoint protegido `/api/hosting-test` para verificar run, commit, esquema y número de productos antes de generar carga. No permite sembrar datos, ejecutar SQL, provocar fallos ni cambiar límites.
- `apps/web/vercel.json` con Fluid Compute y región `iad1`. Conserva los máximos declarados en las rutas y no activa `supportsCancellation`.

El repositorio principal recibe herramientas de prueba, no esos cambios de ejecución. El único ajuste al generador existente de fixtures es reducir su tipo de entrada a los campos `db` y `scoped`; sus datos y operaciones no cambian.

## Recursos propuestos, todavía no creados

| Recurso                                                | Configuración inicial                                                                                                          | Motivo                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Un proyecto Vercel `comprafino-04a-PREFIJO_RUN`        | Misma cuenta, Node 24, raíz `apps/web`, monorepo accesible, Fluid, `iad1`, 2 GB/1 vCPU; sin vincular Git ni dominio productivo | Aislar configuración, credenciales y publicaciones accidentales     |
| Un proyecto Neon vacío de pruebas                      | Región y capacidad registradas; suspender al estar inactivo; sin integración automática con producción                         | Separar compute y datos, no solo un esquema dentro de la base real  |
| Base `comprafino_hosting_PREFIJO_RUN` y rol exclusivos | URL directa TLS, sin permisos sobre proyectos reales                                                                           | Evitar reutilizar `neondb` o la URL de la aplicación                |
| Un esquema aleatorio y su marca de propiedad           | Creado por el CLI, migraciones del commit, 80 plantillas iniciales ampliadas a 2.000/10.000/50.000                             | Reutilizar las fixtures y reglas anteriores                         |
| Un despliegue Preview inicial                          | Acceso autenticado; secreto de prueba y, solo si se autoriza, credencial de automatización del proyecto de pruebas             | Medir Vercel y Neon reales conservando protección                   |
| Segundo despliegue, opcional                           | Únicamente si se aprueba una variante de cancelación acotada                                                                   | Comparar contra la configuración original, sin modificar producción |

No hacen falta Redis, colas, cron, servicios de scraping ni una copia de datos reales. Una rama Neon derivada de producción copiaría datos y no es la propuesta. El nombre de una base por sí solo no acredita aislamiento: hay que registrar el ID del proyecto Neon nuevo y comprobar su relación con el endpoint antes de aprobar la conexión.

## Consumo y límites de ejecución

El ejecutor conserva los 12 escenarios de búsqueda y 8 de canasta de 03E. Valida IDs, orden dentro de grupos comparables, precios ordinarios/condicionales, paginación y las decisiones completas de canastas. Reutiliza `catalog-http-validation.ts`; un HTTP 200 con HTML incompleto falla. Las referencias se calculan mediante los lectores originales sobre las mismas fixtures. No se descargan imágenes ni se consulta a tiendas.

| Ejecución                                                                   | Solicitudes, incluyendo calentamiento e identidad |
| --------------------------------------------------------------------------- | ------------------------------------------------: |
| `smoke`, una escala                                                         |                                               109 |
| `matrix`, una escala: 20 muestras por escenario y por escenario concurrente |                                               553 |
| `matrix`, las tres escalas                                                  |                                             1.659 |
| `stability`, solo 50.000: 100 mixtas y 100 genéricas, en tandas de 4        |                                               217 |
| `cancel`, una escala: 2 abortos y 2 recuperaciones                          |                                                 5 |
| Una smoke + matrices + estabilidad + cancelación en las tres escalas        |                                         **2.000** |

Máximo cuatro solicitudes simultáneas, 800 por invocación del CLI, 20 minutos de generación de carga, 40 segundos por solicitud, 2 MiB por respuesta y 100 MiB transferidos por ejecución. Una solicitud o una tanda en curso puede terminar después del límite temporal; no son un tope de facturación del proveedor. No hay reintentos automáticos; una tanda fallida termina antes de iniciar otra. Conservar todas las líneas de evidencia, incluyendo fallos y calentamientos. El archivo final solo incluye p95 cuando hay al menos 20 muestras.

La antigüedad máxima de las fixtures para ejecutar HTTP es una hora y no se permite cruzar el día UTC ni el día de Lima: el código desplegado usa su reloj real. Si caducan, cerrar el ciclo, limpiar el esquema y sembrar nuevamente; no cambiar frescura ni relojes del dominio para forzar una coincidencia. Crear referencias consume también consultas a Neon y no forma parte de la latencia HTTP.

Estimación de planificación, no factura ni rendimiento observado:

- Para unas 2.000 solicitudes y 1–10 segundos medios: 2.000–20.000 segundos de función acumulados. Con 2 GB, el cálculo conservador sin compartir instancias es **1,11–11,11 GB-h**. Fluid puede compartir memoria facturada entre solicitudes coincidentes; no se obtiene el coste multiplicando el RSS del log.
- Si la CPU activa media fuese 0,1–1 segundo por solicitud: **0,056–0,556 horas CPU**. Es una hipótesis a contrastar con Usage, no la duración de pared. Incluye aparte el proxy y endpoint de control; prever margen, y detener al acercarse al presupuesto aprobado.
- Con respuestas medias de 20–150 KiB, el cliente recibiría aproximadamente **39–293 MiB**. El tope de 100 MiB de cada ejecución puede detener una matriz si sus respuestas son mayores. La transferencia Neon, las lecturas de referencia, los builds y el almacenamiento se contabilizan aparte.
- Ventana propuesta: una sesión de hasta dos horas con compute Neon fijo o máximo de 1 CU durante el primer ensayo; presupuestar **hasta 2 CU-h** si permanece activo toda la sesión. Si no soporta los límites, registrar el fallo y proponer otra capacidad, no escalar silenciosamente. Las cifras locales no garantizan capacidad de ese compute.
- Máximo dos builds remotos inicialmente, uno por variante aprobada. Sin una medición previa de ese build no se fija un número ficticio de minutos.

La documentación consultada indica para Vercel Hobby 4 horas de CPU activa, 360 GB-h y un millón de invocaciones mensuales; son cuotas compartidas del equipo, no nuevas cuotas por crear un proyecto. Ver [uso y precios de Functions](https://vercel.com/docs/functions/usage-and-pricing). Neon anuncia 100 CU-h y 1 GB de almacenamiento por proyecto Free; Launch publica 0,106 USD/CU-h y 0,35 USD/GB-mes. Por ejemplo, 2 CU-h a esa tarifa son 0,212 USD de compute, **no el coste total ni una promesa de gratuidad**. Revisar condiciones, límites disponibles, historia, transferencia y plan antes de crear recursos: [precios de Neon](https://neon.com/pricing).

El ensayo local de almacenamiento se registra en el reporte de 04A. El tamaño SQL local no incluye WAL, historial del proveedor, almacenamiento del despliegue ni diferencias de índices/bloat en Neon. Reservar margen y comprobar el consumo remoto a 2.000 y 10.000 antes de subir a 50.000. No contratar ni ampliar planes sin una decisión explícita.

## Publicación futura, después de aprobar recursos y consumo

Estos pasos son un procedimiento pendiente, no comandos ejecutados contra la nube.

1. Revisar `plan.json`, los adaptadores y el commit. Mantener el directorio exportado como raíz del monorepo. No publicar desde el checkout principal. Verificar que `.vercel/project.json`, cuando exista, contiene el ID del proyecto nuevo y nunca `prj_Mxem9c1J6AFyLgWrJg6sAzHL6cF3`.
2. Crear el proyecto Neon vacío y su base/rol con los nombres del plan. Registrar IDs, región, capacidad y cuotas. Mantener la URL fuera de `source/`, en un archivo local de modo 600. Completar `environment.example`; no copiar el `.env` productivo. La herramienta rechaza `DATABASE_URL`, bases con otro nombre, hosts no declarados, URL sin TLS, parámetros inesperados y falta de `HOSTING_TEST_REMOTE_APPROVED=RUN_ID`.
3. En la **base nueva de pruebas**, el administrador debe habilitar `pg_trgm` en `public` (el mismo requisito de `packages/db/testing/init.sql`): `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`. Las migraciones aisladas omiten la creación global de extensiones; no ejecutar este paso contra producción. Dar al rol de fixtures permiso para crear su esquema. Desde `source/`, instalar con `pnpm install --frozen-lockfile`. Usar Node 24 y pnpm 12.8.1. Para comandos con secretos usar `pnpm exec node --env-file=/RUTA/PRIVADA/test.env ...`; no incluir URLs o tokens como argumentos ni pegarlos en el chat. `test.env` no es un script para ejecutar con `source`.
4. Sembrar y ampliar inicialmente a 2.000. Reemplazar las rutas ilustrativas siguientes por las del kit, manteniendo manifiestos y resultados fuera de `source/`:

   ```sh
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env packages/db/src/testing/hosting/fixture-cli.ts seed /RUTA/PRIVADA/state.json COMMIT_COMPLETO
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env packages/db/src/testing/hosting/fixture-cli.ts scale /RUTA/PRIVADA/state.json 2000
   ```

   Copiar el `schema` generado a `HOSTING_TEST_SCHEMA`. No inventar ni reutilizar esquemas. El CLI persiste la propiedad antes de la siembra larga. Si `seed` falla antes de crear la marca, su archivo reservado puede quedar vacío; no asumir que contiene propiedad válida. Si una ampliación falla, no reintentar sobre datos parciales: inspeccionar, limpiar por propietario y empezar otro ciclo.

5. Crear y vincular exclusivamente el proyecto Vercel de pruebas. Configurar raíz `apps/web`, acceso a paquetes fuera de esa raíz, Node 24, Fluid y memoria estándar. Conservar Deployment Protection. Usar una versión revisada y fijada del CLI mediante `pnpm dlx vercel@VERSION_REVISADA`; comprobar su ayuda antes de ejecutar `link` y `deploy`. La versión se debe elegir al publicar, no se instala globalmente. Ejecutar el despliegue Preview desde `source/`; no usar `--prod` ni `promote`. No habilitar Git auto-deploy.
6. Configurar las variables de `environment.example` en **Preview del proyecto nuevo**, excluyendo las variables marcadas como solo runner/limpieza. Generar secretos nuevos; no usar los ejemplos literales. La expiración debe quedar dentro de 12 horas al hacer las pruebas. Si Deployment Protection impide automatización, aprobar un mecanismo oficial limitado al nuevo proyecto; no desactivar la protección ni reutilizar accesos de producción.
7. Registrar la URL inmutable de ese despliegue en `HOSTING_TEST_ORIGIN`, el ID del proyecto y del deployment. El runner exige el prefijo del run y verifica además la identidad respondida por la aplicación. Actualizar `BETTER_AUTH_URL` al origen de pruebas; no registrar OAuth real. Revisar logs antes de aumentar carga.
8. Generar referencias y hacer la prueba mínima. Los siguientes comandos parten de la raíz `source/` y cargan sus paquetes del mismo commit:

   ```sh
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env apps/web/testing/hosting/http-cli.ts references /RUTA/PRIVADA/state.json /RUTA/PRIVADA/2000-references.json
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env apps/web/testing/hosting/http-cli.ts run /RUTA/PRIVADA/2000-references.json /RUTA/PRIVADA/2000-smoke.jsonl smoke
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env apps/web/testing/hosting/http-cli.ts run /RUTA/PRIVADA/2000-references.json /RUTA/PRIVADA/2000-matrix.jsonl matrix
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env apps/web/testing/hosting/http-cli.ts run /RUTA/PRIVADA/2000-references.json /RUTA/PRIVADA/2000-cancel.jsonl cancel
   ```

9. Detenerse ante discrepancias, SQLSTATE, errores de `after()`, límites o consumo inesperado. Esperar a que terminen las funciones y SQL del ensayo antes de ampliar. Ejecutar `scale ... 10000`, regenerar referencias y repetir matriz/cancelación con nuevos archivos; después hacer lo mismo con 50.000 y ejecutar `stability`. No ampliar mientras haya peticiones activas. Los archivos no se sobrescriben.
10. Guardar logs de Vercel correlacionados con `x-benchmark-id`/`x-vercel-id`, tiempo de función, máximo, memoria provisionada, errores, tareas posteriores, versión y snapshot de Usage antes/después. Las respuestas HTTP no incluyen telemetría de SQL ni garantizan que `after()` haya acabado. Completar la aceptación descrita a continuación antes de dar 04A por terminado.

## Cancelación y recuperación: qué queda por demostrar

El modo `cancel` aborta en el cliente a los 100 ms, espera 35 segundos y valida una lectura posterior. Distingue una respuesta que acabó antes del aborto. **No acredita que Vercel propagó la desconexión ni que PostgreSQL canceló el SQL**. `serverCancellationVerified` permanece `false` por diseño.

Para la aceptación remota debe añadirse evidencia del servidor y de la base aislada:

- Comprobar si el artefacto de función efectivo declara `supportsCancellation`; la pantalla Functions no muestra ese valor. Si no puede inspeccionarse, registrar la limitación. En una variante aprobada, habilitarlo solo para evaluación/lecturas seleccionadas después de revisar la ruta compilada. No aplicar un comodín a sync ni al trabajo `after()`.
- Provocar una espera SQL controlada mediante una transacción de bloqueo en una tabla del esquema propio, desde una conexión de administración de la base de pruebas. El controlador debe tener su propio límite y liberarse en `finally`. Verificar SQLSTATE 57014, tiempos y ausencia de consultas residuales en `pg_stat_activity` antes de continuar. Este controlador no está implementado en el kit; no se expone una ruta pública de fallos.
- Para sync, provisionar usuario y sesión sintéticos mediante las fixtures de autenticación existentes, sin OAuth real; registrar revisión anterior, provocar pérdida de respuesta tras entrar en mutación y recuperar mediante GET. Aceptar exclusivamente una revisión autoritativa, sin reenvío automático ni pérdida de lista. Esta prueba no está cubierta por la matriz de búsqueda/evaluación y sigue pendiente de preparación específica antes de ejecutarse.
- Verificar cuatro solicitudes simultáneas a 50.000 sin errores de memoria compartida, sin resultados parciales y sin errores de tareas posteriores. Un smoke o un estado 200 aislado no sustituye esta prueba.

No se recomienda subir los presupuestos con las cinco muestras de producción. Evaluar primero la distancia real entre Vercel y Neon, el arranque en frío, CPU y SQL bajo el compute elegido. La URL regional del endpoint HTTP de Neon no confirma por sí sola la región del compute.

## Limpieza futura

1. Detener runner y cualquier proceso de siembra. Revocar el acceso de prueba o retirar los deployments de pruebas para que no entren nuevas peticiones; esperar al menos el máximo de función y comprobar que no queda SQL del esquema. La expiración del secreto solo bloquea nuevas entradas; no cancela trabajo ya iniciado.
2. Exportar resultados y evidencia sin secretos. Registrar tamaño, conteos, errores y consumo final antes de borrar.
3. Establecer `HOSTING_TEST_STOPPED=RUN_ID` únicamente después del paso anterior y ejecutar, desde `source/`:

   ```sh
   pnpm exec node --env-file=/RUTA/PRIVADA/test.env packages/db/src/testing/hosting/fixture-cli.ts clean /RUTA/PRIVADA/state.json
   ```

   El CLI valida URL, hash de destino, formato de esquema, run y marca de propiedad antes de `DROP SCHEMA`. Solo elimina ese esquema; no elimina `public`, una base completa ni un proyecto. Conservar el manifiesto como evidencia y comprobar que `inspect` ya no puede abrir el esquema.

4. Tras confirmar que los IDs son los del ensayo, eliminar los deployments/proyecto Vercel y la base/proyecto Neon creados para él, mediante una acción expresamente autorizada. Revocar sus secretos. No borrar proyectos compartidos ni recursos preexistentes. Comprobar después que no quedan recursos activos ni nuevos cargos pendientes.
5. Retirar el archivo de secretos local. Conservar únicamente reportes y plan sin credenciales; la carpeta `.artifacts` está ignorada por Git. No eliminar otras carpetas o bases de pruebas que pertenezcan a trabajos distintos.

## Verificación local reproducible

Los siguientes comandos son locales. La prueba de integración exige configuración explícita; la versión normal usa 2.000 registros y el ensayo completo se activa con `HOSTING_TEST_FULL_REHEARSAL=1`.

```sh
pnpm --filter @comprafino/db exec vitest run src/testing/hosting/config.test.ts
pnpm test:db:up
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local HOSTING_TEST_FULL_REHEARSAL=1 pnpm --filter @comprafino/db exec vitest run src/testing/hosting/fixtures.integration.test.ts
```

Para comprobar la copia exportada, instalar sus dependencias y compilar primero desde `source/`. En esta sesión Turbopack no pudo abrir un puerto local; se verificó `NEXT_TELEMETRY_DISABLED=1 CI=1 pnpm --filter @comprafino/web exec next build --webpack` sobre una copia idéntica fuera del árbol del repositorio, porque el recorrido de archivos dentro de `.artifacts` anidado era muy lento. Los doce hashes de los adaptadores coincidieron y el build se trasladó al kit para probarlo. La publicación futura conserva el build configurado del proyecto y requiere comprobar sus logs; no se cambió el bundler remoto. Desde el checkout principal ejecutar luego:

```sh
pnpm exec node scripts/hosting/verify-local.mjs /RUTA/AL/KIT
```

Ese smoke usa Chromium, un servidor loopback y secretos desechables. Comprueba rechazo sin credencial o con credencial incorrecta, portada y validación de búsqueda con credencial correcta, OAuth deshabilitado y fallo del marcador sin fixtures. El servidor tiene `fetch` externo bloqueado y el navegador solo permite su origen local. No mide Neon ni prueba cancelación de Vercel.
