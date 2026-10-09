#!/usr/bin/env node
// Verifica los datos de movimiento de placas contra hechos que no salen de ellos.
//
//   node tools/verificar-placas.mjs
//   node tools/verificar-placas.mjs --cache <dir>   # dónde dejó NGL velocidades-placas.mjs
//
// Cuatro pruebas independientes:
//
//   1. RECONSTRUCCIÓN. Con los polos derivados, rehacer los archivos de NGL con
//      placa fija a partir del de IGS14. Si el polo está bien, la diferencia con
//      el archivo que publica NGL es ruido de redondeo. Esto prueba la
//      aritmética, no la física.
//
//   2. CRATÓN QUIETO. Las estaciones del escudo amazónico, en marco Suramérica
//      fija, tienen que dar casi cero. Es la prueba de que el marco es el que
//      dice ser: si el polo estuviera mal, el cratón aparecería moviéndose.
//
//   3. CONVERGENCIA PUBLICADA. Las tasas Nazca–Suramérica en la fosa, y otras,
//      contra los valores de la literatura. Esta sí es física, y es la que
//      importa: los polos podrían ser aritméticamente perfectos y describir
//      un planeta equivocado.
//
//   4. GEOMETRÍA. Qué placa de PB2002 queda bajo puntos conocidos.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CACHE = args.includes('--cache') ? args[args.indexOf('--cache') + 1]
                                       : join(tmpdir(), 'ngl-midas');

const A = 6378137.0, F = 1 / 298.257223563, E2 = F * (2 - F);
const rad = (g) => g * Math.PI / 180;

function velocidadDePolo(w, lat, lon, h = 0) {
    const p = rad(lat), l = rad(lon);
    const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
    const r = [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l),
               (N * (1 - E2) + h) * Math.sin(p)];
    const v = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
    const e = [-Math.sin(l), Math.cos(l), 0];
    const n = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    return {                                            // mm/año
        ve: (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) * 1000,
        vn: (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) * 1000
    };
}
const magnitud = (v) => Math.hypot(v.ve, v.vn);
const azimut = (v) => (Math.atan2(v.ve, v.vn) * 180 / Math.PI + 360) % 360;
const relativo = (a, b) => [0, 1, 2].map(i => a[i] - b[i]);

function leerMidas(texto) {
    const est = new Map();
    for (const linea of texto.split('\n')) {
        const c = linea.trim().split(/\s+/);
        if (c.length < 27) continue;
        const lat = +c[24];
        if (!Number.isFinite(lat)) continue;
        est.set(c[0], { lat, lon: +c[25], h: +c[26], ve: +c[8] * 1000, vn: +c[9] * 1000,
                        se: +c[11] * 1000, sn: +c[12] * 1000, anios: +c[4] });
    }
    return est;
}

const mediana = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : NaN;
};

let fallas = 0;
const marca = (ok) => { if (!ok) fallas++; return ok ? 'ok' : 'FALLA'; };
const noRigidas = [];

const { polos } = JSON.parse(await readFile(join(RAIZ, 'placas/polos-euler.json'), 'utf8'));

// ------------------------------------------------ 1. reconstrucción
console.log('1. Rehacer los marcos de NGL con los polos derivados\n');
const rutaIgs = join(CACHE, 'midas.IGS14.txt');
if (!existsSync(rutaIgs)) {
    console.log(`   Sin caché en ${CACHE}: corré antes tools/velocidades-placas.mjs`);
    process.exit(2);
}
const igs = leerMidas(await readFile(rutaIgs, 'utf8'));
console.log('   placa   estaciones   residuo medio   peor');
for (const codigo of Object.keys(polos)) {
    const ruta = join(CACHE, `midas.${codigo}.txt`);
    if (!existsSync(ruta)) continue;
    const suyo = leerMidas(await readFile(ruta, 'utf8'));
    const w = polos[codigo].w;
    const dif = [];
    for (const [sta, p] of suyo) {
        const g = igs.get(sta);
        if (!g || Math.abs(g.lat - p.lat) > 1e-6) continue;
        const rot = velocidadDePolo(w, p.lat, p.lon, p.h);
        dif.push(Math.hypot(g.ve - rot.ve - p.ve, g.vn - rot.vn - p.vn));
    }
    if (!dif.length) continue;
    const med = mediana(dif), peor = Math.max(...dif);
    // La mediana ignora las pocas estaciones con solución rota (esas no llegan al
    // visor: velocidades-placas.mjs las filtra); el peor caso se informa igual.
    console.log(`   ${codigo.padEnd(6)} ${String(dif.length).padStart(9)} ` +
        `${med.toFixed(4).padStart(13)} mm ${peor.toFixed(1).padStart(8)} mm   ` +
        (med < 0.5 ? 'ok' : 'nota'));
    // ~1 mm no es un error del polo sino una propiedad del dato (ver abajo): se
    // informa, pero no cuenta como falla. Pasados 2 mm, sí.
    if (med >= 0.5) noRigidas.push(codigo);
    if (med >= 2) marca(false);
}
if (noRigidas.length) {
    console.log('');
    console.log(`   nota — ${noRigidas.join(', ')}: el archivo de NGL no es una rotación rígida exacta`);
    console.log('   de su propio campo IGS14 (residuo ~1 mm/a); son placas con deformación interna');
    console.log('   real. El polo es el mejor ajuste y polos-euler.json lo marca con rigida: false.');
}

