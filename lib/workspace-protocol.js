'use strict';

const { fundirColecaoSync } = require('./sync-merge');

/* Protocolo do workspace central.
   Cada dado da aplicação é uma chave com o prefixo study-journal-. O
   servidor guarda o valor exato que o browser usa em localStorage, pelo
   que a UI atual continua síncrona e rápida; a fonte de verdade é a base
   de dados central. Este módulo é usado pelo servidor e pelos testes. */

const PREFIXO = 'study-journal-';
const VALOR_MAX_BYTES = 4 * 1024 * 1024;
const LOTE_MAX_OPS = 500;
const LOTE_MAX_BYTES = 8 * 1024 * 1024;
const CHAVE_MAX = 200;

/* Chaves que pertencem ao aparelho, não ao workspace. Nunca viajam. */
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
    if (typeof chave !== 'string' || !chave || chave.length > CHAVE_MAX) return false;
    if (!chave.startsWith(PREFIXO)) return false;
    if (EXATAS_LOCAIS.has(chave)) return false;
    if (PREFIXOS_LOCAIS.some((p) => chave.startsWith(p))) return false;
    if (SUFIXOS_LOCAIS.some((s) => chave.endsWith(s))) return false;
    return true;
}

function normalizarOp(op) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
        return { erro: 'op-invalida' };
    }
    const chave = op.key;
    if (!chaveSincronizavel(chave)) return { erro: 'chave-invalida' };
    const apagada = op.deleted === true;
    if (apagada) return { chave, valor: null, apagada: true };
    if (typeof op.value !== 'string') return { erro: 'valor-invalido' };
    if (Buffer.byteLength(op.value, 'utf8') > VALOR_MAX_BYTES) return { erro: 'valor-demasiado-grande' };
    return { chave, valor: op.value, apagada: false };
}

function validarOps(ops) {
    if (!Array.isArray(ops) || !ops.length) return { erro: 'sem-operacoes' };
    if (ops.length > LOTE_MAX_OPS) return { erro: 'demasiadas-operacoes' };
    const vistas = new Map();
    let total = 0;
    for (const bruta of ops) {
        const op = normalizarOp(bruta);
        if (op.erro) return { erro: op.erro };
        // Na mesma chamada, a última escrita da chave ganha.
        vistas.delete(op.chave);
        vistas.set(op.chave, op);
        if (op.valor) total += Buffer.byteLength(op.valor, 'utf8');
    }
    if (total > LOTE_MAX_BYTES) return { erro: 'lote-demasiado-grande' };
    return { ops: [...vistas.values()] };
}

function texto(valor) {
    if (valor === null || valor === undefined) return undefined;
    if (typeof valor === 'string') return valor;
    return JSON.stringify(valor);
}

function json(valor) {
    if (valor === null || valor === undefined) return undefined;
    return JSON.stringify(valor);
}

/* Converte o documento de sync antigo (app_state.data) para chaves do
   workspace. É uma migração única: a partir daí só existem operações. */
