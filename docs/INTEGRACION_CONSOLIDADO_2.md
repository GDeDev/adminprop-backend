# Integración `integration/consolidado-2`

Rama creada a partir de `origin/integration/consolidado` (ae7cb8e) con seis
ramas mergeadas, una por una, con `git merge --no-ff`. Fecha: 2026-11-04. No se
hizo push. No se usó Doppler ni `--no-verify`.

## Ramas mergeadas (en este orden)

| #   | Rama                                                                                                   | Conflictos      |
| --- | ------------------------------------------------------------------------------------------------------ | --------------- |
| 1   | `feature/web-inmobiliaria-v1-1-api` (trae `feature/web-inmobiliaria-api`, módulo `site`, luxury, sort) | Sí, 16 archivos |
| 2   | `fix/auditoria-datos-backend`                                                                          | Sí, 1 archivo   |
| 3   | `fix/auditoria-seguridad-backend`                                                                      | Sí, 4 archivos  |
| 4   | `fix/auditoria-seguridad-2-backend`                                                                    | Sí, 1 archivo   |
| 5   | `fix/deuda-tecnica-backend`                                                                            | Sí, 1 archivo   |
| 6   | `test/cobertura-dinero-backend`                                                                        | No              |

Después de los merges hay tres commits propios: `chore(openapi)` (openapi.json
regenerado), `fix(crm)` y `test(e2e)` (ver "Fallos que aparecieron").

El mensaje del primer merge quedó con las líneas `# Conflicts:` pegadas al
cuerpo (se commiteó con `--no-edit`); es solo cosmético.

## Conflictos y cómo se resolvieron

### 1. `feature/web-inmobiliaria-v1-1-api`

- **`prisma/schema.prisma`**: la columna de `Property` y los modelos nuevos de
  ambos lados. Se conservaron los campos de la ficha pública del sitio
  (`listingOperation`, `bedrooms`, `bathrooms`, `rooms`, `totalAreaM2`,
  `coveredAreaM2`, `ageYears`, `latitude`, `longitude`, enum `ListingOperation`)
  **y** `needsReview` de la Fase 21; se mantuvieron todos los modelos/enums de
  Fase 21/23/24 y se agregaron al final `SiteTemplateKey`, `SiteSettings` y
  `SiteAsset` (con el aviso del índice parcial). Las relaciones en `Tenant`
  entraron solas. `prisma format` y `validate` OK.
- **`src/shared/config/configuration.ts` y `env.validation.ts`**: se
  conservaron las variables de ambos lados (`tokko`, `valuation`, `security`,
  `listings` + `sites`; `TOKKO_*` + `SITES_*`). Hubo que cerrar a mano las
  llaves de las interfaces/objetos intercalados.
- **`src/shared/prisma/extensions/auditable-models.ts`**: se agregaron
  `SiteSettings` (con `excludeFromDiff` de `draft`/`published`) y `SiteAsset`;
  quedó el comentario nuevo de `PublicInquiry` de la rama base.
- **Módulo `properties`** (domain `property.ts`, `property.ports.ts`,
  `property.views.ts`, `public-property.views.spec.ts`, DTOs, controller,
  repository impl, facade, `add-property-photos.handler.spec.ts`): todo
  aditivo; se mantuvieron `needsReview` y los campos de la ficha del sitio en
  cada punto. En la facade se unieron los imports/exports
  (`ListingOperation`, `PUBLIC_PROPERTY_SORTS`) con `PropertyRentedEvent`,
  `PropertyListingInfo`, etc. de Fase 23.
  - Semántico (no lo marcó git): `PropertiesFacade.createFromImport` (Fase 21)
    ahora debe mandar los campos nuevos de la ficha; se completan en `null`.
- **`docs/DECISIONES_TECNICAS.md`**: ver "Numeración de decisiones".
- **`openapi.json`**: se tomó el lado base y se regeneró al final.

Migraciones: las del sitio son `20261103150000_add_property_listing_extras`,
`20261103151000_add_site_settings`, `20261103160000_add_site_domain_verification`
y `20261104120000_add_site_template_luxury`. No hay colisión de nombres: la
Fase 21 tiene `20261104120000_add_migration`, que ordena antes
(`add_migration` < `add_site_template_luxury`). El orden final aplica limpio
sobre las de Fase 21/23/24 (se probó).

### 2. `fix/auditoria-datos-backend`

- **`src/modules/properties/public/properties.facade.ts`**: la rama cambió
  `toIsoDate` por `localDateOf` (día calendario argentino). Se tomaron los
  imports de la base (Fase 23) y se usó `localDateOf`, como pide la rama.
