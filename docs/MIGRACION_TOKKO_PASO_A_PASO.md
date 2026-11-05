# Migrar de Tokko y de Excel a Adminprop, paso a paso

Para quien tiene acceso de **administrador** al backoffice y no es técnico. Explica qué se puede pasar a Adminprop, qué no, cómo preparar los datos, cómo se hace en pantalla y cómo se controla después.

Cómo leer las marcas:

- **[probado]**: se corrió de verdad contra una API local el 2026-11-05 (ver la sección 9, con los números reales).
- **[código]**: se verificó leyendo el código de esta rama (`src/modules/migration`, `src/platform/tokko`), sin correrlo.
- **[a confirmar]**: no se pudo verificar; no lo des por hecho.

> **Lo más importante antes de empezar.** Una vez confirmado un lote **no hay botón de deshacer** [código] [probado]. Se puede descartar un lote mientras todavía no se confirmó, pero lo ya importado solo se corrige a mano, y los **contratos no se pueden borrar** (solo rescindir). Por eso: **ensayá primero** en una inmobiliaria de prueba o con el archivo de ejemplo, y pedile a quien administra el servidor una copia de la base de datos antes de la corrida real (sección 8).

---

## 1. Qué se puede migrar y qué no

| Dato                                               |  Desde Excel   |  Desde Tokko   | Observaciones                                                              |
| -------------------------------------------------- | :------------: | :------------: | -------------------------------------------------------------------------- |
| Propietarios (con CBU, alias, banco)               |       Sí       |     **No**     | Tokko solo trae propiedades [código].                                      |
| Inquilinos                                         |       Sí       |     **No**     |                                                                            |
| Garantes                                           |       Sí       |     **No**     | Se enlazan al inquilino por el DNI del garante.                            |
| Propiedades                                        |       Sí       |       Sí       | Tokko trae además tipo, ubicación, amenities, descripción, precio y fotos. |
| Contratos                                          |       Sí       |     **No**     | Vigentes o ya terminados.                                                  |
| Fotos de propiedades                               |     **No**     | Sí (opcional)  | Se descargan a Adminprop; nunca queda un link a Tokko.                     |
| Tipos de propiedad, amenities y ubicaciones nuevos | Se crean solos | Se crean solos | Al confirmar, no antes.                                                    |

### Lo que NO se migra (y qué pasa con eso)

Confirmado en el código [código] y en la prueba [probado]:

| Dato                                                                                       | Qué pasa                                                                                                                                     | Qué hacer hoy                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Saldos / deuda de cada inquilino**                                                       | No se migran. El arranque es limpio: **no se crea ninguna cuota ni ningún pago**. Tras importar contratos hubo 0 cuotas y 0 pagos [probado]. | Cortar en un mes: lo adeudado antes de esa fecha se sigue llevando fuera de Adminprop (el Excel viejo). Ver backlog 1.                                                                         |
| **Historial de pagos y cobros**                                                            | No se migra.                                                                                                                                 | Guardar el sistema viejo como consulta histórica. Ver backlog 2.                                                                                                                               |
| **Aumentos anteriores de un contrato**                                                     | No se migran. El contrato nace con el **alquiler inicial** y el aumento solo se calcula hacia adelante.                                      | Se pueden cargar a mano uno por uno desde el contrato (ver sección 7.4). Ver backlog 3.                                                                                                        |
| **«Día de vencimiento»**                                                                   | **La plantilla no tiene esa columna y el contrato no guarda ese dato** [código]. El modelo no tiene un día de vencimiento por contrato.      | Lo que existe es el **punitorio**: cuántos días de gracia hay y desde qué día corre (por inmobiliaria, con posibilidad de pisarlo por contrato). Se configura en Configuración. Ver backlog 4. |
| **Punitorio de cada contrato**                                                             | La importación no lo carga: cada contrato hereda el de la inmobiliaria [código].                                                             | Configurarlo **antes** de importar contratos vigentes (sección 5.3).                                                                                                                           |
| **Honorarios por contrato**                                                                | No hay columna; se aplica el % estándar del propietario o de la inmobiliaria (5 % por defecto) [probado: los contratos quedaron con 5,00].   | Ajustar a mano los que difieran.                                                                                                                                                               |
| Garantía / seguro de caución, PDFs de contrato, servicios de la propiedad (luz, gas, etc.) | No hay columnas.                                                                                                                             | Cargar a mano.                                                                                                                                                                                 |
| Datos físicos de la propiedad (ambientes, baños, metros, coordenadas)                      | Ni el Excel ni el mapeo de Tokko los traen [código].                                                                                         | Cargar a mano.                                                                                                                                                                                 |
| **Propietarios, inquilinos y contratos que están en Tokko**                                | Esa API no los trae al sistema.                                                                                                              | Hay que pasarlos al Excel (sección 3). Si Tokko permite exportar contactos a planilla: **[a confirmar]**.                                                                                      |

---

## 2. De dónde sale cada dato

### 2.1 Tokko Broker (solo propiedades)

