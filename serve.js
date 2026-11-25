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
const { createStore } = require('./db/store');
const { createWorkspace } = require('./lib/workspace');
const { dadosSyncValidos, fundirSyncData } = require('./lib/sync-merge');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const FOLDER = 'Diario';
const DAY_NAME = /^\d{4}-\d{2}-\d{2}\.md$/;
const CONFIG_NAME = /^(tasks|pdfs|whiteboard)\.json$/;
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
    '.woff2': 'font/woff2',
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
    if (res.headersSent) {
        try { res.end(); } catch { /* já fechado */ }
        return;
    }
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
    }).end(JSON.stringify(data));
}

/* Resposta de erro que nunca rebenta com "headers already sent". */
function erroInterno(res) {
    if (res.headersSent) {
        try { res.end(); } catch { /* já fechado */ }
        return;
    }
    json(res, 500, { ok: false, reason: 'erro' });
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
    if (!(await autorizarDados(req, res))) return;

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

            const folder = vaultFolder();
            if (!folder) return json(res, 503, { ok: false, reason: 'sem-vault' });

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
/* Modo link (SYNC_OPEN=1): qualquer aparelho que abra este endereço lê e
   grava o mesmo documento, sem login. É o que faz o link privado do site
   sincronizar sozinho entre o portátil e o telemóvel. Só deve ser ligado
   quando o endereço é privado: quem tiver o link passa a poder ver e
   alterar todos os dados. Desligar = remover SYNC_OPEN (ou pôr 0). */
const SYNC_ABERTO = process.env.SYNC_OPEN === '1';

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const WORKSPACE_ID = String(process.env.WORKSPACE_ID || 'default');
const pgStore = createStore(process.env.DATABASE_URL);
const workspace = createWorkspace({ pgStore, dataDir: DATA_DIR, workspaceId: WORKSPACE_ID });
if (process.env.RENDER && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL é obrigatório no Render para persistir os dados.');
}
if (process.env.RENDER && !SYNC_ABERTO && (!SYNC_USER || !process.env.SYNC_PASS)) {
    throw new Error('SYNC_USER e SYNC_PASS são obrigatórios no Render para proteger os dados pessoais (ou define SYNC_OPEN=1 para um link privado).');
}
const SYNC_FILE = path.join(DATA_DIR, 'sync.json');
const SESSOES_FILE = path.join(DATA_DIR, 'sessoes.json');
const SESSAO_MS = 180 * 24 * 60 * 60 * 1000;
const LOGIN_JANELA_MS = 60 * 1000;
const LOGIN_MAX_TENTATIVAS = 12;

let syncDoc = { rev: 0, updatedAt: null, gid: crypto.randomBytes(8).toString('hex'), data: { days: {} } };
let sessoes = {};
const tentativasLogin = new Map();

try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
        const raw = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
        if (raw && typeof raw.rev === 'number' && raw.data && typeof raw.data === 'object') {
            syncDoc = {
                rev: raw.rev,
                updatedAt: raw.updatedAt ?? null,
                // gid identifica a "geração" do disco: após um wipe (disco
                // efémero) o ficheiro desaparece e nasce um gid novo, para os
                // aparelhos distinguirem "rev igual" de "conteúdo igual".
                gid: typeof raw.gid === 'string' && raw.gid ? raw.gid : crypto.randomBytes(8).toString('hex'),
                data: raw.data,
            };
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

function escreverJsonAtomico(ficheiro, valor) {
    const tmp = `${ficheiro}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(valor), { mode: 0o600 });
    fs.renameSync(tmp, ficheiro);
}

/* A escrita é atómica no ficheiro e serializada na base de dados. A fila
   evita que dois PUT concorrentes calculem a mesma revisão de base. */
function persistirSync(doc) {
    if (pgStore) return pgStore.putState(doc);
    try {
        escreverJsonAtomico(SYNC_FILE, doc);
        return Promise.resolve();
    } catch (error) {
        return Promise.reject(error);
    }
}

let filaSync = Promise.resolve();
function comFilaSync(fn) {
    const atual = filaSync.then(fn, fn);
    filaSync = atual.catch(() => { /* a próxima escrita continua */ });
    return atual;
}

/* ── Push instantâneo por SSE ────────────────────────────────
   Cada aparelho com a app aberta mantém uma ligação a
   /api/sync/eventos. Quando um faz push, os outros recebem a revisão
   nova e puxam logo — sem esperar pelo poll de 15s. Serve também de
   keep-alive: o servidor do Render não adormece com a app aberta. */
const syncOuvintes = new Set();
const workspaceOuvintes = new Set();

function transmitirSync() {
    const payload = `data: ${JSON.stringify({ rev: syncDoc.rev, updatedAt: syncDoc.updatedAt })}\n\n`;
    for (const res of syncOuvintes) {
        try { res.write(payload); } catch { syncOuvintes.delete(res); }
    }
}

/* Avisa todos os dispositivos do workspace. O evento leva só a revisão e
   a origem; cada cliente pede as chaves alteradas desde a sua revisão. */
function transmitirWorkspace(revision, origin = '', tipo = 'workspace') {
    const payload = `data: ${JSON.stringify({
        type: tipo,
        revision: Number(revision) || 0,
        origin: String(origin || '').slice(0, 100),
        workspaceId: WORKSPACE_ID,
    })}\n\n`;
    for (const res of workspaceOuvintes) {
        try { res.write(payload); } catch { workspaceOuvintes.delete(res); }
    }
}

async function guardarSessao(token) {
    if (pgStore) return pgStore.putSession(token, sessoes[token]);
    escreverJsonAtomico(SESSOES_FILE, sessoes);
}

async function apagarSessao(token) {
    if (pgStore) return pgStore.deleteSession(token);
    escreverJsonAtomico(SESSOES_FILE, sessoes);
}

function hashIguais(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function tokenDaSessao(req) {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    return m ? m[1].trim() : '';
}

function pedidoLoopback(req) {
    if (process.env.RENDER) return false;
    const ip = String(req.socket?.remoteAddress || '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

async function autorizarDados(req, res) {
    // O modo link tem prioridade: a conta continua a existir para gerir
    // partilhas, mas qualquer aparelho no endereço sincroniza sem login.
    if (SYNC_ABERTO) return true;
    if (contaAtiva) {
        if (await sessaoValida(tokenDaSessao(req))) return true;
        json(res, 401, { ok: false, reason: 'sessao' });
        return false;
    }
    if (pedidoLoopback(req)) return true;
    json(res, 503, { ok: false, reason: 'sem-conta' });
    return false;
}

async function sessaoValida(token) {
    if (!token) return false;
    // Sessões partilhadas no PostgreSQL têm de ser reconhecidas por todas
    // as instâncias (e revogações têm de valer imediatamente em todas).
    const s = pgStore ? await pgStore.getSession(token) : sessoes[token];
    if (!s) return false;
    // Links de partilha não expiram com a sessão (são revogados à mão).
    if (s.partilha) return true;
    if (Date.now() - Number(s.criadoEm || 0) > SESSAO_MS) {
        delete sessoes[token];
        await apagarSessao(token).catch(() => { /* segue */ });
        return false;
    }
    return true;
}

/* Só a sessão completa (login) gere partilhas; um link partilhado não
   cria mais links. */
async function sessaoCompleta(token) {
    const s = pgStore ? await pgStore.getSession(token) : sessoes[token];
    if (!s || s.partilha) return false;
    return await sessaoValida(token);
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
        json(res, 200, { ok: true, contaAtiva, aberto: SYNC_ABERTO });
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
            await guardarSessao(token);
        } catch {
            delete sessoes[token];
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        json(res, 200, { ok: true, token });
        return;
    }

    if (route === '/sair' && req.method === 'POST') {
        const token = tokenDaSessao(req);
        if (token && sessoes[token]) {
            delete sessoes[token];
            try { await apagarSessao(token); } catch { /* segue */ }
        }
        json(res, 200, { ok: true });
        return;
    }

    /* ── Partilha por link ──────────────────────────────
       Quem tem o link entra logo sincronizado, sem palavra-passe.
       O link dá acesso TOTAL (ler e escrever tudo): só partilhar com
       quem pode ver e mexer nos dados. Revoga-se apagando o link. */

    if (route === '/partilha' && req.method === 'POST') {
        if (!contaAtiva) return json(res, 503, { ok: false, reason: 'sem-conta' });
        const token = tokenDaSessao(req);
        if (!await sessaoCompleta(token)) {
            const soLeitura = await sessaoValida(token);
            return json(res, soLeitura ? 403 : 401,
                { ok: false, reason: soLeitura ? 'sem-permissao' : 'sessao' });
        }
        const body = await lerJsonBody(req, res);
        if (!body) return;
        const nome = String(body.nome ?? '').slice(0, 60);
        const novo = `sh_${crypto.randomBytes(32).toString('hex')}`;
        sessoes[novo] = { criadoEm: Date.now(), partilha: true, nome };
        try {
            await guardarSessao(novo);
        } catch {
            delete sessoes[novo];
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        json(res, 200, { ok: true, token: novo, nome });
        return;
    }

    if (route === '/partilhas' && req.method === 'GET') {
        if (!contaAtiva) return json(res, 503, { ok: false, reason: 'sem-conta' });
        const token = tokenDaSessao(req);
        if (!await sessaoCompleta(token)) {
            const soLeitura = await sessaoValida(token);
            return json(res, soLeitura ? 403 : 401,
                { ok: false, reason: soLeitura ? 'sem-permissao' : 'sessao' });
        }
        const lista = Object.entries(sessoes)
            .filter(([, s]) => s && s.partilha)
            .map(([t, s]) => ({ id: t.slice(0, 12), nome: s.nome || '', criadoEm: s.criadoEm || 0 }))
            .sort((a, b) => b.criadoEm - a.criadoEm);
        json(res, 200, { ok: true, partilhas: lista });
        return;
    }

    if (route === '/partilha' && req.method === 'DELETE') {
        if (!contaAtiva) return json(res, 503, { ok: false, reason: 'sem-conta' });
        const token = tokenDaSessao(req);
        if (!await sessaoCompleta(token)) {
            const soLeitura = await sessaoValida(token);
            return json(res, soLeitura ? 403 : 401,
                { ok: false, reason: soLeitura ? 'sem-permissao' : 'sessao' });
        }
        const body = await lerJsonBody(req, res);
        if (!body) return;
        const id = String(body.id ?? '');
        const chave = Object.keys(sessoes).find((t) => t.startsWith(id) && sessoes[t] && sessoes[t].partilha);
        if (chave) {
            delete sessoes[chave];
            try { await apagarSessao(chave); } catch { /* segue */ }
        }
        json(res, 200, { ok: true });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

async function apiSync(req, res) {
    if (!(await autorizarDados(req, res))) return;

    if (req.method === 'GET') {
        // Render pode encaminhar pedidos consecutivos para processos
        // diferentes. A memória de cada processo não é a fonte canónica.
        if (pgStore) {
            const atual = await pgStore.getState();
            if (atual && typeof atual.rev === 'number') syncDoc = atual;
        }
        json(res, 200, { ok: true, rev: syncDoc.rev, updatedAt: syncDoc.updatedAt, gid: syncDoc.gid, data: syncDoc.data });
        return;
    }

    if (req.method === 'PUT') {
        const body = await lerJsonBody(req, res, SYNC_MAX_BODY);
        if (!body) return;
        const baseRev = Number(body.baseRev);
        if (!Number.isInteger(baseRev) || baseRev < 0 || !dadosSyncValidos(body.data)) {
            return json(res, 400, { ok: false, reason: 'conteudo' });
        }
        // forcar=true: o cliente detetou que o servidor recuou (wipe/
        // redeploy com disco efémero) e repõe o estado completo dele.
        // Fusão por secção (ver fundirSyncData): um cliente antigo que não
        // conhece campos novos (ex.: sessoesBase) não os apaga ao fazer push,
        // e um push desatualizado nunca apaga minutos de outro aparelho.
        let resultado;
        try {
            const atualizar = async () => {
                // Atualiza a revisão antes de comparar o push. Sem isto,
                // uma instância secundária podia responder com um conflito
                // baseado num estado antigo ou sobrescrever uma revisão nova.
                if (pgStore) {
                    const atual = await pgStore.getState();
                    if (atual && typeof atual.rev === 'number') syncDoc = atual;
                }
                if (baseRev !== syncDoc.rev && body.forcar !== true) {
                    return {
                        conflito: true,
                        rev: syncDoc.rev,
                        updatedAt: syncDoc.updatedAt,
                        gid: syncDoc.gid,
                        data: syncDoc.data,
                    };
                }
                const proximo = {
                    rev: syncDoc.rev + 1,
                    updatedAt: new Date().toISOString(),
                    gid: syncDoc.gid,
                    data: fundirSyncData(syncDoc.data, body.data),
                };
                // Só avança a memória depois de a persistência ter sucesso.
                await persistirSync(proximo);
                syncDoc = proximo;
                return { ok: true, doc: proximo };
            };
            resultado = await comFilaSync(() => pgStore ? pgStore.withSyncLock(atualizar) : atualizar());
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        if (resultado.conflito) {
            return json(res, 409, {
                ok: false, reason: 'conflito',
                rev: resultado.rev, updatedAt: resultado.updatedAt,
                gid: resultado.gid, data: resultado.data,
            });
        }
        // Avisa já os outros aparelhos (pull imediato no cliente).
        transmitirSync();
        json(res, 200, { ok: true, rev: resultado.doc.rev, updatedAt: resultado.doc.updatedAt, gid: resultado.doc.gid });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

/* ── Workspace central (nova arquitetura) ─────────────────
   A UI lê/escreve chaves. O servidor guarda-as na base de dados e avisa
   os outros dispositivos por SSE. Não há documento por aparelho. */

async function apiWorkspace(req, res, url) {
    if (!(await autorizarDados(req, res))) return;
    const rota = url.pathname.slice('/api/workspace'.length);

    if ((rota === '' || rota === '/snapshot') && req.method === 'GET') {
        const snap = await workspace.snapshot();
        return json(res, 200, { ok: true, persistente: workspace.persistente, ...snap });
    }

    if (rota === '/changes' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since')) || 0;
        const mudancas = await workspace.changesSince(since);
        return json(res, 200, { ok: true, persistente: workspace.persistente, ...mudancas });
    }

    if (rota === '/ops' && req.method === 'POST') {
        const body = await lerJsonBody(req, res, SYNC_MAX_BODY);
        if (!body) return;
        const clientId = String(body.clientId || req.headers['x-client-id'] || '').slice(0, 100);
        try {
            const resultado = await workspace.applyOps(body.ops, clientId);
            if (resultado.keys.length) transmitirWorkspace(resultado.revision, clientId);
            return json(res, 200, { ok: true, ...resultado });
        } catch (error) {
            if (error && error.code === 'OPS_INVALIDAS') {
                return json(res, 400, { ok: false, reason: error.message });
            }
            throw error;
        }
    }

    if (rota === '/estado' && req.method === 'GET') {
        const info = await workspace.changesSince(Number.MAX_SAFE_INTEGER);
        return json(res, 200, {
            ok: true,
            workspaceId: workspace.id,
            persistente: workspace.persistente,
            revision: Number(info.revision) || 0,
        });
    }

    return json(res, 404, { ok: false, reason: 'rota' });
}

async function apiWorkspaceEventos(req, res, url) {
    const token = tokenDaSessao(req) || url.searchParams.get('token') || '';
    if (!SYNC_ABERTO) {
        if (contaAtiva && !(await sessaoValida(token))) return json(res, 401, { ok: false, reason: 'sessao' });
        if (!contaAtiva && !pedidoLoopback(req)) return json(res, 503, { ok: false, reason: 'sem-conta' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    try {
        const info = await workspace.changesSince(Number.MAX_SAFE_INTEGER);
        res.write(`data: ${JSON.stringify({ type: 'hello', revision: Number(info.revision) || 0, workspaceId: WORKSPACE_ID })}\n\n`);
    } catch { /* o primeiro poll do cliente cobre */ }
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    workspaceOuvintes.add(res);
    const ping = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* a ligação caiu */ }
    }, 25000);

    let fechado = false;
    const fechar = () => {
        if (fechado) return;
        fechado = true;
        clearInterval(ping);
        workspaceOuvintes.delete(res);
        try { res.end(); } catch { /* segue */ }
    };
    req.on('close', fechar);
    req.on('error', fechar);
    res.on('close', fechar);
}

/* Canal de eventos: o cliente puxa assim que a revisão muda. */
async function apiSyncEventos(req, res, url) {
    // EventSource não permite cabeçalhos: o token pode vir no query.
    const token = tokenDaSessao(req) || url.searchParams.get('token') || '';
    if (!SYNC_ABERTO) {
        if (contaAtiva && !(await sessaoValida(token))) return json(res, 401, { ok: false, reason: 'sessao' });
        if (!contaAtiva && !pedidoLoopback(req)) return json(res, 503, { ok: false, reason: 'sem-conta' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ rev: syncDoc.rev, updatedAt: syncDoc.updatedAt })}\n\n`);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    syncOuvintes.add(res);
    const ping = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* a ligação caiu */ }
    }, 25000);

    let fechado = false;
    const fechar = () => {
        if (fechado) return;
        fechado = true;
        clearInterval(ping);
        syncOuvintes.delete(res);
        try { res.end(); } catch { /* segue */ }
    };
    req.on('close', fechar);
    req.on('error', fechar);
    res.on('close', fechar);
}

