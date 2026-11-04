# Revisión de código — Fase 21 (ETL de migración)

> Rama revisada: `feature/fase-21-migracion` (commit `2660712`), en el worktree `review/fase-21`.
> Referencias: `specs/fase-21-migracion-etl.md` y `docs/REDISENO_FASE_21.md` (adminprop-repo-files), `docs/DECISIONES_TECNICAS.md` D-157 a D-172 y `CLAUDE.md` del backend.
> Convención de este informe: **[V]** = verificado leyendo el código (con archivo:línea); **[C]** = verificado corriendo algo; **[I]** = inferido (no se pudo comprobar en esta sesión).

## Veredicto

**Aprobada con cambios.** La arquitectura es sólida y respeta la forma pedida: análisis y confirmación en dos pasos sobre el mismo lote, todo por facades, transiciones de estado atómicas, `retryLimit: 0` donde corresponde, errores inesperados que no se filtran, key de Tokko que no sale en logs ni mensajes. El aislamiento de tenant está bien resuelto (ver sección de tenant). No encontré fugas entre tenants ni path traversal.

Lo que **no** dejaría pasar a producción sin tocar:

1. **Doble importación**: dos lotes `READY` del mismo archivo (o de Tokko), confirmados los dos, duplican propiedades (no hay unicidad en base) porque la confirmación no vuelve a mirar los vínculos (B1).
2. **SSRF en la descarga de fotos**: el chequeo de host se saltea con una redirección y no cubre varios rangos (IPv6 mapeado, link-local, DNS que resuelve a IP privada) (B2).
3. **Zip bomb / memoria** al leer el `.xlsx`: 10 MB comprimidos pueden inflarse a gigas; además el recorrido por `rowCount` crea filas vacías (B3).
4. **`TOKKO_API_KEY` es una sola variable de entorno para todas las inmobiliarias** (A1): en cuanto haya un segundo tenant con `TOKKO_SOURCE=http`, su admin importa el stock de la cuenta de Oppido. Es una decisión de producto (requiere guardar la key por tenant, cambia el schema), queda como pendiente.

## Alcance y límites de esta revisión

- **Fase 24 (backend): no se revisó.** La rama `feature/fase-24-tasacion` **no existe en el remoto** (`git ls-remote --heads origin` solo lista `feature/fase-21-migracion` y `feature/fase-22-portal-publico` entre las fases 21 a 24). Lo único de la 24 que se miró es el contrato del frontend (sección "Contrato de la Fase 24").
- **No había Doppler, variables de entorno ni base real**; se usó el Postgres local (`adminprop_test`). `TOKKO_SOURCE=http` nunca se probó contra Tokko: todo lo de la fuente HTTP se leyó y se probó con `fetch` simulado.
- No se tocó `src/modules/crm/` ni `src/modules/listings/`.

## Tenant: dónde se miró y qué se encontró

- **[V]** Los cuatro modelos nuevos están en `MODEL_BEHAVIOUR` con `tenantScoped: true` (`auditable-models.ts:220-223`) y todos los repositorios usan `prisma.db` (la extensión suma `tenantId` a toda lectura, `update`, `updateMany`, `delete` y completa el alta; falla cerrado sin tenant en el contexto: `tenant.extension.ts`).
- **[V]** No hay `prisma.unscoped` ni `runInTenant` dentro de `src/modules/migration`, `src/platform/tokko` ni en el job `discard-stale-import-batches.job.ts` (el único `runInTenant` del área está en `indices-fetch.job.ts` y `job-scheduler.ts`, que son de la Fase 13).
- **[V]** `import_links` tiene `@@unique([tenantId, source, entity, externalKey])` (`schema.prisma`, modelo `ImportLink`): el mismo DNI en dos tenants no choca.
- **[V]** Las colas llevan el tenant y el usuario en el envelope (`queue-envelope.ts`), no en el payload; un mensaje sin tenant falla cerrado (`TenantContextMissingError`). El payload `{batchId, jobId}` de otro tenant sería un lote inexistente.
- **[V]** Las facades de otros módulos (`OwnersFacade`, `PropertiesFacade`, etc.) usan los repositorios del propio módulo, que son del tenant del contexto. `UsersFacade.describe` (autores del lote) también.
- **[V]** El e2e `test/migration.e2e-spec.ts` cubre: lote ajeno 404 en todos los endpoints y "el mismo DNI en dos inmobiliarias no es un conflicto".
- **Salvedad**: `PropertiesFacade.listForImport` (`properties.facade.ts:163-179`) trae **todas** las propiedades del tenant (`listAll({})`) y filtra en memoria. No filtra de más (es del tenant), pero es O(tamaño de la cartera) en cada análisis (mejora C4).
- Único punto global: `TOKKO_API_KEY` (A1).

