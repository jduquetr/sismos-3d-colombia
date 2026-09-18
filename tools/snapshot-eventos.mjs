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
//   node tools/snapshot-eventos.mjs                    # todas las fichas
//   node tools/snapshot-eventos.mjs choco-2026-08-10   # solo una
//   node tools/snapshot-eventos.mjs --add us6000tjl2   # agrega la ficha y la congela
//   node tools/snapshot-eventos.mjs --ventana --desde 2026-01-01 --hasta 2026-01-31 --mag 5
//   node tools/snapshot-eventos.mjs --indice --desde-anio 2000
//                                                      # índice de significativos por año
//                                                      # ventana de catálogo (mundial o con --bbox n,s,o,e)
//
// Con --add basta el id del evento en USGS: la ficha (área, ventana de tiempo,
// estilo y tensor) se deriva del feed de detalle — ver tools/derivar-ficha.mjs —
// y se agrega a eventos/libreria.json. Lo derivado se puede editar después.
//
// Escribe eventos/<id>.json. Commitea el resultado.

import { readFile, writeFile } from 'node:fs/promises';
import { URL_DETALLE, fichaDesdeDetalle, fichaVentana, tensorDesdeDetalle } from './derivar-ficha.mjs';
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
    return tensorDesdeDetalle(await traer(URL_DETALLE(idEvento)));
}

async function capa(c) {
    const fin = c.fin || hoy();
    const url = urlUSGS(c, fin);
    const j = await traer(url);
    const { filas, descartados } = filasDesdeGeoJSON(j.features || []);
    // USGS corta en 'limit' sin decirlo: si volvieron tantas filas como el tope,
    // hay más eventos que los guardados y conviene que la página lo diga.
    const truncado = filas.length >= c.limite;
    return { consulta: { ...c, fin }, url, filas, descartados, truncado,
             total: (j.metadata || {}).count ?? filas.length };
}

// Los tensores de una ventana: solo los eventos que declaran 'moment-tensor' en
// properties.types traen uno, así que se piden nada más esos, en tandas.
async function tensoresDeVentana(features, tope) {
    // 'types' es una lista separada por comas: hay que comparar el tipo completo,
    // porque 'internal-moment-tensor' contiene la cadena pero NO es público — el
    // feed de detalle de esos eventos no trae moment-tensor.
    const conTensor = features.filter(f =>
        String(f.properties.types || '').split(',').includes('moment-tensor'));
    const elegidos = conTensor.slice(0, tope);
    console.log(`  tensores: ${conTensor.length} publicados de ${features.length} eventos` +
        (conTensor.length > elegidos.length ? ` (se bajan ${elegidos.length})` : ''));
    const salida = [];
    for (let i = 0; i < elegidos.length; i += 8) {
        const tanda = elegidos.slice(i, i + 8).map(f =>
            traer(URL_DETALLE(f.id)).then(d => tensorDesdeDetalle(d)).catch(() => null));
        (await Promise.all(tanda)).forEach((T, k) => {
            if (!T) return;
            const f = elegidos[i + k];
            salida.push({ ...T, usgsId: f.id, nombre: f.properties.place || f.id });
        });
        process.stdout.write(`  bajados ${salida.length}/${elegidos.length}   `);
    }
    return salida;
}

