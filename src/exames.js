/* StudyJournal — Exames Nacionais (Study Center)
   Redesign premium: visão geral, plano de estudo, tópicos, materiais, revisão, dúvidas e erros.
   Mantém compatibilidade de dados (migração automática) e API window.Exames. */

(function () {
'use strict';

const SCHEMA_VERSION = 2;
const STORE_KEY = 'study-journal-exames-center-v2';

// Legacy keys
const FOCO_KEY = 'study-journal-exames-foco';
const RECURSOS_KEY = 'study-journal-exames-recursos';
const TRACK_KEY = 'study-journal-exames-track';
const DUVIDAS_KEY = 'study-journal-exames-duvidas';
const EXAME_TAB_KEY = 'study-journal-exames-tab';
const EXAME_DATA_KEY = 'study-journal-exames-data-alvo';

const TABS = ['visao', 'plano', 'topicos', 'materiais', 'revisao', 'duvidas'];

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
  { id: 'disc-pt', nome: 'Português', cor: '#E0A458' },
  { id: 'disc-mat', nome: 'Matemática A', cor: '#7AA7D9' },
  { id: 'disc-fqa', nome: 'FQA', cor: '#6FBF8E' },
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
  tab: 'visao',
  topicQuery: '', topicFilterDisc: 'all', topicFilterEstado: 'all',
  matQuery: '', matFilterDisc: 'all', matFilterTipo: 'all', matFilterTag: '',
  revQuery: '', revFilterDisc: 'all', revFilterEstado: 'all',
  duvQuery: '', duvFilterDisc: 'all', duvFilterEstado: 'all',
  planoView: 'lista', planoWeekOffset: 0,
};

function defaultState() {
  const data = lerDataAlvoLegacy();
  return {
    schemaVersion: SCHEMA_VERSION,
    exams: DISC_DEFAULT.map(d => ({ id: d.id, nome: d.nome, cor: d.cor, dataExame: data })),
    topics: [], // flat nodes: {id, disciplinaId, parentId|null, tipo:'dominio'|'subdominio'|'topico', titulo, ...topic fields}
    materials: [],
    sessions: [],
    issues: [],
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
  out.ui = { ...(d.ui||{}), ...(out.ui||{}) };
  // ensure geral exists for misc
  if (!out.exams.some(e => e.id === 'disc-geral')) out.exams.push({ id:'disc-geral', nome:'Geral', cor:'#8A8A8A', dataExame:'' });
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

function saveState() {
  exWrite(STORE_KEY, state);
  renderAll();
}

function getExam(id){ return state.exams.find(e=>e.id===id); }
function getTopic(id){ return state.topics.find(t=>t.id===id); }
function topicLabel(id){ const t=getTopic(id); return t? t.titulo : ''; }
function discLabel(id){ const e=getExam(id); return e? e.nome : 'Geral'; }
function allTopicsFlat(){ return state.topics.filter(t=>t.tipo==='topico'); }

function topicStatusLabel(st){ return ({nao_iniciado:'Não iniciado', em_progresso:'Em progresso', concluido:'Concluído', precisa_revisao:'Precisa de revisão'})[st]||st; }
function topicStatusClass(st){ return ({nao_iniciado:'ex-badge-muted', em_progresso:'ex-badge-warn', concluido:'ex-badge-ok', precisa_revisao:'ex-badge-rev'})[st]||'ex-badge-muted'; }
function issueStatusLabel(st){ return ({por_resolver:'Por resolver', em_analise:'Em análise', resolvido:'Resolvido', precisa_revisao:'Precisa de revisão'})[st]||st; }
function issueStatusClass(st){ return ({por_resolver:'ex-badge-err', em_analise:'ex-badge-warn', resolvido:'ex-badge-ok', precisa_revisao:'ex-badge-rev'})[st]||'ex-badge-muted'; }

function progressOverall() {
  const tops = allTopicsFlat();
  if (!tops.length) return { pct:0, done:0, total:0, pending:0 };
  const done = tops.filter(t=>t.estado==='concluido').length;
  const pending = tops.length - done;
  return { pct: Math.round((done/tops.length)*100), done, total: tops.length, pending };
}

// ---------- DOM helpers ----------
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function setTab(name){
  ui.tab = TABS.includes(name)?name:'visao';
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
  const prog = progressOverall();
  const mats = state.materials.length;
  const revs = state.issues.filter(i=>i.estado!=='resolvido').length + state.sessions.filter(s=>!s.concluida).length;
  const lastTopic = getTopic(state.ui.lastTopicId) || allTopicsFlat().sort((a,b)=>(b.ultimaAtividade||0)-(a.ultimaAtividade||0))[0];
  const examsHtml = state.exams.filter(e=>e.id!=='disc-geral').map(e=>{
    const d = daysUntil(e.dataExame);
    const label = d==null ? 'Sem data' : (d>0 ? `${d} dias` : 'Hoje/Passado');
    return `<div class="ex-card ex-count-card">
      <div class="ex-count-name" style="--ex-accent:${e.cor||'#7AA7D9'}">${esc(e.nome)}</div>
      <div class="ex-count-days">${esc(label)}</div>
      <div class="ex-count-date">${e.dataExame?esc(fmtDate(e.dataExame)):'Definir data'}</div>
      <input type="date" class="ex-input ex-date-input" data-exam-date="${esc(e.id)}" value="${esc(e.dataExame||'')}" aria-label="Data de ${esc(e.nome)}">
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="ex-hero">
      <div>
        <h2 class="ex-title">Exames Nacionais</h2>
        <p class="ex-sub">Centro de organização e preparação para os exames nacionais.</p>
      </div>
    </div>

    <div class="ex-grid-countdowns">${examsHtml || '<p class="ex-muted">Sem exames configurados.</p>'}</div>

    <div class="ex-grid-stats">
      <div class="ex-card ex-stat"><span class="ex-stat-label">Progresso geral</span><strong>${prog.pct}%</strong><div class="ex-bar"><div style="width:${prog.pct}%"></div></div></div>
      <div class="ex-card ex-stat"><span class="ex-stat-label">Tópicos concluídos</span><strong>${prog.done}</strong><span class="ex-muted-sm">de ${prog.total}</span></div>
      <div class="ex-card ex-stat"><span class="ex-stat-label">Tópicos pendentes</span><strong>${prog.pending}</strong><span class="ex-muted-sm">por concluir</span></div>
      <div class="ex-card ex-stat"><span class="ex-stat-label">Materiais</span><strong>${mats}</strong><span class="ex-muted-sm">guardados</span></div>
      <div class="ex-card ex-stat"><span class="ex-stat-label">Revisões / pendentes</span><strong>${revs}</strong><span class="ex-muted-sm">itens a tratar</span></div>
    </div>

    <div class="ex-card ex-continue">
      <div class="ex-section-head"><h3>Continuar a estudar</h3></div>
      ${lastTopic ? `
        <div class="ex-continue-row">
          <div>
            <div class="ex-continue-title">${esc(lastTopic.titulo)}</div>
            <div class="ex-muted-sm">${esc(discLabel(lastTopic.disciplinaId))} · <span class="ex-badge ${topicStatusClass(lastTopic.estado)}">${esc(topicStatusLabel(lastTopic.estado))}</span></div>
          </div>
          <button type="button" class="ex-btn ex-btn-primary" data-go-topic="${esc(lastTopic.id)}">Continuar</button>
        </div>` : `<p class="ex-muted">Ainda sem atividade. Adiciona tópicos no separador "Tópicos" para começares.</p>`}
    </div>
  `;

  $all('[data-exam-date]', wrap).forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const ex = getExam(inp.dataset.examDate); if(!ex) return;
      ex.dataExame = inp.value || '';
      saveState(); miniToast('Data do exame atualizada.');
    });
  });
  $all('[data-go-topic]', wrap).forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.dataset.goTopic; state.ui.lastTopicId = id; exWrite(STORE_KEY, state);
      setTab('topicos');
      setTimeout(()=>{ const el = document.querySelector(`[data-topic-id="${CSS.escape(id)}"]`); el?.scrollIntoView({behavior:'smooth', block:'center'}); }, 50);
    });
  });
}

