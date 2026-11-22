/* StudyJournal — Exames Nacionais (Study Center)
   Redesign premium: visão geral, plano de estudo, tópicos, materiais, revisão, dúvidas e erros.
   Mantém compatibilidade de dados (migração automática) e API window.Exames. */

(function () {
'use strict';

const SCHEMA_VERSION = 3;
const STORE_KEY = 'study-journal-exames-center-v2';

// Legacy keys
const FOCO_KEY = 'study-journal-exames-foco';
const RECURSOS_KEY = 'study-journal-exames-recursos';
const TRACK_KEY = 'study-journal-exames-track';
const DUVIDAS_KEY = 'study-journal-exames-duvidas';
const EXAME_TAB_KEY = 'study-journal-exames-tab';
const EXAME_DATA_KEY = 'study-journal-exames-data-alvo';

const TABS = ['overview', 'syllabus', 'plan', 'revisions', 'practice', 'analytics'];
let catalog = window.__examCatalog || null;
let catalogLoaded = !window.__examCatalogReady;
if (window.__examCatalogReady) window.__examCatalogReady.then((d) => { catalog = d || catalog; catalogLoaded = true; });

function exRead(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
}
function exWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof pushDebounced === 'function') pushDebounced();
    return true;
  } catch { return false; }
}
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; }
function fmtDate(s) { const d = parseDate(s); return d ? d.toLocaleDateString('pt-PT', { day:'numeric', month:'short' }) : '—'; }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function miniToast(msg, type='success') {
  if (typeof window.toast === 'function') { window.toast(msg, type); return; }
  const box = document.getElementById('toasts'); if (!box) return;
  const n = document.createElement('div');
  n.className = 'toast pointer-events-auto glass-subtle rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm';
  n.textContent = msg; box.append(n); setTimeout(() => n.remove(), 2500);
}

function proximaDataPadrao() {
  const anoAtual = new Date().getFullYear();
  const esteAno = new Date(`${anoAtual}-06-18T09:30:00`);
  const ano = esteAno > new Date() ? anoAtual : anoAtual + 1;
  return `${ano}-06-18`;
}
function lerDataAlvoLegacy() {
  const v = exRead(EXAME_DATA_KEY, proximaDataPadrao());
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : proximaDataPadrao();
}

const DISC_DEFAULT = [
  { id: 'disc-mat', nome: 'Matemática A', cor: '#7AA7D9' },
  { id: 'disc-fqa', nome: 'Física e Química A', cor: '#6FBF8E' },
  { id: 'disc-bio', nome: 'Biologia e Geologia', cor: '#C18AE0' },
];
function discNomeToId(nome) {
  if (/portugu/i.test(nome||'')) return 'disc-pt';
  if (/matem/i.test(nome||'')) return 'disc-mat';
  if (/fqa|f[ií]sica|qu[ií]mica/i.test(nome||'')) return 'disc-fqa';
  if (/geral/i.test(nome||'')) return 'disc-geral';
  return 'disc-geral';
}

let state = null;
let ui = {
  tab: 'overview',
  planRange: 'daily',
  collapsedSyllabusDisciplines: new Set(),
  topicQuery: '', topicFilterDisc: 'all', topicFilterEstado: 'all', topicFilterPriority: 'all',
  matQuery: '', matFilterDisc: 'all', matFilterTipo: 'all', matFilterTag: '',
  revQuery: '', revFilterDisc: 'all', revFilterEstado: 'all',
  duvQuery: '', duvFilterDisc: 'all', duvFilterEstado: 'all',
  planoView: 'lista', planoWeekOffset: 0,
};

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exams: DISC_DEFAULT.map(d => ({ ...d, dataExame: '', weeklyMinutes: 300, goal: 80 })),
    topics: [], // flat nodes: {id, disciplinaId, parentId|null, tipo:'dominio'|'subdominio'|'topico', titulo, ...topic fields}
    materials: [],
    sessions: [],
    issues: [],
    practice: [],
    reviews: [],
    planHistory: [],
    activePlan: null,
    settings: { minutesPerDay: 90, sessionMinutes: 45, studyDays: [1,2,3,4,5,6,0] },
    ui: { lastTopicId: null },
  };
}

function normalizeState(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s };
  out.schemaVersion = SCHEMA_VERSION;
  if (!Array.isArray(out.exams) || !out.exams.length) out.exams = d.exams;
  out.topics = Array.isArray(out.topics) ? out.topics : [];
  out.materials = Array.isArray(out.materials) ? out.materials : [];
  out.sessions = Array.isArray(out.sessions) ? out.sessions : [];
  out.issues = Array.isArray(out.issues) ? out.issues : [];
  out.practice = Array.isArray(out.practice) ? out.practice : [];
  out.reviews = Array.isArray(out.reviews) ? out.reviews : [];
  out.planHistory = Array.isArray(out.planHistory) ? out.planHistory : [];
  const maintenanceCap = Number(out.settings?.maxMaintenancePerDay);
  out.settings = {
    ...d.settings,
    ...(out.settings || {}),
    maxMaintenancePerDay: Number.isFinite(maintenanceCap) ? clamp(maintenanceCap, 0, 3) : 1,
  };
  if (!('activePlan' in out)) out.activePlan = null;
  out.ui = { ...(d.ui||{}), ...(out.ui||{}) };
  // Novos sinais são opcionais: estados antigos recebem defaults sem perder
  // os campos que já existiam.
  out.topics = out.topics.map(t => {
    const confidence = clamp(Number(t.confidence ?? t.confianca ?? 3), 1, 5);
    return {
      ...t,
      confidence,
      confianca: clamp(Number(t.confianca ?? confidence), 1, 5),
      lastRecommendedAt: Number(t.lastRecommendedAt) || 0,
      reviewLapses: Number(t.reviewLapses) || 0,
      recommendationHistory: Array.isArray(t.recommendationHistory) ? t.recommendationHistory.slice(-20) : [],
      ignoredUntil: typeof t.ignoredUntil === 'string' ? t.ignoredUntil : '',
    };
  });
  // ensure geral exists for misc
  if (!out.exams.some(e => e.id === 'disc-geral')) out.exams.push({ id:'disc-geral', nome:'Geral', cor:'#8A8A8A', dataExame:'' });
  return out;
}

const CATALOG_PERSONAL_FIELDS = ['estado','masteryPct','masteryState','contentCompleted','confianca','confidence','notasPessoais','dificuldades','ultimaAtividade','lastStudiedAt','nextReviewDate','exerciseCount','accuracyPct','accuracyTotal','accuracyCorrect','performanceHistory','learningHistory','memoryStabilityDays','estimatedDifficulty','studyMinutes','intervalIndex','intervalDays','importance','importancia','prioridade','difficulty','difficultyTags','materialIds','exercicioIds','userTitle','blockedBy','updatedAt','createdAt','lastRecommendedAt','reviewLapses','recommendationHistory','lastMethod','lastSelfRating','ignoredUntil'];
function syllabusTitleKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function mergeCatalogState(source) {
  if (!catalog || !Array.isArray(catalog.nodes)) return source;
  const catalogNodes = [...catalog.nodes, ...(catalog.draftNodes || [])];
  const out = normalizeState(source);
  const existing = new Map(out.topics.map(t => [t.id, t]));
  const oldByTitle = new Map();
  out.topics.filter(t => t.source && (t.kind === 'topic' || t.tipo === 'topico')).forEach(t => {
    const key = `${t.disciplinaId || t.examId}:${syllabusTitleKey(t.titulo || t.title)}`;
    oldByTitle.set(key, oldByTitle.has(key) ? null : t);
  });
  const migratedIds = new Set();
  const topicIdMap = new Map();
  const seeded = catalogNodes.map(n => {
    const key = `${n.examId}:${syllabusTitleKey(n.title)}`;
    const match = n.kind === 'topic' ? oldByTitle.get(key) : null;
    const old = existing.get(n.id) || match || null;
    if (old) {
      migratedIds.add(old.id);
      if (old.id !== n.id) topicIdMap.set(old.id, n.id);
    }
    const item = {
      id: n.id, disciplinaId: n.examId, parentId: n.parentId, tipo: n.kind === 'topic' ? 'topico' : n.kind === 'domain' ? 'dominio' : n.kind === 'theme' ? 'tema' : 'subtema',
      kind: n.kind, titulo: n.title, descricao: n.description || '', importancia: n.importance || 3, prioridade: n.importance || 3, difficulty: n.difficulty || 3,
      source: n.source, needsValidation: !!n.needsValidation, catalogStatus: n.status || 'active', catalogVersion: catalog.version,
      estado: 'nao_iniciado', masteryPct: 0, confianca: 3, confidence: 3, notasPessoais: '', dificuldades: '',
      materialIds: [], exercicioIds: [], exerciseCount: 0, studyMinutes: 0, accuracyPct: null,
      lastRecommendedAt: 0, reviewLapses: 0, recommendationHistory: [], ignoredUntil: '',
    };
    if (old) CATALOG_PERSONAL_FIELDS.forEach(k => { if (old[k] !== undefined) item[k] = old[k]; });
    if (item.userTitle) item.titulo = item.userTitle;
    item.ultimaAtividade = Number(item.ultimaAtividade) || 0;
    return item;
  });
  const seededIds = new Set(seeded.map(t => t.id));
  out.topics = [...seeded, ...out.topics.filter(t => !seededIds.has(t.id) && !migratedIds.has(t.id)).map(t => t.source ? { ...t, archived: true } : t)];
  if (topicIdMap.size) {
    ['materials', 'sessions', 'issues', 'practice', 'reviews'].forEach(collection => {
      out[collection].forEach(item => { if (topicIdMap.has(item.topicId)) item.topicId = topicIdMap.get(item.topicId); });
    });
    seeded.forEach(t => { if (Array.isArray(t.blockedBy)) t.blockedBy = t.blockedBy.map(id => topicIdMap.get(id) || id); });
    const remapPlan = plan => {
      if (!plan) return;
      const days = [plan.daily, ...(plan.week || []), ...(plan.month || [])].filter(Boolean);
      days.forEach(day => (day.items || []).forEach(item => { if (topicIdMap.has(item.topicId)) item.topicId = topicIdMap.get(item.topicId); }));
    };
    remapPlan(out.activePlan);
    out.planHistory.forEach(remapPlan);
  }
  const oldExams = new Map(out.exams.map(e => [e.id, e]));
  const defaults = (catalog.exams || []).map(e => {
    const old = oldExams.get(e.id) || {};
    return { id: e.id, nome: e.name, cor: e.color, examCode: e.examCode, sourceUrls: e.sourceUrls, status:e.status||'active', needsValidation:!!e.needsValidation, dataExame: old.dataExame || '', weeklyMinutes: old.weeklyMinutes || 300, goal: old.goal || 80, ...old };
  });
  out.exams = [...defaults, ...out.exams.filter(e => !defaults.some(d => d.id === e.id))];
  out.catalogVersion = catalog.version;
  return out;
}

function hasLegacyData() {
  const foco = exRead(FOCO_KEY, null);
  const rec = exRead(RECURSOS_KEY, null);
  const trk = exRead(TRACK_KEY, null);
  const duv = exRead(DUVIDAS_KEY, null);
  return !!((foco && Object.keys(foco).length) || (Array.isArray(rec) && rec.length) || (Array.isArray(trk) && trk.length) || (Array.isArray(duv) && duv.length) || localStorage.getItem(EXAME_DATA_KEY));
}

function migrateFromLegacy() {
  const s = defaultState();
  const foco = exRead(FOCO_KEY, {});
  const recursos = exRead(RECURSOS_KEY, []);
  const track = exRead(TRACK_KEY, []);
  const duvidas = exRead(DUVIDAS_KEY, []);
  const dataAlvo = lerDataAlvoLegacy();
  s.exams.forEach(e => { if (e.id !== 'disc-geral') e.dataExame = dataAlvo; });

  // Topics from track (group under Domínio/Subdomínio Geral)
  const domainMap = {};
  const subMap = {};
  function ensureGeral(disciplinaId) {
    if (!domainMap[disciplinaId]) {
      const dom = { id: uid('dom'), disciplinaId, parentId: null, tipo:'dominio', titulo:'Geral' };
      s.topics.push(dom); domainMap[disciplinaId] = dom.id;
    }
    if (!subMap[disciplinaId]) {
      const sub = { id: uid('sub'), disciplinaId, parentId: domainMap[disciplinaId], tipo:'subdominio', titulo:'Geral' };
      s.topics.push(sub); subMap[disciplinaId] = sub.id;
    }
    return subMap[disciplinaId];
  }
  (Array.isArray(track) ? track : []).forEach(r => {
    const disciplinaId = discNomeToId(r.disciplina);
    const parentId = ensureGeral(disciplinaId);
    const estadoMap = { 'A iniciar':'nao_iniciado', 'Em progresso':'em_progresso', 'Concluído':'concluido' };
    const topic = {
      id: r.id || uid('top'),
      disciplinaId, parentId, tipo:'topico',
      titulo: r.topico || 'Sem título',
      estado: estadoMap[r.estado] || 'nao_iniciado',
      confianca: clamp(Number(r.dificuldade||3),1,5),
      notasPessoais: '',
      materialIds: [],
      exercicioIds: [],
      ultimaAtividade: Date.now(),
      legadoFicha: r.ficha || '',
    };
    s.topics.push(topic);
    // foco progresso hint into notes if exists
    const focoDisc = (r.disciplina||'').replace('Matemática A','Matematica A');
  });
  // Apply foco info as notes on a synthetic topic if track empty
  Object.entries(foco || {}).forEach(([disc, f]) => {
    const disciplinaId = discNomeToId(disc);
    const hasTopics = s.topics.some(t => t.disciplinaId===disciplinaId && t.tipo==='topico');
    if (!hasTopics && (f.topico || f.objetivo)) {
      const parentId = ensureGeral(disciplinaId);
      s.topics.push({ id: uid('top'), disciplinaId, parentId, tipo:'topico', titulo: f.topico || 'Tópico atual', estado: (Number(f.progresso||0)>=100)?'concluido':(Number(f.progresso||0)>0?'em_progresso':'nao_iniciado'), confianca:3, notasPessoais: f.objetivo || '', materialIds:[], exercicioIds:[], ultimaAtividade: Date.now(), progressoFoco: Number(f.progresso||0) });
    }
  });

  // Materials from recursos and track fichas/links
  (Array.isArray(recursos) ? recursos : []).forEach(r => {
    const url = (r.url||'').trim();
    const tipo = /exame/i.test(r.nome||'') ? 'exame' : (/ficha/i.test(r.nome||'') ? 'ficha' : (/resumo/i.test(r.nome||'') ? 'resumo' : (url ? 'link':'documento')));
    s.materials.push({ id: r.id || uid('mat'), titulo: r.nome || 'Material', tipo, url, disciplinaId: discNomeToId(r.disciplina), topicId:'', etiquetas:[], descricao:'', addedAt: Date.now() });
  });
  s.topics.filter(t=>t.tipo==='topico' && t.legadoFicha).forEach(t => {
    const f = t.legadoFicha; delete t.legadoFicha;
    const url = /^https?:\/\//i.test(f) ? f : '';
    const mat = { id: uid('mat'), titulo: url ? f : f, tipo: url ? 'link':'ficha', url, disciplinaId: t.disciplinaId, topicId: t.id, etiquetas:[], descricao:'', addedAt: Date.now() };
    s.materials.push(mat); t.materialIds.push(mat.id);
  });

  // Issues from duvidas
  (Array.isArray(duvidas) ? duvidas : []).forEach(d => {
    const tipo = d.tipo === 'erro' ? 'erro_teste' : 'conceito';
    const estado = d.tipo === 'erro' ? 'por_resolver' : 'precisa_revisao';
    s.issues.push({ id: d.id || uid('iss'), tipo, disciplinaId: discNomeToId(d.disciplina), topicId:'', titulo: d.titulo || 'Registo', descricao: d.texto || '', resolucao:'', estado, origem:'legado', createdAt: Date.now(), updatedAt: Date.now(), _rever: true });
  });

  return s;
}

function loadState() {
  const stored = exRead(STORE_KEY, null);
  if (stored && typeof stored === 'object' && stored.schemaVersion >= 2) return normalizeState(stored);
  // migrate if needed
  if (hasLegacyData() || stored) {
    const migrated = migrateFromLegacy();
    // if stored was partial v1-like custom, try merge softly
    if (stored && !stored.schemaVersion) {
      // unknown old shape: keep migrated defaults
    }
    exWrite(STORE_KEY, migrated);
    return migrated;
  }
  const fresh = defaultState();
  exWrite(STORE_KEY, fresh);
  return fresh;
}

/* ── Sync entre aparelhos (documento v2) ─────────────────
   O estado inteiro viaja no sync (campo examesV2). A fusão é feita por
   id — união das listas com LWW pelo carimbo de cada item — e os
   apagados ficam em tombstones durante 30 dias. Assim adicionar num
   aparelho e editar no outro não perde nada, e apagar propaga. */
const APAGADO_MS = 30 * 24 * 60 * 60 * 1000;
const COLECOES = ['exams', 'topics', 'materials', 'sessions', 'issues', 'practice', 'reviews', 'planHistory'];

function carimboItem(x) {
  if (!x || typeof x !== 'object') return 0;
  return Number(x.updatedAt || x.atualizadoEm || x.ultimaAtividade
    || x.createdAt || x.addedAt || 0) || 0;
}

