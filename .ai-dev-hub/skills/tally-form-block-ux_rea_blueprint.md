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
