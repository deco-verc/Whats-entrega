# Project Program: WhatsappEntrega

## Objective
Desenvolver e gerenciar WhatsappEntrega

## Product Principles
- **Think Before Coding & Full Autonomy**: Explicitar premissas e opções tecnicamente; em execuções autônomas do DecoHUB, nunca invocar `ask_question` nem bloquear o pipeline — resolver ambiguidades via contratos locais e `DESIGN.md`.
- **Simplicity First & Product Density**: Menor código correto e direto, sem classes ou abstrações especulativas para uso único, mas garantindo densidade funcional completa (estados Loading, Empty, Populated, Error e `seedIfEmpty()` realista).
- **Surgical Changes**: Toda linha modificada deve ser diretamente rastreável à tarefa solicitada; sem alterações cosméticas ortogonais ou regressão em módulos prontos.
- **Goal-Driven Execution**: Toda tarefa possui objetivo declarado, critérios de aceitação binários e comando de verificação simples compatível com `controlledVerification.ts`.

## Technical & Full-Stack Constraints
- **Port Guard**: Utilizar exclusivamente portas na faixa `4000-4999` (`Number(process.env.PORT) || 4000`). As portas `3001`, `3000` e `5173` são estritamente reservadas ao DecoHUB.
- **Full-Stack Routing**: Em projetos com interface web (`public/index.html`), servir a SPA em `GET /` e manter o healthcheck JSON isolado em `GET /api/health`.
- **Dual-Mode DOCSIMP & Cloud Pack**: Ler chaves de `process.env` com *Graceful Mock Fallback* automático quando ausentes, popular dados iniciais via `seedIfEmpty()` e manter `Dockerfile` (Node 22 Alpine) atualizado.
- **Anti-Slop UI & Section Navigation**: Definir variáveis CSS em `:root`, `font-variant-numeric: tabular-nums`, usar ícones SVG Lucide inline (zero emojis decorativos) e marcar abas/secções com `role="tab"` e `data-tab="<secao>"`.
- **AppSec Red Team Invariants**: Queries SQLite parametrizadas (`?`), sanitização DOM (`escapeHtml` / `textContent`), validação de caminho estático contra Path Traversal (`path.resolve` + `.startsWith(publicDir)`), cabeçalho `X-Content-Type-Options: nosniff` e rejeição de valores negativos/NaN com `HTTP 400`.

## Allowed Actions
- Ler e analisar qualquer arquivo dentro do diretório do projeto.
- Criar e editar arquivos estritamente pertencentes ao escopo da tarefa em andamento.
- Executar comandos locais de compilação, teste e verificação de integridade via terminal, encerrando processos efêmeros em blocos `try / finally`.

## Human Approval Required
- Exclusão ou drop de bancos de dados ou arquivos de dados persistentes em produção.
- Alterações em segredos reais, credenciais externas críticas ou variáveis sensíveis fora do escopo local.
- Mudanças destrutivas de arquitetura que removam funcionalidades existentes.

## Verification
- Testes automatizados executáveis no terminal (`npm test`, `node --test`, `npm run build`, `tsc --noEmit`).
- Aprovação nos 4 Portões de Qualidade: Dev Tests, PlaywrightVisualInspector, UserExperienceSimulator (persistência pós-F5) e SecurityPentestSimulator.
- **Critério de término (DONE WHEN)**: 100% dos critérios de aceitação atendidos e comando de verificação com saída 0.

## Quality Standards
- Código tipado, limpo, modular e sem dead code ou placeholders (`TODO`, mocks estáticos falsos).
- Comunicação direta em estilo CLI corporativo (zero emojis decorativos e zero repetição da instrução do usuário).
- Manter o histórico de memória e checkpoints do AI DEV HUB sincronizados.

## Autonomous Behavior
- O agente tem autonomia total para iterar e corrigir erros apontados pelo Independent Evaluator até que todos os portões passem.
- Se uma abordagem causar quebra irrecuperável, reverter as alterações (rollback cirúrgico) antes de tentar nova abordagem.

## Forbidden Changes
- Proibido refatorar arquivos funcionais adjacentes que não façam parte do objetivo da tarefa.
- Proibido alterar, comentar, pular (`.skip`) ou enfraquecer arquivos de testes protegidos (`TAMPERING_DETECTED`).
- Proibido usar comandos compostos (`&&`, `;`, `||`, `|`, `node -e`) no campo `verificationCommand`.
