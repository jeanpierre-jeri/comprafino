# Prompts para mejorar CompraFino

Estos prompts convierten los hallazgos de la [evaluación técnica y de producto](project-review-2026-10-14.md) en tareas acotadas. La base analizada fue `6567774`. Cada tarea debe comprobar el estado actual antes de modificarlo: un hallazgo puede haberse resuelto después de esa revisión.

Puedes copiar un bloque completo a una conversación de trabajo. No hace falta ejecutar todos ni hacerlo en orden numérico. Conviene empezar por documentación y consultas duplicadas, mientras se diseña la continuidad de identidad. No ejecutes en paralelo cambios sobre matching, migraciones o sincronización que dependan unos de otros.

Todos los cambios deben respetar `AGENTS.md`, preservar cambios locales ajenos y mantenerse dentro del alcance elegido. Una migración revisable en el repositorio no equivale a permiso para aplicarla a la base de aplicación.

## Prompt 01 Mantener las referencias de productos guardados

```text
Trabaja en CompraFino y respeta AGENTS.md. Revalida H01 en docs/history/project-review-2026-10-14.md: canonicalGroupId depende de los miembros del grupo y una expansión de dos a tres tiendas puede dejar sin resolución una necesidad exacta guardada.

Comienza con una regresión significativa en PostgreSQL de pruebas: crea ofertas equivalentes en dos tiendas mediante los writers reales, guarda una necesidad strict, evalúa su canasta, añade una tercera tienda equivalente y ejecuta matching. Comprueba también preferred y las URLs previas. Usa exclusivamente configuración TEST_DATABASE_URL explícita y un esquema aleatorio propio; nunca DATABASE_URL.

Define e implementa una solución conservadora que separe la referencia durable del usuario de la composición temporal del grupo, o resuelva sucesores solamente cuando haya evidencia inequívoca. Explica la alternativa elegida y sus invariantes antes de ampliar el cambio. No basta mantener todos los IDs antiguos ni redirigir por semejanza de título.

Cubre expansión equivalente, contracción, división, fusión ambigua, cambio incompatible de variante, decisiones manuales, snapshots obsoletos, concurrencia e idempotencia. Mantén precios ordinarios positivos, disponibilidad triestado y derived-identity safety. No atribuyas historia a asociaciones sin evidencia temporal. Ante ambigüedad, conserva el bloqueo y permite recuperación explícita.

Si requiere schema, prepara una migración revisable con backfill acotado y estrategia de rollout; no la apliques a producción. Actualiza la documentación. Ejecuta formato, lint, typecheck, pruebas relevantes, integración, build y Chromium si cambia la web. Entrega la reproducción antes/después y cualquier decisión que todavía requiera definición de producto. No hagas commit ni deploy automáticamente.
```

## Prompt 02 Evitar consultas duplicadas por metadata

```text
Revisa CompraFino siguiendo AGENTS.md y H02 de docs/history/project-review-2026-10-14.md. En apps/web/src/app/products/[id]/page.tsx, generateMetadata llama loadProduct(id), mientras ProductPage llama loadProduct(id, priceMode). React cache usa los argumentos recibidos; un parámetro predeterminado dentro de la función no normaliza la clave.

Consulta primero la documentación de la versión instalada de Next en apps/web/node_modules/next/dist/docs/. Confirma las llamadas y corrige la deduplicación dentro de una misma petición. Normaliza los argumentos antes de entrar al cache o comparte un snapshot base si es una solución más clara. Evita caché global entre usuarios y no alteres reglas de precios, beneficios o frescura.

Verifica con conteo de lecturas en una prueba significativa que metadata y página comparten la consulta prevista para standard y benefits. Conserva comportamiento de IDs inválidos, notFound y errores recuperables. Corrige el comentario para que describa exactamente lo implementado.

Mantén el cambio pequeño. Ejecuta formato, lint, typecheck, pruebas relevantes, build y Chromium después del build. Entrega archivos modificados, consultas antes/después y resultados. No actualices dependencias ni despliegues.
```

## Prompt 03 Medir búsqueda y canastas con el catálogo ampliado