---

## 1. Incumple la spec o el rediseño

**A1. La key de Tokko es global, no por inmobiliaria** [V] — `src/shared/config/configuration.ts:339-342`, `src/platform/tokko/tokko.module.ts:23-30`. El rediseño §4.1 lo define así (`TOKKO_API_KEY` de Doppler), pero choca con la regla multi-tenant del CLAUDE.md ("lo que varía por tenant vive en `Tenant` o en datos") y con la spec §1 (activar por tenant con `FeatureFlagPort`; el módulo no usa `FeatureFlagPort` en ningún lado). Con un segundo tenant, `POST /migration/tokko/analyze` de ese tenant trae el stock de la cuenta Tokko de Oppido: fuga entre tenants por configuración. **Arreglo**: guardar la credencial por tenant (cifrada) y construir el `TokkoSourcePort` por pedido, o mientras tanto exponer el endpoint de Tokko detrás de un flag por tenant. **No se arregla acá**: cambia el schema y es decisión de producto (pendiente P1).

**A2. Auditoría: no existe `bulk_import` y las decisiones por fila no quedan auditadas** [V] — spec §5 pide `@Audit('bulk_import')`. D-167 documenta el desvío (se usa `JOB_RUN`, razonable porque no existe el decorador). Lo que sí falta: `PATCH /migration/batches/:id/rows/:rowId` (excluir una fila o elegir `MERGE_EMPTY_FIELDS`) no deja rastro (`ImportRow` tiene `audit: false`, `auditable-models.ts:221`; `migration.handlers.ts:206-209`). `MERGE_EMPTY_FIELDS` es la única decisión que modifica registros existentes, y quién la eligió y para qué fila solo se reconstruye por el `defaultConflictResolution` del lote. Las altas y los `fillEmptyFields` sí se auditan en sus módulos con el usuario de quien confirmó. **Arreglo**: registrar un `JOB_RUN` (o similar) por cambio de resolución, o resumir en el evento de confirmación las filas con resolución propia (pendiente P5; chico pero toca el payload de auditoría).

**A3. La clave de storage del `.xlsx` no lleva el tenant** [V] — `migration.handlers.ts:119` guarda `migrations/${batch.id}.xlsx`; el rediseño §2 pide `migrations/<tenantId>/<batchId>.xlsx`. El UUID no es adivinable y el acceso va por lote (tenant-scoped), así que es riesgo bajo, pero deja sin prefijo para limpiar/auditar por tenant en el bucket. Se deja (cambiar la clave afecta el e2e y archivos ya subidos).

**A4. La regla "nunca se importa un duplicado de lo existente" solo se verifica al analizar** [V] — spec §5 y criterio §7.3. El análisis detecta el conflicto, pero entre el análisis y la confirmación puede pasar hasta 7 días (A-79) y la confirmación no vuelve a chequear nada (`import-executor.ts:209-240`). Ver B1.

