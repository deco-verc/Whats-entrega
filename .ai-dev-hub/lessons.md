# Lições Operacionais Aprendidas (Memória Autônoma)

> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Configuração Base, Variáveis de Ambiente e Catálogo de Produtos" (Tentativa 3/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Relatório do Worker inconsistente com o código real: arquivo declarado "data/database/storage_manifest.json" não existe no disco.; Arquivo fora do escopo permitido: data/database/storage_manifest.json
- **Estratégia que falhou (EVITAR):** Recomenda aprovação imediata para prosseguir com o backlog.
- **Estratégia que funcionou (APLICAR):** Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).
- **Teste de regressão:** `test/config.test.ts`
- **Ocorrências:** 4 | **Atualizado em:** 2026-10-31T19:58:41.789Z

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Motor WhatsApp Baileys, JID Resolver do 9º Dígito e Dispatcher com Simulação Humana e PTT" (Tentativa 2/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Arquivos fora do escopo permitido devido a arquivos extras (`src/whatsapp/index.ts`, `src/whatsapp/types.ts`) e base de comparação não alinhada ao commit de encerramento da dependência TK-2.
- **Estratégia que falhou (EVITAR):** Criar arquivos auxiliares fora de `expectedFiles` e comparar diff contra commit inicial sem histórico consolidado das tarefas predecessoras.
- **Estratégia que funcionou (APLICAR):** Consolidar tipos e interfaces estritamente em `src/whatsapp/socket.ts` e `src/whatsapp/dispatcher.ts` (exatamente os arquivos previstos em `expectedFiles`), remover arquivos fora de escopo e alinhar `main` em fast-forward ao término de TK-2.
- **Teste de regressão:** `test/whatsapp.test.ts`
- **Ocorrências:** 2 | **Atualizado em:** 2026-10-31T21:30:00.000Z
