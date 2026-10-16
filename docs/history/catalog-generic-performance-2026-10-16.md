# Canastas genéricas y estabilidad concurrente — prompt 03D

Fecha: 16 de octubre de 2026, America/Lima. Continuación de [03F](catalog-shared-memory-performance-2026-10-15.md). Las mediciones usan PostgreSQL local y datos sintéticos; no representan latencia de producción.

## Resultado

**La regresión genérica quedó corregida en el escenario medido.** En el control sobre la misma fixture de 50.000 registros, el p50 pasó de **3,26 s a 2,42 s**, una reducción del **25,7 %**. Los snapshots completos coincidieron byte por byte, incluidos sus 27.500 candidatos. En la matriz, el caso genérico obtuvo **2,43 / 2,45 s de p50/p95**, frente a 3,13 / 3,16 de 03F y 2,58 / 2,61 de 03C.

Se mantuvo la estabilidad: **120/120 canastas mixtas a 50.000 registros, en tandas de cuatro**, con los mismos **64 MiB** de memoria compartida. La repetición de cien intentos obtuvo **4,57 / 7,44 s de p50/p95**. La matriz completa terminó **1.320/1.320 solicitudes** sin fallos; las cuarenta solicitudes pareadas y las cien adicionales también terminaron correctamente. No se modificaron reglas ni datos de aplicación. Un segundo control añadió **100/100 canastas exclusivamente genéricas concurrentes**: el total verificado a 50.000 fue **220/220**, entre ambas fixtures.

## Causa y corrección

El plan de 03F para cinco necesidades genéricas a 50.000 registros muestra un filtro de familias que puede reconstruir `jsonb_build_object(...)` para extraer `retailerId` en cada alternativa de categoría evaluada. La expresión combina los campos de la publicación y del precio, aunque la tienda ya existe como columna escalar. En el plan guardado, el join que aplica ese filtro termina alrededor de 982 ms, frente a unos 36 ms en su hijo que reúne publicaciones y precios. Los tiempos de nodos son inclusivos; no se suman para obtener la duración de una consulta.

03D cambia dos archivos productivos:

- `packages/db/src/generic-offers.ts`: el predicado común de familias acepta la expresión SQL de tienda. Su valor predeterminado conserva el SQL de búsqueda; la canasta usa la columna nativa. La proyección interna de canasta conserva `retailer_id`, además de `listing_id`.
- `packages/db/src/shopping-list.ts`: pasa esa columna al mismo predicado y ordena por `listing_id::text`. El cast conserva el orden textual anterior del UUID sin construir el JSON para leer su ID.

La salida sigue usando los catorce campos de 03A. Los auxiliares nativos no se transfieren al consumidor. Se preservan la relación de precios abiertos de 03F, su materialización una vez por consulta y el join histórico por UUID. No hay cambios de configuración PostgreSQL, índices, migraciones, dependencias, caché ni límites anticipados.

La corrección evita trabajo de proyección; no reduce el conjunto de candidatos ni cambia las reglas de familias. Las categorías siguen vinculadas a su tienda, las pistas de título siguen admitiendo candidatos y la clasificación/compatibilidad de core sigue tomando la decisión final. También se conservan la identidad canónica, el precio ordinario positivo, PEN/UN o KG según corresponda, la disponibilidad triestado, frescura, fingerprint, beneficios, cobertura y optimización de compras. La evidencia de días sigue leyendo estados históricos cerrados y abiertos, con las mismas fechas y condiciones de continuidad.

## Pruebas y comparación reproducible

Antes de modificar el código se comprobaron los hashes de las 144 fuentes/configuraciones del manifiesto final de 03F. El benchmark usa las mismas 80 plantillas de escritores reales, cuatro tiendas, 36 observaciones por publicación y escalas de 2.000, 10.000 y 50.000. A 50.000 hay 1,8 millones de estados de precio; los clones preservan los fingerprints. Esta distribución mide volumen de lectura, no diversidad léxica de 50.000 productos distintos.

