# Rendimiento HTTP de búsquedas y canastas 03E

Fecha: 16 de octubre de 2026, America/Lima. Continuación de [03B](catalog-category-performance-2026-10-16.md), con el mismo catálogo sintético y las mismas reglas de comparación. Se mide el build de producción de Next por HTTP local.

## Resultado

**Las rutas funcionaron correctamente en las tres escalas y con cuatro solicitudes simultáneas. La latencia a 50.000 sigue siendo elevada.** La matriz y las repeticiones terminaron con **1.640/1.640 respuestas completas verificadas**, sin errores SQL, fallos de memoria compartida, errores de tareas posteriores ni agotamientos del timeout de transporte. También pasaron los 232 calentamientos, excluidos de los percentiles.

A 50.000 registros, cuatro búsquedas amplias simultáneas dieron **p95 de 9,12 s**; categoría con texto, **9,53 s**. Las series adicionales de cien canastas dieron **p95 de 7,70 s para mixtas** y **7,35 s para genéricas**. Se verificaron **240 canastas a esa escala en sesenta tandas de cuatro**, contando matriz y repeticiones. El límite de memoria compartida se mantuvo en **64 MiB** y el máximo muestreado fue **58,51 MiB**.

Las cabeceras de búsqueda llegan pronto porque Next transmite una pantalla inicial mientras trabaja. Por ejemplo, la búsqueda amplia por precio unitario tuvo cabeceras en **5,92 ms**, pero el cuerpo completo en **4,45 s** de mediana con una solicitud. Medir solamente el inicio de respuesta ocultaría casi toda la espera por los productos.

No se modificó código productivo de búsqueda, evaluación, precios, identidad, elegibilidad, beneficios, frescura ni disponibilidad. Se añadió un ejecutor de pruebas HTTP, instrumentación explícita para su proceso y validación de resultados.

## Qué se midió y cómo reproducirlo

Se usaron `GET /search` y `POST /api/list/evaluate` sobre un proceso propio de **Next 16.3.8 en modo producción**, con puerto local disponible. El cliente de medición corre en otro proceso. El servidor usa el preload de pruebas existente para conectar exclusivamente a `TEST_DATABASE_URL`, dentro de un esquema aleatorio propio. El esquema se eliminó al terminar; no se accedió al catálogo de aplicación ni a tiendas.

```sh
pnpm test:db:up
pnpm build
pnpm benchmark:catalog:http:local --stability-samples=100 \
  --output=.artifacts/catalog-http-nueva-ejecucion/results.json
```

