import { INestApplicationContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus } from '@nestjs/cqrs'
import { Role as PrismaRole } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { Role } from '@/modules/auth/domain/enums/role.enum'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { CreateUserCommand } from '@/modules/auth/application/commands/create-user/create-user.command'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { GenerateInstallmentsCommand } from '@/modules/billing/application/commands/billing.commands'
import {
  ConfirmPaymentCommand,
  RegisterPaymentCommand,
  RegisterPaymentInput,
} from '@/modules/billing/application/commands/billing.commands'
import {
  Currency as BillingCurrency,
  ExchangeRateSource,
  PaymentMethod as BillingPaymentMethod,
  PaymentReceiver,
} from '@/modules/billing/domain/billing'
import { InstallmentRepository } from '@/modules/billing/domain/billing.ports'
import { InstallmentPolicy } from '@/modules/billing/domain/installment.policy'
import {
  CreateContractCommand,
  TerminateContractCommand,
} from '@/modules/contracts/application/commands/contract.commands'
import {
  CreateInquiryCommand,
  MoveInquiryCommand,
} from '@/modules/crm/application/crm.messages'
import { InquiryStage } from '@/modules/crm/domain/inquiry'
import { CreateCatalogItemCommand } from '@/modules/master-data/application/commands/catalog.commands'
import { CreateLocationCommand } from '@/modules/master-data/application/commands/location.commands'
import { Catalog } from '@/modules/master-data/domain/catalog'
import { LocationLevel } from '@/modules/master-data/domain/location'
import {
  CreateOwnerCommand,
  IssueOwnerPortalCredentialsCommand,
  UpdateOwnerFeeSettingsCommand,
} from '@/modules/owners/application/commands/owner.commands'
import {
  AddPropertyPhotosCommand,
  ChangePropertyStatusCommand,
  CreatePropertyCommand,
} from '@/modules/properties/application/commands/property.commands'
import {
  ListingCurrency,
  ListingOperation,
  PropertyStatus,
} from '@/modules/properties/domain/property'
import { CreateGuarantorCommand } from '@/modules/renters/application/commands/guarantor.commands'
import {
  CreateRenterCommand,
  IssueRenterPortalCredentialsCommand,
} from '@/modules/renters/application/commands/renter.commands'
import { CreateAdvanceExpenseCommand } from '@/modules/services/application/commands/advance-expense.commands'
import { CreateServiceCommand } from '@/modules/services/application/commands/service.commands'
import {
  IncreaseFrequency,
  ServicePayer,
} from '@/modules/services/domain/property-service'
import {
  ConfirmSettlementCommand,
  CreateSettlementCommand,
  RecalculateSettlementCommand,
  RegisterSettlementTransferCommand,
} from '@/modules/settlements/application/commands/settlement.commands'
import { PaymentMethod as SettlementPaymentMethod } from '@/modules/settlements/domain/settlement'
import { UpdateTenantSettingsCommand } from '@/modules/tenants/application/commands/tenant-settings.commands'
import { RequestContext } from '@/shared/context/request-context'
import { DomainException } from '@/shared/errors'
import { IsoDate } from '@/shared/dates/calendar-date'
import {
  addMoney,
  compareMoney,
  multiplyMoney,
  toMoneyString,
} from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { seedBaseMasterData } from '../../prisma/lib/master-data-seed'
import { provisionTenant } from '../../prisma/lib/tenant-provisioning'
import { DemoCalendar } from './demo-calendar'
import {
  ContractSeed,
  DEMO_MARK,
  DemoPlan,
  PaymentPlan,
  TenantPlan,
} from './demo-plan.types'
import { placeholderPng } from './placeholder-image'

/** Qué hizo el seed en una inmobiliaria (alimenta el resumen y los tests). */
export interface TenantRunReport {
  slug: string
  name: string
  tenantId: string
  tenantCreated: boolean
  /** Entidades creadas en ESTA corrida, por tipo. En la segunda corrida: todo en 0. */
  created: Record<string, number>
  users: { role: string; email: string }[]
  /** Contrato por código del plan de pruebas. */
  contracts: {
    code: string
    covers: string
    contractId: string
    status: string
    property: string
    renter: string
  }[]
  /** Casos de borde de personas y propiedades: código -> descripción. */
  entities: { code: string; kind: string; description: string }[]
  notes: string[]
}

export interface DemoRunReport {
  password: string
  tenants: TenantRunReport[]
}

interface TenantContext {
  plan: TenantPlan
  tenantId: string
  report: TenantRunReport
  guarantorIds: Map<string, string>
  ownerIds: Map<string, string>
  renterIds: Map<string, string>
  propertyIds: Map<string, string>
  contractIds: Map<string, string>
}

