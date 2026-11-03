# Fase 24 — Tasación automática de alquiler (backend)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_24.md` (manda sobre la spec) y de `shared-types/valuation.ts` del frontend (el contrato HTTP). Rama `feature/fase-24-tasacion`, **encadenada sobre `feature/fase-21-migracion`**. Hecha **sin supervisión**. Decisiones D-173 a D-182 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md); los supuestos A-60 a A-69 los numera el rediseño y se implementaron tal cual.

> **No hay datos de mercado reales todavía.** La única fuente activa por defecto es la simulada (`COMPARABLES_SOURCES=fake`). Los tres parsers (Zonaprop, Argenprop, Mercado Libre) se probaron contra fixtures HTML escritos a mano en `test/fixtures/valuation/`, **no contra los sitios reales**: las URL de búsqueda tampoco se validaron (D-181). Activarlos exige una primera corrida supervisada y revisar con Giuliano los términos de uso de cada portal (A-62). La calidad del rango tampoco se contrastó con tasaciones reales de Micaela.

## Qué quedó construido

**Migración `add_valuation`**

- Enums `MarketSource` (`ZONAPROP | ARGENPROP | MERCADOLIBRE | FAKE`), `MarketCategory`, `MarketOperation` (sólo `RENT`), `ZoneRefreshResult` (`OK | EMPTY | BLOCKED | PARSE_ERROR`), `ValuationConfidence`, `ValuationEngine`.
- `market_comparables` (**global, sin `tenant_id`**): único `(source, external_id)` e índice `(zone_key, category, currency, active, last_seen_at)`. Guarda sólo atributos numéricos y la URL del aviso (precio `Decimal(14,2)`, superficie, ambientes, amenities normalizadas, fechas); nunca título, descripción, fotos ni contacto (A-62).
- `valuation_zones` (global, único `(zone_key, category)`): qué se refresca, último resultado, fallas seguidas y `requested_count`.
- `valuation_source_states` (global, una fila por fuente): `last_run_at`, `last_ingest_at`, `last_result`, `consecutive_failures`, `blocked_until`. Es lo que permite detectar la rotura silenciosa entre corridas.
- `valuation_requests` (**tenant-scoped, auditada, sin borrado**): `input` (jsonb) e `input_hash` (sha-256, para reconocer una tasación idéntica), rango y precio sugerido `Decimal(14,2)`, confianza, avisos usados y descartados, `zone_key_used`, `zone_label`, `zone_widened`, `oldest_comparable_at`, `engine`, `justification`, `requested_by_id`.
- Las tres tablas de mercado figuran en `auditable-models.ts` con `tenantScoped: false, audit: false` y el test de modelos con tenant las documenta como excepción deliberada (D-173).

**Módulo `src/modules/valuation`**

| Capa             | Piezas                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `market` (enums y tipos), `zone-key` (slug, padre, etiqueta), `market-category` (sinónimos de tipo de propiedad), `valuation-policy` (cálculo puro), `valuation-narrative` (hechos y plantilla), puertos, excepciones                                                     |
| `application`    | `AppraisePropertyHandler`, `ListAppraisalsHandler`, `GetMarketStatusHandler`, `GetMarketCoverageHandler`, `RefreshZoneHandler`, `ComparablesRefreshService` (el refresco de avisos), `ZoneResolver`, `ValuationSettings`, `ValuationViews`, cola `valuation-refresh-zone` |
| `infrastructure` | repositorios Prisma, `ValuationController`, `ValuationConsumer`, fuentes (`PageFetcher`, `ZonapropSource`, `ArgenpropSource`, `MercadoLibreSource`, `FakeComparableSource`, un parser por portal), redactores (`TemplateNarrator`, `LlmNarrator`, `FakeNarrator`)         |
| `public`         | `ValuationFacade.appraise` y `refreshComparables` (lo usa el job global)                                                                                                                                                                                                  |

Consume de otros módulos sólo por facade: `PropertiesFacade.getForValuation` y `listAvailableForValuation` (nuevos), `MasterDataFacade.locationNames`, `describeCatalog` y `describeAmenities`, `TenantsFacade.listActive`, `UsersFacade.describe`, `AsyncJobsFacade` y `NotificationsService.notifyStaff`.

