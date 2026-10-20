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

### D-39 · "Propiedad activa" para el honorario reducido = alquilada, hasta la Fase 9 (cerrada en D-51)

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

## Fase 9 — Contratos (sin supervisión)

### D-51 · Propiedades e inquilinos saben de su contrato activo por una columna, no importando a contratos

- **Contexto**: contratos depende de propiedades, propietarios, inquilinos, inmobiliarias e índices por sus facades. Para que propiedades e inquilinos respondan "¿tiene contrato activo?" sin importar a contratos (sería un ciclo de módulos), hacía falta otro camino.
- **Decisión**: `properties.active_contract_id` y `renters.active_contract_id` (uuid, sin FK). Sólo las escribe el módulo de contratos, por `PropertiesFacade.attachContract/detachContract` (que además pasan la propiedad a `RENTED`/`AVAILABLE`) y `RentersFacade.attachContract/detachContract`, dentro de su propia transacción. Los puertos `PropertyContracts` y `RenterContracts` conservan su API; `NoContractsYet` desapareció y las implementaciones reales (`PropertyContractsImpl`, `RenterContractsImpl`) leen esas columnas. Propiedades suma `last_contract_id`, que nunca se limpia: es el "historial de contratos" que bloquea el borrado (spec Fase 6, 3.8) y que sigue bloqueándolo después de rescindir.
- Con eso se cierra D-39: `PropertiesFacade.portfolios()` cuenta como activas las propiedades con `active_contract_id`, no las que están en `RENTED`. Una alquilada a mano, sin contrato, ya no suma para el honorario reducido. La regla (`appliesReducedFee`) no cambió.
- Lo que sigue sin resolverse por este camino: el filtro `propertyId` de `GET /renters` (D-46) sigue sin filtrar, porque inquilinos no conoce la propiedad de cada contrato; `GET /contracts?renterId=` es la consulta equivalente. La ficha del inquilino trae `activeContract: { id }` y el listado `activeContractId`.

### D-52 · Transacciones entre módulos por contexto (`PrismaService.transaction`)

- **Contexto**: crear un contrato, su canon inicial y marcar propiedad e inquilino tiene que ser atómico, pero las escrituras en propiedades e inquilinos pasan por sus facades y sus repositorios, que usan `prisma.db` y no reciben un cliente de transacción.
- **Decisión**: `TransactionContext` (`AsyncLocalStorage`, como `RequestContext`) guarda el cliente de la transacción abierta; `prisma.db` pasó a ser un getter que devuelve ese cliente si hay uno, y `PrismaService.transaction(fn)` abre una interactiva y corre `fn` adentro. Nadie cambia de firma: cualquier repositorio llamado adentro participa. Una `transaction()` anidada se suma a la abierta. Las extensiones (tenant, soft delete, auditoría) aplican también al cliente de la transacción, así que el `tenantId` se completa igual y el alta queda auditada.
- Límites: `db.$transaction([...])` (la forma en lote que usan los listados) no se puede abrir adentro de una interactiva; ningún flujo de esta fase lo hace. La auditoría escribe con el cliente base, fuera de la transacción: un rollback puede dejar una fila de historial de un cambio que no ocurrió (queda visible en los logs).

### D-53 · El alquiler vigente es la última fila de `contract_rent_updates`

- **Contexto**: el PRD guarda `monto_inicial` y pide que los aumentos queden registrados con el índice usado (9.5).
- **Decisión**: `contracts.initial_rent` no cambia nunca. Cada aumento es una fila de `contract_rent_updates` (`effective_from`, `previous_rent`, `new_rent`, `source` `INITIAL | INDEX | MANUAL`, y con índice: tipo, períodos y valores usados, `applied_by_id`). La primera fila se crea con el contrato (`INITIAL`); el vigente es la de mayor `effective_from`. La ficha trae el historial entero (`rentUpdates`, del más reciente al más viejo). Se conserva toda la información: con índice se puede rehacer la cuenta años después.

### D-54 · Índices ICL/IPC en un módulo propio, globales y cargados a mano hasta la Fase 13

