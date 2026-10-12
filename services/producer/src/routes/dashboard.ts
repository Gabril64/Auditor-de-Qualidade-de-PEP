import { Router } from "express";
import { getDashboardStats } from "../repositories/audits.js";
import { fail } from "./respond.js";

export const dashboardRouter = Router();

dashboardRouter.get("/api/dashboard/stats", (_req, res) => {
  try {
    res.json(getDashboardStats());
  } catch (error) {
    fail(res, 500, "fetching dashboard stats", error);
  }
});
