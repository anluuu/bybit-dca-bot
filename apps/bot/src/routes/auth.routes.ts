import type { FastifyInstance } from "fastify";
import { login, logout, me } from "../controllers/auth.controller.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    login
  );
  app.post("/api/auth/logout", logout);
  app.get("/api/auth/me", me);
}
