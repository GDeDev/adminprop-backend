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

## Fase 11 — Cobros y punitorios (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_11.md`. Reemplaza el modelo de la spec original (un pago entero por cuota, sin parciales ni cotización) a partir de `RESPUESTAS_MICAELA_PLATA.md`.

### D-70 · Los términos de cobro del contrato son vigencias, no columnas que se pisan

- **Contexto**: Micaela pide modalidad de cobro y de honorarios cambiables durante el contrato "conservando el historial", % o importe fijo de honorarios, y punitorio por contrato con fallback a la inmobiliaria.
- **Decisión**: tabla `contract_billing_terms` (tenant, auditada, sin borrado lógico) con `effective_from`, `collection_mode`, `fee_mode`, `fee_percentage`, `fee_amount`, `late_fee_percentage`, `late_fee_grace_days`, `notes`, `changed_by_id`. La primera fila nace con el contrato (desde `start_date`, `AGENCY`, `DEDUCTED`, el % de D-57, punitorio heredado); la migración hace el backfill. `POST /contracts/:id/billing-terms` (sólo admin) agrega una fila: lo que no viene se copia de la vigente, `feeAmount: null` vuelve al %, el punitorio en null vuelve al del tenant; `effectiveFrom` default hoy, ≥ la última vigencia (409 `CONTRACT_BILLING_TERMS_NOT_AFTER_LATEST`; la misma fecha vale y la fila más nueva manda) y dentro del contrato (400 `CONTRACT_BILLING_TERMS_OUT_OF_RANGE`). `contracts.fee_percentage` se mantiene como el fijado al crear (D-57); el vigente sale de los términos y es el `feePercentage` de las vistas. El punitorio se resuelve contra `TenantsFacade.getBillingSettings` en `BillingTermsResolver` (capa de aplicación, porque un `public/` no puede importar otra facade), con las marcas `inheritedLateFeePercentage` / `inheritedLateFeeGraceDays`. La renovación copia los términos vigentes hoy salvo lo que se indique y fija el % de nuevo.
- También: `deposit_currency` (backfill = `currency`), `deposit_return_mode` (editable por `PATCH`, extiende D-55) y `fixed_increase_percentage`. `FIXED` con % fijo calcula el aumento solo (`nuevo = vigente × (1 + %/100)`, un redondeo) y lo registra en `contract_rent_updates.fixed_percentage`; `ICL`/`IPC` aceptan `newRent` como ajuste manual autorizado (`MANUAL`, `indexType: null`) con la misma regla de fecha de D-60. `RentUpdateFrequency` suma `SEMIANNUAL` (6) y `ANNUAL` (12), también en `IncreaseFrequency` de servicios.

### D-71 · La cuota copia los términos (snapshot) y su estado "vencida" se calcula al leer

- **Decisión**: `installments` guarda `late_fee_percentage`, `late_fee_grace_days`, `collection_mode`, `fee_mode`, `fee_percentage`, `fee_amount` tal como estaban resueltos al generarla (vigentes al `max(primer día del mes, startDate)`). Cambiar los términos del contrato afecta sólo las cuotas que se generen después: lo que se le cobró a alguien no cambia retroactivamente. El `status` guardado es `PENDING | PARTIAL | PAID` y se recalcula en cada movimiento (`InstallmentRecalculator`); `OVERDUE` (saldo > 0 y hoy > `grace_end_date`) se calcula al leer, como en servicios (D-64). En el listado, `status=OVERDUE` se traduce a "no PAID y gracia vencida"; `PENDING`/`PARTIAL` excluyen las vencidas para que los cuatro filtros no se superpongan.

### D-72 · La base de la cuota es el alquiler vigente al generarla, mes entero

- **Decisión**: `base_amount` = alquiler vigente (`currentRent`) al momento de generar; un aumento posterior no toca cuotas ya generadas (se generan a fin de mes para el mes siguiente, así que el aumento del mes tiene que estar aplicado antes). Mes entero aunque el contrato empiece o termine a mitad de mes (A-7), encapsulado en `InstallmentPolicy.baseFor`. Un contrato que empieza el mes siguiente no entra en el mes actual.

### D-73 · El punitorio es interés simple diario sobre el alquiler impago de cada día, con detalle congelado al saldar

