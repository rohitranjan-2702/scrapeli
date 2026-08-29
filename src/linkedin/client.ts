import { config } from "../config.js";

export class LinkedInAuthError extends Error {}
export class ProfileNotFoundError extends Error {}
export class RequestTimeoutError extends Error {}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const AUTHWALL_RE = /\/(login|uas\/login|checkpoint|authwall|signup)/i;

export class LinkedInClient {
  private cookieHeader(): string {
    const parts = [`li_at=${config.liAt}`];
    if (config.jsessionId) {
      parts.push(`JSESSIONID="${config.jsessionId.replace(/"/g, "")}"`);
    }
    return parts.join("; ");
  }

  /** Fetch the server-rendered mobile profile page. */
  async getProfileHtml(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: {
          "user-agent": MOBILE_UA,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "upgrade-insecure-requests": "1",
          cookie: this.cookieHeader(),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new RequestTimeoutError(`Request timed out: ${url}`);
      }
      throw err;
    }

    if (AUTHWALL_RE.test(res.url)) {
      throw new LinkedInAuthError(
        "Redirected to a LinkedIn login / authwall page — the LINKEDIN_LI_AT cookie is missing, expired, or blocked.",
      );
    }
    if (res.status === 404) {
      throw new ProfileNotFoundError("LinkedIn returned 404 for this profile.");
    }
    if (res.status === 429 || res.status === 999) {
      throw new LinkedInAuthError(
        `LinkedIn throttled the request (HTTP ${res.status}). Back off, or use a different IP / account.`,
      );
    }
    if (res.status >= 400) {
      throw new Error(`Unexpected response from LinkedIn: HTTP ${res.status}`);
    }

    const html = await res.text();

    if (
      /<title>[^<]*(sign up|join linkedin|log ?in|sign in)\b/i.test(html) ||
      /"(authWall|GUEST_HOME)"/.test(html)
    ) {
      throw new LinkedInAuthError(
        "LinkedIn served a guest / authwall page — the LINKEDIN_LI_AT cookie is missing, expired, or blocked.",
      );
    }
    if (
      /<title>[^<]*(page not found|profile (isn.?t|not) available)/i.test(html)
    ) {
      throw new ProfileNotFoundError("Profile page is not available.");
    }

    return html;
  }
}
