# Fase 21 — Migración de datos / ETL (backend)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_21.md` (manda sobre la spec) y de `shared-types/migration.ts` del frontend (el contrato HTTP). Rama `feature/fase-21-migracion`, **encadenada sobre `feature/fase-14-notificaciones`**. Hecha **sin supervisión**. Decisiones D-157 a D-172 y supuestos A-125 a A-131 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño tiene sus propios A-70 a A-79).

> **La corrida real con datos de Oppido no está hecha**: falta `TOKKO_API_KEY` de la cuenta de Oppido en Doppler y el Excel que vuelque Micaela en la plantilla. Todo se probó con la muestra incluida (`TOKKO_SOURCE=fixture`) y con Excel generados a partir de la propia plantilla. Con la key pública de prueba (`TOKKO_SOURCE=http`) funciona de punta a punta con datos demo; con la de Oppido no cambia una línea.

## Qué quedó construido

**Migración `add_migration`**

- Enums `ImportSource`, `ImportBatchMode`, `ImportBatchStatus`, `ImportEntity`, `ImportRowStatus`, `ImportResolution`, `ImportAssetStatus`.
- Tablas, todas con `tenant_id`: `import_batches` (**auditada**), `import_rows` (staging: la fila normalizada en `data`, errores, conflicto, resolución, `target_id`), `import_links` (único `(tenant_id, source, entity, external_key)`: lo que hace idempotente la corrida) e `import_asset_results` (una fila por foto de Tokko). Las tres últimas son bitácora técnica y no se auditan: las altas reales se auditan en el módulo de cada entidad.
- `properties.needs_review` (+ índice `(tenant_id, needs_review)`).

**Platform `src/platform/tokko`**

- `TokkoSourcePort` (`dictionaries`, `locationsSummary`, `properties`) con `TokkoHttpSource` (la lógica de `tokko_scraper.js`: páginas de 20, pausa de 400 ms, backoff ante 429/5xx, timeout; la key viaja en la query pero jamás en un log ni en un mensaje de error) y `TokkoFixtureSource` (muestra reducida de 6 propiedades con los casos borde, pasada por el mismo mapper). `tokko-mapper.ts` concentra el mapeo de la respuesta de `property/search`.
- `ImageDownloaderPort`: `HttpImageDownloader` (timeout de 15 s, dos reintentos sólo ante fallas transitorias, `image/jpeg|png|webp`, 10 MB, rechaza URLs que no sean http(s) o apunten a hosts internos) y `FixtureImageDownloader` (devuelve un PNG de 1×1 para ver el flujo completo sin red).
- `TokkoModule` (`@Global`) elige adapters por `TOKKO_SOURCE`.

**Cambios en otros módulos (siempre por su `public/`)**

| Módulo      | Facade                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owners      | `findForImport(dnis)`, `isValidCbu`, `createFromImport`, `fillEmptyFields`                                                                                                               |
| renters     | `findRentersForImport`, `createRenterFromImport`, `fillEmptyRenterFields`, y lo mismo para garantes (`findGuarantorsForImport`, `createGuarantorFromImport`, `fillEmptyGuarantorFields`) |
| properties  | `listForImport(locationIds)`, `createFromImport`, `fillEmptyFields`, `addPhotoFromImport`; filtro y campo `needsReview`                                                                  |
| contracts   | `listForImport(propertyIds)`, `createFromImport` (vía `ContractImporter`), `fillEmptyFields`                                                                                             |
| master-data | `listLocationNodes`, `listCatalogItems`, `ensureCatalogItem`, `ensureLocationPath`, `ensureUnknownLocation`                                                                              |

Cada `*FromImport` despacha el **comando de alta del propio módulo** por el `CommandBus`: mismas validaciones y misma auditoría que la carga manual (D-158). Los repositorios de propietarios, inquilinos y garantes suman `findByNationalIds`.

**Módulo `src/modules/migration`**

| Capa             | Piezas                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | tipos de fila y lote, `import-normalizers` (dinero `1.234,56`/`1234.56` → `Decimal`, fechas `dd/mm/aaaa`, claves de dirección y de ruta), `location-index` (resuelve rutas `Provincia > Ciudad > Barrio` sin tocar la base), `row-validators` (puros, un error por `{ field, code, message }`), `template-definition`, puertos, excepciones |
| `application`    | `ExcelTemplateService`, `ExcelReader`, `ImportAnalyzer` (Excel y Tokko), `AnalysisRunner`, `ImportExecutor`, `AssetMigrator`, `ImportReportService`, `BatchDiscarder`, vistas y handlers CQRS                                                                                                                                               |
| `infrastructure` | repositorios Prisma, `MigrationController`, `MigrationConsumer` (colas `migration-analyze`, `migration-import`, `migration-assets`)                                                                                                                                                                                                         |
| `public`         | `MigrationModule`, `MigrationFacade.discardStaleBatches`                                                                                                                                                                                                                                                                                    |

