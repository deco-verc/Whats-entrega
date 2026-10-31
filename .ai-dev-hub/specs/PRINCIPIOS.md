# PRINCÍPIOS DE ENGENHARIA, APPSEC & INVARIANTES OPERACIONAIS (PRINCIPIOS.MD)

> **Constituição Canônica de Engenharia do WhatsappEntrega:** Regras de ouro derivadas dos princípios de Andrej Karpathy e das defesas Red Team AppSec do DecoHUB.

---

## 1. Os 6 Princípios Globais de Engenharia (Andrej Karpathy)
1. **THINK BEFORE CODING:** Identifique premissas, ambiguidades e a menor solução antes de tocar no código. Em execuções autônomas (`run_id` ativo), é **estritamente proibido invocar `ask_question`** ou bloquear o terminal; resolva qualquer ambiguidade consultando os 5 documentos canônicos em `.ai-dev-hub/specs/` (`PRINCIPIOS.md`, `CONTEUDO.md`, `BACKEND.md`, `DESIGN.md`, `JORNADAS.md`).
2. **SIMPLICITY FIRST:** Menor implementação correta que resolve 100% do problema. Zero abstrações para uso único. Simplicidade NUNCA significa produto raso: entregue os 7 Pilares SaaS Master e povoamento realista via `seedIfEmpty()`.
3. **SURGICAL CHANGES:** Toque apenas nos arquivos indispensáveis ao escopo da tarefa. Nunca reformatar código adjacente ou quebrar contratos já validados em suítes anteriores.
4. **GOAL-DRIVEN VERIFICATION:** Cada tarefa deve ser verificada por comando simples compatível com `controlledVerification.ts` (sem encadeamentos como `&&`, `;`, `||`, `|` ou `node -e`).
5. **OPERATIONAL AUTONOMY:** Processos e servidores efêmeros criados em testes devem ser encerrados obrigatoriamente em blocos `try / finally` (`server.stop()`). Proibição absoluta de alterar ou enfraquecer testes protegidos (`TAMPERING_DETECTED`).
6. **FULL-STACK, APPSEC & ANTI-SLOP INVARIANTS:** Cumprir todas as salvaguardas de rede, roteamento e segurança listadas a seguir.

---

## 2. Rede & Regra PORT_GUARD
- O servidor da aplicação deve ler a porta exclusivamente de `Number(process.env.PORT) || 4000`, operando na faixa **4000 a 4999**.
- **PROIBIÇÃO ESTRITA:** É terminantemente proibido utilizar as portas **`3001`**, **`3000`** ou **`5173`**, que são reservadas aos processos do DecoHUB.

---

## 3. Roteamento Full-Stack & Entrega Estática
- A rota raiz `GET /` deve servir estritamente o arquivo HTML da aplicação (`public/index.html`) com fallback para rotas de SPA caso não possuam extensão de arquivo.
- O endpoint de status operacional deve residir exclusivamente em `GET /api/health`.
- **ANTI-PADRÃO PROIBIDO (`ROOT_ROUTE_HIJACKED_BY_JSON`):** A rota `GET /` jamais deve responder com JSON de API.

---

## 4. Blindagem AppSec Red Team (OWASP Top 10)
- **SQL Injection:** 100% das queries SQLite devem utilizar queries parametrizadas com placeholders `?` (ex: `db.prepare('SELECT * FROM t WHERE id = ?').get(id)`). Concatenação de variáveis em SQL é proibida.
- **Cross-Site Scripting (XSS):** Todo dado dinâmico injetado no DOM via `innerHTML` deve passar obrigatoriamente pela função `escapeHtml()`. Sempre que possível, utilize `element.textContent` ou `document.createElement`.
- **Path Traversal:** O servidor de arquivos estáticos deve verificar canonicamente se o caminho do arquivo resolvido inicia com o diretório base:
  `safePath = path.normalize(path.join(publicDir, reqPath)); safePath.startsWith(resolvedPublicDir)`. Violações devem retornar HTTP 403 Forbidden.
- **Cabeçalhos de Segurança:** Todas as respostas HTTP devem incluir `X-Content-Type-Options: nosniff` e tipos MIME precisos (`text/html; charset=utf-8`, `application/json; charset=utf-8`).

---

## 5. Fidelidade de Persistência pós-F5
- Ao recarregar a página (evento `DOMContentLoaded`), o script `public/app.js` deve obrigatoriamente disparar chamadas `fetch()` aos endpoints da API (`/api/kpis`, `/api/transactions`, etc.) para hidratar o estado da tela com dados factuais do SQLite.
- Proibido manter dados apenas em variáveis voláteis de memória do navegador.
