# Timeout de capacidad y paginación de listas

Base: `44d14dfb61b006b5bccef2d31c5bb5131f0d6ec2`. Cambio local, sin commit,
push ni ejecución remota. No cambia código productivo ni workflows.

## Diagnóstico

El usuario reportó 221/222 pruebas aprobadas y un timeout de 60.000 ms en
`shopping-transfer.integration.test.ts`, caso
`retains the full current catalog bound and unchanged full-scope search pagination`.
Los metadatos públicos del [CI 40756806624](https://github.com/jeanpierre-jeri/comprafino/actions/runs/40756806624)
confirman 624 segundos en el paso de integración y que build/Chromium no se
ejecutaron. Los 622,90 segundos de Vitest provienen del reporte del usuario.
No se dispone de un tiempo remoto de finalización de esta prueba: fue interrumpida.

El caso incluye, secuencialmente:

1. `beforeEach`: fixture habitual de 320 listings con 90 días de historia.
2. `seed(50_000)`: truncado y reconstrucción de las nueve tablas, historia,
   normalizaciones, asociaciones, beneficios, categorías y `ANALYZE`.
3. Lectores anterior/actual de una lista genérica y comparación completa de
   resultados, métricas y valores SQL reconstruidos.
4. Dos búsquedas públicas independientes, cada una con todos los candidatos,
   para verificar páginas, bytes, cantidades y ausencia de productos repetidos.
5. `seed(50_001)`: segunda reconstrucción completa.
6. Comparación de ambos rechazos de listas y rechazo de búsqueda por overflow.
7. `afterAll`: eliminación del esquema propio y cierre del pool; este hook tiene
   su propio timeout y está fuera del presupuesto del cuerpo del test.

Son siete consultas de negocio: cuatro evaluaciones de listas y tres búsquedas.
Las llamadas internas del transporte local añaden `search_path`/transacciones;
no se deben confundir con nuevas consultas del algoritmo.

## Medición local original

PostgreSQL 17 desechable, Node 24.3.0, Vitest 5.0.3. Node y PostgreSQL comparten
CPU 0–1 mediante afinidad temporal. RAM del host sin limitar; no es una réplica
exacta de la VM de GitHub. URL de pruebas explícita de loopback y modo `local`;
sin Neon, base de aplicación ni migraciones reales. Las suites generales aplican
migraciones solo a sus esquemas aleatorios de pruebas.

Tres procesos aislados ejecutaron el caso original con el timeout de 60 segundos.
Una transformación Vite temporal instrumentó las fases y `pg.query` sin cambiar
las fuentes ni registrar SQL, parámetros o datos. Se conservan reportes, sonda,
comandos y muestras bajo `.artifacts/ci-shopping-timeout/` y
`packages/db/.artifacts/ci-shopping-timeout/`, ignorados por Git.

| Fase                                         |  Mediana | Rango de tres corridas |
| -------------------------------------------- | -------: | ---------------------: |
| Setup de esquema                             |  0,027 s |          0,025–0,028 s |
| Seed inicial de 320                          |  0,780 s |          0,777–0,788 s |
| `seed(50_000)`                               |  5,078 s |          4,965–5,367 s |
| Lecturas y comparación de listas a capacidad |  5,508 s |          5,365–5,999 s |
| Búsqueda página 1                            |  5,086 s |          5,079–5,096 s |
| Búsqueda página 2                            |  5,035 s |          4,969–5,189 s |
| Aserciones de páginas                        | 0,0006 s |        0,0006–0,0006 s |
| `seed(50_001)`                               |  4,935 s |          4,906–5,331 s |
| Lecturas y comparación del rechazo de listas |  0,570 s |          0,552–0,736 s |
| Rechazo de búsqueda                          |  2,586 s |          2,569–2,823 s |
| Eliminación del esquema                      |  0,019 s |          0,019–0,021 s |
| Cierre del pool                              | 0,0002 s |        0,0002–0,0002 s |

Vitest reportó **30,500 / 30,119 / 29,496 segundos**, incluyendo sus hooks por
caso. Las medianas de fases no tienen por qué sumar la mediana del total.
`pg.query` mide SQL, espera, transporte TCP y deserialización conjuntamente;
no es tiempo de ejecución SQL puro. Los tres procesos son observaciones, no p95.

Dentro de la comparación a capacidad, las medianas de los lectores fueron
2,783 s (anterior) y 2,532 s (actual), incluyendo validación y medición de bytes.
Las esperas observadas dentro de `pg.query` fueron 1,193 y 1,009 s respectivamente.
La reconstrucción y aserciones restantes de `compare`, descontando ambos lectores
en cada corrida, costaron **0,132 s** de mediana. Para el rechazo, ese resto fue
0,0016 s. Las búsquedas de páginas esperaron 2,200/2,249 s en el cliente SQL y el
resto fue procesamiento en Node. La espera SQL de las siembras fue 5,062/4,924 s.
La limpieza final no explica el timeout del cuerpo del test.

## Duplicación y decisión

La siembra de 320 justo antes de 50.000 repite preparación, pero solo cuesta unos
0,78 s localmente y está en `beforeEach`, con su propio timeout de 30 s, fuera del
presupuesto del callback. Así lo ejecuta Vitest 5.0.3: primero espera el hook y
después invoca la función envuelta en su timeout. Quitar esa siembra no resuelve
el límite de 60 s del cuerpo. Compartir el catálogo del test anterior introduciría dependencia
de orden y de sus mutaciones. No se hizo ninguna de esas modificaciones.

Se podría diseñar una fixture incremental para pasar de 50.000 a 50.001, pero
habría que demostrar igualdad de las nueve tablas, historia, beneficios y
asociaciones, además de independencia y limpieza. No se sustituye aquí la
siembra completa por una fila incompleta. Las lecturas de referencia y actual y
las dos búsquedas de páginas son comprobaciones distintas; reutilizar sus
resultados quitaría la verificación de esas ejecuciones independientes.

La corrida secuencial local anterior del comando raíz tardó 293,27 s en Vitest;
GitHub tardó 622,90 s, razón **2,12**. Descontando el hook de 320 del tiempo que
reporta Vitest, el cuerpo local tarda aproximadamente 28,72–29,71 s. Aplicando
esa razón como aproximación al cuerpo, da **61–63 s** (63–65 s incluyendo el hook),
coherente con que 60 s sea insuficiente. Esta razón global no es
una medición remota del caso ni prueba que no existan otras fuentes de lentitud.

La corrección es **60.000 → 120.000 ms exclusivamente en este `it`**, con un
comentario sobre su carga compuesta. El margen es aproximadamente 1,9 veces
la estimación. No se incrementan timeouts globales, hooks, consultas productivas,
reintentos, job o la otra prueba de cuatro evaluaciones concurrentes. No se
modifican fixtures, datos, aserciones o límites de 50.000/50.001.

## Presupuesto de GitHub Actions

Los pasos anteriores a integración consumieron 60 s en el último run. Tres runs
exitosos del mismo workflow aportan tiempos reales para los pasos pendientes:

| Run                                                                                              | Build | Instalar Chromium y dependencias | E2E con fixtures |  Suma |
| ------------------------------------------------------------------------------------------------ | ----: | -------------------------------: | ---------------: | ----: |
| [40127450980](https://github.com/jeanpierre-jeri/comprafino/actions/runs/40127450980), `e83e843` |  12 s |                             16 s |            166 s | 194 s |
| [39288473654](https://github.com/jeanpierre-jeri/comprafino/actions/runs/39288473654)            |  19 s |                             19 s |            224 s | 262 s |
| [39138975055](https://github.com/jeanpierre-jeri/comprafino/actions/runs/39138975055)            |  20 s |                             15 s |            212 s | 247 s |

El workflow, configuración Playwright y specs E2E no cambiaron entre `e83e843` y
la base inspeccionada. Los tiempos históricos siguen siendo aproximaciones:
hardware, cachés, instalación, reintentos y comportamiento de la aplicación varían.

Presupuesto razonado: 60 s previos + unos 625–655 s de DB (sustituyendo el fallo
a 60 s por una terminación de aproximadamente 61–90 s) + 3–8 s de integración web

- 194–262 s de build/instalación/E2E + unos 5 s de cierre = **887–990 s**, alrededor
  de **15–16,5 minutos**. Si este caso agotara todo el nuevo límite, el escenario
  con los otros pasos en el extremo alto ronda **17 minutos**. No es una cota
  superior: otros retrasos o reintentos pueden consumir el margen restante.

No se reorganiza ni amplía el job de 20 minutos por ahora: los datos disponibles
no lo justifican. Debe confirmarse con una ejecución remota completa después de
que el usuario publique el cambio. Si se acerca al límite, medir primero el paso
responsable; no aumentar globalmente timeouts ni quitar pruebas como solución.

## Verificación final

La repetición aislada con la misma sonda después del cambio pasó en **29,024 s**.
No es una mejora de velocidad: solo se amplió el presupuesto. La fuente del test,
restaurando ese número y quitando el comentario, es idéntica byte a byte a `HEAD`;
no se cambió ninguna preparación ni aserción.

La verificación completa se ejecutó secuencialmente con CPU 0–3 compartidos por
Node y PostgreSQL, recreado después de las mediciones aisladas. Resultados:

| Paso                                      | Resultado                                                     | Tiempo del comando |
| ----------------------------------------- | ------------------------------------------------------------- | -----------------: |
| Formato                                   | Aprobado                                                      |             1,46 s |
| Referencias de documentación              | Aprobado                                                      |             0,09 s |
| Lint                                      | Aprobado                                                      |             1,43 s |
| Typecheck                                 | Cinco tareas aprobadas, sin caché Turbo                       |             1,37 s |
| Unitarias/fronteras                       | 988 aprobadas, sin caché Turbo                                |            12,67 s |
| Integración local                         | 222/222 DB y 19/19 web                                        |           286,98 s |
| Build protegido                           | Aprobado, sin caché Turbo                                     |             8,85 s |
| Chromium, configuración local por defecto | 136 aprobadas, 1 flaky, 10 omisiones condicionales existentes |           134,81 s |

La corrida de DB reportó 284,25 s en Vitest. El build incluye compilación,
TypeScript y prerender; no se borró la caché incremental de Next. Chromium estaba
instalado: la instalación de navegador/dependencias no está incluida en la medida
local; para estimarla se usan los pasos reales de GitHub de la tabla anterior.

Playwright 1.63 calcula sus workers porcentuales con `os.cpus().length`, que aquí
sigue siendo 12 pese a `taskset`; por eso el comando por defecto usó seis workers.
El run tuvo un fallo de 5 s en `search-experience.spec.ts:45`: después de elegir
Metro y enviar la búsqueda, faltaba `retailer=metro` en la URL. Pasó con el retry
ya configurado; **no es una corrida Chromium libre de fallos**. El log original se
conserva en `chromium.log`. No se atribuye automáticamente a falta de recursos ni
se modifica ese test o el producto a partir de una sola observación.

La repetición completa de Chromium con `--workers=2` pasó en **132,33 s** de
comando: **137 aprobadas y las mismas 10 omisiones condicionales**, sin fallos ni
reintentos. El caso de categoría pasó en 1,4 s. Este override es solo de la medición
local; no cambia el workflow ni la configuración. Una repetición limpia no
demuestra que la intermitencia anterior haya desaparecido: queda como riesgo a
observar en el CI, separado del timeout DB corregido.

La primera secuencia local completa de formato a Chromium consumió **447,66 s**
(7 min 28 s), con el retry señalado y navegador ya instalado. No es el tiempo de
GitHub: se conserva la estimación de 15–17 minutos basada en sus pasos históricos
y en la integración DB lenta reportada. No se justificó reorganizar el workflow.

Al terminar quedaron **cero esquemas propios, cero conexiones adicionales y cero
deadlocks**; se retiró el contenedor desechable y con él su afinidad temporal.
Los logs de errores de corrupción, expiración y datos inválidos deliberados en
las suites conservan sus aserciones; no se filtraron para declarar éxito.

Para repetir el caso sin instrumentación:

```sh
pnpm test:db:up
DATABASE_URL= TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm --filter @comprafino/db exec vitest run src/shopping-transfer.integration.test.ts --no-file-parallelism -t 'retains the full current catalog bound'
```

Para la verificación completa se usa `DATABASE_URL= CI=1 pnpm test:integration:local`.
El build local usa `DATABASE_URL= CI=1 NEXT_TELEMETRY_DISABLED=1 pnpm build --force
--env-mode=loose`, más una sonda temporal en `NODE_OPTIONS` que exige el valor vacío
al arrancar cada proceso Node. Esto evita que Turbo elimine el override vacío y
Next recupere una URL de `.env.local`. Después, `pnpm test:e2e:fixtures:local` crea
su esquema propio y el servidor usa el preload y URL reservada de fixtures. El
guard del build no se propaga a este paso. No se modifica ningún `.env`.

**Estado remoto: pendiente. No se declara resuelto el CI.**
