# Prompt 04A — Inspección de los presupuestos en el hosting

Fecha: **16 de octubre de 2026**. Inspección pública aproximadamente 15:00–15:05 en Lima; comprobación posterior mediante la conexión Vercel aproximadamente 15:09. Continuación del [prompt 04](public-request-budgets-2026-10-16.md).

## Decisión posterior: verificación remota aplazada

**El 16 de octubre de 2026 el responsable del proyecto decidió aplazar 04A porque actualmente tiene muy pocos usuarios.** La inspección de solo lectura y la preparación local quedan documentadas; la aceptación de carga, cancelación y recuperación en el hosting sigue **sin verificar**. No se crearon recursos remotos ni se desplegó el kit. Esta decisión no cambia presupuestos, reglas de comparación ni las pruebas de regresión existentes.

No se considera necesario crear ahora un proyecto Vercel y una base separados para continuar mejorando el producto. El siguiente esfuerzo se destina a frescura y cobertura útil del catálogo, recorrido de compra y conservación de las listas, según la [priorización actual del proyecto](project-review-2026-10-14.md#priorización-actual--16-de-octubre-de-2026). La poca concurrencia reduce la urgencia de esta prueba; no demuestra que una petición costosa sea rápida ni que el hosting cancele su SQL.

Se retomará ante errores o esperas recurrentes, crecimiento relevante del catálogo, una campaña que vaya a aumentar las visitas, o cambios en hosting, transporte o cancelación. Antes de ejecutarlo habrá que revisar cuotas y consumo vigentes, seleccionar el commit que se quiera validar y regenerar el kit: la copia conservada corresponde a `969a6f7`, anterior a los cambios de lista de `6172047`. No reutilizar credenciales caducadas ni presentar las mediciones locales como resultados remotos.

El procedimiento y sus estimaciones se conservan para ese momento; no son una instrucción de publicación ni de creación de recursos ahora. La limpieza local previa quedó verificada y no hay recursos remotos de este ensayo que eliminar.

## Continuación: configuración leída y preparación local

La inspección de solo lectura se completó en la sesión autenticada del navegador. No se guardaron ajustes, no se crearon accesos de automatización ni recursos remotos y no se generó carga sobre producción. El 403 del conector no se considera resuelto: se utilizó el panel como vía alternativa autorizada.

| Control                 | Evidencia visible                                                                              | Implicación                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Functions               | Fluid Compute activado; `iad1`; Standard 1 vCPU / 2 GB                                         | Reproducir estos valores en el entorno aislado                                                                    |
| Duración predeterminada | Campo vacío, placeholder 300 s                                                                 | No es un valor personalizado guardado; los logs sí confirman los máximos por ruta de 20/30/35 s                   |
| Cancelación             | No hay control de `supportsCancellation` en esa pantalla; el commit no lo declara              | El valor efectivo del artefacto no está demostrado; tampoco la propagación de desconexión                         |
| Firewall                | Sin reglas personalizadas, sin bloqueos IP ni system bypass; Bot Protection Off; AI Bots Allow | No hay un limitador personalizado visible para las rutas públicas; la mitigación DDoS administrada sigue presente |
| Deployment Protection   | Vercel Authentication activada, Standard Protection; sin secretos de automatización            | Conservar protección; cualquier credencial futura debe pertenecer solo al proyecto de pruebas                     |
| Facturación             | Hobby Active; Spend Management: No team budget; Add Budget deshabilitado y reservado a Pro     | No hay un tope monetario configurado demostrado; las cuotas y límites propios deben revisarse antes de publicar   |

Fuentes de la cuenta: [Functions](https://vercel.com/jeanpierrejeris-projects/comprafino/settings/functions), [Firewall](https://vercel.com/jeanpierrejeris-projects/comprafino/firewall/rules), [Deployment Protection](https://vercel.com/jeanpierrejeris-projects/comprafino/settings/deployment-protection) y [Billing](https://vercel.com/jeanpierrejeris-projects/~/settings/billing). BotID mostraba la invitación a instalar el paquete; no se tomó la opción Basic visible como prueba de una integración activa.

### Consumo observado, no atribuido al nuevo despliegue

La ventana visible fue **16 de septiembre, 2 pm, a 16 de octubre, 2 pm**, Last 30 Days. Acaba antes del despliegue inspeccionado de esa tarde. No representa el coste del prompt 04 ni el saldo contractual exacto del siguiente ensayo.

| Métrica                  | Proyecto comprafino | Todos los proyectos del equipo |
| ------------------------ | ------------------: | -----------------------------: |
| Fast Data Transfer       |            59,68 MB |                        74,3 MB |
| Fast Origin Transfer     |            20,58 MB |                       30,13 MB |
| CDN Requests             |             6,3 mil |                          8.428 |
| Function Invocations     |             4,2 mil |                        5,1 mil |
| Fluid Active CPU         |          7 min 27 s |                     7 min 27 s |
| Fluid Provisioned Memory |              1 GB-h |                         1 GB-h |
| Build CPU Minutes        |          3 h 10 min |                     3 h 10 min |

La pantalla del equipo muestra 100 GB de transferencia CDN, 10 GB de transferencia de origen y un millón de solicitudes CDN como asignaciones de referencia. Las cifras redondeadas no sirven para calcular una factura exacta. Fuente: [Usage del proyecto](https://vercel.com/jeanpierrejeris-projects/comprafino/usage) y [Usage del equipo](https://vercel.com/jeanpierrejeris-projects/~/usage). La duración heredada de Functions y la memoria Fluid son métricas distintas; no se sumaron como si fueran el mismo concepto.

### Entrega local y aceptación pendiente

El [procedimiento del entorno aislado](../hosting-test-environment.md) especifica recursos, archivos, variables, estimaciones, límites, publicación y limpieza. Incluye un generador local fijado a un commit, fixtures con marca de propiedad y limpieza selectiva, referencias de resultados y cliente HTTP remoto acotado. Reutiliza la matriz y los validadores de 03E. Los adaptadores de ejecución se aplican únicamente a una copia exportada; no a producción ni al checkout de la aplicación.

Se propone un proyecto Vercel separado, un proyecto Neon vacío con base y rol propios, un Preview inicial y como máximo una variante adicional de cancelación si se aprueba. El ciclo descrito genera **2.000 solicitudes HTTP** incluyendo una smoke, tres matrices, estabilidad y abortos/recuperación. La provisión de datos añade consultas y almacenamiento de histórico; no se confunde con solo 50.000 filas en total.

La preparación no cierra la aceptación remota de 04A. Faltan recursos aprobados y publicados, mediciones reales en Vercel/Neon, observación de SQL tras desconexión, timeout SQL controlado, recuperación de sync tras respuesta perdida y estabilidad con cuatro solicitudes a 50.000. El CLI de aborto informa de la cancelación del cliente y una recuperación posterior; no declara cancelación del servidor verificada. Los controladores remotos de bloqueo SQL y de sesión/escritura incierta todavía necesitan preparación específica, descrita en el procedimiento.

Conservar los presupuestos actuales hasta obtener esas mediciones. Evaluar región efectiva de Neon, arranque en frío, límites agregados y una eventual política de frecuencia del WAF con tráfico real. No aumentar los plazos ni habilitar cancelación global basándose en cinco respuestas normales.

### Medición local de almacenamiento y limpieza

El ensayo completo creó un esquema aleatorio propio, aplicó las migraciones, sembró datos sintéticos y creció de 80 a 2.000, 10.000 y 50.000 registros. Terminó en **272,28 segundos**, validó los fingerprints y comprobó que se rechaza un propietario incorrecto o una limpieza sin declaración de parada. Después eliminó exclusivamente su esquema y verificó que ya no podía abrirlo.

| Productos | Estados de precios | Días de observación | Tamaño de tablas e índices del esquema |
| --------- | -----------------: | ------------------: | -------------------------------------: |
| 2.000     |             72.000 |              71.100 |           28.229.632 bytes (26,92 MiB) |
| 10.000    |            360.000 |             355.500 |         131.620.864 bytes (125,52 MiB) |
| 50.000    |          1.800.000 |           1.777.500 |         649.789.440 bytes (619,69 MiB) |

La suma usa `pg_total_relation_size` sobre tablas del esquema, incluyendo índices y TOAST sin contar dos veces los índices. No es almacenamiento facturado por Neon. Para la prueba de 50.000 se recomienda disponer de **al menos 1,5 GB de margen total planificado** y revisar consumo remoto antes de ampliarla; el Free anunciado de 1 GB podría quedar corto con sobrecostes de almacenamiento e histórico, aunque el tamaño SQL local sea inferior. No se contrató un plan.

Un primer ensayo venció a los 180 segundos durante la inserción del histórico. Se identificó su esquema mediante la marca de propiedad, se canceló únicamente su SQL local y se eliminó ese esquema antes de repetir. Se amplió el plazo del test de preparación a 900 segundos; **no se cambió ningún presupuesto de petición pública**. El intento siguiente intermedio falló por una firma de callback incompleta, corregida antes del ensayo exitoso. Estas incidencias no son resultados de rendimiento del hosting.

### Comprobaciones del kit

- Formato, lint, comprobación de referencias de documentación y `git diff --check`: correctos.
- Typecheck: los cinco paquetes correctos; también se comprobó la copia exportada con sus tipos de Next.
- Base de datos: 98 pruebas unitarias correctas, incluidas ocho comprobaciones nuevas de configuración, aislamiento, caducidad y propiedad. Cinco pruebas del validador HTTP correctas.
- Ensayo completo de fixtures: correcto en las tres escalas; limpieza verificada.
- Build de la copia: correcto con **Webpack**, sobre los mismos archivos en una carpeta temporal independiente; compilación en 11,3 s, tipos y generación estática correctos. El build normal con Turbopack quedó bloqueado por `EPERM` al abrir un puerto local. Una compilación previa también detectó un tipo de entorno incompatible con Next, corregido. El recorrido de archivos fue muy lento dentro de `.artifacts` anidado; se verificaron los hashes antes de usar la copia temporal y se trasladó el build exitoso al kit. No se modificó el bundler de producción ni se presenta esto como un build remoto.
- Smoke Chromium: correcto en el kit final. Sin secreto y con secreto incorrecto: 401; portada autorizada: 200; búsqueda demasiado corta: validación visible; OAuth: 403; marcador sin fixtures: 503. El servidor y navegador tenían la red externa bloqueada. El servidor local terminó al finalizar.

Paquete preparado: `.artifacts/hosting-04a/4a1b5e31c8124ad09600c2970c23c711/`. `plan.json` registra doce archivos adaptados con SHA-256 y `verification.json` conserva resultados y limitaciones. El código del dominio corresponde al commit inspeccionado; los cambios posteriores de la lista de compras no se incorporaron a esta línea base.

## Primera continuación posterior al push: acceso por navegador

**El acceso de lectura al panel y a los logs ya funciona mediante la sesión autenticada del navegador.** No fue necesario reconectar el plugin ni modificar permisos o configuración. Esto proporciona una vía para continuar 04A; no demuestra que el error 403 del conector esté corregido. Las consultas anteriores a logs del conector habían seguido fallando, aunque las lecturas del proyecto, despliegue y alias por identificador, sin selector de equipo, sí funcionaban.

La inspección posterior comprobó en el panel que `comprafino.vercel.app` sirve el despliegue `dpl_2cQKYn9Q2Pvk4yptSJe7K4Q78yxY`, en estado **Ready**, de `main` y commit `969a6f773e673e9093a8796be6bd3f2772b3c64f`. Por tanto, la diferencia de versión descrita en la inspección inicial de abajo ya está resuelta. El usuario confirmó haber aplicado la migración 0014; no se consultó el esquema de producción para comprobarlo de forma independiente.

Se abrieron cinco registros existentes del 16 de octubre, entre las 15:22:39 y las 15:28:38 de Lima. No se generaron estas solicitudes como parte de esta inspección ni se repitió una carga de prueba sobre producción.

| Ruta                      | Estado observado | Ejecución de función | Máximo mostrado por Vercel | Respuesta finalizada según el panel |
| ------------------------- | ---------------- | -------------------: | -------------------------: | ----------------------------------: |
| `POST /api/list/evaluate` | 200              |               768 ms |                       20 s |                              906 ms |
| `GET /search`             | 200              |               915 ms |                       30 s |                              938 ms |
| `GET /products/[id]`      | 200; prefetch    |               109 ms |                       35 s |                              292 ms |
| `GET /listings/[id]`      | 200              |                84 ms |                       20 s |                              227 ms |
| `GET /api/list/sync`      | 200              |                63 ms |                       20 s |                              207 ms |

Los cinco máximos coinciden con las declaraciones del prompt 04. Son **muestras individuales de tráfico existente**, no percentiles, pruebas de capacidad ni verificaciones del contenido completo. La lectura de sync no prueba una escritura ni su recuperación. Los estados 200 de páginas renderizadas por streaming tampoco prueban la finalización correcta de todas sus tareas posteriores.

El panel muestra plan **Hobby**, ejecución **Fluid** y funciones en **Washington, D.C. (`iad1`)**, con recepción en São Paulo (`gru1`). En búsqueda y producto aparecen llamadas al endpoint HTTP de Neon `api.c-6.us-east-2.aws.neon.tech/sql`; esto identifica el endpoint observado, sin demostrar por sí solo la ubicación efectiva del compute de la base. El panel ofrece las métricas detalladas de latencia externa mediante una ampliación de plan; no se realizó ninguna ampliación. Los valores mostrados junto a Fluid fueron de 230 a 269 MB en estas muestras y no equivalen al coste facturado ni a una medición de memoria bajo carga concurrente.

En [Deployments filtrado únicamente por Preview](https://vercel.com/jeanpierrejeris-projects/comprafino/deployments?environment=preview), el panel respondió **No Results / No deployments match the current filters**. No se encontró un despliegue Preview en este proyecto. Eso no descarta un entorno en otro proyecto o cuenta, y tampoco confirma que exista una base de pruebas aislada.

### Pendientes registrados en la primera continuación

- Inspeccionar la configuración efectiva de cancelación, las reglas de frecuencia y las protecciones de gasto; el acceso al panel permite continuar esas lecturas. La ausencia de errores en el intervalo visible no sustituye estos controles.
- Disponer de una aplicación de pruebas con base explícita y aislada, equivalente al código publicado. Sin ese entorno siguen pendientes la cancelación, el timeout SQL, la recuperación de escrituras con respuesta perdida y cuatro solicitudes simultáneas con 50.000 registros.
- Adaptar el cliente de benchmark a un destino remoto controlado: el ejecutor actual inicia un servidor local y no admite sustituirlo directamente por una URL de Vercel.

La propuesta para el siguiente trabajo es preparar primero la configuración y el ejecutor revisables para un despliegue de pruebas separado, fijado al commit que se quiera verificar, y una base vacía de pruebas con esquemas aleatorios propios. Debe conservar los límites actuales, usar únicamente datos sintéticos, limitar la concurrencia a cuatro, autenticar el acceso de prueba y excluir las credenciales y los servicios de producción. Los sondeos de fallo deben quedar restringidos a ese entorno. Antes de crear recursos remotos se debe presentar el inventario concreto, el consumo previsto de funciones/base, los límites de ejecución y su limpieza; no se afirma que el coste sea cero. En ese momento la propuesta no estaba implementada; la continuación anterior documenta su preparación local actual. Sigue sin publicarse.

Por ahora se recomienda conservar los presupuestos actuales: cinco ejecuciones normales no justifican cambiarlos. La evidencia resumida de esta continuación está en `.artifacts/hosting-budgets-2026-10-16/browser-access-summary.json`. En esa primera continuación solo se editaron este reporte y su referencia en `docs/request-budgets.md`; no se modificó el código de aplicación ni la configuración remota.

## Resultado de la inspección inicial, anterior al push

**La aceptación remota de los presupuestos queda pendiente.** El último despliegue público registrado en GitHub corresponde a una revisión anterior al prompt 04. Esa revisión no contiene sus cuatro módulos nuevos ni las cinco declaraciones `maxDuration`. La portada pública funciona, pero respondió desde caché y no permite evaluar los nuevos límites.

No se modificó configuración remota, no se publicó una versión, no se accedió a la base de aplicación y no se cambiaron reglas de comparación. La inspección produjo dos hallazgos útiles: hace falta identificar un despliegue que realmente contenga el cambio y hay que revisar la cancelación específica de Vercel, que no se demuestra con el servidor local.

Este reporte distingue **evidencia comprobada**, **aspectos todavía inaccesibles** y **ajustes recomendados**. No presenta las pruebas locales de 04 como resultados del hosting.

## Versión y acceso comprobados

La API pública de GitHub devolvió lo siguiente:

| Dato                            | Resultado                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Revisión de `main`              | `6567774b75522983cec2ccb2ab593c4b405b7dd3`                                                           |
| Último registro de despliegue   | `7004378710`, entorno `Production`                                                                   |
| Estado                          | `success`, actualizado el 12 de octubre a las 01:10:53 UTC; **11 de octubre a las 20:10:53 en Lima** |
| URL del despliegue registrado   | `https://comprafino-3xgqoyj9x-jeanpierrejeris-projects.vercel.app`                                   |
| Consulta de registros `Preview` | Cero resultados                                                                                      |
| Estado local del prompt 04      | Cambios presentes en el árbol de trabajo, posteriores al commit publicado                            |

Fuentes directas: [registros de despliegue](https://api.github.com/repos/jeanpierre-jeri/comprafino/deployments?per_page=5), [estado del último despliegue](https://api.github.com/repos/jeanpierre-jeri/comprafino/deployments/7004378710/statuses), [revisión de main](https://api.github.com/repos/jeanpierre-jeri/comprafino/commits/main) y [registros Preview](https://api.github.com/repos/jeanpierre-jeri/comprafino/deployments?environment=Preview&per_page=5).

La consulta de Preview no demuestra que no exista otro entorno, ni descarta despliegues manuales que no figuren en GitHub. Tampoco se estableció desde el panel qué despliegue está asociado actualmente al alias `comprafino.vercel.app`. Sí se comprobó que **el último despliegue registrado no contiene el prompt 04**: se compararon los archivos del commit exacto con el árbol local.

Los archivos ausentes en ese commit son `apps/web/src/lib/public-request-policy.ts`, `apps/web/src/lib/request-budget.ts`, `apps/web/src/server/public-database.ts` y `packages/db/src/statement-budget.ts`. Su cliente de base solo admite el timeout opcional de transporte; búsqueda utiliza 12 s, mientras que evaluación crea el cliente sin un timeout explícito. Ninguna de las cinco rutas declara el máximo de hosting que añadió 04. Esto describe el código publicado en ese registro; no prueba que el proveedor carezca de límites propios.

En la inspección inicial, el panel de Vercel redirigió al inicio de sesión y todavía no había una conexión autenticada disponible. Tampoco se encontró un proyecto local vinculado a Vercel ni una configuración explícita `TEST_DATABASE_URL`. No se leyeron ni publicaron valores de credenciales.

### Comprobación posterior con Vercel conectado

La integración ya está disponible y permite localizar `comprafino`, proyecto `prj_Mxem9c1J6AFyLgWrJg6sAzHL6cF3`, perteneciente al equipo `team_PghBZ7y7DeGDdfIpkzCMTxEp`. Sin embargo, **la conexión no tiene acceso efectivo a los detalles del proyecto en ese equipo**:

- La consulta de equipos devolvió cero elementos; la búsqueda de proyectos devolvió CompraFino y su equipo propietario.
- Las tres lecturas acotadas al equipo —detalle del proyecto, asociación del dominio y últimos cinco despliegues— devolvieron **HTTP 403 `forbidden`**, con el motivo `Not authorized` para `jeanpierrejeris-projects`.
- No hay CLI Vercel disponible, ni global ni local, con la que comprobar una credencial alternativa existente. No se instalaron herramientas ni se crearon accesos de excepción.

Por tanto, el requisito pendiente ya no es instalar Vercel: es disponer de una conexión con permiso de lectura sobre el equipo propietario. El error no permite concluir si falta seleccionar el equipo al autorizar la conexión, si se conectó otra cuenta o si hay una restricción adicional de permisos. No se promete que reconectar por sí solo lo resuelva. Sigue sin poder comprobarse desde Vercel la versión asociada al dominio, los límites efectivos, el plan o los logs. Esta fase solo hizo cinco consultas de lectura al conector y ninguna petición adicional a la aplicación.

## Qué se midió por HTTP

Se hicieron **dos peticiones a portadas**, sin búsquedas, evaluación de canastas, acceso a cuentas ni llamadas a retailers. Se consultaron además cuatro endpoints públicos de GitHub.

| Destino                                  | Resultado                                                                  | Tiempo hasta cabeceras | Tiempo total | Interpretación                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------- | ---------------------: | -----------: | -------------------------------------------------------------------------- |
| Portada de `comprafino.vercel.app`       | HTTP 200, `server: Vercel`, `x-vercel-cache: HIT`, `x-nextjs-prerender: 1` |              786,59 ms |    786,81 ms | Confirma disponibilidad de una página prerenderizada servida desde caché   |
| Portada del despliegue exacto registrado | HTTP 302 hacia `vercel.com/sso-api`                                        |              536,68 ms |    536,84 ms | El acceso está protegido; no se siguió ni se intentó eludir esa protección |

La portada llevaba `age: 413345`. Su identificador de respuesta comenzaba por `gru1`, pero esa observación de la respuesta CDN **no establece la región donde ejecutan las funciones ni la ubicación de Neon**. Son muestras individuales, no percentiles. No miden arranque en frío, consultas SQL, gastos de ejecución ni duración de tareas posteriores.

## Presupuestos que deben contrastarse con el despliegue

| Frontera                       | Presupuesto local de 04                                                     |            Declaración local para hosting | Estado remoto                                                       |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------: | ------------------------------------------------------------------- |
| Búsqueda                       | 15 s de lectura/procesamiento; fetch 12 s; SQL 10 s                         |                                      30 s | No verificado en runtime; declaración ausente del commit registrado |
| Producto canónico              | 15 s de comparación y 15 s de historial independiente; fetch 12 s; SQL 10 s |                                      35 s | No verificado en runtime; declaración ausente del commit registrado |
| Oferta de una tienda           | 15 s compartidos por detalle e historial; fetch 12 s; SQL 10 s              |                                      20 s | No verificado en runtime; declaración ausente del commit registrado |
| Evaluar canasta                | 15 s del handler; fetch 12 s; SQL 10 s                                      |                                      20 s | No verificado en runtime; declaración ausente del commit registrado |
| Sincronizar lista              | 15 s, incluida autenticación; fetch 12 s; SQL 10 s                          |                                      20 s | No verificado en runtime; declaración ausente del commit registrado |
| Registro posterior de búsqueda | 10 s del callback/fetch; SQL 8 s                                            |                        Dentro de búsqueda | No verificado en runtime                                            |
| Cuerpos y navegador            | 5 s para leer cuerpo dentro del handler; 20 s por solicitud del navegador   | No son opciones independientes de hosting | No verificado en la versión servida                                 |

El manifiesto del build local contiene los cinco valores de hosting. Eso prueba la compilación local, no que Vercel los haya desplegado. Vercel documenta `maxDuration` como límite de ejecución y admite su exportación en Next App Router; el valor efectivo del despliegue debe inspeccionarse junto con el plan, runtime y configuración de funciones. [Documentación de duración](https://vercel.com/docs/functions/configuring-functions/duration).

## Cancelación y recuperación

### Hallazgo de plataforma

Vercel documenta que la cancelación de funciones Node.js por desconexión es **optativa**, mediante `supportsCancellation` por ruta. Cuando está habilitada, la desconexión notifica `request.signal` y puede terminar la función. El trabajo que deba continuar requiere `waitUntil` o `after()`. El efecto alcanza todas las funciones que coincidan con el patrón, aunque no escuchen la señal. [Referencia de cancelación](https://vercel.com/docs/functions/functions-api-reference#cancel-requests).

El repositorio no declara `supportsCancellation`. La configuración efectiva del despliegue no pudo consultarse, por lo que no se afirma que la opción esté deshabilitada allí. Los handlers locales de evaluación y sincronización sí consumen `request.signal`; **eso solo demuestra cómo reaccionan cuando reciben la señal**, no que el proveedor se la envíe al desconectarse el cliente.

La recomendación es revisar primero la evaluación, que no persiste la lista. La sincronización incluye escrituras cuyo commit puede haberse producido cuando se pierde la respuesta; no conviene incluirla automáticamente en un patrón global. La búsqueda tiene trabajo `after()` y las páginas Server Component no reciben aquí una señal de desconexión equivalente a la de los handlers. La propuesta requiere validación por ruta, no copiar una opción global.

### Estado de las comprobaciones solicitadas

| Comprobación                               | Estado de 04A               | Qué falta para aceptarla                                                                                |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| Aborto del cliente recibido por la función | No ejecutada en el hosting  | Despliegue del código 04, acceso y trazas correlacionadas                                               |
| Timeout SQL de 10 s en Neon                | No ejecutada remotamente    | Base de pruebas explícita y sondeo aislado; evidencia de finalización SQL                               |
| SQL que continúa después de abortar HTTP   | No medido remotamente       | Observabilidad del entorno de pruebas que permita seguir la operación sin consultar datos de aplicación |
| Recuperación tras timeout/aborto           | No verificada remotamente   | Ejecutar una petición válida posterior y validar resultados completos                                   |
| Escritura de lista con respuesta perdida   | No ejecutada remotamente    | Cuenta sintética, persistencia aislada y recuperación por GET, sin repetir la mutación a ciegas         |
| Cuatro solicitudes a 50.000 registros      | No ejecutadas en el hosting | Catálogo sintético aislado y capacidad de prueba autorizada                                             |
| Arranque en frío y latencia Vercel–Neon    | No medidos                  | Región/estado del compute y evidencia de inicio de instancia                                            |

Cancelar la descarga de la portada no habría probado ninguna de estas propiedades. Tampoco sería correcto ejecutar una búsqueda artificial sobre el catálogo real: además de leerlo, esa ruta puede registrar demanda y pedir refrescos. Por eso no se sustituyó la fixture aislada por datos de producción.

El ejecutor HTTP actual inicia su propio `next start` local y usa un preload exclusivo de pruebas; no es un cliente que pueda apuntarse sin más a una URL remota. Los fallos inyectados de 04 no son una función pública del producto. No se expusieron hooks de fallo ni se copiaron variables de fixtures a un despliegue normal.

## Ajustes recomendados

1. **Resolver la diferencia de versión antes de ajustar segundos.** Identificar desde Vercel el despliegue asociado al dominio y el commit/artefacto de un entorno de pruebas. Si no contiene 04, preparar su publicación aislada como trabajo separado y autorizado. No sirve medir el código anterior para aprobar los límites nuevos.
2. **Mantener provisionalmente 15/12/10 s y los máximos locales 20/30/35 s.** No hay medición remota que justifique aumentarlos o reducirlos. Conservar también 10/8 s para el registro posterior: el intento local de 5/3 s ya produjo errores. Estos son valores candidatos para validación, no un SLA remoto aprobado.
3. **Revisar la cancelación por ruta.** Si el despliegue no la admite, preparar una propuesta limitada inicialmente a evaluación. Separar la decisión sobre sync y revisar la continuidad de `after()`. No modificar `vercel.json` ni la configuración del proyecto durante esta inspección.
4. **Medir la latencia desde la función hacia Neon.** Separar tiempo del cliente, transporte DB, SQL y procesamiento. Clasificar inicio frío/caliente con evidencia del runtime y del compute, no solo por ser la primera petición del ensayo. No suspender/reiniciar la base ni desactivar el escalado a cero para fabricar la prueba. La guía de Neon recomienda medir desde una ubicación equivalente al servidor y separar estados fríos/calientes. [Metodología de Neon](https://neon.com/docs/guides/benchmarking-latency).
5. **Inspeccionar límites de gasto y frecuencia existentes antes de proponer otros.** Faltan el plan, las regiones, las reglas WAF y las alertas o límites de gasto efectivos. No se concluye que estén ausentes. Si se necesita una regla adicional, presentar primero umbrales apoyados por tráfico real y el efecto sobre IP compartidas. El modo `Log` del WAF permite observar sin bloquear, pero habilitarlo también es un cambio remoto y no se ha hecho. [WAF de Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
6. **Usar los logs existentes para demostrar finalización y recuperación.** La vista de logs del proyecto permite consultar las funciones; la retención depende del plan. Si la información disponible no permite correlacionar aborto, SQL y tareas posteriores, registrar esa carencia y proponer instrumentación mínima solo para el entorno aislado. No añadir servicios de observabilidad ni atribuir coste real al RSS del adaptador local. [Logs de funciones](https://vercel.com/docs/functions/logs).

## Cómo completar la verificación

Primero se necesita resolver el permiso de lectura de la conexión Vercel sobre `jeanpierrejeris-projects`, el equipo propietario de CompraFino. **La integración ya está conectada, pero ver el nombre del proyecto no equivale a poder inspeccionarlo.** El titular debe revisar que la cuenta y el equipo autorizados correspondan al proyecto; si el equipo no aparece entre los accesibles, habrá que revisar sus permisos en Vercel. No hace falta compartir contraseñas ni tokens en el chat.

Después hay que identificar una versión de pruebas que contenga 04 y use una base explícita de pruebas. Si no existe, crearla o publicarla excede la instrucción actual de inspección sin cambios remotos: debe prepararse como una acción separada para revisión. El acceso al panel por sí solo no resuelve la falta de esa versión.

Con esos requisitos resueltos, la aceptación debe cubrir:

- El mismo catálogo sintético a 2.000, 10.000 y 50.000, con veinte muestras por combinación y calentamientos separados; conservar los cuatro casos concurrentes y las series de cien canastas mixtas y cien genéricas a 50.000.
- Validación del cuerpo completo, precios, elegibilidad, orden, paginación y decisiones de canasta contra referencias del mismo esquema; nunca aceptar solo el estado HTTP 200.
- Sondeos de timeout SQL y aborto del cliente, recuperación posterior y seguimiento hasta finalizar el trabajo SQL/`after()` asociado. Identificar por separado el aborto del transporte y el resultado de una escritura.
- Registro de máximos de hosting efectivos, región web/base, runtime, configuración de cancelación, cold starts, errores, memoria/CPU disponibles y coste observado, sin extrapolar los tiempos locales a la factura.
- Teardown exclusivamente del esquema propio y conservación de evidencia. Si un control requiere una opción remota nueva, detener ese control y presentar el cambio concreto antes de aplicarlo.

### Prompt para retomar tras resolver el acceso al equipo

```text
Retoma el prompt 04A desde docs/history/hosting-request-budgets-2026-10-16.md. He revisado el acceso de la conexión Vercel al equipo jeanpierrejeris-projects. Comprueba primero que ya se permite leer el proyecto comprafino; antes, las consultas con su equipo devolvían 403 aunque el proyecto aparecía en el listado. Identifica el despliegue asociado a comprafino.vercel.app y verifica si algún entorno de pruebas contiene el código del prompt 04. Inspecciona maxDuration, supportsCancellation por ruta, runtime, regiones, plan, logs, reglas WAF y protecciones de gasto existentes sin modificar nada.

Si existe un despliegue equivalente con base de pruebas explícita y aislamiento confirmado, ejecuta controles acotados de cancelación y recuperación y la matriz correspondiente; no uses la base de aplicación ni retailers. Si falta ese entorno, prepara una propuesta concreta para crearlo/publicarlo y explica sus cambios y coste antes de solicitar autorización. No publiques automáticamente, no expongas hooks de fallo en producción y no cambies las reglas de comparación. Actualiza el reporte distinguiendo evidencia local, remota y pendiente.
```

## Evidencia y comprobaciones locales

La evidencia está en `.artifacts/hosting-budgets-2026-10-16/`: respuestas de las cuatro consultas públicas de GitHub, resúmenes HTTP de las dos portadas, `source-comparison.json`, `inspection-summary.json` y manifiesto de hashes de fuentes. `authenticated-access-summary.json` añade el resultado posterior de la conexión Vercel, los identificadores del proyecto/equipo y los tres rechazos 403, sin credenciales. Se conserva la evidencia inicial sin sobrescribir su estado de acceso de aquel momento. Las cabeceras conservadas excluyen cookies y parámetros del salto de autenticación.

Los cambios de esta tarea son documentales. Se comprueban formato, referencias y whitespace, además de que los **387 archivos de fuentes/configuración inventariados mantienen sus hashes**. No se repitieron build ni suites de aplicación porque no se modificó código. Las 915 pruebas unitarias, 156 de integración y 88 de Chromium del prompt 04 siguen siendo evidencia local anterior; **no se cuentan como verificaciones remotas de 04A**.
