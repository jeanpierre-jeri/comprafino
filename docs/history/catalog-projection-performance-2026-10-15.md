# Proyección de ofertas: resultado del prompt 03A

Continuación del [diagnóstico de búsquedas y canastas](catalog-performance-2026-10-15.md), con mediciones locales del 15 de octubre de 2026. El cambio reduce los datos que PostgreSQL devuelve a Node manteniendo los mismos candidatos y reglas de comparación.

La búsqueda amplia transfiere **33,5 % menos JSON de ofertas** en las tres escalas. La canasta mixta de 50 necesidades reduce ese volumen entre **24,2 % y 32,9 %**. La mejora de latencia y memoria es desigual: los joins costosos, JIT y el límite de concurrencia local siguen pendientes.

## Cambio implementado

La búsqueda utilizaba `SELECT *` y la canasta serializaba ese mismo registro completo dentro de su snapshot. Ahora ambas seleccionan una proyección explícita compartida de catorce campos, definida junto al validador de ofertas en [generic-offers.ts](../../packages/db/src/generic-offers.ts) y reutilizada por [shopping-list.ts](../../packages/db/src/shopping-list.ts).

Se dejan de transferir cinco auxiliares: `title_text`, `identity_text`, `search_identity`, `search_vector` y `folded_title`. Siguen disponibles dentro de SQL para buscar, filtrar y ordenar. Se conservan los datos de listing y fingerprint, categoría, tienda, URLs, precios ordinarios/de referencia, beneficios, observación, disponibilidad, versión, identidad canónica y número de tiendas.

El cambio no altera predicados, joins, límites de capacidad, orden ni paginación. La canasta conserva el conteo completo del catálogo, los candidatos necesarios, los productos y la historia en una única sentencia consistente. No introduce caché, dependencias, índices ni migraciones. Reducir la proyección puede cambiar el plan físico de PostgreSQL porque disminuye el ancho estimado de las filas; eso se mide por separado de las reglas de selección.

## Equivalencia funcional

La nueva [regresión de integración](../../packages/db/src/offer-projection.integration.test.ts) ejecuta dos clientes reales sobre el mismo esquema aleatorio de pruebas. Uno usa la proyección nueva y el otro reconstruye la selección anterior `SELECT *` únicamente en los dos puntos de salida. Ambos ejecutan los mismos predicados y código de dominio: no hay una segunda implementación de las reglas ni un modo de prueba en producción.

Las fixtures usan los writers reales para establecer ochenta ofertas iniciales en cuatro tiendas y treinta y seis días de observaciones, y amplían a 320 ofertas preservando fingerprints. Se añade deliberadamente un cambio de título sin renormalización y un grupo con confianza insuficiente para comprobar los rechazos. Hay precios positivos, beneficios CMR, disponibilidad verdadera/falsa/desconocida, cantidades desconocidas y cotizaciones KG/UN.

Las cinco pruebas comprueban:

- Igualdad completa de respuestas de búsqueda para los tres órdenes, páginas 1/2/10, categoría vacía/con texto, familia, consulta selectiva/sin resultados, tienda/unidad y ambos modos de precio. Incluye conteos, unidades, descubrimiento, IDs para refresco y comparaciones canónicas cuando se solicitan.
- Igualdad de las filas SQL al retirar exclusivamente los cinco auxiliares de la referencia; preservación del orden y reducción efectiva de los bytes serializados.
- Igualdad de asignaciones, precios, alternativas, planes de tiendas e historia de canastas, exceptuando únicamente sus mediciones de tiempo. Las necesidades con identidad inválida siguen sin autorizar compra ni sustitución.
- Igualdad del snapshot crudo de canasta, incluidos conteo global, productos e historia, después de retirar los auxiliares de sus ofertas.

## Comparación de rendimiento

