/* StudyJournal — estado, interface e integração com o vault. */

const els = {
    date: document.getElementById('current-date'),
    dateShort: document.getElementById('current-date-short'),
    dayPrev: document.getElementById('day-prev'),
    dayNext: document.getElementById('day-next'),

    taskForm: document.getElementById('task-form'),
    taskInput: document.getElementById('task-input'),
    taskSubject: document.getElementById('task-subject'),
    taskCategory: document.getElementById('task-category'),
    taskList: document.getElementById('task-list'),
    taskEmpty: document.getElementById('task-empty'),
    clearDone: document.getElementById('clear-done'),
    progressLabel: document.getElementById('progress-label'),
    progressFill: document.getElementById('progress-fill'),

    notes: document.getElementById('journal-text'),
    wordCount: document.getElementById('word-count'),
    saveStatus: document.getElementById('save-status'),
    saveNotes: document.getElementById('save-notes'),

    vaultChip: document.getElementById('vault-chip'),
    vaultDot: document.getElementById('vault-dot'),
    vaultLabel: document.getElementById('vault-label'),

    toasts: document.getElementById('toasts'),

    calMonth: document.getElementById('cal-month'),
    calPrev: document.getElementById('cal-prev'),
    calNext: document.getElementById('cal-next'),
    calWeekdays: document.getElementById('cal-weekdays'),
    calGrid: document.getElementById('cal-grid'),

    subjectsList: document.getElementById('subjects-list'),
    subjectsDate: document.getElementById('subjects-date'),
    subjectsTotal: document.getElementById('subjects-total'),

    vaultStatus: document.getElementById('settings-vault-status'),
    vaultAction: document.getElementById('settings-vault-action'),
    vaultDisconnect: document.getElementById('settings-vault-disconnect'),
    stats: document.getElementById('settings-stats'),
    origin: document.getElementById('settings-origin'),
    exportData: document.getElementById('export-data'),
    importData: document.getElementById('import-data'),
    importInput: document.getElementById('import-input'),
    clearDay: document.getElementById('clear-day'),
};

const SUBJECTS = {
    'Geral': 'bg-surface-3 text-muted',
    'Matemática A': 'bg-subject-blue/15 text-subject-blue',
    'FQA': 'bg-subject-violet/15 text-subject-violet',
    'Biologia': 'bg-subject-green/15 text-subject-green',
    'Português': 'bg-subject-yellow/15 text-subject-yellow',
    'Aplicações Informáticas (A.I.)': 'bg-subject-cyan/15 text-subject-cyan',
};

const DEMO_TASKS = [
    { text: 'Leitura do capítulo 5', subject: 'Português', done: true },
    { text: 'Resolver exercícios 7 a 12', subject: 'Matemática A', done: true },
    { text: 'Esquema da mitose', subject: 'Biologia', done: false },
    { text: 'Integrais trigonométricas', subject: 'Matemática A', done: false },
    { text: 'Revisão do caderno de campo', subject: 'Biologia', done: false },
];

const DEMO_NOTES = `# Integrais Definidas
* Teorema Fundamental
* Área sob a curva
**Dúvida:** Como resolver integrais trigonométricas complexas?
[ ] Pesquisar exemplos online.`;

/* ── Sistema de Revisão e Estatísticas ───────────────── */

