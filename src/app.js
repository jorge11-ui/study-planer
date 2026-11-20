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
    taskPriority: document.getElementById('task-priority'),
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
    calToday: document.getElementById('cal-today'),
    calSearch: document.getElementById('cal-search'),
    calNewEvent: document.getElementById('cal-new-event'),
    calFilters: document.getElementById('cal-filters'),
    calUpcoming: document.getElementById('cal-upcoming'),
    calUpcomingCount: document.getElementById('cal-upcoming-count'),
    calAgendaView: document.getElementById('cal-agenda-view'),
    calMonthView: document.getElementById('cal-month-view'),

    subjectsList: document.getElementById('subjects-list'),
    subjectsDate: document.getElementById('subjects-date'),
    subjectsTotal: document.getElementById('subjects-total'),

    vaultStatus: document.getElementById('settings-vault-status'),
    vaultAction: document.getElementById('settings-vault-action'),
    vaultDisconnect: document.getElementById('settings-vault-disconnect'),
    saveAllComputer: document.getElementById('settings-save-all'),
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
    'Hobbies': 'bg-subject-rose/15 text-subject-rose',
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
        if (typeof pushDebounced === 'function') pushDebounced();
        try { document.dispatchEvent(new CustomEvent('sj:review-changed')); } catch { /* segue */ }
        return carta;
    }
};

/* ── Sessões de Estudo ───────────────────────────────────
   Totais por dia/disciplina + registo por aparelho.
   Cada aparelho soma os seus minutos no seu próprio compartimento
   (slots[dia][materia][deviceId]); a fusão no sync é união com máximo
   por compartimento, por isso dois aparelhos a estudar em simultâneo
   nunca perdem minutos um do outro (o máximo direto nos totais
   perdia o incremento concorrente). A base congela os totais
   pré-migração e funde por máximo. O study-journal-sessions continua
   a ser o cache dos totais para leituras (heatmap, vistas). */

const SESSIONS_KEY = 'study-journal-sessions';
const SESSIONS_BASE_KEY = 'study-journal-sessions-base';
const SESSIONS_SLOTS_KEY = 'study-journal-sessions-slots';
const SESSIONS_MIG_KEY = 'study-journal-sessions-migrado-v2';
const DEVICE_ID_KEY = 'study-journal-device-id';

