import type {
  InstallmentDetailView,
  InstallmentSummaryView,
} from '@/modules/billing/public'
import type { SettlementSummaryView } from '@/modules/settlements/public'
import {
  buildOwnerAccount,
  maskInstallmentDetailForRenter,
  maskInstallmentSummaryForRenter,
  maskSettlementDetailForOwner,
  toAgency,
} from './portal.mappers'

const user = { id: 'u1', fullName: 'Admin', email: 'admin@a.com' }

function installment(
  overrides: Partial<InstallmentSummaryView> = {},
): InstallmentSummaryView {
  return {
    id: 'i1',
    period: '2026-10',
    contract: { id: 'c1' },
    property: { id: 'p1', address: 'Calle 1' },
    renter: { id: 'r1', fullName: 'Iván' },
    owner: { id: 'o1', fullName: 'Ana' },
    currency: 'ARS',
    baseAmount: '100000.00',
    chargesTotal: '0.00',
    lateFeeAccrued: '0.00',
    lateFeeAdjusted: '0.00',
    lateFeeWaived: false,
    lateFeeBalance: '0.00',
    paidTotal: '0.00',
    rentBalance: '100000.00',
    chargesBalance: '0.00',
    totalDue: '100000.00',
    pendingConfirmationTotal: '0.00',
    status: 'PENDING',
    graceEndDate: '2026-10-10',
    feeDays: 0,
    paidAt: null,
    collectionMode: 'AGENCY',
    feeMode: 'DEDUCTED',
    createdAt: new Date('2026-10-01'),
    ...overrides,
  } as unknown as InstallmentSummaryView
}

function detail(
  overrides: Partial<InstallmentDetailView> = {},
): InstallmentDetailView {
  return {
    ...installment(),
    lateFeePercentage: '1.00',
    lateFeeGraceDays: 10,
    feePercentage: '5.00',
    feeAmount: '1000.00',
    feeOnBase: '5000.00',
    feeOnCollected: '2500.00',
    charges: [
      {
        id: 'ch1',
        concept: 'OTHER',
        description: 'Expensas',
        amount: '10.00',
        createdBy: user,
        createdAt: new Date(),
        voidedAt: null,
        voidReason: 'motivo interno',
      },
    ],
    payments: [
      {
        id: 'pay1',
        notes: 'cliente complicado',
        registeredBy: user,
        confirmedBy: user,
        voidedBy: user,
        voidReason: 'error de carga',
        settlementId: 's1',
        receiptPdfUrl: 'https://pdf/1.pdf',
      },
    ],
    lateFeeAdjustments: [
      {
        id: 'a1',
        kind: 'REDUCE',
        amount: '10.00',
        reason: 'es amigo del dueño',
        createdBy: user,
        createdAt: new Date(),
      },
    ],
    lateFeeDays: [],
    creditsAvailable: '0.00',
    notes: 'nota interna',
    updatedAt: new Date(),
    ...overrides,
  } as unknown as InstallmentDetailView
}

