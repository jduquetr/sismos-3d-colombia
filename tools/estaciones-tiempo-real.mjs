#!/usr/bin/env node
// Congela qué estaciones sismológicas transmiten en tiempo real, en abierto, en una
// región: las que están ahora mismo en el anillo de un servidor SeedLink público.
//
//   node tools/estaciones-tiempo-real.mjs                 # región por defecto
//   node tools/estaciones-tiempo-real.mjs --bbox n,s,e,o  # otra región
//
// Por qué así:
//
// La lista de estaciones del ISC (o la ficha FDSN de una red) dice qué estaciones
// existen, no cuáles se pueden escuchar. Eso lo dice un servidor SeedLink: a la
// orden INFO STREAMS responde, canal por canal, la hora del último dato que tiene.
// Una estación cuyo último dato tiene menos de ATRASO_MAXIMO minutos está en vivo.
// Esa respuesta pesa 6 MB en EarthScope: se pide aquí, no en el navegador de cada
// visitante, y se congela con su hora.
//
// Servidores: EarthScope (rtserve, antes IRIS) y GEOFON. Raspberry Shake no ofrece
// SeedLink público. EarthScope además acepta SeedLink por WebSocket cifrado
// (wss://rtserve.earthscope.org/seedlink), así que sus estaciones se podrían
// escuchar directo desde una página; GEOFON no.
//
// Las coordenadas salen del servicio FDSN de cada centro, filtrado a la región. Se
// cruza con el registro del ISC por código y posición (a menos de ~5 km), porque
// el ISC usa sus propios códigos de red.