function normalizarApagados(entrada) {
  const out = {};
  COLECOES.forEach((tipo) => {
    const lista = (entrada && Array.isArray(entrada[tipo])) ? entrada[tipo] : [];
    const mapa = new Map();
    lista.forEach((e) => {
      if (!e || typeof e.id !== 'string') return;
      const ts = Number(e.ts) || 0;
      if (!mapa.has(e.id) || ts > mapa.get(e.id)) mapa.set(e.id, ts);
    });
    const agora = Date.now();
    out[tipo] = [...mapa.entries()]
      .filter(([, ts]) => agora - ts < APAGADO_MS)
      .map(([id, ts]) => ({ id, ts }));
  });
  return out;
}

function marcarApagado(tipo, id) {
  if (!COLECOES.includes(tipo) || !id) return;
  state.apagados = normalizarApagados(state.apagados);
  state.apagados[tipo] = [
    ...state.apagados[tipo].filter((e) => e.id !== id),
    { id, ts: Date.now() },
  ];
}

function juntarLista(local, remoto, apagados) {
  const mapa = new Map();
  const sepultados = new Map((apagados || []).map((e) => [e.id, Number(e.ts) || 0]));
  const considerar = (item) => {
    if (!item || typeof item.id !== 'string') return;
    const ts = carimboItem(item);
    if ((sepultados.get(item.id) || 0) >= ts) return; // apagado depois da edição
    const atual = mapa.get(item.id);
    if (!atual || ts >= carimboItem(atual)) mapa.set(item.id, item);
  };
  (Array.isArray(local) ? local : []).forEach(considerar);
  (Array.isArray(remoto) ? remoto : []).forEach(considerar);
  return [...mapa.values()];
}

function fundirEstado(local, remoto) {
  const l = normalizeState(local);
  const r = normalizeState(remoto);
  const apagados = normalizarApagados({
    ...Object.fromEntries(COLECOES.map(tipo=>[tipo,[...(l.apagados?.[tipo]||[]),...(r.apagados?.[tipo]||[])]])),
  });
  const out = normalizeState({ ...l });
  COLECOES.forEach(tipo=>{ out[tipo]=juntarLista(l[tipo],r[tipo],apagados[tipo]); });
  out.settings = (Number(r.updatedAt)||0) > (Number(l.updatedAt)||0) ? r.settings : l.settings;
  out.activePlan = (Number(r.activePlan?.generatedAt)||0) > (Number(l.activePlan?.generatedAt)||0) ? r.activePlan : l.activePlan;
  out.apagados = apagados;
  out.updatedAt = Math.max(Number(l.updatedAt) || 0, Number(r.updatedAt) || 0);
  return out;
}

/* Aplicado pelo sync (Gist/conta) quando chega um documento remoto.
   Escreve sem `exWrite` de propósito: um pull não deve disparar outro
   push (senão os dois aparelhos ficavam a empurrar em ciclo). */
function fundirRemoto(remoto) {
  if (!remoto || typeof remoto !== 'object') return false;
  const local = loadState();
  const fundido = fundirEstado(local, remoto);
  const antes = JSON.stringify([local.exams, local.topics, local.materials, local.sessions, local.issues,local.practice,local.reviews,local.planHistory,local.activePlan]);
  const depois = JSON.stringify([fundido.exams, fundido.topics, fundido.materials, fundido.sessions, fundido.issues,fundido.practice,fundido.reviews,fundido.planHistory,fundido.activePlan]);
  state = fundido;
  if (antes !== depois) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* segue */ }
  }
  return antes !== depois;
}

function saveState() {
  state.updatedAt = Date.now();
  exWrite(STORE_KEY, state);
  renderAll();
  window.dispatchEvent(new CustomEvent('studyjournal:exam-plan-updated'));
}

function getExam(id){ return state.exams.find(e=>e.id===id); }
function getTopic(id){ return state.topics.find(t=>t.id===id); }
function topicLabel(id){ const t=getTopic(id); return t? t.titulo : ''; }
function discLabel(id){ const e=getExam(id); return e? e.nome : 'Geral'; }
function allTopicsFlat(){ return state.topics.filter(t=>(t.tipo==='topico' || t.kind==='topic') && !t.archived); }

function topicStatusLabel(st){ return ({nao_iniciado:'Não iniciado', em_progresso:'Em estudo', concluido:'Concluído', precisa_revisao:'A rever'})[st]||st; }
function topicStatusClass(st){ return ({nao_iniciado:'ex-badge-muted', em_progresso:'ex-badge-warn', concluido:'ex-badge-ok', precisa_revisao:'ex-badge-rev'})[st]||'ex-badge-muted'; }
function issueStatusLabel(st){ return ({por_resolver:'Por resolver', em_analise:'Em análise', resolvido:'Resolvido', precisa_revisao:'Precisa de revisão'})[st]||st; }
function issueStatusClass(st){ return ({por_resolver:'ex-badge-err', em_analise:'ex-badge-warn', resolvido:'ex-badge-ok', precisa_revisao:'ex-badge-rev'})[st]||'ex-badge-muted'; }

function progressOverall() {
  const tops = allTopicsFlat();
  if (!tops.length) return { pct:0, done:0, total:0, pending:0 };
  const done = tops.filter(t=>t.estado==='concluido').length;
  const started = tops.filter(t=>t.estado!=='nao_iniciado').length;
  const mastery = Math.round(tops.reduce((n,t)=>n+(Number(t.masteryPct)||0),0)/tops.length);
  const pending = tops.length - done;
  return { pct: Math.round((started/tops.length)*100), mastery, studied: started, done, total: tops.length, pending };
}

function generateStudyPlan(keepHistory = true) {
  if (!window.ExamEngine) return null;
  if (keepHistory && state.activePlan) state.planHistory.unshift(state.activePlan);
  const next = window.ExamEngine.generate(allTopicsFlat(), state.exams, state.settings, todayKey());
  state.activePlan = next;
  state.planHistory = state.planHistory.slice(0, 180);
  saveState();
  return next;
}
function marcarSemanaNoHorario() {
  if (!state.activePlan?.week || !window.Weekly?.importarPlanoExames) return miniToast('O Horário semanal não está disponível.', 'warn');
  const monday = state.activePlan.week[0]?.date;
  const entries = state.activePlan.week.flatMap(day => day.items || []);
  const completed = state.sessions.filter(s=>s.concluida && s.planItemId).map(s=>s.planItemId);
  const result = window.Weekly.importarPlanoExames(entries, { monday, planId:state.activePlan.id, completedPlanItemIds:completed });
  miniToast(`${result.placed.length} sessão(ões) colocadas no Horário${result.skipped.length ? ` · ${result.skipped.length} sem espaço` : ''}.`);
}
function plannedEntry(entry) {
  const labels = { new: 'Aprender', revision: 'Revisão', practice: 'Prática' };
  const topic = getTopic(entry.topicId);
  const method = entry.method || null;
  const methodBadge = `<span class="ex-plan-method">${esc(method?.label || labels[entry.activity] || entry.activity)}</span>`;
  const methodDetails = method && Array.isArray(method.steps) && method.steps.length
    ? `<details class="ex-plan-method-details"><summary>Como estudar · ${esc(method.label)}</summary><ol>${method.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>${method.prompt?`<p>${esc(method.prompt)}</p>`:''}</details>`
    : '';
  return `<article class="ex-plan-entry">
    <div class="ex-plan-entry-head">${methodBadge}<span class="ex-plan-type">${labels[entry.activity]||entry.activity}</span><span class="ex-priority">${entry.priority}/100</span><span class="ex-muted-sm">${esc(discLabel(entry.disciplinaId))} · ${entry.durationMin} min</span></div>
    <strong>${esc(topic?.titulo||'Tópico removido')}</strong>
    <p>${esc(entry.objective)}</p>
    ${methodDetails}
    <small>${esc(entry.reason)}</small>
    <button type="button" class="ex-btn ex-btn-sm ex-btn-primary" data-plan-start="${esc(entry.id)}">Começar sessão</button>
  </article>`;
}
function ensureCurrentPlan() {
  if (!state.activePlan || state.activePlan.today !== todayKey() || !Array.isArray(state.activePlan.recommendations) || !state.activePlan.agenda) {
    state.activePlan = window.ExamEngine?.generate(allTopicsFlat(), state.exams, state.settings, todayKey()) || null;
  }
}
async function startPlannedSession(entryId) {
  const entry = state.activePlan?.[ui.planRange === 'week' ? 'week' : 'daily']?.items?.find(x=>x.id===entryId)
    || state.activePlan?.week?.flatMap(x=>x.items).find(x=>x.id===entryId)
    || state.activePlan?.month?.flatMap(x=>x.items).find(x=>x.id===entryId);
  if (!entry) return;
  let session = state.sessions.find(s=>s.planItemId===entry.id);
  if (!session) {
    session = { id:uid('sess'), planItemId:entry.id, disciplinaId:entry.disciplinaId, topicId:entry.topicId, data:entry.date, duracaoMin:entry.durationMin, activity:entry.activity, objetivo:entry.objective, methodId:entry.method?.id||'', methodLabel:entry.method?.label||'', methodSteps:entry.method?.steps||[], methodPrompt:entry.method?.prompt||'', selfRating:0, notas:'', concluida:false, createdAt:Date.now(), updatedAt:Date.now(), calendarTaskId:null, calendarDate:entry.date };
    state.sessions.unshift(session);
    if (typeof persistirTarefasDia === 'function') {
      try {
        const tasks = typeof read === 'function' ? read(`study-journal-tasks-${entry.date}`, []) : [];
        const calId = `${Date.now()}-exam-${Math.random().toString(36).slice(2,7)}`;
        tasks.push({ id:calId, text:`${entry.activity==='revision'?'Rever':entry.activity==='practice'?'Exercícios:':'Estudar:'} ${topicLabel(entry.topicId)}`, subject:discLabel(entry.disciplinaId), category:'aula', done:false, origemExames:{ type:'session', sessionId:session.id } });
        await persistirTarefasDia(entry.date, tasks); session.calendarTaskId=calId;
      } catch { /* sessão mantém-se no Study Center mesmo se o calendário falhar */ }
    }
    saveState();
  }
  openSessionCompletion(session);
}
function snoozeSuggestedTopic(topicId, days = 1) {
  const topic = getTopic(topicId);
  if (!topic) return;
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Number(days) || 1));
  topic.ignoredUntil = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  topic.recommendationHistory = [...(Array.isArray(topic.recommendationHistory) ? topic.recommendationHistory : []), { date: todayKey(), action: 'snoozed' }].slice(-20);
  topic.updatedAt = Date.now();
  saveState();
  miniToast('Tópico adiado. Volta a aparecer nas recomendações amanhã.');
}

