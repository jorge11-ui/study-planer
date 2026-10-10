window.GitHubSync = (() => {
    const CHAVE_TOKEN = 'study-journal-github-token';
    const CHAVE_GIST = 'study-journal-gist-id';
    const CHAVE_ULTIMO_SYNC = 'study-journal-github-last-sync';
    const CHAVE_PUBLIC_READONLY = 'study-journal-github-public-readonly';
    const API_BASE = 'https://api.github.com/gists';
    const SYNC_INTERVAL_MS = 60000;

    let token = '';
    let gistId = '';
    let publicReadOnly = false;
    let syncTimer = null;
    let aSyncando = false;
    let listeners = [];

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
            gistId = novoGistId;
            localStorage.setItem(CHAVE_GIST, novoGistId);
        }
    }

    function setPublicGist(gistIdValue) {
        gistId = gistIdValue;
        publicReadOnly = true;
        localStorage.setItem(CHAVE_GIST, gistIdValue);
        localStorage.setItem(CHAVE_PUBLIC_READONLY, 'true');
        // Clear token if it exists (not needed for public read-only)
        token = '';
        localStorage.removeItem(CHAVE_TOKEN);
        pararAutoSync();
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
        // Configured if we have a gistId (with or without token)
        return !!gistId;
    }

    function isPublicReadOnly() {
        return publicReadOnly && !!gistId && !token;
    }

    function hasWriteAccess() {
        return !!token && !!gistId;
    }

    async function criarGistInicial() {
        if (!hasWriteAccess()) throw new Error('GitHub não configurado para escrita');

        const payload = {
            description: 'StudyJournal Sync',
            public: true, // Public so phone can read without auth
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

        const resp = await fetch(API_BASE, {
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

        const resp = await fetch(`${API_BASE}/${gistId}`, { headers });

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

        const payload = {
            description: 'StudyJournal Sync',
            files: {
                'study-journal-data.json': {
                    content: JSON.stringify({
                        ...dados,
                        updatedAt: new Date().toISOString(),
                    }, null, 2),
                },
            },
        };

        if (sha) payload.files['study-journal-data.json'].sha = sha;

        const resp = await fetch(`${API_BASE}/${gistId}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(`Erro ao escrever Gist: ${resp.status} ${err.message || ''}`);
        }

        const data = await resp.json();
        localStorage.setItem(CHAVE_ULTIMO_SYNC, new Date().toISOString());
        return data.files['study-journal-data.json'].sha;
    }

    function coletarDadosLocais() {
        const days = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i) || '';
                const notesMatch = /^study-journal-notes-(\d{4}-\d{2}-\d{2})$/.exec(key);
                const tasksMatch = /^study-journal-tasks-(\d{4}-\d{2}-\d{2})$/.exec(key);
                if (notesMatch) {
                    const k = notesMatch[1];
                    days[k] = days[k] || {};
                    days[k].notes = localStorage.getItem(key);
                } else if (tasksMatch) {
                    const k = tasksMatch[1];
                    days[k] = days[k] || {};
                    days[k].tasks = JSON.parse(localStorage.getItem(key) || '[]');
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

        return {
            days,
            semanal,
            exames: {
                foco: lerJson('study-journal-exames-foco', null),
                recursos: lerJson('study-journal-exames-recursos', null),
                track: lerJson('study-journal-exames-track', null),
                duvidas: lerJson('study-journal-exames-duvidas', null),
                dataAlvo: lerJson('study-journal-exames-data-alvo', null),
            },
            reviewsV2: lerJson('study-journal-reviews-v2', null),
            // Metadados dos PDFs (a lista; os bytes vão por /api/ficheiros).
            // Sem isto, no Render (sem vault) a galeria não viajava.
            pdfs: lerJson('study-journal-pdfs', null),
            // Sessões do timer (heatmap/estatísticas). O pomodoro legado não
            // sincroniza de propósito: os valores antigos (contagens) e novos
            // (minutos) misturar-se-iam na migração entre aparelhos.
            sessoes: lerJson('study-journal-sessions', null),
        };
    }

    function aplicarDadosRemotos(remoto) {
        // Nunca apagar dados locais com listas vazias vindas de um servidor
        // fresco (ex.: primeiro login no Render): só substitui se o remoto
        // trouxer conteúdo ou o local já estiver vazio.
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
        const deveAplicar = (chave, valor) => temConteudo(valor) || !localTemConteudo(chave);

        if (remoto.days) {
            Object.entries(remoto.days).forEach(([key, value]) => {
                if (value.notes !== undefined) localStorage.setItem(`study-journal-notes-${key}`, value.notes);
                if (value.tasks !== undefined) localStorage.setItem(`study-journal-tasks-${key}`, JSON.stringify(value.tasks));
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
        if (remoto.exames) {
            if (remoto.exames.foco && deveAplicar('study-journal-exames-foco', remoto.exames.foco)) localStorage.setItem('study-journal-exames-foco', JSON.stringify(remoto.exames.foco));
            if (Array.isArray(remoto.exames.recursos) && deveAplicar('study-journal-exames-recursos', remoto.exames.recursos)) localStorage.setItem('study-journal-exames-recursos', JSON.stringify(remoto.exames.recursos));
            if (Array.isArray(remoto.exames.track) && deveAplicar('study-journal-exames-track', remoto.exames.track)) localStorage.setItem('study-journal-exames-track', JSON.stringify(remoto.exames.track));
            if (Array.isArray(remoto.exames.duvidas) && deveAplicar('study-journal-exames-duvidas', remoto.exames.duvidas)) localStorage.setItem('study-journal-exames-duvidas', JSON.stringify(remoto.exames.duvidas));
            if (typeof remoto.exames.dataAlvo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(remoto.exames.dataAlvo)) localStorage.setItem('study-journal-exames-data-alvo', JSON.stringify(remoto.exames.dataAlvo));
        }
        if (Array.isArray(remoto.reviewsV2) && deveAplicar('study-journal-reviews-v2', remoto.reviewsV2)) {
            localStorage.setItem('study-journal-reviews-v2', JSON.stringify(remoto.reviewsV2));
        }
        if (Array.isArray(remoto.pdfs) && deveAplicar('study-journal-pdfs', remoto.pdfs)) {
            localStorage.setItem('study-journal-pdfs', JSON.stringify(remoto.pdfs));
        }
        if (remoto.sessoes && typeof remoto.sessoes === 'object') {
            // Fusão por máximo (dia, disciplina): os minutos só crescem,
            // por isso o max converge sem duplicar em syncs repetidos.
            const CHAVE_SESSOES = 'study-journal-sessions';
            let locais = {};
            try {
                locais = JSON.parse(localStorage.getItem(CHAVE_SESSOES) || '{}');
                if (!locais || typeof locais !== 'object') locais = {};
            } catch { locais = {}; }
            Object.entries(remoto.sessoes).forEach(([dia, materias]) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
                if (!locais[dia] || typeof locais[dia] !== 'object') locais[dia] = {};
                Object.entries(materias).forEach(([materia, min]) => {
                    const n = Number(min);
                    if (!Number.isFinite(n) || n <= 0) return;
                    locais[dia][materia] = Math.max(Number(locais[dia][materia]) || 0, n);
                });
            });
            try {
                localStorage.setItem(CHAVE_SESSOES, JSON.stringify(locais));
            } catch { /* segue sem persistir */ }
        }
    }

    async function sync(pullFirst = true) {
        if (!hasWriteAccess() || aSyncando) return { ok: false, reason: 'no_write_access_or_syncing' };
        aSyncando = true;
        notificar('sync-start');

        try {
            let localData = coletarDadosLocais();
            let remoteSha = null;

            if (pullFirst) {
                const remote = await lerGist();
                remoteSha = remote.sha;
                aplicarDadosRemotos(remote.data);
                notificar('pull-done', { data: remote.data });
            }

            localData = coletarDadosLocais();
            const newSha = await escreverGist(localData, remoteSha);
            notificar('push-done', { sha: newSha });

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
        const resp = await fetch(`${API_BASE}/${gistId}`, { headers });
        if (!resp.ok) throw new Error(`Erro ao ler Gist público: ${resp.status}`);
        const data = await resp.json();
        const arquivo = data.files['study-journal-data.json'];
        if (!arquivo) throw new Error('Ficheiro não encontrado no Gist');
        return JSON.parse(arquivo.content);
    }


    function iniciarAutoSync() {
        if (!hasWriteAccess()) return;
        if (syncTimer) return;
        syncTimer = setInterval(() => sync(), SYNC_INTERVAL_MS);
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
    if (hasWriteAccess()) iniciarAutoSync();

    return {
        configurado,
        isPublicReadOnly,
        hasWriteAccess,
        coletarLocais: coletarDadosLocais,
        aplicarRemotos: aplicarDadosRemotos,
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
