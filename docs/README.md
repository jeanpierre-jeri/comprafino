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
    matching/                    Muestra 08A y evaluador, todavía incompletos
packages/scrapers/src/            Adaptadores y adquisición por tienda
packages/ui/src/                  Componentes visuales compartidos
scripts/hosting/                  Preparación de la copia aislada y sus plantillas
.artifacts/                      Logs y capturas locales ignorados por Git
```

Las pruebas de una función permanecen cerca de su implementación: por ejemplo, `listing-refresh.ts` y `listing-refresh.integration.test.ts`. Las herramientas que tienen varios archivos propios se agrupan por propósito. No se juntan en un archivo gigante ni se trasladan reglas de comparación a scripts de prueba.

## Estado del trabajo local

Estado al **16 de octubre de 2026**. Los bloques terminados se guardan en commits separados por tarea. Los documentos generales reúnen el estado y la priorización; 08A permanece como borrador local sin commit.

| Bloque | Cambio principal                                              | Estado y entrada                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 04A    | Kit para un entorno separado, herramientas y procedimiento    | **Aplazado.** [Manual](hosting-test-environment.md). No crea recursos ni se ejecuta al arrancar la aplicación.                                                                                                              |
| 10A    | Reporte de frescura y cobertura, sin corrección de aplicación | Concluido. [Reporte](history/catalog-usefulness-2026-10-16.md).                                                                                                                                                             |
| 10B    | Admisión de candidatos antes del límite del refresco          | Corrección local verificada. [Reporte](history/catalog-refresh-selection-2026-10-16.md).                                                                                                                                    |
| 13A    | Scroll del diálogo y explicación de importes                  | Corrección local verificada. [Reporte](history/mobile-shopping-journey-2026-10-16.md). Personas y teléfono físico pendientes.                                                                                               |
| 08A    | Muestra de comparaciones con Makro y evaluador local          | **En preparación, pausado para organizar.** Muestra y evaluador en `packages/db/src/testing/matching/`, todavía sin commit. No se han evaluado sus resultados ni completado sus pruebas; no incluirlo como tarea terminada. |

Las correcciones de aplicación terminadas están en [refresco](../packages/db/src/listing-refresh.ts) y [diálogo del plan](../apps/web/src/components/basket-comparison.tsx). El ajuste de [matching-independent.ts](../packages/db/src/matching-independent.ts) pertenece al validador de auditoría de 08A; no cambia el algoritmo del matcher.

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

El 16 de octubre de 2026 pasaron formato, referencias, lint, tipos, build, 931 unitarias/contratos (una tarea con caché), 14 pruebas PostgreSQL y tres casos Chromium de navegación/lista/plan después del build. PostgreSQL usa esquemas propios y configuración local explícita. Esto verifica las rutas reorganizadas y las regresiones existentes; no concluye la evaluación nueva de 08A.

El preparador se ejecutó solo localmente sobre el commit revisado de 04A: doce archivos exportados con hashes verificados y 29 imports relativos resueltos. No se repitió la aceptación completa de ejecución de la copia exportada ni se creó un despliegue remoto. Las copias anteriores, el manifiesto de movimientos y los logs están en `.artifacts/workspace-organization-2026-10-16/`.
