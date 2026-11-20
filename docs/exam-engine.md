# Exam Preparation Engine

## Planeamento

`src/exam-engine.js` contém a lógica sem dependências de interface. A pontuação
pondera lacuna de domínio (28%), importância (18%), revisão devida (17%),
resultados de exercícios (12%), tempo sem estudo (10%), dificuldade (8%) e
proximidade do exame (7%). Os planos diários, semanais e mensais usam essa mesma
ordenação, aplicam limites de tempo e equilibram a carga configurada por disciplina.
Cada sessão contém atividade, duração, objetivo e justificação rastreável.

O estado “Concluído” não equivale a 100% de domínio. O domínio estimado é um
campo separado, atualizado por sessões (resultados e confiança) ou correção
manual. O utilizador pode declarar pré-requisitos ao editar um tópico; o motor
só agenda o tópico dependente depois de cada pré-requisito atingir 60% de domínio.

Depois de uma sessão, a revisão seguinte é definida por desempenho e domínio,
usando intervalos adaptativos derivados da sequência 1/3/7/14/30 dias. Domínio
fraco ou baixa taxa de acerto antecipa a revisão; domínio consistente aumenta o
intervalo até 60 dias. Planos regenerados ficam no histórico e substituem apenas
o plano ativo.

## Modelo de conteúdo e limitações

A hierarquia interna usa nós `domain`, `theme`, `subtheme` e `topic`. Matemática
A, Física e Química A e Português vêm agora de
`/home/jorge/obsidian_notes/Revisao_exame`; a lista de Português é uma seleção
pessoal de obras/autores. Biologia e Geologia mantém o catálogo anterior baseado
nas AE DGE porque a nova pasta não contém tópicos dessa disciplina. A UI permite
pesquisar/filtrar e expandir os grupos; edição de nome, descrição, estado,
domínio, prioridade, dificuldade, confiança, notas, dificuldades e pré-requisitos
é persistente. Os tópicos importados das notas permanecem sinalizados para
validação curricular. A Informação-Prova aplicável ao ano 2027 deve ser confirmada
quando publicada.

O progresso continua no documento de sync existente do Study Journal, sincronizado
com PostgreSQL em produção. Isso preserva compatibilidade com tarefas, notas e
calendário sem criar um segundo sistema de utilizadores; tabelas relacionais
curriculares guardam o catálogo e os metadados da seed.
