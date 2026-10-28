# Transferencia de `health:catalog`, 28 de octubre de 2026

Base: `e83e843`. Implementación local, sin publicación, commit, conexión a producción ni ejecución de migraciones. El único cambio de producción está en [catalog-health.ts](../../packages/db/src/catalog-health.ts): cuatro constantes salen de la proyección SQL y se reconstruyen antes del mismo validador. No cambian contratos, consultas de matching/búsqueda/listas, workflows, frecuencia, cachés ni productos examinados.

## Lecturas y dependencias inspeccionadas

El [CLI](../../packages/db/src/catalog-health-cli.ts) valida el log opcional de capacidad y llama a `inspectCatalogHealth()`. Este ejecuta, secuencialmente:

1. [inspectOperations()](../../packages/db/src/operations.ts): cuatro lotes, uno por supermercado, cada uno con dos SELECT limitados a una fila: último intento y último éxito. Se devuelven `id`, `retailerId`, `startedAt`, `endedAt`, `status`, `listingsFetched`, `listingsPersisted`, `listingsChanged` y `error`. `operationalRunSchema` valida los primeros ocho campos; `catalogRunFailureKind()` clasifica el error del intento. La misma fila puede representar intento y éxito. Esta lectura no cambia.
2. `inspectHealthCounts()`: un SELECT devuelve `retailer` y `known`, agrupando todos los registros retenidos. Ambos se validan; se rechaza un total mayor que 50.000 antes de leer candidatos.
3. Páginas de candidatos de 500 filas, ordenadas por UUID y con cursor exclusivo. Se conservan exactamente joins, filtros de actividad, disponibilidad triestado, PEN, precio positivo, unidades compatibles, normalización y ventana inclusiva de 36 horas. Una cantidad divisible por 500 provoca la misma página vacía final.
4. Cada candidato pasa por [genericProductOffer()](../../packages/db/src/generic-offers.ts). La aceptación incrementa el contador de su supermercado. [evaluateCatalogHealth()](../../packages/core/src/catalog-health.ts) valida la consistencia del snapshot y produce el mismo reporte, estado y problemas.

[readHealthStep()](../../packages/db/src/catalog-health-read.ts) conserva la clasificación segura de fallos, etapa y un único reintento para errores transitorios. La salida del CLI, los códigos de salida, el límite del log de adquisición y las anotaciones de Actions no cambian.

### Proyección de cada candidato

Antes: 14 columnas. Después: 10 columnas. El JSON `listing` contiene siete propiedades; no es una copia de la fila completa y se conserva íntegro.

