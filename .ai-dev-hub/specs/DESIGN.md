# SISTEMA DE DESIGN VISUAL ANTI-SLOP & DIRETRIZES DE UI (DESIGN.MD)

> **Fonte Canônica de Design do WhatsappEntrega:** Este documento dita as cores, tipografia, tokens CSS, coreografia e estados de interface que impedem qualquer degradação de qualidade visual (Anti-Slop).

---

## 1. Arquétipo Visual, Dials & Habilidades de Design Injetadas Autonomamente
- **Arquétipo Selecionado:** `STRIPE` (Stripe Infrastructure: Superfícies elegantes, microinterações precisas e estética de plataforma financeira global.)
- **Skill Estética Injetada Automaticamente:** `stripe-skill` (autonomamente provisionada para o nicho "AI Automation, LLM Observability & Agents" sem necessidade de slash commands manuais)
- **Dials de Taste:**
  - **Variância:** 6/10 (Equilíbrio e Simetria)
  - **Movimento:** 4/10 (Transições CSS Suaves <150ms)
  - **Densidade:** 5/10 (Cockpit de Alta Densidade / SaaS Master)

---

## 2. Paleta de Tokens CSS Semânticos Obrigatórios (`:root`)
Todo estilo de componentes deve consumir estritamente as variáveis abaixo, proibindo cores hexadecimais soltas nas regras CSS:

```css
:root {
  /* Shadcn/UI Semantic Design Tokens */
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;

  /* Superfícies & Fundos */
  --bg-primary: #090d16;
  --bg-surface: #111726;
  --bg-elevated: #1a2236;

  /* Tipografia & Contraste */
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  /* Cor de Ação & Destaque */
  --accent-primary: ${blueprint.accentColor};
  --accent-hover: #4f46e5;
  --accent-subtle: rgba(99, 102, 241, 0.12);

  /* Bordas & Divisores */
  --border-subtle: #1e293b;
  --border-strong: #334155;

  /* Estados Semânticos */
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-danger: #ef4444;
  --status-info: #0ea5e9;

  /* Raios e Tipografia */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', Menlo, Consolas, monospace;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 212.8 26.8% 83.9%;
  --radius: 0.5rem;
}
```

---

## 3. Regras Tipográficas & Numéricas
- **Interface Principal:** Fonte `Inter` para labels, títulos e textos com espaçamento reduzido e peso 500/600.
- **Regra Numérica Obrigatória (`tabular-nums`):** Todos os valores monetários, percentuais, contadores, datas e células numéricas de Data Grid devem aplicar:
  ```css
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-family: var(--font-mono);
  ```

---

## 4. Anatomia Visual de Componentes & Especificações Detalhadas
- **Grid de Cards e Linhas (Data Grid):**
  - **Preview de Thumbnail 16:9 (`96x54px`):** Proporção estrita `aspect-ratio: 16/9`, cantos arredondados (`--radius-sm`), borda sutil (`--border-subtle`) e fallback SVG se imagem offline.
  - **Badge de Duração Monospace:** Posicionado no canto inferior direito da thumbnail com `font-family: var(--font-mono)`, tamanho reduzido (`11px`), padding `2px 4px`, background `rgba(0, 0, 0, 0.85)` e contraste `--text-primary`.
  - **Pílulas Semânticas de Outlier Multiplier:**
    - `>= 5.0x`: **Verde Esmeralda** (`background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 700;`) indicando viral extremo / anomalia de alta performance.
    - `>= 2.5x`: **Azul / Cyan** (`background: rgba(14, 165, 233, 0.15); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.3); font-weight: 600;`) indicando alta tração.
    - `< 2.5x`: **Neutro** (`background: rgba(148, 163, 184, 0.1); color: var(--text-muted); border: 1px solid var(--border-subtle);`).
- **Barra de Filtros Compostos de Engajamento:**
  - Input de busca textual com debounce (250ms) por título, palavras-chave ou canal.
  - Seletor de Faixa de Visualizações (Todos, >10k, >100k, >1M).
  - Filtro por Taxa de Engajamento mínima (Engagement %).
  - Filtro por Outlier Score mínimo (>= 2.5x, >= 5.0x, >= 10x).
  - Seletor de Formato: Todos, Shorts, Vídeos Longos.
  - Ordenação dinâmica por Outlier Multiplier, Views, VPH (Views Per Hour) ou Data de Publicação.
