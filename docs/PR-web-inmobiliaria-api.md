# Sitio web de la inmobiliaria — backend (módulo `site` + campos de propiedad)

Rama `feature/web-inmobiliaria-api` → `dev`. Spec: `adminprop-repo-files/specs/web-inmobiliaria.md` (sesión A, el contrato es la sección 5).

> ⚠️ **Encadenado sobre `feature/fase-14-notificaciones`** (y, por ella, sobre las Fases 22, 25, 19, 18 y 15). Se mergea después de esos PR. **Hecho sin supervisión.**

## Qué hace

Cada inmobiliaria puede activar su sitio web desde el backoffice: elige un template (`CLASSIC` o `MODERN`), edita tema y contenido en un **borrador**, y al **publicar** se copia a lo que lee el público. El sitio toma propiedades y consultas de los endpoints públicos que ya existían (Fase 22).

- Módulo `site` (`src/modules/site`): configuración con borrador/publicado, catálogo de templates, subida de imágenes, resolución por host, token de vista previa, lecturas públicas.
- Campos nuevos de propiedad (spec 4.3) cargables en el backoffice y expuestos en la API pública.
- Migraciones `add_property_listing_extras` y `add_site_settings`.

## Para revisar (lo más importante)

1. **D-177** — La validación del contenido es una **política pura** (`site-content.policy.ts`), no class-validator anidado como decía la spec: errores por campo con ruta, claves de más rechazadas en cualquier nivel, 57 unitarios. Los DTOs de `site.dtos.ts` sirven al OpenAPI.
2. **D-178** — `PUT /site/settings` es parcial: `theme` se mezcla campo a campo, cada bloque de `content` reemplaza al anterior entero, y **`subdomain`/`customDomain` valen al instante** (no pasan por el borrador).
3. **D-179** — Guardar acepta un borrador a medias; **publicar** exige SEO, ninguna sección visible vacía, destacadas manuales válidas y **contraste AA**.
4. **D-181** — Imágenes: JPG/PNG/WebP por contenido, ≤ 5 MB, **sin SVG**. En el contenido solo valen imágenes subidas por esa inmobiliaria, su logo o hosts de `SITES_ALLOWED_IMAGE_HOSTS`.
5. **D-182 / D-183** — Resolución por host con caché de 30 s (solo sitios publicados); vista previa con JWT de 15 min con su propio secreto, que abre el **borrador** sin caché ni indexación.
6. **D-184** — La auditoría usa el diff automático de las columnas (`enabled`, `publishedAt`, `templateKey`, `subdomain`, `customDomain`); el JSON del contenido se excluye del historial.
7. **D-187** — Ampliaciones **aditivas** al contrato: `GET /site/subdomain-availability`, `ids`/`bedrooms`/`bathrooms` en el listado público y cuatro campos más en `PublicPropertySummary` (`operation`, `rooms`, `coveredAreaM2`, `ageYears`).
8. **D-188 / A-142** — Los topes de lectura del sitio (300/min) y de host (600/min) son más altos que los del portal porque los pide el servidor de `apps/sites` desde una sola IP.
9. **A-141 — Pendiente de Giuliano**: variables nuevas (`SITES_BASE_DOMAIN`, `SITES_PROTOCOL`, `SITES_DEV_URL`, `SITES_ALLOWED_IMAGE_HOSTS` opcionales; **`SITES_PREVIEW_SECRET` obligatoria en producción**, ver D-198). No pude crearlas en Doppler desde esta sesión. Sin `SITES_BASE_DOMAIN` solo funcionan dominios propios y el acceso por slug.

## Qué cambia, commit por commit

1. `feat(properties)` — migración `add_property_listing_extras`; `listingOperation`, dormitorios, baños, ambientes, superficies, antigüedad y coordenadas en dominio, repositorio, DTOs (con rangos), ficha del backoffice y API pública; filtros `operation`, `bedrooms`, `bathrooms`, `ids`.
2. `feat(site)` — migración `add_site_settings`; módulo `site` completo, `TenantsFacade.findActiveById`, configuración `SITES_*`, modelos declarados en `auditable-models.ts`; unitarios y e2e.
3. `chore(api)` — `openapi.json`.
4. `docs(site)` — técnica, funcional, D-177 a D-189 y A-137 a A-144.
5. `test(public)` / `docs` — ajuste del e2e del portal a los campos aditivos y esta descripción.