const ReviewSystem = {
    KEY: 'study-journal-reviews',
    KEY_V2: 'study-journal-reviews-v2',

    ler() {
        return read(this.KEY, {});
    },

    escrever(dados) {
        write(this.KEY, dados);
    },

    lerV2() {
        const lista = read(this.KEY_V2, null);
        if (Array.isArray(lista)) return lista;
        return this.migrar();
    },

    escreverV2(lista) {
        write(this.KEY_V2, lista);
    },

    uid() {
        return `rev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    },

    hojeChave() {
        return dayKey(new Date());
    },

    somarDias(chave, dias) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
        const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
        base.setDate(base.getDate() + dias);
        return dayKey(base);
    },

    migrar() {
        try {
            if (localStorage.getItem(this.KEY_V2) !== null) return read(this.KEY_V2, []);
        } catch { return []; }
        const antigo = this.ler();
        const hoje = this.hojeChave();
        const lista = Object.keys(antigo)
            .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
            .map((dia) => ({
                id: this.uid(), dia, titulo: `Nota de ${dia}`, texto: '',
                intervalo: 1, repeticoes: 0, ease: 2.5, proxima: hoje,
                criadaEm: new Date().toISOString(), origem: 'migracao-v1',
            }));
        this.escreverV2(lista);
        return lista;
    },

    marcar(dia, titulo = '') {
        const lista = this.lerV2();
        const amanha = this.somarDias(this.hojeChave(), 1);
        const atual = lista.find((c) => c.dia === dia && !c.origemId);
        if (atual) {
            atual.proxima = amanha;
            if (titulo && !atual.titulo) atual.titulo = titulo;
        } else {
            lista.unshift({
                id: this.uid(), dia, titulo: titulo || `Nota de ${dia}`, texto: '',
                intervalo: 1, repeticoes: 0, ease: 2.5, proxima: amanha,
                criadaEm: new Date().toISOString(), origem: 'nota',
            });
        }
        this.escreverV2(lista);
        return lista;
    },

    criarAPartirDeDuvida(duvida) {
        if (!duvida) return null;
        const lista = this.lerV2();
        if (duvida.id && lista.some((c) => c.origemId === duvida.id)) return lista;
        lista.unshift({
            id: this.uid(), dia: '', origemId: duvida.id || '',
            titulo: String(duvida.titulo || 'Dúvida').slice(0, 120),
            texto: `${duvida.disciplina || ''} — ${duvida.texto || ''}`.slice(0, 300),
            intervalo: 1, repeticoes: 0, ease: 2.5, proxima: this.hojeChave(),
            criadaEm: new Date().toISOString(), origem: 'duvida',
        });
        this.escreverV2(lista);
        return lista;
    },

    obterParaHoje() {
        const hoje = this.hojeChave();
        return this.lerV2()
            .filter((c) => (c.proxima || hoje) <= hoje)
            .sort((a, b) => String(a.proxima).localeCompare(String(b.proxima)));
    },

    responder(id, grade) {
        const lista = this.lerV2();
        const carta = lista.find((c) => c.id === id);
        if (!carta) return null;
        const g = Number(grade);
        if (g <= 0) {
            carta.repeticoes = 0;
            carta.intervalo = 1;
            carta.ease = Math.max(1.3, Number(carta.ease || 2.5) - 0.2);
        } else if (g === 1) {
            const atual = Number(carta.intervalo || 1);
            carta.intervalo = carta.repeticoes <= 0 ? 1 : carta.repeticoes === 1 ? 3 : Math.max(2, Math.round(atual * Number(carta.ease || 2.5) * 0.8));
            carta.repeticoes = Number(carta.repeticoes || 0) + 1;
        } else {
            const atual = Number(carta.intervalo || 1);
            if (carta.repeticoes <= 0) carta.intervalo = 1;
            else if (carta.repeticoes === 1) carta.intervalo = 3;
            else if (carta.repeticoes === 2) carta.intervalo = 7;
            else carta.intervalo = Math.max(2, Math.round(atual * Number(carta.ease || 2.5)));
            carta.repeticoes = Number(carta.repeticoes || 0) + 1;
            carta.ease = Math.min(2.8, Number(carta.ease || 2.5) + 0.08);
        }
        carta.proxima = this.somarDias(this.hojeChave(), carta.intervalo);
        carta.revistaEm = new Date().toISOString();
        this.escreverV2(lista);
        return carta;
    }
};

/* ── Sessões de Estudo ─────────────────────────────────── */

const SESSIONS_KEY = 'study-journal-sessions';

const StudySessions = {
    ler() {
        try {
            const raw = localStorage.getItem(SESSIONS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    },

    escrever(dados) {
        try {
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(dados));
            return true;
        } catch {
            return false;
        }
    },

    adicionarMinutos(subject, minutos, date = new Date()) {
        const key = dayKey(date);
        const dados = this.ler();
        if (!dados[key]) dados[key] = {};
        dados[key][subject] = (dados[key][subject] || 0) + minutos;
        this.escrever(dados);
    },

    obterDoDia(date) {
        const key = dayKey(date);
        const dados = this.ler();
        return dados[key] || {};
    },

    obterSemana(weekStart) {
        const dados = this.ler();
        const resultado = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const key = dayKey(d);
            const dia = dados[key];
            if (dia) {
                Object.entries(dia).forEach(([subject, min]) => {
                    resultado[subject] = (resultado[subject] || 0) + min;
                });
            }
        }
        return resultado;
    },

    obterTotal() {
        const dados = this.ler();
        const resultado = {};
        Object.values(dados).forEach(dia => {
            Object.entries(dia).forEach(([subject, min]) => {
                resultado[subject] = (resultado[subject] || 0) + min;
            });
        });
        return resultado;
    },

    formatar(minutos) {
        if (minutos >= 60) {
            const h = Math.floor(minutos / 60);
            const m = minutos % 60;
            return m ? `${h}h ${m}m` : `${h}h`;
        }
        return `${minutos}m`;
    },

    getSubjectsWithTime(date) {
        const dia = this.obterDoDia(date);
        return Object.entries(dia)
            .map(([subject, min]) => ({ subject, minutos: min }))
            .sort((a, b) => b.minutos - a.minutos);
    }
};

const HEATMAP_MINUTOS_POR_TAREFA = 3;
const HEATMAP_NIVEIS = [150, 90, 40];
let historicoMinutosOk = false;

function migrarHistoricoMinutos() {
    if (historicoMinutosOk) return;
    historicoMinutosOk = true;
    try {
        if (localStorage.getItem('study-journal-pomodoro-history-v2')) return;
        const history = read(POMODORO_HISTORY_KEY, {});
        Object.keys(history).forEach((k) => {
            const sessoes = Math.max(0, Math.round(Number(history[k] || 0)));
            history[k] = sessoes * 25;
        });
        write(POMODORO_HISTORY_KEY, history);
        localStorage.setItem('study-journal-pomodoro-history-v2', '1');
    } catch { /* sem migração: o heatmap usa os valores como estão */ }
}

function lerEsforcoDoDia(date) {
    migrarHistoricoMinutos();
    const key = dayKey(date);
    const history = read(POMODORO_HISTORY_KEY, {});
    const foco = Math.max(0, Number(history[key] || 0));
    const tasks = read(`study-journal-tasks-${key}`, []);
    const concluidas = tasks.filter((t) => t.done).length;
    const sessoes = StudySessions.obterDoDia(date);
    const sessaoTotal = Object.values(sessoes).reduce((a, b) => a + b, 0);
    return { foco, concluidas, sessoes: sessaoTotal, total: foco + concluidas * HEATMAP_MINUTOS_POR_TAREFA + sessaoTotal };
}

/* ── Sequência de estudos (streak) ──────────────────────── */

const STREAK_MAX_DIAS = 730;

function diaComAtividade(date) {
    if (lerEsforcoDoDia(date).total > 0) return true;
    try {
        return read(`study-journal-notes-${dayKey(date)}`, '').trim() !== '';
    } catch {
        return false;
    }
}

/* Dias consecutivos com estudo até hoje (se hoje ainda não tem
   atividade, começa ontem) + recorde na janela visível. */
function calcularSequencia() {
    const cursor = new Date(today);
    if (!diaComAtividade(cursor)) cursor.setDate(cursor.getDate() - 1);

    let dias = 0;
    for (let i = 0; i < STREAK_MAX_DIAS; i += 1) {
        const d = new Date(cursor);
        d.setDate(d.getDate() - i);
        if (!diaComAtividade(d)) break;
        dias += 1;
    }

    let recorde = dias, seq = 0;
    for (let i = 0; i < STREAK_MAX_DIAS; i += 1) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        if (diaComAtividade(d)) {
            seq += 1;
            if (seq > recorde) recorde = seq;
        } else {
            seq = 0;
        }
    }

    return { dias, recorde };
}

function renderStreak() {
    const num = document.getElementById('streak-num');
    if (!num) return;
    const { dias, recorde } = calcularSequencia();
    num.textContent = String(dias);
    const best = document.getElementById('streak-best');
    if (best) {
        best.textContent = recorde > 0
            ? `recorde: ${recorde} ${recorde === 1 ? 'dia' : 'dias'}`
            : 'começa hoje 🔥';
    }
}

const StudyStats = {
    calcularAtividade(date) {
        return lerEsforcoDoDia(date).total;
    },

    renderHeatmap() {
        const grid = document.getElementById('heatmap');
        if (!grid) return;

        // Não deixa avançar além do mês atual
        const mesAtual = new Date(today.getFullYear(), today.getMonth(), 1);
        if (heatmapCursor > mesAtual) heatmapCursor = new Date(mesAtual);

        const monthEl = document.getElementById('heatmap-month');
        if (monthEl) {
            monthEl.textContent = heatmapCursor.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
        }
        const nextBtn = document.getElementById('heatmap-next');
        if (nextBtn) nextBtn.disabled = heatmapCursor >= mesAtual;

        const weekEl = document.getElementById('heatmap-weekdays');
        if (weekEl && !weekEl.childElementCount) {
            ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].forEach((l) => {
                const d = document.createElement('div');
                d.textContent = l;
                weekEl.append(d);
            });
        }

        grid.replaceChildren();

        const ano = heatmapCursor.getFullYear();
        const mes = heatmapCursor.getMonth();
        // Semana começa à segunda
        const offset = (new Date(ano, mes, 1).getDay() + 6) % 7;
        const diasNoMes = new Date(ano, mes + 1, 0).getDate();

        for (let i = 0; i < offset; i += 1) grid.append(document.createElement('div'));

        for (let dia = 1; dia <= diasNoMes; dia += 1) {
            const data = new Date(ano, mes, dia);
            const futuro = startOfDay(data) > today;
            const esforco = futuro ? { foco: 0, concluidas: 0, total: 0 } : lerEsforcoDoDia(data);
            const score = esforco.total;

            let nivel = 0;
            if (!futuro) {
                if (score >= HEATMAP_NIVEIS[0]) nivel = 4;
                else if (score >= HEATMAP_NIVEIS[1]) nivel = 3;
                else if (score >= HEATMAP_NIVEIS[2]) nivel = 2;
                else if (score > 0) nivel = 1;
            }

            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'heatmap-day';
            cell.dataset.n = String(nivel);
            cell.style.backgroundColor = `var(--color-heatmap-${nivel})`;
            cell.title = `${data.toLocaleDateString('pt-PT')}: ${esforco.foco} min de foco${esforco.concluidas ? ` · ${esforco.concluidas} ${esforco.concluidas === 1 ? 'tarefa concluída' : 'tarefas concluídas'}` : ''}${esforco.sessoes ? ` · ${esforco.sessoes} min de sessão` : ''}`;
            if (startOfDay(data).getTime() === today.getTime()) cell.dataset.hoje = 'true';

            const num = document.createElement('span');
            num.textContent = String(dia);
            cell.append(num);

            if (futuro) {
                cell.disabled = true;
            } else {
                cell.setAttribute('aria-label', `Abrir dia ${data.toLocaleDateString('pt-PT')}`);
                cell.addEventListener('click', () => openDay(data));
            }

            grid.append(cell);
        }
    },

    renderReviewQueue() {
        const queue = document.getElementById('review-queue');
        if (!queue) return;
        queue.replaceChildren();

        const vencidas = ReviewSystem.obterParaHoje();
        if (vencidas.length === 0) {
            queue.innerHTML = '<p class="text-xs text-center py-4 text-faint">Tudo em dia! 🎉</p>';
            return;
        }

        const info = document.createElement('p');
        info.className = 'text-[11px] text-faint';
        info.textContent = `${vencidas.length} ${vencidas.length === 1 ? 'carta vencida' : 'cartas vencidas'} · intervalos 1-3-7-14-30 dias`;
        queue.append(info);

        vencidas.slice(0, 6).forEach((carta) => {
            const item = document.createElement('div');
            item.className = 'review-item flex flex-col gap-1.5 rounded-xl border border-line-soft bg-surface-2 p-2.5';

            const top = document.createElement('div');
            top.className = 'flex items-center gap-2';
            const titulo = document.createElement('span');
            titulo.className = 'min-w-0 flex-1 truncate text-xs font-medium text-fg';
            titulo.textContent = carta.titulo || (carta.dia ? `Nota de ${carta.dia}` : 'Revisão');
            titulo.title = titulo.textContent;
            const quando = document.createElement('span');
            quando.className = 'shrink-0 text-[10px] tabular-nums text-faint';
            quando.textContent = carta.dia || `x${carta.intervalo || 1}`;
            top.append(titulo, quando);

            const texto = document.createElement('p');
            texto.className = 'line-clamp-2 text-[11px] leading-relaxed text-muted';
            texto.textContent = carta.texto || (carta.dia ? `Rever notas de ${carta.dia}` : '');

            const acoes = document.createElement('div');
            acoes.className = 'flex flex-wrap gap-1.5';
            if (carta.dia) {
                const abrir = document.createElement('button');
                abrir.type = 'button';
                abrir.className = 'btn-soft px-2 py-0.5 text-[10px]';
                abrir.textContent = 'Abrir';
                abrir.addEventListener('click', () => abrirDiaChave(carta.dia));
                acoes.append(abrir);
            }
            [['0', 'Falhei'], ['1', 'Quase'], ['2', 'Lembrei']].forEach(([grade, rotulo]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = grade === '2' ? 'btn-mint px-2 py-0.5 text-[10px]' : 'btn-soft px-2 py-0.5 text-[10px]';
                b.textContent = rotulo;
                b.addEventListener('click', () => {
                    ReviewSystem.responder(carta.id, grade);
                    StudyStats.renderReviewQueue();
                    if (grade === '2') toast('Boa! Próxima dentro de alguns dias.', 'success');
                });
                acoes.append(b);
            });

            item.append(top);
            if ((carta.texto || '').trim()) item.append(texto);
            item.append(acoes);
            queue.append(item);
        });

        if (vencidas.length > 6) {
            const mais = document.createElement('button');
            mais.type = 'button';
            mais.className = 'text-center text-[11px] text-muted transition hover:text-fg';
            mais.textContent = `Ver restantes no modo Estudar (${vencidas.length - 6} mais)`;
            mais.addEventListener('click', abrirReviewFocus);
            queue.append(mais);
        }
    }
};

/* ── Datas ────────────────────────────────────────────── */

function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
}

function dayKey(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const today = startOfDay(new Date());
let selected = today;
let tasks = [];
let currentView = 'painel';
let lastVaultState = 'desligado';

/* ── Persistência local ────────────────────────────────── */

function read(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        toast('Não foi possível guardar no browser.', 'error');
        return false;
    }
}

const notesKey = () => `study-journal-notes-${dayKey(selected)}`;
const tasksKey = () => `study-journal-tasks-${dayKey(selected)}`;

/* ── Toasts ───────────────────────────────────────────── */

const TOAST_STYLES = {
    info: 'border-line bg-surface-2 text-fg',
    success: 'border-mint/40 bg-surface-2 text-fg',
    warn: 'border-subject-yellow/40 bg-surface-2 text-fg',
    error: 'border-subject-rose/40 bg-surface-2 text-fg',
};

const TOAST_DOTS = {
    info: 'bg-brand-light',
    success: 'bg-mint',
    warn: 'bg-subject-yellow',
    error: 'bg-subject-rose',
};

function toast(message, type = 'info', { timeout = 4000 } = {}) {
    const node = document.createElement('div');
    node.className = `toast pointer-events-auto flex items-start gap-2.5 glass-strong rounded-xl border border-line-soft px-4 py-3 text-sm shadow-pop ${TOAST_STYLES[type]}`;

    const dot = document.createElement('span');
    dot.className = `mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TOAST_DOTS[type]}`;

    const text = document.createElement('span');
    text.className = 'flex-1';
    text.textContent = message;

    node.append(dot, text);
    node.addEventListener('click', () => node.remove());
    els.toasts.append(node);

    if (timeout) setTimeout(() => node.remove(), timeout);
    return node;
}

/* ── Sync entre aparelhos ───────────────────────────────
   Conta única do servidor quando há login, senão o GitHub Gist. */

function sincronizarDispositivos() {
    if (window.ContaSync && window.ContaSync.configurado()) {
        window.ContaSync.push().catch(() => {});
        return;
    }
    if (window.GitHubSync && window.GitHubSync.configurado && window.GitHubSync.configurado()) {
        window.GitHubSync.sync(false).catch(() => {});
    }
}

/* Re-renderiza o dia atual a partir do localStorage (após pull).
   Não toca na caixa de notas enquanto estiver focada. */
function recarregarAposSync() {
    tasks = read(tasksKey(), []);
    renderTasks();

    const notasFocadas = document.activeElement === els.notes;
    if (!notasFocadas) {
        els.notes.value = read(notesKey(), '');
        els.wordCount.textContent = String(countWords(els.notes.value));
        if (window.NotasPro) window.NotasPro.renderTagsNota();
        const vista = document.getElementById('notes-preview');
        if (vista && !vista.hidden && window.NotasPro) {
            vista.innerHTML = window.NotasPro.renderMarkdownLite(els.notes.value)
                || '<p class="text-xs text-faint">Nada para pré-visualizar.</p>';
        }
    }

    renderStreak();
    StudyStats.renderHeatmap();
    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'disciplinas') renderSubjects();
    if (currentView === 'estudar') renderEstudarView();
    if (currentView === 'definicoes') renderSettings();
    if (currentView === 'exames' && window.Exames) window.Exames.ligar();
    if (currentView === 'semanal' && window.Weekly) window.Weekly.ligar();

    return !notasFocadas;
}

/* ── Tarefas ──────────────────────────────────────────── */

async function setTaskDone(id, done) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    task.done = done;
    await syncTasks();
    renderTasks();
    renderStreak();

    if (currentView === 'disciplinas') renderSubjects();
}

/* O tasks.json do vault guarda um mapa { 'AAAA-MM-DD': [...] } para não
   apagar os outros dias. Ficheiros antigos com um array simples são lidos
   como sendo do dia atual e migrados na próxima gravação. */
function tasksDeConteudoVault(content, chave) {
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed[chave])) return parsed[chave];
    } catch { /* formato inválido: usa-se o local */ }
    return null;
}

async function syncTasks() {
    let saved = null;
    try {
        let mapa = {};
        try {
            const atual = await Vault.load('tasks.json');
            if (atual.ok && atual.existe) {
                const parsed = JSON.parse(atual.content);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mapa = parsed;
            }
        } catch { /* sem mapa anterior: grava só este dia */ }
        mapa[dayKey(selected)] = tasks;
        saved = await Vault.save('tasks.json', JSON.stringify(mapa));
        if (saved && !saved.ok && saved.reason === 'conflito') {
            // O ficheiro mudou fora da app (ex.: editado no Obsidian):
            // esta versão é a mais fresca, grava por cima e avisa.
            saved = await Vault.save('tasks.json', JSON.stringify(tasks), { force: true });
            if (saved && saved.ok) toast('Vault atualizado com a versão deste browser.', 'info');
        }
    } catch (e) {
        console.error('Erro ao sincronizar tarefas:', e);
    }
    if (saved && !saved.ok) {
        toast('Não foi possível gravar no vault — as tarefas ficaram só neste browser.', 'warn');
    }
    write(tasksKey(), tasks);
}

function renderTasks() {
    els.taskList.replaceChildren();
    els.taskEmpty.classList.toggle('hidden', tasks.length > 0);

    tasks.forEach((task) => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.done;
        checkbox.ariaLabel = `Marcar "${task.text}" como concluída`;
        checkbox.className = 'task-check h-4 w-4 shrink-0 cursor-pointer accent-brand transition';
        checkbox.addEventListener('change', async () => await setTaskDone(task.id, checkbox.checked));

        const text = document.createElement('span');
        text.textContent = task.text;
        text.className = task.done
            ? 'flex-1 text-sm text-faint line-through transition'
            : 'flex-1 text-sm text-fg transition';

        const chip = document.createElement('span');
        chip.className = `chip ${SUBJECTS[task.subject] ?? SUBJECTS['Geral']}`;
        chip.textContent = task.subject;

        const catPainel = categoriaDaTarefa(task);
        const corPainel = CATEGORIA_CORES[catPainel] || CATEGORIA_CORES.tarefa;
        const chipCat = document.createElement('span');
        chipCat.className = 'chip';
        chipCat.style.background = corPainel.bg;
        chipCat.style.color = corPainel.text;
        chipCat.style.border = `1px solid ${corPainel.border}`;
        chipCat.textContent = CATEGORIA_NOMES[catPainel] || catPainel;

        const chipsRow = document.createElement('div');
        chipsRow.className = 'flex flex-wrap gap-1.5';
        chipsRow.append(chip, chipCat);

        const body = document.createElement('div');
        body.className = 'flex min-w-0 flex-1 flex-col gap-1.5';
        const line = document.createElement('div');
        line.className = 'flex items-start gap-2.5';
        line.append(checkbox, text);
        body.append(line, chipsRow);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.ariaLabel = `Apagar tarefa: ${task.text}`;
        remove.innerHTML = '<svg class="icon h-4 w-4"><use href="#i-trash"/></svg>';
        remove.className = 'task-remove shrink-0 rounded-lg p-1 text-faint opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-subject-rose focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-subject-rose';
        remove.addEventListener('click', async () => {
            tasks = tasks.filter((t) => t.id !== task.id);
            await syncTasks();
            renderTasks();
            sincronizarDispositivos();
        });

        const li = document.createElement('li');
        li.className = 'task-item group flex items-start gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition hover:border-line';
        li.append(body, remove);
        els.taskList.append(li);
    });

    renderProgress();
}

function renderProgress() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    els.progressFill.style.width = `${pct}%`;
    els.progressLabel.textContent = total
        ? `${done} de ${total} ${total === 1 ? 'tarefa concluída' : 'tarefas concluídas'} · ${pct}%`
        : 'Sem tarefas para este dia';

    if (els.clearDone) {
        els.clearDone.classList.toggle('hidden', done === 0);
        els.clearDone.classList.toggle('inline-flex', done > 0);
    }
}

async function addTask(text, subject, category = 'tarefa') {
    tasks.push({ id: `${Date.now()}-${tasks.length}`, text, subject, category, done: false });
    await syncTasks();
    renderTasks();
    sincronizarDispositivos();
}

const CATEGORIA_CORES = {
    teste: { bg: 'rgba(251, 113, 133, 0.22)', border: '#fb7185', text: '#fda4af' },
    tarefa: { bg: 'rgba(74, 222, 128, 0.15)', border: '#4ade80', text: '#86efac' },
    estudo: { bg: 'rgba(129, 140, 248, 0.18)', border: '#818cf8', text: '#a5b4fc' },
};

const CATEGORIA_NOMES = { teste: 'Teste', tarefa: 'Tarefa', estudo: 'Estudo' };

/* Tarefas antigas não têm `category`: infere pelo texto para
   QA-Matematica / Teste-A.I existentes aparecerem a vermelho. */
function categoriaDaTarefa(task) {
    if (task && task.category) return task.category;
    const texto = (task && task.text) || '';
    if (/teste|\bqa[-\s]|\bexame|\bavalia|\bprova|\bfrequência|\bmini[-\s]?teste/i.test(texto)) return 'teste';
    if (/revis|\bestud|\bresum|\btrein/i.test(texto)) return 'estudo';
    return 'tarefa';
}

/* Remove os blocos de revisão gerados automaticamente (ids `estudo-…`).
   As tarefas de estudo criadas manualmente têm outro formato de id e ficam. */
function limparBlocosEstudoGerados() {
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('study-journal-tasks-')) continue;
            const tarefas = read(k, []);
            const filtradas = tarefas.filter((t) => !(t && typeof t.id === 'string' && t.id.startsWith('estudo-')));
            if (filtradas.length !== tarefas.length) write(k, filtradas);
        }
    } catch { /* nunca parte o arranque */ }
}

async function clearDone() {
    const done = tasks.filter((t) => t.done).length;
    if (!done) return;

    tasks = tasks.filter((t) => !t.done);
    await syncTasks();
    renderTasks();

    toast(done === 1 ? 'Tarefa concluída apagada.' : `${done} tarefas concluídas apagadas.`, 'success');
    sincronizarDispositivos();
}

/* ── Notas ────────────────────────────────────────────── */

let saveTimer = null;

function countWords(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

function setSaveStatus(message) {
    els.saveStatus.textContent = message;
}

function commitNotes() {
    clearTimeout(saveTimer);
    saveTimer = null;

    const text = els.notes.value;
    if (!write(notesKey(), text)) return;

    const time = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    setSaveStatus(`guardado às ${time}`);

    sincronizarDispositivos();
    StudyStats.renderHeatmap();
    renderStreak();
}

/* Anexa texto às notas de hoje (usado pelo visualizador de PDFs). */
function adicionarANotas(texto) {
    if (!texto || !texto.trim()) return false;
    const bloco = texto.trim();
    try {
        if (dayKey(selected) === dayKey(today)) {
            const base = els.notes.value.replace(/\s+$/, '');
            els.notes.value = base ? `${base}\n${bloco}\n` : `${bloco}\n`;
            onNotesInput();
        } else {
            const chaveHoje = `study-journal-notes-${dayKey(today)}`;
            const base = read(chaveHoje, '').replace(/\s+$/, '');
            write(chaveHoje, base ? `${base}\n${bloco}\n` : `${bloco}\n`);
            toast('Guardado nas notas de hoje.', 'success');
        }
        renderStreak();
        return true;
    } catch {
        return false;
    }
}

function onNotesInput() {
    els.wordCount.textContent = String(countWords(els.notes.value));
    setSaveStatus('a guardar…');

    const vista = document.getElementById('notes-preview');
    if (vista && !vista.hidden && window.NotasPro) {
        vista.innerHTML = window.NotasPro.renderMarkdownLite(els.notes.value) || '<p class="text-xs text-faint">Nada para pré-visualizar.</p>';
    }

    clearTimeout(saveTimer);
    saveTimer = setTimeout(commitNotes, 800);
}

/* ── Toolbar Markdown ─────────────────────────────────── */

function replaceRange(before, after) {
    const { selectionStart: start, selectionEnd: end, value } = els.notes;
    const selected = value.slice(start, end);

    els.notes.value = value.slice(0, start) + before + selected + after + value.slice(end);
    els.notes.focus();
    els.notes.setSelectionRange(start + before.length, end + before.length);
    onNotesInput();
}

function toggleList() {
    const { selectionStart: start, selectionEnd: end, value } = els.notes;

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndRaw = value.indexOf('\n', end);
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;

    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const filled = lines.filter((l) => l.trim());
    const alreadyList = filled.length > 0 && filled.every((l) => /^\s*[-*]\s/.test(l));

    const updated = lines
        .map((l) => {
            if (!l.trim()) return l;
            return alreadyList ? l.replace(/^(\s*)[-*]\s+/, '$1') : `- ${l}`;
        })
        .join('\n');

    els.notes.value = value.slice(0, lineStart) + updated + value.slice(lineEnd);
    els.notes.focus();
    els.notes.setSelectionRange(lineStart, lineStart + updated.length);
    onNotesInput();
}

function applyMarkdown(kind) {
    if (kind === 'bold') replaceRange('**', '**');
    else if (kind === 'italic') replaceRange('_', '_');
    else if (kind === 'code') replaceRange('`', '`');
    else if (kind === 'list') toggleList();
}

/* ── Pomodoro (legado) ────────────────────────────────────
   O temporizador pomodoro foi substituído pela Sessão de Estudo.
   Fica só a chave do histórico, que o heatmap ainda lê. */
const POMODORO_HISTORY_KEY = 'study-journal-pomodoro-history';

/* ── Alarme ──────────────────────────────────────────── */

let audioContext = null;

const ALARM_TONE = [
    [0.00, 0.16, 880],
    [0.26, 0.16, 880],
    [0.58, 0.16, 660],
    [0.84, 0.16, 660],
    [1.20, 0.40, 880],
    [1.78, 0.40, 660],
];

function unlockAlarm() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => { /* sem gesto o browser bloqueia */ });

    return audioContext;
}

function playAlarm() {
    const context = unlockAlarm();
    if (!context) return;

    const schedule = () => {
        const start = context.currentTime + 0.05;

        ALARM_TONE.forEach(([offset, duration, frequency]) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const at = start + offset;

            oscillator.type = 'square';
            oscillator.frequency.value = frequency;

            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.18, at + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

            oscillator.connect(gain).connect(context.destination);
            oscillator.start(at);
            oscillator.stop(at + duration + 0.02);
        });
    };

    if (context.state === 'running') schedule();
    else context.resume().then(schedule).catch(() => { /* sem gesto o browser bloqueia */ });
}

/* ── Sessão de Estudo (Timer) ───────────────────────────── */

const sessionTimer = {
    minutes: 25,
    remaining: 25 * 60,
    running: false,
    timer: null,
    deadline: null,
    subject: 'Matemática A',
};

const SESSION_PRESETS = [25, 50, 90];

function formatSessionClock(total) {
    const safe = Math.max(0, Math.ceil(total));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderSessionTimer() {
    const timeEl = document.getElementById('session-time');
    const startBtn = document.getElementById('session-start');
    const pauseBtn = document.getElementById('session-pause');
    const stopBtn = document.getElementById('session-stop');
    const startIcon = document.getElementById('session-start-icon');
    const startText = document.getElementById('session-start-text');
    const summaryEl = document.getElementById('session-today-summary');

    if (!timeEl) return;

    timeEl.textContent = formatSessionClock(sessionTimer.remaining);

    if (sessionTimer.running) {
        startBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
        stopBtn.classList.remove('hidden');
        startIcon.setAttribute('href', '#i-pause');
        startText.textContent = 'Continuar';
    } else {
        startBtn.classList.remove('hidden');
        pauseBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
        startIcon.setAttribute('href', '#i-play');
        startText.textContent = sessionTimer.remaining < sessionTimer.minutes * 60 ? 'Continuar' : 'Iniciar';
    }

    document.querySelectorAll('[data-session-preset]').forEach(btn => {
        const selected = Number(btn.dataset.sessionPreset) === sessionTimer.minutes;
        btn.classList.toggle('btn-mint', selected);
        btn.classList.toggle('btn-ghost', !selected);
        btn.classList.toggle('text-white', selected);
    });

    // Show today's summary for selected subject
    const hoje = StudySessions.obterDoDia(new Date());
    const subjMin = hoje[sessionTimer.subject] || 0;
    if (subjMin > 0) {
        summaryEl.textContent = `Hoje: ${StudySessions.formatar(subjMin)} em ${sessionTimer.subject}`;
        summaryEl.classList.remove('hidden');
    } else {
        summaryEl.classList.add('hidden');
    }
}

function startSessionTimer() {
    if (sessionTimer.timer) clearInterval(sessionTimer.timer);
    if (!(sessionTimer.remaining > 0)) sessionTimer.remaining = sessionTimer.minutes * 60;
    sessionTimer.deadline = Date.now() + sessionTimer.remaining * 1000;
    sessionTimer.timer = setInterval(tickSessionTimer, 250);
    sessionTimer.running = true;
    renderSessionTimer();
}

function stopSessionTimer() {
    if (sessionTimer.timer) clearInterval(sessionTimer.timer);
    sessionTimer.timer = null;
    if (sessionTimer.running && sessionTimer.deadline) {
        sessionTimer.remaining = Math.max(0, Math.ceil((sessionTimer.deadline - Date.now()) / 1000));
    }
    sessionTimer.deadline = null;
    sessionTimer.running = false;
    renderSessionTimer();
}

function tickSessionTimer() {
    if (!sessionTimer.deadline) return;
    const restam = Math.max(0, Math.ceil((sessionTimer.deadline - Date.now()) / 1000));

    if (restam <= 0) {
        sessionTimer.remaining = 0;
        renderSessionTimer();
        if (currentView === 'estudar') renderEstudarView();
        stopSessionTimer();
        playAlarm();
        concluirSessao();
        return;
    }

    if (restam === sessionTimer.remaining) return;
    sessionTimer.remaining = restam;
    renderSessionTimer();
    if (currentView === 'estudar') renderEstudarView();
}

function concluirSessao() {
    const minutosCompletos = sessionTimer.minutes;
    StudySessions.adicionarMinutos(sessionTimer.subject, minutosCompletos);
    toast(`Sessão de ${minutosCompletos} min concluída em ${sessionTimer.subject}!`, 'success');
    StudyStats.renderHeatmap();
    renderStreak();
    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'disciplinas') renderSubjects();
    if (currentView === 'estudar') renderEstudarView();
    sessionTimer.remaining = sessionTimer.minutes * 60;
    renderSessionTimer();
}

function setSessionMinutes(minutes) {
    if (!SESSION_PRESETS.includes(minutes)) return;
    if (minutes === sessionTimer.minutes && !sessionTimer.running) {
        sessionTimer.minutes = minutes;
        sessionTimer.remaining = minutes * 60;
        renderSessionTimer();
        return;
    }

    const wasRunning = sessionTimer.running;
    stopSessionTimer();
    sessionTimer.minutes = minutes;
    sessionTimer.remaining = minutes * 60;

    if (wasRunning) startSessionTimer();
    else renderSessionTimer();
}

function toggleSessionTimer() {
    if (sessionTimer.running) {
        stopSessionTimer();
        return;
    }
    startSessionTimer();
}

function setSessionSubject(subject) {
    sessionTimer.subject = subject;
    renderSessionTimer();
}

function renderEstudarView() {
    // Sync subject selector with session timer
    const subjectSelect = document.getElementById('estudar-subject');
    if (subjectSelect) {
        subjectSelect.value = sessionTimer.subject;
    }

    // Render timer
    const timerEl = document.getElementById('estudar-timer');
    const startBtn = document.getElementById('estudar-start');
    const pauseBtn = document.getElementById('estudar-pause');
    const stopBtn = document.getElementById('estudar-stop');
    const startIcon = document.getElementById('estudar-start-icon');
    const startText = document.getElementById('estudar-start-text');

    if (timerEl) {
        timerEl.textContent = formatSessionClock(sessionTimer.remaining);

        if (sessionTimer.running) {
            startBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            stopBtn.classList.remove('hidden');
            startIcon.setAttribute('href', '#i-pause');
            startText.textContent = 'Continuar';
        } else {
            startBtn.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
            stopBtn.classList.add('hidden');
            startIcon.setAttribute('href', '#i-play');
            startText.textContent = sessionTimer.remaining < sessionTimer.minutes * 60 ? 'Continuar' : 'Iniciar';
        }
    }

    // Preset buttons
    document.querySelectorAll('[data-estudar-preset]').forEach(btn => {
        const selected = Number(btn.dataset.estudarPreset) === sessionTimer.minutes;
        btn.classList.toggle('btn-mint', selected);
        btn.classList.toggle('btn-ghost', !selected);
        btn.classList.toggle('text-white', selected);
    });

    // Hoje
    const hoje = StudySessions.obterDoDia(new Date());
    const hojeList = document.getElementById('estudar-hoje-list');
    const hojeTotal = document.getElementById('estudar-hoje-total');
    const hojeTotalMin = Object.values(hoje).reduce((a, b) => a + b, 0);
    if (hojeTotal) hojeTotal.textContent = StudySessions.formatar(hojeTotalMin);
    if (hojeList) {
        if (Object.keys(hoje).length === 0) {
            hojeList.innerHTML = '<p class="text-center text-muted py-4">Sem sessões hoje</p>';
        } else {
            hojeList.innerHTML = Object.entries(hoje)
                .sort((a, b) => b[1] - a[1])
                .map(([subject, min]) => {
                    const colorClass = SUBJECTS[subject] ?? SUBJECTS['Geral'];
                    return `<div class="flex items-center justify-between gap-2">
                        <span class="chip ${colorClass} text-xs">${subject}</span>
                        <span class="font-mono tabular-nums text-fg">${StudySessions.formatar(min)}</span>
                    </div>`;
                }).join('');
        }
    }

    // Esta Semana
    const semanaInicio = new Date();
    semanaInicio.setDate(semanaInicio.getDate() - semanaInicio.getDay() + (semanaInicio.getDay() === 0 ? -6 : 1));
    semanaInicio.setHours(0, 0, 0, 0);
    const semana = StudySessions.obterSemana(semanaInicio);
    const semanaList = document.getElementById('estudar-semana-list');
    const semanaTotal = document.getElementById('estudar-semana-total');
    const semanaTotalMin = Object.values(semana).reduce((a, b) => a + b, 0);
    if (semanaTotal) semanaTotal.textContent = StudySessions.formatar(semanaTotalMin);
    if (semanaList) {
        if (Object.keys(semana).length === 0) {
            semanaList.innerHTML = '<p class="text-center text-muted py-4">Sem sessões esta semana</p>';
        } else {
            semanaList.innerHTML = Object.entries(semana)
                .sort((a, b) => b[1] - a[1])
                .map(([subject, min]) => {
                    const colorClass = SUBJECTS[subject] ?? SUBJECTS['Geral'];
                    return `<div class="flex items-center justify-between gap-2">
                        <span class="chip ${colorClass} text-xs">${subject}</span>
                        <span class="font-mono tabular-nums text-fg">${StudySessions.formatar(min)}</span>
                    </div>`;
                }).join('');
        }
    }

    // Total Geral
    const total = StudySessions.obterTotal();
    const totalList = document.getElementById('estudar-total-list');
    const totalGeral = document.getElementById('estudar-total-geral');
    const totalGeralMin = Object.values(total).reduce((a, b) => a + b, 0);
    if (totalGeral) totalGeral.textContent = StudySessions.formatar(totalGeralMin);
    if (totalList) {
        if (Object.keys(total).length === 0) {
            totalList.innerHTML = '<p class="text-center text-muted py-4">Sem registos</p>';
        } else {
            totalList.innerHTML = Object.entries(total)
                .sort((a, b) => b[1] - a[1])
                .map(([subject, min]) => {
                    const colorClass = SUBJECTS[subject] ?? SUBJECTS['Geral'];
                    return `<div class="flex items-center justify-between gap-2">
                        <span class="chip ${colorClass} text-xs">${subject}</span>
                        <span class="font-mono tabular-nums text-fg">${StudySessions.formatar(min)}</span>
                    </div>`;
                }).join('');
        }
    }
}

/* ── Vault (Obsidian) ─────────────────────────────────── */

const VAULT_LABELS = {
    incompativel: 'Vault: precisa de localhost',
    desligado: 'Ligar vault ao Obsidian',
    permissao: 'Reconectar vault',
    ligado: 'Vault ligado',
};

const VAULT_DOTS = {
    incompativel: 'bg-subject-rose',
    desligado: 'bg-faint',
    permissao: 'bg-subject-yellow',
    ligado: 'bg-mint',
};

function renderVault(state) {
    lastVaultState = state;
    els.vaultLabel.textContent = VAULT_LABELS[state];
    els.vaultDot.className = `h-1.5 w-1.5 rounded-full ${VAULT_DOTS[state]}`;

    if (currentView === 'definicoes') renderSettings();
}

async function refreshVault() {
    renderVault(await Vault.status());
}

async function ensureVault() {
    const state = await Vault.status();

    if (state === 'ligado') return true;

    if (state === 'permissao') {
        const result = await Vault.requestPermission();
        if (result.ok) {
            renderVault('ligado');
            syncDayFromVault();
            return true;
        }
    }

    if (state === 'desligado' || state === 'permissao') {
        const result = await Vault.connect();
        if (result.ok) {
            renderVault('ligado');
            syncDayFromVault();
            return true;
        }
        if (result.reason === 'cancelado') return false;
        toast('Não foi possível aceder ao vault.', 'error');
        return false;
    }

    toast('A File System Access API só funciona em localhost ou HTTPS — corre `npm start`.', 'error');
    return false;
}

function showConflict({ name, path, current }, retry) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm';

    const card = document.createElement('div');
    card.className = 'flex w-full max-w-lg flex-col gap-4 glass-strong rounded-2xl border border-line bg-surface p-5 shadow-pop';

    const title = document.createElement('h3');
    title.className = 'text-base font-semibold';
    title.textContent = 'O Obsidian alterou este ficheiro';

    const message = document.createElement('p');
    message.className = 'text-sm text-muted';
    message.textContent = `O conteúdo de ${path} mudou desde o último guardado aqui. Podes trazer a versão do Obsidian para o editor, ou guardar a daqui por cima dela.`;

    const preview = document.createElement('pre');
    preview.className = 'scroll-area max-h-56 overflow-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted';
    preview.textContent = current || '(ficheiro vazio)';

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rounded-xl border border-line px-4 py-2 text-sm font-medium transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => overlay.remove());

    const force = document.createElement('button');
    force.type = 'button';
    force.className = 'btn-mint';
    force.textContent = 'Guardar assim mesmo';
    force.addEventListener('click', async () => {
        overlay.remove();
        await retry(true);
    });

    const useVault = document.createElement('button');
    useVault.type = 'button';
    useVault.className = 'rounded-xl border border-brand bg-brand/15 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
    useVault.textContent = 'Usar a versão do Obsidian';
    useVault.addEventListener('click', () => {
        overlay.remove();
        adoptVaultVersion(name, current);
    });

    actions.append(cancel, useVault, force);
    card.append(title, message, preview, actions);
    overlay.append(card);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });

    document.body.append(overlay);
    cancel.focus();
}

async function persistToVault(force = false) {
    const name = `${dayKey(selected)}.md`;
    const text = els.notes.value;

    if (!text.trim()) {
        toast('Não há nada para guardar.', 'warn');
        return;
    }

    commitNotes();

    if (!(await ensureVault())) return;

    const result = await Vault.save(name, text, { force });

    if (result.ok) {
        toast(`Guardado em ${result.path}`, 'success');
        return;
    }

    if (result.reason === 'conflito') {
        showConflict(result, persistToVault);
        return;
    }

    toast('Erro ao escrever no vault.', 'error');
}

/* ── Importação do Obsidian ───────────────────────────── */

const VAULT_SYNC_INTERVAL = 10000;
let vaultSyncTimer = null;

/* O Obsidian manda: se o ficheiro do dia mudou fora do site, essa versão
   substitui o que está no editor. Exceção: se nunca escrevemos aquele
   ficheiro (sem shadow) e o editor já tem texto, não se arrisca apagar —
   o conflito fica para o diálogo de gravação. */
async function syncDayFromVault() {
    // No telemóvel (modo remoto), ignoramos a verificação de estado 'ligado'
    // e tentamos ler do servidor sempre que possível.
    if (!els.notes || document.activeElement === els.notes) return;

    const key = dayKey(selected);
    try {
        const result = await Vault.load(`${key}.md`);
        if (!result.ok || !result.existe || !result.mudou) return;
        if (!result.conhecido && els.notes.value.trim()) return;
        if (key !== dayKey(selected)) return;
        if (result.content === els.notes.value) {
            await Vault.mark(`${key}.md`, result.content);
            return;
        }

        els.notes.value = result.content;
        els.wordCount.textContent = String(countWords(result.content));
        commitNotes();
        await Vault.mark(`${key}.md`, result.content);

        toast('Notas actualizadas a partir do Obsidian.', 'info');
    } catch (e) {
        console.error('Erro na sync automática:', e);
    }
}

function startVaultSync() {
    if (vaultSyncTimer) return;
    vaultSyncTimer = setInterval(syncDayFromVault, VAULT_SYNC_INTERVAL);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncDayFromVault();
    });

    window.addEventListener('focus', () => syncDayFromVault());

    /* Se a importação foi adiada por o editor estar focado, corre aqui. */
    els.notes.addEventListener('focusout', () => setTimeout(syncDayFromVault, 0));
}

/* Traz a versão do vault para o editor sem gravar por cima do ficheiro. */
async function adoptVaultVersion(name, content) {
    els.notes.value = content;
    els.wordCount.textContent = String(countWords(content));
    commitNotes();
    await Vault.mark(name, content);

    toast('A usar a versão do Obsidian.', 'success');
}

/* ── Navegação de vistas ──────────────────────────────── */

const VIEW_LABELS = {
    painel: 'Painel',
    calendario: 'Calendário',
    disciplinas: 'Disciplinas',
    estudar: 'Estudar',
    pdfs: 'PDFs',
    semanal: 'Semanal',
    exames: 'Exames Nacionais',
    definicoes: 'Definições',
};

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/* Todas as vistas num único ficheiro, trocadas pela navegação lateral. */
function showView(view) {
    currentView = view;
    write('study-journal-view', view);

    document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== view;
    });

    document.querySelectorAll('[data-view]').forEach((button) => {
        const active = button.dataset.view === view;
        const rail = button.closest('#nav-rail') !== null;
        const activeClass = rail ? 'nav-item-active' : 'nav-mobile-active';

        button.classList.toggle(activeClass, active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });

    if (view === 'painel') {
        StudyStats.renderHeatmap();
        StudyStats.renderReviewQueue();
        renderSessionTimer();
    }
    if (view === 'calendario') renderCalendar();
    if (view === 'disciplinas') renderSubjects();
    if (view === 'estudar') renderEstudarView();
    if (view === 'definicoes') renderSettings();
    if (view === 'pdfs') Pdfs.ligar();
    if (view === 'semanal') Weekly.ligar();
    if (view === 'exames' && window.Exames) window.Exames.ligar();

    document.title = `${VIEW_LABELS[view]} · StudyJournal`;
    window.scrollTo({ top: 0 });
}

/* ── Calendário ───────────────────────────────────────── */

let calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let heatmapCursor = new Date(today.getFullYear(), today.getMonth(), 1);

function daysWithData() {
    const set = new Set();

    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i) || '';

            const notes = /^study-journal-notes-(\d{4}-\d{2}-\d{2})$/.exec(key);
            if (notes) {
                // Navegar até um dia não deve criar um dia "com notas".
                // Atenção: o valor guardado é JSON, por isso '""' conta como vazio.
                if (read(key, '').trim()) set.add(notes[1]);
                continue;
            }

            const tasks = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(key);
            if (tasks && read(key, []).length) set.add(tasks[1]);
        }
    } catch { /* storage indisponível: mostramos só o que está em memória */ }

    return set;
}

function renderCalendar() {
    els.calMonth.textContent = calCursor.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

    if (!els.calWeekdays.childElementCount) {
        WEEKDAYS.forEach((label) => {
            const cell = document.createElement('div');
            cell.textContent = label;
            els.calWeekdays.append(cell);
        });
    }

    const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;

    els.calGrid.replaceChildren();

    for (let i = 0; i < 42; i += 1) {
        const date = new Date(first);
        date.setDate(first.getDate() - offset + i);

        const key = dayKey(date);
        const inMonth = date.getMonth() === calCursor.getMonth();
        const isToday = date.getTime() === today.getTime();
        const isSelected = date.getTime() === selected.getTime();

        const tasks = read(`study-journal-tasks-${key}`, []);
        const notes = read(`study-journal-notes-${key}`, '');
        const hasData = tasks.length > 0 || notes.trim() !== '';

        const cell = document.createElement('div');
        cell.className = 'relative min-h-[100px] p-1 rounded-xl border transition';
        cell.dataset.dateKey = key;
        cell.ariaLabel = date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        if (!inMonth) {
            cell.classList.add('bg-transparent', 'border-transparent', 'text-faint/40');
        } else if (isSelected) {
            cell.classList.add('border-brand', 'bg-brand/5');
        } else if (isToday) {
            cell.classList.add('border-brand/60', 'bg-brand/5');
        } else {
            cell.classList.add('border-line', 'bg-surface', 'hover:bg-surface-2', 'hover:border-brand/30');
        }

        // Day number
        const number = document.createElement('div');
        number.className = 'text-sm font-medium';
        number.textContent = String(date.getDate());
        if (!inMonth) number.classList.add('text-faint/40');
        else if (isToday) number.classList.add('text-brand');
        else if (isSelected) number.classList.add('text-brand');
        else number.classList.add('text-fg');
        cell.append(number);

        // Tasks container
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'mt-1 flex flex-col gap-1 min-h-[70px]';
        tasksContainer.dataset.tasksContainer = 'true';

        // Show up to 3 tasks inline
        const displayTasks = tasks.slice(0, 3);
        displayTasks.forEach(task => {
            const taskEl = createCalendarTaskElement(task, key, date);
            tasksContainer.append(taskEl);
        });

        // Show "+N more" if more tasks
        if (tasks.length > 3) {
            const moreEl = document.createElement('div');
            moreEl.className = 'text-[11px] text-muted text-center py-0.5';
            moreEl.textContent = `+${tasks.length - 3} mais`;
            moreEl.addEventListener('click', (e) => {
                e.stopPropagation();
                showDayTasksDialog(date, key);
            });
            tasksContainer.append(moreEl);
        }

        // Show notes indicator
        if (notes.trim()) {
            const notesEl = document.createElement('div');
            notesEl.className = 'text-[11px] text-brand/70 text-center py-0.5 border-t border-brand/20 mt-1';
            notesEl.innerHTML = '<svg class="icon inline h-3 w-3 mr-0.5"><use href="#i-file-text"/></svg> Notas';
            notesEl.addEventListener('click', (e) => {
                e.stopPropagation();
                showDayTasksDialog(date, key);
            });
            tasksContainer.append(notesEl);
        }

        // Add task button (shows on hover or for empty days)
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'add-task-btn absolute bottom-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-brand/10 text-brand opacity-0 transition hover:opacity-100 group-hover:opacity-100 flex items-center justify-center';
        addBtn.innerHTML = '<svg class="icon h-3.5 w-3.5"><use href="#i-plus"/></svg>';
        addBtn.title = 'Adicionar tarefa';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showInlineTaskForm(cell, key, date);
        });
        tasksContainer.append(addBtn);

        cell.append(tasksContainer);
        cell.classList.add('group');

        // Click on cell (not task/add btn) to select day
        cell.addEventListener('click', (e) => {
            if (e.target.closest('.calendar-task') || e.target.closest('.add-task-btn')) return;
            selected = startOfDay(date);
            renderCalendar();
        });

        els.calGrid.append(cell);
    }
}

function createCalendarTaskElement(task, key, date) {
    const el = document.createElement('div');
    el.className = 'calendar-task flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium truncate cursor-pointer transition hover:shadow-sm';

    const categoria = categoriaDaTarefa(task);
    const cat = CATEGORIA_CORES[categoria] || CATEGORIA_CORES.tarefa;
    el.style.backgroundColor = cat.bg;
    el.style.borderLeft = `3px solid ${cat.border}`;
    el.style.color = cat.text;

    el.dataset.taskId = task.id;
    el.title = `[${(CATEGORIA_NOMES[categoria] || categoria).toUpperCase()}] ${task.text}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'h-3 w-3 shrink-0 accent-current opacity-80';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', async (e) => {
        e.stopPropagation();
        const tasks = read(`study-journal-tasks-${key}`, []);
        const t = tasks.find(x => x.id === task.id);
        if (t) {
            t.done = e.target.checked;
            write(`study-journal-tasks-${key}`, tasks);
            renderCalendar();
        }
    });

    const text = document.createElement('span');
    text.className = 'truncate flex-1';
    text.textContent = task.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shrink-0 p-0.5 rounded text-current/70 hover:text-current hover:bg-current/20 transition opacity-0 group-hover:opacity-100';
    deleteBtn.innerHTML = '<svg class="icon h-3 w-3"><use href="#i-trash"/></svg>';
    deleteBtn.title = 'Apagar tarefa';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Apagar esta tarefa?')) {
            const tasks = read(`study-journal-tasks-${key}`, []).filter(t => t.id !== task.id);
            write(`study-journal-tasks-${key}`, tasks);
            renderCalendar();
        }
    });

    el.append(checkbox, text, deleteBtn);
    el.classList.add('group');

    el.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        showDayTasksDialog(date, key);
    });

    return el;
}