La matriz se ejecuta con `pnpm benchmark:catalog:local`, a 2.000, 10.000 y 50.000 listings, con veinte muestras por combinación y calentamientos excluidos. Incluye doce búsquedas, ocho canastas y dos cargas con concurrencia cuatro por tamaño. La metodología y las limitaciones de las fixtures son las del [informe base](catalog-performance-2026-10-15.md#alcance-y-método).

La referencia reúne la corrida original y su continuación documentada. La nueva corrida conserva el harness, fixtures y configuración local. El manifiesto verifica que las únicas fuentes productivas distintas son los dos lectores de ofertas; también registra el nuevo test. Se conserva Docker con 64 MiB de memoria compartida, `work_mem=4MB` y JIT activado. No se ejecutan builds ni suites intensivas mientras se miden las consultas.

Se usaron Node 24.3.0 y PostgreSQL 17.11 en el mismo host Linux x64 con Ryzen 5 7600 de la referencia. La configuración completa está registrada en `results.json`.

Los tiempos se comparan entre corridas sucesivas en un equipo compartido, no mediante un experimento aleatorizado A/B. Los UUID, las estadísticas de PostgreSQL, el mantenimiento automático y el estado del host pueden variar. La regresión con ambos clientes acredita equivalencia funcional; los bytes muestran la reducción de payload de esta fixture. La variación de latencia o memoria no constituye por sí sola una garantía para producción.

Se completaron **66 combinaciones y 1.320 solicitudes medidas**: 1.304 exitosas y 16 fallidas. Los fallos están concentrados en la canasta concurrente de 50.000 listings y se describen abajo. Los conteos de filas, candidatos, historia y consultas coinciden con la referencia en las 66 combinaciones. Los 27 SQL parametrizados capturados difieren únicamente en la proyección de salida; los valores de fecha y UUID pertenecen a cada fixture.

A 50.000 listings se conservan los 49.375 candidatos de la búsqueda amplia y los 64.375 de categoría/texto, incluidos sus duplicados entre consultas. La canasta mixta de 50 mantiene 27.577 candidatos y 4.956 filas históricas; la estricta, 197 candidatos y 5.516 filas históricas.

Los MB estiman JSON UTF-8 de filas SQL decodificadas; no son tráfico de red medido ni el tamaño de la página del navegador. MiB corresponden a 1.048.576 bytes. La memoria es del proceso Node y se muestrea cada 10 ms, incluidos calentamientos: puede omitir picos síncronos y no incluye PostgreSQL. El heap no baja uniformemente, especialmente en los casos pequeños. Los percentiles son de solicitudes exitosas, por rango más próximo; el p95 requiere veinte éxitos. La espera DB suma consultas que pueden solaparse, por lo que no se resta del total como una fase secuencial.

### Datos transferidos y memoria

| Listings | Caso              | MB antes → después | Reducción | Heap MiB antes → después | RSS MiB antes → después |
| -------- | ----------------- | ------------------ | --------- | ------------------------ | ----------------------- |
| 2.000    | Búsqueda amplia   | 1,97 → 1,31        | 33,5 %    | 87 → 96                  | 306 → 303               |
| 2.000    | Categoría y texto | 2,57 → 1,71        | 33,4 %    | 111 → 125                | 329 → 329               |
| 2.000    | Mixta 50          | 1,63 → 1,24        | 24,2 %    | 83 → 88                  | 341 → 347               |
| 2.000    | Estricta 50       | 0,70 → 0,64        | 9,5 %     | 100 → 99                 | 343 → 349               |
| 10.000   | Búsqueda amplia   | 9,83 → 6,54        | 33,5 %    | 194 → 184                | 444 → 419               |
| 10.000   | Categoría y texto | 12,85 → 8,55       | 33,4 %    | 126 → 172                | 485 → 429               |
| 10.000   | Mixta 50          | 6,04 → 4,17        | 31,0 %    | 103 → 87                 | 496 → 429               |
| 10.000   | Estricta 50       | 0,70 → 0,64        | 9,5 %     | 103 → 101                | 486 → 429               |
| 50.000   | Búsqueda amplia   | 49,15 → 32,71      | 33,5 %    | 266 → 167                | 711 → 606               |
| 50.000   | Categoría y texto | 64,26 → 42,77      | 33,4 %    | 551 → 510                | 813 → 754               |
| 50.000   | Mixta 50          | 28,08 → 18,83      | 32,9 %    | 183 → 118                | 851 → 790               |
| 50.000   | Estricta 50       | 0,70 → 0,64        | 9,5 %     | 90 → 88                  | 767 → 756               |

### Latencia local: p50 / p95 en segundos

| Listings | Caso              | Antes         | Después       |
| -------- | ----------------- | ------------- | ------------- |
| 2.000    | Búsqueda amplia   | 0,31 / 0,36   | 0,20 / 0,20   |
| 2.000    | Categoría y texto | 0,34 / 0,35   | 0,26 / 0,29   |
| 2.000    | Mixta 50          | 0,46 / 0,49   | 0,42 / 0,44   |
| 2.000    | Estricta 50       | 1,37 / 1,43   | 1,30 / 1,39   |
| 10.000   | Búsqueda amplia   | 1,19 / 1,21   | 0,78 / 0,98   |
| 10.000   | Categoría y texto | 1,10 / 1,12   | 0,83 / 0,99   |
| 10.000   | Mixta 50          | 2,39 / 2,46   | 2,26 / 2,36   |
| 10.000   | Estricta 50       | 1,46 / 1,48   | 1,44 / 1,49   |
| 50.000   | Búsqueda amplia   | 4,92 / 6,45   | 4,20 / 5,30   |
| 50.000   | Categoría y texto | 21,01 / 21,73 | 22,04 / 23,12 |
| 50.000   | Mixta 50          | 6,50 / 6,63   | 6,94 / 7,53   |
| 50.000   | Estricta 50       | 2,48 / 2,64   | 2,78 / 3,11   |

### Matriz secuencial completa a 50.000

| Caso                  | Antes p50 / p95 s | Después p50 / p95 s |
| --------------------- | ----------------- | ------------------- |
| Búsqueda amplia       | 4,92 / 6,45       | 4,20 / 5,30         |
| Amplia por unitario   | 6,43 / 6,54       | 4,19 / 5,27         |
| Amplia por total      | 6,38 / 6,47       | 4,16 / 5,26         |
| Selectiva             | 1,23 / 1,26       | 1,04 / 1,09         |
| Sin coincidencias     | 0,38 / 0,67       | 0,36 / 0,65         |
| Arroz                 | 11,75 / 12,25     | 12,45 / 12,73       |
| Categoría sin texto   | 1,82 / 1,84       | 1,54 / 1,59         |
| Categoría y texto     | 21,01 / 21,73     | 22,04 / 23,12       |
| Metro/litros          | 6,32 / 6,46       | 4,37 / 5,68         |
| Página 2              | 4,93 / 6,48       | 4,29 / 5,45         |
| Página 10             | 4,90 / 6,47       | 4,29 / 5,42         |
| Amplia con beneficios | 4,92 / 6,50       | 4,25 / 5,35         |
| Mixta 5               | 5,81 / 5,98       | 5,19 / 5,34         |
| Mixta 5 beneficios    | 5,67 / 5,78       | 5,06 / 5,31         |
| Mixta 20              | 6,45 / 6,71       | 5,97 / 6,67         |
| Mixta 20 beneficios   | 6,47 / 6,69       | 6,96 / 7,21         |
| Mixta 50              | 6,50 / 6,63       | 6,94 / 7,53         |
| Mixta 50 beneficios   | 6,69 / 6,81       | 6,42 / 6,84         |
| Estricta 50           | 2,48 / 2,64       | 2,78 / 3,11         |
| Genérica 5            | 3,91 / 3,94       | 4,17 / 4,24         |

### Cuatro solicitudes concurrentes

| Listings | Caso                | Antes p50 / p95 s | Después p50 / p95 s | Éxitos antes → después |
| -------- | ------------------- | ----------------- | ------------------- | ---------------------- |
| 2.000    | Amplia por unitario | 0,36 / 0,43       | 0,28 / 0,39         | 20/20 → 20/20          |
| 2.000    | Mixta 20            | 0,49 / 0,60       | 0,43 / 0,55         | 20/20 → 20/20          |
| 10.000   | Amplia por unitario | 1,27 / 1,80       | 1,22 / 1,78         | 20/20 → 20/20          |
| 10.000   | Mixta 20            | 1,45 / 2,00       | 1,43 / 2,01         | 20/20 → 20/20          |
| 50.000   | Amplia por unitario | 6,81 / 9,51       | 6,16 / 8,94         | 20/20 → 20/20          |
| 50.000   | Mixta 20            | 7,56 / —          | 6,86 / —            | 2/20 → 4/20            |

La canasta concurrente de 50.000 vuelve a registrar **SQLSTATE 53100**, con el mensaje de memoria compartida agotada. Fallan 16 de 20 solicitudes medidas y tres del calentamiento. Los cuatro éxitos no alcanzan para informar p95; pasar de dos a cuatro éxitos no demuestra una capacidad concurrente aceptable. El límite del contenedor sigue en 64 MiB y no se modificó para esta tarea.

| Listings | Caso             | Éxitos/s antes → después | Heap MiB antes → después | RSS MiB antes → después |
| -------- | ---------------- | ------------------------ | ------------------------ | ----------------------- |
| 2.000    | Búsqueda amplia  | 9,14 → 10,46             | 136 → 124                | 349 → 347               |
| 2.000    | Canasta mixta 20 | 6,70 → 7,35              | 88 → 81                  | 353 → 348               |
| 10.000   | Búsqueda amplia  | 2,23 → 2,28              | 181 → 166                | 483 → 425               |
| 10.000   | Canasta mixta 20 | 2,01 → 2,02              | 133 → 105                | 517 → 442               |
| 50.000   | Búsqueda amplia  | 0,42 → 0,45              | 634 → 681                | 932 → 937               |
| 50.000   | Canasta mixta 20 | 0,08 → 0,13              | 156 → 137                | 407 → 971               |

La búsqueda concurrente grande aumenta su pico de heap muestreado de 634 a 681 MiB, pese a reducir bytes y mejorar latencia. No hay evidencia de una reducción uniforme de memoria bajo concurrencia. En la última fila, la referencia de canasta viene de una continuación en un proceso nuevo, mientras que la medición actual sigue al resto de la matriz en el mismo proceso; su RSS no es una comparación directa de memoria por solicitud. El throughput cuenta solo éxitos y no permite interpretar fallos rápidos como mejoras.

### Espera DB y planes representativos

| Listings | Caso              | Espera DB p50 ms antes → después | CPU Node media ms antes → después |
| -------- | ----------------- | -------------------------------- | --------------------------------- |
| 2.000    | Búsqueda amplia   | 240 → 139                        | 80 → 75                           |
| 2.000    | Categoría y texto | 362 → 272                        | 100 → 100                         |
| 2.000    | Mixta 50          | 377 → 333                        | 116 → 115                         |
| 2.000    | Estricta 50       | 1343 → 1269                      | 49 → 49                           |
| 10.000   | Búsqueda amplia   | 912 → 499                        | 354 → 347                         |
| 10.000   | Categoría y texto | 1169 → 987                       | 460 → 463                         |
| 10.000   | Mixta 50          | 2080 → 1947                      | 385 → 374                         |
| 10.000   | Estricta 50       | 1434 → 1416                      | 46 → 49                           |
| 50.000   | Búsqueda amplia   | 3546 → 2819                      | 1712 → 1654                       |
| 50.000   | Categoría y texto | 24053 → 25620                    | 2397 → 2475                       |
| 50.000   | Mixta 50          | 4980 → 5264                      | 1734 → 1914                       |
| 50.000   | Estricta 50       | 2455 → 2755                      | 54 → 59                           |

Los siguientes tiempos provienen de ejecuciones separadas de `EXPLAIN ANALYZE`, una por consulta, y no son percentiles. JIT forma parte del tiempo de ejecución; no se suma nuevamente. Los veintisiete planes completos se conservan en los artefactos.

| Listings | SQL                      | Ejecución ms antes → después | JIT ms antes → después | Bloques temporales escritos antes → después |
| -------- | ------------------------ | ---------------------------- | ---------------------- | ------------------------------------------- |
| 2.000    | Mixta 50                 | 323 → 283                    | 91 → 88                | 0 → 0                                       |
| 2.000    | Estricta 50              | 1.288 → 1.284                | 1.152 → 1.154          | 0 → 0                                       |
| 2.000    | Categoría/texto global   | 179 → 242                    | 0 → 0                  | 0 → 0                                       |
| 2.000    | Categoría/texto filtrada | 75 → 66                      | 0 → 0                  | 0 → 0                                       |
| 2.000    | Amplia                   | 300 → 199                    | 0 → 0                  | 0 → 0                                       |
| 10.000   | Mixta 50                 | 2.040 → 1.864                | 1.359 → 1.269          | 919 → 468                                   |
| 10.000   | Estricta 50              | 1.431 → 1.436                | 1.129 → 1.122          | 468 → 468                                   |
| 10.000   | Categoría/texto global   | 650 → 642                    | 0 → 0                  | 853 → 634                                   |
| 10.000   | Categoría/texto filtrada | 454 → 388                    | 0 → 0                  | 0 → 0                                       |
| 10.000   | Amplia                   | 849 → 669                    | 0 → 0                  | 853 → 634                                   |
| 50.000   | Mixta 50                 | 5.413 → 4.871                | 2.170 → 2.298          | 18.599 → 17.768                             |
| 50.000   | Estricta 50              | 2.438 → 2.482                | 1.728 → 1.773          | 3.146 → 3.145                               |
| 50.000   | Categoría/texto global   | 3.376 → 3.904                | 67 → 66                | 8.069 → 5.834                               |
| 50.000   | Categoría/texto filtrada | 24.279 → 24.934              | 69 → 71                | 3.001 → 2.663                               |
| 50.000   | Amplia                   | 3.224 → 2.723                | 71 → 70                | 8.069 → 5.834                               |

## Interpretación y siguiente trabajo

La reducción de payload está verificada: la búsqueda amplia ahorra **33,5 %** a las tres escalas; la canasta mixta de 50 ahorra **24,2 %, 31,0 % y 32,9 %**, respectivamente. En la estricta, donde pesa más la historia, el ahorro es **9,5 %**. Estos porcentajes pertenecen a la distribución sintética medida y no establecen el ahorro de cualquier catálogo real.

La búsqueda amplia grande mejora de 4,92 a 4,20 s de mediana, y su pico de heap muestreado de 266 a 167 MiB. En su plan, el sort externo pasa de 34.048 a 25.256 kB y los bloques temporales escritos de 8.069 a 5.834. Eso aporta evidencia de menor trabajo de ordenación/transferencia para ese recorrido.

**La latencia no mejora en todos los escenarios.** Arroz pasa de 11,75 a 12,45 s; categoría con texto, de 21,01 a 22,04 s; la canasta mixta de 50 en modo ordinario, de 6,50 a 6,94 s. También empeoran algunos controles de canasta. Estas variaciones deben conservarse en la comparación, sin atribuirlas automáticamente al cambio de columnas en un experimento entre corridas distintas.

La consulta filtrada de categoría todavía descarta **81.762.276 combinaciones** y registra **14.732.710 bloques temporales leídos**; el cambio de proyección no resuelve ese join. En la canasta mixta de 50, una ejecución SQL baja de 5.413 a 4.871 ms, pero JIT sigue consumiendo unos 2.298 ms y los percentiles del handler no mejoran. Las mediciones SQL individuales y los percentiles del handler son observaciones distintas, no cifras intercambiables.

El siguiente trabajo prioritario sigue siendo el **03C**, para aligerar la elegibilidad canónica preservando sus reglas. El **03B** debe eliminar la doble lectura de categoría/texto y el **03D** estudiar el coste de historia y JIT. El límite de concurrencia requiere el experimento de recursos explícitos del **03F**. Los prompts completos permanecen en el [informe base](catalog-performance-2026-10-15.md#prompts-para-las-siguientes-tareas). Este paso no acredita objetivos HTTP de Next ni capacidad de despliegue.

## Reproducción y evidencia

```sh
pnpm test:db:up
pnpm benchmark:catalog:local
```

La ejecución de este informe usa `.artifacts/catalog-projection-2026-10-15/results.json`. Ese destino ya contiene evidencia y debe conservarse; el comando sin `--output` crea un directorio nuevo. El directorio guarda muestras, conteos, planes SQL, manifiesto de fuentes y el diff concreto de la proyección. `comparison.json` conserva los pares antes/después de las 66 combinaciones y los 27 planes; `compare.py` contiene el cálculo y rechaza sobrescribir sus salidas. La comparación parte de `.artifacts/catalog-performance-2026-10-15/results-combined.json`; ese archivo conserva la procedencia de las dos ejecuciones anteriores.

Todo se ejecuta con `TEST_DATABASE_URL` explícito y un esquema propio en `comprafino_test`. No se utilizan credenciales de la aplicación ni peticiones a tiendas. Los artefactos están ignorados por Git: para compartir evidencia completa se deben copiar también los directorios indicados.

## Verificación final

Se ejecutaron después de finalizar el benchmark:

- Formato Oxfmt, referencias de documentación, Oxlint, TypeScript y `git diff --check`: correctos.
- `pnpm exec turbo run test --force`: **894 pruebas aprobadas**, 835 de Vitest y 59 de límites/streaming web.
- `pnpm test:integration:local`: **135 pruebas aprobadas**, 123 de PostgreSQL y 12 de handlers web. Incluye las cinco nuevas regresiones de proyección.
- `pnpm exec turbo run build --force`: build de producción correcto.
- `pnpm test:e2e:fixtures:local`, después del build: **87 pruebas Chromium aprobadas y 8 opcionales omitidas** por la configuración controlada.
- Los hashes de fuentes no cambiaron durante las mediciones. Se verificó que el esquema del benchmark fue eliminado; el contenedor de pruebas preexistente permanece disponible.

Los logs y el resumen de validación se conservan junto a las mediciones. Las pruebas de corrección pasan; la prueba de disponibilidad concurrente mantiene el fallo documentado de memoria compartida. Este trabajo no incluye despliegue ni cambios en la base de aplicación.
