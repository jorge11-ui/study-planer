/* StudyJournal — Revisão inteligente.
   Flashcards com disciplina, tema, estado e repetição espaçada.
   Reutiliza o ReviewSystem do app.js (mesmas cartas que o Painel e a
   revisão das notas), por isso não existe um segundo sistema. */

window.Revisao = (() => {
    const filtroEstado = { atual: 'todos' };
    let editando = null;
    let ligado = false;

    const $ = (id) => document.getElementById(id);
    const rs = () => window.ReviewSystem;

    const ESTADOS = {
        'por-aprender': 'Por aprender',
        'em-revisao': 'Em revisão',
        aprendido: 'Aprendido',
    };

    const SUBJECTS = {
        'Matemática A': '#718DF5',
        FQA: '#D6B36A',
        Português: '#D98A8A',
        Biologia: '#7FC8A9',
        'Aplicações Informáticas (A.I.)': '#86BCDD',
        Hobbies: '#B49BE6',
        Geral: '#9297A3',
    };

    function normalizar(t) {
        return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function hojeChave() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function estadoDe(carta) {
        if (carta.estadoManual && ESTADOS[carta.estado]) return carta.estado;
        const reps = Number(carta.repeticoes || 0);
        const intervalo = Number(carta.intervalo || 1);
        if (reps >= 3 && intervalo >= 7) return 'aprendido';
        if (reps > 0) return 'em-revisao';
        return 'por-aprender';
    }

    function estaVencida(carta) {
        return String(carta.proxima || hojeChave()) <= hojeChave();
    }

    function cartas() {
        try {
            const lista = rs() ? rs().lerV2() : [];
            return Array.isArray(lista) ? lista : [];
        } catch {
            return [];
        }
    }

    function guardar(lista) {
        if (!rs()) return;
        rs().escreverV2(lista);
        try { if (typeof pushDebounced === 'function') pushDebounced(); } catch { /* segue */ }
        render();
        try { window.StudyStats?.renderReviewQueue?.(); } catch { /* segue */ }
    }

    function uid() {
        return `fc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    }

    function somarDias(dias) {
        const d = new Date();
        d.setDate(d.getDate() + dias);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatarProxima(carta) {
        if (!carta.proxima) return 'hoje';
        if (carta.proxima <= hojeChave()) return 'para hoje';
        const [a, m, d] = String(carta.proxima).split('-');
        return `${d}/${m}`;
    }

    /* ── Formulário ─────────────────────────────────────── */

    function limparFormulario() {
        editando = null;
        const form = $('rev-form');
        form?.reset();
        if ($('rev-id')) $('rev-id').value = '';
        if ($('rev-form-title')) $('rev-form-title').textContent = 'Nova flashcard';
        if ($('rev-submit-label')) $('rev-submit-label').textContent = 'Criar cartão';
        $('rev-cancel')?.classList.add('hidden');
    }

    function submeter(evento) {
        evento.preventDefault();
        const titulo = String($('rev-title')?.value || '').trim();
        if (!titulo) {
            $('rev-title')?.focus();
            return;
        }
        const materia = $('rev-subject')?.value || 'Geral';
        const tema = String($('rev-topic')?.value || '').trim();
        const texto = String($('rev-text')?.value || '').trim();
        const lista = cartas();

        if (editando) {
            const carta = lista.find((c) => c.id === editando);
            if (carta) {
                carta.titulo = titulo.slice(0, 160);
                carta.texto = texto.slice(0, 1200);
                carta.materia = materia;
                carta.tema = tema.slice(0, 80);
                carta.editadaEm = new Date().toISOString();
            }
            guardar(lista);
        } else {
            lista.unshift({
                id: uid(),
                dia: '',
                titulo: titulo.slice(0, 160),
                texto: texto.slice(0, 1200),
                materia,
                tema: tema.slice(0, 80),
                estado: 'por-aprender',
                intervalo: 1,
                repeticoes: 0,
                ease: 2.5,
                proxima: hojeChave(),
                criadaEm: new Date().toISOString(),
                origem: 'manual',
            });
            guardar(lista);
        }
        limparFormulario();
    }

    function editar(id) {
        const carta = cartas().find((c) => c.id === id);
        if (!carta) return;
        editando = id;
        if ($('rev-id')) $('rev-id').value = id;
        if ($('rev-title')) $('rev-title').value = carta.titulo || '';
        if ($('rev-subject')) $('rev-subject').value = carta.materia || 'Geral';
        if ($('rev-topic')) $('rev-topic').value = carta.tema || '';
        if ($('rev-text')) $('rev-text').value = carta.texto || '';
        if ($('rev-form-title')) $('rev-form-title').textContent = 'Editar flashcard';
        if ($('rev-submit-label')) $('rev-submit-label').textContent = 'Guardar alterações';
        $('rev-cancel')?.classList.remove('hidden');
        $('rev-title')?.focus();
        document.querySelector('#view-revisao .rev-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function apagar(id) {
        const carta = cartas().find((c) => c.id === id);
        if (!carta) return;
        if (!confirm(`Apagar "${carta.titulo || 'cartão'}"?`)) return;
        guardar(cartas().filter((c) => c.id !== id));
        if (editando === id) limparFormulario();
    }

    function marcarAprendido(id) {
        const lista = cartas();
        const carta = lista.find((c) => c.id === id);
        if (!carta) return;
        carta.estado = 'aprendido';
        carta.estadoManual = true;
        carta.repeticoes = Math.max(3, Number(carta.repeticoes || 0));
        carta.intervalo = Math.max(10, Number(carta.intervalo || 1));
        carta.proxima = somarDias(carta.intervalo);
        carta.revistaEm = new Date().toISOString();
        guardar(lista);
        if (typeof toast === 'function') toast('Cartão marcado como aprendido.', 'success');
    }

    function responder(id, grade) {
        if (!rs()) return;
        rs().responder(id, Number(grade));
        render();
        try { window.StudyStats?.renderReviewQueue?.(); } catch { /* segue */ }
    }

    /* ── Render ─────────────────────────────────────────── */

    function renderStats(lista) {
        const vencidas = lista.filter(estaVencida).length;
        const porAprender = lista.filter((c) => estadoDe(c) === 'por-aprender').length;
        const emRevisao = lista.filter((c) => estadoDe(c) === 'em-revisao').length;
        const aprendidos = lista.filter((c) => estadoDe(c) === 'aprendido').length;

        if ($('rev-stat-due')) $('rev-stat-due').textContent = String(vencidas);
        if ($('rev-stat-learning')) $('rev-stat-learning').textContent = String(porAprender);
        if ($('rev-stat-review')) $('rev-stat-review').textContent = String(emRevisao);
        if ($('rev-stat-learned')) $('rev-stat-learned').textContent = String(aprendidos);
        if ($('rev-list-count')) {
            $('rev-list-count').textContent = `${lista.length} ${lista.length === 1 ? 'cartão' : 'cartões'}`;
        }

        const badge = $('nav-revisao-badge');
        if (badge) {
            badge.textContent = vencidas ? String(vencidas) : '';
            badge.classList.toggle('hidden', vencidas === 0);
        }
        const topbarBadge = $('topbar-review-badge');
        if (topbarBadge) {
            topbarBadge.textContent = vencidas ? String(vencidas) : '';
            topbarBadge.classList.toggle('hidden', vencidas === 0);
            const button = $('topbar-reviews-btn');
            button?.setAttribute('aria-label', vencidas ? `${vencidas} revisões pendentes` : 'Revisões pendentes');
            button?.setAttribute('title', vencidas ? `${vencidas} revisões pendentes` : 'Revisões pendentes');
        }
    }

    function renderSugestoes() {
        const caixa = $('rev-suggestions');
        if (!caixa) return;
        let issues = [];
        try {
            const dados = window.Exames?.lerTudo?.();
            issues = (dados?.issues || []).filter((i) => i && i.estado !== 'resolvido');
        } catch { /* sem exames */ }

        const existentes = new Set(cartas().map((c) => c.origemId).filter(Boolean));
        const novas = issues.filter((i) => i.id && !existentes.has(i.id)).slice(0, 4);

        caixa.replaceChildren();
        if (!novas.length) {
            caixa.hidden = true;
            return;
        }
        caixa.hidden = false;

        const titulo = document.createElement('p');
        titulo.className = 'sj-kicker';
        titulo.textContent = 'Sugestões a partir das tuas dificuldades';
        caixa.append(titulo);

        novas.forEach((issue) => {
            const row = document.createElement('div');
            row.className = 'rev-suggest-row';
            const texto = document.createElement('span');
            texto.className = 'label';
            const disciplina = (window.Exames?.lerTudo?.().exams || []).find((e) => e.id === issue.disciplinaId);
            texto.textContent = [disciplina?.nome, issue.titulo].filter(Boolean).join(' · ') || 'Registo de exame';
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'btn-soft';
            botao.textContent = 'Criar cartão';
            botao.addEventListener('click', () => {
                const disciplina2 = (window.Exames?.lerTudo?.().exams || []).find((e) => e.id === issue.disciplinaId);
                rs()?.criarAPartirDeDuvida?.({
                    id: issue.id,
                    titulo: issue.titulo || 'Dificuldade registada',
                    texto: issue.descricao || '',
                    disciplina: disciplina2?.nome || '',
                });
                render();
                if (typeof toast === 'function') toast('Cartão criado a partir do registo.', 'success');
            });
            row.append(texto, botao);
            caixa.append(row);
        });
    }

    function estadoFilto(carta) {
        if (filtroEstado.atual === 'vencidos') return estaVencida(carta);
        if (filtroEstado.atual === 'todos') return true;
        return estadoDe(carta) === filtroEstado.atual;
    }

    function renderLista(lista) {
        const caixa = $('rev-list');
        if (!caixa) return;
        caixa.replaceChildren();

        const filtradas = lista
            .filter(estadoFilto)
            .sort((a, b) => String(a.proxima || '').localeCompare(String(b.proxima || '')));

        if (!filtradas.length) {
            const vazio = document.createElement('p');
            vazio.className = 'rev-empty';
            vazio.textContent = lista.length
                ? 'Nenhum cartão neste estado.'
                : 'Ainda não há cartões. Cria o primeiro à esquerda.';
            caixa.append(vazio);
            return;
        }

        filtradas.forEach((carta) => {
            const estado = estadoDe(carta);
            const card = document.createElement('article');
            card.className = 'rev-card';

            const top = document.createElement('div');
            top.className = 'rev-card-top';

            const titulo = document.createElement('h4');
            titulo.className = 'rev-card-title';
            titulo.textContent = carta.titulo || (carta.dia ? `Nota de ${carta.dia}` : 'Revisão');

            const chipEstado = document.createElement('span');
            chipEstado.className = `rev-state ${estado}`;
            chipEstado.textContent = ESTADOS[estado];

            top.append(titulo, chipEstado);

            const meta = document.createElement('div');
            meta.className = 'rev-card-foot';
            const materia = document.createElement('span');
            materia.className = 'chip';
            const cor = SUBJECTS[carta.materia] || SUBJECTS.Geral;
            materia.style.color = cor;
            materia.style.borderColor = `${cor}44`;
            materia.textContent = carta.materia || 'Geral';
            meta.append(materia);
            if (carta.tema) {
                const tema = document.createElement('span');
                tema.className = 'chip';
                tema.textContent = carta.tema;
                meta.append(tema);
            }
            if (carta.dia) {
                const origem = document.createElement('span');
                origem.className = 'chip';
                origem.textContent = `Nota ${carta.dia}`;
                meta.append(origem);
            }

            card.append(top, meta);

            if ((carta.texto || '').trim()) {
                const corpo = document.createElement('p');
                corpo.className = 'rev-card-text';
                corpo.textContent = carta.texto;
                card.append(corpo);
            }

            const acoes = document.createElement('div');
            acoes.className = 'rev-card-foot';

            const proxima = document.createElement('span');
            proxima.className = 'rev-next';
            proxima.textContent = `Próxima: ${formatarProxima(carta)} · intervalo ${carta.intervalo || 1}d`;
            acoes.append(proxima);

            if (carta.dia) {
                const abrir = document.createElement('button');
                abrir.type = 'button';
                abrir.className = 'btn-soft';
                abrir.textContent = 'Abrir nota';
                abrir.addEventListener('click', () => window.StudyJournal?.abrirDia?.(carta.dia));
                acoes.append(abrir);
            }

            [['0', 'Falhei'], ['1', 'Quase'], ['2', 'Lembrei']].forEach(([grade, rotulo]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = grade === '2' ? 'btn-mint' : 'btn-soft';
                b.textContent = rotulo;
                b.addEventListener('click', () => responder(carta.id, grade));
                acoes.append(b);
            });

            if (estado !== 'aprendido') {
                const aprendi = document.createElement('button');
                aprendi.type = 'button';
                aprendi.className = 'btn-soft';
                aprendi.textContent = 'Aprendi';
                aprendi.title = 'Marcar como aprendido e agendar revisão daqui a 10 dias';
                aprendi.addEventListener('click', () => marcarAprendido(carta.id));
                acoes.append(aprendi);
            }

            const editarBtn = document.createElement('button');
            editarBtn.type = 'button';
            editarBtn.className = 'icon-btn';
            editarBtn.title = 'Editar';
            editarBtn.innerHTML = '<svg class="icon"><use href="#i-pencil"/></svg>';
            editarBtn.addEventListener('click', () => editar(carta.id));

            const apagarBtn = document.createElement('button');
            apagarBtn.type = 'button';
            apagarBtn.className = 'icon-btn';
            apagarBtn.title = 'Apagar';
            apagarBtn.innerHTML = '<svg class="icon"><use href="#i-trash"/></svg>';
            apagarBtn.addEventListener('click', () => apagar(carta.id));

            acoes.append(editarBtn, apagarBtn);
            card.append(acoes);
            caixa.append(card);
        });
    }

    function render() {
        const lista = cartas();
        renderStats(lista);
        renderSugestoes();
        renderLista(lista);
    }

    /* ── Ligação ────────────────────────────────────────── */

    function ligar() {
        if (ligado) return;
        ligado = true;

        $('rev-form')?.addEventListener('submit', submeter);
        $('rev-cancel')?.addEventListener('click', limparFormulario);

        document.querySelectorAll('[data-rev-filter]').forEach((botao) => {
            botao.addEventListener('click', () => {
                filtroEstado.atual = botao.dataset.revFilter || 'todos';
                document.querySelectorAll('[data-rev-filter]').forEach((b) => {
                    b.classList.toggle('active', b === botao);
                });
                render();
            });
        });

        // Mantém a vista viva quando o Painel ou o foco de revisão alteram cartas.
        document.addEventListener('sj:review-changed', render);
        window.addEventListener('studyjournal:reviews-sync', render);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ligar();
            render();
        });
    } else {
        ligar();
        render();
    }

    return { render, ligar, editar, apagar };
})();
