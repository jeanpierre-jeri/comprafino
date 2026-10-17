# Guía para leer y trabajar en CompraFino

Empieza aquí para localizar código y tareas. Las guías describen el funcionamiento actual; los reportes fechados conservan evidencia y no autorizan despliegues.

## Dónde vive cada cosa

| Si necesitas entender…                           | Empieza por…                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Qué aplicación es y cómo arrancarla              | [README principal](../README.md)                                                                       |
| Cómo se conectan las partes                      | [Arquitectura](architecture.md)                                                                        |
| Precios válidos, disponibilidad y datos vencidos | [Elegibilidad](eligibility.md)                                                                         |
| Cuándo dos productos son equivalentes            | [Comparación de catálogo](catalog-matching.md)                                                         |
| Productos guardados y sincronización             | [Persistencia de listas](shopping-list-persistence.md)                                                 |
| Adquisición y refresco                           | [Expansión de catálogo](catalog-expansion.md) y [tiendas](retailers/makro.md)                          |
| Cómo verificar un cambio sin tocar producción    | [Pruebas locales](local-testing.md)                                                                    |
| Qué está terminado y qué sigue                   | [Estado del proyecto](history/project-review-2026-10-14.md#priorización-actual--16-de-octubre-de-2026) |
| Prompts para retomar trabajo                     | [Prompts de revisión](history/project-review-prompts-2026-10-14.md)                                    |
| Evidencia de una medición anterior               | [Índice de reportes](history/README.md)                                                                |

## Código de aplicación y herramientas

```text
apps/web/src/                     Pantallas, componentes y servidor web
apps/web/e2e/                     Pruebas del recorrido en navegador
apps/web/testing/                 Contratos y mediciones HTTP locales
  hosting/                       Cliente HTTP del kit 04A, aplazado
packages/core/src/                Reglas de precios, cantidades e identidad
packages/db/src/                  Lectores y escritores de PostgreSQL
  testing/                       Soporte compartido de pruebas aisladas
    hosting/                     Configuración, datos sintéticos y limpieza 04A
    matching/                    Muestra fechada 08A, evaluador y pruebas
packages/scrapers/src/            Adaptadores y adquisición por tienda
packages/ui/src/                  Componentes visuales compartidos
scripts/hosting/                  Preparación de la copia aislada y sus plantillas
.artifacts/                      Logs y capturas locales ignorados por Git
```

Las pruebas de una función permanecen cerca de su implementación: por ejemplo, `listing-refresh.ts` y `listing-refresh.integration.test.ts`. Las herramientas que tienen varios archivos propios se agrupan por propósito. No se juntan en un archivo gigante ni se trasladan reglas de comparación a scripts de prueba.

## Estado del trabajo local

Estado actualizado al **17 de octubre de 2026**. Los bloques terminados se guardan en commits separados por tarea. Los documentos generales reúnen el estado y la priorización; 08A está cerrado en un commit local; 07 está en `e7aa576`; 05 reúne la reconciliación documental en un commit local dedicado.

| Bloque | Cambio principal                                              | Estado y entrada                                                                                                                         |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 04A    | Kit para un entorno separado, herramientas y procedimiento    | **Aplazado.** [Manual](hosting-test-environment.md). No crea recursos ni se ejecuta al arrancar la aplicación.                           |
| 10A    | Reporte de frescura y cobertura, sin corrección de aplicación | Concluido. [Reporte](history/catalog-usefulness-2026-10-16.md).                                                                          |
| 10B    | Admisión de candidatos antes del límite del refresco          | Corrección local verificada. [Reporte](history/catalog-refresh-selection-2026-10-16.md).                                                 |
| 13A    | Scroll del diálogo y explicación de importes                  | Corrección local verificada. [Reporte](history/mobile-shopping-journey-2026-10-16.md). Personas y teléfono físico pendientes.            |
| 08A    | Muestra de comparaciones con Makro y evaluador local          | Evaluación local concluida, sin cambios de reglas ni producción. [Resultados y límites](history/matching-retailer-sample-2026-10-16.md). |
| 07     | Recuperación de importaciones pendientes                      | Implementación local, sin despliegue ni cambios de comparación. [Flujos y límites](history/shopping-import-recovery-2026-10-17.md).      |
| 05     | README, roadmap y guías operativas coherentes con el código   | Reconciliación local documental, sin operaciones remotas. [Alcance y límites](#reconciliación-documental-05).                            |

Las correcciones de aplicación terminadas están en [refresco](../packages/db/src/listing-refresh.ts) y [diálogo del plan](../apps/web/src/components/basket-comparison.tsx). La [recuperación de listas](../apps/web/src/components/shopping-list/shopping-import-recovery.tsx) concentra la nueva interacción; el coordinador conserva las guardas de sesión y propiedad. El ajuste de [matching-independent.ts](../packages/db/src/matching-independent.ts) permite cuatro tiendas en el validador de auditoría de 08A; no cambia el algoritmo del matcher.

## Reconciliación documental 05

Revisada el **17 de octubre de 2026** sobre `e7aa576`. Se corrigieron README, roadmap y sus guías enlazadas; no se añadieron archivos de reporte ni se cambió código, dependencias, migraciones o configuración.

| Contradicción corregida                                           | Fuente contrastada y lectura correcta                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Límite de 2.000 presentado como vigente                           | [catalogPolicy](../packages/core/src/catalog-policy.ts): 50.000 ofertas retenidas; la revisión a 2.000 queda identificada como histórica en [presupuesto](catalog-budget.md#reviewed-expansion-to-2000-listings). Capacidad no es catálogo adquirido, productos distintos ni comparaciones válidas.                                      |
| Horarios antiguos y refresh manual confundido con el programado   | [Operaciones](operations.md#scheduling-and-concurrency) reúne crons y enlaces a los workflows. Adquisición reanudable y discovery están programados cada dos horas; no significa que cada oferta se actualice con esa frecuencia.                                                                                                        |
| Ejemplos y parámetros de refresco anteriores                      | [Política de refresco](../packages/core/src/listing-refresh.ts), [CLI reanudable](../packages/scrapers/src/catalog-acquisition-cli.ts) y [CLI de derivación](../packages/db/src/catalog-derive-cli.ts). Se separan presupuesto por ejecución, límites globales, dry-run con llamadas públicas y previsualización de solo lectura.        |
| Makro omitido y canastas descritas sobre tres tiendas registradas | [Retailers registrados](../packages/core/src/listing.ts) y [optimizador](../packages/core/src/basket-optimization.ts): cuatro retailers, con planes de hasta tres tiendas. No implica que toda búsqueda tenga cobertura útil en cuatro.                                                                                                  |
| Recomendación semanal descrita como futura                        | [Regla implementada](../packages/core/src/weekday-recommendation.ts), [evaluación DB](../packages/db/src/shopping-list.ts) y [presentación](../apps/web/src/components/shopping-list/shopping-item-card.tsx). Hay abstención por evidencia insuficiente o patrón no claro; no se comprobó cuántos productos reales cumplen el requisito. |
| Auth, recuperación y despliegue mezclados                         | [Auth](auth.md) y [persistencia](shopping-list-persistence.md) distinguen implementación, pruebas locales y observaciones remotas fechadas. La recuperación local de 07 ya existe; no equivale a exportar datos de la cuenta.                                                                                                            |

También se corrigieron referencias operativas que aún trataban todo fallo parcial como fatal o los saltos por capacidad como éxito. La [política actual](catalog-expansion.md#operational-warning-policy) distingue avance parcial útil, fallo y salud; esto documenta el código existente, sin modificar sus reglas.

Verificación: formato Oxfmt, `pnpm docs:check` y revisión del diff. El comprobador valida rutas, anclas y comandos registrados; la coherencia semántica se contrastó con los archivos anteriores. No se ejecutaron comandos de aplicación, adquisición, migración, auditorías DB ni pruebas de runtime para este cambio de texto. Los reportes JSON y mediciones fechadas permanecen intactos.

No se verificaron el HEAD desplegado, las migraciones remotas actuales, OAuth/secrets, el tamaño/cobertura/vigencia actual del catálogo, duraciones reales de Actions, entrega de notificaciones ni cuotas/costes. Los crons son intención configurada; los resultados locales previos no acreditan rendimiento remoto. **04A sigue aplazado**, con su kit local y criterios de reanudación conservados.

## Leer el kit 04A sin recorrer todos sus archivos

1. Leer el [manual de alcance, recursos y límites](hosting-test-environment.md).
2. [prepare.mjs](../scripts/hosting/prepare.mjs) prepara una copia local de un commit y aplica las plantillas solo a esa copia.
3. [fixture-cli.ts](../packages/db/src/testing/hosting/fixture-cli.ts) es la entrada para sembrar, ampliar, inspeccionar o limpiar datos sintéticos. Delega a `fixtures.ts`; `config.ts` comprueba el destino y la propiedad.
4. [http-cli.ts](../apps/web/testing/hosting/http-cli.ts) es la entrada para generar referencias o medir HTTP. `http-scenarios.ts` reutiliza las búsquedas/canastas existentes; `http-contract.ts` valida los formatos.
5. [verify-local.mjs](../scripts/hosting/verify-local.mjs) verifica la copia preparada en loopback, con red externa bloqueada.

Los prefijos repetidos `hosting-` se sustituyeron por la carpeta `hosting/`. Se actualizaron imports, comandos y plantillas. Los reportes y archivos de evidencia anteriores conservan sus fechas y resultados; una copia ya exportada conserva sus rutas originales.

## Cómo seguir manteniendo el orden

- Una tarea pequeña a la vez; cerrar su verificación y revisar su diff antes de abrir otra.
- Cambios de aplicación, pruebas y reporte de esa tarea se revisan juntos. La infraestructura aplazada se revisa por separado.
- Añadir archivos por responsabilidad concreta, sin duplicar herramientas existentes ni crear carpetas por cada número de prompt.
- Mantener los resultados extensos en `.artifacts/` y enlazar el reporte desde el índice histórico.
- No confundir pocos archivos con poco trabajo: Los commits separan las tareas terminadas; los borradores incompletos permanecen visibles en Git. Agrupar carpetas facilita leerlos, no oculta el estado real.

## Verificación de esta organización

El 16 de octubre de 2026 pasaron formato, referencias, lint, tipos, build, 931 unitarias/contratos (una tarea con caché), 14 pruebas PostgreSQL y tres casos Chromium de navegación/lista/plan después del build. PostgreSQL usa esquemas propios y configuración local explícita. Estos resultados corresponden a la organización previa. La evaluación posterior de 08A tiene sus propios [resultados y checks](history/matching-retailer-sample-2026-10-16.md#verificación-y-reproducción).

El preparador se ejecutó solo localmente sobre el commit revisado de 04A: doce archivos exportados con hashes verificados y 29 imports relativos resueltos. No se repitió la aceptación completa de ejecución de la copia exportada ni se creó un despliegue remoto. Las copias anteriores, el manifiesto de movimientos y los logs están en `.artifacts/workspace-organization-2026-10-16/`.
