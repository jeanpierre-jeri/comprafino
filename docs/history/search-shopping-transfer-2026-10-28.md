# Transferencia de búsquedas y listas, 28 de octubre de 2026

Base: `e83e843`, conservando sin alteraciones los archivos del trabajo local anterior de `health:catalog`. Trabajo local sin producción, migraciones, cambios de workflows, commit ni push.

## Decisión

Se compactan **solo las tres colecciones del snapshot SQL de evaluación de listas**: candidatos, historia y evidencia para recomendaciones por día. PostgreSQL devuelve arrays posicionales en lugar de repetir nombres JSON en cada registro. El servidor reconstruye exactamente los objetos originales antes de los mismos validadores y algoritmos. Todos los valores, candidatos, órdenes, precios, condiciones, permisos y límites se conservan.

La búsqueda permanece sin cambios y se mide como control. No se introduce un LIMIT, caché, nueva consulta, menor frecuencia ni cambio de cobertura. El snapshot de lista sigue siendo una única sentencia para contar el catálogo, leer identidades/candidatos e historia de forma consistente.

## Consultas completas y dependencias

### Búsqueda

[searchGroupedPublicProducts()](../../packages/db/src/generic-offers.ts) llama a `publicSearchCandidates()` → `publicSearchOfferScopes()` → `readGenericProductOffers()`. El lector hace un lote con un SELECT:

1. [eligibleProductIdentities](../../packages/db/src/public-products.ts) materializa solo ID canónico, título y número de tiendas. Excluye grupos con enlaces manuales, versión obsoleta o confianza insuficiente; exige al menos dos tiendas. Los joins de normalización/precio y las condiciones de identidad permanecen dentro de PostgreSQL.
2. `currentGenericOfferRows()` une listings, tiendas, normalización, precio vigente, asociación canónica opcional y [beneficios](../../packages/db/src/conditional-pricing.ts). Aplica actividad, stock distinto de falso, precio ordinario PEN positivo, unidades compatibles UN/KG, observación no futura y frescura inclusiva de 36 horas.
3. Aplica tokens, prefijos, números completos, vector de búsqueda y un conjunto conservador de candidatos por familia; ordena con relevancia, colación y UUID. El único límite SQL es el centinela de 50.001, para rechazar desbordamiento.
4. Devuelve los 14 campos de `genericOfferProjection`. Una búsqueda de categoría con texto útil lee el conjunto global más `matchesCategory`, para conservar cobertura/discovery global mientras presenta el subconjunto de categoría.
5. `genericProductOffer()` valida cada fila, comprueba huella/versión, URL y cantidades, calcula ranking/precio unitario y rechaza lo no admisible. Después se aplican familia, categoría, tienda/unidad y prioridades léxicas.
6. [groupSearchOffers()/limitGenericOffers()](../../packages/core/src/search-results.ts) agrupan **todos** los miembros admitidos, resuelven representativo, mínimos/empates ordinarios y condicionales, ordenan y seleccionan hasta 30 tarjetas. La cuota de dimensiones en precio unitario y la exclusión de la primera página afectan la paginación.

También se necesitan `refreshListingIds`, cobertura por supermercado, `usefulResultCount`, unidades disponibles y totales previos a paginar. Un LIMIT de 30 antes de estos pasos perdería miembros, mínimos, dimensiones o cobertura. Empujar un filtro de tienda/unidad sin conservar esas otras salidas tampoco sería equivalente. El coste de joins/ordenación dentro de PostgreSQL no debe confundirse con bytes devueltos.

### Evaluación de listas

[evaluateCurrentShoppingList()](../../packages/db/src/shopping-list.ts) no consulta por cada necesidad. Si la lista está vacía no consulta; de lo contrario ejecuta un lote con un SELECT cuyo resultado externo es **una fila con JSON anidado**:

