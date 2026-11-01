# DOSSIÊ CONSOLIDADO DE ARQUITETURA SAAS MASTER (ENGENHARIA REVERSA REA)

---

> Diretrizes canônicas extraídas via morluto/rea de referências líderes (Linear, Stripe, Notion, Tally, n8n, Attio).

---

# Blueprint de Engenharia Reversa: Enterprise App Shell & Reactive Client State

> Extraído via engenharia reversa estática e comportamental (REA) de interfaces líderes de mercado (Linear, Stripe Dashboard, Notion, Cal.com).

## 1. Arquitetura do App Shell Enterprise
O shell da aplicação não é um layout estático simples de cabeçalho e rodapé. Ele é composto por subsistemas coordenados:

### A. Sidebar Colapsável & Navegação Hierárquica
- **Navegação Modular**: Lista de seções estruturadas (ex: Dashboard, Clientes/Contatos, Transações/Operações, Relatórios & BI, Auditoria de Atividades, Configurações).
- **Contadores Vivos (Badges)**: Itens de navegação contêm contadores reativos atualizados pela Store (ex: "Transações Pendentes: 4", "Auditoria: 12").
- **Colapso Suave com Teclado e Botão**: Suporte a atalho (ex: `[` ou `Ctrl+B`) para recolher a barra lateral para modo mini/ícones, liberando espaço visual para visualizações densas de dados.

### B. Topbar de Comando e Status Global
- **Barra de Busca / Gatilho Command Palette**: Input ou botão central estilizado exibindo `Buscar ou executar ação... (Ctrl+K)`.
- **Filtro de Contexto / Período Rápido**: Dropdown ou pill selector de período (Hoje, Últimos 7 dias, Este Mês, Todo o Histórico).
- **Indicador de Sistema**: Ponto verde/âmbar de conexão com API em tempo real (`Online • Sync`), status de persistência e atalhos rápidos.

### C. Command Palette (`Ctrl+K` / `Cmd+K`)
- **Modal Flutuante de Alta Velocidade**: Abre instantaneamente ao pressionar `Ctrl+K` (ou `Cmd+K`), ou ao clicar na busca da Topbar.
- **Busca Preditiva por Teclado**: Filtra em tempo real navegação entre telas, ações imediatas (ex: "Novo Registro", "Exportar CSV", "Limpar Filtros", "Ver Auditoria") e pesquisa de entidades.
- **Navegação com Setas e Enter**: Setas `Cima`/`Baixo` selecionam itens com destaque visual e `Enter` aciona o comando ou fecha a paleta com `Escape`.

### D. Slide-Over Detail Drawers (Painéis Laterais Deslizantes)
- **Zero Navegação Cega**: Clicar em qualquer registro de uma tabela ou card não deve trocar de página para uma tela vazia.
- **Painel Lateral Fluido**: Um drawer abre da direita com animação suave de slide (`transform: translateX(0)`), overlay semi-transparente de fundo e foco automático.
- **Conteúdo Estruturado**:
  - Cabeçalho com título da entidade, status em badge colorido e botão de fechar (`Esc`).
  - Abas internas rápidas (Geral, Histórico/Timeline, Metadados JSON brutos).
  - Ações inline imediatas (Editar campo, Mudar status, Reenviar evento, Excluir).

### E. Optimistic UI & Atalhos de Teclado
- **Feedback Imediato**: Alterações de status e edições inline refletem instantaneamente no DOM local enquanto a requisição assíncrona é enviada ao servidor.
- **Rollback Transparente**: Se a requisição falhar com erro 4xx/500, a Store restaura o estado anterior e exibe um toast de alerta sem travar a interface.

---

## 2. Padrão Canônico: Reactive Client Store (Vanilla JS Sem Frameworks Pesados)
Código frontend corporativo (`public/app.js`) deve seguir arquitetura previsível orientada a fluxo unidirecional:

