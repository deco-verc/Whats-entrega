# Visão Geral e Escopo do Produto (DecoHUB Living Spec)

## Especificação de Conteúdo e REA

# ESPECIFICAÇÃO DE PRODUTO, SEÇÕES & REA (CONTEUDO.MD)

> **Fonte Única de Verdade da Onda 0:** Este documento é o mapa canônico da interface, fluxos e conteúdo do **WhatsappEntrega**. Toda implementação frontend e backend deve cumprir rigorosamente as seções enumeradas abaixo.

---

## 1. Resumo Executivo & Benchmark de Mercado
- **Projeto:** WhatsappEntrega
- **Nicho & Domínio:** AI Automation, LLM Observability & Agents
- **Público-Alvo:** Engenheiros de IA, desenvolvedores e equipes de automação que constroem, monitoram e avaliam pipelines de LLM, execuções de agentes e custos de tokens.
- **Aplicativos de Referência Mapeados:** LangSmith, Vercel AI Playground, Linear, Raycast, OpenRouter
- **Diagnóstico Competitivo de Mercado:**
  Plataformas modernas de observabilidade de IA fornecem tracing granular de execuções passo a passo (spans), medição de latência P95 em ms, contabilidade de custo de tokens e playground interativo com fallback de modelos.
- **Briefing Original do Usuário:**
  *"# ROLE & OBJECTIVE
Você é um Arquiteto de Software Sênior especialista em sistemas de automação de Direct Response no WhatsApp, Node.js, TypeScript, SQLite (`better-sqlite3`) e na biblioteca `@whiskeysockets/baileys`.

Sua missão é projetar e especificar de ponta a ponta um sistema monolítico modular auto-hospedado (rodando em uma VPS Ubuntu no Google Cloud) que recebe Webhooks da plataforma de pagamentos **Cakto** e executa automaticamente um funil completo de **Recuperação de Pix + Entrega Imediata -> Upsell 1 -> Upsell 2 / Downsell** via WhatsApp.

---

# 1. STACK TECNOLÓGICA & DOCUMENTAÇÕES DE REFERÊNCIA

## Stack Obrigatória
- **Runtime & Linguagem:** Node.js (LTS) + TypeScript (Strict Mode).
- **Servidor HTTP (Webhooks):** Fastify ou Express (focado em responder `200 OK` em menos de 100ms).
- **Motor WhatsApp:** `@whiskeysockets/baileys` (Conexão via WebSocket puro, usando *Pairing Code* de 8 dígitos ou QR Code no terminal, com `useMultiFileAuthState`).
- **Banco de Dados & Fila:** `better-sqlite3` rodando localmente com `PRAGMA journal_mode = WAL;` ativado para concorrência simultânea de leitura (Worker) e escrita (Webhooks).
- **Processamento de Áudio:** `ffmpeg` para envio de áudios como PTT nativo (nota de voz gravada na hora, formato `.ogg` com codec `libopus`, `ptt: true`).
- **Infraestrutura Alvo:** VPS Google Cloud (`e2-micro` Ubuntu LTS), gerenciada por PM2 e com Caddy Server fazendo Reverse Proxy HTTPS automático.

## Documentações Oficiais da Stack
- **Baileys (Repositório e README):** https://github.com/WhiskeySockets/Baileys
- **Baileys (Wiki & Arquitetura de Conexão, Auth, Mensagens e Eventos):** https://baileys.wiki
- **Baileys (Guia de Migração v7+):** https://whiskey.so/migrate-latest
- **SQLite (`better-sqlite3` Repositório):** https://github.com/WiseLibs/better-sqlite3
- **SQLite (Performance e Modo WAL):** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md
- **SQLite (Boas Práticas de Modelagem):** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/tips.md
- **Google Cloud Compute Engine Docs:** https://docs.cloud.google.com/compute/docs
- **Google Cloud Specs (`e2-micro`):** https://cloud.google.com/products/compute
- **PM2 Process Management:** https://pm2.io/docs/runtime/guide/process-management/
- **Caddy Server Reverse Proxy (Auto-HTTPS):** https://caddyserver.com/docs/caddyfile/directives/reverse_proxy

---

# 2. BLUEPRINT DE DIRETÓRIOS E ARQUIVOS DO PROJETO

