export type ProductType = "MAIN" | "UPSELL_1" | "UPSELL_2" | "DOWNSELL";

export type MediaType = "text" | "document" | "audio_ptt" | "image";

export interface MediaItem {
  readonly type: MediaType;
  readonly fileName: string;
  readonly caption?: string;
  readonly mimeType?: string;
}

export interface OfferConfig {
  readonly offerId: string;
  readonly name: string;
  readonly priceCents: number;
  readonly checkoutUrl: string;
}

export interface PixRecoveryConfig {
  readonly delaySeconds: number;
  readonly messagesSpintax: readonly string[];
}

export interface DeliveryConfig {
  readonly mediaFiles: readonly MediaItem[];
  readonly messagesSpintax: readonly string[];
  readonly microCommitmentQuestion?: string;
}

export interface PitchConfig {
  readonly audioFileName?: string;
  readonly messagesSpintax: readonly string[];
  readonly checkoutUrl: string;
}

export interface NextStepConfig {
  readonly targetType: ProductType;
  readonly delaySeconds: number;
  readonly accelerateOnReply: boolean;
}

export interface CatalogItem {
  readonly productId: string;
  readonly type: ProductType;
  readonly name: string;
  readonly description: string;
  readonly defaultOfferId: string;
  readonly offers: Record<string, OfferConfig>;
  readonly delivery: DeliveryConfig;
  readonly pitch?: PitchConfig;
  readonly nextSteps: readonly NextStepConfig[];
  readonly downsellStep?: NextStepConfig;
  readonly pixRecovery?: PixRecoveryConfig;
}

