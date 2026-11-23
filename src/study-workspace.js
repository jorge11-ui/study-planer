/* Study Workspace enhancements: metadata das notas, notas recentes, nota rápida flutuante,
   filtros de tarefas, integração nota↔tarefas e totais de estudo. Complementa app.js/notas.js. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c]));
  }

  function selectedDayKey() {
    try {
      if (window.StudyJournal && typeof window.StudyJournal.diaAtual === 'function') return window.StudyJournal.diaAtual();
    } catch {}
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /* ── Metadados da nota do dia (título/disciplina/categoria/tópico) ── */
  function metaKey(day) { return `study-journal-note-meta-${day}`; }
  function getMeta(day) { return read(metaKey(day), { title:'', subject:'Geral', category:'resumo', examTopic:'' }); }
  function setMeta(day, patch) {
    const cur = getMeta(day);
    // Carimbo para o sync decidir a versão mais recente por dia.
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    write(metaKey(day), next);
    const idx = read('study-journal-notes-index', {});
    idx[day] = { day, title: next.title || '', subject: next.subject || 'Geral', category: next.category || 'resumo', updatedAt: Date.now() };
    write('study-journal-notes-index', idx);
    // Metadados não passam pelo commitNotes: sem isto, mudar só o título
    // (ou a disciplina) só chegava ao outro aparelho no push seguinte.
    if (typeof pushDebounced === 'function') pushDebounced(1200);
    updateTasksNoteContext();
  }

  function bindNoteMeta() {
    const title = $('#note-title');
    const subject = $('#note-subject');
    const category = $('#note-category');
    const examTopic = $('#note-exam-topic');
    const text = $('#journal-text');
    if (!text) return;

    const load = () => {
      const day = selectedDayKey();
      const m = getMeta(day);
      if (title && document.activeElement !== title) title.value = m.title || '';
      if (subject && document.activeElement !== subject) subject.value = m.subject || 'Geral';
      if (category && document.activeElement !== category) category.value = m.category || 'resumo';
      if (examTopic && document.activeElement !== examTopic) examTopic.value = m.examTopic || '';
      renderRecentNotes();
      populateExamTopics();
      updateTasksNoteContext();
      applyTaskFilter();
    };
    // Chamado depois de um pull para o Painel mostrar os metadados
    // (título/disciplina/categoria) que chegaram do outro aparelho.
    window.__swRefreshNota = load;

    const save = () => {
      const day = selectedDayKey();
      setMeta(day, {
        title: title?.value.trim() || '',
        subject: subject?.value || 'Geral',
        category: category?.value || 'resumo',
        examTopic: examTopic?.value || '',
      });
    };

    [title, subject, category, examTopic].forEach(el => {
      if (!el || el.dataset.swBound) return;
      el.dataset.swBound = '1';
      el.addEventListener('input', save);
      el.addEventListener('change', save);
    });

    $('#day-prev')?.addEventListener('click', () => setTimeout(load, 0));
    $('#day-next')?.addEventListener('click', () => setTimeout(load, 0));
    $('#cal-today')?.addEventListener('click', () => setTimeout(load, 0));

    if (!text.dataset.swIndexBound) {
      text.dataset.swIndexBound = '1';
      text.addEventListener('input', () => { setMeta(selectedDayKey(), {}); });
    }

    // sincronizar disciplina da tarefa com nota quando faz sentido
    subject?.addEventListener('change', () => {
      const ts = $('#task-subject');
      if (ts && subject.value) ts.value = subject.value;
    });

    load();
  }

  function populateExamTopics() {
    const sel = $('#note-exam-topic');
    if (!sel) return;
    const keep = sel.value;
    try {
      const data = read('study-journal-exames-track', []);
      const opts = Array.isArray(data) ? data : [];
      while (sel.options.length > 1) sel.remove(1);
      opts.slice(0, 200).forEach(item => {
        const o = document.createElement('option');
        const label = [item.disciplina, item.topico || item.nome || item.tema].filter(Boolean).join(' · ');
        o.value = String(item.id || label);
        o.textContent = label || 'Tópico';
        sel.append(o);
      });
      if (keep) sel.value = keep;
    } catch {}
  }

  /* ── Notas recentes / anteriores ── */
  function renderRecentNotes() {
    const box = $('#recent-notes-list');
    if (!box) return;
    const idx = read('study-journal-notes-index', {});
    const items = Object.values(idx)
      .filter(x => x && x.day)
      .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))
      .slice(0, 10);
    box.replaceChildren();
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'text-[12px] text-[#777]';
      p.textContent = 'Sem notas recentes.';
      box.append(p);
      return;
    }
    items.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full rounded-lg border border-[#292929] bg-[#0f0f0f] px-3 py-2 text-left transition hover:border-[#3a3a3a]';
      const title = it.title || `Nota de ${it.day}`;
      btn.innerHTML = `<div class="truncate text-[13px] font-medium text-[#e6e6e6]">${esc(title)}</div>
        <div class="mt-0.5 flex items-center gap-2 text-[11px] text-[#777]"><span>${esc(it.day)}</span><span>·</span><span>${esc(it.subject||'Geral')}</span></div>`;
      btn.addEventListener('click', () => {
        // abrir via paleta global para navegar de forma consistente
        const input = document.getElementById('global-search');
        if (window.NotasPro?.abrirPaleta) { window.NotasPro.abrirPaleta(); if (input) { input.value = it.title || it.day; input.dispatchEvent(new Event('input',{bubbles:true})); } }
      });
      box.append(btn);
    });
  }

  /* ── Integração Nota ↔ Tarefas ── */
  function currentNoteContext() {
    const day = selectedDayKey();
    const meta = getMeta(day);
    const title = (meta.title || $('#note-title')?.value || '').trim();
    return { noteDay: day, noteTitle: title, noteSubject: meta.subject || $('#note-subject')?.value || 'Geral' };
  }

  function updateTasksNoteContext() {
    const el = $('#tasks-note-context');
    if (!el) return;
    const ctx = currentNoteContext();
    const label = ctx.noteTitle ? `Nota atual: ${ctx.noteTitle}` : `Nota do dia ${ctx.noteDay}`;
    el.textContent = `${label} · tarefas integradas`;
  }

  function bindNoteToTask() {
    const btn = $('#note-to-task');
    if (!btn || btn.dataset.swBound) return;
    btn.dataset.swBound = '1';
    btn.addEventListener('click', () => {
      const area = $('#journal-text');
      const input = $('#task-input');
      if (!input) return;
      let sel = '';
      try {
        if (area && area.selectionStart !== area.selectionEnd) sel = area.value.slice(area.selectionStart, area.selectionEnd).trim();
      } catch {}
      const ctx = currentNoteContext();
      if (!input.value.trim()) {
        input.value = sel ? sel.split('\n')[0].slice(0, 120) : (ctx.noteTitle ? `Rever: ${ctx.noteTitle}` : 'Tarefa da nota');
      }
      const subj = $('#task-subject');
      const noteSubj = $('#note-subject')?.value;
      if (subj && noteSubj) subj.value = noteSubj;
      window.__swTaskNoteLink = ctx;
      input.focus();
      input.select();
      // feedback discreto
      if (window.toast) window.toast('Tarefa associada à nota atual. Confirma em "Adicionar tarefa".', 'info');
      const hint = $('#tasks-note-context');
      if (hint) hint.textContent = 'Pronto para adicionar tarefa ligada à nota atual';
    });

    // associação por defeito para tarefas criadas no workspace (integração sem duplicação)
    const form = $('#task-form');
    if (form && !form.dataset.swLinkBound) {
      form.dataset.swLinkBound = '1';
      form.addEventListener('submit', () => {
        if (!window.__swTaskNoteLink) window.__swTaskNoteLink = currentNoteContext();
      }, { capture: true });
    }
  }

  /* ── Filtro de tarefas (Todas / Pendentes / Da nota) ── */
  let taskFilter = 'todas';
  function applyTaskFilter() {
    const ctx = currentNoteContext();
    $$('#task-list > li').forEach(li => {
      const done = !!li.querySelector('input[type="checkbox"]')?.checked;
      let show = true;
      if (taskFilter === 'pendentes') show = !done;
      if (taskFilter === 'nota') {
        const sameDay = !li.dataset.noteDay || li.dataset.noteDay === ctx.noteDay;
        const hasLink = !!li.dataset.noteDay || !!li.dataset.noteTitle;
        // mostrar tarefas do dia/associadas à nota atual (conteúdo em estudo)
        show = hasLink ? sameDay : sameDay; // fallback: tarefas do dia atual são relacionadas ao estudo do dia
      }
      li.style.display = show ? '' : 'none';
    });
    $$('[data-task-filter]').forEach(btn => {
      const active = btn.dataset.taskFilter === taskFilter;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('bg-[#1f1f1f]', active);
      btn.classList.toggle('text-[#f2f2f2]', active);
      btn.classList.toggle('text-[#8a8a8a]', !active);
    });
  }
  function bindTaskFilter() {
    $$('[data-task-filter]').forEach(btn => {
      if (btn.dataset.swBound) return;
      btn.dataset.swBound = '1';
      btn.addEventListener('click', () => { taskFilter = btn.dataset.taskFilter || 'todas'; applyTaskFilter(); });
    });
    const list = $('#task-list');
    if (list && !list.dataset.swFilterObs) {
      list.dataset.swFilterObs = '1';
      new MutationObserver(() => applyTaskFilter()).observe(list, { childList:true, subtree:true, attributes:true });
    }
    applyTaskFilter();
  }

  /* ── Botões utilitários ── */
  function bindTopButtons() {
    $('#notes-history-toggle')?.addEventListener('click', () => window.NotasPro?.abrirPaleta?.());
    $('#note-history-quick')?.addEventListener('click', () => window.NotasPro?.abrirPaleta?.());
    $('#recent-notes-refresh')?.addEventListener('click', renderRecentNotes);
  }

  /* ── Nota flutuante (separada das notas diárias) ── */
  function bindQuickNote() {
    const win = $('#quick-note-window');
    const open = $('#quick-note-open');
    const close = $('#quick-note-close');
    const minBtn = $('#quick-note-minimize');
    const header = $('#quick-note-header');
    const save = $('#quick-note-save');
    const clear = $('#quick-note-clear');
    const text = $('#quick-note-text');
    const title = $('#quick-note-title');
    const subject = $('#quick-note-subject');
    const category = $('#quick-note-category');
    const status = $('#quick-note-status');
    if (!win || !open) return;

    const FLOAT_KEY = 'study-journal-floating-note';

    const readFloat = () => read(FLOAT_KEY, { title: '', subject: 'Geral', category: 'resumo', text: '' });
    const writeFloat = (data) => write(FLOAT_KEY, data);

    const loadFloat = () => {
      const d = readFloat() || {};
      if (title) title.value = d.title || '';
      if (subject) subject.value = d.subject || 'Geral';
      if (category) category.value = d.category || 'resumo';
      if (text) text.value = d.text || '';
    };

    const persistFloat = (msg = 'Guardado na nota flutuante.') => {
      const data = {
        title: (title?.value || '').trim(),
        subject: subject?.value || 'Geral',
        category: category?.value || 'resumo',
        text: text?.value || '',
        updatedAt: Date.now(),
      };
      writeFloat(data);
      if (typeof pushDebounced === 'function') pushDebounced(1200);
      if (status) status.textContent = msg;
      setTimeout(() => { if (status && status.textContent === msg) status.textContent = ''; }, 2200);
      return data;
    };

    const show = () => {
      loadFloat();
      win.classList.remove('hidden');
      win.classList.remove('minimized');
      win.style.left = '50%';
      win.style.top = '50%';
      win.style.right = 'auto';
      win.style.bottom = 'auto';
      win.style.transform = 'translate(-50%, -50%)';
      text?.focus();
    };
    const hide = () => win.classList.add('hidden');

    if (!open.dataset.swBound) { open.dataset.swBound = '1'; open.addEventListener('click', show); }
    close?.addEventListener('click', hide);
    minBtn?.addEventListener('click', () => win.classList.toggle('minimized'));

    clear?.addEventListener('click', () => {
      if (title) title.value = '';
      if (text) text.value = '';
      if (subject) subject.value = 'Geral';
      if (category) category.value = 'resumo';
      writeFloat({ title: '', subject: 'Geral', category: 'resumo', text: '', updatedAt: Date.now() });
      if (typeof pushDebounced === 'function') pushDebounced(1200);
      if (status) status.textContent = 'Nota flutuante limpa.';
      setTimeout(() => { if (status && status.textContent === 'Nota flutuante limpa.') status.textContent = ''; }, 2200);
      text?.focus();
    });

    save?.addEventListener('click', () => {
      const hasContent = (title?.value || '').trim() || (text?.value || '').trim();
      if (!hasContent) { if (status) status.textContent = 'Escreve algo primeiro.'; return; }
      persistFloat('Guardado na nota flutuante.');
    });

    // auto-guardar alterações para ficar sempre ali (separado das notas diárias)
    let floatTimer = null;
    [title, subject, category, text].forEach(el => {
      if (!el || el.dataset.floatBound) return;
      el.dataset.floatBound = '1';
      const onInput = () => {
        clearTimeout(floatTimer);
        floatTimer = setTimeout(() => persistFloat('Guardado automaticamente.'), 700);
      };
      el.addEventListener('input', onInput);
      el.addEventListener('change', onInput);
    });

    if (!header?.dataset.swDragBound) {
      header.dataset.swDragBound = '1';
      let drag = null;
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        const rect = win.getBoundingClientRect();
        drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        win.style.transform = 'none';
        win.style.right = 'auto'; win.style.bottom = 'auto';
        win.style.left = `${rect.left}px`; win.style.top = `${rect.top}px`;
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const x = Math.max(8, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
        const y = Math.max(8, Math.min(window.innerHeight - 48, e.clientY - drag.dy));
        win.style.left = `${x}px`; win.style.top = `${y}px`;
      });
      window.addEventListener('mouseup', () => { drag = null; });
    }

    // carregar conteúdo existente (fica sempre ali)
    loadFloat();

    // Quando outro aparelho altera a nota rápida, o sync avisa e os
    // campos abertos atualizam sem fechar a janela.
    window.addEventListener('studyjournal:floating-note-sync', (event) => {
      const dados = event && event.detail && event.detail.data;
      if (!dados || typeof dados !== 'object') return;
      if (title && document.activeElement !== title) title.value = dados.title || '';
      if (text && document.activeElement !== text) text.value = dados.text || '';
      if (subject && document.activeElement !== subject) subject.value = dados.subject || 'Geral';
      if (category && document.activeElement !== category) category.value = dados.category || 'resumo';
      if (status) status.textContent = 'Nota sincronizada de outro aparelho.';
    });
  }

  function boot() {
    if (document.body.dataset.swBooted) return;
    document.body.dataset.swBooted = '1';
    bindNoteMeta();
    bindTopButtons();
    bindQuickNote();
    bindTaskFilter();
    bindNoteToTask();
    renderRecentNotes();
    updateTasksNoteContext();
    setInterval(() => { try { window.renderSessionTimer && window.renderSessionTimer(); } catch {} }, 30000);
    document.addEventListener('click', (e) => {
      if (e.target.closest('#day-prev,#day-next')) setTimeout(() => { bindNoteMeta(); applyTaskFilter(); }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
