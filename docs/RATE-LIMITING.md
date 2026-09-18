# Rate limiting

Basado en `@nestjs/throttler`, con guard global. Se aplica a todos los endpoints
salvo los de `/health`.

## Perfiles

Corren las tres ventanas a la vez y alcanza con pasarse de **una** para recibir
un 429:

| Perfil   | Default         | Para qué             |
| -------- | --------------- | -------------------- |
| `short`  | 10 req / 1 s    | Frenar ráfagas       |
| `medium` | 120 req / 1 min | Uso normal sostenido |
| `long`   | 2000 req / 1 h  | Techo por cliente    |

Los endpoints de auth (`login`, `register`, `refresh`, `logout`,
`change-password`) sobrescriben los tres con un límite mucho más estricto:
**10 intentos cada 15 minutos**.

Todo se ajusta por env (`THROTTLE_*`, TTL en segundos). `THROTTLE_ENABLED=false`
lo apaga entero — así corren los tests e2e.

## Respuesta al superar el límite

```
HTTP/1.1 429 Too Many Requests
Retry-After: 847
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
```

```json
{
  "success": false,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Demasiadas solicitudes. Reintentá en 847 segundo(s).",
  "errors": [],
  "correlationId": "...",
  "timestamp": "...",
  "path": "/api/v1/auth/login"
}
```

## Por quién se cuenta

`AppThrottlerGuard.getTracker()` usa el id del usuario cuando hay sesión y la IP
si no. Sin eso, todos los usuarios detrás de un mismo NAT corporativo
compartirían cupo.

> **Detrás de un proxy, poné `TRUST_PROXY=true`.** Sin eso `req.ip` es la IP del
> balanceador y todo el tráfico cuenta como un solo cliente: el rate limit te
> deja afuera a todos a la vez.

## Aplicarlo a tus endpoints

Los tres perfiles globales ya aplican solos. Para ajustar un endpoint puntual:

```ts
import { Throttle, SkipThrottle } from '@nestjs/throttler'
import { ThrottleAuth } from '@/shared/infra/throttler/throttle-auth.decorator'

// Límite estricto de auth (10 / 15 min)
@ThrottleAuth()
@Post('recuperar-password')

// Límite propio: 3 por minuto, sobrescribiendo los tres perfiles
@Throttle({
  short: { ttl: 60_000, limit: 3 },
  medium: { ttl: 60_000, limit: 3 },
  long: { ttl: 60_000, limit: 3 },
})
@Post('exportar-reporte')

// Sin límite (webhooks internos, por ejemplo)
@SkipThrottle()
@Post('webhook')
```

Si sobrescribís sólo un perfil, los otros dos siguen aplicando con sus valores
globales — por eso `ThrottleAuth()` pisa los tres, para que un atacante no pueda
aprovechar la ventana más permisiva.

## Storage

Por defecto el conteo vive **en memoria**, así el template levanta sin
infraestructura extra.

> ⚠️ **En producción multi-instancia cada réplica cuenta por separado**, o sea
> que el límite real es `límite × réplicas`. Con 4 pods, el límite de auth pasa
> de 10 a 40 intentos cada 15 minutos.

Para pasar a conteo compartido:

```bash
npm install @nest-lab/throttler-storage-redis ioredis
```

```ts
// src/shared/infra/throttler/throttler.module.ts
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis'

useFactory: (configService: ConfigService<Configuration, true>) => {
  const throttle = configService.get<ThrottleConfig>('throttle', {
    infer: true,
  })

  return {
    throttlers: throttle.profiles,
    storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
    skipIf: (context) => {
      /* igual que ahora */
    },
  }
}
```

Nada más cambia: el guard y los decoradores `@Throttle()` siguen funcionando
igual. El `docker-compose.yml` ya trae un Redis levantado esperando.

## Relación con el bloqueo de cuenta

El rate limiting y el bloqueo de cuenta cubren ataques distintos y no son
redundantes:

- **Throttle** (por IP): frena a una IP probando muchas cuentas.
- **Bloqueo de cuenta** (por usuario, ver [AUTH.md](./AUTH.md)): frena a muchas
  IPs probando una sola cuenta — un botnet rotando IPs pasa por debajo del
  throttle sin problema.
