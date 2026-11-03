# Sitio web de la inmobiliaria — backend (módulo `site` + campos de propiedad)

Rama `feature/web-inmobiliaria-api` → `dev`. Spec: `adminprop-repo-files/specs/web-inmobiliaria.md` (sesión A, el contrato es la sección 5).

> ⚠️ **Encadenado sobre `feature/fase-14-notificaciones`** (y, por ella, sobre las Fases 22, 25, 19, 18 y 15). Se mergea después de esos PR. **Hecho sin supervisión.**

## Qué hace

Cada inmobiliaria puede activar su sitio web desde el backoffice: elige un template (`CLASSIC` o `MODERN`), edita tema y contenido en un **borrador**, y al **publicar** se copia a lo que lee el público. El sitio toma propiedades y consultas de los endpoints públicos que ya existían (Fase 22).

- Módulo `site` (`src/modules/site`): configuración con borrador/publicado, catálogo de templates, subida de imágenes, resolución por host, token de vista previa, lecturas públicas.
- Campos nuevos de propiedad (spec 4.3) cargables en el backoffice y expuestos en la API pública.
- Migraciones `add_property_listing_extras` y `add_site_settings`.

## Para revisar (lo más importante)

1. **D-157** — La validación del contenido es una **política pura** (`site-content.policy.ts`), no class-validator anidado como decía la spec: errores por campo con ruta, claves de más rechazadas en cualquier nivel, 57 unitarios. Los DTOs de `site.dtos.ts` sirven al OpenAPI.
2. **D-158** — `PUT /site/settings` es parcial: `theme` se mezcla campo a campo, cada bloque de `content` reemplaza al anterior entero, y **`subdomain`/`customDomain` valen al instante** (no pasan por el borrador).
3. **D-159** — Guardar acepta un borrador a medias; **publicar** exige SEO, ninguna sección visible vacía, destacadas manuales válidas y **contraste AA**.
4. **D-161** — Imágenes: JPG/PNG/WebP por contenido, ≤ 5 MB, **sin SVG**. En el contenido solo valen imágenes subidas por esa inmobiliaria, su logo o hosts de `SITES_ALLOWED_IMAGE_HOSTS`.
5. **D-162 / D-163** — Resolución por host con caché de 30 s (solo sitios publicados); vista previa con JWT de 15 min con su propio secreto, que abre el **borrador** sin caché ni indexación.
6. **D-164** — La auditoría usa el diff automático de las columnas (`enabled`, `publishedAt`, `templateKey`, `subdomain`, `customDomain`); el JSON del contenido se excluye del historial.
7. **D-167** — Ampliaciones **aditivas** al contrato: `GET /site/subdomain-availability`, `ids`/`bedrooms`/`bathrooms` en el listado público y cuatro campos más en `PublicPropertySummary` (`operation`, `rooms`, `coveredAreaM2`, `ageYears`).
8. **D-168 / A-130** — Los topes de lectura del sitio (300/min) y de host (600/min) son más altos que los del portal porque los pide el servidor de `apps/sites` desde una sola IP.
9. **A-129 — Pendiente de Giuliano**: variables nuevas, todas opcionales (`SITES_BASE_DOMAIN`, `SITES_PROTOCOL`, `SITES_DEV_URL`, `SITES_ALLOWED_IMAGE_HOSTS`, `SITES_PREVIEW_SECRET`). No pude crearlas en Doppler desde esta sesión. Sin `SITES_BASE_DOMAIN` solo funcionan dominios propios y el acceso por slug.

## Qué cambia, commit por commit

1. `feat(properties)` — migración `add_property_listing_extras`; `listingOperation`, dormitorios, baños, ambientes, superficies, antigüedad y coordenadas en dominio, repositorio, DTOs (con rangos), ficha del backoffice y API pública; filtros `operation`, `bedrooms`, `bathrooms`, `ids`.
2. `feat(site)` — migración `add_site_settings`; módulo `site` completo, `TenantsFacade.findActiveById`, configuración `SITES_*`, modelos declarados en `auditable-models.ts`; unitarios y e2e.
3. `chore(api)` — `openapi.json`.
4. `docs(site)` — técnica, funcional, D-157 a D-169 y A-125 a A-132.
5. `test(public)` / `docs` — ajuste del e2e del portal a los campos aditivos y esta descripción.

