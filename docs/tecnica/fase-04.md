# Fase 4 — Auth y usuarios (backend)

Spec: `adminprop-repo-files/specs/fase-04-auth.md`. Rama
`feature/fase-04-auth`, un PR contra `dev`.

La fase se hizo **sin supervisión** (autorización de Giuliano del
2026-09-19): las decisiones que la spec no resolvía están en
[`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (D-16 a D-25), para
revisarlas.

Buena parte de lo que pide la spec ya existía desde la Fase 1 (login, refresh
con rotación, logout, `/auth/me`, guards, `@Roles`, `@CurrentUser`,
`RequestContext` con el tenant). Esta fase completa lo que faltaba y ajusta lo
que la spec pedía distinto.

---

## Qué se agregó

### Módulo `tenants` (task 1)

`src/modules/tenants/`, sólo lectura:

| Endpoint                            | Auth    | Para qué                                           |
| ----------------------------------- | ------- | -------------------------------------------------- |
| `GET /api/v1/tenants/current`       | Sí      | Nombre y marca de la inmobiliaria del usuario      |
| `GET /api/v1/tenants/by-slug/:slug` | Pública | Marca para el login del portal, antes de la sesión |

`TenantsFacade.findActiveIdBySlug()` es lo que usa el login de portal: auth no
lee la tabla `tenants` por su cuenta. Una inmobiliaria deshabilitada responde
404, igual que una inexistente.

### Login de portal (task 2)

- `POST /api/v1/auth/portal-login` con `{ tenantSlug, email, password, type }`
  (`type`: `OWNER` | `RENTER`).
- Propietarios e inquilinos son filas de `users` (D-16). La migración
  `scope_user_email_by_audience` reemplaza el único de `email` por dos índices
  parciales:
  - `users_internal_email_key`: `(email) WHERE role IN ('ADMIN','EMPLOYEE')`;
  - `users_portal_email_key`: `(tenant_id, role, email) WHERE role IN ('OWNER','RENTER')`.
- `POST /auth/login` sólo encuentra admins y empleados; el portal sólo
  propietarios o inquilinos de esa inmobiliaria.
- Los dos logins comparten `SignInService` (bloqueo por intentos, contraseña,
  cuenta habilitada, emisión de tokens).
- Claim `userType` en el access token (`internal` | `owner` | `renter`),
  derivado del rol. También está en `AuthenticatedUser`.
- El seed de demo suma un empleado, un propietario y un inquilino (ver
  `docs/AUTH.md`).

### Casos borde de la spec (task 3)

| Caso                                                | Antes                  | Ahora                        |
| --------------------------------------------------- | ---------------------- | ---------------------------- |
| Login de usuario o inmobiliaria deshabilitada       | `403 ACCOUNT_INACTIVE` | `401 INVALID_CREDENTIALS`    |
| Token de un usuario desactivado                     | válido hasta 15 min    | `401 SESSION_REVOKED` ya     |
| Token de una inmobiliaria inexistente/deshabilitada | válido hasta 15 min    | `401 SESSION_REVOKED` ya     |
| Cambio de rol                                       | rige al refrescar      | rige en el request siguiente |
| Rate limit de login                                 | 10 cada 15 min por IP  | 5 por minuto por IP          |
| Rate limit de refresh y logout                      | 10 cada 15 min por IP  | sólo el límite global        |

El guard valida al usuario en cada request (`JWT_VALIDATE_USER_ON_REQUEST`,
ahora `true` por defecto; D-19).

### Gestión de usuarios (task 4)

`/api/v1/users`, sólo `ADMIN`, dentro del módulo de auth (la tabla `users` es
de auth). Endpoints en `docs/AUTH.md`. Piezas:

| Pieza                   | Dónde                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| Reglas puras (+ tests)  | `domain/user-management.policy.ts`                                          |
| Excepciones de dominio  | `domain/exceptions/user-management.exceptions.ts`                           |
| Commands                | `create-user`, `update-user`, `set-user-active`, `reset-user-password`      |
| Queries                 | `list-users` (paginado), `get-user`                                         |
| Controller y DTOs       | `infrastructure/http/controllers/users.controller.ts`, `dtos/users.dtos.ts` |
| Política de contraseñas | `dtos/strong-password.decorator.ts` (la usan alta, reseteo y cambio)        |

Desactivar y resetear la contraseña revocan los refresh tokens del usuario.

### Contrato OpenAPI (task 5)

- `npm run openapi:export` → `openapi.json` en la raíz, commiteado. Arma la
  app en modo `preview` de Nest: no necesita base ni Doppler.
- El CI lo regenera y falla si difiere (job "Formato, lint y tipos").
- Prettier lo ignora: el CI lo compara byte a byte.
- El frontend genera sus tipos desde ahí (`npm run api:types`).

---

## Criterios de aceptación → tests

| Criterio (spec 7)                                              | Test                                          |
| -------------------------------------------------------------- | --------------------------------------------- |
| Login válido devuelve tokens y datos correctos                 | `test/session.e2e-spec.ts`                    |
| Credenciales inválidas → 401 genérico                          | `test/session.e2e-spec.ts`                    |
| Endpoint protegido sin token → 401                             | `test/session.e2e-spec.ts`                    |
| Token expirado → 401                                           | `test/session.e2e-spec.ts`                    |
| Refresh válido genera un access token nuevo                    | `test/session.e2e-spec.ts`                    |
| Refresh revocado (post-logout) rechazado                       | `test/session.e2e-spec.ts`                    |
| Empleado → `POST /users` → 403                                 | `test/users.e2e-spec.ts`                      |
| Mismo email de propietario en dos tenants, sin cruce           | `test/portal-login.e2e-spec.ts`               |
| Rate limit bloquea el 6to intento en el minuto                 | `test/session.e2e-spec.ts` (app con throttle) |
| Casos borde: desactivado, firma manipulada, tenant inexistente | `test/session.e2e-spec.ts`                    |
| Aislamiento entre tenants en `/users`                          | `test/users.e2e-spec.ts`                      |

Totales al cerrar: 203 unitarios (23 suites) y 100 e2e (10 suites), todos en verde.

---

## Variables de entorno

Ninguna nueva. Cambian dos defaults (no hay que tocar Doppler):

| Variable                       | Antes    | Ahora  |
| ------------------------------ | -------- | ------ |
| `JWT_VALIDATE_USER_ON_REQUEST` | false    | true   |
| `THROTTLE_AUTH_TTL` / `LIMIT`  | 900 / 10 | 60 / 5 |

---

## Pendiente / para otras fases

- **Fases 7 y 8**: crear el acceso al portal desde la ficha del propietario o
  inquilino (facade de auth) y guardar el vínculo usuario ↔ ficha.
- **Fase 14**: invitación por email al crear un usuario (hoy el admin define
  la contraseña inicial).
- **Fase 16**: el build con SWC deja `dist/main.js`, pero `start:prod`,
  `start:qa`, `start:production` y el `CMD` del Dockerfile apuntan a
  `dist/src/main`. Es previo a esta fase; hay que corregirlo antes del deploy.
- Documentar el sobre `{ success, message, data }` en las respuestas de un
  solo objeto del OpenAPI (D-24).
