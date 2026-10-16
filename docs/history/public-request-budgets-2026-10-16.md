# Prompt 04 — Presupuestos públicos, cancelación y recuperación

Fecha de la verificación: **16 de octubre de 2026**. Proyecto: CompraFino. Continuación de la [medición HTTP 03E](catalog-http-performance-2026-10-16.md).

## Resultado y alcance

Se acotó la espera de búsquedas, fichas, evaluación pública y sincronización de listas. Los límites cubren la operación, el transporte a la base, las sentencias PostgreSQL, la lectura del cuerpo y las solicitudes del navegador. Una escritura cuya respuesta se pierde ahora se distingue de una lectura fallida, y el cliente exige recuperar el estado guardado antes de volver a editar.

El cambio conserva el SQL de selección y comparación, los precios ordinarios positivos, los beneficios separados, la disponibilidad triestado, los fingerprints, la elegibilidad, el ranking, la paginación y las decisiones completas de canasta. Tampoco cambia la política de frescura. Los lectores de catálogo en packages/db y el dominio de comparación conservan sus hashes de 03E; las diferencias se concentran en fronteras de transporte, rutas, coordinación del cliente y pruebas.

El objetivo de este trabajo es **evitar esperas y trabajo SQL indefinidos**, no prometer que las búsquedas ya son rápidas ni imponer un tope monetario global. Los resultados de la repetición de rendimiento aparecen más abajo. No se desplegó, no se consultó la base de aplicación y no se hicieron solicitudes a retailers.

## Qué faltaba y qué se implementó

H04 seguía vigente al comenzar: las listas tenían límites de tamaño, pero evaluación y fichas creaban clientes sin timeout explícito; búsqueda tenía 12 segundos por fetch de base, sin presupuesto de operación ni cancelación SQL. La lectura de cuerpos podía quedarse esperando y el refresco del navegador tampoco tenía una duración máxima propia. Los errores de sincronización usaban la misma respuesta genérica para lecturas y escrituras.

| Frontera                            |                                  Límite nuevo de operación |  Transporte DB |         PostgreSQL |       Declaración para hosting |
| ----------------------------------- | ---------------------------------------------------------: | -------------: | -----------------: | -----------------------------: |
| Búsqueda                            |            15 s para lectura y procesamiento del resultado | 12 s por fetch | 10 s por sentencia |       30 s, incluido `after()` |
| Ficha canónica                      | 15 s comparación y otros 15 s para historial independiente |           12 s |               10 s |                           35 s |
| Ficha de una tienda                 |                   15 s compartidos por detalle e historial |           12 s |               10 s |                           20 s |
| Evaluar canasta                     |                              15 s desde entrada al handler |           12 s |               10 s |                           20 s |
| Leer/escribir lista de cuenta       |                               15 s, incluida autenticación |           12 s |               10 s |                           20 s |
| Registrar demanda después de buscar |                                 10 s para todo el callback |           10 s |                8 s | Dentro de los 30 s de búsqueda |

Además, los cuerpos tienen **5 segundos** dentro del presupuesto del handler y las solicitudes del navegador tienen **20 segundos**, incluida la lectura y validación de la respuesta. Se conservan 128 KiB por cuerpo, 50 necesidades por lista, campos de hasta 120 caracteres, catálogo de 50.000 con fila centinela 50.001 y los límites existentes de búsqueda/historial. Una categoría conocida puede seguir usándose sin texto y la página muestra treinta ofertas.

El tiempo de 15 segundos se eligió a partir del máximo HTTP anterior de aproximadamente 9,99 s y los p95 concurrentes de 9,12–9,53 s de búsqueda y 7,35–7,70 s de las series de canastas. La separación 10/12/15 permite terminar SQL, recibirlo y procesarlo. Es un presupuesto inicial comprobado localmente; el transporte remoto y los arranques en frío requieren validación en un despliegue de pruebas equivalente.

