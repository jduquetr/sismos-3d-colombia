#!/usr/bin/env node
// Genera los datos de movimiento de placas que usa el visor: el campo de
// velocidades GNSS observado, los polos de Euler y la geometría de las placas.
//
// Uso:
//   node tools/velocidades-placas.mjs              # baja todo y reescribe placas/
//   node tools/velocidades-placas.mjs --cache dir  # reusa descargas previas
//
// De dónde sale cada cosa y por qué:
//
// 1. VELOCIDADES OBSERVADAS. El Nevada Geodetic Laboratory procesa todas las
//    estaciones GNSS públicas del mundo y publica MIDAS, un estimador de
//    tendencia robusto que no necesita detectar saltos a mano. Son 20 000
//    estaciones, sin login. EarthScope publica un producto equivalente pero
//    exige cuenta, así que no sirve para una página pública.
//    Incluye la red GeoRED del SGC: hay ~140 estaciones dentro de Colombia.
//
// 2. POLOS DE EULER. NGL publica el mismo campo en 25 marcos con una placa
//    fija. La diferencia entre el archivo IGS14 y el de la placa X es, en cada
//    estación, la rotación de X: v_IGS14 − v_X = ω_X × r. Eso es lineal en ω,
//    así que el polo se saca por mínimos cuadrados de sus propios archivos.
//
//    Se hace así, y no copiando una tabla publicada, por dos razones: queda
//    exactamente consistente con las velocidades que servimos (una tabla de
//    otro marco metería un sesgo de 1–2 mm/a), y el residuo del ajuste es una
//    prueba: si la rotación fuera mal calculada, no daría sub-milimétrico.
//    Con los polos, el navegador cambia de marco sin bajar 25 archivos, y puede
//    calcular el movimiento relativo entre dos placas en cualquier punto,
//    también mar adentro, donde no hay estaciones.
//
// 3. GEOMETRÍA. PB2002 (Bird, 2003): 52 placas y 241 segmentos de borde. Sus
//    códigos son los que usa NGL, así que polígonos y polos casan directo.
//
// Citar al usar: Blewitt et al. (2016) para MIDAS y Bird (2003) para PB2002.
// Verificación: tools/verificar-placas.mjs.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'placas');
const NGL = 'https://geodesy.unr.edu/velocities';
const PB2002 = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON';

// Solo las placas con marco documentado por NGL (midas.readme.txt). Las demás de
// PB2002 se dibujan, pero no tienen polo: no hay GNSS suficiente sobre ellas.
// NGL publica además un midas.BG.txt que su documentación no nombra: sin saber
// qué placa es, no se usa.
const PLACAS = {
    AF: 'África (Nubia)', AN: 'Antártica', AR: 'Arabia', AU: 'Australia',
    BU: 'Burma', CA: 'Caribe', CO: 'Cocos', EU: 'Eurasia', IN: 'India', MA: 'Mariana',
    NA: 'Norteamérica', NB: 'Bismarck Norte', NZ: 'Nazca', OK: 'Ojotsk', ON: 'Okinawa',
    PA: 'Pacífico', PM: 'Panamá', PS: 'Mar de Filipinas', SA: 'Suramérica', SB: 'Bismarck Sur',
    SC: 'Escocia', SL: 'Shetland', SO: 'Somalia', SU: 'Sonda', WL: 'Woodlark'
};

// Una estación con serie corta o con incertidumbre alta no dice nada: su flecha
// sería ruido dibujado con la misma autoridad que el resto.
const DURACION_MINIMA = 2.5;      // años
const SIGMA_MAXIMA = 1.0;         // mm/a
const VELOCIDAD_ABSURDA = 200;    // mm/a: soluciones rotas, no tectónica

const args = process.argv.slice(2);
const CACHE = args.includes('--cache')
    ? args[args.indexOf('--cache') + 1]
    : join(tmpdir(), 'ngl-midas');

async function bajar(url, archivo) {
    const local = join(CACHE, archivo);
    if (existsSync(local)) return readFile(local, 'utf8');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
    const texto = await res.text();
    await mkdir(CACHE, { recursive: true });
    await writeFile(local, texto);
    return texto;
}

// ---------------------------------------------------------------- geodesia
const A = 6378137.0, F = 1 / 298.257223563, E2 = F * (2 - F);
const rad = (g) => g * Math.PI / 180, gra = (r) => r * 180 / Math.PI;

function aECEF(lat, lon, h) {
    const p = rad(lat), l = rad(lon);
    const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
    return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l),
            (N * (1 - E2) + h) * Math.sin(p)];
}

