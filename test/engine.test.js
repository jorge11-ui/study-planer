'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/exam-engine');

const HOJE = '2026-11-20';
const AMANHA = '2026-11-21';
const EXAMES = [
  { id: 'disc-mat', name: 'Matemática A', dataExame: '2027-06-18' },
  { id: 'disc-fqa', name: 'Física e Química A', dataExame: '2027-06-22' },
];

function topico(extra = {}) {
  return {
    id: 'disc-mat:t1', disciplinaId: 'disc-mat', tipo: 'topico', kind: 'topic',
    titulo: 'Funções', importancia: 3, importance: 3, difficulty: 3,
    estado: 'nao_iniciado', masteryPct: 0, ...extra,
  };
}

test('motor: tema por revisar atrasado tem prioridade sobre tema nunca estudado', () => {
  const atrasado = engine.scoreTopic(topico({
    estado: 'em_progresso', masteryPct: 30, nextReviewDate: '2026-11-10', lastStudiedAt: '2026-11-01T00:00:00Z',
  }), { today: HOJE, examDate: '2027-06-18' });
  const novo = engine.scoreTopic(topico({ id: 'disc-mat:t2', estado: 'nao_iniciado', masteryPct: 0 }), {
    today: HOJE, examDate: '2027-06-18',
  });
  assert.ok(atrasado.score > novo.score, `${atrasado.score} > ${novo.score}`);
  assert.ok(atrasado.reasons.some((r) => /atrasada/.test(r)));
});

test('motor: importância, dificuldade e domínio mudam a pontuação', () => {
  const base = engine.scoreTopic(topico(), { today: HOJE, examDate: '2027-06-18' });
  const importante = engine.scoreTopic(topico({ importance: 5, importancia: 5 }), { today: HOJE, examDate: '2027-06-18' });
  const dificil = engine.scoreTopic(topico({ difficulty: 5 }), { today: HOJE, examDate: '2027-06-18' });
  const dominado = engine.scoreTopic(topico({ masteryPct: 95, estado: 'concluido' }), { today: HOJE, examDate: '2027-06-18' });
  assert.ok(importante.score > base.score);
  assert.ok(dificil.score > base.score);
  assert.ok(dominado.score < base.score);
  assert.ok(base.score >= 0 && base.score <= 100);
});

test('motor: exame mais próximo aumenta a prioridade', () => {
  const longe = engine.scoreTopic(topico(), { today: HOJE, examDate: '2027-06-18' });
  const perto = engine.scoreTopic(topico(), { today: HOJE, examDate: '2026-12-01' });
  assert.ok(perto.score > longe.score);
  assert.equal(perto.daysLeft, 11);
});

test('motor: registar sessão atualiza domínio, estado e revisão', () => {
  const t = topico();
  const r = engine.applySession(t, { durationMin: 40, exerciseCount: 10, correctCount: 9, confidence: 4, difficulty: 3 }, HOJE);
  assert.ok(t.masteryPct > 0 && t.masteryPct < 60);
  assert.equal(t.estado, 'em_progresso');
  assert.equal(t.studyMinutes, 40);
  assert.equal(t.exerciseCount, 10);
  assert.equal(r.intervalDays, 1, 'domínio baixo revê no dia seguinte');
  assert.equal(t.nextReviewDate, AMANHA);
  assert.equal(r.accuracyPct, 90);
});

test('motor: desempenho fraco volta a intervalo curto mesmo com domínio alto', () => {
  const t = topico({ masteryPct: 90, intervalIndex: 2, difficulty: 3 });
  const r = engine.applySession(t, { durationMin: 20, exerciseCount: 10, correctCount: 4, confidence: 5 }, HOJE);
  assert.equal(r.intervalDays, 1);
  assert.equal(t.nextReviewDate, AMANHA);
});

