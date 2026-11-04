# Arranque local del backend (máquina recién formateada)

Guía para levantar `adminprop-backend` desde cero. Cada comando se contrastó
con `package.json`, `prisma.config.ts`, `docker-compose.yml`, `.env.example` y
`src/shared/config/env.validation.ts` de esta rama (`integration/consolidado-3`).
Lo que no se pudo verificar desde el sandbox figura como **a confirmar**.

> No existe `.env`: la app ignora cualquier archivo `.env`. Las variables salen
> de Doppler (proyecto `admin-prop`, config `dev_backend` en local) y los
> scripts de `package.json` ya corren dentro de `doppler run --`.

## 1. Requisitos

| Qué               | Versión / nota                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js           | `engines.node >= 22.0.0` (`package.json`) y `.nvmrc` = `22`. Recomendado: `nvm install` + `nvm use` dentro del repo. Se probó con 22.23.4.                                                                         |
| npm               | `engines.npm >= 10.0.0` (viene con Node 22).                                                                                                                                                                       |
| Docker            | Para Postgres 16 (`docker-compose.yml`, imagen `postgres:16-alpine`). `npm run docker:dev` llama al binario **`docker-compose`** (con guion). Si solo tenés el plugin `docker compose`, ver "Problemas conocidos". |
| Doppler CLI       | Para `start:dev`, `prisma:migrate`, `prisma:seed`, `master-data:seed` y `tenant:create` (todos usan `doppler run --`).                                                                                             |
| `gh` (GitHub CLI) | Opcional: autenticar el clonado por HTTPS (`gh auth login`) y abrir PRs.                                                                                                                                           |
| `git`, `openssl`  | `openssl` se usa para generar secretos.                                                                                                                                                                            |

## 2. Clonado (HTTPS)

```bash
gh auth login                 # una vez; elegir HTTPS
git clone https://github.com/GDeDev/adminprop-backend.git
cd adminprop-backend
git checkout dev              # o la rama de trabajo
```

El repo hermano `adminprop-repo-files` (specs, PRD, `CLAUDE.md` general) y
`adminprop-frontend` se clonan al lado: el `CLAUDE.md` del backend importa
`../adminprop-repo-files/CLAUDE.md`. Es un repo aparte; nunca se mezclan
cambios de ambos en un commit.

## 3. Doppler: login y mapeo de configs

```bash
doppler login                 # una vez por máquina (abre el navegador)
doppler setup                 # parado en la carpeta del backend
                              # proyecto: admin-prop   config: dev_backend
```

- **Verificado en este repo**: proyecto `admin-prop`, config `dev_backend` para
  el backend en local (README, `docs/CONFIGURATION.md`, `docs/VSCODE-SETUP.md`).
- En `adminprop-repo-files` aparecen además los configs `dev_portal` y
  `dev_backoffice` (uno por app del frontend), cada uno con su carpeta.
- **A confirmar**: el mapeo completo de configs (qué config corresponde a qué
  repo/entorno: `qa`, `prod`, apps de sitios, etc.). La fuente prevista es
  `claude-memory/adminprop-doppler-rules.md` de `adminprop-repo-files` (rama
  `main`), pero esa carpeta no existía en el checkout accesible desde el
  sandbox donde se escribió esta guía y no se pudo leer. Leer ese archivo antes
  de tocar configs que no sean `dev_backend`.
- `DATABASE_URL` de `dev_backend` tiene que apuntar al Postgres local (ver
  sección 5). **A confirmar** el valor actual cargado en Doppler.

Sin Doppler también se puede levantar para una prueba rápida exportando a mano
las tres variables obligatorias (ver sección 4), pero no es el flujo normal.

## 4. Variables de entorno

Sin valores. Fuente de verdad: `.env.example` (documenta) y
`src/shared/config/env.validation.ts` (valida al arrancar: si falta una
obligatoria o está mal tipada, la app no levanta y dice cuál).

Convenciones: los booleanos y numéricos con valor vacío (`""`) se tratan como
"sin definir". Los **enums** (`*_PROVIDER`) no: si no se usan, **no los
crees** en Doppler en vez de dejarlos vacíos (a confirmar con un arranque real).

### Obligatorias

