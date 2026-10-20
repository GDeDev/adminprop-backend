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

---

## Fase 5

> También **sin supervisión**, en una rama encadenada sobre la de la Fase 4. Pendiente de revisión.

### D-26 · Maestros por inmobiliaria: una tabla por maestro, con `tenant_id`

- **Contexto**: la spec propone maestros globales (sin `tenant_id`), pero también que un admin los edite. El CLAUDE.md pide `tenant_id` en toda entidad nueva y un test de aislamiento.
- **Decisión**: una sola tabla por tipo de maestro (`property_types`, `amenities`, `operation_types`, `service_types`, `locations`), compartida por todas las inmobiliarias, con `tenant_id` en cada fila. **No** hay tablas por cliente.
- **Por qué no globales**: si fueran globales, el admin de una inmobiliaria que renombra o desactiva "Casa" se la cambiaría a todas.
- **Performance** (lo pidió Giuliano): índices `(tenant_id)` en todas; en ubicaciones, además, `(tenant_id, parent_id)` y `(tenant_id, level)`. Los únicos por nombre son `(tenant_id, lower(name))`, que también sirven para buscar. Cada inmobiliaria suma unas 25 filas del catálogo base: con 1.000 clientes son 25.000 filas, nada para Postgres con esos índices.
- **A futuro**: si hiciera falta un catálogo compartido de sólo lectura (por ejemplo, la geografía de Argentina, igual para todos), se agrega sin tocar esto, como la spec sugiere: `tenant_id` nullable, null = global.

### D-27 · Nombres únicos sin distinguir mayúsculas, con índices por expresión

- **Decisión**: índices únicos sobre `(tenant_id, lower(name))`; en ubicaciones, `(tenant_id, COALESCE(parent_id, <uuid cero>), lower(name))`. El COALESCE es porque un índice único trata cada NULL como distinto: sin él podría haber dos países "Argentina".
- Los handlers chequean antes y devuelven 409 con un mensaje claro; el índice es la red de seguridad ante carreras.
- Prisma no declara índices por expresión pero los ignora al comparar (verificado con `prisma migrate diff`), igual que los parciales de la Fase 4.

### D-28 · Jerarquía de ubicaciones

- Un país va sin padre; todo lo demás lo necesita. Sin padre: **400** (lo pide la spec, lo valida el DTO). Padre inexistente, de otra inmobiliaria o que no puede contenerla: **422**.
- **Se pueden saltear niveles** (una localidad directo en un país): los datos de Tokko no siempre traen los cuatro niveles. Lo que no se permite es un padre del mismo nivel o más específico.
- `PATCH /locations/:id` sólo **renombra**. Mover de padre arrastra todo lo que cuelga y lo que la usa; si hace falta, es un caso aparte.
- Se agregó `PATCH /locations/:id/activate` (la spec sólo lista deactivate, pero su caso borde habla de reactivar).

### D-29 · Listados sin paginar; lectura para todo el staff

- Los maestros son listas cortas: se devuelven completos, ordenados por nombre, sin paginar (el resto de los listados sí se paginan).
- `?isActive=true` (por defecto, lo que usan los selectores), `false` o `all` (pantalla de administración).
- Leer: admin y empleado (los selectores de las altas los usan todos). Escribir: sólo admin (criterio de la spec).
- No existe endpoint de borrado: desactivar es el único "borrado" (spec 4).

### D-30 · Catálogo base al dar de alta cada inmobiliaria

- `tenant:create` carga el catálogo base de la spec en la misma transacción del alta. El seed de demo suma localidades y barrios de ejemplo.
- `npm run master-data:seed` (idempotente) completa las inmobiliarias que ya existían antes de esta fase. **Hay que correrlo una vez** para las creadas antes (ej. Oppido).
- Ubicaciones base: Argentina, Buenos Aires y CABA. Las reales llegan con la importación de Tokko (Fase 21), como dice la spec.

---

## Fase 6

> Sin supervisión, rama encadenada sobre la Fase 5. Pendiente de revisión.

### D-31 · Sin FK a los maestros ni al propietario

- `properties.location_id`, `property_type_id`, `amenity_ids` y `owner_id` no tienen FK: los módulos no comparten tablas (regla del CLAUDE.md, igual que en `_example-listener`). Se validan al guardar con `MasterDataFacade` (existen en la inmobiliaria y están activos).
- Como los maestros nunca se borran (sólo se desactivan), no quedan referencias colgadas.
- Amenities: un arreglo `uuid[]` en la propiedad, no una tabla intermedia, porque nadie filtra por amenity todavía. Si el portal público (Fase 22) lo necesita, se agrega un índice GIN sobre el arreglo.

### D-32 · Las reglas que dependen de contratos van detrás de un puerto

- "No pasar a disponible con contrato activo" y "no borrar con historial de contratos" necesitan la Fase 9. Las reglas le preguntan a `PropertyContracts`, cuya implementación actual (`NoContractsYet`) responde que no hay contratos. La Fase 9 la reemplaza en el módulo sin tocar las reglas ni sus tests.

### D-33 · De mantenimiento a alquilada: no

