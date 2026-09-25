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
- `api/proxy-sgc.js` — proxy serverless (Vercel) al catálogo actual de la Red Sismológica Nacional del SGC (`apicatalogador.sgc.gov.co`, 1993–hoy). Esa API solo acepta peticiones con Origin de sgc.gov.co, por eso no se llama desde el navegador; el proxy pagina de a 500 eventos (tope 10,000 por consulta) y recorta el modo círculo
- `api/proxy-isc.js` — proxy serverless al Boletín ISC (sin CORS)
- `cubo-v2.html` — versión 2 del visor (demo en vivo): misma base de datos, revisión de la experiencia de uso y de las gráficas, con pestaña de análisis sismológico
- `index.html` — redirige a `explorador-area.html` (vista por defecto)
- `subduccion-puntos.json` — dataset USGS 1960–2026 (subducción Nazca), formato compacto `[lon, lat, depth, mag]`
- `historico-1900-puntos.json` — dataset USGS 1900–2026 (Colombia completa), mismo formato
- `swtectonics-logo.png` — branding
- `eventos/libreria.json` — biblioteca de eventos especiales: una ficha por evento (contexto regional, consulta de la secuencia, estilo, id de USGS y tensor de respaldo)
- `eventos/<id>.json` — instantánea congelada de cada ficha: es lo que carga la página por defecto
- `tools/snapshot-eventos.mjs` — regenera esas instantáneas desde USGS

## Uso local

```bash
python -m http.server 8000
```

Luego abre `http://localhost:8000/explorador-area.html`

Las fuentes que pasan por proxy (SGC RSNC e ISC) necesitan las funciones de `api/`, que `python -m http.server` no ejecuta: para probarlas en local usa `vercel dev`.

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

## Publicar eventos en la biblioteca compartida

El panel permite guardar la búsqueda que está en pantalla como evento especial. *Save in this
browser* la deja en el navegador de quien la hace; **Publish** la mete en la biblioteca que ve
todo el mundo, y de eso se encarga `api/guardar-evento.js` commiteando al repo.

La clave se compara **en el servidor**, contra una variable de entorno. No está en la página:
una clave comparada en el navegador no protege nada, porque el código se descarga con ella.

Para habilitarlo hay que poner dos variables en el proyecto de Vercel:

| Variable | Qué es |
|---|---|
| `CLAVE_EVENTOS` | La frase que autoriza a publicar. Larga y aleatoria, no un número corto. |
| `GITHUB_TOKEN` | Un *fine-grained token* con acceso **solo a este repo** y permiso *Contents: write*. |

Sin ellas el endpoint responde que no está configurado y no escribe nada; el resto del visor
funciona igual.

Defensas, porque el endpoint es público: comparación en tiempo constante, espera fija en cada
intento, límite de intentos por IP, topes de tamaño (3 MB por instantánea, 20 000 eventos),
validación del id y limpieza del HTML en los textos de la ficha. Además la página escapa
nombres y resúmenes al mostrarlos, porque la biblioteca ya no la alimenta una sola persona.

Lo que se publique queda público en el repo.

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

**Vercel es el único despliegue, y conviene que siga así.** Hubo un flujo que publicaba en GitHub Pages; se borró. Pages sirve archivos estáticos y nada más, así que esa copia salía rota por construcción: sin las funciones de `api/` no hay catálogo del SGC, ni ISC, ni publicar eventos. Un segundo sitio que parece el mismo pero falla a medias confunde más de lo que ayuda.

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
