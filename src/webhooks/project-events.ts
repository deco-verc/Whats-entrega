import type { NormalizedCaktoPayload, ProcessWebhookRepositories } from "./adapters.js";
import { maskSensitivePayload, processNormalizedWebhook } from "./adapters.js";
import type { Project, Repositories } from "../database/repositories.js";
import { FunnelStateMachine } from "../engine/state-machine.js";
import { scheduleProjectAutomations } from "../engine/project-automations.js";

export function linkedProducts(repos: Repositories, project: Project): string[] {
  const metadata = repos.db.prepare("SELECT additional_products_json FROM project_workspace WHERE project_id = ?")
    .get(project.id) as { additional_products_json: string } | undefined;
  return [project.cakto_product_id, ...JSON.parse(metadata?.additional_products_json ?? "[]")].filter(Boolean);
}

export function processProjectEvent(
  repos: Repositories, project: Project, event: NormalizedCaktoPayload, legacyOverrides?: ProcessWebhookRepositories,
  simulation = false
) {
  const result = processNormalizedWebhook(event, {
    customerRepo: repos.customers, orderRepo: repos.orders, auditRepo: repos.auditLogs, ...legacyOverrides,
  }, project.id);
  if (result.isDuplicate || !project.is_active) return { ...result, evaluations: [], canonical: null };

  const machine = new FunnelStateMachine(repos);
  const data = {
    transactionId: event.transactionId, phone: event.customer.phone, name: event.customer.name,
    email: event.customer.email, productId: event.product.id, offerId: event.product.offerId,
    rawPayload: event.rawPayload, allowExistingOrder: true, projectId: project.id,
  };
  let canonical = null;
  if (event.eventType === "purchase_approved" && event.offerType !== "orderbump") {
    const productType = event.offerType === "downsell" ? "DOWNSELL" : event.offerType === "upsell" ? "UPSELL_1" : undefined;
    canonical = machine.handlePurchaseApproved({ ...data, paidAt: event.paidAt, productType });
  } else if (event.eventType === "pix_generated" && event.pix?.qrCodeText) {
    canonical = machine.handlePixGenerated({ ...data, pixCode: event.pix.qrCodeText });
  } else if (event.eventType === "purchase_refunded" || event.eventType === "chargeback") {
    canonical = machine.handleRefund({ ...data, customerId: result.customer.id, recordOrder: false });
  }
  const currentCustomer = repos.customers.findById(result.customer.id) ?? result.customer;
  const evaluations = scheduleProjectAutomations(repos, project, event, currentCustomer, result.order, simulation);
  return { ...result, evaluations, canonical };
}

export function logWebhook(
  repos: Repositories,
  projectId: string,
  authenticated: boolean,
  result: string,
  event?: NormalizedCaktoPayload,
  details?: string,
  rawPayload?: unknown,
  isTest = false
) {
  const redacted = rawPayload
    ? maskSensitivePayload(rawPayload)
    : event
    ? {
        event: event.eventType,
        data: {
          id: event.transactionId,
          status: event.status,
          product: { id: event.product.id },
          offer: { id: event.product.offerId },
          offer_type: event.offerType,
          paidAt: event.paidAt,
          customer: "[mascarado]",
        },
      }
    : null;
  repos.db
    .prepare(`
    INSERT INTO webhook_events (project_id, authenticated, result, event_type, product_id, transaction_id, details, payload_json, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      projectId,
      Number(authenticated),
      result,
      event?.eventType ?? null,
      event?.product.id ?? null,
      event?.transactionId ?? null,
      details ?? null,
      redacted ? JSON.stringify(redacted) : null,
      Number(isTest)
    );
}
