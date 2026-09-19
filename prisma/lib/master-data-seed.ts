import { LocationLevel, Prisma, PrismaClient } from '@prisma/client'

/**
 * Catálogo base de maestros (spec Fase 5, 5). Cada inmobiliaria nace con esto
 * y después lo administra desde Configuración → Maestros.
 *
 * Idempotente: sólo agrega lo que falta, comparando nombres sin distinguir
 * mayúsculas. No reactiva ni renombra nada que la inmobiliaria haya tocado.
 */
export const BASE_PROPERTY_TYPES = [
  'Casa',
  'Departamento',
  'PH',
  'Local',
  'Oficina',
  'Terreno',
]

export const BASE_OPERATION_TYPES = ['Alquiler', 'Venta', 'Temporario']

/** Ícono de lucide para cada amenity (lo resuelve el frontend). */
export const BASE_AMENITIES: { name: string; icon: string }[] = [
  { name: 'Pileta', icon: 'waves' },
  { name: 'Cochera', icon: 'car' },
  { name: 'Parrilla', icon: 'flame' },
  { name: 'Balcón', icon: 'fence' },
  { name: 'Terraza', icon: 'sun' },
  { name: 'Ascensor', icon: 'arrow-up-down' },
]

/** Del PRD 5.8.5: los servicios dejan de ser un enum y pasan a ser un maestro. */
export const BASE_SERVICE_TYPES = [
  'Alquiler',
  'Expensas',
  'Luz',
  'Gas',
  'Agua',
  'Municipal',
  'Seguro',
]

/**
 * Ubicaciones mínimas. Las reales llegan con la importación de Tokko (Fase
 * 21); mientras tanto, lo que pide la spec para poder probar: Argentina y
 * Buenos Aires. `withSampleCities` agrega unas localidades y barrios de
 * ejemplo (sólo para la inmobiliaria demo).
 */
interface LocationSeed {
  level: LocationLevel
  name: string
  children?: LocationSeed[]
}

const BASE_LOCATIONS: LocationSeed = {
  level: LocationLevel.COUNTRY,
  name: 'Argentina',
  children: [
    { level: LocationLevel.PROVINCE, name: 'Buenos Aires' },
    { level: LocationLevel.PROVINCE, name: 'Ciudad Autónoma de Buenos Aires' },
  ],
}

const SAMPLE_LOCATIONS: LocationSeed = {
  level: LocationLevel.COUNTRY,
  name: 'Argentina',
  children: [
    {
      level: LocationLevel.PROVINCE,
      name: 'Buenos Aires',
      children: [
        {
          level: LocationLevel.CITY,
          name: 'La Plata',
          children: [
            { level: LocationLevel.NEIGHBORHOOD, name: 'Centro' },
            { level: LocationLevel.NEIGHBORHOOD, name: 'City Bell' },
            { level: LocationLevel.NEIGHBORHOOD, name: 'Tolosa' },
          ],
        },
        {
          level: LocationLevel.CITY,
          name: 'Quilmes',
          children: [{ level: LocationLevel.NEIGHBORHOOD, name: 'Bernal' }],
        },
      ],
    },
    {
      level: LocationLevel.PROVINCE,
      name: 'Ciudad Autónoma de Buenos Aires',
      children: [
        {
          level: LocationLevel.CITY,
          name: 'CABA',
          children: [
            { level: LocationLevel.NEIGHBORHOOD, name: 'Palermo' },
            { level: LocationLevel.NEIGHBORHOOD, name: 'Belgrano' },
            { level: LocationLevel.NEIGHBORHOOD, name: 'Caballito' },
          ],
        },
      ],
    },
  ],
}

/** El cliente base o una transacción: los dos sirven. */
type Db = PrismaClient | Prisma.TransactionClient

export interface MasterDataSeedResult {
  created: number
}

/**
 * Carga el catálogo base en una inmobiliaria. Usa el cliente sin extensiones
 * (por eso pasa `tenantId` a mano): corre desde scripts, fuera de un request.
 */
export async function seedBaseMasterData(
  db: Db,
  tenantId: string,
  options: { withSampleCities?: boolean } = {},
): Promise<MasterDataSeedResult> {
  let created = 0

  const flat: {
    names: string[]
    exists: (name: string) => Promise<boolean>
    create: (name: string) => Promise<unknown>
  }[] = [
    {
      names: BASE_PROPERTY_TYPES,
      exists: async (name) =>
        (await db.propertyType.count({ where: byName(tenantId, name) })) > 0,
      create: (name) => db.propertyType.create({ data: { tenantId, name } }),
    },
    {
      names: BASE_OPERATION_TYPES,
      exists: async (name) =>
        (await db.operationType.count({ where: byName(tenantId, name) })) > 0,
      create: (name) => db.operationType.create({ data: { tenantId, name } }),
    },
    {
      names: BASE_SERVICE_TYPES,
      exists: async (name) =>
        (await db.serviceType.count({ where: byName(tenantId, name) })) > 0,
      create: (name) => db.serviceType.create({ data: { tenantId, name } }),
    },
  ]

  for (const catalog of flat) {
    for (const name of catalog.names) {
      if (await catalog.exists(name)) continue
      await catalog.create(name)
      created++
    }
  }

  for (const amenity of BASE_AMENITIES) {
    const exists = await db.amenity.count({
      where: byName(tenantId, amenity.name),
    })
    if (exists) continue
    await db.amenity.create({ data: { tenantId, ...amenity } })
    created++
  }

  const tree = options.withSampleCities ? SAMPLE_LOCATIONS : BASE_LOCATIONS
  created += await seedLocation(db, tenantId, tree, null)

  return { created }
}

async function seedLocation(
  db: Db,
  tenantId: string,
  node: LocationSeed,
  parentId: string | null,
): Promise<number> {
  let created = 0
  let location = await db.location.findFirst({
    where: { ...byName(tenantId, node.name), parentId },
  })
  if (!location) {
    location = await db.location.create({
      data: { tenantId, level: node.level, name: node.name, parentId },
    })
    created++
  }
  for (const child of node.children ?? []) {
    created += await seedLocation(db, tenantId, child, location.id)
  }
  return created
}

function byName(tenantId: string, name: string) {
  return { tenantId, name: { equals: name, mode: 'insensitive' as const } }
}
