# Joins y elegibilidad canónica: resultado del prompt 03C

Continuación de la [reducción de proyección del prompt 03A](catalog-projection-performance-2026-10-15.md) y del [diagnóstico inicial](catalog-performance-2026-10-15.md). La referencia directa es la corrida completa del 03A, con las mismas fixtures, cargas y recursos locales.

A 50.000 registros, “arroz” pasa de **12,45 a 0,61 s**, categoría con texto de **22,04 a 3,60 s** y la canasta mixta de cincuenta de **6,94 a 4,73 s** de mediana. **La concurrencia de canastas no está resuelta: fallan veinte de veinte solicitudes por memoria compartida agotada, frente a dieciséis fallos en 03A.** La optimización queda implementada y medida; no se considera aprobada la capacidad concurrente de esa configuración.

## Cambio implementado

Las búsquedas y canastas necesitaban saber si una oferta tenía una identidad pública y cuántas tiendas retenía ese producto. Para obtener esos datos, antes unían cada listing con una relación que agregaba todas las ofertas canónicas como JSON, incluidos beneficios, URLs y textos auxiliares de búsqueda. La canasta también necesitaba el nombre actual del producto para resolver las preferencias guardadas.

Ahora [public-products.ts](../../packages/db/src/public-products.ts) ofrece una relación mínima, `eligibleProductIdentities`, con tres columnas: UUID, nombre público y número de ofertas retenidas. Esa relación se materializa una vez dentro de la sentencia SQL. La materialización no persiste datos entre solicitudes ni introduce una caché de aplicación.

Los [lectores genéricos](../../packages/db/src/generic-offers.ts), la [canasta](../../packages/db/src/shopping-list.ts) y el tramo genérico de la [auditoría de cobertura](../../packages/db/src/catalog-coverage.ts) usan esa relación. El lector de comparación completa conserva su JSON de ofertas. Ambos comparten los fragmentos SQL de origen de ofertas y de admisión del grupo: no hay dos implementaciones productivas de las reglas.

La versión nueva conserva:

- Vínculos automáticos, versión actual y confianza mínima; rechazo de todo el grupo si cualquier vínculo es manual, obsoleto o de confianza insuficiente, incluso si ese miembro está inactivo.
- Listings activos, normalización existente, correspondencia entre listing y tienda, estado de precio abierto, PEN/UN y precio ordinario positivo; mínimo de dos tiendas distintas.
- Conteo de ofertas retenidas, separado de las ofertas utilizables ahora. La elegibilidad canónica no incorpora un nuevo filtro de stock o antigüedad: la compra actual sigue aplicando disponibilidad triestado, frescura, fingerprint y versión de normalización en sus límites existentes.
- UUID de productos/listas, paginación, orden, beneficios, reglas de sustitución y límites del catálogo. El conteo global, candidatos, nombres e historia de la canasta siguen perteneciendo a una única sentencia consistente.
- Ventanas históricas, cortes por `linked_at` y evidencia diaria. El cálculo de recomendaciones de día no se modifica.

No se añaden índices, migraciones, dependencias ni cambios globales de JIT o del planificador. La salida de catorce campos introducida en 03A se conserva; el objetivo de este paso es reducir trabajo interno de PostgreSQL.

## Equivalencia funcional

La nueva [suite de integración](../../packages/db/src/canonical-eligibility.integration.test.ts) ejecuta la consulta optimizada y una [copia congelada del SQL anterior](../../packages/db/src/testing/legacy-public-eligibility.ts) sobre el mismo esquema aleatorio de pruebas. La referencia solo existe en código de pruebas. Se verifican también los valores y posiciones de los parámetros de política.

Diez pruebas cubren dieciséis escenarios canónicos: grupo válido, miembro manual, versión obsoleta, confianza inferior al umbral, invalidación mediante el writer real de normalización, una sola tienda, miembros inactivos, precio cero, precios cerrados, ausencia de normalización, estados KG, observaciones antiguas/futuras, indisponibilidad, confianza exactamente en el umbral y miembro inválido que además está inactivo.