- Se usa la **API de Tokko** con una **API key**. La key **no se escribe en pantalla**: la carga quien administra el servidor como secreto (variable `TOKKO_API_KEY`, en Doppler) [código].
- **Hoy esa key no es la de Oppido.** El script de prueba usa una key pública de demostración; para traer el stock real hace falta **la API key de la cuenta de Oppido** (se pide a Tokko / al administrador de la cuenta de Tokko). Mientras no esté cargada, el análisis de Tokko queda **Fallido** con el mensaje «Falta configurar la API key de Tokko (TOKKO_API_KEY) en el servidor» [probado].
- Además el servidor tiene que estar en modo real (`TOKKO_SOURCE=http`). Por defecto está en `fixture`, que trae una muestra inventada de 6 propiedades [código] [probado].
- **La key es una sola para todo el servidor, no una por inmobiliaria** [código]. Si más adelante hay una segunda inmobiliaria usando Adminprop, no se puede habilitar Tokko para ella sin riesgo de que importe el stock de Oppido (hallazgo A1 de `docs/REVISION_FASE_21.md`).
- **No se pudo probar contra Tokko real**: desde el entorno de prueba no hay salida a `tokkobroker.com` (el proxy bloquea el dominio: `CONNECT tunnel failed, response 403`) y no tengo la key de Oppido. Lo que sí se probó fue: (a) sin key, mensaje correcto; (b) con una key inventada, el servidor intenta conectar y falla con el mensaje «No se pudo conectar con Tokko: probá de nuevo en unos minutos» [probado]; (c) el mapeo de propiedades y toda la importación con la **muestra incluida**, que tiene la forma supuesta de la respuesta de Tokko (`property/search`: `address`, `fake_address`, `type`, `location.full_location`, `operations[].prices`, `tags`, `photos`) [probado]. Si la API real devuelve otra forma, se corrige en un solo archivo (`src/platform/tokko/adapters/tokko-mapper.ts`): **[a confirmar]** con la primera corrida real.
- Qué trae por propiedad [código]: dirección (la real; si falta, la «aproximada» que Tokko publica), tipo, ubicación, amenities (los «tags»), título y descripción juntos como descripción pública, precio y moneda (ARS o USD) de la operación, y las fotos (la portada primero).
- **Solo propiedades con operación de alquiler** por defecto [código]. La pantalla no tiene un selector para cambiar eso: si hiciera falta traer ventas, es un cambio chico (backlog 8).
- Ritmo y límites contra Tokko [código]: páginas de 20, pausa de 0,4 segundos entre páginas, hasta 3 reintentos con espera creciente ante errores 429 o 5xx, y corta si la API repite una página; tope de 2.000 páginas (40.000 propiedades). Para probar con pocas propiedades, la pantalla permite poner una **cantidad máxima**.
- Fotos [código]: hasta 10 MB cada una, solo JPG/PNG/WebP, 15 segundos por foto. Una foto que no se pueda bajar no frena la propiedad; después hay un botón «Reintentar fotos».

### 2.2 Excel con la plantilla

Es el camino para **propietarios, inquilinos, garantes y contratos** (y también para propiedades, si no se usa Tokko).

**Dónde se baja la plantilla:** Configuración → **Migración de datos** → tarjeta «Desde Excel» → botón **Descargar plantilla** (baja `plantilla-migracion-adminprop.xlsx`) [código del frontend] [probado: el endpoint `GET /migration/excel/template` responde el .xlsx]. La plantilla se arma con los datos de **tu** inmobiliaria (los desplegables traen tus tipos de propiedad y tus ubicaciones).

**No uses un Excel propio ni cambies los encabezados.** El archivo tiene una versión escondida: uno armado con otra versión se rechaza con «El archivo se armó con otra versión de la plantilla» [probado]. Si le falta una columna: «A la hoja «Contratos» le falta la columna «Fin»: usá la plantilla sin cambiar los encabezados» [probado]. El **orden** de las columnas no importa, sí el texto del encabezado.

Reglas de la plantilla:

- Fila 1 = encabezados. Fila 2 = un ejemplo en gris que **se ignora** (podés dejarla o borrarla). Tus datos desde la fila 3 [probado].
- No hace falta completar todas las hojas: las vacías se omiten y el lote te avisa cuáles faltaron [probado].
- Las hojas se enlazan por **DNI/CUIT** y por **Código de la propiedad**, nunca por nombres.

#### Hojas y columnas (obligatorias con *)

**Propietarios** — una fila por persona.
`Nombre*`, `Apellido*`, `DNI/CUIT*`, `Teléfono`, `Email`, `Domicilio`, `CBU`, `Alias`, `Banco`, `Titular`, `Notas`.

**Garantes**
`Nombre*`, `Apellido*`, `DNI/CUIT*`, `Teléfono`, `Email`, `Domicilio`, `Tipo de garantía` (`Inmueble` o `Recibos de sueldo`), `Detalle de la garantía`, `Notas`. Sin tipo ni detalle se carga como «Recibos de sueldo — Importado sin detalle: completar» [probado].

**Inquilinos**
`Nombre*`, `Apellido*`, `DNI/CUIT*`, `Teléfono`, `Email`, `Domicilio`, `DNI del garante`, `Notas`.

**Propiedades**
`Código`, `Dirección*`, `Ubicación*`, `Tipo*`, `DNI del propietario`, `Amenities (separados por coma)`, `Precio de publicación`, `Moneda`, `Descripción pública`, `Notas`.
El **Código** (por ejemplo `P-001`) **solo sirve para que la hoja Contratos encuentre la propiedad dentro del mismo archivo**. No se guarda en la propiedad [probado: la tabla de propiedades no tiene columna de código]. Consecuencia: si cargás los contratos **en un archivo posterior**, tenés que repetir la fila de la propiedad (misma dirección y ubicación) en la hoja Propiedades con su código; esa fila sale «Ya importada» y los contratos se enlazan [probado].

**Contratos**
`Código de propiedad*`, `DNI del inquilino*`, `Inicio*`, `Fin*`, `Alquiler inicial*`, `Moneda*`, `Índice de aumento` (`ICL`, `IPC`, `Fijo`, `Otro`), `Frecuencia de aumento` (`Mensual`, `Trimestral`, `Cuatrimestral`, `Semestral`, `Anual`), `% fijo`, `Depósito`, `Moneda del depósito`, `Modalidad de cobro` (`Inmobiliaria` o `Propietario`), `Notas`.