- **Slide-Over Inspector Drawer (520px):**
  - Painel lateral deslizante com largura fixa de `520px` (`role="dialog"` e `aria-modal="true"`).
  - Animação CSS suave (`transform: translateX(0)` com `backdrop-filter: blur(4px)`).
  - Header com preview de thumbnail 16:9 expandida, título completo do vídeo, link canônico e canal.
  - **Abas Internas do Drawer:**
    - **Aba Métricas:** Painel tabular formatado com `tabular-nums` exibindo Views, Likes, Comentários, Engagement Rate, Outlier Score e VPH.
    - **Aba Transcrição & Hooks:** Decomposição dos primeiros 30 segundos, ganchos de retenção, tags de tração e notas de roteiro.
    - **Aba Auditoria JSON:** Payload bruto da entidade com visualizador JSON estruturado e diff de mutações.
- **Botões:** Estados `:hover`, `:active` (`transform: scale(0.98)`) e `:disabled` com opacidade 0.5.
- **Inputs & Selects:** Borda `--border-subtle`, foco com outline de 2px em `--accent-primary` e transição suave.
- **Command Palette (`Ctrl+K`):** Overlay elevado em `--bg-elevated`, pesquisa debounce e atalhos rápidos de navegação.
- **Ícones:** Uso exclusivo de **ícones SVG Lucide inline** (24x24 ou 16x16, stroke-width 2). **Zero emojis nativos como ícones.**

---

## 5. Arquitetura de Componentes shadcn/ui & 21st.dev
Padrões de componentes de alta conversão e microinterações modernas:
- **Anatomia Exata de Botões:**
  - `btn-primary`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50`
  - `btn-secondary`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
  - `btn-ghost`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2`
  - `btn-destructive`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2`
- **Inputs com Focus Ring:** `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`
- **Bento Grid & Spotlight Metric Cards (21st.dev):** Cards de KPI com borda sutil (`1px solid`), efeito de brilho suave no hover (`radial-gradient`), badge de variação percentual (`+14.2%` em verde esmeralda com `tabular-nums`) e sparkline SVG no rodapé do card.
- **Shadcn Data Table Avançada:** Cabeçalho fixo com tipografia `text-xs font-medium text-muted-foreground uppercase tracking-wider`, linhas com `hover:bg-muted/50 transition-colors`, badges semânticos (`rounded-full px-2.5 py-0.5 text-xs font-medium`), barra de busca com atalho visual `⌘K` / `Ctrl+K` e dropdown de filtros.
- **Shadcn Sheet (Slide-Over Drawer) & Dialog:** Painel lateral com backdrop `backdrop-blur-sm bg-black/60`, transição suave (`cubic-bezier(0.16, 1, 0.3, 1)`), cabeçalho com título/subtítulo e rodapé fixo de ações.
- **Animated Segmented Tabs (`role="tab"` + `data-tab`):** Navegação com indicador ativo em formato de pílula (`bg-secondary text-foreground shadow-sm`) e estados vazios (`Empty State`) ilustrados com SVG Lucide + botão de Call-to-Action primário.
- **Declaração CSS/HTML:** Quando o projeto usar Tailwind CDN ou CSS modular, declarar as classes utilitárias e variáveis do shadcn/ui logo no início de `public/styles.css` ou `public/index.html`.

---

## 6. Os 4 Estados Visuais Obrigatórios em Cada Tela
1. **Loading Skeleton:** Shimmer translúcido ocupando a área exata dos cards e tabelas durante requisições.
2. **Empty State:** Ícone SVG temático suave, mensagem explicativa clara e botão primário para criar o primeiro registro.
3. **Populated State:** Grade rica com alta densidade, paginação, busca instantânea e ordenação.
4. **Error Toast:** Alerta flutuante com auto-dismiss (4s) e opção de repetição da ação.

---

## 7. Anatomia Detalhada de Componentes, Hierarquia Visual, Densidade e Micro-Interações do Produto
- **Arquitetura Espacial & Grid CSS:**
  - **Sidebar:** `240px` expandida / `64px` colapsada com transição fluida (`150ms ease`), navegação semântica em abas (`role="tab"` e `data-tab`) e contadores dinâmicos.
  - **Topbar:** Altura fixa de `56px` (`role="banner"`), seletor de Workspace com persistência local, status de conectividade em tempo real e sino de notificações.
  - **Container Principal:** `max-width: 1600px`, `padding: 24px`, `gap: 16px` e layout responsivo adaptável a desktops e notebooks.
  - **Bento Grid de KPIs:** `grid-template-columns: repeat(4, minmax(0, 1fr))`, cards com `padding: 16px`, sparklines SVG inline e badges com variação percentual (`+Δ%` verde, `-Δ%` vermelho).
- **Anatomia da Barra de Filtros do Domínio:**
  - **Busca Textual com Debounce (250ms):** Campo de busca responsivo para títulos, canais, tags e palavras-chave sem bloquear a thread principal do navegador.
  - **Seletores de Métricas do Domínio:** Faixas de Visualizações (Todos, >10k, >100k, >1M), Taxa de Engajamento mínima, Outlier Multiplier (>= 2.5x, >= 5x, >= 10x) e Formato (Todos, Shorts, Longos).
  - **Pílulas de Filtro Rápido (*Quick Filter Pills*):** Presets em 1 clique ("Top Virais 24h", "Outliers Extremos >5x", "Shorts em Alta Tração").
  - **Ordenação Multicritério:** Por Outlier Multiplier, Views, VPH (Views Per Hour) ou Data de Publicação.
  - **Contador Vivo de Resultados:** Indicador textual em fonte monospace (`font-variant-numeric: tabular-nums`) com feedback de registros filtrados.
- **Anatomia dos Cards / Tabela Principal do Domínio:**
  - **Layout Híbrido - Galeria de Cards 16:9:**
    - Preview de thumbnail 16:9 (`aspect-ratio: 16/9`, `border-radius: var(--radius-sm)`, `border: 1px solid var(--border-subtle)`) com fallback SVG gradiente.
    - Badge de duração monospace (`11px`, `padding: 2px 4px`) posicionado no canto inferior direito com fundo escuro (`rgba(0, 0, 0, 0.85)`).
    - Avatar do canal, título completo com line-clamp de 2 linhas e tags de nicho.
    - Pílulas semânticas de *Outlier Score*: `>= 5.0x` **Verde Esmeralda** (`#10b981`), `>= 2.5x` **Azul** (`#0ea5e9`), `< 2.5x` neutro.
    - Barra sutil de *Engagement Rate %* com preenchimento reativo.
  - **Modo Tabela Analítica (`tabular-nums`):**
    - Densidade de linha (`height: 44px`), alinhamento numérico à direita, sparklines inline e alternância fluida via botão de toggle Lista/Cards.