function chavesDoDocumentoLegado(data) {
    const out = {};
    const por = (chave, valor) => {
        const v = texto(valor);
        if (v !== undefined) out[chave] = v;
    };
    if (!data || typeof data !== 'object') return out;

    if (data.days && typeof data.days === 'object') {
        for (const [dia, valor] of Object.entries(data.days)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !valor || typeof valor !== 'object') continue;
            if (typeof valor.notes === 'string') {
                por(`study-journal-notes-${dia}`, valor.notes);
                if (Number(valor.updatedAt) > 0) out[`study-journal-notes-${dia}-ts`] = String(Number(valor.updatedAt));
            }
            if (Array.isArray(valor.tasks)) {
                por(`study-journal-tasks-${dia}`, valor.tasks);
                if (Number(valor.tasksUpdatedAt) > 0) out[`study-journal-tasks-${dia}-ts`] = String(Number(valor.tasksUpdatedAt));
            }
        }
    }

    if (data.notasMeta && typeof data.notasMeta === 'object') {
        for (const [dia, meta] of Object.entries(data.notasMeta)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) por(`study-journal-note-meta-${dia}`, meta);
        }
    }
    if (data.notasIndex && typeof data.notasIndex === 'object') {
        por('study-journal-notes-index', data.notasIndex);
    }

    if (data.semanal && typeof data.semanal === 'object') {
        if (Array.isArray(data.semanal.fixos)) por('study-journal-semanal-fixo', data.semanal.fixos);
        if (Array.isArray(data.semanal.dinamicos) && data.semanal.semanaAtual) {
            por(`study-journal-semanal-dinamico-${data.semanal.semanaAtual}`, data.semanal.dinamicos);
        }
    }
    if (data.semanalTodas && typeof data.semanalTodas === 'object') {
        for (const [semana, lista] of Object.entries(data.semanalTodas)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(semana) || !Array.isArray(lista)) continue;
            por(`study-journal-semanal-dinamico-${semana}`, lista);
            const ts = data.semanalTs && Number(data.semanalTs[semana]);
            if (ts > 0) out[`study-journal-semanal-dinamico-${semana}-ts`] = String(ts);
        }
    }
    if (data.semanalPrefs && typeof data.semanalPrefs === 'object') {
        const p = data.semanalPrefs;
        if (p.passo !== undefined && p.passo !== null) out['study-journal-semanal-passo'] = String(p.passo);
        if (p.vista !== undefined && p.vista !== null) out['study-journal-semanal-vista'] = String(p.vista);
        if (p.fimSemana !== undefined && p.fimSemana !== null) out['study-journal-semanal-fim-semana'] = String(p.fimSemana);
        if (p.inicio !== undefined && p.inicio !== null) out['study-journal-semanal-inicio'] = String(p.inicio);
        if (p.fim !== undefined && p.fim !== null) out['study-journal-semanal-fim'] = String(p.fim);
        if (Number(p.updatedAt) > 0) out['study-journal-semanal-prefs-ts'] = String(Number(p.updatedAt));
    }

    if (data.exames && typeof data.exames === 'object') {
        por('study-journal-exames-foco', data.exames.foco);
        por('study-journal-exames-recursos', data.exames.recursos);
        por('study-journal-exames-track', data.exames.track);
        por('study-journal-exames-duvidas', data.exames.duvidas);
        por('study-journal-exames-data-alvo', data.exames.dataAlvo);
    }
    por('study-journal-exames-center-v2', data.examesV2);
    por('study-journal-reviews-v2', data.reviewsV2);
    por('study-journal-reviews', data.reviews);

    por('study-journal-pdfs', data.pdfs);
    por('study-journal-pdfs-apagados', data.pdfsApagados);
    por('study-journal-caderno', data.caderno);
    por('study-journal-caderno-apagados', data.cadernoApagados);

    por('study-journal-sessions', data.sessoes);
    por('study-journal-sessions-base', data.sessoesBase || data.sessoes);
    por('study-journal-sessions-slots', data.sessoesSlots);
    por('study-journal-session-log', data.sessoesLog);

    if (data.sessaoObjetivo && typeof data.sessaoObjetivo.valor === 'string') {
        out['study-journal-session-goal'] = data.sessaoObjetivo.valor;
        if (Number(data.sessaoObjetivo.updatedAt) > 0) {
            out['study-journal-session-goal-ts'] = String(Number(data.sessaoObjetivo.updatedAt));
        }
    }
    if (data.assistente && Array.isArray(data.assistente.hist)) {
        por('study-journal-assistente-hist', data.assistente.hist);
        if (Number(data.assistente.updatedAt) > 0) {
            out['study-journal-assistente-hist-ts'] = String(Number(data.assistente.updatedAt));
        }
    }
    if (data.whiteboardDraft && typeof data.whiteboardDraft.content === 'string') {
        out['study-journal-whiteboard-draft'] = data.whiteboardDraft.content;
        if (Number(data.whiteboardDraft.updatedAt) > 0) {
            out['study-journal-whiteboard-draft-ts'] = String(Number(data.whiteboardDraft.updatedAt));
        }
    }
    if (data.whiteboardGrid && typeof data.whiteboardGrid.visible === 'boolean') {
        out['study-journal-whiteboard-grid'] = String(data.whiteboardGrid.visible);
        if (Number(data.whiteboardGrid.updatedAt) > 0) {
            out['study-journal-whiteboard-grid-ts'] = String(Number(data.whiteboardGrid.updatedAt));
        }
    }
    if (data.floatingNote && data.floatingNote.data && typeof data.floatingNote.data === 'object') {
        por('study-journal-floating-note', data.floatingNote.data);
    }

    return out;
}

/* Ponte para aparelhos com o código antigo em cache: eles ainda gravam o
   documento agregado em /api/data. Convertemos esse push em operações
   seguras para o workspace, em vez de o perder ou de deixar um aparelho
   desatualizado apagar dados novos:
   - só viajam as chaves que este push mudou (não se reenvia o documento);
   - uma chave com carimbo `<chave>-ts` só ganha se for mais recente do
     que o workspace;
   - listas com tombstones (PDFs/Caderno) e minutos de estudo são unidas,
     nunca substituídas.
   `servidor` é um Map chave -> valor atual do workspace. */
