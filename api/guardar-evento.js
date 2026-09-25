// Publica un evento especial en la biblioteca compartida, commiteándolo al repo.
//
// Por qué existe: el navegador no puede escribir en el repo, y una clave comparada
// en el navegador no protege nada — el código se descarga, la clave con él. Aquí la
// comparación ocurre en el servidor contra CLAVE_EVENTOS, una variable de entorno que
// nunca viaja al cliente. Lo único que manda el navegador es lo que la persona escribe.
//
// Variables de entorno (en Vercel, no en el repo):
//   CLAVE_EVENTOS   la frase que autoriza a publicar
//   GITHUB_TOKEN    token de GitHub con acceso SOLO a este repo y permiso Contents: write
//   GITHUB_REPO     opcional, "usuario/repo" (por defecto jduquetr/sismos-3d-colombia)
//
// Acciones (POST con JSON):
//   { accion: 'verificar', clave }                     → dice si la clave es correcta
//   { accion: 'publicar', clave, ficha, instantanea }  → un commit con los dos archivos
//
// Lo que este endpoint NO puede evitar, y conviene tener presente: es público, así que
// cualquiera puede intentar. Por eso hay límite de intentos por IP, una espera fija en
// cada intento (que hace inviable probar a ciegas), topes de tamaño y validación de la
// forma de los datos. Y todo lo que se publique queda público en el repo.

const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'jduquetr/sismos-3d-colombia';
const RAMA = 'main';
const API = 'https://api.github.com';

const MAX_FILAS = 20000;
const MAX_BYTES_INSTANTANEA = 3_000_000;
const MAX_BYTES_FICHA = 20_000;
const ID_VALIDO = /^[a-z0-9][a-z0-9-]{2,60}$/;

// Límite de intentos. En serverless las instancias se reciclan, así que esto es un
// freno parcial; el freno de verdad es la espera fija de abajo más una clave larga.
const intentos = new Map();
const VENTANA_MS = 10 * 60 * 1000;
const MAX_INTENTOS = 8;

function ipDe(req) {
    const h = req.headers || {};
    return (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || 'desconocida';
}

function demasiadosIntentos(ip) {
    const ahora = Date.now();
    const reg = intentos.get(ip);
    if (!reg || ahora > reg.hasta) { intentos.set(ip, { n: 1, hasta: ahora + VENTANA_MS }); return false; }
    reg.n++;
    return reg.n > MAX_INTENTOS;
}

// Comparación en tiempo constante: se hashea para igualar longitudes y no filtrar,
// por el tiempo de respuesta, cuántos caracteres acertó quien prueba.
function claveCorrecta(recibida) {
    const esperada = process.env.CLAVE_EVENTOS;
    if (!esperada) return null;                 // no configurada
    const a = crypto.createHash('sha256').update(String(recibida || '')).digest();
    const b = crypto.createHash('sha256').update(esperada).digest();
    return crypto.timingSafeEqual(a, b);
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// El nombre y el resumen de una ficha se muestran en la página de todo el mundo: si
// entra HTML, entra código ajeno. Se limpian aquí, además de escaparse al pintar.
function limpiarTexto(v, maxLargo) {
    return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, maxLargo);
}

function validarPublicacion(ficha, instantanea) {
    if (!ficha || !instantanea) return 'Faltan la ficha o la instantánea.';
    if (!ID_VALIDO.test(String(ficha.id || ''))) return 'El id debe ser minúsculas, números y guiones (3 a 61 caracteres).';
    if (ficha.id !== instantanea.id) return 'El id de la ficha y el de la instantánea no coinciden.';
    if (!String(ficha.nombre || '').trim()) return 'La ficha no tiene nombre.';

    const filas = ((instantanea.contexto && instantanea.contexto.filas) || []).length +
                  ((instantanea.evento && instantanea.evento.filas) || []).length;
    if (!filas) return 'La instantánea no trae eventos.';
    if (filas > MAX_FILAS) return `La instantánea trae ${filas} eventos; el tope son ${MAX_FILAS}.`;
    if (JSON.stringify(instantanea).length > MAX_BYTES_INSTANTANEA) return 'La instantánea pesa más de 3 MB.';
    if (JSON.stringify(ficha).length > MAX_BYTES_FICHA) return 'La ficha pesa más de 20 KB.';
    return null;
}

async function gh(ruta, opciones = {}) {
    const res = await fetch(`${API}${ruta}`, {
        ...opciones,
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'sismos-3d-colombia',
            ...(opciones.body ? { 'Content-Type': 'application/json' } : {})
        }
    });
    const texto = await res.text();
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch (e) { cuerpo = texto; }
    if (!res.ok) {
        const detalle = (cuerpo && cuerpo.message) || res.status;
        throw new Error(`GitHub respondió ${res.status}: ${detalle}`);
    }
    return cuerpo;
}

