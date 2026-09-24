// Proxy serverless para el catálogo de la Red Sismológica Nacional de Colombia
// (SGC), el de la página de consulta experta:
// https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta_Seiscomp/
//
// Por qué existe, y por qué hace tres pasos en vez de uno:
//
//   1. Ese catálogo no tiene API. Es un formulario que hace POST a consulta_sismo.php,
//      guarda el resultado del lado del servidor y devuelve una página con el id de la
//      consulta. Las fechas van en dd/mm/aaaa (probado: cualquier otro formato hace que
//      la página conteste con un error de MySQL y cero registros) y el modo de área es
//      ubi=cuadrante.
//   2. Con ese id, generar_kml.php?id=N devuelve TODOS los eventos en KML. No pide
//      sesión ni cookie: basta el id.
//   3. El KML se convierte aquí a filas compactas. Así el navegador no se baja megas de
//      XML ni tiene que parsearlo: la consulta de un año de Colombia entera son ~3 MB
//      de KML que aquí quedan en unos 300 KB de JSON.
//
// Además el servidor del SGC no manda cabeceras CORS, así que desde el navegador no se
// puede llamar directo de ninguna forma.
//
// Cobertura: 1 de marzo de 2018 hasta hoy (el periodo procesado con SeisComP). Lo
// anterior está en el catálogo histórico que la app ya consulta por otra vía.
//
// Parámetros (GET):
//   n, s, e, o          bbox en grados
//   desde, hasta        AAAA-MM-DD
//   magmin, magmax      magnitud (por defecto 0 y 9)
//   profmin, profmax    profundidad en km (por defecto 0 y 700)

const BASE = 'https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta_Seiscomp';
// El servidor del SGC es lento con ventanas grandes: un año de Colombia entera tarda
// ~19 s y el catálogo completo pasa de 160 s. Se corta antes de que lo haga la
// plataforma, para poder explicar qué pasó en vez de devolver un 504 pelado.
const TIMEOUT_MS = 50000;

const COLUMNAS = ['id', 'tiempo', 'lat', 'lon', 'prof', 'mag', 'region'];

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Método no permitido. Usá GET.' }); return; }

    const q = req.query || {};
    const num = (v, def) => (v == null || v === '' || !isFinite(Number(v)) ? def : Number(v));
    const bbox = { n: num(q.n, null), s: num(q.s, null), e: num(q.e, null), o: num(q.o, null) };
    if ([bbox.n, bbox.s, bbox.e, bbox.o].some(v => v == null)) {
        res.status(400).json({ error: 'Faltan las coordenadas del área (n, s, e, o).' });
        return;
    }
    const aDDMMAAAA = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
    };
    const desde = aDDMMAAAA(q.desde), hasta = aDDMMAAAA(q.hasta);
    if (!desde || !hasta) {
        res.status(400).json({ error: 'Las fechas van como AAAA-MM-DD en desde y hasta.' });
        return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        // --- 1. la consulta, que devuelve un id ---
        const cuerpo = new URLSearchParams({
            inicial: desde, final: hasta, ubi: 'cuadrante',
            longitudStart: String(bbox.o), longitudEnd: String(bbox.e),
            latitudStart: String(bbox.s), latitudEnd: String(bbox.n),
            magnitudStart: String(num(q.magmin, 0)), magnitudEnd: String(num(q.magmax, 9)),
            depthStart: String(num(q.profmin, 0)), depthEnd: String(num(q.profmax, 700)),
            Submit: 'Consultar'
        });
        const rConsulta = await fetch(`${BASE}/consulta_sismo.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: cuerpo,
            signal: controller.signal
        });
        if (!rConsulta.ok) throw new Error(`la consulta respondió HTTP ${rConsulta.status}`);
        const html = await rConsulta.text();

        const id = (html.match(/generar_kml\.php\?id=(\d+)/) || [])[1];
        const totalTxt = (html.match(/Total de registros:<\/font>\s*<\/B><\/FONT><\/td>([\s\S]*?)<\/tr>/i) || [])[1] || '';
        const total = Number((totalTxt.replace(/<[^>]+>/g, '').match(/\d+/) || [])[0]);
        if (/Warning|mysql_/i.test(totalTxt)) throw new Error('el catálogo rechazó los parámetros de la consulta');
        if (!id) throw new Error('la consulta no devolvió un identificador de resultado');
        if (total === 0) {
            clearTimeout(timer);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.status(200).json({ fuente: 'SGC · RSNC', total: 0, columnas: COLUMNAS, filas: [] });
            return;
        }

        // --- 2. el KML con los eventos ---
        const rKml = await fetch(`${BASE}/generar_kml.php?id=${id}`, { signal: controller.signal });
        if (!rKml.ok) throw new Error(`el KML respondió HTTP ${rKml.status}`);
        const kml = await rKml.text();
        clearTimeout(timer);

        // --- 3. KML a filas ---
        const filas = [];
        let descartados = 0;
        const re = /<Placemark[^>]*?(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/Placemark>/g;
        let m;
        while ((m = re.exec(kml)) !== null) {
            const idEvento = m[1] || null;
            const bloque = m[2];
            const desc = (bloque.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
            const coords = (bloque.match(/<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)/) || []);
            const fecha = (desc.match(/Fecha Hora UTC:\s*([\d]{4}-[\d]{2}-[\d]{2}[ T][\d:]{8})/) || [])[1];
            const mag = (desc.match(/Magnitud:\s*([\d.]+)/) || [])[1];
            const prof = (desc.match(/Profundidad:\s*([\d.]+)/) || [])[1];
            const region = ((desc.match(/Region:\s*([\s\S]*?)\s*Fecha Hora UTC:/) || [])[1] || '').trim();

            const lon = Number(coords[1]), lat = Number(coords[2]);
            const t = fecha ? Date.parse(fecha.replace(' ', 'T') + 'Z') : NaN;
            if (![lon, lat, Number(mag), Number(prof)].every(Number.isFinite) || !Number.isFinite(t)) {
                descartados++;
                continue;
            }
            filas.push([idEvento, t, +lat.toFixed(4), +lon.toFixed(4),
                        +Math.abs(Number(prof)).toFixed(1), +Number(mag).toFixed(1), region]);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(200).json({
            fuente: 'SGC · RSNC (revisado por analistas)',
            consulta: { bbox, desde: q.desde, hasta: q.hasta, idSGC: Number(id) },
            total: Number.isFinite(total) ? total : filas.length,
            descartados,
            columnas: COLUMNAS,
            filas
        });
    } catch (err) {
        clearTimeout(timer);
        const esTimeout = err && err.name === 'AbortError';
        res.status(504).json({
            error: esTimeout
                ? `El catálogo del SGC no respondió en ${TIMEOUT_MS / 1000}s. Su servidor se pone muy lento con ventanas grandes ` +
                  '(un año de todo el país tarda cerca de 20 s y el catálogo completo pasa de dos minutos): acotá el área, ' +
                  'el rango de fechas o subí la magnitud mínima.'
                : `Error consultando el catálogo del SGC: ${err && err.message ? err.message : 'error desconocido'}.`
        });
    }
};