function isDomainError(error: unknown, ...codes: string[]): boolean {
  return error instanceof DomainException && codes.includes(error.code)
}

/** La fecha más tardía de las dos. */
function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b
}

/**
 * Carga los datos de demo por los casos de uso reales (commands, facades y
 * servicios de cada módulo), dentro del tenant y con el administrador de la
 * inmobiliaria como usuario del contexto: así corren las mismas reglas de
 * negocio, el mismo filtro de tenant y la misma auditoría que en la API.
 *
 * Las lecturas que usa para no duplicar (buscar un DNI, una dirección) van por
 * el cliente de Prisma del tenant; nunca escribe con SQL directo.
 *
 * Idempotente: cada entidad se busca por su clave natural (DNI, dirección,
 * marca `[DEMO C-xx]` en las notas del contrato...) y sólo se crea si falta.
 * Nunca modifica ni borra lo que ya existe.
 */
export class DemoSeeder {
  private readonly commands: CommandBus
  private readonly prisma: PrismaService
  private readonly installments: InstallmentRepository
  private readonly users: UserRepository
  private readonly passwords: PasswordService
  private readonly storageIsLocal: boolean

  constructor(
    app: INestApplicationContext,
    private readonly calendar: DemoCalendar,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    const get = <T>(token: abstract new (...args: never[]) => T): T =>
      app.get(token as never, { strict: false })
    this.commands = get(CommandBus)
    this.prisma = get(PrismaService)
    this.installments = get(InstallmentRepository)
    this.users = get(UserRepository)
    this.passwords = get(PasswordService)
    const storage = get(ConfigService).get('storage', {
      infer: true,
    } as never) as { provider: string } | undefined
    this.storageIsLocal = storage?.provider === 'local'
  }

  /** Desde cuándo se miran los trabajos de la cola: los de corridas viejas no cuentan. */
  private startedAt = new Date()

  async run(plan: DemoPlan): Promise<DemoRunReport> {
    this.startedAt = new Date()
    const tenants: TenantRunReport[] = []
    for (const tenantPlan of plan.tenants) {
      tenants.push(await this.seedTenant(tenantPlan, plan.password))
    }
    return { password: plan.password, tenants }
  }

  // ----------------------------------------------------------------------

  private async seedTenant(
    plan: TenantPlan,
    password: string,
  ): Promise<TenantRunReport> {
    this.log(`\n== ${plan.name} (${plan.slug}) ==`)
    const { tenant, admin, created } = await this.ensureTenant(plan, password)
    const ctx: TenantContext = {
      plan,
      tenantId: tenant.id,
      guarantorIds: new Map(),
      ownerIds: new Map(),
      renterIds: new Map(),
      propertyIds: new Map(),
      contractIds: new Map(),
      report: {
        slug: plan.slug,
        name: plan.name,
        tenantId: tenant.id,
        tenantCreated: created,
        created: {},
        users: [],
        contracts: [],
        entities: [],
        notes: [],
      },
    }
    ctx.report.users.push({ role: 'ADMIN', email: plan.admin.email })

    await RequestContext.run(
      {
        correlationId: `seed-demo-${randomUUID()}`,
        tenantId: tenant.id,
        userId: admin.id,
        userEmail: admin.email,
        userRole: Role.ADMIN,
      },
      async () => {
        await this.ensureEmployee(ctx, password)
        await this.ensureSettings(ctx)
        await this.ensureMasterData(ctx)
        await this.ensureGuarantors(ctx)
        await this.ensureOwners(ctx, password)
        await this.ensureRenters(ctx, password)
        await this.ensureProperties(ctx)
        await this.ensureContractsAndHistory(ctx)
        await this.ensureServices(ctx)
        await this.ensureInquiries(ctx)
        await this.collectReport(ctx)
      },
    )
    return ctx.report
  }

  /**
   * Espera a que la cola termine lo que dejaron los comandos (borradores de
   * liquidación, cuenta de honorarios, recibos). Esos efectos corren en segundo
   * plano, como en la API real: sin esperar, el paso siguiente podría ver una
   * liquidación a medio armar. Sólo mira trabajos creados por esta corrida y
   * se rinde a los 60 s (un reintento con demora no se espera).
   */
  private async waitForQueueIdle(ctx: TenantContext): Promise<void> {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const [{ pending }] = await this.prisma.$queryRaw<{ pending: number }[]>`
        SELECT CASE WHEN to_regclass('pgboss.job') IS NULL THEN 0 ELSE
          (SELECT count(*)::int FROM pgboss.job
            WHERE state IN ('created', 'retry', 'active')
              AND created_on >= ${this.startedAt})
        END AS pending`
      if (pending === 0) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    ctx.report.notes.push(
      'La cola no terminó en 60 s: puede faltar algún borrador de liquidación o recibo.',
    )
  }

