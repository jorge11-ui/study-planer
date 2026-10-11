/* StudyJournal — Notas Pro: pesquisa global, tags, preview e templates.
   Sem dependências: lê localStorage + window.Exames quando disponível. */

window.NotasPro = (() => {
    const LIMITE = 20;

    const TEMPLATES = {
        resumo: '# Resumo — {data}\n\n## Ideias-chave\n- \n- \n\n## Dúvidas\n- [ ] \n\n#revisar',
        aula: '# Aula — {data}\n\n## Sumário\n\n## O que percebi\n- \n\n## O que falhou\n- [ ] \n\n#revisar',
        exercicios: '# Exercícios — {data}\n\n## Feitos\n- [ ] Ex.  — p. \n\n## Erros a rever\n- [ ] \n\n#revisar',
    };

    function normalizar(t) {
        return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function extrairTags(texto) {
        const tags = new Set();
        const re = /(^|\s)#([\p{L}\p{N}_-]{2,30})/gu;
        let m = null;
        while ((m = re.exec(String(texto || ''))) !== null) {
            tags.add(m[2].toLowerCase());
            if (tags.size >= 20) break;
        }
        return [...tags];
    }

    function lerNota(dayKey) {
        try {
            const raw = localStorage.getItem(`study-journal-notes-${dayKey}`);
            if (raw === null) return '';
            const parsed = JSON.parse(raw);
            return typeof parsed === 'string' ? parsed : String(parsed);
        } catch {
            return '';
        }
    }

    function lerTarefas(dayKey) {
        try {
            const raw = localStorage.getItem(`study-journal-tasks-${dayKey}`);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function listarDias() {
        const dias = new Set();
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i) || '';
                const nota = /^study-journal-notes-(\d{4}-\d{2}-\d{2})$/.exec(key);
                if (nota) { dias.add(nota[1]); continue; }
                const tarefa = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(key);
                if (tarefa) dias.add(tarefa[1]);
            }
        } catch { /* storage indisponível */ }
        return [...dias].sort().reverse();
    }

    function todasTags() {
        const freq = new Map();
        listarDias().slice(0, 400).forEach((dia) => {
            extrairTags(lerNota(dia)).forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
            lerTarefas(dia).forEach((tarefa) => {
                extrairTags(tarefa.text || '').forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
            });
        });
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag]) => tag);
    }

    function trecho(texto, pos, raio = 70) {
        // Imagens coladas (dataURLs ou tokens) não cabem num excerto
        const semImagens = String(texto || '').replace(/!\[[^\]]*\]\((?:data:image\/[^)]*|sjimg:[A-Za-z0-9_-]+)\)/g, '[imagem]');
        const limpo = semImagens.replace(/\s+/g, ' ').trim();
        if (limpo.length <= raio * 2) return limpo;
        const inicio = Math.max(0, pos - raio);
        const fim = Math.min(limpo.length, pos + raio);
        return `${inicio > 0 ? '…' : ''}${limpo.slice(inicio, fim).trim()}${fim < limpo.length ? '…' : ''}`;
    }

    function pesquisar(termo, { tag = '', limite = LIMITE } = {}) {
        const q = normalizar(termo).trim();
        const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
        const tagN = normalizar(tag).replace(/^#/, '');
        const resultados = [];

        const duvidas = (() => {
            try {
                if (window.Exames && typeof window.Exames.lerTudo === 'function') {
                    return window.Exames.lerTudo().duvidas || [];
                }
            } catch { /* sem exames */ }
            return [];
        })();

        listarDias().slice(0, 400).forEach((dia) => {
            const nota = lerNota(dia);
            const tarefas = lerTarefas(dia);
            const notaN = normalizar(nota);
            const tagsNota = extrairTags(nota).map(normalizar);

            if (tagN && !tagsNota.includes(tagN) && !tarefas.some((t) => extrairTags(t.text || '').map(normalizar).includes(tagN))) return;

            if (!tokens.length) {
                if (nota.trim() || tarefas.length) {
                    resultados.push({
                        dia, tipo: nota.trim() ? 'nota' : 'tarefa',
                        titulo: `Dia ${dia}`,
                        excerto: trecho(nota || (tarefas[0] ? tarefas[0].text : ''), 0),
                    });
                }
                return;
            }

            const posNota = tokens.map((t) => notaN.indexOf(t));
            if (posNota.every((p) => p >= 0)) {
                const primeiraLinha = (nota.split('\n').find((l) => l.trim()) || `Dia ${dia}`).slice(0, 80);
                resultados.push({
                    dia, tipo: 'nota', titulo: primeiraLinha,
                    excerto: trecho(nota, Math.max(0, posNota[0])),
                });
            }

            tarefas.forEach((tarefa) => {
                const textoN = normalizar(tarefa.text || '');
                if (tokens.every((t) => textoN.includes(t))) {
                    resultados.push({
                        dia, tipo: 'tarefa',
                        titulo: String(tarefa.text || '').slice(0, 80),
                        excerto: `Tarefa · ${tarefa.subject || 'Geral'}${tarefa.done ? ' · concluída' : ''}`,
                    });
                }
            });
        });

        duvidas.forEach((d) => {
            const alvo = normalizar(`${d.titulo || ''} ${d.texto || ''} ${d.disciplina || ''}`);
            if (tagN && !normalizar(`${d.titulo || ''} ${d.texto || ''}`).includes(tagN)) return;
            if (tokens.length && tokens.every((t) => alvo.includes(t))) {
                resultados.push({
                    dia: '', tipo: d.tipo === 'erro' ? 'erro' : 'conceito',
                    titulo: String(d.titulo || '').slice(0, 80),
                    excerto: trecho(`${d.disciplina || ''} — ${d.texto || ''}`, 0),
                    duvidaId: d.id,
                });
            }
        });

        return resultados.slice(0, limite);
    }

    function renderMarkdownLite(md) {
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
        const linhas = esc(md).split('\n');
        const html = [];
        let lista = [];

        const inline = (s) => s
            .replace(/!\[([^\]]*)\]\(sjimg:([A-Za-z0-9_-]+)\)/g, '<img data-sjimg="$2" alt="$1" class="md-img" loading="lazy">')
            .replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g, '<img src="$2" alt="$1" class="md-img" loading="lazy">')
            .replace(/`([^`]+)`/g, '<code class="rounded bg-surface-3 px-1 font-mono text-[12px]">$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|\W)_([^_]+)_/g, '$1<em>$2</em>')
            .replace(/\[x\]/gi, '☑')
            .replace(/\[ \]/g, '☐');

        const fecharLista = () => {
            if (lista.length) {
                html.push(`<ul class="ml-4 list-disc space-y-1">${lista.map((l) => `<li>${l}</li>`).join('')}</ul>`);
                lista = [];
            }
        };

        linhas.forEach((linha) => {
            const item = /^\s*[-*]\s+(.*)$/.exec(linha);
            if (item) { lista.push(inline(item[1])); return; }
            fecharLista();
            if (/^\s*#{1,3}\s+/.test(linha)) {
                html.push(`<p class="mt-2 font-semibold text-fg">${inline(linha.replace(/^\s*#{1,3}\s+/, ''))}</p>`);
            } else if (linha.trim()) {
                html.push(`<p>${inline(linha)}</p>`);
            } else {
                html.push('<br>');
            }
        });
        fecharLista();
        return html.join('');
    }

    function aplicarTemplate(nome) {
        const area = document.getElementById('journal-text');
        if (!area || !TEMPLATES[nome]) return false;
        const hoje = new Date().toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
        const texto = TEMPLATES[nome].replaceAll('{data}', hoje);
        const atual = area.value.trim();
        area.value = atual ? `${atual}\n\n${texto}` : texto;
        area.focus();
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    let debounce = null;

    function renderResultados(caixa, resultados) {
        caixa.replaceChildren();
        if (!resultados.length) {
            const p = document.createElement('p');
            p.className = 'px-4 py-8 text-center text-xs text-faint';
            p.textContent = 'Sem resultados. Tenta outra palavra ou #tag.';
            caixa.append(p);
            return;
        }
        resultados.forEach((r) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none';
            const top = document.createElement('span');
            top.className = 'flex items-center gap-2 text-xs';
            const chip = document.createElement('span');
            chip.className = 'chip bg-surface-3 text-muted';
            chip.textContent = r.tipo;
            const titulo = document.createElement('span');
            titulo.className = 'min-w-0 flex-1 truncate font-medium text-fg';
            titulo.textContent = r.titulo || '(sem título)';
            top.append(chip, titulo);
            if (r.dia) {
                const dia = document.createElement('span');
                dia.className = 'shrink-0 tabular-nums text-faint';
                dia.textContent = r.dia;
                top.append(dia);
            }
            const ex = document.createElement('span');
            ex.className = 'line-clamp-2 text-[11px] leading-relaxed text-muted';
            ex.textContent = r.excerto || '';
            btn.append(top, ex);
            btn.addEventListener('click', () => abrirResultado(r));
            caixa.append(btn);
        });
    }

    function abrirResultado(r) {
        fecharPaleta();
        if (r.dia && window.StudyJournal && typeof window.StudyJournal.abrirDia === 'function') {
            window.StudyJournal.abrirDia(r.dia);
            return;
        }
        if (!r.dia && window.Exames) {
            if (typeof window.StudyJournal !== 'undefined' && window.StudyJournal.irAExames) {
                window.StudyJournal.irAExames();
                return;
            }
            document.querySelector('[data-view="exames"]')?.click();
        }
    }

    function atualizarTags(caixa, ativa, aoEscolher) {
        caixa.replaceChildren();
        todasTags().slice(0, 12).forEach((tag) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = tag === ativa
                ? 'rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-medium text-fg'
                : 'rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted transition hover:text-fg';
            b.textContent = `#${tag}`;
            b.setAttribute('aria-pressed', String(tag === ativa));
            b.addEventListener('click', () => aoEscolher(tag === ativa ? '' : tag));
            caixa.append(b);
        });
    }

    function abrirPaleta() {
        const dlg = document.getElementById('search-palette');
        if (!dlg) return;
        if (!dlg.open) dlg.showModal();
        const input = document.getElementById('global-search');
        input?.focus();
        input?.select();
        correrPesquisa();
    }

    function fecharPaleta() {
        document.getElementById('search-palette')?.close();
    }

    function correrPesquisa() {
        const input = document.getElementById('global-search');
        const caixa = document.getElementById('search-results');
        const tags = document.getElementById('search-tags');
        if (!input || !caixa) return;
        const tagAtiva = input.dataset.tag || '';
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            renderResultados(caixa, pesquisar(input.value, { tag: tagAtiva }));
            if (tags) atualizarTags(tags, tagAtiva, (nova) => {
                input.dataset.tag = nova;
                correrPesquisa();
            });
        }, 120);
    }

    function ligar() {
        document.getElementById('global-search-btn')?.addEventListener('click', abrirPaleta);
        document.getElementById('search-palette-close')?.addEventListener('click', fecharPaleta);
        const input = document.getElementById('global-search');
        if (input && !input.dataset.bound) {
            input.dataset.bound = '1';
            input.addEventListener('input', correrPesquisa);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const primeiro = document.querySelector('#search-results button');
                    primeiro?.click();
                }
            });
        }
        document.getElementById('search-palette')?.addEventListener('click', (e) => {
            if (e.target?.id === 'search-palette') fecharPaleta();
        });
        document.querySelectorAll('[data-template]').forEach((btn) => {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => aplicarTemplate(btn.dataset.template));
        });
        const previewBtn = document.getElementById('notes-preview-toggle');
        if (previewBtn && !previewBtn.dataset.bound) {
            previewBtn.dataset.bound = '1';
            previewBtn.addEventListener('click', alternarPreview);
        }
        renderTagsNota();
    }

    function renderTagsNota() {
        const caixa = document.getElementById('notes-tags');
        if (!caixa) return;
        const area = document.getElementById('journal-text');
        const desenhar = () => {
            const tags = extrairTags(area?.value || '');
            caixa.replaceChildren();
            if (!tags.length) {
                caixa.classList.add('hidden');
                return;
            }
            caixa.classList.remove('hidden');
            tags.forEach((t) => {
                const s = document.createElement('button');
                s.type = 'button';
                s.className = 'rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted transition hover:text-fg';
                s.textContent = `#${t}`;
                s.title = 'Pesquisar esta tag';
                s.addEventListener('click', () => {
                    const input = document.getElementById('global-search');
                    if (input) {
                        input.value = '';
                        input.dataset.tag = t;
                    }
                    abrirPaleta();
                });
                caixa.append(s);
            });
        };
        if (caixa.dataset.bound) { desenhar(); return; }
        caixa.dataset.bound = '1';
        document.getElementById('journal-text')?.addEventListener('input', desenhar);
        desenhar();
    }

    function alternarPreview() {
        const area = document.getElementById('journal-text');
        const vista = document.getElementById('notes-preview');
        const btn = document.getElementById('notes-preview-toggle');
        if (!area || !vista) return;
        const ativa = vista.hidden;
        vista.hidden = !ativa;
        area.classList.toggle('hidden', ativa);
        if (btn) btn.setAttribute('aria-pressed', String(ativa));
        if (ativa) {
            vista.innerHTML = renderMarkdownLite(area.value) || '<p class="text-xs text-faint">Nada para pré-visualizar.</p>';
            if (window.Imagens) window.Imagens.hidratar(vista).catch(() => {});
        }
    }

    return {
        ligar, pesquisar, extrairTags, todasTags,
        renderMarkdownLite, aplicarTemplate, abrirPaleta, renderTagsNota,
    };
})();