- `currentCount`: total del catálogo vigente, para rechazar más de 50.000 independientemente del subconjunto solicitado.
- `products`: ID/título de las identidades exactas solicitadas. El título canónico actual gobierna alternativas preferidas; una identidad ausente no autoriza sustitución.
- `listings`: candidatos exactos, familias genéricas requeridas, SKU seleccionados y compañeros de su identidad pública. Las preferencias conservan el conjunto amplio de familias admitidas. El orden por UUID textual y el centinela de 50.001 no cambian.
- `historyRows`: hasta 90 días observados por los SKU exactos solicitados, con corte por fecha de asociación para referencias canónicas y alcance propio para selección directa. [shoppingHistoryRows()](../../packages/db/src/shopping-price-history.ts) usa observaciones reales y estados ordinarios: selecciona el mínimo diario y el instante más reciente entre empates, sin relleno de fechas, precio de referencia ni beneficios.
- `weekdayRows`: evidencia de las cuatro semanas completas anteriores. [shoppingWeekdayRows()](../../packages/db/src/weekday-recommendation.ts) exige cobertura de estados sin huecos ni cambios intradía de precio/unidad/moneda; un día no estable puede conservar `priceCents: null`. Su significado difiere del mínimo diario anterior y no se pueden fusionar ambos valores indiscriminadamente.

`genericProductOffer()` sigue validando y normalizando los candidatos; `shoppingCandidate()` conserva cantidad fuerte, perfil de sustitución, identidad, disponibilidad y precio/beneficios. `evaluateShoppingFulfillment()` decide opciones por necesidad y `optimizeBasket()` usa solo opciones aprobadas. `shoppingWeekdays()` y `shoppingPriceHistories()` producen recomendaciones y periodos 7/30/90 con los mismos validadores.

### Inventario de valores transportados

