# Búsquedas con categoría y texto y estabilidad de canastas 03B

Fecha: 16 de octubre de 2026, America/Lima. Continuación del [lector final de 03D](catalog-generic-performance-2026-10-16.md). Las cifras corresponden a datos sintéticos y PostgreSQL local, sin medir HTTP de Next ni el despliegue.

## Resultado

**La página pública resuelve categoría y texto con una consulta de ofertas en vez de dos, conservando la respuesta completa.** En el control pareado a 50.000 registros, la mediana pasó de **4,57 s a 4,14 s**, una reducción del **9,4 %**. Los bytes JSON bajaron de **42,77 a 33,88 MB**, un **20,8 %** menos. El **p95 pasó de 5,21 a 5,23 s**: este control no acredita una mejora del p95.

La matriz terminó con **1.320/1.320 solicitudes correctas**, más cuarenta solicitudes pareadas y doscientas adicionales. A 50.000 se verificaron **220/220 canastas en tandas de cuatro**: veinte mixtas de la matriz, cien mixtas adicionales y cien exclusivamente genéricas, sin errores medidos ni de calentamiento. Se mantuvieron los **64 MiB** de memoria compartida; los picos muestreados de las repeticiones fueron **5,79 MiB** para mixtas y **58,51 MiB** para genéricas.

## Trabajo duplicado y corrección

La página pública llama a `searchPublicProducts` con `includeComparisons: false`. Cuando hay categoría y texto útil, 03D ejecuta dos consultas genéricas en paralelo: una restringida a la categoría y otra global para cobertura y descubrimiento. Las ofertas de la categoría se transfieren, validan y normalizan en ambas. El contexto global es necesario; la duplicación de sus candidatos no lo es.

03B lee el conjunto global una vez y añade un booleano `matchesCategory` calculado mediante el predicado de fuentes adquiridas y el UUID nativo de la publicación. El booleano se valida en la frontera DB. Cada oferta se valida y normaliza una vez; las referencias a las ofertas admitidas se separan en el conjunto global y su subconjunto de categoría.

La selección y el orden de familias se aplican a cada conjunto; después se conservan los filtros por tienda/unidad, los tres ordenamientos y la paginación. El conjunto de categoría sigue determinando resultados, total, opciones de unidades e IDs de refresco. El conjunto global sigue determinando cobertura útil y tiendas con poca oferta para descubrimiento. Una categoría vacía no equivale a ausencia global del producto. Las membresías múltiples no duplican publicaciones y las fuentes inactivas no aportan categoría.

El límite global de 50.001 candidatos se comprueba antes de validar y dividir las ofertas; más de 50.000 sigue siendo un error, incluso si la categoría está vacía. No se añade un límite temprano, caché, índice, migración, dependencia ni configuración PostgreSQL. Las reglas de precios ordinarios, beneficios, frescura, disponibilidad triestado, fingerprints y elegibilidad canónica se conservan.

El cambio productivo se concentra en `packages/db/src/generic-offers.ts`. La proyección compartida de catorce campos no cambia; el indicador de categoría se añade solo a la lectura combinada y no aparece en el objeto público ni en canastas. Las búsquedas sin categoría y la navegación por categoría sin texto útil conservan sus sentencias. La ruta interna opcional con comparaciones canónicas conserva sus dos consultas paginadas de productos y comparte una consulta de ofertas: pasa de cuatro a tres sentencias. La página pública pasa de dos a una.

## Método y procedencia

Antes de modificar las fuentes se verificaron los 144 hashes del manifiesto final de 03D. Se guardó una copia íntegra de su lector para el control pareado. Los cambios locales de tareas anteriores permanecen intactos; el diff exclusivo de esta tarea queda separado en la evidencia.

La matriz conserva las 66 combinaciones, 2.000/10.000/50.000 publicaciones, veinte intentos y dos rondas de calentamiento por caso. En los casos concurrentes, el calentamiento comprende un sondeo individual y una tanda de cuatro; sus tiempos se excluyen. Se usan las mismas ochenta plantillas de escritores reales, cuatro tiendas y 36 observaciones por publicación. A 50.000 hay 1,8 millones de estados de precio. Los clones conservan fingerprints; la distribución repetida mide volumen de lectura y no diversidad de 50.000 títulos diferentes.

