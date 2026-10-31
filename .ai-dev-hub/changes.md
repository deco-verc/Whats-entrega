# Histórico de Arquivos Criados/Alterados — WhatsappEntrega
*Atualizado em: 2026-10-31T19:57:00.000Z | Arquivos rastreados: 6*

- `package.json`: Configuração do projeto ESM com dependências (@whiskeysockets/baileys, better-sqlite3, express, pino, dotenv) e scripts de build/teste
- `tsconfig.json`: Configuração TypeScript strict mode (ES2022 / NodeNext)
- `.env.example`: Template de variáveis de ambiente com PORT, CAKTO_WEBHOOK_SECRET, WHATSAPP_PAIRING_PHONE e diretórios de dados
- `src/config/env.ts`: Carregamento e validação fail-fast de variáveis de ambiente, PORT_GUARD (faixa 4000-4999), persistência SQLite WAL e diretórios locais
- `src/config/catalog.ts`: Catálogo de produtos (MAIN, UPSELL_1, UPSELL_2, DOWNSELL) com ofertas, mídias de entrega, spintax e links de checkout
- `test/config.test.ts`: Suíte de testes unitários automatizados validando contratos de configuração, fail-fast e catálogo