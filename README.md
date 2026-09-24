# Cubo 3D de Sismicidad de Colombia

Visualizador 3D interactivo de sismicidad en Colombia, con datos reales del Servicio Geológico Colombiano (SGC) y el USGS. Permite explorar la geometría de la placa de Nazca en subducción, comparar distintas bases de datos históricas, e importar y visualizar cualquier catálogo sísmico propio en formato GeoJSON.

**Demo en vivo:** https://sismos-3d-colombia.vercel.app/cubo-v2.html
**Explorador por área:** https://sismos-3d-colombia.vercel.app/explorador-area.html

## Qué muestra

El cubo representa una ventana geográfica fija sobre Colombia (0°–13°N, -80° a -70°). La cara superior proyecta un mapa real; el interior del cubo distribuye cada sismo por latitud, longitud y profundidad, con:

- **Color según profundidad** — enjambre superficial (verde→amarillo→naranja→rojo, 0–90+ km); capas históricas USGS en escala azul→negro→blanco (0–160+ km), pensada para revelar el plano inclinado de la placa en subducción.
- **Tamaño según magnitud**.

## Capas de datos

- **Enjambre de Chocó** (ago 2026) — 103 sismos reales descargados del catálogo del SGC.
- **Subducción Nazca** (USGS, 1960–2026) — 4,983 sismos históricos, profundidad 0–436 km, enfocados en la zona de subducción del Pacífico.
- **Histórico completo Colombia** (USGS, 1900–2026) — 5,786 sismos, magnitud ≥2.5, profundidad 0–220 km, cobertura de todo el país.
- **Importación de GeoJSON propio** — cualquier catálogo sísmico del usuario (SGC, USGS o similar) se suma a la visualización, se integra al timeline y al perfil de profundidad.

Solo una de las dos bases de datos históricas se muestra a la vez (selector desplegable); el enjambre de Chocó y los datos importados son independientes y pueden combinarse.

## Mapas base (cara superior del cubo)

- **Calles** (OpenStreetMap)
- **Satélite** (Esri World Imagery)
- **Mapa Geológico de Colombia 2023** (Servicio Geológico Colombiano, vía su servicio ArcGIS)

## Otras funciones

- **Timeline cronológico** con reproducción automática, respetando la fecha/hora real de cada sismo.
- **Perfil de profundidad**: se eligen dos puntos sobre el mapa y se genera un corte 2D (distancia vs. profundidad) con los sismos proyectados, usando los mismos colores/tamaños del cubo 3D.
- **Brújula N/S/E/O** fija geográficamente, visible desde cualquier ángulo de cámara.
- **Panel de controles** con capas independientes (mapa, enjambre, capa histórica, cuadrícula de profundidad), cada una con su propio control de opacidad y tamaño.
- Cámara orbital libre (arrastrar para rotar, rueda para zoom, clic derecho para desplazar) y panel lateral redimensionable.

## Archivos

- `explorador-area.html` — explorador por área: se dibuja un bbox en el mapa y consulta en vivo el catálogo de EMSC (con respaldo automático a USGS), reproyecta la escena 3D al área pedida y exporta GeoJSON
- `cubo-v2.html` — versión 2 del visor (demo en vivo): misma base de datos, revisión de la experiencia de uso y de las gráficas, con pestaña de análisis sismológico
- `index.html` — redirige a `explorador-area.html` (vista por defecto)
- `subduccion-puntos.json` — dataset USGS 1960–2026 (subducción Nazca), formato compacto `[lon, lat, depth, mag]`
- `historico-1900-puntos.json` — dataset USGS 1900–2026 (Colombia completa), mismo formato
- `swtectonics-logo.png` — branding
- `eventos/libreria.json` — biblioteca de eventos especiales: una ficha por evento (contexto regional, consulta de la secuencia, estilo, id de USGS y tensor de respaldo)
- `eventos/<id>.json` — instantánea congelada de cada ficha: es lo que carga la página por defecto
- `tools/snapshot-eventos.mjs` — regenera esas instantáneas desde USGS
- `.github/workflows/pages.yml` — despliegue automático a GitHub Pages en cada push a `main`

## Uso local

```bash
python -m http.server 8000
```

Luego abre `http://localhost:8000/explorador-area.html`

## Eventos especiales

La pestaña **Special Event** carga eventos con nombre propio desde `eventos/libreria.json`.
Cada ficha trae el contexto regional (capa de fondo), la consulta de su secuencia (capa de
evento), su estilo y el id del evento en USGS, de donde sale el tensor.

Los datos se cargan desde la **instantánea** del repo, no en vivo: USGS revisa magnitudes y
agrega réplicas, así que la consulta en vivo no devuelve lo mismo con el tiempo y una figura
hecha con ella no sería reproducible. El botón *Update from catalog* del panel vuelve a
consultar en vivo y dice cuánto cambió frente a la instantánea.

Para agregar un evento basta su id en USGS:

```bash
node tools/snapshot-eventos.mjs --add us6000tjl2
```

Eso lee el feed de detalle del evento (`.../feed/v1.0/detail/<id>.geojson`), deriva la ficha
—área y ventana de tiempo salen de la magnitud, ver `tools/derivar-ficha.mjs`—, la agrega a
`eventos/libreria.json` y deja la instantánea en `eventos/<id>.json`. Ambos se commitean.

Lo derivado es un punto de partida, no la zona de réplicas real de ese sismo: si la caja o el
rango no te sirven, edítalos en la ficha y regenera:

```bash
node tools/snapshot-eventos.mjs            # todas las fichas
node tools/snapshot-eventos.mjs <id>       # solo una
```

