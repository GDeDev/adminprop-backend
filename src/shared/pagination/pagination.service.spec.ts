import { PaginationService } from './pagination.service'

describe('PaginationService', () => {
  const service = new PaginationService()

  it('calcula el offset igual que siempre', () => {
    expect(service.calculateOffset(1, 20)).toBe(0)
    expect(service.calculateOffset(2, 20)).toBe(20)
    expect(service.calculateOffset(7, 15)).toBe(90)
  })

  it('calcula el total de páginas redondeando para arriba', () => {
    expect(service.createPaginationMetadata(1, 20, 137).totalPages).toBe(7)
    expect(service.createPaginationMetadata(1, 20, 140).totalPages).toBe(7)
    expect(service.createPaginationMetadata(1, 20, 141).totalPages).toBe(8)
  })

  it('devuelve la misma metadata que los helpers nuevos', () => {
    // La única implementación de la matemática vive en pagination.ts; esto sólo
    // verifica que el wrapper no la reinterprete.
    const meta = service.createPaginationMetadata(3, 20, 100)

    expect(meta).toEqual({
      page: 3,
      limit: 20,
      total: 100,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: true,
    })
  })

  it('no rompe con cero registros', () => {
    // El servicio viejo devolvía totalPages: 0 acá; se mantiene.
    const meta = service.createPaginationMetadata(1, 20, 0)

    expect(meta.totalPages).toBe(0)
    expect(meta.hasNextPage).toBe(false)
  })
})
