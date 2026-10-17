# Evaluación técnica y de producto de CompraFino

Revisión iniciada el 14 de octubre de 2026, America/Lima. Base inspeccionada: commit `6567774`, con el árbol de trabajo limpio al comenzar. Destinatario: responsable del proyecto. Los [prompts de trabajo](project-review-prompts-2026-10-14.md) acompañan este informe.

## Priorización actual — 16 de octubre de 2026

**Con muy pocos usuarios, la prioridad es mantener vigentes los precios de compras habituales y conservar las listas. Se aplaza la verificación remota de 04A.** No hace falta completar todos los prompts para aprender de los primeros usuarios. Tampoco conviene añadir infraestructura o ampliar indiscriminadamente el catálogo antes de identificar una carencia concreta.

La primera priorización contrastó el código local en `6172047`, la documentación y los resultados ya registrados. El [reporte 10A](catalog-usefulness-2026-10-16.md) añade lecturas acotadas de sólo lectura del catálogo y operaciones capturadas el 16 de octubre entre 18:49 y 18:53 Lima, además del historial público de GitHub. Su entrega reutiliza los archivos guardados, con HEAD local `2db06b7`, sin repetir consultas remotas ni ejecutar carga. El bajo uso es información del responsable del proyecto; la captura no acredita el estado futuro ni comportamiento de usuarios. Los resultados históricos conservados más abajo describen la base original, no una lista de fallos que sigan todos abiertos.

**Resultado de 10A:** 41.342 registros retenidos, 27.237 ofertas públicas vigentes y 14.105 registros por encima de 36 horas (34,1 %). Las dieciséis búsquedas tienen resultados en cuatro tiendas, pero la revisión de «lentejas» demuestra que coincidencias y grupos exactos pueden pertenecer a chocolates o preparaciones. Las tres carencias principales son vigencia desigual, cobertura aparente por relevancia ambigua y avance parcial que un workflow verde no explica por sí solo. La corrección inicial recomendada es diagnosticar y resolver la postergación del refresco de productos habituales vencidos dentro de los presupuestos existentes; todavía no se atribuye a un defecto único del selector.

El [mapa del proyecto](../README.md) reúne ubicaciones de código, herramientas y estado del trabajo local. 08A concluyó una evaluación local separada: 34 ofertas, 26 pares, cuatro tiendas; 15 equivalencias inferidas aceptadas, ocho negativos sin asociación automática y tres ambiguos excluidos. Cuatro negativos quedan en revisión y Yopi depende de marca reconstruida. No hay un error confirmado que justifique cambiar matching. [Resultados y límites](matching-retailer-sample-2026-10-16.md).

**Actualización del 17 de octubre:** 07 implementa recuperación local sin reasignar cuentas: respaldo JSON anónimo, retorno a la cuenta original y descarte explícito con guardas de sesión y snapshot. [Pruebas y límites](shopping-import-recovery-2026-10-17.md). No se desplegó; 04A sigue aplazado.

### Trabajo ya realizado y alcance pendiente

