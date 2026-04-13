/**
 * Default locale. Every user-visible string lives here; the English resource
 * mirrors this shape key-for-key. When adding a key, add it here first, then
 * translate in `./en.ts` — the shared type `Translations` enforces parity.
 */
export const ptBR = {
  app: {
    title: "DCA Bot",
    subtitle: "Acumulação automatizada de Bitcoin na Bybit",
    publicView: "Visualização pública",
    signIn: "Entrar",
    logout: "Sair",
  },
  errors: {
    failedToLoad: "Falha ao carregar dados",
    somethingWentWrong: "Algo deu errado",
    unexpectedError: "O painel encontrou um erro inesperado",
    reload: "Recarregar painel",
    unknownError: "Erro desconhecido",
  },
  login: {
    subtitle: "Entre para acessar o painel",
    username: "Usuário",
    password: "Senha",
    usernamePlaceholder: "admin",
    signIn: "Entrar",
    signingIn: "Entrando...",
    publicAvailable: "Painel público disponível sem login",
    failed: "Falha no login",
  },
  status: {
    botStatus: "Status do Bot",
    running: "Operacional",
    degraded: "Degradado",
    uptime: "tempo ativo",
    nextScheduledBuy: "Próxima compra agendada",
    /** "~R$250 de BTCBRL" */
    ofPair: "~{{amount}} de {{pair}}",
    postgres: "PostgreSQL",
    redis: "Redis",
    serviceStatus: {
      connected: "conectado",
      unknown: "desconhecido",
      disconnected: "desconectado",
    },
  },
  spending: {
    monthlySpending: "Gasto mensal",
    used: "{{pct}}% usado",
    remaining: "{{amount}} restante",
    totalSpent: "Total gasto",
    totalBtc: "Total em BTC",
    avgPrice: "Preço médio",
  },
  orders: {
    purchaseHistory: "Histórico de compras",
    count_one: "{{count}} ordem",
    count_other: "{{count}} ordens",
    testBadge: "teste",
    pageOf: "Página {{page}} de {{total}}",
    prev: "Anterior",
    next: "Próxima",
    columns: {
      date: "Data",
      pair: "Par",
      type: "Tipo",
      price: "Preço",
      btcAmount: "Quantidade BTC",
      spent: "Gasto",
      fee: "Taxa",
      status: "Status",
    },
    empty: {
      title: "Aguardando o primeiro preenchimento",
    },
  },
  orderStatus: {
    filled: "preenchida",
    failed: "falhou",
    skipped_cap: "limite atingido",
    cancelled: "cancelada",
    pending: "pendente",
  },
  orderType: {
    limit: "limite",
    market: "mercado",
  },
  chart: {
    btcAccumulation: "Acumulação de BTC",
    waitingFirstFill: "aguardando primeira compra",
    stackStartsHere: "Seu estoque começa aqui",
    firstBuy: "Primeira compra {{when}}",
    /** "R$ 1.234,56 investido" */
    invested: "{{amount}} investido",
  },
  monthly: {
    monthlyOverview: "Visão mensal",
    costBasisSubtitle: "custo médio ponderado por volume",
    avgPriceVsSpend: "Preço médio vs gasto",
    lowerLineHint: "· linha mais baixa = entrada mais barata",
    noFilledYet:
      "Nenhuma compra ainda — a análise mensal aparece após sua primeira compra",
    keepStacking:
      "Continue acumulando — a comparação mês a mês aparece no próximo mês.",
    baseline: "base",
    flat: "estável",
    avgEntry: "Entrada média",
    range: "Faixa",
    buys: "Compras",
    invested: "investido",
    spentLegend: "Gasto (R$)",
    avgPriceLegend: "Preço médio (R$)",
    avgSuffix: "média",
    spentSuffix: "gasto",
    cheaperEntry: "Entrada média mais barata que o mês anterior",
    moreExpensiveEntry: "Entrada média mais cara que o mês anterior",
    window: {
      sixMonths: "6M",
      twelveMonths: "12M",
      all: "Tudo",
    },
  },
  test: {
    testOrder: "Ordem de Teste",
    operatorOnly: "apenas operador",
    description:
      "Executa uma pequena ordem de mercado real para verificar credenciais da Bybit, cálculo de preço e fluxo de ordens. Excluído do limite mensal e dos totais do painel.",
    generatePreview: "Gerar preview",
    fetchingTicker: "Buscando ticker…",
    tickerNow: "Ticker Agora",
    testAmount: "Valor de Teste",
    estBtc: "BTC Estimado",
    executionBlocked: "Execução bloqueada",
    refreshPreview: "Atualizar preview",
    executeReal: "Executar ordem de teste real",
    filled: "Ordem de teste preenchida",
    otherStatus: "Ordem de teste {{status}}",
    filledPrice: "Preço da compra",
    btc: "BTC",
    spent: "Gasto",
    fee: "Taxa",
    slippageLabel: "Slippage vs preview",
    errorFromBybit: "Erro da Bybit",
    executionFailed: "Falha na execução",
    confirmTitle: "Confirmar ordem de teste real",
    confirmBody:
      "Isto executará uma compra de mercado real na Bybit por {{amount}} de {{pair}}. A operação terá taxas e o BTC permanecerá na sua carteira spot da Bybit.",
    typePairToConfirm: "Digite {{pair}} para confirmar",
    cancel: "Cancelar",
    placeOrder: "Executar ordem real",
    placing: "Executando…",
  },
  locale: {
    switchTo: {
      "pt-BR": "Português",
      en: "English",
    },
  },
};

export type Translations = typeof ptBR;