```text
Analiza el rendimiento de CompraFino respetando AGENTS.md y H03 de docs/history/project-review-2026-10-14.md. El objetivo inicial es obtener evidencia reproducible, no cambiar la arquitectura.

Amplía o complementa el harness existente con escenarios de 2.000, 10.000 y 50.000 listings en una base de pruebas explícita, con un esquema aleatorio propio. Incluye distribuciones variadas de familias, tiendas, grupos exactos, ofertas sin cantidad, beneficios y suficiente historia para ejercitar lecturas temporales. Usa writers reales para establecer evidencia válida; si clonas para volumen, explica las limitaciones y preserva fingerprints e invariantes.

Mide búsquedas amplias y selectivas, categoría sin texto, categoría con texto, retailer/unidad, los tres órdenes, páginas posteriores y canastas de 5/20/50 necesidades. Registra calentamiento, número de muestras, p50/p95 cuando la muestra lo permita, filas y bytes transferidos, memoria, tiempo DB y tiempo total. Prueba concurrencia moderada en el entorno aislado. Distingue handler local, Next HTTP y despliegue; no extrapoles uno al otro.

Captura planes EXPLAIN (ANALYZE, BUFFERS) de consultas representativas sobre fixtures. Guarda evidencia en un nuevo archivo .artifacts/ sin sobrescribir baselines de docs/history. No uses la base de aplicación ni hagas llamadas a tiendas.

Entrega cuellos de botella ordenados por coste y propuestas pequeñas. No introduzcas LIMIT temprano, caché o índices sin demostrar que preservan ranking, elegibilidad y diversidad de unidades. No añadas Redis, colas ni un buscador externo. Deja cualquier optimización grande para una tarea con la medición concreta como entrada.
```

## Prompt 04 Acotar tiempo y coste de las peticiones públicas

```text
Trabaja en CompraFino siguiendo AGENTS.md y revalida H04 del reporte project-review-2026-10-14.md. Revisa search, detalles, /api/list/evaluate y /api/list/sync, además del refresco periódico de shoppingEvaluationQuery.

Inventaría límites existentes: bytes, cantidad de items, tiempo de transporte, cancelación, frecuencia y restricciones verificables del hosting. No supongas que la ausencia de un rate limiter en código implica ausencia de protección externa. Usa mediciones actuales si están disponibles; documenta qué presupuesto propones y por qué.

Implementa presupuestos de tiempo explícitos en las lecturas que lo necesiten, reutilizando createDatabase y las fronteras existentes. Verifica qué cancela el timeout HTTP y qué puede seguir ejecutándose en PostgreSQL. Da errores recuperables sin revelar SQL, conexiones, listas ni cuentas. No uses el mismo tratamiento para una lectura fallida y una escritura cuyo resultado quedó incierto; no añadas reintentos ciegos de mutaciones.

Evalúa la carga del refresco cada 60 segundos y al recuperar foco. Cualquier ajuste debe conservar las reglas de frescura y evitar mostrar una recomendación inválida. Si hace falta limitar frecuencia, propone primero la alternativa mínima compatible con el hosting; un Map local de serverless no es un límite global.

Añade pruebas de dependencia lenta, timeout, abort y recuperación. No introduzcas infraestructura especulativa. Ejecuta las comprobaciones aplicables, build y Chromium para cambios web. Entrega alcance real, limitaciones y métricas disponibles.
```

## Prompt 05 Reconciliar README y roadmap

```text
Actualiza únicamente la documentación vigente de CompraFino, respetando AGENTS.md. Usa H05 de docs/history/project-review-2026-10-14.md como punto de partida y revalida cada afirmación contra el código actual.

Revisa README.md, docs/roadmap.md y sus referencias a operaciones, capacidad, retailers, adquisición, autenticación y recomendación de día de compra. La revisión encontró 2.000 frente a 50.000 listings, refresh dos veces al día frente a cada dos horas, discovery cada seis horas frente a cada dos horas, Makro ausente del resumen del roadmap y recomendación semanal descrita como futura pese a estar implementada.

Escribe un estado actual coherente. Distingue capacidad configurada de catálogo adquirido, implementación de despliegue verificado y función disponible de evidencia suficiente para mostrar una recomendación. Conserva los documentos históricos como evidencia de su fecha. No conviertas autorizaciones antiguas en permiso para ejecutar comandos de producción.

Reduce duplicación enlazando una fuente de verdad para límites y horarios. Revisa que los ejemplos operativos correspondan al procesador actual y que quede clara la diferencia entre legacy refresh y adquisición reanudable. No cambies código, dependencias ni configuración operativa.

Ejecuta formato y pnpm docs:check. Entrega un resumen de contradicciones corregidas y de los hechos que no pudieron verificarse. No inventes estado remoto ni hagas deploy.
```