- **Contexto**: la spec (3.8) exige el índice del período para aplicar un aumento, y la tabla de índices es de la Fase 13.
- **Decisión**: módulo `src/modules/indices` con la tabla `index_values` (`index_type` `ICL | IPC`, `period` `AAAA-MM`, `value` `DECIMAL(14,6)`, `source`, único por tipo y mes). **Sin `tenant_id`** (`tenantScoped: false`): el índice es un dato público, igual para todas las inmobiliarias. `POST /indices` (sólo admin: un valor mal cargado cambia el alquiler de todos los contratos que lo usen) y `GET /indices?type=`. Un mes ya cargado no se pisa (409 `INDEX_PERIOD_TAKEN`): los contratos que lo aplicaron guardaron el valor que vieron. `IndicesFacade.getValue(tipo, período)` es lo que usa contratos; la Fase 13 le suma el job que los trae de la fuente oficial y deja `source` con el nombre de la fuente.

### D-55 · `PATCH /contracts/:id` edita sólo notas, caución y garante

- **Contexto**: la spec no dice qué es editable después de crear.
- **Decisión**: notas, el bloque de caución (con la misma regla del email, evaluada sobre la caución resultante) y el garante (validado). Fechas, montos, moneda, tipo y frecuencia de actualización, partes y estado **no** se editan: cambian por un aumento (`POST /contracts/:id/rent-updates`), una rescisión o una renovación, que dejan su propio registro. Un dato cargado mal en el alta se corrige rescindiendo y creando de nuevo, o en la base con registro.

### D-56 · Prorrateo del canon futuro para la multa de rescisión

- **Contexto**: RN-09 dice "10 % × (canon_actual × meses_o_dias_restantes)" sin definir cómo se cuentan.
- **Decisión** (`ContractPolicy.termination`, pura y con tests): desde la fecha de notificación se cuentan **meses enteros** (mismo día de cada mes, recortado al fin de mes) mientras no pasen el fin del contrato; lo que queda son **días sueltos** hasta el fin, sin contar el día de fin. Canon futuro = alquiler vigente × meses + alquiler × días / 30, con un solo redondeo en los días (30 días = exactamente un mes; redondear por día daría 99.999,90). Multa = 10 % de eso (`TERMINATION_PENALTY_PERCENT`, constante del PRD; si alguna inmobiliaria quisiera otra, pasa a `tenants` como los honorarios). No se proyectan aumentos futuros (spec 4). Ejemplo: contrato del 1/1/2026 al 31/12/2027, alquiler 100.000, notificado el 1/12/2026 → 12 meses + 30 días → canon futuro 1.300.000, multa 130.000. La notificación va desde el inicio hasta el día anterior al fin (400 fuera de eso); `terminated_at` = fecha de notificación. La multa queda guardada en el contrato; cobrarla es de la Fase 11.

### D-57 · El contrato que se está creando cuenta para el honorario reducido

- **Contexto**: RN-07 habla de "3 o más propiedades con contratos activos"; al crear el tercer contrato, ¿cuenta él mismo?
- **Decisión**: sí. Se toman las propiedades activas del propietario (`PropertiesFacade.portfolios`) **antes** de vincular el contrato y se suma 1; el tercer contrato activo del propietario ya nace con el honorario reducido (con el umbral por defecto). En una renovación la propiedad ya cuenta como activa y no se suma. Fijado al crear y nunca recalculado (spec 4); los contratos anteriores conservan el suyo.

### D-58 · El propietario sale de la propiedad; `ownerId` no se recibe

- **Contexto**: la spec (3.1) recibe `propietarioId` además de `propiedadId`.
- **Decisión**: `POST /contracts` recibe `propertyId`, `renterId` y `guarantorId?`; `owner_id` se copia del propietario de la propiedad. Una propiedad sin propietario no acepta contrato (422 `CONTRACT_PROPERTY_WITHOUT_OWNER`): recibir los dos ids obligaría a validar que coincidan y a decidir qué hacer si no. El garante, si no viene, es el actual del inquilino (`null` explícito lo deja sin garante). Las referencias inexistentes son 422 (D-44): `CONTRACT_INVALID_PROPERTY`, `CONTRACT_INVALID_RENTER`, `CONTRACT_INVALID_GUARANTOR`; los conflictos de RN-04 y RN-05 son 409 (`CONTRACT_PROPERTY_ALREADY_RENTED`, `CONTRACT_RENTER_ALREADY_ACTIVE`), respaldados por índices únicos parciales (`WHERE status = 'ACTIVE'`).

