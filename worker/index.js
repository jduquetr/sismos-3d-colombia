// Worker de Cloudflare para el mismo sitio que se publica en Vercel.
// Sirve los archivos estáticos (copiados a dist/ por tools/preparar-dist.mjs) y
// reutiliza tal cual las funciones de api/, adaptando la interfaz req/res de
// Vercel a Request/Response de Workers.
import proxySgc from "../api/proxy-sgc.js";
import proxyIsc from "../api/proxy-isc.js";
import guardarEvento from "../api/guardar-evento.js";

const FUNCIONES = {
  "/api/proxy-sgc": proxySgc,
  "/api/proxy-isc": proxyIsc,
  "/api/guardar-evento": guardarEvento,
};

// En este despliegue la portada es el explorador de área.
const PORTADA = "/explorador-area.html";

async function ejecutarVercel(handler, request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  headers["x-forwarded-for"] = request.headers.get("cf-connecting-ip") || headers["x-forwarded-for"] || "";
  const req = {
    method: request.method,
    headers,
    query: Object.fromEntries(url.searchParams),
    body: ["GET", "HEAD", "OPTIONS"].includes(request.method) ? undefined : await request.text(),
  };

  let status = 200;
  let body = null;
  const outHeaders = new Headers();
  const res = {
    setHeader(k, v) { outHeaders.set(k, v); return res; },
    status(s) { status = s; return res; },
    json(obj) {
      outHeaders.set("Content-Type", "application/json; charset=utf-8");
      body = JSON.stringify(obj);
      return res;
    },
    send(data) { body = data; return res; },
    end(data) { if (data !== undefined) body = data; return res; },
  };

  await handler(req, res);
  return new Response(status === 204 ? null : body, { status, headers: outHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const funcion = FUNCIONES[url.pathname.replace(/\.js$/, "").replace(/\/$/, "")];
    if (funcion) {
      try {
        return await ejecutarVercel(funcion, request);
      } catch (err) {
        return Response.json({ error: `Error interno: ${err && err.message}` }, { status: 500 });
      }
    }
    if (url.pathname === "/") {
      url.pathname = PORTADA;
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
