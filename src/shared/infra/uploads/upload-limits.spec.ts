import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { uploadLimits } from './upload-limits'

describe('uploadLimits', () => {
  it('limita bytes, cantidad de archivos, campos y partes', () => {
    expect(uploadLimits(2_000_000)).toEqual({
      fileSize: 2_000_000,
      files: 1,
      fields: 30,
      parts: 31,
      fieldSize: 102_400,
    })
  })

  it('con varios archivos suma sus partes al tope', () => {
    const limits = uploadLimits(10_000_000, 20)
    expect(limits.files).toBe(20)
    expect(limits.parts).toBe(50)
  })
})

/** Todos los controllers de los módulos, para revisar sus interceptores de archivos. */
function controllerSources(
  dir = join(__dirname, '../../../modules'),
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return controllerSources(path)
    return entry.name.endsWith('.controller.ts') ? [path] : []
  })
}

describe('uploadLimits en todos los controllers', () => {
  // La subida del Excel de migración tenía `limits: { fileSize }` a mano: sin
  // topes de campos ni de partes.
  it('ningún FileInterceptor/FilesInterceptor arma los límites a mano', () => {
    const offenders = controllerSources().filter((file) =>
      /limits:\s*\{/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
