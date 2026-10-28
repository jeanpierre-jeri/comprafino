# Versión parcial: health y listas; búsqueda original

Preparación local del 28 de octubre de 2026 sobre `e83e8433a6eb1b70be6e0728e9116d2abd86604f`.
No autoriza publicación, commits, push, migraciones ni operaciones de producción.

## Alcance y decisión

La candidata incluye exclusivamente las optimizaciones de ejecución de health y
listas. `packages/db/src/generic-offers.ts` se restaura byte por byte desde
`e83e843`: proyección, lector, validaciones y relación SQL compartida. Se retira
conjuntamente el decodificador de búsqueda, sin conservar un productor de tuplas
con un consumidor de objetos ni viceversa. No cambian rutas, permisos, precios,
historial, disponibilidad, frescura, frecuencia, cobertura o workflows.

La búsqueda compacta se difiere: la evidencia anterior del lector aislado a
50.000 candidatos, 2 GiB/1 CPU, mostró p95 serial de 3.999,47 → 4.517,43 ms
(+12,95 %), a cambio de 12,52 % menos JSON lógico. No es una medición nueva de
esta candidata ni una demostración de ahorro facturado. Su código y evidencia
íntegros están preservados en el worktree experimental descrito abajo.

La candidata debe pasar Preview protegido con base aislada antes de autorizar
producción. Restaurar búsqueda elimina la modificación responsable de esa
regresión; no demuestra por sí solo capacidad del artefacto Next completo en
Vercel ni que Neon tenga cuota disponible.

## Conservación y ramas locales

Ambas ramas siguen apuntando a `e83e843`, **sin commits nuevos**:

| Rama                               | Directorio de trabajo                                                   | Contenido sin commit                                                        |
| ---------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `codex/health-shopping-transfer`   | `/home/jeanpdev/dev/comprafino`                                         | Candidata parcial, regresiones y documentación                              |
| `codex/search-transfer-experiment` | `/home/jeanpdev/.codex/worktrees/search-transfer-experiment/comprafino` | Estado completo anterior: health, listas, búsqueda y sus pruebas/benchmarks |

`main` permanece en `e83e843`. Una rama Git por sí sola **no guarda cambios sin
commit**: el experimento está en su worktree y en el respaldo local. No limpiar,
resetear, archivar ni borrar ese worktree antes de consolidar su trabajo mediante
una acción autorizada. No fusionar la rama experimental: aún no tiene commits que
contengan su modificación y, cuando los tenga, requiere revisar su alcance.

La carpeta ignorada `.artifacts/transfer-partial-release/` contiene:

- `before-manifest.json`: SHA-256 de los 46 archivos modificados/nuevos anteriores
  y de 359 archivos de evidencia.
- `all-stages-and-evidence.tar.gz`: esos archivos y evidencia, con rutas relativas.
  Se verificó cada entrada contra el manifiesto antes de separar los cambios.
- `tracked-before.patch`: diff binario de archivos ya versionados. **No basta por
  sí solo**: los nuevos archivos están en el tar y en el worktree.
- `preservation.json`: base, ramas, ruta del worktree y conteos verificados.
- Logs, medidas y manifiesto final de esta preparación.

Los cinco directorios anteriores de evidencia se copiaron también al worktree:
`health-transfer`, `search-shopping-transfer`, `search-listing-transfer`,
`transfer-final-audit` y `transfer-deployment-safety`, bajo `.artifacts/`.
No se copiaron archivos de secretos ni dependencias. Para recuperar en otra
ubicación, crear un checkout limpio de `e83e843`, extraer allí el tar y verificar
sus hashes; no extraer sobre trabajo posterior. Es un respaldo local, no remoto.

## Archivos de la candidata y dependencias

Los cinco archivos de ejecución de health/listas se conservan exactamente como
antes de la separación:

- `packages/db/src/catalog-health.ts`: reconstruye cuatro constantes SQL antes
  del mismo validador.
- `packages/db/src/shopping-list.ts`: proyecta y reconstruye las tres colecciones
  del único snapshot SQL.
- `packages/db/src/shopping-snapshot-transport.ts`: valida longitud y restaura
  todas las posiciones sin coerciones ni defaults.
- `packages/db/src/shopping-price-history.ts` y `weekday-recommendation.ts`:
  representación compacta opcional, desactivada por defecto para otros lectores.

