import { LocationIndex } from './location-index'
import {
  SheetRow,
  validateContract,
  validateGuarantor,
  validateOwner,
  validateProperty,
  validateRenter,
} from './row-validators'

const context = {
  locations: new LocationIndex([
    { id: 'ar', name: 'Argentina', level: 'COUNTRY', parentId: null },
    { id: 'ba', name: 'Buenos Aires', level: 'PROVINCE', parentId: 'ar' },
    { id: 'lp', name: 'La Plata', level: 'CITY', parentId: 'ba' },
  ]),
  propertyTypes: new Map([['departamento', 'type-1']]),
}

const row = (cells: SheetRow['cells'], rowNumber = 3): SheetRow => ({
  rowNumber,
  cells,
})
const codes = (errors: { code: string }[]) => errors.map((e) => e.code)

describe('validateOwner', () => {
  const valid = {
    firstName: ' María ',
    lastName: 'Gómez',
    nationalId: '27.123.456-9',
    email: 'MARIA@Ejemplo.com',
    cbu: '0170099220000067797370',
  }

  it('normaliza una fila válida', () => {
    const { data, errors, label } = validateOwner(row(valid))
    expect(errors).toEqual([])
    expect(data).toMatchObject({
      firstName: 'María',
      nationalId: '271234569',
      email: 'maria@ejemplo.com',
    })
    expect(label).toBe('María Gómez')
  })

  it('informa cada error con su campo y su código', () => {
    const { errors } = validateOwner(
      row({ nationalId: '12', email: 'no-es-mail', cbu: '123' }),
    )
    expect(codes(errors)).toEqual([
      'REQUIRED',
      'REQUIRED',
      'INVALID_NATIONAL_ID',
      'INVALID_EMAIL',
      'INVALID_CBU',
    ])
    expect(errors.find((e) => e.code === 'INVALID_CBU')?.field).toBe('cbu')
  })
})

describe('validateRenter y validateGuarantor', () => {
  it('el inquilino admite un garante por DNI', () => {
    const { data, errors } = validateRenter(
      row({
        firstName: 'Iván',
        lastName: 'López',
        nationalId: 30111222,
        guarantorNationalId: '20-11122233',
      }),
    )
    expect(errors).toEqual([])
    expect(data.guarantorNationalId).toBe('2011122233')
  })

  it('el garante sin detalle queda marcado para completar y un tipo desconocido es error', () => {
    const ok = validateGuarantor(
      row({ firstName: 'A', lastName: 'B', nationalId: '20111222' }),
    )
    expect(ok.errors).toEqual([])
    expect(ok.data.guaranteeType).toBe('PAYSLIPS')
    expect(ok.data.guaranteeDetail).toContain('completar')

    const bad = validateGuarantor(
      row({
        firstName: 'A',
        lastName: 'B',
        nationalId: '20111222',
        guaranteeType: 'Aval',
      }),
    )
    expect(codes(bad.errors)).toEqual(['INVALID_GUARANTEE_TYPE'])
  })
})

describe('validateProperty', () => {
  const base = {
    code: 'P-1',
    address: 'Calle 1 N° 100',
    location: 'Buenos Aires > La Plata',
    propertyType: 'Departamento',
  }

  it('resuelve ubicación y tipo existentes, amenities y precio', () => {
    const { data, errors } = validateProperty(
      row({
        ...base,
        amenities: 'Balcón, Cochera; balcón',
        listingPrice: '450.000',
        listingCurrency: 'dólares',
      }),
      context,
    )
    expect(errors).toEqual([])
    expect(data).toMatchObject({
      locationId: 'lp',
      propertyTypeId: 'type-1',
      amenityNames: ['Balcón', 'Cochera', 'balcón'],
      listingPrice: '450000.00',
    })
  })

  it('un tipo o una ruta nuevos no son error: se crean al confirmar', () => {
    const { data, errors } = validateProperty(
      row({
        ...base,
        location: 'Buenos Aires > La Plata > City Bell',
        propertyType: 'Duplex',
      }),
      context,
    )
    expect(errors).toEqual([])
    expect(data.propertyTypeId).toBeNull()
    expect(data.locationId).toBeNull()
    expect(data.locationPath).toEqual(['Buenos Aires', 'La Plata', 'City Bell'])
  })

  it('un nombre de ubicación suelto que no existe es error', () => {
    const { errors } = validateProperty(
      row({ ...base, location: 'Narnia' }),
      context,
    )
    expect(codes(errors)).toEqual(['UNKNOWN_LOCATION'])
  })

  it('exige dirección, ubicación y tipo', () => {
    const { errors } = validateProperty(row({}), context)
    expect(errors.map((e) => e.field)).toEqual([
      'address',
      'location',
      'propertyType',
    ])
  })
})

describe('validateContract', () => {
  const base = {
    propertyCode: 'P-1',
    renterNationalId: '30111222',
    startDate: '01/03/2025',
    endDate: '28/02/2027',
    initialRent: '450.000,50',
    currency: 'ARS',
  }

  it('toma defaults seguros: aumento manual anual, cobra la inmobiliaria', () => {
    const { data, errors } = validateContract(row(base), () => 'Calle 1')
    expect(errors).toEqual([])
    expect(data).toMatchObject({
      startDate: '2025-03-01',
      initialRent: '450000.50',
      rentUpdateType: 'OTHER',
      rentUpdateFrequency: 'ANNUAL',
      collectionMode: 'AGENCY',
      deposit: '0.00',
      depositCurrency: 'ARS',
      propertyLabel: 'Calle 1',
    })
  })

  it('reconoce los índices y las frecuencias en español', () => {
    const { data } = validateContract(
      row({
        ...base,
        rentUpdateType: 'ICL',
        rentUpdateFrequency: 'Trimestral',
        collectionMode: 'Propietario',
      }),
      () => null,
    )
    expect(data).toMatchObject({
      rentUpdateType: 'ICL',
      rentUpdateFrequency: 'QUARTERLY',
      collectionMode: 'OWNER_DIRECT',
    })
  })

  it('valida fechas, fin posterior al inicio y el % fijo', () => {
    const { errors } = validateContract(
      row({
        ...base,
        endDate: '01/03/2025',
        rentUpdateType: 'Fijo',
      }),
      () => null,
    )
    expect(codes(errors)).toEqual([
      'DATES_INVALID',
      'FIXED_PERCENTAGE_REQUIRED',
    ])

    const missing = validateContract(row({ propertyCode: 'P-1' }), () => null)
    expect(missing.errors.map((e) => e.field)).toEqual([
      'renterNationalId',
      'startDate',
      'endDate',
      'initialRent',
      'currency',
    ])
  })
})

describe('validateProperty: ubicaciones demasiado generales', () => {
  it('una provincia no sirve para ubicar una propiedad', () => {
    const { errors } = validateProperty(
      row({
        address: 'Calle 1',
        location: 'Buenos Aires',
        propertyType: 'Departamento',
      }),
      context,
    )
    expect(codes(errors)).toEqual(['LOCATION_TOO_GENERAL'])
  })
})
