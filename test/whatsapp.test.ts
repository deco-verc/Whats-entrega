import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { WASocket, WAMessage, AnyMessageContent } from "@whiskeysockets/baileys";
import {
  createDatabaseConnection,
  closeDatabase,
} from "../src/database/connection.js";
import {
  CustomerRepository,
  MessageQueueRepository,
  AuditLogRepository,
} from "../src/database/repositories.js";
import {
  resolveBrazilianPhoneCandidates,
  resolveJid,
  simulateTypingPresence,
  simulateRecordingPresence,
  getRandomDelay,
  resolveSpintax,
  sendTextMessage,
  sendAudioPtt,
  sendDocumentMessage,
  dispatchQueueJob,
} from "../src/whatsapp/dispatcher.js";
import {
  extractMessageText,
  WhatsAppSocketManager,
} from "../src/whatsapp/socket.js";
import { env } from "../src/config/env.js";

interface MockCallRecord {
  readonly method: string;
  readonly args: unknown[];
}

/**
 * Cria um mock de WASocket em memoria para testes unitarios controlados
 */
function createMockWASocket(overrides: {
  onWhatsAppHandler?: (...phones: string[]) => Promise<{ exists: boolean; jid: string }[] | undefined>;
  sendMessageHandler?: (jid: string, content: AnyMessageContent) => Promise<WAMessage | undefined>;
  sendPresenceUpdateHandler?: (type: string, toJid?: string) => Promise<void>;
  requestPairingCodeHandler?: (phone: string) => Promise<string>;
  registered?: boolean;
} = {}): {
  readonly sock: WASocket;
  readonly calls: MockCallRecord[];
  readonly events: Record<string, Array<(...args: unknown[]) => void>>;
  emitEvent: (event: string, data: unknown) => void;
} {
  const calls: MockCallRecord[] = [];
  const events: Record<string, Array<(...args: unknown[]) => void>> = {};

  const emitEvent = (event: string, data: unknown): void => {
    const handlers = events[event] || [];
    for (const h of handlers) {
      h(data);
    }
  };

  const sock = {
    authState: {
      creds: {
        registered: overrides.registered ?? false,
      },
    },
    ev: {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!events[event]) events[event] = [];
        events[event].push(cb);
      },
      off: (event: string, cb: (...args: unknown[]) => void) => {
        if (events[event]) {
          events[event] = events[event].filter((h) => h !== cb);
        }
      },
      emit: emitEvent,
    },
    onWhatsApp: async (...phones: string[]) => {
      calls.push({ method: "onWhatsApp", args: phones });
      if (overrides.onWhatsAppHandler) {
        return overrides.onWhatsAppHandler(...phones);
      }
      return phones.map((p) => ({
        exists: true,
        jid: `${p.replace(/\D/g, "")}@s.whatsapp.net`,
      }));
    },
    sendPresenceUpdate: async (type: string, toJid?: string) => {
      calls.push({ method: "sendPresenceUpdate", args: [type, toJid] });
      if (overrides.sendPresenceUpdateHandler) {
        return overrides.sendPresenceUpdateHandler(type, toJid);
      }
    },
    sendMessage: async (jid: string, content: AnyMessageContent) => {
      calls.push({ method: "sendMessage", args: [jid, content] });
      if (overrides.sendMessageHandler) {
        return overrides.sendMessageHandler(jid, content);
      }
      return {
        key: {
          id: `mock_msg_${randomUUID()}`,
          remoteJid: jid,
          fromMe: true,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      } as WAMessage;
    },
    requestPairingCode: async (phone: string) => {
      calls.push({ method: "requestPairingCode", args: [phone] });
      if (overrides.requestPairingCodeHandler) {
        return overrides.requestPairingCodeHandler(phone);
      }
      return "1234-5678";
    },
    end: () => {
      calls.push({ method: "end", args: [] });
    },
  } as unknown as WASocket;

  return { sock, calls, events, emitEvent };
}

