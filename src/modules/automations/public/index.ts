/**
 * API pública de automatizaciones: sólo `app.module` la importa. El módulo no
 * expone facade: nadie le pide cosas, él recorre a los demás.
 */
export { AutomationsModule } from '../infrastructure/modules/automations.module'
export { AutomationsFacade } from './automations.facade'
