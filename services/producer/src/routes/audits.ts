import { Router } from "express";
import { getAuditDetail, listAuditSummaries } from "../services/audits.js";
import { fail } from "./respond.js";

export const auditsRouter = Router();

auditsRouter.get("/api/audits", (_req, res) => {
  try {
    res.json(listAuditSummaries());
  } catch (error) {
    fail(res, 500, "fetching audits", error);
  }
});

auditsRouter.get("/api/audits/:id", (req, res) => {
  try {
    const detail = getAuditDetail(parseInt(req.params.id, 10));

    if (!detail) {
      res.status(404).json({ error: "Audit not found" });
      return;
    }

    res.json(detail);
  } catch (error) {
    fail(res, 500, "fetching audit", error);
  }
});
