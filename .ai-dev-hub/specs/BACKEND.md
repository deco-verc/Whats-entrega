# ESPECIFICAÇÃO DE BACKEND, BANCO SQLITE & CONTRATOS REST (BACKEND.MD)

> **Contrato Canônico do Backend do WhatsappEntrega:** Este documento é a Fonte Única de Verdade para schemas de banco de dados SQLite, contratos de requisição/resposta das rotas REST e fórmulas de domínio. O frontend (`public/app.js`) e o backend (`src/server.js`) devem consumir estritamente os mesmos nomes de propriedades JSON.

---

## 1. Esquema Relacional SQLite Completo
O arquivo do banco de dados deve ser inicializado pelo backend utilizando o utilitário nativo `node:sqlite` (DatabaseSync) com suporte obrigatório a `PRAGMA journal_mode = WAL;` e `PRAGMA busy_timeout = 10000;`.

```sql
-- Esquema Relacional SQLite - AI Automation & LLM Observability
CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL DEFAULT 'gpt-4o',
  system_prompt TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 2048,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  prompt_input TEXT NOT NULL,
  response_output TEXT,
  model_used TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES ai_agents (id)
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  template TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES ai_agents (id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_runs_agent ON execution_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON execution_runs (status);
CREATE INDEX IF NOT EXISTS idx_execution_runs_created ON execution_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);
```

---

## 2. Tabela Canônica de Contratos REST da API
Todas as rotas da API devem ser prefixadas com `/api/`. A rota raiz `GET /` é estritamente reservada à entrega da interface web (`public/index.html`).

| Método | Caminho | Request Body JSON | Response JSON | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | `N/A` | `{ status: "ok", uptime: number, database: "connected", timestamp: string }` | Healthcheck de integridade operacional do backend e SQLite |
| `GET` | `/api/audit-logs` | `Query: ?entity=&limit=` | `Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>` | Trilha de auditoria estruturada |
| `GET` | `/api/kpis` | `N/A` | `{ totalRuns: number, p95Latency: number, successRate: number, totalCostUsd: number }` | Métricas analíticas consolidadas para os cards de BI |
| `GET` | `/api/runs` | `Query: ?agentId=&status=&model=&q=&page=&limit=` | `Array<{ id: string, agent_id: string, model_used: string, total_tokens: number, latency_ms: number, cost_usd: number, status: string }>` | Listagem de execuções com paginação e busca debounce |
| `POST` | `/api/runs` | `{ agentId: string, promptInput: string, model?: string }` | `{ id: string, responseOutput: string, latencyMs: number, tokens: number } (Status 201)` | Disparo de nova inferência de agente com medição de latência |
| `GET` | `/api/agents` | `N/A` | `Array<{ id: string, name: string, model_name: string, temperature: number, is_active: number }>` | Listagem de agentes configurados |
| `POST` | `/api/export/csv` | `{ entity: "execution_runs" | "audit_logs" }` | `Content-Type: text/csv` | Exportação em lote de execuções e custos em formato CSV |

---

## 3. Fórmulas Matemáticas & Validações de Domínio
### Fórmulas de Domínio
- `p95_latency_ms = percentile_95(latencies)`
- `cost_usd = ((prompt_tokens * 0.005) + (completion_tokens * 0.015)) / 1000`
- `success_rate = (runs_sucesso / total_runs) * 100`
- `variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100`

### Regras de Validação HTTP 400 (Bad Request)
- **Validação:** name deve ter pelo menos 3 caracteres (HTTP 400)
- **Validação:** model_name deve ser um modelo suportado (HTTP 400)
- **Validação:** temperature deve estar entre 0.0 e 2.0 (HTTP 400)
- Payloads com campos nulos, strings vazias após `.trim()`, valores negativos para quantias financeiras ou `NaN` devem retornar status HTTP 400 com JSON estruturado:
  ```json
  {
    "error": "ValidationError",
    "message": "Descrição amigável e precisa do campo inválido"
  }
  ```

---

## 4. Integrações DOCSIMP & Dual-Mode Fallback
### Adaptadores de Domínio DOCSIMP Ativos
- **better-sqlite3 / DatabaseSync:** Banco de dados relacional embutido com WAL mode (`PRAGMA journal_mode = WAL;`) e timeouts defensivos (`PRAGMA busy_timeout = 10000;`).
- **express / node:http:** Roteamento determinístico REST com validação de payload síncrona e códigos de erro amigáveis.
- **lucide-icons:** Ícones vetoriais SVG inline estruturados para navegação semântica em abas.
- **Nicho & Domínio Ativo (DOCSIMP):** Adaptadores de **AI Automation, LLM Observability & Agents** (FINANCE_SAAS) provisionados autonomamente pelo MarketDiscoveryService na Onda 0.

### Chaves de Ambiente & Graceful Mock Fallback
O backend deve operar de modo 100% autônomo e offline através de Graceful Mock Fallback:
```bash
PORT=4000
DATABASE_PATH=./data/ai_agents.db
OPENAI_API_KEY=mock_key
```
- Se as chaves externas não forem configuradas no ambiente, o sistema não deve falhar nem lançar exceções; ele deve utilizar geradores determinísticos em memória garantindo resposta aos endpoints REST.

---

## CONTRATOS REAIS IMPLEMENTADOS EM DISCO (VERIFICADOS)
*Sincronização autônoma realizada pelo DecoHUB a partir do código-fonte em disco:*
- **Tabelas Físicas SQLite Identificadas:** `audit_logs`, `customers`, `message_queue`, `orders`, `system_settings`
- **Rotas REST Físicas Detectadas:**
  - Nenhuma rota REST identificada
- **Data/Hora da Última Verificação:** 2026-10-31T21:36:10.271Z