async function instantaneaVentana(ficha, opciones) {
    const c = ficha.contexto;
    const fin = c.fin || hoy();
    const url = urlUSGS(c, fin);
    console.log(`${ficha.id}`);
    console.log(`  ${url}`);
    const j = await traer(url);
    const features = j.features || [];
    const { filas, descartados } = filasDesdeGeoJSON(features);
    console.log(`  eventos: ${filas.length}${filas.length >= c.limite ? ' (tope)' : ''}`);

    const tensores = opciones.tensores === false ? [] : await tensoresDeVentana(features, opciones.topeTensores);

    const salida = {
        id: ficha.id, nombre: ficha.nombre, tipo: 'ventana',
        generado: new Date().toISOString(),
        fuente: 'USGS FDSN event query',
        nota: 'Instantánea congelada de una ventana de catálogo. Regenerar con tools/snapshot-eventos.mjs.',
        columnas: COLUMNAS,
        contexto: { consulta: { ...c, fin }, url, total: (j.metadata || {}).count ?? filas.length,
                    descartados, truncado: filas.length >= c.limite, filas },
        evento: null,
        tensores
    };
    await writeFile(join(RAIZ, 'eventos', `${ficha.id}.json`), JSON.stringify(salida), 'utf8');
    console.log(`  → eventos/${ficha.id}.json (${(JSON.stringify(salida).length / 1024).toFixed(0)} KB, ${tensores.length} tensores)`);
}

async function instantanea(ficha) {
    if (ficha.tipo === 'ventana') return instantaneaVentana(ficha, { topeTensores: 300 });
    process.stdout.write(`${ficha.id}: contexto… `);
    const contexto = await capa(ficha.contexto);
    process.stdout.write(`${contexto.filas.length}${contexto.truncado ? ' (tope)' : ''} · secuencia… `);
    const evento = await capa(ficha.consulta);
    process.stdout.write(`${evento.filas.length}${evento.truncado ? ' (tope)' : ''} · tensor… `);

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
        contexto: { consulta: contexto.consulta, url: contexto.url, total: contexto.total, descartados: contexto.descartados, truncado: contexto.truncado, filas: contexto.filas },
        evento: { consulta: evento.consulta, url: evento.url, total: evento.total, descartados: evento.descartados, truncado: evento.truncado, filas: evento.filas },
        tensor
    };
    const destino = join(RAIZ, 'eventos', `${ficha.id}.json`);
    await writeFile(destino, JSON.stringify(salida), 'utf8');
    const kb = (JSON.stringify(salida).length / 1024).toFixed(0);
    console.log(`  → eventos/${ficha.id}.json (${kb} KB)`);
}

// Índice de eventos significativos por año: lo que alimenta el acordeón del panel.
// 'significativo' es el criterio del propio USGS (campo sig, el mismo de su página de
// significant earthquakes); no es un umbral de magnitud.
async function indiceSignificativos(desdeAnio, hastaAnio, minsig) {
    const anios = {};
    let total = 0;
    for (let a = hastaAnio; a >= desdeAnio; a--) {
        const url = `${USGS}query?format=geojson&orderby=time&starttime=${a}-01-01` +
            `&endtime=${a}-12-31T23:59:59&minsig=${minsig}&limit=20000`;
        const j = await traer(url);
        const filas = [];
        for (const f of (j.features || [])) {
            const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
            const mag = Number(p.mag), lat = Number(c[1]), lon = Number(c[0]), prof = Number(c[2]);
            if (![mag, lat, lon].every(Number.isFinite)) continue;
            filas.push([
                f.id, p.time, +lat.toFixed(3), +lon.toFixed(3),
                Number.isFinite(prof) ? +Math.abs(prof).toFixed(1) : null,
                +mag.toFixed(1), p.place || '', Number(p.sig) || 0,
                String(p.types || '').split(',').includes('moment-tensor') ? 1 : 0
            ]);
        }
        anios[a] = filas;
        total += filas.length;
        process.stdout.write(`  ${a}: ${filas.length}${String.fromCharCode(10)}`);
    }
    const salida = {
        generado: new Date().toISOString(),
        fuente: 'USGS FDSN event query, minsig',
        minsig, desde: desdeAnio, hasta: hastaAnio,
        nota: 'Índice para navegar por año. Al elegir un evento la página lee su feed de detalle y lo carga en vivo.',
        columnas: ['id', 'tiempo', 'lat', 'lon', 'prof', 'mag', 'lugar', 'sig', 'tensor'],
        anios
    };
    await writeFile(join(RAIZ, 'eventos', 'significativos.json'), JSON.stringify(salida), 'utf8');
    console.log(`→ eventos/significativos.json (${(JSON.stringify(salida).length / 1024).toFixed(0)} KB, ${total} eventos)`);
}

