/**
 * API pública del portal: nadie la importa salvo `app.module`. Los portales
 * de inquilinos y propietarios (Fases 17 y 18) sólo exponen endpoints HTTP.
 */
export { PortalModule } from '../infrastructure/modules/portal.module'