Sin índice de aumento el contrato queda con aumento **manual y anual**; sin modalidad de cobro, **cobra la inmobiliaria**; sin depósito, 0 [código]. Con índice `Fijo` el `% fijo` es obligatorio [código].

#### Formatos

| Dato           | Se acepta                                                                                                                                           | Ejemplos                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fechas**     | `dd/mm/aaaa` (también `d/m/aa`, `dd-mm-aaaa`, `dd.mm.aaaa`, `aaaa-mm-dd`) o una celda de fecha de Excel. Se lee **día/mes** (nunca mes/día).        | `01/03/2025`, `1/3/25`. Una celda de fecha real de Excel se probó [probado]. `31/02/2025` se rechaza [probado].                                                                                                                                                                                    |
| **Montos**     | Con o sin separador de miles, coma o punto decimal, con `$`.                                                                                        | `450000`, `150.000`, `150000,50`, `1234.56`, `$ 1.250.000,50` (se leyó como 1.250.000,50 [probado]).                                                                                                                                                                                               |
| **Moneda**     | `ARS` o `USD` (también «pesos», «dólares», `$`, `U$S`).                                                                                             | `EUR` o cualquier otra se rechaza [probado].                                                                                                                                                                                                                                                       |
| **DNI / CUIT** | De 7 a 11 dígitos; se aceptan puntos, guiones y espacios.                                                                                           | `27123456789`, `20-12345678-9`, `90.000.008` [probado]. Con letras o menos de 7 dígitos se rechaza [probado].                                                                                                                                                                                      |
| **CBU**        | 22 dígitos **con los dos dígitos verificadores correctos** (la misma regla que la carga manual).                                                    | Un dígito mal tipeado → error [probado].                                                                                                                                                                                                                                                           |
| **Ubicación**  | Ruta `Provincia > Ciudad > Barrio` (hasta 3 niveles; el país es opcional). Un nombre suelto solo sirve si existe una sola ubicación con ese nombre. | `Buenos Aires > La Plata > Centro`. Usá los nombres de **tu** lista (en la plantilla, la columna Ubicación tiene el desplegable): por ejemplo, la Ciudad de Buenos Aires figura como provincia «Ciudad Autónoma de Buenos Aires». Poner solo una provincia da error «demasiado general» [probado]. |
| **Amenities**  | Separados por coma o punto y coma.                                                                                                                  | `Balcón, Cochera`                                                                                                                                                                                                                                                                                  |
| **Email**      | Un email válido.                                                                                                                                    | `sofia(arroba)ejemplo.test` se rechaza [probado].                                                                                                                                                                                                                                                  |

#### Archivo de ejemplo para practicar

En `docs/migracion/ejemplo/` están `migracion-ejemplo-ficticio.xlsx` (datos 100 % inventados) y el script `generar-excel-ejemplo.js` que lo genera a partir de la plantilla real. La columna **Notas** de cada fila dice qué se espera que pase. **No lo subas a la inmobiliaria real**: crearía personas y propiedades inventadas.

---

## 3. Orden recomendado de carga

El orden pensado es **propietarios → propiedades → inquilinos → garantes → contratos**. Un detalle técnico: el garante tiene que existir antes que el inquilino que lo nombra, así que por dentro el sistema importa **propietarios → garantes → inquilinos → propiedades → contratos** [código] [probado]. No tenés que ocuparte de eso: **una sola planilla con las cinco hojas se analiza junta** y se importa en el orden correcto. Pero conviene hacerlo **de a etapas** para controlar:

1. **Etapa 1: propietarios y propiedades** (con el DNI del propietario en cada propiedad). Si usás Tokko para las propiedades, hacé el Excel de propietarios y el lote de Tokko (ver la nota de abajo sobre cómo se unen).
2. **Etapa 2: garantes e inquilinos.**
3. **Etapa 3: contratos.** Primero **configurá el punitorio** (sección 5.3). Si es un archivo nuevo, repetí las filas de las propiedades en la hoja Propiedades (se reconocen como «Ya importadas»).

Cada hoja necesita a la anterior: una propiedad con DNI de un propietario que no está en el archivo ni en el sistema da error `OWNER_NOT_FOUND`; un contrato con un inquilino inexistente, `RENTER_NOT_FOUND`; un inquilino con DNI de garante inexistente, `GUARANTOR_NOT_FOUND` [probado].

**Si combinás Tokko y Excel para las propiedades.** Tokko trae las propiedades **sin propietario**. Si después subís por Excel la misma propiedad (misma dirección y ubicación, escrita igual) aparece como **conflicto** con lo ya cargado; con la opción «Completar vacíos» se le asigna el propietario sin pisar nada [código]. Si la dirección está escrita distinto en Tokko y en tu Excel, el sistema **no las reconoce como la misma y quedan duplicadas** [código]. Revisá el reporte.

---

## 4. Checklist para preparar el Excel antes de subirlo

