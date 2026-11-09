import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import {
  CATALOG,
  getProductById,
  getProductByOfferId,
  isMainProduct,
  ProductType,
} from "../config/catalog.js";
import {
  Repositories,
  repositories as defaultRepositories,
  normalizeIsoDate,
  type Customer,
  type Order,
  type QueueJob,
  type MessageTemplate,
} from "../database/repositories.js";
import {
  resolveBrazilianPhoneCandidates,
  resolveSpintax,
} from "../whatsapp/dispatcher.js";

// ============================================================================
// Tipos e Estados da Maquina de Estados do Funil
// ============================================================================

export type FunnelState =
  | "NEW"
  | "WAITING_PAYMENT"
  | "DELIVERED_MAIN"
  | "DELIVERED_UPSELL_1"
  | "DELIVERED_UPSELL_2"
  | "DELIVERED_DOWNSELL"
  | "REFUNDED"
  | "CANCELLED";

export type FunnelMessageType =
  | "PIX_RECOVERY"
  | "DELIVERY_MAIN"
  | "PITCH_UPSELL_1"
  | "PITCH_DOWNSELL_1"
  | "DELIVERY_UPSELL_1"
  | "PITCH_UPSELL_2"
  | "DELIVERY_UPSELL_2"
  | "DELIVERY_DOWNSELL";

export interface PixGeneratedEvent {
  readonly transactionId: string;
  readonly phone: string;
  readonly name: string;
  readonly email?: string | null;
  readonly jid?: string | null;
  readonly productId?: string;
  readonly offerId?: string;
  readonly pixCode: string;
  readonly totalCents?: number;
  readonly rawPayload?: unknown;
  readonly allowExistingOrder?: boolean;
}

export interface PurchaseApprovedEvent {
  readonly transactionId: string;
  readonly phone: string;
  readonly name: string;
  readonly email?: string | null;
  readonly jid?: string | null;
  readonly productId?: string;
  readonly offerId?: string;
  readonly paidAt?: string | Date | null;
  readonly totalCents?: number;
  readonly rawPayload?: unknown;
  readonly allowExistingOrder?: boolean;
}

export interface InboundMessageEvent {
  readonly phoneOrJid: string;
  readonly text: string;
  readonly timestamp?: string | Date | null;
}

export interface RefundEvent {
  readonly transactionId: string;
  readonly customerId?: string;
  readonly phone?: string;
  readonly reason?: string;
  readonly rawPayload?: unknown;
  readonly allowExistingOrder?: boolean;
}

export interface StateMachineResult {
  readonly success: boolean;
  readonly customerId: string;
  readonly previousState: string;
  readonly newState: string;
  readonly event: string;
  readonly enqueuedJobsCount: number;
  readonly cancelledJobsCount: number;
  readonly rescheduledJobsCount: number;
  readonly orderId?: string;
  readonly duplicated?: boolean;
  readonly details?: string;
}

// ============================================================================
// Utilitarios Internos
// ============================================================================

function extractFirstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Cliente";
  const parts = trimmed.split(/\s+/);
  return parts[0] || "Cliente";
}

function resolveMediaFullPath(fileNameOrPath?: string | null): string | null {
  if (!fileNameOrPath) return null;
  if (path.isAbsolute(fileNameOrPath)) return fileNameOrPath;
  if (
    fileNameOrPath.startsWith("data/") ||
    fileNameOrPath.startsWith("data\\") ||
    fileNameOrPath.includes("/") ||
    fileNameOrPath.includes("\\")
  ) {
    const cwdPath = path.resolve(process.cwd(), fileNameOrPath);
    if (fs.existsSync(cwdPath)) return cwdPath;
    const basename = path.basename(fileNameOrPath);
    const inMedia = path.join(env.paths.mediaDir, basename);
    return fs.existsSync(inMedia) ? inMedia : cwdPath;
  }
  return path.join(env.paths.mediaDir, fileNameOrPath);
}

// ============================================================================
// Classe Principal: FunnelStateMachine
// ============================================================================

export class FunnelStateMachine {
  private readonly repos: Repositories;

  constructor(repos: Repositories = defaultRepositories) {
    this.repos = repos;
  }

  /**
   * Consulta o TemplateRepository por slug ou nome do template
   */
  public getTemplate(stepKey: string, alternateKeys: string[] = []): MessageTemplate | null {
    if (!this.repos?.templates) return null;
    const candidates = [stepKey, ...alternateKeys];
    for (const key of candidates) {
      try {
        const byId = this.repos.templates.findById(key);
        if (byId) return byId;
        const byName = this.repos.templates.findByName(key);
        if (byName) return byName;
      } catch {
        // Ignora erro se tabela nao existir no banco isolado
      }
    }
    return null;
  }

  /**
   * Monta dicionario completo de tags em Portugues e Ingles para interpolacao e Spintax
   */
  public buildTemplateVariables(data: {
    name?: string | null;
    firstName?: string | null;
    productName?: string | null;
    checkoutUrl?: string | null;
    pixCode?: string | null;
    extra?: Record<string, string>;
  }): Record<string, string> {
    const rawName = data.name || data.firstName || "Cliente";
    const firstName = data.firstName || extractFirstName(rawName);
    const prodName = data.productName || "";
    const checkout = data.checkoutUrl || "";
    const pix = data.pixCode || "";

    const vars: Record<string, string> = {
      // Tags em Portugues
      nome: rawName,
      primeiro_nome: firstName,
      produto: prodName,
      link_pagamento: checkout,
      pix_copia_cola: pix,
      link_acesso: checkout || "https://painel.aluno.com",
      link_checkout: checkout,
      link: checkout,
      pix_code: pix,
      // Tags em Ingles
      name: rawName,
      first_name: firstName,
      product_name: prodName,
      checkout_url: checkout,
      access_link: checkout || "https://painel.aluno.com",
      ...(data.extra || {}),
    };

    return vars;
  }