- **Contexto**: Micaela confirmó interés simple sobre lo vencido (#3), con detalle día por día (#4), y pidió pagos parciales (#6).
- **Decisión** (`InstallmentPolicy.lateFeeDays`, pura, con tests): para cada día `d` desde `grace_end_date + 1` hasta `min(asOf, paid_at)`, `amount_d = outstanding(d) × % / 100`, con `outstanding(d) = base − Σ rent_applied de pagos vigentes con paid_at < d` (el día del pago cuenta con el saldo previo: gracia 10, pago el 15 → días 11 a 15). Cada día se redondea a centavos y el total es la suma: detalle y total coinciden siempre. Los cargos no devengan (A-10); los pagos informados cuentan a su fecha (A-11); los anulados no cuentan. `paid_at` = fecha del pago vigente que completó la base (`paidAtOf`): ahí deja de correr aunque quede punitorio o cargo por pagar. Al fijarse `paid_at` se escriben los días en `installment_late_fee_days` (A-4, sin auditoría: la fila es la traza) y la ficha los muestra desde ahí; si una anulación lo deja en null, se borran y vuelve a calcularse en vivo. `late_fee_waived` deja el punitorio en 0 sin días.

### D-74 · Imputación por defecto punitorio → alquiler → cargos; manual acotada; el exceso es saldo a favor

- **Decisión** (`PaymentPolicy.allocate`, A-8): el equivalente en moneda del contrato se imputa primero al punitorio pendiente, después al alquiler, después a los cargos; lo que sobra es `credit_generated` y nace un `renter_credits` (A-6). Con `allocation { lateFee, rent, charges }` (string JSON en el multipart) cada concepto va hasta su saldo (400 `PAYMENT_INVALID_ALLOCATION` si lo supera o la suma supera el monto) y sólo puede quedar un resto como crédito si los tres saldos quedaron cubiertos. Un pago de 0 no existe (400 `PAYMENT_INVALID_AMOUNT`); la aplicación de crédito es otro `kind`. Un pago sobre una cuota sin saldo → 409 `INSTALLMENT_ALREADY_PAID`. El comprobante es opcional (un cobro en efectivo puede no tener), validado por contenido con `shared/files/file-signature` (JPG, PNG, WebP, PDF, 10 MB), subido a `payments/<contratoId>/<uuid>.<ext>` antes de la transacción y borrado si ella falla.

### D-75 · Cotización obligatoria y manual cuando la moneda del pago no es la del contrato

- **Decisión** (`PaymentPolicy.convert`, A-9, Micaela #2): `exchangeRate`, `exchangeRateSource` (`OFFICIAL | MEP | OTHER`) y `exchangeRateDate` son obligatorios los tres cuando `paidCurrency ≠ currency` (400 `PAYMENT_EXCHANGE_RATE_REQUIRED`) y prohibidos cuando coinciden (400 `PAYMENT_EXCHANGE_RATE_NOT_ALLOWED`). Convención: pesos por 1 dólar, 4 decimales. Pago en ARS a cuota USD: `amount / rate`; en USD a cuota ARS: `amount × rate`; un solo redondeo a centavos. El pago guarda lo entregado (`amount`, `paid_currency`) y el equivalente (`amount_in_contract_currency`), que es sobre el que se imputa.

### D-76 · Pagos informados por el propietario: nacen pendientes de confirmación y cuentan igual

- **Decisión** (A-11, Micaela #9): `received_by` default según `collection_mode` de la cuota (se puede indicar). Recibido por la inmobiliaria nace `CONFIRMED`; por el propietario, `PENDING_CONFIRMATION`. Para saldos, punitorio y estado de la cuota un pago informado vale igual que uno confirmado; `confirm` (admin y empleado) es control interno y no cambia saldos. Los honorarios sobre lo cobrado (`feeOnCollected`) y `BillingFacade.collectionsByInstallment` sólo cuentan pagos `CONFIRMED`, separando lo que recibió la inmobiliaria de lo que recibió el propietario (`rentCollectedByAgency` / `rentCollectedByOwner` / `rentCollectedByCredit`). `GET /billing/payments?status=PENDING_CONFIRMATION` es la pantalla de pendientes.

### D-77 · La fecha del pago puede ser anterior al mes de la cuota (pago anticipado)

- **Contexto**: el rediseño decía "no anterior al primer día del período" (regla 10) y a la vez contempla el pago anticipado generando antes la cuota (A-14): cobrar en octubre la cuota de noviembre tiene fecha de pago anterior al mes.
- **Decisión**: `paid_at` sólo no puede ser futura (400 `PAYMENT_INVALID_DATE`). Pagar antes de la gracia simplemente no devenga punitorio. Si Micaela no quiere pagos anticipados, se vuelve a agregar la cota inferior en `PaymentPolicy.normalizePaidAt`.

### D-78 · Anular un pago deja registro y revierte sus créditos; nada se borra

- **Decisión** (sólo admin, 409 `PAYMENT_ALREADY_VOIDED` si ya estaba): el pago pasa a `VOIDED` con motivo, usuario y fecha, y deja de contar en todo. Si había generado un saldo a favor, tiene que estar `AVAILABLE` y entero (409 `PAYMENT_CREDIT_ALREADY_USED` si se aplicó o devolvió en parte) y pasa a `VOIDED` con `remaining = 0` (`CreditStatus` suma `VOIDED`). Anular una `CREDIT_APPLICATION` devuelve el monto al `remaining` del crédito y lo deja `AVAILABLE`. Después la cuota se recalcula (puede volver de `PAID` a `PARTIAL`/`PENDING`, `paid_at` a null y el detalle diario a vivo). Los cargos siguen la misma idea: `voided_at` + motivo, sólo si lo imputado a cargos no supera los cargos que quedan (409 `CHARGE_HAS_ALLOCATIONS`); una cuota `PAID` no acepta cargos nuevos (409 `INSTALLMENT_ALREADY_PAID`).

### D-79 · Saldos a favor con `remaining`, aplicación automática o manual, devolución registrada

- **Decisión** (A-6, Micaela #6): `renter_credits` guarda `amount` (original) y `remaining`; `APPLIED` cuando llega a 0. Al registrar un pago con `applyCredit` (default true) se aplican antes los créditos disponibles del inquilino **en la moneda del contrato**, del más viejo al más nuevo, cada uno hasta su `remaining` y hasta cubrir `totalDue`; cada aplicación es un `Payment` `CREDIT_APPLICATION` (`method: CREDIT`, `CONFIRMED`, misma `paid_at`, imputado con el orden por defecto) que queda en la ficha y en la cuenta corriente. `POST /billing/installments/:id/apply-credit { creditId?, amount? }` hace lo mismo sin plata, a hoy; sin nada que aplicar → 409 `CREDIT_NOT_AVAILABLE` (o `CREDIT_CURRENCY_MISMATCH` si el crédito elegido está en otra moneda). `POST /billing/credits/:id/refund` (admin) marca `REFUNDED` con fecha, medio y notas; sólo un crédito `AVAILABLE`, y se devuelve el `remaining` entero.

### D-80 · Honorarios devengados por cuota, sin cobrarlos todavía

- **Decisión** (A-12, Micaela #5 y #10): cada cuota expone `feeOnBase` (`fee_amount ?? base × fee_percentage / 100`) y `feeOnCollected` (`fee_amount` si se cobró algo de alquiler confirmado, si no `Σ rent_applied confirmados × %`); el resumen y la cuenta corriente los suman. Cobrarlos (descontar al liquidar, cuenta corriente de honorarios del propietario, pago aparte del inquilino) es de la Fase 12, que lee `fee_mode` y `collectionsByInstallment`.

### D-81 · Cuenta corriente, evento y facade

- **Cuenta corriente** (`GET /contracts/:contractId/account`, `buildContractAccount` pura): totales, cuotas y movimientos cronológicos con saldo acumulado (deuda positiva): `DEPOSIT_RECEIVED` (informativo, sin monto), `INSTALLMENT` (débito base), `CHARGE`, `LATE_FEE_ACCRUED` (débito del punitorio devengado; **no estaba en el diseño**, hace falta para que el saldo cierre con `totals.balance`), `LATE_FEE_ADJUSTMENT` (crédito en `REDUCE`, informativo en `WAIVE`), `PAYMENT` / `CREDIT_APPLIED` (crédito por el equivalente en moneda del contrato), `CREDIT_GENERATED` (débito del exceso que salió a saldo a favor), `PAYMENT_VOIDED` (débito de lo que había imputado) y `CREDIT_REFUNDED` (informativo). La ruta vive en el controller de cobros: contratos no conoce a cobros. El depósito trae `suggestedReturn` (`FIXED` → depósito, `FOLLOWS_RENT` → alquiler vigente, `MANUAL` → null; A-13). El contrato puede estar en cualquier estado; inexistente → 422 `INSTALLMENT_INVALID_CONTRACT`.
- **Evento**: al pasar a `PAID`, `InstallmentPaidEvent` por el `EventBus` → `RelayInstallmentPaidHandler` → cola pg-boss `installment-paid` (`billing/public/billing-events.ts`), igual que `_example`. Se emite después de confirmar la transacción.
- **`BillingFacade`**: `generateInstallments(period?)` (Fase 13), `listOverdue(hoy)` (recordatorios), `collectionsByInstallment(ids)` (Fase 12), `arrearsByRenter(ids)` (Fase 18 y listados). `GET /billing/arrears` devuelve una fila por inquilino pedido aunque no tenga cuotas (`UP_TO_DATE`) y acepta `renterId` repetido o `renterIds` separados por coma; reemplaza el `paymentStatus: null` de D-46.
- **Qué se rescató del borrador sin commitear**: `shared/files/file-signature.ts` (y el refactor de `AdvanceExpensePolicy` que lo usa), los helpers de período de `shared/dates`, las normalizaciones de período/fecha/notas/comprobante de `InstallmentPolicy`, el generador (adaptado a los términos resueltos) y el commit `7a80375` (facades). El resto (modelo de un pago por cuota, `BillingSettings`, créditos enteros) se reescribió; la migración vieja `20261020190000_add_billing` se borró sin haberse aplicado en ninguna base.
- **Entorno**: las migraciones se crearon y verificaron contra `adminprop_test` (la que resetean los e2e), no contra `adminprop_development`, que sólo tiene aplicada `init` y datos viejos: `prisma migrate dev` sobre ella habría intentado aplicar 13 migraciones pendientes sobre filas sin tenant.

### Supuestos a confirmar con Micaela (Fase 11)

- **A-7 · Mes entero aunque el contrato empiece o termine a mitad de mes** (spec 7). _Si pide prorrateo_: `baseAmount = alquiler × días cubiertos / días del mes` en `InstallmentPolicy.baseFor`, una sola función; el generador le pasa las fechas del contrato.
- **A-8 · Orden de imputación por defecto: punitorio → alquiler → cargos** (Código Civil: los pagos se imputan primero a intereses). _Si pide otro_: cambiar el orden en `PaymentPolicy.allocate`; los pagos ya registrados conservan su imputación guardada.
- **A-9 · Cotización obligatoria y sin valor por defecto cuando la moneda del pago no es la del contrato.** _Si pide una fuente automática_: un `ExchangeRateProvider` (BCRA) que precargue el valor en el frontend o en el handler; el modelo no cambia.
- **A-10 · Los cargos (expensas, multa, otros) no devengan punitorio; sólo el alquiler.** _Si pide que sí_: `outstandingRentOn` suma el saldo de cargos impago de cada día.
- **A-11 · Un pago informado por el propietario (`PENDING_CONFIRMATION`) cuenta como pagado a su fecha para saldos y punitorio; la confirmación es control interno.** _Si pide lo contrario_: filtrar `status = CONFIRMED` en `activePayments` (`InstallmentPolicy.balances`) y mostrar el saldo "informado" aparte.
- **A-12 · El honorario devengado se calcula sobre el alquiler (`feeOnBase`) y sobre el alquiler cobrado (`feeOnCollected`)**; la base configurable por propietario con conceptos (Micaela #5) se resuelve en la Fase 12. _Si pide otra base ya_: `InstallmentPolicy.feeAccrual` recibe los conceptos incluidos.
- **A-13 · La devolución del depósito con deducciones se registra en la Fase 12** (cierre de cuentas del contrato); acá sólo el modo y el monto sugerido (`suggestedReturn`). _Si la quiere ya_: una tabla `deposit_returns` con deducciones justificadas, colgada de la cuenta corriente.
- **A-14 · Un pago anticipado requiere que la cuota exista**: se generan las cuotas del mes futuro con `POST /billing/installments/generate { period }` (para toda la inmobiliaria) y después se registra el pago (D-77 permite la fecha anterior al mes). _Si molesta_: `POST /contracts/:id/installments { period }` para una sola, reusando `InstallmentGenerator` con un filtro de contrato.

## Fase 12 — Liquidaciones (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_12.md` (a partir de `RESPUESTAS_MICAELA_PLATA.md`, puntos 5, 7, 9 y 10). Reemplaza la spec original (una liquidación por propiedad al confirmarse un cobro, con el % recalculado por umbral) donde difieran.

### D-82 · Los honorarios del propietario son un override del % y una lista de conceptos, y mandan al crear contratos

- **Contexto**: Micaela (#5) pide configurar por propietario el % y los conceptos que entran en la base. Hasta acá el % lo fijaba la regla por umbral del tenant (D-57) al crear el contrato.
- **Decisión**: `owners.fee_percentage` (null = la regla), `fee_includes_late_fees`, `fee_includes_charges` y `statement_send_mode`, editables sólo por admin en `PATCH /owners/:id/fee-settings`. `OwnersFacade.feePercentageFor(ownerId, extraActive)` devuelve el override si existe y si no la regla por umbral; vive en `OwnerFeeResolver` (capa de aplicación) porque un `public/` no puede importar otra facade (como `BillingTermsResolver`, D-70). `ContractParties.feePercentage` delega ahí: D-57 sigue para el default, el override del propietario gana. Los conceptos se aplican al liquidar (`FeePolicy.feeForInstallment`), no al generar la cuota: la cuota congela `fee_percentage` y `fee_amount` (D-71), la base se decide con lo cobrado.

### D-83 · La devolución del depósito vive en cobros y cobra la deuda con un pago `DEPOSIT`

- **Contexto**: A-13 dejó la devolución para esta fase; Micaela (#1) pide deducciones por deudas o daños justificadas.
- **Decisión**: `deposit_returns` (una por contrato) y `deposit_return_deductions` en el módulo de cobros, con `POST /contracts/:contractId/deposit-return` (JSON, sin comprobante). Invariante `returned + Σ deducciones = depósito` (400 `DEPOSIT_RETURN_UNBALANCED`). Sólo contratos finalizados, rescindidos o activos con el fin pasado (409 `DEPOSIT_RETURN_CONTRACT_ACTIVE`). Una deducción `DEBT` con cuota crea un `Payment` `CASH_IN` con `method: DEPOSIT`, recibido por la inmobiliaria y confirmado, imputado con el orden por defecto (A-8): así la cuenta corriente y la liquidación lo ven como cualquier cobro (el depósito lo tiene la inmobiliaria y esa plata va al propietario). Requiere misma moneda que el depósito y no superar lo que la cuota debe a esa fecha (400 `DEPOSIT_RETURN_INVALID_DEDUCTION`, código que no estaba en el diseño). Las deducciones no se auditan: se escriben una vez con la devolución.

### D-84 · El pago sabe en qué liquidación entró, y cobros avisa cada confirmación y anulación

- **Decisión**: `payments.settlement_id` sin FK, escrito sólo por liquidaciones vía `BillingFacade.markPaymentsSettled` (que toca sólo los libres) y `unmarkPaymentsSettled`. `listSettleablePayments(contractId)` devuelve los `CONFIRMED`, recibidos por la inmobiliaria (plata o saldo a favor aplicado) y sin liquidación, con `chargesApplied` abierto por concepto: el pago no guarda a qué cargo fue cada peso, así que `InstallmentPolicy.chargesAppliedByConcept` lo reconstruye imputando los pagos vigentes en orden de fecha a los cargos vigentes en orden de alta (determinista; lo que no alcanza a ningún cargo cae en `OTHER`). Dos colas nuevas: `payment-confirmed` (al crearse si `AGENCY` o aplicación de crédito, al confirmarse si `OWNER`; payload con imputación y moneda, más que el diseño) y `payment-voided` (con `settlementId`). Se emiten después de la transacción, como `installment-paid`.

### D-85 · Diez tablas de liquidaciones, sin borrado lógico, con una sola pendiente por contrato

- **Decisión**: `settlements`, `settlement_payments`, `settlement_expenses`, `settlement_adjustments`, `settlement_transfers`, `owner_statements`, `owner_statement_totals`, `fee_receivables`, `fee_payments`, `fee_payment_allocations`; todas con tenant, sin FKs hacia otros módulos. Se auditan las que son plata o decisión (liquidación, ajustes, transferencias, consolidado, receivables, pagos de honorarios); las líneas (pagos y gastos incluidos), los totales congelados y las imputaciones son snapshots que se reescriben o se escriben una vez: la fila es la traza. Una sola `PENDING` por contrato se garantiza con un índice único parcial (`WHERE status = 'PENDING'`) en la migración, que Prisma no puede declarar. `settlement_payments.payment_id` y `settlement_expenses.expense_id` son únicos: un pago o un gasto se liquida una vez; al cancelar una pendiente se borran sus líneas para liberarlos (los totales quedan como registro de lo que se iba a liquidar).

### D-86 · La liquidación aparece sola al saldarse una cuota, pero sólo si la inmobiliaria cobró algo

- **Decisión**: el consumer de `installment-paid` llama a `SettlementDrafts.ensureDraft(contractId)`: recalcula la pendiente si hay, o crea una si hay pagos liquidables. Con modalidad `OWNER_DIRECT` (sin pagos `AGENCY`) no crea nada aunque haya gastos adelantados pendientes: esos esperan al `POST /settlements` manual, que sí acepta "sólo gastos" (y rechaza "nada": 409 `SETTLEMENT_NOTHING_TO_SETTLE`). `period` default el mes de hoy y `sequence` la siguiente del (contrato, mes) (A-21). Un pago parcial no dispara nada (la cola avisa sólo al saldar): se liquida a mano o con el pago que salda.

### D-87 · Honorarios cuota por cuota con los términos congelados; la modalidad que manda es la de la cuota más reciente

- **Contexto**: una liquidación puede incluir pagos de cuotas con términos distintos (cambio de modalidad o de %, D-70).
- **Decisión** (`SettlementPolicy.compute`): el honorario se calcula por cuota con `FeePolicy.feeForInstallment` (base = alquiler cobrado + punitorios y cargos del propietario si el propietario los incluye, nunca `SERVICE`; fijo prorrateado A-15; % sobre la base) y se suma. La liquidación guarda `fee_mode`, `fee_percentage` y `fee_amount_fixed` de la cuota más reciente, `fee_deducted = (fee_mode === DEDUCTED)` y `mixed_fee_terms` si las cuotas difieren. Si una mezcla `DEDUCTED` con `OWNER_PAYS`, todo el `fee_total` sigue a la más reciente y se avisa: dividirlo por modalidad es la mejora si pasa en la práctica.

### D-88 · Neto sin cargos SERVICE, ajustes con signo por concepto, y las transferencias nunca superan el neto

- **Decisión**: `net = rent + lateFee + ownerCharges − (feeDeducted ? fee : 0) − expenses + adjustments` (A-16); los ajustes se guardan en positivo y el concepto da el signo (`OTHER_CREDIT` suma, los otros tres restan). Un neto ≤ 0 se confirma (queda que el propietario debe) y no admite transferencias (400 `SETTLEMENT_TRANSFER_EXCEEDS_NET`). `transferred_total` y el estado (`TRANSFERRED` al cubrir el neto, `CONFIRMED` si una anulación lo destapa) se recalculan desde las transferencias vigentes en cada movimiento, nunca se acumulan a mano. Los comprobantes de transferencias y de pagos de honorarios se validan por contenido como los de cobros (`shared/files/file-signature`, 10 MB) y se suben antes de la transacción.

### D-89 · Confirmar es la única frontera: marca en otros módulos, devenga y emite

- **Decisión**: `ConfirmSettlementHandler` corre en una transacción (D-52): estado `CONFIRMED`, `BillingFacade.markPaymentsSettled`, `ServicesFacade.markExpensesSettled`, y si `fee_deducted` es falso y hay honorario, `FeeAccountService.accrue` con `source: SETTLEMENT_NOT_DEDUCTED` y `payer` según la modalidad (un receivable por liquidación, `installment_id` null, `period` el de la liquidación). `settlement-confirmed` se emite después. Recalcular, ajustar y cancelar sobre una no pendiente dan 409 `SETTLEMENT_NOT_PENDING`; transferir sobre una pendiente, 409 `SETTLEMENT_NOT_CONFIRMED`.

### D-90 · Un pago anulado después de confirmar se descuenta en la siguiente pendiente, por el listener

- **Decisión** (A-19, `VoidedPaymentReaction`): con `payment-voided` y `settlementId`, si la liquidación está `PENDING` se recalcula; si está confirmada o transferida se marca `has_voided_payments` y se agrega un `SettlementAdjustment` `OTHER_DEDUCTION` automático (sin usuario, `origin_payment_id` = el pago, idempotente) en la pendiente del contrato, creada con lo que haya si no existe. El monto es lo que ese pago le había dado al propietario según la línea guardada (alquiler + punitorio + cargos del propietario). Además, el honorario devengado por ese pago (modalidad B) pasa a `VOIDED` si no tiene cobros, o queda `needs_review` si los tiene.

### D-91 · La cuenta de honorarios devenga por pago confirmado del propietario e imputa a los más viejos

- **Decisión** (`OwnerDirectFeeReaction`, `FeeAccountService`): con `payment-confirmed` y `receivedBy: OWNER` y alquiler > 0, nace un `fee_receivable` `OWNER_DIRECT_PAYMENT` con los términos congelados de la cuota (`BillingFacade.feeTermsForInstallments`) y la base del propietario; idempotente por `origin_payment_id` (índice único + `createIfAbsent`). Como el payload no abre los cargos por concepto, los cargos cobrados por el propietario se toman todos como suyos para la base. Al nacer un receivable se aplican enseguida los pagos del propietario con saldo sin imputar en esa moneda, del más viejo al más nuevo. `POST /fee-payments` imputa a los receivables `PENDING`/`PARTIAL` del propietario (y del contrato si viene) en esa moneda, más viejos primero; el exceso queda en `unallocated_amount` (`POST /fee-payments/:id/allocate` lo aplica a mano). Anular un pago (admin) resta sus imputaciones de cada receivable y deja `unallocated_amount` en 0; las imputaciones quedan como registro. `paid_amount` y `status` se guardan en el receivable y se recalculan en cada movimiento.

### D-92 · El consolidado es manual, uno por propietario y mes, con totales en vivo hasta cerrar

- **Decisión** (A-21, Micaela #7): `POST /statements { ownerId, period }` nace `OPEN` y vacío con el `send_mode` del propietario; único por (tenant, propietario, mes) → 409 `STATEMENT_PERIOD_TAKEN` (se reabre, no se duplica). Entran sólo liquidaciones `CONFIRMED`/`TRANSFERRED` del mismo propietario sin consolidado (409 `SETTLEMENT_NOT_CONFIRMED` / `SETTLEMENT_ALREADY_IN_STATEMENT`, 422 `SETTLEMENT_OWNER_MISMATCH`); agregar una que ya está es idempotente. Mientras está abierto, `StatementViews` calcula los totales por moneda con sus liquidaciones al momento; cerrar los congela en `owner_statement_totals`, fija `send_mode` (el del body o el del consolidado) y emite `statement-closed`; reabrir (admin) borra los congelados y vuelve a calcular en vivo. Se puede cerrar vacío.
- **Entorno**: las migraciones se generaron con `prisma migrate diff --from-url <test> --to-schema-datamodel --script` y se aplicaron con `migrate deploy` contra `adminprop_test`. Un `migrate dev --create-only` contra esa base la reseteó (detectó drift): se recreó el schema `public` y se volvió a desplegar desde cero; `adminprop_development` no se tocó.

### Supuestos a confirmar con Micaela (Fase 12)

- **A-15 · El honorario fijo por contrato se prorratea por el alquiler cobrado en cada liquidación** (`fijo × cobrado / base`, un redondeo), así un pago parcial no cobra el fijo entero y la suma de las liquidaciones de una cuota cobra exactamente el fijo. _Si lo quiere entero en la primera liquidación de cada cuota_: `FeePolicy.fixedFeeFor` devuelve el fijo cuando `rentApplied > 0`; nada más.
- **A-16 · Los cargos SERVICE cobrados al inquilino no forman parte del neto del propietario** (la inmobiliaria paga el servicio con esa plata); `TERMINATION_PENALTY` y `OTHER` sí. Se informan en `serviceChargesTotal`. _Si los quiere en el neto_: sumar `serviceChargesTotal` en `SettlementPolicy.net`.
- **A-17 · Se puede confirmar una liquidación aunque el propietario no tenga cuenta bancaria cargada**; la ficha avisa (`ownerBankAccountMissing`). _Si debe bloquear_: 409 en `ConfirmSettlementHandler` con `OwnersFacade.hasBankAccount`.
- **A-18 · Una transferencia registrada no se edita; se anula (admin) y se registra otra.** _Si prefiere editar_: `PATCH` sobre `settlement_transfers` con auditoría (ya se audita).
- **A-19 · Al anular un pago ya liquidado, la liquidación confirmada no cambia; la diferencia se descuenta en la siguiente pendiente** con un ajuste automático. _Si prefiere reabrir_: un `reopen` (admin) de una liquidación sin transferencias que desmarque pagos y gastos y vuelva a `PENDING`.
- **A-20 · "Retenciones" y "adelantos" son rubros manuales** con concepto, descripción y monto; no hay cálculo impositivo. _Si pide retenciones automáticas (IIBB, etc.)_: una tabla de reglas por tenant y una línea calculada en `SettlementPolicy.compute`.
- **A-21 · El consolidado agrupa por mes de liquidación** (cuándo se liquidó, `settlements.period`), no por período de la cuota, y el usuario elige qué liquidaciones entran. _Si prefiere automático_: `close` toma todas las confirmadas sin consolidado del propietario (ya están en `GET /statements/:id/candidates`).

## Fase 13 — Cron jobs y workers (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_13.md` (sobre `specs/fase-13-cron-jobs.md`, el PRD §13 y los modelos de las Fases 11 y 12). Reemplaza la spec original donde difieran.

### D-93 · Un solo `@Cron` cada 10 minutos que encola "lo que falta hoy", no "lo que toca a esta hora"

- **Contexto**: el rediseño pedía "un `@Cron` por frecuencia (cada hora en punto y uno diario a las 00:05)", pero los jobs salen a las 00:10, 09:10, 09:20…, y un servidor apagado a la hora exacta perdería el día.
- **Decisión**: `CronSchedulerTask` corre cada 10 minutos en `America/Argentina/Buenos_Aires` y llama a `JobScheduler.enqueueDue`, que por cada job y cada inmobiliaria activa (`TenantsFacade.listActive()`) calcula `JobSchedulePolicy.missingRuns`: las horas del job ya pasadas hoy menos las corridas `SCHEDULE` ya registradas ese día (`job_executions`). Lo que falta se encola. Al arrancar el servidor (a los 30 s) hace la misma pregunta una vez, así lo perdido estando apagado se recupera apenas vuelve. `AUTOMATIONS_ENABLED=false` apaga el disparo (en los tests, siempre apagado: se disparan a mano con una hora fija); las corridas manuales no dependen de esa variable.

### D-94 · Una cola de pg-boss por job, con la fila de ejecución creada al encolar y reusada en los reintentos

- **Decisión**: la cola `automation-<job con guiones>` lleva `{ job, executionId, scheduledFor, period, manual }`; el tenant viaja en el sobre de la cola (`RequestContext.runInTenant` al publicar), así el handler corre en la inmobiliaria del mensaje. La `singletonKey` es `<job>:<tenant|global>:<día>:<n° de corrida>` (`…:manual:<id>` en las manuales): si otra instancia ya encoló esa corrida (`DuplicateJobError`), la fila se descarta. Reintentos: 3 más, cada 60 s, sobre la misma fila (`RUNNING` otra vez). Agotados, `JOB_FAILED` al personal, una vez por job y día. Cada corrida deja una fila aunque no haga nada (`SKIPPED`): el historial del backoffice muestra qué corrió y qué no.

### D-95 · `job_executions` sin filtro de tenant: las lecturas filtran a mano por el tenant o los globales

- **Contexto**: `tenant_id` es opcional (los jobs globales, índices, no tienen inmobiliaria); la extensión de Prisma filtraría por tenant a todo modelo declarado `tenantScoped` y fallaría sin tenant.
- **Decisión**: `JobExecution` no es `tenantScoped` ni auditable (la fila es la traza); el test de modelos con tenant lo lista en `NOT_SCOPED_ON_PURPOSE` con la razón. `JobExecutionRepository.list/lastByJob` filtran `tenant_id = <contexto> OR tenant_id IS NULL`. Un job global (índices) lo ven todas las inmobiliarias; uno por tenant, sólo la suya.

### D-96 · `notification_log` es la memoria de los avisos: una fila por aviso, clave única por inmobiliaria, `read_at` para la campana

- **Decisión**: `NotificationsService` es lo único que llaman los jobs. Con una `dedupe_key` existente y no fallida devuelve `SKIPPED` sin enviar; si falló, la fila se reintenta en la próxima corrida. Una fila por aviso (no por canal): `channel` es el primero de la lista y el payload lleva todos más los datos de la plantilla. `entity_type`/`entity_id` son **opcionales** (en el rediseño eran obligatorios: "índice no disponible" no cuelga de nada) y se suma **`read_at`** (el DTO de avisos lo pide). Un aviso `IN_APP` al personal queda `SENT` al escribirse; su título, texto y link van en el payload.

### D-97 · `NotificationsPort` con adapter de consola; los destinatarios del personal no llevan email todavía

- **Decisión**: la fase no envía nada real. `NOTIFICATIONS_PROVIDER=console` loguea (sin los datos de la plantilla, que tienen nombres y montos) y responde `SENT`. Los avisos al inquilino y al propietario llevan email y teléfono resueltos (`RentersFacade.contacts`, `OwnersFacade.contacts`); los dirigidos al personal (`TENANT_STAFF`) y a la aseguradora (`INSURER`) llevan lo que haya. Quién es "el personal" lo resuelve la Fase 14 (hoy `TENANT_STAFF` no tiene email). La campana del backoffice sólo muestra los avisos `IN_APP` de seis tipos (`RENT_UPDATE_PENDING`, `INDEX_FETCH_FAILED`, `INSTALLMENT_BASE_OUTDATED`, `STATEMENT_PENDING`, `JOB_FAILED`, `DOCUMENT_FAILED`); los demás avisos al personal salen por email y quedan en el historial.

### D-98 · Índices: BCRA para el ICL, INDEC (datos.gob.ar) para el IPC, sólo meses terminados, y el resultado por tipo queda en `details`

- **Decisión**: `IndexSourcePort` con `BcraIndecIndexSource` y `ManualIndexSource`. El ICL sale de la API de estadísticas del BCRA (variable 40; acepta el formato v3 `results[].detalle[]` y el v2 plano) y es el valor del último día del mes, aceptando un dato de hasta 4 días antes (A-25); el IPC, de la serie `148.3_INIVELNAL_DICI_M_26` de la API de series de tiempo de datos.gob.ar (nivel general nacional, publicada por el INDEC). Un mes sólo se informa cuando terminó. `IndicesFacade.missingPeriods` mira los últimos 3 meses **terminados**; `registerFromSource` no pisa (`INDEX_PERIOD_TAKEN`, D-54) y tolera la carrera con otra corrida. `job_executions.details` guarda `{ ICL: { status, fetched, stillMissing, error }, IPC: {…} }` y `GET /indices/status` lo lee de la última corrida terminada. El aviso `INDEX_FETCH_FAILED` va sólo a las inmobiliarias que tienen contratos activos con ese índice (`ContractsFacade.indexTypesInUse`), una vez por día y tipo, y sólo si la fuente falló o falta un mes que ya debería estar publicado (A-28).

### D-99 · Los aumentos automáticos usan el mismo código que el manual, y las cuotas se corrigen por un evento (no desde el job)

- **Contexto**: el rediseño decía que `contracts.apply-rent-updates` llamara a `BillingFacade.rebaseInstallments` "y el manual hace lo mismo", pero cobros importa contratos: contratos no puede llamar a cobros.
- **Decisión**: `RentUpdateApplier` (contratos) escribe el aumento en el historial y emite `RentUpdateAppliedEvent`; lo comparten `ApplyRentUpdateHandler` y `ContractsFacade.applyDueRentUpdate` (que no tira si falta el índice o el aumento es manual: devuelve `MANUAL_REQUIRED` con el motivo). Un relay lo publica en la cola `contract-rent-updated` y cobros (`ContractEventsConsumer` → `InstallmentRebaser`) corrige la base de las cuotas, igual para el cron que para `POST /contracts/:id/rent-updates`. El rebase **no usa el monto del evento**: toma de `ContractsFacade.rentHistory` el alquiler vigente al 1° de cada mes, así dos aumentos seguidos que llegan en cualquier orden dejan lo mismo y repetirlo no cambia nada. Sólo se tocan cuotas `PENDING` sin pagos vigentes; las demás quedan y avisan `INSTALLMENT_BASE_OUTDATED` (A-24). `RentUpdatesJob` aplica en bucle los aumentos atrasados de un contrato (tope 24) y avisa `RENT_UPDATE_PENDING` una vez por contrato y fecha de aumento. El cron deja `appliedById` en `null`.

### D-100 · Los jobs diarios preguntan "¿falta hacer?", no "¿es hoy?"

- **Decisión**: cada job es idempotente por una regla de negocio y se recupera solo. Generar cuotas: siempre el mes en curso, y desde `installmentGenerationDay` el siguiente (índice único contrato-período). Recordatorio de pago: desde `paymentReminderDay` y hasta el fin de la gracia de la cuota (después toma el aviso de mora), `PAYMENT_REMINDER:<cuota>`. Mora: la primera vez que el job ve la cuota vencida (`ARREARS_NOTICE:<cuota>:renter|staff`). Aseguradora: desde el día siguiente a `paymentReminderDay` (`INSURER_ALERT:<cuota>`). Contratos por vencer: `CONTRACT_EXPIRING:<contrato>:owner|staff`. Pólizas: `POLICY_EXPIRING|EXPIRED:<contrato>:<vencimiento>` (una póliza renovada vuelve a avisar). Servicios: `SERVICE_OVERDUE:<servicio>:<vencimiento>:renter|staff`. Consolidados: desde `monthlyReportDay`, `STATEMENT_PENDING:<propietario>:<mes>`. Una corrida manual se saltea la condición del día pero no estas claves.

### D-101 · Sin job de punitorios diario

- **Decisión**: el punitorio se calcula al leer sobre el saldo de cada día (Fase 11) y se congela al saldar; un job diario no agregaría información. Es la decisión que el rediseño dejaba con "D-" sin número.

### D-102 · API de automatizaciones: corrida manual asincrónica, avisos de 30 días y `GET /indices/status` en el módulo `automations`

- **Decisión**: `POST /automations/jobs/:job/run` crea la ejecución `RUNNING` (con quién la pidió), la encola y responde 202; rechaza con 409 si ya hay una corrida `RUNNING` del mismo job de los últimos 15 minutos. `GET /automations/alerts` devuelve los avisos internos de los últimos 30 días, accesible también para empleados; `PATCH …/:id/read` y `POST …/read-all` los marcan. `GET /indices/status` se sirve desde `automations` (`IndexStatusController`, ruta `/indices/status`) porque el último intento sale de las ejecuciones de ese módulo, que depende de índices y no al revés. Los DTOs (`JobDto`, `JobExecutionDto`, `RunJobDto`, `RunJobResultDto`, `InternalAlertDto`, `IndexStatusDto`) son los de la sección 8 del rediseño, sin cambios.

### Supuestos a confirmar con Micaela (Fase 13)

Los A-22 a A-27 vienen del rediseño; A-28 a A-30 son de la implementación.

- **A-22 · Zona horaria única `America/Argentina/Buenos_Aires` para todas las inmobiliarias.** _Si hace falta otra_: columna `tenants.timezone` y pasarla a `localMoment`.
- **A-23 · El aviso de mora sale una sola vez por cuota, el primer día después de la gracia** (no se repite). _Si quiere recordatorios periódicos_: `ARREARS_NOTICE` con `dedupeKey` por semana.
- **A-24 · Un aumento posterior a la generación corrige la base de las cuotas pendientes sin pagos; las demás se avisan.** Un aumento que rige a mitad de mes alcanza desde el mes siguiente (la cuota del mes entero se generó con el alquiler de entonces, D-72). _Alternativa_: sólo avisar (quitar la corrección de `InstallmentRebaser.rebase`).
- **A-25 · ICL del contrato = valor publicado para el último día del mes del aumento; IPC = índice mensual del mes.** Consecuencia a confirmar: la regla de la Fase 9 usa el índice del **mes del aumento**, que recién existe al terminar el mes; un aumento ICL del 1° de noviembre se aplica a partir del 1° de diciembre (con vigencia retroactiva al 1° de noviembre) y las cuotas ya pagas se avisan. _Si usan el índice del mes anterior o otro día de referencia_: `RentUpdateApplier.applyIndex` y las constantes del adapter.
- **A-26 · Recordatorio de pago sólo a cuotas sin ningún pago; mora sólo con saldo de alquiler** (no por cargos ni punitorio solos).
- **A-27 · La alerta a la aseguradora se dispara por cuota del mes en curso con saldo de alquiler desde el día siguiente a `paymentReminderDay`** (default 1), como pide el PRD; con gracia de 10 días esto avisa antes de que haya mora. _Si prefieren después de la gracia_: usar `graceEndDate`.
- **A-28 · Un índice sin publicar no alarma hasta 20 días después del fin de su mes** (el INDEC publica el IPC a mediados del mes siguiente). El job queda `PARTIAL` y lo vuelve a pedir en cada corrida; el aviso `INDEX_FETCH_FAILED` sale pasado ese plazo o si la fuente falla. _Si quieren otro plazo_: `PUBLICATION_GRACE_DAYS` en `indices-fetch.job.ts`.
- **A-29 · Avisos de póliza a los 30 días, de servicios desde el 5° día de vencido (RN-13), de contratos con los días del tenant** (`contractExpiryNoticeDays`, default 60). Los dos primeros son constantes (`POLICY_NOTICE_DAYS`, `SERVICE_NOTICE_FROM_DAYS`).
- **A-30 · Los avisos al personal que no son de la campana (mora, contrato por vencer, póliza, servicio) salen por email sin destinatario resuelto**: quedan en `notification_log` y se envían cuando la Fase 14 sepa a quién (¿todos los administradores?, ¿un email de la inmobiliaria?). _Si prefieren verlos en la campana_: sumar el tipo a `ALERT_TYPES` y al enum del DTO.

## Fase 15 — Generación de PDFs (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_15.md` (PRD §23, PDF-01 a PDF-05). El rediseño numeraba sus supuestos A-28 a A-31, pero la Fase 13 ya ocupó A-28 a A-30: acá son **A-31 a A-34** (más A-35).

### D-103 · `documents` es el único que arma y guarda PDFs; los módulos dueños sólo exponen datos y un `attach`

- **Decisión**: el módulo `documents` recibe eventos, arma el JSON con las facades (`settlementForPdf`, `statementForPdf`, `paymentForReceipt`, `terminationForPdf`), renderiza y sube, y le avisa al dueño con `attachDocument`, `attachStatementDocument`, `attachReceipt` o `attachTerminationDocument` (que sólo guardan `key` y `url` en una columna). Nadie importa a `documents`; el dueño nunca conoce `pdfmake`.
- **Por qué**: el rediseño lo pedía y mantiene la regla de módulos (nunca leer tablas ajenas). Efecto: `OwnerContact` suma `nationalId` y las facades de propietarios e inquilinos suman `idForPortalUser`.

### D-104 · Cada consumidor extra de un evento tiene su propia cola (`*-documents`)

- **Contexto**: pg-boss entrega cada mensaje a **un solo** worker de la cola. `payment-confirmed` y `payment-voided` ya las consume liquidaciones; si `documents` se suscribía a las mismas, los dos se hubieran robado mensajes.
- **Decisión**: los relays de cobros y liquidaciones publican en la cola de siempre **y** en `payment-confirmed-documents`, `payment-voided-documents`, `settlement-confirmed-documents`, `statement-closed-documents` (reintentos 3 × 30 s). `contract-terminated` es nueva y sólo la consume `documents`, con su nombre llano. La Fase 14 (email) conserva las colas originales de liquidaciones.
- **Costo**: un `publish` más por evento. Alternativa descartada: exponer en `QueuePort` un pub/sub de pg-boss (acopla el puerto al proveedor).

### D-105 · Versiones nunca pisadas e idempotencia por `data_snapshot`

- **Decisión**: el archivo de cada versión vive en `documents/<carpeta>/<entityId>-<versión>.pdf`. Un evento repetido cuyos datos armados son iguales (comparación profunda con el JSON del último `READY`) no hace nada; datos distintos (p. ej. pago anulado) o `force` crean la versión siguiente. Una versión `PENDING` o `FAILED` se **reusa** al reintentar. La regeneración manual vuelve a armar los datos (no re-renderiza el snapshot viejo): refleja el estado actual de la entidad y la marca actual; el snapshot guarda con qué se armó cada versión.
- **Por qué**: ahorra renders ante redeliveries y deja historial sin código extra.

### D-106 · Fallo definitivo: `FAILED`, aviso `DOCUMENT_FAILED` y el mensaje se da por consumido

- **Decisión**: el consumidor deja que la excepción vuelva a la cola mientras queden reintentos (`retryCount < retryLimit`). En el último intento escribe `FAILED` con el error (crea la fila si todavía no existía) y avisa al personal por `NotificationsService.notifyStaff` (`DOCUMENT_FAILED`, clave por versión) y **no** relanza, así la dead-letter no duplica lo ya registrado. Los usuarios de portal nunca ven el campo `error`.

### D-107 · Numeración de recibos: contador del tenant, atómico y dentro de la transacción de asignación

- **Decisión**: `BillingFacade.paymentForReceipt` asigna el número la primera vez que se arma el recibo de un `CASH_IN` confirmado: `UPDATE tenants SET receipt_sequence = receipt_sequence + 1 … RETURNING` (SQL directo para no auditar cada incremento) y `payments.receipt_number = 'R-' + 8 dígitos`, en una sola transacción; si falla, no se gasta el número. `(tenant_id, receipt_number)` es único. El número es estable: reintentos, regeneraciones y la versión anulada usan el mismo.
- **Consecuencia**: un pago anulado antes de que se emitiera su recibo no genera ninguno (no tiene número).

### D-108 · Autorización de descarga por dueño de la entidad, con 404 uniforme

- **Decisión**: `GET /documents/:kind/:entityId` lo pueden pedir personal y portales. El personal ve todo; un propietario, sus liquidaciones/consolidados y la rescisión de sus contratos; un inquilino, los recibos de sus pagos y la rescisión de su contrato (se resuelve con `idForPortalUser` y `settlementOwnerId`, `statementOwnerId`, `receiptOwner`, `parties`). Lo ajeno responde igual que lo inexistente (404 `DOCUMENT_NOT_FOUND`). Regenerar y listar son sólo admin.
- **Por qué**: los portales (Fases 17 y 18) sólo descargan; la regla vive en un lugar.

### D-109 · Plantillas en `application/templates`, no en `domain`

- **Decisión**: el rediseño las ubicaba en `documents/domain/templates`, pero producen una `PdfDocumentDefinition` del puerto de plataforma y el linter de módulos prohíbe que `domain` importe `platform`. Quedan como funciones puras en `application/templates` (siguen sin I/O y se testean sin renderizar). El logo se baja por HTTP con tope de 5 s y 2 MB y se embebe sólo si es PNG, JPEG o SVG por sus bytes; WebP o una falla se omiten sin frenar el documento.

### D-110 · El estado del documento vive en `generated_documents`; las fichas sólo guardan la URL vigente

- **Decisión**: `settlements.pdf_url`, `owner_statements.pdf_url`, `payments.receipt_pdf_url`/`receipt_number` y `contracts.termination_pdf_url` se escriben dentro de la misma transacción que deja la versión en `READY`, así la ficha nunca apunta a un archivo inexistente. Quién está `PENDING` o `FAILED` se consulta en `GET /documents/...`. El archivo anterior queda en el storage (nunca se borra).

### Supuestos a confirmar con Micaela (Fase 15)

- **A-31 · Renderizado con `pdfmake`** (JS puro, sin Chromium: corre en cualquier free tier; Roboto embebida). _Si el Anexo A exige un diseño HTML/CSS_: adapter Playwright/Chromium detrás del mismo `PdfRendererPort`; las plantillas pasan a HTML.
- **A-32 · El "informe mensual al propietario" (PDF-04) es el consolidado cerrado (PDF-02)**; no hay un tercer documento.
- **A-33 · El recibo se emite por cada pago confirmado en efectivo o transferencia (`CASH_IN`), no por aplicaciones de saldo a favor, y lleva número correlativo por inmobiliaria.** _Si quieren un recibo por cuota saldada_: disparar en `installment-paid` con todos los pagos de la cuota; `receipt_number` pasaría a la cuota.
- **A-34 · Las leyendas legales (pie, recibo, rescisión) son fijas en español**; sólo el pie es configurable por inmobiliaria (`tenants.document_footer`, hoy en Configuración → Inmobiliaria). _Si hace falta editar más textos_: una tabla de textos por tenant leída por el `DocumentBrandingResolver`.
- **A-35 · También se emite recibo cuando el pago lo recibió el propietario directo (`receivedBy = OWNER`)**, y dice quién lo recibió. _Si no corresponde_: excluir `OWNER` en `DocumentEventsConsumer` (un `if` sobre `receivedBy`).

## Fases 18 y 17 — Portales de inquilinos y propietarios (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_17_18.md`. El rediseño numeraba sus supuestos A-32 a A-35, pero la Fase 15 ya ocupó hasta A-35: acá son **A-36 a A-40**. Mapa: A-32 del rediseño (honorarios) pasa a A-38; A-33 (acuse) a A-37; A-35 (contrato finalizado) a A-40; A-34 (paquete de formato) es del frontend y no cambia.

### D-111 · El módulo `portal` no tiene tablas ni repositorios: sólo consulta facades, y cada facade filtra por la persona

- **Decisión**: `portal` es un módulo de controllers + queries CQRS (más un único command, el acuse) que consume `BillingFacade`, `SettlementsFacade`, `ContractsFacade`, `PropertiesFacade`, `OwnersFacade`, `RentersFacade`, `ServicesFacade` y `TenantsFacade`. Los métodos nuevos de esas facades (`pageInstallmentsOfRenter`, `installmentOfRenter`, `receiptOfRenter`, `pageForOwner`, `findForOwner`, `portalContractOfRenter`, `listActiveByOwner`, `portalProfile`…) reciben el id de la persona y devuelven `null` o vacío si lo pedido no es suyo; el portal lo traduce a 404. El id de la persona sale de `idForPortalUser(userId)` en `PortalIdentity`, **nunca** de la URL.
- **Por qué**: la regla de aislamiento vive en un lugar por dato (la facade del módulo dueño), igual que D-108 con los documentos. Un `:id` ajeno es 404 y no 403 para no revelar que existe.
- **Consecuencia**: una facade no puede importar el `public/` de otro módulo (linter): `PropertiesFacade.typeNames` usa una clase propia de `application` (`PropertyTypeNames`) y no `PropertyViews`, que depende de propietarios y habría cerrado un ciclo de providers.

### D-112 · Lo interno se enmascara en el portal, con el mismo tipo que el backoffice

- **Decisión**: el portal reutiliza los DTOs de cobros, liquidaciones, consolidados y contratos (se referencian por nombre en el OpenAPI, no se duplican las clases) pero manda en `null` (o vacío) lo interno: quién registró, confirmó o anuló, notas, motivos de anulación y cancelación, `settlementId` de los pagos, el propietario (en lo que ve el inquilino), los gastos pendientes en otra moneda y el motivo de cada ajuste del punitorio. Las funciones son puras (`portal.mappers.ts`, con tests).
- **Por qué**: el frontend ya tipea esas respuestas con los mismos tipos del backoffice; sacar los campos rompería el tipo, ponerlos en `null` no. Entre inquilino y propietario no hay datos cruzados (el inquilino no ve a su propietario; el propietario no ve el medio de pago ni quién cargó cada pago).

### D-113 · El acuse es una columna de la liquidación, idempotente y sólo con una transferencia registrada

- **Decisión**: `settlements.acknowledged_at` (migración `add_settlement_acknowledgement`) lo escribe `SettlementsFacade.acknowledgeForOwner`; el segundo acuse no pisa al primero. Se rechaza con 422 `SETTLEMENT_NOTHING_TO_ACKNOWLEDGE` si `transferredTotal` es cero. `SettlementDetailDto` suma `acknowledgedAt` (el personal también lo ve). No cambia el estado ni los importes.
- **Por qué**: "Recibí la transferencia" no tiene sentido antes de que exista una (A-37). Si después se anula la transferencia, el acuse queda como constancia histórica.

### D-114 · Los PDF del portal redirigen (302), y con `?format=json` devuelven `{ url }`

- **Decisión**: `GET /portal/renter/payments/:id/receipt`, `/portal/owner/settlements/:id/pdf` y `/portal/owner/statements/:id/pdf` responden 302 a la URL vigente que ya guarda la ficha (`payments.receipt_pdf_url`, `settlements.pdf_url`, `owner_statements.pdf_url`), o 404 `DOCUMENT_NOT_READY` si todavía es nula. Con `?format=json` responden 200 `{ url }`.
- **Por qué**: el rediseño pedía el 302, pero el frontend los enlaza con un `href` simple y la API autentica con `Authorization: Bearer`: una navegación del navegador no manda ese header y daría 401. Con `?format=json` el cliente lo pide con axios y abre la URL (la del storage, que no lleva token). _Desvío a coordinar con el frontend._

### D-115 · Estado de cuenta del propietario: lo que significa cada número

- **Decisión**: por propiedad y moneda del mes (`period`, default el en curso): `accrued` = base de las cuotas; `pending` = saldo de alquiler; `collected` = `accrued − pending` (un pago informado sin confirmar ya cuenta, D-76); `lateFee` = punitorio devengado menos lo reducido, o 0 si se condonó. Los `totals` suman lo mismo por moneda y agregan `netSettled` (Σ neto de sus liquidaciones **confirmadas o transferidas** del mes, `settlements.period`) y `transferred`. `fees` es la cuenta de honorarios acumulada (`SettlementsFacade.feeAccountSummary`: devengado, cobrado, pendiente), no del mes. Una propiedad borrada no tiene fila, pero sí suma en los totales.

### Supuestos a confirmar con Micaela (Fases 17 y 18)

- **A-36 · El propietario sólo ve liquidaciones confirmadas o transferidas y consolidados cerrados.** Los borradores (`PENDING`), las canceladas y los consolidados abiertos son internos y responden 404. _Si quiere ver el borrador_: sumar `PENDING` a la lista de estados visibles (`PORTAL_VISIBLE`).
- **A-37 · "Recibí la transferencia" es un acuse informativo**: solo con una transferencia registrada, una vez, y no cambia ningún estado. _Si debe cerrar la liquidación_: pasar a un estado `ACKNOWLEDGED` en la máquina de estados de la Fase 12.
- **A-38 · El inquilino no ve el porcentaje de honorarios de la inmobiliaria salvo que los pague él por cuenta del propietario** (`feeMode = RENTER_PAYS_ON_BEHALF`). _Si Micaela quiere mostrarlo siempre_: quitar el filtro en `feesVisibleToRenter`.
- **A-39 · Si cobra el propietario directo (`OWNER_DIRECT`), el inquilino no ve los datos bancarios de la inmobiliaria**, sólo la leyenda de pago directo. _Si los quiere ver igual_: devolver siempre `agency.bankAccount`.
- **A-40 · Sin contrato activo el portal del inquilino muestra el último** (marcado por `status`), y la cuota "del mes" es la del período en curso o, si no hay, la más reciente de ese contrato.

## Fases 19 y 20 — Estadísticas, reportes y auditoría (sin supervisión, rediseño)

Referencia: `adminprop-repo-files/docs/REDISENO_FASE_19_20.md` (contrato HTTP en su sección 8). El rediseño numeraba sus supuestos A-36 a A-41, pero la Fase 18 ya ocupó hasta A-40: acá son **A-90 a A-96**, y lo que era un supuesto del rediseño y pasó a decisión se numera D. Mapa: A-36 (se calcula al leer) pasa a D-116; A-37 (gráficos SVG) es del frontend y no cambia; A-38 (ingresos por fecha de pago) a D-121; A-39 (inmutabilidad por trigger) a D-123; A-40 (sin retención) a A-90; A-41 (accesos del portal) a A-91.

### D-116 · Los reportes se calculan al leer, y el resumen de auditoría también

- **Decisión**: no hay tablas de agregados ni vistas materializadas: cada reporte compone las facades de los módulos dueños (`reportInstallments`, `reportPayments`, `reportSettlements`, `reportFeePayments`, `workload`, `listForReport`, `listExpiringWithin`…) y suma con `shared/money` por moneda. El módulo `reports` no tiene repositorios. Lo mismo con la frase de la auditoría: el rediseño proponía "cachearla escribiendo `summary` la primera vez que se muestra", pero la tabla es inmutable (D-123) y un `UPDATE` sería rechazado; se calcula siempre al leer (`AuditSummarizer`) y `summary` sólo lo llenan los eventos que lo traen al escribirse (accesos, avisos, exportaciones).
- **Por qué**: lo más simple y sin riesgo de que un agregado quede desfasado de los pagos. _Si los volúmenes pesan_: una vista materializada por mes refrescada por un job de la Fase 13; para la auditoría, particionar por mes.

### D-117 · Rangos de reportes: meses o días, máximo 36 meses

- **Decisión**: `from` y `to` aceptan `AAAA-MM` o `AAAA-MM-DD`. Un mes en `from` es su primer día; en `to`, el último. Sin rango: los últimos 6 meses hasta el mes de hoy. Más de 36 meses, `from` posterior a `to` o un formato inválido responden 400 `INVALID_REPORT_RANGE`. Es lo que manda el frontend con sus `<input type="month">`.

### D-118 · Qué significa cada número del dashboard

- **Decisión**: todo por moneda. Las cuotas se agrupan por el estado que ve el usuario (una cuota con saldo y la gracia vencida es `overdue`); el importe de `paid` es lo cobrado (pagos vigentes, un pago sin confirmar ya cuenta, D-76) y el de `partial`, `pending` y `overdue` es lo que falta cobrar a hoy (alquiler, cargos y punitorio). `lateFeesAccrued` es el punitorio devengado menos lo reducido (0 si se condonó) y `lateFeesCollected` lo cobrado, de las cuotas del mes; `feesAccrued` son los honorarios devengados sobre lo cobrado de esas cuotas (regla 9). `history` son los 6 meses que terminan en `period`, el más viejo primero, con alquiler base devengado y alquiler imputado cobrado; un mes sin cuotas igual figura, vacío. `todo` suma pagos por confirmar, liquidaciones pendientes y confirmadas sin transferir, consolidados abiertos, aumentos pendientes (`listDueForRentUpdate`) y avisos internos sin leer (ventana de 30 días de la campana). `expiringContracts` usa `contractExpiryNoticeDays` de la inmobiliaria.

### D-119 · Exportación: el archivo sale de la respuesta, no se guarda

- **Decisión**: `?format=xlsx|csv|pdf` responde el archivo (`Content-Disposition: attachment`, `Cache-Control: no-store`) con los mismos filtros y sin paginar; no pasa por el storage. XLSX por `ReportExporterPort` (`exceljs`, en `platform/exports`) y PDF por `PdfRendererPort` con una plantilla genérica de tabla en hoja apaisada. Los montos viajan como string por todo el sistema y se convierten a celda numérica sólo al escribir el XLSX, para que Excel pueda sumarlos. El CSV lleva BOM y `;` (abre bien en el Excel en español) y neutraliza los valores que empiezan con `=`, `+`, `@` o `-` seguido de no-dígito para que no se evalúen como fórmula. El dashboard no se exporta. Cada descarga escribe un `EXPORT` en la auditoría con el reporte, el formato, los filtros y la cantidad de filas.
- **Por qué**: son archivos de consulta, no documentos con valor legal (esos son los PDFs de la Fase 15 y sí se guardan).

### D-120 · El PDF de un reporte no lleva logo

- **Decisión**: la marca del PDF es el nombre (razón social o nombre), el color primario, CUIT, dirección, contacto y el pie configurado; no se baja el logo. Evita una descarga de red por cada reporte. _Si lo quieren_: reutilizar la resolución de marca de la Fase 15 desde una facade de documentos.

### D-121 · Ingresos: cada columna por su fecha

- **Decisión**: una fila por mes y moneda. `rentCollected`, `lateFeesCollected` y `chargesCollected` salen de los pagos confirmados (`rentApplied`, `lateFeeApplied`, `chargesApplied`) por **fecha de pago** y en la moneda de la cuota (incluye las aplicaciones de saldo a favor). `feesAccrued`, `netSettled` y `netTransferred` salen de las liquidaciones confirmadas o transferidas por el **mes de la liquidación** (`settlements.period`, A-21: el mes en que se liquida), igual que el estado de cuenta del propietario (D-115); las transferencias vigentes se imputan al mes de su liquidación. `feesCollected` es el honorario descontado en liquidaciones (`feeDeducted`) más los pagos de honorarios vigentes por su fecha. Por eso el mes del cobro y el mes de la liquidación pueden ser filas distintas.

### D-122 · La auditoría se escribe desde `shared`, y se parte en dos módulos Nest

- **Decisión**: `writeAuditEvent` vive en `shared/audit` porque `platform` (el `NotificationsService`) no puede importar módulos y necesita escribir `NOTIFICATION_SENT`. Los módulos usan `AuditFacade.record`, que se exporta desde `AuditRecorderModule` (sólo depende de Prisma). `AuditModule` (controller, lectura, resolución de nombres) importa las facades de propiedades, propietarios, inquilinos y contratos, y usa la de usuarios (auth es global): si auth importara ese módulo completo, `auth → audit → owners → auth` cerraría un ciclo. Auditar nunca hace fallar la operación (se loguea el error), igual que el diff automático.

### D-123 · `audit_logs` es inmutable por trigger

- **Decisión**: la migración `extend_audit_logs` crea `audit_logs_immutable`, un trigger `BEFORE UPDATE OR DELETE … FOR EACH ROW` que lanza una excepción (`restrict_violation`). Ni un admin de la API ni un `deleteMany` pueden tocar una fila. El `TRUNCATE` de los e2e no dispara triggers de fila, así que `resetDatabase` no cambió. `entity_id` pasa a admitir `NULL` (un login de un email desconocido no tiene entidad); `actor_kind` (`USER`, `SYSTEM`, `PORTAL_OWNER`, `PORTAL_RENTER`) lo completa la extensión de Prisma y `writeAuditEvent` según el rol del contexto; el backfill pasa a `SYSTEM` las filas viejas sin usuario (antes de crear el trigger, que prohíbe todo `UPDATE`). _Si molesta en desarrollo_: se deshabilita con una migración, nunca por código.

### D-124 · El filtro de tenant de la auditoría es manual

- **Decisión**: `AuditLog` sigue sin pasar por la extensión de tenant (admite filas globales y se escribe sin contexto), así que `AuditLogRepositoryImpl` pone el `tenantId` del contexto en **todos** los `where`; sin tenant en el contexto, un id imposible: no lee nada. Una fila sin tenant no la ve ninguna inmobiliaria. La búsqueda de texto mira `summary`, entidad, id de entidad y email del usuario: como el resumen del diff automático se arma al leer (D-116), una búsqueda por el texto de esa frase no lo encuentra; sí por entidad, id o email.

### D-125 · Qué eventos se registran y con qué actor

- **Decisión**: `LOGIN` (con ip y rol), `LOGIN_FAILED` (clave incorrecta, cuenta bloqueada, deshabilitada o inmobiliaria inactiva, con el motivo en `changes`) y `LOGOUT` (también el cierre en todos los dispositivos). `NOTIFICATION_SENT` por cada envío que salió de verdad (canal distinto de `IN_APP`), con tipo, destinatario y canales en `changes`, actor `SYSTEM` aunque lo haya disparado un usuario con una corrida manual. `JOB_RUN` sólo en la corrida manual (el usuario es el actor; las programadas ya están en `job_executions`), con el id de la ejecución como entidad. `EXPORT` en reportes y en la auditoría. Los `changes` de los eventos tienen la forma del diff (`{ campo: { after } }`) para que la pantalla los muestre igual.

### Supuestos a confirmar con Micaela (Fases 19 y 20)

- **A-90 · Sin política de retención**: se guarda todo, para siempre. _Si crece_: particionar `audit_logs` por mes.
- **A-91 · Los accesos al portal se auditan por ingreso exitoso y fallido**, no por cada página vista.
- **A-92 · `services?status=all` devuelve lo mismo que `overdue`**: el modelo no tiene un estado "sin gestión" ni vencimientos próximos para listar. _Si lo quieren_: agregar al repositorio de servicios una consulta de los que vencen en los próximos N días.
- **A-93 · Los reportes por propietario y por inquilino (`/reports/owners/:id`, `/reports/renters/:id`) no se hicieron**: el frontend no tiene pantalla. Los datos ya están en las facades (liquidaciones, cuenta de honorarios, mora).
- **A-94 · En el reporte de pagos, `amount` y `currency` son lo que entregó el inquilino** (`paidCurrency`), que puede ser distinta de la moneda de la cuota (un contrato en USD pagado en pesos); el total del reporte suma por esa moneda. Incluye las aplicaciones de saldo a favor. _Si quieren ver siempre la moneda del contrato_: usar `amountInContractCurrency`.
- **A-95 · Una renovación en curso es otro contrato, no rescindido, cuyo `renewedFromId` es el que vence.**
- **A-96 · Un intento de ingreso con un email que no existe deja una fila global (sin inmobiliaria) que no se ve en ninguna pantalla**: en el login del backoffice no se sabe de qué inmobiliaria es; en el del portal sí, y esa fila sí aparece. Sirve para investigar un ataque desde la base. No hay límite propio de filas: lo frena el limitador de pedidos del login.

## Fase 25 — Inventario del contrato (sin supervisión, rediseño)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_25.md`; el contrato HTTP lo fija `shared-types/inventory.ts` del frontend. Los supuestos del rediseño se llamaban A-42 a A-45 (ocupados por otras fases): acá son A-97 a A-100 (mapa en `docs/tecnica/fase-25.md`).

### D-126 · Módulo `inventory` con ids planos y sin facade

- **Decisión**: tablas `property_inventories`, `inventory_items` e `inventory_photos`, todas con `tenant_id`. El contrato y los usuarios se guardan como ids planos (sin FK, como el resto). Se habla con contratos por `ContractsFacade` (`find`, `exists`), con auth por `UsersFacade.describe` y con auditoría por `AuditFacade`. Nadie depende de inventario todavía, así que `public/` sólo exporta el módulo. Sólo `PropertyInventory` se audita con el diff automático; ítems y fotos no (se reemplazan en bloque mientras es borrador y llenarían el historial), y las altas y bajas de fotos dejan un evento `UPDATE` con resumen vía `AuditFacade`.

### D-127 · Vigente = no reemplazado; índices únicos parciales

- **Decisión**: `superseded_by_id` marca al inventario que reemplazó una corrección confirmada; "vigente" es `superseded_by_id IS NULL`. La migración agrega dos índices únicos parciales (Prisma no los declara; hay precedente en contratos): uno por `(tenant, contrato, tipo)` entre los vigentes que no son corrección (un solo original por tipo, A-97) y otro por `corrects_inventory_id` (una sola corrección en curso por inventario). La app valida antes y devuelve 409 con código propio; el índice es la red contra carreras. Confirmar una corrección marca al original en la misma transacción, con un `updateMany` condicionado a `status = DRAFT` que evita confirmar dos veces.
- **Consecuencia**: mientras hay una corrección en borrador, el listado muestra los dos (el confirmado y el borrador con `correctsInventoryId`); al confirmarla queda sólo la nueva.

### D-128 · Las correcciones comparten los archivos de las fotos

- **Decisión**: al corregir se copian las filas de ítems y fotos apuntando a la misma `storage_key`, sin duplicar archivos. Un archivo sólo se borra del storage cuando ninguna fila lo usa (`countPhotosByKey`), tanto al borrar una foto como al borrar un ítem. Subir varias fotos valida primero todas por contenido y, si una subida falla, borra las ya subidas.

### D-129 · La comparación usa sólo actas confirmadas y vigentes

- **Decisión**: un borrador no es un acta: no entra en la comparación (`hasDelivery: false` si la entrega sigue en borrador). Los ítems se emparejan por categoría y descripción sin distinguir mayúsculas; los repetidos, en orden. `NOT_APPLICABLE` de cualquiera de los lados es `SAME`. Primero van las filas de la entrega, después las que sólo están en la devolución. La lógica es pura (`inventory-comparison.ts`).

### D-130 · "Rescisión iniciada" es contrato `TERMINATED`

- **Decisión**: el modelo de contratos no tiene un estado intermedio de rescisión: se rescinde de una vez. La devolución se habilita si el contrato no está `ACTIVE` (finalizado o rescindido) o faltan 30 días o menos para su fin (A-99).

### D-131 · Errores de Multer en el filtro global

- **Decisión**: Multer lanza `MulterError`, que no es `HttpException` y salía como 500 (más archivos que el máximo, o un archivo demasiado grande). El filtro global ahora responde 400 por cantidad o campo y 413 por tamaño. Cambia también el comportamiento de fotos de propiedades y comprobantes, para mejor.

### D-132 · Fotos: HEIC por firma, avisos siempre calculados, alta con ítems opcionales

- **Decisión**: `shared/files/file-signature` no reconoce HEIC, y el inventario lo necesita (fotos de iPhone): la política lo detecta por la marca `ftyp` (heic, heix, hevc, hevx, heim, heis, mif1, msf1). Se guarda tal cual, sin convertir. `warnings` (ítems en mal estado sin fotos) se calcula en cualquier `InventoryDetail`, no sólo al confirmar. `POST /contracts/:id/inventories` acepta `items` opcionales (el rediseño los menciona, `CreateInventoryRequest` de shared-types no): es un superconjunto del contrato.

### Supuestos a confirmar con Micaela (Fase 25)

- **A-97** (rediseño A-42) · Un solo inventario vigente por tipo y contrato; corregir = nuevo inventario con motivo, el anterior queda histórico.
- **A-98** (rediseño A-43) · Plantilla estándar fija en código (9 categorías, 26 ítems), sin edición por tenant.
- **A-99** (rediseño A-44) · La devolución se habilita con el contrato no activo o a 30 días o menos de su fin.
- **A-100** (rediseño A-45) · Sin PDF del inventario ni de la comparación todavía.
- **A-101** · Una corrección en borrador no se puede descartar (no hay baja en el contrato): se edita y se confirma. _Si molesta_: agregar `DELETE /inventories/:id` sólo para borradores.
- **A-102** · Las fotos HEIC se guardan sin convertir: algunos navegadores no las muestran. _Si pasa_: convertirlas a JPG al subir.
- **A-103** · El portal de propietarios e inquilinos no ve inventarios (403): sólo admin y empleado.
