/**
 * Mensajes de WhatsApp por defecto (REDISENO_FASE_14, 3 y 5). No salen solos:
 * el backoffice arma un link `wa.me` con el texto ya resuelto para que la
 * persona lo mande desde su teléfono. La fila de `whatsapp_templates` pisa
 * el default de la inmobiliaria.
 */
export interface WhatsAppVariable {
  name: string
  label: string
}

export interface DefaultWhatsAppTemplate {
  key: string
  title: string
  body: string
  variables: WhatsAppVariable[]
}

const V = {
  recipientName: { name: 'recipientName', label: 'Nombre del destinatario' },
  propertyAddress: {
    name: 'propertyAddress',
    label: 'Dirección de la propiedad',
  },
  amount: { name: 'amount', label: 'Monto' },
  period: { name: 'period', label: 'Período' },
  dueDate: { name: 'dueDate', label: 'Fecha de vencimiento' },
  daysOverdue: { name: 'daysOverdue', label: 'Días de mora' },
  lateFeeAmount: { name: 'lateFeeAmount', label: 'Punitorio' },
  agencyName: { name: 'agencyName', label: 'Nombre de la inmobiliaria' },
  agencyWhatsapp: {
    name: 'agencyWhatsapp',
    label: 'WhatsApp de la inmobiliaria',
  },
}

export const DEFAULT_WHATSAPP_TEMPLATES: DefaultWhatsAppTemplate[] = [
  {
    key: 'PAYMENT_REMINDER',
    title: 'Recordatorio de pago',
    body: 'Hola {{recipientName}}, te recordamos que el alquiler de {{propertyAddress}} de {{period}} es de {{amount}} y vence el {{dueDate}}. Cualquier duda, escribinos. {{agencyName}}',
    variables: [
      V.recipientName,
      V.propertyAddress,
      V.amount,
      V.period,
      V.dueDate,
      V.agencyName,
    ],
  },
  {
    key: 'ARREARS',
    title: 'Aviso de mora',
    body: 'Hola {{recipientName}}, la cuota de {{period}} de {{propertyAddress}} tiene {{daysOverdue}} días de atraso. Saldo: {{amount}} más {{lateFeeAmount}} de punitorio. Por favor regularizá el pago o avisanos si ya lo hiciste. {{agencyName}}',
    variables: [
      V.recipientName,
      V.propertyAddress,
      V.amount,
      V.period,
      V.daysOverdue,
      V.lateFeeAmount,
      V.agencyName,
    ],
  },
  {
    key: 'INQUIRY_FIRST_CONTACT',
    title: 'Primer contacto con una consulta',
    body: 'Hola {{recipientName}}, te escribimos de {{agencyName}} por tu consulta sobre {{propertyAddress}}. ¿Querés que coordinemos una visita?',
    variables: [V.recipientName, V.propertyAddress, V.agencyName],
  },
]

export function findDefaultWhatsAppTemplate(
  key: string,
): DefaultWhatsAppTemplate | undefined {
  return DEFAULT_WHATSAPP_TEMPLATES.find((template) => template.key === key)
}
