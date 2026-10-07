window.Weekly = (() => {
    const CHAVE_FIXO = 'study-journal-semanal-fixo';
    const CHAVE_DINAMICO_PREFIXO = 'study-journal-semanal-dinamico-';
    const CHAVE_DINAMICO_ATUAL = 'study-journal-semanal-dinamico-atual';

    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const DIAS_COMPLETOS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
    const HORA_INICIO = 6;
    const HORA_FIM = 24;
    const PASSO_HORAS = 0.5; // slots de 30 em 30 minutos
    const PX_POR_HORA = 48; // altura em px de 1h de bloco
    const SLOTS = [];
    for (let h = HORA_INICIO; h < HORA_FIM; h = Math.round((h + PASSO_HORAS) * 2) / 2) {
        SLOTS.push(h);
    }

    function fmtHora(h) {
        const hh = Math.floor(h);
        const mm = (h % 1) ? '30' : '00';
        return `${String(hh).padStart(2, '0')}:${mm}`;
    }

    function fmtDuracao(d) {
        if (d < 1) return '30 min';
        const h = Math.floor(d);
        return (d % 1) ? `${h}h30` : `${h}h`;
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
        mudarSemana(new Date());
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

        let temEventos = false;
        let html = '';

        for (const hora of SLOTS) {
            const horaLabel = fmtHora(hora);
            html += `<tr><th class="sticky left-0 w-16 px-2 py-1 text-right text-[10px] font-medium text-faint bg-surface border-r border-line">${horaLabel}</th>`;

            for (let dia = 1; dia <= 7; dia++) {
                const fixosQueComecam = fixos.filter(e => e.dia === dia && e.hora === hora);
                const dinamicosQueComecam = dinamicos.filter(e => e.dia === dia && e.hora === hora);
                
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
                          data-dia="${dia}" data-hora="${hora}" ${isToday ? 'data-hoje="true"' : ''} ${isWeekend ? 'data-fim-semana="true"' : ''}>
                    ${cellHtml}
                </td>`;
            }
            html += '</tr>';
        }

        tbody.innerHTML = html;

        if (empty) empty.hidden = temEventos;
    }

    function abrirFormulario(evento = null, dia = null, hora = null) {
        const dlg = document.getElementById('week-form');
        const form = dlg.querySelector('form');
        form.reset();

        const title = dlg.querySelector('#week-form-title');
        const apagarBtn = dlg.querySelector('#week-apagar');
        const layerFixo = dlg.querySelector('[data-week-layer="fixo"]');
        const layerDinamico = dlg.querySelector('[data-week-layer="dinamico"]');
        const horaSelect = dlg.querySelector('#week-hora');
        const diaSelect = dlg.querySelector('#week-dia');

        horaSelect.innerHTML = SLOTS.map(h => `<option value="${h}">${fmtHora(h)}</option>`).join('');
        diaSelect.innerHTML = DIAS.map((d, i) => `<option value="${i + 1}">${DIAS_COMPLETOS[i]}</option>`).join('');

        if (evento) {
            editandoId = evento.id;
            title.textContent = TEXTOS.editarTitulo;
            apagarBtn.hidden = false;

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
                const offsetY = e.clientY - rect.top;
                if (offsetY < rect.height - 15) return;

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
                };

                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeEnd);
            };

            const onResizeMove = (e) => {
                if (!resizeData) return;
                const deltaY = e.clientY - resizeData.startY;
                const deltaDuracao = Math.round((deltaY / PX_POR_HORA) * 2) / 2;
                const novaDuracao = Math.max(0.5, resizeData.startDuracao + deltaDuracao);

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

            const onResizeEnd = () => {
                if (resizeData) {
                    salvar();
                    render();
                    resizeData = null;
                }
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeEnd);
            };

            tbody.addEventListener('mousedown', startResize);

            tbody.addEventListener('click', (e) => {
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
                        novaHora = Math.min(HORA_FIM - PASSO_HORAS, Math.round((hora + PASSO_HORAS) * 2) / 2);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        novaHora = Math.max(HORA_INICIO, Math.round((hora - PASSO_HORAS) * 2) / 2);
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
    }

    function ligar() {
        carregar();
        render();
        ligarOuvintes();
    }

    return { 
        carregar, 
        ligar, 
        render, 
        fixos: () => fixos, 
        dinamicos: () => dinamicos, 
        semanaAtual: () => semanaAtual,
        semanaAnterior,
        semanaSeguinte,
        irParaSemanaAtual
    };
})();