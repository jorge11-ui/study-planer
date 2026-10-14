/* Assistente de estudo (LLM local via proxy do servidor).
   O chat corre no Ollama do portátil — nada vai para a cloud. Sem Ollama
   (ex.: link oficial sem túnel), a vista explica em vez de falhar. */

window.Assistente = (() => {
    const CHAVE_HIST = 'study-journal-assistente-hist';
    const MAX_HIST = 100;
    const SISTEMA = 'És um assistente de estudo para um aluno do secundário em Portugal (Matemática A, FQA, Português, Biologia). Responde em português europeu, de forma clara e direta, com exemplos curtos quando ajudar. Usa Markdown simples quando fizer sentido. Para matemática, escreve SEMPRE as fórmulas em LaTeX: \\(…\\) para inline e \\[…\\] para destaque. Nunca uses $ simples nem texto ASCII tipo x^2/3 para frações quando puderes usar LaTeX.';

    let modelo = '';
    let modelos = [];
    let disponivel = false;
    let aGerar = false;
    let abortarAtual = null;

    function lerHist() {
        try {
            const v = JSON.parse(localStorage.getItem(CHAVE_HIST) || '[]');
            return Array.isArray(v) ? v.filter((m) => m && (m.papel === 'user' || m.papel === 'assistant') && typeof m.texto === 'string') : [];
        } catch {
            return [];
        }
    }

    function guardarHist(lista) {
        try {
            localStorage.setItem(CHAVE_HIST, JSON.stringify(lista.slice(-MAX_HIST)));
        } catch { /* segue */ }
    }

    function escolherModelo(lista) {
        const qwen = lista.find((m) => /qwen/i.test(m) && !/vl|vision|coder/i.test(m));
        if (qwen) return qwen;
        const llama = lista.find((m) => /llama/i.test(m));
        if (llama) return llama;
        const texto = lista.find((m) => !/embed|vision/i.test(m));
        return texto || lista[0] || '';
    }

    async function verificar() {
        const estadoEl = document.getElementById('assistente-estado');
        const modeloEl = document.getElementById('assistente-modelo');
        try {
            const resp = await fetch('/api/llm/estado', { cache: 'no-store' });
            const r = await resp.json().catch(() => null);
            modelos = r && r.ok && Array.isArray(r.modelos) ? r.modelos : [];
            disponivel = !!(r && r.ok && r.ollama && modelos.length);
        } catch {
            disponivel = false;
            modelos = [];
        }
        if (disponivel) {
            modelo = escolherModelo(modelos);
            if (estadoEl) estadoEl.textContent = 'Pronto — a correr no teu portátil (Ollama), nada sai para a cloud.';
            if (modeloEl) modeloEl.textContent = modelo;
        } else {
            modelo = '';
            if (estadoEl) {
                estadoEl.textContent = 'LLM local indisponível. Liga o Ollama no portátil e usa o servidor local ' +
                    '(no link oficial sem túnel, o assistente não chega ao portátil).';
            }
            if (modeloEl) modeloEl.textContent = '';
        }
        const input = document.getElementById('assistente-input');
        if (input) input.disabled = !disponivel;
        return disponivel;
    }

    function bolha(papel, texto) {
        const div = document.createElement('div');
        div.className = papel === 'user'
            ? 'ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white'
            : 'mr-auto max-w-[95%] rounded-xl rounded-bl-sm border border-line-soft bg-surface px-3 py-2 text-sm text-fg';
        const corpo = document.createElement('div');
        corpo.className = 'whitespace-pre-wrap leading-relaxed';
        if (papel === 'assistant') {
            partirMatematica(texto).forEach((p) => corpo.append(noMatematico(p)));
        } else {
            corpo.textContent = texto;
        }
        div.append(corpo);
        if (papel === 'assistant' && texto.trim()) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-soft mt-2 px-2 py-1 text-[11px]';
            btn.textContent = 'Colar nas notas';
            btn.addEventListener('click', () => {
                const data = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
                const md = `**Assistente (${data}):** ${texto.replace(/\s+/g, ' ')}`;
                const ok = window.StudyJournal && typeof window.StudyJournal.adicionarANotas === 'function'
                    ? window.StudyJournal.adicionarANotas(md)
                    : false;
                toast(ok ? 'Colado nas Notas do Dia.' : 'Não foi possível colar.', ok ? 'success' : 'error');
            });
            div.append(btn);
        }
        return div;
    }

    function desenhar() {
        const caixa = document.getElementById('assistente-msgs');
        if (!caixa) return;
        caixa.replaceChildren();
        const hist = lerHist();
        if (!hist.length) {
            const vazio = document.createElement('p');
            vazio.className = 'py-6 text-center text-sm text-faint';
            vazio.textContent = 'Pergunta sobre a matéria — ex.: “Explica derivadas com um exemplo”.';
            caixa.append(vazio);
            return;
        }
        hist.forEach((m) => caixa.append(bolha(m.papel, m.texto)));
        caixa.scrollTop = caixa.scrollHeight;
    }

    async function enviar(texto) {
        const pergunta = String(texto || '').trim();
        if (!pergunta || aGerar) return;
        if (!disponivel || !modelo) {
            toast('LLM local indisponível. Liga o Ollama no portátil.', 'error');
            return;
        }
        const hist = lerHist();
        hist.push({ papel: 'user', texto: pergunta });
        guardarHist(hist);
        desenhar();

        const caixa = document.getElementById('assistente-msgs');
        const espera = bolha('assistant', 'A pensar…');
        if (caixa) {
            caixa.append(espera);
            caixa.scrollTop = caixa.scrollHeight;
        }

        aGerar = true;
        const ctrl = new AbortController();
        abortarAtual = () => ctrl.abort();
        const corpo = espera.querySelector('div');
        let resposta = '';
        try {
            const resp = await fetch('/api/llm/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelo,
                    sistema: SISTEMA,
                    mensagens: hist.slice(-20).map((m) => ({ papel: m.papel, texto: m.texto })),
                }),
                signal: ctrl.signal,
            });
            if (!resp.ok) {
                const r = await resp.json().catch(() => null);
                if (r && r.reason === 'sem-modelo') {
                    throw new Error(`O modelo ${r.modelo || modelo} saiu do Ollama. Escolhe outro ou faz pull.`);
                }
                if (resp.status === 401 || resp.status === 403) {
                    throw new Error('Sem sessão: entra na conta para usar o assistente.');
                }
                throw new Error('O servidor não conseguiu falar com o Ollama.');
            }
            const leitor = resp.body.getReader();
            const dec = new TextDecoder();
            let resto = '';
            for (;;) {
                const { done, value } = await leitor.read();
                if (done) break;
                resto += dec.decode(value, { stream: true });
                const linhas = resto.split('\n');
                resto = linhas.pop();
                for (const linha of linhas) {
                    if (!linha.trim()) continue;
                    try {
                        const d = JSON.parse(linha);
                        resposta += (d.message && d.message.content) || '';
                    } catch { /* linha parcial: ignora */ }
                }
                if (corpo) corpo.textContent = resposta || 'A pensar…';
                if (caixa) caixa.scrollTop = caixa.scrollHeight;
            }
            if (!resposta.trim()) throw new Error('O modelo não respondeu.');
            hist.push({ papel: 'assistant', texto: resposta.trim() });
            guardarHist(hist);
            desenhar();
        } catch (error) {
            if (error && error.name === 'AbortError') {
                if (resposta.trim()) {
                    hist.push({ papel: 'assistant', texto: `${resposta.trim()}\n\n(interrompido)` });
                    guardarHist(hist);
                }
            } else {
                toast((error && error.message) || 'Falhou o assistente.', 'error');
            }
            desenhar();
        } finally {
            aGerar = false;
            abortarAtual = null;
        }
    }

    function ligar() {
        desenhar();
        verificar().catch(() => {});

        const form = document.getElementById('assistente-form');
        const input = document.getElementById('assistente-input');
        if (form && !form.dataset.assistenteBound) {
            form.dataset.assistenteBound = '1';
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!input || !input.value.trim()) return;
                const v = input.value;
                input.value = '';
                enviar(v);
            });
        }

        const limpar = document.getElementById('assistente-limpar');
        if (limpar && !limpar.dataset.assistenteBound) {
            limpar.dataset.assistenteBound = '1';
            limpar.addEventListener('click', async () => {
                if (aGerar && abortarAtual) abortarAtual();
                try {
                    localStorage.removeItem(CHAVE_HIST);
                } catch { /* segue */ }
                desenhar();
            });
        }
    }

    /* ── LaTeX (KaTeX local) ────────────────────────────
       O modelo escreve \(…\) inline e \[…\] em destaque. Parte-se o texto
       e renderiza-se com o KaTeX vendorizado; sem ele, mostra-se o fonte. */

    function partirMatematica(texto) {
        const partes = [];
        const re = /\\\((.+?)\\\)|\\\[(.+?)\\\]/gs;
        let ultimo = 0;
        let m;
        while ((m = re.exec(texto)) !== null) {
            if (m.index > ultimo) partes.push({ tipo: 'texto', valor: texto.slice(ultimo, m.index) });
            if (m[1] !== undefined) partes.push({ tipo: 'inline', valor: m[1] });
            else partes.push({ tipo: 'bloco', valor: m[2] });
            ultimo = m.index + m[0].length;
        }
        if (ultimo < texto.length) partes.push({ tipo: 'texto', valor: texto.slice(ultimo) });
        return partes;
    }

    function noMatematico(parte, doc) {
        const d = doc || document;
        if (parte.tipo === 'texto') return d.createTextNode(parte.valor);
        try {
            if (typeof katex === 'undefined') throw new Error('sem-katex');
            const inv = d.createElement(parte.tipo === 'bloco' ? 'div' : 'span');
            inv.innerHTML = katex.renderToString(parte.valor, { throwOnError: false, displayMode: parte.tipo === 'bloco' });
            return inv;
        } catch {
            return d.createTextNode(parte.tipo === 'bloco' ? `\\[${parte.valor}\\]` : `\\(${parte.valor}\\)`);
        }
    }

    /* Aplica em HTML já existente (ex.: preview das notas): só mexe nos
       nós de texto com delimitadores. */
    function renderMatematica(el) {
        if (!el || typeof katex === 'undefined') return;
        const andar = (no) => {
            if (no.nodeType === 3) {
                if (!no.nodeValue.includes('\\(') && !no.nodeValue.includes('\\[')) return;
                const frag = document.createDocumentFragment();
                partirMatematica(no.nodeValue).forEach((p) => frag.append(noMatematico(p, document)));
                no.replaceWith(frag);
                return;
            }
            if (no.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(no.tagName)) return;
            [...no.childNodes].forEach(andar);
        };
        try {
            andar(el);
        } catch { /* segue sem math */ }
    }

    return { ligar, enviar, verificar, renderMatematica, partirMatematica };
})();