Se comparan todos los IDs, nombres y conteos de la relación mínima contra el agregado anterior. También se comprueban las respuestas completas de producto y búsqueda en modos ordinario/beneficios, tres órdenes, páginas 1/2/10, categorías, familia, consulta selectiva/sin resultados y filtro de tienda/unidad. Las canastas comparan decisiones, costes y alternativas, además del snapshot crudo con candidatos, productos, conteo global e historia; solo se excluyen las mediciones de tiempo y se normaliza el orden de agregados SQL sin orden contractual.

Las fixtures mantienen cuatro tiendas, 320 listings derivados de ochenta plantillas, 36 observaciones diarias, beneficios CMR, unidades KG/UN y disponibilidad verdadera/falsa/desconocida. Una asociación reciente comprueba que no hereda observaciones anteriores. Las regresiones existentes del 03A siguen verificando fingerprints inválidos y la proyección de salida.

## Método de rendimiento

Se repite la matriz original a **2.000, 10.000 y 50.000 listings**: doce búsquedas y ocho canastas secuenciales, más búsqueda amplia y canasta mixta de veinte necesidades con concurrencia cuatro. Son veinte muestras medidas por combinación, con calentamientos excluidos. El harness, los datos de volumen y los parámetros de los casos no cambian.

La referencia es `.artifacts/catalog-projection-2026-10-15/results.json`; la nueva evidencia está en `.artifacts/catalog-eligibility-2026-10-15/`. Un piloto exploratorio separado de dos muestras a 50.000 registros validó la dirección del cambio; sus resultados no se mezclan con la matriz final.

Se mantienen Node 24.3.0, PostgreSQL 17.11, el host Ryzen 5 7600, `shared_buffers=128MB`, `work_mem=4MB`, `max_parallel_workers_per_gather=2`, JIT activado y **64 MiB de memoria compartida de Docker**. No se ejecutan builds ni suites intensivas durante las mediciones.

El tiempo total corresponde al lector real de búsqueda y al handler local real de canasta, incluidos sus cálculos en Node. No mide HTTP de Next, navegador ni Neon remoto. Los percentiles son de solicitudes exitosas y usan rango más próximo; p95 requiere veinte éxitos. La espera DB incluye pool, transporte y decodificación; en categoría/texto suma consultas que se solapan. EXPLAIN se ejecuta por separado y no constituye un percentil; tiempos de nodos padres e hijos no se suman.

Los bytes son JSON UTF-8 de filas SQL decodificadas, no tráfico de protocolo ni tamaño de página. La memoria muestreada es de Node, incluye calentamientos y puede omitir picos síncronos; no incluye PostgreSQL. Los títulos repetidos de las fixtures miden volumen de lectura, no 50.000 productos diferentes. El equipo es compartido y las corridas son sucesivas, no un experimento A/B aleatorizado; estadísticas, UUID y actividad del host pueden variar.

## Resultados

Se completaron **66 combinaciones y 1.320 solicitudes medidas: 1.300 exitosas y veinte fallidas**. Los veinte errores corresponden a la canasta mixta concurrente de 50.000 listings. Las otras 65 combinaciones completaron sus veinte solicitudes. Los conteos de filas, candidatos e historia y el número de consultas coinciden con 03A en las 66 capturas de control; las capturas son solicitudes aisladas previas a la carga concurrente, no convierten sus errores en éxitos.

Las veinte combinaciones secuenciales de 50.000 listings mejoran su p50 en esta corrida. La búsqueda por familia “arroz” reduce la mediana un **95,1 %**, categoría con texto un **83,6 %**, la canasta mixta de cincuenta necesidades un **31,9 %** y la estricta de cincuenta un **45,7 %**. La mejora no es uniforme a escalas menores y **la aceptación de concurrencia sigue fallida**.

