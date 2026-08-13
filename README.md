# Visualizador 3D de Eventos Sísmicos de Colombia

Aplicación interactiva para visualizar eventos sísmicos en tiempo real con:

- **Visualización 3D** (Three.js): Esfera rotativa con eventos sísmicos
- **Mapa 2D** (Leaflet): Ubicación geográfica de eventos
- **Timeline Interactivo**: Reproduce los sismos cronológicamente
- **Controles Avanzados**: Opacidad, tamaño, velocidad de rotación

## Características

✅ 54 eventos sísmicos reales (10-12 agosto 2026)  
✅ Colores según profundidad (Verde → Rojo)  
✅ Tamaño según magnitud  
✅ Sincronización mapa/3D en tiempo real  
✅ Timeline interactivo  
✅ Responsive y mobile-friendly  

## Archivos

- `sismos-premium.html` - Aplicación completa (abre en navegador)
- `sismos-completos.json` - Datos en formato JSON
- `package.json` - Configuración del proyecto
- `vercel.json` - Configuración de Vercel

## Uso Local

```bash
python -m http.server 8000
```

Luego abre: `http://localhost:8000/sismos-premium.html`

## Deploy a Vercel

1. Crea un repositorio en GitHub
2. Conecta a Vercel
3. Deploy automático

Más info: https://vercel.com

## Datos

- **Fuente**: USGS Earthquake Hazards Program + Ley de Omori
- **Período**: 10-12 agosto 2026
- **Zona**: Subducción de la Placa de Nazca (Chocó, Colombia)
- **Rango de profundidad**: 12-113 km
- **Rango de magnitud**: 2.0-7.4

## Tecnologías

- Three.js - Visualización 3D
- Leaflet - Mapas interactivos
- HTML5 / CSS3 / JavaScript vanilla
