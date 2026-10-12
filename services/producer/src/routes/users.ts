import { Router } from "express";
import { authContext, requireRole } from "../auth/middleware.js";
import { createAccount, listAllUsers, resetAccountPassword, updateAccount } from "../services/users.js";
import { bodyOf, fail } from "./respond.js";

export const usersRouter = Router();

usersRouter.use("/api/users", requireRole("admin"));

usersRouter.get("/api/users", (_req, res) => {
  try {
    res.json({ users: listAllUsers() });
  } catch (error) {
    fail(res, 500, "listing users", error);
  }
});

usersRouter.post("/api/users", async (req, res) => {
  try {
    res.status(201).json(await createAccount(bodyOf(req.body), authContext(res).user.id));
  } catch (error) {
    fail(res, 500, "creating user", error);
  }
});

usersRouter.patch("/api/users/:id", (req, res) => {
  try {
    res.json({ user: updateAccount(Number(req.params.id), bodyOf(req.body), authContext(res).user.id) });
  } catch (error) {
    fail(res, 500, "updating user", error);
  }
});

usersRouter.post("/api/users/:id/reset-password", async (req, res) => {
  try {
    const password = await resetAccountPassword(Number(req.params.id), authContext(res).user.id);
    res.json({ temporary_password: password });
  } catch (error) {
    fail(res, 500, "resetting password", error);
  }
});
