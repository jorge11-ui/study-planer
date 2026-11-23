'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dadosSyncValidos, numMinSync, fundirSyncData, fundirColecaoSync } = require('../lib/sync-merge');

test('sync: rejeita documentos sem days', () => {
  assert.equal(dadosSyncValidos(null), false);
  assert.equal(dadosSyncValidos([]), false);
  assert.equal(dadosSyncValidos({}), false);
  assert.equal(dadosSyncValidos({ days: [] }), false);
  assert.equal(dadosSyncValidos({ days: {} }), true);
});

test('sync: cliente antigo que envia examesV2 nulo não apaga o Exam Center', () => {
  const existente = { days: {}, examesV2: { topics: [{ id: 't1' }] } };
  const fundido = fundirSyncData(existente, { days: {}, examesV2: null });
  assert.deepEqual(fundido.examesV2, existente.examesV2);
});

test('sync: minutos nunca ficam negativos ou NaN', () => {
  assert.equal(numMinSync(undefined), 0);
  assert.equal(numMinSync('x'), 0);
  assert.equal(numMinSync(-5), 0);
  assert.equal(numMinSync('12'), 12);
});

test('sync: secções simples são substituídas pelo valor recebido', () => {
  const guardado = { days: { '2026-01-01': { estudo: 30 } }, habitos: { agua: 1 }, extra: 'antigo' };
  const recebido = { days: { '2026-01-02': { estudo: 60 } }, habitos: { agua: 2 } };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.days, recebido.days);
  assert.deepEqual(out.habitos, recebido.habitos);
  assert.equal(out.extra, 'antigo', 'campos ausentes no push não desaparecem');
});

test('sync: sessões base ficam com o máximo por dia/matéria (monotónico)', () => {
  const guardado = {
    days: {},
    sessoesBase: { '2026-01-01': { mat: 30, fqa: 10 } },
    sessoes: { '2026-01-01': { mat: 30, fqa: 10 } },
  };
  const recebido = {
    days: {},
    sessoesBase: { '2026-01-01': { mat: 20, fqa: 25 }, '2026-01-02': { mat: 45 } },
  };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.sessoesBase, {
    '2026-01-01': { mat: 30, fqa: 25 },
    '2026-01-02': { mat: 45 },
  });
  assert.deepEqual(out.sessoes, out.sessoesBase, 'sessoes acompanha sessoesBase quando não vem no push');
});

test('sync: minutos por aparelho fazem merge por máximo', () => {
  const guardado = { days: {}, sessoesSlots: { '2026-01-01': { mat: { telemovel: 20 } } } };
  const recebido = { days: {}, sessoesSlots: { '2026-01-01': { mat: { portatil: 15, telemovel: 5 } } } };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.sessoesSlots['2026-01-01'].mat, { telemovel: 20, portatil: 15 });
});

test('sync: PDFs são unidos por id e tombstones removem entradas', () => {
  const guardado = {
    days: {},
    pdfs: [{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }],
    pdfsApagados: [],
  };
  const recebido = {
    days: {},
    pdfs: [{ id: 'b', titulo: 'B2' }, { id: 'c', titulo: 'C' }],
    pdfsApagados: [{ id: 'a', ts: Date.now() }],
  };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.pdfs.map((p) => p.id).sort(), ['b', 'c']);
  assert.equal(out.pdfs.find((p) => p.id === 'b').titulo, 'B2');
  assert.deepEqual(out.pdfsApagados, [{ id: 'a', ts: recebido.pdfsApagados[0].ts }]);
});

test('sync: tombstones expirados deixam de esconder o documento', () => {
  const antigo = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const out = fundirColecaoSync(
    { pdfs: [{ id: 'a' }], pdfsApagados: [{ id: 'a', ts: antigo }] },
    { pdfs: [{ id: 'a' }], pdfsApagados: [] },
    'pdfs',
    'pdfsApagados',
  );
  assert.deepEqual(out.lista.map((p) => p.id), ['a']);
  assert.deepEqual(out.apagados, []);
});

test('sync: todas as semanas são preservadas e a mais recente ganha', () => {
  const guardado = {
    days: {},
    semanalTodas: {
      '2026-11-16': [{ id: 'a', titulo: 'Aula antiga' }],
      '2026-11-09': [{ id: 'b', titulo: 'Semana anterior' }],
    },
    semanalTs: { '2026-11-16': 100, '2026-11-09': 50 },
  };
  const recebido = {
    days: {},
    semanalTodas: {
      '2026-11-16': [{ id: 'a', titulo: 'Aula nova' }],
    },
    semanalTs: { '2026-11-16': 200 },
  };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.semanalTodas['2026-11-16'], [{ id: 'a', titulo: 'Aula nova' }]);
  assert.deepEqual(out.semanalTodas['2026-11-09'], [{ id: 'b', titulo: 'Semana anterior' }]);
  assert.equal(out.semanalTs['2026-11-16'], 200);
  assert.equal(out.semanalTs['2026-11-09'], 50);
});

