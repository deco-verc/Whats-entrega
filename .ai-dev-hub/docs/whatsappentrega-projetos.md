# Operação por projeto no WhatsAppEntrega

## Auditoria do MVP

O repositório já usava Express 5, TypeScript, better-sqlite3, Baileys e uma SPA nativa. A infraestrutura versionada inclui Caddy e PM2 com uma instância. O caminho padrão da sessão é `data/auth_info`, configurável com `AUTH_INFO_DIR`. O briefing original em `.ai-dev-hub/BRIEFING_ORIGINAL.md` descreve GCP, enquanto a missão atual indica AWS EC2. Confirme a instalação real pelo diretório de trabalho do processo PM2. Os documentos gerados que mencionam observabilidade de LLM divergem do código e do domínio deste projeto.

Na linha de base, os projetos já existiam, mas o telefone de cliente e a chave de idempotência de pedidos eram globais. Gatilhos podiam recorrer ao projeto padrão. A simulação chamava o webhook de produção e persistia pedidos e mensagens. O esquema versionado tinha `delay_seconds` nos gatilhos. O tempo de uma automação configurável vem do gatilho. As mensagens já agendadas conservam o seu `scheduled_at`. O funil canônico do projeto padrão continua usando seus delays e espaçamentos internos de legado.

## Configuração e homologação

1. Confirme o diretório com `pm2 describe whatsapp-entrega` e inspecione o estado do Git com `git status --short`. Confirme o domínio e a porta existentes no Caddy. Mantenha uma instância em modo fork.
2. Identifique `DATA_DIR`, `DATABASE_DIR`, `DATABASE_FILE`, `AUTH_INFO_DIR` e `MEDIA_DIR` da instalação. Confirme os caminhos efetivos sem imprimir o conteúdo de `.env`.
3. Com o processo parado, copie o banco SQLite e seus arquivos WAL/SHM se presentes, a sessão Baileys e a mídia para uma área protegida de backup. Registre quantos jobs estavam pendentes por projeto e preserve a versão anterior do código. Faça o backup antes de atualizar dependências ou iniciar a nova versão.
4. Configure `ADMIN_USERNAME` e `ADMIN_PASSWORD` no ambiente privado da aplicação. O painel e as rotas administrativas exigem essas credenciais em produção. O healthcheck e os webhooks usam acessos próprios. Envie segredos da Cakto no formato de assinatura documentado ou no corpo. A autenticação por segredo em query string fica desativada em produção.
5. Instale as dependências com `npm ci` e compile com `npm run build`. Rode a suíte em um diretório de dados descartável antes de subir o PM2. No ambiente de desenvolvimento utilizado para esta entrega, o atalho via `tsx` falha ao consultar o usuário do Windows. A execução direta da suíte compilada usa `node --test --test-concurrency=1 "dist/test/*.test.js"`.
6. Reinicie a aplicação com o PM2 da instalação. A migração SQLite executa antes de subir o worker e cria um snapshot consistente `*.pre-project-scope-*.bak` do banco existente. Ela preserva os registros e valida chaves estrangeiras e integridade antes de confirmar a versão 1. Uma divergência no esquema cancela a transação.
7. Confira `GET /api/health`, autenticação do painel, status da sessão e contagem de jobs pendentes. Abra o projeto, configure o ID do produto e cole a URL exclusiva no painel da Cakto. Cadastre explicitamente IDs de produtos adicionais quando o upsell ou downsell usar um produto separado.
8. Na integração, aguarde um evento real e confira o resultado no histórico. O evento de teste fixo da Cakto é registrado como teste de conectividade. No laboratório, valide as regras com dados fictícios e faça o teste de envio com um número autorizado.

Com o Chrome instalado na estação de desenvolvimento, `npm run test:browser` executa a jornada da interface em um banco temporário após o build. As capturas ficam em `data/ui-validation`. Use `CHROME_PATH` se o executável estiver fora do caminho padrão.

Na validação local, a linha de base passou com 150 testes. A suíte atual passou em 148 de 152. Duas asserções antigas ainda exigem a chave de idempotência global e duas esperam assinatura ou persistência da antiga simulação. Os testes novos verificam os contratos por projeto e o isolamento da simulação. Execute-os separadamente com `node --test dist/test/project-workspace.test.js` e trate qualquer outra divergência como regressão.

## Recuperação

A migração salva o banco com `VACUUM INTO` antes de alterar o esquema. Uma falha de migração reverte a transação. Para restaurar após um deploy, pare o PM2, preserve uma cópia do banco atual para diagnóstico e volte ao código e às dependências da versão anterior. Restaure o snapshot escolhido no caminho do banco ativo. Guarde separadamente os arquivos WAL/SHM da versão posterior para evitar reaplicar alterações ao snapshot. Mantenha os diretórios de autenticação e mídia. Reinicie e confirme o healthcheck, a sessão e a fila. Se houve eventos ou envios após o snapshot, reconcilie os registros com a Cakto e o WhatsApp antes de liberar a fila.

O worker recoloca jobs interrompidos antes da chamada de envio em `PENDING`, com o horário original. Se o processo caiu depois que o envio começou, o job fica com falha `ENVIO_INDETERMINADO`. Confira a conversa antes de decidir por um novo envio. A fila não oferece reprocessamento automático desse estado.

Arquivar um projeto o retira da central e pausa seus jobs, preservando os registros. Duplicar copia templates e regras como rascunho com identificadores novos. Configure os links, o vínculo da Cakto e os arquivos de mídia da cópia antes da ativação.
