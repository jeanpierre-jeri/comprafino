# Recorrido de compra en móvil — prompt 13A

Fecha: **16 de octubre de 2026, America/Lima**. Revisión local del recorrido buscar → abrir producto → guardar selección → editar cantidad/frecuencia → recargar lista → revisar plan. Base del repositorio `2db06b7` más los cambios locales de esta sesión. **04A continúa aplazado.** No se publica ni se modifica producción.

## Resultado

El recorrido conserva el producto elegido, su intención y cantidad al navegar, editar y recargar. El precio del producto guardado y el plan sugerido tienen bases diferentes y deben seguir mostrándolas. Se corrigieron dos problemas de presentación reproducidos:

1. **El detalle de compras heredaba el desplazamiento de la comparación.** En 320 × 568, al bajar hasta el plan de tres tiendas y elegirlo, el mismo popup cambiaba de contenido conservando su scroll. El título «Compras por supermercado» y el cierre quedaban fuera de vista. La regresión registró un `viewport ratio 0` para el título. El panel ahora vuelve al inicio al abrirse o cambiar de vista, conservando el scroll de la página y la lista.
2. **Faltaba explicar la diferencia entre importe del plan y precios individuales.** El caso original de H06 sigue mostrando S/ 60 para un plan de una tienda y S/ 10 en cada una de tres filas. Es una diferencia legítima entre escenarios, no un error del optimizador. La explicación visible ahora indica que el importe depende de las tiendas del plan y puede diferir de los precios individuales de la lista.

El cambio de aplicación se limita a [BasketComparison](../../apps/web/src/components/basket-comparison.tsx): una referencia al contenedor del diálogo, un efecto de layout ligado al estado del panel y la explicación del importe. No cambia precios, elegibilidad, matching, cantidades, elección de productos, persistencia ni evaluación de canastas. No añade componentes, dependencias, caché o infraestructura.

## Revalidación del prompt 06

La convención actual mantiene **«Precio de tu compra»** en la fila y **«Plan de ahorro sugerido»** en el resumen. El plan expone las compras y alternativas que utiliza; no reemplaza la selección guardada. La solución anterior de forzar las filas a seguir cada plan ya no resulta adecuada para esta interfaz.

Dos escenarios reales de fixtures comprueban esa separación:

| Escenario                                     | Precio de las filas | Importe del plan                    | Qué debe conservarse                                                                                         |
| --------------------------------------------- | ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tres productos estrictos, una tienda          | S/ 10 por producto  | S/ 60                               | Identidades y precios individuales; explicación de que el plan utiliza sus tiendas asignadas.                |
| Los mismos tres productos, hasta tres tiendas | S/ 10 por producto  | S/ 30                               | Cambia el plan y su desglose, sin reescribir los productos guardados.                                        |
| Dos paquetes del SKU independiente de Metro   | S/ 99,80            | S/ 29,80, con alternativa de Tottus | `listingId`, nombre, dos paquetes, intención `preferred` y frecuencia; la alternativa queda dentro del plan. |

La regresión de tres productos confirma además que editar una cantidad actualiza la comparación y conserva el límite de tiendas seleccionado. El recorrido nuevo compara el documento completo de localStorage antes y después de cambiar el plan: debe permanecer idéntico. La discrepancia de precios queda explicada, no eliminada alterando las reglas.

La comprensión por parte de personas reales sigue pendiente. Una etiqueta y una prueba automatizada no acreditan por sí solas que el usuario interprete correctamente el ahorro o el coste de visitar tiendas.

## Cobertura local y evidencia visual

Se reutiliza Chromium y el harness PostgreSQL existente, con `TEST_DATABASE_URL` local explícito y esquema aleatorio propio. El build precede al navegador. No se usan cuentas reales, migraciones remotas ni solicitudes de adquisición. El nuevo recorrido bloquea las peticiones HTTPS externas; las imágenes ausentes muestran el fallback existente.

| Revisión               | Alcance                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pantalla estrecha      | 320 × 568 y 390 × 568, temas claro y oscuro.                                                                                                                 |
| Interacción móvil      | Contexto Chromium con `hasTouch` e `isMobile`; navegación y acciones principales por `tap`.                                                                  |
| Búsqueda y detalle     | Abrir el SKU independiente desde su tarjeta, verificar URL y título, agregar desde el detalle.                                                               |
| Edición y persistencia | Pasar de uno a dos paquetes, cambiar a cada dos semanas, recargar y comprobar SKU, nombre, cantidad, modo e intención.                                       |
| Foco                   | Campo de paquetes al abrir, devolución al botón Editar tras guardar, devolución a Ver plan tras cerrar.                                                      |
| Tamaños y overflow     | Botón Editar de al menos 44 × 44, diálogo dentro del viewport y ausencia de desbordamiento horizontal en las etapas verificadas.                             |
| Cambio de plan         | Seleccionar el límite de tres tiendas desde el final de la comparación; título y cierre deben quedar dentro del viewport del nuevo detalle.                  |
| Cierre                 | Toque en Cerrar diálogo en tema claro y Escape en oscuro.                                                                                                    |
| Controles existentes   | Casos de canasta incompleta, beneficios/condiciones, sustituciones, error y reintento, teclado, animaciones y reducción de movimiento de la suite existente. |

