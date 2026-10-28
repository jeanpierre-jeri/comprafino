# Integración PostgreSQL: aislamiento de cargas de capacidad

Base inspeccionada: `4563db74e48f4ce3a44f1ce2de846145bff404ae`.
Cambio exclusivamente local; sin commit, push ni despliegue. Las pruebas DB usan
solo PostgreSQL local; véase la salvedad sobre el primer build al final.

## Incidente y alcance de la evidencia

El usuario reportó 218/222 pruebas aprobadas y cuatro timeouts en health transfer,
original search, shopping list y shopping transfer. Los metadatos públicos del
[run 40738501193](https://github.com/jeanpierre-jeri/comprafino/actions/runs/40738501193)
confirman que `pnpm test:integration:local` falló tras 349 segundos. La API de
descarga de logs respondió HTTP 403 (`Must have admin rights to Repository`).
No se consultaron credenciales ni se intentó eludir ese control.

**Los cuatro timeouts no se reprodujeron localmente.** La ejecución original
conjunta aprobó las 222 pruebas. Las cuatro suites también aprobaron por separado.
Esto permite medir interferencia y eliminar una fuente de variabilidad, pero no
demuestra que sea la única causa del fallo remoto ni garantiza el siguiente CI.

## Distribución y recursos compartidos

- No había configuración ni límite explícito de workers para integración DB.
  Vitest 5.0.3 utiliza `forks`, aislamiento por archivo y paralelismo entre archivos;
  en `run` el código instalado calcula `max(availableParallelism() - 1, 1)`.
  Con cuatro CPU disponibles permite tres archivos simultáneos.
- Cada worker puede abrir un pool local de cuatro conexiones. Los esquemas
  aleatorios separan datos y bloqueos de sus tablas, pero no reservan CPU, memoria,
  almacenamiento temporal ni capacidad del servidor PostgreSQL.
- El comando raíz termina DB antes de iniciar integración web. Playwright auth ya
  usa un worker; no es la fuente de solapamiento con estas suites.
- `compose.test.yaml` usa PostgreSQL 17 y PGDATA en tmpfs. En el contenedor local:
  PostgreSQL 17.11, `shared_buffers=128MB`, `work_mem=4MB`, `max_connections=100`.
  No se modificaron estos parámetros ni el archivo Compose.

La corrida original muestreó hasta diez conexiones y cinco consultas activas.
El tiempo CPU acumulado del contenedor aumentó aproximadamente 236 segundos en
103,5 segundos de pared. Se registraron unos 517 MB decimales de archivos
temporales PostgreSQL; al estar PGDATA en tmpfs, no equivalen a escrituras en un
disco físico. Los contadores de I/O del contenedor no mostraron escritura de disco
adicional durante esa corrida. No hubo deadlocks ni OOM del contenedor. Solo una
muestra mostró un waiter de advisory lock, al final de la corrida, sin evidencia
de bloqueo persistente entre las cuatro fixtures grandes. El muestreo de un
segundo no descarta esperas breves.

## Método local

Node 24.3.0, pnpm 12.8.1, PostgreSQL desechable del repositorio. `DATABASE_URL`
vacío, `TEST_DATABASE_URL` explícito de loopback y modo `local`. Solo el arnés
general aplica migraciones en sus propios esquemas desechables.

Se asignaron temporalmente los CPU 0–3 tanto a Node (`taskset`) como al contenedor
(`docker update --cpuset-cpus=0-3`). No se ejecutaron builds u otras suites durante
las mediciones. El host tiene 30,5 GiB y no se impuso un límite de RAM; no es una
reproducción exacta del hardware, virtualización, disco, imagen ni Node del runner
de GitHub. No hay percentiles ni garantías estadísticas a partir de estas corridas.

El diagnóstico temporal se conserva ignorado bajo
`.artifacts/ci-integration-timeouts/` y
`packages/db/.artifacts/ci-integration-timeouts/`. Incluye comandos, JSON de Vitest,
logs, muestras de actividad/recursos y una transformación Vite solo para medir
fixtures y llamadas del cliente de pruebas. No se instrumentó código productivo
ni se registraron parámetros SQL, URLs de aplicación o datos personales.

### Desglose de los casos aislados

Segundos de pared; incluye el `beforeEach` cuando existe. Las lecturas se miden
alrededor de `pg.query`: incluyen SQL, espera del cliente, transporte local y
deserialización, **no son tiempo SQL puro**. El resto incluye validación,
serialización JSON, algoritmos, aserciones, GC y pequeñas operaciones del arnés;
no debe atribuirse exclusivamente a aserciones. Los intervalos concurrentes se
unen para no sumar como tiempo de pared consultas solapadas.

| Caso                                                   | Siembra inicial | Siembra 50.000 | Siembra 50.001 | Consultas fuera de esas siembras | Resto | Total |
| ------------------------------------------------------ | --------------: | -------------: | -------------: | -------------------------------: | ----: | ----: |
| Health: capacidad/rechazo                              |               — |           1,86 |           1,83 |                             1,35 |  4,59 |  9,63 |
| Búsqueda: capacidad/páginas/rechazo                    |            0,77 |           5,05 |           4,96 |                            14,85 | 13,74 | 39,37 |
| Transferencia listas: capacidad/páginas/rechazo        |            0,76 |           4,48 |           4,48 |                            10,23 |  8,37 | 28,32 |
| Transferencia listas: cuatro evaluaciones concurrentes |            0,77 |           4,89 |              — |                             5,50 |  3,10 | 14,27 |

El caso de `shopping-list` siembra dentro del propio test. De sus 36,49 segundos,
las tres consultas masivas que clonan 49.991 listings, normalizaciones e historia
consumen 24,32 + 8,20 + 2,72 = **35,24 segundos**. No es una carga de 50.000
llamadas individuales: ya usa SQL masivo a partir de una identidad admitida y
normalizada por los escritores reales. Las dos lecturas del evaluador consumen
aproximadamente 0,68 segundos. El resto incluye preparación, overflow y limpieza.

### Trabajo repetido evaluado

Las fixtures de transferencia recrean 320 listings con historia antes de cada
caso; antes de los casos grandes cuestan unos 0,76–0,77 segundos. Eliminar ese paso
solo en algunos casos complicaría su preparación por un ahorro pequeño frente al
trabajo restante. Compartir una fixture entre archivos rompería el aislamiento
de mutaciones y pruebas de datos inválidos. Las resiembras de 50.001 filas y las
lecturas de referencia/actual se conservan: no se eliminó ninguna comparación,
candidato, página, historia ni corrida concurrente para mejorar los tiempos.

## Corrección

Una opción en `packages/db/package.json`:

```text
vitest run .integration.test.ts --no-file-parallelism
```

Impide solapamiento entre archivos de integración DB y mantiene el aislamiento de
Vitest. No cambia el paralelismo de unitarias ni los `Promise.all`, transacciones,
lecturas/escrituras en carrera y locks deliberados dentro de los casos.
[La documentación de Vitest](https://vitest.dev/config/fileparallelism) distingue
explícitamente estos dos niveles de concurrencia.

No cambian los timeouts de 30/90/120/60 segundos, las fixtures, aserciones, índices,
migraciones, producción ni workflows. El coste esperado es mayor duración total
de integración a cambio de menor competencia y menos procesos simultáneos.

## Comparación completa, cuatro CPU compartidos

Ambas corridas sin instrumentación de fases, con los mismos tests y reporteros.
Los valores individuales son tiempos de Vitest, incluyendo sus hooks.

| Caso                                            | Paralelo anterior | Secuencial | Timeout conservado |
| ----------------------------------------------- | ----------------: | ---------: | -----------------: |
| Health, 50.000/50.001                           |           10,15 s |     9,61 s |               30 s |
| Búsqueda original, 50.000/50.001                |           42,96 s |    41,32 s |               90 s |
| Listas, capacidad/rechazo                       |           38,50 s |    36,59 s |              120 s |
| Transferencia listas, capacidad/páginas/rechazo |           31,74 s |    28,56 s |               60 s |
| Cuatro evaluaciones simultáneas a 50.000        |           16,28 s |    14,47 s |               60 s |

| Corrida DB                   | Resultado            | Pared del comando y monitor | Pico muestreado de suma RSS de procesos del comando | Conexiones PG máximas |
| ---------------------------- | -------------------- | --------------------------: | --------------------------------------------------: | --------------------: |
| Original, archivos paralelos | 222/222; 30 archivos |                    103,49 s |                                            2,31 GiB |                    10 |
| Archivos secuenciales        | 222/222; 30 archivos |                    288,39 s |                                            1,36 GiB |                     4 |

La suma de RSS incluye pnpm, coordinador y workers; puede contar páginas
compartidas más de una vez y no incluye PostgreSQL. Es un pico muestreado, no una
medición exacta del máximo ni una métrica de Next.js. El pico de `memory.current`
del contenedor fue 1,81/1,77 GiB respectivamente; incluye PGDATA tmpfs, WAL y caché
remanente entre corridas, así que no demuestra una reducción de memoria de trabajo
del motor. No se observaron OOM ni deadlocks.

El ahorro de tiempo por caso es modesto (aproximadamente 4–11 % para los cuatro
casos reportados) y no tiene significación estadística establecida. El efecto
verificado es eliminar la superposición de archivos y bajar los procesos y
conexiones concurrentes, conservando las carreras deliberadas dentro de cada
suite. El coste total medido es **2,79 veces** el tiempo de la corrida paralela.
El job CI mantiene su límite de 20 minutos: hay que comprobar su duración completa
en el siguiente run, incluyendo build y Chromium. No extrapolar linealmente esta
máquina al runner ni afirmar que ya se resolvió el fallo remoto.

## Repetición del comando raíz con dos CPU

Después de la corrida secuencial de cuatro CPU, se restringió temporalmente el
contenedor a CPU 0–1 y se ejecutó `taskset -c 0-1 pnpm test:integration:local`, con
`DATABASE_URL` vacío y `CI=1`. No se usó la instrumentación de fases ni se pasaron
opciones adicionales a Vitest: esta corrida verifica el script modificado tal
como lo invoca el CI.

- DB: **222/222**, 30 archivos, 293,27 segundos de Vitest.
- Integración web: **19/19**, 2,1 segundos de Playwright.
- Comando completo con monitor: **296,38 segundos**, exit code 0.
- Hasta cuatro conexiones PG y 1,49 GiB de suma RSS muestreada de los procesos
  del comando. No hubo errores del muestreador.
- Inspección posterior: **cero esquemas propios restantes, cero conexiones
  adicionales, cero deadlocks**. Se retiró el contenedor desechable creado para
  esta tarea; la afinidad temporal no queda aplicada a futuros contenedores.

Los mensajes de `Boundary validation failed` en los casos HTTP negativos son
parte de las comprobaciones de corrupción/503; sus aserciones pasaron. No se
ocultaron errores ni se activaron reintentos para obtener un resultado verde.
Las dos corridas completas secuenciales conservan todas las pruebas de capacidad
y concurrencia. Esta verificación de dos CPU sigue siendo local, con la RAM del
host sin limitar; no sustituye volver a ejecutar el job remoto completo.

## Repetición

```sh
pnpm test:db:up
DATABASE_URL= CI=1 pnpm test:integration:local
```

Para comparar diagnósticamente con el paralelismo anterior, usar `pnpm --filter
@comprafino/db exec vitest run .integration.test.ts` con las variables locales
explícitas descritas en [local testing](../local-testing.md). Ese comando directo
omite intencionalmente la opción del script; no sustituye la verificación final
del comando raíz. No ejecutar ambas corridas a la vez.

## Verificaciones adicionales

- `DATABASE_URL= CI=1 pnpm typecheck --force`: cinco tareas aprobadas, sin caché Turbo.
- `DATABASE_URL= CI=1 pnpm lint`: aprobado, sin cambiar las reglas.
- `pnpm format:check`, `pnpm docs:check` y `git diff --check`: aprobados.
- `DATABASE_URL= CI=1 pnpm test --force`: **988 pruebas aprobadas** (569 core,
  111 DB, 205 scrapers y 103 web sin navegador), sin caché Turbo.
- `DATABASE_URL= CI=1 NEXT_TELEMETRY_DISABLED=1 pnpm build --force --env-mode=loose`:
  build Next 16.3.8 aprobado, incluyendo su comprobación TypeScript.
- No se repitió Chromium: no hay cambios web. Su duración junto al resto del job
  remoto sigue siendo una verificación pendiente, no una garantía basada en los
  aproximadamente cinco minutos locales de integración.
- `git diff` confirma que no hay cambios en `packages/db/src`, core, web, scrapers,
  workflows ni lockfile. El límite en `catalogPolicy` sigue siendo 50.000 y se
  mantienen las siembras y rechazos explícitos de 50.001. Solo cambian el comando
  de integración y documentación. Ningún timeout, test o aserción se modificó.

### Salvedad de entorno del build

La primera ejecución `DATABASE_URL= ... pnpm build --force` terminó correctamente,
pero después se comprobó con el dry-run de Turbo que el modo `strict` no propagaba
`DATABASE_URL`. Next cargaba un `.env.local` existente con una URL Neon. No se
imprimió ni modificó ese valor. Por tanto, **esa primera ejecución no sirve para
certificar ausencia de intentos de conexión externa**; no hubo captura de red que
permita afirmarlo retrospectivamente.

El diagnóstico `comparison/db_read_failed` aparece también sin base configurada:
`HomeComparison` espera `connection()` antes de crear el cliente, y Next interrumpe
esa espera durante prerender. Ese mensaje no demuestra una consulta a Neon. La
revisión del flujo apunta a la interrupción de prerender, pero no sustituye una
traza de red de la primera ejecución.

Se repitió el build con `--env-mode=loose` para preservar explícitamente el valor
vacío. Se comprobó con el cargador `@next/env` resuelto desde Next que `.env.local`
no lo sobrescribe. La primera sonda intentó importar esa dependencia transitiva
directamente y falló por resolución de pnpm; la sonda corregida pasó. El resultado
de build reportado arriba es la repetición con el guard de entorno, no una prueba
de conectividad. No se cambiaron secretos, configuración productiva o funcionalidades.
