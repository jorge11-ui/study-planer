'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const CAMINHO = path.join(RAIZ, 'data', 'static', 'exams.json');
const catalogo = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));

const TODOS = [...catalogo.nodes, ...(catalogo.draftNodes || [])];
const POR_ID = new Map(TODOS.map((n) => [n.id, n]));
const EXAMES = new Map(catalogo.exams.map((e) => [e.id, e]));

function profundidade(no) {
  let d = 0;
  let atual = no;
  const vistos = new Set([no.id]);
  while (atual.parentId) {
    assert.ok(POR_ID.has(atual.parentId), `pai inexistente: ${atual.id} -> ${atual.parentId}`);
    const pai = POR_ID.get(atual.parentId);
    assert.ok(!vistos.has(pai.id), `ciclo na hierarquia: ${no.id}`);
    vistos.add(pai.id);
    atual = pai;
    d += 1;
  }
  return d;
}

function slug(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function slu(){
    return 1+1

}

test('catálogo: schema mínimo e versão', () => {
  assert.equal(typeof catalogo.schemaVersion, 'number');
  assert.match(catalogo.version, /^\d{4}-\d{2}\.\d+$/);
  assert.equal(catalogo.targetExamYear, 2027);
  assert.equal(catalogo.sourceExamYear, 2026, 'as notas-fonte são de 2026; não as apresentar como 2027');
  assert.ok(Array.isArray(catalogo.exams) && catalogo.exams.length > 0);
  assert.ok(Array.isArray(catalogo.nodes) && catalogo.nodes.length > 0);
  assert.ok(catalogo.notes && /não substituem|validar/i.test(catalogo.notes), 'o catálogo deve declarar que não é oficial');
});

test('catálogo: cada exame tem id, nome e estado válido', () => {
  const ids = new Set();
  for (const exame of catalogo.exams) {
    assert.match(exame.id, /^disc-[a-z0-9-]+$/);
    assert.ok(!ids.has(exame.id), `exame duplicado: ${exame.id}`);
    ids.add(exame.id);
    assert.ok(exame.name && exame.name.trim(), `exame sem nome: ${exame.id}`);
    assert.ok(['active', 'draft'].includes(exame.status), `estado inválido: ${exame.id}`);
    assert.ok(Array.isArray(exame.years) && exame.years.length, `anos em falta: ${exame.id}`);
  }
});

test('catálogo: IDs únicos, curtos e sem caracteres inesperados', () => {
  const vistos = new Set();
  for (const no of TODOS) {
    assert.match(no.id, /^[a-z0-9][a-z0-9:-]*$/, `id inválido: ${no.id}`);
    assert.ok(!vistos.has(no.id), `id duplicado: ${no.id}`);
    vistos.add(no.id);
    assert.ok(no.id.length <= 132, `id demasiado longo (${no.id.length}): ${no.id}`);
  }
  assert.equal(vistos.size, TODOS.length);
});

test('catálogo: nenhum nó é pai de si próprio, órfão ou em ciclo', () => {
  for (const no of TODOS) {
    assert.notEqual(no.id, no.parentId, `auto-parentesco: ${no.id}`);
    const d = profundidade(no);
    assert.ok(d <= 3, `hierarquia funda demais (${d}): ${no.id}`);
  }
});

test('catálogo: todo o nó aponta para um exame existente e tem campos completos', () => {
  for (const no of TODOS) {
    assert.ok(EXAMES.has(no.examId), `exame inexistente em ${no.id}`);
    assert.ok(['domain', 'theme', 'subtheme', 'topic'].includes(no.kind), `kind inválido: ${no.id}`);
    assert.ok(typeof no.title === 'string' && no.title.trim(), `título em falta: ${no.id}`);
    assert.ok(Number.isInteger(no.importance) && no.importance >= 1 && no.importance <= 5, `importância inválida: ${no.id}`);
    assert.ok(Number.isInteger(no.difficulty) && no.difficulty >= 1 && no.difficulty <= 5, `dificuldade inválida: ${no.id}`);
  }
});

test('catálogo: apenas exames ativos entram em nodes; rascunhos ficam isolados', () => {
  const ativos = new Set(catalogo.exams.filter((e) => e.status === 'active').map((e) => e.id));
  for (const no of catalogo.nodes) {
    assert.ok(ativos.has(no.examId), `nó ativo de exame não ativo: ${no.id}`);
    assert.notEqual(no.status, 'draft', `nó rascunho em nodes: ${no.id}`);
  }
  for (const no of catalogo.draftNodes || []) {
    assert.equal(no.status, 'draft', `draftNodes contém nó ativo: ${no.id}`);
    assert.ok(no.source && /validar|por validar/i.test(no.source), `rascunho sem aviso de validação: ${no.id}`);
  }
});

test('catálogo: cada exame ativo tem tópicos e cada tópico pertence a um tema', () => {
  const porExame = new Map();
  for (const no of catalogo.nodes) {
    porExame.set(no.examId, (porExame.get(no.examId) || 0) + 1);
    if (no.kind === 'topic' || no.kind === 'subtheme') {
      assert.ok(no.parentId, `tópico sem pai: ${no.id}`);
      const pai = POR_ID.get(no.parentId);
      assert.ok(['theme', 'subtheme'].includes(pai.kind), `tópico ${no.id} pendurado em ${pai.kind}`);
    }
    if (no.kind === 'theme') {
      assert.ok(no.parentId, `tema sem domínio: ${no.id}`);
      assert.equal(POR_ID.get(no.parentId).kind, 'domain', `tema ${no.id} fora de um domínio`);
    }
  }
  for (const exame of catalogo.exams.filter((e) => e.status === 'active')) {
    assert.ok((porExame.get(exame.id) || 0) > 20, `exame ativo com poucos tópicos: ${exame.id}`);
  }
});

test('catálogo: IDs derivam do caminho e não colidem por truncagem', () => {
  for (const no of catalogo.nodes) {
    const partes = [];
    let atual = no;
    while (atual) {
      partes.unshift(slug(atual.title));
      atual = atual.parentId ? POR_ID.get(atual.parentId) : null;
    }
    const base = `${no.examId}:${partes.join('-')}`.slice(0, 120);
    assert.ok(
      no.id === base || no.id.startsWith(`${base}-`),
      `id não determinístico: ${no.id} (esperado ${base})`,
    );
  }
  const titulos = new Set();
  for (const no of catalogo.nodes) {
    const chave = `${no.examId}|${no.parentId}|${no.title}`;
    assert.ok(!titulos.has(chave), `tópico duplicado no mesmo pai: ${no.title}`);
    titulos.add(chave);
  }
});

test('catálogo: manifest coerente com o JSON', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'static', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, catalogo.version);
  assert.equal(manifest.nodeCount, TODOS.length);
  assert.equal(manifest.activeNodeCount, catalogo.nodes.length);
  assert.equal(manifest.draftNodeCount, (catalogo.draftNodes || []).length);
  assert.equal(manifest.targetExamYear, catalogo.targetExamYear);
  assert.equal(manifest.sourceExamYear, catalogo.sourceExamYear);
});