- La spec lista "cualquiera → mantenimiento" y "mantenimiento → disponible", pero no "mantenimiento → alquilada". Se rechaza (422): a alquilada se llega con un contrato o desde disponible.

### D-34 · Una propiedad apunta a una localidad o un barrio

- PRD 5.1: "cada propiedad apunta al nivel más específico (generalmente Barrio o Localidad)". Un país o una provincia no sirven como ubicación: 422.

### D-35 · Fotos en tabla propia; subir primero, guardar después

- `property_photos` (id, key del storage, URL, posición) en lugar de un arreglo de URLs: permite borrar una por id (spec 3.7) y el archivo del storage.
- Se suben todos los archivos y recién después se guardan en una transacción. Si algo falla, se borran los ya subidos (spec, casos borde). Máximo 20: la foto 21 es un 400 (nuevo `DomainErrorKind.InvalidInput`).
- Formatos: JPG, PNG y WebP, hasta 10 MB. El tipo se valida por contenido, no sólo por la extensión.

### D-36 · Búsqueda por dirección con índice trigram

- Un ILIKE con comodín adelante no usa un índice común. Se crea `pg_trgm` y un índice GIN sobre `address` (declarado en el schema como índice extendido). Neon y Supabase permiten `pg_trgm`.

### D-37 · Listado paginado como el resto de la API

- La spec muestra `{ items, total, page, limit }`; se mantiene el formato del proyecto, `{ data, pagination }` dentro del sobre. El front hace scroll infinito sobre esas páginas.

## Fase 7 — Propietarios (sin supervisión)

### D-38 · No se borra un propietario con propiedades asignadas

- La spec (3.7) bloquea la baja sólo con contratos activos. Se bloquea con **cualquier** propiedad asignada (409 con la cantidad): si no, quedarían propiedades apuntando a un propietario borrado. Para darlo de baja, primero se reasignan o se borran sus propiedades. Si Micaela prefiere la regla literal, es cambiar una condición en `DeleteOwnerHandler`.

### D-39 · "Propiedad activa" para el honorario reducido = alquilada, hasta la Fase 9

- RN-07 cuenta propiedades con contrato activo. Todavía no hay contratos, así que `PropertiesFacade.portfolios()` cuenta las que están en estado `RENTED`. La Fase 9 cambia esa cuenta dentro de la facade; quien pregunta (propietarios, y después liquidaciones) no se entera.
- La regla en sí (`appliesReducedFee(activas, umbral)`) vive en `owners/domain/reduced-fee.ts` y se exporta por `owners/public`: es la **única** implementación, la Fase 12 la reutiliza al liquidar. El umbral sale de `tenants.reduced_fee_threshold` (default 3); con 0, la inmobiliaria no usa el beneficio.

### D-40 · Datos bancarios en columnas, no en JSON; CBU validado, único sólo como aviso

- La spec los modela como JSON. Van como columnas propias (`bank_cbu`, `bank_alias`, `bank_name`, `bank_holder`) para que la auditoría muestre el antes y el después campo por campo: un cambio de CBU es una acción de riesgo y tiene que poder revisarse.
- El CBU se valida con sus dos dígitos verificadores (no sólo "22 dígitos"): atrapa un dígito mal tipeado antes de que una transferencia rebote o llegue a otra cuenta. Un CBU repetido entre propietarios **no bloquea** (es legítimo: cónyuges, sociedades); `GET /owners/check` avisa quién más lo tiene para que el formulario lo muestre.
- `PATCH /owners/:id/bank-account` es un endpoint aparte, como pide la spec; editar los datos personales nunca toca la cuenta.

### D-41 · DNI/CUIT normalizado a dígitos y único por inmobiliaria con índice parcial

- Se guardan sólo los dígitos (7 u 8 para DNI, 11 para CUIT/CUIL): "20.123.456" y "20123456" son la misma persona. La unicidad es por inmobiliaria y sólo entre los no borrados (índice parcial `WHERE deleted_at IS NULL`), así un propietario borrado libera su DNI sin mutarlo.
- Además del índice hay un chequeo previo con error propio (`OWNER_NATIONAL_ID_TAKEN`); si dos altas simultáneas lo pasan, el índice frena la segunda con un 409 genérico.

### D-42 · El acceso al portal es un usuario de `auth`, creado por una facade

- Los usuarios de portal son filas de `users` con rol `OWNER` (D-16). `owners` no guarda contraseñas: guarda `portal_user_id` (sin FK: módulos distintos) y le pide a `PortalAccountsFacade` (módulo `auth`, nueva) crear el acceso o regenerar la contraseña. Regenerar invalida la anterior y cierra sus sesiones. La contraseña (16 caracteres base64url) se devuelve **una sola vez**; no queda en ninguna respuesta posterior.
- Sin email no se puede generar el acceso (422): el usuario del portal es el email. Al borrar al propietario se le desactiva el acceso.
- La Fase 8 (inquilinos) reutiliza la misma facade con rol `RENTER`.

### D-43 · Búsqueda por nombre sin acentos, con columna derivada