function startSuggestedSession(topicId, methodId = '') {
  const topic = getTopic(topicId);
  if (!topic) return;
  if (topic.ignoredUntil) { topic.ignoredUntil = ''; topic.updatedAt = Date.now(); }
  const rec = window.ExamEngine?.recommendTopics([topic], state.exams, state.settings, { today: todayKey(), limit: 1 })[0];
  const method = rec?.method || window.ExamEngine?.pickStudyMethod(topic, { today: todayKey() }, { today: todayKey(), settings: state.settings });
  const activity = ['spaced_repetition', 'relearn', 'maintenance'].includes(method?.id)
    ? 'revision'
    : method?.id === 'new_learning'
      ? 'new'
      : 'practice';
  topic.lastRecommendedAt = Date.now();
  topic.recommendationHistory = [...(Array.isArray(topic.recommendationHistory) ? topic.recommendationHistory : []), { date: todayKey(), action: 'started', methodId: method?.id || '' }].slice(-20);
  topic.updatedAt = Date.now();
  const session = {
    id: uid('sess'),
    disciplinaId: topic.disciplinaId,
    topicId: topic.id,
    data: todayKey(),
    duracaoMin: method?.estimatedMin || Number(state.settings.sessionMinutes) || 25,
    activity,
    objetivo: method?.objective || '',
    methodId: method?.id || methodId || '',
    methodLabel: method?.label || '',
    methodSteps: method?.steps || [],
    methodPrompt: method?.prompt || '',
    selfRating: 0,
    concluida: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.sessions.unshift(session);
  saveState();
  openSessionCompletion(session);
}

function openSessionCompletion(session) {
  const topic=getTopic(session.topicId); if(!topic) return miniToast('O tópico associado já não existe.','warn');
  const methodBlock = session.methodLabel ? `<div class="ex-session-method"><span class="ex-plan-method">${esc(session.methodLabel)}</span>${Array.isArray(session.methodSteps)&&session.methodSteps.length?`<ol>${session.methodSteps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}${session.methodPrompt?`<p>${esc(session.methodPrompt)}</p>`:''}</div>` : '';
  const dlg=document.createElement('dialog'); dlg.className='m-auto w-[min(42rem,94vw)] ex-dialog';
  dlg.innerHTML=`<form class="ex-dialog-inner">
    <div class="ex-dialog-head"><div><h3>Registar sessão</h3><p>${esc(discLabel(session.disciplinaId))} · ${esc(topic.titulo)}</p></div><button type="button" class="ex-btn ex-btn-sm" data-close>Fechar</button></div>
    <div class="ex-dialog-body ex-form-stack">${methodBlock}<div class="ex-form-grid-2">
      <label class="ex-label">Minutos<input name="duration" type="number" min="1" value="${Number(session.duracaoMin)||45}" class="ex-input" required></label>
      <label class="ex-label">Dificuldade sentida (1–5)<input name="difficulty" type="number" min="1" max="5" value="${Number(topic.difficulty)||3}" class="ex-input"></label>
      <label class="ex-label">Exercícios resolvidos<input name="count" type="number" min="0" value="0" class="ex-input"></label>
      <label class="ex-label">Respostas corretas<input name="correct" type="number" min="0" value="0" class="ex-input"></label>
      <label class="ex-label">Confiança (1–5)<input name="confidence" type="number" min="1" max="5" value="${Number(topic.confianca)||3}" class="ex-input"></label>
      <label class="ex-label">Autonomia (1–5)<input name="autonomy" type="number" min="1" max="5" value="3" class="ex-input"></label>
      <label class="ex-label">Recuperação ativa (1–5)<input name="selfRating" type="number" min="1" max="5" value="${Number(session.selfRating)||3}" class="ex-input"></label>
    </div><label class="ex-label">Dificuldades / notas<textarea name="notes" class="ex-input" rows="3">${esc(topic.dificuldades||'')}</textarea></label></div>
    <div class="ex-dialog-foot"><button type="button" class="ex-btn" data-close>Cancelar</button><button class="ex-btn ex-btn-primary" type="submit">Concluir e atualizar domínio</button></div>
  </form>`;
  document.body.append(dlg); const close=()=>{dlg.close();dlg.remove();};
  dlg.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',close));
  dlg.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault(); const fd=new FormData(e.currentTarget);
    const count=Number(fd.get('count'))||0, correct=Number(fd.get('correct'))||0;
    session.duracaoMin=Number(fd.get('duration'))||session.duracaoMin;
    session.concluida=true; session.updatedAt=Date.now(); session.exerciseCount=count; session.correctCount=Math.min(correct,count); session.difficulty=Number(fd.get('difficulty'))||3; session.confidence=Number(fd.get('confidence'))||3;
    session.notas=String(fd.get('notes')||'');
    session.autonomy=Number(fd.get('autonomy'))||3;
    session.selfRating=Number(fd.get('selfRating'))||0;
    window.ExamEngine.applySession(topic,{durationMin:session.duracaoMin,exerciseCount:count,correctCount:correct,difficulty:session.difficulty,confidence:session.confidence,autonomy:session.autonomy,selfRating:session.selfRating,methodId:session.methodId||'',activity:session.activity,difficultyNotes:session.notas},todayKey());
    topic.dificuldades=session.notas; topic.updatedAt=Date.now();
    if(session.activity==='revision') state.reviews.unshift({id:uid('review'),topicId:topic.id,disciplinaId:topic.disciplinaId,date:todayKey(),masteryPct:topic.masteryPct,accuracyPct:count?Math.round(100*Math.min(correct,count)/count):null,nextReviewDate:topic.nextReviewDate,createdAt:Date.now()});
    if(count){
      state.practice.unshift({id:uid('exercise'),topicId:topic.id,disciplinaId:topic.disciplinaId,kind:'session',date:todayKey(),count,correct:Math.min(correct,count),accuracyPct:Math.round(100*Math.min(correct,count)/count),difficulty:session.difficulty,createdAt:Date.now()});
      if(correct<count) state.issues.unshift({id:uid('iss'),tipo:'exercicio_dificil',disciplinaId:topic.disciplinaId,topicId:topic.id,titulo:`${count-correct} erro(s) em sessão`,descricao:`${correct}/${count} corretas. ${session.notas}`,resolucao:'',estado:'precisa_revisao',createdAt:Date.now(),updatedAt:Date.now()});
    }
    creditarSessaoNosTotais(session); close(); generateStudyPlan(true); refrescarEstatisticas(); miniToast('Sessão registada; domínio, revisão e plano semanal atualizados.');
  }); dlg.showModal();
}

// ---------- DOM helpers ----------
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function setTab(name){
  ui.tab = TABS.includes(name)?name:'overview';
  try { localStorage.setItem(EXAME_TAB_KEY, ui.tab); } catch {}
  $all('[data-exame-tab]').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.exameTab===ui.tab)));
  $all('[data-exame-panel]').forEach(p=>{ p.hidden = p.dataset.examePanel !== ui.tab; });
  renderAll();
}
function bindTabs(){
  $all('[data-exame-tab]').forEach(btn=>{ if(btn.dataset.bound) return; btn.dataset.bound='1'; btn.addEventListener('click', ()=>setTab(btn.dataset.exameTab)); });
}

// ---------- Overview / Dashboard ----------
function daysUntil(dateStr){
  const d = parseDate(dateStr); if(!d) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((d - now)/(1000*60*60*24));
}
function renderOverview(){
  const wrap = $('#exames-overview'); if(!wrap) return;
  ensureCurrentPlan();
  const prog = progressOverall();
  const revs = window.ExamEngine ? window.ExamEngine.pendingReviews(allTopicsFlat()).length : 0;
  const lastTopic = getTopic(state.ui.lastTopicId) || allTopicsFlat().sort((a,b)=>(b.ultimaAtividade||0)-(a.ultimaAtividade||0))[0];
  const examsHtml = state.exams.filter(e=>e.id!=='disc-geral').map(e=>{
    const d = daysUntil(e.dataExame);
    const label = d==null ? 'Sem data' : (d>0 ? `${d} dias` : 'Hoje/Passado');
    const course = allTopicsFlat().filter(t=>t.disciplinaId===e.id);
    const studied = course.filter(t=>t.estado!=='nao_iniciado').length;
    const coursePct = course.length ? Math.round(studied/course.length*100) : 0;
    const mastery = course.length ? Math.round(course.reduce((n,t)=>n+(Number(t.masteryPct)||0),0)/course.length) : 0;
    return `<article class="ex-count-card" style="--ex-accent:${esc(e.cor||'#7AA7D9')}"><div class="ex-count-top"><span class="ex-count-name">${esc(e.nome)}</span><span class="ex-count-date">${e.dataExame?esc(fmtDate(e.dataExame)):'Data por definir'}</span></div><div class="ex-count-days">${esc(label)}</div><div class="ex-count-bottom"><span>Matéria <b>${coursePct}%</b></span><span>Domínio <b>${mastery}%</b></span></div><div class="ex-bar"><div style="width:${coursePct}%"></div></div></article>`;
  }).join('');
  const daily = state.activePlan?.daily?.items || [];
  const recommendations = window.ExamEngine?.recommendTopics(allTopicsFlat(), state.exams, state.settings, { today: todayKey(), limit: 4 }) || [];
  const focus = daily[0];
  const dailyHtml = daily.length ? daily.slice(1,4).map(x=>`<div class="ex-focus-queue"><span>${esc(discLabel(x.disciplinaId))}</span><strong>${esc(topicLabel(x.topicId)||'Tópico')}</strong><small>${x.durationMin} min · ${esc(x.method?.label || (x.activity==='revision'?'Revisão':x.activity==='practice'?'Prática':'Aprendizagem'))}</small><button type="button" class="ex-btn ex-btn-sm" data-plan-start="${esc(x.id)}">Iniciar</button></div>`).join('') : '<div class="ex-empty">Sem sessões restantes para hoje.</div>';
  const attentionHtml = recommendations.map((r)=>`<div class="ex-recommendation"><div class="ex-recommendation-title"><strong>${esc(r.topic.titulo)}</strong><span>${r.priority}/100</span></div><small>${esc(discLabel(r.topic.disciplinaId))} · ${esc(r.method.label)} · domínio ${Number(r.topic.masteryPct)||0}%${r.blocked?' · pré-requisitos':''}</small><p>${esc(r.reasons.slice(0,2).join(' · ')||'Consolidação recomendada')}</p><div class="ex-recommendation-actions"><button type="button" class="ex-btn ex-btn-sm" data-review-suggest="${esc(r.topic.id)}" data-review-method="${esc(r.method.id)}">Estudar</button><button type="button" class="ex-btn ex-btn-sm" data-suggest-snooze="${esc(r.topic.id)}">Adiar</button></div></div>`).join('') || '<div class="ex-empty">As recomendações aparecem quando existirem tópicos no programa.</div>';
  const bySubject = state.exams.filter(e=>e.id!=='disc-geral').map(e=>{
    const ts=allTopicsFlat().filter(t=>t.disciplinaId===e.id); const pct=ts.length?Math.round(ts.filter(t=>t.estado!=='nao_iniciado').length/ts.length*100):0;
    return `<div class="ex-subject-progress"><div><span>${esc(e.nome)}</span><strong>Estudado ${pct}% · Domínio ${ts.length?Math.round(ts.reduce((n,t)=>n+(Number(t.masteryPct)||0),0)/ts.length):0}%</strong></div><div class="ex-bar"><div style="width:${pct}%;background:${esc(e.cor||'#8994a8')}"></div></div></div>`;
  }).join('');

  const weekStart = (()=>{ const d=new Date(); const wd=d.getDay()||7; d.setDate(d.getDate()-wd+1); d.setHours(0,0,0,0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const weekDone=state.sessions.filter(s=>s.concluida && s.data>=weekStart);
  const weekMinutes=weekDone.reduce((n,s)=>n+(Number(s.duracaoMin)||0),0);
  const weeklyTarget=state.exams.filter(e=>e.id!=='disc-geral').reduce((n,e)=>n+(Number(e.weeklyMinutes)||0),0);
  wrap.innerHTML = `
    <header class="ex-hero"><div><span class="ex-eyebrow">STUDY JOURNAL / EXAM CENTER</span><h2 class="ex-title">O teu espaço de preparação</h2><p class="ex-sub">Uma visão clara do progresso, das prioridades e do próximo passo.</p></div><div class="ex-hero-actions"><button type="button" class="ex-btn" data-settings-open>Configurar exames</button><button type="button" class="ex-btn ex-btn-primary" data-generate-plan>Atualizar plano</button></div></header>
    <section class="ex-overview-section"><div class="ex-section-head"><div><span class="ex-eyebrow">CALENDÁRIO</span><h3>Contagem decrescente</h3></div><span class="ex-muted-sm">Datas e objetivos nas configurações</span></div><div class="ex-grid-countdowns">${examsHtml || '<p class="ex-muted">Sem exames configurados.</p>'}</div></section>
    <section class="ex-overview-section ex-learning-strip"><div class="ex-section-head"><div><span class="ex-eyebrow">PROGRESSO GLOBAL</span><h3>Aprendizagem</h3></div></div><div class="ex-learning-grid"><div><strong>${prog.pct}%</strong><span>Matéria estudada</span><div class="ex-bar"><div style="width:${prog.pct}%"></div></div></div><div><strong>${prog.mastery||0}%</strong><span>Domínio estimado</span></div><div><strong>${prog.studied}<small> / ${prog.total}</small></strong><span>Tópicos iniciados</span></div><div><strong>${revs}</strong><span>Revisões pendentes</span></div></div></section>
    <div class="ex-overview-grid ex-overview-main"><section class="ex-card ex-focus-card"><div class="ex-section-head"><div><span class="ex-eyebrow">PRÓXIMA MELHOR AÇÃO</span><h3>Today's Focus</h3></div><button type="button" class="ex-btn ex-btn-sm" data-open-tab="plan">Ver planeador</button></div>${focus?`<div class="ex-focus-feature"><div class="ex-focus-meta"><span>${esc(discLabel(focus.disciplinaId))}</span><span>${focus.durationMin} min</span><span>Prioridade ${focus.priority}/100</span>${focus.method?`<span>${esc(focus.method.label)}</span>`:''}</div><h4>${esc(topicLabel(focus.topicId)||'Tópico de estudo')}</h4><p>${esc(focus.objective||'Consolidar a matéria e registar o resultado da sessão.')}</p>${focus.method?.prompt?`<p class="ex-focus-prompt">${esc(focus.method.prompt)}</p>`:''}<button type="button" class="ex-btn ex-btn-primary" data-plan-start="${esc(focus.id)}">Iniciar sessão <span aria-hidden="true">→</span></button></div><div class="ex-focus-queue-list">${dailyHtml}</div>`:'<div class="ex-empty">Sem sessões recomendadas para hoje. Atualiza o plano ou revê as configurações.</div>'}</section><section class="ex-card ex-recommendations"><div class="ex-section-head"><div><span class="ex-eyebrow">PRÓXIMOS PASSOS</span><h3>Recomendações</h3></div><button type="button" class="ex-btn ex-btn-sm" data-open-tab="syllabus">Explorar</button></div><div class="ex-attention-list">${attentionHtml}</div></section></div>
    <div class="ex-overview-grid ex-overview-bottom"><section class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">ESTA SEMANA</span><h3>Weekly Progress</h3></div><button type="button" class="ex-btn ex-btn-sm" data-open-tab="plan">Planeador</button></div><div class="ex-weekly-metrics"><div><strong>${weekDone.length}</strong><span>sessões concluídas</span></div><div><strong>${Math.floor(weekMinutes/60)}h ${weekMinutes%60}m</strong><span>tempo estudado</span></div><div><strong>${Math.floor(weeklyTarget/60)}h</strong><span>objetivo semanal</span></div><div><strong>${state.activePlan?.week?.flatMap(d=>d.items||[]).length||0}</strong><span>sessões planeadas</span></div></div>${bySubject}</section><section class="ex-card ex-continue"><div class="ex-section-head"><div><span class="ex-eyebrow">RETOMAR</span><h3>Último tópico</h3></div></div>${lastTopic?`<div class="ex-continue-row"><div><div class="ex-continue-title">${esc(lastTopic.titulo)}</div><div class="ex-muted-sm">${esc(discLabel(lastTopic.disciplinaId))} · ${esc(topicStatusLabel(lastTopic.estado))}</div></div><button type="button" class="ex-btn ex-btn-primary" data-go-topic="${esc(lastTopic.id)}">Continuar</button></div>`:'<p class="ex-muted">A tua atividade recente aparecerá aqui.</p>'}</section></div>
    <dialog class="ex-dialog ex-settings-dialog" data-exam-settings><form class="ex-dialog-inner"><div class="ex-dialog-head"><div><h3>Configurações dos exames</h3><p>Define datas, objetivos e tempo semanal por disciplina.</p></div><button type="button" class="ex-btn ex-btn-sm" data-settings-close>Fechar</button></div><div class="ex-dialog-body ex-settings-list">${state.exams.filter(e=>e.id!=='disc-geral').map(e=>`<section class="ex-settings-row"><div class="ex-count-name" style="--ex-accent:${esc(e.cor||'#7AA7D9')}">${esc(e.nome)}</div><label class="ex-label">Data do exame<input type="date" class="ex-input" data-exam-date="${esc(e.id)}" value="${esc(e.dataExame||'')}"></label><label class="ex-label">Objetivo (%)<input type="number" min="0" max="100" class="ex-input" data-exam-goal="${esc(e.id)}" value="${Number(e.goal)||80}"></label><label class="ex-label">Minutos por semana<input type="number" min="0" max="1680" step="30" class="ex-input" data-exam-time="${esc(e.id)}" value="${Number(e.weeklyMinutes)||300}"></label></section>`).join('')}</div></form></dialog>`;

  $all('[data-exam-date]', wrap).forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const ex = getExam(inp.dataset.examDate); if(!ex) return;
      ex.dataExame = inp.value || '';
      ex.updatedAt = Date.now();
      exWrite(STORE_KEY, state); miniToast('Data do exame atualizada. Atualiza o plano para refletir a nova data.');
    });
  });
  wrap.querySelector('[data-settings-open]')?.addEventListener('click',()=>wrap.querySelector('[data-exam-settings]')?.showModal());
  wrap.querySelector('[data-settings-close]')?.addEventListener('click',()=>wrap.querySelector('[data-exam-settings]')?.close());
  $all('[data-exam-goal]',wrap).forEach(inp=>inp.addEventListener('change',()=>{const e=getExam(inp.dataset.examGoal);if(e){e.goal=clamp(Number(inp.value)||0,0,100);e.updatedAt=Date.now();exWrite(STORE_KEY,state);}}));
  $all('[data-exam-time]',wrap).forEach(inp=>inp.addEventListener('change',()=>{const e=getExam(inp.dataset.examTime);if(e){e.weeklyMinutes=clamp(Number(inp.value)||0,0,1680);e.updatedAt=Date.now();exWrite(STORE_KEY,state);}}));
  wrap.querySelector('[data-generate-plan]')?.addEventListener('click',()=>generateStudyPlan(true));
  $all('[data-open-tab]',wrap).forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.openTab)));
  $all('[data-plan-start]',wrap).forEach(b=>b.addEventListener('click',()=>startPlannedSession(b.dataset.planStart)));
  $all('[data-review-suggest]',wrap).forEach(b=>b.addEventListener('click',()=>startSuggestedSession(b.dataset.reviewSuggest,b.dataset.reviewMethod)));
  $all('[data-suggest-snooze]',wrap).forEach(b=>b.addEventListener('click',()=>snoozeSuggestedTopic(b.dataset.suggestSnooze)));
  $all('[data-go-topic]', wrap).forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.dataset.goTopic; state.ui.lastTopicId = id; exWrite(STORE_KEY, state);
      setTab('syllabus');
      setTimeout(()=>{ const el = document.querySelector(`[data-topic-id="${CSS.escape(id)}"]`); el?.scrollIntoView({behavior:'smooth', block:'center'}); }, 50);
    });
  });
}

// ---------- Topics (hierarchy) ----------
const TOPIC_VIEW_KEY = 'study-journal-exames-topico-vista';

function lerVistaTopicos() {
  try { return localStorage.getItem(TOPIC_VIEW_KEY) === 'quadro' ? 'quadro' : 'lista'; } catch { return 'lista'; }
}
function guardarVistaTopicos(vista) {
  try { localStorage.setItem(TOPIC_VIEW_KEY, vista === 'lista' ? 'lista' : 'quadro'); } catch { /* segue */ }
}

const BOARD_GRUPOS = [
  { chave: 'nao_iniciado', titulo: 'O que vou estudar', nota: 'Ainda por começar', inclui: ['nao_iniciado'] },
  { chave: 'em_progresso', titulo: 'O que estou a estudar', nota: 'Em progresso', inclui: ['em_progresso', 'precisa_revisao'] },
  { chave: 'concluido', titulo: 'O que já estudei', nota: 'Concluído', inclui: ['concluido'] },
];

function grupoDoEstado(estado) {
  if (estado === 'concluido') return 'concluido';
  if (estado === 'nao_iniciado') return 'nao_iniciado';
  return 'em_progresso';
}

function caminhoTopico(t) {
  const sub = t.parentId ? state.topics.find(x => x.id === t.parentId) : null;
  const dom = sub && sub.parentId ? state.topics.find(x => x.id === sub.parentId) : null;
  const partes = [discLabel(t.disciplinaId)];
  if (dom && dom.titulo && dom.titulo.toLowerCase() !== 'geral') partes.push(dom.titulo);
  if (sub && sub.titulo && sub.titulo.toLowerCase() !== 'geral') partes.push(sub.titulo);
  return partes;
}

function topicCard(t) {
  const mats = (t.materialIds || []).map(id => getMat(id)).filter(Boolean);
  const exs = (t.exercicioIds || []).map(id => getIssue(id)).filter(Boolean);
  const caminho = caminhoTopico(t);
  const cor = getExam(t.disciplinaId)?.cor || '#7AA7D9';
  return `<article class="ex-board-card" data-topic-id="${esc(t.id)}">
    <span class="ex-board-grip" role="presentation" title="Arrastar tópico"></span>
    <div class="ex-board-main">
      <div class="ex-board-title">${esc(t.titulo)}</div>
      <div class="ex-board-meta">
        <span class="ex-board-disc" style="background:${esc(cor)}"></span>
        <span>${esc(caminho.join(' · '))}</span>
      </div>
      ${t.notasPessoais ? `<div class="ex-board-notes">${esc(t.notasPessoais)}</div>` : ''}
      <div class="ex-board-tags">
        <span class="ex-badge ${topicStatusClass(t.estado)}">${esc(topicStatusLabel(t.estado))}</span>
        <span class="ex-muted-sm">Confiança ${esc(String(t.confianca || 3))}/5</span>
        ${mats.length ? `<span class="ex-muted-sm">${mats.length} materiais</span>` : ''}
        ${exs.length ? `<span class="ex-muted-sm">${exs.length} exercícios</span>` : ''}
      </div>
    </div>
    <div class="ex-board-actions">
      <select class="ex-input ex-input-sm" data-topic-estado="${esc(t.id)}" aria-label="Estado de ${esc(t.titulo)}">
        ${['nao_iniciado', 'em_progresso', 'concluido', 'precisa_revisao'].map(s => `<option value="${s}" ${t.estado === s ? 'selected' : ''}>${topicStatusLabel(s)}</option>`).join('')}
      </select>
      <div class="ex-board-btns">
        <button type="button" class="ex-btn ex-btn-sm ex-icon-btn" data-topic-edit="${esc(t.id)}" title="Editar" aria-label="Editar ${esc(t.titulo)}"><svg class="icon h-3.5 w-3.5" aria-hidden="true"><use href="#i-pencil"/></svg></button>
        <button type="button" class="ex-btn ex-btn-sm ex-icon-btn" data-topic-study="${esc(t.id)}" title="Estudar" aria-label="Estudar ${esc(t.titulo)}"><svg class="icon h-3.5 w-3.5" aria-hidden="true"><use href="#i-play"/></svg></button>
        <button type="button" class="ex-btn ex-btn-sm ex-icon-btn ex-btn-danger" data-topic-del="${esc(t.id)}" title="Apagar" aria-label="Apagar ${esc(t.titulo)}"><svg class="icon h-3.5 w-3.5" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </div>
    </div>
  </article>`;
}

function boardTopicsHtml(tops) {
  return `<div class="ex-board">
    <p class="ex-board-hint">Arrasta um tópico pela pega para o mover entre estados. No telemóvel, toca na pega e desliza.</p>
    ${BOARD_GRUPOS.map(g => {
    const itens = tops.filter(t => g.inclui.includes(t.estado));
    return `<section class="ex-board-group" data-grupo="${g.chave}" aria-label="${esc(g.titulo)}">
      <header class="ex-board-head">
        <span class="ex-board-dot ex-board-dot-${g.chave}"></span>
        <h3>${esc(g.titulo)}</h3>
        <span class="ex-board-note">${esc(g.nota)}</span>
        <span class="ex-board-count">${itens.length}</span>
      </header>
      <div class="ex-board-list">
        ${itens.length ? itens.map(topicCard).join('') : '<div class="ex-board-empty">Arrasta tópicos para aqui.</div>'}
      </div>
    </section>`;
  }).join('')}</div>`;
}

/* ── Arrastar tópicos entre estados ───────────────────── */

let arrastoTopico = null;
let ouvintesArrasto = false;

function garantirOuvintesArrasto() {
  if (ouvintesArrasto) return;
  ouvintesArrasto = true;
  window.addEventListener('pointermove', moverArrastoTopico, { passive: false });
  window.addEventListener('pointerup', soltarArrastoTopico);
  window.addEventListener('pointercancel', cancelarArrastoTopico);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && arrastoTopico) cancelarArrastoTopico();
  });
}

function posicionarFantasma(x, y) {
  if (!arrastoTopico) return;
  arrastoTopico.ghost.style.transform = `translate3d(${x - arrastoTopico.dx}px, ${y - arrastoTopico.dy}px, 0) rotate(.6deg)`;
}

function destacarGrupoSob(x, y) {
  if (!arrastoTopico) return;
  let grupo = null;
  try {
    const el = document.elementFromPoint(x, y);
    grupo = el ? el.closest('.ex-board-group') : null;
  } catch { grupo = null; }
  if (grupo === arrastoTopico.grupo) return;
  if (arrastoTopico.grupo) arrastoTopico.grupo.classList.remove('is-over');
  arrastoTopico.grupo = grupo;
  if (grupo) grupo.classList.add('is-over');
}

function autoScrollArrasto(y) {
  const margem = 80;
  if (y < margem) window.scrollBy(0, -14);
  else if (y > window.innerHeight - margem) window.scrollBy(0, 14);
}

function moverArrastoTopico(e) {
  if (!arrastoTopico) return;
  e.preventDefault();
  posicionarFantasma(e.clientX, e.clientY);
  destacarGrupoSob(e.clientX, e.clientY);
  autoScrollArrasto(e.clientY);
}

function iniciarArrastoTopico(card, e) {
  if (arrastoTopico) return;
  const r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('ex-board-ghost');
  ghost.style.width = `${r.width}px`;
  (card.closest('#view-exames') || document.body).append(ghost);
  card.classList.add('is-dragging');
  document.body.classList.add('ex-board-dragging');
  arrastoTopico = {
    card,
    id: card.dataset.topicId,
    ghost,
    dx: e.clientX - r.left,
    dy: e.clientY - r.top,
    grupo: null,
  };
  posicionarFantasma(e.clientX, e.clientY);
  destacarGrupoSob(e.clientX, e.clientY);
  garantirOuvintesArrasto();
}

function terminarArrastoTopico(grupo, cancelado) {
  const d = arrastoTopico;
  if (!d) return;
  arrastoTopico = null;
  d.ghost.remove();
  d.card.classList.remove('is-dragging');
  document.body.classList.remove('ex-board-dragging');
  document.querySelectorAll('.ex-board-group.is-over').forEach(el => el.classList.remove('is-over'));
  if (cancelado || !grupo) return;

  const novo = grupo.dataset.grupo;
  const t = getTopic(d.id);
  if (!t || grupoDoEstado(t.estado) === novo) return;

  t.estado = novo;
  t.ultimaAtividade = Date.now();
  state.ui.lastTopicId = t.id;
  saveState();

  const nomes = { nao_iniciado: 'O que vou estudar', em_progresso: 'O que estou a estudar', concluido: 'O que já estudei' };
  miniToast(`Tópico movido para “${nomes[novo] || novo}”.`);
}

function soltarArrastoTopico() {
  if (!arrastoTopico) return;
  const grupo = arrastoTopico.grupo;
  terminarArrastoTopico(grupo, false);
}

function cancelarArrastoTopico() {
  terminarArrastoTopico(null, true);
}

function bindTopicBoard(root) {
  $all('.ex-board-grip', root).forEach(grip => {
    grip.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = grip.closest('.ex-board-card');
      if (!card) return;
      e.preventDefault();
      iniciarArrastoTopico(card, e);
    });
  });
  $all('.ex-board-card', root).forEach(card => {
    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // no toque, só pela pega
      if (e.button !== 0) return;
      if (e.target.closest('button, select, input, textarea, a, option')) return;
      iniciarArrastoTopico(card, e);
    });
  });
}

function ensureDomainSub(disciplinaId, domTitle='Geral', subTitle='Geral'){
  let dom = state.topics.find(t=>t.tipo==='dominio' && t.disciplinaId===disciplinaId && t.titulo.toLowerCase()===domTitle.toLowerCase());
  if(!dom){ dom={id:uid('dom'), disciplinaId, parentId:null, tipo:'dominio', titulo:domTitle, ultimaAtividade: Date.now()}; state.topics.push(dom); }
  let sub = state.topics.find(t=>t.tipo==='subdominio' && t.disciplinaId===disciplinaId && t.parentId===dom.id && t.titulo.toLowerCase()===subTitle.toLowerCase());
  if(!sub){ sub={id:uid('sub'), disciplinaId, parentId:dom.id, tipo:'subdominio', titulo:subTitle, ultimaAtividade: Date.now()}; state.topics.push(sub); }
  return { dom, sub };
}
function renderTopics(){
  const wrap = $('#exames-topicos'); if(!wrap) return;
  if(arrastoTopico) return; // não trocar o DOM a meio de um arrasto
  const discOpts = state.exams.map(e=>`<option value="${esc(e.id)}" ${ui.topicFilterDisc===e.id?'selected':''}>${esc(e.nome)}</option>`).join('');
  const discFormOpts = state.exams.filter(e=>e.id!=='disc-geral').concat(state.exams.filter(e=>e.id==='disc-geral')).map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const q = (ui.topicQuery||'').toLowerCase().trim();
  const vista = lerVistaTopicos();

  const tops = allTopicsFlat().filter(t=>{
    if(ui.topicFilterDisc!=='all' && t.disciplinaId!==ui.topicFilterDisc) return false;
    if(ui.topicFilterEstado!=='all' && t.estado!==ui.topicFilterEstado) return false;
    if(ui.topicFilterPriority==='high' && Number(t.importancia||t.prioridade||3)<4) return false;
    if(ui.topicFilterPriority==='due' && !(t.nextReviewDate && t.nextReviewDate<=todayKey())) return false;
    if(q){
      const hay = `${t.titulo} ${t.descricao||''} ${t.notasPessoais||''} ${t.dificuldades||''} ${discLabel(t.disciplinaId)}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  const visible = new Set(tops.map(t=>t.id));
  function treeNode(node, depth=0){
    const kids = state.topics.filter(t=>t.parentId===node.id && !t.archived);
    const visibleKids = kids.filter(k=>k.kind==='topic'||k.tipo==='topico' ? visible.has(k.id) : hasVisible(k));
    if((node.kind==='topic'||node.tipo==='topico')) return visible.has(node.id) ? topicRow(node) : '';
    if(!visibleKids.length && (q || ui.topicFilterEstado!=='all' || ui.topicFilterPriority!=='all')) return '';
    if(!kids.length) return '';
    return `<details class="ex-curriculum-group" ${depth<2?'open':''}><summary><span>${esc(node.titulo)}</span><small>${visibleKids.length} ${visibleKids.length===1?'tópico':'itens'}</small></summary><div class="ex-curriculum-children">${visibleKids.map(k=>treeNode(k,depth+1)).join('')}</div></details>`;
  }
  function hasVisible(node){ return state.topics.some(t=>t.parentId===node.id && !t.archived && ((t.kind==='topic'||t.tipo==='topico') ? visible.has(t.id) : hasVisible(t))); }
  const discs = state.exams.filter(e=> ui.topicFilterDisc==='all' ? e.id!=='disc-geral' && state.topics.some(t=>t.disciplinaId===e.id&&!t.archived) : e.id===ui.topicFilterDisc);
  let treeHtml = '';
  discs.forEach(d=>{
    const roots = state.topics.filter(t=>t.disciplinaId===d.id && !t.parentId && !t.archived);
    const html = roots.map(n=>treeNode(n)).filter(Boolean).join('');
    const collapsed = ui.collapsedSyllabusDisciplines.has(d.id);
    treeHtml += `<section class="ex-card ex-disc-block"><header class="ex-disc-head"><span class="ex-disc-dot" style="background:${d.cor||'#7AA7D9'}"></span><h3>${esc(d.nome)}</h3><span class="ex-source-tag">${tops.filter(t=>t.disciplinaId===d.id).length} tópicos</span><button type="button" class="ex-btn ex-btn-sm ex-disc-collapse" data-disc-collapse="${esc(d.id)}" aria-expanded="${!collapsed}">${collapsed?'Ver mais':'Ver menos'}</button></header><div class="ex-disc-content" ${collapsed?'hidden':''}>${html || '<div class="ex-empty">Sem tópicos para os filtros atuais.</div>'}</div></section>`;
  });
  if(!treeHtml) treeHtml = `<div class="ex-card ex-empty">Sem tópicos para os filtros atuais.</div>`;

  wrap.innerHTML = `
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Adicionar tópico personalizado</h3></div>
      <form id="ex-topic-form" class="ex-form-grid ex-form-topics">
        <select id="ex-topic-disc" class="ex-input">${discFormOpts}</select>
        <input id="ex-topic-dom" class="ex-input" placeholder="Domínio" value="Geral">
        <input id="ex-topic-sub" class="ex-input" placeholder="Tema" value="Geral">
        <input id="ex-topic-title" class="ex-input" placeholder="Tópico" required>
        <select id="ex-topic-estado" class="ex-input">
          <option value="nao_iniciado">Não iniciado</option>
          <option value="em_progresso">Em progresso</option>
          <option value="concluido">Concluído</option>
          <option value="precisa_revisao">Precisa de revisão</option>
        </select>
        <button type="submit" class="ex-btn ex-btn-primary">Adicionar</button>
      </form>
    </div>

    <div class="ex-card ex-toolbar">
      <input id="ex-topic-q" class="ex-input" placeholder="Pesquisar tópicos…" value="${esc(ui.topicQuery)}">
      <select id="ex-topic-fdisc" class="ex-input"><option value="all">Todas as disciplinas</option>${discOpts}</select>
      ${vista === 'lista' ? `<select id="ex-topic-festado" class="ex-input">
        <option value="all" ${ui.topicFilterEstado==='all'?'selected':''}>Todos os estados</option>
        <option value="nao_iniciado" ${ui.topicFilterEstado==='nao_iniciado'?'selected':''}>Não iniciado</option>
        <option value="em_progresso" ${ui.topicFilterEstado==='em_progresso'?'selected':''}>Em progresso</option>
        <option value="concluido" ${ui.topicFilterEstado==='concluido'?'selected':''}>Concluído</option>
        <option value="precisa_revisao" ${ui.topicFilterEstado==='precisa_revisao'?'selected':''}>Precisa de revisão</option>
      </select>` : ''}
      <select id="ex-topic-fpriority" class="ex-input"><option value="all">Todas as prioridades</option><option value="high" ${ui.topicFilterPriority==='high'?'selected':''}>Prioridade alta</option><option value="due" ${ui.topicFilterPriority==='due'?'selected':''}>Revisão pendente</option></select>
      <div class="ex-view-toggle" role="group" aria-label="Vista dos tópicos">
        <button type="button" data-topic-view="quadro" aria-pressed="${vista === 'quadro'}">Quadro</button>
        <button type="button" data-topic-view="lista" aria-pressed="${vista === 'lista'}">Lista</button>
      </div>
    </div>

    ${vista === 'quadro' ? boardTopicsHtml(tops) : `<div class="ex-syllabus-explorer"><aside class="ex-syllabus-sidebar"><span class="ex-eyebrow">DISCIPLINAS</span><button type="button" data-syllabus-disc="all" class="${ui.topicFilterDisc==='all'?'is-active':''}">Todas <span>${allTopicsFlat().length}</span></button>${state.exams.filter(e=>e.id!=='disc-geral').map(e=>`<button type="button" data-syllabus-disc="${esc(e.id)}" class="${ui.topicFilterDisc===e.id?'is-active':''}"><i style="--ex-accent:${esc(e.cor||'#7AA7D9')}"></i>${esc(e.nome)}<span>${allTopicsFlat().filter(t=>t.disciplinaId===e.id).length}</span></button>`).join('')}</aside><div class="ex-topics-tree">${treeHtml}</div></div>`}
  `;

  $('#ex-topic-form')?.addEventListener('submit', e=>{
    e.preventDefault();
    const disciplinaId = $('#ex-topic-disc').value;
    const dom = ($('#ex-topic-dom').value||'Geral').trim() || 'Geral';
    const sub = ($('#ex-topic-sub').value||'Geral').trim() || 'Geral';
    const titulo = ($('#ex-topic-title').value||'').trim();
    const estado = $('#ex-topic-estado').value || 'nao_iniciado';
    if(!titulo) return miniToast('Escreve o tópico.', 'warn');
    const { sub: subNode } = ensureDomainSub(disciplinaId, dom, sub);
    state.topics.push({ id: uid('top'), disciplinaId, parentId: subNode.id, tipo:'topico', kind:'topic', titulo, descricao:'', importance:3, prioridade:3, difficulty:3, estado, masteryPct:0, confianca:3, confidence:3, notasPessoais:'', dificuldades:'', materialIds:[], exercicioIds:[], exerciseCount:0, studyMinutes:0, accuracyPct:null, lastRecommendedAt:0, reviewLapses:0, recommendationHistory:[], ultimaAtividade: Date.now() });
    saveState(); miniToast('Tópico adicionado.');
  });
  $('#ex-topic-q')?.addEventListener('input', e=>{ ui.topicQuery = e.target.value; renderTopics(); });
  $('#ex-topic-fdisc')?.addEventListener('change', e=>{ ui.topicFilterDisc = e.target.value; renderTopics(); });
  $('#ex-topic-festado')?.addEventListener('change', e=>{ ui.topicFilterEstado = e.target.value; renderTopics(); });
  $('#ex-topic-fpriority')?.addEventListener('change', e=>{ ui.topicFilterPriority = e.target.value; renderTopics(); });
  $all('[data-syllabus-disc]',wrap).forEach(b=>b.addEventListener('click',()=>{ui.topicFilterDisc=b.dataset.syllabusDisc;renderTopics();}));
  $all('[data-topic-view]', wrap).forEach(b=>b.addEventListener('click', ()=>{
    if(b.dataset.topicView === vista) return;
    guardarVistaTopicos(b.dataset.topicView);
    renderTopics();
  }));
  $all('[data-disc-collapse]', wrap).forEach(b=>b.addEventListener('click', ()=>{
    const id = b.dataset.discCollapse;
    if (ui.collapsedSyllabusDisciplines.has(id)) ui.collapsedSyllabusDisciplines.delete(id);
    else ui.collapsedSyllabusDisciplines.add(id);
    renderTopics();
  }));

  bindTopicActions(wrap);
  if(vista === 'quadro') bindTopicBoard(wrap);
}

function topicRow(t){
  const mats = (t.materialIds||[]).map(id=>getMat(id)).filter(Boolean);
  const exs = (t.exercicioIds||[]).map(id=>getIssue(id)).filter(Boolean);
  return `<div class="ex-topic-row" data-topic-id="${esc(t.id)}">
    <div class="ex-topic-main">
      <div class="ex-topic-title">${esc(t.titulo)}</div>
      <div class="ex-topic-meta">
        <span class="ex-badge ${topicStatusClass(t.estado)}">${esc(topicStatusLabel(t.estado))}</span>
        <span class="ex-muted-sm">Domínio ${Number(t.masteryPct)||0}%</span>
        <span class="ex-muted-sm">Prioridade ${Number(t.importancia||t.prioridade||3)}/5</span>
        ${t.nextReviewDate?`<span class="ex-muted-sm">Rever ${esc(fmtDate(t.nextReviewDate))}</span>`:''}
        ${mats.length?`<span class="ex-muted-sm">${mats.length} materiais</span>`:''}
        ${exs.length?`<span class="ex-muted-sm">${exs.length} exercícios</span>`:''}
      </div>
      <div class="ex-mastery-track"><span style="width:${clamp(Number(t.masteryPct)||0,0,100)}%"></span></div>
      ${t.descricao?`<div class="ex-topic-description">${esc(t.descricao)}</div>`:''}
      ${t.dificuldades?`<div class="ex-topic-difficulty">Dificuldade: ${esc(t.dificuldades)}</div>`:''}
      ${t.notasPessoais ? `<div class="ex-topic-notes">${esc(t.notasPessoais)}</div>` : ''}
    </div>
    <div class="ex-topic-actions">
      <select class="ex-input ex-input-sm" data-topic-estado="${esc(t.id)}" aria-label="Estado">
        ${['nao_iniciado','em_progresso','concluido','precisa_revisao'].map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${topicStatusLabel(s)}</option>`).join('')}
      </select>
      <select class="ex-input ex-input-sm" data-topic-conf="${esc(t.id)}" aria-label="Confiança">
        ${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.confianca||3)===n?'selected':''}>Conf. ${n}</option>`).join('')}
      </select>
      <label class="ex-mastery-input">Domínio <input type="number" min="0" max="100" value="${clamp(Number(t.masteryPct)||0,0,100)}" data-topic-mastery="${esc(t.id)}" aria-label="Domínio de 0 a 100 por cento">%</label>
      <button type="button" class="ex-btn ex-btn-sm" data-topic-edit="${esc(t.id)}"><svg class="icon h-3.5 w-3.5" aria-hidden="true"><use href="#i-pencil"/></svg><span>Editar</span></button>
      <button type="button" class="ex-btn ex-btn-sm" data-topic-study="${esc(t.id)}">Estudar</button>
      <button type="button" class="ex-btn ex-btn-sm ex-btn-danger" data-topic-del="${esc(t.id)}" aria-label="Apagar tópico">Apagar</button>
    </div>
  </div>`;
}
function bindTopicActions(root){
  $all('[data-topic-estado]', root).forEach(sel=>sel.addEventListener('change', ()=>{
    const t=getTopic(sel.dataset.topicEstado); if(!t) return; t.estado=sel.value; t.ultimaAtividade=Date.now(); state.ui.lastTopicId=t.id; saveState();
  }));
  $all('[data-topic-conf]', root).forEach(sel=>sel.addEventListener('change', ()=>{
    const t=getTopic(sel.dataset.topicConf); if(!t) return; t.confianca=Number(sel.value||3); t.ultimaAtividade=Date.now(); state.ui.lastTopicId=t.id; saveState();
  }));
  $all('[data-topic-mastery]', root).forEach(inp=>inp.addEventListener('change', ()=>{
    const t=getTopic(inp.dataset.topicMastery); if(!t) return; t.masteryPct=clamp(Number(inp.value)||0,0,100); t.updatedAt=Date.now(); saveState();
  }));
  $all('[data-topic-edit]', root).forEach(b=>b.addEventListener('click', ()=> openTopicDialog(b.dataset.topicEdit)));
  $all('[data-topic-study]', root).forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.topicStudy; state.ui.lastTopicId=id; exWrite(STORE_KEY,state); setTab('plan');
  }));
  $all('[data-topic-del]', root).forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.topicDel; const t=getTopic(id); if(!t) return;
    if(!confirm(`Apagar o tópico "${t.titulo}"?`)) return;
    marcarApagado('topics', id);
    state.topics = state.topics.filter(x=>x.id!==id);
    state.materials.forEach(m=>{ if(m.topicId===id) m.topicId=''; });
    state.sessions.forEach(s=>{ if(s.topicId===id) s.topicId=''; });
    state.issues.forEach(i=>{ if(i.topicId===id) i.topicId=''; });
    saveState();
  }));
}
function openTopicDialog(id){
  const t=getTopic(id); if(!t) return;
  const prerequisites = allTopicsFlat().filter(x=>x.id!==t.id && (x.kind==='topic'||x.tipo==='topico'));
  const prereqHtml = prerequisites.map(x=>`<option value="${esc(x.id)}" ${(t.blockedBy||t.prerequisiteIds||[]).includes(x.id)?'selected':''}>${esc(discLabel(x.disciplinaId))} · ${esc(x.titulo)}</option>`).join('');
  const dlg = document.createElement('dialog');
  dlg.className = 'm-auto w-[min(38rem,94vw)] ex-dialog';
  dlg.innerHTML = `<form method="dialog" class="ex-dialog-inner">
    <div class="ex-dialog-head"><h3>Editar tópico</h3><button type="button" class="ex-btn ex-btn-sm" data-close>Fechar</button></div>
    <div class="ex-dialog-body ex-form-stack">
      <label class="ex-label">Nome<input id="td-title" class="ex-input" value="${esc(t.titulo)}"></label>
      <label class="ex-label">Descrição<textarea id="td-description" class="ex-input" rows="2">${esc(t.descricao||'')}</textarea></label>
      <div class="ex-form-grid-2">
        <label class="ex-label">Estado<select id="td-estado" class="ex-input">${['nao_iniciado','em_progresso','concluido','precisa_revisao'].map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${topicStatusLabel(s)}</option>`).join('')}</select></label>
        <label class="ex-label">Domínio (%)<input id="td-mastery" type="number" min="0" max="100" class="ex-input" value="${clamp(Number(t.masteryPct)||0,0,100)}"></label>
        <label class="ex-label">Prioridade (1–5)<input id="td-priority" type="number" min="1" max="5" class="ex-input" value="${clamp(Number(t.importancia||t.prioridade||3),1,5)}"></label>
        <label class="ex-label">Dificuldade (1–5)<input id="td-difficulty" type="number" min="1" max="5" class="ex-input" value="${clamp(Number(t.difficulty||3),1,5)}"></label>
        <label class="ex-label">Confiança (1–5)<input id="td-conf" type="number" min="1" max="5" class="ex-input" value="${clamp(Number(t.confianca||3),1,5)}"></label>
      </div>
      <label class="ex-label">Dificuldades identificadas<textarea id="td-difficulty-notes" class="ex-input" rows="2">${esc(t.dificuldades||'')}</textarea></label>
      <label class="ex-label">Pré-requisitos (o plano desbloqueia estes tópicos quando o domínio atingir 60%)<select id="td-prereqs" class="ex-input" multiple size="5">${prereqHtml}</select></label>
      <label class="ex-label">Notas pessoais<textarea id="td-notas" class="ex-input" rows="3">${esc(t.notasPessoais||'')}</textarea></label>
      ${t.needsValidation?'<p class="ex-source-tag">Conteúdo inicial baseado nas tuas notas; validação contra a Informação-Prova de 2027 pendente.</p>':''}
    </div>
    <div class="ex-dialog-foot"><button type="button" class="ex-btn" data-close>Cancelar</button><button type="submit" class="ex-btn ex-btn-primary">Guardar</button></div>
  </form>`;
  document.body.append(dlg);
  const close=()=>{ dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', close));
  dlg.addEventListener('click', e=>{ if(e.target===dlg) close(); });
  dlg.querySelector('form').addEventListener('submit', e=>{
    e.preventDefault();
    t.titulo = ($('#td-title',dlg).value||'').trim() || t.titulo;
    if(t.source) t.userTitle=t.titulo;
    t.descricao = ($('#td-description',dlg).value||'').trim();
    t.estado = $('#td-estado',dlg).value;
    t.confianca = Number($('#td-conf',dlg).value||3);
    t.masteryPct = clamp(Number($('#td-mastery',dlg).value)||0,0,100);
    t.importancia = t.prioridade = clamp(Number($('#td-priority',dlg).value)||3,1,5);
    t.difficulty = clamp(Number($('#td-difficulty',dlg).value)||3,1,5);
    t.dificuldades = ($('#td-difficulty-notes',dlg).value||'').trim();
    t.blockedBy = [...$('#td-prereqs',dlg).selectedOptions].map(o=>o.value);
    t.notasPessoais = ($('#td-notas',dlg).value||'').trim();
    t.ultimaAtividade = Date.now(); state.ui.lastTopicId = t.id;
    close(); saveState(); miniToast('Tópico atualizado.');
  });
  dlg.showModal();
}

// ---------- Materials / Library ----------
function getMat(id){ return state.materials.find(m=>m.id===id); }
function matTypeLabel(t){ return ({pdf:'PDF',documento:'Documento',resumo:'Resumo',apontamento:'Apontamento',exame:'Exame nacional',ficha:'Ficha',link:'Link',formula:'Fórmula',imagem:'Imagem'})[t]||t; }
function renderMateriais(){
  const wrap = $('#exames-materiais'); if(!wrap) return;
  const discOpts = state.exams.map(e=>`<option value="${esc(e.id)}" ${ui.matFilterDisc===e.id?'selected':''}>${esc(e.nome)}</option>`).join('');
  const discForm = state.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const topForm = allTopicsFlat().map(t=>`<option value="${esc(t.id)}">${esc(discLabel(t.disciplinaId))} · ${esc(t.titulo)}</option>`).join('');
  const q = (ui.matQuery||'').toLowerCase().trim();
  const tagq = (ui.matFilterTag||'').toLowerCase().trim();
  const list = state.materials.filter(m=>{
    if(ui.matFilterDisc!=='all' && m.disciplinaId!==ui.matFilterDisc) return false;
    if(ui.matFilterTipo!=='all' && m.tipo!==ui.matFilterTipo) return false;
    if(tagq && !(m.etiquetas||[]).some(t=>t.toLowerCase().includes(tagq))) return false;
    if(q){ const hay = `${m.titulo} ${m.descricao||''} ${(m.etiquetas||[]).join(' ')} ${discLabel(m.disciplinaId)}`.toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  }).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));

  wrap.innerHTML = `
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Adicionar material</h3></div>
      <form id="ex-mat-form" class="ex-form-grid ex-form-mats">
        <input id="ex-mat-title" class="ex-input" placeholder="Título" required>
        <select id="ex-mat-tipo" class="ex-input">
          <option value="link">Link</option><option value="pdf">PDF</option><option value="documento">Documento</option>
          <option value="resumo">Resumo</option><option value="apontamento">Apontamento</option><option value="exame">Exame nacional</option>
          <option value="ficha">Ficha</option><option value="formula">Fórmula</option><option value="imagem">Imagem</option>
        </select>
        <select id="ex-mat-disc" class="ex-input"><option value="">Disciplina (opcional)</option>${discForm}</select>
        <select id="ex-mat-topic" class="ex-input"><option value="">Tópico (opcional)</option>${topForm}</select>
        <input id="ex-mat-url" class="ex-input" placeholder="URL / referência (opcional)">
        <input id="ex-mat-tags" class="ex-input" placeholder="Etiquetas (vírgula)">
        <button type="submit" class="ex-btn ex-btn-primary">Guardar</button>
      </form>
    </div>
    <div class="ex-card ex-toolbar">
      <input id="ex-mat-q" class="ex-input" placeholder="Pesquisar materiais…" value="${esc(ui.matQuery)}">
      <select id="ex-mat-fdisc" class="ex-input"><option value="all">Todas as disciplinas</option>${discOpts}</select>
      <select id="ex-mat-ftipo" class="ex-input">
        <option value="all">Todos os tipos</option>
        ${['pdf','documento','resumo','apontamento','exame','ficha','link','formula','imagem'].map(t=>`<option value="${t}" ${ui.matFilterTipo===t?'selected':''}>${matTypeLabel(t)}</option>`).join('')}
      </select>
      <input id="ex-mat-ftag" class="ex-input" placeholder="Etiqueta" value="${esc(ui.matFilterTag)}">
    </div>
    <div class="ex-card"><div class="ex-section-head"><h3>Biblioteca</h3><span class="ex-muted-sm">${list.length} itens</span></div>
      <div class="ex-list">${list.length? list.map(m=>matRow(m)).join('') : '<div class="ex-empty">Sem materiais para os filtros atuais.</div>'}</div>
    </div>`;

  $('#ex-mat-form')?.addEventListener('submit', e=>{
    e.preventDefault();
    const titulo = ($('#ex-mat-title').value||'').trim(); if(!titulo) return miniToast('Indica o título.', 'warn');
    const tipo = $('#ex-mat-tipo').value;
    const disciplinaId = $('#ex-mat-disc').value || '';
    const topicId = $('#ex-mat-topic').value || '';
    const url = ($('#ex-mat-url').value||'').trim();
    const etiquetas = ($('#ex-mat-tags').value||'').split(',').map(s=>s.trim()).filter(Boolean);
    const m = { id: uid('mat'), titulo, tipo, url, disciplinaId, topicId, etiquetas, descricao:'', addedAt: Date.now() };
    state.materials.unshift(m);
    if(topicId){ const t=getTopic(topicId); if(t){ t.materialIds=t.materialIds||[]; t.materialIds.push(m.id); } }
    saveState(); miniToast('Material guardado.');
  });
  $('#ex-mat-q')?.addEventListener('input', e=>{ ui.matQuery=e.target.value; renderMateriais(); });
  $('#ex-mat-fdisc')?.addEventListener('change', e=>{ ui.matFilterDisc=e.target.value; renderMateriais(); });
  $('#ex-mat-ftipo')?.addEventListener('change', e=>{ ui.matFilterTipo=e.target.value; renderMateriais(); });
  $('#ex-mat-ftag')?.addEventListener('input', e=>{ ui.matFilterTag=e.target.value; renderMateriais(); });
  $all('[data-mat-del]').forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.matDel;
    marcarApagado('materials', id);
    state.materials = state.materials.filter(x=>x.id!==id);
    state.topics.forEach(t=>{ if(t.materialIds) t.materialIds=t.materialIds.filter(x=>x!==id); });
    saveState();
  }));
  $all('[data-mat-open]').forEach(b=>b.addEventListener('click', ()=>{
    const m=getMat(b.dataset.matOpen); if(m&&m.url) window.open(m.url, '_blank', 'noopener');
  }));
}
function matRow(m){
  const url = m.url && /^https?:\/\//i.test(m.url) ? m.url : '';
  return `<div class="ex-row">
    <div class="ex-row-main">
      <div class="ex-row-title">${esc(m.titulo)}</div>
      <div class="ex-row-meta">
        <span class="ex-badge ex-badge-muted">${esc(matTypeLabel(m.tipo))}</span>
        ${m.disciplinaId?`<span class="ex-muted-sm">${esc(discLabel(m.disciplinaId))}</span>`:''}
        ${m.topicId?`<span class="ex-muted-sm">· ${esc(topicLabel(m.topicId))}</span>`:''}
        ${(m.etiquetas||[]).map(t=>`<span class="ex-tag">#${esc(t)}</span>`).join('')}
      </div>
      ${url?`<a class="ex-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.length>60?url.slice(0,60)+'…':url)}</a>`:''}
    </div>
    <div class="ex-row-actions">
      ${url?`<button type="button" class="ex-btn ex-btn-sm" data-mat-open="${esc(m.id)}">Abrir</button>`:''}
      <button type="button" class="ex-btn ex-btn-sm ex-btn-danger" data-mat-del="${esc(m.id)}">Apagar</button>
    </div>
  </div>`;
}

// ---------- Issues / Revisão / Dúvidas ----------
function getIssue(id){ return state.issues.find(i=>i.id===id); }
function isErroTipo(t){ return ['erro_teste','erro_exame','exercicio_dificil','duvida'].includes(t); }
function isRevisaoTipo(t){ return ['conceito','formula','resolucao'].includes(t); }
function issueTypeLabel(t){ return ({conceito:'Conceito', formula:'Fórmula', duvida:'Dúvida', exercicio_dificil:'Exercício difícil', erro_teste:'Erro em teste', erro_exame:'Erro em exame', resolucao:'Resolução/Explicação'})[t]||t; }

function renderPractice(){
  const root=$('#exames-pratica-controls'); if(!root) return;
  const discForm=state.exams.filter(e=>e.id!=='disc-geral').map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const topicForm=allTopicsFlat().map(t=>`<option value="${esc(t.id)}">${esc(discLabel(t.disciplinaId))} · ${esc(t.titulo)}</option>`).join('');
  const recent=[...state.practice].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,20);
  root.innerHTML=`<section class="ex-card"><div class="ex-section-head"><div><h3>Registar prática</h3><span class="ex-muted-sm">Exercícios, exames nacionais e simulados.</span></div></div>
    <form id="practice-form" class="ex-form-grid ex-form-issues">
      <select name="kind" class="ex-input"><option value="exercise">Exercícios</option><option value="national_exam">Exame nacional</option><option value="mock_exam">Simulado</option></select>
      <select name="topicId" class="ex-input" required>${topicForm}</select>
      <input name="title" class="ex-input" placeholder="Nome / ano / fase (opcional)">
      <input name="count" type="number" min="0" class="ex-input" placeholder="Exercícios" required>
      <input name="correct" type="number" min="0" class="ex-input" placeholder="Respostas corretas" required>
      <input name="minutes" type="number" min="0" class="ex-input" placeholder="Minutos" value="0">
      <input name="difficulty" type="number" min="1" max="5" class="ex-input" placeholder="Dificuldade 1–5" value="3">
      <textarea name="errors" class="ex-input ex-span-2" rows="2" placeholder="Erros ou dúvidas que queres acompanhar"></textarea>
      <button class="ex-btn ex-btn-primary" type="submit">Guardar resultado</button>
    </form></section>
    <section class="ex-card"><div class="ex-section-head"><h3>Histórico de desempenho</h3><span class="ex-muted-sm">${state.practice.length} registos</span></div><div class="ex-list">${recent.map(p=>`<div class="ex-row"><div class="ex-row-main"><strong>${esc(p.title||({exercise:'Exercícios',national_exam:'Exame nacional',mock_exam:'Simulado',session:'Sessão'})[p.kind]||p.kind)} · ${esc(topicLabel(p.topicId))}</strong><div class="ex-row-meta"><span>${esc(discLabel(p.disciplinaId))}</span><span>${esc(fmtDate(p.date))}</span><span>${p.correct}/${p.count} corretas · ${p.accuracyPct}%</span><span>${p.minutes||0} min</span></div></div></div>`).join('')||'<div class="ex-empty">Ainda não há resultados registados.</div>'}</div></section>`;
  root.querySelector('#practice-form')?.addEventListener('submit',e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const topic=getTopic(String(fd.get('topicId')));if(!topic)return;
    const count=Math.max(0,Number(fd.get('count'))||0),correct=clamp(Number(fd.get('correct'))||0,0,count),minutes=Math.max(0,Number(fd.get('minutes'))||0),difficulty=clamp(Number(fd.get('difficulty'))||3,1,5);
    const item={id:uid('practice'),kind:String(fd.get('kind')),topicId:topic.id,disciplinaId:topic.disciplinaId,title:String(fd.get('title')||''),date:todayKey(),count,correct,accuracyPct:count?Math.round(correct/count*100):0,minutes,difficulty,errors:String(fd.get('errors')||''),createdAt:Date.now()};
    state.practice.unshift(item);window.ExamEngine.applySession(topic,{durationMin:minutes,exerciseCount:count,correctCount:correct,difficulty,confidence:topic.confidence||3,difficultyNotes:item.errors,activity:'practice'},todayKey());
    if(item.errors.trim()||correct<count)state.issues.unshift({id:uid('iss'),tipo:item.kind==='national_exam'?'erro_exame':'exercicio_dificil',disciplinaId:topic.disciplinaId,topicId:topic.id,titulo:item.title||`${count-correct} erro(s) em prática`,descricao:item.errors||`${correct}/${count} corretas`,resolucao:'',estado:'precisa_revisao',createdAt:Date.now(),updatedAt:Date.now()});
    generateStudyPlan(true);miniToast('Resultado guardado; domínio, prioridade, revisão e plano atualizados.');
  });
}

function renderRevisao(){
  const wrap = $('#exames-revisao'); if(!wrap) return;
  const pending = window.ExamEngine?.pendingReviews(allTopicsFlat()) || [];
  const pendingHtml = `<section class="ex-card"><div class="ex-section-head"><div><h3>Revisões pendentes hoje</h3><span class="ex-muted-sm">Intervalos adaptativos: 1, 3, 7, 14 e 30+ dias.</span></div><span class="ex-badge-count">${pending.length}</span></div><div class="ex-list">${pending.length?pending.map(({topic,daysLate,score})=>`<div class="ex-row"><div class="ex-row-main"><strong>${esc(topic.titulo)}</strong><div class="ex-row-meta"><span>${esc(discLabel(topic.disciplinaId))}</span><span>Domínio ${Number(topic.masteryPct)||0}%</span><span>${daysLate?`${daysLate} dia(s) de atraso`:'Hoje'}</span><span>Prioridade ${score}/100</span></div></div><button type="button" class="ex-btn ex-btn-primary" data-review-topic="${esc(topic.id)}">Rever e registar</button></div>`).join(''):'<div class="ex-empty">Sem revisões vencidas. Continua a registar os resultados das sessões.</div>'}</div></section>`;
  const recommendations = window.ExamEngine?.recommendTopics(allTopicsFlat(), state.exams, state.settings, { today: todayKey(), limit: 8 }) || [];
  const smart = recommendations.filter(r=>!r.maintenance).slice(0,4);
  const maintenance = recommendations.filter(r=>r.maintenance).slice(0,4);
  const suggestionRow = (r,label) => `<div class="ex-row"><div class="ex-row-main"><strong>${esc(r.topic.titulo)}</strong><div class="ex-row-meta"><span>${esc(discLabel(r.topic.disciplinaId))}</span><span>${esc(r.method.label)}</span><span>Prioridade ${r.priority}/100</span><span>${esc(r.reasons.slice(0,2).join(' · ')||'Consolidação recomendada')}</span></div></div><div class="ex-row-actions"><button type="button" class="ex-btn ex-btn-sm" data-review-suggest="${esc(r.topic.id)}" data-review-method="${esc(r.method.id)}">${label}</button><button type="button" class="ex-btn ex-btn-sm" data-suggest-snooze="${esc(r.topic.id)}">Adiar</button></div></div>`;
  const suggestionsHtml = `<section class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">MÉTODO + MOTIVO</span><h3>O que estudar a seguir</h3></div><span class="ex-muted-sm">${smart.length} sugestões</span></div><div class="ex-list">${smart.length?smart.map(r=>suggestionRow(r,'Estudar')).join(''):'<div class="ex-empty">Sem sugestões para agora.</div>'}</div></section>`;
  const maintenanceHtml = maintenance.length ? `<section class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">MANUTENÇÃO</span><h3>Tópicos dominados</h3></div><span class="ex-muted-sm">Carga mínima</span></div><div class="ex-list">${maintenance.map(r=>suggestionRow(r,'Rever')).join('')}</div></section>` : '';
  const discOpts = state.exams.map(e=>`<option value="${esc(e.id)}" ${ui.revFilterDisc===e.id?'selected':''}>${esc(e.nome)}</option>`).join('');
  const discForm = state.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const topForm = allTopicsFlat().map(t=>`<option value="${esc(t.id)}">${esc(discLabel(t.disciplinaId))} · ${esc(t.titulo)}</option>`).join('');
  const q=(ui.revQuery||'').toLowerCase().trim();
  const list = state.issues.filter(i=>{
    // revisão: conceitos/fórmulas/resoluções e também itens marcados precisa revisão
    if(!(isRevisaoTipo(i.tipo) || i.estado==='precisa_revisao')) return false;
    if(ui.revFilterDisc!=='all' && i.disciplinaId!==ui.revFilterDisc) return false;
    if(ui.revFilterEstado!=='all' && i.estado!==ui.revFilterEstado) return false;
    if(q){ const hay=`${i.titulo} ${i.descricao||''} ${i.resolucao||''} ${discLabel(i.disciplinaId)}`.toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  }).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));

  const upcoming = allTopicsFlat().filter(t=>t.nextReviewDate && t.nextReviewDate>todayKey()).sort((a,b)=>a.nextReviewDate.localeCompare(b.nextReviewDate)).slice(0,8);
  const reviewHistory = state.reviews.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,10);
  const reviewCenter = `<div class="ex-review-center-grid"><section class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">AGENDA</span><h3>Próximas revisões</h3></div><span class="ex-muted-sm">${upcoming.length} agendadas</span></div><div class="ex-list">${upcoming.map(t=>`<div class="ex-review-line"><strong>${esc(t.titulo)}</strong><span>${esc(discLabel(t.disciplinaId))}</span><span>${esc(fmtDate(t.nextReviewDate))}</span><b>${Number(t.masteryPct)||0}%</b></div>`).join('')||'<div class="ex-empty">Sem revisões futuras agendadas.</div>'}</div></section><section class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">ATIVIDADE</span><h3>Histórico recente</h3></div><span class="ex-muted-sm">${state.reviews.length} registos</span></div><div class="ex-list">${reviewHistory.map(r=>`<div class="ex-review-line"><strong>${esc(topicLabel(r.topicId)||'Revisão')}</strong><span>${esc(discLabel(r.disciplinaId))}</span><span>${esc(fmtDate(r.date))}</span><b>${r.masteryPct==null?'—':`${Number(r.masteryPct)}%`}</b></div>`).join('')||'<div class="ex-empty">Os resultados das revisões concluídas aparecerão aqui.</div>'}</div></section></div>`;

  wrap.innerHTML = `<header class="ex-review-heading"><span class="ex-eyebrow">MEMÓRIA ATIVA</span><h2 class="ex-title">Review Center</h2><p class="ex-sub">Revisões adaptativas, resultados e conteúdos que precisam de atenção.</p></header>${pendingHtml}${suggestionsHtml}${maintenanceHtml}${reviewCenter}
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Guardar para revisão</h3></div>
      <form id="ex-rev-form" class="ex-form-grid ex-form-issues">
        <select id="ex-rev-tipo" class="ex-input"><option value="conceito">Conceito</option><option value="formula">Fórmula</option><option value="resolucao">Resolução/Explicação</option><option value="duvida">Dúvida</option></select>
        <select id="ex-rev-disc" class="ex-input">${discForm}</select>
        <select id="ex-rev-topic" class="ex-input"><option value="">Tópico (opcional)</option>${topForm}</select>
        <select id="ex-rev-estado" class="ex-input"><option value="precisa_revisao">Precisa de revisão</option><option value="por_resolver">Por resolver</option><option value="em_analise">Em análise</option><option value="resolvido">Resolvido</option></select>
        <input id="ex-rev-title" class="ex-input ex-span-2" placeholder="Título (conceito, fórmula, tema)" required>
        <textarea id="ex-rev-desc" class="ex-input ex-span-2" rows="2" placeholder="Nota / conteúdo / resolução"></textarea>
        <button type="submit" class="ex-btn ex-btn-primary">Guardar</button>
      </form>
    </div>
    <div class="ex-card ex-toolbar">
      <input id="ex-rev-q" class="ex-input" placeholder="Pesquisar revisões…" value="${esc(ui.revQuery)}">
      <select id="ex-rev-fdisc" class="ex-input"><option value="all">Todas as disciplinas</option>${discOpts}</select>
      <select id="ex-rev-festado" class="ex-input">
        <option value="all">Todos os estados</option>
        ${['por_resolver','em_analise','resolvido','precisa_revisao'].map(s=>`<option value="${s}" ${ui.revFilterEstado===s?'selected':''}>${issueStatusLabel(s)}</option>`).join('')}
      </select>
    </div>
    <div class="ex-card"><div class="ex-section-head"><h3>Registos de revisão</h3><span class="ex-muted-sm">${list.length}</span></div>
      <div class="ex-list">${list.length? list.map(i=>issueRow(i,'rev')).join('') : '<div class="ex-empty">Sem registos para os filtros atuais.</div>'}</div>
    </div>`;

  $('#ex-rev-form')?.addEventListener('submit', e=>{
    e.preventDefault();
    addIssueFromForm('rev');
  });
  $all('[data-review-topic]',wrap).forEach(b=>b.addEventListener('click',()=>{
    const t=getTopic(b.dataset.reviewTopic); if(!t)return;
    const s={id:uid('sess'),disciplinaId:t.disciplinaId,topicId:t.id,data:todayKey(),duracaoMin:20,activity:'revision',concluida:false,createdAt:Date.now(),updatedAt:Date.now()};
    state.sessions.unshift(s); saveState(); openSessionCompletion(s);
  }));
  $all('[data-review-suggest]',wrap).forEach(b=>b.addEventListener('click',()=>startSuggestedSession(b.dataset.reviewSuggest,b.dataset.reviewMethod)));
  $all('[data-suggest-snooze]',wrap).forEach(b=>b.addEventListener('click',()=>snoozeSuggestedTopic(b.dataset.suggestSnooze)));
  bindIssueFiltersAndActions(wrap,'rev', renderRevisao);
}

