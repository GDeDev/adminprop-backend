# Fase 10 — Servicios y gastos adelantados (backend)

Spec: `adminprop-repo-files/specs/fase-10-servicios.md`. Rama `feature/fase-10-servicios`, **encadenada sobre `feature/fase-09-contratos`**.

Hecha **sin supervisión**. Decisiones: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-63 a D-69.

## Qué quedó construido

- **Módulo `src/modules/services`** (migración `add_services`, D-63): tablas `property_services` y `advance_expenses`, las dos con tenant, auditoría y borrado lógico. Enum nuevo `ServicePayer { RENTER, OWNER }`; la frecuencia de aumento reutiliza el enum de Prisma `RentUpdateFrequency` (`IncreaseFrequency` en el dominio). Sin FKs hacia propiedades, contratos ni maestros: las referencias se validan por sus facades (`ServiceReferences`).
- **Reglas puras** en `domain/service.policy.ts` (vencimiento/aumentos obligatorios, estado `UP_TO_DATE | OVERDUE` y `daysOverdue` calculados al leer, D-64/D-65) y `domain/advance-expense.policy.ts` (monto > 0, fecha, comprobante por primeros bytes JPG/PNG/WebP/PDF hasta 10 MB, inmutabilidad una vez descontado, D-67), con sus `*.spec.ts`.
- **Vistas**: `ServiceViews` (tipo de servicio por `MasterDataFacade.describeCatalog`, propiedad por `PropertiesFacade.describe`, `scope` para los de un contrato, D-66) y `AdvanceExpenseViews` (quién lo registró por `UsersFacade.describe`, totales con `@/shared/money`).
- **Facades nuevas** (D-69): `ServicesFacade` (`listOverdue(hoy)`, `countByProperty`, `pendingExpensesByContract`, `markExpensesSettled`) para las Fases 11–13; `ContractsFacade.find(id)` (contrato en cualquier estado); `UsersFacade.describe(ids)` en `auth/public` con `UserRepository.findByIds`.
- Propiedad borrada con servicios: no hay evento; los servicios huérfanos se omiten al leer (D-68).
- El seed de demo no cambia.

## Endpoints

Admin y empleado para todo, salvo eliminar un gasto adelantado (sólo admin). Los controllers del módulo no tienen prefijo: las rutas cuelgan de propiedades, contratos, `/services` y `/advance-expenses`.

| Método | Ruta                                      | Qué hace                                                                                                                                                                                                               |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/properties/:propertyId/services`        | Todos los de la propiedad (propios y de sus contratos), cada uno con `status` y `daysOverdue`; `?contractId=` deja sólo los de ese contrato. 404 `SERVICE_PROPERTY_NOT_FOUND`                                          |
| POST   | `/properties/:propertyId/services`        | Alta; sin `contractId` es un servicio de la propiedad. Con vencimiento exige `dueDate`; con aumentos, `increaseFrequency`                                                                                              |
| GET    | `/contracts/:contractId/services`         | Los del contrato (`scope: CONTRACT`) más los heredados de la propiedad (`scope: PROPERTY`), D-66. 404 `SERVICE_CONTRACT_NOT_FOUND`                                                                                     |
| GET    | `/services/overdue`                       | Paginado; vencidos de la inmobiliaria con `property { id, address }`, los más atrasados primero; `?propertyId=`                                                                                                        |
| PATCH  | `/services/:id`                           | Todo menos la propiedad; vencimiento y aumentos se validan sobre el resultado                                                                                                                                          |
| DELETE | `/services/:id`                           | Borrado lógico (204)                                                                                                                                                                                                   |
| GET    | `/contracts/:contractId/advance-expenses` | `{ items, pendingTotal, settledTotal }`; `?settled=true\|false`. Los totales son del contrato entero. 404 `EXPENSE_CONTRACT_NOT_FOUND`                                                                                 |
| POST   | `/contracts/:contractId/advance-expenses` | Multipart `amount`, `description`, `expenseDate`, `currency?` (la del contrato si no viene) y `file` (obligatorio: JPG, PNG, WebP o PDF hasta 10 MB). El contrato puede estar en cualquier estado. `renterId` se copia |
| PATCH  | `/advance-expenses/:id`                   | `amount`, `description`, `expenseDate`; sólo mientras está pendiente (409 si ya se descontó)                                                                                                                           |
| DELETE | `/advance-expenses/:id`                   | Sólo admin; borrado lógico, sólo pendiente (409 si ya se descontó); borra el comprobante del storage (204)                                                                                                             |

Nombres en inglés respecto de la spec: `ServicioPropiedad` → `PropertyService`; `propiedad_id` → `propertyId`; `contrato_id` → `contractId`; `tipo_servicio_id` → `serviceTypeId` (en las respuestas, `serviceType { id, name, isActive }`); `quien_paga` → `paidBy` (`inquilino` → `RENTER`, `propietario` → `OWNER`); `moneda` → `currency`; `tiene_vencimiento` → `hasDueDate`; `fecha_vencimiento` → `dueDate`; `tiene_aumento` → `hasIncrease`; `frecuencia_aumento` → `increaseFrequency`; `gestionado_inmobiliaria` → `managedByAgency`; `observaciones` → `notes`; `estado` → `status` (`al_dia` → `UP_TO_DATE`, `vencido` → `OVERDUE`) + `daysOverdue`; `/services/vencidos` → `/services/overdue`. `GastoAdelantado` → `AdvanceExpense`; `gastos-adelantados` → `advance-expenses`; `inquilino_id` → `renterId`; `monto` → `amount`; `descripcion` → `description`; `comprobante_url` → `receiptUrl`; `fecha` → `expenseDate`; `descontado_en_liquidacion_id` → `settlementId` (+ `settled`, `settledAt`); `registrado_por` → `registeredBy { id, fullName }`; `?descontado=` → `?settled=`.

Enums: `ServicePayer { RENTER, OWNER }`, `IncreaseFrequency { MONTHLY, QUARTERLY, FOUR_MONTHLY }`, `ServiceStatus { UP_TO_DATE, OVERDUE }`, `ServiceScope { CONTRACT, PROPERTY }`, `Currency { ARS, USD }`. Van inline en cada propiedad del OpenAPI.

Esquemas del OpenAPI: `CreateServiceDto`, `UpdateServiceDto`, `PropertyServiceDto`, `ContractServiceDto`, `OverdueServiceDto`, `ServiceTypeRefDto`, `ServicePropertyRefDto`, `CreateAdvanceExpenseDto`, `UpdateAdvanceExpenseDto`, `AdvanceExpenseDto`, `AdvanceExpenseListDto`, `AdvanceExpenseRegisteredByDto`. Query params: `ListPropertyServicesQueryDto` (`contractId`), `ListOverdueServicesQueryDto` (`page`, `limit`, `propertyId`), `ListAdvanceExpensesQueryDto` (`settled`).

Códigos de error nuevos: `SERVICE_NOT_FOUND`, `SERVICE_PROPERTY_NOT_FOUND`, `SERVICE_CONTRACT_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `EXPENSE_CONTRACT_NOT_FOUND` (404); `SERVICE_INVALID_PROPERTY`, `SERVICE_INVALID_CONTRACT`, `SERVICE_INVALID_SERVICE_TYPE`, `EXPENSE_INVALID_CONTRACT` (422); `SERVICE_DUE_DATE_REQUIRED`, `SERVICE_INCREASE_FREQUENCY_REQUIRED`, `SERVICE_INVALID_DATE`, `EXPENSE_RECEIPT_REQUIRED`, `EXPENSE_INVALID_RECEIPT`, `EXPENSE_INVALID_AMOUNT`, `EXPENSE_INVALID_DATE` (400); `EXPENSE_ALREADY_SETTLED` (409).

