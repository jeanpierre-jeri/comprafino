# Canastas concurrentes y memoria compartida — prompt 03F

Fecha local: 15 de octubre de 2026, America/Lima. Las marcas de los artefactos usan UTC y corresponden al 16 de octubre. Este informe continúa [03C](catalog-eligibility-performance-2026-10-15.md), conserva sus fallos y compara contra ese código. Las mediciones son locales y sintéticas; no describen latencia de producción.

## Resultado

**El fallo quedó resuelto en el escenario local probado:** con el mismo límite de **64 MiB**, la revisión definitiva completó **120/120 evaluaciones a 50.000 registros en tandas de cuatro**, frente a 0/20 en la reproducción intacta de 03C. La repetición de cien solicitudes obtuvo p50 **4,96 s**, p95 **7,67 s** y un pico muestreado de memoria compartida de **2,22 MiB**.

Se repitieron las 27 combinaciones de canastas a 2.000, 10.000 y 50.000 registros, con 540/540 éxitos, más cien solicitudes adicionales. Los conteos y resúmenes de evaluación coinciden con el baseline; la integración conserva también las reglas y respuestas completas. La mejora no es uniforme: la canasta solo genérica a 50.000 tiene un p50 un 21,4 % mayor que el histórico de 03C. Las tablas siguientes conservan esa regresión y los controles de búsqueda sin cambios de SQL.

## Corrección implementada

La canasta reutiliza una relación `current_prices` con cinco campos de los estados de precio abiertos. PostgreSQL la materializa una vez dentro de la consulta y la usa para identidad canónica, conteo global, admisión de candidatos históricos y ofertas actuales. El filtro `valid_until IS NULL` se aplica al construir esa relación, una sola vez. El lector sigue devolviendo un solo snapshot coherente.

El cambio evita volver a combinar el historial voluminoso con normalizaciones en varios subplanes paralelos. La identidad pública y los candidatos comparten los mismos predicados que antes; la proyección de ofertas de 03A y la identidad mínima de 03C se conservan. No se materializa el JSON de todo el catálogo ni se agregan beneficios antes de filtrar candidatos.

Cambios productivos:

- `packages/db/src/public-products.ts`: extrae la selección canónica común y ofrece un contexto adicional que reutiliza precios vigentes.
- `packages/db/src/generic-offers.ts`: permite que el lector compartido reciba esa relación de precios. Su origen predeterminado sigue siendo `price_history`.
- `packages/db/src/shopping-list.ts`: selecciona el nuevo contexto únicamente para la evaluación conjunta de la lista.
- `packages/db/src/weekday-recommendation.ts`: une la evidencia con el UUID nativo de la publicación, conservando los mismos predicados temporales. Ese UUID auxiliar no se incluye en los catorce campos transferidos.

Las búsquedas mantienen su SQL anterior, salvo espacios sin significado. El histórico de días de compra continúa leyendo **todos los estados de `price_history`**, incluidos los cerrados. `current_prices` no es una tabla persistente ni una caché entre solicitudes. No se añadieron dependencias, índices o migraciones.

## Reproducción y causa

Se verificó que las 144 fuentes/configuraciones del manifiesto de 03C conservaban sus hashes antes de reproducir el problema. En una nueva fixture propia, el lector anterior falló en **20/20 solicitudes** y devolvió 503 con SQLSTATE `53100`: PostgreSQL no pudo ampliar un segmento `/PostgreSQL.*` de memoria compartida porque no quedaba espacio. El p50/p95 de éxitos es nulo; completar errores en unos 0,5 segundos no constituye una mejora.

El contenedor mantuvo **64 MiB de `/dev/shm`**, PostgreSQL 17.11, `shared_buffers=128MB`, `work_mem=4MB`, dos trabajadores paralelos por Gather y JIT habilitado. Los planes del caso original muestran tres hashes paralelos; sus picos individuales de EXPLAIN fueron 3.232, 2.880 y 8.512 KiB. Estas cifras no se multiplican por `Actual Loops` ni se suman como si representaran el máximo real del contenedor.

