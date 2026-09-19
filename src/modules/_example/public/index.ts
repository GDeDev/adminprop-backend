/**
 * API pública de `_example`: lo único que otro módulo puede importar de acá.
 *
 * - `ExampleModule` + `ExampleItemsFacade`: consultas sincrónicas.
 * - `EXAMPLE_ITEM_CREATED_QUEUE` + `ExampleItemCreatedPayload`: el evento, para
 *   quien quiera reaccionar a un alta.
 */
export { ExampleModule } from '../infrastructure/modules/example.module'
export { ExampleItemsFacade } from './example-items.facade'
export type { ExampleItemBasicInfo } from './example-items.facade'
export { EXAMPLE_ITEM_CREATED_QUEUE } from './example-events'
export type { ExampleItemCreatedPayload } from './example-events'