## Prompt 06 Hacer coherentes los precios y el plan de canasta

```text
Mejora la claridad de la lista de CompraFino siguiendo AGENTS.md y H06 de docs/history/project-review-2026-10-14.md. Reproduce el fixture donde el resumen muestra S/ 60 en una tienda y las tres filas muestran S/ 10 cada una en distintas tiendas. Los importes representan escenarios diferentes y la UI debe explicarlo.

Inspecciona ShoppingListView, ShoppingItemCard y BasketComparison. Prefiere mostrar en cada fila la asignación del plan seleccionado, con la mejor oferta individual como oportunidad secundaria claramente identificada. Si esa opción entra en conflicto con el diseño actual, propone y aplica una convención explícita que distinga ambos escenarios sin duplicar excesivamente información.

No modifiques el optimizador, la elegibilidad, las condiciones CMR ni la política de sustituciones para hacer coincidir cifras visualmente. Conserva los estados incompletos, productos faltantes, disponibilidad desconocida, refresh y errores. No sumes ahorros calculados contra baselines incompatibles. Explica el alcance de los costes de traslado cuando sea necesario.

Usa los componentes compartidos existentes y consulta las guías shadcn pertinentes y los docs locales de Next antes de cambios de framework. Verifica móvil/escritorio, ambos temas, teclado y lector de pantalla mediante nombres y estados accesibles.

Añade una regresión E2E que cambie el máximo de tiendas y compruebe la relación entre filas, tienda y total. Ejecuta checks, build y Chromium. Entrega capturas antes/después y explica la convención elegida. Evita un rediseño general.
```

## Prompt 07 Recuperar una importación pendiente sin perder datos

```text
Implementa una recuperación guiada de importaciones pendientes en CompraFino, respetando AGENTS.md y H07 del reporte project-review-2026-10-14.md. Revisa repository.ts, sync-client.ts y las pruebas de importación antes de cambiar el flujo.

Actualmente comprafino-shopping-list-import-owner conserva la propiedad de la lista anónima durante una importación parcial. Otra cuenta no puede importarla, y un reintento no resuelve un marcador perteneciente a una cuenta inaccesible. Conserva esta protección como comportamiento predeterminado.

Separa los mensajes de almacenamiento bloqueado, capacidad insuficiente e importación pendiente de otra cuenta. Ofrece acciones explícitas para volver a la cuenta original, conservar/exportar la lista local o descartarla con confirmación. No reasignes ni borres el marcador automáticamente; si implementas reasignación, debe requerir una decisión inequívoca y proteger cambios simultáneos del snapshot.

No persistas documentos de cuenta en localStorage ni Zustand persist. Mantén revisiones CAS, generaciones de sesión, cancelación y validación de respuesta. Usa TanStack Query para estado remoto y componentes compartidos para la interacción.

Prueba importación parcial, otra cuenta, almacenamiento denegado, otra pestaña que edita, respuesta tardía, logout y reintento. Comprueba que no se borra una lista no confirmada. Actualiza docs, ejecuta checks, build y Chromium. Entrega los flujos recuperables y los que se mantienen bloqueados deliberadamente.
```

## Prompt 08 Renovar la evaluación independiente de matching

```text
Amplía la evaluación independiente de matching de CompraFino siguiendo AGENTS.md y H08 de docs/history/project-review-2026-10-14.md. Revalida el corpus actual: en la revisión tenía 105 pares, 28 grupos y sólo Metro, Plaza Vea y Tottus; el esquema de grupos revisados admitía hasta tres miembros.

Mantén intacta la evidencia congelada. Prepara una muestra nueva con procedencia y fecha, separada de los datos usados para calibrar reglas. Incluye Makro, grupos de cuatro tiendas, variantes cercanas, packs, duplicados por tienda, medidas ambiguas, marcas privadas, negativos difíciles y cambios de composición del grupo.

No inventes revisión humana ni etiquetas verificadas. Distingue etiquetas confirmadas, inferidas y ambiguas; deja los casos ambiguos fuera de las métricas de verdad hasta resolverlos. Usa fixtures públicos ya disponibles o adquisición pública acotada respetando las reglas del repositorio; no evadas restricciones.

Reporta precisión, recall, abstención, candidatos no generados y falsos positivos por familia/tienda, siempre con denominadores. Una métrica de la muestra no es precisión garantizada de todo el catálogo. Comprueba separación frente al corpus de calibración.

Actualiza el evaluador para los cuatro retailers cuando corresponda y añade pruebas significativas. No ajustes umbrales sólo para subir recall ni habilites nuevas equivalencias automáticamente. Toda modificación de semántica de matching debe preservar safety, versionado y pruebas de writers. Entrega corpus, resultados, límites y propuesta de siguiente cambio.
```