| Variable             | Dev local | QA / producción | Cómo se obtiene                                                                                        |
| -------------------- | :-------: | :-------------: | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       |    Sí     |       Sí        | Cadena de conexión Postgres. Local: la del contenedor (sección 5). Secreto.                            |
| `JWT_ACCESS_SECRET`  |    Sí     |       Sí        | Secreto a generar, 32+ caracteres: `openssl rand -base64 48`.                                          |
| `JWT_REFRESH_SECRET` |    Sí     |       Sí        | Otro secreto, **distinto** del anterior (la app no arranca si son iguales): `openssl rand -base64 48`. |

### Obligatorias solo fuera de development/test (incluye `qa`)

| Variable               | Regla                                                                                                                                                                     | Cómo se obtiene                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `SITES_PREVIEW_SECRET` | 32+ caracteres. Firma las vistas previas del sitio y los TXT de verificación de dominios. En local hay un valor fijo de desarrollo. Rotarla invalida dominios pendientes. | Secreto a generar: `openssl rand -hex 32` |
| `CORS_ORIGINS`         | `*` está **prohibido** fuera de development/test. Lista separada por comas. Sin definirla, CORS queda cerrado.                                                            | Valor, no secreto.                        |

### Secretos opcionales (generar si se usa la función)

| Variable                  | Para qué                                                                                                                                           | Cómo se obtiene        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `APP_ENCRYPTION_KEY`      | Cifra los tokens de los portales (CRM). 32 bytes en hex (64 caracteres) o base64. Sin clave la app arranca, pero falla al guardar/leer un secreto. | `openssl rand -hex 32` |
| `SITES_REVALIDATE_SECRET` | Secreto compartido con `apps/sites` para el aviso de publicación. Si falta `SITES_SERVER_SECRET`, también hace de secreto del throttle.            | `openssl rand -hex 32` |
| `SITES_SERVER_SECRET`     | Con él `apps/sites` se identifica (header `X-Sites-Secret`) para no contar contra el tope por IP. Distinto del anterior.                           | `openssl rand -hex 32` |
| `RESEND_WEBHOOK_SECRET`   | Secreto Svix del webhook de Resend (`whsec_...`).                                                                                                  | Lo entrega Resend.     |

### Credenciales de terceros (solo si se activa el proveedor)

| Variable                                                                         | Se exige cuando                                                                        | Origen                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`           | `STORAGE_PROVIDER=cloudinary`                                                          | Cloudinary → Settings → API Keys |
| `RESEND_API_KEY`, `EMAIL_FROM`                                                   | `EMAIL_PROVIDER=resend`                                                                | Resend + dominio verificado      |
| `FLAGSMITH_ENVIRONMENT_KEY`                                                      | `FEATURE_FLAGS_PROVIDER=flagsmith` (por defecto, flagsmith si hay clave; memory si no) | Flagsmith → server-side key      |
| `TOKKO_API_KEY`                                                                  | `TOKKO_SOURCE=http`                                                                    | Tokko                            |
| `MERCADOLIBRE_APP_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REDIRECT_URI` | `LISTING_PUBLISHER_PROVIDER=mercadolibre`                                              | Mercado Libre Devcenter          |
| `ANTHROPIC_API_KEY`                                                              | `VALUATION_NARRATOR=llm`                                                               | Anthropic                        |

### `SITES_*` (módulo `site`, sitios web de las inmobiliarias)

Todas opcionales en desarrollo. Las que **van vacías a Doppler** (las completa
el dueño cuando se despliega `apps/sites`) son las de URL/dominio; las que son
**secretos a generar** están arriba.

| Variable                    | Tipo              | Nota                                                                                                     |
| --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `SITES_BASE_DOMAIN`         | Valor, vacía      | Dominio base de los subdominios (`<sub>.<dominio>`). Sin valor: solo dominios propios y acceso por slug. |
| `SITES_PROTOCOL`            | Valor, vacía      | `https` (default) o `http` (desarrollo con `*.lvh.me`).                                                  |
| `SITES_DEV_URL`             | Valor, vacía      | URL de la app de sitios para el acceso por slug. Default en desarrollo: `http://localhost:3003`.         |
| `SITES_ALLOWED_IMAGE_HOSTS` | Valor, vacía      | Hosts https extra para imágenes, separados por coma.                                                     |
| `SITES_DOMAIN_VERIFICATION` | Booleano, vacía   | Default `true`. `false` solo en desarrollo: da el dominio por verificado al cargarlo.                    |
| `SITES_REVALIDATE_URL`      | Valor, vacía      | URL base de `apps/sites` (`/api/revalidate`).                                                            |
| `SITES_REVALIDATE_SECRET`   | Secreto a generar | Ver arriba.                                                                                              |
| `SITES_SERVER_SECRET`       | Secreto a generar | Ver arriba.                                                                                              |
| `SITES_PREVIEW_SECRET`      | Secreto a generar | Obligatoria fuera de development/test (32+).                                                             |

