/**
 * API pública del inventario del inmueble (Fase 25). Por ahora ningún otro
 * módulo lo consume: sólo se exporta el módulo para `app.module`. Si el PDF
 * del inventario (A-45) o el portal lo necesitan, la facade va acá.
 */
export { InventoryModule } from '../infrastructure/modules/inventory.module'
