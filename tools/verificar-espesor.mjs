// Verifica que el espesor de la placa se mida PERPENDICULAR a la superficie y no
// en vertical. No lee el código: lo ejecuta.
//
//   node tools/verificar-espesor.mjs                    # el HTML del repo
//   node tools/verificar-espesor.mjs otra-copia.html    # otra versión, para comparar
//
// Toma volumenSlab2() tal como está en explorador-area.html, le pone stubs de THREE,
// del proyector y de los controles, y le da una placa sintética con buzamiento
// conocido. Luego mide, en km reales, el vector techo→piso de cada nodo:
//   - su longitud debe ser el espesor pedido (10 km), no 10/cos(buzamiento)
//   - su ángulo con la vertical debe ser el buzamiento (perpendicular a la superficie)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(process.argv[2] || join(RAIZ, 'explorador-area.html'), 'utf8');
const ini = html.indexOf('        function leerEspesorSlab2()');
const fin = html.indexOf('        function construirGrupoSlab2(');
if (ini < 0 || fin < 0) throw new Error('No encontré las funciones en el HTML');
const codigo = html.slice(ini, fin).replace(/\r\n/g, '\n');

// --- stubs mínimos ---
const KM_LAT = 111.32;
let ESPESOR = 10;
const $ = (id) => ({
    slab2Espesor: { value: String(ESPESOR) },
    slab2OpacidadSlider: { value: '35' }
}[id] || null);