### D-59 · Los servicios del contrato son de la Fase 10

- **Contexto**: la spec (3.1) recibe `servicios` en el alta.
- **Decisión**: no se aceptan ni se guardan acá. La Fase 10 define `property_services` con `contract_id` nullable (spec Fase 10, 2.1): un servicio existe a nivel propiedad y se asocia al contrato cuando lo hay. Duplicarlo en `contracts` habría dejado dos fuentes de verdad.

### D-60 · El aumento se aplica estricto, de a uno, con los índices del mes anterior y el nuevo

- **Contexto**: la spec (3.8) pide aplicar "el aumento correspondiente" y 422 si falta el índice.
- **Decisión**: la fecha del próximo aumento es la del último (`effective_from`) más la frecuencia (1, 3 o 4 meses). Antes de esa fecha es 409 `CONTRACT_RENT_UPDATE_NOT_DUE` (sin `force`: adelantar un aumento es cambiar el contrato); si cae después del fin, no quedan aumentos (mismo código, otro mensaje). Con ICL/IPC, nuevo = vigente × índice(mes del nuevo aumento) / índice(mes del aumento anterior), la razón con toda la precisión y un solo redondeo a centavos; falta alguno → 422 `CONTRACT_INDEX_MISSING` nombrando índice y mes. Con `FIXED`/`OTHER`, `newRent` es obligatorio (400 `CONTRACT_NEW_RENT_REQUIRED`). Cada llamada aplica un solo aumento: si hay varios atrasados, se llama varias veces; `ContractsFacade.listDueForRentUpdate(hoy)` le da al cron de la Fase 13 los contratos con uno pendiente.

### D-61 · Los contratos no se borran ni se "finalizan" a mano; la renovación finaliza al original

- **Contexto**: el PRD no tiene baja de contratos, y "finalizado" es un estado sin endpoint en la spec.
- **Decisión**: sin `DELETE` (auditoría sí, borrado lógico no). A `FINISHED` se llega por renovación (`POST /contracts/:id/renew`, que exige el original activo y un inicio no anterior al suyo) o por `ContractsFacade.finishExpired(hoy)`, que cierra los activos con el fin pasado y libera propiedad e inquilino; la Fase 13 lo llama por inmobiliaria. Mientras tanto, un activo con el fin pasado se muestra con `expired: true` (PRD 9.1). `expiringSoon` (RN-12) es activo y con fin entre hoy y hoy + `tenants.contract_expiry_notice_days`, inclusive; uno vencido no está "por vencer".

### D-62 · Los PDFs se validan por contenido y reemplazan al anterior

- **Decisión**: `POST /contracts/:id/documents/contract` y `/policy`, multipart con el campo `file`. El handler mira los primeros bytes (`%PDF`) y el tamaño (hasta 10 MB) y responde 400 `CONTRACT_INVALID_DOCUMENT` con mensaje propio (sin `ParseFilePipe`, que daría un código genérico). Se sube el nuevo por `StoragePort` a `contracts/<id>/<kind>-<uuid>.pdf`, se guarda, y recién después se borra el anterior (un fallo al borrar se loguea y no rompe). Ninguno de los dos PDFs es obligatorio: la spec no lo exige y el escaneado suele llegar después.

### Supuestos a confirmar con Micaela

- **A-1 · El depósito es estático.** `contracts.deposit` se guarda al crear y no se actualiza con los aumentos (spec 4, consulta abierta). _Qué cambia si Micaela responde distinto (que sigue al alquiler)_: una tabla `contract_deposit_updates` con la misma forma que `contract_rent_updates`, una fila al crear y una por cada aumento (misma variación), y `deposit` en la ficha pasa a ser "el vigente". El alta no cambia.
- **A-2 · Un contrato en USD guarda moneda y montos tal como vienen.** No hay cotización ni conversión en esta fase (spec 7: la conversión ocurre en el cobro, Fase 11). _Qué cambia si Micaela responde distinto (pide una cotización de referencia en el contrato)_: una columna `reference_exchange_rate` y su fecha; nada de lo de acá se recalcula.

## Fase 10 — Servicios y gastos adelantados (sin supervisión)

