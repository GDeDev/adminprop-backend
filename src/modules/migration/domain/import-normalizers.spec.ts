import {
  CURRENCIES,
  lookup,
  normalizeAddressKey,
  normalizePathKey,
  parseDate,
  parseMoney,
  parsePercentage,
  splitPath,
} from './import-normalizers'

describe('parseMoney', () => {
  it.each([
    ['1234.56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1234,56', '1234.56'],
    ['$ 150.000', '150000.00'],
    ['150.5', '150.50'],
    ['1,234.56', '1234.56'],
    ['US$ 2.500', '2500.00'],
  ])('%s → %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it('acepta el número que entrega Excel sin pasar por float', () => {
    expect(parseMoney(450000)).toBe('450000.00')
    expect(parseMoney(1234.5)).toBe('1234.50')
  })

  it('vacío es null y lo que no es un monto es undefined', () => {
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney('  ')).toBeNull()
    expect(parseMoney('abc')).toBeUndefined()
    expect(parseMoney('1.2.3,4,5x')).toBeUndefined()
    expect(parseMoney(Number.NaN)).toBeUndefined()
  })
})

describe('parsePercentage', () => {
  it('acepta el símbolo % y rechaza lo que está fuera de 0-100', () => {
    expect(parsePercentage('12,5 %')).toBe('12.50')
    expect(parsePercentage(100)).toBe('100.00')
    expect(parsePercentage(101)).toBeUndefined()
    expect(parsePercentage(-1)).toBeUndefined()
    expect(parsePercentage(null)).toBeNull()
  })
})

describe('parseDate', () => {
  it('lee dd/mm/aaaa, d/m/aa, aaaa-mm-dd y la fecha de Excel', () => {
    expect(parseDate('01/03/2025')).toBe('2025-03-01')
    expect(parseDate('1/3/25')).toBe('2025-03-01')
    expect(parseDate('2025-03-01')).toBe('2025-03-01')
    expect(parseDate(new Date('2025-03-01T00:00:00.000Z'))).toBe('2025-03-01')
  })

  it('rechaza fechas que no existen y devuelve null si está vacía', () => {
    expect(parseDate('31/02/2025')).toBeUndefined()
    expect(parseDate('ayer')).toBeUndefined()
    expect(parseDate('')).toBeNull()
    expect(parseDate(undefined)).toBeNull()
  })
})

describe('claves de comparación', () => {
  it('una dirección es la misma sin acentos, puntuación ni prefijo de calle', () => {
    expect(normalizeAddressKey('Av. Santa  Fé 1234')).toBe(
      normalizeAddressKey('avenida santa fe 1234'),
    )
    expect(normalizeAddressKey('Calle 12 N° 800')).toBe('12 n 800')
  })

  it('la ruta de ubicación se compara por nivel', () => {
    expect(normalizePathKey(['Buenos Aires', 'Ciudád'])).toBe(
      'buenos aires>ciudad',
    )
    expect(splitPath('Buenos Aires > CABA | Palermo')).toEqual([
      'Buenos Aires',
      'CABA',
      'Palermo',
    ])
  })
})

describe('lookup', () => {
  it('traduce valores en español, ignora acentos y no tropieza con claves del prototipo', () => {
    expect(lookup('Dólares', { dolares: 'USD' })).toBe('USD')
    expect(lookup('ARS', CURRENCIES)).toBe('ARS')
    expect(lookup('constructor', CURRENCIES)).toBeUndefined()
    expect(lookup('  ', CURRENCIES)).toBeNull()
  })
})
