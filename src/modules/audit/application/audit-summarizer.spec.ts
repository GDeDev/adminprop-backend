import { AuditRecord } from '../domain/audit'
import { AuditNameResolver, refKey } from './audit-name-resolver'
import { AuditSummarizer } from './audit-summarizer'

const record = (overrides: Partial<AuditRecord>): AuditRecord => ({
  id: 'r1',
  entity: 'Property',
  entityId: 'p1',
  action: 'UPDATE',
  summary: null,
  changes: null,
  actorKind: 'USER',
  userId: null,
  userEmail: null,
  ip: null,
  createdAt: new Date('2026-11-02T12:00:00Z'),
  ...overrides,
})

describe('AuditSummarizer', () => {
  const resolve = jest.fn()
  const summarizer = new AuditSummarizer({
    resolve,
  } as unknown as AuditNameResolver)

  beforeEach(() => resolve.mockReset().mockResolvedValue(new Map()))

  it('respeta la frase que ya escribió quien registró el evento', async () => {
    const result = await summarizer.summarize([
      record({ id: 'a', action: 'EXPORT', entity: 'Report', summary: 'Hola' }),
    ])
    expect(result.get('a')).toBe('Hola')
  })

  it('arma la frase con el nombre que dan las facades y los campos tocados', async () => {
    resolve.mockResolvedValue(
      new Map([[refKey('Property', 'p1'), 'Calle 1 100']]),
    )
    const result = await summarizer.summarize([
      record({
        changes: { status: { before: 'AVAILABLE', after: 'RENTED' } },
      }),
    ])
    expect(result.get('r1')).toBe('Modificó la propiedad Calle 1 100 (estado)')
    expect(resolve).toHaveBeenCalledWith([{ entity: 'Property', id: 'p1' }])
  })

  it('describe un pago nuevo con su importe en la moneda', async () => {
    const result = await summarizer.summarize([
      record({
        entity: 'Payment',
        entityId: 'pay1',
        action: 'CREATE',
        changes: {
          amount: { after: '100000.00' },
          paidCurrency: { after: 'ARS' },
        },
      }),
    ])
    expect(result.get('r1')).toBe('Registró un pago de $ 100.000,00')
  })

  it('usa el período de las cuotas y no inventa un nombre que no tiene', async () => {
    const result = await summarizer.summarize([
      record({
        id: 'i',
        entity: 'Installment',
        action: 'CREATE',
        changes: { period: { after: '2026-10' } },
      }),
      record({ id: 'o', entity: 'Owner', action: 'DELETE' }),
    ])
    expect(result.get('i')).toBe('Creó la cuota 2026-10')
    expect(result.get('o')).toBe('Eliminó el propietario')
  })

  it('resume los campos de más sin listarlos todos', () => {
    const text = summarizer.build(
      record({
        changes: {
          status: { before: 1, after: 2 },
          address: { before: 1, after: 2 },
          notes: { before: 1, after: 2 },
          email: { before: 1, after: 2 },
        },
      }),
      new Map(),
    )
    expect(text).toBe(
      'Modificó la propiedad (estado, dirección, notas y 1 más)',
    )
  })
})
