# Autenticación

Módulo de auth propio, sin dependencias externas. Reemplaza a
`@grupo-centaurus/vulcan.heimdall.auth`, que se eliminó del template.

- **Access token**: JWT stateless, 15 minutos.
- **Refresh token**: JWT firmado con otro secreto, 7 días, persistido como hash
  y **rotado en cada uso** con detección de reuso.
- **Contraseñas**: bcrypt, costo 12.
- **Roles**: `ADMIN`, `EMPLOYEE`, `OWNER` y `RENTER`, un rol por usuario.
- **Multi-tenant**: cada usuario pertenece a una inmobiliaria. El email es único
  en todo el sistema, así que el login sigue siendo email + contraseña y el
  `tenantId` sale del usuario y viaja en el access token. Ver
  [MULTI-TENANCY.md](MULTI-TENANCY.md).
- **Sin registro público**: los usuarios salen del seed y, desde la Fase 4, del
  alta que hace el admin de cada inmobiliaria.

---

## Endpoints

Todos cuelgan de `/api/v1/auth`.

| Método | Ruta               | Auth | Qué hace                                         |
| ------ | ------------------ | ---- | ------------------------------------------------ |
| POST   | `/login`           | No   | Inicia sesión                                    |
| POST   | `/refresh`         | No   | Rota el par de tokens                            |
| POST   | `/logout`          | No   | Revoca el refresh token enviado (204 siempre)    |
| POST   | `/logout-all`      | Sí   | Cierra todas las sesiones del usuario            |
| POST   | `/change-password` | Sí   | Cambia la contraseña y cierra todas las sesiones |
| GET    | `/me`              | Sí   | Datos del usuario autenticado                    |

Los tres primeros tienen rate limiting estricto: 10 intentos cada 15 minutos
(`THROTTLE_AUTH_*`).

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
} from '@/infrastructure/auth'

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
2. `src/domain/auth/enums/role.enum.ts` → `enum Role`

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

Por la misma razón, la cuenta inactiva se chequea **después** de validar la
contraseña.

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

El access token **no se valida contra la base** en cada request. Es lo que lo
hace barato, y el precio es que un logout o un baneo tardan hasta 15 minutos en
hacer efecto sobre los access tokens ya emitidos (los refresh se revocan al
instante).

Si necesitás corte inmediato:

```bash
JWT_VALIDATE_USER_ON_REQUEST=true
```

Con eso, cada request consulta el usuario y verifica que siga activo y que el
token no sea anterior al último cambio de contraseña. Cuesta una consulta por
request; para la mayoría de las APIs no vale la pena.

---

## Crear el primer administrador

No hay registro público. La primera inmobiliaria y su admin se crean con el
seed, con las variables `SEED_TENANT_NAME`, `SEED_TENANT_SLUG`,
`SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` cargadas en Doppler:

```bash
npm run prisma:seed
```

Es idempotente: si el tenant ya existe se reutiliza. Para sumar otra
inmobiliaria alcanza con correrlo de nuevo con otros valores.

La contraseña no está hardcodeada a propósito: un template con una contraseña de
admin conocida es exactamente el tipo de cosa que después aparece en producción.

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

`src/infrastructure/auth` es el candidato natural a convertirse en el servicio
de identidad. Para que el resto de las APIs sigan validando tokens sin depender
de él:

1. **Pasar de HS256 a RS256** y publicar un JWKS. Cada servicio valida con la
   clave pública; sólo el de identidad tiene la privada. Hoy `TokenService` usa
   `secret`; habría que cambiarlo por `privateKey`/`publicKey` y agregar el
   endpoint `/.well-known/jwks.json`.
2. **Dejar el refresh y la rotación sólo en el servicio de identidad.** Los
   demás servicios nunca ven un refresh token.
3. **Mover `JwtAuthGuard`, los decoradores y los tipos a una librería
   compartida.** Ya están aislados en `src/infrastructure/auth/{guards,decorators,types}`
   y no dependen de Prisma salvo por `UserRepository`, que sólo se usa cuando
   `JWT_VALIDATE_USER_ON_REQUEST=true`.

---

## Códigos de error

| `code`                     | HTTP | Cuándo                                          |
| -------------------------- | ---- | ----------------------------------------------- |
| `TOKEN_MISSING`            | 401  | No vino el header `Authorization`               |
| `TOKEN_INVALID`            | 401  | Firma inválida, malformado o tipo incorrecto    |
| `TOKEN_EXPIRED`            | 401  | Access token vencido → refrescar                |
| `INVALID_CREDENTIALS`      | 401  | Email o contraseña incorrectos                  |
| `REFRESH_TOKEN_INVALID`    | 401  | Refresh inexistente o rotación concurrente      |
| `REFRESH_TOKEN_EXPIRED`    | 401  | Refresh vencido → volver a loguear              |
| `REFRESH_TOKEN_REUSED`     | 401  | Reuso detectado, se cerraron todas las sesiones |
| `SESSION_REVOKED`          | 401  | Token anterior al último cambio de contraseña   |
| `ACCOUNT_INACTIVE`         | 403  | `isActive = false`                              |
| `ACCOUNT_LOCKED`           | 403  | Bloqueada por intentos fallidos                 |
| `INSUFFICIENT_PERMISSIONS` | 403  | El rol no alcanza para ese endpoint             |
| `EMAIL_ALREADY_REGISTERED` | 409  | Ya hay una cuenta con ese email                 |
| `CURRENT_PASSWORD_INVALID` | 400  | La contraseña actual no coincide                |
| `PASSWORD_REUSED`          | 400  | La nueva es igual a la vigente                  |

El catálogo completo está en `src/shared/errors/error-codes.ts`. Ver también
[ERROR-HANDLING.md](./ERROR-HANDLING.md).
