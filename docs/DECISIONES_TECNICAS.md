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

## Fase 22 — Portal público (sin supervisión, rediseño)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_22.md`; el contrato HTTP lo fija `shared-types/public-listing.ts` del frontend. Los supuestos del rediseño se llamaban A-46 a A-49 (ocupados por otras fases): acá son A-104 a A-107 (mapa en `docs/tecnica/fase-22.md`).

### D-133 · Precio, moneda y descripción pública en la propiedad; sin flag de publicación

- **Decisión**: `properties` suma `listing_price` (`Decimal(14,2)` null), `listing_currency` (`Currency`, default `ARS`) y `public_description` (`VarChar(2000)` null). Al dar de alta sin moneda se usa la de la inmobiliaria (`TenantsFacade.defaultCurrency`, que lee `tenants.default_currency`). Un precio vacío o `0` se guarda como null ("Consultar"); "150000" se normaliza a `"150000.00"`; la API lo recibe y devuelve siempre como string. Los campos están en `CreatePropertyDto`/`UpdatePropertyDto` y en `PropertySummaryDto`/`PropertyDetailDto` (y por lo tanto en `openapi.json`). **No hay flag "publicada"**: `AVAILABLE` ya implica visible (rediseño A-49 / A-107). Una propiedad que el personal no quiere mostrar se pasa a `MAINTENANCE`.
- **Por qué**: el contrato `public-listing.ts` no tiene ningún campo de publicación y el rediseño lo descarta de forma explícita; un flag aparte duplicaría el estado. Si hace falta ocultar una disponible, se agrega `listing_published` (default `true`) sin romper nada.
- **Consecuencia**: el índice nuevo `(tenant_id, status, created_at)` sirve al listado público.

### D-134 · La facade de propiedades arma las vistas públicas con una lista blanca

- **Decisión**: `PropertiesFacade.listPublic(filter, page)`, `getPublic(id)`, `publicFilters()` y `publicRef(id)` corren en el tenant del contexto (como el resto de la facade; el rediseño les pasaba `tenantId`, acá lo fija `RequestContext` desde el módulo `public`). Las vistas (`PublicPropertyViews`) construyen cada campo a mano: propietario, contrato, notas, estado y `storageKey` no existen en el tipo de salida, y un test recorre el JSON buscando esos valores. El listado trae sólo la foto principal; la ficha, todas.
- **Por qué**: una lista blanca no filtra datos nuevos por descuido cuando se agrega una columna a la propiedad.

### D-135 · El slug fija el tenant: `PublicTenantScope`

- **Decisión**: los endpoints `/public/:slug/*` son `@IsPublic()`. `PublicTenantScope` resuelve el slug con `TenantsFacade.findActiveBySlug` (inexistente o deshabilitada: 404 `TENANT_NOT_FOUND`, mismo mensaje) y ejecuta el caso de uso dentro de `RequestContext.runInTenant`. Las queries y el comando llevan el slug y abren el scope en su handler (el controller sólo despacha). Un id de propiedad de otra inmobiliaria da el mismo 404 `PROPERTY_NOT_AVAILABLE` que uno inexistente.
- **Por qué**: sin JWT no hay tenant en el contexto; fijarlo con `runInTenant` hace que la extensión de Prisma filtre todo, así que el aislamiento no depende de recordar un `where`.

### D-136 · Anti-spam: honeypot + límite contado en la base + throttler

- **Decisión**: (1) Honeypot: `website` con texto responde `201 { id }` (un UUID inventado), no guarda, no avisa y deja un `warn` en el log. (2) Límite de 5 consultas por hora **por IP y por email** (en minúsculas), contado contra `public_inquiries` por inmobiliaria; la 6.ª da 429 `RATE_LIMIT_EXCEEDED` con mensaje en español. (3) Además, `@Throttle` del módulo de rate limiting: lecturas 60/min (pisa el perfil `medium`) y contacto 20/hora (perfil `long`) por IP, que frena a los bots del honeypot (no dejan fila). La IP sale de `RequestContext` (respeta `TRUST_PROXY`).
- **Por qué no sólo el throttler**: es en memoria por proceso (no cuenta por email ni se comparte entre instancias) y los e2e lo apagan; contar contra la tabla es exacto, funciona con varias instancias y se prueba. Costo: una consulta de conteo (índices `(tenant, ip, created_at)` y `(tenant, email, created_at)`).
- **Consecuencia**: una oficina detrás de un NAT comparte IP y cupo (A-109). Con el honeypot lleno el cliente no se entera.

### D-137 · `PublicInquiry`: entidad, aviso interno y email

- **Decisión**: tabla `public_inquiries` (tenant-scoped, auditada, sin borrado lógico) con `status` (`NEW | CONTACTED | CLOSED`), `source` (`PORTAL`), `property_id` plano (sin FK: la propiedad puede borrarse) e `ip` (excluida del historial de auditoría y de toda respuesta). El email se guarda en minúsculas; nombre y teléfono en una línea (van al asunto del email), el mensaje conserva los saltos. Al crear se publica `PublicInquiryCreatedEvent` en el `EventBus`; `NotifyStaffOnInquiryHandler` crea la alerta interna (`NotificationsService.notifyStaff`, tipo `PUBLIC_INQUIRY`, clave `PUBLIC_INQUIRY:<id>`, link `/crm`) y, si la inmobiliaria tiene email de contacto, manda un correo por `EmailPort` con `replyTo` al consultante. Ambos son best-effort (se loguea el error y la consulta ya está guardada). `PUBLIC_INQUIRY` se agregó a `ALERT_TYPES` para que aparezca en la campana. Endpoints del personal: `GET /inquiries?status=&propertyId=&page&limit` y `PATCH /inquiries/:id/status` (admin y empleado).
- **Por qué evento en proceso y no cola**: el efecto es un aviso, no dinero; si el proceso cae justo después de guardar se pierde el aviso, pero la consulta queda en `/inquiries`.

### D-138 · Filtros del listado

- **Decisión**: `locationId` y `propertyTypeId` son coincidencia exacta (filtrar por una ciudad no incluye sus barrios). `GET /filters` devuelve las ubicaciones tal como están cargadas en propiedades disponibles, nombradas "barrio, ciudad". Con `priceFrom`/`priceTo` sin `currency` se usa la moneda de la inmobiliaria (no se mezclan monedas) y las propiedades sin precio quedan afuera. `currency` sola filtra por moneda.
- **Por qué**: el contrato no pide jerarquía; el select del portal ofrece exactamente lo que hay publicado.

### D-139 · Campos del contrato que el modelo todavía no tiene

- **Decisión**: `PublicPropertySummary.bedrooms`, `bathrooms` y `areaM2` salen `null` siempre: la propiedad no carga ambientes ni superficie. `features` se arma con "Tipo" y "Ubicación". `title` es la dirección hasta la primera coma ("Av. Corrientes 1234, 5° B" pasa a "Av. Corrientes 1234"). `neighborhood` es el nombre de la ubicación sólo si es un barrio. `currency` es null cuando no hay precio. Ningún desvío de forma respecto de `public-listing.ts`.
- **Si lo quieren**: sumar `bedrooms`, `bathrooms`, `area_m2` a la propiedad (y al wizard) y pasarlos por la vista.

### D-140 · `PROPERTY_NOT_AVAILABLE` es 404 en la ficha y 409 en el contacto; teléfono opcional

- **Decisión**: mismo código, dos status, como pide el rediseño (el front de la ficha muestra un aviso amable; el del formulario, "esta propiedad ya no está disponible"). Consultar por una propiedad de otra inmobiliaria o inexistente también da 409. El teléfono es opcional en `POST /contact` (el formulario del portal sólo exige nombre, email y mensaje).

### Supuestos a confirmar con Micaela (Fase 22)

- **A-104** (rediseño A-46) · Precio y descripción pública son campos nuevos y opcionales de la propiedad; "sin precio" = "Consultar".
- **A-105** (rediseño A-47) · La dirección completa es pública. _Si molesta_: un flag por inmobiliaria que la reduzca a barrio.
- **A-106** (rediseño A-48) · El anti-spam es honeypot + límite de 5 por hora por IP y por email; sin CAPTCHA todavía.
- **A-107** (rediseño A-49) · No hay "publicar" manual: `AVAILABLE` ya implica visible.
- **A-108** · Filtrar por ubicación no incluye las ubicaciones hijas (D-138).
- **A-109** · Quienes comparten IP (una oficina) comparten el cupo de 5 consultas por hora; detrás de un proxy hace falta `TRUST_PROXY=true`.
- **A-110** · Hasta que haya ambientes y superficie en la propiedad, esos datos no se muestran en el portal (D-139).

## Fase 14 — Notificaciones y mailing (sin supervisión, rediseño)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_14.md` y del contrato `shared-types/notifications.ts`. Los supuestos del rediseño se llamaban A-50 a A-59 (ocupados por otras fases): acá son A-111 a A-120 (mapa en `docs/tecnica/fase-14.md`).

### D-141 · `NotificationsService` delega en un `NotificationsPipeline`; `NotificationsPort` queda como costura sin uso

- **Decisión**: `send()` y `notifyStaff()` conservan su firma, pero el cuerpo pasó a `NotificationsPipeline`, una clase abstracta en `platform/notifications` que implementa `modules/notifications` (`NotificationPipeline`) y que se provee desde un módulo `@Global`. `NotificationsPort` y su adapter de consola siguen registrados, pero **ya nadie los llama**: la entrega pasa por `EmailPort`. Quedan como la costura para un proveedor completo (Novu, A-111) si algún día se construye.
- **Por qué**: el pipeline necesita auth (personal), tenants (marca), documentos (PDF) y jobs; `platform` no puede importar módulos (lo hace cumplir el linter). Mover `NotificationsService` obligaba a tocar cada job y cada mock.
- **Consecuencia**: `test/automations.e2e-spec.ts` ya no lee `ConsoleNotificationsAdapter.sent`; reconstruye los avisos desde `notification_log`.

### D-142 · Una fila por destinatario; el personal recibe un mail por persona y la campana es una sola fila

- **Decisión**: un aviso a `TENANT_STAFF` sin `recipient.id` con canal EMAIL se abre en un mail por usuario activo (`dedupeKey:u:<usuario>`, vía `UsersFacade.listStaffContacts`). El canal `IN_APP` sigue siendo **una sola fila compartida** (`read_at` es de todos, como en la Fase 13). La preferencia personal de campana se aplica **al leer** (`GET /automations/alerts` esconde los tipos que ese usuario apagó), no al crear.
- **Por qué**: duplicar la fila por persona rompería `read-all` y la campana actual; filtrar al leer da "el opt-out de uno no afecta al otro" sin cambiar el contrato.
- **Consecuencia**: `read-all` marca todo para todos, incluso lo que el usuario no veía (A-122).

### D-143 · Una fila `SKIPPED` o `FAILED` se vuelve a evaluar con el mismo `dedupeKey`

- **Decisión**: sólo una fila `QUEUED` o `SENT` bloquea el reenvío. Una `FAILED` (como en la Fase 13) y también una `SKIPPED` se pisan en la próxima corrida del job.
- **Por qué**: si un inquilino no tenía email o el tipo estaba apagado, y después se carga el dato o se prende el tipo, el recordatorio diario tiene que salir; con el dedupe estricto del rediseño quedaría descartado para siempre.
- **Consecuencia**: cada corrida diaria reescribe las filas `SKIPPED` pendientes (idempotente). Un job que cuenta "ya avisados" suma también estas.

### D-144 · Los reintentos los programa el servicio, no la cola; un error desconocido es temporal

- **Decisión**: `NotificationDeliveryService` hace un intento por mensaje de la cola y, si falla de forma temporal, publica otro con `startAfterSeconds` de 60, 300 y 1800 (cuatro intentos). La cola `notifications-deliver` tiene `retryLimit: 3` sólo para fallos de infraestructura. Un error que no es `EmailDeliveryError` se trata como temporal.
- **Por qué**: el backoff de pg-boss es uniforme y no distingue un rechazo definitivo; así `attempts`, `next_attempt_at` y el error quedan en `notification_log` en cada paso y los tests llaman `deliver()` sin esperar minutos.
- **Consecuencia**: si falla la publicación del reintento, la fila queda `QUEUED` con `next_attempt_at` y sin mensaje; "reintentar fallidas" y el reenvío manual no la ven (no es `FAILED`). Se loguea el error.

### D-145 · `send()` devuelve "aceptado", no "entregado"

- **Decisión**: el `SendOutcome` `SENT` significa que quedó en la cola (o que un aviso interno ya está listo); `SKIPPED`, que ya estaba avisado o que una preferencia lo descartó; `FAILED`, que ni siquiera se pudo encolar. Un fallo de entrega aparece después, en el historial y, si es crítico, en la campana.
- **Por qué**: la entrega es asincrónica por diseño (rediseño sección 2). Los jobs de la Fase 13 siguen andando igual; su resultado `PARTIAL` por "falló el envío" ya no se produce por fallos del proveedor.

### D-146 · Eventos: se consumen las colas que ya existían y se suma una copia de `payment-confirmed`

- **Decisión**: `settlement-confirmed` y `statement-closed` no tenían consumidor (los dejó previstos la Fase 12); los consume `NotificationEventsConsumer`. Para el recibo se agregó `payment-confirmed-notifications` y el relay de cobros publica una copia más (pg-boss entrega cada mensaje a un solo consumidor). Sólo `CASH_IN` (A-33).
- **Consecuencia**: cada cobro genera una fila `SKIPPED (TYPE_DISABLED)` mientras `PAYMENT_RECEIVED` siga apagado: es la evidencia de por qué no salió.

### D-147 · Adjuntos: `StoragePort.download` y `DocumentsFacade.currentPdf`

- **Decisión**: el PDF vigente se baja por `StoragePort.download(key, url)` (nuevo, abstracto) y lo entrega `DocumentsFacade` (nueva). Si todavía no está listo (`PENDING` o inexistente), el mensaje se reprograma a 20 segundos, hasta 3 veces (el contador `attachmentWaits` vive en el payload de la fila); pasadas las esperas, o con el PDF `FAILED` o de más de 10 MB, sale **sin adjunto** (el texto lleva el link al portal). Las esperas no cuentan como intentos.
- **Por qué**: los PDFs se generan en paralelo desde el mismo evento; no se puede garantizar el orden.

### D-148 · Webhook: cuerpo crudo capturado en el parser JSON; sin secreto, 401

- **Decisión**: `configureApp` guarda `rawBody` (sólo para URLs con `/webhooks/`) en el `verify` del `json()` que ya registraba. Sin `RESEND_WEBHOOK_SECRET` el endpoint responde 401 (nada es verificable). Un evento de un mensaje desconocido, repetido o de un tipo que no usamos responde 200 sin guardar.
- **Por qué**: el parser de Nest con `rawBody: true` sólo existe en `main.ts`; los e2e arman la app sin esa opción y tienen que probar la verificación real.

### D-149 · Las tablas auditadas no usan `upsert`

- **Decisión**: plantillas, configuración y textos de WhatsApp se guardan con `findFirst` + `create`/`update` (y `delete`), no con `upsert`/`deleteMany`, y llevan `created_by_id`/`updated_by_id`.
- **Por qué**: la extensión de auditoría sólo ve `create`, `update` y `delete`: un `upsert` cambiaba la plantilla sin dejar historial, y un modelo auditado sin esas columnas falla al crear. Lo detectó el e2e.

### D-150 · `POST /notifications/dev/events` responde 404 fuera de desarrollo

- **Decisión**: con `EMAIL_PROVIDER` distinto de `console` o en producción responde 404 `DEV_EVENTS_DISABLED`. Sólo admin. Opera sobre una notificación con `provider_message_id` (las de consola lo tienen: `console_<uuid>`).

### D-151 · `ResendEmailAdapter` con `fetch`; `FlakyEmailAdapter` dentro de `src/`

- **Decisión**: sin SDK de Resend (un POST alcanza); timeout de 15 s. `FlakyEmailAdapter` vive en `platform/email/adapters` para que lo usen unitarios y e2e, documentado como doble de pruebas.

### D-152 · `buildWhatsAppLink` es una copia en `src/shared/whatsapp`