El objeto anidado `listing` de listas siempre fue un objeto, incluso durante el
experimento de búsqueda. Las 14 columnas de `genericOfferProjection` y las ocho
combinaciones de la relación compartida conservan el SQL original. `catalog-coverage.ts` también consume la relación original sin compactación.
Ningún consumidor de ejecución conserva importaciones del decodificador de búsqueda.

Se mantienen fixtures, lectores congelados y benchmarks de health/listas, y las
adaptaciones de `canonical-eligibility.integration.test.ts`,
`shopping-list.integration.test.ts` y `offer-projection.integration.test.ts`
necesarias para inspeccionar el snapshot compacto de listas. El último vuelve a
comparar la búsqueda original con la proyección de referencia de objetos.

`search-original.test.ts` conserva la comparación de SQL compartido.
`search-original.integration.test.ts` deriva de la suite anterior, pero exige
igualdad de filas originales y **bytes iguales** contra el lector congelado,
sin decodificar tuplas. Cubre respuestas completas, órdenes, filtros, categorías,
beneficios, unidades, paginación, datos inválidos, concurrencia, escritura atómica
y límite de 50.000/desbordamiento de 50.001. Los dos archivos de referencia en
`testing/search-transfer/` se mantienen solo como oráculo y escenarios.

Se excluyen de la candidata el codec compacto de búsqueda y su prueba, su runner
de bytes, `testing/transfer-audit/`, `testing/deployment-safety/` y los tres
informes específicos de búsqueda/auditoría conjunta. Todos permanecen intactos
en el worktree experimental y respaldo. Los informes de
[health](catalog-health-transfer-2026-10-28.md) y
[listas](search-shopping-transfer-2026-10-28.md) siguen describiendo las mejoras
incluidas. No se reescriben sus resultados históricos.

## Verificaciones de esta candidata

Resultado: candidata preparada para revisión y Preview protegido; publicación de
producción pendiente de su validación y autorización separada.

| Comprobación                                                    | Resultado                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Unitarias y fronteras, Turbo sin caché                          | 988: core 569, db 111, scrapers 205, web 103                                            |
| Integración PostgreSQL sin migraciones                          | 51/51, tres suites, 66,81 s                                                             |
| Typecheck                                                       | 5 paquetes correctos; core/ui reutilizaron caché válida                                 |
| Oxlint, Oxfmt, referencias de documentación, `git diff --check` | Correctos                                                                               |
| Build Next mediante Turbo `--force`                             | Correcto, `DATABASE_URL` vacía                                                          |
| Chromium después de build, sin base                             | 19 correctas; 8 omitidas por requerir fixtures/configuración                            |
| Preservación                                                    | 46 fuentes + 359 archivos de evidencia con hashes idénticos en el worktree experimental |
| Separación                                                      | Búsqueda byte-idéntica a `e83e843`; cinco archivos runtime de health/listas sin alterar |
| Limpieza                                                        | Cero esquemas propios y conexiones residuales; contenedor local retirado                |

Los comandos de integración están en [pruebas locales](../local-testing.md).
Usan tablas mínimas en esquemas aleatorios propios, configuración explícita y
ningún archivo de migración. Las pruebas de concurrencia comparan respuestas
completas y visibilidad de precio/beneficio antes y después de una transacción.
También se comprueban validaciones inválidas y la guarda de 50.001 candidatos.

El smoke Chromium ejecutado fue:

```sh
DATABASE_URL= TEST_DATABASE_URL= COMPRAFINO_E2E_PRELOAD= COMPRAFINO_CONTROLLED_E2E= PRICE_HISTORY_FIXTURE_IDS= NEXT_TELEMETRY_DISABLED=1 CI=1 pnpm --filter @comprafino/web exec playwright test e2e/home.spec.ts e2e/public-search.spec.ts e2e/theme.spec.ts --project=chromium --workers=2 --retries=0
```

Comprueba navegación, búsqueda inválida, fallos recuperables sin datos, temas y
bloqueo de herramientas de desarrollo. Los logs de fallo de DB son esperados en
los casos con base no configurada; no hubo conexión a producción. La integración
general y E2E con catálogo/cuentas siguen pendientes: su arnés aplica migraciones
y no se ejecutó bajo esta restricción. No se presentan comprobaciones históricas
como si hubieran corrido sobre esta candidata.

