/* Acesso ao vault do Obsidian.
   Dois caminhos:
     - local  — File System Access API, o comportamento original. Vale
                quando o browser corre nesta máquina e já escolheu a pasta.
     - remoto — API do serve.js. É o que serve os outros aparelhos, que
                nunca conseguem alcançar a pasta do laptop pelo browser.
     - fila   — servidor inacessível: a gravação fica em localStorage e
                segue para o vault quando o servidor voltar.
   O browser guarda o handle e a "shadow" em IndexedDB; a shadow serve
   de base para detetar edições feitas fora do app. */

window.Vault = (() => {
    const DB_NAME = 'study-journal';
    const DB_VERSION = 1;
    const FOLDER = 'Diario';
    const MODE = { mode: 'readwrite' };
    const API = '/api/vault';
    const PENDING_KEY = 'study-journal-vault-pending';
    const PROBE_TTL = 15000;

    let dbPromise = null;
    let probe = null;   // 'ok' | 'sem-vault' | 'offline'
    let probeAt = 0;
    let flushing = false;

    function openDb() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
                if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return dbPromise;
    }

    async function tx(store, mode, run) {
        const db = await openDb();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(store, mode);
            const request = run(transaction.objectStore(store));

            transaction.oncomplete = () => resolve(request ? request.result : undefined);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }

    const getHandle = () => tx('handles', 'readonly', (s) => s.get('vault')).catch(() => null);
    const putHandle = (handle) => tx('handles', 'readwrite', (s) => s.put(handle, 'vault'));
    const delHandle = () => tx('handles', 'readwrite', (s) => s.delete('vault'));

    const getShadow = (key) => tx('files', 'readonly', (s) => s.get(key)).catch(() => null);
    const putShadow = (key, record) => tx('files', 'readwrite', (s) => s.put(record, key));

    function supported() {
        return window.isSecureContext && 'showDirectoryPicker' in window;
    }

    /* ── Fila de pendências ─────────────────────────────── */

    function getPending() {
        try {
            const list = JSON.parse(localStorage.getItem(PENDING_KEY));
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    function setPending(list) {
        try {
            if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
            else localStorage.removeItem(PENDING_KEY);
        } catch {
            /* sem localStorage ou sem espaço: a fila perde-se, mas não parte o site */
        }
    }

    function pendingCount() {
        return getPending().length;
    }

    /* Último por ficheiro vence; a ordem de envio fica a dos timestamps. */
    function enqueue(name, content) {
        const list = getPending().filter((item) => item.name !== name);
        list.push({ name, content, ts: Date.now() });
        list.sort((a, b) => a.ts - b.ts);
        setPending(list);
    }

    async function flushPending() {
        const list = getPending();
        if (!list.length || flushing) return 0;

        if ((await resolveProbe(true)) !== 'ok') return 0;

        flushing = true;
        const rest = [];
        let sent = 0;

        try {
            for (const item of list) {
                try {
                    const response = await fetch(`${API}/file`, {
                        method: 'PUT',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: item.name, content: item.content }),
                    });

                    const data = response.ok ? await response.json() : null;
                    if (!data || !data.ok) {
                        rest.push(item);
                        continue;
                    }

                    await putShadow(item.name, { content: item.content, savedAt: Date.now() });
                    sent += 1;
                } catch {
                    /* rede caiu a meio: o resto espera para a próxima */
                    rest.push(item);
                    break;
                }
            }
        } finally {
            flushing = false;
        }

        setPending(rest);
        if (sent) probe = 'ok', probeAt = Date.now();
        return sent;
    }

    /* ── Servidor ───────────────────────────────────────── */

    async function probeServer() {
        let response;

        try {
            response = await fetch(API, { cache: 'no-store' });
        } catch {
            return 'offline';
        }

        try {
            const data = await response.json();
            return data.ok ? 'ok' : 'sem-vault';
        } catch {
            return 'offline';
        }
    }

    async function resolveProbe(force = false) {
        if (!force && probe && Date.now() - probeAt < PROBE_TTL) return probe;
        probe = await probeServer();
        probeAt = Date.now();
        return probe;
    }

    async function remoteRead(name) {
        const response = await fetch(`${API}/file?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.ok || !data.existe) return null;
        return data.content;
    }

    /* Com handle local, o caminho original manda — é o que já está a
       funcionar no laptop e não pede permissão outra vez. */
    async function localHandle() {
        if (!supported()) return null;
        const handle = await getHandle();
        return handle ?? null;
    }

    /* ── Estado ─────────────────────────────────────────── */

    // 'desligado' | 'permissao' | 'ligado' | 'pendente' | 'incompativel'
    async function status() {
        const handle = await localHandle();

        if (handle) {
            const permission = await handle.queryPermission(MODE);
            if (permission === 'granted') {
                if (pendingCount()) flushPending();
                return 'ligado';
            }
            return 'permissao';
        }

        const remote = await resolveProbe();
        if (remote === 'ok') {
            if (pendingCount()) flushPending();
            return 'ligado';
        }

        if (remote === 'offline' && !supported()) return 'pendente';
        if (supported()) return 'desligado';
        return 'incompativel';
    }

    async function connect() {
        const handle = await localHandle();
        if (handle) return { ok: true };

        if (supported()) {
            try {
                const picked = await window.showDirectoryPicker({
                    id: 'study-journal-vault',
                    startIn: 'documents',
                    ...MODE,
                });

                await putHandle(picked);
                await picked.getDirectoryHandle(FOLDER, { create: true });
                return { ok: true };
            } catch (error) {
                if (error.name === 'AbortError') return { ok: false, reason: 'cancelado' };
                return { ok: false, reason: 'erro', error };
            }
        }

        if ((await resolveProbe(true)) === 'ok') return { ok: true };
        return { ok: false, reason: 'incompativel' };
    }

    async function requestPermission() {
        const handle = await localHandle();
        if (!handle) return { ok: false, reason: 'desligado' };

        try {
            const permission = await handle.requestPermission(MODE);
            return { ok: permission === 'granted' };
        } catch (error) {
            return { ok: false, reason: 'erro', error };
        }
    }

    async function disconnect() {
        await delHandle();
        probe = null;
        probeAt = 0;
    }

    /* ── Leitura ────────────────────────────────────────── */

    async function readFile(root, name) {
        try {
            const handle = await root.getFileHandle(name);
            return (await handle.getFile()).text();
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }

    async function writeFile(root, name, content) {
        const handle = await root.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    /* ── Escrita ────────────────────────────────────────── */

    async function saveLocal(handle, name, content, force) {
        try {
            const folder = await handle.getDirectoryHandle(FOLDER, { create: true });
            const current = await readFile(folder, name);
            const shadow = await getShadow(name);

            const mudou = current !== null && shadow && current !== shadow.content;
            if (mudou && !force) {
                return { ok: false, reason: 'conflito', name, path: `${FOLDER}/${name}`, current };
            }

            await writeFile(folder, name, content);
            await putShadow(name, { content, savedAt: Date.now() });

            return { ok: true, path: `${FOLDER}/${name}` };
        } catch (error) {
            return { ok: false, reason: 'erro', error };
        }
    }

    async function saveRemote(name, content, force) {
        let current;

        try {
            current = await remoteRead(name);
        } catch (error) {
            if (error && error.name === 'TypeError') {
                enqueue(name, content);
                return { ok: true, path: `${FOLDER}/${name}`, pendente: true };
            }
            return { ok: false, reason: 'erro', error };
        }

        const shadow = await getShadow(name);
        const mudou = current !== null && shadow && current !== shadow.content;
        if (mudou && !force) {
            return { ok: false, reason: 'conflito', name, path: `${FOLDER}/${name}`, current };
        }

        let response;
        try {
            response = await fetch(`${API}/file`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name, content }),
            });
        } catch (error) {
            enqueue(name, content);
            return { ok: true, path: `${FOLDER}/${name}`, pendente: true };
        }

        if (!response.ok) return { ok: false, reason: 'erro', error: new Error(`HTTP ${response.status}`) };

        const data = await response.json();
        if (!data.ok) return { ok: false, reason: 'erro', error: new Error(data.reason ?? 'gravar') };

        await putShadow(name, { content, savedAt: Date.now() });
        return { ok: true, path: data.path ?? `${FOLDER}/${name}` };
    }

    /* Grava <name> dentro de Diario/.
       Devolve:
         { ok: true, path }
         { ok: true, path, pendente: true }   servidor inacessível, na fila
         { ok: false, reason: 'conflito'|'permissao'|'desligado'|'incompativel'|'erro', ... } */
    async function save(name, content, { force = false } = {}) {
        const handle = await localHandle();
        if (handle) return saveLocal(handle, name, content, force);

        const remote = await resolveProbe();
        if (remote === 'ok') return saveRemote(name, content, force);

        if (remote === 'offline' && !supported()) {
            enqueue(name, content);
            return { ok: true, path: `${FOLDER}/${name}`, pendente: true };
        }

        if (supported()) return { ok: false, reason: 'desligado' };
        return { ok: false, reason: 'incompativel' };
    }

    async function load(name) {
        const handle = await localHandle();

        if (handle) {
            try {
                const folder = await handle.getDirectoryHandle(FOLDER);
                const current = await readFile(folder, name);
                if (current === null) return { ok: true, existe: false };

                const shadow = await getShadow(name);
                return {
                    ok: true,
                    existe: true,
                    content: current,
                    mudou: !shadow || current !== shadow.content,
                    conhecido: Boolean(shadow),
                };
            } catch (error) {
                if (error.name === 'NotFoundError') return { ok: true, existe: false };
                return { ok: false, reason: 'erro', error };
            }
        }

        try {
            const content = await remoteRead(name);
            if (content === null) return { ok: true, existe: false };

            const shadow = await getShadow(name);
            return {
                ok: true,
                existe: true,
                content,
                mudou: !shadow || content !== shadow.content,
                conhecido: Boolean(shadow),
            };
        } catch (error) {
            return { ok: false, reason: 'offline', error };
        }
    }

    /* Regista `content` como última versão conhecida, sem tocar no ficheiro.
       Usa-se depois de importar uma versão do Obsidian, para a gravação
       seguinte não reportar um conflito que já foi resolvido. */
    async function mark(name, content) {
        try {
            await putShadow(name, { content, savedAt: Date.now() });
            return true;
        } catch {
            return false;
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => { flushPending(); });
    }

    return {
        FOLDER,
        supported,
        status,
        connect,
        requestPermission,
        disconnect,
        save,
        load,
        mark,
        pendingCount,
        flushPending,
    };
})();