El detalle canónico conserva historial independiente y metadata deduplicada mediante React `cache`. Por eso se declara un máximo de hosting de 35 segundos: **no se presenta esa página como una respuesta completa garantizada en 15 segundos**. La guía operativa completa está en [presupuestos públicos](../request-budgets.md).

## Qué cancela cada límite

1. **Operación y navegador.** Un controlador propaga el aborto al fetch y deja de esperar cuando se agota el presupuesto. Incluso una dependencia que ignore la señal no puede instalar un resultado tardío. Se comprueba también el tiempo transcurrido al terminar trabajo síncrono.
2. **Transporte.** Cada petición Neon recibe una señal nueva, combinada con la señal de la operación. Abortar una petición impide enviar la siguiente consulta con ese cliente; otra petición usa un cliente independiente y puede recuperarse. No se instala la señal de una cuenta en el singleton compartido de autenticación.
3. **PostgreSQL.** Se añade una sentencia de configuración local a la misma transacción HTTP que contiene las consultas originales. El timeout efectivo es el menor entre el presupuesto solicitado y cualquier timeout no nulo ya configurado en PostgreSQL. Nunca se amplía una protección más estricta.
4. **Hosting.** Las cinco declaraciones `maxDuration` aparecen en el manifiesto del build. Su aplicación real corresponde al proveedor. El servidor local `next start` no simula que una función desplegada sea terminada por la plataforma.

