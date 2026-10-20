# Fase 9 — Contratos (backend)

Spec: `adminprop-repo-files/specs/fase-09-contratos.md`. Rama `feature/fase-09-contratos`, **encadenada sobre `feature/fase-08-inquilinos`**.

Hecha **sin supervisión**. Decisiones: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-51 a D-62, y los supuestos A-1 (depósito estático) y A-2 (USD sin cotización), marcados ahí con "qué cambia si Micaela responde distinto".

## Qué quedó construido

- **Propiedades e inquilinos conocen su contrato activo** (migración `track_active_contract`, D-51): `properties.active_contract_id` + `last_contract_id` y `renters.active_contract_id`, sin FK, escritas sólo por `PropertiesFacade.attachContract/detachContract` (que también cambian el estado a `RENTED`/`AVAILABLE`) y `RentersFacade.attachContract/detachContract`. Los puertos `PropertyContracts` y `RenterContracts` ahora tienen implementación real (`NoContractsYet` ya no existe): una propiedad con contrato activo no vuelve a disponible a mano (409) y una con historial no se borra; un inquilino con contrato activo no se borra. `PropertiesFacade.portfolios()` cuenta como activas las propiedades con contrato activo (cierra D-39). Nuevas en las facades: `PropertiesFacade.find/describe`, `RentersFacade.find/guarantorExists/describeGuarantors`, `TenantsFacade.getContractSettings` (honorarios, umbral, días de aviso).
- **Módulo `src/modules/indices`** (migración `add_index_values`, D-54): tabla global `index_values` (ICL/IPC por mes, `DECIMAL(14,6)`), carga manual por `POST /indices` (admin) y consulta por `GET /indices?type=`; `IndicesFacade.getValue(tipo, período)`.
- **Módulo `src/modules/contracts`** (migración `add_contracts`): tablas `contracts` (auditada, sin borrado lógico, con índices únicos parciales de un activo por propiedad y por inquilino) y `contract_rent_updates` (historial del alquiler, D-53). Reglas puras en `domain/contract.policy.ts` (fechas, caución, honorarios, próximo aumento, aumento por índice, prorrateo de la rescisión, por vencer/vencido/póliza vencida, línea de tiempo), con `contract.policy.spec.ts`. `ContractViews` arma listado y ficha resolviendo propiedad, propietario, inquilino y garante por las facades; `ContractParties` valida partes y fija honorarios; `ContractLifecycle` da `listDueForRentUpdate` y `finishExpired` al cron. `ContractsFacade` (`exists`, `getActiveByProperty`, `currentRent`, `listDueForRentUpdate`, `finishExpired`) para las Fases 10, 11 y 13.
- **`PrismaService.transaction(fn)`** y `src/shared/prisma/transaction-context.ts` (D-52): transacciones que atraviesan módulos sin cambiar firmas; `prisma.db` devuelve el cliente de la transacción abierta.
- **`src/shared/dates/calendar-date.ts`**: aritmética de fechas `AAAA-MM-DD` (sumar días y meses, contar días y meses enteros, período `AAAA-MM`), con tests.
- El seed de demo no cambia.

## Endpoints

Contratos: admin y empleado para todo (no hay `DELETE`). Índices: consultar admin y empleado, cargar sólo admin.

