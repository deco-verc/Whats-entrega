import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {
  env,
  ensureDataDirectoriesExist,
  initSqliteDatabase,
  validatePort,
  validateNodeEnv,
  validateLogLevel,
  validateCaktoSecret,
  validatePairingPhone,
  validateEnvConfig,
} from "../src/config/env.js";
import {
  CATALOG,
  getProductByType,
  getProductById,
  getProductByOfferId,
  getOfferById,
  isMainProduct,
  getAllProducts,
} from "../src/config/catalog.js";

describe("Configuracao Base e Variaveis de Ambiente (env.ts)", () => {
  test("deve validar e expor a porta HTTP dentro da faixa segura (PORT_GUARD)", () => {
    assert.equal(typeof env.port, "number");
    assert.ok(env.port >= 4000 && env.port <= 4999, "Porta deve estar na faixa 4000-4999");
  });

  test("deve expor caminhos corretos de persistencia de dados", () => {
    assert.ok(env.paths.dataDir.includes("data"));
    assert.ok(env.paths.authInfoDir.includes("auth_info"));
    assert.ok(env.paths.databaseDir.includes("database"));
    assert.ok(env.paths.databaseFile.endsWith("funnel.db"));
    assert.ok(env.paths.mediaDir.includes("media"));
  });

  test("deve garantir criacao fisica dos diretorios de persistencia em disco", () => {
    ensureDataDirectoriesExist(env.paths);
    assert.ok(fs.existsSync(env.paths.dataDir), "dataDir deve existir");
    assert.ok(fs.existsSync(env.paths.authInfoDir), "authInfoDir deve existir");
    assert.ok(fs.existsSync(env.paths.databaseDir), "databaseDir deve existir");
    assert.ok(fs.existsSync(env.paths.mediaDir), "mediaDir deve existir");
  });

  test("deve inicializar e validar mecanismo de persistencia SQLite em modo WAL", () => {
    const db = initSqliteDatabase(env.paths.databaseFile);
    assert.ok(db, "Conexao SQLite deve ser instanciada com sucesso");
    const journalMode = db.pragma("journal_mode", { simple: true });
    assert.equal(journalMode, "wal", "SQLite deve estar operando em modo WAL");
    db.close();
    assert.ok(fs.existsSync(env.paths.databaseFile), "Arquivo SQLite funnel.db deve existir fisicamente no disco");
  });

  test("deve conter configuracao do secret da Cakto e telefone de pareamento", () => {
    assert.equal(typeof env.caktoWebhookSecret, "string");
    assert.ok(env.caktoWebhookSecret.length > 0);
    assert.equal(typeof env.whatsappPairingPhone, "string");
  });

  test("deve aplicar fail-fast rigoroso para portas invalidas e reservadas (PORT_GUARD)", () => {
    assert.throws(() => validatePort(3000), /PORT 3000 is strictly forbidden/);
    assert.throws(() => validatePort(3001), /PORT 3001 is strictly forbidden/);
    assert.throws(() => validatePort(5173), /PORT 5173 is strictly forbidden/);
    assert.throws(() => validatePort(2000), /out of safe range/);
    assert.throws(() => validatePort(8080), /out of safe range/);
    assert.throws(() => validatePort("abc"), /must be a valid integer/);
    assert.equal(validatePort(4005), 4005);
  });

  test("deve aplicar fail-fast para secret ausente em ambiente de producao", () => {
    assert.throws(
      () => validateCaktoSecret("", true),
      /CAKTO_WEBHOOK_SECRET in production/
    );
    assert.equal(validateCaktoSecret("", false), "dev_cakto_webhook_secret");
    assert.equal(validateCaktoSecret("secret_prod_123", true), "secret_prod_123");
  });

  test("deve validar formato numerico do telefone de pareamento WhatsApp", () => {
    assert.throws(() => validatePairingPhone("123"), /Invalid WHATSAPP_PAIRING_PHONE/);
    assert.throws(() => validatePairingPhone("12345678901234567"), /Invalid WHATSAPP_PAIRING_PHONE/);
    assert.equal(validatePairingPhone("+55 (11) 99999-8888"), "5511999998888");
  });

  test("deve garantir arquivo .env.example provisionado e documentando todas as variaveis", () => {
    assert.ok(fs.existsSync(".env.example"), ".env.example deve existir na raiz do projeto");
    const exampleContent = fs.readFileSync(".env.example", "utf-8");
    const requiredKeys = [
      "PORT",
      "HOST",
      "NODE_ENV",
      "LOG_LEVEL",
      "CAKTO_WEBHOOK_SECRET",
      "WHATSAPP_PAIRING_PHONE",
      "DATA_DIR",
      "AUTH_INFO_DIR",
      "DATABASE_DIR",
      "DATABASE_FILE",
      "MEDIA_DIR",
    ];
    for (const key of requiredKeys) {
      assert.ok(
        exampleContent.includes(`${key}=`),
        `Chave ${key} deve estar documentada no .env.example`
      );
    }
  });
});

