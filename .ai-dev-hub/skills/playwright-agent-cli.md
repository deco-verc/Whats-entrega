---
name: playwright-agent-cli
description: Diretrizes de automação, inspeção de console e verificação visual em navegadores headless/headed para agentes de IA usando o Playwright Agent CLI (@playwright/cli).
---

# Playwright Agent CLI: Diretrizes para Agentes de IA

O `@playwright/cli` (`playwright-cli`) permite que agentes de programação realizem automação e inspeção de interface diretamente pelo terminal sem a sobrecarga de schemas MCP volumosos.

## Comandos Principais para Agentes

### 1. Inicializar Sessão
```bash
playwright-cli open http://localhost:3000
```
Abre uma sessão de navegador apontada para a URL alvo.

### 2. Snapshot de Acessibilidade (Tree Snapshot)
```bash
playwright-cli snapshot
```
Gera uma árvore de acessibilidade compacta e leve (YAML), associando identificadores únicos (ex: `e1`, `e2`, `e15`) a cada elemento interativo da página.

### 3. Interações por Referência
```bash
# Clicar em um botão ou link identificado
playwright-cli click e12

# Preencher campo de texto ou input
playwright-cli fill e5 "usuario@exemplo.com"
playwright-cli type "senhaSecreta123"

# Submeter formulário ou pressionar tecla
playwright-cli press Enter
```

### 4. Inspeção de Erros de Console (Zero Silent Failures)
```bash
playwright-cli console error
```
Lista erros emitidos no console do navegador (ex: exceções JavaScript não capturadas, 404 de recursos estáticos, erros de CORS). **Obrigatório verificar antes de concluir tarefas de UI.**

### 5. Captura de Evidência Visual (Screenshot)
```bash
playwright-cli screenshot
```
Captura a tela atual da aplicação para validação de layout, ausência de overflow e harmonia de componentes.

### 6. Encerrar Sessão
```bash
playwright-cli close
```
Fecha o navegador e libera recursos do sistema.

---

## Graceful Fallback Policy

Caso o servidor local não esteja em execução na porta alvo, ou o teste esteja rodando em ambiente offline/CI restrito (`isOfflineMode()`):
1. Tente verificar se a porta HTTP está aberta antes de abrir o navegador.
2. Se o processo falhar com `ECONNREFUSED` ou timeout de inicialização, registre a constatação e execute o fallback gracioso:
   - Validação estática de componentes (React/Vue/HTML/CSS) via testes unitários ou DOM virtual (`JSDOM` / Vitest / Node test runner).
   - O build ou o run **não deve travar** por indisponibilidade momentânea do servidor de dev quando a validação estática e unitária passar com 100%.
