# Fase 23 — CRM y multipublicación (backend)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_23.md` (manda sobre la spec) y de los contratos `shared-types/src/crm.ts` y `listings.ts`. Rama `feature/fase-23-crm`, **encadenada sobre `feature/fase-24-tasacion`**. Hecha **sin supervisión**. Decisiones D-183 a D-194 y supuestos A-150 a A-157 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño numera A-80 a A-89 y se implementaron tal cual).

> **Estado de verificación**: los tests unitarios y e2e están escritos pero **no se corrieron** en esta tanda; `tsc --noEmit`, `eslint`, `prisma validate` y la exportación de OpenAPI sí. El adapter de Mercado Libre no se probó contra el servicio real (A-86). La migración no se aplicó a una base.

## Qué quedó construido

### Migración `add_crm_and_listings`

- `public_inquiries` (modelo `PublicInquiry`): reemplaza `status` por `stage` (`CLOSED` pasa a `CLOSED_LOST`, A-81), suma `stage_changed_at`, `board_position`, `assigned_to_id`, `next_action_at` (date), `last_contact_at`, `lost_reason`, `closed_at`, `contract_id`, `external_id` (único por `tenant, source, external_id`) y `deleted_at`; `email` y `phone` opcionales con `CHECK` (uno de los dos, salvo orígenes de portal); `source` suma `MERCADOLIBRE | ZONAPROP | ARGENPROP | WHATSAPP | PHONE | MANUAL`. La posición inicial ordena por antigüedad dentro de cada columna.
- Tablas nuevas: `inquiry_activities`, `property_views` (único `tenant, property, day`), `listing_channels` (único `tenant, channel`; tokens cifrados) y `property_listings` (único `tenant, property, channel`).
- `auditable-models.ts`: `PublicInquiry` pasa a borrado lógico (con `externalId` en `mutateOnDelete`); `InquiryActivity` y `PropertyView` sin auditoría; `ListingChannelAccount` y `PropertyListing` auditadas, sin los tokens en el diff.

### Módulo `src/modules/crm`

| Capa             | Piezas                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `inquiry.ts` (etapas, orígenes, constantes), `inquiry.policy.ts` (cambio de etapa, posición entre vecinos, renumeración, conversión, promedios), `listing.ts` (canales, estados, `missingForPublish`, `payloadHash`, transiciones), `listing-publisher.port.ts` (puerto, registro y errores tipados), `crm.ports.ts` (repositorios), `crm.exceptions.ts`                                                                                                   |
| `application`    | `InquiryRegistrar` (único camino de alta), `inquiry.handlers.ts` (alta, edición, mover, asignar, notas, contacto, tablero, lista, detalle, WhatsApp, responsables), `analytics.handlers.ts`, `PropertyViewsRecorder`, `FollowUpReminderService`, `ListingService` + `listing.handlers.ts` (canales, OAuth, publicar, estados, cierre, consultas entrantes), `OAuthStateSigner`, `InquiryNotifier`, `crm.views.ts`, `listing.views.ts`, `listing-queues.ts` |
| `infrastructure` | repositorios Prisma, `CrmController`, `ChannelsController`, `ChannelOAuthController` (callback público), `PropertyListingsController`, DTOs, `ListingConsumer`, `FakeListingPublisher`, `MercadoLibreListingAdapter`, `ConfiguredListingPublisherRegistry`, `CrmModule`                                                                                                                                                                                    |
| `public`         | `CrmFacade`: `registerPortalInquiry`, `countRecentInquiries`, `recordPropertyView`, `sendFollowUpReminders`, `pullChannelInquiries`                                                                                                                                                                                                                                                                                                                        |

### Cambios en otros módulos (siempre por `public/`)

- **Portal público**: usa `CrmFacade`; se retiran `InquiriesController`, `PublicInquiryRepository(Impl)`, `PublicInquiryViews` y los DTOs de estado. La ficha cuenta una vista por IP y propiedad cada 30 minutos.
- **Propiedades**: `PropertiesFacade.getForListing` y `PropertyRentedEvent` (publicado por `attachContract`).
- **Notificaciones**: `NotificationsFacade.renderWhatsApp`; tres tipos nuevos en el catálogo.
- **Automatizaciones**: dos jobs (`crm.follow-up-reminder` 09:15 y `crm.pull-channel-inquiries` 4 veces por día) y los tipos nuevos en la campana.
- **Plataforma**: `src/platform/secrets` (`SecretBoxPort`, AES-256-GCM).
- **Config**: `APP_ENCRYPTION_KEY`, `LISTING_PUBLISHER_PROVIDER`, `BACKOFFICE_BASE_URL`, `MERCADOLIBRE_*` (todas opcionales; `.env.example` y `test/setup.ts`).

## Endpoints

Todos con `{ success, message, data }`, dentro del tenant del token. CRM para admin y empleado; propietarios e inquilinos reciben 403.

