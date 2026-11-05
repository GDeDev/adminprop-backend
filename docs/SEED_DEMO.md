# Seed de demo (`npm run seed:demo`)

Carga datos de ejemplo para empezar las pruebas manuales (ver
`adminprop-repo-files/docs/PLAN_PRUEBAS_MANUALES.md`, sección 2): dos
inmobiliarias ficticias con personas, propiedades, los doce contratos tipo,
cuotas, un historial de pagos coherente y liquidaciones.

> **SOLO DEMO.** Los datos son ficticios y la contraseña está publicada en este
> archivo. Por eso el script **se niega a correr** fuera de desarrollo local
> (ver "Qué se niega a hacer"). Nunca lo corras contra una base compartida.

## Cómo correrlo

### Con Doppler (flujo normal)

```bash
npm run docker:dev            # Postgres local, si no está levantado
doppler run -- npm run prisma:migrate:deploy
npm run seed:demo
```

`seed:demo` corre dentro de `doppler run --` igual que `tenant:create` y
`master-data:seed`, así que usa la config `dev_backend`. Tarda alrededor de un
minuto: espera a que la cola de trabajos procese lo que dejan los cobros
(borradores de liquidación, cuenta de honorarios, recibos).

### Sin Doppler

`npm run seed:demo` siempre pasa por Doppler. Sin él, exportá las tres
variables obligatorias en el shell y llamá a `ts-node` directo (es lo mismo que
hace el script):

```bash
export DATABASE_URL="postgresql://adminprop:adminprop@localhost:5432/adminprop_development"
export JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
export JWT_REFRESH_SECRET="$(openssl rand -base64 48)"

npx prisma migrate deploy
npx ts-node -r tsconfig-paths/register src/seed-demo/main.ts
```

Son valores de tu shell: no se escriben en ningún archivo. No hace falta ningún
`.env` (la app los ignora).

## Qué se niega a hacer

El script chequea el entorno **antes** de levantar la app o abrir ninguna
conexión, y termina con código 2 y un mensaje claro si:

- `NODE_ENV` es `production`, `qa`, `staging` o cualquier valor distinto de
  `development` / `test` (vacío cuenta como desarrollo);
- falta `DATABASE_URL`, o su host no es `localhost`, `127.0.0.1`, `::1`,
  `host.docker.internal` ni el servicio `postgres` del docker-compose;
- el nombre de la base parece de otro entorno (contiene `prod`, `production`,
  `qa`, `stg`, `staging`, `uat`, `live`...).

Además:

- **Nunca borra ni modifica datos existentes.** Cada entidad se busca por su
  clave natural (DNI, dirección, marca `[DEMO C-xx]` en las notas del contrato,
  email) y sólo se crea si falta. Si el slug `demo-uno` o `demo-dos` ya existe
  con otro nombre (una inmobiliaria real), aborta sin tocarla.
- **Es idempotente:** correrlo de nuevo no duplica nada (lo verifica el e2e
  `test/seed-demo.e2e-spec.ts`).
- Dentro de su propio proceso fuerza proveedores locales, sin tocar tu shell ni
  Doppler: mails por consola, publicador de portales simulado, índices en modo
  manual, storage local (las fotos placeholder van a `./storage-data/`, ignorada
  por git, y no se sube nada a Cloudinary) y sin aviso a `apps/sites`.
- Usa los casos de uso reales (commands de cada módulo) dentro del tenant, con el
  administrador de cada inmobiliaria como usuario: aplican las reglas de negocio,
  el filtro de tenant y la auditoría. Los montos pasan por `@/shared/money`.
- El código vive en `src/seed-demo/`. El build (`nest build`, con swc) lo compila
  igual que el resto de `src`, pero nada lo importa desde `main.ts` y el punto de
  entrada se niega a correr fuera de desarrollo local.

## Credenciales

**Contraseña de todos los usuarios de demo: `DemoSolo-2026!`**

| Inmobiliaria (slug)                | Rol                   | Email                                              |
| ---------------------------------- | --------------------- | -------------------------------------------------- |
| Inmobiliaria Demo Uno (`demo-uno`) | Administrador         | `admin@demo-uno.example.com`                       |
|                                    | Empleado              | `empleado@demo-uno.example.com`                    |
|                                    | Propietarios (portal) | `own-a@demo-uno.example.com`, `own-b@…`, `own-c@…` |
|                                    | Inquilinos (portal)   | `ren-1@demo-uno.example.com`, `ren-2@…`            |
| Inmobiliaria Demo Dos (`demo-dos`) | Administrador         | `admin@demo-dos.example.com`                       |
|                                    | Empleado              | `empleado@demo-dos.example.com`                    |
|                                    | Propietaria (portal)  | `own-a@demo-dos.example.com`                       |
|                                    | Inquilina (portal)    | `ren-1@demo-dos.example.com`                       |