La relación entre paralelismo y presión de memoria es consistente con la [documentación de recursos de PostgreSQL 17](https://www.postgresql.org/docs/17/runtime-config-resource.html): el presupuesto de trabajo se aplica a operaciones y puede multiplicarse por sesiones y trabajadores. La [materialización de CTE](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION) permite reutilizar una relación dentro de la consulta, con el coste de almacenarla temporalmente. Los planes y las pruebas siguientes aportan la evidencia específica de este proyecto.

## Experimento pareado a 50.000 registros: primer candidato

Tres variantes se ejecutaron en el mismo esquema aleatorio, con los mismos datos, instante de referencia, identidades y carga: cinco tandas de cuatro solicitudes, veinte intentos medidos por variante. Los calentamientos y los EXPLAIN quedaron fuera de los percentiles. El orden fue original, ajuste transaccional y reutilización de precios; no es un ensayo aleatorizado.

| Variante                                                     | Éxitos / intentos | Errores | p50 / p95 de éxitos, s | Solicitudes exitosas/s | Pico muestreado `/dev/shm`, MiB |
| ------------------------------------------------------------ | ----------------- | ------- | ---------------------- | ---------------------- | ------------------------------- |
| SQL 03C original                                             | 3/20              | 17      | 3,86 / —               | 0,237                  | 40,78                           |
| Mismo SQL, `enable_parallel_hash=off` solo en la transacción | 20/20             | 0       | 5,82 / 8,52            | 0,474                  | 47,79                           |
| Precios vigentes compartidos, configuración original         | 20/20             | 0       | 5,46 / 8,28            | 0,485                  | 4,60                            |

La variación entre 0/20 y 3/20 éxitos del original confirma que un éxito aislado no resuelve la capacidad concurrente. La latencia del original solo describe las tres solicitudes que sobrevivieron; no sirve para afirmar que era más rápido con cuatro canastas exitosas.

Se continuó con la forma de SQL con precios compartidos, corrigiendo después la regresión descrita abajo. Este primer candidato aún incluía seis campos y repetía el filtro de estado abierto. El ajuste `enable_parallel_hash=off` fue exclusivamente diagnóstico, expiró al terminar cada transacción y no forma parte del código de aplicación. No se aumentó la memoria del contenedor: **64 MiB es el límite probado**, sin incremento de recursos respecto del baseline. No se ensayaron límites menores ni se propone un tamaño mínimo universal para producción.

| Plan aislado, fuera de percentiles        | SQL, ms | Hashes paralelos | Gather | JIT informado, ms | Bloques temporales leídos / escritos |
| ----------------------------------------- | ------- | ---------------- | ------ | ----------------- | ------------------------------------ |
| Original                                  | 2.164   | 3                | 3      | 146               | 2.730 / 2.733                        |
| Hash paralelo desactivado por transacción | 2.115   | 0                | 2      | 124               | 3.323 / 3.326                        |
| Precios compartidos                       | 2.306   | 0                | 0      | 0                 | 1.599 / 1.602                        |

La mejora demostrada aquí es disponibilidad y presión sobre memoria compartida; el EXPLAIN aislado nuevo fue algo más lento. Su CTE de precios leyó 50.000 estados abiertos una vez, con ancho estimado de 39 bytes, frente a 1,8 millones de estados históricos retenidos. El resto del histórico sigue disponible para la evidencia temporal.

### Coste de memoria y límites de la medición

El muestreo externo registra `df -B1 /dev/shm` y `memory.current` del cgroup, con una pausa de 100 ms más el coste de ejecutar los comandos y marcas temporales de un segundo. Los máximos son límites inferiores muestreados: una asignación fallida y liberada entre muestras puede no aparecer. Por eso el máximo registrado no tiene que llegar a 64 MiB para que exista un fallo real de capacidad.

En el experimento, la variante nueva tuvo un pico de heap Node de 232 MiB, RSS de 620 MiB y memoria total del contenedor de 3.346 MiB. Esta última incluye PostgreSQL, caché y los datos de la fixture en tmpfs; no es RAM privada de una consulta. La alternativa sin hash paralelo registró 209 MiB, 682 MiB y 3.629 MiB respectivamente. El original tuvo menos consumo porque falló la mayor parte del trabajo: no es una comparación equivalente de memoria por canasta terminada.

La relación intermedia tiene un coste de almacenamiento y las operaciones SQL restantes siguen usando memoria privada y archivos temporales. La corrección no elimina los costes de materialización del JSON, transporte o evaluación de candidatos en Node.

El experimento pareado conservó exactamente el resumen de evaluación, los 27.523 candidatos, las 1.652 filas históricas y los 18.492.786 bytes de su probe. La fixture mixta incluye necesidades sin cobertura completa: sus tres totales de canasta son nulos tanto antes como después. Un 200 significa que la evaluación fue válida, no que todas las necesidades consiguieran compra. La integración sí verifica también canastas completas y sus importes concretos. El benchmark conserva esa misma carga y no representa exclusivamente listas con cobertura completa.

En los controles de búsqueda conservados de la primera matriz los conteos se comparan contra 03C; pequeñas diferencias de bytes no prueban otra reducción de campos. El instante de esa primera matriz termina en `.520`, que PostgreSQL serializa como `.52`, mientras el baseline usaba `.229`. Esa diferencia de formato acorta timestamps de ofertas y beneficios. Las pruebas de equivalencia en la misma fixture no tienen esa variación.

## Regresión detectada y corregida durante la validación

La primera matriz terminó sus 1.320 intentos sin errores, incluyendo las veinte canastas concurrentes que antes fallaban. Sin embargo, la canasta solo genérica a 50.000 empeoró de **2,58 a 12,24 segundos de p50**. Ese candidato no se aceptó como resultado final; su matriz completa y sus planes se conservan.

La causa estaba en aplicar de nuevo `h.valid_until IS NULL` después de haber materializado únicamente estados abiertos. El plan reutilizaba la fracción de valores nulos del historial completo y subestimaba los candidatos: **cuatro estimados frente a 27.500 reales**. Eligió un nested loop que recorrió el CTE de 9.375 identidades **27.500 veces**. El EXPLAIN aislado llegó a 18,89 segundos, fuera de los percentiles del handler.

La revisión final elimina `valid_until` de la relación intermedia y centraliza el join de precios con dos orígenes internos explícitos: historial directo, que comprueba el estado abierto en el join, y snapshot, que ya lo comprobó al construir `current_prices`. No se omite el filtro ni se relaja ninguna elegibilidad; se aplica una sola vez. El SQL por defecto de las búsquedas conserva exactamente el comportamiento anterior.

La siguiente revisión corrigió la estimación genérica, pero reveló otro salto de coste: la canasta estricta de cincuenta necesidades a 2.000 registros pasó de 0,21 a 1,05 segundos. El coste estimado subió de 498.326 a 549.487 y cruzó los umbrales de inlining/optimización JIT, ambos en 500.000. El tiempo JIT aislado pasó de 70 a 926 ms. Son decisiones por coste estimado del plan, como explica [PostgreSQL 17 sobre JIT](https://www.postgresql.org/docs/17/jit-decision.html); los umbrales y `jit=on` permanecieron intactos.

El join de historia ocultaba la clave de la publicación dentro de JSON. Se cambió a `c.listing_id=a.listing_id`, manteniendo el UUID nativo solo en el contexto interno de la canasta. La prueba de referencia conserva la extracción JSON anterior y compara todo el historial y el resultado. La proyección pública sigue excluyendo ese campo auxiliar. Esta parte de la optimización de historia se incluyó para corregir la regresión observada de 03F; no modifica fechas, continuidad o reglas de comparación.

La canasta genérica final a 50.000 quedó en **3,128 / 3,160 segundos de p50/p95**, frente a 2,576 / 2,615 en 03C: la regresión de 12,24 segundos desapareció, pero persiste un **21,4 % más de p50** en esta comparación histórica. Cada scan del CTE de productos se ejecutó una vez, y su SQL aislado bajó de 18,89 a 1,73 segundos. Sigue por encima de los 1,17 segundos del plan 03C; los bloques temporales leídos/escritos subieron de 1.597/1.600 a 2.670/2.673. El plan final no usa hashes paralelos ni Gather. Esta forma de consulta intercambia parte del paralelismo por menor presión compartida; no se afirma que acelere todas las composiciones.

Con el UUID nativo, el control estricto final a 2.000 registros quedó en **0,195 / 0,199 segundos de p50/p95**, frente a 0,211 / 0,219 de 03C. Su coste estimado bajó a 376.729, el JIT aislado a 65 ms y la ejecución SQL a 155 ms. Esto resuelve la regresión sin modificar los umbrales de JIT.

El segundo candidato se detuvo después de dieciocho casos válidos, al preparar el siguiente volumen. Se canceló únicamente la inserción del esquema propio, lo que activó el `finally` de limpieza; no se interrumpió una muestra medida. Sus resultados parciales y su estado de descarte se conservan junto al primer candidato.

Se repitieron las 27 combinaciones de canastas y se agregaron cien intentos concurrentes en la nueva fixture. Los 39 controles de búsqueda de la primera matriz se conservan porque su SQL no cambió; las quince sentencias representativas guardadas se comprobaron completas contra 03C y sus prefijos/parametrización se volvieron a compilar contra la revisión final. Las respuestas completas de búsqueda también volvieron a pasar integración y Chromium. La matriz consolidada identifica el archivo de origen de cada caso; no se presenta como una única corrida de las mismas fuentes.

## Matriz consolidada y estabilidad

La matriz consolidada contiene **66 combinaciones y 1.320/1.320 solicitudes exitosas** (39 controles de búsqueda conservados y 27 canastas medidas de nuevo), sin errores medidos ni de calentamiento. Coinciden los conteos de filas, candidatos e historia y el número de consultas por solicitud en las 66 comparaciones con 03C. La repetición adicional en la fixture final añadió **100/100 éxitos** a 50.000 registros en 25 tandas de cuatro. En conjunto, el código definitivo completó **120/120 canastas concurrentes a 50.000**, repartidas en treinta tandas en la fixture final, con los mismos 64 MiB. Los veinte éxitos del diagnóstico pareado se registran por separado.

### Canastas secuenciales: p50 / p95 en segundos

| Registros | Caso                | 03C         | 03F         |
| --------- | ------------------- | ----------- | ----------- |
| 2.000     | Mixta 5             | 0,17 / 0,18 | 0,14 / 0,15 |
| 2.000     | Mixta 5 beneficios  | 0,17 / 0,18 | 0,14 / 0,15 |
| 2.000     | Mixta 20            | 0,28 / 0,29 | 0,24 / 0,26 |
| 2.000     | Mixta 20 beneficios | 0,27 / 0,29 | 0,24 / 0,26 |
| 2.000     | Mixta 50            | 0,35 / 0,36 | 0,31 / 0,32 |
| 2.000     | Mixta 50 beneficios | 0,34 / 0,36 | 0,32 / 0,32 |
| 2.000     | Estricta 50         | 0,21 / 0,22 | 0,20 / 0,20 |
| 2.000     | Genérica 5          | 0,16 / 0,18 | 0,14 / 0,16 |
| 10.000    | Mixta 5             | 0,68 / 0,70 | 0,60 / 0,61 |
| 10.000    | Mixta 5 beneficios  | 0,68 / 0,70 | 0,60 / 0,61 |
| 10.000    | Mixta 20            | 0,82 / 0,86 | 0,73 / 0,75 |
| 10.000    | Mixta 20 beneficios | 0,81 / 0,85 | 0,73 / 0,74 |
| 10.000    | Mixta 50            | 1,89 / 1,92 | 0,79 / 0,80 |
| 10.000    | Mixta 50 beneficios | 1,90 / 1,95 | 0,80 / 0,85 |
| 10.000    | Estricta 50         | 1,07 / 1,10 | 0,21 / 0,22 |
| 10.000    | Genérica 5          | 0,67 / 0,68 | 0,64 / 0,64 |
| 50.000    | Mixta 5             | 3,25 / 3,29 | 2,95 / 3,00 |
| 50.000    | Mixta 5 beneficios  | 3,26 / 3,29 | 2,96 / 3,00 |
| 50.000    | Mixta 20            | 3,47 / 3,50 | 3,23 / 3,26 |
| 50.000    | Mixta 20 beneficios | 3,50 / 3,52 | 3,25 / 3,30 |
| 50.000    | Mixta 50            | 4,73 / 4,76 | 4,31 / 4,38 |
| 50.000    | Mixta 50 beneficios | 4,74 / 4,78 | 4,31 / 4,33 |
| 50.000    | Estricta 50         | 1,51 / 1,53 | 0,39 / 0,39 |
| 50.000    | Genérica 5          | 2,58 / 2,61 | 3,13 / 3,16 |

### Cuatro solicitudes concurrentes

| Registros | Caso                | Éxitos 03C → 03F | 03C p50 / p95, s | 03F p50 / p95, s |
| --------- | ------------------- | ---------------- | ---------------- | ---------------- |
| 2.000     | Amplia por unitario | 20/20 → 20/20    | 0,25 / 0,35      | 0,22 / 0,33      |
| 2.000     | Mixta 20            | 20/20 → 20/20    | 0,37 / 0,50      | 0,32 / 0,44      |
| 10.000    | Amplia por unitario | 20/20 → 20/20    | 1,15 / 1,62      | 1,30 / 1,84      |
| 10.000    | Mixta 20            | 20/20 → 20/20    | 1,12 / 1,69      | 1,06 / 1,61      |
| 50.000    | Amplia por unitario | 20/20 → 20/20    | 5,41 / 8,01      | 6,27 / 8,83      |
| 50.000    | Mixta 20            | 0/20 → 20/20     | — / —            | 4,87 / 7,62      |

### Control de búsquedas a 50.000

| Caso                  | 03C p50 / p95, s | 03F p50 / p95, s |
| --------------------- | ---------------- | ---------------- |
| Búsqueda amplia       | 3,56 / 3,59      | 3,80 / 4,32      |
| Amplia por unitario   | 3,54 / 3,63      | 3,97 / 4,50      |
| Amplia por total      | 3,55 / 3,59      | 3,73 / 4,37      |
| Selectiva             | 0,61 / 0,61      | 0,62 / 0,63      |
| Sin coincidencias     | 0,31 / 0,32      | 0,61 / 0,61      |
| Arroz                 | 0,61 / 0,62      | 0,62 / 0,64      |
| Categoría sin texto   | 1,04 / 1,05      | 1,21 / 1,29      |
| Categoría y texto     | 3,60 / 4,73      | 4,64 / 4,87      |
| Tienda/unidad         | 3,53 / 3,56      | 4,64 / 4,67      |
| Página 2              | 3,55 / 3,57      | 4,66 / 4,68      |
| Página 10             | 3,55 / 3,62      | 4,68 / 5,29      |
| Amplia con beneficios | 3,54 / 3,58      | 4,65 / 4,72      |

### Repetición de estabilidad y memoria

| Corrida del código definitivo | Éxitos  | p50 / p95, s | Éxitos/s | Pico `/dev/shm`, MiB | Heap / RSS Node, MiB |
| ----------------------------- | ------- | ------------ | -------- | -------------------- | -------------------- |
| Caso concurrente de la matriz | 20/20   | 4,87 / 7,62  | 0,525    | 2,22                 | 286 / 657            |
| Repetición, 25 tandas         | 100/100 | 4,96 / 7,67  | 0,524    | 2,22                 | 290 / 711            |

No hubo códigos 53100 ni respuestas 503 en la matriz ni en la repetición de estabilidad del código definitivo. La repetición usa el mismo caso mixto de veinte necesidades y conserva 27.523 candidatos y 1.652 filas históricas. Cien intentos adicionales verifican estabilidad en este escenario; no establecen una garantía de producción ni cubren otras distribuciones, concurrencias superiores, red de Neon o HTTP de Next.

La comparación con 03C es histórica, sobre el mismo host, con fixtures regeneradas y estadísticas de PostgreSQL recalculadas; no es un A/B aleatorizado. También se muestrea el contenedor externamente en 03F. Quince sentencias de búsqueda guardadas en los planes, a las tres escalas, conservan exactamente el SQL anterior al ignorar espacios. Sus variaciones de latencia no pueden atribuirse a un cambio de lógica de búsqueda. Se publican tanto mejoras como regresiones y no se deduce significancia estadística de veinte observaciones.

## Costes pendientes y prioridad

La canasta genérica de cinco necesidades a 50.000 conserva **27.500 candidatos y 18,33 MB de JSON**. En la revisión final, el p50 de espera del cliente DB fue 1.792 ms y la CPU Node media por solicitud, 1.489 ms. Son medidas distintas y no deben sumarse ni restarse como fases exclusivas. La canasta estricta del mismo volumen solo transporta 197 candidatos y unos 0,64 MB. Esta diferencia muestra por qué el control genérico sigue siendo una prioridad, aunque ya no repita el scan de identidades.

Conviene continuar con perfiles de candidatos y construcción/lectura del JSON, preservando la decisión completa de familias, precios y cobertura. En el plan final de la canasta mixta de cincuenta necesidades a 50.000, el JIT aún costó 1.019 ms dentro de 2.798 ms de ejecución SQL; sigue siendo relevante para esa composición. No se suma ese tiempo otra vez al total SQL. No corresponde imponer un `LIMIT` temprano que cambie la comparación. Los planes finales y los temporales deben orientar cualquier reducción adicional de trabajo. La búsqueda por categoría y texto sigue siendo otra oportunidad separada: su SQL no se modificó en 03F.

## Reglas y verificación funcional

La prueba de equivalencia compara el nuevo lector con el SQL histórico ejecutado realmente en la misma fixture. Verifica identidades, nombres, conteos de tiendas, resultados completos de canastas, candidatos, snapshot bruto y evidencia histórica. Incluye vínculos manuales, obsoletos o de baja confianza; normalización invalidada; grupos insuficientes; ofertas inactivas, sin precio abierto, a cero, por kilogramo, antiguas, futuras o no disponibles; el umbral exacto de confianza y vínculos inválidos inactivos.

Se mantienen precio ordinario positivo, PEN/UN para identidad e historia, la distinción UN/KG en ofertas genéricas, frescura, disponibilidad triestado, fingerprint/versión, beneficios separados, `linked_at`, ventanas de observación, continuidad de estados, conteo completo del catálogo y rechazo al exceder 50.000 ofertas. La historia no se recorta a los precios abiertos.

Validación funcional ejecutada antes de la matriz, sin competir con las mediciones; las comprobaciones finales de formato y documentación se ejecutaron después:

- Lint, TypeScript, formato, documentación y `git diff --check`: correctos.
- Pruebas unitarias y límites web: **894 aprobadas**.
- Integración: **145 aprobadas** — 133 DB y doce handlers web.
- Build de producción: correcto.
- Chromium después del build: **87 aprobadas y ocho omitidas**. Las omisiones son los escenarios existentes que requieren un catálogo externo persistente; los casos controlados con PostgreSQL propio sí se ejecutaron.

Los cinco esquemas propios usados en reproducción, diagnóstico y candidatos fueron eliminados por sus harnesses; se verificó su ausencia al terminar. El límite de `/dev/shm` y los parámetros de PostgreSQL permanecieron intactos. Los hashes de las 144 fuentes/configuraciones del manifiesto final no cambiaron durante las mediciones.

## Reproducción y artefactos

```sh
pnpm test:db:up
pnpm benchmark:catalog:local --stability-samples=100 --output=.artifacts/03F-matriz-NUEVA/results.json
# Repetición independiente opcional, en otra fixture propia:
pnpm benchmark:catalog:local --sizes=50000 --cases=basket-mixed-20-standard --concurrency=4 --samples=100 --output=.artifacts/03F-estabilidad-NUEVA/results.json
```

El wrapper exige el destino local de pruebas explícito. Cada corrida crea y elimina su propio esquema aleatorio, aplica las migraciones registradas dentro de ese esquema y jamás recurre al `DATABASE_URL` de aplicación. El fixture conserva 80 plantillas de escritores reales, cuatro tiendas, 36 observaciones diarias y clones con fingerprints comprobados; los títulos repetidos no equivalen a 50.000 productos semánticamente distintos.

Evidencia ignorada por Git que debe conservarse al compartir el reporte:

- `.artifacts/catalog-shared-memory-baseline-2026-10-15/`: reproducción intacta de 03C, manifiesto y resultados.
- `.artifacts/catalog-shared-memory-experiments-2026-10-15/`: runner diagnóstico, tres variantes, planes, muestras externas de memoria y resumen.
- `.artifacts/catalog-shared-memory-2026-10-15/`: primera matriz completa, conservada como candidato superado por la regresión genérica, con planes y validaciones.
- `.artifacts/catalog-shared-memory-final-2026-10-15/`: segundo candidato, dieciocho casos completos y aborto controlado durante la preparación, por la regresión de JIT.
- `.artifacts/catalog-shared-memory-verified-2026-10-15/`: canastas de la revisión definitiva, cien intentos adicionales, consolidación con los controles de búsqueda, manifiesto, planes, memoria y validaciones repetidas.

El harness conserva las mismas operaciones medidas y añade marcas de inicio/fin, el plan de la canasta mixta de veinte necesidades y `--stability-samples`. La repetición adicional ocurre después de la matriz elegida, en la misma fixture propia, y se guarda en `stabilityMeasurements`. `--cases` permite comprobar primero los controles estrictos y genéricos, respetando el orden indicado y eliminando duplicados. La ejecución termina con código cero cuando registra todos los intentos, aunque alguno falle; la aceptación depende de los estados y errores guardados en el JSON. Los percentiles son de éxitos y el throughput cuenta únicamente solicitudes exitosas.

El HEAD de partida es `6567774b75522983cec2ccb2ab593c4b405b7dd3`, con el trabajo previo de los prompts anteriores todavía en el árbol local; no es un baseline limpio de ese commit. Los manifiestos identifican las fuentes efectivamente medidas. El `production-03f.diff` de la revisión definitiva aísla las cuatro modificaciones productivas de esta tarea: los originales reconstruidos para ese diff coinciden con los hashes verificados de 03C. También cambiaron el harness y las pruebas de equivalencia, proyección y fixture de continuidad. El SQL compilado de búsqueda se comprobó idéntico al anterior al ignorar espacios.

## Trabajo posterior

Los informes anteriores conservan sus resultados y sus fallos; este documento no autoriza despliegues ni cambios de configuración de producción. Las mejoras siguientes deben partir del lector de 03F y mantener su prueba concurrente a 64 MiB. El JIT sigue habilitado y su coste varía por caso: el control genérico final no lo activó, el estricto pequeño registró 65 ms y el mixto de cincuenta necesidades a 50.000 registró 1.019 ms. Los cuellos de botella deben determinarse con los planes finales, sin extrapolar el salto de JIT de la revisión descartada.

### Prompt 03B: una lectura para categoría y texto

```text
Lee AGENTS.md, docs/public-search.md, docs/local-testing.md y docs/history/catalog-shared-memory-performance-2026-10-15.md. Unifica las lecturas filtrada y global de búsquedas con categoría y texto cuando puedan resolverse con un único recorrido seguro.

Conserva ofertas completas antes de decidir ranking, conteos globales, opciones de tiendas/unidades, descubrimiento, IDs de refresco, orden y paginación. Mantén la proyección de 03A y las reglas canónicas compartidas; no agregues caché ni un LIMIT prematuro. Prueba igualdad de respuestas completas contra el lector actual, en los tres ordenamientos y ambos modos de precio. Repite la matriz de 2.000, 10.000 y 50.000 y el caso de cuatro canastas concurrentes con 64 MiB. Informa consultas, bytes, CPU, memoria, errores y p50/p95 de éxitos, separando variaciones de formato de verdaderos ahorros de datos.
```

### Prompt 03D: afinar los joins y las estimaciones después de 03F

```text
Lee AGENTS.md, docs/eligibility.md, docs/shopping-list.md y docs/history/catalog-shared-memory-performance-2026-10-15.md. Perfila de nuevo las canastas con el lector de 03F: separa precios actuales, identidad, conteo global, historia, construcción del JSON y evaluación en Node. Usa los planes nuevos; no asumas que el JIT antiguo continúa siendo el cuello de botella.

Conserva el join histórico por UUID nativo y el filtro de estado abierto aplicado una sola vez, ya implementados en 03F. Investiga únicamente las estimaciones y operaciones que sigan siendo costosas en los planes nuevos, considerando una relación mínima de candidatos actuales cuando EXPLAIN lo justifique. Mantén el snapshot único, el conteo global, todos los límites, linked_at, ventanas, continuidad, precio ordinario positivo, triestado, identidad y beneficios. Demuestra equivalencia de snapshots y respuestas contra 03F. Repite la matriz y al menos cien solicitudes en tandas de cuatro a 50.000 con los mismos 64 MiB; no desactives funciones globalmente ni ocultes regresiones de latencia en catálogos pequeños.
```

### Prompt 03E: medir HTTP antes de fijar objetivos de usuario

```text
Lee AGENTS.md, las instrucciones de pruebas locales y el informe de rendimiento 03F. Mide búsquedas y evaluación de listas a través de un build real de Next y sus rutas HTTP, usando TEST_DATABASE_URL explícito y esquemas aleatorios propios. Consulta primero los docs de la versión de Next instalada.

Separa el coste SQL/handler ya medido de renderizado, serialización, transferencia y cliente. Usa una muestra con canastas completas e incompletas, sin alterar los benchmarks anteriores. Comprueba cancelación y concurrencia, mantén las reglas y conserva los fallos como evidencia. Propón objetivos solo para el entorno realmente medido; no cambies producción ni despliegues como parte de la medición.
```
