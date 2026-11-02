import { Injectable } from '@nestjs/common'

import { AuditEventInput, writeAuditEvent } from '@/shared/audit/audit-event'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * Lo que otros módulos pueden pedirle a auditoría (Fase 20): dejar constancia
 * de un evento que no sale del diff automático de Prisma. Toma tenant, usuario
 * e IP del `RequestContext`; el login, que todavía no tiene contexto, los pasa
 * explícitos. Nunca falla: un error al escribir se loguea y se sigue.
 */
@Injectable()
export class AuditFacade {
  constructor(private readonly prisma: PrismaService) {}

  record(event: AuditEventInput): Promise<void> {
    return writeAuditEvent(this.prisma, event)
  }
}
