'use strict';

/* Constrói o catálogo curricular a partir das notas de estudo.
   Regras:
   - IDs determinísticos a partir do caminho hierárquico (estáveis entre gerações).
   - Sem IDs duplicados, sem nós órfãos e sem um nó ser pai de si próprio.
   - Conteúdo não validado fica marcado; nunca é apresentado como oficial.
   - Biologia e Geologia resume as Aprendizagens Essenciais DGE em vigor. */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sourceDir = process.argv[2] || process.env.SYLLABUS_SOURCE_DIR;
if (!sourceDir) throw new Error('Usage: node scripts/build-syllabus.js <Obsidian folder>');
const outDir = process.env.SYLLABUS_OUT_DIR || path.join(__dirname, '..', 'data', 'static');

const TARGET_EXAM_YEAR = 2027;
const SOURCE_EXAM_YEAR = 2026;

const exams = [
  {
    id: 'disc-mat', name: 'Matemática A', color: '#7AA7D9', examCode: '635',
    years: [10, 11, 12], status: 'active', needsValidation: true,
    sourceUrls: [
      'https://aem.dge.mec.pt/pt/recursos/ensino-secundario/matematica-a',
      'https://iave.pt/wp-content/uploads/2025/11/IP-EX-MatA635-2026.pdf',
    ],
  },
  {
    id: 'disc-fqa', name: 'Física e Química A', color: '#6FBF8E', examCode: '715',
    years: [10, 11], status: 'active', needsValidation: true,
    sourceUrls: [
      'https://www.dge.mec.pt/fisica-e-quimica-0',
      'https://iave.pt/wp-content/uploads/2025/11/IP-EX-FQA715-2026.pdf',
    ],
  },
  {
    id: 'disc-bio', name: 'Biologia e Geologia', color: '#C18AE0', examCode: '702',
    years: [10, 11], status: 'active', needsValidation: false,
    sourceUrls: [
      'https://www.dge.mec.pt/biologia-e-geologia',
      'https://iave.pt/wp-content/uploads/2025/11/IP-EX-BG702-2026.pdf',
      'https://www.dge.mec.pt/sites/default/files/Curriculo/Aprendizagens_Essenciais/10_biologia_e_geologia.pdf',
      'https://www.dge.mec.pt/sites/default/files/Curriculo/Aprendizagens_Essenciais/11_biologia_e_geologia.pdf',
    ],
    note: 'Domínios e tópicos baseados nas Aprendizagens Essenciais DGE em vigor. Confirmar a Informação-Prova de 2027 quando for publicada; a referência IAVE incluída é a prova de 2026.',
  },
  {
    id: 'disc-pt', name: 'Português', color: '#E0A458', examCode: '639',
    years: [10, 11, 12], status: 'active', needsValidation: true,
    sourceUrls: [
      'https://dge.mec.pt/aprendizagens-essenciais-ensino-secundario',
      'https://iave.pt/wp-content/uploads/2025/11/IP-EX-Port639-2026.pdf',
    ],
    note: 'Conteúdos transcritos das notas pessoais Revisao_exame; validar seleção e obras contra a Informação-Prova de 2027.',
  },
];

function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}
function clean(s) {
  return s.replace(/\[[ xX]\]\s*/g, '').replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/\s*[🔥⭐○]+\s*/g, '').trim();
}
function importance(s) { return /🔥/.test(s) ? 5 : /⭐/.test(s) ? 4 : /○/.test(s) ? 2 : 3; }

function makeId(examId, pathParts, usedIds, pathKeys, pathKey) {
  const base = `${examId}:${slug(pathParts.join(':'))}`.slice(0, 120);
  let id = base || `${examId}:sem-titulo`;
  if (usedIds.has(id) && usedIds.get(id) !== pathKey) id = `${base}-${shortHash(pathKey)}`;
  let n = 2;
  while (usedIds.has(id) && usedIds.get(id) !== pathKey) {
    id = `${base}-${shortHash(pathKey)}-${n}`;
    n += 1;
  }
  return id;
}

