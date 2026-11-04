import { neutralizeFormula } from './import-report.service'

describe('neutralizeFormula', () => {
  // El reporte copia texto del Excel que subió el usuario: sin esto, una celda
  // "=HYPERLINK(...)" se ejecutaba al abrir el reporte.
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x'])(
    'antepone un apóstrofo a %p',
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`)
    },
  )

  it('deja pasar el texto común y los números', () => {
    expect(neutralizeFormula('Calle 123')).toBe('Calle 123')
    expect(neutralizeFormula(42)).toBe(42)
    expect(neutralizeFormula(-5)).toBe(-5)
  })
})
