import * as crypto from "node:crypto";
import { env } from "../config/env.js";
import {
  customerRepository,
  orderRepository,
  auditLogRepository,
  CustomerRepository,
  OrderRepository,
  AuditLogRepository,
  TemplateRepository,
  FunnelTriggerRepository,
  ProjectRepository,
  type Customer,
  type Order,
} from "../database/repositories.js";

/**
 * DTO normalizado para eventos recebidos da Cakto
 */
export interface NormalizedCaktoPayload {
  readonly transactionId: string;
  readonly eventType: string;
  readonly status: string;
  readonly offerType?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly customer: {
    readonly name: string;
    readonly phone: string;
    readonly email?: string | null;
  };
  readonly product: {
    readonly id: string;
    readonly offerId: string;
  };
  readonly pix?: {
    readonly qrCodeText?: string;
    readonly qrCodeUrl?: string;
  };
  readonly paidAt?: string | null;
  readonly rawPayload: Record<string, unknown>;
}

/**
 * Higieniza o telefone para o formato padrão (DDI 55 + DDD + Número)
 */
export function sanitizePhone(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== "string") {
    throw new Error("Invalid phone: phone must be a non-empty string");
  }

  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");

  // Telefones internacionais com sinal de + explicito e sem DDI 55
  if (trimmed.startsWith("+") && !trimmed.startsWith("+55")) {
    if (digits.length < 8) {
      throw new Error(`Invalid international phone "${rawPhone}": too short`);
    }
    return digits;
  }

  // Se não tiver DDI 55 mas tiver 10 ou 11 dígitos nacionais, prefixa 55
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    return `55${digits}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    throw new Error(`Invalid phone number "${rawPhone}": expected between 10 and 15 digits`);
  }

  return digits;
}

/**
 * Calcula assinatura HMAC-SHA256 para payloads de webhook da Cakto
 */
export function computeCaktoHmac(
  payload: string | Record<string, unknown>,
  secret: string = env.caktoWebhookSecret
): string {
  const content = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret.trim()).update(content).digest("hex");
}

export function validateCaktoSignature(raw: Buffer | undefined, timestamp: string | undefined, signature: string | undefined, secret: string): boolean {
  if (!raw || !secret || !timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^v1=[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"));
}

/**
 * Validação segura de secret da Cakto utilizando comparação de tempo constante.
 * Suporta tanto token estático quanto assinatura HMAC-SHA256 do payload.
 */
export function validateCaktoSecret(
  providedSecret: string | undefined | null,
  expectedSecret: string = env.caktoWebhookSecret,
  rawPayload?: unknown
): boolean {
  if (!providedSecret || typeof providedSecret !== "string") {
    return false;
  }
  if (!expectedSecret || typeof expectedSecret !== "string") {
    return false;
  }

  const cleanProvided = providedSecret.trim();
  const cleanExpected = expectedSecret.trim();

  if (cleanProvided.length === 0 || cleanExpected.length === 0) {
    return false;
  }

  // 1. Verificacao direta de segredo estatico (compatibilidade retroativa e testes)
  const bufProvided = Buffer.from(cleanProvided, "utf-8");
  const bufExpected = Buffer.from(cleanExpected, "utf-8");

  if (bufProvided.length === bufExpected.length && crypto.timingSafeEqual(bufProvided, bufExpected)) {
    return true;
  }

  // 2. Verificacao por assinatura HMAC-SHA256
  if (rawPayload) {
    try {
      const hmacHex = computeCaktoHmac(rawPayload as string | Record<string, unknown>, cleanExpected);
      const bufHmac = Buffer.from(hmacHex, "utf-8");
      if (bufProvided.length === bufHmac.length && crypto.timingSafeEqual(bufProvided, bufHmac)) {
        return true;
      }
    } catch {
      // Ignora falha de hash se payload for invalido
    }
  }

  return false;
}

/**
 * Normaliza o tipo de evento recebido da Cakto
 */
export function normalizeEventType(rawEvent: string | undefined | null, rawStatus?: string | null): string {
  const event = String(rawEvent || "").trim().toLowerCase();
  const status = String(rawStatus || "").trim().toLowerCase();

  if (
    event === "purchase_approved" ||
    event === "approved" ||
    event === "paid" ||
    (!event && (status === "approved" || status === "paid"))
  ) {
    return "purchase_approved";
  }

  if (
    event === "checkout_abandonment" ||
    event === "checkout_abandoned" ||
    event === "abandono_checkout" ||
    event === "abandono" ||
    event === "abandonment" ||
    event === "cart_abandonment" ||
    event === "abandoned_cart" ||
    (!event && (status === "abandoned" || status === "checkout_abandonment"))
  ) {
    return "checkout_abandonment";
  }

  if (
    event === "pix_generated" ||
    event === "pix_gerado" ||
    event === "waiting_payment" ||
    (!event && (status === "waiting_payment" || status === "pending"))
  ) {
    return "pix_generated";
  }

  if (event === "boleto_generated" || event === "boleto_gerado" || (!event && status === "boleto_printed")) {
    return "boleto_generated";
  }

  if (
    event === "purchase_refunded" ||
    event === "refund" ||
    event === "refunded" ||
    (!event && status === "refunded")
  ) {
    return "purchase_refunded";
  }

  if (
    event === "chargeback" ||
    (!event && (status === "chargeback" || status === "dispute"))
  ) {
    return "chargeback";
  }

  return event || "unknown_event";
}

export function extractOfferType(data: Record<string, any>, body: Record<string, any>): string {
  const direct =
    data.offer_type ||
    body.offer_type ||
    data.offer?.type ||
    body.offer?.type ||
    data.product_type ||
    body.product_type ||
    data.type ||
    body.type;

  if (typeof direct === "string" && direct.trim()) {
    const lower = direct.trim().toLowerCase();
    if (lower.includes("bump")) return "orderbump";
    if (lower.includes("upsell")) return "upsell";
    if (lower.includes("downsell")) return "downsell";
    if (lower.includes("main") || lower.includes("principal")) return "main";
    return lower;
  }

  const offerName = String(data.offer?.name || body.offer?.name || "").toLowerCase();
  const prodName = String(data.product?.name || body.product?.name || "").toLowerCase();
  if (offerName.includes("upsell") || prodName.includes("upsell")) return "upsell";
  if (offerName.includes("downsell") || prodName.includes("downsell")) return "downsell";
  if (offerName.includes("bump") || prodName.includes("bump")) return "orderbump";

  if (data.is_orderbump || body.is_orderbump || data.is_bump || body.is_bump) return "orderbump";
  if (data.is_upsell || body.is_upsell) return "upsell";

  return "main";
}

export type CaktoEventClassification = "PROBE" | "TEST" | "PRODUCTION" | "AMBIGUOUS";

export interface CaktoClassification {
  readonly category: CaktoEventClassification;
  readonly reason: string;
  readonly isTest: boolean;
  readonly isMultiMethod: boolean;
}

export function isCaktoTestPayload(body: Record<string, any>, data: Record<string, any>): boolean {
  if (body.is_test === true || body.test === true || body.sandbox === true) return true;
  if (data.is_test === true || data.test === true || data.sandbox === true) return true;
  const rawEvt = String(body.event || body.event_type || data.event || data.event_type || "").trim().toLowerCase();
  if (rawEvt === "test") return true;
  if (Boolean(data.card && data.pix && data.boleto && data.picpay)) return true;
  const id = String(data.id || data.transaction_id || body.id || body.transaction_id || "").toLowerCase();
  if (id.startsWith("test_") || id.startsWith("test-") || id.includes("mock") || id.includes("sandbox")) return true;
  return false;
}

export function classifyCaktoWebhook(rawBody: unknown, rawRecords?: Array<Record<string, any> | undefined>): CaktoClassification {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, any>;
  const records: Array<Record<string, any> | undefined> = rawRecords ?? (Array.isArray(body.data) ? body.data : [body.data ?? body]);
  const rawEvent = String(body.event || body.event_type || records[0]?.event || records[0]?.event_type || "").trim().toLowerCase();

  // 1. Verificacao de Conectividade (PROBE)
  const isExplicitPing = rawEvent === "ping";
  const hasNoRecords = records.length === 0;
  const hasNoData = records.every((r) => !r || (
    !r.id && !r.transaction_id && !r.product && !r.product_id &&
    !r.customer && !r.customer_phone && !r.customerCellphone &&
    !r.card && !r.pix && !r.boleto && !r.picpay
  ));

  if (isExplicitPing || hasNoRecords || (hasNoData && (rawEvent === "test" || !rawEvent))) {
    return {
      category: "PROBE",
      reason: isExplicitPing ? "Ping de conectividade explícito." : "Verificação de conectividade sem dados de transação.",
      isTest: true,
      isMultiMethod: false,
    };
  }

  // 2. Evento Oficial de Teste da Cakto (TEST)
  const isMultiMethod = records.some((r) => Boolean(r?.card && r?.pix && r?.boleto && r?.picpay));
  const hasTestFlag = Boolean(
    body.is_test === true || body.test === true || body.sandbox === true ||
    records.some((r) => r?.is_test === true || r?.test === true || r?.sandbox === true)
  );
  const isTestEventName = rawEvent === "test";
  const hasTestTxId = records.some((r) => {
    const id = String(r?.id || r?.transaction_id || "").toLowerCase();
    return id.startsWith("test_") || id.startsWith("test-") || id.includes("mock") || id.includes("sandbox");
  });

  if (isMultiMethod || hasTestFlag || isTestEventName || hasTestTxId) {
    return {
      category: "TEST",
      reason: isMultiMethod
        ? "Payload oficial de teste da Cakto com múltiplos métodos de pagamento simulados."
        : hasTestFlag
        ? "Marcador explícito de teste presente no payload (is_test/sandbox)."
        : isTestEventName
        ? "Evento de teste identificado pelo nome do evento."
        : "Identificador de transação com prefixo de teste.",
      isTest: true,
      isMultiMethod,
    };
  }

  // 3. Verificacao de Integridade Comercial
  const normalized = normalizeEventType(rawEvent);
  const hasValidEvent = Boolean(rawEvent && normalized !== "unknown_event");
  const hasTransaction = records.some((r) => Boolean(r?.id || r?.transaction_id));
  const hasProduct = records.some((r) => Boolean(r?.product?.id || r?.product_id || body.product_id));
  const hasCustomer = records.some((r) => Boolean(
    r?.customer?.phone || r?.customerCellphone || r?.customerPhone || r?.phone ||
    r?.customer?.email || r?.customerEmail || r?.email
  ));

  // Se nao tiver evento valido ou faltar transacao/produto/cliente, retem como AMBIGUOUS
  if (!hasValidEvent || (!hasTransaction && !hasProduct && !hasCustomer)) {
    return {
      category: "AMBIGUOUS",
      reason: !hasValidEvent
        ? "Tipo de evento não identificado ou não suportado."
        : "Ausência conjunta de dados de transação, produto e comprador.",
      isTest: true,
      isMultiMethod: false,
    };
  }

  // 4. Evento Comercial Real (PRODUCTION)
  return {
    category: "PRODUCTION",
    reason: "Evento comercial autêntico com dados de transação e comprador.",
    isTest: false,
    isMultiMethod: false,
  };
}

export function maskSensitivePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const copy = JSON.parse(JSON.stringify(input)) as Record<string, any>;

  function sanitizeNode(node: any) {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const lower = key.toLowerCase();
      if (lower.includes("secret") || lower.includes("password") || lower === "cvv" || lower === "token" || lower === "signature") {
        node[key] = "[REDACTED]";
      } else if (lower === "card" && typeof node[key] === "object" && node[key] !== null) {
        if (node[key].number) {
          const num = String(node[key].number).replace(/\D/g, "");
          node[key].number = num.length >= 4 ? `****${num.slice(-4)}` : "****";
        }
        if (node[key].cvv) node[key].cvv = "***";
      } else if ((lower === "phone" || lower === "cellphone") && typeof node[key] === "string") {
        const digits = node[key].replace(/\D/g, "");
        if (digits.length >= 8) {
          node[key] = `${digits.slice(0, 4)}****${digits.slice(-4)}`;
        }
      } else if (lower === "cpf" && typeof node[key] === "string") {
        node[key] = "***.***.***-**";
      } else if (typeof node[key] === "object") {
        sanitizeNode(node[key]);
      }
    }
  }

  sanitizeNode(copy);
  return copy;
}

/**
 * Normaliza o payload bruto da Cakto para o DTO limpo interno
 */
export function normalizeCaktoWebhook(
  rawBody: unknown,
  options: { isTest?: boolean; defaultProjectId?: string } = {}
): NormalizedCaktoPayload {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new Error("Invalid Cakto payload: body must be a JSON object");
  }

  const body = rawBody as Record<string, any>;
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, any>;
  const isTest = options.isTest || isCaktoTestPayload(body, data);

  // Extrai evento e status
  const rawEvent = body.event || body.event_type || data.event || data.event_type;
  const rawStatus = data.status || body.status || "";
  let eventType = normalizeEventType(rawEvent, rawStatus);
  if (eventType === "unknown_event" && isTest) {
    eventType = "purchase_approved";
  }
  const status = eventType === "checkout_abandonment" ? "ABANDONED"
    : rawStatus ? String(rawStatus).toUpperCase()
    : isTest ? "PAID"
    : String(eventType).toUpperCase();

  // Extrai identificador da transação
  const abandonment = eventType === "checkout_abandonment";
  const abandonmentEmailOrPhone = data.customerEmail || data.customerCellphone || data.customer?.phone || data.customer?.email || body.customer_phone || "";
  const abandonmentOfferId = data.offer?.id || data.product?.id || body.product_id || "";
  const abandonmentDate = data.createdAt || data.created_at || body.created_at || "";
  const abandonmentKey = abandonment
    ? "abandonment_" + crypto.createHash("sha256").update(JSON.stringify([abandonmentEmailOrPhone, abandonmentOfferId, abandonmentDate || Date.now()])).digest("hex")
    : "";

  let rawTxId = String(
    data.id || data.transaction_id || body.id || body.transaction_id || abandonmentKey
  ).trim();

  if (!rawTxId && isTest) {
    rawTxId = `TEST_CAKTO_${crypto.randomBytes(6).toString("hex")}`;
  }

  if (!rawTxId) {
    throw new Error("Invalid Cakto payload: transaction_id is required");
  }

  const transactionId = isTest && !rawTxId.startsWith("TEST_") && !rawTxId.startsWith("test_")
    ? `TEST_${rawTxId}`
    : rawTxId;

  // Extrai dados do cliente
  const rawCustomer = data.customer || body.customer || {};
  const rawCustomerName = String(
    rawCustomer.name || data.customerName || data.customer_name || body.customer_name || data.name || ""
  ).trim();
  const customerName = rawCustomerName || (abandonment ? "Cliente" : isTest ? "Cliente de Teste Cakto" : "");

  if (!customerName) {
    throw new Error("Invalid Cakto payload: customer.name is required");
  }

  let rawPhone = String(
    rawCustomer.phone ||
    rawCustomer.cellphone ||
    data.customerCellphone ||
    data.customerPhone ||
    data.customer_phone ||
    data.phone ||
    data.cellphone ||
    body.customer_phone ||
    body.phone ||
    ""
  ).trim();

  if (!rawPhone && isTest) {
    rawPhone = "5511999999999";
  }

  if (!rawPhone) {
    throw new Error("Invalid Cakto payload: customer.phone is required");
  }

  let customerPhone: string;
  try {
    customerPhone = sanitizePhone(rawPhone);
  } catch (phoneErr) {
    if (isTest) {
      customerPhone = "5511999999999";
    } else {
      throw phoneErr;
    }
  }

  const customerEmail =
    rawCustomer.email || data.customerEmail || data.customer_email || body.customer_email
      ? String(rawCustomer.email || data.customerEmail || data.customer_email || body.customer_email).trim()
      : null;

  // Extrai dados do produto e da oferta
  const rawProduct = data.product || body.product || {};
  const rawOffer = data.offer || body.offer || {};
  let productId = String(
    rawProduct.id || data.product_id || body.product_id || ""
  ).trim();

  if (!productId && isTest) {
    productId = "PROD_TEST";
  }

  if (!productId) {
    throw new Error("Invalid Cakto payload: product.id is required");
  }

  const offerId = String(
    rawOffer.id || data.offer_id || body.offer_id || ""
  ).trim();

  // Extrai dados de Pix (se existirem)
  const rawPix = data.pix || body.pix;
  let pix: { qrCodeText?: string; qrCodeUrl?: string } | undefined;

  if (rawPix && typeof rawPix === "object") {
    pix = {
      qrCodeText: rawPix.qrCode || rawPix.qr_code_text || rawPix.qrcode_text || rawPix.copy_paste || rawPix.code || undefined,
      qrCodeUrl: rawPix.qr_code_url || rawPix.qrcode_url || rawPix.url || undefined,
    };
  } else if (data.pix_code || body.pix_code || data.pix_qr_code || body.pix_qr_code) {
    pix = {
      qrCodeText: data.pix_code || body.pix_code || data.pix_qr_code || body.pix_qr_code || undefined,
      qrCodeUrl: data.pix_url || body.pix_url || undefined,
    };
  }

  // Extrai valor da transacao
  let amount: number | undefined;
  if (typeof data.amount === "number" && Number.isFinite(data.amount)) {
    amount = data.amount;
  } else if (typeof data.card?.amount === "number") {
    amount = data.card.amount;
  } else if (typeof data.pix?.amount === "number") {
    amount = data.pix.amount;
  } else if (typeof data.boleto?.amount === "number") {
    amount = data.boleto.amount;
  } else if (isTest) {
    amount = 97;
  }

  // Data de pagamento
  const paidAt = data.paidAt || data.paid_at || body.paid_at || null;
  const { secret: _secret, ...payload } = body;
  const { secret: _nestedSecret, ...payloadData } = data;

  return {
    transactionId,
    eventType,
    status,
    offerType: extractOfferType(data, body),
    amount,
    currency: typeof data.currency === "string" ? data.currency : "BRL",
    customer: {
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
    },
    product: {
      id: productId,
      offerId,
    },
    pix,
    paidAt: paidAt ? String(paidAt) : null,
    rawPayload: data === body ? payload : { ...payload, data: payloadData },
  };
}

export interface ProcessWebhookResult {
  readonly customer: Customer;
  readonly order: Order;
  readonly isDuplicate: boolean;
}

export interface ProcessWebhookRepositories {
  readonly customerRepo?: CustomerRepository;
  readonly customers?: CustomerRepository;
  readonly orderRepo?: OrderRepository;
  readonly orders?: OrderRepository;
  readonly auditRepo?: AuditLogRepository;
  readonly auditLogs?: AuditLogRepository;
  readonly templateRepo?: TemplateRepository;
  readonly templates?: TemplateRepository;
  readonly funnelTriggers?: FunnelTriggerRepository;
  readonly projectRepo?: ProjectRepository;
  readonly projects?: ProjectRepository;
}

/**
 * Persiste o payload normalizado no banco SQLite com garantia de idempotência estrita
 */
export function processNormalizedWebhook(
  payload: NormalizedCaktoPayload,
  repos: ProcessWebhookRepositories = {},
  projectId?: string,
  options: { isTest?: boolean } = {}
): ProcessWebhookResult {
  const custRepo = repos.customers ?? repos.customerRepo ?? customerRepository;
  const ordRepo = repos.orders ?? repos.orderRepo ?? orderRepository;
  const audRepo = repos.auditLogs ?? repos.auditRepo ?? auditLogRepository;
  const targetProjectId = projectId || "default";
  const duplicate = ordRepo.findByTransactionAndEvent(payload.transactionId, payload.eventType, targetProjectId);
  if (duplicate) {
    const customer = custRepo.findById(duplicate.customer_id);
    if (!customer || customer.project_id !== targetProjectId) throw new Error("Pedido com vínculo de cliente inconsistente.");
    audRepo.log("CAKTO_WEBHOOK", "DUPLICATE_IGNORED", "orders", duplicate.id, { transactionId: payload.transactionId, isDuplicate: true });
    return { customer, order: duplicate, isDuplicate: true };
  }

  // 1. Upsert do cliente por telefone
  const customer = custRepo.upsert({
    phone: payload.customer.phone,
    name: payload.customer.name,
    email: payload.customer.email,
    project_id: targetProjectId,
  });

  // 2. Registro do pedido com idempotencia por UNIQUE(transaction_id, event_type)
  const { order, inserted } = ordRepo.createOrIgnore({
    transaction_id: payload.transactionId,
    customer_id: customer.id,
    product_id: payload.product.id,
    offer_id: payload.product.offerId,
    event_type: payload.eventType,
    status: payload.status,
    paid_at: payload.paidAt,
    raw_payload: payload.rawPayload,
    project_id: targetProjectId,
    is_test: options.isTest ? 1 : 0,
  });

  // 3. Auditoria do evento
  audRepo.log(
    "CAKTO_WEBHOOK",
    inserted ? "ORDER_RECORDED" : "DUPLICATE_IGNORED",
    "orders",
    order.id,
    {
      transactionId: payload.transactionId,
      eventType: payload.eventType,
      status: payload.status,
      customerId: customer.id,
      isDuplicate: !inserted,
    }
  );

  return {
    customer,
    order,
    isDuplicate: !inserted,
  };
}
