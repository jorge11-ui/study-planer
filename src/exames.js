/* StudyJournal — Exames Nacionais (Português, Matemática A, FQA).
   Secção modular: foco semanal + recursos PDFs + tabela acompanhamento + dúvidas.
   Persistência em localStorage, sem dependência de arranque do app.js. */

(function () {
'use strict';

const FOCO_KEY = 'study-journal-exames-foco';
const RECURSOS_KEY = 'study-journal-exames-recursos';
const TRACK_KEY = 'study-journal-exames-track';
const DUVIDAS_KEY = 'study-journal-exames-duvidas';
const EXAME_TAB_KEY = 'study-journal-exames-tab';
const EXAME_TABS = ['foco', 'recursos', 'track', 'duvidas'];

/* Data-alvo 1ª fase (editável no cabeçalho dos Exames, guardada no browser) */
const EXAME_DATA_KEY = 'study-journal-exames-data-alvo';

function proximaDataPadrao() {
    const anoAtual = new Date().getFullYear();
    const esteAno = new Date(`${anoAtual}-06-18T09:30:00`);
    const ano = esteAno > new Date() ? anoAtual : anoAtual + 1;
    return `${ano}-06-18`;
}

function lerDataAlvo() {
    const v = exRead(EXAME_DATA_KEY, proximaDataPadrao());
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : proximaDataPadrao();
}

function exRead(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}
function exWrite(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}
function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function miniToast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg, 'success'); return; }
    const box = document.getElementById('toasts');
    if (!box) return;
    const n = document.createElement('div');
    n.className = 'toast pointer-events-auto glass-subtle rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm';
    n.textContent = msg;
    box.append(n);
    setTimeout(() => n.remove(), 2500);
}

const DISC_CHIP = {
    'Português': 'bg-subject-yellow/15 text-subject-yellow',
    'Matemática A': 'bg-subject-blue/15 text-subject-blue',
    'FQA': 'bg-subject-green/15 text-subject-green',
    'Geral': 'bg-surface-3 text-muted',
};

/* ── 0. Seed inicial ── */
function seedIfEmpty() {
    if (!localStorage.getItem(FOCO_KEY)) {
        exWrite(FOCO_KEY, {
            'Portugues': { topico: 'Os Maias — Eça de Queirós', objetivo: 'Dominar caracterização das personagens e contexto histórico.', progresso: 45 },
            'Matematica A': { topico: 'Cálculo Diferencial: Derivadas', objetivo: 'Resolver 15 exercícios de otimização de exames anteriores.', progresso: 70 },
            'FQA': { topico: 'Termodinâmica e Entropia', objetivo: 'Memorizar fórmulas de calorimetria e resolver fichas IAVE.', progresso: 30 },
        });
    }
    if (!localStorage.getItem(RECURSOS_KEY)) {
        exWrite(RECURSOS_KEY, [
            { id: uid('res'), disciplina: 'Português', nome: 'Fichas IAVE - Texto', url: '' },
            { id: uid('res'), disciplina: 'Português', nome: 'Resumos de Matéria', url: '' },
            { id: uid('res'), disciplina: 'Português', nome: 'Exames Resolvidos', url: '' },
            { id: uid('res'), disciplina: 'Português', nome: 'Critérios de Classificação', url: '' },
            { id: uid('res'), disciplina: 'Matemática A', nome: 'Fichas IAVE - Cálculo', url: '' },
            { id: uid('res'), disciplina: 'Matemática A', nome: 'Resumos de Geometria', url: '' },
            { id: uid('res'), disciplina: 'Matemática A', nome: 'Exames Resolvidos', url: '' },
            { id: uid('res'), disciplina: 'Matemática A', nome: 'Critérios de Classificação', url: '' },
            { id: uid('res'), disciplina: 'FQA', nome: 'Fichas IAVE - Química', url: '' },
            { id: uid('res'), disciplina: 'FQA', nome: 'Resumos de Física', url: '' },
            { id: uid('res'), disciplina: 'FQA', nome: 'Exames Resolvidos', url: '' },
            { id: uid('res'), disciplina: 'FQA', nome: 'Critérios de Classificação', url: '' },
        ]);
    }
    if (!localStorage.getItem(TRACK_KEY)) {
        exWrite(TRACK_KEY, [
            { id: uid('trk'), disciplina: 'Matemática A', topico: 'Derivadas de Funções Compostas', ficha: 'ficha_der_01.pdf', dificuldade: 4, estado: 'Em progresso' },
            { id: uid('trk'), disciplina: 'FQA', topico: 'Equilíbrio Químico', ficha: 'ficha_equil_02.pdf', dificuldade: 2, estado: 'Concluído' },
            { id: uid('trk'), disciplina: 'Português', topico: 'Sintaxe: Orações Subordinadas', ficha: 'sintaxe_resumo.pdf', dificuldade: 3, estado: 'A iniciar' },
        ]);
    }
    if (!localStorage.getItem(DUVIDAS_KEY)) {
        exWrite(DUVIDAS_KEY, [
            { id: uid('duv'), tipo: 'conceito', disciplina: 'Matemática A', titulo: 'Regra da Cadeia', texto: "f'(g(x)) · g'(x) — derivada da exterior × derivada da interior." },
            { id: uid('duv'), tipo: 'conceito', disciplina: 'FQA', titulo: '1ª Lei da Termodinâmica', texto: 'ΔU = Q + W (cuidado com os sinais do trabalho!).' },
            { id: uid('duv'), tipo: 'erro', disciplina: 'Matemática A', titulo: 'Exame 2022 — Q3', texto: 'Perdi pontos por erro de sinal na integração. Rever sinais.' },
            { id: uid('duv'), tipo: 'erro', disciplina: 'FQA', titulo: 'Exame 2021 — Gases', texto: 'Esqueci converter °C → K. Sempre verificar unidades.' },
        ]);
    }
}

