import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createDatabaseConnection,
  applySchema,
} from "../src/database/connection.js";
import {
  createRepositories,
  Repositories,
} from "../src/database/repositories.js";
import {
  FunnelStateMachine,
  handlePixGenerated,
  handlePurchaseApproved,
  handleInboundMessage,
  handleDownsellTimerCheck,
  handleRefund,
  type PixGeneratedEvent,
  type PurchaseApprovedEvent,
} from "../src/engine/state-machine.js";
import { CATALOG } from "../src/config/catalog.js";

describe("Maquina de Estados Hibrida do Funil de Vendas (state-machine.ts)", () => {
  let db: Database.Database;
  let repos: Repositories;
  let machine: FunnelStateMachine;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    applySchema(db);
    repos = createRepositories(db);
    machine = new FunnelStateMachine(repos);
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  describe("Gatilho 1: Pix Gerado (handlePixGenerated)", () => {
    test("deve agendar PIX_RECOVERY para now + 7min com Pix Copia e Cola e criar cliente em WAITING_PAYMENT", () => {
      const event: PixGeneratedEvent = {
        transactionId: "trx_pix_001",
        phone: "11988887777",
        name: "Carlos Eduardo Silva",
        email: "carlos@example.com",
        pixCode: "00020126580014br.gov.bcb.pix0136pix-chave-teste",
        productId: CATALOG.MAIN.productId,
        offerId: CATALOG.MAIN.defaultOfferId,
      };

      const beforeTime = Date.now();
      const result = machine.handlePixGenerated(event);
      const afterTime = Date.now();

      assert.equal(result.success, true);
      assert.equal(result.event, "pix_generated");
      assert.equal(result.newState, "WAITING_PAYMENT");
      assert.ok(result.enqueuedJobsCount >= 1);
      assert.equal(result.duplicated, false);

      // Valida cliente no banco
      const customer = repos.customers.findByPhone("5511988887777");
      assert.ok(customer);
      assert.equal(customer?.name, "Carlos Eduardo Silva");
      assert.equal(customer?.current_state, "WAITING_PAYMENT");

      // Valida jobs de recuperacao enfileirados
      const pendingJobs = repos.messageQueue.listByCustomerId(customer!.id, "PENDING");
      assert.ok(pendingJobs.length >= 1);
      assert.ok(pendingJobs.every((j) => j.message_type === "PIX_RECOVERY"));

      // Valida que o scheduled_at esta aproximadamente em now + 7 minutos (420 segundos)
      const firstJob = pendingJobs[0];
      const scheduledTime = new Date(firstJob.scheduled_at).getTime();
      const expectedTimeMin = beforeTime + 418 * 1000;
      const expectedTimeMax = afterTime + 425 * 1000;
      assert.ok(
        scheduledTime >= expectedTimeMin && scheduledTime <= expectedTimeMax,
        `scheduled_at (${firstJob.scheduled_at}) deve estar em torno de now + 7min`
      );

      // Valida interpolacao do primeiro nome e codigo Pix
      const allContent = pendingJobs.map((j) => j.content).join(" ");
      assert.ok(allContent.includes("Carlos"), "Deve conter o primeiro nome Carlos");
      assert.ok(allContent.includes("00020126580014br.gov.bcb.pix"), "Deve conter o Pix Copia e Cola");
    });

    test("deve garantir idempotencia estrita ignorando evento duplicado de Pix gerado", () => {
      const event: PixGeneratedEvent = {
        transactionId: "trx_pix_idempotent",
        phone: "5511977776666",
        name: "Mariana Souza",
        pixCode: "pix-copia-cola-mariana",
      };

      const firstCall = machine.handlePixGenerated(event);
      assert.equal(firstCall.success, true);
      assert.equal(firstCall.duplicated, false);
      const initialJobCount = repos.messageQueue.countByStatus("PENDING");

      // Segunda chamada com mesmo transaction_id
      const secondCall = machine.handlePixGenerated(event);
      assert.equal(secondCall.success, true);
      assert.equal(secondCall.duplicated, true);
      assert.equal(secondCall.enqueuedJobsCount, 0);

      // Total de jobs no banco nao deve ter aumentado
      assert.equal(repos.messageQueue.countByStatus("PENDING"), initialJobCount);
      assert.equal(repos.orders.count(), 1);
    });
  });

  describe("Gatilho 2: Compra MAIN Aprovada (handlePurchaseApproved)", () => {
    test("deve cancelar PIX_RECOVERY, agendar DELIVERY_MAIN imediato com micro-comprometimento, atualizar para DELIVERED_MAIN e agendar PITCH_UPSELL_1 para now + 15min", () => {
      // 1. Simula cliente gerando Pix primeiro
      const pixEvent: PixGeneratedEvent = {
        transactionId: "trx_main_compra_01",
        phone: "5511999991111",
        name: "Lucas Ferreira",
        pixCode: "pix-lucas-code",
      };
      machine.handlePixGenerated(pixEvent);

      const customerBefore = repos.customers.findByPhone("5511999991111")!;
      assert.equal(customerBefore.current_state, "WAITING_PAYMENT");
      assert.ok(repos.messageQueue.countByStatus("PENDING") > 0);

      // 2. Compra do MAIN e aprovada
      const purchaseEvent: PurchaseApprovedEvent = {
        transactionId: "trx_main_compra_01",
        phone: "5511999991111",
        name: "Lucas Ferreira",
        productId: CATALOG.MAIN.productId,
        offerId: CATALOG.MAIN.defaultOfferId,
        paidAt: new Date(),
      };

      const beforeTime = Date.now();
      const result = machine.handlePurchaseApproved(purchaseEvent);
      const afterTime = Date.now();

      assert.equal(result.success, true);
      assert.equal(result.event, "purchase_approved");
      assert.equal(result.previousState, "WAITING_PAYMENT");
      assert.equal(result.newState, "DELIVERED_MAIN");
      assert.ok(result.cancelledJobsCount >= 1, "Deve ter cancelado os jobs de Pix");
      assert.ok(result.enqueuedJobsCount >= 3, "Deve ter enfileirado entrega, PDF, micro-comprometimento e upsell");

      // Valida cliente no banco
      const customerAfter = repos.customers.findById(customerBefore.id)!;
      assert.equal(customerAfter.current_state, "DELIVERED_MAIN");

      // Valida que jobs de Pix foram cancelados
      const cancelledJobs = repos.messageQueue.listByCustomerId(customerAfter.id, "CANCELLED");
      assert.ok(cancelledJobs.every((j) => j.message_type === "PIX_RECOVERY"));

      // Valida jobs de DELIVERY_MAIN agendados para imediato (now)
      const allJobs = repos.messageQueue.listByCustomerId(customerAfter.id, "PENDING");
      const deliveryJobs = allJobs.filter((j) => j.message_type === "DELIVERY_MAIN");
      assert.ok(deliveryJobs.length >= 2, "Deve haver mensagem de texto e anexo do material");

      // Valida que o ultimo balao de entrega contem a pergunta de micro-comprometimento
      const lastDeliveryJob = deliveryJobs[deliveryJobs.length - 1];
      assert.ok(
        lastDeliveryJob.content.includes("Conseguiu abrir o material") ||
          lastDeliveryJob.content.includes("SIM"),
        `Ultimo balao deve conter pergunta de micro-comprometimento: ${lastDeliveryJob.content}`
      );

      // Valida que o material em PDF foi anexado
      const pdfJob = deliveryJobs.find((j) => j.media_path && j.media_path.endsWith(".pdf"));
      assert.ok(pdfJob, "Deve conter job de envio do PDF");
      assert.ok(pdfJob?.media_path?.includes("guia_definitivo_alta_conversao.pdf"));

      // Valida PITCH_UPSELL_1 agendado para now + 15 minutos (900 segundos)
      const pitchJobs = allJobs.filter((j) => j.message_type === "PITCH_UPSELL_1");
      assert.ok(pitchJobs.length >= 1, "Deve haver job de PITCH_UPSELL_1");

      const pitchJob = pitchJobs[0];
      const pitchScheduledTime = new Date(pitchJob.scheduled_at).getTime();
      const expectedPitchMin = beforeTime + 895 * 1000;
      const expectedPitchMax = afterTime + 910 * 1000;
      assert.ok(
        pitchScheduledTime >= expectedPitchMin && pitchScheduledTime <= expectedPitchMax,
        `PITCH_UPSELL_1 (${pitchJob.scheduled_at}) deve estar em torno de now + 15min`
      );

      // Valida PITCH_DOWNSELL_1 agendado como fallback de tempo
      const downsellJobs = allJobs.filter((j) => j.message_type === "PITCH_DOWNSELL_1");
      assert.ok(downsellJobs.length >= 1, "Deve haver job de fallback PITCH_DOWNSELL_1 agendado");
    });

    test("deve ser idempotente em chamadas repetidas de purchase_approved para MAIN", () => {
      const event: PurchaseApprovedEvent = {
        transactionId: "trx_main_repetida",
        phone: "5511999992222",
        name: "Renata Abreu",
        productId: CATALOG.MAIN.productId,
      };

      const firstCall = machine.handlePurchaseApproved(event);
      assert.equal(firstCall.duplicated, false);
      const pendingCount = repos.messageQueue.countByStatus("PENDING");

      const secondCall = machine.handlePurchaseApproved(event);
      assert.equal(secondCall.duplicated, true);
      assert.equal(secondCall.enqueuedJobsCount, 0);
      assert.equal(repos.messageQueue.countByStatus("PENDING"), pendingCount);
    });
  });

  describe("Gatilho 3: Micro-comprometimento por Mensagem WhatsApp (handleInboundMessage)", () => {
    test("se cliente em DELIVERED_MAIN responder, deve antecipar PITCH_UPSELL_1 para now", () => {
      // 1. Prepara cliente com MAIN entregue
      const purchaseEvent: PurchaseApprovedEvent = {
        transactionId: "trx_micro_01",
        phone: "5511988883333",
        name: "Bruno Costa",
        productId: CATALOG.MAIN.productId,
      };
      machine.handlePurchaseApproved(purchaseEvent);

      const customer = repos.customers.findByPhone("5511988883333")!;
      assert.equal(customer.current_state, "DELIVERED_MAIN");

      // Verifica que PITCH_UPSELL_1 esta no futuro (+15 min) e nao esta due now
      const dueBeforeReply = repos.messageQueue.findDueJobs(new Date());
      assert.ok(dueBeforeReply.every((j) => j.message_type !== "PITCH_UPSELL_1"));

      // 2. Cliente responde 'SIM' no WhatsApp
      const inboundEvent = {
        phoneOrJid: "5511988883333",
        text: "SIM, abri aqui e achei muito top!",
      };

      const replyResult = machine.handleInboundMessage(inboundEvent);
      assert.equal(replyResult.success, true);
      assert.equal(replyResult.event, "micro_commitment_reply");
      assert.ok(replyResult.rescheduledJobsCount >= 1, "Deve ter antecipado ao menos 1 job de pitch");

      // 3. Agora PITCH_UPSELL_1 deve estar pronto para envio (due now)
      const dueAfterReply = repos.messageQueue.findDueJobs(new Date(Date.now() + 1000));
      const duePitch = dueAfterReply.find((j) => j.message_type === "PITCH_UPSELL_1");
      assert.ok(duePitch, "PITCH_UPSELL_1 deve estar pronto para disparo imediato");
    });

    test("deve ignorar aceleracao se cliente nao estiver no estado DELIVERED_MAIN", () => {
      // Cliente novo em WAITING_PAYMENT
      machine.handlePixGenerated({
        transactionId: "trx_pix_ignore",
        phone: "5511988884444",
        name: "Tatiana Moura",
        pixCode: "pix-code",
      });

      const replyResult = machine.handleInboundMessage({
        phoneOrJid: "5511988884444",
        text: "Ola, ainda nao paguei",
      });

      assert.equal(replyResult.success, true);
      assert.equal(replyResult.event, "inbound_message_ignored");
      assert.equal(replyResult.rescheduledJobsCount, 0);
    });

    test("deve retornar success: false se telefone/JID nao existir no banco", () => {
      const replyResult = machine.handleInboundMessage({
        phoneOrJid: "5511999999999",
        text: "Oi!",
      });

      assert.equal(replyResult.success, false);
      assert.equal(replyResult.rescheduledJobsCount, 0);
    });
  });

  describe("Gatilho 4: Compra UPSELL_1 (handlePurchaseApproved)", () => {
    test("deve cancelar downsell e pitch de upsell, entregar UPSELL_1 imediato e agendar UPSELL_2 para now + 15min", () => {
      // 1. Cliente compra MAIN
      machine.handlePurchaseApproved({
        transactionId: "trx_upsell1_flow_01",
        phone: "5511977771234",
        name: "Gabriel Martins",
        productId: CATALOG.MAIN.productId,
      });

      const customer = repos.customers.findByPhone("5511977771234")!;

      // 2. Cliente compra UPSELL_1
      const upsell1Event: PurchaseApprovedEvent = {
        transactionId: "trx_upsell1_flow_02",
        phone: "5511977771234",
        name: "Gabriel Martins",
        productId: CATALOG.UPSELL_1.productId,
        offerId: CATALOG.UPSELL_1.defaultOfferId,
      };

      const result = machine.handlePurchaseApproved(upsell1Event);
      assert.equal(result.success, true);
      assert.equal(result.newState, "DELIVERED_UPSELL_1");
      assert.ok(result.cancelledJobsCount >= 1, "Deve ter cancelado o downsell e/ou pitch pendente");

      // Valida cliente atualizado
      const updatedCustomer = repos.customers.findById(customer.id)!;
      assert.equal(updatedCustomer.current_state, "DELIVERED_UPSELL_1");

      // Valida que PITCH_DOWNSELL_1 foi cancelado
      const cancelledDownsell = repos.messageQueue
        .listByCustomerId(customer.id, "CANCELLED")
        .filter((j) => j.message_type === "PITCH_DOWNSELL_1");
      assert.ok(cancelledDownsell.length >= 1, "Downsell deve estar cancelado");

      // Valida entrega imediata do UPSELL_1
      const pendingJobs = repos.messageQueue.listByCustomerId(customer.id, "PENDING");
      const deliveryUpsell1 = pendingJobs.filter((j) => j.message_type === "DELIVERY_UPSELL_1");
      assert.ok(deliveryUpsell1.length >= 1, "Deve haver entrega imediata do UPSELL_1");

      // Valida agendamento do PITCH_UPSELL_2 para now + 15min
      const pitchUpsell2 = pendingJobs.filter((j) => j.message_type === "PITCH_UPSELL_2");
      assert.ok(pitchUpsell2.length >= 1, "Deve haver agendamento do PITCH_UPSELL_2");
    });
  });

  describe("Gatilho 5: Downsell por Tempo (handleDownsellTimerCheck)", () => {
    test("deve assegurar agendamento de PITCH_DOWNSELL_1 caso UPSELL_1 nao tenha sido comprado", () => {
      // Cliente comprou MAIN mas ainda nao comprou UPSELL_1
      const purchaseEvent: PurchaseApprovedEvent = {
        transactionId: "trx_downsell_flow_01",
        phone: "5511966667890",
        name: "Amanda Ribeiro",
        productId: CATALOG.MAIN.productId,
      };
      machine.handlePurchaseApproved(purchaseEvent);

      const customer = repos.customers.findByPhone("5511966667890")!;

      // Verifica status de downsell existente
      const checkResult = machine.handleDownsellTimerCheck(customer.id);
      assert.equal(checkResult.success, true);
      assert.ok(
        checkResult.event === "downsell_already_scheduled" || checkResult.event === "downsell_scheduled"
      );

      // Cancela propositalmente o job para testar criacao explicita
      repos.messageQueue.cancelPendingByCustomer(customer.id, "PITCH_DOWNSELL_1");

      const checkRecreate = machine.handleDownsellTimerCheck(customer.id);
      assert.equal(checkRecreate.success, true);
      assert.equal(checkRecreate.event, "downsell_scheduled");
      assert.ok(checkRecreate.enqueuedJobsCount >= 1);

      const pendingJobs = repos.messageQueue.listByCustomerId(customer.id, "PENDING");
      const downsellJobs = pendingJobs.filter((j) => j.message_type === "PITCH_DOWNSELL_1");
      assert.ok(downsellJobs.length >= 1);
      assert.ok(downsellJobs.some((j) => j.content.includes("Amanda")));
    });

    test("deve ignorar downsell se cliente ja comprou UPSELL_1", () => {
      // Cliente comprou MAIN e UPSELL_1
      machine.handlePurchaseApproved({
        transactionId: "trx_skip_down_01",
        phone: "5511955551122",
        name: "Diego Nogueira",
        productId: CATALOG.MAIN.productId,
      });

      machine.handlePurchaseApproved({
        transactionId: "trx_skip_down_02",
        phone: "5511955551122",
        name: "Diego Nogueira",
        productId: CATALOG.UPSELL_1.productId,
      });

      const customer = repos.customers.findByPhone("5511955551122")!;
      const checkResult = machine.handleDownsellTimerCheck(customer.id);
      assert.equal(checkResult.success, true);
      assert.equal(checkResult.event, "downsell_check_skipped");
      assert.equal(checkResult.enqueuedJobsCount, 0);
    });
  });

  describe("Gatilhos Adicionais: UPSELL_2, DOWNSELL e Reembolso", () => {
    test("Compra de UPSELL_2 deve cancelar PITCH_UPSELL_2 e agendar DELIVERY_UPSELL_2", () => {
      machine.handlePurchaseApproved({
        transactionId: "trx_up2_01",
        phone: "5511944449988",
        name: "Henrique Castilho",
        productId: CATALOG.UPSELL_2.productId,
      });

      const customer = repos.customers.findByPhone("5511944449988")!;
      assert.equal(customer.current_state, "DELIVERED_UPSELL_2");

      const pending = repos.messageQueue.listByCustomerId(customer.id, "PENDING");
      assert.ok(pending.some((j) => j.message_type === "DELIVERY_UPSELL_2"));
    });

    test("Compra de DOWNSELL deve cancelar PITCH_DOWNSELL_1 e agendar DELIVERY_DOWNSELL", () => {
      machine.handlePurchaseApproved({
        transactionId: "trx_down_01",
        phone: "5511933338877",
        name: "Leticia Andrade",
        productId: CATALOG.DOWNSELL.productId,
      });

      const customer = repos.customers.findByPhone("5511933338877")!;
      assert.equal(customer.current_state, "DELIVERED_DOWNSELL");

      const pending = repos.messageQueue.listByCustomerId(customer.id, "PENDING");
      assert.ok(pending.some((j) => j.message_type === "DELIVERY_DOWNSELL"));
    });

    test("Reembolso (handleRefund) deve cancelar todos os jobs pendentes e marcar cliente como REFUNDED", () => {
      // Cria cliente com Pix e Compra
      machine.handlePurchaseApproved({
        transactionId: "trx_refund_target",
        phone: "5511922227766",
        name: "Rodrigo Carvalho",
        productId: CATALOG.MAIN.productId,
      });

      const customer = repos.customers.findByPhone("5511922227766")!;
      assert.ok(repos.messageQueue.countByStatus("PENDING") > 0);

      const refundResult = machine.handleRefund({
        transactionId: "trx_refund_target",
        customerId: customer.id,
        reason: "Cliente solicitou devolucao no suporte",
      });

      assert.equal(refundResult.success, true);
      assert.equal(refundResult.newState, "REFUNDED");
      assert.ok(refundResult.cancelledJobsCount >= 1);

      // Valida cliente no banco
      const customerAfter = repos.customers.findById(customer.id)!;
      assert.equal(customerAfter.current_state, "REFUNDED");

      // Valida que zero jobs estao pendentes
      assert.equal(repos.messageQueue.countByStatus("PENDING"), 0);
    });

    test("funcoes utilitarias exportadas diretamente operam corretamente", () => {
      const pixRes = handlePixGenerated(
        {
          transactionId: "trx_helper_pix",
          phone: "5511911112233",
          name: "Helper User",
          pixCode: "pix-helper",
        },
        repos
      );
      assert.equal(pixRes.success, true);

      const purchaseRes = handlePurchaseApproved(
        {
          transactionId: "trx_helper_purchase",
          phone: "5511911112233",
          name: "Helper User",
          productId: CATALOG.MAIN.productId,
        },
        repos
      );
      assert.equal(purchaseRes.success, true);

      const replyRes = handleInboundMessage(
        {
          phoneOrJid: "5511911112233",
          text: "SIM",
        },
        repos
      );
      assert.equal(replyRes.success, true);
      assert.ok(replyRes.rescheduledJobsCount >= 1);

      const downsellRes = handleDownsellTimerCheck(purchaseRes.customerId, repos);
      assert.equal(downsellRes.success, true);

      const refundRes = handleRefund(
        {
          transactionId: "trx_helper_purchase",
          customerId: purchaseRes.customerId,
        },
        repos
      );
      assert.equal(refundRes.success, true);
      assert.equal(refundRes.newState, "REFUNDED");
    });
  });
});
