#!/usr/bin/env node
/**
 * Genera `migracion-ejemplo-ficticio.xlsx`: un Excel de prueba para el ETL de
 * Adminprop con datos 100 % ficticios (nombres inventados, DNIs 9xxxxxxx que no
 * corresponden a nadie, CBUs de los tests del repo).
 *
 * Parte de la PLANTILLA REAL (la que baja el backend), no de un Excel armado a
 * mano: así los encabezados, la hoja Meta (versión) y las listas son los de
 * verdad.
 *
 * Uso:
 *   1. Con la API levantada y un token de administrador:
 *        curl -s -o plantilla.xlsx -H "authorization: Bearer $TOKEN" \
 *          http://localhost:3000/api/v1/migration/excel/template
 *   2. node docs/migracion/ejemplo/generar-excel-ejemplo.js plantilla.xlsx salida.xlsx
 *
 * La fila 2 de cada hoja (el ejemplo en gris de la plantilla) se deja como
 * está: el importador la ignora. Los datos empiezan en la fila 3.
 *
 * Cada fila lleva en la última columna («Notas») qué se espera que pase, para
 * poder leer el reporte contra esa expectativa.
 */
const path = require('node:path')
const ExcelJS = require('exceljs')

const [, , templatePath, outPath] = process.argv
if (!templatePath || !outPath) {
  console.error('Uso: node generar-excel-ejemplo.js <plantilla.xlsx> <salida.xlsx>')
  process.exit(1)
}

// Columnas de cada hoja, en el orden de la plantilla. Se completan por
// ENCABEZADO (no por posición), igual que lo hace el importador.
const OWNERS = [
  // Nombre, Apellido, DNI/CUIT, Teléfono, Email, Domicilio, CBU, Alias, Banco, Titular, Notas
  {
    Nombre: 'Lucía',
    Apellido: 'Fernández (ficticia)',
    'DNI/CUIT': '90000001',
    Teléfono: '11 5555-0001',
    Email: 'lucia@ejemplo.test',
    Domicilio: 'Calle Falsa 123, La Plata',
    CBU: '0110599552000000123456',
    Alias: 'lucia.prueba.mp',
    Banco: 'Banco de Prueba',
    Titular: 'Lucía Fernández',
    Notas: 'ESPERADO: válida (CBU con dígitos verificadores correctos)',
  },
  {
    Nombre: 'Roberto',
    Apellido: 'Sosa (ficticio)',
    'DNI/CUIT': '90000002',
    Notas: 'ESPERADO: válida, sin CBU ni contacto',
  },
  {
    Nombre: 'Carlos',
    Apellido: 'DniMalo',
    'DNI/CUIT': 'ABC123',
    Notas: 'ESPERADO: error INVALID_NATIONAL_ID',
  },
  {
    Nombre: 'Elena',
    Apellido: 'CbuMalo',
    'DNI/CUIT': '90000004',
    CBU: '0110599452000000123456',
    Notas: 'ESPERADO: error INVALID_CBU (dígito verificador mal)',
  },
  {
    Nombre: 'Mario',
    Apellido: 'CbuCorto',
    'DNI/CUIT': '90000005',
    CBU: '01105995520000001234',
    Notas: 'ESPERADO: error INVALID_CBU (20 dígitos en vez de 22)',
  },
  {
    Nombre: 'Lucía',
    Apellido: 'Repetida',
    'DNI/CUIT': '90000001',
    Notas: 'ESPERADO: conflicto DUPLICATE_IN_FILE (mismo DNI que la fila 3)',
  },
  {
    Nombre: 'Sofía',
    Apellido: 'EmailMalo',
    'DNI/CUIT': '90000007',
    Email: 'sofia(arroba)ejemplo.test',
    Notas: 'ESPERADO: error INVALID_EMAIL',
  },
  {
    Nombre: 'Tomás',
    Apellido: 'ConPuntos',
    'DNI/CUIT': '90.000.008',
    Notas: 'ESPERADO: válida (el DNI con puntos se normaliza a 90000008)',
  },
]

const GUARANTORS = [
  {
    Nombre: 'Hugo',
    Apellido: 'Garante (ficticio)',
    'DNI/CUIT': '90100001',
    'Tipo de garantía': 'Recibos de sueldo',
    'Detalle de la garantía': 'Empleado en relación de dependencia',
    Notas: 'ESPERADO: válido',
  },
  {
    Nombre: 'Irene',
    Apellido: 'TipoMalo',
    'DNI/CUIT': '90100002',
    'Tipo de garantía': 'Aval bancario',
    Notas: 'ESPERADO: error INVALID_GUARANTEE_TYPE',
  },
  {
    Nombre: 'Julio',
    Apellido: 'SinTipo',
    'DNI/CUIT': '90100003',
    Notas:
      'ESPERADO: válido; se carga como Recibos de sueldo con detalle «Importado sin detalle: completar»',
  },
]

