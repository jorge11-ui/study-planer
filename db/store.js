'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

  return {
    init, migrate, getState, putState,
    getSessions, putSession, deleteSession, putSessions,
    listFiles, getFile, putFile, deleteFile,
    close: () => pool.end(),
  };
}

module.exports = { createStore, sslConfig };
