import { Prisma } from '@prisma/client'

import { behaviourFor } from './auditable-models'

/**
 * Modelos con `tenantId` que a propósito no pasan por el filtro, con su razón.
 * Sumar uno acá tiene que ser una decisión explícita, no un olvido.
 */
const NOT_SCOPED_ON_PURPOSE: Record<string, string> = {
  // La escribe la auditoría también desde procesos sin tenant; su lectura por
  // tenant llega con la pantalla de auditoría (Fase 20).
  AuditLog: 'escritura de sistema',
}

describe('modelos con tenant', () => {
  const modelsWithTenantId = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name)

  it('todo modelo con tenantId pasa por el filtro de tenant', () => {
    // Si este test falla, agregaste un modelo con `tenantId` y no lo
    // declaraste con `tenantScoped: true` en auditable-models.ts: sus
    // consultas verían los datos de todas las inmobiliarias.
    const unscoped = modelsWithTenantId.filter(
      (model) =>
        !behaviourFor(model).tenantScoped && !(model in NOT_SCOPED_ON_PURPOSE),
    )

    expect(unscoped).toEqual([])
  })

  it('ningún modelo sin tenantId está marcado como tenantScoped', () => {
    // El filtro le sumaría `tenantId` a un where de una tabla que no tiene esa
    // columna, y Prisma rechazaría todas sus consultas.
    const misconfigured = Prisma.dmmf.datamodel.models
      .map((model) => model.name)
      .filter(
        (model) =>
          behaviourFor(model).tenantScoped &&
          !modelsWithTenantId.includes(model),
      )

    expect(misconfigured).toEqual([])
  })
})
