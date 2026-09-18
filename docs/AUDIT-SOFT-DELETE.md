# Auditoría e historial de cambios

Cada create, update y delete de un modelo auditable deja una fila en
`audit_logs` con **sólo los campos que cambiaron**, quién los cambió y desde qué
request.

Es automático: ningún repositorio tiene que acordarse de nada.

## La fila del historial

```json
{
  "entidad": "Propiedad",
  "entidadId": "9b1deb4d-...",
  "accion": "UPDATE",
  "cambios": {
    "precio": { "antes": 120000, "despues": 135000 },
    "estado": { "antes": "DISPONIBLE", "despues": "RESERVADA" }
  },
  "usuarioId": "3f8c1b1e-...",
  "usuarioEmail": "ana@ejemplo.com",
  "correlationId": "c0ffee-...",
  "ip": "190.1.2.3",
  "creadoEn": "2026-06-01T12:00:00.000Z"
}
```

`cambios` es JSON sin esquema fijo a propósito: cada entidad tiene sus campos.
En un `CREATE` sólo lleva `despues`; en un `DELETE`, sólo `antes`.

**El renderizado es del front**, y depende de cada feature: `precio` se muestra
con formato de moneda, `estadoId` hay que resolverlo a su nombre, `deletedAt` se
muestra como "dado de baja". El backend garantiza el dato, no su presentación.

El `correlationId` permite cruzar el cambio con los logs de la request que lo
provocó.

## Qué se audita

Es **opt-in** por modelo, en
`src/infrastructure/prisma/extensions/auditable-models.ts`:

```ts
export const MODEL_BEHAVIOUR: Record<string, ModelBehaviour> = {
  User: {
    audit: true,
    softDelete: true,
    excludeFromDiff: ['passwordHash', 'failedLoginAttempts', 'lastLoginAt'],
    mutateOnDelete: ['email'],
  },
  RefreshToken: { audit: false, softDelete: false },
}
```

Una tabla nueva no entra en el historial por accidente: hay que declararla. Y
tiene sentido no auditar todo — los refresh tokens se rotan en cada request, y
auditarlos generaría una fila por refresh.

`excludeFromDiff` importa: guardar el "antes y después" de un `passwordHash` en
una tabla de auditoría es filtrar material para crackear offline.

## Soft delete

Para los modelos con `softDelete: true`:

- `delete` y `deleteMany` marcan `deletedAt` en vez de borrar.
- Todas las lecturas filtran `deletedAt: null` solas.
- El borrado queda registrado en el historial como `DELETE`.

Para ver los borrados en una consulta puntual:

```ts
import { INCLUDE_DELETED } from '@/infrastructure/prisma/extensions/soft-delete.extension'

await prisma.db.user.findMany({ where: { [INCLUDE_DELETED]: true } })
```

### El problema del índice único en MySQL

Si borrás lógicamente a `ana@ejemplo.com`, la fila sigue ahí ocupando el índice
único de `email`. Sin resolverlo, ese email no se puede volver a registrar.

La solución habitual —un unique compuesto `(email, deletedAt)`— **no funciona en
MySQL**: los índices únicos tratan cada `NULL` como distinto, así que dos
usuarios activos, ambos con `deletedAt = NULL`, pasarían el constraint. Sería
peor que no tenerlo.

Por eso, al borrar se reescribe el valor:

```
ana@ejemplo.com  →  ana@ejemplo.com#deleted#9b1deb4d-...
```

El índice queda honesto, el email se libera, y el valor original queda en el
historial. Los campos a los que se aplica se declaran en `mutateOnDelete`.

## Los tres límites que hay que conocer

1. **`$queryRaw` no pasa por las extensiones** y ve los registros borrados. Si
   escribís SQL a mano, el filtro va a mano también.
2. **Los `count` de relaciones anidadas incluyen borrados** salvo que filtres
   explícito en el `include`.
3. **`findUnique` se convierte en `findFirst`.** Prisma no acepta filtros no
   únicos en un `findUnique`, así que no hay alternativa. Es equivalente en
   resultado, pero el plan de la consulta puede diferir.

## Costo

Un `update` auditado hace **una lectura extra** para conocer el estado previo y
poder calcular el diff. Es el precio del "antes y después".

Si en algún modelo sólo te importa _quién_ tocó el registro y no _qué_ cambió,
poné `audit: false`: las columnas `createdById` y `updatedById` se siguen
completando solas, sin la lectura extra.

## Si falla la auditoría

La fila de historial se escribe **después** de que la operación principal salió
bien, y su error se loguea sin propagarse: que se caiga la auditoría no puede
hacer fallar un alta que el usuario ya dio por hecha.

La contrapartida es que el historial puede tener huecos. Quedan visibles en los
logs con el contexto `Audit`; vale la pena una alerta sobre eso.

## Los dos clientes de Prisma

```ts
prisma.db // extendido: soft delete + auditoría. Es el que usan los repositorios.
prisma // crudo: sin extensiones.
```

El crudo es para lo que necesita saltearse las extensiones a propósito:
migraciones de datos, limpiezas, el borrado físico de tokens vencidos. Si dudás,
usá `prisma.db`.

## De dónde sale el usuario

Del `RequestContext` (`AsyncLocalStorage`), que abre el middleware y completa
`JwtAuthGuard`. Por eso un repositorio sabe quién está haciendo el cambio sin
que haya un parámetro `userId` en todas las firmas del dominio.

Fuera de un request —el seed, un cron— no hay usuario y `usuarioId` queda en
`null`. Es correcto: no lo hizo nadie, lo hizo el sistema.
