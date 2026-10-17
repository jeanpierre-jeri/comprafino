# Comparaciones habituales con Makro — prompt 08A

Fecha: **16 de octubre de 2026, America/Lima**. Base local `87c1540` más el borrador de 08A conservado sin commit. Evaluación offline con PostgreSQL de pruebas, sin consultas remotas, ingestas, matching persistido ni cambios de producción. **04A sigue aplazado.**

## Resultado y decisión

La muestra contiene **34 ofertas de cuatro tiendas y 26 pares**: 15 equivalencias inferidas, ocho negativos confirmados por diferencias explícitas de presentación/variante y tres casos ambiguos sin etiqueta de verdad. El matcher acepta las 15 equivalencias inferidas; ninguno de los ocho negativos se une automáticamente. Cuatro negativos quedan en `review` y cuatro son `incompatible`. Hay, por tanto, **cuatro discrepancias con la etiqueta de rechazo**, aunque no hay falsos enlaces automáticos entre los negativos revisados.

El caso de avena forma un grupo de cuatro tiendas con sus seis relaciones compatibles. El de arroz forma el grupo esperado de tres. Quitar una relación de avena impide formar el grupo de cuatro: se conserva complete-link, no basta una cadena transitiva. No se modificó el corpus histórico, sus etiquetas ni las reglas del dominio.

**No hay un error de comparación demostrado que justifique cambiar reglas en esta entrega.** La incertidumbre más relevante es Yopi/Laive: la entrada reconstruida con marca Laive une ambas ofertas, pero retirar únicamente la marca supuesta de Makro cambia el resultado a revisión. La corrección siguiente propuesta para esa evidencia, antes de cualquier cambio de matching, es obtener la marca original y la identidad del fabricante de ambos SKU mediante una captura acotada. No se ejecuta esa consulta ni se propone borrar marcas válidas de producción.

## Procedencia y calidad de las etiquetas

La [fixture fechada](../../packages/db/src/testing/matching/fixtures/retailer-sample-2026-10-16.json) contiene las entradas normalizables, IDs de origen, referencias a las filas originales, SHA-256 de fuentes, supuestos y justificación de cada etiqueta. El [evaluador](../../packages/db/src/testing/matching/retailer-sample.ts) está junto a sus pruebas en `packages/db/src/testing/matching/`, separado de los lectores/escritores de aplicación.

| Fuente reutilizada                                                    | Fecha de evidencia              | Qué aporta y qué falta                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot local de 10A, `listing-snapshot.json`                        | 16/10, 18:53:52 Lima            | Tienda, ID y título. No captura `sourceBrand`, `priceUnit` ni `packageText` originales. Marca transcrita y UN/KG inferidos se declaran como supuestos.                              |
| Búsquedas guardadas de 10A, `searches.json`                           | 16/10, 18:53:16 Lima            | Orienta la selección de arroz, aceite, harina y avena. Usar grupos canónicos existentes introduce sesgo; no sirve para confirmar por sí mismo su exactitud.                         |
| Fixture saneada de Makro, `packages/scrapers/src/fixtures/makro.json` | Evidencia documentada del 08/10 | Tres SKU de leche/pollo con marca, unidad, multiplicador y texto de paquete capturados. La fecha procede del trabajo previo y sus tests; no hay una observación nueva del retailer. |

Se verificaron **los tres hashes y los 34 punteros** contra los archivos guardados antes de evaluar. El hash de la muestra se conserva en el manifiesto previo y en el resultado; las etiquetas y entradas no se cambiaron después de ver las decisiones. El extracto incorporado permite ejecutar los tests sin disponer de todo el snapshot ignorado por Git. Los archivos originales no se modifican. Ninguno de los 26 pares coincide por tienda y título con un par del corpus histórico o de calibración; también se verifica en la prueba de frontera. Esto evita reutilizar esos pares, pero no elimina el sesgo de selección desde grupos ya existentes.

- **Confirmado** significa que el texto fechado demuestra una diferencia concreta, como 5 kg frente a 1 kg o seis latas frente a una. No significa auditoría física ni confirmación humana independiente.
- **Inferido** significa que marca, contenido y variante explícitos concuerdan, sin códigos de barras o confirmación del fabricante. Todos los positivos pertenecen a esta categoría.
- **Ambiguo** significa que no existe etiqueta de verdad. Se mantiene `expected: null`, se muestran sus decisiones y se excluye de las métricas de acierto/error.

La revisión la realiza el agente de desarrollo. No es una prueba ciega ni una muestra aleatoria. Los pares dentro de un grupo están correlacionados; seis pares de avena no son seis productos independientes. La selección contiene positivos ya favorecidos por agrupaciones existentes y negativos elegidos para investigar conflictos. No se estima precisión global ni se afirma «100 % de exactitud» del catálogo.

## Resultados de la muestra

