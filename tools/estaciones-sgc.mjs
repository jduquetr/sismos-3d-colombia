#!/usr/bin/env node
// Congela el estado de las estaciones del SGC que se publican en EarthScope (antes
// IRIS): la red CM, Red Sismológica Nacional de Colombia.
//
//   node tools/estaciones-sgc.mjs          # reescribe estaciones/cm-earthscope.json
//
// Por qué existe, y por qué no se consulta en vivo desde la página:
//
// EarthScope archiva 27 estaciones de la red CM — el subconjunto que el SGC comparte
// por el convenio, de una red que tiene cientos. Su ficha (sitio, sensores, fechas)
// se puede pedir en vivo, pero la ficha no dice si llegan datos: cinco estaciones
// figuran vigentes y no tienen un solo registro archivado. El servicio que lo decía
// (fdsnws/availability) fue retirado, así que la única prueba es pedir datos de
// verdad, estación por estación. Eso no se le hace hacer al navegador de cada
// visitante: se hace aquí, se congela con su fecha y se vuelve a correr cuando haga
// falta.
//
// Cómo se decide el estado de cada estación:
//   - retirada:   su ficha tiene fecha de fin.
//   - transmite:  hay datos ayer.
//   - detenida:   no hay ayer, pero sí en alguna fecha anterior de las probadas; se
//                 guarda la más reciente.
//   - sin-datos:  vigente según la ficha, y ningún dato en ninguna fecha probada.
// Las fechas son muestras (20 s cada una), no un inventario completo: una estación
// con un corte justo a las 12:00 de ayer saldría "detenida". Por eso se guarda la
// fecha de cada prueba.
//
// Ojo con la marca de restricción: la de la estación hereda épocas viejas. Seis
// estaciones figuran "closed" y sus canales vigentes son todos "open" — se lee la
// del canal.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FDSN = 'https://service.earthscope.org/fdsnws';
const RED = 'CM';
const DIAS_ATRAS = [1, 7, 30, 90, 180, 365, 730, 1825];

const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const dia = (d) => d.toISOString().slice(0, 10);

async function texto(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
    return res.text();
}

// ¿Hay datos de esta estación ese día a las 12:00? 200 = sí, 204 = no.
async function hayDatos(estacion, fecha) {
    for (let intento = 0; intento < 3; intento++) {
        try {
            const res = await fetch(`${FDSN}/dataselect/1/query?net=${RED}&sta=${estacion}&cha=*` +
                `&starttime=${fecha}T12:00:00&endtime=${fecha}T12:00:20`);
            await res.arrayBuffer();
            await esperar(400);                       // de a una, sin apurar al servidor
            if (res.status === 200) return true;
            if (res.status === 204 || res.status === 404) return false;
        } catch (e) { /* corte de red: se reintenta */ }
        await esperar(2000);
    }
    throw new Error(`EarthScope no respondió para ${estacion} ${fecha}`);
}

// "STS-2, 120 s, 1500 V/m/s, ..." → "STS-2"
const sensorCorto = (s) => (s || '').split(',')[0].trim();

function leerCanales(xml) {
    const porEstacion = {};
    for (const st of xml.matchAll(/<Station code="(\w+)"[\s\S]*?<\/Station>/g)) {
        const canales = [];
        for (const ch of st[0].matchAll(/<Channel ([^>]*)>([\s\S]*?)<\/Channel>/g)) {
            const at = (n) => (ch[1].match(new RegExp(`${n}="([^"]*)"`)) || [])[1];
            // <Sensor> a veces trae atributos (resourceId): no se puede buscar la etiqueta pelada.
            const desc = (ch[2].match(/<Sensor[^>]*>[\s\S]*?<Description>([^<]*)<\/Description>/) || [])[1];
            canales.push({ codigo: at('code'), loc: at('locationCode'), desde: at('startDate'),
                           hasta: at('endDate') || null, restriccion: at('restrictedStatus'), sensor: desc });
        }
        porEstacion[st[1]] = canales;
    }
    return porEstacion;
}

