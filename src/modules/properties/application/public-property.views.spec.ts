import { LocationLevel } from '@/modules/master-data/public'
import {
  ListingCurrency,
  ListingOperation,
  Property,
  PropertyStatus,
} from '../domain/property'
import { PublicPropertyViews } from './public-property.views'

const PROPERTY: Property = {
  id: 'p1',
  address: 'Av. Corrientes 1234, 5° B',
  locationId: 'l1',
  propertyTypeId: 't1',
  status: PropertyStatus.AVAILABLE,
  ownerId: 'owner-secret',
  amenityIds: ['a1', 'gone'],
  notes: 'Llave en portería',
  activeContractId: 'contract-secret',
  lastContractId: 'contract-secret',
  listingPrice: '150000.00',
  listingCurrency: ListingCurrency.USD,
  publicDescription: 'Luminoso',
  needsReview: false,
  listingOperation: ListingOperation.SALE,
  bedrooms: 3,
  bathrooms: 2,
  rooms: 4,
  totalAreaM2: 85.5,
  coveredAreaM2: 70,
  ageYears: 12,
  latitude: null,
  longitude: null,
  photos: [
    {
      id: 'ph1',
      url: 'https://cdn/1.jpg',
      storageKey: 'secret-key',
      position: 0,
      createdAt: new Date(),
    },
    {
      id: 'ph2',
      url: 'https://cdn/2.jpg',
      storageKey: 'secret-key-2',
      position: 1,
      createdAt: new Date(),
    },
  ],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const location = (level: LocationLevel, name = 'Tolosa') => ({
  id: 'l1',
  name,
  isActive: true,
  level,
  path: `${name}, La Plata, Buenos Aires`,
})

function build(level = LocationLevel.NEIGHBORHOOD) {
  const masterData = {
    describeLocations: jest
      .fn()
      .mockResolvedValue(new Map([['l1', location(level)]])),
    describeCatalog: jest
      .fn()
      .mockResolvedValue(
        new Map([['t1', { id: 't1', name: 'Departamento', isActive: true }]]),
      ),
    describeAmenities: jest
      .fn()
      .mockResolvedValue(
        new Map([
          ['a1', { id: 'a1', name: 'Pileta', isActive: true, icon: null }],
        ]),
      ),
  }
  return new PublicPropertyViews(masterData as never)
}

describe('PublicPropertyViews', () => {
  it('arma el resumen del contrato público', async () => {
    const [summary] = await build().summaries([PROPERTY])

    expect(summary).toEqual({
      id: 'p1',
      title: 'Av. Corrientes 1234',
      address: 'Av. Corrientes 1234, 5° B',
      propertyType: 'Departamento',
      neighborhood: 'Tolosa',
      bedrooms: 3,
      bathrooms: 2,
      areaM2: 85.5,
      operation: 'SALE',
      rooms: 4,
      coveredAreaM2: 70,
      ageYears: 12,
      price: '150000.00',
      currency: 'USD',
      coverPhotoUrl: 'https://cdn/1.jpg',
      amenities: ['Pileta'],
    })
  })

  it('nunca expone propietario, contrato, notas ni claves de storage', async () => {
    const view = await build().detail(PROPERTY)
    const json = JSON.stringify(view)

    for (const secret of [
      'owner-secret',
      'contract-secret',
      'Llave en portería',
      'secret-key',
      'ownerId',
      'notes',
      'storageKey',
    ]) {
      expect(json).not.toContain(secret)
    }
  })

  it('sin precio es "Consultar": ni precio ni moneda', async () => {
    const [summary] = await build().summaries([
      { ...PROPERTY, listingPrice: null },
    ])

    expect(summary.price).toBeNull()
    expect(summary.currency).toBeNull()
  })

  it('el barrio sólo se informa si la ubicación es un barrio', async () => {
    const [summary] = await build(LocationLevel.CITY).summaries([PROPERTY])

    expect(summary.neighborhood).toBeNull()
  })

  it('la ficha trae todas las fotos, la ubicación corta y las características', async () => {
    const detail = await build().detail(PROPERTY)

    expect(detail.photos).toEqual([
      { id: 'ph1', url: 'https://cdn/1.jpg' },
      { id: 'ph2', url: 'https://cdn/2.jpg' },
    ])
    expect(detail.location).toBe('Tolosa, La Plata')
    expect(detail.publicDescription).toBe('Luminoso')
    expect(detail.features).toEqual([
      { label: 'Tipo', value: 'Departamento' },
      { label: 'Ubicación', value: 'Tolosa, La Plata' },
      { label: 'Ambientes', value: '4' },
      { label: 'Dormitorios', value: '3' },
      { label: 'Baños', value: '2' },
      { label: 'Superficie total', value: '85,5 m²' },
      { label: 'Superficie cubierta', value: '70 m²' },
      { label: 'Superficie descubierta', value: '15,5 m²' },
      { label: 'Antigüedad', value: '12 años' },
    ])
  })

  it('una propiedad sin datos de ficha sigue saliendo con null, como antes', async () => {
    const bare = {
      ...PROPERTY,
      bedrooms: null,
      bathrooms: null,
      rooms: null,
      totalAreaM2: null,
      coveredAreaM2: null,
      ageYears: null,
    }
    const detail = await build().detail(bare)

    expect(detail.bedrooms).toBeNull()
    expect(detail.areaM2).toBeNull()
    expect(detail.features.map((f) => f.label)).toEqual(['Tipo', 'Ubicación'])
  })

  it('los filtros salen ordenados por nombre', async () => {
    const masterData = {
      describeCatalog: jest.fn().mockResolvedValue(
        new Map([
          ['t2', { id: 't2', name: 'Casa', isActive: true }],
          ['t1', { id: 't1', name: 'Departamento', isActive: true }],
        ]),
      ),
      describeLocations: jest.fn().mockResolvedValue(new Map()),
    }
    const filters = await new PublicPropertyViews(masterData as never).filters(
      ['t1', 't2'],
      [],
    )

    expect(filters.propertyTypes.map((t) => t.name)).toEqual([
      'Casa',
      'Departamento',
    ])
    expect(filters.locations).toEqual([])
  })
})