| Trabajo                      | Estado a esta actualización                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01: referencias guardadas    | Implementado en `a987129`. El usuario confirmó la aplicación de la migración 0014; no se volvió a consultar producción en esta actualización.                                                                                                                                                                                                                                               |
| 02: metadata y página        | Deduplicación implementada en `038ce0d`. No repetir este trabajo como pendiente.                                                                                                                                                                                                                                                                                                            |
| 03 y 03A–03F: rendimiento    | Medición y optimizaciones realizadas, incluidas las matrices HTTP locales y cuatro solicitudes simultáneas a 50.000. Consultar los [resultados HTTP](catalog-http-performance-2026-10-16.md) y la repetición de [04](public-request-budgets-2026-10-16.md). La estabilidad local no acredita velocidad ni capacidad del hosting; la latencia a 50.000 sigue siendo una limitación conocida. |
| 04: presupuestos públicos    | Límites y recuperación implementados y comprobados localmente; sus declaraciones se observaron en logs del despliegue inspeccionado. Conservarlos.                                                                                                                                                                                                                                          |
| 04A: hosting real            | **Aplazado por decisión del usuario**, con inspección y kit local conservados. Carga, cancelación del servidor y recuperación remotas siguen sin verificar. [Decisión y criterios de reanudación](hosting-request-budgets-2026-10-16.md#decisión-posterior-verificación-remota-aplazada).                                                                                                   |
| 06: precios y plan           | Revalidado en 13A: tres filas de S/ 10 y plan de una tienda de S/ 60 son escenarios distintos. Se explica su diferencia sin sustituir productos. La comprensión con personas sigue pendiente. [Evidencia](mobile-shopping-journey-2026-10-16.md).                                                                                                                                           |
| 10A: frescura y cobertura    | Revisión acotada concluida con dieciséis búsquedas, salud, fuentes e historial de ejecuciones. La auditoría global de cobertura agotó el transporte; no se declaran verificadas sus métricas completas de cantidades o canastas. [Resultados y límites](catalog-usefulness-2026-10-16.md). No se implementó una corrección.                                                                 |
| 10B: selector de refresco    | Corrección local implementada y verificada: rutas incompatibles se excluyen antes del pool de 5.000. Regresión 0/4 → 4/4, sin elevar presupuestos ni desplegar. [Causa y validación](catalog-refresh-selection-2026-10-16.md).                                                                                                                                                              |
| 13A: recorrido móvil         | Revisión local en Chromium a 320/390 px, ambos temas: búsqueda, detalle, guardado, edición, recarga y plan. Corregidos scroll heredado del diálogo y explicación de importes. Conserva SKU, cantidades y reglas. Personas y dispositivos físicos pendientes. [Reporte y guion](mobile-shopping-journey-2026-10-16.md).                                                                      |
| 08A: comparaciones con Makro | Evaluación offline concluida: grupo de cuatro tiendas, 15 positivos inferidos aceptados y cero enlaces automáticos entre ocho negativos; cuatro discrepancias quedan en revisión. Tres ambiguos excluidos, incluyendo Yopi sensible a marca supuesta. Sin cambios de reglas ni asociaciones reales. [Reporte](matching-retailer-sample-2026-10-16.md).                                      |
| 07: importación pendiente    | Implementación local verificada en un commit dedicado: causas diferenciadas, descarga local, retorno a la cuenta original y descarte confirmado. Sin cambios de reglas ni producción. [Reporte](shopping-import-recovery-2026-10-17.md).                                                                                                                                                    |
| 05: documentación            | README, roadmap y referencias reconciliados contra código local `e7aa576`; capacidad, horarios, Makro, advice semanal, auth y recuperación distinguen implementación de evidencia remota. Solo documentación, en un commit local dedicado. [Alcance y límites](../README.md#reconciliación-documental-05).                                                                                  |

### Orden recomendado para esta etapa

| Orden | Trabajo acotado                            | Por qué aporta valor ahora                                                                            | Resultado suficiente para avanzar                                                                                      |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1     | **09: revalidar el aviso de dependencias** | El aviso histórico no demuestra un problema vigente; conviene conocer su alcance antes de actualizar. | Auditoría actual de solo lectura y evaluación de exposición; corregir por separado solo si hay un problema demostrado. |

El paso de personas reales es una actividad del responsable del proyecto; esta recomendación no autoriza enviar invitaciones o mensajes. La muestra de catálogo tampoco acredita toda la cobertura ni requiere un rastreo masivo. Si aparece un precio incorrecto, pérdida de datos o fallo que impida completar una compra, corregirlo antes de seguir el orden sugerido.

### Mantenimiento breve y trabajo condicionado

- **05, documentación:** reconciliada localmente el 17 de octubre. [Alcance, fuentes y límites](../README.md#reconciliación-documental-05). La evidencia histórica conserva sus fechas; esta tarea no verifica despliegues, migraciones remotas ni cobertura real.
- **09, dependencias:** revalidar el aviso moderado histórico antes de decidir una corrección. No se ejecutó un nuevo `pnpm audit` aquí y no se afirma que el estado siga igual. Un aviso relevante para producción cambia la prioridad; no hacer actualizaciones masivas por rutina.
- **11, control de datos de cuenta:** exportación, eliminación y explicación de datos siguen como tarea acotada antes de ampliar la captación de cuentas; atender antes una solicitud real. No requiere un panel general de cuenta. Las pruebas de aislamiento de sesiones existentes se conservan.
- **12, indexación y enlaces:** abordar cuando se elija la captación por buscadores o compartir enlaces como siguiente objetivo. Primero verificar que las búsquedas y comparaciones que llegarán a esas personas sean útiles.
- **13 completo, imágenes y navegadores:** mantener una revisión móvil pequeña ahora. Ampliar motores o cambiar el tratamiento de imágenes cuando se reproduzca un problema o las mediciones lo justifiquen.
- **04A y nuevas optimizaciones de escala:** aplazados. Retomar por lentitud o errores recurrentes, crecimiento relevante del catálogo, previsión de tráfico o cambios del transporte/hosting. No añadir Redis, colas, servicios de búsqueda ni planes de pago sin una necesidad medida.

**10B implementado localmente:** se reprodujo que más de 5.000 identidades sin ruta de actualización compatible podían llenar el pool y dejar fuera cuatro compras habituales. El SQL ahora aplica esa frontera antes del límite, manteniendo presupuestos y reglas. En la regresión, la selección pasa de 0/4 a 4/4 y conserva recuperación tras fallo/cooldown. El [reporte 10B](catalog-refresh-selection-2026-10-16.md) explica los checks y límites; no se cuantificó el efecto real sobre producción ni se desplegó.

**Siguiente tarea recomendada: revalidación acotada de 09**, comprobar primero si el aviso de dependencias sigue vigente y afecta al uso real, sin actualizaciones masivas. 05 queda concluido localmente como corrección documental, con formato y referencias verificados. 07 queda implementado y verificado localmente; no acredita el estado remoto. 08A conserva el corpus histórico y no demuestra un fallo que autorice modificar reglas; confirmar la marca fuente de Yopi antes de una futura intervención de matching. La relevancia ambigua de búsquedas queda como tarea separada. Los [prompts adaptados a pocos usuarios](project-review-prompts-2026-10-14.md#prompts-acotados-para-la-etapa-actual) mantienen el trabajo acotado. Antes de cada nueva tarea indicar modelo y razonamiento. 04A sigue aplazado.

## Evaluación original del 14 de octubre

**CompraFino tiene una buena base técnica y merece evolucionar sobre lo que ya existe.** La separación de responsabilidades, las reglas conservadoras de comparación y la cobertura automatizada son sus puntos más fuertes. La prioridad es consolidar la experiencia de listas recurrentes y demostrar el rendimiento del catálogo ampliado. Una reescritura del stack tendría poco beneficio frente a correcciones concretas.

El hallazgo más importante está reproducido: al incorporar otra tienda a un producto equivalente, cambia su identificador canónico y una lista guardada puede dejar de encontrarlo. También hay oportunidades claras de reducir consultas, explicar mejor los totales y reconciliar documentación que aún describe límites anteriores.

## Evaluación general

| Área                          | Evaluación                                   | Qué significa para el proyecto                                                                              |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Arquitectura                  | Sólida y proporcionada                       | Mantendría el monorepo, Next.js, PostgreSQL y los procesos programados.                                     |
| Precios y comparabilidad      | Especialmente cuidada                        | Separar precio ordinario, beneficios, unidades y disponibilidad evita recomendaciones engañosas.            |
| Persistencia y sincronización | Buena base con un problema de continuidad    | Hay protección contra conflictos y cambios de cuenta; falta resolver la evolución de identidades guardadas. |
| Pruebas y CI                  | Fuerte                                       | Las pruebas reales de PostgreSQL y navegador ya forman parte del flujo requerido.                           |
| Rendimiento                   | Diseño acotado, evidencia todavía incompleta | Admitir 50.000 registros no demuestra una latencia aceptable con tráfico concurrente.                       |
| Scrapers                      | Prudentes y recuperables                     | Usan fuentes públicas, límites y progreso durable; conviene medir cobertura efectiva y retrasos.            |
| Interfaz                      | Coherente y legible                          | La mejora principal es explicar decisiones y estados, manteniendo el diseño existente.                      |
| Documentación                 | Amplia, pero desalineada                     | Hay contradicciones actuales sobre capacidad, horarios y funciones ya implementadas.                        |
| Seguridad                     | Buenas fronteras en el código revisado       | Quedan controles operativos por verificar y un aviso moderado en dependencias.                              |
| Preparación de producto       | Adecuada para una beta controlada            | La expansión de usuarios debe acompañarse de recuperación, medición y continuidad de datos.                 |

Esta evaluación no acredita el estado del despliegue, sus credenciales, las copias de seguridad ni la cobertura real de las tiendas. Esas propiedades requieren evidencia del entorno operativo. No se accedió a la base de aplicación ni se hicieron peticiones a retailers durante esta revisión.

## Arquitectura y decisiones que conservaría

La distribución actual es coherente: `apps/web` presenta la aplicación y sus fronteras HTTP; `packages/core` decide precios, cantidades, identidad y canastas; `packages/db` contiene SQL y persistencia; `packages/scrapers` aísla la adquisición; `packages/ui` comparte componentes. Las dependencias de los manifiestos siguen esa dirección y usan `workspace:*`.

El usuario consulta datos persistidos. La búsqueda no espera a que una tienda responda ni ejecuta matching durante la petición. El registro de demanda se hace después de responder y los procesos programados realizan el trabajo externo. Eso limita la dependencia directa de la experiencia pública respecto a la disponibilidad de los retailers.

Las decisiones más valiosas son:

- **Dinero en céntimos y validación en fronteras.** Las reglas evitan que un precio ordinario cero gane una comparación; los beneficios conservan su condición y no sustituyen silenciosamente el precio para todos.
- **Disponibilidad en tres estados.** Desconocido sigue siendo desconocido. La ausencia de evidencia no se presenta como stock confirmado.
- **Identidad conservadora.** Cantidades, marca, variantes y evidencias actuales limitan la equivalencia. Los writers invalidan asociaciones cuando cambia la identidad y el matching revalida bajo locks y guardas.
- **Historia con huecos reales.** El sistema distingue observaciones de continuidad supuesta. La recomendación semanal exige evidencia completa y puede abstenerse.
- **Sincronización protegida.** Hay revisión optimista, conflictos explícitos, cancelación al cambiar de cuenta y validación de respuestas. Los documentos remotos no se persisten por middleware de Zustand.
- **Pruebas aisladas.** La integración usa configuración explícita y esquemas aleatorios propios, con migraciones del repositorio y limpieza posterior.
- **Adquisición respetuosa.** Peticiones secuenciales, pausas, timeout, límites y parada ante 401/403/429. No necesita automatización de navegador ni mecanismos de evasión.

Evidencia principal: [arquitectura](../architecture.md), [elegibilidad](../eligibility.md), [matching](../catalog-matching.md), [evaluación de listas](../../packages/db/src/shopping-list.ts), [sincronización](../../apps/web/src/lib/shopping-list/sync-client.ts), [aislamiento de pruebas](../../packages/db/src/testing/database.ts) y [adquisición](../../packages/scrapers/src/catalog-acquisition.ts).

## Verificación ejecutada

Se inventariaron 459 archivos versionados, incluidos 296 archivos TypeScript/TSX y 92 archivos con nombres de pruebas. La lectura se concentró en las rutas públicas, identidad, precios, consultas, sincronización, adquisición, configuración y suites relevantes; estos números no significan revisión manual exhaustiva de cada línea.

Entorno local: Node `v24.3.0`, pnpm `12.8.1`, PostgreSQL 17 de pruebas. Las primeras ejecuciones de Turbo reutilizaron resultados; pruebas y build se repitieron con `--force` para obtener evidencia nueva.

| Comprobación                        | Resultado de esta revisión                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                 | Correcto antes del informe; comprobación final de documentación realizada al entregar.                                       |
| `pnpm docs:check`                   | Correcto; verifica referencias, no la actualidad semántica de las afirmaciones.                                              |
| `pnpm lint`                         | Correcto, sin aplicar fixes.                                                                                                 |
| `pnpm typecheck`                    | Correcto en los cinco paquetes; cuatro resultados provenían de caché. El build posterior volvió a ejecutar el chequeo web.   |
| `pnpm exec turbo run test --force`  | 542 core + 86 db + 200 scrapers + 59 contratos web/streams = **887 pruebas correctas**, sin reutilizar resultados de Turbo.  |
| `pnpm test:integration:local`       | **101 pruebas DB y 12 pruebas web/auth correctas**, en esquemas propios.                                                     |
| `pnpm exec turbo run build --force` | Correcto, sin reutilizar resultado de Turbo.                                                                                 |
| `pnpm test:e2e:fixtures:local`      | **79 casos Chromium correctos, 8 omitidos** por las condiciones previstas de escenarios opcionales del catálogo vivo.        |
| Reproducción adicional de identidad | Confirmó pérdida de resolución de una necesidad exacta al pasar de dos a tres tiendas.                                       |
| `pnpm audit --json`                 | **1 aviso moderado, 0 altos y 0 críticos**. El comando devuelve error por el aviso; no se considera una comprobación limpia. |
| Revisión visual                     | Inspección de capturas nuevas de lista y diálogo de canasta, en móvil y escritorio, con temas claro y oscuro.                |

El total de casos correctos de las suites ejecutadas es **1.079**, sin contar la reproducción adicional. No es una medida de cobertura de líneas ni de exactitud comercial del catálogo.

El sandbox bloqueó inicialmente Docker, conexiones locales, subprocesos y el puerto interno del build. Se reejecutaron esas operaciones con permiso. Turbopack conservó el fallo en su caché; se apartó esa caché generada, conservando el diagnóstico, y el build terminó correctamente. Esos fallos iniciales no se atribuyen al código de CompraFino.

## Prioridades

P1: corregir antes de confiar en listas recurrentes durante la expansión. P2: mejora concreta de fiabilidad, claridad o mantenimiento. P3: trabajo condicionado por crecimiento o medición. La complejidad es relativa, no una estimación de fechas.

| ID  | Prioridad | Hallazgo o mejora                                                              | Evidencia                                    | Complejidad |
| --- | --------- | ------------------------------------------------------------------------------ | -------------------------------------------- | ----------- |
| H01 | P1        | Los grupos de productos cambian de ID y rompen referencias guardadas           | Reproducido en PostgreSQL aislado            | Alta        |
| H02 | P2        | La caché de la ficha de producto recibe argumentos distintos                   | Código y semántica de React verificados      | Baja        |
| H03 | P2        | El rendimiento de búsqueda necesita medición representativa a 50.000 registros | Estructura de consultas y benchmark actual   | Media       |
| H04 | P2        | Faltan presupuestos explícitos y uniformes para peticiones públicas            | Código; controles del hosting no verificados | Media       |
| H05 | P2        | README y roadmap describen comportamiento antiguo                              | Contradicciones directas                     | Baja        |
| H06 | P2        | Los precios individuales no explican su relación con el plan seleccionado      | Código y captura de fixture                  | Baja/media  |
| H07 | P2        | La importación pendiente no tiene recuperación guiada                          | Código y limitación documentada              | Media       |
| H08 | P2        | La evaluación independiente de matching no incluye Makro                       | Inspección del corpus                        | Media       |
| H09 | P2        | Existe un aviso moderado en esbuild transitivo                                 | Auditoría del registro y advisory            | Baja/media  |
| H10 | P2        | La salud operativa necesita medir cobertura y retrasos efectivos               | Política y workflows actuales                | Media       |
| H11 | P2        | La experiencia de cuenta carece de gestión de datos propia                     | Rutas, menú y configuración revisados        | Media       |
| H12 | P3        | Indexación y presentación al compartir no tienen una política completa         | Metadata y rutas actuales                    | Baja/media  |
| H13 | P3        | Falta validar otros motores y el coste real de imágenes en móvil               | Configuración y pruebas actuales             | Media       |

## H01 Continuidad de los productos guardados

**Qué ocurre.** `canonicalGroupId` calcula el ID a partir de los IDs de todos los listings que integran el grupo. Dos tiendas generan un ID; al aparecer una tercera oferta equivalente, el conjunto cambia y genera otro. La persistencia retira asociaciones anteriores y elimina el grupo derivado que quedó huérfano. Las necesidades `strict` y `preferred` conservan el ID original.

**Reproducción.** Se crearon dos ofertas equivalentes de leche, se normalizaron y vincularon mediante los writers reales. Una necesidad exacta de un paquete produjo una canasta completa de S/ 12,90. Se incorporó la misma identidad en una tercera tienda y se repitió matching. La misma lista pasó a `incomplete`, sin asignación y con total nulo. Sustituir únicamente su referencia por el nuevo ID recuperó la canasta completa de S/ 12,90. El grupo anterior ya no existía. Todo ocurrió en un esquema desechable, sin datos de aplicación.

El cierre conservador del evaluador es correcto: no debe inventar equivalencias. El problema de producto es que una expansión válida del catálogo invalida una referencia duradera. También puede afectar URLs guardadas y continuidad de recomendaciones históricas; ese alcance adicional se deduce del código y no fue objeto de la reproducción de lista.

**Qué haría.** Separar la identidad que guarda el usuario de la composición temporal del grupo, o incorporar una resolución de sucesores inequívocos con evidencia y procedencia. La elección debe contemplar expansiones, contracciones, divisiones, fusiones y correcciones de variantes. No basta conservar siempre el ID antiguo ni redirigir por similitud de título: ambas soluciones podrían volver a autorizar equivalencias incorrectas. Los casos ambiguos necesitan una sustitución explícita por parte del usuario.

**Aceptación.** Una expansión equivalente conserva una necesidad exacta; un cambio incompatible permanece bloqueado; una división no elige sucesor arbitrariamente; las decisiones manuales y guardas concurrentes siguen protegidas. Cualquier migración se revisa y las transiciones de historia se mantienen sustentadas en observaciones reales.

Evidencia: [matching DB](../../packages/db/src/matching.ts), `canonicalGroupId` y `matchingPersistenceStatements`; [esquema de lista](../../packages/core/src/shopping-list.ts), `canonicalId` y `shoppingItemKey`; [evaluador](../../packages/db/src/shopping-list.ts), validación del título de la identidad vigente. **Prompt 01.**

## H02 Consultas repetidas en la ficha de producto

`generateMetadata` llama a `loadProduct(id)` y la página llama a `loadProduct(id, filters.priceMode)`. Aunque la función declara `standard` como valor predeterminado, React construye la clave de caché a partir de los argumentos recibidos. La llamada con un argumento y la llamada con dos ocupan entradas distintas. En beneficios, además, el modo efectivo difiere.

La afirmación del comentario sobre deduplicación no se cumple entre esos dos puntos. Esto crea trabajo DB evitable; la magnitud en milisegundos no se midió. React documenta que comparte el resultado al reutilizar los mismos argumentos; su implementación instalada también recorre `arguments.length`. [Referencia de React](https://react.dev/reference/react/cache).

La corrección pequeña consiste en normalizar los argumentos antes de entrar a la función memoizada y hacer que metadata y página compartan la lectura necesaria. Otra opción es compartir el snapshot base y aplicar el modo después, si reduce trabajo sin complicar responsabilidades. Mantendría la caché por petición, sin compartir estado sensible entre usuarios.

**Aceptación.** Contar las lecturas para una ficha ordinaria y otra con beneficios; metadata y contenido deben compartir la lectura prevista y conservar precios, condiciones y `notFound`. Evidencia: [ficha de producto](../../apps/web/src/app/products/[id]/page.tsx), llamadas de `generateMetadata` y `ProductPage`. **Prompt 02.**

## H03 Capacidad del catálogo y rendimiento de búsqueda

La búsqueda presenta 30 opciones, pero obtiene y transforma el conjunto elegible antes de paginar. El límite SQL admite hasta 50.001 candidatos para detectar overflow; la normalización, validación, filtrado y orden final ocurren también en JavaScript. Las categorías amplias pueden devolver muchos candidatos y una búsqueda textual dentro de categoría puede ejecutar otra consulta sin categoría para medir demanda.

El código ya tiene mejoras útiles: prefiltrado full-text con índice GIN, predicado de categoría sobre UUID y snapshots de canasta restringidos por familias. Por eso no propongo reemplazar la búsqueda. Lo pendiente es demostrar cuánto trabajo queda por petición y bajo concurrencia.

Las pruebas a 50.000 registros comprueban capacidad e invariantes. El benchmark de canasta usa 826 filas de relleno más sus fixtures y mide el handler con PostgreSQL local, sin Next HTTP ni latencia de despliegue. El informe histórico de capacidad incluye escenarios de 1.000, 1.500 y 2.000 registros. Ninguna de esas piezas, por sí sola, acredita p95 de navegación pública a 50.000 registros.

**Qué haría.** Medir 2.000, 10.000 y 50.000 listings con distintas familias, distribución de tiendas, identidades y profundidad de historial. Incluir búsqueda amplia, categoría sin texto, filtros, páginas posteriores y listas de 5/20/50 necesidades. Registrar filas/bytes transferidos, memoria, consultas, latencia y concurrencia. Usar `EXPLAIN (ANALYZE, BUFFERS)` sobre datos de pruebas para identificar el coste SQL. [PostgreSQL 17](https://www.postgresql.org/docs/17/using-explain.html).

Después se puede mover trabajo a SQL o materializar atributos derivados si la medición lo justifica. No introduciría un `LIMIT 30` temprano que descarte el precio más barato antes de validar elegibilidad, ni una caché que prolongue precios vencidos.

Evidencia: [consultas de ofertas](../../packages/db/src/generic-offers.ts), [política de capacidad](../../packages/core/src/catalog-policy.ts), [benchmark](../../apps/web/testing/basket-benchmark-cli.ts), [relleno del benchmark](../../packages/db/src/testing/basket-benchmark-fixtures.ts) y [medición histórica](../catalog-capacity-review.json). **Prompt 03.**

## H04 Límites de recursos en las peticiones públicas

Hay límites útiles de contenido: 128 KiB por cuerpo, 50 necesidades por lista y validación antes de evaluar. La búsqueda configura un timeout de transporte DB de 12 segundos. Sin embargo, evaluación de listas y fichas crean clientes sin ese timeout explícito. Los handlers revisados no añaden control de frecuencia propio. Las protecciones del proveedor de hosting no se inspeccionaron, por lo que no afirmo que el despliegue carezca de ellas.

Además, una lista visible solicita evaluación cada 60 segundos y al recuperar foco. Es una decisión de frescura comprensible, pero amplifica el coste al crecer el número de pestañas activas. Cancelar el fetch del navegador tampoco equivale, por sí solo, a cancelar todo el trabajo ya enviado a PostgreSQL.

**Qué haría.** Definir presupuestos de tiempo por operación, respuestas recuperables y observación de errores; verificar primero los límites del hosting. Si el tráfico exige control de frecuencia, elegir el mecanismo mínimo adecuado al despliegue, sin tratar un contador en memoria de una función serverless como límite global. Revisar la frecuencia de refresco con métricas y mantener la política de ocultar recomendaciones inválidas.

**Aceptación.** Dependencias lentas terminan de forma acotada; una cancelación no deja éxito falso; ningún timeout de escritura se interpreta como prueba de que no hubo commit. Evitar reintentos ciegos de mutaciones. Los errores siguen sin exponer datos privados.

Evidencia: [body reader](../../apps/web/src/server/request-body.ts), [handler de evaluación](../../apps/web/src/server/shopping-list-handler.ts), [cliente DB](../../packages/db/src/client.ts) y [query de evaluación](../../apps/web/src/lib/shopping-list/evaluation-query.ts). **Prompt 04.**

## H05 Documentación vigente contradictoria

Actualización del 17 de octubre: [reconciliación documental concluida localmente](../README.md#reconciliación-documental-05). El texto siguiente conserva el hallazgo original del 14 de octubre.

La documentación conserva mucho razonamiento útil, pero mezcla estado actual con frases de hitos anteriores:

- El README dice que el refresh corre dos veces al día y discovery cada seis horas; los workflows actuales programan ambos cada dos horas.
- El README y el roadmap citan el límite de 2.000 listings; `catalogPolicy` y la guía de expansión indican 50.000.
- El roadmap enumera Tottus, Plaza Vea y Metro en capacidades actuales, mientras Makro ya está en código, migraciones, UI y pruebas.
- El roadmap deja la recomendación de día de compra como trabajo futuro; el código ya implementa una política conservadora y tiene pruebas. Esto no implica que el catálogo real tenga evidencia suficiente para producir recomendaciones.

Esto puede inducir comandos o decisiones equivocadas aunque `docs:check` esté verde: ese script comprueba referencias, no contradicciones semánticas.

**Qué haría.** Reescribir el estado actual de README y roadmap desde código/configuración, enlazar las políticas en lugar de repetir cifras y conservar intactas las mediciones históricas. Separar con claridad “implementado”, “verificado localmente” y “desplegado con evidencia”. No trasladar frases de autorización de una sesión anterior a instrucciones presentes.

Evidencia: [README](../../README.md), [roadmap](../roadmap.md), [operaciones](../operations.md), [expansión](../catalog-expansion.md) y [recomendación semanal](../../packages/core/src/weekday-recommendation.ts). **Prompt 05.**

## H06 Diferenciar precio individual y plan de compra

La interfaz mantiene una buena jerarquía y controles comprensibles en las capturas revisadas. El problema más visible no es estético: el resumen usa el plan de canasta seleccionado, mientras cada fila compacta muestra su mejor opción individual, independiente de ese plan.

En un fixture de tres productos, el resumen presenta **S/ 60,00 en un supermercado**, pero las filas muestran **S/ 10,00 + S/ 10,00 + S/ 10,00**, cada una en una tienda diferente. Ambas cifras tienen sentido en sus respectivos escenarios. Sin una etiqueta visible, el usuario puede interpretar una suma incorrecta o creer que su plan cuesta S/ 30,00.

**Qué haría.** Mostrar en las filas el precio asignado por el plan seleccionado y dejar el mínimo individual como oportunidad secundaria; o mantener las filas actuales con una etiqueta explícita y un desglose claramente separado. Elegir una sola convención y aplicarla también a beneficios y sustituciones. Explicar que el ahorro entre tiendas no incluye costes de traslado cuando esa comparación se presenta.

**Aceptación.** Una persona puede entender qué compra, en qué tienda y por qué suma ese total sin abrir varios detalles. Cambiar el límite de tiendas actualiza la presentación coherentemente. El fixture de tres tiendas debe cubrir esta distinción.

Evidencia: [fila de producto](../../apps/web/src/components/shopping-list/shopping-item-card.tsx), selección de `result.best`; [vista de lista](../../apps/web/src/components/shopping-list/shopping-list-view.tsx); [canasta](../../apps/web/src/components/basket-comparison.tsx). La captura revisada fue `compact-three-items-1280-light.png`, generada por Chromium en el directorio ignorado de resultados. **Prompt 06.**

## H07 Recuperación de importaciones pendientes

Actualización del 17 de octubre: [recuperación implementada y verificada localmente](shopping-import-recovery-2026-10-17.md). El texto siguiente conserva el hallazgo original.

La importación conserva la lista anónima si hay errores o falta espacio y la vincula a la primera cuenta mediante `comprafino-shopping-list-import-owner`. Es una protección útil para impedir que otra cuenta reciba esos datos por accidente. Sin embargo, si la primera cuenta ya no puede usarse, repetir el botón de reintento con otra cuenta no resuelve la propiedad del marcador.

La guía reconoce que la recuperación del marcador está pendiente. El warning actual combina importación de otra cuenta y fallo de almacenamiento, aunque sus soluciones son diferentes.

**Qué haría.** Distinguir las causas y ofrecer recuperación explícita: volver a la cuenta original, conservar/exportar la lista local o descartarla con confirmación. Cualquier reasignación debe ser una acción consciente y proteger el cambio concurrente del snapshot. No eliminaría automáticamente el marcador para hacer desaparecer el warning.

**Aceptación.** Fallos parciales conservan datos; otra cuenta no importa sin consentimiento; el usuario puede salir del estado bloqueado sin DevTools; las carreras entre pestañas y el cierre de sesión siguen cubiertos.

Evidencia: [repositorio local](../../apps/web/src/lib/shopping-list/repository.ts), [coordinador de sincronización](../../apps/web/src/lib/shopping-list/sync-client.ts) y [persistencia](../shopping-list-persistence.md). **Prompt 07.**

## H08 Ampliar la evidencia independiente de matching

El corpus independiente tiene **105 pares y 28 grupos**, separados de la calibración. Es una práctica valiosa. Sus listings pertenecen a Metro, Plaza Vea y Tottus; no incluye Makro. Además, el validador de grupos revisados limita los miembros a tres, aunque el catálogo actual incorpora cuatro retailers.

Las pruebas específicas de Makro sí existen; la brecha es la evaluación independiente de equivalencia entre tiendas y su representatividad tras la expansión. No hay evidencia suficiente para extrapolar una métrica de ese corpus al catálogo completo actual.

**Qué haría.** Añadir una muestra nueva y fechada, sin modificar retrospectivamente las etiquetas congeladas. Cubrir Makro, grupos de cuatro tiendas, duplicados, marcas privadas, packs, variantes, medidas ambiguas, casos cercanos rechazados y grupos que cambian de composición. Reportar precisión, recall y abstención por tienda/familia con denominadores claros. Priorizar los falsos positivos porque una comparación incorrecta afecta directamente al usuario.

Evidencia: [corpus independiente](../../packages/core/src/fixtures/matching-independent.json), [tests del corpus](../../packages/core/src/matching-independent.test.ts) y [evaluador](../../packages/db/src/matching-independent.ts). **Prompt 08.**

## H09 Aviso moderado en una dependencia transitiva

`pnpm audit` detectó `esbuild@0.18.20` a través de `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils`, con rutas desde DB y Better Auth. El aviso es **GHSA-67mh-4wv8-2f99**, relativo a acceso desde otro sitio al servidor de desarrollo de esbuild por su comportamiento CORS; la corrección publicada comienza en 0.25.0. [Advisory revisado](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

La presencia del paquete no demuestra que CompraFino exponga la función vulnerable `serve`, ni una explotación de producción. La auditoría del grafo sí queda con un hallazgo pendiente, y conviene resolverlo de forma trazable.

**Qué haría.** Revisar el uso efectivo de esa rama y buscar una actualización compatible del paquete que la introduce. Si requiere override, acotarlo y probar la compatibilidad del generador/loader. No ejecutar una actualización masiva ni aceptar un override de versión mayor sin comprobación. Mantener una política de revisión periódica y documentar cualquier excepción temporal con su alcance.

El parche local de Next es otra responsabilidad de mantenimiento, no un defecto por sí mismo: ya tiene justificación y regresiones. Se debe retirar únicamente al verificar una versión que incluya la corrección y superar las pruebas de streams.

Evidencia: [lockfile](../../pnpm-lock.yaml), [dependencias](../dependencies.md), [workspace y parche](../../pnpm-workspace.yaml). **Prompt 09.**

## H10 Cobertura operativa y ejecución efectiva

Los procesos reanudables y los reportes de salud son una buena base. Hay dos puntos que conviene medir juntos:

1. Refresh y discovery comparten grupo de concurrencia y no cancelan el proceso en curso. Eso no garantiza que todas las ejecuciones pendientes se conserven: GitHub permite, por defecto, una pendiente por grupo y una nueva puede reemplazarla. Los workflows no declaran una cola ampliada. [Semántica de GitHub Actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).
2. La política distingue presencia de ofertas frescas de éxito completo. Sin embargo, tener alguna oferta fresca no mide qué proporción de una tienda o de una categoría sigue siendo útil. Una adquisición parcial puede mantener productos recientes mientras otras familias llevan tiempo sin observación.

No se verificó que haya ejecuciones perdidas ni cobertura degradada en producción. El riesgo aparece al combinar presupuestos de hasta 120 minutos, cadencias cada dos horas y cobertura creciente.

**Qué haría.** Medir duraciones, espera, cancelaciones pendientes, fuentes atrasadas y proporción de ofertas vigentes por tienda/categoría. Verificar quién recibe las incidencias. A partir de esa evidencia, ajustar budgets o scheduling; habilitar una cola grande automáticamente puede acumular trabajo obsoleto. Mantener las garantías de frescura aunque empeore la cobertura.

Evidencia: [refresh](../../.github/workflows/refresh-catalog.yml), [discovery](../../.github/workflows/discover-catalog.yml), [salud](../../packages/core/src/catalog-health.ts), [categorías y progreso](../../packages/db/src/catalog-acquisition.ts) y [operaciones](../operations.md). **Prompt 10.**

## H11 Gestión de cuenta y datos del usuario

La cuenta permite iniciar sesión, sincronizar listas y cerrar sesión. El menú no ofrece exportar datos ni eliminar la cuenta, y el shell no presenta información propia de privacidad. Esta es una brecha de producto y soporte: el usuario tiene datos persistidos, pero no una vía visible para gestionarlos.

**Qué haría.** Añadir información clara sobre qué se guarda y para qué, exportación de la lista y un flujo seguro de eliminación. La eliminación debe exigir una sesión válida, confirmación explícita y limpiar sesiones/cachés del cliente; el backend debe verificar cascadas y consistencia. La redacción sobre privacidad debe corresponder al tratamiento real de datos. No se emite aquí una conclusión de cumplimiento legal.

No hace falta construir un panel de cuenta extenso: una superficie pequeña y accesible puede resolver estas necesidades.

Evidencia: [control de cuenta](../../apps/web/src/components/auth-control.tsx), [shell público](../../apps/web/src/components/public-shell.tsx), [opciones de auth](../../apps/web/src/server/auth-config.ts) y [schema](../../packages/db/src/schema.ts). **Prompt 11.**

## H12 Política de indexación y vistas al compartir

Hay títulos por página y descripción de listing. No se encontraron archivos de sitemap/robots ni una política completa de canonical/Open Graph. Las combinaciones de búsqueda, filtros, modo de precio y rango temporal pueden generar múltiples URLs para contenidos relacionados. La prioridad depende de si la adquisición orgánica es parte del objetivo del producto.

**Qué haría.** Definir qué rutas merecen indexarse y cuáles representan estados de navegación, resolver canonical y previews y crear un sitemap acotado a identidades públicas elegibles. Resolver H01 antes de consolidar enlaces duraderos de productos. No publicar disponibilidad, descuentos o datos estructurados que excedan la evidencia observada.

No se midió indexación real en buscadores ni se atribuye una pérdida de posicionamiento. Es una mejora de preparación para distribución.

Evidencia: [layout](../../apps/web/src/app/layout.tsx), [metadata de producto](../../apps/web/src/app/products/[id]/page.tsx), [metadata de listing](../../apps/web/src/app/listings/[id]/page.tsx) y convenciones de metadata de Next instaladas en `apps/web/node_modules/next/dist/docs/`. **Prompt 12.**

## H13 Compatibilidad móvil y coste de imágenes

La suite ya cubre tamaños móviles, temas, teclado, foco, estados de carga y movimiento reducido. Es más que un smoke superficial. Su único proyecto de navegador es Chromium: un viewport de 390 px no demuestra comportamiento de Safari/WebKit.

Además, `images.unoptimized: true` entrega imágenes sin el procesamiento de Next. Puede ser una elección consciente por costes o restricciones de las fuentes; la revisión no midió bytes ni LCP y no permite afirmar que hoy sea un cuello de botella. Sí conviene comprobarlo porque la búsqueda muestra hasta 30 imágenes por página.

**Qué haría.** Añadir un smoke pequeño de WebKit para búsqueda, selección, diálogo y lista. Medir carga de imágenes y la interacción en un dispositivo o perfil móvil representativo antes de cambiar el servicio de imágenes. Conservar allowlists, tratamiento de errores y presupuestos operativos.

Evidencia: [Playwright](../../apps/web/playwright.config.ts), [imagen de producto](../../apps/web/src/components/product-image.tsx) y [configuración Next](../../apps/web/next.config.ts). **Prompt 13.**

## Evolución del producto que priorizaría

La ventaja de CompraFino es ayudar a decidir una compra con evidencia comprensible. El siguiente trabajo de producto debería facilitar tres respuestas: **qué puedo comprar, cuánto cuesta el plan que elegí y qué tan confiable/reciente es esa comparación**.

Primero resolvería H01 y H06. Después probaría las rutas principales con usuarios: encontrar un producto, agregar una necesidad, distinguir producto exacto de alternativa y ejecutar un plan de una o varias tiendas. Las mejoras de copy y recuperación pueden ser más útiles que añadir pantallas.

Mediría, con datos agregados y sin registrar innecesariamente textos privados de listas:

- Búsquedas útiles sin resultado y categorías sin opciones vigentes.
- Paso de resultados a detalle, de detalle a lista y de lista a plan.
- Porcentaje de listas que consiguen canasta completa.
- Errores de evaluación/sincronización y recuperación posterior.
- Cobertura vigente por tienda y antigüedad de las observaciones.
- Lecturas y latencia p50/p95 por ruta, distinguiendo DB, procesamiento y transporte.

El día recomendado de compra puede seguir siendo una función secundaria que se abstiene cuando faltan datos. No relajaría su evidencia para lograr más recomendaciones. Las alertas de precio, listas compartidas o ubicaciones guardadas merecen un diseño posterior basado en demanda; no son requisitos para cerrar los problemas actuales.

## Cambios de tecnología que no están justificados ahora

Mantendría PostgreSQL y la búsqueda existente antes de introducir Elasticsearch u otro motor. Mantendría los procesos programados antes de añadir colas, Redis o workers permanentes. Las métricas de latencia, backlog o cuota pueden cambiar esa decisión, pero el número 50.000 por sí solo no la justifica.

También conservaría TanStack Query, Zustand acotado al proveedor, React Server Components y los componentes existentes. No migraría a otra librería de estado ni reescribiría la UI por inconsistencias menores de clases. No añadiría IA al matching sin un problema medido y sin una evaluación independiente que proteja contra falsos equivalentes.

## Orden de ejecución sugerido

1. **Correcciones pequeñas y revisión de identidad:** H05, H02 y H06 en cambios separados; comenzar el diseño y regresión de H01 de inmediato. Revisar el alcance real de H09.
2. **Continuidad y rendimiento:** implementar la solución de H01 con pruebas de transiciones; medir H03 y usar sus resultados para H04. No optimizar a costa de elegibilidad.
3. **Operación y recuperación:** H07, H08 y H10. Verificar además una restauración de backup en un entorno aislado antes de depender comercialmente de datos persistidos; este informe no verificó la configuración de backups.
4. **Distribución y experiencia de cuenta:** H11; H12 y H13 según canales de adquisición y dispositivos de usuarios.

Cada cambio debería tener un problema concreto, prueba o medición que lo evidencie, criterio de aceptación y resultado verificable. Los prompts anexos proponen esos límites. Este reporte registra la evaluación; no aplica fixes, migra producción ni autoriza cambios históricos por sí mismo.
