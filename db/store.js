'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validarOps, chavesDoDocumentoLegado, fundirRegistoSessoes } = require('../lib/workspace-protocol');

const MIGRATION_FILE = /^\d+_[a-z0-9_-]+\.sql$/i;
const EXAM_COLLECTIONS = ['exams', 'topics', 'materials', 'sessions', 'issues', 'practice', 'reviews', 'planHistory'];

/* Divide uma migração em instruções. Os ficheiros deste projeto são DDL
   simples (sem blocos $$), por isso o `;` no fim da linha é o separador;
   executar uma a uma dá erros localizáveis em vez de um blob opaco. */
function sqlStatements(sql) {
  return String(sql)
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(?:--[^\n]*\n?)*$/.test(s));
}

/* Em produção (Render) o certificado deve ser verificado. Alguns
   fornecedores usam CA própria; nesse caso PGSSL=no-verify é explícito. */
function sslConfig() {
  const mode = String(process.env.PGSSL || '').trim().toLowerCase();
  if (mode === 'disable' || mode === 'false' || mode === '0') return false;
  if (mode === 'no-verify' || mode === 'insecure') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function catalogExams(staticExams) {
  if (!staticExams || typeof staticExams !== 'object') return [];
  return Array.isArray(staticExams.exams) ? staticExams.exams : [];
}

function catalogNodes(staticExams) {
  if (!staticExams || typeof staticExams !== 'object') return [];
  return Array.isArray(staticExams.nodes) ? staticExams.nodes : [];
}

function createStore(databaseUrl, options = {}) {
  if (!databaseUrl) return null;
  const Pool = options.Pool || require('pg').Pool;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslConfig(),
    max: Number(process.env.PGPOOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (error) => console.error(`  ! PostgreSQL: ${error.message}`));
  const query = (sql, params) => pool.query(sql, params);

  async function withClient(fn) {
    const client = await pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  async function withTransaction(fn) {
    return withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ligação já fechada */ }
        throw error;
      }
    });
  }

  async function migrate() {
    return withTransaction(async (client) => {
      // A tabela de controlo pertence ao runner, não às migrações. Só é
      // criada quando ainda não existe (evita repetir DDL a cada arranque).
      const existe = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'",
      );
      if (!existe.rowCount) {
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      }
      // Impede duas instâncias a migrar ao mesmo tempo.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('study-journal:migrations'))");
      const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
      const dir = path.join(__dirname, 'migrations');
      const files = fs.readdirSync(dir).filter((f) => MIGRATION_FILE.test(f)).sort();
      for (const file of files) {
        const version = file.replace(/\.sql$/i, '');
        if (applied.has(version)) continue;
        for (const statement of sqlStatements(fs.readFileSync(path.join(dir, file), 'utf8'))) {
          await client.query(statement);
        }
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      }
    });
  }

  /* Catálogo é conteúdo versionado e global; o estado pessoal nunca é
     tocado. Só exames ativos são semeados; o catálogo em rascunho fica
     no JSON e não entra na base de dados. */
  async function seedCatalog(client, staticExams) {
    const exams = catalogExams(staticExams);
    const nodes = catalogNodes(staticExams);
    if (!exams.length) return { exams: 0, nodes: 0 };
    const version = String(staticExams.version || '0');
    const byId = new Map();
    for (const exam of exams) {
      if (!exam || typeof exam.id !== 'string' || !exam.id) throw new Error('Catálogo: exame sem id.');
      if (typeof exam.name !== 'string' || !exam.name) throw new Error(`Catálogo: exame ${exam.id} sem nome.`);
      if (byId.has(exam.id)) throw new Error(`Catálogo: exame duplicado ${exam.id}.`);
      byId.set(exam.id, exam);
    }

    // 1.ª passagem: ids únicos e campos obrigatórios.
    const nodeById = new Map();
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string' || !node.id) throw new Error('Catálogo: nó sem id.');
      if (nodeById.has(node.id)) throw new Error(`Catálogo: id duplicado ${node.id}.`);
      if (!byId.has(node.examId)) throw new Error(`Catálogo: nó ${node.id} aponta para exame inexistente.`);
      if (typeof node.title !== 'string' || !node.title) throw new Error(`Catálogo: nó ${node.id} sem título.`);
      if (typeof node.kind !== 'string' || !node.kind) throw new Error(`Catálogo: nó ${node.id} sem kind.`);
      nodeById.set(node.id, node);
    }

    // 2.ª passagem: hierarquia sã (sem pais em falta, auto-parentesco ou ciclos).
    for (const node of nodes) {
      if (!node.parentId) continue;
      if (node.id === node.parentId) throw new Error(`Catálogo: nó ${node.id} é pai de si próprio.`);
      if (!nodeById.has(node.parentId)) throw new Error(`Catálogo: nó ${node.id} aponta para pai inexistente.`);
      const vistos = new Set([node.id]);
      let pai = nodeById.get(node.parentId);
      while (pai) {
        if (vistos.has(pai.id)) throw new Error(`Catálogo: ciclo na hierarquia em ${node.id}.`);
        vistos.add(pai.id);
        pai = pai.parentId ? nodeById.get(pai.parentId) : null;
      }
    }

    const active = exams.filter((e) => e.status !== 'draft');
    const activeIds = new Set(active.map((e) => e.id));
    const activeNodes = nodes.filter((n) => activeIds.has(n.examId) && n.status !== 'draft');

    for (const exam of active) {
      await client.query(
        `INSERT INTO curriculum_items(id,version,exam_id,parent_id,kind,title,content)
         VALUES ($1,$2,$1,NULL,'exam',$3,$4::jsonb)
         ON CONFLICT(id) DO UPDATE SET
           version=EXCLUDED.version, exam_id=EXCLUDED.exam_id, parent_id=NULL,
           kind='exam', title=EXCLUDED.title, content=EXCLUDED.content, updated_at=now()`,
        [exam.id, version, exam.name, JSON.stringify(exam)],
      );
    }
    for (const node of activeNodes) {
      await client.query(
        `INSERT INTO curriculum_items(id,version,exam_id,parent_id,kind,title,content)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT(id) DO UPDATE SET
           version=EXCLUDED.version, exam_id=EXCLUDED.exam_id, parent_id=EXCLUDED.parent_id,
           kind=EXCLUDED.kind, title=EXCLUDED.title, content=EXCLUDED.content, updated_at=now()`,
        [node.id, version, node.examId, node.parentId || null, node.kind, node.title, JSON.stringify(node)],
      );
    }
    // Limpeza: só fica o catálogo ativo atual. Remove versões antigas,
    // exames retirados e nós que desapareceram (mesmo sem mudar versão).
    const manter = [...activeIds, ...activeNodes.map((n) => n.id)];
    await client.query('DELETE FROM curriculum_items WHERE NOT (id = ANY($1::text[]))', [manter]);
    return { exams: active.length, nodes: activeNodes.length };
  }

  async function importLegacy(client) {
    const base = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    const statePath = path.join(base, 'sync.json');
    const sessionsPath = path.join(base, 'sessoes.json');
    const exists = await client.query("SELECT 1 FROM app_state WHERE id='sync' LIMIT 1");
    if (!exists.rowCount) {
      try {
        const doc = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        await client.query("INSERT INTO app_state(id,payload) VALUES('sync',$1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(doc)]);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const count = await client.query('SELECT count(*)::int AS n FROM app_sessions');
    if (!Number(count.rows[0]?.n)) {
      try {
        const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
        for (const [token, payload] of Object.entries(sessions)) {
          await client.query('INSERT INTO app_sessions(token,payload) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING', [token, JSON.stringify(payload)]);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  async function init(staticExams) {
    await migrate();
    const seed = await withTransaction((client) => seedCatalog(client, staticExams));
    await withTransaction(importLegacy);
    // Migra o Exam Center do snapshot legado para linhas por entidade. A
    // migração é idempotente e mantém a mesma forma de resposta da API.
    const legacy = await query("SELECT payload FROM app_state WHERE id='sync'");
    const doc = legacy.rows[0]?.payload;
    if (doc?.data?.examesV2 && typeof doc.data.examesV2 === 'object') await putState(doc);
    return seed;
  }

  async function getState() {
    const result = await query("SELECT payload FROM app_state WHERE id='sync'");
    const doc = result.rows[0]?.payload;
    if (!doc) return null;
    const exam = await readExamCenter();
    if (exam) return { ...doc, data: { ...doc.data, examesV2: exam } };
    return doc;
  }

  async function putState(value) {
    const doc = value && typeof value === 'object' ? { ...value } : value;
    const data = doc?.data && typeof doc.data === 'object' ? { ...doc.data } : null;
    const exam = data?.examesV2 && typeof data.examesV2 === 'object' ? data.examesV2 : null;
    if (data) delete data.examesV2;
    if (data) doc.data = data;
    await withTransaction(async (client) => {
      await client.query(
        "INSERT INTO app_state(id,payload) VALUES('sync',$1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()",
        [JSON.stringify(doc)],
      );
      if (exam) await writeExamCenter(client, exam);
    });
  }

  // Serializa atualizações do documento entre processos/instâncias do
  // servidor. O lock de sessão mantém-se enquanto o chamador lê e grava o
  // estado usando as operações existentes.
  async function withSyncLock(fn) {
    return withClient(async (client) => {
      await client.query("SELECT pg_advisory_lock(hashtext('study-journal:sync-state'))");
      try { return await fn(); }
      finally { await client.query("SELECT pg_advisory_unlock(hashtext('study-journal:sync-state'))"); }
    });
  }

  async function readExamCenter() {
    const [meta, records] = await Promise.all([
      query("SELECT payload FROM exam_center_state WHERE id='main'"),
      query('SELECT collection,id,payload FROM exam_records ORDER BY collection,id'),
    ]);
    if (!meta.rowCount && !records.rowCount) return null;
    const out = meta.rows[0]?.payload || {};
    for (const collection of EXAM_COLLECTIONS) out[collection] = [];
    for (const row of records.rows) {
      if (!EXAM_COLLECTIONS.includes(row.collection)) continue;
      out[row.collection].push(row.payload);
    }
    return out;
  }

  async function writeExamCenter(client, exam) {
    const meta = { ...exam };
    for (const collection of EXAM_COLLECTIONS) delete meta[collection];
    await client.query(
      "INSERT INTO exam_center_state(id,payload) VALUES('main',$1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()",
      [JSON.stringify(meta)],
    );
    for (const collection of EXAM_COLLECTIONS) {
      const items = Array.isArray(exam[collection]) ? exam[collection] : [];
      await client.query('DELETE FROM exam_records WHERE collection=$1', [collection]);
      const unique = new Map();
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        // Os IDs da app são estáveis; índice é apenas fallback para dados
        // legados malformados, sem descartar o conteúdo original.
        const id = typeof item.id === 'string' && item.id ? item.id : `legacy-${i}`;
        const current = unique.get(id);
        const stamp = (x) => Number(x?.updatedAt || x?.atualizadoEm || x?.createdAt || x?.addedAt || 0) || 0;
        if (!current || stamp(item) >= stamp(current.payload)) unique.set(id, { id, payload: item });
      }
      for (const { id, payload } of unique.values()) {
        await client.query(
          'INSERT INTO exam_records(collection,id,payload) VALUES($1,$2,$3::jsonb)',
          [collection, id, JSON.stringify(payload)],
        );
      }
    }
  }

  async function getSessions() {
    const result = await query('SELECT token,payload FROM app_sessions');
    return Object.fromEntries(result.rows.map((row) => [row.token, row.payload]));
  }

  async function getSession(token) {
    const result = await query('SELECT payload FROM app_sessions WHERE token=$1', [token]);
    return result.rows[0]?.payload || null;
  }

  async function putSession(token, payload) {
    await query(
      'INSERT INTO app_sessions(token,payload) VALUES($1,$2::jsonb) ON CONFLICT(token) DO UPDATE SET payload=EXCLUDED.payload',
      [token, JSON.stringify(payload)],
    );
  }

  async function deleteSession(token) {
    await query('DELETE FROM app_sessions WHERE token=$1', [token]);
  }

  async function putSessions(value) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM app_sessions');
      for (const [token, payload] of Object.entries(value)) {
        await client.query('INSERT INTO app_sessions(token,payload) VALUES($1,$2::jsonb)', [token, JSON.stringify(payload)]);
      }
    });
  }

  async function listFiles() {
    return (await query('SELECT id,metadata,length(content) AS tamanho FROM user_files')).rows;
  }

  async function getFile(id) {
    return (await query('SELECT metadata,content FROM user_files WHERE id=$1', [id])).rows[0] || null;
  }

  async function putFile(id, metadata, content) {
    await query(
      'INSERT INTO user_files(id,metadata,content) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO UPDATE SET metadata=EXCLUDED.metadata, content=EXCLUDED.content, updated_at=now()',
      [id, JSON.stringify(metadata), content],
    );
  }

  async function deleteFile(id) {
    await query('DELETE FROM user_files WHERE id=$1', [id]);
  }

  /* ── Workspace central ─────────────────────────────────
     A UI escreve chaves (notas, tarefas, horário, exames, ...). Cada
     operação é persistida aqui e recebe a revisão global do workspace.
     Vários processos podem escrever em paralelo: o advisory lock por
     workspace serializa leitura+escrita e evita revisões duplicadas. */

  async function workspaceEnsure(client, workspaceId) {
    await client.query('INSERT INTO workspaces(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [workspaceId]);
    await client.query(
      'INSERT INTO workspace_revisions(workspace_id,revision) VALUES($1,0) ON CONFLICT(workspace_id) DO NOTHING',
      [workspaceId],
    );
  }

  function chaveDaLinha(row) {
    return {
      key: row.key,
      value: row.value,
      deleted: Boolean(row.deleted),
      version: Number(row.version) || 0,
      updatedAt: row.updated_at || null,
    };
  }

  function ficheiroDaLinha(row) {
    return {
      id: row.id,
      nome: row.nome,
      tipo: row.tipo,
      tamanho: Number(row.tamanho) || 0,
      metadata: row.metadata || {},
      version: Number(row.version) || 0,
      updatedAt: row.updated_at || null,
      deleted: Boolean(row.deleted_at),
    };
  }

  async function workspaceRevision(workspaceId) {
    const row = await query('SELECT revision FROM workspace_revisions WHERE workspace_id=$1', [workspaceId]);
    return Number(row.rows[0]?.revision) || 0;
  }

  async function workspaceSnapshot(workspaceId) {
    const [rev, keys, files] = await Promise.all([
      workspaceRevision(workspaceId),
      query('SELECT key,value,deleted,version,updated_at FROM workspace_keys WHERE workspace_id=$1 ORDER BY key', [workspaceId]),
      query('SELECT id,nome,tipo,tamanho,metadata,version,updated_at,deleted_at FROM workspace_files WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY id', [workspaceId]),
    ]);
    return {
      workspaceId,
      revision: rev,
      keys: keys.rows.map(chaveDaLinha),
      files: files.rows.map(ficheiroDaLinha),
    };
  }

  async function workspaceChangesSince(workspaceId, since) {
    const rev = await workspaceRevision(workspaceId);
    const desde = Math.max(0, Number(since) || 0);
    if (desde > rev) return { reset: true, revision: rev, keys: [], files: [] };
    const [keys, files] = await Promise.all([
      query(
        'SELECT key,value,deleted,version,updated_at FROM workspace_keys WHERE workspace_id=$1 AND version>$2 ORDER BY key',
        [workspaceId, desde],
      ),
      query(
        'SELECT id,nome,tipo,tamanho,metadata,version,updated_at,deleted_at FROM workspace_files WHERE workspace_id=$1 AND version>$2 ORDER BY id',
        [workspaceId, desde],
      ),
    ]);
    return {
      reset: false,
      revision: rev,
      keys: keys.rows.map(chaveDaLinha),
      files: files.rows.map(ficheiroDaLinha),
    };
  }

  async function workspaceApplyOps(workspaceId, ops, updatedBy = '') {
    const validado = validarOps(ops);
    if (validado.erro) {
      const error = new Error(validado.erro);
      error.code = 'OPS_INVALIDAS';
      throw error;
    }
    return withTransaction(async (client) => {
      await workspaceEnsure(client, workspaceId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study-journal:workspace:${workspaceId}`]);
      const atual = Number((await client.query(
        'SELECT revision FROM workspace_revisions WHERE workspace_id=$1',
        [workspaceId],
      )).rows[0]?.revision) || 0;
      const proxima = atual + 1;
      const alteradas = [];
      for (const op of validado.ops) {
        // Lê primeiro para não criar revisão quando o valor não mudou.
        // (IS DISTINCT FROM no ON CONFLICT não é suportado pelo pg-mem,
        // usado nos testes; esta forma funciona em ambos.)
        const anterior = await client.query(
          'SELECT value,deleted FROM workspace_keys WHERE workspace_id=$1 AND key=$2',
          [workspaceId, op.chave],
        );
        const linha = anterior.rows[0];
        let valor = op.valor;
        if (!op.apagada && op.chave === 'study-journal-session-log' && linha) {
          valor = fundirRegistoSessoes(linha.value, valor);
        }
        if (linha && Boolean(linha.deleted) === op.apagada && (op.apagada || linha.value === valor)) continue;
        const resultado = await client.query(
          `INSERT INTO workspace_keys(workspace_id,key,value,deleted,version,updated_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(workspace_id,key) DO UPDATE SET
             value=EXCLUDED.value, deleted=EXCLUDED.deleted,
             version=EXCLUDED.version, updated_at=now(), updated_by=EXCLUDED.updated_by
           RETURNING key,value,deleted,version,updated_at`,
          [workspaceId, op.chave, valor, op.apagada, proxima, updatedBy || null],
        );
        for (const row of resultado.rows) alteradas.push(chaveDaLinha(row));
      }
      if (alteradas.length) {
        await client.query(
          'UPDATE workspace_revisions SET revision=$2, updated_at=now() WHERE workspace_id=$1',
          [workspaceId, proxima],
        );
      }
      return { revision: alteradas.length ? proxima : atual, keys: alteradas, files: [] };
    });
  }

  async function workspaceTouch(workspaceId) {
    return withTransaction(async (client) => {
      await workspaceEnsure(client, workspaceId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study-journal:workspace:${workspaceId}`]);
      const atual = Number((await client.query(
        'SELECT revision FROM workspace_revisions WHERE workspace_id=$1',
        [workspaceId],
      )).rows[0]?.revision) || 0;
      const proxima = atual + 1;
      await client.query('UPDATE workspace_revisions SET revision=$2, updated_at=now() WHERE workspace_id=$1', [workspaceId, proxima]);
      return proxima;
    });
  }

  async function workspaceListFiles(workspaceId) {
    const rows = await query(
      'SELECT id,nome,tipo,tamanho,metadata,version,updated_at,deleted_at FROM workspace_files WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at',
      [workspaceId],
    );
    return rows.rows.map(ficheiroDaLinha);
  }

  async function workspaceGetFile(workspaceId, id) {
    const row = await query(
      'SELECT id,nome,tipo,tamanho,metadata,content,version,updated_at,deleted_at FROM workspace_files WHERE workspace_id=$1 AND id=$2',
      [workspaceId, id],
    );
    const item = row.rows[0];
    if (!item || item.deleted_at) return null;
    return { ...ficheiroDaLinha(item), content: item.content };
  }

  async function workspacePutFile(workspaceId, id, metadata, content) {
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    const nome = String(meta.nome || 'ficheiro.pdf').slice(0, 200);
    const tipo = String(meta.tipo || 'application/pdf').slice(0, 100);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || []);
    return withTransaction(async (client) => {
      await workspaceEnsure(client, workspaceId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study-journal:workspace:${workspaceId}`]);
      const atual = Number((await client.query(
        'SELECT revision FROM workspace_revisions WHERE workspace_id=$1',
        [workspaceId],
      )).rows[0]?.revision) || 0;
      const proxima = atual + 1;
      await client.query(
        `INSERT INTO workspace_files(workspace_id,id,nome,tipo,tamanho,metadata,content,version)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT(workspace_id,id) DO UPDATE SET
           nome=EXCLUDED.nome, tipo=EXCLUDED.tipo, tamanho=EXCLUDED.tamanho,
           metadata=EXCLUDED.metadata, content=EXCLUDED.content,
           version=EXCLUDED.version, updated_at=now(), deleted_at=NULL`,
        [workspaceId, id, nome, tipo, bytes.length, JSON.stringify(meta), bytes, proxima],
      );
      await client.query('UPDATE workspace_revisions SET revision=$2, updated_at=now() WHERE workspace_id=$1', [workspaceId, proxima]);
      return { revision: proxima, id, tamanho: bytes.length };
    });
  }

  async function workspaceDeleteFile(workspaceId, id) {
    return withTransaction(async (client) => {
      await workspaceEnsure(client, workspaceId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study-journal:workspace:${workspaceId}`]);
      const atual = Number((await client.query(
        'SELECT revision FROM workspace_revisions WHERE workspace_id=$1',
        [workspaceId],
      )).rows[0]?.revision) || 0;
      const proxima = atual + 1;
      const apagado = await client.query(
        `UPDATE workspace_files SET deleted_at=now(), version=$3, content=''::bytea, updated_at=now()
         WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`,
        [workspaceId, id, proxima],
      );
      if (!apagado.rowCount) return { revision: atual, id, deleted: false };
      await client.query('UPDATE workspace_revisions SET revision=$2, updated_at=now() WHERE workspace_id=$1', [workspaceId, proxima]);
      return { revision: proxima, id, deleted: true };
    });
  }

  /* Migração única do snapshot antigo e dos ficheiros legados. */
  async function workspaceImportLegacy(workspaceId) {
    return withTransaction(async (client) => {
      await workspaceEnsure(client, workspaceId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study-journal:workspace:${workspaceId}`]);
      const conta = await client.query('SELECT count(*)::int AS n FROM workspace_keys WHERE workspace_id=$1', [workspaceId]);
      let importadas = 0;
      let versao = Number((await client.query(
        'SELECT revision FROM workspace_revisions WHERE workspace_id=$1',
        [workspaceId],
      )).rows[0]?.revision) || 0;
      if (!Number(conta.rows[0]?.n)) {
        const legado = await client.query("SELECT payload FROM app_state WHERE id='sync'");
        const chaves = chavesDoDocumentoLegado(legado.rows[0]?.payload?.data);
        const entradas = Object.entries(chaves);
        if (entradas.length) {
          versao = Math.max(1, versao + 1);
          for (const [key, value] of entradas) {
            await client.query(
              `INSERT INTO workspace_keys(workspace_id,key,value,deleted,version,updated_by)
               VALUES($1,$2,$3,false,$4,'migracao')
               ON CONFLICT(workspace_id,key) DO NOTHING`,
              [workspaceId, key, value, versao],
            );
            importadas += 1;
          }
          await client.query('UPDATE workspace_revisions SET revision=$2, updated_at=now() WHERE workspace_id=$1', [workspaceId, versao]);
        }
      }
      const ficheiros = await client.query('SELECT count(*)::int AS n FROM workspace_files WHERE workspace_id=$1', [workspaceId]);
      let ficheirosImportados = 0;
      if (!Number(ficheiros.rows[0]?.n)) {
        const legados = await client.query('SELECT id,metadata,content FROM user_files');
        for (const row of legados.rows) {
          const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
          const bytes = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content || []);
          await client.query(
            `INSERT INTO workspace_files(workspace_id,id,nome,tipo,tamanho,metadata,content,version)
             VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
             ON CONFLICT(workspace_id,id) DO NOTHING`,
            [workspaceId, row.id, String(meta.nome || 'ficheiro.pdf'), String(meta.tipo || 'application/pdf'), bytes.length, JSON.stringify(meta), bytes, Math.max(1, versao)],
          );
          ficheirosImportados += 1;
        }
      }
      return { keys: importadas, files: ficheirosImportados, revision: versao };
    });
  }

  function computeDataVolume(doc) {
    if (!doc || typeof doc !== 'object') return 0;
    const data = doc.data && typeof doc.data === 'object' ? doc.data : {};
    let n = 0;
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) n += v.length;
      else if (v && typeof v === 'object') n += Object.keys(v).length;
      else if (v != null) n += 1;
    }
    const exam = data.examesV2;
    if (exam && typeof exam === 'object') {
      for (const c of EXAM_COLLECTIONS) if (Array.isArray(exam[c])) n += exam[c].length;
    }
    return n;
  }

  async function syncStateByVolume(incoming) {
    return withSyncLock(async () => {
      const remote = await getState();
      const vLocal = computeDataVolume(incoming);
      const vRemote = computeDataVolume(remote);
      // Servidor vazio (arranque/deploy novo): promove o dispositivo com
      // dados, semeando o documento com uma revisão nova e um gid estável.
      if (!remote || vRemote === 0) {
        if (vLocal > 0) {
          const gid = (remote && remote.gid) || crypto.randomBytes(8).toString('hex');
          const seed = {
            rev: (remote && Number(remote.rev) || 0) + 1,
            updatedAt: new Date().toISOString(),
            gid,
            data: incoming.data,
          };
          await putState(seed);
          return { decision: 'from_local', state: seed, volumeLocal: vLocal, volumeRemote: vRemote };
        }
        return { decision: 'synced', volumeLocal: vLocal, volumeRemote: vRemote };
      }
      // Servidor já tem dados: NUNCA sobrescrever por volume. Fazer
      // putState(incoming) aqui ressuscitava dados que outro aparelho tinha
      // apagado e apagava os que este ainda não conhecia — era o "problema
      // de sempre" (adicionar/remover não sincronizava). A reconciliação
      // fica a cargo da sincronização normal (rev + fusão por secção).
      if (vLocal === 0) {
        return { decision: 'from_remote', state: remote, volumeLocal: vLocal, volumeRemote: vRemote };
      }
      return { decision: 'synced', state: remote, volumeLocal: vLocal, volumeRemote: vRemote };
    });
  }

  return {
    init, migrate, getState, putState, withSyncLock,
    computeDataVolume, syncStateByVolume,
    getSessions, getSession, putSession, deleteSession, putSessions,
    listFiles, getFile, putFile, deleteFile,
    workspaceSnapshot, workspaceChangesSince, workspaceApplyOps, workspaceTouch,
    workspaceListFiles, workspaceGetFile, workspacePutFile, workspaceDeleteFile,
    workspaceImportLegacy,
    close: () => pool.end(),
  };
}

module.exports = { createStore, sslConfig };