function showInlineTaskForm(cell, key, date) {
    // Use a modal dialog instead of inline form to avoid z-index/overflow issues
    const dlg = document.createElement('dialog');
    dlg.className = 'm-auto w-[min(22rem,90vw)] glass-strong rounded-2xl border border-line bg-surface p-0 shadow-pop';
    dlg.innerHTML = `
        <form class="flex flex-col" novalidate>
            <div class="flex items-center gap-3 border-b border-line px-4 py-3">
                <h3 class="flex-1 text-sm font-semibold">Nova tarefa para ${date.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
                <button type="button" class="icon-btn" aria-label="Fechar">
                    <svg class="icon h-4 w-4"><use href="#i-x"/></svg>
                </button>
            </div>
            <div class="flex flex-col gap-3 p-4">
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-muted" for="inline-task-title">Tarefa</label>
                    <input id="inline-task-title" type="text" placeholder="Tarefa..." class="field text-sm" required autocomplete="off">
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-muted" for="inline-task-subject">Disciplina</label>
                    <select id="inline-task-subject" class="field text-sm">
                        <option>Geral</option>
                        <option>Matemática A</option>
                        <option>Biologia</option>
                        <option>Português</option>
                        <option>Aplicações Informáticas (A.I.)</option>
                    </select>
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-muted" for="inline-task-category">Categoria</label>
                    <select id="inline-task-category" class="field text-sm">
                        <option value="tarefa">🟢 Tarefa / Entrega</option>
                        <option value="estudo">🔵 Bloco de estudo / Revisão</option>
                        <option value="teste">🔴 Teste / Avaliação</option>
                    </select>
                </div>
            </div>
            <div class="flex justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3">
                <button type="button" class="btn-soft text-sm" data-cancel>Cancelar</button>
                <button type="submit" class="btn-primary text-sm">
                    <svg class="icon h-3.5 w-3.5"><use href="#i-plus"/></svg>
                    <span>Adicionar</span>
                </button>
            </div>
        </form>
    `;
    document.body.append(dlg);

    const input = dlg.querySelector('#inline-task-title');
    const cancelBtn = dlg.querySelector('[data-cancel]');
    const closeBtn = dlg.querySelector('button[aria-label="Fechar"]');

    const close = () => {
        dlg.close();
        dlg.remove();
    };

    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) close();
    });

    dlg.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = input.value.trim();
        const subject = dlg.querySelector('#inline-task-subject').value;
        const category = dlg.querySelector('#inline-task-category')?.value || 'tarefa';
        if (!title) return;

        const tasks = read(`study-journal-tasks-${key}`, []);
        const nova = {
            id: `${Date.now()}-${tasks.length}`,
            text: title,
            subject,
            category,
            done: false,
        };
        tasks.push(nova);
        write(`study-journal-tasks-${key}`, tasks);
        close();
        renderCalendar();
    });

    dlg.showModal();
    input.focus();
}