Antes de medir la matriz de 50.000, el runner diagnóstico ejecuta veinte solicitudes de categoría/texto con el lector guardado de 03D y veinte con 03B en la misma fixture. El orden es fijo, no aleatorizado. Fuera de los tiempos medidos, compara respuestas completas en ambos modos de precio y los tres ordenamientos, usando la página 2. Guarda igualdad estructural, hashes y bytes serializados. Las regresiones de integración cubren además páginas 1/2/10, filtros, familias y límites.

Las mediciones pareadas quedan en `pairedMeasurements`, separadas de la matriz. Al terminar se añaden cien canastas mixtas y cien exclusivamente genéricas a 50.000, cada grupo en veinticinco tandas de cuatro. Ambas repeticiones usan la misma fixture de esta corrida. 03D había ejecutado su control genérico en otra fixture propia; las comparaciones históricas de memoria deben considerar el recorrido previo del proceso.

Los percentiles describen solicitudes exitosas; todos los errores y fallos de calentamiento se conservan. EXPLAIN se ejecuta fuera de los percentiles. La espera DB incluye cola del pool, SQL, transporte y decodificación; las dos consultas de 03D se solapan y sus tiempos no deben sumarse como latencia de pared. Los bytes son JSON de filas decodificadas, no tráfico de red de Neon.

El p50 es la mediana: la mitad de las muestras tarda ese tiempo o menos. El p95 es el percentil 95 por rango más próximo y requiere al menos veinte éxitos en este harness. Son estadísticas descriptivas, sin intervalo de confianza. La CPU media de Node expresa trabajo de proceso por solicitud; tampoco se suma a EXPLAIN o a la espera DB para reconstruir la latencia.

El monitor mide `/dev/shm` y memoria del contenedor con pausas de 100 ms más el coste de sus comandos. Son máximos muestreados. Como el reloj del monitor tiene resolución de segundos, solo se incluyen segundos completos dentro de cada intervalo medido; se excluyen las fronteras para no atribuir memoria del caso siguiente al anterior. La memoria del contenedor incluye PostgreSQL, caché y los datos sintéticos en tmpfs; heap/RSS de Node se registran aparte, incluyen calentamientos y pueden incluir memoria retenida de etapas anteriores. El límite compartido continúa en 64 MiB.

## Resultados de rendimiento

### Control pareado a 50.000 registros

| Lector | Consultas | p50 / p95, s | Filas | MB JSON | CPU Node media, ms |
| ------ | --------- | ------------ | ----- | ------- | ------------------ |
| 03D    | 2         | 4,57 / 5,21  | 64375 | 42,77   | 2293               |
| 03B    | 1         | 4,14 / 5,23  | 49375 | 33,88   | 1751               |

La media total pasó de 4,72 a 4,60 s, y el rendimiento secuencial de 0,212 a 0,217 solicitudes/s. La mejora de mediana no significa que todos los intentos sean un 9,4 % más rápidos; las muestras completas conservan esa dispersión.

Los dos lectores se ejecutaron sobre la misma fixture y el mismo instante lógico. Se compararon seis respuestas completas adicionales, fuera de los percentiles: ambos modos de precio, los tres ordenamientos y página 2. Coincidieron estructuralmente, incluidos IDs, ofertas, importes, unidades, conteos, descubrimiento y refresco. Los hashes y bytes de esas respuestas están en `50000-response-equivalence.json`.

### Categoría y texto en las tres escalas

| Registros | 03D p50 / p95, s | 03B p50 / p95, s | Filas 03D → 03B | MB JSON 03D → 03B |
| --------- | ---------------- | ---------------- | --------------- | ----------------- |
| 2000      | 0,17 / 0,22      | 0,16 / 0,16      | 2575 → 1975     | 1,71 → 1,36       |
| 10000     | 0,90 / 0,99      | 0,70 / 0,71      | 12875 → 9875    | 8,55 → 6,78       |
| 50000     | 4,98 / 5,03      | 4,21 / 5,32      | 64375 → 49375   | 42,77 → 33,88     |

