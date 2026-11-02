/**
 * Plantilla estándar del inventario (A-43). Fija en código: se precarga al
 * crear un inventario sin ítems, con estado "No aplica" para que quien
 * recorre la propiedad sólo toque lo que evalúa.
 */
export const STANDARD_INVENTORY_TEMPLATE: readonly {
  category: string
  descriptions: readonly string[]
}[] = [
  {
    category: 'Cocina',
    descriptions: [
      'Mesada y bacha',
      'Grifería',
      'Cocina u horno',
      'Alacenas y bajomesada',
      'Paredes y techo',
    ],
  },
  {
    category: 'Baños',
    descriptions: [
      'Inodoro y bidet',
      'Lavatorio',
      'Ducha o bañera y grifería',
      'Espejo y accesorios',
    ],
  },
  {
    category: 'Habitaciones',
    descriptions: ['Placards', 'Paredes y techo', 'Ventanas y persianas'],
  },
  {
    category: 'Living/Comedor',
    descriptions: ['Paredes y techo', 'Iluminación'],
  },
  {
    category: 'Instalación eléctrica',
    descriptions: ['Tablero y llaves térmicas', 'Tomas e interruptores'],
  },
  {
    category: 'Instalación de gas',
    descriptions: [
      'Medidor y llave de paso',
      'Artefactos',
      'Calefón o termotanque',
    ],
  },
  {
    category: 'Pintura general',
    descriptions: ['Paredes interiores', 'Techos'],
  },
  {
    category: 'Pisos',
    descriptions: ['Pisos', 'Zócalos'],
  },
  {
    category: 'Aberturas',
    descriptions: ['Puertas', 'Ventanas', 'Cerraduras y llaves'],
  },
]
