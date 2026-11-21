'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ESPERA_MS = 15000;

test('configuração Render: processo recusa arrancar sem credenciais de conta', () => {
  const child = spawnSync(process.execPath, ['serve.js'], {
    cwd: RAIZ,
    env: { ...process.env, RENDER: 'true', DATABASE_URL: 'postgresql://invalid', SYNC_USER: '', SYNC_PASS: '', PORT: '0' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SYNC_USER e SYNC_PASS são obrigatórios/);
});

function portaVivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function arrancar(dataDir, autenticado = false) {
  const port = await portaVivre();
  const child = spawn(process.execPath, ['serve.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      VAULT_DIR: '',
      SYNC_OPEN: '1', // ignorado: sync anónimo foi desativado
      SYNC_USER: autenticado ? 'audit-user' : '',
      SYNC_PASS: autenticado ? 'audit-password' : '',
      DATABASE_URL: '',
      RENDER: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  let erros = '';
  child.stdout.on('data', (d) => { saida += d.toString(); });
  child.stderr.on('data', (d) => { erros += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const inicio = Date.now();
  while (Date.now() - inicio < ESPERA_MS) {
    if (child.exitCode !== null) throw new Error(`servidor saiu (${child.exitCode}). stderr: ${erros}`);
    try {
      const r = await fetch(`${baseUrl}/index.html`);
      if (r.ok) return { child, baseUrl };
    } catch { /* ainda a arrancar */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`servidor não arrancou. stdout: ${saida} stderr: ${erros}`);
}

test('APIs pessoais exigem sessão quando a conta está configurada', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-auth-'));
  const server = await arrancar(dir, true);
  t.after(async () => { await parar(server.child); fs.rmSync(dir, { recursive: true, force: true }); });

  for (const pathName of ['/api/data', '/api/ficheiros', '/api/vault']) {
    assert.equal((await fetch(`${server.baseUrl}${pathName}`)).status, 401, `${pathName} deve exigir sessão`);
  }
  const login = await fetch(`${server.baseUrl}/api/conta/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user: 'audit-user', pass: 'audit-password' }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const auth = { headers: { authorization: `Bearer ${token}` } };
  assert.equal((await fetch(`${server.baseUrl}/api/data`, auth)).status, 200);
  assert.equal((await fetch(`${server.baseUrl}/api/ficheiros`, auth)).status, 200);
  assert.equal((await fetch(`${server.baseUrl}/api/vault`, auth)).status, 200);
});

function parar(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const limite = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(limite); resolve(); });
    child.kill('SIGTERM');
  });
}

let dataDir;
let servidor;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-servidor-'));
  servidor = await arrancar(dataDir);
});

after(async () => {
  await parar(servidor.child);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('servidor: ficheiros públicos continuam a ser servidos', async () => {
  for (const caminho of ['/', '/index.html', '/app.css', '/design.css', '/src/app.js', '/src/exam-engine.js', '/data/static/exams.json', '/manifest.webmanifest']) {
    const r = await fetch(`${servidor.baseUrl}${caminho}`);
    assert.equal(r.status, 200, caminho);
  }
  const catalogo = await (await fetch(`${servidor.baseUrl}/data/static/exams.json`)).json();
  assert.ok(Array.isArray(catalogo.nodes) && catalogo.nodes.length > 0);
});

test('servidor: código, segredos, .git e dados pessoais nunca são servidos', async () => {
  const proibidos = [
    '/serve.js',
    '/package.json',
    '/key.pem',
    '/cert.pem',
    '/.env',
    '/.git/config',
    '/db/store.js',
    '/data/sync.json',
    '/data/sessoes.json',
    '/data/ficheiros/p_teste',
    '/%2e%2e%2fserve.js',
    '/..%2fkey.pem',
    '/data/static/../sync.json',
  ];
  for (const caminho of proibidos) {
    const r = await fetch(`${servidor.baseUrl}${caminho}`);
    assert.equal(r.status, 404, `${caminho} devolveu ${r.status}`);
    assert.ok(!/BEGIN CERTIFICATE|private key|"days"/.test(await r.text()), caminho);
  }
});

test('servidor: URI malformado devolve 400 sem derrubar o processo', async () => {
  const r = await fetch(`${servidor.baseUrl}/%E0%A4%A`);
  assert.equal(r.status, 400);
  const ok = await fetch(`${servidor.baseUrl}/index.html`);
  assert.equal(ok.status, 200, 'o servidor continua vivo');
});

test('servidor: upload/download/apagar de PDF funciona no disco', async () => {
  const bytes = Buffer.from('%PDF-1.4\nconteudo de teste\n%%EOF');
  const criar = await fetch(`${servidor.baseUrl}/api/ficheiros`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p_teste', nome: 'Resumo "A".pdf', tipo: 'application/pdf', dados: bytes.toString('base64') }),
  });
  assert.equal(criar.status, 200);
  assert.equal((await criar.json()).tamanho, bytes.length);

  const html = await fetch(`${servidor.baseUrl}/api/ficheiros`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p_html', nome: 'payload.html', tipo: 'text/html', dados: Buffer.from('<script>alert(1)</script>').toString('base64') }),
  });
  assert.equal(html.status, 415, 'uploads de conteúdo ativo não são servidos no mesmo domínio');

  const lista = await (await fetch(`${servidor.baseUrl}/api/ficheiros`)).json();
  const entrada = lista.ficheiros.find((f) => f.id === 'p_teste');
  assert.ok(entrada);
  assert.equal(entrada.nome, 'Resumo "A".pdf');
  assert.equal(entrada.tamanho, bytes.length);

  const ficheiro = await fetch(`${servidor.baseUrl}/api/ficheiros/p_teste`);
  assert.equal(ficheiro.status, 200);
  assert.match(ficheiro.headers.get('content-type'), /application\/pdf/);
  assert.match(ficheiro.headers.get('content-disposition'), /^attachment; filename="Resumo A.pdf"$/);
  assert.deepEqual(Buffer.from(await ficheiro.arrayBuffer()), bytes);

  const apagar = await fetch(`${servidor.baseUrl}/api/ficheiros/p_teste`, { method: 'DELETE' });
  assert.equal(apagar.status, 200);
  assert.equal((await fetch(`${servidor.baseUrl}/api/ficheiros/p_teste`)).status, 404);
});

test('servidor: API canónica /api/data grava e mantém a rota legacy protegida em produção', async () => {
  const estadoConta = await (await fetch(`${servidor.baseUrl}/api/conta/estado`)).json();
  assert.equal(estadoConta.aberto, false);
  const push = await fetch(`${servidor.baseUrl}/api/data`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRev: 0, data: { days: { '2026-01-01': { estudo: 30 } } } }),
  });
  assert.equal(push.status, 200);
  const enviado = await push.json();
  assert.equal(enviado.rev, 1);

  const estado = await (await fetch(`${servidor.baseUrl}/api/data`)).json();
  assert.equal(estado.rev, 1);
  assert.deepEqual(estado.data.days['2026-01-01'], { estudo: 30 });

  const conflito = await fetch(`${servidor.baseUrl}/api/data`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRev: 0, data: { days: {} } }),
  });
  assert.equal(conflito.status, 409);
  assert.equal((await conflito.json()).reason, 'conflito');

  const invalido = await fetch(`${servidor.baseUrl}/api/data`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRev: 1, data: { semDias: true } }),
  });
  assert.equal(invalido.status, 400);
  assert.equal((await fetch(`${servidor.baseUrl}/api/sync`)).status, 200, 'a rota antiga mantém compatibilidade local');
});

test('servidor: sync faz merge de sessões e PDFs em vez de os apagar', async () => {
  const estado = await (await fetch(`${servidor.baseUrl}/api/data`)).json();
  const base = { days: estado.data.days, sessoesBase: { '2026-01-01': { mat: 30 } }, pdfs: [{ id: 'a', titulo: 'A' }], pdfsApagados: [] };
  let r = await fetch(`${servidor.baseUrl}/api/data`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRev: estado.rev, data: base }),
  });
  assert.equal(r.status, 200);

  // Um cliente desatualizado envia menos minutos e não conhece o PDF.
  r = await fetch(`${servidor.baseUrl}/api/data`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseRev: (await r.json()).rev,
      data: { days: estado.data.days, sessoesBase: { '2026-01-01': { mat: 5 } }, pdfs: [], pdfsApagados: [] },
    }),
  });
  assert.equal(r.status, 200);

  const final = await (await fetch(`${servidor.baseUrl}/api/data`)).json();
  assert.deepEqual(final.data.sessoesBase['2026-01-01'], { mat: 30 });
  assert.deepEqual(final.data.pdfs.map((p) => p.id), ['a']);
});

test('servidor: estado sobrevive a um reinício (nada em memória apenas)', async () => {
  const antes = await (await fetch(`${servidor.baseUrl}/api/data`)).json();
  await parar(servidor.child);
  servidor = await arrancar(dataDir);
  const depois = await (await fetch(`${servidor.baseUrl}/api/data`)).json();
  assert.equal(depois.rev, antes.rev);
  assert.deepEqual(depois.data, antes.data);
  assert.equal(depois.gid, antes.gid);
  assert.ok(fs.existsSync(path.join(dataDir, 'sync.json')), 'o estado tem de estar em disco/BD, não só em memória');
});