O sistema deve seguir rigorosamente esta árvore modular onde cada diretório e arquivo possui responsabilidade única:

- **`/data/`** (Ignorada no Git - Persistência Local)
  - **`/data/auth_info/`**: Arquivos JSON das chaves criptográficas da sessão do Baileys.
  - **`/data/database/`**: Arquivo `funnel.db` (e arquivos `-wal` e `-shm` do SQLite).
  - **`/data/media/`**: PDFs de entrega, imagens de prova social e áudios de pitch convertidos em `.ogg` (codec Opus).
- **`/src/config/`**
  - **`env.ts`**: Carregamento e validação de variáveis de ambiente (porta HTTP, `CAKTO_WEBHOOK_SECRET`, número do WhatsApp para *Pairing Code*, caminhos de diretórios).
  - **`catalog.ts`**: Mapa declarativo de produtos e ofertas da Cakto (`product_id` / `offer_id`), definindo o tipo (`MAIN`, `UPSELL_1`, `UPSELL_2`, `DOWNSELL`), arquivos de mídia locais da entrega, mensagens e árvore de próximos passos (delays e links de checkout).
- **`/src/database/`**
  - **`connection.ts`**: Inicialização do `better-sqlite3`, ativação obrigatória do modo `WAL` (`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`) e execução do DDL das tabelas (`customers`, `orders`, `message_queue`).
  - **`repositories.ts`**: Métodos transacionais prontos para upsert de clientes, registro idempotente de pedidos, inserção de jobs na fila, cancelamento de jobs pendentes e atualização de estágio do funil.
- **`/src/whatsapp/`**
  - **`socket.ts`**: Gerenciamento da conexão WebSocket do Baileys, geração de *Pairing Code* de 8 caracteres no terminal, reconexão automática inteligente (`DisconnectReason.loggedOut` vs falha de rede) e listener de mensagens recebidas (`messages.upsert`).
  - **`dispatcher.ts`**: Resolução e validação do 9º dígito na rede da Meta (`onWhatsApp`), simulação de presença humana (`composing` e `recording`) e envio de textos, documentos PDF e áudios PTT.
- **`/src/webhooks/`**
  - **`server.ts`**: Servidor HTTP leve expondo a rota `POST /webhook/cakto` e rota de healthcheck.
  - **`adapters.ts`**: Validação do segredo da Cakto, extração e normalização do payload bruto da Cakto para o DTO interno padronizado do sistema.
- **`/src/engine/`**
  - **`state-machine.ts`**: Cérebro do funil que processa os eventos vindos do Webhook ou da resposta do cliente no WhatsApp, alterando estados e manipulando a fila.
  - **`worker.ts`**: Loop assíncrono que lê a tabela `message_queue` a cada 5 segundos, processa um cliente por vez (fila indiana), resolve o *Spintax* dos textos, aplica atrasos elásticos (*Jitter*) e aciona o `dispatcher.ts`.

---

# 3. ESPECIFICAÇÃO DOS MÓDULOS E REGRAS DE NEGÓCIO

## A. Módulo Receptor e Adaptador da Cakto (`/src/webhooks/`)
- **Validação de Segurança:** Conferir o token secreto enviado pela Cakto (no campo `secret` do JSON, header `x-cakto-signature` ou query param) comparando com `CAKTO_WEBHOOK_SECRET`. Rejeitar requisições inválidas com `401 Unauthorized`.
- **Mapeamento de Eventos Cakto:**
  - `purchase_approved`: Compra paga/aprovada -> Aciona Entrega Imediata + Funil de Upsell.
  - `pix_generated` / `waiting_payment`: Pix gerado -> Agenda recuperação de Pix na fila.
  - `purchase_refunded` / `chargeback`: Reembolso ou estorno -> Cancela imediatamente todos os jobs `PENDING` daquele cliente na fila e muda o status do cliente para `REFUNDED`.
- **Normalização (Adapter):** Extrair da estrutura da Cakto (`data.id`, `data.status`, `data.customer.name`, `data.customer.phone`, `data.customer.email`, `data.product.id`, `data.offer.id`, `data.pix.qr_code_text`) e converter para um DTO interno limpo.
- **Idempotência Estrita:** Garantir no SQLite que a combinação `transaction_id` + `event_type` nunca seja processada duas vezes caso a Cakto reenvie o mesmo webhook. Responder `200 OK` imediatamente.