function renderDuvidasErros(){
  const wrap = $('#exames-duvidas-erros'); if(!wrap) return;
  const discOpts = state.exams.map(e=>`<option value="${esc(e.id)}" ${ui.duvFilterDisc===e.id?'selected':''}>${esc(e.nome)}</option>`).join('');
  const discForm = state.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const topForm = allTopicsFlat().map(t=>`<option value="${esc(t.id)}">${esc(discLabel(t.disciplinaId))} · ${esc(t.titulo)}</option>`).join('');
  const q=(ui.duvQuery||'').toLowerCase().trim();
  const base = state.issues.filter(i=>isErroTipo(i.tipo) || i.tipo==='conceito' || i.tipo==='formula');
  const list = base.filter(i=>{
    if(!isErroTipo(i.tipo) && i.estado==='resolvido') return false; // keep focus on difficulties in this tab
    if(ui.duvFilterDisc!=='all' && i.disciplinaId!==ui.duvFilterDisc) return false;
    if(ui.duvFilterEstado!=='all' && i.estado!==ui.duvFilterEstado) return false;
    if(q){ const hay=`${i.titulo} ${i.descricao||''} ${i.resolucao||''}`.toLowerCase(); if(!hay.includes(q)) return false; }
    return isErroTipo(i.tipo) || ui.duvFilterEstado!=='all' || i.estado!=='resolvido';
  }).sort((a,b)=> (a.estado==='resolvido'?1:0)-(b.estado==='resolvido'?1:0) || (b.updatedAt||0)-(a.updatedAt||0));

  const { falhasPorTopico, errosPorCorrigir } = ondeEstouAFalhar();

  wrap.innerHTML = `
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Registar dúvida ou erro</h3></div>
      <form id="ex-duv-form" class="ex-form-grid ex-form-issues">
        <select id="ex-duv-tipo" class="ex-input">
          <option value="duvida">Dúvida</option><option value="exercicio_dificil">Exercício difícil</option>
          <option value="erro_teste">Erro em teste</option><option value="erro_exame">Erro em exame</option><option value="conceito">Conceito complexo</option>
        </select>
        <select id="ex-duv-disc" class="ex-input">${discForm}</select>
        <select id="ex-duv-topic" class="ex-input"><option value="">Tópico (opcional)</option>${topForm}</select>
        <select id="ex-duv-estado" class="ex-input"><option value="por_resolver">Por resolver</option><option value="em_analise">Em análise</option><option value="precisa_revisao">Precisa de revisão</option><option value="resolvido">Resolvido</option></select>
        <input id="ex-duv-title" class="ex-input ex-span-2" placeholder="Título" required>
        <textarea id="ex-duv-desc" class="ex-input ex-span-2" rows="2" placeholder="Descrição / o que correu mal"></textarea>
        <textarea id="ex-duv-res" class="ex-input ex-span-2" rows="2" placeholder="Resolução / explicação (opcional)"></textarea>
        <button type="submit" class="ex-btn ex-btn-primary">Guardar</button>
      </form>
    </div>

    <div class="ex-card ex-falhas">
      <div class="ex-section-head"><h3>Onde estou a falhar?</h3></div>
      <div class="ex-falhas-grid">
        <div><div class="ex-muted-sm ex-mb">Tópicos com mais dificuldades</div>
          ${falhasPorTopico.length ? `<ul class="ex-mini-list">${falhasPorTopico.slice(0,6).map(x=>`<li><strong>${esc(x.label)}</strong><span class="ex-muted-sm">${x.count} registos</span></li>`).join('')}</ul>` : '<div class="ex-empty">Sem dados suficientes.</div>'}
        </div>
        <div><div class="ex-muted-sm ex-mb">Erros ainda não corrigidos</div>
          ${errosPorCorrigir.length ? `<ul class="ex-mini-list">${errosPorCorrigir.slice(0,6).map(i=>`<li><strong>${esc(i.titulo)}</strong><span class="ex-muted-sm">${esc(issueStatusLabel(i.estado))}</span></li>`).join('')}</ul>` : '<div class="ex-empty">Sem erros por corrigir.</div>'}
        </div>
      </div>
    </div>

    <div class="ex-card ex-toolbar">
      <input id="ex-duv-q" class="ex-input" placeholder="Pesquisar dúvidas e erros…" value="${esc(ui.duvQuery)}">
      <select id="ex-duv-fdisc" class="ex-input"><option value="all">Todas as disciplinas</option>${discOpts}</select>
      <select id="ex-duv-festado" class="ex-input">
        <option value="all">Todos os estados</option>
        ${['por_resolver','em_analise','resolvido','precisa_revisao'].map(s=>`<option value="${s}" ${ui.duvFilterEstado===s?'selected':''}>${issueStatusLabel(s)}</option>`).join('')}
      </select>
    </div>
    <div class="ex-card"><div class="ex-section-head"><h3>Dúvidas e erros</h3><span class="ex-muted-sm">${list.length}</span></div>
      <div class="ex-list">${list.length? list.map(i=>issueRow(i,'duv')).join('') : '<div class="ex-empty">Sem registos para os filtros atuais.</div>'}</div>
    </div>`;

  $('#ex-duv-form')?.addEventListener('submit', e=>{ e.preventDefault(); addIssueFromForm('duv'); });
  bindIssueFiltersAndActions(wrap,'duv', renderDuvidasErros);
}

