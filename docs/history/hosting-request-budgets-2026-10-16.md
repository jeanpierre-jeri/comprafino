# Prompt 04A — Inspección de los presupuestos en el hosting

Fecha: **16 de octubre de 2026**. Inspección pública aproximadamente 15:00–15:05 en Lima; comprobación posterior mediante la conexión Vercel aproximadamente 15:09. Continuación del [prompt 04](public-request-budgets-2026-10-16.md).

## Resultado

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
