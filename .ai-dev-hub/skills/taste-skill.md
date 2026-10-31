---
name: taste-skill
description: Anti-slop frontend and visual design skill for coding agents. Establishes art direction, typographic hierarchy, and the three core dials (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY).
---

# Taste Skill: Anti-Slop Frontend & Visual Engineering

O **Taste Skill** estabelece diretrizes rigorosas de design para agentes de inteligência artificial, erradicando o "AI-Slop" (designs genéricos, cartões repetitivos com ícones vazios, gradientes roxos sem propósito e falta de personalidade tipográfica).

---

## 1. Os Três Dials de Configuração Visual (The Three Dials)

Toda decisão de layout, densidade e transição é calibrada por três eixos numéricos de 1 a 10:

* **`DESIGN_VARIANCE` (1 a 10):**
  - `1-2`: Simetria absoluta, grid estrito e previsível.
  - `5-6`: Equilíbrio contemporâneo (estilo Linear / SaaS minimalista).
  - `8-10`: Caos criativo controlado, assimetria editorial, sobreposições e quebra de grid.
* **`MOTION_INTENSITY` (1 a 10):**
  - `1-2`: Estático ou transições instantâneas / acessíveis.
  - `3-4`: Microinterações discretas em hover e foco (GPU: `transform`, `opacity`).
  - `7-10`: Animações cinemáticas, physics-based springs e scroll-driven effects.
* **`VISUAL_DENSITY` (1 a 10):**
  - `1-3`: Galeria de arte, respiro amplo, espaços em branco generosos.
  - `4-6`: Dashboard moderno balanceado e legível.
  - `8-10`: Cockpit técnico, densidade de telemetria e tabelas de alta produtividade.

### Calibração de Dials por Arquétipo e Briefing

| Perfil / Sinal do Briefing | VARIANCE | MOTION | DENSITY | Referência Típica |
|---|---|---|---|---|
| **Minimalist / Clean SaaS** | 5 | 3 | 3 | Linear, Resend |
| **Fintech / Payment Infrastructure** | 6 | 4 | 5 | Stripe, Revolut, Wise |
| **Developer Tools / Cloud Infrastructure** | 5 | 3 | 6 | Vercel, Supabase |
| **Document / Workspace Productivity** | 4 | 2 | 4 | Notion |
| **Dark Telemetry / High Density** | 5 | 3 | 8 | Raycast, PostHog |
| **Industrial / Brutalist** | 9 | 2 | 7 | Swiss Typography / Raw Grid |
| **Luxury Consumer / Brand Showcase** | 8 | 7 | 3 | Apple, Editorial |

---

## 2. Disciplina Anti-Slop (Zero AI-Default)

1. **Proibido o Gradiente Clichê de IA:** Nunca use gradientes roxos/violetas/azuis em malhas escuras como plano de fundo padrão sem intenção conceitual.
2. **Proibido o "Trio de Features Idênticas":** Não estruture a página com 3 cartões retangulares iguais lado a lado com um ícone no topo e texto centralizado genérico.
3. **Hierarquia Tipográfica Clara:** O título principal deve ser proeminente (peso, contraste, tracking negativo calibrado), com subtextos e números em `tabular-nums`.
4. **Bordas Sutis (Hairlines):** Use bordas de 1px com transparências bem calibradas (`rgba(255, 255, 255, 0.08)` em modo escuro ou `rgba(0, 0, 0, 0.06)` em modo claro).
5. **Transições Aceleradas por Hardware:** Animações devem ser restritas exclusivamente a `transform` e `opacity`. Nunca anime `width`, `height`, `margin` ou `top`.
6. **Respeito ao Usuário (`prefers-reduced-motion`):** Desative animações não essenciais quando a preferência de movimento reduzido estiver ativa no sistema.

---

## 3. Sub-habilidades Integradas

- **`design-taste-frontend`**: Direção de arte para landing pages, sites institucionais e interfaces públicas.
- **`redesign-skill`**: Auditoria prévia de espaçamentos, hierarquia e tipografia antes de refatorar código legado.
- **`minimalist-skill`**: Interface com paleta restrita, grid ordenado e foco no conteúdo.
- **`brutalist-skill`**: Tipografia suíça marcante, alto contraste e estrutura mecânica aparente.
- **`soft-skill`**: Contraste suave, curvas polidas e paletas com transição acolhedora.