function obterDeviceId() {
    try {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            id = `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch {
        return 'dev-desconhecido';
    }
}

function lerMapa(chave) {
    try {
        const v = JSON.parse(localStorage.getItem(chave) || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

const StudySessions = {
    lerBase() {
        return lerMapa(SESSIONS_BASE_KEY);
    },

    escreverBase(base) {
        try {
            localStorage.setItem(SESSIONS_BASE_KEY, JSON.stringify(base));
            return true;
        } catch {
            return false;
        }
    },

    lerSlots() {
        return lerMapa(SESSIONS_SLOTS_KEY);
    },

    escreverSlots(slots) {
        try {
            localStorage.setItem(SESSIONS_SLOTS_KEY, JSON.stringify(slots));
            return true;
        } catch {
            return false;
        }
    },

    /* Congela os totais existentes como base (uma vez por aparelho).
       Sem isto, os minutos antigos seriam contados duas vezes quando
       os slots começassem a somar por cima. */
    migrarV2() {
        try {
            if (localStorage.getItem(SESSIONS_MIG_KEY)) return;
            const atuais = lerMapa(SESSIONS_KEY);
            const base = this.lerBase();
            if (!Object.keys(base).length && Object.keys(atuais).length) {
                this.escreverBase(atuais);
            }
            localStorage.setItem(SESSIONS_MIG_KEY, '1');
        } catch { /* segue sem migrar */ }
    },

    /* Totais = base + soma dos slots de todos os aparelhos. */
    recalcularTotais() {
        const base = this.lerBase();
        const slots = this.lerSlots();
        const totais = {};
        Object.entries(base).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            Object.entries(materias).forEach(([materia, min]) => {
                const n = Number(min);
                if (typeof materia === 'string' && Number.isFinite(n) && n > 0) {
                    if (!totais[dia]) totais[dia] = {};
                    totais[dia][materia] = (totais[dia][materia] || 0) + n;
                }
            });
        });
        Object.entries(slots).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            Object.entries(materias).forEach(([materia, aparelhos]) => {
                if (typeof materia !== 'string' || !aparelhos || typeof aparelhos !== 'object') return;
                const soma = Object.values(aparelhos).reduce((a, v) => {
                    const n = Number(v);
                    return a + (Number.isFinite(n) && n > 0 ? n : 0);
                }, 0);
                if (soma > 0) {
                    if (!totais[dia]) totais[dia] = {};
                    totais[dia][materia] = (totais[dia][materia] || 0) + soma;
                }
            });
        });
        try {
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(totais));
        } catch { /* segue sem cache */ }
        return totais;
    },

    ler() {
        this.migrarV2();
        const emCache = lerMapa(SESSIONS_KEY);
        if (Object.keys(emCache).length) return emCache;
        // Sem cache (ou só slots novos): recalcula em vez de devolver vazio.
        return this.recalcularTotais();
    },

    /* Compat (import/export): funde na base por máximo e recalcula,
       para nunca deitar fora os slots dos outros aparelhos. */
    escrever(dados) {
        if (!dados || typeof dados !== 'object') return false;
        this.migrarV2();
        const base = this.lerBase();
        Object.entries(dados).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            if (!base[dia] || typeof base[dia] !== 'object') base[dia] = {};
            Object.entries(materias).forEach(([materia, min]) => {
                const n = Number(min);
                if (typeof materia === 'string' && Number.isFinite(n) && n > 0) {
                    base[dia][materia] = Math.max(Number(base[dia][materia]) || 0, n);
                }
            });
        });
        this.escreverBase(base);
        this.recalcularTotais();
        return true;
    },

    /* União de slots vindos do sync/import: máximo por compartimento
       de aparelho (cada aparelho só escreve no seu). */
    fundirSlotsRemotos(slotsRemotos) {
        if (!slotsRemotos || typeof slotsRemotos !== 'object') return;
        this.migrarV2();
        const slots = this.lerSlots();
        Object.entries(slotsRemotos).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            if (!slots[dia] || typeof slots[dia] !== 'object') slots[dia] = {};
            Object.entries(materias).forEach(([materia, aparelhos]) => {
                if (typeof materia !== 'string' || !materia || !aparelhos || typeof aparelhos !== 'object') return;
                if (!slots[dia][materia] || typeof slots[dia][materia] !== 'object') slots[dia][materia] = {};
                Object.entries(aparelhos).forEach(([dev, min]) => {
                    const n = Number(min);
                    if (typeof dev !== 'string' || !dev || !Number.isFinite(n) || n <= 0) return;
                    slots[dia][materia][dev] = Math.max(Number(slots[dia][materia][dev]) || 0, n);
                });
            });
        });
        this.escreverSlots(slots);
        this.recalcularTotais();
    },

    /* Totais de um export antigo (sem separação base/slots, logo sem os
       slots atuais lá dentro): tudo acima da base é trabalho novo e entra
       por inteiro, sem duplicar o que já vive nos slots. */
    fundirLegado(totais) {
        if (!totais || typeof totais !== 'object') return;
        this.migrarV2();
        const base = this.lerBase();
        Object.entries(totais).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            Object.entries(materias).forEach(([materia, min]) => {
                const n = Number(min);
                if (typeof materia !== 'string' || !Number.isFinite(n) || n <= 0) return;
                if (!base[dia] || typeof base[dia] !== 'object') base[dia] = {};
                const vBase = Number(base[dia][materia]) || 0;
                if (n > vBase) base[dia][materia] = n;
            });
        });
        this.escreverBase(base);
        this.recalcularTotais();
    },

    adicionarMinutos(subject, minutos, date = new Date()) {
        const n = Number(minutos);
        if (!subject || !Number.isFinite(n) || n <= 0) return;
        this.migrarV2();
        const key = dayKey(date);
        const slots = this.lerSlots();
        if (!slots[key] || typeof slots[key] !== 'object') slots[key] = {};
        if (!slots[key][subject] || typeof slots[key][subject] !== 'object') slots[key][subject] = {};
        const dev = obterDeviceId();
        slots[key][subject][dev] = (Number(slots[key][subject][dev]) || 0) + n;
        this.escreverSlots(slots);
        this.recalcularTotais();
        if (typeof pushDebounced === 'function') pushDebounced();
    },

    /* Credita minutos num compartimento explícito (ex.: sessões do plano
       de Exames). Como o compartimento é determinístico por sessão, o sync
       funde por máximo e a mesma sessão nunca conta duas vezes. */
    adicionarMinutosSessao(subject, minutos, dia, compartimento) {
        const n = Number(minutos);
        if (!subject || !Number.isFinite(n) || n <= 0) return false;
        if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
        if (typeof compartimento !== 'string' || !compartimento) return false;
        this.migrarV2();
        const slots = this.lerSlots();
        if (!slots[dia] || typeof slots[dia] !== 'object') slots[dia] = {};
        if (!slots[dia][subject] || typeof slots[dia][subject] !== 'object') slots[dia][subject] = {};
        const antes = Number(slots[dia][subject][compartimento]) || 0;
        slots[dia][subject][compartimento] = Math.max(antes, n);
        this.escreverSlots(slots);
        this.recalcularTotais();
        if (typeof pushDebounced === 'function') pushDebounced();
        return true;
    },

    /* Remove o crédito de uma sessão (reabrir ou apagar). */
    removerMinutosSessao(subject, dia, compartimento) {
        if (!subject || typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
        if (typeof compartimento !== 'string' || !compartimento) return false;
        this.migrarV2();
        const slots = this.lerSlots();
        const diaSlots = slots[dia];
        if (!diaSlots || typeof diaSlots !== 'object') return false;
        const materia = diaSlots[subject];
        if (!materia || typeof materia !== 'object' || !(compartimento in materia)) return false;
        delete materia[compartimento];
        if (!Object.keys(materia).length) delete diaSlots[subject];
        if (!Object.keys(diaSlots).length) delete slots[dia];
        this.escreverSlots(slots);
        this.recalcularTotais();
        if (typeof pushDebounced === 'function') pushDebounced();
        return true;
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

const HEATMAP_NIVEIS = { medio: 40, alto: 90, maximo: 150 };

/* O heatmap mede tempo de estudo (sessões do timer). Tarefas concluídas
   aparecem no tooltip mas não pintam o dia — sem "minutos fantasma".
   O pomodoro legado foi removido: só as sessões contam. */
function lerEsforcoDoDia(date) {
    const key = dayKey(date);
    const tasks = read(`study-journal-tasks-${key}`, []);
    const concluidas = Array.isArray(tasks) ? tasks.filter((t) => t && t.done).length : 0;
    const sessoes = StudySessions.obterDoDia(date);
    const sessaoTotal = Object.values(sessoes).reduce((total, valor) => {
        const minutos = Math.floor(Number(valor));
        return total + (Number.isFinite(minutos) && minutos > 0 ? minutos : 0);
    }, 0);
    return { foco: 0, concluidas, sessoes: sessaoTotal, total: sessaoTotal };
}

function nivelHeatmap(minutos) {
    if (!Number.isFinite(minutos) || minutos <= 0) return 0;
    if (minutos >= HEATMAP_NIVEIS.maximo) return 4;
    if (minutos >= HEATMAP_NIVEIS.alto) return 3;
    if (minutos >= HEATMAP_NIVEIS.medio) return 2;
    return 1;
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
    const hoje = startOfDay(new Date());
    const cursor = new Date(hoje);
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
        const d = new Date(hoje);
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
        const hoje = startOfDay(new Date());
        const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        if (heatmapCursor > mesAtual) heatmapCursor = new Date(mesAtual);
        const anual = heatmapView === 'anual';
        const ano = heatmapCursor.getFullYear();
        const inicioPeriodo = anual ? new Date(ano, 0, 1) : new Date(ano, heatmapCursor.getMonth(), 1);
        const fimPeriodo = anual ? new Date(ano, 11, 31) : new Date(ano, heatmapCursor.getMonth() + 1, 0);
        const inicioSemana = new Date(inicioPeriodo);
        inicioSemana.setDate(inicioSemana.getDate() - ((inicioSemana.getDay() + 6) % 7));
        const fimSemana = new Date(fimPeriodo);
        fimSemana.setDate(fimSemana.getDate() + (6 - ((fimSemana.getDay() + 6) % 7)));
        const semanas = Math.round((fimSemana - inicioSemana) / 604800000) + 1;

        const monthEl = document.getElementById('heatmap-month');
        if (monthEl) {
            monthEl.textContent = anual ? String(ano) : inicioPeriodo.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
        }
        const nextBtn = document.getElementById('heatmap-next');
        if (nextBtn) nextBtn.disabled = anual ? ano >= hoje.getFullYear() : heatmapCursor >= mesAtual;
        document.getElementById('heatmap-prev')?.setAttribute('aria-label', anual ? 'Ano anterior' : 'Mês anterior');
        nextBtn?.setAttribute('aria-label', anual ? 'Ano seguinte' : 'Mês seguinte');

        const weekEl = document.getElementById('heatmap-weekdays');
        if (weekEl) {
            weekEl.replaceChildren();
            weekEl.className = `heatmap-weekdays${anual ? '' : ' heatmap-weekdays-monthly'}`;
            (anual ? ['', 'Mon', '', 'Wed', '', 'Fri', ''] : ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']).forEach((l) => {
                const d = document.createElement('div');
                d.textContent = l;
                weekEl.append(d);
            });
        }
        document.querySelector('.heatmap-chart')?.classList.toggle('heatmap-chart-monthly', !anual);

        const monthsEl = document.getElementById('heatmap-months');
        if (monthsEl) {
            monthsEl.replaceChildren();
            monthsEl.hidden = !anual;
            if (anual) {
                monthsEl.style.gridTemplateColumns = `repeat(${semanas}, minmax(0, 1fr))`;
                for (let i = 0; i < 12; i += 1) {
                    const mes = new Date(ano, i, 1);
                    const inicioSemanaMs = Date.UTC(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate());
                    const semanasAteMes = Math.floor((Date.UTC(ano, i, 1) - inicioSemanaMs) / 604800000);
                    const label = document.createElement('span');
                    label.textContent = mes.toLocaleDateString('en', { month: 'short' });
                    label.style.gridColumn = `${semanasAteMes + 1} / span 1`;
                    monthsEl.append(label);
                }
            }
        }

        grid.replaceChildren();
        grid.className = `heatmap-grid${anual ? '' : ' heatmap-monthly'}`;
        grid.style.gridTemplateColumns = anual ? `repeat(${semanas}, minmax(0, 1fr))` : 'repeat(7, minmax(0, 1fr))';
        grid.style.gridTemplateRows = anual ? 'repeat(7, minmax(0, 1fr))' : '';
        let diasComEstudo = 0;
        let minutosPeriodo = 0;
        const diasAntes = (inicioPeriodo.getDay() + 6) % 7;
        const totalDias = Math.round((fimPeriodo - inicioPeriodo) / 86400000) + 1;
        if (!anual) {
            for (let i = 0; i < diasAntes; i += 1) {
                const vazio = document.createElement('div');
                vazio.className = 'heatmap-empty';
                grid.append(vazio);
            }
        }
        const totalCelulas = anual ? semanas * 7 : totalDias;
        for (let indice = 0; indice < totalCelulas; indice += 1) {
                const data = new Date(anual ? inicioSemana : inicioPeriodo);
                if (anual) data.setDate(inicioSemana.getDate() + indice);
                else data.setDate(inicioPeriodo.getDate() + indice);
                const dentroDoPeriodo = data >= inicioPeriodo && data <= fimPeriodo;
                if (anual && !dentroDoPeriodo) {
                    const espaco = document.createElement('div');
                    espaco.className = 'heatmap-empty';
                    grid.append(espaco);
                } else {
                    const futuro = startOfDay(data) > hoje;
                    const esforco = futuro ? { concluidas: 0, total: 0 } : lerEsforcoDoDia(data);
                    const score = Math.max(0, esforco.total);
                    const nivel = futuro ? 0 : nivelHeatmap(score);
                    if (!futuro && score > 0) {
                        diasComEstudo += 1;
                        minutosPeriodo += score;
                    }

                    const cell = document.createElement('button');
                    cell.type = 'button';
                    cell.className = 'heatmap-day';
                    cell.dataset.n = String(nivel);
                    cell.style.backgroundColor = `var(--color-heatmap-${nivel})`;
                    const partes = [`${score} min de estudo`];
                    if (esforco.concluidas) partes.push(`${esforco.concluidas} ${esforco.concluidas === 1 ? 'tarefa concluída' : 'tarefas concluídas'}`);
                    cell.title = `${data.toLocaleDateString('pt-PT')}: ${partes.join(' · ')}`;
                    if (startOfDay(data).getTime() === hoje.getTime()) cell.dataset.hoje = 'true';
                    cell.setAttribute('aria-label', `Abrir dia ${data.toLocaleDateString('pt-PT')}: ${score} minutos de estudo${esforco.concluidas ? `, ${esforco.concluidas} tarefas concluídas` : ''}`);
                    if (futuro) cell.disabled = true;
                    else cell.addEventListener('click', () => openDay(data));
                    if (!anual) {
                        const numero = document.createElement('span');
                        numero.textContent = String(data.getDate());
                        cell.append(numero);
                    }
                    grid.append(cell);
                }
        }

        const resumo = document.getElementById('heatmap-summary');
        if (resumo) {
            resumo.textContent = minutosPeriodo > 0
                ? `${diasComEstudo} ${diasComEstudo === 1 ? 'dia' : 'dias'} com estudo · ${StudySessions.formatar(minutosPeriodo)} ${anual ? 'no ano' : 'no mês'}`
                : 'Sem tempo de estudo registado neste período';
        }

        document.querySelectorAll('[data-heatmap-view]').forEach((button) => {
            const ativo = button.dataset.heatmapView === heatmapView;
            button.setAttribute('aria-pressed', String(ativo));
            button.classList.toggle('heatmap-view-active', ativo);
        });
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

const SELECTED_DATE_MODE_KEY = 'study-journal-selected-date-mode';

function selectDate(date) {
    selected = startOfDay(date);
    const key = dayKey(selected);
    localStorage.setItem('study-journal-selected-date', key);
    localStorage.setItem(SELECTED_DATE_MODE_KEY, key === dayKey(today) ? 'today' : 'custom');
}

let today = startOfDay(new Date());
let selected = today;
let localDayTimer = null;
let tasks = [];
let currentView = 'painel';
let lastVaultState = 'desligado';

function atualizarDiaLocal() {
    const agora = startOfDay(new Date());
    if (dayKey(agora) === dayKey(today)) return false;

    const ontem = new Date(today);
    ontem.setDate(ontem.getDate() - 1);
    const seguiaHoje = localStorage.getItem(SELECTED_DATE_MODE_KEY) !== 'custom'
        || dayKey(selected) === dayKey(today)
        || dayKey(selected) === dayKey(ontem);
    // Commit while the editor still points at yesterday, preserving that note
    // under its original date before switching the active day.
    commitNotes();
    today = agora;
    if (seguiaHoje) selectDate(today);
    calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    if (heatmapCursor.getTime() >= new Date(today.getFullYear(), today.getMonth(), 1).getTime()) {
        heatmapCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    loadDay().then(() => {
        try { window.SJDash?.render?.(); } catch { /* vista indisponível */ }
        if (currentView === 'calendario') renderCalendar();
        if (currentView === 'estudar') renderEstudarView();
        if (currentView === 'painel') {
            StudyStats.renderHeatmap();
            StudyStats.renderReviewQueue();
        }
        if (currentView === 'exames') window.Exames?.ligar?.();
        if (currentView === 'semanal') window.Weekly?.ligar?.();
    }).catch(() => {});
    return true;
}

function agendarMudancaDoDia() {
    clearTimeout(localDayTimer);
    const agora = new Date();
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    localDayTimer = setTimeout(() => {
        atualizarDiaLocal();
        agendarMudancaDoDia();
    }, Math.max(1000, amanha.getTime() - agora.getTime() + 250));
}

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
        const serializado = JSON.stringify(value);
        const anterior = localStorage.getItem(key);
        localStorage.setItem(key, serializado);
        // Carimbo por dia das tarefas: o sync usa-o para decidir qual das
        // listas é a mais recente (LWW), em vez de o pull repor a antiga.
        // Só muda quando o conteúdo muda — espelhos do vault não contam.
        if (/^study-journal-tasks-\d{4}-\d{2}-\d{2}$/.test(key) && serializado !== anterior) {
            try {
                localStorage.setItem(`${key}-ts`, String(Date.now()));
            } catch { /* segue sem carimbo */ }
        }
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
   Conta única do servidor quando há login, senão o GitHub Gist.
   Push com fila: sem rede o envio fica pendente e segue quando a
   ligação volta (laptop ligado de novo). */

const SYNC_PENDENTE_KEY = 'study-journal-sync-pendente';

function marcarSyncPendente() {
    try {
        localStorage.setItem(SYNC_PENDENTE_KEY, '1');
    } catch { /* segue sem fila */ }
}

function limparSyncPendente() {
    try {
        localStorage.removeItem(SYNC_PENDENTE_KEY);
    } catch { /* segue */ }
}

function temSyncPendente() {
    try {
        return localStorage.getItem(SYNC_PENDENTE_KEY) === '1';
    } catch {
        return false;
    }
}

function anotarResultadoPush(r) {
    if (r && r.ok) {
        limparSyncPendente();
        return;
    }
    // Já havia um sync a correr: o pedido não chegou a sair. Repetir em
    // breve em vez de esperar pelo flush de 15s (o texto ficava parado).
    if (r && (r.reason === 'a-syncar' || r.reason === 'not_configured_or_syncing')) {
        marcarSyncPendente();
        setTimeout(() => {
            if (temSyncPendente()) descarregarSyncPendente().catch(() => {});
        }, 2000);
        return;
    }
    if (!r || r.reason !== 'sem-conta') marcarSyncPendente();
    else limparSyncPendente();
}

/* Push com debounce: os pontos de escrita chamam isto em vez de push
   imediato, para não disparar um PUT por keystroke (ex.: exames). */
let pushDebounceTimer = null;

function pushDebounced(ms = 2500) {
    // Marca sempre como pendente, mesmo com o sync ainda não pronto:
    // ao abrir um link de partilha, verificarAberto()/usarPartilha() ainda
    // estão a resolver e sem isto uma nota escrita nos primeiros segundos
    // nunca chegava a ser marcada para envio. Quando o sync ficar pronto,
    // o flush (arranque, iniciarAuto ou o temporizador de 60s) manda o que
    // ficou por enviar. sincronizarDispositivos() ignora sozinho se não
    // houver sync configurado.
    marcarSyncPendente();
    clearTimeout(pushDebounceTimer);
    pushDebounceTimer = setTimeout(() => {
        sincronizarDispositivos();
    }, ms);
}

function contaSyncPronta() {
    return window.ContaSync && (window.ContaSync.configurado()
        || (window.ContaSync.emAberto && window.ContaSync.emAberto()));
}

function sincronizarDispositivos() {
    if (contaSyncPronta()) {
        window.ContaSync.push().then(anotarResultadoPush).catch(() => marcarSyncPendente());
        return;
    }
    if (window.GitHubSync && window.GitHubSync.configurado && window.GitHubSync.configurado()) {
        // Pull antes de push: sem isto um aparelho com dados parados
        // escrevia por cima do que o outro acabara de enviar.
        window.GitHubSync.sync(true).then(anotarResultadoPush).catch(() => marcarSyncPendente());
    }
}

/* ── Indicador de sync no cabeçalho ──────────────────────
   Verde: sincronizado há pouco. Âmbar: a sincronizar. Vermelho: a
   última tentativa falhou (o plano free adormece — a app repete
   sozinha). Passa o rato/clica para ver há quanto tempo. */

const SyncSinal = { okEm: 0, erroEm: 0, aSyncar: false };

function tempoRelativo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'agora mesmo';
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    return `há ${Math.floor(m / 60)} h`;
}

function pintarSyncSinal() {
    const el = document.getElementById('sync-dot');
    if (!el) return;
    let cor = 'bg-faint', dica = 'Sync: por verificar';
    if (SyncSinal.aSyncar) {
        cor = 'bg-subject-yellow';
        dica = 'A sincronizar…';
    } else if (SyncSinal.erroEm > SyncSinal.okEm) {
        cor = 'bg-subject-rose';
        dica = `Última tentativa falhou ${tempoRelativo(SyncSinal.erroEm)} — a repetir sozinho`;
    } else if (SyncSinal.okEm) {
        cor = 'bg-mint';
        dica = `Sincronizado ${tempoRelativo(SyncSinal.okEm)}`;
    }
    el.className = `mx-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${cor}`;
    el.title = dica;
}

function registarSyncEvento(tipo, ok = true) {
    if (tipo === 'sync-start') SyncSinal.aSyncar = true;
    else if (tipo === 'sync-done' || tipo === 'push-done' || tipo === 'pull-done') {
        SyncSinal.aSyncar = false;
        if (ok) SyncSinal.okEm = Date.now();
    } else if (tipo === 'sync-error') {
        SyncSinal.aSyncar = false;
        SyncSinal.erroEm = Date.now();
    }
    pintarSyncSinal();
}

setInterval(pintarSyncSinal, 30000);

/* ── Aviso de versão desatualizada ───────────────────────
   Compara o ?v= do script corrido com o do index fresco: se o servidor
   já tem código novo (e este aparelho corre cache velha), pede reload.
   Sem isto, um telemóvel em cache antiga nunca apanhava os fixes. */

let versaoWebPropria = null;
try {
    const eu = [...document.querySelectorAll('script')]
        .map((s) => s.src || '')
        .find((u) => u.includes('src/app.js?v=')) || '';
    const m = /app\.js\?v=(\d+)/.exec(eu);
    versaoWebPropria = m ? Number(m[1]) : null;
} catch { versaoWebPropria = null; }

let avisoVersaoDado = false;

async function verificarVersaoWeb() {
    if (versaoWebPropria === null || avisoVersaoDado) return;
    try {
        const resp = await fetch(window.location.pathname, { cache: 'no-store' });
        if (!resp.ok) return;
        const html = await resp.text();
        const m = /src\/app\.js\?v=(\d+)/.exec(html);
        if (m && Number(m[1]) > versaoWebPropria) {
            avisoVersaoDado = true;
            toast('Há uma atualização do StudyJournal — recarrega a página para a apanhar.', 'warn', { timeout: 0 });
        }
    } catch { /* offline ou a acordar: ignora */ }
}

setInterval(verificarVersaoWeb, 5 * 60 * 1000);

/* Tenta esvaziar a fila quando há rede (regresso do laptop). */
let flushSyncTimer = null;

async function descarregarSyncPendente() {
    if (!temSyncPendente()) return;
    try {
        if (contaSyncPronta()) {
            const r = await window.ContaSync.push();
            anotarResultadoPush(r);
            return;
        }
        if (window.GitHubSync && window.GitHubSync.configurado && window.GitHubSync.configurado()) {
            const r = await window.GitHubSync.sync(true);
            anotarResultadoPush(r);
        }
    } catch {
        marcarSyncPendente();
    }
}

function iniciarFlushSync() {
    if (flushSyncTimer) return;
    flushSyncTimer = setInterval(() => {
        descarregarSyncPendente().catch(() => {});
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') descarregarSyncPendente().catch(() => {});
    });
    window.addEventListener('focus', () => {
        descarregarSyncPendente().catch(() => {});
    });
}

/* Re-renderiza o dia atual a partir do localStorage (após pull).
   Não toca na caixa de notas enquanto estiver focada. */
function recarregarAposSync() {
    tasks = read(tasksKey(), []);
    renderTasks();

    // Só não se toca no editor se houver texto por gravar. Olhar para o
    // foco não chega: ao fechar o teclado do telemóvel (ou clicar fora) o
    // debounce de 800ms ainda pode estar pendente e a nota acabada de
    // escrever era substituída por uma versão antiga.
    const notasFocadas = notesDirty;
    if (!notasFocadas) {
        els.notes.value = read(notesKey(), '');
        notesDirty = false;
        els.wordCount.textContent = String(countWords(els.notes.value));
        if (window.NotasPro) window.NotasPro.renderTagsNota();
        const vista = document.getElementById('notes-preview');
        if (vista && !vista.hidden && window.NotasPro) {
            vista.innerHTML = window.NotasPro.renderMarkdownLite(els.notes.value)
                || '<p class="text-xs text-faint">Nada para pré-visualizar.</p>';
            if (window.Assistente) window.Assistente.renderMatematica(vista);
            if (window.Imagens) window.Imagens.hidratar(vista).catch(() => {});
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
    if (currentView === 'pdfs' && window.Pdfs) window.Pdfs.carregar();
    if (currentView === 'caderno' && window.Caderno) window.Caderno.carregar();
    // Título/disciplina/categoria da nota e lista de notas recentes.
    if (typeof window.__swRefreshNota === 'function') {
        try { window.__swRefreshNota(); } catch { /* segue */ }
    }

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

function espelharVaultParaLocal(content) {
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            write(`study-journal-tasks-${dayKey(selected)}`, parsed);
            return;
        }
        if (!parsed || typeof parsed !== 'object') return;
        Object.entries(parsed).forEach(([dia, lista]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !Array.isArray(lista)) return;
            write(`study-journal-tasks-${dia}`, lista);
        });
    } catch { /* espelho best-effort: o dia atual já foi resolvido acima */ }
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
    if (saved && !saved.ok && saved.reason !== 'desligado' && saved.reason !== 'incompativel') {
        // Sem vault neste aparelho (ex.: telemóvel) é normal e não avisa:
        // o sync por conta já leva as tarefas ao outro lado. Só avisa em
        // erro real — aí sim, ficam só neste browser até o vault voltar.
        toast('Não foi possível gravar na pasta local — as tarefas ficaram só neste browser.', 'warn');
    }
    write(tasksKey(), tasks);
}

/* Grava as tarefas de um dia qualquer (não só o selecionado): local +
   mapa do vault + push de sync + heatmap/streak. As edições do Calendário
   usavam só o local — o vault/sync repunham o apagado a seguir. */
async function persistirTarefasDia(key, lista) {
    write(`study-journal-tasks-${key}`, lista);
    if (key === dayKey(selected)) {
        tasks = [...lista];
        renderTasks();
    }
    try {
        let mapa = {};
        try {
            const atual = await Vault.load('tasks.json');
            if (atual.ok && atual.existe) {
                const parsed = JSON.parse(atual.content);
                if (Array.isArray(parsed)) mapa[dayKey(selected)] = parsed;
                else if (parsed && typeof parsed === 'object') mapa = parsed;
            }
        } catch { /* sem mapa anterior: grava só este dia */ }
        mapa[key] = lista;
        const saved = await Vault.save('tasks.json', JSON.stringify(mapa));
        if (saved && !saved.ok && saved.reason === 'conflito') {
            await Vault.save('tasks.json', JSON.stringify(mapa), { force: true });
        }
    } catch (e) {
        console.error('Erro ao persistir tarefas do dia:', e);
    }
    sincronizarDispositivos();
    renderStreak();
    StudyStats.renderHeatmap();
    if (currentView === 'disciplinas') renderSubjects();
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

        const pr = task.priority || 'media';
        const prLabel = pr === 'alta' ? 'Alta' : pr === 'baixa' ? 'Baixa' : 'Média';
        const prStyle = pr === 'alta'
            ? 'background:rgba(239,68,68,.14);color:#fca5a5;border:1px solid rgba(239,68,68,.35)'
            : pr === 'baixa'
                ? 'background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(148,163,184,.25)'
                : 'background:rgba(245,158,11,.14);color:#fcd34d;border:1px solid rgba(245,158,11,.35)';
        const chipPr = document.createElement('span');
        chipPr.className = 'chip';
        chipPr.setAttribute('style', prStyle);
        chipPr.textContent = prLabel;

        const chipsRow = document.createElement('div');
        chipsRow.className = 'flex flex-wrap gap-1.5';
        chipsRow.append(chip, chipCat, chipPr);
        if (task.noteTitle || task.noteDay) {
            const chipNote = document.createElement('span');
            chipNote.className = 'chip';
            chipNote.setAttribute('style', 'background:rgba(59,130,246,.12);color:#93c5fd;border:1px solid rgba(59,130,246,.25)');
            chipNote.textContent = task.noteTitle ? `Nota: ${String(task.noteTitle).slice(0,18)}` : 'Nota';
            chipNote.title = task.noteTitle ? `Associada à nota: ${task.noteTitle}` : 'Associada à nota do dia';
            chipsRow.append(chipNote);
        }

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
        if (task.noteDay) li.dataset.noteDay = String(task.noteDay);
        if (task.noteTitle) li.dataset.noteTitle = String(task.noteTitle);
        if (task.noteSubject) li.dataset.noteSubject = String(task.noteSubject);
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

    try { window.SJDash?.refreshTasks?.(); } catch { /* segue */ }
}

async function addTask(text, subject, category = 'tarefa', priority = 'media') {
    const link = (window.__swTaskNoteLink && typeof window.__swTaskNoteLink === 'object') ? window.__swTaskNoteLink : null;
    const task = { id: `${Date.now()}-${tasks.length}`, text, subject, category, priority, done: false };
    if (link && (link.noteDay || link.noteTitle)) {
        task.noteDay = link.noteDay || '';
        task.noteTitle = link.noteTitle || '';
        task.noteSubject = link.noteSubject || '';
    }
    window.__swTaskNoteLink = null;
    tasks.push(task);
    await syncTasks();
    renderTasks();
    sincronizarDispositivos();
}

const CATEGORIA_CORES = {
    teste:   { bg: 'rgba(239, 68, 68, 0.14)',  border: '#E57373', text: '#F1A7A7', dot: '#E57373' },
    tarefa:  { bg: 'rgba(245, 158, 11, 0.14)', border: '#E0A458', text: '#F0C792', dot: '#E0A458' },
    estudo:  { bg: 'rgba(34, 197, 94, 0.14)',  border: '#6FBF8E', text: '#A7D8B8', dot: '#6FBF8E' },
    aula:    { bg: 'rgba(34, 197, 94, 0.14)',  border: '#6FBF8E', text: '#A7D8B8', dot: '#6FBF8E' },
    trabalho:{ bg: 'rgba(245, 158, 11, 0.14)', border: '#E0A458', text: '#F0C792', dot: '#E0A458' },
    apresentacao: { bg: 'rgba(168, 85, 247, 0.14)', border: '#B794D6', text: '#D4BCEB', dot: '#B794D6' },
    pessoal: { bg: 'rgba(59, 130, 246, 0.14)', border: '#7AA7D9', text: '#B7D0EC', dot: '#7AA7D9' },
};

const CATEGORIA_NOMES = {
    teste: 'Testes',
    trabalho: 'Trabalhos',
    tarefa: 'Trabalhos',
    aula: 'Aulas',
    estudo: 'Aulas',
    apresentacao: 'Apresentações',
    pessoal: 'Pessoais',
};

const CAL_CATEGORIAS_UI = [
    { key: 'teste', label: 'Testes', cor: '#E57373' },
    { key: 'trabalho', label: 'Trabalhos', cor: '#E0A458' },
    { key: 'aula', label: 'Aulas', cor: '#6FBF8E' },
    { key: 'apresentacao', label: 'Apresentações', cor: '#B794D6' },
    { key: 'pessoal', label: 'Pessoais', cor: '#7AA7D9' },
];

function categoriaCanonica(cat) {
    const c = String(cat || '').toLowerCase();
    if (c === 'tarefa') return 'trabalho';
    if (c === 'estudo') return 'aula';
    if (CATEGORIA_NOMES[c]) return c;
    return 'trabalho';
}

/* Tarefas antigas não têm `category`: infere pelo texto para
   QA-Matematica / Teste-A.I existentes aparecerem a vermelho. */
function categoriaDaTarefa(task) {
    if (task && task.category) return categoriaCanonica(task.category);
    const texto = (task && task.text) || '';
    if (/teste|\bqa[-\s]|\bexame|\bavalia|\bprova|\bfrequência|\bmini[-\s]?teste/i.test(texto)) return 'teste';
    if (/apresent|semin[aá]ri|oral/i.test(texto)) return 'apresentacao';
    if (/aula|revis|\bestud|\bresum|\btrein/i.test(texto)) return 'aula';
    if (/pessoal|m[eé]dico|consulta|fam[ií]lia|anivers/i.test(texto)) return 'pessoal';
    return 'trabalho';
}

/* Remove os blocos de revisão gerados automaticamente (ids `estudo-…`).
   As tarefas de estudo criadas manualmente têm outro formato de id e ficam. */
async function limparBlocosEstudoGerados() {
    try {
        const alterados = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('study-journal-tasks-')) continue;
            const tarefas = read(k, []);
            const filtradas = tarefas.filter((t) => !(t && typeof t.id === 'string' && t.id.startsWith('estudo-')));
            if (filtradas.length !== tarefas.length) {
                write(k, filtradas);
                alterados.push(k);
            }
        }
        if (!alterados.length) return;
        // Persiste senão o espelho do vault repõe-nos no próximo loadDay
        let mapa = {};
        try {
            const atual = await Vault.load('tasks.json');
            if (atual.ok && atual.existe) {
                const parsed = JSON.parse(atual.content);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mapa = parsed;
            }
        } catch { /* segue com o mapa parcial */ }
        alterados.forEach((k) => {
            mapa[k.slice('study-journal-tasks-'.length)] = read(k, []);
        });
        await Vault.save('tasks.json', JSON.stringify(mapa));
        sincronizarDispositivos();
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
/* Há texto por gravar no editor? Um pull remoto pode substituir o
   conteúdo mesmo com o cursor lá dentro se não houver edições pendentes
   (era o que deixava as notas do outro aparelho invisíveis). */
let notesDirty = false;

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
    const brutoAnterior = localStorage.getItem(notesKey());
    if (!write(notesKey(), text)) return;
    // Carimbo da última escrita: o sync usa-o para decidir quem ganha
    // quando dois aparelhos mexem nas mesmas notas (LWW por dia).
    // Só quando o texto mudou — o commitNotes corre no beforeunload e,
    // a carimbar sempre, este aparelho ganhava o LWW sem ter editado nada
    // e as notas do outro nunca chegavam.
    if (brutoAnterior !== JSON.stringify(text)) {
        try {
            localStorage.setItem(`${notesKey()}-ts`, String(Date.now()));
        } catch { /* segue sem carimbo */ }
        sincronizarDispositivos();
    }
    notesDirty = false;

    const time = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    setSaveStatus(`guardado às ${time}`);

    espelharVaultDebounced();
    StudyStats.renderHeatmap();
    renderStreak();
}

let vaultMirrorTimer = null;

/* Espelho automático das notas no vault (Obsidian): corre sozinho após
   gravar, só onde há vault ligado (PC). Silencioso — em conflito não
   força; o botão Guardar Notas resolve com diálogo. */
function espelharVaultDebounced() {
    clearTimeout(vaultMirrorTimer);
    vaultMirrorTimer = setTimeout(espelharVault, 4000);
}

async function espelharVault() {
    try {
        if (!window.Vault || !window.Imagens) return;
        if (lastVaultState !== 'ligado') return;
        const dia = dayKey(selected);
        const text = els.notes.value;
        if (!text.trim() || dia !== dayKey(selected)) return;
        const paraVault = await window.Imagens.expandirParaVault(text).catch(() => text);
        if (dia !== dayKey(selected)) return;
        await Vault.save(`${dia}.md`, paraVault);
    } catch { /* best-effort: o botão manual cobre */ }
}

/* Anexa texto às notas de hoje (usado pelo visualizador de PDFs). */
function adicionarANotas(texto) {
    if (!texto || !texto.trim()) return false;
    const bloco = texto.trim();
    try {
        if (dayKey(selected) === dayKey(today)) {
            const base = els.notes.value.replace(/\s+$/, '');
            els.notes.value = base ? `${base}\n\n${bloco}\n` : `${bloco}\n`;
            onNotesInput();
        } else {
            const chaveHoje = `study-journal-notes-${dayKey(today)}`;
            const base = read(chaveHoje, '').replace(/\s+$/, '');
            write(chaveHoje, base ? `${base}\n\n${bloco}\n` : `${bloco}\n`);
            toast('Guardado nas notas de hoje.', 'success');
        }
        renderStreak();
        return true;
    } catch {
        return false;
    }
}

function onNotesInput() {
    notesDirty = true;
    els.wordCount.textContent = String(countWords(els.notes.value));
    setSaveStatus('a guardar…');

    const vista = document.getElementById('notes-preview');
    if (vista && !vista.hidden && window.NotasPro) {
        vista.innerHTML = window.NotasPro.renderMarkdownLite(els.notes.value) || '<p class="text-xs text-faint">Nada para pré-visualizar.</p>';
        if (window.Assistente) window.Assistente.renderMatematica(vista);
        if (window.Imagens) window.Imagens.hidratar(vista).catch(() => {});
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
    creditedSec: 0,
};

const SESSION_PRESETS = [25, 50, 90];
const SESSION_STATE_KEY = 'study-journal-session-state';

/* O timer perdia-se ao recarregar: guarda o estado (duração, restante,
   deadline, disciplina) e repõe no arranque. */
function saveSessionState() {
    try {
        localStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
            minutes: sessionTimer.minutes,
            remaining: sessionTimer.remaining,
            running: sessionTimer.running,
            deadline: sessionTimer.running ? sessionTimer.deadline : null,
            subject: sessionTimer.subject,
            creditedSec: sessionTimer.creditedSec,
        }));
    } catch { /* silencioso: não pode incomodar o timer */ }
}

function restoreSessionState() {
    let s = null;
    try {
        s = JSON.parse(localStorage.getItem(SESSION_STATE_KEY));
    } catch { s = null; }
    if (!s || typeof s !== 'object') return;

    if (SESSION_PRESETS.includes(Number(s.minutes))) {
        sessionTimer.minutes = Number(s.minutes);
    }
    if (typeof s.subject === 'string' && s.subject.trim()) {
        sessionTimer.subject = s.subject;
    }
    const full = sessionTimer.minutes * 60;
    const rem = Number(s.remaining);
    sessionTimer.remaining = Number.isFinite(rem) ? Math.min(Math.max(0, Math.ceil(rem)), full) : full;
    const cred = Number(s.creditedSec);
    sessionTimer.creditedSec = Number.isFinite(cred) ? Math.min(Math.max(0, Math.floor(cred)), full) : 0;
    sessionTimer.running = false;
    sessionTimer.deadline = null;

    if (s.running && Number.isFinite(Number(s.deadline))) {
        const restam = Math.max(0, Math.ceil((Number(s.deadline) - Date.now()) / 1000));
        if (restam <= 0) {
            // Terminou com a página fechada: credita a sessão sem alarme
            const jaMin = Math.floor(sessionTimer.creditedSec / 60);
            const emFalta = Math.max(0, sessionTimer.minutes - jaMin);
            if (emFalta > 0) registarSessaoEstudo(sessionTimer.subject, emFalta);
            sessionTimer.remaining = full;
            sessionTimer.creditedSec = 0;
            saveSessionState();
            setTimeout(() => toast(`Sessão de ${sessionTimer.minutes} min concluída em ${sessionTimer.subject}!`, 'success'), 0);
            return;
        }
        sessionTimer.remaining = restam;
        startSessionTimer();
        setTimeout(() => toast('Temporizador retomado após recarregar.', 'info'), 0);
    }
}

function formatSessionClock(total) {
    const safe = Math.max(0, Math.ceil(total));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/* Os dois seletores de disciplina (Painel e Estudar) partilham o mesmo
   sessionTimer — mantê-los sincronizados para a escolha num lado não
   parecer perdida no outro. */
function sincronizarSeletoresDisciplina() {
    ['session-subject', 'estudar-subject'].forEach((id) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const existe = [...sel.options].some((o) => o.value === sessionTimer.subject || o.text === sessionTimer.subject);
        if (existe && sel.value !== sessionTimer.subject) sel.value = sessionTimer.subject;
    });
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

    sincronizarSeletoresDisciplina();

    // Show today's summary for selected subject + totals
    try {
        const hoje = StudySessions.obterDoDia(new Date());
        const subjMin = hoje[sessionTimer.subject] || 0;
        const dayMin = Object.values(hoje).reduce((a,b)=>a + (Number(b)||0), 0);
        if (summaryEl) {
            summaryEl.textContent = subjMin > 0
                ? `Hoje: ${StudySessions.formatar(subjMin)} em ${sessionTimer.subject} · Total do dia: ${StudySessions.formatar(dayMin)}`
                : `Tempo total estudado hoje: ${StudySessions.formatar(dayMin)}`;
            summaryEl.classList.remove('hidden');
        }
        const totalEl = document.getElementById('session-total-summary');
        if (totalEl) {
            let all = 0;
            const sessions = (typeof read === 'function') ? read('study-journal-sessions', {}) : {};
            Object.values(sessions || {}).forEach(d => { if (d && typeof d === 'object') Object.values(d).forEach(v => all += (Number(v)||0)); });
            totalEl.textContent = `Total registado: ${StudySessions.formatar(all)}`;
        }
    } catch {}
    try { window.SJDash?.refreshSession?.(); } catch { /* segue */ }
    saveSessionState();
}

function startSessionTimer() {
    if (sessionTimer.timer) clearInterval(sessionTimer.timer);
    if (!(sessionTimer.remaining > 0)) {
        sessionTimer.remaining = sessionTimer.minutes * 60;
        sessionTimer.creditedSec = 0;
    }
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
    const jaCreditadoMin = Math.floor(sessionTimer.creditedSec / 60);
    const emFalta = Math.max(0, sessionTimer.minutes - jaCreditadoMin);
    if (emFalta > 0) {
        registarSessaoEstudo(sessionTimer.subject, emFalta);
    }
    const totalCiclo = jaCreditadoMin + emFalta;
    toast(totalCiclo > 0 && jaCreditadoMin > 0
        ? `Sessão de ${totalCiclo} min concluída em ${sessionTimer.subject}! (${jaCreditadoMin} min já tinham sido guardados)`
        : `Sessão de ${sessionTimer.minutes} min concluída em ${sessionTimer.subject}!`, 'success');
    atualizarVistasAposSessao();
    sessionTimer.remaining = sessionTimer.minutes * 60;
    sessionTimer.creditedSec = 0;
    renderSessionTimer();
}

/* ── Tempo parcial ───────────────────────────────────────
   O Stop (e a troca de preset/disciplina a meio) guardava 0 min.
   Agora credita os minutos inteiros já decorridos (>= 1 min) para
   não perder tempo de estudo no heatmap. */

function creditarTempoParcial(subject) {
    const fullSec = sessionTimer.minutes * 60;
    const decorridoSec = Math.max(0, fullSec - Math.max(0, sessionTimer.remaining));
    const porCreditarSec = Math.max(0, decorridoSec - sessionTimer.creditedSec);
    const minutos = Math.floor(porCreditarSec / 60);
    if (minutos > 0) {
        registarSessaoEstudo(subject, minutos);
        sessionTimer.creditedSec += minutos * 60;
    }
    return minutos;
}

/* Registo de sessões concluídas: alimenta o histórico de Concentração e as
   estatísticas. Mantém-se curto (200 entradas) para não encher o storage. */
function registarSessaoEstudo(subject, minutos) {
    if (!(minutos > 0)) return;
    StudySessions.adicionarMinutos(subject, minutos);
    try {
        const anterior = read('study-journal-session-log', []);
        const lista = Array.isArray(anterior) ? anterior : [];
        const objetivo = document.getElementById('session-goal')?.value
            || document.getElementById('estudar-goal')?.value
            || read('study-journal-session-goal', '')
            || '';
        lista.push({
            subject,
            minutos,
            goal: String(objetivo || '').slice(0, 120),
            created: Date.now(),
            day: dayKey(new Date()),
        });
        write('study-journal-session-log', lista.slice(-200));
    } catch { /* histórico é acessório */ }
    try { window.SJDash?.refreshSession?.(); } catch { /* segue */ }
}


function atualizarVistasAposSessao() {
    StudyStats.renderHeatmap();
    renderStreak();
    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'disciplinas') renderSubjects();
    if (currentView === 'estudar') renderEstudarView();
}

function cancelarSessao() {
    stopSessionTimer();
    const tinhaSidoIniciada = sessionTimer.remaining < sessionTimer.minutes * 60 || sessionTimer.creditedSec > 0;
    if (!tinhaSidoIniciada) {
        sessionTimer.creditedSec = 0;
        renderSessionTimer();
        if (currentView === 'estudar') renderEstudarView();
        return;
    }
    const guardados = creditarTempoParcial(sessionTimer.subject);
    const totalCiclo = Math.floor(sessionTimer.creditedSec / 60);
    if (guardados > 0) {
        toast(`Sessão parcial de ${guardados} min guardada em ${sessionTimer.subject}.`, 'success');
    } else if (totalCiclo > 0) {
        toast(`Sessão terminada (${totalCiclo} min já guardados neste ciclo).`, 'info');
    } else {
        toast('Sessão descartada (menos de 1 min).', 'info');
    }
    atualizarVistasAposSessao();
    sessionTimer.remaining = sessionTimer.minutes * 60;
    sessionTimer.creditedSec = 0;
    renderSessionTimer();
    if (currentView === 'estudar') renderEstudarView();
}

/* Ao fechar/trocar de aparelho a meio de uma sessão, credita já os
   minutos inteiros decorridos (idempotente via creditedSec) e marca o
   sync como pendente, para nada se perder se o debounce não disparar. */
function guardarSessaoAoSair() {
    try {
        const cicloIniciado = sessionTimer.remaining < sessionTimer.minutes * 60 || sessionTimer.creditedSec > 0;
        if (cicloIniciado) creditarTempoParcial(sessionTimer.subject);
    } catch { /* nunca partir o unload */ }
    try {
        saveSessionState();
    } catch { /* segue */ }
    try {
        marcarSyncPendente();
    } catch { /* segue */ }
}

function setSessionMinutes(minutes) {
    if (!SESSION_PRESETS.includes(minutes)) return;
    const cicloIniciado = sessionTimer.remaining < sessionTimer.minutes * 60 || sessionTimer.creditedSec > 0;
    if (minutes === sessionTimer.minutes && !sessionTimer.running) {
        if (cicloIniciado) {
            const guardados = creditarTempoParcial(sessionTimer.subject);
            if (guardados > 0) {
                toast(`Sessão parcial de ${guardados} min guardada em ${sessionTimer.subject}.`, 'success');
                atualizarVistasAposSessao();
            }
        }
        sessionTimer.minutes = minutes;
        sessionTimer.remaining = minutes * 60;
        sessionTimer.creditedSec = 0;
        renderSessionTimer();
        if (currentView === 'estudar') renderEstudarView();
        return;
    }

    const wasRunning = sessionTimer.running;
    const disciplinaAntiga = sessionTimer.subject;
    if (cicloIniciado) {
        stopSessionTimer();
        const guardados = creditarTempoParcial(disciplinaAntiga);
        if (guardados > 0) {
            toast(`Sessão parcial de ${guardados} min guardada em ${disciplinaAntiga}.`, 'success');
            atualizarVistasAposSessao();
        }
    } else {
        stopSessionTimer();
    }
    sessionTimer.minutes = minutes;
    sessionTimer.remaining = minutes * 60;
    sessionTimer.creditedSec = 0;

    if (wasRunning) startSessionTimer();
    else {
        renderSessionTimer();
        if (currentView === 'estudar') renderEstudarView();
    }
}

function toggleSessionTimer() {
    if (sessionTimer.running) {
        stopSessionTimer();
        return;
    }
    startSessionTimer();
}

function setSessionSubject(subject) {
    if (subject === sessionTimer.subject) {
        renderSessionTimer();
        return;
    }
    const cicloIniciado = sessionTimer.remaining < sessionTimer.minutes * 60 || sessionTimer.creditedSec > 0;
    if (cicloIniciado) {
        const wasRunning = sessionTimer.running;
        if (wasRunning) stopSessionTimer();
        const disciplinaAntiga = sessionTimer.subject;
        const guardados = creditarTempoParcial(disciplinaAntiga);
        sessionTimer.subject = subject;
        if (guardados > 0) {
            toast(`Sessão parcial de ${guardados} min guardada em ${disciplinaAntiga}.`, 'success');
            atualizarVistasAposSessao();
        }
        // O restante do ciclo continua a contar para a nova disciplina.
        if (wasRunning) startSessionTimer();
        else {
            renderSessionTimer();
            if (currentView === 'estudar') renderEstudarView();
        }
        return;
    }
    sessionTimer.subject = subject;
    renderSessionTimer();
}

function renderEstudarView() {
    // Sync subject selectors (Painel + Estudar) with session timer
    sincronizarSeletoresDisciplina();

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

    // Últimos 7 dias
    const faixa7 = document.getElementById('estudar-7dias');
    const total7El = document.getElementById('estudar-7dias-total');
    if (faixa7) {
        const dias = [];
        let max = 0;
        let soma = 0;
        for (let i = 6; i >= 0; i -= 1) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const mins = Object.values(StudySessions.obterDoDia(d)).reduce((a, b) => a + b, 0);
            dias.push({ d, mins });
            if (mins > max) max = mins;
            soma += mins;
        }
        if (total7El) total7El.textContent = StudySessions.formatar(soma);
        faixa7.replaceChildren();
        const letras = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']; // getDay(): Dom=0 … Sáb=6
        dias.forEach(({ d, mins }) => {
            const col = document.createElement('div');
            col.className = 'flex flex-1 flex-col items-center gap-1';
            const barra = document.createElement('div');
            const h = max > 0 ? Math.max(mins > 0 ? 6 : 2, Math.round((mins / max) * 56)) : 2;
            barra.className = 'w-full rounded';
            barra.style.height = `${h}px`;
            barra.style.background = mins > 0 ? 'var(--color-brand)' : 'var(--color-line)';
            barra.style.opacity = mins > 0 ? '0.9' : '0.6';
            const rot = document.createElement('span');
            rot.className = 'text-[10px] text-faint';
            rot.textContent = letras[d.getDay()];
            const dica = `${d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}: ${StudySessions.formatar(mins)}`;
            col.title = dica;
            col.setAttribute('aria-label', dica);
            col.append(barra, rot);
            faixa7.append(col);
        });
    }

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
    incompativel: 'Precisa de localhost ou HTTPS',
    desligado: 'Pasta local por ligar',
    permissao: 'Permissão da pasta necessária',
    ligado: 'Pasta local ligada',
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
        toast('Não foi possível aceder à pasta local.', 'error');
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
    title.textContent = 'O ficheiro local foi alterado';

    const message = document.createElement('p');
    message.className = 'text-sm text-muted';
    message.textContent = `O conteúdo de ${path} mudou desde o último guardado aqui. Podes trazer a versão da pasta local para o editor, ou guardar a daqui por cima dela.`;

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

    // No vault vão dataURLs reais (Obsidian); no editor ficam tokens curtos
    const paraVault = window.Imagens
        ? await window.Imagens.expandirParaVault(text).catch(() => text)
        : text;
    const result = await Vault.save(name, paraVault, { force });

    if (result.ok) {
        toast(`Guardado em ${result.path}`, 'success');
        return;
    }

    if (result.reason === 'conflito') {
        showConflict(result, persistToVault);
        return;
    }

    toast('Erro ao escrever na pasta local.', 'error');
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
    if (!els.notes || notesDirty || document.activeElement === els.notes) return;

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
        if (window.Imagens) {
            try {
                const { texto, mudou } = await window.Imagens.colapsarEmbutidas(result.content);
                if (mudou && key === dayKey(selected)) {
                    els.notes.value = texto;
                    els.wordCount.textContent = String(countWords(texto));
                }
            } catch { /* fica o texto original */ }
        }
        commitNotes();
        await Vault.mark(`${key}.md`, result.content);

        toast('Notas actualizadas a partir da pasta local.', 'info');
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

    toast('A usar a versão da pasta local.', 'success');
}

/* ── Navegação de vistas ──────────────────────────────── */

const VIEW_LABELS = {
    painel: 'Painel',
    calendario: 'Calendário',
    disciplinas: 'Disciplinas',
    estatisticas: 'Estatísticas',
    revisao: 'Revisão',
    estudar: 'Concentração',
    pdfs: 'Biblioteca',
    caderno: 'Caderno',
    semanal: 'Planeamento',
    exames: 'Exames Nacionais',
    definicoes: 'Definições',
    whiteboard: 'Quadro Branco',
};

const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/* Todas as vistas num único ficheiro, trocadas pela navegação lateral. */
function showView(view, navSelection = view) {
    currentView = view;
    const mobileMore = document.getElementById('mobile-more-dialog');
    if (mobileMore?.open) mobileMore.close();
    write('study-journal-view', view);

    document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== view;
    });

    document.querySelectorAll('[data-view]').forEach((button) => {
        const active = (button.dataset.navKey || button.dataset.view) === navSelection;
        const rail = button.closest('#nav-rail') !== null;
        const activeClass = rail ? 'nav-item-active' : 'nav-mobile-active';

        button.classList.toggle(activeClass, active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });

    if (view === 'whiteboard' && window.initWhiteboard) {
        window.initWhiteboard();
    }

    if (view === 'painel') {
        StudyStats.renderHeatmap();
        StudyStats.renderReviewQueue();
        renderSessionTimer();
        if (window.SJDash) window.SJDash.render();
    }
    if (view === 'calendario') renderCalendar();
    if (view === 'disciplinas') renderSubjects();
    if (view === 'estudar') renderEstudarView();
    if (view === 'estatisticas') {
        renderEstudarView();
        StudyStats.renderHeatmap();
        if (window.SJDash) window.SJDash.renderStats();
        renderWeeklyReview();
    }
    if (view === 'revisao') {
        StudyStats.renderReviewQueue();
        if (window.Revisao) window.Revisao.render();
    }
    if (view === 'definicoes') renderSettings();
    if (view === 'pdfs') Pdfs.ligar();
    if (view === 'caderno' && window.Caderno) window.Caderno.ligar();
    if (view === 'semanal') Weekly.ligar();
    if (view === 'exames' && window.Exames) window.Exames.ligar();

    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = VIEW_LABELS[view] || 'Painel';

    document.title = `${VIEW_LABELS[view]} · StudyJournal`;
    window.scrollTo({ top: 0 });
}

function renderWeeklyReview() {
    if (!window.StudyWeeklyReview) return;
    const tasks = [];
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i) || '';
            const match = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(k);
            if (!match) continue;
            const lista = JSON.parse(localStorage.getItem(k) || '[]');
            if (Array.isArray(lista)) lista.forEach(task => tasks.push({ date: match[1], task }));
        }
    } catch { /* apresenta os registos disponíveis */ }
    const exams = window.Exames?.lerTudo?.() || { topics: [], reviews: [], exams: [] };
    const report = window.StudyWeeklyReview.generate({
        sessionsByDay: window.StudySessions?.ler?.() || {},
        tasks,
        topics: exams.topics || [],
        reviews: exams.reviews || [],
        exams: exams.exams || [],
    });
    window.StudyWeeklyReview.render(report, document.getElementById('weekly-review'));
}

/* ── Calendário ───────────────────────────────────────── */

let calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let heatmapCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let heatmapView = 'anual';
let calViewMode = 'mes';
let calSearchTerm = '';
let calActiveFilters = new Set();

function textoCal(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function eventoCombinaFiltros(task) {
    const cat = categoriaDaTarefa(task);
    if (calActiveFilters.size && !calActiveFilters.has(cat)) return false;
    if (!calSearchTerm) return true;
    const hay = textoCal(`${task.text || ''} ${task.subject || ''} ${CATEGORIA_NOMES[cat] || cat}`);
    return hay.includes(calSearchTerm);
}

function obterEventosDoDia(key) {
    return read(`study-journal-tasks-${key}`, [])
        .map((t) => ({ ...t, _key: key, _cat: categoriaDaTarefa(t) }))
        .filter(eventoCombinaFiltros);
}

function obterEventosDoDiaTodos(key) {
    return read(`study-journal-tasks-${key}`, []).map((t) => ({ ...t, _key: key, _cat: categoriaDaTarefa(t) }));
}

function recolherProximosEventos(limiteDias = 45) {
    const inicio = new Date(today);
    const grupos = [];
    let total = 0;
    const vistos = new Set();
    for (let i = 0; i < limiteDias; i += 1) {
        const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
        const key = dayKey(d);
        if (vistos.has(key)) continue;
        vistos.add(key);
        const eventos = obterEventosDoDiaTodos(key)
            .filter(eventoCombinaFiltros)
            .sort((a, b) => Number(a.done) - Number(b.done));
        if (!eventos.length) continue;
        grupos.push({ date: d, key, eventos });
        total += eventos.length;
        if (grupos.length >= 14 && total >= 20) break;
    }
    return { grupos, total };
}

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

function renderCalFilters() {
    if (!els.calFilters) return;
    els.calFilters.replaceChildren(...CAL_CATEGORIAS_UI.map(({ key, label, cor }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-filter-chip';
        b.dataset.cat = key;
        b.setAttribute('aria-pressed', calActiveFilters.has(key) ? 'true' : 'false');
        b.innerHTML = `<span class="cal-filter-dot" style="background:${cor}"></span><span>${label}</span>`;
        b.addEventListener('click', () => {
            if (calActiveFilters.has(key)) calActiveFilters.delete(key); else calActiveFilters.add(key);
            renderCalendar();
        });
        return b;
    }));
}

function renderUpcomingSidebar() {
    if (!els.calUpcoming) return;
    const { grupos, total } = recolherProximosEventos();
    if (els.calUpcomingCount) els.calUpcomingCount.textContent = total ? `${total}` : '';
    els.calUpcoming.replaceChildren();
    if (!grupos.length) {
        const p = document.createElement('p');
        p.className = 'cal-empty';
        p.textContent = calSearchTerm || calActiveFilters.size ? 'Sem eventos para os filtros atuais.' : 'Sem próximos eventos.';
        els.calUpcoming.append(p);
        return;
    }

    const hojeKey = dayKey(today);
    const amanha = new Date(today); amanha.setDate(amanha.getDate() + 1);
    const amanhaKey = dayKey(amanha);

    const mkGroup = (titulo, items) => {
        if (!items.length) return null;
        const wrap = document.createElement('div');
        wrap.className = 'cal-up-group';
        const h = document.createElement('div');
        h.className = 'cal-up-date';
        h.textContent = titulo;
        wrap.append(h);
        items.forEach(({ date, key, eventos }) => {
            eventos.forEach((task) => {
                const cat = categoriaDaTarefa(task);
                const cor = CATEGORIA_CORES[cat] || CATEGORIA_CORES.trabalho;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'cal-up-item w-full text-left';
                const hora = task.hora || task.time || '';
                item.innerHTML = `
                    <span class="cal-up-dot" style="background:${cor.dot || cor.border}"></span>
                    <div class="min-w-0 flex-1">
                        <div class="cal-up-title truncate ${task.done ? 'line-through opacity-60' : ''}">${escapeHtml(task.text || '')}</div>
                        <div class="cal-up-meta truncate">${hora ? `<span>${escapeHtml(hora)}</span> · ` : ''}${escapeHtml(CATEGORIA_NOMES[cat] || cat)}${task.subject ? ` · ${escapeHtml(task.subject)}` : ''}</div>
                    </div>`;
                item.addEventListener('click', () => {
                    selectDate(date);
                    calCursor = new Date(date.getFullYear(), date.getMonth(), 1);
                    showDayTasksDialog(date, key);
                });
                wrap.append(item);
            });
        });
        return wrap;
    };

    const hoje = grupos.filter(g => g.key === hojeKey);
    const proximos = grupos.filter(g => g.key !== hojeKey);
    const gHoje = mkGroup('Hoje', hoje);
    const gProx = mkGroup('Próximos', proximos);
    if (gHoje) els.calUpcoming.append(gHoje);
    if (gProx) els.calUpcoming.append(gProx);
    if (!gHoje && !gProx) {
        const p = document.createElement('p'); p.className = 'cal-empty'; p.textContent = 'Sem próximos eventos.'; els.calUpcoming.append(p);
    }
}

function criarCelulaDia(date, { outroMes = false } = {}) {
    const key = dayKey(date);
    const isToday = date.getTime() === today.getTime();
    const isSelected = date.getTime() === selected.getTime();
    const tasks = read(`study-journal-tasks-${key}`, []);
    const notes = read(`study-journal-notes-${key}`, '');
    const visiveis = tasks.filter(eventoCombinaFiltros);

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.dataset.dateKey = key;
    cell.setAttribute('aria-label', date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (isToday) cell.dataset.hoje = 'true';
    if (isSelected) cell.dataset.selecionado = 'true';
    if (outroMes) cell.dataset.outroMes = 'true';
    const dow = date.getDay();
    if (dow === 0 || dow === 6) cell.dataset.fimSemana = 'true';

    const number = document.createElement('div');
    number.className = 'cal-day-num';
    number.textContent = String(date.getDate());
    cell.append(number);

    const events = document.createElement('div');
    events.className = 'cal-day-events';

    visiveis.slice(0, 3).forEach(task => events.append(createCalendarTaskElement(task, key, date)));
    if (visiveis.length > 3) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'cal-more';
        more.textContent = `+${visiveis.length - 3} mais`;
        more.addEventListener('click', (e) => { e.stopPropagation(); showDayTasksDialog(date, key); });
        events.append(more);
    }
    if (notes.trim()) {
        const n = document.createElement('button');
        n.type = 'button';
        n.className = 'cal-more';
        n.textContent = 'Notas';
        n.addEventListener('click', (e) => { e.stopPropagation(); showDayTasksDialog(date, key); });
        events.append(n);
    }
    cell.append(events);

    cell.addEventListener('click', (e) => {
        if (e.target.closest('.cal-event') || e.target.closest('.cal-more')) return;
        selectDate(date);
        if (outroMes) calCursor = new Date(date.getFullYear(), date.getMonth(), 1);
        renderCalendar();
    });
    cell.addEventListener('dblclick', (e) => {
        if (e.target.closest('.cal-event')) return;
        showInlineTaskForm(cell, key, date);
    });

    // Drag-and-drop target
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', async (e) => {
        e.preventDefault(); cell.classList.remove('drop-target');
        const raw = e.dataTransfer?.getData('text/cal-event');
        if (!raw) return;
        try {
            const { fromKey, taskId } = JSON.parse(raw);
            if (!fromKey || !taskId || fromKey === key) return;
            const origem = read(`study-journal-tasks-${fromKey}`, []);
            const idx = origem.findIndex(t => t.id === taskId);
            if (idx < 0) return;
            const [movido] = origem.splice(idx, 1);
            const destino = read(`study-journal-tasks-${key}`, []);
            destino.push(movido);
            await persistirTarefasDia(fromKey, origem);
            await persistirTarefasDia(key, destino);
            renderCalendar();
        } catch { /* ignora */ }
    });

    return cell;
}

function renderAgendaView(modo) {
    if (!els.calAgendaView || !els.calMonthView) return;
    els.calMonthView.classList.add('hidden');
    els.calAgendaView.classList.remove('hidden');
    els.calAgendaView.className = 'cal-agenda';
    els.calAgendaView.replaceChildren();

    const base = new Date(selected);
    const dias = [];
    if (modo === 'dia') {
        dias.push(new Date(base));
        els.calMonth.textContent = base.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } else {
        const dow = (base.getDay() + 6) % 7;
        const inicio = new Date(base); inicio.setDate(base.getDate() - dow);
        for (let i = 0; i < 7; i += 1) { const d = new Date(inicio); d.setDate(inicio.getDate() + i); dias.push(d); }
        els.calMonth.textContent = `${dias[0].toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })} – ${dias[6].toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }

    let tem = false;
    dias.forEach((date) => {
        const key = dayKey(date);
        const eventos = obterEventosDoDia(key);
        const bloco = document.createElement('div');
        bloco.className = 'cal-agenda-day';
        const head = document.createElement('div');
        head.className = 'cal-agenda-head';
        head.textContent = date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
        bloco.append(head);
        const list = document.createElement('div');
        list.className = 'cal-agenda-list';
        if (!eventos.length) {
            const v = document.createElement('div'); v.className = 'cal-empty'; v.textContent = 'Sem eventos.'; list.append(v);
        } else {
            tem = true;
            eventos.forEach(t => list.append(createCalendarTaskElement(t, key, date, { agenda: true })));
        }
        bloco.append(list);
        els.calAgendaView.append(bloco);
    });
    if (!tem && (calSearchTerm || calActiveFilters.size)) {
        // ok, individual empties shown
    }
}