- **Decisión**: copia de `apps/backoffice/src/lib/whatsapp.ts` con los mismos casos de prueba (A-118). El rediseño hablaba de un paquete `shared-utils` que el frontend no tiene; hasta que se extraiga hay dos copias. El backend todavía no la usa en ningún flujo: el link lo arma el backoffice.

### D-153 · Reglas de la configuración por tipo

- **Decisión**: un tipo obligatorio rechaza `enabled: false` o quitar alguno de sus canales por defecto (422 `NOTIFICATION_MANDATORY`); un canal fuera de `availableChannels` es 422; un tipo habilitado sin canales también. El pedido se valida entero antes de guardar. `GET /notifications/settings` lista los 19 tipos, incluidos los internos (siempre obligatorios, sólo `IN_APP`).

### D-154 · `canResend` y reenvío

- **Decisión**: sólo se reenvían filas `FAILED` de canal EMAIL con destinatario. El rediseño también mencionaba "`SKIPPED` por falla de proveedor": esa combinación no existe (una falla del proveedor es `FAILED`), así que no se implementó. El reenvío masivo (`resend-failed`) intenta cada fila en el momento para que el avance del `AsyncJob` sea el real.

### D-155 · "Enviarme una prueba" sale en el momento

- **Decisión**: crea una fila (`TEMPLATE_TEST:...`, asunto con prefijo `[Prueba]`) y la entrega sin esperar a la cola, al email del usuario logueado. Aparece en el historial como cualquier envío, a nombre de un destinatario `TENANT_STAFF`.

### D-156 · `PORTAL_BASE_URL` y `{{portalUrl}}`

- **Decisión**: variable de entorno opcional; `portalUrl` = `<base>/<slug>`. Sin ella, la variable queda vacía (el texto por defecto de liquidación y consolidado dice "También lo encontrás en tu portal:" sin link). Documentada en `.env.example`.

### Supuestos a confirmar con Micaela (Fase 14)

- **A-111** (rediseño A-50) · Plantillas propias (código + override por inmobiliaria), HTML generado por un layout; Novu fuera del camino crítico.
- **A-112** (A-51) · Cuatro intentos (inmediato, +1, +5, +30 min) sólo para errores temporales.
- **A-113** (A-52) · Un fallo definitivo de un tipo crítico avisa a la campana; los demás sólo quedan en el historial.
- **A-114** (A-53) · Preferencias personales sólo para personal y tipos no obligatorios.
- **A-115** (A-54) · El recibo por mail (`PAYMENT_RECEIVED`) viene apagado.
- **A-116** (A-55) · La campana no cambia (`/automations/alerts`); no hay `/notifications/in-app`.
- **A-117** (A-56) · Un evento de webhook de un mensaje desconocido se descarta con un log.
- **A-118** (A-57) · Teléfonos sin código de país se asumen argentinos móviles (`549`).
- **A-119** (A-58) · Ningún dato bancario en los mails salvo que la plantilla lo declare; hoy ninguna lo hace.
- **A-120** (A-59) · Adjuntos de hasta 10 MB; el PDF que no está listo espera 3 veces y después sale sin adjunto.
- **A-121** · El aviso de mora sale por email y link de WhatsApp; `IN_APP` queda disponible pero no por defecto (el rediseño decía "personal: EMAIL + IN_APP"). _Si se quiere en la campana_: sumar `IN_APP` a los canales por defecto del tipo y a lo que pide el job.
- **A-122** · `read-all` de la campana marca para todo el personal (D-142).
- **A-123** · Los mails del personal usan los mismos textos que los de inquilinos y propietarios, con "Hola <nombre del usuario>".
- **A-124** · Las filas `IN_APP` del personal no se listan en `GET /notifications` (se leen en `/automations/alerts`).

---

## Fase 21 — Migración de datos / ETL (sin supervisión, rediseño)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_21.md` (que numera sus supuestos A-70 a A-79 y se implementaron tal cual) y del contrato `shared-types/migration.ts`. Acá van las decisiones de implementación (D-157 a D-172) y los supuestos que el rediseño no definía (A-125 a A-131). Detalle en `docs/tecnica/fase-21.md`.

### D-157 · Confirmar es un cambio de estado atómico (`READY → IMPORTING`)

- **Contexto**: dos pedidos de confirmación a la vez (doble click, dos pestañas) podían importar el lote dos veces.
- **Decisión**: `ImportBatchRepository.transition(id, from, changes)` es un `updateMany` con `where: { id, status: from }`; el que no cambia ninguna fila recibe 409 `BATCH_ALREADY_CONFIRMED`. Lo mismo para descartar. Como `updateMany` no pasa por el diff de auditoría de Prisma, la confirmación y el descarte dejan su propio evento `JOB_RUN` (D-167).
- **Por qué**: la idempotencia por vínculos protege los datos, pero no evita el doble trabajo ni los conflictos de unicidad a mitad de camino.

### D-158 · Las facades de alta despachan el comando del propio módulo

- **Decisión**: `OwnersFacade.createFromImport`, `RentersFacade.createRenterFromImport`/`createGuarantorFromImport`, `PropertiesFacade.createFromImport` y `MasterDataFacade.ensureCatalogItem`/`ensureLocationPath` ejecutan por el `CommandBus` el mismo comando que usa el controller (`CreateOwnerCommand`, etc.). Los repositorios de personas suman `findByNationalIds` (una consulta por entidad en el análisis).
- **Por qué**: así una fila importada pasa por **las mismas validaciones y la misma auditoría** que una carga manual (el rediseño lo exige) sin duplicar reglas en `migration`, que no toca tablas ajenas. El costo: las facades dependen del `CommandBus` y de los comandos de su módulo, lo cual es legal (todo adentro del mismo módulo).

### D-159 · La plantilla se aparta de la tabla del rediseño en dos columnas

- **Garantes**: suma «Tipo de garantía» y «Detalle de la garantía». El alta manual de un garante los exige (`guaranteeType`, `guaranteeDetail` nunca vacío) y la tabla del rediseño no los tenía. Sin ellos, el garante se carga como «Recibos de sueldo» con detalle «Importado sin detalle: completar» (A-125).
- **Contratos**: se quita «Día de vencimiento». No existe por contrato en el modelo (la inmobiliaria tiene su regla de vencimiento); aceptar la columna e ignorarla en silencio habría sido peor que no tenerla.
- **Versión de la plantilla**: `Meta!B1 = template_version` (hoja muy oculta). Los encabezados se buscan por texto, no por posición: reordenar columnas no rompe el archivo.

### D-160 · Contratos importados: defaults seguros y reglas de superposición

- **Decisión**: sin índice de aumento → `OTHER` (manual) y frecuencia `ANNUAL`: el job de aumentos **avisa** en vez de aplicar un índice que nadie eligió (A-126); sin modalidad de cobro → cobra la inmobiliaria; sin depósito → `0.00`; sin moneda del depósito → la del contrato. Con aumento «Fijo» el `% fijo` es obligatorio.
- **Fin anterior a hoy** → el contrato nace `FINISHED` por `ContractImporter` (`NewContract.status` opcional), **sin** `attachContract` a la propiedad ni al inquilino: el contrato vigente de la misma propiedad no se pisa. Los vigentes pasan por `CreateContractCommand` normal.
- **Superposición**: dos contratos vigentes sobre la misma propiedad → `CONTRACT_OVERLAP`; dos del mismo inquilino → `RENTER_ALREADY_ACTIVE`; propiedad sin propietario → `PROPERTY_WITHOUT_OWNER`. Se detectan en el análisis (contra lo cargado y dentro del archivo), no recién al confirmar.
- **Sin cuotas**: nada en el alta genera cuotas (las crea el job de cobros por período), así que no hay nada que apagar: el arranque es limpio desde el período actual (A-74).

### D-161 · Referencias entre hojas

- **Decisión**: propiedad → propietario, inquilino → garante y contrato → inquilino se enlazan por DNI/CUIT; contrato → propiedad por «Código de propiedad», que **sólo** se resuelve contra la hoja Propiedades del mismo archivo (el código es una clave local, no se guarda). Un DNI/código que no está en el archivo ni cargado es error de fila (`OWNER_NOT_FOUND`, `GUARANTOR_NOT_FOUND`, `RENTER_NOT_FOUND`, `PROPERTY_CODE_UNKNOWN`); si la fila referenciada tiene errores, la dependiente también (`*_ROW_INVALID`).
- **Para contratos de propiedades ya cargadas**: se incluye la propiedad en el archivo; sale como `CONFLICT`/`ALREADY_IMPORTED` con su `targetId` y el contrato se cuelga de ella.
- **En la confirmación**: los ids se resuelven desde las filas del propio lote (importadas o existentes) y, si no, por DNI en el sistema. Una dependencia omitida/excluida/fallida deja la fila `FAILED` con `DEPENDENCY_NOT_IMPORTED`.

### D-162 · Claves naturales y vínculos

- **Decisión**: persona = DNI/CUIT (sólo dígitos). Propiedad = `dirección normalizada | ruta de ubicación normalizada` (sin acentos, minúsculas, sin «calle/av.»; la ruta sale del árbol cuando existe, para que «Tolosa» y «Buenos Aires > La Plata > Tolosa» den la misma clave). Contrato = `clave de la propiedad | DNI del inquilino | inicio`. El vínculo usa la clave natural en Excel y el id de Tokko en Tokko. Un documento inválido recibe una clave `invalid:...` para no chocar con nada.
- **Precedencia**: error → duplicado en el archivo → vínculo previo (`ALREADY_IMPORTED`) → colisión con lo cargado (`CONFLICT`) → `VALID`.
- **Duplicado en el archivo**: `CONFLICT` con `conflict.kind = DUPLICATE_IN_FILE` y `entityId` = id de la fila que lo precede; no admite resolución (se omite siempre).

### D-163 · Ubicaciones: rutas, país opcional y nombre suelto

- **Decisión**: la ruta admite hasta tres niveles (provincia, ciudad, barrio) bajo el primer país del tenant; el país puede escribirse o no. Un solo nombre se acepta si es único en el árbol; si está repetido es `AMBIGUOUS_LOCATION` y si no existe es `UNKNOWN_LOCATION` (no se sabe dónde crearlo: hay que escribir la ruta). Tokko: `Argentina | Provincia | Ciudad | Barrio` descarta el país; con un solo nombre inexistente se crea como provincia; una ruta ambigua cae al comodín con `needsReview` (A-77).
- **Por qué**: crear en silencio una «Palermo» huérfana ensucia el maestro; el rediseño pide no duplicar y aceptar rutas.

### D-164 · Fusión (`MERGE_EMPTY_FIELDS`): qué se completa

- **Decisión**: `fillEmptyFields(current, incoming, fields)` (en `shared/core`) devuelve sólo campos hoy vacíos con valor en el archivo. Propietario: teléfono, email, domicilio, notas y los cuatro datos bancarios (por `UpdateOwnerBankAccountCommand`, que sigue quedando como su propio registro de auditoría); inquilino y garante: contacto, notas y (inquilino) garante; propiedad: propietario, precio, descripción pública y notas; contrato: notas. **No** se crean maestros ni se suman amenities en una fusión. Nunca se modifica nombre, apellido, DNI, dirección ni ubicación.
- **`differingFields`** lista los campos donde el archivo trae un valor distinto del existente (sirve de aviso en la pantalla); comparar ignora mayúsculas y acentos.

### D-165 · Fotos: trabajo aparte, orden por propiedad, descargador a prueba de SSRF

- **Decisión**: al terminar las filas se insertan los `import_asset_results` y se encola un `AsyncJob` `migration-assets` (concurrencia 3 **entre propiedades**, en orden dentro de cada una: la portada de Tokko va primera y queda como foto principal). El `jobId` de ese trabajo sólo se devuelve en `assets/retry`; para la primera corrida la pantalla sigue `assets` del detalle del lote. **El lote queda `IMPORTING` hasta que terminan las fotos** (el frontend sólo vuelve a consultar el lote mientras está `ANALYZING` o `IMPORTING`; si pasara a `COMPLETED` antes, el avance de las fotos quedaría congelado) y recién entonces toma su estado final (`summary.finalStatus`); reintentar fotos lo vuelve a poner `IMPORTING` y mientras tanto otro reintento recibe 409 `ASSETS_IN_PROGRESS`. `HttpImageDownloader` sólo sigue http(s) a hosts públicos, con timeout de 15 s, dos reintentos ante fallas transitorias (no ante 404 ni tipos no permitidos), `image/jpeg|png|webp` y 10 MB. Con `TOKKO_SOURCE=fixture` el descargador devuelve un PNG de 1×1.
- **Por qué**: la URL viene de un sistema externo; sin el chequeo de host, un dato malicioso podría apuntar a la red interna.

### D-166 · Estado final del lote y fallas

- **Decisión**: `COMPLETED` si no quedó ninguna fila `ERROR` ni `FAILED`; si no, `PARTIAL` (incluso con cero importadas). `FAILED` es sólo para lo catastrófico (análisis imposible, error fuera de las filas). Las colas de la migración tienen `retryLimit: 0` (fotos: 1): un análisis que falla queda `FAILED` con motivo en vez de reintentarse en silencio. Un lote `IMPORTING` cuyo proceso se corta queda así (no hay recuperación automática): se vuelve a subir el archivo, y los vínculos hacen que sólo se importe lo que falta (A-131).

### D-167 · Auditoría

- **Decisión**: `ImportBatch` se audita por el diff automático (`MODEL_BEHAVIOUR`); `ImportRow`, `ImportLink` e `ImportAssetResult` no (staging y bitácora). Además se registran eventos `JOB_RUN` sobre `ImportBatch` al analizar, confirmar, terminar y descartar, con el `correlationId` de la confirmación en `changes` (las altas individuales comparten ese correlationId y quedan a nombre de quien confirmó, porque la cola restaura el usuario).
- **Por qué no `bulk_import`**: el rediseño habla de `@Audit('bulk_import')`, pero ese decorador no existe y una acción nueva exige migrar el enum `AuditAction` y tocar la pantalla de auditoría del frontend. `JOB_RUN` ya está soportada en el filtro y en el resumen.

### D-168 · Limpieza de lotes vencidos como un job más de la Fase 13

- **Decisión**: `migration.discard-stale-batches` (03:30, alcance por inmobiliaria) en el catálogo de automatizaciones; usa `MigrationFacade.discardStaleBatches`. Cuenta desde `created_at` (no desde la última edición de una fila). `test/automations.e2e-spec.ts` pasa de 11 a 12 jobs.

### D-169 · Configuración de Tokko

- **Decisión**: `TOKKO_SOURCE=fixture|http` (default `fixture`) y `TOKKO_API_KEY`, ambas opcionales y documentadas en `.env.example`. La key **no** se valida al arrancar (Doppler la tiene vacía hasta tener la de Oppido): con `http` y sin key, el análisis falla con «Falta configurar la API key de Tokko (TOKKO_API_KEY) en el servidor».

### D-170 · Dos ajustes de forma a `migration.ts` (aditivos)

- `ImportBatchDetail.errorMessage` (el motivo de un lote `FAILED`; la pantalla no tendría de dónde sacarlo) y `ImportRowDto.conflict` sin el `kind` interno. No rompen al frontend actual. Anotado para que lo sume a `migration.ts` cuando regenere tipos.

### D-171 · `needsReview` en propiedades

- **Decisión**: columna `properties.needs_review`; aparece en el resumen de propiedades, se filtra con `GET /properties?needsReview=true` y se puede cambiar con `PATCH`. Cambiar la ubicación (o pasarlo a `false`) la limpia sola. La marca la pone sólo la migración (el alta manual nace en `false`).

### D-172 · Tablero de la plantilla

- **Decisión**: los desplegables cubren 5.000 filas; tipo de propiedad y ubicación son listas **abiertas** (se admiten valores nuevos, que se crean al confirmar); las enumeraciones (moneda, índice, frecuencia, modalidad, tipo de garantía) son cerradas. La hoja `Listas` se regenera en cada descarga con los maestros del tenant.

### Supuestos a confirmar con Micaela (Fase 21)