- [ ] Bajaste la plantilla **hoy** desde la pantalla (no una vieja).
- [ ] Probaste todo primero con el archivo de ejemplo o en una inmobiliaria de prueba.
- [ ] Ninguna columna ni encabezado cambiado, ninguna hoja renombrada.
- [ ] Máximo **5.000 filas en total** (sumando todas las hojas) y **10 MB** [probado: 5.000 pasa, 5.001 da `IMPORT_TOO_MANY_ROWS`; un archivo de 11 MB da 413].
- [ ] Todos los DNI/CUIT con 7 a 11 dígitos, sin letras; **un propietario/inquilino/garante por DNI** (sin repetidos).
- [ ] CBU de 22 dígitos copiados del sistema viejo, no tipeados; los que no estén, vacíos (mejor vacío que mal).
- [ ] Fechas en `dd/mm/aaaa`, sin fechas imposibles (31/02).
- [ ] Montos solo con números (sin textos tipo «a convenir»).
- [ ] Moneda `ARS` o `USD` en cada contrato.
- [ ] Ubicaciones escritas como `Provincia > Ciudad > Barrio` con los nombres de tu lista.
- [ ] Cada propiedad con **Código** único, y el **DNI del propietario** completo (una propiedad sin propietario no puede tener un contrato: `PROPERTY_WITHOUT_OWNER` [probado]).
- [ ] Cada contrato apunta a un Código de propiedad **de la misma hoja del archivo** y a un DNI de inquilino que está en el archivo o ya cargado.
- [ ] Un solo contrato **vigente** por propiedad y por inquilino (el segundo da `CONTRACT_OVERLAP` / `RENTER_ALREADY_ACTIVE` [probado]).
- [ ] Punitorio diario configurado en Configuración **antes** de importar contratos vigentes (sección 5.3).
- [ ] Sin columnas de «Notas» con texto de prueba.
- [ ] Anotaste cuántas filas tenés de cada tipo (para comparar después, sección 7).

---

## 5. El flujo en pantalla

Configuración → **Migración de datos** (solo administrador; un empleado recibe 403 [código]). Todo se hace en **dos pasos sobre el mismo lote**: primero se _analiza_ (no se crea nada) y recién después se _confirma_ [probado].

Los pasos que muestra la pantalla: **Origen → Análisis → Revisión → Confirmar → Resultado**.

### 5.1 Subir y analizar

1. **Desde Excel**: elegí el archivo `.xlsx` y tocá **Subir y analizar**. **Desde Tokko**: opcionalmente poné la «Cantidad máxima» (para probar) y si querés traer fotos, y tocá analizar.
2. Aparece una barra de avance. En el análisis **no se crea ninguna propiedad, persona ni contrato** [probado: tablas en 0 tras analizar].
3. Errores que frenan el archivo entero (te lo dice un mensaje y no se crea lote): no es un `.xlsx` válido («no es un Excel (.xlsx) válido o pesa más de 10 MB»), otra versión de plantilla, columna faltante, más de 5.000 filas [probado].
4. Un archivo sin filas genera un lote vacío que no se puede confirmar [probado].

### 5.2 Revisar errores, advertencias y conflictos

El lote muestra contadores por tipo y una lista de filas filtrable. Cada fila queda en uno de estos estados [probado]:

| Estado                                | Qué significa                                                                                                                      | Qué hacer                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Lista** (`VALID`)                   | Se va a importar.                                                                                                                  | Nada.                                                                                                        |
| **Con errores** (`ERROR`)             | Un dato está mal (te dice el campo y qué corregir). **No se importa**.                                                             | Corregir en el Excel y volver a subir (sección 5.5).                                                         |
| **Conflicto** (`CONFLICT`)            | Ya existe en el sistema (mismo DNI/CUIT, misma dirección y ubicación, o el mismo contrato) o está **repetida dentro del archivo**. | Elegir «Saltear» (por defecto) o «Completar vacíos». Una fila repetida dentro del archivo siempre se saltea. |
| **Ya importada** (`ALREADY_IMPORTED`) | Es una fila que ya se importó antes.                                                                                               | Nada: no se duplica.                                                                                         |

Mensajes reales que vas a ver [probado]:

- `INVALID_NATIONAL_ID`: «El DNI/CUIT «ABC123» tiene que tener entre 7 y 11 dígitos».
- `INVALID_CBU`: «El CBU tiene que tener 22 dígitos» / «El CBU no es válido: revisá que no tenga un dígito mal tipeado».
- `INVALID_DATE`: «La fecha de inicio «31/02/2025» no es válida (usá dd/mm/aaaa)».
- `DATES_INVALID`: «La fecha de fin tiene que ser posterior a la de inicio».
- `INVALID_CURRENCY`: «La moneda «EUR» no existe (ARS o USD)».
- `INVALID_EMAIL`, `INVALID_GUARANTEE_TYPE`, `UNKNOWN_LOCATION`, `LOCATION_TOO_GENERAL`, `REQUIRED` (falta un dato obligatorio).
- `OWNER_NOT_FOUND`, `GUARANTOR_NOT_FOUND`, `RENTER_NOT_FOUND`, `PROPERTY_CODE_UNKNOWN`, `RENTER_ROW_INVALID` (el inquilino de ese contrato tiene un error en su propia fila).
- `CONTRACT_OVERLAP`, `PROPERTY_WITHOUT_OWNER`.
- Repetidos dentro del archivo: «Está repetida en el archivo (ya figura en la fila 3)».
- Repetido con algo cargado: «Ya existe un propietario con ese DNI/CUIT: Nora Manual».

Otras opciones de la revisión: **excluir** filas una por una, **Descargar reporte** (`.xlsx` con hoja, fila, campo y mensaje de cada error y conflicto, para corregir y volver a subir [probado]) y **Descartar lote** (cierra sin importar nada y borra el archivo subido).

**Duplicados: qué se considera «el mismo».**

- **Personas** (propietario, inquilino, garante): por **DNI/CUIT** normalizado (solo dígitos). El mismo DNI en dos inmobiliarias distintas no es conflicto [código]. Con un registro existente: «Saltear» no toca nada; «Completar vacíos» llena **solo los campos que están vacíos** y **nunca reemplaza un dato ya cargado** [probado: un propietario cargado a mano con nombre y apellido quedó con su apellido y se le completaron teléfono, email y domicilio].
- **CBU**: se valida que sea correcto, pero **no se busca si otro propietario ya tiene el mismo CBU** [código]; dos propietarios con el mismo CBU se aceptan. Chequealo en tu planilla.
- **Propiedad**: dirección normalizada (sin acentos ni mayúsculas, sin «calle»/«av.») más ubicación: «Av. Santa Fe 1234 3° B» y «avenida santa fe 1234 3 b» son la misma [probado].
- **Contrato**: propiedad + DNI del inquilino + fecha de inicio.