**A5. Validaciones "las mismas que la carga manual" incompletas (CBU)** [V] — rediseño §3.2. `validateOwner` solo exige 22 dígitos; la carga manual (`OwnerPolicy`, `owner.policy.ts:53`) además valida los dígitos verificadores. `OwnersFacade.isValidCbu` existe (`owners.facade.ts:149`) y nadie lo usa. Resultado: el preview marca la fila `VALID` y la confirmación la deja `FAILED` (el lote termina `PARTIAL`). Ver B8.

Cumple y se verificó leyendo: dryRun obligatorio (no hay "importar directo"), `ConfirmImportRequest` con `excludeRowIds`, filas `ERROR` nunca se importan (`import-executor.ts:146-149`), `MERGE_EMPTY_FIELDS` solo completa vacíos (`fill-empty-fields.ts`), 10 MB y 5.000 filas, plantilla con versión, hojas faltantes avisadas, archivo borrado al confirmar/descartar/vencer/fallar (`import-executor.ts:193`, `batch-discarder.ts:43-52`, `analysis-runner.ts:590`), fotos solo por `StoragePort` (nunca se guarda la URL externa como foto), foto fallida no revierte la propiedad.

---

## 2. Riesgos y bugs (de mayor a menor)

### Alta

**B1. Doble importación (dos lotes `READY` del mismo origen)** [V] — `import-executor.ts:237-239` (`create` sin re-chequeo) y `import-link.repository.impl.ts:31-40` (`createMany` con `skipDuplicates: true`).
Escenario: se sube el mismo Excel dos veces antes de confirmar (o se corre dos veces el análisis de Tokko). Los dos lotes salen con todas las filas `VALID` porque ninguno tiene vínculos todavía. Se confirma el primero (crea todo, deja vínculos) y después el segundo: `importRow` vuelve a crear porque solo mira `row.status`. El `skipDuplicates` hace que el vínculo duplicado no falle, así que **nada avisa**. Propietarios/inquilinos fallan solos si el alta valida DNI único [I: no se leyó el handler de alta de cada módulo], pero **las propiedades no tienen unicidad en base** (`schema.prisma`, modelo `Property`, solo índices) y se duplican. Contradice la idempotencia del rediseño §1 ("segundo pasaje → todo `ALREADY_IMPORTED`").
**Arreglo (hecho en esta revisión, F1)**: antes de crear una fila `VALID`, consultar `links.findTargets` por su clave de enlace; si ya está vinculada, marcarla `ALREADY_IMPORTED` con el `targetId` existente y no crear nada. Pendiente (P2) un re-chequeo de "existe una igual cargada a mano" al confirmar, que requiere decidir si se re-clasifica el lote.

**B2. SSRF en la descarga de fotos** [V] — `src/platform/tokko/adapters/http-image-downloader.ts`:

- `:94-97` usa `redirect: 'follow'`: el host se valida solo para la URL inicial. Una foto en un host público que responda `302 → http://169.254.169.254/...` o `http://localhost:6379/` se sigue sin chequeo (la respuesta no se guarda si no es imagen, pero el pedido sale igual; con un servidor que devuelva `Content-Type: image/png` y un cuerpo cualquiera, el contenido termina como "foto" en el storage).
- `:21-40` `isInternalHost` no cubre: IPv6 mapeado a IPv4 (`[::ffff:127.0.0.1]`, que `URL` normaliza a `::ffff:7f00:1`), link-local `fe80::/10`, `::`, `100.64.0.0/10` (CGNAT), `198.18.0.0/15`, `192.0.0.0/24`, multicast/reservados.
- No se resuelve el DNS: un dominio público que apunte a `127.0.0.1` (`*.nip.io`, o un registro propio) pasa.
  **Arreglo (hecho, F2)**: seguir las redirecciones a mano (máx. 3), revalidando cada salto; ampliar los rangos (IPv4 e IPv6, incluido el mapeado); resolver el nombre con `dns.lookup(all)` y rechazar si alguna dirección es interna. Queda el TOCTOU del DNS rebinding entre la resolución y el `fetch` (fijar la IP en el socket requiere un `Agent` propio: mejora C2).

