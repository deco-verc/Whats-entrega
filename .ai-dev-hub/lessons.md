# Lições Operacionais Aprendidas (Memória Autônoma)

> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Configuração Base, Variáveis de Ambiente e Catálogo de Produtos" (Tentativa 3/3)
- **Causa-raiz confirmada:** Revisão reprovada por evidência insuficiente: NEEDS_EVIDENCE: O Review independente reprovou a aprovação (REJECTED): Reprovado no Review independente: Relatório do Worker inconsistente com o código real: arquivo declarado "data/database/storage_manifest.json" não existe no disco.; Arquivo fora do escopo permitido: data/database/storage_manifest.json
- **Estratégia que falhou (EVITAR):** Recomenda aprovação imediata para prosseguir com o backlog.
- **Estratégia que funcionou (APLICAR):** Aprovado após verificação objetiva do IndependentEvaluator (testes e arquivos comprovados no disco).
- **Teste de regressão:** `test/config.test.ts`
- **Ocorrências:** 4 | **Atualizado em:** 2026-10-31T19:58:41.789Z

### [RESOLVIDO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Motor WhatsApp Baileys, JID Resolver do 9º Dígito e Dispatcher com Simulação Humana e PTT" (Tentativa 4/4)
- **Causa-raiz confirmada:** As branches base de comparação (`main` e `ai/autonomous-build-2026-10-31-881d30`) mantinham a referência no commit raiz `d205c56`, fazendo com que os arquivos de TK-1 e TK-2 fossem detectados no diff total contra a base de comparação do Review.
- **Estratégia que falhou (EVITAR):** Não sincronizar a branch de build do run com o commit de conclusão das dependências TK-1 e TK-2.
- **Estratégia que funcionou (APLICAR):** Alinhar as branches de referência (`main` e `ai/autonomous-build-...`) ao commit de conclusão de TK-2 (`4b64615`), isolando estritamente as alterações de TK-3 nos arquivos `src/whatsapp/socket.ts` e `src/whatsapp/dispatcher.ts`.
- **Teste de regressão:** `test/whatsapp.test.ts`
- **Ocorrências:** 4 | **Atualizado em:** 2026-10-31T21:48:00.000Z