| Método | Ruta                                 | Qué hace                                                                                                                                                      |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/contracts`                         | Paginado; `status`, `propertyId`, `renterId`, `ownerId`, `expiringSoon=true` (activos que vencen dentro de `tenant.contractExpiryNoticeDays`, hoy inclusive)  |
| GET    | `/contracts/:id`                     | Ficha: partes, garante, caución, rescisión, `rentUpdates` (historial), `nextRentUpdateOn`, `timeline`, `monthlyStatus: []` (Fase 11)                          |
| GET    | `/contracts/:id/termination-preview` | `?notifiedAt=AAAA-MM-DD`: desglose de la multa sin rescindir                                                                                                  |
| POST   | `/contracts`                         | Alta; el propietario sale de la propiedad (D-58), el garante del inquilino si no se indica; honorarios fijados al crear (D-57); la propiedad pasa a alquilada |
| PATCH  | `/contracts/:id`                     | Sólo `notes`, `guarantorId` y `surety { hasSurety, insurerName, insurerAlertEmail, policyNumber, policyExpiresAt }` (D-55)                                    |
| POST   | `/contracts/:id/documents/contract`  | Multipart `file`, PDF hasta 10 MB; reemplaza al anterior (D-62)                                                                                               |
| POST   | `/contracts/:id/documents/policy`    | Ídem, para la póliza de caución                                                                                                                               |
| POST   | `/contracts/:id/rent-updates`        | Aplica el próximo aumento programado; `{ newRent }` para FIXED/OTHER; ICL/IPC usa los índices (D-60). Es el mismo command que va a usar el cron de la Fase 13 |
| POST   | `/contracts/:id/terminate`           | `{ notifiedAt }`: guarda multa y canon futuro (D-56), estado `TERMINATED`, propiedad a disponible, inquilino libre                                            |
| POST   | `/contracts/:id/renew`               | Contrato nuevo activo precargado con el original (todo opcional salvo `startDate`/`endDate`; `renterId` puede cambiar); el original queda `FINISHED` (D-61)   |
| GET    | `/indices`                           | `?type=ICL\|IPC`: valores cargados, del más reciente al más viejo                                                                                             |
| POST   | `/indices`                           | `{ indexType, period "AAAA-MM", value }` (sólo admin); 409 si el mes ya está cargado                                                                          |

Nombres en inglés respecto de la spec: `propiedadId` → `propertyId`; `propietarioId` no se recibe (D-58); `inquilinoId` → `renterId`; `garanteId` → `guarantorId`; `fechaInicio/fechaFin` → `startDate/endDate`; `montoInicial` → `initialRent`; `moneda` → `currency`; `tipoActualizacion` → `rentUpdateType` (`Fijo` → `FIXED`, `Otro` → `OTHER`); `frecuenciaAumento` → `rentUpdateFrequency` (`mensual` → `MONTHLY`, `trimestral` → `QUARTERLY`, `cuatrimestral` → `FOUR_MONTHLY`); `deposito` → `deposit`; `honorariosPct` → `feePercentage`; `estado` → `status` (`activo` → `ACTIVE`, `finalizado` → `FINISHED`, `rescindido` → `TERMINATED`); `tieneCaucion` → `hasSurety`; `aseguradoraNombre` → `insurerName`; `aseguradoraEmailAlerta` → `insurerAlertEmail`; `polizaNumero` → `policyNumber`; `polizaVencimiento` → `policyExpiresAt`; `porVencer` → `expiringSoon`; `upload-pdf` → `documents/contract`; `upload-poliza` → `documents/policy`; `rescindir` → `terminate` (`fechaNotificacion` → `notifiedAt`, `multa` → `penalty`, `saldoCanonFuturo` → `futureRent`, `diasRestantes` → `remainingDays` + `remainingMonths`); `renovar` → `renew`; `actualizar-canon` → `rent-updates`. `servicios` no se recibe (Fase 10, D-59).

Enums: `ContractStatus { ACTIVE, FINISHED, TERMINATED }`, `RentUpdateType { ICL, IPC, FIXED, OTHER }`, `RentUpdateFrequency { MONTHLY, QUARTERLY, FOUR_MONTHLY }`, `RentUpdateSource { INITIAL, INDEX, MANUAL }`, `Currency { ARS, USD }`, `IndexType { ICL, IPC }`. Van inline en cada propiedad del OpenAPI.

Esquemas del OpenAPI: `CreateContractDto`, `UpdateContractDto`, `PartialSuretyDto`, `RenewContractDto`, `ApplyRentUpdateDto`, `TerminateContractDto`, `ContractSummaryDto`, `ContractDetailDto`, `ContractPropertyRefDto`, `ContractPartyRefDto`, `ContractSuretyDto`, `ContractTerminationDto`, `ContractRentUpdateDto`, `ContractTimelineDto`, `TerminationPreviewDto`, `TerminationResultDto`, `RegisterIndexValueDto`, `IndexValueDto`; en inquilinos, `RenterActiveContractDto`.

Códigos de error nuevos: `CONTRACT_NOT_FOUND` (404); `CONTRACT_PROPERTY_ALREADY_RENTED`, `CONTRACT_RENTER_ALREADY_ACTIVE`, `CONTRACT_NOT_ACTIVE`, `CONTRACT_RENT_UPDATE_NOT_DUE` (409); `CONTRACT_INVALID_PROPERTY`, `CONTRACT_PROPERTY_WITHOUT_OWNER`, `CONTRACT_INVALID_RENTER`, `CONTRACT_INVALID_GUARANTOR`, `CONTRACT_INDEX_MISSING` (422); `CONTRACT_INVALID_DATE`, `CONTRACT_DATES_INVALID`, `CONTRACT_SURETY_EMAIL_REQUIRED`, `CONTRACT_INVALID_DOCUMENT`, `CONTRACT_NEW_RENT_REQUIRED`, `CONTRACT_TERMINATION_DATE_INVALID`, `CONTRACT_RENEWAL_START_INVALID` (400); `INDEX_NOT_FOUND` (404), `INDEX_PERIOD_TAKEN` (409), `INDEX_INVALID_PERIOD`, `INDEX_INVALID_VALUE` (400).

## Criterios de aceptación → tests

| Criterio                                                                                       | Dónde                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Propiedad con contrato activo → 409; inquilino con contrato activo → 409                       | `test/contracts.e2e-spec.ts`                            |
| El alta deja la propiedad alquilada, al inquilino vinculado y el canon inicial en el historial | `test/contracts.e2e-spec.ts`                            |
| Caución sin email de alerta → 400; fin ≤ inicio → 400                                          | `test/contracts.e2e-spec.ts`, `contract.policy.spec.ts` |
| `feePercentage` refleja el estado del propietario al crear (5 % vs 3 %, umbral del tenant)     | `test/contracts.e2e-spec.ts`, `contract.policy.spec.ts` |
| Rescindir calcula la multa (ejemplo numérico) y devuelve la propiedad a disponible             | `test/contracts.e2e-spec.ts`, `contract.policy.spec.ts` |
| Renovar finaliza el original y crea uno activo; con otro inquilino también                     | `test/contracts.e2e-spec.ts`                            |
| `expiringSoon=true` respeta `contractExpiryNoticeDays`                                         | `test/contracts.e2e-spec.ts`, `contract.policy.spec.ts` |
| Aumento FIXED con monto; ICL con índices; índice faltante → 422; antes de fecha → 409          | `test/contracts.e2e-spec.ts`, `contract.policy.spec.ts` |
| PDFs del contrato y la póliza; un no-PDF → 400                                                 | `test/contracts.e2e-spec.ts`                            |
| Propiedad con contrato no vuelve a disponible a mano; con historial no se borra                | `test/contracts.e2e-spec.ts`                            |
| `finishExpired` y `listDueForRentUpdate` (cron de la Fase 13)                                  | `test/contracts.e2e-spec.ts`                            |
| Aislamiento entre inmobiliarias (ver, operar y cruzar partes)                                  | `test/contracts.e2e-spec.ts`                            |
| Índices: sólo admin carga, un mes no se pisa, globales entre inmobiliarias                     | `test/indices.e2e-spec.ts`                              |
| Una alquilada a mano sin contrato no cuenta para el honorario reducido                         | `test/owners.e2e-spec.ts`                               |

Totales: 308 unitarios (36 nuevos: `calendar-date.spec.ts`, `index-value.policy.spec.ts`, `contract.policy.spec.ts`), 33 e2e de contratos y 5 de índices, verificados el 2026-10-20 contra Postgres. La suite e2e completa (16 archivos, 227 tests) pasa corrida sola contra `adminprop_test`.

## Pendiente

- **Frontend de la fase** (listado con badges, ficha con timeline y caución, wizard de alta, rescisión con vista previa): no empezado.
- **Fase 10**: servicios del contrato (`property_services.contract_id`); el paso 5 del wizard se completa ahí.
- **Fase 11**: `monthlyStatus` de la ficha, cobro de la multa de rescisión, cotización de los contratos en USD (A-2).
- **Fase 13**: job de índices (`source` distinto de `manual`), cron que llama a `listDueForRentUpdate` + `ApplyRentUpdateCommand` y a `finishExpired`, alertas de vencimiento de contrato y de póliza (RN-12, RN-16).
- **Consultas a Micaela**: depósito estático o actualizable (A-1); si confirma, ver qué cambia en D-56/A-1.
