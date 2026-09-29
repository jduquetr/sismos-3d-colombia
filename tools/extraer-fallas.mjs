#!/usr/bin/env node
// Genera fallas-colombia.json: las fallas activas de Colombia y alrededores,
// recortadas de GEM Global Active Faults (Styron & Pagani, 2020).
//
// Por qué un recorte y no el archivo completo: el GeoJSON mundial pesa ~12 MB
// y el visor solo necesita el norte de los Andes. Se fija el commit de GEM para
// que el recorte sea reproducible y citable.
//
// Catálogos que se conservan (los que tienen nombres de falla):
//   - Active Tectonics of the Andes (Veloza et al., 2012): para Colombia se
//     apoya en la base de fallas cuaternarias de Paris et al. (2000, USGS
//     OFR 00-0284), que aparece en su campo reference.
//   - SARA (South America Risk Assessment): nombre y tasa de deslizamiento.
//   - GEM Central America–Caribbean.
// Se descarta Bird (2003): son límites de placa, sin nombre.
//
// Licencia de los datos: CC BY-SA 4.0 — el recorte hereda esa licencia.
//
// Uso: node tools/extraer-fallas.mjs      (escribe fallas-colombia.json; commitealo)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_GEM = '56816508ad92fd6846dad1163b1c8c01376a2cd1';
const URL_GEM = `https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/${COMMIT_GEM}/geojson/gem_active_faults.geojson`;
const RECUADRO = { o: -82, e: -66, s: -5, n: 14 };   // Colombia y vecinos
const CATALOGOS = new Set(['Active Tectonics of the Andes', 'SARA', 'GEM_Central_Am_Carib']);
const DECIMALES = 4;   // ~10 m: de sobra para trazas a escala regional

// "(2,,)" o "(0.5,0.1,1.0)" -> [preferida, mínima, máxima] en mm/año (null si falta)
function tasa(texto) {
    if (!texto) return null;
    const v = String(texto).replace(/[()]/g, '').split(',').map(x => (x.trim() === '' ? null : Number(x)));
    return v.some(x => x != null && isFinite(x)) ? v.map(x => (x != null && isFinite(x) ? x : null)) : null;
}

// "SANTA MARTA- BUCARAMANGA_FAULT" -> "Santa Marta-Bucaramanga Fault"
function nombre(texto) {
    if (!texto) return null;
    return String(texto).replace(/_/g, ' ').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim()
        .toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
}

const dentro = ([lon, lat]) => lon >= RECUADRO.o && lon <= RECUADRO.e && lat >= RECUADRO.s && lat <= RECUADRO.n;
const redondear = x => Math.round(x * 10 ** DECIMALES) / 10 ** DECIMALES;

const res = await fetch(URL_GEM);
if (!res.ok) throw new Error(`GEM respondió HTTP ${res.status}`);
const gem = await res.json();

const fallas = [];
for (const f of gem.features) {
    const p = f.properties || {}, g = f.geometry;
    if (!g || !CATALOGOS.has(p.catalog_name)) continue;
    const trazas = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const traza of trazas) {
        if (traza.length < 2 || !traza.some(dentro)) continue;
        fallas.push({
            nombre: nombre(p.name),
            tipo: p.slip_type || null,
            tasa: tasa(p.net_slip_rate),          // mm/año [pref, min, max]
            buzamiento: p.average_dip ? String(p.average_dip) : null,
            catalogo: p.catalog_name,
            referencia: p.reference || null,
            traza: traza.map(([lon, lat]) => [redondear(lon), redondear(lat)])
        });
    }
}

const salida = {
    fuente: 'GEM Global Active Faults Database (Styron & Pagani, 2020, Earthquake Spectra 36(1_suppl), 160-180)',
    url: `https://github.com/GEMScienceTools/gem-global-active-faults/tree/${COMMIT_GEM}`,
    licencia: 'CC BY-SA 4.0',
    catalogos: [...CATALOGOS],
    recuadro: RECUADRO,
    generado: new Date().toISOString().slice(0, 10),
    fallas
};
await writeFile(join(RAIZ, 'fallas-colombia.json'), JSON.stringify(salida));
const conNombre = fallas.filter(f => f.nombre).length;
console.log(`${fallas.length} trazas (${conNombre} con nombre) -> fallas-colombia.json`);
