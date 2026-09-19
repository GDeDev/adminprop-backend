# Manejo de errores

Todos los errores de la API salen con la misma forma. El frontend parsea una
sola estructura y ramifica por `code`, que es un contrato estable — el `message`
puede cambiar o traducirse.

## Formato de respuesta

```json
{
  "success": false,
  "code": "VALIDATION_FAILED",
  "message": "La validación de los datos enviados falló",
  "errors": [
    {
      "field": "email",
      "code": "isEmail",
      "message": "El email no tiene un formato válido"
    },
    {
      "field": "password",
      "code": "minLength",
      "message": "La contraseña debe tener al menos 10 caracteres"
    }
  ],
  "correlationId": "3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11",
  "timestamp": "2026-01-15T10:00:00.000Z",
  "path": "/api/v1/auth/login"
}
```

`errors` viene vacío cuando el error no es de validación. Los campos anidados se
reportan con notación de punto (`address.zipCode`) y los de array con índice
(`items[0].qty`), así el frontend puede pintar el error donde va.

## Lanzar errores

Usá los factories de `AppException` en vez de las excepciones de Nest: llevan un
`ErrorCode` además del status.

```ts
import { AppException, ErrorCode } from '@/shared/errors'

throw AppException.notFound('La propiedad no existe')

throw AppException.conflict(
  'Ya existe una propiedad con esa matrícula',
  ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
)

// Con detalle por campo
throw AppException.validation('Datos inválidos', [
  { field: 'metros', code: 'min', message: 'Los metros deben ser positivos' },
])

// Con contexto para el log (nunca se serializa al cliente)
throw AppException.forbidden(
  'No podés editar esta propiedad',
  ErrorCode.FORBIDDEN,
  {
    metadata: { propiedadId, ownerId },
  },
)
```

Las excepciones nativas de Nest (`NotFoundException`, etc.) también funcionan:
el filtro las normaliza y les asigna un `code` derivado del status. Pero perdés
la granularidad — un `401` genérico en vez de distinguir `TOKEN_EXPIRED` de
`INVALID_CREDENTIALS`.

Para errores de dominio recurrentes, agrupalos como en
`src/domain/auth/exceptions/auth.exceptions.ts`.

## Qué ve el cliente y qué ve el log

| Situación   | Cliente                                | Log                             |
| ----------- | -------------------------------------- | ------------------------------- |
| 4xx         | El mensaje real y el detalle por campo | `warn`, sin stack ni payload    |
| 5xx en dev  | El mensaje real                        | `error` con stack, query y body |
| 5xx en prod | Mensaje genérico + `correlationId`     | `error` con stack, query y body |

En producción un 5xx **nunca** filtra el mensaje interno: el usuario recibe el
`correlationId` y con eso se busca el detalle en los logs.

## Redacción de datos sensibles

Todo lo que se loguea pasa por `redact()`
(`src/shared/infra/logging/redact.ts`), que reemplaza por `[REDACTED]` cualquier
campo cuyo nombre contenga `password`, `token`, `secret`, `authorization`,
`apiKey`, `cvv`, etc. También acota profundidad, arrays y strings largas para
que un payload grande no inunde los logs.

Si agregás un campo sensible con un nombre que no matchea, sumalo a
`SENSITIVE_KEYS`.

## Errores de Prisma

`PrismaExceptionFilter` traduce los códigos de Prisma a HTTP:

| Prisma                    | HTTP | `code`                             |
| ------------------------- | ---- | ---------------------------------- |
| `P2002` unique            | 409  | `UNIQUE_CONSTRAINT_VIOLATION`      |
| `P2003` foreign key       | 400  | `FOREIGN_KEY_CONSTRAINT_VIOLATION` |
| `P2014`, `P2017`          | 409  | `RELATED_RECORDS_EXIST`            |
| `P2025` y afines          | 404  | `RECORD_NOT_FOUND`                 |
| `P2000`, `P2011`, `P2020` | 400  | `VALIDATION_FAILED`                |
| `P2024` pool agotado      | 503  | `SERVICE_UNAVAILABLE`              |
| `P1001`, `P1002`, `P1017` | 503  | `SERVICE_UNAVAILABLE`              |

En el caso de `P2002` se devuelven además los campos involucrados en `errors`.

Los mensajes de Prisma incluyen nombres de tablas y columnas, o sea, información
del esquema. En producción se reemplazan por mensajes genéricos; el detalle real
queda sólo en el log.

## Correlation ID

`CorrelationIdMiddleware` le asigna un ID a cada request y lo devuelve en el
header `x-correlation-id`. Si el cliente manda uno (`x-correlation-id`,
`x-request-id`, `x-trace-id` o `x-amzn-trace-id`), se respeta — sanitizado y
acotado a 128 caracteres.

Va como **middleware** y no como interceptor a propósito: los middlewares corren
antes que los guards, así que hasta un 401 o un 429 salen con su correlation ID.

## Servicios externos

`ApiService` (`src/shared/infra/base-api.ts`) convierte las fallas de axios en
`AppException`:

- Respuesta de error del tercero → `502 EXTERNAL_SERVICE_ERROR`
- Timeout → `504 EXTERNAL_SERVICE_TIMEOUT`
- Sin conexión → `502 EXTERNAL_SERVICE_UNAVAILABLE`

El status y el mensaje del tercero van a la metadata del log, no a la respuesta:
que una API externa haya devuelto un 400 no significa que el request del cliente
haya estado mal.

## Orden de los filtros

```ts
app.useGlobalFilters(
  new GlobalExceptionFilter(isProduction),
  new PrismaExceptionFilter(isProduction),
)
```

Nest evalúa los filtros **del último al primero**. Por eso el de Prisma, que es
más específico, va después del catch-all. Si los invertís, el catch-all se come
todos los errores de Prisma y perdés el mapeo a 409/404/503.