function shiftMonth(delta) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
    renderCalendar();
}

function shiftHeatmap(delta) {
    heatmapCursor = new Date(heatmapCursor.getFullYear(), heatmapCursor.getMonth() + delta, 1);
    StudyStats.renderHeatmap();
}

async function openDay(date) {
    const key = dayKey(date);
    showDayTasksDialog(date, key);
}

function showDayTasksDialog(date, key) {
    const dlg = document.getElementById('day-tasks-dlg');
    if (!dlg) return createDayTasksDialog(date, key);
    
    dlg.dataset.dateKey = key;
    dlg.querySelector('#day-tasks-date').textContent = date.toLocaleDateString('pt-PT', { 
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
    });
    renderDayTasksInDialog(key);
    dlg.showModal();
}

function createDayTasksDialog(date, key) {
    const dlg = document.createElement('dialog');
    dlg.id = 'day-tasks-dlg';
    dlg.dataset.dateKey = key;
    dlg.className = 'm-auto w-[min(28rem,94vw)] glass-strong rounded-2xl border border-line bg-surface p-0 shadow-pop';
    dlg.innerHTML = `
        <div class="flex flex-col">
            <div class="flex items-center gap-3 border-b border-line px-4 py-3">
                <h3 class="flex-1 text-sm font-semibold" id="day-tasks-date"></h3>
                <button type="button" class="icon-btn" aria-label="Fechar">
                    <svg class="icon h-4 w-4"><use href="#i-x"/></svg>
                </button>
            </div>
            <div id="day-tasks-list" class="flex flex-col gap-2 p-4 max-h-[60vh] overflow-auto"></div>
            <div class="border-t border-line px-4 py-3">
                <form id="day-tasks-add-form" class="flex flex-col gap-2">
                    <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <input id="day-tasks-title" type="text" placeholder="Nova tarefa..." class="field w-full text-sm" autocomplete="off" required>
                        <select id="day-tasks-subject" class="field w-full sm:w-auto text-sm">
                            <option>Geral</option>
                            <option>Matemática A</option>
                            <option>Biologia</option>
                            <option>Português</option>
                            <option>Aplicações Informáticas (A.I.)</option>
                        </select>
                        <select id="day-tasks-category" class="field w-full sm:w-auto text-sm" title="Categoria">
                            <option value="tarefa">🟢 Tarefa</option>
                            <option value="estudo">🔵 Estudo</option>
                            <option value="teste">🔴 Teste</option>
                        </select>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button type="submit" class="btn-primary text-sm">
                            <svg class="icon h-3.5 w-3.5"><use href="#i-plus"/></svg>
                            <span>Adicionar</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.append(dlg);
    bindDayTasksDialog(dlg);
    dlg.showModal();
    dlg.querySelector('#day-tasks-title').focus();
}

function bindDayTasksDialog(dlg) {
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg.querySelector('button[aria-label="Fechar"]') || e.target === dlg) {
            dlg.close();
        }
    });
    dlg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = dlg.dataset.dateKey;
        const title = dlg.querySelector('#day-tasks-title').value.trim();
        const subject = dlg.querySelector('#day-tasks-subject').value;
        const category = dlg.querySelector('#day-tasks-category')?.value || 'tarefa';

        if (!title) return;

        const tasks = read(`study-journal-tasks-${key}`, []);
        const nova = {
            id: `${Date.now()}-${tasks.length}`,
            text: title,
            subject,
            category,
            done: false,
        };
        tasks.push(nova);
        write(`study-journal-tasks-${key}`, tasks);
        
        // Update vault if connected
        if (window.Vault && Vault.supported()) {
            const allTasks = {};
            daysWithData().forEach(k => {
                allTasks[k] = read(`study-journal-tasks-${k}`, []);
            });
            await Vault.save('tasks.json', JSON.stringify(allTasks));
        }
        
        dlg.querySelector('#day-tasks-title').value = '';
        renderDayTasksInDialog(key);
        
        // Update calendar dots
        if (currentView === 'calendario') renderCalendar();
    });
}

function renderDayTasksInDialog(key) {
    const container = document.getElementById('day-tasks-list');
    if (!container) return;
    
    const tasks = read(`study-journal-tasks-${key}`, []);
    const notes = read(`study-journal-notes-${key}`, '');
    
    container.innerHTML = '';
    
    if (notes.trim()) {
        const noteCard = document.createElement('div');
        noteCard.className = 'rounded-lg bg-brand/5 border border-brand/20 p-3';
        noteCard.innerHTML = `
            <div class="flex items-center gap-1.5 text-xs font-medium text-brand mb-1">
                <svg class="icon h-3.5 w-3.5"><use href="#i-file-text"/></svg>
                Notas
            </div>
            <p class="text-sm text-fg whitespace-pre-wrap">${escapeHtml(notes)}</p>
        `;
        container.appendChild(noteCard);
    }
    
    if (tasks.length === 0 && !notes.trim()) {
        container.innerHTML = '<p class="text-center py-6 text-sm text-muted">Sem tarefas nem notas para este dia.</p>';
        return;
    }
    
    tasks.forEach(task => {
        const taskEl = document.createElement('div');
        taskEl.className = `flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5 transition hover:border-brand/30 ${task.done ? 'opacity-50' : ''}`;
        const catDlg = categoriaDaTarefa(task);
        const corDlg = CATEGORIA_CORES[catDlg] || CATEGORIA_CORES.tarefa;
        taskEl.innerHTML = `
            <input type="checkbox" class="task-check mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand" ${task.done ? 'checked' : ''} data-id="${task.id}">
            <div class="flex-1 min-w-0">
                <p class="text-sm ${task.done ? 'line-through text-muted' : 'text-fg'}">${escapeHtml(task.text)}</p>
                <span class="flex flex-wrap gap-1.5">
                    <span class="chip ${SUBJECTS[task.subject] ?? SUBJECTS['Geral']}">${task.subject}</span>
                    <span class="chip" style="background:${corDlg.bg};color:${corDlg.text};border:1px solid ${corDlg.border}">${CATEGORIA_NOMES[catDlg] || catDlg}</span>
                </span>
            </div>
            <button type="button" class="task-remove shrink-0 rounded-lg p-1 text-faint opacity-0 hover:opacity-100 hover:bg-surface-2 hover:text-subject-rose" data-id="${task.id}" aria-label="Apagar tarefa">
                <svg class="icon h-3.5 w-3.5"><use href="#i-trash"/></svg>
            </button>
        `;
        container.appendChild(taskEl);
    });
    
    // Bind checkboxes and remove buttons
    const dlg = document.getElementById('day-tasks-dlg');
    container.querySelectorAll('.task-check').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            const key = dlg?.dataset.dateKey;
            const id = e.target.dataset.id;
            const tasks = read(`study-journal-tasks-${key}`, []);
            const task = tasks.find(t => t.id === id);
            if (task) {
                task.done = e.target.checked;
                write(`study-journal-tasks-${key}`, tasks);
                renderDayTasksInDialog(key);
                if (currentView === 'calendario') renderCalendar();
            }
        });
    });
    
    container.querySelectorAll('.task-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = dlg?.dataset.dateKey;
            const id = e.target.closest('button').dataset.id;
            const tasks = read(`study-journal-tasks-${key}`, []).filter(t => t.id !== id);
            write(`study-journal-tasks-${key}`, tasks);
            renderDayTasksInDialog(key);
            if (currentView === 'calendario') renderCalendar();
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ── Disciplinas ──────────────────────────────────────── */

function allTimeStats() {
    const perSubject = new Map();
    let tasks = 0;
    let days = 0;

    daysWithData().forEach((key) => {
        const list = read(`study-journal-tasks-${key}`, []);
        if (!list.length) return;

        days += 1;
        tasks += list.length;

        list.forEach((task) => {
            const subject = task.subject || 'Geral';
            perSubject.set(subject, (perSubject.get(subject) || 0) + 1);
        });
    });

    return { perSubject, tasks, days };
}

function renderSubjects() {
    els.subjectsDate.textContent = selected.toLocaleDateString('pt-PT', {
        weekday: 'long', day: 'numeric', month: 'long',
    });

    const stats = allTimeStats();
    const sessoesHoje = StudySessions.obterDoDia(selected);
    els.subjectsTotal.textContent = stats.days
        ? `${stats.tasks} tarefas registadas em ${stats.days} ${stats.days === 1 ? 'dia' : 'dias'}.`
        : 'Ainda não há registos.';

    const groups = new Map();
    tasks.forEach((task) => {
        const subject = task.subject || 'Geral';
        if (!groups.has(subject)) groups.set(subject, []);
        groups.get(subject).push(task);
    });

    els.subjectsList.replaceChildren();

    if (!groups.size) {
        const empty = document.createElement('p');
        empty.className = 'py-10 text-sm text-faint md:col-span-2';
        empty.textContent = 'Sem tarefas neste dia. Adiciona tarefas no Painel para as veres aqui por disciplina.';
        els.subjectsList.append(empty);
        return;
    }

    groups.forEach((list, subject) => {
        const done = list.filter((t) => t.done).length;
        const total = stats.perSubject.get(subject) || 0;
        const sessaoMin = sessoesHoje[subject] || 0;

        const card = document.createElement('article');
        card.className = 'flex flex-col gap-3 glass-subtle rounded-xl border border-line-soft bg-surface-2 p-4';

        const head = document.createElement('div');
        head.className = 'flex items-center gap-2';

        const chip = document.createElement('span');
        chip.className = `chip ${SUBJECTS[subject] ?? SUBJECTS['Geral']}`;
        chip.textContent = subject;

        const counter = document.createElement('span');
        counter.className = 'ml-auto text-[11px] tabular-nums text-faint';
        const sessaoText = sessaoMin ? ` · ${StudySessions.formatar(sessaoMin)} sessão` : '';
        counter.textContent = `${done}/${list.length} · ${total} no total${sessaoText}`;

        head.append(chip, counter);

        const track = document.createElement('div');
        track.className = 'h-1.5 overflow-hidden rounded-full bg-line';
        const fill = document.createElement('div');
        fill.className = 'h-full rounded-full bg-gradient-to-r from-brand to-brand-light transition-[width] duration-500 ease-out';
        fill.style.width = `${(done / list.length) * 100}%`;
        track.append(fill);

        const listNode = document.createElement('ul');
        listNode.className = 'flex flex-col gap-1.5';

        list.forEach((task) => {
            const row = document.createElement('li');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.done;
            checkbox.ariaLabel = task.text;
            checkbox.className = 'mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand';
            checkbox.addEventListener('change', async () => await setTaskDone(task.id, checkbox.checked));

            const text = document.createElement('span');
            text.textContent = task.text;
            text.className = task.done
                ? 'text-sm text-faint line-through'
                : 'text-sm text-fg';

            row.className = 'flex items-start gap-2.5';
            row.append(checkbox, text);
            listNode.append(row);
        });

        card.append(head, track, listNode);
        els.subjectsList.append(card);
    });
}

/* ── Definições ───────────────────────────────────────── */

function askConfirm({ title, message, confirmLabel = 'Confirmar' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm';

        const card = document.createElement('div');
        card.className = 'flex w-full max-w-sm flex-col gap-4 glass-strong rounded-2xl border border-line bg-surface p-5 shadow-pop';

        const heading = document.createElement('h3');
        heading.className = 'text-base font-semibold';
        heading.textContent = title;

        const body = document.createElement('p');
        body.className = 'text-sm text-muted';
        body.textContent = message;

        const actions = document.createElement('div');
        actions.className = 'flex justify-end gap-2';

        const close = (result) => {
            overlay.remove();
            resolve(result);
        };

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-soft';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', () => close(false));

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'btn-soft btn-soft-danger';
        confirm.textContent = confirmLabel;
        confirm.addEventListener('click', () => close(true));

        actions.append(cancel, confirm);
        card.append(heading, body, actions);
        overlay.append(card);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(false);
        });

        document.body.append(overlay);
        cancel.focus();
    });
}

function renderSettings() {
    const state = lastVaultState;
    els.vaultStatus.textContent = `Estado: ${VAULT_LABELS[state]}`;
    els.vaultAction.textContent = state === 'ligado' ? 'Reconfirmar acesso' : 'Ligar vault';
    els.vaultDisconnect.hidden = state !== 'ligado';

    const stats = allTimeStats();
    const notes = daysWithData().size;
    els.stats.textContent = `${notes} ${notes === 1 ? 'dia' : 'dias'} com notas · ${stats.tasks} tarefas guardadas neste browser.`;

    els.origin.textContent = `Origem: ${window.location.origin} — os dados vivem no localStorage desta origem.`;
}

function exportData() {
    const payload = { app: 'study-journal', exportedAt: new Date().toISOString(), days: {}, semanal: {} };

    daysWithData().forEach((key) => {
        payload.days[key] = {
            notes: read(`study-journal-notes-${key}`, ''),
            tasks: read(`study-journal-tasks-${key}`, []),
        };
    });

    payload.semanal = {
        fixos: Weekly.fixos ? Weekly.fixos() : [],
        dinamicos: Weekly.dinamicos ? Weekly.dinamicos() : [],
        semanaAtual: Weekly.semanaAtual ? Weekly.semanaAtual() : '',
    };

    payload.exames = window.Exames ? window.Exames.lerTudo() : null;
    payload.reviewsV2 = ReviewSystem.lerV2();

    if (!Object.keys(payload.days).length && !payload.semanal.fixos.length && !payload.semanal.dinamicos.length && !payload.exames && !payload.reviewsV2.length) {
        toast('Não há nada para exportar.', 'warn');
        return;
    }

    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `study-journal-${dayKey(today)}.json`;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exportado ${Object.keys(payload.days).length} dias e dados semanais.`, 'success');
}