- Migraciones nuevas: `20261104120000_job_execution_unique_slot` (índice
  parcial único `job_executions_scheduled_slot_key`, **vive solo en SQL**) y
  `20261104121000_add_lookup_indexes`. Ordenan después de las del sitio y de
  `add_migration`.

### 3. `fix/auditoria-seguridad-backend`

- **`any-role.decorator.ts`, `roles.guard.ts`, `roles.guard.spec.ts`**
  (add/add): las dos ramas implementaron `@AnyRole` y un `RolesGuard` que
  cierra por defecto. Se conservó la versión de la base (default-deny estricto,
  también para ADMIN, A-158/D-195) porque es un superconjunto de la de la rama
  (que solo rechazaba a OWNER/RENTER). Se mantuvo el test de arquitectura nuevo
  `controllers-authorization.spec.ts`.
  - Git mezcló solo los `@AnyRole()` de `auth.controller.ts` y
    `tenants.controller.ts` y quedaron duplicados: se restauraron esos dos
    archivos a la versión de la base.
- **`src/shared/config/env.validation.spec.ts`**: tests de ambos lados
  (fuentes de comparables y CORS `*`), se cerraron los `describe`/`it`.
- `configuration.ts`/`env.validation.ts` se mezclaron solos: Swagger solo
  prende en development/test, `SITES_PREVIEW_SECRET` obligatorio y `CORS_ORIGINS=*`
  prohibido fuera de development/test (incluye `qa`).

### 4. `fix/auditoria-seguridad-2-backend`

- **`tenant-settings.handlers.ts`**: ambos lados validan SVG inseguros. Se
  conservó la implementación de la base (`findUnsafeSvgReason`, con el mensaje
  de motivo) y se quitó el import sobrante de `isSafeSvg`. `isSafeSvg` sigue
  usándose en `document-branding.ts` (defensa al renderizar PDFs).
- Variable nueva: `SITES_SERVER_SECRET` (opcional; si falta cae a
  `SITES_REVALIDATE_SECRET`).

### 5. `fix/deuda-tecnica-backend`

- **`pg-boss.queue-adapter.ts`**: dos arreglos del mismo deadlock de
  `create_queue`. Se conservó el de la rama (`declareChain`, con su spec
  `pg-boss.queue-adapter.spec.ts`) y se eliminó el campo `queueSetup` de la
  base.

### 6. `test/cobertura-dinero-backend`

Merge limpio.

## Numeración de decisiones

Las decisiones del sitio nacieron como **D-177..D-202** y **A-137..A-148**
(a continuación de la Fase 14) y chocaban con las de las Fases 21 a 25 y las
auditorías (la base llega a D-199 y A-159). Se renumeraron sumando 23:

- **D-177..D-202 pasan a D-200..D-225**
- **A-137..A-148 pasan a A-160..A-171**

Se aplicó en el bloque del sitio de `docs/DECISIONES_TECNICAS.md` (con una nota
en el encabezado), en `docs/PR-web-inmobiliaria-api.md` y en
`docs/tecnica/web-inmobiliaria.md`. Ningún archivo de código citaba esos
números. Las ramas de auditoría/deuda técnica no agregan numeración propia.
**Revisar a mano**: `docs/funcional/web-inmobiliaria.md` y las docs de las
ramas de auditoría por si citan números viejos (`grep -n "D-1[7-9][0-9]\|D-20[0-2]"`).

## Comandos corridos y resultado

Base propia: PostgreSQL local (`service postgresql start`), rol `integ`, bases
`adminprop_integ` (migrate), `adminprop_integ_shadow` (drift) e `integ_test`
(tests). Se borró y recreó una base llamada `adminprop_test` que existía en el
Postgres local de este contenedor (no era del proyecto real).

- `npx prisma validate` / `format`: OK.
- `npx prisma generate`, `npx tsc --noEmit`, `npm run code:check`: OK después de
  cada merge y al final.
- `npx prisma migrate deploy` sobre base vacía: todas las migraciones aplicadas
  (después del merge 1 y del 2, que agrega migraciones).
- `prisma migrate diff --from-migrations prisma/migrations
--to-schema-datamodel prisma/schema.prisma --shadow-database-url ...`: sin
  diferencias. También `--from-url` de la base migrada: sin diferencias.
  Verificado en `pg_indexes` que `site_settings_custom_domain_verified_key`
  existe (hay un test, `custom-domain-index.spec.ts`, que lo exige).
- `npm run openapi:export`: regenerado y commiteado (el diff es grande porque
  cambia el orden de las rutas; incluye `/site`, `/crm`, `/valuation`,
  `/migration`).
- `npx jest` completo: **132 suites, 1296 tests, todos OK** (antes de los
  commits finales de tests; después se corrieron los unitarios de `crm`: 71 OK).
