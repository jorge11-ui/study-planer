window.Weekly = (() => {
    const CHAVE_FIXO = 'study-journal-semanal-fixo';
    const CHAVE_DINAMICO_PREFIXO = 'study-journal-semanal-dinamico-';
    const CHAVE_DINAMICO_ATUAL = 'study-journal-semanal-dinamico-atual';

    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const DIAS_COMPLETOS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
    const HORA_INICIO = 6;
    const HORA_FIM = 24;
    const PASSOS_VALIDOS = [0.25, 0.5, 1]; // 15, 30 ou 60 minutos
    const CHAVE_PASSO = 'study-journal-semanal-passo';
    const PX_POR_HORA = 48; // altura em px de 1h de bloco
    let passoHoras = 0.5;
    let SLOTS = [];

    function construirSlots() {
        SLOTS = [];
        for (let h = HORA_INICIO; h < HORA_FIM; h = Math.round((h + passoHoras) * 100) / 100) {
            SLOTS.push(h);
        }
    }

    function lerPasso() {
        try {
            const v = Number(localStorage.getItem(CHAVE_PASSO));
            if (PASSOS_VALIDOS.includes(v)) passoHoras = v;
        } catch { /* resolução padrão */ }
        construirSlots();
    }

    function guardarPasso() {
        try {
            localStorage.setItem(CHAVE_PASSO, String(passoHoras));
        } catch { /* segue sem persistir */ }
    }

    function fmtHora(h) {
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    function fmtDuracao(d) {
        const totalMin = Math.round(d * 60);
        if (totalMin < 60) return `${totalMin} min`;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }

    const TEXTOS = {
        fixo: 'Fixo (recorrente)',
        dinamico: 'Dinâmico (semanal)',
        novoTitulo: 'Novo compromisso',
        editarTitulo: 'Editar compromisso',
        semCompromissos: 'Semana sem compromissos. Clica num horário para adicionar.',
        apagar: 'Apagar',
        salvar: 'Salvar',
        cancelar: 'Cancelar',
    };

    const COR_MAP = {
        brand: '--color-brand',
        blue: '--color-subject-blue',
        green: '--color-subject-green',
        yellow: '--color-subject-yellow',
        cyan: '--color-subject-cyan',
        rose: '--color-subject-rose',
        purple: '--color-subject-violet',
    };

    let fixos = [];
    let dinamicos = [];
    let semanaAtual = '';
    let editandoId = null;
    let arrastando = null;
    let duplicando = null;
    let criacaoArrastada = false;
    let relogioTimer = null;
    let diaVisivel = null; // telemóvel: um dia de cada vez (1=Seg … 7=Dom)

    function diaDaSemanaHoje() {
        return (new Date().getDay() + 6) % 7 + 1;
    }

    function normalizar(t) {
        return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function semanaKey(date = new Date()) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().slice(0, 10);
    }

    function getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return weekNo;
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
            return true;
        } catch {
            return false;
        }
    }

    function carregar() {
        lerPasso();
        fixos = lerFixos().map(normalizarEvento);
        semanaAtual = semanaAtual || semanaKey();
        localStorage.setItem(CHAVE_DINAMICO_ATUAL, semanaAtual);
        dinamicos = lerDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual).map(normalizarEvento);
    }

    function salvar() {
        escreverFixos();
        escreverDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual, dinamicos);
        if (window.onWeeklySave) window.onWeeklySave();
    }

    function normalizarEvento(e) {
        return {
            id: String(e.id),
            titulo: String(e.titulo || '').trim(),
            dia: Number(e.dia),
            hora: Number(e.hora),
            duracao: Number(e.duracao) || 1,
            cor: String(e.cor || 'brand'),
            notas: String(e.notas || ''),
            layer: e.layer === 'dinamico' ? 'dinamico' : 'fixo',
        };
    }

    function gerarId() {
        return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function semanaAnterior() {
        const inicio = new Date(semanaAtual);
        inicio.setDate(inicio.getDate() - 7);
        mudarSemana(inicio);
    }

    function semanaSeguinte() {
        const inicio = new Date(semanaAtual);
        inicio.setDate(inicio.getDate() + 7);
        mudarSemana(inicio);
    }

    function mudarSemana(novaData) {
        const key = semanaKey(novaData);
        if (key === semanaAtual) return;
        
        salvar();
        semanaAtual = key;
        localStorage.setItem(CHAVE_DINAMICO_ATUAL, semanaAtual);
        dinamicos = lerDinamicos(CHAVE_DINAMICO_PREFIXO + semanaAtual).map(normalizarEvento);
        render();
    }

    function irParaSemanaAtual() {
        diaVisivel = diaDaSemanaHoje();
        mudarSemana(new Date());
        render();
        rolarParaLinha();
    }

    function verDia(dia) {
        const n = Number(dia);
        if (n < 1 || n > 7) return;
        diaVisivel = n;
        render();
    }

    function render() {
        const tbody = document.getElementById('week-body');
        const label = document.getElementById('week-label');
        const weekNumber = document.getElementById('week-number');
        const empty = document.getElementById('week-empty');
        const btnPrev = document.getElementById('week-prev');
        const btnNext = document.getElementById('week-next');
        const btnToday = document.getElementById('week-today');

        if (label) {
            const inicio = new Date(semanaAtual);
            const fim = new Date(inicio);
            fim.setDate(fim.getDate() + 6);
            const fmt = d => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
            label.textContent = `${fmt(inicio)} – ${fmt(fim)}`;
        }

        if (weekNumber) {
            const inicio = new Date(semanaAtual);
            weekNumber.textContent = `Semana ${getWeekNumber(inicio)}`;
        }

        const hoje = new Date();
        const inicioSemana = new Date(semanaAtual);
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(fimSemana.getDate() + 6);
        const isCurrentWeek = hoje >= inicioSemana && hoje <= fimSemana;

        if (btnPrev) btnPrev.disabled = false;
        if (btnNext) btnNext.disabled = false;
        if (btnToday) {
            btnToday.hidden = isCurrentWeek;
            btnToday.setAttribute('aria-pressed', String(isCurrentWeek));
        }

        if (!tbody) return;

        document.querySelectorAll('[data-week-passo]').forEach(b => {
            b.setAttribute('aria-pressed', String(Number(b.dataset.weekPasso) === passoHoras));
        });

        if (diaVisivel === null) diaVisivel = isCurrentWeek ? diaDaSemanaHoje() : 1;
        const tabela = document.getElementById('week-grid');
        if (tabela) tabela.setAttribute('data-dia-visivel', String(diaVisivel));
        document.querySelectorAll('[data-week-dia]').forEach(b => {
            b.setAttribute('aria-pressed', String(Number(b.dataset.weekDia) === diaVisivel));
        });

        let temEventos = false;
        let html = '';
        const alturaLinha = passoHoras * PX_POR_HORA;

        for (const hora of SLOTS) {
            // Na resolução de 15 min só as meias-horas levam rótulo
            const mostraLabel = passoHoras >= 0.5 || Number.isInteger(hora * 2);
            const horaLabel = mostraLabel ? fmtHora(hora) : '';
            html += `<tr><th class="sticky left-0 w-16 px-2 py-0 text-right text-[10px] font-medium leading-none text-faint bg-surface border-r border-line">${horaLabel}</th>`;

            for (let dia = 1; dia <= 7; dia++) {
                // Eventos que começam dentro deste slot (funciona em qualquer resolução)
                const fixosQueComecam = fixos.filter(e => e.dia === dia && e.hora >= hora && e.hora < hora + passoHoras);
                const dinamicosQueComecam = dinamicos.filter(e => e.dia === dia && e.hora >= hora && e.hora < hora + passoHoras);
                
                let cellHtml = '';
                if (fixosQueComecam.length > 0 || dinamicosQueComecam.length > 0) {
                    const fixosHtml = fixosQueComecam.map(e => {
                        const varCor = COR_MAP[e.cor] || '--color-brand';
                        return `
                        <div class="week-block week-block-fixo" style="background: var(${varCor}); height: ${e.duracao * PX_POR_HORA}px;" 
                             data-id="${e.id}" data-layer="fixo" data-dia="${dia}" data-hora="${e.hora}" title="${e.titulo}${e.notas ? ': ' + e.notas : ''}">
                             <span class="week-block-title">${e.titulo}</span>
                             ${e.duracao > 1 ? `<span class="week-block-duracao">${fmtDuracao(e.duracao)}</span>` : ''}
                        </div>
                        `;
                    }).join('');

                    const dinamicosHtml = dinamicosQueComecam.map(e => {
                        const varCor = COR_MAP[e.cor] || '--color-brand';
                        return `
                        <div class="week-block week-block-dinamico" style="border-color: var(${varCor}); height: ${e.duracao * PX_POR_HORA}px;" 
                             data-id="${e.id}" data-layer="dinamico" data-dia="${dia}" data-hora="${e.hora}" draggable="true" title="${e.titulo}${e.notas ? ': ' + e.notas : ''}">
                             <span class="week-block-title">${e.titulo}</span>
                             ${e.duracao > 1 ? `<span class="week-block-duracao">${fmtDuracao(e.duracao)}</span>` : ''}
                        </div>
                        `;
                    }).join('');

                    cellHtml = `<div class="week-cell-content">${fixosHtml}${dinamicosHtml}</div>`;
                    temEventos = true;
                }

                const cellDate = new Date(inicioSemana);
                cellDate.setDate(cellDate.getDate() + dia - 1);
                const isToday = cellDate.toDateString() === hoje.toDateString();
                const isWeekend = dia === 6 || dia === 7;

                html += `<td tabindex="0" class="week-cell relative min-h-6 p-0.5 border-r border-line ${isToday ? 'bg-brand/5' : ''} ${isWeekend ? 'bg-surface-2/50' : ''}"
                          style="height:${alturaLinha}px"
                          data-dia="${dia}" data-hora="${hora}" ${isToday ? 'data-hoje="true"' : ''} ${isWeekend ? 'data-fim-semana="true"' : ''}>
                    ${cellHtml}
                </td>`;
            }
            html += '</tr>';
        }

        tbody.innerHTML = html;

        if (empty) empty.hidden = temEventos;

        desenharLinhaAtual();
    }

    /* ── Linha da hora atual ───────────────────────────── */
    function desenharLinhaAtual() {
        const wrap = document.getElementById('week-grid-wrap');
        const table = document.getElementById('week-grid');
        if (!wrap || !table) return;
        wrap.querySelector('.week-now-line')?.remove();

        const agora = new Date();
        const inicioSemana = new Date(semanaAtual);
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(fimSemana.getDate() + 6);
        fimSemana.setHours(23, 59, 59, 999);
        if (agora < inicioSemana || agora > fimSemana) return;

        const decimal = agora.getHours() + agora.getMinutes() / 60 + agora.getSeconds() / 3600;
        if (decimal < HORA_INICIO || decimal >= HORA_FIM) return;

        const thead = table.querySelector('thead');
        const topo = (thead ? thead.offsetHeight : 0) + (decimal - HORA_INICIO) * PX_POR_HORA;

        const linha = document.createElement('div');
        linha.className = 'week-now-line';
        linha.style.top = `${topo}px`;
        const rotulo = document.createElement('span');
        rotulo.textContent = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
        linha.append(rotulo);
        wrap.append(linha);
    }

    function rolarParaLinha() {
        const vista = document.getElementById('view-semanal');
        if (vista && vista.hidden) return;
        const linha = document.querySelector('#week-grid-wrap .week-now-line');
        if (linha) linha.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function garantirOpcao(select, valor, rotulo) {
        if (!select) return;
        const existe = [...select.options].some(o => o.value === valor);
        if (!existe) {
            const opt = document.createElement('option');
            opt.value = valor;
            opt.textContent = rotulo;
            select.append(opt);
        }
    }

    function abrirFormulario(evento = null, dia = null, hora = null) {
        sairModoColocacao();
        const dlg = document.getElementById('week-form');
        const form = dlg.querySelector('form');
        form.reset();

        const title = dlg.querySelector('#week-form-title');
        const apagarBtn = dlg.querySelector('#week-apagar');
        const duplicarBtn = dlg.querySelector('#week-duplicar');
        const layerFixo = dlg.querySelector('[data-week-layer="fixo"]');
        const layerDinamico = dlg.querySelector('[data-week-layer="dinamico"]');
        const horaSelect = dlg.querySelector('#week-hora');
        const diaSelect = dlg.querySelector('#week-dia');
        const duracaoSelect = dlg.querySelector('#week-duracao');

        horaSelect.innerHTML = SLOTS.map(h => `<option value="${h}">${fmtHora(h)}</option>`).join('');
        diaSelect.innerHTML = DIAS.map((d, i) => `<option value="${i + 1}">${DIAS_COMPLETOS[i]}</option>`).join('');

        if (evento) {
            editandoId = evento.id;
            title.textContent = TEXTOS.editarTitulo;
            apagarBtn.hidden = false;
            if (duplicarBtn) duplicarBtn.hidden = false;

            garantirOpcao(horaSelect, String(evento.hora), fmtHora(evento.hora));
            garantirOpcao(duracaoSelect, String(evento.duracao), fmtDuracao(evento.duracao));

            dlg.querySelector('#week-titulo').value = evento.titulo;
            dlg.querySelector('#week-dia').value = String(evento.dia);
            dlg.querySelector('#week-hora').value = String(evento.hora);
            dlg.querySelector('#week-duracao').value = String(evento.duracao);
            dlg.querySelector('#week-cor').value = evento.cor;
            dlg.querySelector('#week-notas').value = evento.notas || '';

            if (evento.layer === 'dinamico') {
                layerDinamico.setAttribute('aria-pressed', 'true');
                layerFixo.setAttribute('aria-pressed', 'false');
            } else {
                layerFixo.setAttribute('aria-pressed', 'true');
                layerDinamico.setAttribute('aria-pressed', 'false');
            }
        } else {
            editandoId = null;
            title.textContent = TEXTOS.novoTitulo;
            apagarBtn.hidden = true;
            if (duplicarBtn) duplicarBtn.hidden = true;

            if (dia !== null) dlg.querySelector('#week-dia').value = String(dia);
            if (hora !== null) dlg.querySelector('#week-hora').value = String(hora);

            layerFixo.setAttribute('aria-pressed', 'true');
            layerDinamico.setAttribute('aria-pressed', 'false');
        }

        dlg.showModal();
        dlg.querySelector('#week-titulo').focus();
    }

    function fecharFormulario() {
        const dlg = document.getElementById('week-form');
        if (dlg.open) dlg.close();
        editandoId = null;
    }

    function getLayerAtivo() {
        return document.querySelector('[data-week-layer][aria-pressed="true"]').dataset.weekLayer;
    }

    function salvarEvento() {
        const dlg = document.getElementById('week-form');
        const titulo = dlg.querySelector('#week-titulo').value.trim();
        const dia = Number(dlg.querySelector('#week-dia').value);
        const hora = Number(dlg.querySelector('#week-hora').value);
        const duracao = Number(dlg.querySelector('#week-duracao').value);
        const cor = dlg.querySelector('#week-cor').value;
        const notas = dlg.querySelector('#week-notas').value.trim();
        const layer = getLayerAtivo();

        if (!titulo) {
            toast('Dá um título ao compromisso.', 'warn');
            return;
        }

        if (editandoId) {
            const lista = layer === 'dinamico' ? dinamicos : fixos;
            const idx = lista.findIndex(e => e.id === editandoId);
            if (idx !== -1) {
                lista[idx] = { ...lista[idx], titulo, dia, hora, duracao, cor, notas, layer };
            }
        } else {
            const novo = {
                id: gerarId(),
                titulo, dia, hora, duracao, cor, notas, layer,
            };
            if (layer === 'dinamico') dinamicos.push(novo);
            else fixos.push(novo);
        }

        salvar();
        render();
        dlg.close();
        const eraEdicao = editandoId !== null;
        editandoId = null;
        toast(`Compromisso ${eraEdicao ? 'atualizado' : 'adicionado'}.`, 'success');
    }

    function apagarEvento() {
        if (!editandoId) return;
        if (!confirm('Apagar este compromisso?')) return;

        const layer = getLayerAtivo();
        if (layer === 'dinamico') {
            dinamicos = dinamicos.filter(e => e.id !== editandoId);
        } else {
            fixos = fixos.filter(e => e.id !== editandoId);
        }

        salvar();
        render();
        fecharFormulario();
        toast('Compromisso apagado.', 'success');
    }

    /* ── Duplicar rotina ─────────────────────────────────
       Guarda uma cópia e entra em modo colocação: o próximo clique
       numa célula põe a cópia nesse horário. Esc cancela. */

    function modoColocacao() {
        return duplicando !== null;
    }

    function entrarModoColocacao(copia) {
        duplicando = copia;
        document.getElementById('week-grid')?.classList.add('week-grid-placing');
        toast('Clica no horário onde queres a cópia. (Esc cancela)', 'info');
        const alvo = document.querySelector(
            `#week-body .week-cell[data-dia="${copia.origemDia}"][data-hora="${copia.origemHora}"]`
        ) || document.querySelector('#week-body .week-cell');
        alvo?.focus({ preventScroll: true });
    }

    function sairModoColocacao() {
        duplicando = null;
        document.getElementById('week-grid')?.classList.remove('week-grid-placing');
    }

    function colocarCopia(dia, hora) {
        const { origemDia, origemHora, ...dados } = duplicando;
        const copia = { ...dados, id: gerarId(), dia, hora };
        if (copia.layer === 'dinamico') dinamicos.push(copia);
        else fixos.push(copia);
        sairModoColocacao();
        salvar();
        render();
        toast('Cópia colocada.', 'success');
    }

    function duplicarAtual() {
        const dlg = document.getElementById('week-form');
        const titulo = dlg.querySelector('#week-titulo').value.trim() || 'Cópia';
        const duracao = Number(dlg.querySelector('#week-duracao').value) || passoHoras;
        const cor = dlg.querySelector('#week-cor').value;
        const notas = dlg.querySelector('#week-notas').value.trim();
        const layer = getLayerAtivo();
        let origem = { dia: 1, hora: HORA_INICIO };
        if (editandoId) {
            const lista = layer === 'dinamico' ? dinamicos : fixos;
            const original = lista.find(e => e.id === editandoId);
            if (original) origem = { dia: original.dia, hora: original.hora };
        }
        fecharFormulario();
        entrarModoColocacao({
            titulo, duracao, cor, notas, layer,
            origemDia: origem.dia, origemHora: origem.hora,
        });
    }

    function ligarOuvintes() {
        const tbody = document.getElementById('week-body');
        const dlg = document.getElementById('week-form');
        const btnPrev = document.getElementById('week-prev');
        const btnNext = document.getElementById('week-next');
        const btnToday = document.getElementById('week-today');

        if (btnPrev && !btnPrev.dataset.bound) {
            btnPrev.dataset.bound = 'true';
            btnPrev.addEventListener('click', semanaAnterior);
        }
        if (btnNext && !btnNext.dataset.bound) {
            btnNext.dataset.bound = 'true';
            btnNext.addEventListener('click', semanaSeguinte);
        }
        if (btnToday && !btnToday.dataset.bound) {
            btnToday.dataset.bound = 'true';
            btnToday.addEventListener('click', irParaSemanaAtual);
        }

        if (tbody && !tbody.dataset.weekBound) {
            tbody.dataset.weekBound = 'true';

            let resizeData = null;

            const startResize = (e) => {
                const block = e.target.closest('.week-block');
                if (!block) return;

                const rect = block.getBoundingClientRect();
                // Zona de resize adapta-se à altura do bloco (blocos de 15 min são baixos)
                const zona = Math.min(15, Math.max(6, rect.height * 0.35));
                const offsetY = e.clientY - rect.top;
                if (offsetY < rect.height - zona) return;

                e.preventDefault();
                e.stopPropagation();

                const id = block.dataset.id;
                const layer = block.dataset.layer;
                const lista = layer === 'dinamico' ? dinamicos : fixos;
                const evento = lista.find(e => e.id === id);

                if (!evento) return;

                resizeData = {
                    evento,
                    layer,
                    startY: e.clientY,
                    startDuracao: evento.duracao,
                    blockElement: block,
                    raf: 0,
                    evt: null,
                };

                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeEnd);
            };

            const aplicarResize = () => {
                resizeData.raf = 0;
                if (!resizeData) return;
                const e = resizeData.evt;
                const deltaY = e.clientY - resizeData.startY;
                // Encaixa à resolução atual (15/30/60 min)
                const deltaDuracao = Math.round(deltaY / PX_POR_HORA / passoHoras) * passoHoras;
                const novaDuracao = Math.max(passoHoras, Math.round((resizeData.startDuracao + deltaDuracao) * 100) / 100);

                if (novaDuracao !== resizeData.evento.duracao) {
                    resizeData.evento.duracao = novaDuracao;
                    resizeData.blockElement.style.height = `${novaDuracao * PX_POR_HORA}px`;
                    const duracaoEl = resizeData.blockElement.querySelector('.week-block-duracao');
                    if (duracaoEl) {
                        duracaoEl.textContent = fmtDuracao(novaDuracao);
                        duracaoEl.style.display = novaDuracao > 1 ? 'block' : 'none';
                    }
                }
            };

            const onResizeMove = (e) => {
                if (!resizeData || resizeData.raf) return;
                resizeData.evt = e;
                resizeData.raf = requestAnimationFrame(aplicarResize);
            };

            const onResizeEnd = () => {
                if (resizeData) {
                    if (resizeData.raf) cancelAnimationFrame(resizeData.raf);
                    salvar();
                    render();
                    resizeData = null;
                }
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeEnd);
            };

            tbody.addEventListener('mousedown', startResize);

            /* ── Criar por arrasto: prime na célula e arrasta para baixo.
               O destaque atualiza via rAF (suave); ao largar abre o
               formulário já com dia/hora/duração. Sem arrasto = clique normal. */
            let criacao = null;
            let rafCriacao = 0;

            const limparDestaqueCriacao = () => {
                tbody.querySelectorAll('.drag-select').forEach(c => c.classList.remove('drag-select'));
            };

            const pintarCriacao = () => {
                rafCriacao = 0;
                if (!criacao) return;
                limparDestaqueCriacao();
                const ini = Math.min(criacao.inicioHora, criacao.fimHora);
                const fim = Math.max(criacao.inicioHora, criacao.fimHora);
                tbody.querySelectorAll(`.week-cell[data-dia="${criacao.dia}"]`).forEach(cell => {
                    const h = Number(cell.dataset.hora);
                    if (h >= ini && h <= fim) cell.classList.add('drag-select');
                });
            };

            const terminarCriacao = (cancelar) => {
                if (rafCriacao) {
                    cancelAnimationFrame(rafCriacao);
                    rafCriacao = 0;
                }
                document.body.classList.remove('week-creating');
                if (!criacao) return;
                const { dia, inicioHora, fimHora, moveu } = criacao;
                criacao = null;
                limparDestaqueCriacao();
                if (cancelar || !moveu) return;
                const ini = Math.min(inicioHora, fimHora);
                const fim = Math.max(inicioHora, fimHora);
                const duracao = Math.round((fim - ini + passoHoras) * 100) / 100;
                criacaoArrastada = true;
                abrirFormulario(null, dia, ini);
                const duracaoSelect = document.getElementById('week-duracao');
                garantirOpcao(duracaoSelect, String(duracao), fmtDuracao(duracao));
                if (duracaoSelect) duracaoSelect.value = String(duracao);
            };

            tbody.addEventListener('pointerdown', (e) => {
                if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
                if (e.button !== undefined && e.button !== 0) return;
                if (modoColocacao()) return;
                if (e.target.closest('.week-block')) return;
                const cell = e.target.closest('.week-cell');
                if (!cell) return;
                criacao = {
                    dia: Number(cell.dataset.dia),
                    inicioHora: Number(cell.dataset.hora),
                    fimHora: Number(cell.dataset.hora),
                    moveu: false,
                };
                try {
                    tbody.setPointerCapture(e.pointerId);
                } catch { /* sem captura: o pointerup pode perder-se fora da tabela */ }
            });

            tbody.addEventListener('pointermove', (e) => {
                if (!criacao) return;
                let cell = null;
                try {
                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    cell = el ? el.closest('.week-cell') : null;
                } catch { cell = null; }
                if (!cell || Number(cell.dataset.dia) !== criacao.dia) return;
                const h = Number(cell.dataset.hora);
                if (h !== criacao.fimHora) {
                    criacao.fimHora = h;
                    criacao.moveu = true;
                    document.body.classList.add('week-creating');
                    if (!rafCriacao) rafCriacao = requestAnimationFrame(pintarCriacao);
                }
            });

            tbody.addEventListener('pointerup', () => terminarCriacao(false));
            tbody.addEventListener('pointercancel', () => terminarCriacao(true));

            tbody.addEventListener('click', (e) => {
                if (criacaoArrastada) {
                    criacaoArrastada = false;
                    return;
                }
                if (modoColocacao()) {
                    const block = e.target.closest('.week-block');
                    if (block) {
                        sairModoColocacao();
                    } else {
                        const cell = e.target.closest('.week-cell');
                        if (cell) {
                            colocarCopia(Number(cell.dataset.dia), Number(cell.dataset.hora));
                            return;
                        }
                        sairModoColocacao();
                        return;
                    }
                }
                const cell = e.target.closest('.week-cell');
                const block = e.target.closest('.week-block');
                if (block) {
                    const id = block.dataset.id;
                    const layer = block.dataset.layer;
                    const lista = layer === 'dinamico' ? dinamicos : fixos;
                    const evento = lista.find(e => e.id === id);
                    if (evento) abrirFormulario(evento);
                    return;
                }
                if (cell) {
                    const dia = Number(cell.dataset.dia);
                    const hora = Number(cell.dataset.hora);
                    abrirFormulario(null, dia, hora);
                }
            });

            tbody.addEventListener('dragstart', (e) => {
                const block = e.target.closest('.week-block-dinamico');
                if (!block) return;
                arrastando = block.dataset.id;
                block.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', arrastando);
            });

            tbody.addEventListener('dragend', (e) => {
                const block = e.target.closest('.week-block-dinamico');
                if (block) block.classList.remove('dragging');
                arrastando = null;
            });

            tbody.addEventListener('dragover', (e) => {
                const cell = e.target.closest('.week-cell');
                if (!cell || !arrastando) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                cell.classList.add('drag-over');
            });

            tbody.addEventListener('dragleave', (e) => {
                const cell = e.target.closest('.week-cell');
                if (cell) cell.classList.remove('drag-over');
            });

            tbody.addEventListener('drop', (e) => {
                const cell = e.target.closest('.week-cell');
                if (!cell || !arrastando) return;
                e.preventDefault();
                cell.classList.remove('drag-over');

                const id = e.dataTransfer.getData('text/plain') || arrastando;
                const idx = dinamicos.findIndex(e => e.id === id);
                if (idx === -1) return;

                const novoDia = Number(cell.dataset.dia);
                const novaHora = Number(cell.dataset.hora);

                dinamicos[idx] = { ...dinamicos[idx], dia: novoDia, hora: novaHora };
                salvar();
                render();
                toast('Compromisso movido.', 'success');
            });

            tbody.addEventListener('keydown', (e) => {
                const cell = e.target.closest('.week-cell');
                const block = e.target.closest('.week-block');
                const target = block || cell;
                if (!target) return;

                const dia = Number(target.dataset.dia);
                const hora = Number(target.dataset.hora);

                let novoDia = dia;
                let novaHora = hora;

                switch (e.key) {
                    case 'ArrowRight':
                        e.preventDefault();
                        novoDia = Math.min(7, dia + 1);
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        novoDia = Math.max(1, dia - 1);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        novaHora = Math.min(HORA_FIM - passoHoras, Math.round((hora + passoHoras) * 100) / 100);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        novaHora = Math.max(HORA_INICIO, Math.round((hora - passoHoras) * 100) / 100);
                        break;
                    case 'Enter':
                    case ' ':
                        if (block) {
                            e.preventDefault();
                            const id = block.dataset.id;
                            const layer = block.dataset.layer;
                            const lista = layer === 'dinamico' ? dinamicos : fixos;
                            const evento = lista.find(ev => ev.id === id);
                            if (evento) abrirFormulario(evento);
                        } else if (cell) {
                            e.preventDefault();
                            abrirFormulario(null, dia, hora);
                        }
                        break;
                    case 'Delete':
                    case 'Backspace':
                        if (block) {
                            e.preventDefault();
                            const id = block.dataset.id;
                            const layer = block.dataset.layer;
                            const lista = layer === 'dinamico' ? dinamicos : fixos;
                            const idx = lista.findIndex(ev => ev.id === id);
                            if (idx !== -1 && confirm('Apagar este compromisso?')) {
                                lista.splice(idx, 1);
                                salvar();
                                render();
                                toast('Compromisso apagado.', 'success');
                            }
                        }
                        break;
                    case 'Escape':
                        if (modoColocacao()) {
                            e.preventDefault();
                            sairModoColocacao();
                            toast('Duplicação cancelada.', 'info');
                        }
                        break;
                }

                if (novoDia !== dia || novaHora !== hora) {
                    const nextCell = tbody.querySelector(`[data-dia="${novoDia}"][data-hora="${novaHora}"]`);
                    if (nextCell) nextCell.focus({ preventScroll: true });
                }
            });

            // As células já nascem focáveis (tabindex no template do render),
            // por isso a navegação por setas sobrevive a cada render().
        }

        if (dlg && !dlg.dataset.weekBound) {
            dlg.dataset.weekBound = 'true';

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
                    const btn = e.target.closest('[data-week-layer]');
                    dlg.querySelectorAll('[data-week-layer]').forEach(b => {
                        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                    });
                }
            });

            dlg.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    fecharFormulario();
                }
            });

            dlg.addEventListener('close', () => {
                editandoId = null;
            });
        }

        const addBtn = document.getElementById('week-add');
        if (addBtn && !addBtn.dataset.weekBound) {
            addBtn.dataset.weekBound = 'true';
            addBtn.addEventListener('click', () => abrirFormulario());
        }

        document.querySelectorAll('[data-week-passo]').forEach(btn => {
            if (btn.dataset.weekBound) return;
            btn.dataset.weekBound = 'true';
            btn.addEventListener('click', () => {
                const v = Number(btn.dataset.weekPasso);
                if (!PASSOS_VALIDOS.includes(v) || v === passoHoras) return;
                passoHoras = v;
                guardarPasso();
                construirSlots();
                render();
            });
        });

        document.querySelectorAll('[data-week-dia]').forEach(btn => {
            if (btn.dataset.weekBound) return;
            btn.dataset.weekBound = 'true';
            btn.addEventListener('click', () => verDia(btn.dataset.weekDia));
        });

        if (!relogioTimer) {
            relogioTimer = setInterval(() => {
                const vista = document.getElementById('view-semanal');
                if (!document.hidden && vista && !vista.hidden) desenharLinhaAtual();
            }, 30000);
        }
    }

    function ligar() {
        carregar();
        if (semanaAtual === semanaKey(new Date())) diaVisivel = diaDaSemanaHoje();
        render();
        ligarOuvintes();
        rolarParaLinha();
    }

    return { 
        carregar, 
        ligar, 
        render, 
        verDia,
        fixos: () => fixos, 
        dinamicos: () => dinamicos, 
        semanaAtual: () => semanaAtual,
        semanaAnterior,
        semanaSeguinte,
        irParaSemanaAtual
    };
})();