### 5.3 Contratos vigentes y punitorio (leé esto antes de confirmar)

Una inmobiliaria **sin punitorio diario configurado** no puede crear contratos vigentes: cada contrato necesita un punitorio propio o el de la inmobiliaria, y **no hay un valor por defecto** [código].

Lo que pasa hoy [probado]:

1. El análisis marca esos contratos como **Lista** (el análisis **no lo avisa**: backlog 5).
2. Al confirmar, esas filas quedan **Falladas** con `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED`: «Indicá el punitorio diario del contrato o configurá el de la inmobiliaria».
3. El lote termina **Parcial**. El resto de las filas sí se importó.
4. Los contratos **ya terminados** (fecha de fin anterior a hoy) **no** sufren este problema: se importan como «Finalizado».

**Cómo evitarlo:** antes de confirmar, entrá a **Configuración** y cargá el punitorio diario de la inmobiliaria. Si ya te pasó: configuralo y **volvé a subir el mismo archivo**: todo lo ya importado sale «Ya importada» y solo se crean los contratos que habían fallado [probado: con el punitorio en 0,50 se importaron los 2 contratos vigentes y no se duplicó nada].

Otras reglas de contratos [código] [probado]:

- Un contrato terminado se carga como **Finalizado** y no cambia el estado de la propiedad ni del inquilino. Uno vigente deja la propiedad **Alquilada** [probado].
- **No se generan cuotas**: ni pasadas ni futuras. Las cuotas las crea el proceso mensual o el botón «Generar cuotas» en Cobros. Qué meses genera exactamente ese botón en un contrato que empezó hace más de un año: **[a confirmar]**.
- La **garantía** del contrato sale del garante del inquilino (si tiene).

### 5.4 Confirmar

1. **Confirmar importación** abre un cuadro con el resumen («se crearán N propiedades, M propietarios…»). El botón del cuadro es **Importar**.
2. Si hay conflictos, elegís el criterio por defecto (**Saltear** o **Completar vacíos**). En un lote de Tokko hay además una casilla para traer las fotos.
3. El botón no se habilita hasta que el análisis terminó, y la confirmación importa **exactamente lo que revisaste**, sin volver a leer el archivo [probado]. Dos confirmaciones a la vez: una gana y la otra recibe 409 `BATCH_ALREADY_CONFIRMED` [código].
4. Se importa en orden: propietarios → garantes → inquilinos → propiedades → contratos. Una fila que falla queda **Fallida** con el motivo y **no frena a las demás** [probado].

### 5.5 Resultado

- Estado final del lote: **Completado**, o **Parcial** si quedó alguna fila con error o fallida [probado].
- Contadores de importadas / salteadas / fallidas por tipo, y el **reporte** descargable.
- Para corregir lo que no entró: arreglá esas filas en el **mismo Excel** y volvé a subirlo. Lo ya importado se reconoce y se salta; solo se procesa lo nuevo o corregido [probado].
- Un lote «Listo» que nadie confirma en **7 días** se descarta solo [código].
- Todo queda en el **Historial de lotes**; las altas figuran en la auditoría a nombre de quien confirmó [código].

### 5.6 Límites (resumen)

| Límite              | Valor                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamaño del archivo  | 10 MB (más da 413, con el texto en inglés «File too large»; la pantalla ya lo frena antes) [probado]                                                       |
| Filas               | 5.000 en total entre todas las hojas [probado]                                                                                                             |
| Frecuencia          | Subir/analizar, confirmar y reintentar fotos: 10 por minuto por usuario [código]                                                                           |
| Tokko               | Páginas de 20 con pausa de 0,4 s; reintentos ante 429/5xx; tope 40.000 propiedades [código]. Cuántos pedidos tolera la cuenta de Oppido: **[a confirmar]** |
| Fotos               | 10 MB, JPG/PNG/WebP, 15 s cada una [código]                                                                                                                |
| Lotes sin confirmar | Se descartan a los 7 días [código]                                                                                                                         |

---

## 6. Cómo se vio en la prueba real (resumen)

Prueba del 2026-11-05 con el archivo de ejemplo (37 filas): sobre una inmobiliaria nueva y sin punitorio, quedaron **15 listas, 19 con error y 3 repetidas dentro del archivo**. Al confirmar se importaron 13, se saltearon las 3 repetidas y fallaron 2 contratos vigentes por falta de punitorio. El detalle completo está en la sección 9.

---

## 7. Cómo verificar después

### 7.1 Conteos

Comparalos contra tu planilla de origen, tipo por tipo:

| Qué mirar                                      | Dónde                                                                                            | Qué esperar                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contadores del lote                            | Migración de datos → el lote → resumen por tipo (importadas / con errores / saltadas / fallidas) | `importadas + saltadas + con errores + falladas + ya importadas = filas del Excel`. Si no cierra, algo se perdió.                                                                      |
| Cantidad de propietarios, inquilinos, garantes | Listados de Propietarios, Inquilinos, Garantes                                                   | = importadas de cada hoja + lo que ya había.                                                                                                                                           |
| Propiedades                                    | Listado de Propiedades                                                                           | Idem. En un lote de Tokko, filtrá **«A revisar»**: son las que cargó con ubicación comodín «Sin ubicación (revisar)»; al elegirles la ubicación correcta la marca se va sola [código]. |
| Propiedades sin propietario                    | Listado de Propiedades                                                                           | Las de Tokko vienen sin propietario: hay que asignarlo.                                                                                                                                |
| Contratos                                      | Listado de Contratos                                                                             | Vigentes y finalizados contra tu planilla. Cada propiedad con contrato vigente debe figurar **Alquilada** [probado].                                                                   |
| Reporte del lote                               | Botón «Descargar reporte»                                                                        | Lista de todo lo que falló, con fila y motivo.                                                                                                                                         |
| Auditoría                                      | Configuración → Auditoría                                                                        | Las altas aparecen a nombre de quien confirmó [código].                                                                                                                                |