### Bytes reconfirmados tras la separación

Se ejecutaron los runners existentes con 1.000, 10.000 y 50.000 listings, dos pares
AB/BA por escenario tras calentamiento, respuestas completas equivalentes y
limpieza confirmada. Se comprueban bytes y compatibilidad, **no significancia de
latencia**: dos muestras no permiten p95 ni una afirmación nueva de rendimiento.
El tiempo incluye instrumentación de conteo, validación y transporte TCP local;
no reproduce Neon HTTP ni los límites de Vercel. Los tiempos crudos y p50 de dos
muestras están conservados en JSON, con `p95Ms: null`.

| Health: listings | Bytes antes | Bytes candidata | Reducción | Llamadas / sentencias, ambas |
| ---------------- | ----------: | --------------: | --------: | ---------------------------: |
| 1,000            |     580,511 |         504,511 |   13.09 % |                       8 / 12 |
| 10,000           |   5,794,908 |       5,034,908 |   13.11 % |                      26 / 30 |
| 50,000           |  28,969,992 |      25,169,992 |   13.12 % |                    106 / 110 |

| Escenario, catálogo de 50.000 | Bytes antes | Bytes candidata | Reducción | Candidatos | Llamadas / SELECT, ambas |
| ----------------------------- | ----------: | --------------: | --------: | ---------: | -----------------------: |
| `search-wide`                 |  35,552,060 |      35,552,060 |    0.00 % |     50,000 |                    1 / 1 |
| `list-generic-5`              |  19,710,197 |      14,265,197 |   27.63 % |     27,500 |                    1 / 1 |
| `list-mixed-20`               |  20,592,862 |      14,846,350 |   27.91 % |     27,524 |                    1 / 1 |
| `list-strict-50`              |   3,027,690 |       1,998,890 |   33.98 % |        200 |                    1 / 1 |
| `list-direct-3`               |      51,700 |          34,486 |   33.30 % |         12 |                    1 / 1 |

La búsqueda es un control sin cambios: el runner combinado llama al mismo lector
actual en ambas variantes. La comparación independiente contra el lector
congelado se realiza en `search-original.integration.test.ts`, con igualdad de
filas, respuestas, errores, orden y bytes. Las listas sí comparan lector anterior
con optimizado. El total de filas de salud incluye las consultas auxiliares;
una lista devuelve un snapshot exterior, cuyos candidatos se cuentan aparte.
Los conteos excluyen preparación de fixtures, transacciones de prueba y ajustes
de `search_path`; no son el número total de paquetes de red.

Reproducción desde la raíz, con PostgreSQL local ya iniciado:

```sh
DATABASE_URL= TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm exec node --experimental-strip-types packages/db/src/testing/health/benchmark-cli.ts --sizes=1000,10000,50000 --samples=2 --output=.artifacts/MI_RUN/health.json
DATABASE_URL= TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm exec node --experimental-strip-types packages/db/src/testing/transfer/benchmark-cli.ts --sizes=1000,10000,50000 --samples=2 --cases=search-wide,list-generic-5,list-mixed-20,list-strict-50,list-direct-3 --output=.artifacts/MI_RUN/shopping-search-control.json
```

Usar una salida nueva y ejecutar secuencialmente, sin builds/pruebas en paralelo.
Son bytes UTF-8 de JSON deserializado local, **no egreso facturado**. No se ejecutó
carga contra servicios públicos, migraciones, commit, push ni deployment.

## Preview protegido: procedimiento pendiente de autorización

1. Revisar el inventario final y autorizar un commit **solo de esta candidata**.
   Registrar su SHA completo y comprobar nuevamente que `generic-offers.ts`
   coincide con `e83e843`. No publicar desde el worktree experimental. El kit de
   [hosting aislado](../hosting-test-environment.md) exporta commits: ejecutarlo
   ahora con `HEAD` exportaría la base sin las mejoras aún sin commit.
2. Autorizar recursos, presupuesto y preparación de esquema **exclusivamente de
   pruebas**. Crear un proyecto Neon vacío independiente, no una rama del
   proyecto productivo ni una copia de sus datos. Registrar ID, endpoint,
   región, compute y cuota propia disponible. Si no hay capacidad de pruebas
   autorizada, detenerse; no recurrir al proyecto cuya cuota está agotada.
   El CLI de fixtures de hosting aplica migraciones en su esquema propio:
   requiere una autorización posterior expresa, no se ejecuta en esta etapa.
