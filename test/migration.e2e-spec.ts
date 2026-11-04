import { INestApplication } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { Role } from '@prisma/client'
import ExcelJS from 'exceljs'
import request from 'supertest'

import { seedBaseMasterData } from '../prisma/lib/master-data-seed'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import {
  SHEETS,
  TEMPLATE_VERSION,
} from '../src/modules/migration/domain/template-definition'
import { MigrationFacade } from '../src/modules/migration/public'
import {
  DownloadedImage,
  ImageDownloadError,
  ImageDownloaderPort,
} from '../src/platform/tokko/image-downloader.port'
import {
  TokkoSourceError,
  TokkoSourcePort,
} from '../src/platform/tokko/tokko-source.port'
import { RequestContext } from '../src/shared/context/request-context'
import { PrismaService } from '../src/shared/prisma/prisma.service'
import { loginAs } from './utils/app'
import { createTenant, createUser, resetDatabase } from './utils/database'
import { waitFor } from './utils/wait-for'

/** PNG de 1x1 que se "descarga" en los tests. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const CBU_1 = '0110599552000000123456'
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** Descargador de fotos controlable: éxito, 404 y timeout sin tocar la red. */
class FakeImageDownloader extends ImageDownloaderPort {
  readonly failing = new Map<string, string>()
  readonly calls: string[] = []

  download(url: string): Promise<DownloadedImage> {
    this.calls.push(url)
    const reason = this.failing.get(url)
    if (reason) return Promise.reject(new ImageDownloadError(reason))
    return Promise.resolve({ buffer: PNG, mimeType: 'image/png' })
  }
}

type Cells = Record<string, string | number>
type Sheets = Partial<
  Record<
    'Propietarios' | 'Garantes' | 'Inquilinos' | 'Propiedades' | 'Contratos',
    Cells[]
  >
>

