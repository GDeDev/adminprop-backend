# Multi-tenant

Adminprop es un SaaS: una sola base y un solo schema para todas las
inmobiliarias (tenants). Cada tabla de negocio lleva `tenant_id` y el
aislamiento lo garantiza el cliente de Prisma, no la memoria de quien escribe el
repositorio. Spec: Fase 1, sección 3.

## Cómo llega el tenant a cada consulta

```
login (email + contraseña)
  → UserRepository.findByEmail()        única búsqueda entre tenants
  → JWT { sub, email, role, tenantId }
request con Bearer
  → JwtAuthGuard → RequestContext.setUser({ ..., tenantId })
  → handler → repositorio → prisma.db.<modelo>
  → tenantExtension suma tenantId al where / al data
```

El `RequestContext` usa `AsyncLocalStorage`: el tenant no se pasa por parámetro
en ninguna firma.

## Qué hace el filtro (`tenant.extension.ts`)

Para los modelos con `tenantScoped: true` en `auditable-models.ts`:

| Operación                                | Qué agrega                           |
| ---------------------------------------- | ------------------------------------ |
| `find*`, `count`, `aggregate`, `groupBy` | `where.tenantId`                     |
| `update*`, `delete*`                     | `where.tenantId`                     |
| `create`, `createMany`                   | `data.tenantId`                      |
| `upsert`                                 | `where.tenantId` y `create.tenantId` |

- **Un id de otro tenant se comporta como un id inexistente**: `findUnique`
  devuelve `null` y `update`/`delete` tiran `P2025`. Los dos terminan en un
  **404**, nunca en un 403, así no se revela que el registro existe.
- Pedir explícitamente otro tenant (`data.tenantId` o `where.tenantId`
  distintos del contexto, o `tenant: { connect }`) tira `TenantMismatchError`.
- **Sin tenant en el contexto, falla** (`TenantContextMissingError`, un 500).
  Correr sin filtro expondría los datos de todas las inmobiliarias.

Es la primera extensión de la cadena, antes del soft delete y la auditoría: así
sus lecturas internas ya reciben el `where` filtrado.

## Fuera de un request

Workers de la cola, crons y scripts no tienen JWT. Entran a un tenant de forma
explícita:

```ts
await RequestContext.runInTenant(tenantId, async () => {
  await this.repository.doSomething()
})
```

`runInTenant` hace el `await` adentro del scope a propósito: las consultas de
Prisma son perezosas y recién corren con el `await`. Si se ejecutaran afuera,
el filtro no vería el tenant.

## Consultas entre tenants

`prisma.unscoped` es el mismo cliente sin el filtro. Existe para los dos casos
en que el tenant todavía no se conoce:

- el login busca el usuario por email (el email es único global);
- el refresh busca el usuario por id (el refresh token no lleva el tenant).

Cualquier otro uso tiene que poder justificarse en una línea de comentario.

## Agregar un modelo con tenant

1. En `schema.prisma`: `tenantId String @map("tenant_id") @db.Uuid`, la
   relación a `Tenant` y un `@@index([tenantId])` (o compuesto que empiece por
   él).
2. En `auditable-models.ts`: `tenantScoped: true`.
3. Un test de aislamiento (otro tenant no ve, no edita, no borra).

`tenant-scoped-models.spec.ts` compara el schema con la configuración: un modelo
con `tenantId` que no esté declarado rompe los tests.

## Límites

- `$queryRaw` no pasa por el filtro: el `tenant_id` va a mano.
- Las relaciones anidadas en un `include` no se filtran: se llega a ellas desde
  un registro que ya es del tenant.
- `audit_logs` guarda el `tenantId` pero no se filtra todavía (la escribe
  también el sistema). Se filtra cuando llegue su pantalla (Fase 20).

## La entidad `Tenant`

Tiene la identidad de la inmobiliaria (`name`, `slug`, `logoUrl`,
`primaryColor`, `isActive`) y sus parámetros de negocio (honorarios, días de
gracia, punitorio diario, días de generación de cuotas, recordatorios, aviso de
vencimiento, informe mensual y moneda), con los defaults del PRD §5.0. Ninguna
regla de negocio de un cliente puntual va en el código: va acá.

Si el tenant está inactivo, ninguno de sus usuarios puede loguearse ni rotar su
sesión. Se responde igual que con una cuenta inactiva.

Alta: `npm run prisma:seed` con `SEED_TENANT_NAME` y `SEED_TENANT_SLUG` (más el
admin) en Doppler. No hay ABM en el MVP.