**B3. Zip bomb y memoria al leer el Excel** [V] — `src/modules/migration/application/excel-reader.ts`:

- `:67` `workbook.xlsx.load(buffer)` infla todo el zip en memoria sin límite. El tope de 10 MB es del archivo comprimido; un `.xlsx` de 10 MB puede traer gigas de XML. Corre en el request (`migration.handlers.ts:109`, para validar) **y otra vez** en la cola (`analysis-runner.ts:604`), bloqueando el event loop de la API.
- `:112` `for (rowNumber = 3; rowNumber <= worksheet.rowCount; ...)` con `worksheet.getRow(n)`: una hoja con una celda suelta en la fila 1.048.576 hace ~1M iteraciones y `getRow` **crea** cada fila vacía (memoria y CPU), antes de que corte el tope de 5.000 filas con datos (que cuenta solo filas con datos).
  **Arreglo (hecho, F3)**: inflar cada entrada del zip con un tope (`zlib.inflateRawSync` con `maxOutputLength`) _antes_ de pasarle el archivo a exceljs, y rechazar zip64, más de 500 entradas o estructura rota; no alcanza con sumar los tamaños declarados porque se pueden falsear (JSZip recién compara el tamaño real al terminar de inflar, `jszip/lib/compressedObject.js:37`). Además se recorren solo las filas que existen (`eachRow`). Límite elegido: 50 MB descomprimidos (una plantilla llena de 5.000 filas ocupa bien por debajo). Sigue pendiente (C3) pasar a lectura en streaming y no parsear dos veces.

### Media

**B4. Descarga sin tope de lectura y sin validar la firma** [V] — `http-image-downloader.ts:117-134` y `properties.facade.ts:218-225`. `response.arrayBuffer()` lee todo el cuerpo antes de comparar con los 10 MB (si no viene `content-length`, o miente, se bajan cientos de MB dentro de los 15 s); el `Content-Type` lo manda el servidor remoto y nunca se verifica contra los primeros bytes (el alta manual sí usa `detectFileKind`, `shared/files/file-signature.ts`). Un host que sirva HTML/SVG como `image/jpeg` termina guardado y servido desde el storage propio. **Arreglo (hecho, F4)**: leer el cuerpo por streaming con tope y derivar el tipo de la firma (`detectFileKind`), ignorando el `Content-Type` remoto.

**B5. Lotes que quedan trabados sin salida** [V] — D-166 reconoce que un `IMPORTING` cuyo proceso se corta queda así, pero hay más casos:

- `migration.handlers.ts:117-135` y `:165-171`: el lote se crea, el archivo se sube, y recién después se publica en la cola; si `queue.publish` o `jobs.start` lanzan, queda un lote `ANALYZING` para siempre y el archivo huérfano en el storage.
- `ConfirmImportHandler` (`:249-297`) pasa el lote a `IMPORTING`, hace hasta 5.000 `update` secuenciales de exclusiones y recién después publica: si algo falla en el medio, queda `IMPORTING` sin job.
- `AnalysisRunner` no se recupera de un crash del proceso (`ANALYZING` eterno). Un lote en `ANALYZING`/`IMPORTING` no se puede confirmar ni descartar (409), y la limpieza de A-79 solo mira `READY` (`import-batch.repository.impl.ts:204-209`).
  **Arreglo (parcial, hecho F5)**: si falla el encolado, el lote pasa a `FAILED` con un mensaje y se borra el archivo. **Pendiente (P3)**: un barrido para lotes `ANALYZING`/`IMPORTING` sin actividad (hace falta un latido o un `updated_at` que se toque durante el trabajo largo; sin eso se podría matar un import legítimo).

