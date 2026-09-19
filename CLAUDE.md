# CLAUDE.md

Lineamientos generales del proyecto (fuente única, no se duplican acá):

@../adminprop-repo-files/CLAUDE.md

> Las rutas que menciona ese archivo (`docs/PRD.md`, `specs/`) son relativas a
> `../adminprop-repo-files/`. En este repo viven `docs/tecnica/`,
> `docs/funcional/` y `docs/DECISIONES_TECNICAS.md` del backend. El frontend es
> otro repo (`../adminprop-frontend`): nunca mezclar cambios de los dos en un
> commit.

Lo que sigue son las convenciones de este repositorio. Si algo de acá contradice
al código, gana el código y hay que actualizar este archivo.

## Qué es

API de administración de propiedades. NestJS 11 + Prisma sobre PostgreSQL 16,
arquitectura hexagonal con CQRS y autenticación JWT propia.

A futuro el plan es partirlo en varias APIs. Por eso el módulo de auth está
aislado y sin acoplarse al resto: es el candidato a convertirse en el servicio
de identidad. Ver la sección final de [docs/AUTH.md](docs/AUTH.md).

## Comandos

```bash
npm run start:dev             # desarrollo con watch, dentro de `doppler run --`
npm run code:check            # formato + lint (lo mismo que corre el CI)
npm run code:fix              # arregla formato y lint
npm test                      # unitarios
npm run test:e2e              # e2e (Postgres de docker:dev, base adminprop_test)
npx tsc --noEmit              # sólo tipos
npm run prisma:migrate        # crear y aplicar migración
npm run docker:dev            # Postgres 16
```

Antes de dar por terminado un cambio: `npm run code:check`, `npx tsc --noEmit`,
`npm test` y `npm run test:e2e`. Los cuatro.

## Estructura

Monolito modular (spec Fase 1, 5.1). Cada módulo de negocio es hexagonal por
dentro, y entre módulos sólo se habla por su `public/` o por eventos.
`eslint-plugin-boundaries` lo hace cumplir: un import que viola las fronteras
rompe el lint (y el pre-commit).

```
src/
├── modules/<modulo>/          # Un módulo de negocio (auth, health, _example, ...)
│   ├── domain/                #   reglas puras: entidades, enums, excepciones y
│   │                          #   puertos de repositorio (clases abstractas).
│   │                          #   Cero imports de NestJS, Prisma o de otra capa.
│   ├── application/           #   casos de uso CQRS
│   │   ├── commands/<accion>/ #     <accion>.command.ts + <accion>.handler.ts
│   │   └── queries/<consulta>/
│   ├── infrastructure/        #   adaptadores: http/ (controllers, dtos),
│   │                          #   repositories/ (Prisma), services/, modules/
│   └── public/                #   lo ÚNICO que otros módulos pueden importar
├── platform/<puerto>/         # Puertos técnicos con sus adapters (queue, storage,
│                              #   feature-flags, email). No conocen ningún módulo.
├── shared/                    # Transversal, sin dependencias hacia modules/
│   ├── config/                #   validación de entorno y config tipada
│   ├── context/               #   RequestContext (AsyncLocalStorage): usuario y tenant
│   ├── prisma/                #   PrismaService + extensiones (tenant, soft delete, auditoría)
│   ├── money/                 #   decimal.js, ROUND_HALF_UP
│   ├── errors/                #   AppException y catálogo de códigos
│   ├── pagination/
│   └── infra/                 #   filtros, interceptores, pipes, throttler
└── app.module.ts, main.ts     # Raíz de composición: la única que ve todo
```

Qué puede importar cada cosa:

| Desde                           | Puede importar                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `modules/x/domain`              | su propio `domain` y `shared`                                         |
| `modules/x/{application,infra}` | todo `modules/x`, el `public/` de otros módulos, `platform`, `shared` |
| `platform/p`                    | su propio puerto y `shared`                                           |
| `shared`                        | sólo `shared`                                                         |