- Backoffice: `POST /api/v1/auth/login` con email y contraseña.
- Portales: `POST /api/v1/auth/portal-login` con `tenantSlug`, email, contraseña
  y `type` (`OWNER` o `RENTER`).
- Los emails son `@example.com` (no existen: no se manda nada a nadie). Los
  teléfonos son `555-…`. Los DNI son de la serie 90.xxx.xxx (no se emiten), los
  CUIT y CBU tienen **dígitos verificadores válidos** pero salen de rangos
  inexistentes (entidad 999, sucursal 9999).
- Cada propietario, inquilino, garante y propiedad lleva la marca `DEMO` en el
  nombre (`DEMO Aguirre`) o la dirección (`[DEMO] Calle 7…`), y en sus notas.

## Qué crea

**Inmobiliaria Demo Uno** (los casos del plan de pruebas): punitorio diario
explícito de 0,50 %, 10 días de gracia, 7 propietarios, 14 inquilinos, 2
garantes, 20 propiedades, 15 contratos, 4 servicios, 1 gasto adelantado, 4
consultas de CRM, maestros base más Rosario / Pichincha y el tipo "Galpón".

**Inmobiliaria Demo Dos** (para probar el aislamiento entre tenants): punitorio
diario de 1,00 % y 5 días de gracia, **aplicación automática del saldo a favor al
generar la cuota** (`autoApplyCreditOnGeneration = true`; Demo Uno queda en
manual), 2 propietarios, 2 inquilinos, 4 propiedades,
2 contratos (uno en pesos al día y uno en dólares con la cuota vencida), 1 consulta.

Las fechas son relativas al día en que se corre el script (hay cuotas desde hace
4 meses hasta el mes que viene), así que siempre hay mora, un contrato por
vencer, etc. Las cuotas se generan mes por mes con el mismo generador que el
proceso automático.

### Reglas nuevas (consolidado-4) y dónde verlas

| Regla                                                          | Dónde se ve                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Punitorio sin default del sistema                              | Cada inmobiliaria tiene su porcentaje explícito (0,50 % y 1,00 %); C-03 tiene uno propio.                                                                                           |
| Ajuste manual sólo de administrador (D-234, D-230)             | C-12 en Demo Uno: aumento ICL resuelto a mano, con motivo y autorizante, aplicado por el administrador. Con `empleado@demo-uno.example.com` la API devuelve 403 (lo prueba el e2e). |
| Reporte de ingresos por quién cobró (D-235)                    | `GET /reports/financial/income`: C-05 (cobro directo, confirmado) va a "percibido por el propietario"; el resto, a "cobrado por la inmobiliaria".                                   |
| Retenciones y adelantos por separado (D-236)                   | Consolidado cerrado de OWN-A (liquidación de C-01): retención 3.500, adelanto 20.000, otros ajustes 0.                                                                              |
| Saldo a favor al generar la cuota (D-237)                      | Demo Dos: D-01 paga de más el mes -2 y el saldo se aplica solo a la cuota del mes -1. Demo Uno (manual): C-03 aplicó 5.000 a mano y le quedan 10.000.                               |
| Cuenta corriente "por liquidar" (D-238)                        | `GET /contracts/:id/account`, `totals.pendingSettlement`: por ejemplo C-06 (pago parcial sin liquidar).                                                                             |
| Idempotency-Key, CHECK, únicos nuevos, `registered_by_id` nulo | El seed usa los comandos directos (sin cabecera HTTP) y corre completo, dos veces, sobre la base con todas las migraciones, sin violar ningún CHECK ni único.                       |

### Mapa caso del plan de pruebas → entidad creada (Demo Uno)