// Filas del sistema: v = ω × r, proyectado a este y norte. Lineal en ω.
function filasDelPunto(lat, lon, h) {
    const r = aECEF(lat, lon, h), p = rad(lat), l = rad(lon);
    const e = [-Math.sin(l), Math.cos(l), 0];
    const n = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    const M = [[0, r[2], -r[1]], [-r[2], 0, r[0]], [r[1], -r[0], 0]];
    const proy = (u) => [0, 1, 2].map(j => u[0] * M[0][j] + u[1] * M[1][j] + u[2] * M[2][j]);
    return [proy(e), proy(n)];
}

function minimosCuadrados3(filas, term) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    filas.forEach((fila, k) => {
        for (let i = 0; i < 3; i++) {
            v[i] += fila[i] * term[k];
            for (let j = 0; j < 3; j++) M[i][j] += fila[i] * fila[j];
        }
    });
    for (let i = 0; i < 3; i++) {                       // Gauss con pivoteo
        let p = i;
        for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
        if (Math.abs(M[p][i]) < 1e-30) return null;
        [M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]];
        for (let k = i + 1; k < 3; k++) {
            const f = M[k][i] / M[i][i];
            for (let j = i; j < 3; j++) M[k][j] -= f * M[i][j];
            v[k] -= f * v[i];
        }
    }
    const x = [0, 0, 0];
    x[2] = v[2] / M[2][2];
    x[1] = (v[1] - M[1][2] * x[2]) / M[1][1];
    x[0] = (v[0] - M[0][1] * x[1] - M[0][2] * x[2]) / M[0][0];
    return x;
}

// ---------------------------------------------------------------- MIDAS
function leerMidas(texto) {
    const est = new Map();
    for (const linea of texto.split('\n')) {
        const c = linea.trim().split(/\s+/);
        if (c.length < 27) continue;
        const lat = +c[24], lon = +c[25], h = +c[26];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        est.set(c[0], {
            lat, lon, h,
            ve: +c[8] * 1000, vn: +c[9] * 1000, vu: +c[10] * 1000,
            se: +c[11] * 1000, sn: +c[12] * 1000,
            anios: +c[4], desde: +c[2], hasta: +c[3]
        });
    }
    return est;
}

function derivarPolo(codigo, igs, placa) {
    const pares = [];
    for (const [sta, p] of placa) {
        const g = igs.get(sta);
        if (!g) continue;
        if (Math.abs(g.lat - p.lat) > 1e-6 || Math.abs(g.lon - p.lon) > 1e-6) continue;
        const [fe, fn] = filasDelPunto(p.lat, p.lon, p.h);
        pares.push({ fe, fn, be: (g.ve - p.ve) / 1000, bn: (g.vn - p.vn) / 1000 });
    }
    if (pares.length < 3) return null;

    // Rechazo iterativo: unas pocas estaciones traen soluciones rotas (hasta
    // 100 m/a) que, sin filtrar, tuercen el polo entero.
    let vivos = pares, w = null, rms = 0;
    for (let vuelta = 0; vuelta < 6; vuelta++) {
        w = minimosCuadrados3(
            vivos.flatMap(p => [p.fe, p.fn]),
            vivos.flatMap(p => [p.be, p.bn]));
        if (!w) return null;
        const resid = vivos.map(p => Math.max(
            Math.abs(p.fe.reduce((a, f, j) => a + f * w[j], 0) - p.be),
            Math.abs(p.fn.reduce((a, f, j) => a + f * w[j], 0) - p.bn)) * 1000);
        rms = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / resid.length);
        const corte = Math.max(0.5, 4 * rms);
        const quedan = vivos.filter((_, i) => resid[i] <= corte);
        if (quedan.length === vivos.length || quedan.length < 3) break;
        vivos = quedan;
    }
    const mag = Math.hypot(w[0], w[1], w[2]);
    return {
        nombre: PLACAS[codigo],
        lat: +gra(Math.asin(w[2] / mag)).toFixed(4),
        lon: +gra(Math.atan2(w[1], w[0])).toFixed(4),
        gradosMa: +(gra(mag) * 1e6).toFixed(5),
        w: w.map(v => +v.toExponential(8)),   // rad/año, que es lo que usa la página
        estaciones: vivos.length,
        residuoMm: +rms.toFixed(3),
        // Por encima de medio milímetro, el marco de NGL no es una rotación rígida
        // exacta de su propio campo: la página lo avisa al usar esa placa.
        rigida: rms < 0.5
    };
}

// ---------------------------------------------------------------- GeoJSON
// Redondear a 3 decimales es ~100 m: de sobra para un borde de placa dibujado
// sobre un cubo, y recorta el archivo a la mitad.
function redondear(x) {
    if (Array.isArray(x)) return x.map(redondear);
    return typeof x === 'number' ? +x.toFixed(3) : x;
}

