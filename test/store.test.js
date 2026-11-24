'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarBase } = require('./helpers/pg');

const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'static', 'exams.json'), 'utf8'));

function contar(base, sql) {
  return base.db.public.many(sql);
}

test('store: init cria o schema e é idempotente', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());

  const primeira = await base.store.init(CATALOGO);
  const segunda = await base.store.init(CATALOGO);

  assert.deepEqual(primeira, segunda);
  assert.equal(primeira.exams, CATALOGO.exams.filter((e) => e.status === 'active').length, 'todos os exames ativos são semeados');
  assert.equal(primeira.nodes, CATALOGO.nodes.length);

  const migracoes = contar(base, 'SELECT version FROM schema_migrations');
  assert.deepEqual(migracoes.map((m) => m.version), ['001_initial', '002_exam_center_records']);
});

test('store: semeia todos os nós ativos com o pai correto, sem duplicados', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const linhas = contar(base, 'SELECT id, exam_id, parent_id, kind, title FROM curriculum_items');
  assert.equal(linhas.length, CATALOGO.nodes.length + CATALOGO.exams.filter((e) => e.status === 'active').length);

  const porId = new Map(linhas.map((l) => [l.id, l]));
  for (const no of CATALOGO.nodes) {
    const linha = porId.get(no.id);
    assert.ok(linha, `nó não semeado: ${no.id}`);
    assert.equal(linha.exam_id, no.examId);
    assert.equal(linha.parent_id, no.parentId || null, `pai errado: ${no.id}`);
    assert.equal(linha.kind, no.kind);
    assert.equal(linha.title, no.title);
  }
  for (const exame of CATALOGO.exams.filter((e) => e.status === 'active')) {
    const linha = porId.get(exame.id);
    assert.ok(linha, `exame não semeado: ${exame.id}`);
    assert.equal(linha.kind, 'exam');
    assert.equal(linha.parent_id, null);
  }

  const ids = linhas.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('store: todo o catálogo ativo é semeado e não há rascunhos no catálogo inicial', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const rascunhos = (CATALOGO.draftNodes || []).map((n) => n.id);
  const linhas = contar(base, 'SELECT id FROM curriculum_items');
  const ids = new Set(linhas.map((l) => l.id));
  for (const id of rascunhos) assert.ok(!ids.has(id), `rascunho semeado: ${id}`);
  assert.ok(ids.has('disc-bio'), 'Biologia e Geologia tem Aprendizagens Essenciais em vigor');
});

test('store: uma versão nova substitui o catálogo e remove nós obsoletos', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const reduzido = {
    ...CATALOGO,
    version: '2026-12.1',
    nodes: CATALOGO.nodes.slice(0, 10).map((n) => ({ ...n, parentId: n.parentId && CATALOGO.nodes.slice(0, 10).some((p) => p.id === n.parentId) ? n.parentId : null })),
    draftNodes: [],
    exams: CATALOGO.exams.filter((e) => e.status === 'active'),
  };
  const resultado = await base.store.init(reduzido);
  assert.equal(resultado.nodes, 10);

  const linhas = contar(base, 'SELECT id, version FROM curriculum_items');
  assert.equal(linhas.length, 10 + CATALOGO.exams.filter((e) => e.status === 'active').length);
  assert.ok(linhas.every((l) => l.version === '2026-12.1'));
});

test('store: catálogo inválido é rejeitado e não altera a base', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const casos = [
    { nome: 'id duplicado', mut: (c) => { c.nodes = [...c.nodes, { ...c.nodes[0] }]; } },
    { nome: 'auto-parentesco', mut: (c) => { c.nodes[0].parentId = c.nodes[0].id; } },
    { nome: 'pai inexistente', mut: (c) => { c.nodes[0].parentId = 'nao-existe'; } },
    { nome: 'exame inexistente', mut: (c) => { c.nodes[0].examId = 'disc-xx'; } },
    { nome: 'sem título', mut: (c) => { c.nodes[0].title = ''; } },
    { nome: 'ciclo', mut: (c) => { c.nodes[1].parentId = c.nodes[2].id; c.nodes[2].parentId = c.nodes[1].id; } },
  ];

  for (const caso of casos) {
    const catalogo = JSON.parse(JSON.stringify(CATALOGO));
    caso.mut(catalogo);
    await assert.rejects(() => base.store.init(catalogo), undefined, caso.nome);
  }

  const linhas = contar(base, 'SELECT id, version FROM curriculum_items');
  assert.equal(linhas.length, CATALOGO.nodes.length + CATALOGO.exams.filter((e) => e.status === 'active').length);
  assert.ok(linhas.every((l) => l.version === CATALOGO.version));
});

