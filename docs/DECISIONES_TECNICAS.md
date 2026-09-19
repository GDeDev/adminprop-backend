# Decisiones técnicas

Ambigüedades técnicas que las specs no resolvían, qué se decidió y por qué
(regla del CLAUDE.md del proyecto). Las decisiones de producto o de alcance que
tomó Giuliano están en `adminprop-repo-files/docs/PROGRESO.md`.

Formato: **contexto** → **decisión** → **por qué**. Lo más nuevo, abajo.

---

## Fase 1

### D-01 · Los e2e no corren dentro de `doppler run`

- **Contexto**: la regla de Doppler pide envolver todo script que necesite
  entorno, `test:e2e` incluido.
- **Decisión**: `test:e2e` no se envuelve. Los tests fijan sus propios valores
  descartables (`test/setup.ts`) y la base sale de `TEST_DATABASE_URL`, con
  default `adminprop_test` del docker-compose. Además, se niegan a correr contra
  una base cuyo nombre no termine en `_test`.
- **Por qué**: los e2e truncan tablas. Dentro de `doppler run`, `DATABASE_URL`
  apunta a la base de desarrollo y la vaciarían. En CI tampoco hay Doppler.

### D-02 · `start:prod` y `prisma:migrate:deploy` sin wrapper de Doppler

- **Contexto**: misma regla.
- **Decisión**: sólo los scripts de desarrollo llevan `doppler run --`.
- **Por qué**: en los entornos desplegados las variables las inyecta la
  integración nativa de Doppler con la plataforma (Fase 16), sin la CLI.

### D-03 · `runInTenant` hace el `await` adentro del scope

- **Contexto**: las consultas de Prisma son perezosas: recién se ejecutan con
  el `await`. `runInTenant(id, () => prisma.db.x.findMany())` devolvía la
  promesa sin ejecutar y la consulta corría ya fuera del tenant.
- **Decisión**: `runInTenant` sólo acepta funciones async y hace
  `await fn()` dentro del `AsyncLocalStorage`.
- **Por qué**: el error aparecía recién contra la base real y es fácil de
  repetir. Mejor que la firma no lo permita.

### D-04 · `audit_logs` guarda `tenantId` pero no pasa por el filtro de tenant

- **Contexto**: toda tabla con `tenantId` debería filtrarse.
- **Decisión**: `AuditLog` queda fuera del filtro por ahora, declarado en la
  lista de excepciones de `tenant-scoped-models.spec.ts`.
- **Por qué**: la escribe la extensión de auditoría también desde procesos de
  sistema sin tenant. Su lectura por tenant llega con la pantalla de auditoría
  (Fase 20), que es donde se decide cómo se consulta.

### D-05 · `Tenant` sin auditoría

- **Contexto**: los parámetros del tenant (honorarios, punitorio) son datos
  sensibles.
- **Decisión**: por ahora `audit: false`.
- **Por qué**: se crea por seed y no hay ABM en el MVP. Cuando se puedan editar
  sus parámetros, se le suman `createdById`/`updatedById` y se audita.

### D-06 · `error` en el cuerpo de error es el nombre del status HTTP

- **Contexto**: la spec muestra `"error": "ValidationError"` sin definir de
  dónde sale.
- **Decisión**: `error` es el nombre estándar del status (`"Bad Request"`,
  `"Not Found"`), como en el formato por defecto de NestJS. El tipo de error
  estable va en `code` (`VALIDATION_FAILED`, `CONTRACT_ALREADY_ACTIVE`).
- **Por qué**: un campo con dos significados (a veces el status, a veces la
  clase de la excepción) no se puede usar para ramificar. `code` ya cumple ese
  rol.

### D-07 · `DomainException` extiende `Error`, no `HttpException`

- **Contexto**: la spec pide excepciones de dominio mapeadas a HTTP en el
  filtro.
- **Decisión**: `DomainException` declara un `DomainErrorKind` (`NotFound`,
  `Conflict`, `BusinessRule`, `Forbidden`) y el filtro global lo traduce a
  404/409/422/403.
- **Por qué**: el dominio no importa NestJS ni conoce HTTP. `AppException`
  sigue existiendo para errores de infraestructura y de entrada.

### D-08 · pg-boss 10 en lugar de 12

- **Contexto**: la última versión de pg-boss (12) se publica sólo como ESM.
- **Decisión**: pg-boss `~10.4`, rama `maint-v10`, que sigue mantenida.
- **Por qué**: el proyecto compila a CommonJS y Jest corre en modo CommonJS,
  que no carga paquetes ESM sin transpilarlos. La API de colas, reintentos y
  dead-letter es la misma. Pasar a la 12 va junto con mover el proyecto a ESM.

### D-09 · `StoragePort.delete` recibe la `key`, no la URL

- **Contexto**: la spec define `delete(url)`.
- **Decisión**: `upload` devuelve `{ url, key }` y `delete(key)`.
- **Por qué**: la URL depende del CDN o del dominio y puede cambiar; la key
  identifica al archivo en el proveedor. En Cloudinary además hace falta el
  tipo de recurso (imagen o raw) para borrar, y va en la key.

### D-10 · Los archivos se guardan por tenant

- **Contexto**: la spec no dice cómo se organizan los archivos.
- **Decisión**: el adapter antepone `tenants/<tenantId>/` al path y rechaza
  borrar keys de otro tenant.
- **Por qué**: el mismo principio que el filtro de Prisma: el aislamiento no
  depende de que cada módulo arme bien el path.

### D-11 · Proveedor de feature flags por defecto según la key

- **Contexto**: se acordó `FEATURE_FLAGS_PROVIDER` (memory | flagsmith), y
  Claude Code no carga valores en Doppler, sólo crea variables vacías.
- **Decisión**: sin valor explícito, es `flagsmith` si existe
  `FLAGSMITH_ENVIRONMENT_KEY` y `memory` si no. Con `flagsmith` explícito, la
  key es obligatoria al arrancar.
- **Por qué**: el desarrollo local usa Flagsmith real sin cargar nada nuevo en
  Doppler, y los tests (que no tienen la key y fuerzan `memory`) no salen a la
  red.

### D-12 · `GET /jobs/:id/status` sólo para ADMIN y EMPLOYEE

- **Contexto**: la spec sólo pide validar que el job sea del tenant del
  usuario.
- **Decisión**: además del tenant, el endpoint exige rol `ADMIN` o `EMPLOYEE`.
- **Por qué**: propietarios e inquilinos pertenecen al mismo tenant que la
  inmobiliaria, y el `result` de un trabajo puede tener datos de otros. Si un
  portal necesita trabajos propios, se abre con un filtro por `startedById`.