- **A-125** · Un garante sin tipo ni detalle de garantía se carga como «Recibos de sueldo» con el detalle «Importado sin detalle: completar». _Si prefieren rechazar la fila_: volver el detalle obligatorio en el validador.
- **A-126** · Un contrato sin índice de aumento queda manual y anual. _Si prefieren que sea obligatorio_: marcar la columna `required` en la plantilla.
- **A-127** · Un contrato con fin pasado se carga `FINISHED` sin cuotas ni saldo (A-74 del rediseño). _Si Micaela quiere saldo inicial por contrato_: columna «Saldo inicial» con un cargo de apertura.
- **A-128** · Tokko: el precio de publicación es el primer precio en ARS/USD de la operación de alquiler; la descripción pública es título + descripción (recortada a 2000).
- **A-129** · La muestra de Tokko (`src/platform/tokko/fixtures`) está armada a mano con la forma de `property/search` que usa el mapper: el repo no trae las muestras que genera `tokko_scraper.js`. **Confirmar el mapeo en la primera corrida con la key de prueba** (`tokko-mapper.ts` es el único lugar a corregir).
- **A-130** · Pasada la cantidad máxima de fotos por propiedad (20), las que sobran fallan con el mensaje de la regla y se pueden ver en el reporte.
- **A-131** · Un lote `IMPORTING` interrumpido no se recupera solo; se vuelve a analizar el mismo archivo y sólo se importa lo que falta.

---

## Fase 24

Sale de `adminprop-repo-files/docs/REDISENO_FASE_24.md` (que numera sus supuestos A-60 a A-69 y se implementaron tal cual) y de `shared-types/valuation.ts`. Rama `feature/fase-24-tasacion`, encadenada sobre la Fase 21. Estas decisiones llegaron a la integración en `integration/consolidado-6` (cherry-pick de los commits de documentación); los números D-173 a D-182 estaban reservados y no chocan con nada.

### D-173 · Los datos de mercado no llevan tenant

- **Contexto**: los avisos de alquiler son del mercado, iguales para todas las inmobiliarias; la tasación sí es de cada una.
- **Decisión**: `market_comparables`, `valuation_zones` y `valuation_source_states` no tienen `tenant_id` ni auditoría (`tenantScoped: false, audit: false` en `auditable-models.ts`, documentado en el test de modelos con tenant); los escribe el job global y cada fila dice cuándo se vio. `valuation_requests` es tenant-scoped, auditada y sin borrado. `valuation_zones.requested_count` cuenta cuántas veces se pidió (no cuántos tenants, como decía el rediseño) y se agregó `valuation_source_states` (no estaba en el rediseño) para guardar entre corridas el bloqueo y las fallas seguidas.
- **Por qué**: compartir el caché abarata el scraping y no filtra nada de ninguna inmobiliaria; el resto sigue aislado por tenant.

### D-174 · Zona de mercado por nombres y categoría por sinónimos

- **Decisión**: `zone_key` = slug de los nombres de la jerarquía de ubicaciones del tenant sin el país (`caba/palermo`); la zona padre es la clave sin el último tramo, y la etiqueta son los dos últimos nombres. El tipo de propiedad se mapea a `MarketCategory` con una tabla de sinónimos en código; lo no reconocido es `OTHER` y no se descubre para refrescar. Una ubicación sin nombres usables da 422 `VALUATION_NO_ZONE`.
- **Por qué**: las ubicaciones y tipos son por inmobiliaria y el caché es global; el nombre es lo único que comparten.

### D-175 · Fuentes detrás de un puerto; la simulada es el default

- **Decisión**: `ComparableSourcePort` con `FakeComparableSource` (default, `COMPARABLES_SOURCES=fake`) y una fuente por portal. `env.validation` rechaza fuentes desconocidas y **rechaza `fake` en producción**. Cero scraping real en CI.
- **Por qué**: que datos inventados no lleguen jamás a una tasación real.

### D-176 · Redondeo para mostrar: centena en pesos, decena en dólares

- **Decisión**: el DTO trae el valor exacto en `suggestedPrice` y `suggestedPriceRounded` redondeado a 100 (ARS) o a 10 (USD). El rediseño decía «centena» sin distinguir moneda; 100 dólares sería un salto enorme.

### D-177 · Detalles del cálculo que el rediseño no fijaba

- **Decisión**: en base por m², un aviso sin superficie o con más de 35 % de diferencia **no entra y no cuenta como descartado** (no es un atípico, es no comparable); `discarded` son sólo precios ≤ 0 y atípicos por IQR (con 5 o más candidatos). Peso por ambientes: +0,5 si son iguales, +0,25 si difieren en uno, 0 si no. El percentil ponderado devuelve el primer valor que supera el peso objetivo y, si lo iguala, el promedio con el siguiente. Se toman a lo sumo los 500 avisos vistos más recientemente. La ampliación a la zona padre incluye sus descendientes. Las constantes son exportadas de `valuation-policy.ts`.
- **Por qué**: los descartes deben informar sólo lo que el usuario entiende como «precio atípico»; el resto quedaba ambiguo.

### D-178 · El redactor sólo ve hechos ya calculados

- **Decisión**: `ValuationNarratorPort` recibe `ValuationFacts` (números, etiqueta de zona, confianza) y nunca dirección, propietario ni datos de la ficha. `LlmNarrator` (`VALUATION_NARRATOR=llm` y `ANTHROPIC_API_KEY`; Anthropic por HTTP, sin SDK nuevo, timeout 15 s, modelo `VALUATION_LLM_MODEL`) limpia el texto (HTML, enlaces, markdown, tope 700) y lo descarta si menciona una cifra que no está entre los hechos, si viene vacío o si falla la llamada; queda la plantilla. `engine = STATISTICAL_LLM` sólo si se usó el texto del modelo. Con `llm` y sin clave se avisa en el arranque y se usa la plantilla.
- **Nota**: en la rama original los comentarios del código citaban esta regla como «A-70» (número que ya usa el rediseño de la Fase 21); en la integración se corrigieron a D-178.

### D-179 · Límite diario y reutilización

- **Decisión**: el límite es `VALUATION_DAILY_LIMIT` (default 30, configurable en vez de la constante del rediseño) y se cuenta en **ventana móvil de 24 h**, no por día calendario. Una tasación idéntica (sha-256 del sujeto, moneda, zona y categoría) en las últimas 6 h se devuelve con `reused: true`, con status 201, y no cuenta contra el límite: la reutilización se resuelve antes del chequeo del límite. La zona se registra (`touch`) antes de calcular, aunque falten datos.
- **Por qué**: la ventana móvil evita el reinicio a medianoche; registrar la zona asegura que el próximo refresco cubra lo que se pidió.

### D-180 · Refresco global, estado de las fuentes y aviso de rotura

- **Decisión**: job `valuation.refresh-comparables` (global, 03:00, catálogo de la Fase 13): descubre las zonas de las propiedades disponibles de cada tenant (categoría distinta de `OTHER`) y refresca hasta `VALUATION_ZONES_PER_RUN` zonas con más de 24 h. Por fuente: la bloqueada (`blocked_until`) se saltea; ante bloqueo o parser roto se corta **esa fuente** para el resto de la corrida y las demás siguen. Una corrida sin datos, bloqueada o con error suma una falla; con datos, las borra. 3 fallas seguidas generan `COMPARABLES_SOURCE_STALE` (una vez por día y fuente, sólo a inmobiliarias que tasaron en los últimos 30 días). Resultado del job: `SKIPPED` sin fuentes activas, `FAILED` si todas las que corrieron fallaron, `PARTIAL` si alguna falló o hay obsoletas, `SUCCEEDED` si no. Lo no visto en 30 días se da de baja. La corrida manual (`POST /valuation/zones/refresh`, admin) es un `AsyncJob` por cola con `retryLimit: 0`.
- **Por qué**: no insistir contra un bloqueo ni contra un parser roto; que una rotura silenciosa no pase meses desapercibida.

### D-181 · Portales sin validar contra los sitios reales

- **Decisión**: las URL de búsqueda y los selectores de los tres parsers se escribieron contra fixtures HTML hechos a mano (`test/fixtures/valuation/`), **no contra los sitios reales**. Una página sin tarjetas que no diga que está vacía, o con más de la mitad sin precio o id, es `PARSE_ERROR`, nunca «0 comparables». Cortesía en `PageFetcher`: `User-Agent` con contacto (`VALUATION_SCRAPER_CONTACT`; el default `contacto@adminprop.example` es un marcador: antes de la primera corrida real hay que definir un contacto real de la inmobiliaria o del producto), `robots.txt` (caché 24 h), una request cada 2,5 s por dominio, un reintento con backoff de 10 s ante 403/429 y después bloqueo de 24 h. La primera corrida con fuentes reales es supervisada y los términos de uso de cada portal se revisan antes con Giuliano (A-62).

### D-182 · pg-boss: las colas se declaran de a una

- **Contexto**: varios consumidores arrancando juntos llamaban a `createQueue` en paralelo y Postgres entraba en deadlock, abortando el arranque de la app (se vio en el e2e de tasación, al sumar la cola `valuation-refresh-zone`).
- **Decisión**: `PgBossQueueAdapter.declare` encadena las declaraciones en una promesa (`declareChain`), de modo que se creen secuencialmente; el error de una no frena a las siguientes. Las llamadas repetidas con el mismo nombre siguen compartiendo la misma promesa.
- **Por qué**: el arranque es una sola vez y la lista de colas es corta; serializar cuesta milisegundos y elimina el deadlock para todos los módulos, no sólo para este.

### Supuestos a confirmar con Micaela y Giuliano (Fase 24)

Los A-60 a A-69 están en el rediseño y se implementaron tal cual (motor estadístico, zona por nombres, sólo atributos del aviso, zonas pedidas o con propiedades, sin conversión de moneda, sin avisos individuales, límite diario, reutilización de 6 h, sólo alquiler, superficie y ambientes en el request). Lo que queda abierto:

- Contrastar el rango y los pesos con tasaciones reales de Micaela (D-177).
- Los términos de uso de los portales y la primera corrida supervisada (D-181, A-62).
- Si el límite de 30 por día debe ser por plan cuando existan planes (D-179).

---

## Fase 23 — CRM y multipublicación (sin supervisión, rediseño)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_23.md` (que numera sus supuestos A-80 a A-89 y se implementaron tal cual) y del contrato `shared-types/crm.ts` y `listings.ts`. Acá van las decisiones de implementación (D-183 a D-194) y los supuestos que el rediseño no definía (A-150 a A-157). Detalle en `docs/tecnica/fase-23.md`. **Los tests (unitarios y e2e) están escritos pero no se corrieron**, y el adapter de Mercado Libre no se probó contra el servicio real (A-86).

### D-183 · El módulo `crm` es dueño de las consultas (A-80)

- **Decisión**: la tabla sigue llamándose `public_inquiries` y el modelo de Prisma `PublicInquiry`, pero la entidad (`Inquiry`) vive en `src/modules/crm`. El portal público crea la consulta con `CrmFacade.registerPortalInquiry` y cuenta el límite de spam con `countRecentInquiries`; conserva su evento `PublicInquiryCreatedEvent` y los avisos de la Fase 22. Se retiran `GET /inquiries` y `PATCH /inquiries/:id/status` (y `PublicInquiryRepository`, `PublicInquiryViews`, el `InquiriesController`).
- **Migración** `add_crm_and_listings`: `status` se reemplaza por `stage` (`CLOSED` pasa a `CLOSED_LOST` con «Migrado de la Fase 22», A-81), se agregan los campos del CRM, `email` y `phone` pasan a ser opcionales con un `CHECK` (al menos uno, salvo las consultas de un portal, A-153) y se agrega `deleted_at` (borrado lógico; `externalId` se muta al borrar para liberar el único).

### D-184 · Orden del tablero entre vecinos

- **Decisión**: `board_position` es un `double precision`. Mover una tarjeta manda `beforeId` (queda arriba) y/o `afterId` (queda abajo); la posición es el punto medio. Sin vecinos, una tarjeta que cambia de columna va **arriba**, igual que las nuevas (`min - 1000`). Con la diferencia por debajo de `2e-6` se renumera la columna (1000, 2000…) y se recalcula (A-82). Un vecino que no es de la columna de destino es 422 `INVALID_BOARD_NEIGHBOUR`. No hay control de versión: gana la última escritura y la UI recarga la columna.

### D-185 · Línea de tiempo inmutable

- **Decisión**: `inquiry_activities` no se audita (es su propia traza), no se edita ni se borra y no tiene endpoints de cambio; las notas son actividades `NOTE`. Cada cambio de columna, asignación, seguimiento y edición de datos deja su actividad. `PropertyView` no se audita y `ListingChannelAccount` excluye los tokens del diff.

### D-186 · Tipos de aviso nuevos

- **Decisión**: `INQUIRY_FOLLOW_UP`, `INQUIRY_ASSIGNED` y `LISTING_CHANNEL_ERROR` entran al catálogo (solo `IN_APP`), a `ALERT_TYPES` y al enum del DTO de avisos. El catálogo pasa de 20 a 23 tipos (`test/notifications.e2e-spec.ts` ajustado). `NotificationsFacade.renderWhatsApp(key, valores)` resuelve la plantilla (override de la inmobiliaria o la de código) para el CRM.

### D-187 · `SecretBoxPort` (cifrado en reposo)

- **Decisión**: puerto en `src/platform/secrets` con un adapter AES-256-GCM (IV aleatorio, formato `v1.<iv>.<tag>.<cifrado>`). La clave es `APP_ENCRYPTION_KEY` (32 bytes en hex o base64, Doppler). Sin clave la app arranca y falla recién al cifrar o descifrar. Los tests usan una fija (`test/setup.ts`). Rotarla obliga a reconectar los canales (A-84).

### D-188 · Puerto de publicación, adapters y selección

- **Decisión**: `ListingPublisherPort` (dominio) con errores tipados `TokenExpiredError`, `ListingRejectedError { reasons }` y `ChannelUnavailableError`. `LISTING_PUBLISHER_PROVIDER=fake|mercadolibre` (default `fake`) elige el adapter del único canal con adapter (Mercado Libre). El simulado (`FakeListingPublisher`) se puede inyectar en los tests (`failNext('TOKEN_EXPIRED' | 'TOKEN_REJECTED' | 'REJECTED' | 'UNAVAILABLE')`, `simulateInquiry`). Zonaprop y Argenprop no tienen adapter: `GET /crm/channels` los devuelve `UNAVAILABLE` con el motivo y operar sobre ellos es 422 `CHANNEL_UNAVAILABLE`.
- Variables nuevas: `APP_ENCRYPTION_KEY`, `LISTING_PUBLISHER_PROVIDER`, `BACKOFFICE_BASE_URL` (a dónde vuelve el navegador) y, solo con ML, `MERCADOLIBRE_APP_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REDIRECT_URI`. Todas opcionales.

### D-189 · OAuth con `state` firmado

- **Decisión**: `POST /crm/channels/mercadolibre/connect` (admin) firma `{ tenantId, userId, channel, exp: +10 min }` con HMAC-SHA256 (clave derivada del secreto del JWT, comparación en tiempo constante). El callback es público (`@IsPublic`), verifica el `state`, entra al tenant del `state`, canjea el código y redirige a `<BACKOFFICE_BASE_URL>/configuracion/canales?connected=mercadolibre`. Un `state` vencido, manipulado o de otro canal es 400 `OAUTH_STATE_INVALID`; un canje fallido o un acceso denegado redirige con `?error=connect_failed` o `?error=denied`.

### D-190 · Publicar es un trabajo asíncrono

- **Decisión**: `POST …/publish` valida (422 `LISTING_NOT_READY` con la lista en `errors[]`, antes que 409 `CHANNEL_NOT_CONNECTED`), crea un `AsyncJob` `listing-publish`, deja la publicación en `PUBLISHING` (si ya estaba publicada o pausada es una _actualización_ y el estado no cambia) y encola en `crm-listing-publish` (`retryLimit: 0`: un fallo queda en la publicación y se reintenta a mano). El consumidor refresca el token si está por vencer (o si el portal lo rechaza, una vez); si no se puede renovar, el canal pasa a `ERROR` y se avisa (`LISTING_CHANNEL_ERROR`, una vez por canal y día). Pausar, reanudar y cerrar son síncronos. Un aviso cerrado no se reabre: publicar de nuevo crea uno nuevo.
- **Cierre al alquilarse (A-87)**: `PropertiesFacade.attachContract` publica `PropertyRentedEvent`; `crm` lo escucha y **encola** el cierre (`crm-listing-close`, 2 reintentos) para que un portal caído no frene el contrato.