**B6. La corrida de importación no se "reclama"** [V] — `import-executor.ts:93-102` solo mira que el lote esté `IMPORTING`. pg-boss entrega al menos una vez: dos consumidores (redelivery, dos instancias) podrían procesar el mismo lote a la vez. Con `retryLimit: 0` es poco probable, pero no está excluido; el único amortiguador es B1 (que ahora se corrige) y las validaciones de DNI. **Pendiente (P4)**: guardar un `claimed_at`/`run_id` (schema).

**B7. Tokko sin tope de páginas ni de filas** [V] — `tokko-http.source.ts:97-110` corta solo cuando una página viene vacía; si la API ignora `offset` y repite la página, el análisis no termina y acumula candidatos para siempre. `import-analyzer.ts:243` usa `Infinity` cuando no hay `limit`. Además el listado de filas pagina en memoria asumiendo "tope de 5.000" (`import-row.repository.impl.ts:365-376`), que no vale para Tokko. **Arreglo (hecho, F6)**: cortar si una página repite el primer id, con un máximo de páginas. Un tope de filas para Tokko queda como decisión (P6).

**B8. El preview deja pasar CBUs que la carga manual rechaza** [V] — ver A5. **Arreglo (hecho, F7)**: `ValidationContext` recibe `isValidCbu` (de `OwnersFacade`) y `validateOwner` lo usa.

**B9. Datos personales en `import_rows.data` sin retención** [V] — `ImportRow.data` guarda DNI/CUIT, teléfono, email, domicilio y CBU en claro y nada lo purga (A-79 borra el archivo, no las filas): los lotes `COMPLETED`, `FAILED` y `DISCARDED` los conservan indefinidamente. Es staging, pero es el único lugar con CBU por duplicado fuera de la tabla de propietarios. Decisión de producto (P7: purgar `data` al confirmar/descartar/vencer).

### Baja

**B10. Rate limit solo el global** [V] — el controlador no define `@Throttle`; rige el perfil global (10/s, 120/min, 2.000/h por usuario, `docs/RATE-LIMITING.md`). `excel/analyze` (10 MB, parseo, inserta hasta 5.000 filas) y `tokko/analyze` (golpea una API externa con pausas) son caros y se pueden lanzar muchos en paralelo; tampoco hay tope de lotes simultáneos por tenant. **Arreglo (hecho, F8)**: `@Throttle` más estricto en `excel/analyze`, `tokko/analyze`, `confirm` y `assets/retry`. El tope de concurrencia por tenant queda en P8.

**B11. Archivo huérfano si el borrado falla** [V] — `batch-discarder.ts:43-52` y `import-executor.ts:515-524` ponen `fileKey = null` aunque `storage.delete` haya lanzado: el archivo queda en el bucket sin referencia. Bajo impacto (se loguea un warn); pendiente de decidir si se reintenta.

**B12. Propiedades de Tokko con la misma `fake_address` se saltean en silencio** [V] — `import-analyzer.ts:130-131` (`propertyKey`) y `:598-610`: Tokko publica con dirección aproximada y esa dirección se repite entre propiedades distintas; la segunda queda `CONFLICT/DUPLICATE_IN_FILE` y, por defecto, `SKIPPED`. Pierde propiedades reales sin que nadie lo note. Decisión de producto (P9): para Tokko la clave natural debería ser el id de Tokko, no la dirección.

**B13. Detalles menores**

- [V] `GET /jobs/:id/status` lo puede leer también el empleado (`@Roles(ADMIN, EMPLOYEE)`); para los jobs de migración solo expone contadores y `{batchId, rows}`. Sin impacto.
- [V] `FileInterceptor` sin `limits.files/fields/parts` (`migration.controller.ts:120-122`): multer acepta campos de texto arbitrarios hasta el límite del body parser. Bajo.
- [V] Errores que filtran información: no encontré. Los 500 inesperados se muestran como "error inesperado" (`user-message.ts`); la key de Tokko nunca sale (`tokko-http.source.ts:140-149`); los mensajes de fila repiten el valor de la celda del propio usuario.
- [V] Inyección de fórmulas: el módulo no genera CSV. El reporte `.xlsx` escribe strings como strings compartidos (no fórmulas) y el exportador CSV existente ya neutraliza `= + @ -` (`exceljs.report-exporter.ts:110-115`; no neutraliza tab/CR iniciales, menor). No requiere arreglo acá.
- [V] Path traversal: no hay. El nombre del archivo subido solo se usa para mostrar (`displayName`, sin carpetas, 255 caracteres) y la clave de storage sale del UUID del lote.

