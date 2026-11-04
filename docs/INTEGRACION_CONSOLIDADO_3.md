# Integración `integration/consolidado-3`

Rama creada a partir de `origin/integration/consolidado-2` (0764394) con dos
ramas mergeadas, una por una, con `git merge --no-ff`. Fecha: 2026-11-04. No se
hizo push. No se usó Doppler ni `--no-verify`.

## Ramas mergeadas (en este orden)

| #   | Rama                                    | Conflictos                               |
| --- | --------------------------------------- | ---------------------------------------- |
| 1   | `origin/fix/openapi-valido-coordenadas` | No                                       |
| 2   | `origin/feat/micaela-brechas-backend`   | Sí, 1 archivo (`DECISIONES_TECNICAS.md`) |

Después de los merges hay dos commits propios: `test(e2e)` (un test flaky de
`automations`) y `docs` (este archivo y `docs/ARRANQUE_LOCAL_BACKEND.md`).

## Conflictos y criterio

### 1. `fix/openapi-valido-coordenadas`

Merge limpio. Trae coordenadas (`latitude`/`longitude`, 3 decimales) en la
ficha pública, un `openapi-refs.spec.ts` que valida que todos los `$ref` del
`openapi.json` existan, y la decisión **D-226**.

### 2. `feat/micaela-brechas-backend`

- **`docs/DECISIONES_TECNICAS.md`**: las dos ramas agregaron una decisión
  **D-226** (la de coordenadas, y la del depósito). Criterio pedido: la de
  coordenadas queda como D-226 y las cuatro de Micaela se renumeran **+1**:

  | Antes (rama Micaela) | Ahora | Tema                                                  |
  | -------------------- | ----- | ----------------------------------------------------- |
  | D-226                | D-227 | Devolución del depósito: monto de referencia por modo |
  | D-227                | D-228 | Punitorio sin 5 % por defecto, "desde cuándo corre"   |
  | D-228                | D-229 | Modo de envío del consolidado                         |
  | D-229                | D-230 | Ajuste manual del alquiler con motivo y autorizante   |

  Se conservaron los dos bloques completos (el de coordenadas primero, el de
  "Brechas de las respuestas de Micaela" después).

- **Referencias actualizadas** (45 archivos): código (`billing`, `contracts`,
  `tenants`, `notifications`, `settlements`), tests unitarios y e2e,
  `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/lib/tenant-provisioning.ts`,
  los comentarios de las tres migraciones nuevas, y `docs/tecnica|funcional/fase-09,
11, 12, 14`. Se aplicó un reemplazo de `D-226..D-229` a `+1` en todo
  `src`, `test`, `prisma` y `docs`, **excluyendo** la única referencia legítima a la
  decisión de coordenadas fuera de la doc: el comentario de
  `test/public.e2e-spec.ts` (`D-226`). Verificado después con `grep`: el único
  `D-226` fuera de `DECISIONES_TECNICAS.md` es ese.
  Los mensajes de commits viejos de la rama de Micaela siguen citando la
  numeración anterior; no se reescribió historia.
- **`openapi.json`**: git lo mergeó solo; igual se regeneró con
  `npm run openapi:export`. El único cambio fue el de las descripciones del
  ajuste manual (`D-229` pasó a `D-230`). Se verificó que sigan las coordenadas
  (`latitude`/`longitude`) del otro lado.
- `properties`/vistas públicas: sin conflicto; se mantienen las coordenadas y lo
  de Micaela.

Migraciones nuevas de la rama de Micaela:
`20261107120000_deposit_return_reference`, `20261107130000_tenant_late_fee_no_default`,
`20261107140000_rent_update_manual_justification`. Aplican limpio después de las
existentes.

## Comandos corridos y resultado

Base propia: PostgreSQL 16 local del contenedor (`service postgresql start`).
Como no se disponía de las credenciales del rol de la integración anterior, se
creó un rol de uso descartable `c3` (superusuario, solo para el sandbox) y las
bases `c3_migrate`, `c3_shadow` y `c3_test`.

- `npx prisma generate`, `npx tsc --noEmit`, `npm run code:check`: OK después de
  cada merge.