const RENTERS = [
  {
    Nombre: 'Pedro',
    Apellido: 'Inquilino (ficticio)',
    'DNI/CUIT': '90200001',
    Email: 'pedro@ejemplo.test',
    'DNI del garante': '90100001',
    Notas: 'ESPERADO: válido, con garante de la hoja Garantes',
  },
  {
    Nombre: 'Ana',
    Apellido: 'Inquilina (ficticia)',
    'DNI/CUIT': '90200002',
    Notas: 'ESPERADO: válida, sin garante',
  },
  {
    Nombre: 'Juan',
    Apellido: 'GaranteFaltante',
    'DNI/CUIT': '90200003',
    'DNI del garante': '90100099',
    Notas: 'A VER: DNI de garante que no está en el archivo ni en el sistema',
  },
  {
    Nombre: 'Marta',
    Apellido: 'Inquilina (ficticia)',
    'DNI/CUIT': '90200004',
    Notas: 'ESPERADO: válida',
  },
  {
    Nombre: 'Sin',
    Apellido: 'DniCorto',
    'DNI/CUIT': '12345',
    Notas: 'ESPERADO: error INVALID_NATIONAL_ID (5 dígitos)',
  },
]

const LOC_LP = 'Buenos Aires > La Plata > Centro'
const PROPERTIES = [
  {
    Código: 'P-001',
    Dirección: 'Av. Santa Fe 1234 3° B',
    Ubicación: LOC_LP,
    Tipo: 'Departamento',
    'DNI del propietario': '90000001',
    'Amenities (separados por coma)': 'Balcón, Cochera',
    'Precio de publicación': 450000,
    Moneda: 'ARS',
    Notas: 'ESPERADO: válida; crea la ciudad La Plata y el barrio Centro',
  },
  {
    Código: 'P-002',
    Dirección: 'Calle 7 N° 850',
    Ubicación: LOC_LP,
    Tipo: 'Casa',
    'DNI del propietario': '90000002',
    'Precio de publicación': '$ 1.250.000,50',
    Moneda: 'ARS',
    Notas: 'ESPERADO: válida; el precio con $ y formato argentino se entiende',
  },
  {
    Código: 'P-003',
    Dirección: 'Diagonal 74 N° 100',
    Ubicación: LOC_LP,
    Tipo: 'Departamento',
    'DNI del propietario': '90000001',
    'Precio de publicación': 300,
    Moneda: 'EUR',
    Notas: 'ESPERADO: error INVALID_CURRENCY (EUR no existe)',
  },
  {
    Código: 'P-004',
    Dirección: 'avenida santa fe 1234 3 b',
    Ubicación: LOC_LP,
    Tipo: 'Departamento',
    Notas:
      'ESPERADO: conflicto DUPLICATE_IN_FILE (misma dirección normalizada que P-001)',
  },
  {
    Código: 'P-005',
    Dirección: 'Belgrano 500',
    Ubicación: 'Barrio Inexistente',
    Tipo: 'Casa',
    Notas: 'ESPERADO: error UNKNOWN_LOCATION (nombre suelto que no existe)',
  },
  {
    Código: 'P-006',
    Dirección: 'Moreno 20',
    Ubicación: 'Buenos Aires > Mar del Plata',
    Tipo: 'Local',
    'DNI del propietario': '90000099',
    Notas: 'A VER: dueño que no está en el archivo ni en el sistema',
  },
  {
    Código: 'P-007',
    Dirección: 'Calle 12 N° 300',
    Ubicación: LOC_LP,
    Tipo: 'Casa',
    'DNI del propietario': '90.000.008',
    Notas: 'ESPERADO: válida; DNI del dueño con puntos',
  },
  {
    Código: 'P-008',
    Dirección: 'Sin ubicación 1',
    Tipo: 'Casa',
    Notas: 'ESPERADO: error REQUIRED en ubicación',
  },
  {
    Código: 'P-009',
    Dirección: 'Solo provincia 2',
    Ubicación: 'Ciudad Autónoma de Buenos Aires',
    Tipo: 'Casa',
    Notas: 'ESPERADO: error LOCATION_TOO_GENERAL (una provincia no es ubicación)',
  },
  {
    Código: 'P-010',
    Dirección: 'Calle 60 N° 777',
    Ubicación: LOC_LP,
    Tipo: 'Galpón',
    Notas:
      'ESPERADO: válida; sin propietario; crea el tipo «Galpón» al confirmar',
  },
]