| Categoría               | Pares | `auto_match` | `review` | `incompatible` | `no_match` | Discrepancias de decisión |
| ----------------------- | ----: | -----------: | -------: | -------------: | ---------: | ------------------------: |
| Equivalencias inferidas |    15 |           15 |        0 |              0 |          0 |                         0 |
| Negativos confirmados   |     8 |            0 |        4 |              4 |          0 |                         4 |
| Ambiguos, excluidos     |     3 |            1 |        1 |              0 |          1 |            No se calculan |

La evaluación genera **45 candidatos** sobre las 34 ofertas, incluyendo relaciones no etiquetadas. Los 23 pares etiquetados generan candidato; también lo hacen los ambiguos de leche y yogurt. El pollo no lo genera. Evaluar directamente un par y encontrarlo en el generador son comprobaciones distintas. Las métricas del fichero separan esas etapas y no mezclan los tres ambiguos con los otros 23.

El agrupador en memoria devuelve seis grupos: harina, leche Light, avena, aceite y arroz son plausibles bajo los supuestos de entrada; el sexto es Yopi y conserva su clasificación ambigua. **Seis grupos generados no equivalen a seis grupos confirmados**, y no se persiste ninguno.

### Equivalencias inferidas: 15 pares aceptados

| Producto                                | Tiendas y pares revisados                    | Resultado                                                    |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Avena Quaker con quinua, bolsa 850 g    | Makro, Metro, Plaza Vea y Tottus; seis pares | Grupo de cuatro; todos con score 1.                          |
| Arroz extra Costeño, 5 kg               | Makro, Metro y Plaza Vea; tres pares         | Grupo de tres; score 1.                                      |
| Aceite vegetal Cocinero, 900 ml         | Makro frente a Plaza Vea y Metro; dos pares  | Ambos aceptados; score 1.                                    |
| Harina sin preparar Favorita, 1 kg      | Makro frente a Metro y Plaza Vea; dos pares  | Ambos aceptados; score 1.                                    |
| Leche Light Gloria, seis latas de 390 g | Makro frente a Plaza Vea y Tottus; dos pares | Ambos aceptados; score 1; el título de Tottus usa «Sixpack». |

Las dos relaciones no etiquetadas que completan los grupos de aceite y harina, y la de leche entre Plaza Vea/Tottus, también son evaluadas por el agrupador; no se suman a los 15 pares etiquetados.

### Negativos y discrepancias

| Comparación                                                                     | Decisión y score  | Interpretación                                                          |
| ------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Azúcar rubia Cartavio, Makro 5 kg / Plaza Vea 1 kg                              | `incompatible`, 0 | Diferencia de cantidad y total.                                         |
| Azúcar Dulfina 1 kg, Makro blanca / Plaza Vea rubia                             | `review`, 0,7400  | Discrepancia con rechazo esperado. Tokens distintos impiden auto-match. |
| Fideos Nicolini 250 g, Makro arito / Plaza Vea tornillo                         | `review`, 0,7273  | Forma diferente; queda sin asociación automática.                       |
| Harina Nicolini 1 kg, Makro preparada / Plaza Vea sin preparar                  | `review`, 0,8875  | La negación conserva tokens diferentes; no se une.                      |
| Avena Quaker 330 g, Makro maca / Plaza Vea quinua                               | `review`, 0,7818  | Variante distinta; no se une.                                           |
| Leche Light Gloria 390 g, Makro sixpack / Plaza Vea una lata                    | `incompatible`, 0 | Diferencia de count y total, pese a igual contenido por lata.           |
| Leche Gloria, Makro entera reconstituida / Plaza Vea Light, seis latas de 390 g | `incompatible`, 0 | Formulaciones explícitamente distintas.                                 |
| Avena Quaker con quinua, Makro 850 g / Plaza Vea 330 g                          | `incompatible`, 0 | Tamaño distinto.                                                        |

La política actual no enumera toda variante posible como conflicto duro. Por eso cuatro negativos pueden superar el umbral de revisión y seguir siendo seguros para asociación automática gracias a sus tokens distintos. `review` no se persiste como enlace canónico. Estas discrepancias no justifican convertir todos los términos en conflictos duros ni rebajar umbrales para elevar recall.

### Tres ambiguos y una comprobación de sensibilidad

| Caso                                                                                           | Resultado                         | Lo que impide concluir                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Makro «Leche Ligh UHT GLORIA UHT Caja 946ml» / Tottus «Leche Light UHT Gloria Caja 946 mL»     | `review`, 0,9467                  | Podría ser un error tipográfico, pero no se confirmó la formulación. Score alto no elimina la guarda de tokens distintos.                  |
| Makro «Yogurt YOPI Fresa Vaso 80g» / Metro «Yogurt Yopi Laive Fresa Vaso 80 g»                 | `auto_match`, 1                   | La marca Laive de Makro se tomó del grupo de búsqueda, no de un campo fuente capturado. No demuestra un acierto ni un falso positivo real. |
| Makro pollo San Fernando sin menudencia por kg / Plaza Vea pollo trozado en ocho piezas por kg | `no_match`, 0,0837; sin candidato | Preparaciones distintas, marca de Plaza Vea ausente y peso variable. No se puede deducir identidad exacta ni importe de un pollo completo. |