## B. Módulo Core Baileys & Resolver do 9º Dígito (`/src/whatsapp/`)
- **JID Resolver (Problema do 9º Dígito no Brasil):** Números brasileiros digitados no checkout da Cakto podem vir com ou sem o 9º dígito, e contas antigas do WhatsApp (DDDs 31 a 99) frequentemente não possuem o `9` no JID interno da Meta. Antes do primeiro envio, o sistema DEVE higienizar a string (DDI `55` + DDD + Número) e consultar `sock.onWhatsApp(phone)` para descobrir o `jid` real registrado no servidor do WhatsApp (`55XX9XXXXXXXX@s.whatsapp.net` ou `55XXXXXXXXXX@s.whatsapp.net`), salvando o JID validado na tabela `customers`.
- **Ouvinte de Respostas (`messages.upsert`):** Escutar eventos onde `fromMe === false`. Quando um cliente cadastrado no banco responder no WhatsApp, acionar imediatamente a Máquina de Estados passando o telefone/JID e o texto recebido.

## C. Máquina de Estados Híbrida do Funil (`/src/engine/state-machine.ts`)
O funil deve operar combinando **Gatilhos de Tempo** e **Gatilhos de Interação (Micro-comprometimento)**:
1. **Gatilho Pix Gerado (`pix_generated`):**
   - Agenda job `PIX_RECOVERY` para `now + 7 minutos` enviando o código Pix Copia e Cola e mensagem de ajuda.
2. **Gatilho Compra do Produto Principal (`MAIN` - `purchase_approved`):**
   - Cancela qualquer job `PIX_RECOVERY` pendente para aquele telefone.
   - Agenda `DELIVERY_MAIN` para execução imediata (`now`). A última mensagem do pacote de entrega deve conter uma pergunta de micro-comprometimento (ex: *"Conseguiu abrir o material direitinho? Me responde SIM aqui só para eu confirmar"*).
   - Atualiza o estado do cliente para `DELIVERED_MAIN`.
   - Agenda `PITCH_UPSELL_1` para `now + 15 minutos` (fallback automático por tempo caso o cliente não responda).
3. **Gatilho de Ouro — Micro-comprometimento (Cliente respondeu no WhatsApp):**
   - Se o cliente está no estado `DELIVERED_MAIN` e envia qualquer mensagem no WhatsApp, a Máquina de Estados localiza o job `PITCH_UPSELL_1` que estava aguardando os 15 minutos e **atualiza o `scheduled_at` para `now`**, disparando o pitch de áudio + link do Upsell 1 imediatamente enquanto o cliente está com a conversa aberta.
4. **Gatilho Compra do Upsell 1 (`UPSELL_1` - `purchase_approved`):**
   - Cancela qualquer job pendente de `PITCH_UPSELL_1` ou `PITCH_DOWNSELL_1`.
   - Atualiza estado do cliente para `DELIVERED_UPSELL_1`.
   - Agenda `DELIVERY_UPSELL_1` para `now`.
   - Agenda `PITCH_UPSELL_2` para `now + 15 minutos`.
5. **Gatilho Não Comprou Upsell 1 (Downsell por Tempo):**
   - Quando o `PITCH_UPSELL_1` é enviado, o sistema já deixa agendado o `PITCH_DOWNSELL_1` para `now + 2 horas` (ou 24h), oferecendo uma condição especial/menor ticket da Cakto caso o Upsell 1 não seja comprado nesse intervalo.

## D. Motor de Fila e Camada Anti-Banimento (`/src/engine/worker.ts`)
- **Concorrência Controlada (Fila Indiana):** O Worker verifica o banco a cada 5 segundos e processa estritamente 1 job por vez para evitar rajadas simultâneas que banem o chip.
- **Simulação de Presença Humana:**
  - Antes de cada balão de texto: enviar `sock.sendPresenceUpdate('composing', jid)` e aguardar um tempo proporcional ao tamanho do texto (entre 2.5s e 5s).
  - Antes de cada áudio PTT: enviar `sock.sendPresenceUpdate('recording', jid)` e aguardar entre 4s e 7s.