La matriz completa mantiene sus 66 combinaciones: búsquedas, filtros, ordenamientos, paginación, modos de precio, canastas mixtas y controles estrictos/genéricos. Cada caso tiene veinte intentos y dos calentamientos excluidos. Se conservan todos los errores; p50/p95 describen éxitos, no respuestas fallidas rápidas. La concurrencia usa tandas de cuatro y un pool de cuatro conexiones. Se añade la misma repetición de cien solicitudes mixtas a 50.000 de 03F.

Además, antes de la matriz de 50.000, una copia diagnóstica del runner ejecuta veinte solicitudes genéricas con SQL 03F y veinte con SQL 03D en la misma fixture. El cliente de referencia revierte exclusivamente la proyección auxiliar, el acceso escalar de tienda y la expresión de orden. No hay una opción de aplicación que cambie el SQL ni un ajuste de base de datos. El orden es 03F y después 03D: es un control pareado, no aleatorizado. Los planes y la comparación de snapshots completos ocurren fuera de los percentiles.

El plan genérico nuevo permite un hash paralelo y un Gather que no aparecían en ese plan de 03F. En el control secuencial pareado, el pico muestreado de `/dev/shm` pasó de 2,22 a 15,40 MiB; la mejora de latencia no implica reducir todas las clases de memoria. Por eso se añade otra corrida en una fixture nueva: cien solicitudes de canastas exclusivamente genéricas, también en tandas de cuatro y con 64 MiB. El caso mixto histórico por sí solo no cubriría esa forma del plan.

Los resultados pareados están separados de la matriz en `pairedMeasurements`; la repetición concurrente está en `stabilityMeasurements`. Los instantes, códigos y muestras originales quedan en JSON/JSONL. El runner diagnóstico conserva las operaciones, fixtures y mediciones del comando normal; su procedencia y diferencias están registradas junto a los resultados.

PostgreSQL mantiene 64 MiB de `/dev/shm`, `shared_buffers=128MB`, `work_mem=4MB`, `hash_mem_multiplier=2`, dos trabajadores por Gather, `enable_parallel_hash=on` y `jit=on`, con los mismos umbrales. El monitor registra memoria compartida y `memory.current` con pausas de 100 ms más el coste de sus comandos. Sus máximos son muestreados, no máximos exactos; la memoria del contenedor incluye PostgreSQL, caché y datos de la fixture en tmpfs. El heap/RSS del proceso Node se mide aparte. El RSS de una etapa también incluye memoria retenida de casos anteriores en ese proceso; esta matriz completa y la corrida final de 03F de solo canastas no tienen el mismo recorrido previo, por lo que un cambio de RSS entre ellas no prueba por sí solo un cambio de memoria por consulta.

### Control pareado de la canasta genérica a 50.000

| SQL | Éxitos | p50 / p95, s | Espera DB p50, ms | CPU Node media, ms | MB JSON |
| --- | ------ | ------------ | ----------------- | ------------------ | ------- |
| 03F | 20/20  | 3,26 / 3,29  | 1857              | 1548               | 18,33   |
| 03D | 20/20  | 2,42 / 2,47  | 1030              | 1543               | 18,33   |

El SQL de referencia coincide con la sentencia completa guardada de 03F al ignorar espacios, con el mismo número de parámetros. Los candidatos, el historial y los bytes del probe pareado coinciden; también se volvió a ejecutar y comparar el snapshot bruto completo. La mejora proviene del trabajo interno de SQL, no de quitar ofertas o campos del resultado. Las cifras de espera DB incluyen transporte y decodificación; no se restan del total como una fase exclusiva.

### Canastas secuenciales

