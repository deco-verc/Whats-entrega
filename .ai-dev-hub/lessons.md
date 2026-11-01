# Lições Operacionais Aprendidas (Memória Autônoma)

> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Motor WhatsApp Baileys, JID Resolver do 9º Dígito e Dispatcher com Simulação Humana e PTT" (Tentativa 1/4)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Arquivo fora do escopo permitido: src/config/catalog.ts; Arquivo fora do escopo permitido: src/config/env.ts; Arquivo fora do escopo permitido: src/database/connection.ts; Arquivo fora do escopo permitido: src/database/repositories.ts; Arquivo fora do escopo permitido: src/database/schema.sql
- **Estratégia que falhou (EVITAR):** Recomenda aprovação imediata para prosseguir com o backlog.
- **Estratégia que funcionou (APLICAR):** Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).
- **Teste de regressão:** `test/config.test.ts, test/database.test.ts, test/whatsapp.test.ts`
- **Ocorrências:** 5 | **Atualizado em:** 2026-10-31T23:54:02.273Z

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Configuração Base, Variáveis de Ambiente e Catálogo de Produtos" (Tentativa 3/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Relatório do Worker inconsistente com o código real: arquivo declarado "data/database/storage_manifest.json" não existe no disco.; Arquivo fora do escopo permitido: data/database/storage_manifest.json
- **Estratégia que falhou (EVITAR):** Recomenda aprovação imediata para prosseguir com o backlog.
- **Estratégia que funcionou (APLICAR):** Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).
- **Teste de regressão:** `test/config.test.ts`
- **Ocorrências:** 4 | **Atualizado em:** 2026-10-31T19:58:41.789Z

### [EM ABERTO] [BUILD_AND_TEST/PERSISTENT_CODE_DEFECT] Revisão reprovada em "Módulo de Disparo Rápido Manual (UI + Endpoint direto de Envio)" (Tentativa 1/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Relatório do Worker inconsistente com o código real: arquivo declarado "src/routes/manual-send.ts" não existe no disco.; Relatório do Worker inconsistente com o código real: arquivo declarado "public/manual-send.html" não existe no disco.
- **Estratégia que falhou (EVITAR):** Resultado recuperado e comprovado no disco pelo Evaluator
- **Ocorrências:** 1 | **Atualizado em:** 2026-11-01T20:21:48.909Z