function addIssueFromForm(kind){
  const p = kind==='rev' ? 'ex-rev' : 'ex-duv';
  const tipo = $(`#${p}-tipo`).value;
  const disciplinaId = $(`#${p}-disc`).value || state.exams[0]?.id;
  const topicId = $(`#${p}-topic`).value || '';
  const estado = $(`#${p}-estado`).value || 'por_resolver';
  const titulo = ($(`#${p}-title`).value||'').trim();
  const descricao = ($(`#${p}-desc`).value||'').trim();
  const resolucao = kind==='duv' ? (($('#ex-duv-res').value||'').trim()) : descricao;
  if(!titulo) return miniToast('Preenche o título.', 'warn');
  const issue = { id: uid('iss'), tipo, disciplinaId, topicId, titulo, descricao, resolucao: kind==='duv'?resolucao:'', estado, origem:'manual', createdAt: Date.now(), updatedAt: Date.now() };
  state.issues.unshift(issue);
  // integração revisão espaçada (compat com comportamento existente)
  if (window.ReviewSystem && typeof window.ReviewSystem.criarAPartirDeDuvida === 'function') {
    try { window.ReviewSystem.criarAPartirDeDuvida({ id: issue.id, disciplina: discLabel(disciplinaId), titulo: issue.titulo, texto: issue.descricao || issue.resolucao || '' }); } catch {}
  }
  saveState(); miniToast('Registo guardado.');
}