test('motor: desempenho forte alarga o intervalo de revisão', () => {
  const t = topico({ masteryPct: 90, intervalIndex: 2, difficulty: 2 });
  const r = engine.applySession(t, { durationMin: 30, exerciseCount: 10, correctCount: 10, confidence: 5 }, HOJE);
  assert.ok(r.masteryPct >= 85);
  assert.ok(r.intervalDays > 1, `intervalo ${r.intervalDays}`);
  assert.ok(t.nextReviewDate > AMANHA);
});

test('motor: revisões pendentes incluem só tópicos vencidos e ordena pelos mais atrasados', () => {
  const topicos = [
    topico({ id: 'a', nextReviewDate: '2026-11-20' }),
    topico({ id: 'b', nextReviewDate: '2026-11-10' }),
    topico({ id: 'c', nextReviewDate: '2026-12-01' }),
    topico({ id: 'd' }),
    topico({ id: 'e', tipo: 'subtema', nextReviewDate: '2026-11-01' }),
  ];
  const pendentes = engine.pendingReviews(topicos, HOJE);
  assert.deepEqual(pendentes.map((p) => p.topic.id), ['b', 'a']);
  assert.equal(pendentes[0].daysLate, 10);
});

test('motor: plano diário respeita minutos, horas de sessão e não repete tópicos', () => {
  const topicos = Array.from({ length: 8 }, (_, i) => topico({
    id: `disc-mat:t${i}`, titulo: `Tema ${i}`, masteryPct: i * 10,
  }));
  const plano = engine.generate(topicos, EXAMES, { minutesPerDay: 60, sessionMinutes: 30 }, HOJE);
  assert.equal(plano.daily.totalMinutes, 60);
  assert.ok(plano.daily.items.length <= 2);
  for (const item of plano.daily.items) {
    assert.ok(item.durationMin >= 15 && item.durationMin <= 30);
    assert.ok(item.reason && item.objective);
    assert.equal(item.date, HOJE);
  }
  const ids = plano.daily.items.map((x) => x.topicId);
  assert.equal(new Set(ids).size, ids.length, 'sem repetição no mesmo dia');
});

test('motor: plano alterna disciplinas em vez de esgotar uma', () => {
  const topicos = [
    ...Array.from({ length: 4 }, (_, i) => topico({ id: `disc-mat:t${i}`, disciplinaId: 'disc-mat' })),
    ...Array.from({ length: 4 }, (_, i) => topico({ id: `disc-fqa:t${i}`, disciplinaId: 'disc-fqa' })),
  ];
  const plano = engine.generate(topicos, EXAMES, { minutesPerDay: 120, sessionMinutes: 30 }, HOJE);
  const disciplinas = plano.daily.items.map((x) => x.disciplinaId);
  assert.equal(new Set(disciplinas.slice(0, 2)).size, 2, `esperava alternância: ${disciplinas}`);
});