### D-191 · Jobs del CRM en el catálogo

- **Decisión**: `crm.follow-up-reminder` (TENANT, 09:15) y `crm.pull-channel-inquiries` (TENANT, 08:00, 12:00, 16:00 y 20:00). El catálogo pasa de 13 a 15 jobs y el e2e del scheduler cuenta 13 jobs por inmobiliaria.

### D-192 · Vistas de la ficha

- **Decisión**: `PropertyViewsRecorder` cuenta en `property_views` (upsert con incremento por tenant, propiedad y día). Ignora `User-Agent` de bots y no cuenta dos veces la misma IP en la misma propiedad dentro de 30 minutos, con un hash (tenant, propiedad, IP) **solo en memoria** (se pierde al reiniciar y no se comparte entre instancias). La cuenta está dentro del handler de la ficha, ya en el tenant del slug, y nunca rompe la respuesta.

### D-193 · Errores nuevos

- **Decisión**: `ErrorCode.LISTING_NOT_READY`. Los demás son `DomainException`: `INQUIRY_NOT_FOUND` (404, también para una de otro tenant), `ASSIGNEE_INVALID`, `LOST_REASON_REQUIRED`, `INQUIRY_CONTACT_REQUIRED`, `INVALID_BOARD_NEIGHBOUR`, `ANALYTICS_RANGE_INVALID` (422), `CHANNEL_NOT_CONNECTED`, `LISTING_STATE_INVALID` (409), `LISTING_NOT_FOUND`, `TEMPLATE_NOT_FOUND`, `PROPERTY_NOT_FOUND` (404), `CHANNEL_UNAVAILABLE` (422) y `OAUTH_STATE_INVALID` (400).

### D-194 · Contrato

- **Decisión**: los DTOs siguen `shared-types/crm.ts` y `listings.ts`. Las fechas-hora salen como `string` ISO (se serializan `Date`) y `PropertyListingDto.canPublish` exige además que la cuenta esté conectada (A-155). `ConnectChannelResult` es `{ authorizeUrl }`.

### Supuestos a confirmar (Fase 23)

- **A-150** · Las consultas generales (sin propiedad) usan «nuestras propiedades» en `{{propertyAddress}}` del mensaje de WhatsApp; la variable `{{name}}` equivale a `{{recipientName}}`. _Si prefieren otro texto_: cambiarlo en `GetWhatsAppLinkHandler`.
- **A-151** · Los avisos `INQUIRY_ASSIGNED` e `INQUIRY_FOLLOW_UP` van a la campana compartida del personal (hoy el aviso interno es una sola fila para todos y el estado «leído» es común); el texto nombra a la persona. Un aviso por persona exigiría lectura por usuario.
- **A-152** · El recordatorio de seguimiento avisa **una vez por consulta y fecha de seguimiento** (clave `INQUIRY_FOLLOW_UP:<consulta>:<fecha>`), no cada día de atraso. Si se reprograma el seguimiento, avisa de nuevo.
- **A-153** · Las consultas que llegan de un portal (Mercado Libre, Zonaprop, Argenprop) pueden no traer email ni teléfono (ML solo entrega preguntas) y se contestan en el portal; para ellas no rige «al menos un contacto». La tarjeta muestra `hasWhatsApp: false`.
- **A-154** · El planificador es de granularidad diaria (`cronOf` arma una hora por día), así que `crm.pull-channel-inquiries` corre cuatro veces por día en lugar de cada 15 minutos. _Si hace falta más frecuencia_: extender el catálogo con un cron propio.
- **A-155** · `PropertyListingDto.canPublish` es verdadero solo si el canal tiene adapter, la cuenta está conectada y la propiedad está lista; `missingForPublish` lista solo lo de la propiedad.
- **A-156** · La publicación se cierra automáticamente solo cuando la propiedad se alquila por un contrato (`attachContract`). Un cambio manual del estado a «Mantenimiento» no la cierra. _Si lo quieren_: emitir el mismo evento desde el cambio de estado de propiedades.
- **A-157** · Una _actualización_ fallida de una publicación viva no la pasa a `ERROR` (sigue activa en el portal): conserva su estado y guarda `last_error`; el botón «Actualizar» sigue disponible. `ERROR` queda para publicaciones que nunca llegaron a estar vivas y para el cierre automático fallido.

## Auditoría de seguridad e integración: pendientes de backend

### D-195 · `RolesGuard` cierra por defecto

- **Decisión**: un handler autenticado sin `@Roles(...)`, `@AnyRole()` ni `@IsPublic()` (en el handler o en el controller) responde 403 `INSUFFICIENT_PERMISSIONS` a todos los roles. Antes dejaba pasar a cualquier usuario autenticado, incluidos `OWNER` y `RENTER`, que comparten tenant con la inmobiliaria. `@AnyRole()` (nuevo, en `auth/public`) es la excepción explícita: `auth/me`, `change-password`, `logout-all` y `GET /tenants/current`.
- **Red de seguridad**: `controllers-declare-access.spec.ts` recorre todos los `*.controller.ts` y falla si un handler no declara su acceso; `test/roles-default-deny.e2e-spec.ts` verifica el 403 de propietarios e inquilinos en `/migration`, `/crm` y `/valuation`.
- **Por qué**: un controller nuevo al que se le olvidara `@Roles` quedaba abierto (un inquilino subiendo un Excel de migración, un propietario leyendo las consultas del CRM).

### D-196 · Archivos privados con URL firmada

- **Decisión**: `UploadOptions.access: 'private'` sube a Cloudinary como `raw` + `authenticated`; la key lleva el tipo de entrega (`raw:authenticated:<public_id>`; las keys viejas de dos partes siguen valiendo). `StoragePort.signUrl(url, ttl?)` devuelve una URL de descarga firmada que vence (10 min por defecto) y deja pasar tal cual cualquier URL pública. Son privados: PDFs generados, PDFs de contratos y pólizas, comprobantes de pagos, honorarios, transferencias y gastos adelantados, y el Excel de migración.
- **Dónde se firma**: un único `SignedUrlsInterceptor` global firma toda URL `https://` de la respuesta JSON; los redirects y `?format=json` del portal, que responden con `@Res()`, firman en el controller. La base guarda la URL cruda del proveedor.
- **Fuera de alcance**: fotos de propiedades e inventarios y logo siguen públicos. Los archivos ya subidos siguen públicos hasta migrarlos (ver A-159).

### D-197 · Sobre `{ success, data }` documentado en `/auth/*`

- **Decisión**: `@ApiSuccessResponse(Modelo, descripción)` (`shared/dtos`) documenta el sobre con `data` tipado, y se aplica a `login`, `portal-login`, `refresh`, `logout-all`, `change-password` y `me`. No cambia ninguna respuesta real; sí cambia `openapi.json`, y con él los tipos que genera el frontend.

### D-198 · Logos SVG: se rechaza, no se sanea

- **Decisión**: `POST /tenants/current/logo` sigue aceptando SVG (lo usan los PDFs) pero rechaza con `TENANT_INVALID_LOGO` si trae `<script>`, `<foreignObject>`, `<set>`/`<animate>`, handlers `on*=`, `javascript:`, `href` que no sea `#id` o imagen `data:`, `@import`/`url()` externos, entidades declaradas o numéricas.
- **Por qué no sanear**: sanear obliga a parsear XML adversarial y a mantener una lista de permitidos; ningún logo legítimo necesita nada de lo rechazado.

### D-199 · Inyección de fórmulas en el reporte de migración

- **Decisión**: las celdas de texto del `report.xlsx` que empiezan con `=`, `+`, `-`, `@`, tab o CR llevan un apóstrofo previo.

### Supuestos a confirmar (auditoría)

- **A-158** · Default-deny estricto: un handler sin declarar da 403 incluso al ADMIN (no solo a propietarios e inquilinos). Elegido para que un olvido se note en el primer request y en el test de arquitectura, no en producción.
- **A-159** · Los archivos subidos antes de D-196 siguen con su URL pública permanente; no hay script de migración (`cloudinary.uploader.rename(..., { type: 'authenticated' })` más reescribir las keys). _Si lo quieren_: un script que recorra `generated_documents` y los `*_key` y los renombre. La descarga firmada usa el endpoint de API de Cloudinary y no se probó contra el servicio real: confirmar que el navegador abre el PDF en la pestaña y no lo baja.

## Sitio web de la inmobiliaria (generador de sitios)

Sale de `adminprop-repo-files/specs/web-inmobiliaria.md` (el contrato es la sección 5). Rama `feature/web-inmobiliaria-api`, desde `feature/fase-14-notificaciones`. Numeración renumerada en la integración `integration/consolidado-2`: estas decisiones nacieron como D-177..D-202 y A-137..A-148 (a continuación de la Fase 14) y chocaban con las de las Fases 21 a 25 y la auditoría; ahora son **D-200..D-225** y **A-160..A-171** (original + 23). Las ramas de auditoría y deuda técnica que citan los números viejos fueron renumeradas igual.

### D-200 · La validación del contenido es una política pura, no class-validator anidado

- **Contexto**: la spec pide validar con class-validator. El contenido son ~12 bloques anidados con arrays, claves cerradas, límites por campo y reglas cruzadas (fuente según template, secciones soportadas, imágenes propias).
- **Decisión**: el DTO solo exige que `theme` y `content` sean objetos; el detalle lo valida `validateSiteDraft` (`modules/site/domain/site-content.policy.ts`), una función pura que devuelve **errores por campo con ruta** (`content.faqs[2].answer`). Sale como 422 con `errors[]`, el mismo formato que el resto de la API. Las clases de `site.dtos.ts` existen para el OpenAPI.
- **Por qué**: una sola fuente de verdad testeable sin Nest (57 unitarios), claves de más rechazadas en cualquier nivel (class-validator con `whitelist` no recorre objetos planos) y mensajes en español por campo.

### D-201 · `PUT /site/settings` es parcial; dominios en el momento

- `template` se reemplaza; `theme` se mezcla campo a campo; en `content` **cada bloque** (`brand`, `hero`, `steps`…) que se manda reemplaza al anterior entero. El resultado se valida completo antes de guardar.
- `subdomain` y `customDomain` **no pasan por el borrador**: son de infraestructura y valen al instante (publicado o no). `null` los quita.
- Cambiar de template **no pisa el tema** (hay un endpoint aparte para restaurarlo, como pide la spec); sí corrige `fontKey` si el template nuevo no la tiene.

### D-202 · Dos niveles de validación: guardar y publicar

- Guardar acepta un borrador a medias (secciones visibles vacías, SEO vacío, contraste bajo) pero nunca texto con HTML, links o imágenes inválidas.
- **Publicar** exige además: SEO completo, ninguna sección visible sin contenido, destacadas a mano con al menos una propiedad existente y **contraste AA** (texto/fondo y texto/tarjeta ≥ 4,5:1; color principal/fondo ≥ 3:1). Reporta todos los problemas juntos.

### D-203 · `hasUnpublishedChanges` es `true` si nunca se publicó

- La spec dice "true si el borrador difiere de lo publicado". Sin publicación previa no hay con qué comparar: se informa `true` (hay todo por publicar) para que el botón Publicar nunca quede deshabilitado por error. La comparación ignora el orden de las claves.

### D-204 · Imágenes: solo propias o de hosts permitidos; sin SVG

- `POST /site/assets`: JPG, PNG o WebP detectados **por los primeros bytes** (no por extensión ni `Content-Type`), ≤ 5 MB, ≤ 12.000 px por lado, hasta 200 por inmobiliaria. **SVG se rechaza** (puede llevar scripts; el sitio no lo necesita). Se guardan en `site_assets` (tenant-scoped).
- Una URL de imagen en el contenido vale si está en los `site_assets` **de esa inmobiliaria**, es el logo del tenant o es `https` de un host de `SITES_ALLOWED_IMAGE_HOSTS` (vacío por defecto). La imagen de otra inmobiliaria no sirve.
- Las dimensiones se leen sin decodificar la imagen (`domain/image-info.ts`).

### D-205 · Resolución por host: caché corta y solo sitios publicados

- `GET /public/site-by-host?host=`: `<sub>.<SITES_BASE_DOMAIN>` (un solo nivel) o dominio propio, con **coincidencia exacta** (`www.foo.com` y `foo.com` son nombres distintos: el TXT solo prueba control de uno; si se quieren los dos, se cargan y verifican los dos). Solo resuelve sitios **habilitados y publicados** de inmobiliarias activas; todo lo demás es el mismo 404 `SITE_NOT_FOUND`.
- Caché en memoria: 30 s los aciertos, 10 s los fallos, tope de 5.000 entradas; se vacía al publicar, despublicar o cambiar un dominio. Con varias instancias, un cambio tarda como mucho el TTL.
- La consulta es la única de `site` sin tenant en el contexto (`prisma.unscoped`), igual que la de unicidad de subdominio/dominio, que cruza inmobiliarias a propósito.

### D-206 · Token de vista previa

- `GET /site/preview-token` devuelve `{ token, expiresAt }`. JWT HS256 de 15 min, con `typ: "site-preview"` y el `tid` de la inmobiliaria, firmado con **su propio secreto** (`SITES_PREVIEW_SECRET`, o derivado de `JWT_ACCESS_SECRET`). No sirve como access token ni al revés.
- `GET /public/:slug/site?preview=<token>` devuelve el **borrador** (aunque el sitio no esté publicado) con `Cache-Control: no-store` y `X-Robots-Tag: noindex`. Un token vencido, inválido o de otra inmobiliaria es el mismo 404 de siempre.

### D-207 · Auditoría por diff de columnas; el contenido no entra al historial

- `SiteSettings` está auditada con `draft` y `published` en `excludeFromDiff` (son JSON grandes que cambian en cada guardado). Quedan en el historial, con usuario y antes/después: `enabled` (publicar/despublicar), `publishedAt`, `templateKey`, `subdomain` y `customDomain`. No se agregaron eventos explícitos aparte: duplicarían la fila.
- `SiteAsset` no se audita (la fila es la traza).

### D-208 · Tipografías: pilas del sistema

- `fontOptions` son pilas de fuentes del sistema (`system`, `serif`, `humanist`, `rounded`), sin descargar fuentes: mejor Lighthouse, ninguna dependencia externa y nada que romper en el build. El sitio traduce cada `fontKey` a su pila de CSS.

### D-209 · Contenido inicial genérico

- Armado con nombre, color, teléfono, WhatsApp, dirección y email del tenant. El color de marca solo se usa si contrasta ≥ 3:1 con el fondo del template. Textos genéricos en voseo; **sin números inventados**: "números" y "testimonios" arrancan vacíos y ocultos; "nosotros" oculto; "contacto" visible solo si hay algún dato (si no, el sitio inicial no se podría publicar). Todas las imágenes en `null`: el sitio usa neutras propias.

### D-210 · Ampliaciones aditivas al contrato

- `GET /site/subdomain-availability?value=` (el editor verifica disponibilidad mientras se escribe).
- Listado público: `ids` (hasta 12, para las destacadas a mano), `bedrooms` y `bathrooms` (mínimos) además de `operation`.
- `PublicPropertySummary` suma `operation`, `rooms`, `coveredAreaM2` y `ageYears`; `areaM2` es la superficie total. `features` de la ficha suma ambientes, dormitorios, baños, superficies (incluida la descubierta, calculada) y antigüedad cuando están cargados.
- Nada de lo anterior cambia una respuesta existente.

### D-211 · Límites de tasa del sitio

- Las lecturas públicas del sitio las hace el servidor de `apps/sites`, que llega con **una sola IP**: 300 por minuto para `/public/:slug/site` y 600 para `site-by-host` (el portal tiene 60). Ver A-165.

### D-212 · Campos de propiedad (spec 4.3)

- Migración `add_property_listing_extras`: `listing_operation` (`SALE|RENT`, default `RENT`, así que las propiedades existentes siguen en alquiler), `bedrooms`, `bathrooms`, `rooms`, `age_years`, `total_area_m2`, `covered_area_m2` (`Decimal(10,2)`), `latitude`, `longitude` (`Decimal(9,6)`). Todos opcionales.
- Superficies y coordenadas son `number` en la API (no son dinero). Latitud y longitud se guardan y se devuelven en el backoffice, pero **no** salen en la API pública (no se usan en la v1).

