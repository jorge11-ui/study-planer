window.Weekly = (() => {
    const CHAVE_FIXO = 'study-journal-semanal-fixo';
    const CHAVE_DINAMICO_PREFIXO = 'study-journal-semanal-dinamico-';
    const CHAVE_DINAMICO_ATUAL = 'study-journal-semanal-dinamico-atual';

    const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const DIAS_COMPLETOS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
    const HORA_INICIO = 6;
    const HORA_FIM = 24;
    const HORAS = Array.from({ length: HORA_FIM - HORA_INICIO }, (_, i) => HORA_INICIO + i);

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
        const monday = new Date(d.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return monday.toISOString().slice(0, 10);
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
        semanaAtual = semanaKey();
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

    function horaParaMinutos(hora) {
        return hora * 60;
    }

    function minutosParaHora(min) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function slotKey(dia, hora) {
        return `${dia}-${hora}`;
    }

    function getEventosNoSlot(dia, hora) {
        const fixosSlot = fixos.filter(e => e.dia === dia && e.hora <= hora && hora < e.hora + e.duracao);
        const dinamicosSlot = dinamicos.filter(e => e.dia === dia && e.hora <= hora && hora < e.hora + e.duracao);
        return { fixos: fixosSlot, dinamicos: dinamicosSlot };
    }

    function render() {
        const tbody = document.getElementById('week-body');
        const label = document.getElementById('week-label');
        const empty = document.getElementById('week-empty');

        if (label) {
            const inicio = new Date(semanaAtual);
            const fim = new Date(inicio);
            fim.setDate(fim.getDate() + 4);
            const fmt = d => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
            label.textContent = `${fmt(inicio)} – ${fmt(fim)}`;
        }

        if (!tbody) return;

        let temEventos = false;
        let html = '';

        for (const hora of HORAS) {
            const horaLabel = `${String(hora).padStart(2, '0')}:00`;
            html += `<tr><th class="sticky left-0 w-16 px-2 py-1 text-right text-[10px] font-medium text-faint bg-surface border-r border-line">${horaLabel}</th>`;

            for (let dia = 1; dia <= 5; dia++) {
                const eventos = getEventosNoSlot(dia, hora);
                const temFixo = eventos.fixos.length > 0;
                const temDinamico = eventos.dinamicos.length > 0;
                const isTop = eventos.fixos[0]?.hora === hora || (!temFixo && eventos.dinamicos[0]?.hora === hora);

                let cellHtml = '';
                if (temFixo || temDinamico) {
                    const fixosHtml = eventos.fixos.map(e => `
                        <div class="week-block week-block-fixo" style="background: var(--${e.cor}); grid-row: span ${e.duracao};" 
                             data-id="${e.id}" data-layer="fixo" data-dia="${dia}" data-hora="${e.hora}" title="${e.titulo}${e.notas ? ': ' + e.notas : ''}">
                            <span class="week-block-title">${e.titulo}</span>
                            ${e.duracao > 1 ? `<span class="week-block-duracao">${e.duracao}h</span>` : ''}
                        </div>
                    `).join('');

                    const dinamicosHtml = eventos.dinamicos.map(e => `
                        <div class="week-block week-block-dinamico" style="border-color: var(--${e.cor}); grid-row: span ${e.duracao};" 
                             data-id="${e.id}" data-layer="dinamico" data-dia="${dia}" data-hora="${e.hora}" draggable="true" title="${e.titulo}${e.notas ? ': ' + e.notas : ''}">
                            <span class="week-block-title">${e.titulo}</span>
                            ${e.duracao > 1 ? `<span class="week-block-duracao">${e.duracao}h</span>` : ''}
                        </div>
                    `).join('');

                    cellHtml = `<div class="week-cell-content">${fixosHtml}${dinamicosHtml}</div>`;
                    temEventos = true;
                }

                const today = new Date();
                const semanaInicio = new Date(semanaAtual);
                const cellDate = new Date(semanaInicio);
                cellDate.setDate(cellDate.getDate() + dia - 1);
                const isToday = cellDate.toDateString() === today.toDateString();

                html += `<td class="week-cell relative min-h-12 p-0.5 border-r border-line ${isToday ? 'bg-brand/5' : ''}" 
                          data-dia="${dia}" data-hora="${hora}" ${isToday ? 'data-hoje="true"' : ''}>
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

        horaSelect.innerHTML = HORAS.map(h => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');

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
        editandoId = null;
        toast(`Compromisso ${editandoId ? 'atualizado' : 'adicionado'}.`, 'success');
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

        if (tbody && !tbody.dataset.weekBound) {
            tbody.dataset.weekBound = 'true';

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

    return { carregar, ligar, render, fixos: () => fixos, dinamicos: () => dinamicos, semanaAtual: () => semanaAtual };
})();