| Caso         | Propiedad                    | Propietario | Inquilino (garante)      | Qué prueba                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------- | ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01         | `[DEMO] Calle 7 Nº 101`      | OWN-A       | REN-1 (GAR-1)            | ARS 200.000, ICL trimestral, depósito fijo 200.000, sin caución, cobra la inmobiliaria, honorario 5 %. Pagos al día, uno con punitorio, **liquidación cerrada (transferida) con una retención de 3.500 y un adelanto de 20.000, dentro de un consolidado cerrado** (columnas "Retenc." y "Adelantos" separadas) y borrador.                                      |
| C-02         | `[DEMO] Calle 12 Nº 202`     | OWN-C       | REN-2 (GAR-2)            | IPC cuatrimestral, **con caución** (póliza vence en 20 días, aseguradora `aseguradora@example.com`), depósito que sigue al alquiler, **cuotas vencidas sin pagar** (2).                                                                                                                                                                                          |
| C-03         | `[DEMO] Calle 13 Nº 303`     | OWN-C       | REN-3 (sin garante)      | Aumento **fijo 10 % semestral**, **punitorio propio** (1,5 %, 5 días de gracia), depósito manual, **saldo a favor** (15.000: **5.000 aplicados a mano** a la cuota de este mes, 10.000 siguen disponibles) y **pago adelantado**.                                                                                                                                |
| C-04         | `[DEMO] Av. Santa Fe Nº 404` | OWN-F       | REN-4 (sin email)        | **USD 500**, depósito en dólares, un pago en **pesos con cotización** y otro en dólares.                                                                                                                                                                                                                                                                         |
| C-05         | `[DEMO] Calle 50 Nº 505`     | OWN-D       | REN-6                    | **Cobra el propietario directo** (honorarios a cargo del propietario): dos pagos informados y confirmados (son lo "percibido por el propietario" del reporte de ingresos) y uno **pendiente de confirmación**. Propietario sin cuenta bancaria.                                                                                                                  |
| C-06         | `[DEMO] Calle 51 Nº 606`     | OWN-F       | REN-7                    | Honorario por **importe fijo** (8.000) y **pago parcial** (60 %) del mes pasado: la cuenta corriente muestra un monto **por liquidar** distinto de cero.                                                                                                                                                                                                         |
| C-07         | `[DEMO] Calle 52 Nº 707`     | OWN-F       | REN-8                    | **Fin de contrato en 55 días** (aviso de vencimiento, renovación).                                                                                                                                                                                                                                                                                               |
| C-08         | `[DEMO] Calle 53 Nº 808`     | OWN-G       | REN-9                    | **Fin de contrato = ayer**: queda `ACTIVE` hasta que corra la finalización automática.                                                                                                                                                                                                                                                                           |
| C-09         | `[DEMO] Calle 55 Nº 1010`    | OWN-G       | REN-5                    | **Inicio a mitad de mes (día 17)**: cuota de mes entero, sin prorrateo. REN-5 ya tuvo un contrato (C-R1).                                                                                                                                                                                                                                                        |
| C-10a/b/c    | `[DEMO] Calle 60 / 61 / 62`  | OWN-B       | REN-10 / REN-11 / REN-12 | Tres contratos del mismo propietario (consolidado, honorario propio 3 %); (b) pago parcial 50 %, (c) cuota vencida sin pagar.                                                                                                                                                                                                                                    |
| C-11         | `[DEMO] Calle 63 Nº 1414`    | OWN-E       | REN-13 (GAR-2)           | **Fijo sin porcentaje**, aumento semestral ya vencido ("aumento pendiente").                                                                                                                                                                                                                                                                                     |
| C-12         | `[DEMO] Calle 64 Nº 1515`    | OWN-G       | REN-14                   | **Servicios heredados** (luz con vencimiento pasado, gas), servicios propios del contrato (expensas con aumento trimestral, agua a cargo del propietario) y un gasto adelantado. El primer aumento trimestral vence este mes sin ICL cargado: se resolvió con un **ajuste manual** de 230.000 a 250.000, con motivo y autorizante, cargado por el administrador. |
| C-R1 (extra) | `[DEMO] Calle 54 Nº 909`     | OWN-G       | REN-5                    | Contrato **rescindido** hace 3 meses con multa calculada; la propiedad vuelve a quedar disponible.                                                                                                                                                                                                                                                               |

Casos de personas y propiedades:

| Caso del plan                         | Entidad                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OWN-A (1 propiedad, CBU válido)       | Alicia DEMO Aguirre; **comparte CBU con OWN-C** (advertencia de CBU repetido). Con portal.                                                                                                                                                                   |
| OWN-B (3 propiedades con contrato)    | Bruno DEMO Benítez (CUIT), honorario propio del 3 %, con portal (consolidado).                                                                                                                                                                               |
| OWN-C (2 propiedades + 1 libre)       | Carla DEMO Cabrera; `[DEMO] Calle 70 Nº 1616` está disponible: el próximo contrato la lleva a 3.                                                                                                                                                             |
| OWN-D (sin cuenta bancaria)           | Diego DEMO Domínguez (aviso al liquidar).                                                                                                                                                                                                                    |
| OWN-E (sin email)                     | Elena DEMO Estévez ("Generar acceso" no debe poder).                                                                                                                                                                                                         |
| REN-1 / REN-2 / REN-3 / REN-4 / REN-5 | Garante con propiedad / garante con recibos de sueldo / sin garante / sin email / dos contratos (C-R1 rescindido y C-09).                                                                                                                                    |
| GAR-2 vinculado a dos inquilinos      | REN-2 y REN-13.                                                                                                                                                                                                                                              |
| Propiedades                           | Disponible con precio (Calle 70), disponible sin precio ("Consultar", Calle 71), **en venta en USD con 20 fotos** (Calle 72), en mantenimiento (Calle 73), **sin propietario** (Calle 74). Con coordenadas: Calle 7, 12, Av. Santa Fe, 70, 72; el resto sin. |
| Maestros (2.2)                        | Catálogo base + La Plata / CABA de ejemplo + **Rosario / Pichincha** + tipo **"Galpón"**.                                                                                                                                                                    |
| Portal                                | 3 propietarios y 2 inquilinos con acceso (clave de demo).                                                                                                                                                                                                    |
| CRM                                   | 4 consultas de ejemplo (WhatsApp, teléfono, manual) en distintas columnas, una perdida.                                                                                                                                                                      |