| Estructura                         | Valores y uso                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listing` dentro de cada candidato | `id`, `retailerId`, `title`, `priceUnit`, `packageText`, `sourceBrand`, `sourceUnitMultiplier`: identidad, huella, normalización, familia, cantidad y precisión. El objeto y el cast `float8` se conservan.                  |
| Otros campos de candidato          | `sourceCategory`, `retailerName`, `url`, `imageUrl`, `currentPriceCents`, `regularPriceCents`, `conditionalOffers`, `observedAt`, `available`, `fingerprint`, `version`, `canonicalId`, `retailerCount`. Todos se conservan. |
| Beneficios                         | `conditionType`, `programKey`, `conditionLabel`, `priceCents`, `observedAt`, `startsAt`, `endsAt`: no se compactan ni reinterpretan en esta etapa.                                                                           |
| Historia diaria                    | `listingId`, `date`, `priceCents`, `observedAt`: mismos cuatro valores, ahora tupla.                                                                                                                                         |
| Evidencia semanal                  | `listingId`, `date`, `priceCents` positivo o nulo: mismos tres valores, ahora tupla.                                                                                                                                         |
| Campos solo SQL                    | Claves nativas, títulos normalizados/plegados, identidad/vector de búsqueda y relaciones de trabajo no forman parte de `genericOfferProjection`; no se transfieren innecesariamente.                                         |

`regularPriceCents` y `retailerCount` no llegan a `shoppingCandidate()`, pero sí participan en la validación compartida. Eliminarlos o inventar constantes ocultaría datos inválidos y cambiaría errores. Se conservan. No hay lecturas N+1 en estos dos recorridos completos.

## Coste por solicitud y recurrencia

En [la página de búsqueda](../../apps/web/src/app/search/page.tsx), cada invocación efectiva del lector vuelve a recuperar el conjunto necesario, incluso al paginar o cambiar orden/filtros. El formulario envía al buscar, no por cada pulsación. Los filtros navegan a una URL nueva. No hay caché persistente de estos resultados de DB en ese recorrido.

Una navegación no equivale necesariamente a una nueva consulta: Next puede reutilizar contenido del router, y el prefetch automático de una ruta dinámica con `loading.tsx` puede cargar solo el shell. Se consultaron las guías locales de Next 16.3.8 en `apps/web/node_modules/next/dist/docs/`; no se atribuye una lectura de DB a cada enlace visible ni una segunda lectura a cada clic. Para contar ejecuciones reales hacen falta trazas correlacionadas de ruta/consulta, incluyendo navegación atrás/adelante y prefetch.

La búsqueda puede registrar demanda **después de responder**. [requestCatalogRefresh()](../../packages/db/src/catalog-acquisition.ts) envía IDs a un UPDATE sin RETURNING: ese JSON es tráfico **hacia** PostgreSQL. Con 50.000 UUID de 36 caracteres, el array solo ocupa 1.950.001 bytes UTF-8 antes de envoltorios/escaping. [recordDiscoveryForSearch()](../../packages/db/src/discovery.ts), cuando corresponde, usa bloqueo y upsert con resultado pequeño. Estas escrituras no se ejecutaron ni se incluyen en las mediciones del lector. Ninguna consulta pública hace HTTP a supermercados.

La [evaluación del navegador](../../apps/web/src/lib/shopping-list/evaluation-query.ts) está habilitada con lista no vacía y estado listo. Su clave incluye sesión, modo y documento; usa `retry: false`, `gcTime: 0`, `cache: no-store`, refresco configurado cada 60.000 ms mientras la pestaña está activa y `refetchOnWindowFocus: always`. Editar lista/modo, montar de nuevo, volver al foco o refrescar manualmente puede generar evaluaciones adicionales. El refresco manual se une al pendiente y una respuesta vieja se oculta mientras se recalcula. No se modifica nada de ello.

El volumen recurrente es la suma de bytes de **evaluaciones realmente ejecutadas**, no simplemente minutos abiertos por una tasa supuesta: visibilidad, latencia, cancelaciones, cambios y foco intervienen. No se calcula consumo mensual de producción. El POST de la lista al servidor, la respuesta al navegador y la sincronización de cuenta son flujos distintos de PostgreSQL → Next.

El [handler público](../../apps/web/src/server/shopping-list-handler.ts) conserva límite de cuerpo, validación de lista, cancelación, presupuesto de operación y salida validada/no-store. [withStatementBudget()](../../packages/db/src/statement-budget.ts) añade en producción un SELECT de configuración de timeout **en el mismo lote**: los conteos de esta medición son los SELECT de negocio del lector y excluyen esa configuración. La evaluación no consulta tablas privadas ni cambia permisos.

## Alternativas y selección

| Alternativa                                                   | Ahorro esperado                                                                                                                      | Complejidad/riesgo                                                                                             | Tiempo y pruebas necesarias                                                                                         | Decisión                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Tuplas para candidatos e historia del snapshot                | Previsible exactamente: 198 bytes por candidato, 45 por fila histórica y 32 por fila semanal; aproximadamente 28–34 % en esta matriz | Baja/moderada; mantener orden de columnas y validación                                                         | Menos JSON en PostgreSQL/transporte; reconstrucción en Node. Comparar cada fila, resultados, errores y concurrencia | Implementada                    |
| Quitar campos que la lista no presenta                        | Variable, menor que la compactación completa                                                                                         | Cambia validación de valores dinámicos si se eliminan sin sustitución equivalente                              | Requiere probar también errores, no solo precios finales                                                            | Descartada para esta etapa      |
| Filtrar o agrupar más dentro de PostgreSQL                    | Puede evitar gran parte de una búsqueda amplia                                                                                       | Alta: normalización, huellas, cantidades exactas, perfiles, agrupación/empates, cobertura y paginación         | Traslada CPU a PostgreSQL; requiere un oráculo completo de búsqueda/agrupación y valores inválidos                  | Pendiente, sin LIMIT prematuro  |
| Agregar historia directamente a periodos 7/30/90              | Potencial alto cuando domina historia                                                                                                | Moderada/alta: fechas observadas, empates, cortes de asociación, huecos e identidad del SKU finalmente elegido | Menos filas, más responsabilidad SQL; equivalencia temporal extensa y errores                                       | Pendiente                       |
| Diccionario por SKU o compactar `listing` anidado en búsqueda | Ahorra UUID/nombres repetidos; sin cifra mensual                                                                                     | Moderada; restauración sin pérdida y preservación del orden                                                    | Medir memoria, deserialización, JSON real y equivalencia de datos inválidos                                         | Siguiente candidato conservador |
| Caché o reutilización entre solicitudes                       | Depende de repetición y aciertos reales                                                                                              | Alta para frescura exacta, aislamiento de sesión y cambios concurrentes                                        | Requiere invalidación completa de precios, stock, identidad, beneficios e historia                                  | No implementada                 |

La reutilización segura dentro de una solicitud ya existe: una lectura global de categoría/texto, un snapshot de lista, y `current_prices` compartido. Los dos historiales no son duplicados semánticos. No se alteran sus condiciones para ganar bytes.

## Reproducción y alcance del experimento

Las [fixtures](../../packages/db/src/testing/transfer/fixture.ts) exigen `TEST_DATABASE_URL`, modo local, host loopback y base `comprafino_test`; no leen `DATABASE_URL` ni `.env`. Crean diez tablas mínimas tipadas con índices de lectura, dentro de un esquema aleatorio propio. No leen archivos ni ejecutan herramientas de migración. Normalización/huellas se calculan con funciones de dominio reales; el volumen se carga directamente como datos de prueba.

Hay cuatro supermercados, veinte plantillas, UN/KG, cantidades fuertes/ausentes/ambiguas, Unicode, multiplicador fraccional, stock verdadero/desconocido, imágenes, grupos exactos y beneficios CMR. Los primeros 320 SKU tienen 90 fechas observadas con cambios diarios; los restantes solo tienen estado vigente. Esto permite evaluar hasta 50 identidades exactas con historia sin inventar cobertura para el resto. Las fixtures de casos límite mutan solo su esquema.

El reloj es `2026-10-28T18:00:00.000Z`. Se usan escalas de 1.000, 10.000 y 50.000 listings, doce solicitudes por escala, cinco muestras y un calentamiento excluido por lector/caso. La línea base completa se recogió antes de editar producción; la comparación usa orden alternado anterior/nuevo, con los mismos datos. Cinco muestras permiten una mediana descriptiva; no se reporta p95 ni se infiere significación estadística.

```sh
pnpm test:db:up
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm --filter @comprafino/db exec vitest run src/shopping-transfer.integration.test.ts src/shopping-snapshot-transport.test.ts src/catalog-health-transfer.integration.test.ts src/catalog-health-read.test.ts
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm --filter @comprafino/db exec node --experimental-strip-types src/testing/transfer/benchmark-cli.ts --samples=5 --output=.artifacts/search-shopping-transfer/new-comparison.json
pnpm test:db:down
```

El [benchmark](../../packages/db/src/testing/transfer/benchmark-cli.ts) admite `--sizes=1000,10000,50000`, `--cases=list-mixed-20` y `--samples=2..30`. `--baseline` mide únicamente el código actual: se usó **antes** de cambiarlo, no restaura automáticamente la versión antigua. Cada ejecución requiere destino nuevo; los informes no se sobrescriben. Ejecutar sin builds/tests concurrentes para comparar tiempos.

Los lectores anteriores congelados son [shopping-list](../../packages/db/src/testing/transfer/legacy-shopping-list.ts), [historia](../../packages/db/src/testing/transfer/legacy-shopping-price-history.ts) y [evidencia semanal](../../packages/db/src/testing/transfer/legacy-weekday-recommendation.ts). Se verificó su igualdad textual con `e83e843` salvo comentarios/importaciones. Los algoritmos de dominio y búsqueda compartidos no cambiaron.

El [observador](../../packages/db/src/testing/transfer/observer.ts) registra llamadas, SELECT, filas externas, candidatos y filas históricas/semanales anidadas, bytes totales/desglosados y tiempo. Cada petición tiene contadores propios. No guarda filas, títulos, etiquetas de usuario, SQL ni parámetros; los artefactos contienen digests, conteos, hashes y muestras de tiempos.

La equivalencia compara respuestas funcionales completas, incluidas alternativas, canastas, recomendaciones, historial e instante evaluado. Solo excluye `timings`, valores deliberadamente variables que se validan y miden aparte. Los BigInt de búsqueda conservan su tipo en la comparación profunda; únicamente sus digests utilizan una representación explícita.

## Mediciones

Resultados pareados sobre PostgreSQL **17.11** y Node **v24.3.0**. Los digests de las nueve tablas variables coinciden con la línea base y los resultados anteriores mantienen exactamente sus bytes y digests funcionales. Los hashes de los lectores de producción coinciden con sus fuentes finales.

**Búsqueda, sin cambios:** un SELECT de negocio por solicitud; candidatos = filas externas devueltas. Los bytes anteriores y actuales son idénticos.

| Listings | Caso                       | Candidatos | Bytes antes = después | p50 ms anterior → actual |
| -------: | -------------------------- | ---------: | --------------------: | -----------------------: |
|    1.000 | `search-wide`              |      1.000 |               709.653 |          151,47 → 152,54 |
|    1.000 | `search-page-2`            |      1.000 |               709.653 |          147,85 → 149,54 |
|    1.000 | `search-selective`         |         48 |                33.537 |            26,08 → 25,95 |
|    1.000 | `search-absent`            |          0 |                     2 |            17,34 → 17,92 |
|    1.000 | `search-family`            |        152 |               107.618 |            32,29 → 29,63 |
|    1.000 | `search-category-text`     |      1.000 |               733.349 |          116,84 → 107,29 |
|    1.000 | `search-filtered-benefits` |      1.000 |               709.653 |          107,48 → 103,60 |
|   10.000 | `search-wide`              |     10.000 |             7.101.540 |        1091,18 → 1087,48 |
|   10.000 | `search-page-2`            |     10.000 |             7.101.540 |         1154,49 → 947,13 |
|   10.000 | `search-selective`         |        500 |               349.864 |          203,75 → 206,35 |
|   10.000 | `search-absent`            |          0 |                     2 |            66,60 → 67,94 |
|   10.000 | `search-family`            |      1.500 |             1.062.821 |          237,79 → 215,23 |
|   10.000 | `search-category-text`     |     10.000 |             7.338.540 |        1081,44 → 1075,68 |
|   10.000 | `search-filtered-benefits` |     10.000 |             7.101.540 |         1145,86 → 948,12 |
|   50.000 | `search-wide`              |     50.000 |            35.552.060 |        5871,16 → 4729,32 |
|   50.000 | `search-page-2`            |     50.000 |            35.552.060 |        5721,99 → 4661,50 |
|   50.000 | `search-selective`         |      2.500 |             1.751.344 |          969,07 → 973,98 |
|   50.000 | `search-absent`            |          0 |                     2 |          593,44 → 595,61 |
|   50.000 | `search-family`            |      7.500 |             5.320.821 |          796,97 → 798,29 |
|   50.000 | `search-category-text`     |     50.000 |            36.737.060 |        4654,73 → 4634,78 |
|   50.000 | `search-filtered-benefits` |     50.000 |            35.552.060 |        5644,73 → 4510,50 |

**Evaluación de lista:** un SELECT y una fila externa con snapshot; las cantidades anidadas no cambian. La tabla excluye la lista vacía, que conserva cero llamadas, filas y bytes en las tres escalas.

| Listings | Caso             | Candidatos | Historia / semanas | Bytes antes | Bytes después | Reducción | p50 ms antes → después |
| -------: | ---------------- | ---------: | -----------------: | ----------: | ------------: | --------: | ---------------------: |
|    1.000 | `list-generic-5` |        560 |              0 / 0 |     400.647 |       289.767 |   27,68 % |          70,10 → 65,18 |
|    1.000 | `list-mixed-20`  |        584 |      5.400 / 1.680 |   1.283.312 |       870.920 |   32,13 % |        183,84 → 173,32 |
|    1.000 | `list-strict-50` |        200 |     18.000 / 5.600 |   3.027.689 |     1.998.889 |   33,98 % |        398,54 → 374,00 |
|    1.000 | `list-direct-3`  |         12 |           270 / 84 |      51.699 |        34.485 |   33,30 % |          21,28 → 20,98 |
|   10.000 | `list-generic-5` |      5.500 |              0 / 0 |   3.937.177 |     2.848.177 |   27,66 % |        527,43 → 487,34 |
|   10.000 | `list-mixed-20`  |      5.524 |      5.400 / 1.680 |   4.819.842 |     3.429.330 |   28,85 % |        655,48 → 617,65 |
|   10.000 | `list-strict-50` |        200 |     18.000 / 5.600 |   3.027.690 |     1.998.890 |   33,98 % |        447,11 → 415,22 |
|   10.000 | `list-direct-3`  |         12 |           270 / 84 |      51.700 |        34.486 |   33,30 % |          53,40 → 52,47 |
|   50.000 | `list-generic-5` |     27.500 |              0 / 0 |  19.710.197 |    14.265.197 |   27,63 % |      2607,78 → 2430,25 |
|   50.000 | `list-mixed-20`  |     27.524 |      5.400 / 1.680 |  20.592.862 |    14.846.350 |   27,91 % |      2901,67 → 2686,04 |
|   50.000 | `list-strict-50` |        200 |     18.000 / 5.600 |   3.027.690 |     1.998.890 |   33,98 % |        669,09 → 634,89 |
|   50.000 | `list-direct-3`  |         12 |           270 / 84 |      51.700 |        34.486 |   33,30 % |        303,43 → 316,39 |

`search-wide` y `search-page-2` usan relevancia; `search-filtered-benefits` selecciona Tottus/litros/precio unitario/beneficios después de leer el conjunto completo. `list-mixed-20` usa beneficios; las demás listas usan modo ordinario. La prueba de equivalencia también cruza ambos modos.

El ahorro medido es exactamente `198 × candidatos + 45 × filas históricas + 32 × filas semanales` bytes lógicos. No cambian conteos ni valores: solo desaparecen nombres de propiedades repetidos. En una lista estricta de 50 productos, las 18.000 filas de historia y 5.600 semanales pesan más que sus 200 candidatos; por eso la reducción no depende mucho del tamaño del resto del catálogo. Una lista genérica de cinco necesidades devuelve 27.500 candidatos en la escala de 50.000, aunque sus salidas visibles sean mucho menores.

**No hay mejora uniforme de latencia.** La lista directa de tres SKU a 50.000 pasa de 303,43 a 316,39 ms de mediana (+4,3 %) mientras reduce 33,30 % de bytes. Las listas grandes mejoran en esta corrida, pero cinco muestras y la variación de los controles de búsqueda no permiten garantizar causalidad o una latencia de producción. La reducción de bytes sí es exacta y estable en todas las muestras.

La evidencia local ignorada por Git está en `.artifacts/search-shopping-transfer/baseline.json` (180 ejecuciones previas) y `.artifacts/search-shopping-transfer/comparison.json` (180 pares, 360 ejecuciones medidas), más un ensayo inicial separado `setup-probe.json`. Incluye muestras individuales, tiempos de espera del cliente, desglose de bytes, digests, hashes de fuentes y `cleanedUp: true`. No se sobrescribe el resultado anterior de health. `final-fixture-check.json` verifica nuevamente los digests de las tres escalas después de añadir llaves explícitas a dos guardas del harness; no cambia el SQL, los datos ni los lectores medidos.

## Verificación y límites

Resultados de las comprobaciones:

- Pruebas dirigidas de transporte, PostgreSQL, concurrencia y regresiones de health: **44/44** aprobadas; ejecución de 65,94 s. Una ejecución previa de generic offers/client/transporte también pasó **37/37**.
- Benchmark: **180/180 pares** con igualdad funcional completa; misma cantidad de llamadas, SELECT, candidatos y filas históricas/semanales. Se verificaron los digests contra las **180 ejecuciones de línea base**, los hashes de los lectores finales y la fórmula exacta del ahorro.
- `pnpm typecheck` y `pnpm lint`: aprobados. `pnpm format:check`, `pnpm docs:check` y `git diff --check` también aprobados.
- `pnpm exec turbo run test --force`: **987 pruebas aprobadas**, sin reutilización de caché de tests: core 569, db 110, scrapers 205, web 103.
- `pnpm build`: aprobado. Se usó `DATABASE_URL=postgresql://unused@127.0.0.1:1/comprafino_test` y se retiraron las variables de integración para las comprobaciones generales. La comparación de inicio emitió el diagnóstico seguro `db_read_failed` al intentar la URL ficticia durante el build y utilizó su fallback; el build terminó correctamente. No es una validación de conectividad de producción.
- No se ejecutó la suite general de integración ni el harness Chromium con fixtures, porque aplican migraciones. No hay cambios de componentes web; sí se ejecutaron sus pruebas de contrato/estado/streaming y el build.

