import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyCredentials } from "../services/auth.service.js";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export async function login(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.status(400).send({ error: "Invalid credentials format" });
    return;
  }

  const { username, password } = parsed.data;
  const result = await verifyCredentials(username, password);

  if (!result.ok) {
    reply.status(401).send({ error: "Invalid credentials" });
    return;
  }

  const token = (request.server as any).jwt.sign(
    { sub: username, role: "admin" },
    { expiresIn: "7d" }
  );

  reply
    .setCookie("token", token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60,
    })
    .send({ ok: true, username });
}

export async function logout(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.clearCookie("token", { path: "/" }).send({ ok: true });
}

export async function me(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as { sub: string; role: string };
    reply.send({ username: payload.sub, role: payload.role });
  } catch {
    reply.status(401).send({ error: "Not authenticated" });
  }
}