function renderCalendar() {
    renderCalFilters();
    document.querySelectorAll('[data-cal-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.calView === calViewMode ? 'true' : 'false'));

    if (calViewMode === 'semana' || calViewMode === 'dia') {
        renderAgendaView(calViewMode);
        renderUpcomingSidebar();
        return;
    }

    if (els.calMonthView) els.calMonthView.classList.remove('hidden');
    if (els.calAgendaView) els.calAgendaView.classList.add('hidden');

    els.calMonth.textContent = `${calCursor.toLocaleDateString('pt-PT', { month: 'long' })} ${calCursor.getFullYear()}`;

    if (els.calWeekdays && !els.calWeekdays.childElementCount) {
        WEEKDAYS.forEach((label) => {
            const cell = document.createElement('div');
            cell.textContent = label;
            els.calWeekdays.append(cell);
        });
    }

    const ano = calCursor.getFullYear();
    const mes = calCursor.getMonth();
    const first = new Date(ano, mes, 1);
    const offset = (first.getDay() + 6) % 7;
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const prevMonthDays = new Date(ano, mes, 0).getDate();
    const totalCells = Math.ceil((offset + diasNoMes) / 7) * 7;

    els.calGrid.replaceChildren();

    for (let i = 0; i < totalCells; i += 1) {
        const diaNum = i - offset + 1;
        let date, outroMes = false;
        if (diaNum < 1) {
            date = new Date(ano, mes - 1, prevMonthDays + diaNum);
            outroMes = true;
        } else if (diaNum > diasNoMes) {
            date = new Date(ano, mes + 1, diaNum - diasNoMes);
            outroMes = true;
        } else {
            date = new Date(ano, mes, diaNum);
        }
        els.calGrid.append(criarCelulaDia(date, { outroMes }));
    }

    renderUpcomingSidebar();
    atualizarNotasRemotasCalendario(ano, mes);
}

/* Indicadores de notas vindos do vault: no telemóvel o localStorage
   começa vazio, por isso os "Notas" do calendário vinham sempre vazios.
   Um pedido por mês, em cache; a grelha local continua a mandar. */
let notasRemotasCache = { mes: '', dias: new Set() };

async function atualizarNotasRemotasCalendario(ano, mes) {
    const chave = `${ano}-${String(mes + 1).padStart(2, '0')}`;
    try {
        if (notasRemotasCache.mes !== chave) {
            notasRemotasCache = { mes: chave, dias: new Set() };
            const resp = await fetch(`/api/vault/dias-notas?mes=${chave}`);
            const r = await resp.json().catch(() => null);
            if (!r || !r.ok || !Array.isArray(r.dias)) return;
            notasRemotasCache.dias = new Set(r.dias.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
        }
        if (calCursor.getFullYear() !== ano || calCursor.getMonth() !== mes) return;
        if (!notasRemotasCache.dias.size || !els.calGrid) return;
        els.calGrid.querySelectorAll('.cal-day').forEach((cell) => {
            const key = cell.dataset.dateKey;
            if (!key || !notasRemotasCache.dias.has(key)) return;
            if (cell.querySelector('[data-notes-indicator]')) return;
            const box = cell.querySelector('.cal-day-events');
            if (!box) return;
            const notesEl = document.createElement('button');
            notesEl.type = 'button';
            notesEl.className = 'cal-more';
            notesEl.dataset.notesIndicator = 'true';
            notesEl.textContent = 'Notas';
            notesEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const [y, m, d] = key.split('-').map(Number);
                showDayTasksDialog(new Date(y, m - 1, d), key);
            });
            box.append(notesEl);
        });
    } catch { /* indicador best-effort */ }
}

