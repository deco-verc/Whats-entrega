import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
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
  QueueWorker,
  createQueueWorker,
  type QueueWorkerOptions,
} from "../src/engine/worker.js";
import { bootstrap, type AppInstance } from "../src/index.js";
import type { WASocket } from "@whiskeysockets/baileys";

function createMockSocket(options: { shouldFail?: boolean; errorMessage?: string } = {}): WASocket {
  const sentMessages: Array<{ jid: string; content: unknown }> = [];

  const mockSock = {
    sendMessage: async (jid: string, content: unknown) => {
      if (options.shouldFail) {
        throw new Error(options.errorMessage || "Simulated Baileys Send Error");
      }
      sentMessages.push({ jid, content });
      return {
        key: {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          remoteJid: jid,
          fromMe: true,
        },
      };
    },
    sendPresenceUpdate: async (_type: string, _jid: string) => {
      // Mock da simulacao de presenca
    },
    onWhatsApp: async (jidOrPhone: string) => {
      const clean = jidOrPhone.replace(/\D/g, "");
      return [{ jid: `${clean}@s.whatsapp.net`, exists: true }];
    },
    authState: {
      creds: { registered: true },
    },
  } as unknown as WASocket;

  (mockSock as unknown as { _sent: typeof sentMessages })._sent = sentMessages;
  return mockSock;
}