  private count(ctx: TenantContext, kind: string): void {
    ctx.report.created[kind] = (ctx.report.created[kind] ?? 0) + 1
  }

  // ------------------------------------------------------------ Inmobiliaria

  private async ensureTenant(plan: TenantPlan, password: string) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: plan.slug },
    })
    if (existing) {
      // Un slug ocupado por otra cosa (una inmobiliaria real) no se toca.
      if (existing.name !== plan.name) {
        throw new Error(
          `Ya existe una inmobiliaria con slug "${plan.slug}" que no es la de demo ` +
            `("${existing.name}"). El seed no la toca.`,
        )
      }
      const admin = await this.prisma.user.findFirst({
        where: {
          tenantId: existing.id,
          email: plan.admin.email,
          role: PrismaRole.ADMIN,
        },
      })
      if (!admin) {
        throw new Error(
          `La inmobiliaria ${plan.slug} existe pero no tiene el administrador ${plan.admin.email}.`,
        )
      }
      this.log('  inmobiliaria: ya existía')
      return { tenant: existing, admin, created: false }
    }

    const provisioned = await provisionTenant(this.prisma, {
      name: plan.name,
      slug: plan.slug,
      adminEmail: plan.admin.email,
      adminPassword: password,
      adminFirstName: plan.admin.firstName,
      dailyLateFeePercentage: plan.dailyLateFeePercentage,
      bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    })
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: provisioned.tenantId },
    })
    const admin = await this.prisma.user.findUniqueOrThrow({
      where: { id: provisioned.adminId },
    })
    this.log('  inmobiliaria: creada')
    return { tenant, admin, created: true }
  }

  private async ensureEmployee(ctx: TenantContext, password: string) {
    const { employee } = ctx.plan
    ctx.report.users.push({ role: 'EMPLOYEE', email: employee.email })
    const exists = await this.prisma.db.user.findFirst({
      where: { email: employee.email, role: PrismaRole.EMPLOYEE },
    })
    if (exists) return
    await this.commands.execute(
      new CreateUserCommand(
        employee.email,
        employee.firstName,
        employee.lastName,
        Role.EMPLOYEE,
        password,
      ),
    )
    this.count(ctx, 'users')
  }

  /** Datos legales y días de gracia: sólo si la inmobiliaria todavía no los tiene. */
  private async ensureSettings(ctx: TenantContext) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
    })
    if (tenant.legalName) return
    const { legal } = ctx.plan
    await this.commands.execute(
      new UpdateTenantSettingsCommand(ctx.tenantId, {
        paymentGraceDays: ctx.plan.paymentGraceDays,
        legalName: legal.legalName,
        taxId: legal.taxId,
        address: legal.address,
        phone: legal.phone,
        email: legal.email,
        bankAccountHolder: legal.bank.holder,
        bankName: legal.bank.bankName,
        bankCbu: legal.bank.cbu,
        bankAlias: legal.bank.alias,
      }),
    )
    this.count(ctx, 'tenantSettings')
  }

  // --------------------------------------------------------------- Maestros

  private async ensureMasterData(ctx: TenantContext) {
    // El catálogo base (idempotente) más las localidades y barrios de ejemplo.
    const { created } = await seedBaseMasterData(this.prisma, ctx.tenantId, {
      withSampleCities: true,
    })
    if (created > 0) ctx.report.created.masterData = created

    if (!ctx.plan.extraMasterData) return

    const find = (name: string, level: LocationLevel) =>
      this.prisma.db.location.findFirst({ where: { name, level } })
    const ensureLocation = async (
      level: LocationLevel,
      name: string,
      parentId: string | null,
    ): Promise<string> => {
      const found = await find(name, level)
      if (found) return found.id
      const created = (await this.commands.execute(
        new CreateLocationCommand(level, name, parentId),
      )) as { id: string }
      this.count(ctx, 'locations')
      return created.id
    }
    const country = await find('Argentina', LocationLevel.COUNTRY)
    if (!country) return
    const province = await ensureLocation(
      LocationLevel.PROVINCE,
      'Santa Fe',
      country.id,
    )
    const city = await ensureLocation(LocationLevel.CITY, 'Rosario', province)
    await ensureLocation(LocationLevel.NEIGHBORHOOD, 'Pichincha', city)

    const hasWarehouse = await this.prisma.db.propertyType.findFirst({
      where: { name: 'Galpón' },
    })
    if (!hasWarehouse) {
      await this.commands.execute(
        new CreateCatalogItemCommand(Catalog.PROPERTY_TYPES, 'Galpón'),
      )
      this.count(ctx, 'propertyTypes')
    }
  }

  // ---------------------------------------------------------------- Personas

  private async ensureGuarantors(ctx: TenantContext) {
    for (const seed of ctx.plan.guarantors) {
      const found = await this.prisma.db.guarantor.findFirst({
        where: { nationalId: seed.nationalId },
      })
      let guarantorId = found?.id
      if (!guarantorId) {
        const created = (await this.commands.execute(
          new CreateGuarantorCommand({
            firstName: seed.firstName,
            lastName: seed.lastName,
            nationalId: seed.nationalId,
            phone: seed.phone,
            email: seed.email,
            address: seed.address,
            guaranteeType: seed.guaranteeType,
            guaranteeDetail: seed.guaranteeDetail,
            notes: `${DEMO_MARK}: ${seed.code}`,
          }),
        )) as { id: string }
        guarantorId = created.id
        this.count(ctx, 'guarantors')
      }
      ctx.guarantorIds.set(seed.code, guarantorId)
      ctx.report.entities.push({
        code: seed.code,
        kind: 'Garante',
        description: seed.guaranteeDetail,
      })
    }
  }

  private async ensureOwners(ctx: TenantContext, password: string) {
    for (const seed of ctx.plan.owners) {
      let owner = await this.prisma.db.owner.findFirst({
        where: { nationalId: seed.nationalId },
      })
      let ownerId = owner?.id
      if (!ownerId) {
        const created = (await this.commands.execute(
          new CreateOwnerCommand(
            {
              firstName: seed.firstName,
              lastName: seed.lastName,
              nationalId: seed.nationalId,
              phone: seed.phone,
              email: seed.email,
              address: seed.address,
              notes: seed.note,
            },
            {
              cbu: seed.bank?.cbu ?? null,
              alias: seed.bank?.alias ?? null,
              bankName: seed.bank?.bankName ?? null,
              holder: seed.bank?.holder ?? null,
            },
          ),
        )) as { id: string }
        ownerId = created.id
        this.count(ctx, 'owners')
        if (seed.feePercentage) {
          await this.commands.execute(
            new UpdateOwnerFeeSettingsCommand(ownerId, {
              feePercentage: seed.feePercentage,
            }),
          )
        }
        owner = await this.prisma.db.owner.findFirst({ where: { id: ownerId } })
      }
      ctx.ownerIds.set(seed.code, ownerId)
      ctx.report.entities.push({
        code: seed.code,
        kind: 'Propietario',
        description: seed.note,
      })

      if (seed.portal && owner && !owner.portalUserId) {
        const credentials = (await this.commands.execute(
          new IssueOwnerPortalCredentialsCommand(ownerId),
        )) as { userId: string; email: string }
        await this.setKnownPassword(credentials.userId, password)
        this.count(ctx, 'portalAccounts')
      }
      if (seed.portal && seed.email) {
        ctx.report.users.push({ role: 'OWNER (portal)', email: seed.email })
      }
    }
  }

  private async ensureRenters(ctx: TenantContext, password: string) {
    for (const seed of ctx.plan.renters) {
      let renter = await this.prisma.db.renter.findFirst({
        where: { nationalId: seed.nationalId },
      })
      let renterId = renter?.id
      if (!renterId) {
        const created = (await this.commands.execute(
          new CreateRenterCommand({
            firstName: seed.firstName,
            lastName: seed.lastName,
            nationalId: seed.nationalId,
            phone: seed.phone,
            email: seed.email,
            address: seed.address,
            moveInDate: null,
            notes: seed.note,
            guarantorId: seed.guarantor
              ? (ctx.guarantorIds.get(seed.guarantor) ?? null)
              : null,
          }),
        )) as { id: string }
        renterId = created.id
        this.count(ctx, 'renters')
        renter = await this.prisma.db.renter.findFirst({
          where: { id: renterId },
        })
      }
      ctx.renterIds.set(seed.code, renterId)
      ctx.report.entities.push({
        code: seed.code,
        kind: 'Inquilino',
        description: seed.note,
      })

      if (seed.portal && renter && !renter.portalUserId) {
        const credentials = (await this.commands.execute(
          new IssueRenterPortalCredentialsCommand(renterId),
        )) as { userId: string }
        await this.setKnownPassword(credentials.userId, password)
        this.count(ctx, 'portalAccounts')
      }
      if (seed.portal && seed.email) {
        ctx.report.users.push({ role: 'RENTER (portal)', email: seed.email })
      }
    }
  }

  /** Los accesos de portal salen con una clave aleatoria; el demo los deja con la clave conocida. */
  private async setKnownPassword(userId: string, password: string) {
    await this.users.changePassword(userId, await this.passwords.hash(password))
  }

  // ------------------------------------------------------------ Propiedades

  private async ensureProperties(ctx: TenantContext) {
    for (const seed of ctx.plan.properties) {
      let property = await this.prisma.db.property.findFirst({
        where: { address: seed.address },
      })
      let propertyId = property?.id
      if (!propertyId) {
        const location = await this.prisma.db.location.findFirst({
          where: { name: seed.neighborhood, level: LocationLevel.NEIGHBORHOOD },
        })
        const type = await this.prisma.db.propertyType.findFirst({
          where: { name: seed.propertyType },
        })
        if (!location || !type) {
          throw new Error(
            `Faltan maestros para ${seed.code}: barrio "${seed.neighborhood}" o tipo "${seed.propertyType}".`,
          )
        }
        const created = (await this.commands.execute(
          new CreatePropertyCommand({
            address: seed.address,
            locationId: location.id,
            propertyTypeId: type.id,
            ownerId: seed.owner ? (ctx.ownerIds.get(seed.owner) ?? null) : null,
            amenityIds: [],
            notes: seed.note,
            listingPrice: seed.listingPrice,
            listingCurrency: ListingCurrency[seed.listingCurrency],
            listingOperation: ListingOperation[seed.operation],
            publicDescription: seed.publicDescription,
            bedrooms: seed.bedrooms,
            bathrooms: seed.bathrooms,
            rooms: null,
            totalAreaM2: seed.totalAreaM2,
            coveredAreaM2: null,
            ageYears: null,
            latitude: seed.latitude,
            longitude: seed.longitude,
          }),
        )) as { id: string }
        propertyId = created.id
        this.count(ctx, 'properties')
        if (seed.status === 'MAINTENANCE') {
          await this.commands.execute(
            new ChangePropertyStatusCommand(
              propertyId,
              PropertyStatus.MAINTENANCE,
            ),
          )
        }
        property = await this.prisma.db.property.findFirst({
          where: { id: propertyId },
        })
      }
      ctx.propertyIds.set(seed.code, propertyId)
      ctx.report.entities.push({
        code: seed.code,
        kind: 'Propiedad',
        description: [
          seed.address,
          seed.owner ? `de ${seed.owner}` : 'sin propietario',
          seed.operation === 'SALE' ? 'en venta' : null,
          seed.status === 'MAINTENANCE' ? 'en mantenimiento' : null,
          seed.listingPrice === null && seed.operation === 'RENT'
            ? 'sin precio (Consultar)'
            : null,
          seed.latitude === null ? 'sin coordenadas' : 'con coordenadas',
          seed.photos > 0 ? `${seed.photos} fotos` : null,
        ]
          .filter(Boolean)
          .join(', '),
      })

      if (seed.photos > 0) await this.ensurePhotos(ctx, propertyId, seed.photos)
    }
  }

  private async ensurePhotos(
    ctx: TenantContext,
    propertyId: string,
    wanted: number,
  ) {
    // Con Cloudinary u otro proveedor remoto no se suben placeholders.
    if (!this.storageIsLocal) {
      ctx.report.notes.push(
        'Sin fotos placeholder: STORAGE_PROVIDER no es local.',
      )
      return
    }
    const existing = await this.prisma.db.propertyPhoto.count({
      where: { propertyId },
    })
    if (existing > 0) return
    await this.commands.execute(
      new AddPropertyPhotosCommand(
        propertyId,
        Array.from({ length: wanted }, (_, index) => ({
          buffer: placeholderPng(index),
          mimeType: 'image/png',
        })),
      ),
    )
    this.count(ctx, 'photos')
  }

  // -------------------------------------------- Contratos, cuotas y pagos

  private async findContract(code: string) {
    return this.prisma.db.contract.findFirst({
      where: { notes: { startsWith: `[${DEMO_MARK} ${code}]` } },
    })
  }

  private async ensureContract(ctx: TenantContext, seed: ContractSeed) {
    const existing = await this.findContract(seed.code)
    if (existing) {
      ctx.contractIds.set(seed.code, existing.id)
      return
    }
    const guarantor =
      seed.guarantor === undefined
        ? undefined
        : seed.guarantor === null
          ? null
          : (ctx.guarantorIds.get(seed.guarantor) ?? null)
    const created = (await this.commands.execute(
      new CreateContractCommand(
        this.requireId(ctx.propertyIds, seed.property),
        this.requireId(ctx.renterIds, seed.renter),
        guarantor,
        {
          startDate: seed.start,
          endDate: seed.end,
          initialRent: seed.rent,
          currency: seed.currency,
          rentUpdateType: seed.updateType,
          rentUpdateFrequency: seed.updateFrequency,
          deposit: seed.deposit,
          depositCurrency: seed.depositCurrency ?? null,
          depositReturnMode: seed.depositMode,
          fixedIncreasePercentage: seed.fixedIncreasePercentage ?? null,
          notes: `[${DEMO_MARK} ${seed.code}] ${seed.covers}`,
          surety: seed.surety
            ? { hasSurety: true, ...seed.surety }
            : {
                hasSurety: false,
                insurerName: null,
                insurerAlertEmail: null,
                policyNumber: null,
                policyExpiresAt: null,
              },
          billing: {
            collectionMode: seed.collectionMode ?? null,
            feeMode: seed.feeMode ?? null,
            feeAmount: seed.feeAmount ?? null,
            // Sin dato propio, el contrato hereda el punitorio de la inmobiliaria.
            lateFeePercentage: seed.lateFeePercentage ?? null,
            lateFeeGraceDays: seed.lateFeeGraceDays ?? null,
          },
        },
      ),
    )) as { id: string }
    ctx.contractIds.set(seed.code, created.id)
    this.count(ctx, 'contracts')
    this.log(`  contrato ${seed.code} creado`)
  }

  private requireId(ids: Map<string, string>, code: string): string {
    const id = ids.get(code)
    if (!id) throw new Error(`El código ${code} no existe en el plan de demo`)
    return id
  }

  /**
   * La línea de tiempo: de hace 4 meses al mes que viene, mes por mes. En
   * cada mes se generan las cuotas (como el proceso automático), se cargan los
   * pagos de ese mes y se hacen las liquidaciones y rescisiones que tocan.
   * Así los pagos, las liquidaciones y las rescisiones quedan en el mismo
   * orden en que pasarían de verdad.
   */
  private async ensureContractsAndHistory(ctx: TenantContext) {
    const { contracts } = ctx.plan
    for (const seed of contracts.filter((c) => !c.createAfterTerminationOf)) {
      await this.ensureContract(ctx, seed)
    }

    await this.waitForQueueIdle(ctx)

    // Servicios y gastos de los contratos que ya existen: antes de liquidar,
    // porque los gastos adelantados pendientes entran en la liquidación.
    await this.ensureAdvanceExpenses(ctx)

    for (let offset = -4; offset <= 1; offset += 1) {
      await this.commands.execute(
        new GenerateInstallmentsCommand(this.calendar.period(offset)),
      )
      for (const seed of contracts) {
        const contractId = ctx.contractIds.get(seed.code)
        if (contractId) await this.payForMonth(ctx, seed, contractId, offset)
      }
      // Los pagos disparan cosas por la cola: se espera antes de liquidar.
      await this.waitForQueueIdle(ctx)
      for (const seed of contracts) {
        const contractId = ctx.contractIds.get(seed.code)
        if (!contractId) continue
        for (const settlement of seed.settlements ?? []) {
          if (settlement.after === offset) {
            await this.settle(ctx, seed, contractId, offset, settlement.mode)
          }
        }
        if (seed.terminate?.after === offset) {
          await this.terminate(ctx, seed, contractId)
        }
      }
      await this.waitForQueueIdle(ctx)
      // Los contratos que esperaban una rescisión se crean ahora.
      for (const seed of contracts) {
        if (
          seed.createAfterTerminationOf &&
          contracts.find((c) => c.code === seed.createAfterTerminationOf)
            ?.terminate?.after === offset
        ) {
          await this.ensureContract(ctx, seed)
        }
      }
    }
    await this.waitForQueueIdle(ctx)
    // Un contrato que esperaba una rescisión que ya ocurrió en una corrida
    // anterior (o cuya fecha quedó fuera de la ventana) igual tiene que existir.
    for (const seed of contracts.filter((c) => c.createAfterTerminationOf)) {
      if (!ctx.contractIds.has(seed.code)) await this.ensureContract(ctx, seed)
    }
  }

  private async payForMonth(
    ctx: TenantContext,
    seed: ContractSeed,
    contractId: string,
    offset: number,
  ) {
    const period = this.calendar.period(offset)
    const installment = await this.prisma.db.installment.findFirst({
      where: { contractId, period },
    })
    if (!installment) return

    const plan = this.paymentPlanFor(seed, offset)
    if (!plan) return
    // Un pago ya cargado (de una corrida anterior) no se repite.
    const already = await this.prisma.db.payment.count({
      where: { installmentId: installment.id },
    })
    if (already > 0) return

    const domain = await this.installments.findById(installment.id)
    if (!domain) return
    const paidAt = maxIso(
      this.clampToToday(this.calendar.dayOf(offset, plan.day)),
      seed.start,
    )
    const totalDue = InstallmentPolicy.balances(domain, paidAt).totalDue

    const currency = BillingCurrency[seed.currency]
    let amount = totalDue
    let paidCurrency = currency
    let exchange: Pick<
      RegisterPaymentInput,
      'exchangeRate' | 'exchangeRateSource' | 'exchangeRateDate'
    > = { exchangeRate: null, exchangeRateSource: null, exchangeRateDate: null }

    if (plan.how === 'overpay') {
      amount = toMoneyString(addMoney(totalDue, plan.extra ?? '0'))
    } else if (plan.how === 'partial') {
      amount = toMoneyString(
        multiplyMoney(domain.baseAmount, plan.fraction ?? '0.5'),
      )
    } else if (plan.how === 'foreign') {
      // Cuota en dólares pagada en pesos: pesos = dólares × cotización.
      paidCurrency = BillingCurrency.ARS
      amount = toMoneyString(multiplyMoney(totalDue, plan.rate ?? '1'))
      exchange = {
        exchangeRate: plan.rate ?? '1',
        exchangeRateSource: ExchangeRateSource.MEP,
        exchangeRateDate: paidAt,
      }
    }
    if (compareMoney(amount, '0') <= 0) return

    const result = (await this.commands.execute(
      new RegisterPaymentCommand(
        installment.id,
        {
          paidAt,
          amount,
          paidCurrency,
          ...exchange,
          method:
            plan.method === 'CASH'
              ? BillingPaymentMethod.CASH
              : BillingPaymentMethod.TRANSFER,
          // Sólo `informed` fuerza que lo reciba el propietario; el resto sigue
          // el modo de cobro del contrato.
          receivedBy: plan.how === 'informed' ? PaymentReceiver.OWNER : null,
          allocation: null,
          // El saldo a favor se deja disponible: no se consume solo.
          applyCredit: false,
          notes: `${DEMO_MARK}: pago de ${period} (${seed.code})`,
        },
        Buffer.alloc(0),
      ),
    )) as { payment: { id: string } }
    this.count(ctx, 'payments')

    if (plan.how === 'informed' && plan.confirm) {
      await this.commands.execute(new ConfirmPaymentCommand(result.payment.id))
    }
  }

  /** Lo que se paga en un mes: lo explícito del contrato o, en meses cerrados, el pago al día. */
  private paymentPlanFor(
    seed: ContractSeed,
    offset: number,
  ): PaymentPlan | null {
    const explicit = seed.payments?.[offset]
    if (explicit !== undefined) return explicit
    if (offset <= -1) return { day: 3, how: 'full' }
    return null
  }

  private clampToToday(date: IsoDate): IsoDate {
    return date > this.calendar.today ? this.calendar.today : date
  }

  private async settle(
    ctx: TenantContext,
    seed: ContractSeed,
    contractId: string,
    offset: number,
    mode: 'close' | 'draft',
  ) {
    const closed = await this.prisma.db.settlement.count({
      where: { contractId, status: { in: ['CONFIRMED', 'TRANSFERRED'] } },
    })
    const draft = await this.prisma.db.settlement.findFirst({
      where: { contractId, status: 'PENDING' },
    })
    if (mode === 'close' && closed > 0) return
    if (mode === 'draft' && draft) return

    let settlementId = draft?.id
    if (!settlementId) {
      try {
        const created = (await this.commands.execute(
          new CreateSettlementCommand(contractId, this.calendar.period(offset)),
        )) as { id: string }
        settlementId = created.id
        this.count(ctx, 'settlements')
      } catch (error) {
        if (isDomainError(error, 'SETTLEMENT_NOTHING_TO_SETTLE')) {
          ctx.report.notes.push(
            `${seed.code}: no había nada para liquidar en ${this.calendar.period(offset)}`,
          )
          return
        }
        throw error
      }
    }
    if (mode === 'draft') return

    // El borrador pudo armarlo la cola con menos pagos: se recalcula antes de cerrar.
    if (draft) {
      await this.commands.execute(
        new RecalculateSettlementCommand(settlementId),
      )
    }
    await this.commands.execute(new ConfirmSettlementCommand(settlementId))
    const confirmed = await this.prisma.db.settlement.findFirstOrThrow({
      where: { id: settlementId },
    })
    const net = toMoneyString(confirmed.netAmount.toString())
    if (compareMoney(net, '0') > 0) {
      await this.commands.execute(
        new RegisterSettlementTransferCommand(
          settlementId,
          {
            transferredAt: this.calendar.today,
            amount: net,
            method: SettlementPaymentMethod.TRANSFER,
            notes: `${DEMO_MARK}: transferencia al propietario (${seed.code})`,
          },
          Buffer.alloc(0),
        ),
      )
    }
  }

  private async terminate(
    ctx: TenantContext,
    seed: ContractSeed,
    contractId: string,
  ) {
    const contract = await this.prisma.db.contract.findFirstOrThrow({
      where: { id: contractId },
    })
    if (contract.status !== 'ACTIVE' || !seed.terminate) return
    await this.commands.execute(
      new TerminateContractCommand(contractId, seed.terminate.notifiedAt),
    )
    this.count(ctx, 'terminations')
  }

  // ----------------------------------------- Servicios y gastos adelantados

  private async ensureAdvanceExpenses(ctx: TenantContext) {
    for (const seed of ctx.plan.advanceExpenses) {
      const contractId = ctx.contractIds.get(seed.contract)
      if (!contractId) continue
      const exists = await this.prisma.db.advanceExpense.findFirst({
        where: { contractId, description: seed.description },
      })
      if (exists) continue
      await this.commands.execute(
        new CreateAdvanceExpenseCommand(
          contractId,
          {
            amount: seed.amount,
            description: seed.description,
            expenseDate: seed.expenseDate,
            currency: null,
          },
          // El comprobante es obligatorio en los gastos adelantados.
          placeholderPng(7),
        ),
      )
      this.count(ctx, 'advanceExpenses')
    }
  }

  private async ensureServices(ctx: TenantContext) {
    for (const seed of ctx.plan.services) {
      const propertyId = ctx.propertyIds.get(seed.property)
      const contractId = seed.contract
        ? (ctx.contractIds.get(seed.contract) ?? null)
        : null
      const type = await this.prisma.db.serviceType.findFirst({
        where: { name: seed.serviceType },
      })
      if (!propertyId || !type || (seed.contract && !contractId)) continue
      const exists = await this.prisma.db.propertyService.findFirst({
        where: { propertyId, serviceTypeId: type.id, contractId },
      })
      if (exists) continue
      await this.commands.execute(
        new CreateServiceCommand(propertyId, {
          contractId,
          serviceTypeId: type.id,
          paidBy: ServicePayer[seed.paidBy],
          currency: seed.currency as never,
          hasDueDate: seed.dueDate !== null,
          dueDate: seed.dueDate,
          hasIncrease: seed.increaseFrequency !== null,
          increaseFrequency: seed.increaseFrequency
            ? IncreaseFrequency[seed.increaseFrequency]
            : null,
          managedByAgency: seed.managedByAgency,
          notes: seed.note,
        }),
      )
      this.count(ctx, 'services')
    }
  }

  // --------------------------------------------------------------------- CRM

  private async ensureInquiries(ctx: TenantContext) {
    for (const seed of ctx.plan.inquiries) {
      const exists = await this.prisma.db.publicInquiry.findFirst({
        where: { name: seed.name },
      })
      if (exists) continue
      const created = (await this.commands.execute(
        new CreateInquiryCommand({
          name: seed.name,
          email: seed.email ?? undefined,
          phone: seed.phone ?? undefined,
          message: seed.message,
          propertyId: seed.property
            ? (ctx.propertyIds.get(seed.property) ?? undefined)
            : undefined,
          source: seed.source,
        }),
      )) as { id: string }
      this.count(ctx, 'inquiries')
      if (seed.stage !== InquiryStage.NEW) {
        await this.commands.execute(
          new MoveInquiryCommand(created.id, {
            stage: seed.stage,
            lostReason: seed.lostReason,
          }),
        )
      }
    }
  }

  // ----------------------------------------------------------------- Resumen

  private async collectReport(ctx: TenantContext) {
    for (const seed of ctx.plan.contracts) {
      const contract = await this.findContract(seed.code)
      if (!contract) continue
      const property = ctx.plan.properties.find((p) => p.code === seed.property)
      const renter = ctx.plan.renters.find((r) => r.code === seed.renter)
      ctx.report.contracts.push({
        code: seed.code,
        covers: seed.covers,
        contractId: contract.id,
        status: contract.status,
        property: property?.address ?? seed.property,
        renter: renter ? `${renter.firstName} ${renter.lastName}` : seed.renter,
      })
    }
  }
}
