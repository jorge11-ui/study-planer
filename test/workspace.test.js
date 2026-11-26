'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const protocolo = require('../lib/workspace-protocol');
const { createLocalWorkspace } = require('../db/workspace-local');
const { createWorkspace } = require('../lib/workspace');
const { criarBase } = require('./helpers/pg');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-workspace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('protocolo: só viajam chaves do workspace', () => {
  assert.equal(protocolo.chaveSincronizavel('study-journal-notes-2026-01-02'), true);
  assert.equal(protocolo.chaveSincronizavel('study-journal-tasks-2026-01-02'), true);
  assert.equal(protocolo.chaveSincronizavel('study-journal-pdfs'), true);

  for (const local of [
    'study-journal-device-id',
    'study-journal-conta-token',
    'study-journal-github-token',
    'study-journal-workspace-rev',
    'study-journal-client-id',
    'study-journal-view',
    'study-journal-session-state',
    'study-journal-imagens-enviadas',
    'outra-app',
  ]) {
    assert.equal(protocolo.chaveSincronizavel(local), false, `${local} é local`);
  }
});

test('protocolo: valida operações e a última escrita da mesma chave ganha', () => {
  assert.equal(protocolo.validarOps([]).erro, 'sem-operacoes');
  assert.equal(protocolo.validarOps([{ key: 'study-journal-view', value: 'x' }]).erro, 'chave-invalida');
  assert.equal(protocolo.validarOps([{ key: 'study-journal-notas', value: 3 }]).erro, 'valor-invalido');

  const r = protocolo.validarOps([
    { key: 'study-journal-notas', value: 'a' },
    { key: 'study-journal-notas', value: 'b' },
    { key: 'study-journal-pdfs', deleted: true },
  ]);
  assert.equal(r.ops.length, 2);
  assert.equal(r.ops[0].valor, 'b');
  assert.equal(r.ops[1].apagada, true);
});

test('protocolo: converte o documento antigo em chaves do workspace', () => {
  const chaves = protocolo.chavesDoDocumentoLegado({
    days: {
      '2026-03-04': { notes: 'olá', updatedAt: 10, tasks: [{ id: 't1' }], tasksUpdatedAt: 20 },
    },
    semanal: { fixos: [{ id: 'f1' }], dinamicos: [{ id: 'd1' }], semanaAtual: '2026-03-02' },
    semanalPrefs: { passo: 30, vista: 'semana' },
    examesV2: { exams: [] },
    pdfs: [{ id: 'p1' }],
    sessoes: { '2026-03-04': 25 },
    whiteboardDraft: { content: '{"objects":[]}', updatedAt: 99 },
  });

  assert.equal(chaves['study-journal-notes-2026-03-04'], 'olá');
  assert.equal(chaves['study-journal-notes-2026-03-04-ts'], '10');
  assert.equal(chaves['study-journal-tasks-2026-03-04'], JSON.stringify([{ id: 't1' }]));
  assert.equal(chaves['study-journal-tasks-2026-03-04-ts'], '20');
  assert.equal(chaves['study-journal-semanal-fixo'], JSON.stringify([{ id: 'f1' }]));
  assert.equal(chaves['study-journal-semanal-dinamico-2026-03-02'], JSON.stringify([{ id: 'd1' }]));
  assert.equal(chaves['study-journal-semanal-passo'], '30');
  assert.equal(chaves['study-journal-exames-center-v2'], JSON.stringify({ exams: [] }));
  assert.equal(chaves['study-journal-pdfs'], JSON.stringify([{ id: 'p1' }]));
  assert.equal(chaves['study-journal-sessions'], JSON.stringify({ '2026-03-04': 25 }));
  assert.equal(chaves['study-journal-whiteboard-draft'], '{"objects":[]}');
  assert.equal(chaves['study-journal-whiteboard-draft-ts'], '99');
});