[Las pruebas](../../packages/db/src/shopping-transfer.integration.test.ts) restauran **cada objeto SQL** y lo comparan con el anterior, además de las respuestas y los conteos. Incluyen listas vacías, cuatro composiciones, ambos modos, datos inválidos, URLs no admitidas, stock, frescura exacta/futura, normalizaciones obsoletas, asociaciones manuales/antiguas/de baja confianza, cortes temporales, observaciones ausentes/futuras, huecos de estados, cambios intradía, beneficios futuros/vencidos, 50.000/50.001 listings y paginación global. Se conserva la salida de objetos por defecto para otros consumidores de las funciones de historia.

Se verifican cuatro solicitudes simultáneas con alcances/modos distintos, también a 50.000 listings, y lecturas durante una transacción que modifica conjuntamente precio/beneficio: ambos lectores ven el estado anterior mientras no se confirma y el nuevo después del commit local. Los digests de tablas también demuestran que evaluar no escribe.

Los bytes son `Buffer.byteLength(JSON.stringify(result.rows))` del resultado decodificado, **no bytes de protocolo PostgreSQL/HTTP/TLS ni transferencia facturada por Neon**. Una fila externa puede contener megabytes de JSON. Los nombres repetidos eliminados aquí pertenecen al JSON anidado de un valor SQL; acortar aliases de columnas externas no demostraría por sí solo el mismo ahorro de red.

