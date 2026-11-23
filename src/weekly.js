window.Weekly = (() => {
    const CHAVE_FIXO = 'study-journal-semanal-fixo';
    const CHAVE_DINAMICO_PREFIXO = 'study-journal-semanal-dinamico-';
    const CHAVE_DINAMICO_ATUAL = 'study-journal-semanal-dinamico-atual';
    const CHAVE_PASSO = 'study-journal-semanal-passo';
    const CHAVE_VISTA = 'study-journal-semanal-vista';
    const CHAVE_FIM_SEMANA = 'study-journal-semanal-fim-semana';
    const CHAVE_INICIO = 'study-journal-semanal-inicio';
    const CHAVE_FIM = 'study-journal-semanal-fim';
    const CHAVE_PREFS_TS = 'study-journal-semanal-prefs-ts';
    const PREF_KEYS = new Set([CHAVE_PASSO, CHAVE_VISTA, CHAVE_FIM_SEMANA, CHAVE_INICIO, CHAVE_FIM]);

    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const DIAS_COMPLETOS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
    const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

    const HORA_INICIO = 6;
    const HORA_FIM = 24;
    const INICIO_MIN = 5;
    const INICIO_MAX = 12;
    const FIM_MIN = 13;
    const FIM_MAX = 24;
    const PASSOS_VALIDOS = [0.25, 0.5, 1];
    const PX_POR_HORA = 64;

    const COR_MAP = {
        brand: '--color-brand',
        blue: '--color-subject-blue',
        green: '--color-subject-green',
        yellow: '--color-subject-yellow',
        cyan: '--color-subject-cyan',
        rose: '--color-subject-rose',
        purple: '--color-subject-violet',
    };

    const TEXTOS = {
        fixo: 'Fixo (recorrente)',
        dinamico: 'Dinâmico (semanal)',
        novoTitulo: 'Nova aula ou bloco',
        editarTitulo: 'Editar aula ou bloco',
        semCompromissos: 'Semana sem compromissos. Clica num horário para adicionar.',
        apagar: 'Apagar',
        salvar: 'Guardar',
        cancelar: 'Cancelar',
    };

    let passoHoras = 0.5;
    let horaInicio = 7;
    let horaFim = 23;
    let vista = 'semana';
    let mostrarFimSemana = false;
    let fimSemanaPref = null;
    let SLOTS = [];
    let SLOTS_FORM = [];

    let fixos = [];
    let dinamicos = [];
    let semanaAtual = '';
    let editandoId = null;
    let modoEdicao = false;
    let diaVisivel = null;
    let arrastando = null;
    let duplicando = null;
    let criacaoArrastada = false;
    let ignorarClique = false;
    let relogioTimer = null;
    let criacao = null;
    let rafCriacao = 0;
    let resizeData = null;
    let moverData = null;

    /* ── Utilitários ─────────────────────────────────────── */

    function ler(chave, fallback = '') {
        try {
            const valor = localStorage.getItem(chave);
            return valor === null ? fallback : valor;
        } catch {
            return fallback;
        }
    }

    function guardar(chave, valor) {
        try {
            localStorage.setItem(chave, String(valor));
            // Preferências do horário viajam com carimbo próprio para o
            // outro aparelho não as repor com uma versão antiga.
            if (PREF_KEYS.has(chave)) {
                localStorage.setItem(CHAVE_PREFS_TS, String(Date.now()));
                if (typeof pushDebounced === 'function') pushDebounced(1200);
            }
        } catch { /* segue sem persistir */ }
    }

    function escapar(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function normalizar(texto) {
        return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function arredondar(n) {
        return Math.round(n * 100) / 100;
    }

    function fmtHora(h) {
        const total = Math.round(Number(h) * 60);
        const hh = Math.floor(total / 60);
        const mm = total % 60;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    function fmtDuracao(d) {
        const totalMin = Math.max(0, Math.round(Number(d) * 60));
        if (totalMin < 60) return `${totalMin} min`;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }

    function fmtMin(min) {
        const total = Math.max(0, Math.round(Number(min) || 0));
        if (!total) return '0h';
        const h = Math.floor(total / 60);
        const m = total % 60;
        if (!h) return `${m} min`;
        return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }

    function notificar(mensagem, tipo = 'info') {
        try {
            if (typeof window.toast === 'function') window.toast(mensagem, tipo);
        } catch { /* sem toast */ }
    }

    function confirmar(mensagem) {
        try {
            if (typeof window.confirm === 'function') return window.confirm(mensagem);
        } catch { /* segue */ }
        return true;
    }

    function setTexto(id, valor) {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    function setHTML(id, valor) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = valor;
    }

    function marcarIgnorarClique() {
        ignorarClique = true;
        setTimeout(() => { ignorarClique = false; }, 280);
    }

    /* ── Datas ───────────────────────────────────────────── */

    function dataDaSemana(key) {
        const [ano, mes, dia] = String(key || '').split('-').map(Number);
        if (!ano || !mes || !dia) return new Date();
        return new Date(ano, mes - 1, dia);
    }

    function semanaKey(date = new Date()) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    function diaDaSemanaHoje() {
        return ((new Date().getDay() + 6) % 7) + 1;
    }

    function inicioSemanaDate() {
        return dataDaSemana(semanaAtual);
    }

    function dataDoDia(dia) {
        const d = new Date(inicioSemanaDate());
        d.setDate(d.getDate() + Number(dia) - 1);
        return d;
    }

    function dataHoje() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function isHoje(date) {
        return date.toDateString() === new Date().toDateString();
    }

    function isSemanaAtual() {
        return semanaAtual === semanaKey(new Date());
    }

    function anoLetivo(date) {
        const ano = date.getFullYear();
        const mes = date.getMonth();
        return mes >= 8 ? `${ano}/${ano + 1}` : `${ano - 1}/${ano}`;
    }

    function periodoLetivo(date) {
        const mes = date.getMonth();
        if (mes >= 8) return '1.º Período';
        if (mes <= 2) return '2.º Período';
        if (mes <= 5) return '3.º Período';
        return 'Férias de verão';
    }

    function fmtRange(inicio, fim, curto = false) {
        const d1 = new Date(inicio);
        const d2 = new Date(fim);
        const mesmoMes = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
        if (curto) {
            return mesmoMes
                ? `${d1.getDate()} – ${d2.getDate()} ${MESES_CURTOS[d2.getMonth()]}`
                : `${d1.getDate()} ${MESES_CURTOS[d1.getMonth()]} – ${d2.getDate()} ${MESES_CURTOS[d2.getMonth()]}`;
        }
        return mesmoMes
            ? `${d1.getDate()} – ${d2.getDate()} ${MESES_CURTOS[d2.getMonth()]} ${d2.getFullYear()}`
            : `${d1.getDate()} ${MESES_CURTOS[d1.getMonth()]} – ${d2.getDate()} ${MESES_CURTOS[d2.getMonth()]} ${d2.getFullYear()}`;
    }

    function fmtDiaLongo(date) {
        return `${DIAS_COMPLETOS[((date.getDay() + 6) % 7)]}, ${date.getDate()} de ${MESES_LONGOS[date.getMonth()]}`;
    }

    function fmtCountdown(minutos) {
        const m = Math.max(0, Math.round(minutos));
        if (m <= 1) return 'Agora';
        if (m < 60) return `em ${m} min`;
        if (m < 1440) {
            const h = Math.floor(m / 60);
            const r = m % 60;
            return r ? `em ${h}h${String(r).padStart(2, '0')}` : `em ${h}h`;
        }
        const dias = Math.round(m / 1440);
        return dias === 1 ? 'Amanhã' : `em ${dias} dias`;
    }

    /* ── Preferências e dados ────────────────────────────── */

    function construirSlots() {
        SLOTS = [];
        const inicioMin = Math.round(horaInicio * 60);
        const fimMin = Math.round(horaFim * 60);
        const passoMin = Math.round(passoHoras * 60);
        for (let m = inicioMin; m < fimMin; m += passoMin) SLOTS.push(m / 60);
    }

    function construirSlotsForm() {
        SLOTS_FORM = [];
        for (let m = HORA_INICIO * 60; m < HORA_FIM * 60; m += 15) SLOTS_FORM.push(m / 60);
    }

    function lerNumero(chave, fallback, min, max) {
        const valor = Number(ler(chave, ''));
        return Number.isFinite(valor) && valor >= min && valor <= max ? valor : fallback;
    }

    function lerPreferencias() {
        const passo = Number(ler(CHAVE_PASSO, ''));
        if (PASSOS_VALIDOS.includes(passo)) passoHoras = passo;

        horaInicio = lerNumero(CHAVE_INICIO, 7, INICIO_MIN, INICIO_MAX);
        horaFim = lerNumero(CHAVE_FIM, 23, FIM_MIN, FIM_MAX);
        if (horaFim <= horaInicio) {
            horaInicio = 7;
            horaFim = 23;
        }

        const vistaGuardada = ler(CHAVE_VISTA, '');
        vista = vistaGuardada === 'dia' || vistaGuardada === 'semana'
            ? vistaGuardada
            : (window.innerWidth < 760 ? 'dia' : 'semana');

        const fimSemanaGuardado = ler(CHAVE_FIM_SEMANA, '');
        fimSemanaPref = fimSemanaGuardado === '1' ? true : fimSemanaGuardado === '0' ? false : null;
    }

    function lerFixos() {
        try {
            const raw = localStorage.getItem(CHAVE_FIXO);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function escreverFixos() {
        try {
            localStorage.setItem(CHAVE_FIXO, JSON.stringify(fixos));
            return true;
        } catch {
            return false;
        }
    }

    function lerDinamicos(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function escreverDinamicos(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            localStorage.setItem(`${key}-ts`, String(Date.now()));
            return true;
        } catch {
            return false;
        }
    }

    function normalizarEvento(e) {
        const hora = Math.min(HORA_FIM - 0.25, Math.max(HORA_INICIO, Number(e.hora) || HORA_INICIO));
        const duracao = Math.min(HORA_FIM - hora, Math.max(0.25, Number(e.duracao) || 1));
        return {
            id: String(e.id),
            titulo: String(e.titulo || '').trim(),
            dia: Math.min(7, Math.max(1, Number(e.dia) || 1)),
            hora: arredondar(hora),
            duracao: arredondar(duracao),
            cor: String(e.cor || 'brand'),
            notas: String(e.notas || ''),
            sala: String(e.sala || '').trim(),
            professor: String(e.professor || '').trim(),
            layer: e.layer === 'dinamico' ? 'dinamico' : 'fixo',
            examPlanItemId: e.examPlanItemId ? String(e.examPlanItemId) : '',
            examPlanId: e.examPlanId ? String(e.examPlanId) : '',
        };
    }

    function carregar() {
        lerPreferencias();
        construirSlotsForm();
        fixos = lerFixos().map(normalizarEvento);
        semanaAtual = semanaAtual || semanaKey();
        guardar(CHAVE_DINAMICO_ATUAL, semanaAtual);
        dinamicos = lerDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual).map(normalizarEvento);

        if (fimSemanaPref === null) {
            mostrarFimSemana = [...fixos, ...dinamicos].some((e) => e.dia >= 6);
        } else {
            mostrarFimSemana = fimSemanaPref;
        }
        construirSlots();
    }

    function salvar() {
        escreverFixos();
        escreverDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual, dinamicos);
        if (window.onWeeklySave) window.onWeeklySave();
    }

    function todosEventos() {
        return [...fixos, ...dinamicos];
    }

    function eventosDoDia(dia) {
        return todosEventos()
            .filter((e) => e.dia === Number(dia))
            .sort((a, b) => a.hora - b.hora || b.duracao - a.duracao);
    }

    function localizarEvento(id, layer) {
        const lista = layer === 'dinamico' ? dinamicos : fixos;
        return lista.find((e) => e.id === id) || todosEventos().find((e) => e.id === id) || null;
    }

    function removerEvento(id) {
        fixos = fixos.filter((e) => e.id !== id);
        dinamicos = dinamicos.filter((e) => e.id !== id);
    }

    function diasVisiveis() {
        if (vista === 'dia') return [diaVisivel || 1];
        return mostrarFimSemana ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
    }

    function guardarVista() {
        guardar(CHAVE_VISTA, vista);
    }

    /* ── Render ──────────────────────────────────────────── */

    function render() {
        const section = document.getElementById('view-semanal');
        if (!section || !document.getElementById('week-body')) return;

        if (diaVisivel === null) diaVisivel = isSemanaAtual() ? diaDaSemanaHoje() : 1;

        const scroller = document.getElementById('week-scroll-y');
        const scrollTop = scroller ? scroller.scrollTop : 0;

        section.dataset.wksVista = vista;
        section.classList.toggle('is-editing', modoEdicao);

        renderHeader();
        renderDayPicker();
        renderGrid();
        renderSidebar();
        atualizarLinhaAtual();

        if (scroller) scroller.scrollTop = scrollTop;
    }

    function renderHeader() {
        const inicio = inicioSemanaDate();
        const fim = dataDoDia(7);
        const atual = isSemanaAtual();
        const semana = getWeekNumber(inicio);

        setTexto('week-label', fmtRange(inicio, fim));
        setTexto('week-number', `Semana ${semana}`);
        setTexto('week-year', anoLetivo(inicio));
        setTexto('week-period', periodoLetivo(inicio));
        setTexto('week-side-range', fmtRange(inicio, fim, true));

        const caption = vista === 'dia'
            ? fmtDiaLongo(dataDoDia(diaVisivel || 1))
            : `Semana ${semana} · ${diasVisiveis().length} ${diasVisiveis().length === 1 ? 'dia' : 'dias'}`;
        setTexto('week-cal-caption', caption);

        const btnToday = document.getElementById('week-today');
        if (btnToday) btnToday.classList.toggle('is-current', atual);

        document.querySelectorAll('[data-week-view]').forEach((btn) => {
            const ativo = btn.dataset.weekView === vista;
            btn.classList.toggle('is-active', ativo);
            btn.setAttribute('aria-pressed', String(ativo));
        });

        const btnEdit = document.getElementById('week-edit');
        if (btnEdit) {
            btnEdit.classList.toggle('is-active', modoEdicao);
            btnEdit.setAttribute('aria-pressed', String(modoEdicao));
            const span = btnEdit.querySelector('span');
            if (span) span.textContent = modoEdicao ? 'Concluir' : 'Editar horário';
            btnEdit.title = modoEdicao ? 'Sair do modo de edição' : 'Ativar modo de edição';
        }

        const quickEdit = document.getElementById('week-quick-edit');
        if (quickEdit) {
            const span = quickEdit.querySelector('span');
            if (span) span.textContent = modoEdicao ? 'Concluir edição' : 'Editar horário';
        }

        const editBar = document.getElementById('week-edit-bar');
        if (editBar) editBar.hidden = !modoEdicao;

        const btnWeekend = document.getElementById('week-weekend');
        if (btnWeekend) {
            btnWeekend.setAttribute('aria-pressed', String(mostrarFimSemana));
            btnWeekend.title = mostrarFimSemana ? 'Esconder sábado e domingo' : 'Mostrar sábado e domingo';
        }

        const checkWeekend = document.getElementById('week-weekend-setting');
        if (checkWeekend) checkWeekend.checked = mostrarFimSemana;

        document.querySelectorAll('[data-week-passo]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(Number(btn.dataset.weekPasso) === passoHoras));
        });

        const selectInicio = document.getElementById('week-start');
        const selectFim = document.getElementById('week-end');
        if (selectInicio) selectInicio.value = String(horaInicio);
        if (selectFim) selectFim.value = String(horaFim);
    }

    function renderDayPicker() {
        const picker = document.getElementById('week-day-picker');
        if (!picker) return;
        picker.hidden = vista !== 'dia';
        if (picker.hidden) {
            picker.innerHTML = '';
            return;
        }

        picker.innerHTML = DIAS.map((nome, i) => {
            const dia = i + 1;
            const data = dataDoDia(dia);
            const classes = [
                'wks-picker-day',
                dia === diaVisivel ? 'is-active' : '',
                isHoje(data) ? 'is-today' : '',
            ].filter(Boolean).join(' ');
            return `<button type="button" class="${classes}" data-week-dia="${dia}" aria-pressed="${dia === diaVisivel}" title="${DIAS_COMPLETOS[i]} ${data.getDate()}">
                <span>${nome}</span>
                <strong>${data.getDate()}</strong>
            </button>`;
        }).join('');
    }

    function renderGrid() {
        const section = document.getElementById('view-semanal');
        const head = document.getElementById('week-days-head');
        const gutter = document.getElementById('week-gutter');
        const body = document.getElementById('week-body');
        const grid = document.getElementById('week-grid');
        const empty = document.getElementById('week-empty');
        if (!section || !head || !gutter || !body || !grid) return;

        const dias = diasVisiveis();
        const totalAltura = Math.round((horaFim - horaInicio) * PX_POR_HORA);
        section.style.setProperty('--wks-day-count', String(dias.length));
        section.style.setProperty('--wks-hour-h', `${PX_POR_HORA}px`);

        grid.style.height = `${totalAltura}px`;

        if (vista === 'dia') {
            head.innerHTML = '';
            head.style.display = 'none';
        } else {
            head.style.display = '';
            head.innerHTML = `<div class="wks-head-gutter"><span>Hora</span></div>
                <div class="wks-head-days">${dias.map(renderDayHead).join('')}</div>`;
        }

        gutter.innerHTML = SLOTS.map((hora, i) => {
            const top = Math.round((hora - horaInicio) * PX_POR_HORA);
            const label = fmtHora(hora);
            return `<span class="wks-gutter-label" style="top:${top}px">${label}</span>`;
        }).join('');

        body.innerHTML = dias.map(renderDayColumn).join('');

        const visiveis = todosEventos().filter((e) => dias.includes(e.dia));
        if (empty) {
            empty.hidden = visiveis.length > 0;
            const span = empty.querySelector('span');
            if (span) {
                span.textContent = todosEventos().length
                    ? 'Sem blocos nos dias visíveis. Muda de vista ou clica num horário para adicionar.'
                    : 'Semana livre. Clica num horário para adicionar a primeira aula.';
            }
        }
    }

    function renderDayHead(dia) {
        const data = dataDoDia(dia);
        const eventos = eventosDoDia(dia);
        const classes = [
            'wks-day-head',
            isHoje(data) ? 'is-today' : '',
            eventos.length ? 'has-events' : '',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-week-day-head="${dia}" title="Ver ${DIAS_COMPLETOS[dia - 1]}">
            <span class="wks-day-name">${DIAS[dia - 1]}</span>
            <span class="wks-day-date">${data.getDate()}</span>
        </button>`;
    }

    function renderDayColumn(dia) {
        const data = dataDoDia(dia);
        const eventos = eventosDoDia(dia);
        const layout = layoutEventos(eventos);
        const classes = [
            'wks-day-col',
            isHoje(data) ? 'is-today' : '',
            dia >= 6 ? 'is-weekend' : '',
        ].filter(Boolean).join(' ');

        const slots = SLOTS.map((hora, i) => {
            const tabindex = i === 0 ? '0' : '-1';
            return `<div class="wks-slot" role="gridcell" tabindex="${tabindex}" data-dia="${dia}" data-hora="${hora}" aria-label="${DIAS_COMPLETOS[dia - 1]}, ${fmtHora(hora)}"></div>`;
        }).join('');

        const blocos = layout.map((item) => renderEvento(item)).join('');

        return `<div class="${classes}" data-dia="${dia}" role="row" aria-label="${DIAS_COMPLETOS[dia - 1]}">
            <div class="wks-slots">${slots}</div>
            ${blocos}
        </div>`;
    }

    function layoutEventos(eventos) {
        const ordenados = [...eventos].sort((a, b) => a.hora - b.hora || b.duracao - a.duracao);
        const resultado = [];
        let grupo = [];
        let fimGrupo = -1;
        const pistas = new Map();

        const fecharGrupo = () => {
            if (!grupo.length) return;
            const ocupacao = [];
            grupo.forEach((evento) => {
                let pista = ocupacao.findIndex((fim) => fim <= evento.hora + 0.0001);
                if (pista === -1) {
                    pista = ocupacao.length;
                    ocupacao.push(0);
                }
                ocupacao[pista] = evento.hora + evento.duracao;
                pistas.set(evento, pista);
            });
            const total = Math.max(1, ocupacao.length);
            grupo.forEach((evento) => {
                resultado.push({
                    evento,
                    left: (pistas.get(evento) / total) * 100,
                    width: (1 / total) * 100,
                });
            });
            grupo = [];
            fimGrupo = -1;
        };

        ordenados.forEach((evento) => {
            if (grupo.length && evento.hora >= fimGrupo - 0.0001) fecharGrupo();
            grupo.push(evento);
            fimGrupo = Math.max(fimGrupo, evento.hora + evento.duracao);
        });
        fecharGrupo();

        return resultado.filter(({ evento }) => evento.hora < horaFim && evento.hora + evento.duracao > horaInicio);
    }

    function renderEvento({ evento, left, width }) {
        const inicioVisivel = Math.max(evento.hora, horaInicio);
        const fimVisivel = Math.min(evento.hora + evento.duracao, horaFim);
        if (fimVisivel <= inicioVisivel) return '';

        const top = (inicioVisivel - horaInicio) * PX_POR_HORA + 2;
        const altura = Math.max(10, (fimVisivel - inicioVisivel) * PX_POR_HORA - 4);
        const compacto = altura < 34;
        const minusculo = altura < 20;
        const varCor = COR_MAP[evento.cor] || '--color-brand';
        const classes = [
            'wks-event',
            evento.layer === 'dinamico' ? 'wks-event--dynamic' : 'wks-event--fixed',
            compacto ? 'wks-event--compact' : '',
            minusculo ? 'wks-event--tiny' : '',
        ].filter(Boolean).join(' ');
        const local = [evento.sala, evento.professor].filter(Boolean).join(' · ');
        const detalhe = local || evento.notas;
        const nota = detalhe
            ? `<span class="wks-event-note">${escapar(detalhe)}</span>`
            : '';
        const etiqueta = `${evento.titulo}, ${fmtHora(evento.hora)} a ${fmtHora(evento.hora + evento.duracao)}${local ? `, ${local}` : ''}, ${evento.layer === 'dinamico' ? 'bloco dinâmico' : 'aula fixa'}`;
        const tituloCompleto = [
            `${evento.titulo} · ${fmtHora(evento.hora)}–${fmtHora(evento.hora + evento.duracao)}`,
            local,
            evento.notas,
        ].filter(Boolean).join(' · ');

        return `<article class="${classes}" data-id="${escapar(evento.id)}" data-layer="${evento.layer}" data-dia="${evento.dia}" data-hora="${evento.hora}"
            tabindex="0" role="button" draggable="${modoEdicao ? 'true' : 'false'}" aria-label="${escapar(etiqueta)}"
            title="${escapar(tituloCompleto)}"
            style="--evt: var(${varCor}); top:${top}px; height:${altura}px; left:calc(${left}% + 3px); width:calc(${width}% - 6px);">
            <span class="wks-event-grip" aria-hidden="true"></span>
            <span class="wks-event-title">${escapar(evento.titulo)}</span>
            <span class="wks-event-time">${fmtHora(evento.hora)} – ${fmtHora(evento.hora + evento.duracao)}</span>
            ${nota}
            <span class="wks-event-resize" data-week-resize aria-hidden="true"></span>
        </article>`;
    }

    function renderSidebar() {
        const todos = todosEventos();
        const dias = diasVisiveis();
        const visiveis = todos.filter((e) => dias.includes(e.dia));

        const totalMin = todos.reduce((soma, e) => soma + Math.round(e.duracao * 60), 0);
        const fixoMin = todos.filter((e) => e.layer !== 'dinamico').reduce((soma, e) => soma + Math.round(e.duracao * 60), 0);
        const visivelMin = visiveis.reduce((soma, e) => soma + Math.round(e.duracao * 60), 0);
        const capacidade = Math.max(1, dias.length * (horaFim - horaInicio) * 60);
        const livres = Math.max(0, capacidade - visivelMin);

        setTexto('week-stat-total', fmtMin(totalMin));
        setTexto('week-stat-classes', String(todos.length));
        setTexto('week-stat-fixed', fmtMin(fixoMin));

        const barra = document.getElementById('week-stat-bar');
        if (barra) barra.style.width = `${Math.min(100, (visivelMin / capacidade) * 100)}%`;

        const nota = document.getElementById('week-stat-note');
        if (nota) {
            nota.textContent = todos.length
                ? `${fmtMin(totalMin)} no total · ${fmtMin(livres)} livres na grelha visível.`
                : 'Sem blocos esta semana. Clica num horário para começar.';
        }

        renderProximo();
        renderCargaDiaria();
        renderDistribuicao();
        renderAulasFixas();
    }

    function calcularProximo() {
        const todos = todosEventos();
        if (!todos.length) return null;

        const agora = new Date();
        const hoje = diaDaSemanaHoje();
        const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

        if (isSemanaAtual()) {
            const aDecorrer = todos.find((e) => (
                e.dia === hoje
                && e.hora * 60 <= minutosAgora
                && (e.hora + e.duracao) * 60 > minutosAgora
            ));
            if (aDecorrer) {
                return {
                    evento: aDecorrer,
                    estado: 'ongoing',
                    quando: 'A decorrer',
                    diaLabel: 'Agora',
                };
            }

            const futuros = todos.filter((e) => {
                if (e.dia < hoje) return false;
                if (e.dia === hoje) return e.hora * 60 >= minutosAgora;
                return true;
            }).sort((a, b) => a.dia - b.dia || a.hora - b.hora);

            if (!futuros.length) return null;

            const evento = futuros[0];
            const diferenca = Math.round((evento.dia - hoje) * 1440 + evento.hora * 60 - minutosAgora);
            return {
                evento,
                estado: 'future',
                quando: fmtCountdown(diferenca),
                diaLabel: diferenca < 1440 ? 'Hoje' : (diferenca < 2880 ? 'Amanhã' : DIAS[evento.dia - 1]),
            };
        }

        const evento = [...todos].sort((a, b) => a.dia - b.dia || a.hora - b.hora)[0];
        const data = dataDoDia(evento.dia);
        return {
            evento,
            estado: 'week',
            quando: `${data.getDate()} ${MESES_CURTOS[data.getMonth()]}`,
            diaLabel: DIAS[evento.dia - 1],
        };
    }

    function renderProximo() {
        const body = document.getElementById('week-next-body');
        const hint = document.getElementById('week-next-when');
        if (!body) return;

        const proximo = calcularProximo();
        if (!proximo) {
            if (hint) hint.textContent = '—';
            body.innerHTML = `<div class="wks-side-empty">
                Sem mais blocos esta semana.
                <br>
                <button type="button" class="btn-soft" data-week-quick="aula">Adicionar aula</button>
            </div>`;
            return;
        }

        const evento = proximo.evento;
        const data = dataDoDia(evento.dia);
        const varCor = COR_MAP[evento.cor] || '--color-brand';
        const etiqueta = `${evento.titulo}, ${DIAS_COMPLETOS[evento.dia - 1]} às ${fmtHora(evento.hora)}`;

        if (hint) hint.textContent = proximo.diaLabel;

        body.innerHTML = `<button type="button" class="wks-next-event" data-week-next-id="${escapar(evento.id)}" data-layer="${evento.layer}" style="--evt: var(${varCor})" aria-label="${escapar(etiqueta)}">
            <span class="wks-next-bar" aria-hidden="true"></span>
            <span class="wks-next-main">
                <span class="wks-next-title">${escapar(evento.titulo)}</span>
                <span class="wks-next-meta">
                    <span>${DIAS[evento.dia - 1]} ${data.getDate()} · ${fmtHora(evento.hora)}–${fmtHora(evento.hora + evento.duracao)}</span>
                    <span class="sep" aria-hidden="true"></span>
                    <span>${fmtDuracao(evento.duracao)}</span>
                    ${[evento.sala, evento.professor].filter(Boolean).length
                        ? `<span class="sep" aria-hidden="true"></span><span>${escapar([evento.sala, evento.professor].filter(Boolean).join(' · '))}</span>`
                        : ''}
                </span>
            </span>
            <span class="wks-next-when${proximo.estado === 'ongoing' ? ' is-live' : ''}">${escapar(proximo.quando)}</span>
        </button>`;
    }

    function renderCargaDiaria() {
        const container = document.getElementById('week-load');
        if (!container) return;

        const dias = diasVisiveis();
        const capacidadeDia = Math.max(1, (horaFim - horaInicio) * 60);
        const hoje = diaDaSemanaHoje();

        container.innerHTML = DIAS.map((nome, i) => {
            const dia = i + 1;
            const minutos = eventosDoDia(dia).reduce((soma, e) => soma + Math.round(e.duracao * 60), 0);
            const pct = Math.min(100, (minutos / capacidadeDia) * 100);
            const classes = [
                'wks-load-row',
                dia === hoje ? 'is-today' : '',
                dias.includes(dia) ? '' : 'is-hidden-day',
            ].filter(Boolean).join(' ');
            return `<div class="${classes}" title="${DIAS_COMPLETOS[i]} · ${fmtMin(minutos)}">
                <span class="wks-load-day">${nome}</span>
                <span class="wks-load-track"><span style="width:${pct}%"></span></span>
                <span class="wks-load-val">${minutos ? fmtMin(minutos) : '—'}</span>
            </div>`;
        }).join('');
    }

    function renderDistribuicao() {
        const container = document.getElementById('week-distribution');
        const hint = document.getElementById('week-dist-count');
        if (!container) return;

        const grupos = new Map();
        todosEventos().forEach((evento) => {
            const chave = normalizar(evento.titulo) || 'sem-titulo';
            const atual = grupos.get(chave) || {
                titulo: evento.titulo || 'Sem título',
                cor: evento.cor || 'brand',
                minutos: 0,
                blocos: 0,
            };
            atual.minutos += Math.round(evento.duracao * 60);
            atual.blocos += 1;
            grupos.set(chave, atual);
        });

        const lista = [...grupos.values()].sort((a, b) => b.minutos - a.minutos);
        if (hint) hint.textContent = lista.length ? `${lista.length} ${lista.length === 1 ? 'matéria' : 'matérias'}` : '—';

        if (!lista.length) {
            container.innerHTML = '<div class="wks-side-empty">Sem dados para distribuir.</div>';
            return;
        }

        const maximo = Math.max(1, lista[0].minutos);
        container.innerHTML = lista.slice(0, 6).map((item) => {
            const varCor = COR_MAP[item.cor] || '--color-brand';
            return `<div class="wks-dist-row" style="--evt: var(${varCor})" title="${escapar(`${item.titulo} · ${fmtMin(item.minutos)} em ${item.blocos} ${item.blocos === 1 ? 'bloco' : 'blocos'}`)}">
                <span class="wks-dist-dot" aria-hidden="true"></span>
                <span class="wks-dist-main">
                    <span class="wks-dist-top">
                        <span class="wks-dist-title">${escapar(item.titulo)}</span>
                    </span>
                    <span class="wks-dist-track"><span style="width:${Math.min(100, (item.minutos / maximo) * 100)}%"></span></span>
                </span>
                <span class="wks-dist-val">${fmtMin(item.minutos)}</span>
            </div>`;
        }).join('');
    }

    function renderAulasFixas() {
        const container = document.getElementById('week-fixed-list');
        if (!container) return;

        const lista = [...fixos].sort((a, b) => a.dia - b.dia || a.hora - b.hora);
        if (!lista.length) {
            container.innerHTML = `<div class="wks-side-empty">
                Ainda não há aulas fixas.
                <br>
                <button type="button" class="btn-soft" data-week-quick="aula">Adicionar aula</button>
            </div>`;
            return;
        }

        container.innerHTML = lista.map((evento) => {
            const varCor = COR_MAP[evento.cor] || '--color-brand';
            const local = evento.sala || evento.professor;
            return `<button type="button" class="wks-fixed-item" data-week-fixed-id="${escapar(evento.id)}" style="--evt: var(${varCor})" title="Editar ${escapar(evento.titulo)}">
                <span class="wks-fixed-dot" aria-hidden="true"></span>
                <span class="wks-fixed-main">
                    <span class="wks-fixed-title">${escapar(evento.titulo)}</span>
                    <span class="wks-fixed-meta">${DIAS[evento.dia - 1]} ${fmtHora(evento.hora)}–${fmtHora(evento.hora + evento.duracao)} · ${fmtDuracao(evento.duracao)}${local ? ` · ${escapar(local)}` : ''}</span>
                </span>
                <span class="wks-fixed-edit" aria-hidden="true"><svg class="icon"><use href="#i-pencil"/></svg></span>
            </button>`;
        }).join('');
    }

    /* ── Hora atual e scroll ─────────────────────────────── */

    function atualizarLinhaAtual() {
        const nowEl = document.getElementById('week-now');
        if (!nowEl) return;

        const agora = new Date();
        const hoje = diaDaSemanaHoje();
        const decimal = agora.getHours() + agora.getMinutes() / 60 + agora.getSeconds() / 3600;
        const visivel = isSemanaAtual()
            && diasVisiveis().includes(hoje)
            && decimal >= horaInicio
            && decimal <= horaFim;

        if (!visivel) {
            nowEl.hidden = true;
            return;
        }

        nowEl.hidden = false;
        nowEl.style.top = `${(decimal - horaInicio) * PX_POR_HORA}px`;
        const label = nowEl.querySelector('.wks-now-label');
        if (label) label.textContent = fmtHora(decimal);
    }

    function rolarParaAgora() {
        const scroller = document.getElementById('week-scroll-y');
        if (!scroller) return;

        const agora = new Date();
        const decimal = agora.getHours() + agora.getMinutes() / 60;
        const hoje = diaDaSemanaHoje();
        const podeAgora = isSemanaAtual()
            && diasVisiveis().includes(hoje)
            && decimal >= horaInicio
            && decimal <= horaFim;

        const alvo = podeAgora
            ? Math.max(horaInicio, decimal - 1.25)
            : horaInicio + 1;
        const top = (alvo - horaInicio) * PX_POR_HORA;

        requestAnimationFrame(() => {
            const maximo = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTop = Math.min(top, maximo);
        });
    }

    /* ── Navegação e preferências ────────────────────────── */

    function mudarSemana(novaData) {
        const key = semanaKey(novaData);
        if (key === semanaAtual) return;

        salvar();
        semanaAtual = key;
        guardar(CHAVE_DINAMICO_ATUAL, semanaAtual);
        dinamicos = lerDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual).map(normalizarEvento);
        if (isSemanaAtual()) diaVisivel = diaDaSemanaHoje();
        render();
        rolarParaAgora();
    }

    function semanaAnterior() {
        const inicio = inicioSemanaDate();
        inicio.setDate(inicio.getDate() - 7);
        mudarSemana(inicio);
    }

    function semanaSeguinte() {
        const inicio = inicioSemanaDate();
        inicio.setDate(inicio.getDate() + 7);
        mudarSemana(inicio);
    }

    function irParaSemanaAtual() {
        diaVisivel = diaDaSemanaHoje();
        if (!isSemanaAtual()) {
            mudarSemana(new Date());
            return;
        }
        render();
        rolarParaAgora();
    }

    function selecionarDia(dia) {
        const n = Number(dia);
        if (n < 1 || n > 7) return;
        diaVisivel = n;
        if (vista !== 'dia') {
            vista = 'dia';
            guardarVista();
        }
        render();
        rolarParaAgora();
    }

    function definirVista(novaVista) {
        if (novaVista !== 'dia' && novaVista !== 'semana') return;
        if (vista === novaVista) return;
        vista = novaVista;
        if (diaVisivel === null) diaVisivel = isSemanaAtual() ? diaDaSemanaHoje() : 1;
        guardarVista();
        render();
        rolarParaAgora();
    }

    function definirFimSemana(valor) {
        mostrarFimSemana = Boolean(valor);
        fimSemanaPref = mostrarFimSemana;
        guardar(CHAVE_FIM_SEMANA, mostrarFimSemana ? '1' : '0');
        render();
    }

    function aplicarPasso(valor) {
        const passo = Number(valor);
        if (!PASSOS_VALIDOS.includes(passo) || passo === passoHoras) return;
        passoHoras = passo;
        guardar(CHAVE_PASSO, passo);
        construirSlots();
        render();
    }

    function aplicarHorario(inicio, fim) {
        let ini = Number(inicio);
        let final = Number(fim);
        if (!Number.isFinite(ini) || ini < INICIO_MIN || ini > INICIO_MAX) ini = horaInicio;
        if (!Number.isFinite(final) || final < FIM_MIN || final > FIM_MAX) final = horaFim;
        if (final <= ini) final = Math.min(FIM_MAX, ini + 1);
        horaInicio = ini;
        horaFim = final;
        guardar(CHAVE_INICIO, horaInicio);
        guardar(CHAVE_FIM, horaFim);
        construirSlots();
        render();
        rolarParaAgora();
    }

    /* ── Importação do Exam Center ───────────────────────── */

    function importarPlanoExames(events, options = {}) {
        const base = options.monday || semanaAtual;
        const week = semanaKey(dataDaSemana(base));
        if (week !== semanaAtual) {
            salvar();
            semanaAtual = week;
            guardar(CHAVE_DINAMICO_ATUAL, semanaAtual);
            dinamicos = lerDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual).map(normalizarEvento);
        }

        const completed = new Set(options.completedPlanItemIds || []);
        dinamicos = dinamicos.filter((e) => !e.examPlanItemId || completed.has(e.examPlanItemId));

        const ocupados = [...fixos, ...dinamicos];
        const placed = [];
        const skipped = [];
        const ordenados = [...(events || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

        for (const item of ordenados) {
            if (completed.has(item.id)) continue;
            const d = new Date(`${item.date}T12:00:00`);
            const dia = ((d.getDay() + 6) % 7) + 1;
            const duracaoMin = Math.max(15, Number(item.durationMin) || 45);
            const duracao = Math.ceil(duracaoMin / 15) / 4;
            let found = null;

            for (let start = 8; start + duracao <= 22; start += 0.25) {
                const clash = ocupados.some((e) => e.dia === dia && start < e.hora + e.duracao && start + duracao > e.hora);
                if (!clash) {
                    found = start;
                    break;
                }
            }

            if (found == null) {
                skipped.push(item);
                continue;
            }

            const evento = normalizarEvento({
                id: `exam_${item.id}`,
                titulo: item.topicTitle || item.title || 'Tópico de exame',
                dia,
                hora: found,
                duracao,
                cor: 'blue',
                notas: 'Sessão planeada pelo Exam Center',
                layer: 'dinamico',
                examPlanItemId: item.id,
                examPlanId: options.planId || '',
            });
            dinamicos.push(evento);
            ocupados.push(evento);
            placed.push(evento);
        }

        salvar();
        render();
        return { placed, skipped, week };
    }

    /* ── Formulário ──────────────────────────────────────── */

    function gerarId() {
        return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function horaSugerida() {
        const dia = diaVisivel || (isSemanaAtual() ? diaDaSemanaHoje() : 1);
        let hora = 8;
        if (isSemanaAtual() && dia === diaDaSemanaHoje()) {
            const agora = new Date();
            const decimal = agora.getHours() + agora.getMinutes() / 60;
            hora = Math.ceil((decimal + 0.25) / 0.5) * 0.5;
        }
        return Math.min(Math.max(horaInicio, horaFim - 1), Math.max(horaInicio, hora));
    }

    function garantirOpcao(select, valor, rotulo) {
        if (!select) return;
        const existe = [...select.options].some((o) => o.value === String(valor));
        if (!existe) {
            const opt = document.createElement('option');
            opt.value = String(valor);
            opt.textContent = rotulo;
            select.append(opt);
        }
    }

    function aplicarLayer(layer) {
        document.querySelectorAll('[data-week-layer]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.weekLayer === layer));
        });
    }

    function aplicarCor(cor) {
        const input = document.getElementById('week-cor');
        if (input) input.value = cor || 'brand';
        document.querySelectorAll('[data-week-color]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.weekColor === (cor || 'brand')));
        });
    }

    function abrirFormulario(evento = null, dia = null, hora = null, layer = null) {
        sairModoColocacao();
        const dlg = document.getElementById('week-form');
        if (!dlg) return;

        const form = dlg.querySelector('form');
        if (form) form.reset();

        const tituloEl = dlg.querySelector('#week-form-title');
        const apagarBtn = dlg.querySelector('#week-apagar');
        const duplicarBtn = dlg.querySelector('#week-duplicar');
        const horaSelect = dlg.querySelector('#week-hora');
        const diaSelect = dlg.querySelector('#week-dia');
        const duracaoSelect = dlg.querySelector('#week-duracao');

        if (horaSelect) {
            horaSelect.innerHTML = SLOTS_FORM.map((h) => `<option value="${h}">${fmtHora(h)}</option>`).join('');
        }
        if (diaSelect) {
            diaSelect.innerHTML = DIAS_COMPLETOS.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('');
        }

        if (evento) {
            editandoId = evento.id;
            if (tituloEl) tituloEl.textContent = TEXTOS.editarTitulo;
            if (apagarBtn) apagarBtn.hidden = false;
            if (duplicarBtn) duplicarBtn.hidden = false;

            garantirOpcao(horaSelect, String(evento.hora), fmtHora(evento.hora));
            garantirOpcao(duracaoSelect, String(evento.duracao), fmtDuracao(evento.duracao));

            const titulo = dlg.querySelector('#week-titulo');
            if (titulo) titulo.value = evento.titulo;
            if (diaSelect) diaSelect.value = String(evento.dia);
            if (horaSelect) horaSelect.value = String(evento.hora);
            if (duracaoSelect) duracaoSelect.value = String(evento.duracao);
            const sala = dlg.querySelector('#week-sala');
            if (sala) sala.value = evento.sala || '';
            const professor = dlg.querySelector('#week-professor');
            if (professor) professor.value = evento.professor || '';
            const notas = dlg.querySelector('#week-notas');
            if (notas) notas.value = evento.notas || '';

            aplicarLayer(evento.layer);
            aplicarCor(evento.cor);
        } else {
            editandoId = null;
            if (tituloEl) tituloEl.textContent = TEXTOS.novoTitulo;
            if (apagarBtn) apagarBtn.hidden = true;
            if (duplicarBtn) duplicarBtn.hidden = true;

            const diaFinal = Number(dia) || diaVisivel || (isSemanaAtual() ? diaDaSemanaHoje() : 1);
            const horaFinal = hora !== null && Number.isFinite(Number(hora)) ? Number(hora) : horaSugerida();
            const camada = layer === 'dinamico' ? 'dinamico' : 'fixo';
            const duracaoFinal = camada === 'dinamico' ? 1.5 : 1;

            garantirOpcao(horaSelect, String(horaFinal), fmtHora(horaFinal));
            garantirOpcao(duracaoSelect, String(duracaoFinal), fmtDuracao(duracaoFinal));

            if (diaSelect) diaSelect.value = String(diaFinal);
            if (horaSelect) horaSelect.value = String(horaFinal);
            if (duracaoSelect) duracaoSelect.value = String(duracaoFinal);
            const sala = dlg.querySelector('#week-sala');
            if (sala) sala.value = '';
            const professor = dlg.querySelector('#week-professor');
            if (professor) professor.value = '';
            const notas = dlg.querySelector('#week-notas');
            if (notas) notas.value = '';

            aplicarLayer(camada);
            aplicarCor('brand');
        }

        dlg.showModal();
        const titulo = dlg.querySelector('#week-titulo');
        if (titulo) {
            titulo.focus();
            if (evento) titulo.select();
        }
    }

    function fecharFormulario() {
        const dlg = document.getElementById('week-form');
        if (dlg && dlg.open) dlg.close();
        editandoId = null;
    }

    function getLayerAtivo() {
        const ativo = document.querySelector('[data-week-layer][aria-pressed="true"]');
        return ativo?.dataset.weekLayer === 'dinamico' ? 'dinamico' : 'fixo';
    }

    function salvarEvento() {
        const dlg = document.getElementById('week-form');
        if (!dlg) return;

        const titulo = dlg.querySelector('#week-titulo')?.value.trim() || '';
        const dia = Number(dlg.querySelector('#week-dia')?.value) || 1;
        let hora = Number(dlg.querySelector('#week-hora')?.value) || HORA_INICIO;
        let duracao = Number(dlg.querySelector('#week-duracao')?.value) || 1;
        const cor = dlg.querySelector('#week-cor')?.value || 'brand';
        const sala = dlg.querySelector('#week-sala')?.value.trim() || '';
        const professor = dlg.querySelector('#week-professor')?.value.trim() || '';
        const notas = dlg.querySelector('#week-notas')?.value.trim() || '';
        const layer = getLayerAtivo();

        if (!titulo) {
            notificar('Dá um título à aula ou ao bloco.', 'warn');
            return;
        }

        hora = Math.min(HORA_FIM - 0.25, Math.max(HORA_INICIO, hora));
        duracao = Math.min(HORA_FIM - hora, Math.max(0.25, duracao));

        const antigo = editandoId
            ? [...fixos, ...dinamicos].find((e) => e.id === editandoId) || null
            : null;

        if (antigo) {
            fixos = fixos.filter((e) => e.id !== editandoId);
            dinamicos = dinamicos.filter((e) => e.id !== editandoId);
        }

        const evento = {
            id: antigo?.id || gerarId(),
            titulo,
            dia: Math.min(7, Math.max(1, dia)),
            hora: arredondar(hora),
            duracao: arredondar(duracao),
            cor,
            sala,
            professor,
            notas,
            layer,
            examPlanItemId: antigo?.examPlanItemId || '',
            examPlanId: antigo?.examPlanId || '',
        };

        if (layer === 'dinamico') dinamicos.push(evento);
        else fixos.push(evento);

        const eraEdicao = Boolean(antigo);
        salvar();
        render();
        fecharFormulario();
        notificar(`${eraEdicao ? 'Aula atualizada' : 'Aula adicionada'}.`, 'success');
    }

    function apagarEvento() {
        if (!editandoId) return;
        const evento = [...fixos, ...dinamicos].find((e) => e.id === editandoId);
        if (!evento) return;
        if (!confirmar(`Apagar "${evento.titulo}"?`)) return;

        removerEvento(editandoId);
        salvar();
        render();
        fecharFormulario();
        notificar('Aula apagada.', 'success');
    }

    /* ── Duplicar / colocar cópia ────────────────────────── */

    function modoColocacao() {
        return duplicando !== null;
    }

    function entrarModoColocacao(copia) {
        duplicando = copia;
        document.getElementById('week-grid')?.classList.add('is-placing');
        notificar('Clica no horário onde queres a cópia. (Esc cancela)', 'info');
        const alvo = document.querySelector(
            `#week-body .wks-slot[data-dia="${copia.origemDia}"][data-hora="${copia.origemHora}"]`
        ) || document.querySelector('#week-body .wks-slot');
        alvo?.focus({ preventScroll: true });
    }

    function sairModoColocacao() {
        duplicando = null;
        document.getElementById('week-grid')?.classList.remove('is-placing');
    }

    function colocarCopia(dia, hora) {
        if (!duplicando) return;
        const { origemDia, origemHora, ...dados } = duplicando;
        const copia = {
            ...dados,
            id: gerarId(),
            dia,
            hora,
            examPlanItemId: '',
            examPlanId: '',
        };
        if (copia.layer === 'dinamico') dinamicos.push(copia);
        else fixos.push(copia);
        sairModoColocacao();
        salvar();
        render();
        notificar('Cópia colocada.', 'success');
    }

    function duplicarAtual() {
        const dlg = document.getElementById('week-form');
        if (!dlg) return;

        const titulo = dlg.querySelector('#week-titulo')?.value.trim() || 'Cópia';
        const duracao = Number(dlg.querySelector('#week-duracao')?.value) || 1;
        const cor = dlg.querySelector('#week-cor')?.value || 'brand';
        const sala = dlg.querySelector('#week-sala')?.value.trim() || '';
        const professor = dlg.querySelector('#week-professor')?.value.trim() || '';
        const notas = dlg.querySelector('#week-notas')?.value.trim() || '';
        const layer = getLayerAtivo();
        const dia = Number(dlg.querySelector('#week-dia')?.value) || 1;
        const hora = Number(dlg.querySelector('#week-hora')?.value) || horaInicio;

        const original = editandoId
            ? [...fixos, ...dinamicos].find((e) => e.id === editandoId)
            : null;
        const origemDia = original?.dia || dia;
        const origemHora = original?.hora || hora;

        fecharFormulario();
        entrarModoColocacao({
            titulo,
            duracao,
            cor,
            sala,
            professor,
            notas,
            layer,
            origemDia,
            origemHora,
        });
    }

    /* ── Criar por arrasto ───────────────────────────────── */

    function snapHora(hora) {
        const passoMin = Math.max(1, Math.round(passoHoras * 60));
        const baseMin = Math.round(horaInicio * 60);
        const atualMin = Math.round(hora * 60);
        return (Math.round((atualMin - baseMin) / passoMin) * passoMin + baseMin) / 60;
    }

    function limparDestaqueCriacao() {
        document.querySelectorAll('#week-body .wks-slot.drag-select').forEach((slot) => {
            slot.classList.remove('drag-select');
        });
    }

    function pintarCriacao() {
        rafCriacao = 0;
        if (!criacao) return;
        limparDestaqueCriacao();
        const inicio = Math.min(criacao.inicioHora, criacao.fimHora);
        const fim = Math.max(criacao.inicioHora, criacao.fimHora);
        document.querySelectorAll(`#week-body .wks-slot[data-dia="${criacao.dia}"]`).forEach((slot) => {
            const hora = Number(slot.dataset.hora);
            if (hora >= inicio && hora <= fim) slot.classList.add('drag-select');
        });
    }

    function terminarCriacao(cancelar) {
        document.removeEventListener('pointermove', onCriacaoMove);
        document.removeEventListener('pointerup', onCriacaoUp);
        document.removeEventListener('pointercancel', onCriacaoCancel);
        document.getElementById('view-semanal')?.classList.remove('is-creating');

        if (rafCriacao) {
            cancelAnimationFrame(rafCriacao);
            rafCriacao = 0;
        }

        const dados = criacao;
        criacao = null;
        limparDestaqueCriacao();
        if (!dados || cancelar || !dados.moveu) return;

        const inicio = Math.min(dados.inicioHora, dados.fimHora);
        const fim = Math.max(dados.inicioHora, dados.fimHora);
        const duracao = Math.min(
            horaFim - inicio,
            Math.max(passoHoras, arredondar(fim - inicio + passoHoras))
        );

        criacaoArrastada = true;
        abrirFormulario(null, dados.dia, inicio, 'fixo');
        const select = document.getElementById('week-duracao');
        garantirOpcao(select, String(duracao), fmtDuracao(duracao));
        if (select) select.value = String(duracao);
    }

    function onCriacaoMove(e) {
        if (!criacao) return;
        const alvo = document.elementFromPoint(e.clientX, e.clientY);
        const coluna = alvo?.closest('.wks-day-col');
        if (!coluna || Number(coluna.dataset.dia) !== criacao.dia) return;

        const rect = coluna.getBoundingClientRect();
        let hora = snapHora(horaInicio + (e.clientY - rect.top) / PX_POR_HORA);
        hora = Math.min(horaFim - passoHoras, Math.max(horaInicio, hora));

        if (hora !== criacao.fimHora) {
            criacao.fimHora = hora;
            criacao.moveu = true;
            e.preventDefault();
            document.getElementById('view-semanal')?.classList.add('is-creating');
            if (!rafCriacao) rafCriacao = requestAnimationFrame(pintarCriacao);
        }
    }

    function onCriacaoUp() {
        terminarCriacao(false);
    }

    function onCriacaoCancel() {
        terminarCriacao(true);
    }

    function iniciarCriacao(e, slot) {
        criacao = {
            dia: Number(slot.dataset.dia),
            inicioHora: Number(slot.dataset.hora),
            fimHora: Number(slot.dataset.hora),
            moveu: false,
        };
        document.addEventListener('pointermove', onCriacaoMove);
        document.addEventListener('pointerup', onCriacaoUp);
        document.addEventListener('pointercancel', onCriacaoCancel);
    }

    /* ── Redimensionar ───────────────────────────────────── */

    function aplicarResize() {
        if (!resizeData) return;
        resizeData.raf = 0;
        const deltaY = resizeData.evt.clientY - resizeData.startY;
        const delta = Math.round(deltaY / PX_POR_HORA / passoHoras) * passoHoras;
        const maximo = Math.max(0.25, Math.min(HORA_FIM, horaFim) - resizeData.evento.hora);
        const nova = Math.min(maximo, Math.max(passoHoras, arredondar(resizeData.startDuracao + delta)));

        if (nova !== resizeData.evento.duracao) {
            resizeData.alterou = true;
            resizeData.evento.duracao = nova;

            const inicioVisivel = Math.max(resizeData.evento.hora, horaInicio);
            const fimVisivel = Math.min(resizeData.evento.hora + nova, horaFim);
            resizeData.block.style.height = `${Math.max(10, (fimVisivel - inicioVisivel) * PX_POR_HORA - 4)}px`;

            const tempo = resizeData.block.querySelector('.wks-event-time');
            if (tempo) tempo.textContent = `${fmtHora(resizeData.evento.hora)} – ${fmtHora(resizeData.evento.hora + nova)}`;
        }
    }

    function onResizeMove(e) {
        if (!resizeData) return;
        e.preventDefault();
        resizeData.evt = e;
        if (!resizeData.raf) resizeData.raf = requestAnimationFrame(aplicarResize);
    }

    function onResizeUp() {
        document.removeEventListener('pointermove', onResizeMove);
        document.removeEventListener('pointerup', onResizeUp);
        document.removeEventListener('pointercancel', onResizeUp);
        document.getElementById('view-semanal')?.classList.remove('is-resizing');

        if (resizeData?.raf) cancelAnimationFrame(resizeData.raf);
        const alterou = Boolean(resizeData?.alterou);
        const block = resizeData?.block;
        if (block) block.setAttribute('draggable', modoEdicao ? 'true' : 'false');
        resizeData = null;

        if (alterou) {
            salvar();
            render();
            marcarIgnorarClique();
            notificar('Duração atualizada.', 'success');
        }
    }

    function iniciarResize(e, handle) {
        const block = handle.closest('.wks-event');
        if (!block) return;
        const evento = localizarEvento(block.dataset.id, block.dataset.layer);
        if (!evento) return;

        resizeData = {
            evento,
            block,
            startY: e.clientY,
            startDuracao: evento.duracao,
            raf: 0,
            evt: null,
            alterou: false,
        };
        block.setAttribute('draggable', 'false');
        document.getElementById('view-semanal')?.classList.add('is-resizing');
        document.addEventListener('pointermove', onResizeMove);
        document.addEventListener('pointerup', onResizeUp);
        document.addEventListener('pointercancel', onResizeUp);
        e.preventDefault();
        e.stopPropagation();
    }

    /* ── Modo de edição / configuração ───────────────────── */

    function alternarEdicao(forcar) {
        modoEdicao = typeof forcar === 'boolean' ? forcar : !modoEdicao;
        if (!modoEdicao) sairModoColocacao();

        const scroller = document.getElementById('week-scroll-y');
        const top = scroller ? scroller.scrollTop : 0;
        render();
        if (scroller) scroller.scrollTop = top;

        notificar(modoEdicao
            ? 'Modo de edição ativo. Arrasta para mover ou redimensionar.'
            : 'Modo de edição concluído.', 'info');
    }

    function toggleSettings(forcar) {
        const pop = document.getElementById('week-settings-pop');
        const btn = document.getElementById('week-settings-btn');
        if (!pop) return;
        const abrir = typeof forcar === 'boolean' ? forcar : pop.hidden;
        pop.hidden = !abrir;
        if (btn) btn.setAttribute('aria-expanded', String(abrir));
    }

    function fecharSettings() {
        toggleSettings(false);
    }

    function onDocumentClick(e) {
        const pop = document.getElementById('week-settings-pop');
        const btn = document.getElementById('week-settings-btn');
        if (!pop || pop.hidden) return;
        if (pop.contains(e.target) || btn?.contains(e.target)) return;
        fecharSettings();
    }

    function onDocumentKeydown(e) {
        if (e.key !== 'Escape') return;
        if (modoColocacao()) {
            e.preventDefault();
            sairModoColocacao();
            notificar('Duplicação cancelada.', 'info');
            return;
        }
        const pop = document.getElementById('week-settings-pop');
        if (pop && !pop.hidden) {
            e.preventDefault();
            fecharSettings();
        }
    }

    function onSectionClick(e) {
        const quick = e.target.closest('[data-week-quick]');
        if (quick) {
            const tipo = quick.dataset.weekQuick;
            if (tipo === 'aula') abrirFormulario(null, diaVisivel, horaSugerida(), 'fixo');
            else if (tipo === 'bloco') abrirFormulario(null, diaVisivel, horaSugerida(), 'dinamico');
            return;
        }

        const fixo = e.target.closest('[data-week-fixed-id]');
        if (fixo) {
            const evento = fixos.find((ev) => ev.id === fixo.dataset.weekFixedId);
            if (evento) abrirFormulario(evento);
            return;
        }

        const proximo = e.target.closest('[data-week-next-id]');
        if (proximo) {
            const evento = localizarEvento(proximo.dataset.weekNextId, proximo.dataset.layer);
            if (evento) abrirFormulario(evento);
            return;
        }

        const diaBtn = e.target.closest('[data-week-day-head], [data-week-dia]');
        if (diaBtn) {
            selecionarDia(diaBtn.dataset.weekDayHead || diaBtn.dataset.weekDia);
            return;
        }

        const eventEl = e.target.closest('.wks-event');
        if (eventEl) {
            if (modoColocacao()) {
                sairModoColocacao();
                notificar('Duplicação cancelada.', 'info');
                return;
            }
            if (ignorarClique) {
                ignorarClique = false;
                return;
            }
            const evento = localizarEvento(eventEl.dataset.id, eventEl.dataset.layer);
            if (evento) abrirFormulario(evento);
            return;
        }

        const slot = e.target.closest('.wks-slot');
        if (slot) {
            if (modoColocacao()) {
                colocarCopia(Number(slot.dataset.dia), Number(slot.dataset.hora));
                return;
            }
            if (ignorarClique) {
                ignorarClique = false;
                return;
            }
            if (criacaoArrastada) {
                criacaoArrastada = false;
                return;
            }
            abrirFormulario(null, Number(slot.dataset.dia), Number(slot.dataset.hora), 'fixo');
        }
    }

    /* ── Mover aulas por arrasto ─────────────────────────── */

    function limparDragOver() {
        document.querySelectorAll('#week-body .wks-day-col.drag-over').forEach((col) => {
            col.classList.remove('drag-over');
        });
    }

    function onEventDragStart(e) {
        const block = e.target.closest('.wks-event');
        if (!block || !modoEdicao || e.target.closest('[data-week-resize]')) {
            e.preventDefault();
            return;
        }
        const evento = localizarEvento(block.dataset.id, block.dataset.layer);
        if (!evento) {
            e.preventDefault();
            return;
        }
        moverData = { evento, block };
        block.classList.add('is-dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', evento.id); } catch { /* sem dataTransfer */ }
        }
    }

    function onEventDragEnd() {
        if (moverData?.block) moverData.block.classList.remove('is-dragging');
        moverData = null;
        limparDragOver();
    }

    function onGridDragOver(e) {
        if (!modoEdicao || !moverData) return;
        const col = e.target.closest('.wks-day-col');
        if (!col) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!col.classList.contains('drag-over')) {
            limparDragOver();
            col.classList.add('drag-over');
        }
    }

    function onGridDragLeave(e) {
        const col = e.target.closest('.wks-day-col');
        if (!col) return;
        if (e.relatedTarget && col.contains(e.relatedTarget)) return;
        col.classList.remove('drag-over');
    }

    function onGridDrop(e) {
        if (!modoEdicao || !moverData) return;
        const col = e.target.closest('.wks-day-col');
        if (!col) return;
        e.preventDefault();

        const dia = Number(col.dataset.dia);
        const rect = col.getBoundingClientRect();
        const evento = moverData.evento;
        const passoMin = Math.max(1, Math.round(passoHoras * 60));
        const bruto = horaInicio + (e.clientY - rect.top) / PX_POR_HORA;
        const minuto = Math.round((bruto * 60) / passoMin) * passoMin;
        const maxHora = Math.max(horaInicio, horaFim - evento.duracao);
        const hora = Math.min(maxHora, Math.max(horaInicio, minuto / 60));

        onEventDragEnd();
        if (dia === evento.dia && Math.abs(hora - evento.hora) < 0.001) return;

        evento.dia = dia;
        evento.hora = arredondar(hora);
        salvar();
        render();
        marcarIgnorarClique();
        notificar('Aula movida.', 'success');
    }

    /* ── Navegação por teclado na grelha ─────────────────── */

    function onGridKeydown(e) {
        const slot = e.target.closest('.wks-slot');
        if (!slot) return;

        const dia = Number(slot.dataset.dia);
        const hora = Number(slot.dataset.hora);
        const dias = diasVisiveis();
        const indice = dias.indexOf(dia);
        let novoDia = dia;
        let novaHora = hora;

        switch (e.key) {
            case 'ArrowUp':
                novaHora = Math.max(horaInicio, arredondar(hora - passoHoras));
                break;
            case 'ArrowDown':
                novaHora = Math.min(arredondar(horaFim - passoHoras), arredondar(hora + passoHoras));
                break;
            case 'ArrowLeft':
                if (indice > 0) novoDia = dias[indice - 1];
                break;
            case 'ArrowRight':
                if (indice >= 0 && indice < dias.length - 1) novoDia = dias[indice + 1];
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                abrirFormulario(null, dia, hora, 'fixo');
                return;
            default:
                return;
        }

        e.preventDefault();
        const alvo = document.querySelector(`#week-body .wks-slot[data-dia="${novoDia}"][data-hora="${novaHora}"]`);
        if (!alvo) return;
        document.querySelectorAll('#week-body .wks-slot').forEach((s) => { s.tabIndex = -1; });
        alvo.tabIndex = 0;
        alvo.focus({ preventScroll: false });
    }

    /* ── Interação com a grelha ──────────────────────────── */

    function onSectionPointerDown(e) {
        if (e.button !== 0) return;

        const handle = e.target.closest('[data-week-resize]');
        if (handle && modoEdicao) {
            iniciarResize(e, handle);
            return;
        }

        const slot = e.target.closest('.wks-slot');
        if (!slot || !modoEdicao || modoColocacao()) return;
        iniciarCriacao(e, slot);
    }

    /* ── Ouvintes ────────────────────────────────────────── */

    function ligarOuvintes() {
        const section = document.getElementById('view-semanal');
        if (!section) return;

        if (!section.dataset.wksBound) {
            section.dataset.wksBound = 'true';
            section.addEventListener('click', onSectionClick);
            section.addEventListener('pointerdown', onSectionPointerDown);
            section.addEventListener('keydown', onGridKeydown);
            section.addEventListener('dragstart', onEventDragStart);
            section.addEventListener('dragend', onEventDragEnd);
            section.addEventListener('dragover', onGridDragOver);
            section.addEventListener('dragleave', onGridDragLeave);
            section.addEventListener('drop', onGridDrop);
            document.addEventListener('click', onDocumentClick);
            document.addEventListener('keydown', onDocumentKeydown);
        }

        const bind = (id, evento, handler) => {
            const el = document.getElementById(id);
            if (!el || el.dataset.wksBound) return;
            el.dataset.wksBound = 'true';
            el.addEventListener(evento, handler);
        };

        bind('week-prev', 'click', semanaAnterior);
        bind('week-next', 'click', semanaSeguinte);
        bind('week-today', 'click', irParaSemanaAtual);
        bind('week-add', 'click', () => abrirFormulario());
        bind('week-add-fixed', 'click', () => abrirFormulario(null, diaVisivel, horaSugerida(), 'fixo'));
        bind('week-edit', 'click', () => alternarEdicao());
        bind('week-edit-done', 'click', () => alternarEdicao(false));
        bind('week-view-week', 'click', () => definirVista('semana'));
        bind('week-view-day', 'click', () => definirVista('dia'));
        bind('week-weekend', 'click', () => definirFimSemana(!mostrarFimSemana));
        bind('week-settings-btn', 'click', () => toggleSettings());
        bind('week-settings-close', 'click', fecharSettings);
        bind('week-quick-today', 'click', irParaSemanaAtual);
        bind('week-quick-edit', 'click', () => alternarEdicao());

        bind('week-weekend-setting', 'change', (e) => definirFimSemana(e.target.checked));
        bind('week-start', 'change', (e) => aplicarHorario(e.target.value, horaFim));
        bind('week-end', 'change', (e) => aplicarHorario(horaInicio, e.target.value));

        document.querySelectorAll('[data-week-passo]').forEach((btn) => {
            if (btn.dataset.wksBound) return;
            btn.dataset.wksBound = 'true';
            btn.addEventListener('click', () => aplicarPasso(btn.dataset.weekPasso));
        });

        const dlg = document.getElementById('week-form');
        if (dlg && !dlg.dataset.wksBound) {
            dlg.dataset.wksBound = 'true';
            dlg.addEventListener('click', (e) => {
                if (e.target.closest('[data-week-cancelar]')) {
                    e.preventDefault();
                    fecharFormulario();
                } else if (e.target.closest('#week-salvar')) {
                    e.preventDefault();
                    salvarEvento();
                } else if (e.target.closest('#week-apagar')) {
                    e.preventDefault();
                    apagarEvento();
                } else if (e.target.closest('#week-duplicar')) {
                    e.preventDefault();
                    duplicarAtual();
                } else if (e.target.closest('[data-week-layer]')) {
                    aplicarLayer(e.target.closest('[data-week-layer]').dataset.weekLayer);
                } else if (e.target.closest('[data-week-color]')) {
                    aplicarCor(e.target.closest('[data-week-color]').dataset.weekColor);
                }
            });

            dlg.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.matches('input')) {
                    e.preventDefault();
                    salvarEvento();
                }
            });

            dlg.addEventListener('close', () => {
                editandoId = null;
            });
        }

        if (!relogioTimer) {
            relogioTimer = setInterval(() => {
                const vistaEl = document.getElementById('view-semanal');
                if (!document.hidden && vistaEl && !vistaEl.hidden) atualizarLinhaAtual();
            }, 30000);
        }
    }

    /* ── Ciclo de vida e API pública ─────────────────────── */

    function ligar() {
        carregar();
        if (!diaVisivel) diaVisivel = isSemanaAtual() ? diaDaSemanaHoje() : 1;
        render();
        ligarOuvintes();
        rolarParaAgora();
    }

    function verDia(dia) {
        selecionarDia(dia);
    }

    return {
        carregar,
        ligar,
        render,
        verDia,
        abrirFormulario,
        alternarEdicao,
        fixos: () => fixos,
        dinamicos: () => dinamicos,
        semanaAtual: () => semanaAtual,
        semanaAnterior,
        semanaSeguinte,
        irParaSemanaAtual,
        importarPlanoExames,
    };
})();
