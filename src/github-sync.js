window.GitHubSync = (() => {
    const CHAVE_TOKEN = 'study-journal-github-token';
    const CHAVE_GIST = 'study-journal-gist-id';
    const CHAVE_ULTIMO_SYNC = 'study-journal-github-last-sync';
    const CHAVE_PUBLIC_READONLY = 'study-journal-github-public-readonly';
    const API_BASE = 'https://api.github.com/gists';
    const SYNC_INTERVAL_MS = 20000;

    let token = '';
    let gistId = '';
    let publicReadOnly = false;
    let syncTimer = null;
    let aSyncando = false;
    let listeners = [];
    let ultimoPayloadEnviado = null;
    let ultimoSyncStorage = 0;

    function notificar(tipo, detalhes = {}) {
        listeners.forEach(cb => cb(tipo, detalhes));
    }

    function getHeaders(includeAuth = true) {
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        };
        if (includeAuth && token) {
            headers['Authorization'] = `token ${token}`;
        }
        return headers;
    }

    /* fetch com limite de tempo: um pedido pendurado (servidor/rede a
       acordar) prendia o aSyncando e bloqueava os pushes seguintes. */
    async function pedir(url, opcoes = {}, timeoutMs = 20000) {
        const ctrl = new AbortController();
        const limite = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { ...opcoes, signal: ctrl.signal });
        } finally {
            clearTimeout(limite);
        }
    }

    function carregarConfig() {
        token = localStorage.getItem(CHAVE_TOKEN) || '';
        gistId = localStorage.getItem(CHAVE_GIST) || '';
        publicReadOnly = localStorage.getItem(CHAVE_PUBLIC_READONLY) === 'true';
    }

    function salvarConfig(novoToken, novoGistId) {
        if (novoToken !== undefined) {
            token = novoToken;
            localStorage.setItem(CHAVE_TOKEN, novoToken);
        }
        if (novoGistId !== undefined) {
            gistId = String(novoGistId || '').trim();
            localStorage.setItem(CHAVE_GIST, gistId);
        }
        if (hasWriteAccess()) iniciarAutoSync(false);
    }

    function setPublicGist(gistIdValue) {
        gistId = gistIdValue;
        publicReadOnly = true;
        localStorage.setItem(CHAVE_GIST, gistIdValue);
        localStorage.setItem(CHAVE_PUBLIC_READONLY, 'true');
        // Public Gists only support automatic pull.
        token = '';
        localStorage.removeItem(CHAVE_TOKEN);
        iniciarAutoSync();
    }

    function clearPublicReadOnly() {
        publicReadOnly = false;
        localStorage.removeItem(CHAVE_PUBLIC_READONLY);
    }

    function limparConfig() {
        token = '';
        gistId = '';
        publicReadOnly = false;
        localStorage.removeItem(CHAVE_TOKEN);
        localStorage.removeItem(CHAVE_GIST);
        localStorage.removeItem(CHAVE_ULTIMO_SYNC);
        localStorage.removeItem(CHAVE_PUBLIC_READONLY);
        pararAutoSync();
    }

    function configurado() {
        // A token without a Gist is enough: the first sync creates one.
        return !!gistId || (!!token && !publicReadOnly);
    }

    function isPublicReadOnly() {
        return publicReadOnly && !!gistId && !token;
    }

    function hasWriteAccess() {
        return !!token;
    }

    async function criarGistInicial() {
        if (!hasWriteAccess()) throw new Error('GitHub não configurado para escrita');

        const payload = {
            description: 'StudyJournal Sync',
            public: false,
            files: {
                'study-journal-data.json': {
                    content: JSON.stringify({
                        app: 'study-journal',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                        days: {},
                        semanal: { fixos: [], dinamicos: [], semanaAtual: '' },
                    }, null, 2),
                },
            },
        };

        const resp = await pedir(API_BASE, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(`Erro ao criar Gist: ${resp.status} ${err.message || ''}`);
        }

        const data = await resp.json();
        return data.id;
    }

    async function lerGist() {
        if (!configurado()) throw new Error('GitHub não configurado');

        // For public read-only, fetch without auth
        const headers = getHeaders(hasWriteAccess());

        const resp = await pedir(`${API_BASE}/${gistId}`, { headers });

        if (resp.status === 404) {
            if (hasWriteAccess()) {
                const novoId = await criarGistInicial();
                gistId = novoId;
                localStorage.setItem(CHAVE_GIST, novoId);
                return await lerGist();
            }
            throw new Error('Gist não encontrado (404)');
        }

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(`Erro ao ler Gist: ${resp.status} ${err.message || ''}`);
        }

        const data = await resp.json();
        const arquivo = data.files['study-journal-data.json'];
        if (!arquivo) throw new Error('Ficheiro study-journal-data.json não encontrado no Gist');

        const conteudo = JSON.parse(arquivo.content);
        return { data: conteudo, sha: data.files['study-journal-data.json'].sha };
    }

    async function escreverGist(dados, sha) {
        if (!hasWriteAccess()) throw new Error('Sem permissão de escrita (modo leitura)');

        const marcador = new Date().toISOString();
        const payload = {
            description: 'StudyJournal Sync',
            files: {
                'study-journal-data.json': {
                    content: JSON.stringify({
                        ...dados,
                        updatedAt: marcador,
                    }, null, 2),
                },
            },
        };

        if (sha) payload.files['study-journal-data.json'].sha = sha;

        const resp = await pedir(`${API_BASE}/${gistId}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(`Erro ao escrever Gist: ${resp.status} ${err.message || ''}`);
        }

        const data = await resp.json();
        localStorage.setItem(CHAVE_ULTIMO_SYNC, marcador);
        return { sha: data.files['study-journal-data.json'].sha, updatedAt: marcador };
    }

    function coletarDadosLocais() {
        const days = {};
        const notasMeta = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i) || '';
                const notesMatch = /^study-journal-notes-(\d{4}-\d{2}-\d{2})$/.exec(key);
                const tasksMatch = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(key);
                const metaMatch = /^study-journal-note-meta-(\d{4}-\d{2}-\d{2})$/.exec(key);
                if (notesMatch) {
                    const k = notesMatch[1];
                    days[k] = days[k] || {};
                    days[k].notes = localStorage.getItem(key);
                    const ts = Number(localStorage.getItem(`study-journal-notes-${k}-ts`)) || 0;
                    if (ts > 0) days[k].updatedAt = ts;
                } else if (tasksMatch) {
                    const k = tasksMatch[1];
                    days[k] = days[k] || {};
                    days[k].tasks = JSON.parse(localStorage.getItem(key) || '[]');
                    const ts = Number(localStorage.getItem(`study-journal-tasks-${k}-ts`)) || 0;
                    if (ts > 0) days[k].tasksUpdatedAt = ts;
                } else if (metaMatch) {
                    try { notasMeta[metaMatch[1]] = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* segue */ }
                }
            }
        } catch { /* ignora erros de parsing */ }

        const semanal = {
            fixos: JSON.parse(localStorage.getItem('study-journal-semanal-fixo') || '[]'),
            dinamicos: (() => {
                const atual = localStorage.getItem('study-journal-semanal-dinamico-atual');
                if (!atual) return [];
                return JSON.parse(localStorage.getItem(`study-journal-semanal-dinamico-${atual}`) || '[]');
            })(),
            semanaAtual: localStorage.getItem('study-journal-semanal-dinamico-atual') || '',
        };

        const lerJson = (chave, fallback) => {
            try {
                const raw = localStorage.getItem(chave);
                return raw === null ? fallback : JSON.parse(raw);
            } catch { return fallback; }
        };

        const lerTexto = (chave) => {
            try { return localStorage.getItem(chave); } catch { return null; }
        };

        const lerTs = (chave) => {
            try { return Number(localStorage.getItem(chave)) || 0; } catch { return 0; }
        };

        // Todas as semanas dinâmicas, não só a que está aberta: ao mudar de
        // semana noutro aparelho o horário não pode desaparecer.
        const semanalTodas = {};
        const semanalTs = {};
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const chave = localStorage.key(i) || '';
                const m = /^study-journal-semanal-dinamico-(\d{4}-\d{2}-\d{2})$/.exec(chave);
                if (!m) continue;
                const lista = lerJson(chave, null);
                if (!Array.isArray(lista)) continue;
                semanalTodas[m[1]] = lista;
                semanalTs[m[1]] = Number(localStorage.getItem(`${chave}-ts`)) || 0;
            }
        } catch { /* segue com a semana atual apenas */ }

        const semanalPrefs = lerTexto('study-journal-semanal-prefs-ts') === null ? null : {
            passo: lerJson('study-journal-semanal-passo', null),
            vista: lerJson('study-journal-semanal-vista', null),
            fimSemana: lerJson('study-journal-semanal-fim-semana', null),
            inicio: lerJson('study-journal-semanal-inicio', null),
            fim: lerJson('study-journal-semanal-fim', null),
            updatedAt: lerTs('study-journal-semanal-prefs-ts'),
        };

        const sessaoObjetivoRaw = lerTexto('study-journal-session-goal');
        const assistenteRaw = lerTexto('study-journal-assistente-hist');
        const whiteboardRaw = lerTexto('study-journal-whiteboard-draft');
        const whiteboardGridRaw = lerTexto('study-journal-whiteboard-grid');
        const floatingRaw = lerTexto('study-journal-floating-note');

        return {
            days,
            semanal,
            semanalTodas,
            semanalTs,
            semanalPrefs,
            // Notas: metadados do Painel (título, disciplina, categoria,
            // tópico) e o índice das notas recentes. Sem isto o texto
            // viajava mas o Painel do outro aparelho ficava sem títulos.
            notasMeta,
            notasIndex: lerJson('study-journal-notes-index', null),
            exames: {
                foco: lerJson('study-journal-exames-foco', null),
                recursos: lerJson('study-journal-exames-recursos', null),
                track: lerJson('study-journal-exames-track', null),
                duvidas: lerJson('study-journal-exames-duvidas', null),
                dataAlvo: lerJson('study-journal-exames-data-alvo', null),
            },
            // Exames Nacionais (v2): documento inteiro (disciplinas,
            // tópicos, materiais, sessões, dúvidas). Só os campos legados
            // em `exames` viajavam — as sessões nunca chegavam ao outro
            // aparelho. A fusão por id é feita em Exames.fundirRemoto.
            examesV2: lerJson('study-journal-exames-center-v2', null),
            reviewsV2: lerJson('study-journal-reviews-v2', null),
            // Metadados dos PDFs (a lista; os bytes vão por /api/ficheiros).
            // Sem isto, no Render (sem vault) a galeria não viajava.
            pdfs: lerJson('study-journal-pdfs', null),
            // Sessões do timer (heatmap/estatísticas): base (máximo) + slots
            // por aparelho (união). Ver StudySessions em app.js: dois
            // aparelhos a estudar ao mesmo tempo nunca perdem minutos.
            // `sessoes` mantém a base para clientes antigos lerem.
            sessoes: lerJson('study-journal-sessions-base', null),
            sessoesBase: lerJson('study-journal-sessions-base', null),
            sessoesSlots: lerJson('study-journal-sessions-slots', null),
            // Apagados da galeria (tombstones): sem isto a união abaixo
            // ressuscitava PDFs removidos.
            pdfsApagados: lerJson('study-journal-pdfs-apagados', null),
            // Caderno (fotos): metadados + apagados, mesma fusão que PDFs.
            caderno: lerJson('study-journal-caderno', null),
            cadernoApagados: lerJson('study-journal-caderno-apagados', null),
            // Estatísticas/Concentração: histórico de sessões (união) e
            // objetivo atual (última escrita ganha).
            sessoesLog: lerJson('study-journal-session-log', null),
            sessaoObjetivo: sessaoObjetivoRaw === null ? null : {
                valor: sessaoObjetivoRaw,
                updatedAt: lerTs('study-journal-session-goal-ts'),
            },
            // Assistente: histórico da conversa (última escrita ganha).
            assistente: assistenteRaw === null ? null : {
                hist: (() => {
                    const v = lerJson('study-journal-assistente-hist', []);
                    return Array.isArray(v) ? v : [];
                })(),
                updatedAt: lerTs('study-journal-assistente-hist-ts'),
            },
            // Quadro Branco: rascunho e grelha, com carimbos separados.
            whiteboardDraft: whiteboardRaw === null ? null : {
                content: whiteboardRaw,
                updatedAt: lerTs('study-journal-whiteboard-draft-ts'),
            },
            whiteboardGrid: whiteboardGridRaw === null ? null : {
                visible: whiteboardGridRaw !== 'false',
                updatedAt: lerTs('study-journal-whiteboard-grid-ts'),
            },
            // Nota rápida flutuante: conteúdo com updatedAt dentro do objeto.
            floatingNote: floatingRaw === null ? null : {
                data: lerJson('study-journal-floating-note', null),
                updatedAt: (() => {
                    const d = lerJson('study-journal-floating-note', null);
                    return d && typeof d.updatedAt === 'number' ? d.updatedAt : 0;
                })(),
            },
        };
    }

    /* Depois de um push bem-sucedido: o que está local é a base
       sincronizada. Guardá-la permite ao pull seguinte distinguir um
       editor parado (aceita o remoto) de edições locais por enviar. */
    function marcarBasesSincronizadas(dados) {
        try {
            // Prefere o que foi efetivamente enviado: se o utilizador
            // escreveu entretanto, isso ainda não está sincronizado.
            const days = dados && dados.days;
            if (days && typeof days === 'object') {
                Object.entries(days).forEach(([dia, v]) => {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !v || typeof v !== 'object') return;
                    if (typeof v.notes === 'string') {
                        try { localStorage.setItem(`study-journal-notes-${dia}-sync`, v.notes); } catch { /* segue */ }
                    }
                    if (Array.isArray(v.tasks)) {
                        try { localStorage.setItem(`study-journal-tasks-${dia}-sync`, JSON.stringify(v.tasks)); } catch { /* segue */ }
                    }
                });
                return;
            }
            const chaves = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i) || '';
                if (/^study-journal-(notes|tasks)-\d{4}-\d{2}-\d{2}$/.test(key)) chaves.push(key);
            }
            chaves.forEach((key) => {
                const valor = localStorage.getItem(key);
                if (valor !== null) localStorage.setItem(`${key}-sync`, valor);
            });
        } catch { /* segue sem bases */ }
    }

    /* ── Secções com carimbo próprio ──────────────────────
       Chegam no mesmo documento, mas cada uma decide pela sua data para
       não perder edições locais feitas depois do último push. */

    const tsLocal = (chave) => {
        try { return Number(localStorage.getItem(chave)) || 0; } catch { return 0; }
    };

    const guardarTs = (chave, ts) => {
        try { localStorage.setItem(chave, String(Number(ts) || Date.now())); } catch { /* segue */ }
    };

    function aplicarSemanas(remoto) {
        if (!remoto || !remoto.semanalTodas || typeof remoto.semanalTodas !== 'object') return;
        const carimbos = remoto.semanalTs && typeof remoto.semanalTs === 'object' ? remoto.semanalTs : {};
        let mudou = false;
        Object.entries(remoto.semanalTodas).forEach(([semana, lista]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(semana) || !Array.isArray(lista)) return;
            const chave = `study-journal-semanal-dinamico-${semana}`;
            const chaveTs = `${chave}-ts`;
            const rTs = Number(carimbos[semana]) || 0;
            const lTs = tsLocal(chaveTs);
            if (rTs < lTs) return;
            try {
                localStorage.setItem(chave, JSON.stringify(lista));
                guardarTs(chaveTs, rTs);
                mudou = true;
            } catch { /* segue */ }
        });
        if (mudou && window.Weekly && typeof window.Weekly.ligar === 'function') {
            const vista = document.getElementById('view-semanal');
            if (vista && !vista.hidden) window.Weekly.ligar();
        }
    }

    function aplicarSemanalPrefs(remoto) {
        const prefs = remoto && remoto.semanalPrefs;
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;
        const chaveTs = 'study-journal-semanal-prefs-ts';
        if ((Number(prefs.updatedAt) || 0) < tsLocal(chaveTs)) return;
        const valores = {
            'study-journal-semanal-passo': prefs.passo,
            'study-journal-semanal-vista': prefs.vista,
            'study-journal-semanal-fim-semana': prefs.fimSemana,
            'study-journal-semanal-inicio': prefs.inicio,
            'study-journal-semanal-fim': prefs.fim,
        };
        try {
            Object.entries(valores).forEach(([chave, valor]) => {
                if (valor === null || valor === undefined) return;
                localStorage.setItem(chave, String(valor));
            });
            guardarTs(chaveTs, prefs.updatedAt);
        } catch { /* segue */ }
        if (window.Weekly && typeof window.Weekly.ligar === 'function') {
            const vista = document.getElementById('view-semanal');
            if (vista && !vista.hidden) window.Weekly.ligar();
        }
    }

    function chaveLogSessao(registo) {
        if (!registo || typeof registo !== 'object') return '';
        if (registo.id) return `id:${registo.id}`;
        return [registo.created || '', registo.day || '', registo.subject || '',
            registo.minutos || '', registo.goal || ''].join('|');
    }

    function aplicarLogSessoes(remoto) {
        if (!Array.isArray(remoto.sessoesLog)) return;
        const mapa = new Map();
        const juntar = (lista) => {
            if (!Array.isArray(lista)) return;
            lista.forEach((registo) => {
                const chave = chaveLogSessao(registo);
                if (!chave || chave === '||||') return;
                const anterior = mapa.get(chave);
                if (!anterior || (Number(registo.created) || 0) >= (Number(anterior.created) || 0)) {
                    mapa.set(chave, registo);
                }
            });
        };
        try {
            juntar(JSON.parse(localStorage.getItem('study-journal-session-log') || '[]'));
        } catch { /* segue só com o remoto */ }
        juntar(remoto.sessoesLog);
        const lista = [...mapa.values()]
            .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0))
            .slice(-200);
        try { localStorage.setItem('study-journal-session-log', JSON.stringify(lista)); } catch { return; }
        if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('studyjournal:sessao-sync'));
        if (window.SJDash && typeof window.SJDash.render === 'function') {
            try { window.SJDash.render(); } catch { /* segue */ }
        }
    }

    function aplicarObjetivoSessao(remoto) {
        const obj = remoto.sessaoObjetivo;
        if (!obj || typeof obj !== 'object' || typeof obj.valor !== 'string') return;
        const chaveTs = 'study-journal-session-goal-ts';
        if ((Number(obj.updatedAt) || 0) < tsLocal(chaveTs)) return;
        try {
            localStorage.setItem('study-journal-session-goal', obj.valor);
            guardarTs(chaveTs, obj.updatedAt);
        } catch { return; }
        ['session-goal', 'estudar-goal'].forEach((id) => {
            const input = document.getElementById(id);
            if (input && document.activeElement !== input) input.value = obj.valor;
        });
    }

    function aplicarAssistente(remoto) {
        const secao = remoto.assistente;
        if (!secao || typeof secao !== 'object' || !Array.isArray(secao.hist)) return;
        const chaveTs = 'study-journal-assistente-hist-ts';
        if ((Number(secao.updatedAt) || 0) < tsLocal(chaveTs)) return;
        try {
            localStorage.setItem('study-journal-assistente-hist', JSON.stringify(secao.hist.slice(-100)));
            guardarTs(chaveTs, secao.updatedAt);
        } catch { return; }
        if (window.Assistente && typeof window.Assistente.recarregar === 'function') {
            try { window.Assistente.recarregar(); } catch { /* segue */ }
        }
    }

    function aplicarQuadro(remoto) {
        const draft = remoto.whiteboardDraft;
        if (draft && typeof draft === 'object' && typeof draft.content === 'string') {
            const chaveTs = 'study-journal-whiteboard-draft-ts';
            if ((Number(draft.updatedAt) || 0) >= tsLocal(chaveTs)) {
                try {
                    localStorage.setItem('study-journal-whiteboard-draft', draft.content);
                    guardarTs(chaveTs, draft.updatedAt);
                    if (window.dispatchEvent) {
                        window.dispatchEvent(new CustomEvent('studyjournal:whiteboard-sync', {
                            detail: { content: draft.content, updatedAt: Number(draft.updatedAt) || 0 },
                        }));
                    }
                } catch { /* segue */ }
            }
        }
        const grelha = remoto.whiteboardGrid;
        if (grelha && typeof grelha === 'object' && typeof grelha.visible === 'boolean') {
            const chaveTs = 'study-journal-whiteboard-grid-ts';
            if ((Number(grelha.updatedAt) || 0) >= tsLocal(chaveTs)) {
                try {
                    localStorage.setItem('study-journal-whiteboard-grid', String(grelha.visible));
                    guardarTs(chaveTs, grelha.updatedAt);
                    if (window.dispatchEvent) {
                        window.dispatchEvent(new CustomEvent('studyjournal:whiteboard-grid-sync', {
                            detail: { visible: grelha.visible },
                        }));
                    }
                } catch { /* segue */ }
            }
        }
    }

    function aplicarNotaFlutuante(remoto) {
        const secao = remoto.floatingNote;
        if (!secao || typeof secao !== 'object' || !secao.data || typeof secao.data !== 'object') return;
        const local = (() => {
            try { return JSON.parse(localStorage.getItem('study-journal-floating-note') || 'null'); } catch { return null; }
        })();
        const rTs = Number(secao.updatedAt) || 0;
        const lTs = local && typeof local.updatedAt === 'number' ? local.updatedAt : 0;
        if (rTs < lTs) return;
        try { localStorage.setItem('study-journal-floating-note', JSON.stringify(secao.data)); } catch { return; }
        if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('studyjournal:floating-note-sync', { detail: { data: secao.data } }));
        }
    }

    function aplicarDadosRemotos(remoto, { protegeVazios = true } = {}) {
        // protegeVazios=true (Gist, sem revisões): nunca apagar dados locais
        // com listas vazias vindas de um estado fresco.
        // protegeVazios=false (conta, com revisões): a revisão já distingue
        // "servidor fresco" de "apagado noutro aparelho", por isso aplica
        // sempre — senão os apagados legítimos nunca chegavam.
        const temConteudo = (v) => Array.isArray(v)
            ? v.length > 0
            : (v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);
        const localTemConteudo = (chave) => {
            try {
                const raw = localStorage.getItem(chave);
                if (raw === null) return false;
                return temConteudo(JSON.parse(raw));
            } catch {
                return false;
            }
        };
        const deveAplicar = (chave, valor) => !protegeVazios || temConteudo(valor) || !localTemConteudo(chave);

        if (remoto.days) {
            Object.entries(remoto.days).forEach(([key, value]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
                if (value.notes !== undefined) {
                    const chave = `study-journal-notes-${key}`;
                    const chaveTs = `${chave}-ts`;
                    const chaveBase = `${chave}-sync`;
                    const base = localStorage.getItem(chaveBase);
                    const local = localStorage.getItem(chave);
                    // "Sem edições desde o último sync" é mais fiável do que
                    // comparar relógios: se o editor local está parado,
                    // aceita-se sempre o remoto. Se foi editado aqui, decide
                    // o carimbo (LWW) para não perder a escrita local.
                    const parado = base !== null && local === base;
                    const rTs = Number(value.updatedAt) || 0;
                    const lTs = Number(localStorage.getItem(chaveTs)) || 0;
                    if (parado || rTs >= lTs) {
                        localStorage.setItem(chave, value.notes);
                        try {
                            localStorage.setItem(chaveTs, String(rTs || Date.now()));
                            localStorage.setItem(chaveBase, value.notes);
                        } catch { /* segue */ }
                    }
                }
                if (value.tasks !== undefined) {
                    // LWW por dia, como as notas: sem isto o pull repunha
                    // a lista antiga do servidor e apagava tarefas acabadas
                    // de criar neste aparelho.
                    const chave = `study-journal-tasks-${key}`;
                    const chaveTs = `${chave}-ts`;
                    const chaveBase = `${chave}-sync`;
                    const base = localStorage.getItem(chaveBase);
                    const local = localStorage.getItem(chave);
                    const remoto = JSON.stringify(value.tasks);
                    const parado = base !== null && local === base;
                    const rTs = Number(value.tasksUpdatedAt) || 0;
                    const lTs = Number(localStorage.getItem(chaveTs)) || 0;
                    if (parado || rTs >= lTs) {
                        localStorage.setItem(chave, remoto);
                        try {
                            localStorage.setItem(chaveTs, String(rTs || Date.now()));
                            localStorage.setItem(chaveBase, remoto);
                        } catch { /* segue */ }
                    }
                }
            });
        }
        if (remoto.semanal) {
            if (Array.isArray(remoto.semanal.fixos) && deveAplicar('study-journal-semanal-fixo', remoto.semanal.fixos)) {
                localStorage.setItem('study-journal-semanal-fixo', JSON.stringify(remoto.semanal.fixos));
            }
            if (Array.isArray(remoto.semanal.dinamicos) && remoto.semanal.semanaAtual) {
                const chaveDin = `study-journal-semanal-dinamico-${remoto.semanal.semanaAtual}`;
                if (deveAplicar(chaveDin, remoto.semanal.dinamicos)) {
                    localStorage.setItem(chaveDin, JSON.stringify(remoto.semanal.dinamicos));
                    localStorage.setItem('study-journal-semanal-dinamico-atual', remoto.semanal.semanaAtual);
                }
            }
        }
        // Histórico de todas as semanas e preferências do horário.
        aplicarSemanas(remoto);
        aplicarSemanalPrefs(remoto);
        // Concentração/estatísticas, Assistente, Quadro Branco e nota rápida.
        aplicarLogSessoes(remoto);
        aplicarObjetivoSessao(remoto);
        aplicarAssistente(remoto);
        aplicarQuadro(remoto);
        aplicarNotaFlutuante(remoto);
        if (remoto.exames) {
            if (remoto.exames.foco && deveAplicar('study-journal-exames-foco', remoto.exames.foco)) localStorage.setItem('study-journal-exames-foco', JSON.stringify(remoto.exames.foco));
            if (Array.isArray(remoto.exames.recursos) && deveAplicar('study-journal-exames-recursos', remoto.exames.recursos)) localStorage.setItem('study-journal-exames-recursos', JSON.stringify(remoto.exames.recursos));
            if (Array.isArray(remoto.exames.track) && deveAplicar('study-journal-exames-track', remoto.exames.track)) localStorage.setItem('study-journal-exames-track', JSON.stringify(remoto.exames.track));
            if (Array.isArray(remoto.exames.duvidas) && deveAplicar('study-journal-exames-duvidas', remoto.exames.duvidas)) localStorage.setItem('study-journal-exames-duvidas', JSON.stringify(remoto.exames.duvidas));
            if (typeof remoto.exames.dataAlvo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(remoto.exames.dataAlvo)) localStorage.setItem('study-journal-exames-data-alvo', JSON.stringify(remoto.exames.dataAlvo));
        }
        // Exames Nacionais v2: a fusão por id (com tombstones) é feita
        // dentro de exames.js para não perder trabalho dos dois lados.
        if (remoto.examesV2 && window.Exames && typeof window.Exames.fundirRemoto === 'function') {
            try {
                window.Exames.fundirRemoto(remoto.examesV2);
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('studyjournal:exames-sync'));
                }
            } catch { /* segue sem aplicar */ }
        }
        // Metadados das notas (título/disciplina/categoria/tópico) e índice
        // das notas recentes: LWW por dia, como o texto das notas.
        if (remoto.notasMeta && typeof remoto.notasMeta === 'object') {
            Object.entries(remoto.notasMeta).forEach(([dia, meta]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !meta || typeof meta !== 'object') return;
                const chave = `study-journal-note-meta-${dia}`;
                let local = null;
                try { local = JSON.parse(localStorage.getItem(chave) || 'null'); } catch { local = null; }
                const rTs = Number(meta.updatedAt) || 0;
                const lTs = Number(local && local.updatedAt) || 0;
                if (rTs >= lTs) {
                    try { localStorage.setItem(chave, JSON.stringify(meta)); } catch { /* segue */ }
                }
            });
        }
        if (remoto.notasIndex && typeof remoto.notasIndex === 'object') {
            let local = {};
            try { local = JSON.parse(localStorage.getItem('study-journal-notes-index') || '{}') || {}; } catch { local = {}; }
            if (!local || typeof local !== 'object') local = {};
            const out = { ...local };
            Object.entries(remoto.notasIndex).forEach(([dia, entrada]) => {
                if (!entrada || typeof entrada !== 'object') return;
                const rTs = Number(entrada.updatedAt) || 0;
                const lTs = Number(out[dia] && out[dia].updatedAt) || 0;
                if (rTs >= lTs) out[dia] = entrada;
            });
            try { localStorage.setItem('study-journal-notes-index', JSON.stringify(out)); } catch { /* segue */ }
        }
        if (Array.isArray(remoto.reviewsV2) && deveAplicar('study-journal-reviews-v2', remoto.reviewsV2)) {
            localStorage.setItem('study-journal-reviews-v2', JSON.stringify(remoto.reviewsV2));
        }
        // Galerias (PDFs e Caderno): união por id — um wipe no servidor
        // (lista vazia) nunca apaga a galeria — menos os apagados
        // (tombstones de 30 dias), para os removidos não ressuscitarem.
        fundirColecao('study-journal-pdfs', 'study-journal-pdfs-apagados', remoto.pdfs, remoto.pdfsApagados);
        fundirColecao('study-journal-caderno', 'study-journal-caderno-apagados', remoto.caderno, remoto.cadernoApagados);
        fundirSessoes(remoto);
    }

    function fundirColecao(chaveLista, chaveApagados, listaRemota, apagadosRemotos) {
        if (!Array.isArray(listaRemota) && !Array.isArray(apagadosRemotos)) return;
        const APAGADO_MS = 30 * 24 * 60 * 60 * 1000;
        const agora = Date.now();
        const mapa = new Map();
        try {
            const atuais = JSON.parse(localStorage.getItem(chaveLista) || '[]');
            if (Array.isArray(atuais)) atuais.forEach((d) => { if (d && d.id) mapa.set(d.id, d); });
        } catch { /* segue */ }
        if (Array.isArray(listaRemota)) listaRemota.forEach((d) => { if (d && d.id) mapa.set(d.id, d); });
        const ap = new Map();
        try {
            const v = JSON.parse(localStorage.getItem(chaveApagados) || '[]');
            if (Array.isArray(v)) v.forEach((e) => { if (e && typeof e.id === 'string') ap.set(e.id, Number(e.ts) || 0); });
        } catch { /* segue */ }
        if (Array.isArray(apagadosRemotos)) apagadosRemotos.forEach((e) => {
            if (e && typeof e.id === 'string') {
                const ts = Number(e.ts) || 0;
                if (!ap.has(e.id) || ts > ap.get(e.id)) ap.set(e.id, ts);
            }
        });
        const vivos = [...ap.entries()].filter(([, ts]) => agora - ts < APAGADO_MS);
        vivos.forEach(([id]) => mapa.delete(id));
        try {
            localStorage.setItem(chaveLista, JSON.stringify([...mapa.values()]));
            localStorage.setItem(chaveApagados, JSON.stringify(vivos.map(([id, ts]) => ({ id, ts })).slice(-200)));
        } catch { /* segue sem persistir */ }
    }

    function numMin(n) {
        const x = Number(n);
        return Number.isFinite(x) && x > 0 ? x : 0;
    }

    /* Sessões do Estudar: a base funde por máximo; os slots por união
       (máximo por compartimento de aparelho); o campo `sessoes` de
       clientes antigos entra na base só pelo excedente, para não contar
       duas vezes o que já vive nos slots. No fim recompõe o cache de
       totais (study-journal-sessions) para heatmap e vistas. */
    function fundirSessoes(remoto) {
        const BASE_KEY = 'study-journal-sessions-base';
        const SLOTS_KEY = 'study-journal-sessions-slots';
        const TOTAL_KEY = 'study-journal-sessions';
        let base = {};
        let slots = {};
        try {
            base = JSON.parse(localStorage.getItem(BASE_KEY) || '{}') || {};
            if (!base || typeof base !== 'object') base = {};
        } catch { base = {}; }
        try {
            slots = JSON.parse(localStorage.getItem(SLOTS_KEY) || '{}') || {};
            if (!slots || typeof slots !== 'object') slots = {};
        } catch { slots = {}; }

        const baseRemota = (remoto.sessoesBase && typeof remoto.sessoesBase === 'object') ? remoto.sessoesBase : null;
        const slotsRemotos = (remoto.sessoesSlots && typeof remoto.sessoesSlots === 'object') ? remoto.sessoesSlots : null;
        const legadoRemoto = (remoto.sessoes && typeof remoto.sessoes === 'object') ? remoto.sessoes : null;
        const fonteBase = baseRemota || legadoRemoto;

        // Migração (uma vez): se nunca houve base nem slots, os totais
        // guardados são legado puro e congelam como base. Com slots já
        // existentes NÃO se congela — o cache de totais já os inclui e
        // congelá-lo duplicava os minutos (detetado em teste).
        if (!Object.keys(base).length && !Object.keys(slots).length) {
            try {
                const antigos = JSON.parse(localStorage.getItem(TOTAL_KEY) || '{}');
                if (antigos && typeof antigos === 'object' && Object.keys(antigos).length) {
                    base = antigos;
                }
            } catch { /* segue sem base */ }
        }

        if (slotsRemotos) {
            Object.entries(slotsRemotos).forEach(([dia, materias]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
                if (!slots[dia] || typeof slots[dia] !== 'object') slots[dia] = {};
                Object.entries(materias).forEach(([materia, aparelhos]) => {
                    if (typeof materia !== 'string' || !materia || !aparelhos || typeof aparelhos !== 'object') return;
                    if (!slots[dia][materia] || typeof slots[dia][materia] !== 'object') slots[dia][materia] = {};
                    Object.entries(aparelhos).forEach(([dev, min]) => {
                        if (typeof dev !== 'string' || !dev) return;
                        slots[dia][materia][dev] = Math.max(numMin(slots[dia][materia][dev]), numMin(min));
                    });
                });
            });
        }

        const somaSlots = {};
        Object.entries(slots).forEach(([dia, materias]) => {
            if (!materias || typeof materias !== 'object') return;
            Object.entries(materias).forEach(([materia, aparelhos]) => {
                if (!aparelhos || typeof aparelhos !== 'object') return;
                const s = Object.values(aparelhos).reduce((a, v) => a + numMin(v), 0);
                if (s > 0) {
                    if (!somaSlots[dia]) somaSlots[dia] = {};
                    somaSlots[dia][materia] = s;
                }
            });
        });

        const dias = new Set([...Object.keys(base), ...Object.keys(fonteBase || {})]);
        dias.forEach((dia) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
            const lb = (base[dia] && typeof base[dia] === 'object') ? base[dia] : {};
            const rb = (fonteBase && fonteBase[dia] && typeof fonteBase[dia] === 'object') ? fonteBase[dia] : {};
            const out = {};
            new Set([...Object.keys(lb), ...Object.keys(rb)]).forEach((materia) => {
                const vBase = numMin(lb[materia]);
                let v = vBase;
                if (baseRemota) {
                    v = Math.max(v, numMin(rb[materia]));
                } else if (legadoRemoto) {
                    // Cliente antigo: o campo `sessoes` nunca contém os slots
                    // (não os conhece), por isso tudo acima da nossa base é
                    // trabalho novo dele e entra por inteiro.
                    const excesso = numMin(rb[materia]) - vBase;
                    if (excesso > 0) v = vBase + excesso;
                }
                if (v > 0) out[materia] = v;
            });
            if (Object.keys(out).length) base[dia] = out;
            else delete base[dia];
        });

        try {
            localStorage.setItem(BASE_KEY, JSON.stringify(base));
            localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
        } catch { /* segue sem persistir */ }

        const totais = JSON.parse(JSON.stringify(base));
        Object.entries(somaSlots).forEach(([dia, materias]) => {
            if (!totais[dia]) totais[dia] = {};
            Object.entries(materias).forEach(([materia, s]) => {
                totais[dia][materia] = numMin(totais[dia][materia]) + s;
            });
        });
        try {
            localStorage.setItem(TOTAL_KEY, JSON.stringify(totais));
        } catch { /* segue sem cache */ }
    }

    async function sync(pullFirst = true) {
        // Não manter dois documentos centrais concorrentes: a conta StudyJournal
        // prevalece e esta instância fica disponível só quando a conta não está ativa.
        if (window.ContaSync?.configurado?.()) return { ok: false, reason: 'central_sync_active' };
        if ((!configurado() && !hasWriteAccess()) || aSyncando) return { ok: false, reason: 'not_configured_or_syncing' };
        aSyncando = true;
        notificar('sync-start');

        try {
            if (isPublicReadOnly()) {
                const remote = await lerGist();
                aplicarDadosRemotos(remote.data);
                localStorage.setItem(CHAVE_ULTIMO_SYNC, new Date().toISOString());
                notificar('pull-done', { data: remote.data });
                aSyncando = false;
                notificar('sync-done', { success: true, readOnly: true });
                return { ok: true, readOnly: true };
            }
            if (!hasWriteAccess()) {
                aSyncando = false;
                notificar('sync-error', { error: 'Sem permissão de escrita no Gist.' });
                return { ok: false, reason: 'no_write_access' };
            }

            let localData = coletarDadosLocais();
            let remoteSha = null;

            if (!gistId) {
                gistId = await criarGistInicial();
                localStorage.setItem(CHAVE_GIST, gistId);
                iniciarAutoSync(false);
            }

            if (pullFirst) {
                const remote = await lerGist();
                remoteSha = remote.sha;
                aplicarDadosRemotos(remote.data);
                notificar('pull-done', { data: remote.data });
            }

            localData = coletarDadosLocais();
            // Só escreve quando há algo novo: o poll de 20s não deve
            // reescrever o Gist (e mexer no updatedAt) sem necessidade.
            const payload = JSON.stringify(localData);
            if (payload !== ultimoPayloadEnviado) {
                const enviado = await escreverGist(localData, remoteSha);
                ultimoPayloadEnviado = payload;
                marcarBasesSincronizadas(localData);
                notificar('push-done', { sha: enviado.sha, updatedAt: enviado.updatedAt });
            }

            aSyncando = false;
            notificar('sync-done', { success: true });
            return { ok: true };
        } catch (err) {
            aSyncando = false;
            notificar('sync-error', { error: err.message });
            return { ok: false, error: err.message };
        }
    }

    async function fetchPublicData() {
        if (!configurado()) throw new Error('GitHub não configurado');
        const headers = getHeaders(false); // No auth for public read
        const resp = await pedir(`${API_BASE}/${gistId}`, { headers });
        if (!resp.ok) throw new Error(`Erro ao ler Gist público: ${resp.status}`);
        const data = await resp.json();
        const arquivo = data.files['study-journal-data.json'];
        if (!arquivo) throw new Error('Ficheiro não encontrado no Gist');
        return JSON.parse(arquivo.content);
    }


    function iniciarAutoSync(imediato = true) {
        if (!hasWriteAccess() && !isPublicReadOnly()) return;
        if (syncTimer) return;
        syncTimer = setInterval(() => sync(), SYNC_INTERVAL_MS);
        if (imediato) sync();
    }

    function pararAutoSync() {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = null;
    }

    function onSync(cb) {
        listeners.push(cb);
        return () => { listeners = listeners.filter(l => l !== cb); };
    }

    carregarConfig();
    if (hasWriteAccess() || isPublicReadOnly()) {
        // ContaSync é carregado imediatamente depois deste módulo; adiar a
        // primeira leitura evita concorrência ao iniciar um browser autenticado.
        setTimeout(() => {
            if (!window.ContaSync?.configurado?.()) iniciarAutoSync();
        }, 0);
    }

    window.addEventListener('online', () => sync());
    window.addEventListener('focus', () => sync());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') sync();
    });
    window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith('study-journal-')
            && ![CHAVE_TOKEN, CHAVE_GIST, CHAVE_PUBLIC_READONLY].includes(event.key)) {
            // Várias abas a escrever (notas, tarefas, heatmap) disparavam
            // um sync por chave; um a cada 3s chega e poupa a API.
            const agora = Date.now();
            if (agora - ultimoSyncStorage < 3000) return;
            ultimoSyncStorage = agora;
            sync();
        }
    });

    return {
        configurado,
        isPublicReadOnly,
        hasWriteAccess,
        coletarLocais: coletarDadosLocais,
        aplicarRemotos: (remoto, opts) => aplicarDadosRemotos(remoto, opts),
        marcarBasesSincronizadas,
        getToken: () => token,
        getGistId: () => gistId,
        setConfig: salvarConfig,
        setPublicGist,
        clearPublicReadOnly,
        clearConfig: limparConfig,
        sync,
        fetchPublicData,
        onSync,
        iniciarAutoSync,
        pararAutoSync,
    };
})();