### 7.2 Comparar contra el sistema viejo

1. Contá filas de cada tipo en el Excel / Tokko **antes** de subir.
2. Después de importar, hacé una **muestra de 10 a 20 registros**: abrí el contrato en Adminprop y comparalo con el original (fechas, alquiler inicial, moneda, depósito, propietario, inquilino).
3. Revisá los **datos que la migración no trae** (sección 1): saldos, aumentos ya aplicados (el alquiler vigente va a ser el inicial), punitorio y honorarios.
4. Si algo no coincide, corregilo en el Excel y volvé a subir (idempotente); o a mano en el backoffice.

### 7.3 Después de importar contratos

- Revisá el **alquiler vigente** de cada contrato que empezó hace tiempo: quedó en el **alquiler inicial**, sin los aumentos previos.
- Generá las cuotas desde Cobros (manual) o esperá el proceso mensual.

### 7.4 Cargar un aumento anterior a mano

Desde el contrato (o `POST /contracts/:id/rent-updates`) se puede aplicar un ajuste manual con motivo y quién lo autorizó. En la prueba funcionó (201), pero aplica **un solo aumento por vez, con la fecha del próximo aumento que corresponde** (en el ejemplo, de un contrato que empezó el 01/03/2025 trimestral, quedó vigente desde el 01/06/2025), así que para ponerse al día hay que repetirlo período por período [probado]. Si el proceso automático «se pone al día» solo con los períodos vencidos: **[a confirmar]**.

---

## 8. Cómo revertir

**No hay "deshacer lote"** [código] [probado]: la pantalla solo ofrece **Descartar lote** y solo vale **antes** de confirmar («Se cierra sin importar nada y se borra el archivo subido. No se puede deshacer»).

Después de confirmar, lo que se puede hacer [probado]:

| Qué                                             | Se puede      | Cómo                                                                                                                                                                                     |
| ----------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corregir un dato                                | Sí            | Editar en el backoffice.                                                                                                                                                                 |
| Borrar un garante sin inquilinos                | Sí            | Desde el listado. **Ojo**: borrado, el sistema se acuerda de que «ya lo importó»: si volvés a subir el archivo, esa fila sale **«Ya importada»** y **no se vuelve a crear** (backlog 6). |
| Borrar un propietario con propiedades           | **No**        | 409 `OWNER_HAS_PROPERTIES`: «Reasignalas primero».                                                                                                                                       |
| Borrar un inquilino con contrato vigente        | **No**        | 409 `RENTER_HAS_ACTIVE_CONTRACT`.                                                                                                                                                        |
| Borrar una propiedad con historial de contratos | **No**        | 409 `PROPERTY_HAS_CONTRACT_HISTORY`: «Pasala a mantenimiento».                                                                                                                           |
| Borrar un contrato                              | **No existe** | Solo se puede **rescindir**.                                                                                                                                                             |

Entonces, la forma segura de poder volver atrás es **prevenir**:

1. **Ensayo** en una inmobiliaria de prueba o en una base de demo con el mismo Excel.
2. **Copia de la base de datos** (backup/snapshot) justo antes de la corrida real: es lo único que realmente deshace todo. Cómo se hace depende del hosting y **todavía no está definido** (el despliegue es la Fase 16): **[a confirmar]** con quien administra el servidor. Hay que restaurar la copia **completa** (no se puede borrar solo el lote).
3. Importar **de a etapas** y verificar cada una antes de seguir.
4. Empezar con una **muestra** (por ejemplo, 20 propiedades de Tokko con «Cantidad máxima», o un Excel de 20 filas) antes de la carga completa.

---

## 9. Qué se probó de verdad (2026-11-05)

Entorno: API local (build de esta rama), Postgres local en una base propia, variables descartables, sin Doppler, una inmobiliaria nueva «Inmobiliaria Prueba» con un administrador. Datos 100 % ficticios.