**Otros cambios**

- Job global `valuation.refresh-comparables` (03:00, alcance `GLOBAL`) en el catálogo de Automatizaciones (`RefreshComparablesJob`).
- Tipo de aviso interno `COMPARABLES_SOURCE_STALE` en `notifications.port.ts`.
- **Fix de la cola** (D-182): `PgBossQueueAdapter.declare` declara las colas de a una.

## Zona de mercado y categoría

- `zone_key` = slug (sin acentos, minúsculas) de los **nombres** de la jerarquía de ubicaciones del tenant, de lo general a lo específico y sin el país: `caba/palermo`, `buenos-aires/la-plata/city-bell`. Dos inmobiliarias con la misma jerarquía de nombres comparten avisos sin saberlo (D-174).
- La zona padre es la clave sin el último tramo. La etiqueta que se muestra son los dos últimos nombres, del específico al general (`Palermo, CABA`).
- Una ubicación sin nombres usables → 422 `VALUATION_NO_ZONE`.
- El tipo de propiedad (por tenant) se mapea por nombre normalizado a `MarketCategory` con una tabla de sinónimos en código (`depto|dpto|monoambiente|duplex|loft → APARTMENT`, `casa|chalet|quinta → HOUSE`, `ph`, `oficina`, `local|galpón|depósito → COMMERCIAL`, `cochera`, `terreno|lote`). Lo no reconocido es `OTHER`; esas zonas no se descubren para refrescar.

## Flujo de una tasación

`POST /valuation/properties/:propertyId/appraise`, **síncrono y sin red**: sólo lee el caché de avisos.

1. Lee la propiedad (`getForValuation`); si no existe en el tenant → 404 `VALUATION_PROPERTY_NOT_FOUND`.
2. Arma el sujeto: superficie (del request; la ficha no la tiene todavía, A-69), ambientes, amenities (las del request, o las de la propiedad) normalizadas y ordenadas, y la moneda (la del request o `listingCurrency`).
3. **Reutilización**: calcula el sha-256 del `input` (sujeto + moneda + `zoneKey` + categoría). Si hay una tasación de esa propiedad con el mismo hash en las últimas 6 h, la devuelve con `reused: true` y **no** cuenta contra el límite (A-67). Sigue siendo **201**.
4. **Límite diario**: cuenta las tasaciones del tenant en las últimas 24 h (ventana móvil); con `VALUATION_DAILY_LIMIT` (default 30) o más → 429 `VALUATION_DAILY_LIMIT` (D-179).
5. Registra la zona (`valuation_zones.touch`) **antes** de calcular, así que aunque falten datos el próximo refresco la cubre.
6. **Selección**: zona exacta + categoría + moneda + `RENT` + `active` + `last_seen_at ≥ hoy − VALUATION_MAX_AGE_DAYS` (45), los 500 vistos más recientemente. Si el cálculo no llega a `VALUATION_MIN_COMPARABLES` (3), **se amplía una vez** a la zona padre incluyendo sus descendientes (`zone_widened = true`). Si sigue sin alcanzar → 422 `INSUFFICIENT_MARKET_DATA` con `{ zoneKey, found, needed }`.
7. Cálculo (siguiente sección), confianza, redacción y guardado. La respuesta es el `ValuationResult` del contrato; **la propiedad no se toca** (A-46).

## Cálculo (`ValuationPolicy`, puro)

Los números los calcula este código y nadie más (A-60). Todo con `decimal.js` vía `shared/money`; las constantes son exportadas y están cubiertas por `valuation-policy.spec.ts`.

