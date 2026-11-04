import { detectLogoFormat, findUnsafeSvgReason } from './tenant-logo'

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

describe('findUnsafeSvgReason', () => {
  const svg = (body: string, attrs = '') =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`,
    )

  it('acepta un logo vectorial común', () => {
    expect(
      findUnsafeSvgReason(
        svg(
          '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="4"/><image href="data:image/png;base64,AAAA"/><use href="#g"/>',
          'viewBox="0 0 4 4"',
        ),
      ),
    ).toBeNull()
  })

  // Un SVG abierto directo desde el storage ejecuta lo que traiga (B-3).
  it.each([
    ['un script', '<script>alert(1)</script>'],
    ['un handler de evento', '<rect onclick="alert(1)"/>'],
    ['un onload en la raíz', ''],
    ['un foreignObject', '<foreignObject><div/></foreignObject>'],
    ['un href a javascript', '<a href="javascript:alert(1)"><rect/></a>'],
    ['un href externo', '<image href="https://evil.example/x.png"/>'],
    ['un javascript ofuscado con entidades', '<a href="&#106;avascript:x"/>'],
    [
      'un set que reescribe el href',
      '<a><set attributeName="href" to="x"/></a>',
    ],
    ['un @import', '<style>@import "https://evil.example/a.css";</style>'],
    ['una entidad declarada', '<!DOCTYPE svg [<!ENTITY a "b">]><rect/>'],
  ])('rechaza %s', (name, body) => {
    const file =
      name === 'un onload en la raíz'
        ? svg('<rect/>', 'onload="alert(1)"')
        : svg(body)
    expect(findUnsafeSvgReason(file)).not.toBeNull()
  })
})
