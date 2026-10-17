# Refresco de productos habituales — prompt 10B

Fecha: **16 de octubre de 2026, America/Lima**. Continuación de la [revisión 10A](catalog-usefulness-2026-10-16.md). El diagnóstico reutiliza sus archivos fechados y revisa el selector local; no incorpora nuevas lecturas de producción ni peticiones a tiendas. **04A sigue aplazado.**

## Causa demostrada y corrección

`previewListingRefresh` obtenía primero hasta 5.000 filas ordenadas por indicio de asociación exacta, antigüedad y UUID. Después, `selectListingRefresh` descartaba las identidades que no admitían actualización dirigida: identificadores no numéricos o una URL de Tottus que no correspondiera al `productId`. Si esas filas llenaban el pool, los productos compatibles situados después no llegaban al selector de dominio. Incluso con un presupuesto sin utilizar, la ejecución podía seleccionar cero productos y repetir el mismo bloqueo en la siguiente invocación.

La corrección aplica esa frontera de ruta de actualización **antes del `LIMIT 5000`**. Se conservan las comprobaciones posteriores del dominio. Las filas sin ruta compatible siguen almacenadas y no obtienen una ruta inventada; simplemente dejan de ocupar los puestos reservados a candidatos de actualización dirigida.

El cambio está limitado a [listing-refresh.ts](../../packages/db/src/listing-refresh.ts). Mantiene:

- Pool máximo de 5.000 y presupuesto máximo de 500 solicitudes, sin concurrencia adicional.
- Orden de prioridad existente entre candidatos admitidos.
- Umbral de seis horas y cooldown de cuatro horas, incluyendo las fronteras exactas.
- Recuperación de stock negativo basada en su fecha de verificación, distinta de una observación de precio reciente.
- Scope por tienda y diagnóstico explícito de un SKU, que conserva su comportamiento anterior.
- Guardas de claim/finish, conservación del precio tras fallo y todas las reglas de compra, identidad, cantidad, matching y disponibilidad triestado.

No cambia horarios, capacidad, migrations, endpoints de tiendas ni configuración remota. La prueba no requiere aumentar presupuestos ni modificar consultas públicas de búsqueda o canasta.

## Reproducción antes y después

La [regresión PostgreSQL](../../packages/db/src/listing-refresh.integration.test.ts) crea un esquema aleatorio propio usando exclusivamente `TEST_DATABASE_URL` explícito en el PostgreSQL local `comprafino_test`. Los writers reales establecen observaciones positivas, normalización y un grupo exacto de dos tiendas. Se clona esa evidencia para volumen: 2.500 grupos adicionales de dos miembros con IDs de lookup legacy no numéricos, más los dos miembros originales. Las copias conservan entradas del fingerprint, normalizaciones, vínculos y precios positivos; sus grupos legacy no se presentan como nuevas decisiones de matching ni como distribución medida de producción.

Al conjunto de **5.002 candidatos exactos sin ruta compatible**, observados 96 horas antes, se añaden cuatro compras de 48 horas con IDs/rutas compatibles: arroz en Metro y Tottus, avena en Plaza Vea y fideos en Makro. La antigüedad y los indicios exactos hacen que el SQL anterior complete sus 5.000 posiciones con las filas que el dominio terminará rechazando.

| Comprobación                                          | Antes                            | Después                                                            |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| Compras habituales compatibles que llegan a selección | **0/4**                          | **4/4**                                                            |
| Solicitudes autorizadas al pedir `limit: 1`           | Sin candidatos en esta regresión | Una, conservando el límite                                         |
| Fallo simulado de la primera seleccionada             | Sin progreso posible             | Conserva precio/observación y excluye ese intento durante cooldown |
| Selección una hora después del fallo                  | Mismo bloqueo de pool            | Tres candidatas restantes; otras tiendas pueden continuar          |
| Selección al cumplirse cuatro horas                   | Mismo bloqueo de pool            | La candidata fallida vuelve a ser elegible; cuatro en total        |

