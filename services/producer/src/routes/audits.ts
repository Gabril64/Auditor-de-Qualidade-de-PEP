import { Router } from "express";
import { authContext, requireRole } from "../auth/middleware.js";
import { HttpError } from "../errors.js";
import { getAuditDetail, listAuditSummaries } from "../services/audits.js";
import { approveAudit, deleteAudit, editAudit, restoreAudit, revokeApproval } from "../services/revisions.js";
import { bodyOf, fail } from "./respond.js";

export const auditsRouter = Router();

function auditIdOf(raw: string | string[]): number {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id)) throw new HttpError(404, "Audit not found");
  return id;
}

auditsRouter.get("/api/audits", (req, res) => {
  try {
    res.json(listAuditSummaries(authContext(res).user, req.query.deleted === "1"));
  } catch (error) {
    fail(res, 500, "fetching audits", error);
  }
});

auditsRouter.get("/api/audits/:id", (req, res) => {
  try {
    const detail = getAuditDetail(auditIdOf(req.params.id), authContext(res).user);

    if (!detail) {
      res.status(404).json({ error: "Audit not found" });
      return;
    }

    res.json(detail);
  } catch (error) {
    fail(res, 500, "fetching audit", error);
  }
});

auditsRouter.patch("/api/audits/:id/revision", (req, res) => {
  try {
    const body = bodyOf(req.body);
    const { user } = authContext(res);
    const version = editAudit(auditIdOf(req.params.id), body.updated_at, body.changes, user);
    res.json({ updated_at: version });
  } catch (error) {
    fail(res, 500, "editing audit", error);
  }
});

auditsRouter.post("/api/audits/:id/approve", (req, res) => {
  try {
    approveAudit(auditIdOf(req.params.id), authContext(res).user);
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "approving audit", error);
  }
});

auditsRouter.delete("/api/audits/:id/approve", (req, res) => {
  try {
    revokeApproval(auditIdOf(req.params.id), authContext(res).user);
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "revoking approval", error);
  }
});

auditsRouter.delete("/api/audits/:id", requireRole("admin"), (req, res) => {
  try {
    deleteAudit(auditIdOf(req.params.id), authContext(res).user);
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "deleting audit", error);
  }
});

auditsRouter.post("/api/audits/:id/restore", requireRole("admin"), (req, res) => {
  try {
    restoreAudit(auditIdOf(req.params.id), authContext(res).user);
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "restoring audit", error);
  }
});