1. **Base**: con superficie del sujeto, `PER_M2`; sin ella, `ABSOLUTE`.
2. **Precio inválido** (≤ 0) → descartado. En `PER_M2`, un aviso sin superficie, o que difiere más de **35 %** de la del sujeto, **no entra y no se cuenta como descartado** (no es un atípico, es no comparable). Los que entran se llevan al tamaño de la propiedad: `precio / área del aviso × área del sujeto`.
3. **Atípicos**: con 5 candidatos o más, fuera de `[Q1 − 1,5·IQR, Q3 + 1,5·IQR]` (cuantiles con interpolación lineal). Se suman a `discarded`.
4. Si quedan menos de `minComparables`, devuelve `null` (el handler decide ampliar o responder 422).
5. **Peso** de cada aviso: 1 + 0,25 por amenity coincidente (tope +1) + 0,5 si los ambientes son iguales o 0,25 si difieren en uno (0 si difieren más o falta alguno) − 0,02 por cada día de antigüedad pasados los 15, con piso 0,3.
6. **Resultado**: `suggested` = mediana ponderada; rango = percentil 25 y 75 ponderados. Con menos de 5 avisos el rango es mínimo–máximo. Redondeo `ROUND_HALF_UP` a 2 decimales. `weightedQuantile` devuelve el primer valor cuyo peso acumulado supera el objetivo y, si lo iguala justo, el promedio con el siguiente (así, con pesos parejos, es la mediana de siempre).
7. **Confianza**: `HIGH` desde 10 avisos usados, `MEDIUM` desde 5, `LOW` debajo; si la zona se amplió baja un nivel (HIGH → MEDIUM, el resto → LOW).
8. **Para mostrar**: `suggestedPriceRounded` va a la centena en pesos y a la decena en dólares (D-176); el DTO conserva el valor exacto en `suggestedPrice`.

La moneda no se convierte: se compara dentro de la moneda de la propiedad (A-64).

## Justificación (redactor)

`ValuationNarratorPort` recibe `ValuationFacts` —únicamente los números ya calculados, la etiqueta de zona y la confianza; nunca dirección, propietario ni datos de la ficha— y devuelve el texto y el motor.

- `TemplateNarrator` (default, `VALUATION_NARRATOR=template`): plantilla en español armada con los números; avisa si no hay superficie y si se amplió la zona. `engine = STATISTICAL`.
- `LlmNarrator` (`VALUATION_NARRATOR=llm` **y** `ANTHROPIC_API_KEY`): pide a Anthropic por HTTP (timeout 15 s, `VALUATION_LLM_MODEL`, default `claude-sonnet-5-5`) una redacción de 2 a 4 oraciones. El texto se limpia (HTML, enlaces, markdown; tope 700 caracteres) y se **descarta si menciona alguna cifra que no esté entre los hechos** (se parsean números en formato argentino) o si viene vacío o falla la llamada: queda la plantilla. `engine = STATISTICAL_LLM` sólo si se usó el texto del modelo. Con `llm` y sin clave, el módulo arranca con un aviso y usa la plantilla.
- `FakeNarrator` para tests (incluido el caso «el modelo devuelve cifras distintas»).

## Fuentes de comparables

`ComparableSourcePort.search({ zoneKey, category, page }) → { items, hasMore }`. `ComparableSourceRegistry` arma las fuentes activas desde `COMPARABLES_SOURCES` (lista separada por comas).

- `FakeComparableSource`: set determinístico por `zone_key` y categoría, con dispersión controlada y un par de outliers. Es la única activa por defecto; `env.validation` la **rechaza en producción** y rechaza nombres desconocidos.
- Fuentes de portales (`PortalSource`): arman la URL pública de alquiler desde los últimos tramos de la zona y pasan el HTML por su parser (uno por archivo, con los selectores). Hasta 5 páginas por zona y corrida. Una categoría que el portal no tiene no pide nada.
- `assertReadable`: una página sin tarjetas que no dice que está vacía, o con más de la mitad de las tarjetas sin precio o id, es `SourceParseError` (→ `PARSE_ERROR`), nunca «0 comparables».
- `PageFetcher` (cortesía): `User-Agent: AdminpropBot/1.0 (+<VALUATION_SCRAPER_CONTACT>)`, lee `robots.txt` (caché de 24 h; si la ruta está prohibida, `SourceBlockedError`), una request cada 2,5 s por dominio, ante 403/429 reintenta una vez con backoff de 10 s y después corta como bloqueada; un captcha también es bloqueo.