```javascript
// Exemplo canônico de Reactive Store corporativa no public/app.js
const Store = {
  state: {
    currentView: 'dashboard',
    selectedId: null,
    drawerOpen: false,
    commandPaletteOpen: false,
    filters: { query: '', status: 'all', dateRange: '30d' },
    items: [],
    metrics: {},
    auditLogs: [],
    loading: false
  },
  subscribers: [],
  subscribe(fn) {
    this.subscribers.push(fn);
    return () => { this.subscribers = this.subscribers.filter(s => s !== fn); };
  },
  dispatch(action, payload) {
    switch (action) {
      case 'NAVIGATE':
        this.state.currentView = payload;
        break;
      case 'OPEN_DRAWER':
        this.state.selectedId = payload;
        this.state.drawerOpen = true;
        break;
      case 'CLOSE_DRAWER':
        this.state.drawerOpen = false;
        this.state.selectedId = null;
        break;
      case 'SET_ITEMS':
        this.state.items = payload;
        break;
      case 'SET_METRICS':
        this.state.metrics = payload;
        break;
      case 'SET_AUDIT_LOGS':
        this.state.auditLogs = payload;
        break;
      case 'UPDATE_FILTERS':
        this.state.filters = { ...this.state.filters, ...payload };
        break;
    }
    this.notify();
  },
  notify() {
    this.subscribers.forEach(fn => fn(this.state));
  }
};
```

---

# Blueprint de Engenharia Reversa: Enterprise Data Tables & BI Analytics

> Extraído via engenharia reversa estática e comportamental (REA) de suítes analíticas líderes (Stripe Dashboard, Linear Insights, TradingView, Retool).

## 1. Engenharia de Tabelas Enterprise (Data Grids Avançados)
Uma tabela corporativa de SaaS Master não é um elemento `<table>` estático desprovido de ferramentas. Ela deve oferecer controle total sobre grandes volumes de informação:

### A. Barra de Controle e Filtros Compostos
- **Busca com Debounce**: Input de busca textual aplicando filtro após 250-300ms de inatividade do usuário, sem travar digitação.
- **Filtro Multi-Dimensão**: Pelo menos dois filtros por seleção (ex: Status: `Todos | Ativo | Pendente | Cancelado` e Categoria/Tipo).
- **Contador Dinâmico de Resultados**: Exibição clara `Exibindo 12 de 45 registros encontrados` atualizada instantaneamente.
- **Reset Rápido de Filtros**: Botão visível `Limpar Filtros` quando qualquer critério estiver ativo.

### B. Ordenação Interativa por Colunas (Sortable Headers)
- Cabeçalhos clicáveis com setas visuais indicando estado (`asc` ▲ / `desc` ▼ / neutro).
- Ordenação alfanumérica, por data ISO ou valores numéricos (com `font-variant-numeric: tabular-nums`).

### C. Paginação e Controles de Visualização
- Seletor de registros por página (ex: 10, 25, 50).
- Navegação entre páginas (`Anterior`, `1`, `2`, `3`, `Próximo`) com desativação correta de botões nos extremos.

### D. Seleção em Lote (Batch Operations) & Ações Inline
- Checkbox mestre no cabeçalho ("Selecionar todos").
- Barra flutuante de ações em lote quando >= 1 item selecionado:
  - Botão de exportação em lote (`Exportar Seleção (.csv)`).
  - Ação em massa (`Alterar Status`, `Arquivar`).
- Botões de ação rápida em cada linha (Ícone de visualização detalhada abrindo Drawer lateral, edição rápida e exclusão segura).

### E. Exportação CSV Nativa em 1 Clique
- Botão visível `Exportar CSV` que formata o conjunto de dados filtrado conforme a RFC-4180 e inicia o download imediato via Blob no cliente (`data:text/csv;charset=utf-8`).

---

## 2. Visualização Analítica Real (BI & Métricas Executivas)
Telas analíticas não podem depender de mockups ou apenas números isolados.

### A. Cards de KPIs Executivos com Variação Percentual (`Δ%`)
- **Valor Absoluto Primário**: Número grande com tipografia tabular (`font-variant-numeric: tabular-nums`).
- **Badge de Tendência**: Indicador com seta e percentual `+14.2% vs mês anterior` (verde) ou `-3.8%` (vermelho).
- **Subtítulo Descritivo**: Contexto claro do indicador (ex: `Receita Recorrente Líquida`, `Transações Processadas`).

