# Fase 21 — Migración de datos (funcional)

Sirve para pasar a Adminprop lo que hoy vive en Excel y en Tokko Broker, sin cargar todo a mano y sin miedo a romper nada. Lo ve y lo usa **solo el administrador**, en Configuración → Migración de datos.

## La idea: primero se revisa, después se importa

1. **Se analiza.** Subís el Excel (o pedís el stock de Tokko) y el sistema lo lee, lo valida y arma un **lote**. En este paso **no se crea ninguna propiedad, persona ni contrato**: sólo queda el lote para revisar.
2. **Se revisa.** Ves cuántas filas están listas, cuáles tienen errores (con qué dato y qué hay que corregir), cuáles ya existen en el sistema y cuáles se repiten dentro del archivo. Podés dejar filas afuera y decidir qué hacer con cada conflicto.
3. **Se confirma.** Se importa **exactamente lo que revisaste**; no se vuelve a leer el archivo. Por eso el botón de confirmar no se habilita hasta que el análisis termina.

Un lote que nadie confirma en 7 días se descarta solo y se borra el archivo que habías subido.

## Desde Excel

1. **Descargá la plantilla.** Trae una hoja de instrucciones y una hoja por tipo de dato: Propietarios, Garantes, Inquilinos, Propiedades y Contratos, con desplegables armados con los tipos, ubicaciones y opciones de tu inmobiliaria. La fila 2 de cada hoja es un ejemplo en gris: se ignora.
2. **Volcá tus datos.** No hace falta completar todas las hojas: las que dejes vacías se omiten (el lote te avisa cuáles faltaron). Las hojas se enlazan por **DNI/CUIT** (propietario de la propiedad, garante del inquilino, inquilino del contrato) y por el **Código** de la propiedad (contratos). Fechas `dd/mm/aaaa`; los montos aceptan `150.000`, `150000,50` o `1234.56`.
3. **Subilo.** Hasta 5.000 filas y 10 MB. Si el archivo no es un `.xlsx`, o se armó con otra versión de la plantilla, se rechaza con un mensaje claro: bajá la plantilla actual y volcá ahí los datos.

Cosas que conviene saber:

- La **ubicación** se escribe como ruta: `Provincia > Ciudad > Barrio`. Si todavía no existe, se crea al confirmar. Un nombre suelto sólo sirve si existe una sola ubicación con ese nombre.
- Un **tipo de propiedad** o un **amenity** que no existan también se crean al confirmar (el resumen te dice cuántos se van a crear). «Palermo» y «palermo» son lo mismo: no se duplican.
- Un **garante** sin tipo ni detalle de garantía se carga como «Recibos de sueldo — Importado sin detalle: completar».
- Un **contrato** sin índice de aumento queda con aumento manual, anual (el sistema avisa cuando corresponde; no aplica un índice que nadie eligió). Si la modalidad de cobro está vacía, cobra la inmobiliaria.
- Un contrato que **ya terminó** se carga como Finalizado y no cambia el estado de la propiedad ni del inquilino. **No se cargan cuotas de períodos anteriores**: el saldo anterior a la migración se queda fuera de Adminprop y el arranque es limpio desde el mes en curso.
- Dos contratos vigentes sobre la misma propiedad (o del mismo inquilino) no se permiten: el segundo aparece con error.

## Desde Tokko

Se pide el análisis con tres opciones: qué operaciones traer (por defecto **sólo alquiler**), cuántas propiedades como máximo (para probar con pocas) y si también se traen las **fotos**. Tokko aporta **propiedades, tipos, amenities, ubicaciones y fotos**; propietarios, inquilinos, garantes y contratos se migran por Excel.

- Una propiedad **sin ubicación** se carga igual, con la ubicación «Sin ubicación (revisar)», y queda marcada **A revisar**. En el listado de propiedades hay un filtro «A revisar»; al elegirle la ubicación correcta, la marca se va sola.
- Una propiedad sin propietario se crea igual; el reporte te dice cuáles quedaron pendientes de asignar.
- Si Tokko no responde o la API key es inválida, el lote queda **Fallido** con el motivo («Tokko respondió 401: revisá la API key») y no deja nada a medias.

## Conflictos: lo cargado a mano nunca se pisa

Si una fila coincide con algo que **ya está en el sistema** (mismo DNI/CUIT; misma dirección y ubicación; mismo contrato), queda como **conflicto** y se muestra qué campos difieren. Para cada una elegís:

- **Saltear** (lo normal, y el valor por defecto): no se toca nada.
- **Completar vacíos**: sólo se llenan los campos que hoy están vacíos en el sistema. **Nunca** se reemplaza un dato que ya estaba cargado.

Una fila repetida dentro del mismo archivo también es un conflicto, y siempre se saltea.

## Se puede repetir sin miedo

Cada fila importada deja una marca. Si subís el mismo Excel dos veces, o corrés Tokko otra vez, lo ya importado se reconoce como **Ya importada** y no se duplica ni se modifica.

## Después de confirmar

- La importación corre en segundo plano con barra de avance. Una fila que falla (por ejemplo, depende de otra que dejaste afuera) queda **Fallida** con el motivo y no frena a las demás; el lote termina **Parcial** si quedó alguna fila con error o fallida.
- Las **fotos** se traen aparte (mientras tanto el lote figura **Importando**, con las fotos migradas, pendientes y fallidas en el detalle): se descargan a los servidores de Adminprop (nunca queda un link a Tokko). Una foto que no se pudo bajar no deshace la propiedad; hay un botón **Reintentar fotos** que repite sólo las fallidas.
- El **reporte** (`.xlsx`) lista cada error y conflicto con hoja, fila, campo y mensaje, para corregir el archivo y volver a subirlo, y las fotos migradas o fallidas por propiedad.
- Todo queda en el historial de lotes, y las altas figuran en la auditoría a nombre de quien confirmó.

## Qué falta para la migración real de Oppido

La plantilla es nuestra: hay que **volcar en ella** los datos actuales de Oppido (se puede hacer de a poco, hoja por hoja). Para traer el stock real de Tokko hace falta la **API key de la cuenta de Oppido**, que se carga en Doppler (nunca en el código). Mientras tanto se puede probar todo con datos de demostración.