async function main() {
    await mkdir(SALIDA, { recursive: true });
    const hoy = new Date().toISOString().slice(0, 10);

    console.log('Bajando MIDAS IGS14…');
    const igs = leerMidas(await bajar(`${NGL}/midas.IGS14.txt`, 'midas.IGS14.txt'));
    console.log(`  ${igs.size} estaciones`);

    // --- 1. campo observado ---
    const filas = [];
    for (const [sta, e] of igs) {
        const sig = Math.max(e.se, e.sn);
        if (e.anios < DURACION_MINIMA || sig > SIGMA_MAXIMA) continue;
        if (Math.hypot(e.ve, e.vn) > VELOCIDAD_ABSURDA) continue;
        let lon = e.lon % 360; if (lon > 180) lon -= 360;
        filas.push([sta, +e.lat.toFixed(4), +lon.toFixed(4), +e.ve.toFixed(2),
                    +e.vn.toFixed(2), +e.vu.toFixed(2), +sig.toFixed(2), +e.anios.toFixed(1)]);
    }
    filas.sort((a, b) => a[0].localeCompare(b[0]));
    await writeFile(join(SALIDA, 'velocidades-gnss.json'), JSON.stringify({
        fuente: 'Nevada Geodetic Laboratory (University of Nevada, Reno) — MIDAS',
        marco: 'IGS14',
        cita: 'Blewitt, G., C. Kreemer, W.C. Hammond, J. Gazeaux (2016), MIDAS robust trend ' +
            'estimator for accurate GPS station velocities without step detection, JGR 121, ' +
            'doi:10.1002/2015JB012552',
        url: `${NGL}/midas.IGS14.txt`,
        bajado: hoy,
        nota: 'Velocidad secular de cada estación en mm/año. Cerca de un límite de placa ' +
            'NO es la velocidad de la placa: incluye la deformación elástica acumulada por ' +
            'el acople de la interfase, que se revierte en el próximo sismo.',
        filtros: { duracionMinimaAnios: DURACION_MINIMA, sigmaMaximaMmA: SIGMA_MAXIMA },
        columnas: ['sta', 'lat', 'lon', 've', 'vn', 'vu', 'sigma', 'anios'],
        filas
    }), 'utf8');
    console.log(`  velocidades-gnss.json: ${filas.length} estaciones tras filtrar`);

    // --- 2. polos ---
    console.log('Derivando polos de Euler de los marcos de NGL…');
    const polos = {};
    for (const codigo of Object.keys(PLACAS)) {
        const placa = leerMidas(await bajar(`${NGL}/midas.${codigo}.txt`, `midas.${codigo}.txt`));
        const polo = derivarPolo(codigo, igs, placa);
        if (!polo) { console.log(`  ${codigo}: sin estaciones suficientes`); continue; }
        polos[codigo] = polo;
        console.log(`  ${codigo} ${polo.nombre.padEnd(20)} ${String(polo.lat).padStart(8)}° ` +
            `${String(polo.lon).padStart(9)}° ${polo.gradosMa}°/Ma  ` +
            `n=${polo.estaciones} residuo=${polo.residuoMm} mm`);
    }
    await writeFile(join(SALIDA, 'polos-euler.json'), JSON.stringify({
        marco: 'IGS14',
        derivadoDe: `${NGL}/midas.<placa>.txt`,
        metodo: 'Mínimos cuadrados sobre v_IGS14 − v_placa = ω × r en cada estación común, ' +
            'con rechazo iterativo de residuos mayores a 4σ.',
        bajado: hoy,
        nota: 'ω en radianes por año, componentes ECEF. El residuo es lo que queda sin ' +
            'explicar por una rotación rígida: sub-milimétrico salvo en placas con ' +
            'deformación interna real.',
        polos
    }, null, 1), 'utf8');

    // --- 3. geometría ---
    console.log('Bajando PB2002…');
    for (const [remoto, local] of [['PB2002_plates.json', 'placas-pb2002.json'],
                                   ['PB2002_boundaries.json', 'bordes-pb2002.json']]) {
        const gj = JSON.parse(await bajar(`${PB2002}/${remoto}`, remoto));
        gj.features.forEach(f => {
            f.geometry.coordinates = redondear(f.geometry.coordinates);
            const p = f.properties;
            f.properties = p.PlateA
                ? { a: p.PlateA, b: p.PlateB }
                : { codigo: p.Code, nombre: p.PlateName };
        });
        const texto = JSON.stringify({
            fuente: 'Bird, P. (2003), An updated digital model of plate boundaries, ' +
                'Geochem. Geophys. Geosyst. 4(3), 1027, doi:10.1029/2001GC000252',
            url: `${PB2002}/${remoto}`,
            bajado: hoy,
            type: 'FeatureCollection',
            features: gj.features
        });
        await writeFile(join(SALIDA, local), texto, 'utf8');
        console.log(`  ${local}: ${gj.features.length} geometrías, ${(texto.length / 1024).toFixed(0)} kB`);
    }
    console.log('\nListo. Verificá con tools/verificar-placas.mjs y commiteá placas/.');
}

main().catch(e => { console.error(e); process.exit(1); });