## Criterios de aceptación → tests

| Criterio                                                                                         | Dónde                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `hasDueDate: true` sin `dueDate` → 400; `hasIncrease: true` sin frecuencia → 400                 | `test/services.e2e-spec.ts`, `service.policy.spec.ts`         |
| Un servicio con vencimiento pasado aparece vencido en `GET /services/overdue`, con `daysOverdue` | `test/services.e2e-spec.ts`, `service.policy.spec.ts`         |
| Vencidos ordenados del más atrasado al menos; filtro por propiedad; `ServicesFacade.listOverdue` | `test/services.e2e-spec.ts`                                   |
| Tipo de servicio de otra inmobiliaria o desactivado → 422; contrato de otra propiedad → 422      | `test/services.e2e-spec.ts`                                   |
| `GET /contracts/:id/services` mezcla propios y heredados con `scope`; otro contrato no se mezcla | `test/services.e2e-spec.ts`                                   |
| PATCH evalúa el servicio resultante; DELETE es lógico                                            | `test/services.e2e-spec.ts`                                   |
| Gasto sin comprobante → 400; con algo que no es imagen ni PDF → 400; con PDF o JPG → 201         | `test/services.e2e-spec.ts`, `advance-expense.policy.spec.ts` |
| Listado con `settled` y totales pendiente/descontado                                             | `test/services.e2e-spec.ts`                                   |
| Eliminar o editar un gasto ya descontado → 409; `markExpensesSettled` sólo toca pendientes       | `test/services.e2e-spec.ts`, `advance-expense.policy.spec.ts` |
| Eliminar un gasto es sólo admin (empleado → 403)                                                 | `test/services.e2e-spec.ts`                                   |
| Un contrato rescindido sigue aceptando y listando gastos (spec 7)                                | `test/services.e2e-spec.ts`                                   |
| Aislamiento entre inmobiliarias (servicios y gastos, incluido cruzar propiedad o contrato ajeno) | `test/services.e2e-spec.ts`                                   |

Totales: 327 unitarios (19 nuevos: `service.policy.spec.ts`, `advance-expense.policy.spec.ts`), 19 e2e de servicios y gastos, verificados el 2026-10-20 contra Postgres. La suite e2e completa (17 archivos, 246 tests) pasa corrida sola contra `adminprop_test`.

## Pendiente

- **Frontend de la fase** (sección de servicios en la ficha de propiedad con alta rápida, servicios del contrato, gastos adelantados en la ficha de contrato con comprobante): no empezado.
- **Fase 12**: descontar los gastos pendientes en la liquidación (`pendingExpensesByContract` + `markExpensesSettled`), incluido el cierre de cuentas de un contrato rescindido (spec 7); decidir qué hacer con un gasto en otra moneda que la del contrato (D-67).
- **Fase 13**: alerta de servicio vencido a partir del 5° día (`ServicesFacade.listOverdue`, RN-13).
- Limpieza real de los servicios de una propiedad borrada, si alguna vez hace falta (D-68).