/* ── 1. Foco prioritário ── */
const FOCO_CARDS = [
    { key: 'Portugues', label: 'Português' },
    { key: 'Matematica A', label: 'Matemática A' },
    { key: 'FQA', label: 'FQA' },
];

function renderFoco() {
    const data = exRead(FOCO_KEY, {});
    document.querySelectorAll('[data-foco-card]').forEach((card) => {
        const disc = card.getAttribute('data-foco-card');
        const entry = data[disc] || { topico: '', objetivo: '', progresso: 0 };
        const topico = card.querySelector('[data-foco-topico]');
        const objetivo = card.querySelector('[data-foco-objetivo]');
        const range = card.querySelector('[data-foco-range]');
        const bar = card.querySelector('[data-foco-bar]');
        const pct = card.querySelector('[data-foco-percent]');
        if (topico && document.activeElement !== topico) topico.value = entry.topico || '';
        if (objetivo && document.activeElement !== objetivo) objetivo.value = entry.objetivo || '';
        if (range && document.activeElement !== range) range.value = String(entry.progresso ?? 0);
        if (bar) bar.style.width = `${entry.progresso ?? 0}%`;
        if (pct) pct.textContent = `${entry.progresso ?? 0}%`;
    });
}

function bindFoco() {
    let t = null;
    const save = () => {
        clearTimeout(t);
        t = setTimeout(() => {
            const data = exRead(FOCO_KEY, {});
            document.querySelectorAll('[data-foco-card]').forEach((card) => {
                const disc = card.getAttribute('data-foco-card');
                data[disc] = {
                    topico: card.querySelector('[data-foco-topico]')?.value.trim() || '',
                    objetivo: card.querySelector('[data-foco-objetivo]')?.value.trim() || '',
                    progresso: Number(card.querySelector('[data-foco-range]')?.value || 0),
                };
            });
            exWrite(FOCO_KEY, data);
            renderFoco();
            if (window.GitHubSync?.configurado?.()) window.GitHubSync.sync(false).catch(() => {});
        }, 400);
    };
    document.querySelectorAll('[data-foco-card] input, [data-foco-card] textarea').forEach((el) => {
        el.addEventListener('input', save);
        el.addEventListener('change', save);
    });
}

/* ── 2. Recursos ── */
function isUrl(v) {
    return /^https?:\/\//i.test(String(v || '').trim());
}

