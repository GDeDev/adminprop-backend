# Sitio web de la inmobiliaria (funcional)

Cada inmobiliaria puede tener su **sitio web propio**, armado desde el backoffice y alimentado con sus propiedades. No hace falta saber de diseño ni de programación.

## Cómo funciona

1. Entrá a **Mi sitio web** (solo administradores). La primera vez el sistema te arma un sitio con los datos de tu inmobiliaria: nombre, color, teléfono, WhatsApp y dirección.
2. Elegí un **template**: **Clásico** (oscuro y cálido, con el buscador sobre una imagen a pantalla completa) o **Moderno** (claro y limpio, con barra de búsqueda horizontal).
3. Cambiá **colores, tipografía y esquinas**, y editá los **textos** de cada sección: portada, pasos, propiedades destacadas, números, servicios, testimonios, preguntas frecuentes, "nosotros", contacto y SEO.
4. Mirá cómo queda en la **vista previa** (celular, tablet o escritorio) sin que nadie más lo vea.
5. **Publicá**. Mientras no publiques, lo que editás es un **borrador**: el público sigue viendo la última versión publicada.
6. Podés **despublicar** cuando quieras: el sitio deja de verse y no se pierde nada de lo que armaste.

## Qué muestra el sitio

- **Propiedades**: las que están **Disponibles**, con sus fotos, precio, operación (venta o alquiler), ambientes, baños y superficies. Una propiedad alquilada o en mantenimiento desaparece sola en un minuto.
- **Consultas**: el formulario de contacto del sitio crea la consulta en tu bandeja (con el aviso de siempre al personal).
- Las propiedades **destacadas** pueden ser las últimas cargadas o las que elijas a mano.

## Datos nuevos en las propiedades

Al cargar o editar una propiedad hay campos nuevos, todos opcionales: **operación** (venta o alquiler; las existentes quedan en alquiler), **ambientes, dormitorios, baños, superficie total y cubierta, antigüedad**. El sitio los usa en las tarjetas, los filtros y la ficha. Si no los cargás, simplemente no se muestran.

## Dirección del sitio

- **Subdominio**: elegís un nombre (por ejemplo `miinmobiliaria`) y el sitio queda en `miinmobiliaria.<dominio de Adminprop>`. Tiene que ser único: el editor te avisa si ya está en uso. Se usan letras, números y guiones; algunos nombres (`www`, `admin`, `api`…) están reservados.
- **Dominio propio** (por ejemplo `www.tuinmobiliaria.com.ar`): al guardarlo queda reservado, pero el sitio no responde ahí hasta que se **verifica** con un registro TXT en el DNS (el editor muestra el nombre y el valor). Verificado, el dominio es exclusivo de esa inmobiliaria. El alta en el hosting y el registro CNAME los hace una persona del equipo técnico.

## Reglas para publicar

- Todo es **texto plano**: no se admite código ni formato HTML. Los links de redes sociales tienen que ser `https` de la red que corresponde.
- Las **imágenes** se suben desde el editor (JPG, PNG o WebP, hasta 5 MB; no se admite SVG).
- Una sección visible tiene que tener contenido; si no, ocultala. Las destacadas "a mano" necesitan al menos una propiedad.
- Los **colores** tienen que permitir leer el texto (contraste mínimo AA). El editor te lo marca y el sistema no deja publicar si no se lee.
- El título y la descripción de **SEO** son obligatorios para publicar.

## Qué no incluye (por ahora)

Editor visual de arrastrar y soltar, blog, más de dos templates, mapa interactivo, varios idiomas y estadísticas propias. El certificado y el DNS de un dominio propio no son automáticos.