function createCalendarTaskElement(task, key, date, opts = {}) {
    const agenda = !!opts.agenda;
    const el = document.createElement('div');
    el.className = `cal-event${agenda ? ' cal-event-agenda' : ''}${task.done ? ' cal-event-done' : ''}`;
    el.draggable = !agenda;

    const categoria = categoriaDaTarefa(task);
    const cat = CATEGORIA_CORES[categoria] || CATEGORIA_CORES.trabalho;
    const hora = task.hora || task.time || '';

    el.dataset.taskId = task.id;
    el.title = `${hora ? hora + ' · ' : ''}[${(CATEGORIA_NOMES[categoria] || categoria)}] ${task.text}`;

    el.innerHTML = `
        <span class="cal-event-dot" style="background:${cat.dot || cat.border}"></span>
        ${hora ? `<span class="cal-event-time">${escapeHtml(hora)}</span>` : ''}
        <span class="cal-event-title">${escapeHtml(task.text || '')}</span>
        ${task.done ? '<span class="cal-event-time" title="Concluído">✓</span>' : ''}
    `;

    if (!agenda) {
        el.addEventListener('dragstart', (e) => {
            el.classList.add('dragging');
            try { e.dataTransfer?.setData('text/cal-event', JSON.stringify({ fromKey: key, taskId: task.id })); } catch {}
            e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
    }

    el.addEventListener('click', (e) => {
        e.stopPropagation();
        showCalendarTaskEditor(key, task.id, date);
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
                        <option>FQA</option>
                        <option>Biologia</option>
                        <option>Português</option>
                        <option>Aplicações Informáticas (A.I.)</option>
                        <option>Hobbies</option>
                    </select>
                </div>
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-muted" for="inline-task-category">Categoria</label>
                    <select id="inline-task-category" class="field text-sm">
                        <option value="teste">Testes</option>
                        <option value="trabalho">Trabalhos</option>
                        <option value="aula">Aulas</option>
                        <option value="apresentacao">Apresentações</option>
                        <option value="pessoal">Pessoais</option>
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

    dlg.addEventListener('submit', async (e) => {
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
        await persistirTarefasDia(key, tasks);
        close();
        renderCalendar();
    });

    dlg.showModal();
    input.focus();
}

function shiftMonth(delta) {
    if (calViewMode === 'semana') {
        const d = new Date(selected);
        d.setDate(d.getDate() + delta * 7);
        selectDate(d);
        calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
        renderCalendar();
        return;
    }
    if (calViewMode === 'dia') {
        const d = new Date(selected);
        d.setDate(d.getDate() + delta);
        selectDate(d);
        calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
        renderCalendar();
        return;
    }
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
    renderCalendar();
}

function shiftHeatmap(delta) {
    heatmapCursor = heatmapView === 'anual'
        ? new Date(heatmapCursor.getFullYear() + delta, 0, 1)
        : new Date(heatmapCursor.getFullYear(), heatmapCursor.getMonth() + delta, 1);
    StudyStats.renderHeatmap();
}

function setHeatmapView(view) {
    if (view !== 'anual' && view !== 'mensal') return;
    heatmapView = view;
    if (view === 'mensal' && heatmapCursor.getFullYear() === today.getFullYear()) {
        heatmapCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    }
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

function showCalendarTaskEditor(key, taskId, date) {
    const tasks = read(`study-journal-tasks-${key}`, []);
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return showDayTasksDialog(date, key);

    const dlg = document.createElement('dialog');
    dlg.className = 'm-auto w-[min(30rem,94vw)] max-w-none glass-strong rounded-2xl border border-line bg-surface p-0 text-fg shadow-pop';
    dlg.innerHTML = `
        <form class="flex flex-col" novalidate>
            <div class="flex items-center gap-3 border-b border-line px-5 py-4">
                <div class="min-w-0 flex-1">
                    <p class="text-xs capitalize text-muted">${escapeHtml(date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
                    <h3 class="mt-1 text-base font-semibold">Editar evento</h3>
                </div>
                <button type="button" class="icon-btn" data-close aria-label="Fechar">
                    <svg class="icon h-4 w-4"><use href="#i-x"/></svg>
                </button>
            </div>
            <div class="grid gap-4 p-5">
                <label class="flex flex-col gap-1.5 text-sm font-medium text-muted" for="cal-event-edit-title">
                    Evento
                    <input id="cal-event-edit-title" type="text" class="field w-full text-sm text-fg" maxlength="240" required>
                </label>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1.5 text-sm font-medium text-muted" for="cal-event-edit-subject">
                        Disciplina
                        <select id="cal-event-edit-subject" class="field w-full text-sm text-fg">
                            <option>Geral</option><option>Matemática A</option><option>FQA</option><option>Biologia</option><option>Português</option><option>Aplicações Informáticas (A.I.)</option><option>Hobbies</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1.5 text-sm font-medium text-muted" for="cal-event-edit-category">
                        Categoria
                        <select id="cal-event-edit-category" class="field w-full text-sm text-fg">
                            <option value="teste">Testes</option><option value="trabalho">Trabalhos</option><option value="aula">Aulas</option><option value="apresentacao">Apresentações</option><option value="pessoal">Pessoais</option>
                        </select>
                    </label>
                </div>
                <label class="flex items-center gap-2 text-sm text-muted" for="cal-event-edit-done">
                    <input id="cal-event-edit-done" type="checkbox" class="h-4 w-4 accent-brand">
                    Evento concluído
                </label>
            </div>
            <div class="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-4">
                <button type="button" class="btn-soft text-sm" data-close>Cancelar</button>
                <button type="submit" class="btn-primary text-sm">Guardar alterações</button>
            </div>
        </form>`;
    document.body.append(dlg);

    const titleInput = dlg.querySelector('#cal-event-edit-title');
    const subjectSelect = dlg.querySelector('#cal-event-edit-subject');
    const categorySelect = dlg.querySelector('#cal-event-edit-category');
    const doneInput = dlg.querySelector('#cal-event-edit-done');
    titleInput.value = task.text || '';
    if (task.subject && ![...subjectSelect.options].some((option) => option.value === task.subject)) {
        const option = document.createElement('option');
        option.value = task.subject;
        option.textContent = task.subject;
        subjectSelect.append(option);
    }
    subjectSelect.value = task.subject || 'Geral';
    categorySelect.value = categoriaDaTarefa(task);
    doneInput.checked = !!task.done;

    const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
    dlg.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
    dlg.addEventListener('click', (event) => { if (event.target === dlg) close(); });
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
    dlg.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = titleInput.value.trim();
        if (!text) { titleInput.focus(); return; }
        const currentTasks = read(`study-journal-tasks-${key}`, []);
        const current = currentTasks.find((item) => item.id === taskId);
        if (!current) return close();
        Object.assign(current, {
            text,
            subject: subjectSelect.value,
            category: categorySelect.value,
            done: doneInput.checked,
        });
        await persistirTarefasDia(key, currentTasks);
        close();
        if (currentView === 'calendario') renderCalendar();
    });

    dlg.showModal();
    titleInput.focus();
    titleInput.select();
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
                            <option>FQA</option>
                            <option>Biologia</option>
                            <option>Português</option>
                            <option>Aplicações Informáticas (A.I.)</option>
                            <option>Hobbies</option>
                        </select>
                        <select id="day-tasks-category" class="field w-full sm:w-auto text-sm" title="Categoria">
                            <option value="teste">Testes</option>
                            <option value="trabalho">Trabalhos</option>
                            <option value="aula">Aulas</option>
                            <option value="apresentacao">Apresentações</option>
                            <option value="pessoal">Pessoais</option>
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
    dlg.querySelector('#day-tasks-date').textContent = date.toLocaleDateString('pt-PT', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
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
        await persistirTarefasDia(key, tasks);

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
                await persistirTarefasDia(key, tasks);
                renderDayTasksInDialog(key);
                if (currentView === 'calendario') renderCalendar();
            }
        });
    });

    container.querySelectorAll('.task-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const key = dlg?.dataset.dateKey;
            const id = e.target.closest('button').dataset.id;
            const tasks = read(`study-journal-tasks-${key}`, []).filter(t => t.id !== id);
            await persistirTarefasDia(key, tasks);
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

// Mudar quando a lógica de sync/storage mudar: visível em Definições para
// confirmar que os dois aparelhos correm o mesmo código.
const APP_VERSION = '2026.10.14-sync14';

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
    els.vaultAction.textContent = state === 'ligado' ? 'Reconfirmar acesso' : 'Escolher pasta';
    els.vaultDisconnect.hidden = state !== 'ligado';

    const stats = allTimeStats();
    const notes = daysWithData().size;
    let estudoTxt = '';
    try {
        const totalMin = Object.values(StudySessions.obterTotal()).reduce((a, b) => a + b, 0);
        if (totalMin > 0) estudoTxt = ` · ${StudySessions.formatar(totalMin)} de estudo`;
    } catch { /* segue sem o total */ }
    els.stats.textContent = `${notes} ${notes === 1 ? 'dia' : 'dias'} com notas · ${stats.tasks} tarefas guardadas neste browser${estudoTxt}.`;

    els.origin.textContent = `Origem: ${window.location.origin} — os dados vivem no localStorage desta origem. · v${APP_VERSION}`;
}