| Registros | Caso                | 03F p50 / p95, s | 03D p50 / p95, s |
| --------- | ------------------- | ---------------- | ---------------- |
| 2.000     | Mixta 5             | 0,14 / 0,15      | 0,12 / 0,14      |
| 2.000     | Mixta 5 beneficios  | 0,14 / 0,15      | 0,12 / 0,14      |
| 2.000     | Mixta 20            | 0,24 / 0,26      | 0,23 / 0,25      |
| 2.000     | Mixta 20 beneficios | 0,24 / 0,26      | 0,23 / 0,26      |
| 2.000     | Mixta 50            | 0,31 / 0,32      | 0,30 / 0,30      |
| 2.000     | Mixta 50 beneficios | 0,32 / 0,32      | 0,30 / 0,32      |
| 2.000     | Estricta 50         | 0,20 / 0,20      | 0,20 / 0,20      |
| 2.000     | Genérica 5          | 0,14 / 0,16      | 0,13 / 0,14      |
| 10.000    | Mixta 5             | 0,60 / 0,61      | 0,51 / 0,51      |
| 10.000    | Mixta 5 beneficios  | 0,60 / 0,61      | 0,50 / 0,51      |
| 10.000    | Mixta 20            | 0,73 / 0,75      | 0,64 / 0,65      |
| 10.000    | Mixta 20 beneficios | 0,73 / 0,74      | 0,64 / 0,65      |
| 10.000    | Mixta 50            | 0,79 / 0,80      | 0,72 / 0,73      |
| 10.000    | Mixta 50 beneficios | 0,80 / 0,85      | 0,71 / 0,76      |
| 10.000    | Estricta 50         | 0,21 / 0,22      | 0,22 / 0,23      |
| 10.000    | Genérica 5          | 0,64 / 0,64      | 0,53 / 0,56      |
| 50.000    | Mixta 5             | 2,95 / 3,00      | 2,48 / 2,51      |
| 50.000    | Mixta 5 beneficios  | 2,96 / 3,00      | 2,49 / 2,50      |
| 50.000    | Mixta 20            | 3,23 / 3,26      | 2,80 / 2,85      |
| 50.000    | Mixta 20 beneficios | 3,25 / 3,30      | 2,83 / 2,88      |
| 50.000    | Mixta 50            | 4,31 / 4,38      | 3,88 / 3,92      |
| 50.000    | Mixta 50 beneficios | 4,31 / 4,33      | 3,87 / 3,95      |
| 50.000    | Estricta 50         | 0,39 / 0,39      | 0,41 / 0,46      |
| 50.000    | Genérica 5          | 3,13 / 3,16      | 2,43 / 2,45      |

### Cuatro solicitudes simultáneas

| Registros | Caso                | Éxitos 03F → 03D | 03F p50 / p95, s | 03D p50 / p95, s |
| --------- | ------------------- | ---------------- | ---------------- | ---------------- |
| 2.000     | Amplia por unitario | 20/20 → 20/20    | 0,22 / 0,33      | 0,25 / 0,35      |
| 2.000     | Mixta 20            | 20/20 → 20/20    | 0,32 / 0,44      | 0,31 / 0,44      |
| 10.000    | Amplia por unitario | 20/20 → 20/20    | 1,30 / 1,84      | 1,30 / 1,83      |
| 10.000    | Mixta 20            | 20/20 → 20/20    | 1,06 / 1,61      | 0,99 / 1,58      |
| 50.000    | Amplia por unitario | 20/20 → 20/20    | 6,27 / 8,83      | 6,81 / 9,56      |
| 50.000    | Mixta 20            | 20/20 → 20/20    | 4,87 / 7,62      | 4,54 / 7,49      |

### Memoria de las canastas concurrentes a 50.000

| Caso                           | Éxitos  | p50 / p95, s | Éxitos/s | Pico `/dev/shm`, MiB | Heap / RSS Node, MiB | Contenedor, MiB |
| ------------------------------ | ------- | ------------ | -------- | -------------------- | -------------------- | --------------- |
| Matriz, cinco tandas           | 20/20   | 4,54 / 7,49  | 0,535    | 5,79                 | 306 / 1347           | 3647            |
| Repetición, veinticinco tandas | 100/100 | 4,57 / 7,44  | 0,544    | 5,79                 | 344 / 1366           | 3683            |

