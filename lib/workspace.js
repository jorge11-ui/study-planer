'use strict';

/* Fachada única para o workspace central. Usa PostgreSQL quando existe
   DATABASE_URL; caso contrário usa o armazenamento do servidor em disco
   (nunca o localStorage do browser). */

const { createLocalWorkspace } = require('../db/workspace-local');

function createWorkspace({ pgStore = null, dataDir, workspaceId = 'default' } = {}) {
    const id = String(workspaceId || 'default');
    const local = pgStore ? null : createLocalWorkspace(dataDir);
    const chamar = (nomePg, nomeLocal, ...args) => {
        if (pgStore) return pgStore[nomePg](id, ...args);
        return local[nomeLocal](...args);
    };

    return {
        id,
        persistente: Boolean(pgStore),
        init: () => (pgStore ? pgStore.workspaceImportLegacy(id) : local.init()),
        snapshot: () => chamar('workspaceSnapshot', 'snapshot'),
        changesSince: (since) => chamar('workspaceChangesSince', 'changesSince', since),
        applyOps: (ops, updatedBy) => chamar('workspaceApplyOps', 'applyOps', ops, updatedBy),
        touch: () => chamar('workspaceTouch', 'touch'),
        listFiles: () => chamar('workspaceListFiles', 'listFiles'),
        getFile: (fileId) => chamar('workspaceGetFile', 'getFile', fileId),
        putFile: (fileId, metadata, content) => chamar('workspacePutFile', 'putFile', fileId, metadata, content),
        deleteFile: (fileId) => chamar('workspaceDeleteFile', 'deleteFile', fileId),
        close: () => (local ? local.close() : Promise.resolve()),
    };
}

module.exports = { createWorkspace };
