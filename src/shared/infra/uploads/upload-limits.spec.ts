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
