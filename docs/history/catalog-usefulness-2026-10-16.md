# Frescura y cobertura de compras habituales — prompt 10A

Fecha: **16 de octubre de 2026, America/Lima**. Lecturas de catálogo y operaciones entre **18:49 y 18:53**; historial de GitHub capturado a las 18:50. Esta entrega analiza esos archivos locales, sin nuevas consultas remotas. La revisión acotada de 10A queda concluida con las limitaciones descritas abajo. Continúa la [priorización del proyecto](project-review-2026-10-14.md#priorización-actual--16-de-octubre-de-2026).

## Resultado y decisión

**Conviene mejorar primero el mantenimiento de precios de productos habituales ya almacenados.** Hay variedad suficiente para comenzar a usar el comparador, pero una parte importante del catálogo pierde vigencia. De 41.342 registros retenidos, **27.237 tenían ofertas públicas vigentes** y **14.105 superaban las 36 horas de frescura: 34,1 %**. De estos últimos, 7.539 superaban también 72 horas. Las reglas actuales excluyen precios vencidos de la compra vigente; el efecto observado es pérdida de opciones, no una prueba de que la web esté recomendando precios antiguos.

Las 16 búsquedas devolvieron ofertas en las cuatro tiendas. **Eso no equivale a resolver las 16 compras en cada tienda:** «lentejas» mezcla menestras, preparaciones y chocolates; «pan» y «pollo» también tienen coincidencias incidentales. La existencia de un precio por kilo o de un grupo exacto no convierte esos artículos en sustitutos de lo que la persona quería comprar.

Las tres carencias que más pesan en esta etapa son:

1. **Vigencia desigual de los productos conocidos.** Metro y Plaza Vea tienen más del 40 % de registros por encima de 36 horas. Hay arroz, avena, leche y fideos concretos afectados. Un intento exitoso reciente no demuestra que todos los productos de esa tienda se hayan renovado.
2. **Cobertura aparente en búsquedas ambiguas.** Los contadores incluyen coincidencias que no sirven para la intención habitual. «Lentejas» es el caso más claro de la muestra; merece una tarea posterior de relevancia, manteniendo separados búsqueda e identidad.
3. **Avance parcial difícil de interpretar a partir de un workflow verde.** Las ejecuciones terminan correctamente mientras algunas categorías fallan o siguen pendientes y la frecuencia efectiva resulta menor que la configurada. Hay que evaluar resultados por fuente y edad del producto, no usar el éxito del job como garantía de cobertura completa.

Para pocos usuarios, la corrección inicial debe ser pequeña: **diagnosticar y corregir la postergación del refresco de productos habituales vencidos dentro de los presupuestos existentes**. Antes de modificar el selector, comprobar si el problema viene del reparto de candidatos, de errores de las fuentes o de la frecuencia efectiva. La evidencia justifica investigar ese mantenimiento; todavía no demuestra un único defecto del algoritmo de selección. El [prompt 10B propuesto](project-review-prompts-2026-10-14.md#prompt-10b-mejorar-el-refresco-de-productos-habituales-vencidos) acota esa continuación.

## Qué se midió y qué significa cada cifra

La muestra contiene **16 necesidades genéricas habituales**, no 16 SKU exactos elegidos por el usuario: huevos, arroz, aceite, azúcar, fideos, harina, avena, atún, detergente, papel higiénico, leche, yogurt, pollo, pan, café y lentejas. Las búsquedas usaron relevancia, primera página, precios ordinarios y los lectores existentes. No se ejecutó la ruta HTTP que registra demanda ni se consultó directamente a retailers.

- **Resultado de búsqueda:** oferta admitida por los lectores actuales, con precio ordinario positivo, normalización/identidad aplicables, URL válida, observación vigente y disponibilidad distinta de `false`. Puede ser una coincidencia semántica poco útil.
- **Producto útil:** responde a la intención concreta y permite elegir una presentación comprensible. Una revisión de título puede sugerir utilidad, pero no confirma stock, contenido del fabricante ni intercambiabilidad. Los ejemplos se califican con ese alcance.
- **Comparación exacta admitida:** grupo devuelto por el motor bajo las reglas actuales. No es una nueva auditoría independiente de matching. Para evaluar su utilidad hay que comprobar además que el producto del grupo sea el buscado.
- **Precio unitario fuerte:** calidad de la cantidad usada en ese cálculo. No acredita equivalencia entre marcas, variantes o presentaciones ni autoriza sustitución automática.

Los contadores por tienda usan todos los IDs del ámbito de la búsqueda, cotejados con el snapshot de listings; no sólo las treinta ofertas visibles. Los grupos exactos y la calidad de cantidad se cuentan **sólo en la primera página**. Se revisaron sus títulos y ejemplos; no se etiquetó manualmente cada candidato del catálogo. Las primeras páginas contienen 472 entradas, que no se presentan como 472 productos distintos.

## Muestra de 16 búsquedas

Orden de las cuatro cifras de ofertas: **Tottus / Plaza Vea / Metro / Makro**. La edad máxima se calcula a las 18:53:16 del 16 de octubre y se redondea a una décima de hora.

| Necesidad       | Ofertas por tienda    | Grupos exactos en primera página | Precio unitario fuerte en primera página | Mayor edad de las ofertas admitidas, h |
| --------------- | --------------------- | -------------------------------: | ---------------------------------------: | -------------------------------------: |
| Huevos          | 22 / 17 / 26 / 7      |                                6 |                                    28/30 |                                   30,1 |
| Arroz           | 50 / 40 / 54 / 77     |                               20 |                                    30/30 |                                   35,1 |
| Aceite          | 76 / 79 / 125 / 75    |                               20 |                                    30/30 |                                   30,0 |
| Azúcar          | 21 / 13 / 31 / 27     |                                9 |                                    29/30 |                                   35,2 |
| Fideos          | 43 / 132 / 162 / 116  |                               20 |                                    30/30 |                                   35,2 |
| Harina          | 23 / 22 / 26 / 18     |                               16 |                                    28/30 |                                   35,1 |
| Avena           | 30 / 32 / 26 / 30     |                               20 |                                    30/30 |                                   34,9 |
| Atún            | 46 / 41 / 47 / 10     |                               14 |                                     0/30 |                                   35,2 |
| Detergente      | 21 / 45 / 53 / 53     |                               20 |                                    29/30 |                                   34,9 |
| Papel higiénico | 32 / 26 / 31 / 19     |                                7 |                                     0/30 |                                   29,9 |
| Leche           | 168 / 145 / 187 / 107 |                               20 |                                    29/30 |                                   35,1 |
| Yogurt          | 152 / 171 / 95 / 191  |                               20 |                                    30/30 |                                   35,1 |
| Pollo           | 254 / 123 / 179 / 115 |                               20 |                                    14/30 |                                   35,2 |
| Pan             | 227 / 127 / 283 / 167 |                               20 |                                    25/30 |                                   35,2 |
| Café            | 49 / 105 / 122 / 78   |                               20 |                                    29/30 |                                   34,9 |
| Lentejas        | 4 / 5 / 8 / 5         |                                3 |                                    21/22 |                                   35,1 |

Veinte grupos es el límite de página; no es el total de grupos del catálogo. Varias ofertas se acercan al límite de 36 horas: estar vigentes en la captura no garantiza que sigan disponibles para comparar al día siguiente.

### Utilidad y límites de comparación

En huevos, arroz, aceite, azúcar, fideos, harina y avena hay presentaciones claras y grupos exactos aprovechables. Se deben conservar las diferencias de variedad, marca, tamaño y packs. En detergente, masa y volumen siguen siendo dimensiones distintas; en leche y yogurt, un precio por kilo no vuelve equivalentes formulaciones diferentes. Café en grano, molido y soluble tampoco representa una sola compra intercambiable.

El **0/30 de atún** refleja el bloqueo conservador del precio unitario por semántica de peso neto/escurrido en esas ofertas. En papel higiénico, 29/30 tienen precio aproximado por rollo y una oferta no tiene cálculo: longitud, hojas y capas siguen impidiendo una comparación fuerte sólo por rollo. Ambos pueden tener comparaciones exactas por presentación; no conviene alterar las reglas para aumentar estas cifras. La harina de arroz Costeño rotulada «1 g» aparece como dato de origen, con cálculo unitario retenido por cantidad ambigua; no se corrigió inventando otro gramaje.

Para **«lentejas»**, las 22 entradas de la primera página constituyen todo el ámbito devuelto. Una revisión por título distingue cuatro bolsas que sugieren menestra seca: una de Metro, una de Plaza Vea y dos de Makro. Es una clasificación inferida por presentación, no confirmada por fabricante. Además hay ocho preparaciones/hamburguesas, ocho chocolates/grageas, una pasta de lentejas y una presentación Lorenzo 425 g cuyo título por sí solo no permite decidir si es seca o preparada. Las cuatro coincidencias de Tottus son una preparación, dos chocolates y una pasta; no acreditan cobertura vigente de lenteja seca en esa tienda.

Los tres grupos exactos de «lentejas» son dos chocolates y una hamburguesa. Pueden ser identidades correctas para esos productos y aun así no servir para comparar una bolsa de menestra. No se identificó aquí una equivalencia errónea entre chocolate y lenteja seca. En «pan», el ámbito incluye productos Pantene; en «pollo», alimento para mascotas. Los primeros resultados son mayoritariamente pertinentes, pero el total bruto exagera la cobertura de la compra alimentaria esperada.

### Ejemplos de comparaciones útiles admitidas

Precios ordinarios observados, en soles, de la presentación indicada. Los títulos y cantidades de estos ejemplos son coherentes con el grupo devuelto; esta revisión no añade confirmación independiente de fabricante ni garantía de checkout.

| Presentación                       | Ofertas del grupo                                  | Mayor edad de esas observaciones, h |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------: |
| Huevos pardos Artisan, 15 unidades | Plaza Vea S/ 14,20; Tottus S/ 15,80                |                                15,4 |
| Arroz extra Costeño, 5 kg          | Makro S/ 20,90; Metro S/ 20,90; Plaza Vea S/ 21,90 |                                30,0 |
| Aceite vegetal Cocinero, 900 ml    | Plaza Vea S/ 8,10; Makro S/ 8,80; Metro S/ 9,80    |                                 5,0 |
| Azúcar blanca Dulfina, 1 kg        | Makro, Plaza Vea y Tottus S/ 5,30                  |                                 1,8 |
| Harina preparada Molitalia, 1 kg   | Makro S/ 6,00; Plaza Vea S/ 6,90; Metro S/ 7,70    |                                 9,7 |

Estos ejemplos tenían disponibilidad `true` según la evidencia guardada. En el conjunto hay disponibilidad desconocida, especialmente en Tottus: 9.065 de sus 10.129 registros la conservan como `null`, incluyendo registros vencidos. Desconocido no se interpreta como stock confirmado ni como falta de stock. Un ahorro calculado para una presentación exacta no se extiende a otra variedad o a otra cantidad de paquetes.

## Diagnóstico local de relevancia — 17 de octubre

Se contrasta la captura del 16 de octubre con el código local en `94d56fb`. No se repiten consultas remotas, lectores SQL ni pruebas de carga. Los resultados conservan la fecha original; no describen el catálogo de hoy ni acreditan qué commits están publicados.

### Causas y ejemplos

| Consulta   | Evidencia guardada                                                                                                                                                       | Causa comprobable en el código                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pan`      | 804 candidatos; los 30 títulos de la primera página son alimentarios. Hay 241 títulos Pantene entre los candidatos; el primero ocupa la posición 450.                    | La admisión permite prefijos por palabra: `pan` coincide con `pantene`, `panetón` o `panela`. No exige la palabra completa `pan`.                                |
| `pollo`    | 671 candidatos; las primeras 30 ofertas son alimentarias. «Disfraz Lucida Mascota Pollo» ocupa la posición 105 y «Tiritas de Pollo Pet Care Gato 80g», la 177.           | La palabra `pollo` está realmente en esos títulos. Una búsqueda léxica no distingue alimento humano, ingrediente para mascotas o un disfraz.                     |
| `lentejas` | Los 22 resultados caben en la página capturada; ocho son chocolates/grageas, el primero en la posición 11. Los tres grupos exactos son dos chocolates y una hamburguesa. | Las 22 ofertas contienen la palabra completa. El término puede ser producto, ingrediente o nombre comercial; exigir palabra completa no resuelve esa ambigüedad. |

Las posiciones posteriores a 30 proceden del orden de `candidateIds` guardado, unido por ID al snapshot de títulos; no se visitaron esas páginas. Se comprobó que los primeros IDs coinciden con los de las ofertas capturadas. Los ejemplos se clasifican por título, sin confirmación independiente del fabricante ni de stock actual. No se presenta el número de coincidencias como cobertura útil.

**Consulta:** [readGenericProductOffers](../../packages/db/src/generic-offers.ts) normaliza el texto, exige todos los términos y aplica `starts_with(word, token)` a palabras y coincidencia exacta a números. El prefiltro `to_tsquery('simple', …)` también utiliza `:*`; no aporta interpretación de intención. [resolveProductFamilyQuery](../../packages/core/src/product-family.ts) devuelve `null` para estas tres consultas: ninguna pertenece a las diez familias interpretadas actuales. Por ello no se aplica el filtrado adicional por familia. No se ha demostrado un defecto de matching ni una asociación entre lenteja seca y chocolate.

**Relevancia:** el orden genérico prioriza título normalizado igual a la consulta, inicio del título y similitud de trigramas; después desempata por título e ID. La similitud ordena los candidatos admitidos, no los convierte en sustitutos ni excluye por intención. Los grupos de [searchCanonicalProducts](../../packages/db/src/public-products.ts) también admiten prefijos y ordenan por coincidencia de título/marca y similitud. La pertenencia a un grupo exacto describe equivalencia entre sus miembros, no pertinencia para comprar menestras.

**Presentación:** la [página actual de búsqueda](../../apps/web/src/app/search/page.tsx) pide `includeComparisons: false` y muestra ofertas individuales. Por tanto, los tres grupos de lentejas capturados por 10A no prueban que esa página muestre tres comparaciones de menestras. [SearchResultsContent](../../apps/web/src/components/search-results-content.tsx) respeta el orden recibido cuando se elige relevancia; no crea las coincidencias incidentales. La página muestra «productos en esta página» y, cuando hay paginación, «opciones de tienda»: ambos son recuentos de resultados, no productos distintos ni equivalencias válidas. El selector de categoría ya existe, pero sus departamentos son amplios y no incluyen una categoría específica de menestras, panadería o carnes; no se puede asegurar que resuelva estos casos. La pertenencia usa rutas adquiridas, no títulos adivinados.

### Reproducción y límites

Se ejecutaron comprobaciones en memoria con `pnpm exec node --input-type=module`, importando los normalizadores e intérprete reales de core. Se confirmó la interpretación nula de las tres consultas, se cruzaron todos sus IDs con el snapshot y se verificó la correspondencia de la primera página. Cuatro ejemplos comprobaron la diferencia entre prefijo y palabra completa: `pan`/Pantene, `pan`/Pan Integral, `pollo`/alimento para perro y `lentejas`/chocolate. La comprobación de prefijos reproduce la condición sobre palabras en JavaScript; **no ejecuta el lector SQL**. La causa está respaldada además por los predicados del código y por los candidatos observados.

La evidencia derivada, ignorada por Git, está en `packages/db/.artifacts/catalog-usefulness-2026-10-16/search-relevance-analysis-2026-10-17.json`, con hashes SHA-256 de los dos archivos originales. El snapshot no guarda `normalized_title`, marca, `search_identity` ni todas las relaciones de categorías; no permite reproducir íntegramente la admisión y los trigramas SQL, calcular una precisión global o simular fielmente un nuevo orden. Tampoco hay mediciones de clics, interpretación humana ni rendimiento HTTP nuevo. No se atribuye un fallo de primera página de pan/pollo a resultados que solo constan más adelante.

### Una mejora pequeña propuesta, pendiente de implementación

**Priorizar la palabra completa sobre el prefijo en las ofertas de búsqueda pública, solo con orden «relevancia» y una consulta léxica de una palabra sin familia reconocida.** Conservar todos los candidatos y el orden relativo dentro de cada bloque; si no hay palabras completas, mantener el orden actual. Así, para `pan`, una oferta cuyo título contiene la palabra `pan` precedería a coincidencias exclusivamente como `Pantene` o `Panela`, sin perder la búsqueda parcial `pante`.

La propuesta se limita a ordenar las ofertas públicas antes de paginar, con una partición estable en memoria sobre el conjunto ya acotado. No cambiar el predicado compartido con canastas ni los lectores de grupos exactos. Mantener precios, disponibilidad, matching, elegibilidad, presupuestos, IDs admitidos, recuentos y datos de demanda/refresco; los otros órdenes de precio siguen intactos. No añade consultas, dependencias ni infraestructura.

Esta mejora trata la coincidencia por prefijo; no distingue lenteja seca de chocolate ni pollo humano de mascota cuando la palabra es la misma. La captura tampoco demuestra una mejora en los primeros 30 resultados de pan, que ya son alimentarios. Con pocos usuarios, el alcance suficiente es preparar y comprobar este ajuste local; no justifica una ampliación de familias o un despliegue urgente.

Antes de implementarlo, las pruebas propuestas son:

1. Una prueba pura del orden estable: `Pan Integral`, un título con `pan` en posición interior, `Panela` y `Shampoo Pantene`; exigir prioridad de palabra completa y conservación de todos los IDs. Con `pante`, conservar las coincidencias parciales; con consultas de familia, varios términos u orden por precio, mantener el comportamiento previo.
2. Una regresión del lector público en PostgreSQL con `TEST_DATABASE_URL` explícita, escritores reales y esquema aleatorio propio. Verificar orden antes de paginar, ausencia de pérdidas o duplicados entre páginas, recuentos e IDs de demanda/refresco conservados, marcas/variantes requeridas y números exactos. Ninguna escritura de prueba debe usar `DATABASE_URL` de aplicación.
3. Confirmar que los lectores de canastas y comparaciones exactas conservan su orden, resultados y reglas; chocolates de lentejas y productos con pollo siguen admitidos bajo la búsqueda léxica existente. Ejecutar los checks aplicables al cambio futuro; no repetir carga remota.

La entrega inicial de diagnóstico no implementó la propuesta. La continuación autorizada se documenta a continuación. **04A continúa aplazado.**

### Implementación local de prioridad de palabra completa — 17 de octubre

La propuesta está implementada localmente. [prioritizeWholeWordSearchResults](../../packages/core/src/public-products.ts) hace una partición estable de los resultados: primero los títulos con la palabra completa y después el resto, conservando todos los objetos y el orden relativo de cada bloque. Usa el normalizador existente, conserva acentos y omite consultas de varios términos o numéricas. El trabajo es lineal sobre los candidatos ya leídos y acotados.

La función se aplica únicamente a las ofertas de [searchPublicProducts](../../packages/db/src/generic-offers.ts), cuando el orden es relevancia y no hay una familia interpretada, antes de paginar. No cambia SQL, candidatos, precios, disponibilidad, filtros, identidades, lectores compartidos de canasta, comparaciones exactas ni los otros órdenes. Los IDs y el orden para demanda/refresco permanecen iguales. No añade consultas o dependencias.

La regresión PostgreSQL de [public-search.integration.test.ts](../../packages/db/src/public-search.integration.test.ts) utiliza escritores reales y un esquema aleatorio propio: dos ofertas con `pan` como palabra interior quedaban detrás de 34 coincidencias por prefijo y fuera de la primera página. Falló antes del cambio; después, las dos ofertas pasan al inicio y las 34 restantes siguen accesibles entre ambas páginas, sin pérdidas ni duplicados. Comprueba recuentos, paginación, candidatos de refresco, cobertura por tienda, grupos exactos y el lector compartido; también búsqueda parcial `pane`, consultas con varios términos/números, familias y órdenes por precio. Lentejas/chocolates y pollo/mascotas conservan sus coincidencias literales. Las siete pruebas nuevas de core cubren estabilidad, conservación, normalización, límites de consulta y ambigüedad.

La mejora se acredita en esa fixture sintética. No se atribuye a producción ni se convierte en una mejora medida de los primeros 30 resultados históricos de pan. No resuelve intención semántica o toda la ambigüedad de lentejas/pollo. No se hicieron consultas remotas, carga, migraciones de aplicación ni despliegues. 04A continúa aplazado.

Verificación final: formato, referencias, lint, tipos y build pasan; `pnpm test` suma 960 casos (565 core, 106 db, 200 scrapers y 89 web; dos tareas reutilizan caché). `pnpm test:integration:local` pasa 152 casos PostgreSQL y 12 HTTP/auth, con bases de prueba explícitas y esquemas propios. Después del build, el smoke Chromium de búsqueda pasa siete casos con `pnpm test:e2e:fixtures:local --grep 'search comparison scope|search shows one product grid|missing and blank searches'`. La primera ejecución unitaria encontró `spawnSync EPERM` del sandbox en nueve casos de CLI y Turbo interrumpió web; la repetición con permisos de subproceso pasó completa, sin cambiar esas pruebas. No hay comprobaciones fallidas pendientes. Los logs unitarios y Chromium quedan ignorados en `.artifacts/search-relevance-2026-10-17/`; no se ejecuta la suite Chromium completa ni la matriz de carga remota.

## Frescura del catálogo y ejemplos que pierden opciones

El [reporte de salud existente](../catalog-health.md) admite 27.237 ofertas vigentes. El snapshot completo de metadatos permite contar la edad de los restantes registros sin atribuirles elegibilidad de compra.

| Tienda    | Registros retenidos | Ofertas públicas vigentes | Más de 36 h | Proporción >36 h | Más de 72 h |
| --------- | ------------------: | ------------------------: | ----------: | ---------------: | ----------: |
| Tottus    |              10.129 |                     8.124 |       2.005 |           19,8 % |         831 |
| Plaza Vea |              10.275 |                     5.966 |       4.309 |           41,9 % |       2.722 |
| Metro     |              13.835 |                     7.872 |       5.963 |           43,1 % |       3.393 |
| Makro     |               7.103 |                     5.275 |       1.828 |           25,7 % |         593 |
| **Total** |          **41.342** |                **27.237** |  **14.105** |       **34,1 %** |   **7.539** |

Hay 28 registros con disponibilidad explícitamente `false`; todos quedan fuera de las ofertas vigentes observadas. Su ausencia no se atribuye solamente a edad. Los datos vencidos pueden ser útiles como evidencia histórica dentro de las reglas aplicables, pero no como precio actual. Quedan 8.658 posiciones antes del límite de 50.000; no hay evidencia aquí de que aumentar capacidad resuelva la carencia principal. El guard tampoco mide cobertura del catálogo completo de cada tienda.

| Producto almacenado                      | Tienda    | Última observación, hora Lima | Edad a la captura de búsqueda |
| ---------------------------------------- | --------- | ----------------------------- | ----------------------------: |
| Arroz Costeño Extra 3 kg                 | Metro     | 14 oct., 09:40                |                        57,2 h |
| Avena Tradicional Cuisine & Co 1 kg      | Metro     | 14 oct., 09:40                |                        57,2 h |
| Fideos Tottus Cabello de Ángel 250 g     | Tottus    | 14 oct., 14:26                |                        52,4 h |
| Pack Leche Light UHT Gloria, 800 ml × 3  | Plaza Vea | 12 oct., 20:25                |                        94,5 h |
| Harina de Trigo Il Molino Chiavazza 1 kg | Plaza Vea | 10 oct., 17:15                |                       145,6 h |

En los cuatro ejemplos distintos de los fideos la disponibilidad guardada era `true`; en los fideos era desconocida. Son ejemplos de pérdida por vigencia, no prueba de stock actual ni de que una actualización vaya a recuperar necesariamente una oferta. No se muestran sus precios antiguos como oportunidad de compra.

## Fallos parciales, fuentes pendientes y frecuencia efectiva

La lectura de salud fue **`warning`**: Plaza Vea llevaba 52,4 horas desde el inicio de su último intento completamente exitoso, aunque conservaba 5.966 ofertas vigentes. Su último intento falló parcialmente; Makro también tuvo un fallo parcial reciente, con un éxito completo 4,8 horas antes. El indicador por tienda y la edad por producto miden cosas diferentes.

En el intento más reciente, Plaza Vea persistió 1.074 observaciones y Makro 988 aun cuando sus registros terminaron en `failed`. Metro persistió 1.505 y Tottus 1.753 con estado `success`. Los lotes aceptados se conservan; no se trata de rollback global ni de caída total de una tienda. En los 56 intentos guardados de unas 72 horas, hubo fallos en 7/14 de Tottus, 10/14 de Plaza Vea, 1/14 de Metro y 8/14 de Makro. El snapshot no conserva para todos ellos el código de error detallado, de modo que no se clasifican todos como un mismo fallo de origen.

| Tienda    | Fuentes activas | Ciclo nunca completado | Cursor en progreso | Elegibles por fecha | Con error guardado |
| --------- | --------------: | ---------------------: | -----------------: | ------------------: | -----------------: |
| Tottus    |             691 |                    115 |                 27 |                 298 |                117 |
| Plaza Vea |             534 |                    147 |                267 |                 488 |                  7 |
| Metro     |             397 |                     17 |                104 |                 253 |                  0 |
| Makro     |             534 |                      2 |                 47 |                 289 |                  3 |

Son 2.156 fuentes activas. Las columnas se solapan y no representan productos ni páginas restantes. Una fuente nunca completada puede tener páginas y observaciones aceptadas. «Elegible por fecha» sólo comprueba `next_eligible_at`; no acredita que carezca de lease activo. Los ciclos más antiguos completados siguen fechados entre el 10 y el 12 de octubre. La amplitud y paginación del recorrido son factores que investigar antes de ampliar más fuentes.

De los errores guardados de Tottus, 113 son redirecciones a inicio y cuatro pertenecen a la categoría genérica de fallo. Las redirecciones mantienen la pausa de siete días prevista; no se recomienda sortearla. Las categorías con otros errores incluyen detergente líquido, pan árabe/pita y galletas. En Plaza Vea figuran, entre otras, shampoo, tratamientos, quesos, hamburguesas y pop corn; en Makro, cereales en hojuelas, agua y hamburguesas. El snapshot clasifica los errores restantes como `other_failure`, sin detalle suficiente para adjudicarles un status HTTP o una causa técnica concreta.

La consulta independiente de salud tenía `skippedByCapacity: null`, porque no se suministró un log de adquisición. El resumen de fuentes mostró cero fuentes con skips en los contadores de ciclo inspeccionados; eso no convierte el valor no medido de salud en un cero global histórico.

El [workflow de refresh](../../.github/workflows/refresh-catalog.yml) configura dos horas y un presupuesto de cien páginas por tienda. La captura de cien ejecuciones de GitHub cubre de sobra la ventana utilizada, **13 oct., 18:49 a 16 oct., 18:50 Lima**. En ella se observaron:

| Workflow          | Ejecuciones | Resultado externo | Intervalo mediano entre creaciones | Mayor intervalo | Duración mediana del run |
| ----------------- | ----------: | ----------------- | ---------------------------------: | --------------: | -----------------------: |
| Catalog refresh   |          14 | 14 success        |                             5,12 h |          6,83 h |              25 min 45 s |
| Catalog discovery |          14 | 14 success        |                             5,23 h |          6,91 h |                     36 s |
| Catalog health    |          12 | 12 success        |                             4,87 h |          8,26 h |                     34 s |

Los intervalos corresponden a `created_at` y la duración a `updated_at - run_started_at`; no son latencia de cola medida ni duración exclusiva de scraping. Los cambios de versiones y el comportamiento de schedules requieren atención al interpretar la diferencia con la configuración. No se identificó desde esta evidencia qué ejecuciones se retrasaron, descartaron o nunca se generaron, ni se modifica concurrencia para suponer una solución.

El [último refresh inspeccionado](https://github.com/jeanpierre-jeri/comprafino/actions/runs/38973572869) duró 26 min 43 s; su paso de adquisición, 26 min 10 s, y el de salud, 7 s. La [última discovery](https://github.com/jeanpierre-jeri/comprafino/actions/runs/38971281091) duró 34 s, con 5 s de adquisición; ese tiempo no demuestra que hubiera consultas pendientes o descubrimientos nuevos. El [último health](https://github.com/jeanpierre-jeri/comprafino/actions/runs/38978473840) terminó correctamente. El comportamiento actual permite advertencias por progreso parcial útil; un workflow verde no equivale a todos los precios frescos.

## Corrección inicial recomendada y comprobación esperada

**Prompt 10B: mejorar el refresco de productos habituales vencidos.** Reutilizar `previewListingRefresh`, su pool acotado, la política de prioridad y el recorrido de categorías. Revisar cómo los candidatos útiles alcanzan el presupuesto de 500 actualizaciones dirigidas, especialmente con varios miles de asociaciones exactas y ejecuciones menos frecuentes de lo previsto. Investigar también fuentes que fallan repetidamente antes de atribuir todo al selector.

Elegir un solo cambio local sustentado por una regresión reproducible: por ejemplo, corregir una postergación demostrada en el reparto de candidatos. Mantener precios ordinarios positivos, evidencia de identidad y disponibilidad triestado, frescura de 36 horas, cooldowns, límites de solicitudes y parada ante restricciones. Las pruebas deben mostrar progreso entre ejecuciones y aislamiento entre tiendas sin inventar observaciones nuevas. Si el factor determinante resulta ser sólo operativo o falta evidencia para un cambio de código, entregar esa conclusión y un ajuste propuesto para revisión, sin crear infraestructura para compensarlo.

El éxito inicial no exige refrescar 41.342 productos cada dos horas ni ampliar los límites. Exige eliminar el bloqueo reproducido para una muestra de compras habituales, conservar presupuestos y medir después si reduce sus ausencias por edad. Esa medición posterior necesita otra captura autorizada; no se fabrica un antes/después de producción a partir de pruebas sintéticas.

La relevancia de búsquedas ambiguas y la lectura de fallos parciales quedan como tareas posteriores separadas. **04A sigue aplazado**; este resultado no requiere crear un entorno remoto de carga ni aumentar el plan del hosting.

## Evidencia, límites y verificación de esta entrega

Evidencia local: `packages/db/.artifacts/catalog-usefulness-2026-10-16/`. `health.json`, `acquisition.json`, `sources.json`, `ingestion-runs.json`, `searches.json`, `listing-snapshot.json`, `github-runs.json` y `github-jobs.json` conservan las capturas. `analysis.json` añade agregaciones y hashes SHA-256 de los archivos utilizados. Los artefactos están ignorados por Git; las tablas de este reporte conservan los resultados principales para su revisión sin ellos.

Las sondas guardadas de salud, operaciones, búsqueda y cobertura verificaron **`transaction_read_only=on` y `statement_timeout=15s`**. La captura empleó el cliente HTTP existente con un timeout de transporte de 20 s. El HEAD local al completar las lecturas era `2db06b7`; la última ejecución de adquisición inspeccionada usaba `6172047`. El cambio posterior de HEAD afecta a una fixture de continuidad y no se usa como prueba de despliegue del catálogo.

La auditoría completa `auditCatalogCoverage` **no terminó**: agotó el transporte a los 20,6 s. No existe `coverage.json` exitoso. Por ello no se atribuyen a esta entrega sus métricas globales de cantidades, potencial de canasta o calidad por familia. Salud, operaciones y las dieciséis búsquedas sí produjeron resultados utilizables. Los fallos anteriores de límite local de fuentes y serialización se corrigieron en el script de captura; las marcas posteriores `operations-completed.json` y `search-completed.json` acreditan esos recorridos completos, sin convertir el fallo del audit global en éxito.

Las lecturas son sucesivas, no un snapshot transaccional único; las agregaciones se comprobaron consistentes entre sus IDs y contadores. La edad se calcula a la fecha de captura y no se actualiza al redactar. No se verificaron checkout, dirección del comprador, stock físico, fuentes externas actuales, precisión global de matching, compras completas de las dieciséis necesidades, ni experiencia por HTTP/navegador. Las etiquetas manuales por título son inferencias explícitas, sin revisión humana independiente.

Esta continuación modifica documentación y agrega únicamente un análisis local de los archivos guardados. No modifica producción, lectores, adquisición ni reglas de comparación. Se verifican formato, referencias de documentación y limpieza del diff; no se ejecutan nuevas pruebas de carga ni suites de aplicación para un cambio documental.
