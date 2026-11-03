import {
  buildTemplateVariables,
  formatDateText,
  formatPeriodText,
  recipientNameOf,
} from './notification-variables'

const agency = {
  name: 'Oppido',
  whatsapp: null,
  phone: '221 555-0000',
  portalUrl: 'https://portal.x/oppido',
}

describe('buildTemplateVariables', () => {
  it('formatea montos como texto, sin pasar por number', () => {
    const values = buildTemplateVariables(
      {
        rentBalance: '1234567.50',
        lateFeeBalance: '0.05',
        currency: 'ARS',
        period: '2026-11',
        lastDayWithoutLateFee: '2026-11-10',
        daysOverdue: 12,
      },
      'Ana',
      agency,
    )
    expect(values).toMatchObject({
      recipientName: 'Ana',
      amount: '$ 1.234.567,50',
      lateFeeAmount: '$ 0,05',
      period: '11/2026',
      dueDate: '10/11/2026',
      daysOverdue: '12',
      agencyName: 'Oppido',
      agencyWhatsapp: '221 555-0000',
      portalUrl: 'https://portal.x/oppido',
    })
  })

  it('formatea en dólares y deja vacío lo que falta', () => {
    const values = buildTemplateVariables(
      { netAmount: '1000', currency: 'USD' },
      undefined,
      agency,
    )
    expect(values.amount).toBe('US$ 1.000,00')
    expect(values.propertyAddress).toBeUndefined()
    expect(values.policyNumber).toBeUndefined()
  })

  it('un monto ilegible no rompe el envío', () => {
    expect(
      buildTemplateVariables({ amount: 'abc' }, 'Ana', agency).amount,
    ).toBeUndefined()
  })
})

describe('formatos y destinatario', () => {
  it('formatea fechas y períodos y respeta lo que no reconoce', () => {
    expect(formatDateText('2026-12-01T03:00:00Z')).toBe('01/12/2026')
    expect(formatDateText('pronto')).toBe('pronto')
    expect(formatPeriodText('2026-02')).toBe('02/2026')
    expect(formatDateText(null)).toBeUndefined()
  })

  it('elige el nombre según quién recibe', () => {
    const data = {
      renterName: 'Iván',
      ownerName: 'Juan',
      insurerName: 'Finaer',
    }
    expect(recipientNameOf('RENTER', data)).toBe('Iván')
    expect(recipientNameOf('OWNER', data)).toBe('Juan')
    expect(recipientNameOf('INSURER', data)).toBe('Finaer')
    expect(recipientNameOf('TENANT_STAFF', data)).toBeUndefined()
    expect(recipientNameOf('RENTER', { ...data, recipientName: 'Ana' })).toBe(
      'Ana',
    )
  })
})
