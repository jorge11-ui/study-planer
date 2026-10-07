/* StudyJournal — Colar (Ctrl+V) ou largar imagens nas notas.
   A imagem comprime-se (lado máx. 1280px, JPEG) e insere-se como
   markdown `![nome](data:...)` na posição do cursor; o preview mostra-a.
   Vai com o texto para o vault e o Obsidian sem precisar do servidor. */

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

    function proximoNome(area) {
        const n = (area.value.match(/!\[/g) || []).length + 1;
        return `imagem-${n}`;
    }

    function inserir(area, dataURL, nome) {
        const bloco = `![${nome}](${dataURL})`;
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
                inserir(area, dataURL, proximoNome(area));
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

    return { ligar };
})();
