import { Router, Request, Response } from "express";
import { getDatabase } from "../database/connection.js";
import {
  FunnelTriggerRepository,
  type FunnelTrigger,
} from "../database/repositories.js";

export interface TriggersRouterOptions {
  triggerRepo?: FunnelTriggerRepository;
}

export function createTriggersRouter(options: TriggersRouterOptions = {}): Router {
  const router = Router();

  const getRepo = () => {
    return options.triggerRepo ?? new FunnelTriggerRepository(getDatabase());
  };

  // GET /api/triggers - Listar gatilhos por projeto (com auto-seed se vazio)
  router.get("/", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const projectId = (req.query.project_id as string)?.trim() || "default";

      let triggers = repo.listByProject(projectId);
      if (triggers.length === 0 && projectId !== "all") {
        repo.seedDefaultTriggers(projectId);
        triggers = repo.listByProject(projectId);
      }

      res.status(200).json({
        success: true,
        project_id: projectId,
        total: triggers.length,
        triggers,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao listar gatilhos", details: message });
    }
  });

  // GET /api/triggers/:id - Obter detalhes de um gatilho
  router.get("/:id", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);
      const trigger = repo.findById(id);
      if (!trigger) {
        res.status(404).json({ error: "Gatilho nao encontrado" });
        return;
      }
      res.status(200).json({ success: true, trigger });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao buscar gatilho", details: message });
    }
  });

  // POST /api/triggers - Criar novo gatilho customizado
  router.post("/", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const { project_id, trigger_key, name, event_type, is_active, delay_seconds, template_id, media_path } = req.body ?? {};

      if (!trigger_key || typeof trigger_key !== "string" || !trigger_key.trim()) {
        res.status(400).json({ error: "Campo 'trigger_key' e obrigatorio" });
        return;
      }
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Campo 'name' e obrigatorio" });
        return;
      }

      const created = repo.create({
        project_id: project_id?.trim() || "default",
        trigger_key: trigger_key.trim(),
        name: name.trim(),
        event_type: event_type?.trim() || "order_approved",
        is_active: is_active !== undefined ? Number(is_active) : 1,
        delay_seconds: delay_seconds !== undefined ? Number(delay_seconds) : 0,
        template_id: template_id?.trim() || null,
        media_path: media_path?.trim() || null,
      });

      res.status(201).json({ success: true, trigger: created });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao criar gatilho", details: message });
    }
  });

  // PUT /api/triggers/:id - Atualizar configuracao do gatilho
  router.put("/:id", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);
      const { name, event_type, is_active, delay_seconds, template_id, media_path } = req.body ?? {};

      const updated = repo.update(id, {
        name: typeof name === "string" ? name : undefined,
        event_type: typeof event_type === "string" ? event_type : undefined,
        is_active: is_active !== undefined ? Number(is_active) : undefined,
        delay_seconds: delay_seconds !== undefined ? Math.max(0, Number(delay_seconds)) : undefined,
        template_id: template_id !== undefined ? (template_id ? String(template_id) : null) : undefined,
        media_path: media_path !== undefined ? (media_path ? String(media_path) : null) : undefined,
      });

      if (!updated) {
        res.status(404).json({ error: "Gatilho nao encontrado" });
        return;
      }

      res.status(200).json({ success: true, trigger: updated });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao atualizar gatilho", details: message });
    }
  });

  // PATCH /api/triggers/:id/toggle - Alternar status ativo/inativo
  router.patch("/:id/toggle", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);
      const result = repo.toggle(id);
      if (!result) {
        res.status(404).json({ error: "Gatilho nao encontrado" });
        return;
      }
      res.status(200).json({ success: true, is_active: result.is_active });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao alternar status do gatilho", details: message });
    }
  });

  // POST /api/triggers/reset-defaults - Restaurar gatilhos padrao do projeto
  router.post("/reset-defaults", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const projectId = (req.body?.project_id as string)?.trim() || "default";
      const seeded = repo.seedDefaultTriggers(projectId, true);
      const triggers = repo.listByProject(projectId);
      res.status(200).json({ success: true, project_id: projectId, seeded, triggers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Erro ao restaurar gatilhos padrao", details: message });
    }
  });

  return router;
}