export const CATALOG: Record<ProductType, CatalogItem> = {
  MAIN: {
    productId: "prod_main_01",
    type: "MAIN",
    name: "Metodo Direct Response Pro",
    description: "Treinamento e material principal de alta conversao",
    defaultOfferId: "off_main_full",
    offers: {
      off_main_full: {
        offerId: "off_main_full",
        name: "Acesso Completo Metodo Pro",
        priceCents: 9700,
        checkoutUrl: "https://checkout.cakto.com.br/main-pro",
      },
      off_main_promo: {
        offerId: "off_main_promo",
        name: "Acesso Promocional Metodo Pro",
        priceCents: 6700,
        checkoutUrl: "https://checkout.cakto.com.br/main-promo",
      },
    },
    pixRecovery: {
      delaySeconds: 420, // 7 minutos padrao configuravel (disparo planejado +3 min no fluxo de recuperacao)
      messagesSpintax: [
        "{Oi|Ola|Opa}, *{primeiro_nome}*! Tudo {bem|certo|otimo} por ai?\n\nVi aqui no sistema que voce acabou de gerar o seu acesso para o *{produto}*, mas o pagamento via PIX ainda consta como pendente.\n\n{As vezes o banco da uma travadinha|Sei que na correria acaba passando|Como as vagas com esse bonus sao limitadas}, ja separei o seu acesso aqui para {liberar imediatamente|te enviar agora mesmo} assim que compensar!\n\nPara facilitar, {vou deixar|esta logo abaixo} o seu codigo *PIX Copia e Cola* na proxima mensagem. E so copiar, colar no app do banco e me mandar um *\"PRONTO\"* aqui que eu ja libero seu material na hora!",
        "{pix_copia_cola}",
      ],
    },
    delivery: {
      mediaFiles: [
        {
          type: "document",
          fileName: "guia_definitivo_alta_conversao.pdf",
          caption: "Seu Guia Definitivo de Alta Conversao",
          mimeType: "application/pdf",
        },
      ],
      messagesSpintax: [
        "{Parabens|Show de bola|Seja muito bem-vindo(a)}, *{primeiro_nome}*! Seu pagamento foi confirmado com sucesso!\n\nAqui esta o seu acesso oficial ao *{produto}*:\n*Link de Acesso:* {link_acesso}\n\n{Salve esse contato na sua agenda|Favorita essa mensagem} para nao perder o link.",
      ],
      microCommitmentQuestion:
        "{Conseguiu abrir o material direitinho?|Tudo certo com o material?} Me responde SIM aqui so para eu confirmar!",
    },
    nextSteps: [
      {
        targetType: "UPSELL_1",
        delaySeconds: 900, // 15 minutos (antecipado se responder ao micro-comprometimento)
        accelerateOnReply: true,
      },
    ],
  },

  UPSELL_1: {
    productId: "prod_upsell_01",
    type: "UPSELL_1",
    name: "Acelerador de Funis + Pacote de Templates Prontos",
    description: "Conjunto exclusivo de copys validadas e fluxos prontos",
    defaultOfferId: "off_upsell_1_standard",
    offers: {
      off_upsell_1_standard: {
        offerId: "off_upsell_1_standard",
        name: "Pacote Acelerador Completo",
        priceCents: 6700,
        checkoutUrl: "https://checkout.cakto.com.br/upsell-1-pack",
      },
    },
    pitch: {
      audioFileName: "pitch_upsell_1.ogg",
      messagesSpintax: [
        "*{primeiro_nome}*, {que massa|perfeito|excelente}! Olha so, como voce acabou de entrar, o sistema liberou uma condicao {unica|exclusiva de novo aluno} no seu cadastro.\n\nQuem entra no *{produto}* geralmente leva de 2 a 3 semanas configurando tudo manualmente. Mas eu criei o *{nome_upsell_1}*, onde eu te entrego *tudo 100% pronto para copiar, colar e rodar ainda hoje*.\n\n*O que voce destrava agora:*\n- Pack completo pronto para uso imediato\n- {Acompanhamento passo a passo|Modelos validados de alta conversao}\n- Bonus de implementacao rapida\n\nDe R$ 197 por *apenas R$ 67* (somente aqui dentro do WhatsApp por voce ja ser aluno).\n\nQuer aproveitar essa condicao especial? Toca no link abaixo para liberar junto com seu acesso principal:\n{link_upsell_1}\n\n_(Se tiver qualquer duvida, me manda um \"EU QUERO\" aqui que eu te explico em 30 segundos!)_",
      ],
      checkoutUrl: "https://checkout.cakto.com.br/upsell-1-pack",
    },
    delivery: {
      mediaFiles: [
        {
          type: "document",
          fileName: "pack_templates_acelerador.pdf",
          caption: "Acelerador + Templates Prontos de Copys",
          mimeType: "application/pdf",
        },
      ],
      messagesSpintax: [
        "{Perfeito|Show|Sensacional}, *{primeiro_nome}*! Seu upgrade para o Acelerador foi ativado com sucesso.\n\nSegue acima o material completo do Pacote de Templates.",
      ],
      microCommitmentQuestion:
        "Material do Acelerador entregue! Conseguiu baixar o arquivo?",
    },
    nextSteps: [
      {
        targetType: "UPSELL_2",
        delaySeconds: 900, // 15 minutos apos entrega do UPSELL_1
        accelerateOnReply: false,
      },
    ],
    downsellStep: {
      targetType: "DOWNSELL",
      delaySeconds: 7200, // 2 horas de tolerancia caso nao compre o UPSELL_1
      accelerateOnReply: false,
    },
  },

  UPSELL_2: {
    productId: "prod_upsell_02",
    type: "UPSELL_2",
    name: "Masterclass de Escala e Otimizacao Avancada",
    description: "Sessao gravada aprofundada com estrategias de alto faturamento",
    defaultOfferId: "off_upsell_2_masterclass",
    offers: {
      off_upsell_2_masterclass: {
        offerId: "off_upsell_2_masterclass",
        name: "Acesso Vitalicio a Masterclass",
        priceCents: 19700,
        checkoutUrl: "https://checkout.cakto.com.br/upsell-2-masterclass",
      },
    },
    pitch: {
      audioFileName: "pitch_upsell_2.ogg",
      messagesSpintax: [
        "*{primeiro_nome}*, acabei de liberar o seu *{nome_upsell_1}* tambem! Voce tomou a {melhor decisao|decisao mais inteligente} para acelerar seus resultados.\n\nComo vi que voce {joga o jogo serio|nao esta para brincadeira e quer velocidade maxima}, quero te fazer um ultimo convite restrito aos alunos avancados:\n\nAcabamos de abrir 5 vagas para o *{nome_upsell_2}* — onde nos entregamos a estrategia avancada de escala + suporte prioritario.\n\n*Exclusivo para quem ja garantiu o Acelerador:*\nAcesse com desconto de aluno VIP aqui: {link_upsell_2}\n\nDa uma olhada sem compromisso. Se fizer sentido para o seu momento atual, te vejo la dentro!",
      ],
      checkoutUrl: "https://checkout.cakto.com.br/upsell-2-masterclass",
    },
    delivery: {
      mediaFiles: [
        {
          type: "document",
          fileName: "masterclass_escala_acesso.pdf",
          caption: "Instrucoes e Acesso a Masterclass de Escala",
          mimeType: "application/pdf",
        },
      ],
      messagesSpintax: [
        "Acesso liberado a Masterclass de Escala! Bons estudos e boas vendas, *{primeiro_nome}*.",
      ],
    },
    nextSteps: [],
  },

  DOWNSELL: {
    productId: "prod_downsell_01",
    type: "DOWNSELL",
    name: "Versao Essencial do Pacote de Templates (Desconto Exclusivo)",
    description: "Versao enxuta dos templates por valor acessivel de entrada",
    defaultOfferId: "off_downsell_essential",
    offers: {
      off_downsell_essential: {
        offerId: "off_downsell_essential",
        name: "Templates Essenciais com Desconto",
        priceCents: 2990,
        checkoutUrl: "https://checkout.cakto.com.br/downsell-essential",
      },
    },
    pitch: {
      audioFileName: "pitch_downsell.ogg",
      messagesSpintax: [
        "{Oi|Fala}, *{primeiro_nome}*! Passando {rapidinho|aqui} para saber se voce ja conseguiu acessar o *{produto}* direitinho! Tudo certo com seu login?\n\nVi que ontem voce acabou nao pegando o nosso pacote acelerador completo. {Eu super entendo|Sei que as vezes o orcamento fica apertado} depois da primeira inscricao.\n\nPor isso, liberei uma *Versao Essencial ({nome_downsell})* — sem a parte avancada, mas com os *modelos principais prontos* para voce nao precisar comecar do zero.\n\nEm vez de R$ 67, voce leva essa versao enxuta hoje por *apenas R$ 29,90* no PIX. E literalmente preco de custo so para voce ter resultado mais rapido!\n\nPara destravar agora no seu painel, e so acessar aqui:\n{link_downsell}\n\nQualquer coisa que precisar no acesso principal, estou por aqui!",
      ],
      checkoutUrl: "https://checkout.cakto.com.br/downsell-essential",
    },
    delivery: {
      mediaFiles: [
        {
          type: "document",
          fileName: "pack_templates_essenciais.pdf",
          caption: "Templates Essenciais de Direct Response",
          mimeType: "application/pdf",
        },
      ],
      messagesSpintax: [
        "Parabens, *{primeiro_nome}*! Seu acesso a Versao Essencial dos Templates foi entregue acima.",
      ],
      microCommitmentQuestion:
        "Tudo certo com o download dos seus templates essenciais?",
    },
    nextSteps: [],
  },
};

export function getProductByType(type: ProductType): CatalogItem {
  return CATALOG[type];
}

export function getProductById(productId: string): CatalogItem | undefined {
  const values = Object.values(CATALOG);
  for (const item of values) {
    if (item.productId === productId) {
      return item;
    }
  }
  return undefined;
}

export function getProductByOfferId(offerId: string): CatalogItem | undefined {
  const values = Object.values(CATALOG);
  for (const item of values) {
    if (offerId in item.offers) {
      return item;
    }
  }
  return undefined;
}

export function getOfferById(offerId: string): OfferConfig | undefined {
  const values = Object.values(CATALOG);
  for (const item of values) {
    if (offerId in item.offers) {
      return item.offers[offerId];
    }
  }
  return undefined;
}

export function isMainProduct(productIdOrOfferId: string): boolean {
  if (CATALOG.MAIN.productId === productIdOrOfferId) {
    return true;
  }
  if (productIdOrOfferId in CATALOG.MAIN.offers) {
    return true;
  }
  return false;
}

export function getAllProducts(): CatalogItem[] {
  return Object.values(CATALOG);
}

export default CATALOG;
