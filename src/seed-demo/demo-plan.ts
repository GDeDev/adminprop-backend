import {
  CollectionMode,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdateFrequency,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import { InquirySource, InquiryStage } from '@/modules/crm/domain/inquiry'
import { GuaranteeType } from '@/modules/renters/domain/guarantor'
import { cbuFor, cuitFor, demoDni } from './demo-identifiers'
import { DemoCalendar } from './demo-calendar'
import {
  BankSeed,
  ContractSeed,
  DEMO_MARK,
  DemoPlan,
  GuarantorSeed,
  InquirySeed,
  OwnerSeed,
  PropertySeed,
  RenterSeed,
  TenantPlan,
} from './demo-plan.types'

/**
 * Contraseña de TODOS los usuarios de demo (backoffice y portales). Está
 * publicada en el repo a propósito: por eso el seed se niega a correr fuera
 * de desarrollo (ver demo-guards.ts).
 */
export const DEMO_PASSWORD = 'DemoSolo-2026!'

/** CUIT ficticio válido a partir de un DNI de demo (prueba prefijos hasta que cierre). */
function fictitiousCuit(dni: string): string {
  for (const prefix of ['20', '27', '30'] as const) {
    try {
      return cuitFor(prefix, dni)
    } catch {
      // Esa combinación no admite verificador válido: se prueba otro prefijo.
    }
  }
  throw new Error(`No hay CUIT válido para el DNI ${dni}`)
}

function bank(account: string, alias: string, holder: string): BankSeed {
  return {
    cbu: cbuFor(account),
    alias,
    bankName: 'Banco Demo (ficticio)',
    holder,
  }
}

const GOOD = { day: 3, how: 'full' as const }

// =========================================================================
// Inmobiliaria Demo Uno: los 12 contratos tipo del plan de pruebas
// =========================================================================

function planUno(c: DemoCalendar): TenantPlan {
  const dni = (n: number) => demoDni(1, n)
  const email = (local: string) => `${local}@demo-uno.example.com`
  const phone = (n: number) => `555-01${String(n).padStart(2, '0')}`
  const address = (street: string) => `[${DEMO_MARK}] ${street}`

  const guarantors: GuarantorSeed[] = [
    {
      code: 'GAR-1',
      firstName: 'Graciela',
      lastName: `${DEMO_MARK} Garante-Uno`,
      nationalId: dni(1),
      email: email('gar-1'),
      phone: phone(1),
      address: address('Calle del Garante 1, La Plata'),
      guaranteeType: GuaranteeType.PROPERTY,
      guaranteeDetail: `${DEMO_MARK}: inmueble ficticio en Calle Falsa 123, La Plata (matrícula 000-000)`,
    },
    {
      code: 'GAR-2',
      firstName: 'Gonzalo',
      lastName: `${DEMO_MARK} Garante-Dos`,
      nationalId: dni(2),
      email: email('gar-2'),
      phone: phone(2),
      address: address('Calle del Garante 2, La Plata'),
      guaranteeType: GuaranteeType.PAYSLIPS,
      guaranteeDetail: `${DEMO_MARK}: empleado de Empresa Ficticia S.A., sueldo aproximado 900000 (garante de dos inquilinos)`,
    },
  ]

  const owners: OwnerSeed[] = [
    {
      code: 'OWN-A',
      firstName: 'Alicia',
      lastName: `${DEMO_MARK} Aguirre`,
      nationalId: dni(11),
      email: email('own-a'),
      phone: phone(11),
      address: address('Av. Siempreviva 11, La Plata'),
      bank: bank('0000000000011', 'demo.uno.own.a', 'Alicia DEMO Aguirre'),
      portal: true,
      note: `${DEMO_MARK}: 1 propiedad, con portal. Comparte CBU con OWN-C (advertencia de CBU repetido).`,
    },
    {
      code: 'OWN-B',
      firstName: 'Bruno',
      lastName: `${DEMO_MARK} Benítez`,
      nationalId: fictitiousCuit(dni(12)),
      email: email('own-b'),
      phone: phone(12),
      address: address('Av. Siempreviva 12, La Plata'),
      bank: bank('0000000000022', 'demo.uno.own.b', 'Bruno DEMO Benítez'),
      portal: true,
      feePercentage: '3',
      note: `${DEMO_MARK}: 3 propiedades con contrato activo (consolidado) y honorario propio del 3 %.`,
    },
    {
      code: 'OWN-C',
      firstName: 'Carla',
      lastName: `${DEMO_MARK} Cabrera`,
      nationalId: dni(13),
      email: email('own-c'),
      phone: phone(13),
      address: address('Av. Siempreviva 13, La Plata'),
      // Mismo CBU que OWN-A, a propósito.
      bank: bank('0000000000011', 'demo.uno.own.c', 'Carla DEMO Cabrera'),
      portal: true,
      note: `${DEMO_MARK}: 2 propiedades con contrato y una disponible (el próximo contrato la lleva a 3). CBU compartido con OWN-A.`,
    },
    {
      code: 'OWN-D',
      firstName: 'Diego',
      lastName: `${DEMO_MARK} Domínguez`,
      nationalId: dni(14),
      email: email('own-d'),
      phone: phone(14),
      address: address('Av. Siempreviva 14, La Plata'),
      bank: null,
      portal: false,
      note: `${DEMO_MARK}: sin cuenta bancaria (advertencia al liquidar).`,
    },
    {
      code: 'OWN-E',
      firstName: 'Elena',
      lastName: `${DEMO_MARK} Estévez`,
      nationalId: dni(15),
      email: null,
      phone: phone(15),
      address: address('Av. Siempreviva 15, La Plata'),
      bank: bank('0000000000055', 'demo.uno.own.e', 'Elena DEMO Estévez'),
      portal: false,
      note: `${DEMO_MARK}: sin email ("Generar acceso" no debe poder).`,
    },
    {
      code: 'OWN-F',
      firstName: 'Fabián',
      lastName: `${DEMO_MARK} Figueroa`,
      nationalId: dni(16),
      email: email('own-f'),
      phone: phone(16),
      address: address('Av. Siempreviva 16, La Plata'),
      bank: bank('0000000000066', 'demo.uno.own.f', 'Fabián DEMO Figueroa'),
      portal: false,
      note: `${DEMO_MARK}: contratos en dólares, con honorario por importe fijo y por vencer.`,
    },
    {
      code: 'OWN-G',
      firstName: 'Gabriela',
      lastName: `${DEMO_MARK} Giménez`,
      nationalId: dni(17),
      email: email('own-g'),
      phone: phone(17),
      address: address('Av. Siempreviva 17, La Plata'),
      bank: bank('0000000000077', 'demo.uno.own.g', 'Gabriela DEMO Giménez'),
      portal: false,
      note: `${DEMO_MARK}: propiedades con contrato vencido, rescindido, de mitad de mes y con servicios.`,
    },
  ]

  const renter = (
    n: number,
    firstName: string,
    lastName: string,
    opts: Partial<RenterSeed> & { note: string },
  ): RenterSeed => ({
    code: `REN-${n}`,
    firstName,
    lastName: `${DEMO_MARK} ${lastName}`,
    nationalId: dni(100 + n),
    email: email(`ren-${n}`),
    phone: phone(30 + n),
    address: address(`Calle del Inquilino ${n}, La Plata`),
    guarantor: null,
    portal: false,
    ...opts,
  })

  const renters: RenterSeed[] = [
    renter(1, 'Irene', 'Ibarra', {
      guarantor: 'GAR-1',
      portal: true,
      note: `${DEMO_MARK}: garante con propiedad, con portal.`,
    }),
    renter(2, 'Julián', 'Juárez', {
      guarantor: 'GAR-2',
      portal: true,
      note: `${DEMO_MARK}: garante con recibos de sueldo, con portal.`,
    }),
    renter(3, 'Karina', 'Kramer', {
      note: `${DEMO_MARK}: SIN garante.`,
    }),
    renter(4, 'Leandro', 'Luna', {
      email: null,
      note: `${DEMO_MARK}: SIN email (no se le puede generar acceso ni mandar avisos).`,
    }),
    renter(5, 'Marcela', 'Medina', {
      note: `${DEMO_MARK}: dos contratos en el historial (uno rescindido y uno vigente).`,
    }),
    renter(6, 'Nicolás', 'Navarro', {
      note: `${DEMO_MARK}: el propietario cobra directo.`,
    }),
    renter(7, 'Olga', 'Ortega', { note: `${DEMO_MARK}: honorario fijo.` }),
    renter(8, 'Pablo', 'Paz', { note: `${DEMO_MARK}: contrato por vencer.` }),
    renter(9, 'Quimey', 'Quiroga', {
      note: `${DEMO_MARK}: contrato vencido ayer.`,
    }),
    renter(10, 'Rosa', 'Ríos', {
      note: `${DEMO_MARK}: contrato de OWN-B (a).`,
    }),
    renter(11, 'Sergio', 'Sosa', {
      note: `${DEMO_MARK}: contrato de OWN-B (b), pago parcial.`,
    }),
    renter(12, 'Tamara', 'Toledo', {
      note: `${DEMO_MARK}: contrato de OWN-B (c), cuota vencida.`,
    }),
    renter(13, 'Ulises', 'Urquiza', {
      guarantor: 'GAR-2',
      note: `${DEMO_MARK}: comparte garante con REN-2.`,
    }),
    renter(14, 'Valeria', 'Vega', {
      note: `${DEMO_MARK}: contrato con servicios y expensas.`,
    }),
  ]

  const geo = {
    tolosa: { latitude: -34.8965, longitude: -57.9696 },
    centro: { latitude: -34.9214, longitude: -57.9545 },
    palermo: { latitude: -34.5889, longitude: -58.4306 },
  }
  const noGeo = { latitude: null, longitude: null }

  const property = (
    code: string,
    street: string,
    neighborhood: string,
    propertyType: string,
    owner: string | null,
    opts: Partial<PropertySeed> = {},
  ): PropertySeed => ({
    code,
    address: address(street),
    neighborhood,
    propertyType,
    owner,
    listingPrice: null,
    listingCurrency: 'ARS',
    operation: 'RENT',
    publicDescription: null,
    bedrooms: 2,
    bathrooms: 1,
    totalAreaM2: 60,
    ...noGeo,
    status: 'AUTO',
    photos: 0,
    note: `${DEMO_MARK}: ${code}`,
    ...opts,
  })

  const properties: PropertySeed[] = [
    property(
      'P-01',
      'Calle 7 Nº 101, La Plata',
      'Centro',
      'Departamento',
      'OWN-A',
      {
        ...geo.centro,
        photos: 2,
      },
    ),
    property('P-02', 'Calle 12 Nº 202, La Plata', 'Tolosa', 'Casa', 'OWN-C', {
      ...geo.tolosa,
    }),
    property('P-03', 'Calle 13 Nº 303, La Plata', 'Tolosa', 'PH', 'OWN-C'),
    property(
      'P-04',
      'Av. Santa Fe Nº 404, CABA',
      'Palermo',
      'Departamento',
      'OWN-F',
      {
        ...geo.palermo,
      },
    ),
    property('P-05', 'Calle 50 Nº 505, La Plata', 'Centro', 'Local', 'OWN-D'),
    property('P-06', 'Calle 51 Nº 606, La Plata', 'Centro', 'Oficina', 'OWN-F'),
    property(
      'P-07',
      'Calle 52 Nº 707, La Plata',
      'City Bell',
      'Casa',
      'OWN-F',
      {
        bedrooms: 3,
        totalAreaM2: 140,
      },
    ),
    property(
      'P-08',
      'Calle 53 Nº 808, La Plata',
      'Centro',
      'Departamento',
      'OWN-G',
    ),
    property(
      'P-09',
      'Calle 54 Nº 909, La Plata',
      'Centro',
      'Departamento',
      'OWN-G',
    ),
    property('P-10', 'Calle 55 Nº 1010, La Plata', 'Tolosa', 'Casa', 'OWN-G'),
    property(
      'P-11',
      'Calle 60 Nº 1111, La Plata',
      'Centro',
      'Departamento',
      'OWN-B',
    ),
    property(
      'P-12',
      'Calle 61 Nº 1212, La Plata',
      'Centro',
      'Departamento',
      'OWN-B',
    ),
    property(
      'P-13',
      'Calle 62 Nº 1313, La Plata',
      'Centro',
      'Departamento',
      'OWN-B',
    ),
    property('P-14', 'Calle 63 Nº 1414, La Plata', 'Tolosa', 'PH', 'OWN-E'),
    property(
      'P-15',
      'Calle 64 Nº 1515, La Plata',
      'City Bell',
      'Casa',
      'OWN-G',
      {
        bedrooms: 3,
      },
    ),
    // Sin contrato: los distintos estados de publicación.
    property('P-16', 'Calle 70 Nº 1616, La Plata', 'Centro', 'Casa', 'OWN-C', {
      listingPrice: '350000',
      publicDescription: `${DEMO_MARK}: casa luminosa de 3 ambientes (texto ficticio).`,
      ...geo.centro,
      photos: 3,
    }),
    property(
      'P-17',
      'Calle 71 Nº 1717, La Plata',
      'Centro',
      'Departamento',
      'OWN-E',
      {
        publicDescription: `${DEMO_MARK}: sin precio de publicación (se muestra "Consultar").`,
      },
    ),
    property('P-18', 'Calle 72 Nº 1818, La Plata', 'Tolosa', 'Casa', 'OWN-D', {
      operation: 'SALE',
      listingPrice: '120000',
      listingCurrency: 'USD',
      publicDescription: `${DEMO_MARK}: casa en venta en dólares (texto ficticio).`,
      bedrooms: 4,
      bathrooms: 2,
      totalAreaM2: 210,
      ...geo.tolosa,
      photos: 20,
    }),
    property('P-19', 'Calle 73 Nº 1919, La Plata', 'Centro', 'Local', 'OWN-A', {
      status: 'MAINTENANCE',
    }),
    property('P-20', 'Calle 74 Nº 2020, La Plata', 'Centro', 'Terreno', null, {
      note: `${DEMO_MARK}: propiedad SIN propietario.`,
    }),
  ]

  const monthlyEnd = (startOffset: number, months: number) =>
    c.addDays(c.addMonths(c.monthStart(startOffset), months), -1)

  const contracts: ContractSeed[] = [
    {
      code: 'C-01',
      covers:
        'ARS 200.000, ICL trimestral, depósito 200.000 sin caución, cobra la inmobiliaria, honorario 5 % descontado; cobro total y con punitorio, liquidación cerrada y borrador',
      property: 'P-01',
      renter: 'REN-1',
      start: c.monthStart(-4),
      end: monthlyEnd(-4, 24),
      rent: '200000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '200000',
      depositMode: DepositReturnMode.FIXED,
      // Mes -1: pagó el día 18, con punitorio (gracia 10).
      payments: { [-1]: { day: 18, how: 'full' } },
      settlements: [
        { after: -2, mode: 'close' },
        { after: -1, mode: 'draft' },
      ],
    },
    {
      code: 'C-02',
      covers:
        'ARS 200.000, IPC cuatrimestral, con caución (póliza vence en 20 días), cuotas vencidas sin pagar',
      property: 'P-02',
      renter: 'REN-2',
      start: c.monthStart(-4),
      end: monthlyEnd(-4, 24),
      rent: '200000',
      currency: Currency.ARS,
      updateType: RentUpdateType.IPC,
      updateFrequency: RentUpdateFrequency.FOUR_MONTHLY,
      deposit: '200000',
      depositMode: DepositReturnMode.FOLLOWS_RENT,
      surety: {
        insurerName: `${DEMO_MARK} Aseguradora Ficticia S.A.`,
        insurerAlertEmail: 'aseguradora@example.com',
        policyNumber: 'POL-DEMO-0002',
        policyExpiresAt: c.addDays(c.today, 20),
      },
      payments: { [-2]: null, [-1]: null },
    },
    {
      code: 'C-03',
      covers:
        'ARS, aumento fijo del 10 % semestral, punitorio propio del contrato (1,5 % con 5 días de gracia), saldo a favor y pago adelantado, depósito manual',
      property: 'P-03',
      renter: 'REN-3',
      start: c.monthStart(-4),
      end: monthlyEnd(-4, 24),
      rent: '150000',
      currency: Currency.ARS,
      updateType: RentUpdateType.FIXED,
      updateFrequency: RentUpdateFrequency.SEMIANNUAL,
      fixedIncreasePercentage: '10',
      deposit: '150000',
      depositMode: DepositReturnMode.MANUAL,
      guarantor: null,
      lateFeePercentage: '1.5',
      lateFeeGraceDays: 5,
      payments: {
        // Pagó de más: la diferencia queda como saldo a favor.
        [-1]: { day: 2, how: 'overpay', extra: '15000' },
        // Adelantado: paga hoy la cuota del mes que viene.
        [1]: { day: 31, how: 'full' },
      },
    },
    {
      code: 'C-04',
      covers:
        'USD 500, depósito en dólares; un pago en pesos con cotización y otro en dólares',
      property: 'P-04',
      renter: 'REN-4',
      start: c.monthStart(-4),
      end: monthlyEnd(-4, 24),
      rent: '500',
      currency: Currency.USD,
      updateType: RentUpdateType.FIXED,
      updateFrequency: RentUpdateFrequency.ANNUAL,
      fixedIncreasePercentage: '8',
      deposit: '1000',
      depositCurrency: Currency.USD,
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      payments: { [-3]: { day: 4, how: 'foreign', rate: '1200' } },
    },
    {
      code: 'C-05',
      covers:
        'Cobra el propietario directo: un pago informado y confirmado y otro pendiente de confirmación; propietario sin cuenta bancaria',
      property: 'P-05',
      renter: 'REN-6',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '180000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '180000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      collectionMode: CollectionMode.OWNER_DIRECT,
      feeMode: FeeMode.OWNER_PAYS,
      payments: {
        [-3]: { day: 5, how: 'informed', confirm: true },
        [-2]: { day: 5, how: 'informed', confirm: true },
        // Informado y sin confirmar: queda pendiente.
        [-1]: { day: 6, how: 'informed', confirm: false },
      },
    },
    {
      code: 'C-06',
      covers: 'Honorario por importe fijo (no %), pago parcial del mes pasado',
      property: 'P-06',
      renter: 'REN-7',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '240000',
      currency: Currency.ARS,
      updateType: RentUpdateType.IPC,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '240000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      feeAmount: '8000',
      payments: { [-1]: { day: 4, how: 'partial', fraction: '0.6' } },
    },
    {
      code: 'C-07',
      covers: 'Fin de contrato en 55 días (aviso de vencimiento, renovación)',
      property: 'P-07',
      renter: 'REN-8',
      start: c.addDays(c.addDays(c.today, 55), -365),
      end: c.addDays(c.today, 55),
      rent: '260000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '260000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
    },
    {
      code: 'C-08',
      covers:
        'Fin de contrato = ayer (la finalización automática lo cierra y libera la propiedad)',
      property: 'P-08',
      renter: 'REN-9',
      start: c.addDays(c.addDays(c.today, -1), -365 * 2 + 1),
      end: c.addDays(c.today, -1),
      rent: '170000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '170000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
    },
    {
      code: 'C-09',
      covers:
        'Inicio a mitad de mes (día 17): la cuota es de mes entero, sin prorrateo. REN-5 ya tuvo un contrato rescindido',
      property: 'P-10',
      renter: 'REN-5',
      start: c.dayOf(-2, 17),
      end: c.addDays(c.addMonths(c.dayOf(-2, 17), 24), -1),
      rent: '210000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '210000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      createAfterTerminationOf: 'C-R1',
    },
    {
      code: 'C-10a',
      covers: 'Contrato de OWN-B (1 de 3): honorario del 3 %',
      property: 'P-11',
      renter: 'REN-10',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '150000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.SEMIANNUAL,
      deposit: '150000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
    },
    {
      code: 'C-10b',
      covers: 'Contrato de OWN-B (2 de 3): pago parcial del 50 %',
      property: 'P-12',
      renter: 'REN-11',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '180000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.SEMIANNUAL,
      deposit: '180000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      payments: { [-1]: { day: 4, how: 'partial', fraction: '0.5' } },
    },
    {
      code: 'C-10c',
      covers:
        'Contrato de OWN-B (3 de 3): cuota del mes pasado vencida sin pagar',
      property: 'P-13',
      renter: 'REN-12',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '220000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.SEMIANNUAL,
      deposit: '220000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      payments: { [-1]: null },
    },
    {
      code: 'C-11',
      covers:
        'Aumento fijo sin porcentaje: el aumento semestral ya venció y queda "aumento pendiente"',
      property: 'P-14',
      renter: 'REN-13',
      start: c.monthStart(-7),
      end: monthlyEnd(-7, 24),
      rent: '190000',
      currency: Currency.ARS,
      updateType: RentUpdateType.FIXED,
      updateFrequency: RentUpdateFrequency.SEMIANNUAL,
      deposit: '190000',
      depositMode: DepositReturnMode.FIXED,
    },
    {
      code: 'C-12',
      covers:
        'Servicios heredados de la propiedad (luz con vencimiento pasado), servicio propio del contrato, expensas y un gasto adelantado',
      property: 'P-15',
      renter: 'REN-14',
      start: c.monthStart(-3),
      end: monthlyEnd(-3, 24),
      rent: '230000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '230000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
    },
    {
      code: 'C-R1',
      covers:
        'Contrato RESCINDIDO (historial de REN-5): se rescindió hace 3 meses, con multa calculada',
      property: 'P-09',
      renter: 'REN-5',
      start: c.monthStart(-10),
      end: monthlyEnd(-10, 24),
      rent: '195000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '195000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      terminate: { after: -3, notifiedAt: c.dayOf(-3, 15) },
    },
  ]

  const services = [
    {
      property: 'P-15',
      contract: null,
      serviceType: 'Luz',
      paidBy: 'RENTER' as const,
      currency: Currency.ARS,
      dueDate: c.addDays(c.today, -10),
      increaseFrequency: null,
      managedByAgency: false,
      note: `${DEMO_MARK}: luz de la propiedad, con vencimiento ya pasado (servicio vencido).`,
    },
    {
      property: 'P-15',
      contract: null,
      serviceType: 'Gas',
      paidBy: 'RENTER' as const,
      currency: Currency.ARS,
      dueDate: null,
      increaseFrequency: null,
      managedByAgency: false,
      note: `${DEMO_MARK}: gas de la propiedad, sin vencimiento.`,
    },
    {
      property: 'P-15',
      contract: 'C-12',
      serviceType: 'Expensas',
      paidBy: 'RENTER' as const,
      currency: Currency.ARS,
      dueDate: c.addDays(c.today, 12),
      increaseFrequency: RentUpdateFrequency.QUARTERLY,
      managedByAgency: true,
      note: `${DEMO_MARK}: expensas del contrato, con aumento trimestral, gestionadas por la inmobiliaria.`,
    },
    {
      property: 'P-15',
      contract: 'C-12',
      serviceType: 'Agua',
      paidBy: 'OWNER' as const,
      currency: Currency.ARS,
      dueDate: null,
      increaseFrequency: null,
      managedByAgency: false,
      note: `${DEMO_MARK}: agua a cargo del propietario, solo informativa.`,
    },
  ]

  const inquiries: InquirySeed[] = [
    {
      name: `${DEMO_MARK} Consulta Uno`,
      email: 'consulta1@example.com',
      phone: '555-0201',
      message: `${DEMO_MARK}: pregunta por la casa de Calle 70 (texto ficticio).`,
      property: 'P-16',
      source: InquirySource.WHATSAPP,
      stage: InquiryStage.NEW,
    },
    {
      name: `${DEMO_MARK} Consulta Dos`,
      email: null,
      phone: '555-0202',
      message: `${DEMO_MARK}: llamó por teléfono por el departamento sin precio.`,
      property: 'P-17',
      source: InquirySource.PHONE,
      stage: InquiryStage.CONTACTED,
    },
    {
      name: `${DEMO_MARK} Consulta Tres`,
      email: 'consulta3@example.com',
      phone: null,
      message: `${DEMO_MARK}: quiere visitar la casa en venta.`,
      property: 'P-18',
      source: InquirySource.MANUAL,
      stage: InquiryStage.VISIT_SCHEDULED,
    },
    {
      name: `${DEMO_MARK} Consulta Cuatro`,
      email: 'consulta4@example.com',
      phone: '555-0204',
      message: `${DEMO_MARK}: consulta general, sin propiedad asociada.`,
      property: null,
      source: InquirySource.MANUAL,
      stage: InquiryStage.CLOSED_LOST,
      lostReason: 'No respondió',
    },
  ]

  return {
    series: 1,
    slug: 'demo-uno',
    name: 'Inmobiliaria Demo Uno',
    dailyLateFeePercentage: '0.50',
    paymentGraceDays: 10,
    legal: {
      legalName: 'Inmobiliaria Demo Uno S.R.L. (ficticia)',
      taxId: fictitiousCuit('90500001'),
      address: '[DEMO] Calle Falsa 123, La Plata',
      phone: '555-0100',
      email: 'contacto@demo-uno.example.com',
      bank: bank('0000000000001', 'demo.uno.inmo', 'Inmobiliaria Demo Uno'),
    },
    admin: {
      email: 'admin@demo-uno.example.com',
      firstName: 'Admin',
      lastName: `${DEMO_MARK} Uno`,
    },
    employee: {
      email: 'empleado@demo-uno.example.com',
      firstName: 'Empleado',
      lastName: `${DEMO_MARK} Uno`,
    },
    guarantors,
    owners,
    renters,
    properties,
    contracts,
    services,
    advanceExpenses: [
      {
        contract: 'C-12',
        amount: '18500',
        description: `${DEMO_MARK}: reparación de la bomba de agua, adelantada por la inmobiliaria`,
        expenseDate: c.addDays(c.today, -5),
      },
    ],
    inquiries,
    extraMasterData: true,
  }
}

// =========================================================================
// Inmobiliaria Demo Dos: lo mínimo para verificar el aislamiento entre tenants
// =========================================================================

function planDos(c: DemoCalendar): TenantPlan {
  const dni = (n: number) => demoDni(2, n)
  const email = (local: string) => `${local}@demo-dos.example.com`
  const address = (street: string) => `[${DEMO_MARK}] ${street}`

  const owners: OwnerSeed[] = [
    {
      code: 'OWN-A',
      firstName: 'Amanda',
      lastName: `${DEMO_MARK} Dos-Acosta`,
      nationalId: dni(11),
      email: email('own-a'),
      phone: '555-0311',
      address: address('Av. Ficticia 11, CABA'),
      bank: bank('0000000000101', 'demo.dos.own.a', 'Amanda DEMO Dos-Acosta'),
      portal: true,
      note: `${DEMO_MARK}: propietaria de la segunda inmobiliaria, con portal.`,
    },
    {
      code: 'OWN-B',
      firstName: 'Benjamín',
      lastName: `${DEMO_MARK} Dos-Bravo`,
      nationalId: dni(12),
      email: email('own-b'),
      phone: '555-0312',
      address: address('Av. Ficticia 12, CABA'),
      bank: null,
      portal: false,
      note: `${DEMO_MARK}: propietario de la segunda inmobiliaria, sin cuenta bancaria.`,
    },
  ]

  const renters: RenterSeed[] = [
    {
      code: 'REN-1',
      firstName: 'Camila',
      lastName: `${DEMO_MARK} Dos-Castro`,
      nationalId: dni(101),
      email: email('ren-1'),
      phone: '555-0331',
      address: address('Calle Ficticia 101, CABA'),
      guarantor: null,
      portal: true,
      note: `${DEMO_MARK}: inquilina de la segunda inmobiliaria, con portal.`,
    },
    {
      code: 'REN-2',
      firstName: 'Damián',
      lastName: `${DEMO_MARK} Dos-Duarte`,
      nationalId: dni(102),
      email: email('ren-2'),
      phone: '555-0332',
      address: address('Calle Ficticia 102, CABA'),
      guarantor: null,
      portal: false,
      note: `${DEMO_MARK}: inquilino de la segunda inmobiliaria, con cuota vencida.`,
    },
  ]

  const property = (
    code: string,
    street: string,
    neighborhood: string,
    propertyType: string,
    owner: string | null,
    opts: Partial<PropertySeed> = {},
  ): PropertySeed => ({
    code,
    address: address(street),
    neighborhood,
    propertyType,
    owner,
    listingPrice: null,
    listingCurrency: 'ARS',
    operation: 'RENT',
    publicDescription: null,
    bedrooms: 2,
    bathrooms: 1,
    totalAreaM2: 55,
    latitude: null,
    longitude: null,
    status: 'AUTO',
    photos: 0,
    note: `${DEMO_MARK}: ${code} (Demo Dos)`,
    ...opts,
  })

  const properties: PropertySeed[] = [
    property(
      'P-01',
      'Av. Corrientes Nº 5001, CABA',
      'Caballito',
      'Departamento',
      'OWN-A',
      {
        latitude: -34.6186,
        longitude: -58.4437,
        photos: 1,
      },
    ),
    property(
      'P-02',
      'Av. Cabildo Nº 5002, CABA',
      'Belgrano',
      'Departamento',
      'OWN-B',
    ),
    property(
      'P-03',
      'Av. Rivadavia Nº 5003, CABA',
      'Caballito',
      'Local',
      'OWN-A',
      {
        listingPrice: '280000',
        publicDescription: `${DEMO_MARK}: local disponible de la segunda inmobiliaria.`,
      },
    ),
    property(
      'P-04',
      'Calle Ficticia Nº 5004, CABA',
      'Palermo',
      'Casa',
      'OWN-B',
      {
        operation: 'SALE',
        listingPrice: '95000',
        listingCurrency: 'USD',
      },
    ),
  ]

  const contracts: ContractSeed[] = [
    {
      code: 'D-01',
      covers:
        'Aislamiento: contrato en pesos de la segunda inmobiliaria, pagos al día y liquidación cerrada',
      property: 'P-01',
      renter: 'REN-1',
      start: c.monthStart(-3),
      end: c.addDays(c.addMonths(c.monthStart(-3), 24), -1),
      rent: '120000',
      currency: Currency.ARS,
      updateType: RentUpdateType.ICL,
      updateFrequency: RentUpdateFrequency.QUARTERLY,
      deposit: '120000',
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      settlements: [{ after: -1, mode: 'close' }],
    },
    {
      code: 'D-02',
      covers:
        'Aislamiento: contrato en dólares con la cuota del mes pasado sin pagar',
      property: 'P-02',
      renter: 'REN-2',
      start: c.monthStart(-2),
      end: c.addDays(c.addMonths(c.monthStart(-2), 24), -1),
      rent: '300',
      currency: Currency.USD,
      updateType: RentUpdateType.FIXED,
      updateFrequency: RentUpdateFrequency.ANNUAL,
      fixedIncreasePercentage: '5',
      deposit: '600',
      depositCurrency: Currency.USD,
      depositMode: DepositReturnMode.FIXED,
      guarantor: null,
      payments: { [-1]: null },
    },
  ]

  const inquiries: InquirySeed[] = [
    {
      name: `${DEMO_MARK} Consulta Dos-Uno`,
      email: 'consulta-dos@example.com',
      phone: '555-0401',
      message: `${DEMO_MARK}: consulta de la segunda inmobiliaria (no debe verse desde la primera).`,
      property: 'P-03',
      source: InquirySource.MANUAL,
      stage: InquiryStage.NEW,
    },
  ]

  return {
    series: 2,
    slug: 'demo-dos',
    name: 'Inmobiliaria Demo Dos',
    dailyLateFeePercentage: '1.00',
    paymentGraceDays: 5,
    legal: {
      legalName: 'Inmobiliaria Demo Dos S.A. (ficticia)',
      taxId: fictitiousCuit('90500002'),
      address: '[DEMO] Calle Ficticia 456, CABA',
      phone: '555-0300',
      email: 'contacto@demo-dos.example.com',
      bank: bank('0000000000100', 'demo.dos.inmo', 'Inmobiliaria Demo Dos'),
    },
    admin: {
      email: 'admin@demo-dos.example.com',
      firstName: 'Admin',
      lastName: `${DEMO_MARK} Dos`,
    },
    employee: {
      email: 'empleado@demo-dos.example.com',
      firstName: 'Empleado',
      lastName: `${DEMO_MARK} Dos`,
    },
    guarantors: [],
    owners,
    renters,
    properties,
    contracts,
    services: [],
    advanceExpenses: [],
    inquiries,
    extraMasterData: false,
  }
}

export function buildDemoPlan(calendar: DemoCalendar): DemoPlan {
  return {
    password: DEMO_PASSWORD,
    tenants: [planUno(calendar), planDos(calendar)],
  }
}

/** Pago de un mes cerrado cuando el contrato no dice otra cosa. */
export const DEFAULT_PAYMENT = GOOD
