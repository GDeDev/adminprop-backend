# Fase 8 — Inquilinos y garantes (backend)

Spec: `adminprop-repo-files/specs/fase-08-inquilinos-garantes.md`. Rama `feature/fase-08-inquilinos`, **encadenada sobre `feature/fase-07-propietarios`**.

Hecha **sin supervisión**. Decisiones: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-44 a D-50.

## Qué quedó construido

- **Tablas `renters` y `guarantors`** (migración `add_renters`): datos personales, DNI/CUIT normalizado a dígitos (único por inmobiliaria entre los no borrados, índice parcial), `search_name` para buscar sin acentos, borrado lógico y auditoría. `renters` suma `move_in_date` (`DATE`), `guarantor_id` (FK real a `guarantors`, `RESTRICT`) y `portal_user_id` (sin FK: auth). `guarantors` suma `guarantee_type` (enum `GuaranteeType`: `PROPERTY | PAYSLIPS`) y `guarantee_detail` (texto libre, no vacío).
- **Módulo `src/modules/renters`** (D-47): un solo módulo con las dos entidades. Reglas puras en `domain/renter.policy.ts` (DNI, fecha de ingreso) y `domain/guarantor.policy.ts` (DNI, detalle de garantía); `RenterViews` arma listados y fichas con los garantes resueltos en una consulta; `RentersFacade` (`exists`, `describe`) para la Fase 9. La baja del inquilino consulta el puerto `RenterContracts` (`NoContractsYet` hasta la Fase 9).
- **`src/shared/people/person-policy.ts`** (D-48): normalización de nombre, DNI, email y búsqueda compartida por propietarios, inquilinos y garantes. `OwnerPolicy` ahora delega ahí.
- **`PortalCredentialsDto`** pasó a `auth/public` (D-50); el acceso al portal del inquilino usa `PortalAccountsFacade` con rol `RENTER`.
- El seed de demo no cambia: la Fase 7 tampoco creó un propietario de demo (sólo usuarios de portal).

## Endpoints (admin y empleado; borrar, sólo admin)

