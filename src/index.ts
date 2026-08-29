import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { normaliseProfileUrl, InvalidProfileUrlError } from "./linkedin/url.js";
import {
  LinkedInAuthError,
  ProfileNotFoundError,
  RequestTimeoutError,
  scrapeProfile,
} from "./linkedin/scraper.js";

const app = Fastify({
  logger: { level: config.logLevel },
  trustProxy: true,
});

await app.register(rateLimit, {
  max: config.requestsPerMinute,
  timeWindow: "1 minute",
});

// ---- Auth ------------------------------------------------------------------
app.addHook("onRequest", async (req, reply) => {
  if (req.routeOptions.url === "/health" || req.routeOptions.url === "/")
    return;

  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : "";

  if (!token || !config.authTokens.includes(token)) {
    reply.code(401).send({
      error: "unauthorized",
      message: "Missing or invalid Authorization: Bearer <token>",
    });
  }
});

const QuerySchema = z.object({
  url: z.string().min(1, "url is required"),
});

app.get("/", async () => ({
  name: "linkedin-profile-api",
  status: "ok",
  usage:
    "GET /api/profile?url=<linkedin profile url>  |  POST /api/profile { url }",
}));

app.get("/health", async () => ({ ok: true }));

async function handleProfile(
  rawUrl: unknown,
  reply: import("fastify").FastifyReply,
) {
  const parsed = QuerySchema.safeParse({ url: rawUrl });
  if (!parsed.success) {
    return reply.code(400).send({
      error: "bad_request",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
  }

  let normalised;
  try {
    normalised = normaliseProfileUrl(parsed.data.url);
  } catch (err) {
    if (err instanceof InvalidProfileUrlError) {
      return reply
        .code(400)
        .send({ error: "invalid_url", message: err.message });
    }
    throw err;
  }

  try {
    const result = await scrapeProfile(
      normalised.url,
      normalised.publicIdentifier,
    );
    return reply.send(result);
  } catch (err) {
    if (err instanceof LinkedInAuthError) {
      return reply
        .code(502)
        .send({ error: "linkedin_auth", message: err.message });
    }
    if (err instanceof ProfileNotFoundError) {
      return reply.code(404).send({ error: "not_found", message: err.message });
    }
    if (err instanceof RequestTimeoutError) {
      return reply.code(504).send({ error: "timeout", message: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({
      error: "scrape_failed",
      message: (err as Error).message ?? "Unknown error",
    });
  }
}

app.get("/api/profile", async (req, reply) => {
  const { url } = (req.query ?? {}) as Record<string, unknown>;
  return handleProfile(url, reply);
});

app.post("/api/profile", async (req, reply) => {
  const { url } = (req.body ?? {}) as Record<string, unknown>;
  return handleProfile(url, reply);
});

// ---- Lifecycle -----------------------------------------------------------
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
