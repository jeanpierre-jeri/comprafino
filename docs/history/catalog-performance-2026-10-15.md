# Rendimiento de búsquedas y canastas de CompraFino

Medición local del 15 de octubre de 2026 para el prompt 03 y el hallazgo H03 de la [revisión del proyecto](project-review-2026-10-14.md). Esta evidencia sirve para priorizar mejoras y comparar cambios posteriores; no establece un compromiso de latencia en producción.

La prioridad es corregir los joins de búsquedas filtradas y reducir el volumen transferido. A 50.000 listings, categoría con texto alcanza **21,01 s de mediana**, “arroz” **11,75 s** y una canasta mixta de 50 necesidades **6,50 s**. La prueba concurrente de canastas además revela un límite de memoria compartida del contenedor local. Se midieron **1.320 intentos en 66 combinaciones**, con 1.302 éxitos y 18 fallos; no se cambiaron consultas productivas para obtener estas cifras.

## Límite de disponibilidad del entorno de pruebas

La canasta mixta de 20 necesidades a 50.000 listings, con cuatro solicitudes simultáneas, produjo **18 respuestas 503 de 20 intentos medidos**. Solo dos solicitudes terminaron correctamente, alrededor de 7,56 s; no hay suficientes éxitos para informar un p95. Hubo también cuatro fallos en el calentamiento, separados de esos veinte intentos.

El observador registró SQLSTATE **53100** y PostgreSQL confirmó `could not resize shared memory segment ... No space left on device`. El contenedor dispone de **64 MiB de `/dev/shm`**, comprobados con `docker inspect` y `df`; ese límite es distinto de la RAM de la máquina, del heap Node y de `work_mem`. La búsqueda concurrente amplia sí completó sus veinte solicitudes, con p95 9,51 s. Por tanto, el fallo observado depende de la consulta y de los recursos compartidos de este entorno.

Esta prueba demuestra una limitación del contenedor local para esa carga; **no demuestra una tasa de fallos del despliegue ni una fuga de memoria de la aplicación**. Antes de fijar una capacidad concurrente, se debe repetir con memoria compartida explícita y suficiente en un entorno de pruebas, conservando esta línea base y registrando errores. No se modificó el tamaño del contenedor para ocultar el fallo. Los fallos rápidos no se cuentan como mejoras de latencia.

## Cuellos de botella ordenados por coste observado

### Cruces repetidos en búsquedas filtradas

La combinación de categoría y texto amplio a 50.000 listings tarda **21,01 s de mediana y 21,73 s de p95**. Su consulta filtrada tiene una ejecución EXPLAIN de **24.279 ms**: un `Nested Loop Left Join` entre candidatos y productos canónicos descarta **82.467.944 combinaciones**, mientras un `Materialize` se recorre **15.000 veces**. El plan registra **14.861.628 bloques temporales leídos** en total. Son relecturas acumuladas de datos temporales; no el tamaño físico del catálogo.

El plan estima 45 filas en ese recorrido y obtiene 15.000. El problema no es simplemente mostrar muchos productos: categoría sin texto recupera los mismos 15.000 candidatos en **1,82 s de mediana**, con otro plan. “Arroz” recupera 7.500 candidatos pero tarda **11,75 s**, frente a 0,30 s con 10.000 listings. Este salto no lineal requiere estudiar el plan del join y la proyección canónica antes de aumentar capacidad.

Dos muestras de “arroz” superan 12 segundos de espera DB del cliente local. La [página de búsqueda](../../apps/web/src/app/search/page.tsx) configura `requestTimeoutMs: 12_000` para Neon. Esto muestra poca holgura en este escenario; no acredita un error HTTP de producción porque el benchmark usa otro transporte y no aplica ese timeout.

### Transferir y procesar todos los candidatos antes de paginar

La búsqueda amplia a 50.000 recupera **49.375 ofertas** y **49,15 MB** para mostrar 30; el resto son las 625 ofertas con disponibilidad falsa, correctamente excluidas. El [lector genérico](../../packages/db/src/generic-offers.ts) solicita los candidatos hasta el límite operativo, valida fingerprints y cantidades, aplica reglas y ordena antes de paginar. Las páginas 2 y 10 y el filtro Metro/litros conservan ese volumen de lectura.

El caso de categoría con texto realiza dos consultas y suma **64.375 candidatos** y **64,26 MB**, incluidos los 15.000 que aparecen en ambas lecturas. El pico de heap Node muestreado para ese escenario secuencial es **551 MiB**. El coste extra de la segunda consulta permanece aunque se corrija el join más lento. Se requiere conservar sus indicadores globales de cobertura y descubrimiento al unificarla.