import { writeFile, mkdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATRASO_MAXIMO = 10;   // minutos
const SERVIDORES = [
    { nombre: 'EarthScope', host: 'rtserve.iris.washington.edu', puerto: 18000,
      fdsn: 'https://service.earthscope.org/fdsnws', websocket: 'wss://rtserve.earthscope.org/seedlink' },
    { nombre: 'GEOFON', host: 'geofon.gfz-potsdam.de', puerto: 18000,
      fdsn: 'https://geofon.gfz-potsdam.de/fdsnws', websocket: null }
];

const args = process.argv.slice(2);
// Por defecto, el rectángulo de la consulta al ISC: de México al norte de Perú.
const [N, S, E, O] = args.includes('--bbox')
    ? args[args.indexOf('--bbox') + 1].split(',').map(Number)
    : [23.631, -7.290, -61.992, -104.883];

// INFO STREAMS por SeedLink: cada paquete son 8 bytes ("SLINFO  ", o "SLINFO *" si
// siguen más) y un registro miniSEED de 512 bytes cuyo contenido es un trozo del XML.
function infoStreams({ host, puerto }) {
    return new Promise((resolver, rechazar) => {
        const s = connect(puerto, host);
        s.setTimeout(120000, () => { s.destroy(); rechazar(new Error(`${host}: sin respuesta`)); });
        let bufer = Buffer.alloc(0), saludo = 0;
        const trozos = [];
        s.on('connect', () => s.write('HELLO\r\n'));
        s.on('error', rechazar);
        s.on('data', (d) => {
            bufer = Buffer.concat([bufer, d]);
            while (saludo < 2) {                         // dos líneas de saludo
                const i = bufer.indexOf('\r\n');
                if (i < 0) return;
                bufer = bufer.subarray(i + 2);
                if (++saludo === 2) s.write('INFO STREAMS\r\n');
            }
            while (bufer.length >= 520) {
                const cab = bufer.subarray(0, 8).toString(), reg = bufer.subarray(8, 520);
                bufer = bufer.subarray(520);
                if (cab.startsWith('ERROR')) { s.destroy(); return rechazar(new Error(`${host}: ${cab}`)); }
                const n = reg.readUInt16BE(30), ini = reg.readUInt16BE(44);
                trozos.push(reg.subarray(ini, ini + n));
                if (cab[7] !== '*') {                     // último paquete
                    s.end('BYE\r\n');
                    return resolver(Buffer.concat(trozos).toString('latin1'));
                }
            }
        });
    });
}

const fecha = (t) => new Date(t.replace(/\//g, '-').replace(' ', 'T').replace(/Z?$/, 'Z'));

async function main() {
    const consulta = new Date();
    const vivas = [];
    const resumen = {};

    for (const srv of SERVIDORES) {
        console.log(`${srv.nombre}: INFO STREAMS…`);
        const xml = await infoStreams(srv);
        const meta = new Map();
        const texto = await (await fetch(`${srv.fdsn}/station/1/query?minlat=${S}&maxlat=${N}` +
            `&minlon=${O}&maxlon=${E}&level=station&format=text&endafter=${consulta.toISOString().slice(0, 10)}`)).text();
        texto.split('\n').filter(l => l && !l.startsWith('#')).forEach(l => {
            const c = l.split('|');
            meta.set(`${c[0]}.${c[1]}`, { lat: +c[2], lon: +c[3], sitio: c[5] });
        });

        let enAnillo = 0, relojFuturo = 0, atrasadas = 0;
        for (const m of xml.matchAll(/<station name="([^"]+)" network="([^"]+)"[^>]*>([\s\S]*?)<\/station>/g)) {
            const [, sta, net, cuerpo] = m;
            const md = meta.get(`${net}.${sta}`);
            if (!md) continue;                            // fuera de la región
            enAnillo++;
            const canales = new Set();
            let ultimo = null;
            for (const st of cuerpo.matchAll(/seedname="([^"]+)" type="D" begin_time="[^"]+" end_time="([^"]+)"/g)) {
                const t = fecha(st[2]);
                // Algún datalogger trae el reloj en el año 2046: ese dato no cuenta.
                if (t - consulta > 5 * 60000) continue;
                canales.add(st[1]);
                if (!ultimo || t > ultimo) ultimo = t;
            }
            if (!ultimo) { relojFuturo++; continue; }
            const atraso = (consulta - ultimo) / 60000;
            if (atraso > ATRASO_MAXIMO) { atrasadas++; continue; }
            vivas.push({ red: net, codigo: sta, lat: +md.lat.toFixed(4), lon: +md.lon.toFixed(4), sitio: md.sitio.trim(),
                         servidor: srv.nombre, websocket: !!srv.websocket,
                         atrasoMin: +Math.max(0, atraso).toFixed(1), canales: [...canales].sort() });
        }
        resumen[srv.nombre] = { enRegion: enAnillo, enVivo: vivas.filter(v => v.servidor === srv.nombre).length,
                                atrasadas, relojFuturo };
        console.log(`  en la región: ${enAnillo} · en vivo: ${resumen[srv.nombre].enVivo} · atrasadas: ${atrasadas}`);
    }

    // Cruce con el registro del ISC: mismo código, a menos de ~5 km.
    console.log('Registro de estaciones del ISC…');
    const coords = `RECTANGLE,${N},${O},${N},${E},${S},${E},${S},${O},${N},${O}`;
    const html = await (await fetch('https://www.isc.ac.uk/cgi-bin/stations_iscb?stnsearch=RECT&stn_coordvals=' +
        encodeURIComponent(coords))).text();
    const isc = [];
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const td = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]*>/g, '').trim());
        if (td.length >= 11 && /^-?\d/.test(td[2])) isc.push({ codigo: td[1], lat: +td[2], lon: +td[3] });
    }
    vivas.forEach(v => {
        v.enIsc = isc.some(x => x.codigo === v.codigo && Math.abs(x.lat - v.lat) < 0.05 && Math.abs(x.lon - v.lon) < 0.05);
    });
    console.log(`  ${isc.length} filas · ${vivas.filter(v => v.enIsc).length} de ${vivas.length} en vivo figuran en él`);

    vivas.sort((a, b) => (a.red + a.codigo).localeCompare(b.red + b.codigo));
    await mkdir(join(RAIZ, 'estaciones'), { recursive: true });
    await writeFile(join(RAIZ, 'estaciones', 'tiempo-real.json'), JSON.stringify({
        region: { n: N, s: S, e: E, o: O },
        consultado: consulta.toISOString().slice(0, 16) + 'Z',
        atrasoMaximoMin: ATRASO_MAXIMO,
        servidores: SERVIDORES.map(({ nombre, host, puerto, websocket }) => ({ nombre, seedlink: `${host}:${puerto}`, websocket })),
        resumen,
        filasIsc: isc.length,
        nota: 'En vivo = último dato con menos de atrasoMaximoMin minutos en el anillo del servidor, ' +
            'a la hora de la consulta. Una foto: una estación puede caerse o volver después.',
        estaciones: vivas
    }, null, 1) + '\n', 'utf8');
    console.log(`\n${vivas.length} estaciones en vivo. Escrito estaciones/tiempo-real.json.`);
}

main().catch(e => { console.error(e); process.exit(1); });
