# Cubo 3D de Sismicidad de Colombia

Visualizador 3D interactivo de sismicidad en Colombia, con datos reales del Servicio Geológico Colombiano (SGC) y el USGS. Permite explorar la geometría de la placa de Nazca en subducción, comparar distintas bases de datos históricas, e importar y visualizar cualquier catálogo sísmico propio en formato GeoJSON.

**Demo en vivo:** https://jduquetr.github.io/sismos-3d-colombia/cubo-v2.html

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

- `cubo-v2.html` — versión 2 del visor (demo en vivo): misma base de datos, revisión de la experiencia de uso y de las gráficas, con pestaña de análisis sismológico
- `sismos-cube.html` — versión original completa (`index.html` redirige aquí)
- `subduccion-puntos.json` — dataset USGS 1960–2026 (subducción Nazca), formato compacto `[lon, lat, depth, mag]`
- `historico-1900-puntos.json` — dataset USGS 1900–2026 (Colombia completa), mismo formato
- `swtectonics-logo.png` — branding
- `.github/workflows/pages.yml` — despliegue automático a GitHub Pages en cada push a `main`

## Uso local

```bash
python -m http.server 8000
```

Luego abre `http://localhost:8000/sismos-cube.html`

## Despliegue

El sitio se publica automáticamente en **GitHub Pages** mediante GitHub Actions con cada push a `main` (ver `.github/workflows/pages.yml`). No requiere cuenta ni login para verlo — es una página pública normal.

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