Los cinco casos de referencia ejecutados antes de los cambios pasaron. El nuevo recorrido inicial también conservó los datos en sus cuatro variantes. Al agregar la comprobación de título visible se reprodujo el fallo de scroll; la comprobación mejorada de H06 confirmó los importes originales y falló por la explicación ausente. Las dos correcciones se verifican después del nuevo build con esos mismos escenarios y la suite completa.

La evidencia ignorada por Git queda en `.artifacts/mobile-13a/`: `before/` conserva capturas y traza del scroll anterior; `scroll-before.log` registra el título fuera de viewport; `h06-before.log`, la explicación ausente. Las capturas posteriores, el build y los resultados finales se conservan junto a los logs de unitarias y E2E. Playwright también genera capturas en `apps/web/test-results/`, que pueden reemplazarse en la próxima ejecución.

Se inspeccionaron capturas de editor, lista y plan. En el detalle corregido, el encabezado y el cierre aparecen al inicio, mientras los productos permanecen accesibles mediante el scroll normal del popup. La revisión de escritorio se conserva en los casos de 1280 px de la suite existente.

## Guion pendiente con 3–5 personas

La validación humana sigue pendiente. Este apartado es un protocolo para que el responsable lo use cuando tenga participantes; no se enviaron invitaciones ni se hicieron sesiones durante esta tarea. Los commits locales de 13A y de las tareas posteriores no demuestran por sí mismos que esos cambios estén publicados.

### Preparación y moderación

- Invitar a 3–5 personas que compren alimentos o productos del hogar. No necesitan ser usuarios actuales. Pedirles que usen un teléfono y aclarar que se evalúa la interfaz, no a la persona. La participación es voluntaria; no recopilar nombres, correos, credenciales ni datos de compra reales.
- Antes de cada sesión, anotar la versión que se probará y confirmar que el entorno, la cuenta de prueba y el catálogo corresponden a esa versión. Preferir un entorno de prueba con datos de ejemplo. No cambiar producción para preparar una sesión. Si solo está disponible producción, no hacer cambios destructivos ni usar una cuenta o lista con información personal; detenerse si no se puede mantener esa separación.
- Reservar 10–15 minutos y tener abierta la lista de tareas de abajo. Dejar el teléfono en manos de la persona; observar sin tomarlo ni indicar dónde tocar. Leer cada consigna tal como está escrita, en orden, y dejar que la persona decida qué hacer.
- Mientras trabaja, guardar silencio unos segundos antes de intervenir. Si se atasca, usar una pregunta neutral: «¿Qué esperabas que pasara?» o «¿Qué te gustaría hacer ahora?». No nombrar botones, explicar conceptos ni corregir una interpretación hasta terminar la tarea. Si la persona pide ayuda, dar solo la mínima necesaria y anotarlo como ayuda requerida.
- Después de la tarea de importes, preguntar primero «¿Cómo llegaste a esa conclusión?» y registrar sus palabras. Solo al acabar todas las tareas, aclarar cualquier diferencia entre el producto elegido y el plan sugerido.
- Anotar conductas y frases observadas, no suposiciones sobre lo que la persona pensó. No grabar audio o video ni tomar capturas identificables. Al cerrar, agradecer y eliminar cualquier dato temporal de prueba que se haya creado.

### Tareas para leer en voz alta

1. **Buscar y elegir:** «Encuentra un producto que comprarías y abre la información que usarías para decidir». Observar si distingue su presentación, tienda y disponibilidad.
2. **Guardar:** «Añádelo a tu lista para comprar dos paquetes cada dos semanas». Observar si entiende preferido frente a estricto y la unidad paquetes.
3. **Editar y recargar:** «Sal de la lista y vuelve a abrirla; cambia la cantidad y comprueba que se conserva al recargar». Registrar dudas o pérdida aparente de estado.
4. **Explicar los importes:** «Dime cuánto cuesta tu producto guardado y qué comprarías siguiendo el plan sugerido». Pedir que lo explique con sus palabras antes de aclarar conceptos. Observar si distingue el precio del producto seleccionado del importe y las tiendas del plan.
5. **Comparar visitas:** «Revisa una y varias tiendas y elige qué harías». Comprobar si abre el desglose, reconoce alternativas y distingue ahorro en productos del esfuerzo de visitar otra tienda.
6. **Cerrar y retomar:** «Vuelve a tu lista sin aplicar otra selección». Observar si encuentra el cierre, mantiene el contexto y reconoce su producto original.

No pedir que provoque errores ni que use una lista real. Si una tarea no puede completarse por falta de datos de ejemplo, un fallo del entorno u otra causa externa, registrarla como bloqueada y describir la causa; no sustituirla por una explicación del moderador.

### Ficha breve por sesión

Completar una copia de esta ficha por persona. Usar un código (P1, P2…) y no incluir datos que la identifiquen. Registrar la versión y el entorno exactos que se observaron; si se desconocen, anotarlo en vez de inferirlos.

