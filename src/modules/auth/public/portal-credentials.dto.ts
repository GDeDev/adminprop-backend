import { ApiProperty } from '@nestjs/swagger'

import { PortalCredentials } from './portal-accounts.facade'

/**
 * Respuesta de "generar acceso al portal", compartida por propietarios e
 * inquilinos: un solo esquema en el OpenAPI, no uno por módulo.
 */
export class PortalCredentialsDto implements PortalCredentials {
  @ApiProperty() userId: string
  @ApiProperty({ description: 'Usuario del portal' }) email: string
  @ApiProperty({
    description: 'Se muestra una sola vez: no se puede recuperar',
  })
  password: string
}