### Otras (todas con default; tocar solo si hace falta)

`NODE_ENV` (`development` por defecto; `test`, `qa`, `production`), `APP_NAME`,
`PORT` (3000), `LOG_LEVEL`, `SWAGGER_ENABLED` (por defecto prendido salvo
producción), `BODY_LIMIT`, `TRUST_PROXY`, `SECRETS_PROVIDER`, `JWT_ACCESS_TTL`
(15m), `JWT_REFRESH_TTL` (7d), `JWT_ISSUER`, `JWT_AUDIENCE`,
`BCRYPT_SALT_ROUNDS` (12), `JWT_VALIDATE_USER_ON_REQUEST`,
`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCK_DURATION_MINUTES`, `THROTTLE_*`,
`QUEUE_PROVIDER` (pgboss), `QUEUE_POLLING_INTERVAL_SECONDS`, `STORAGE_PROVIDER`
(local), `STORAGE_LOCAL_DIR`, `STORAGE_PUBLIC_BASE_URL`, `FEATURE_FLAGS_PROVIDER`,
`FEATURE_FLAGS_ENABLED`, `EMAIL_PROVIDER` (console), `PORTAL_BASE_URL`,
`NOTIFICATIONS_PROVIDER`, `PDF_PROVIDER` (pdfmake), `TOKKO_SOURCE` (fixture),
`INDEX_SOURCE_PROVIDER` (bcra-indec), `AUTOMATIONS_ENABLED`, `COMPARABLES_SOURCES`
(no puede incluir `fake` en producción), `VALUATION_*`, `LISTING_PUBLISHER_PROVIDER`
(fake), `BACKOFFICE_BASE_URL`, `CORS_CREDENTIALS`.

Para un desarrollo local típico alcanzan las tres obligatorias.

## 5. Orden de comandos

```bash
# 1. Dependencias (usa package-lock.json)
npm ci

# 2. Postgres 16 (base de desarrollo + base de tests e2e)
npm run docker:dev
#    Credenciales del compose, SOLO desarrollo: usuario adminprop, clave adminprop,
#    base adminprop_development; la base adminprop_test se crea sola
#    (docker/postgres-init/01-create-test-db.sql).
#    DATABASE_URL de dev_backend = postgresql://adminprop:adminprop@localhost:5432/adminprop_development

# 3. Entorno
doppler login && doppler setup        # proyecto admin-prop, config dev_backend

# 4. Migraciones
npm run prisma:migrate                # = doppler run -- prisma migrate dev
```

Sobre las migraciones:

- Hay dos índices parciales que **viven solo en SQL**
  (`site_settings_custom_domain_verified_key` y `job_executions_scheduled_slot_key`).
  `prisma migrate dev` puede proponer borrarlos al detectar "drift": **decir que
  no / no crear una migración que los dropee**. Sobre una base nueva, `migrate dev`
  solo aplica las migraciones existentes.
- Para aplicar sin generar nada (CI, bases compartidas): `npm run prisma:migrate:deploy`
  (no usa Doppler: pasarle `DATABASE_URL`, o `doppler run -- npm run prisma:migrate:deploy`).
- `npm run prisma:generate` regenera el cliente. `package.json` no tiene
  `postinstall` propio (solo `prepare: husky`); después de `npm ci`, correrlo si
  `tsc` o el arranque se quejan de tipos/modelos de Prisma que faltan (**a
  confirmar** si `@prisma/client` ya lo hace solo en tu máquina). Los comandos
  `prisma migrate ...` también regeneran el cliente.