Las mediciones excluyen preparación, digests y limpieza, `BEGIN`/`COMMIT`/`search_path` del adaptador, configuración de timeout del cliente de producción, demanda posterior, HTTP de la aplicación y tráfico a tiendas. Incluyen serialización para contar bytes dentro del tiempo del lector. No describen exclusivamente tiempo CPU de PostgreSQL ni latencia de Neon. Las tablas mínimas no replican todas las constraints, estadísticas, planes ni distribución real de producción.

No se atribuyen los 5,53 GB previos ni se promete permanecer en Free. Faltan candidatos por consulta, composición y tamaño de listas, navegaciones efectivas, refrescos/foco/cancelaciones, solicitudes concurrentes y deltas de transferencia del proveedor en ventanas alineadas. Para medir después sin exponer datos: identificador fijo de operación, filas, bytes, duración, resultado/error y buckets de tamaño; nunca texto de búsqueda, URLs, listas, IDs o parámetros. Cualquier instrumentación/consulta de producción requiere autorización separada.

Siguiente paso recomendado: estudiar la representación JSON anidada de `listing` en búsqueda con el mismo patrón de reconstrucción exacta, y la repetición de UUID por SKU en historia. Mantener agregación/paginación SQL y cachés como trabajos separados con su propia prueba de equivalencia.