### D-63 · Un solo módulo `services` con dos tablas, sin FKs hacia otros módulos

- **Contexto**: la spec define `ServicioPropiedad` y `GastoAdelantado` como entidades de la misma fase, las dos colgadas de propiedades y contratos.
- **Decisión**: módulo `src/modules/services` (migración `add_services`) con `property_services` y `advance_expenses`, las dos con tenant, auditoría y borrado lógico. `property_id`, `contract_id` y `service_type_id` son uuid sin FK: se validan por `PropertiesFacade.find`, `ContractsFacade.find` (nuevo: cualquier estado) y `MasterDataFacade.areSelectable(SERVICE_TYPES)`, como propiedades valida sus maestros. Servicios importa propiedades, contratos y maestros; ninguno de ellos importa a servicios. `paid_by` es el enum nuevo `ServicePayer { RENTER, OWNER }`; `increase_frequency` reutiliza el enum de Prisma `RentUpdateFrequency` (en el dominio de servicios se llama `IncreaseFrequency`, mismos valores) para no tener dos escalas de "cada cuánto".

### D-64 · El estado del servicio se calcula al leer, nunca se guarda

- **Contexto**: la spec (2.1, 4) define `estado: al_dia | vencido` como calculado.
- **Decisión**: `ServicePolicy.status` y `daysOverdue`, puras: `OVERDUE` si `hasDueDate && dueDate < hoy` (estricto: el día del vencimiento todavía está al día), si no `UP_TO_DATE`; `daysOverdue` = días desde el vencimiento (venció ayer = 1), 0 si está al día. Van en toda vista de servicio (`status`, `daysOverdue`). La Fase 13 alerta a partir del 5° día (RN-13) leyendo `ServicesFacade.listOverdue(hoy)`. `GET /services/overdue` filtra en la base (`has_due_date = true AND due_date < hoy`) y ordena por `due_date` ascendente: los más atrasados primero.

### D-65 · Reglas de vencimiento y aumentos, y códigos de error

- **Decisión**: `hasDueDate: true` sin `dueDate` → 400 `SERVICE_DUE_DATE_REQUIRED`; `hasIncrease: true` sin `increaseFrequency` → 400 `SERVICE_INCREASE_FREQUENCY_REQUIRED`; una fecha que no existe en el calendario → 400 `SERVICE_INVALID_DATE`. Al revés, con `hasDueDate: false` la fecha se descarta (y con `hasIncrease: false` la frecuencia): un servicio "sin vencimiento" no puede quedar vencido por una fecha vieja. `PATCH /services/:id` edita todo menos la propiedad y evalúa las reglas sobre el servicio resultante (mezcla de lo actual con lo que vino, como la caución en contratos); el tipo y el contrato sólo se validan si cambian (un servicio viejo conserva un tipo que después se desactivó). Referencias inválidas en un alta o edición son 422 (D-44): `SERVICE_INVALID_PROPERTY`, `SERVICE_INVALID_CONTRACT` (no existe o no es de esa propiedad), `SERVICE_INVALID_SERVICE_TYPE` (no existe, es de otra inmobiliaria o está desactivado). Un `GET` colgado de un padre inexistente es 404 con código propio: `SERVICE_PROPERTY_NOT_FOUND`, `SERVICE_CONTRACT_NOT_FOUND`, `EXPENSE_CONTRACT_NOT_FOUND`.

### D-66 · Un contrato hereda los servicios de su propiedad

- **Contexto**: la spec deja `contrato_id` nullable ("puede existir a nivel propiedad antes de tener contrato") y el wizard de la Fase 9 habla de servicios "heredados de la propiedad, editables".
- **Decisión**: `GET /contracts/:contractId/services` devuelve los servicios con `contract_id = :contractId` **más** los de su propiedad sin contrato (`contract_id IS NULL`), cada uno con `scope: CONTRACT | PROPERTY`. Los de otro contrato de la misma propiedad (uno anterior, renovado) no se mezclan. La ruta vive en el controller del módulo de servicios (sin prefijo, rutas absolutas), no en contratos: contratos no conoce a servicios. "Editable" en el wizard significa que el servicio heredado se puede editar o, si el contrato necesita uno distinto, crear uno propio con `contractId`. `GET /properties/:propertyId/services` lista todos los de la propiedad (propios y de sus contratos) y acepta `?contractId=` para quedarse con los de uno.