## Refresco de avisos

`ComparablesRefreshService`, **nunca dentro de un request de tasación**.

- **Job `valuation.refresh-comparables`** (global, 03:00): `ValuationFacade.refreshComparables` → `runScheduled`. Primero **descubre zonas**: recorre los tenants activos y, dentro de cada contexto, registra las zonas de sus propiedades disponibles (categoría ≠ `OTHER`) (A-63). Luego toma hasta `VALUATION_ZONES_PER_RUN` (10) zonas atrasadas (nunca refrescadas, o hace más de 24 h) y las corre.
- Por **fuente**: si `blocked_until` está en el futuro se saltea (`SKIPPED`). Recorre las zonas hasta 5 páginas cada una y hace upsert por `(source, external_id)`: re-ver un aviso actualiza precio, atributos y `last_seen_at` sin duplicar. Ante bloqueo o parser roto **corta esa fuente** para el resto de la corrida (se rompería igual en cada zona) y las demás siguen.
- Al terminar las fuentes, da de baja (`active = false`) lo no visto en 30 días y guarda el resultado de cada zona (`OK` si alguna fuente trajo datos; `BLOCKED` si todas bloquearon; `PARSE_ERROR` si alguna rompió; si no, `EMPTY`).
- **Estado de la fuente** (`nextState`): `OK` pone las fallas en 0 y actualiza `last_ingest_at`; `EMPTY`, `BLOCKED` o `PARSE_ERROR` suman una falla; `BLOCKED` además fija `blocked_until` a 24 h.
- **Rotura silenciosa**: una fuente con 3 corridas seguidas sin datos (o con error) se informa en `staleSources` y se avisa, una vez por día y fuente (`dedupeKey`), a las inmobiliarias que tasaron en los últimos 30 días, con `COMPARABLES_SOURCE_STALE`.
- **Resultado del job** (`RefreshComparablesJob`): `SKIPPED` si no hay fuentes activas; `FAILED` si todas las que corrieron fallaron; `PARTIAL` si alguna falló o hay fuentes obsoletas; si no, `SUCCEEDED`.
- **Corrida manual** `POST /valuation/zones/refresh` (admin): resuelve la ubicación, registra la zona, crea un `AsyncJob` `valuation-refresh-zone` y publica en la cola homónima (`retryLimit: 0`). `ValuationConsumer` corre `runZone` (registra departamentos, casas y PH de la zona y corre las que estén atrasadas, respetando la corrida cada 24 h) y completa o falla el `AsyncJob`.

## Endpoints (admin y empleado; `{ success, message, data }`)

Propietarios e inquilinos reciben 403.

| Método | Ruta                                         | Descripción                                                                                                            |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| POST   | `/valuation/properties/:propertyId/appraise` | Body `{ areaM2?, bedrooms?, amenities?, currency? }`. **201** `ValuationResult` (también con `reused: true`). Auditado |
| GET    | `/valuation/properties/:propertyId/history`  | `Paginated<ValuationResult>`, las más nuevas primero                                                                   |
| GET    | `/valuation/market-status`                   | `MarketStatusDto`: por fuente, último ingreso, estado y avisos vigentes, más `maxAgeDays`                              |
| GET    | `/valuation/market-coverage?locationId=`     | `MarketCoverageDto`: avisos vigentes de la zona (si hay pocos, mira la zona padre), `enoughData`, último refresco      |
| POST   | `/valuation/zones/refresh` (**sólo admin**)  | Body `{ locationId }` → **202** `{ jobId }`; el avance en `GET /jobs/:id/status`                                       |

Errores: 404 `VALUATION_PROPERTY_NOT_FOUND` y `VALUATION_LOCATION_NOT_FOUND` (también de otra inmobiliaria); 422 `INSUFFICIENT_MARKET_DATA`, `VALUATION_NO_ZONE`; 429 `VALUATION_DAILY_LIMIT`; 400 de validación del cuerpo.

