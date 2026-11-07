# Fase 22 — Portal público (backend)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_22.md` y de `shared-types/public-listing.ts` (el contrato HTTP que ya consume `apps/portal`). Rama `feature/fase-22-portal-publico`, **encadenada sobre `feature/fase-25-inventario`**. Hecha **sin supervisión**. Decisiones D-133 a D-140 y supuestos A-104 a A-110 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño llamaba A-46 a A-49 a los cuatro primeros).

## Qué quedó construido

**Migraciones**

- `add_property_listing_fields`: `properties.listing_price` (`Decimal(14,2)` null), `listing_currency` (`Currency`, default `ARS`), `public_description` (`VarChar(2000)` null) e índice `(tenant_id, status, created_at)`.
- `add_public_inquiries`: enums `PublicInquiryStatus` (`NEW | CONTACTED | CLOSED`) y `PublicInquirySource` (`PORTAL`), tabla `public_inquiries` con cuatro índices y FK a `tenants`. Declarada en `auditable-models.ts` (tenant-scoped, auditada, `ip` fuera del historial).

**Propiedades (módulo `properties`)**: `listingPrice`, `listingCurrency` y `publicDescription` en el dominio, el repositorio, los comandos de alta y edición y los DTOs de resumen y ficha (y por lo tanto en `openapi.json`). `PropertyPolicy.normalizeListingPrice` / `normalizePublicDescription`. `PropertiesFacade` suma `listPublic`, `getPublic`, `publicFilters` y `publicRef` (D-134), apoyadas en `PublicPropertyViews` (lista blanca) y en tres métodos nuevos del repositorio (`listPublic`, `findPublicById`, `publicFilterOptions`).

**Tenants**: `TenantsFacade.findActiveBySlug` (slug a `PublicTenantRef`; inactiva o inexistente: `null`) y `defaultCurrency()`.

**Módulo `src/modules/public`**:

| Capa             | Piezas                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain`         | `public-inquiry.ts` (estados, tope de 5 por hora), `public-inquiry.policy.ts` (honeypot, normalización, límite), `public.exceptions.ts`, `public.ports.ts`                                                                                                   |
| `application`    | `public-tenant-scope.ts` (slug a tenant, D-135), `public.commands.ts` / `public.handlers.ts` (contacto, cambio de estado, aviso al personal), `public.queries.ts` (listado, ficha, filtros, consultas), `public.views.ts`, `public-inquiry-created.event.ts` |
| `infrastructure` | `PublicInquiryRepositoryImpl`, `PublicController` (sin JWT), `InquiriesController` (personal), `public.dtos.ts`, `PublicModule`                                                                                                                              |

Depende de `PropertiesFacade` y `TenantsFacade` por sus públicos; `NotificationsService` y `EmailPort` son globales. Nadie depende de `public`, así que `public/` sólo exporta el módulo.

## Endpoints

Públicos (sin token, `{ success, message, data }`, la inmobiliaria sale del `slug`):

| Ruta                                                                                                  | Respuesta                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /public/:slug/properties?locationId=&propertyTypeId=&priceFrom=&priceTo=&currency=&page=&limit=` | `Paginated<PublicPropertySummary>`, sólo `AVAILABLE`, más nuevas primero                            |
| `GET /public/:slug/properties/:id`                                                                    | `PublicPropertyDetail`; 404 `PROPERTY_NOT_AVAILABLE`                                                |
| `GET /public/:slug/filters`                                                                           | `PublicFilters` (tipos y ubicaciones en uso)                                                        |
| `POST /public/:slug/contact`                                                                          | 201 `{ id }`; honeypot lleno: 201 sin guardar; 409 `PROPERTY_NOT_AVAILABLE`; 429 al 6.º en una hora |

Del personal (admin y empleado, JWT): `GET /inquiries?status=&propertyId=&page=&limit=` (`Paginated<PublicInquiry>`) y `PATCH /inquiries/:id/status` (`{ status }`).

Errores: 404 `TENANT_NOT_FOUND`, `PROPERTY_NOT_AVAILABLE`, `PUBLIC_INQUIRY_NOT_FOUND`; 409 `PROPERTY_NOT_AVAILABLE` (contacto); 429 `RATE_LIMIT_EXCEEDED`; 400 de validación.

## Seguridad de lo público

- Lista blanca de campos (D-134): nada de propietario, contrato, notas internas, estado ni claves de storage. Un unit test lo verifica sobre el JSON.
- El tenant sale del slug y se fija con `runInTenant` (D-135): el filtro de Prisma hace el aislamiento. Slug inexistente o inactivo: 404.
- Anti-spam (D-136): honeypot, 5 por hora por IP y por email contados en la tabla, y `@Throttle` (lecturas 60/min, contacto 20/hora).
- La IP guardada sólo sirve para el límite: no sale por la API ni va al historial de auditoría.

## Aviso al personal

`SubmitPublicInquiryHandler` publica `PublicInquiryCreatedEvent`; `NotifyStaffOnInquiryHandler` llama a `NotificationsService.notifyStaff` (tipo `PUBLIC_INQUIRY`, entidad `PublicInquiry`, link `/crm`; aparece en `GET /automations/alerts` y en la campana) y manda un email al contacto de la inmobiliaria (`tenants.email`) con `replyTo` al consultante (D-137).

## Desvíos respecto de `public-listing.ts`

Ninguno en la forma de las respuestas. Tres cosas a saber: `bedrooms`, `bathrooms` y `areaM2` salen siempre `null` porque la propiedad no los carga (D-139); `PublicContactRequest.phone` es opcional en la entrada (el formulario puede mandarlo vacío); y `locationId` filtra por coincidencia exacta (D-138). Tampoco hay flag de publicación (D-133).

## Tests

- Unitarios: política de consultas (honeypot, normalización, límite), handlers (honeypot, 429 por IP y por email, 409, aviso y email con fallos tolerados, cambio de estado, 404), vistas públicas (contrato, lista blanca, "Consultar", barrio) y política de propiedades (precio y descripción).
- E2E `test/public.e2e-spec.ts` (24 casos): campos de publicación en el backoffice, listado y ficha sin token, propiedad no disponible oculta y de vuelta, filtros y paginación, aislamiento entre inmobiliarias (listado, ficha, filtros, consultas, alertas), slug inexistente o inactivo, contacto, honeypot, rate limit (6.º y ventana), 409 y validaciones, consultas del personal y 429 de lecturas con el throttler prendido.

## Mapa de supuestos

| Rediseño | Backend |
| -------- | ------- |
| A-46     | A-104   |
| A-47     | A-105   |
| A-48     | A-106   |
| A-49     | A-107   |
