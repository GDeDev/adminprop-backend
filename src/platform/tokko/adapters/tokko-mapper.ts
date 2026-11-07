import { TokkoProperty } from '../tokko-source.port'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

/** Decimal como texto: Tokko manda números o strings, y nunca se opera con ellos. */
function decimalText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim()
  }
  return null
}

/**
 * Pasa una propiedad cruda de `property/search` al formato del puerto. Los
 * campos que cambien en la API real se corrigen sólo acá (la correspondencia
 * se confirma contra `properties_schema_inferred.json`, rediseño 4.2).
 */
export function mapTokkoProperty(raw: unknown): TokkoProperty | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  if (!id) return null

  const type = isRecord(raw.type) ? raw.type : null
  const location = isRecord(raw.location) ? raw.location : null

  const operations = (Array.isArray(raw.operations) ? raw.operations : [])
    .filter(isRecord)
    .map((operation) => ({
      type: text(operation.operation_type) ?? '',
      prices: (Array.isArray(operation.prices) ? operation.prices : [])
        .filter(isRecord)
        .flatMap((price) => {
          const amount = decimalText(price.price)
          const currency = text(price.currency)
          return amount && currency ? [{ currency, price: amount }] : []
        }),
    }))

  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .filter(isRecord)
    .flatMap((tag) => text(tag.name) ?? [])

  const photos = (Array.isArray(raw.photos) ? raw.photos : [])
    .filter(isRecord)
    .flatMap((photo, index) => {
      // `original` es la foto completa; `image` es la versión reducida.
      const url = text(photo.original) ?? text(photo.image)
      if (!url) return []
      return [
        {
          url,
          isFrontCover: photo.is_front_cover === true,
          order: typeof photo.order === 'number' ? photo.order : index,
        },
      ]
    })
    .sort(
      (a, b) =>
        Number(b.isFrontCover) - Number(a.isFrontCover) || a.order - b.order,
    )

  return {
    id,
    address: text(raw.address),
    fakeAddress: text(raw.fake_address),
    title: text(raw.publication_title),
    description: text(raw.description) ?? text(raw.rich_description),
    typeName: type ? text(type.name) : null,
    fullLocation: location ? text(location.full_location) : null,
    operations,
    tags,
    photos,
  }
}