// ------------------------------------------------ 2. cratón quieto
console.log('\n2. El cratón amazónico, con Suramérica fija, debe dar ~0\n');
const wSA = polos.SA.w;
const craton = [];
for (const [sta, e] of igs) {
    let lon = e.lon % 360; if (lon > 180) lon -= 360;
    if (e.lat < -12 || e.lat > 8 || lon < -72 || lon > -50) continue;   // escudo, lejos de los Andes
    if (e.anios < 4 || Math.max(e.se, e.sn) > 0.6) continue;
    const rot = velocidadDePolo(wSA, e.lat, lon, e.h);
    craton.push({ sta, v: Math.hypot(e.ve - rot.ve, e.vn - rot.vn) });
}
craton.sort((a, b) => a.v - b.v);
const medCraton = mediana(craton.map(c => c.v));
console.log(`   ${craton.length} estaciones · mediana ${medCraton.toFixed(2)} mm/a · ` +
    `peor ${craton[craton.length - 1].sta} ${craton[craton.length - 1].v.toFixed(2)} mm/a   ` +
    marca(medCraton < 1.5));

// ------------------------------------------------ 3. convergencia publicada
console.log('\n3. Movimiento relativo contra la literatura\n');
const casos = [
    ['Nazca→Suramérica, fosa de Tumaco',     'NZ', 'SA',   2.0, -79.5, 52, 60, 72, 88],
    ['Nazca→Suramérica, fosa frente a Lima', 'NZ', 'SA', -12.0, -78.0, 57, 65, 70, 86],
    ['Nazca→Suramérica, norte de Chile',     'NZ', 'SA', -23.5, -71.5, 60, 70, 70, 86],
    ['Cocos→Norteamérica, Guerrero',         'CO', 'NA',  16.0, -99.5, 55, 75, 15, 45],
    ['Pacífico→Norteamérica, San Andrés',    'PA', 'NA',  35.0, -120.5, 44, 54, 300, 330],
    ['Caribe→Suramérica, costa venezolana',  'CA', 'SA',  10.5, -68.0, 14, 24, 60, 110],
    ['Arabia→Eurasia, Zagros',               'AR', 'EU',  30.0,  50.0, 20, 28, 350, 25],
    ['India→Eurasia, Himalaya',              'IN', 'EU',  28.0,  85.0, 32, 42, 5, 35]
];
console.log('   caso                                    calculado        esperado');
for (const [nombre, a, b, lat, lon, vmin, vmax, amin, amax] of casos) {
    if (!polos[a] || !polos[b]) continue;
    const v = velocidadDePolo(relativo(polos[a].w, polos[b].w), lat, lon);
    const rapidez = magnitud(v), az = azimut(v);
    const azOk = amin <= amax ? (az >= amin && az <= amax) : (az >= amin || az <= amax);
    console.log(`   ${nombre.padEnd(38)} ${rapidez.toFixed(1).padStart(5)} mm/a ` +
        `az ${az.toFixed(0).padStart(3)}°   ${vmin}–${vmax}, ${amin}–${amax}°   ` +
        marca(rapidez >= vmin && rapidez <= vmax && azOk));
}

// ------------------------------------------------ 4. geometría
console.log('\n4. Qué placa hay bajo cada punto (polígonos PB2002)\n');
const geo = JSON.parse(await readFile(join(RAIZ, 'placas/placas-pb2002.json'), 'utf8'));
function enAnillo(lon, lat, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}
function placaDe(lat, lon) {
    for (const f of geo.features) {
        const gs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poli of gs) if (enAnillo(lon, lat, poli[0])) return f.properties.codigo;
    }
    return null;
}
// La fosa a 2°N está en −79.9° según PB2002: −81° queda con holgura en Nazca.
for (const [nombre, lat, lon, esperado] of [
    ['Bogotá', 4.64, -74.08, 'ND'], ['Leticia (escudo)', -4.2, -69.94, 'SA'],
    ['Nazca frente a Tumaco', 2.0, -81.0, 'NZ'], ['Medellín', 6.2, -75.58, 'ND'],
    ['Santa Marta', 11.23, -74.19, 'ND'], ['Lima', -12.05, -77.05, 'SA'],
    ['Ciudad de Panamá', 8.98, -79.53, 'PM']
]) {
    const cod = placaDe(lat, lon);
    console.log(`   ${nombre.padEnd(22)} ${String(cod).padEnd(4)} (esperado ${esperado})   ${marca(cod === esperado)}`);
}

console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodo en orden.');
process.exit(fallas ? 1 : 0);