| Prueba                                                                                                      | Resultado real                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descargar la plantilla (`GET /migration/excel/template`)                                                    | 200, `.xlsx` con hojas Instrucciones, Propietarios, Garantes, Inquilinos, Propiedades, Contratos, más Listas (oculta) y Meta (muy oculta, versión 1)                                                                                                                                                                              |
| Análisis (en seco) del archivo de ejemplo: 37 filas                                                         | Lote Listo: 15 listas, 19 con error, 3 conflictos (repetidas en el archivo). Cada error con el código y mensaje esperados (sección 5.2). **Tablas de propietarios, inquilinos, garantes, propiedades y contratos: 0 filas** después del análisis; solo se habían creado las 3 ubicaciones base                                    |
| Confirmar (`SKIP`), sin punitorio configurado                                                               | Lote **Parcial**: 13 importadas, 3 salteadas, 2 falladas (los 2 contratos vigentes, `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED`), 19 con error omitidas. Quedó: 3 propietarios, 3 inquilinos, 2 garantes, 4 propiedades, 1 contrato (Finalizado), 0 cuotas. Se crearon al confirmar: ubicaciones La Plata y Centro y el tipo «Galpón» |
| Idempotencia: subir **el mismo archivo otra vez**                                                           | 13 filas «Ya importada», 0 duplicados; solo los 2 contratos fallados vuelven como «Lista»                                                                                                                                                                                                                                         |
| Configurar punitorio 0,50 y confirmar el segundo lote                                                       | 2 contratos vigentes importados (ICL trimestral de 450.000 y Fijo anual 10 % de 200.000); propiedades pasan a **Alquilada**; 0 cuotas, 0 pagos; honorarios 5,00                                                                                                                                                                   |
| Contratos en un archivo posterior (repitiendo la propiedad en la hoja Propiedades con su código)            | Propiedad «Ya importada» y contrato importado. Un código que no está en la hoja: `PROPERTY_CODE_UNKNOWN`                                                                                                                                                                                                                          |
| Conflicto con un propietario cargado a mano, `Completar vacíos`                                             | Se llenaron teléfono, email y domicilio; el apellido cargado a mano **no cambió**                                                                                                                                                                                                                                                 |
| Archivo que no es Excel                                                                                     | 422 `INVALID_XLSX`                                                                                                                                                                                                                                                                                                                |
| Plantilla con otra versión                                                                                  | 422 `TEMPLATE_VERSION_MISMATCH`                                                                                                                                                                                                                                                                                                   |
| Hoja sin una columna                                                                                        | 422 `INVALID_XLSX` («le falta la columna «Fin»»)                                                                                                                                                                                                                                                                                  |
| Hoja Contratos borrada                                                                                      | Lote Listo con `missingSheets: ["Contratos"]`                                                                                                                                                                                                                                                                                     |
| 5.000 filas / 5.001 filas                                                                                   | Pasa / 422 `IMPORT_TOO_MANY_ROWS`                                                                                                                                                                                                                                                                                                 |
| Archivo de 11 MB                                                                                            | 413 `PAYLOAD_TOO_LARGE` («File too large»)                                                                                                                                                                                                                                                                                        |
| Reporte `.xlsx`                                                                                             | 200; hoja «Errores y conflictos» con hoja, fila, identificación, estado, campo, código y mensaje                                                                                                                                                                                                                                  |
| Descartar lote Listo                                                                                        | 200, estado Descartado                                                                                                                                                                                                                                                                                                            |
| Borrar garante importado y volver a subir                                                                   | La fila sale «Ya importada» aunque ya no exista (backlog 6)                                                                                                                                                                                                                                                                       |
| Borrar propietario / propiedad / inquilino con contratos                                                    | 409 en los tres                                                                                                                                                                                                                                                                                                                   |
| Aumento manual en un contrato importado                                                                     | 201; una sola vigencia (01/06/2025)                                                                                                                                                                                                                                                                                               |
| **Tokko con la muestra incluida (`TOKKO_SOURCE=fixture`)**                                                  | 5 propiedades de alquiler (la 6.ª es de venta y se omitió): 5 importadas; 1 con ubicación comodín «Sin ubicación (revisar)» y «A revisar»                                                                                                                                                                                         |
| **Tokko real (`TOKKO_SOURCE=http`)**                                                                        | **No se pudo probar**: sin salida a tokkobroker.com y sin la key de Oppido. Sin key → «Falta configurar la API key de Tokko…»; con key inventada → «No se pudo conectar con Tokko…»                                                                                                                                               |
| Tests automáticos del módulo y del adaptador de Tokko (`npx jest src/modules/migration src/platform/tokko`) | 9 suites, 99 tests, todos verdes                                                                                                                                                                                                                                                                                                  |

Lo que **no** se probó: Tokko real; la descarga de fotos (la muestra incluida usa un descargador de mentira y el lote se importó con fotos apagadas); la pantalla del frontend (se leyó su código, no se corrió); el comportamiento del botón «Generar cuotas» sobre contratos viejos; el backup/restore.

### Cómo repetir la prueba

```bash
# Con la API levantada (docs/ARRANQUE_LOCAL_BACKEND.md) y un token de administrador:
curl -s -o plantilla.xlsx -H "authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/migration/excel/template
node docs/migracion/ejemplo/generar-excel-ejemplo.js plantilla.xlsx ejemplo.xlsx
curl -s -X POST http://localhost:3000/api/v1/migration/excel/analyze \
  -H "authorization: Bearer $TOKEN" -F "file=@ejemplo.xlsx"        # 202 {batchId, jobId}
curl -s http://localhost:3000/api/v1/migration/batches/$BATCH_ID    # estado y contadores
curl -s "http://localhost:3000/api/v1/migration/batches/$BATCH_ID/rows?limit=100"
curl -s -X POST http://localhost:3000/api/v1/migration/batches/$BATCH_ID/confirm \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"defaultConflictResolution":"SKIP"}'                        # 202; el campo es obligatorio
# Tokko: POST /migration/tokko/analyze  con {"includeAssets": false}  (el campo es obligatorio)
```

---

## 10. Backlog: huecos del ETL (sin implementar)

Esfuerzo: **S** = horas / un día, **M** = unos días, **L** = una semana o más o con decisión de producto. Ordenado por importancia para la migración de Oppido.