### Supuestos (sitio web)

- **A-160** · Publicar **no exige** subdominio ni dominio propio. Sin ellos, `publicUrl` es la URL por slug (`<SITES_DEV_URL>/_s/<slug>`) en desarrollo y `null` en producción.
- **A-161** · ~~`www.<dominio>` y `<dominio>` abren el mismo sitio~~ **Revisado**: la coincidencia del host es exacta (D-205); `www.foo.com` y `foo.com` son dominios distintos y cada uno se verifica por separado.
- **A-162** · El dominio propio solo se **guarda** y se resuelve: el alta en el hosting y el DNS los hace una persona; no se verifica el DNS.
- **A-163** · Una propiedad destacada a mano que se borra después de publicar queda en el JSON publicado; el sitio la omite (la API pública no devuelve las no disponibles).
- **A-164** · Variables de entorno nuevas, todas opcionales: `SITES_BASE_DOMAIN`, `SITES_PROTOCOL` (`https` por defecto), `SITES_DEV_URL` (default `http://localhost:3003` fuera de producción), `SITES_ALLOWED_IMAGE_HOSTS`, `SITES_PREVIEW_SECRET` (**obligatoria en producción**, D-221). **Pendiente de Giuliano**: crearlas en Doppler (vacías) donde corresponda; sin `SITES_BASE_DOMAIN` solo funcionan dominios propios y el acceso por slug.
- **A-165** · En producción `TRUST_PROXY=true` y, si el servidor de `apps/sites` comparte IP con muchos visitantes, los topes de D-211 pueden ser chicos: revisarlos con tráfico real.
- **A-166** · Una inmobiliaria desactivada deja de resolver su sitio (404) aunque esté publicado.
- **A-167** · Máximos de longitud de campos que la spec no fijó (títulos de sección 120, textos de pasos 300, servicios 500, testimonios 600, respuestas 1500, SEO 70/200) y límite de 200 imágenes por inmobiliaria: elegidos como razonables, fáciles de cambiar en `SITE_LIMITS`.

### Segunda ronda de "Sitio web" (revisión del PR)

### D-213 · El dominio propio se verifica con un registro TXT

- **Problema**: cualquier ADMIN podía reservar el dominio de otro (`banco.com`) y bloquear a quien sí lo tenía con `DOMAIN_TAKEN`.
- **Decisión**: un dominio nuevo arranca **sin verificar**. La prueba es un registro TXT en `_adminprop-verify.<dominio>` con el valor `adminprop-verify=<HMAC-SHA256(tenant, dominio)>` (32 hex), calculado con el secreto del servidor: solo esta inmobiliaria puede conocerlo, y cambia si cambia el dominio. `GET /site/domain` devuelve el estado y el registro; `POST /site/domain/verify` lo busca (`DnsTxtPort`, `NodeDnsTxt`) y, si está, activa el dominio (422 `DOMAIN_NOT_VERIFIED` si no; 422 `NO_CUSTOM_DOMAIN` sin dominio).
- **Unicidad**: el índice único de `custom_domain` pasó a ser **parcial y solo sobre los verificados** (migración `add_site_domain_verification`, columna `custom_domain_verified_at`). Reservar sin verificar no bloquea a nadie; el que verifica primero se lo queda (409 `DOMAIN_TAKEN` al otro). Cambiar o quitar el dominio lo deja sin verificar.
- **Efecto en el resto**: `site-by-host` solo resuelve dominios verificados; `publicUrl` usa el dominio solo si está verificado (si no, el subdominio o la URL por slug).
- **Desarrollo**: `SITES_DOMAIN_VERIFICATION=false` da el dominio por verificado al cargarlo (default `true`). Los dominios que ya estaban cargados al migrar se marcan verificados (no hay cómo comprobarlos y cortar sitios publicados sería peor).
- **No cambia `SiteSettings`** (5.1): el estado de verificación va en endpoints aparte (`/site/domain`).

### D-214 · Aviso a `apps/sites` al publicar (`SiteRevalidationPort`)

Publicar, despublicar y verificar un dominio llaman a `POST <SITES_REVALIDATE_URL>/api/revalidate` con `Authorization: Bearer <SITES_REVALIDATE_SECRET>` y `{ slug }` (3 s de timeout). **No se espera ni falla el request** (`SiteChangeNotifier`: se dispara sin `await`, con el error logueado; antes el administrador esperaba hasta 3 s). Aplica a publicar, despublicar, verificar dominio y cambiar subdominio o dominio.

El puerto además **nunca lanza**: si la otra app no responde, se loguea y el sitio se actualiza solo al vencer su caché (60 s). Sin URL y secreto configurados no hace nada. Antes un cambio podía tardar hasta ~2 minutos en verse.

### D-215 · Auditoría del borrador: qué se tocó, sin el contenido

Guardar el borrador escribe un evento `UPDATE` («Sitio web: borrador guardado») con **los nombres** del template, los campos del tema y los bloques de contenido que cambiaron, nunca los textos. Complementa a D-207 (el JSON sigue fuera del historial automático).

### D-216 · Primer acceso concurrente

Dos pedidos simultáneos de `GET /site/settings` en una inmobiliaria sin configuración chocaban con el índice único de `tenant_id` y uno recibía un 500. `ensure()` ahora, si la creación falla, relee la fila (probado con 4 pedidos a la vez).

### D-217 · Texto sin caracteres invisibles ni de dirección

Se rechazan los espacios de ancho cero y las marcas/controles de dirección (`U+200B–200F`, `202A–202E`, `2060–2069`, `FEFF`) en todos los textos: sirven para disfrazar un texto o un link y nadie los escribe a propósito en un sitio.

### D-218 · Topes por minuto en las rutas costosas

`POST /site/assets`: 30 por minuto; `POST /site/domain/verify`: 20 por minuto (consulta DNS). Se suman al tope de 200 imágenes por inmobiliaria.

### D-219 · `SITES_DOMAIN_VERIFICATION` es un booleano de entorno

Se encontró al probar contra la API real: sin `@toBool()` el valor `"false"` (siempre llega como texto desde Doppler o un `.env`) se rechazaba al arrancar. Hay un test en `env.validation.spec.ts`.

### Supuestos (segunda ronda)

- **A-168** · No hay verificación de **subdominios** (son de Adminprop y el primero que los pide se los queda; ver A-160).
- **A-169** · Los dominios existentes al migrar se consideran verificados (D-213).
- **A-170** · Nuevas variables, todas opcionales: `SITES_DOMAIN_VERIFICATION` (default `true`), `SITES_REVALIDATE_URL` y `SITES_REVALIDATE_SECRET`. **Pendiente de Giuliano**: cargarlas en Doppler junto con las de A-164; el secreto tiene que ser el mismo que `SITES_REVALIDATE_SECRET` de `apps/sites`.
- **A-171** · La verificación consulta el DNS del servidor de la API (`dns.resolveTxt`): un TXT recién cargado puede tardar en verse por el caché del resolvedor.

### Revisión del PR (tercera ronda)

### D-220 · Las lecturas del sitio no cuentan contra el tope por IP cuando llega el secreto del servidor de sitios

- **Problema**: `apps/sites` pide en nombre de todos los visitantes de todas las inmobiliarias desde una sola IP. Con un tope por IP (60/min en el portal, 300/min en el sitio, 600/min en el host), el tope era **global a todos los sitios**: un bot contra un sitio dejaba sin servicio a los demás.
- **Decisión**: los endpoints marcados con `@SkipThrottleForTrustedServer()` se saltean el tope si el pedido trae el header `X-Sites-Secret` igual a `SITES_REVALIDATE_SECRET` (el mismo secreto compartido de la revalidación), comparado en tiempo constante (`sha256` + `timingSafeEqual`). Sin el header, o con un valor distinto, el endpoint se limita como cualquier lectura pública. Marcados: `GET /public/:slug/site`, `GET /public/site-by-host` y las tres lecturas del portal público que consume el sitio (`properties`, `properties/:id`, `filters`). **El contacto (`POST /contact`) no se marca**: sigue limitado (5 por hora por IP y por email contados en la base) y `apps/sites` le reenvía la IP real del visitante.
- **Por qué no `x-site-slug`**: lo puede mandar cualquiera, así que no protege nada.
- **Contra**: el secreto es una credencial más para rotar y quien lo tenga puede leer sin tope (solo lecturas públicas). Rotarlo requiere cambiarlo a la vez en la API y en `apps/sites`.
- Supera la parte de A-165 que decía que había que revisar los topes con tráfico real para el servidor de sitios (los topes por IP siguen valiendo para el resto de los clientes).

### D-221 · `SITES_PREVIEW_SECRET` obligatoria en producción y sin derivar de `JWT_ACCESS_SECRET`

- **Antes**: sin la variable se usaba `site-preview:<JWT_ACCESS_SECRET>`. Un secreto distinto para una cosa distinta es la regla de este backend (los JWT de acceso y de refresh ya tienen secretos separados), y además este secreto firma la **prueba de propiedad de los dominios** (D-213).
- **Ahora**: en producción `validateEnv` exige `SITES_PREVIEW_SECRET` de **32 caracteres o más** y la app no arranca sin ella. Fuera de producción hay un valor fijo de desarrollo (no derivado de nada).
- **Qué pasa al rotarla**: se invalidan los tokens de vista previa en curso (duran 15 minutos) y **cambia el valor TXT esperado de todos los dominios**. Los dominios que ya estaban verificados siguen verificados (queda guardada la fecha), pero los TXT que cada inmobiliaria cargó en su DNS dejan de coincidir: una re-verificación (D-222) los marcaría como caídos hasta que carguen el valor nuevo. Rotarla es una operación que se avisa a las inmobiliarias con dominio propio.

### D-222 · DEUDA: un dominio verificado no se vuelve a comprobar (revocación)

- **Estado**: la verificación (D-213) se hace una vez. Si después el dueño del dominio borra el TXT, vende el dominio o lo deja vencer, el sitio sigue respondiendo ahí y el dominio sigue reservado para esa inmobiliaria. **No está implementado**: hay que decidirlo con el dueño del producto porque implica estado nuevo y una política.
- **Diseño propuesto** (no construido):
  1. Migración: `custom_domain_checked_at` y `custom_domain_failed_checks` en `site_settings`.
  2. Un job diario (`@Cron`, como `refresh-token-cleanup.task.ts`; cada dominio con su propio try/catch y con tope de dominios por corrida) que consulta el TXT de cada dominio verificado con el mismo `DnsTxtPort`.
  3. **Tolerancia a fallas**: un DNS que no responde un día no es una revocación. Se cuenta cada falla y se revoca (`custom_domain_verified_at = NULL`, aviso interno al administrador y a `apps/sites`) recién a las **3 fallas consecutivas**; una comprobación correcta pone el contador en cero.
  4. Un endpoint de ADMIN (`POST /site/domain/recheck`) para comprobarlo a mano y, para el personal de Adminprop, una forma de revocar un dominio a pedido (soporte).
  5. Auditoría de cada revocación (con el valor esperado, sin secretos).
- **Interacción con D-221**: rotar `SITES_PREVIEW_SECRET` cambia el TXT esperado de todos los dominios; con revocación automática eso los revocaría a todos a los 3 días. Antes de rotarla hay que avisar a las inmobiliarias o aceptar ambos valores durante una ventana.
- **Mitigación hoy**: la unicidad solo cuenta dominios verificados y un dominio no verificado no resuelve, así que el riesgo se limita a un dominio que quedó "huérfano" en una inmobiliaria; el soporte puede liberarlo quitando el dominio de esa fila.

### D-223 · El caché de hosts es por instancia (hasta 30 s de diferencia entre instancias)

`SiteHostResolver` cachea en memoria de cada proceso (30 s los aciertos, 10 s los fallos). Con **varias instancias** de la API, publicar, despublicar, cambiar o verificar un dominio vacía solo la caché de la instancia que atendió ese request: las demás pueden seguir resolviendo la dirección anterior (o no resolviendo la nueva) **hasta 30 s**. Es aceptable para el caso de uso (un cambio de dirección no es urgente al segundo), pero conviene saberlo: no es un bug cuando dos pedidos seguidos dan resultados distintos. Si molesta, las salidas son un TTL menor, una caché compartida (Redis) o invalidar por evento entre instancias. `apps/sites` tiene además su propia caché de hosts (30 s) y la vacía con `POST /api/revalidate`.

## Sitio web v1.1

### D-224 · Orden del listado público: `sort` con `recent`, `price_asc` y `price_desc`

- **Contrato**: `GET /public/:slug/properties?sort=` acepta exactamente `recent` (por defecto), `price_asc` y `price_desc`; cualquier otro valor, incluso vacío o en mayúsculas, es 400. Cambio aditivo: sin `sort` el orden es el de siempre.
- **Dinero**: se ordena en la base sobre `listing_price` (`Decimal(14,2)`), nunca en memoria ni con `number`. Las propiedades sin precio ("Consultar") van **siempre al final**, en ambos sentidos (`nulls: last`).
- **Desempate**: precio, luego `createdAt` desc y por último `id`. Sin un orden total, la paginación puede repetir u omitir filas entre páginas. `recent` sigue siendo `createdAt desc, id`.
- **Límite conocido**: el orden compara montos nominales; mezclar ARS y USD no tiene sentido. El front debe combinar el orden por precio con `currency` (si hay `priceFrom`/`priceTo` sin moneda, ya se toma la de la inmobiliaria). No se convierte moneda en el backend: es una regla de negocio (cotización) que no está definida.

### D-225 · Tercer template `LUXURY`

- **Contrato**: `SiteTemplateKey` suma `LUXURY` (mayúsculas, como `CLASSIC` y `MODERN`). Tema por defecto: fondo `#0B0B0C`, superficie `#1C1A17`, texto `#F5F1E8`, primario dorado `#C9A961`, secundario `#8C8577`, fuente `serif`, esquinas 0. Fuentes disponibles: `serif`, `system`, `humanist`. Mismas secciones que los otros dos; el contenido inicial es el mismo.
- **Migración**: aditiva (`ALTER TYPE "SiteTemplateKey" ADD VALUE 'LUXURY'`); no toca filas existentes. No se puede revertir un valor de enum en Postgres sin recrear el tipo; es aceptable porque nada lo usa hasta que alguien elige el template.
- **Catálogo**: `GET /site/templates` (ya existía) lista ahora tres elementos; no hace falta un endpoint nuevo. El frontend debe tolerar claves desconocidas en `PublicSite.template` (un sitio publicado con `LUXURY` visto por un front viejo).
- **Código**: la validación y el fallback de tipografías usan `SITE_TEMPLATE_KEYS` en vez de un `=== 'MODERN'` fijo, para que un template nuevo no quede validado con las fuentes de CLASSIC.

### D-226 · Coordenadas en la ficha pública, con precisión reducida

- **Contexto**: `Property` ya guarda `latitude`/`longitude` (`Decimal(9,6)`, opcionales, se cargan por API en el alta y la edición). `apps/sites` las necesita para el mapa OpenStreetMap de la ficha. La spec `web-inmobiliaria.md` las menciona ("opcionales, no se usan en v1") pero **no dice qué precisión se publica**.
- **Decisión (supuesto a confirmar)**: `GET /public/:slug/properties/:id` suma `latitude` y `longitude` con **3 decimales (~100 m)**: la zona, no la puerta. Cambio aditivo; son `null` si falta alguna de las dos. El listado no las incluye. El valor exacto de 6 decimales no sale por ninguna ruta pública.
- **Por qué**: publicar el domicilio exacto de una propiedad ocupada por un inquilino es un dato personal del inquilino; la dirección ya se muestra, pero un pin exacto facilita ubicar la unidad. Si el dueño del producto quiere el punto exacto, se cambia `COORDINATE_FACTOR` en `public-property.views.ts`.
- **Pendiente**: la UI del backoffice debe permitir cargar las coordenadas (hoy solo la API las acepta). No se agregó geocodificación externa.

## Brechas de las respuestas de Micaela (rama `feat/micaela-brechas-backend`)

> Salen de `docs/VERIFICACION_RESPUESTAS_MICAELA.md` (repo `adminprop-repo-files`): cuatro puntos donde el código no cumplía lo que Micaela había pedido. Cada decisión lista sus **supuestos**; los que no son obvios son los que hay que confirmar con ella o con el dueño.