test('motor: semana começa à segunda-feira e o plano mensal mantém o mês atual', () => {
  const topicos = Array.from({ length: 12 }, (_, i) => topico({ id: `t${i}`, titulo: `Tema ${i}` }));
  const plano = engine.generate(topicos, EXAMES, { minutesPerDay: 90, sessionMinutes: 45 }, HOJE);
  assert.equal(plano.week.length, 7);
  assert.equal(plano.week[0].date, '2026-11-16');
  assert.equal(plano.week[4].date, HOJE);
  assert.equal(plano.week[6].date, '2026-11-22');
  assert.equal(plano.month[0].date, HOJE);
  assert.equal(plano.month.length, 11);
  const totalSemana = plano.week.reduce((n, d) => n + d.totalMinutes, 0);
  assert.ok(totalSemana > 0 && totalSemana <= 7 * 90);
  for (const dia of plano.month) assert.match(dia.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('concluir conteúdo não implica domínio estimado', () => {
  const t=topico({ estado:'concluido', contentCompleted:true });
  assert.equal(engine.mastery(t),0);
  assert.equal(engine.evidenceState(0,false),'not_started');
});

test('prioridades permitem pesos configuráveis e preservam limites', () => {
  const t=topico({ masteryPct:50 });
  const a=engine.scoreTopic(t,{today:HOJE,weights:{mastery:.8,importance:.05,due:.05,performance:.025,forgetting:.025,difficulty:.025,urgency:.025}});
  const b=engine.scoreTopic(t,{today:HOJE,weights:{mastery:.05,importance:.8,due:.05,performance:.025,forgetting:.025,difficulty:.025,urgency:.025}});
  assert.ok(a.score>=0&&a.score<=100&&b.score>=0&&b.score<=100);
});

test('repetição adapta estabilidade; falha encurta e recuperação forte expande', () => {
  const t=topico({masteryPct:80,memoryStabilityDays:10});
  const weak=engine.applySession(t,{exerciseCount:10,correctCount:3,confidence:2,difficulty:4},HOJE);
  assert.equal(weak.intervalDays,1);
  const recovered=engine.applySession(t,{exerciseCount:20,correctCount:20,confidence:5,autonomy:5,difficulty:1},AMANHA);
  assert.ok(recovered.intervalDays>1);
  assert.ok(t.memoryStabilityDays>0);
});

test('deteção fraca exige padrão de resultados e valida ciclo de pré-requisitos', () => {
  const t=topico({performanceHistory:[
    {accuracyPct:50},{accuracyPct:55},{accuracyPct:48},
  ]});
  assert.equal(engine.weakTopics([t],HOJE).length,1);
  assert.equal(engine.weakTopics([topico({performanceHistory:[{accuracyPct:0}]})],HOJE).length,0);
  const a=topico({id:'a',blockedBy:['b']}), b=topico({id:'b',blockedBy:['a']});
  assert.equal(engine.validatePrerequisites([a,b]).valid,false);
});

test('ausência de estudo gera semana sem exceder orçamento e sem empilhar sessões', () => {
  const t=topico({masteryPct:35,lastStudiedAt:'2026-11-01',nextReviewDate:'2026-11-02'});
  const plan=engine.generate([t],EXAMES,{minutesPerDay:45,sessionMinutes:45},'2026-11-20');
  assert.equal(plan.week[0].date,'2026-11-16');
  assert.equal(plan.week.filter(d=>d.date>='2026-11-20').reduce((n,d)=>n+d.totalMinutes,0)<=3*45,true);
  assert.equal(plan.week.filter(d=>d.date<'2026-11-20').reduce((n,d)=>n+d.totalMinutes,0),0);
});

test('motor: tópicos arquivados e não-tópicos ficam fora do plano', () => {
  const topicos = [
    topico({ id: 'ok', kind: 'topic', tipo: 'topico' }),
    topico({ id: 'arquivado', archived: true }),
    topico({ id: 'dominio', kind: 'domain', tipo: 'dominio' }),
  ];
  const plano = engine.generate(topicos, EXAMES, { minutesPerDay: 90 }, HOJE);
  const ids = plano.daily.items.map((x) => x.topicId);
  assert.deepEqual(ids, ['ok']);
});

test('motor: adia conteúdo dependente até domínio mínimo nos pré-requisitos', () => {
  const base = topico({ id: 'base', masteryPct: 59, importance: 5 });
  const dependente = topico({ id: 'dependente', masteryPct: 0, blockedBy: ['base'] });
  const antes = engine.generate([base, dependente], EXAMES, { minutesPerDay: 90 }, HOJE);
  assert.ok(!antes.daily.items.some((x) => x.topicId === 'dependente'));
  base.masteryPct = 60;
  const depois = engine.generate([base, dependente], EXAMES, { minutesPerDay: 90 }, HOJE);
  assert.ok(depois.daily.items.some((x) => x.topicId === 'dependente'));
});

test('motor: aplicar sessão não aceita acertos acima das tentativas', () => {
  const t = topico({ masteryPct: 50 });
  const r = engine.applySession(t, { exerciseCount: 5, correctCount: 99, confidence: 3 }, HOJE);
  assert.equal(r.accuracyPct, 100);
  assert.ok(t.masteryPct <= 100);
});
