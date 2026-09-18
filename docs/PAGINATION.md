# Paginación

Todos los listados de la API se paginan igual: `?page=2&limit=20`.

## Respuesta

```json
{
  "success": true,
  "message": null,
  "data": {
    "data": [{ "id": "...", "direccion": "..." }],
    "pagination": {
      "page": 2,
      "limit": 20,
      "total": 137,
      "totalPages": 7,
      "hasNextPage": true,
      "hasPreviousPage": true
    }
  }
}
```

`total` es el total de registros que matchean la consulta, **no** los de la
página actual. El frontend arma el paginador con `totalPages` y decide si
mostrar los botones con `hasNextPage` / `hasPreviousPage`.

## Query params

| Param   | Default | Límites |
| ------- | ------- | ------- |
| `page`  | 1       | ≥ 1     |
| `limit` | 20      | 1 a 100 |

El tope de 100 no es negociable desde el cliente: sin él, un `?limit=1000000`
hace que la base arme el resultado entero en memoria y el proceso se quede sin
heap serializándolo. Si un caso puntual necesita más, hacé un endpoint de export
con streaming, no subas el tope.

## Cómo paginar un endpoint

### 1. El DTO de query

Extendé `PaginationQueryDto` y agregale tus filtros:

```ts
import { IsOptional, IsString } from 'class-validator'
import { PaginationQueryDto } from '@/shared/pagination'

export class ListarPropiedadesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  ciudad?: string
}
```

### 2. El repositorio

Usá `paginateWith`, que resuelve el patrón completo:

```ts
import { PaginatedResult, paginateWith } from '@/shared/pagination'

async findAll(query: ListarPropiedadesDto): Promise<PaginatedResult<Propiedad>> {
  const where = query.ciudad ? { ciudad: query.ciudad } : {}

  return paginateWith(query, (args) =>
    this.prisma.$transaction([
      this.prisma.propiedad.findMany({
        ...args,                         // skip y take
        where,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.propiedad.count({ where }),
    ]),
  )
}
```

Dos detalles que importan:

- **El `count` va sobre el mismo `where` que el `findMany`.** Si no, el total no
  corresponde a lo que estás devolviendo.
- **Van en la misma `$transaction`.** Sin eso, entre una consulta y la otra puede
  entrar un insert y el total no coincide con la página devuelta.

### 3. El `orderBy` no es opcional

Sin un orden explícito, Postgres no garantiza que dos consultas devuelvan las filas
en el mismo orden. En la práctica eso significa que un registro puede aparecer
en la página 1 y también en la 2, y otro no aparecer nunca. Ordená siempre, y
por algo estable — si el campo puede repetirse, desempatá por `id`:

```ts
orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }]
```

### 4. El controller

```ts
import { ApiPaginatedResponse, PaginatedResult } from '@/shared/pagination'

@ApiPaginatedResponse(PropiedadDto, 'Listado de propiedades')
@Get()
async listar(
  @Query() query: ListarPropiedadesDto,
): Promise<ApiSuccessDto<PaginatedResult<Propiedad>>> {
  const result = await this.queryBus.execute(new ListarPropiedadesQuery(query))
  return { success: true, message: null, data: result }
}
```

`@ApiPaginatedResponse` hace falta porque OpenAPI no tiene genéricos: sin él,
Swagger documenta `data` como `object` a secas.

## Herramientas disponibles

Todo sale de `@/shared/pagination`:

| Función                             | Para qué                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `paginateWith(query, fetch)`        | El caso normal: resuelve skip/take, fetch y metadata  |
| `toPageArgs(query)`                 | Sólo el `{ skip, take }`, si armás la consulta a mano |
| `paginate(data, total, query)`      | Sólo la metadata, con datos que ya tenés              |
| `buildPaginationMeta(total, query)` | Sólo el bloque `pagination`                           |

## Cuando el offset deje de alcanzar

`OFFSET` obliga a la base a recorrer y descartar todas las filas anteriores: en
la página 5.000 está leyendo 100.000 filas para devolver 20. Para tablas grandes
o scroll infinito conviene paginación por cursor (`WHERE id < :ultimoId LIMIT
20`), que es de costo constante pero no permite saltar a una página arbitraria.

Para un panel de administración con filtros y números de página, offset es lo
correcto. Si aparece un listado que crece sin techo, ese endpoint puntual puede
usar cursor sin cambiar el resto.