async function importData(file) {
    try {
        const payload = JSON.parse(await file.text());
        if (payload.app !== 'study-journal' || typeof payload.days !== 'object') {
            throw new Error('formato inválido');
        }

        let count = 0;
        Object.entries(payload.days).forEach(([key, value]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
            if (typeof value.notes === 'string') write(`study-journal-notes-${key}`, value.notes);
            if (Array.isArray(value.tasks)) write(`study-journal-tasks-${key}`, value.tasks);
            count += 1;
        });

        if (payload.semanal) {
            if (Array.isArray(payload.semanal.fixos)) {
                localStorage.setItem('study-journal-semanal-fixo', JSON.stringify(payload.semanal.fixos));
            }
            if (Array.isArray(payload.semanal.dinamicos) && payload.semanal.semanaAtual) {
                localStorage.setItem(`study-journal-semanal-dinamico-${payload.semanal.semanaAtual}`, JSON.stringify(payload.semanal.dinamicos));
                localStorage.setItem('study-journal-semanal-dinamico-atual', payload.semanal.semanaAtual);
            }
        }

        if (payload.exames && window.Exames) {
            window.Exames.escreverTudo(payload.exames);
        }

        if (Array.isArray(payload.reviewsV2)) {
            ReviewSystem.escreverV2(payload.reviewsV2);
        }

        if (!count && (!payload.semanal || (!payload.semanal.fixos.length && !payload.semanal.dinamicos.length)) && !payload.exames && !(payload.reviewsV2 && payload.reviewsV2.length)) {
            throw new Error('sem dias');
        }

        await loadDay();
        if (window.Weekly && Weekly.ligar) Weekly.ligar();
        if (window.Exames && window.Exames.ligar) window.Exames.ligar();
        toast(`Importado ${count} dias e dados semanais.`, 'success');
    } catch {
        toast('Ficheiro inválido — esperava um export do StudyJournal.', 'error');
    }
}