describe("Catalogo Declarativo de Produtos e Ofertas Cakto (catalog.ts)", () => {
  test("deve conter os 4 tipos obrigatorios de produtos (MAIN, UPSELL_1, UPSELL_2, DOWNSELL)", () => {
    const products = getAllProducts();
    assert.equal(products.length, 4);

    const types = products.map((p) => p.type);
    assert.ok(types.includes("MAIN"));
    assert.ok(types.includes("UPSELL_1"));
    assert.ok(types.includes("UPSELL_2"));
    assert.ok(types.includes("DOWNSELL"));
  });

  test("produto MAIN deve conter PDF de entrega, pergunta de micro-comprometimento e recuperacao PIX", () => {
    const main = getProductByType("MAIN");
    assert.ok(main, "MAIN deve estar configurado");
    assert.equal(main.type, "MAIN");

    assert.ok(main.delivery.mediaFiles.length > 0, "MAIN deve ter midias de entrega");
    assert.equal(main.delivery.mediaFiles[0].type, "document");
    assert.ok(main.delivery.mediaFiles[0].fileName.endsWith(".pdf"));

    assert.ok(
      typeof main.delivery.microCommitmentQuestion === "string" &&
        main.delivery.microCommitmentQuestion.length > 0,
      "MAIN deve ter pergunta de micro-comprometimento"
    );

    assert.ok(main.pixRecovery, "MAIN deve ter configuracao de PIX recovery");
    assert.equal(main.pixRecovery.delaySeconds, 420, "PIX recovery deve ser 7 minutos (420s)");
    assert.ok(main.pixRecovery.messagesSpintax.length > 0);

    assert.ok(main.nextSteps.length > 0, "MAIN deve apontar para UPSELL_1");
    assert.equal(main.nextSteps[0].targetType, "UPSELL_1");
    assert.equal(main.nextSteps[0].delaySeconds, 900, "Delay padrao deve ser 15 minutos (900s)");
    assert.equal(main.nextSteps[0].accelerateOnReply, true);
  });

  test("produto UPSELL_1 deve conter audio PTT, delay para UPSELL_2 e downsell configurado", () => {
    const upsell1 = getProductByType("UPSELL_1");
    assert.ok(upsell1, "UPSELL_1 deve existir");
    assert.ok(upsell1.pitch, "UPSELL_1 deve ter configuracao de pitch");
    assert.ok(upsell1.pitch.audioFileName?.endsWith(".ogg"), "Pitch deve ter audio .ogg");
    assert.ok(upsell1.pitch.checkoutUrl.startsWith("http"));

    assert.ok(upsell1.downsellStep, "UPSELL_1 deve ter step de downsell");
    assert.equal(upsell1.downsellStep.targetType, "DOWNSELL");
    assert.equal(upsell1.downsellStep.delaySeconds, 7200, "Downsell deve aguardar 2 horas");
  });

  test("produto UPSELL_2 deve conter audio PTT e link de checkout da masterclass", () => {
    const upsell2 = getProductByType("UPSELL_2");
    assert.ok(upsell2, "UPSELL_2 deve existir");
    assert.ok(upsell2.pitch?.audioFileName?.endsWith(".ogg"));
    assert.ok(upsell2.delivery.mediaFiles.length > 0);
  });

  test("produto DOWNSELL deve conter audio PTT, oferta de menor ticket e entrega de templates essenciais", () => {
    const downsell = getProductByType("DOWNSELL");
    assert.ok(downsell, "DOWNSELL deve existir");
    assert.ok(downsell.pitch?.audioFileName?.endsWith(".ogg"));
    assert.ok(downsell.delivery.mediaFiles.length > 0);
    assert.ok(downsell.offers[downsell.defaultOfferId].priceCents < 5000);
  });

  test("funcoes utilitarias de busca devem localizar produtos e ofertas corretamente", () => {
    const mainByProdId = getProductById("prod_main_01");
    assert.equal(mainByProdId?.type, "MAIN");

    const mainByOfferId = getProductByOfferId("off_main_full");
    assert.equal(mainByOfferId?.type, "MAIN");

    const offer = getOfferById("off_main_full");
    assert.ok(offer);
    assert.equal(offer.priceCents, 9700);

    assert.equal(isMainProduct("prod_main_01"), true);
    assert.equal(isMainProduct("off_main_full"), true);
    assert.equal(isMainProduct("prod_upsell_01"), false);
  });

  test("catalogo deve suportar scripts de alta conversao com tags dinamicas e spintax", () => {
    const main = getProductByType("MAIN");
    assert.equal(main.pixRecovery?.messagesSpintax.length, 2);
    assert.ok(main.pixRecovery?.messagesSpintax[1].includes("pix_copia_cola"));

    const upsell1 = getProductByType("UPSELL_1");
    assert.equal(upsell1.offers[upsell1.defaultOfferId].priceCents, 6700);

    const downsell = getProductByType("DOWNSELL");
    assert.equal(downsell.offers[downsell.defaultOfferId].priceCents, 2990);
  });
});
