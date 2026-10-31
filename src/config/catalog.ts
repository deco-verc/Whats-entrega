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
      delaySeconds: 420, // 7 minutos
      messagesSpintax: [
        "{Ola|Oi|Fala}, *{{first_name}}*! Vi que voce gerou o Pix para o *{{product_name}}*, mas ainda nao concluiu o pagamento.",
        "Para nao perder sua vaga e o valor promocional, segue abaixo o seu codigo Pix Copia e Cola:\n\n```{{pix_code}}```",
        "Assim que pagar, o sistema libera seu material imediatamente por aqui. Precisa de alguma ajuda?",
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
        "{Ola|Oi|Fala}, *{{first_name}}*! Parabens pela decisao! Seu pagamento foi confirmado com sucesso.",
        "Acabei de anexar acima o seu material em PDF para download imediato.",
      ],
      microCommitmentQuestion:
        "Conseguiu abrir o material direitinho? Me responde SIM aqui so para eu confirmar.",
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
        priceCents: 14700,
        checkoutUrl: "https://checkout.cakto.com.br/upsell-1-pack",
      },
    },
    pitch: {
      audioFileName: "pitch_upsell_1.ogg",
      messagesSpintax: [
        "{Escuta|Ouve} esse audio rapidinho de 1 minuto que gravei exclusivamente para voce, *{{first_name}}*.",
        "Como voce ja garantiu o metodo principal, liberei uma condicao unica de upgrade para ter acesso aos nossos templates prontos de alta conversao:\n\nAcesse pelo link oficial: {{checkout_url}}",
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
        "{Perfeito|Show|Sensacional}, *{{first_name}}*! Seu upgrade para o Acelerador foi ativado com sucesso.",
        "Segue acima o material completo do Pacote de Templates.",
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
        "*{{first_name}}*, preparei uma oportunidade final restrita apenas a quem adquiriu o pacote completo.",
        "{Escuta|Confere} o audio explicativo que mandei acima. Se quiser dar o proximo passo na sua operacao, acesse pelo link especial:\n\nAcesse pelo link oficial: {{checkout_url}}",
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
        "Acesso liberado a Masterclass de Escala! Bons estudos e boas vendas, *{{first_name}}*.",
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
        priceCents: 4700,
        checkoutUrl: "https://checkout.cakto.com.br/downsell-essential",
      },
    },
    pitch: {
      audioFileName: "pitch_downsell.ogg",
      messagesSpintax: [
        "{Oi|Fala}, *{{first_name}}*! Sei que a rotina e corrida e talvez o investimento no pacote completo nao tenha sido no momento ideal.",
        "Para nao te deixar sem apoio na implementacao, conversei com a equipe e liberamos uma versao essencial com 65% de desconto apenas hoje:\n\nAcesse pelo link oficial: {{checkout_url}}",
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
        "Parabens, *{{first_name}}*! Seu acesso a Versao Essencial dos Templates foi entregue acima.",
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
