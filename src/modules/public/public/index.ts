/**
 * API pública del portal público (Fase 22). Por ahora ningún otro módulo lo
 * consume: sólo se exporta el módulo para `app.module`. El CRM de la Fase 23
 * leerá las consultas desde acá (facade) cuando se haga.
 */
export { PublicModule } from '../infrastructure/modules/public.module'
