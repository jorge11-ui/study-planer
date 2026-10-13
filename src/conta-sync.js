/* StudyJournal — Sync pela conta única do próprio servidor.
   Uma conta (SYNC_USER/SYNC_PASS no servidor) partilhada pelos aparelhos:
   login uma vez em cada aparelho e tudo atualiza sozinho (push ao gravar,
   pull automático de 30 em 30s + ao voltar à página). Revisões (rev)
   evitam escritas cegas: push sobre rev antiga faz pull, funde e repete. */

window.ContaSync = (() => {
    const K_TOKEN = 'study-journal-conta-token';
    const K_USER = 'study-journal-conta-user';
    const K_REV = 'study-journal-conta-rev';
    const K_GID = 'study-journal-conta-gid';
    const K_LAST = 'study-journal-conta-last-sync';
    const POLL_MS = 30000;
    const AUTO_MIN_GAP_MS = 15000;
    const ESTADO_TTL_MS = 60000;

    let token = '';
    let user = '';
    let aSyncando = false;
    let timer = null;
    let ultimoPullAuto = 0;
    let estadoCache = { t: 0, v: null };
    let listeners = [];

    try {
        token = localStorage.getItem(K_TOKEN) || '';
        user = localStorage.getItem(K_USER) || '';
    } catch { /* sem storage: fica desligado */ }

    function notificar(tipo, detalhes = {}) {
        listeners.forEach((cb) => {
            try { cb(tipo, detalhes); } catch { /* listener não pode partir o sync */ }
        });
    }

    function persistirCredenciais() {
        try {
            if (token) localStorage.setItem(K_TOKEN, token);
            else localStorage.removeItem(K_TOKEN);
            if (user) localStorage.setItem(K_USER, user);
            else localStorage.removeItem(K_USER);
        } catch { /* segue sem persistir */ }
    }

    function lerRev() {
        try {
            return Number(localStorage.getItem(K_REV) ?? '0') || 0;
        } catch {
            return 0;
        }
    }

    function guardarRev(rev, gid = null) {
        try {
            localStorage.setItem(K_REV, String(rev));
            localStorage.setItem(K_LAST, new Date().toISOString());
            if (gid) localStorage.setItem(K_GID, String(gid));
        } catch { /* segue */ }
    }

    function lerGid() {
        try {
            return localStorage.getItem(K_GID) || null;
        } catch {
            return null;
        }
    }

    function coletar() {
        if (window.GitHubSync && window.GitHubSync.coletarLocais) {
            return window.GitHubSync.coletarLocais();
        }
        return { days: {} };
    }

    function aplicar(remoto) {
        if (window.GitHubSync && window.GitHubSync.aplicarRemotos) {
            // Sem proteção de vazios: a revisão (rev) já nos diz se o
            // servidor avançou — inclusive quando avançou para vazio
            // porque alguém apagou no outro aparelho.
            window.GitHubSync.aplicarRemotos(remoto || {}, { protegeVazios: false });
        }
    }

    async function api(path, { method = 'GET', body = null, auth = true } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (auth && token) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try {
            data = await resp.json();
        } catch { /* corpo vazio ou inválido */ }
        return { status: resp.status, data };
    }

    function configurado() {
        return !!token;
    }

    function getUser() {
        return user;
    }

    async function estado() {
        const agora = Date.now();
        if (estadoCache.v && agora - estadoCache.t < ESTADO_TTL_MS) return estadoCache.v;
        try {
            const { data } = await api('/api/conta/estado', { auth: false });
            estadoCache = { t: agora, v: data && data.ok ? data : { contaAtiva: false } };
        } catch {
            estadoCache = { t: agora, v: { contaAtiva: false, offline: true } };
        }
        return estadoCache.v;
    }

    function limparSessao(motivo) {
        token = '';
        user = '';
        persistirCredenciais();
        pararAuto();
        return motivo;
    }

    async function login(nome, pass) {
        const u = String(nome || '').trim();
        if (!u || !pass) return { ok: false, error: 'Escreve utilizador e palavra-passe.' };
        notificar('sync-start');
        try {
            const { status, data } = await api('/api/conta/login', {
                method: 'POST',
                body: { user: u, pass: String(pass) },
                auth: false,
            });
            if (status === 503) {
                notificar('sync-error', {});
                return { ok: false, error: 'Servidor sem conta configurada (SYNC_USER/SYNC_PASS).' };
            }
            if (status === 429) {
                notificar('sync-error', {});
                return { ok: false, error: 'Demasiadas tentativas — espera um minuto.' };
            }
            if (!data || !data.ok || !data.token) {
                notificar('sync-error', {});
                return { ok: false, error: 'Credenciais inválidas.' };
            }
            token = data.token;
            user = u;
            persistirCredenciais();
            const r = await sync(true);
            if (r.ok) iniciarAuto();
            return r.ok ? { ok: true } : r;
        } catch {
            notificar('sync-error', {});
            return { ok: false, error: 'Sem ligação ao servidor.' };
        }
    }

    async function logout() {
        try {
            await api('/api/conta/sair', { method: 'POST' });
        } catch { /* best-effort */ }
        try {
            localStorage.removeItem(K_REV);
            localStorage.removeItem(K_GID);
            localStorage.removeItem(K_LAST);
        } catch { /* segue */ }
        limparSessao();
        return { ok: true };
    }

    async function fazerPull() {
        const { status, data } = await api('/api/sync');
        if (status === 401) {
            limparSessao();
            throw new Error('Sessão expirada — entra de novo na conta.');
        }
        if (status === 503) throw new Error('Servidor sem conta configurada.');
        if (!data || !data.ok) throw new Error('Resposta inválida do servidor.');

        const antes = lerRev();
        const atual = Number(data.rev) || 0;
        const gid = (data.gid && typeof data.gid === 'string') ? data.gid : null;
        const gidGuardado = lerGid();
        if (gid && !gidGuardado) {
            try { localStorage.setItem(K_GID, gid); } catch { /* segue */ }
        }
        // gid novo com o mesmo rev = o disco do servidor foi limpo e a
        // contagem recomeçou: o conteúdo é outro, mesmo com rev igual.
        const geracaoNova = gid && gidGuardado && gid !== gidGuardado;
        if (atual < antes || geracaoNova) {
            // O servidor recuou (wipe/redeploy com disco efémero): funde o
            // que ele tem — pode incluir trabalho fresco que outro aparelho
            // já repôs após o wipe — adota a revisão dele e devolve sinal
            // para fazerPush() a seguir enviar o fundido. Sem isto, um
            // aparelho desatualizado repunha por cima e apagava tudo.
            aplicar(data.data);
            guardarRev(atual, gid);
            notificar('pull-done', { rev: atual });
            const notasOk = typeof window.recarregarAposSync === 'function'
                ? window.recarregarAposSync()
                : true;
            return { atualizou: true, notasAdiadas: !notasOk, fundiuWipe: true };
        }
        if (atual <= antes) {
            return { atualizou: false };
        }

        aplicar(data.data);
        guardarRev(atual, gid);
        notificar('pull-done', { rev: atual });
        const notasOk = typeof window.recarregarAposSync === 'function'
            ? window.recarregarAposSync()
            : true;
        return { atualizou: true, notasAdiadas: !notasOk };
    }

    async function fazerPush() {
        const payload = coletar();
        let r = await api('/api/sync', { method: 'PUT', body: { baseRev: lerRev(), data: payload } });

        if (r.status === 401) {
            limparSessao();
            throw new Error('Sessão expirada — entra de novo na conta.');
        }
        if (r.status === 503) throw new Error('Servidor sem conta configurada.');

        if (r.status === 409 && r.data) {
            const revServidor = Number(r.data.rev) || 0;
            if (revServidor < lerRev()) {
                // Servidor recuou (wipe/redeploy) depois da nossa recolha:
                // funde primeiro (o servidor pode ter trabalho fresco de
                // outro aparelho) e repõe o fundido, em vez de apagar por cima.
                aplicar(r.data.data);
                guardarRev(revServidor, (r.data.gid && typeof r.data.gid === 'string') ? r.data.gid : null);
                notificar('pull-done', { rev: lerRev(), conflito: true });
                if (typeof window.recarregarAposSync === 'function') window.recarregarAposSync();
                const payloadF = coletar();
                r = await api('/api/sync', { method: 'PUT', body: { baseRev: revServidor, forcar: true, data: payloadF } });
                if (r.status === 409) {
                    throw new Error('Servidor incompatível — atualiza a app nos dois aparelhos.');
                }
            } else {
                // Alguém escreveu entretanto: aplica, refaz a recolha e repete uma vez
                aplicar(r.data.data);
                guardarRev(Number(r.data.rev) || 0, (r.data.gid && typeof r.data.gid === 'string') ? r.data.gid : null);
                notificar('pull-done', { rev: lerRev(), conflito: true });
                if (typeof window.recarregarAposSync === 'function') window.recarregarAposSync();
                const payload2 = coletar();
                r = await api('/api/sync', { method: 'PUT', body: { baseRev: lerRev(), data: payload2 } });
                if (r.status === 401) {
                    limparSessao();
                    throw new Error('Sessão expirada — entra de novo na conta.');
                }
            }
        }

        if (!r.data || !r.data.ok) {
            throw new Error((r.data && r.data.reason) || `HTTP ${r.status}`);
        }
        guardarRev(Number(r.data.rev) || lerRev(), (r.data.gid && typeof r.data.gid === 'string') ? r.data.gid : null);
        notificar('push-done', { rev: lerRev() });
        return { ok: true };
    }

    async function sync(pullFirst = true) {
        if (!token) return { ok: false, reason: 'sem-conta' };
        if (aSyncando) return { ok: false, reason: 'a-syncar' };
        aSyncando = true;
        notificar('sync-start');
        try {
            let puxou = { atualizou: false };
            if (pullFirst) puxou = await fazerPull();
            await fazerPush();
            notificar('sync-done', { success: true, ...puxou });
            return { ok: true, ...puxou };
        } catch (err) {
            notificar('sync-error', { error: String((err && err.message) || err) });
            return { ok: false, error: String((err && err.message) || err) };
        } finally {
            aSyncando = false;
        }
    }

    async function push() {
        // Pull-first: nunca empurrar por cima sem ver o que o servidor tem.
        // É o que fecha a janela em que dois pushes concorrentes (ou um
        // wipe com rev reutilizada) deitavam fora minutos do Estudar.
        return sync(true);
    }

    async function pullAuto() {
        if (!token || aSyncando) return;
        const agora = Date.now();
        if (agora - ultimoPullAuto < AUTO_MIN_GAP_MS) return;
        ultimoPullAuto = agora;
        try {
            await pull();
        } catch { /* silencioso no automático */ }
    }

    async function pull() {
        if (!token) return { ok: false, reason: 'sem-conta' };
        if (aSyncando) return { ok: false, reason: 'a-syncar' };
        aSyncando = true;
        notificar('sync-start');
        try {
            const r = await fazerPull();
            if (r && r.fundiuWipe) {
                // Servidor recém-limpado: repõe já o estado fundido.
                await fazerPush();
            }
            notificar('sync-done', { success: true, ...r });
            return { ok: true, ...r };
        } catch (err) {
            notificar('sync-error', { error: String((err && err.message) || err) });
            return { ok: false, error: String((err && err.message) || err) };
        } finally {
            aSyncando = false;
        }
    }

    function iniciarAuto() {
        if (timer || !token) return;
        timer = setInterval(() => pullAuto().catch(() => {}), POLL_MS);
    }

    function pararAuto() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    function onSync(cb) {
        listeners.push(cb);
        return () => { listeners = listeners.filter((l) => l !== cb); };
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') pullAuto().catch(() => {});
        });
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('focus', () => pullAuto().catch(() => {}));
    }

    if (token) iniciarAuto();

    return {
        configurado,
        getUser,
        estado,
        login,
        logout,
        sync,
        push,
        pull,
        onSync,
        iniciarAuto,
        pararAuto,
    };
})();