| Columna/estructura                                                                 | Uso efectivo y decisión                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listing.id`, `listing.retailerId`                                                 | Validación de identidad, atribución al supermercado y cursor; se conservan.                                                                                               |
| `listing.title`, `priceUnit`, `packageText`, `sourceBrand`, `sourceUnitMultiplier` | [catalogRecordSchema/catalogFingerprint](../../packages/db/src/catalog.ts), normalización, familia y cálculo de precio unitario; se conservan, incluido el cast `float8`. |
| `sourceCategory`                                                                   | Clasificación de familia; se conserva.                                                                                                                                    |
| `retailerName`                                                                     | Se valida como texto no vacío aunque health no lo publique; se conserva para no ocultar datos inválidos.                                                                  |
| `url`                                                                              | Validación de la URL del supermercado; se conserva.                                                                                                                       |
| `currentPriceCents`                                                                | Precio ordinario positivo, ranking y cálculo; se conserva.                                                                                                                |
| `regularPriceCents`                                                                | Validación de entero no negativo/nulo y precio de referencia; se conserva aunque health solo cuente ofertas.                                                              |
| `observedAt`, `available`                                                          | Validación y reglas de frescura/disponibilidad; se conservan.                                                                                                             |
| `fingerprint`, `version`                                                           | Rechazo de normalización desactualizada; se conservan.                                                                                                                    |
| `imageUrl`                                                                         | Era exclusivamente `null::text`; ahora se entrega `null` al mismo validador.                                                                                              |
| `conditionalOffers`                                                                | Era exclusivamente `'[]'::jsonb`; ahora se entrega un nuevo `[]` al mismo validador.                                                                                      |
| `canonicalId`                                                                      | Era exclusivamente `null::uuid`; ahora se entrega `null` al mismo validador.                                                                                              |
| `retailerCount`                                                                    | Era exclusivamente `0`; ahora se entrega `0` al mismo validador.                                                                                                          |

El validador compartido sigue ejecutando `catalogRecordSchema`, comprobación de versión/huella, URL admitida, normalización, clasificación, ofertas condicionales, ranking, precio unitario, frescura, disponibilidad e imagen/precio de referencia. No se sustituye por un contador SQL simplificado. Incluso los campos dinámicos cuyo resultado final no usa health conservan sus validaciones y errores.

## Método reproducible y línea base

[Comandos locales](../local-testing.md#catalog-health-transfer-comparison-without-migrations). Entorno medido: Node `v24.3.0`, PostgreSQL `17.11`, imagen local `postgres:17-alpine`, conexión TCP a `127.0.0.1:55432/comprafino_test`. No se cargan credenciales de la aplicación en el harness.

La [fixture](../../packages/db/src/testing/health/fixture.ts) exige URL de pruebas explícita, modo local y destino loopback/`comprafino_test`. Crea cinco tablas mínimas con tipos y un índice único de precio vigente en un esquema aleatorio propio, y elimina solo ese esquema al terminar. No utiliza el ejecutor ni los archivos de migraciones. Los datos son sintéticos: cuatro supermercados, ocho plantillas, Unicode, unidades UN/KG, cantidades ambiguas/ausentes y stock verdadero/desconocido. El reloj se fija en `2026-10-28T12:00:00.000Z`.

Antes de editar la consulta se ejecutó `benchmark-cli.ts --baseline --samples=20 --output=.artifacts/health-transfer/baseline.json`: 20 muestras por escala, después de un calentamiento excluido. El SHA-256 del lector medido era `c24e4cbfbfdabfa416027813533447a43a0ce26443f0935df4d8bdc994dad2ac`, idéntico al archivo original de `e83e843`.

Después se ejecutó el [benchmark](../../packages/db/src/testing/health/benchmark-cli.ts) en modo comparación: 20 pares por escala, alternando el orden anterior/nuevo, con un calentamiento excluido para cada lector. El [lector anterior congelado](../../packages/db/src/testing/health/legacy-catalog-health.ts) conserva exactamente el código anterior salvo rutas de importación, nombre exportado y obligación de inyectar la base de pruebas. Comparte los validadores actuales para aislar el efecto de la proyección.

Los digests de las cuatro tablas variables coincidieron entre la línea base y la comparación en las tres escalas; también coincidieron los bytes y reportes del lector anterior. Los resultados pareados usaron el mismo harness y las mismas tablas. Los JSON locales ignorados `.artifacts/health-transfer/baseline.json` y `.artifacts/health-transfer/comparison.json` contienen muestras individuales, digests, hashes de fuentes y `cleanedUp: true`. El lector optimizado medido tiene SHA-256 `c79397bdc93644f44498057cb20879ae9d3a53f613161c2a120097f3c5e4c091`.

El [observador](../../packages/db/src/testing/health/observer.ts) mide resultados antes del mapeo de Drizzle/validación de dominio: `Buffer.byteLength(JSON.stringify(rows))`, filas, llamadas del cliente y sentencias SQL. Las operaciones usan filas en modo array y las páginas usan objetos. Cuenta las tres etapas del lector completo, no solo las páginas. Preparación, digests, calentamientos y limpieza quedan fuera. No registra SQL, parámetros, títulos ni filas en el informe de medición.

## Resultados

Bytes lógicos por ejecución completa, idénticos en todas las muestras de cada combinación:

| Candidatos | Filas totales antes/después | Páginas antes/después | Bytes antes | Bytes después | Reducción | Llamadas antes/después | SELECT antes/después |
| ---------: | --------------------------: | --------------------: | ----------: | ------------: | --------: | ---------------------: | -------------------: |
|      1.000 |               1.012 / 1.012 |                 3 / 3 |     580.511 |       504.511 |   13,09 % |                  8 / 8 |              12 / 12 |
|     10.000 |             10.012 / 10.012 |               21 / 21 |   5.794.908 |     5.034.908 |   13,11 % |                26 / 26 |              30 / 30 |
|     50.000 |             50.012 / 50.012 |             101 / 101 |  28.969.992 |    25.169.992 |   13,12 % |              106 / 106 |            110 / 110 |

Las doce filas adicionales son ocho resultados de operaciones y cuatro conteos. Para `C` candidatos, hay `P = floor(C / 500) + 1` páginas, `5 + P` llamadas y `9 + P` SELECT en ejecuciones exitosas sin reintento. Los lotes explican la diferencia entre llamadas y sentencias. No se cuentan `BEGIN`/`COMMIT`/`search_path` del adaptador local como consultas de aplicación.

El ahorro es exactamente **76 bytes lógicos por candidato**: 76.000, 760.000 y 3.800.000 bytes por ejecución. La reducción porcentual depende del tamaño de los demás campos; no se extrapola como porcentaje del consumo total de Neon.

Tiempos del lector completo instrumentado, en milisegundos:

| Candidatos | Línea base previa p50 / p95 | Pareado anterior p50 / p95 | Pareado nuevo p50 / p95 |
| ---------: | --------------------------: | -------------------------: | ----------------------: |
|      1.000 |               41,10 / 49,84 |              39,35 / 43,92 |           38,79 / 42,84 |
|     10.000 |             347,17 / 355,68 |            346,88 / 363,46 |         344,46 / 355,61 |
|     50.000 |         2.029,38 / 2.050,96 |        2.029,81 / 2.053,89 |     2.009,39 / 2.049,94 |

Cada p95 usa 20 muestras, por rango más cercano. Incluyen transporte local, validación, normalización y conteo de bytes. Las diferencias pequeñas no demuestran una mejora estadísticamente significativa de latencia ni describen CPU o latencia de producción.

## Equivalencia y verificaciones

La [prueba de integración específica](../../packages/db/src/catalog-health-transfer.integration.test.ts) compara reportes completos, errores, progreso, orden/filas por etapa, llamadas, sentencias y candidatos. Además reconstruye las cuatro constantes en **cada fila** y exige igualdad profunda con la fila original. Esto comprueba la entrada exacta al mismo validador, además de los conteos finales.

Casos: cero candidatos; 499/500/501/1.000; disponibilidad verdadera/desconocida/falsa; inactividad; instante futuro; exactamente 36 horas y un milisegundo fuera; precio cero; falta de normalización; precio cerrado; unidades incompatibles; huella/versión incorrectas; URL no admitida; cantidad ambigua; multiplicador fraccional; precio de referencia nulo; fallos operativos; capacidad omitida/medida; nombre, título, multiplicador y precio de referencia inválidos; error SQL `42P01`; 50.000 admitidos y 50.001 rechazados antes de leer ofertas. Los reintentos y sanitización siguen cubiertos por `catalog-health-read.test.ts`.

- Pruebas específicas en PostgreSQL local y de lectura segura: **23/23** aprobadas.
- Comparación de rendimiento: **60/60 pares** con reportes idénticos, además de las 60 mediciones de línea base.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build`: aprobados. La suite general registró 983 pruebas aprobadas, con tareas de core/db reutilizadas por Turbo; scrapers/web se ejecutaron en la repetición final. La primera ejecución tuvo `EPERM` al crear subprocesos en el sandbox y la repetición con permiso terminó correctamente.
- `pnpm format:check`, `pnpm docs:check` y `git diff --check`: aprobados. Se verificó que los hashes de las fuentes finales coinciden con el benchmark y que no quedaron esquemas de fixtures.
- Las comprobaciones generales usaron una `DATABASE_URL` ficticia en loopback y sin configuración de integración. No se ejecutó la suite general de integración que aplica migraciones. No hubo cambios web que requirieran Chromium E2E.