### Controles de búsqueda completos

| Registros | Caso                | Simultáneas | 03D p50 / p95, s | 03B p50 / p95, s |
| --------- | ------------------- | ----------- | ---------------- | ---------------- |
| 2000      | Amplia/relevancia   | 1           | 0,17 / 0,17      | 0,16 / 0,16      |
| 2000      | Amplia/unitario     | 1           | 0,16 / 0,17      | 0,16 / 0,19      |
| 2000      | Amplia/total        | 1           | 0,16 / 0,17      | 0,16 / 0,16      |
| 2000      | Selectiva           | 1           | 0,04 / 0,04      | 0,03 / 0,03      |
| 2000      | Sin coincidencias   | 1           | 0,02 / 0,02      | 0,02 / 0,02      |
| 2000      | Familia arroz       | 1           | 0,05 / 0,06      | 0,05 / 0,05      |
| 2000      | Categoría sin texto | 1           | 0,06 / 0,06      | 0,06 / 0,06      |
| 2000      | Tienda/unidad       | 1           | 0,21 / 0,21      | 0,21 / 0,22      |
| 2000      | Página 2            | 1           | 0,22 / 0,24      | 0,21 / 0,21      |
| 2000      | Página 10           | 1           | 0,21 / 0,23      | 0,21 / 0,21      |
| 2000      | Amplia/beneficios   | 1           | 0,21 / 0,22      | 0,21 / 0,21      |
| 2000      | Amplia/unitario     | 4           | 0,25 / 0,35      | 0,22 / 0,33      |
| 10000     | Amplia/relevancia   | 1           | 0,88 / 0,90      | 0,86 / 0,87      |
| 10000     | Amplia/unitario     | 1           | 0,88 / 0,90      | 0,86 / 0,86      |
| 10000     | Amplia/total        | 1           | 0,89 / 0,95      | 0,85 / 0,86      |
| 10000     | Selectiva           | 1           | 0,15 / 0,16      | 0,15 / 0,15      |
| 10000     | Sin coincidencias   | 1           | 0,13 / 0,14      | 0,12 / 0,12      |
| 10000     | Familia arroz       | 1           | 0,21 / 0,21      | 0,20 / 0,20      |
| 10000     | Categoría sin texto | 1           | 0,23 / 0,24      | 0,22 / 0,34      |
| 10000     | Tienda/unidad       | 1           | 0,90 / 0,92      | 0,85 / 0,86      |
| 10000     | Página 2            | 1           | 0,89 / 0,91      | 0,86 / 0,88      |
| 10000     | Página 10           | 1           | 0,89 / 0,91      | 0,86 / 0,87      |
| 10000     | Amplia/beneficios   | 1           | 0,88 / 0,90      | 0,86 / 0,87      |
| 10000     | Amplia/unitario     | 4           | 1,30 / 1,83      | 1,26 / 1,76      |
| 50000     | Amplia/relevancia   | 1           | 3,95 / 5,03      | 4,63 / 5,04      |
| 50000     | Amplia/unitario     | 1           | 4,08 / 5,03      | 4,67 / 5,12      |
| 50000     | Amplia/total        | 1           | 4,02 / 5,08      | 4,94 / 5,10      |
| 50000     | Selectiva           | 1           | 1,07 / 1,08      | 0,66 / 0,67      |
| 50000     | Sin coincidencias   | 1           | 0,32 / 0,33      | 0,63 / 0,66      |
| 50000     | Familia arroz       | 1           | 0,69 / 0,70      | 0,81 / 0,84      |
| 50000     | Categoría sin texto | 1           | 1,23 / 1,31      | 1,22 / 1,32      |
| 50000     | Tienda/unidad       | 1           | 3,94 / 4,96      | 4,54 / 4,95      |
| 50000     | Página 2            | 1           | 4,01 / 5,01      | 4,58 / 5,04      |
| 50000     | Página 10           | 1           | 4,01 / 5,01      | 4,58 / 5,03      |
| 50000     | Amplia/beneficios   | 1           | 3,96 / 4,97      | 4,50 / 4,83      |
| 50000     | Amplia/unitario     | 4           | 6,81 / 9,56      | 7,07 / 9,84      |