### Latencia local: p50 / p95 en segundos

| Listings | Caso              | Antes         | Después     |
| -------- | ----------------- | ------------- | ----------- |
| 2000     | Búsqueda amplia   | 0,20 / 0,20   | 0,17 / 0,17 |
| 2000     | Categoría y texto | 0,26 / 0,29   | 0,17 / 0,22 |
| 2000     | Mixta 50          | 0,42 / 0,44   | 0,35 / 0,36 |
| 2000     | Estricta 50       | 1,30 / 1,39   | 0,21 / 0,22 |
| 10000    | Búsqueda amplia   | 0,78 / 0,98   | 0,88 / 0,93 |
| 10000    | Categoría y texto | 0,83 / 0,99   | 0,90 / 0,96 |
| 10000    | Mixta 50          | 2,26 / 2,36   | 1,89 / 1,92 |
| 10000    | Estricta 50       | 1,44 / 1,49   | 1,07 / 1,10 |
| 50000    | Búsqueda amplia   | 4,20 / 5,30   | 3,56 / 3,59 |
| 50000    | Categoría y texto | 22,04 / 23,12 | 3,60 / 4,73 |
| 50000    | Mixta 50          | 6,94 / 7,53   | 4,73 / 4,76 |
| 50000    | Estricta 50       | 2,78 / 3,11   | 1,51 / 1,53 |

### Matriz secuencial completa a 50.000

| Caso                  | Antes p50 / p95 s | Después p50 / p95 s |
| --------------------- | ----------------- | ------------------- |
| Búsqueda amplia       | 4,20 / 5,30       | 3,56 / 3,59         |
| Amplia por unitario   | 4,19 / 5,27       | 3,54 / 3,63         |
| Amplia por total      | 4,16 / 5,26       | 3,55 / 3,59         |
| Selectiva             | 1,04 / 1,09       | 0,61 / 0,61         |
| Sin coincidencias     | 0,36 / 0,65       | 0,31 / 0,32         |
| Arroz                 | 12,45 / 12,73     | 0,61 / 0,62         |
| Categoría sin texto   | 1,54 / 1,59       | 1,04 / 1,05         |
| Categoría y texto     | 22,04 / 23,12     | 3,60 / 4,73         |
| Metro/litros          | 4,37 / 5,68       | 3,53 / 3,56         |
| Página 2              | 4,29 / 5,45       | 3,55 / 3,57         |
| Página 10             | 4,29 / 5,42       | 3,55 / 3,62         |
| Amplia con beneficios | 4,25 / 5,35       | 3,54 / 3,58         |
| Mixta 5               | 5,19 / 5,34       | 3,25 / 3,29         |
| Mixta 5 beneficios    | 5,06 / 5,31       | 3,26 / 3,29         |
| Mixta 20              | 5,97 / 6,67       | 3,47 / 3,50         |
| Mixta 20 beneficios   | 6,96 / 7,21       | 3,50 / 3,52         |
| Mixta 50              | 6,94 / 7,53       | 4,73 / 4,76         |
| Mixta 50 beneficios   | 6,42 / 6,84       | 4,74 / 4,78         |
| Estricta 50           | 2,78 / 3,11       | 1,51 / 1,53         |
| Genérica 5            | 4,17 / 4,24       | 2,58 / 2,61         |

### Regresiones observadas en las escalas menores

Estas son todas las combinaciones con veinte éxitos en ambas corridas cuyo p50 aumentó. No se omiten por ser pequeñas. Son observaciones entre corridas sucesivas; la prueba no permite atribuir cada diferencia exclusivamente al cambio de SQL.