async function guardarDadosNoComputador() {
    const notas = [];
    const tarefas = {};
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i) || '';
            const nota = /^study-journal-notes-(\d{4}-\d{2}-\d{2})$/.exec(key);
            if (nota) notas.push([nota[1], read(key, '')]);
            const task = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(key);
            if (task) tarefas[task[1]] = read(key, []);
        }
    } catch { /* guarda o que o browser permitir */ }

    let notasGuardadas = 0;
    let conflitos = 0;
    for (const [dia, texto] of notas) {
        if (!String(texto || '').trim()) continue;
        const content = window.Imagens
            ? await Imagens.expandirParaVault(texto).catch(() => texto)
            : texto;
        const resultado = await Vault.save(`${dia}.md`, content);
        if (resultado.ok) notasGuardadas += 1;
        else if (resultado.reason === 'conflito') conflitos += 1;
    }

    if (Object.keys(tarefas).length) {
        let atuais = {};
        const lidas = await Vault.load('tasks.json');
        if (lidas.ok && lidas.existe) {
            try {
                const parsed = JSON.parse(lidas.content);
                if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') atuais = parsed;
            } catch { /* cria mapa novo */ }
        }
        const resultado = await Vault.save('tasks.json', JSON.stringify({ ...atuais, ...tarefas }, null, 2));
        if (!resultado.ok && resultado.reason === 'conflito') conflitos += 1;
    }

    const pdfs = window.Pdfs?.docs?.() || [];
    if (pdfs.length) {
        let atuais = [];
        const lidas = await Vault.load('pdfs.json');
        if (lidas.ok && lidas.existe) {
            try { atuais = JSON.parse(lidas.content) || []; } catch { atuais = []; }
        }
        const unicos = new Map([...(Array.isArray(atuais) ? atuais : []), ...pdfs].map((pdf) => [pdf.id, pdf]));
        const resultado = await Vault.save('pdfs.json', JSON.stringify([...unicos.values()], null, 2));
        if (!resultado.ok && resultado.reason === 'conflito') conflitos += 1;
    }

    const ficheiros = await window.Pdfs?.guardarNoComputador?.() || { guardados: 0, total: 0, indisponiveis: 0 };
    return { notasGuardadas, conflitos, ficheiros };
}