- **Jitter (Delay Elástico):** Aplicar atraso aleatório entre cada mensagem do mesmo pacote (ex: 3s a 6s) e uma pausa de respiro entre um cliente e outro.
- **Motor Spintax:** Resolver expressões `{Olá|Oi|Fala|Tudo bem}, *{{first_name}}*!` no momento do disparo para garantir que cada mensagem enviada tenha um hash único nos servidores da Meta.

---

# 4. ESPECIFICAÇÃO DE INFRAESTRUTURA (GOOGLE CLOUD VPS)

O sistema deve ser desenhado considerando o ambiente de produção abaixo:
- **Máquina Virtual:** Google Cloud Compute Engine `e2-micro` (2 vCPUs compartilhadas, 1 GB RAM, Ubuntu 22.04/24.04 LTS, 20-30 GB Standard Persistent Disk) com **2 GB de arquivo Swap** ativado no Linux para evitar *Out-Of-Memory*.
- **Consumo de Recursos:** Manter o footprint de RAM entre 60 MB e 120 MB (sem uso de Chromium/Puppeteer).
- **Rede, Firewall e HTTPS:** Portas 80 e 443 abertas no Firewall da VPC do GCP; aplicação Node.js rodando internamente na porta `3000` (fechada para fora) e exposta via **Caddy Server** fazendo `reverse_proxy localhost:3000` com SSL/HTTPS automático para o subdomínio do webhook.
- **Dependências de Sistema:** `ffmpeg` instalado nativamente no Ubuntu para conversão/validação de áudios `.ogg` (`libopus`) e **PM2** configurado com `pm2 startup` e `pm2 save` para manter o processo vivo 24/7.

---

# 5. O QUE DEVE SER ENTREGUE E CONSTRUÍDO AGORA

Com base em todas as especificações acima, estruture e entregue a engenharia completa do projeto contendo:

1. **Schema SQLite Completo (DDL):** Código SQL exato das tabelas (`customers`, `orders`, `message_queue`), chaves primárias, restrições de unicidade para idempotência e todos os índices (`CREATE INDEX`) necessários para o Worker consultar a fila sem custo de CPU.
2. **Contratos TypeScript e Interfaces:** Tipagens completas do Payload recebido da Cakto, do DTO interno normalizado, da estrutura de configuração do `catalog.ts` e dos payloads JSON da fila de mensagens.
3. **Tabela Verdade da Máquina de Estados:** Mapeamento exato de todas as transições (`Estado Atual` + `Gatilho/Evento` -> `Jobs Cancelados` + `Jobs Criados na Fila` + `Novo Estado`).
4. **Implementação dos Módulos Core:** Detalhamento técnico e código estrutural completo de cada arquivo da árvore (`/src/config/*`, `/src/database/*`, `/src/whatsapp/*`, `/src/webhooks/*`, `/src/engine/*` e `src/index.ts`), além dos arquivos `package.json`, `tsconfig.json`, `Caddyfile` e comandos de provisionamento da VPS no Google Cloud."*

---

## 2. Os 3 Diferenciais "10-Estrelas" Obrigatórios
1. **Tracing profundo de spans de execução de agentes com metadados de prompt, resposta e latência:** Tracing profundo de spans de execução de agentes com metadados de prompt, resposta e latência
2. **Contabilidade analítica de consumo de tokens (Prompt/Completion) e estimativa de custo em USD/BRL:** Contabilidade analítica de consumo de tokens (Prompt/Completion) e estimativa de custo em USD/BRL
3. **Playground interativo de teste de prompts com comparador de modelos e exportação de datasets:** Playground interativo de teste de prompts com comparador de modelos e exportação de datasets

---

## 3. Mapa Canônico de Seções da Aplicação (01-Secao a 05-Secao)
Todas as telas abaixo devem coexistir no layout em abas/seções navegáveis com persistência de estado e troca instantânea sem recarregar a página inteira:

### Seção 01: Dashboard
- **Navegação SPA:** `role="tab"` e `data-tab="dashboard"` (captura visual obrigatória: `01-Dashboard.png`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
  - Total Execuções: 8.420 (Δ% +24.1%)
  - Latência P95: 412ms (Δ% -14.2%)
  - Taxa de Sucesso: 99.1% (Δ% +0.8%)
  - Custo Estimado (Hoje): $ 14.85 (Δ% +5.2%)
- **Visualização Gráfica:** Gráfico SVG interativo de Latência P95 e Consumo de Tokens por Hora com tooltips em tabular-nums
- **Data Grid de Alta Densidade:**
  - **Colunas:** ID Execução, Agente / Pipeline, Modelo, Status, Tokens, Latência (ms), Custo ($), Executado Em, Ações
  - **Filtros e Busca:** Filtro por Modelo (gpt-4o, claude-3-5-sonnet, gemini-1.5-pro); Filtro por Status (Sucesso, Falha, Timeout); Busca debounce
  - **Exportação:** Botão "Exportar CSV" conectado a `POST /api/export/csv`
- **Slide-Over Detail Drawer:** Slide-Over Drawer com visualizador em cascata de Spans, prompt completo de entrada, resposta gerada e métricas de token
- **Modais de Ação:** Modal de Nova Execução de Teste com seleção de agente, variáveis de prompt e modelo
- **Povoamento Realista (`seedIfEmpty`):** 30 execuções detalhadas com traces, status e custos calculados

### Seção 02: Agentes
- **Navegação SPA:** `role="tab"` e `data-tab="agentes"` (captura visual obrigatória: `02-Agentes.png`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
  - Agentes Ativos: 6
  - Templates de Prompt: 14
  - Versões Homologadas: 8
  - Execuções/min Médio: 42
- **Visualização Gráfica:** Gráfico SVG de distribuição de chamadas por agente e taxa de erro
- **Data Grid de Alta Densidade:**
  - **Colunas:** Código, Nome do Agente, Modelo Base, Versão, Temperatura, Execuções Totais, Status, Ações
  - **Filtros e Busca:** Todos os Agentes; Filtro por Status Ativo/Inativo
  - **Exportação:** Botão "Exportar CSV" conectado a `POST /api/export/csv`
- **Slide-Over Detail Drawer:** Drawer com editor de System Prompt, histórico de versões e métricas de acurácia
- **Modais de Ação:** Modal de Criação de Agente com parametrização de temperatura, top_p e max_tokens
- **Povoamento Realista (`seedIfEmpty`):** 6 agentes de IA configurados (Extrator, Classificador, Resumidor, Auditor, Roteirista, Pesquisador)

### Seção 03: Operações
- **Navegação SPA:** `role="tab"` e `data-tab="operacoes"` (captura visual obrigatória: `03-Operações.png`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
  - Lotes Processados: 48
  - Spans Auditados: 1.250
  - Timeouts Evitados: 12
  - Throughput Máx.: 120 req/s
- **Visualização Gráfica:** Gráfico SVG de taxa de transferência (Throughput req/s) nas últimas 24h
- **Data Grid de Alta Densidade:**
  - **Colunas:** ID Lote, Pipeline, Itens, Sucesso, Falhas, Duração (s), Data, Ações
  - **Filtros e Busca:** Status do Lote; Busca debounce
  - **Exportação:** Botão "Exportar CSV" conectado a `POST /api/export/csv`
- **Slide-Over Detail Drawer:** Visualizador de logs brutos da execução e traceback de eventuais exceções
- **Modais de Ação:** Modal de Disparo de Lote de Avaliação (Eval Benchmark)
- **Povoamento Realista (`seedIfEmpty`):** 15 operações em lote de avaliação com percentuais de sucesso

### Seção 04: Auditoria
- **Navegação SPA:** `role="tab"` e `data-tab="auditoria"` (captura visual obrigatória: `04-Auditoria.png`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
  - Eventos Registrados: 420
  - Atores: 3
  - Alterações de Prompt: 18
  - Tokens Revogados: 0
- **Visualização Gráfica:** Gráfico SVG de frequência temporal de eventos de auditoria
- **Data Grid de Alta Densidade:**
  - **Colunas:** Timestamp, Ator, Ação, Entidade, ID Alvo, Diff JSON, Ações
  - **Filtros e Busca:** Ação (CREATE, UPDATE, DELETE); Entidade (ai_agents, prompt_templates, runs)
  - **Exportação:** Botão "Exportar CSV" conectado a `POST /api/export/csv`
- **Slide-Over Detail Drawer:** Visualizador de JSON diff com destaque de mutações de prompt e hiperparâmetros
- **Modais de Ação:** Modal de Exportação de Logs de Auditoria para conformidade e SOC2
- **Povoamento Realista (`seedIfEmpty`):** 35 logs de auditoria imutáveis com registros de alterações e deploys de modelos

### Seção 05: Configuracoes
- **Navegação SPA:** `role="tab"` e `data-tab="configuracoes"` (captura visual obrigatória: `05-Configuracoes.png`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
  - Provedores Ativos: OpenAI, Anthropic, Google
  - Fallback Automático: Habilitado
  - Rate Limit Pessoal: 200 req/min
  - Banco de Dados: SQLite WAL
- **Visualização Gráfica:** Gráfico SVG de consumo de cota por provedor de IA
- **Data Grid de Alta Densidade:**
  - **Colunas:** Provedor, Chave Mascarada, Status, Cota Restante, Ações
  - **Filtros e Busca:** Geral; Provedores de LLM; Webhooks
  - **Exportação:** Botão "Exportar CSV" conectado a `POST /api/export/csv`
- **Slide-Over Detail Drawer:** Painel de parametrização de timeouts de inferência e política de retries
- **Modais de Ação:** Modal de Cadastro de Chave de API de Provedor de LLM com teste de conectividade
- **Povoamento Realista (`seedIfEmpty`):** Configurações de modelos, limites de gastos e chaves mock determinísticas


---

## 4. Requisitos de Povoamento Inicial (`seedIfEmpty`)
- O servidor backend deve invocar obrigatoriamente `seedIfEmpty()` na inicialização caso a base SQLite esteja vazia.
- A base deve iniciar com **entre 15 e 30 registros ricos e realistas**, cobrindo todas as categorias, métodos e status definidos acima.
- Proibido iniciar com tabelas zeradas ou dados artificiais ("Teste 1", "Lorem Ipsum").


## Jornadas de Usuário e Homologação

# JORNADAS DE TESTE, VALIDAÇÃO VISUAL & HOMOLOGAÇÃO (JORNADAS.MD)

> **Fonte Canônica de Jornadas do WhatsappEntrega:** Este documento dita as jornadas automatizadas de ponta a ponta, roteiros visuais para o PlaywrightVisualInspector, cenários de experiência do usuário (UX) com persistência pós-reload (F5) e regras de validação Red Team (AppSec).

---

## 1. Roteiro Visual de Seções & Snapshots (PlaywrightVisualInspector)
Para cada seção da aplicação, o agente visual deve navegar até a aba via atributo `data-tab`, aguardar estabilização do DOM (<150ms) e capturar a evidência fotográfica em formato PNG enumerado:

### Seção 01: Dashboard
- **Aba de Navegação:** `[data-tab="dashboard"]` (com `role="tab"`)
- **Arquivo de Snapshot Obrigatório:** `01-Dashboard.png`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação `tabular-nums` e badges de variação percentual (`Δ%`)
  - Gráfico SVG interativo de Latência P95 e Consumo de Tokens por Hora com tooltips em tabular-nums
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "Modal de Nova Execução de Teste")

### Seção 02: Agentes
- **Aba de Navegação:** `[data-tab="agentes"]` (com `role="tab"`)
- **Arquivo de Snapshot Obrigatório:** `02-Agentes.png`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação `tabular-nums` e badges de variação percentual (`Δ%`)
  - Gráfico SVG de distribuição de chamadas por agente e taxa de erro
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "Modal de Criação de Agente")

### Seção 03: Operações
- **Aba de Navegação:** `[data-tab="operacoes"]` (com `role="tab"`)
- **Arquivo de Snapshot Obrigatório:** `03-Operaes.png`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação `tabular-nums` e badges de variação percentual (`Δ%`)
  - Gráfico SVG de taxa de transferência (Throughput req/s) nas últimas 24h
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "Modal de Disparo de Lote de Avaliação (Eval Benchmark)")

### Seção 04: Auditoria
- **Aba de Navegação:** `[data-tab="auditoria"]` (com `role="tab"`)
- **Arquivo de Snapshot Obrigatório:** `04-Auditoria.png`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação `tabular-nums` e badges de variação percentual (`Δ%`)
  - Gráfico SVG de frequência temporal de eventos de auditoria
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "Modal de Exportação de Logs de Auditoria para conformidade e SOC2")

### Seção 05: Configuracoes
- **Aba de Navegação:** `[data-tab="configuracoes"]` (com `role="tab"`)
- **Arquivo de Snapshot Obrigatório:** `05-Configuracoes.png`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação `tabular-nums` e badges de variação percentual (`Δ%`)
  - Gráfico SVG de consumo de cota por provedor de IA
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "Modal de Cadastro de Chave de API de Provedor de LLM")