test('store: estado pessoal faz round-trip e mantém JSON complexo', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  assert.equal(await base.store.getState(), null);
  const doc = {
    rev: 7,
    updatedAt: '2026-01-01T00:00:00.000Z',
    gid: 'abc',
    data: { days: { '2026-01-01': { estudo: 45 } }, pdfs: [{ id: 'p1', titulo: 'Ação' }], aninhado: { lista: [1, 2, 3] } },
  };
  await base.store.putState(doc);
  assert.deepEqual(await base.store.getState(), doc);

  await base.store.putState({ ...doc, rev: 8 });
  assert.equal((await base.store.getState()).rev, 8, 'putState substitui o documento');
});

test('store: Exam Center usa registos relacionáveis e mantém o contrato legado de leitura', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);
  const doc = {
    rev: 3,
    gid: 'g1',
    data: {
      days: {},
      examesV2: {
        schemaVersion: 3,
        exams: [{ id: 'disc-mat', nome: 'Matemática A' }],
        topics: [{ id: 'mat:funcoes', disciplinaId: 'disc-mat', masteryPct: 42 }],
        materials: [],
        sessions: [{ id: 'sess-1', topicId: 'mat:funcoes', concluida: true }],
        issues: [],
        practice: [],
        reviews: [],
        planHistory: [],
        settings: { minutesPerDay: 75 },
        activePlan: { id: 'plan-1' },
      },
    },
  };

  await base.store.putState(doc);
  assert.deepEqual(await base.store.getState(), doc);

  const linhas = contar(base, 'SELECT collection,id,payload FROM exam_records ORDER BY collection,id');
  assert.deepEqual(linhas.map(row => [row.collection, row.id]), [
    ['exams', 'disc-mat'], ['sessions', 'sess-1'], ['topics', 'mat:funcoes'],
  ]);
  const snapshot = contar(base, "SELECT payload FROM app_state WHERE id='sync'")[0].payload;
  assert.equal(Object.hasOwn(snapshot.data, 'examesV2'), false, 'o snapshot não duplica o Exam Center');

  const atualizado = structuredClone(doc);
  atualizado.rev = 4;
  atualizado.data.examesV2.topics[0].masteryPct = 68;
  atualizado.data.examesV2.sessions = [];
  await base.store.putState(atualizado);
  assert.deepEqual(await base.store.getState(), atualizado);
  assert.deepEqual(contar(base, "SELECT id FROM exam_records WHERE collection='sessions'"), []);
});

test('store: sessões são upsert/delete por token, sem tocar nas outras', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  await base.store.putSession('a', { criadoEm: 1 });
  await base.store.putSession('b', { criadoEm: 2 });
  await base.store.putSession('a', { criadoEm: 3 });
  assert.deepEqual(await base.store.getSessions(), { a: { criadoEm: 3 }, b: { criadoEm: 2 } });

  await base.store.deleteSession('a');
  assert.deepEqual(await base.store.getSessions(), { b: { criadoEm: 2 } });

  await base.store.putSessions({ c: { criadoEm: 4 } });
  assert.deepEqual(await base.store.getSessions(), { c: { criadoEm: 4 } });
});

test('store: ficheiros persistem bytes e metadados, e podem ser apagados', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const bytes = Buffer.from('%PDF-1.4 teste');
  await base.store.putFile('f1', { nome: 'a.pdf', tipo: 'application/pdf' }, bytes);
  const guardado = await base.store.getFile('f1');
  assert.deepEqual(guardado.metadata, { nome: 'a.pdf', tipo: 'application/pdf' });
  assert.deepEqual(Buffer.from(guardado.content), bytes);

  const lista = await base.store.listFiles();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, 'f1');
  assert.equal(Number(lista[0].tamanho), bytes.length);

  await base.store.putFile('f1', { nome: 'b.pdf' }, Buffer.from('novo'));
  assert.deepEqual(Buffer.from((await base.store.getFile('f1')).content), Buffer.from('novo'));

  await base.store.deleteFile('f1');
  assert.equal(await base.store.getFile('f1'), null);
});

