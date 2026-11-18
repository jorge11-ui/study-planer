/* StudyJournal — Painel / dashboard.
   Camada de leitura: junta tarefas, notas, sessões, exames e revisões
   que já existem no resto da app. Não guarda dados próprios (exceto a
   preferência de sidebar recolhida). */

window.SJDash = (() => {
    const SUBJECTS = {
        'Matemática A': '#718DF5',
        FQA: '#D6B36A',
        Português: '#D98A8A',
        Biologia: '#7FC8A9',
        'Aplicações Informáticas (A.I.)': '#86BCDD',
        Hobbies: '#B49BE6',
        Geral: '#9297A3',
    };

    const $ = (id) => document.getElementById(id);
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    let ligado = false;
    let ultimaSessao = 0;

    function hojeChave() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function chaveDe(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function diaSelecionado() {
        const chave = localStorage.getItem('study-journal-selected-date') || hojeChave();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
        if (!m) return new Date();
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    function lerJSON(chave, fallback) {
        try {
            const bruto = localStorage.getItem(chave);
            return bruto === null ? fallback : JSON.parse(bruto);
        } catch {
            return fallback;
        }
    }

    function tarefasDoDia(chave) {
        const lista = lerJSON(`study-journal-tasks-${chave}`, []);
        return Array.isArray(lista) ? lista.filter((t) => t && t.text !== undefined) : [];
    }

    function minutosDoDia(date) {
        try {
            if (window.StudySessions) {
                const dia = window.StudySessions.obterDoDia(date);
                return Object.values(dia || {}).reduce((a, b) => a + (Number(b) || 0), 0);
            }
        } catch { /* segue */ }
        const chave = chaveDe(date);
        const guardado = lerJSON('study-journal-sessions', {})?.[chave];
        if (!guardado) return 0;
        return Object.values(guardado).reduce((a, b) => a + (Number(b) || 0), 0);
    }

    function minutosSemana() {
        const base = new Date();
        const dia = base.getDay();
        const segunda = new Date(base);
        segunda.setDate(base.getDate() - dia + (dia === 0 ? -6 : 1));
        segunda.setHours(0, 0, 0, 0);
        let total = 0;
        for (let i = 0; i < 7; i += 1) {
            const d = new Date(segunda);
            d.setDate(segunda.getDate() + i);
            total += minutosDoDia(d);
        }
        return total;
    }

    function minutosTotais() {
        try {
            if (window.StudySessions) {
                const total = window.StudySessions.obterTotal();
                return Object.values(total || {}).reduce((a, b) => a + (Number(b) || 0), 0);
            }
        } catch { /* segue */ }
        const todas = lerJSON('study-journal-sessions', {});
        let total = 0;
        Object.values(todas || {}).forEach((dia) => {
            Object.values(dia || {}).forEach((v) => { total += Number(v) || 0; });
        });
        return total;
    }

    function fmt(min) {
        const m = Math.max(0, Math.round(Number(min) || 0));
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60);
        const resto = m % 60;
        return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
    }

    function fmtCurto(min) {
        const m = Math.max(0, Math.round(Number(min) || 0));
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        const resto = m % 60;
        return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
    }

    function normalizar(t) {
        return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function esc(s) {
        return String(s ?? '');
    }

    /* ── Cabeçalho ──────────────────────────────────────── */

    function renderHead() {
        const hora = new Date().getHours();
        const saudacao = hora < 12 ? 'Bom dia' : hora < 20 ? 'Boa tarde' : 'Boa noite';
        const alvo = diaSelecionado();
        const ehHoje = chaveDe(alvo) === hojeChave();

        if ($('dash-greeting')) $('dash-greeting').textContent = `${saudacao}, Jorge`;
        if ($('dash-date-label')) {
            const texto = alvo.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
            $('dash-date-label').textContent = ehHoje ? `Hoje, ${texto}` : texto;
        }

        const tarefas = tarefasDoDia(chaveDe(alvo));
        const pendentes = tarefas.filter((t) => !t.done).length;
        const feitas = tarefas.filter((t) => t.done).length;
        const minutos = minutosDoDia(alvo);
        const proximo = proximoEvento();

        if ($('dash-summary')) {
            const partes = [];
            partes.push(pendentes === 0 && feitas === 0
                ? 'Sem tarefas para este dia'
                : `${pendentes} ${pendentes === 1 ? 'tarefa pendente' : 'tarefas pendentes'}`);
            if (feitas) partes.push(`${feitas} ${feitas === 1 ? 'concluída' : 'concluídas'}`);
            if (minutos > 0) partes.push(`${fmtCurto(minutos)} de estudo`);
            if (proximo) {
                const dias = Math.round((proximo.date - new Date().setHours(0, 0, 0, 0)) / 86400000);
                if (dias <= 30) {
                    partes.push(`${proximo.titulo} ${dias === 0 ? 'é hoje' : dias === 1 ? 'é amanhã' : `em ${dias} dias`}`);
                }
            }
            $('dash-summary').textContent = partes.join(' · ');
        }
    }

    /* ── Progresso diário ───────────────────────────────── */

    function renderProgresso() {
        const alvo = diaSelecionado();
        const tarefas = tarefasDoDia(chaveDe(alvo));
        const feitas = tarefas.filter((t) => t.done).length;
        const pendentes = tarefas.length - feitas;
        const pct = tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0;
        const minutos = minutosDoDia(alvo);

        if ($('dash-done')) $('dash-done').textContent = String(feitas);
        if ($('dash-pending')) $('dash-pending').textContent = String(pendentes);
        if ($('dash-minutes')) $('dash-minutes').textContent = fmtCurto(minutos);
        if ($('dash-percent')) $('dash-percent').textContent = `${pct}%`;
        const fill = $('dash-percent-fill');
        if (fill) fill.style.width = `${pct}%`;
    }

    /* ── Próximos eventos ───────────────────────────────── */

    function recolherEventos(dias = 75) {
        const eventos = [];
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const inicio = chaveDe(base);

        for (let i = 0; i < dias; i += 1) {
            const d = new Date(base);
            d.setDate(base.getDate() + i);
            const chave = chaveDe(d);
            tarefasDoDia(chave).forEach((t) => {
                const cat = String(t.category || '').toLowerCase();
                if (!/teste|trabalho|apresentacao|exame/.test(cat)) return;
                if (t.done) return;
                eventos.push({
                    date: d,
                    titulo: t.text,
                    tipo: /teste|exame/.test(cat) ? 'teste' : cat === 'apresentacao' ? 'apresentacao' : 'trabalho',
                    meta: t.subject || 'Geral',
                });
            });
        }

        try {
            const dados = window.Exames?.lerTudo?.();
            (dados?.exams || []).forEach((ex) => {
                if (!ex || ex.id === 'disc-geral') return;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ex.dataExame || ''))) return;
                if (String(ex.dataExame) < inicio) return;
                const [a, m, dia] = String(ex.dataExame).split('-').map(Number);
                eventos.push({
                    date: new Date(a, m - 1, dia),
                    titulo: `Exame: ${ex.nome}`,
                    tipo: 'exame',
                    meta: ex.nome,
                });
            });
        } catch { /* sem exames */ }

        eventos.sort((a, b) => a.date - b.date);
        return eventos;
    }

    function proximoEvento() {
        return recolherEventos(120)[0] || null;
    }

    function renderEventos() {
        const caixa = $('dash-upcoming');
        if (!caixa) return;
        const eventos = recolherEventos().slice(0, 6);
        if ($('dash-upcoming-count')) {
            $('dash-upcoming-count').textContent = eventos.length ? `${eventos.length}` : '';
        }
        caixa.replaceChildren();

        if (!eventos.length) {
            const vazio = document.createElement('div');
            vazio.className = 'dash-empty';
            vazio.textContent = 'Sem testes, trabalhos ou exames marcados.';
            caixa.append(vazio);
            return;
        }

        eventos.forEach((ev) => {
            const row = document.createElement('div');
            row.className = 'dash-event';

            const data = document.createElement('span');
            data.className = 'dash-event-date';
            const dd = document.createElement('span');
            dd.className = 'd';
            dd.textContent = String(ev.date.getDate()).padStart(2, '0');
            const mm = document.createElement('span');
            mm.className = 'm';
            mm.textContent = MESES[ev.date.getMonth()];
            data.append(dd, mm);

            const corpo = document.createElement('span');
            corpo.className = 'dash-event-body';
            const titulo = document.createElement('span');
            titulo.className = 'dash-event-title';
            titulo.textContent = ev.titulo;
            titulo.title = ev.titulo;
            const meta = document.createElement('span');
            meta.className = 'dash-event-meta';
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.classList.add(ev.tipo === 'teste' ? 'is-test' : ev.tipo === 'trabalho' ? 'is-work' : 'is-exam');
            tag.textContent = ev.tipo === 'teste' ? 'Teste' : ev.tipo === 'trabalho' ? 'Trabalho' : ev.tipo === 'exame' ? 'Exame' : 'Apresentação';
            meta.append(tag);
            if (ev.meta) {
                const sujeito = document.createElement('span');
                sujeito.textContent = ev.meta;
                meta.append(sujeito);
            }
            corpo.append(titulo, meta);
            row.append(data, corpo);

            row.tabIndex = 0;
            row.style.cursor = 'pointer';
            row.title = 'Abrir no calendário';
            row.addEventListener('click', () => {
                const chave = chaveDe(ev.date);
                if (window.StudyJournal?.abrirDia) window.StudyJournal.abrirDia(chave);
                else document.querySelector('[data-view="calendario"]')?.click();
            });
            caixa.append(row);
        });
    }

    /* ── Sessão / histórico ─────────────────────────────── */

    function registosSessao() {
        const lista = lerJSON('study-journal-session-log', []);
        return Array.isArray(lista) ? lista.filter((r) => r && r.minutos) : [];
    }

    function renderHistoricoSessao() {
        const caixa = $('focus-history');
        if (!caixa) return;
        const registos = registosSessao().slice(-6).reverse();
        caixa.replaceChildren();

        if (!registos.length) {
            const vazio = document.createElement('p');
            vazio.className = 'rev-empty';
            vazio.textContent = 'As sessões terminadas aparecem aqui.';
            caixa.append(vazio);
        } else {
            registos.forEach((r) => {
                const row = document.createElement('div');
                row.className = 'history-row';
                const icone = document.createElement('svg');
                icone.setAttribute('class', 'icon');
                icone.innerHTML = '<use href="#i-clock"/>';
                const quem = document.createElement('span');
                quem.className = 'who';
                const dia = r.day && r.day !== hojeChave()
                    ? `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`
                    : 'hoje';
                quem.textContent = [r.subject, r.goal].filter(Boolean).join(' · ');
                quem.title = quem.textContent;
                const quando = document.createElement('span');
                quando.className = 'who';
                quando.style.flex = '0 0 auto';
                quando.style.color = 'var(--sj-faint)';
                quando.textContent = dia;
                const mins = document.createElement('span');
                mins.className = 'mins';
                mins.textContent = fmtCurto(r.minutos);
                row.append(icone, quem, quando, mins);
                caixa.append(row);
            });
        }

        if ($('focus-session-count')) {
            const hoje = registosSessao().filter((r) => r.day === hojeChave());
            $('focus-session-count').textContent = `Hoje: ${hoje.length} ${hoje.length === 1 ? 'sessão' : 'sessões'}`;
        }
    }

    function refreshSession() {
        const agora = Date.now();
        if (agora - ultimaSessao < 900) return;
        ultimaSessao = agora;
        renderHistoricoSessao();
        const timer = $('session-time');
        const pausa = $('session-pause');
        if (timer && pausa) timer.classList.toggle('is-running', !pausa.classList.contains('hidden'));
    }

    /* ── Resumo académico ───────────────────────────────── */

    function resumoAcademico() {
        const disciplinas = new Set();
        const base = new Date();
        for (let i = 0; i < 60; i += 1) {
            const d = new Date(base);
            d.setDate(base.getDate() - i);
            tarefasDoDia(chaveDe(d)).forEach((t) => {
                if (t.subject && t.subject !== 'Geral') disciplinas.add(t.subject);
            });
        }

        let exames = [];
        let topicos = [];
        try {
            const dados = window.Exames?.lerTudo?.();
            exames = (dados?.exams || []).filter((e) => e && e.id !== 'disc-geral');
            topicos = (dados?.topics || []).filter((t) => t && t.tipo === 'topico');
            exames.forEach((e) => { if (e.nome && e.nome !== 'Geral') disciplinas.add(e.nome); });
        } catch { /* sem exames */ }

        const proximosExames = exames
            .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(String(e.dataExame || '')) && String(e.dataExame) >= hojeChave())
            .sort((a, b) => String(a.dataExame).localeCompare(String(b.dataExame)));

        let cartoes = [];
        try { cartoes = window.ReviewSystem?.lerV2?.() || []; } catch { /* segue */ }

        return {
            disciplinas: disciplinas.size,
            exames,
            proximosExames,
            topicos,
            topicosFeitos: topicos.filter((t) => t.estado === 'concluido').length,
            cartoes: Array.isArray(cartoes) ? cartoes : [],
        };
    }

    function linhasResumo(alvo) {
        const alvoEl = alvo;
        alvoEl.replaceChildren();
        const info = resumoAcademico();
        const semana = minutosSemana();
        const aprendidos = info.cartoes.filter((c) => Number(c.repeticoes || 0) >= 3 && Number(c.intervalo || 0) >= 7).length;

        const linhas = [
            ['Disciplinas ativas', String(info.disciplinas)],
            ['Exames marcados', String(info.exames.filter((e) => e.dataExame).length)],
            ['Tópicos concluídos', info.topicos.length ? `${Math.round((info.topicosFeitos / info.topicos.length) * 100)}%` : '—'],
            ['Cartões aprendidos', info.cartoes.length ? `${aprendidos}/${info.cartoes.length}` : '0'],
            ['Estudo esta semana', fmt(semana)],
        ];

        linhas.forEach(([rotulo, valor]) => {
            const row = document.createElement('div');
            row.className = 'dash-summary-row';
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = rotulo;
            const value = document.createElement('span');
            value.className = 'value';
            value.textContent = valor;
            row.append(label, value);
            alvoEl.append(row);
        });

        if (info.proximosExames.length) {
            const divisor = document.createElement('p');
            divisor.className = 'sj-kicker';
            divisor.style.marginTop = '4px';
            divisor.textContent = 'Próximos exames';
            alvoEl.append(divisor);

            const hoje = new Date().setHours(0, 0, 0, 0);
            info.proximosExames.slice(0, 3).forEach((ex) => {
                const [a, m, d] = String(ex.dataExame).split('-').map(Number);
                const dias = Math.max(0, Math.round((new Date(a, m - 1, d) - hoje) / 86400000));
                const doExame = info.topicos.filter((t) => t.disciplinaId === ex.id);
                const feitos = doExame.filter((t) => t.estado === 'concluido').length;
                const pct = doExame.length ? Math.round((feitos / doExame.length) * 100) : 0;

                const card = document.createElement('div');
                card.className = 'dash-exam';
                const top = document.createElement('div');
                top.className = 'dash-exam-top';
                const nome = document.createElement('span');
                nome.className = 'label';
                nome.textContent = ex.nome;
                const cd = document.createElement('span');
                cd.className = 'cd';
                cd.textContent = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `${dias} dias`;
                top.append(nome, cd);
                const bar = document.createElement('div');
                bar.className = 'dash-exam-bar';
                const fill = document.createElement('span');
                fill.style.width = `${pct}%`;
                bar.append(fill);
                const mini = document.createElement('span');
                mini.className = 'dash-mini';
                mini.textContent = doExame.length ? `${feitos} de ${doExame.length} tópicos` : 'Sem tópicos definidos';
                card.append(top, bar, mini);
                alvoEl.append(card);
            });
        }
    }

    function renderAcademico() {
        const alvo = $('dash-academic');
        if (alvo) linhasResumo(alvo);
    }

    /* ── Estatísticas ───────────────────────────────────── */

    function renderStats() {
        const academico = $('stat-academic');
        if (academico) linhasResumo(academico);

        const exames = $('stat-exams');
        if (exames) {
            exames.replaceChildren();
            const info = resumoAcademico();
            const dia = diaSelecionado();
            const tarefas = tarefasDoDia(chaveDe(dia));
            const feitas = tarefas.filter((t) => t.done).length;
            const pct = tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0;
            const vencidos = info.cartoes.filter((c) => String(c.proxima || hojeChave()) <= hojeChave()).length;

            const linhas = [
                ['Tarefas concluídas', tarefas.length ? `${feitas}/${tarefas.length} · ${pct}%` : '—'],
                ['Tempo total registado', fmt(minutosTotais())],
                ['Revisões para hoje', String(vencidos)],
                ['Registos de dificuldades', (() => {
                    try {
                        return String((window.Exames?.lerTudo?.().issues || []).filter((i) => i.estado !== 'resolvido').length);
                    } catch { return '0'; }
                })()],
            ];
            linhas.forEach(([rotulo, valor]) => {
                const row = document.createElement('div');
                row.className = 'dash-summary-row';
                const label = document.createElement('span');
                label.className = 'label';
                label.textContent = rotulo;
                const value = document.createElement('span');
                value.className = 'value';
                value.textContent = valor;
                row.append(label, value);
                exames.append(row);
            });
        }

        if ($('stat-hero-total')) {
            const minutos = minutosTotais();
            $('stat-hero-total').textContent = minutos >= 60 ? `${fmt(minutos)} registadas` : `${minutos} min registados`;
        }
    }

    /* ── Ações rápidas / shell ──────────────────────────── */

    function ligarAcoes() {
        $('dash-new-task')?.addEventListener('click', () => {
            const input = $('task-input');
            input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input?.focus();
        });

        $('dash-new-note')?.addEventListener('click', () => {
            const abrir = $('quick-note-open');
            if (abrir) {
                abrir.click();
                return;
            }
            const area = $('journal-text');
            area?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            area?.focus();
        });

        document.querySelectorAll('[data-go-view]').forEach((botao) => {
            botao.addEventListener('click', () => {
                const destino = botao.dataset.goView;
                const nav = document.querySelector(`#nav-rail [data-view="${destino}"]`)
                    || document.querySelector(`[data-view="${destino}"]`);
                if (nav) nav.click();
                else if (window.StudyJournal) window.StudyJournal.irAPainel();
            });
        });
    }

    function ligarSidebar() {
        const botao = $('sidebar-toggle');
        const aplicar = (recolhida) => {
            document.body.classList.toggle('sj-sidebar-collapsed', recolhida);
            if (!botao) return;
            botao.setAttribute('aria-pressed', String(recolhida));
            botao.title = recolhida ? 'Expandir menu' : 'Recolher menu';
            botao.setAttribute('aria-label', botao.title);
            const use = botao.querySelector('use');
            use?.setAttribute('href', recolhida ? '#i-expand' : '#i-collapse');
        };

        aplicar(localStorage.getItem('study-journal-sidebar-collapsed') === '1');
        botao?.addEventListener('click', () => {
            const recolhida = !document.body.classList.contains('sj-sidebar-collapsed');
            aplicar(recolhida);
            try { localStorage.setItem('study-journal-sidebar-collapsed', recolhida ? '1' : '0'); } catch { /* segue */ }
        });
    }

    function ligarSyncStatus() {
        const caixa = $('sidebar-sync-status');
        const label = $('sidebar-sync-label');
        const dot = $('sync-dot');
        if (!caixa || !label || !dot) return;

        const atualizar = () => {
            const titulo = String(dot.title || '');
            const classes = dot.className || '';
            caixa.classList.remove('is-ok', 'is-error', 'is-busy');
            if (/mint/.test(classes)) {
                caixa.classList.add('is-ok');
                label.textContent = titulo || 'Sincronizado';
            } else if (/rose/.test(classes)) {
                caixa.classList.add('is-error');
                label.textContent = 'Sync falhou — a repetir';
            } else if (/yellow/.test(classes)) {
                caixa.classList.add('is-busy');
                label.textContent = 'A sincronizar…';
            } else {
                label.textContent = 'Sync por ligar';
            }
            caixa.title = titulo || 'Estado da sincronização';
        };

        atualizar();
        new MutationObserver(atualizar).observe(dot, { attributes: true, attributeFilter: ['class', 'title'] });
    }

    /* ── Arranque ───────────────────────────────────────── */

    function render() {
        renderHead();
        renderProgresso();
        renderEventos();
        refreshSession();
        renderAcademico();
    }

    function refreshTasks() {
        renderHead();
        renderProgresso();
        renderEventos();
        renderAcademico();
        renderStats();
    }

    function init() {
        if (ligado) return;
        ligado = true;
        ligarAcoes();
        ligarSidebar();
        ligarSyncStatus();

        // Repõe o estado quando o dia muda (setas do topo, calendário, sync).
        ['study-journal:pull', 'studyjournal:pull'].forEach((evento) => {
            window.addEventListener(evento, render);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') render();
        });

        render();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return { render, refreshTasks, refreshSession, renderStats, renderEventos };
})();
