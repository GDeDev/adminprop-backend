/**
 * API pública de la tasación (Fase 24). `ValuationModule` lo importa
 * `app.module`; automatizaciones usa `ValuationFacade` para el job global.
 */
export { ValuationModule } from '../infrastructure/modules/valuation.module'
export { ValuationFacade } from './valuation.facade'
export type {
  AppraiseInput,
  RefreshSummary,
  ValuationView,
} from './valuation.facade'
