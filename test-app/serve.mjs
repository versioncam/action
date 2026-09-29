/**
 * Serves the test app on http://localhost:4173, and nothing else.
 *
 * Forty lines of node:http rather than a dev server, so the Action's own
 * test needs no dependency but versioncam. Only the page's three files are
 * served: node_modules and .versioncam sit in this directory too, and a
 * server that walked the path it was asked for would serve them.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4173);

const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const file = Object.hasOwn(FILES, pathname) ? FILES[pathname] : undefined;
  if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found\n");
    return;
  }
  const body = await readFile(new URL(file[0], import.meta.url));
  // no-store: a clip must see the page as it is on disk now, never a copy.
  response.writeHead(200, { "content-type": file[1], "cache-control": "no-store" });
  response.end(request.method === "HEAD" ? undefined : body);
});

// The recorder stops what it started with SIGTERM, which ends this process.
server.listen(PORT, "localhost", () => {
  console.log(`test app on http://localhost:${PORT}`);
});