```bash
# 5. Datos
npm run master-data:seed              # catálogo base de maestros en TODAS las inmobiliarias existentes
npm run master-data:seed -- --slug oppido    # o en una sola; idempotente

# 6. Primera inmobiliaria real + su primer administrador
npm run tenant:create -- --name "Oppido Propiedades" --slug oppido --admin-email admin@oppido.com.ar
#   Opcionales: --admin-name "Nombre"   --late-fee-percentage 0.5
#   Sin --late-fee-percentage la inmobiliaria NO tiene punitorio por defecto (D-228):
#   cada contrato indica el suyo, o se configura luego en Configuración.
#   La contraseña del admin se genera y se muestra UNA vez en la terminal.

# 7. Arrancar
npm run start:dev                     # = doppler run -- nest start --watch
```

Notas:

- El alta de la inmobiliaria **ya crea el primer usuario ADMIN** y le carga los
  maestros base; `master-data:seed` sirve para inmobiliarias creadas antes de la
  Fase 5. El administrador cambia la contraseña con `POST /api/v1/auth/change-password`.
  Más usuarios se crean desde la API/backoffice con ese admin.
- Alternativa solo para desarrollo: `npm run prisma:seed` crea la inmobiliaria
  demo (`slug demo`) con `admin@demo.local` / `demo-admin-1234` y un usuario por
  rol; se niega a correr en producción.
- URLs una vez arriba: API `http://localhost:3000/api/v1`, Swagger
  `http://localhost:3000/swagger`, health `http://localhost:3000/health`.
- Build y arranque de producción: `npm run build` y `npm run start:prod`
  (`node dist/src/main`), con las variables ya inyectadas.

## 6. Tests

No usan Doppler: `test/setup.ts` fija valores descartables.

```bash
npm test                      # unitarios (jest)
npm run code:check            # prettier + eslint (lo mismo que el CI)
npx tsc --noEmit              # solo tipos
npm run test:e2e -- test/<archivo>.e2e-spec.ts   # e2e de a UN archivo
```

- Los e2e necesitan Postgres. Por defecto usan
  `postgresql://adminprop:adminprop@localhost:5432/adminprop_test` (la del
  `docker:dev`). Para otra base: `TEST_DATABASE_URL=...`; **el nombre debe
  terminar en `_test`** o se niegan a correr (truncan tablas). La base se migra
  sola y se trunca antes de cada test.
- **No correr todos los e2e juntos**: se queda sin memoria. Correr de a pocos
  archivos (por ejemplo `public`, `billing`, `contracts`, `settlements`, `tenants`,
  `notifications`, `site`, `migration`, `crm`, `automations`).
- Al terminar un cambio, el criterio del repo es: `code:check`, `tsc --noEmit`,
  `npm test` y `test:e2e`.
- El pre-commit (Husky + lint-staged) corre prettier, eslint y los tests
  relacionados; no se saltea con `--no-verify`.

## 7. Problemas conocidos

- **`docker-compose: command not found`**: el script llama a `docker-compose`
  (v1). Con Docker moderno solo existe `docker compose`; instalar el binario
  `docker-compose` o correr `docker compose --profile dev up -d` a mano.
- **El puerto 5432 ya está ocupado** (otro Postgres local): parar ese servicio o
  cambiar el puerto publicado en `docker-compose.yml` y en `DATABASE_URL`.
- **La app no arranca y lista variables**: es la validación de entorno; falta
  `DATABASE_URL` o un `JWT_*_SECRET`, o son iguales entre sí.
- **Con `NODE_ENV=qa` o `production` no arranca**: falta `SITES_PREVIEW_SECRET`
  (32+) o `CORS_ORIGINS` es `*`.
- **`prisma migrate dev` quiere dropear los índices parciales**: no aceptarlo
  (sección 5).
- **e2e: "se niegan a correr contra la base ..."**: el nombre de la base no
  termina en `_test`.
- **e2e: `automations`, test de réplicas del cron con 29 en vez de 28**: ver
  `docs/INTEGRACION_CONSOLIDADO_3.md` (causa investigada ahí).
- **Jest "out of memory" en e2e**: correr de a un archivo.
- **Swagger** solo arranca solo en development/test; en otros entornos hay que
  poner `SWAGGER_ENABLED=true`.
- **`tenant:create` falla con "slug"**: solo minúsculas, números y guiones; debe
  ser único.
- **Claves de integración reales** (Cloudinary, Resend, Tokko, Mercado Libre,
  Flagsmith): no se probaron contra servicios reales al armar esta guía.
