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
