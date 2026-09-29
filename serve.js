/* Servidor estático mínimo. Existe só porque a File System Access API
   exige contexto seguro (localhost) — os ficheiros do vault são
   escritos pelo browser, nunca por aqui. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4321;
const ROOT = __dirname;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const relative = decodeURIComponent(url.pathname) === '/'
        ? 'index.html'
        : decodeURIComponent(url.pathname).replace(/^\/+/, '');

    const file = path.join(ROOT, relative);

    // Impede sair da raiz do projeto
    if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('403 Forbidden');
        return;
    }

    fs.readFile(file, (error, data) => {
        if (error) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
            return;
        }

        res.writeHead(200, {
            'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        }).end(data);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`StudyJournal em http://${HOST}:${PORT}`);
});