## Flujo

1. **Analizar.** `POST /migration/excel/analyze` (multipart `file`) valida en el pedido formato, versión de la plantilla y cantidad de filas (422 `INVALID_XLSX`, `TEMPLATE_VERSION_MISMATCH`, `IMPORT_TOO_MANY_ROWS`; 413 por tamaño), guarda el `.xlsx` con `StoragePort` (`migrations/<lote>.xlsx`, la URL en `options.fileUrl`), crea el lote `ANALYZING` y el `AsyncJob`, y responde **202** `{ batchId, jobId }`. `POST /migration/tokko/analyze` hace lo mismo sin archivo. El worker arma las filas: valida, resuelve maestros contra el árbol del tenant, busca vínculos previos (`ALREADY_IMPORTED`), duplicados dentro del archivo y colisiones con lo cargado (`CONFLICT`), y deja el lote `READY` con el resumen (`missingSheets`, `mastersToCreate`). **No crea ninguna entidad ni maestro.** Si algo falla (key de Tokko inválida, archivo ilegible) el lote queda `FAILED` con `errorMessage` y **sin filas parciales**.
2. **Revisar.** `GET /migration/batches/:id` y `/rows` (filtros por entidad, estado y `needsReview`); `PATCH .../rows/:rowId` para excluir una fila o elegir `SKIP`/`MERGE_EMPTY_FIELDS` en un conflicto, sólo mientras el lote está `READY`.
3. **Confirmar.** `POST .../confirm` pasa el lote `READY → IMPORTING` con un `updateMany` condicional (dos pedidos a la vez: uno gana, el otro 409 `BATCH_ALREADY_CONFIRMED`), marca las exclusiones y encola la importación. El worker recorre las filas en el orden **propietarios → garantes → inquilinos → propiedades → contratos**, una por una; las `ERROR` se omiten solas, una que falla queda `FAILED` y no frena a las demás. Cada fila importada deja su vínculo. El lote termina `COMPLETED`, o `PARTIAL` si quedó alguna fila con `ERROR` o `FAILED`. El `.xlsx` subido se borra del storage.
4. **Fotos** (si `migrateAssets`). Terminadas las filas se crea un `ImportAssetResult` por foto y un `AsyncJob` aparte `migration-assets`: concurrencia 3 entre propiedades, en orden dentro de cada una (la portada de Tokko va primera). Una foto que falla queda `FAILED` con el motivo y no revierte la propiedad. **Mientras se bajan las fotos el lote sigue `IMPORTING`** (la pantalla consulta el lote hasta que deja de estarlo) y al terminar vuelve a su estado final, guardado en `summary.finalStatus`. `POST .../assets/retry` (202 `{ jobId }`) reintenta sólo las fallidas: vuelve a poner el lote en `IMPORTING` (cambio atómico) y lo devuelve a su estado final al terminar; mientras hay fotos en curso responde 409 `ASSETS_IN_PROGRESS`. Las URLs externas no se guardan nunca como foto.
5. **Descartar** (`POST .../discard`) y limpieza: el job `migration.discard-stale-batches` (03:30, catálogo de automatizaciones) descarta los `READY` de más de 7 días desde su creación y borra el archivo.

## Reglas

- **Nunca pisa lo cargado a mano** (A-72). Un registro existente sólo se toca con `MERGE_EMPTY_FIELDS`, que completa campos vacíos (`fillEmptyFields` en `shared/core`) y jamás reemplaza un valor. En una fusión no se crean maestros ni se suman amenities; en contratos sólo se completan las notas. Un duplicado dentro del archivo (`DUPLICATE_IN_FILE`) siempre se omite.
- **Idempotente.** El vínculo es `(source, entity, external_key)`: la clave natural normalizada en Excel (DNI/CUIT; propiedad = dirección normalizada + ruta de ubicación; contrato = propiedad + DNI del inquilino + inicio) y el id de Tokko. Subir dos veces el mismo archivo da todo `ALREADY_IMPORTED` y cero cambios.
- **Contratos** (A-74): fechas pasadas permitidas; fin anterior a hoy → `FINISHED` sin tocar propiedad ni inquilino; **nunca se generan cuotas** (el job de cobros las crea por período, no el alta). Un segundo contrato vigente sobre la misma propiedad (o del mismo inquilino) es error `CONTRACT_OVERLAP` / `RENTER_ALREADY_ACTIVE`; una propiedad sin propietario, `PROPERTY_WITHOUT_OWNER`.
- **Maestros desconocidos** (tipo, amenity, ubicación) no son error: se crean al confirmar por nombre normalizado, una sola vez (A-73). Una ubicación de un solo nombre que no existe sí es error (no se sabe dónde crearla): hay que escribir la ruta.
- **Propiedad sin ubicación** (Tokko): ubicación comodín «Sin ubicación (revisar)» (provincia bajo el país, se crea una vez) y `needs_review = true`. Cambiar la ubicación desde el backoffice limpia la marca.
- Montos siempre `string`/`Decimal` (`parseMoney` → `toMoneyString`); nunca `number`.