En la búsqueda amplia de 50.000, el plan estima 440 filas y obtiene 49.375, usa ordenación `external merge` de 34.048 kB y un hash dividido en ocho batches. La ejecución SQL observada por separado es 3.224 ms; el cliente y Node añaden transporte, decodificación y reglas. No se deben sumar tiempos inclusivos de todos los nodos para calcular su coste.

### Compilación JIT en canastas

Con 10.000 listings, la canasta mixta de 20 necesidades tiene mediana **1,11 s** y la de 50 **2,39 s**, aunque los candidatos apenas pasan de 5.523 a 5.577. El plan de la segunda dedica **1.359 ms a JIT** de **2.040 ms de ejecución SQL**. El salto no se explica solo por multiplicar el número de necesidades.

En el control de 50 estrictas con 2.000 listings también aparece compilación intensiva, pese a devolver solo 197 candidatos. JIT es, por tanto, un coste independiente del tamaño del payload. Debe experimentarse por consulta y en el entorno de destino; desactivarlo globalmente no es una conclusión de estas mediciones.

### Amplitud de candidatos e historia en canastas

Las canastas mixtas conservan las familias compatibles para las preferencias, además de los productos exactos. En 10.000 listings, incluso cinco necesidades recuperan 5.500 candidatos. Esa amplitud tiene una razón de seguridad: el fallback de una preferencia depende de la identidad actual, no del texto guardado.

La consulta de [evaluación de listas](../../packages/db/src/shopping-list.ts) combina el conteo global, elegibilidad, candidatos e [historia semanal](../../packages/db/src/weekday-recommendation.ts) en un único snapshot. A 50.000 listings, las canastas mixtas de 5/20/50 necesidades tienen medianas de 5,81/6,45/6,50 s y recuperan entre 27.500 y 27.577 candidatos. El control de 50 estrictas baja a 2,48 s, 197 candidatos y 0,70 MB; cinco genéricas tardan 3,91 s, sin lectura de historia exacta. Estos controles ayudan a separar los costes. Se debe reducir reconstrucción de metadata y trabajar con IDs tipados donde sea posible, manteniendo la misma instantánea y el rechazo por desbordamiento. Los tiempos totales actuales no permiten culpar por sí solos al algoritmo que compara combinaciones de tiendas.

## Resultados de latencia

Cada celda muestra **p50 / p95 en segundos**, con veinte muestras secuenciales. Los datos corresponden al lector o handler local descrito en el método.

### Búsquedas

| Escenario                       |       2.000 |      10.000 |        50.000 |
| ------------------------------- | ----------: | ----------: | ------------: |
| Amplia por relevancia           | 0,31 / 0,36 | 1,19 / 1,21 |   4,92 / 6,45 |
| Amplia por precio unitario      | 0,30 / 0,35 | 1,20 / 1,25 |   6,43 / 6,54 |
| Amplia por precio total         | 0,29 / 0,37 | 1,18 / 1,24 |   6,38 / 6,47 |
| Selectiva al 5 %                | 0,06 / 0,07 | 0,24 / 0,25 |   1,23 / 1,26 |
| Sin coincidencias               | 0,02 / 0,02 | 0,12 / 0,13 |   0,38 / 0,67 |
| Familia arroz                   | 0,09 / 0,10 | 0,30 / 0,37 | 11,75 / 12,25 |
| Categoría sin texto             | 0,09 / 0,09 | 0,32 / 0,44 |   1,82 / 1,84 |
| Categoría y texto amplio        | 0,34 / 0,35 | 1,10 / 1,12 | 21,01 / 21,73 |
| Tienda Metro y litros           | 0,29 / 0,32 | 1,10 / 1,17 |   6,32 / 6,46 |
| Página 2 por precio unitario    | 0,23 / 0,31 | 1,09 / 1,16 |   4,93 / 6,48 |
| Página 10 por precio unitario   | 0,24 / 0,31 | 1,09 / 1,17 |   4,90 / 6,47 |
| Amplia por total con beneficios | 0,23 / 0,30 | 1,09 / 1,16 |   4,92 / 6,50 |

La consulta amplia usa `benchcatalogo` y coincide con el 98,75 % de los listings. La selectiva usa `benchselect`; categoría usa `lacteos-huevos`. La combinación tienda/unidad conserva el texto amplio. Las páginas 2 y 10 usan el mismo conjunto de candidatos que la primera.

### Canastas