test('sync: uma semana mais antiga no push não apaga a versão recente', () => {
  const guardado = {
    days: {},
    semanalTodas: { '2026-11-16': [{ id: 'novo' }] },
    semanalTs: { '2026-11-16': 300 },
  };
  const recebido = {
    days: {},
    semanalTodas: { '2026-11-16': [{ id: 'antigo' }] },
    semanalTs: { '2026-11-16': 200 },
  };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.semanalTodas['2026-11-16'], [{ id: 'novo' }]);
  assert.equal(out.semanalTs['2026-11-16'], 300);
});

test('sync: apagar uma semana com carimbo novo é respeitado', () => {
  const guardado = {
    days: {},
    semanalTodas: { '2026-11-16': [{ id: 'a' }] },
    semanalTs: { '2026-11-16': 100 },
  };
  const recebido = {
    days: {},
    semanalTodas: { '2026-11-16': [] },
    semanalTs: { '2026-11-16': 200 },
  };
  const out = fundirSyncData(guardado, recebido);
  assert.deepEqual(out.semanalTodas['2026-11-16'], []);
});

test('sync: registo de sessões faz união sem duplicar', () => {
  const guardado = {
    days: {},
    sessoesLog: [
      { created: 2, subject: 'Mat', minutos: 30, day: '2026-11-20' },
      { created: 1, subject: 'FQA', minutos: 15, day: '2026-11-20' },
    ],
  };
  const recebido = {
    days: {},
    sessoesLog: [
      { created: 2, subject: 'Mat', minutos: 30, day: '2026-11-20' },
      { created: 3, subject: 'Port', minutos: 20, day: '2026-11-21' },
    ],
  };
  const out = fundirSyncData(guardado, recebido);
  assert.equal(out.sessoesLog.length, 3);
  assert.deepEqual(out.sessoesLog.map((r) => r.created), [1, 2, 3]);
});

test('sync: quadro, assistente, objetivo e nota rápida usam o carimbo mais recente', () => {
  const guardado = {
    days: {},
    whiteboardDraft: { content: '{"objects":[]}', updatedAt: 100 },
    whiteboardGrid: { visible: true, updatedAt: 100 },
    assistente: { hist: [{ papel: 'user', texto: 'antigo' }], updatedAt: 100 },
    sessaoObjetivo: { valor: 'antigo', updatedAt: 100 },
    floatingNote: { data: { text: 'antigo' }, updatedAt: 100 },
  };
  const recebido = {
    days: {},
    whiteboardDraft: { content: '{"objects":[1]}', updatedAt: 200 },
    whiteboardGrid: { visible: false, updatedAt: 50 },
    assistente: { hist: [{ papel: 'user', texto: 'novo' }], updatedAt: 200 },
    sessaoObjetivo: { valor: 'novo', updatedAt: 200 },
    floatingNote: { data: { text: 'novo' }, updatedAt: 200 },
  };
  const out = fundirSyncData(guardado, recebido);
  assert.equal(out.whiteboardDraft.content, '{"objects":[1]}');
  assert.equal(out.whiteboardGrid.visible, true, 'grelha antiga não sobrepõe');
  assert.equal(out.assistente.hist[0].texto, 'novo');
  assert.equal(out.sessaoObjetivo.valor, 'novo');
  assert.equal(out.floatingNote.data.text, 'novo');
});

test('sync: push antigo sem secções novas não apaga o que o servidor já tem', () => {
  const guardado = {
    days: {},
    assistente: { hist: [{ papel: 'user', texto: 'guardado' }], updatedAt: 100 },
    whiteboardDraft: { content: '{"objects":[]}', updatedAt: 100 },
    sessoesLog: [{ created: 1, subject: 'Mat', minutos: 30 }],
  };
  const out = fundirSyncData(guardado, { days: {} });
  assert.deepEqual(out.assistente, guardado.assistente);
  assert.deepEqual(out.whiteboardDraft, guardado.whiteboardDraft);
  assert.deepEqual(out.sessoesLog, guardado.sessoesLog);
});

test('sync: merge não muta os objetos recebidos', () => {
  const guardado = { days: {}, pdfs: [{ id: 'a' }], pdfsApagados: [] };
  const recebido = { days: {}, pdfs: [{ id: 'b' }], pdfsApagados: [{ id: 'a', ts: Date.now() }] };
  const copiaGuardado = JSON.parse(JSON.stringify(guardado));
  const copiaRecebido = JSON.parse(JSON.stringify(recebido));
  fundirSyncData(guardado, recebido);
  assert.deepEqual(guardado, copiaGuardado);
  assert.deepEqual(recebido, copiaRecebido);
});