- `npx jest` (unitarios): después del merge 1, **133 suites, 1300 tests, OK**;
  después del merge 2, **133 suites, 1313 tests, OK**.
- `npm run openapi:export`: OK; `src/openapi-refs.spec.ts` pasa dentro de jest.
- `npx prisma migrate deploy` sobre base vacía (`c3_migrate`): todas las
  migraciones aplicadas.
- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
prisma/schema.prisma --shadow-database-url ...`: **sin diferencias**; también
  `--from-url` de la base migrada: sin diferencias. En `pg_indexes` siguen
  `site_settings_custom_domain_verified_key` y `job_executions_scheduled_slot_key`
  (no se dropearon).
- e2e, un archivo por vez (`test/jest-e2e.json`, `TEST_DATABASE_URL` propio,
  base `c3_test`), todos OK:

  | Archivo               | Tests          |
  | --------------------- | -------------- |
  | `public`              | 34             |
  | `billing`             | 25             |
  | `contracts`           | 45             |
  | `settlements`         | 9              |
  | `tenants`             | 10             |
  | `tenant-provisioning` | 10             |
  | `notifications`       | 40             |
  | `site`                | 45             |
  | `migration`           | 33             |
  | `crm`                 | 17             |
  | `crm-listings`        | 15             |
  | `automations`         | 28 (ver abajo) |

## Fallo intermitente: `automations`, "dos réplicas del cron..."

Pasó a la primera tirada y falló después dos veces seguidas con
`Expected length: 28 / Received length: 29` (el caso que se anticipaba). La fila
de más es un `indices.fetch` con `scheduledFor = 2026-10-31`, `slot = null` y
estado `PARTIAL`, creada un segundo antes de las filas del propio test.

**Causa**: es una carrera entre tests, no un problema de las ramas mergeadas. El
test anterior ("encola lo que falta hoy...") termina con un último
`enqueueDue(2026-10-31T15:10Z)` que encola tres jobs (el segundo `indices.fetch`
y los dos `crm.pull-channel-inquiries`) **sin esperar a que terminen**. Si el
`beforeEach` del test siguiente trunca la tabla mientras la cola de pg-boss
todavía los tiene, el worker no encuentra su fila de ejecución y crea una de
reemplazo (sin slot), que aparece en el conteo del test de las réplicas
(29 en vez de 28). Que pase o no depende de la velocidad relativa de la cola y
del truncado: de ahí lo intermitente.

**Arreglo** (`test(e2e)`): al final del test anterior se espera a que no quede
ninguna ejecución `RUNNING` antes de salir. Después del arreglo: 3 corridas
completas del archivo, 28/28 las tres veces (una de las corridas tardó más de
lo habitual por contención de procesos y se repitió sola).

## Qué no se corrió

- No se corrió Doppler, ni push, ni la suite e2e "toda junta" (por memoria).
- e2e que no están en la lista mínima pedida no se re-corrieron en esta
  integración (el resto de los archivos de `test/`; los dos merges no los tocan
  más allá de las referencias D-xxx en comentarios).
- No se probó contra servicios reales (Cloudinary, Resend, Tokko, portales, DNS).
- `npm run start:dev` real no se probó (necesita Doppler); la guía
  `docs/ARRANQUE_LOCAL_BACKEND.md` se contrastó contra `package.json`, scripts de
  `prisma/` y la validación de entorno, no ejecutándola de punta a punta.
- `claude-memory/adminprop-doppler-rules.md` de `adminprop-repo-files` no se
  pudo leer (la carpeta no existe en el checkout accesible y el sandbox no deja
  usar `git` sobre otro repo): el mapeo de configs de Doppler figura "a confirmar".

## A revisar a mano

1. Quien cite D-226..D-229 desde otro repo (frontend, repo-files, mensajes de
   PR) debe usar la numeración nueva (D-227..D-230); D-226 es ahora
   "coordenadas".
2. `openapi.json`: el frontend debe regenerar sus tipos.
3. El rol `c3` y las bases `c3_*` quedan en el Postgres local del contenedor;
   no son del proyecto real.
