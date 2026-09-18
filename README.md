# NestJS API Template

Template de API en NestJS con arquitectura hexagonal, CQRS, Prisma y
autenticación JWT propia.

[![NestJS](https://img.shields.io/badge/NestJS-10-red?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)](https://www.prisma.io/)

**Sin dependencias privadas.** Todo lo que necesita sale del registry público.

---

## Arranque rápido

```bash
# 1. Dependencias
npm install

# 2. Entorno
cp .env.example .env
# Generá los dos secretos JWT (tienen que ser distintos entre sí):
#   openssl rand -base64 48

# 3. Base de datos
npm run docker:dev            # levanta Postgres 16 (base de dev + base de tests)
npm run prisma:migrate        # aplica las migraciones

# 4. Primer administrador
SEED_ADMIN_EMAIL=admin@tuempresa.com \
SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)" \
npm run prisma:seed

# 5. Arrancar
npm run start:dev
```

- API → http://localhost:3000/api/v1
- Swagger → http://localhost:3000/swagger
- Health → http://localhost:3000/health

Si falta alguna variable de entorno, la app **no arranca** y te dice cuál.

---

## Qué trae

### Arquitectura

- **Hexagonal** — `domain` (reglas y puertos) / `application` (casos de uso) /
  `infrastructure` (adaptadores). El dominio no conoce Prisma ni HTTP.
- **CQRS** con `@nestjs/cqrs`: comandos y queries separados.
- **Result pattern** para errores esperables del dominio, sin excepciones.
- Alias `@/` a `src/`.

### Autenticación

Módulo propio, ver **[docs/AUTH.md](docs/AUTH.md)**.

- JWT access (15 min) + refresh (7 días) **con rotación y detección de reuso**.
- Refresh tokens persistidos como hash SHA-256, revocables por sesión o todas.
- bcrypt costo 12, con re-hash automático si subís el costo.
- Guard global: **todo requiere token salvo lo marcado con `@IsPublic()`**.
- Roles con `@Roles(Role.ADMIN)` y usuario inyectado con `@CurrentUser()`.
- Bloqueo de cuenta tras N intentos fallidos.
- Login que no permite enumerar qué emails están registrados.

### Seguridad y operación

- **Rate limiting** en tres ventanas + límite estricto en auth —
  [docs/RATE-LIMITING.md](docs/RATE-LIMITING.md)
- **Errores unificados** con códigos estables y sin filtrar internals en
  producción — [docs/ERROR-HANDLING.md](docs/ERROR-HANDLING.md)
- **Config validada al arranque**, tipada por namespace, con punto de extensión
  para un secret manager externo — [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- Helmet, CORS cerrado por defecto, límites de payload, compresión.
- Correlation ID en toda request y en toda respuesta, incluidos los errores.
- Redacción automática de contraseñas y tokens en los logs.
- Shutdown hooks: un deploy no corta requests en vuelo.

### Base de datos

Prisma + PostgreSQL 16, con migraciones versionadas y seed.

### Testing

Jest con tests unitarios co-locados (`src/**/*.spec.ts`) y e2e (`test/`). Los
e2e corren contra la app configurada igual que en producción, con Prisma
mockeado: no necesitan base de datos.

---

## Estructura

```
src/
├── domain/                    # Reglas de negocio. Sin dependencias de framework.
│   ├── auth/                  #   entidades, enums, puertos de repositorio, excepciones
│   └── feature/               #   ← tu dominio va acá
├── application/               # Casos de uso (CQRS)
│   ├── auth/                  #   register, login, refresh, logout, change-password
│   └── feature/
├── infrastructure/            # Adaptadores: HTTP, Prisma, servicios externos
│   ├── auth/                  #   controller, guards, decoradores, repos, tasks
│   ├── health/
│   ├── prisma/
│   └── example/               #   ← módulo de ejemplo, borralo cuando no lo necesites
├── shared/
│   ├── config/                # Validación de entorno, config tipada, secretos
│   ├── core/                  # Logger, Result, primitivas de DDD
│   ├── errors/                # Catálogo de códigos y AppException
│   ├── dtos/                  # Formato de respuesta de la API
│   ├── infra/                 # Filtros, interceptores, middleware, pipes, throttler
│   └── services/
├── app.module.ts
├── app.setup.ts               # Pipes, filtros y middlewares (lo reusan los e2e)
└── main.ts
```

---

## Scripts

| Comando                         | Qué hace                            |
| ------------------------------- | ----------------------------------- |
| `npm run start:dev`             | Desarrollo con watch                |
| `npm run build`                 | Compila a `dist/`                   |
| `npm test`                      | Tests unitarios                     |
| `npm run test:e2e`              | Tests e2e                           |
| `npm run test:cov`              | Cobertura                           |
| `npm run code:check`            | Formato + lint (lo que corre en CI) |
| `npm run code:fix`              | Arregla formato y lint              |
| `npm run prisma:migrate`        | Crea y aplica una migración         |
| `npm run prisma:migrate:deploy` | Aplica migraciones (producción)     |
| `npm run prisma:seed`           | Crea el administrador inicial       |
| `npm run prisma:studio`         | GUI de la base                      |
| `npm run docker:dev`            | Postgres 16                         |
| `npm run docker:prod`           | Stack completo con la API           |

---

## Agregar un feature

El módulo `example` está para copiar. Para un feature `propiedades`:

```
src/domain/propiedades/
├── entities/propiedad.entity.ts
└── repositories/propiedad.repository.ts      # puerto abstracto

src/application/propiedades/
├── commands/crear-propiedad/
└── queries/listar-propiedades/

src/infrastructure/propiedades/
├── http/controllers/propiedades.controller.ts
├── http/dtos/
├── repositories/propiedad.repository.impl.ts # implementación con Prisma
└── modules/propiedades.module.ts
```

Registrá el módulo en `app.module.ts`. El controller ya queda protegido por el
guard global: no hace falta decorar nada para exigir autenticación.

---

## Producción

```bash
docker build -t mi-api .
docker run -p 3000:3000 --env-file .env.produccion mi-api
```

Antes de salir a producción:

- [ ] `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` generados con
      `openssl rand -base64 48`, distintos entre sí, inyectados como variables de
      entorno (**no** en un archivo dentro de la imagen).
- [ ] `CORS_ORIGINS` con la lista explícita de orígenes. Nunca `*`.
- [ ] `TRUST_PROXY=true` si hay balanceador o ingress adelante.
- [ ] `SWAGGER_ENABLED=false` (es el default en producción).
- [ ] `npm run prisma:migrate:deploy` en el pipeline de deploy.
- [ ] Rate limiting con storage compartido si corrés más de una réplica
      (ver [docs/RATE-LIMITING.md](docs/RATE-LIMITING.md)).
- [ ] Probes apuntando a `/health/ready` y `/health/live`.

---

## Documentación

| Doc                                                           | Sobre                                        |
| ------------------------------------------------------------- | -------------------------------------------- |
| [AUTH.md](docs/AUTH.md)                                       | Auth: flujo, guards, decisiones de seguridad |
| [ERROR-HANDLING.md](docs/ERROR-HANDLING.md)                   | Formato de errores y códigos                 |
| [CONFIGURATION.md](docs/CONFIGURATION.md)                     | Entorno, config tipada y secretos            |
| [RATE-LIMITING.md](docs/RATE-LIMITING.md)                     | Throttling y storage                         |
| [ADVANCED-LOGGING-SYSTEM.md](docs/ADVANCED-LOGGING-SYSTEM.md) | Logger estructurado                          |
| [CORRELATION-ID-HANDLING.md](docs/CORRELATION-ID-HANDLING.md) | Trazabilidad de requests                     |
| [DEBUGGING.md](docs/DEBUGGING.md)                             | Debug en VS Code                             |
| [FORMATTING.md](docs/FORMATTING.md)                           | Prettier, ESLint y hooks                     |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md)                       | Convenciones del repo                        |

---

## Licencia

MIT — ver [LICENSE](LICENSE).
