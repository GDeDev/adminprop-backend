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

### D-13 · Los e2e corren con `--experimental-vm-modules`

- **Contexto**: en NestJS 11, `FileTypeValidator` valida el tipo de archivo
  por su contenido (magic numbers) con el paquete `file-type`, que es sólo
  ESM. Jest en modo CommonJS no puede cargarlo y el validador rechaza todo.
- **Decisión**: `test:e2e` corre Jest con `node --experimental-vm-modules`.
- **Por qué**: validar por contenido es más seguro que confiar en el mimetype
  que manda el cliente; no se cambia la validación por una limitación del
  runner de tests. En runtime (Node) funciona sin flags.

### D-14 · El evento hacia otros módulos no es transaccional (todavía)

- **Contexto**: la spec pide emitir eventos por `EventBus` y transportarlos por
  pg-boss.
- **Decisión**: un handler del `EventBus` (relay) publica en la cola después
  de guardar. Si la publicación falla, se loguea y el efecto se pierde.
- **Por qué**: alcanza para la Fase 1. Para eventos que nunca pueden perderse
  (un pago confirmado, Fase 11) el patrón es un **outbox**: escribir el evento
  en la misma transacción que el dato y publicarlo después. Queda para la
  primera fase que lo necesite.

### D-15 · Los clientes se dan de alta con un comando, no con variables

- **Contexto**: el PR #2 creaba la primera inmobiliaria desde variables
  `SEED_*` en Doppler. Usado para sumar clientes, Doppler terminaba siendo un
  formulario de alta, y los clientes son datos, no configuración.
- **Decisión**: `npm run tenant:create -- --name … --slug … --admin-email …`
  crea la inmobiliaria y su admin, con una contraseña generada que se muestra
  una vez. El seed queda sólo para una inmobiliaria demo de desarrollo, con
  credenciales fijas y bloqueado en producción. Se eliminan las `SEED_*`.
- **Por qué**: cada cliente es una fila de `tenants`; ni un entorno ni un
  secreto. La lógica queda en una función reutilizable por una futura pantalla
  de alta.

---

## Fase 4

> La Fase 4 se hizo **sin supervisión**, con autorización de Giuliano: estas
> decisiones las tomó Claude Code y están pendientes de revisión.

### D-16 · Las credenciales de portal viven en `users`, con email único por audiencia

- **Contexto**: el PRD guarda el acceso al portal en el Propietario y el
  Inquilino (`portal_usuario`, `portal_password_hash`), y la spec pide que el
  mismo email de propietario pueda existir en dos inmobiliarias. Pero en la
  Fase 1 se decidió email único global, porque el login del backoffice no pide
  inmobiliaria.
- **Decisión**: propietarios e inquilinos son filas de `users` con rol `OWNER`
  o `RENTER`, igual que admins y empleados. El índice único de `email` se
  parte en dos índices parciales:
  - `ADMIN`/`EMPLOYEE`: único en todo el sistema;
  - `OWNER`/`RENTER`: único por `(tenant, rol, email)`.
    El "usuario" de portal es el email.
- **Por qué**: auth es candidato a extraerse a un servicio propio y no debe
  leer tablas de otros módulos (CLAUDE.md). Con una sola tabla, el refresh,
  la rotación, el bloqueo por intentos, `/auth/me` y los guards funcionan igual
  para todos, sin un `RefreshToken` polimórfico. Prisma no puede declarar
  índices parciales, pero los ignora al comparar: se escribieron a mano en la
  migración y no los toca nunca.
- **Pendiente para las Fases 7 y 8**: al dar de alta el acceso de un
  propietario o inquilino, crear su usuario por una facade de auth y guardar
  el vínculo con la ficha (el "id de la entidad en el claim" de la spec 3.2).

### D-17 · El login de portal recibe el slug de la inmobiliaria

- **Contexto**: con el email único por inmobiliaria, el email no alcanza para
  saber a qué inmobiliaria entra un propietario.
- **Decisión**: `POST /auth/portal-login` pide `{ tenantSlug, email, password,
type }`. El slug se resuelve con `TenantsFacade` (módulo nuevo `tenants`) y
  el usuario se busca sólo dentro de esa inmobiliaria. Inmobiliaria
  inexistente, deshabilitada, puerta equivocada o contraseña mala: el mismo
  401 genérico, con el mismo tiempo de bcrypt.
- **Por qué**: es la forma más simple de garantizar "sin cruce entre tenants".
  El portal sabe su inmobiliaria por configuración hoy y por dominio en la
  Fase 22.

### D-18 · Cuenta o inmobiliaria deshabilitada: 401 genérico en el login

- **Contexto**: la Fase 1 respondía `403 ACCOUNT_INACTIVE` después de validar
  la contraseña. La spec (casos borde) pide el mismo 401 que credenciales
  inválidas.