- `search_name` guarda "nombre apellido" en minúsculas y sin acentos, calculado al guardar; la búsqueda compara contra eso y contra el DNI, palabra por palabra en cualquier orden ("perez jose" y "jose perez" encuentran a "José Pérez"). Sin índice trigram por ahora: la cantidad de propietarios por inmobiliaria es chica (cientos, no millones).

## Fase 8 — Inquilinos y garantes (sin supervisión)

### D-44 · Garante inexistente → 422, no 400

- La spec (6) pide 400 para un `guarantorId` que no existe. Se responde **422** con código `RENTER_INVALID_GUARANTOR`: es la misma situación que una propiedad con `ownerId` inexistente (`PROPERTY_INVALID_OWNER`, Fase 7) y el proyecto ya fijó que una referencia a algo que no existe en la inmobiliaria es una regla de negocio (`DomainErrorKind.BusinessRule` → 422), no un body mal formado (400, que queda para la validación del DTO). Cubre también al garante de otra inmobiliaria y al borrado. Si Micaela prefiere el 400 literal, es cambiar el `kind` de una excepción.

### D-45 · No se borra un garante con inquilinos a cargo

- La spec (3.2) bloquea la baja sólo si está vinculado a un contrato activo. Se bloquea con **cualquier** inquilino no borrado que lo tenga de garante (409 `GUARANTOR_IN_USE`, con la cantidad): si no, quedarían inquilinos apuntando a un garante borrado. Mismo criterio que D-38 para propietarios. Para darlo de baja, primero se les cambia el garante a sus inquilinos.
- La baja del inquilino sí sigue la regla literal (409 `RENTER_HAS_ACTIVE_CONTRACT` con contrato activo) detrás del puerto `RenterContracts`, cuya única implementación hoy es `NoContractsYet`: la Fase 9 la reemplaza por una que pregunta al módulo de contratos, sin tocar la regla (mismo patrón que `PropertyContracts`, D-32).

### D-46 · Filtros y campos de las Fases 9 y 11, en el contrato desde ya

- `GET /renters` acepta y valida `paymentStatus` (`UP_TO_DATE | OVERDUE`) y `propertyId` (uuid), pero **no filtran** todavía: no hay cuotas (Fase 11) ni contratos (Fase 9) contra qué cruzar. Lo dice el Swagger de cada parámetro. Así el frontend deja los filtros armados (deshabilitados visualmente, como pide la spec 5.1) sin cambiar el contrato después.
- Por lo mismo, `paymentStatus` viene siempre `null` en las vistas (tipado como enum nullable), y la ficha trae `activeContract: null` y `payments: []`, documentados como placeholders. Cuando las Fases 9 y 11 los completen, el tipo se amplía sin romper a nadie.

### D-47 · Un solo módulo `renters` con las dos tablas y FK real al garante

- Los garantes no existen sin inquilinos (spec 2.2, PRD 5.4), así que `guarantors` vive dentro del módulo `renters` y no en uno propio. Como las dos tablas son del mismo módulo, `renters.guarantor_id` es una **FK real** (`ON DELETE RESTRICT`), a diferencia de `owner_id` en propiedades (D-31, módulos distintos). `portal_user_id` sigue sin FK: `users` es del módulo de auth.
- La ruta es `/renters` (y no `/tenants`): "tenant" en este sistema es la inmobiliaria. `RentersFacade` (`exists`, `describe`) queda lista para que la Fase 9 valide y muestre inquilinos en los contratos.

### D-48 · Normalización de personas compartida en `shared/people`

- Propietarios, inquilinos y garantes comparten nombre, DNI/CUIT, email y búsqueda sin acentos. En vez de copiar `OwnerPolicy`, lo común pasó a `src/shared/people/person-policy.ts` (`PersonPolicy`, `fullNameOf`, `personSearchWhere`): funciones puras sin Prisma ni NestJS. `PersonPolicy.parseNationalId` devuelve `null` en vez de lanzar, porque cada módulo tiene su excepción con su código (`OWNER_…`, `RENTER_…`, `GUARANTOR_…`). `OwnerPolicy` delega y conserva su API pública (los tests de la Fase 7 no cambiaron); lo propio de cada módulo (CBU, fecha de ingreso, detalle de garantía) sigue en su `domain/`.

### D-49 · Fecha de ingreso como `DATE`, y como `AAAA-MM-DD` en la API

- `move_in_date` es una fecha sin hora (`@db.Date`): "entró el 1 de marzo" no tiene zona horaria. En el dominio y en la API viaja como string `AAAA-MM-DD`; el repositorio la convierte a medianoche UTC al guardar y la recorta al leer, así ningún huso horario la corre un día. Se valida que exista en el calendario (`2026-02-30` → 400 `RENTER_INVALID_MOVE_IN_DATE`).

### D-50 · `PortalCredentialsDto` vive en `auth/public`

- Propietarios e inquilinos devuelven la misma respuesta al generar el acceso al portal. Dos clases con el mismo nombre en módulos distintos chocarían en el OpenAPI (un solo esquema `PortalCredentialsDto`, el último pisa al anterior). El DTO pasó al `public/` de auth, junto al tipo `PortalCredentials` que ya exportaba, y los dos módulos lo importan de ahí.
