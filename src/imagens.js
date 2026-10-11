/* StudyJournal — Colar (Ctrl+V) ou largar imagens nas notas.
   A imagem comprime-se (lado máx. 1280px, JPEG) e guarda-se em IndexedDB;
   nas notas fica só um token curto `![nome](sjimg:id)` — o editor nunca
   mostra os endereços gigantes. Os bytes sobem para /api/ficheiros para
   o outro aparelho os ir buscar; no vault (Obsidian) gravam-se dataURLs
   expandidos para continuarem visíveis fora do site. */

window.Imagens = (() => {
    const LADO_MAX = 1280;
    const QUALIDADE = 0.8;
    const QUALIDADE_BAIXA = 0.65;
    const LIMITE_AVISO = 800000; // ~800KB de dataURL

    const ehImagem = (f) => {
        if (!f) return false;
        if (f.type && f.type.startsWith('image/')) return true;
        return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name || '');
    };

    function lerOriginal(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => reject(new Error('ler'));
            r.readAsDataURL(file);
        });
    }

    function comprimir(file) {
        // GIF pequeno e SVG mantêm-se originais (animação / vetor).
        if ((file.type === 'image/gif' && file.size < 800 * 1024)
            || (file.type === 'image/svg+xml' && file.size < 500 * 1024)) {
            return lerOriginal(file);
        }
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * escala));
                    const h = Math.max(1, Math.round(img.height * escala));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    let out = canvas.toDataURL('image/jpeg', QUALIDADE);
                    if (out.length > LIMITE_AVISO) out = canvas.toDataURL('image/jpeg', QUALIDADE_BAIXA);
                    resolve(out);
                } catch (e) {
                    reject(e);
                } finally {
                    URL.revokeObjectURL(url);
                }
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem')); };
            img.src = url;
        });
    }

    /* ── Bytes: IndexedDB + servidor ──────────────────── */

    const BASE_IDB = 'study-journal-imagens';
    const LOJA_IDB = 'blobs';
    const FICHEIROS_MAX_BYTES = 30 * 1024 * 1024;

    let dbPromise = null;

    function abrirIdb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const pedido = indexedDB.open(BASE_IDB, 1);
            pedido.onupgradeneeded = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains(LOJA_IDB)) db.createObjectStore(LOJA_IDB);
            };
            pedido.onsuccess = () => resolve(pedido.result);
            pedido.onerror = () => reject(pedido.error);
        });
        return dbPromise;
    }

    async function comLoja(modo, run) {
        const db = await abrirIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(LOJA_IDB, modo);
            const pedido = run(tx.objectStore(LOJA_IDB));
            tx.oncomplete = () => resolve(pedido ? pedido.result : undefined);
            tx.onerror = () => reject(tx.error);
        });
    }

    const guardarBlob = (id, blob) => comLoja('readwrite', (loja) => loja.put(blob, id));
    const lerBlob = (id) => comLoja('readonly', (loja) => loja.get(id));

    const novoIdImg = () => `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const dataURLParaBlob = async (dataURL) => {
        const resp = await fetch(dataURL);
        return resp.blob();
    };

    const blobParaDataURL = (blob) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || ''));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
    });

    async function enviarImagem(id, blob, nome) {
        if (!blob || blob.size > FICHEIROS_MAX_BYTES) return false;
        try {
            const dados = await blobParaDataURL(blob);
            const b64 = String(dados.split(',')[1] || '');
            if (!b64) return false;
            const resp = await fetch('/api/ficheiros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, nome: nome || `${id}.jpg`, tipo: blob.type || 'image/jpeg', dados: b64 }),
            });
            if (!resp.ok) return false;
            const r = await resp.json().catch(() => null);
            return !!(r && r.ok);
        } catch {
            return false;
        }
    }

    async function blobDe(id) {
        try {
            const local = await lerBlob(id);
            if (local) return local;
        } catch { /* segue para o servidor */ }
        try {
            const resp = await fetch(`/api/ficheiros/${encodeURIComponent(id)}`);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (!blob || !blob.size) return null;
            try {
                await guardarBlob(id, blob);
            } catch { /* só leitura */ }
            return blob;
        } catch {
            return null;
        }
    }

    const urls = new Map();

    /* Preenche os <img data-sjimg> de um preview com os bytes locais/remotos. */
    async function hidratar(raiz) {
        if (!raiz || !raiz.querySelectorAll) return;
        const imgs = [...raiz.querySelectorAll('img[data-sjimg]')].filter((el) => !el.src);
        for (const el of imgs) {
            const id = el.getAttribute('data-sjimg');
            if (!id) continue;
            if (urls.has(id)) {
                el.src = urls.get(id);
                continue;
            }
            const blob = await blobDe(id);
            if (!blob) continue;
            if (!el.isConnected) continue;
            const url = URL.createObjectURL(blob);
            urls.set(id, url);
            el.src = url;
        }
    }

    /* Editor → vault/Obsidian: troca tokens por dataURLs reais. */
    async function expandirParaVault(texto) {
        const ids = [...new Set([...String(texto || '').matchAll(/!\[([^\]]*)\]\(sjimg:([A-Za-z0-9_-]+)\)/g)].map((m) => m[2]))];
        if (!ids.length) return String(texto || '');
        const dataURLs = {};
        for (const id of ids) {
            const blob = await blobDe(id);
            if (!blob) continue;
            try {
                dataURLs[id] = await blobParaDataURL(blob);
            } catch { /* mantém o token */ }
        }
        return String(texto || '').replace(/!\[([^\]]*)\]\(sjimg:([A-Za-z0-9_-]+)\)/g, (m, alt, id) => (
            dataURLs[id] ? `![${alt}](${dataURLs[id]})` : m
        ));
    }

    /* Vault/antigo → editor: dataURLs gigantes viram tokens curtos (e os
       bytes ficam guardados + tentam subir para o servidor). */
    async function colapsarEmbutidas(texto) {
        const found = [...String(texto || '').matchAll(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g)];
        if (!found.length) return { texto: String(texto || ''), mudou: false };
        let out = String(texto || '');
        let mudou = false;
        for (const m of found) {
            try {
                const blob = await dataURLParaBlob(m[2]);
                if (!blob || !blob.size) continue;
                const id = novoIdImg();
                try {
                    await guardarBlob(id, blob);
                } catch { continue; }
                enviarImagem(id, blob, `${m[1] || 'imagem'}.jpg`).catch(() => {});
                out = out.replace(m[0], `![${m[1]}](sjimg:${id})`);
                mudou = true;
            } catch { /* mantém o bloco original */ }
        }
        return { texto: out, mudou };
    }

    function proximoNome(area) {
        const n = (area.value.match(/!\[/g) || []).length + 1;
        return `imagem-${n}`;
    }

    function inserir(area, id, nome) {
        const bloco = `![${nome}](sjimg:${id})`;
        const { selectionStart: ini, selectionEnd: fim, value } = area;
        const antes = value.slice(0, ini).replace(/\s+$/, '');
        const depois = value.slice(fim).replace(/^\s+/, '');
        const meio = `${antes}${antes ? '\n\n' : ''}${bloco}${depois ? '\n\n' : ''}`;
        area.value = `${meio}${depois}`;
        area.focus();
        area.setSelectionRange(meio.length, meio.length);
        area.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function colarFicheiros(area, files) {
        let inseridas = 0;
        for (const file of files) {
            try {
                const dataURL = await comprimir(file);
                if (dataURL.length > LIMITE_AVISO) {
                    toast('Imagem grande: a nota vai ficar pesada.', 'warn');
                }
                const blob = await dataURLParaBlob(dataURL);
                const id = novoIdImg();
                const nome = proximoNome(area);
                try {
                    await guardarBlob(id, blob);
                } catch {
                    toast('Não foi possível guardar a imagem no browser.', 'error');
                    continue;
                }
                enviarImagem(id, blob, `${nome}.jpg`).catch(() => {});
                inserir(area, id, nome);
                inseridas += 1;
            } catch {
                toast('Não foi possível ler a imagem.', 'error');
            }
        }
        if (inseridas > 0) {
            toast(inseridas === 1 ? 'Imagem inserida nas notas.' : `${inseridas} imagens inseridas nas notas.`, 'success');
            const vista = document.getElementById('notes-preview');
            if (vista && vista.hidden) {
                document.getElementById('notes-preview-toggle')?.click();
            }
        }
    }

    function imagensDe(dt) {
        if (!dt) return [];
        const lista = [];
        if (dt.files) {
            for (const f of dt.files) if (ehImagem(f)) lista.push(f);
        }
        if (!lista.length && dt.items) {
            for (const item of dt.items) {
                if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (ehImagem(f)) lista.push(f);
                }
            }
        }
        return lista;
    }

    function ligar() {
        const area = document.getElementById('journal-text');
        if (!area || area.dataset.imagensBound) return;
        area.dataset.imagensBound = '1';

        area.addEventListener('paste', (e) => {
            const imgs = imagensDe(e.clipboardData);
            if (!imgs.length) return; // texto normal segue o caminho habitual
            e.preventDefault();
            colarFicheiros(area, imgs);
        });

        area.addEventListener('drop', (e) => {
            if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
            e.preventDefault(); // nunca navegar para o ficheiro largado
            const imgs = imagensDe(e.dataTransfer);
            if (imgs.length) colarFicheiros(area, imgs);
        });

        area.addEventListener('dragover', (e) => {
            if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
    }

    return { ligar, hidratar, expandirParaVault, colapsarEmbutidas, blobDe };
})();
