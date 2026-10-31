import { dirname, join, sep } from 'node:path'

import pdfmake from 'pdfmake'
import type {
  Content,
  ContentTable,
  TDocumentDefinitions,
  TFontDictionary,
} from 'pdfmake/interfaces'

import {
  PdfAlign,
  PdfBlock,
  PdfDocumentDefinition,
  PdfRendererPort,
  PdfTable,
} from '../pdf.port'

/** Las fuentes Roboto viajan con el paquete: se embeben, no se leen del sistema. */
const FONTS_DIR = join(
  dirname(require.resolve('pdfmake/package.json')),
  'fonts',
)

const FONTS: TFontDictionary = {
  Roboto: {
    normal: join(FONTS_DIR, 'Roboto', 'Roboto-Regular.ttf'),
    bold: join(FONTS_DIR, 'Roboto', 'Roboto-Medium.ttf'),
    italics: join(FONTS_DIR, 'Roboto', 'Roboto-Italic.ttf'),
    bolditalics: join(FONTS_DIR, 'Roboto', 'Roboto-MediumItalic.ttf'),
  },
}

const MUTED = '#6b7280'
const LINE = '#d1d5db'

/**
 * Renderiza con `pdfmake` (JS puro: corre en cualquier hosting, sin Chromium).
 * No baja nada de internet (el logo ya viene como `data:`) y sólo lee del
 * disco las fuentes del paquete.
 */
export class PdfmakePdfAdapter extends PdfRendererPort {
  constructor() {
    super()
    pdfmake.setFonts(FONTS)
    pdfmake.setUrlAccessPolicy(() => false)
    pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR + sep))
  }

  async render(definition: PdfDocumentDefinition): Promise<Buffer> {
    return pdfmake.createPdf(toPdfmake(definition)).getBuffer()
  }
}

/** Traducción pura de la definición a pdfmake (testeable sin renderizar). */
export function toPdfmake(
  definition: PdfDocumentDefinition,
): TDocumentDefinitions {
  const { header, footerLines } = definition
  return {
    info: { title: definition.title },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 70],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111827' },
    ...(definition.watermark
      ? {
          watermark: {
            text: definition.watermark,
            color: '#b91c1c',
            opacity: 0.18,
            bold: true,
            angle: -35,
          },
        }
      : {}),
    footer: (currentPage: number, pageCount: number): Content => ({
      margin: [40, 8, 40, 0],
      stack: [
        ...footerLines.map((text): Content => ({
          text,
          fontSize: 7.5,
          color: MUTED,
        })),
        {
          text: `Página ${currentPage} de ${pageCount}`,
          fontSize: 7.5,
          color: MUTED,
          alignment: 'right',
        },
      ],
    }),
    content: [
      headerBlock(definition),
      ...definition.blocks.map((b) => block(b, header.primaryColor)),
    ],
  }
}

function headerBlock(definition: PdfDocumentDefinition): Content {
  const { header } = definition
  const logo: Content[] = header.logoDataUri
    ? [
        header.logoDataUri.startsWith('data:image/svg+xml')
          ? {
              svg: Buffer.from(
                header.logoDataUri.split(',')[1] ?? '',
                'base64',
              ).toString('utf8'),
              fit: [90, 50],
            }
          : { image: header.logoDataUri, fit: [90, 50] },
      ]
    : []
  return {
    columns: [
      ...(logo.length > 0 ? [{ width: 100, stack: logo }] : []),
      {
        width: '*',
        stack: [
          {
            text: header.brandName,
            fontSize: 16,
            bold: true,
            color: header.primaryColor,
          },
          ...header.detailLines.map((text): Content => ({
            text,
            color: MUTED,
            fontSize: 8,
          })),
        ],
      },
    ],
    margin: [0, 0, 0, 14],
  }
}

function block(item: PdfBlock, primary: string): Content {
  switch (item.type) {
    case 'title':
      return {
        stack: [
          { text: item.text, fontSize: 14, bold: true, margin: [0, 4, 0, 0] },
          ...(item.subtitle
            ? [
                {
                  text: item.subtitle,
                  color: MUTED,
                  margin: [0, 2, 0, 0] as [number, number, number, number],
                },
              ]
            : []),
        ],
        margin: [0, 0, 0, 8],
      }
    case 'heading':
      return {
        text: item.text,
        bold: true,
        fontSize: 10.5,
        color: primary,
        margin: [0, 10, 0, 4],
      }
    case 'paragraph':
      return {
        text: item.text,
        color: item.muted ? MUTED : undefined,
        margin: [0, 2, 0, 2],
      }
    case 'spacer':
      return { text: ' ', margin: [0, 6, 0, 0] }
    case 'keyValues':
      return {
        table: {
          widths: [150, '*'],
          body: item.rows.map((row) => [
            { text: row.label, color: MUTED },
            { text: row.value, bold: row.emphasis === true },
          ]),
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 4],
      }
    case 'table':
      return tableBlock(item.table, primary)
  }
}

function tableBlock(table: PdfTable, primary: string): Content {
  const align = (a: PdfAlign | undefined) => a ?? 'left'
  if (table.rows.length === 0 && (table.totalRows?.length ?? 0) === 0) {
    return {
      text: table.emptyText ?? 'Sin datos',
      italics: true,
      color: MUTED,
      margin: [0, 0, 0, 6],
    }
  }
  const head = table.columns.map((column) => ({
    text: column.header,
    bold: true,
    color: '#ffffff',
    fillColor: primary,
    alignment: align(column.align),
  }))
  const cells = (row: string[], bold: boolean) =>
    table.columns.map((column, index) => ({
      text: row[index] ?? '',
      bold,
      alignment: align(column.align),
    }))
  const result: ContentTable = {
    table: {
      headerRows: 1,
      widths: table.columns.map((column) => column.width ?? '*'),
      body: [
        head,
        ...table.rows.map((row) => cells(row, false)),
        ...(table.totalRows ?? []).map((row) => cells(row, true)),
      ],
    },
    layout: {
      hLineColor: () => LINE,
      vLineWidth: () => 0,
      hLineWidth: () => 0.5,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 6],
  }
  return result
}
