/* Servidor do StudyJournal.
   1. Serve os ficheiros estáticos do site — em HTTPS quando existem
      cert.pem/key.pem gerados com mkcert, em HTTP caso contrário.
   2. Expõe uma API mínima de escrita no vault. A File System Access API
      só alcança a pasta do próprio aparelho, por isso noutros aparelhos
      quem escreve no Obsidian é este processo — o mesmo que corre no
      laptop onde está a pasta.

   Só aceita ficheiros de dia (YYYY-MM-DD.md) e configs (tasks/pdfs.json)
   dentro de Diario/. */

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
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
const SYNC_MAX_BODY = 8 * 1024 * 1024;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
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

function readBody(req, limite = MAX_BODY) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limite) {
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
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch {
                return json(res, 400, { ok: false, reason: 'conteudo' });
            }
            const { content } = parsed;
            if (typeof content !== 'string') return json(res, 400, { ok: false, reason: 'conteudo' });

            const filePath = path.join(folder, name);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
            json(res, 200, { ok: true, path: `${FOLDER}/${name}` });
        } catch (error) {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    if (route === '/dias-notas' && req.method === 'GET') {
        // Dias com notas (ficheiros .md não vazios) num mês — para o
        // Calendário mostrar o indicador também onde o localStorage é vazio.
        const mes = url.searchParams.get('mes') ?? '';
        if (!/^\d{4}-\d{2}$/.test(mes)) return json(res, 400, { ok: false, reason: 'conteudo' });

        const folder = vaultFolder();
        if (!folder) return json(res, 503, { ok: false, reason: 'sem-vault' });

        let ficheiros = [];
        try {
            ficheiros = fs.readdirSync(folder);
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        const dias = ficheiros.filter((f) => {
            if (!DAY_NAME.test(f) || !f.startsWith(`${mes}-`)) return false;
            try {
                return fs.statSync(path.join(folder, f)).size > 0;
            } catch {
                return false;
            }
        }).map((f) => f.slice(0, 10)).sort();
        json(res, 200, { ok: true, dias });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

/* ── Conta única + sync entre aparelhos ────────────────────
   Uma só conta (SYNC_USER/SYNC_PASS no ambiente) partilhada pelos
   aparelhos. O servidor guarda o documento canónico em data/sync.json
   com revisão (rev); pushes sobre revisões antigas são recusados (409)
   para o cliente fundir e repetir. Sessões em data/sessoes.json. */

const SYNC_USER = process.env.SYNC_USER || '';
const SYNC_PASS_HASH = SYNC_USER && process.env.SYNC_PASS
    ? crypto.createHash('sha256').update(String(process.env.SYNC_PASS), 'utf8').digest()
    : null;
const contaAtiva = Boolean(SYNC_USER && SYNC_PASS_HASH);

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SYNC_FILE = path.join(DATA_DIR, 'sync.json');
const SESSOES_FILE = path.join(DATA_DIR, 'sessoes.json');
const SESSAO_MS = 180 * 24 * 60 * 60 * 1000;
const LOGIN_JANELA_MS = 60 * 1000;
const LOGIN_MAX_TENTATIVAS = 12;

let syncDoc = { rev: 0, updatedAt: null, data: { days: {} } };
let sessoes = {};
const tentativasLogin = new Map();

try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
        const raw = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
        if (raw && typeof raw.rev === 'number' && raw.data && typeof raw.data === 'object') {
            syncDoc = { rev: raw.rev, updatedAt: raw.updatedAt ?? null, data: raw.data };
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.log('  ! sync.json ilegível, a começar do zero.');
    }
    try {
        const raw = JSON.parse(fs.readFileSync(SESSOES_FILE, 'utf8'));
        if (raw && typeof raw === 'object') sessoes = raw;
    } catch (error) {
        if (error.code !== 'ENOENT') console.log('  ! sessoes.json ilegível, a começar do zero.');
    }
} catch (error) {
    console.log(`  ! Não foi possível preparar ${DATA_DIR}: ${error.message}`);
}

function guardarSync() {
    const tmp = `${SYNC_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(syncDoc), { mode: 0o600 });
    fs.renameSync(tmp, SYNC_FILE);
}

function guardarSessoes() {
    fs.writeFileSync(SESSOES_FILE, JSON.stringify(sessoes), { mode: 0o600 });
}

function hashIguais(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function tokenDaSessao(req) {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    return m ? m[1].trim() : '';
}

function sessaoValida(token) {
    const s = sessoes[token];
    if (!s) return false;
    if (Date.now() - Number(s.criadoEm || 0) > SESSAO_MS) {
        delete sessoes[token];
        try { guardarSessoes(); } catch { /* segue */ }
        return false;
    }
    return true;
}

function podeTentarLogin(req) {
    const ip = req.socket.remoteAddress || '?';
    const agora = Date.now();
    for (const [chave, valor] of tentativasLogin) {
        if (agora - valor.desde > LOGIN_JANELA_MS) tentativasLogin.delete(chave);
    }
    const atual = tentativasLogin.get(ip) ?? { n: 0, desde: agora };
    if (atual.n >= LOGIN_MAX_TENTATIVAS) return false;
    tentativasLogin.set(ip, { n: atual.n + 1, desde: atual.desde });
    return true;
}

async function lerJsonBody(req, res, limite) {
    let parsed;
    try {
        parsed = JSON.parse(await readBody(req, limite));
    } catch {
        json(res, 400, { ok: false, reason: 'conteudo' });
        return null;
    }
    if (!parsed || typeof parsed !== 'object') {
        json(res, 400, { ok: false, reason: 'conteudo' });
        return null;
    }
    return parsed;
}

async function apiConta(req, res, url) {
    const route = url.pathname.slice('/api/conta'.length);

    if (route === '/estado' && req.method === 'GET') {
        json(res, 200, { ok: true, contaAtiva });
        return;
    }

    if (route === '/login' && req.method === 'POST') {
        if (!contaAtiva) return json(res, 503, { ok: false, reason: 'sem-conta' });
        if (!podeTentarLogin(req)) return json(res, 429, { ok: false, reason: 'demasiadas-tentativas' });

        const body = await lerJsonBody(req, res);
        if (!body) return;
        const user = String(body.user ?? '');
        const pass = String(body.pass ?? '');
        const passHash = crypto.createHash('sha256').update(pass, 'utf8').digest();

        if (user !== SYNC_USER || !hashIguais(passHash, SYNC_PASS_HASH)) {
            return json(res, 401, { ok: false, reason: 'credenciais' });
        }

        const token = crypto.randomBytes(48).toString('hex');
        sessoes[token] = { criadoEm: Date.now() };
        try {
            guardarSessoes();
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        json(res, 200, { ok: true, token });
        return;
    }

    if (route === '/sair' && req.method === 'POST') {
        const token = tokenDaSessao(req);
        if (token && sessoes[token]) {
            delete sessoes[token];
            try { guardarSessoes(); } catch { /* segue */ }
        }
        json(res, 200, { ok: true });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

function dadosSyncValidos(data) {
    return data && typeof data === 'object' && !Array.isArray(data)
        && data.days && typeof data.days === 'object' && !Array.isArray(data.days);
}

async function apiSync(req, res) {
    if (!contaAtiva) return json(res, 503, { ok: false, reason: 'sem-conta' });

    const token = tokenDaSessao(req);
    if (!sessaoValida(token)) return json(res, 401, { ok: false, reason: 'sessao' });

    if (req.method === 'GET') {
        json(res, 200, { ok: true, rev: syncDoc.rev, updatedAt: syncDoc.updatedAt, data: syncDoc.data });
        return;
    }

    if (req.method === 'PUT') {
        const body = await lerJsonBody(req, res, SYNC_MAX_BODY);
        if (!body) return;
        const baseRev = Number(body.baseRev);
        if (!Number.isInteger(baseRev) || baseRev < 0 || !dadosSyncValidos(body.data)) {
            return json(res, 400, { ok: false, reason: 'conteudo' });
        }
        if (baseRev !== syncDoc.rev) {
            return json(res, 409, {
                ok: false, reason: 'conflito',
                rev: syncDoc.rev, updatedAt: syncDoc.updatedAt, data: syncDoc.data,
            });
        }
        syncDoc = { rev: syncDoc.rev + 1, updatedAt: new Date().toISOString(), data: body.data };
        try {
            guardarSync();
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        json(res, 200, { ok: true, rev: syncDoc.rev, updatedAt: syncDoc.updatedAt });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

/* ── Ficheiros (bytes dos PDFs) ────────────────────────
   Os metadados vão no vault (pdfs.json, texto); os bytes vêm para cá
   porque o vault só aceita texto. GET faz download on-demand para o
   outro aparelho; tudo best-effort como o resto do sync. */

const FICHEIROS_DIR = path.join(DATA_DIR, 'ficheiros');
const FICHEIROS_MAX_BYTES = 30 * 1024 * 1024;
const FICHEIRO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

try {
    fs.mkdirSync(FICHEIROS_DIR, { recursive: true });
} catch (error) {
    console.log(`  ! Não foi possível preparar ${FICHEIROS_DIR}: ${error.message}`);
}

function caminhoFicheiro(id) {
    return path.join(FICHEIROS_DIR, id);
}

async function apiFicheiros(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/ficheiros') {
        const body = await lerJsonBody(req, res, FICHEIROS_MAX_BYTES + 1024 * 1024);
        if (!body) return;
        const id = String(body.id ?? '');
        const nome = String(body.nome ?? 'ficheiro.pdf').slice(0, 200);
        const tipo = String(body.tipo ?? 'application/pdf').slice(0, 100);
        const dados = String(body.dados ?? '');
        if (!FICHEIRO_ID.test(id) || !dados) {
            return json(res, 400, { ok: false, reason: 'conteudo' });
        }
        let bytes;
        try {
            bytes = Buffer.from(dados, 'base64');
        } catch {
            return json(res, 400, { ok: false, reason: 'conteudo' });
        }
        if (!bytes.length || bytes.length > FICHEIROS_MAX_BYTES) {
            return json(res, 413, { ok: false, reason: 'demasiado-grande' });
        }
        try {
            fs.writeFileSync(caminhoFicheiro(id), bytes, { mode: 0o600 });
            fs.writeFileSync(`${caminhoFicheiro(id)}.meta.json`, JSON.stringify({ nome, tipo, tamanho: bytes.length }), { mode: 0o600 });
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        json(res, 200, { ok: true, id, tamanho: bytes.length });
        return;
    }

    const m = /^\/api\/ficheiros\/([^/]+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { ok: false, reason: 'rota' });
    const id = decodeURIComponent(m[1]);
    if (!FICHEIRO_ID.test(id)) return json(res, 400, { ok: false, reason: 'nome' });

    if (req.method === 'GET') {
        let meta = { nome: 'ficheiro.pdf', tipo: 'application/pdf' };
        try {
            meta = { ...meta, ...JSON.parse(fs.readFileSync(`${caminhoFicheiro(id)}.meta.json`, 'utf8')) };
        } catch { /* segue com o genérico */ }
        let bytes;
        try {
            bytes = fs.readFileSync(caminhoFicheiro(id));
        } catch (error) {
            if (error.code === 'ENOENT') return json(res, 404, { ok: false, reason: 'ausente' });
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        res.writeHead(200, {
            'content-type': String(meta.tipo || 'application/pdf'),
            'content-length': bytes.length,
            'content-disposition': `inline; filename="${String(meta.nome || 'ficheiro.pdf').replace(/"/g, '')}"`,
            'cache-control': 'private, max-age=86400',
        }).end(bytes);
        return;
    }

    if (req.method === 'DELETE') {
        try { fs.unlinkSync(caminhoFicheiro(id)); } catch { /* já não existe */ }
        try { fs.unlinkSync(`${caminhoFicheiro(id)}.meta.json`); } catch { /* já não existe */ }
        json(res, 200, { ok: true, id });
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

    if (url.pathname === '/api/conta' || url.pathname.startsWith('/api/conta/')) {
        try {
            await apiConta(req, res, url);
        } catch {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    if (url.pathname === '/api/sync') {
        try {
            await apiSync(req, res);
        } catch {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

    if (url.pathname === '/api/ficheiros' || url.pathname.startsWith('/api/ficheiros/')) {
        try {
            await apiFicheiros(req, res, url);
        } catch {
            json(res, 500, { ok: false, reason: 'erro' });
        }
        return;
    }

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
    if (contaAtiva) {
        console.log(`  Conta: ativa (utilizador "${SYNC_USER}") — entra nos aparelhos com estes dados.`);
    } else {
        console.log('  Conta: por configurar — define SYNC_USER e SYNC_PASS para sync entre aparelhos.');
    }

    if (HOST === '0.0.0.0') {
        for (const list of Object.values(os.networkInterfaces())) {
            for (const net of list ?? []) {
                if (net.family === 'IPv4' && !net.internal) {
                    console.log(`  Rede local: ${scheme}://${net.address}:${PORT}`);
                }
            }
        }
    }
});