| Escenario                |       2.000 |      10.000 |      50.000 |
| ------------------------ | ----------: | ----------: | ----------: |
| Mixta de 5 · ordinario   | 0,27 / 0,28 | 1,12 / 1,13 | 5,81 / 5,98 |
| Mixta de 5 · beneficios  | 0,27 / 0,28 | 1,12 / 1,14 | 5,67 / 5,78 |
| Mixta de 20 · ordinario  | 0,37 / 0,39 | 1,11 / 1,12 | 6,45 / 6,71 |
| Mixta de 20 · beneficios | 0,38 / 0,41 | 1,11 / 1,13 | 6,47 / 6,69 |
| Mixta de 50 · ordinario  | 0,46 / 0,49 | 2,39 / 2,46 | 6,50 / 6,63 |
| Mixta de 50 · beneficios | 0,48 / 0,49 | 2,38 / 2,39 | 6,69 / 6,81 |
| 50 estrictas · ordinario | 1,37 / 1,43 | 1,46 / 1,48 | 2,48 / 2,64 |
| 5 genéricas · ordinario  | 0,22 / 0,24 | 0,90 / 0,91 | 3,91 / 3,94 |

### Cuatro solicitudes concurrentes

| Listings | Escenario                | p50 / p95 s | Éxitos / intentos | Solicitudes por segundo de la tanda | Pico heap Node MiB | Pico RSS Node MiB |
| -------: | ------------------------ | ----------: | ----------------: | ----------------------------------: | -----------------: | ----------------: |
|    2.000 | Búsqueda amplia unitario | 0,36 / 0,43 |           20 / 20 |                                9,14 |                136 |               349 |
|    2.000 | Canasta mixta 20         | 0,49 / 0,60 |           20 / 20 |                                6,70 |                 88 |               353 |
|   10.000 | Búsqueda amplia unitario | 1,27 / 1,80 |           20 / 20 |                                2,23 |                181 |               483 |
|   10.000 | Canasta mixta 20         | 1,45 / 2,00 |           20 / 20 |                                2,01 |                133 |               517 |
|   50.000 | Búsqueda amplia unitario | 6,81 / 9,51 |           20 / 20 |                                0,42 |                634 |               932 |
|   50.000 | Canasta mixta 20         |    7,56 / — |            2 / 20 |                                0,08 |                156 |               407 |

El throughput corresponde a cinco tandas cerradas, con veinte solicitudes en total por fila. Los percentiles y throughput corresponden solo a éxitos; un guion indica que no hay muestras suficientes para ese percentil. Los fallos se conservan en los JSON. Los picos son del proceso compartido, incluyen calentamientos y no son memoria por solicitud ni un límite de despliegue.

## Filas, datos y coste por solicitud

| Listings | Caso                | Filas SQL | Candidatos dentro del resultado | Días históricos | JSON MB | Espera DB p50 ms | Total p50 ms | CPU Node media ms |
| -------: | ------------------- | --------: | ------------------------------: | --------------: | ------: | ---------------: | -----------: | ----------------: |
|    2.000 | Amplia              |     1.975 |                           1.975 |               0 |    1,97 |              240 |          305 |                80 |
|    2.000 | Categoría           |       600 |                             600 |               0 |    0,60 |               69 |           86 |                26 |
|    2.000 | Categoría y texto   |     2.575 |                           2.575 |               0 |    2,57 |              362 |          338 |               100 |
|    2.000 | Canasta mixta 50    |         1 |                           1.177 |           4.956 |    1,63 |              377 |          461 |               116 |
|    2.000 | Canasta estricta 50 |         1 |                             197 |           5.516 |    0,70 |            1.343 |        1.369 |                49 |
|   10.000 | Amplia              |     9.875 |                           9.875 |               0 |    9,83 |              912 |        1.186 |               354 |
|   10.000 | Categoría           |     3.000 |                           3.000 |               0 |    3,02 |              227 |          319 |               113 |
|   10.000 | Categoría y texto   |    12.875 |                          12.875 |               0 |   12,85 |            1.169 |        1.101 |               460 |
|   10.000 | Canasta mixta 50    |         1 |                           5.577 |           4.956 |    6,04 |            2.080 |        2.393 |               385 |
|   10.000 | Canasta estricta 50 |         1 |                             197 |           5.516 |    0,70 |            1.434 |        1.458 |                46 |
|   50.000 | Amplia              |    49.375 |                          49.375 |               0 |   49,15 |            3.546 |        4.920 |             1.712 |
|   50.000 | Categoría           |    15.000 |                          15.000 |               0 |   15,11 |            1.381 |        1.817 |               572 |
|   50.000 | Categoría y texto   |    64.375 |                          64.375 |               0 |   64,26 |           24.053 |       21.013 |             2.397 |
|   50.000 | Canasta mixta 50    |         1 |                          27.577 |           4.956 |   28,08 |            4.980 |        6.497 |             1.734 |
|   50.000 | Canasta estricta 50 |         1 |                             197 |           5.516 |    0,70 |            2.455 |        2.483 |                54 |

MB son millones de bytes, MiB son 1.048.576 bytes. Categoría con texto suma candidatos de dos consultas y contiene duplicados entre ellas. La CPU es exclusivamente Node; no incluye CPU de PostgreSQL. El JSON se inspeccionó fuera de las muestras temporizadas.

