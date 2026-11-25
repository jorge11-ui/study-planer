'use strict';

/* Workspace central em ficheiro, para desenvolvimento local e testes sem
   PostgreSQL. Em produção (Render/Postgres) a implementação usada é a de
   db/store.js; a API é a mesma. Isto NÃO é o localStorage do browser: é o
   armazenamento do servidor, partilhado por todos os dispositivos. */

const fs = require('node:fs');
const path = require('node:path');
const { validarOps, chavesDoDocumentoLegado, fundirRegistoSessoes } = require('../lib/workspace-protocol');

const ID_FICHEIRO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function vazio() {
    return { revision: 0, keys: {}, files: {} };
}

function createLocalWorkspace(dataDir) {
    const raiz = path.join(dataDir, 'workspace');
    const ficheirosDir = path.join(raiz, 'files');
    const ficheiro = path.join(raiz, 'state.json');
    let estado = vazio();
    let carregado = false;
    let fila = Promise.resolve();

    function serial(fn) {
        const atual = fila.then(fn);
        fila = atual.catch(() => { /* a próxima operação continua */ });
        return atual;
    }

    function garantirPastas() {
        fs.mkdirSync(ficheirosDir, { recursive: true });
    }

    function carregar() {
        if (carregado) return;
        garantirPastas();
        try {
            const lido = JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
            if (lido && typeof lido === 'object' && lido.keys && typeof lido.keys === 'object') {
                estado = {
                    revision: Number(lido.revision) || 0,
                    keys: lido.keys,
                    files: lido.files && typeof lido.files === 'object' ? lido.files : {},
                };
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        carregado = true;
    }

    function persistir() {
        garantirPastas();
        const tmp = `${ficheiro}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(estado), { mode: 0o600 });
        fs.renameSync(tmp, ficheiro);
    }

    function caminhoBytes(id) {
        return path.join(ficheirosDir, encodeURIComponent(id));
    }

    function chavePublica(key, item) {
        return {
            key,
            value: item.deleted ? null : item.value,
            deleted: Boolean(item.deleted),
            version: Number(item.version) || 0,
            updatedAt: item.updatedAt || null,
        };
    }

    function ficheiroPublico(id, item) {
        return {
            id,
            nome: item.nome,
            tipo: item.tipo,
            tamanho: Number(item.tamanho) || 0,
            metadata: item.metadata || {},
            version: Number(item.version) || 0,
            updatedAt: item.updatedAt || null,
            deleted: Boolean(item.deletedAt),
        };
    }

    function proximaRevisao() {
        estado.revision = (Number(estado.revision) || 0) + 1;
        return estado.revision;
    }

    function snapshot() {
        return serial(() => {
            carregar();
            return {
                workspaceId: 'local',
                revision: Number(estado.revision) || 0,
                keys: Object.entries(estado.keys).map(([key, item]) => chavePublica(key, item)),
                files: Object.entries(estado.files)
                    .filter(([, item]) => !item.deletedAt)
                    .map(([id, item]) => ficheiroPublico(id, item)),
            };
        });
    }

    function changesSince(since) {
        return serial(() => {
            carregar();
            const rev = Number(estado.revision) || 0;
            const desde = Math.max(0, Number(since) || 0);
            if (desde > rev) return { reset: true, revision: rev, keys: [], files: [] };
            return {
                reset: false,
                revision: rev,
                keys: Object.entries(estado.keys)
                    .filter(([, item]) => (Number(item.version) || 0) > desde)
                    .map(([key, item]) => chavePublica(key, item)),
                files: Object.entries(estado.files)
                    .filter(([, item]) => (Number(item.version) || 0) > desde)
                    .map(([id, item]) => ficheiroPublico(id, item)),
            };
        });
    }

    function applyOps(ops, updatedBy = '') {
        const validado = validarOps(ops);
        if (validado.erro) {
            const error = new Error(validado.erro);
            error.code = 'OPS_INVALIDAS';
            return Promise.reject(error);
        }
        return serial(() => {
            carregar();
            const alteradas = [];
            let versao = 0;
            for (const op of validado.ops) {
                const anterior = estado.keys[op.chave];
                const apagada = Boolean(op.apagada);
                let valor = apagada ? null : op.valor;
                if (!apagada && op.chave === 'study-journal-session-log' && anterior && !anterior.deleted) {
                    valor = fundirRegistoSessoes(anterior.value, valor);
                }
                if (anterior && anterior.deleted === apagada && (apagada || anterior.value === valor)) continue;
                if (!versao) versao = proximaRevisao();
                estado.keys[op.chave] = {
                    value: valor,
                    deleted: apagada,
                    version: versao,
                    updatedAt: new Date().toISOString(),
                    updatedBy: updatedBy || '',
                };
                alteradas.push(chavePublica(op.chave, estado.keys[op.chave]));
            }
            if (alteradas.length) persistir();
            return { revision: versao || Number(estado.revision) || 0, keys: alteradas, files: [] };
        });
    }

    function touch() {
        return serial(() => {
            carregar();
            const rev = proximaRevisao();
            persistir();
            return rev;
        });
    }

    function listFiles() {
        return serial(() => {
            carregar();
            return Object.entries(estado.files)
                .filter(([, item]) => !item.deletedAt)
                .map(([id, item]) => ficheiroPublico(id, item));
        });
    }

    function getFile(id) {
        return serial(() => {
            carregar();
            const item = estado.files[id];
            if (!item || item.deletedAt) return null;
            try {
                return { ...ficheiroPublico(id, item), content: fs.readFileSync(caminhoBytes(id)) };
            } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw error;
            }
        });
    }

    function putFile(id, metadata, content) {
        if (!ID_FICHEIRO.test(String(id || ''))) return Promise.reject(new Error('id-invalido'));
        return serial(() => {
            carregar();
            const meta = metadata && typeof metadata === 'object' ? metadata : {};
            const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || []);
            const versao = proximaRevisao();
            garantirPastas();
            fs.writeFileSync(caminhoBytes(id), bytes, { mode: 0o600 });
            estado.files[id] = {
                nome: String(meta.nome || 'ficheiro.pdf').slice(0, 200),
                tipo: String(meta.tipo || 'application/pdf').slice(0, 100),
                tamanho: bytes.length,
                metadata: meta,
                version: versao,
                updatedAt: new Date().toISOString(),
                deletedAt: null,
            };
            persistir();
            return { revision: versao, id, tamanho: bytes.length };
        });
    }

    function deleteFile(id) {
        return serial(() => {
            carregar();
            const item = estado.files[id];
            if (!item || item.deletedAt) return { revision: Number(estado.revision) || 0, id, deleted: false };
            const versao = proximaRevisao();
            try { fs.unlinkSync(caminhoBytes(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            estado.files[id] = { ...item, deletedAt: new Date().toISOString(), version: versao, updatedAt: new Date().toISOString() };
            persistir();
            return { revision: versao, id, deleted: true };
        });
    }

    function importLegacy() {
        return serial(() => {
            carregar();
            let chaves = 0;
            if (!Object.keys(estado.keys).length) {
                try {
                    const doc = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8'));
                    const mapa = chavesDoDocumentoLegado(doc && doc.data);
                    const versao = proximaRevisao();
                    for (const [key, value] of Object.entries(mapa)) {
                        estado.keys[key] = { value, deleted: false, version: versao, updatedAt: new Date().toISOString(), updatedBy: 'migracao' };
                        chaves += 1;
                    }
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
            let ficheiros = 0;
            if (!Object.keys(estado.files).length) {
                const origem = path.join(dataDir, 'ficheiros');
                try {
                    const ids = fs.readdirSync(origem).filter((f) => ID_FICHEIRO.test(f) && !f.endsWith('.meta.json'));
                    const versao = Math.max(1, Number(estado.revision) || 0);
                    for (const id of ids) {
                        try {
                            const meta = JSON.parse(fs.readFileSync(path.join(origem, `${id}.meta.json`), 'utf8'));
                            const bytes = fs.readFileSync(path.join(origem, id));
                            garantirPastas();
                            fs.writeFileSync(caminhoBytes(id), bytes, { mode: 0o600 });
                            estado.files[id] = {
                                nome: String(meta.nome || 'ficheiro.pdf'),
                                tipo: String(meta.tipo || 'application/pdf'),
                                tamanho: bytes.length,
                                metadata: meta,
                                version: versao,
                                updatedAt: new Date().toISOString(),
                                deletedAt: null,
                            };
                            ficheiros += 1;
                        } catch { /* ignora legado inválido */ }
                    }
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
            if (chaves || ficheiros) persistir();
            return { keys: chaves, files: ficheiros, revision: Number(estado.revision) || 0 };
        });
    }

    return {
        init: () => importLegacy(),
        snapshot,
        changesSince,
        applyOps,
        touch,
        listFiles,
        getFile,
        putFile,
        deleteFile,
        importLegacy,
        close: () => Promise.resolve(),
    };
}

module.exports = { createLocalWorkspace };