test('protocolo: ponte do documento antigo só aplica o que é mais recente', () => {
  const antes = {
    days: {
      '2026-03-04': { notes: 'antiga', updatedAt: 10, tasks: [{ id: 't1' }], tasksUpdatedAt: 10 },
    },
    pdfs: [{ id: 'p1' }],
    pdfsApagados: [],
    sessoes: { Mat: 10 },
    sessoesLog: [{ subject: 'Mat', minutos: 10, created: 1 }],
  };
  const depois = {
    days: {
      '2026-03-04': { notes: 'nova', updatedAt: 20, tasks: [{ id: 't1' }], tasksUpdatedAt: 10 },
    },
    pdfs: [{ id: 'p1' }, { id: 'p2' }],
    pdfsApagados: [],
    sessoes: { Mat: 20, Fis: 5 },
    sessoesLog: [{ subject: 'Mat', minutos: 10, created: 1 }, { subject: 'Fis', minutos: 5, created: 2 }],
  };
  const servidor = new Map([
    ['study-journal-notes-2026-03-04', 'servidor'],
    ['study-journal-notes-2026-03-04-ts', '15'],
    ['study-journal-tasks-2026-03-04', JSON.stringify([{ id: 't1' }])],
    ['study-journal-tasks-2026-03-04-ts', '10'],
    ['study-journal-pdfs', JSON.stringify([{ id: 'p1' }, { id: 'p3' }])],
    ['study-journal-pdfs-apagados', JSON.stringify([])],
    ['study-journal-sessions', JSON.stringify({ Mat: 30, Qui: 7 })],
    ['study-journal-session-log', JSON.stringify([{ subject: 'Mat', minutos: 10, created: 1 }])],
  ]);

  const ops = protocolo.opsDoDocumentoLegado(antes, depois, servidor);
  const mapa = new Map(ops.map((op) => [op.key, op.value]));

  // A nota local é mais recente (20 > 15) e viaja com o carimbo.
  assert.equal(mapa.get('study-journal-notes-2026-03-04'), 'nova');
  assert.equal(mapa.get('study-journal-notes-2026-03-04-ts'), '20');
  // As tarefas não mudaram neste push: não são reenviadas.
  assert.equal(mapa.has('study-journal-tasks-2026-03-04'), false);
  // PDFs são unidos, preservando o que só existe no workspace.
  assert.deepEqual(
    JSON.parse(mapa.get('study-journal-pdfs')).map((p) => p.id).sort(),
    ['p1', 'p2', 'p3'],
  );
  // Minutos de estudo nunca diminuem.
  assert.deepEqual(JSON.parse(mapa.get('study-journal-sessions')), { Mat: 30, Qui: 7, Fis: 5 });
  // O registo de sessões é sempre enviado (o servidor une).
  assert.deepEqual(JSON.parse(mapa.get('study-journal-session-log')).map((s) => s.subject), ['Mat', 'Fis']);
});

test('protocolo: ponte do documento antigo recusa uma nota mais velha do que o workspace', () => {
  const antes = { days: { '2026-03-04': { notes: 'antiga', updatedAt: 10 } } };
  const depois = { days: { '2026-03-04': { notes: 'push atrasado', updatedAt: 12 } } };
  const servidor = new Map([
    ['study-journal-notes-2026-03-04', 'mais nova'],
    ['study-journal-notes-2026-03-04-ts', '99'],
  ]);
  assert.deepEqual(protocolo.opsDoDocumentoLegado(antes, depois, servidor), []);
});

test('protocolo: ponte do documento antigo ignora um push sem alterações', () => {
  const doc = { days: { '2026-03-04': { notes: 'igual', updatedAt: 10 } }, pdfs: [{ id: 'p1' }] };
  const servidor = new Map([['study-journal-notes-2026-03-04', 'outra'], ['study-journal-pdfs', '[]']]);
  assert.deepEqual(protocolo.opsDoDocumentoLegado(doc, doc, servidor), []);
});

test('workspace local: operações, revisões e tombstones', async (t) => {
  const dir = tempDir(t);
  const ws = createLocalWorkspace(dir);

  const primeira = await ws.applyOps([
    { key: 'study-journal-notes-2026-01-01', value: 'primeira' },
    { key: 'study-journal-tasks-2026-01-01', value: '[]' },
  ]);
  assert.equal(primeira.revision, 1);
  assert.equal(primeira.keys.length, 2);

  const semAlteracoes = await ws.applyOps([{ key: 'study-journal-notes-2026-01-01', value: 'primeira' }]);
  assert.equal(semAlteracoes.revision, 1, 'escrever o mesmo valor não cria revisão');
  assert.equal(semAlteracoes.keys.length, 0);

  const segunda = await ws.applyOps([{ key: 'study-journal-notes-2026-01-01', value: 'segunda' }]);
  assert.equal(segunda.revision, 2);

  const delta = await ws.changesSince(1);
  assert.equal(delta.reset, false);
  assert.equal(delta.revision, 2);
  assert.deepEqual(delta.keys.map((k) => k.value), ['segunda']);

  await ws.applyOps([{ key: 'study-journal-notes-2026-01-01', deleted: true }]);
  const snap = await ws.snapshot();
  const nota = snap.keys.find((k) => k.key === 'study-journal-notes-2026-01-01');
  assert.equal(nota.deleted, true);
  assert.equal(nota.value, null);
});

test('workspace local: sobrevive a reinício e guarda ficheiros', async (t) => {
  const dir = tempDir(t);
  const ws = createLocalWorkspace(dir);
  await ws.applyOps([{ key: 'study-journal-pdfs', value: '[]' }]);
  const ficheiro = await ws.putFile('abc123', { nome: 'resumo.pdf', tipo: 'application/pdf' }, Buffer.from('%PDF-1.4 teste'));
  assert.equal(ficheiro.tamanho, 14);

  const outro = createLocalWorkspace(dir);
  const snap = await outro.snapshot();
  assert.equal(snap.keys.find((k) => k.key === 'study-journal-pdfs').value, '[]');
  const guardado = await outro.getFile('abc123');
  assert.equal(guardado.nome, 'resumo.pdf');
  assert.equal(Buffer.from(guardado.content).toString(), '%PDF-1.4 teste');

  await outro.deleteFile('abc123');
  assert.equal(await outro.getFile('abc123'), null);
  assert.equal((await outro.listFiles()).length, 0);
});

