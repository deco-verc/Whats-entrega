import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  createDatabaseConnection,
  applySchema,
} from "../src/database/connection.js";
import {
  createRepositories,
  Repositories,
} from "../src/database/repositories.js";
import { createWebhookApp } from "../src/webhooks/server.js";
import { env } from "../src/config/env.js";

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
          id: `msg_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

describe("Modulo de Disparo Rapido Manual (POST /api/messages/manual-send)", () => {
  let db: Database.Database;
  let repos: Repositories;
  let mockSocket: WASocket;
  let testAudioPath: string;
  let testDocPath: string;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    applySchema(db);
    repos = createRepositories(db);
    mockSocket = createMockSocket();

    // Cria arquivos de teste temporarios de midia
    testAudioPath = path.resolve(env.paths.mediaDir, "test_manual_audio.ogg");
    testDocPath = path.resolve(env.paths.mediaDir, "test_manual_doc.pdf");

    if (!fs.existsSync(env.paths.mediaDir)) {
      fs.mkdirSync(env.paths.mediaDir, { recursive: true });
    }
    fs.writeFileSync(testAudioPath, Buffer.from("OggS_mock_audio_content"));
    fs.writeFileSync(testDocPath, Buffer.from("%PDF-1.4 mock document content"));
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
    try {
      if (fs.existsSync(testAudioPath)) fs.unlinkSync(testAudioPath);
      if (fs.existsSync(testDocPath)) fs.unlinkSync(testDocPath);
    } catch {
      // Ignora falhas de remocao de arquivos temporarios de teste
    }
  });

  test("deve retornar 400 Bad Request se telefone estiver ausente ou for invalido", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: {
        customerRepo: repos.customers,
        orderRepo: repos.orders,
        auditRepo: repos.auditLogs,
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. Sem telefone
      const res1 = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "text",
          message: "Ola mundo",
        }),
      });
      assert.equal(res1.status, 400);
      const json1 = await res1.json() as any;
      assert.equal(json1.error, "ValidationError");

      // 2. Telefone invalido (< 10 digitos)
      const res2 = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "12345",
          type: "text",
          message: "Ola mundo",
        }),
      });
      assert.equal(res2.status, 400);
      const json2 = await res2.json() as any;
      assert.equal(json2.error, "ValidationError");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve retornar 400 Bad Request se tipo de mensagem for invalido", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "invalid_type",
          message: "Teste",
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json() as any;
      assert.equal(json.error, "ValidationError");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve retornar 400 Bad Request se message estiver vazia para tipo text", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "text",
          message: "   ",
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json() as any;
      assert.equal(json.error, "ValidationError");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve retornar 400 Bad Request se mediaPath estiver ausente para tipo audio_ptt ou document", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Audio sem mediaPath
      const resAudio = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "audio_ptt",
        }),
      });
      assert.equal(resAudio.status, 400);

      // Documento sem mediaPath
      const resDoc = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "document",
        }),
      });
      assert.equal(resDoc.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve retornar 503 se socket WhatsApp nao estiver conectado", async () => {
    const app = createWebhookApp({
      sock: null,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "text",
          message: "Teste offline",
        }),
      });
      assert.equal(res.status, 503);
      const json = await res.json() as any;
      assert.equal(json.success, false);
      assert.ok(json.error.includes("socket nao esta conectado"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve enviar mensagem de texto manual com sucesso (200 OK) quando socket estiver conectado", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: {
        customerRepo: repos.customers,
        auditRepo: repos.auditLogs,
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "text",
          message: "Ola! Mensagem de teste de envio rapido manual.",
          skipSimulation: true,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.ok(json.messageId.startsWith("msg_manual_"));
      assert.equal(json.phone, "5511988887777");
      assert.equal(json.type, "text");
      assert.ok(typeof json.durationMs === "number");
      assert.ok(json.sentAt);

      // Verifica envio no socket
      const sent = (mockSocket as any)._sent;
      assert.equal(sent.length, 1);
      assert.equal(sent[0].content.text, "Ola! Mensagem de teste de envio rapido manual.");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve enviar audio PTT manual com sucesso (200 OK) quando arquivo existir e socket estiver conectado", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "audio_ptt",
          mediaPath: testAudioPath,
          skipSimulation: true,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.equal(json.type, "audio_ptt");

      // Verifica envio no socket
      const sent = (mockSocket as any)._sent;
      assert.equal(sent.length, 1);
      assert.equal(sent[0].content.ptt, true);
      assert.equal(sent[0].content.mimetype, "audio/ogg; codecs=opus");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve enviar documento PDF manual com sucesso (200 OK) quando arquivo existir e socket estiver conectado", async () => {
    const app = createWebhookApp({
      sock: mockSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "document",
          mediaPath: testDocPath,
          fileName: "Manual-de-Instrucoes.pdf",
          caption: "Segue o manual em anexo",
          skipSimulation: true,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.success, true);
      assert.equal(json.type, "document");

      // Verifica envio no socket
      const sent = (mockSocket as any)._sent;
      assert.equal(sent.length, 1);
      assert.equal(sent[0].content.fileName, "Manual-de-Instrucoes.pdf");
      assert.equal(sent[0].content.caption, "Segue o manual em anexo");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve retornar 500 se o socket Baileys falhar no envio", async () => {
    const failingSocket = createMockSocket({
      shouldFail: true,
      errorMessage: "Connection dropped by peer",
    });

    const app = createWebhookApp({
      sock: failingSocket,
      repositories: { customerRepo: repos.customers },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/messages/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: "11988887777",
          type: "text",
          message: "Teste falha",
          skipSimulation: true,
        }),
      });

      assert.equal(res.status, 500);
      const json = await res.json() as any;
      assert.equal(json.success, false);
      assert.ok(json.error.includes("Connection dropped by peer"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve servir public/manual-send.html com status 200 e tipo text/html", async () => {
    const app = createWebhookApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/manual-send.html`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/html"));
      const html = await res.text();
      assert.ok(html.includes("Disparo Rapido Manual"));
      assert.ok(html.includes("manual-send-form"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("deve exportar router em src/routes/manual-send.ts com suporte a createManualSendRouter", async () => {
    const { createManualSendRouter, handleManualSend } = await import("../src/routes/manual-send.js");
    assert.equal(typeof createManualSendRouter, "function");
    assert.equal(typeof handleManualSend, "function");
    const router = createManualSendRouter({ sock: mockSocket });
    assert.ok(router);
  });
});
