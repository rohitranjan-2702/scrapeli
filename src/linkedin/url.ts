export class InvalidProfileUrlError extends Error {}

export interface NormalisedProfile {
  url: string;
  publicIdentifier: string;
}

export function normaliseProfileUrl(input: string): NormalisedProfile {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new InvalidProfileUrlError("Input is not a valid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidProfileUrlError("URL must be http(s)");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    throw new InvalidProfileUrlError("Host must be a linkedin.com domain");
  }

  // Accept /in/<id>, /pub/<id>, and locale-prefixed variants like /in/<id>?locale=..
  const segments = parsed.pathname.split("/").filter(Boolean);
  const inIndex = segments.findIndex((s) => s === "in" || s === "pub");
  if (inIndex === -1 || !segments[inIndex + 1]) {
    throw new InvalidProfileUrlError(
      "URL must point at a personal profile, e.g. https://www.linkedin.com/in/<id>/",
    );
  }

  const publicIdentifier = decodeURIComponent(segments[inIndex + 1]).trim();
  if (!/^[\w\-.%À-ÿĀ-￿]+$/u.test(publicIdentifier)) {
    throw new InvalidProfileUrlError(
      "Profile identifier contains invalid characters",
    );
  }

  return {
    publicIdentifier,
    url: `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}/`,
  };
}
