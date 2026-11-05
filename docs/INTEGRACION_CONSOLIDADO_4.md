# Integración `integration/consolidado-4`

Rama creada a partir de `origin/fix/arranque-local-backend` (c1c3d65: consolidado-3
más la auditoría de "listo para local" y los arreglos de arranque). Tres ramas
mergeadas una por una con `git merge --no-ff`, con push después de cada commit.
Fecha: 2026-11-05. No se usó Doppler ni `--no-verify`.

## Ramas mergeadas (en este orden)

| #   | Rama                                    | Conflictos                               |
| --- | --------------------------------------- | ---------------------------------------- |
| 1   | `origin/feat/brechas-micaela-2-backend` | No                                       |
| 2   | `origin/fix/datos-2-backend`            | Sí, 1 archivo (`DECISIONES_TECNICAS.md`) |
| 3   | `origin/docs/migracion-tokko`           | No (sólo docs)                           |

Después de los merges hay un commit propio: `fix(billing)` (ver más abajo).

## Conflictos y criterio

### 1. `feat/brechas-micaela-2-backend`

Merge limpio. Trae D-234..D-238, migraciones `20261108*` (totales del
consolidado con desglose de ajustes, aplicación automática del saldo a favor al
generar), `payments.registered_by_id` nullable y `credit-application.ts` /
`installment-credit-applier.ts`.

### 2. `fix/datos-2-backend`

- **`docs/DECISIONES_TECNICAS.md`**: único conflicto textual (las dos ramas
  agregaron bloques al final). Se dejaron los dos bloques: D-234..D-238 y después
  D-240..D-245. Sin duplicados (`grep '^### D-'` + `uniq -d` vacío). El hueco
  **D-239** es a propósito (la rama de datos saltó de D-233 a D-240 para no
  chocar); se actualizó la nota de numeración de esa rama (decía "renumerar al
  fusionar") para aclarar que no hay nada que renumerar.
- **Merges automáticos revisados a mano** (sin marcadores, pero con riesgo de
  mezcla incorrecta):
  - `payment.handlers.ts`: conserva ambos comportamientos. `RegisterPayment`
    toma `lockForUpdate` antes de leer saldos, usa `Idempotency-Key` y llama a
    `applyCreditPlan`/`publishConfirmed` (de `credit-application.ts`).
    `ApplyCredit` hace lock, relee la cuota y recién ahí saldos y créditos: el
    mismo orden de locks.
  - `reports.service.ts`: `dashboard()` (GROUP BY de la rama de datos) y el
    reporte de ingresos (rama de reglas) conviven; `tsc`, unitarios y e2e
    `reports`/`dashboard-contract` pasan.
  - `schema.prisma`, `billing.ports.ts`, `billing.module.ts`: unión de ambos
    lados; `migrate diff` sin drift (abajo).
- **`openapi.json`**: lo mergeó git; se regeneró con `npm run openapi:export` y
  no hubo diferencia respecto del resultado del merge.
- **CHECK vs columnas nuevas**: se revisaron los CHECK de
  `20261110130000_add_check_constraints` contra las columnas de la otra rama.
  Ningún CHECK toca los campos nuevos del consolidado (retenciones y adelantos,
  que tienen signo), ni `registered_by_id`, ni el flag de aplicación automática.
  Los de `payments` (`amount > 0`, aplicados `>= 0`) valen para los pagos
  `CREDIT_APPLICATION` que genera el saldo a favor. Lo confirman los e2e de
  billing, settlements y check-constraints.
- **Únicos**: la guardia de duplicados corre sobre la base vacía sin problema;
  las migraciones `20261108*` no agregan filas que la violen.

### 3. `docs/migracion-tokko`

Merge limpio: `docs/MIGRACION_TOKKO_PASO_A_PASO.md` y `docs/migracion/ejemplo/`.

### Arreglo propio (commit aparte): el generador no tomaba el lock

`InstallmentCreditApplier.applyIfAutomatic` (D-237, rama de reglas) leía saldos y
saldo a favor **fuera** de la transacción y nunca tomaba el lock de la cuota, a
diferencia de `RegisterPayment` y `ApplyCredit` (D-243, rama de datos). Un pago o
una aplicación manual en carrera podía gastar dos veces el mismo saldo. Ahora,
dentro de la transacción: `lockForUpdate` → releer la cuota → saldos → créditos
disponibles → plan → aplicar (mismo orden que los otros dos). La idempotencia de
la generación no cambia: sólo se llama con cuotas que `createIfAbsent` acaba de
crear. Test: `installment-credit-applier.spec.ts` (orden lock/lectura dentro de
la transacción, saldos releídos tras el lock, modo manual sin efectos, cuota
inexistente).

## Migraciones

Orden por timestamp: `20261108120000`, `20261108130000`, luego `20261110120000`
… `20261110150000`.

## Comandos corridos y resultado

Base propia: PostgreSQL 16 del contenedor (`service postgresql start`), rol
descartable `c4` y bases `c4_migrate`, `c4_shadow`, `c4_test`.

- Después de cada merge: `prisma generate`, `tsc --noEmit`, `npm run code:check`:
  OK. `jest` unitarios: merge 1: 138 suites / 1355 tests; merge 2: 141 / 1376;
  final con el arreglo: **142 suites, 1402 tests**, todo OK.
- `prisma migrate deploy` sobre base vacía: todas aplicadas.
- `migrate diff --from-migrations ... --to-schema-datamodel` (shadow propia) y
  `--from-url` de la base migrada: **sin diferencias** las dos.
- En `pg_indexes` siguen `site_settings_custom_domain_verified_key` y
  `job_executions_scheduled_slot_key`. Cero CHECK sin validar.
- e2e de a pocos archivos (`jest --config test/jest-e2e.json --runInBand`,
  `TEST_DATABASE_URL` a `c4_test`), todos OK:

  | Archivos                                                                             | Tests |
  | ------------------------------------------------------------------------------------ | ----- |
  | contracts, billing                                                                   | 75    |
  | billing-payments-concurrency, settlements, reports                                   | 40    |
  | tenants, public, site                                                                | 90    |
  | automations, audit, audit-transaction                                                | 44    |
  | portal, users, unique-constraints, check-constraints, default-deny                   | 111   |
  | dashboard-contract, soft-delete-transaction, concurrent-indexes, tenant-provisioning | 25    |

## Qué no se corrió

- Los e2e restantes de `test/` (crm, crm-listings, notifications, migration,
  indices, jobs, queue, master-data, owners, renters, properties, inventory,
  documents, services, session, portal-login, tenancy, valuation, example, app):
  no los tocan los merges más allá de lo ya cubierto, y no se corrieron todos
  juntos (memoria).
- Doppler, `npm run start:dev` real y servicios externos (Cloudinary, Resend,
  Tokko, DNS).
- No hay test e2e de concurrencia específico del generador con saldo a favor
  (sólo el unitario del orden de locks).

## A revisar a mano

1. El frontend debe regenerar sus tipos desde `openapi.json`.
2. D-239 queda vacía a propósito.
3. El rol `c4` y las bases `c4_*` quedan en el Postgres del contenedor.
4. `installment-credit-applier.spec.ts` importa el helper `installment()` de
   `installment.policy.spec.ts` (como otros specs), así que ese archivo se
   ejecuta dos veces en jest.
