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
npm run start:dev             # desarrollo con watch
npm run code:check            # formato + lint (lo mismo que corre el CI)
npm run code:fix              # arregla formato y lint
npm test                      # unitarios
npm run test:e2e              # e2e (no necesitan base de datos)
npx tsc --noEmit              # sólo tipos
npm run prisma:migrate        # crear y aplicar migración
npm run docker:dev            # Postgres 16
```

Antes de dar por terminado un cambio: `npm run code:check`, `npx tsc --noEmit`,
`npm test` y `npm run test:e2e`. Los cuatro.

## Estructura

Hexagonal en tres capas. La dirección de las dependencias va siempre hacia
adentro: `infrastructure` → `application` → `domain`.

```
src/
├── domain/<feature>/          # Reglas de negocio. Cero imports de NestJS o Prisma.
│   ├── entities/              #   tipos y funciones puras sobre ellos
│   ├── enums/
│   ├── exceptions/            #   errores del dominio
│   └── repositories/          #   puertos: clases abstractas, no interfaces
├── application/<feature>/     # Casos de uso
│   ├── commands/<accion>/     #   <accion>.command.ts + <accion>.handler.ts
│   ├── queries/<consulta>/
│   └── results/
├── infrastructure/<feature>/  # Adaptadores
│   ├── http/controllers/
│   ├── http/dtos/
│   ├── repositories/          #   implementaciones con Prisma
│   ├── services/
│   └── modules/
└── shared/                    # Transversal
    ├── config/                #   validación de entorno y config tipada
    ├── core/                  #   logger, Result, Validate, primitivas DDD
    ├── errors/                #   AppException y catálogo de códigos
    ├── pagination/
    └── infra/                 #   filtros, interceptores, middleware, pipes, throttler
```

**El módulo de auth es la referencia.** Cuando tengas dudas de dónde va algo,
mirá cómo está resuelto ahí.

Los puertos son **clases abstractas** y no interfaces porque NestJS necesita un
token de inyección en runtime, y las interfaces de TypeScript se borran al
compilar.

## Agregar un feature

Para `propiedades`:

1. `src/domain/propiedades/entities/propiedad.entity.ts` — el tipo y sus
   funciones puras.
2. `src/domain/propiedades/repositories/propiedad.repository.ts` — la clase
   abstracta con los métodos que el dominio necesita.
3. `src/application/propiedades/commands/crear-propiedad/` — command + handler.
4. `src/infrastructure/propiedades/repositories/propiedad.repository.impl.ts` —
   la implementación con Prisma.
5. `src/infrastructure/propiedades/repositories/index.ts` — el binding:
   `{ provide: PropiedadRepository, useClass: PropiedadRepositoryImpl }`.
6. `src/infrastructure/propiedades/http/controllers/` y `http/dtos/`.
7. `src/infrastructure/propiedades/modules/propiedades.module.ts`.
8. Registrar el módulo en `src/app.module.ts`.
9. Si la entidad necesita historial de cambios o borrado lógico, declararla en
   `src/infrastructure/prisma/extensions/auditable-models.ts`. Es opt-in: sin
   eso no pasa nada.

El controller queda protegido automáticamente: `JwtAuthGuard` es guard global.

## Errores

**Excepciones en el borde, `Result` dentro del dominio.** Esta es la regla, y
existe porque antes convivían los dos estilos sin criterio.

Los handlers, servicios y repositorios lanzan `AppException`:

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
`src/domain/auth/exceptions/auth.exceptions.ts`.

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
- e2e en `test/`, con Prisma y los repositorios mockeados: no necesitan base.
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
- `.env` nunca se commitea.
