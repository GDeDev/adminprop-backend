import { MigrationController } from './migration.controller'

const limitOf = (handler: keyof MigrationController, name = 'medium') =>
  Reflect.getMetadata(
    `THROTTLER:LIMIT${name}`,
    MigrationController.prototype[handler],
  ) as number | undefined

describe('MigrationController: límites de uso', () => {
  // Qué fallaba: el módulo solo tenía el perfil global (120 por minuto), así
  // que se podían lanzar decenas de análisis de 10 MB o de llamadas a Tokko.
  it.each(['analyzeExcel', 'analyzeTokko', 'confirm', 'retryAssets'] as const)(
    '%s tiene un tope propio de 10 por minuto',
    (handler) => {
      expect(limitOf(handler)).toBe(10)
    },
  )

  it('las consultas y la plantilla siguen con el perfil global', () => {
    for (const handler of ['list', 'findOne', 'rows', 'template'] as const) {
      expect(limitOf(handler)).toBeUndefined()
    }
  })
})