No se llama a retailers. El fallo se registra por las APIs reales `claimListingRefresh` y `finishListingRefresh`; no se inventa una observación exitosa. Se comprueba que el preview no modifica el estado de listings y que una solicitud fallida mantiene precio, fecha y disponibilidad desconocida.

Una segunda prueba verifica URL/productId incompatible en Tottus, productId no numérico en otra tienda, exclusión por observación de sólo cinco horas, recuperación de indisponibilidad con evidencia negativa antigua y el diagnóstico explícito de un SKU que el scheduler no admite.

La regresión previa falló con `expected [] to deeply equal [cuatro IDs]`. Los registros locales están en `.artifacts/catalog-refresh-10b/before.log`, `after.log` e `integration.log`. Una primera preparación de fixture generó UUID sin bits de versión válidos; se corrigió antes de registrar la reproducción real. La prueba también distingue los productos útiles de familia de los que tienen un perfil de sustitución: avena y fideos no reciben un perfil inventado para satisfacer el test.

## Relación con la evidencia de 10A y límites

10A midió 14.105 registros de más de 36 horas y diferencias entre los ciclos completamente exitosos y ofertas aún vigentes. Esos datos justificaron revisar la renovación de productos existentes. La captura no contiene todos los IDs externos/productId/URLs y últimos intentos necesarios para cuantificar cuántas filas de producción sufrían exactamente este bloqueo. **La corrección resuelve un defecto reproducido del selector; no demuestra una reducción del 34,1 % vencido en producción.**

La frecuencia efectiva, el reparto entre candidatos compatibles y los fallos de categorías siguen siendo factores operativos independientes. Este cambio no garantiza refresco universal ni elimina la prioridad existente de los productos exactos. Una identidad sin lookup compatible continúa dependiendo de otro camino de adquisición permitido. Tampoco convierte un fallo de fuente en stock falso ni un precio viejo en precio actual.

Para medir impacto real hará falta publicar bajo una tarea autorizada y realizar otra captura de sólo lectura. En esta entrega no se despliega ni se cambia producción. La siguiente tarea propuesta es **13A: revisar el recorrido principal en móvil**, con GPT-6.1 Sol y razonamiento Medio; las mejoras de relevancia y revisión independiente de Makro conservan su alcance separado.

## Verificación

| Comprobación                                               | Resultado                                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formato, referencias de documentación y `git diff --check` | Correctos al cerrar la entrega.                                                                                                                                                           |
| `pnpm lint`                                                | Correcto.                                                                                                                                                                                 |
| `pnpm typecheck`                                           | Cinco paquetes correctos; core y UI reutilizaron caché.                                                                                                                                   |
| `pnpm test`                                                | 558 core + 98 DB + 200 scrapers + 75 contratos web/streams: **931 correctos**. Core y DB reutilizaron resultados de la primera ejecución; scrapers y web se completaron en la repetición. |
| Integración de DB con URL local explícita                  | **149 pruebas correctas en 23 archivos**, incluidas las dos regresiones nuevas.                                                                                                           |
| `pnpm build`                                               | Correcto; build de producción local, sin despliegue.                                                                                                                                      |

La primera ejecución de unitarias quedó bloqueada por `EPERM` al lanzar subprocesos del sandbox e interrumpió contratos web. La repetición con permisos locales completó todas las tareas. No quedan fallos de checks pendientes por esa causa. Después del último ajuste de la comprobación de limpieza se repiten las dos regresiones específicas, sin repetir toda la matriz.

No se modificó UI ni rutas públicas y no se ejecutó Chromium E2E. No se repiten benchmarks de carga o de hosting. Cada suite de integración crea y limpia únicamente su esquema propio; la nueva suite comprueba también que su namespace ya no existe tras el teardown. La evidencia de 10A se conserva sin nuevas lecturas remotas.