describe("Worker de Fila Anti-Banimento e Entrypoint (worker.ts & index.ts)", () => {
  let db: Database.Database;
  let repos: Repositories;
  let mockSocket: WASocket;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    applySchema(db);
    repos = createRepositories(db);
    mockSocket = createMockSocket();
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  describe("Concorrencia Controlada e Fila Indiana Estrita", () => {
    test("deve processar estritamente 1 job vencido por vez e transicionar PENDING -> PROCESSING -> SENT", async () => {
      const customer = repos.customers.upsert({
        phone: "5511988880001",
        name: "Marcio Roberto",
      });

      const now = new Date();
      const past1 = new Date(now.getTime() - 20000);
      const past2 = new Date(now.getTime() - 10000);

      // Enfileira 2 jobs vencidos
      const job1 = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Mensagem 1 de entrega",
        scheduled_at: past1,
      });

      const job2 = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Mensagem 2 de entrega",
        scheduled_at: past2,
      });

      const worker = new QueueWorker({
        repos,
        sock: mockSocket,
        minJitterMs: 0,
        maxJitterMs: 0,
        dispatchOptions: { skipPresenceSimulation: true },
        autoStart: false,
      });

      // Execucao do primeiro tick: deve processar estritamente job1
      const result1 = await worker.processNextJob(now);
      assert.ok(result1);
      assert.equal(result1.job.id, job1.id);
      assert.equal(result1.dispatchResult.success, true);

      // Valida status no banco
      const job1After = repos.messageQueue.findById(job1.id);
      assert.equal(job1After?.status, "SENT");

      const job2AfterTick1 = repos.messageQueue.findById(job2.id);
      assert.equal(job2AfterTick1?.status, "PENDING", "Segundo job deve continuar PENDING no primeiro tick");

      // Execucao do segundo tick: deve processar job2
      const result2 = await worker.processNextJob(now);
      assert.ok(result2);
      assert.equal(result2.job.id, job2.id);

      const job2AfterTick2 = repos.messageQueue.findById(job2.id);
      assert.equal(job2AfterTick2?.status, "SENT");

      // Terceiro tick: nenhum job pendente
      const result3 = await worker.processNextJob(now);
      assert.equal(result3, null);

      const stats = worker.getStatus().stats;
      assert.equal(stats.processedCount, 2);
      assert.equal(stats.sentCount, 2);
      assert.equal(stats.failedCount, 0);
    });

    test("bloqueio de concorrencia: nao deve executar dois jobs simultaneamente (isProcessing lock)", async () => {
      const customer = repos.customers.upsert({
        phone: "5511988880002",
        name: "Renata Vasconcelos",
      });

      repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PITCH_UPSELL_1",
        content: "Oferta especial",
        scheduled_at: new Date(Date.now() - 5000),
      });

      const worker = new QueueWorker({
        repos,
        sock: mockSocket,
        minJitterMs: 50,
        maxJitterMs: 100,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      // Dispara duas chamadas concorrentes
      const p1 = worker.processNextJob();
      const p2 = worker.processNextJob();

      const [r1, r2] = await Promise.all([p1, p2]);

      // Uma das chamadas deve ter processado e a outra recebido null devido ao lock de concorrencia
      assert.ok((r1 !== null && r2 === null) || (r1 === null && r2 !== null));
    });
  });

  describe("Motor Spintax e Interpolacao de Variaveis no Momento do Despacho", () => {
    test("deve resolver Spintax e interpolar {{first_name}} com o primeiro nome real do cliente", async () => {
      const customer = repos.customers.upsert({
        phone: "5511977773344",
        name: "Juliana Maria de Alencar",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "{Ola|Oi|Fala}, *{{first_name}}*! Seu acesso esta liberado.",
        scheduled_at: new Date(Date.now() - 1000),
      });

      const worker = new QueueWorker({
        repos,
        sock: mockSocket,
        minJitterMs: 0,
        maxJitterMs: 0,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      const result = await worker.processNextJob();
      assert.ok(result);
      assert.equal(result.dispatchResult.success, true);

      // Inspeciona mensagem capturada pelo mock
      const sent = (mockSocket as unknown as { _sent: Array<{ content: { text?: string } }> })._sent;
      assert.ok(sent.length >= 1);
      const lastText = sent[sent.length - 1].content.text || "";

      assert.ok(
        lastText.includes("Juliana"),
        `Mensagem enviada deve conter o primeiro nome Juliana. Conteudo: ${lastText}`
      );
      assert.ok(
        !lastText.includes("{{first_name}}"),
        "Nao deve conter a tag crua {{first_name}}"
      );
      assert.ok(
        lastText.startsWith("Ola") || lastText.startsWith("Oi") || lastText.startsWith("Fala"),
        `Deve ter resolvido uma das opcoes do Spintax. Conteudo: ${lastText}`
      );
    });
  });

  describe("Tratamento de Falhas e Retentativas com Backoff", () => {
    test("deve registrar falha transiente e reagendar com status PENDING quando attempts < maxAttempts", async () => {
      const failingSocket = createMockSocket({
        shouldFail: true,
        errorMessage: "Baileys Connection Reset By Peer",
      });

      const customer = repos.customers.upsert({
        phone: "5511966661122",
        name: "Fernando Dias",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Entrega com falha",
        scheduled_at: new Date(Date.now() - 1000),
      });

      const worker = new QueueWorker({
        repos,
        sock: failingSocket,
        minJitterMs: 0,
        maxJitterMs: 0,
        maxAttempts: 3,
        retryDelaySeconds: 30,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      const result = await worker.processNextJob();
      assert.ok(result);
      assert.equal(result.dispatchResult.success, false);

      // Job deve voltar para PENDING para retentativa posterior
      const jobAfter = repos.messageQueue.findById(job.id);
      assert.equal(jobAfter?.status, "PENDING");
      assert.equal(jobAfter?.attempts, 1);
      assert.ok(jobAfter?.last_error?.includes("Baileys Connection Reset By Peer"));

      const stats = worker.getStatus().stats;
      assert.equal(stats.failedCount, 1);
      assert.equal(stats.sentCount, 0);
    });

    test("deve marcar falha terminal definitiva quando atinge maxAttempts", async () => {
      const failingSocket = createMockSocket({
        shouldFail: true,
        errorMessage: "Fatal WhatsApp Network Timeout",
      });

      const customer = repos.customers.upsert({
        phone: "5511955559988",
        name: "Priscila Silva",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "PIX_RECOVERY",
        content: "Recuperacao com erro repetido",
        scheduled_at: new Date(Date.now() - 1000),
      });

      // Simula 2 falhas previas no banco
      repos.messageQueue.markAsProcessing(job.id);
      repos.messageQueue.markAsFailed(job.id, "Err 1", 3, 10);
      repos.messageQueue.markAsProcessing(job.id);
      repos.messageQueue.markAsFailed(job.id, "Err 2", 3, 10);

      const worker = new QueueWorker({
        repos,
        sock: failingSocket,
        minJitterMs: 0,
        maxJitterMs: 0,
        maxAttempts: 3,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      // Terceira tentativa (deve ser terminal FAILED)
      const now = new Date(Date.now() + 60000);
      await worker.processNextJob(now);

      const jobFinal = repos.messageQueue.findById(job.id);
      assert.equal(jobFinal?.status, "FAILED");
      assert.equal(jobFinal?.attempts, 3);
    });

    test("deve falhar graciosamente se o socket WhatsApp nao estiver disponivel", async () => {
      const customer = repos.customers.upsert({
        phone: "5511944443322",
        name: "Lucas Offline",
      });

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Tentativa sem socket",
        scheduled_at: new Date(Date.now() - 1000),
      });

      const worker = new QueueWorker({
        repos,
        sock: undefined, // Sem socket provido
        minJitterMs: 0,
        maxJitterMs: 0,
      });

      const result = await worker.processNextJob();
      assert.equal(result, null);

      const jobAfter = repos.messageQueue.findById(job.id);
      assert.equal(jobAfter?.status, "PENDING");
      assert.ok(jobAfter?.last_error?.includes("Socket WhatsApp nao disponivel"));
    });

    test("fallback de midia inexistente: nao deve falhar job e deve enviar mensagem de texto registrando WARN no audit_logs", async () => {
      const sentMessages: Array<{ jid: string; content: any }> = [];
      const mockSock = {
        authState: { creds: { registered: true } },
        onWhatsApp: async (...phones: string[]) => {
          return phones.map((p) => ({ exists: true, jid: `${p.replace(/\D/g, "")}@s.whatsapp.net` }));
        },
        sendMessage: async (jid: string, content: any) => {
          sentMessages.push({ jid, content });
          return { key: { id: "mock_fallback_id" } };
        },
      } as unknown as WASocket;

      const customer = repos.customers.upsert({
        phone: "5511933332211",
        name: "Cliente Midia Ausente",
      });

      const nonExistentPath = "data/media/arquivo_que_definitivamente_nao_existe.pdf";

      const job = repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Acesse o seu guia no link abaixo: https://painel.aluno.com",
        media_path: nonExistentPath,
        scheduled_at: new Date(Date.now() - 1000),
      });

      const worker = new QueueWorker({
        repos,
        sock: mockSock,
        minJitterMs: 0,
        maxJitterMs: 0,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      const result = await worker.processNextJob();
      assert.ok(result);
      assert.equal(result?.dispatchResult.success, true);

      // Job deve ser marcado como SENT e nao FAILED
      const jobAfter = repos.messageQueue.findById(job.id);
      assert.equal(jobAfter?.status, "SENT");

      // Deve ter enviado via sendTextMessage (content.text)
      assert.ok(sentMessages.length >= 1);
      assert.ok(sentMessages[0].content.text.includes("Acesse o seu guia"));

      // Deve ter registrado WARN no audit_logs
      const logs = repos.auditLogs.listLogs("message_queue");
      assert.ok(logs.some((l) => l.action === "MEDIA_FALLBACK_TEXT"));
    });
  });

  describe("Ciclo de Vida do Worker (start/stop) e Delay Elastico (Jitter)", () => {
    test("start() e stop() devem alternar estado isRunning corretamente", async () => {
      const worker = createQueueWorker({
        repos,
        sock: mockSocket,
        pollIntervalMs: 100,
        minJitterMs: 0,
        maxJitterMs: 0,
      });

      assert.equal(worker.getStatus().isRunning, false);
      worker.start();
      assert.equal(worker.getStatus().isRunning, true);

      await worker.stop();
      assert.equal(worker.getStatus().isRunning, false);
    });

    test("deve aplicar jitter aleatorio entre minJitterMs e maxJitterMs", async () => {
      const customer = repos.customers.upsert({
        phone: "5511933332211",
        name: "Amanda Jitter",
      });

      repos.messageQueue.enqueue({
        customer_id: customer.id,
        phone: customer.phone,
        message_type: "DELIVERY_MAIN",
        content: "Mensagem de teste de jitter",
        scheduled_at: new Date(Date.now() - 1000),
      });

      const worker = new QueueWorker({
        repos,
        sock: mockSocket,
        minJitterMs: 30,
        maxJitterMs: 60,
        dispatchOptions: { skipPresenceSimulation: true },
      });

      const result = await worker.processNextJob();
      assert.ok(result);
      assert.ok(
        result.jitterMs >= 30 && result.jitterMs <= 60,
        `Jitter calculado (${result.jitterMs}) deve estar na faixa [30, 60]`
      );
    });
  });

  describe("Entrypoint Unificado (src/index.ts)", () => {
    test("bootstrap() deve orquestrar inicializacao de banco, HTTP e worker e suportar stop() gracioso", async () => {
      let instance: AppInstance | null = null;

      try {
        instance = await bootstrap({
          startHttpServer: false, // Desativa bind de porta fisica em teste
          startWorker: false,
          startWhatsApp: false,
        });

        assert.ok(instance);
        assert.ok(instance.httpServer);
        assert.ok(instance.worker);
        assert.equal(typeof instance.stop, "function");
      } finally {
        if (instance) {
          await instance.stop();
        }
      }
    });
  });
});
