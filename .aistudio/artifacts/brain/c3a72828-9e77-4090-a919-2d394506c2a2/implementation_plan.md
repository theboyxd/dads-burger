# Plano de Implementação: Portal Administrativo Desktop (`/admin`)

Criação de uma subpágina dedicada de administração (`/admin`) para estabelecimentos e operadores de caixa/cozinha, otimizada especificamente para computadores desktop, com autenticação por senha, layout de lista densa de alta produtividade, painel lateral de comanda e sistema de alarme sonoro contínuo.

---

## 1. Visão Geral da Arquitetura

- **Rota Dedicada**: `/admin` (disponibilizada tanto pelo Vite dev server quanto pelo backend `server.js`).
- **Autenticação**: Tela de login com senha/PIN de segurança (senha padrão do restaurante com armazenamento seguro de sessão).
- **Layout Desktop Baseline**: Otimizado para monitores de 1440px+, dividido em:
  1. **Barra Superior (Header Desktop)**: Identificação da unidade, relógio em tempo real, status do som do alarme, botão de teste sonoro, botão de simulação de pedido e botão de logout.
  2. **Coluna Principal (Lista Densa)**: Tabela/lista compacta com filtros rápidos por status (*Novos, Em Preparo, Entrega, Concluídos, Cancelados*) e filtro por unidade, tempo decorrido (*"há 2 min"*), dados do cliente e total.
  3. **Coluna Lateral Fixa (Painel de Comanda & Ações)**: Visualização em tempo real do pedido selecionado, lista de itens detalhada, dados de entrega/retirada, WhatsApp direto e botões de avanço de status e impressão térmica.
- **Sistema de Notificação Contínua**: Alarme sonoro em loop infinito (Web Audio API) ativado instantaneamente na chegada de qualquer pedido, com faixa de alerta destacada e botão para desligar o som.

---

## 2. Etapas de Desenvolvimento

### Fase 1: Backend e Roteamento `/admin`
- Configurar `vite.config.ts` e `server.js` para servir a subpágina `/admin` com suporte a fallback de rotas SPA.
- Criar a página `admin.html` ou roteamento limpo `/admin` com os estilos e scripts dedicados para desktop.
- Adicionar endpoint de autenticação de senha `/api/admin/auth` ou validação client-side com hash seguro no session storage.

### Fase 2: Tela de Bloqueio & Autenticação
- Modal/tela limpa de login administrativo para acesso restrito à equipe da hamburgueria.
- Suporte a "Lembrar nesta máquina" para que o caixa não precise digitar a senha a cada refresh.

### Fase 3: Layout Desktop de Alta Densidade + Painel de Comanda
- **Lista Densa**:
  - Linhas de 44px com seleção ativa.
  - Indicadores de status com contraste WCAG AA.
  - Destaque pulsante em pedidos novos não atendidos.
  - Busca instantânea por número do pedido, nome do cliente ou telefone.
- **Painel Lateral de Detalhes**:
  - Resumo de itens com multiplicadores e adicionais.
  - Endereço completo com botão de rota no Google Maps e link direto para conversa no WhatsApp.
  - Botões de ação rápida: *🔕 Desligar Alarme*, *👨‍🍳 Iniciar Preparo*, *🛵 Despachar*, *✅ Concluir*, *🖨️ Imprimir Comanda (80mm)*.

### Fase 4: Alarme Contínuo e Sincronização em Tempo Real
- Motor Web Audio API de sino de cozinha em loop contínuo (intervalo de 1,3s sem parar).
- Banner de alerta de alta visibilidade no topo do desktop: `"🚨 NOVO PEDIDO RECEBIDO! #DAD-XXXX [🔕 Desligar Alarme]"`.
- Sincronização em tempo real via `BroadcastChannel` e polling automático a cada 2,5 segundos.
- Botão *"➕ Simular Pedido (Teste)"* no cabeçalho administrativo para testes imediatos da equipe.

---

## 3. Verificação e Testes
- Compilação via `compile_applet` e validação com `lint_applet`.
- Teste de fluxo completo:
  1. Acessar `/admin` e validar bloqueio por senha.
  2. Abrir cardápio do cliente e finalizar um pedido (ou clicar em simular pedido).
  3. Verificar o alarme tocando continuamente no desktop até ser explicitamente desligado.
  4. Testar impressão da comanda e atualização dos status.