## Planes SQL representativos

| Listings | Consulta                   | Ejecución SQL ms | JIT ms | Bloques temporales escritos |
| -------: | -------------------------- | ---------------: | -----: | --------------------------: |
|    2.000 | Amplia                     |              300 |      0 |                           0 |
|    2.000 | Selectiva                  |               64 |      0 |                           0 |
|    2.000 | Categoría                  |               59 |      0 |                           0 |
|    2.000 | Categoría y texto filtrada |               75 |      0 |                           0 |
|    2.000 | Categoría y texto global   |              179 |      0 |                           0 |
|    2.000 | Mixta 5                    |              172 |      0 |                           0 |
|    2.000 | Mixta 50                   |              323 |     91 |                           0 |
|    2.000 | Estricta 50                |            1.288 |  1.152 |                           0 |
|    2.000 | Genérica 5                 |              144 |      0 |                           0 |
|   10.000 | Amplia                     |              849 |      0 |                         853 |
|   10.000 | Selectiva                  |              230 |      0 |                           0 |
|   10.000 | Categoría                  |              410 |      0 |                           0 |
|   10.000 | Categoría y texto filtrada |              454 |      0 |                           0 |
|   10.000 | Categoría y texto global   |              650 |      0 |                         853 |
|   10.000 | Mixta 5                    |              834 |     94 |                         913 |
|   10.000 | Mixta 50                   |            2.040 |  1.359 |                         919 |
|   10.000 | Estricta 50                |            1.431 |  1.129 |                         468 |
|   10.000 | Genérica 5                 |              599 |      0 |                         912 |
|   50.000 | Amplia                     |            3.224 |     71 |                       8.069 |
|   50.000 | Selectiva                  |              920 |     75 |                           0 |
|   50.000 | Categoría                  |            1.727 |     84 |                       1.312 |
|   50.000 | Categoría y texto global   |            3.376 |     67 |                       8.069 |
|   50.000 | Categoría y texto filtrada |           24.279 |     69 |                       3.001 |
|   50.000 | Mixta 5                    |            4.147 |    162 |                      17.789 |
|   50.000 | Mixta 50                   |            5.413 |  2.170 |                      18.599 |
|   50.000 | Estricta 50                |            2.438 |  1.728 |                       3.146 |
|   50.000 | Genérica 5                 |            2.395 |    132 |                       5.886 |

Son ejecuciones separadas con instrumentación de EXPLAIN; no percentiles. Los bloques temporales no equivalen a latencia de disco físico: el PostgreSQL de pruebas almacena sus datos en tmpfs. Los planes completos conservan cardinalidades estimadas/reales, loops, buffers y operaciones.

## Alcance y método

Entorno: Node **24.3.0**, PostgreSQL **17.11**, Linux x64, AMD Ryzen 5 7600 con 12 CPU lógicas y aproximadamente 30,5 GiB de RAM. PostgreSQL usa `shared_buffers=128MB`, `work_mem=4MB`, `max_parallel_workers_per_gather=2` y `jit=on`. Docker mantiene 64 MiB de memoria compartida. Los parámetros fueron capturados por la continuación en el mismo host/contenedor, sin cambios de configuración entre ambas ejecuciones.

Se ejecutó el lector real `searchPublicProducts` con `includeComparisons: false`, igual que la página pública actual, y el factory real del POST de evaluación de listas. La búsqueda incluye consulta y transformación del resultado en Node. La canasta incluye validación de entrada, consulta, evaluación, optimización, serialización y lectura de la respuesta JSON. No se midió el servidor HTTP de Next, renderizado RSC, navegador, trabajo posterior a la respuesta, Neon remoto ni despliegue.

Cada escenario secuencial tuvo dos calentamientos excluidos y veinte muestras. Las pruebas concurrentes tuvieron una consulta de captura, una tanda de cuatro calentamientos y veinte solicitudes medidas en cinco tandas de cuatro. Se usó un proceso Node y el pool local existente, limitado a cuatro conexiones. Es una prueba de concurrencia moderada con pausas entre tandas, no una prueba sostenida de saturación o tráfico abierto.

Los percentiles usan rango más próximo: p50 corresponde a la observación décima ordenada y p95 a la decimonovena de veinte. El p95 es orientativo; no se calculó un intervalo de confianza ni un p99. El mismo orden de escenarios se repitió por tamaño, con estadísticas `ANALYZE` antes de las lecturas y recolección de basura de Node antes de cada caso. No se ejecutaron builds ni suites intensivas durante las mediciones. El equipo es compartido y no se fijó afinidad de CPU ni se desactivó el mantenimiento automático de PostgreSQL. Los tiempos entre casos pueden variar aun con SQL idéntico; no se atribuye toda diferencia entre órdenes al comparador de Node. Las propuestas deben validarse después con repeticiones A/B y las mismas entradas.

