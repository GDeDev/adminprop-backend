/**
 * API pública del portal público (Fase 22). Ningún otro módulo lo consume:
 * sólo se exporta el módulo para `app.module`. Las consultas que recibe las
 * administra el CRM (Fase 23, A-80).
 */
export { PublicModule } from '../infrastructure/modules/public.module'
