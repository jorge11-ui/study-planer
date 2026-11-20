'use strict';

/* Fusão do documento de sync, sem dependências do servidor.
   Mantém o contrato atual: cada secção enviada substitui a guardada,
   exceto sessões (máximo por compartimento) e coleções com tombstones
   (PDFs/caderno), que são unidas por id. */

const PDF_APAGADO_MS = 30 * 24 * 60 * 60 * 1000;

function dadosSyncValidos(data) {
    return Boolean(data && typeof data === 'object' && !Array.isArray(data)
        && data.days && typeof data.days === 'object' && !Array.isArray(data.days));
}

function numMinSync(n) {
    const x = Number(n);
    return Number.isFinite(x) && x > 0 ? x : 0;
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

    return out;
}

module.exports = { PDF_APAGADO_MS, dadosSyncValidos, numMinSync, fundirColecaoSync, fundirSyncData };