function exportData() {
    const payload = { app: 'study-journal', exportedAt: new Date().toISOString(), days: {}, semanal: {} };

    daysWithData().forEach((key) => {
        payload.days[key] = {
            notes: read(`study-journal-notes-${key}`, ''),
            tasks: read(`study-journal-tasks-${key}`, []),
        };
        const ts = Number(localStorage.getItem(`study-journal-notes-${key}-ts`)) || 0;
        if (ts > 0) payload.days[key].updatedAt = ts;
    });

    payload.semanal = {
        fixos: Weekly.fixos ? Weekly.fixos() : [],
        dinamicos: Weekly.dinamicos ? Weekly.dinamicos() : [],
        semanaAtual: Weekly.semanaAtual ? Weekly.semanaAtual() : '',
    };
    payload.semanalTodas = {};
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i) || '';
            const m = /^study-journal-semanal-dinamico-(\d{4}-\d{2}-\d{2})$/.exec(k);
            if (m) payload.semanalTodas[m[1]] = JSON.parse(localStorage.getItem(k) || '[]');
        }
    } catch { /* segue sem as antigas */ }

    payload.exames = window.Exames ? window.Exames.lerTudo() : null;
    payload.reviewsV2 = ReviewSystem.lerV2();
    payload.sessoes = StudySessions.ler();
    payload.sessoesBase = StudySessions.lerBase();
    payload.sessoesSlots = StudySessions.lerSlots();
    try {
        const rawPdfs = localStorage.getItem('study-journal-pdfs');
        payload.pdfs = rawPdfs ? JSON.parse(rawPdfs) : [];
    } catch {
        payload.pdfs = [];
    }
    try {
        const rawCad = localStorage.getItem('study-journal-caderno');
        payload.caderno = rawCad ? JSON.parse(rawCad) : [];
        const rawCadAp = localStorage.getItem('study-journal-caderno-apagados');
        payload.cadernoApagados = rawCadAp ? JSON.parse(rawCadAp) : [];
    } catch {
        payload.caderno = [];
        payload.cadernoApagados = [];
    }

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
            const ts = Number(value.updatedAt) || 0;
            try {
                if (ts > 0) localStorage.setItem(`study-journal-notes-${key}-ts`, String(ts));
                else localStorage.setItem(`study-journal-notes-${key}-ts`, String(Date.now()));
            } catch { /* segue sem carimbo */ }
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

        if (payload.semanalTodas && typeof payload.semanalTodas === 'object') {
            Object.entries(payload.semanalTodas).forEach(([sem, lista]) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(sem) && Array.isArray(lista)) {
                    localStorage.setItem(`study-journal-semanal-dinamico-${sem}`, JSON.stringify(lista));
                }
            });
        }

        if (payload.exames && window.Exames) {
            window.Exames.escreverTudo(payload.exames);
        }

        if (Array.isArray(payload.reviewsV2)) {
            ReviewSystem.escreverV2(payload.reviewsV2);
        }

        if (payload.sessoesSlots && typeof payload.sessoesSlots === 'object') {
            StudySessions.fundirSlotsRemotos(payload.sessoesSlots);
        }
        if (payload.sessoesBase && typeof payload.sessoesBase === 'object') {
            StudySessions.escrever(payload.sessoesBase);
        } else if (payload.sessoes && typeof payload.sessoes === 'object') {
            // Export antigo (totais sem separação base/slots).
            StudySessions.fundirLegado(payload.sessoes);
        }

        if (Array.isArray(payload.pdfs)) {
            localStorage.setItem('study-journal-pdfs', JSON.stringify(payload.pdfs));
        }

        if (Array.isArray(payload.caderno)) {
            localStorage.setItem('study-journal-caderno', JSON.stringify(payload.caderno));
        }
        if (Array.isArray(payload.cadernoApagados)) {
            localStorage.setItem('study-journal-caderno-apagados', JSON.stringify(payload.cadernoApagados));
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
        message: `As notas e tarefas de ${selected.toLocaleDateString('pt-PT')} são apagadas deste browser. A cópia na pasta local não é alterada.`,
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

    // Espelho vault → chaves locais (só com o vault acessível): o
    // Calendário/Disciplinas leem as chaves de cada dia, que no telemóvel
    // começam vazias. Só corre online, por isso não apaga edições offline.
    if (taskResult.ok && taskResult.existe) espelharVaultParaLocal(taskResult.content);

    if (doVault !== null) {
        tasks = doVault;
    } else {
        tasks = localTasks;
        if (localTasks.length > 0) {
            await syncTasks();
        }
    }

    // 2. Carregar Notas (Tenta o Vault primeiro, senão local).
    // O vault só ganha se mudou fora do site desde a última gravação
    // (mudou=true): se está igual ao conhecido, o editor é mais recente
    // e empurra-se para lá — era isto que ressuscitava texto apagado ao
    // recarregar (o espelho de 4s ainda não tinha corrido).
    const noteResult = await Vault.load(`${dayKey(selected)}.md`);
    if (noteResult.ok && noteResult.existe) {
        const local = read(notesKey(), '');
        if (!noteResult.mudou) {
            const ts = Number(localStorage.getItem(`${notesKey()}-ts`)) || 0;
            if (noteResult.content !== local && (local.trim() || ts > 0)) {
                try {
                    await Vault.save(`${dayKey(selected)}.md`, local);
                } catch { /* o botão manual cobre */ }
                els.notes.value = local;
            } else {
                els.notes.value = noteResult.content;
            }
        } else if (!noteResult.conhecido && local.trim()) {
            // Ficheiro que nunca vimos e editor com conteúdo: não arrisca.
            els.notes.value = local;
        } else {
            els.notes.value = noteResult.content;
        }
    } else {
        els.notes.value = read(notesKey(), '');
    }

    // Migra dataURLs antigos para tokens curtos (uma vez por conteúdo)
    const chaveNotas = dayKey(selected);
    if (window.Imagens && /data:image\//.test(els.notes.value)) {
        try {
            const { texto, mudou } = await window.Imagens.colapsarEmbutidas(els.notes.value);
            if (mudou && chaveNotas === dayKey(selected)) {
                els.notes.value = texto;
                commitNotes();
            }
        } catch { /* fica como está */ }
    }
    if (window.Imagens) window.Imagens.backfill().catch(() => {});

    els.wordCount.textContent = String(countWords(els.notes.value));
    setSaveStatus('');

    renderDate();
    renderTasks();
    await limparBlocosEstudoGerados();
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
    selectDate(next);
    await loadDay();
}