function parseMarkdown(file, exam) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const nodes = [];
  const usedIds = new Map();
  const pathKeys = new Set();
  let section = '';
  let domainNode = null;
  let themeNode = null;
  let themePriority = 3;
  let stack = [];
  let duplicados = 0;

  function add(title, kind, parent, imp, pathParts) {
    const pathKey = pathParts.join('\u0000');
    if (pathKeys.has(pathKey)) { duplicados += 1; return null; }
    const id = makeId(exam.id, pathParts, usedIds, pathKeys, pathKey);
    pathKeys.add(pathKey);
    usedIds.set(id, pathKey);
    const node = {
      id, examId: exam.id, parentId: parent ? parent.id : null,
      kind, title: clean(title), description: '', importance: imp || 3,
      difficulty: 3, source: 'obsidian-plan-2026-2027',
      needsValidation: true, status: 'active',
      _path: pathParts, _depth: pathParts.length - 1,
    };
    nodes.push(node);
    return node;
  }

  for (const line of lines) {
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h2) {
      const heading = clean(h2[1]);
      if (/prioridade|mais sai/i.test(heading)) {
        section = ''; domainNode = null; themeNode = null; stack = [];
        continue;
      }
      section = heading;
      const domain = add(heading, 'domain', null, importance(h2[1]), [heading]);
      domainNode = domain;
      stack = domain ? [domain] : [];
      themeNode = null;
      continue;
    }
    if (h3) {
      if (!section) continue;
      const theme = clean(h3[1]);
      themePriority = importance(h3[1]);
      const parent = domainNode || stack[0] || null;
      themeNode = add(theme, 'theme', parent, importance(h3[1]), parent ? [...parent._path, theme] : [section, theme]);
      stack = themeNode ? [themeNode] : [];
      continue;
    }
    if (!section || !themeNode) continue;
    const item = /^(\s*)-\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line);
    if (!item) continue;
    const indent = item[1].replace(/\t/g, '    ').length;
    const level = indent === 0 ? 0 : Math.min(4, Math.ceil(indent / 4));
    const title = item[2].replace(/\s+$/, '');
    if (/^\*?legenda|^>/.test(title)) continue;
    const parent = level === 0 ? themeNode : (stack[level] || stack[stack.length - 1] || themeNode);
    const pathParts = parent && parent._path ? [...parent._path, clean(title)] : [section, clean(title)];
    const itemPriority = /🔥|⭐|○/.test(title) ? importance(title) : themePriority;
    const node = add(title, level === 0 ? 'subtheme' : 'topic', parent, itemPriority, pathParts);
    if (!node) continue;
    stack[level + 1] = node;
    stack.length = level + 2;
  }

  return { nodes, duplicados };
}

function parseChecklist(file, exam) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const nodes = [];
  const used = new Map();
  let domain = null;
  let theme = null;
  let contentGroup = null;
  let section = 'Topicos';
  let duplicates = 0;
  function add(title, kind, parent, pathParts, imp = 3) {
    const key = pathParts.join('\u0000');
    let id = makeId(exam.id, pathParts, used, new Set(), key);
    if (used.has(id) && used.get(id) !== key) id = `${id}-${shortHash(key)}`;
    if (used.has(id)) { duplicates += 1; return null; }
    used.set(id, key);
    const node = { id, examId: exam.id, parentId: parent?.id || null, kind, title: clean(title), description: '', importance: imp, difficulty: 3, source: 'obsidian-revisao-exame', needsValidation: true, status: 'active', _path: pathParts };
    nodes.push(node);
    return node;
  }
  for (const line of lines) {
    const label = /^\s*([^\-].+):\s*$/.exec(line);
    if (label) {
      section = label[1].trim();
      const domainTitle = section.toLowerCase().includes('import') ? 'Tópicos prioritários' : 'Conteúdos programáticos';
      domain = add(domainTitle, 'domain', null, [domainTitle]);
      theme = null; contentGroup = null;
      continue;
    }
    const item = /^(\s*)-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
    if (!item) continue;
    const depth = Math.floor(item[1].replace(/\t/g, '    ').length / 4);
    const title = clean(item[2]);
    if (depth === 0) {
      if (!domain) domain = add('Conteúdos programáticos', 'domain', null, ['Topicos']);
      const priority = /maior presença|importante|🔥|⭐/i.test(item[2]) ? 5 : 3;
      theme = add(title, 'theme', domain, [...domain._path, title], priority);
      contentGroup = theme ? add('Conteúdos', 'subtheme', theme, [...theme._path, 'Conteúdos'], priority) : null;
      continue;
    }
    if (!theme) continue;
    if (depth === 1) {
      const parent = contentGroup || theme;
      const imp = /🔥|⭐/.test(item[2]) ? importance(item[2]) : theme.importance;
      add(title, 'topic', parent, [...parent._path, title], imp);
    } else {
      const parent = contentGroup || theme;
      const subtheme = add(title, 'subtheme', parent, [...parent._path, title], theme.importance);
      if (subtheme) contentGroup = subtheme;
    }
  }
  return { nodes, duplicados: duplicates };
}