async function clearSelectedDay() {
    const ok = await askConfirm({
        title: 'Limpar o dia selecionado?',
        message: `As notas e tarefas de ${selected.toLocaleDateString('pt-PT')} são apagadas deste browser. Não toca no vault.`,
        confirmLabel: 'Limpar',
    });

    if (!ok) return;

    localStorage.removeItem(notesKey());
    localStorage.removeItem(tasksKey());
    loadDay();
    toast('Dia limpo.', 'success');
}

/* ── Dia selecionado ──────────────────────────────────── */

function renderDate() {
    const long = selected.toLocaleDateString('pt-PT', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    els.date.textContent = long;
    els.dateShort.textContent = selected.toLocaleDateString('pt-PT', {
        day: 'numeric',
        month: 'short',
    });
}

async function loadDay() {
    // 1. Carregar Tarefas (mapa por dia no vault, array legado, ou local)
    const taskResult = await Vault.load('tasks.json');
    const localTasks = read(tasksKey(), []);
    const doVault = taskResult.ok && taskResult.existe
        ? tasksDeConteudoVault(taskResult.content, dayKey(selected))
        : null;

    if (doVault !== null) {
        tasks = doVault;
    } else {
        tasks = localTasks;
        if (localTasks.length > 0) {
            await syncTasks();
        }
    }

    // 2. Carregar Notas (Tenta o Vault primeiro, senão local)
    const noteResult = await Vault.load(`${dayKey(selected)}.md`);
    if (noteResult.ok && noteResult.existe) {
        els.notes.value = noteResult.content;
    } else {
        els.notes.value = read(notesKey(), '');
    }

    els.wordCount.textContent = String(countWords(els.notes.value));
    setSaveStatus('');

    renderDate();
    renderTasks();
    limparBlocosEstudoGerados();
    renderStreak();
    renderSessionTimer();

    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'disciplinas') renderSubjects();
    if (currentView === 'definicoes') renderSettings();
}