describe("JID Resolver e Normalizacao do 9º Digito Brasileiro (dispatcher.ts)", () => {
  test("resolveBrazilianPhoneCandidates deve gerar candidatos corretos para numeros de 13 digitos com 9", () => {
    // 55 (11) 98765-4321
    const { canonicalPhone, candidates } = resolveBrazilianPhoneCandidates("5511987654321");
    assert.equal(canonicalPhone, "5511987654321");
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0], "5511987654321"); // Com o 9º digito
    assert.equal(candidates[1], "551187654321");  // Sem o 9º digito (legado Meta)
  });

  test("resolveBrazilianPhoneCandidates deve gerar candidatos corretos para numeros de 12 digitos sem 9", () => {
    // 55 (11) 8765-4321
    const { canonicalPhone, candidates } = resolveBrazilianPhoneCandidates("551187654321");
    assert.equal(canonicalPhone, "5511987654321");
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0], "5511987654321"); // Com o 9º digito
    assert.equal(candidates[1], "551187654321");  // Sem o 9º digito
  });

  test("resolveBrazilianPhoneCandidates deve aceitar formatos com pontuacao e DDD nacional", () => {
    // (11) 98765-4321 sem DDI 55
    const res1 = resolveBrazilianPhoneCandidates("(11) 98765-4321");
    assert.equal(res1.canonicalPhone, "5511987654321");
    assert.deepEqual(res1.candidates, ["5511987654321", "551187654321"]);

    // (21) 8888-7777 (10 digitos)
    const res2 = resolveBrazilianPhoneCandidates("(21) 8888-7777");
    assert.equal(res2.canonicalPhone, "5521988887777");
    assert.deepEqual(res2.candidates, ["5521988887777", "552188887777"]);
  });

  test("resolveBrazilianPhoneCandidates deve manter numeros internacionais intactos", () => {
    const res = resolveBrazilianPhoneCandidates("+1 (202) 555-0199");
    assert.equal(res.canonicalPhone, "12025550199");
    assert.deepEqual(res.candidates, ["12025550199"]);
  });

  test("resolveJid deve resolver JID diretamente se string ja contiver sufixo @s.whatsapp.net", async () => {
    const { sock } = createMockWASocket();
    const result = await resolveJid("5511999998888@s.whatsapp.net", sock);
    assert.equal(result.exists, true);
    assert.equal(result.jid, "5511999998888@s.whatsapp.net");
    assert.equal(result.fromCache, true);
  });

  test("resolveJid deve atualizar JID real Meta no SQLite quando Meta confirmar conta legada de 8 digitos", async () => {
    // Inicializa banco em memoria
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const auditRepo = new AuditLogRepository(db);

    const customer = custRepo.upsert({
      phone: "5511988887777",
      name: "Carlos Teste",
      jid: null,
    });
    assert.equal(customer.jid, null);

    // Mock do WhatsApp Baileys retornando que na Meta o JID ativo e o formato de 8 digitos (551188887777)
    const { sock, calls } = createMockWASocket({
      onWhatsAppHandler: async (...phones: string[]) => {
        // Meta diz que 5511988887777 nao existe, mas 551188887777 existe!
        return [
          { exists: false, jid: "5511988887777@s.whatsapp.net" },
          { exists: true, jid: "551188887777@s.whatsapp.net" },
        ];
      },
    });

    const result = await resolveJid(customer.phone, sock, {
      updateDatabase: true,
      customerRepo: custRepo,
      auditRepo: auditRepo,
    });

    assert.equal(result.exists, true);
    assert.equal(result.jid, "551188887777@s.whatsapp.net");
    assert.equal(result.fromCache, false);

    // Verifica se os candidatos foram testados no Baileys
    const onWaCall = calls.find((c) => c.method === "onWhatsApp");
    assert.ok(onWaCall);
    assert.deepEqual(onWaCall?.args, ["5511988887777", "551188887777"]);

    // Verifica se o JID real da Meta foi persistido no banco SQLite
    const updatedCustomer = custRepo.findById(customer.id);
    assert.equal(updatedCustomer?.jid, "551188887777@s.whatsapp.net");

    // Verifica criacao do log de auditoria
    const logs = auditRepo.listLogs("customers");
    const jidLog = logs.find((l) => l.action === "RESOLVE_JID");
    assert.ok(jidLog, "Audit log de RESOLVE_JID deve existir");

    db.close();
  });

  test("resolveJid deve aproveitar cache local do banco quando cliente ja possui JID cadastrado", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);

    const customer = custRepo.upsert({
      phone: "5511999991111",
      name: "Maria Existente",
      jid: "5511999991111@s.whatsapp.net",
    });

    const { sock, calls } = createMockWASocket();

    const result = await resolveJid(customer.phone, sock, {
      forceRefresh: false,
      customerRepo: custRepo,
    });
    assert.equal(result.exists, true);
    assert.equal(result.jid, "5511999991111@s.whatsapp.net");
    assert.equal(result.fromCache, true);

    // Baileys onWhatsApp nao deve ter sido chamado gracas ao cache SQLite
    assert.equal(calls.length, 0);

    db.close();
  });
});