### D-67 · Gasto adelantado: comprobante obligatorio, datos copiados del contrato, inmutable una vez descontado

- **Decisión**: `POST /contracts/:contractId/advance-expenses` es multipart (`amount`, `description`, `expenseDate`, `currency?`, `file`). El comprobante se valida por contenido (primeros bytes: JPG, PNG, WebP o PDF; hasta 10 MB) antes de subirlo por `StoragePort` a `advance-expenses/<contratoId>/<uuid>.<ext>`; sin archivo → 400 `EXPENSE_RECEIPT_REQUIRED`, otro formato o tamaño → 400 `EXPENSE_INVALID_RECEIPT`. Si guardar la fila falla, el archivo se borra. `renter_id` se copia del contrato y `currency`, si no viene, también (el `currency?` existe para el caso raro de un gasto en otra moneda; los totales del listado suman sin mirar la moneda, así que un contrato con gastos en dos monedas es un caso que la Fase 12 tiene que mirar). El contrato puede estar en cualquier estado (spec 7: uno rescindido puede tener gastos pendientes); un contrato inexistente o de otra inmobiliaria → 422 `EXPENSE_INVALID_CONTRACT`. Monto ≤ 0 → 400 `EXPENSE_INVALID_AMOUNT`; fecha inexistente → 400 `EXPENSE_INVALID_DATE`. `registered_by_id` sale del `RequestContext`; el nombre se resuelve por la nueva `UsersFacade.describe` de auth (nombre y apellido, o el email si no los tiene). Con `settlement_id` cargado la fila es inmutable: `PATCH` (sólo `amount`, `description`, `expenseDate`) y `DELETE` responden 409 `EXPENSE_ALREADY_SETTLED`. `DELETE` es sólo admin, borrado lógico, y borra el comprobante del storage (si falla, queda huérfano y se loguea). `GET .../advance-expenses?settled=` devuelve `{ items, pendingTotal, settledTotal }`; los totales son del contrato entero, sin importar el filtro. `ServicesFacade.markExpensesSettled(ids, settlementId, settledAt)` (Fase 12) sólo marca los pendientes y devuelve cuántos; `pendingExpensesByContract` da la suma y las filas para la liquidación.

### D-68 · Propiedad borrada con servicios: se filtran al leer, sin evento

- **Contexto**: propiedades no importa a servicios, así que al borrar una propiedad (sólo posible sin historial de contratos) sus servicios de nivel propiedad quedarían vivos. Se evaluó publicar `PropertyDeletedEvent` por el `EventBus`/pg-boss y escucharlo en servicios.
- **Decisión**: la opción simple. No hay evento: `ServiceViews.overdue` resuelve las propiedades por `PropertiesFacade.describe` (que excluye las borradas) y omite los servicios sin propiedad, así no aparecen en `GET /services/overdue`; `GET /properties/:id/services` ya responde 404 para una propiedad borrada. El `total` de la paginación de vencidos puede contar esos servicios huérfanos (caso raro: una propiedad sin contratos con servicios vencidos, borrada). `ServicesFacade.listOverdue` no filtra: la Fase 13 resuelve propiedad e inquilino de cada vencido de todos modos y saltea los que no existen. Si alguna vez hace falta limpiarlos de verdad, el camino es el evento (el patrón está en `_example`); las filas de servicios tienen borrado lógico, así que la limpieza es un `delete` por propiedad.

### D-69 · Facades nuevas para esta fase

- `ContractsFacade.find(id)`: el contrato en cualquier estado (`id`, `propertyId`, `ownerId`, `renterId`, `status`, `currency`). `exists` y `getActiveByProperty` no alcanzaban: un gasto o un servicio pueden referir a un contrato finalizado o rescindido.
- `UsersFacade.describe(ids)` en `auth/public` (con `UserRepository.findByIds`): nombre de cada usuario para mostrar quién registró un gasto. Sólo lectura de nombres; roles, estado y credenciales siguen siendo internos de auth.
- `ServicesFacade` (`listOverdue`, `countByProperty`, `pendingExpensesByContract`, `markExpensesSettled`) para las Fases 11, 12 y 13.