| Listings | Caso                  | p50 antes → después, ms | Cambio  |
| -------- | --------------------- | ----------------------- | ------- |
| 2000     | search-page-2         | 201 → 211               | +4,9 %  |
| 2000     | search-page-10        | 207 → 212               | +2,2 %  |
| 2000     | search-benefits       | 203 → 211               | +3,8 %  |
| 10000    | search-wide-relevance | 782 → 882               | +12,9 % |
| 10000    | search-wide-unit      | 774 → 886               | +14,5 % |
| 10000    | search-wide-total     | 771 → 894               | +16,0 % |
| 10000    | search-absent         | 78 → 131                | +68,2 % |
| 10000    | search-category       | 280 → 347               | +24,0 % |
| 10000    | search-category-text  | 829 → 900               | +8,5 %  |

En particular, la amplia de 10.000 pasa de 782 a 882 ms, aunque su p95 baja de 979 a 927 ms. El EXPLAIN aislado de ese caso registra 669 → 639 ms y el agregado canónico 88 → 38 ms. Esto acredita menor trabajo del agregado en ese plan, pero no una mejora uniforme de la latencia completa. Para establecer el efecto con mayor precisión se requiere una repetición A/B intercalada sobre una misma fixture.

### Datos transferidos y memoria

| Listings | Caso              | MB antes → después | Reducción | Heap MiB antes → después | RSS MiB antes → después |
| -------- | ----------------- | ------------------ | --------- | ------------------------ | ----------------------- |
| 2000     | Búsqueda amplia   | 1,31 → 1,31        | 0,0 %     | 96 → 96                  | 303 → 302               |
| 2000     | Categoría y texto | 1,71 → 1,71        | 0,0 %     | 125 → 125                | 329 → 329               |
| 2000     | Mixta 50          | 1,24 → 1,24        | 0,0 %     | 88 → 82                  | 347 → 346               |
| 2000     | Estricta 50       | 0,64 → 0,64        | 0,0 %     | 99 → 99                  | 349 → 348               |
| 10000    | Búsqueda amplia   | 6,54 → 6,54        | 0,0 %     | 184 → 169                | 419 → 417               |
| 10000    | Categoría y texto | 8,55 → 8,55        | 0,0 %     | 172 → 174                | 429 → 427               |
| 10000    | Mixta 50          | 4,17 → 4,17        | 0,0 %     | 87 → 99                  | 429 → 429               |
| 10000    | Estricta 50       | 0,64 → 0,64        | 0,0 %     | 101 → 101                | 429 → 428               |
| 50000    | Búsqueda amplia   | 32,71 → 32,71      | 0,0 %     | 167 → 361                | 606 → 627               |
| 50000    | Categoría y texto | 42,77 → 42,77      | 0,0 %     | 510 → 384                | 754 → 660               |
| 50000    | Mixta 50          | 18,83 → 18,83      | 0,0 %     | 118 → 150                | 790 → 744               |
| 50000    | Estricta 50       | 0,64 → 0,64        | 0,0 %     | 88 → 109                 | 756 → 694               |

El payload de ofertas de 03A se conserva: la búsqueda amplia sigue devolviendo **32,71 MB** a 50.000, y categoría/texto **42,77 MB**, incluidos los 15.000 candidatos duplicados entre sus dos consultas. Las pequeñas diferencias de unos bytes en agregados de canasta no constituyen una optimización de transporte. La equivalencia de filas se prueba con ambos SQL sobre la misma fixture.

La memoria de Node tampoco baja de forma uniforme. El pico de heap de la búsqueda amplia sube de **167 a 361 MiB** y el de la canasta mixta de cincuenta de **118 a 150 MiB**; categoría/texto baja de 510 a 384 MiB. El menor trabajo de PostgreSQL no justifica prometer menor heap de Node. Los picos incluyen la captura de payload y calentamientos, y dependen del momento de recolección de basura.

### Cuatro solicitudes concurrentes