- e2e, un archivo por vez (`test/jest-e2e.json`, `TEST_DATABASE_URL` propio):
  los 37 archivos. Primera pasada: 33 OK y 4 con fallos (abajo). Tras
  los arreglos, `site`, `automations`, `crm` y `crm-listings` pasan completos.
  `settlements` (9) y `notifications` (37) pasan: los fallos previos de esas
  ramas base quedaron arreglados por `fix/deuda-tecnica-backend`.

## Fallos que aparecieron en los e2e y qué se hizo

| Archivo                                              | Causa                                                                                                                                                                                                                           | Origen                                          | Arreglo                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `site` ("el contacto del sitio crea la consulta...") | leía `/inquiries`, que la Fase 23 movió a `/crm/inquiries`                                                                                                                                                                      | semántico del merge                             | test apunta a `/crm/inquiries`                                      |
| `automations` (2 tests)                              | cuentas viejas: ahora son 13 jobs por inmobiliaria + 2 globales a las 10:00, y a las 12:10 corre además el segundo `crm.pull-channel-inquiries` por tenant; el test de réplicas compartía `singletonKey` global con el anterior | uno ya fallaba en la base; el otro es del merge | conteos actualizados; el test de réplicas usa otro día (2026-10-30) |
| `crm` ("aislamiento...")                             | se creaban 5 requests de supertest por adelantado y el servidor se cerraba tras el primero (ECONNREFUSED)                                                                                                                       | fallaba ya en `integration/consolidado`         | se crean perezosamente                                              |
| `crm-listings` ("token vencido...")                  | **bug real**: `notifyChannelError` guardaba `entity.id = 'MERCADOLIBRE'` en una columna UUID; el INSERT fallaba y el aviso nunca se creaba                                                                                      | fallaba ya en `integration/consolidado`         | se quitó `entity` (commit `fix(crm)`)                               |

Los de `crm`, `crm-listings` y uno de `automations` se confirmaron fallando en
un checkout temporal de `origin/integration/consolidado` antes de tocarlos.

## Qué no se corrió

- No se corrió Doppler, ni push, ni la suite e2e "toda junta" (por memoria).
- No se re-corrió el jest completo de unitarios después de los tres commits
  finales (solo `src/modules/crm`, tsc y code:check).
- No se probó contra servicios reales (Cloudinary, Resend, Tokko, portales, DNS
  de dominios del sitio).
- No se leyeron `docs/RETOMAR_2026-11-04_FORMATEO.md` ni
  `claude-memory/MEMORY.md` de `adminprop-repo-files`: están en `main` y el
  sandbox del worktree no permite ejecutar `git` sobre otro repositorio; el
  checkout de ese repo está en otra rama. Se aplicaron las reglas de Doppler
  que da el encargo.

## A revisar a mano

1. **Doppler**: las variables nuevas del sitio van **vacías** y las completa el
   dueño: `SITES_BASE_DOMAIN`, `SITES_PROTOCOL`, `SITES_DEV_URL`,
   `SITES_ALLOWED_IMAGE_HOSTS`, `SITES_DOMAIN_VERIFICATION`,
   `SITES_REVALIDATE_URL`, `SITES_REVALIDATE_SECRET`, `SITES_SERVER_SECRET`,
   `SITES_PREVIEW_SECRET`. Ojo: fuera de development/test `SITES_PREVIEW_SECRET`
   (32+ caracteres) es **obligatoria** y `CORS_ORIGINS=*` hace fallar el
   arranque (incluido `qa`); además Swagger solo arranca solo en
   development/test. Si algún entorno depende de lo anterior, no levanta.
2. **Dos índices parciales solo en SQL** que `prisma migrate dev` puede querer
   borrar: `site_settings_custom_domain_verified_key` y
   `job_executions_scheduled_slot_key`. No dropearlos.
3. **Default-deny del guard**: se priorizó el de la base (ADMIN también recibe
   403 en un handler sin declarar). Confirmar que los controllers nuevos del
   sitio (`/site/*`) declaran `@Roles`/`@IsPublic` (el test de arquitectura y
   `roles-default-deny.e2e-spec.ts` pasan).
4. Las dos versiones de la validación de SVG conviven: la del handler de logos
   (motivo detallado) y `isSafeSvg` en el render de PDFs.
5. Decisiones renumeradas (ver arriba): avisar a quien cite D-177..D-202 /
   A-137..A-148 desde otras ramas o repos (por ejemplo el frontend del sitio).
6. `openapi.json`: el frontend debe regenerar sus tipos.
7. Limpieza opcional: la base `adminprop_test` del Postgres local de este
   contenedor se recreó vacía.
