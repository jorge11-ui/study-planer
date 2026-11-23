# Dados curriculares e dados pessoais

## Catálogo curricular

`data/static/exams.json` e `manifest.json` são dados versionados e distribuídos
com a aplicação. A app lê-os como ficheiros estáticos; não os gera no arranque.
IDs derivam da hierarquia curricular e são determinísticos. A versão atual do
catálogo está no campo `version`.

- Matemática A, Física e Química A e Português: importados de
  `/home/jorge/obsidian_notes/Revisao_exame`, marcados para validação contra a
  Informação-Prova de 2027. A lista de Português inclui obras/autores das notas
  pessoais e não substitui a matriz oficial.
- Biologia e Geologia: tópicos resumidos das Aprendizagens Essenciais em vigor
  da DGE (10.º e 11.º anos), mantidos por não haver ficheiro de BioGeo na nova
  pasta. Confirmar a Informação-Prova 2027 quando publicada.

Fontes oficiais: [DGE — Matemática A](https://aem.dge.mec.pt/pt/recursos/ensino-secundario/matematica-a),
[DGE — Física e Química](https://www.dge.mec.pt/fisica-e-quimica-0),
[DGE — Biologia e Geologia](https://www.dge.mec.pt/biologia-e-geologia),
[DGE — Aprendizagens Essenciais do Secundário](https://dge.mec.pt/aprendizagens-essenciais-ensino-secundario),
[IAVE — Português 639 (2026)](https://iave.pt/wp-content/uploads/2025/11/IP-EX-Port639-2026.pdf).
O ecrã do tópico mantém o aviso de validação para conteúdos pessoais ainda não
confirmados. Atualizações do currículo alteram apenas os metadados curriculares;
os campos pessoais e progresso são preservados pelo ID estável.

Para regenerar Matemática A/FQA a partir das notas:

```sh
node scripts/build-syllabus.js "/home/jorge/obsidian_notes/Revisao_exame"
```

## Persistência PostgreSQL

Em produção, define `DATABASE_URL` no serviço Render e liga-o ao PostgreSQL
gerido. Nunca coloques a connection string no Git. Em local, cria uma base
separada e configura `.env` a partir de `.env.example`; esse ficheiro é ignorado
pelo Git. Sem `DATABASE_URL`, o modo de desenvolvimento existente usa `DATA_DIR`
local, configurável e independente do disco efémero de produção.

Há dois modos de acesso, escolhidos no arranque:

- **Conta** (recomendado para um endereço partilhado): define `SYNC_USER` e
  `SYNC_PASS`. Em Render, sem estes valores o processo não arranca. APIs de
  dados, vault e ficheiros recusam chamadas sem sessão; no modo local sem conta
  só aceitam pedidos loopback.
- **Link privado** (`SYNC_OPEN=1`): qualquer aparelho que abra o endereço lê e
  grava o mesmo documento sem login. É o modo usado pelo `render.yaml` para o
  link pessoal sincronizar sozinho em todas as secções. Só o deves manter num
  endereço que não partilhes: quem tiver o link passa a poder ver e alterar os
  dados. Remove `SYNC_OPEN` (ou põe `0`) para voltares a exigir sessão.

`/api/data` é o endpoint canónico de sync/versionamento; `/api/sync` permanece
temporariamente como alias para clientes antigos.

No arranque com PostgreSQL, `db/store.js` aplica migrations serializadas com
advisory lock e semeia exames e nós curriculares por ID. `curriculum_items` é
derivável do JSON; o progresso pessoal fica separado. A migration 002 move as
coleções do Exam Center (`topics`, `sessions`, `practice`, `reviews`, etc.) para
`exam_records`, com uma linha por registo, chave `(collection,id)` e payload
JSONB. A API continua a devolver `examesV2` no formato anterior para manter
compatibilidade; a estrutura relacional e os endpoints por coleção continuam
a ser trabalho futuro.
Os restantes dados pessoais ainda estão no snapshot JSONB `app_state` e serão
migrados por fases. Sessões de autenticação e bytes de ficheiros têm tabelas
próprias. O primeiro arranque importa ficheiros legados locais quando existem;
os originais não são eliminados.

Antes de apontar produção para uma base nova, exporta `DATA_DIR/sync.json`,
`sessoes.json` e PDFs disponíveis. Dados que já desapareceram do filesystem
efémero não podem ser recuperados por uma migração. Migrações de schema vivem em
`db/migrations/`; acrescenta novas migrations, sem editar as já aplicadas.

TLS valida certificados por padrão. `PGSSL=disable` é só para PostgreSQL local;
`PGSSL=no-verify` destina-se apenas a fornecedores cuja CA não esteja disponível.

O browser ainda mantém uma cópia local para funcionamento offline. Depois de
autenticar (ou de o link privado estar em `SYNC_OPEN=1`), o servidor é o
armazenamento persistente e a cópia sincroniza com ele. O documento de sync já
inclui as secções todas: notas e tarefas por dia, metadados/índice das notas,
horário (todas as semanas e preferências), Exam Center e revisão, PDFs e Caderno
(metadados e tombstones; bytes em `/api/ficheiros`), sessões/estatísticas e
registo de sessões, objetivo, Assistente, Quadro Branco e nota rápida. O queue
de ficheiros por aparelho (`*-enviados`) e o vault continuam locais.

## Verificação local

```sh
npm test
npm run check
```

O store é exercitado com `pg-mem`, que não substitui um teste com PostgreSQL real.
Os testes HTTP validam endpoints e reinício do processo com o diretório persistente
local; um redeploy real depende de `DATABASE_URL` e acesso ao serviço Render.
