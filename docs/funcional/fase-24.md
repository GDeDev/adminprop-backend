# Fase 24 — Tasación automática de alquiler (funcional)

Sirve para que, al cargar o editar una propiedad, el sistema **sugiera un rango de alquiler** basado en avisos reales de la zona. Lo usan el administrador y los empleados; los propietarios e inquilinos no lo ven.

## Es una sugerencia, nunca un precio aplicado

El sistema calcula un rango y un precio sugerido, pero **no modifica el precio de la propiedad**. El botón «Usar este precio» sólo rellena el formulario; quien guarda es la persona. Cada tasación queda en el historial de la propiedad y en la auditoría, a nombre de quien la pidió.

## Cómo se pide

En el paso de precio de la propiedad hay un botón **Sugerir precio**. Antes de calcular, el sistema puede avisar si en esa zona hay pocos datos. Al pedirlo se muestra:

- el **rango** (de mínimo a máximo) y el **precio sugerido**, redondeado a la centena en pesos y a la decena en dólares;
- la **confianza**: Alta, Media o Baja;
- cuántos avisos se usaron, cuántos se descartaron por tener un precio atípico y qué antigüedad tiene el dato más viejo;
- una **justificación** en español con los números que se usaron.

Si la ficha no tiene superficie, se puede indicarla al pedir la tasación (también ambientes y comodidades). Sin superficie igual se calcula, comparando precios sin ajustar por tamaño, y el texto lo aclara: es menos preciso.

## De dónde salen los números

Del mercado: avisos de alquiler de la misma **zona**, del mismo **tipo de propiedad** y en la **misma moneda** (pesos y dólares no se mezclan ni se convierten). Los **calcula el sistema con una fórmula fija**, no una inteligencia artificial: el mismo pedido con los mismos datos da siempre el mismo resultado.

- Sólo cuentan avisos vistos en los últimos **45 días**.
- Se necesitan al menos **3 avisos**. Si en el barrio hay menos, se busca **una vez** en la zona más amplia (la ciudad, por ejemplo); el resultado lo avisa y la confianza baja un nivel. Si ni así alcanza, el sistema dice «No hay suficientes datos de mercado para esta zona todavía» y no inventa un precio.
- Con superficie, cada aviso se lleva al tamaño de la propiedad (precio por m²); los avisos de un tamaño muy distinto (más de 35 % de diferencia) o sin superficie no se comparan.
- Los precios **atípicos** (muy por encima o por debajo del resto) se descartan y se informa cuántos.
- Pesan más los avisos con las mismas comodidades y ambientes, y menos los más viejos.
- El precio sugerido es la **mediana ponderada**; el rango va del percentil 25 al 75 (con pocos avisos, del mínimo al máximo encontrados).
- **Confianza**: Alta con 10 avisos o más en la zona exacta, Media de 5 a 9, Baja debajo de eso o si se amplió la zona.

El sistema **no muestra los avisos individuales ni sus links**, sólo los resultados agregados.

Si está activada la redacción con inteligencia artificial, el modelo solamente **redacta la explicación** a partir de números ya calculados, sin ver la dirección ni datos del propietario; si agrega una cifra que no corresponde, se descarta su texto y se usa la plantilla. Por defecto está apagada.

## Límites y repetidos

- Cada inmobiliaria puede hacer **30 tasaciones por día**. Al pasarse, el sistema avisa que pruebe de nuevo mañana.
- Si se pide **la misma tasación** (misma propiedad y mismos datos) dentro de las 6 horas, se muestra la que ya existe, marcada como reutilizada, y no cuenta contra el límite.

## Historial

En la ficha de la propiedad se ve el **historial de tasaciones**, de la más nueva a la más vieja, con fecha, quién la pidió y el rango, para ver cómo evolucionó la zona.

## Datos de mercado

Los avisos se actualizan **solos cada noche** y son los mismos para todas las inmobiliarias (no hay datos de una inmobiliaria mezclados con los de otra). Sólo se refrescan las zonas donde alguien tiene propiedades disponibles o pidió una tasación, no todo el país. De cada aviso se guarda únicamente lo numérico (precio, superficie, ambientes, comodidades) y el link, sin textos, fotos ni contactos.

- El administrador ve el **estado de cada fuente** (al día, desactualizada, bloqueada, con error de lectura o sin activar) y cuántos avisos vigentes aporta.
- Puede **pedir la actualización de una zona** puntual; se hace en segundo plano con barra de avance, y como máximo una vez cada 24 horas por zona.
- Si una fuente lleva **3 corridas seguidas sin traer datos**, las inmobiliarias que tasaron en el último mes reciben un aviso («Datos de mercado desactualizados»), como mucho uno por día y fuente: las sugerencias pueden estar basadas en datos viejos.

## Qué falta para usarlo con datos reales

- Por ahora el sistema usa **una fuente de demostración** con datos inventados; sirve para ver el flujo completo, pero los precios no son de mercado. En producción esa fuente no se puede activar.
- Traer avisos de **Zonaprop, Argenprop y Mercado Libre** requiere activarlos explícitamente y hacer una primera corrida supervisada: los lectores de cada portal se probaron con páginas de ejemplo, no con los sitios reales. Además, **los términos de uso de los portales prohíben en general el scraping automatizado**: es una decisión a conversar con Giuliano antes de activarlo.
- Hay que **contrastar el rango con tasaciones reales de Micaela** para ajustar los pesos y la tolerancia.
- Sólo se tasa **alquiler**; la venta queda fuera de esta fase.