Estado de una fuente en `market-status`: `DISABLED` (no está en `COMPARABLES_SOURCES`), `BLOCKED` (`blocked_until` futuro), `PARSE_ERROR` (último resultado), `STALE` (sin ingreso dentro de la antigüedad máxima) u `OK`.

**La API nunca devuelve avisos individuales ni sus URLs**, sólo agregados (A-65). `market-coverage` es orientativa: no distingue categoría ni moneda.

## Variables de entorno

Todas opcionales, con default; sólo `ANTHROPIC_API_KEY` vive en Doppler (vacía por CLI) y únicamente si se activa el redactor con modelo.

| Variable                    | Default                      | Para qué                                                                      |
| --------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `COMPARABLES_SOURCES`       | `fake`                       | `fake` o `zonaprop,argenprop,mercadolibre`; `fake` no se admite en producción |
| `VALUATION_MAX_AGE_DAYS`    | `45`                         | antigüedad máxima de un aviso para tasar                                      |
| `VALUATION_MIN_COMPARABLES` | `3`                          | mínimo de avisos para dar un resultado                                        |
| `VALUATION_ZONES_PER_RUN`   | `10`                         | zonas por corrida del job                                                     |
| `VALUATION_DAILY_LIMIT`     | `30`                         | tasaciones por día y por inmobiliaria                                         |
| `VALUATION_NARRATOR`        | `template`                   | `template` o `llm`                                                            |
| `VALUATION_LLM_MODEL`       | `claude-sonnet-5-5`          | sólo con `llm`                                                                |
| `VALUATION_SCRAPER_CONTACT` | `contacto@adminprop.example` | contacto que se declara en el `User-Agent` de los scrapers                    |

## Desvíos respecto del rediseño

- El límite diario es configurable (`VALUATION_DAILY_LIMIT`) en lugar de una constante, y se cuenta en ventana móvil de 24 h, no por día calendario (D-179).
- `valuation_zones.requested_count` reemplaza a `requested_by_tenants` (D-173): se cuenta cuántas veces se pidió, no cuántos tenants.
- `valuation_source_states` es una tabla aparte (no estaba en el rediseño): hace falta para el bloqueo de 24 h y las 3 corridas seguidas entre ejecuciones (D-180).
- Códigos de error nuevos no previstos: `VALUATION_NO_ZONE`, `VALUATION_PROPERTY_NOT_FOUND`, `VALUATION_LOCATION_NOT_FOUND`. `VALUATION_NO_AREA` del rediseño no existe: sin superficie se tasa por precio absoluto y se avisa en la justificación.
- El comentario de `valuation-narrative.ts` y de `narrators.ts` cita «A-70» para la regla «el redactor sólo ve los hechos calculados»; ese número ya lo usa el rediseño de la Fase 21 (análisis y confirmación sobre el mismo lote). Es la regla D-178, no un supuesto del rediseño de la 24.

## Tests

- Unitarios: `valuation-policy.spec.ts` (outliers, pesos, percentiles ponderados, rango mín–máx, base por m², tolerancia de superficie, confianza, redondeo de presentación), `zone-key.spec.ts`, `narrators.spec.ts` (plantilla, limpieza, cifras no calculadas, fallback), `parsers.spec.ts` (cada parser contra su fixture, incluidos rediseño, vacío y roto) y `sources.spec.ts` (URL, cortesía, robots, 403/429, captcha).
- E2E `test/valuation.e2e-spec.ts` (Postgres): contrato del resultado, el precio de la propiedad no cambia, atípicos, por m² y sin superficie, no mezcla monedas ni categorías, 422 con pocos avisos (y la zona queda registrada), antigüedad máxima, ampliación a la zona padre, reutilización dentro de 6 h, 429 diario, historial paginado, validación del cuerpo, aislamiento (avisos compartidos, tasaciones no; 404 entre inmobiliarias), permisos por rol, `market-coverage` y `market-status`, job global sin duplicar, fuentes `BLOQUEADA` y `PARSE_ERROR` que no rompen a las demás, job `FAILED` si todas fallan, aviso de fuente obsoleta una vez por día y sólo a quien tasó, corrida manual 202 y auditoría.
