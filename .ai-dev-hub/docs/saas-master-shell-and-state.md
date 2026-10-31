# Blueprint de Engenharia Reversa: Enterprise App Shell & Reactive Client State

> Extraído via engenharia reversa estática e comportamental (REA) de interfaces líderes de mercado (Linear, Stripe Dashboard, Notion, Cal.com).

## 1. Arquitetura do App Shell Enterprise
O shell da aplicação não é um layout estático simples de cabeçalho e rodapé. Ele é composto por subsistemas coordenados:

### A. Sidebar Colapsável & Navegação Hierárquica
- **Navegação Modular**: Lista de seções estruturadas (ex: Dashboard, Clientes/Contatos, Transações/Operações, Relatórios & BI, Auditoria de Atividades, Configurações).
- **Contadores Vivos (Badges)**: Itens de navegação contêm contadores reativos atualizados pela Store (ex: "Transações Pendentes: 4", "Auditoria: 12").
- **Colapso Suave com Teclado e Botão**: Suporte a atalho (ex: `[` ou `Ctrl+B`) para recolher a barra lateral para modo mini/ícones, liberando espaço visual para visualizações densas de dados.

### B. Topbar de Comando e Status Global
- **Barra de Busca / Gatilho Command Palette**: Input ou botão central estilizado exibindo `Buscar ou executar ação... (Ctrl+K)`.
- **Filtro de Contexto / Período Rápido**: Dropdown ou pill selector de período (Hoje, Últimos 7 dias, Este Mês, Todo o Histórico).
- **Indicador de Sistema**: Ponto verde/âmbar de conexão com API em tempo real (`Online • Sync`), status de persistência e atalhos rápidos.

### C. Command Palette (`Ctrl+K` / `Cmd+K`)
- **Modal Flutuante de Alta Velocidade**: Abre instantaneamente ao pressionar `Ctrl+K` (ou `Cmd+K`), ou ao clicar na busca da Topbar.
- **Busca Preditiva por Teclado**: Filtra em tempo real navegação entre telas, ações imediatas (ex: "Novo Registro", "Exportar CSV", "Limpar Filtros", "Ver Auditoria") e pesquisa de entidades.
- **Navegação com Setas e Enter**: Setas `Cima`/`Baixo` selecionam itens com destaque visual e `Enter` aciona o comando ou fecha a paleta com `Escape`.

### D. Slide-Over Detail Drawers (Painéis Laterais Deslizantes)
- **Zero Navegação Cega**: Clicar em qualquer registro de uma tabela ou card não deve trocar de página para uma tela vazia.
- **Painel Lateral Fluido**: Um drawer abre da direita com animação suave de slide (`transform: translateX(0)`), overlay semi-transparente de fundo e foco automático.
- **Conteúdo Estruturado**:
  - Cabeçalho com título da entidade, status em badge colorido e botão de fechar (`Esc`).
  - Abas internas rápidas (Geral, Histórico/Timeline, Metadados JSON brutos).
  - Ações inline imediatas (Editar campo, Mudar status, Reenviar evento, Excluir).

### E. Optimistic UI & Atalhos de Teclado
- **Feedback Imediato**: Alterações de status e edições inline refletem instantaneamente no DOM local enquanto a requisição assíncrona é enviada ao servidor.
- **Rollback Transparente**: Se a requisição falhar com erro 4xx/500, a Store restaura o estado anterior e exibe um toast de alerta sem travar a interface.

---

## 2. Padrão Canônico: Reactive Client Store (Vanilla JS Sem Frameworks Pesados)
Código frontend corporativo (`public/app.js`) deve seguir arquitetura previsível orientada a fluxo unidirecional:

```javascript
// Exemplo canônico de Reactive Store corporativa no public/app.js
const Store = {
  state: {
    currentView: 'dashboard',
    selectedId: null,
    drawerOpen: false,
    commandPaletteOpen: false,
    filters: { query: '', status: 'all', dateRange: '30d' },
    items: [],
    metrics: {},
    auditLogs: [],
    loading: false
  },
  subscribers: [],
  subscribe(fn) {
    this.subscribers.push(fn);
    return () => { this.subscribers = this.subscribers.filter(s => s !== fn); };
  },
  dispatch(action, payload) {
    switch (action) {
      case 'NAVIGATE':
        this.state.currentView = payload;
        break;
      case 'OPEN_DRAWER':
        this.state.selectedId = payload;
        this.state.drawerOpen = true;
        break;
      case 'CLOSE_DRAWER':
        this.state.drawerOpen = false;
        this.state.selectedId = null;
        break;
      case 'SET_ITEMS':
        this.state.items = payload;
        break;
      case 'SET_METRICS':
        this.state.metrics = payload;
        break;
      case 'SET_AUDIT_LOGS':
        this.state.auditLogs = payload;
        break;
      case 'UPDATE_FILTERS':
        this.state.filters = { ...this.state.filters, ...payload };
        break;
    }
    this.notify();
  },
  notify() {
    this.subscribers.forEach(fn => fn(this.state));
  }
};
```