## Límites y siguiente paso

Estos bytes son **JSON decodificado local**, no tráfico de red medido ni transferencia facturada por Neon. No incluyen envelopes HTTP, metadatos de columnas, protocolo PostgreSQL, TLS, compresión o reintentos; tampoco representan bytes enviados a PostgreSQL. No hubo HTTP a retailers. El benchmark reduce el resultado lógico que PostgreSQL devuelve, pero no determina cuántos bytes facturados se ahorrarán.

Las tablas mínimas reproducen los tipos y relaciones leídos, no todos los índices, constraints, distribución de datos ni planes de producción. La equivalencia se verifica con datos estables; se conserva el comportamiento previo de lecturas separadas ante modificaciones concurrentes. El lector congelado comparte dependencias de dominio y no pretende congelar para siempre toda la semántica de `e83e843`.

El porcentaje no permite atribuir los 5,53 GB previos ni asegurar permanencia en Free. Para extrapolar se necesitan candidatos reales por ejecución, ejecuciones/reintentos efectivos y métricas de transferencia del proveedor en la misma ventana; una estimación lógica sería `76 × suma de candidatos leídos`. Medir producción requiere autorización separada.

Recomendación siguiente: medir [evaluateCurrentShoppingList()](../../packages/db/src/shopping-list.ts) y sus lectores de ofertas/historial, contrastando resultados SQL con campos realmente consumidos. El [cliente de evaluación](../../apps/web/src/lib/shopping-list/evaluation-query.ts) configura refresco mientras está activo; combinar volumen por evaluación con frecuencia real permitirá priorizar mejor. No se propone reducir su frecuencia, candidatos o frescura ni se cambió este componente en esta etapa.
