# Autenticación

Módulo de auth propio, sin dependencias externas. Reemplaza a
`@grupo-centaurus/vulcan.heimdall.auth`, que se eliminó del template.

- **Access token**: JWT stateless, 15 minutos.
- **Refresh token**: JWT firmado con otro secreto, 7 días, persistido como hash
  y **rotado en cada uso** con detección de reuso.
- **Contraseñas**: bcrypt, costo 12.
- **Roles**: `ADMIN`, `EMPLOYEE`, `OWNER` y `RENTER`, un rol por usuario.
- **Multi-tenant**: cada usuario pertenece a una inmobiliaria, y el `tenantId`
  viaja en el access token. Ver [MULTI-TENANCY.md](MULTI-TENANCY.md).
- **Dos puertas** (Fase 4):
  - **Backoffice** (`ADMIN`, `EMPLOYEE`): email + contraseña. Su email es único
    en todo el sistema, así que el tenant sale del usuario.
  - **Portal** (`OWNER`, `RENTER`): slug de la inmobiliaria + email +
    contraseña + tipo. Su email es único dentro de la inmobiliaria y el rol: la
    misma persona puede ser propietaria en dos inmobiliarias. Son dos índices
    únicos parciales sobre `users.email` (D-16).
- **Sin registro público**: los usuarios salen del seed, de
  `npm run tenant:create` (el primer admin) y de `POST /users`.

---

## Endpoints

Todos cuelgan de `/api/v1/auth`.

| Método | Ruta               | Auth | Qué hace                                         |
| ------ | ------------------ | ---- | ------------------------------------------------ |
| POST   | `/login`           | No   | Inicia sesión en el backoffice (admin, empleado) |
| POST   | `/portal-login`    | No   | Inicia sesión en el portal (propietario, inq.)   |
| POST   | `/refresh`         | No   | Rota el par de tokens                            |
| POST   | `/logout`          | No   | Revoca el refresh token enviado (204 siempre)    |
| POST   | `/logout-all`      | Sí   | Cierra todas las sesiones del usuario            |
| POST   | `/change-password` | Sí   | Cambia la contraseña y cierra todas las sesiones |
| GET    | `/me`              | Sí   | Datos del usuario autenticado                    |

Los dos logins y el cambio de contraseña tienen rate limiting estricto: 5
intentos por minuto por IP (`THROTTLE_AUTH_*`). El refresh y el logout sólo el
límite global: el refresh token no se puede adivinar, y limitarlo cortaría las
sesiones de una oficina que sale por una sola IP (D-20).

### Portal

```
POST /api/v1/auth/portal-login
{ "tenantSlug": "demo", "email": "propietario@demo.local", "password": "…", "type": "OWNER" }
```

Responde lo mismo que `/login`. Inmobiliaria inexistente o deshabilitada,
puerta equivocada (un propietario por `/login`, un admin por el portal) y
contraseña incorrecta dan el mismo `401 INVALID_CREDENTIALS`.

### Gestión de usuarios (`/api/v1/users`, sólo `ADMIN`)

| Método | Ruta                    | Qué hace                                                 |
| ------ | ----------------------- | -------------------------------------------------------- |
| GET    | `/users`                | Admins y empleados, paginado; filtros `role`, `isActive` |
| GET    | `/users/:id`            | Uno                                                      |
| POST   | `/users`                | Alta, con contraseña inicial que define el admin         |
| PATCH  | `/users/:id`            | Datos y rol                                              |
| PATCH  | `/users/:id/deactivate` | Desactiva (no borra) y cierra sus sesiones               |
| PATCH  | `/users/:id/activate`   | Reactiva                                                 |
| PATCH  | `/users/:id/password`   | Resetea la contraseña y cierra sus sesiones              |

Sólo gestiona usuarios internos de la inmobiliaria del admin: un propietario,
un inquilino o alguien de otra inmobiliaria responde 404. Nadie puede cambiarse
su propio rol, desactivarse ni resetearse la contraseña por acá; así una
inmobiliaria nunca se queda sin admin (D-22).

---

## Flujo del cliente

```
POST /api/v1/auth/login  { email, password }
  → { user, tokens: { accessToken, refreshToken, expiresIn } }

# En cada request:
Authorization: Bearer <accessToken>

# Cuando devuelve 401 con code TOKEN_EXPIRED:
POST /api/v1/auth/refresh  { refreshToken }
  → { accessToken, refreshToken, expiresIn }   ← guardá LOS DOS, el refresh cambió

# Cuando devuelve 401 con code REFRESH_TOKEN_EXPIRED o REFRESH_TOKEN_REUSED:
  → mandá al usuario al login
```

La regla que más se olvida: **el refresh token también cambia en cada
refresh**. Si el cliente guarda sólo el access token nuevo y sigue mandando el
refresh viejo, el próximo refresh se interpreta como reuso y le cierra todas las
sesiones.