test('workspace local: importa o snapshot e os ficheiros antigos uma só vez', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'sync.json'), JSON.stringify({
    data: { days: { '2026-02-02': { notes: 'legado', updatedAt: 5 } } },
  }));
  fs.mkdirSync(path.join(dir, 'ficheiros'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ficheiros', 'velho1'), 'bytes');
  fs.writeFileSync(path.join(dir, 'ficheiros', 'velho1.meta.json'), JSON.stringify({ nome: 'velho.pdf', tipo: 'application/pdf' }));

  const ws = createLocalWorkspace(dir);
  const r = await ws.init();
  assert.equal(r.keys, 2);
  assert.equal(r.files, 1);

  const snap = await ws.snapshot();
  assert.equal(snap.keys.find((k) => k.key === 'study-journal-notes-2026-02-02').value, 'legado');
  assert.equal((await ws.getFile('velho1')).nome, 'velho.pdf');

  const segunda = await ws.init();
  assert.equal(segunda.keys, 0, 'a migração não volta a correr');
});

test('workspace local: o registo de sessões é unido entre aparelhos', async (t) => {
  const dir = tempDir(t);
  const ws = createLocalWorkspace(dir);
  await ws.applyOps([{ key: 'study-journal-session-log', value: JSON.stringify([{ subject: 'Mat', minutos: 10, created: 1 }]) }]);
  const r = await ws.applyOps([{ key: 'study-journal-session-log', value: JSON.stringify([{ subject: 'Fis', minutos: 5, created: 2 }]) }]);
  const lista = JSON.parse(r.keys.find((k) => k.key === 'study-journal-session-log').value);
  assert.deepEqual(lista.map((s) => s.subject), ['Mat', 'Fis']);
});

test('workspace PostgreSQL: revisões, deltas, ficheiros e migração do app_state', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(null);

  await base.store.putState({ rev: 7, updatedAt: 'x', gid: 'g', data: { days: { '2026-04-01': { notes: 'antigo', updatedAt: 3 } } } });

  const importado = await base.store.workspaceImportLegacy('default');
  assert.equal(importado.keys, 2);

  const snap = await base.store.workspaceSnapshot('default');
  assert.equal(snap.keys.find((k) => k.key === 'study-journal-notes-2026-04-01').value, 'antigo');

  const ops = await base.store.workspaceApplyOps('default', [
    { key: 'study-journal-pdfs', value: '[]' },
    { key: 'study-journal-notes-2026-04-01', value: 'novo' },
  ], 'cliente-1');
  assert.equal(ops.keys.length, 2);

  const delta = await base.store.workspaceChangesSince('default', snap.revision);
  assert.equal(delta.reset, false);
  assert.equal(delta.keys.length, 2);
  assert.ok(delta.revision > snap.revision);

  await base.store.workspaceApplyOps('default', [{ key: 'study-journal-pdfs', deleted: true }]);
  const depois = await base.store.workspaceSnapshot('default');
  assert.equal(depois.keys.find((k) => k.key === 'study-journal-pdfs').deleted, true);

  const posto = await base.store.workspacePutFile('default', 'f1', { nome: 'a.pdf', tipo: 'application/pdf' }, Buffer.from('%PDF'));
  assert.equal(posto.tamanho, 4);
  const lido = await base.store.workspaceGetFile('default', 'f1');
  assert.equal(lido.nome, 'a.pdf');
  assert.equal(Buffer.from(lido.content).toString(), '%PDF');
  assert.equal((await base.store.workspaceListFiles('default')).length, 1);

  await base.store.workspaceDeleteFile('default', 'f1');
  assert.equal(await base.store.workspaceGetFile('default', 'f1'), null);
  assert.equal((await base.store.workspaceListFiles('default')).length, 0);
});

test('fachada: usa PostgreSQL quando existe e disco quando não existe', async (t) => {
  const dir = tempDir(t);
  const local = createWorkspace({ dataDir: dir });
  assert.equal(local.persistente, false);
  await local.applyOps([{ key: 'study-journal-notas', value: 'x' }]);
  assert.equal((await local.snapshot()).keys.length, 1);

  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(null);
  const pg = createWorkspace({ pgStore: base.store, dataDir: dir });
  assert.equal(pg.persistente, true);
  await pg.applyOps([{ key: 'study-journal-notas', value: 'y' }]);
  assert.equal((await pg.snapshot()).keys[0].value, 'y');
});