async function main() {
    const ahora = new Date();
    console.log('Ficha de la red CM en EarthScope…');
    const lista = (await texto(`${FDSN}/station/1/query?net=${RED}&level=station&format=text&includerestricted=true`))
        .split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('|'));
    const canales = leerCanales(await texto(
        `${FDSN}/station/1/query?net=${RED}&level=channel&includerestricted=true`));
    console.log(`  ${lista.length} estaciones`);

    const estaciones = [];
    for (const [, codigo, lat, lon, elev, sitio, desde, hasta] of lista) {
        const retirada = hasta && new Date(hasta) < ahora;
        const todos = canales[codigo] || [];
        // Los canales que valen: los vigentes; en una retirada, los de su última época.
        const finEpoca = (c) => c.hasta ? new Date(c.hasta) : ahora;
        const ultimoFin = Math.max(...todos.map(c => +finEpoca(c)));
        const vigentes = todos.filter(c => retirada ? +finEpoca(c) === ultimoFin : !c.hasta || new Date(c.hasta) > ahora);
        const banda = vigentes.find(c => /^[HB]H/.test(c.codigo));
        const acel = vigentes.find(c => /^H[NL]/.test(c.codigo));

        let estado, ultimoDato = null, probadas = [];
        if (retirada) {
            // Para la retirada sirve saber si su archivo histórico existe: se prueba
            // a la mitad de su vida.
            const medio = dia(new Date((new Date(desde).getTime() + new Date(hasta).getTime()) / 2));
            probadas = [medio];
            estado = 'retirada';
            if (await hayDatos(codigo, medio)) ultimoDato = medio;
        } else {
            for (const d of DIAS_ATRAS) {
                const f = dia(new Date(ahora.getTime() - d * 86400000));
                probadas.push(f);
                if (await hayDatos(codigo, f)) { ultimoDato = f; break; }
            }
            estado = ultimoDato === probadas[0] ? 'transmite' : ultimoDato ? 'detenida' : 'sin-datos';
        }

        estaciones.push({
            codigo,
            sitio: sitio.trim(),
            lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), elevacion: +elev,
            desde: desde.slice(0, 10), hasta: hasta ? hasta.slice(0, 10) : null,
            estado, ultimoDato, probadas,
            bandaAncha: banda ? sensorCorto(banda.sensor) : null,
            acelerografo: acel ? sensorCorto(acel.sensor) : null,
            canales: [...new Set(vigentes.map(c => c.codigo))].sort(),
            abiertos: vigentes.length > 0 && vigentes.every(c => c.restriccion === 'open')
        });
        const e = estaciones[estaciones.length - 1];
        console.log(`  ${codigo.padEnd(6)} ${estado.padEnd(10)} ${String(ultimoDato || '—').padEnd(11)} ` +
            `${(e.bandaAncha || '').padEnd(14)} ${e.acelerografo || ''}`);
    }

    await mkdir(join(RAIZ, 'estaciones'), { recursive: true });
    await writeFile(join(RAIZ, 'estaciones', 'cm-earthscope.json'), JSON.stringify({
        red: RED,
        nombre: 'Red Sismológica Nacional de Colombia (SGC)',
        archivo: 'EarthScope Data Services (antes IRIS DMC)',
        servicio: `${FDSN}/station/1/`,
        consultado: dia(ahora),
        nota: 'Estado según pedir 20 s de datos a las 12:00 UTC en cada fecha de "probadas". ' +
            'Es una muestra, no un inventario completo del archivo.',
        estaciones
    }, null, 1) + '\n', 'utf8');
    const cuenta = estaciones.reduce((a, e) => (a[e.estado] = (a[e.estado] || 0) + 1, a), {});
    console.log('\n', cuenta, '\nEscrito estaciones/cm-earthscope.json. Commitealo.');
}

main().catch(e => { console.error(e); process.exit(1); });