---

## 2. Cenários de Experiência do Usuário & Persistência F5 (UserExperienceSimulator)
O simulador de experiência de usuário deve executar e validar os seguintes fluxos interativos:

### Cenário 1: Ciclo Completo de Criação e Persistência Pós-Reload (F5)
1. **Disparo:** Clicar no botão de criação primário da aba ativa (ex.: "Novo Registro" / "Adicionar").
2. **Modal Interativo:** O modal deve abrir suavemente com foco no primeiro input editável.
3. **Preenchimento de Dados:** Inserir dados válidos de teste com valores coerentes e numéricos positivos.
4. **Submissão & Optimistic UI:** Ao enviar o formulário:
   - Notificação Toast de sucesso deve surgir imediatamente.
   - O modal deve fechar sem erro no console do navegador.
   - A linha criada deve ser inserida imediatamente no Data Grid.
5. **Teste de Persistência F5:**
   - O simulador executa um recarregamento completo da página (`F5` / reload do navegador).
   - O evento `DOMContentLoaded` dispara `fetch('/api/...')` e o registro criado continua presente no Data Grid, comprovando persistência física em SQLite.

### Cenário 2: Slide-Over Detail Drawer & Edição Rápida Inline
1. **Abertura do Drawer:** Clicar em qualquer registro do Data Grid abre o painel lateral deslizante (`transform: translateX(0)`).
2. **Navegação em Sub-Abas:** Alternar entre sub-abas (Detalhes, Notas e Histórico de Auditoria).
3. **Edição Inline:** Alterar um campo permitido (ex.: status ou categoria) e validar persistência imediata com feedback visual.

