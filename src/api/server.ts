import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env, corsAllowedOrigins } from "../core/config.js";
import authPlugin from "./plugins/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerConnectors } from "../connectors/register.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Corpo bruto (bytes), necessário para verificar assinatura de webhook. */
    rawBody?: Buffer;
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      // nunca logar headers de autorização nem corpo de requisições sensíveis
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });

  // Mantém o corpo bruto disponível (request.rawBody) para verificação de
  // assinatura HMAC nos webhooks, além de já entregar o JSON parseado.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if (body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(authPlugin);

  registerConnectors();

  await registerHealthRoutes(app);
  await registerWebhookRoutes(app);
  await registerConversationRoutes(app);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
