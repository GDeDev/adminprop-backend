# Integración `integration/consolidado-5`

Rama creada a partir de `origin/integration/consolidado-4`. Se mergeó con
`git merge --no-ff` la rama del seed de demo y se hicieron tres arreglos propios,
con push después de cada commit. Fecha: 2026-11-05. No se usó Doppler ni
`--no-verify`.

## Merge: `origin/feat/seed-demo-datos`

Un solo conflicto, `package.json`: las dos ramas agregaron un script en el mismo
lugar. Se conservaron los dos (`db:check-duplicates` y `seed:demo`); el JSON
parsea. `docs/ARRANQUE_LOCAL_BACKEND.md` y `DECISIONES_TECNICAS.md` mergearon
solos (esta rama no toca la segunda).

## El seed contra las reglas de consolidado-4

El seed se escribió antes de las reglas nuevas. Corrido tal cual sobre la base
con las 50 migraciones aplicadas, **terminó sin errores, y una segunda corrida
dejó exactamente los mismos conteos** (inmobiliarias, pagos, contratos, cuotas,
liquidaciones, usuarios, propietarios, propiedades y auditoría). No violó ningún
CHECK ni único, así que no hizo falta tocar constraints. Ya era compatible
porque: el punitorio de cada inmobiliaria es explícito, actúa como ADMIN y usa
los comandos (no HTTP, así que no hay `Idempotency-Key`).

Lo que faltaba eran los **casos para mirar a mano**. Se agregaron (idempotentes,
con e2e en `test/seed-demo.e2e-spec.ts`):

| Caso                                             | Dónde                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Ajuste manual con motivo y autorizante, de ADMIN | C-12 (Demo Uno): 230.000 a 250.000. El seed pasa `actorRole = ADMIN`; el e2e verifica el actor y que un empleado recibe 403. |
| Consolidado cerrado con retención y adelanto     | C-01 / OWN-A: retención 3.500 y adelanto 20.000, columnas separadas, total -23.500.                                          |
| Cobro directo al propietario en el reporte       | C-05 (ya existía, confirmado): el e2e comprueba `collectedByReceiver` agencia y propietario mayores a cero.                  |
| Saldo a favor aplicado a mano                    | C-03 (Demo Uno): 5.000 aplicados a mano, 10.000 siguen disponibles.                                                          |
| Aplicación automática al generar                 | Demo Dos con `autoApplyCreditOnGeneration = true`: D-01 paga de más y el generador aplica 20.000 solo.                       |
| "Por liquidar" distinto de cero                  | C-06 (pago parcial sin liquidar): el e2e lee `totals.pendingSettlement` y es mayor a cero.                                   |

Cambio de comportamiento del seed: al contar pagos ya cargados de un mes ya no
cuenta los `CREDIT_APPLICATION`, porque con aplicación automática la cuota nace
con un pago y su resto igual hay que pagarlo.

El mapa "caso del plan de pruebas -> entidad" impreso (campo `covers`) y
`docs/SEED_DEMO.md` (tabla "Reglas nuevas") quedaron actualizados.

## Arreglos pedidos aparte

- **D-246, CORS**: `Idempotency-Key` faltaba en `allowedHeaders` y el navegador
  no podía registrar un pago (preflight). El controller lo lee con
  `@Headers('idempotency-key')` (Express baja a minúsculas, sin problema de
  mayúsculas). Test `test/cors.e2e-spec.ts`: preflight permitido desde un origen
  listado y sin `Access-Control-Allow-Origin` desde uno ajeno.
- **D-247, CHECK 23514**: ahora es 422 `CHECK_CONSTRAINT_VIOLATION` con mensaje
  genérico (sin constraint, tabla ni fila), en `PrismaExceptionFilter` junto al
  mapeo de `P2002`. Se verificó contra Postgres cómo llega: el ORM lo entrega
  como `PrismaClientUnknownRequestError` (el filtro no lo atrapaba) y el SQL
  crudo como `P2010` con `meta.code = '23514'`; también se cubre `P2004`. Se
  regeneró `openapi.json` (un valor nuevo en el enum de códigos) y
  `src/openapi-refs.spec.ts` pasa. Test: `prisma-exception.filter.spec.ts`.

## Comandos corridos y resultado

Base propia: PostgreSQL 16 del contenedor, rol de superusuario `root` (auth por
socket, sin contraseña) y bases `c5_migrate`, `c5_shadow`, `c5_test`, `c5_seed`,
`c5_seedb`. Sin Doppler; las variables del seed salen del shell.

- `prisma generate`, `tsc --noEmit`, `npm run code:check`: OK (al final, con
  los tres commits).
- `jest` unitarios: **145 suites, 1438 tests**, OK.
- `prisma migrate deploy` sobre base vacía: 50 migraciones aplicadas.
  `migrate diff` `--from-migrations` (shadow propia) y `--from-url`: **sin
  diferencias**. Cero constraints sin validar.
- Seed: dos corridas seguidas sobre base migrada, conteos idénticos; también lo
  verifica el e2e (`la segunda corrida no duplica ninguna tabla`, ahora con
  `statements`).
- e2e de a pocos archivos (`--runInBand`, `TEST_DATABASE_URL` a `c5_test`):

  | Archivos                                         | Tests  |
  | ------------------------------------------------ | ------ |
  | seed-demo, unique-constraints, check-constraints | 59, OK |
  | billing, contracts, billing-payments-concurrency | 88, OK |
  | reports, settlements                             | 27, OK |
  | roles-default-deny, tenants, cors                | 50, OK |

## Qué no se corrió

- El resto de los e2e de `test/` (crm, notifications, migration, indices, jobs,
  queue, properties, owners, renters, portal, public, site, etc.); no los toca
  nada de esta rama.
- Doppler, `npm run seed:demo` con Doppler y servicios externos.
- La rama no incluye un e2e HTTP real de registrar un pago con `Idempotency-Key`
  desde el navegador; sólo el preflight.

## A revisar a mano

1. El frontend debe regenerar sus tipos desde `openapi.json` (código nuevo
   `CHECK_CONSTRAINT_VIOLATION`).
2. Una corrida de jest con varios archivos de e2e quedó colgada sin salir
   después de pasar todo (handle abierto en un archivo de billing/contracts);
   se corrió con `--forceExit`. No se investigó.
3. El rol `root` y las bases `c5_*` quedan en el Postgres del contenedor.
4. El seed no mueve fechas ni modifica lo ya creado: una base sembrada con el
   seed viejo no recibe los casos nuevos hasta resetearla.