| Listings | Caso                | Antes p50 / p95 s | Después p50 / p95 s | Éxitos antes → después |
| -------- | ------------------- | ----------------- | ------------------- | ---------------------- |
| 2000     | Amplia por unitario | 0,28 / 0,39       | 0,25 / 0,35         | 20/20 → 20/20          |
| 2000     | Mixta 20            | 0,43 / 0,55       | 0,37 / 0,50         | 20/20 → 20/20          |
| 10000    | Amplia por unitario | 1,22 / 1,78       | 1,15 / 1,62         | 20/20 → 20/20          |
| 10000    | Mixta 20            | 1,43 / 2,01       | 1,12 / 1,69         | 20/20 → 20/20          |
| 50000    | Amplia por unitario | 6,16 / 8,94       | 5,41 / 8,01         | 20/20 → 20/20          |
| 50000    | Mixta 20            | 6,86 / —          | — / —               | 4/20 → 0/20            |

**La última fila es una regresión de disponibilidad observada: cuatro éxitos de veinte en 03A frente a cero de veinte ahora.** Además fallan las cuatro solicitudes del calentamiento concurrente. Todas devuelven 503 y `SQLSTATE 53100`: PostgreSQL no puede ampliar un segmento de memoria compartida en 4 MiB porque el dispositivo está lleno. El límite del contenedor sigue en 64 MiB y no se aumentó.

No hay p50/p95 de solicitudes exitosas para ese caso ni throughput exitoso: es cero. Los errores terminan alrededor de 0,48 s; **ese tiempo no se presenta como una mejora de rendimiento**. Tampoco se interpreta su menor memoria de Node como una mejora: no completó el mismo trabajo. La captura aislada previa sí tuvo éxito, lo que confirma que el problema se manifiesta bajo la carga concurrente.

Los planes de canasta siguen usando hashes paralelos. La evidencia identifica agotamiento de memoria compartida; esta corrida no aísla cuánto de la diferencia 4/20 → 0/20 se debe al plan, a la sincronización de los workers o al estado del host. Cambiar el plan puede cambiar cuándo y cuánta memoria se solicita. No se acredita capacidad concurrente ni preparación para desplegar bajo esa carga. Resolver y volver a validar este límite es la siguiente prioridad.

### Planes ANALYZE/BUFFERS

Se comparan los veintisiete planes capturados con los del 03A. La consulta de categoría/texto tiene dos sentencias; se emparejan por su forma global/filtrada y número de parámetros, no por el orden en que terminan. Esta tabla resume doce planes representativos. Son ejecuciones instrumentadas separadas, no percentiles; JIT ya forma parte del tiempo SQL.

| Listings | SQL                      | Ejecución ms antes → después | JIT ms antes → después | Bloques temp. leídos antes → después | Bloques temp. escritos antes → después |
| -------- | ------------------------ | ---------------------------- | ---------------------- | ------------------------------------ | -------------------------------------- |
| 2000     | Amplia                   | 199 → 156                    | 0 → 0                  | 0 → 0                                | 0 → 0                                  |
| 2000     | Categoría/texto filtrada | 66 → 54                      | 0 → 0                  | 0 → 0                                | 0 → 0                                  |
| 2000     | Mixta 50                 | 283 → 259                    | 88 → 86                | 0 → 0                                | 0 → 0                                  |
| 2000     | Estricta 50              | 1284 → 171                   | 1154 → 70              | 0 → 0                                | 0 → 0                                  |
| 10000    | Amplia                   | 669 → 639                    | 0 → 0                  | 632 → 632                            | 634 → 634                              |
| 10000    | Categoría/texto filtrada | 388 → 167                    | 0 → 0                  | 0 → 0                                | 0 → 0                                  |
| 10000    | Mixta 50                 | 1864 → 1568                  | 1269 → 1099            | 1872 → 0                             | 468 → 0                                |
| 10000    | Estricta 50              | 1436 → 1037                  | 1122 → 875             | 1872 → 0                             | 468 → 0                                |
| 50000    | Amplia                   | 2723 → 2215                  | 70 → 0                 | 5822 → 3156                          | 5834 → 3167                            |
| 50000    | Categoría/texto filtrada | 24934 → 802                  | 71 → 0                 | 14732710 → 971                       | 2663 → 974                             |
| 50000    | Mixta 50                 | 4871 → 3210                  | 2298 → 1832            | 24775 → 3165                         | 17768 → 3169                           |
| 50000    | Estricta 50              | 2482 → 1514                  | 1773 → 1483            | 10155 → 442                          | 3145 → 443                             |