async function shiftDay(delta) {
    const next = startOfDay(selected);
    next.setDate(next.getDate() + delta);

    commitNotes();
    selected = next;
    await loadDay();
}

/* ── Navegação externa (pesquisa) e foco de revisão ─── */

async function abrirDiaChave(chave) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave || '');
    if (!m) return;
    commitNotes();
    selected = startOfDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    showView('painel');
    await loadDay();
    if (window.NotasPro) window.NotasPro.renderTagsNota();
    els.notes.focus();
}

let reviewFocusIds = [];
let reviewFocusPos = 0;

function abrirReviewFocus() {
    reviewFocusIds = ReviewSystem.obterParaHoje().map((c) => c.id);
    reviewFocusPos = 0;
    if (!reviewFocusIds.length) {
        toast('Nada vencido. Volta amanhã!', 'info');
        return;
    }
    mostrarReviewFocus();
    document.getElementById('review-focus')?.showModal();
}

function mostrarReviewFocus() {
    const carta = ReviewSystem.lerV2().find((c) => c.id === reviewFocusIds[reviewFocusPos]);
    if (!carta) {
        document.getElementById('review-focus')?.close();
        StudyStats.renderReviewQueue();
        return;
    }
    document.getElementById('review-focus-title').textContent = carta.titulo || (carta.dia ? `Nota de ${carta.dia}` : 'Revisão');
    document.getElementById('review-focus-body').textContent = carta.texto || (carta.dia ? `Abre o dia ${carta.dia} e tenta explicar por palavras tuas.` : '');
    document.getElementById('review-focus-count').textContent = `${reviewFocusPos + 1} / ${reviewFocusIds.length} · intervalo ${carta.intervalo || 1}d`;
}

function responderReviewFocus(grade) {
    const id = reviewFocusIds[reviewFocusPos];
    if (id) ReviewSystem.responder(id, grade);
    reviewFocusPos += 1;
    if (reviewFocusPos >= reviewFocusIds.length) {
        document.getElementById('review-focus')?.close();
        toast('Sessão de revisão concluída!', 'success');
    } else {
        mostrarReviewFocus();
    }
    StudyStats.renderReviewQueue();
}

/* ── Arranque ─────────────────────────────────────────── */

function seed() {
    if (localStorage.getItem('study-journal-seeded')) return;

    write(tasksKey(), DEMO_TASKS.map((task, index) => ({ id: `demo-${index}`, ...task })));
    write(notesKey(), DEMO_NOTES);

    try {
        localStorage.setItem('study-journal-seeded', '1');
    } catch { /* sem flag: volta a semear, nada de grave */ }
}

