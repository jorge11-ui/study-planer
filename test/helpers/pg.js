'use strict';

/* Base de dados PostgreSQL em memória (pg-mem) para os testes.
   Não substitui um teste contra PostgreSQL real, mas exercita o SQL do
   store: migrações, JSONB, ON CONFLICT, chaves e transações. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');
const { createStore } = require('../../db/store');

function criarBase() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  // Funções usadas pelo store que o pg-mem não implementa nativamente.
  db.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  db.public.registerFunction({
    name: 'pg_advisory_lock',
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  db.public.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (texto) => {
      let h = 0;
      for (const ch of String(texto)) h = (Math.imul(31, h) + ch.codePointAt(0)) | 0;
      return h;
    },
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.bytea],
    returns: DataType.integer,
    implementation: (bytes) => (bytes ? bytes.length : null),
  });

  const pg = db.adapters.createPg();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-store-'));
  const anterior = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const store = createStore('postgres://teste@localhost/teste', { Pool: pg.Pool });

  return {
    db,
    store,
    dataDir,
    async fechar() {
      await store.close();
      if (anterior === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = anterior;
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { criarBase };
