'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = process.env.SYLLABUS_SOURCE_DIR || '/home/jorge/obsidian_notes/Revisao_exame';
const existe = fs.existsSync(path.join(ORIGEM, 'Topicos-Matematica.md')) && fs.existsSync(path.join(ORIGEM, 'Topicos-FQ.md')) && fs.existsSync(path.join(ORIGEM, 'Topicos-Portugues.md'));

function gerar() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-syllabus-'));
  execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'build-syllabus.js'), ORIGEM], {
    env: { ...process.env, SYLLABUS_OUT_DIR: destino },
    stdio: 'pipe',
  });
  const catalogo = JSON.parse(fs.readFileSync(path.join(destino, 'exams.json'), 'utf8'));
  fs.rmSync(destino, { recursive: true, force: true });
  return catalogo;
}

test('gerador: duas execuções produzem exatamente os mesmos IDs', { skip: !existe && 'notas de origem não disponíveis' }, () => {
  const a = gerar();
  const b = gerar();
  const ids = (c) => [...c.nodes, ...(c.draftNodes || [])].map((n) => n.id).sort();
  assert.deepEqual(ids(a), ids(b));
  assert.deepEqual(
    [...a.nodes, ...(a.draftNodes || [])].map((n) => [n.id, n.parentId, n.title]),
    [...b.nodes, ...(b.draftNodes || [])].map((n) => [n.id, n.parentId, n.title]),
  );
});

test('gerador: output cumpre as invariantes do catálogo', { skip: !existe && 'notas de origem não disponíveis' }, () => {
  const c = gerar();
  const todos = [...c.nodes, ...(c.draftNodes || [])];
  const ids = new Set();
  for (const n of todos) {
    assert.ok(!ids.has(n.id), `id duplicado: ${n.id}`);
    ids.add(n.id);
    assert.notEqual(n.id, n.parentId, `auto-parentesco: ${n.id}`);
    if (n.parentId) assert.ok(ids.has(n.parentId) || todos.some((x) => x.id === n.parentId), `pai em falta: ${n.id}`);
  }
  for (const n of c.nodes) {
    assert.notEqual(n.status, 'draft');
    const pai = n.parentId ? todos.find((x) => x.id === n.parentId) : null;
    if (n.kind === 'topic' || n.kind === 'subtheme') assert.ok(pai, `tópico sem pai: ${n.id}`);
    if (pai && n.kind === 'theme') assert.equal(pai.kind, 'domain', `tema fora de um domínio: ${n.id}`);
    if (pai && (n.kind === 'topic' || n.kind === 'subtheme')) {
      assert.ok(['theme', 'subtheme'].includes(pai.kind), `pai inválido para ${n.id} (${pai.kind})`);
    }
  }
});

test('gerador: substitui Matemática/FQ, importa Português e conserva BioGeo', { skip: !existe && 'notas de origem não disponíveis' }, () => {
  const c = gerar();
  const byExam = (id) => c.nodes.filter(n => n.examId === id);
  assert.ok(byExam('disc-mat').some(n => n.title === 'Numeros complexos(maior presença)'));
  assert.ok(byExam('disc-fqa').some(n => n.title === 'Energia e sua conservação'));
  assert.ok(byExam('disc-pt').some(n => n.title.includes('Poesia Trovadoresca')));
  assert.ok(byExam('disc-bio').length > 0);
  assert.equal(c.sourceNotes, 'Revisao_exame');
});
