import { randomUUID } from 'node:crypto'

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { roundMoney, toMoneyString } from '@/shared/money'
import { StoragePort } from '@/platform/storage/storage.port'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { TenantSettingsPatch } from '../../domain/tenant.entity'
import {
  InvalidTenantBillingSettingException,
  InvalidTenantLogoException,
  TenantNotFoundException,
} from '../../domain/tenant.exceptions'
import { TenantRepository } from '../../domain/tenant.repository'
import {
  detectLogoFormat,
  findUnsafeSvgReason,
  MAX_LOGO_BYTES,
} from '../tenant-logo'
import {
  TenantSettingsView,
  toTenantSettingsView,
} from '../tenant-settings.view'
import {
  DeleteTenantLogoCommand,
  UpdateTenantSettingsCommand,
  UploadTenantLogoCommand,
} from './tenant-settings.commands'

/** Un string vacío o en blanco es "sin dato"; `undefined` no toca el campo. */
function normalize(value: string | null | undefined) {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Edita los datos legales, bancarios y de marca (Fase 15, 2) y los parámetros
 * de cobro: punitorio por defecto y gracia (D-227). Los contratos que heredan
 * el valor lo toman en la próxima cuota; las cuotas ya generadas no cambian.
 */
@CommandHandler(UpdateTenantSettingsCommand)
export class UpdateTenantSettingsHandler implements ICommandHandler<
  UpdateTenantSettingsCommand,
  TenantSettingsView
> {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(
    command: UpdateTenantSettingsCommand,
  ): Promise<TenantSettingsView> {
    const patch: TenantSettingsPatch = {}
    const { dailyLateFeePercentage, paymentGraceDays, ...texts } = command.patch
    // `null` llega porque el DTO deja pasar el nulo de los campos opcionales:
    // estos dos no se pueden borrar, sólo cambiar.
    if (dailyLateFeePercentage === null || paymentGraceDays === null) {
      throw new InvalidTenantBillingSettingException(
        dailyLateFeePercentage === null
          ? 'dailyLateFeePercentage'
          : 'paymentGraceDays',
        'no se puede quitar: indicá un valor (0 = sin punitorio)',
      )
    }
    if (dailyLateFeePercentage !== undefined) {
      const percentage = roundMoney(dailyLateFeePercentage)
      if (percentage.isNegative() || percentage.greaterThan(100)) {
        throw new InvalidTenantBillingSettingException(
          'dailyLateFeePercentage',
          'tiene que estar entre 0 y 100',
        )
      }
      patch.dailyLateFeePercentage = toMoneyString(percentage)
    }
    if (paymentGraceDays !== undefined)
      patch.paymentGraceDays = paymentGraceDays
    for (const [key, value] of Object.entries(texts)) {
      const normalized = normalize(value as string | null | undefined)
      if (normalized !== undefined) {
        Object.assign(patch, {
          [key]:
            key === 'primaryColor' && normalized !== null
              ? normalized.toLowerCase()
              : normalized,
        })
      }
    }
    const tenant = await this.tenants.updateSettings(command.tenantId, patch)
    return toTenantSettingsView(tenant)
  }
}

/** Sube el logo y borra el anterior (si no se puede, queda un archivo huérfano y se avisa). */
@CommandHandler(UploadTenantLogoCommand)
export class UploadTenantLogoHandler implements ICommandHandler<
  UploadTenantLogoCommand,
  TenantSettingsView
> {
  private readonly logger = createLogger('UploadTenantLogoHandler')

  constructor(
    private readonly tenants: TenantRepository,
    private readonly storage: StoragePort,
  ) {}

  async execute(command: UploadTenantLogoCommand): Promise<TenantSettingsView> {
    const { file } = command
    if (file.length === 0 || file.length > MAX_LOGO_BYTES) {
      throw new InvalidTenantLogoException('tiene que pesar hasta 2 MB')
    }
    const format = detectLogoFormat(file)
    if (!format) {
      throw new InvalidTenantLogoException('tiene que ser PNG, JPG, WebP o SVG')
    }
    if (format.extension === 'svg') {
      const unsafe = findUnsafeSvgReason(file)
      if (unsafe) throw new InvalidTenantLogoException(unsafe)
    }
    const current = await this.tenants.findById(command.tenantId)
    if (!current) throw new TenantNotFoundException()

    const stored = await this.storage.upload(
      file,
      `branding/logo-${randomUUID()}.${format.extension}`,
      { contentType: format.contentType },
    )
    const updated = await this.tenants.setLogo(command.tenantId, stored)
    await discard(this.storage, this.logger, current.logoKey)
    return toTenantSettingsView(updated)
  }
}

@CommandHandler(DeleteTenantLogoCommand)
export class DeleteTenantLogoHandler implements ICommandHandler<
  DeleteTenantLogoCommand,
  TenantSettingsView
> {
  private readonly logger = createLogger('DeleteTenantLogoHandler')

  constructor(
    private readonly tenants: TenantRepository,
    private readonly storage: StoragePort,
  ) {}

  async execute(command: DeleteTenantLogoCommand): Promise<TenantSettingsView> {
    const current = await this.tenants.findById(command.tenantId)
    if (!current) throw new TenantNotFoundException()
    const updated = await this.tenants.setLogo(command.tenantId, null)
    await discard(this.storage, this.logger, current.logoKey)
    return toTenantSettingsView(updated)
  }
}

async function discard(
  storage: StoragePort,
  logger: ReturnType<typeof createLogger>,
  key: string | null,
): Promise<void> {
  if (!key) return
  try {
    await storage.delete(key)
  } catch (error) {
    logger.warn(
      { key, error: errorMessage(error) },
      'No se pudo borrar el logo anterior',
    )
  }
}
