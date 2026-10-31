# ROLE & OBJECTIVE
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
4. **Implementação dos Módulos Core:** Detalhamento técnico e código estrutural completo de cada arquivo da árvore (`/src/config/*`, `/src/database/*`, `/src/whatsapp/*`, `/src/webhooks/*`, `/src/engine/*` e `src/index.ts`), além dos arquivos `package.json`, `tsconfig.json`, `Caddyfile` e comandos de provisionamento da VPS no Google Cloud.