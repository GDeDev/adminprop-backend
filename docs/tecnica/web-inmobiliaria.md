# Sitio web de la inmobiliaria — documentación técnica (backend)

Spec: `adminprop-repo-files/specs/web-inmobiliaria.md` (el contrato es la sección 5). Rama `feature/web-inmobiliaria-api`, desde `feature/fase-14-notificaciones`. Decisiones D-157 a D-169 y supuestos A-125 a A-132 en `DECISIONES_TECNICAS.md`.

## Qué se construyó

**Migraciones** (generadas con `migrate diff` y probadas con `migrate deploy` sobre una base descartable; nunca `migrate dev`/`reset`):

- `add_property_listing_extras`: enum `ListingOperation` y columnas opcionales en `properties` (spec 4.3).
- `add_site_settings`: enum `SiteTemplateKey`, tablas `site_settings` (una por tenant; `subdomain` y `custom_domain` únicos globales; `draft`/`published` JSONB) y `site_assets`.

**Propiedades**: los campos nuevos están en el dominio, el repositorio, los DTOs de alta y edición (validados con rangos), la ficha del backoffice y la API pública. Filtros públicos nuevos: `operation`, `bedrooms`, `bathrooms`, `ids`.

**Tenants**: `TenantsFacade.findActiveById` (para resolver host → slug).

**Config**: `SitesConfig` (`SITES_BASE_DOMAIN`, `SITES_PROTOCOL`, `SITES_DEV_URL`, `SITES_ALLOWED_IMAGE_HOSTS`, `SITES_PREVIEW_SECRET`).

**Módulo `src/modules/site`**

| Capa             | Piezas                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `site.types.ts` (el contrato 5.1 y los límites), `site-content.policy.ts` (validación y mezcla del borrador), `site-templates.ts` (catálogo, temas y contenido inicial), `site-host.policy.ts` (subdominios, dominios, reservados), `color.ts` (contraste WCAG), `image-info.ts` (tipo y tamaño por bytes), `site.ports.ts`, `site.exceptions.ts` |
| `application`    | `SiteDraftService` (crear al primer GET, validar, imágenes permitidas, propiedades inexistentes), comandos y handlers (guardar, restaurar, publicar, despublicar, subir imagen), queries (templates, settings, token, disponibilidad, sitio público, host), `SiteHostResolver` (caché), `SitePreviewTokenService`, `SiteUrls`, `SiteViews`        |
| `infrastructure` | `SiteController` (solo ADMIN), `PublicSiteController` (sin JWT), `site.dtos.ts` (OpenAPI), repositorios Prisma, `SiteModule`                                                                                                                                                                                                                      |

Depende de `PropertiesFacade` y `TenantsFacade` por sus públicos; el storage es el puerto global. Nadie depende de `site`.

## Endpoints

Prefijo `/api/v1`, respuestas `{ success, message, data }`.

| Método | Ruta                                  | Acceso  | Notas                                                                                 |
| ------ | ------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| GET    | `/site/templates`                     | ADMIN   | `SiteTemplateInfo[]`                                                                  |
| GET    | `/site/settings`                      | ADMIN   | Crea la fila al primer GET (CLASSIC, datos del tenant, deshabilitada)                 |
| PUT    | `/site/settings`                      | ADMIN   | Parcial (D-158). 422 con `errors[]` por campo; 409 `SUBDOMAIN_TAKEN` / `DOMAIN_TAKEN` |
| POST   | `/site/settings/reset-template`       | ADMIN   | `{ keepContent }`                                                                     |
| POST   | `/site/publish`                       | ADMIN   | 422 si está incompleto o no se lee (D-159)                                            |
| POST   | `/site/unpublish`                     | ADMIN   | Idempotente; conserva todo                                                            |
| POST   | `/site/assets`                        | ADMIN   | Multipart `file`; 400 si no es JPG/PNG/WebP válido o pesa > 5 MB                      |
| GET    | `/site/preview-token`                 | ADMIN   | `{ token, expiresAt }`, 15 min                                                        |
| GET    | `/site/subdomain-availability?value=` | ADMIN   | Ampliación (D-167)                                                                    |
| GET    | `/public/:slug/site[?preview=]`       | pública | `PublicSite`; `s-maxage=60`; con `preview`, `no-store`                                |
| GET    | `/public/site-by-host?host=`          | pública | `{ slug }`; 404 `SITE_NOT_FOUND`                                                      |
| GET    | `/public/:slug/properties`            | pública | Suma `operation`, `bedrooms`, `bathrooms`, `ids`                                      |

El resto de la API pública (`/properties/:id`, `/filters`, `/contact`) no cambia, salvo los campos aditivos de la ficha.

## Seguridad

- **ADMIN y tenant-scoped** todo `/site/*` (`@Roles(Role.ADMIN)`; un empleado recibe 403, probado en e2e). `SiteSettings` y `SiteAsset` están en `auditable-models.ts` con `tenantScoped`.
- **Texto plano**: se rechazan etiquetas HTML (`<b`, `</`, `<!`, `<?`) y caracteres de control en cada campo; un `<` suelto ("< 50 m²") sigue siendo válido. El frontend renderiza todo como texto.
- **URLs**: redes sociales solo `https` y del dominio de la red; sin credenciales embebidas. Imágenes según D-161.
- **Lista blanca de lectura**: `PublicSite` expone solo plantilla, tema, contenido, `{ slug, name, logoUrl }` y la fecha. Un sitio inexistente, sin publicar, de una inmobiliaria inactiva o con token de vista previa ajeno devuelven el mismo 404.
- **Multi-tenant**: lo único que cruza inmobiliarias a propósito es la unicidad de subdominio/dominio y la resolución por host, ambas por `prisma.unscoped` y comentadas en el código.
- **Rate limit** de lecturas públicas (D-168).

## Cómo se probó

- Unitarios (57 nuevos): política de contenido (HTML/scripts, límites, claves de más, redes, imágenes, publicación, contraste), subdominios y dominios, templates y contenido inicial, lectura de imágenes, resolución por host con caché.
- e2e `test/site.e2e-spec.ts` (27 casos contra Postgres): 401/403 en todas las rutas, creación al primer GET, guardado parcial y errores por campo, XSS, subida de imágenes (SVG, HTML disfrazado, > 5 MB, imagen de otra inmobiliaria), unicidad global, borrador vs publicado, despublicar, publicar incompleto o sin contraste, destacadas ajenas, auditoría, host, vista previa (token ajeno, vencido o access token) y **aislamiento entre dos inmobiliarias** (sitio, propiedades y consultas).
- `test/public.e2e-spec.ts` suma los campos de propiedad y los filtros nuevos.
