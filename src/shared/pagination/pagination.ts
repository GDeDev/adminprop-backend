import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  PaginatedResult,
  PaginationMetaDto,
  PaginationQueryDto,
} from './pagination.dto'

/** Argumentos de paginación tal como los espera Prisma. */
export interface PageArgs {
  skip: number
  take: number
}

/**
 * Traduce `?page=2&limit=20` a los `skip`/`take` de Prisma.
 *
 * Los valores ya vienen validados por `PaginationQueryDto`, pero se aplican los
 * defaults igual: los handlers a veces construyen la query a mano en tests.
 */
export function toPageArgs(query: Partial<PaginationQueryDto> = {}): PageArgs {
  const page = Math.max(1, Math.trunc(query.page ?? DEFAULT_PAGE))
  const limit = Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT))

  return { skip: (page - 1) * limit, take: limit }
}

/**
 * Arma la metadata a partir del total **real** de la base.
 *
 * `total` tiene que venir de un `count()` sobre los mismos filtros que la
 * consulta, no de `data.length`: eso último devolvería siempre "una sola
 * página", que es justamente el bug que tenía el módulo de ejemplo.
 */
export function buildPaginationMeta(
  total: number,
  query: Partial<PaginationQueryDto> = {},
): PaginationMetaDto {
  const page = Math.max(1, Math.trunc(query.page ?? DEFAULT_PAGE))
  const limit = Math.max(1, Math.trunc(query.limit ?? DEFAULT_LIMIT))
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  }
}

/** Junta los resultados de la página con su metadata. */
export function paginate<T>(
  data: T[],
  total: number,
  query: Partial<PaginationQueryDto> = {},
): PaginatedResult<T> {
  return { data, pagination: buildPaginationMeta(total, query) }
}

/**
 * Atajo para el patrón habitual con Prisma: traer la página y contar el total
 * en una sola transacción, para que ambas consultas vean el mismo estado de la
 * base.
 *
 * ```ts
 * const where = { ciudad: query.ciudad }
 *
 * return paginateWith(query, (args) =>
 *   this.prisma.$transaction([
 *     this.prisma.propiedad.findMany({ ...args, where, orderBy: { creadoEn: 'desc' } }),
 *     this.prisma.propiedad.count({ where }),
 *   ]),
 * )
 * ```
 *
 * Sin la transacción, entre el `findMany` y el `count` puede entrar un insert y
 * el total no coincide con lo que se devolvió.
 */
export async function paginateWith<T>(
  query: Partial<PaginationQueryDto>,
  fetch: (args: PageArgs) => Promise<[T[], number]>,
): Promise<PaginatedResult<T>> {
  const [data, total] = await fetch(toPageArgs(query))
  return paginate(data, total, query)
}