// ---------- Topics (hierarchy) ----------
function ensureDomainSub(disciplinaId, domTitle='Geral', subTitle='Geral'){
  let dom = state.topics.find(t=>t.tipo==='dominio' && t.disciplinaId===disciplinaId && t.titulo.toLowerCase()===domTitle.toLowerCase());
  if(!dom){ dom={id:uid('dom'), disciplinaId, parentId:null, tipo:'dominio', titulo:domTitle}; state.topics.push(dom); }
  let sub = state.topics.find(t=>t.tipo==='subdominio' && t.disciplinaId===disciplinaId && t.parentId===dom.id && t.titulo.toLowerCase()===subTitle.toLowerCase());
  if(!sub){ sub={id:uid('sub'), disciplinaId, parentId:dom.id, tipo:'subdominio', titulo:subTitle}; state.topics.push(sub); }
  return { dom, sub };
}
function renderTopics(){
  const wrap = $('#exames-topicos'); if(!wrap) return;
  const discOpts = state.exams.map(e=>`<option value="${esc(e.id)}" ${ui.topicFilterDisc===e.id?'selected':''}>${esc(e.nome)}</option>`).join('');
  const discFormOpts = state.exams.filter(e=>e.id!=='disc-geral').concat(state.exams.filter(e=>e.id==='disc-geral')).map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  const q = (ui.topicQuery||'').toLowerCase().trim();

  const tops = allTopicsFlat().filter(t=>{
    if(ui.topicFilterDisc!=='all' && t.disciplinaId!==ui.topicFilterDisc) return false;
    if(ui.topicFilterEstado!=='all' && t.estado!==ui.topicFilterEstado) return false;
    if(q){
      const hay = `${t.titulo} ${t.notasPessoais||''} ${discLabel(t.disciplinaId)}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  // group by disc > dom > sub
  const discs = state.exams.filter(e=> ui.topicFilterDisc==='all' ? e.id!=='disc-geral' || tops.some(t=>t.disciplinaId===e.id) : e.id===ui.topicFilterDisc);
  let treeHtml = '';
  discs.forEach(d=>{
    const doms = state.topics.filter(t=>t.tipo==='dominio' && t.disciplinaId===d.id);
    let domHtml = '';
    doms.forEach(dom=>{
      const subs = state.topics.filter(t=>t.tipo==='subdominio' && t.parentId===dom.id);
      let subHtml = '';
      subs.forEach(sub=>{
        const items = tops.filter(t=>t.parentId===sub.id);
        if(!items.length && (q || ui.topicFilterEstado!=='all')) return;
        const itemsHtml = items.map(t=>topicRow(t)).join('') || `<div class="ex-empty">Sem tópicos neste subdomínio.</div>`;
        subHtml += `<div class="ex-subgroup"><div class="ex-subgroup-title">${esc(sub.titulo)}</div><div class="ex-topic-list">${itemsHtml}</div></div>`;
      });
      if(!subHtml && (q || ui.topicFilterEstado!=='all')) return;
      domHtml += `<div class="ex-domain"><div class="ex-domain-title">${esc(dom.titulo)}</div>${subHtml || '<div class="ex-empty">Sem subdomínios/tópicos.</div>'}</div>`;
    });
    if(!domHtml && (q || ui.topicFilterEstado!=='all')) return;
    treeHtml += `<section class="ex-card ex-disc-block"><header class="ex-disc-head"><span class="ex-disc-dot" style="background:${d.cor||'#7AA7D9'}"></span><h3>${esc(d.nome)}</h3></header>${domHtml || '<div class="ex-empty">Sem tópicos. Adiciona abaixo.</div>'}</section>`;
  });
  if(!treeHtml) treeHtml = `<div class="ex-card ex-empty">Sem tópicos para os filtros atuais.</div>`;

  wrap.innerHTML = `
    <div class="ex-card ex-form-card">
      <div class="ex-section-head"><h3>Adicionar disciplina / tópico</h3></div>
      <form id="ex-topic-form" class="ex-form-grid ex-form-topics">
        <select id="ex-topic-disc" class="ex-input">${discFormOpts}</select>
        <input id="ex-topic-dom" class="ex-input" placeholder="Domínio" value="Geral">
        <input id="ex-topic-sub" class="ex-input" placeholder="Subdomínio" value="Geral">
        <input id="ex-topic-title" class="ex-input" placeholder="Tópico" required>
        <select id="ex-topic-estado" class="ex-input">
          <option value="nao_iniciado">Não iniciado</option>
          <option value="em_progresso">Em progresso</option>
          <option value="concluido">Concluído</option>
          <option value="precisa_revisao">Precisa de revisão</option>
        </select>
        <button type="submit" class="ex-btn ex-btn-primary">Adicionar</button>
      </form>
      <form id="ex-disc-form" class="ex-inline-form">
        <input id="ex-disc-nome" class="ex-input" placeholder="Nova disciplina/exame" />
        <input id="ex-disc-data" type="date" class="ex-input" />
        <button type="submit" class="ex-btn">Adicionar disciplina</button>
      </form>
    </div>

    <div class="ex-card ex-toolbar">
      <input id="ex-topic-q" class="ex-input" placeholder="Pesquisar tópicos…" value="${esc(ui.topicQuery)}">
      <select id="ex-topic-fdisc" class="ex-input"><option value="all">Todas as disciplinas</option>${discOpts}</select>
      <select id="ex-topic-festado" class="ex-input">
        <option value="all" ${ui.topicFilterEstado==='all'?'selected':''}>Todos os estados</option>
        <option value="nao_iniciado" ${ui.topicFilterEstado==='nao_iniciado'?'selected':''}>Não iniciado</option>
        <option value="em_progresso" ${ui.topicFilterEstado==='em_progresso'?'selected':''}>Em progresso</option>
        <option value="concluido" ${ui.topicFilterEstado==='concluido'?'selected':''}>Concluído</option>
        <option value="precisa_revisao" ${ui.topicFilterEstado==='precisa_revisao'?'selected':''}>Precisa de revisão</option>
      </select>
    </div>

    <div class="ex-topics-tree">${treeHtml}</div>
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
    state.topics.push({ id: uid('top'), disciplinaId, parentId: subNode.id, tipo:'topico', titulo, estado, confianca:3, notasPessoais:'', materialIds:[], exercicioIds:[], ultimaAtividade: Date.now() });
    saveState(); miniToast('Tópico adicionado.');
  });
  $('#ex-disc-form')?.addEventListener('submit', e=>{
    e.preventDefault();
    const nome = ($('#ex-disc-nome').value||'').trim();
    const data = $('#ex-disc-data').value || '';
    if(!nome) return miniToast('Indica o nome da disciplina.', 'warn');
    const id = 'disc-' + uid('x');
    state.exams.unshift({ id, nome, cor:'#8CB4E2', dataExame:data });
    ensureDomainSub(id,'Geral','Geral');
    saveState(); miniToast('Disciplina adicionada.');
  });
  $('#ex-topic-q')?.addEventListener('input', e=>{ ui.topicQuery = e.target.value; renderTopics(); });
  $('#ex-topic-fdisc')?.addEventListener('change', e=>{ ui.topicFilterDisc = e.target.value; renderTopics(); });
  $('#ex-topic-festado')?.addEventListener('change', e=>{ ui.topicFilterEstado = e.target.value; renderTopics(); });

  bindTopicActions(wrap);
}

function topicRow(t){
  const mats = (t.materialIds||[]).map(id=>getMat(id)).filter(Boolean);
  const exs = (t.exercicioIds||[]).map(id=>getIssue(id)).filter(Boolean);
  return `<div class="ex-topic-row" data-topic-id="${esc(t.id)}">
    <div class="ex-topic-main">
      <div class="ex-topic-title">${esc(t.titulo)}</div>
      <div class="ex-topic-meta">
        <span class="ex-badge ${topicStatusClass(t.estado)}">${esc(topicStatusLabel(t.estado))}</span>
        <span class="ex-muted-sm">Confiança: ${esc(String(t.confianca||3))}/5</span>
        ${mats.length?`<span class="ex-muted-sm">${mats.length} materiais</span>`:''}
        ${exs.length?`<span class="ex-muted-sm">${exs.length} exercícios</span>`:''}
      </div>
      ${t.notasPessoais ? `<div class="ex-topic-notes">${esc(t.notasPessoais)}</div>` : ''}
    </div>
    <div class="ex-topic-actions">
      <select class="ex-input ex-input-sm" data-topic-estado="${esc(t.id)}" aria-label="Estado">
        ${['nao_iniciado','em_progresso','concluido','precisa_revisao'].map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${topicStatusLabel(s)}</option>`).join('')}
      </select>
      <select class="ex-input ex-input-sm" data-topic-conf="${esc(t.id)}" aria-label="Confiança">
        ${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.confianca||3)===n?'selected':''}>Conf. ${n}</option>`).join('')}
      </select>
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
  $all('[data-topic-edit]', root).forEach(b=>b.addEventListener('click', ()=> openTopicDialog(b.dataset.topicEdit)));
  $all('[data-topic-study]', root).forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.topicStudy; state.ui.lastTopicId=id; exWrite(STORE_KEY,state); setTab('plano');
  }));
  $all('[data-topic-del]', root).forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.topicDel; const t=getTopic(id); if(!t) return;
    if(!confirm(`Apagar o tópico "${t.titulo}"?`)) return;
    state.topics = state.topics.filter(x=>x.id!==id);
    state.materials.forEach(m=>{ if(m.topicId===id) m.topicId=''; });
    state.sessions.forEach(s=>{ if(s.topicId===id) s.topicId=''; });
    state.issues.forEach(i=>{ if(i.topicId===id) i.topicId=''; });
    saveState();
  }));
}
function openTopicDialog(id){
  const t=getTopic(id); if(!t) return;
  const mats = state.materials.filter(m=>m.disciplinaId===t.disciplinaId);
  const exs = state.issues.filter(i=>i.disciplinaId===t.disciplinaId);
  const dlg = document.createElement('dialog');
  dlg.className = 'm-auto w-[min(38rem,94vw)] ex-dialog';
  dlg.innerHTML = `<form method="dialog" class="ex-dialog-inner">
    <div class="ex-dialog-head"><h3>Editar tópico</h3><button type="button" class="ex-btn ex-btn-sm" data-close>Fechar</button></div>
    <div class="ex-dialog-body ex-form-stack">
      <label class="ex-label">Título<input id="td-title" class="ex-input" value="${esc(t.titulo)}"></label>
      <div class="ex-form-grid-2">
        <label class="ex-label">Estado<select id="td-estado" class="ex-input">${['nao_iniciado','em_progresso','concluido','precisa_revisao'].map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${topicStatusLabel(s)}</option>`).join('')}</select></label>
        <label class="ex-label">Confiança<select id="td-conf" class="ex-input">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.confianca||3)===n?'selected':''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="ex-label">Notas pessoais<textarea id="td-notas" class="ex-input" rows="4">${esc(t.notasPessoais||'')}</textarea></label>
      <div class="ex-form-grid-2">
        <label class="ex-label">Materiais associados<select id="td-mats" class="ex-input" multiple size="4">${mats.map(m=>`<option value="${esc(m.id)}" ${(t.materialIds||[]).includes(m.id)?'selected':''}>${esc(m.titulo)}</option>`).join('')}</select></label>
        <label class="ex-label">Exercícios / registos relacionados<select id="td-exs" class="ex-input" multiple size="4">${exs.map(i=>`<option value="${esc(i.id)}" ${(t.exercicioIds||[]).includes(i.id)?'selected':''}>${esc(i.titulo)}</option>`).join('')}</select></label>
      </div>
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
    t.estado = $('#td-estado',dlg).value;
    t.confianca = Number($('#td-conf',dlg).value||3);
    t.notasPessoais = ($('#td-notas',dlg).value||'').trim();
    t.materialIds = $all('#td-mats option:checked',dlg).map(o=>o.value);
    t.exercicioIds = $all('#td-exs option:checked',dlg).map(o=>o.value);
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
    const id=b.dataset.matDel; state.materials = state.materials.filter(x=>x.id!==id);
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

function renderRevisao(){
  const wrap = $('#exames-revisao'); if(!wrap) return;
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

  wrap.innerHTML = `
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
  $all('[data-iss-del]', root).forEach(b=>b.addEventListener('click', ()=>{ state.issues = state.issues.filter(x=>x.id!==b.dataset.issDel); state.topics.forEach(t=>{ if(t.exercicioIds) t.exercicioIds=t.exercicioIds.filter(x=>x!==b.dataset.issDel); }); saveState(); }));
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
    return `<div class="ex-week-day ${isToday?'is-today':''}"><div class="ex-week-day-head">${d.toLocaleDateString('pt-PT',{weekday:'short', day:'numeric'})}</div>
      <div class="ex-week-day-list">${daySessions.length?daySessions.map(s=>`<div class="ex-week-item ${s.concluida?'done':''}" data-session-open="${esc(s.id)}"><span>${esc(discLabel(s.disciplinaId))}</span><strong>${esc(topicLabel(s.topicId)||'Sessão')}</strong><span class="ex-muted-sm">${esc(String(s.duracaoMin||0))} min</span></div>`).join(''):'<div class="ex-empty-sm">—</div>'}</div></div>`;
  }).join('')}</div>`;

  wrap.innerHTML = `
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
    const sess = { id: uid('sess'), disciplinaId, topicId, data, duracaoMin, notas, concluida:false, createdAt: Date.now(), calendarTaskId:null, calendarDate:data };
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

  $all('[data-plano-view]').forEach(b=>b.addEventListener('click', ()=>{ ui.planoView=b.dataset.planoView; renderPlano(); }));
  $all('[data-week-delta]').forEach(b=>b.addEventListener('click', ()=>{ ui.planoWeekOffset += Number(b.dataset.weekDelta||0); renderPlano(); }));
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
function bindSessionActions(root){
  $all('[data-sess-done]').forEach(b=>b.addEventListener('click', async ()=>{
    const s = state.sessions.find(x=>x.id===b.dataset.sessDone); if(!s) return;
    s.concluida = !s.concluida;
    if(s.topicId){ const t=getTopic(s.topicId); if(t){ t.ultimaAtividade=Date.now(); state.ui.lastTopicId=t.id; if(s.concluida && t.estado==='nao_iniciado') t.estado='em_progresso'; } }
    // sync calendar task state if linked
    if(s.calendarTaskId && s.calendarDate && typeof persistirTarefasDia==='function' && typeof read==='function'){
      try {
        const key=s.calendarDate; const tasks=read(`study-journal-tasks-${key}`, []);
        const ct = tasks.find(t=>t.id===s.calendarTaskId); if(ct){ ct.done = !!s.concluida; await persistirTarefasDia(key, tasks); }
      } catch {}
    }
    saveState();
  }));
  $all('[data-sess-del]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=b.dataset.sessDel; const s = state.sessions.find(x=>x.id===id); if(!s) return;
    if(!confirm('Apagar esta sessão?')) return;
    if(s.calendarTaskId && s.calendarDate && typeof persistirTarefasDia==='function' && typeof read==='function'){
      try { const key=s.calendarDate; const tasks=read(`study-journal-tasks-${key}`, []).filter(t=>t.id!==s.calendarTaskId); await persistirTarefasDia(key, tasks); } catch {}
    }
    state.sessions = state.sessions.filter(x=>x.id!==id);
    saveState();
  }));
  $all('[data-session-open]').forEach(el=>el.addEventListener('click', ()=>{
    ui.planoView='lista'; renderPlano();
  }));
}