/* ── Navegação externa (pesquisa) e foco de revisão ─── */

async function abrirDiaChave(chave) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave || '');
    if (!m) return;
    commitNotes();
    selectDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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

// O plano free adormece: a primeira tentativa acorda o servidor e pode
// falhar, por isso o pull inicial repete-se com pausas crescentes.
function puxarComRepeticao(tentativas = [15000, 45000, 120000]) {
    if (!window.ContaSync) return;
    const reagendar = () => {
        if (!tentativas.length) return;
        const [espera, ...resto] = tentativas;
        setTimeout(() => puxarComRepeticao(resto), espera);
    };
    window.ContaSync.pull().then((r) => {
        if (r && r.ok) {
            if (r.atualizou) toast('Sincronizado.', 'success');
            if (typeof currentView !== 'undefined' && currentView === 'definicoes' && typeof renderSettings === 'function') renderSettings();
            return;
        }
        if (r && (r.reason === 'sem-conta' || r.reason === 'a-syncar')) return;
        reagendar();
    }).catch(reagendar);
}

function seed() {
    // As tarefas/notas de demonstração já não são criadas. Esta purga
    // remove as que o seed antigo deixou (ids demo-* e a nota de exemplo
    // intacta) em todos os aparelhos, incluindo telemóvel.
    limparDemo();
    try {
        localStorage.setItem('study-journal-seeded', '1');
    } catch { /* sem flag: tenta de novo no próximo arranque */ }
}

function limparDemo() {
    try {
        const chaves = [];
        for (let i = 0; i < localStorage.length; i += 1) chaves.push(localStorage.key(i) || '');
        chaves.forEach((k) => {
            if (/^study-journal-tasks-\d{4}-\d{2}-\d{2}$/.test(k)) {
                const list = read(k, []);
                if (!Array.isArray(list)) return;
                const filtrada = list.filter((t) => !(t && typeof t.id === 'string' && t.id.startsWith('demo-')));
                if (filtrada.length !== list.length) write(k, filtrada);
            } else if (/^study-journal-notes-\d{4}-\d{2}-\d{2}$/.test(k)) {
                if (read(k, '') === DEMO_NOTES) localStorage.removeItem(k);
            }
        });
    } catch { /* purga best-effort */ }
}