| #   | Hueco                                                                                                                                                                                                                                                                                                   |         Esfuerzo          | Cómo cerrarlo                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Saldos iniciales por contrato** (lo que el inquilino debe al día del corte)                                                                                                                                                                                                                           |             M             | Columnas «Saldo inicial» y «Período del saldo» en Contratos que creen un cargo de apertura (`InstallmentCharge`) en el primer período. El rediseño ya lo anticipa (A-74). Necesita que Micaela confirme cómo se liquida ese saldo al propietario.                                                                                                                                  |
| 2   | **Historial de pagos y cobros**                                                                                                                                                                                                                                                                         |             L             | Hoja «Pagos» (contrato, período, importe, fecha, medio) que cree pagos conciliados y cuotas cerradas; toca cobros y liquidaciones. Alternativa barata: conservar el sistema viejo como consulta y migrar desde un mes de corte.                                                                                                                                                    |
| 3   | **Aumentos previos** (el alquiler vigente hoy)                                                                                                                                                                                                                                                          |             M             | Hoja «Aumentos» (contrato, vigente desde, nuevo alquiler) que cree filas del historial del contrato (`ContractRentUpdate`, origen manual/importado), o columnas «Alquiler actual» y «Vigente desde». Hoy solo hay carga manual de un aumento por vez.                                                                                                                              |
| 4   | **Día de vencimiento / punitorio / gracia / honorarios por contrato**                                                                                                                                                                                                                                   |             S             | Columnas «Punitorio diario %», «Día de inicio del punitorio» (o días de gracia), «Honorarios %». Ya existen en el alta de contratos (`billing.lateFeePercentage`, `lateFeeGraceDays`, `lateFeeStartDay`); el importador hoy manda `null` (hereda). Un «día de vencimiento» como tal no existe en el modelo: hay que decidir si el dato de Oppido es «día de inicio del punitorio». |
| 5   | **El análisis no avisa que un contrato vigente va a fallar por falta de punitorio**                                                                                                                                                                                                                     |             S             | En el análisis, si el contrato es vigente y la inmobiliaria no tiene punitorio, marcar la fila con `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED` y un aviso arriba del lote («configurá el punitorio antes de confirmar»). Hoy la fila es «Lista» y falla recién al confirmar.                                                                                                           |
| 6   | **Algo borrado a mano después de importarlo no se puede volver a importar**                                                                                                                                                                                                                             |            S/M            | Al reconocer un vínculo, verificar que la entidad destino siga existiendo (por la facade); si no, tratar la fila como nueva y actualizar el vínculo.                                                                                                                                                                                                                               |
| 7   | **No hay «deshacer lote»**                                                                                                                                                                                                                                                                              |             L             | Registrar qué creó cada lote y permitir revertirlo solo si nada depende de eso (sin contratos ni cobros); los contratos hoy no se pueden borrar. Alternativa operativa: ensayo + backup (sección 8).                                                                                                                                                                               |
| 8   | **Tokko**: (a) solo propiedades: no trae propietarios, inquilinos ni contratos; (b) key única global, no por inmobiliaria; (c) la pantalla no deja elegir operaciones (alquiler/venta); (d) dos propiedades con la misma dirección «aproximada» se saltean en silencio (la segunda queda como repetida) | (a) L (b) M (c) S (d) S/M | (a) evaluar qué expone la API real de Tokko, **[a confirmar]**; (b) guardar la credencial cifrada por inmobiliaria (cambia el schema; hallazgo A1 de la revisión); (c) agregar el selector (el backend ya acepta `operationTypes`); (d) usar el id de Tokko como clave de la propiedad (hallazgo B12).                                                                             |
| 9   | **El «Código» de la propiedad no se guarda**; los contratos de un archivo posterior exigen repetir la propiedad                                                                                                                                                                                         |            S/M            | Guardar el código como referencia externa de la propiedad (o permitir identificar la propiedad por dirección + ubicación en la hoja Contratos).                                                                                                                                                                                                                                    |
| 10  | **Datos que no tienen columna**: datos físicos de la propiedad (ambientes, baños, m², coordenadas), fotos desde Excel, seguro de caución, PDFs de contrato, servicios de la propiedad                                                                                                                   |  S cada uno (M los PDFs)  | Sumar columnas a la plantilla (subiendo la versión) y mapear los campos que Tokko ya manda.                                                                                                                                                                                                                                                                                        |
| 11  | **CBU repetido entre propietarios no se detecta**                                                                                                                                                                                                                                                       |             S             | Marcar como advertencia/conflicto un CBU que ya figura en otro propietario.                                                                                                                                                                                                                                                                                                        |
| 12  | **Mensaje 413 en inglés** («File too large»)                                                                                                                                                                                                                                                            |             S             | Traducir el mensaje del límite de multer en el filtro de errores.                                                                                                                                                                                                                                                                                                                  |
| 13  | **Pendientes de la revisión de código** (`docs/REVISION_FASE_21.md`): re-chequear lo cargado a mano al confirmar (P2), lotes trabados sin salida (P3), reclamo de la corrida (P4), auditar las decisiones por fila (P5), purga de datos personales en el staging (P7), tope de lotes simultáneos (P8)   |      S a M cada uno       | Ver la revisión; ninguno bloquea una migración supervisada.                                                                                                                                                                                                                                                                                                                        |

### Cómo reproducir los hallazgos

- **Hueco 5** (el análisis no avisa): inmobiliaria nueva sin punitorio → subir un Excel con un contrato cuya fecha de fin sea posterior a hoy → el análisis lo muestra como «Lista» → confirmar → la fila queda «Fallida» con `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED`.
- **Hueco 6** (borrado + reimportación): importar un garante → `DELETE /guarantors/:id` → analizar el mismo archivo → la fila del garante sale «Ya importada» y nunca se recrea.
- **Hueco 9** (código): analizar un archivo cuyo contrato tenga `P-777` y cuya hoja Propiedades no lo incluya, aunque la propiedad ya exista en el sistema → `PROPERTY_CODE_UNKNOWN`.
- **Hueco 12**: subir un archivo de más de 10 MB → 413 con texto en inglés.
- **Descubrimientos de contrato de la API** (no son errores, pero sorprenden a quien use `curl`): `POST .../confirm` exige `defaultConflictResolution`; `POST /migration/tokko/analyze` exige `includeAssets`.

No se cambió código de producción en esta tarea: no apareció ningún bug trivial y seguro de arreglar aislado.