function bindIssueFiltersAndActions(root, kind, rerender){
  const p = kind==='rev' ? 'ex-rev' : 'ex-duv';
  $(`#${p}-q`, root)?.addEventListener('input', e=>{ if(kind==='rev') ui.revQuery=e.target.value; else ui.duvQuery=e.target.value; rerender(); });
  $(`#${p}-fdisc`, root)?.addEventListener('change', e=>{ if(kind==='rev') ui.revFilterDisc=e.target.value; else ui.duvFilterDisc=e.target.value; rerender(); });
  $(`#${p}-festado`, root)?.addEventListener('change', e=>{ if(kind==='rev') ui.revFilterEstado=e.target.value; else ui.duvFilterEstado=e.target.value; rerender(); });
  $all('[data-iss-estado]', root).forEach(sel=>sel.addEventListener('change', ()=>{ const i=getIssue(sel.dataset.issEstado); if(!i) return; i.estado=sel.value; i.updatedAt=Date.now(); saveState(); }));
  $all('[data-iss-del]', root).forEach(b=>b.addEventListener('click', ()=>{ const id=b.dataset.issDel; marcarApagado('issues', id); state.issues = state.issues.filter(x=>x.id!==id); state.topics.forEach(t=>{ if(t.exercicioIds) t.exercicioIds=t.exercicioIds.filter(x=>x!==id); }); saveState(); }));
  $all('[data-iss-rever]', root).forEach(b=>b.addEventListener('click', ()=>{
    const i=getIssue(b.dataset.issRever); if(!i) return;
    if (window.ReviewSystem && typeof window.ReviewSystem.criarAPartirDeDuvida === 'function') {
      window.ReviewSystem.criarAPartirDeDuvida({ id:i.id, disciplina: discLabel(i.disciplinaId), titulo:i.titulo, texto:i.descricao||i.resolucao||'' });
      miniToast('Agendado para revisão.');
    } else miniToast('Sistema de revisão indisponível.', 'warn');
  }));
}

