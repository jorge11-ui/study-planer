/* StudyJournal — Workspace central (cliente).

   A fonte de verdade é a base de dados do servidor. O localStorage é
   apenas a cópia local que a UI lê de forma síncrona. Cada escrita numa
   chave `study-journal-*` é enviada como operação para
   `/api/workspace/ops`; os outros aparelhos recebem o aviso por SSE e
   pedem só as chaves alteradas.

   Regras (iguais às de lib/workspace-protocol.js):
   - chaves do aparelho (token, vista, aba, migrações) nunca viajam;
   - a última escrita de uma chave ganha;
   - ao aplicar dados remotos não se volta a enviar nada (sem eco);
   - se houver uma escrita local por enviar para a mesma chave, ela ganha
     até ser confirmada, para a UI não piscar para trás. */

window.WorkspaceSync = (() => {
    const PREFIXO = 'study-journal-';
    const K_REV = 'study-journal-workspace-rev';
    const K_LAST = 'study-journal-workspace-last-sync';
    const K_CLIENT = 'study-journal-client-id';
    const K_OUTBOX = 'study-journal-workspace-outbox';
    const DEBOUNCE_MS = 350;
    const POLL_MS = 15000;
    const LOTE_OPS = 200;
    const LOTE_BYTES = 6 * 1024 * 1024;

    const EXATAS_LOCAIS = new Set([
        'study-journal-device-id',
        'study-journal-seeded',
        'study-journal-sync-pendente',
        'study-journal-view',
        'study-journal-selected-date',
        'study-journal-selected-date-mode',
        'study-journal-sidebar-collapsed',
        'study-journal-sessions-migrado-v2',
        'study-journal-session-state',
        'study-journal-exames-tab',
        'study-journal-exames-topico-vista',
        'study-journal-semanal-dinamico-atual',
    ]);
    const PREFIXOS_LOCAIS = [
        'study-journal-conta-',
        'study-journal-github-',
        'study-journal-vault',
        'study-journal-core-',
        'study-journal-workspace-',
        'study-journal-client-',
    ];
    const SUFIXOS_LOCAIS = ['-enviados', '-enviadas', '-sync'];

    function chaveSincronizavel(chave) {
        if (typeof chave !== 'string' || !chave || chave.length > 200) return false;
        if (!chave.startsWith(PREFIXO)) return false;
        if (EXATAS_LOCAIS.has(chave)) return false;
        if (PREFIXOS_LOCAIS.some((p) => chave.startsWith(p))) return false;
        if (SUFIXOS_LOCAIS.some((s) => chave.endsWith(s))) return false;
        return true;
    }

    const proto = typeof Storage !== 'undefined' ? Storage.prototype : null;
    const setOriginal = proto ? proto.setItem : null;
    const removeOriginal = proto ? proto.removeItem : null;
    const getOriginal = proto ? proto.getItem : null;

    let ativo = false;
    let iniciado = false;
    let aSondar = false;
    let aPuxar = false;
    let aEnviar = false;
    let gravandoRemoto = false;
    let rev = 0;
    let clientId = '';
    let pendentes = new Map();
    let outbox = {};
    let timerEnvio = null;
    let timerPoll = null;
    let timerStorage = null;
    let sse = null;
    let sseTimer = null;
    let sseFalhas = 0;
    let timerSonda = null;
    const ouvintes = new Set();

    try {
        rev = Number(localStorage.getItem(K_REV)) || 0;
        clientId = localStorage.getItem(K_CLIENT) || '';
        if (!clientId) {
            clientId = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
            localStorage.setItem(K_CLIENT, clientId);
        }
        const guardado = JSON.parse(getOriginal.call(localStorage, K_OUTBOX) || '{}');
        if (guardado && typeof guardado === 'object' && !Array.isArray(guardado)) {
            for (const op of Object.values(guardado)) {
                if (!op || !chaveSincronizavel(op.key)) continue;
                if (op.deleted) pendentes.set(op.key, { key: op.key, deleted: true });
                else if (typeof op.value === 'string') pendentes.set(op.key, { key: op.key, value: op.value });
            }
            outbox = guardado;
        }
    } catch { /* sem storage: segue sem id */ }

    /* Fila persistente: uma escrita que não chegue ao servidor antes de
       fechar o separador é reenviada na próxima abertura. O servidor é
       idempotente (mesmo valor não cria revisão). */
    function guardarOutbox() {
        try {
            if (!Object.keys(outbox).length) removeOriginal.call(localStorage, K_OUTBOX);
            else setOriginal.call(localStorage, K_OUTBOX, JSON.stringify(outbox));
        } catch { /* quota cheia: a fila em memória continua */ }
    }

    function notificar(tipo, detalhes = {}) {
        ouvintes.forEach((cb) => {
            try { cb(tipo, detalhes); } catch { /* um ouvinte não parte o sync */ }
        });
        try {
            window.dispatchEvent(new CustomEvent('studyjournal:sync-estado', { detail: { tipo, ...detalhes } }));
        } catch { /* ambiente sem window */ }
    }

    function guardarRev(nova) {
        rev = Math.max(0, Number(nova) || 0);
        try {
            localStorage.setItem(K_REV, String(rev));
            localStorage.setItem(K_LAST, new Date().toISOString());
        } catch { /* quota cheia: a revisão volta no próximo pull */ }
    }

    function authHeaders() {
        try {
            return window.ContaSync?.requestHeaders?.() || {};
        } catch {
            return {};
        }
    }

    async function pedir(caminho, { method = 'GET', body = null, timeoutMs = 30000, keepalive = false } = {}) {
        const ctrl = new AbortController();
        const limite = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const resp = await fetch(caminho, {
                method,
                cache: 'no-store',
                keepalive: Boolean(keepalive),
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl.signal,
            });
            let data = null;
            try { data = await resp.json(); } catch { /* corpo vazio */ }
            return { status: resp.status, data };
        } finally {
            clearTimeout(limite);
        }
    }

    function lerLocal(chave) {
        try { return getOriginal.call(window.localStorage, chave); } catch { return null; }
    }

    function escreverLocal(chave, valor) {
        try { setOriginal.call(window.localStorage, chave, valor); return true; } catch { return false; }
    }

    function apagarLocal(chave) {
        try { removeOriginal.call(window.localStorage, chave); return true; } catch { return false; }
    }

    function registar(chave, valor) {
        if (gravandoRemoto || !chaveSincronizavel(chave)) return;
        if (typeof valor !== 'string') return;
        pendentes.delete(chave);
        pendentes.set(chave, { key: chave, value: valor });
        outbox[chave] = { key: chave, value: valor };
        guardarOutbox();
        agendarEnvio();
    }

    function registarApagar(chave) {
        if (gravandoRemoto || !chaveSincronizavel(chave)) return;
        pendentes.delete(chave);
        pendentes.set(chave, { key: chave, deleted: true });
        outbox[chave] = { key: chave, deleted: true };
        guardarOutbox();
        agendarEnvio();
    }

    if (proto && setOriginal && removeOriginal) {
        proto.setItem = function (chave, valor) {
            const controlar = this === window.localStorage && !gravandoRemoto && chaveSincronizavel(chave);
            let anterior = null;
            if (controlar) {
                try { anterior = getOriginal.call(this, chave); } catch { anterior = null; }
            }
            const resultado = setOriginal.call(this, chave, valor);
            // Só conta como alteração se o valor mudou de facto: a app
            // reescreve o mesmo dia muitas vezes (vault, timers) e sem
            // isto cada reescrita virava um POST.
            if (controlar && anterior !== String(valor)) registar(chave, String(valor));
            return resultado;
        };
        proto.removeItem = function (chave) {
            const controlar = this === window.localStorage && !gravandoRemoto && chaveSincronizavel(chave);
            let existia = false;
            if (controlar) {
                try { existia = getOriginal.call(this, chave) !== null; } catch { existia = false; }
            }
            const resultado = removeOriginal.call(this, chave);
            if (controlar && existia) registarApagar(chave);
            return resultado;
        };
    }

    function agendarEnvio() {
        if (!ativo) return;
        clearTimeout(timerEnvio);
        timerEnvio = setTimeout(() => { enviar().catch(() => {}); }, DEBOUNCE_MS);
    }

    function dividirLotes(ops) {
        const lotes = [];
        let atual = [];
        let bytes = 0;
        for (const op of ops) {
            const tamanho = op.value ? op.value.length + op.key.length + 40 : op.key.length + 40;
            if (atual.length && (atual.length >= LOTE_OPS || bytes + tamanho > LOTE_BYTES)) {
                lotes.push(atual);
                atual = [];
                bytes = 0;
            }
            atual.push(op);
            bytes += tamanho;
        }
        if (atual.length) lotes.push(atual);
        return lotes;
    }

    async function enviar() {
        if (!ativo || aEnviar || !pendentes.size) return;
        aEnviar = true;
        notificar('sync-start');
        const lote = [...pendentes.values()];
        const aoSair = typeof window !== 'undefined' && window.__sjASair === true;
        try {
            pendentes.clear();
            for (const ops of dividirLotes(lote)) {
                const { status, data } = await pedir('/api/workspace/ops', {
                    method: 'POST',
                    body: { ops, clientId },
                    keepalive: aoSair,
                });
                if (status !== 200 || !data || !data.ok) {
                    // Repõe o que falhou, sem passar por cima de escritas
                    // mais recentes que entretanto entraram na fila.
                    for (const op of ops) if (!pendentes.has(op.key)) pendentes.set(op.key, op);
                    notificar('sync-error', { error: data?.reason || `http-${status}` });
                    return;
                }
                // Confirmado: só sai da fila persistente se não houve
                // entretanto uma escrita mais nova para a mesma chave.
                for (const op of ops) {
                    if (pendentes.has(op.key)) continue;
                    const guardado = outbox[op.key];
                    if (!guardado) continue;
                    if (guardado.deleted === op.deleted && (op.deleted || guardado.value === op.value)) {
                        delete outbox[op.key];
                    }
                }
                guardarOutbox();
            }
            notificar('sync-done');
            // Puxa já para apanhar o que outros aparelhos escreveram
            // entretanto (o push não avança a revisão local).
            puxar().catch(() => {});
        } catch (error) {
            for (const op of lote) if (!pendentes.has(op.key)) pendentes.set(op.key, op);
            notificar('sync-error', { error: String(error?.message || error) });
        } finally {
            aEnviar = false;
            if (pendentes.size) agendarEnvio();
        }
    }

    /* Aplica chaves vindas do servidor ao cache local. Devolve true se
       alguma coisa mudou de facto (para não redesenhar sem necessidade). */
    function aplicar(chaves) {
        let alterou = false;
        gravandoRemoto = true;
        try {
            for (const item of chaves) {
                if (!item || !chaveSincronizavel(item.key)) continue;
                if (pendentes.has(item.key)) continue;
                const atual = lerLocal(item.key);
                if (item.deleted) {
                    if (atual !== null) alterou = apagarLocal(item.key) || alterou;
                    continue;
                }
                if (typeof item.value !== 'string') continue;
                if (atual !== item.value) alterou = escreverLocal(item.key, item.value) || alterou;
            }
        } finally {
            gravandoRemoto = false;
        }
        return alterou;
    }

    function avisarAtualizacao() {
        try { if (typeof window.recarregarAposSync === 'function') window.recarregarAposSync(); } catch { /* segue */ }
        const disparar = (nome, detalhe) => {
            try { window.dispatchEvent(new CustomEvent(nome, detalhe ? { detail: detalhe } : undefined)); } catch { /* segue */ }
        };
        disparar('studyjournal:pull');
        disparar('studyjournal:exames-sync');
        disparar('studyjournal:weekly-sync');
        try {
            const draft = lerLocal('study-journal-whiteboard-draft');
            if (typeof draft === 'string') {
                disparar('studyjournal:whiteboard-sync', {
                    content: draft,
                    updatedAt: Number(lerLocal('study-journal-whiteboard-draft-ts')) || 0,
                });
            }
            const grelha = lerLocal('study-journal-whiteboard-grid');
            if (grelha === 'true' || grelha === 'false') {
                disparar('studyjournal:whiteboard-grid-sync', { visible: grelha === 'true' });
            }
            const flutuante = lerLocal('study-journal-floating-note');
            if (typeof flutuante === 'string') {
                disparar('studyjournal:floating-note-sync', { data: JSON.parse(flutuante) });
            }
        } catch { /* dados auxiliares inválidos: segue */ }
    }

    async function puxar() {
        if (!ativo || aPuxar) return;
        aPuxar = true;
        try {
            const { status, data } = await pedir(`/api/workspace/changes?since=${rev}`);
            if (status !== 200 || !data || !data.ok) {
                notificar('sync-error', { error: data?.reason || `http-${status}` });
                return;
            }
            if (data.reset) {
                // O servidor recomeçou (base nova): repõe tudo a partir do
                // snapshot em vez de aplicar um delta impossível.
                await instantaneo();
                return;
            }
            const chaves = Array.isArray(data.keys) ? data.keys : [];
            const alterou = aplicar(chaves);
            const remoto = Number(data.revision) || rev;
            if (remoto > rev) guardarRev(remoto);
            if (alterou) avisarAtualizacao();
            notificar('sync-done', { alterou });
        } catch (error) {
            notificar('sync-error', { error: String(error?.message || error) });
        } finally {
            aPuxar = false;
        }
    }

    function chavesLocais() {
        const out = [];
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const chave = localStorage.key(i);
                if (chave && chaveSincronizavel(chave)) out.push(chave);
            }
        } catch { /* storage indisponível */ }
        return out;
    }

    async function instantaneo() {
        const { status, data } = await pedir('/api/workspace/snapshot');
        if (status !== 200 || !data || !data.ok) throw new Error(data?.reason || `http-${status}`);
        const chaves = Array.isArray(data.keys) ? data.keys : [];
        const servidor = new Map();
        for (const item of chaves) {
            if (item && typeof item.key === 'string' && !item.deleted) servidor.set(item.key, item.value);
        }
        const locais = chavesLocais();
        // Uma escrita local com carimbo mais recente do que o servidor
        // (aparelho que esteve offline ou com código antigo em cache) entra
        // antes de o snapshot a substituir. Sem carimbo, o servidor
        // prevalece: não se deixa um cache velho ganhar dados novos.
        for (const chave of locais) {
            if (!servidor.has(chave) || chave.endsWith('-ts') || pendentes.has(chave)) continue;
            const localTs = Number(lerLocal(`${chave}-ts`)) || 0;
            if (!localTs) continue;
            const remotoTs = Number(servidor.get(`${chave}-ts`)) || 0;
            if (localTs <= remotoTs) continue;
            const valor = lerLocal(chave);
            if (typeof valor !== 'string' || valor === servidor.get(chave)) continue;
            pendentes.set(chave, { key: chave, value: valor });
            outbox[chave] = { key: chave, value: valor };
            const ts = lerLocal(`${chave}-ts`);
            if (typeof ts === 'string') {
                pendentes.set(`${chave}-ts`, { key: `${chave}-ts`, value: ts });
                outbox[`${chave}-ts`] = { key: `${chave}-ts`, value: ts };
            }
        }
        aplicar(chaves);
        // Dados que só existem neste aparelho entram no workspace. Nunca
        // se reenvia uma chave que o servidor já tem: o servidor é a
        // fonte de verdade e pode ter a versão mais recente de outro
        // aparelho.
        for (const chave of locais) {
            if (servidor.has(chave) || pendentes.has(chave)) continue;
            const valor = lerLocal(chave);
            if (typeof valor === 'string') {
                pendentes.set(chave, { key: chave, value: valor });
                outbox[chave] = { key: chave, value: valor };
            }
        }
        if (Object.keys(outbox).length) guardarOutbox();
        guardarRev(Number(data.revision) || 0);
        if (pendentes.size) await enviar();
        avisarAtualizacao();
        notificar('sync-done', { snapshot: true });
    }

    function ciclo() {
        if (!ativo) return;
        if (pendentes.size) enviar().catch(() => {});
        else puxar().catch(() => {});
    }

    /* Envio best-effort ao fechar o separador. `keepalive` sobrevive ao
       unload; o limite do browser (~64 KB) cobre uma nota normal. */
    function flush() {
        if (!ativo || !pendentes.size) return false;
        const ops = [...pendentes.values()];
        let corpo;
        try { corpo = JSON.stringify({ ops, clientId }); } catch { return false; }
        if (corpo.length > 60000) return false;
        pendentes.clear();
        try {
            fetch('/api/workspace/ops', {
                method: 'POST',
                keepalive: true,
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: corpo,
            }).catch(() => { /* a próxima abertura reenvia */ });
            return true;
        } catch {
            for (const op of ops) if (!pendentes.has(op.key)) pendentes.set(op.key, op);
            return false;
        }
    }

    function pararSse() {
        clearTimeout(sseTimer);
        sseTimer = null;
        if (sse) {
            try { sse.close(); } catch { /* segue */ }
        }
        sse = null;
    }

    function ligarSse() {
        if (!ativo || typeof EventSource === 'undefined' || sse) return;
        const token = authHeaders().Authorization;
        const alvo = token
            ? `/api/workspace/events?token=${encodeURIComponent(token.replace(/^Bearer\s+/i, ''))}`
            : '/api/workspace/events';
        try {
            sse = new EventSource(alvo);
        } catch {
            sse = null;
            return;
        }
        sse.onopen = () => { sseFalhas = 0; };
        sse.onmessage = (ev) => {
            let dados = null;
            try { dados = JSON.parse(ev.data); } catch { return; }
            if (!dados || dados.type === 'hello') {
                if (dados && Number(dados.revision) > rev) puxar().catch(() => {});
                return;
            }
            if (Number(dados.revision) > rev) {
                clearTimeout(timerEnvio);
                timerEnvio = setTimeout(() => { puxar().catch(() => {}); }, 120);
            }
        };
        sse.onerror = () => {
            if (!sse || sse.readyState !== EventSource.CLOSED) return;
            sseFalhas += 1;
            pararSse();
            const espera = Math.min(60000, 3000 * sseFalhas);
            sseTimer = setTimeout(() => { if (ativo) ligarSse(); }, espera);
        };
    }

    function iniciarRelogio() {
        if (timerPoll) return;
        timerPoll = setInterval(ciclo, POLL_MS);
    }

    async function sondar() {
        if (aSondar) return ativo;
        aSondar = true;
        try {
            const { status, data } = await pedir('/api/workspace/estado', { timeoutMs: 15000 });
            if (status === 200 && data && data.ok) return true;
            return false;
        } catch {
            return false;
        } finally {
            aSondar = false;
        }
    }

    function agendarSonda() {
        if (timerSonda || ativo) return;
        clearTimeout(timerSonda);
        timerSonda = setTimeout(async () => {
            timerSonda = null;
            if (ativo) return;
            iniciado = false;
            const ok = await iniciar();
            if (!ok) agendarSonda();
        }, 15000);
    }

    async function iniciar() {
        if (iniciado) return ativo;
        iniciado = true;
        const ok = await sondar();
        if (!ok) {
            iniciado = false;
            // Servidor a acordar ou rede em baixo: volta a tentar sem
            // obrigar o utilizador a recarregar a página.
            agendarSonda();
            return false;
        }
        ativo = true;
        clearTimeout(timerSonda);
        timerSonda = null;
        // O workspace substitui o Gist e o documento antigo da conta: um
        // só motor de sync evita dois a disputar o mesmo estado.
        try { window.GitHubSync?.pararAutoSync?.(); } catch { /* segue */ }
        try { window.ContaSync?.pararAuto?.(); } catch { /* segue */ }
        try {
            await instantaneo();
        } catch (error) {
            notificar('sync-error', { error: String(error?.message || error) });
        }
        iniciarRelogio();
        ligarSse();
        return true;
    }

    /* Volta a tentar depois de um login (o token mudou). */
    async function reiniciar() {
        if (!ativo) {
            iniciado = false;
            return iniciar();
        }
        pararSse();
        ligarSse();
        puxar().catch(() => {});
        return true;
    }

    function parar() {
        ativo = false;
        iniciado = false;
        clearTimeout(timerEnvio);
        clearTimeout(timerSonda);
        timerSonda = null;
        clearInterval(timerPoll);
        timerPoll = null;
        pararSse();
    }

    function ativoAgora() {
        return ativo;
    }

    function estado() {
        return {
            ativo,
            revision: rev,
            pendentes: pendentes.size,
            clientId,
            ultimo: (() => { try { return localStorage.getItem(K_LAST); } catch { return null; } })(),
        };
    }

    function onSync(cb) {
        ouvintes.add(cb);
        return () => ouvintes.delete(cb);
    }

    if (typeof window !== 'undefined') {
        const acordar = () => {
            if (ativo) { ligarSse(); ciclo(); }
            else { iniciado = false; iniciar().catch(() => {}); }
        };
        window.addEventListener('online', acordar);
        window.addEventListener('focus', acordar);
        window.addEventListener('storage', (evento) => {
            // Outro separador do mesmo browser escreveu: atualiza a UI
            // daqui (o push é feito pelo separador que escreveu).
            if (!evento || !evento.key || !chaveSincronizavel(evento.key)) return;
            clearTimeout(timerStorage);
            timerStorage = setTimeout(() => { avisarAtualizacao(); }, 250);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') acordar();
        });
    }

    return {
        iniciar,
        reiniciar,
        parar,
        ativo: ativoAgora,
        estado,
        puxar,
        enviar,
        flush,
        onSync,
        chaveSincronizavel,
    };
})();

/* Arranca cedo, antes de a UI começar a ler o cache local. O `iniciar`
   resolve sozinho se o servidor está em modo link ou se há sessão. */
if (typeof window !== 'undefined') {
    const arrancar = () => { window.WorkspaceSync.iniciar().catch(() => {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar, { once: true });
    else arrancar();
}