- **Anatomia do Slide-Over Inspector Drawer (`width: 520px`):**
  - Painel lateral deslizante com largura fixa de `520px` (`role="dialog"` e `aria-modal="true"`) com backdrop blur (`backdrop-filter: blur(8px)`).
  - Header fixo com ações rápidas (link externo, copiar dados, favoritar e fechar via `Esc`).
  - Grade de mini-cards com métricas do item selecionado formatadas em `tabular-nums` (Views, Likes, Comentários, Engagement Rate, Outlier Score, VPH).
  - Abas internas contextualizadas ao domínio:
    - *Aba Métricas & Breakdown:* KPIs detalhados, série histórica e benchmark comparativo com a média do canal.
    - *Aba Conteúdo / Transcrição / Edição:* Decomposição de ganchos nos primeiros 30s, tópicos-chave e campo de notas com salvamento reativo.
    - *Aba Histórico & JSON Audit:* Visualizador do payload bruto em JSON syntax-highlighted com trilha forense imutável de `audit_logs`.
  - Estados de Loading Skeleton translúcido e Empty State temático em cada aba.

---

## 5. Arquitetura de Componentes shadcn/ui & 21st.dev
Padrões de componentes de alta conversão e microinterações modernas:
- **Anatomia Exata de Botões:**
  - `btn-primary`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50`
  - `btn-secondary`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
  - `btn-ghost`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2`
  - `btn-destructive`: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2`
- **Inputs com Focus Ring:** `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`
- **Bento Grid & Spotlight Metric Cards (21st.dev):** Cards de KPI com borda sutil (`1px solid`), efeito de brilho suave no hover (`radial-gradient`), badge de variação percentual (`+14.2%` em verde esmeralda com `tabular-nums`) e sparkline SVG no rodapé do card.
- **Shadcn Data Table Avançada:** Cabeçalho fixo com tipografia `text-xs font-medium text-muted-foreground uppercase tracking-wider`, linhas com `hover:bg-muted/50 transition-colors`, badges semânticos (`rounded-full px-2.5 py-0.5 text-xs font-medium`), barra de busca com atalho visual `⌘K` / `Ctrl+K` e dropdown de filtros.
- **Shadcn Sheet (Slide-Over Drawer) & Dialog:** Painel lateral com backdrop `backdrop-blur-sm bg-black/60`, transição suave (`cubic-bezier(0.16, 1, 0.3, 1)`), cabeçalho com título/subtítulo e rodapé fixo de ações.
- **Animated Segmented Tabs (`role="tab"` + `data-tab`):** Navegação com indicador ativo em formato de pílula (`bg-secondary text-foreground shadow-sm`) e estados vazios (`Empty State`) ilustrados com SVG Lucide + botão de Call-to-Action primário.
- **Declaração CSS/HTML:** Quando o projeto usar Tailwind CDN ou CSS modular, declarar as classes utilitárias e variáveis do shadcn/ui logo no início de `public/styles.css` ou `public/index.html`.
