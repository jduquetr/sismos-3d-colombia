#!/usr/bin/env node
// Genera la instantánea de cada evento especial de eventos/libreria.json.
//
// Por qué existe: la página puede consultar USGS en vivo, pero USGS revisa
// magnitudes y agrega réplicas con el tiempo, así que la misma ficha cargada
// meses después no devuelve lo mismo. La instantánea congela el dato: es lo que
// carga la página por defecto y lo que hace citable una figura. El botón
// "Update from catalog" del panel vuelve a consultar en vivo cuando haga falta.
//
// Uso:
//   node tools/snapshot-eventos.mjs            # todas las fichas
//   node tools/snapshot-eventos.mjs choco-2026-08-10
//
// Escribe eventos/<id>.json. Commitea el resultado.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const USGS = 'https://earthquake.usgs.gov/fdsnws/event/1/';
const COLUMNAS = ['id', 'tiempo', 'lat', 'lon', 'prof', 'mag', 'auth', 'region'];

const hoy = () => new Date().toISOString().slice(0, 10);

function urlUSGS(c, fin) {
    const b = c.bbox;
    return `${USGS}query?format=geojson&orderby=time-asc` +
        `&minlatitude=${b.s}&maxlatitude=${b.n}&minlongitude=${b.o}&maxlongitude=${b.e}` +
        `&starttime=${c.inicio}&endtime=${fin}&minmagnitude=${c.minmag}&limit=${c.limite}`;
}

// Mismas columnas que espera filasAEventos() en explorador-area.html.
function filasDesdeGeoJSON(features) {
    const filas = [];
    let descartados = 0;
    for (const f of features) {
        const p = f.properties || {}, g = f.geometry || {};
        const c = g.coordinates || [];
        const lon = Number(c[0]), lat = Number(c[1]), prof = Number(c[2]), mag = Number(p.mag);
        if (![lon, lat, prof, mag].every(Number.isFinite) || !Number.isFinite(p.time)) { descartados++; continue; }
        filas.push([f.id || null, p.time, +lat.toFixed(4), +lon.toFixed(4),
                    +Math.abs(prof).toFixed(1), +mag.toFixed(1), p.net || 'us', p.place || '']);
    }
    return { filas, descartados };
}

async function traer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return res.json();
}

async function tensorDe(idEvento) {
    const j = await traer(`${USGS}query?eventid=${encodeURIComponent(idEvento)}&format=geojson`);
    const prod = ((j.properties || {}).products || {})['moment-tensor'];
    if (!prod || !prod.length) return null;
    const q = prod[0].properties || {};
    const n = (k) => Number(q[k]);
    return {
        lat: n('derived-latitude'), lon: n('derived-longitude'), depth: n('derived-depth'),
        mag: n('derived-magnitude') || Number(j.properties.mag),
        scalarMoment: n('scalar-moment'),
        mrr: n('tensor-mrr'), mtt: n('tensor-mtt'), mpp: n('tensor-mpp'),
        mrt: n('tensor-mrt'), mrp: n('tensor-mrp'), mtp: n('tensor-mtp'),
        fuente: q['beachball-source'] || 'us',
        revision: q['review-status'] || null,
        dobleParejaPct: q['percent-double-couple'] != null ? n('percent-double-couple') * 100 : null,
        planoA: {
            strike: n('nodal-plane-1-strike'), dip: n('nodal-plane-1-dip'), rake: n('nodal-plane-1-rake')
        }
    };
}

async function capa(c) {
    const fin = c.fin || hoy();
    const url = urlUSGS(c, fin);
    const j = await traer(url);
    const { filas, descartados } = filasDesdeGeoJSON(j.features || []);
    return { consulta: { ...c, fin }, url, filas, descartados, total: (j.metadata || {}).count ?? filas.length };
}

async function instantanea(ficha) {
    process.stdout.write(`${ficha.id}: contexto… `);
    const contexto = await capa(ficha.contexto);
    process.stdout.write(`${contexto.filas.length} · secuencia… `);
    const evento = await capa(ficha.consulta);
    process.stdout.write(`${evento.filas.length} · tensor… `);

    let tensor = null;
    try {
        tensor = ficha.usgsId ? await tensorDe(ficha.usgsId) : null;
    } catch (err) {
        console.log(`\n  aviso: no se pudo traer el tensor (${err.message}); se usa el de la ficha`);
    }
    if (!tensor && ficha.tensor) tensor = ficha.tensor;
    process.stdout.write(tensor ? 'ok\n' : 'sin tensor\n');

    const salida = {
        id: ficha.id,
        nombre: ficha.nombre,
        generado: new Date().toISOString(),
        fuente: 'USGS FDSN event query',
        nota: 'Instantánea congelada: es lo que la página carga por defecto. Regenerar con tools/snapshot-eventos.mjs.',
        columnas: COLUMNAS,
        contexto: { consulta: contexto.consulta, url: contexto.url, total: contexto.total, descartados: contexto.descartados, filas: contexto.filas },
        evento: { consulta: evento.consulta, url: evento.url, total: evento.total, descartados: evento.descartados, filas: evento.filas },
        tensor
    };
    const destino = join(RAIZ, 'eventos', `${ficha.id}.json`);
    await writeFile(destino, JSON.stringify(salida), 'utf8');
    const kb = (JSON.stringify(salida).length / 1024).toFixed(0);
    console.log(`  → eventos/${ficha.id}.json (${kb} KB)`);
}

const libreria = JSON.parse(await readFile(join(RAIZ, 'eventos', 'libreria.json'), 'utf8'));
const pedidos = process.argv.slice(2);
const fichas = pedidos.length
    ? libreria.eventos.filter(f => pedidos.includes(f.id))
    : libreria.eventos;

if (!fichas.length) {
    console.error('No hay fichas que coincidan. Ids disponibles:', libreria.eventos.map(f => f.id).join(', '));
    process.exit(1);
}
for (const ficha of fichas) await instantanea(ficha);
