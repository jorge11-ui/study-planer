'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const weekly = require('../src/weekly-review');

test('weekly review agrega sessões, tarefas, domínio, dificuldades e revisões do intervalo', () => {
  const report = weekly.generate({
    now: new Date('2026-11-25T12:00:00'),
    sessionsByDay: {
      '2026-11-23': { 'Matemática A': 45, 'Física e Química A': 20 },
      '2026-11-27': { 'Matemática A': 30 },
      '2026-11-30': { 'Matemática A': 200 },
    },
    tasks: [
      { date: '2026-11-23', task: { text: 'Feito', done: true } },
      { date: '2026-11-24', task: { text: 'Pendente', done: false } },
      { date: '2026-11-30', task: { text: 'Fora da semana', done: false } },
    ],
    exams: [{ id: 'disc-mat', nome: 'Matemática A' }, { id: 'disc-fqa', nome: 'Física e Química A' }],
    topics: [
      { id: 't1', kind: 'topic', disciplinaId: 'disc-mat', titulo: '<Funções>', masteryPct: 35, difficulty: 4, nextReviewDate: '2026-11-24', dificuldades: 'Limites' },
      { id: 't2', tipo: 'topico', disciplinaId: 'disc-fqa', titulo: 'Ondas', masteryPct: 90 },
    ],
    reviews: [
      { topicId: 't1', date: '2026-11-23', masteryPct: 30 },
      { topicId: 't1', date: '2026-11-25', masteryPct: 40 },
    ],
  });
  assert.equal(report.start, '2026-11-23');
  assert.equal(report.end, '2026-11-29');
  assert.equal(report.minutes, 95);
  assert.equal(report.completedTasks, 1);
  assert.equal(report.pendingTasks, 1);
  assert.equal(report.weakTopics[0].title, '<Funções>');
  assert.equal(report.overdue, 1);
  assert.equal(report.masteryChange, 10);
  assert.equal(report.leastStudied[0].name, 'Física e Química A');
});

test('weekly review não inventa objetivos nem estatísticas quando não há dados', () => {
  const report = weekly.generate({ now: new Date('2026-11-25T12:00:00') });
  assert.equal(report.minutes, 0);
  assert.equal(report.taskCount, 0);
  assert.equal(report.masteryChange, null);
  assert.match(report.recommendations[0], /Ainda não há registos/);
});

test('weekly review reconhece as abreviações de disciplina usadas no diário', () => {
  const report = weekly.generate({
    now: new Date('2026-11-25T12:00:00'),
    sessionsByDay: { '2026-11-24': { FQA: 25, Biologia: 10, Mat: 15 } },
    exams: [
      { id: 'disc-fqa', nome: 'Física e Química A' },
      { id: 'disc-bio', nome: 'Biologia e Geologia' },
      { id: 'disc-mat', nome: 'Matemática A' },
    ],
  });
  assert.equal(report.sessionsBySubject.fqa, 25);
  assert.equal(report.sessionsBySubject.bio, 10);
  assert.equal(report.sessionsBySubject.mat, 15);
  assert.equal(report.leastStudied.find(x => x.name === 'Biologia e Geologia').minutes, 10);
});

test('weekly review escapa nomes ao gerar a interface', () => {
  let html = '';
  weekly.render({ start: '2026-11-23', end: '2026-11-29', minutes: 0, completedTasks: 0, pendingTasks: 0,
    pendingTaskTitles: [], leastStudied: [], weakTopics: [{ title: '<img src=x>', subject: 'Disciplina', mastery: 0 }],
    overdue: 0, masteryChange: null, recommendations: ['Ok'] }, { set innerHTML(value) { html = value; } });
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img src=x&gt;/);
});