## Archivos de esta etapa

- Producción: [shopping-list.ts](../../packages/db/src/shopping-list.ts), [shopping-price-history.ts](../../packages/db/src/shopping-price-history.ts), [weekday-recommendation.ts](../../packages/db/src/weekday-recommendation.ts) y el nuevo [shopping-snapshot-transport.ts](../../packages/db/src/shopping-snapshot-transport.ts). Solo cambia el empaquetado/desempaquetado del snapshot; los lectores históricos conservan su representación anterior por defecto.
- Verificación: [shopping-transfer.integration.test.ts](../../packages/db/src/shopping-transfer.integration.test.ts) y [shopping-snapshot-transport.test.ts](../../packages/db/src/shopping-snapshot-transport.test.ts), con rechazo de tuplas incompletas/excesivas y datos no array.
- Harness: [fixture.ts](../../packages/db/src/testing/transfer/fixture.ts), [observer.ts](../../packages/db/src/testing/transfer/observer.ts), [workloads.ts](../../packages/db/src/testing/transfer/workloads.ts) y [benchmark-cli.ts](../../packages/db/src/testing/transfer/benchmark-cli.ts), más los tres lectores anteriores enlazados arriba. No añade dependencias.
- Documentación: este informe, [shopping-list.md](../shopping-list.md) y [generic-comparison.md](../generic-comparison.md). Los diez archivos del trabajo anterior de health se conservaron byte por byte, verificados con hashes; su contenido y resultados no se sobrescribieron.