function bind() {
    document.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => {
            const navSelection = button.dataset.navKey || button.dataset.view;
            showView(button.dataset.view, navSelection);
            if (navSelection === 'weekly-review') {
                requestAnimationFrame(() => document.getElementById('weekly-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            }
        });
    });
    const mobileMore = document.getElementById('mobile-more-dialog');
    document.getElementById('mobile-more-btn')?.addEventListener('click', () => mobileMore?.showModal());
    document.getElementById('mobile-more-close')?.addEventListener('click', () => mobileMore?.close());

    els.dayPrev.addEventListener('click', () => shiftDay(-1));
    els.dayNext.addEventListener('click', () => shiftDay(1));

    els.calPrev.addEventListener('click', () => shiftMonth(-1));
    els.calNext.addEventListener('click', () => shiftMonth(1));
    els.calToday?.addEventListener('click', () => {
        selectDate(today);
        calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
        renderCalendar();
    });
    els.calSearch?.addEventListener('input', () => {
        calSearchTerm = textoCal(els.calSearch.value);
        renderCalendar();
    });
    document.querySelectorAll('[data-cal-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
            calViewMode = btn.dataset.calView || 'mes';
            renderCalendar();
        });
    });
    els.calNewEvent?.addEventListener('click', () => {
        const alvo = selected || today;
        showInlineTaskForm(null, dayKey(alvo), alvo);
    });

    document.getElementById('heatmap-prev')?.addEventListener('click', () => shiftHeatmap(-1));
    document.getElementById('heatmap-next')?.addEventListener('click', () => shiftHeatmap(1));
    document.querySelectorAll('[data-heatmap-view]').forEach((button) => {
        button.addEventListener('click', () => setHeatmapView(button.dataset.heatmapView));
    });

    // Session Timer
    document.getElementById('session-start')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('session-pause')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('session-stop')?.addEventListener('click', () => {
        cancelarSessao();
    });
    document.getElementById('session-subject')?.addEventListener('change', (e) => setSessionSubject(e.target.value));
    document.querySelectorAll('[data-session-preset]').forEach((btn) => {
        btn.addEventListener('click', () => setSessionMinutes(Number(btn.dataset.sessionPreset)));
    });

    // Estudar View Timer
    document.getElementById('estudar-start')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('estudar-pause')?.addEventListener('click', toggleSessionTimer);
    document.getElementById('estudar-stop')?.addEventListener('click', () => {
        cancelarSessao();
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

    // Objetivo da sessão: guardado e partilhado entre Painel e Concentração
    const goalInputs = ['session-goal', 'estudar-goal']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (goalInputs.length) {
        const guardado = read('study-journal-session-goal', '');
        goalInputs.forEach((input) => {
            if (guardado) input.value = guardado;
            input.addEventListener('input', () => {
                write('study-journal-session-goal', input.value.slice(0, 120));
                goalInputs.forEach((outro) => {
                    if (outro !== input && outro.value !== input.value) outro.value = input.value;
                });
            });
        });
    }

    els.taskForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const text = (els.taskInput.value || '').trim();
        if (!text) return;

        const category = (els.taskCategory?.value || document.getElementById('task-category')?.value || 'tarefa');
        const priority = (els.taskPriority?.value || document.getElementById('task-priority')?.value || 'media');
        await addTask(text, els.taskSubject.value || 'Geral', category, priority);
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
            toast('Atualizado da pasta local!', 'success');
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
            title: 'Desligar a pasta local?',
            message: 'O browser deixa de guardar o acesso à pasta. Os ficheiros já escritos não são tocados.',
            confirmLabel: 'Desligar',
        });

        if (!ok) return;

        await Vault.disconnect();
        renderVault('desligado');
        toast('Pasta local desligada.', 'info');
    });

    els.saveAllComputer.addEventListener('click', async () => {
        if (!(await Vault.hasLocalFolder())) {
            const result = await Vault.connect();
            if (!result.ok) {
                toast(result.reason === 'cancelado' ? 'Escolha de pasta cancelada.' : 'Escolhe uma pasta local para guardar os PDFs.', 'warn');
                return;
            }
        } else {
            const permission = await Vault.requestPermission();
            if (!permission.ok) {
                toast('Concede permissão à pasta local e tenta novamente.', 'warn');
                return;
            }
        }
        if (!(await Vault.hasLocalFolder())) {
            toast('A escolha de pasta local precisa de localhost ou HTTPS num browser compatível.', 'warn');
            return;
        }
        renderVault(await Vault.status());
        const resultado = await guardarDadosNoComputador();
        const partes = [`${resultado.notasGuardadas} notas guardadas`, `${resultado.ficheiros.guardados}/${resultado.ficheiros.total} PDFs copiados`];
        if (resultado.conflitos) partes.push(`${resultado.conflitos} conflitos por resolver`);
        toast(partes.join(' · '), resultado.conflitos || resultado.ficheiros.indisponiveis ? 'warn' : 'success');
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
        const central = window.ContaSync?.configurado?.() || false;
        if (githubNotConfigured) githubNotConfigured.hidden = cfg || central;
        if (githubConfigured) githubConfigured.hidden = !cfg && !central;
        if (central && githubStatus) githubStatus.textContent = cfg
            ? 'Sync da conta StudyJournal ativa; sincronização GitHub suspensa.'
            : 'Sync da conta StudyJournal ativa.';
        if (githubSyncNow) githubSyncNow.hidden = central;
        if (githubDisconnect) githubDisconnect.hidden = !cfg;
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
            if (window.ContaSync?.configurado?.()) {
                toast('A conta StudyJournal já é a fonte central. Termina sessão antes de ativar o Gist.', 'warn');
                return;
            }
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
            if (window.ContaSync?.configurado?.()) {
                toast('A sincronização GitHub está suspensa enquanto a conta StudyJournal está ligada.', 'info');
                atualizarUIEstados();
                return;
            }
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
        window.GitHubSync.onSync((tipo, detalhes = {}) => {
            registarSyncEvento(tipo);
            if (tipo === 'push-done' && detalhes.updatedAt) {
                // O nosso próprio push não deve disparar o recarregamento
                // que o próximo pull (com esta marca) faria.
                window.__gistUltimaMarca = detalhes.updatedAt;
            }
            if (tipo === 'pull-done') {
                // Só recarrega quando o Gist mudou de facto; e nunca por
                // cima do editor de notas em foco (o helper já protege).
                const remoto = detalhes.data || {};
                const marca = String(remoto.updatedAt || '');
                if (marca && marca !== window.__gistUltimaMarca) {
                    window.__gistUltimaMarca = marca;
                    recarregarAposSync();
                    window.dispatchEvent(new CustomEvent('studyjournal:pull'));
                }
            }
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
    const partilhaNome = document.getElementById('partilha-nome');
    const partilhaCriar = document.getElementById('partilha-criar');
    const partilhaLista = document.getElementById('partilha-lista');
    const partilhaCompleta = document.getElementById('partilha-completa');
    const partilhaAviso = document.getElementById('partilha-aviso');

    function textoEstadoConta() {
        if (window.ContaSync.ePartilha && window.ContaSync.ePartilha()) {
            return 'Ligado por link partilhado';
        }
        if (window.ContaSync.configurado()) {
            return `Ligado como ${window.ContaSync.getUser()}`;
        }
        if (window.ContaSync.emAberto && window.ContaSync.emAberto()) {
            return 'Espaço comum do site (todos os visitantes)';
        }
        return 'Desligado';
    }

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
        const anonimo = !cfg && window.ContaSync.emAberto && window.ContaSync.emAberto();
        if (contaLogin) contaLogin.hidden = cfg || anonimo;
        if (contaAtiva) contaAtiva.hidden = !(cfg || anonimo);
        if (contaSair) contaSair.hidden = !cfg;
        if (cfg || anonimo) {
            if (contaStatus) contaStatus.textContent = textoEstadoConta();
            pintarHoraConta();
            pintarPartilha();
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

    /* ── Partilha por link ─────────────────────────────── */

    async function pintarPartilha() {
        const partilha = window.ContaSync.ePartilha && window.ContaSync.ePartilha();
        const anonimo = !window.ContaSync.configurado();
        if (partilhaCompleta) partilhaCompleta.hidden = !!partilha || anonimo;
        if (partilhaAviso) partilhaAviso.hidden = !partilha;
        if (partilha || anonimo || currentView !== 'definicoes' || !partilhaLista) return;
        partilhaLista.replaceChildren();
        const res = await window.ContaSync.listarPartilhas();
        if (!res.ok) return;
        if (!res.partilhas.length) {
            const li = document.createElement('li');
            li.className = 'text-xs text-faint';
            li.textContent = 'Ainda sem links. Cria o primeiro em cima.';
            partilhaLista.append(li);
            return;
        }
        res.partilhas.forEach((p) => {
            const li = document.createElement('li');
            li.className = 'flex items-center gap-2 rounded-lg border border-line-soft bg-surface px-2.5 py-1.5 text-xs';
            const nome = document.createElement('span');
            nome.className = 'min-w-0 flex-1 truncate font-medium text-fg';
            nome.textContent = p.nome || 'Link sem nome';
            nome.title = p.nome || p.id;
            const quando = document.createElement('span');
            quando.className = 'shrink-0 tabular-nums text-faint';
            try {
                quando.textContent = p.criadoEm ? new Date(p.criadoEm).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }) : '';
            } catch { /* segue sem data */ }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-soft btn-soft-danger shrink-0 px-2 py-1 text-[11px]';
            btn.textContent = 'Revogar';
            btn.addEventListener('click', async () => {
                const ok = await askConfirm({
                    title: 'Revogar este link?',
                    message: 'Os aparelhos que usam este link deixam de sincronizar.',
                    confirmLabel: 'Revogar',
                });
                if (!ok) return;
                await window.ContaSync.revogarPartilha(p.id);
                pintarPartilha();
                toast('Link revogado.', 'info');
            });
            li.append(nome, quando, btn);
            partilhaLista.append(li);
        });
    }

    async function copiarLink(link) {
        try {
            await navigator.clipboard.writeText(link);
            toast('Link copiado. Partilha com quem quiseres.', 'success');
        } catch {
            prompt('Copia o link de partilha:', link);
        }
    }

    if (partilhaCriar) {
        partilhaCriar.addEventListener('click', async () => {
            if (!window.ContaSync) return;
            const res = await window.ContaSync.criarPartilha(partilhaNome?.value);
            if (!res.ok) {
                toast(`Erro: ${res.error || 'desconhecido'}`, 'error');
                return;
            }
            if (partilhaNome) partilhaNome.value = '';
            pintarPartilha();
            copiarLink(res.link);
        });
    }

    if (window.ContaSync && window.ContaSync.onSync) {
        window.ContaSync.onSync((tipo, detalhes = {}) => {
            registarSyncEvento(tipo);
            if (tipo === 'pull-done') {
                // Galerias (PDFs/Caderno) também devem refletir o pull.
                // (O ContaSync só emite pull-done quando o rev avançou.)
                window.dispatchEvent(new CustomEvent('studyjournal:pull'));
            }
            if (tipo === 'sync-done' || tipo === 'push-done' || tipo === 'pull-done') {
                atualizarUIConta();
                atualizarUIEstados();
                if (contaStatus && currentView === 'definicoes') {
                    if (tipo === 'pull-done' && detalhes.notasAdiadas) {
                        contaStatus.textContent = 'Sincronizado (notas atualizam ao sair da caixa)';
                    } else if (window.ContaSync.configurado()) {
                        contaStatus.textContent = textoEstadoConta();
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
    window.addEventListener('beforeunload', saveSessionState);
    window.addEventListener('beforeunload', guardarSessaoAoSair);
    window.addEventListener('pagehide', guardarSessaoAoSair);
    iniciarFlushSync();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (sessionTimer.running) tickSessionTimer();
        }
    });
    window.addEventListener('focus', () => {
        if (sessionTimer.running) tickSessionTimer();
        atualizarDiaLocal();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') atualizarDiaLocal();
    });
}

async function init() {
    seed();
    bind();
    restoreSessionState();
    const dataGuardada = localStorage.getItem('study-journal-selected-date');
    const modoData = localStorage.getItem(SELECTED_DATE_MODE_KEY);
    if (dataGuardada && modoData === 'custom') {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataGuardada);
        if (match) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (dayKey(date) === dataGuardada) selected = startOfDay(date);
        } else {
            // Compatibilidade com versões que guardavam a data em ISO.
            const date = new Date(dataGuardada);
            if (Number.isFinite(date.getTime())) selected = startOfDay(date);
        }
    } else {
        // Older builds persisted yesterday as the default selection. Treat
        // that as following today; historical browsing is explicitly marked.
        selectDate(today);
    }
    const vistaGuardada = read('study-journal-view', 'painel');
    showView(VIEW_LABELS[vistaGuardada] ? vistaGuardada : 'painel');

    await refreshVault();
    await loadDay();

    startVaultSync();
    syncDayFromVault();
    agendarMudancaDoDia();

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

    // Entrada por link de partilha (#p=...): sem palavra-passe.
    try {
        const m = /^#p=([A-Za-z0-9_%-]+)/.exec(window.location.hash || '');
        if (m && window.ContaSync && !window.ContaSync.configurado()) {
            const tk = decodeURIComponent(m[1]);
            window.ContaSync.usarPartilha(tk).then((r) => {
                if (r && r.ok) {
                    toast('Ligado por link partilhado e sincronizado.', 'success');
                    // Envia já o que foi escrito antes de o link ficar pronto
                    // (edits feitos offline ou nos primeiros segundos): sem
                    // isto só iam com o flush de 60s — ou nunca se a página
                    // fechasse entretanto.
                    descarregarSyncPendente().catch(() => {});
                } else {
                    toast(`Link inválido: ${(r && r.error) || 'não foi possível entrar.'}`, 'error');
                }
            }).catch(() => {});
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch { /* segue sem partilha */ }

    // Pull inicial da conta (se houver login): atualiza deste lado
    if (window.ContaSync && window.ContaSync.configurado()) {
        puxarComRepeticao();
    }

    // Servidor em modo aberto (SYNC_OPEN=1): sincroniza sem conta.
    // É isto que faz o link oficial funcionar sozinho em cada aparelho.
    if (window.ContaSync && !window.ContaSync.configurado()) {
        window.ContaSync.verificarAberto().then((ok) => {
            if (!ok) return;
            window.ContaSync.iniciarAuto();
            puxarComRepeticao();
        }).catch(() => {});
    }
    // Envia o que ficou pendente sem rede — já depois de o link de partilha
    // ter sido processado (usarPartilha valida o token e faz o primeiro
    // pull): sem reordenar isto, as edições feitas offline antes de abrir
    // o link só iam com o flush de 60s (ou nunca, se a página fechasse).
    descarregarSyncPendente().catch(() => {});
    pintarSyncSinal();
    setTimeout(verificarVersaoWeb, 30000);

    // PWA: regista o service worker (shell offline). Falha silenciosa
    // em contextos sem suporte — a app funciona na mesma.
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
                .then((reg) => reg.update().catch(() => {}))
                .catch(() => {});
        }
    } catch { /* segue sem PWA */ }
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
    document.querySelectorAll('.cal-classic-add').forEach(btn => btn.classList.add('hidden'));

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
    irARevisao() { showView('revisao'); },
    abrirReviewFocus,
};
window.ReviewSystem = ReviewSystem;
window.StudyStats = StudyStats;
window.StudySessions = StudySessions;
window.abrirReviewFocus = abrirReviewFocus;

init();
try { window.Revisao?.render?.(); } catch { /* segue */ }
Pdfs.carregar();
if (window.Caderno) window.Caderno.carregar();
