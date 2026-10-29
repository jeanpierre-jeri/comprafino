# Seguimiento del timeout de búsqueda original

Base: `6427c1e` (`test(db): increase timeout for full-catalog shopping transfer regression`).
El usuario reporta 221/222 pruebas DB aprobadas en 652,62 s: ahora falla
`search-original.integration.test.ts`, caso `retains all 50,000 candidates and the
overflow error before invalid-data validation`, al alcanzar 90.000 ms. La prueba
de listas ya no aparece entre los fallos. No se ha ejecutado este nuevo cambio
remotamente ni se declara estabilizado el CI.

## Trabajo conservado y diagnóstico

Las suites siguen ejecutándose secuencialmente. El caso incluye dos siembras
completas (50.000 y 50.001), seis búsquedas independientes (referencia y actual
para página 1, página 2 y overflow), igualdad profunda de respuestas y filas SQL,
igualdad de métricas/bytes y precedencia del error de límite sobre datos inválidos.
No se omite ningún candidato ni se sustituye ninguna ejecución por resultados
anteriores. El `beforeEach` de 320 filas y la limpieza tienen presupuestos de hook
independientes; no explican el timeout del cuerpo.

Se midió el test original dos veces con PostgreSQL 17 local desechable y Node 24,
compartiendo CPU 0–1 por afinidad temporal. No hay límite de RAM equivalente al
runner remoto. Las siembras y consultas se ejecutan en esquemas propios aleatorios,
con `TEST_DATABASE_URL` de loopback y modo `local` explícitos. No se usa Neon.
Las transformaciones Vite temporales solo recogen fases, cantidades y tiempos,
sin SQL, parámetros ni datos. No se incorporan a la ejecución ordinaria.

| Fase                                                 | Corrida 1 | Corrida 2 |
| ---------------------------------------------------- | --------: | --------: |
| Hook seed(320)                                       |   0,776 s |   0,787 s |
| Seed(50.000)                                         |   5,002 s |   4,839 s |
| Página 1: dos lecturas y comparación                 |  11,636 s |  11,483 s |
| Página 2: dos lecturas y comparación                 |  11,471 s |  11,292 s |
| Seed(50.001)                                         |   4,896 s |   4,899 s |
| Overflow: dos lecturas y comparación                 |   8,468 s |   7,387 s |
| Limpieza del esquema                                 |   0,019 s |   0,021 s |
| Total reportado por Vitest, incluidos hooks por caso |  42,251 s |  40,689 s |

En las comparaciones, el tiempo acumulado en el cliente SQL fue respectivamente
5,510/5,440 s (página 1), 5,421/5,441 s (página 2) y 5,561/4,561 s (overflow).
Incluye espera, transporte TCP y deserialización, no solo ejecución del servidor.
La comparación de valores posterior a las dos lecturas costó 0,183–0,215 s por
par; el resto incluye lógica, validación e instrumentación de bytes en Node.
El observador intenta reconocer snapshots de listas por cada fila de búsqueda:
ese coste del arnés está incluido, no debe atribuirse a producción. No se cambia
ese instrumento compartido como parte de un ajuste de timeout.

No se observaron bloqueos ni deadlocks en las muestras de estas corridas. La
primera alcanzó aproximadamente 1,40 GiB de RSS sumado de procesos descendientes
(no memoria exclusiva de la búsqueda ni de PostgreSQL) y dos conexiones. Registró
173 MB decimales acumulados de temporales PostgreSQL, sobre almacenamiento local
tmpfs. No hay evidencia equivalente de recursos del runner remoto; afinidad local
no reproduce CPU, memoria, disco ni carga del host de GitHub.

## Corrección mínima

La integración remota reportada (652,62 s) frente a la última local (284,25 s de
Vitest DB) da una razón global de 2,30. Aplicarla al cuerpo de 39,90–41,48 s aproxima
**92–95 s**, coherente con agotar 90 s. No es una medida de finalización remota:
ese caso fue interrumpido y puede tener otras fuentes de variación.

Se amplía únicamente este `it` de **90.000 a 180.000 ms**, dejando aproximadamente
1,9 veces la estimación y un presupuesto mayor que el caso de listas, que hace
menos búsquedas completas. No acelera la prueba. No se cambian hooks, otras pruebas,
fixtures, cobertura, aserciones, reintentos ni el límite de 20 minutos del job.
No se modifica código productivo, workflows, frecuencias ni dependencias.

