import { BillingFacade } from '@/modules/billing/public'
import { SettlementsFacade } from '@/modules/settlements/public'
import {
  PortalDocumentNotReadyException,
  PortalEntityNotFoundException,
  PortalProfileNotFoundException,
} from '../domain/portal.exceptions'
import { AcknowledgeSettlementHandler } from './commands/acknowledge-settlement.handler'
import { PortalIdentity } from './portal-identity'
import { GetOwnerSettlementPdfUrlHandler } from './queries/owner-portal.queries'
import {
  GetRenterInstallmentHandler,
  GetRenterReceiptUrlHandler,
} from './queries/renter-portal.queries'

const identity = (overrides: Partial<PortalIdentity> = {}) =>
  ({
    renterId: jest.fn().mockResolvedValue('renter-1'),
    ownerId: jest.fn().mockResolvedValue('owner-1'),
    ...overrides,
  }) as unknown as PortalIdentity

describe('handlers del portal', () => {
  it('el recibo de un pago ajeno es un 404, no un 403', async () => {
    const billing = {
      receiptOfRenter: jest.fn().mockResolvedValue(null),
    } as unknown as BillingFacade
    const handler = new GetRenterReceiptUrlHandler(identity(), billing)
    const error = await handler
      .execute({ userId: 'u', paymentId: 'pay' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PortalEntityNotFoundException)
    expect(billing.receiptOfRenter).toHaveBeenCalledWith('renter-1', 'pay')
  })

  it('un recibo todavía sin PDF es DOCUMENT_NOT_READY', async () => {
    const billing = {
      receiptOfRenter: jest.fn().mockResolvedValue({ url: null }),
    } as unknown as BillingFacade
    const handler = new GetRenterReceiptUrlHandler(identity(), billing)
    await expect(
      handler.execute({ userId: 'u', paymentId: 'pay' }),
    ).rejects.toBeInstanceOf(PortalDocumentNotReadyException)
  })

  it('devuelve la URL del recibo cuando está listo', async () => {
    const billing = {
      receiptOfRenter: jest
        .fn()
        .mockResolvedValue({ url: 'https://pdf/r.pdf' }),
    } as unknown as BillingFacade
    const handler = new GetRenterReceiptUrlHandler(identity(), billing)
    await expect(
      handler.execute({ userId: 'u', paymentId: 'pay' }),
    ).resolves.toBe('https://pdf/r.pdf')
  })

  it('una cuota ajena es un 404', async () => {
    const billing = {
      installmentOfRenter: jest.fn().mockResolvedValue(null),
    } as unknown as BillingFacade
    const handler = new GetRenterInstallmentHandler(identity(), billing)
    await expect(
      handler.execute({ userId: 'u', installmentId: 'i' }),
    ).rejects.toBeInstanceOf(PortalEntityNotFoundException)
  })

  it('la liquidación sin PDF es DOCUMENT_NOT_READY y la ajena un 404', async () => {
    const findForOwner = jest
      .fn()
      .mockResolvedValueOnce({ pdfUrl: null })
      .mockResolvedValueOnce(null)
    const settlements = { findForOwner } as unknown as SettlementsFacade
    const handler = new GetOwnerSettlementPdfUrlHandler(identity(), settlements)
    await expect(
      handler.execute({ userId: 'u', settlementId: 's' }),
    ).rejects.toBeInstanceOf(PortalDocumentNotReadyException)
    await expect(
      handler.execute({ userId: 'u', settlementId: 's' }),
    ).rejects.toBeInstanceOf(PortalEntityNotFoundException)
    expect(findForOwner).toHaveBeenCalledWith('owner-1', 's')
  })

  it('el acuse usa el propietario del usuario logueado y una liquidación ajena es un 404', async () => {
    const acknowledgeForOwner = jest.fn().mockResolvedValue(null)
    const handler = new AcknowledgeSettlementHandler(identity(), {
      acknowledgeForOwner,
    } as unknown as SettlementsFacade)
    await expect(
      handler.execute({ userId: 'u', settlementId: 's' }),
    ).rejects.toBeInstanceOf(PortalEntityNotFoundException)
    expect(acknowledgeForOwner).toHaveBeenCalledWith('owner-1', 's')
  })

  it('un usuario sin ficha propaga PORTAL_PROFILE_NOT_FOUND', async () => {
    const billing = {} as BillingFacade
    const handler = new GetRenterInstallmentHandler(
      identity({
        renterId: jest
          .fn()
          .mockRejectedValue(new PortalProfileNotFoundException('RENTER')),
      }),
      billing,
    )
    await expect(
      handler.execute({ userId: 'u', installmentId: 'i' }),
    ).rejects.toBeInstanceOf(PortalProfileNotFoundException)
  })
})
