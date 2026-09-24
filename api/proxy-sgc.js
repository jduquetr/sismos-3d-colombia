// Proxy serverless para el catálogo actual de la Red Sismológica Nacional de
// Colombia (RSNC) del SGC — el mismo que consulta https://www.sgc.gov.co/sismos.
//
// Por qué existe: la API (https://apicatalogador.sgc.gov.co/api/events/search/)
// exige una cabecera Origin de sgc.gov.co ("Origin requerido." / 403 si no) y
// su CORS solo admite https://www.sgc.gov.co (verificado con curl). Desde el
// navegador no se puede llamar directo; esta función la llama servidor a
// servidor y devuelve un JSON compacto con CORS para el propio sitio.
//
// Cómo es la API (probado en vivo):
//   POST /api/events/search/?page=N&page_size=M   con cuerpo JSON de filtros:
//     utc_time_after, utc_time_before   (ISO)
//     magnitude_min, magnitude_max, depth_min, depth_max
//     lat_min, lat_max, lon_min, lon_max
//   page_size tiene tope real de 500 aunque se pida más. Ordena por fecha
//   descendente. Cobertura: desde 1993 (inicio de la RSNC) hasta hoy.
//   No tiene filtro radial: el modo círculo se consulta con el bbox
//   circunscrito y se recorta aquí por distancia.
//
// Parámetros esperados (mismos nombres FDSN que ya arma el cliente):
//   Modo bbox:    minlatitude, maxlatitude, minlongitude, maxlongitude
//   Modo círculo: latitude, longitude, maxradiuskm
//   starttime, endtime (AAAA-MM-DD), minmagnitude, limit
//
// Respuesta: { total, eventos: [{id, lat, lon, prof, mag, magType, time, place, status}] }
// `total` es el conteo del servidor (null en modo círculo: ahí el servidor
// cuenta el bbox, no el círculo).

const SGC_SEARCH = 'https://apicatalogador.sgc.gov.co/api/events/search/';
const PAGE_SIZE = 500;        // tope real del servidor
const MAX_LIMITE = 10000;     // 20 páginas: cabe holgado en el tiempo de una función
const CONCURRENCIA = 4;
const TIMEOUT_MS = 25000;
const KM_POR_GRADO = 111.32;

function num(v) {
    const n = Number(v);
    return v != null && v !== '' && isFinite(n) ? n : null;
}

function distanciaKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
}

async function pedirPagina(filtros, pagina, signal) {
    const res = await fetch(`${SGC_SEARCH}?page=${pagina}&page_size=${PAGE_SIZE}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // El balanceador del SGC (AWS WAF) rechaza con 403 el UA por defecto de Node.
            'User-Agent': 'Mozilla/5.0 (compatible; sismos-3d-colombia/1.0; +https://sismos-3d-colombia.vercel.app)',
            'Origin': 'https://www.sgc.gov.co',
            'Referer': 'https://www.sgc.gov.co/'
        },
        body: JSON.stringify(filtros),
        signal
    });
    // Página fuera de rango responde 404: se trata como vacía.
    if (res.status === 404 && pagina > 1) return { count: null, results: [] };
    if (!res.ok) throw new Error(`SGC respondió HTTP ${res.status}`);
    const j = await res.json();
    return { count: j.count, results: (j.results && j.results.results) || [] };
}

// "2026-09-23 23:57:21" en UTC -> ISO con Z
function isoUTC(s) {
    return typeof s === 'string' ? s.replace(' ', 'T') + 'Z' : null;
}

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Método no permitido. Usá GET.' }); return; }

    const q = req.query || {};
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(q.starttime || '') ? q.starttime : null;
    const fin = /^\d{4}-\d{2}-\d{2}$/.test(q.endtime || '') ? q.endtime : null;
    if (!inicio || !fin) { res.status(400).json({ error: 'Faltan starttime/endtime (AAAA-MM-DD).' }); return; }

    const limite = Math.min(Math.max(1, Math.floor(num(q.limit) || 500)), MAX_LIMITE);
    const filtros = {
        utc_time_after: `${inicio}T00:00:00Z`,
        utc_time_before: `${fin}T23:59:59Z`
    };
    const minmag = num(q.minmagnitude);
    if (minmag != null) filtros.magnitude_min = minmag;

    const cLat = num(q.latitude), cLon = num(q.longitude), radioKm = num(q.maxradiuskm);
    const circulo = cLat != null && cLon != null && radioKm != null ? { lat: cLat, lon: cLon, radioKm } : null;
    if (circulo) {
        const dLat = radioKm / KM_POR_GRADO;
        const dLon = radioKm / Math.max(KM_POR_GRADO * Math.cos(cLat * Math.PI / 180), 1);
        Object.assign(filtros, {
            lat_min: Math.max(-90, cLat - dLat), lat_max: Math.min(90, cLat + dLat),
            lon_min: Math.max(-180, cLon - dLon), lon_max: Math.min(180, cLon + dLon)
        });
    } else {
        const s = num(q.minlatitude), n = num(q.maxlatitude), o = num(q.minlongitude), e = num(q.maxlongitude);
        if (s != null) filtros.lat_min = s;
        if (n != null) filtros.lat_max = n;
        if (o != null) filtros.lon_min = o;
        if (e != null) filtros.lon_max = e;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const primera = await pedirPagina(filtros, 1, controller.signal);
        const total = primera.count || 0;
        // En modo círculo se descarta parte del bbox, así que hay que leer más
        // páginas de las que da `limite`; se lee hasta agotar el bbox o el tope.
        const paginasNecesarias = Math.ceil(Math.min(total, circulo ? MAX_LIMITE : limite) / PAGE_SIZE);
        const paginas = [primera.results];
        for (let p = 2; p <= paginasNecesarias; p += CONCURRENCIA) {
            const lote = [];
            for (let k = p; k < p + CONCURRENCIA && k <= paginasNecesarias; k++) {
                lote.push(pedirPagina(filtros, k, controller.signal));
            }
            for (const r of await Promise.all(lote)) paginas.push(r.results);
            if (circulo) {
                const dentro = paginas.flat().filter(e => distanciaKm(cLat, cLon, e.latitude, e.longitude) <= radioKm).length;
                if (dentro >= limite) break;
            }
        }
        clearTimeout(timer);

        const eventos = [];
        for (const e of paginas.flat()) {
            // La web del SGC oculta estos eventos anulados; aquí también.
            if (e.event_type === 'not existing') continue;
            if (circulo && distanciaKm(cLat, cLon, e.latitude, e.longitude) > radioKm) continue;
            eventos.push({
                id: e.id, lat: e.latitude, lon: e.longitude, prof: e.depth, mag: e.magnitude,
                magType: e.mag_type || null, time: isoUTC(e.utc_time),
                place: e.place || '', status: e.status || null
            });
            if (eventos.length >= limite) break;
        }

        res.status(200);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify({ total: circulo ? null : total, eventos }));
    } catch (err) {
        clearTimeout(timer);
        const esTimeout = err && err.name === 'AbortError';
        res.status(esTimeout ? 504 : 502).json({
            error: esTimeout
                ? `El SGC no respondió en ${TIMEOUT_MS / 1000}s (timeout). Probá acotando el área, las fechas o el límite.`
                : `Error consultando el SGC desde el proxy: ${err && err.message ? err.message : 'error desconocido'}.`
        });
    }
};
