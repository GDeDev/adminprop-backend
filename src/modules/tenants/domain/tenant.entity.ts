/**
 * Inmobiliaria tal como la ve este módulo: sólo lo que hace falta para
 * identificarla y mostrar su marca. Los parámetros de negocio (honorarios,
 * punitorios, días de corte) se suman cuando una fase los use.
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  primaryColor: string | null
  isActive: boolean
}
