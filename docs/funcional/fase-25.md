# Fase 25 — Inventario del contrato (funcional)

Sirve para dejar constancia del estado de la propiedad cuando se entrega al inquilino y cuando la devuelve, y compararlos.

## Cómo se usa

1. **Entrega.** En el contrato se crea el inventario de entrega. Viene con una lista armada (cocina, baños, habitaciones, living, electricidad, gas, pintura, pisos y aberturas) con todo en "No aplica". Quien recorre la propiedad marca el estado de cada cosa (Bien, Regular, Mal), agrega notas y sube fotos (hasta 15 por ítem; JPG, PNG, WebP o HEIC). Puede agregar o sacar ítems. También se anota la fecha y si el inquilino estuvo presente y de acuerdo.
2. **Confirmar.** Hay que haber evaluado al menos un ítem. Al confirmar queda cerrado: no se puede cambiar nada. Si hay ítems en mal estado sin fotos, el sistema avisa (no impide confirmar).
3. **Corregir.** Si se detecta un error en un acta confirmada, se pide una corrección con el motivo. Se crea un borrador copiado del acta (con sus fotos); se edita y, al confirmarlo, reemplaza al original, que queda como historial.
4. **Devolución.** Se habilita cuando el contrato ya no está activo (finalizado o rescindido) o faltan 30 días o menos para su fin. Funciona igual que la entrega.
5. **Comparación.** Muestra lado a lado cada ítem de la entrega y de la devolución, con notas y fotos, y marca si empeoró, mejoró o quedó igual, más la cantidad de ítems que empeoraron. Si no hay entrega cargada lo avisa.

## Reglas

- Un solo inventario vigente de entrega y uno de devolución por contrato.
- Lo confirmado no se edita ni se borra; sólo se corrige.
- Lo ven y lo cargan administradores y empleados; propietarios e inquilinos no, por ahora.
- Cada inmobiliaria ve únicamente sus contratos e inventarios.
- Todo queda en el historial de auditoría, incluidas las fotos que se suben o se borran.

## Todavía no

- PDF del inventario ni de la comparación.
- Plantilla propia por inmobiliaria.
- Descartar una corrección en borrador.