En categoría/texto filtrada a 50.000, el SQL pasa de **24.934 a 802 ms**. Las lecturas temporales caen de **14.732.710 a 971 bloques**. El plan deja de arrastrar el agregado ancho de ofertas por el join costoso; construye una vez las 9.375 identidades estrechas, en unos 146 ms. La consulta global de esa búsqueda pasa de 3.904 a 2.167 ms, con 5.822 → 3.156 bloques temporales leídos. Los bloques no equivalen a lecturas de disco físico: el PostgreSQL de pruebas almacena datos en tmpfs.

La canasta mixta de cincuenta reduce el SQL de 4.871 a 3.210 ms, pero todavía dedica **1.832 ms a JIT**. En la estricta, EXPLAIN registra 1.483 ms de JIT y 1.514 ms de ejecución SQL; esos tiempos no se suman ni se convierten en un porcentaje de CPU de Node. El cambio aligera la elegibilidad, pero no resuelve por completo la forma de los joins históricos y el coste de compilación. Son trabajo para 03D, conservando los mismos cortes temporales y controles de cobertura.

La espera DB mediana de la amplia a 50.000 baja de 2.819 a 2.229 ms; la de la mixta de cincuenta, de 5.264 a 3.267 ms. La transformación de decenas de miles de ofertas y la transferencia a Node siguen siendo costes relevantes. No se aplica un `LIMIT 20` prematuro que pueda perder unidades, resultados o candidatos válidos.

## Reproducción y evidencia

```sh
pnpm benchmark:catalog:local --output=.artifacts/catalog-eligibility-NUEVA-CORRIDA/results.json
```

Elegir un destino nuevo: el harness rechaza sobrescribir resultados. Solo usa `TEST_DATABASE_URL` explícito y un esquema aleatorio propio en la base de pruebas local; no usa la base de aplicación ni hace solicitudes a tiendas.

La carpeta de evidencia contiene resultados completos, progreso JSONL, distribuciones por escala, SQL parametrizado y planes `ANALYZE/BUFFERS`, comparación con 03A, hashes de fuentes, diff exclusivo de este paso y logs de validación. `.artifacts/` está ignorado por Git: para compartir los datos crudos se debe copiar la carpeta completa. Los informes anteriores y sus artefactos se conservan.

## Validación y estado de aceptación

- `pnpm format:check`, `pnpm docs:check`, `pnpm lint`, `pnpm typecheck` y `git diff --check`: correctos.
- `pnpm exec turbo run test --force`: **894 pruebas aprobadas** (550 core, 85 DB, 200 scrapers y 59 límites/estado web).
- `pnpm test:integration:local`: **145 aprobadas** (133 DB y doce handlers web), incluidas las diez regresiones nuevas de equivalencia canónica.
- `pnpm exec turbo run build --force`: build de producción correcto.
- `pnpm test:e2e:fixtures:local`, después del build: **87 aprobadas y ocho omitidas**. El modo controlado omite los ocho escenarios existentes que requieren un catálogo persistente externo; las fixtures aisladas de búsquedas, productos, listas, historia y beneficios sí se ejecutaron.
- Benchmark: **66 combinaciones completas**, con **1.300 éxitos y veinte errores medidos**, más cuatro fallos del calentamiento concurrente. La validación de capacidad concurrente a 50.000 **falló**, aunque el comando terminó correctamente de registrar la evidencia.