## Endpoints (admin; `{ success, message, data }`)

`GET /migration/excel/template`, `POST /migration/excel/analyze` (202), `POST /migration/tokko/analyze` (202), `GET /migration/batches`, `GET /migration/batches/:id`, `GET /migration/batches/:id/rows`, `PATCH /migration/batches/:id/rows/:rowId`, `POST /migration/batches/:id/confirm` (202), `POST /migration/batches/:id/discard`, `POST /migration/batches/:id/assets/retry` (202), `GET /migration/batches/:id/report.xlsx`. El avance de cualquier trabajo: `GET /jobs/:id/status` (genérico).

Errores: 403 `TOKKO_NOT_ENABLED` (API real de Tokko desde una inmobiliaria que no es la de `TOKKO_TENANT_ID`, D-253); 404 `IMPORT_BATCH_NOT_FOUND` (también de otra inmobiliaria), `IMPORT_ROW_NOT_FOUND`; 409 `BATCH_NOT_READY`, `BATCH_ALREADY_CONFIRMED`, `BATCH_NOT_IMPORTED`, `ASSETS_IN_PROGRESS`; 422 `INVALID_XLSX`, `TEMPLATE_VERSION_MISMATCH`, `IMPORT_TOO_MANY_ROWS`, `INVALID_RESOLUTION`.

## Plantilla

Hojas **Instrucciones**, **Propietarios**, **Garantes**, **Inquilinos**, **Propiedades**, **Contratos**, más **Listas** (oculta, con los maestros del tenant y los enums en español) y **Meta** (muy oculta, `template_version`). Fila 1 = encabezados fijos (el lector los busca por texto: el orden de las columnas no importa), fila 2 = ejemplo en gris que se ignora. Desplegables de Excel para tipo, ubicación, moneda, índice, frecuencia, modalidad de cobro y tipo de garantía. Tope: 5.000 filas y 10 MB.

## Variables de entorno

`TOKKO_SOURCE` (`fixture` por defecto | `http`) y `TOKKO_API_KEY` (sólo con `http`; vacía en Doppler hasta tener la de Oppido; no se valida al arrancar, el análisis falla con un mensaje claro si falta o es inválida). Ninguna más.

## Desvíos respecto de `migration.ts` y del rediseño

- `ImportBatchDetail` suma `errorMessage: string | null` (aditivo): la pantalla tiene que poder mostrar por qué falló un lote. `ImportRowDto.conflict` expone solo `entityId`, `reason` y `differingFields` (el `kind` interno no sale).
- `POST .../confirm` devuelve el `jobId` de la **importación**; el trabajo de fotos es otro `AsyncJob` cuyo avance se ve en `assets` del detalle del lote (el `jobId` solo se devuelve en `assets/retry`).
- Hoja **Garantes** suma «Tipo de garantía» y «Detalle de la garantía» (D-159) y **Contratos** no trae «Día de vencimiento» (no existe por contrato en el modelo; es una regla de la inmobiliaria).
- La auditoría usa eventos `JOB_RUN` sobre `ImportBatch` y el diff automático de Prisma, no una acción `bulk_import` nueva (D-167).

## Tests

- Unitarios: normalizadores (dinero, fechas, claves), `LocationIndex`, validadores de fila de las cinco hojas, `ExcelReader` (orden de columnas, fila de ejemplo, versión, tope de filas), `fillEmptyFields`, adapters de Tokko (mapper, fixture, HTTP con reintentos y sin filtrar la key) y el descargador de fotos (tipos, tamaño, 404, timeout, SSRF).
- E2E `test/migration.e2e-spec.ts`: permisos (empleado 403), plantilla, análisis que no crea nada, filtros, hoja ausente, 422 de formato/versión, 413, confirmación en orden con maestros nuevos, contratos activos y terminados, idempotencia, conflicto con lo cargado a mano (SKIP no modifica nada; MERGE solo completa vacíos), resolución y exclusión por fila, doble confirmación, dependencias omitidas, reporte `.xlsx`, descarte, limpieza de vencidos, aislamiento entre inmobiliarias (404 y mismo DNI en dos tenants), Tokko (dry-run, límites, comodín y `needsReview`, segundo pasaje, propiedad cargada a mano, fuente caída) y fotos (una caída no revierte la propiedad, reintento, sin `migrateAssets`).

## Mapa de supuestos

El rediseño ya numera A-70 a A-79 (análisis y confirmación sobre el mismo lote, staging, `MERGE_EMPTY_FIELDS`, maestros al confirmar, contratos sin cuotas pasadas, solo alquiler, solo propiedades por Tokko, comodín, límites, vencimiento a 7 días); se implementaron tal cual. A-125 a A-131 son lo que el rediseño no definía.
