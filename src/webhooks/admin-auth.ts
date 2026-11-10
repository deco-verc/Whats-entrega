import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function protectAdministration(
  credentials: { username: string; password: string } | undefined,
  required: boolean
): RequestHandler {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = credentials && digest(`${credentials.username}:${credentials.password}`);

  return (req, res, next) => {
    const publicHealth = /^(?:\/api)?\/health\/?$/i.test(req.path) && ["GET", "HEAD"].includes(req.method);
    const publicWebhook = /^(?:\/api)?\/webhook\/cakto(?:\/[^/]+)?\/?$/i.test(req.path);
    if (publicHealth || publicWebhook) return next();

    res.set("Cache-Control", "no-store");
    if (!required) return next();

    if (!expected) {
      res.status(503).json({ error: "Configure as credenciais administrativas do painel." });
      return;
    }
    const authorization = req.get("Authorization")?.match(/^Basic ([A-Za-z0-9+/]+=*)$/i)?.[1];
    if (!authorization || !timingSafeEqual(digest(Buffer.from(authorization, "base64").toString()), expected)) {
      res.set("WWW-Authenticate", 'Basic realm="WhatsAppEntrega", charset="UTF-8"');
      res.status(401).json({ error: "Autenticação administrativa obrigatória." });
      return;
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        (["cross-site", "same-site"].includes(req.get("Sec-Fetch-Site") ?? "") ||
          (req.get("Origin") && !req.is(["application/json", "application/octet-stream"])))) {
      res.status(403).json({ error: "Origem ou formato da solicitação administrativa inválido." });
      return;
    }
    next();
  };
}
