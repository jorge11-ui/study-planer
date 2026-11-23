'use strict';

/* Fusão do documento de sync, sem dependências do servidor.
   Mantém o contrato atual: cada secção enviada substitui a guardada,
   exceto sessões (máximo por compartimento), coleções com tombstones
   (PDFs/caderno) e as secções versionadas (semana, quadro, assistente,
   objetivo e registo de sessões), que são unidas sem apagar o que já
   existe no servidor. */

const PDF_APAGADO_MS = 30 * 24 * 60 * 60 * 1000;
const LOG_MAX = 200;

function dadosSyncValidos(data) {
    return Boolean(data && typeof data === 'object' && !Array.isArray(data)
        && data.days && typeof data.days === 'object' && !Array.isArray(data.days));
}

function numMinSync(n) {
    const x = Number(n);
    return Number.isFinite(x) && x > 0 ? x : 0;
}

function numTs(n) {
    const x = Number(n);
    return Number.isFinite(x) && x > 0 ? x : 0;
}

function objetoPlano(v) {
    return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

function fundirColecaoSync(guardado, recebido, nomeLista, nomeApagados) {
    const mapa = new Map();
    if (Array.isArray(guardado[nomeLista])) guardado[nomeLista].forEach((d) => { if (d && d.id) mapa.set(d.id, d); });
    if (Array.isArray(recebido[nomeLista])) recebido[nomeLista].forEach((d) => { if (d && d.id) mapa.set(d.id, d); });
    const ap = new Map();
    if (Array.isArray(guardado[nomeApagados])) {
        guardado[nomeApagados].forEach((e) => { if (e && typeof e.id === 'string') ap.set(e.id, Number(e.ts) || 0); });
    }
    if (Array.isArray(recebido[nomeApagados])) {
        recebido[nomeApagados].forEach((e) => {
            if (e && typeof e.id === 'string') {
                const ts = Number(e.ts) || 0;
                if (!ap.has(e.id) || ts > ap.get(e.id)) ap.set(e.id, ts);
            }
        });
    }
    const agora = Date.now();
    const vivos = [...ap.entries()].filter(([, ts]) => agora - ts < PDF_APAGADO_MS);
    vivos.forEach(([id]) => mapa.delete(id));
    return {
        lista: [...mapa.values()],
        apagados: vivos.map(([id, ts]) => ({ id, ts })).slice(-200),
    };
}

/* Uma semana é gravada inteira em cada guardar. O carimbo por semana
   decide qual das versões é a mais recente, em vez de unir eventos por id
   (o que ressuscitava aulas apagadas noutro aparelho). */
function fundirSemanasSync(guardado, recebido) {
    const listas = {};
    const carimbos = {};
    const gListas = objetoPlano(guardado.semanalTodas) ? guardado.semanalTodas : {};
    const rListas = objetoPlano(recebido.semanalTodas) ? recebido.semanalTodas : {};
    const gTs = objetoPlano(guardado.semanalTs) ? guardado.semanalTs : {};
    const rTs = objetoPlano(recebido.semanalTs) ? recebido.semanalTs : {};
    const semanas = new Set([...Object.keys(gListas), ...Object.keys(rListas)]);

    semanas.forEach((semana) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) return;
        const g = Array.isArray(gListas[semana]) ? gListas[semana] : null;
        const r = Array.isArray(rListas[semana]) ? rListas[semana] : null;
        const gT = numTs(gTs[semana]);
        const rT = numTs(rTs[semana]);
        let vencedor = null;
        if (r) {
            // Sem carimbo, o push atual é a verdade (permite apagar uma semana).
            vencedor = (g && gT > rT) ? g : r;
        } else if (g) {
            vencedor = g;
        }
        if (!vencedor) return;
        listas[semana] = vencedor;
        carimbos[semana] = Math.max(gT, rT);
    });

    return { listas, carimbos };
}

/* Secções com um único carimbo updatedAt: a versão mais recente ganha.
   Se o cliente antigo não enviar a secção (ou enviar lixo), preserva-se o
   que o servidor já tem. */
function fundirLwwSync(guardado, recebido, nome, valido) {
    const g = guardado[nome];
    const r = recebido[nome];
    if (!r || typeof r !== 'object' || Array.isArray(r) || (valido && !valido(r))) {
        return objetoPlano(g) || (g == null) ? g : undefined;
    }
    if (!g || typeof g !== 'object' || Array.isArray(g)) return r;
    return numTs(r.updatedAt) >= numTs(g.updatedAt) ? r : g;
}

function chaveRegistoSessao(registo) {
    if (!registo || typeof registo !== 'object') return '';
    if (registo.id) return `id:${registo.id}`;
    return [
        registo.created || '',
        registo.day || '',
        registo.subject || '',
        registo.minutos || '',
        registo.goal || '',
    ].join('|');
}

/* Registo de sessões: append-only. A união por chave impede que um pull
   substitua o histórico deste aparelho pelo do outro. */
function fundirLogSessoesSync(guardado, recebido) {
    const mapa = new Map();
    const juntar = (lista) => {
        if (!Array.isArray(lista)) return;
        lista.forEach((registo) => {
            const chave = chaveRegistoSessao(registo);
            if (!chave || chave === '||||') return;
            const anterior = mapa.get(chave);
            // Em duplicados, o mais recente em `created` ganha.
            if (!anterior || numTs(registo.created) >= numTs(anterior.created)) mapa.set(chave, registo);
        });
    };
    juntar(guardado.sessoesLog);
    juntar(recebido.sessoesLog);
    return [...mapa.values()]
        .sort((a, b) => numTs(a.created) - numTs(b.created))
        .slice(-LOG_MAX);
}