function opsDoDocumentoLegado(antes, depois, servidor = new Map()) {
    const a = chavesDoDocumentoLegado(antes);
    const b = chavesDoDocumentoLegado(depois);
    const ops = [];
    const incluidas = new Set();
    const lerServidor = (chave) => {
        const v = servidor.get(chave);
        return typeof v === 'string' ? v : null;
    };
    const juntar = (chave, valor) => {
        if (incluidas.has(chave)) return;
        incluidas.add(chave);
        ops.push({ key: chave, value: valor });
    };
    const numero = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const lista = (v) => {
        if (typeof v !== 'string') return [];
        try {
            const x = JSON.parse(v);
            return Array.isArray(x) ? x : [];
        } catch {
            return [];
        }
    };
    const objeto = (v) => {
        if (typeof v !== 'string') return null;
        try {
            const x = JSON.parse(v);
            return x && typeof x === 'object' && !Array.isArray(x) ? x : null;
        } catch {
            return null;
        }
    };
    const COLECOES = new Set(['study-journal-pdfs', 'study-journal-caderno']);

    for (const chave of Object.keys(b)) {
        if (chave.endsWith('-ts')) continue;
        const valor = b[chave];
        if (a[chave] === valor) continue; // este push não mexeu na chave

        if (COLECOES.has(chave)) {
            const chaveApagados = `${chave}-apagados`;
            const atualLista = lerServidor(chave);
            const atualApagados = lerServidor(chaveApagados);
            const unida = fundirColecaoSync(
                { lista: lista(atualLista), apagados: lista(atualApagados) },
                { lista: lista(valor), apagados: lista(b[chaveApagados]) },
                'lista',
                'apagados',
            );
            const listaFinal = JSON.stringify(unida.lista);
            if (listaFinal !== atualLista) juntar(chave, listaFinal);
            const apagadosFinal = JSON.stringify(unida.apagados);
            if (apagadosFinal !== atualApagados) juntar(chaveApagados, apagadosFinal);
            continue;
        }

        if (chave === 'study-journal-sessions' || chave === 'study-journal-sessions-base') {
            const atual = objeto(lerServidor(chave)) || {};
            const novo = objeto(valor) || {};
            const unido = { ...atual };
            for (const [slot, minutos] of Object.entries(novo)) {
                const n = Number(minutos) || 0;
                const anterior = Number(unido[slot]) || 0;
                if (!(slot in unido) || n > anterior) unido[slot] = n;
            }
            const final = JSON.stringify(unido);
            if (final !== lerServidor(chave)) juntar(chave, final);
            continue;
        }

        const chaveTs = `${chave}-ts`;
        if (b[chaveTs] !== undefined) {
            if (numero(b[chaveTs]) > numero(lerServidor(chaveTs))) {
                juntar(chave, valor);
                juntar(chaveTs, b[chaveTs]);
            }
            continue;
        }

        juntar(chave, valor);
    }

    return ops;
}

/* O registo de sessões é só de acrescentar (a app nunca o limpa). Uma
   escrita de outro aparelho não deve apagar as sessões que este acabou de
   registar, por isso a chave é unida em vez de substituída. */
function fundirRegistoSessoes(anterior, novo) {
    if (typeof novo !== 'string') return novo;
    if (typeof anterior !== 'string' || !anterior) return novo;
    let a;
    let b;
    try {
        a = JSON.parse(anterior);
        b = JSON.parse(novo);
    } catch {
        return novo;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) return novo;
    const mapa = new Map();
    const chave = (s) => `${s && s.subject}|${Number(s && s.created) || 0}|${Number(s && s.minutos) || 0}|${(s && s.goal) || ''}`;
    for (const s of a) if (s && typeof s === 'object') mapa.set(chave(s), s);
    for (const s of b) if (s && typeof s === 'object') mapa.set(chave(s), s);
    const lista = [...mapa.values()]
        .sort((x, y) => (Number(x.created) || 0) - (Number(y.created) || 0))
        .slice(-200);
    return JSON.stringify(lista);
}

module.exports = {
    PREFIXO,
    VALOR_MAX_BYTES,
    LOTE_MAX_OPS,
    LOTE_MAX_BYTES,
    CHAVE_MAX,
    EXATAS_LOCAIS,
    PREFIXOS_LOCAIS,
    SUFIXOS_LOCAIS,
    chaveSincronizavel,
    normalizarOp,
    validarOps,
    chavesDoDocumentoLegado,
    opsDoDocumentoLegado,
    fundirRegistoSessoes,
};
