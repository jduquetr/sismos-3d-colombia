// Copia a dist/ solo los archivos públicos del sitio para el despliegue en
// Cloudflare Workers. Publicar la raíz del repo subiría también node_modules,
// .git, tools/ y el código de api/.
import { cpSync, readdirSync, rmSync } from "node:fs";

const EXCLUIR = new Set([
  ".git", ".gitignore", ".wrangler", "node_modules", "dist",
  "api", "tools", "worker",
  "package.json", "package-lock.json", "bun.lock", "bun.lockb",
  "vercel.json", "wrangler.jsonc", "README.md",
]);

rmSync("dist", { recursive: true, force: true });
for (const nombre of readdirSync(".")) {
  if (!EXCLUIR.has(nombre)) cpSync(nombre, `dist/${nombre}`, { recursive: true });
}
console.log("dist/ listo:", readdirSync("dist").join(", "));