function issueRow(i, kind){
  return `<div class="ex-row">
    <div class="ex-row-main">
      <div class="ex-row-title">${esc(i.titulo)}</div>
      <div class="ex-row-meta">
        <span class="ex-badge ex-badge-muted">${esc(issueTypeLabel(i.tipo))}</span>
        <span class="ex-badge ${issueStatusClass(i.estado)}">${esc(issueStatusLabel(i.estado))}</span>
        <span class="ex-muted-sm">${esc(discLabel(i.disciplinaId))}${i.topicId?` · ${esc(topicLabel(i.topicId))}`:''}</span>
      </div>
      ${i.descricao?`<div class="ex-row-text">${esc(i.descricao)}</div>`:''}
      ${i.resolucao?`<div class="ex-row-text ex-row-res"><strong>Resolução:</strong> ${esc(i.resolucao)}</div>`:''}
    </div>
    <div class="ex-row-actions ex-row-actions-col">
      <select class="ex-input ex-input-sm" data-iss-estado="${esc(i.id)}">${['por_resolver','em_analise','resolvido','precisa_revisao'].map(s=>`<option value="${s}" ${i.estado===s?'selected':''}>${issueStatusLabel(s)}</option>`).join('')}</select>
      <button type="button" class="ex-btn ex-btn-sm" data-iss-rever="${esc(i.id)}">Rever</button>
      <button type="button" class="ex-btn ex-btn-sm ex-btn-danger" data-iss-del="${esc(i.id)}">Apagar</button>
    </div>
  </div>`;
}

function ondeEstouAFalhar(){
  const counts = new Map();
  state.issues.forEach(i=>{
    if(i.estado==='resolvido') return;
    if(!(isErroTipo(i.tipo) || i.estado==='por_resolver' || i.estado==='precisa_revisao')) return;
    const key = i.topicId || `disc:${i.disciplinaId}`;
    const label = i.topicId ? `${discLabel(i.disciplinaId)} · ${topicLabel(i.topicId)}` : `${discLabel(i.disciplinaId)} (geral)`;
    if(!counts.has(key)) counts.set(key,{key,label,count:0});
    counts.get(key).count++;
  });
  const falhasPorTopico = Array.from(counts.values()).sort((a,b)=>b.count-a.count);
  const errosPorCorrigir = state.issues.filter(i=> ['erro_teste','erro_exame','exercicio_dificil','duvida'].includes(i.tipo) && i.estado!=='resolvido').sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  return { falhasPorTopico, errosPorCorrigir };
}

// ---------- Plano de estudo ----------
function startOfWeek(d){
  const x = new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x;
}
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function renderPlano(){
  const wrap = $('#exames-plano'); if(!wrap) return;
  ensureCurrentPlan();
  const plan = state.activePlan;
  const dailyPlan = plan?.daily?.items || [];
  const weeklyPlan = plan?.week || [];
  const monthPlan = plan?.month || [];
  const prerequisiteAudit = plan?.prerequisiteValidation;
  const prerequisiteWarning = prerequisiteAudit && !prerequisiteAudit.valid
    ? `<div class="ex-empty">Atenção: há relações de pré-requisito inválidas (${prerequisiteAudit.invalid.length}) ou ciclos (${prerequisiteAudit.cycles.length}). Confirma as dependências nos tópicos antes de avançar.</div>` : '';
  const generatedDaily = dailyPlan.map(plannedEntry).join('') || '<div class="ex-empty">Sem recomendações para hoje.</div>';
  const generatedWeek = weeklyPlan.map(day=>`<section class="ex-plan-day"><header><strong>${esc(fmtDate(day.date))}</strong><span>${day.totalMinutes} min</span></header><div>${day.items.length?day.items.map(plannedEntry).join(''):'<span class="ex-muted-sm">Dia livre / reserva</span>'}</div></section>`).join('');
  const monthSummary = (plan?.monthSummary || []).filter(x=>x.examId!=='disc-geral').map(x=>`<div class="ex-roadmap-subject"><strong>${esc(discLabel(x.examId))}</strong><span>${x.topics} sessões · ${x.minutes} min</span></div>`).join('');
  const monthMilestones = Array.from({length:4},(_,i)=>{
    const chunk=monthPlan.slice(Math.floor(i*monthPlan.length/4),Math.floor((i+1)*monthPlan.length/4));
    const count=chunk.flatMap(d=>d.items).length;
    return `<div class="ex-roadmap-milestone"><span>Semana ${i+1}</span><strong>${count} sessões planeadas</strong><small>${chunk.flatMap(d=>d.items).reduce((n,x)=>n+x.durationMin,0)} min · progresso esperado: ${Math.min(100,Math.round(100*(i+1)/4))}% do plano mensal</small></div>`;
  }).join('');
  const discForm = state.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const topForm = allTopicsFlat().map(t=>`<option value="${esc(t.id)}">${esc(discLabel(t.disciplinaId))} · ${esc(t.titulo)}</option>`).join('');
  const now = new Date(); const weekStart = addDays(startOfWeek(now), ui.planoWeekOffset*7);
  const weekDays = Array.from({length:7}, (_,i)=>addDays(weekStart,i));
  const weekEnd = addDays(weekStart,6);
  const sessions = [...state.sessions].sort((a,b)=> (a.data||'').localeCompare(b.data||''));

  const listHtml = sessions.length ? sessions.map(s=>sessionRow(s)).join('') : '<div class="ex-empty">Sem sessões planeadas. Adiciona uma acima.</div>';
  const weekHtml = `<div class="ex-week-grid">${weekDays.map(d=>{
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const daySessions = sessions.filter(s=>s.data===key);
    const isToday = key===todayKey();
    return `<div class="ex-week-day ${isToday?'is-today':''}" data-calendar-date="${key}"><div class="ex-week-day-head">${d.toLocaleDateString('pt-PT',{weekday:'short', day:'numeric'})}</div>
      <div class="ex-week-day-list">${daySessions.length?daySessions.map(s=>`<div class="ex-week-item ${s.concluida?'done':''}" draggable="true" data-session-drag="${esc(s.id)}" data-session-open="${esc(s.id)}"><span>${esc(discLabel(s.disciplinaId))}</span><strong>${esc(topicLabel(s.topicId)||'Sessão')}</strong><span class="ex-muted-sm">${esc(String(s.duracaoMin||0))} min</span></div>`).join(''):'<div class="ex-empty-sm">—</div>'}</div></div>`;
  }).join('')}</div>`;

  wrap.innerHTML = `
    <div class="ex-card ex-planner-config"><div class="ex-section-head"><div><h3>Motor de planeamento</h3><span class="ex-muted-sm">Equilibra domínio, revisão espaçada, confiança, desempenho, dificuldade e proximidade do exame.</span></div><div class="flex gap-2"><button type="button" class="ex-btn" data-plan-mark-week>Marcar semana no Horário</button><button type="button" class="ex-btn ex-btn-primary" data-plan-generate>Gerar plano personalizado</button></div></div>
      ${prerequisiteWarning}
      <div class="ex-form-grid-2"><label class="ex-label">Tempo disponível por dia (min)<input id="plan-minutes-day" type="number" min="20" max="720" step="15" class="ex-input" value="${Number(state.settings.minutesPerDay)||90}"></label><label class="ex-label">Duração preferida por sessão (min)<input id="plan-session-minutes" type="number" min="15" max="120" step="5" class="ex-input" value="${Number(state.settings.sessionMinutes)||45}"></label><label class="ex-label">Tópicos dominados por dia<input id="plan-maintenance-day" type="number" min="0" max="3" class="ex-input" value="${Number.isFinite(Number(state.settings.maxMaintenancePerDay))?Number(state.settings.maxMaintenancePerDay):1}"></label><span class="ex-muted-sm ex-plan-config-note">Manutenção mínima para conteúdos já consolidados.</span></div>
      <div class="ex-plan-range-tabs"><button type="button" data-plan-range="daily" aria-pressed="${ui.planRange==='daily'}">Daily</button><button type="button" data-plan-range="weekly" aria-pressed="${ui.planRange==='weekly'}">Weekly</button><button type="button" data-plan-range="monthly" aria-pressed="${ui.planRange==='monthly'}">Monthly</button></div>
      <div class="ex-section-head"><h3>${ui.planRange==='daily'?'Plano de hoje':ui.planRange==='weekly'?'Plano da semana':'Roteiro mensal'}</h3><span class="ex-muted-sm">Gerado ${plan?new Date(plan.generatedAt).toLocaleString('pt-PT'):'—'}</span></div>
      ${ui.planRange==='daily'?`<div class="ex-plan-list">${generatedDaily}</div>`:ui.planRange==='weekly'?`<div class="ex-week-roadmap">${generatedWeek}</div>`:`<div class="ex-roadmap-grid"><div>${monthSummary}<p class="ex-muted-sm">${monthPlan.flatMap(d=>d.items).length} sessões · ${monthPlan.reduce((n,d)=>n+d.totalMinutes,0)} minutos previstos</p></div><div>${monthMilestones}</div></div>`}
      <details class="ex-plan-history"><summary>Histórico de planos gerados (${state.planHistory.length})</summary><div>${state.planHistory.slice(0,12).map(p=>`<div class="ex-history-row"><span>${esc(p.today||'')} · ${new Date(p.generatedAt||Date.now()).toLocaleString('pt-PT')}</span><span>${p.daily?.items?.length||0} sessões hoje · ${p.week?.flatMap(d=>d.items||[]).length||0} na semana</span></div>`).join('')||'<span class="ex-muted-sm">Ainda sem histórico anterior.</span>'}</div></details>
    </div>
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Planear sessão de estudo</h3></div>
      <form id="ex-sess-form" class="ex-form-grid ex-form-sess">
        <select id="ex-sess-disc" class="ex-input" required>${discForm}</select>
        <select id="ex-sess-topic" class="ex-input"><option value="">Tópico (opcional)</option>${topForm}</select>
        <input id="ex-sess-date" type="date" class="ex-input" value="${todayKey()}" required>
        <input id="ex-sess-dur" type="number" min="5" step="5" class="ex-input" placeholder="Duração (min)" value="45" required>
        <input id="ex-sess-notes" class="ex-input ex-span-2" placeholder="Notas (opcional)">
        <label class="ex-check"><input id="ex-sess-cal" type="checkbox" checked> Integrar no calendário</label>
        <button type="submit" class="ex-btn ex-btn-primary">Adicionar sessão</button>
      </form>
    </div>

    <div class="ex-card ex-toolbar ex-toolbar-between">
      <div class="ex-view-toggle">
        <button type="button" class="ex-btn ex-btn-sm ${ui.planoView==='lista'?'is-active':''}" data-plano-view="lista">Lista</button>
        <button type="button" class="ex-btn ex-btn-sm ${ui.planoView==='semana'?'is-active':''}" data-plano-view="semana">Semanal</button>
      </div>
      <div class="ex-week-nav ${ui.planoView==='semana'?'':'is-hidden'}">
        <button type="button" class="ex-btn ex-btn-sm" data-week-delta="-1">Semana anterior</button>
        <span class="ex-muted-sm">${weekStart.toLocaleDateString('pt-PT',{day:'numeric',month:'short'})} – ${weekEnd.toLocaleDateString('pt-PT',{day:'numeric',month:'short'})}</span>
        <button type="button" class="ex-btn ex-btn-sm" data-week-delta="1">Seguinte</button>
      </div>
    </div>

    <div class="ex-card">
      <div class="ex-section-head"><h3>${ui.planoView==='semana'?'Vista semanal':'Sessões (lista)'}</h3><span class="ex-muted-sm">${sessions.length} sessões</span></div>
      ${ui.planoView==='semana' ? weekHtml : `<div class="ex-list">${listHtml}</div>`}
    </div>`;

  $('#ex-sess-form')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const disciplinaId = $('#ex-sess-disc').value;
    const topicId = $('#ex-sess-topic').value || '';
    const data = $('#ex-sess-date').value;
    const duracaoMin = Math.max(5, Number($('#ex-sess-dur').value||45));
    const notas = ($('#ex-sess-notes').value||'').trim();
    const integrar = $('#ex-sess-cal').checked;
    if(!data) return miniToast('Indica a data.', 'warn');
    const sess = { id: uid('sess'), disciplinaId, topicId, data, duracaoMin, notas, activity:'new', concluida:false, createdAt: Date.now(), updatedAt: Date.now(), calendarTaskId:null, calendarDate:data };
    state.sessions.unshift(sess);
    if(topicId){ const t=getTopic(topicId); if(t){ t.ultimaAtividade=Date.now(); state.ui.lastTopicId=t.id; } }
    if(integrar && typeof persistirTarefasDia === 'function'){
      try {
        const key = data;
        const tasks = (typeof read === 'function') ? read(`study-journal-tasks-${key}`, []) : [];
        const calId = `${Date.now()}-ex-${Math.random().toString(36).slice(2,7)}`;
        const nome = topicId ? `Estudar: ${topicLabel(topicId)}` : `Sessão de estudo · ${discLabel(disciplinaId)}`;
        tasks.push({ id: calId, text: nome, subject: discLabel(disciplinaId), category: 'aula', done:false, origemExames:{ type:'session', sessionId: sess.id } });
        await persistirTarefasDia(key, tasks);
        sess.calendarTaskId = calId; sess.calendarDate = key;
      } catch {}
    }
    saveState(); miniToast('Sessão planeada.');
  });

  $('#plan-minutes-day')?.addEventListener('change',e=>{state.settings.minutesPerDay=clamp(Number(e.target.value)||90,20,720);saveState();});
  $('#plan-session-minutes')?.addEventListener('change',e=>{state.settings.sessionMinutes=clamp(Number(e.target.value)||45,15,120);saveState();});
  $('#plan-maintenance-day')?.addEventListener('change',e=>{state.settings.maxMaintenancePerDay=clamp(Number(e.target.value)||0,0,3);saveState();});
  wrap.querySelector('[data-plan-generate]')?.addEventListener('click',()=>generateStudyPlan(true));
  wrap.querySelector('[data-plan-mark-week]')?.addEventListener('click',marcarSemanaNoHorario);
  $all('[data-plan-range]',wrap).forEach(b=>b.addEventListener('click',()=>{ui.planRange=b.dataset.planRange;renderPlano();}));
  $all('[data-plan-start]',wrap).forEach(b=>b.addEventListener('click',()=>startPlannedSession(b.dataset.planStart)));

  $all('[data-plano-view]').forEach(b=>b.addEventListener('click', ()=>{ ui.planoView=b.dataset.planoView; renderPlano(); }));
  $all('[data-week-delta]').forEach(b=>b.addEventListener('click', ()=>{ ui.planoWeekOffset += Number(b.dataset.weekDelta||0); renderPlano(); }));
  let draggedSessionId = '';
  $all('[data-session-drag]',wrap).forEach(el=>el.addEventListener('dragstart',e=>{draggedSessionId=el.dataset.sessionDrag;e.dataTransfer?.setData('text/plain',draggedSessionId);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}));
  $all('[data-calendar-date]',wrap).forEach(day=>{
    day.addEventListener('dragover',e=>{e.preventDefault();day.classList.add('is-drop-target');});
    day.addEventListener('dragleave',()=>day.classList.remove('is-drop-target'));
    day.addEventListener('drop',async e=>{
      e.preventDefault();day.classList.remove('is-drop-target');const id=e.dataTransfer?.getData('text/plain')||draggedSessionId;const s=state.sessions.find(x=>x.id===id);if(!s||s.data===day.dataset.calendarDate)return;
      const oldDate=s.calendarDate||s.data;if(s.concluida)descreditarSessaoDosTotais(s);s.data=day.dataset.calendarDate; s.calendarDate=s.data; s.updatedAt=Date.now();if(s.concluida)creditarSessaoNosTotais(s);
      if(s.calendarTaskId&&typeof persistirTarefasDia==='function'&&typeof read==='function')try{
        const oldTasks=read(`study-journal-tasks-${oldDate}`,[]).filter(t=>t.id!==s.calendarTaskId);await persistirTarefasDia(oldDate,oldTasks);
        const newTasks=read(`study-journal-tasks-${s.data}`,[]);newTasks.push({id:s.calendarTaskId,text:`${s.activity==='revision'?'Rever':s.activity==='practice'?'Exercícios:':'Estudar:'} ${topicLabel(s.topicId)||discLabel(s.disciplinaId)}`,subject:discLabel(s.disciplinaId),category:'aula',done:!!s.concluida,origemExames:{type:'session',sessionId:s.id}});await persistirTarefasDia(s.data,newTasks);
      }catch{}
      saveState(); refrescarEstatisticas(); miniToast('Sessão reorganizada.');
    });
  });
  bindSessionActions(wrap);
}

