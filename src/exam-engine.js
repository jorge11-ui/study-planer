/* Lógica pura do planeador de exames: sem dependência do DOM ou storage. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExamEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const dateKey = (value) => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const utcDateKey = (value) => new Date(value).toISOString().slice(0, 10);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const daysBetween = (a, b) => Math.floor((Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`)) / DAY);
  // Completion is coverage; mastery is an evidence-based estimate. Never infer
  // knowledge from the completion checkbox.
  const mastery = (t) => clamp(Number.isFinite(Number(t.masteryPct)) ? Number(t.masteryPct) : 0, 0, 100);
  const evidenceState = (pct, started) => !started ? 'not_started' : pct < 35 ? 'learning' : pct < 65 ? 'developing' : pct < 85 ? 'consolidated' : 'mastered';
  const isTopic = (t) => typeof t.tipo === 'string' ? t.tipo === 'topico' : t.kind === 'topic';
  const lastDays = (t, today) => t.lastStudiedAt ? Math.max(0, daysBetween(dateKey(t.lastStudiedAt), today)) : 90;

  const METHOD_DEFS = {
    new_learning: {
      id: 'new_learning',
      label: 'Aprender',
      short: 'Aprender',
      steps: [
        'Lê o essencial e retém 5 ideias-chave.',
        'Fecha os apontamentos e explica em voz alta.',
        'Regista uma dúvida e a confiança no fim.',
      ],
      prompt: 'Consegues explicar os conceitos principais sem consultar?',
      objective: 'Compreender o conteúdo e transformá-lo numa explicação própria.',
    },
    active_recall: {
      id: 'active_recall',
      label: 'Recuperação ativa',
      short: 'Active recall',
      steps: [
        'Fecha os apontamentos.',
        'Responde de memória a 3 perguntas sobre o tópico.',
        'Corrige e regista o que falhou.',
      ],
      prompt: 'O que consegues reconstruir sem qualquer apoio?',
      objective: 'Treinar a recuperação ativa e identificar lacunas reais.',
    },
    spaced_repetition: {
      id: 'spaced_repetition',
      label: 'Repetição espaçada',
      short: 'Spaced repetition',
      steps: [
        'Tenta recordar antes de abrir os apontamentos.',
        'Compara e corrige as diferenças.',
        'Confirma a próxima data de revisão.',
      ],
      prompt: 'Ainda te lembras do essencial sem consultar?',
      objective: 'Consolidar memória a longo prazo no momento certo.',
    },
    practice: {
      id: 'practice',
      label: 'Prática intercalada',
      short: 'Prática',
      steps: [
        'Resolve 3 a 5 exercícios variados.',
        'Anota o erro e a causa, não só a resposta.',
        'Repete no fim um erro antigo.',
      ],
      prompt: 'Que erro se repete e porquê?',
      objective: 'Aplicar o conteúdo e transformar erros em pistas de estudo.',
    },
    relearn: {
      id: 'relearn',
      label: 'Reaprendizagem',
      short: 'Reaprender',
      steps: [
        'Rever o conceito-chave em 5 minutos.',
        'Explica-o com um exemplo teu.',
        'Termina com uma pergunta de recuperação.',
      ],
      prompt: 'Consegues explicar o conceito com um exemplo novo?',
      objective: 'Recuperar bases antes de voltar a praticar.',
    },
    maintenance: {
      id: 'maintenance',
      label: 'Manutenção',
      short: 'Manutenção',
      steps: [
        'Responde a uma pergunta difícil.',
        'Confirma a resposta e o raciocínio.',
        'Só volta a rever se falhares ou perderes confiança.',
      ],
      prompt: 'A memória mantém-se estável sem esforço extra?',
      objective: 'Manter um tópico dominado com o mínimo de carga.',
    },
  };

  function confidenceValue(t) {
    const raw = t.confidence ?? t.confianca ?? 3;
    return clamp(Number(raw) || 3, 1, 5);
  }

  function confidenceRisk(t) {
    return clamp(1 - (confidenceValue(t) - 1) / 4, 0, 1);
  }

  function accuracyValue(t) {
    const raw = t.accuracyPct;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n, 0, 100) / 100 : null;
  }

  function exerciseCount(t) {
    return Math.max(0, Number(t.exerciseCount) || 0);
  }

  function isMasteredTopic(t) {
    const accuracy = accuracyValue(t);
    return mastery(t) >= 85
      && (accuracy == null || accuracy >= .75)
      && (t.masteryState === 'mastered' || t.estado === 'concluido' || mastery(t) >= 90);
  }

  function dueStateOf(t, today) {
    if (!t.nextReviewDate) {
      return t.estado === 'nao_iniciado' && !t.lastStudiedAt ? 'not_started' : 'unscheduled';
    }
    const diff = daysBetween(today, t.nextReviewDate);
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'due_today';
    if (diff <= 3) return 'due_soon';
    return 'scheduled';
  }

  function evidenceGapOf(t) {
    if (!t.lastStudiedAt && !exerciseCount(t) && mastery(t) === 0) return 0;
    return clamp(1 - Math.min(1, exerciseCount(t) / 20) * .8, .2, 1);
  }

  function pickStudyMethod(t, scored = {}, ctx = {}) {
    const today = ctx.today || dateKey(Date.now());
    const dueState = scored.dueState || dueStateOf(t, today);
    const accuracy = accuracyValue(t);
    const exercises = exerciseCount(t);
    const confidence = confidenceValue(t);
    const daysSince = t.lastStudiedAt ? lastDays(t, today) : null;
    const masteryPct = mastery(t);
    const sessionMin = clamp(Number(ctx.settings?.sessionMinutes || 45), 15, 120);

    let id;
    if (isMasteredTopic(t)) id = 'maintenance';
    else if (dueState === 'overdue' || dueState === 'due_today') id = 'spaced_repetition';
    else if (t.estado === 'nao_iniciado' && !t.lastStudiedAt && masteryPct < 15) id = 'new_learning';
    else if (accuracy != null && accuracy < .65) id = 'practice';
    else if (daysSince != null && daysSince >= 14 && confidence <= 2) id = 'relearn';
    else if (exercises === 0 && masteryPct >= 15) id = 'active_recall';
    else if (dueState === 'due_soon') id = 'spaced_repetition';
    else if (scored.daysLeft != null && scored.daysLeft <= 30) id = 'practice';
    else id = 'active_recall';

    const def = METHOD_DEFS[id];
    const estimatedMin = id === 'maintenance'
      ? 12
      : id === 'spaced_repetition'
        ? 20
        : id === 'active_recall'
          ? 25
          : id === 'relearn'
            ? Math.min(sessionMin, 30)
            : sessionMin;

    return {
      ...def,
      estimatedMin: clamp(estimatedMin, 10, sessionMin),
    };
  }

  function compactRecommendation(row) {
    return {
      topicId: row.topic.id,
      topicTitle: row.topic.titulo || row.topic.name || 'Tópico',
      disciplinaId: row.topic.disciplinaId || row.topic.examId,
      priority: row.priority,
      score: row.score,
      reasons: row.reasons,
      reasonCodes: row.reasonCodes,
      dueState: row.dueState,
      dueIn: row.dueIn,
      daysLeft: row.daysLeft,
      confidenceRisk: row.confidenceRisk,
      maintenance: row.maintenance,
      blocked: row.blocked,
      actionType: row.actionType,
      method: row.method,
      suggestedDurationMin: row.suggestedDurationMin,
    };
  }

  function recommendTopics(topics, exams, settings = {}, context = {}) {
    const today = context.today || dateKey(Date.now());
    const byId = new Map(topics.map(t => [t.id, t]));
    const examFor = (id) => exams.find(e => e.id === id);
    const limit = clamp(Number(context.limit || 12), 1, 100);

    return topics
      .filter(t => isTopic(t) && !t.archived && !(t.ignoredUntil && t.ignoredUntil > today))
      .map(t => {
        const exam = examFor(t.disciplinaId || t.examId);
        const scored = scoreTopic(t, {
          today,
          examDate: exam && exam.dataExame,
          weights: context.weights || settings.priorityWeights,
        });
        const blocked = (t.blockedBy || t.prerequisiteIds || [])
          .some(id => !byId.has(id) || mastery(byId.get(id)) < 60);
        const maintenance = isMasteredTopic(t);
        const method = pickStudyMethod(t, scored, { today, settings });
        const priority = maintenance
          ? Math.min(scored.score, 55)
          : blocked
            ? Math.min(scored.score, 45)
            : scored.score;
        const reasons = blocked && !scored.reasons.some((r) => /pré-requisito/i.test(r))
          ? ['pré-requisitos por consolidar', ...scored.reasons]
          : scored.reasons;
        const reasonCodes = blocked && !scored.reasonCodes.includes('blocked_prerequisite')
          ? [...scored.reasonCodes, 'blocked_prerequisite']
          : scored.reasonCodes;

        return {
          topic: t,
          exam,
          ...scored,
          priority,
          reasons,
          reasonCodes,
          blocked,
          maintenance,
          method,
          actionType: method.id,
          suggestedDurationMin: method.estimatedMin,
        };
      })
      .sort((a, b) => b.priority - a.priority || a.topic.id.localeCompare(b.topic.id))
      .slice(0, limit);
  }

  function buildStudyAgenda(topics, exams, settings = {}, startDate = dateKey(Date.now()), days = 7) {
    const plan = planTopics(topics, exams, settings, startDate, days);
    const recommendations = recommendTopics(topics, exams, settings, { today: startDate, limit: 8 })
      .map(compactRecommendation);
    const items = plan.flatMap(day => day.items);
    const totalMinutes = items.reduce((sum, item) => sum + item.durationMin, 0);
    return {
      generatedAt: Date.now(),
      startDate,
      horizonDays: days,
      days: plan,
      items,
      recommendations,
      next: recommendations[0] || null,
      totalMinutes,
      summary: { sessions: items.length, minutes: totalMinutes },
    };
  }

  function scoreTopic(t, ctx = {}) {
    const today = ctx.today || dateKey(Date.now());
    const examDate = ctx.examDate;
    const daysLeft = examDate ? Math.max(0, daysBetween(today, examDate)) : 180;
    const dueIn = t.nextReviewDate ? daysBetween(today, t.nextReviewDate) : null;
    const masteryGap = 1 - mastery(t) / 100;
    const importance = clamp(Number(t.importance || t.prioridade || 3), 1, 5) / 5;
    const difficulty = clamp(Number(t.difficulty || 3), 1, 5) / 5;
    const staleness = clamp(lastDays(t, today) / 30, 0, 1);
    const hasAccuracy = t.accuracyPct !== null && t.accuracyPct !== undefined && t.accuracyPct !== '';
    const accuracy = hasAccuracy && Number.isFinite(Number(t.accuracyPct)) ? clamp(Number(t.accuracyPct), 0, 100) / 100 : null;
    const weakResults = accuracy == null ? 0 : 1 - accuracy;
    const due = dueIn == null ? (t.estado === 'nao_iniciado' ? 0 : 0.35) : dueIn <= 0 ? 1 : clamp(1 - dueIn / 30, 0, 0.8);
    const deadline = clamp(1 - daysLeft / 240, 0, 1);
    const dependencyPenalty = t.blockedBy?.length ? 0.08 : 0;
    // Normalized, configurable weights. Importance and mastery carry most
    // weight; urgency and demonstrated failure raise the score, while
    // difficulty/time cost are smaller tie-break factors.
    const weights = { mastery: .30, importance: .20, due: .16, performance: .14, forgetting: .08, difficulty: .05, urgency: .07, ...(ctx.weights || {}) };
    const base = 100 * (weights.mastery * masteryGap + weights.importance * importance + weights.due * due + weights.performance * weakResults + weights.forgetting * staleness + weights.difficulty * difficulty + weights.urgency * deadline - dependencyPenalty);
    // A small, explicit moderation layer: low confidence and missing evidence
    // raise priority, while mastered topics are capped so they do not crowd
    // out weaker content. The base formula stays stable for compatibility.
    const confidence = confidenceValue(t);
    const risk = confidenceRisk(t);
    const evidenceGap = evidenceGapOf(t);
    const maintenance = isMasteredTopic(t);
    const moderation = 4 * risk + 3 * evidenceGap - (maintenance ? 12 : 0);
    const dueState = dueStateOf(t, today);
    const reasonCodes = [];
    const reasons = [];
    if (mastery(t) < 40) { reasons.push(`domínio estimado de ${mastery(t)}%`); reasonCodes.push('low_mastery'); }
    if (dueIn != null && dueIn <= 0) {
      reasons.push(dueIn < 0 ? `revisão atrasada ${Math.abs(dueIn)} dia(s)` : 'revisão prevista para hoje');
      reasonCodes.push(dueIn < 0 ? 'overdue_review' : 'due_today');
    }
    if (accuracy != null && accuracy < 0.65) {
      reasons.push(`taxa de acerto de ${Math.round(accuracy * 100)}%`);
      reasonCodes.push('low_accuracy');
    }
    if (t.estado === 'nao_iniciado') { reasons.push('conteúdo ainda não iniciado'); reasonCodes.push('not_started'); }
    if (lastDays(t, today) >= 14 && t.lastStudiedAt) {
      reasons.push(`último estudo há ${lastDays(t, today)} dias`);
      reasonCodes.push('stale_topic');
    }
    if (confidence <= 2 && (t.lastStudiedAt || t.exerciseCount)) {
      reasons.push(`confiança baixa (${confidence}/5)`);
      reasonCodes.push('low_confidence');
    }
    if (t.difficulty >= 4) { reasons.push('dificuldade elevada'); reasonCodes.push('high_difficulty'); }
    if (t.difficultyTags?.length) { reasons.push(`dificuldades registadas: ${t.difficultyTags.slice(0,2).join(', ')}`); reasonCodes.push('difficulty_tags'); }
    if (t.prerequisiteWarning) { reasons.push(t.prerequisiteWarning); reasonCodes.push('prerequisite_warning'); }
    if (maintenance) { reasons.push('domínio consolidado: manter com carga mínima'); reasonCodes.push('maintenance'); }
    if (daysLeft <= 30) reasonCodes.push('exam_soon');
    if (importance >= .8) reasonCodes.push('high_importance');

    return {
      score: Math.round(clamp(base + moderation, 0, 100)),
      reasons,
      reasonCodes,
      daysLeft,
      dueIn,
      dueState,
      confidenceRisk: risk,
      evidenceGap,
      maintenance,
      masteryState: evidenceState(mastery(t), !!(t.lastStudiedAt || t.exerciseCount)),
    };
  }

  function validatePrerequisites(topics) {
    const byId = new Map(topics.map(t => [t.id, t]));
    const invalid = [], cycles = [];
    const visiting = new Set(), visited = new Set(), path = [];
    function visit(id) {
      if (visiting.has(id)) { cycles.push([...path.slice(path.indexOf(id)), id]); return; }
      if (visited.has(id)) return;
      visiting.add(id); path.push(id);
      const t = byId.get(id);
      for (const dep of (t?.blockedBy || t?.prerequisiteIds || [])) {
        if (!byId.has(dep)) invalid.push({ topicId:id, prerequisiteId:dep }); else visit(dep);
      }
      path.pop(); visiting.delete(id); visited.add(id);
    }
    topics.forEach(t => visit(t.id));
    return { valid: !invalid.length && !cycles.length, invalid, cycles };
  }

  function planTopics(topics, exams, settings = {}, startDate = dateKey(Date.now()), days = 1) {
    const minutesPerDay = clamp(Number(settings.minutesPerDay || 90), 20, 720);
    const sessionMin = clamp(Number(settings.sessionMinutes || 45), 15, 120);
    const maxMaintenance = clamp(Number(settings.maxMaintenancePerDay ?? 1), 0, 3);
    const byId = new Map(topics.map(t=>[t.id,t]));
    const eligible = topics.filter(t => isTopic(t) && !t.archived
      && !(t.blockedBy||t.prerequisiteIds||[]).some(id=>!byId.has(id)||mastery(byId.get(id))<60));
    const examFor = (id) => exams.find(e => e.id === id);
    const scores = eligible.map(t => {
      const exam = examFor(t.disciplinaId || t.examId);
      const scored = scoreTopic(t, { today: startDate, examDate: exam && exam.dataExame, weights:settings.priorityWeights });
      const method = pickStudyMethod(t, scored, { today: startDate, settings });
      return { topic: t, ...scored, exam, method };
    }).sort((a,b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id));
    const plans = [];
    const disciplineLoad = new Map();
    const subjectWeekly = new Map(exams.map(e=>[e.id,Math.max(0,Number(e.weeklyMinutes)||0)]));
    const planningLoad = new Map();
    const nextPlanned = new Map();
    const start = new Date(`${startDate}T00:00:00Z`);
    const mondayOffset = (start.getUTCDay() + 6) % 7;
    const planStart = days === 7 ? utcDateKey(start.getTime() - mondayOffset * DAY) : startDate;
    for (let offset = 0; offset < days; offset++) {
      const date = utcDateKey(Date.parse(`${planStart}T00:00:00Z`) + offset * DAY);
      if (date < startDate) { plans.push({ date, items: [], totalMinutes:0, goals:['Semana iniciada'] }); continue; }
      if (Array.isArray(settings.studyDays) && !settings.studyDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
        plans.push({ date, items: [], totalMinutes: 0, goals: ['Dia de descanso'] });
        continue;
      }
      let remaining = minutesPerDay;
      const usedToday = new Set();
      const items = [];
      let maintenanceToday = 0;
      while (remaining >= 15) {
        const ranked = scores.filter(x => {
          if (usedToday.has(x.topic.id) || (nextPlanned.get(x.topic.id) || date) > date) return false;
          if (x.topic.ignoredUntil && x.topic.ignoredUntil > date) return false;
          if (x.maintenance && maintenanceToday >= maxMaintenance) return false;
          const subject=x.topic.disciplinaId||x.topic.examId;
          const weekly=subjectWeekly.get(subject);
          const cap=days===1?minutesPerDay:(weekly>0?weekly*days/7:(minutesPerDay*days/Math.max(1,exams.length)));
          return (planningLoad.get(subject)||0) < cap;
        }).sort((a,b) => {
          const loadRatio=(x)=>{const subject=x.topic.disciplinaId||x.topic.examId;const weekly=subjectWeekly.get(subject);const cap=days===1?minutesPerDay:(weekly>0?weekly*days/7:(minutesPerDay*days/Math.max(1,exams.length)));return cap?(planningLoad.get(subject)||0)/cap:0;};
          const effective = (x) => x.maintenance ? Math.min(x.score, 55) : x.score;
          // Mistura suave: depois de escolher um método, dá preferência a outro
          // tipo de sessão no mesmo dia, sem nunca sobrepor prioridade real.
          const repeated = (x) => items.filter((it) => (it.actionType || '') === x.method.id).length;
          return (effective(b) - loadRatio(b)*24 - repeated(b)*7) - (effective(a) - loadRatio(a)*24 - repeated(a)*7);
        });
        const best = ranked[0]; if (!best) break;
        const subject=best.topic.disciplinaId||best.topic.examId;
        const weekly=subjectWeekly.get(subject);
        const cap=days===1?minutesPerDay:(weekly>0?weekly*days/7:(minutesPerDay*days/Math.max(1,exams.length)));
        const capLeft=cap-(planningLoad.get(subject)||0);
        const method = best.method || pickStudyMethod(best.topic, best, { today: date, settings });
        // A duração sugerida pelo método (ex.: manutenção curta) prevalece
        // sobre a duração preferida, sem exceder o orçamento disponível.
        const duration = Math.min(sessionMin, remaining, Math.max(15,capLeft), method.estimatedMin);
        const activity = method.id === 'new_learning'
          ? 'new'
          : ['spaced_repetition', 'relearn', 'maintenance'].includes(method.id)
            ? 'revision'
            : 'practice';
        const reason = best.reasons.length
          ? `Prioridade ${best.score >= 70 ? 'elevada' : best.score >= 45 ? 'média' : 'regular'}: ${best.reasons.slice(0, 2).join(' e ')}.`
          : `Reforço planeado com base na importância do conteúdo e proximidade do exame (${best.daysLeft} dias).`;
        const entry = {
          id: `${date}-${best.topic.id}-${items.length}`,
          topicId: best.topic.id,
          topicTitle: best.topic.titulo || best.topic.name || 'Tópico',
          disciplinaId: subject,
          date,
          durationMin: duration,
          activity,
          actionType: method.id,
          priority: best.score,
          objective: method.objective,
          reason,
          reasonCodes: best.reasonCodes || [],
          dueState: best.dueState,
          confidenceRisk: best.confidenceRisk,
          method: { id: method.id, label: method.label, short: method.short, steps: method.steps, prompt: method.prompt },
          generatedAt: Date.now(),
        };
        items.push(entry); usedToday.add(best.topic.id); remaining -= duration;
        if (best.maintenance) maintenanceToday += 1;
        disciplineLoad.set(subject, (disciplineLoad.get(subject) || 0) + duration);
        planningLoad.set(subject,(planningLoad.get(subject)||0)+duration);
        const gap = method.id === 'maintenance'
          ? 21
          : method.id === 'relearn'
            ? 2
            : mastery(best.topic) < 60 ? 1 : mastery(best.topic) < 80 ? 3 : mastery(best.topic) < 95 ? 7 : 14;
        nextPlanned.set(best.topic.id,utcDateKey(Date.parse(`${date}T00:00:00Z`)+gap*DAY));
      }
      plans.push({ date, items, totalMinutes: items.reduce((n,x)=>n+x.durationMin,0), goals: [`Completar ${items.length} sessão(ões)`, 'Registar exercícios e confiança no fim de cada sessão'] });
    }
    return plans;
  }

  function generate(topics, exams, settings = {}, today = dateKey(Date.now())) {
    const daily = planTopics(topics, exams, settings, today, 1)[0];
    const week = planTopics(topics, exams, settings, today, 7);
    const monthEnd = new Date(Date.UTC(Number(today.slice(0,4)), Number(today.slice(5,7)), 0)).toISOString().slice(0, 10);
    const remainingMonthDays = Math.max(1, daysBetween(today, monthEnd) + 1);
    const month = planTopics(topics, exams, settings, today, remainingMonthDays);
    const recommendations = recommendTopics(topics, exams, settings, { today, limit: 8 }).map(compactRecommendation);
    const agendaItems = week.flatMap(day => day.items);
    const totalMinutes = agendaItems.reduce((sum, item) => sum + item.durationMin, 0);
    const agenda = {
      generatedAt: Date.now(),
      startDate: today,
      horizonDays: 7,
      days: week,
      items: agendaItems,
      recommendations,
      next: recommendations[0] || null,
      totalMinutes,
      summary: { sessions: agendaItems.length, minutes: totalMinutes },
    };
    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      generatedAt: Date.now(), today, daily, week, month,
      recommendations,
      nextBest: recommendations[0] || null,
      agenda,
      weekStartsOn: 'monday', prerequisiteValidation: validatePrerequisites(topics),
      monthSummary: exams.map(e => ({ examId: e.id, topics: month.flatMap(d=>d.items).filter(x=>x.disciplinaId===e.id).length, minutes: month.flatMap(d=>d.items).filter(x=>x.disciplinaId===e.id).reduce((n,x)=>n+x.durationMin,0) })),
    };
  }

  function applySession(topic, input, today = dateKey(Date.now())) {
    const count = Math.max(0, Math.floor(Number(input.exerciseCount) || 0));
    const correct = clamp(Number(input.correctCount) || 0, 0, count);
    const accuracy = count ? 100 * correct / count : null;
    const confidence = clamp(Number(input.confidence) || 3, 1, 5) * 20;
    const autonomy = clamp(Number(input.autonomy ?? 3), 1, 5) * 20;
    const observed = accuracy == null ? 0.65 * confidence + 0.35 * autonomy : 0.6 * accuracy + 0.2 * confidence + 0.2 * autonomy;
    const prior = mastery(topic);
    const evidenceWeight = count === 0 ? .2 : clamp(.2 + count * .035, .2, .55);
    topic.masteryPct = Math.round(clamp(prior * (1-evidenceWeight) + observed * evidenceWeight, 0, 100));
    topic.masteryState = evidenceState(topic.masteryPct, true);
    if (input.contentCompleted) topic.contentCompleted = true;
    topic.estado = topic.contentCompleted ? 'concluido' : topic.masteryPct > 0 ? 'em_progresso' : 'nao_iniciado';
    topic.lastStudiedAt = Date.now(); topic.ultimaAtividade = Date.now();
    topic.studyMinutes = (Number(topic.studyMinutes) || 0) + Math.max(0, Number(input.durationMin) || 0);
    topic.exerciseCount = (Number(topic.exerciseCount) || 0) + count;
    if (accuracy != null) {
      topic.accuracyTotal = (Number(topic.accuracyTotal) || 0) + count;
      topic.accuracyCorrect = (Number(topic.accuracyCorrect) || 0) + correct;
      topic.accuracyPct = Math.round(100 * topic.accuracyCorrect / Math.max(1,topic.accuracyTotal));
      const hist = Array.isArray(topic.performanceHistory) ? topic.performanceHistory : [];
      hist.push({ date:today, count, correct, accuracyPct:Math.round(accuracy), difficulty:clamp(Number(input.difficulty)||3,1,5), confidence:Number(input.confidence)||3, autonomy:Number(input.autonomy??3) });
      topic.performanceHistory = hist.slice(-30);
    }
    topic.confidence = Number(input.confidence) || 3;
    topic.confianca = topic.confidence;
    topic.difficulty = clamp(Number(input.difficulty) || 3, 1, 5);
    const selfRating = clamp(Number(input.selfRating) || 0, 0, 5);
    if (input.methodId) topic.lastMethod = String(input.methodId);
    if (selfRating) topic.lastSelfRating = selfRating;
    if (input.difficultyNotes) {
      const tags = new Set([...(topic.difficultyTags||[]), ...String(input.difficultyNotes).split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean)]);
      topic.difficultyTags = [...tags].slice(-20);
    }
    const intervals = [1,3,7,14,30];
    // O intervalo anterior pode vir do campo novo (dias) ou do índice antigo.
    // Antes o índice era recalculado com indexOf() e ficava -1 quando o
    // intervalo dobrado não pertencia à lista (2, 6, 28, 60), pelo que a
    // revisão deixava de crescer. Guardar os dias resolve isso.
    const indice = Math.max(0, Math.min(intervals.length - 1, Math.round(topic.intervalIndex || 0)));
    const anterior = Math.max(1, Math.min(60, Number(topic.intervalDays) || intervals[indice]));
    let interval;
    // FSRS-inspired stability update: recall evidence grows stability on a
    // successful retrieval and sharply contracts it after a lapse.
    const stability = Math.max(.5, Number(topic.memoryStabilityDays) || anterior);
    const retrieval = accuracy == null ? (confidence + (Number(input.autonomy)||3)*20)/2 : accuracy;
    const lapse = retrieval < 60 || confidence < 40 || Number(input.difficulty) >= 5;
    if (lapse) topic.reviewLapses = (Number(topic.reviewLapses) || 0) + 1;
    const nextStability = lapse ? Math.max(.5, stability * .35) : stability * (1 + .18 * (retrieval/100) * (confidence/100) * (Number(input.autonomy??3)/5));
    topic.memoryStabilityDays = Math.min(180, Number(nextStability.toFixed(2)));
    topic.estimatedDifficulty = clamp((Number(topic.estimatedDifficulty)||3)*.75 + (Number(input.difficulty)||3)*.25,1,5);
    if (lapse) interval = 1;
    else interval = clamp(Math.round(topic.memoryStabilityDays * clamp(.55 + (retrieval/100)*.35, .6, .95)), 1, 180);
    topic.intervalDays = interval;
    topic.intervalIndex = intervals.reduce((melhor, valor, i) => (
      Math.abs(valor - interval) < Math.abs(intervals[melhor] - interval) ? i : melhor
    ), 0);
    topic.nextReviewDate = utcDateKey(Date.parse(`${today}T00:00:00Z`) + interval * DAY);
    topic.updatedAt = Date.now();
    const history = Array.isArray(topic.learningHistory) ? topic.learningHistory : [];
    history.push({ date:today, durationMin:Math.max(0,Number(input.durationMin)||0), exerciseCount:count, correctCount:correct, accuracyPct:accuracy==null?null:Math.round(accuracy), confidence:Number(input.confidence)||3, autonomy:Number(input.autonomy??3), difficulty:Number(input.difficulty)||3, masteryPct:topic.masteryPct, activity:input.activity||'study', methodId:input.methodId||'', selfRating });
    topic.learningHistory = history.slice(-100);
    return {
      masteryPct: topic.masteryPct,
      masteryState: topic.masteryState,
      accuracyPct: accuracy == null ? topic.accuracyPct : Math.round(accuracy),
      nextReviewDate: topic.nextReviewDate,
      intervalDays: interval,
      memoryStabilityDays: topic.memoryStabilityDays,
      methodId: input.methodId || '',
      selfRating,
      reviewLapses: Number(topic.reviewLapses) || 0,
    };
  }

  function weakTopics(topics, today = dateKey(Date.now())) {
    return topics.filter(isTopic).map(topic => {
      const hist = (topic.performanceHistory||[]).slice(-5);
      const low = hist.filter(x => x.accuracyPct < 60).length;
      const trend = hist.length >= 3 ? hist[hist.length-1].accuracyPct - hist[0].accuracyPct : 0;
      const overdue = topic.nextReviewDate && topic.nextReviewDate <= today;
      const weak = (hist.length >= 3 && low >= 2) || (hist.length >= 4 && trend <= -20) || (Number(topic.masteryPct)<35 && hist.length>=2);
      if (!weak) return null;
      const reasons=[];
      if(low>=2) reasons.push(`${low} dos últimos ${hist.length} resultados abaixo de 60%`);
      if(trend<=-20) reasons.push('desempenho recente em queda');
      if(overdue) reasons.push('revisão vencida');
      return { topic, reasons, recommendation: 'Rever os conceitos e resolver exercícios focados nos erros recentes.' };
    }).filter(Boolean).sort((a,b)=>scoreTopic(b.topic,{today}).score-scoreTopic(a.topic,{today}).score);
  }

  function pendingReviews(topics, today = dateKey(Date.now())) {
    return topics.filter(t => isTopic(t) && t.nextReviewDate && t.nextReviewDate <= today)
      .map(t => ({ topic: t, daysLate: Math.max(0, daysBetween(t.nextReviewDate, today)), score: scoreTopic(t, { today }).score }))
      .sort((a,b) => b.daysLate - a.daysLate || b.score - a.score);
  }

  return {
    scoreTopic,
    generate,
    applySession,
    pendingReviews,
    mastery,
    evidenceState,
    validatePrerequisites,
    weakTopics,
    recommendTopics,
    buildStudyAgenda,
    pickStudyMethod,
    dueStateOf,
  };
});
