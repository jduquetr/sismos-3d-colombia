#!/usr/bin/env node
// Mide la cobertura de la superficie de Slab2 en varias zonas de subducción:
// cuántas celdas que están DENTRO de la placa se quedan sin superficie.
//
// Es la prueba que destapó que la placa salía a fragmentos: el relleno buscaba
// muestras dentro de un radio más corto que la separación entre contornos, y entre
// curva y curva quedaba un hueco. Sirve para volver a comprobarlo si se toca esa
// geometría (ver volumenSlab2 en explorador-area.html).
//
//   node tools/verificar-slab.mjs
//
// Baja los contornos de USGS (unas 15 peticiones por zona, el servicio devuelve un
// contorno por petición) y los guarda en tools/.cache-slab-<zona>.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CACHE = join(AQUI, '.cache-slab');
const SLAB2 = 'https://earthquake.usgs.gov/arcgis/rest/services/eq/slab2_depth/MapServer/0/query';

const zonas = {
    'Chocó':   { n: 8, s: 3, o: -79, e: -74 },
    'Chile':   { n: -18, s: -23, o: -72, e: -67 },
    'Japón':   { n: 41, s: 35, o: 139, e: 145 },
    'Sumatra': { n: 4, s: -4, o: 94, e: 102 }
};

async function contornos(nombre, b) {
    mkdirSync(CACHE, { recursive: true });
    const archivo = join(CACHE, `${nombre}.json`);
    if (existsSync(archivo)) return JSON.parse(readFileSync(archivo, 'utf8'));

    const comun = `geometry=${b.o},${b.s},${b.e},${b.n}&geometryType=esriGeometryEnvelope` +
        '&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&where=1%3D1';
    const conteo = (await (await fetch(`${SLAB2}?${comun}&returnCountOnly=true&f=json`)).json()).count || 0;
    const tol = Math.max(0.005, (b.e - b.o) / 600);
    const lineas = [];
    for (let i = 0; i < Math.min(conteo, 80); i += 8) {
        const tanda = [];
        for (let k = i; k < Math.min(i + 8, conteo, 80); k++) {
            tanda.push(fetch(`${SLAB2}?${comun}&outFields=depth&resultOffset=${k}` +
                `&resultRecordCount=1&maxAllowableOffset=${tol}&f=geojson`)
                .then(r => r.json()).catch(() => null));
        }
        (await Promise.all(tanda)).forEach(j => ((j && j.features) || []).forEach(f => {
            const prof = Math.abs(Number(f.properties.depth));
            const g = f.geometry || {};
            const partes = g.type === 'MultiLineString' ? g.coordinates
                : (g.type === 'LineString' ? [g.coordinates] : []);
            partes.forEach(pts => {
                const dentro = pts.filter(p => p[0] >= b.o && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n);
                if (dentro.length > 1) lineas.push({ prof, pts: dentro });
            });
        }));
    }
    const dato = { conteo, lineas };
    writeFileSync(archivo, JSON.stringify(dato));
    return dato;
}

// volumenSlab2 tal como está en el HTML, con stubs: así se mide lo que se publica.
function cargarVolumenSlab2(bbox, piso) {
    const html = readFileSync(join(AQUI, '..', 'explorador-area.html'), 'utf8');
    const ini = html.indexOf('        function leerEspesorSlab2()');
    const fin = html.indexOf('        function construirGrupoSlab2(');
    const codigo = html.slice(ini, fin).replace(/\r\n/g, '\n');
    const cap = {};
    const THREE = {
        BufferGeometry: class {
            setAttribute(_, a) { cap.pos = a.array; }
            setIndex(i) { cap.idx = i; }
            computeVertexNormals() {}
        },
        Float32BufferAttribute: class { constructor(a) { this.array = a; } },
        Mesh: class {}, MeshLambertMaterial: class {}, Color: class {}, DoubleSide: 2
    };
    const $ = (id) => ({ slab2Espesor: { value: '10' }, slab2OpacidadSlider: { value: '35' } }[id] || null);
    const fn = new Function('$', 'THREE', 'leerTema3D', 'datosFondo',
        `${codigo}\nreturn volumenSlab2;`)($, THREE, () => ({ slab: '#000' }),
        { bbox, profTope: 0, profPiso: piso });
    return { fn, cap };
}

// Una celda está "dentro de la placa" si sus dos contornos más cercanos quedan a
// lados opuestos: es un criterio geométrico, independiente de cómo se rellene.
function celdasDentro(b, lineas, N) {
    const niveles = new Map();
    lineas.forEach(l => { if (!niveles.has(l.prof)) niveles.set(l.prof, []); l.pts.forEach(p => niveles.get(l.prof).push(p)); });
    const pasoLon = (b.e - b.o) / N, pasoLat = (b.n - b.s) / N;
    const dentro = [];
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
            const lon = b.o + i * pasoLon, lat = b.s + j * pasoLat;
            const cerc = [];
            for (const [prof, pts] of niveles) {
                let m = Infinity, vx = 0, vy = 0;
                for (const p of pts) {
                    const dx = p[0] - lon, dy = p[1] - lat, d2 = dx * dx + dy * dy;
                    if (d2 < m) { m = d2; vx = dx; vy = dy; }
                }
                cerc.push({ d: Math.sqrt(m), vx, vy });
            }
            cerc.sort((x, y) => x.d - y.d);
            if (cerc.length > 1 && (cerc[0].vx * cerc[1].vx + cerc[0].vy * cerc[1].vy) < 0) dentro.push([lon, lat]);
        }
    }
    return dentro;
}

const KM = 111.32;
for (const [nombre, b] of Object.entries(zonas)) {
    const { lineas } = await contornos(nombre, b);
    const piso = Math.max(...lineas.map(l => l.prof));
    const { fn, cap } = cargarVolumenSlab2(b, piso);
    const kmLon = KM * Math.cos(((b.n + b.s) / 2) * Math.PI / 180);
    const P = { x: (lon) => (lon - b.o) * kmLon, y: (lat) => (lat - b.s) * KM, z: (p) => -p };
    cap.pos = null;
    fn(lineas, P);

    // Área del techo, sumando los triángulos que solo usan vértices del techo.
    const nv = cap.pos ? cap.pos.length / 6 : 0;
    let area = 0;
    if (cap.idx && cap.pos) {
        for (let t = 0; t < cap.idx.length; t += 3) {
            const [i0, i1, i2] = [cap.idx[t], cap.idx[t + 1], cap.idx[t + 2]];
            if (i0 >= nv || i1 >= nv || i2 >= nv) continue;
            const p = (i) => [cap.pos[i * 3], cap.pos[i * 3 + 1], cap.pos[i * 3 + 2]];
            const [a, c, d] = [p(i0), p(i1), p(i2)];
            const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
            area += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
        }
    }

    const dentro = celdasDentro(b, lineas, 64);
    const profs = [...new Set(lineas.map(l => l.prof))].sort((x, y) => x - y);
    console.log(`${nombre.padEnd(8)} ${String(lineas.length).padStart(3)} contornos (${profs[0]}–${profs[profs.length - 1]} km) · ` +
        `${String(nv).padStart(4)} nodos de techo · área ${Math.round(area).toLocaleString().padStart(9)} km² · ` +
        `celdas dentro de la placa: ${dentro.length}`);
}
console.log('\nSi el área cae mucho o los nodos bajan frente a las celdas dentro de la placa,');
console.log('la superficie está volviendo a salir a trozos.');
