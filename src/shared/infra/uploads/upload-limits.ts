/**
 * Límites de multer para las subidas. multer guarda cada archivo en memoria, y
 * con sólo `fileSize` un usuario autenticado podía mandar cualquier cantidad de
 * partes o de campos de texto en un mismo pedido (B-11 de la auditoría): el
 * tope de bytes es por archivo, no por pedido.
 */
const MAX_TEXT_FIELDS = 30

export function uploadLimits(fileSize: number, maxFiles = 1) {
  return {
    fileSize,
    files: maxFiles,
    fields: MAX_TEXT_FIELDS,
    // `parts` cuenta archivos y campos juntos.
    parts: maxFiles + MAX_TEXT_FIELDS,
    // Valor de un campo de texto; el default de multer (1 MB) es de sobra.
    fieldSize: 100 * 1024,
  }
}
