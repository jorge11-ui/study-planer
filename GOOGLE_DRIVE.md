# Google Drive

O StudyJournal guarda ficheiros em `Meu Drive/StudyJournal/Diario` e
`Meu Drive/StudyJournal/PDFs`. A ligação usa OAuth no servidor. O token de
atualização fica em `data/google-drive-token.json`; não partilhes nem publiques
esse ficheiro.

## Configuração

1. No [Google Cloud Console](https://console.cloud.google.com/), cria ou escolhe
   um projeto e ativa a **Google Drive API**.
2. Configura o ecrã de consentimento OAuth e adiciona a tua conta como utilizador
   de teste, se a aplicação estiver em modo de teste.
3. Cria um ID de cliente OAuth do tipo **Aplicação Web**. Em **URIs de
   redirecionamento autorizados**, adiciona exatamente:
   `https://TEU-DOMINIO/api/drive/callback`
4. Define estas variáveis no servidor (por exemplo, no painel do Render):
   - `GOOGLE_CLIENT_ID`: ID de cliente OAuth
   - `GOOGLE_CLIENT_SECRET`: segredo do cliente OAuth
   - `GOOGLE_REDIRECT_URI`: o mesmo URI de redirecionamento autorizado
5. Reinicia o servidor, abre **Definições → Google Drive** e liga a tua conta.

O servidor precisa de HTTPS para o fluxo OAuth. Em alojamentos com disco
efémero, monta armazenamento persistente em `DATA_DIR` para o token continuar
disponível depois de reinícios. O `render.yaml` já declara as variáveis; o disco
persistente do Render exige configuração no serviço.

A primeira autorização também envia as notas, tarefas, metadados dos PDFs e
ficheiros PDF que este browser consegue ler. Notas que existam apenas noutro
vault local ou PDFs que já não estejam no IndexedDB deste browser precisam de
ser importados separadamente.

Em modo **Testing**, a autorização de utilizadores externos expira após sete
dias; para uso contínuo, publica a aplicação conforme as regras da Google. O
app pede apenas o âmbito `drive.file`, para limitar o acesso aos ficheiros que
cria no Drive.