```text
Sesión: P__                 Fecha:
Versión/build:              Entorno: (prueba / local / otro):
Dispositivo/navegador:       Cuenta y datos: (prueba / otro, sin identificadores)

Tarea                         Resultado (completa / parcial / bloqueada)
Buscar y elegir:              Duda o frase observada:
Guardar:                      Duda o frase observada:
Editar cantidad y recargar:   ¿Qué esperaba? ¿Qué necesitó?
Importes y plan sugerido:     ¿Qué importe creyó que era el suyo y por qué?
Una o varias tiendas:         ¿Qué entendió del desglose o las visitas?
Volver a la lista:            ¿Conservó el producto elegido?

Ayuda del moderador: (ninguna / mínima; describir exactamente)
Fricción concreta observada:
¿Afectó a completar la tarea o entender una decisión? ¿Cómo?
Notas sin datos personales:
```

### Elegir una sola corrección

Al terminar las sesiones, agrupar observaciones que describan el mismo problema y conservar ejemplos concretos. Priorizar una única corrección que:

1. se haya observado en al menos dos sesiones independientes, o haya impedido a una persona completar una tarea importante;
2. afecte buscar, elegir, guardar, editar/recargar o entender qué representan el producto elegido y el plan sugerido; y
3. tenga una causa visible en la interfaz que pueda corregirse sin alterar selección, precios, disponibilidad, matching, elegibilidad ni reglas de comparación.

Si varias observaciones cumplen el criterio, elegir la que impida más directamente completar el recorrido o interpretar los importes con seguridad. Si ninguna lo cumple, no inventar una corrección: conservar las observaciones como evidencia y dejar el recorrido sin cambios. Antes de implementar, describir el problema observado, las sesiones que lo respaldan y el cambio mínimo propuesto; esta guía no autoriza por sí sola a modificar código.

Una confusión repetida orienta la siguiente corrección; no se convierte el guion en una métrica de éxito inventada ni se presenta una muestra pequeña como representativa de todos los usuarios.

## Límites y comprobaciones

Se trata de emulación de viewport y eventos táctiles en Chromium, no de un teléfono físico. No se verificaron WebKit/Safari, teclado virtual del sistema, zoom nativo, lectores de pantalla reales, checkout ni red móvil. No se amplía la matriz de motores ni se optimizan imágenes sin un fallo o medición que lo justifique. El fallback de imágenes bloqueadas del recorrido no es una medición de rendimiento de imágenes.

Se consultaron las guías de la versión instalada de Next sobre accesibilidad y frontera de componentes, y la documentación oficial de [shadcn Dialog](https://ui.shadcn.com/docs/components/base/dialog), [Button](https://ui.shadcn.com/docs/components/base/button) y [Base UI Dialog](https://base-ui.com/react/components/dialog). La consulta CLI desde `packages/ui` encontró un alias `hooks` sin resolver; desde la raíz obtuvo las URLs correctas. No se cambió la configuración del paquete para resolver una consulta documental.

| Comprobación          | Resultado                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formato y referencias | `pnpm format:check`, `pnpm docs:check` y `git diff --check` pasan.                                                                                    |
| Lint y tipos          | `pnpm lint` y `pnpm typecheck` pasan.                                                                                                                 |
| Unitarias y contratos | `pnpm test`: 931 pasan (558 core, 98 db, 200 scrapers y 75 contratos web); una de las cuatro tareas reutiliza caché de Turbo.                         |
| Build                 | `pnpm build` pasa después de las dos correcciones y antes de Chromium.                                                                                |
| Chromium con fixtures | `pnpm test:e2e:fixtures:local`: repetición completa con 89 aprobadas y ocho omitidas (1,4 min); incluye el nuevo recorrido en cuatro variantes y H06. |

La primera suite completa registró 88 aprobadas, ocho omitidas y un fallo al quitar un producto de cuenta en otra pestaña (`auth.spec.ts:100`). Su repetición aislada pasó (1/1). Se conserva el fallo, su traza y snapshot en `.artifacts/mobile-13a/auth-failure/`, además de `e2e.log` y `auth-recheck.log`. No se atribuye a la corrección del popup ni se declara resuelta una causa de sincronización que no se ha demostrado. La repetición completa pasó, incluida la prueba de cuenta, y queda en `e2e-recheck.log`; no se añaden reintentos automáticos, esperas fijas ni cambios de sincronización para ocultarlo.

Las ocho omisiones requieren un catálogo persistido de aplicación, deliberadamente excluido del entorno controlado: seis de `public-search.spec.ts`, una de navegación de comparación y una de filtros de tema. Las búsquedas, detalles y filtros con fixtures propias sí se ejecutan. No se repiten benchmarks del catálogo o del hosting ni se aplican cambios remotos.

El protocolo de validación humana queda preparado, pero sus resultados siguen pendientes hasta que el responsable realice sesiones y complete las fichas. La muestra 08A ya se documentó en su propio reporte y commit local; no se asume que esos cambios ni los de 13A estén publicados. Mantener 04A aplazado.
