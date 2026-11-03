/**
 * Llegó una consulta del portal. Lo escucha `NotifyStaffOnInquiryHandler`
 * (aviso interno + email a la inmobiliaria). Lleva todo lo que necesita para
 * no volver a consultar la base.
 */
export class PublicInquiryCreatedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly tenantEmail: string | null,
    public readonly inquiryId: string,
    public readonly name: string,
    public readonly email: string,
    public readonly phone: string,
    public readonly message: string,
    public readonly property: { id: string; address: string } | null,
  ) {}
}