### B. Gráficos Interativos SVG/Canvas Nativos (Sem Dependências Pesadas)
- **Gráficos de Linha / Área**: SVG vetorial com curvas suavizadas, gradiente sob a curva e pontos de dados interativos com hover.
- **Gráficos de Barra / Distribuição**: Barras proporcionais animadas com representação por categoria.
- **Tooltips Flutuantes**: Hover sobre qualquer barra ou ponto exibe tooltip com data, valor exato e métrica secundária.
- **Layout Responsivo e Adaptativo**: Gráficos com `viewBox="0 0 600 240"` ou Canvas com redimensionamento dinâmico.

---

# Blueprint de Engenharia Reversa: Enterprise Backend & Business Workflows

> Extraído via engenharia reversa estática e comportamental (REA) de arquiteturas de backend SaaS líderes (Stripe API, GitHub Enterprise, Supabase, Linear Sync).

## 1. Arquitetura de Domínio & Máquinas de Estado
Em aplicações SaaS profissionais, entidades de negócio centrais não sofrem mutações cegas:
- **Transições de Estado Explícitas**: Entidades possuem ciclos de vida rigorosos (ex: `DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> COMPLETED / CANCELLED`).
- **Validação de Transições Proibidas**: Tentativas de mover diretamente de `DRAFT` para `COMPLETED` ou alterar entidades arquivadas disparam erros 400 sem corromper o banco.
- **Histórico de Transições**: Toda alteração de estado registra timestamp, usuário responsável e motivo da mudança.

---

## 2. Audit Trail Automático (`/api/audit-logs`)
Todo SaaS de nível corporativo implementa trilha de auditoria em conformidade com padrões de governança (SOC2 / ISO 27001):
- **Tabela Dedicada `audit_logs`**:
  ```sql
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'
    actor TEXT NOT NULL,
    details TEXT, -- JSON com snapshot do diff { before, after }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  ```
- **Middleware / Helper de Auditoria Transparente**: Toda rota que cria, atualiza ou exclui registros invoca `recordAuditLog({ entity, entityId, action, actor, details })`.
- **Endpoint REST `/api/audit-logs`**: Exposição segura com suporte a paginação e filtros para alimentar a aba ou timeline de atividades recentes no frontend.

---

## 3. Webhooks & Barramento de Eventos Internos
- **Event Dispatcher**: Publicação de eventos internos síncronos/assíncronos (ex: `eventBus.emit('transaction:completed', payload)`).
- **Consistência e Resiliência**: Falhas em webhooks secundários não devem abortar a transação principal do banco de dados SQLite.

---