Las treinta tandas usan la misma fixture final. No hubo SQLSTATE 53100 ni respuestas 503, incluidos los calentamientos. La canasta concurrente conserva 27.523 candidatos y 1.652 filas históricas. Esta fixture mixta incluye necesidades sin cobertura completa; un 200 significa evaluación válida, no una compra completa. La integración también cubre canastas completas e importes concretos.

### Planes aislados a 50.000, fuera de los percentiles

| Caso                                 | SQL, ms | JIT, ms | Hash paralelo / Gather | Temporales leídos / escritos |
| ------------------------------------ | ------- | ------- | ---------------------- | ---------------------------- |
| basket-generic-5-standard-paired-03D | 985     | 0       | 1 / 1                  | 1597 / 1600                  |
| basket-generic-5-standard-paired-03F | 1810    | 0       | 0 / 0                  | 2667 / 2670                  |
| basket-generic-5-standard            | 974     | 0       | 1 / 1                  | 1597 / 1600                  |
| basket-mixed-20-standard             | 1288    | 89      | 0 / 0                  | 2642 / 2645                  |
| basket-mixed-5-standard              | 1190    | 0       | 0 / 0                  | 2640 / 2643                  |
| basket-mixed-50-standard             | 2268    | 1077    | 0 / 0                  | 2645 / 2648                  |
| basket-strict-50-standard            | 424     | 71      | 0 / 0                  | 0 / 0                        |

### Controles de búsqueda a 50.000

| Caso                  | 03F p50 / p95, s | 03D p50 / p95, s |
| --------------------- | ---------------- | ---------------- |
| Amplia por relevancia | 3,80 / 4,32      | 3,95 / 5,03      |
| Amplia por unitario   | 3,97 / 4,50      | 4,08 / 5,03      |
| Amplia por total      | 3,73 / 4,37      | 4,02 / 5,08      |
| Selectiva             | 0,62 / 0,63      | 1,07 / 1,08      |
| Sin coincidencias     | 0,61 / 0,61      | 0,32 / 0,33      |
| Familia arroz         | 0,62 / 0,64      | 0,69 / 0,70      |
| Categoría             | 1,21 / 1,29      | 1,23 / 1,31      |
| Categoría y texto     | 4,64 / 4,87      | 4,98 / 5,03      |
| Tienda/unidad         | 4,64 / 4,67      | 3,94 / 4,96      |
| Página 2              | 4,66 / 4,68      | 4,01 / 5,01      |
| Página 10             | 4,68 / 5,29      | 4,01 / 5,01      |
| Amplia con beneficios | 4,65 / 4,72      | 3,96 / 4,97      |

Las quince sentencias completas de búsqueda capturadas en las tres escalas son iguales a las anteriores al ignorar espacios. Sus variaciones de tiempo son controles del entorno y no una optimización de búsquedas atribuible a 03D. Los 66 resúmenes de respuesta, conteos de filas/candidatos/historia y cantidades de consultas por solicitud coinciden con 03F.

### Control adicional de cuatro canastas exclusivamente genéricas

En una **segunda fixture propia**, cien evaluaciones genéricas a 50.000 registros se ejecutaron en veinticinco tandas de cuatro: **100/100 éxitos**, sin errores medidos ni de calentamiento. El p50/p95 fue **4,08 / 6,79 s**, con 0,592 solicitudes exitosas/s. Se mantuvieron los 27.500 candidatos, la ausencia de atribución histórica a necesidades genéricas y el mismo resumen de evaluación de la matriz.

El pico muestreado de `/dev/shm` fue **58,51 MiB de 64 MiB**. El heap/RSS Node fue 207 / 611 MiB; el contenedor alcanzó 3586 MiB, incluyendo los datos de prueba y caché. El EXPLAIN aislado posterior conservó 1 hash paralelo y 1 Gather, con 951 ms de ejecución. La sentencia completa coincide con la canasta genérica de la matriz; los conteos del catálogo y la configuración también coinciden.

