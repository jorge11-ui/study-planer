/* StudyJournal — estado, interface e integração com o vault. */

const els = {
    date: document.getElementById('current-date'),
    dateShort: document.getElementById('current-date-short'),
    dayPrev: document.getElementById('day-prev'),
    dayNext: document.getElementById('day-next'),

    pomodoro: document.getElementById('pomodoro'),
    pomodoroIcon: document.getElementById('pomodoro-icon'),
    pomodoroTime: document.getElementById('pomodoro-time'),
    pomodoroReset: document.getElementById('pomodoro-reset'),
    pomodoroStatus: document.getElementById('pomodoro-status'),
    pomodoroDuration: document.getElementById('pomodoro-duration'),
    pomodoroDurationToggle: document.getElementById('pomodoro-duration-toggle'),
    pomodoroDurationMenu: document.getElementById('pomodoro-duration-menu'),
    pomodoroDurationLabel: document.getElementById('pomodoro-duration-label'),
    pomodoroPresets: [...document.querySelectorAll('[data-pomodoro-minutes]')],

    taskForm: document.getElementById('task-form'),
    taskInput: document.getElementById('task-input'),
    taskSubject: document.getElementById('task-subject'),
    taskList: document.getElementById('task-list'),
    taskEmpty: document.getElementById('task-empty'),
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
    node.className = `toast pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-pop ${TOAST_STYLES[type]}`;

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

/* ── Tarefas ──────────────────────────────────────────── */

async function setTaskDone(id, done) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    task.done = done;
    await syncTasks();
    renderTasks();

    if (currentView === 'disciplinas') renderSubjects();
}

