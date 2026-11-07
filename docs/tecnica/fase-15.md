# Fase 15 — Generación de PDFs (backend)

Sin spec previa: sale del rediseño `adminprop-repo-files/docs/REDISENO_FASE_15.md` (PRD §23, PDF-01 a PDF-05). Rama `feature/fase-15-pdf`, **encadenada sobre `feature/fase-13-cron`**. Hecha **sin supervisión**. Decisiones D-103 a D-110 y supuestos A-31 a A-35 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño los llamaba A-28 a A-31, pero la Fase 13 ya ocupó A-28 a A-30: se renumeraron).

## Qué quedó construido

### Plataforma: `PdfRendererPort` (`src/platform/pdf`)

`render(definition: PdfDocumentDefinition): Promise<Buffer>`. La definición es datos puros (encabezado de marca, bloques `title | heading | paragraph | keyValues | table | spacer`, marca de agua, líneas de pie). Adapter `PdfmakePdfAdapter` (`PDF_PROVIDER=pdfmake`, único valor; A-31): JS puro, Roboto embebida, **sin acceso a internet ni al disco** salvo las fuentes (el logo viaja como `data:`). Si el diseño final exige HTML/CSS se suma un adapter Chromium detrás del mismo puerto.

### Inmobiliarias: datos legales, marca y logo (migración `add_tenant_legal_data`)

`tenants` suma razón social, CUIT, dirección, teléfono, email, WhatsApp, titular/banco/CBU/alias, `document_footer`, `logo_key` y `receipt_sequence` (más columnas de auditoría). `GET/PATCH /tenants/current/settings` (admin, `TenantSettingsDto` / `UpdateTenantSettingsDto`), `POST/DELETE /tenants/current/logo` (PNG, JPG, WebP o SVG hasta 2 MB; formato por bytes, no por `Content-Type`; el logo anterior se borra del storage), `GET /tenants/current` y `GET /tenants/by-slug/:slug` suman `whatsapp`, `phone`, `email`, `address`. `TenantsFacade.branding`, `updateLegalData`, `nextReceiptNumber`.

### Tabla `generated_documents` (migración `add_generated_documents`)

`kind` (`SETTLEMENT | OWNER_STATEMENT | PAYMENT_RECEIPT | TERMINATION_NOTICE`), `entity_id`, `version`, `status` (`PENDING | READY | FAILED`), `storage_key`, `url`, `size_bytes`, `error`, `generated_at`, `requested_by_id`, `data_snapshot` jsonb. Con tenant y auditoría (el snapshot no va al diff), sin borrado lógico. Único `(tenant, kind, entity_id, version)`; índices `(tenant, kind, entity_id, status)` y `(tenant, status, created_at)`.

La misma migración agrega: `payments.receipt_number` (**único por tenant**), `receipt_pdf_key`, `receipt_pdf_url`; `settlements.pdf_key/pdf_url`; `owner_statements.pdf_key/pdf_url`; `contracts.termination_pdf_key/termination_pdf_url`. Las escribe `documents` **sólo por la facade** del módulo dueño.

### Módulo `src/modules/documents` (D-103 a D-109)

| Capa                    | Piezas                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`                | `document.ts` (enums, `GeneratedDocument`, los `*DocumentData`: JSON puro, montos string, fechas `AAAA-MM-DD`), `document.ports.ts` (`GeneratedDocumentRepository`), `document.exceptions.ts`                                                                                                                                                                         |
| `application/templates` | `settlement`, `owner-statement`, `payment-receipt`, `termination-notice` + `format.ts` (montos por texto, nunca `number`) + `layout.ts`. Funciones puras `(data, branding, generatedOn) => PdfDocumentDefinition`                                                                                                                                                     |
| `application`           | `DocumentDataBuilder` (arma el JSON desde las facades y llama a la `attach*` del dueño), `DocumentBrandingResolver` (marca + logo embebido; si el logo falla se omite), `DocumentGenerator` (versiona, renderiza, sube, adjunta, marca `READY`; `fail` deja `FAILED` y avisa), `DocumentAccess`, handlers CQRS (`GetDocument`, `ListDocuments`, `RegenerateDocument`) |
| `infrastructure`        | repositorio, `DocumentEventsConsumer` (pg-boss), `DocumentsController`, DTOs                                                                                                                                                                                                                                                                                          |

**Flujo**: evento → cola → `DocumentEventsConsumer` → `DocumentGenerator.generate` → `DocumentDataBuilder.build` (facades) → idempotencia por `data_snapshot` → plantilla → `PdfRendererPort` → `StoragePort.upload` (`documents/<carpeta>/<entityId>-<versión>.pdf`, bajo `tenants/<tenantId>/`) → en una transacción `attach*` del dueño + `READY`.

| Documento            | Disparo                                                                                               | Cola de documentos                                        | Se guarda en                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SETTLEMENT`         | `settlement-confirmed`                                                                                | `settlement-confirmed-documents`                          | `SettlementsFacade.attachDocument` → `settlements.pdf_url`                    |
| `OWNER_STATEMENT`    | `statement-closed`                                                                                    | `statement-closed-documents`                              | `SettlementsFacade.attachStatementDocument` → `owner_statements.pdf_url`      |
| `PAYMENT_RECEIPT`    | `payment-confirmed` (`kind = CASH_IN`) y `payment-voided` (nueva versión con marca de agua `ANULADO`) | `payment-confirmed-documents`, `payment-voided-documents` | `BillingFacade.attachReceipt` → `payments.receipt_pdf_url`                    |
| `TERMINATION_NOTICE` | `contract-terminated` (nuevo)                                                                         | `contract-terminated`                                     | `ContractsFacade.attachTerminationDocument` → `contracts.termination_pdf_url` |