Se distinguen cuatro medidas:

- **Tiempo total:** tiempo observado por el harness hasta recibir y validar el resultado local.
- **Espera DB del cliente:** ejecución del batch, espera del pool, transporte local y decodificación. Para categoría con texto se suman dos consultas concurrentes; esa suma puede superar el tiempo total y no debe restarse como si fuera una fase secuencial.
- **Ejecución SQL:** observación separada mediante `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. No es una distribución p50/p95 ni incluye enviar el resultado completo a Node. Los tiempos de nodos padres incluyen a sus hijos; no se suman todos los nodos. [Referencia de PostgreSQL 17](https://www.postgresql.org/docs/17/using-explain.html).
- **Datos y memoria:** bytes UTF-8 al serializar las filas SQL ya decodificadas, capturados en un calentamiento excluido. Es una estimación de payload JSON, no bytes de protocolo. Las canastas devuelven una sola fila SQL con miles de candidatos y registros históricos dentro; ambos conteos se conservan. La memoria es del proceso Node, incluye calentamientos y muestreo cada 10 ms más extremos de solicitud. Puede omitir picos síncronos y no incluye PostgreSQL ni Next. El máximo RSS del proceso acumula todas las fases anteriores.

## Catálogo de pruebas

| Tamaño | Por tienda | Grupos exactos | Estados de precio | Días observados | Beneficios | Sin cantidad de paquete |
| -----: | ---------: | -------------: | ----------------: | --------------: | ---------: | ----------------------: |
|  2.000 |        500 |            375 |            72.000 |          71.100 |        250 |                     500 |
| 10.000 |      2.500 |          1.875 |           360.000 |         355.500 |      1.250 |                   2.500 |
| 50.000 |     12.500 |          9.375 |         1.800.000 |       1.777.500 |      6.250 |                  12.500 |

Disponibilidad en la escala mayor: 25.000 verdaderas, 24.375 desconocidas y 625 falsas. “Sin cantidad de paquete” incluye cotizaciones por KG y otras representaciones; no equivale automáticamente a precio por unidad inutilizable.

Los tamaños corresponden a listings de tiendas, no a productos canónicos ni a filas totales de PostgreSQL. Hay veinte plantillas de identidad distribuidas en cuatro tiendas: arroz, aceite, huevos, leche, detergente, papel, agua, champú, fideos, pollo, yogurt y galletas, con variantes de presentación. Todas usan precios sintéticos positivos; los beneficios CMR permanecen separados del precio ordinario. Se conservan disponibilidad verdadera, falsa y desconocida.

Las ochenta ofertas iniciales se admitieron mediante los writers reales de ingesta, normalización y matching. Se registraron treinta y seis observaciones diarias con cambios de precio. Para ejercitar las cuatro semanas completas del lector temporal, solo en estas fixtures se movió la fecha de asociación al inicio de la evidencia de la identidad inalterada. No se establece una autorización para atribuir historia antigua en producción.

El volumen adicional clona bloques completos y sus normalizaciones, grupos, vínculos, precios, beneficios y cobertura. Se cambian los UUID e identificadores de origen; se mantienen todos los campos que intervienen en fingerprints. Se comprobó el fingerprint de cada listing. Los títulos e identidades repetidos limitan la representatividad léxica y comercial: esto mide coste de lectura con un volumen conocido, no rendimiento de ingesta ni cincuenta mil productos distintos. La muestra selectiva coincide con el 5 % del catálogo; no representa una consulta única por SKU. Los UUID y el muestreo de estadísticas de PostgreSQL pueden variar entre corridas.

Las listas mixtas de cinco necesidades contienen tres genéricas, una estricta y una preferida. Las de veinte/cincuenta contienen cinco genéricas y quince/cuarenta y cinco exactas o preferidas. Incluyen leche genérica sin sustitución autorizada, por lo que esas canastas mayores pueden resultar incompletas: no se inventa equivalencia para hacerlas completas. Hay controles adicionales de cincuenta necesidades estrictas y cinco genéricas. Las entradas pasan el esquema real y no duplican necesidades.

## Reproducción y evidencia

Desde la raíz del repositorio:

```sh
pnpm test:db:up
pnpm benchmark:catalog:local
```

La corrida de este informe usó:

```sh
pnpm benchmark:catalog:local --output=.artifacts/catalog-performance-2026-10-15/results.json
```

La primera ejecución conservó 65 casos y 1.300 muestras exitosas en JSONL; se interrumpió al recibir cuatro 503 en el calentamiento de la última canasta concurrente. Se completó únicamente ese caso en un nuevo esquema equivalente, con el harness actualizado para registrar errores, y después se ejecutaron los diagnósticos:

```sh
pnpm benchmark:catalog:local --sizes=50000 --cases=basket-mixed-20-standard --concurrency=4 --diagnostics --output=.artifacts/catalog-performance-2026-10-15-resume/results.json
```

La actualización afecta observabilidad, selección de casos y manejo de fallos; no cambia el lector, handler, fixtures ni SQL productivo. Los hashes conservan ambas versiones. La evidencia combinada distingue las dos ejecuciones y sus esquemas/fechas; no representa una única corrida ininterrumpida.

Estos destinos ya existen y no se deben sobrescribir. Para repetir, omitir `--output` o usar un directorio nuevo. Para una comprobación corta del harness:

```sh
pnpm benchmark:catalog:local --sizes=2000 --samples=2 --warmups=1
```

Dos muestras no generan p95. La guía de [pruebas locales](../local-testing.md#catalog-scale-benchmark) describe los comandos y límites. El nuevo harness está en [workloads web](../../apps/web/testing/catalog-benchmark-cli.ts), [fixtures DB](../../packages/db/src/testing/catalog-benchmark-fixtures.ts) y [observador DB](../../packages/db/src/testing/catalog-benchmark-observer.ts).

La evidencia completa está en `.artifacts/catalog-performance-2026-10-15/`: `results-combined.json` reúne las muestras guardadas y la continuación, indicando su procedencia; `results.json.progress.jsonl` conserva cada caso conforme termina; los archivos `*-catalog.json` contienen distribuciones; `*.plan.json` contienen SQL parametrizado y planes; `provenance.json` identifica el commit base y estado del árbol; `source-manifest.json` conserva hashes de 140 archivos de fuentes, migraciones y configuración. La continuación y sus planes diagnósticos están en el directorio hermano `.artifacts/catalog-performance-2026-10-15-resume/`. Los logs de PostgreSQL y `failure-environment.json` conservan la causa de los 503. `.artifacts/` está ignorado por Git: debe copiarse completo para compartir los datos crudos. Este informe guarda las conclusiones y tablas dentro de la documentación versionable.

Todo se ejecutó con `TEST_DATABASE_URL` explícito y un esquema aleatorio propio en `comprafino_test`. No se consultó la base de aplicación ni se llamó a tiendas. El harness elimina su esquema al terminar. Los baselines históricos existentes se conservan.

## Diagnósticos de causa en el esquema de continuación

Después de medir la concurrencia, se compararon los mismos SQL y parámetros bajo ajustes **solo de la transacción de pruebas**. El catálogo equivalente de 50.000 se había creado de nuevo; estos pares no se mezclan con los percentiles de la corrida original. Hay una ejecución EXPLAIN por condición y ocho planes adicionales a los veintisiete principales.

| SQL                                    | Condición original ms | Ajuste de diagnóstico | Ajustado ms |
| -------------------------------------- | --------------------: | --------------------- | ----------: |
| Familia arroz                          |                13.346 | `enable_nestloop=off` |       1.258 |
| Categoría con texto, consulta filtrada |                22.286 | `enable_nestloop=off` |       1.979 |
| Categoría con texto, consulta global   |                 4.951 | `enable_nestloop=off` |       3.158 |
| Canasta estricta 50                    |                 2.512 | `jit=off`             |       1.844 |

El descenso de las dos consultas filtradas respalda la hipótesis de un plan de joins inadecuado. La mejora recomendada es cambiar la forma/proyección del SQL y demostrar equivalencia, no desactivar nested loops globalmente. Estos ajustes influyen en el plan completo y una ejecución por condición no acredita el p95 de una optimización futura.

En el control JIT, la compilación original registra 1.788 ms, pero quitarla solo reduce el total observado en unos 668 ms: la ejecución sin código compilado también cambia de coste. Por eso el tiempo de compilación no puede presentarse íntegramente como ahorro garantizado. Todos los ajustes expiraron al terminar su transacción.

## Mejoras propuestas y criterios de aceptación

Las propuestas mantienen el catálogo completo como entrada de las reglas de comparación. El primer cambio debería ser pequeño y medirse contra esta misma matriz antes de acumular otros. La ganancia de cada propuesta todavía debe comprobarse; los costes observados no equivalen automáticamente al ahorro que obtendrá una implementación.

1. **Reducir la proyección transferida.** `currentGenericOfferRows` devuelve campos auxiliares de búsqueda, como `title_text`, `identity_text`, `search_identity`, `search_vector` y `folded_title`. La búsqueda usa `select *` y la canasta convierte el registro completo en JSON. Esos auxiliares sirven dentro de SQL; el validador de oferta no los utiliza para construir el resultado público. Una proyección explícita puede evitar transmitirlos conservando todos los campos de identidad, precio, cantidad, disponibilidad, beneficio y asociación. Comprobar igualdad de resultados y medir bytes, memoria y tiempos; no prometer que la reducción de bytes resuelve por sí sola la consulta.
2. **Evitar repetir la lectura al combinar categoría y texto.** Actualmente se obtienen candidatos dentro y fuera de la categoría para conservar cobertura y señales de descubrimiento. Evaluar una lectura que incorpore la pertenencia a la categoría y permita derivar ambos resultados. Debe conservar la procedencia de categorías adquiridas, unidades disponibles, conteos, filtros, paginación y decisiones de descubrimiento. No basta con borrar la consulta global: tiene una función de negocio.
3. **Simplificar el cálculo de elegibilidad exacta para lectores de ofertas.** El lector necesita ID canónico público y número de tiendas, pero reutiliza una relación que agrega ofertas completas, beneficios y textos de comparación. Separar una proyección mínima con exactamente las mismas reglas, compartiendo predicados para evitar dos definiciones divergentes. Verificar grupos manuales, confianza, versión, identidad invalidada, número de tiendas y cotización ordinaria. No mover condiciones entre la elegibilidad del grupo y la frescura de una oferta sin demostrar equivalencia.
4. **Acotar el trabajo temporal y estudiar JIT en canastas.** Conservar el snapshot consistente y el control global de capacidad, pero revisar por qué el conteo y la historia necesitan relaciones amplias. La historia puede trabajar con IDs de listings ya elegibles para las identidades solicitadas, evitando reconstrucciones innecesarias. Separadamente, comparar JIT activado/desactivado solo dentro de transacciones de prueba. PostgreSQL decide JIT según costes estimados; sus costes de compilación pueden superar el beneficio en consultas cortas. No cambiar parámetros globales sin verificar entorno y carga. [Referencia de PostgreSQL 17](https://www.postgresql.org/docs/17/jit-decision.html).
5. **Perfilar el procesamiento Node después de reducir SQL y payload.** La validación de fingerprints y las reglas de cantidades/sustituciones deben permanecer. Medir normalización, clasificación, ordenación y evaluación por necesidad antes de reutilizar resultados dentro de una misma solicitud. Una estructura por familia/identidad puede reducir recorridos repetidos; debe preservar alternativas preferidas, precios CMR, unidades, desconocidos y desempates. La matriz actual no demuestra que el algoritmo combinatorio de tiendas sea el cuello de botella principal.

Los índices, el aumento de memoria SQL y cambios de estrategia de join requieren un experimento aislado con planes antes/después. Encontrar un sort externo o un scan no demuestra por sí solo que falte un índice. No se recomienda introducir Redis, colas o un buscador externo con esta evidencia. Tampoco adelantar un `LIMIT 30`: la selección actual reserva diversidad de unidades y necesita todos los candidatos admitidos para ordenar por precio correctamente.

## Verificación del trabajo

Los controles se ejecutaron después de terminar las mediciones y los diagnósticos para no competir por CPU durante el benchmark:

- Formato Oxfmt, referencias de documentación, Oxlint, TypeScript y `git diff --check`: correctos.
- `pnpm exec turbo run test --force`: **894 pruebas aprobadas**, entre 835 de Vitest y 59 de límites/streaming web.
- `pnpm test:integration:local`: **130 pruebas aprobadas**, 118 de PostgreSQL y 12 de los handlers web. Incluye una nueva regresión del observador que mezcla consultas concurrentes exitosas y fallidas, comprueba el SQLSTATE y verifica la recuperación de la conexión tras rollback.
- `pnpm exec turbo run build --force`: build de producción correcto.
- `pnpm test:e2e:fixtures:local`, después del build: **87 pruebas Chromium aprobadas y 8 opcionales omitidas** por la configuración controlada. Incluye las regresiones de producto/metadata, búsquedas y canastas.
- Se comprobó que los dos esquemas usados para las mediciones ya no existen. El contenedor de pruebas preexistente sigue disponible.

Estos checks verifican la corrección del código y del harness; no convierten en exitosos los 18 intentos fallidos del benchmark. El informe conserva ese fallo de disponibilidad y los límites del entorno. En este paso se añadieron herramientas de medición y documentación; las optimizaciones recomendadas siguen pendientes.

## Prompts para las siguientes tareas

### Prompt 03 A Reducir bytes sin cambiar resultados

```text
Lee AGENTS.md, docs/eligibility.md y docs/history/catalog-performance-2026-10-15.md. Implementa una proyección SQL explícita para búsquedas y snapshots de canasta que evite devolver los campos auxiliares usados solo para filtrar/ordenar dentro de SQL. Conserva todos los datos requeridos por genericProductOffer y los predicados actuales. No añadas límites tempranos, caché, dependencias ni índices.