/* ── Ficheiros (bytes dos PDFs) ────────────────────────
   Os metadados vão no vault (pdfs.json, texto); os bytes vêm para cá
   porque o vault só aceita texto. GET faz download on-demand para o
   outro aparelho; tudo best-effort como o resto do sync. */

const FICHEIROS_DIR = path.join(DATA_DIR, 'ficheiros');
const FICHEIROS_MAX_BYTES = 30 * 1024 * 1024;
const FICHEIRO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FICHEIROS_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

try {
    fs.mkdirSync(FICHEIROS_DIR, { recursive: true });
} catch (error) {
    console.log(`  ! Não foi possível preparar ${FICHEIROS_DIR}: ${error.message}`);
}

function caminhoFicheiro(id) {
    return path.join(FICHEIROS_DIR, id);
}

function nomeCabecalho(nome) {
    return String(nome || 'ficheiro.pdf').replace(/[\r\n"]/g, '').slice(0, 200) || 'ficheiro.pdf';
}

/* Lê os bytes do workspace central (PostgreSQL ou disco do servidor). */
async function lerFicheiroGuardado(id) {
    const row = await workspace.getFile(id);
    if (!row) return null;
    return {
        meta: { ...(row.metadata || {}), nome: row.nome, tipo: row.tipo, tamanho: row.tamanho },
        bytes: row.content,
    };
}

async function apiFicheiros(req, res, url) {
    if (!(await autorizarDados(req, res))) return;

    if (req.method === 'GET' && url.pathname === '/api/ficheiros') {
        // Lista leve (sem bytes). Os bytes vivem no workspace central; a
        // lista serve para a galeria saber o que já existe em cada aparelho.
        const lista = (await workspace.listFiles()).map((f) => ({
            id: f.id,
            nome: f.nome || 'ficheiro.pdf',
            tipo: f.tipo || 'application/pdf',
            tamanho: Number(f.tamanho) || 0,
        }));
        json(res, 200, { ok: true, ficheiros: lista });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ficheiros') {
        const body = await lerJsonBody(req, res, Math.ceil(FICHEIROS_MAX_BYTES * 4 / 3) + 1024 * 1024);
        if (!body) return;
        const id = String(body.id ?? '');
        const nome = String(body.nome ?? 'ficheiro.pdf').slice(0, 200);
        const tipoInformado = String(body.tipo ?? 'application/pdf').slice(0, 100).toLowerCase();
        if (!FICHEIROS_MIMES.has(tipoInformado)) return json(res, 415, { ok: false, reason: 'tipo-nao-suportado' });
        const tipo = tipoInformado;
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
        let resultado;
        try {
            resultado = await workspace.putFile(id, { nome, tipo, tamanho: bytes.length }, bytes);
        } catch {
            return json(res, 500, { ok: false, reason: 'erro' });
        }
        transmitirWorkspace(resultado.revision, String(req.headers['x-client-id'] || ''), 'files');
        json(res, 200, { ok: true, id, tamanho: bytes.length, revision: resultado.revision });
        return;
    }

    const m = /^\/api\/ficheiros\/([^/]+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { ok: false, reason: 'rota' });
    const id = decodeURIComponent(m[1]);
    if (!FICHEIRO_ID.test(id)) return json(res, 400, { ok: false, reason: 'nome' });

    if (req.method === 'GET') {
        const guardado = await lerFicheiroGuardado(id);
        if (!guardado) return json(res, 404, { ok: false, reason: 'ausente' });
        const meta = guardado.meta || {};
        const bytes = guardado.bytes;
        res.writeHead(200, {
            'content-type': String(meta.tipo || 'application/pdf'),
            'content-length': bytes.length,
            'content-disposition': `attachment; filename="${nomeCabecalho(meta.nome)}"`,
            'cache-control': 'private, max-age=86400',
            'x-content-type-options': 'nosniff',
        }).end(bytes);
        return;
    }

    if (req.method === 'DELETE') {
        const resultado = await workspace.deleteFile(id);
        if (resultado.deleted) {
            transmitirWorkspace(resultado.revision, String(req.headers['x-client-id'] || ''), 'files');
        }
        json(res, 200, { ok: true, id, revision: resultado.revision });
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

/* ── LLM local (Ollama) ──────────────────────────────
   Proxy restrito: só estado, chat e transcrever. Nunca expõe o Ollama
   todo (evita ler/apagar modelos pela rede). Sem Ollama a correr, 503
   com motivo claro para a UI explicar. Em produção exige sessão; sem
   conta só está disponível pela interface loopback de desenvolvimento. */

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const LLM_CHAT_PADRAO = process.env.LLM_CHAT || 'qwen3';
const LLM_VISAO_PADRAO = process.env.LLM_VISAO || 'qwen2.5vl';
const LLM_MAX_TEXTO = 8000;
const LLM_MAX_MSGS = 50;
const LLM_TIMEOUT_MS = 10 * 60 * 1000;
const LLM_MAX_IMAGEM = 20 * 1024 * 1024;

async function llmAutorizado(req) {
    const token = tokenDaSessao(req);
    if (token && await sessaoValida(token)) return true;
    return pedidoLoopback(req);
}

async function ollamaModelos() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
        if (!r.ok) return null;
        const d = await r.json().catch(() => null);
        const modelos = d && Array.isArray(d.models)
            ? d.models.map((m) => m && m.name).filter((n) => typeof n === 'string' && n)
            : [];
        return modelos;
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

async function apiLlm(req, res, url) {
    if (url.pathname === '/api/llm/estado' && req.method === 'GET') {
        if (!await llmAutorizado(req)) return json(res, contaAtiva ? 401 : 503, { ok: false, reason: contaAtiva ? 'sessao' : 'sem-conta' });
        const modelos = await ollamaModelos();
        json(res, 200, { ok: true, ollama: modelos !== null, modelos: modelos || [] });
        return;
    }

    if (!await llmAutorizado(req)) {
        const token = tokenDaSessao(req);
        return json(res, token ? 403 : 401, { ok: false, reason: 'sessao' });
    }

    if (url.pathname === '/api/llm/chat' && req.method === 'POST') {
        const body = await lerJsonBody(req, res, 1024 * 1024);
        if (!body) return;
        const modelo = String(body.modelo || LLM_CHAT_PADRAO).slice(0, 100);
        const sistema = String(body.sistema || '').slice(0, 2000);
        const msgs = Array.isArray(body.mensagens) ? body.mensagens.slice(-LLM_MAX_MSGS) : [];
        const messages = [];
        if (sistema) messages.push({ role: 'system', content: sistema });
        for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            const role = m.papel === 'assistant' ? 'assistant' : 'user';
            const content = String(m.texto ?? '').slice(0, LLM_MAX_TEXTO);
            if (!content) continue;
            messages.push({ role, content });
        }
        if (!messages.some((m) => m.role === 'user')) {
            return json(res, 400, { ok: false, reason: 'conteudo' });
        }

        const ctrl = new AbortController();
        const limite = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
        // Só aborta quando a RESPOSTA fecha (cliente desistiu). O 'close'
        // do pedido dispara cedo (corpo lido) e matava o Ollama a meio.
        let feito = false;
        const aoFechar = () => {
            if (feito) return;
            feito = true;
            clearTimeout(limite);
            ctrl.abort();
        };
        res.on('close', aoFechar);
        try {
            const up = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: modelo, messages, stream: true }),
                signal: ctrl.signal,
            });
            if (!up.ok || !up.body) {
                const txt = await up.text().catch(() => '');
                feito = true;
                clearTimeout(limite);
                if (up.status === 404 || /not found/i.test(txt)) {
                    return json(res, 404, { ok: false, reason: 'sem-modelo', modelo });
                }
                return json(res, 502, { ok: false, reason: 'ollama-erro' });
            }
            res.writeHead(200, {
                'content-type': 'application/x-ndjson; charset=utf-8',
                'cache-control': 'no-store',
            });
            try {
                for await (const chunk of up.body) {
                    if (res.destroyed) break;
                    if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
                }
            } catch { /* cliente desistiu a meio */ }
            feito = true;
            clearTimeout(limite);
            res.end();
        } catch (error) {
            feito = true;
            clearTimeout(limite);
            if (!res.headersSent) {
                const esgotou = error && error.name === 'AbortError';
                json(res, esgotou ? 504 : 503, { ok: false, reason: esgotou ? 'tempo-esgotado' : 'sem-ollama' });
            } else {
                try { res.end(); } catch { /* segue */ }
            }
        } finally {
            res.off('close', aoFechar);
        }
        return;
    }

    if (url.pathname === '/api/llm/transcrever' && req.method === 'POST') {
        const body = await lerJsonBody(req, res, LLM_MAX_IMAGEM + 1024 * 1024);
        if (!body) return;
        const modelo = String(body.modelo || LLM_VISAO_PADRAO).slice(0, 100);
        let b64 = String(body.dados || '');
        if (!b64 && body.id && FICHEIRO_ID.test(String(body.id))) {
            try {
                const guardado = await lerFicheiroGuardado(String(body.id));
                if (!guardado) return json(res, 404, { ok: false, reason: 'ausente' });
                b64 = guardado.bytes.toString('base64');
            } catch {
                return json(res, 404, { ok: false, reason: 'ausente' });
            }
        }
        if (!b64) return json(res, 400, { ok: false, reason: 'conteudo' });
        // Tira prefixo dataURL se vier colado.
        const m = /^data:[^,]+,/.exec(b64);
        if (m) b64 = b64.slice(m[0].length);
        if (Buffer.byteLength(b64, 'base64') > LLM_MAX_IMAGEM) {
            return json(res, 413, { ok: false, reason: 'demasiado-grande' });
        }

        const ctrl = new AbortController();
        const limite = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
        try {
            const up = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: modelo,
                    prompt: 'Transcreve todo o texto manuscrito ou impresso desta imagem, linha a linha, sem comentários nem explicações. Se houver partes ilegíveis, marca com […].',
                    images: [b64],
                    stream: false,
                    options: { temperature: 0 },
                }),
                signal: ctrl.signal,
            });
            const txt = await up.text().catch(() => '');
            if (!up.ok) {
                if (up.status === 404 || /not found/i.test(txt)) {
                    return json(res, 404, {
                        ok: false, reason: 'sem-modelo', modelo,
                        dica: `Corre no portátil: ollama pull ${modelo}`,
                    });
                }
                return json(res, 502, { ok: false, reason: 'ollama-erro' });
            }
            let texto = '';
            try {
                texto = String(JSON.parse(txt).response || '').trim();
            } catch { /* resposta inválida */ }
            if (!texto) return json(res, 502, { ok: false, reason: 'vazio' });
            json(res, 200, { ok: true, texto, modelo });
        } catch {
            json(res, 503, { ok: false, reason: 'sem-ollama' });
        } finally {
            clearTimeout(limite);
        }
        return;
    }

    json(res, 404, { ok: false, reason: 'rota' });
}

