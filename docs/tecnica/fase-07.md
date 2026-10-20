# Fase 7 — Propietarios (backend)

Spec: `adminprop-repo-files/specs/fase-07-propietarios.md`. Rama `feature/fase-07-propietarios`, **encadenada sobre `feature/fase-06-propiedades`**.

Hecha **sin supervisión**. Decisiones: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-38 a D-43.

## Qué quedó construido

- **Tabla `owners`** (migración `add_owners`): datos personales, DNI/CUIT normalizado a dígitos (único por inmobiliaria entre los no borrados, índice parcial), `search_name` para buscar sin acentos, cuenta bancaria en columnas propias, `portal_user_id`, borrado lógico y auditoría.
- **Módulo `src/modules/owners`**: reglas puras en `domain/owner.policy.ts` (normalización de nombre, DNI y CBU con dígitos verificadores) y `domain/reduced-fee.ts` (RN-07, única implementación); vistas con cantidad de propiedades y honorario reducido calculado; `OwnersFacade` (`exists`, `describe`) para que otros módulos validen y muestren propietarios.
- **`PropertiesFacade`** (nueva, en `properties/public`): `portfolios(ownerIds)` (total y activas por propietario) y `listByOwner`. Las propiedades ahora **validan `ownerId`** contra propietarios al crear y al editar (422 si no existe en la inmobiliaria), y la ficha de propiedad muestra el nombre del propietario.
- **`PortalAccountsFacade`** (nueva, en `auth/public`): crea o resetea el acceso al portal de un propietario (y, en la Fase 8, de un inquilino) sin que esos módulos toquen `users`.
- `Tenant` expone `reducedFeeThreshold` (ya existía en la tabla).

## Endpoints (`/api/v1/owners`, admin y empleado)

| Método | Ruta                             | Qué hace                                                                        |
| ------ | -------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/owners`                        | Paginado; `search` por nombre, apellido o DNI (sin acentos, en cualquier orden) |
| GET    | `/owners/check`                  | Chequeo en vivo para el formulario: `nationalId`, `cbu`, `excludeId`            |
| GET    | `/owners/:id`                    | Ficha completa: cuenta bancaria, sus propiedades, honorario reducido            |
| POST   | `/owners`                        | Alta (la cuenta bancaria puede venir o cargarse después)                        |
| PATCH  | `/owners/:id`                    | Editar datos personales (no toca la cuenta bancaria)                            |
| PATCH  | `/owners/:id/bank-account`       | Cambiar la cuenta bancaria (registro propio en la auditoría)                    |
| POST   | `/owners/:id/portal-credentials` | Generar o regenerar el acceso al portal; devuelve la contraseña una vez         |
| DELETE | `/owners/:id`                    | Borrado lógico (sólo admin); 409 si tiene propiedades asignadas                 |

Nombres en inglés respecto de la spec: `datos-bancarios` → `bank-account`; `aplicaHonorarioReducido` → `reducedFee`; `cantidadPropiedadesActivas` → `activePropertyCount`. El filtro `conDeuda` queda para la Fase 11 (todavía no hay cobros).

## Criterios de aceptación → tests

| Criterio                                                                     | Dónde                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| DNI repetido en la misma inmobiliaria → 409 (aun con otro formato)           | `test/owners.e2e-spec.ts`                         |
| Mismo DNI en otra inmobiliaria → permitido                                   | `test/owners.e2e-spec.ts`                         |
| 3 propiedades activas → `reducedFee: true`                                   | `test/owners.e2e-spec.ts`                         |
| 2 activas + 1 no activa → `reducedFee: false`; umbral por inmobiliaria       | `test/owners.e2e-spec.ts`, `owner.policy.spec.ts` |
| Contraseña del portal una sola vez; regenerar invalida la anterior           | `test/owners.e2e-spec.ts`                         |
| Cambio de CBU en la auditoría con antes y después                            | `test/owners.e2e-spec.ts`                         |
| Baja con propiedades → 409; empleado no borra → 403                          | `test/owners.e2e-spec.ts`                         |
| Sin email no hay acceso al portal → 422                                      | `test/owners.e2e-spec.ts`                         |
| CBU inválido (largo o dígito verificador) → 400                              | `test/owners.e2e-spec.ts`, `owner.policy.spec.ts` |
| Aislamiento entre inmobiliarias, también por id y al asignar a una propiedad | `test/owners.e2e-spec.ts`                         |

Totales: 242 unitarios y 28 e2e de propietarios, verificados el 2026-10-20 contra Postgres.

## Pendiente

- **Frontend de la fase** (listado, ficha, alta/edición con chequeo en vivo, acceso al portal): no empezado. Rama `feature/fase-07-propietarios` del frontend creada, sin commits.
- **Fase 9**: hecho: `PropertiesFacade.portfolios()` cuenta propiedades con contrato activo (D-39, cerrada en D-51).
- **Fase 11**: filtro `conDeuda` en el listado.
- **Fase 12**: historial de liquidaciones en la ficha; reutilizar `appliesReducedFee` al liquidar.
- **Fase 14**: mandar por email la contraseña del portal (hoy se muestra una vez en pantalla).