describe("Simulacao de Presenca Humana e Despacho de Mensagens (dispatcher.ts)", () => {
  test("getRandomDelay deve gerar numeros dentro do intervalo [min, max]", () => {
    for (let i = 0; i < 50; i++) {
      const delay = getRandomDelay(2500, 5000);
      assert.ok(delay >= 2500 && delay <= 5000, `Delay ${delay} fora do range [2500, 5000]`);
    }

    for (let i = 0; i < 50; i++) {
      const audioDelay = getRandomDelay(4000, 7000);
      assert.ok(audioDelay >= 4000 && audioDelay <= 7000, `Audio delay ${audioDelay} fora do range [4000, 7000]`);
    }
  });

  test("simulateTypingPresence deve emitir 'composing' e depois 'paused'", async () => {
    const { sock, calls } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";

    await simulateTypingPresence(sock, jid, { skipPresenceSimulation: true });

    assert.equal(calls.length, 0, "skipPresenceSimulation deve pular chamadas");

    // Com presenca simulada com limites reduzidos para agilidade de teste
    await simulateTypingPresence(sock, jid, {
      minComposingMs: 5,
      maxComposingMs: 10,
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { method: "sendPresenceUpdate", args: ["composing", jid] });
    assert.deepEqual(calls[1], { method: "sendPresenceUpdate", args: ["paused", jid] });
  });

  test("simulateRecordingPresence deve emitir 'recording' e depois 'paused'", async () => {
    const { sock, calls } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";

    await simulateRecordingPresence(sock, jid, {
      minRecordingMs: 5,
      maxRecordingMs: 10,
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { method: "sendPresenceUpdate", args: ["recording", jid] });
    assert.deepEqual(calls[1], { method: "sendPresenceUpdate", args: ["paused", jid] });
  });

  test("sendTextMessage deve enviar mensagem de texto com simulação", async () => {
    const { sock, calls } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";

    const result = await sendTextMessage(sock, jid, "Ola, seu material esta pronto!", {
      skipPresenceSimulation: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.jid, jid);
    assert.ok(result.messageId);

    const sendCall = calls.find((c) => c.method === "sendMessage");
    assert.ok(sendCall);
    assert.equal(sendCall?.args[0], jid);
    assert.deepEqual(sendCall?.args[1], { text: "Ola, seu material esta pronto!" });

    // Testa envio informando apenas o numero telefonico sem o sufixo @s.whatsapp.net
    const resultBare = await sendTextMessage(sock, "5511999998888", "Mensagem para telefone puro", {
      skipPresenceSimulation: true,
    });
    assert.equal(resultBare.success, true);
    assert.equal(resultBare.jid, "5511999998888@s.whatsapp.net");
  });

  test("sendAudioPtt deve enviar audio nativo com mimetype audio/ogg; codecs=opus e ptt: true", async () => {
    const { sock, calls } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";
    const fakeAudioBuffer = Buffer.from("OggS_fake_audio_opus_header");

    const result = await sendAudioPtt(sock, jid, fakeAudioBuffer, {
      skipPresenceSimulation: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.jid, jid);
    assert.ok(result.messageId);

    const sendCall = calls.find((c) => c.method === "sendMessage");
    assert.ok(sendCall);
    assert.equal(sendCall?.args[0], jid);

    const content = sendCall?.args[1] as { audio: Buffer; mimetype: string; ptt: boolean };
    assert.ok(Buffer.isBuffer(content.audio));
    assert.equal(content.mimetype, "audio/ogg; codecs=opus");
    assert.equal(content.ptt, true);
  });

  test("sendAudioPtt deve falhar graciosamente se arquivo de audio nao existir", async () => {
    const { sock } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";

    const result = await sendAudioPtt(sock, jid, "caminho_inexistente_audio.ogg", {
      skipPresenceSimulation: true,
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("nao encontrado"));
  });

  test("sendDocumentMessage deve enviar documento com mimetype especificado e filename", async () => {
    const { sock, calls } = createMockWASocket();
    const jid = "5511999998888@s.whatsapp.net";
    const fakePdfBuffer = Buffer.from("%PDF-1.4 fake pdf data");

    const result = await sendDocumentMessage(
      sock,
      jid,
      fakePdfBuffer,
      "guia_alta_conversao.pdf",
      "application/pdf",
      "Aqui esta o seu PDF!",
      { skipPresenceSimulation: true }
    );

    assert.equal(result.success, true);
    const sendCall = calls.find((c) => c.method === "sendMessage");
    assert.ok(sendCall);

    const content = sendCall?.args[1] as { document: Buffer; mimetype: string; fileName: string; caption?: string };
    assert.ok(Buffer.isBuffer(content.document));
    assert.equal(content.mimetype, "application/pdf");
    assert.equal(content.fileName, "guia_alta_conversao.pdf");
    assert.equal(content.caption, "Aqui esta o seu PDF!");
  });
});

describe("Spintax e Fila de Mensagens (dispatcher.ts)", () => {
  test("resolveSpintax deve alternar variacoes aleatorias e interpolar variaveis", () => {
    const template = "{Ola|Oi|Fala}, *{{first_name}}*! Seu codigo Pix e: {{pix_code}}";
    const res = resolveSpintax(template, {
      first_name: "Deco",
      pix_code: "00020126580014BR.GOV.BCB.PIX",
    });

    assert.ok(res.startsWith("Ola, *Deco*!") || res.startsWith("Oi, *Deco*!") || res.startsWith("Fala, *Deco*!"));
    assert.ok(res.includes("00020126580014BR.GOV.BCB.PIX"));
    assert.ok(!res.includes("{{first_name}}"));
    assert.ok(!res.includes("{{pix_code}}"));
  });

  test("dispatchQueueJob deve transicionar status de job da fila de PENDING -> PROCESSING -> SENT", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const queueRepo = new MessageQueueRepository(db);

    const customer = custRepo.upsert({
      phone: "5511998887766",
      name: "Ana Paula",
      jid: "5511998887766@s.whatsapp.net",
    });

    const job = queueRepo.enqueue({
      customer_id: customer.id,
      phone: customer.phone,
      jid: customer.jid,
      message_type: "TEXT",
      content: "Mensagem da fila indiana",
      scheduled_at: new Date(),
    });

    const { sock } = createMockWASocket();

    const dispatchResult = await dispatchQueueJob(job, sock, {
      skipPresenceSimulation: true,
      queueRepo,
      customerRepo: custRepo,
    });
    assert.equal(dispatchResult.success, true);

    const updatedJob = queueRepo.findById(job.id);
    assert.equal(updatedJob?.status, "SENT");

    db.close();
  });

  test("dispatchQueueJob com AUDIO_PTT e media_path inexistente deve fazer fallback para sendTextMessage, registrar log e marcar SENT", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const queueRepo = new MessageQueueRepository(db);
    const auditRepo = new AuditLogRepository(db);

    const customer = custRepo.upsert({
      phone: "5511991112222",
      name: "Roberta Lima",
      jid: "5511991112222@s.whatsapp.net",
    });

    const job = queueRepo.enqueue({
      customer_id: customer.id,
      phone: customer.phone,
      jid: customer.jid,
      message_type: "AUDIO_PTT",
      content: "Mensagem fallback de audio ausente",
      media_path: "data/media/audio_que_nao_existe_no_disco_12345.ogg",
      scheduled_at: new Date(),
    });

    const { sock, calls } = createMockWASocket();

    const result = await dispatchQueueJob(job, sock, {
      skipPresenceSimulation: true,
      queueRepo,
      customerRepo: custRepo,
      auditRepo,
    });

    assert.equal(result.success, true);

    // Valida que o socket enviou mensagem de texto (fallback) e nao audio
    const sendCalls = calls.filter((c) => c.method === "sendMessage");
    assert.equal(sendCalls.length, 1);
    const sentPayload = sendCalls[0].args[1] as Record<string, unknown>;
    assert.equal(sentPayload.text, "Mensagem fallback de audio ausente");
    assert.equal(sentPayload.audio, undefined);

    // Valida que o job foi marcado como SENT
    const updatedJob = queueRepo.findById(job.id);
    assert.equal(updatedJob?.status, "SENT");

    // Valida que houve registro de auditoria
    const logs = auditRepo.listByEntity("message_queue", job.id);
    assert.ok(logs.length >= 1);
    assert.ok(logs.some((l) => l.action === "MEDIA_MISSING_FALLBACK_TEXT"));

    db.close();
  });

  test("dispatchQueueJob com DOCUMENT e media_path inexistente deve fazer fallback para sendTextMessage, registrar log e marcar SENT", async () => {
    const db = createDatabaseConnection(":memory:");
    const custRepo = new CustomerRepository(db);
    const queueRepo = new MessageQueueRepository(db);
    const auditRepo = new AuditLogRepository(db);

    const customer = custRepo.upsert({
      phone: "5511993334444",
      name: "Diego Marques",
      jid: "5511993334444@s.whatsapp.net",
    });

    const job = queueRepo.enqueue({
      customer_id: customer.id,
      phone: customer.phone,
      jid: customer.jid,
      message_type: "DOCUMENT",
      content: "Mensagem fallback de documento ausente",
      media_path: "data/media/documento_inexistente_99999.pdf",
      scheduled_at: new Date(),
    });

    const { sock, calls } = createMockWASocket();

    const result = await dispatchQueueJob(job, sock, {
      skipPresenceSimulation: true,
      queueRepo,
      customerRepo: custRepo,
      auditRepo,
    });

    assert.equal(result.success, true);

    // Valida que enviou texto e nao documento
    const sendCalls = calls.filter((c) => c.method === "sendMessage");
    assert.equal(sendCalls.length, 1);
    const sentPayload = sendCalls[0].args[1] as Record<string, unknown>;
    assert.equal(sentPayload.text, "Mensagem fallback de documento ausente");
    assert.equal(sentPayload.document, undefined);

    // Valida que o job foi marcado como SENT
    const updatedJob = queueRepo.findById(job.id);
    assert.equal(updatedJob?.status, "SENT");

    // Valida log de auditoria
    const logs = auditRepo.listByEntity("message_queue", job.id);
    assert.ok(logs.some((l) => l.action === "MEDIA_MISSING_FALLBACK_TEXT"));

    db.close();
  });
});

describe("Extracao e Filtragem de Mensagens Inbound (socket.ts)", () => {
  test("extractMessageText deve extrair texto de diferentes tipos de mensagens Baileys", () => {
    const msgConv: WAMessage = {
      key: { id: "1", remoteJid: "551199999@s.whatsapp.net", fromMe: false },
      message: { conversation: "Mensagem direta" },
    };
    assert.equal(extractMessageText(msgConv), "Mensagem direta");

    const msgExtended: WAMessage = {
      key: { id: "2", remoteJid: "551199999@s.whatsapp.net", fromMe: false },
      message: { extendedTextMessage: { text: "Texto formatado com link" } },
    };
    assert.equal(extractMessageText(msgExtended), "Texto formatado com link");

    const msgBtn: WAMessage = {
      key: { id: "3", remoteJid: "551199999@s.whatsapp.net", fromMe: false },
      message: { buttonsResponseMessage: { selectedButtonId: "btn_sim_abrir" } },
    };
    assert.equal(extractMessageText(msgBtn), "btn_sim_abrir");

    const msgEphemeral: WAMessage = {
      key: { id: "4", remoteJid: "551199999@s.whatsapp.net", fromMe: false },
      message: {
        ephemeralMessage: {
          message: {
            conversation: "Texto dentro de mensagem efemera",
          },
        },
      },
    };
    assert.equal(extractMessageText(msgEphemeral), "Texto dentro de mensagem efemera");
  });

  test("WhatsAppSocketManager deve manter estado inicial IDLE e permitir registrar listeners", () => {
    const mgr = new WhatsAppSocketManager();
    assert.equal(mgr.getStatus(), "IDLE");
    assert.equal(mgr.isConnected(), false);
    assert.equal(mgr.getSocket(), null);

    let receivedMessagesCount = 0;
    const unsub = mgr.onMessage((msg) => {
      receivedMessagesCount++;
    });

    assert.equal(typeof unsub, "function");
    unsub();
  });

  test("WhatsAppSocketManager deve gerenciar ciclo de conexao e transicoes de status via connection.update", async () => {
    const mgr = new WhatsAppSocketManager();
    const mockSocketObj = createMockWASocket({ registered: true });

    const statusChanges: string[] = [];
    mgr.onConnectionChange((status) => {
      statusChanges.push(status);
    });

    await mgr.connect({
      socketFactory: () => mockSocketObj.sock,
      authStateLoader: async () => ({
        state: mockSocketObj.sock.authState,
        saveCreds: async () => {},
      }),
      autoReconnect: false,
    });

    assert.equal(mgr.getStatus(), "CONNECTING");

    // Simula conexao aberta
    mockSocketObj.emitEvent("connection.update", { connection: "open" });
    assert.equal(mgr.getStatus(), "CONNECTED");
    assert.equal(mgr.isConnected(), true);

    // Simula desconexao por logout
    mockSocketObj.emitEvent("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: {
          output: { statusCode: 401 },
        },
      },
    });
    assert.equal(mgr.getStatus(), "LOGGED_OUT");

    await mgr.disconnect();
    assert.ok(["DISCONNECTED", "IDLE"].includes(mgr.getStatus()));
  });

  test("WhatsAppSocketManager deve gerenciar estados QR_READY e AUTHENTICATING", async () => {
    const mgr = new WhatsAppSocketManager();
    const mockSocketObj = createMockWASocket({ registered: false });

    await mgr.connect({
      socketFactory: () => mockSocketObj.sock,
      authStateLoader: async () => ({
        state: mockSocketObj.sock.authState,
        saveCreds: async () => {},
      }),
      autoReconnect: false,
    });

    assert.equal(mgr.getStatus(), "CONNECTING");

    // Emissao do QR code pelo Baileys
    mockSocketObj.emitEvent("connection.update", { qr: "mock_qr_string_123" });
    assert.equal(mgr.getStatus(), "QR_READY");
    assert.equal(mgr.getQr(), "mock_qr_string_123");

    // Usuario escaneia e WhatsApp entra em connecting
    mockSocketObj.emitEvent("connection.update", { connection: "connecting" });
    assert.equal(mgr.getStatus(), "AUTHENTICATING");

    // Conexao finalizada com sucesso
    mockSocketObj.sock.user = { id: "5511999998888:1@s.whatsapp.net" } as any;
    mockSocketObj.emitEvent("connection.update", { connection: "open" });
    assert.equal(mgr.getStatus(), "CONNECTED");
    assert.equal(mgr.getConnectedPhone(), "5511999998888");
    assert.equal(mgr.getQr(), null);

    const details = mgr.getConnectionDetails();
    assert.equal(details.status, "CONNECTED");
    assert.equal(details.connected, true);
    assert.equal(details.connected_phone, "5511999998888");

    await mgr.disconnect();
    assert.equal(mgr.getStatus(), "DISCONNECTED");
  });

  test("WhatsAppSocketManager deve tratar restartRequired (515) e connectionReplaced (440)", async () => {
    const mgr = new WhatsAppSocketManager();
    const mockSocketObj = createMockWASocket({ registered: true });

    await mgr.connect({
      socketFactory: () => mockSocketObj.sock,
      authStateLoader: async () => ({
        state: mockSocketObj.sock.authState,
        saveCreds: async () => {},
      }),
      autoReconnect: false,
    });

    // Simula 440 connectionReplaced
    mockSocketObj.emitEvent("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: { output: { statusCode: 440 }, message: "Connection replaced" },
      },
    });
    assert.equal(mgr.getStatus(), "DISCONNECTED");

    // Simula 515 restartRequired
    mockSocketObj.emitEvent("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: { output: { statusCode: 515 }, message: "Restart required" },
      },
    });
    assert.equal(mgr.getStatus(), "RECONNECTING");

    await mgr.disconnect();
  });

  test("WhatsAppSocketManager deve filtrar messages.upsert ignorando fromMe e processando clientes", async () => {
    const mgr = new WhatsAppSocketManager();
    const mockSocketObj = createMockWASocket({ registered: true });

    const received: string[] = [];
    mgr.onMessage((msg) => {
      received.push(`${msg.senderPhone}:${msg.text}`);
    });

    await mgr.connect({
      socketFactory: () => mockSocketObj.sock,
      authStateLoader: async () => ({
        state: mockSocketObj.sock.authState,
        saveCreds: async () => {},
      }),
      autoReconnect: false,
    });

    // Emite mensagem que o proprio bot enviou (fromMe: true) -> deve ser ignorada
    mockSocketObj.emitEvent("messages.upsert", {
      messages: [
        {
          key: { id: "bot_1", remoteJid: "5511999998888@s.whatsapp.net", fromMe: true },
          message: { conversation: "Mensagem enviada por mim" },
        },
      ],
    });
    assert.equal(received.length, 0);

    // Emite mensagem recebida do cliente (fromMe: false) -> deve ser processada
    mockSocketObj.emitEvent("messages.upsert", {
      messages: [
        {
          key: { id: "client_1", remoteJid: "5511988887777@s.whatsapp.net", fromMe: false },
          message: { conversation: "SIM, consegui abrir o PDF!" },
          pushName: "Deco Cliente",
        },
      ],
    });

    assert.equal(received.length, 1);
    assert.equal(received[0], "5511988887777:SIM, consegui abrir o PDF!");

    await mgr.disconnect();
  });

  test("WhatsAppSocketManager deve solicitar Pairing Code no terminal quando nao registrado e telefone configurado", async () => {
    const mgr = new WhatsAppSocketManager();
    const mockSocketObj = createMockWASocket({
      registered: false,
      requestPairingCodeHandler: async (phone: string) => {
        return `PAIR-${phone.slice(-4)}`;
      },
    });

    let receivedCode = "";
    mgr.onPairingCode((code) => {
      receivedCode = code;
    });

    await mgr.connect({
      socketFactory: () => mockSocketObj.sock,
      authStateLoader: async () => ({
        state: mockSocketObj.sock.authState,
        saveCreds: async () => {},
      }),
      pairingPhone: "5511999998888",
      pairingCodeDelayMs: 20,
      autoReconnect: false,
    });

    // Aguarda o disparo do timer do pairing code
    await new Promise((resolve) => setTimeout(resolve, 80));

    const pairingCalls = mockSocketObj.calls.filter((c) => c.method === "requestPairingCode");
    assert.equal(pairingCalls.length, 1);
    assert.equal(pairingCalls[0].args[0], "5511999998888");
    assert.equal(receivedCode, "PAIR-8888");

    await mgr.disconnect();
  });
});