// ---------- Render root / API ----------
function renderBadges(){
  const prog = progressOverall();
  const mats = state.materials.length;
  const revs = state.issues.filter(i=>i.estado!=='resolvido').length;
  const errs = state.issues.filter(i=>['erro_teste','erro_exame','exercicio_dificil','duvida'].includes(i.tipo) && i.estado!=='resolvido').length;
  const set = (name, val)=>{ const b=document.querySelector(`[data-exame-badge="${name}"]`); if(!b) return; if(!val){b.hidden=true;} else {b.hidden=false; b.textContent=String(val);} };
  set('plano', state.sessions.filter(s=>!s.concluida).length || '');
  set('topicos', prog.pending || '');
  set('materiais', mats || '');
  set('revisao', revs || '');
  set('duvidas', errs || '');
}

function renderAll(){
  if(!document.getElementById('view-exames')) return;
  renderOverview();
  renderPlano();
  renderTopics();
  renderMateriais();
  renderRevisao();
  renderDuvidasErros();
  renderBadges();
}

function lerTabGuardada(){
  try { const v=localStorage.getItem(EXAME_TAB_KEY); return TABS.includes(v)?v:'visao'; } catch { return 'visao'; }
}

function ligar(){
  state = loadState();
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
      state = normalizeState(d);
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
};

})();