function fundirSyncData(guardado, recebido) {
    const out = { ...guardado, ...recebido };

    // Clientes antigos não conhecem examesV2 e enviam null. Não interpretes
    // isso como apagar o Exam Center já persistido no servidor.
    if ((!recebido.examesV2 || typeof recebido.examesV2 !== 'object' || Array.isArray(recebido.examesV2))
        && guardado.examesV2 && typeof guardado.examesV2 === 'object') {
        out.examesV2 = guardado.examesV2;
    }

    if (Array.isArray(recebido.pdfs) || Array.isArray(recebido.pdfsApagados)) {
        const f = fundirColecaoSync(guardado, recebido, 'pdfs', 'pdfsApagados');
        out.pdfs = f.lista;
        out.pdfsApagados = f.apagados;
    }

    if (Array.isArray(recebido.caderno) || Array.isArray(recebido.cadernoApagados)) {
        const f = fundirColecaoSync(guardado, recebido, 'caderno', 'cadernoApagados');
        out.caderno = f.lista;
        out.cadernoApagados = f.apagados;
    }

    if (recebido.sessoesBase && typeof recebido.sessoesBase === 'object'
        && guardado.sessoesBase && typeof guardado.sessoesBase === 'object') {
        const base = {};
        new Set([...Object.keys(guardado.sessoesBase), ...Object.keys(recebido.sessoesBase)]).forEach((dia) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
            const gb = guardado.sessoesBase[dia];
            const rb = recebido.sessoesBase[dia];
            if ((!gb || typeof gb !== 'object') && (!rb || typeof rb !== 'object')) return;
            const materias = new Set([...Object.keys(gb || {}), ...Object.keys(rb || {})]);
            const outDia = {};
            materias.forEach((m) => {
                const v = Math.max(numMinSync(gb && gb[m]), numMinSync(rb && rb[m]));
                if (v > 0) outDia[m] = v;
            });
            if (Object.keys(outDia).length) base[dia] = outDia;
        });
        out.sessoesBase = base;
        if (!recebido.sessoes || typeof recebido.sessoes !== 'object') out.sessoes = base;
    }

    if (recebido.sessoesSlots && typeof recebido.sessoesSlots === 'object'
        && guardado.sessoesSlots && typeof guardado.sessoesSlots === 'object') {
        const slots = JSON.parse(JSON.stringify(guardado.sessoesSlots));
        Object.entries(recebido.sessoesSlots).forEach(([dia, materias]) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !materias || typeof materias !== 'object') return;
            if (!slots[dia] || typeof slots[dia] !== 'object') slots[dia] = {};
            Object.entries(materias).forEach(([materia, aparelhos]) => {
                if (typeof materia !== 'string' || !materia || !aparelhos || typeof aparelhos !== 'object') return;
                if (!slots[dia][materia] || typeof slots[dia][materia] !== 'object') slots[dia][materia] = {};
                Object.entries(aparelhos).forEach(([dev, min]) => {
                    if (typeof dev !== 'string' || !dev) return;
                    slots[dia][materia][dev] = Math.max(numMinSync(slots[dia][materia][dev]), numMinSync(min));
                });
            });
        });
        out.sessoesSlots = slots;
    }

    // Semanas completas (o `semanal` acima continua a viajar para clientes
    // antigos, mas o histórico de todas as semanas fica preservado).
    if (objetoPlano(recebido.semanalTodas) || objetoPlano(guardado.semanalTodas)) {
        const semanas = fundirSemanasSync(guardado, recebido);
        if (Object.keys(semanas.listas).length || objetoPlano(recebido.semanalTodas)) {
            out.semanalTodas = semanas.listas;
            out.semanalTs = semanas.carimbos;
        }
    }

    // Secções versionadas de todas as vistas.
    const lww = [
        ['semanalPrefs', null],
        ['sessaoObjetivo', (v) => typeof v.valor === 'string'],
        ['assistente', (v) => Array.isArray(v.hist)],
        ['whiteboardDraft', (v) => typeof v.content === 'string'],
        ['whiteboardGrid', (v) => typeof v.visible === 'boolean'],
        ['floatingNote', (v) => objetoPlano(v.data)],
    ];
    lww.forEach(([nome, valido]) => {
        const valor = fundirLwwSync(guardado, recebido, nome, valido);
        // Se o push trouxe lixo e não havia nada guardado, não deixes o
        // valor inválido entrar no documento canónico.
        if (valor === undefined) delete out[nome];
        else out[nome] = valor;
    });

    if (Array.isArray(recebido.sessoesLog) || Array.isArray(guardado.sessoesLog)) {
        out.sessoesLog = fundirLogSessoesSync(guardado, recebido);
    }

    return out;
}

module.exports = {
    PDF_APAGADO_MS,
    dadosSyncValidos,
    numMinSync,
    numTs,
    fundirColecaoSync,
    fundirSemanasSync,
    fundirLwwSync,
    fundirLogSessoesSync,
    fundirSyncData,
};