### Canastas completas

| Registros | Caso                      | Simultáneas | 03D p50 / p95, s | 03B p50 / p95, s |
| --------- | ------------------------- | ----------- | ---------------- | ---------------- |
| 2000      | basket-mixed-5-standard   | 1           | 0,12 / 0,14      | 0,12 / 0,13      |
| 2000      | basket-mixed-5-benefits   | 1           | 0,12 / 0,14      | 0,12 / 0,13      |
| 2000      | basket-mixed-20-standard  | 1           | 0,23 / 0,25      | 0,21 / 0,23      |
| 2000      | basket-mixed-20-benefits  | 1           | 0,23 / 0,26      | 0,22 / 0,23      |
| 2000      | basket-mixed-50-standard  | 1           | 0,30 / 0,30      | 0,28 / 0,30      |
| 2000      | basket-mixed-50-benefits  | 1           | 0,30 / 0,32      | 0,28 / 0,29      |
| 2000      | basket-strict-50-standard | 1           | 0,20 / 0,20      | 0,19 / 0,19      |
| 2000      | basket-generic-5-standard | 1           | 0,13 / 0,14      | 0,12 / 0,13      |
| 2000      | basket-mixed-20-standard  | 4           | 0,31 / 0,44      | 0,29 / 0,41      |
| 10000     | basket-mixed-5-standard   | 1           | 0,51 / 0,51      | 0,48 / 0,49      |
| 10000     | basket-mixed-5-benefits   | 1           | 0,50 / 0,51      | 0,47 / 0,49      |
| 10000     | basket-mixed-20-standard  | 1           | 0,64 / 0,65      | 0,61 / 0,62      |
| 10000     | basket-mixed-20-benefits  | 1           | 0,64 / 0,65      | 0,61 / 0,62      |
| 10000     | basket-mixed-50-standard  | 1           | 0,72 / 0,73      | 0,67 / 0,68      |
| 10000     | basket-mixed-50-benefits  | 1           | 0,71 / 0,76      | 0,67 / 0,69      |
| 10000     | basket-strict-50-standard | 1           | 0,22 / 0,23      | 0,21 / 0,21      |
| 10000     | basket-generic-5-standard | 1           | 0,53 / 0,56      | 0,51 / 0,51      |
| 10000     | basket-mixed-20-standard  | 4           | 0,99 / 1,58      | 0,95 / 1,51      |
| 50000     | basket-mixed-5-standard   | 1           | 2,48 / 2,51      | 2,61 / 2,63      |
| 50000     | basket-mixed-5-benefits   | 1           | 2,49 / 2,50      | 2,62 / 2,66      |
| 50000     | basket-mixed-20-standard  | 1           | 2,80 / 2,85      | 2,94 / 3,01      |
| 50000     | basket-mixed-20-benefits  | 1           | 2,83 / 2,88      | 2,93 / 3,02      |
| 50000     | basket-mixed-50-standard  | 1           | 3,88 / 3,92      | 3,04 / 3,12      |
| 50000     | basket-mixed-50-benefits  | 1           | 3,87 / 3,95      | 3,13 / 3,31      |
| 50000     | basket-strict-50-standard | 1           | 0,41 / 0,46      | 0,42 / 0,44      |
| 50000     | basket-generic-5-standard | 1           | 2,43 / 2,45      | 2,51 / 2,60      |
| 50000     | basket-mixed-20-standard  | 4           | 4,54 / 7,49      | 4,89 / 7,94      |

Los 66 resúmenes funcionales coinciden con 03D. Se verificaron 24 archivos de planes con sentencias completas sin cambios, correspondientes a controles de búsqueda y canastas; el SQL de referencia pareado coincide con el SQL guardado de 03D. Las variaciones históricas de esos controles no demuestran por sí solas una mejora o regresión atribuible a este cambio.

### Repeticiones concurrentes a 50.000

