import { Injectable } from '@nestjs/common'

import { TenantBrandingData, TenantsFacade } from '@/modules/tenants/public'
import { createLogger } from '@/shared/logging/root-logger'
import { isSafeSvg } from '@/shared/security/svg-safety'
import { DEFAULT_PRIMARY_COLOR, DocumentBranding } from './templates/layout'

const LOGO_TIMEOUT_MS = 5_000
const MAX_LOGO_BYTES = 2 * 1024 * 1024
/** Leyenda al pie cuando la inmobiliaria no configuró la suya (A-34). */
export const DEFAULT_FOOTER = 'Documento emitido por el sistema de gestión.'

const HEX = /^#[0-9a-fA-F]{6}$/

/** Detecta PNG, JPEG o SVG por los primeros bytes; pdfmake no lee WebP. */
function dataUriOf(file: Buffer): string | null {
  const encoded = file.toString('base64')
  if (file.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return `data:image/png;base64,${encoded}`
  }
  if (file.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return `data:image/jpeg;base64,${encoded}`
  }
  if (
    /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
      file.subarray(0, 1024).toString('utf8'),
    )
  ) {
    // Logos subidos antes del chequeo pueden ser inseguros: sin logo es mejor
    // que un SVG con referencias externas dentro del generador de PDFs.
    if (!isSafeSvg(file)) return null
    return `data:image/svg+xml;base64,${encoded}`
  }
  return null
}

/**
 * Lee el cuerpo cortando en cuanto pasa `maxBytes`. Antes se bajaba entero con
 * `arrayBuffer()` y recién después se comprobaba el tamaño, así que un logo
 * enorme (o sin fin) ocupaba memoria igual. Devuelve `null` si se pasa.
 */
export async function readAtMost(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!response.body) return null

  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * Marca de la inmobiliaria para los PDFs (Fase 15, 1): nombre, logo bajado y
 * embebido (si falla se omite, nunca frena el documento), color y pie fiscal.
 */
@Injectable()
export class DocumentBrandingResolver {
  private readonly logger = createLogger('DocumentBranding')

  constructor(private readonly tenants: TenantsFacade) {}

  async resolve(tenantId: string): Promise<DocumentBranding> {
    const tenant = await this.tenants.branding(tenantId)
    return {
      brandName: tenant.legalName ?? tenant.name,
      logoDataUri: await this.logo(tenant),
      primaryColor:
        tenant.primaryColor && HEX.test(tenant.primaryColor)
          ? tenant.primaryColor
          : DEFAULT_PRIMARY_COLOR,
      detailLines: detailLines(tenant),
      footerLines: footerLines(tenant),
    }
  }

  private async logo(tenant: TenantBrandingData): Promise<string | undefined> {
    if (!tenant.logoUrl) return undefined
    try {
      const response = await fetch(tenant.logoUrl, {
        signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
      })
      if (!response.ok) return undefined
      const file = await readAtMost(response, MAX_LOGO_BYTES)
      if (!file || file.length === 0) return undefined
      return dataUriOf(file) ?? undefined
    } catch (error) {
      this.logger.warn(
        { err: error, tenantId: tenant.id },
        'No se pudo bajar el logo; el PDF sale sin él',
      )
      return undefined
    }
  }
}

export function detailLines(tenant: TenantBrandingData): string[] {
  const contact = [tenant.phone, tenant.email].filter(Boolean).join(' - ')
  return [
    tenant.legalName && tenant.legalName !== tenant.name ? tenant.name : null,
    tenant.taxId ? `CUIT ${tenant.taxId}` : null,
    tenant.address,
    contact || null,
  ].filter((line): line is string => Boolean(line))
}

export function footerLines(tenant: TenantBrandingData): string[] {
  const fiscal = [
    tenant.legalName ?? tenant.name,
    tenant.taxId ? `CUIT ${tenant.taxId}` : null,
    tenant.address,
  ]
    .filter(Boolean)
    .join(' - ')
  return [fiscal, tenant.documentFooter ?? DEFAULT_FOOTER]
}
