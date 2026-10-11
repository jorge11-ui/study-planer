/* Galeria de PDFs.
   - Metadados em JSON: localStorage + espelho no vault (Diario/pdfs.json).
   - Os bytes dos PDFs ficam em IndexedDB, porque o vault só escreve texto
     e assim o botão funciona mesmo sem a pasta ligada. */

window.Pdfs = (() => {
    const CHAVE = 'study-journal-pdfs';
    const FICHEIRO_VAULT = 'pdfs.json';
    // Base separada da do vault (que já existe na versão 1 com outras stores).
    const BASE_IDB = 'study-journal-pdfs';
    const LOJA_IDB = 'ficheiros';

    const TEXTOS = {
        documentos: '{total} documentos',
        aMostrar: 'A mostrar {shown} de {total}',
        nenhum: 'Nenhum PDF corresponde a “{termo}”.',
        todos: 'Todos',
        semCategoria: 'Sem categoria',
        ver: 'Visualizar',
        baixar: 'Descarregar',
        remover: 'Remover',
        link: 'Link',
        semData: 'Sem data',
        dentroDe: 'aponta para {titulo}',
    };

    let docs = [];
    let filtroActivo = 'todos';
    let termos = '';
    let urls = new Map();
    let docAberto = null;

    /* ── IndexedDB: os bytes dos PDFs ───────────────────── */

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

    const guardarFicheiro = (id, blob) => comLoja('readwrite', (loja) => loja.put(blob, id));
    const lerFicheiro = (id) => comLoja('readonly', (loja) => loja.get(id));
    const apagarFicheiro = (id) => comLoja('readwrite', (loja) => loja.delete(id));

    /* ── Sync dos bytes via servidor ───────────────────────
       Metadados vão no vault (pdfs.json); os bytes vêm para
       /api/ficheiros para o outro aparelho os ir buscar. */

    const CHAVE_ENVIADOS = 'study-journal-pdfs-enviados';
    const FICHEIROS_MAX_BYTES = 30 * 1024 * 1024;

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
        } catch { /* segue sem registar */ }
    };

    const blobParaBase64 = (blob) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
    });

    async function enviarFicheiro(doc, blob) {
        if (!blob || blob.size > FICHEIROS_MAX_BYTES) return false;
        try {
            const dados = await blobParaBase64(blob);
            if (!dados) return false;
            const resp = await fetch('/api/ficheiros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: doc.id,
                    nome: doc.ficheiro || doc.titulo || 'ficheiro.pdf',
                    tipo: blob.type || 'application/pdf',
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

    async function buscarFicheiroRemoto(doc) {
        try {
            const resp = await fetch(`/api/ficheiros/${encodeURIComponent(doc.id)}`);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            if (!blob || !blob.size) return null;
            await guardarFicheiro(doc.id, blob);
            const enviados = lerEnviados();
            enviados.add(doc.id);
            guardarEnviados(enviados);
            return blob;
        } catch {
            return null;
        }
    }

    async function apagarFicheiroRemoto(id) {
        try {
            await fetch(`/api/ficheiros/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch { /* best-effort */ }
        const enviados = lerEnviados();
        if (enviados.delete(id)) guardarEnviados(enviados);
    }

    /* ── Metadados ──────────────────────────────────────── */

    function ler() {
        try {
            const bruto = localStorage.getItem(CHAVE);
            const dados = bruto === null ? [] : JSON.parse(bruto);
            return Array.isArray(dados) ? dados.filter((d) => d && d.id && d.titulo) : [];
        } catch {
            return [];
        }
    }

    function guardarLocais() {
        try {
            localStorage.setItem(CHAVE, JSON.stringify(docs));
            return true;
        } catch {
            return false;
        }
    }

    /* O vault é o espelho em disco: tenta-se sempre gravar — o Vault.save
       decide se vai por handle local, API remota ou recusa (sem vault). */
    async function guardar() {
        guardarLocais();
        desenhar();
        if (typeof pushDebounced === 'function') pushDebounced();

        if (!window.Vault) return;

        let resultado = null;
        try {
            resultado = await Vault.save(FICHEIRO_VAULT, JSON.stringify(docs, null, 2));
        } catch {
            return;
        }

        if (!resultado || resultado.ok) return;
        if (resultado.reason === 'conflito') {
            toast('O pdfs.json mudou no vault. Nada foi sobrescrito.', 'warn');
        }
    }

    /* ── Textos auxiliares ──────────────────────────────── */

    const normalizar = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const tamanhoLegivel = (bytes) => {
        const b = Number(bytes) || 0;
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    };

    function dataLegivel(iso) {
        if (!iso) return TEXTOS.semData;
        const d = new Date(`${iso}T00:00:00`);
        if (Number.isNaN(d.getTime())) return TEXTOS.semData;

        return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    const hoje = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const novoId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    /* ── Normalização ───────────────────────────────────── */

    function ordenar(lista) {
        return lista.slice().sort((a, b) => {
            if (a.data && b.data) return a.data < b.data ? 1 : a.data > b.data ? -1 : a.titulo.localeCompare(b.titulo, 'pt');
            if (a.data) return -1;
            if (b.data) return 1;
            return a.titulo.localeCompare(b.titulo, 'pt');
        });
    }

    function normalizarEntrada(bruta) {
        const data = typeof bruta.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bruta.data) ? bruta.data : '';
        const base = {
            id: String(bruta.id),
            titulo: String(bruta.titulo).trim(),
            categoria: String(bruta.categoria || '').trim(),
            data,
        };

        if (bruta.tipo === 'link') {
            if (bruta.alvo) return { ...base, tipo: 'link', alvo: String(bruta.alvo) };
            return { ...base, tipo: 'link', url: String(bruta.url || '').trim() };
        }

        return { ...base, tipo: 'ficheiro', ficheiro: String(bruta.ficheiro || base.titulo), tamanho: Number(bruta.tamanho) || 0 };
    }

    /* Um link interno só faz sentido se apontar para algo que ainda existe. */
    function sanear() {
        const validos = new Set(docs.filter((d) => d.tipo === 'ficheiro' || d.url).map((d) => d.id));
        const vistos = new Set();

        docs = docs.filter((doc) => {
            if (doc.tipo === 'link' && doc.alvo && !validos.has(doc.alvo)) return false;
            if (vistos.has(doc.id)) return false;
            vistos.add(doc.id);
            return true;
        });
    }

    const porId = (id) => docs.find((d) => d.id === id);

    /* O URL de visualização: blob do IndexedDB, cópia do servidor,
       link remoto ou o alvo interno (por esta ordem). */
    async function urlDe(doc) {
        if (urls.has(doc.id)) return urls.get(doc.id);

        let url = '';

        if (doc.tipo === 'link') {
            if (doc.alvo) {
                const alvo = porId(doc.alvo);
                url = alvo ? await urlDe(alvo) : '';
            } else {
                url = doc.url;
            }
        } else {
            let blob = null;
            try {
                blob = await lerFicheiro(doc.id);
            } catch { blob = null; }
            if (!blob) blob = await buscarFicheiroRemoto(doc);
            if (blob) url = URL.createObjectURL(blob);
        }

        urls.set(doc.id, url);
        return url;
    }

    function libertarUrls() {
        for (const url of urls.values()) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        }
        urls = new Map();
    }

    /* ── Cartões ────────────────────────────────────────── */

    function montarCard(doc) {
        const li = document.createElement('li');
        li.className = 'pdf-card';
        li.dataset.pdfId = doc.id;
        li.dataset.pdfCategory = normalizar(doc.categoria);
        li.dataset.pdfKind = doc.tipo;
        li.dataset.pdfText = normalizar([
            doc.titulo,
            doc.categoria,
            doc.tipo === 'link' && doc.alvo ? (porId(doc.alvo)?.titulo || '') : '',
        ].join(' '));

        const previa = document.createElement('div');
        previa.className = 'pdf-card-preview';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon pdf-card-icon');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', doc.tipo === 'link' ? '#i-external' : '#i-file-text');
        svg.append(use);
        previa.append(svg);

        const formato = document.createElement('span');
        formato.className = 'pdf-card-format';
        formato.textContent = doc.tipo === 'link' ? TEXTOS.link : 'PDF';
        previa.append(formato);

        const corpo = document.createElement('div');
        corpo.className = 'pdf-card-body';

        const titulo = document.createElement('p');
        titulo.className = 'pdf-card-title';
        titulo.title = doc.titulo;
        titulo.textContent = doc.titulo;
        corpo.append(titulo);

        const meta = document.createElement('div');
        meta.className = 'pdf-card-meta';

        const data = document.createElement('time');
        data.className = 'pdf-card-date';
        if (doc.data) data.dateTime = doc.data;
        data.textContent = dataLegivel(doc.data);
        meta.append(data);

        if (doc.tipo === 'ficheiro' && doc.tamanho) {
            const tamanho = document.createElement('span');
            tamanho.className = 'pdf-card-size';
            tamanho.textContent = `· ${tamanhoLegivel(doc.tamanho)}`;
            meta.append(tamanho);
        }

        if (doc.tipo === 'link' && doc.alvo) {
            const aponta = document.createElement('span');
            aponta.className = 'pdf-card-target';
            aponta.textContent = `· ${TEXTOS.dentroDe.replace('{titulo}', porId(doc.alvo)?.titulo || '?')}`;
            meta.append(aponta);
        }

        if (doc.categoria) {
            const categoria = document.createElement('span');
            categoria.className = 'pdf-card-category';
            categoria.textContent = doc.categoria;
            meta.append(categoria);
        }

        corpo.append(meta);

        const accoes = document.createElement('div');
        accoes.className = 'pdf-card-actions';

        const ver = document.createElement('button');
        ver.type = 'button';
        ver.className = 'pdf-action pdf-action-primary';
        ver.dataset.pdfOpen = doc.id;
        ver.append(icone('i-eye'), textoBotao(TEXTOS.ver));

        const baixar = document.createElement('a');
        baixar.className = 'pdf-action pdf-action-secondary';
        baixar.dataset.pdfDownload = doc.id;
        baixar.href = '#';
        baixar.download = doc.tipo === 'ficheiro' ? doc.ficheiro : '';
        baixar.append(icone('i-download'), textoBotao(TEXTOS.baixar));

        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'pdf-action pdf-action-danger';
        remover.dataset.pdfRemove = doc.id;
        remover.title = TEXTOS.remover;
        remover.setAttribute('aria-label', `${TEXTOS.remover}: ${doc.titulo}`);
        remover.append(icone('i-trash'));

        accoes.append(ver, baixar, remover);
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

    /* ── Filtros e desenho ──────────────────────────────── */

    function categorias() {
        const mapa = new Map();

        for (const doc of docs) {
            if (!doc.categoria) continue;
            const chave = normalizar(doc.categoria);
            if (!mapa.has(chave)) mapa.set(chave, doc.categoria);
        }

        return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
    }

    function aplicar() {
        const grelha = document.getElementById('pdf-grid');
        if (!grelha) return;

        let mostrados = 0;

        for (const card of grelha.querySelectorAll('.pdf-card')) {
            const combina = card.dataset.pdfText.includes(termos)
                && (filtroActivo === 'todos' || card.dataset.pdfCategory === filtroActivo);
            card.hidden = !combina;
            if (combina) mostrados += 1;
        }

        const vazio = document.getElementById('pdf-empty');
        const semResultados = document.getElementById('pdf-no-results');
        const estado = document.getElementById('pdf-status');

        if (vazio) vazio.hidden = docs.length > 0;
        if (semResultados) {
            semResultados.hidden = !(mostrados === 0 && docs.length > 0);
            semResultados.textContent = TEXTOS.nenhum.replace('{termo}', termos);
        }
        if (estado) {
            estado.textContent = docs.length > 0
                ? TEXTOS.aMostrar.replace('{shown}', String(mostrados)).replace('{total}', String(docs.length))
                : '';
        }

        const filtros = document.getElementById('pdf-filters');
        if (filtros) {
            filtros.querySelectorAll('[data-pdf-filter]').forEach((botao) => {
                botao.setAttribute('aria-pressed', String(botao.dataset.pdfFilter === filtroActivo));
            });
        }
    }

    function desenhar() {
        const grelha = document.getElementById('pdf-grid');
        const contagem = document.getElementById('pdf-count');
        const filtros = document.getElementById('pdf-filters');
        if (!grelha) return;

        grelha.replaceChildren(...docs.map(montarCard));

        if (contagem) contagem.textContent = TEXTOS.documentos.replace('{total}', String(docs.length));

        const stats = document.getElementById('pdf-stats');
        if (stats) {
            stats.replaceChildren();
            if (docs.length > 0) {
                const totalBytes = docs.reduce((a, d) => a + (Number(d.tamanho) || 0), 0);
                const porCat = new Map();
                for (const d of docs) {
                    const nome = (d.categoria || '').trim() || TEXTOS.semCategoria;
                    porCat.set(nome, (porCat.get(nome) || 0) + 1);
                }
                const partes = [
                    `${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'}`,
                    tamanhoLegivel(totalBytes),
                    ...[...porCat.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([nome, n]) => `${nome} (${n})`),
                ];
                partes.forEach((t, i) => {
                    const s = document.createElement('span');
                    s.textContent = t;
                    if (i === 0) s.className = 'font-medium text-muted';
                    stats.append(s);
                });
            }
        }

        if (filtros) {
            const lista = categorias();

            // Um filtro que já não existe volta a "Todos".
            if (filtroActivo !== 'todos' && !lista.some(([chave]) => chave === filtroActivo)) filtroActivo = 'todos';

            filtros.hidden = docs.length === 0;
            filtros.replaceChildren(
                ...[botaoFiltro('todos', TEXTOS.todos), ...lista.map(([chave, nome]) => botaoFiltro(chave, nome))],
            );
        }

        desenharOpcoes();
        aplicar();
    }

    function botaoFiltro(chave, nome) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'pdf-filter';
        botao.dataset.pdfFilter = chave;
        botao.textContent = nome;
        return botao;
    }

    /* ── Visualizador ───────────────────────────────────── */

    const dialogo = () => document.getElementById('pdf-viewer');
    const frame = () => document.getElementById('pdf-viewer-frame');

    async function abrir(id) {
        const doc = porId(id);
        if (!doc) return;

        docAberto = doc;
        const campoTexto = document.getElementById('pdf-cite-text');
        if (campoTexto) campoTexto.value = '';
        const campoPagina = document.getElementById('pdf-cite-page');
        if (campoPagina) campoPagina.value = '';

        const url = await urlDe(doc);
        if (!url) {
            toast('Este ficheiro ainda só existe no outro aparelho.', 'error');
            return;
        }

        // No telemóvel o iframe não renderiza PDFs de forma fiável:
        // abre em aba nova (gesto direto; com fallback para o diálogo).
        try {
            const telemovel = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
            if (telemovel) {
                const nova = window.open(url, '_blank', 'noopener');
                if (nova) return;
            }
        } catch { /* segue para o diálogo */ }

        mostrarNoDialogo(doc, url);
    }

    function mostrarNoDialogo(doc, url) {
        aplicarMax(false);
        document.getElementById('pdf-viewer-title').textContent = doc.titulo;
        const link = document.getElementById('pdf-viewer-link');
        link.href = url;
        link.classList.toggle('hidden', doc.tipo === 'ficheiro');
        frame().src = `${url}#view=FitH`;
        dialogo().showModal();
        focarVisor();
    }

    /* O foco tem de ficar no diálogo, senão as teclas vão parar ao PDF.
       O visualizador nativo rouba-o ao carregar, por isso se insiste
       algumas vezes e só durante meio segundo. */
    function focarVisor(tentativa = 0) {
        const fecharBotao = document.getElementById('pdf-viewer-close');
        if (fecharBotao) fecharBotao.focus({ preventScroll: true });

        if (tentativa < 6 && document.activeElement === frame()) {
            setTimeout(() => focarVisor(tentativa + 1), 80);
        }
    }

    function fechar() {
        const dlg = dialogo();
        docAberto = null;
        if (!dlg.open) {
            frame().src = 'about:blank';
            return;
        }
        aplicarMax(false);
        dlg.close();
    }

    /* Citações e resumos: o visor nativo não permite sublinhar, por isso
       cola-se aqui o trecho e ele segue formatado para as Notas do Dia. */
    function guardarCitacao(tipo) {
        const campo = document.getElementById('pdf-cite-text');
        const texto = (campo?.value || '').trim();
        if (!texto) {
            toast('Escreve ou cola primeiro a citação.', 'warn');
            campo?.focus();
            return;
        }

        const pagina = (document.getElementById('pdf-cite-page')?.value || '').trim();
        const titulo = docAberto?.titulo || 'PDF';
        const data = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
        const onde = pagina ? `, p. ${pagina}` : '';

        const md = tipo === 'resumo'
            ? `**Resumo — ${titulo}${onde} (${data}):** ${texto.replace(/\s+/g, ' ')}`
            : `> ${texto.replace(/\n/g, '\n> ')}\n> — ${titulo}${onde} (${data})`;

        const ok = window.StudyJournal && typeof window.StudyJournal.adicionarANotas === 'function'
            ? window.StudyJournal.adicionarANotas(md)
            : false;

        if (ok) {
            campo.value = '';
            toast(tipo === 'resumo' ? 'Resumo guardado nas Notas do Dia.' : 'Citação guardada nas Notas do Dia.', 'success');
        } else {
            toast('Não foi possível guardar nas notas.', 'error');
        }
    }

    /* Ecrã inteiro: pede-se o nativo e, em paralelo, aplica-se a classe
       que dá o aspeto máximo. Se a API for recusada, continua a funcionar. */
    function aplicarMax(valor) {
        const dlg = dialogo();
        if (!dlg) return;

        dlg.classList.toggle('pdf-viewer-max', valor);

        const botao = document.getElementById('pdf-viewer-full');
        if (botao) {
            botao.setAttribute('aria-pressed', String(valor));
            botao.setAttribute('aria-label', valor ? 'Sair do ecrã inteiro' : 'Ecrã inteiro');
            botao.title = valor ? 'Sair do ecrã inteiro (F)' : 'Ecrã inteiro (F)';
            botao.querySelector('use').setAttribute('href', valor ? '#i-collapse' : '#i-expand');
        }
    }

    function alternarMax() {
        const dlg = dialogo();
        if (!dlg) return;

        const alvo = !dlg.classList.contains('pdf-viewer-max');
        aplicarMax(alvo);

        if (alvo && dlg.requestFullscreen) dlg.requestFullscreen().catch(() => {});
        else if (!alvo && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }

    async function descarregar(id) {
        const doc = porId(id);
        if (!doc) return;

        if (doc.tipo === 'link') {
            window.open(doc.url, '_blank', 'noopener');
            return;
        }

        const url = await urlDe(doc);
        if (!url) {
            toast('Este ficheiro ainda só existe no outro aparelho.', 'error');
            return;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = doc.ficheiro;
        document.body.append(a);
        a.click();
        a.remove();
    }

    async function apagar(id) {
        const doc = porId(id);
        if (!doc) return;
        if (!confirm(`Remover “${doc.titulo}” da galeria?`)) return;

        // Links que apontam para este documento deixavam de resolver.
        const dependentes = docs.filter((d) => d.tipo === 'link' && d.alvo === id);
        if (dependentes.length > 0
            && !confirm(`${dependentes.length} link(s) apontam para este PDF. Remover também?`)) {
            return;
        }

        const doomed = new Set([id, ...dependentes.map((d) => d.id)]);

        for (const alvo of doomed) {
            const url = urls.get(alvo);
            if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
            urls.delete(alvo);
            await apagarFicheiro(alvo).catch(() => {});
            await apagarFicheiroRemoto(alvo);
        }

        docs = docs.filter((d) => !doomed.has(d.id));
        await guardar();
        toast(`“${doc.titulo}” removido.`, 'success');
    }

    /* ── Adicionar ──────────────────────────────────────── */

    const form = () => document.getElementById('pdf-form');

    function opcoes() {
        return docs.filter((d) => d.tipo === 'ficheiro' || d.url);
    }

    function desenharOpcoes() {
        const lista = document.getElementById('pdf-target');
        const datalist = document.getElementById('pdf-categorias');

        if (datalist) {
            datalist.replaceChildren();
            for (const [, nome] of categorias()) {
                const opcao = document.createElement('option');
                opcao.value = nome;
                datalist.append(opcao);
            }
        }

        if (!lista) return;

        const anterior = lista.value;
        lista.replaceChildren();

        for (const doc of ordenar(opcoes())) {
            const opcao = document.createElement('option');
            opcao.value = doc.id;
            opcao.textContent = doc.titulo;
            lista.append(opcao);
        }

        if ([...lista.options].some((o) => o.value === anterior)) lista.value = anterior;
    }

    function mostrarCampo(tipo) {
        const ficheiro = document.getElementById('pdf-campo-ficheiro');
        const remoto = document.getElementById('pdf-campo-remoto');
        const interno = document.getElementById('pdf-campo-interno');
        const alvoInterno = document.getElementById('pdf-interno').checked;

        if (ficheiro) ficheiro.hidden = tipo !== 'ficheiro';
        if (remoto) remoto.hidden = tipo !== 'link' || alvoInterno;
        if (interno) interno.hidden = tipo !== 'link';
    }

    function limparFormulario() {
        const dlg = form();
        dlg.querySelector('form').reset();
        dlg.querySelector('#pdf-data').value = hoje();
        desenharOpcoes();
        mostrarCampo('ficheiro');
        dlg.querySelectorAll('[data-pdf-tipo]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.pdfTipo === 'ficheiro'));
        });
    }

    function abrirFormulario(tipo = 'ficheiro') {
        limparFormulario();
        const botao = form().querySelector(`[data-pdf-tipo="${tipo}"]`);
        if (botao) botao.click();
        form().showModal();
        const primeiro = form().querySelector('input:not([type=radio]):not([type=file])');
        if (primeiro) primeiro.focus();
    }

    function tituloSugerido(nome) {
        return nome
            .replace(/\.pdf$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async function guardarEntrada() {
        const dlg = form();
        const tipo = dlg.querySelector('[data-pdf-tipo][aria-pressed="true"]').dataset.pdfTipo;
        const tituloCampo = dlg.querySelector('#pdf-titulo');
        const dataCampo = dlg.querySelector('#pdf-data');
        const categoriaCampo = dlg.querySelector('#pdf-categoria');
        const titulo = tituloCampo.value.trim();
        const data = dataCampo.value;
        const categoria = categoriaCampo.value.trim();

        if (!titulo) {
            tituloCampo.focus();
            toast('Dá um título ao documento.', 'warn');
            return;
        }

        const base = { titulo, categoria, data };
        const entradas = [];

        if (tipo === 'ficheiro') {
            const ficheiros = [...dlg.querySelector('#pdf-ficheiro').files]
                .filter((f) => /\.pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));

            if (ficheiros.length === 0) {
                toast('Escolhe pelo menos um ficheiro PDF.', 'warn');
                return;
            }

            ficheiros.forEach((ficheiro) => {
                entradas.push({
                    ...base,
                    id: novoId(),
                    tipo: 'ficheiro',
                    ficheiro: ficheiro.name,
                    tamanho: ficheiro.size,
                    // com vários ficheiros o título vem do nome de cada um
                    titulo: ficheiros.length === 1 ? titulo : tituloSugerido(ficheiro.name),
                    _blob: ficheiro,
                });
            });
        } else if (dlg.querySelector('#pdf-interno').checked) {
            if (opcoes().length === 0) {
                toast('Ainda não há PDFs para apontar.', 'warn');
                return;
            }
            const alvo = dlg.querySelector('#pdf-target').value;
            if (!alvo) {
                toast('Escolhe o PDF a que este link aponta.', 'warn');
                return;
            }
            entradas.push({ ...base, id: novoId(), tipo: 'link', alvo });
        } else {
            const url = dlg.querySelector('#pdf-url').value.trim();
            if (!/^https?:\/\/.+/i.test(url)) {
                dlg.querySelector('#pdf-url').focus();
                toast('O link tem de começar por http:// ou https://.', 'warn');
                return;
            }
            entradas.push({ ...base, id: novoId(), tipo: 'link', url });
        }

        try {
            const grandes = [];
            for (const entrada of entradas) {
                if (entrada._blob) {
                    const blob = entrada._blob;
                    await guardarFicheiro(entrada.id, blob);
                    delete entrada._blob;
                    if (blob.size > FICHEIROS_MAX_BYTES) {
                        grandes.push(entrada.titulo);
                    } else if (await enviarFicheiro(entrada, blob)) {
                        const enviados = lerEnviados();
                        enviados.add(entrada.id);
                        guardarEnviados(enviados);
                    }
                }
                docs.push(entrada);
            }
            if (grandes.length) {
                toast(`“${grandes[0]}” é demasiado grande para sync (>30MB) — fica só neste browser.`, 'warn');
            }
        } catch {
            toast('Não foi possível guardar o ficheiro no browser.', 'error');
            return;
        }

        docs = ordenar(docs);
        await guardar();
        dlg.close();
        toast(entradas.length === 1 ? `“${entradas[0].titulo}” adicionado.` : `${entradas.length} PDFs adicionados.`, 'success');
    }

    /* ── Eventos ────────────────────────────────────────── */

    function ligarOuvintes() {
        const dlg = form();
        const grelha = document.getElementById('pdf-grid');

        if (grelha && !grelha.dataset.pdfBound) {
            grelha.dataset.pdfBound = 'true';

            grelha.addEventListener('click', async (evento) => {
                const abrirBotao = evento.target.closest('[data-pdf-open]');
                const removerBotao = evento.target.closest('[data-pdf-remove]');

                if (abrirBotao) abrir(abrirBotao.dataset.pdfOpen);
                else if (removerBotao) apagar(removerBotao.dataset.pdfRemove);
            });

            grelha.addEventListener('click', (evento) => {
                const link = evento.target.closest('[data-pdf-download]');
                if (!link) return;
                evento.preventDefault();
                descarregar(link.dataset.pdfDownload);
            });
        }

        const filtros = document.getElementById('pdf-filters');
        if (filtros && !filtros.dataset.pdfBound) {
            filtros.dataset.pdfBound = 'true';
            filtros.addEventListener('click', (evento) => {
                const botao = evento.target.closest('[data-pdf-filter]');
                if (!botao) return;
                filtroActivo = botao.dataset.pdfFilter;
                filtros.querySelectorAll('[data-pdf-filter]').forEach((b) => {
                    b.setAttribute('aria-pressed', String(b.dataset.pdfFilter === filtroActivo));
                });
                aplicar();
            });
        }

        if (dlg && !dlg.dataset.pdfBound) {
            dlg.dataset.pdfBound = 'true';

            dlg.addEventListener('click', (evento) => {
                const tipo = evento.target.closest('[data-pdf-tipo]');
                if (tipo) {
                    dlg.querySelectorAll('[data-pdf-tipo]').forEach((b) => {
                        b.setAttribute('aria-pressed', String(b === tipo));
                    });
                    mostrarCampo(tipo.dataset.pdfTipo);
                    return;
                }

                if (evento.target.closest('#pdf-adicionar')) {
                    evento.preventDefault();
                    guardarEntrada();
                    return;
                }

                if (evento.target.closest('[data-pdf-cancelar]')) {
                    evento.preventDefault();
                    dlg.close();
                    return;
                }

                if (evento.target === dlg) dlg.close();
            });

            const interno = dlg.querySelector('#pdf-interno');
            interno.addEventListener('change', () => mostrarCampo('link'));

            // Ao escolher um ficheiro, sugere-se o título a partir do nome.
            const campoFicheiro = dlg.querySelector('#pdf-ficheiro');
            const campoTitulo = dlg.querySelector('#pdf-titulo');
            campoFicheiro.addEventListener('change', () => {
                const ficheiro = campoFicheiro.files[0];
                if (ficheiro && !campoTitulo.value.trim()) campoTitulo.value = tituloSugerido(ficheiro.name);
            });
        }

        const visor = dialogo();
        if (visor && !visor.dataset.pdfBound) {
            visor.dataset.pdfBound = 'true';

            visor.addEventListener('click', (evento) => {
                if (evento.target.closest('#pdf-viewer-close') || evento.target === visor) fechar();
            });

            const botaoMax = document.getElementById('pdf-viewer-full');
            if (botaoMax) botaoMax.addEventListener('click', () => alternarMax());

            const botaoCitacao = document.getElementById('pdf-cite-quote');
            if (botaoCitacao) botaoCitacao.addEventListener('click', () => guardarCitacao('citacao'));
            const botaoResumo = document.getElementById('pdf-cite-summary');
            if (botaoResumo) botaoResumo.addEventListener('click', () => guardarCitacao('resumo'));

            // Depois de o PDF carregar, o foco salta para o iframe:
            // recupera-se o diálogo e passa-se a escutar as teclas lá dentro.
            frame().addEventListener('load', () => {
                ligarTeclasNoIframe();
                if (visor.open) focarVisor();
            });

            // Se o utilizador clicou dentro de um PDF remoto, ao voltar à
            // janela o foco ainda está no iframe; devolve-se ao diálogo.
            window.addEventListener('focus', () => {
                if (visor.open && document.activeElement === frame()) focarVisor();
            });

            // Esc primeiro sai do ecrã inteiro; só depois fecha.
            visor.addEventListener('cancel', (evento) => {
                if (!visor.classList.contains('pdf-viewer-max')) return;
                evento.preventDefault();
                aplicarMax(false);
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            });

            visor.addEventListener('close', () => {
                aplicarMax(false);
                frame().src = 'about:blank';
            });

            // Sair do ecrã inteiro com a tecla do sistema também reposiciona.
            document.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement !== visor) aplicarMax(false);
            });
        }

        const adicionar = document.getElementById('pdf-add');
        if (adicionar && !adicionar.dataset.pdfBound) {
            adicionar.dataset.pdfBound = 'true';
            adicionar.addEventListener('click', () => abrirFormulario('ficheiro'));
        }
    }

    function campo() {
        const el = document.getElementById('pdf-search');
        if (el && el.value !== termos) {
            termos = normalizar(el.value);
            aplicar();
        }
    }

    let campoTimer = null;
    document.addEventListener('input', (evento) => {
        if (evento.target.id !== 'pdf-search') return;
        clearTimeout(campoTimer);
        campoTimer = setTimeout(campo, 90);
    });

    /* Atalhos do visualizador: Esc (sair do ecrã inteiro, depois fechar)
       e F (alternar ecrã inteiro).
       Vivem no documento e, quando possível, também dentro do próprio
       iframe: assim que o PDF carrega, o foco passa para lá e as teclas
       já não chegam ao <dialog>. */
    function tratarTecla(evento) {
        const visor = dialogo();
        if (!visor || !visor.open) return;
        if (evento.metaKey || evento.ctrlKey || evento.altKey) return;

        if (evento.key === 'Escape') {
            evento.preventDefault();

            if (visor.classList.contains('pdf-viewer-max')) {
                aplicarMax(false);
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            } else {
                fechar();
            }
            return;
        }

        if (evento.key.toLowerCase() === 'f') {
            evento.preventDefault();
            alternarMax();
        }
    }

    /* PDFs do próprio browser (blob) são de origem igual, dá para escutar
       as teclas lá dentro. Um PDF remoto é de outra origem e fica de fora. */
    function ligarTeclasNoIframe() {
        const visor = dialogo();
        try {
            const doc = frame().contentDocument;
            if (!doc) return false;
            doc.addEventListener('keydown', tratarTecla);
            return true;
        } catch {
            return false;
        }
    }

    document.addEventListener('keydown', tratarTecla);

    function ligar() {
        libertarUrls();
        ligarOuvintes();
        desenhar();
    }

    function carregar() {
        docs = ordenar(ler().map(normalizarEntrada));
        ligar();
        puxarEspelho();
    }

    /* O espelho pdfs.json manda quando existe (last-writer-wins, como as
       tarefas): é assim que os links e a lista chegam ao outro aparelho. */
    async function puxarEspelho() {
        try {
            if (!window.Vault) return;
            const r = await Vault.load(FICHEIRO_VAULT);
            if (!r || !r.ok || !r.existe) return;
            const lista = JSON.parse(r.content);
            if (!Array.isArray(lista)) return;
            const validos = ordenar(lista.filter((d) => d && d.id && d.titulo).map(normalizarEntrada));
            const antes = docs.map((d) => d.id).sort().join('|');
            const depois = validos.map((d) => d.id).sort().join('|');
            if (antes !== depois) {
                docs = validos;
                guardarLocais();
                desenhar();
            }
        } catch { /* espelho best-effort */ }
        backfillFicheiros();
    }

    /* Envia uma vez os ficheiros antigos que ainda só vivem neste browser. */
    async function backfillFicheiros() {
        const enviados = lerEnviados();
        let mudou = false;
        for (const doc of docs) {
            if (doc.tipo !== 'ficheiro' || enviados.has(doc.id)) continue;
            let blob = null;
            try {
                blob = await lerFicheiro(doc.id);
            } catch { blob = null; }
            if (!blob || blob.size > FICHEIROS_MAX_BYTES) continue;
            if (await enviarFicheiro(doc, blob)) {
                enviados.add(doc.id);
                mudou = true;
            }
        }
        if (mudou) guardarEnviados(enviados);
    }

    return { carregar, ligar, docs: () => docs, abrir, apagar };
})();