describe('portal mappers', () => {
  describe('inquilino', () => {
    it('el listado no muestra al propietario', () => {
      expect(maskInstallmentSummaryForRenter(installment()).owner).toBeNull()
    })

    it('la ficha no filtra quién registró, notas, motivos, liquidación ni honorarios', () => {
      const masked = maskInstallmentDetailForRenter(detail())
      expect(masked.owner).toBeNull()
      expect(masked.notes).toBeNull()
      expect(masked.feePercentage).toBe('0.00')
      expect(masked.feeAmount).toBeNull()
      expect(masked.feeOnBase).toBe('0.00')
      expect(masked.feeOnCollected).toBe('0.00')
      expect(masked.charges[0]).toMatchObject({
        createdBy: null,
        voidReason: null,
      })
      expect(masked.payments[0]).toMatchObject({
        notes: null,
        registeredBy: null,
        confirmedBy: null,
        voidedBy: null,
        voidReason: null,
        settlementId: null,
        receiptPdfUrl: 'https://pdf/1.pdf',
      })
      expect(masked.lateFeeAdjustments[0]).toMatchObject({
        reason: '',
        createdBy: null,
      })
      expect(JSON.stringify(masked)).not.toContain('amigo del dueño')
      expect(JSON.stringify(masked)).not.toContain('cliente complicado')
    })

    it('muestra los honorarios si los paga el inquilino por cuenta del propietario (A-38)', () => {
      const masked = maskInstallmentDetailForRenter(
        detail({ feeMode: 'RENTER_PAYS_ON_BEHALF' } as never),
      )
      expect(masked.feePercentage).toBe('5.00')
      expect(masked.feeAmount).toBe('1000.00')
    })
  })

  describe('propietario', () => {
    it('la liquidación no filtra usuarios internos ni notas', () => {
      const masked = maskSettlementDetailForOwner({
        id: 's1',
        adjustments: [
          {
            id: 'a',
            createdBy: user,
            voidReason: 'x',
            description: 'Retención',
          },
        ],
        transfers: [{ id: 't', notes: 'cuidado', registeredBy: user }],
        skippedExpenses: [{ expenseId: 'e' }],
        confirmedBy: user,
        cancelReason: 'motivo',
        notes: 'interna',
      } as never)
      expect(masked).toMatchObject({
        confirmedBy: null,
        cancelReason: null,
        notes: null,
        skippedExpenses: [],
      })
      expect(masked.adjustments[0]).toMatchObject({
        createdBy: null,
        voidReason: null,
        description: 'Retención',
      })
      expect(masked.transfers[0]).toMatchObject({
        notes: null,
        registeredBy: null,
      })
    })

    it('arma el estado de cuenta por propiedad y moneda con totales y liquidaciones del mes', () => {
      const settlements = [
        {
          id: 's1',
          currency: 'ARS',
          property: { id: 'p1', address: 'Calle 1' },
          netAmount: '95000.00',
          transferredTotal: '50000.00',
        },
        {
          id: 's2',
          currency: 'ARS',
          property: { id: 'p9', address: 'Calle 9' },
          netAmount: '1000.00',
          transferredTotal: '0.00',
        },
      ] as unknown as SettlementSummaryView[]
      const account = buildOwnerAccount(
        '2026-10',
        [
          installment({
            baseAmount: '100000.00',
            rentBalance: '40000.00',
            lateFeeAccrued: '500.00',
            lateFeeAdjusted: '100.00',
          }),
          installment({
            id: 'i2',
            contract: { id: 'c2' },
            property: { id: 'p2', address: 'Av. 2' },
            baseAmount: '200000.00',
            rentBalance: '0.00',
            lateFeeAccrued: '900.00',
            lateFeeWaived: true,
          }),
          installment({
            id: 'i3',
            contract: { id: 'c3' },
            currency: 'USD' as never,
            property: { id: 'p3', address: 'Zeta 3' },
            baseAmount: '500.00',
            rentBalance: '500.00',
          }),
        ],
        settlements,
        [
          {
            currency: 'ARS',
            accrued: '15000.00',
            collected: '10000.00',
            pending: '5000.00',
            unallocated: '0.00',
          } as never,
        ],
      )

      expect(account.period).toBe('2026-10')
      expect(account.properties.map((p) => p.property.id)).toEqual([
        'p2',
        'p1',
        'p9',
        'p3',
      ])
      const p1 = account.properties.find((p) => p.property.id === 'p1')
      expect(p1).toMatchObject({
        accrued: '100000.00',
        collected: '60000.00',
        pending: '40000.00',
        lateFee: '400.00',
      })
      expect(p1?.settlements.map((s) => s.id)).toEqual(['s1'])
      const p2 = account.properties.find((p) => p.property.id === 'p2')
      expect(p2).toMatchObject({ collected: '200000.00', lateFee: '0.00' })
      expect(account.totals).toEqual([
        {
          currency: 'ARS',
          accrued: '300000.00',
          collected: '260000.00',
          pending: '40000.00',
          netSettled: '96000.00',
          transferred: '50000.00',
        },
        {
          currency: 'USD',
          accrued: '500.00',
          collected: '0.00',
          pending: '500.00',
          netSettled: '0.00',
          transferred: '0.00',
        },
      ])
      expect(account.fees).toEqual([
        {
          currency: 'ARS',
          accrued: '15000.00',
          collected: '10000.00',
          pending: '5000.00',
        },
      ])
    })

    it('un mes sin cuotas ni liquidaciones da un estado de cuenta vacío', () => {
      expect(buildOwnerAccount('2026-09', [], [], [])).toEqual({
        period: '2026-09',
        properties: [],
        fees: [],
        totals: [],
      })
    })
  })

  describe('inmobiliaria', () => {
    const branding = {
      id: 't',
      name: 'Oppido',
      slug: 'oppido',
      logoUrl: null,
      primaryColor: '#c2410c',
      legalName: 'Oppido SRL',
      taxId: '30-1',
      address: 'Calle 1',
      phone: '221',
      email: 'a@a.com',
      whatsapp: '54922',
      bankAccountHolder: null,
      bankName: null,
      bankCbu: null,
      bankAlias: null,
      documentFooter: null,
    }

    it('sin datos bancarios, bankAccount es null y no expone razón social ni CUIT', () => {
      const agency = toAgency(branding)
      expect(agency.bankAccount).toBeNull()
      expect(agency).not.toHaveProperty('legalName')
      expect(agency).not.toHaveProperty('taxId')
    })

    it('con algún dato bancario lo devuelve completo', () => {
      expect(
        toAgency({ ...branding, bankAlias: 'oppido.alq' }).bankAccount,
      ).toEqual({
        holder: null,
        bank: null,
        cbu: null,
        alias: 'oppido.alq',
      })
    })
  })
})