Si la instantánea llega al tope de `limite`, queda marcada como truncada y la página lo avisa;
en zonas muy activas conviene subir la magnitud mínima del contexto en vez del límite.

Sin tocar el repo, el panel también tiene un campo **Or load any USGS event by id**: carga
cualquier evento en vivo con la misma regla, sin guardarlo.

### Eventos significativos por año

El panel replica el catálogo *Browse significant earthquakes* de USGS: se elige un año (1900
hasta hoy, el mismo rango de su página) y **se consulta el catálogo en vivo**, con el mismo
criterio, `sig > 600`. `sig` combina magnitud, reportes de sentido y nivel de alerta PAGER, así
que no es un umbral de magnitud: en 2011 el primero de la lista es un M4.0 en Ohio.

La lista sale en orden cronológico inverso, como la de USGS, y marca cuáles eventos tienen
mecanismo focal. Al elegir uno se lee su feed de detalle y se carga con la sismicidad
alrededor.

Si USGS no responde, se cae a una instantánea guardada en el repo y lo advierte. Esa
instantánea es el catálogo completo (9292 eventos desde 1615, partido por décadas en
`eventos/significativos/`) y se regenera con

```bash
node tools/snapshot-eventos.mjs --indice [--desde-anio 1600] [--minsig 600]
```

### Ventanas de catálogo

Una ficha también puede ser un trozo de catálogo en vez de un sismo con nombre: todos los
eventos de un rango de fechas, con los mecanismos focales de los que tengan tensor publicado.

```bash
node tools/snapshot-eventos.mjs --ventana --desde 2026-01-01 --hasta 2026-01-31 --mag 5      --nombre "Global M5+ January 2026"
```

Sin `--bbox n,s,o,e` es mundial. `--sin-tensores` omite los mecanismos y `--tope-tensores N`
limita cuántos se bajan (uno por evento, así que son N peticiones al generar, no al usarlo).

En una ventana la capa de fondo es la ventana entera y la capa de evento especial queda libre
para cargar encima una secuencia con la consulta manual. El botón *Update from catalog*
re-consulta los eventos, pero los mecanismos siguen siendo los de la instantánea: bajarlos
desde el navegador serían decenas de peticiones.

## Catálogo del SGC en vivo

La fuente **SGC · RSNC (2018 → hoy)** consulta el catálogo de la Red Sismológica Nacional de
Colombia, el mismo de la página de consulta experta del SGC. Ese catálogo no tiene API: es un
formulario que hace POST, guarda el resultado del lado del servidor y devuelve un id con el
que se pide un KML. Su servidor tampoco manda CORS, así que la extracción la hace
`api/proxy-sgc.js`, que encadena los tres pasos y devuelve filas compactas: la consulta de la
secuencia del Chocó son 29 KB de JSON en vez de 111 KB de XML.

El área y las fechas salen de la ventana del visor, igual que con las demás fuentes. Dos
detalles que costó descubrir y conviene no volver a pisar: las fechas van en `dd/mm/aaaa`
(cualquier otro formato hace que el sitio conteste con un error de MySQL y cero registros) y
el modo de área es `ubi=cuadrante`.

Su servidor es lento con ventanas grandes —diez días en Chocó tardan 0,4 s, un año de Colombia
entera unos 19 s y el catálogo completo pasa de dos minutos—, así que el proxy corta a los 50 s
y explica cómo acotar. Para lo anterior a marzo de 2018 está la fuente *SGC Historical*, que
llega hasta finales de 2020.

## Verificación de la geometría de la placa

Dos scripts comprueban, ejecutando el código publicado, lo que es fácil romper sin notarlo
al tocar `volumenSlab2` en `explorador-area.html`:

```bash
node tools/verificar-espesor.mjs   # el espesor se mide perpendicular a la superficie
node tools/verificar-slab.mjs      # la superficie cubre la placa, sin salir a fragmentos
```

El primero arma una placa sintética de buzamiento conocido y mide el vector techo→piso: debe
dar el espesor pedido (no espesor/cos(buzamiento)) y formar 90° con la superficie. El segundo
baja contornos reales de cuatro zonas de subducción y compara los nodos generados con las
celdas que geométricamente están dentro de la placa.

## Despliegue

El sitio se publica automáticamente en **Vercel** con cada push a `main`: https://sismos-3d-colombia.vercel.app — es público, no pide cuenta ni login.

También existe el flujo `.github/workflows/pages.yml`, que publica en GitHub Pages. Quedó fuera de servicio cuando el repositorio pasó a privado (Pages desde un repo privado exige plan de pago) y hay que **volver a activarlo a mano** en Settings → Pages, porque recuperar la visibilidad pública no lo reactiva solo.

## Fuentes de datos

- Catálogo sísmico del SGC (`archive.sgc.gov.co`) — enjambre de Chocó.
- USGS Earthquake Hazards Program (`earthquake.usgs.gov/fdsnws/event/1/query`) — ambas bases históricas.
- Mapa Geológico de Colombia 2023 — SGC, servicio ArcGIS (`srvags.sgc.gov.co`).
- OpenStreetMap / Esri World Imagery — mapas base.

## Tecnologías

- Three.js (r140) — escena y renderizado 3D, `InstancedMesh` para renderizar miles de sismos históricos de forma eficiente.
- HTML5 Canvas — mosaico de teselas de mapa y gráfico de perfil de profundidad.
- JavaScript vanilla — sin frameworks ni build step.

---

Creado por SWTectonics · Jose Fernando Duque T.