- **Decisión**: se sigue la spec: `401 INVALID_CREDENTIALS`.
- **Por qué**: el 403 confirmaba que la contraseña era la correcta.

### D-19 · El guard valida al usuario en cada request, por defecto

- **Contexto**: la spec pide 401 para un token cuyo tenant ya no existe, y que
  un usuario desactivado no pueda operar. Con el access token stateless eso
  tardaba hasta 15 minutos.
- **Decisión**: `JWT_VALIDATE_USER_ON_REQUEST` pasa a `true` por defecto. El
  guard busca al usuario por id (dentro del tenant del token) en cada request.
  Usuario inexistente, desactivado o de una inmobiliaria deshabilitada:
  `401 SESSION_REVOKED`. También toma el rol de la base, así que un cambio de
  rol rige desde el request siguiente.
- **Por qué**: cuesta una consulta por clave primaria por request, que a la
  escala del MVP no se nota, y hace que "desactivar" signifique desactivar.

### D-20 · Rate limit de login: 5 por minuto; el refresh sin límite estricto

- **Contexto**: la Fase 1 limitaba login, refresh y logout a 10 cada 15
  minutos por IP. La spec pide 5 por minuto en los logins.
- **Decisión**: `THROTTLE_AUTH_*` por defecto 5 intentos / 60 s, en los dos
  logins y en el cambio de contraseña. Refresh y logout quedan con el límite
  global.
- **Por qué**: una oficina entera sale por la misma IP. Con 10 cada 15
  minutos, a las 9 de la mañana el empleado número 11 no podía entrar, y el
  refresh silencioso de todos compartía el mismo cupo. Contra una cuenta
  puntual sigue el bloqueo por intentos fallidos (5 → 15 minutos).

### D-21 · `POST /auth/logout` sigue siendo público

- **Contexto**: la spec lo marca como autenticado.
- **Decisión**: se mantiene público: revoca el refresh token que recibe y
  responde 204 siempre.
- **Por qué**: cerrar sesión tiene que funcionar aunque el access token ya
  haya vencido. Sin el refresh token no se puede revocar nada, así que no
  abre ningún ataque.

### D-22 · Alta de usuarios con contraseña definida por el admin

- **Contexto**: la spec deja abierto "invitación por email o password
  directo".
- **Decisión**: el admin define la contraseña inicial en `POST /users`, con la
  misma política que el cambio de contraseña. Además de lo que pide la spec se
  agregaron `GET /users/:id` (lo necesita la pantalla de edición) y
  `PATCH /users/:id/activate` (desactivar sin poder volver atrás es una
  trampa). Reglas: nadie puede cambiarse su propio rol, desactivarse ni
  resetearse la contraseña por `/users`. Con eso la inmobiliaria nunca se queda
  sin admin, sin tener que contar admins.
- **Por qué**: la invitación por email necesita un proveedor real de email
  (Fase 14). Se puede sumar después sin cambiar el resto.

### D-23 · La respuesta del login mantiene `{ user, tokens }`

- **Contexto**: la spec muestra `{ accessToken, refreshToken, user }` plano.
- **Decisión**: se mantiene el contrato de la Fase 1: el sobre
  `{ success, message, data }` con `data: { user, tokens: { accessToken,
refreshToken, tokenType, expiresIn } }`.
- **Por qué**: ya estaba documentado y probado; `expiresIn` le sirve al front
  para programar el refresh. Cambiarlo no aporta nada.

### D-24 · El contrato OpenAPI se exporta a `openapi.json`

- **Contexto**: el frontend genera sus tipos desde el OpenAPI (decisión de la
  Fase 1), y los dos repos no comparten carpeta en CI.
- **Decisión**: `npm run openapi:export` arma la app en modo `preview` (sin
  base) y escribe `openapi.json`, que se commitea. El CI lo regenera y falla si
  difiere. El frontend lo lee de `../adminprop-backend/openapi.json`.
- **Limitación conocida**: las respuestas de un solo objeto documentan el
  modelo y no el sobre `{ success, message, data }` (las paginadas sí). El
  frontend envuelve el tipo con `ApiSuccess<T>`. Documentar el sobre en todos
  los endpoints es un cambio aparte.

### D-25 · El refresh token en cookie lo maneja el frontend, no la API

- **Contexto**: la spec pide el refresh token en una cookie httpOnly "si es
  posible".
- **Decisión**: la API no cambia: sigue recibiendo y devolviendo el refresh
  token en el cuerpo. Cada app de Next tiene route handlers propios que lo
  guardan en una cookie httpOnly de su dominio. Ver las decisiones del
  frontend.
- **Por qué**: el front y la API van a estar en dominios distintos (Vercel y
  Render). Una cookie de la API sería de terceros para el navegador, y Safari
  las bloquea. Además la API queda sin CORS con credenciales.
