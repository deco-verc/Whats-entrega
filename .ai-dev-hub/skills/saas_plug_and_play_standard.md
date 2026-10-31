# Padrão Arquitetural SaaS: Plug-and-Play & Graceful Mock Fallback

## 1. Princípio de Arquitetura Autônoma
Aplicações geradas ou orquestradas pelo DecoHUB operam em ambientes diversos: desde o terminal de testes automatizados do Evaluator (onde chaves de API reais frequentemente não foram injetadas pelo usuário) até a infraestrutura de produção completa.

**O PRINCÍPIO ZERO**:
A ausência de chaves de API externas (ex: Stripe, PushinPay, Supabase, Cloudflare, Resend, Upstash) **NUNCA DEVE DERRUBAR O PROCESSO OU IMPEDIR O BOOT DO SERVIDOR**.

## 2. Inicialização Tolerante (`config/env.ts`)
1. Nunca execute `process.exit(1)` ao validar chaves externas de terceiros.
2. Apenas dependências estritamente locais e estruturais (ex: porta do servidor `PORT` ou integridade do filesystem básico) podem ser consideradas críticas.
3. Se chaves externas estiverem ausentes, defina um modo mock/desenvolvimento (`MOCK_MODE=true` ou fallback transparente no adapter).
4. O servidor deve subir e responder `HTTP 200` em endpoints de health check.

## 3. Arquivo `.env.example` Mandatório
Toda aplicação DEVE conter um arquivo `.env.example` na raiz com:
- Todas as variáveis aceitas pelo projeto.
- Comentários claros indicando a utilidade de cada chave e links para a documentação oficial.
- Valores default ou placeholders seguros.

## 4. Endpoint de Diagnóstico de Integrações (`/api/system/integrations`)
O backend deve expor um endpoint (ex: `GET /api/system/integrations` ou `GET /health/integrations`) retornando o estado operacional de cada serviço:

```json
{
  "status": "ok",
  "integrations": {
    "supabase": { "status": "mock_fallback", "message": "Using in-memory repository fallback" },
    "pushinpay": { "status": "ready", "account": "connected" },
    "upstash": { "status": "mock_fallback", "message": "Using in-memory TTL cache" },
    "cloudflare": { "status": "mock_fallback", "message": "Turnstile test bypass active" }
  }
}
```
Estados válidos:
- `ready`: Chaves válidas configuradas e ativas.
- `mock_fallback`: Chaves ausentes, operando em modo simulação segura sem falhar.
- `unconfigured`: Não utilizado ou desativado.

## 5. Diretriz para o Worker e Evaluator
- O Worker deve sempre criar testes unitários e de integração que funcionem independentemente de conexão à internet externa ou credenciais reais.
- O Evaluator deve verificar se o servidor inicia com sucesso e responde rotas essenciais mesmo sem `.env` preenchido.
