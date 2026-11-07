import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { TenantBrandingData, TenantsFacade } from '@/modules/tenants/public'
import { Configuration } from '@/shared/config/configuration'
import {
  findCatalogEntry,
  NotificationTypeName,
} from '../domain/notification-catalog'
import {
  TemplateNotFoundException,
  TemplateUnknownVariableException,
} from '../domain/notification.exceptions'
import { NotificationConfigRepository } from '../domain/notification.ports'
import {
  DEFAULT_EMAIL_TEMPLATES,
  emailTemplateKey,
  escapeHtml,
  paragraphsToHtml,
  renderEmail,
  renderLayout,
  TEMPLATE_VARIABLES,
  TemplateVariable,
  typeOfTemplateKey,
  unknownVariables,
} from '../domain/notification-templates'
import { AgencyContext } from './notification-variables'

export interface ResolvedTemplate {
  key: string
  type: NotificationTypeName
  title: string
  subject: string
  bodyText: string
  variables: TemplateVariable[]
  isCustomized: boolean
  updatedAt: Date | null
}

/**
 * Plantillas de email de la inmobiliaria del contexto: el override de la base
 * si existe, el texto por defecto si no (A-50). Valida que sólo usen variables
 * permitidas y arma el HTML con la marca de la inmobiliaria.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly config: NotificationConfigRepository,
    private readonly tenants: TenantsFacade,
    private readonly appConfig: ConfigService<Configuration, true>,
  ) {}

  async list(): Promise<ResolvedTemplate[]> {
    const overrides = new Map(
      (await this.config.listTemplates()).map((row) => [row.key, row]),
    )
    return (Object.keys(DEFAULT_EMAIL_TEMPLATES) as NotificationTypeName[]).map(
      (type) => this.merge(type, overrides.get(emailTemplateKey(type))),
    )
  }

  async get(key: string): Promise<ResolvedTemplate> {
    const type = typeOfTemplateKey(key)
    if (!type) throw new TemplateNotFoundException(key)
    return this.merge(type, (await this.config.findTemplate(key)) ?? undefined)
  }

  async resolveForType(type: string): Promise<ResolvedTemplate | null> {
    const known = typeOfTemplateKey(emailTemplateKey(type))
    return known ? this.get(emailTemplateKey(known)) : null
  }

  /** 422 si el texto usa una variable que el tipo no declara. */
  assertValid(key: string, subject: string, bodyText: string): void {
    const type = typeOfTemplateKey(key)
    if (!type) throw new TemplateNotFoundException(key)
    const allowed = DEFAULT_EMAIL_TEMPLATES[type]!.variables
    const unknown = unknownVariables(`${subject}\n${bodyText}`, allowed)
    if (unknown.length > 0) throw new TemplateUnknownVariableException(unknown)
  }

  /** Datos de ejemplo del tipo, para la vista previa y el envío de prueba. */
  exampleValues(type: NotificationTypeName): Record<string, string> {
    const allowed = DEFAULT_EMAIL_TEMPLATES[type]!.variables
    return Object.fromEntries(
      allowed.map((name) => [name, TEMPLATE_VARIABLES[name].example]),
    )
  }

  async agency(tenantId: string): Promise<AgencyContext> {
    return this.agencyFrom(await this.tenants.branding(tenantId))
  }

  agencyFrom(branding: TenantBrandingData): AgencyContext {
    const base = this.appConfig.get('email', { infer: true }).portalBaseUrl
    return {
      name: branding.name,
      whatsapp: branding.whatsapp,
      phone: branding.phone,
      portalUrl: base ? `${base.replace(/\/$/, '')}/${branding.slug}` : '',
    }
  }

  /** Texto, asunto y HTML listos, con el layout de la inmobiliaria. */
  async preview(
    tenantId: string,
    type: NotificationTypeName,
    subject: string,
    bodyText: string,
  ): Promise<{ subject: string; text: string; html: string }> {
    const branding = await this.tenants.branding(tenantId)
    const values = {
      ...this.exampleValues(type),
      agencyName: branding.name,
    }
    const rendered = renderEmail(subject, bodyText, values)
    return {
      subject: rendered.subject,
      text: rendered.text,
      html: this.layout(rendered.text, branding),
    }
  }

  /** HTML a partir del texto ya renderizado: escapar es carácter a carácter, da lo mismo que escapar por partes. */
  layout(text: string, branding: TenantBrandingData): string {
    return renderLayout(paragraphsToHtml(escapeHtml(text)), {
      agencyName: branding.name,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      contactLine: [branding.name, branding.phone, branding.email]
        .filter(Boolean)
        .join(' · '),
    })
  }

  private merge(
    type: NotificationTypeName,
    override?: { subject: string; bodyText: string; updatedAt: Date },
  ): ResolvedTemplate {
    const base = DEFAULT_EMAIL_TEMPLATES[type]!
    return {
      key: emailTemplateKey(type),
      type,
      title: findCatalogEntry(type)?.title ?? type,
      subject: override?.subject ?? base.subject,
      bodyText: override?.bodyText ?? base.bodyText,
      variables: base.variables.map((name) => TEMPLATE_VARIABLES[name]),
      isCustomized: Boolean(override),
      updatedAt: override?.updatedAt ?? null,
    }
  }
}