/* Só estes caminhos são públicos. Sem isto, /serve.js, /.git/config,
   /key.pem e /data/sync.json (dados pessoais) ficavam acessíveis. */
const PUBLIC_FILES = new Set([
    'index.html', 'app.css', 'layout.css', 'design.css',
    'manifest.webmanifest', 'sw.js', 'favicon.ico', 'robots.txt',
]);
const PUBLIC_DIRS = ['src/', 'vendor/', 'icons/', 'data/static/'];

function caminhoPublico(relative) {
    if (!relative || relative.includes('\0')) return false;
    const partes = relative.split('/');
    if (partes.some((p) => !p || p === '..' || p === '.' || p.startsWith('.'))) return false;
    if (PUBLIC_FILES.has(relative)) return true;
    return PUBLIC_DIRS.some((dir) => relative.startsWith(dir));
}

function serveStatic(req, res, url) {
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('400 Bad Request');
        return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (!caminhoPublico(relative)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
        return;
    }
    const file = path.join(ROOT, ...relative.split('/'));

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
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
        }).end(data);
    });
}

async function handle(req, res) {
    let url;
    try {
        url = new URL(req.url, 'http://localhost');
    } catch {
        json(res, 400, { ok: false, reason: 'pedido' });
        return;
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${url.pathname}`);

    if (url.pathname === '/api/conta' || url.pathname.startsWith('/api/conta/')) {
        try {
            await apiConta(req, res, url);
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/workspace/events') {
        try {
            await apiWorkspaceEventos(req, res, url);
        } catch {
            try { res.end(); } catch { /* segue */ }
        }
        return;
    }

    if (url.pathname === '/api/workspace' || url.pathname.startsWith('/api/workspace/')) {
        try {
            await apiWorkspace(req, res, url);
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/sync/eventos' || url.pathname === '/api/data/events') {
        try {
            await apiSyncEventos(req, res, url);
        } catch {
            try { res.end(); } catch { /* segue */ }
        }
        return;
    }

    if (url.pathname === '/api/sync/volume') {
        try {
            if (!(await autorizarDados(req, res))) return;
            if (req.method !== 'PUT') return json(res, 405, { ok: false, reason: 'metodo' });
            const body = await lerJsonBody(req, res, SYNC_MAX_BODY);
            if (!body || !dadosSyncValidos(body.data)) return json(res, 400, { ok: false, reason: 'conteudo' });
            const result = await (pgStore ? pgStore.syncStateByVolume(body) : (async () => ({ decision: 'from_local' }))());
            json(res, 200, { ok: true, ...result });
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/sync' || url.pathname === '/api/data') {
        try {
            await apiSync(req, res);
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/ficheiros' || url.pathname.startsWith('/api/ficheiros/')) {
        try {
            await apiFicheiros(req, res, url);
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/llm' || url.pathname.startsWith('/api/llm/')) {
        try {
            await apiLlm(req, res, url);
        } catch {
            erroInterno(res);
        }
        return;
    }

    if (url.pathname === '/api/vault' || url.pathname.startsWith('/api/vault/')) {
        try {
            await api(req, res, url);
        } catch {
            erroInterno(res);
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

async function iniciarServidor() {
    let armazenamento = 'ficheiro local';
    if (pgStore) {
        armazenamento = 'PostgreSQL';
        let staticExams = null;
        try {
            staticExams = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/static/exams.json'), 'utf8'));
        } catch (error) {
            console.error(`  ! Catálogo curricular indisponível (${error.message}); arranco sem seed.`);
        }
        const seed = await pgStore.init(staticExams);
        if (seed && (seed.exams || seed.nodes)) {
            console.log(`  Catálogo: ${seed.exams} exames ativos, ${seed.nodes} tópicos semeados.`);
        }
        const estado = await pgStore.getState();
        if (estado && typeof estado.rev === 'number' && estado.data && typeof estado.data === 'object') {
            // Documento antigo pode não ter gid ou days: normaliza sem perder dados.
            syncDoc = {
                rev: estado.rev,
                updatedAt: estado.updatedAt ?? null,
                gid: estado.gid || crypto.randomBytes(8).toString('hex'),
                data: estado.data,
            };
            if (!syncDoc.data.days || typeof syncDoc.data.days !== 'object' || Array.isArray(syncDoc.data.days)) {
                syncDoc.data.days = {};
            }
        } else {
            await pgStore.putState(syncDoc);
        }
        sessoes = await pgStore.getSessions();
    }
    // Migração única do documento/snapshot antigo e dos ficheiros legados
    // para o workspace central. Idempotente: não toca em chaves existentes.
    try {
        const migrado = await workspace.init();
        if (migrado && (migrado.keys || migrado.files)) {
            console.log(`  Workspace: ${migrado.keys || 0} chaves e ${migrado.files || 0} ficheiros migrados do formato antigo.`);
        }
        if (pgStore) {
            // Ficheiros que só existam no disco desta máquina entram também
            // no PostgreSQL, para ficarem acessíveis em qualquer aparelho.
            let legados = [];
            try {
                legados = fs.readdirSync(FICHEIROS_DIR).filter((f) => FICHEIRO_ID.test(f) && !f.endsWith('.meta.json'));
            } catch { /* diretório ainda não existe */ }
            if (legados.length) {
                const existentes = new Set((await workspace.listFiles()).map((f) => f.id));
                for (const id of legados) {
                    if (existentes.has(id)) continue;
                    try {
                        const metadata = JSON.parse(fs.readFileSync(`${caminhoFicheiro(id)}.meta.json`, 'utf8'));
                        await workspace.putFile(id, metadata, fs.readFileSync(caminhoFicheiro(id)));
                    } catch { /* mantém os ficheiros legados intactos */ }
                }
            }
        }
    } catch (error) {
        console.error(`  ! Falha ao preparar o workspace: ${error.message}`);
        throw error;
    }
    server.listen(PORT, HOST, () => {
    const scheme = secure ? 'https' : 'http';
    console.log(`StudyJournal em ${scheme}://${HOST}:${PORT}`);
    console.log(`  Dados: ${armazenamento}${pgStore ? ` (rev ${syncDoc.rev})` : ` — ${DATA_DIR}`}`);

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
    if (SYNC_ABERTO) {
        console.log('  Dados pessoais: MODO LINK — qualquer aparelho com este endereço lê e grava sem login.');
        console.log('    Mantém o link privado. Para voltar a exigir login, remove SYNC_OPEN.');
    } else {
        console.log(`  Dados pessoais: ${contaAtiva ? 'protegidos por sessão' : 'modo local loopback'}`);
    }
    console.log(`  LLM: ${contaAtiva ? 'só com sessão' : 'modo local loopback'} via ${OLLAMA_URL}`);

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
}

iniciarServidor().catch((error) => {
    console.error(`Falha ao inicializar armazenamento PostgreSQL: ${error.message}`);
    if (pgStore) pgStore.close().catch(() => {});
    process.exitCode = 1;
});

function encerrarSinal() {
    server.close(() => {
        if (pgStore) pgStore.close().finally(() => process.exit(0));
        else process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGTERM', encerrarSinal);
process.once('SIGINT', encerrarSinal);

/* Um erro assíncrono isolado não deve deitar o servidor abaixo (o
   Render reiniciava e o cliente via a sincronização falhar em ciclo). */
process.on('unhandledRejection', (erro) => {
    console.error(`  ! Promessa rejeitada sem tratamento: ${erro && erro.message ? erro.message : erro}`);
});