function recursoLi(r) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2 rounded-lg border border-line-soft bg-surface px-2.5 py-2 text-xs transition hover:border-line';
    const dot = document.createElement('span');
    dot.className = 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-light';
    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    if (r.url && r.url.trim()) {
        const a = document.createElement('a');
        a.href = r.url.trim();
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'block truncate font-medium text-fg underline decoration-brand/50 underline-offset-2 hover:text-brand-light';
        a.title = `[${r.nome}](${r.url})`;
        a.textContent = r.nome;
        const md = document.createElement('p');
        md.className = 'truncate font-mono text-[10px] text-faint';
        md.textContent = `[${r.nome}](${r.url})`;
        body.append(a, md);
    } else {
        const s = document.createElement('span');
        s.className = 'block truncate font-medium text-muted';
        s.textContent = `[${r.nome}](URL_DO_FICHEIRO)`;
        s.title = 'Edita este recurso: adiciona o URL do PDF';
        body.append(s);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'shrink-0 rounded-md p-1 text-faint transition hover:bg-surface-3 hover:text-subject-rose';
    del.setAttribute('aria-label', `Apagar ${r.nome}`);
    del.innerHTML = '<svg class="icon h-3.5 w-3.5"><use href="#i-trash"/></svg>';
    del.addEventListener('click', () => {
        exWrite(RECURSOS_KEY, exRead(RECURSOS_KEY, []).filter((x) => x.id !== r.id));
        renderRecursos();
    });
    li.append(dot, body, del);
    return li;
}

function renderRecursos() {
    const all = exRead(RECURSOS_KEY, []);
    const map = {
        'Português': document.getElementById('exames-recursos-pt'),
        'Matemática A': document.getElementById('exames-recursos-mat'),
        'FQA': document.getElementById('exames-recursos-fqa'),
    };
    Object.values(map).forEach((ul) => ul && ul.replaceChildren());
    Object.entries(map).forEach(([disc, ul]) => {
        if (!ul) return;
        const list = all.filter((r) => r.disciplina === disc);
        if (!list.length) {
            const p = document.createElement('p');
            p.className = 'py-3 text-center text-[11px] text-faint';
            p.textContent = 'Sem recursos. Adiciona em cima.';
            ul.append(p);
            return;
        }
        list.forEach((r) => ul.append(recursoLi(r)));
    });
    const count = document.getElementById('exames-recursos-count');
    if (count) count.textContent = all.length ? `${all.length} recursos` : '';
    atualizarBadgesExame();
}

function bindRecursos() {
    const form = document.getElementById('exames-recurso-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const disc = document.getElementById('exames-recurso-disc').value;
        const nome = document.getElementById('exames-recurso-nome').value.trim();
        const url = document.getElementById('exames-recurso-url').value.trim();
        if (!nome) { miniToast('Dá um nome ao recurso.'); return; }
        const all = exRead(RECURSOS_KEY, []);
        all.push({ id: uid('res'), disciplina: disc, nome, url });
        exWrite(RECURSOS_KEY, all);
        form.reset();
        renderRecursos();
        miniToast('Recurso adicionado.');
    });
}

/* ── 3. Tabela acompanhamento ── */
let trackFilter = 'todos';

function difBadge(n) {
    const v = Number(n) || 3;
    const color = v <= 2 ? 'bg-mint/15 text-mint' : v === 3 ? 'bg-subject-yellow/15 text-subject-yellow' : 'bg-subject-rose/15 text-subject-rose';
    const s = document.createElement('span');
    s.className = `inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${color}`;
    s.textContent = String(v);
    s.title = `Dificuldade ${v} de 5`;
    return s;
}
function estadoBadge(estado) {
    const map = {
        'A iniciar': 'bg-surface-3 text-muted',
        'Em progresso': 'bg-subject-yellow/15 text-subject-yellow',
        'Concluído': 'bg-mint/15 text-mint',
    };
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `rounded-full px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-80 ${map[estado] || map['A iniciar']}`;
    b.textContent = estado;
    b.title = 'Clicar para avançar estado';
    b.addEventListener('click', () => {
        const order = ['A iniciar', 'Em progresso', 'Concluído'];
        const next = order[(order.indexOf(estado) + 1) % order.length];
        const fixed = exRead(TRACK_KEY, []).map((x) => (x.id === b.dataset.id ? { ...x, estado: next } : x));
        exWrite(TRACK_KEY, fixed);
        renderTrack();
    });
    return b;
}

