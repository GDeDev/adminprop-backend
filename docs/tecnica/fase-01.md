# Fase 1 — Arquitectura técnica (backend)

Spec: `adminprop-repo-files/specs/fase-01-arquitectura.md`. Se entregó en dos
PR contra `dev`:

- **PR #1** (tasks 1-3): tooling, Postgres 16 y dinero.
- **PR #2** (tasks 4-14): multi-tenant, estructura modular, errores, puertos de
  infraestructura, jobs asíncronos, módulo de referencia, Doppler y esta
  documentación.

Decisiones que la spec no resolvía: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md)
(D-01 a D-15). Decisiones de alcance tomadas con Giuliano:
`adminprop-repo-files/docs/PROGRESO.md`.

---

## Qué quedó construido

### Base (PR #1)

| Pieza           | Dónde                              | Notas                                                                         |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Pre-commit      | `.husky/`, `lint-staged.config.js` | prettier + eslint + tests relacionados; un commit en rojo no entra            |
| Postgres 16     | `docker-compose.yml`               | bases `adminprop_development` y `adminprop_test`                              |
| Convenciones DB | `prisma/schema.prisma`             | UUID `gen_random_uuid()`, `timestamptz`, tablas y columnas `snake_case`       |
| Dinero          | `src/shared/money`                 | decimal.js, `ROUND_HALF_UP` a 2 decimales, `@IsMoneyAmount()`; nunca `number` |

### Multi-tenant (task 4) — [`MULTI-TENANCY.md`](../MULTI-TENANCY.md)

- Entidad `Tenant` con los parámetros de negocio del PRD §5.0 y sus defaults.
- `tenantId` en `User`, en el JWT (`{ sub, email, role, tenantId }`) y en el
  `RequestContext` (AsyncLocalStorage).
- **Extensión de Prisma que filtra por tenant** todas las consultas de los
  modelos declarados `tenantScoped`. Falla cerrado sin tenant. Un id de otro
  tenant da `null`/`P2025` → **404**.