Añade una regresión que compare resultados completos entre las consultas de referencia y las nuevas en fixtures con cantidades desconocidas, KG/UN, varias unidades, beneficios, disponibilidad desconocida/falsa e identidad inválida. Repite benchmark:catalog:local a 2000/10000/50000 y entrega bytes, memoria, p50/p95 y planes antes/después en nuevos archivos .artifacts. No uses la base de aplicación. Ejecuta los checks de AGENTS.md.
```

### Prompt 03 B Unificar la lectura de categoría y texto

```text
Lee AGENTS.md y el informe de rendimiento del 15 de octubre. Corrige la duplicación de candidatos de searchPublicProducts cuando hay categoría y texto. Diseña una lectura consistente que permita obtener los resultados de categoría y los indicadores globales necesarios para descubrimiento, sin cambiar categorías adquiridas ni reglas de comparación.

Conserva exactamente ofertas ordenadas, totalOffers, availableUnits, usefulResultCount, discoveryRetailers, refreshListingIds, hasMore y páginas 1/2/10 para los tres órdenes y ambos priceMode. Prueba los casos de categoría vacía, inactiva, múltiples rutas y coincidencias fuera de categoría. Mide consultas, filas, bytes y p50/p95 con el harness aislado. No elimines señales de descubrimiento para reducir el contador SQL ni hagas llamadas a tiendas.
```

### Prompt 03 C Aligerar la elegibilidad canónica

```text
Lee AGENTS.md, docs/catalog-matching.md, docs/eligibility.md y el informe de rendimiento del 15 de octubre. Investiga la relación eligibleProducts usada por los lectores genéricos. Implementa, si los planes confirman la mejora, una proyección mínima de identidad pública y número de tiendas para los recorridos que no necesitan el JSON completo de comparación.