### D-227 · Devolución del depósito: el monto de referencia depende del modo del contrato (Micaela #1)

- **Antes**: `DepositReturnPolicy.assertBalanced` exigía `devuelto + deducciones = depósito recibido`. Con el modo "sigue al alquiler" y un alquiler que subió (depósito 200.000, alquiler 260.000, devolver 260.000) daba 400 `DEPOSIT_RETURN_UNBALANCED`; el modo era un dato que no gobernaba nada.
- **Regla ahora**: el depósito se registra por lo recibido y su moneda y **no se actualiza solo** (sin cambios). Al devolverlo, el modo del contrato fija el **monto de referencia**:
  - `FIXED`: lo recibido.
  - `FOLLOWS_RENT`: el alquiler vigente al cerrar (el "último mes"), si el alquiler y el depósito están en la misma moneda.
  - `MANUAL`: el que se indique al cerrar las cuentas (`referenceAmount`, obligatorio, mayor que cero; puede superar lo recibido).

  Las **deducciones justificadas** (deuda, daño u otro; descripción obligatoria, ya lo era) se descuentan de esa referencia y lo que queda es lo que se devuelve: `returnedAmount = referenceAmount - Σ deducciones`. Si las deducciones superan la referencia, 400 `DEPOSIT_RETURN_DEDUCTIONS_EXCEED`.

- **Contrato HTTP** (`POST /contracts/:id/deposit-return`): `returnedAmount` pasa a **opcional** (se calcula; si viene tiene que coincidir, si no 400 `DEPOSIT_RETURN_UNBALANCED`, que sigue existiendo con otro significado) y se suma `referenceAmount` opcional. En los modos automáticos, un `referenceAmount` que no coincide con el calculado es 400 `DEPOSIT_RETURN_INVALID_REFERENCE` (pantalla desactualizada, no una decisión). Los clientes que ya mandaban `returnedAmount` con el contrato en `FIXED` siguen funcionando igual.
- **Persistencia**: `deposit_returns.mode` y `reference_amount`; la migración rellena las devoluciones existentes con `FIXED` y `reference_amount = deposit_amount` (así cerraron).
- **Cuenta corriente**: los movimientos `DEPOSIT_RECEIVED`, `DEPOSIT_RETURNED` y `DEPOSIT_DEDUCTION` traen ahora `amount` y `amountCurrency` (antes iban sin importe). Siguen sin tocar el `balance` (el depósito no es deuda ni pago de alquiler). La deuda cubierta con el depósito sigue siendo un pago `DEPOSIT` sobre la cuota, que sí mueve el saldo. `suggestedReturn` devuelve `null` para `FOLLOWS_RENT` en otra moneda.
- **Supuestos**:
  1. **Alquiler en otra moneda que el depósito** (modo `FOLLOWS_RENT`): no se convierte (no hay cotización en una devolución, igual que las deudas D-83); hay que indicar el monto a mano. Se pidió coherencia con "no hay cotización" antes que inventar una.
  2. **Una sola devolución por contrato** (sin cambios): no hay devoluciones en partes ni diferidas.
  3. El modo que vale es el que tiene el contrato **al momento de devolver** (se puede cambiar con `PATCH /contracts/:id` antes); queda guardado en la devolución.
  4. Una deducción por daño/otro no genera deuda ni movimiento de saldo; sólo reduce lo devuelto.
  5. El ejemplo de Micaela (200.000 recibidos, alquiler 260.000) con `FOLLOWS_RENT` devuelve 260.000 aunque se hayan recibido 200.000: la diferencia sale de la inmobiliaria o del propietario, el sistema no dice de dónde (fuera de alcance).

### D-228 · Punitorio sin 5 % por defecto y "desde cuándo corre" configurable (Micaela #3)

- **Antes**: `Tenant.dailyLateFeePercentage @default(5)`; todo contrato sin % propio corría al 5 % diario y la inmobiliaria no tenía forma de cambiarlo. El "desde cuándo" era sólo `lateFeeGraceDays`.
- **Porcentaje**: la columna deja de tener default y pasa a **nullable** (`NULL` = "la inmobiliaria no fijó uno"). La migración **conserva los valores existentes** (todas las inmobiliarias actuales siguen con el que tenían, 5 si nunca lo tocaron).
  - **Al crear la inmobiliaria** (`npm run tenant:create`): `--late-fee-percentage` opcional; sin él nace sin punitorio por defecto (el script avisa). El seed de demo lo fija en 5 explícito.
  - **Al crear, renovar o cambiar los términos de un contrato**: si ni el contrato ni la inmobiliaria tienen un %, 400 `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED`.
  - **Editarlo**: `PATCH /tenants/current/settings` (admin) acepta `dailyLateFeePercentage` (0 a 100, 2 decimales; `0` = sin punitorio) y `paymentGraceDays` (0 a 60). `GET` los devuelve junto con `lateFeeStartDay`. Una vez fijado el %, **no se puede quitar** (`null` es 400 `TENANT_INVALID_BILLING_SETTING`): si no, los contratos que lo heredan quedarían sin valor. Cambiarlo afecta a las cuotas que se generen de ahí en más; las ya generadas conservan su snapshot (D-71).
- **"Desde cuándo corre"**: el contrato (alta y cambio de términos, también la renovación) acepta `lateFeeStartDay` (día del mes, 1 a 31) **en vez de** `lateFeeGraceDays`. Es lo mismo dicho al revés (inicio = gracia + 1: gracia 10 ↔ inicio el día 11), así que se guarda como gracia: **no hay columna nueva ni cambia ningún contrato existente** (default migrado = valor actual). Los dos juntos son 400 `CONTRACT_INVALID_BILLING_TERMS`. Los términos resueltos y la ficha exponen `lateFeeStartDay`.
- **Supuestos**:
  1. "Fecha desde la que comienza a aplicarse" se interpretó como **día del mes** (el alquiler es mensual), no como una fecha de calendario única. Una fecha absoluta (por ejemplo "el punitorio rige desde el 01/12/2026 para todo el contrato") no está construida: confirmar con Micaela si la quería así.
  2. El día de inicio no se guarda: se convierte a gracia al escribir. Un contrato cargado con `lateFeeStartDay: 16` se ve con `lateFeeGraceDays: 15`.
  3. Si falta el % en ambos lados en la **lectura** (no debería pasar: las altas lo exigen y el % del tenant no se puede borrar) la resolución cae en `0.00` en vez de fallar: sin punitorio antes que uno inventado. Los contratos **importados ya finalizados** (Fase 21) no pasan por la validación (son históricos).
  4. La migración de datos (Fase 21) de contratos **activos** hacia una inmobiliaria sin % por defecto falla por fila con ese error; hay que fijar el % antes.
  5. No se tocó "subir o fijar un monto / deshacer una condonación" (hallazgo 19, baja prioridad).

### D-229 · El modo de envío del consolidado lo leen los avisos (Micaela #7)

- **Antes**: `Owner.statementSendMode` y `OwnerStatement.sendMode` se guardaban pero **nadie los leía**: el mail de cada liquidación salía siempre y el del consolidado también.
- **Ahora**:
  - `SETTLEMENT_CONFIRMED` (aviso de cada liquidación) lee el `statementSendMode` **vigente del propietario**: con `SUMMARY` no sale.
  - `OWNER_STATEMENT_CLOSED` (aviso del consolidado) lee el `sendMode` del consolidado (el que se eligió al cerrar, por defecto el del propietario al abrirlo): con `RECEIPTS` no sale.
  - Al cerrar con `RECEIPTS` o `BOTH`, el consumidor **reenvía los comprobantes individuales que quedaron retenidos** (si el propietario estaba en `SUMMARY` al confirmar y al cerrar se eligió otra cosa). El evento `statement-closed` trae ahora la lista `settlements` (cambio aditivo del contrato de la cola; los mensajes viejos sin la lista se procesan igual). El `dedupeKey` de cada comprobante (`SETTLEMENT_CONFIRMED:<id>`) evita duplicar los que ya salieron.
- **Supuestos / límites**:
  1. El aviso individual sale **al confirmar** la liquidación, antes de que exista el consolidado; por eso se decide con el modo del **propietario**, no con el del consolidado. Consecuencia: si el propietario está en `BOTH`/`RECEIPTS` al confirmar y al cerrar se elige `SUMMARY`, los comprobantes **ya salieron y no se pueden retirar**. Para garantizar "sólo el resumen" hay que dejar al propietario en `SUMMARY`.
  2. Se omiten sólo los **emails** de estos dos avisos. Los PDF (Fase 15) se siguen generando y están disponibles en el portal del propietario; el modo no controla su descarga.
  3. Los dos avisos siguen siendo `critical` (no los frena el opt-out del destinatario); el modo es una elección de la inmobiliaria sobre lo que se envía, no una preferencia del propietario.
  4. Un propietario inexistente o borrado no bloquea el aviso (se trata como `BOTH`).

### D-230 · Ajuste manual del alquiler con motivo y autorizante obligatorios (Micaela #8)

- **Antes**: `POST /contracts/:id/rent-updates` con `newRent` guardaba el aumento como `MANUAL` y el usuario que lo aplicó, sin motivo ni quién lo autorizó.
- **Ahora**: todo monto a mano (los contratos `FIXED` sin %, `OTHER`, o un ajuste manual sobre `ICL`/`IPC`/`FIXED` con %) exige `reason` (hasta 500 caracteres) y `authorizedBy` (hasta 150): faltan o están en blanco → 400 `CONTRACT_MANUAL_ADJUSTMENT_JUSTIFICATION_REQUIRED` (con `metadata.field`) y no cambia nada. Se guardan en `contract_rent_updates.adjustment_reason` y `authorized_by` (nullable: los aumentos por índice, por % fijo, los del cron y los anteriores no los tienen) y salen en `rentUpdates[]` de la ficha.
- **Orden de validación**: primero que el contrato esté activo y que el aumento esté al día (409, D-60), después el monto y por último la justificación.
- **Supuestos**:
  1. `authorizedBy` es **texto libre** (puede ser el propietario, que no es usuario del sistema), no un id de usuario; el usuario que aplicó el cambio sigue en `appliedById`.
  2. ~~Quién puede hacerlo no cambió: ADMIN y EMPLOYEE.~~ **Reemplazado por D-234**: el ajuste manual es sólo de administradores.
  3. El aumento por `%` fijo automático no es "ajuste manual" y no pide motivo (el % ya está pactado en el contrato).

### D-231 · `X-Sites-Secret` vale con `SITES_SERVER_SECRET` o con `SITES_REVALIDATE_SECRET`

- **Antes**: la API comparaba el header solo contra `SITES_SERVER_SECRET` si existía (si no, contra `SITES_REVALIDATE_SECRET`). `apps/sites` manda su `SITES_REVALIDATE_SECRET` y no tiene variable propia para el otro: definir `SITES_SERVER_SECRET` lo dejaba limitado como cualquier visitante (429 a los 10 pedidos por segundo), y un sitio con tráfico dejaba sin servicio a los demás.
- **Ahora**: `sites.serverSecrets` lista los secretos definidos y no vacíos; `isTrustedServerSecret` acepta el header si coincide con cualquiera (hash SHA-256 + `timingSafeEqual`, recorriendo todos). Un header vacío nunca vale y una variable vacía no cuenta.
- **Por qué no tocar el frontend**: es otro repo; aceptar ambos desde la API es compatible hacia atrás y no reduce la seguridad (los dos son secretos compartidos con el mismo servidor).
- **Supuesto**: quien conozca el secreto de revalidar puede saltearse el tope de lectura (y al revés), como ya ocurría cuando `SITES_SERVER_SECRET` no estaba definida. Si se quiere separarlos de verdad, `apps/sites` tiene que leer una variable propia para el header.

### D-232 · Variables opcionales vacías equivalen a no definidas

- **Antes**: la regla del dueño es crear en Doppler las variables nuevas **vacías** (`doppler secrets set NAME=""`), pero un `*_PROVIDER`, `TOKKO_SOURCE`, `NODE_ENV`, `PORT`, `SECRETS_PROVIDER` o `JWT_*_TTL` vacío hacía que la API no arrancara.
- **Ahora**: `validateEnv` descarta las variables en blanco (también las de solo espacios) antes de validar, salvo `DATABASE_URL`, `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`, que siguen fallando con su mensaje. `configuration()` y `loadSecrets()` ya tratan el vacío como default. `SITES_PREVIEW_SECRET` vacía en producción sigue siendo error (32+ caracteres).

### D-233 · Depósito menor al alquiler con `FOLLOWS_RENT`: devolución mayor a lo recibido (pregunta abierta para Micaela)

- **Qué hace el código** (verificado en `src/modules/billing/domain` y su spec, sin cambios): con el modo `FOLLOWS_RENT` el monto de referencia de la devolución es el alquiler vigente al rescindir (D-227), no lo que se cobró de depósito. Si el depósito recibido fue menor que ese alquiler (por ejemplo, 1 mes de depósito y alquiler actualizado por ICL/IPC), el sistema calcula una devolución **mayor a lo recibido**.
- **Ya figuraba** como supuesto 5 de D-227; acá se eleva a pregunta abierta y se fija con un test (`deposit-return.follows-rent.spec.ts`).
- **Decisión**: **no se cambió**. Queda como supuesto y pregunta abierta.
- **Pregunta para Micaela**: ¿la devolución puede superar lo efectivamente recibido (la inmobiliaria o el propietario pone la diferencia), o hay que topearla en lo recibido? Hoy se paga el alquiler vigente completo.

### D-234 · El ajuste manual de alquiler es sólo de administradores (Micaela #8)

- **Decisión del dueño**: por ahora, cargar el alquiler a mano (`newRent`) lo puede hacer únicamente un ADMIN. Cierra el supuesto 2 de D-230.
- **Qué cambia**: `POST /contracts/:id/rent-updates` con `newRent` (un ajuste manual sobre ICL/IPC/FIXED, o el monto obligatorio de un contrato FIXED sin % u OTHER) devuelve **403** `CONTRACT_MANUAL_RENT_ADJUSTMENT_ADMIN_ONLY` si quien llama es EMPLOYEE. El rol viaja en `ApplyRentUpdateCommand.actorRole` (`@CurrentUser('role')`); el chequeo corre antes de leer el contrato, así el empleado no averigua el estado del contrato por los 409.
- **Sin cambios**: el aumento por índice o por % fijo (un empleado sigue pudiendo aplicarlo), el cron de aumentos (no pasa por este comando) y el resto de la edición del contrato (ADMIN y EMPLOYEE).
- **Supuesto**: en un contrato `FIXED` sin % u `OTHER`, un empleado no puede resolver el aumento vencido: tiene que pedírselo a un administrador (el aviso `RENT_UPDATE_PENDING` sigue llegando a todos).
- **Frontend**: el botón/campo de monto manual debería ocultarse para EMPLOYEE (hoy recibiría el 403).

### D-235 · Reporte de ingresos: cobrado por la inmobiliaria vs. percibido por el propietario (Micaela #9 y #10)

- **Antes**: `GET /reports/financial/income` sumaba `rentApplied`/`lateFeeApplied`/`chargesApplied` de todos los pagos confirmados, sin mirar `receivedBy`: un alquiler que cobró directamente el propietario aparecía como cobrado por la inmobiliaria.
- **Ahora** (aditivo, los campos viejos no cambian de nombre ni de significado): cada fila suma `collectedByReceiver: { agency, owner }`, cada uno con `rent`, `lateFees`, `charges` y `total` (= suma de los tres); y la respuesta suma `totals[]`, un total del rango **por moneda** (ARS, USD; nunca se mezclan) con `collected` (todo) y `collectedByReceiver`. `rentCollected`/`lateFeesCollected`/`chargesCollected` siguen siendo la suma de ambos. Las tablas exportadas (XLSX/CSV/PDF) agregan al final las columnas "Cobrado por la inmobiliaria" y "Percibido por el propietario".
- **Filtros** intactos: `from`/`to`; los pagos siguen entrando sólo confirmados (un cobro directo informado no es ingreso de nadie hasta confirmarse).
- **Supuestos** (no hay respuesta de Micaela):
  1. Un pago por **saldo a favor aplicado** (`kind = CREDIT_APPLICATION`) cuenta en el bucket de quien lo recibió, igual que al liquidar (D-84): el efectivo ya figuró como cobrado en su momento (sólo lo imputado cuenta, no el excedente), así que no se duplica. No se agregó una columna aparte para saldo aplicado.
  2. Un pago cubierto con el **depósito en garantía** (`method = DEPOSIT`) sigue contando como cobrado por la inmobiliaria; no se separa.
  3. Los **honorarios** (devengados/cobrados) y el neto no cambian: ya salen de liquidaciones y pagos de honorarios, que sólo incluyen fondos de la inmobiliaria.

