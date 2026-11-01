import { Router, Request, Response } from "express";
import { getDatabase } from "../database/connection.js";
import { TemplateRepository, type MessageTemplate } from "../database/repositories.js";

export interface TemplateRouterOptions {
  templateRepo?: TemplateRepository;
}

/**
 * Cria o Router Express para o CRUD e Simulador de Templates
 */
export function createTemplatesRouter(options: TemplateRouterOptions = {}): Router {
  const router = Router();

  const getRepo = (): TemplateRepository => {
    if (options.templateRepo) return options.templateRepo;
    const db = getDatabase();
    return new TemplateRepository(db);
  };

  // GET /api/templates - Listar todos os templates
  router.get("/", (_req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const templates = repo.findAll();
      res.status(200).json({ success: true, templates });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/templates/preview - Testar e simular interpolacao de tags e Spintax
  router.post("/preview", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const { content, templateId, variables = {} } = req.body || {};

      let textToPreview = content;
      if (!textToPreview && templateId) {
        const tpl = repo.findById(String(templateId));
        if (tpl) {
          textToPreview = tpl.content;
        }
      }

      if (typeof textToPreview !== "string" || textToPreview.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'content' ou 'templateId' valido e obrigatorio.",
        });
        return;
      }

      const spintaxCheck = repo.validateSpintax(textToPreview);
      const extractedTags = repo.extractTags(textToPreview);
      const preview = repo.interpolate(textToPreview, variables);

      res.status(200).json({
        success: true,
        preview,
        extracted_tags: extractedTags,
        spintax_valid: spintaxCheck.valid,
        spintax_error: spintaxCheck.error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/templates/seed - Popular templates realistas se vazio
  router.post("/seed", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const force = Boolean(req.query.force === "true" || req.body?.force);
      let count = repo.seedIfEmpty(force);
      if (count === 0 && repo.findAll().length > 0) {
        count = repo.findAll().length;
      }
      res.status(200).json({ success: true, seeded_count: count });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // GET /api/templates/:id - Buscar template por ID
  router.get("/:id", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);
      const template = repo.findById(id);
      if (!template) {
        res.status(404).json({ success: false, error: "Template nao encontrado." });
        return;
      }
      res.status(200).json({ success: true, template });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // POST /api/templates - Criar novo template
  router.post("/", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const { name, content, tags, media_path } = req.body || {};

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'name' e obrigatorio.",
        });
        return;
      }

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'content' e obrigatorio.",
        });
        return;
      }

      const spintaxCheck = repo.validateSpintax(content);
      if (!spintaxCheck.valid) {
        res.status(400).json({
          success: false,
          error: `SpintaxError: ${spintaxCheck.error}`,
        });
        return;
      }

      const created = repo.create({
        name,
        content,
        tags,
        media_path,
      });

      res.status(201).json({ success: true, template: created });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // PUT /api/templates/:id - Atualizar template existente
  router.put("/:id", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);
      const { name, content, tags, media_path } = req.body || {};

      const existing = repo.findById(id);
      if (!existing) {
        res.status(404).json({ success: false, error: "Template nao encontrado." });
        return;
      }

      if (content !== undefined) {
        if (typeof content !== "string" || content.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: "ValidationError: campo 'content' nao pode ser vazio.",
          });
          return;
        }

        const spintaxCheck = repo.validateSpintax(content);
        if (!spintaxCheck.valid) {
          res.status(400).json({
            success: false,
            error: `SpintaxError: ${spintaxCheck.error}`,
          });
          return;
        }
      }

      if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
        res.status(400).json({
          success: false,
          error: "ValidationError: campo 'name' nao pode ser vazio.",
        });
        return;
      }

      const updated = repo.update(id, {
        name,
        content,
        tags,
        media_path,
      });

      res.status(200).json({ success: true, template: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // DELETE /api/templates/:id - Excluir template
  router.delete("/:id", (req: Request, res: Response): void => {
    try {
      const repo = getRepo();
      const id = String(req.params.id);

      const deleted = repo.delete(id);
      if (!deleted) {
        res.status(404).json({ success: false, error: "Template nao encontrado." });
        return;
      }

      res.status(200).json({ success: true, deleted: true, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}