Comparte las reglas de elegibilidad con el lector de producto y demuestra equivalencia con grupos válidos, manuales, obsoletos, de baja confianza, invalidados y con una sola tienda. Preserva precio ordinario positivo, disponibilidad triestado y semántica temporal. Conserva IDs de listas y límites de capacidad. Compara planes ANALYZE/BUFFERS y latencia a las tres escalas en esquemas propios. No cambies matching ni añadas infraestructura.
```

### Prompt 03 D Reducir el coste de canastas e historia

```text
Lee AGENTS.md y docs/history/catalog-performance-2026-10-15.md. Usa las canastas mixta de 50 y estricta de 50 como casos principales. Separa el coste de JIT, conteo global, elegibilidad, candidatos y lectura de 28 días. Primero realiza un experimento JIT on/off limitado a transacciones del esquema de pruebas; no cambies configuración global.

Propón e implementa una simplificación pequeña del SQL temporal o del conteo si reduce el coste medido manteniendo una única instantánea consistente. Conserva el rechazo por desbordamiento, fecha de asociación, huecos de observación, precios ordinarios, compatibilidad de sustitutos y tres planes de tiendas. No atribuyas historia exacta a genéricos ni elimines alternativas preferidas. Añade regresiones, repite los tamaños 2000/10000/50000 y reporta resultados antes/después sin sobrescribir baselines.
```

### Prompt 03 E Verificar la latencia HTTP antes de fijar objetivos

```text
Después de las optimizaciones medidas, amplía las pruebas de rendimiento con un servidor Next de producción construido localmente y el preload de transporte de pruebas existente. Usa únicamente TEST_DATABASE_URL explícito y un esquema propio. Mide GET /search y POST /api/list/evaluate, respuestas completas, errores y concurrencia moderada con las mismas fixtures y parámetros del informe del 15 de octubre.