const rutaLibreria = join(RAIZ, 'eventos', 'libreria.json');
const libreria = JSON.parse(await readFile(rutaLibreria, 'utf8'));
const args = process.argv.slice(2);

if (args[0] === '--add') {
    const idUSGS = args[1];
    if (!idUSGS) {
        console.error('Falta el id del evento:  node tools/snapshot-eventos.mjs --add us6000tjl2');
        process.exit(1);
    }
    console.log(`Leyendo ${URL_DETALLE(idUSGS)}`);
    const ficha = fichaDesdeDetalle(await traer(URL_DETALLE(idUSGS)));
    const ya = libreria.eventos.findIndex(f => f.id === ficha.id || f.usgsId === ficha.usgsId);
    if (ya >= 0) {
        console.log(`Ya había una ficha para ${ficha.usgsId} (${libreria.eventos[ya].id}): se reemplaza lo derivado.`);
        libreria.eventos[ya] = { ...libreria.eventos[ya], ...ficha, id: libreria.eventos[ya].id };
    } else {
        libreria.eventos.push(ficha);
    }
    await writeFile(rutaLibreria, JSON.stringify(libreria, null, 2) + String.fromCharCode(10), 'utf8');
    console.log(`Ficha ${ficha.id}: ${ficha.nombre}`);
    console.log(`  secuencia ${JSON.stringify(ficha.consulta.bbox)} desde ${ficha.consulta.inicio}`);
    console.log(`  contexto  ${JSON.stringify(ficha.contexto.bbox)}`);
    console.log(`  tensor    ${ficha.tensor ? 'sí' : 'no publicado'}`);
    await instantanea(libreria.eventos.find(f => f.usgsId === ficha.usgsId));
    console.log('Listo. Commitea eventos/libreria.json y eventos/<id>.json.');
} else if (args[0] === '--indice') {
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const desde = Number(opt('--desde-anio', 2000));
    const hasta = Number(opt('--hasta-anio', new Date().getUTCFullYear()));
    const minsig = Number(opt('--minsig', 600));
    console.log(`Índice de significativos ${desde}–${hasta} (sig ≥ ${minsig})`);
    await indiceSignificativos(desde, hasta, minsig);
} else if (args[0] === '--ventana') {
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const bboxTexto = opt('--bbox', null);
    const bbox = bboxTexto ? (() => {
        const [n, s, o, e] = bboxTexto.split(',').map(Number);
        if (![n, s, o, e].every(Number.isFinite)) throw new Error('--bbox espera n,s,o,e');
        return { n, s, o, e };
    })() : null;
    const ficha = fichaVentana({
        inicio: opt('--desde', '2026-01-01'),
        fin: opt('--hasta', hoy()),
        minmag: Number(opt('--mag', 5)),
        bbox,
        nombre: opt('--nombre', null),
        limite: Number(opt('--limite', 20000)),
        tensores: !args.includes('--sin-tensores')
    });
    const ya = libreria.eventos.findIndex(f => f.id === ficha.id);
    if (ya >= 0) libreria.eventos[ya] = ficha; else libreria.eventos.push(ficha);
    await writeFile(rutaLibreria, JSON.stringify(libreria, null, 2) + String.fromCharCode(10), 'utf8');
    await instantaneaVentana(ficha, { tensores: !args.includes('--sin-tensores'), topeTensores: Number(opt('--tope-tensores', 300)) });
    console.log('Listo. Commitea eventos/libreria.json y eventos/<id>.json.');
} else {
    const fichas = args.length ? libreria.eventos.filter(f => args.includes(f.id)) : libreria.eventos;
    if (!fichas.length) {
        console.error('No hay fichas que coincidan. Ids disponibles:', libreria.eventos.map(f => f.id).join(', '));
        process.exit(1);
    }
    for (const ficha of fichas) await instantanea(ficha);
}