function renderTrack() {
    const body = document.getElementById('exames-track-body');
    const empty = document.getElementById('exames-track-empty');
    if (!body) return;
    body.replaceChildren();
    let rows = exRead(TRACK_KEY, []);
    if (trackFilter !== 'todos') rows = rows.filter((r) => r.estado === trackFilter);
    if (empty) empty.hidden = rows.length > 0;
    rows.forEach((r) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-line-soft last:border-0 transition hover:bg-surface-2/60';
        // disciplina
        const tdD = document.createElement('td');
        tdD.className = 'px-3 py-2.5';
        const chip = document.createElement('span');
        chip.className = `chip ${DISC_CHIP[r.disciplina] || DISC_CHIP.Geral}`;
        chip.textContent = r.disciplina;
        tdD.append(chip);
        // tópico
        const tdT = document.createElement('td');
        tdT.className = 'px-3 py-2.5 text-muted';
        tdT.textContent = r.topico;
        // ficha
        const tdF = document.createElement('td');
        tdF.className = 'px-3 py-2.5';
        if (isUrl(r.ficha)) {
            const a = document.createElement('a');
            a.href = r.ficha.trim();
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'text-brand-light underline decoration-brand/40 underline-offset-2 hover:text-brand';
            a.textContent = r.ficha.length > 32 ? r.ficha.slice(0, 32) + '…' : r.ficha;
            a.title = r.ficha;
            tdF.append(a);
        } else {
            tdF.className += ' italic text-muted';
            tdF.textContent = r.ficha || '—';
            tdF.title = r.ficha || '';
        }
        // dificuldade
        const tdDif = document.createElement('td');
        tdDif.className = 'px-3 py-2.5 text-center';
        tdDif.append(difBadge(r.dificuldade));
        // estado
        const tdE = document.createElement('td');
        tdE.className = 'px-3 py-2.5 text-center';
        const badge = estadoBadge(r.estado);
        badge.dataset.id = r.id;
        tdE.append(badge);
        // acções
        const tdA = document.createElement('td');
        tdA.className = 'px-3 py-2.5 text-center';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'rounded-lg p-1.5 text-faint transition hover:bg-surface-3 hover:text-subject-rose';
        del.setAttribute('aria-label', `Apagar ${r.topico}`);
        del.innerHTML = '<svg class="icon h-4 w-4"><use href="#i-trash"/></svg>';
        del.addEventListener('click', () => {
            exWrite(TRACK_KEY, exRead(TRACK_KEY, []).filter((x) => x.id !== r.id));
            renderTrack();
        });
        tdA.append(del);
        tr.append(tdD, tdT, tdF, tdDif, tdE, tdA);
        body.append(tr);
    });
    document.querySelectorAll('[data-track-filter]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.trackFilter === trackFilter));
    });
    atualizarBadgesExame();
}

function bindTrack() {
    const form = document.getElementById('exames-track-form');
    if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const disciplina = document.getElementById('exames-track-disc').value;
            const topico = document.getElementById('exames-track-topico').value.trim();
            const ficha = document.getElementById('exames-track-ficha').value.trim();
            const dificuldade = Number(document.getElementById('exames-track-dif').value || 3);
            const estado = document.getElementById('exames-track-estado').value;
            if (!topico) { miniToast('Escreve o conteúdo/tópico.'); return; }
            const all = exRead(TRACK_KEY, []);
            all.unshift({ id: uid('trk'), disciplina, topico, ficha, dificuldade, estado });
            exWrite(TRACK_KEY, all);
            form.reset();
            document.getElementById('exames-track-dif').value = '3';
            renderTrack();
            miniToast('Tópico adicionado à tabela.');
        });
    }
    document.querySelectorAll('[data-track-filter]').forEach((b) => {
        if (b.dataset.bound) return;
        b.dataset.bound = '1';
        b.addEventListener('click', () => {
            trackFilter = b.dataset.trackFilter;
            renderTrack();
        });
    });
}