const nodeList = [];
const relatorio = [];
for (const [exam, file] of [[exams[0], 'Topicos-Matematica.md'], [exams[1], 'Topicos-FQ.md'], [exams[3], 'Topicos-Portugues.md']]) {
  const full = path.join(sourceDir, file);
  if (!fs.existsSync(full)) throw new Error(`Missing source: ${full}`);
  const parsed = parseChecklist(full, exam);
  nodeList.push(...parsed.nodes);
  relatorio.push({ exam: exam.id, nodes: parsed.nodes.length, duplicadosIgnorados: parsed.duplicados });
}

/* Biologia e Geologia segue os domínios das AE DGE em vigor; os tópicos
   resumem descritores curriculares. A Informação-Prova 2027 ainda deve ser confirmada. */
function addBioNode(exam, pathParts, title, kind, parent) {
  const pathKey = pathParts.join('\u0000');
  const id = `${exam.id}:${slug(pathParts.join(':'))}`.slice(0, 120);
  const node = {
    id, examId: exam.id, parentId: parent ? parent.id : null, kind,
    title, description: kind === 'topic' ? `Aprendizagem essencial: ${title}.` : '', importance: 3, difficulty: 3,
    source: 'DGE-Aprendizagens-Essenciais-2018-in-force',
    needsValidation: false, status: 'active',
    _path: pathParts,
  };
  nodeList.push(node);
  return node;
}

const bio = exams[2];
const bioCurriculum = [
  { year:'10.º ano', areas:[
    { title:'Geologia', domains:[
      ['Geologia e métodos',['Interações entre atmosfera, biosfera, geosfera e hidrosfera','Ciclo litológico e génese das rochas','Atualismo, catastrofismo e uniformitarismo','Tectónica de placas, limites, riftes e subducção','Datação relativa e radiométrica','Escala do tempo geológico']],
      ['Estrutura e dinâmica da geosfera',['Vulcanismo, composição das lavas e edifícios vulcânicos','Ondas sísmicas, sismogramas e localização do epicentro','Zonas de sombra e descontinuidades internas','Modelos composicional e físico da estrutura da Terra','Métodos diretos e indiretos, geomagnetismo e geotermia']],
    ]},
    { title:'Biologia', domains:[
      ['Biodiversidade',['Interações bióticas e abióticas, extinção e conservação','Hierarquia biológica e organização dos ecossistemas','Células procarióticas, eucarióticas, animais e vegetais','Biomoléculas e função enzimática','Observação microscópica de células e tecidos']],
      ['Obtenção de matéria',['Ingestão, digestão e absorção em seres heterotróficos','Modelo do mosaico fluido e biomoléculas da membrana','Difusão, osmose e transporte ativo','Endocitose, exocitose e organelos na digestão intracelular','Transporte transmembranar e impulso nervoso','Fotossíntese: pigmentos, fases e balanço de produtos']],
      ['Distribuição de matéria',['Transporte no xilema e floema','Pressão radicular, adesão-coesão-tensão e fluxo de massa','Sistemas circulatórios abertos e fechados nos animais','Composição e funções do sangue e da linfa']],
      ['Transformação e utilização de energia pelos seres vivos',['Fermentação alcoólica e lática','Respiração aeróbia, balanço energético e glicólise','Trocas gasosas em seres vivos','Fotossíntese e utilização de energia']],
    ]},
  ]},
  { year:'11.º ano',areas:[
    { title:'Biologia',domains:[
      ['Crescimento, renovação e diferenciação celular',['Ácidos nucleicos: composição, estrutura e função','Replicação, transcrição, tradução e código genético','Expressão génica, proteínas, metabolismo e mutações','Ciclo celular, mitose e citocinese']],
      ['Reprodução',['Reprodução assexuada: bipartição, fragmentação, gemulação, esporulação e propagação vegetativa','Meiose, fecundação e variabilidade genética','Ciclos de vida haplonte, diplonte e haplodiplonte','Estruturas reprodutoras em plantas, fungos e animais']],
      ['Evolução biológica',['Modelos autogénico e endossimbiótico','Lamarckismo, Darwinismo e teoria sintética da evolução','Evolução convergente e divergente e evidências biológicas']],
      ['Sistemática dos seres vivos',['Sistemas de classificação práticos, racionais, fenéticos e filogenéticos','Sistema de Whittaker modificado e classificação em três domínios','Categorias taxonómicas e regras de nomenclatura biológica']],
    ]},
    { title:'Geologia',domains:[
      ['Sedimentação e rochas sedimentares',['Génese, textura e classificação das rochas sedimentares','Fósseis de idade e de fácies','Princípios de datação relativa','Identificação de minerais e propriedades físicas']],
      ['Magmatismo e rochas magmáticas',['Textura, composição mineralógica e química','Diferenciação magmática e cristalização fracionada','Classificação de rochas magmáticas e identificação laboratorial']],
      ['Deformação de rochas',['Tensões e comportamento frágil ou dúctil','Dobras, antiformas, sinformas, anticlinais e sinclinais','Falhas normais, inversas e desligamentos']],
      ['Metamorfismo e rochas metamórficas',['Fatores de metamorfismo regional e de contacto','Foliação, textura e composição mineralógica','Classificação e identificação laboratorial de rochas metamórficas']],
      ['Exploração sustentada de recursos geológicos',['Recursos, reservas e jazigos','Exploração de minerais, rochas e recursos energéticos','Aquíferos livres e cativos','Sustentabilidade e impactes da exploração']],
    ]},
  ]},
];
for (const year of bioCurriculum) {
  const domain = addBioNode(bio,[year.year],year.year,'domain',null);
  for (const area of year.areas) {
    const theme = addBioNode(bio,[year.year,area.title],area.title,'theme',domain);
    for (const [domainTitle,topics] of area.domains) {
      const subtheme=addBioNode(bio,[year.year,area.title,domainTitle],domainTitle,'subtheme',theme);
      for(const topicTitle of topics)addBioNode(bio,[year.year,area.title,domainTitle,topicTitle],topicTitle,'topic',subtheme);
    }
  }
}
relatorio.push({ exam: bio.id, nodes: nodeList.filter((n) => n.examId === bio.id).length, duplicadosIgnorados: 0, status: 'active' });

