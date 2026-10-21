// Serves this folder under /learn-home-rover/, the same path GitHub Pages uses.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const port = +(process.env.PORT || 8123);
createServer(async (req, res) => {
	const url = decodeURIComponent(req.url.split("?")[0]);
	if (!url.startsWith("/learn-home-rover/")) { res.writeHead(404); return res.end(); }
	let p = normalize(url.slice("/learn-home-rover/".length) || "index.html");
	if (p.endsWith("/")) p += "index.html";
	if (p.startsWith("..")) { res.writeHead(403); return res.end(); }
	try {
		const body = await readFile(join(root, p));
		res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
		res.end(body);
	} catch { res.writeHead(404); res.end(); }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/learn-home-rover/`));