### Cambios en otros módulos

- **Liquidaciones**: `SettlementsFacade.settlementForPdf/statementForPdf` (ya existían), `attachDocument`, `attachStatementDocument`, `settlementOwnerId`, `statementOwnerId`. `SettlementSummaryDto.pdfUrl`, `OwnerStatementSummaryDto.pdfUrl`. Los relays de `settlement-confirmed` y `statement-closed` publican también en la cola `-documents` (D-104).
- **Cobros**: `PaymentReceipts` (datos del recibo con nombres resueltos y el saldo restante **a la fecha del pago**; numeración). `BillingFacade.paymentForReceipt` (reserva el número si el pago es un `CASH_IN` confirmado y no lo tiene), `attachReceipt`, `receiptOwner`. `PaymentDto.receiptNumber` y `receiptPdfUrl`. Los relays de pago confirmado/anulado publican también en las colas `-documents`.
- **Contratos**: `ContractTerminatedEvent` + `RelayContractTerminatedHandler` → cola `contract-terminated` (`public/contract-events.ts`); `TerminateContractHandler` lo emite después de la transacción. `TerminationDocuments` / `ContractsFacade.terminationForPdf`, `attachTerminationDocument`, `parties`. `ContractDetailDto.terminationPdfUrl`.
- **Propietarios / inquilinos**: `OwnerContact.nationalId`; `idForPortalUser(userId)` en ambas facades (autorización de descarga).

## Endpoints

| Método | Ruta                                            | Rol                                                     | Qué hace                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/documents/:kind/:entityId`                    | admin, empleado, propietario y inquilino (sólo lo suyo) | `GeneratedDocumentDto` del vigente (`READY`): 200. Si todavía no hay `READY`, la versión más nueva: **202** con `PENDING`, o 200 con `FAILED` (el `error` sólo lo ven admin y empleado). 404 `DOCUMENT_NOT_FOUND` si nunca se pidió o no es del usuario. `kind` inválido: 400 |
| POST   | `/documents/:kind/:entityId/regenerate`         | admin                                                   | Crea la versión siguiente `PENDING`, la encola en `document-regenerate` y responde **202**. 404 si la entidad no existe                                                                                                                                                       |
| GET    | `/documents?kind=&entityId=&status=&page&limit` | admin                                                   | `Paginated<GeneratedDocumentDto>`, todas las versiones, más nuevas primero                                                                                                                                                                                                    |

Autorización de descarga (D-108): personal, todo. Propietario: sus liquidaciones, sus consolidados y la rescisión de sus contratos. Inquilino: los recibos de sus pagos y la rescisión de su contrato. Cualquier otra cosa se responde como un 404, para no revelar que existe.

## Tests

- Unitarios: plantillas (títulos, filas, totales, marca de agua, sin cotización cuando no corresponde), formatos de dinero/fecha/período, `DocumentGenerator` (versión 1, evento repetido sin duplicar, datos distintos o `force` → versión siguiente sin pisar el archivo, documento que no aplica, fallo definitivo + `DOCUMENT_FAILED`, reintento que reusa la versión `FAILED`).
- `test/documents.e2e-spec.ts` (renderiza de verdad, baja el archivo servido y verifica `%PDF`): recibos numerados `R-00000001/2`, anulación → versión 2, liquidación y consolidado (con `pdfUrl` en sus fichas), rescisión (con `terminationPdfUrl`), regeneración sin pisar, permisos, validación, aislamiento entre inmobiliarias y autorización de portales.

## Para tener en cuenta

- `npm run openapi:export` regenera `openapi.json` (el contrato que consume el frontend).
- Reintentos: 3 más, cada 30 s con backoff (`retryLimit/retryDelaySeconds` de las colas `-documents`). El mensaje que agota los reintentos se da por consumido tras dejar `FAILED`: la dead-letter no se llena con lo que ya está registrado.
- Un fallo antes de crear la fila (la entidad ya no existe) también deja una fila `FAILED` y el aviso al personal.
