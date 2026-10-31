# Guia de Conhecimento e Integração: Supabase

## 1. Visão Geral
O Supabase fornece PostgreSQL gerenciado, Autenticação de Usuários, Row Level Security (RLS) e Realtime APIs.
Este documento orienta os agentes (Workers) do DecoHUB a integrar o Supabase de forma robusta e plug-and-play.

## 2. Dependências Recomendadas
- Node.js / TypeScript: `@supabase/supabase-js`

```bash
npm install @supabase/supabase-js
```

## 3. Variáveis de Ambiente (`.env.example`)
```env
# Supabase Configuration
SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

## 4. Padrão de Autonomia e Graceful Mock Fallback (Plug-and-Play)
**REGRA MANDATÓRIA DE COMPATIBILIDADE**:
Se as chaves de API estiverem ausentes, forem placeholders (`your-supabase-url`, `dummy`, `test-key`), ou se a rede falhar:
1. O servidor **NUNCA DEVE TRAVAR** ou encerrar com `process.exit(1)` no boot.
2. Forneça uma camada de adapter / repositório com fallback em memória ou SQLite local para desenvolvimento e testes automatizados.
3. Emita um log amigável:
   `[SUPABASE] Supabase credentials not configured or dummy, running in local fallback mock mode.`
4. Forneça endpoints ou classes que verifiquem `isMockMode: boolean` e respondam a operações básicas (CRUD/Auth) de forma transparente para permitir a validação completa do Evaluator.

## 5. Implementação de Exemplo (Client com Fallback)
```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('placeholder') &&
    !supabaseUrl.includes('your-supabase-url') &&
    supabaseUrl.startsWith('http')
  );
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) {
    console.warn('[SUPABASE] Running in mock/local fallback mode.');
    return null;
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};
```