## Segunda ronda: revisión de este PR (D-190 a D-196)

Revisé el código del PR y corregí lo encontrado:

| Hallazgo                                                         | Corrección                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cualquier ADMIN podía reservar el dominio de otro (y bloquearlo) | Verificación por TXT, único solo entre verificados, `GET /site/domain` y `POST /site/domain/verify` (**D-190**; migración `add_site_domain_verification`) |
| Publicar tardaba hasta ~2 min en verse                           | Aviso a `apps/sites` (`SiteRevalidationPort`, **D-191**)                                                                                                  |
| El primer acceso con dos pestañas daba 500                       | `ensure()` relee si choca (**D-193**, test con 4 pedidos simultáneos)                                                                                     |
| Los cambios de contenido no dejaban rastro                       | Evento «borrador guardado» con los bloques tocados, sin los textos (**D-192**)                                                                            |
| Textos con caracteres invisibles o bidi                          | Rechazados (**D-194**)                                                                                                                                    |
| Subida de imágenes y verificación sin tope                       | 30 y 20 por minuto (**D-195**)                                                                                                                            |
| `SITES_DOMAIN_VERIFICATION=false` rompía el arranque             | Faltaba `@toBool()`; lo encontré probando contra la API real (**D-196**)                                                                                  |

**Para revisar de esta ronda:** D-190 (el cambio más grande: nueva migración con índice parcial y dominios existentes marcados como verificados, A-146), A-147 (variables nuevas a cargar en Doppler) y A-148 (el TXT puede tardar en verse por el caché del resolvedor DNS).

## Revisión del PR (tercera ronda, D-177..D-200)

Después de revisar el PR contra la spec, se aplicó cada arreglo en un commit propio:

| #   | Arreglo                                                                                                                                                                  | Dónde                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1   | Decisiones renumeradas a **D-177..D-196** y **A-137..A-148** (la Fase 21 usa D-157..D-172 y A-125..A-131)                                                                | docs                                                            |
| 2   | **Desvío de nombre**: la spec dice 422 con `details`; el cuerpo usa **`errors`** (convención de la API)                                                                  | PR                                                              |
| 3   | **Host por coincidencia exacta**: `foo.com` ya no resuelve al tenant que verificó `www.foo.com` (ni al revés); cada nombre se verifica por separado                      | `site-host-resolver.ts`, tests unitarios y e2e (A-138 revisado) |
| 4   | **El aviso a `apps/sites` no bloquea** el request (publicar, despublicar, verificar, cambiar dirección): `SiteChangeNotifier`, sin `await`, con log                      | D-191, test e2e con 3 s de demora                               |
| 5   | **Las lecturas del servidor de sitios no cuentan contra el tope por IP** si traen el secreto compartido (`X-Sites-Secret`, tiempo constante); el contacto sigue limitado | **D-197**, tests e2e con throttling activo                      |
| 6   | **`SITES_PREVIEW_SECRET` obligatoria en producción** (32+ caracteres), sin derivar de `JWT_ACCESS_SECRET`                                                                | **D-198**, test de `validateEnv`                                |
| 7   | Comentario en `schema.prisma` sobre el índice parcial que vive solo en SQL, y un spec que falla si una migración posterior lo borra                                      | `custom-domain-index.spec.ts`                                   |
| 8   | Cambiar subdominio o dominio de un sitio **publicado** vacía la caché y avisa a `apps/sites`                                                                             | tests e2e                                                       |
| 9   | **Re-verificación periódica: NO implementada.** Queda como deuda con diseño propuesto                                                                                    | **D-199**                                                       |
| 10  | **Caché de hosts por instancia** (hasta 30 s de diferencia entre instancias) documentada                                                                                 | **D-200**                                                       |

Notas: el ítem 5 también marca las tres lecturas del portal público (`properties`, `properties/:id`, `filters`) que consume el sitio, porque tenían el mismo problema (60/min global); el ítem 4 se aplicó también a despublicar y verificar dominio, no solo a publicar.

## Variables de entorno a cargar en Doppler (backend)

