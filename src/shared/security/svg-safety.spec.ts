import { isSafeSvg } from './svg-safety'

describe('isSafeSvg', () => {
  it('acepta un dibujo plano con gradientes locales', () => {
    expect(
      isSafeSvg(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
          '<defs><linearGradient id="g"/></defs>' +
          '<style>.a{fill:url(#g)}</style>' +
          '<rect class="a" width="10" height="10" fill="url(#g)"/></svg>',
      ),
    ).toBe(true)
  })

  it('acepta una imagen raster embebida en base64 y referencias locales', () => {
    expect(
      isSafeSvg(
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image href="data:image/png;base64,iVBORw0KGgo="/><use xlink:href="#a"/></svg>',
      ),
    ).toBe(true)
  })

  it.each([
    ['script', '<svg><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['manejador de evento', '<svg onload="alert(1)"></svg>'],
    ['manejador con comillas simples', "<svg><rect onclick='x()'/></svg>"],
    ['imagen externa', '<svg><image href="http://evil.test/x.png"/></svg>'],
    [
      'imagen externa por xlink',
      '<svg><image xlink:href="https://evil.test/x.png"/></svg>',
    ],
    [
      'enlace javascript',
      '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    ],
    [
      'url() externa',
      '<svg><rect style="fill:url(http://evil.test/p)"/></svg>',
    ],
    ['@import', '<svg><style>@import "http://evil.test/a.css";</style></svg>'],
    [
      'entidad XML',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    ],
    ['animación', '<svg><rect><set attributeName="x" to="1"/></rect></svg>'],
  ])('rechaza %s', (_name, svg) => {
    expect(isSafeSvg(svg)).toBe(false)
  })
})