Separa lector/handler, HTTP Next, renderizado y trabajo after; registra memoria del proceso servidor y timeouts reales. No mezcles estas cifras con las muestras locales actuales ni extrapoles al despliegue. Guarda nuevas muestras, planes y hashes de código. Propón después un objetivo de latencia y una prueba en un entorno de despliegue de pruebas, sin escribir en la base de aplicación ni llamar a tiendas.
```

### Prompt 03 F Repetir concurrencia con recursos explícitos

```text
Lee AGENTS.md, docs/local-testing.md y el informe de rendimiento del 15 de octubre. El contenedor PostgreSQL de pruebas tiene 64 MiB de memoria compartida y la canasta de 20 necesidades a 50000 listings produjo 18 fallos 503 de 20 solicitudes, SQLSTATE 53100.

Prepara una configuración de pruebas con memoria compartida explícita y suficiente, sin tocar despliegue ni destruir recursos de otras pruebas. Conserva la medición original. Repite el caso con cuatro solicitudes concurrentes, registrando todos los intentos, errores, memoria Node/PostgreSQL, throughput exitoso y percentiles solo cuando haya muestras suficientes. Comprueba que reducir los errores no oculte un cuello de botella de CPU o consultas. Documenta exactamente el cambio de entorno y no presentes el resultado como capacidad de producción.
```