function sessionRow(s){
  const title = topicLabel(s.topicId) || `Sessão · ${discLabel(s.disciplinaId)}`;
  return `<div class="ex-row ${s.concluida?'is-done':''}">
    <div class="ex-row-main">
      <div class="ex-row-title">${esc(title)}</div>
      <div class="ex-row-meta">
        <span class="ex-muted-sm">${esc(discLabel(s.disciplinaId))}</span>
        <span class="ex-muted-sm">· ${esc(fmtDate(s.data))}</span>
        <span class="ex-muted-sm">· ${esc(String(s.duracaoMin||0))} min</span>
        ${s.methodLabel?`<span class="ex-muted-sm">· ${esc(s.methodLabel)}</span>`:''}
        ${s.concluida?'<span class="ex-badge ex-badge-ok">Concluída</span>':'<span class="ex-badge ex-badge-muted">Planeada</span>'}
      </div>
      ${s.notas?`<div class="ex-row-text">${esc(s.notas)}</div>`:''}
    </div>
    <div class="ex-row-actions">
      <button type="button" class="ex-btn ex-btn-sm" data-sess-done="${esc(s.id)}">${s.concluida?'Reabrir':'Concluir'}</button>
      <button type="button" class="ex-btn ex-btn-sm ex-btn-danger" data-sess-del="${esc(s.id)}">Apagar</button>
    </div>
  </div>`;
}
/* ── Sessões concluídas nas estatísticas de estudo ──
   Uma sessão do plano só entra no heatmap e nos totais diários/semanais
   globais depois de ficar concluída. O crédito usa um compartimento
   determinístico por sessão, para nunca contar duas vezes. */
const STATS_COMPARTIMENTO_PREFIX = 'exsessao-';

function statsCompartimento(s) {
  return `${STATS_COMPARTIMENTO_PREFIX}${s.id}`;
}

function statsSubject(s) {
  return discLabel(s && s.disciplinaId);
}

function creditarSessaoNosTotais(s) {
  if (!s || !s.concluida) return false;
  const minutos = Math.max(0, Number(s.duracaoMin) || 0);
  if (!minutos || !/^\d{4}-\d{2}-\d{2}$/.test(s.data || '')) return false;
  if (Number(s.statsMin) === minutos) return false;
  if (typeof StudySessions === 'undefined' || typeof StudySessions.adicionarMinutosSessao !== 'function') return false;
  if (Number(s.statsMin) > 0) descreditarSessaoDosTotais(s);
  StudySessions.adicionarMinutosSessao(statsSubject(s), minutos, s.data, statsCompartimento(s));
  s.statsMin = minutos;
  s.statsCreditedAt = Date.now();
  return true;
}

function descreditarSessaoDosTotais(s) {
  if (!s) return;
  const minutos = Number(s.statsMin) || 0;
  s.statsMin = 0;
  if (!minutos) return;
  if (typeof StudySessions === 'undefined' || typeof StudySessions.removerMinutosSessao !== 'function') return;
  StudySessions.removerMinutosSessao(statsSubject(s), s.data, statsCompartimento(s));
}

function refrescarEstatisticas() {
  try {
    if (typeof atualizarVistasAposSessao === 'function') atualizarVistasAposSessao();
    else if (typeof StudyStats !== 'undefined' && StudyStats.renderHeatmap) StudyStats.renderHeatmap();
  } catch { /* segue sem refrescar */ }
}

/* Credita sessões que já estavam concluídas antes desta integração. */
function reconciliarSessoesConcluidas() {
  let alterou = false;
  state.sessions.forEach(s => {
    if (!s || !s.concluida) return;
    const minutos = Math.max(0, Number(s.duracaoMin) || 0);
    if (!minutos || Number(s.statsMin) === minutos) return;
    if (creditarSessaoNosTotais(s)) alterou = true;
  });
  if (alterou) exWrite(STORE_KEY, state);
}

function bindSessionActions(root){
  $all('[data-sess-done]').forEach(b=>b.addEventListener('click', async ()=>{
    const s = state.sessions.find(x=>x.id===b.dataset.sessDone); if(!s) return;
    if(!s.concluida) { openSessionCompletion(s); return; }
    s.concluida = !s.concluida;
    s.updatedAt = Date.now();
    if(s.concluida) creditarSessaoNosTotais(s);
    else descreditarSessaoDosTotais(s);
    if(s.topicId){ const t=getTopic(s.topicId); if(t){ t.ultimaAtividade=Date.now(); state.ui.lastTopicId=t.id; if(s.concluida && t.estado==='nao_iniciado') t.estado='em_progresso'; } }
    // sync calendar task state if linked
    if(s.calendarTaskId && s.calendarDate && typeof persistirTarefasDia==='function' && typeof read==='function'){
      try {
        const key=s.calendarDate; const tasks=read(`study-journal-tasks-${key}`, []);
        const ct = tasks.find(t=>t.id===s.calendarTaskId); if(ct){ ct.done = !!s.concluida; await persistirTarefasDia(key, tasks); }
      } catch {}
    }
    saveState();
    refrescarEstatisticas();
  }));
  $all('[data-sess-del]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=b.dataset.sessDel; const s = state.sessions.find(x=>x.id===id); if(!s) return;
    if(!confirm('Apagar esta sessão?')) return;
    marcarApagado('sessions', id);
    descreditarSessaoDosTotais(s);
    if(s.calendarTaskId && s.calendarDate && typeof persistirTarefasDia==='function' && typeof read==='function'){
      try { const key=s.calendarDate; const tasks=read(`study-journal-tasks-${key}`, []).filter(t=>t.id!==s.calendarTaskId); await persistirTarefasDia(key, tasks); } catch {}
    }
    state.sessions = state.sessions.filter(x=>x.id!==id);
    saveState();
    refrescarEstatisticas();
  }));
  $all('[data-session-open]').forEach(el=>el.addEventListener('click', ()=>{
    ui.planoView='lista'; renderPlano();
  }));
}

// ---------- Render root / API ----------
function renderBadges(){
  const prog = progressOverall();
  const mats = state.materials.length;
  const revs = window.ExamEngine?.pendingReviews(allTopicsFlat()).length || 0;
  const errs = state.issues.filter(i=>['erro_teste','erro_exame','exercicio_dificil','duvida'].includes(i.tipo) && i.estado!=='resolvido').length;
  const set = (name, val)=>{ const b=document.querySelector(`[data-exame-badge="${name}"]`); if(!b) return; if(!val){b.hidden=true;} else {b.hidden=false; b.textContent=String(val);} };
  set('plan', state.sessions.filter(s=>!s.concluida).length || '');
  set('syllabus', prog.pending || '');
  set('revisions', revs || '');
}

function renderAnalytics(){
  const wrap=$('#exames-analytics');if(!wrap)return;
  const topics=allTopicsFlat();const pending=window.ExamEngine?.pendingReviews(topics)||[];
  const sessions=state.sessions.filter(s=>s.concluida);
  const practice=state.practice;
  const totalExercises=practice.reduce((n,p)=>n+(Number(p.count)||0),0);
  const totalCorrect=practice.reduce((n,p)=>n+(Number(p.correct)||0),0);
  const totalMinutes=sessions.reduce((n,s)=>n+(Number(s.duracaoMin)||0),0)+practice.reduce((n,p)=>n+(Number(p.minutes)||0),0);
  const subjectRows=state.exams.filter(e=>e.id!=='disc-geral').map(e=>{
    const ts=topics.filter(t=>t.disciplinaId===e.id);const studied=ts.filter(t=>t.estado!=='nao_iniciado').length;const mastery=ts.length?Math.round(ts.reduce((n,t)=>n+(Number(t.masteryPct)||0),0)/ts.length):0;
    const mins=sessions.filter(s=>s.disciplinaId===e.id).reduce((n,s)=>n+(Number(s.duracaoMin)||0),0)+practice.filter(p=>p.disciplinaId===e.id).reduce((n,p)=>n+(Number(p.minutes)||0),0);
    const rows=practice.filter(p=>p.disciplinaId===e.id);const attempts=rows.reduce((n,p)=>n+(Number(p.count)||0),0);const correct=rows.reduce((n,p)=>n+(Number(p.correct)||0),0);
    const pct=ts.length?Math.round(studied/ts.length*100):0;
    const readiness=Number(e.goal)>0?Math.min(100,Math.round(mastery/Number(e.goal)*100)):0;
    return `<div class="ex-analytics-subject"><h3>${esc(e.nome)}</h3><div class="ex-analytics-metrics"><span>Matéria estudada <b>${pct}%</b></span><span>Domínio médio <b>${mastery}%</b></span><span>Prontidão vs. objetivo ${Number(e.goal)||80}% <b>${readiness}%</b></span><span>Tempo <b>${Math.round(mins/60*10)/10} h</b></span><span>Exercícios <b>${attempts}</b></span><span>Acerto <b>${attempts?Math.round(correct/attempts*100):0}%</b></span></div><div class="ex-analytics-bars"><div><label>Estudado</label><div class="ex-bar"><div style="width:${pct}%"></div></div></div><div><label>Domínio</label><div class="ex-bar"><div style="width:${mastery}%;background:#82b5a0"></div></div></div></div></div>`;
  }).join('');
  const today=todayKey();const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(13-i));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  const trend=days.map(d=>{const mins=sessions.filter(s=>s.data===d).reduce((n,s)=>n+(Number(s.duracaoMin)||0),0)+practice.filter(p=>p.date===d).reduce((n,p)=>n+(Number(p.minutes)||0),0);return {date:d,mins};});const maxTrend=Math.max(30,...trend.map(x=>x.mins));
  const heatDays=Array.from({length:35},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(34-i));const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const mins=sessions.filter(s=>s.data===date).reduce((n,s)=>n+(Number(s.duracaoMin)||0),0)+practice.filter(p=>p.date===date).reduce((n,p)=>n+(Number(p.minutes)||0),0);return {date,mins};});
  const weak=topics.slice().sort((a,b)=>Number(a.masteryPct||0)-Number(b.masteryPct||0)).slice(0,6);
  const planned=state.activePlan?.daily?.items?.length||0;const actual=sessions.filter(s=>s.data===today).length;
  wrap.innerHTML=`<div class="ex-grid-stats"><div class="ex-card ex-stat"><span class="ex-stat-label">Tempo registado</span><strong>${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m</strong></div><div class="ex-card ex-stat"><span class="ex-stat-label">Exercícios</span><strong>${totalExercises}</strong></div><div class="ex-card ex-stat"><span class="ex-stat-label">Taxa de acerto</span><strong>${totalExercises?Math.round(totalCorrect/totalExercises*100):0}%</strong></div><div class="ex-card ex-stat"><span class="ex-stat-label">Revisões atrasadas</span><strong>${pending.length}</strong></div><div class="ex-card ex-stat"><span class="ex-stat-label">Plano de hoje</span><strong>${actual}/${planned}</strong><span class="ex-muted-sm">sessões concluídas / previstas</span></div></div>
    <div class="ex-card"><div class="ex-section-head"><h3>Progresso por disciplina</h3><span class="ex-muted-sm">Estudado e domínio aparecem separados</span></div><div class="ex-analytics-grid">${subjectRows}</div></div>
    <div class="ex-overview-grid"><section class="ex-card"><div class="ex-section-head"><h3>Tempo de estudo · últimos 14 dias</h3></div><div class="ex-trend-chart" role="img" aria-label="Minutos estudados por dia durante os últimos 14 dias">${trend.map(x=>`<div class="ex-trend-col" title="${x.date}: ${x.mins} min"><span style="height:${Math.max(3,Math.round(x.mins/maxTrend*100))}%"></span><small>${x.date.slice(8)}</small></div>`).join('')}</div></section>
    <section class="ex-card"><div class="ex-section-head"><h3>Conteúdos que precisam de atenção</h3></div><div class="ex-list">${weak.map(t=>`<div class="ex-attention-row"><div><strong>${esc(t.titulo)}</strong><small>${esc(discLabel(t.disciplinaId))} · domínio ${Number(t.masteryPct)||0}%</small></div><span>${Number(t.exerciseCount)||0} exercícios · ${Number(t.accuracyPct)||0}% acerto</span></div>`).join('')}</div></section></div>
    <div class="ex-card"><div class="ex-section-head"><div><span class="ex-eyebrow">CONSISTÊNCIA</span><h3>Atividade nos últimos 35 dias</h3></div><span class="ex-muted-sm">Minutos registados por dia</span></div><div class="ex-consistency-grid" role="img" aria-label="Mapa de consistência de estudo dos últimos 35 dias">${heatDays.map(x=>`<span class="ex-consistency-cell" data-level="${x.mins===0?0:x.mins<30?1:x.mins<60?2:x.mins<120?3:4}" title="${x.date}: ${x.mins} min"></span>`).join('')}</div><div class="ex-consistency-legend"><span>Menos</span>${[0,1,2,3,4].map(n=>`<i data-level="${n}"></i>`).join('')}<span>Mais</span></div></div>
    <div class="ex-card"><div class="ex-section-head"><h3>Histórico de sessões</h3><span class="ex-muted-sm">${sessions.length} concluídas</span></div><div class="ex-list">${sessions.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,12).map(s=>`<div class="ex-row"><strong>${esc(topicLabel(s.topicId)||'Sessão')}</strong><span class="ex-muted-sm">${esc(discLabel(s.disciplinaId))} · ${esc(fmtDate(s.data))} · ${s.duracaoMin} min · ${esc(s.activity||'study')}</span></div>`).join('')||'<div class="ex-empty">Conclui sessões para começar a ver a evolução.</div>'}</div></div>`;
}

function renderAll(){
  if(!document.getElementById('view-exames')) return;
  renderOverview();
  renderPlano();
  renderTopics();
  renderMateriais();
  renderRevisao();
  renderDuvidasErros();
  renderPractice();
  renderAnalytics();
  renderBadges();
}

function lerTabGuardada(){
  try { const v=localStorage.getItem(EXAME_TAB_KEY); return TABS.includes(v)?v:'overview'; } catch { return 'overview'; }
}

let ouvinteSyncRegistado = false;

function ligar(){
  if (!catalogLoaded) {
    window.__examCatalogReady.then(d=>{catalog=d||catalog; ligar();});
    return;
  }
  const storedRaw=localStorage.getItem(STORE_KEY);
  state = mergeCatalogState(loadState());
  if (storedRaw !== JSON.stringify(state)) exWrite(STORE_KEY,state);
  if (!state.activePlan || state.activePlan.today !== todayKey()) {
    state.activePlan = window.ExamEngine?.generate(allTopicsFlat(),state.exams,state.settings,todayKey()) || null;
    exWrite(STORE_KEY,state);
  }
  reconciliarSessoesConcluidas();
  // O sync aplica o documento em fundirRemoto(); aqui só se redesenha.
  // Um único ouvinte (ligar() corre também em escreverTudo/import).
  if (!ouvinteSyncRegistado && typeof window !== 'undefined') {
    ouvinteSyncRegistado = true;
    window.addEventListener('studyjournal:exames-sync', () => {
      state = loadState();
      renderAll();
    });
  }
  bindTabs();
  setTab(lerTabGuardada());
  renderAll();
}

function bindOnce(){
  if (document.documentElement.dataset.examesBoundV2) return;
  document.documentElement.dataset.examesBoundV2 = '1';
  bindTabs();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>{ bindOnce(); ligar(); });
else { bindOnce(); ligar(); }

window.Exames = {
  ligar,
  /* Aplica o documento remoto (sync) e devolve se algo mudou. */
  fundirRemoto(remoto) {
    const mudou = fundirRemoto(remoto);
    return mudou;
  },
  lerDataAlvo() {
    const ex = (state||loadState()).exams.find(e=>e.id!=='disc-geral' && e.dataExame);
    return ex ? ex.dataExame : lerDataAlvoLegacy();
  },
  lerTudo() {
    const s = state || loadState();
    return JSON.parse(JSON.stringify(s));
  },
  escreverTudo(d) {
    if(!d || typeof d !== 'object') return;
    // Accept both v2 and legacy payloads
    if (d.schemaVersion >= 2 || d.exams || d.sessions || d.issues) {
      const agora = Date.now();
      state = normalizeState(d);
      // Uma importação não pode perder itens contra os que já cá estão
      // no sync por não trazerem carimbo: ganha o carimbo da importação.
      COLECOES.forEach((tipo) => {
        (state[tipo] || []).forEach((item) => {
          if (item && typeof item === 'object' && !carimboItem(item)) item.updatedAt = agora;
        });
      });
      state.updatedAt = agora;
      exWrite(STORE_KEY, state);
    } else if (d.foco || d.recursos || d.track || d.duvidas) {
      // legacy import: write to legacy keys then migrate
      if (d.foco) exWrite(FOCO_KEY, d.foco);
      if (d.recursos) exWrite(RECURSOS_KEY, d.recursos);
      if (d.track) exWrite(TRACK_KEY, d.track);
      if (d.duvidas) exWrite(DUVIDAS_KEY, d.duvidas);
      if (typeof d.dataAlvo === 'string') exWrite(EXAME_DATA_KEY, d.dataAlvo);
      try { localStorage.removeItem(STORE_KEY); } catch {}
      state = loadState();
    } else {
      state = normalizeState(d);
      exWrite(STORE_KEY, state);
    }
    ligar();
  },
  getTodayPlan(){ return state?.activePlan?.daily?.items || []; },
  startPlanSession(id){ return startPlannedSession(id); },
  completePlanItem(id){ return startPlannedSession(id); },
  getPendingReviews(){ return window.ExamEngine?.pendingReviews(allTopicsFlat()) || []; },
};

})();