  /**
   * Gatilho 1: Pix Gerado
   * - Agenda PIX_RECOVERY para now + 7min (ou configuracao do catalogo) com Pix Copia e Cola
   * - Registra pedido com status waiting_payment e idempotencia estrita
   */
  public handlePixGenerated(event: PixGeneratedEvent): StateMachineResult {
    const rawPhone = event.phone.trim();
    const { canonicalPhone } = resolveBrazilianPhoneCandidates(rawPhone);
    const firstName = extractFirstName(event.name);

    return this.repos.transaction(() => {
      // 1. Upsert do cliente
      let customer = this.repos.customers.findByPhone(canonicalPhone);
      if (!customer) {
        customer = this.repos.customers.upsert({
          phone: canonicalPhone,
          name: event.name.trim(),
          email: event.email?.trim() ?? null,
          jid: event.jid?.trim() ?? null,
          current_state: "WAITING_PAYMENT",
        });
      } else if (customer.current_state === "NEW") {
        customer = this.repos.customers.updateState(customer.id, "WAITING_PAYMENT") ?? customer;
      }

      const previousState = customer.current_state;

      // 2. Registro idempotente do pedido
      const rawPayload: string | Record<string, unknown> =
        typeof event.rawPayload === "string"
          ? event.rawPayload
          : event.rawPayload && typeof event.rawPayload === "object"
          ? (event.rawPayload as Record<string, unknown>)
          : { pix_code: event.pixCode };

      const orderResult = this.repos.orders.createOrIgnore({
        transaction_id: event.transactionId.trim(),
        customer_id: customer.id,
        product_id: event.productId?.trim() || CATALOG.MAIN.productId,
        offer_id: event.offerId?.trim() || CATALOG.MAIN.defaultOfferId,
        event_type: "pix_generated",
        status: "waiting_payment",
        raw_payload: rawPayload,
      });

      if (!orderResult.inserted && !event.allowExistingOrder) {
        return {
          success: true,
          customerId: customer.id,
          previousState,
          newState: customer.current_state,
          event: "pix_generated",
          enqueuedJobsCount: 0,
          cancelledJobsCount: 0,
          rescheduledJobsCount: 0,
          orderId: orderResult.order.id,
          duplicated: true,
          details: "Evento de Pix gerado ignorado por idempotencia.",
        };
      }

      // 3. Localizar configuracao do produto no catalogo
      const product =
        (event.productId && getProductById(event.productId)) ||
        (event.offerId && getProductByOfferId(event.offerId)) ||
        CATALOG.MAIN;

      const pixConfig = product.pixRecovery ?? CATALOG.MAIN.pixRecovery;
      const delaySeconds = pixConfig?.delaySeconds ?? 420; // 7 minutos
      const baseScheduledAt = new Date(Date.now() + delaySeconds * 1000);

      // Variaveis de Spintax
      const selectedOffer =
        (event.offerId && product.offers[event.offerId]) ||
        product.offers[product.defaultOfferId];

      const templateVars = this.buildTemplateVariables({
        name: customer.name || event.name,
        firstName,
        productName: product.name,
        checkoutUrl: selectedOffer?.checkoutUrl ?? "",
        pixCode: event.pixCode,
      });

      const customTemplate = this.getTemplate("PIX_RECOVERY", [
        "tpl_pix_recovery",
        "Recuperação Pix",
        "Recuperacao de Pix",
      ]);

      let enqueuedCount = 0;
      if (customTemplate && this.repos.templates) {
        const resolvedText = this.repos.templates.interpolate(customTemplate.content, templateVars);
        const mediaFullPath = customTemplate.media_path ? resolveMediaFullPath(customTemplate.media_path) : null;

        this.repos.messageQueue.enqueue({
          customer_id: customer.id,
          phone: customer.phone,
          jid: customer.jid,
          message_type: "PIX_RECOVERY",
          content: resolvedText,
          media_path: mediaFullPath,
          scheduled_at: baseScheduledAt,
        });
        enqueuedCount++;
      } else {
        const messages = pixConfig?.messagesSpintax ?? [
          "{Ola|Oi}, *{{first_name}}*! Vi que gerou o Pix para *{{product_name}}*. Segue o codigo Copia e Cola:\n\n```{{pix_code}}```",
        ];

        // 4. Enfileirar baloes de recuperacao de Pix com pequeno intervalo entre eles
        messages.forEach((msgTemplate, index) => {
          const resolvedText = resolveSpintax(msgTemplate, templateVars);
          const scheduledTime = new Date(baseScheduledAt.getTime() + index * 3000);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "PIX_RECOVERY",
            content: resolvedText,
            scheduled_at: scheduledTime,
          });
          enqueuedCount++;
        });
      }

      // 5. Auditoria
      this.repos.auditLogs.log(
        "FunnelStateMachine",
        "PIX_GENERATED",
        "customer",
        customer.id,
        {
          transactionId: event.transactionId,
          enqueuedJobs: enqueuedCount,
          delaySeconds,
        }
      );

      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState: customer.current_state,
        event: "pix_generated",
        enqueuedJobsCount: enqueuedCount,
        cancelledJobsCount: 0,
        rescheduledJobsCount: 0,
        orderId: orderResult.order.id,
        duplicated: false,
        details: `Pix gerado registrado com sucesso. ${enqueuedCount} mensagens de recuperacao agendadas para +${delaySeconds}s.`,
      };
    });
  }

  /**
   * Gatilho 2: Compra Aprovada
   * - MAIN: cancela Pix, agenda DELIVERY_MAIN imediato com micro-comprometimento,
   *   atualiza estado para DELIVERED_MAIN e agenda PITCH_UPSELL_1 para now + 15min (e downsell fallback)
   * - UPSELL_1: cancela downsell e pitch upsell_1, entrega imediata, agenda UPSELL_2
   * - UPSELL_2: cancela pitch upsell_2, entrega imediata
   * - DOWNSELL: cancela downsell pitch, entrega imediata
   */
  public handlePurchaseApproved(event: PurchaseApprovedEvent): StateMachineResult {
    const rawPhone = event.phone.trim();
    const { canonicalPhone } = resolveBrazilianPhoneCandidates(rawPhone);
    const firstName = extractFirstName(event.name);

    return this.repos.transaction(() => {
      // 1. Determinar tipo do produto
      let productType: ProductType = "MAIN";
      let catalogItem = CATALOG.MAIN;

      if (event.productId) {
        const found = getProductById(event.productId);
        if (found) {
          catalogItem = found;
          productType = found.type;
        }
      } else if (event.offerId) {
        const found = getProductByOfferId(event.offerId);
        if (found) {
          catalogItem = found;
          productType = found.type;
        }
      }

      if (isMainProduct(event.productId || event.offerId || "")) {
        productType = "MAIN";
        catalogItem = CATALOG.MAIN;
      }

      // 2. Upsert do cliente
      let customer = this.repos.customers.findByPhone(canonicalPhone);
      if (!customer) {
        customer = this.repos.customers.upsert({
          phone: canonicalPhone,
          name: event.name.trim(),
          email: event.email?.trim() ?? null,
          jid: event.jid?.trim() ?? null,
          current_state: "NEW",
        });
      }

      const previousState = customer.current_state;

      // 3. Registro idempotente do pedido
      const rawPayload: string | Record<string, unknown> =
        typeof event.rawPayload === "string"
          ? event.rawPayload
          : event.rawPayload && typeof event.rawPayload === "object"
          ? (event.rawPayload as Record<string, unknown>)
          : { approved: true };

      const orderResult = this.repos.orders.createOrIgnore({
        transaction_id: event.transactionId.trim(),
        customer_id: customer.id,
        product_id: event.productId?.trim() || catalogItem.productId,
        offer_id: event.offerId?.trim() || catalogItem.defaultOfferId,
        event_type: "purchase_approved",
        status: "approved",
        paid_at: event.paidAt ? normalizeIsoDate(event.paidAt) : new Date().toISOString(),
        raw_payload: rawPayload,
      });

      if (!orderResult.inserted && !event.allowExistingOrder) {
        return {
          success: true,
          customerId: customer.id,
          previousState,
          newState: customer.current_state,
          event: "purchase_approved",
          enqueuedJobsCount: 0,
          cancelledJobsCount: 0,
          rescheduledJobsCount: 0,
          orderId: orderResult.order.id,
          duplicated: true,
          details: "Compra aprovada ignorada por idempotencia (pedido ja existente).",
        };
      }

      let cancelledCount = 0;
      let enqueuedCount = 0;
      let newState: FunnelState = "DELIVERED_MAIN";

      const now = new Date();

      // ======================================================================
      // Ramo A: Compra do Produto Principal (MAIN)
      // ======================================================================
      if (productType === "MAIN") {
        newState = "DELIVERED_MAIN";

        // 1. Cancela recuperacao de Pix pendente
        cancelledCount += this.repos.messageQueue.cancelPendingByCustomer(
          customer.id,
          "PIX_RECOVERY"
        );

        // 2. Atualiza estado para DELIVERED_MAIN
        this.repos.customers.updateState(customer.id, newState);

        // 3. Agenda DELIVERY_MAIN imediato
        const selectedOffer =
          (event.offerId && catalogItem.offers[event.offerId]) ||
          catalogItem.offers[catalogItem.defaultOfferId];

        const templateVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
          checkoutUrl: selectedOffer?.checkoutUrl ?? "",
          extra: {
            link_acesso: selectedOffer?.checkoutUrl ?? "https://painel.aluno.com",
            access_link: selectedOffer?.checkoutUrl ?? "https://painel.aluno.com",
            link_checkout: selectedOffer?.checkoutUrl ?? "",
          },
        });

        let messageStep = 0;

        const customDelivery = this.getTemplate("MAIN_DELIVERY", [
          "DELIVERY_MAIN",
          "tpl_welcome_delivery",
          "tpl_main_delivery",
          "Entrega Produto Principal",
        ]);

        if (customDelivery && this.repos.templates) {
          const content = this.repos.templates.interpolate(customDelivery.content, templateVars);
          const mediaFullPath = customDelivery.media_path
            ? resolveMediaFullPath(customDelivery.media_path)
            : (catalogItem.delivery.mediaFiles[0] ? resolveMediaFullPath(catalogItem.delivery.mediaFiles[0].fileName) : null);

          // 1. Balao textual de boas-vindas e entrega interpolado do template
          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_MAIN",
            content,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
          messageStep++;

          // 2. Anexo PDF do material principal
          if (mediaFullPath) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_MAIN",
              content: catalogItem.delivery.mediaFiles[0]?.caption || path.basename(mediaFullPath),
              media_path: mediaFullPath,
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          // 3. Pergunta de micro-comprometimento
          const microQuestion =
            catalogItem.delivery.microCommitmentQuestion ??
            "Conseguiu abrir o material? Me responde SIM";
          const resolvedQuestion = resolveSpintax(microQuestion, templateVars);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_MAIN",
            content: resolvedQuestion,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
        } else {
          // Baloes de texto de entrega
          for (const msgTemplate of catalogItem.delivery.messagesSpintax) {
            const content = resolveSpintax(msgTemplate, templateVars);
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_MAIN",
              content,
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          // Anexo PDF do material principal
          for (const media of catalogItem.delivery.mediaFiles) {
            const mediaFullPath = resolveMediaFullPath(media.fileName);
            const caption = media.caption ? resolveSpintax(media.caption, templateVars) : undefined;

            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_MAIN",
              content: caption || media.fileName,
              media_path: mediaFullPath,
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          // Ultimo balao: Pergunta de micro-comprometimento
          const microQuestion =
            catalogItem.delivery.microCommitmentQuestion ??
            "Conseguiu abrir o material? Me responde SIM";
          const resolvedQuestion = resolveSpintax(microQuestion, templateVars);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_MAIN",
            content: resolvedQuestion,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
        }

        // 4. Agenda PITCH_UPSELL_1 para now + 15min
        const upsell1Config = CATALOG.UPSELL_1;
        const nextStepDelay = catalogItem.nextSteps[0]?.delaySeconds ?? 900; // 15min
        const scheduledUpsell1 = new Date(now.getTime() + nextStepDelay * 1000);

        const upsell1Offer =
          upsell1Config.offers[upsell1Config.defaultOfferId] ??
          Object.values(upsell1Config.offers)[0];

        const upsellVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
          checkoutUrl: upsell1Config.pitch?.checkoutUrl ?? upsell1Offer.checkoutUrl,
          extra: {
            nome_upsell_1: upsell1Config.name,
            upsell_1_name: upsell1Config.name,
            link_upsell_1: upsell1Config.pitch?.checkoutUrl ?? upsell1Offer.checkoutUrl,
            upsell_1_link: upsell1Config.pitch?.checkoutUrl ?? upsell1Offer.checkoutUrl,
            link_checkout: upsell1Config.pitch?.checkoutUrl ?? upsell1Offer.checkoutUrl,
          },
        });

        const customUpsell1 = this.getTemplate("UPSELL_1_OFFER", [
          "PITCH_UPSELL_1",
          "tpl_upsell_pitch",
          "tpl_upsell_1_pitch",
          "Script de UPSELL 1",
        ]);

        if (customUpsell1 && this.repos.templates) {
          const mediaFullPath = customUpsell1.media_path
            ? resolveMediaFullPath(customUpsell1.media_path)
            : (upsell1Config.pitch?.audioFileName ? resolveMediaFullPath(upsell1Config.pitch.audioFileName) : null);

          // 1. Audio PTT se configurado no template ou catalogo
          if (mediaFullPath) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_UPSELL_1",
              content: `Audio PTT: ${upsell1Config.name}`,
              media_path: mediaFullPath,
              scheduled_at: scheduledUpsell1,
            });
            enqueuedCount++;
          }

          // 2. Balao textual com oferta e link de checkout interpolados
          const pitchContent = this.repos.templates.interpolate(customUpsell1.content, upsellVars);
          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "PITCH_UPSELL_1",
            content: pitchContent,
            scheduled_at: new Date(scheduledUpsell1.getTime() + (mediaFullPath ? 3000 : 0)),
          });
          enqueuedCount++;
        } else {
          // Pitch de áudio PTT do Upsell 1
          if (upsell1Config.pitch?.audioFileName) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_UPSELL_1",
              content: `Audio PTT: ${upsell1Config.name}`,
              media_path: resolveMediaFullPath(upsell1Config.pitch.audioFileName),
              scheduled_at: scheduledUpsell1,
            });
            enqueuedCount++;
          }

          // Mensagens de texto com o link de checkout do Upsell 1
          if (upsell1Config.pitch?.messagesSpintax) {
            upsell1Config.pitch.messagesSpintax.forEach((pitchMsg, pIdx) => {
              const pitchContent = resolveSpintax(pitchMsg, upsellVars);
              this.repos.messageQueue.enqueue({
                customer_id: customer.id,
                phone: customer.phone,
                jid: customer.jid,
                message_type: "PITCH_UPSELL_1",
                content: pitchContent,
                scheduled_at: new Date(scheduledUpsell1.getTime() + (pIdx + 1) * 3000),
              });
              enqueuedCount++;
            });
          }
        }

        // 5. Downsell por tempo: já agenda PITCH_DOWNSELL_1 para now + 2 horas caso não compre o UPSELL_1
        const downsellDelay =
          nextStepDelay + (upsell1Config.downsellStep?.delaySeconds ?? 7200); // 15min + 2h
        const scheduledDownsell = new Date(now.getTime() + downsellDelay * 1000);

        const downsellConfig = CATALOG.DOWNSELL;
        const downsellOffer =
          downsellConfig.offers[downsellConfig.defaultOfferId] ??
          Object.values(downsellConfig.offers)[0];

        const downsellVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
          checkoutUrl: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
          extra: {
            nome_downsell: downsellConfig.name,
            downsell_name: downsellConfig.name,
            link_downsell: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
            downsell_link: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
            link_checkout: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
          },
        });

        const customDownsell = this.getTemplate("DOWNSELL_OFFER", [
          "PITCH_DOWNSELL_1",
          "tpl_downsell_offer",
          "Script de DOWNSELL",
        ]);

        if (customDownsell && this.repos.templates) {
          const mediaFullPath = customDownsell.media_path
            ? resolveMediaFullPath(customDownsell.media_path)
            : (downsellConfig.pitch?.audioFileName ? resolveMediaFullPath(downsellConfig.pitch.audioFileName) : null);

          // 1. Audio PTT se configurado
          if (mediaFullPath) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_DOWNSELL_1",
              content: `Audio PTT Downsell: ${downsellConfig.name}`,
              media_path: mediaFullPath,
              scheduled_at: scheduledDownsell,
            });
            enqueuedCount++;
          }

          // 2. Balao textual com oferta de downsell e link interpolados
          const downContent = this.repos.templates.interpolate(customDownsell.content, downsellVars);
          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "PITCH_DOWNSELL_1",
            content: downContent,
            scheduled_at: new Date(scheduledDownsell.getTime() + (mediaFullPath ? 3000 : 0)),
          });
          enqueuedCount++;
        } else {
          if (downsellConfig.pitch?.audioFileName) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_DOWNSELL_1",
              content: `Audio PTT Downsell: ${downsellConfig.name}`,
              media_path: resolveMediaFullPath(downsellConfig.pitch.audioFileName),
              scheduled_at: scheduledDownsell,
            });
            enqueuedCount++;
          }

          if (downsellConfig.pitch?.messagesSpintax) {
            downsellConfig.pitch.messagesSpintax.forEach((downMsg, dIdx) => {
              const downContent = resolveSpintax(downMsg, downsellVars);
              this.repos.messageQueue.enqueue({
                customer_id: customer.id,
                phone: customer.phone,
                jid: customer.jid,
                message_type: "PITCH_DOWNSELL_1",
                content: downContent,
                scheduled_at: new Date(scheduledDownsell.getTime() + (dIdx + 1) * 3000),
              });
              enqueuedCount++;
            });
          }
        }
      }

      // ======================================================================
      // Ramo B: Compra do UPSELL_1
      // ======================================================================
      else if (productType === "UPSELL_1") {
        newState = "DELIVERED_UPSELL_1";

        // 1. Cancela pitches pendentes de UPSELL_1 e DOWNSELL
        cancelledCount += this.repos.messageQueue.cancelPendingByCustomer(
          customer.id,
          "PITCH_UPSELL_1"
        );
        cancelledCount += this.repos.messageQueue.cancelPendingByCustomer(
          customer.id,
          "PITCH_DOWNSELL_1"
        );

        // 2. Atualiza estado
        this.repos.customers.updateState(customer.id, newState);

        // 3. Entrega imediata de UPSELL_1
        const templateVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
        });

        let messageStep = 0;

        const customUpsell1Deliv = this.getTemplate("UPSELL_1_DELIVERY", [
          "DELIVERY_UPSELL_1",
          "tpl_upsell_1_delivery",
          "Entrega Upsell 1",
        ]);

        if (customUpsell1Deliv && this.repos.templates) {
          const content = this.repos.templates.interpolate(customUpsell1Deliv.content, templateVars);
          const mediaFullPath = customUpsell1Deliv.media_path
            ? resolveMediaFullPath(customUpsell1Deliv.media_path)
            : (catalogItem.delivery.mediaFiles[0] ? resolveMediaFullPath(catalogItem.delivery.mediaFiles[0].fileName) : null);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_UPSELL_1",
            content,
            media_path: mediaFullPath,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
          messageStep++;
        } else {
          for (const msgTemplate of catalogItem.delivery.messagesSpintax) {
            const content = resolveSpintax(msgTemplate, templateVars);
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_UPSELL_1",
              content,
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          for (const media of catalogItem.delivery.mediaFiles) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_UPSELL_1",
              content: media.caption ?? media.fileName,
              media_path: resolveMediaFullPath(media.fileName),
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }
        }

        // 4. Agenda UPSELL_2 para now + 15min
        const upsell2Config = CATALOG.UPSELL_2;
        const nextStepDelay = catalogItem.nextSteps[0]?.delaySeconds ?? 900;
        const scheduledUpsell2 = new Date(now.getTime() + nextStepDelay * 1000);

        const upsell2Offer =
          upsell2Config.offers[upsell2Config.defaultOfferId] ??
          Object.values(upsell2Config.offers)[0];

        const upsell2Vars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
          checkoutUrl: upsell2Config.pitch?.checkoutUrl ?? upsell2Offer.checkoutUrl,
          extra: {
            nome_upsell_1: CATALOG.UPSELL_1.name,
            upsell_1_name: CATALOG.UPSELL_1.name,
            nome_upsell_2: upsell2Config.name,
            upsell_2_name: upsell2Config.name,
            link_upsell_2: upsell2Config.pitch?.checkoutUrl ?? upsell2Offer.checkoutUrl,
            upsell_2_link: upsell2Config.pitch?.checkoutUrl ?? upsell2Offer.checkoutUrl,
            link_checkout: upsell2Config.pitch?.checkoutUrl ?? upsell2Offer.checkoutUrl,
          },
        });

        const customUpsell2 = this.getTemplate("UPSELL_2_OFFER", [
          "PITCH_UPSELL_2",
          "tpl_upsell_2_pitch",
          "tpl_upsell_2_vip",
          "Script de UPSELL 2",
        ]);

        if (customUpsell2 && this.repos.templates) {
          const mediaFullPath = customUpsell2.media_path
            ? resolveMediaFullPath(customUpsell2.media_path)
            : (upsell2Config.pitch?.audioFileName ? resolveMediaFullPath(upsell2Config.pitch.audioFileName) : null);

          // 1. Audio PTT se configurado
          if (mediaFullPath) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_UPSELL_2",
              content: `Audio PTT: ${upsell2Config.name}`,
              media_path: mediaFullPath,
              scheduled_at: scheduledUpsell2,
            });
            enqueuedCount++;
          }

          // 2. Balao textual com link de checkout VIP interpolado
          const pitchContent = this.repos.templates.interpolate(customUpsell2.content, upsell2Vars);
          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "PITCH_UPSELL_2",
            content: pitchContent,
            scheduled_at: new Date(scheduledUpsell2.getTime() + (mediaFullPath ? 3000 : 0)),
          });
          enqueuedCount++;
        } else {
          if (upsell2Config.pitch?.audioFileName) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "PITCH_UPSELL_2",
              content: `Audio PTT: ${upsell2Config.name}`,
              media_path: resolveMediaFullPath(upsell2Config.pitch.audioFileName),
              scheduled_at: scheduledUpsell2,
            });
            enqueuedCount++;
          }

          if (upsell2Config.pitch?.messagesSpintax) {
            upsell2Config.pitch.messagesSpintax.forEach((msg, idx) => {
              this.repos.messageQueue.enqueue({
                customer_id: customer.id,
                phone: customer.phone,
                jid: customer.jid,
                message_type: "PITCH_UPSELL_2",
                content: resolveSpintax(msg, upsell2Vars),
                scheduled_at: new Date(scheduledUpsell2.getTime() + (idx + 1) * 3000),
              });
              enqueuedCount++;
            });
          }
        }
      }

      // ======================================================================
      // Ramo C: Compra do UPSELL_2
      // ======================================================================
      else if (productType === "UPSELL_2") {
        newState = "DELIVERED_UPSELL_2";

        // 1. Cancela pitch de UPSELL_2
        cancelledCount += this.repos.messageQueue.cancelPendingByCustomer(
          customer.id,
          "PITCH_UPSELL_2"
        );

        // 2. Atualiza estado
        this.repos.customers.updateState(customer.id, newState);

        // 3. Entrega imediata de UPSELL_2
        const templateVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
        });

        let messageStep = 0;

        const customUpsell2Deliv = this.getTemplate("UPSELL_2_DELIVERY", [
          "DELIVERY_UPSELL_2",
          "tpl_upsell_2_delivery",
          "Entrega Upsell 2",
        ]);

        if (customUpsell2Deliv && this.repos.templates) {
          const content = this.repos.templates.interpolate(customUpsell2Deliv.content, templateVars);
          const mediaFullPath = customUpsell2Deliv.media_path
            ? resolveMediaFullPath(customUpsell2Deliv.media_path)
            : (catalogItem.delivery.mediaFiles[0] ? resolveMediaFullPath(catalogItem.delivery.mediaFiles[0].fileName) : null);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_UPSELL_2",
            content,
            media_path: mediaFullPath,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
          messageStep++;
        } else {
          for (const msgTemplate of catalogItem.delivery.messagesSpintax) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_UPSELL_2",
              content: resolveSpintax(msgTemplate, templateVars),
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          for (const media of catalogItem.delivery.mediaFiles) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_UPSELL_2",
              content: media.caption ?? media.fileName,
              media_path: resolveMediaFullPath(media.fileName),
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }
        }
      }

      // ======================================================================
      // Ramo D: Compra do DOWNSELL
      // ======================================================================
      else if (productType === "DOWNSELL") {
        newState = "DELIVERED_DOWNSELL";

        // 1. Cancela pitch de downsell
        cancelledCount += this.repos.messageQueue.cancelPendingByCustomer(
          customer.id,
          "PITCH_DOWNSELL_1"
        );

        // 2. Atualiza estado
        this.repos.customers.updateState(customer.id, newState);

        // 3. Entrega imediata de DOWNSELL
        const templateVars = this.buildTemplateVariables({
          name: customer.name || event.name,
          firstName,
          productName: catalogItem.name,
        });

        let messageStep = 0;

        const customDownsellDeliv = this.getTemplate("DOWNSELL_DELIVERY", [
          "DELIVERY_DOWNSELL",
          "tpl_downsell_delivery",
          "Entrega Downsell",
        ]);

        if (customDownsellDeliv && this.repos.templates) {
          const content = this.repos.templates.interpolate(customDownsellDeliv.content, templateVars);
          const mediaFullPath = customDownsellDeliv.media_path
            ? resolveMediaFullPath(customDownsellDeliv.media_path)
            : (catalogItem.delivery.mediaFiles[0] ? resolveMediaFullPath(catalogItem.delivery.mediaFiles[0].fileName) : null);

          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "DELIVERY_DOWNSELL",
            content,
            media_path: mediaFullPath,
            scheduled_at: new Date(now.getTime() + messageStep * 3000),
          });
          enqueuedCount++;
          messageStep++;
        } else {
          for (const msgTemplate of catalogItem.delivery.messagesSpintax) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_DOWNSELL",
              content: resolveSpintax(msgTemplate, templateVars),
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }

          for (const media of catalogItem.delivery.mediaFiles) {
            this.repos.messageQueue.enqueue({
              customer_id: customer.id,
              phone: customer.phone,
              jid: customer.jid,
              message_type: "DELIVERY_DOWNSELL",
              content: media.caption ?? media.fileName,
              media_path: resolveMediaFullPath(media.fileName),
              scheduled_at: new Date(now.getTime() + messageStep * 3000),
            });
            enqueuedCount++;
            messageStep++;
          }
        }
      }

      // Auditoria
      this.repos.auditLogs.log(
        "FunnelStateMachine",
        "PURCHASE_APPROVED",
        "customer",
        customer.id,
        {
          transactionId: event.transactionId,
          productType,
          previousState,
          newState,
          enqueuedJobs: enqueuedCount,
          cancelledJobs: cancelledCount,
        }
      );

      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState,
        event: "purchase_approved",
        enqueuedJobsCount: enqueuedCount,
        cancelledJobsCount: cancelledCount,
        rescheduledJobsCount: 0,
        orderId: orderResult.order.id,
        duplicated: false,
        details: `Compra aprovada para ${productType}. ${enqueuedCount} mensagens enfileiradas, ${cancelledCount} canceladas.`,
      };
    });
  }

  /**
   * Gatilho 3: Micro-comprometimento (Cliente respondeu no WhatsApp)
   * - Se o cliente esta no estado DELIVERED_MAIN e envia qualquer mensagem no WhatsApp:
   *   Localiza o job PITCH_UPSELL_1 que estava aguardando os 15 minutos e atualiza o scheduled_at para now.
   * - Tambem recalcula a tolerancia do downsell para 2h a partir do momento da resposta.
   */
  public handleInboundMessage(event: InboundMessageEvent): StateMachineResult {
    const rawIdentifier = event.phoneOrJid.trim();

    // 1. Localiza cliente por JID ou Telefone
    let customer: Customer | null = null;
    if (rawIdentifier.includes("@")) {
      customer = this.repos.customers.findByJid(rawIdentifier);
    }

    if (!customer) {
      const { candidates } = resolveBrazilianPhoneCandidates(rawIdentifier);
      for (const cand of candidates) {
        customer = this.repos.customers.findByPhone(cand);
        if (customer) break;
      }
    }

    if (!customer) {
      return {
        success: false,
        customerId: "",
        previousState: "",
        newState: "",
        event: "inbound_message",
        enqueuedJobsCount: 0,
        cancelledJobsCount: 0,
        rescheduledJobsCount: 0,
        details: "Cliente nao localizado no banco para este telefone/JID.",
      };
    }

    const previousState = customer.current_state;

    // 2. Se o cliente esta em DELIVERED_MAIN, antecipa PITCH_UPSELL_1 para now
    if (customer.current_state === "DELIVERED_MAIN") {
      const now = new Date();
      const rescheduledUpsellCount = this.repos.messageQueue.reschedulePendingByType(
        customer.id,
        "PITCH_UPSELL_1",
        now
      );

      // Reagenda o downsell fallback para now + 2h caso ele estivesse agendado
      const downsellRescheduledCount = this.repos.messageQueue.reschedulePendingByType(
        customer.id,
        "PITCH_DOWNSELL_1",
        new Date(now.getTime() + 7200 * 1000)
      );

      const totalRescheduled = rescheduledUpsellCount + downsellRescheduledCount;

      this.repos.auditLogs.log(
        "FunnelStateMachine",
        "MICRO_COMMITMENT_TRIGGERED",
        "customer",
        customer.id,
        {
          incomingText: event.text,
          rescheduledUpsell: rescheduledUpsellCount,
          rescheduledDownsell: downsellRescheduledCount,
        }
      );

      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState: customer.current_state,
        event: "micro_commitment_reply",
        enqueuedJobsCount: 0,
        cancelledJobsCount: 0,
        rescheduledJobsCount: totalRescheduled,
        details: `Micro-comprometimento acionado com sucesso. PITCH_UPSELL_1 antecipado para imediato (${rescheduledUpsellCount} jobs).`,
      };
    }

    return {
      success: true,
      customerId: customer.id,
      previousState,
      newState: customer.current_state,
      event: "inbound_message_ignored",
      enqueuedJobsCount: 0,
      cancelledJobsCount: 0,
      rescheduledJobsCount: 0,
      details: `Mensagem inbound recebida no estado ${customer.current_state}, sem acao de micro-comprometimento necessaria.`,
    };
  }

  /**
   * Gatilho 5: Downsell por Tempo
   * Caso UPSELL_1 nao tenha sido comprado e o prazo do pitch tenha expirado,
   * assegura que o PITCH_DOWNSELL_1 esteja agendado para o cliente.
   */
  public handleDownsellTimerCheck(customerId: string): StateMachineResult {
    const customer = this.repos.customers.findById(customerId);
    if (!customer) {
      return {
        success: false,
        customerId,
        previousState: "",
        newState: "",
        event: "downsell_check",
        enqueuedJobsCount: 0,
        cancelledJobsCount: 0,
        rescheduledJobsCount: 0,
        details: "Cliente nao encontrado.",
      };
    }

    const previousState = customer.current_state;

    // Se o cliente ja comprou UPSELL_1, downsell nao se aplica
    const orders = this.repos.orders.listByCustomerId(customer.id);
    const hasBoughtUpsell1 = orders.some(
      (o) =>
        o.product_id === CATALOG.UPSELL_1.productId ||
        o.offer_id in CATALOG.UPSELL_1.offers
    );

    if (hasBoughtUpsell1) {
      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState: previousState,
        event: "downsell_check_skipped",
        enqueuedJobsCount: 0,
        cancelledJobsCount: 0,
        rescheduledJobsCount: 0,
        details: "Cliente ja adquiriu UPSELL_1, downsell ignorado.",
      };
    }

    // Verifica se ja ha PITCH_DOWNSELL_1 pendente
    const pendingDownsell = this.repos.messageQueue
      .listByCustomerId(customer.id, "PENDING")
      .filter((j) => j.message_type === "PITCH_DOWNSELL_1");

    if (pendingDownsell.length > 0) {
      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState: previousState,
        event: "downsell_already_scheduled",
        enqueuedJobsCount: 0,
        cancelledJobsCount: 0,
        rescheduledJobsCount: 0,
        details: "PITCH_DOWNSELL_1 ja estava previamente agendado.",
      };
    }

    // Se nao estava agendado e o cliente nao comprou UPSELL_1, agenda agora para execucao imediata
    const firstName = extractFirstName(customer.name);
    const downsellConfig = CATALOG.DOWNSELL;
    const downsellOffer =
      downsellConfig.offers[downsellConfig.defaultOfferId] ??
      Object.values(downsellConfig.offers)[0];

    const downsellVars = this.buildTemplateVariables({
      name: customer.name,
      firstName,
      productName: downsellConfig.name,
      checkoutUrl: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
      extra: {
        nome_downsell: downsellConfig.name,
        downsell_name: downsellConfig.name,
        link_downsell: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
        downsell_link: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
        link_checkout: downsellConfig.pitch?.checkoutUrl ?? downsellOffer.checkoutUrl,
      },
    });

    let enqueuedCount = 0;
    const now = new Date();

    const customDownsell = this.getTemplate("DOWNSELL_OFFER", [
      "PITCH_DOWNSELL_1",
      "tpl_downsell_offer",
      "Script de DOWNSELL",
    ]);

    if (customDownsell && this.repos.templates) {
      const mediaFullPath = customDownsell.media_path
        ? resolveMediaFullPath(customDownsell.media_path)
        : (downsellConfig.pitch?.audioFileName ? resolveMediaFullPath(downsellConfig.pitch.audioFileName) : null);

      if (mediaFullPath) {
        this.repos.messageQueue.enqueue({
          customer_id: customer.id,
          phone: customer.phone,
          jid: customer.jid,
          message_type: "PITCH_DOWNSELL_1",
          content: `Audio PTT Downsell: ${downsellConfig.name}`,
          media_path: mediaFullPath,
          scheduled_at: now,
        });
        enqueuedCount++;
      }

      const downContent = this.repos.templates.interpolate(customDownsell.content, downsellVars);
      this.repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        jid: customer.jid,
        message_type: "PITCH_DOWNSELL_1",
        content: downContent,
        scheduled_at: new Date(now.getTime() + (mediaFullPath ? 3000 : 0)),
      });
      enqueuedCount++;
    } else {
      if (downsellConfig.pitch?.audioFileName) {
        this.repos.messageQueue.enqueue({
          customer_id: customer.id,
          phone: customer.phone,
          jid: customer.jid,
          message_type: "PITCH_DOWNSELL_1",
          content: `Audio PTT Downsell: ${downsellConfig.name}`,
          media_path: resolveMediaFullPath(downsellConfig.pitch.audioFileName),
          scheduled_at: now,
        });
        enqueuedCount++;
      }

      if (downsellConfig.pitch?.messagesSpintax) {
        downsellConfig.pitch.messagesSpintax.forEach((msg, idx) => {
          this.repos.messageQueue.enqueue({
            customer_id: customer.id,
            phone: customer.phone,
            jid: customer.jid,
            message_type: "PITCH_DOWNSELL_1",
            content: resolveSpintax(msg, downsellVars),
            scheduled_at: new Date(now.getTime() + (idx + 1) * 3000),
          });
          enqueuedCount++;
        });
      }
    }

    this.repos.auditLogs.log(
      "FunnelStateMachine",
      "DOWNSELL_SCHEDULED_EXPLICIT",
      "customer",
      customer.id,
      { enqueuedCount }
    );

    return {
      success: true,
      customerId: customer.id,
      previousState,
      newState: previousState,
      event: "downsell_scheduled",
      enqueuedJobsCount: enqueuedCount,
      cancelledJobsCount: 0,
      rescheduledJobsCount: 0,
      details: `${enqueuedCount} mensagens de PITCH_DOWNSELL_1 enfileiradas.`,
    };
  }

  /**
   * Gatilho 6: Reembolso ou Chargeback
   * Cancela todos os jobs pendentes do cliente e atualiza status para REFUNDED
   */
  public handleRefund(event: RefundEvent): StateMachineResult {
    return this.repos.transaction(() => {
      let customer: Customer | null = null;
      if (event.customerId) {
        customer = this.repos.customers.findById(event.customerId);
      } else if (event.phone) {
        const { canonicalPhone } = resolveBrazilianPhoneCandidates(event.phone);
        customer = this.repos.customers.findByPhone(canonicalPhone);
      }

      if (!customer) {
        // Tenta encontrar pelo transactionId nas ordens
        const existingOrder = this.repos.orders.findByTransactionAndEvent(
          event.transactionId,
          "purchase_approved"
        );
        if (existingOrder) {
          customer = this.repos.customers.findById(existingOrder.customer_id);
        }
      }

      if (!customer) {
        return {
          success: false,
          customerId: "",
          previousState: "",
          newState: "",
          event: "refund",
          enqueuedJobsCount: 0,
          cancelledJobsCount: 0,
          rescheduledJobsCount: 0,
          details: "Cliente associado ao reembolso nao localizado.",
        };
      }

      const previousState = customer.current_state;

      // 1. Registra pedido com evento de reembolso
      const rawPayload: string | Record<string, unknown> =
        typeof event.rawPayload === "string"
          ? event.rawPayload
          : event.rawPayload && typeof event.rawPayload === "object"
          ? (event.rawPayload as Record<string, unknown>)
          : { reason: event.reason ?? "refund" };

      this.repos.orders.createOrIgnore({
        transaction_id: event.transactionId.trim(),
        customer_id: customer.id,
        product_id: CATALOG.MAIN.productId,
        offer_id: CATALOG.MAIN.defaultOfferId,
        event_type: "purchase_refunded",
        status: "refunded",
        raw_payload: rawPayload,
      });

      // 2. Cancela TODOS os jobs pendentes daquele cliente na fila
      const cancelledCount = this.repos.messageQueue.cancelPendingByCustomer(customer.id);

      // 3. Atualiza estado para REFUNDED
      this.repos.customers.updateState(customer.id, "REFUNDED");

      // 4. Auditoria
      this.repos.auditLogs.log(
        "FunnelStateMachine",
        "PURCHASE_REFUNDED",
        "customer",
        customer.id,
        {
          transactionId: event.transactionId,
          cancelledJobs: cancelledCount,
        }
      );

      return {
        success: true,
        customerId: customer.id,
        previousState,
        newState: "REFUNDED",
        event: "purchase_refunded",
        enqueuedJobsCount: 0,
        cancelledJobsCount: cancelledCount,
        rescheduledJobsCount: 0,
        details: `Reembolso processado. ${cancelledCount} jobs pendentes cancelados e cliente marcado como REFUNDED.`,
      };
    });
  }
}