## Prompt 09 Resolver el aviso transitivo de esbuild

```text
Revisa las dependencias de CompraFino siguiendo AGENTS.md y H09 de docs/history/project-review-2026-10-14.md. Ejecuta pnpm audit para comprobar si sigue presente GHSA-67mh-4wv8-2f99 en esbuild@0.18.20, introducido por drizzle-kit y su cadena @esbuild-kit, incluida la ruta desde Better Auth.

Confirma el advisory en la fuente primaria y examina el uso real de la rama afectada. Distingue presencia en lockfile, inclusión en ejecución y uso de la función serve vulnerable; no declares explotación de producción sin evidencia.

Busca el cambio compatible más pequeño en el paquete que introduce la dependencia. Si un override es necesario, acótalo y demuestra que el loader/generador sigue funcionando. Usa pnpm exclusivamente, conserva versiones controladas y no instales herramientas globales ni hagas una actualización masiva.

No ejecutes migraciones sobre la base de aplicación. Valida las herramientas Drizzle en un entorno aislado, además de auth, integración, typecheck y build. Si el lockfile o runtime web cambian, ejecuta Chromium. Repite audit y explica avisos restantes con su alcance.

No retires el parche local de Next como parte de esta tarea. Entrega el cambio de grafo, compatibilidad verificada y resultados. Si no hay solución compatible, deja una excepción temporal documentada con condiciones de revisión; no ocultes el aviso.
```

## Prompt 10 Medir salud real y retrasos de adquisición

```text
Evalúa la operación de CompraFino siguiendo AGENTS.md y H10 de docs/history/project-review-2026-10-14.md. Revisa refresh-catalog.yml, discover-catalog.yml, catalog-health.yml, catalogHealth y los reportes de fuentes.

Contrasta los horarios y budgets con la semántica actual de concurrencia de GitHub Actions usando documentación oficial. cancel-in-progress: false protege el proceso en curso, pero la cola predeterminada no conserva un número ilimitado de pendientes. Si tienes acceso autorizado, lee resultados reales de Actions y métricas del catálogo; no modifiques workflows remotos ni hagas escrituras de producción para medir.

Determina duración, espera, cancelaciones pendientes, backlog de páginas, fuentes nunca completadas y porcentaje de ofertas vigentes por tienda y categoría. Distingue una fuente rota, un fallo transitorio, falta de stock y capacidad alcanzada. La presencia de una sola oferta fresca no debe presentarse como buena cobertura de toda la tienda.

Propón y, si la evidencia basta, implementa una ampliación mínima de reportes/umbrales en el repositorio con tests. Mantén estados unknown y unmeasured; no inventes ceros. No relajes elegibilidad, frescura ni el respeto a 401/403/429 para mejorar métricas.

No añadas infraestructura ni queue: max por defecto: explica primero si se busca conservar o condensar ejecuciones y cómo se evitará backlog obsoleto. Documenta quién debe recibir incidencias; no envíes mensajes externos sin instrucción explícita. Entrega hallazgos medidos y decisiones pendientes, separando implementación local de rollout.
```

## Prompt 11 Dar al usuario control sobre sus datos