/* ── 4. Dúvidas & revisão ── */
function duvidaConceitoCard(d) {
    const div = document.createElement('div');
    div.className = 'rounded-xl border border-line-soft bg-surface p-3';
    const head = document.createElement('div');
    head.className = 'mb-1 flex items-center gap-2';
    const chip = document.createElement('span');
    chip.className = `chip ${DISC_CHIP[d.disciplina] || DISC_CHIP.Geral}`;
    chip.textContent = d.disciplina;
    const title = document.createElement('p');
    title.className = 'min-w-0 flex-1 truncate text-xs font-semibold text-fg';
    title.textContent = d.titulo;
    title.title = d.titulo;
    const rever = document.createElement('button');
    rever.type = 'button';
    rever.className = 'shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted transition hover:bg-surface-3 hover:text-fg';
    rever.textContent = 'Rever';
    rever.title = 'Agendar revisão espaçada';
    rever.addEventListener('click', () => {
        if (window.ReviewSystem && typeof window.ReviewSystem.criarAPartirDeDuvida === 'function') {
            window.ReviewSystem.criarAPartirDeDuvida(d);
            miniToast('Agendado para revisão.');
        }
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-subject-rose';
    del.setAttribute('aria-label', `Apagar ${d.titulo}`);
    del.innerHTML = '<svg class="icon h-3.5 w-3.5"><use href="#i-x"/></svg>';
    del.addEventListener('click', () => {
        exWrite(DUVIDAS_KEY, exRead(DUVIDAS_KEY, []).filter((x) => x.id !== d.id));
        renderDuvidas();
    });
    head.append(chip, title, rever, del);
    const txt = document.createElement('p');
    txt.className = 'text-xs italic leading-relaxed text-muted';
    txt.textContent = d.texto;
    div.append(head, txt);
    return div;
}

function duvidaErroLi(d) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2.5 rounded-xl border border-line-soft bg-surface p-2.5';
    const num = document.createElement('span');
    num.className = 'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-subject-rose/15 text-[10px] font-bold text-subject-rose';
    num.textContent = '!';
    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    const t = document.createElement('p');
    t.className = 'text-xs text-muted';
    const strong = document.createElement('strong');
    strong.className = 'font-semibold text-fg';
    strong.textContent = `${d.titulo}: `;
    t.append(strong, document.createTextNode(d.texto));
    const meta = document.createElement('p');
    meta.className = 'mt-1 text-[10px] uppercase tracking-wide text-faint';
    meta.textContent = d.disciplina;
    body.append(t, meta);
    const rever = document.createElement('button');
    rever.type = 'button';
    rever.className = 'shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted transition hover:bg-surface-3 hover:text-fg';
    rever.textContent = 'Rever';
    rever.title = 'Agendar revisão espaçada';
    rever.addEventListener('click', () => {
        if (window.ReviewSystem && typeof window.ReviewSystem.criarAPartirDeDuvida === 'function') {
            window.ReviewSystem.criarAPartirDeDuvida(d);
            miniToast('Falha agendada para revisão.');
        }
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-subject-rose';
    del.setAttribute('aria-label', `Apagar ${d.titulo}`);
    del.innerHTML = '<svg class="icon h-3.5 w-3.5"><use href="#i-x"/></svg>';
    del.addEventListener('click', () => {
        exWrite(DUVIDAS_KEY, exRead(DUVIDAS_KEY, []).filter((x) => x.id !== d.id));
        renderDuvidas();
    });
    li.append(num, body, rever, del);
    return li;
}

function renderDuvidas() {
    const boxC = document.getElementById('exames-duvidas-conceitos');
    const boxE = document.getElementById('exames-duvidas-erros');
    if (!boxC || !boxE) return;
    boxC.replaceChildren();
    boxE.replaceChildren();
    const all = exRead(DUVIDAS_KEY, []);
    const conceitos = all.filter((d) => d.tipo !== 'erro');
    const erros = all.filter((d) => d.tipo === 'erro');
    if (!conceitos.length) {
        const p = document.createElement('p');
        p.className = 'py-4 text-center text-[11px] text-faint';
        p.textContent = 'Sem notas. Guarda fórmulas e conceitos-chave.';
        boxC.append(p);
    } else conceitos.forEach((d) => boxC.append(duvidaConceitoCard(d)));
    if (!erros.length) {
        const p = document.createElement('p');
        p.className = 'py-4 text-center text-[11px] text-faint';
        p.textContent = 'Sem falhas registadas. Boa!';
        boxE.append(p);
    } else erros.forEach((d) => boxE.append(duvidaErroLi(d)));
    atualizarBadgesExame();
}

function bindDuvidas() {
    const form = document.getElementById('exames-duvida-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const tipo = document.getElementById('exames-duvida-tipo').value;
        const disciplina = document.getElementById('exames-duvida-disc').value;
        const titulo = document.getElementById('exames-duvida-titulo').value.trim();
        const texto = document.getElementById('exames-duvida-texto').value.trim();
        if (!titulo || !texto) { miniToast('Preenche título e nota.'); return; }
        const all = exRead(DUVIDAS_KEY, []);
        const novo = { id: uid('duv'), tipo, disciplina, titulo, texto };
        all.unshift(novo);
        exWrite(DUVIDAS_KEY, all);
        if (tipo === 'erro' && window.ReviewSystem && typeof window.ReviewSystem.criarAPartirDeDuvida === 'function') {
            window.ReviewSystem.criarAPartirDeDuvida(novo);
        }
        form.reset();
        renderDuvidas();
        miniToast(tipo === 'erro' ? 'Falha guardada e agendada para revisão.' : 'Registo guardado.');
    });
}

/* ── Sub-separadores ── */
function mostrarTabExame(nome) {
    const ativa = EXAME_TABS.includes(nome) ? nome : 'foco';
    document.querySelectorAll('[data-exame-tab]').forEach((btn) => {
        btn.setAttribute('aria-selected', String(btn.dataset.exameTab === ativa));
    });
    document.querySelectorAll('[data-exame-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.examePanel !== ativa;
    });
    try {
        localStorage.setItem(EXAME_TAB_KEY, ativa);
    } catch { /* sem persistência: fica só na sessão */ }
}

function bindTabsExame() {
    document.querySelectorAll('[data-exame-tab]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => mostrarTabExame(btn.dataset.exameTab));
    });
}