3. Preparar dos exportaciones revisadas: `e83e843` y el SHA de la candidata, con
   idénticos adaptadores del kit, dependencias bloqueadas y fixtures sintéticas.
   Verificar hashes y comparar resultados completos contra una referencia fija.
   Generar referencias fuera de las ventanas de medición de transferencia.
4. Crear un proyecto Vercel de pruebas sin integración Git automática ni dominio
   productivo. Confirmar raíz `apps/web`, acceso al monorepo, Node 24, Fluid,
   `iad1`, 2 GB/1 vCPU y presupuestos de rutas equivalentes al entorno observado.
   Volver a verificar estos límites al ejecutar; no confundir recursos de build
   con los de función. Usar CLI fijado/revisado mediante `pnpm dlx`, nunca global.
5. Configurar **solo Preview del proyecto nuevo** con credenciales nuevas de la
   base aislada y las variables del kit. No importar `.env` ni secretos de
   producción. Mantener Vercel Authentication y verificar que una petición sin
   autorización no accede a la aplicación. Cualquier acceso de automatización
   autorizado debe quedar limitado a este proyecto. No desactivar protección.
   [Documentación de Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).
6. Autorizar dos builds/Previews desde sus exportaciones; usar `deploy` sin
   `--prod`, sin `promote` y sin push a `main`. Registrar IDs, URL inmutable y SHA
   de cada artefacto; probar exclusivamente esas URLs protegidas. El kit de
   hosting especifica los comandos de `seed`, `references`, `run` y limpieza;
   seguir sus comprobaciones de identidad/propiedad y expiración.
7. Comenzar por smoke de portada, búsqueda amplia/selectiva, categorías,
   paginación, precios/beneficios/unidades, detalle/historial, lista anónima,
   edición y revalidación. Probar cuenta/permisos con identidades sintéticas,
   incluyendo rechazo de sesión ajena, Origin incorrecto y sesión caducada;
   no activar OAuth real. No confundir la matriz del kit con cobertura completa
   de autenticación, que necesita fixtures específicas.
8. Solo tras smoke correcto y presupuesto disponible, comparar ambas versiones
   con fixtures idénticas, alternando AB/BA y concurrencia 1/2/4. Empezar en la
   escala mínima admitida por el kit (2.000), después 10.000 y 50.000 solo si
   queda presupuesto. Separar arranque frío/caliente; registrar >=20 muestras
   por escenario para p95, fallos, tiempos de SQL/función cuando estén disponibles,
   memoria, tareas `after()` y consumo de ambos proveedores. No correr adquisición
   ni scraping; health se ensaya solo contra esa base aislada, no es una ruta web.
   Las peticiones HTTP pueden provocar demanda en esa base; drenar y restablecer
   fixtures entre bloques para no comparar estados distintos. Respetar frescura
   real: regenerar fixtures caducadas, nunca cambiar reglas para que pasen.
9. Criterios propuestos: igualdad funcional completa, cero fallos/timeout/OOM,
   ninguna tarea residual o error de `after()`, sin empeoramiento persistente
   > 10 % de p95 por escenario tras repetir pares. Conservar margen respecto a
   > presupuestos internos de lector/SQL y comprobar capacidad de cuatro peticiones
   > simultáneas. Son puertas de aceptación propuestas, no resultados actuales.
   > Detenerse ante cualquier discrepancia o gasto fuera del presupuesto.
