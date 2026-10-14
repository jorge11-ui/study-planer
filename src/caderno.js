/* Galeria do Caderno: fotos das páginas do caderno físico.
   - Metadados em localStorage + sync (união por id + tombstones, como PDFs).
   - Bytes em IndexedDB + /api/ficheiros (ids `c_…`), com backfill que
     verifica a presença no servidor (cura após wipes).
   Cada foto liga-se a um dia + disciplina. */

window.Caderno = (() => {
    const CHAVE = 'study-journal-caderno';
    const BASE_IDB = 'study-journal-caderno';
    const LOJA_IDB = 'fotos';
    const CHAVE_ENVIADOS = 'study-journal-caderno-enviados';
    const CHAVE_APAGADOS = 'study-journal-caderno-apagados';
    const APAGADO_MS = 30 * 24 * 60 * 60 * 1000;
    const FICHEIROS_MAX_BYTES = 30 * 1024 * 1024;
    const LADO_MAX = 1280;

    let fotos = [];
    let filtroDisciplina = 'todas';
    let urls = new Map();

    /* ── IndexedDB ──────────────────────────────────── */

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

    const guardarFoto = (id, blob) => comLoja('readwrite', (loja) => loja.put(blob, id));
    const lerFoto = (id) => comLoja('readonly', (loja) => loja.get(id));
    const apagarFoto = (id) => comLoja('readwrite', (loja) => loja.delete(id));

    /* ── Enviados + apagados ────────────────────────── */

    const lerEnviados = () => {
        try {
            const v = JSON.parse(localStorage.getItem(CHAVE_ENVIADOS) || '[]');
            return new Set(Array.isArray(v) ? v : []);
        } catch {
            return new Set();
        }
    };

    const guardarEnviados = (set) => {
        try {
            localStorage.setItem(CHAVE_ENVIADOS, JSON.stringify([...set]));
        } catch { /* segue */ }
    };

    function registarApagados(ids) {
        let lista = [];
        try {
            const v = JSON.parse(localStorage.getItem(CHAVE_APAGADOS) || '[]');
            if (Array.isArray(v)) lista = v.filter((e) => e && typeof e.id === 'string');
        } catch { lista = []; }
        const agora = Date.now();
        const vistos = new Set(lista.map((e) => e.id));
        ids.forEach((id) => {
            if (!vistos.has(id)) {
                lista.push({ id, ts: agora });
                vistos.add(id);
            }
        });
        lista = lista.filter((e) => agora - Number(e.ts || 0) < APAGADO_MS).slice(-200);
        try {
            localStorage.setItem(CHAVE_APAGADOS, JSON.stringify(lista));
        } catch { /* segue */ }
        if (typeof pushDebounced === 'function') pushDebounced();
    }

    /* ── Compressão (fotos do telemóvel vêm enormes) ─── */

    function comprimir(file) {
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
                    resolve(canvas.toDataURL('image/jpeg', 0.82));
                } catch (e) {
                    reject(e);
                } finally {
                    URL.revokeObjectURL(url);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('imagem'));
            };
            img.src = url;
        });
    }

    const dataURLParaBlob = async (dataURL) => {
        const resp = await fetch(dataURL);
        return resp.blob();
    };

    const blobParaBase64 = (blob) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
    });

    async function enviarFoto(foto, blob) {
        if (!blob || blob.size > FICHEIROS_MAX_BYTES) return false;
        try {
            const dados = await blobParaBase64(blob);
            if (!dados) return false;
            const resp = await fetch('/api/ficheiros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: foto.id,
                    nome: foto.titulo ? `${foto.titulo}.jpg` : 'foto.jpg',
                    tipo: blob.type || 'image/jpeg',
                    dados,
                }),
            });
            if (!resp.ok) return false;
            const r = await resp.json().catch(() => null);
            return !!(r && r.ok);
        } catch {
            return false;
        }
    }

    async function buscarRemota(foto) {
        try {
            const resp = await fetch(`/api/ficheiros/${encodeURIComponent(foto.id)}`);
            if (!resp.ok) {
                if (resp.status === 404) {
                    const enviados = lerEnviados();
                    if (enviados.delete(foto.id)) guardarEnviados(enviados);
                }
                return null;
            }
            const blob = await resp.blob();
            if (!blob || !blob.size) return null;
            try {
                await guardarFoto(foto.id, blob);
            } catch { /* só leitura */ }
            const enviados = lerEnviados();
            enviados.add(foto.id);
            guardarEnviados(enviados);
            return blob;
        } catch {
            return null;
        }
    }

    async function apagarRemota(id) {
        try {
            await fetch(`/api/ficheiros/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch { /* best-effort */ }
        const enviados = lerEnviados();
        if (enviados.delete(id)) guardarEnviados(enviados);
    }

    /* ── Metadados ──────────────────────────────────── */

    function ler() {
        try {
            const bruto = localStorage.getItem(CHAVE);
            const dados = bruto === null ? [] : JSON.parse(bruto);
            return Array.isArray(dados) ? dados.filter((d) => d && d.id) : [];
        } catch {
            return [];
        }
    }

    function guardar() {
        try {
            localStorage.setItem(CHAVE, JSON.stringify(fotos));
        } catch { /* segue */ }
        desenhar();
        if (typeof pushDebounced === 'function') pushDebounced();
    }

    function normalizarEntrada(bruta) {
        const dia = typeof bruta.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bruta.dia) ? bruta.dia : '';
        const data = typeof bruta.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bruta.data) ? bruta.data : dia;
        return {
            id: String(bruta.id),
            titulo: String(bruta.titulo || 'Foto').trim() || 'Foto',
            dia,
            disciplina: String(bruta.disciplina || 'Geral').trim() || 'Geral',
            data,
            tamanho: Number(bruta.tamanho) || 0,
            transcricao: typeof bruta.transcricao === 'string' ? bruta.transcricao : '',
            transcritoEm: Number(bruta.transcritoEm) || 0,
            transcritoPor: typeof bruta.transcritoPor === 'string' ? bruta.transcritoPor : '',
        };
    }

    const porId = (id) => fotos.find((f) => f.id === id);

    async function urlDe(foto) {
        if (urls.has(foto.id)) return urls.get(foto.id);
        let blob = null;
        try {
            blob = await lerFoto(foto.id);
        } catch { blob = null; }
        if (!blob) blob = await buscarRemota(foto);
        const url = blob ? URL.createObjectURL(blob) : '';
        urls.set(foto.id, url);
        return url;
    }

    function libertarUrls() {
        for (const url of urls.values()) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        }
        urls = new Map();
    }

    /* ── Cartões ────────────────────────────────────── */

    const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    function dataLegivel(iso) {
        if (!iso) return 'Sem dia';
        const d = new Date(`${iso}T00:00:00`);
        if (Number.isNaN(d.getTime())) return 'Sem dia';
        return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function tamanhoLegivel(bytes) {
        const b = Number(bytes) || 0;
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    }

    function montarCard(foto) {
        const li = document.createElement('li');
        li.className = 'pdf-card';

        const previa = document.createElement('div');
        previa.className = 'pdf-card-preview';
        previa.style.minHeight = '10rem';
        previa.style.display = 'grid';
        previa.style.placeItems = 'center';
        const img = document.createElement('img');
        img.dataset.fotoId = foto.id;
        img.alt = foto.titulo;
        img.className = 'h-40 w-full rounded-lg object-cover';
        img.loading = 'lazy';
        previa.append(img);

        const corpo = document.createElement('div');
        corpo.className = 'pdf-card-body';

        const titulo = document.createElement('p');
        titulo.className = 'pdf-card-title';
        titulo.title = foto.titulo;
        titulo.textContent = foto.titulo;
        corpo.append(titulo);

        const meta = document.createElement('div');
        meta.className = 'pdf-card-meta';
        const dia = document.createElement('time');
        if (foto.dia) dia.dateTime = foto.dia;
        dia.textContent = dataLegivel(foto.dia);
        meta.append(dia);
        if (foto.tamanho) {
            const tam = document.createElement('span');
            tam.textContent = `· ${tamanhoLegivel(foto.tamanho)}`;
            meta.append(tam);
        }
        if (foto.disciplina) {
            const cat = document.createElement('span');
            cat.className = 'pdf-card-category';
            cat.textContent = foto.disciplina;
            meta.append(cat);
        }
        if (foto.transcricao) {
            const tr = document.createElement('span');
            tr.className = 'pdf-card-category';
            tr.textContent = 'transcrita';
            tr.title = 'Esta foto já foi passada a texto';
            meta.append(tr);
        }
        corpo.append(meta);

        if (foto.transcricao) {
            const det = document.createElement('details');
            det.className = 'rounded-lg border border-line-soft bg-surface-2 px-2 py-1 text-xs text-muted';
            const sum = document.createElement('summary');
            sum.className = 'cursor-pointer font-medium';
            sum.textContent = 'Ver transcrição';
            const p = document.createElement('p');
            p.className = 'mt-1 whitespace-pre-wrap leading-relaxed';
            p.textContent = foto.transcricao;
            det.append(sum, p);
            corpo.append(det);
        }

        const accoes = document.createElement('div');
        accoes.className = 'pdf-card-actions';

        const ver = document.createElement('button');
        ver.type = 'button';
        ver.className = 'pdf-action pdf-action-primary';
        ver.dataset.cadernoOpen = foto.id;
        ver.append(icone('i-eye'), textoBotao('Ver'));

        const baixar = document.createElement('a');
        baixar.className = 'pdf-action pdf-action-secondary';
        baixar.dataset.cadernoDownload = foto.id;
        baixar.href = '#';
        baixar.download = `${foto.titulo}.jpg`;
        baixar.append(icone('i-download'), textoBotao('Descarregar'));

        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'pdf-action pdf-action-danger';
        remover.dataset.cadernoRemove = foto.id;
        remover.title = `Remover: ${foto.titulo}`;
        remover.setAttribute('aria-label', `Remover foto: ${foto.titulo}`);
        remover.append(icone('i-trash'));

        const transcrever = document.createElement('button');
        transcrever.type = 'button';
        transcrever.className = 'pdf-action pdf-action-secondary';
        transcrever.dataset.cadernoTranscrever = foto.id;
        transcrever.title = foto.transcricao ? 'Passar a texto outra vez' : 'Passar a foto a texto (LLM local)';
        transcrever.append(icone('i-file-text'), textoBotao(foto.transcricao ? 'De novo' : 'Transcrever'));

        accoes.append(ver, baixar, transcrever, remover);
        corpo.append(accoes);
        li.append(previa, corpo);
        return li;
    }

    function icone(nome) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon pdf-action-icon');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#${nome}`);
        svg.append(use);
        return svg;
    }

    function textoBotao(texto) {
        const span = document.createElement('span');
        span.textContent = texto;
        return span;
    }

    async function hidratarMiniaturas(raiz) {
        const imgs = [...raiz.querySelectorAll('img[data-foto-id]')];
        for (const el of imgs) {
            const foto = porId(el.dataset.fotoId);
            if (!foto) continue;
            const url = await urlDe(foto);
            if (!url || !el.isConnected) continue;
            el.src = url;
        }
    }

    /* ── Filtros e desenho ──────────────────────────── */

    function disciplinas() {
        const mapa = new Map();
        for (const f of fotos) {
            if (!f.disciplina) continue;
            const chave = normalizar(f.disciplina);
            if (!mapa.has(chave)) mapa.set(chave, f.disciplina);
        }
        return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
    }

    function desenhar() {
        const grelha = document.getElementById('caderno-grid');
        if (!grelha) return;
        const filtradas = fotos.filter((f) => filtroDisciplina === 'todas' || normalizar(f.disciplina) === filtroDisciplina);
        grelha.replaceChildren(...filtradas.map(montarCard));
        hidratarMiniaturas(grelha).catch(() => {});

        const contagem = document.getElementById('caderno-count');
        if (contagem) contagem.textContent = `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}`;

        const vazio = document.getElementById('caderno-empty');
        if (vazio) vazio.hidden = fotos.length > 0;

        const filtros = document.getElementById('caderno-filters');
        if (filtros) {
            if (filtroDisciplina !== 'todas' && !disciplinas().some(([chave]) => chave === filtroDisciplina)) {
                filtroDisciplina = 'todas';
            }
            filtros.replaceChildren(
                botaoFiltro('todas', 'Todas'),
                ...disciplinas().map(([chave, nome]) => botaoFiltro(chave, nome)),
            );
        }

        const stats = document.getElementById('caderno-stats');
        if (stats) {
            stats.replaceChildren();
            if (fotos.length > 0) {
                const totalBytes = fotos.reduce((a, f) => a + (Number(f.tamanho) || 0), 0);
                const tr = fotos.filter((f) => f.transcricao).length;
                [`${filtradas.length} a mostrar`, tamanhoLegivel(totalBytes), tr ? `${tr} transcritas` : '']
                    .filter(Boolean)
                    .forEach((t, i) => {
                        const s = document.createElement('span');
                        s.textContent = t;
                        if (i === 0) s.className = 'font-medium text-muted';
                        stats.append(s);
                    });
            }
        }
        const estado = document.getElementById('caderno-status');
        if (estado) estado.textContent = fotos.length > 0 ? '' : '';
    }

    function botaoFiltro(chave, nome) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'pdf-filter';
        botao.textContent = nome;
        botao.setAttribute('aria-pressed', String(chave === filtroDisciplina));
        botao.addEventListener('click', () => {
            filtroDisciplina = chave;
            desenhar();
        });
        return botao;
    }

    /* ── Visualizador ───────────────────────────────── */

    const dialogo = () => document.getElementById('caderno-viewer');

    async function abrir(id) {
        const foto = porId(id);
        if (!foto) return;
        const url = await urlDe(foto);
        if (!url) {
            toast('Esta foto ainda só existe no outro aparelho.', 'error');
            return;
        }
        document.getElementById('caderno-viewer-title').textContent = foto.titulo;
        const img = document.getElementById('caderno-viewer-img');
        img.src = url;
        img.alt = foto.titulo;
        const dl = document.getElementById('caderno-viewer-download');
        dl.href = url;
        dl.download = `${foto.titulo}.jpg`;
        dialogo().showModal();
    }

    function fechar() {
        const dlg = dialogo();
        if (!dlg) return;
        if (dlg.open) dlg.close();
        const img = document.getElementById('caderno-viewer-img');
        if (img) img.removeAttribute('src');
    }

    async function descarregar(id) {
        const foto = porId(id);
        if (!foto) return;
        const url = await urlDe(foto);
        if (!url) {
            toast('Esta foto ainda só existe no outro aparelho.', 'error');
            return;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = `${foto.titulo}.jpg`;
        document.body.append(a);
        a.click();
        a.remove();
    }

    /* Passa a foto a texto com o modelo de visão local (Ollama). O texto
       fica guardado na foto (cache: nunca repete o vision para a mesma). */
    async function transcrever(id, botao) {
        const foto = porId(id);
        if (!foto) return;
        if (botao) {
            botao.disabled = true;
            botao.classList.add('opacity-50');
        }
        try {
            const est = await fetch('/api/llm/estado', { cache: 'no-store' })
                .then((r) => r.json().catch(() => null)).catch(() => null);
            if (!est || !est.ok || !est.ollama) {
                toast('LLM local indisponível. Liga o Ollama no portátil e usa o servidor local.', 'error');
                return;
            }
            const modelos = Array.isArray(est.modelos) ? est.modelos : [];
            const visao = modelos.find((m) => /vl|vision|llava|minicpm/i.test(m));
            const resp = await fetch('/api/llm/transcrever', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...(visao ? { modelo: visao } : {}) }),
            });
            const r = await resp.json().catch(() => null);
            if (!resp.ok || !r || !r.ok) {
                if (r && r.reason === 'sem-modelo') {
                    toast(`Falta o modelo de visão (${r.modelo}). ${r.dica || ''}`, 'error');
                } else if (r && r.reason === 'ausente') {
                    toast('Os bytes desta foto não estão neste servidor.', 'error');
                } else {
                    toast('Não foi possível transcrever agora.', 'error');
                }
                return;
            }
            foto.transcricao = String(r.texto || '').trim();
            foto.transcritoEm = Date.now();
            foto.transcritoPor = String(r.modelo || '');
            guardar();
            toast('Foto transcrita e guardada.', 'success');
        } finally {
            if (botao) {
                botao.disabled = false;
                botao.classList.remove('opacity-50');
            }
        }
    }

    async function apagar(id) {
        const foto = porId(id);
        if (!foto) return;
        if (!confirm(`Remover “${foto.titulo}” do caderno?`)) return;
        const url = urls.get(id);
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        urls.delete(id);
        try {
            await apagarFoto(id);
        } catch { /* segue */ }
        await apagarRemota(id);
        registarApagados([id]);
        fotos = fotos.filter((f) => f.id !== id);
        guardar();
        toast(`“${foto.titulo}” removida.`, 'success');
    }

    /* ── Adicionar ──────────────────────────────────── */

    const hojeISO = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const novoId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    async function adicionarFicheiros(files) {
        const diaEl = document.getElementById('caderno-dia');
        const discEl = document.getElementById('caderno-disciplina');
        const dia = diaEl && /^\d{4}-\d{2}-\d{2}$/.test(diaEl.value) ? diaEl.value : hojeISO();
        const disciplina = discEl ? discEl.value : 'Geral';
        const validos = [...files].filter((f) => (f.type && f.type.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name || ''));
        if (!validos.length) {
            toast('Escolhe pelo menos uma imagem.', 'warn');
            return;
        }
        let n = 0;
        for (const file of validos) {
            try {
                const dataURL = await comprimir(file);
                const blob = await dataURLParaBlob(dataURL);
                if (!blob || !blob.size) continue;
                const id = novoId();
                try {
                    await guardarFoto(id, blob);
                } catch {
                    toast('Não foi possível guardar a foto no browser.', 'error');
                    continue;
                }
                const jaNoDia = fotos.filter((f) => f.dia === dia).length;
                const entrada = {
                    id,
                    titulo: `Foto ${dia} (${jaNoDia + 1})`,
                    dia,
                    disciplina,
                    data: hojeISO(),
                    tamanho: blob.size,
                    transcricao: '',
                    transcritoEm: 0,
                    transcritoPor: '',
                };
                enviarFoto(entrada, blob).then((ok) => {
                    if (!ok) return;
                    const enviados = lerEnviados();
                    enviados.add(id);
                    guardarEnviados(enviados);
                }).catch(() => {});
                fotos.push(entrada);
                n += 1;
            } catch {
                toast(`Não foi possível ler “${file.name || 'imagem'}” (HEIC de iPhone pode falhar: passa a JPEG).`, 'error');
            }
        }
        fotos.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : a.titulo.localeCompare(b.titulo, 'pt')));
        guardar();
        if (n > 0) toast(n === 1 ? 'Foto adicionada ao caderno.' : `${n} fotos adicionadas ao caderno.`, 'success');
    }

    /* ── Eventos ────────────────────────────────────── */

    function ligar() {
        const diaEl = document.getElementById('caderno-dia');
        if (diaEl && !diaEl.value) diaEl.value = hojeISO();

        const addBtn = document.getElementById('caderno-add');
        const fileEl = document.getElementById('caderno-ficheiro');
        if (addBtn && fileEl && !addBtn.dataset.cadernoBound) {
            addBtn.dataset.cadernoBound = '1';
            // No telemóvel, pedir a câmara diretamente.
            try {
                if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) {
                    fileEl.setAttribute('capture', 'environment');
                }
            } catch { /* segue sem capture */ }
            addBtn.addEventListener('click', () => fileEl.click());
            fileEl.addEventListener('change', () => {
                if (fileEl.files && fileEl.files.length) adicionarFicheiros(fileEl.files);
                fileEl.value = '';
            });
        }

        const grelha = document.getElementById('caderno-grid');
        if (grelha && !grelha.dataset.cadernoBound) {
            grelha.dataset.cadernoBound = 'true';
            grelha.addEventListener('click', async (evento) => {
                const abrirBotao = evento.target.closest('[data-caderno-open]');
                const removerBotao = evento.target.closest('[data-caderno-remove]');
                const transcreverBotao = evento.target.closest('[data-caderno-transcrever]');
                if (abrirBotao) abrir(abrirBotao.dataset.cadernoOpen);
                else if (removerBotao) apagar(removerBotao.dataset.cadernoRemove);
                else if (transcreverBotao) transcrever(transcreverBotao.dataset.cadernoTranscrever, transcreverBotao);
            });
            grelha.addEventListener('click', (evento) => {
                const link = evento.target.closest('[data-caderno-download]');
                if (!link) return;
                evento.preventDefault();
                descarregar(link.dataset.cadernoDownload);
            });
        }

        const visor = dialogo();
        if (visor && !visor.dataset.cadernoBound) {
            visor.dataset.cadernoBound = 'true';
            visor.addEventListener('click', (evento) => {
                if (evento.target.closest('#caderno-viewer-close') || evento.target === visor) fechar();
            });
        }

        desenhar();
    }

    function carregar() {
        fotos = ler().map(normalizarEntrada).sort((a, b) => (
            a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : a.titulo.localeCompare(b.titulo, 'pt')
        ));
        ligar();
        backfill();
    }

    /* Repõe no servidor as fotos que ele não tem (cura após wipe). */
    async function backfill() {
        const enviados = lerEnviados();
        let presentes = null;
        try {
            const resp = await fetch('/api/ficheiros', { cache: 'no-store' });
            const r = await resp.json().catch(() => null);
            if (r && r.ok && Array.isArray(r.ficheiros)) {
                presentes = new Set(r.ficheiros.map((f) => f && f.id).filter(Boolean));
            }
        } catch { /* sem lista: usa só o registo */ }
        let mudou = false;
        for (const foto of fotos) {
            if (presentes ? presentes.has(foto.id) : enviados.has(foto.id)) {
                if (!enviados.has(foto.id)) {
                    enviados.add(foto.id);
                    mudou = true;
                }
                continue;
            }
            let blob = null;
            try {
                blob = await lerFoto(foto.id);
            } catch { blob = null; }
            if (!blob || blob.size > FICHEIROS_MAX_BYTES) continue;
            if (await enviarFoto(foto, blob)) {
                enviados.add(foto.id);
                mudou = true;
            }
        }
        if (mudou) guardarEnviados(enviados);
    }

    return { carregar, ligar, listar: () => fotos, abrir, apagar };
})();