| Canasta    | Éxitos  | p50 / p95, s | Éxitos/s | Pico compartido, MiB | Heap / RSS Node, MiB | Contenedor, MiB |
| ---------- | ------- | ------------ | -------- | -------------------- | -------------------- | --------------- |
| Mixta 20   | 100/100 | 5,09 / 7,96  | 0,510    | 5,79                 | 291 / 1051           | 2770            |
| Genérica 5 | 100/100 | 4,89 / 7,75  | 0,529    | 58,51                | 248 / 1077           | 2668            |

Las canastas conservan su SQL, sus candidatos y su historia. Un 200 en la fixture mixta acredita una evaluación válida, no cobertura completa de todas sus necesidades. Los casos completos y sus importes concretos siguen cubiertos por integración y Chromium. El plan genérico aislado conserva un hash paralelo y un Gather, como en 03D, y exige más memoria compartida que la composición mixta; las 55 tandas verifican esta configuración y distribución, no una garantía para cualquier carga.

### Planes aislados del control pareado

| Sentencia       | SQL, ms | JIT, ms | Temporales leídos / escritos |
| --------------- | ------- | ------- | ---------------------------- |
| 03B sentencia 1 | 3093    | 0       | 3156 / 3167                  |
| 03D sentencia 1 | 987     | 0       | 971 / 974                    |
| 03D sentencia 2 | 2606    | 0       | 3156 / 3167                  |

En el plan compartido, el subplan de pertenencia a fuentes usa un Nested Loop, se ejecuta una vez y obtiene 15.000 filas en 1,71 ms inclusivos. No se suman tiempos inclusivos de padres e hijos. Los planes antiguos se ejecutaron de forma aislada para EXPLAIN; sus duraciones no equivalen a la latencia de las dos consultas paralelas de una solicitud.

## Equivalencia y comprobaciones

`category-search.integration.test.ts` compara toda la respuesta con la composición de dos lecturas congelada en `testing/legacy-category-search.ts`. Cubre precios standard/benefits, relevancia/precio unitario/precio total, páginas 1/2/10, filtros de tienda/unidad, familias, coincidencias numéricas y ausencia de resultados. Verifica pertenencia a varias rutas, ausencia de membresía, fuentes inactivas, identidad invalidada y una asociación canónica rechazada. Una publicación de arroz incluida expresamente en rutas de lácteos comprueba que la categoría proviene de adquisición, no del título.

La prueba observa una consulta pública en vez de dos y compara también `refreshListingIds`, `availableUnits`, `usefulResultCount`, `discoveryRetailers`, `hasMore` y resultados canónicos opcionales. Inyecta membresía inválida y un exceso de filas mediante SQL real dentro del esquema propio para comprobar rechazo en la frontera, incluso sin resultados de categoría. Las suites de proyección y elegibilidad continúan comparando precios, identidades, historia y canastas.

Pasaron lint, TypeScript, 894 pruebas unitarias/de límites web, 151 pruebas de integración (139 DB y doce web), build de producción y Chromium (87 aprobadas, ocho omisiones previstas). La suite nueva de cinco casos volvió a pasar después de reorganizar aserciones para cumplir lint; no se debilitó ninguna expectativa. Los diagnósticos iniciales de lint se conservan. Chromium pasó en su primera ejecución de esta tarea; eso no explica ni corrige el fallo intermitente de metadata registrado en 03D.

Al terminar la medición se verificaron los 146 hashes de fuentes y las copias del runner y del lector anterior. Ambos esquemas propios ya no existen y todos los parámetros de PostgreSQL permanecen iguales, incluido el límite de 64 MiB. La versión medida se conserva íntegra. El único ajuste posterior del lector añade llaves al `continue` existente para cumplir el estilo de AGENTS.md; se verificó que no cambia ninguna expresión, predicado o decisión. `final-readability.json` distingue los hashes medidos y entregados. Tras ese ajuste volvieron a pasar lint, TypeScript, las 894 pruebas unitarias y el build. Formato, referencias de documentación y `git diff --check` también pasaron. Las comprobaciones finales y la limpieza quedan registradas en `validation/` y `validation.json`.

