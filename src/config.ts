function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function requiredList(name: string): string[] {
  const items = required(name)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (items.length === 0) {
    throw new Error(
      `Environment variable ${name} must contain at least one value`,
    );
  }
  return items;
}

export const config = {
  port: Number(optional("PORT", "3000")),
  host: optional("HOST", "0.0.0.0"),
  liAt: required("LINKEDIN_LI_AT"),
  jsessionId: optional("LINKEDIN_JSESSIONID", ""),
  authTokens: requiredList("AUTH_TOKENS"),
  requestTimeoutMs: Number(optional("REQUEST_TIMEOUT_MS", "20000")),
  includeRaw: optional("INCLUDE_RAW", "false") === "true",
  requestsPerMinute: Number(optional("RATE_LIMIT_PER_MIN", "20")),
  logLevel: optional("LOG_LEVEL", "info"),
} as const;

export type Config = typeof config;
