import { Module } from '@nestjs/common'

import { AuditFacade } from '../../public/audit.facade'

/**
 * Sólo la escritura de eventos (`AuditFacade`). Es lo que importan auth,
 * automatizaciones y reportes. Está separado de `AuditModule` (lectura y
 * pantalla) a propósito: éste necesita las facades de propietarios,
 * inquilinos y usuarios, y auth no puede depender de ellas sin cerrar un
 * ciclo de módulos.
 */
@Module({
  providers: [AuditFacade],
  exports: [AuditFacade],
})
export class AuditRecorderModule {}