Historial de pagos (todos con fecha de pago retroactiva): al día, parcial (C-06,
C-10b), con punitorio (C-01 mes pasado), adelantado (C-03), con saldo a favor
(C-03), en pesos sobre cuota en dólares (C-04), informado pendiente (C-05),
cuotas vencidas sin pagar (C-02, C-06 y C-10b por el saldo, C-10c). Las
liquidaciones salen de los pagos: **1 cerrada y transferida (C-01)** y una
**borrador** por cada contrato con cobros pendientes de liquidar; en Demo Dos,
una cerrada (D-01) y un borrador (D-02).

### Qué NO crea

- Valores de los índices ICL / IPC: son datos públicos compartidos, y cargar
  valores inventados ensuciaría los reales. Cargalos con la carga manual o el
  job de índices si querés probar aumentos.
- El usuario interno desactivado (`U-INACT`), PDFs de contrato, los archivos de
  los negativos de upload, el sitio web de la inmobiliaria, ni consultas de
  portales externos (Mercado Libre, Tokko, Zonaprop): el seed no llega a ningún
  servicio externo.
- Los recibos PDF de los pagos se generan por la cola (como en la API real) en el
  storage local; no hace falta hacer nada.

## Cómo resetear

El seed nunca borra, así que para volver a empezar hay que tirar la base de
desarrollo y recrearla (no hay "borrar sólo lo demo": los datos están
auditados y encadenados).

```bash
# Postgres del docker-compose
docker-compose exec postgres psql -U adminprop -d postgres \
  -c 'DROP DATABASE adminprop_development WITH (FORCE)' \
  -c 'CREATE DATABASE adminprop_development'

doppler run -- npm run prisma:migrate:deploy
npm run seed:demo
```

Alternativa con Doppler: `npm run prisma:migrate:reset` (vacía la base, aplica
las migraciones y corre además `prisma/seed.ts`, que crea la inmobiliaria
`demo` de la Fase 3 con otros usuarios) y después `npm run seed:demo`. Si querés
dejar sólo los datos de este seed, usá la primera forma.

Para limpiar también las fotos y recibos de demo del disco: borrá la carpeta
`storage-data/`.

## Advertencias

- Re-correrlo en otro día es seguro, pero **no mueve las fechas**: lo que ya se
  creó conserva las fechas del primer día. Si el "contrato por vencer" o la
  "cuota vencida" dejan de tener sentido con el tiempo, reseteá y volvé a
  cargar.
- Si el script se corta a la mitad, volvé a correrlo: crea lo que falte (cada
  entidad y cada pago se buscan antes de crearse). Si algo quedó raro, reseteá.
- Los procesos automáticos (`AUTOMATIONS_ENABLED`) y la finalización de C-08 no
  corren dentro del seed. Dispará los jobs a mano desde el backoffice para
  probarlos.
- El seed fuerza `STORAGE_PROVIDER=local` sólo en su proceso. Si probás los
  archivos con tu backend apuntando a Cloudinary, las fotos placeholder no
  existen allá.
- No lo uses como "fixture" de tests: los e2e arman sus propios escenarios
  (`test/seed-demo.e2e-spec.ts` sólo prueba el seed).

## Tests

- Unitarios (`npm test`): `src/seed-demo/demo-guards.spec.ts` (se niega en
  producción, QA, staging o con una base remota o con nombre de otro entorno) y
  `demo-identifiers.spec.ts` (los DNI/CUIT/CBU ficticios pasan los validadores
  reales).
- e2e (`npm run test:e2e -- seed-demo`): corre el seed completo sobre la base de
  tests, verifica los conteos clave y los casos de borde, que la segunda corrida
  no crea ni duplica nada, y el aislamiento entre las dos inmobiliarias (listados,
  404 cruzado y portal).
  El e2e también cubre las reglas de plata de consolidado-4: el ajuste manual
  lo cargó un administrador (y un empleado recibe 403), el consolidado cerrado
  con retenciones y adelantos separados, el reporte de ingresos por quién cobró,
  el saldo a favor aplicado a mano (Demo Uno) y solo (Demo Dos) y el monto "por
  liquidar" de la cuenta corriente.
