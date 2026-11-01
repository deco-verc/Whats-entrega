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
 * Validação segura de secret da Cakto utilizando comparação de tempo constante
 */
export function validateCaktoSecret(
  providedSecret: string | undefined | null,
  expectedSecret: string = env.caktoWebhookSecret
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

  const bufProvided = Buffer.from(cleanProvided, "utf-8");
  const bufExpected = Buffer.from(cleanExpected, "utf-8");

  if (bufProvided.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufProvided, bufExpected);
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
    status === "approved" ||
    status === "paid"
  ) {
    return "purchase_approved";
  }

  if (
    event === "pix_generated" ||
    event === "waiting_payment" ||
    status === "waiting_payment" ||
    status === "pending"
  ) {
    return "pix_generated";
  }

  if (event === "boleto_generated" || status === "boleto_printed") {
    return "boleto_generated";
  }

  if (
    event === "purchase_refunded" ||
    event === "refunded" ||
    status === "refunded"
  ) {
    return "purchase_refunded";
  }

  if (
    event === "chargeback" ||
    status === "chargeback" ||
    status === "dispute"
  ) {
    return "chargeback";
  }

  return event || "unknown_event";
}

/**
 * Normaliza o payload bruto da Cakto para o DTO limpo interno
 */
export function normalizeCaktoWebhook(rawBody: unknown): NormalizedCaktoPayload {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new Error("Invalid Cakto payload: body must be a JSON object");
  }

  const body = rawBody as Record<string, any>;
  const data = (body.data && typeof body.data === "object" ? body.data : body) as Record<string, any>;

  // Extrai identificador da transação
  const transactionId = String(
    data.id || data.transaction_id || body.id || body.transaction_id || ""
  ).trim();

  if (!transactionId) {
    throw new Error("Invalid Cakto payload: transaction_id is required");
  }

  // Extrai evento e status
  const rawEvent = body.event || body.event_type || data.event || data.event_type;
  const rawStatus = data.status || body.status || "";
  const eventType = normalizeEventType(rawEvent, rawStatus);
  const status = String(rawStatus || eventType).toUpperCase();

  // Extrai dados do cliente
  const rawCustomer = data.customer || body.customer || {};
  const customerName = String(
    rawCustomer.name || data.customer_name || body.customer_name || ""
  ).trim();

  if (!customerName) {
    throw new Error("Invalid Cakto payload: customer.name is required");
  }

  const rawPhone = String(
    rawCustomer.phone ||
    rawCustomer.cellphone ||
    data.customer_phone ||
    body.customer_phone ||
    ""
  ).trim();

  if (!rawPhone) {
    throw new Error("Invalid Cakto payload: customer.phone is required");
  }

  const customerPhone = sanitizePhone(rawPhone);
  const customerEmail =
    rawCustomer.email || data.customer_email || body.customer_email
      ? String(rawCustomer.email || data.customer_email || body.customer_email).trim()
      : null;

  // Extrai dados do produto e da oferta
  const rawProduct = data.product || body.product || {};
  const rawOffer = data.offer || body.offer || {};
  const productId = String(
    rawProduct.id || data.product_id || body.product_id || ""
  ).trim();

  if (!productId) {
    throw new Error("Invalid Cakto payload: product.id is required");
  }

  const offerId = String(
    rawOffer.id || data.offer_id || body.offer_id || `${productId}_default`
  ).trim();

  // Extrai dados de Pix (se existirem)
  const rawPix = data.pix || body.pix;
  let pix: { qrCodeText?: string; qrCodeUrl?: string } | undefined;

  if (rawPix && typeof rawPix === "object") {
    pix = {
      qrCodeText: rawPix.qr_code_text || rawPix.qrcode_text || rawPix.copy_paste || rawPix.code || undefined,
      qrCodeUrl: rawPix.qr_code_url || rawPix.qrcode_url || rawPix.url || undefined,
    };
  } else if (data.pix_code || body.pix_code || data.pix_qr_code || body.pix_qr_code) {
    pix = {
      qrCodeText: data.pix_code || body.pix_code || data.pix_qr_code || body.pix_qr_code || undefined,
      qrCodeUrl: data.pix_url || body.pix_url || undefined,
    };
  }

  // Data de pagamento
  const paidAt = data.paid_at || body.paid_at || (eventType === "purchase_approved" ? new Date().toISOString() : null);

  return {
    transactionId,
    eventType,
    status,
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
    rawPayload: body,
  };
}

export interface ProcessWebhookResult {
  readonly customer: Customer;
  readonly order: Order;
  readonly isDuplicate: boolean;
}

export interface ProcessWebhookRepositories {
  readonly customerRepo?: CustomerRepository;
  readonly orderRepo?: OrderRepository;
  readonly auditRepo?: AuditLogRepository;
  readonly templateRepo?: TemplateRepository;
}

/**
 * Persiste o payload normalizado no banco SQLite com garantia de idempotência estrita
 */
export function processNormalizedWebhook(
  payload: NormalizedCaktoPayload,
  repos: ProcessWebhookRepositories = {}
): ProcessWebhookResult {
  const custRepo = repos.customerRepo ?? customerRepository;
  const ordRepo = repos.orderRepo ?? orderRepository;
  const audRepo = repos.auditRepo ?? auditLogRepository;

  // 1. Upsert do cliente por telefone
  const customer = custRepo.upsert({
    phone: payload.customer.phone,
    name: payload.customer.name,
    email: payload.customer.email,
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