// Campos internos ficam fora do JSON público.
for (const node of nodeList) { delete node._path; delete node._depth; }

const activeNodes = nodeList.filter((n) => n.status === 'active');
const draftNodes = nodeList.filter((n) => n.status === 'draft');
const catalog = {
  schemaVersion: 1,
  version: '2026-11.4',
  generatedAt: new Date().toISOString(),
  targetExamYear: TARGET_EXAM_YEAR,
  sourceExamYear: SOURCE_EXAM_YEAR,
  sourceNotes: path.basename(path.resolve(sourceDir)),
  notes: 'Este catálogo não é uma publicação oficial; validar Matemática A, Física e Química A e Português das notas pessoais Revisao_exame contra as fontes oficiais. Biologia e Geologia mantém a seleção anterior baseada nas Aprendizagens Essenciais DGE em vigor, pois não existe ficheiro dessa disciplina na nova pasta. Confirmar as Informações-Prova do ano alvo (2027) quando publicadas.',
  exams,
  nodes: activeNodes,
  draftNodes,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'exams.json'), `${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({
  schemaVersion: catalog.schemaVersion,
  version: catalog.version,
  targetExamYear: catalog.targetExamYear,
  sourceExamYear: catalog.sourceExamYear,
  generatedAt: catalog.generatedAt,
  nodeCount: nodeList.length,
  activeNodeCount: activeNodes.length,
  draftNodeCount: nodeList.length - activeNodes.length,
  exams: exams.map((e) => ({ id: e.id, status: e.status })),
}, null, 2)}\n`);
console.log(`Wrote ${catalog.nodes.length} nodes (${activeNodes.length} active) to data/static/exams.json`);
for (const r of relatorio) console.log(`  ${r.exam}: ${r.nodes} nodes${r.duplicadosIgnorados ? `, ${r.duplicadosIgnorados} duplicates skipped` : ''}${r.status ? ` (${r.status})` : ''}`);