function bind() {
    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => showView(button.dataset.view));
    });

    els.dayPrev.addEventListener('click', () => shiftDay(-1));
    els.dayNext.addEventListener('click', () => shiftDay(1));

    els.calPrev.addEventListener('click', () => shiftMonth(-1));
    els.calNext.addEventListener('click', () => shiftMonth(1));

    document.getElementById('heatmap-prev')?.addEventListener('click', () => shiftHeatmap(-1));
    document.getElementById('heatmap-next')?.addEventListener('click', () => shiftHeatmap(1));

    // Session Timer
    document.getElementById('session-start')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('session-pause')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('session-stop')?.addEventListener('click', () => {
        stopSessionTimer();
        sessionTimer.remaining = sessionTimer.minutes * 60;
        renderSessionTimer();
    });
    document.getElementById('session-subject')?.addEventListener('change', (e) => setSessionSubject(e.target.value));
    document.querySelectorAll('[data-session-preset]').forEach((btn) => {
        btn.addEventListener('click', () => setSessionMinutes(Number(btn.dataset.sessionPreset)));
    });

    // Estudar View Timer
    document.getElementById('estudar-start')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('estudar-pause')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('estudar-stop')?.addEventListener('click', () => {
        stopSessionTimer();
        sessionTimer.remaining = sessionTimer.minutes * 60;
        renderSessionTimer();
        renderEstudarView();
    });
    document.getElementById('estudar-subject')?.addEventListener('change', (e) => {
        setSessionSubject(e.target.value);
        renderEstudarView();
    });
    document.querySelectorAll('[data-estudar-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setSessionMinutes(Number(btn.dataset.estudarPreset));
            renderEstudarView();
        });
    });

    els.taskForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const text = els.taskInput.value.trim();
        if (!text) return;

        const category = document.getElementById('task-category')?.value || 'tarefa';
        await addTask(text, els.taskSubject.value, category);
        els.taskInput.value = '';
        els.taskInput.focus();
    });

    if (els.clearDone) {
        els.clearDone.addEventListener('click', clearDone);
    }

    els.notes.addEventListener('input', onNotesInput);

    document.querySelectorAll('[data-md]').forEach((button) => {
        button.addEventListener('click', () => applyMarkdown(button.dataset.md));
    });

    els.notes.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;

        const key = event.key.toLowerCase();
        if (key !== 'b' && key !== 'i') return;

        event.preventDefault();
        applyMarkdown(key === 'b' ? 'bold' : 'italic');
    });

    els.saveNotes.addEventListener('click', () => persistToVault());

    const markReviewBtn = document.getElementById('mark-review');
    if (markReviewBtn) {
        markReviewBtn.addEventListener('click', () => {
            const key = dayKey(selected);
            const primeira = (els.notes.value.split('\n').find((l) => l.trim()) || `Nota de ${key}`).slice(0, 120);
            ReviewSystem.marcar(key, primeira);
            StudyStats.renderReviewQueue();
            toast('Nota marcada para revisão futura.', 'success');
        });
    }

    document.getElementById('review-focus-btn')?.addEventListener('click', abrirReviewFocus);
    document.querySelectorAll('[data-review-close]').forEach((b) => {
        if (b.dataset.bound) return;
        b.dataset.bound = '1';
        b.addEventListener('click', () => document.getElementById('review-focus')?.close());
    });
    document.querySelectorAll('[data-review-grade]').forEach((b) => {
        if (b.dataset.bound) return;
        b.dataset.bound = '1';
        b.addEventListener('click', () => responderReviewFocus(b.dataset.reviewGrade));
    });

    els.vaultChip.addEventListener('click', async () => {
        const state = await Vault.status();
        if (state === 'ligado') {
            toast('Sincronizando...', 'info');
            await syncDayFromVault();
            toast(`Atualizado do vault!`, 'success');
            return;
        }
        await ensureVault();
    });

    els.vaultAction.addEventListener('click', async () => {
        if (lastVaultState !== 'ligado') {
            await ensureVault();
            return;
        }

        const result = await Vault.requestPermission();
        toast(result.ok ? 'Acesso reconfirmado.' : 'Permissão negada.', result.ok ? 'success' : 'warn');
    });

    els.vaultDisconnect.addEventListener('click', async () => {
        const ok = await askConfirm({
            title: 'Desligar o vault?',
            message: 'O browser deixa de guardar o acesso à pasta. Os ficheiros já escritos não são tocados.',
            confirmLabel: 'Desligar',
        });

        if (!ok) return;

        await Vault.disconnect();
        renderVault('desligado');
        toast('Acesso ao vault removido.', 'info');
    });

    els.exportData.addEventListener('click', exportData);
    els.importData.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', () => {
        const [file] = els.importInput.files;
        if (file) importData(file);
        els.importInput.value = '';
    });
    els.clearDay.addEventListener('click', clearSelectedDay);

    // GitHub Sync UI
    const githubToken = document.getElementById('github-token');
    const githubGist = document.getElementById('github-gist');
    const githubSave = document.getElementById('github-save');
    const githubSyncNow = document.getElementById('github-sync-now');
    const githubDisconnect = document.getElementById('github-disconnect');
    const githubNotConfigured = document.getElementById('github-not-configured');
    const githubConfigured = document.getElementById('github-configured');
    const githubStatus = document.getElementById('github-status');
    const githubLastSync = document.getElementById('github-last-sync');

    function atualizarUIEstados() {
        const cfg = GitHubSync.configurado();
        if (githubNotConfigured) githubNotConfigured.hidden = cfg;
        if (githubConfigured) githubConfigured.hidden = !cfg;
        if (cfg) {
            if (githubToken) githubToken.value = GitHubSync.getToken();
            if (githubGist) githubGist.value = GitHubSync.getGistId();
            const last = localStorage.getItem('study-journal-github-last-sync');
            if (githubLastSync && last) {
                const d = new Date(last);
                githubLastSync.textContent = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            }
        }
    }

    if (githubSave) {
        githubSave.addEventListener('click', async () => {
            const token = githubToken?.value?.trim();
            const gistId = githubGist?.value?.trim() || null;
            if (!token) {
                toast('Insere o Personal Access Token.', 'warn');
                return;
            }
            GitHubSync.setConfig(token, gistId);
            atualizarUIEstados();
            const res = await GitHubSync.sync(true);
            if (res.ok) {
                toast('Configurado e sincronizado.', 'success');
            } else {
                toast(`Erro: ${res.error || 'desconhecido'}`, 'error');
            }
        });
    }

    if (githubSyncNow) {
        githubSyncNow.addEventListener('click', async () => {
            const res = await GitHubSync.sync(true);
            if (res.ok) {
                toast('Sincronizado.', 'success');
                atualizarUIEstados();
            } else {
                toast(`Erro: ${res.error || 'desconhecido'}`, 'error');
            }
        });
    }

    if (githubDisconnect) {
        githubDisconnect.addEventListener('click', async () => {
            const ok = await askConfirm({
                title: 'Desligar sincronização GitHub?',
                message: 'Remove o token e o Gist ID guardados. Os dados locais não são apagados.',
                confirmLabel: 'Desligar',
            });
            if (!ok) return;
            GitHubSync.clearConfig();
            atualizarUIEstados();
            toast('GitHub desligado.', 'info');
        });
    }

    // Listener de eventos de sync para atualizar UI
    if (window.GitHubSync && window.GitHubSync.onSync) {
        window.GitHubSync.onSync((tipo) => {
            if (tipo === 'sync-done' || tipo === 'push-done' || tipo === 'pull-done') {
                atualizarUIEstados();
                if (currentView === 'definicoes') {
                    const last = localStorage.getItem('study-journal-github-last-sync');
                    if (githubLastSync && last) {
                        const d = new Date(last);
                        githubLastSync.textContent = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
                    }
                    if (githubStatus) githubStatus.textContent = 'Sincronizado';
                }
            } else if (tipo === 'sync-error') {
                if (githubStatus) githubStatus.textContent = 'Erro';
            } else if (tipo === 'sync-start') {
                if (githubStatus) githubStatus.textContent = 'A sincronizar...';
            }
        });
    }

    atualizarUIEstados();

    // ── Conta StudyJournal (sync pelo próprio servidor) ──
    const contaUser = document.getElementById('conta-user');
    const contaPass = document.getElementById('conta-pass');
    const contaEntrar = document.getElementById('conta-entrar');
    const contaDica = document.getElementById('conta-dica');
    const contaLogin = document.getElementById('conta-login');
    const contaAtiva = document.getElementById('conta-ativa');
    const contaStatus = document.getElementById('conta-status');
    const contaLastSync = document.getElementById('conta-last-sync');
    const contaSyncNow = document.getElementById('conta-sync-now');
    const contaSair = document.getElementById('conta-sair');

    function pintarHoraConta() {
        if (!contaLastSync) return;
        let last = null;
        try {
            last = localStorage.getItem('study-journal-conta-last-sync');
        } catch { /* segue */ }
        if (last) {
            contaLastSync.textContent = new Date(last)
                .toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        } else {
            contaLastSync.textContent = '';
        }
    }

    async function atualizarUIConta() {
        if (!window.ContaSync) return;
        const cfg = window.ContaSync.configurado();
        if (contaLogin) contaLogin.hidden = cfg;
        if (contaAtiva) contaAtiva.hidden = !cfg;
        if (cfg) {
            if (contaStatus) contaStatus.textContent = `Ligado como ${window.ContaSync.getUser()}`;
            pintarHoraConta();
        } else if (contaDica) {
            contaDica.textContent = 'A verificar o servidor…';
            try {
                const est = await window.ContaSync.estado();
                contaDica.textContent = est.contaAtiva
                    ? 'Servidor pronto — entra com a tua conta uma vez em cada aparelho.'
                    : 'O servidor ainda não tem conta: define SYNC_USER e SYNC_PASS ao arrancar o servidor.';
            } catch {
                contaDica.textContent = 'Sem ligação ao servidor.';
            }
        }
    }

    async function entrarNaConta() {
        if (!window.ContaSync) return;
        const res = await window.ContaSync.login(contaUser?.value, contaPass?.value);
        if (contaPass) contaPass.value = '';
        if (res.ok) {
            toast('Conta ligada e sincronizada.', 'success');
        } else {
            toast(`Erro: ${res.error || 'desconhecido'}`, 'error');
        }
        atualizarUIConta();
    }

    if (contaEntrar) {
        contaEntrar.addEventListener('click', entrarNaConta);
        contaPass?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') entrarNaConta();
        });
        contaUser?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') contaPass?.focus();
        });
    }

    if (contaSyncNow) {
        contaSyncNow.addEventListener('click', async () => {
            if (!window.ContaSync) return;
            const res = await window.ContaSync.sync(true);
            if (res.ok) {
                toast(res.atualizou ? 'Sincronizado com novidades.' : 'Sincronizado.', 'success');
                atualizarUIConta();
            } else {
                toast(`Erro: ${res.error || 'desconhecido'}`, 'error');
            }
        });
    }

    if (contaSair) {
        contaSair.addEventListener('click', async () => {
            const ok = await askConfirm({
                title: 'Sair da conta?',
                message: 'Este aparelho deixa de sincronizar. Os dados locais não são apagados.',
                confirmLabel: 'Sair',
            });
            if (!ok || !window.ContaSync) return;
            await window.ContaSync.logout();
            atualizarUIConta();
            toast('Sessão terminada neste aparelho.', 'info');
        });
    }

    if (window.ContaSync && window.ContaSync.onSync) {
        window.ContaSync.onSync((tipo, detalhes = {}) => {
            if (tipo === 'sync-done' || tipo === 'push-done' || tipo === 'pull-done') {
                atualizarUIConta();
                if (contaStatus && currentView === 'definicoes') {
                    if (tipo === 'pull-done' && detalhes.notasAdiadas) {
                        contaStatus.textContent = 'Sincronizado (notas atualizam ao sair da caixa)';
                    } else if (window.ContaSync.configurado()) {
                        contaStatus.textContent = `Ligado como ${window.ContaSync.getUser()}`;
                    }
                }
                if (tipo === 'pull-done' && detalhes.atualizou && !detalhes.notasAdiadas) {
                    toast('Novidades sincronizadas de outro aparelho.', 'info');
                }
            } else if (tipo === 'sync-error') {
                if (contaStatus && currentView === 'definicoes') {
                    contaStatus.textContent = `Erro: ${detalhes.error || 'sync'}`;
                }
            } else if (tipo === 'sync-start') {
                if (contaStatus && currentView === 'definicoes') contaStatus.textContent = 'A sincronizar...';
            }
        });
    }

    atualizarUIConta();

    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            persistToVault();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (window.NotasPro) window.NotasPro.abrirPaleta();
        }
    });

    window.addEventListener('beforeunload', commitNotes);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (sessionTimer.running) tickSessionTimer();
        }
    });
    window.addEventListener('focus', () => {
        if (sessionTimer.running) tickSessionTimer();
    });
}

async function init() {
    seed();
    bind();
    await refreshVault();
    await loadDay();
    const vistaGuardada = read('study-journal-view', 'painel');
    showView(VIEW_LABELS[vistaGuardada] ? vistaGuardada : 'painel');
    startVaultSync();
    syncDayFromVault();

    // Check for public read-only mode (GitHub Gist)
    if (window.GitHubSync && window.GitHubSync.isPublicReadOnly && window.GitHubSync.isPublicReadOnly()) {
        applyReadOnlyMode();
    }

    // Inicializar stats no painel
    ReviewSystem.migrar();
    StudyStats.renderHeatmap();
    StudyStats.renderReviewQueue();
    renderSessionTimer();
    if (window.NotasPro) window.NotasPro.ligar();
    if (window.Imagens) window.Imagens.ligar();

    // Callback para sync GitHub quando Weekly salva
    window.onWeeklySave = () => {
        sincronizarDispositivos();
    };

    // Pull inicial da conta (se houver login): atualiza deste lado
    if (window.ContaSync && window.ContaSync.configurado()) {
        window.ContaSync.pull().catch(() => {});
    }
}

function applyReadOnlyMode() {
    document.body.dataset.readonly = 'true';

    // Show read-only badge
    const badge = document.getElementById('readonly-badge');
    if (badge) badge.classList.remove('hidden');

    // Hide write-only elements
    document.querySelectorAll('.write-only').forEach(el => el.classList.add('hidden'));

    // Make notes readonly
    const notes = document.getElementById('journal-text');
    if (notes) notes.readOnly = true;

    // Disable task checkboxes in painel
    document.querySelectorAll('#task-list .task-check').forEach(cb => {
        cb.disabled = true;
        cb.classList.add('opacity-50', 'cursor-not-allowed');
    });

    // Hide save notes button
    const saveNotes = document.getElementById('save-notes');
    if (saveNotes) saveNotes.classList.add('hidden');

    // Update vault chip to show read-only
    const vaultLabel = document.getElementById('vault-label');
    const vaultDot = document.getElementById('vault-dot');
    if (vaultLabel) vaultLabel.textContent = '📱 Modo leitura';
    if (vaultDot) vaultDot.className = 'h-1.5 w-1.5 rounded-full bg-faint';

    // Disable calendar add-task buttons
    document.querySelectorAll('.add-task-btn').forEach(btn => btn.classList.add('hidden'));

    // Disable task checkboxes in calendar
    document.querySelectorAll('.calendar-task input[type="checkbox"]').forEach(cb => {
        cb.disabled = true;
        cb.classList.add('opacity-50', 'cursor-not-allowed');
    });

    // Weekly: disable drag/drop, click-to-add (handled by Weekly module if it checks)
    // The Weekly module will need to check GitHubSync.isPublicReadOnly()

    // Settings: update GitHub section
    updateSettingsForReadOnly();
}

function updateSettingsForReadOnly() {
    // GitHub Sync section
    const githubNotConfigured = document.getElementById('github-not-configured');
    const githubConfigured = document.getElementById('github-configured');
    const githubSave = document.getElementById('github-save');
    const githubSyncNow = document.getElementById('github-sync-now');
    const githubDisconnect = document.getElementById('github-disconnect');
    const githubToken = document.getElementById('github-token');
    const githubGist = document.getElementById('github-gist');
    const githubStatus = document.getElementById('github-status');
    const githubLastSync = document.getElementById('github-last-sync');

    if (githubNotConfigured) githubNotConfigured.hidden = true;
    if (githubConfigured) githubConfigured.hidden = false;

    // Show read-only status
    if (githubStatus) {
        githubStatus.textContent = '📱 Modo leitura (Gist público)';
        githubStatus.className = 'flex items-center gap-2 text-xs text-muted';
        githubStatus.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-faint"></span> Modo leitura (Gist público)';
    }
    if (githubLastSync) githubLastSync.textContent = '';

    // Hide write actions
    if (githubSave) githubSave.hidden = true;
    if (githubSyncNow) githubSyncNow.hidden = true;
    if (githubDisconnect) githubDisconnect.hidden = true;
    if (githubToken) githubToken.hidden = true;
    if (githubGist) githubGist.hidden = true;

    // Add public Gist config button
    const githubSection = document.querySelector('#view-definicoes .rounded-xl.border-line-soft.bg-surface-2:has(#github-token)');
    if (githubSection && !document.getElementById('public-gist-config-btn')) {
        const btn = document.createElement('button');
        btn.id = 'public-gist-config-btn';
        btn.type = 'button';
        btn.className = 'btn-secondary mt-2';
        btn.textContent = 'Configurar Gist Público';
        btn.addEventListener('click', configurePublicGist);
        githubSection.append(btn);
    }

    // Hide export/import/clear day
    const exportData = document.getElementById('export-data');
    const importData = document.getElementById('import-data');
    const clearDay = document.getElementById('clear-day');
    if (exportData) exportData.hidden = true;
    if (importData) importData.hidden = true;
    if (clearDay) clearDay.hidden = true;
}

function configurePublicGist() {
    const gistId = prompt('Cole o ID do Gist público (ex: abc123...):');
    if (gistId && gistId.trim()) {
        window.GitHubSync.setPublicGist(gistId.trim());
        toast('Gist público configurado. Recarregando...', 'success');
        setTimeout(() => location.reload(), 1000);
    }
}

window.StudyJournal = {
    abrirDia: abrirDiaChave,
    adicionarANotas,
    irAExames() { showView('exames'); },
    irAPainel() { showView('painel'); },
};
window.ReviewSystem = ReviewSystem;

init();
Pdfs.carregar();
