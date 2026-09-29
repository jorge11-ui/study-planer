const GitHubSync = (() => {
    const CHAVE_TOKEN = 'study-journal-github-token';
    const CHAVE_GIST = 'study-journal-gist-id';
    const CHAVE_ULTIMO_SYNC = 'study-journal-github-last-sync';
    const API_BASE = 'https://api.github.com/gists';
    const SYNC_INTERVAL_MS = 60000;

    let token = '';
    let gistId = '';
    let syncTimer = null;
    let aSyncando = false;
    let listeners = [];

    function notificar(tipo, detalhes = {}) {
        listeners.forEach(cb => cb(tipo, detalhes));
    }

    function getHeaders() {
        return {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        };
    }

    function carregarConfig() {
        token = localStorage.getItem(CHAVE_TOKEN) || '';
        gistId = localStorage.getItem(CHAVE_GIST) || '';
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

    function limparConfig() {
        token = '';
        gistId = '';
        localStorage.removeItem(CHAVE_TOKEN);
        localStorage.removeItem(CHAVE_GIST);
        localStorage.removeItem(CHAVE_ULTIMO_SYNC);
    }

    function configurado() {
        return !!token && !!gistId;
    }

    async function criarGistInicial() {
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

        const resp = await fetch(`${API_BASE}/${gistId}`, { headers: getHeaders() });

        if (resp.status === 404) {
            const novoId = await criarGistInicial();
            gistId = novoId;
            localStorage.setItem(CHAVE_GIST, novoId);
            return await lerGist();
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
        if (!configurado()) throw new Error('GitHub não configurado');

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

        return { days, semanal };
    }

    function aplicarDadosRemotos(remoto) {
        if (remoto.days) {
            Object.entries(remoto.days).forEach(([key, value]) => {
                if (value.notes !== undefined) localStorage.setItem(`study-journal-notes-${key}`, value.notes);
                if (value.tasks !== undefined) localStorage.setItem(`study-journal-tasks-${key}`, JSON.stringify(value.tasks));
            });
        }
        if (remoto.semanal) {
            if (Array.isArray(remoto.semanal.fixos)) {
                localStorage.setItem('study-journal-semanal-fixo', JSON.stringify(remoto.semanal.fixos));
            }
            if (Array.isArray(remoto.semanal.dinamicos) && remoto.semanal.semanaAtual) {
                localStorage.setItem(`study-journal-semanal-dinamico-${remoto.semanal.semanaAtual}`, JSON.stringify(remoto.semanal.dinamicos));
                localStorage.setItem('study-journal-semanal-dinamico-atual', remoto.semanal.semanaAtual);
            }
        }
    }

    async function sync(pullFirst = true) {
        if (!configurado() || aSyncando) return { ok: false, reason: 'not_configured_or_syncing' };
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

    function iniciarAutoSync() {
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
    if (configurado()) iniciarAutoSync();

    return {
        configurado,
        getToken: () => token,
        getGistId: () => gistId,
        setConfig: salvarConfig,
        clearConfig: limparConfig,
        sync,
        onSync,
        iniciarAutoSync,
        pararAutoSync,
    };
})();