Los tests (`test/**`) quedan afuera de la regla: arman escenarios con piezas
internas a propósito.

**`modules/_example` es la referencia** (llega con la task 12 de la Fase 1). Mientras
tanto, `modules/auth`.

Los puertos son **clases abstractas** y no interfaces porque NestJS necesita un
token de inyección en runtime, y las interfaces de TypeScript se borran al
compilar.

## Agregar un feature

Para `properties`:

1. `src/modules/properties/domain/` — entidad, reglas puras y el puerto del
   repositorio (clase abstracta).
2. `src/modules/properties/application/commands/create-property/` y
   `queries/` — command/query + handler.
3. `src/modules/properties/infrastructure/repositories/` — la implementación
   con `prisma.db` y el binding
   `{ provide: PropertyRepository, useClass: PropertyRepositoryImpl }`.
4. `src/modules/properties/infrastructure/http/` — controller y DTOs.
5. `src/modules/properties/infrastructure/modules/properties.module.ts`,
   registrado en `src/app.module.ts`.
6. `src/modules/properties/public/` — sólo lo que otros módulos necesiten
   (una facade o tipos). Si nadie lo necesita, queda vacío.
7. Declarar el modelo en `src/shared/prisma/extensions/auditable-models.ts`:
   `tenantScoped: true` si tiene `tenantId` (un test lo exige), y
   `audit`/`softDelete` si necesita historial o borrado lógico.

El controller queda protegido automáticamente: `JwtAuthGuard` es guard global.

## Errores

**Excepciones en el borde, `Result` dentro del dominio.** Esta es la regla, y
existe porque antes convivían los dos estilos sin criterio.

Una **regla de negocio** que falla lanza una subclase de `DomainException`
(`@/shared/errors`), con un `code` estable y un `DomainErrorKind`
(`NotFound`, `Conflict`, `BusinessRule`, `Forbidden`). El filtro global la
traduce a 404/409/422/403; el dominio nunca elige un status HTTP. Ver
[docs/ERROR-HANDLING.md](docs/ERROR-HANDLING.md).

Para errores de **infraestructura o de entrada** (auth, validación, servicios
externos), los handlers, servicios y repositorios lanzan `AppException`:

```ts
import { AppException, ErrorCode } from '@/shared/errors'

throw AppException.notFound('La propiedad no existe')
throw AppException.conflict(
  'Matrícula duplicada',
  ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
)
```

`Result<T, E>` se usa sólo **dentro** del dominio, para fallos esperables que
son parte de la lógica de negocio (validar invariantes al construir una entidad,
por ejemplo). Nunca cruza hacia el controller: el handler lo traduce a
`AppException`.

No uses las excepciones nativas de Nest (`NotFoundException` y compañía).
Funcionan —el filtro las normaliza— pero perdés el `code`, que es el contrato
estable con el frontend.

Para errores de dominio que se repiten, agrupalos como en
`src/modules/auth/domain/exceptions/auth.exceptions.ts`.

Detalle completo en [docs/ERROR-HANDLING.md](docs/ERROR-HANDLING.md).

## Estilo

- Prettier manda: sin punto y coma, comillas simples, coma final, 2 espacios.
- `strict: true` está activo. Nada de `any` ni `!` para callar al compilador; si
  el tipo no cierra, casi siempre es que falta una comprobación real.
- En un `catch`, el error es `unknown`. Usá `errorMessage()` / `errorStack()` de
  `@/shared/core/error-message`.
- Nada fuera de `shared/config` lee `process.env`. Todo pasa por `ConfigService`
  con `get('clave', { infer: true })` — **sin** genérico explícito, que pisa la
  inferencia.
