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

`/api/workspace` é agora o endpoint canónico de dados: a UI escreve chaves
(`study-journal-*`) e o servidor guarda-as em `workspace_keys`, com uma revisão
global por workspace. `/api/data` e `/api/sync` mantêm-se temporariamente como
alias do documento antigo para clientes em cache; o cliente novo já não os usa.
Um push antigo para `/api/data` é convertido em operações para o workspace
(`lib/workspace-protocol.js`): só viajam as chaves que esse push mudou, uma
chave com carimbo `-ts` só ganha se for mais recente do que a versão central,
e listas com tombstones/minutos de estudo são unidas. Assim um separador com
código em cache não perde nem reverte dados novos enquanto não recarrega.
Os bytes dos ficheiros vivem em `workspace_files` e são servidos por
`/api/ficheiros` (a mesma API de upload/download/remoção de antes), com
`cache-control: private, no-store` para uma remoção central valer logo em todos
os aparelhos.

### Workspace central

- `workspaces` / `workspace_revisions`: um único workspace partilhado
  (`WORKSPACE_ID`, por omissão `default`) e a revisão global.
- `workspace_keys`: uma linha por chave, com `value` textual, `deleted`
  (tombstone), `version` e `updated_by`. O valor é exatamente o que o browser
  usa em `localStorage`, pelo que a UI continua síncrona.
- `workspace_files`: metadados + bytes (BYTEA), versão e tombstone. A remoção
  central apaga os bytes e propaga-se a todos os aparelhos.
- `GET /api/workspace/snapshot` devolve o estado completo;
  `GET /api/workspace/changes?since=N` devolve só o delta;
  `POST /api/workspace/ops` aplica operações `{key,value}` ou `{key,deleted}`;
  `GET /api/workspace/events` é o SSE que avisa os outros aparelhos.
- A última escrita de uma chave ganha. Chaves do aparelho (token da conta,
  Gist, vault, vista, aba, estado do cronómetro, ids internos) nunca viajam.

No arranque com PostgreSQL, `db/store.js` aplica migrations serializadas com
advisory lock e semeia exames e nós curriculares por ID. `curriculum_items` é
derivável do JSON; o progresso pessoal fica separado. A migration 002 move as
coleções do Exam Center (`topics`, `sessions`, `practice`, `reviews`, etc.) para
`exam_records`, com uma linha por registo, chave `(collection,id)` e payload
JSONB. A migration 003 cria o workspace central.
O primeiro arranque importa o documento antigo (`app_state`) e os ficheiros
legados (`user_files` ou `DATA_DIR/ficheiros`) para o workspace, sem apagar os
originais. A importação é idempotente e não volta a correr quando já há chaves.

Antes de apontar produção para uma base nova, exporta `DATA_DIR/sync.json`,
`sessoes.json` e PDFs disponíveis. Dados que já desapareceram do filesystem
efémero não podem ser recuperados por uma migração. Migrações de schema vivem em
`db/migrations/`; acrescenta novas migrations, sem editar as já aplicadas.

TLS valida certificados por padrão. `PGSSL=disable` é só para PostgreSQL local;
`PGSSL=no-verify` destina-se apenas a fornecedores cuja CA não esteja disponível.

O browser mantém `localStorage` apenas como cópia local para arranque e
funcionamento offline. `src/workspace-sync.js` interceta as escritas nas chaves
sincronizáveis, envia-as como operações, recebe deltas por SSE e repõe o cache
local; a fonte de verdade é sempre o servidor. Ao voltar à app, ao recuperar
rede ou a cada 15 s há um novo pedido de alterações. O documento agregado
antigo, o Gist e o motor de sync da conta ficam desativados quando o workspace
está presente, para não haver dois donos do mesmo estado.


## Verificação local

```sh
npm test
npm run check
```

O store é exercitado com `pg-mem`, que não substitui um teste com PostgreSQL real.
Os testes HTTP validam endpoints e reinício do processo com o diretório persistente
local; um redeploy real depende de `DATABASE_URL` e acesso ao serviço Render.