---

## Proteger tus endpoints

`JwtAuthGuard` está registrado como guard **global**: todo requiere token salvo
lo que marques explícitamente. Es a propósito — olvidarte de proteger un
endpoint nuevo no debería ser posible.

```ts
import {
  CurrentUser,
  IsPublic,
  Roles,
  Role,
  AuthenticatedUser,
} from '@/modules/auth/infrastructure'

@Controller({ path: 'propiedades' })
export class PropiedadesController {
  // Protegido: es el default, no hace falta decorar nada.
  @Get()
  listar(@CurrentUser() user: AuthenticatedUser) { ... }

  // Sólo el id, sin traer el objeto entero.
  @Get('mias')
  mias(@CurrentUser('id') userId: string) { ... }

  // Abierto sin token.
  @IsPublic()
  @Get('publicas')
  publicas() { ... }

  // Restringido por rol. Alcanza con tener uno de los listados.
  @Roles(Role.ADMIN)
  @Delete(':id')
  borrar() { ... }
}
```

En un endpoint `@IsPublic()`, si igual llega un token válido el guard completa
`request.user`. Sirve para endpoints que devuelven más datos si estás logueado.

### Agregar roles

Están en dos lugares que tienen que coincidir:

1. `prisma/schema.prisma` → `enum Role`
2. `src/modules/auth/domain/enums/role.enum.ts` → `enum Role`

Agregá el valor en los dos y corré `npm run prisma:migrate`.

Si algún día necesitás **varios roles por usuario**, cambiá `User.role` por una
tabla intermedia `UserRole`. Lo único que hay que tocar además del schema es
`UserRepositoryImpl.toDomain()` y la comparación en `RolesGuard`.

---

## Decisiones de seguridad

Las que no son obvias leyendo el código:

### El login no revela si un email existe

Con email inexistente y con contraseña incorrecta se devuelve exactamente el
mismo `401 INVALID_CREDENTIALS`, con el mismo mensaje. Además, cuando el email
no existe se ejecuta un `bcrypt.compare` contra un hash descartable
(`PasswordService.burnCompare`): sin eso, la respuesta volvería mucho más rápido
y ese delta de tiempo alcanza para enumerar qué cuentas existen.

Una cuenta o inmobiliaria deshabilitada también responde ese mismo 401 (desde
la Fase 4; antes era un 403 que confirmaba que la contraseña era correcta). Y
se chequea **después** de validar la contraseña, para gastar el mismo tiempo.

### Rotación con detección de reuso

Cada refresh token se usa una sola vez. Al rotarlo, el viejo queda revocado
apuntando al nuevo (`replacedById`), y todos los de una misma cadena comparten
`familyId`.

Si llega un refresh token que ya fue rotado, hay dos posibilidades: el usuario
mandó dos veces el mismo, o alguien se lo robó. No se pueden distinguir, así que
ante la duda **se revoca toda la familia**. El atacante pierde el acceso y el
usuario legítimo tiene que volver a loguearse.

La excepción es la rotación concurrente (dos pestañas refrescando a la vez): eso
se detecta en la transacción de `rotate()` y devuelve `REFRESH_TOKEN_INVALID`
sin tirar abajo la familia.

### Se guarda el hash, no el token

En `refresh_tokens` se persiste el SHA-256 del token. Si se filtra la base, los
refresh tokens no son usables.

### Bloqueo de cuenta

Tras `LOGIN_MAX_FAILED_ATTEMPTS` (5) intentos fallidos, la cuenta se bloquea
`LOGIN_LOCK_DURATION_MINUTES` (15).

Es complementario al rate limiting, no redundante: el throttle frena a una IP
probando muchas cuentas; el bloqueo frena a muchas IPs probando una sola cuenta.

### Secretos separados para access y refresh

`JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` tienen que ser distintos — la
validación de entorno lo verifica y no deja arrancar si son iguales. Si
compartieran secreto, un refresh token serviría como access token.

Como defensa adicional, cada token lleva un claim `typ` (`access` o `refresh`)
que se verifica al validarlo.

---

## El access token y la revocación

Desde la Fase 4, el guard **valida al usuario contra la base en cada request**
(`JWT_VALIDATE_USER_ON_REQUEST`, `true` por defecto; D-19). Verifica que:

- el usuario exista dentro del tenant del token;
- siga activo, y su inmobiliaria también;
- el token no sea anterior al último cambio de contraseña.

Si algo falla: `401 SESSION_REVOKED`, y el front cierra la sesión. Además toma
el rol de la base, así que un cambio de rol rige desde el request siguiente.
Cuesta una consulta por clave primaria por request.

Con `JWT_VALIDATE_USER_ON_REQUEST=false` el access token vuelve a ser
stateless: más barato, pero desactivar a alguien tarda hasta 15 minutos en
hacer efecto (los refresh se revocan al instante igual).

---

## Crear el primer administrador