---

## 3. Matriz de Segurança, Validação de Entrada & Pentest (SecurityPentestSimulator)
O simulador de pentest Red Team executará asserções contra todas as mutações (`POST`, `PUT`, `DELETE`):

### Regras de Validação de Entrada (HTTP 400 Bad Request)
- **Valores Negativos ou Zero em Campos Monetários/Quantitativos:**
  - Payload com `valor < 0` ou `valor = 0` (onde positivo é obrigatório) deve retornar estritamente HTTP 400 com JSON amigável (`{ "error": "ValidationError", ... }`).
- **Valores Não Numéricos (NaN / strings alfanuméricas em campos numéricos):**
  - Payload com `valor: "abc"` ou `NaN` deve ser interceptado com HTTP 400 antes de atingir o banco de dados.
- **Campos Obrigatórios Vazios:**
  - Strings com espaços em branco após `.trim()` devem ser rejeitadas com HTTP 400.

### Mitigação de Injeção & XSS (OWASP Top 10)
- **SQL Injection (SQLi):**
  - Todas as consultas ao banco SQLite devem utilizar exclusivamente queries parametrizadas com placeholders `?`.
  - Proibida concatenação de strings ou interpolação de variáveis em instruções SQL (`"SELECT ... WHERE id = " + id`).
- **Cross-Site Scripting (XSS):**
  - Qualquer dado vindo do backend ou input do usuário deve passar por sanitização via `escapeHtml()` antes de ser injetado em `innerHTML` no frontend.
- **Vazamento de Segredos (Secret Leak):**
  - Arquivos estáticos em `public/` não devem conter chaves de API sensíveis, senhas ou tokens privados hardcoded.


## Pesquisa de Mercado e Diferenciais

# ESTUDO DE MERCADO, APLICATIVOS DE REFERÊNCIA & ENGENHARIA REVERSA REA (ONDA 0)