const capturado = { posiciones: null, indices: null };
const THREE = {
    BufferGeometry: class {
        setAttribute(_, a) { capturado.posiciones = a.array; }
        setIndex(i) { capturado.indices = i; }
        computeVertexNormals() {}
    },
    Float32BufferAttribute: class { constructor(arr) { this.array = arr; } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
    MeshLambertMaterial: class { constructor(o) { Object.assign(this, o); } },
    Color: class { constructor(c) { this.c = c; } },
    DoubleSide: 2
};
const leerTema3D = () => ({ slab: '#000000' });

// Placa sintética: profundidad crece hacia el este con un buzamiento fijo.
const BUZAMIENTO = 40;                        // grados
const LAT0 = 0, LON0 = -78;                   // centro
const kmLon = KM_LAT * Math.cos(LAT0 * Math.PI / 180);
const pendienteKmPorKm = Math.tan(BUZAMIENTO * Math.PI / 180);
const profEn = (lon) => 60 + (lon - LON0) * kmLon * pendienteKmPorKm;

const datosFondo = {
    bbox: { n: LAT0 + 1.5, s: LAT0 - 1.5, o: LON0 - 1.5, e: LON0 + 1.5 },
    profTope: 0, profPiso: 400
};

// Proyector en KM reales (sin exageración vertical) para poder medir distancias.
const P = {
    x: (lon) => (lon - LON0) * kmLon,
    y: (lat) => (lat - LAT0) * KM_LAT,
    z: (prof) => -prof
};

// Contornos sintéticos: líneas norte-sur de profundidad constante, como las de Slab2.
const lineas = [];
for (let lon = datosFondo.bbox.o; lon <= datosFondo.bbox.e + 1e-9; lon += 0.25) {
    const pts = [];
    for (let lat = datosFondo.bbox.s; lat <= datosFondo.bbox.n + 1e-9; lat += 0.02) pts.push([lon, lat]);
    lineas.push({ prof: profEn(lon), pts });
}

const volumenSlab2 = new Function('$', 'THREE', 'leerTema3D', 'datosFondo', `
${codigo}
return volumenSlab2;
`)($, THREE, leerTema3D, datosFondo);

function medir(espesorPedido) {
    ESPESOR = espesorPedido;
    capturado.posiciones = null;
    volumenSlab2(lineas, P);
    const pos = capturado.posiciones;
    if (!pos) throw new Error('no se generó geometría');
    const n = pos.length / 3 / 2;                  // mitad techo, mitad piso
    const medidas = [];
    for (let i = 0; i < n; i++) {
        const t = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        const b = [pos[(n + i) * 3], pos[(n + i) * 3 + 1], pos[(n + i) * 3 + 2]];
        const v = [b[0] - t[0], b[1] - t[1], b[2] - t[2]];
        const largo = Math.hypot(...v);
        if (!largo) continue;
        // ángulo entre el vector techo→piso y la vertical (0,0,-1)
        const cos = (-v[2]) / largo;
        medidas.push({ largo, angulo: Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI,
                       dx: v[0], dz: v[2] });
    }
    // se descartan los bordes, donde la derivada es de un solo lado
    const centro = medidas.slice(Math.floor(medidas.length * 0.25), Math.floor(medidas.length * 0.75));
    const prom = (f) => centro.reduce((a, m) => a + f(m), 0) / centro.length;
    return {
        n: centro.length,
        espesorMedido: prom(m => m.largo),
        anguloConVertical: prom(m => m.angulo),
        desplazamientoHorizontal: prom(m => Math.abs(m.dx)),
        caidaVertical: prom(m => Math.abs(m.dz))
    };
}

// ¿El vector techo→piso es perpendicular a la superficie QUE SE CONSTRUYÓ?
// Se compara con la tangente local del techo (dos nodos vecinos en la misma fila).
function perpendicularidad() {
    ESPESOR = 10;
    capturado.posiciones = null;
    volumenSlab2(lineas, P);
    const pos = capturado.posiciones;
    const n = pos.length / 3 / 2;
    const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const angulos = [], buzamientos = [];
    for (let i = 1; i < n - 1; i++) {
        const a = v(i), b = v(i + 1);
        if (Math.abs(a[1] - b[1]) > 1e-6) continue;          // distinta fila
        const tang = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const off = [v(n + i)[0] - a[0], v(n + i)[1] - a[1], v(n + i)[2] - a[2]];
        const lt = Math.hypot(...tang), lo = Math.hypot(...off);
        if (!lt || !lo) continue;
        const cos = (tang[0] * off[0] + tang[1] * off[1] + tang[2] * off[2]) / (lt * lo);
        angulos.push(Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI);
        buzamientos.push(Math.atan2(Math.abs(tang[2]), Math.abs(tang[0])) * 180 / Math.PI);
    }
    const prom = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { n: angulos.length, angulo: prom(angulos), buzamientoReconstruido: prom(buzamientos) };
}

console.log(`Placa sintética con buzamiento ${BUZAMIENTO}°`);
const perp = perpendicularidad();
console.log(`
Perpendicularidad respecto a la superficie construida (${perp.n} pares de nodos):`);
console.log(`  ángulo entre el vector techo→piso y la tangente del techo: ${perp.angulo.toFixed(2)}°  (90° = perpendicular)`);
console.log(`  buzamiento de la superficie reconstruida por la interpolación: ${perp.buzamientoReconstruido.toFixed(2)}°  (el sintético es ${BUZAMIENTO}°)`);

for (const t of [10, 40]) {
    const r = medir(t);
    console.log(`\nEspesor pedido: ${t} km   (${r.n} nodos medidos)`);
    console.log(`  espesor medido (techo→piso) : ${r.espesorMedido.toFixed(3)} km`);
    console.log(`  si fuera vertical sería      : ${(t / Math.cos(BUZAMIENTO * Math.PI / 180)).toFixed(3)} km de espesor real`);
    console.log(`  ángulo del vector con la vertical: ${r.anguloConVertical.toFixed(2)}°  (buzamiento = ${BUZAMIENTO}° si es perpendicular, 0° si es vertical)`);
    console.log(`  componentes: ${r.desplazamientoHorizontal.toFixed(2)} km horizontal · ${r.caidaVertical.toFixed(2)} km vertical`);
    console.log(`  esperado perpendicular      : ${(t * Math.sin(BUZAMIENTO * Math.PI / 180)).toFixed(2)} km horizontal · ${(t * Math.cos(BUZAMIENTO * Math.PI / 180)).toFixed(2)} km vertical`);
}