No hay registro público. Cada inmobiliaria nace con su primer administrador
por el comando de alta:

```bash
npm run tenant:create -- --name "Oppido Propiedades" --slug oppido --admin-email admin@oppido.com.ar
```

La contraseña se genera ahí y se muestra una sola vez. No se pasa por parámetro
para que no quede en el historial de la terminal. El administrador la cambia
con `POST /auth/change-password`. Detalle en [MULTI-TENANCY.md](MULTI-TENANCY.md).

Para desarrollo local, `npm run prisma:seed` crea una inmobiliaria demo (slug
`demo`) con un usuario por rol:

| Rol         | Email                    | Contraseña           | Login           |
| ----------- | ------------------------ | -------------------- | --------------- |
| admin       | `admin@demo.local`       | `demo-admin-1234`    | `/login`        |
| empleado    | `empleado@demo.local`    | `demo-employee-1234` | `/login`        |
| propietario | `propietario@demo.local` | `demo-owner-1234`    | `/portal-login` |
| inquilino   | `inquilino@demo.local`   | `demo-renter-1234`   | `/portal-login` |

Esas credenciales están en el repo a propósito, y por eso el seed se niega a
correr con `NODE_ENV=production`. Sobre una base ya sembrada, agrega sólo los
usuarios que falten.

---

## Limpieza de tokens

Cada login y cada rotación dejan una fila en `refresh_tokens`. Un cron diario
(`RefreshTokenCleanupTask`, 3 AM) borra los vencidos o revocados hace más de 30
días. Se conserva un mes para poder auditar una cadena de rotaciones después de
detectar un reuso.

Ojo: corre en cada instancia. Con varias réplicas vas a tener varias ejecuciones
simultáneas — el `deleteMany` es idempotente, así que no rompe nada, sólo hace
trabajo de más. Si te molesta, movelo a un CronJob de Kubernetes.

---

## Si mañana esto se parte en microservicios

`src/modules/auth/infrastructure` es el candidato natural a convertirse en el servicio
de identidad. Para que el resto de las APIs sigan validando tokens sin depender
de él:

1. **Pasar de HS256 a RS256** y publicar un JWKS. Cada servicio valida con la
   clave pública; sólo el de identidad tiene la privada. Hoy `TokenService` usa
   `secret`; habría que cambiarlo por `privateKey`/`publicKey` y agregar el
   endpoint `/.well-known/jwks.json`.
2. **Dejar el refresh y la rotación sólo en el servicio de identidad.** Los
   demás servicios nunca ven un refresh token.
3. **Mover `JwtAuthGuard`, los decoradores y los tipos a una librería
   compartida.** Ya están aislados en `src/modules/auth/infrastructure/{guards,decorators,types}`
   y no dependen de Prisma salvo por `UserRepository`, que el guard usa para
   validar al usuario en cada request. En otro servicio, esa validación pasaría
   a ser una consulta al de identidad (con caché) o se apagaría con
   `JWT_VALIDATE_USER_ON_REQUEST=false`.

---

## Códigos de error

| `code`                     | HTTP | Cuándo                                                                                                     |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `TOKEN_MISSING`            | 401  | No vino el header `Authorization`                                                                          |
| `TOKEN_INVALID`            | 401  | Firma inválida, malformado o tipo incorrecto                                                               |
| `TOKEN_EXPIRED`            | 401  | Access token vencido → refrescar                                                                           |
| `INVALID_CREDENTIALS`      | 401  | Email o contraseña incorrectos                                                                             |
| `REFRESH_TOKEN_INVALID`    | 401  | Refresh inexistente o rotación concurrente                                                                 |
| `REFRESH_TOKEN_EXPIRED`    | 401  | Refresh vencido → volver a loguear                                                                         |
| `REFRESH_TOKEN_REUSED`     | 401  | Reuso detectado, se cerraron todas las sesiones                                                            |
| `SESSION_REVOKED`          | 401  | Usuario borrado o desactivado, inmobiliaria deshabilitada, o token anterior al último cambio de contraseña |
| `ACCOUNT_INACTIVE`         | 403  | Sólo al refrescar: cuenta o inmobiliaria deshabilitada                                                     |
| `ACCOUNT_LOCKED`           | 403  | Bloqueada por intentos fallidos                                                                            |
| `INSUFFICIENT_PERMISSIONS` | 403  | El rol no alcanza para ese endpoint                                                                        |
| `EMAIL_ALREADY_REGISTERED` | 409  | Ya hay una cuenta con ese email                                                                            |
| `CURRENT_PASSWORD_INVALID` | 400  | La contraseña actual no coincide                                                                           |
| `PASSWORD_REUSED`          | 400  | La nueva es igual a la vigente                                                                             |

El catálogo completo está en `src/shared/errors/error-codes.ts`. Ver también
[ERROR-HANDLING.md](./ERROR-HANDLING.md).