Eliminar el seed inicial de 320 no rescataría el timeout del cuerpo. Compartir
fixtures entre casos introduciría dependencia de orden; reutilizar lecturas
eliminaría la comprobación independiente de páginas/implementaciones. Añadir una
fila incremental requeriría demostrar la equivalencia de nueve tablas y sus
relaciones. Esos cambios no son necesarios para este ajuste acotado.

## Presupuesto remoto

Se conservan los tiempos históricos verificados en el [informe anterior](ci-shopping-timeout-2026-10-29.md):
un minuto previo a integración y 194–262 s para build, instalación de Chromium y
E2E. Con el nuevo reporte DB, sustituyendo el corte de 90 s por una terminación
estimada de 92–120 s: 60 + (652,62 − 90 + 92–120) + 3–8 de integración web +
194–262 + 5 de cierre = **917–1.018 s, unos 15,3–17 minutos**.
Si el caso consumiera los 180 s completos, el extremo alto rondaría **18 minutos**.
No es una garantía: otros casos, instalación, cachés, reintentos o recursos pueden
agotar los 20 minutos. No se reorganiza el workflow sin evidencia de ese problema.

## Verificación y reproducción

La repetición aislada tras el cambio pasó en **40,926 s**. Restaurando el número
y quitando las dos líneas de comentario, el archivo del test coincide byte a byte
con `HEAD`: las aserciones, fixtures y consultas permanecen intactas.

Verificación completa, secuencial, con Node y PostgreSQL compartiendo CPU 0–3:

| Comando                                   | Resultado              |   Tiempo |
| ----------------------------------------- | ---------------------- | -------: |
| `pnpm format:check`                       | Aprobado               |   1,43 s |
| `pnpm docs:check`                         | Aprobado               |   0,10 s |
| `pnpm lint`                               | Aprobado               |   1,64 s |
| `pnpm typecheck --force --env-mode=loose` | Aprobado               |   1,79 s |
| `pnpm test --force --env-mode=loose`      | 988 aprobadas          |  13,28 s |
| `pnpm test:integration:local`             | 222/222 DB + 19/19 web | 309,01 s |
| `pnpm build --force --env-mode=loose`     | Aprobado               |  10,74 s |

Vitest DB reportó 305,91 s en esta nueva corrida completa. Usar este denominador
en lugar del anterior da una razón de 2,13 y aproxima el caso a 85–88 s remotos.
La diferencia entre ambas aproximaciones (85–95 s) demuestra que 90 s carece de
holgura, pero no permite identificar por sí sola la causa exacta de la variación
remota. El timeout remoto está confirmado; no se reprodujo localmente.

El build exige `DATABASE_URL=''` mediante un guard temporal heredado por cada
proceso Node; no utiliza la base de aplicación. Turbo se ejecutó sin caché de
tareas; no se borró la caché incremental de Next. El total local fue 337,99 s.
No se repitió Chromium en esta intervención: no hay cambios web y el presupuesto
remoto usa sus mediciones históricas, no una nueva ejecución completa del workflow.
La intermitencia E2E documentada en el informe anterior sigue pendiente de observar.
Al terminar se verificaron cero esquemas propios, cero conexiones adicionales y
cero deadlocks; se retiró el contenedor local desechable.

Las corridas dirigidas seleccionan solo el caso grande mediante `-t`, por lo que
los otros 19 casos de ese archivo aparecen omitidos en esas mediciones. La
integración completa ejecutó todos: no hay nuevas omisiones ni eliminación de
pruebas. Los mensajes de validación deliberadamente provocados por las suites
mantienen sus comprobaciones; no se han tratado como fallos silenciosos.
La instrumentación y los logs están en `.artifacts/ci-search-timeout/` y
`packages/db/.artifacts/ci-search-timeout/`, ignorados por Git. Los reportes previos
se conservan. Para repetir la prueba sin la sonda:

```sh
pnpm test:db:up
DATABASE_URL= TEST_DATABASE_URL=postgresql://comprafino_test@127.0.0.1:55432/comprafino_test COMPRAFINO_TEST_DATABASE_MODE=local pnpm --filter @comprafino/db exec vitest run src/search-original.integration.test.ts --no-file-parallelism -t 'retains all 50,000 candidates'
pnpm test:db:down
```

**Pendiente: ejecutar el CI completo en GitHub después de que el usuario publique
el cambio. No hay commit ni push de esta intervención.**