- Alias `@/` para importar desde `src/`.
- **Dinero: nunca `number`.** Todo monto pasa por `@/shared/money`
  (`decimal.js`, `ROUND_HALF_UP` a 2 decimales en cada operación). En los DTOs
  de entrada, `@IsMoneyAmount()`; hacia afuera, `toMoneyString()`. El frontend
  no calcula montos: recibe strings y sólo los formatea.
- Los listados se paginan con `@/shared/pagination`, siempre con `orderBy`
  explícito. Ver [docs/PAGINATION.md](docs/PAGINATION.md).
- Los repositorios usan **`prisma.db`**, no `prisma` a secas: el primero lleva
  las extensiones de soft delete y auditoría. Ver
  [docs/AUDIT-SOFT-DELETE.md](docs/AUDIT-SOFT-DELETE.md).
- Para loguear: `createLogger('MiClase')` de `@/shared/logging/root-logger`.
  **pino recibe primero el objeto y después el mensaje**, al revés que Nest:
  `logger.info({ userId }, 'Login exitoso')`. El `correlationId` y el `userId`
  se agregan solos desde el `RequestContext`; no hace falta pasarlos.

### Comentarios

Comentá el **por qué**, no el qué. Un comentario que repite lo que dice la línea
siguiente es ruido; uno que explica por qué se eligió ese camino, o qué pasa si
lo cambiás, ahorra una investigación. Los casos que más lo valen: decisiones de
seguridad, workarounds de librerías y órdenes de ejecución que importan.

## Tests

- Unitarios al lado del código: `src/**/*.spec.ts`.
- e2e en `test/`. `app.e2e-spec.ts` mockea Prisma (cableado y contrato de
  errores); el resto corre contra Postgres real, en la base `adminprop_test`
  (`TEST_DATABASE_URL`), que se migra sola y se trunca antes de cada test.
  Nunca usan el `DATABASE_URL` del entorno, y se niegan a correr contra una base
  cuyo nombre no termine en `_test`.
- Los e2e usan `configureApp()` de `src/app.setup.ts`, la misma función que
  `main.ts`. Si agregás un pipe, filtro o middleware global, va ahí y no en
  `main.ts`, o los tests probarán una app distinta de la real.
- Los nombres de los tests describen la conducta esperada, en español.
- Cuando arregles un bug, el test que lo cubre explica en un comentario qué
  fallaba.

## Seguridad

Cosas que están así a propósito y conviene no "simplificar":

- **`JwtAuthGuard` es global y cierra por defecto.** Un endpoint nuevo nace
  protegido; se abre con `@IsPublic()`.
- **El login no revela si un email existe.** Mismo error, mismo mensaje, y un
  bcrypt descartable para igualar los tiempos.
- **Los refresh tokens rotan y se guarda su hash.** Reusar uno ya rotado revoca
  toda la familia.
- **Nada sensible en los logs.** pino redacta por rutas declaradas en
  `root-logger.ts`. Si agregás un campo sensible con un nombre nuevo, sumalo ahí.
- **CORS cerrado si no hay `CORS_ORIGINS`.** No lo abras con `*` "para probar".
- **El `passwordHash` nunca entra al historial de auditoría.** Guardar su "antes
  y después" sería filtrar material para crackear offline.

## Git

- Se trabaja sobre `dev`. Una rama por fase (`feature/fase-XX-<nombre>`), un
  commit por task, PR contra `dev`. El merge lo hace un humano.
- Mensajes de commit en **inglés**, Conventional Commits con scope
  (`feat(tenancy): ...`). El historial anterior quedó en español; de acá en
  adelante, inglés.
- El pre-commit (Husky + lint-staged) corre prettier, eslint y los tests
  relacionados con los archivos staged. No se saltea con `--no-verify`.
- El cuerpo explica **por qué**, no lista los archivos tocados: eso ya está en el
  diff.
- No existe `.env`: las variables salen de Doppler (proyecto `admin-prop`,
  config `dev_backend`). Los scripts que necesitan entorno ya corren dentro de
  `doppler run --`; tests y CI usan valores descartables propios.
