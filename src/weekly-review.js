/* Relatório semanal calculado a partir dos registos reais da aplicação. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudyWeeklyReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfWeek = date => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  };
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const subjectKey = value => {
    const s = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (s.includes('fisica') || s.includes('quim') || ['fqa', 'fq'].includes(s)) return 'fqa';
    if (s.includes('biologia') || s === 'bio') return 'bio';
    if (s.includes('matemat') || ['mat', 'ma'].includes(s)) return 'mat';
    if (s.includes('portugues')) return 'pt';
    return s;
  };

  function generate({ now = new Date(), sessionsByDay = {}, tasks = [], topics = [], reviews = [], exams = [] } = {}) {
    const first = startOfWeek(now);
    const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(first); d.setDate(d.getDate() + i); return key(d); });
    const last = dates[6];
    const startKey = dates[0];
    const minutesBySubject = {};
    let minutes = 0;
    dates.forEach(day => Object.entries(sessionsByDay[day] || {}).forEach(([subject, raw]) => {
      const n = Math.max(0, Number(raw) || 0);
      minutes += n;
      const canonical = subjectKey(subject);
      minutesBySubject[canonical] = (minutesBySubject[canonical] || 0) + n;
    }));
    const weekTasks = tasks.filter(t => t && t.date >= startKey && t.date <= last);
    const completedTasks = weekTasks.filter(t => t.task?.done).length;
    const pendingTasks = weekTasks.filter(t => !t.task?.done);
    const subjects = exams.filter(e => e.id !== 'disc-geral').map(e => e.nome || e.name).filter(Boolean);
    const leastStudied = subjects.map(name => ({ name, minutes: minutesBySubject[subjectKey(name)] || 0 })).sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name));
    const weakTopics = topics.filter(t => (t.kind === 'topic' || t.tipo === 'topico') && !t.archived)
      .map(t => ({ title: t.titulo || t.title, subject: exams.find(e => e.id === t.disciplinaId)?.nome || 'Disciplina', mastery: Math.max(0, Number(t.masteryPct) || 0), difficulty: Math.max(1, Number(t.difficulty) || 1), notes: t.dificuldades || '' }))
      .filter(t => t.mastery < 60 || t.difficulty >= 4 || t.notes)
      .sort((a, b) => a.mastery - b.mastery || b.difficulty - a.difficulty).slice(0, 5);
    const weekReviews = reviews.filter(r => r && r.date >= startKey && r.date <= last && Number.isFinite(Number(r.masteryPct)));
    const byTopic = new Map();
    weekReviews.forEach(r => {
      const list = byTopic.get(r.topicId) || [];
      list.push(r);
      byTopic.set(r.topicId, list);
    });
    const masteryChanges = [...byTopic.values()].filter(list => list.length > 1).map(list => {
      list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return Number(list.at(-1).masteryPct) - Number(list[0].masteryPct);
    });
    const overdue = topics.filter(t => (t.kind === 'topic' || t.tipo === 'topico') && t.nextReviewDate && t.nextReviewDate <= key(now)).length;
    const recommendations = [];
    if (leastStudied.length && leastStudied[0].minutes < 60) recommendations.push(`Reserva uma sessão para ${leastStudied[0].name}, que teve menos tempo registado nesta semana.`);
    if (weakTopics[0]) recommendations.push(`Começa por ${weakTopics[0].title} (${weakTopics[0].subject}), com domínio estimado de ${weakTopics[0].mastery}%.`);
    if (overdue) recommendations.push(`Inclui ${overdue} tópico(s) com revisão pendente no início da próxima semana.`);
    if (!recommendations.length && minutes > 0) recommendations.push('Mantém a distribuição atual e regista os resultados das sessões para afinar as próximas recomendações.');
    if (!minutes && !weekTasks.length) recommendations.push('Ainda não há registos desta semana. Adiciona sessões ou tarefas para receber recomendações personalizadas.');
    return {
      start: startKey, end: last, minutes, sessionsBySubject: minutesBySubject,
      taskCount: weekTasks.length, completedTasks, pendingTasks: pendingTasks.length,
      pendingTaskTitles: pendingTasks.slice(0, 5).map(x => x.task?.text || x.task?.title || 'Tarefa'),
      leastStudied: leastStudied.slice(0, 3), weakTopics, overdue,
      masteryChangePoints: masteryChanges.length,
      masteryChange: masteryChanges.length ? Math.round(masteryChanges.reduce((a, b) => a + b, 0) / masteryChanges.length) : null,
      recommendations,
    };
  }

  function render(report, target) {
    if (!target) return;
    const subjectLines = report.leastStudied.map(x => `<li><span>${escapeHtml(x.name)}</span><strong>${Math.round(x.minutes)} min</strong></li>`).join('');
    const weakLines = report.weakTopics.map(x => `<li><span>${escapeHtml(x.title)} <small>${escapeHtml(x.subject)}</small></span><strong>${x.mastery}%</strong></li>`).join('');
    const pendingLines = report.pendingTaskTitles.map(x => `<li>${escapeHtml(x)}</li>`).join('');
    target.innerHTML = `<div class="weekly-review-head"><div><span class="weekly-review-kicker">${escapeHtml(report.start)} – ${escapeHtml(report.end)}</span><h3>Weekly Review</h3></div><span>${Math.floor(report.minutes / 60)} h ${report.minutes % 60} min estudados</span></div>
      <div class="weekly-review-grid"><section><h4>Objetivos e tarefas</h4><p>${report.completedTasks} tarefas concluídas · ${report.pendingTasks} pendentes</p>${pendingLines ? `<ul>${pendingLines}</ul>` : '<p class="weekly-review-muted">Sem tarefas pendentes registadas.</p>'}</section>
      <section><h4>Disciplinas com menos tempo</h4><ul>${subjectLines || '<li class="weekly-review-muted">Sem disciplinas configuradas.</li>'}</ul></section>
      <section><h4>Tópicos a reforçar</h4><ul>${weakLines || '<li class="weekly-review-muted">Sem tópicos com alertas registados.</li>'}</ul><p>${report.overdue} revisões pendentes · ${report.masteryChange === null ? 'sem evolução de domínio medida esta semana' : `variação média de domínio ${report.masteryChange >= 0 ? '+' : ''}${report.masteryChange}%`}</p></section>
      <section><h4>Recomendações</h4><ul>${report.recommendations.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section></div>`;
  }

  return { generate, render, startOfWeek };
});