/** Migración de datos (Fase 21), contra Postgres y la cola real. */
describe('Migración (e2e, Postgres)', () => {
  const prisma = new PrismaService()
  const images = new FakeImageDownloader()
  let app: INestApplication
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let adminToken: string
  let adminBToken: string
  let adminId: string
  let employeeToken: string

  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    RequestContext.run({ correlationId: 'test' }, () =>
      RequestContext.runInTenant(tenantId, fn),
    )

  const api =
    (token: string) => (method: 'get' | 'post' | 'patch', url: string) =>
      request(app.getHttpServer())
        [method](`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`)
  const admin = (method: 'get' | 'post' | 'patch', url: string) =>
    api(adminToken)(method, url)

  const binary = (
    res: request.Response,
    done: (error: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => done(null, Buffer.concat(chunks)))
  }
  const download = async (url: string, token = adminToken) =>
    (
      await request(app.getHttpServer())
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse(binary)
        .expect(200)
    ).body as Buffer

  /**
   * Un Excel con la forma de la plantilla (mismas hojas y encabezados, armados
   * desde su definición) y las filas completadas desde la 3. Armarlo así y no
   * bajando la plantilla en cada test lo hace unas diez veces más rápido; la
   * plantilla descargada tiene su propio test de ida y vuelta.
   */
  async function workbook(
    sheets: Sheets,
    options: { remove?: string[]; version?: string } = {},
  ): Promise<Buffer> {
    const book = new ExcelJS.Workbook()
    for (const definition of SHEETS) {
      if (options.remove?.includes(definition.name)) continue
      const sheet = book.addWorksheet(definition.name)
      sheet.addRow(definition.columns.map((c) => c.header))
      sheet.addRow(definition.columns.map((c) => c.example))
      const rows = (sheets as Record<string, Cells[]>)[definition.name] ?? []
      for (const cells of rows) {
        sheet.addRow(definition.columns.map((c) => cells[c.header] ?? null))
      }
    }
    const meta = book.addWorksheet('Meta')
    meta.getCell('A1').value = 'template_version'
    meta.getCell('B1').value = options.version ?? TEMPLATE_VERSION
    return Buffer.from(await book.xlsx.writeBuffer())
  }

  const upload = (file: Buffer, name = 'datos.xlsx', token = adminToken) =>
    request(app.getHttpServer())
      .post('/api/v1/migration/excel/analyze')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', file, name)

  /** Espera a que un AsyncJob termine y devuelve su estado final. */
  async function finished(jobId: string, token = adminToken) {
    let status = ''
    await waitFor(async () => {
      const res = await api(token)('get', `/jobs/${jobId}/status`).expect(200)
      status = res.body.data.status
      return ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(status)
    })
    return status
  }

  const batch = async (id: string, token = adminToken) =>
    (await api(token)('get', `/migration/batches/${id}`).expect(200)).body.data

  /** Sube el Excel y espera a que el análisis termine. */
  async function analyzeExcel(file: Buffer) {
    const res = await upload(file).expect(202)
    await finished(res.body.data.jobId)
    return res.body.data.batchId as string
  }

  async function analyzeTokko(body: Record<string, unknown> = {}) {
    const res = await admin('post', '/migration/tokko/analyze')
      .send({ includeAssets: true, ...body })
      .expect(202)
    await finished(res.body.data.jobId)
    return res.body.data.batchId as string
  }

  /** Confirma y espera a que la importación (y las fotos, si hay) terminen. */
  async function confirm(
    batchId: string,
    body: Record<string, unknown> = {},
    waitAssets = false,
  ) {
    const res = await admin('post', `/migration/batches/${batchId}/confirm`)
      .send({ defaultConflictResolution: 'SKIP', ...body })
      .expect(202)
    await finished(res.body.data.jobId)
    if (waitAssets) await settled(batchId)
    return res.body.data
  }

  /** El lote deja de importar recién cuando terminan las fotos. */
  const settled = (batchId: string) =>
    waitFor(async () => {
      const { status, assets } = await batch(batchId)
      return status !== 'IMPORTING' && assets.pending === 0
    })

  const rows = async (batchId: string, query = '') =>
    (
      await admin(
        'get',
        `/migration/batches/${batchId}/rows?limit=100${query}`,
      ).expect(200)
    ).body.data.data as {
      id: string
      entity: string
      rowNumber: number | null
      label: string
      status: string
      errors: { code: string; field: string; message: string }[]
      conflict: {
        entityId: string
        reason: string
        differingFields: string[]
      } | null
      needsReview: boolean
      targetId: string | null
    }[]

  const counts = async (tenantId: string) => ({
    owners: await prisma.owner.count({ where: { tenantId } }),
    renters: await prisma.renter.count({ where: { tenantId } }),
    guarantors: await prisma.guarantor.count({ where: { tenantId } }),
    properties: await prisma.property.count({ where: { tenantId } }),
    contracts: await prisma.contract.count({ where: { tenantId } }),
    locations: await prisma.location.count({ where: { tenantId } }),
    types: await prisma.propertyType.count({ where: { tenantId } }),
    amenities: await prisma.amenity.count({ where: { tenantId } }),
  })

  // ----------------------------------------------------------------- Datos

  const OWNERS: Cells[] = [
    {
      Nombre: 'Ana',
      Apellido: 'Pérez',
      'DNI/CUIT': '20111111',
      Teléfono: '11 5555-1111',
      Email: 'ana@ejemplo.com',
      CBU: CBU_1,
    },
    { Nombre: 'Bruno', Apellido: 'Díaz', 'DNI/CUIT': '123' },
    { Nombre: 'Ana', Apellido: 'Pérez (repetida)', 'DNI/CUIT': '20.111.111' },
  ]
  const GUARANTORS: Cells[] = [
    {
      Nombre: 'Gabriel',
      Apellido: 'García',
      'DNI/CUIT': '20333333',
      'Tipo de garantía': 'Inmueble',
      'Detalle de la garantía': 'Casa propia en La Plata',
    },
  ]
  const RENTERS: Cells[] = [
    {
      Nombre: 'Rita',
      Apellido: 'Soto',
      'DNI/CUIT': '30111111',
      'DNI del garante': '20333333',
    },
    { Nombre: 'Raúl', Apellido: 'Vega', 'DNI/CUIT': '30222222' },
  ]
  const PROPERTIES: Cells[] = [
    {
      Código: 'P-1',
      Dirección: 'Calle Uno 100',
      Ubicación: 'Buenos Aires > La Plata > Tolosa',
      Tipo: 'Casa',
      'DNI del propietario': '20111111',
      'Amenities (separados por coma)': 'Pileta, Jacuzzi',
      'Precio de publicación': '450.000',
      Moneda: 'ARS',
    },
    {
      Código: 'P-2',
      Dirección: 'Calle Dos 200',
      Ubicación: 'Buenos Aires > La Plata > Los Hornos',
      Tipo: 'Duplex',
      'DNI del propietario': '20111111',
    },
    {
      Código: 'P-3',
      Dirección: 'Calle Tres 300',
      Ubicación: 'Buenos Aires > La Plata > Tolosa',
      Tipo: 'Casa',
      'DNI del propietario': '20111111',
    },
    {
      Código: 'P-4',
      Dirección: 'Calle Cuatro 400',
      Ubicación: 'Narnia',
      Tipo: 'Casa',
    },
  ]
  const CONTRACTS: Cells[] = [
    {
      'Código de propiedad': 'P-1',
      'DNI del inquilino': '30111111',
      Inicio: '01/03/2025',
      Fin: '28/02/2099',
      'Alquiler inicial': '450.000,50',
      Moneda: 'ARS',
      'Índice de aumento': 'ICL',
      'Frecuencia de aumento': 'Trimestral',
      Depósito: 450000,
    },
    {
      'Código de propiedad': 'P-3',
      'DNI del inquilino': '30222222',
      Inicio: '01/01/2020',
      Fin: '31/12/2021',
      'Alquiler inicial': 100000,
      Moneda: 'ARS',
    },
    {
      'Código de propiedad': 'P-2',
      'DNI del inquilino': '99999999',
      Inicio: '01/03/2025',
      Fin: '28/02/2099',
      'Alquiler inicial': 100,
      Moneda: 'ARS',
    },
    {
      'Código de propiedad': 'P-4',
      'DNI del inquilino': '30222222',
      Inicio: '01/03/2025',
      Fin: '28/02/2099',
      'Alquiler inicial': 100,
      Moneda: 'ARS',
    },
  ]
  const FULL: Sheets = {
    Propietarios: OWNERS,
    Garantes: GUARANTORS,
    Inquilinos: RENTERS,
    Propiedades: PROPERTIES,
    Contratos: CONTRACTS,
  }

  beforeAll(async () => {
    await prisma.$connect()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ImageDownloaderPort)
      .useValue(images)
      .compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    configureApp(app as NestExpressApplication)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    images.failing.clear()
    images.calls.length = 0
    tenantA = await createTenant(prisma, 'tenant-a')
    tenantB = await createTenant(prisma, 'tenant-b')
    await seedBaseMasterData(prisma, tenantA.id, { withSampleCities: true })
    await seedBaseMasterData(prisma, tenantB.id, { withSampleCities: true })
    adminId = (
      await createUser(prisma, {
        tenantId: tenantA.id,
        email: 'admin@a.com',
        role: Role.ADMIN,
      })
    ).id
    await createUser(prisma, { tenantId: tenantA.id, email: 'emp@a.com' })
    await createUser(prisma, {
      tenantId: tenantB.id,
      email: 'admin@b.com',
      role: Role.ADMIN,
    })
    adminToken = await loginAs(app, 'admin@a.com')
    employeeToken = await loginAs(app, 'emp@a.com')
    adminBToken = await loginAs(app, 'admin@b.com')
  })

  // ------------------------------------------------------------- Permisos

  describe('permisos y plantilla', () => {
    it('sólo el administrador migra: el empleado recibe 403 y sin token 401', async () => {
      await api(employeeToken)('get', '/migration/excel/template').expect(403)
      await api(employeeToken)('get', '/migration/batches').expect(403)
      await api(employeeToken)('post', '/migration/tokko/analyze')
        .send({ includeAssets: false })
        .expect(403)
      await request(app.getHttpServer())
        .get('/api/v1/migration/batches')
        .expect(401)
    })

    it('la plantilla trae las hojas, la versión oculta y los maestros de la inmobiliaria', async () => {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(
        (await download('/migration/excel/template')) as never,
      )

      expect(book.worksheets.map((s) => s.name)).toEqual([
        'Instrucciones',
        'Propietarios',
        'Garantes',
        'Inquilinos',
        'Propiedades',
        'Contratos',
        'Listas',
        'Meta',
      ])
      expect(book.getWorksheet('Meta')?.state).toBe('veryHidden')
      expect(book.getWorksheet('Listas')?.state).toBe('hidden')
      const lists = book.getWorksheet('Listas') as ExcelJS.Worksheet
      const typesColumn = lists.getColumn(1).values as unknown[]
      expect(typesColumn).toEqual(
        expect.arrayContaining(['Casa', 'Departamento']),
      )
      const locations = lists.getColumn(2).values as unknown[]
      expect(locations).toContain('Buenos Aires > La Plata > Tolosa')
      // La fila 2 es el ejemplo en gris; los encabezados son fijos.
      expect(book.getWorksheet('Propietarios')?.getCell('A1').value).toBe(
        'Nombre',
      )
    })
  })

  // ------------------------------------------------------------- Excel

  it('la plantilla descargada, completada a mano, se analiza sin objeciones', async () => {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load((await download('/migration/excel/template')) as never)
    const sheet = book.getWorksheet('Propietarios') as ExcelJS.Worksheet
    sheet.getCell('A3').value = 'Carla'
    sheet.getCell('B3').value = 'Ruiz'
    sheet.getCell('C3').value = '20444444'

    const batchId = await analyzeExcel(
      Buffer.from(await book.xlsx.writeBuffer()),
    )

    const detail = await batch(batchId)
    expect(detail.status).toBe('READY')
    expect(detail.counts).toMatchObject({ total: 1, valid: 1 })
    expect(detail.missingSheets).toEqual([])
  })

  describe('Excel: análisis (dry-run)', () => {
    it('valida las filas, cuenta lo que se crearía y no crea ninguna entidad ni maestro', async () => {
      const before = await counts(tenantA.id)

      const batchId = await analyzeExcel(await workbook(FULL))

      const detail = await batch(batchId)
      expect(detail).toMatchObject({
        status: 'READY',
        source: 'EXCEL',
        fileName: 'datos.xlsx',
        canConfirm: true,
        missingSheets: [],
        mastersToCreate: { locations: 1, propertyTypes: 1, amenities: 1 },
      })
      expect(detail.createdBy.fullName).toBeTruthy()
      expect(detail.counts).toMatchObject({
        total: 14,
        valid: 9,
        errors: 4,
        conflicts: 1,
      })
      expect(detail.counts.byEntity.PROPERTY).toMatchObject({
        total: 4,
        valid: 3,
        errors: 1,
      })

      // Cero entidades y cero maestros: sólo el lote y sus filas (A-71).
      expect(await counts(tenantA.id)).toEqual(before)

      const all = await rows(batchId)
      const byLabel = (label: string) =>
        all.find((r) => r.label.includes(label)) as (typeof all)[number]
      expect(byLabel('Bruno').errors[0]).toMatchObject({
        field: 'nationalId',
        code: 'INVALID_NATIONAL_ID',
      })
      expect(byLabel('repetida')).toMatchObject({
        status: 'CONFLICT',
        conflict: { reason: expect.stringContaining('repetida en el archivo') },
      })
      expect(byLabel('Calle Cuatro').errors[0].code).toBe('UNKNOWN_LOCATION')
      expect(
        all
          .filter((r) => r.entity === 'CONTRACT')
          .map((r) => r.errors[0]?.code),
      ).toEqual([
        undefined,
        undefined,
        'RENTER_NOT_FOUND',
        'PROPERTY_ROW_INVALID',
      ])
      // La fila es la del Excel (con encabezado).
      expect(byLabel('Ana Pérez').rowNumber).toBe(3)
    })

    it('filtra las filas por entidad y estado', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))

      const errors = await rows(batchId, '&status=ERROR')
      expect(errors).toHaveLength(4)
      const owners = await rows(batchId, '&entity=OWNER')
      expect(owners.map((r) => r.status)).toEqual([
        'VALID',
        'ERROR',
        'CONFLICT',
      ])
    })

    it('una hoja ausente no es un error: se avisa en missingSheets', async () => {
      const batchId = await analyzeExcel(
        await workbook(
          { Propietarios: [OWNERS[0]] },
          { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
        ),
      )

      const detail = await batch(batchId)
      expect(detail.status).toBe('READY')
      expect(detail.missingSheets).toEqual([
        'Garantes',
        'Inquilinos',
        'Propiedades',
        'Contratos',
      ])
    })

    it('rechaza lo que no es un .xlsx, otra versión de la plantilla y un pedido sin archivo', async () => {
      const notExcel = await upload(Buffer.from('esto no es un excel')).expect(
        422,
      )
      expect(notExcel.body.code).toBe('INVALID_XLSX')

      const old = await upload(await workbook({}, { version: '0' })).expect(422)
      expect(old.body.code).toBe('TEMPLATE_VERSION_MISMATCH')

      const none = await admin('post', '/migration/excel/analyze').expect(422)
      expect(none.body.code).toBe('INVALID_XLSX')
    })

    it('un archivo de más de 10 MB se rechaza', async () => {
      const response = await upload(Buffer.alloc(10 * 1024 * 1024 + 10, 1))
      expect(response.status).toBe(413)
    })
  })

  describe('Excel: confirmación', () => {
    it('importa exactamente las filas revisadas, en orden, con vínculos y maestros nuevos', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))
      const before = await counts(tenantA.id)

      await confirm(batchId)

      const detail = await batch(batchId)
      expect(detail.status).toBe('PARTIAL')
      expect(detail.confirmedAt).toBeTruthy()
      expect(detail.counts).toMatchObject({
        imported: 9,
        errors: 4,
        skipped: 1,
      })
      expect(detail.mastersCreated).toEqual({
        locations: 1,
        propertyTypes: 1,
        amenities: 1,
      })

      const after = await counts(tenantA.id)
      expect(after).toEqual({
        owners: before.owners + 1,
        guarantors: before.guarantors + 1,
        renters: before.renters + 2,
        properties: before.properties + 3,
        contracts: before.contracts + 2,
        locations: before.locations + 1,
        types: before.types + 1,
        amenities: before.amenities + 1,
      })

      const owner = await prisma.owner.findFirstOrThrow({
        where: { tenantId: tenantA.id },
      })
      expect(owner).toMatchObject({
        firstName: 'Ana',
        nationalId: '20111111',
        bankCbu: CBU_1,
      })
      const rita = await prisma.renter.findFirstOrThrow({
        where: { tenantId: tenantA.id, nationalId: '30111111' },
        include: { guarantor: true },
      })
      expect(rita.guarantor?.nationalId).toBe('20333333')

      const p1 = await prisma.property.findFirstOrThrow({
        where: { tenantId: tenantA.id, address: 'Calle Uno 100' },
      })
      expect(p1).toMatchObject({
        status: 'RENTED',
        ownerId: owner.id,
        needsReview: false,
        listingCurrency: 'ARS',
      })
      expect(p1.listingPrice?.toString()).toBe('450000')
      expect(p1.amenityIds).toHaveLength(2)

      // El vigente queda activo; el de 2020 nace FINISHED y no toca la propiedad.
      const contracts = await prisma.contract.findMany({
        where: { tenantId: tenantA.id },
        orderBy: { startDate: 'asc' },
      })
      expect(contracts.map((c) => c.status)).toEqual(['FINISHED', 'ACTIVE'])
      expect(contracts[1].propertyId).toBe(p1.id)
      const p3 = await prisma.property.findFirstOrThrow({
        where: { tenantId: tenantA.id, address: 'Calle Tres 300' },
      })
      expect(p3.status).toBe('AVAILABLE')
      expect(p3.activeContractId).toBeNull()
      expect(
        await prisma.renter.findFirstOrThrow({
          where: { tenantId: tenantA.id, nationalId: '30222222' },
        }),
      ).toMatchObject({ activeContractId: null })
      // Sin cuotas de períodos anteriores: la migración no genera ninguna.
      expect(
        await prisma.installment.count({ where: { tenantId: tenantA.id } }),
      ).toBe(0)

      // Cada fila importada deja su vínculo.
      expect(
        await prisma.importLink.count({ where: { tenantId: tenantA.id } }),
      ).toBe(9)
      // El archivo subido se borra al confirmar.
      expect(
        (await prisma.importBatch.findFirstOrThrow({ where: { id: batchId } }))
          .fileKey,
      ).toBeNull()

      // Quedó en la auditoría quién confirmó, y las altas figuran a su nombre.
      const events = await prisma.auditLog.findMany({
        where: {
          tenantId: tenantA.id,
          entity: 'ImportBatch',
          action: 'JOB_RUN',
        },
      })
      expect(events.map((e) => e.summary).join('|')).toContain('Confirmó')
      const created = await prisma.auditLog.findFirst({
        where: { tenantId: tenantA.id, entity: 'Owner', action: 'CREATE' },
      })
      expect(created?.userId).toBe(adminId)
    })

    it('es idempotente: subir el mismo Excel dos veces no duplica nada', async () => {
      const file = await workbook(FULL)
      await confirm(await analyzeExcel(file))
      const after = await counts(tenantA.id)

      const second = await analyzeExcel(file)
      const detail = await batch(second)
      expect(detail.counts).toMatchObject({
        alreadyImported: 9,
        valid: 0,
        errors: 4,
        // La fila repetida del archivo sigue siendo un conflicto.
        conflicts: 1,
      })
      await confirm(second)

      expect(await counts(tenantA.id)).toEqual(after)
    })

    // Qué fallaba: con dos lotes analizados antes de confirmar ninguno tenía
    // vínculos, los dos salían con todo VALID y al confirmar el segundo se
    // recreaba todo (las propiedades se duplicaban: no tienen unicidad en base).
    it('dos lotes del mismo archivo analizados antes de confirmar no duplican nada', async () => {
      const file = await workbook(FULL)
      const first = await analyzeExcel(file)
      const second = await analyzeExcel(file)
      expect((await batch(second)).counts.valid).toBeGreaterThan(0)

      await confirm(first)
      const after = await counts(tenantA.id)
      await confirm(second)

      expect(await counts(tenantA.id)).toEqual(after)
      const secondRows = await prisma.importRow.findMany({
        where: { batchId: second },
      })
      expect(
        secondRows.filter((r) => r.status === 'ALREADY_IMPORTED').length,
      ).toBe(9)
      expect(secondRows.some((r) => r.status === 'IMPORTED')).toBe(false)
    })

    it('un conflicto con lo cargado a mano se saltea por defecto y no modifica ningún campo', async () => {
      const owner = await prisma.owner.create({
        data: {
          tenantId: tenantA.id,
          firstName: 'Ana',
          lastName: 'Pérez',
          searchName: 'ana perez',
          nationalId: '20111111',
          phone: '11 0000-0000',
        },
      })
      const file = await workbook(
        { Propietarios: [OWNERS[0]] },
        { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
      )
      const batchId = await analyzeExcel(file)

      const [row] = await rows(batchId)
      expect(row).toMatchObject({
        status: 'CONFLICT',
        targetId: owner.id,
        conflict: {
          entityId: owner.id,
          differingFields: ['phone'],
        },
      })
      expect(row.conflict?.reason).toContain('Ya existe un propietario')

      await confirm(batchId)

      const same = await prisma.owner.findFirstOrThrow({
        where: { id: owner.id },
      })
      expect(same).toMatchObject({
        phone: '11 0000-0000',
        email: null,
        bankCbu: null,
      })
      expect(
        await prisma.owner.count({ where: { tenantId: tenantA.id } }),
      ).toBe(1)
      expect((await rows(batchId))[0].status).toBe('SKIPPED')
    })

    it('MERGE_EMPTY_FIELDS completa sólo lo vacío y nunca pisa un valor', async () => {
      const owner = await prisma.owner.create({
        data: {
          tenantId: tenantA.id,
          firstName: 'Ana',
          lastName: 'Pérez',
          searchName: 'ana perez',
          nationalId: '20111111',
          phone: '11 0000-0000',
        },
      })
      const batchId = await analyzeExcel(
        await workbook(
          { Propietarios: [OWNERS[0]] },
          { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
        ),
      )

      await confirm(batchId, {
        defaultConflictResolution: 'MERGE_EMPTY_FIELDS',
      })

      const merged = await prisma.owner.findFirstOrThrow({
        where: { id: owner.id },
      })
      expect(merged).toMatchObject({
        phone: '11 0000-0000', // tenía valor: no se pisa
        email: 'ana@ejemplo.com', // estaba vacío: se completa
        bankCbu: CBU_1,
      })
      expect((await rows(batchId))[0].status).toBe('IMPORTED')

      // Y a partir de ahí el mismo archivo ya figura como importado.
      const again = await analyzeExcel(
        await workbook(
          { Propietarios: [OWNERS[0]] },
          { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
        ),
      )
      expect((await rows(again))[0].status).toBe('ALREADY_IMPORTED')
    })

    it('la resolución se elige por fila, una fila se puede excluir y sólo se edita mientras se revisa', async () => {
      await prisma.owner.create({
        data: {
          tenantId: tenantA.id,
          firstName: 'Ana',
          lastName: 'Pérez',
          searchName: 'ana perez',
          nationalId: '20111111',
        },
      })
      const batchId = await analyzeExcel(
        await workbook(
          {
            Propietarios: [
              OWNERS[0],
              { Nombre: 'Carla', Apellido: 'Ruiz', 'DNI/CUIT': '20444444' },
            ],
          },
          { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
        ),
      )
      const [conflict, valid] = await rows(batchId)

      // Resolución sólo para conflictos con algo existente.
      const invalid = await admin(
        'patch',
        `/migration/batches/${batchId}/rows/${valid.id}`,
      )
        .send({ resolution: 'MERGE_EMPTY_FIELDS' })
        .expect(422)
      expect(invalid.body.code).toBe('INVALID_RESOLUTION')

      const patched = await admin(
        'patch',
        `/migration/batches/${batchId}/rows/${conflict.id}`,
      )
        .send({ resolution: 'MERGE_EMPTY_FIELDS' })
        .expect(200)
      expect(patched.body.data.resolution).toBe('MERGE_EMPTY_FIELDS')
      await admin('patch', `/migration/batches/${batchId}/rows/${valid.id}`)
        .send({ excluded: true })
        .expect(200)
      await admin('patch', `/migration/batches/${batchId}/rows/${UNKNOWN_ID}`)
        .send({ excluded: true })
        .expect(404)

      await confirm(batchId)

      const owners = await prisma.owner.findMany({
        where: { tenantId: tenantA.id },
      })
      expect(owners).toHaveLength(1)
      expect(owners[0].email).toBe('ana@ejemplo.com')
      const final = await rows(batchId)
      expect(final.map((r) => r.status)).toEqual(['IMPORTED', 'SKIPPED'])

      // Ya confirmado: no se edita más.
      const late = await admin(
        'patch',
        `/migration/batches/${batchId}/rows/${valid.id}`,
      )
        .send({ excluded: false })
        .expect(409)
      expect(late.body.code).toBe('BATCH_NOT_READY')
    })

    it('excludeRowIds deja filas afuera y un lote no se confirma dos veces', async () => {
      const batchId = await analyzeExcel(
        await workbook(
          {
            Propietarios: [
              { Nombre: 'Carla', Apellido: 'Ruiz', 'DNI/CUIT': '20444444' },
              { Nombre: 'Dani', Apellido: 'Sosa', 'DNI/CUIT': '20555555' },
            ],
          },
          { remove: ['Garantes', 'Inquilinos', 'Propiedades', 'Contratos'] },
        ),
      )
      const [, dani] = await rows(batchId)

      const first = await admin('post', `/migration/batches/${batchId}/confirm`)
        .send({
          defaultConflictResolution: 'SKIP',
          excludeRowIds: [dani.id],
        })
        .expect(202)
      // El segundo pedido llega con el lote ya en importación o terminado.
      const second = await admin(
        'post',
        `/migration/batches/${batchId}/confirm`,
      )
        .send({ defaultConflictResolution: 'SKIP' })
        .expect(409)
      expect(second.body.code).toBe('BATCH_ALREADY_CONFIRMED')
      await finished(first.body.data.jobId)

      expect(
        (await prisma.owner.findMany({ where: { tenantId: tenantA.id } })).map(
          (o) => o.firstName,
        ),
      ).toEqual(['Carla'])
      expect((await batch(batchId)).status).toBe('COMPLETED')
    })

    it('un lote que todavía se analiza no se puede confirmar ni descartar', async () => {
      const analyzing = await prisma.importBatch.create({
        data: { tenantId: tenantA.id, source: 'EXCEL', status: 'ANALYZING' },
      })

      const res = await admin(
        'post',
        `/migration/batches/${analyzing.id}/confirm`,
      )
        .send({ defaultConflictResolution: 'SKIP' })
        .expect(409)
      expect(res.body.code).toBe('BATCH_NOT_READY')
      await admin('post', `/migration/batches/${analyzing.id}/discard`).expect(
        409,
      )
    })

    it('una fila que depende de otra omitida falla sola y el lote sigue (PARTIAL)', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))
      const owner = (await rows(batchId, '&entity=OWNER'))[0]

      // Se excluye al propietario: sus propiedades ya no tienen a quién colgarse.
      await admin('patch', `/migration/batches/${batchId}/rows/${owner.id}`)
        .send({ excluded: true })
        .expect(200)
      await confirm(batchId)

      const detail = await batch(batchId)
      expect(detail.status).toBe('PARTIAL')
      // Tres propiedades y los dos contratos que cuelgan de ellas.
      expect(detail.counts.failed).toBe(5)
      const failed = await rows(batchId, '&status=FAILED')
      expect(failed[0].errors[0]).toMatchObject({
        code: 'DEPENDENCY_NOT_IMPORTED',
      })
      // Garante e inquilinos sí se importaron.
      expect(
        await prisma.renter.count({ where: { tenantId: tenantA.id } }),
      ).toBe(2)
    })

    it('el reporte .xlsx lista los errores y conflictos con fila, campo y mensaje', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))

      const report = new ExcelJS.Workbook()
      await report.xlsx.load(
        (await download(`/migration/batches/${batchId}/report.xlsx`)) as never,
      )
      const sheet = report.getWorksheet(
        'Errores y conflictos',
      ) as ExcelJS.Worksheet
      const lines = (sheet.getSheetValues() as unknown[][]).slice(2)

      expect(lines).toHaveLength(5)
      expect(JSON.stringify(lines)).toContain('Propietarios')
      expect(JSON.stringify(lines)).toContain('El DNI/CUIT «123»')
      expect(JSON.stringify(lines)).toContain('RENTER_NOT_FOUND')
    })

    it('descartar cierra el lote sin importar nada y borra el archivo', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))
      const key = (
        await prisma.importBatch.findFirstOrThrow({ where: { id: batchId } })
      ).fileKey
      expect(key).toBeTruthy()
      const before = await counts(tenantA.id)

      const res = await admin(
        'post',
        `/migration/batches/${batchId}/discard`,
      ).expect(200)

      expect(res.body.data.status).toBe('DISCARDED')
      expect(res.body.data.canConfirm).toBe(false)
      expect(await counts(tenantA.id)).toEqual(before)
      expect(
        (await prisma.importBatch.findFirstOrThrow({ where: { id: batchId } }))
          .fileKey,
      ).toBeNull()
      await admin('post', `/migration/batches/${batchId}/confirm`)
        .send({ defaultConflictResolution: 'SKIP' })
        .expect(409)
    })

    it('la limpieza descarta los lotes que esperan hace más de 7 días', async () => {
      const old = await analyzeExcel(
        await workbook({ Propietarios: [OWNERS[0]] }),
      )
      const recent = await analyzeExcel(
        await workbook({ Propietarios: [OWNERS[0]] }),
      )
      await prisma.importBatch.update({
        where: { id: old },
        data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
      })

      const discarded = await inTenant(tenantA.id, () =>
        app.get(MigrationFacade).discardStaleBatches(),
      )

      expect(discarded).toBe(1)
      expect((await batch(old)).status).toBe('DISCARDED')
      expect((await batch(recent)).status).toBe('READY')
    })
  })

  // ---------------------------------------------------------- Aislamiento

  describe('aislamiento entre inmobiliarias', () => {
    it('un lote ajeno es un 404 en todos los endpoints', async () => {
      const batchId = await analyzeExcel(await workbook(FULL))

      for (const [method, url] of [
        ['get', `/migration/batches/${batchId}`],
        ['get', `/migration/batches/${batchId}/rows`],
        ['get', `/migration/batches/${batchId}/report.xlsx`],
        ['post', `/migration/batches/${batchId}/discard`],
        ['post', `/migration/batches/${batchId}/assets/retry`],
      ] as const) {
        await api(adminBToken)(method, url).expect(404)
      }
      await api(adminBToken)('post', `/migration/batches/${batchId}/confirm`)
        .send({ defaultConflictResolution: 'SKIP' })
        .expect(404)
      const listed = await api(adminBToken)('get', '/migration/batches').expect(
        200,
      )
      expect(listed.body.data.data).toHaveLength(0)
    })

    it('el mismo DNI en dos inmobiliarias no es un conflicto', async () => {
      await prisma.owner.create({
        data: {
          tenantId: tenantB.id,
          firstName: 'Ana',
          lastName: 'Pérez',
          searchName: 'ana perez',
          nationalId: '20111111',
        },
      })
      const batchId = await analyzeExcel(
        await workbook({ Propietarios: [OWNERS[0]] }),
      )

      expect((await rows(batchId))[0].status).toBe('VALID')
      await confirm(batchId)
      expect(
        await prisma.owner.count({ where: { nationalId: '20111111' } }),
      ).toBe(2)
      // Los vínculos tampoco se cruzan: B puede importar lo mismo.
      const forB = await api(adminBToken)('post', '/migration/excel/analyze')
        .attach('file', await workbook({ Propietarios: [OWNERS[0]] }), 'b.xlsx')
        .expect(202)
      await finished(forB.body.data.jobId, adminBToken)
      const rowsB = (
        await api(adminBToken)(
          'get',
          `/migration/batches/${forB.body.data.batchId}/rows`,
        ).expect(200)
      ).body.data.data
      expect(rowsB[0].status).toBe('CONFLICT')
    })
  })

  // ---------------------------------------------------------------- Tokko

  describe('Tokko', () => {
    it('el análisis es siempre un dry-run: arma las filas y no crea nada', async () => {
      const before = await counts(tenantA.id)

      const batchId = await analyzeTokko()

      const detail = await batch(batchId)
      expect(detail).toMatchObject({
        status: 'READY',
        source: 'TOKKO',
        fileName: null,
        canConfirm: true,
      })
      // 5 de alquiler; la sola de venta queda afuera (A-75).
      expect(detail.counts).toMatchObject({
        total: 5,
        valid: 5,
        needsReview: 1,
      })
      expect(detail.mastersToCreate.locations).toBeGreaterThan(0)
      expect(await counts(tenantA.id)).toEqual(before)

      const all = await rows(batchId)
      expect(all.map((r) => r.label)).toEqual(
        expect.arrayContaining([
          'Av. Santa Fe 3540 5° A',
          // Sin dirección real, se usa la de fachada.
          'Av. Rivadavia al 5100',
        ]),
      )
      expect(all.find((r) => r.label.includes('Diagonal'))?.needsReview).toBe(
        true,
      )
    })

    it('acepta los tipos de operación y un límite para probar con pocas', async () => {
      const sales = await analyzeTokko({ operationTypes: ['Sale'], limit: 1 })
      expect((await batch(sales)).counts.total).toBe(1)

      const limited = await analyzeTokko({ limit: 2 })
      expect((await batch(limited)).counts.total).toBe(2)
    })

    it('confirmar crea las propiedades; la que no tiene ubicación queda con el comodín y para revisar', async () => {
      const batchId = await analyzeTokko({ includeAssets: false })

      await confirm(batchId)

      expect((await batch(batchId)).status).toBe('COMPLETED')
      expect(
        await prisma.property.count({ where: { tenantId: tenantA.id } }),
      ).toBe(5)
      const unlocated = await prisma.property.findFirstOrThrow({
        where: { tenantId: tenantA.id, address: { startsWith: 'Diagonal 74' } },
      })
      const placeholder = await prisma.location.findFirstOrThrow({
        where: { id: unlocated.locationId },
      })
      expect(unlocated.needsReview).toBe(true)
      expect(placeholder.name).toBe('Sin ubicación (revisar)')
      // Una propiedad no se ubica en una provincia.
      expect(placeholder.level).toBe('CITY')
      // El comodín se crea una sola vez.
      expect(
        await prisma.location.count({
          where: { tenantId: tenantA.id, name: 'Sin ubicación (revisar)' },
        }),
      ).toBe(1)

      const sinPropietario = await prisma.property.count({
        where: { tenantId: tenantA.id, ownerId: null },
      })
      expect(sinPropietario).toBe(5)

      // El filtro "A revisar" de la pantalla.
      const review = await admin('get', '/properties?needsReview=true').expect(
        200,
      )
      expect(review.body.data.data).toHaveLength(1)
      expect(review.body.data.data[0].needsReview).toBe(true)

      // Corregirle la ubicación la saca de la lista.
      const location = await prisma.location.findFirstOrThrow({
        where: { tenantId: tenantA.id, name: 'Tolosa' },
      })
      await admin('patch', `/properties/${unlocated.id}`)
        .send({ locationId: location.id })
        .expect(200)
      expect(
        (await admin('get', '/properties?needsReview=true').expect(200)).body
          .data.data,
      ).toHaveLength(0)
    })

    it('el segundo pasaje no duplica nada: todo figura como ya importado', async () => {
      await confirm(await analyzeTokko({ includeAssets: false }))
      const after = await counts(tenantA.id)

      const again = await analyzeTokko({ includeAssets: false })
      const detail = await batch(again)
      expect(detail.counts).toMatchObject({ alreadyImported: 5, valid: 0 })
      await confirm(again)

      expect(await counts(tenantA.id)).toEqual(after)
    })

    it('una propiedad cargada a mano no se sobrescribe; con MERGE_EMPTY_FIELDS sólo se completa lo vacío', async () => {
      const country = await prisma.location.findFirstOrThrow({
        where: { tenantId: tenantA.id, level: 'COUNTRY' },
      })
      const province = await prisma.location.create({
        data: {
          tenantId: tenantA.id,
          level: 'PROVINCE',
          name: 'Capital Federal',
          parentId: country.id,
        },
      })
      const palermo = await prisma.location.create({
        data: {
          tenantId: tenantA.id,
          level: 'CITY',
          name: 'Palermo',
          parentId: province.id,
        },
      })
      const type = await prisma.propertyType.findFirstOrThrow({
        where: { tenantId: tenantA.id, name: 'Departamento' },
      })
      const manual = await prisma.property.create({
        data: {
          tenantId: tenantA.id,
          address: 'AV. SANTA FE 3540 5° A',
          locationId: palermo.id,
          propertyTypeId: type.id,
          notes: 'Cargada a mano',
          listingPrice: '999.00',
        },
      })

      const skipBatch = await analyzeTokko({ includeAssets: false, limit: 1 })
      const [row] = await rows(skipBatch)
      expect(row).toMatchObject({ status: 'CONFLICT', targetId: manual.id })
      expect(row.conflict?.differingFields).toEqual(['listingPrice'])
      await confirm(skipBatch)
      expect(
        await prisma.property.findFirstOrThrow({ where: { id: manual.id } }),
      ).toMatchObject({ notes: 'Cargada a mano', publicDescription: null })
      expect(
        await prisma.property.count({ where: { tenantId: tenantA.id } }),
      ).toBe(1)

      const mergeBatch = await analyzeTokko({ includeAssets: false, limit: 1 })
      await confirm(mergeBatch, {
        defaultConflictResolution: 'MERGE_EMPTY_FIELDS',
      })
      const merged = await prisma.property.findFirstOrThrow({
        where: { id: manual.id },
      })
      expect(merged.listingPrice?.toString()).toBe('999') // tenía precio: no se pisa
      expect(merged.notes).toBe('Cargada a mano')
      expect(merged.publicDescription).toContain('Departamento luminoso')
      expect(
        await prisma.property.count({ where: { tenantId: tenantA.id } }),
      ).toBe(1)
    })

    it('si la fuente falla, el lote queda FAILED con un mensaje claro y sin filas', async () => {
      jest
        .spyOn(app.get(TokkoSourcePort), 'dictionaries')
        .mockRejectedValueOnce(
          new TokkoSourceError('Tokko respondió 401: revisá la API key', 401),
        )

      const res = await admin('post', '/migration/tokko/analyze')
        .send({ includeAssets: false })
        .expect(202)
      const status = await finished(res.body.data.jobId)

      expect(status).toBe('FAILED')
      const detail = await batch(res.body.data.batchId)
      expect(detail).toMatchObject({
        status: 'FAILED',
        errorMessage: 'Tokko respondió 401: revisá la API key',
        canConfirm: false,
      })
      expect(detail.counts.total).toBe(0)
      expect(
        await prisma.importRow.count({
          where: { batchId: res.body.data.batchId },
        }),
      ).toBe(0)
    })
  })

  // --------------------------------------------------------------- Fotos

  describe('migración de fotos', () => {
    it('trae las fotos al storage propio; una que falla no revierte la propiedad y se reintenta sola', async () => {
      images.failing.set(
        'https://fixtures.tokko.test/photos/90004-1.jpg',
        'La foto no existe (404)',
      )
      const batchId = await analyzeTokko()

      await confirm(batchId, {}, true)

      const detail = await batch(batchId)
      expect(detail.assets).toEqual({ migrated: 6, failed: 1, pending: 0 })
      expect(detail.status).toBe('COMPLETED')

      // La propiedad con la foto caída existe, con la foto que sí bajó.
      const property = await prisma.property.findFirstOrThrow({
        where: { tenantId: tenantA.id, address: { startsWith: 'Diagonal 74' } },
        include: { photos: true },
      })
      expect(property.photos).toHaveLength(1)
      // Nunca se guarda la URL externa como foto (spec 7).
      const allPhotos = await prisma.propertyPhoto.findMany({
        where: { tenantId: tenantA.id },
      })
      expect(allPhotos).toHaveLength(6)
      expect(allPhotos.every((p) => !p.url.includes('tokko.test'))).toBe(true)
      expect(allPhotos.every((p) => p.storageKey.startsWith('tenants/'))).toBe(
        true,
      )

      // La portada de Tokko (is_front_cover) queda primera.
      const santaFe = await prisma.property.findFirstOrThrow({
        where: {
          tenantId: tenantA.id,
          address: { startsWith: 'Av. Santa Fe' },
        },
        include: { photos: { orderBy: { position: 'asc' } } },
      })
      expect(santaFe.photos).toHaveLength(3)
      const results = await prisma.importAssetResult.findMany({
        where: { batchId, propertyId: santaFe.id },
        orderBy: { position: 'asc' },
      })
      expect(results[0].sourceUrl).toContain('90001-0.jpg')

      // El reporte trae las fotos por propiedad.
      const report = new ExcelJS.Workbook()
      await report.xlsx.load(
        (await download(`/migration/batches/${batchId}/report.xlsx`)) as never,
      )
      expect(report.getWorksheet('Fotos')?.rowCount).toBe(5)

      // Reintentar toca sólo la que falló; mientras siga caída, sigue fallida.
      const callsBefore = images.calls.length
      const retry = await admin(
        'post',
        `/migration/batches/${batchId}/assets/retry`,
      ).expect(202)
      await finished(retry.body.data.jobId)
      await settled(batchId)
      expect(images.calls.length - callsBefore).toBe(1)
      expect((await batch(batchId)).assets).toEqual({
        migrated: 6,
        failed: 1,
        pending: 0,
      })

      images.failing.clear()
      const retry2 = await admin(
        'post',
        `/migration/batches/${batchId}/assets/retry`,
      ).expect(202)
      expect(await finished(retry2.body.data.jobId)).toBe('COMPLETED')
      await settled(batchId)
      expect((await batch(batchId)).assets).toEqual({
        migrated: 7,
        failed: 0,
        pending: 0,
      })
      expect(
        await prisma.propertyPhoto.count({
          where: { propertyId: property.id },
        }),
      ).toBe(2)
    })

    it('el lote sigue importando mientras se bajan las fotos y no se puede reintentar entonces', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const download = jest
        .spyOn(images, 'download')
        .mockImplementation(async () => {
          await gate
          return { buffer: PNG, mimeType: 'image/png' }
        })

      const batchId = await analyzeTokko({ limit: 1 })
      await confirm(batchId)
      await waitFor(async () => (await batch(batchId)).assets.pending > 0)

      const during = await batch(batchId)
      expect(during.status).toBe('IMPORTING')
      const retry = await admin(
        'post',
        `/migration/batches/${batchId}/assets/retry`,
      ).expect(409)
      expect(retry.body.code).toBe('ASSETS_IN_PROGRESS')

      release()
      await settled(batchId)
      download.mockRestore()
      expect((await batch(batchId)).status).toBe('COMPLETED')
    })

    it('sin migrateAssets no se baja ninguna foto', async () => {
      const batchId = await analyzeTokko()

      await confirm(batchId, { migrateAssets: false })

      expect(images.calls).toHaveLength(0)
      expect((await batch(batchId)).assets).toEqual({
        migrated: 0,
        failed: 0,
        pending: 0,
      })
    })

    it('reintentar fotos de un lote que no se importó es un 409', async () => {
      const batchId = await analyzeTokko()
      const res = await admin(
        'post',
        `/migration/batches/${batchId}/assets/retry`,
      ).expect(409)
      expect(res.body.code).toBe('BATCH_NOT_IMPORTED')
    })
  })

  describe('historial', () => {
    it('lista los lotes, más nuevos primero, con filtros', async () => {
      const excel = await analyzeExcel(
        await workbook({ Propietarios: [OWNERS[0]] }),
      )
      const tokko = await analyzeTokko({ includeAssets: false })

      const all = await admin('get', '/migration/batches').expect(200)
      expect(all.body.data.data.map((b: { id: string }) => b.id)).toEqual([
        tokko,
        excel,
      ])
      expect(all.body.data.pagination.total).toBe(2)

      const filtered = await admin(
        'get',
        '/migration/batches?source=EXCEL&status=READY',
      ).expect(200)
      expect(filtered.body.data.data.map((b: { id: string }) => b.id)).toEqual([
        excel,
      ])
      expect(filtered.body.data.data[0].counts.total).toBe(1)
    })
  })
})