## Reproducción y evidencia

```sh
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm test:e2e:fixtures:local
pnpm benchmark:catalog:local --stability-samples=100 --output=.artifacts/03B-matriz-NUEVA/results.json
```

El comando habitual reproduce la matriz y la repetición mixta. El runner diagnóstico guardado añade el control pareado, la equivalencia completa y las cien canastas exclusivamente genéricas:

```sh
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm exec node --expose-gc --experimental-strip-types .artifacts/catalog-category-performance-2026-10-16/runner.ts --stability-samples=100 --output=.artifacts/03B-control-NUEVO/results.json
```

Ambos usan exclusivamente configuración de pruebas explícita y esquemas aleatorios propios. No se lee `DATABASE_URL` de aplicación, se llama a tiendas ni se ejecuta despliegue. Los artefactos se crean sin sobrescribir baselines.

Evidencia local en `.artifacts/catalog-category-performance-2026-10-16/`, ignorada por Git:

- `before/`, manifiestos y `production-03b.diff`: fuentes y cambios medidos.
- `measured-source-manifest.json`, `measured-generic-offers.ts` y `final-readability.json`: revisión exacta medida y diferencia de estilo con la entrega; `source-manifest.json` identifica las fuentes finales.
- `runner.ts` y `runner-provenance.json`: copia diagnóstica del harness y procedencia.
- `pilot/`: control inicial a 10.000, cinco intentos por perfil; no acredita p95.
- `full/`: matriz, controles pareados, respuestas completas verificadas, planes y muestras de memoria.
- `full/memory-summary.json` usa segundos completos dentro de cada intervalo. El primer cálculo se conserva aparte como `memory-summary-initial-boundary-overlap.json`: su último segundo mixto incluía el comienzo del calentamiento genérico y no debe utilizarse como pico del caso mixto.
- `validation/` y `validation.json`: comprobaciones y cierre de esquemas propios.

## Siguiente trabajo

La lectura combinada aún transfiere 33,88 MB de JSON a 50.000 registros. Eliminar duplicación reduce trabajo, pero no convierte el lector en una medición de experiencia de usuario. El control pareado alternó solicitudes de aproximadamente cuatro y cinco segundos con 03B; no se ha aislado su causa ni se atribuye a GC, PostgreSQL o transporte sin un perfil adicional. Conviene continuar con 03E, medir HTTP de Next y después fijar presupuestos de tiempo para 04. El procesamiento de candidatos en Node y el JIT de canastas siguen siendo candidatos a perfilado; no se cambian umbrales ni se adelanta la paginación sin evidencia.

### Prompt 03E para medir HTTP

```text
Continúa desde el lector final de 03B. Lee AGENTS.md, docs/local-testing.md y el informe de categoría/texto del 16 de octubre de 2026. Usa el build de producción de Next y el transporte de pruebas existente, con TEST_DATABASE_URL explícito y esquemas aleatorios propios.

Mide GET /search y POST /api/list/evaluate con las mismas fixtures de 2.000, 10.000 y 50.000 registros. Separa lector/handler, HTTP, renderizado y trabajo posterior a la respuesta. Incluye errores, cancelación, memoria y cuatro solicitudes simultáneas; conserva los controles mixtos y exclusivamente genéricos. No mezcles estos tiempos con los percentiles del lector ni extrapoles al despliegue. Propón objetivos con la evidencia obtenida y conserva todos los resultados.
```

### Prompt para investigar metadata

```text
Investiga el fallo intermitente de metadata documentado en 03D, conservando la evidencia de que Chromium pasó en 03B. Reproduce y determina si hubo dos lecturas dentro de una petición o interferencia del contador con otra petición/prefetch. Consulta los docs locales de la versión instalada de Next. No aceptes dos lecturas como resultado correcto, no ocultes el problema con reintentos y no introduzcas caché global. Verifica ambos modos, errores y recuperación.
```

El [informe 03D](catalog-generic-performance-2026-10-16.md#próximos-pasos) conserva el prompt de perfilado de canastas; debe usar ahora las fuentes finales de 03B y repetir los dos controles concurrentes.
