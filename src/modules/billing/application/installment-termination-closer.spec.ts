import { InstallmentRepository } from '../domain/billing.ports'
import { installment } from '../domain/installment.policy.spec'
import { InstallmentTerminationCloser } from './installment-termination-closer'

describe('InstallmentTerminationCloser (alto 7, D-262)', () => {
  // Contrato con fin 30/06/2027 rescindido el 30/11: la multa ya cuenta
  // diciembre como canon futuro. Antes la cuota de diciembre generada el 28/11
  // seguía debiéndose y corriendo punitorio.
  function setup(untouched: Record<string, boolean>) {
    const installments = {
      listAll: jest
        .fn()
        .mockResolvedValue([
          installment({ id: 'nov', period: '2026-11' }),
          installment({ id: 'dic', period: '2026-12' }),
          installment({ id: 'ene', period: '2027-01' }),
        ]),
      deleteIfUntouched: jest.fn(async (id: string) => untouched[id] ?? false),
    }
    const closer = new InstallmentTerminationCloser(
      installments as unknown as InstallmentRepository,
    )
    return { closer, installments }
  }

  it('borra las cuotas sin movimientos de los meses posteriores a la rescisión; la del mes queda', async () => {
    const { closer, installments } = setup({ dic: true, ene: true })
    const result = await closer.close('contract-1', '2026-11-30')
    expect(installments.listAll).toHaveBeenCalledWith({
      contractId: 'contract-1',
      periodFrom: '2026-12',
    })
    expect(installments.deleteIfUntouched).not.toHaveBeenCalledWith('nov')
    expect(result).toEqual({ removed: ['2026-12', '2027-01'], kept: [] })
  })

  it('las que tienen movimientos quedan y se informan', async () => {
    const { closer } = setup({ dic: false, ene: true })
    const result = await closer.close('contract-1', '2026-11-30')
    expect(result).toEqual({ removed: ['2027-01'], kept: ['2026-12'] })
  })
})