| Variable                                                       | Obligatoria                            | Para qué                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITES_PREVIEW_SECRET`                                         | **Sí, en producción** (32+ caracteres) | Firma la vista previa y el valor TXT de verificación de dominios. Rotarla cambia todos los TXT esperados (D-198)                                          |
| `SITES_REVALIDATE_SECRET`                                      | Recomendada                            | Secreto compartido con `apps/sites`: revalidación al publicar **y** exención del tope por IP (D-191, D-197). Tiene que ser el mismo valor en `apps/sites` |
| `SITES_REVALIDATE_URL`                                         | Recomendada                            | URL base de `apps/sites` para el aviso de publicación                                                                                                     |
| `SITES_BASE_DOMAIN`                                            | Para usar subdominios                  | Dominio de los subdominios de sitios                                                                                                                      |
| `SITES_DOMAIN_VERIFICATION`                                    | No (default `true`)                    | `false` solo en desarrollo                                                                                                                                |
| `SITES_PROTOCOL`, `SITES_DEV_URL`, `SITES_ALLOWED_IMAGE_HOSTS` | No                                     | Ver A-141                                                                                                                                                 |

## Endpoints

`GET /site/templates`, `GET|PUT /site/settings`, `POST /site/settings/reset-template`, `POST /site/publish`, `POST /site/unpublish`, `POST /site/assets`, `GET /site/preview-token`, `GET /site/subdomain-availability`, `GET /site/domain`, `POST /site/domain/verify` (todos **solo ADMIN**, empleado = 403) y, públicos, `GET /public/:slug/site[?preview=]` y `GET /public/site-by-host?host=`. Detalle y errores en `docs/tecnica/web-inmobiliaria.md`.

## Desvíos respecto del contrato (spec sección 5)

**Un desvío de nombre:** la spec (5.2) pide, para publicar con contenido inválido, un 422 «con `details` por campo». La API serializa los errores por campo en **`errors`** (`{ field, message }[]`), que es la convención de toda la API (`ErrorDetail` / `error-body.ts`); `details` es el nombre interno de la excepción, no el del cuerpo de la respuesta. Los tests y el frontend usan `errors`. Si se prefiere `details`, hay que cambiarlo en el filtro global para toda la API, no solo acá. Fuera de eso no hay desvíos en las respuestas definidas. Ampliaciones aditivas en D-187. Dos precisiones donde la spec era ambigua: `hasUnpublishedChanges` es `true` si nunca se publicó (D-180) y `GET /site/preview-token` devuelve `{ token, expiresAt }`.

## Cómo se probó

- `tsc`, lint y formato limpios.
- **700 unitarios** (77 suites), todos en verde.
- **e2e completa corrida archivo por archivo contra Postgres real: 28 suites, 486 tests. 26 suites en verde; 2 archivos con 1 falla cada uno, ambos previos y ajenos a este PR** (los dos fallan también en la rama base `feature/fase-14-notificaciones` sin ningún cambio mío, comprobado):
  - `settlements`: intermitente, `waitFor: la condición no se cumplió en 15000ms` en el cierre asíncrono por cola (3 de 3 corridas con fallas en la base).
  - `audit` («filtra por fechas y por texto»): **depende de la hora**. Arma `from=<fecha UTC de hoy>` y la API lo interpreta como un día argentino (UTC-3): entre las 00:00 y las 03:00 UTC los eventos de «hoy» caen antes de ese inicio y el test da 0. Falló a las 00:22 UTC en la rama base y en esta; pasa fuera de esa franja.
    Los e2e se corren de a un archivo porque pg-boss puede dar un `deadlock detected` al crear colas cuando dos aplicaciones arrancan seguidas en la misma base (ya ocurría antes).
- `test/site.e2e-spec.ts` (44 casos): 401/403 en todas las rutas, creación al primer GET, borrador vs publicado, despublicar, publicar incompleto o ilegible, XSS en cada campo, imágenes (SVG, HTML disfrazado, > 5 MB, imagen de otra inmobiliaria), unicidad global de subdominio/dominio, auditoría, host, vista previa (token ajeno, vencido, access token) y **aislamiento entre dos inmobiliarias** (sitio, propiedades y consultas).
- Las migraciones se generaron con `migrate diff` y se aplicaron con `migrate deploy` sobre bases descartables; el diff contra el schema da vacío. Nunca `migrate dev` ni `reset`.

## Después de mergear

`npm run prisma:migrate:deploy` aplica `add_property_listing_extras` y `add_site_settings`. Las propiedades existentes quedan con `listing_operation = RENT`. Cargar las variables `SITES_*` según A-141 y poner `TRUST_PROXY=true` en producción.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GhBUKJBqXbBFxfDrfiiXnz
