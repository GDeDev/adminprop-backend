import { Role } from '@/domain/auth/enums/role.enum'
import { RequestContext } from './request-context'

describe('RequestContext', () => {
  it('devuelve undefined fuera de un request', () => {
    // Tareas programadas, scripts y el arranque corren fuera de todo scope.
    expect(RequestContext.get()).toBeUndefined()
    expect(RequestContext.correlationId).toBeUndefined()
  })

  it('expone los datos dentro del scope', () => {
    RequestContext.run({ correlationId: 'abc-123' }, () => {
      expect(RequestContext.correlationId).toBe('abc-123')
    })
  })

  it('sobrevive a los await', async () => {
    // Este es el punto de todo: si el contexto no cruzara los await, no serviría
    // para nada en handlers async, que es donde lo necesitamos.
    await RequestContext.run({ correlationId: 'abc-123' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(RequestContext.correlationId).toBe('abc-123')

      await Promise.resolve()
      expect(RequestContext.correlationId).toBe('abc-123')
    })
  })

  it('no se filtra entre requests concurrentes', async () => {
    // Dos requests en paralelo no pueden verse el contexto entre sí.
    const capture = async (id: string, delay: number) =>
      RequestContext.run({ correlationId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay))
        return RequestContext.correlationId
      })

    const [primero, segundo] = await Promise.all([
      capture('request-1', 30),
      capture('request-2', 5),
    ])

    expect(primero).toBe('request-1')
    expect(segundo).toBe('request-2')
  })

  it('setUser completa el usuario ya abierto el scope', async () => {
    // El guard corre después del middleware, así que tiene que poder sumar
    // datos a un contexto que ya está andando.
    await RequestContext.run({ correlationId: 'abc' }, async () => {
      expect(RequestContext.userId).toBeUndefined()

      RequestContext.setUser({
        id: 'user-1',
        email: 'ana@ejemplo.com',
        role: Role.ADMIN,
        tenantId: 'tenant-1',
      })

      await Promise.resolve()

      expect(RequestContext.userId).toBe('user-1')
      expect(RequestContext.get()?.userRole).toBe(Role.ADMIN)
      expect(RequestContext.tenantId).toBe('tenant-1')
    })
  })

  it('setUser fuera de un scope no rompe', () => {
    expect(() =>
      RequestContext.setUser({
        id: 'x',
        email: 'x@x.com',
        role: Role.EMPLOYEE,
        tenantId: 'tenant-1',
      }),
    ).not.toThrow()
  })
})