**Sensibilidad Yopi:** al omitir solamente la marca reconstruida de Makro, dejando títulos y unidades iguales, la misma función PostgreSQL obtiene similitud 1, score **0,8000** y `review` por `missing_brand`. La recomendación es confirmar la entrada original; no tratar un dato reconstruido como prueba de un defecto de producción.

## Corpus histórico y reglas conservadas

La evaluación histórica se ejecuta aparte con los mismos **105 pares y 28 grupos** de tres tiendas. Reproduce 34 verdaderos positivos, cero falsos positivos, 52 verdaderos negativos y 19 falsos negativos según sus etiquetas originales; ocho pares no generan candidato. Su precisión automática histórica es 1 y su recall de decisión es 34/53 ≈ 64,15 %. Son métricas de ese corpus, no de esta muestra ni del catálogo actual.

Los archivos `matching-independent.json` y `matching.json`, `packages/core/src/matching.ts`, el normalizador y `packages/db/src/matching.ts` conservan sus hashes previos. Versión 1, umbrales **0,90 / 0,65**, conflictos, precios, stock, vigencia y persistencia no cambian. El único ajuste fuera de herramientas de testing es que el **validador de auditoría** admite cuatro miembros y expone su validación de referencias para reutilizarla. Se prueba aceptación de cuatro tiendas y rechazo de cinco, duplicados, referencias ausentes y pares de una misma tienda.

El test usa `ownedTestDatabase` con `TEST_DATABASE_URL` local explícito: aplica las migraciones solo dentro de un esquema aleatorio propio y usa `public.similarity()` ya disponible. Antes y después hay **cero listings, cero productos canónicos y cero asociaciones** en ese esquema. Se verifica su eliminación con `to_regnamespace` y se cierran las conexiones. Ningún evaluador nuevo puede crear un cliente de aplicación por defecto; requiere el cliente inyectado.

## Verificación y reproducción

Comando de evaluación aislada, sin `.env` ni `DATABASE_URL` de aplicación:

```sh
TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm --filter @comprafino/db exec vitest run src/testing/matching/retailer-sample.integration.test.ts
```

El test emite `08A_EVALUATION` y `08A_CLEANUP` con decisiones completas, métricas históricas separadas, hash de la muestra, sensibilidad de marca, conteos y limpieza. La evidencia local está en `.artifacts/matching-08a-2026-10-16/`: manifiesto de procedencia previo, logs de evaluación, resultado JSON, limpieza, unitarias, integración y build. No se sobrescriben las fuentes originales.

| Check final                  | Resultado                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Formato, referencias y diff  | `pnpm format:check`, `pnpm docs:check` y `git diff --check` pasan.                                                                        |
| Lint y tipos                 | `pnpm lint` y `pnpm typecheck` pasan.                                                                                                     |
| Unitarias y contratos        | `pnpm test`: 939 pasan (558 core, 106 db, 200 scrapers, 75 contratos web); una de cuatro tareas reutiliza caché.                          |
| PostgreSQL local             | 32 pruebas pasan en cuatro archivos: nueva muestra, matching, continuidad y Makro. Incluye el corpus histórico y eliminación del esquema. |
| Sin configuración de pruebas | El caso se omite explícitamente; no usa la URL de aplicación. Un placeholder sin conexión permite únicamente recoger la suite omitida.    |
| Build                        | `pnpm build` pasa sin caché del build.                                                                                                    |

No se repite Chromium porque no hay cambios de interfaz ni de rutas web. No hay nuevos benchmarks de carga o hosting. La evaluación no verifica stock, precio pagable, frescura actual, cobertura de las tiendas, asociaciones vigentes de producción ni identidad del fabricante. La muestra tampoco cubre de forma sistemática marcas privadas ARO/M&K, duplicados comerciales dentro de una tienda, todas las variantes ni evolución temporal de grupos. Los rechazos estructurales de duplicados del test no equivalen a una auditoría de esos casos reales. No se introducen dependencias, migraciones ni infraestructura.

## Siguiente tarea recomendada

**Prompt 07: recuperación de importación pendiente**, con **GPT-6.1 Sol y razonamiento Alto**. Una recuperación que conserve las listas aporta más ahora que ampliar esta muestra o ajustar matching sin un error demostrado. La confirmación acotada de Yopi queda como pendiente de evidencia para una futura intervención de matching, no como corrección de reglas autorizada. 04A continúa aplazado.
