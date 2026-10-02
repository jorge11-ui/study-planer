/* Servidor do StudyJournal.
   1. Serve os ficheiros estáticos do site — em HTTPS quando existem
      cert.pem/key.pem gerados com mkcert, em HTTP caso contrário.
   2. Expõe uma API mínima de escrita no vault. A File System Access API
      só alcança a pasta do próprio aparelho, por isso noutros aparelhos
      quem escreve no Obsidian é este processo — o mesmo que corre no
      laptop onde está a pasta.

   Só aceita ficheiros de dia (YYYY-MM-DD.md) dentro de Diario/. */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const FOLDER = 'Diario';
const DAY_NAME = /^\d{4}-\d{2}-\d{2}\.md$/;
const CONFIG_NAME = /^(tasks|pdfs)\.json$/;
const MAX_BODY = 2 * 1024 * 1024;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.pem': 'application/x-pem-file',
};

/* ── Onde está o vault ───────────────────────────────────────
   VAULT_DIR tem prioridade. Senão lê a config do Obsidian e procura
   uma pasta Diario/ na raiz ou um nível abaixo — o site guarda em
   <algo>/Diario, que nem sempre é a própria raiz do vault. */
function findVaultBase() {
    if (process.env.VAULT_DIR) return path.resolve(process.env.VAULT_DIR);

    let config;
    try {
        const file = path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json');
        config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }

    const vaults = Object.values(config.vaults ?? {}).map((v) => v?.path).filter(Boolean);

    for (const base of vaults) {
        if (fs.existsSync(path.join(base, FOLDER))) return base;

        let children = [];
        try {
            children = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
        } catch {
            continue;
        }

        for (const child of children) {
            const nested = path.join(base, child.name);
            if (fs.existsSync(path.join(nested, FOLDER))) return nested;
        }
    }

    return vaults[0] ?? null;
}

const VAULT_BASE = findVaultBase();
const vaultFolder = () => (VAULT_BASE ? path.join(VAULT_BASE, FOLDER) : null);

function json(res, status, data) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    }).end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                req.destroy();
                reject(new Error('corpo demasiado grande'));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function api(req, res, url) {
    const route = url.pathname.slice('/api/vault'.length);

    if (route === '' && req.method === 'GET') {
        json(res, 200, { ok: Boolean(vaultFolder()) });
        return;
    }

    if (route === '/file' && req.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        if (!DAY_NAME.test(name) && !CONFIG_NAME.test(name)) return json(res, 400, { ok: false, reason: 'nome' });

        const folder = vaultFolder();
        if (!folder) return json(res, 503, { ok: false, reason: 'sem-vault' });

        try {
            const content = fs.readFileSync(path.join(folder, name), 'utf8');
            json(res, 200, { ok: true, existe: true, content });
        } catch (error) {
            if (error.code === 'ENOENT') return json(res, 200, { ok: true, existe: false });
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    if (route === '/file' && req.method === 'PUT') {
        const name = url.searchParams.get('name') ?? '';
        if (!DAY_NAME.test(name) && !CONFIG_NAME.test(name)) return json(res, 400, { ok: false, reason: 'nome' });

        const folder = vaultFolder();
        if (!folder) return json(res, 503, { ok: false, reason: 'sem-vault' });

        try {
            const body = await readBody(req);
            const { content } = JSON.parse(body);
            if (typeof content !== 'string') return json(res, 400, { ok: false, reason: 'conteudo' });

            const filePath = path.join(folder, name);
            fs.writeFileSync(filePath, content, 'utf8');
            json(res, 200, { ok: true, path: `${FOLDER}/${name}` });
        } catch (error) {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

function serveStatic(req, res, url) {
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
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
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${url.pathname}`);

    if (url.pathname === '/api/vault' || url.pathname.startsWith('/api/vault/')) {
        try {
            await api(req, res, url);
        } catch {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    serveStatic(req, res, url);
}

/* ── Arranque ────────────────────────────────────────────────
   HTTPS só se os certificados já existirem; caso contrário arranca
   em HTTP e avisa, para `npm start` não partir sem o mkcert. */
const certFile = path.join(ROOT, 'cert.pem');
const keyFile = path.join(ROOT, 'key.pem');
const secure = fs.existsSync(certFile) && fs.existsSync(keyFile);

const server = secure
    ? https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handle)
    : http.createServer(handle);

server.listen(PORT, HOST, () => {
    const scheme = secure ? 'https' : 'http';
    console.log(`StudyJournal em ${scheme}://${HOST}:${PORT}`);

    if (!secure) {
        console.log('  ! Sem cert.pem/key.pem — arrancou em HTTP.');
        console.log('    O vault remoto e os outros aparelhos querem HTTPS: corre o mkcert.');
    }

    console.log(`  Vault: ${VAULT_BASE ?? '(não encontrado — define VAULT_DIR)'}`);

    if (HOST === '0.0.0.0') {
        const { networkInterfaces } = require('node:os');
        for (const list of Object.values(networkInterfaces())) {
            for (const net of list ?? []) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`  Rede local: ${scheme}://${net.address}:${PORT}`);
                }
            }
        }
    }
});