Sumando ambos escenarios, **220/220 canastas concurrentes a 50.000** terminaron correctamente en 55 tandas: 120 mixtas y 100 exclusivamente genéricas, distribuidas entre esas dos fixtures. El uso compartido del caso genérico es mayor que el de 03F; esta aceptación demuestra el escenario probado con 64 MiB, no un mínimo universal para otras distribuciones o concurrencias. Conviene conservar ambos controles en las siguientes optimizaciones.

## Equivalencia y validación

La prueba canónica ejecuta el SQL histórico contra la misma fixture, restaurando también las expresiones JSON anteriores de tienda y orden. Compara candidatos, snapshots, historia, identidades y decisiones completas en ambos modos de precio. Conserva los casos de vínculos manuales, obsoletos, inválidos o de baja confianza; ofertas inactivas, no disponibles, antiguas, futuras, con normalización invalidada, sin precio abierto, a cero o con unidad incompatible.

La prueba de proyección comprueba que ambos auxiliares nativos coincidan con sus valores dentro de `listing` y desaparezcan de la salida. Un caso adicional verifica categorías exclusivas de una tienda, la misma categoría en otra tienda, categorías nulas y evidencia solo por título. No se agregaron pruebas que alteren los precios o resultados para acomodar el benchmark.

Validaciones anteriores al benchmark:

- Lint y TypeScript correctos.
- 894 pruebas unitarias y de límites web aprobadas.
- 146 pruebas de integración aprobadas: 134 de DB y doce de handlers web.
- Build de producción correcto.
- Chromium completo: 87 aprobadas y ocho omisiones previstas en la repetición. La primera ejecución tuvo 86 aprobadas y un fallo en el contador de metadata del modo predeterminado: esperaba una lectura y observó dos. Se conservaron el log y la traza; el conjunto se repitió sin cambios y pasó. Es una observación intermitente pendiente de investigación, no una prueba fallida de canastas ni evidencia de un arreglo del contador en 03D.

Al cerrar, se verificó que las 144 fuentes/configuraciones medidas y ambos runners conservaran sus hashes. Los dos esquemas aleatorios propios ya no existen; PostgreSQL conserva todos los parámetros registrados y los 64 MiB de memoria compartida. La comprobación queda en `validation.json`. Formato, referencias de documentación y `git diff --check` también pasaron; sus logs quedan en `validation/`.

## Reproducir y conservar evidencia

```sh
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm test:e2e:fixtures:local
pnpm benchmark:catalog:local --stability-samples=100 --output=.artifacts/03D-nueva-matriz/results.json
```

El wrapper usa `TEST_DATABASE_URL` local explícito y esquemas aleatorios propios; nunca toma `DATABASE_URL` de aplicación. El comando normal reproduce la matriz y las cien solicitudes adicionales. El experimento pareado usa el `runner.ts` guardado con configuración de prueba explícita, sobre la revisión de fuentes identificada por el manifiesto. Los archivos se crean de forma exclusiva; no se sobrescriben baselines.

Para repetir el control exclusivamente genérico usando el runner diagnóstico conservado:

```sh
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm exec node --expose-gc --experimental-strip-types .artifacts/catalog-generic-regression-2026-10-16/generic-concurrency-runner.ts --sizes=50000 --cases=basket-generic-5-standard --concurrency=4 --samples=100 --output=.artifacts/03D-genericas-NUEVA/results.json
```

Evidencia en `.artifacts/catalog-generic-regression-2026-10-16/`, ignorada por Git:

- `before-source-manifest.json`, `before/` y `source-manifest.json`: procedencia de 03F y de la revisión medida.
- `production-03d.diff`: cambios de esta tarea en los dos archivos productivos, separados del trabajo anterior aún sin commit.
- `runner.ts` y `runner-provenance.json`: experimento pareado y origen del harness.
- `generic-concurrency-runner.ts` y su procedencia: mismo harness seleccionando el caso genérico para concurrencia.
- `generic-concurrency/`: repetición adicional de cien canastas genéricas, con resultados y monitor de memoria propios.
- `full/`: muestras originales, planes, conteos, equivalencia de snapshots y memoria.
- `validation/`: resultados de checks, fallo inicial de metadata conservado y repetición de Chromium.