| Método | Ruta                              | Qué hace                                                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/renters`                        | Paginado; `search` por nombre, apellido o DNI; `paymentStatus` y `propertyId` se validan pero no filtran aún (D-46) |
| GET    | `/renters/check`                  | Chequeo en vivo del DNI: `nationalId`, `excludeId`                                                                  |
| GET    | `/renters/:id`                    | Ficha: garante expandido, `activeContract: null` (Fase 9), `payments: []` (Fase 11)                                 |
| POST   | `/renters`                        | Alta; `guarantorId` opcional, 422 si no existe en la inmobiliaria (D-44)                                            |
| PATCH  | `/renters/:id`                    | Edición, incluido `guarantorId` (null para sacarlo); queda en la auditoría                                          |
| POST   | `/renters/:id/portal-credentials` | Generar o regenerar el acceso al portal; devuelve la contraseña una vez; 422 sin email                              |
| DELETE | `/renters/:id`                    | Borrado lógico; 409 con contrato activo (`RenterContracts`); corta el acceso al portal                              |
| GET    | `/guarantors`                     | Paginado; `search` por nombre, apellido o DNI; cada uno con `renterCount`                                           |
| GET    | `/guarantors/check`               | Chequeo en vivo del DNI: `nationalId`, `excludeId`                                                                  |
| GET    | `/guarantors/:id`                 | Ficha con los inquilinos que garantiza (`renters: { id, fullName }[]`)                                              |
| POST   | `/guarantors`                     | Alta; 400 `GUARANTOR_DETAIL_REQUIRED` con el detalle vacío                                                          |
| PATCH  | `/guarantors/:id`                 | Edición                                                                                                             |
| DELETE | `/guarantors/:id`                 | Borrado lógico; 409 `GUARANTOR_IN_USE` si algún inquilino lo tiene de garante (D-45)                                |

Nombres en inglés respecto de la spec: `inquilino` → `renter` (no `tenant`: es la inmobiliaria); `garante` → `guarantor`; `fechaIngreso` → `moveInDate`; `tipoGarantia` → `guaranteeType` (`propiedad` → `PROPERTY`, `recibos_sueldo` → `PAYSLIPS`); `detalleGarantia` → `guaranteeDetail`; `estadoPago` → `paymentStatus` (`al_dia` → `UP_TO_DATE`, `moroso` → `OVERDUE`); `propiedadId` → `propertyId`.

Esquemas del OpenAPI: `CreateRenterDto`, `UpdateRenterDto`, `RenterSummaryDto`, `RenterDetailDto`, `RenterGuarantorDto`, `RenterRefDto`, `RenterDataCheckDto`, `CreateGuarantorDto`, `UpdateGuarantorDto`, `GuarantorSummaryDto`, `GuarantorDetailDto`, `GuarantorRefDto`, `GuarantorDataCheckDto`, `PortalCredentialsDto`. Los enums van inline en cada propiedad.

Códigos de error nuevos: `RENTER_NOT_FOUND`, `RENTER_NATIONAL_ID_TAKEN`, `RENTER_INVALID_NATIONAL_ID`, `RENTER_INVALID_MOVE_IN_DATE`, `RENTER_INVALID_GUARANTOR`, `RENTER_EMAIL_REQUIRED`, `RENTER_HAS_ACTIVE_CONTRACT`, `GUARANTOR_NOT_FOUND`, `GUARANTOR_NATIONAL_ID_TAKEN`, `GUARANTOR_INVALID_NATIONAL_ID`, `GUARANTOR_DETAIL_REQUIRED`, `GUARANTOR_IN_USE`.

## Criterios de aceptación → tests

| Criterio                                                                        | Dónde                                               |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| DNI repetido en la misma inmobiliaria → 409 (aun con otro formato)              | `test/renters.e2e-spec.ts`                          |
| Mismo DNI en otra inmobiliaria → permitido; un borrado libera su DNI            | `test/renters.e2e-spec.ts`                          |
| Garante inexistente → 422 (la spec decía 400, D-44)                             | `test/renters.e2e-spec.ts`                          |
| Un garante vinculado a dos inquilinos sin error                                 | `test/renters.e2e-spec.ts`                          |
| Garante con detalle vacío → 400                                                 | `test/renters.e2e-spec.ts`, `renter.policy.spec.ts` |
| Borrar un garante en uso → 409; sin inquilinos → 204                            | `test/renters.e2e-spec.ts`                          |
| Borrar un inquilino sin contratos → 204 y corta el portal; empleado → 403       | `test/renters.e2e-spec.ts`                          |
| Portal: sin email → 422; contraseña una vez; regenerar invalida; login `RENTER` | `test/renters.e2e-spec.ts`                          |
| Cambio de garante en la auditoría con antes y después (spec 7)                  | `test/renters.e2e-spec.ts`                          |
| Búsqueda por nombre o DNI, sin acentos y en cualquier orden                     | `test/renters.e2e-spec.ts`, `person-policy.spec.ts` |
| `paymentStatus` y `propertyId` se validan pero no filtran                       | `test/renters.e2e-spec.ts`                          |
| Fecha de ingreso inválida → 400                                                 | `test/renters.e2e-spec.ts`, `renter.policy.spec.ts` |
| Aislamiento entre inmobiliarias (inquilino, garante y vínculo cruzado)          | `test/renters.e2e-spec.ts`                          |
| Botón WhatsApp con `wa.me`                                                      | Frontend (pendiente)                                |

Totales: 272 unitarios (30 nuevos: `person-policy.spec.ts` y `renter.policy.spec.ts`) y 31 e2e de inquilinos y garantes, verificados el 2026-10-20 contra Postgres. La suite e2e completa (14 archivos, 188 tests) pasa corrida sola contra `adminprop_test`; corrida en paralelo con otra cosa que toque esa base, los archivos que comparten tablas fallan entre sí.

## Pendiente

- **Frontend de la fase** (listado, ficha con WhatsApp, alta/edición con garante inline, pantalla de garantes): no empezado.
- **Fase 9**: reemplazar `NoContractsYet` por la implementación que consulta contratos; hacer filtrar `propertyId`; completar `activeContract`; usar `RentersFacade` al armar contratos.
- **Fase 11**: calcular `paymentStatus` y hacer filtrar el parámetro; completar `payments`.
- **Fase 14**: mandar por email la contraseña del portal (hoy se muestra una vez en pantalla).
