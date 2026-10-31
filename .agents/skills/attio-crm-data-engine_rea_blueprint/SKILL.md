---
name: attio-crm-data-engine_rea_blueprint
description: "Skill attio-crm-data-engine_rea_blueprint para desenvolvimento autônomo e assistido no DecoHUB."
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