| Método | Ruta                                                        | Notas                                                                                                                     |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/crm/pipeline?assignedToId&propertyId&source&q&unassigned` | 6 columnas, `total` y hasta 50 tarjetas por `boardPosition`                                                               |
| GET    | `/crm/inquiries?stage&…&page&limit`                         | Paginado; con `stage` respeta el orden del tablero, sin él, más nuevas primero                                            |
| POST   | `/crm/inquiries`                                            | Carga manual (`WHATSAPP`, `PHONE`, `MANUAL`, `ZONAPROP`, `ARGENPROP`); 422 `INQUIRY_CONTACT_REQUIRED`, `ASSIGNEE_INVALID` |
| GET    | `/crm/inquiries/:id`                                        | Detalle con línea de tiempo; 404 `INQUIRY_NOT_FOUND` (también de otro tenant)                                             |
| PATCH  | `/crm/inquiries/:id`                                        | Nombre, email, teléfono, propiedad, `nextActionAt` (`null` la quita)                                                      |
| PATCH  | `/crm/inquiries/:id/stage`                                  | `beforeId`/`afterId`; `CLOSED_LOST` exige `lostReason` (422 `LOST_REASON_REQUIRED`); reabrir vale                         |
| PATCH  | `/crm/inquiries/:id/assign`                                 | `userId` o `null`; 422 `ASSIGNEE_INVALID` si no es personal activo de la inmobiliaria                                     |
| POST   | `/crm/inquiries/:id/notes`                                  | Máx. 2000; inmutables                                                                                                     |
| POST   | `/crm/inquiries/:id/contact-attempts`                       | Registra la actividad, fija el último contacto y pasa `NEW` a `CONTACTED`                                                 |
| GET    | `/crm/inquiries/:id/whatsapp-link?templateKey`              | `{ url \| null, message }`; plantilla por defecto `INQUIRY_FIRST_CONTACT`; 404 `TEMPLATE_NOT_FOUND`                       |
| GET    | `/crm/assignees`                                            | Personal activo                                                                                                           |
| GET    | `/crm/analytics/overview?from&to`                           | `CrmOverviewDto` (default: 30 días; máx. 366)                                                                             |
| GET    | `/crm/analytics/properties/:propertyId?from&to`             | `PropertyInquiryAnalytics` con serie diaria                                                                               |
| GET    | `/crm/channels`                                             | Tres canales; Zonaprop y Argenprop `UNAVAILABLE` con motivo                                                               |
| POST   | `/crm/channels/mercadolibre/connect`                        | Admin. `{ authorizeUrl }`                                                                                                 |
| GET    | `/crm/channels/mercadolibre/callback?code&state`            | Público; redirige a `/configuracion/canales?connected=mercadolibre` o `?error=`                                           |
| DELETE | `/crm/channels/:channel`                                    | Admin. Borra los tokens; el canal acepta cualquier mayúscula                                                              |
| GET    | `/crm/properties/:propertyId/listings`                      | `PropertyListingDto[]` (un renglón por canal)                                                                             |
| POST   | `/crm/properties/:propertyId/listings/:channel/publish`     | 202 `{ jobId }`; 422 `LISTING_NOT_READY` (`errors[]` con lo que falta), 409 `CHANNEL_NOT_CONNECTED`                       |
| POST   | `…/:channel/retry`                                          | 202; 409 `LISTING_STATE_INVALID` si no está en `ERROR`                                                                    |
| POST   | `…/:channel/pause` · `/resume` · `/close`                   | Síncronos → `PropertyListingDto`; 409 si el estado no lo admite                                                           |

## Flujos

- **Tablero**: ver D-184. Cada movimiento, asignación, edición y seguimiento deja una `InquiryActivity`.
- **Consulta del portal**: `POST /public/:slug/contact` → `CrmFacade.registerPortalInquiry` → `NEW` arriba, sin asignar, actividad `CREATED` → evento de la Fase 22 (campana + email al correo de la inmobiliaria).
- **Publicar**: ver D-190. Estados: `NOT_PUBLISHED → PUBLISHING → PUBLISHED ⇄ PAUSED → CLOSED`, y `ERROR` (reintentar o reconectar).
- **Consultas entrantes**: el job lee `fetchInquiries(desde)` por cada canal conectado, asocia la propiedad por el id externo de la publicación y registra cada consulta con `source = MERCADOLIBRE`, deduplicando por `external_id`.

## Cómo probar sin cuentas externas

Con `LISTING_PUBLISHER_PROVIDER=fake` (default): `POST /crm/channels/mercadolibre/connect` devuelve una URL relativa al callback con `code=fake-code`; abrirla conecta la cuenta simulada. Publicar devuelve ids `FAKE-n` y URLs `https://fake.local/items/<id>`. El estado vive en memoria del proceso.

## Tests (escritos, sin correr)

- Unitarios: `inquiry.policy.spec.ts`, `listing.spec.ts`, `inquiry.handlers.spec.ts`, `listing.service.spec.ts`, `follow-up-reminder.service.spec.ts`, `property-views-recorder.spec.ts`, `oauth-state.spec.ts`, `aes-gcm.secret-box.spec.ts`, `mercadolibre-listing.adapter.spec.ts` (con `fetch` simulado), y `public.handlers.spec.ts` actualizado.
- E2E: `test/crm.e2e-spec.ts` (tablero, orden estable, `CLOSED_LOST`, asignación, notas inmutables, WhatsApp con y sin teléfono, seguimiento, aislamiento entre tenants por id directo, analítica, job de seguimiento), `test/crm-listings.e2e-spec.ts` (OAuth de punta a punta, `state` manipulado, tokens nunca en respuestas, publicar, `LISTING_NOT_READY`, rechazo, token vencido → `ERROR` → reintento, cierre al alquilarse, consultas entrantes), y ajustes a `public`, `automations` (15 jobs; 13 por inmobiliaria) y `notifications` (23 tipos).
- Sin cubrir: la migración sobre datos reales de la Fase 22 (el `CLOSED → CLOSED_LOST`), el adapter real de Mercado Libre contra su API y el comportamiento con varias instancias (el dedupe de vistas es por proceso).
