# Lições Operacionais Aprendidas (Memória Autônoma)

> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Configuração Base, Variáveis de Ambiente e Catálogo de Produtos" (Tentativa 3/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Relatório do Worker inconsistente com o código real: arquivo declarado "data/database/storage_manifest.json" não existe no disco.; Arquivo fora do escopo permitido: data/database/storage_manifest.json
- **Estratégia que falhou (EVITAR):** Recomenda aprovação imediata para prosseguir com o backlog.
- **Estratégia que funcionou (APLICAR):** Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).
- **Teste de regressão:** `test/config.test.ts`
- **Ocorrências:** 4 | **Atualizado em:** 2026-10-31T19:58:41.789Z