- `prisma.unscoped` sólo para login (por email) y refresh (por id).
- `RequestContext.runInTenant()` para workers, crons y scripts.
- Roles `ADMIN | EMPLOYEE | OWNER | RENTER`. Sin registro público.
- `audit_logs` en inglés y con `tenantId`.
- Alta de clientes con `npm run tenant:create`. El seed sólo crea una
  inmobiliaria demo para desarrollo (fix posterior al PR #2, ver D-15).
- `tenant-scoped-models.spec.ts`: un modelo con `tenantId` sin declarar rompe
  los tests.

### Estructura modular (task 5)

```
src/modules/<modulo>/{domain,application,infrastructure,public}
src/platform/<puerto>/        queue, storage, feature-flags, email
src/shared/                   config, context, prisma, money, errors, ...
```

`eslint-plugin-boundaries` (`.eslintrc.js`): otro módulo sólo por `public/`;
el dominio no importa capas externas; `shared` y `platform` no dependen de
módulos de negocio. Detalle en el CLAUDE.md del repo.

### Errores (task 6) — [`ERROR-HANDLING.md`](../ERROR-HANDLING.md)

- `DomainException` (sin Nest) con `DomainErrorKind` → el filtro global lo
  traduce a 404 / 409 / 422 / 403.
- Cuerpo único (`buildErrorBody`): `{ success:false, statusCode, error, code,
message, errors[], correlationId, timestamp, path }`.

### Puertos de infraestructura (tasks 7-9)

| Puerto            | Adapters                                 | Selección                | Doc                                       |
| ----------------- | ---------------------------------------- | ------------------------ | ----------------------------------------- |
| `QueuePort`       | pg-boss 10, memoria                      | `QUEUE_PROVIDER`         | [`QUEUE.md`](../QUEUE.md)                 |
| `StoragePort`     | local (`/files`), Cloudinary             | `STORAGE_PROVIDER`       | [`STORAGE.md`](../STORAGE.md)             |
| `FeatureFlagPort` | Flagsmith (identity por tenant), memoria | `FEATURE_FLAGS_PROVIDER` | [`FEATURE-FLAGS.md`](../FEATURE-FLAGS.md) |
| `EmailPort`       | consola                                  | `EMAIL_PROVIDER`         | [`FEATURE-FLAGS.md`](../FEATURE-FLAGS.md) |

- Los mensajes de la cola viajan con tenant, usuario y correlationId; el
  consumidor corre dentro de ese tenant. Reintentos por cola y dead-letter
  `<cola>__dead_letter`.
- Los archivos se guardan bajo `tenants/<tenantId>/`; borrar una key ajena
  falla.
- Las credenciales de un proveedor se exigen al arrancar sólo si está elegido.
- Ningún módulo de negocio importa un SDK de proveedor.

### Auditoría (task 10, fundida en la 4)

Se mantiene la extensión de Prisma (opt-in por modelo en
`auditable-models.ts`) en lugar del `AuditInterceptor`/`@Audit()` de la spec:
registra usuario, acción, entidad, id, diff antes/después y ahora el tenant,
sin que cada handler escriba código. Ver [`AUDIT-SOFT-DELETE.md`](../AUDIT-SOFT-DELETE.md).

### Jobs asíncronos (task 11) — [`ASYNC-JOBS.md`](../ASYNC-JOBS.md)

- Tabla `async_jobs` y módulo `jobs` con `AsyncJobsFacade` en `public/`.
- `GET /api/v1/jobs/:id/status`, único para toda la app (ADMIN y EMPLOYEE).

### Módulo de referencia (task 12) — [`src/modules/_example/README.md`](../../src/modules/_example/README.md)

`_example` + `_example-listener`: entidad con tenant, dinero, auditoría y soft
delete; Domain Service puro; Command/Query; `DomainException`; `StoragePort`;
feature flag por tenant; acción pesada con `202` + `AsyncJob` + pg-boss con
reintento simulado; evento por `EventBus` transportado por pg-boss hacia un
segundo módulo que sólo usa la facade pública. **No se borra.**

### Doppler (task 13) — [`CONFIGURATION.md`](../CONFIGURATION.md)

- No hay `.env`: `ConfigModule` con `ignoreEnvFile` y sin dotenv.
- Los scripts de desarrollo corren dentro de `doppler run --`
  (`start*`, `prisma:migrate*`, `prisma:seed`, `prisma:studio`, `docker:prod`).
- Tests y CI usan valores descartables propios (D-01).
- `.env.example` documenta todas las variables.

---

## Tests

| Suite     | Qué cubre                                                                     | Cómo corre                                    |
| --------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| Unitarios | Domain services, handlers, extensiones, adapters, config (192 tests)          | `npm test`, sin base                          |
| e2e       | Aislamiento por tenant, login/JWT, cola real, jobs, módulo de referencia (47) | `npm run test:e2e`, Postgres `adminprop_test` |

Los e2e usan `TEST_DATABASE_URL` (nunca el `DATABASE_URL` del entorno), migran
solos, truncan antes de cada test y se niegan a correr contra una base que no
termine en `_test`.

## Criterios de aceptación de la spec

- [x] Documento revisado y aprobado por Giuliano antes de codear (sesiones del
      2026-09-18).
- [x] Helpers de dinero testeados con casos de redondeo (`src/shared/money`;
      en el backend y no en `packages/shared-utils`, ver PROGRESO).
- [x] `docker-compose.yml` con Postgres local.
- [x] `modules/_example` completo, que no se borra, con tests unit y e2e y su
      documentación.
- [x] `doppler run -- npm run start:dev` levanta la API con los secretos de
      Doppler.

Casos borde: request sin JWT → 401 (`app.e2e-spec.ts`); recurso de otro tenant
→ 404 (`tenancy`, `jobs` y `example` e2e); 5% de 150.333,33 → 157.850,00 con
`ROUND_HALF_UP` (`example-item.policy.spec.ts` y `example.e2e-spec.ts`).

## Pendientes que heredan otras fases

- Filtrar `audit_logs` por tenant al leerlos (Fase 20, D-04).
- Auditar `Tenant` cuando tenga ABM (D-05).
- Outbox para eventos que no pueden perderse (Fase 11, D-14).
- Adapter de email real, Resend vía Novu (Fase 14).
- Integración de Doppler con la plataforma de deploy (Fase 16).
- `POST /users` y el resto de auth (Fase 4).
