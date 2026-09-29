/* Acesso ao vault do Obsidian via File System Access API.
   O browser guarda o handle em IndexedDB; o conteúdo que escrevemos
   serve de "shadow" para detetar edições feitas fora do app. */

const Vault = (() => {
    const DB_NAME = 'study-journal';
    const DB_VERSION = 1;
    const FOLDER = 'Diario';
    const MODE = { mode: 'readwrite' };

    let dbPromise = null;

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

    // 'desligado' | 'permissao' | 'ligado' | 'incompativel'
    async function status() {
        if (!supported()) return 'incompativel';

        const handle = await getHandle();
        if (!handle) return 'desligado';

        const permission = await handle.queryPermission(MODE);
        return permission === 'granted' ? 'ligado' : 'permissao';
    }

    // Só pode ser chamado a partir de um clique (exigência da API).
    async function connect() {
        if (!supported()) return { ok: false, reason: 'incompativel' };

        try {
            const handle = await window.showDirectoryPicker({
                id: 'study-journal-vault',
                startIn: 'documents',
                ...MODE,
            });

            await putHandle(handle);
            await getFolder(handle);
            return { ok: true };
        } catch (error) {
            if (error.name === 'AbortError') return { ok: false, reason: 'cancelado' };
            return { ok: false, reason: 'erro', error };
        }
    }

    async function requestPermission() {
        const handle = await getHandle();
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
    }

    async function getFolder(root) {
        return root.getDirectoryHandle(FOLDER, { create: true });
    }

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

    /* Grava <name> dentro de Diario/.
       Devolve:
         { ok: true, path }
         { ok: false, reason: 'conflito'|'permissao'|'desligado'|'incompativel'|'erro', ... } */
    async function save(name, content, { force = false } = {}) {
        if (!supported()) return { ok: false, reason: 'incompativel' };

        const handle = await getHandle();
        if (!handle) return { ok: false, reason: 'desligado' };

        if ((await handle.queryPermission(MODE)) !== 'granted') {
            return { ok: false, reason: 'permissao' };
        }

        try {
            const folder = await getFolder(handle);
            const current = await readFile(folder, name);
            const shadow = await getShadow(name);

            const mudou = current !== null && shadow && current !== shadow.content;
            if (mudou && !force) {
                return { ok: false, reason: 'conflito', path: `${FOLDER}/${name}`, current };
            }

            await writeFile(folder, name, content);
            await putShadow(name, { content, savedAt: Date.now() });

            return { ok: true, path: `${FOLDER}/${name}` };
        } catch (error) {
            return { ok: false, reason: 'erro', error };
        }
    }

    return { FOLDER, supported, status, connect, requestPermission, disconnect, save };
})();