// Instancia singleton padrao
export const funnelStateMachine = new FunnelStateMachine();

// Funcoes utilitarias exportadas diretamente para conveniencia
export function handlePixGenerated(
  event: PixGeneratedEvent,
  repos?: Repositories
): StateMachineResult {
  const machine = repos ? new FunnelStateMachine(repos) : funnelStateMachine;
  return machine.handlePixGenerated(event);
}

export function handlePurchaseApproved(
  event: PurchaseApprovedEvent,
  repos?: Repositories
): StateMachineResult {
  const machine = repos ? new FunnelStateMachine(repos) : funnelStateMachine;
  return machine.handlePurchaseApproved(event);
}

export function handleInboundMessage(
  event: InboundMessageEvent,
  repos?: Repositories
): StateMachineResult {
  const machine = repos ? new FunnelStateMachine(repos) : funnelStateMachine;
  return machine.handleInboundMessage(event);
}

export function handleDownsellTimerCheck(
  customerId: string,
  repos?: Repositories
): StateMachineResult {
  const machine = repos ? new FunnelStateMachine(repos) : funnelStateMachine;
  return machine.handleDownsellTimerCheck(customerId);
}

export function handleRefund(
  event: RefundEvent,
  repos?: Repositories
): StateMachineResult {
  const machine = repos ? new FunnelStateMachine(repos) : funnelStateMachine;
  return machine.handleRefund(event);
}

export default funnelStateMachine;