const CONTRACTS = [
  {
    'Código de propiedad': 'P-001',
    'DNI del inquilino': '90200001',
    Inicio: '01/03/2025',
    Fin: '28/02/2027',
    'Alquiler inicial': 450000,
    Moneda: 'ARS',
    'Índice de aumento': 'ICL',
    'Frecuencia de aumento': 'Trimestral',
    Depósito: 450000,
    'Moneda del depósito': 'ARS',
    'Modalidad de cobro': 'Inmobiliaria',
    Notas: 'ACTIVO: sin punitorio configurado debería fallar al confirmar',
  },
  {
    'Código de propiedad': 'P-002',
    'DNI del inquilino': '90200002',
    Inicio: '01/01/2022',
    Fin: '31/12/2023',
    'Alquiler inicial': '1.000.000,50',
    Moneda: 'ARS',
    'Índice de aumento': 'IPC',
    'Frecuencia de aumento': 'Semestral',
    Notas: 'TERMINADO (fin en el pasado): se carga como Finalizado',
  },
  {
    'Código de propiedad': 'P-007',
    'DNI del inquilino': '90200003',
    Inicio: '31/02/2025',
    Fin: '31/01/2027',
    'Alquiler inicial': 200000,
    Moneda: 'ARS',
    Notas: 'ESPERADO: error INVALID_DATE (31/02 no existe)',
  },
  {
    'Código de propiedad': 'P-001',
    'DNI del inquilino': '90200001',
    Inicio: '01/03/2025',
    Fin: '28/02/2027',
    'Alquiler inicial': 450000,
    Moneda: 'EUR',
    Notas: 'ESPERADO: error INVALID_CURRENCY',
  },
  {
    'Código de propiedad': 'P-007',
    'DNI del inquilino': '90200004',
    Inicio: '01/06/2025',
    Fin: '01/05/2025',
    'Alquiler inicial': 200000,
    Moneda: 'ARS',
    Notas: 'ESPERADO: error DATES_INVALID (fin antes del inicio)',
  },
  {
    'Código de propiedad': 'P-001',
    'DNI del inquilino': '90200004',
    Inicio: '01/04/2025',
    Fin: '31/03/2027',
    'Alquiler inicial': 460000,
    Moneda: 'ARS',
    Notas:
      'ACTIVO: otro contrato vigente sobre P-001; debería fallar por superposición',
  },
  {
    'Código de propiedad': 'P-999',
    'DNI del inquilino': '90200004',
    Inicio: '01/04/2025',
    Fin: '31/03/2027',
    'Alquiler inicial': 100000,
    Moneda: 'ARS',
    Notas: 'A VER: código de propiedad que no existe',
  },
  {
    'Código de propiedad': 'P-007',
    'DNI del inquilino': '90200004',
    // Celdas con fecha real de Excel (no texto): se prueban las dos formas.
    Inicio: new Date(Date.UTC(2025, 6, 1)),
    Fin: new Date(Date.UTC(2027, 5, 30)),
    'Alquiler inicial': 200000,
    Moneda: 'ARS',
    'Índice de aumento': 'Fijo',
    'Frecuencia de aumento': 'Anual',
    '% fijo': '10',
    Notas: 'ACTIVO: fechas como celdas de Excel; aumento fijo del 10 %',
  },
  {
    'Código de propiedad': 'P-001',
    'DNI del inquilino': '90200001',
    Inicio: '01/03/2025',
    Fin: '28/02/2027',
    'Alquiler inicial': 450000,
    Moneda: 'ARS',
    Notas: 'ESPERADO: conflicto DUPLICATE_IN_FILE (igual a la fila 3)',
  },
  {
    'Código de propiedad': 'P-010',
    'DNI del inquilino': '90200099',
    Inicio: '01/03/2025',
    Fin: '28/02/2027',
    'Alquiler inicial': 150000,
    Moneda: 'ARS',
    Notas: 'A VER: inquilino que no está en el archivo ni en el sistema',
  },
  {
    'Código de propiedad': 'P-010',
    'DNI del inquilino': '90200002',
    Inicio: '01/03/2025',
    Fin: '28/02/2027',
    'Alquiler inicial': 150000,
    Moneda: 'ARS',
    Notas: 'ACTIVO sobre una propiedad SIN propietario: debería fallar al confirmar',
  },
]

const SHEETS = {
  Propietarios: OWNERS,
  Garantes: GUARANTORS,
  Inquilinos: RENTERS,
  Propiedades: PROPERTIES,
  Contratos: CONTRACTS,
}

async function main() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path.resolve(templatePath))

  for (const [sheetName, rows] of Object.entries(SHEETS)) {
    const sheet = workbook.getWorksheet(sheetName)
    if (!sheet) throw new Error(`La plantilla no tiene la hoja «${sheetName}»`)

    // Encabezado → número de columna (fila 1 de la plantilla).
    const columns = new Map()
    sheet.getRow(1).eachCell((cell, col) => columns.set(String(cell.value), col))

    rows.forEach((row, index) => {
      const target = sheet.getRow(3 + index) // la fila 2 es el ejemplo gris
      for (const [header, value] of Object.entries(row)) {
        const col = columns.get(header)
        if (!col) throw new Error(`«${sheetName}» no tiene la columna «${header}»`)
        target.getCell(col).value = value
        if (value instanceof Date) target.getCell(col).numFmt = 'dd/mm/yyyy'
        if (header === 'DNI/CUIT' || header.startsWith('DNI')) {
          target.getCell(col).numFmt = '@' // texto: que Excel no lo recorte
        }
      }
      target.commit()
    })
  }

  await workbook.xlsx.writeFile(path.resolve(outPath))
  console.log(`Escrito ${outPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
