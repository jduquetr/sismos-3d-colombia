// Proxy serverless para el Boletín ISC (https://www.isc.ac.uk/fdsnws/event/1/).
//
// Por qué existe: el servicio FDSN de ISC no manda cabeceras CORS (confirmado
// con `curl -I` y con un preflight OPTIONS que devuelve 405), así que no se
// puede llamar directo desde el navegador. Esta función corre en Vercel,
// arma la URL real de ISC del lado del servidor (sin restricción de CORS
// porque es servidor a servidor) y devuelve la respuesta tal cual al cliente,
// agregando las cabeceras CORS que sí necesita el propio front del sitio.
//
// Parámetros esperados (los mismos que ya arma el cliente para USGS):
//   endpoint       'query' o 'count' (default 'query')
//   Modo bbox:    minlatitude, maxlatitude, minlongitude, maxlongitude
//   Modo círculo: latitude, longitude, maxradius (en GRADOS — ISC no admite
//                 maxradiuskm, probado: error 400 "not a valid FDSN option")
//   starttime, endtime
//   minmagnitude
//   limit          (solo aplica a 'query')
//
// ISC no soporta format=geojson para este método (probado, error 400) — el
// formato de salida siempre es texto plano pipe-delimited, que el cliente
// normaliza con normalizarISC(). Ese formato ya está documentado en el propio
// front (ver función normalizarISC en explorador-area.html).

const ISC_BASE = 'https://www.isc.ac.uk/fdsnws/event/1/';
const TIMEOUT_MS = 25000; // margen bajo el límite típico de una función serverless en Vercel

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método no permitido. Usá GET.' });
        return;
    }

    const query = req.query || {};
    const endpoint = (query.endpoint === 'count') ? 'count' : 'query';

    const params = new URLSearchParams();
    // format=text: ISC no soporta geojson en este método (verificado en vivo).
    params.set('format', 'text');
    for (const clave of ['minlatitude', 'maxlatitude', 'minlongitude', 'maxlongitude',
                          'latitude', 'longitude', 'maxradius',
                          'starttime', 'endtime', 'minmagnitude']) {
        if (query[clave] != null && query[clave] !== '') params.set(clave, String(query[clave]));
    }
    if (endpoint === 'query' && query.limit != null && query.limit !== '') {
        params.set('limit', String(query.limit));
    }

    const url = `${ISC_BASE}${endpoint}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const upstream = await fetch(url, { signal: controller.signal });
        const texto = await upstream.text();
        clearTimeout(timer);

        res.status(upstream.status);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(texto);
    } catch (err) {
        clearTimeout(timer);
        const esTimeout = err && err.name === 'AbortError';
        res.status(504).json({
            error: esTimeout
                ? `ISC no respondió en ${TIMEOUT_MS / 1000}s (timeout). El boletín ISC puede ser lento en consultas amplias — probá acotando el área, el rango de fechas o el límite.`
                : `Error consultando ISC desde el proxy: ${err && err.message ? err.message : 'error desconocido'}.`
        });
    }
};
