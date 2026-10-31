import { detectLogoFormat } from './tenant-logo'

describe('detectLogoFormat', () => {
  it('reconoce PNG, JPG y WebP por sus primeros bytes', () => {
    expect(
      detectLogoFormat(Buffer.from('89504e470d0a1a0a0000', 'hex'))?.extension,
    ).toBe('png')
    expect(
      detectLogoFormat(Buffer.from('ffd8ffe000104a46', 'hex'))?.extension,
    ).toBe('jpg')
    expect(
      detectLogoFormat(
        Buffer.concat([
          Buffer.from('RIFF'),
          Buffer.alloc(4),
          Buffer.from('WEBPVP8 '),
        ]),
      )?.extension,
    ).toBe('webp')
  })

  it('reconoce un SVG, con o sin prólogo XML', () => {
    expect(
      detectLogoFormat(Buffer.from('<svg xmlns="x"></svg>'))?.extension,
    ).toBe('svg')
    expect(
      detectLogoFormat(Buffer.from('<?xml version="1.0"?>\n<svg width="1"/>'))
        ?.extension,
    ).toBe('svg')
  })

  it('rechaza lo que no es una imagen aceptada', () => {
    expect(detectLogoFormat(Buffer.from('%PDF-1.4'))).toBeNull()
    expect(detectLogoFormat(Buffer.from('<html><svg></svg></html>'))).toBeNull()
    expect(detectLogoFormat(Buffer.alloc(0))).toBeNull()
  })
})
