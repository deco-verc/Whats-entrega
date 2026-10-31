---
name: saas-master-backend-and-workflows
description: "Skill saas-master-backend-and-workflows para desenvolvimento autônomo e assistido no DecoHUB."
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