async function syncTasks() {
    try {
        await Vault.save('tasks.json', JSON.stringify(tasks));
    } catch (e) {
        console.error('Erro ao sincronizar tarefas:', e);
    }
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

        const body = document.createElement('div');
        body.className = 'flex min-w-0 flex-1 flex-col gap-1.5';
        const line = document.createElement('div');
        line.className = 'flex items-start gap-2.5';
        line.append(checkbox, text);
        body.append(line, chip);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.ariaLabel = `Apagar tarefa: ${task.text}`;
        remove.innerHTML = '<svg class="icon h-4 w-4"><use href="#i-trash"/></svg>';
        remove.className = 'task-remove shrink-0 rounded-lg p-1 text-faint opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-subject-rose focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-subject-rose';
        remove.addEventListener('click', () => {
            tasks = tasks.filter((t) => t.id !== task.id);
            write(tasksKey(), tasks);
            renderTasks();
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

    els.progressFill.style.width = total ? `${(done / total) * 100}%` : '0%';
    els.progressLabel.textContent = total
        ? `${done} de ${total} ${total === 1 ? 'tarefa concluída' : 'tarefas concluídas'}`
        : 'Sem tarefas para este dia';
}

async function addTask(text, subject) {
    tasks.push({ id: `${Date.now()}-${tasks.length}`, text, subject, done: false });
    await syncTasks();
    renderTasks();
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
}

function onNotesInput() {
    els.wordCount.textContent = String(countWords(els.notes.value));
    setSaveStatus('a guardar…');

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

/* ── Pomodoro ─────────────────────────────────────────── */

const POMODORO_MINUTES = [15, 25, 50, 90];
const POMODORO_DEFAULT = 25;
const POMODORO_KEY = 'study-journal-pomodoro-minutes';

function readPomodoroMinutes() {
    const saved = Number(read(POMODORO_KEY, POMODORO_DEFAULT));
    return POMODORO_MINUTES.includes(saved) ? saved : POMODORO_DEFAULT;
}

const pomodoro = {
    minutes: readPomodoroMinutes(),
    remaining: 0,
    running: false,
    timer: null,
};

function formatClock(total) {
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderPomodoro() {
    const full = pomodoro.minutes * 60;

    els.pomodoroTime.textContent = formatClock(pomodoro.remaining);
    els.pomodoroIcon.classList.toggle('running', pomodoro.running);
    els.pomodoroReset.classList.toggle('hidden', pomodoro.remaining === full);
    els.pomodoroDurationLabel.textContent = `${pomodoro.minutes} min`;

    els.pomodoroPresets.forEach((option) => {
        const selected = Number(option.dataset.pomodoroMinutes) === pomodoro.minutes;
        option.setAttribute('aria-checked', String(selected));
        option.classList.toggle('text-fg', selected);
        option.classList.toggle('text-muted', !selected);
        option.querySelector('[data-check]').classList.toggle('opacity-0', !selected);
        option.querySelector('[data-check]').classList.toggle('text-brand-light', selected);
    });
}

function tickPomodoro() {
    pomodoro.remaining -= 1;

    if (pomodoro.remaining <= 0) {
        stopPomodoro();
        pomodoro.remaining = pomodoro.minutes * 60;
        renderPomodoro();
        playAlarm();
        announcePomodoro('Pomodoro concluído. Pausa de 5 minutos.');
        toast('Pomodoro concluído. Pausa de 5 minutos.', 'success');
        return;
    }

    renderPomodoro();
}

function startPomodoro() {
    unlockAlarm();
    if (pomodoro.timer) clearInterval(pomodoro.timer);
    pomodoro.timer = setInterval(tickPomodoro, 1000);
    pomodoro.running = true;
    renderPomodoro();
    announcePomodoro(`Pomodoro de ${pomodoro.minutes} minutos iniciado.`);
}

function stopPomodoro() {
    if (pomodoro.timer) clearInterval(pomodoro.timer);
    pomodoro.timer = null;
    pomodoro.running = false;
}

function togglePomodoro() {
    if (pomodoro.running) {
        stopPomodoro();
        renderPomodoro();
        announcePomodoro('Pomodoro em pausa.');
        return;
    }

    startPomodoro();
}

function resetPomodoro() {
    stopPomodoro();
    pomodoro.remaining = pomodoro.minutes * 60;
    renderPomodoro();
}

function announcePomodoro(message) {
    els.pomodoroStatus.textContent = message;
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

function setPomodoroMinutes(minutes) {
    if (!POMODORO_MINUTES.includes(minutes) || minutes === pomodoro.minutes) return;

    const wasRunning = pomodoro.running;
    stopPomodoro();
    pomodoro.minutes = minutes;
    pomodoro.remaining = minutes * 60;
    write(POMODORO_KEY, minutes);

    if (wasRunning) startPomodoro();
    else renderPomodoro();

    announcePomodoro(`Duração do pomodoro: ${minutes} minutos.`);
    if (wasRunning) toast(`Pomodoro de ${minutes} min. A contagem recomeçou.`, 'info');
}

/* Menu de duração */

function isDurationMenuOpen() {
    return !els.pomodoroDurationMenu.hidden;
}

function openDurationMenu() {
    els.pomodoroDurationMenu.hidden = false;
    els.pomodoroDurationToggle.setAttribute('aria-expanded', 'true');

    const active = els.pomodoroPresets.find((option) => option.getAttribute('aria-checked') === 'true');
    (active ?? els.pomodoroPresets[0]).focus();
}

function closeDurationMenu({ focusToggle = false } = {}) {
    if (!isDurationMenuOpen()) return;

    els.pomodoroDurationMenu.hidden = true;
    els.pomodoroDurationToggle.setAttribute('aria-expanded', 'false');
    if (focusToggle) els.pomodoroDurationToggle.focus();
}

function movePresetFocus(step) {
    const current = els.pomodoroPresets.indexOf(document.activeElement);
    const next = (current + step + els.pomodoroPresets.length) % els.pomodoroPresets.length;
    els.pomodoroPresets[next].focus();
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
    card.className = 'flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-pop';

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
    if (lastVaultState !== 'ligado') return;
    if (document.activeElement === els.notes) return;

    const key = dayKey(selected);
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
    pdfs: 'PDFs',
    semanal: 'Semanal',
    definicoes: 'Definições',
};

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/* Todas as vistas num único ficheiro, trocadas pela navegação lateral. */
function showView(view) {
    currentView = view;

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

    if (view === 'calendario') renderCalendar();
    if (view === 'disciplinas') renderSubjects();
    if (view === 'definicoes') renderSettings();
    if (view === 'pdfs') Pdfs.ligar();
    if (view === 'semanal') Weekly.ligar();

    document.title = `${VIEW_LABELS[view]} · StudyJournal`;
    window.scrollTo({ top: 0 });
}

/* ── Calendário ───────────────────────────────────────── */

let calCursor = new Date(today.getFullYear(), today.getMonth(), 1);

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

    const withData = daysWithData();
    const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
    // Semana começa à segunda
    const offset = (first.getDay() + 6) % 7;

    els.calGrid.replaceChildren();

    for (let i = 0; i < 42; i += 1) {
        const date = new Date(first);
        date.setDate(first.getDate() - offset + i);

        const key = dayKey(date);
        const inMonth = date.getMonth() === calCursor.getMonth();
        const isToday = date.getTime() === today.getTime();
        const isSelected = date.getTime() === selected.getTime();
        const hasData = withData.has(key);

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'relative grid aspect-square place-items-center rounded-xl border text-sm transition';
        cell.ariaLabel = date.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        if (!inMonth) cell.classList.add('border-transparent', 'text-faint/40', 'hover:text-faint');
        if (inMonth && hasData) cell.classList.add('bg-surface-3', 'text-fg', 'hover:bg-line');
        if (inMonth && !hasData) cell.classList.add('border-transparent', 'text-muted', 'hover:bg-surface-2');
        if (isToday) cell.classList.add('border-brand/60', 'font-semibold', 'text-brand-light');
        if (isSelected) {
            cell.classList.remove('text-brand-light', 'text-muted', 'text-fg', 'bg-surface-3');
            cell.classList.add('border-brand', 'bg-brand', 'text-white', 'font-semibold');
        }

        cell.classList.add('focus-visible:outline-2', 'focus-visible:outline-offset-1', 'focus-visible:outline-brand');

        const number = document.createElement('span');
        number.textContent = String(date.getDate());
        cell.append(number);

        if (hasData && !isSelected) {
            const dot = document.createElement('span');
            dot.className = `absolute bottom-1.5 h-1 w-1 rounded-full ${inMonth ? 'bg-brand-light' : 'bg-faint/40'}`;
            cell.append(dot);
        }

        cell.addEventListener('click', () => openDay(date));
        els.calGrid.append(cell);
    }
}

function shiftMonth(delta) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
    renderCalendar();
}

async function openDay(date) {
    if (date.getTime() > today.getTime()) {
        toast('Ainda não chegaste a esse dia.', 'warn');
        return;
    }

    commitNotes();
    selected = startOfDay(date);
    calCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);

    await loadDay();
    showView('painel');
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

        const card = document.createElement('article');
        card.className = 'flex flex-col gap-3 rounded-xl border border-line-soft bg-surface-2 p-4';

        const head = document.createElement('div');
        head.className = 'flex items-center gap-2';

        const chip = document.createElement('span');
        chip.className = `chip ${SUBJECTS[subject] ?? SUBJECTS['Geral']}`;
        chip.textContent = subject;

        const counter = document.createElement('span');
        counter.className = 'ml-auto text-[11px] tabular-nums text-faint';
        counter.textContent = `${done}/${list.length} · ${total} no total`;

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
        card.className = 'flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-pop';

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

    if (!Object.keys(payload.days).length && !payload.semanal.fixos.length && !payload.semanal.dinamicos.length) {
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

        if (!count && (!payload.semanal || (!payload.semanal.fixos.length && !payload.semanal.dinamicos.length))) {
            throw new Error('sem dias');
        }

        await loadDay();
        if (window.Weekly && Weekly.ligar) Weekly.ligar();
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

    els.dayNext.disabled = selected.getTime() >= today.getTime();
}

async function loadDay() {
    // 1. Carregar Tarefas
    const taskResult = await Vault.load('tasks.json');
    const localTasks = read(tasksKey(), []);

    if (taskResult.ok && taskResult.existe) {
        try {
            tasks = JSON.parse(taskResult.content);
        } catch {
            tasks = localTasks;
        }
    } else {
        tasks = localTasks;
        if (localTasks.length > 0) {
            const handle = await Vault.localHandle();
            if (handle) {
                await syncTasks();
            }
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

    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'disciplinas') renderSubjects();
    if (currentView === 'definicoes') renderSettings();
}

async function shiftDay(delta) {
    const next = startOfDay(selected);
    next.setDate(next.getDate() + delta);

    if (next.getTime() > today.getTime()) return;

    commitNotes();
    selected = next;
    await loadDay();
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

    els.pomodoro.addEventListener('click', togglePomodoro);
    els.pomodoroReset.addEventListener('click', resetPomodoro);

    els.pomodoroDurationToggle.addEventListener('click', () => {
        if (isDurationMenuOpen()) closeDurationMenu();
        else openDurationMenu();
    });

    els.pomodoroDurationMenu.addEventListener('click', (event) => {
        const option = event.target.closest('[data-pomodoro-minutes]');
        if (!option) return;

        setPomodoroMinutes(Number(option.dataset.pomodoroMinutes));
        closeDurationMenu({ focusToggle: true });
    });

    els.pomodoroDurationMenu.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            movePresetFocus(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            movePresetFocus(-1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            els.pomodoroPresets[0].focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            els.pomodoroPresets[els.pomodoroPresets.length - 1].focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeDurationMenu({ focusToggle: true });
        } else if (event.key === 'Tab') {
            closeDurationMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!els.pomodoroDuration.contains(event.target)) closeDurationMenu();
    });

    document.addEventListener('focusin', (event) => {
        if (!els.pomodoroDuration.contains(event.target)) closeDurationMenu();
    });

    els.taskForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const text = els.taskInput.value.trim();
        if (!text) return;

        await addTask(text, els.taskSubject.value);
        els.taskInput.value = '';
        els.taskInput.focus();
    });

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

    els.vaultChip.addEventListener('click', async () => {
        const state = await Vault.status();
        if (state === 'ligado') {
            toast(`As notas vão para ${Vault.FOLDER}/<data>.md no vault.`, 'info');
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

    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            persistToVault();
        }
    });

    window.addEventListener('beforeunload', commitNotes);
}

async function init() {
    seed();
    bind();
    await refreshVault();
    await loadDay();
    resetPomodoro();
    showView('painel');
    startVaultSync();
    syncDayFromVault();
}

init();
Pdfs.carregar();