Se verificaron sin cambios los hashes de las 144 fuentes/configuraciones del manifiesto durante la medición y las validaciones. Las cuatro fuentes productivas diferentes respecto de 03A son `public-products.ts`, `generic-offers.ts`, `shopping-list.ts` y `catalog-coverage.ts`; el harness de rendimiento y las fixtures de volumen conservan sus hashes anteriores. Se añadieron la suite de equivalencia y su SQL de referencia, además de actualizar documentación.

El piloto y la corrida completa eliminaron sus esquemas propios; se confirmó que ambos nombres ya no existen. El contenedor de pruebas preexistente permanece disponible. No se aplicaron migraciones a la base de aplicación ni se realizó despliegue. La capacidad concurrente permanece pendiente de corregir y volver a medir; los tiempos secuenciales no sustituyen esa aceptación.

## Trabajo siguiente y prompts preparados

La prioridad inmediata es **03F**, porque la canasta concurrente no tiene una capacidad aceptada con esta configuración. Después, **03D** puede reducir JIT y el coste de historia; **03B** puede eliminar la doble lectura de categoría/texto. Las tres tareas deben usar este informe como nuevo punto de partida y conservar también los baselines anteriores. Son propuestas para solicitudes posteriores, no cambios realizados en 03C.

### Prompt 03F: resolver y verificar el límite concurrente

```text
Lee AGENTS.md, docs/local-testing.md y docs/history/catalog-eligibility-performance-2026-10-15.md. Investiga el SQLSTATE 53100 de la canasta mixta de veinte necesidades con cuatro solicitudes concurrentes y 50.000 listings: 03A tuvo 4/20 éxitos y 03C tuvo 0/20 con 64 MiB de memoria compartida.

Reproduce el caso en esquemas propios con TEST_DATABASE_URL explícito. Conserva el baseline de 64 MiB y separa experimentos de forma del SQL, paralelismo y recursos del contenedor de pruebas. Revisa los hashes paralelos y mide errores, throughput exitoso, memoria y p50/p95 únicamente de solicitudes exitosas. Si propones más recursos, documenta su coste y el mínimo probado; no cambies configuración de aplicación ni producción. No presentes errores rápidos como mejora ni borres los fallos anteriores. Repite suficientes tandas para verificar estabilidad y conserva las reglas, candidatos, historia y límites del catálogo.
```

### Prompt 03D: reducir coste de historia y JIT

```text
Lee AGENTS.md, docs/eligibility.md, docs/shopping-list.md y docs/history/catalog-eligibility-performance-2026-10-15.md. Investiga los joins y estimaciones de las canastas, en particular la unión de current_listings con evidencia histórica y el coste JIT que sigue apareciendo tras separar la identidad canónica.

Prueba una forma de consulta que conserve UUID nativos y evite conversiones JSON cuando los planes lo justifiquen. Mantén el snapshot único, el conteo global, los límites, linked_at, ventanas temporales, continuidad de estados, cobertura observada, precio ordinario positivo y disponibilidad triestado. Demuestra igualdad de resultados y evidencia histórica contra el lector actual. Compara ANALYZE/BUFFERS y la misma matriz a 2.000, 10.000 y 50.000 en esquemas propios. No desactives JIT globalmente ni cambies la semántica para reducir el tiempo.
```

### Prompt 03B: eliminar la doble lectura de categoría y texto

```text
Lee AGENTS.md, docs/public-search.md y docs/history/catalog-eligibility-performance-2026-10-15.md. Evita que una búsqueda con categoría y texto lea por separado ofertas filtradas y globales cuando pueda resolver ambos resultados con un solo recorrido seguro.

Preserva los resultados de la categoría, conteos globales, opciones de unidades y tiendas, descubrimiento, IDs de refresco, orden y paginación. Conserva la elegibilidad mínima compartida de 03C y la proyección de salida de 03A. No apliques LIMIT 20 antes de completar las decisiones de dominio ni introduzcas caché. Compara respuestas completas contra el comportamiento actual y repite las mismas pruebas de rendimiento en esquemas propios, incluyendo los errores concurrentes como resultados separados.
```
