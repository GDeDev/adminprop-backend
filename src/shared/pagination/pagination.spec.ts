import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'

import { MAX_LIMIT, PaginationQueryDto } from './pagination.dto'
import {
  buildPaginationMeta,
  paginate,
  paginateWith,
  toPageArgs,
} from './pagination'

describe('toPageArgs', () => {
  it('traduce página y límite a skip/take', () => {
    expect(toPageArgs({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 })
    expect(toPageArgs({ page: 2, limit: 20 })).toEqual({ skip: 20, take: 20 })
    expect(toPageArgs({ page: 7, limit: 15 })).toEqual({ skip: 90, take: 15 })
  })

  it('aplica los defaults cuando no viene nada', () => {
    expect(toPageArgs()).toEqual({ skip: 0, take: 20 })
  })

  it('nunca produce un skip negativo', () => {
    // Un skip negativo hace que Prisma tire una excepción en runtime.
    expect(toPageArgs({ page: 0 }).skip).toBe(0)
    expect(toPageArgs({ page: -5 }).skip).toBe(0)
  })
})

describe('buildPaginationMeta', () => {
  it('calcula el total de páginas redondeando para arriba', () => {
    expect(buildPaginationMeta(137, { page: 1, limit: 20 }).totalPages).toBe(7)
    expect(buildPaginationMeta(140, { page: 1, limit: 20 }).totalPages).toBe(7)
    expect(buildPaginationMeta(141, { page: 1, limit: 20 }).totalPages).toBe(8)
  })

  it('marca hasNextPage y hasPreviousPage según la posición', () => {
    const primera = buildPaginationMeta(100, { page: 1, limit: 20 })
    expect(primera.hasPreviousPage).toBe(false)
    expect(primera.hasNextPage).toBe(true)

    const medio = buildPaginationMeta(100, { page: 3, limit: 20 })
    expect(medio.hasPreviousPage).toBe(true)
    expect(medio.hasNextPage).toBe(true)

    const ultima = buildPaginationMeta(100, { page: 5, limit: 20 })
    expect(ultima.hasPreviousPage).toBe(true)
    expect(ultima.hasNextPage).toBe(false)
  })

  it('con cero resultados devuelve cero páginas y ningún vecino', () => {
    const meta = buildPaginationMeta(0, { page: 1, limit: 20 })

    expect(meta.totalPages).toBe(0)
    expect(meta.hasNextPage).toBe(false)
    expect(meta.hasPreviousPage).toBe(false)
  })

  it('una página más allá del final no ofrece siguiente', () => {
    const meta = buildPaginationMeta(10, { page: 99, limit: 20 })

    expect(meta.totalPages).toBe(1)
    expect(meta.hasNextPage).toBe(false)
  })
})

describe('paginate', () => {
  it('usa el total real y no el largo del array', () => {
    // Este es el bug que tenía el módulo de ejemplo: pasaba data.length como
    // total, con lo cual siempre reportaba una sola página.
    const result = paginate(['a', 'b', 'c'], 250, { page: 1, limit: 3 })

    expect(result.data).toHaveLength(3)
    expect(result.pagination.total).toBe(250)
    expect(result.pagination.totalPages).toBe(84)
    expect(result.pagination.hasNextPage).toBe(true)
  })
})

describe('paginateWith', () => {
  it('le pasa skip/take al fetch y arma el resultado', async () => {
    const fetch = jest.fn().mockResolvedValue([['x', 'y'], 42])

    const result = await paginateWith({ page: 3, limit: 2 }, fetch)

    expect(fetch).toHaveBeenCalledWith({ skip: 4, take: 2 })
    expect(result.data).toEqual(['x', 'y'])
    expect(result.pagination.total).toBe(42)
    expect(result.pagination.page).toBe(3)
  })
})

describe('PaginationQueryDto', () => {
  const transform = (raw: Record<string, unknown>) =>
    plainToInstance(PaginationQueryDto, raw, { exposeDefaultValues: true })

  it('convierte los query params de string a número', () => {
    // Los query params siempre llegan como string; sin @Type esto fallaría.
    const dto = transform({ page: '3', limit: '50' })

    expect(dto.page).toBe(3)
    expect(dto.limit).toBe(50)
    expect(validateSync(dto)).toHaveLength(0)
  })

  it('aplica los defaults cuando no vienen', () => {
    const dto = transform({})

    expect(dto.page).toBe(1)
    expect(dto.limit).toBe(20)
    expect(validateSync(dto)).toHaveLength(0)
  })

  it('rechaza un limit por encima del techo', () => {
    // Sin este tope, un ?limit=1000000 es un DoS gratis.
    const errors = validateSync(transform({ limit: String(MAX_LIMIT + 1) }))

    expect(errors).toHaveLength(1)
    expect(errors[0].property).toBe('limit')
  })

  it('rechaza página cero o negativa', () => {
    expect(validateSync(transform({ page: '0' }))).toHaveLength(1)
    expect(validateSync(transform({ page: '-1' }))).toHaveLength(1)
  })

  it('rechaza valores no numéricos', () => {
    expect(validateSync(transform({ page: 'abc' }))).toHaveLength(1)
    expect(validateSync(transform({ limit: '2.5' }))).toHaveLength(1)
  })
})