## 4. Agregações SQL Avançadas e Exportação de Dados
- **Agregações em Tempo Real**: Uso de queries SQL com `strftime('%Y-%m', created_at)`, `COUNT()`, `SUM()`, `AVG()` e `GROUP BY` para gerar dados dos gráficos em menos de 10ms.
- **Exportação CSV no Servidor**: Rota `/api/<resource>/export?format=csv` gerando streams de dados com cabeçalhos apropriados (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="export.csv"`).

---

## 5. Densidade de Seed Determinística (`seedIfEmpty`)
- Para que o SaaS não inicie com telas e gráficos estéreis, o seeder de inicialização deve popular entre **15 a 30 registros ricos e interconectados**:
  - Clientes / Contas com nomes e metadados realistas;
  - Transações distribuídas ao longo dos últimos 30-90 dias com valores variados;
  - Logs de auditoria refletindo o ciclo de vida dessas entidades;
  - Planos e configurações pré-definidos.

---

# REA REVERSE-ENGINEERED BLUEPRINT: TALLY.SO (TALLY)
> **Fonte:** https://tally.so | **Arquétipo:** `notion-block-forms` | **Data da Captura:** 2026-10-22T21:14:22.353Z
> **Evidência Visual:** Desktop (1440x900), Mobile (390x844) e Seção de Produto capturados com Playwright.
> **Status de Engenharia Reversa:** Tokens CSS Computados, Árvore ARIA e Contratos de Rede Inspecionados com Sucesso.

---

## 1. Visão Geral da Arquitetura & Posicionamento
- **Nome do SaaS:** Tally.so
- **Título Capturado:** Tally - Create Beautiful Forms for Free | Unlimited Forms & Submissions
- **Meta Descrição:** The simplest way to create beautiful, professional forms in seconds. Unlimited forms, unlimited submissions, forever free. Just start typing - no coding needed.
- **Tema Central:** Airy, minimalist form building with frictionless inline slash-commands, Notion-like blocks, distraction-free typography and 1-click publishing
- **Complexidade de DOM:** ~919 nós inspecionados | 4 botões interativos | 0 campos de entrada | 74 links de navegação.

---

## 2. Tokens de Design CSS Computados (Extração Real via Runtime)

### Paleta de Cores Primária & Superfícies
```css
:root {
  /* Fundo & Texto Principal */
  --tally-bg-canvas: rgba(0, 0, 0, 0);
  --tally-text-main: rgb(55, 53, 47);
  --tally-nav-surface: rgb(255, 255, 255);
  
  /* Componentes & Ações */
  --tally-button-bg: rgb(0, 112, 215);
  --tally-button-text: rgb(55, 53, 47);
  --tally-card-surface: rgba(0, 0, 0, 0);
  --tally-card-border: rgb(248, 28, 229);

  /* Métricas Geométricas */
  --tally-radius-button: 8px;
  --tally-radius-card: 0px;
  --tally-padding-button: 0px 13.5px;
  --tally-shadow-elevation: none;
}
```

### Tipografia & Hierarquia
- **Fonte Principal (Body):** `Inter, "Inter Fallback", sans-serif` (Tamanho: `16px`, Peso: `400`, Altura de Linha: `18.4px`)
- **Títulos (H1):** `Inter, "Inter Fallback", sans-serif` (Tamanho: `64px`, Peso: `700`)
- **Subtítulos (H2):** Tamanho: `36px`
- **Fontes Detectadas na Pilha:** Times New Roman, Inter

---

## 3. Padrões de Interface & Anatomia de Componentes

### A. Filosofia do Arquétipo `notion-block-forms`

- **Formulário Dinâmico em Bloco (Estilo Notion):** Em vez de campos isolados em caixas rígidas, cada pergunta é um bloco editável com barra de atalho `/` (slash commands).
- **Entrada Sem Atrito:** Input inline, placeholders inteligentes, navegação fluída por teclado (Enter avança, Shift+Tab volta).
- **Micro-interações de Alta Conversão:** Barra de progresso discreta no topo, botões de opção múltipla que reagem ao clique com feedback instantâneo e ausência total de poluição visual.
- **Tipografia Airy:** Espaçamento generoso (`density: 4/10`), contraste suave e visual limpo com foco 100% no conteúdo.


### B. Diretrizes para Agentes de Desenvolvimento (DecoHUB Engine)
1. **Zero Emojis em Botões e Cabeçalhos:** Utilizar estritamente ícones SVG inline ou componentes Lucide/Radix.
2. **Números Tabulares:** Sempre aplicar `font-variant-numeric: tabular-nums` em contadores, métricas, preços e datas.
3. **Persistência Reativa:** Todas as alterações devem refletir na Store reativa e persistir no SQLite/F5 sem atraso perceptível.
4. **Respeito aos Dials:**
   - **Variance:** 3/10 (Sóbrio/Fluído)
   - **Motion:** 2/10 (Sutil)
   - **Density:** 4/10 (Espaçoso/Leitura)

---

## 4. Contratos de Rede & Estrutura de Endpoints
Endpoints detectados durante a carga inicial da aplicação:
```json
[
  {
    "url": "https://plausible.io/api/event",
    "method": "POST",
    "postData": "{\"n\":\"pageview\",\"u\":\"https://tally.so/\",\"d\":\"tally.so\",\"r\":null,\"w\":1440,\"h\":0}"
  },
  {
    "url": "https://o407628.ingest.us.sentry.io/api/5277002/envelope/?sentry_version=7&sentry_key=c17ee4982b124541ae255c0c2f93d48f&sentry_client=sentry.javascript.nextjs%2F11.8.0",
    "method": "POST",
    "postData": "{\"sent_at\":\"2026-10-22T21:14:14.851Z\",\"sdk\":{\"name\":\"sentry.javascript.nextjs\",\"version\":\"11.8.0\"}}\n{\"type\":\"session\"}\n{\"sid\":\"ece5e7835c0b44478f9e178549145962\",\"init\":true,\"started\":\"2026-10-22T21:14:14.551Z\",\"timestamp\":\"2026-10-22T21:14:14.552Z\",\"status\":\"ok\",\"errors\":0,\"attrs\":{\"release\":\"23eb05531099bb8669f3c57602d5883f380de869\",\"environment\":\"production\",\"ip_address\":\"{{auto}}\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 S"
  }
]
```

---

## 5. Pacotes e Bundles Detectados
Amostra de scripts e provedores de frontend identificados no runtime:
```json
[
  {
    "url": "https://tally.so/widgets/embed.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/webpack-8cf55751a23fade0.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/framework-4613fb5e3320addf.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/main-ec1689a9ca894eb1.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/pages/_app-e0b01f0715267707.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/48f93c21-1e9e532c1841d11e.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/37133-777e6f51555ac944.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/66170-0609cb89c617f83b.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/24607-8f8269138e887a86.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/6109-227753a5ac154088.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/9479-5713e17ac20a22a5.js",
    "method": "GET"
  },
  {
    "url": "https://tally.so/_next/static/chunks/89736-dbbe4cdf99b27844.js",
    "method": "GET"
  }
]
```

---

## 6. Evidências de Arquivo & Referências Visuais
- **Desktop Screenshot:** `DOCSIMP/rea-blueprints/references/tally/desktop_1440x900.png`
- **Mobile Screenshot:** `DOCSIMP/rea-blueprints/references/tally/mobile_390x844.png`
- **Product Section:** `DOCSIMP/rea-blueprints/references/tally/product_section.png`
- **Tokens Brutos:** `rea-engine-repo/targets/tally/tokens.json`
- **Árvore ARIA Bruta:** `rea-engine-repo/targets/tally/aria_tree.json`

---

# REA REVERSE-ENGINEERED BLUEPRINT: N8N.IO (N8N)
> **Fonte:** https://n8n.io | **Arquétipo:** `visual-node-workflow` | **Data da Captura:** 2026-10-22T21:14:30.221Z
> **Evidência Visual:** Desktop (1440x900), Mobile (390x844) e Seção de Produto capturados com Playwright.
> **Status de Engenharia Reversa:** Tokens CSS Computados, Árvore ARIA e Contratos de Rede Inspecionados com Sucesso.

---

## 1. Visão Geral da Arquitetura & Posicionamento
- **Nome do SaaS:** n8n.io
- **Título Capturado:** AI Workflow Automation Platform - n8n
- **Meta Descrição:** n8n is a workflow automation platform that uniquely combines AI capabilities with business process automation, giving technical teams the flexibility of code with the speed of no-code.
- **Tema Central:** Interactive node graph canvas, dark/light workflow builder, execution telemetry, trigger-action connectors, real-time node debug state
- **Complexidade de DOM:** ~1886 nós inspecionados | 23 botões interativos | 3 campos de entrada | 47 links de navegação.

---

## 2. Tokens de Design CSS Computados (Extração Real via Runtime)

### Paleta de Cores Primária & Superfícies
```css
:root {
  /* Fundo & Texto Principal */
  --n8n-bg-canvas: rgb(250, 250, 250);
  --n8n-text-main: rgb(22, 22, 22);
  --n8n-nav-surface: rgba(0, 0, 0, 0);
  
  /* Componentes & Ações */
  --n8n-button-bg: rgba(0, 0, 0, 0);
  --n8n-button-text: rgb(22, 22, 22);
  --n8n-card-surface: rgba(0, 0, 0, 0);
  --n8n-card-border: rgb(22, 22, 22);

  /* Métricas Geométricas */
  --n8n-radius-button: 9999px;
  --n8n-radius-card: 0px;
  --n8n-padding-button: 12px 16px;
  --n8n-shadow-elevation: none;
}
```

### Tipografia & Hierarquia
- **Fonte Principal (Body):** `"n8n Baumer Uniwidth", Helvetica, system-ui, -apple-system, sans-serif` (Tamanho: `16px`, Peso: `400`, Altura de Linha: `24px`)
- **Títulos (H1):** `"n8n Baumer Uniwidth", Helvetica, system-ui, -apple-system, sans-serif` (Tamanho: `64px`, Peso: `500`)
- **Subtítulos (H2):** Tamanho: `48px`
- **Fontes Detectadas na Pilha:** n8n Baumer Uniwidth

---

## 3. Padrões de Interface & Anatomia de Componentes

### A. Filosofia do Arquétipo `visual-node-workflow`

- **Canvas de Automação Visual (Graph Canvas):** Grid interativo com nós encadeados (Trigger -> Action -> Filter -> Output).
- **Painéis de Nós Conectáveis:** Portas de entrada e saída com cores semânticas (verde=sucesso, vermelho=erro, azul=trigger).
- **Execution Telemetry & Live Debugging:** Visualização do payload JSON inspecionado nó a nó com abas de Input/Output e tempo de execução em milissegundos (`tabular-nums`).
- **Barra de Ferramentas Flutuante:** Controles de zoom, pan, auto-organização, execução de teste e histórico de execuções.


### B. Diretrizes para Agentes de Desenvolvimento (DecoHUB Engine)
1. **Zero Emojis em Botões e Cabeçalhos:** Utilizar estritamente ícones SVG inline ou componentes Lucide/Radix.
2. **Números Tabulares:** Sempre aplicar `font-variant-numeric: tabular-nums` em contadores, métricas, preços e datas.
3. **Persistência Reativa:** Todas as alterações devem refletir na Store reativa e persistir no SQLite/F5 sem atraso perceptível.
4. **Respeito aos Dials:**
   - **Variance:** 4/10 (Estruturado)
   - **Motion:** 4/10 (Conexões vivas)
   - **Density:** 8/10 (Painéis ricos)

---

## 4. Contratos de Rede & Estrutura de Endpoints
Endpoints detectados durante a carga inicial da aplicação:
```json
[
  {
    "url": "https://n8n.io/api/geo",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.77.1/dist/dotlottie-player.wasm",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-burger.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-chevron.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-arrow.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/icon-arrow.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/assets/lottie/logo-n8n-hover-snapped.lottie",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://n8n.io/_nuxt/builds/meta/5e50d5df-560a-4e24-bdd1-32293c8d2c5b.json",
    "method": "GET",
    "postData": null
  }
]
```

---

## 5. Pacotes e Bundles Detectados
Amostra de scripts e provedores de frontend identificados no runtime:
```json
[
  {
    "url": "https://www.googletagmanager.com/gtm.js?id=GTM-K7L9C6X",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/DX-L_LBH.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/VWAIIfB_.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/B7UWrzKv.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/VAAr_vGR.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/DBbpiCv6.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/D3I1CNxx.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/hgVFBlZh.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/C7Jk32Mh.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/CYoaoWUU.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/By4CKHE7.js",
    "method": "GET"
  },
  {
    "url": "https://n8n.io/_nuxt/CMBXkaP5.js",
    "method": "GET"
  }
]
```

---

## 6. Evidências de Arquivo & Referências Visuais
- **Desktop Screenshot:** `DOCSIMP/rea-blueprints/references/n8n/desktop_1440x900.png`
- **Mobile Screenshot:** `DOCSIMP/rea-blueprints/references/n8n/mobile_390x844.png`
- **Product Section:** `DOCSIMP/rea-blueprints/references/n8n/product_section.png`
- **Tokens Brutos:** `rea-engine-repo/targets/n8n/tokens.json`
- **Árvore ARIA Bruta:** `rea-engine-repo/targets/n8n/aria_tree.json`

---

# REA REVERSE-ENGINEERED BLUEPRINT: ATTIO.COM (ATTIO)
> **Fonte:** https://attio.com | **Arquétipo:** `crm-data-engine` | **Data da Captura:** 2026-10-22T21:15:08.198Z
> **Evidência Visual:** Desktop (1440x900), Mobile (390x844) e Seção de Produto capturados com Playwright.
> **Status de Engenharia Reversa:** Tokens CSS Computados, Árvore ARIA e Contratos de Rede Inspecionados com Sucesso.

---

## 1. Visão Geral da Arquitetura & Posicionamento
- **Nome do SaaS:** Attio.com
- **Título Capturado:** Attio: The CRM for agentic revenue
- **Meta Descrição:** The system for revenue teams to build pipeline, accelerate deals, and grow accounts around the clock.	
- **Tema Central:** Next-gen data-dense CRM, spreadsheet-like interactive table views, Kanban toggle, custom object attributes, ultra-slick dark mode palette
- **Complexidade de DOM:** ~4646 nós inspecionados | 20 botões interativos | 5 campos de entrada | 121 links de navegação.

---

## 2. Tokens de Design CSS Computados (Extração Real via Runtime)

### Paleta de Cores Primária & Superfícies
```css
:root {
  /* Fundo & Texto Principal */
  --attio-bg-canvas: lab(99.9987 0.0337958 0.000309944);
  --attio-text-main: lab(10.7201 -0.0959039 -1.54182);
  --attio-nav-surface: oklab(0.999997 0.0000899732 0.000023365 / 0.95);
  
  /* Componentes & Ações */
  --attio-button-bg: rgba(0, 0, 0, 0);
  --attio-button-text: lab(94.3726 -0.157326 -2.23036);
  --attio-card-surface: rgba(0, 0, 0, 0);
  --attio-card-border: lab(86.0989 -0.77799 -4.0961);

  /* Métricas Geométricas */
  --attio-radius-button: 10px;
  --attio-radius-card: 0px;
  --attio-padding-button: 0px;
  --attio-shadow-elevation: none;
}
```

### Tipografia & Hierarquia
- **Fonte Principal (Body):** `inter, "inter Fallback"` (Tamanho: `16px`, Peso: `500`, Altura de Linha: `22px`)
- **Títulos (H1):** `interDisplay, "interDisplay Fallback"` (Tamanho: `64px`, Peso: `600`)
- **Subtítulos (H2):** Tamanho: `40px`
- **Fontes Detectadas na Pilha:** inter

---

## 3. Padrões de Interface & Anatomia de Componentes

### A. Filosofia do Arquétipo `crm-data-engine`

- **CRM Data Engine de Alta Densidade (Estilo Planilha/Database):** Tabelas interativas ultra-rápidas com redimensionamento de colunas, ordenação multi-critério e filtros booleanos compostos.
- **Alternância Fluída Tabela / Kanban / Galeria:** O mesmo modelo relacional renderiza instantaneamente em Grid tabular ou Board Kanban.
- **Slide-Over Detail Drawers Rápidos:** Clicar em qualquer registro abre um Drawer lateral sem reload, permitindo editar atributos inline com sincronização otimista (`optimistic-ui`).
- **Visual Dark Mode Sofisticado:** Paleta dark de alta densidade (`density: 9/10`), bordas sutis com opacidade (`rgba(255,255,255,0.08)`) e badges monocromáticos.


### B. Diretrizes para Agentes de Desenvolvimento (DecoHUB Engine)
1. **Zero Emojis em Botões e Cabeçalhos:** Utilizar estritamente ícones SVG inline ou componentes Lucide/Radix.
2. **Números Tabulares:** Sempre aplicar `font-variant-numeric: tabular-nums` em contadores, métricas, preços e datas.
3. **Persistência Reativa:** Todas as alterações devem refletir na Store reativa e persistir no SQLite/F5 sem atraso perceptível.
4. **Respeito aos Dials:**
   - **Variance:** 2/10 (Ultra-simétrico)
   - **Motion:** 3/10 (Transições rápidas de 150ms)
   - **Density:** 9/10 (Cockpit/Dados)

---

## 4. Contratos de Rede & Estrutura de Endpoints
Endpoints detectados durante a carga inicial da aplicação:
```json
[
  {
    "url": "https://attio.com/monitoring?o=394581&p=4505793402896384&r=us",
    "method": "POST",
    "postData": "{\"sent_at\":\"2026-10-22T21:14:31.846Z\",\"sdk\":{\"name\":\"sentry.javascript.nextjs\",\"version\":\"10.70.0\"},\"dsn\":\"https://afceb9e6ddac6219e4bf7c3e2fc69c53@o394581.ingest.us.sentry.io/4505793402896384\"}\n{\"type\":\"session\"}\n{\"sid\":\"9490c70fc23540bf9cf1ce1dfad13e12\",\"init\":true,\"started\":\"2026-10-22T21:14:31.384Z\",\"timestamp\":\"2026-10-22T21:14:31.846Z\",\"status\":\"exited\",\"errors\":0,\"attrs\":{\"release\":\"fd32935d234269e3d81eec58db042a826791bb7f\",\"environment\":\"vercel-production\",\"ip_address\":\"{{auto}}\",\"user_a"
  },
  {
    "url": "https://attio.com/monitoring?o=394581&p=4505793402896384&r=us",
    "method": "POST",
    "postData": "{\"sent_at\":\"2026-10-22T21:14:31.849Z\",\"sdk\":{\"name\":\"sentry.javascript.nextjs\",\"version\":\"10.70.0\"},\"dsn\":\"https://afceb9e6ddac6219e4bf7c3e2fc69c53@o394581.ingest.us.sentry.io/4505793402896384\"}\n{\"type\":\"session\"}\n{\"sid\":\"22657ab6a531436d9fab52da41c2e9eb\",\"init\":true,\"started\":\"2026-10-22T21:14:31.846Z\",\"timestamp\":\"2026-10-22T21:14:31.846Z\",\"status\":\"ok\",\"errors\":0,\"attrs\":{\"release\":\"fd32935d234269e3d81eec58db042a826791bb7f\",\"environment\":\"vercel-production\",\"ip_address\":\"{{auto}}\",\"user_agent"
  },
  {
    "url": "https://attio.com/architecture?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/platform/developers?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/customers?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/pricing?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/contact/sales?_rsc=ry-B8umWgNEV4JR9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/architecture?_rsc=_O151lDcRMVWBHgN",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/architecture?_rsc=ffdC8ycuY0GgkEC9",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/architecture?_rsc=gVowDG9xutzX-5xt",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/architecture?_rsc=01cY024glA7vLDXh",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/?_rsc=uVfOZI3haWjue2fV",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/platform/developers?_rsc=fio5_JwFjGbzjleE",
    "method": "GET",
    "postData": null
  },
  {
    "url": "https://attio.com/customers?_rsc=D8MGNGzHPB-Ax5ac",
    "method": "GET",
    "postData": null
  }
]
```

---

## 5. Pacotes e Bundles Detectados
Amostra de scripts e provedores de frontend identificados no runtime:
```json
[
  {
    "url": "https://attio.com/_next/static/immutable/chunks/1x7uobc6l354e.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/3qx8ql21155i5.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/2k792_6arszu9.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/3_l7i0kkb92or.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/0p0us8vukh49-.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/3_8bfdob97dht.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/turbopack-2_04ewhudzrza.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/1_q4idoj_b3_n.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/2_tlk210ylk_i.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/1o6_dzlznike_.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/1_sysi24ojtb6.js",
    "method": "GET"
  },
  {
    "url": "https://attio.com/_next/static/immutable/chunks/1498ty93a_t9k.js",
    "method": "GET"
  }
]
```

---

## 6. Evidências de Arquivo & Referências Visuais
- **Desktop Screenshot:** `DOCSIMP/rea-blueprints/references/attio/desktop_1440x900.png`
- **Mobile Screenshot:** `DOCSIMP/rea-blueprints/references/attio/mobile_390x844.png`
- **Product Section:** `DOCSIMP/rea-blueprints/references/attio/product_section.png`
- **Tokens Brutos:** `rea-engine-repo/targets/attio/tokens.json`
- **Árvore ARIA Bruta:** `rea-engine-repo/targets/attio/aria_tree.json`