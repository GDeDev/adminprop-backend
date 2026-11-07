import { PdfDocumentDefinition } from '../pdf.port'
import { PdfmakePdfAdapter, toPdfmake } from './pdfmake.pdf-adapter'

/** PNG de 1×1 píxel. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const definition = (
  overrides: Partial<PdfDocumentDefinition> = {},
): PdfDocumentDefinition => ({
  title: 'Prueba',
  header: {
    brandName: 'Inmobiliaria Ñandú',
    primaryColor: '#1f4e79',
    detailLines: ['CUIT 30-12345678-9'],
  },
  blocks: [
    { type: 'title', text: 'Liquidación', subtitle: 'Octubre 2026' },
    { type: 'heading', text: 'Pagos' },
    {
      type: 'table',
      table: {
        columns: [
          { header: 'Cuota' },
          { header: 'Monto', align: 'right', width: 80 },
        ],
        rows: [['2026-10', '$ 1.000,00']],
        totalRows: [['Total', '$ 1.000,00']],
      },
    },
    {
      type: 'keyValues',
      rows: [{ label: 'Neto', value: '$ 900,00', emphasis: true }],
    },
    { type: 'paragraph', text: 'Áéíóú ñ — texto con tildes' },
  ],
  footerLines: ['Documento generado el 2026-10-31'],
  ...overrides,
})

describe('PdfmakePdfAdapter', () => {
  const adapter = new PdfmakePdfAdapter()

  it('devuelve un PDF válido de más de 1 KB', async () => {
    const buffer = await adapter.render(definition())

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1024)
  })

  it('embebe el logo y la marca de agua sin romper', async () => {
    const buffer = await adapter.render(
      definition({
        header: {
          brandName: 'Con logo',
          primaryColor: '#000000',
          detailLines: [],
          logoDataUri: PNG_1X1,
        },
        watermark: 'ANULADO',
      }),
    )

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('una tabla sin filas muestra el texto de vacío en lugar de la grilla', () => {
    const converted = toPdfmake(
      definition({
        blocks: [
          {
            type: 'table',
            table: {
              columns: [{ header: 'A' }],
              rows: [],
              emptyText: 'Nada por acá',
            },
          },
        ],
      }),
    )

    expect(JSON.stringify(converted.content)).toContain('Nada por acá')
  })
})
