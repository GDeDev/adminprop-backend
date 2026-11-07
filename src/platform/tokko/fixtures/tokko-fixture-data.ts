/**
 * Muestra reducida de Tokko (rediseño 4.1): sin datos personales y con la forma
 * de `property/search` que mapea `tokko-mapper.ts`. Es lo que sirve
 * `TOKKO_SOURCE=fixture` (el default, y lo único que usan los tests y el CI).
 *
 * Cubre los casos que el importador tiene que manejar: alquiler y venta,
 * dirección real y `fake_address`, sin ubicación, con y sin fotos y con tags.
 * Los ids y los textos son inventados.
 */
export const TOKKO_FIXTURE_DICTIONARIES = {
  property_type: [
    { id: 1, name: 'Departamento' },
    { id: 2, name: 'Casa' },
    { id: 3, name: 'PH' },
    { id: 4, name: 'Local' },
    { id: 5, name: 'Oficina' },
  ],
  property_tags: [
    { id: 11, name: 'Balcón' },
    { id: 12, name: 'Cochera' },
    { id: 13, name: 'Pileta' },
    { id: 14, name: 'Parrilla' },
    { id: 15, name: 'Aire acondicionado' },
  ],
  operation_type: [
    { id: 1, name: 'Venta' },
    { id: 2, name: 'Alquiler' },
    { id: 3, name: 'Alquiler temporario' },
  ],
}

export const TOKKO_FIXTURE_LOCATIONS = [
  'Palermo',
  'Belgrano',
  'Caballito',
  'La Plata',
]

const photo = (id: number, order: number, cover = false) => ({
  image: `https://fixtures.tokko.test/photos/${id}-${order}-thumb.jpg`,
  original: `https://fixtures.tokko.test/photos/${id}-${order}.jpg`,
  is_front_cover: cover,
  order,
})

const rent = (amount: number, currency = 'ARS') => ({
  operation_type: 'Rent',
  prices: [{ price: amount, currency }],
})

export const TOKKO_FIXTURE_PROPERTIES: unknown[] = [
  {
    id: 90001,
    address: 'Av. Santa Fe 3540 5° A',
    fake_address: 'Av. Santa Fe al 3500',
    publication_title: 'Departamento luminoso en Palermo',
    description: 'Dos ambientes con balcón al frente, a metros del subte.',
    type: { id: 1, name: 'Departamento' },
    location: { full_location: 'Argentina | Capital Federal | Palermo' },
    operations: [rent(520000)],
    tags: [{ name: 'Balcón' }, { name: 'Aire acondicionado' }],
    photos: [photo(90001, 1), photo(90001, 0, true), photo(90001, 2)],
  },
  {
    id: 90002,
    address: 'Cuba 2210',
    fake_address: 'Cuba al 2200',
    publication_title: 'Casa con parrilla y pileta',
    description: 'Casa de tres dormitorios con jardín.',
    type: { id: 2, name: 'Casa' },
    location: { full_location: 'Argentina | Capital Federal | Belgrano' },
    operations: [
      rent(950000),
      { operation_type: 'Sale', prices: [{ price: 210000, currency: 'USD' }] },
    ],
    tags: [{ name: 'Pileta' }, { name: 'Parrilla' }, { name: 'Cochera' }],
    photos: [photo(90002, 0, true)],
  },
  {
    id: 90003,
    // Sin dirección real: el importador usa la de fachada.
    address: '',
    fake_address: 'Av. Rivadavia al 5100',
    publication_title: 'PH reciclado',
    description: null,
    type: { id: 3, name: 'PH' },
    location: { full_location: 'Argentina | Capital Federal | Caballito' },
    operations: [rent(380, 'USD')],
    tags: [{ name: 'Balcón' }],
    photos: [],
  },
  {
    id: 90004,
    address: 'Diagonal 74 N° 1200',
    fake_address: '',
    publication_title: 'Local sobre diagonal',
    description: 'Local a la calle.',
    type: { id: 4, name: 'Local' },
    // Sin ubicación: queda con el comodín y marcada para revisar.
    location: null,
    operations: [rent(700000)],
    tags: [],
    photos: [photo(90004, 0, true), photo(90004, 1)],
  },
  {
    id: 90005,
    address: 'Calle 12 e/ 50 y 51 N° 800',
    fake_address: '',
    publication_title: 'Oficina en el centro',
    description: 'Oficina de 60 m².',
    type: { id: 5, name: 'Oficina' },
    location: { full_location: 'Argentina | Buenos Aires | La Plata' },
    operations: [rent(310000)],
    tags: [{ name: 'Aire acondicionado' }],
    photos: [photo(90005, 0, true)],
  },
  {
    id: 90006,
    // Sólo venta: no se importa con el filtro por defecto (alquiler).
    address: 'Av. Cabildo 2000',
    fake_address: '',
    publication_title: 'Departamento en venta',
    description: null,
    type: { id: 1, name: 'Departamento' },
    location: { full_location: 'Argentina | Capital Federal | Belgrano' },
    operations: [
      { operation_type: 'Sale', prices: [{ price: 150000, currency: 'USD' }] },
    ],
    tags: [],
    photos: [],
  },
]
