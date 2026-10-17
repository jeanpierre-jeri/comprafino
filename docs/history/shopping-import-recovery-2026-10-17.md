# Recuperación de importaciones pendientes — prompt 07

Fecha: 17 de octubre de 2026. Base local: `7cf85c6` (08A). Entrega en un commit local dedicado al prompt 07; sin despliegue, peticiones a producción, migraciones ni configuración remota. **04A sigue aplazado.**

## Problema reproducido

Una importación parcial conserva correctamente el propietario en `comprafino-shopping-list-import-owner`, pero otra cuenta recibía el mismo mensaje que un fallo de almacenamiento y solo podía reintentar. El reintento no resuelve una propiedad distinta ni explica cómo conservar la lista. La prueba de regresión exigió mensajes distintos y falló sobre el comportamiento anterior (`before.log`).

Se conservó la protección de cuentas. El nuevo flujo permite revisar la copia anónima, descargarla como JSON, conservarla, cerrar sesión para volver a la cuenta original o descartarla mediante confirmación explícita. No se reasigna el propietario. Descargar la copia no exporta datos de la cuenta; restaurar archivos JSON no forma parte de este cambio.

## Cambios y responsabilidades

| Ubicación                                                            | Responsabilidad                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/shopping-list/repository.ts`                       | Distingue propietario ajeno de almacenamiento inaccesible, inspecciona el snapshot y compara bytes y propietario antes de descartarlo. Coordina acceso con Web Locks. |
| `apps/web/src/lib/shopping-list/sync-client.ts`                      | Mantiene importación, límites, CAS y generaciones; ofrece recuperación de la copia local sin exponer documentos remotos.                                              |
| `apps/web/src/lib/shopping-list/sync-errors.ts`                      | Mensajes seguros y separados para almacenamiento, snapshot modificado y coordinación no disponible.                                                                   |
| `apps/web/src/components/shopping-list/shopping-import-recovery.tsx` | Diálogo de revisión, descarga, retorno a la cuenta original y confirmación de descarte; foco y nombres accesibles.                                                    |
| Provider, hook y vista de lista                                      | Conectan acciones a la sesión actual, escuchan cambios del marcador y desmontan el diálogo al cambiar de sesión.                                                      |
| Pruebas de cliente, repositorio y Chromium                           | Verifican los errores, carreras, descarga y listas de ambas cuentas dentro de fixtures aislados.                                                                      |

La importación completa (claim, peticiones y limpieza), las ediciones anónimas y el descarte comparten un lock exclusivo. La espera para obtenerlo está limitada a los 20 segundos del presupuesto existente del navegador; las peticiones conservan sus límites anteriores. La acción mantiene el lock hasta terminar, incluso si vence el plazo de espera después de haberlo obtenido.

El descarte vuelve a comprobar los bytes originales y el marcador dentro del lock. Una generación obsoleta, logout o cambio de sesión invalida la acción. La exportación también verifica la generación después de esperar el resultado; un manejador antiguo no puede restablecer una sesión anterior. Los documentos de cuenta siguen en TanStack Query, sin persistencia en localStorage ni Zustand persist.

El aviso de rechazo menciona capacidad y necesidades repetidas: una colisión de identidad no se presenta como prueba de que la cuenta esté llena. Una regresión específica conserva ese bloqueo sin perder la copia.

No se cambian precios, disponibilidad, identidad, comparación, fusión, límite de 50 artículos ni presupuestos públicos. Se mantienen los ganadores por revisión/fecha, la validación de respuestas y la ausencia de reproducción automática de escrituras inciertas.

## Flujos recuperables y bloqueos deliberados

| Situación                                   | Recuperación y protección                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importación de otra cuenta                  | Conservar/descargar, o cerrar sesión y acceder a la cuenta original para continuar. La lista actual de cada cuenta permanece separada. Descartar requiere confirmación y no modifica listas remotas. |
| Capacidad insuficiente                      | Liberar espacio en la cuenta original y reintentar. Se conserva el snapshot completo durante avances parciales; solo se limpia cuando todos sus artículos están confirmados.                         |
| Lectura o escritura bloqueada / cuota       | Mensaje específico; restaurar permisos/espacio y reintentar. Si la copia puede leerse, se permite descargarla. Si no puede validarse, no se exporta ni descarta.                                     |
| Otra pestaña cambió datos o propietario     | Se rechaza la acción antigua. Cerrar y revisar de nuevo genera una confirmación sobre el snapshot actual.                                                                                            |
| Escritura de resultado incierto             | Permite copia JSON local; bloquea descarte hasta una lectura remota válida. No reproduce automáticamente la escritura.                                                                               |
| Logout, cambio de cuenta o respuesta tardía | Invalida acciones pendientes; no limpia almacenamiento ni entrega una exportación tardía de la sesión anterior.                                                                                      |
| Web Locks no disponible                     | Edición anónima y descarga de respaldo disponibles. Importación automática y descarte bloqueados para conservar la propiedad sin coordinación fiable.                                                |

## Verificación y reproducción

Evidencia local ignorada: `.artifacts/import-recovery-2026-10-17/`. No contiene material necesario para ejecutar las regresiones versionadas.

| Comprobación                               | Resultado                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Regresión anterior                         | Fallo esperado por mensaje ambiguo, conservado en `before.log`.                                                                                                                                              |
| `pnpm test`                                | 953 casos correctos: 558 core, 106 db, 200 scrapers y 89 contratos web; tres tareas reutilizaron caché. `unit-final.log`.                                                                                    |
| Casos de recuperación sin base             | Nueve regresiones nuevas del cliente (29 en ese archivo) y cinco del repositorio, incluidas en los 89 contratos web.                                                                                         |
| Integración HTTP y PostgreSQL              | 12 casos correctos con configuración local explícita, esquema aleatorio propio y limpieza. `http-integration.log`.                                                                                           |
| `pnpm build`                               | Correcto, build nuevo tras el último aviso. `build-final.log`.                                                                                                                                               |
| Chromium completo                          | 95 correctos, ocho omisiones previstas por fixtures; sin fallos ni casos impedidos. `e2e-complete-final.log`. Antes del último ajuste del aviso de rechazo; sus seis flujos se repiten sobre el build final. |
| Chromium de recuperación sobre build final | Seis correctos; `e2e-recovery-final.log`, después del último ajuste y de las 953 pruebas.                                                                                                                    |
| Formato, referencias, lint y tipos         | Lint y tipos correctos (`lint-final.log`, `typecheck-final.log`); formato y referencias comprobados al cerrar el reporte.                                                                                    |

Los seis escenarios Chromium nuevos comprueban descarga real, cancelación y descarte, edición en otra pestaña, vuelta a la cuenta original después de fallo parcial, acceso denegado, cuota, falta de coordinación y capacidad con reintentos. Usan dos usuarios sintéticos y verifican sus listas remotas en el esquema del harness. El login es local de pruebas; no se invoca Google.

Las dos primeras ejecuciones completas detectaron dos pruebas antiguas que leían localStorage inmediatamente después de pulsar Agregar, antes de acabar la nueva escritura coordinada. El editor ya esperaba al guardado para cerrarse. Se añadió una espera por ese cierre en esas pruebas y en el bucle de ediciones de listas versión uno; se conservan los fallos en `e2e-complete.log` y `e2e-complete-confirmed.log`. Los resultados posteriores se registran por separado.

Capturas revisadas a 390 px en tema claro y oscuro: confirmación con snapshot cambiado y recuperación por cuota/coordinación. Guardadas en `screenshots/`. Los controles caben, el diálogo permite scroll, cancelar conserva datos y Escape/devolución de foco están verificados. No se acredita WebKit, dispositivos físicos ni revisión con lector de pantalla real.

Repetición local: seguir [pruebas locales](../local-testing.md), ejecutar `pnpm test`, `pnpm build` y `pnpm test:e2e:fixtures:local --grep '07 recovery'`; la suite completa usa el mismo comando sin filtro. Nunca usar la base de aplicación como fallback.

## Límites y revisión

localStorage no tiene transacciones entre claves. Se elimina la copia antes del marcador: si falla el segundo paso puede quedar un marcador, pero no datos sin propietario que otra cuenta pueda importar. No se promete atomicidad frente a extensiones, ediciones directas ni pestañas con versiones antiguas que no usan el lock; cerrar pestañas antiguas tras un futuro despliegue. El flujo no recupera una cuenta inaccesible ni exporta/elimina sus datos de nube.

Se consultaron los docs instalados de Next 16.3.8 sobre componentes cliente y accesibilidad y las guías locales de shadcn/React. La consulta CLI de componentes no concluyó; se contrastó con documentación oficial de [Dialog](https://ui.shadcn.com/docs/components/base/dialog), [Button](https://ui.shadcn.com/docs/components/base/button), [Alert](https://ui.shadcn.com/docs/components/base/alert) y [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request). Se reutilizaron componentes y dependencias existentes.

Siguiente tarea recomendada: **05**, reconciliar README y roadmap con el código actual. **GPT-6.1 Sol, razonamiento Medio**. Corrección documental acotada; no autoriza despliegues ni retoma 04A.
