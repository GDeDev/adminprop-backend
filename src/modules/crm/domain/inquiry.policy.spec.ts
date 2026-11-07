import { InquiryStage } from './inquiry'
import { InquiryPolicy, POSITION_STEP } from './inquiry.policy'

const NOW = new Date('2026-11-05T12:00:00Z')

describe('InquiryPolicy.applyStage', () => {
  const open = {
    stage: InquiryStage.NEW,
    lastContactAt: null,
    lostReason: null,
    closedAt: null,
    contractId: null,
  }

  it('salir de NEW fija el primer contacto', () => {
    const change = InquiryPolicy.applyStage(open, InquiryStage.CONTACTED, NOW)
    expect(change.lastContactAt).toEqual(NOW)
    expect(change.closedAt).toBeNull()
  })

  it('no pisa un primer contacto anterior', () => {
    const before = new Date('2026-11-01T00:00:00Z')
    const change = InquiryPolicy.applyStage(
      { ...open, stage: InquiryStage.CONTACTED, lastContactAt: before },
      InquiryStage.VISIT_SCHEDULED,
      NOW,
    )
    expect(change.lastContactAt).toEqual(before)
  })

  it('cerrar como perdida guarda el motivo y el cierre', () => {
    const change = InquiryPolicy.applyStage(
      open,
      InquiryStage.CLOSED_LOST,
      NOW,
      {
        lostReason: ' Precio ',
      },
    )
    expect(change.lostReason).toBe('Precio')
    expect(change.closedAt).toEqual(NOW)
  })

  it('cerrar como ganada admite contrato', () => {
    const change = InquiryPolicy.applyStage(
      open,
      InquiryStage.CLOSED_WON,
      NOW,
      {
        contractId: 'c1',
      },
    )
    expect(change.contractId).toBe('c1')
    expect(change.lostReason).toBeNull()
  })

  it('reabrir limpia el cierre', () => {
    const change = InquiryPolicy.applyStage(
      {
        ...open,
        stage: InquiryStage.CLOSED_LOST,
        lostReason: 'Precio',
        closedAt: NOW,
      },
      InquiryStage.CONTACTED,
      NOW,
    )
    expect(change.closedAt).toBeNull()
    expect(change.lostReason).toBeNull()
  })
})

describe('InquiryPolicy', () => {
  it('CLOSED_LOST exige motivo', () => {
    expect(
      InquiryPolicy.lostReasonMissing(InquiryStage.CLOSED_LOST, '  '),
    ).toBe(true)
    expect(InquiryPolicy.lostReasonMissing(InquiryStage.CLOSED_LOST, 'x')).toBe(
      false,
    )
    expect(InquiryPolicy.lostReasonMissing(InquiryStage.CONTACTED)).toBe(false)
  })

  it('exige al menos un medio de contacto', () => {
    expect(InquiryPolicy.hasContact(null, ' ')).toBe(false)
    expect(InquiryPolicy.hasContact(null, '221 555')).toBe(true)
  })

  it('calcula la posición entre vecinos y en los extremos', () => {
    expect(InquiryPolicy.positionBetween(null, null)).toBe(POSITION_STEP)
    expect(InquiryPolicy.positionBetween(null, 1000)).toBe(0)
    expect(InquiryPolicy.positionBetween(2000, null)).toBe(3000)
    expect(InquiryPolicy.positionBetween(1000, 2000)).toBe(1500)
  })

  it('pide renumerar cuando se agota la precisión', () => {
    expect(InquiryPolicy.positionBetween(1, 1 + 1e-9)).toBeNull()
    expect(InquiryPolicy.renumber(3)).toEqual([1000, 2000, 3000])
  })

  it('conversión con un decimal o null', () => {
    expect(InquiryPolicy.conversionRate(1, 8)).toBe('12.5')
    expect(InquiryPolicy.conversionRate(0, 0)).toBeNull()
  })

  it('promedio de horas hasta el primer contacto', () => {
    expect(InquiryPolicy.averageHours([])).toBeNull()
    expect(InquiryPolicy.averageHours([3_600_000, 7_200_000])).toBe(1.5)
  })

  it('recorta el mensaje a 140 caracteres y calcula la antigüedad', () => {
    expect(InquiryPolicy.excerpt('a'.repeat(200))).toHaveLength(140)
    expect(InquiryPolicy.ageHours(new Date('2026-11-05T09:30:00Z'), NOW)).toBe(
      2,
    )
  })
})
