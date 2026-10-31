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