test('store: erro a meio de uma transação faz rollback', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const catalogo = JSON.parse(JSON.stringify(CATALOGO));
  // Um exame válido e um nó inválido: a validação falha antes de escrever.
  catalogo.nodes[catalogo.nodes.length - 1].title = '';
  await assert.rejects(() => base.store.init(catalogo));
  assert.equal(contar(base, 'SELECT id FROM curriculum_items').length, CATALOGO.nodes.length + CATALOGO.exams.filter((e) => e.status === 'active').length);

  // A base continua utilizável depois do rollback.
  await base.store.putState({ rev: 1, data: { days: {} } });
  assert.equal((await base.store.getState()).rev, 1);
});

test('store: importa sync.json/sessoes.json legados uma única vez', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());

  fs.writeFileSync(path.join(base.dataDir, 'sync.json'), JSON.stringify({ rev: 3, data: {
    days: { '2026-01-01': { estudo: 10 } },
    examesV2: { topics: [{ id: 'legado-topic', titulo: 'Tópico legado' }] },
  } }));
  fs.writeFileSync(path.join(base.dataDir, 'sessoes.json'), JSON.stringify({ tok: { criadoEm: 5 } }));

  await base.store.init(CATALOGO);
  assert.equal((await base.store.getState()).rev, 3);
  assert.equal((await base.store.getState()).data.examesV2.topics[0].id, 'legado-topic');
  assert.equal(contar(base, "SELECT id FROM exam_records WHERE collection='topics'")[0].id, 'legado-topic');
  assert.deepEqual(await base.store.getSessions(), { tok: { criadoEm: 5 } });

  // Uma segunda importação não sobrepõe o estado já existente.
  await base.store.putState({ rev: 9, data: { days: {} } });
  await base.store.init(CATALOGO);
  assert.equal((await base.store.getState()).rev, 9);
});

test('store: sem DATABASE_URL não há store', () => {
  const { createStore } = require('../db/store');
  assert.equal(createStore(''), null);
  assert.equal(createStore(undefined), null);
});

test('sync por volume: servidor vazio é semeado pelo dispositivo (from_local) com rev novo', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);

  const local = { baseRev: 0, data: { days: { '2026-02-01': { notes: '"a"', updatedAt: 1 } } } };
  const r = await base.store.syncStateByVolume(local);

  assert.equal(r.decision, 'from_local');
  const estado = await base.store.getState();
  assert.equal(estado.rev, 1, 'rev começa em 1 e é numérico');
  assert.deepEqual(estado.data.days, local.data.days);
});

test('sync por volume: dispositivo vazio recebe do servidor (from_remote) sem o sobrescrever', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);
  await base.store.putState({ rev: 4, gid: 'g1', data: { days: { '2026-02-01': { notes: '"x"' } } } });

  const r = await base.store.syncStateByVolume({ baseRev: 0, data: { days: {} } });

  assert.equal(r.decision, 'from_remote');
  assert.deepEqual(r.state.data.days, { '2026-02-01': { notes: '"x"' } });
  assert.equal((await base.store.getState()).rev, 4, 'servidor intacto');
});

test('sync por volume: nunca sobrescreve nem ressuscita dados apagados', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);
  // Servidor já só tem o dia A (o dia B foi apagado por outro aparelho).
  await base.store.putState({ rev: 7, gid: 'g1', data: { days: { A: { notes: '"a"' } } } });

  // Dispositivo desatualizado ainda tem A e B (mais volume).
  const r = await base.store.syncStateByVolume({ baseRev: 5, data: { days: { A: { notes: '"a"' }, B: { notes: '"b"' } } } });

  assert.equal(r.decision, 'synced', 'não promove por volume quando o servidor já tem dados');
  const estado = await base.store.getState();
  assert.equal(estado.rev, 7, 'rev do servidor não muda');
  assert.deepEqual(Object.keys(estado.data.days), ['A'], 'o dia apagado não regressa');
});

test('sync por volume: dois dispositivos com dias diferentes não se apagam', async (t) => {
  const base = criarBase();
  t.after(() => base.fechar());
  await base.store.init(CATALOGO);
  await base.store.putState({ rev: 2, gid: 'g1', data: { days: { X: { notes: '"x"' } } } });

  const r = await base.store.syncStateByVolume({ baseRev: 2, data: { days: { Y: { notes: '"y"' } } } });

  assert.equal(r.decision, 'synced');
  const estado = await base.store.getState();
  assert.deepEqual(Object.keys(estado.data.days), ['X'], 'o dia do servidor não é apagado pelo volume');
});