// Un solo commit con los dos archivos, por la Git Data API: así se dispara un único
// despliegue y el repo nunca queda con la instantánea sin su ficha.
async function publicar(ficha, instantanea) {
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${RAMA}`);
    const commitPadre = await gh(`/repos/${REPO}/git/commits/${ref.object.sha}`);

    const libreriaArchivo = await gh(`/repos/${REPO}/contents/eventos/libreria.json?ref=${RAMA}`);
    const libreria = JSON.parse(Buffer.from(libreriaArchivo.content, 'base64').toString('utf8'));
    libreria.eventos = (libreria.eventos || []).filter(f => f.id !== ficha.id).concat([ficha]);

    const blobs = {};
    for (const [ruta, contenido] of [
        [`eventos/${ficha.id}.json`, JSON.stringify(instantanea)],
        ['eventos/libreria.json', JSON.stringify(libreria, null, 2) + '\n']
    ]) {
        const blob = await gh(`/repos/${REPO}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: Buffer.from(contenido, 'utf8').toString('base64'), encoding: 'base64' })
        });
        blobs[ruta] = blob.sha;
    }

    const arbol = await gh(`/repos/${REPO}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({
            base_tree: commitPadre.tree.sha,
            tree: Object.entries(blobs).map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha }))
        })
    });

    const commit = await gh(`/repos/${REPO}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({
            message: `Biblioteca: agrega el evento especial "${ficha.nombre}"\n\nPublicado desde el visor.`,
            tree: arbol.sha,
            parents: [ref.object.sha]
        })
    });

    await gh(`/repos/${REPO}/git/refs/heads/${RAMA}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha })
    });
    return commit.sha;
}

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Usá POST.' }); return; }

    const cuerpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { accion, clave, ficha, instantanea } = cuerpo;

    if (!process.env.CLAVE_EVENTOS || !process.env.GITHUB_TOKEN) {
        res.status(503).json({
            error: 'Publicar en la biblioteca compartida no está configurado en este despliegue ' +
                '(faltan CLAVE_EVENTOS o GITHUB_TOKEN). Se puede guardar igual en este navegador.'
        });
        return;
    }

    const ip = ipDe(req);
    if (demasiadosIntentos(ip)) {
        res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
        return;
    }

    // Espera fija en cada intento: no molesta a quien sabe la clave y hace inviable
    // probar a ciegas.
    await esperar(700);

    if (!claveCorrecta(clave)) {
        res.status(401).json({ error: 'Clave incorrecta.' });
        return;
    }

    if (accion === 'verificar') {
        res.status(200).json({ ok: true });
        return;
    }
    if (accion !== 'publicar') {
        res.status(400).json({ error: 'Acción desconocida.' });
        return;
    }

    const problema = validarPublicacion(ficha, instantanea);
    if (problema) { res.status(400).json({ error: problema }); return; }

    const fichaLimpia = {
        ...ficha,
        nombre: limpiarTexto(ficha.nombre, 120),
        lugar: limpiarTexto(ficha.lugar, 160),
        resumen: limpiarTexto(ficha.resumen, 1200),
        magTipo: limpiarTexto(ficha.magTipo, 12)
    };

    const instantaneaLimpia = { ...instantanea, nombre: limpiarTexto(instantanea.nombre, 120) };

    try {
        const sha = await publicar(fichaLimpia, instantaneaLimpia);
        res.status(200).json({
            ok: true, commit: sha,
            mensaje: 'Publicado en la biblioteca compartida. Vercel vuelve a desplegar en un minuto.'
        });
    } catch (err) {
        res.status(502).json({ error: `No se pudo publicar: ${err && err.message ? err.message : 'error desconocido'}` });
    }
};