La comparación histórica con 03C/03F sirve de contexto. El control en la misma fixture es la evidencia principal del cambio genérico; no deben atribuirse a 03D fluctuaciones de búsquedas cuyo SQL permanece igual. Los EXPLAIN son aislados, los costes estimados no son tiempos y las comparaciones de bytes no equivalen a tráfico de red de Neon. Los controles de búsqueda de 03F procedían de una corrida cuyo instante `.520` se serializaba como `.52`; pequeñas diferencias históricas de bytes pueden deberse a ese formato. La igualdad completa del control pareado elimina esa diferencia.

## Próximos pasos

La CPU Node del control pareado quedó en 1.548 ms por solicitud con 03F y 1.543 ms con 03D: la corrección SQL no eliminó el coste de procesar 27.500 candidatos y 18,33 MB de JSON. Conviene perfilar ese trabajo antes de agregar más materializaciones o cachés. El JIT de la canasta mixta de cincuenta necesidades también sigue siendo relevante: 1.077 ms dentro de 2.268 ms de ejecución SQL aislada, sin sumar ese componente otra vez al total. La búsqueda por categoría y texto de 03B sigue siendo una tarea independiente. El fallo intermitente de metadata merece una reproducción separada que no debilite su aserción.

### Prompt para perfilar el procesamiento de canastas en Node

```text
Lee AGENTS.md, docs/shopping-list.md, docs/eligibility.md, docs/local-testing.md y el informe de rendimiento 03D del 16 de octubre de 2026. Perfila por separado decodificación, validación, normalización de candidatos, evaluación por necesidad y optimización de canastas con el lector actual.

Identifica trabajo repetido sobre datos inmutables dentro de una solicitud y optimiza solo lo demostrado por el perfil. No introduzcas caché entre solicitudes, no omitas validaciones de seguridad, no limites candidatos prematuramente ni cambies precios, familias, cantidades, disponibilidad, beneficios o historia. Compara snapshots y respuestas completas; repite la matriz y cien solicitudes mixtas y cien exclusivamente genéricas en tandas de cuatro, manteniendo 64 MiB de memoria compartida. Publica también regresiones y variaciones sin significancia demostrada.
```

### Prompt 03B para categoría y texto

```text
Continúa con 03B desde el lector final de 03D. Lee AGENTS.md, docs/public-search.md y los informes 03F/03D. Investiga cómo resolver la lectura filtrada y el contexto global de búsquedas con categoría y texto sin duplicar el recorrido completo.

Conserva ranking, conteos, ofertas completas, unidades/tiendas, descubrimiento, refresco, orden y paginación. Demuestra igualdad de respuestas en los tres ordenamientos y ambos modos de precio. No agregues un LIMIT temprano ni caché. Repite la misma matriz, separando cambios de código de variaciones de planes/estadísticas; verifica las canastas concurrentes con 64 MiB.
```

### Prompt para investigar la prueba intermitente de metadata

```text
Lee AGENTS.md, los docs de la versión de Next instalada, docs/local-testing.md, apps/web/e2e/product-metadata.spec.ts y la evidencia del fallo inicial guardada con el informe 03D. Reproduce por qué el caso del modo predeterminado llegó a contar dos lecturas cuando esperaba una, mientras el conjunto repetido sin cambios pasó.

Determina si el contador recibe otra solicitud, prefetch o una lectura duplicada dentro de la misma petición. Aísla las pruebas si comparten actividad y corrige código productivo solo si la evidencia demuestra el defecto. Conserva una lectura por petición y lecturas nuevas en peticiones posteriores; no aceptes dos como resultado válido, no agregues reintentos para ocultarlo ni caché global. Verifica errores, recuperación y ambos modos con build y Chromium.
```
