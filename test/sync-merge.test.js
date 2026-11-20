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

test('sync: merge não muta os objetos recebidos', () => {
  const guardado = { days: {}, pdfs: [{ id: 'a' }], pdfsApagados: [] };
  const recebido = { days: {}, pdfs: [{ id: 'b' }], pdfsApagados: [{ id: 'a', ts: Date.now() }] };
  const copiaGuardado = JSON.parse(JSON.stringify(guardado));
  const copiaRecebido = JSON.parse(JSON.stringify(recebido));
  fundirSyncData(guardado, recebido);
  assert.deepEqual(guardado, copiaGuardado);
  assert.deepEqual(recebido, copiaRecebido);
});