### D-236 · Consolidado: retenciones, adelantos y otros ajustes por separado (Micaela #7)

- **Antes**: el consolidado mostraba una sola columna "Ajustes" (`adjustmentsTotal`) que mezclaba retenciones, adelantos y deducciones o créditos varios.
- **Ahora** (aditivo): `withholdingsTotal` (`WITHHOLDING`), `advancesTotal` (`OWNER_ADVANCE`) y `otherAdjustmentsTotal` (`OTHER_DEDUCTION` + `OTHER_CREDIT`), **con signo** como `adjustmentsTotal`, que se conserva y es la suma de los tres. Están en cada liquidación del listado (`SettlementSummaryDto`), en los totales por moneda del consolidado (`OwnerStatementTotalsDto`) y en el PDF del consolidado, que reemplaza la columna "Ajustes" por "Retenc.", "Adelantos" y "Otros aj.".
- **Persistencia**: tres columnas nuevas en `owner_statement_totals` (migración `20261108120000_statement_totals_adjustments_breakdown`, `DEFAULT 0`). Los totales se congelan al cerrar como antes; la migración reconstruye el desglose de los consolidados ya cerrados con los ajustes vigentes de sus liquidaciones. Las liquidaciones no guardan el desglose: se calcula al leer desde sus ajustes (`SettlementPolicy.adjustmentsBreakdown`).
- **Supuesto**: "otros" agrupa deducciones y créditos varios en un solo número neto; si Micaela quiere verlos separados hay que abrir un campo más.

### D-237 · Saldo a favor: aplicación automática o manual al generar la cuota (Micaela #6)

- **Antes**: el saldo a favor se aplicaba solo al **registrar un pago** (`applyCredit`, por defecto `true`) o a mano (`POST /installments/:id/apply-credit`). Al generar la cuota no se tocaba, así que si el saldo cubría la cuota entera había que aplicarlo a mano. No existía ninguna configuración manual/automático.
- **Ahora**: parámetro de la inmobiliaria `autoApplyCreditOnGeneration` (`PATCH /tenants/current/settings`, sólo ADMIN; `GET` lo devuelve). `false` (por defecto, no cambia nada) = manual; `true` = al generar una cuota, se aplica el saldo disponible del inquilino en la moneda del contrato, con la misma regla de siempre (los más viejos primero, hasta lo que debe la cuota; un pago `CREDIT_APPLICATION` por crédito usado). Lo hace `InstallmentCreditApplier`, que `InstallmentGenerator` llama **sólo con la cuota que `createIfAbsent` acaba de crear**: volver a generar el mes (o el cron) no duplica aplicaciones, porque las cuotas que ya existían no se tocan. `GenerationResult` suma `creditsApplied`.
- **Pago sin usuario**: el cron corre sin usuario, así que `payments.registered_by_id` pasó a ser **nullable** (migración `20261108130000_credit_auto_apply_on_generation`; el cron deja `null` = registrado por el sistema; el endpoint manual de generar deja al usuario). Los recibos y vistas ya toleran el nulo.
- **Eventos**: igual que la aplicación manual, se emite `PaymentConfirmedEvent` por cada aplicación, así que el saldo aplicado entra a la liquidación del propietario como cualquier pago de la inmobiliaria (D-84).
- **Supuestos** (sin respuesta de Micaela, quedan abiertos):
  1. El modo sólo gobierna la **generación**; el registro de un pago sigue aplicando el saldo por defecto (como hoy, `applyCredit` por pedido).
  2. Las cuotas de **cobro directo al propietario** (`OWNER_DIRECT`) no reciben aplicación automática: el saldo es plata que tiene la inmobiliaria y aplicarlo ahí movería fondos entre las dos cuentas sin que nadie lo decida. Se pueden aplicar a mano.
  3. Si no se puede aplicar (error inesperado), la cuota queda creada, se registra un aviso en el log y el resto de las cuotas sigue; el saldo queda para aplicar a mano.
  4. La fecha del pago de la aplicación es la de la generación (hoy), aunque la cuota sea de un mes futuro (pago anticipado, ya permitido).
  5. El modo es por inmobiliaria, no por contrato ni por inquilino.

### D-238 · Cuenta corriente del contrato: monto "por liquidar" al propietario (Micaela #8)

- **Antes**: la cuenta (`GET /contracts/:id/account`) mostraba lo cobrado, pero no cuánto de eso le corresponde todavía al propietario: había que ir a la sección de liquidaciones.
- **Ahora** (aditivo): `totals.pendingSettlement`, en la moneda del contrato. Es la suma, sobre los pagos **confirmados, recibidos por la inmobiliaria y sin `settlementId`**, de punitorio + alquiler + cargos del propietario aplicados (`TERMINATION_PENALTY` y `OTHER`; los `SERVICE` no, A-16). Incluye el saldo a favor aplicado (D-84) y excluye lo que cobró el propietario, lo sin confirmar y lo anulado. Es el mismo criterio de `listSettleable`: `settlementId` se escribe recién al **confirmar** la liquidación, así que "sin `settlementId`" equivale a "fuera de una liquidación cerrada" y la cuenta no necesita consultar `settlements` (que depende de `billing`).
- **Supuestos**:
  1. Es **bruto**: antes de honorarios, gastos y ajustes, que se definen al armar la liquidación. El neto a transferir sigue saliendo de la liquidación pendiente.
  2. "Cerrada" = confirmada (`CONFIRMED` o `TRANSFERRED`); una liquidación `PENDING` (borrador) todavía no cierra nada, así que sus pagos siguen contando como por liquidar.
  3. Se recalcula al leer, igual que el resto de la cuenta.

> **Numeración.** Las D-240 en adelante son de la rama `fix/datos-2-backend` (auditoría de datos, segunda pasada). Se saltó de la D-233 a la D-240 a propósito, para no chocar con las decisiones que sume en paralelo la rama `feat/brechas-micaela-2-backend`. Ya integradas las dos ramas: D-234..D-238 son de reglas de plata, D-240..D-245 de datos, y la D-239 queda vacía a propósito (no hay que renumerar nada).

### D-240 · Únicos nuevos detrás de una guardia de duplicados; sin único en `contract_billing_terms` ni `property_photos`

- **Contexto**: la auditoría (M7) lista únicos que el negocio da por sentados. Un `CREATE UNIQUE INDEX` sobre una tabla con duplicados falla a mitad del deploy con un mensaje que no dice qué filas.
- **Decisión**: una migración (`20261110120000_add_missing_unique_constraints`) corre primero un chequeo de los seis casos y, si hay duplicados, **aborta sin crear nada** con la lista de qué constraints están violadas y cuántas combinaciones. Todo en una transacción: quedan los seis o ninguno. Las mismas consultas se corren antes de desplegar con `npm run db:check-duplicates` (`-- --sql` las imprime). Lo cubre `test/unique-constraints.e2e-spec.ts` con datos sintéticos.
- **Por qué no una migración de diagnóstico que no rompa**: una que sólo avisa deja pasar el deploy y la siguiente falla igual; abortar con el mensaje completo es lo mismo con menos pasos, y el script previo evita llegar a ese punto en producción.
- **Únicos creados**: `contract_rent_updates(contract_id, effective_from)`, `renter_credits(tenant_id, origin_payment_id)` (reemplaza al índice común), `settlements(tenant_id, contract_id, period, sequence)`, `fee_payment_allocations(fee_payment_id, fee_receivable_id)`, y parciales `owners(portal_user_id)` / `renters(portal_user_id)` `WHERE portal_user_id IS NOT NULL`.
- **No se creó** `contract_billing_terms(contract_id, effective_from)`: la regla D-70 permite cargar dos veces la misma fecha ("corrige la fila del día; la más nueva manda") y un único la convertiría en un 409. **Tampoco** `property_photos(property_id, position)`: reordenar fotos intercambia posiciones y exigiría un único diferible; queda pendiente de una decisión sobre cómo reordenar.
- **Efecto visible**: el segundo aumento del mismo contrato y fecha (job con dos réplicas, doble click) pasa a ser un 409 `UNIQUE_CONSTRAINT_VIOLATION` en vez de una fila duplicada.

### D-241 · CHECK de bajo riesgo: `NOT VALID` y una validación que nunca tira el deploy

- **Decisión**: `20261110130000_add_check_constraints` agrega los CHECK como `NOT VALID` (lock instantáneo, protegen toda escritura nueva) y `20261110131000_validate_check_constraints` los valida con `VALIDATE CONSTRAINT`, que sólo toma `SHARE UPDATE EXCLUSIVE`. Si una fila vieja no cumple, la constraint queda `NOT VALID` y se emite un `WARNING` con su nombre (corregir las filas y correr `ALTER TABLE ... VALIDATE CONSTRAINT`); el deploy no se cae por datos viejos.
- **Qué se incluyó**: sólo reglas que el dominio ya hace cumplir (un CHECK más estricto convertiría un 422 en un 500) o intrínsecas: montos no negativos, `end_date > start_date`, porcentajes 0..100 de contratos y términos de cobro, períodos `AAAA-MM`, `remaining` y `paid_amount` dentro de su total, cotización siempre con su fuente.
- **Qué se dejó afuera**: porcentajes de `tenants`/`installments`/`late_fee_percentage` (los DTOs aceptan hasta 999,99; falta decidir el tope), días de `tenants` (no se editan por la API), la identidad de la imputación del pago y `confirmed_at`/`voided_at` (piden revisar datos históricos).

### D-242 · Índices de tablas grandes con `CONCURRENTLY`, uno por migración

- `payments(tenant_id, status, paid_at)`, `installments(tenant_id, grace_end_date) WHERE status <> 'PAID'` y `audit_logs(tenant_id, action, created_at DESC)`, cada uno en su migración de una sola sentencia (Prisma envuelve en transacción las de varias y `CONCURRENTLY` no corre ahí). `src/shared/prisma/concurrent-indexes.spec.ts` verifica que siga siendo una sola sentencia. Si una falla deja un índice `INVALID`: el comentario de cada migración dice cómo borrarlo antes de reintentar.
- No se tocaron `site_settings_custom_domain_verified_key` ni `job_executions_scheduled_slot_key`.

### D-243 · Registrar un pago: lock de la cuota, saldos dentro de la transacción e `Idempotency-Key`

- **Antes**: `balances` se calculaba antes de abrir la transacción. Dos pagos simultáneos sobre la misma cuota leían el mismo saldo y los dos lo imputaban entero (120.000 aplicados sobre 100.000, sin saldo a favor por el exceso).
- **Ahora**: la transacción toma `SELECT ... FOR UPDATE` sobre la cuota (`InstallmentRepository.lockForUpdate`), relee la cuota y recalcula saldos adentro; el segundo pago se imputa contra lo que dejó el primero y, si ya no queda nada, recibe 409 `INSTALLMENT_ALREADY_PAID`. `ApplyCredit` sigue el mismo orden. La verificación de "ya saldada" de antes de subir el comprobante se mantiene sólo como atajo (sin clave).
- **`Idempotency-Key`** (opcional, 1 a 128 caracteres imprimibles, sin espacios) en `POST /billing/installments/:id/payments`. Tabla `idempotency_keys(tenant_id, scope, key)` única, con `request_hash` (SHA-256 de cuota + cuerpo + comprobante) y `response` (los ids creados, no la respuesta: un reintento devuelve el estado actual de la cuota). La fila se inserta en la **misma transacción** que el pago con `INSERT ... ON CONFLICT`: dos pedidos con la misma clave en paralelo se serializan en el índice único y el segundo reproduce al primero. Misma clave con otro cuerpo: 409 `IDEMPOTENCY_KEY_REUSED`. Vence a las 24 h (una vencida vale como nueva; se purgan las del tenant de pasada en cada alta con clave, sin job). Si el pago falla no queda clave.
- **Reintento de un pago que saldó la cuota**: con clave se omite el atajo de "ya saldada", porque tiene que devolver ese pago y no un 409.
- **No cubierto**: el saldo a favor (`renter_credits`) se puede consumir en dos cuotas distintas del mismo inquilino a la vez; el lock es por cuota. Tampoco se tocaron anular/confirmar (ya tenían la condición de estado en el `UPDATE`), cargos ni ajustes de punitorio, ni recálculo de liquidaciones.

### D-244 · Dashboard: el historial se suma en la base

- El dashboard traía 6 meses de cuotas con cargos, pagos, ajustes y detalle diario sólo para sumar dos columnas por mes. Ahora `BillingFacade.reportRentTotals` hace un `GROUP BY (period, currency)` (suma el alquiler base y, por separado por cuota, el alquiler imputado por los pagos no anulados, para que un JOIN con varios pagos no multiplique) y `buildHistoryFromTotals` arma el mismo historial. Sólo el mes en curso sigue hidratado: sus estados y el punitorio a hoy salen de `InstallmentPolicy`, que no se duplica en SQL.
- **Contrato idéntico**, fijado por `test/dashboard-contract.e2e-spec.ts` (escrito antes del cambio, en su propio commit) y comparado contra el camino viejo. `countPaymentsToConfirm` ya era un `count`.
- **Pendiente** (otro módulo): `contracts.listDueForRentUpdate` (sólo se usa `.length`) y `expiringRows` (`listForReport` de todos los contratos) siguen cargando filas de más.

### D-245 · El soft delete dentro de una transacción escribe con el cliente de la transacción

- **Antes** (pendiente A2 de la auditoría): el `delete` convertido en `update` de `deletedAt` corría por `ref.extended`, fuera de la transacción: un rollback no lo deshacía, pedía una segunda conexión del pool mientras la transacción retenía la suya (P2024 con pocas conexiones) y el "registro actual" se leía sin ver lo creado por la propia transacción, así que no lo encontraba y el `delete` terminaba **borrando de verdad**.
- **Ahora**: `softDeleteExtension(ref, { useTransaction })` usa el cliente de la transacción en curso para la lectura y la escritura derivadas, con el mismo criterio que la auditoría (sólo el cliente con filtro de tenant). Lo cubre `test/soft-delete-transaction.e2e-spec.ts` (4 de sus 6 casos fallan sin el arreglo).

### D-246 · CORS permite el header `Idempotency-Key`

- **Problema**: `allowedHeaders` de `app.setup.ts` listaba sólo `Content-Type`, `Authorization`, `x-correlation-id` y `x-request-id`. `Idempotency-Key` (D-243) no es un header "simple", así que el navegador hace preflight y, sin permiso, el POST de registrar un pago no sale: el usuario ve un error de red.
- **Ahora**: `Idempotency-Key` está en la lista. El controller lo lee con `@Headers('idempotency-key')`; Express baja a minúsculas todos los nombres, así que el match no depende de cómo lo escriba el cliente.
- **Sin cambios**: los orígenes permitidos (`CORS_ORIGINS`) y el cierre por defecto. Un origen no listado sigue sin recibir `Access-Control-Allow-Origin`, que es lo que el navegador usa para bloquear.
- **Test**: `test/cors.e2e-spec.ts` (preflight desde un origen permitido y desde uno ajeno).

### D-247 · Una violación de CHECK de Postgres (23514) es un 422, no un 500