### Qué pasa si se cae a la mitad (resumen) [V]

- Durante el análisis: el `catch` deja el lote `FAILED`, borra las filas y el archivo. Si el proceso muere: `ANALYZING` eterno (B5).
- Durante la importación: cada fila es independiente (crear, vincular, marcar). Si el proceso muere entre `create` y `link`, la entidad queda creada sin vínculo y la fila sigue `VALID`; al re-analizar el mismo archivo aparece como conflicto con lo existente (se saltea, sin duplicar). Por eso B1/F1 es el mínimo de seguridad. No hay transacción por fila que abarque alta + vínculo (el rediseño §5 decía "una transacción por fila"; las altas pasan por `CommandBus` de otros módulos, así que no es trivial).

---

## 3. Mejoras opcionales

- **C1.** Auditoría por cambio de resolución de fila y un campo `batchId` en el contexto de auditoría de las altas individuales (D-167 dice que comparten `correlationId`, no `batchId`).
- **C2.** Fijar la IP resuelta en el socket de la descarga (`Agent` con `lookup` propio) para cerrar el DNS rebinding.
- **C3.** Leer el Excel con la API de streaming de exceljs, y parsear una sola vez (hoy se parsea en el request y otra vez en la cola).
- **C4.** `PropertiesFacade.listForImport` debería filtrar por ubicación en la consulta, no traer toda la cartera.
- **C5.** `ImportRowRepository.list` pagina en memoria; pasar a paginación en base cuando entren lotes de Tokko grandes.
- **C6.** Latido del job largo (`updated_at` de cada tanda) para poder recuperar lotes trabados (P3).
- **C7.** Una prueba unitaria directa de `ImportExecutor` (hoy solo se prueba por e2e).
- **C8.** Incluir `tenantId` en la clave de storage del `.xlsx` (A3).

---

## Contrato de la Fase 24 (frontend) — todo **[I]**

La rama del backend de la Fase 24 no existe, así que lo que sigue es lo que el frontend **asume** del backend, leído en `packages/shared-types/src/valuation.ts` y `apps/backoffice/src/lib/valuation-api.ts`, y contrastado con `docs/REDISENO_FASE_24.md` §6-7:

| El frontend llama                                                          | Coincide con el rediseño |
| -------------------------------------------------------------------------- | ------------------------ |
| `POST /valuation/properties/:propertyId/appraise` (201, `ValuationResult`) | sí                       |
| `GET /valuation/properties/:propertyId/history?page&limit`                 | sí                       |
| `GET /valuation/market-coverage?locationId=`                               | sí                       |
| `GET /valuation/market-status`                                             | sí                       |
| `POST /valuation/zones/refresh` (admin, 202)                               | el frontend no lo usa    |

Observaciones:

- **[I]** `valuation.ts` está "escrito a mano hasta regenerar desde el OpenAPI" (comentario del archivo), lo que contradice la regla del CLAUDE.md del frontend ("tipos del contrato HTTP: se generan desde el OpenAPI"). Aceptable mientras el backend no exista; hay que regenerarlo cuando la rama 24 se publique y diffear contra `MarketSource`, `ValuationEngine` y `MarketSourceStatus`.
- **[I]** `Money` e `IsoDateTime` vienen de `common.ts`; los montos son string, como pide la regla de dinero. `areaM2` también viaja como string decimal.
- **[I]** El enum `MarketSource` incluye `"FAKE"`: si el backend lo devuelve en producción, la UI lo mostraría; confirmar que solo exista en fixtures.
- **[I]** `ValuationResult.reused` y el 422 `INSUFFICIENT_MARKET_DATA` dependen de A-67 del rediseño; no hay forma de verificar que el backend los implemente igual.
- No se revisó el backend de la 24 ni se corrieron tests del frontend.