```text
Diseña e implementa una superficie pequeña de gestión de datos de cuenta en CompraFino, siguiendo AGENTS.md y H11 del reporte project-review-2026-10-14.md. Revalida lo que ya exista antes de añadir rutas o componentes.

El alcance es explicar qué datos se guardan, exportar la lista propia y permitir eliminación de la cuenta con confirmación explícita. Usa Better Auth de la versión instalada y consulta su API real, además de los docs locales de Next. No construyas un dashboard general ni pidas permisos OAuth nuevos.

La exportación y eliminación deben validar sesión en servidor y propietario. Verifica CSRF/Origin, sesiones revocadas, reautenticación cuando corresponda, cascadas de tablas y limpieza del estado del navegador. Evita que datos de una cuenta reaparezcan al cambiar a otra. No trates una respuesta de red incierta como confirmación de eliminación.

Prueba con usuarios y datos sintéticos en esquemas aleatorios propios. No elimines ninguna cuenta real ni ejecutes un rollout automático. Si requiere migración, prepara SQL revisable y documentación de efectos.

El texto de privacidad debe reflejar la implementación y señalar los datos organizativos que faltan por definir; no inventes razón social, contacto, plazo de retención ni una garantía de cumplimiento legal. Deja esos campos como decisiones explícitas de publicación.

Valida aislamiento, exportación, eliminación, logout y UI accesible. Ejecuta checks, integración, build y Chromium. Entrega el flujo y cualquier requisito pendiente antes de publicar.
```

## Prompt 12 Preparar indexación y enlaces compartidos

```text
Mejora la política de metadata e indexación de CompraFino siguiendo AGENTS.md y H12 del reporte project-review-2026-10-14.md. Consulta la documentación instalada de Next en apps/web/node_modules/next/dist/docs/ antes de modificar rutas de metadata.

Define qué URLs son páginas públicas duraderas y cuáles son estados de búsqueda/filtros/rango/beneficios. Considera H01: los IDs canónicos cambian al variar miembros, por lo que no debe prometerse estabilidad que el backend aún no garantiza.

Implementa canonical, robots, previews al compartir y un sitemap acotado sólo donde exista una política sustentable. No inventes el dominio de producción: usa configuración verificada o deja documentada la variable necesaria. No indexar contenido de cuenta ni exponer datos privados.

Conserva la diferencia entre precios observados, beneficios condicionados y disponibilidad desconocida. No agregues structured data que prometa checkout, stock o descuentos sin evidencia. Evita que sitemap/metadata consulten todo el catálogo sin límites o disparen peticiones a retailers.

Prueba variantes de URL, IDs inválidos, producto no elegible, entorno sin credenciales y límites de generación. Ejecuta formato, lint, typecheck, tests relevantes, build y Chromium. Entrega política de indexación, ejemplos de etiquetas resultantes y dependencias respecto a la continuidad de identidad. No publiques automáticamente.
```

## Prompt 13 Validar móvil y optimizar imágenes con mediciones

```text
Revisa la experiencia móvil de CompraFino siguiendo AGENTS.md y H13 del reporte project-review-2026-10-14.md. Conserva la suite Chromium existente. Añade un smoke acotado de WebKit para inicio, búsqueda/filtros, apertura y cierre de diálogos, tema y lista con fixtures deterministas. No conviertas toda la matriz en una suite costosa sin necesidad.

Verifica foco, teclado, overflow, targets táctiles, zoom y almacenamiento cuando sea posible. Distingue emulación de viewport, motor WebKit y prueba en dispositivo real; no presentes una como sustituto completo de otra.

Mide bytes de imágenes, LCP, estabilidad visual y respuesta de interacción en búsquedas representativas. next.config.ts tiene images.unoptimized: true: investiga el motivo y el efecto antes de cambiarlo. Usa fixtures/interceptación en tests; cualquier observación de fuentes externas debe ser pública, limitada y sin saltar controles.

Si las mediciones justifican optimización, elige un cambio pequeño que conserve allowlists, manejo de errores y coste previsible. Consulta los docs locales de Next y no añadas un servicio de imágenes automáticamente. No cambies las imágenes mediante URLs arbitrarias o proxies abiertos.

Entrega resultados por motor, problemas reproducibles y comparación antes/después de cualquier optimización. Ejecuta checks, build primero y luego E2E. Documenta navegadores o métricas que no pudieron verificarse.
```

## Criterio para cerrar cada tarea

Un cambio está listo cuando el comportamiento final responde al problema concreto, mantiene las invariantes del dominio y supera las comprobaciones aplicables. El resultado debe decir qué se verificó y qué no pudo verificarse. Un build correcto no acredita despliegue; una prueba con fixtures no acredita cobertura real de retailers; un comando de auditoría sin avisos no garantiza ausencia de vulnerabilidades.

Para escoger el siguiente trabajo, usa el beneficio esperado y la evidencia del reporte. Evita convertir las trece propuestas en una sola modificación grande: identidad, rendimiento, UX y dependencias necesitan revisiones separadas.