- **Problema**: los CHECK de la migración `20261110130000` (D-241) rechazan datos inválidos en la base, pero Prisma los entrega por caminos que el filtro no reconocía y caían en `DATABASE_ERROR` 500: el ORM los devuelve como `PrismaClientUnknownRequestError` (sólo con el SQLSTATE dentro del mensaje) y el SQL crudo como `P2010` con `meta.code = '23514'`.
- **Ahora**: `PrismaExceptionFilter` (donde ya se mapea `P2002` → `UNIQUE_CONSTRAINT_VIOLATION`) también atrapa `PrismaClientUnknownRequestError` y reconoce el CHECK en los tres caminos (`P2010` con 23514, `P2004` y el error desconocido con 23514 o "violates check constraint"). Responde **422** con `code: CHECK_CONSTRAINT_VIOLATION` (nuevo en `ErrorCode` y en `openapi.json`).
- **Mensaje**: genérico en español ("Los datos no cumplen una regla de validez…"), igual en producción y en desarrollo. El mensaje de Postgres trae el nombre de la constraint, la tabla y la fila completa, así que no sale en la respuesta; queda sólo en el log.
- **Supuesto**: es un 422 y no un 400 porque el pedido estaba bien formado y es la regla de datos la que lo rechaza; el dominio ya valida casi todo esto antes, así que llegar acá es un hueco de validación a cerrar, no un caso normal.
- **Sin cambios**: cualquier otro error desconocido del ORM sigue siendo `DATABASE_ERROR` 500, y `P2002` sigue siendo 409.
- **Tests**: `prisma-exception.filter.spec.ts` (los tres caminos, sin fuga de nombres, los otros códigos intactos); `src/openapi-refs.spec.ts` sigue pasando.

---

## Revisión 2026-11-06 (`integration/consolidado-6`)

Arreglos de la revisión de performance, seguridad y deuda de las Fases 21 y 24 sobre `integration/consolidado-5`.

### D-248 · Las fotos del inventario son privadas

- **Contexto**: las fotos del inventario (Fase 25) se subían públicas: muestran el interior de la vivienda y el estado de las cosas del inquilino, y la URL de Cloudinary no vence.
- **Decisión**: se suben con `access: 'private'` (D-196) y salen firmadas por `SignedUrlsInterceptor`, igual que los comprobantes. Las fotos ya subidas siguen públicas hasta que se vuelvan a cargar; no se migran.
- **Frontend**: la URL firmada vence (`SIGNED_URL_TTL_SECONDS`); el backoffice no debe cachear `photo.url` más que eso (patrón `PrivateFileLink`: volver a pedir el inventario). Un privado se guarda como `raw` en Cloudinary: verificar en local que `<img>` lo muestre.

### D-249 · Los topes no se saltean por URL; `/health` sólo dice `status`

- **Contexto**: el `skipIf` global salteaba todo pedido cuya URL contuviera `/health`, query string incluida: `POST /auth/login?x=/health` probaba contraseñas sin ningún tope (OWASP H1). Además `GET /health` devolvía versión, entorno y uptime sin autenticación (H13).
- **Decisión**: `skipIf` sólo mira `THROTTLE_ENABLED`. Las probes `/health` y `/health/live` llevan `@SkipAllThrottles()` (los tres perfiles globales por nombre: `@SkipThrottle()` a secas sólo saltea `default`, que acá no existe). `/health/ready` consulta Postgres y queda con los topes globales por IP (10/s, 120/min): sigue pública porque la usan docker y el balanceador, que la pegan cada varios segundos. `GET /health` responde `{ status: 'ok' }`.
- **Infra**: si un orquestador pega `/health/ready` más de 10 veces por segundo desde una IP, que use `/health/live`.

### D-250 · Cuenta bloqueada: el mismo 401 que una contraseña incorrecta

- **Contexto**: el login de una cuenta bloqueada respondía 403 `ACCOUNT_LOCKED` con `lockedUntil` y sin pasar por bcrypt: el código y el tiempo confirmaban que el email existe (OWASP H4), justo lo que el login evita en el resto de los casos.
- **Decisión**: responde 401 `INVALID_CREDENTIALS`, después de comparar la contraseña (resultado descartado: bloqueada no entra ni con la correcta). La auditoría sigue registrando `account_locked` y el log lleva `lockedUntil`. `ACCOUNT_LOCKED` queda en el catálogo de códigos (lo tipa el frontend) pero ya no se emite.
- **Costo**: el usuario bloqueado ve «Email o contraseña incorrectos» y no sabe que tiene que esperar 15 minutos; el mensaje del login del frontend puede sugerirlo de forma genérica («si fallaste varias veces, esperá unos minutos»).

### D-251 · `NODE_ENV` explícito y secretos JWT de ejemplo rechazados

- **Contexto**: sin `NODE_ENV` la configuración caía en `development` (Swagger prendido, valores fijos de desarrollo, sin las exigencias de producción): un despliegue que olvidara la variable arrancaba en modo desarrollo sin avisar (OWASP H9). Y `env.validation` aceptaba los secretos JWT de `.env.example` (`REEMPLAZAME...`, 32+ caracteres y públicos en el repo).
- **Decisión**: `validateEnv` falla si `NODE_ENV` falta o está vacía, salvo dentro de jest (`JEST_WORKER_ID`). Los scripts locales (`start`, `start:dev`, `start:debug`, `seed:demo`) la fijan en `development` con `scripts/with-node-env.cjs` sólo si no viene de Doppler (la sintaxis `NODE_ENV=x cmd` no anda en Windows y así no se suma `cross-env`); `openapi:export` también. El Dockerfile, `docker-compose.yml` y el CI ya la definen. Los secretos JWT que empiezan con `REEMPLAZAME` (sin importar mayúsculas) se rechazan fuera de `NODE_ENV=test`.
- **Costo**: `node dist/main` a mano sin `NODE_ENV` ya no arranca; está en `docs/ARRANQUE_LOCAL_BACKEND.md`.

### D-252 · IP del cliente: `TRUST_PROXY_HOPS` y `X-Client-IP` sólo con el secreto de servidor

- **Contexto**: `trust proxy` estaba fijo en 1 salto y el throttle usaba `req.ips[0]`. Detrás de más de un proxy todos compartían la IP del último; y `apps/sites` y el BFF de sesión del backoffice piden desde su propio servidor, así que todos sus visitantes (y todos los logins) contaban como una sola IP (OWASP H5).
- **Decisión**: `TRUST_PROXY_HOPS` (0..10) fija los saltos confiables; sin ella, `TRUST_PROXY=true` equivale a 1 (lo de antes). La IP sale de `resolveClientIp` (`src/shared/infra/http/client-ip.ts`), que usan el throttle, el `RequestContext` (auditoría, logs, vistas) y el contexto de sesión: si el pedido trae un `X-Sites-Secret` válido (`SITES_SERVER_SECRET` o `SITES_REVALIDATE_SECRET`) y un `X-Client-IP` que es una IP, se usa ese; si no, `req.ip`. Sin el secreto el header se ignora.
- **Qué tiene que mandar el frontend** (pendiente, otra sesión):
  - `apps/sites`, en cada pedido server-side a la API en nombre de un visitante: `X-Sites-Secret: <SITES_SERVER_SECRET>` y `X-Client-IP: <IP del visitante>`, tomada según `SITES_CLIENT_IP_HEADER`/`SITES_TRUSTED_PROXY_HOPS` de su propio proxy (no del `X-Forwarded-For` crudo).
  - El BFF de sesión del backoffice/portal (`packages/session`, rutas de login, refresh y logout): los mismos dos headers, con la IP del navegador. Necesita el mismo secreto de servidor en su entorno (nunca `NEXT_PUBLIC_*`).
  - Sin estos headers todo sigue andando; sólo que el tope por IP y la auditoría ven la IP del servidor Next.

### D-253 · Tokko con la API real: sólo la inmobiliaria dueña de la key

- **Contexto**: `TOKKO_API_KEY` es global y de una cuenta concreta (la de Oppido). Con `TOKKO_SOURCE=http`, cualquier otra inmobiliaria que lanzara un análisis de Tokko importaba el stock de esa cuenta (F21 P1 / OWASP alto).
- **Decisión**: `TOKKO_TENANT_ID` (uuid) nombra a la única inmobiliaria que puede usar la key. `POST /migration/tokko/analyze` responde 403 `TOKKO_NOT_ENABLED` antes de crear el lote si el tenant no es ese (o si la variable falta), y `TokkoHttpSource` vuelve a chequearlo en cada lectura (el worker corre dentro del tenant del lote). Con `fixture` cualquiera puede probar la muestra.
- **Pendiente**: la versión por tenant (cada inmobiliaria carga su key, cifrada con `SecretBoxPort` como los tokens de los portales) necesita una columna o tabla nueva y la pantalla para cargarla; no entra en esta rama. Mientras tanto, migrar a una segunda inmobiliaria desde Tokko es cambiar `TOKKO_API_KEY` y `TOKKO_TENANT_ID` juntos, para una corrida a la vez.

### D-254 · Jobs globales: no los dispara cualquier inmobiliaria

- **Contexto**: `POST /automations/jobs/:job/run` dejaba a cualquier ADMIN de cualquier tenant correr los jobs `GLOBAL` (`indices.fetch`, `valuation.refresh-comparables`) sin límite: uno trabaja para todas las inmobiliarias y el otro scrapea los portales, con riesgo de bloqueo para todos.
- **Decisión**: el catálogo declara `tenantManualCooldownMinutes` por job global. Sin valor (`valuation.refresh-comparables`) → 403 `AUTOMATION_JOB_GLOBAL`. `indices.fetch` lo usa el botón «Traer ahora» de Configuración > Índices, así que sigue permitido con 30 minutos entre corridas contando las de todas las inmobiliarias y las programadas → 409 `AUTOMATION_JOB_COOLDOWN` si se pide antes. Los jobs por inmobiliaria no cambian.
- **Frontend**: en Configuración > Automatizaciones el botón de ejecutar de `valuation.refresh-comparables` ahora da 403; conviene ocultarlo (es el único `GLOBAL` sin corrida manual). El de índices muestra el mensaje del 409.
- **Pendiente**: `POST /valuation/zones/refresh` (D-180) sigue disponible para el ADMIN de cada inmobiliaria; no se tocó en esta rama.
- **e2e**: `test/valuation.e2e-spec.ts` («si todas las fuentes fallan…») ahora espera el 403 y encola el job con `JobScheduler`; **no se corrió** (no hay Postgres en esta sesión).

### D-255 · `state` del OAuth de un solo uso

- **Contexto**: el `state` firmado del OAuth de Mercado Libre valía 10 minutos y cuantas veces se quisiera, y el callback es `@IsPublic` (sin JWT). Quien viera un `state` (log, historial, Referer) podía volver al callback con el código de SU cuenta del portal y conectarla a la inmobiliaria del `state`.
- **Decisión**: cada `state` lleva un nonce aleatorio y el callback lo reclama una sola vez en `idempotency_keys` (scope `crm.oauth-state`, vence con el `state`; `IdempotencyService.claimOnce`, sin migración). Un `state` repetido es 400 `OAUTH_STATE_INVALID`, como uno manipulado. Además `code` y `state` ya no quedan en los logs (`redact-url.ts`).
- **Pendiente (necesita frontend y/o schema)**:
  - Atar el callback al usuario que lo inició: el callback debería redirigir al backoffice con `code` y `state`, y el backoffice completar con un `POST` autenticado (JWT) que compare `state.userId` con el usuario. Requiere una ruta nueva en el backoffice; no se hizo.
  - Rechazar una cuenta de Mercado Libre ya conectada en otra inmobiliaria: hace falta guardar el `user_id` de ML (columna nueva en `listing_channel_accounts`, aditiva) y una consulta entre tenants; hoy sólo se guarda el nickname (`accountLabel`), que puede faltar. No se hizo.

### D-256 · Vuelta del OAuth sin `BACKOFFICE_BASE_URL`

- **Contexto**: sin `BACKOFFICE_BASE_URL` el callback redirigía a `/configuracion/canales?...`, una ruta relativa que el navegador resolvía contra el host de la API.
- **Decisión**: sin la variable se usa el primer origen de `CORS_ORIGINS` (por convención el backoffice va primero, como en `docs/ARRANQUE_LOCAL_BACKEND.md`). Con `LISTING_PUBLISHER_PROVIDER=mercadolibre` fuera de `development`/`test` es obligatoria: el arranque falla si falta.

### D-257 · Performance: conteos en la base, altas en lote y punitorio por tramos

- **Hecho**: `workload()` y `ownersPendingStatement()` cuentan con `COUNT`/`GROUP BY` (B-P2); `replaceFeeDays` es un solo `createMany` con `tenantId` explícito, que la extensión de tenant igual valida fila por fila (B-P5); el aviso de servicios vencidos resuelve inquilinos en dos consultas (`ContractsFacade.renterIds`, B-P6); el rebase de cuotas filtra `period >= desde` en la consulta (B-P7).
- **Punitorio (B-P1)**: `lateFeeDays` recalcula el saldo impago sólo cuando la fecha cruza un pago, con la misma `outstandingRentOn`; la salida (días, bases, montos y redondeo) es idéntica por construcción, y un test la compara contra el cálculo día por día. Los tests de billing existentes pasan sin cambios.
- **Pendiente**: B-P3 (`reportPayments`) y B-P4 (hidratación del resumen) son cambios más grandes en reportes; no entran en esta rama.

### D-258 · Hallazgos de seguridad que quedan para el dueño

No se tocaron; son decisiones de producto o de alcance:

- **H20**: el EMPLOYEE ve/edita el CBU de los propietarios. Decidir si se restringe a ADMIN.
- **H15**: MFA y recuperación de cuenta (no existen).
- **H10, H12, H16, H19**: quedan como estaban en el informe OWASP, a decidir por el dueño.
- **OAuth ML**: la atadura del callback al usuario y el rechazo de una cuenta ya conectada en otro tenant (ver D-255).
- **Tokko por tenant**: la key propia de cada inmobiliaria (ver D-253).

### D-259 · Pago anulado ya liquidado: se revierte también el honorario (A-19) — a confirmar con Micaela

- **Contexto**: A-19 dice "la diferencia se descuenta en la próxima pendiente". Se descontaba el bruto del pago (alquiler + punitorio + cargos del propietario), pero el propietario había recibido el bruto menos el honorario: la inmobiliaria se quedaba con el honorario de un alquiler que no cobró, y si el inquilino volvía a pagar lo cobraba dos veces (revisión 2026-11-06, informe 01 crítico 2).
- **Decisión**: el honorario se devuelve. Con honorario descontado (`DEDUCTED`) el ajuste automático es `bruto − honorario atribuible a esa línea` (el de la cuota con todas sus líneas menos el de la cuota sin la anulada, mismo redondeo). Sin descontar, el ajuste sigue siendo el bruto y el honorario a cobrar de la liquidación (`SETTLEMENT_NOT_DEDUCTED`) baja en el honorario atribuible; si llega a cero se anula, y si ya se cobró más de lo que quedaría no se toca y queda `needsReview` (como al anular un pago con honorario cobrado).
- **Por qué esta**: es la que deja a los dos como si el pago no hubiera existido. La alternativa (la inmobiliaria se queda el honorario) cobra honorario sobre plata que nunca entró.
- **Escenario**: 100.000 al 5 % descontado, confirmada y transferida (95.000). Se anula: ajuste de −95.000. El inquilino vuelve a pagar 100.000: la pendiente queda en 100.000 − 5.000 − 95.000 = 0. Total: propietario 95.000, inmobiliaria 5.000.

### D-260 · Saldo a favor que tiene el propietario — a confirmar con Micaela

- **Contexto**: el exceso de cualquier pago nacía como saldo a favor, también el de un pago cobrado por el propietario (cobro directo). Al aplicarlo se creaba un `CREDIT_APPLICATION` "recibido por la inmobiliaria" que entraba a la liquidación: la inmobiliaria le transfería al propietario plata que nunca recibió (revisión 2026-11-06, crítico 3). D-237 sólo frenaba la aplicación automática al generar.
- **Decisión**: `renter_credits.held_by` (migración aditiva `20261111100000_renter_credit_held_by`, con backfill desde el pago de origen) guarda quién tiene la plata. La aplicación hereda ese receptor: si lo tiene el propietario no se liquida y devenga honorario como cualquier cobro directo (`OwnerDirectFeeReaction`). Un saldo que tiene el propietario sólo se aplica a cuotas de su mismo contrato; a otro contrato da 409 `CREDIT_NOT_AVAILABLE` (sería plata de un propietario cubriendo el alquiler de otro).
- **A confirmar**: si un saldo del propietario debería poder devolverse desde la inmobiliaria (hoy `refund` no mira `heldBy`) y si se quiere permitir moverlo entre contratos del mismo propietario.
- **Frontend**: la vista del saldo trae `heldBy`; conviene mostrar "lo tiene el propietario".