---

## Lista de arreglos, en orden

Aplicados en esta rama (un commit por arreglo, cada uno con su test):

| #   | Arreglo                                                                              | Hallazgo     |
| --- | ------------------------------------------------------------------------------------ | ------------ |
| F1  | La confirmación no recrea lo ya vinculado (marca `ALREADY_IMPORTED`)                 | B1 / A4      |
| F2  | Descargador de fotos: redirecciones revalidadas, más rangos internos, resolución DNS | B2           |
| F3  | Lectura del Excel: límite de inflado del zip y recorrido solo de filas existentes    | B3           |
| F4  | Descarga con tope por streaming y tipo por firma del archivo                         | B4           |
| F5  | Si falla el encolado, el lote queda `FAILED` y se borra el archivo                   | B5 (parcial) |
| F6  | Tokko: corta ante una página repetida y tope de páginas                              | B7           |
| F7  | CBU con dígitos verificadores en el preview                                          | B8 / A5      |
| F8  | `@Throttle` en los endpoints pesados                                                 | B10          |

Pendientes (grandes, tocan schema o necesitan decisión de producto):

- **P1** Credencial de Tokko por tenant (y flag por tenant) — A1.
- **P2** Re-chequear "existe uno igual cargado a mano" al confirmar (hoy solo vínculos) — A4.
- **P3** Barrido de lotes `ANALYZING`/`IMPORTING` trabados, con latido — B5.
- **P4** Reclamo atómico de la corrida de importación (`claimed_at`/`run_id`) — B6.
- **P5** Auditar cada cambio de resolución/exclusión de fila — A2.
- **P6** Tope de filas para Tokko y paginación en base — B7/C5.
- **P7** Retención/purga de `import_rows.data` (datos personales y CBU) — B9.
- **P8** Tope de lotes simultáneos por tenant — B10.
- **P9** Clave natural de las propiedades de Tokko = id de Tokko — B12.
- **P10** Clave de storage con tenant — A3.

## Qué se corrió de verdad

Todo en el worktree `review/fase-21`, con Postgres local (`adminprop_test`) y sin Doppler.

| Qué                                                                     | Resultado                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                                                      | limpio (corrido antes de cada commit y al final)                                                                |
| `npm run lint:check`                                                    | limpio (corrido antes de cada commit)                                                                           |
| `npx jest` (todos los unitarios)                                        | 78 suites, 724 tests, todos verdes                                                                              |
| `test/migration.e2e-spec.ts` completo                                   | 32 de 32 verdes, **después** de F1 a F8; más el e2e nuevo (33 de 33 en total al sumarlo, corrido solo con `-t`) |
| e2e nuevo "dos lotes del mismo archivo" contra el executor **anterior** | **falla** (recreaba todo): confirma que B1 era un bug real y que F1 lo corrige                                  |

Lo que **no** se corrió:

- Los demás e2e (`settlements`, `audit`, `automations`, etc.): no se tocó nada de esos módulos y el pedido era un e2e por vez; el de `automations` cuenta el job de limpieza de lotes, que no cambió.
- Contra la API real de Tokko, Cloudinary ni DNS real: la descarga de fotos se probó con `fetch` y resolución de DNS simulados. El `dns.lookup` real y el comportamiento de `redirect: 'manual'` en el `fetch` de Node (undici) se leyeron, no se ejecutaron contra la red.
- Que los tests nuevos de F3 (zip bomb y fila 1.048.576) fallen contra el código anterior: se verificó solo para B1. Para F2/F4 el comportamiento viejo se desprende del código leído.
- Nada del frontend (ni los tests ni la pantalla de migración).