10. Revisar evidencia y autorizar producción por separado. Preview no equivale
    al build productivo: [promover Preview crea un nuevo deployment de producción](https://vercel.com/docs/cli/promote).
    Verificar el SHA, variables y artefacto de producción antes de asignar dominio.
    Hobby no ofrece un canary porcentual mediante
    [Rolling Releases](https://vercel.com/docs/rolling-releases); el control aquí
    consiste en Preview aislado, una publicación acotada y vigilancia con rollback.
    No aumentar plan ni introducir flags/infraestructura para simularlo.

El push a `main` puede publicar automáticamente y activar workflows existentes:
no es un paso inocuo de preparación. No cambiar frecuencia ni workflows. Health
solo cambia cuando los jobs ejecutan el nuevo código; un Preview por sí solo no
actualiza los jobs de producción. Registrar separadamente el corte web y el primer
job de health con el nuevo SHA.

El presupuesto remoto debe contar **lecturas DB**, no solo el tamaño del HTML.
Como referencia de planificación, 100 búsquedas locales amplias de 50.000 suman
3,56 GB de JSON lógico antes de añadir listas, referencias y otras consultas;
esto no es una predicción de facturación. No lanzar automáticamente la matriz
completa del kit dentro de una cuota Free de pruebas: calcular primero sus
operaciones, medir una tanda pequeña y autorizar capacidad suficiente o detener
la ampliación. No reutilizar cuota productiva ni contratar capacidad sin permiso.

## Rollback conjunto y observabilidad inicial

Antes de publicar, registrar el deployment anterior, su SHA `e83e843`, variables
vigentes y procedimiento de rollback. En Hobby solo está disponible el deployment
productivo inmediatamente anterior mediante
[Instant Rollback](https://vercel.com/docs/cli/rollback). Evitar publicaciones
intermedias que eliminen esa referencia inmediata. El rollback de Vercel no revierte
Git ni el código de GitHub Actions; preparar además una reversión revisada de la
candidata para restaurar el código de health de los jobs, manteniendo su frecuencia.

Revertir como unidad `shopping-list.ts`, `shopping-price-history.ts`,
`weekday-recommendation.ts` y `shopping-snapshot-transport.ts`: productor SQL y
decodificador deben pertenecer a la misma versión. Revertir `catalog-health.ts`
conjuntamente si se vuelve al baseline completo. Búsqueda ya es original en esta
candidata; no introducir el codec experimental al revertir. No hay cambio de
esquema ni migración inversa. Instancias viejas/nuevas pueden coexistir porque cada
petición ejecuta su propia proyección y decodificador, sin formato persistido.

Vigilar inmediatamente errores de validación, resultados vacíos inesperados,
timeouts, memoria y p95 de búsqueda/evaluación; también estado del primer health.
Mantener una ventana de tráfico real representativo antes de declarar éxito.
No lanzar benchmarks sobre producción para llenar esa ventana. Una ausencia de
errores con pocas solicitudes no acredita capacidad de pico.

## Medición de transferencia real después de publicar

Neon mide egreso desde su proxy hacia clientes; el JSON local no es su contador.
Consultar consumo por proyecto/rama desde Console o API según acceso disponible;
`data_transfer_bytes` aparece en detalle y `public_network_transfer_bytes` en
Consumption. Registrar período, zona horaria y demoras de actualización; no restar
contadores a través de un reinicio de ciclo. No hace falta consultar tablas ni
descargar datos para obtener estas métricas.
[Definición y métricas oficiales](https://neon.com/docs/introduction/network-transfer).

Para cada ventana comparable antes/después registrar: delta de bytes del proveedor,
SHA web y de jobs, ejecuciones reales de health, evaluaciones efectivas de listas,
búsquedas ejecutadas, otros clientes/workflows y volumen del catálogo/historia.
Usar conteos agregados de operaciones y clases de tamaño, duración/fallos y
distribución de tipos de solicitudes. No registrar texto de búsquedas, productos
de listas, filas, parámetros SQL, usuarios, sesiones ni URLs con query strings.

Separar ventanas de siembra, lectura de referencias, builds y experimentos. Comparar
franjas y mezcla equivalentes, no solo GB/día ni bytes/página: una búsqueda amplia,
una lista y un job completo tienen pesos distintos. El ahorro esperado puede
modelarse con número de operaciones por clase multiplicado por el ahorro local
medido, indicando su carácter estimado; contrastarlo con el delta agregado real y
mostrar el residuo de otros clientes. No atribuir al código una caída que también
se explique por menos tráfico o menos candidatos.

Si los logs actuales no permiten contar ejecuciones efectivas por clase, la
atribución causal queda pendiente de instrumentación agregada aprobada; no inferir
llamadas SQL a partir de visitas. No se añade instrumentación de producción aquí.
El envío de solicitudes a Neon y el HTTP al navegador/retailers son flujos distintos;
CPU, CU-hours y almacenamiento tampoco sustituyen transferencia. La búsqueda
original sigue siendo un consumidor importante: estos cambios no garantizan
permanecer en Neon Free ni recuperan una cuota ya agotada.
