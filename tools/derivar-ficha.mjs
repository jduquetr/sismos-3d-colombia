// De un id de evento de USGS a una ficha de la biblioteca.
//
// Este módulo lo usan los DOS lados, para que la regla viva en un solo sitio:
//   - tools/snapshot-eventos.mjs --add <id>   (agrega la ficha al repo)
//   - explorador-area.html                    (import() dinámico, carga suelta por id)
//
// El feed de detalle de USGS, https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/<id>.geojson,
// redirige a fdsnws/event/1/query?eventid=<id>&format=geojson — es el mismo objeto.
// De ahí salen hora, epicentro, profundidad, magnitud, lugar y el tensor.
//
// Lo que NO está en el feed es el área ni la ventana de tiempo que uno quiere mirar,
// así que se estiman de la magnitud. Son un punto de partida razonable, no la zona de
// réplicas real de ese sismo: para una figura publicable, revisa y ajusta la ficha.

export const URL_DETALLE = (id) =>
    `https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${encodeURIComponent(id)}.geojson`;

// Longitud de ruptura esperada (km) para una magnitud dada: log10(L) ≈ 0.5M − 1.8,
// del escalamiento clásico magnitud–longitud (orden de magnitud, no un valor exacto).
export function longitudRupturaKm(mag) {
    return Math.pow(10, 0.5 * mag - 1.8);
}

const KM_POR_GRADO_LAT = 111.32;
const redondear = (v, n = 2) => Number(v.toFixed(n));

// Caja centrada en el epicentro, con semiancho en km convertido a grados.
function cajaAlrededor(lat, lon, semiKm) {
    const dLat = semiKm / KM_POR_GRADO_LAT;
    const dLon = semiKm / (KM_POR_GRADO_LAT * Math.cos(lat * Math.PI / 180));
    return {
        n: redondear(Math.min(90, lat + dLat)),
        s: redondear(Math.max(-90, lat - dLat)),
        o: redondear(lon - dLon),
        e: redondear(lon + dLon)
    };
}

export function tensorDesdeDetalle(detalle) {
    const props = detalle.properties || {};
    const prod = (props.products || {})['moment-tensor'];
    if (!prod || !prod.length) return null;
    const q = prod[0].properties || {};
    const n = (k) => Number(q[k]);
    const T = {
        lat: n('derived-latitude'), lon: n('derived-longitude'), depth: n('derived-depth'),
        mag: n('derived-magnitude') || Number(props.mag),
        scalarMoment: n('scalar-moment'),
        mrr: n('tensor-mrr'), mtt: n('tensor-mtt'), mpp: n('tensor-mpp'),
        mrt: n('tensor-mrt'), mrp: n('tensor-mrp'), mtp: n('tensor-mtp'),
        fuente: q['beachball-source'] || 'us',
        revision: q['review-status'] || null,
        dobleParejaPct: q['percent-double-couple'] != null ? n('percent-double-couple') * 100 : null,
        planoA: { strike: n('nodal-plane-1-strike'), dip: n('nodal-plane-1-dip'), rake: n('nodal-plane-1-rake') }
    };
    const completo = ['lat', 'lon', 'depth', 'scalarMoment', 'mrr', 'mtt', 'mpp', 'mrt', 'mrp', 'mtp']
        .every(k => Number.isFinite(T[k]));
    return completo ? T : null;
}

// id legible y estable: lugar + fecha (choco-2026-08-10), con el id de USGS de reserva.
export function idFicha(detalle) {
    const p = detalle.properties || {};
    const fecha = new Date(p.time).toISOString().slice(0, 10);
    const lugar = String(p.place || detalle.id || '')
        .split(/,| of /).pop()
        .trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${lugar || detalle.id}-${fecha}`;
}

export function fichaDesdeDetalle(detalle, opciones = {}) {
    const p = detalle.properties || {};
    const [lon, lat, prof] = (detalle.geometry || {}).coordinates || [];
    const mag = Number(p.mag);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) {
        throw new Error('The event feed has no usable location or magnitude.');
    }

    // Secuencia: 2 longitudes de ruptura alrededor del epicentro, acotado a algo
    // que se pueda mirar (50–400 km de semiancho). Contexto: el triple.
    const L = longitudRupturaKm(mag);
    const semiSecuencia = Math.min(400, Math.max(50, 2 * L));
    const fecha = new Date(p.time);
    const desde = new Date(fecha.getTime() - 30 * 864e5).toISOString().slice(0, 10);
    const nombreLugar = p.place || detalle.id;

    return {
        id: opciones.id || idFicha(detalle),
        nombre: `${nombreLugar} — M${mag.toFixed(1)} (${fecha.toISOString().slice(0, 10)})`,
        lugar: nombreLugar,
        fecha: fecha.toISOString().replace('.000', ''),
        mag: redondear(mag, 1),
        magTipo: p.magType || '',
        profundidad: Number.isFinite(prof) ? redondear(Math.abs(prof), 1) : null,
        usgsId: detalle.id,
        resumen: opciones.resumen ||
            `Loaded from the USGS event feed. Area and time window are derived from the magnitude ` +
            `(rupture length ≈ ${L.toFixed(0)} km): sequence within ±${semiSecuencia.toFixed(0)} km of the ` +
            `epicentre, regional context three times wider. Adjust the card if your case needs another framing.`,
        contexto: {
            fuenteId: 'usgs',
            bbox: cajaAlrededor(lat, lon, semiSecuencia * 3),
            inicio: '1900-01-01', fin: null, minmag: 4, limite: 2000
        },
        consulta: {
            fuenteId: 'usgs',
            bbox: cajaAlrededor(lat, lon, semiSecuencia),
            inicio: desde, fin: null, minmag: 2.5, limite: 2000
        },
        estilo: { colorInicial: '#ffd166', colorFinal: '#9d0208', escala: 22, opacidad: 100 },
        tensor: tensorDesdeDetalle(detalle)
    };
}