La configuración SQL no se hace en una petición aparte ni mediante una suposición sobre parámetros de URL. Se utiliza la transacción HTTP que soporta [Neon](https://neon.com/docs/serverless/serverless-driver); cada batch recibe un pequeño preámbulo y conserva el formato de sus resultados. Una consulta directa pasa a un batch dentro del mismo único viaje HTTP. No se cambian roles, configuración global ni migraciones.

El [timeout de PostgreSQL](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT) se aplica por sentencia. Incluye espera de locks, pero no suma la duración de todo un lote. Los batches públicos de lectura tienen una sentencia de dominio; el registro de descubrimiento tiene lock e inserción, de modo que su SQL puede terminar después de los 10 segundos del callback. Un aborto HTTP no prueba rollback ni cancelación inmediata del servidor.

Hay un límite práctico adicional: JavaScript no interrumpe por la fuerza un bloque síncrono de CPU. El presupuesto rechaza su resultado si llegó tarde, pero no puede garantizar un cronómetro exacto mientras el event loop esté bloqueado. Los límites de datos existentes y la protección del hosting complementan esta frontera. Las páginas Server Component tampoco reciben aquí una señal de desconexión: sus lecturas están acotadas por tiempo; los handlers API sí consumen `Request.signal`.

## Recuperación sin perder listas ni mostrar éxito falso

Una lectura fallida de evaluación devuelve 503 seguro y sin caché. La búsqueda y las fichas conservan sus mensajes recuperables. La búsqueda puede haber enviado cabeceras 200 antes del error, por lo que las pruebas validan el cuerpo completo. El historial fallido conserva su estado de error y no inventa evidencia.

En sincronización, las lecturas y los fallos previos a entrar en mutación devuelven `list_unavailable`. Un fallo no clasificado después de entrar en mutación devuelve **`mutation_uncertain`**: no se sabe si hubo commit. Se mantienen los rechazos conocidos, el conflicto 409 y el rechazo de dominio 422. El agotamiento conocido de revisión se rechaza sin escribir.

Ante un resultado incierto, el navegador conserva el último documento validado en Query y todos los datos anónimos en almacenamiento; oculta temporalmente recomendaciones y edición hasta obtener un GET válido. No copia la lista de cuenta al almacenamiento anónimo. Una respuesta tardía no puede confirmar el cambio, borrar la importación pendiente ni anunciar éxito a otras pestañas. El refresco de foco o una acción explícita puede recuperar el estado. Reintentar una importación conserva el flujo existente: leer primero el estado autoritativo y aplicar después merge/CAS; no reenviar ciegamente la petición perdida.

La evaluación sigue refrescando cada 60 segundos con la pestaña visible y al recuperar foco. Se mantienen ausencia de reintento automático, aislamiento por cuenta/lista/modo y ocultación de recomendaciones mientras se actualizan o hay error. El refresco manual se une a una solicitud ya en curso para evitar cancelar y duplicar trabajo. No se introducen cachés ni se prolonga la validez de un precio.

## Método de la repetición HTTP

Se conserva el método de 03E: producción Next 16.3.8 en proceso independiente, HTTP loopback con cuerpo completo sin compresión, transporte Neon de prueba hacia PostgreSQL 17 local, fixtures de cuatro tiendas y 36 días de historial, veinte observaciones por combinación y calentamientos separados. Las escalas son 2.000, 10.000 y 50.000 listings. Las tandas concurrentes esperan a que terminen SQL y `after()` antes de comenzar la siguiente.

Hay doce búsquedas y ocho canastas secuenciales por escala, cuatro casos concurrentes por escala, y cien canastas mixtas más cien exclusivamente genéricas adicionales a 50.000. Los casos no se sustituyen por ejemplos más fáciles: algunas canastas genéricas/mixtas de la fixture son parciales, exactamente como en 03E. Se comparan decisiones completas contra el lector en la misma fixture, excluyendo únicamente timestamps de evaluación y tiempos internos.

Se añaden sondeos separados de SQL lento a la primera escala: la fixture inserta un `pg_sleep(20)` después del preámbulo de timeout, solo dentro del transporte de pruebas. Se prueban búsqueda y evaluación, tanto esperando el timeout SQL como abortando HTTP a los 100 ms, y se exige una respuesta posterior correcta. Esos fallos deliberados no forman parte de los percentiles ni de la tasa de fallos de la matriz normal.

Se conserva el límite de memoria compartida de **64 MiB**, sin cambiar paralelismo ni `work_mem`. No hubo builds, suites ni otra carga pesada durante la medición. El adaptador local serializa resultados TCP al formato Neon dentro del proceso Next: sus cifras de CPU/RSS y transporte **no equivalen a costes de un despliegue remoto**. Tampoco se miden assets, hidratación ni tráfico de llegada sostenido.

## Dos corridas y un ajuste descubierto por las trazas

La primera corrida (`full/`) completó **1.640/1.640 respuestas medidas válidas y 232/232 calentamientos válidos**. Sin embargo, las trazas revelaron **siete fallos posteriores al envío de la página**: cinco en muestras medidas y dos en calentamientos, todos en búsqueda amplia concurrente a 50.000. Seis alcanzaron el presupuesto de transporte/callback de 5 s y uno el timeout SQL de 3 s. Algunas consultas siguieron hasta terminar después del aborto del fetch. La respuesta visible correcta no bastaba para aceptar ese presupuesto.

Se aumentó únicamente el presupuesto separado de registro de demanda a **10 s por callback/fetch y 8 s por sentencia**, y la declaración de hosting de búsqueda pasó de 25 a 30 s. No se ampliaron los presupuestos 15/12/10 de las lecturas ni se cambiaron reglas, SQL de dominio, fixtures o memoria compartida. También se añadieron contadores de errores SQL/transporte/`after()` a los resúmenes del ejecutor, incluidos calentamientos.

La segunda corrida (`final/`) repitió **todos los cuatro casos concurrentes a las tres escalas**, los sondeos de cancelación y recuperación, y las dos series prolongadas de cien canastas. Completó **440/440 respuestas medidas y 112/112 calentamientos**, con **cero fallos normales de resultados, SQL, transporte o trabajo posterior**. Incluye **240 canastas a 50.000 en tandas de cuatro**: cuarenta en la matriz y doscientas en las series adicionales. Los cuatro errores SQL deliberados se contabilizan aparte.

Las tablas secuenciales pertenecen a la primera corrida; las tablas concurrentes y de recuperación siguientes pertenecen al build final. No se presenta la matriz inicial completa como una repetición del build final. Los manifiestos comprueban que entre ambos solo cambiaron la política del callback, la ruta de búsqueda y los contadores del ejecutor.

## Comprobaciones del código

- **915 pruebas unitarias y de fronteras:** 550 core, 90 DB, 200 scrapers y 75 web/streams.
- **156 pruebas de integración:** 144 DB y doce web, con configuración explícita y esquemas propios.
- **88 pruebas Chromium correctas**, con ocho casos opcionales omitidos por la configuración de fixtures.
- Build de producción, TypeScript, Oxlint, formato, referencias documentales y whitespace correctos.
- El manifiesto final contiene las cinco declaraciones `maxDuration` documentadas.

Las suites unitarias, build y Chromium se repitieron después del ajuste del callback. La integración PostgreSQL conserva el pase del mismo código de base y fronteras; el cambio posterior fue de constantes de la web. El control añadido al ejecutor pasó TypeScript y lint antes de medir. Los logs previos fallidos de desarrollo se conservan y no se presentan como fallos del benchmark.

## Tiempos HTTP secuenciales — primera corrida

Cada celda muestra **p50 / p95 en segundos hasta recibir el cuerpo completo**. Hay veinte respuestas medidas por celda; los calentamientos están excluidos.

| Caso                                | 2.000 registros | 10.000 registros | 50.000 registros |
| ----------------------------------- | --------------: | ---------------: | ---------------: |
| Búsqueda amplia por relevancia      |     0,18 / 0,20 |      0,86 / 1,05 |      4,17 / 5,25 |
| Búsqueda amplia por precio unitario |     0,18 / 0,18 |      0,86 / 0,99 |      4,16 / 5,10 |
| Búsqueda amplia por precio total    |     0,18 / 0,19 |      0,87 / 1,04 |      4,01 / 5,08 |
| Texto selectivo                     |     0,05 / 0,06 |      0,16 / 0,16 |      1,09 / 1,11 |
| Sin resultados                      |     0,03 / 0,03 |      0,08 / 0,08 |      0,33 / 0,34 |
| Familia arroz                       |     0,08 / 0,10 |      0,26 / 0,27 |      0,70 / 0,72 |
| Categoría sin texto                 |     0,09 / 0,11 |      0,35 / 0,37 |      1,30 / 1,36 |
| Categoría con texto                 |     0,19 / 0,25 |      0,89 / 0,91 |      4,41 / 5,04 |
| Tienda y unidad                     |     0,19 / 0,25 |      0,86 / 0,88 |      3,92 / 4,49 |
| Página 2 por precio unitario        |     0,20 / 0,24 |      0,87 / 0,91 |      4,46 / 5,34 |
| Página 10 por precio unitario       |     0,22 / 0,24 |      0,87 / 0,92 |      4,24 / 4,78 |
| Búsqueda con beneficios             |     0,20 / 0,24 |      0,91 / 0,93 |      4,25 / 4,78 |
| Canasta mixta de 5 ordinaria        |     0,14 / 0,14 |      0,52 / 0,54 |      2,69 / 2,79 |
| Canasta mixta de 5 con beneficios   |     0,13 / 0,14 |      0,53 / 0,54 |      2,70 / 2,80 |
| Canasta mixta de 20 ordinaria       |     0,24 / 0,26 |      0,66 / 0,69 |      3,05 / 3,11 |
| Canasta mixta de 20 con beneficios  |     0,24 / 0,26 |      0,66 / 0,68 |      3,04 / 3,09 |
| Canasta mixta de 50 ordinaria       |     0,29 / 0,32 |      0,73 / 0,75 |      3,19 / 3,24 |
| Canasta mixta de 50 con beneficios  |     0,29 / 0,30 |      0,73 / 0,74 |      3,22 / 3,29 |
| Canasta estricta de 50              |     0,20 / 0,20 |      0,23 / 0,24 |      0,44 / 0,45 |
| Canasta genérica de 5               |     0,13 / 0,13 |      0,55 / 0,56 |      2,68 / 2,75 |

## Cuatro solicitudes simultáneas — build final

Veinte respuestas por celda, cinco tandas cerradas de cuatro; p50 / p95 en segundos hasta recibir el cuerpo completo. El ejecutor drena SQL y tareas posteriores antes de cada tanda.

| Caso                         | 2.000 registros | 10.000 registros | 50.000 registros |
| ---------------------------- | --------------: | ---------------: | ---------------: |
| Búsqueda por precio unitario |     0,46 / 0,51 |      2,04 / 2,10 |      6,65 / 9,99 |
| Categoría con texto          |     0,44 / 0,53 |      2,00 / 2,14 |     9,53 / 10,26 |
| Canasta mixta de 20          |     0,37 / 0,51 |      1,12 / 1,76 |      4,96 / 8,16 |
| Canasta genérica de 5        |     0,24 / 0,35 |      0,93 / 1,57 |      4,69 / 7,68 |

## Estabilidad adicional a 50.000 — build final

| Canasta               | Solicitudes válidas | p50 / p95 HTTP, s | Máximo HTTP, s | Pico compartido, MiB | Pico RSS Next, MiB |
| --------------------- | ------------------: | ----------------: | -------------: | -------------------: | -----------------: |
| Canasta mixta de 20   |             100/100 |       4,88 / 8,00 |           8,12 |                 5,79 |             873,70 |
| Canasta genérica de 5 |             100/100 |       4,29 / 7,25 |           7,31 |                58,51 |             847,27 |

## Comparación histórica con 03E

Mismos casos y número de observaciones; ejecuciones históricas, sin diseño pareado. Estas variaciones no demuestran causalidad del preámbulo SQL ni del presupuesto. No se declara una optimización de latencia.

| Caso a 50.000                | Serie           | p50 / p95 03E, s | p50 / p95 final 04, s | Variación p50 / p95 |
| ---------------------------- | --------------- | ---------------: | --------------------: | ------------------: |
| Búsqueda por precio unitario | 20 solicitudes  |      7,42 / 9,12 |           6,65 / 9,99 |     -10,4 % / 9,6 % |
| Categoría con texto          | 20 solicitudes  |      7,41 / 9,53 |          9,53 / 10,26 |      28,7 % / 7,7 % |
| Canasta mixta de 20          | 20 solicitudes  |      4,60 / 7,68 |           4,96 / 8,16 |       7,9 % / 6,3 % |
| Canasta genérica de 5        | 20 solicitudes  |      4,23 / 7,24 |           4,69 / 7,68 |      10,7 % / 6,0 % |
| Canasta mixta de 20          | 100 solicitudes |      5,00 / 7,70 |           4,88 / 8,00 |      -2,4 % / 4,0 % |
| Canasta genérica de 5        | 100 solicitudes |      4,89 / 7,35 |           4,29 / 7,25 |    -12,2 % / -1,4 % |

La primera corrida tuvo un p50 de búsqueda amplia concurrente de 9,60 s, un 29,3 % por encima del 03E, y p95 de 9,89 s. Esa subida queda registrada aunque las respuestas fueran correctas. El reporte no atribuye la diferencia a una causa única sin perfilado. La estabilidad de resultados no equivale a una mejora de tiempo o consumo.

Los sesenta resúmenes funcionales de referencia de la corrida inicial coinciden con 03E, y las doce consultas de dominio capturadas son textualmente iguales. Los doce resúmenes funcionales de la repetición final también coinciden con 03E. Cada respuesta de ambas corridas se valida además contra su referencia de la misma fixture. Los UUID cambian entre esquemas; no se comparan hashes de cuerpos entre esquemas como si los IDs fueran estables. Los lectores y el dominio no cambiaron en el ajuste final.

## Fases observadas a 50.000 — build final

Las medianas de intervalos distintos no se suman. El transporte SQL incluye pool, PostgreSQL y serialización del adaptador local. El intervalo posterior incluye decodificación Neon, dominio y renderizado/serialización; no es tiempo puro de React. La cola `after()` se mide desde el envío de la respuesta.

| Caso concurrente             | Cabeceras p50, ms | Cuerpo p50, ms | Transporte SQL p50, ms | Posterior al transporte p50, ms | Cola after p95, ms |
| ---------------------------- | ----------------: | -------------: | ---------------------: | ------------------------------: | -----------------: |
| Búsqueda por precio unitario |             17,11 |        6647,33 |                4957,10 |                         1702,35 |            3486,99 |
| Categoría con texto          |             18,38 |        9532,21 |                5266,51 |                         1656,33 |            3388,65 |
| Canasta mixta de 20          |           4955,87 |        4956,09 |                3303,93 |                         1581,53 |               0,00 |
| Canasta genérica de 5        |           4685,79 |        4686,23 |                3146,55 |                         1524,74 |               0,00 |

## SQL lento, cancelación y recuperación — build final

La fixture inyecta una espera de veinte segundos después del preámbulo del presupuesto. PostgreSQL la detiene con el timeout de diez segundos. Estos cuatro errores 57014 deliberados y sus cuatro recuperaciones quedan fuera de los percentiles.

| Frontera | Sondeo          | Cliente, ms | Transporte SQL hasta terminar, ms | Estado HTTP             | Recuperación, s |
| -------- | --------------- | ----------: | --------------------------------: | ----------------------- | --------------: |
| Búsqueda | Timeout SQL     |    10014,60 |                          10007,39 | 200                     |            0,30 |
| Búsqueda | Aborto a 100 ms |      100,18 |                          10004,87 | 200; abortado           |            0,23 |
| Canasta  | Timeout SQL     |    10007,04 |                          10002,41 | 503                     |            0,28 |
| Canasta  | Aborto a 100 ms |      100,49 |                          10003,32 | sin respuesta; abortado |            0,31 |

La búsqueda puede haber enviado cabeceras 200 antes de mostrar el error; la API de canastas devuelve 503. Los cuerpos del diagnóstico no exponen SQL, conexión ni mensajes internos de PostgreSQL. Las pruebas de integración comprueban rollback del lote, conservación de un timeout PostgreSQL más estricto, ausencia de fuga de configuración y recuperación tras cuatro consultas lentas simultáneas.

Las seis cancelaciones ordinarias siguientes también quedan fuera de los percentiles. El SQL restante incluye todo el trabajo asociado a la petición, incluido el registro posterior de búsqueda; no representa únicamente la consulta original. El ejecutor espera su terminación antes de limpiar.

| Escala | Caso                         | Cliente, ms | SQL restante después del cliente, ms | Recuperación HTTP, s |
| ------ | ---------------------------- | ----------: | -----------------------------------: | -------------------: |
| 2.000  | Búsqueda por precio unitario |      100,50 |                               167,13 |                 0,23 |
| 2.000  | Canasta mixta de 20          |      101,43 |                               116,72 |                 0,29 |
| 10.000 | Búsqueda por precio unitario |      101,05 |                               972,19 |                 1,07 |
| 10.000 | Canasta mixta de 20          |      100,94 |                               276,95 |                 0,73 |
| 50.000 | Búsqueda por precio unitario |      100,19 |                              4524,69 |                 5,13 |
| 50.000 | Canasta mixta de 20          |       99,96 |                              1214,93 |                 2,81 |

## Recursos, procedencia y limpieza

El pico RSS muestreado del servidor final fue **873,70 MiB**; el máximo del sistema para ese proceso fue **958,38 MiB**. La primera corrida tuvo 1.170,46 MiB de RSS muestreado, frente a 924,84 MiB de 03E. El consumo no se presenta como una mejora. La repetición final tiene otro alcance y duración, por lo que tampoco se compara su máximo global como si fueran corridas idénticas.

En ambos runs se conservó memoria compartida de **64 MiB**, `work_mem = 4MB`, `shared_buffers = 128MB`, `hash_mem_multiplier = 2`, dos workers paralelos por gather, parallel hash y JIT habilitados. Máquina: Ryzen 5 7600, doce hilos, aproximadamente 30,54 GiB; Node 24.3.0, pnpm 12.8.1, Next 16.3.8 y PostgreSQL 17.11. A 50.000 hay cuatro tiendas, 9.375 grupos exactos, 37.500 enlaces y 1,8 millones de estados diarios; se conserva la distribución de 03E.

Se verificaron **304 hashes de fuentes y 2091 del build final** sin cambios durante la repetición. Build inicial: `gPFgmjuCOOelYhvyLTk3F`; final: `A1A3OZsrCn0yLrT6aQXUp`. Las trazas iniciales tienen 1.892 peticiones y las finales 572, incluidos calentamientos y diagnósticos. Hay correspondencia entre inicios/finales SQL y tareas `after()` y no hay SQL sin atribución. El pase inicial de hashes se archivó antes del ajuste; la verificación final identifica exactamente los tres archivos cambiados.

Los dos servidores propios se detuvieron y sus esquemas `comprafino_e2e_ad1ada112b444ef19b70426c0d2480d8` y `comprafino_e2e_3dd8680e2797477d865285a3052e1304` se eliminaron. Una conexión independiente verificó los parámetros y `statement_timeout = 0`: la configuración fue local a cada transacción. El contenedor de pruebas permanece encendido, igual que al comenzar.

La evidencia reproducible está en `.artifacts/public-request-budgets-2026-10-16/`, ignorada por Git. Conservar el directorio completo:

- `full/` y `final/`: `results.json`, progreso JSONL, comando, trazas, log del servidor, cuerpos de sondeos, oráculos, memoria del contenedor y `cleanup.json`. `full/` conserva los siete fallos posteriores descubiertos; no se borraron ni reclasificaron como éxitos.
- `full/analysis.json` y `final/analysis.json`: fases, memoria, CPU y cancelación; `http-comparison.json` y `final-http-comparison.json`: comparación de cada corrida con 03E.
- `reader-control-comparison.json`, `final-reader-control-comparison.json` y `sql-comparison.json`: equivalencia histórica de resúmenes y doce planes/consultas de dominio.
- Manifiestos `initial-*` y finales, `baseline-comparison.json`, `validation.json`, logs de checks y scripts de análisis: fuentes, builds y verificación de cada alcance.
- `pilot/`: diagnóstico previo al ajuste que conserva timeouts SQL más estrictos; no se mezcla con los percentiles principales.

## Frecuencia, coste y límites del alcance

El presupuesto reduce la duración máxima de cada operación y sentencia, y evita que la interfaz siga esperando sin límite. **No pone un límite global a cuántas peticiones pueden llegar.** El tráfico agregado sigue siendo una variable operativa independiente.

Con una pestaña visible, el intervalo por sí solo genera aproximadamente hasta sesenta evaluaciones por hora, más las provocadas por foco o cambios de lista/modo. Cien pestañas equivalen, por esa sola cadencia, a unas 6.000 evaluaciones por hora. Es aritmética de solicitudes, no una prueba de que el sistema soporte esa llegada ni una estimación de factura. La CPU del adaptador local tampoco permite convertir estas cifras directamente a gasto de Neon/Vercel.

Se mantuvo la cadencia porque evitar volver a evaluar puede cruzar la frontera de frescura y mostrar una recomendación inválida. Durante una actualización o después de un fallo, las recomendaciones siguen ocultas. El ajuste mínimo aplicado fue evitar un reinicio innecesario cuando el usuario solicita refrescar y ya hay una petición en curso.

Se consultaron los docs instalados de Next 16.3.8 y las fuentes oficiales sobre [duración de funciones Vercel](https://vercel.com/docs/functions/configuring-functions/duration) y [rate limiting de WAF](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting). Se verificó el manifiesto local, pero **no se inspeccionaron la cuenta, su plan, sus reglas de firewall ni la configuración efectiva del despliegue**. No se afirma que falten protecciones externas. Tampoco se activaron reglas o límites remotos.

Si el tráfico requiere limitar frecuencia, la alternativa mínima a revisar primero es el WAF del hosting existente, comenzando por observación y con umbrales basados en tráfico real. Hay que considerar direcciones IP compartidas y solicitudes legítimas de foco. Un `Map` dentro de una función solo contaría lo que ve ese proceso; no sería un límite global. No hay evidencia en esta prueba para añadir Redis, otra infraestructura o un contador local presentado como protección distribuida.

## Límites de interpretación

- El timeout de operación es cooperativo. Rechaza resultados tardíos, pero no interrumpe CPU síncrona por la fuerza. El timeout SQL es por sentencia y puede dejar trabajo residual después de cancelar HTTP; las trazas lo muestran expresamente.
- Las cifras son de un Next de producción local con adaptador Neon de pruebas y PostgreSQL desechable. No incluyen latencia remota, arranque en frío real, assets ni hidratación. La capacidad de llegada sostenida y las cuotas/costes de una cuenta requieren otra medición.
- Las tandas de cuatro son cerradas: se drena todo el trabajo antes de enviar la siguiente. No simulan un flujo abierto de solicitudes y no fijan un límite de usuarios activos.
- Veinte muestras por celda permiten un p95 descriptivo, no un SLA. Las series de cien refuerzan estabilidad, pero no sustituyen distribuciones de títulos más diversas ni canastas genéricas completamente cubiertas.
- Los picos de memoria se muestrean: 100 ms para el proceso y aproximadamente un segundo para PostgreSQL/contenedor. Puede haber máximos entre muestras. La memoria cgroup incluye caché de páginas; no es RSS puro de PostgreSQL.
- La comparación contra 03E es histórica, no pareada. No se atribuyen pequeñas variaciones a los presupuestos ni se declara una optimización de latencia. Este trabajo conserva los mismos lectores y añade controles de recursos.
- El pase de metadata de Chromium no demuestra corregida la intermitencia aislada documentada en 03D. Esa investigación sigue siendo independiente.

## Prompts para continuar

### 04A — Validar los presupuestos en el hosting real

```text
Revisa docs/request-budgets.md y el reporte de prompt 04. Verifica de forma inicialmente solo lectura el despliegue de pruebas equivalente a CompraFino: build desplegado, maxDuration efectivo de las cinco rutas, región web/base, plan, límites existentes de WAF y protecciones de gasto. No presupongas que faltan protecciones ni cambies configuración remota sin autorización.

Mide arranque en frío, transporte Neon, respuesta HTTP completa y recuperación con los presupuestos 15/12/10 s. Usa únicamente TEST_DATABASE_URL explícito, fixtures propias y datos sintéticos. No uses la base de aplicación ni hagas solicitudes a retailers. Distingue cancelación del navegador, transporte, SQL y resultado incierto de escrituras. Conserva precios, disponibilidad, elegibilidad, rankings y decisiones completas. Entrega evidencia y una propuesta concreta de ajuste, si hace falta; no actives infraestructura nueva ni un Map como límite global.
```

### 04B — Medir llegada sostenida y diversidad de canastas

```text
Continúa desde las pruebas HTTP de CompraFino siguiendo AGENTS.md y docs/local-testing.md. Conserva la matriz actual de 2.000/10.000/50.000 y las cien canastas mixtas y cien genéricas con concurrencia cuatro y 64 MiB de memoria compartida como regresión.

Añade controles genéricos completamente cubiertos y una distribución de títulos más diversa sin sustituir los casos parciales existentes. Diseña una prueba de llegada sostenida acotada, con límite explícito de solicitudes y duración, que mida cola, tasa de errores, p95 de cuerpo completo, CPU, memoria y trabajo SQL después de cancelar. Usa solo PostgreSQL de pruebas y esquemas aleatorios propios. No extrapoles cuatro peticiones simultáneas a usuarios/hora ni cambies reglas para mejorar números. Propón el umbral de frecuencia mínimo que los datos permitan evaluar en el WAF existente; no lo despliegues ni añadas otra infraestructura.
```

El **prompt 05** del plan original sigue siendo la reconciliación de README y roadmap con el estado implementado. Esta tarea actualiza únicamente la documentación necesaria para los presupuestos y su verificación; no declara corregido el resto de ese inventario documental.