**Projeto:** WhatsappEntrega
**Domínio Classificado:** AI Agents, LLM Workflows & Prompt Engineering Hub
**Aplicativos de Referência Mapeados:** PTT, LangSmith, Vercel AI Playground, Linear, Raycast
**Data de Síntese:** 2026-10-31T19:30:31.317Z

---

## 1. Diagnóstico de Mercado & Dor Crítica do Usuário
Desenvolvedores e equipes de produto que implementam fluxos de IA enfrentam opacidade em execuções de prompts, variação imprevista de custos de tokens e ausência de observabilidade em cadeias RAG. Plataformas líderes entregam rastreabilidade de chamadas (traces), playground comparativo de modelos e auditoria detalhada de payloads e latência.

---

## 2. Benchmarking Global & Nacional dos Aplicativos de Referência
- **PTT:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.
- **LangSmith:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.
- **Vercel AI Playground:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.
- **Linear:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.
- **Raycast:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.

---

## 3. Engenharia Reversa REA (morluto/rea) dos Aplicativos de Referência
### 3.1 Fluxos de Tela Indispensáveis (UI de Alta Densidade)
- App Shell com abas [role="tab"]: 01-Playground (Execuções & Testes de Prompts), 02-Traces (Histórico de Chamadas & Latência), 03-Modelos (Catálogo & Custos por Token), 04-Auditoria (Diff de Payloads & Logs), 05-Configurações (API Keys de Provedores)
- Command Palette (Ctrl+K) com troca rápida de modelos e pesquisa instantânea de traces
- Slide-Over Inspector Drawer (520px) com abas de Payload JSON, Árvore de Execução RAG e Métricas de Latência/Custo
- Data Grid com filtros avançados por Modelo (GPT-4o, Claude 3.5, Gemini 1.5, Llama 3), Faixa de Latência P95 e Status da Execução

### 3.2 Entidades de Banco de Dados SQLite & Fórmulas Críticas
**Entidades Recomendadas:**
- `verdade`
- `prompt_templates`
- `agent_runs`
- `token_metrics`
- `prompt_templates (id, name, model, system_prompt, user_prompt, temperature, top_p, version, created_at)`
- `agent_runs (id, template_id, model, input_json, output_text, prompt_tokens, completion_tokens, latency_ms, cost_usd, status, created_at)`
- `token_usage_records (id, model, date, total_tokens, total_cost_usd)`
- `audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)`
- `system_settings (key, value, updated_at)`

**Fórmulas Matemáticas de Negócio:**
- `custo_estimado = (prompt_tokens * custo_prompt_1k / 1000) + (completion_tokens * custo_completion_1k / 1000)`
- `taxa_sucesso_execucao = (execucoes_sucesso / total_execucoes) * 100`
- `latencia_media_ms = avg(duracao_ms)`
- `p95_latencia_ms = percentile_95(duracao_ms)`

---

## 4. Três Diferenciais "10-Estrelas" (gstack /plan-ceo)
1. **Playground Interativo com comparação lado a lado de respostas de modelos concorrentes:** Playground Interativo com comparação lado a lado de respostas de modelos concorrentes

2. **Calculadora em tempo real de custo por 1k tokens e latência P95:** Calculadora em tempo real de custo por 1k tokens e latência P95

3. **Slide-Over Drawer 520px com visualização formatada de prompts, variáveis e inspeção de chunks:** Slide-Over Drawer 520px com visualização formatada de prompts, variáveis e inspeção de chunks

---

## 5. Validação de Engenharia Local & Invariantes
- **Stack Conforme:** Node.js (v20/22/24) + SQLite nativo (node:sqlite / prepare-run-all parametrizado com ?)
- **Roteamento Full-Stack:** SPA servida em `GET /`, API isolada sob `/api/*` e healthcheck em `GET /api/health`
- **Isolamento de Porta (PORT_GUARD):** Faixa 4000-4999 obrigatória (3001 reservada ao DecoHUB)
- **Padrão Dual-Mode DOCSIMP:** Chaves de terceiros com Graceful Mock Fallback determinístico offline
- **Navegação Visual:** Abas com atributos explícitos `[role="tab"]` e `data-tab="<secao>"` para crawler 01-Secao.png