function definirBadge(nome, texto) {
    const badge = document.querySelector(`[data-exame-badge="${nome}"]`);
    if (!badge) return;
    if (!texto) {
        badge.hidden = true;
        return;
    }
    badge.hidden = false;
    badge.textContent = texto;
}

function atualizarBadgesExame() {
    const recursos = exRead(RECURSOS_KEY, []).length;
    definirBadge('recursos', recursos ? String(recursos) : '');
    const track = exRead(TRACK_KEY, []);
    const pendentes = track.filter((r) => r.estado !== 'Concluído').length;
    definirBadge('track', pendentes ? String(pendentes) : '');
    const duvidas = exRead(DUVIDAS_KEY, []).length;
    definirBadge('duvidas', duvidas ? String(duvidas) : '');
}

/* ── Countdown + data-alvo editável ── */
function renderCountdown() {
    const el = document.getElementById('exames-countdown');
    const alvo = new Date(`${lerDataAlvo()}T09:30:00`);
    if (el) {
        const diff = Math.ceil((alvo - new Date()) / (1000 * 60 * 60 * 24));
        el.textContent = diff > 0 ? String(diff) : '0';
        el.title = diff > 0
            ? `1ª fase prevista: ${alvo.toLocaleDateString('pt-PT')}`
            : `Data já passou (${alvo.toLocaleDateString('pt-PT')}) — escolhe uma data futura.`;
    }
    const input = document.getElementById('exames-data');
    if (input && document.activeElement !== input) input.value = lerDataAlvo();
}

function bindDataAlvo() {
    const input = document.getElementById('exames-data');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
            miniToast('Escolhe uma data válida.');
            renderCountdown();
            return;
        }
        exWrite(EXAME_DATA_KEY, input.value);
        renderCountdown();
        if (window.GitHubSync?.configurado?.()) window.GitHubSync.sync(false).catch(() => {});
        miniToast('Data do exame atualizada.');
    });
}

/* ── API pública ── */
function lerTabGuardada() {
    try {
        const v = localStorage.getItem(EXAME_TAB_KEY);
        return EXAME_TABS.includes(v) ? v : 'foco';
    } catch {
        return 'foco';
    }
}

function ligar() {
    seedIfEmpty();
    renderFoco();
    renderRecursos();
    renderTrack();
    renderDuvidas();
    renderCountdown();
    mostrarTabExame(lerTabGuardada());
}

function bindOnce() {
    if (document.documentElement.dataset.examesBound) return;
    document.documentElement.dataset.examesBound = '1';
    bindTabsExame();
    bindDataAlvo();
    bindFoco();
    bindRecursos();
    bindTrack();
    bindDuvidas();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { seedIfEmpty(); bindOnce(); ligar(); });
} else {
    seedIfEmpty(); bindOnce(); ligar();
}

window.Exames = {
    ligar,
    lerDataAlvo,
    lerTudo() {
        return {
            foco: exRead(FOCO_KEY, {}),
            recursos: exRead(RECURSOS_KEY, []),
            track: exRead(TRACK_KEY, []),
            duvidas: exRead(DUVIDAS_KEY, []),
            dataAlvo: lerDataAlvo(),
        };
    },
    escreverTudo(d) {
        if (d.foco) exWrite(FOCO_KEY, d.foco);
        if (d.recursos) exWrite(RECURSOS_KEY, d.recursos);
        if (d.track) exWrite(TRACK_KEY, d.track);
        if (d.duvidas) exWrite(DUVIDAS_KEY, d.duvidas);
        if (typeof d.dataAlvo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.dataAlvo)) exWrite(EXAME_DATA_KEY, d.dataAlvo);
        ligar();
    },
};

})();