El comando admite `--sizes`, `--samples`, `--warmups`, `--cases` y `--concurrency=1|4|both`. Los detalles de uso están en [pruebas locales](../local-testing.md#catalog-http-benchmark). Los destinos son nuevos y se rechaza sobrescribir evidencia existente.

La matriz contiene veinte casos secuenciales y cuatro casos concurrentes en cada escala: **72 combinaciones con veinte solicitudes medidas por combinación**, más cien mixtas y cien genéricas a 50.000. Se excluyen dos rondas de calentamiento; cada ronda concurrente contiene cuatro solicitudes. Los casos comparten las definiciones de búsqueda y construcción de listas con el benchmark del lector, extraídas a `apps/web/testing/catalog-benchmark-workloads.ts`.

Se mide hasta recibir todo el cuerpo HTML o JSON, con `Accept-Encoding: identity`. Los bytes corresponden al cuerpo sin compresión y no incluyen cabeceras. La validación del cliente se realiza después de registrar ese tiempo y queda incluida únicamente en `completionMs`. p50 y p95 usan rango más próximo; p95 requiere al menos veinte respuestas exitosas. Se conservan respuestas fallidas, eventos SQL, errores y cancelaciones. Un HTTP 200 con pantalla de error se rechaza.

Las tandas son cerradas: se esperan las respuestas, las consultas que continúan tras una cancelación y las promesas de `after()` antes de iniciar otra tanda. El pool del servidor tiene cuatro conexiones. **No es una prueba de tasa de llegadas continua ni permite deducir una capacidad de usuarios por minuto.** No se ejecutaron builds ni suites pesadas durante la matriz.

El entorno fue Linux x64, Node 24.3.0, Ryzen 5 7600 con doce hilos lógicos y aproximadamente 30,54 GiB de RAM. PostgreSQL 17.11 mantuvo `shared_buffers=128MB`, `work_mem=4MB`, `hash_mem_multiplier=2`, dos workers paralelos por Gather, parallel hash y JIT habilitados. El contenedor conservó `/dev/shm=67108864` bytes.

Las ochenta plantillas de escritores reales se ampliaron a 2.000, 10.000 y 50.000 publicaciones, conservando fingerprints, normalizaciones, asociaciones e historial. A 50.000 hay 9.375 grupos exactos, 37.500 asociaciones, 1.800.000 estados de precio, 1.777.500 días observados y 6.250 beneficios. Hay 25.000 disponibilidades verdaderas, 625 falsas y 24.375 desconocidas; cada tienda aporta 12.500 publicaciones. Son clones de volumen, no 50.000 títulos distintos ni una distribución representativa del catálogo real.

La fixture incluye cobertura completa y parcial. Las canastas mixtas de cinco y las estrictas de cincuenta tienen planes completos; las mixtas de veinte/cincuenta y la genérica incluyen necesidades sin opciones válidas. En la genérica, la necesidad de leche en unidades queda sin alternativa compatible. Una respuesta correcta conserva ese estado parcial y sus costes nulos; **no significa que todas las necesidades estén cubiertas**. Se mantuvieron estos casos para conservar la comparabilidad con 03B.

## Tiempos HTTP con una solicitud

Cada celda muestra **p50 / p95 en segundos hasta recibir el cuerpo completo**. Hay veinte respuestas medidas por celda; los calentamientos están excluidos.

| Caso                                | 2.000 registros | 10.000 registros | 50.000 registros |
| ----------------------------------- | --------------: | ---------------: | ---------------: |
| Búsqueda amplia por relevancia      |     0,18 / 0,19 |      0,88 / 0,95 |      4,31 / 5,23 |
| Búsqueda amplia por precio unitario |     0,18 / 0,19 |      0,89 / 0,96 |      4,45 / 5,20 |
| Búsqueda amplia por precio total    |     0,18 / 0,18 |      0,90 / 0,96 |      4,33 / 5,28 |
| Texto selectivo                     |     0,05 / 0,06 |      0,14 / 0,15 |      1,11 / 1,18 |
| Sin resultados                      |     0,03 / 0,03 |      0,08 / 0,09 |      0,33 / 0,34 |
| Familia arroz                       |     0,07 / 0,09 |      0,25 / 0,26 |      0,79 / 0,83 |
| Categoría sin texto                 |     0,07 / 0,08 |      0,24 / 0,36 |      1,32 / 1,41 |
| Categoría con texto                 |     0,18 / 0,19 |      0,86 / 0,90 |      4,57 / 5,54 |
| Tienda y unidad                     |     0,19 / 0,24 |      0,90 / 0,91 |      4,23 / 4,60 |
| Página 2 por precio unitario        |     0,19 / 0,24 |      0,92 / 0,97 |      4,42 / 4,81 |
| Página 10 por precio unitario       |     0,18 / 0,24 |      0,93 / 1,01 |      4,34 / 4,81 |
| Búsqueda con beneficios             |     0,18 / 0,22 |      0,96 / 1,00 |      4,06 / 4,49 |
| Canasta mixta de 5 ordinaria        |     0,12 / 0,13 |      0,53 / 0,55 |      2,55 / 2,63 |
| Canasta mixta de 5 con beneficios   |     0,12 / 0,12 |      0,52 / 0,57 |      2,63 / 2,83 |
| Canasta mixta de 20 ordinaria       |     0,23 / 0,24 |      0,65 / 0,66 |      2,93 / 3,07 |
| Canasta mixta de 20 con beneficios  |     0,22 / 0,24 |      0,65 / 0,67 |      2,83 / 2,86 |
| Canasta mixta de 50 ordinaria       |     0,28 / 0,30 |      0,73 / 0,76 |      3,90 / 3,93 |
| Canasta mixta de 50 con beneficios  |     0,28 / 0,29 |      0,75 / 0,78 |      4,00 / 4,15 |
| Canasta estricta de 50              |     0,19 / 0,19 |      0,22 / 0,25 |      1,24 / 1,30 |
| Canasta genérica de 5               |     0,12 / 0,13 |      0,54 / 0,55 |      2,50 / 2,54 |

## Cuatro solicitudes simultáneas

Cada celda contiene veinte respuestas en cinco tandas de cuatro. Se espera a que terminen el SQL y las tareas posteriores a la respuesta antes de comenzar la siguiente tanda.

| Caso                                | 2.000 registros | 10.000 registros | 50.000 registros |
| ----------------------------------- | --------------: | ---------------: | ---------------: |
| Búsqueda amplia por precio unitario |     0,39 / 0,42 |      1,89 / 1,92 |      7,42 / 9,12 |
| Categoría con texto                 |     0,39 / 0,41 |      1,74 / 1,94 |      7,41 / 9,53 |
| Canasta mixta de 20 ordinaria       |     0,30 / 0,43 |      1,06 / 1,70 |      4,60 / 7,68 |
| Canasta genérica de 5               |     0,19 / 0,31 |      0,90 / 1,51 |      4,23 / 7,24 |

## Estabilidad adicional a 50.000

| Canasta                       | Solicitudes | p50 / p95 HTTP en s | Máximo HTTP en s | Pico de memoria compartida en MiB | Pico RSS del servidor en MiB |
| ----------------------------- | ----------: | ------------------: | ---------------: | --------------------------------: | ---------------------------: |
| Canasta mixta de 20 ordinaria |     100/100 |         5,00 / 7,70 |             8,38 |                              5,79 |                       924,84 |
| Canasta genérica de 5         |     100/100 |         4,89 / 7,35 |             7,92 |                             58,51 |                       898,17 |

## Fases observadas a 50.000

Las medianas de diferentes intervalos no se suman para obtener la mediana total. La espera del transporte SQL incluye el pool, PostgreSQL y la serialización del adaptador local. El intervalo posterior al transporte incluye decodificación Neon, reglas de dominio, renderizado React y serialización de respuesta; **no es tiempo puro de React**. La cola posterior corresponde a la finalización de `after()` después del envío.

| Caso                                | Concurrencia | Cabeceras p50 ms | Cuerpo p50 ms | Transporte SQL p50 ms | Posterior al transporte p50 ms | Cola después de respuesta p50 ms |
| ----------------------------------- | -----------: | ---------------: | ------------: | --------------------: | -----------------------------: | -------------------------------: |
| Búsqueda amplia por precio unitario |            1 |             5,92 |       4453,90 |               2809,30 |                        1512,31 |                            99,92 |
| Búsqueda amplia por precio unitario |            4 |            15,10 |       7421,39 |               4652,09 |                        1591,93 |                          1673,23 |
| Categoría con texto                 |            1 |             5,90 |       4574,79 |               3047,94 |                        1533,48 |                            36,55 |
| Categoría con texto                 |            4 |            16,07 |       7406,02 |               4781,35 |                        1542,51 |                          1611,30 |
| Canasta mixta de 20 ordinaria       |            1 |          2926,43 |       2926,63 |               1362,42 |                        1550,48 |                             0,00 |
| Canasta mixta de 20 ordinaria       |            4 |          4595,05 |       4595,29 |               3085,96 |                        1495,68 |                             0,00 |
| Canasta genérica de 5               |            1 |          2498,43 |       2498,67 |               1042,09 |                        1455,63 |                             0,00 |
| Canasta genérica de 5               |            4 |          4231,49 |       4231,66 |               2787,00 |                        1452,48 |                             0,00 |

La evaluación de canastas expone además sus tiempos de handler en JSON y `Server-Timing`. Estos valores se recogen en la misma respuesta HTTP.

| Canasta a 50.000              | Concurrencia | Handler p50 ms | Consulta del handler p50 ms | HTTP menos handler p50 ms |
| ----------------------------- | -----------: | -------------: | --------------------------: | ------------------------: |
| Canasta mixta de 20 ordinaria |            1 |        2923,64 |                     1425,94 |                      2,89 |
| Canasta mixta de 20 ordinaria |            4 |        4587,44 |                     3154,31 |                      4,64 |
| Canasta genérica de 5         |            1 |        2496,16 |                     1104,20 |                      2,39 |
| Canasta genérica de 5         |            4 |        4229,07 |                     2849,16 |                      4,68 |

## Cancelación y recuperación

Seis solicitudes diagnósticas se cancelaron con un límite de cliente de 100 ms, fuera de los percentiles. Se registra cuándo terminó el último transporte SQL asociado a cada solicitud, incluidas las tareas posteriores; el intervalo puede contener esperas y procesamiento intermedio. El ejecutor siguió ese trabajo hasta terminar.

| Escala | Caso                                | Cancelación del cliente ms | Último transporte SQL tras cancelar el cliente en ms | Recuperación HTTP en s |
| ------ | ----------------------------------- | -------------------------: | ---------------------------------------------------: | ---------------------: |
| 2.000  | Búsqueda amplia por precio unitario |                     101,91 |                                               119,22 |                   0,18 |
| 2.000  | Canasta mixta de 20 ordinaria       |                     100,61 |                                                56,19 |                   0,22 |
| 10.000 | Búsqueda amplia por precio unitario |                     101,17 |                                               889,17 |                   0,94 |
| 10.000 | Canasta mixta de 20 ordinaria       |                     100,84 |                                               256,06 |                   0,65 |
| 50.000 | Búsqueda amplia por precio unitario |                     100,89 |                                              3947,53 |                   4,00 |
| 50.000 | Canasta mixta de 20 ordinaria       |                     100,00 |                                              1222,06 |                   2,85 |

Las seis recuperaciones posteriores a la cancelación fueron correctas. El límite de 100 ms interrumpió la espera del cliente; no propagó una cancelación efectiva del SQL. A 50.000, el último transporte SQL asociado a la búsqueda terminó aproximadamente **3,95 s después** de esa cancelación y el de canasta mixta, **1,22 s después**. Estas diferencias son intervalos del transporte local observado, no medidas puras de CPU de PostgreSQL.

La búsqueda conserva su timeout productivo de **12 s por fetch a la base**, que no es un límite total de renderizado o de petición HTTP. El benchmark usa **90 s como límite de seguridad del cliente**. El preload adicional reproduce la señal de abort del fetch sin afirmar que cancela la consulta local: sigue registrándola hasta que termina. En la matriz normal no se agotó el límite de 12 s. No se recomienda trasladar los 90 s del ejecutor a la aplicación.

## Memoria y coste de concurrencia

El proceso servidor alcanzó **924,84 MiB de RSS muestreada** y **964,38 MiB de máximo de vida del proceso**, registrado por el sistema operativo. La memoria del servidor se muestreó cada 100 ms; los tramos síncronos pueden impedir observar un pico con ese intervalo. El contenedor PostgreSQL alcanzó **3.167,11 MiB de memoria de cgroup**, que incluye caché y no equivale a RSS exclusivo del motor. Estas magnitudes no deben sumarse como si midieran la misma cosa.

La serie mixta tuvo un pico muestreado de memoria compartida de **5,79 MiB** y la genérica, **58,51 MiB**. La diferencia muestra que la estabilidad de las mixtas no sustituye al control genérico. El margen muestreado de la genérica fue de unos **5,49 MiB** respecto del límite de 64 MiB; no demuestra margen suficiente para más concurrencia. Se tomaron 2.859 muestras del contenedor, aproximadamente una por segundo, sin errores del monitor. Para atribuirlas a un caso, ambos extremos temporales de la muestra deben estar dentro de su ventana de medición.

La CPU media aproximada del proceso servidor durante las series de cien canastas fue de **1,72 s por solicitud mixta** y **1,67 s por solicitud genérica**. Son diferencias de CPU del proceso entre muestras, no atribución exclusiva a una petición concurrente. El tiempo de espera HTTP puede ser mayor porque varias solicitudes comparten CPU, pool y PostgreSQL.

El transporte local convierte resultados TCP al formato HTTP de Neon dentro del proceso Next. Esa serialización consume CPU y memoria en estas pruebas; con Neon remoto ocurre fuera del proceso de la aplicación. Por ello, estas cifras caracterizan **este entorno de pruebas**. No se pueden convertir directamente en memoria necesaria, SLA o coste del despliegue. Tampoco incluyen descarga de assets, imágenes, hidratación ni latencia de red externa.

## Cuellos de botella y cambios recomendados

1. **Reducir el trabajo de las búsquedas amplias.** A 50.000, mostrar una página posterior o filtrar por tienda y unidad mantiene medianas de aproximadamente cuatro segundos. Categoría sin texto tiene p95 de 1,41 s, mientras categoría con texto llega a 5,54 s con una solicitud. La lectura global y el procesamiento previo a la selección siguen costando mucho. Los doce controles SQL capturados por HTTP coinciden con 03B; no reapareció la consulta duplicada. Una siguiente optimización debe conservar el conteo global, descubrimiento, diversidad de unidades, orden y paginación; un `LIMIT` anticipado no es aceptable sin equivalencia demostrada.

2. **Perfilar decodificación y reglas en Node antes de volver a ajustar SQL de canastas.** Tras terminar el transporte todavía se observan unos 1,45–1,55 s en canastas a 50.000. Ese intervalo incluye parseo y evaluación. La envoltura HTTP añade medianas de aproximadamente 2–5 ms sobre el tiempo del handler en los controles principales. Optimizar solamente el endpoint o comprimir sus 15–81 KB de JSON no resolverá segundos de procesamiento. Conviene medir por separado parseo, validación, normalización/fingerprint, selección de alternativas y cálculo de planes antes de escoger un cambio.

3. **Aplicar el prompt 04 con cancelación y presupuestos explícitos.** Cancelar la navegación no libera inmediatamente los recursos del servidor. Además, en búsquedas concurrentes `after()` termina alrededor de 1,6–1,7 s después de la respuesta en mediana; ese intervalo incluye espera y contención, no solo ejecución SQL. Las tareas posteriores también cuentan para capacidad y límites del hosting. Deben distinguirse lectura fallida y escritura de resultado incierto, especialmente en `/api/list/sync`.

4. **Ampliar cobertura antes de afirmar capacidad de producción.** Conservar los casos actuales como regresión y añadir canastas genéricas completamente cubiertas, más diversidad de títulos y una carga de llegada sostenida en un entorno de pruebas equivalente al despliegue. La estabilidad con cuatro solicitudes y clones repetidos no acredita otras distribuciones ni más usuarios simultáneos. Mantener el control genérico con 64 MiB de memoria compartida en cada cambio de SQL.

No hay evidencia para introducir un buscador externo, Redis, otra caché, más memoria compartida o infraestructura nueva en esta tarea.

## Objetivos provisionales para el siguiente trabajo

Estos objetivos sirven para priorizar y detectar regresiones en **la misma fixture y máquina**; no son un SLA de producción ni un cambio de configuración aplicado:

- **Integridad y estabilidad:** todas las respuestas verificadas, cero fallos de memoria compartida con cuatro solicitudes, recuperación tras cancelación y limpieza de esquemas. Conservar las cien solicitudes mixtas y las cien genéricas como mínimo de repetición.
- **Búsquedas amplias a 50.000:** intentar reducir el p95 secuencial por debajo de **4 s** y el concurrente por debajo de **7,5 s**. Frente a los valores actuales de 5,20–5,54 s y 9,12–9,53 s, supone una mejora material de aproximadamente 18–28 %, suficiente para distinguirla de pequeñas variaciones.
- **Canastas:** preservar los p95 observados de las series prolongadas, aproximadamente **7,70 s** y **7,35 s**, mientras se optimizan búsquedas. Investigar cualquier aumento repetible superior al 10 % con una comparación pareada; no convertir automáticamente la variación de veinte muestras en una regresión confirmada.
- **Presupuesto de petición:** usar **15 s de respuesta completa como punto de partida de evaluación para lecturas** en 04, con medición de dependencia lenta, CPU y cancelación. Aquí el máximo de la búsqueda amplia concurrente fue de 9,99 s y el de las series de canastas de 8,38 s. Ese margen local necesita contrastarse con transporte remoto y límites reales del hosting antes de adoptarse; no se extiende a escrituras con resultado incierto. Conservar la distinción entre timeout de transporte y deadline total.

## Validación y procedencia

Antes de empezar se verificaron los 146 hashes de la entrega de 03B. Los únicos archivos de esa lista que cambiaron son los comandos de paquetes, el wrapper local y el ejecutor previo para compartir sus casos. No cambió el dominio ni los lectores productivos.

Cada caso obtuvo una referencia excluida de tiempos desde el lector actual, en la misma fixture. Las canastas se comparan completas, excluyendo solo `evaluatedAt` y `timings`. Las búsquedas verifican IDs, orden dentro de cada grupo comparable, precios ordinarios y condicionales, paginación y estados vacíos/error. También coinciden los sesenta resúmenes funcionales de tres escalas con 03B. Una observación de referencia por caso no es una nueva distribución de latencia del lector; las cifras de HTTP no se mezclan ni restan de percentiles históricos.

El piloto inicial detectó una falsa diferencia al interpretar el orden del HTML en bruto como orden del DOM. React puede enviar grupos en segmentos separados. Chromium reconstruyó ese mismo HTML y confirmó el orden final exacto contra el lector. Se corrigió el validador y el piloto aceptado terminó con **32/32 muestras correctas**, incluyendo tandas reales de cuatro. Se conserva la evidencia del piloto inicial y de su corrección.

La ejecución principal conserva **297 hashes de fuentes** y **352 hashes del build**, verificados después de terminar. Build ID medido: `AL9Bd_H32sXYnQxeYv17K`. Después de medir se reforzó exclusivamente el ciclo de vida del ejecutor: detectar una salida por señal, no esperar un evento `exit` que ya ocurrió y fallar al cerrarse el hijo durante el drenaje. La revisión medida, el diff exclusivo y los hashes finales se conservan separados. Este ajuste no modifica consultas, rutas, oráculos ni temporizadores de medición; no se presentan las latencias como una segunda ejecución de ese ajuste.

Comprobaciones realizadas:

- **902 pruebas unitarias y de fronteras:** 550 core, 88 DB, 200 scrapers y 64 del servidor web/streams.
- **151 pruebas de integración:** 139 DB y doce web, con configuración explícita y esquemas propios.
- **Build de producción correcto** y **87 pruebas Chromium correctas**, con ocho casos opcionales omitidos por la configuración controlada.
- Formato, Oxlint sin advertencias, TypeScript y referencias de documentación verificados sobre la entrega.
- Control final de **16/16 respuestas** con la entrega y cierre normal correcto, excluido de las cifras de rendimiento porque se ejecutó junto a comprobaciones de código.
- Cierre normal del benchmark y diagnóstico separado de interrupción del servidor, con eliminación del esquema propio. La interrupción deliberada termina con error esperado del ejecutor; no forma parte de las estadísticas de disponibilidad.

El pase actual de Chromium no demuestra resuelta la intermitencia de metadata documentada en 03D; esa investigación sigue siendo independiente. Los fallos iniciales de compilación/lint durante la construcción del harness se corrigieron. Una primera ejecución de unitarias chocó con restricciones del sandbox al crear subprocesos; la ejecución autorizada y las comprobaciones finales pasaron.

La evidencia está en `.artifacts/catalog-http-performance-2026-10-16/`, ignorada por Git. Conservar el directorio completo al compartir resultados:

- `full/results.json`, su progreso JSONL y `full/command.json`: muestras, configuración, oráculos de resultados y comando exacto.
- `full/server-events.jsonl`, `full/server.log` y `full/container-memory.jsonl`: fases, memoria, CPU, errores y cancelaciones.
- `full/*-references.json`, `*-catalog.json`, `*.plan.json` y cuerpos de sondeo: decisiones de referencia, distribución de datos, doce planes reales y contenido HTTP.
- `full/analysis.json`, `analyze.py`, `report-tables.py` y `tables.md`: cálculos reproducibles y tablas.
- Manifiestos de baseline, fuentes medidas/finales y build; `reader-control-comparison.json`, `final-cleanup.diff` y `validation.json`: equivalencia y procedencia.
- `pilot/`, `pilot-accepted/`, `delivered-smoke/`, `server-exit-check/` y `server-exit-check-final/`: validación del medidor, reconstrucción del DOM y cierre inesperado.
- Logs de lint, tipos, pruebas, build, Chromium y verificaciones de documentación/formato.

## Prompt 04 actualizado con esta evidencia

```text
Continúa con el prompt 04 de CompraFino. Lee AGENTS.md, docs/local-testing.md y docs/history/catalog-http-performance-2026-10-16.md. Revalida el estado actual antes de cambiarlo. Consulta los docs de la versión instalada de Next.

Inventaría los límites de search, detalles, /api/list/evaluate, /api/list/sync y el refresco de shoppingEvaluationQuery. Separa bytes, cantidad de necesidades, timeout del transporte, tiempo completo HTTP, CPU, after() y restricciones verificables del hosting. Usa los p95 HTTP de 03E; no uses las cabeceras rápidas de búsqueda como si fueran la respuesta terminada. Evalúa el presupuesto provisional de 15 s para lecturas frente a los límites y transporte reales, sin asumir que sirve para escrituras.

Implementa presupuestos explícitos donde falten, reutilizando createDatabase y las fronteras existentes. Prueba dependencia lenta, abort, recuperación y qué trabajo continúa en PostgreSQL después de cancelar el cliente. Da errores recuperables seguros; no conviertas una escritura incierta en reintentos ciegos ni en una lista vacía. Revisa el refresco cada 60 s y al volver al foco sin alterar frescura ni recomendaciones.

Conserva precios ordinarios positivos, beneficios separados, disponibilidad triestado, fingerprints, elegibilidad, ranking, paginación y resultados completos. No añadas infraestructura especulativa ni un Map local como supuesto límite global.

Usa TEST_DATABASE_URL explícito y esquemas aleatorios propios. Repite las mediciones HTTP de 2.000/10.000/50.000 y las cien canastas mixtas y cien genéricas en tandas de cuatro, con 64 MiB de memoria compartida. Guarda evidencia nueva, incluidos errores y limpieza. Ejecuta checks, build y Chromium y entrega los límites realmente implementados y sus limitaciones. No despliegues.
```

## Prompt para perfilar el coste restante

```text
Perfila el coste restante de búsquedas amplias y canastas a partir de 03E, respetando AGENTS.md. Mantén separados SQL de PostgreSQL, transporte/serialización del adaptador local, parseo de Neon, validación, normalización/fingerprints, selección y cálculo de canastas, renderizado y after(). No atribuyas todo el intervalo posterior a SQL a React.

Usa las mismas fixtures y oráculos con TEST_DATABASE_URL explícito y esquemas propios. Mide antes y después en condiciones pareadas; añade controles genéricos completamente cubiertos sin reemplazar los actuales. Identifica primero el mayor coste y aplica una mejora pequeña y demostrable, sin cambiar reglas ni introducir caché o límites tempranos que oculten candidatos, unidades o cobertura global.

Repite las tres escalas por HTTP y los dos controles prolongados de cuatro canastas a 50.000, conservando 64 MiB de memoria compartida. Evalúa los objetivos provisionales de 03E, informa regresiones y conserva muestras, perfiles, planes y hashes. Ejecuta las comprobaciones aplicables; no despliegues ni añadas infraestructura especulativa.
```