## Segunda ronda: revisión de este PR (D-170 a D-176)

Revisé el código del PR y corregí lo encontrado:

| Hallazgo                                                         | Corrección                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cualquier ADMIN podía reservar el dominio de otro (y bloquearlo) | Verificación por TXT, único solo entre verificados, `GET /site/domain` y `POST /site/domain/verify` (**D-170**; migración `add_site_domain_verification`) |
| Publicar tardaba hasta ~2 min en verse                           | Aviso a `apps/sites` (`SiteRevalidationPort`, **D-171**)                                                                                                  |
| El primer acceso con dos pestañas daba 500                       | `ensure()` relee si choca (**D-173**, test con 4 pedidos simultáneos)                                                                                     |
| Los cambios de contenido no dejaban rastro                       | Evento «borrador guardado» con los bloques tocados, sin los textos (**D-172**)                                                                            |
| Textos con caracteres invisibles o bidi                          | Rechazados (**D-174**)                                                                                                                                    |
| Subida de imágenes y verificación sin tope                       | 30 y 20 por minuto (**D-175**)                                                                                                                            |
| `SITES_DOMAIN_VERIFICATION=false` rompía el arranque             | Faltaba `@toBool()`; lo encontré probando contra la API real (**D-176**)                                                                                  |

**Para revisar de esta ronda:** D-170 (el cambio más grande: nueva migración con índice parcial y dominios existentes marcados como verificados, A-134), A-135 (variables nuevas a cargar en Doppler) y A-136 (el TXT puede tardar en verse por el caché del resolvedor DNS).

## Endpoints

`GET /site/templates`, `GET|PUT /site/settings`, `POST /site/settings/reset-template`, `POST /site/publish`, `POST /site/unpublish`, `POST /site/assets`, `GET /site/preview-token`, `GET /site/subdomain-availability`, `GET /site/domain`, `POST /site/domain/verify` (todos **solo ADMIN**, empleado = 403) y, públicos, `GET /public/:slug/site[?preview=]` y `GET /public/site-by-host?host=`. Detalle y errores en `docs/tecnica/web-inmobiliaria.md`.

## Desvíos respecto del contrato (spec sección 5)

Ninguno en las respuestas definidas. Ampliaciones aditivas en D-167. Dos precisiones donde la spec era ambigua: `hasUnpublishedChanges` es `true` si nunca se publicó (D-160) y `GET /site/preview-token` devuelve `{ token, expiresAt }`.

## Cómo se probó

- `tsc`, lint y formato limpios.
- **690 unitarios** (74 suites), 59 de ellos del módulo `site`.
- **e2e completa corrida archivo por archivo contra Postgres real: 28 suites, 478 tests.** Todas en verde **salvo `settlements`**, que falla de forma intermitente (1 o 2 de 9 tests, siempre por `waitFor: la condición no se cumplió en 15000ms` en el cierre asíncrono por cola) **también en la rama base `feature/fase-14-notificaciones`, sin ningún cambio mío** (3 de 3 corridas con fallas): es una intermitencia previa de este entorno de pruebas, no de este PR. En la primera ronda había pasado 9/9 corriéndolo solo. Hay que mirarlo en el CI real. Los e2e se corren de a un archivo porque pg-boss puede dar un `deadlock detected` al crear colas cuando dos aplicaciones arrancan seguidas en la misma base (ya ocurría antes).
- `test/site.e2e-spec.ts` (37 casos): 401/403 en todas las rutas, creación al primer GET, borrador vs publicado, despublicar, publicar incompleto o ilegible, XSS en cada campo, imágenes (SVG, HTML disfrazado, > 5 MB, imagen de otra inmobiliaria), unicidad global de subdominio/dominio, auditoría, host, vista previa (token ajeno, vencido, access token) y **aislamiento entre dos inmobiliarias** (sitio, propiedades y consultas).
- Las migraciones se generaron con `migrate diff` y se aplicaron con `migrate deploy` sobre bases descartables; el diff contra el schema da vacío. Nunca `migrate dev` ni `reset`.

## Después de mergear

`npm run prisma:migrate:deploy` aplica `add_property_listing_extras` y `add_site_settings`. Las propiedades existentes quedan con `listing_operation = RENT`. Cargar las variables `SITES_*` según A-129 y poner `TRUST_PROXY=true` en producción.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GhBUKJBqXbBFxfDrfiiXnz
