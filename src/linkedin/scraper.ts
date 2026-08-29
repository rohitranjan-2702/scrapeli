import { config } from "../config.js";
import { LinkedInAuthError, LinkedInClient } from "./client.js";
import { parseProfileHtml } from "./parse.js";
import { ProfileSchema, type ScrapeResult } from "../schema.js";

export {
  LinkedInAuthError,
  ProfileNotFoundError,
  RequestTimeoutError,
} from "./client.js";

export async function scrapeProfile(
  profileUrl: string,
  publicIdentifier: string,
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const client = new LinkedInClient();

  const html = await client.getProfileHtml(profileUrl);
  const { profile: parsed, warnings } = parseProfileHtml(
    html,
    profileUrl,
    publicIdentifier,
  );

  const gotSomething =
    !!parsed.fullName ||
    !!parsed.headline ||
    (parsed.experience?.length ?? 0) > 0 ||
    (parsed.education?.length ?? 0) > 0;
  if (!gotSomething) {
    throw new LinkedInAuthError(
      "The profile page loaded but no fields could be read — the session cookie is likely invalid or rate-limited, or LinkedIn changed the mobile template.",
    );
  }

  return {
    profile: ProfileSchema.parse(parsed),
    meta: {
      source: "mobile-html",
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      warnings,
    },
    raw: config.includeRaw ? html : undefined,
  };
}
