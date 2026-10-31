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
