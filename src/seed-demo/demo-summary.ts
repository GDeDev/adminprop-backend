import { DemoRunReport } from './demo-seeder'

const LABELS: Record<string, string> = {
  users: 'usuarios internos',
  tenantSettings: 'datos legales de la inmobiliaria',
  masterData: 'maestros base',
  locations: 'ubicaciones extra',
  propertyTypes: 'tipos de propiedad extra',
  guarantors: 'garantes',
  owners: 'propietarios',
  renters: 'inquilinos',
  portalAccounts: 'accesos de portal',
  properties: 'propiedades',
  photos: 'propiedades con fotos',
  contracts: 'contratos',
  payments: 'pagos',
  settlements: 'liquidaciones',
  terminations: 'rescisiones',
  advanceExpenses: 'gastos adelantados',
  services: 'servicios',
  inquiries: 'consultas de CRM',
}

/** El resumen que imprime `npm run seed:demo` al terminar. */
export function formatDemoSummary(report: DemoRunReport): string {
  const lines: string[] = []
  const push = (line = '') => lines.push(line)

  push('')
  push('==================== RESUMEN DEL SEED DE DEMO ====================')
  push(
    'SOLO DEMO: datos ficticios y contraseña publicada. No usar fuera de desarrollo.',
  )

  for (const tenant of report.tenants) {
    push('')
    push(`--- ${tenant.name} (slug: ${tenant.slug}) ---`)
    const created = Object.entries(tenant.created)
    if (tenant.tenantCreated) push('  Inmobiliaria creada en esta corrida.')
    if (created.length === 0 && !tenant.tenantCreated) {
      push('  Ya estaba todo cargado: no se creó nada nuevo.')
    } else {
      push('  Creado en esta corrida:')
      for (const [kind, total] of created) {
        push(`    - ${total} ${LABELS[kind] ?? kind}`)
      }
    }
    for (const note of tenant.notes) push(`  Nota: ${note}`)

    push('  Usuarios (contraseña de todos: ver abajo):')
    for (const user of tenant.users) push(`    - ${user.role}: ${user.email}`)

    push('  Mapa caso del plan de pruebas -> entidad creada:')
    for (const contract of tenant.contracts) {
      push(
        `    ${contract.code.padEnd(6)} ${contract.status.padEnd(10)} ${contract.property} | ${contract.renter}`,
      )
      push(`           ${contract.covers}`)
    }
  }

  push('')
  push(`Contraseña de DEMO de todos los usuarios: ${report.password}`)
  push('Backoffice: POST /api/v1/auth/login con email y contraseña.')
  push(
    'Portales:   POST /api/v1/auth/portal-login con el slug de la inmobiliaria.',
  )
  push('===================================================================')
  return lines.join('\n')
}
