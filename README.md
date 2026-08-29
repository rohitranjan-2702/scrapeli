# LinkedIn Profile API

A hosted HTTP API that accepts a LinkedIn profile URL and returns most of the
information on the profile as structured JSON — name, headline, location, about,
experience, education, skills, certifications, languages, connection/follower
counts, and profile images.

Built for the "LinkedIn Profile API" hiring challenge.

---

## How it works

A **pure reverse-engineered client — no browser, no Playwright, one HTTP
request per profile.**

linkedin.com's _desktop_ profile page is a React Server Components shell: it
embeds no profile data at all (everything is fetched client-side after
hydration), and the legacy `/voyager/api/.../profileView` REST endpoint now
returns **HTTP 410**. But requesting the very same URL with a **mobile
User-Agent** makes LinkedIn serve its server-rendered mobile template — a single
~200 KB HTML document containing the entire profile.

So the whole strategy is:

1. **One GET** of `https://www.linkedin.com/in/<id>/` with the `li_at` session
   cookie and an iPhone `User-Agent`. Login redirects, authwall pages, 404s and
   throttling (`429` / `999`) are detected and mapped to proper status codes.
2. **Parse** the returned HTML with [cheerio](https://cheerio.js.org)
   ([`parse.ts`](src/linkedin/parse.ts)). The markup is semantic, so fields are
   selected _structurally_ rather than by position:

   | Field                                       | Selector                                                          |
   | ------------------------------------------- | ----------------------------------------------------------------- |
   | name / headline / location                  | `h1`, `.member-current-company` and siblings                      |
   | about                                       | `.summary-container .description`                                 |
   | experience                                  | `li.profile-entity-lockup` → `.list-item-heading`, `.description` |
   | grouped roles (one company, several titles) | `li.role-container` → `.body-small-bold`                          |
   | education                                   | `li.profile-entity-lockup` under the Education `h2`               |
   | skills                                      | `.skills-list li.skill-item`                                      |
   | languages / certifications                  | `#accomplishment-section .accomplishment-type`                    |

   Two markup quirks are handled up front: `·` separators are empty spans (the
   glyph comes from CSS) and are materialised so adjacent fields don't
   concatenate, and the "…more / See less" toggles are stripped so they don't
   end up appended to every description.

3. **Validate** against a [Zod schema](src/schema.ts) and return.
   `meta.warnings` surfaces anything that could not be read.

```
client ─▶ Fastify ─▶ LinkedInClient
                       └─ GET /in/<id>/   (li_at cookie + iPhone UA)
                                 │
                          server-rendered HTML
                                 │
                          cheerio parse ─▶ Zod ─▶ JSON
```

A full scrape is **one request, ~1–2 s, a few MB of RAM** — versus ~10–20 s and
~1 GB for a headless Chromium.

## API

Base URL: your deployment's HTTPS origin.

### `GET /health`

```json
{ "ok": true }
```

### `GET /api/profile?url=<linkedin profile url>`

### `POST /api/profile` `{ "url": "<linkedin profile url>" }`

Every request must send `Authorization: Bearer <token>`, where `<token>` is one
of the values in `AUTH_TOKENS`.

Accepted input URLs (query-string params are ignored, locale prefixes allowed):

- `https://www.linkedin.com/in/williamhgates/`
- `https://linkedin.com/in/williamhgates`
- `https://www.linkedin.com/in/williamhgates/?originalSubdomain=us`

#### Example

```bash
curl -s "https://YOUR_HOST/api/profile?url=https://www.linkedin.com/in/williamhgates/" \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq
```

#### Response `200`

```jsonc
{
  "profile": {
    "profileUrl": "https://www.linkedin.com/in/williamhgates/",
    "publicIdentifier": "williamhgates",
    "fullName": "Bill Gates",
    "firstName": "Bill",
    "lastName": "Gates",
    "headline": "Co-chair, Bill & Melinda Gates Foundation",
    "location": "Seattle, Washington, United States",
    "about": "Co-chair of the Bill & Melinda Gates Foundation. …",
    "connections": "500+ connections",
    "followers": "39,000,000 followers",
    "currentCompany": "Bill & Melinda Gates Foundation",
    "profilePicture": "https://media.licdn.com/dms/image/…/profile.jpg",
    "experience": [
      {
        "title": "Co-chair",
        "company": "Bill & Melinda Gates Foundation",
        "companyUrl": "https://www.linkedin.com/company/gates-foundation",
        "employmentType": null,
        "location": "Seattle, Washington",
        "description": "Working to reduce inequity around the world.",
        "dateRange": {
          "start": "2000",
          "end": "Present",
          "durationText": "25 yrs",
        },
      },
    ],
    "education": [
      {
        "school": "Harvard University",
        "schoolUrl": "https://www.linkedin.com/school/harvard-university/",
        "degree": "Bachelor of Science",
        "fieldOfStudy": "Computer Science",
        "description": null,
        "dateRange": { "start": "1973", "end": "1975", "durationText": null },
      },
    ],
    "skills": ["Philanthropy", "Public Speaking"],
    "certifications": [],
    "languages": [{ "name": "English", "proficiency": "Native or bilingual" }],
  },
  "meta": {
    "source": "mobile-html",
    "scrapedAt": "2026-08-29T09:47:27.684Z",
    "durationMs": 1840,
    "warnings": [],
  },
}
```

Every `profile` field is optional; the API returns what it could confidently
extract and omits or nulls the rest. Array fields default to `[]`.

#### Error responses

| Status | `error`         | Meaning                                                                |
| ------ | --------------- | ---------------------------------------------------------------------- |
| 400    | `bad_request`   | `url` missing or empty                                                 |
| 400    | `invalid_url`   | Not a `linkedin.com/in/<id>` URL                                       |
| 401    | `unauthorized`  | `Authorization: Bearer <token>` header missing or not in `AUTH_TOKENS` |
| 404    | `not_found`     | LinkedIn has no such profile / not visible to this account             |
| 429    | rate limit      | More than `RATE_LIMIT_PER_MIN` requests/min                            |
| 502    | `linkedin_auth` | Session cookie missing/expired/blocked, or LinkedIn throttled          |
| 504    | `timeout`       | The LinkedIn request exceeded `REQUEST_TIMEOUT_MS`                     |
| 500    | `scrape_failed` | Anything else (details in `message`)                                   |

---

## Setup (local)

Prerequisites: Node 20+ and `pnpm`.

```bash
pnpm install
cp .env.example .env         # then edit .env — see below
pnpm dev                     # http://localhost:3000
```

Production build:

```bash
pnpm build && pnpm start
```

### Configuration

All configuration is via environment variables. **Secrets are never committed** —
`.env` is git-ignored and `.env.example` documents every variable.

| Variable              | Required | Default   | Description                                                                 |
| --------------------- | -------- | --------- | --------------------------------------------------------------------------- |
| `LINKEDIN_LI_AT`      | **yes**  | —         | `li_at` cookie from a logged-in LinkedIn session (see below)                |
| `LINKEDIN_JSESSIONID` | no       | —         | `JSESSIONID` cookie, sent alongside `li_at`                                 |
| `AUTH_TOKENS`         | **yes**  | —         | Comma-separated Bearer tokens; clients send `Authorization: Bearer <token>` |
| `PORT`                | no       | `3000`    | HTTP port                                                                   |
| `HOST`                | no       | `0.0.0.0` | Bind address                                                                |
| `REQUEST_TIMEOUT_MS`  | no       | `20000`   | Per-request timeout                                                         |
| `INCLUDE_RAW`         | no       | `false`   | Include the raw fetched HTML in the response as `raw`                       |
| `RATE_LIMIT_PER_MIN`  | no       | `20`      | Per-IP request cap                                                          |
| `LOG_LEVEL`           | no       | `info`    | Pino log level                                                              |

### Getting `LINKEDIN_LI_AT`

1. Log into <https://www.linkedin.com> in a browser — **use a secondary /
   throwaway account**, not your primary one.
2. DevTools → **Application** → **Cookies** → `https://www.linkedin.com`.
3. Copy the **Value** of the `li_at` cookie (a long opaque string) into
   `LINKEDIN_LI_AT`.
4. Optionally copy `JSESSIONID` too (surrounding quotes are stripped
   automatically).

The cookie is a bearer credential for that account. Treat it like a password,
rotate it if it leaks, and expect it to last a few weeks before LinkedIn
invalidates it (the API returns `502 linkedin_auth` when that happens).

---

## Deployment

The service is a stateless Node HTTP server that listens on `$PORT`, with no
browser dependency — ~128 MB RAM is plenty. It runs on any Node 20+ host.

### Any Node host (Render, Railway, Fly.io, a VM, …)

- Build command: `pnpm install && pnpm build`
- Start command: `pnpm start`
- Set `LINKEDIN_LI_AT` (required) and `AUTH_TOKENS` (recommended) as
  environment variables / secrets in the platform dashboard — never commit them.
  `LINKEDIN_JSESSIONID` is optional.
- Health check path: `/health`.

`pnpm start` runs `node dist/index.js` and reads configuration straight from the
process environment (it does not load `.env`), so the platform's own env-var
mechanism is all you need. Any managed platform terminates TLS for you,
satisfying the "HTTPS" requirement.

---

## Design decisions

- **Mobile UA over a headless browser.** The desktop page is a data-free RSC
  shell and the old REST endpoints return 410, so a naive HTML fetch fails. The
  mobile template is fully server-rendered, which makes the whole problem one
  `fetch` plus a parse: ~1–2 s and a few MB, against ~10–20 s and ~1 GB for
  Chromium. It also avoids GraphQL's rotating `queryId` hashes entirely.
- **Structural selectors, not positional ones.** Fields are read from
  meaningful classes (`.description`, `.list-item-heading`, `.role-container`)
  rather than "the third div". This is what makes grouped positions — several
  roles at one company — come out as separate entries with the right titles.
- **Cookie auth, not username/password.** Programmatic login almost always hits
  a CAPTCHA or e-mail verification. A `li_at` cookie sidesteps that and is
  trivial to rotate.
- **Everything optional in the schema.** Profiles vary; partial data is the
  norm, not an error. Callers get `meta.warnings` instead of a hard failure.
- **Only fields the page actually provides.** The schema deliberately omits
  things this surface cannot supply (industry, country code, background image)
  rather than returning keys that are always `null`.

---

## Known limitations

- **Not affiliated with LinkedIn.** This automates access to LinkedIn using your
  own account and likely runs against LinkedIn's User Agreement. Use it for the
  challenge / evaluation only, at low volume, with an account you're willing to
  lose. There is no attempt to bypass paywalls or view content the account
  can't already see.
- **Markup drift.** The parser depends on LinkedIn's mobile template markup.
  When a class is renamed the affected field returns `null` (and a note lands in
  `meta.warnings`) rather than throwing — but it will need occasional
  maintenance. `INCLUDE_RAW=true` returns the fetched HTML, which makes
  diagnosing a drift a one-request job.
- **Bot defenses.** Datacenter IPs frequently get `429` / `999` from LinkedIn
  even with a valid cookie; sustained use can trigger an account checkpoint. The
  service rate-limits itself, but a residential / low-reputation IP and modest
  volume are strongly recommended.
- **Visibility-bound.** Fields the backing account can't see (private profiles,
  out-of-network specifics) are simply absent. Contact info, recommendations,
  posts/activity, volunteering, projects, honors, and courses are out of scope.
- **Cookie lifetime.** `li_at` expires; expect to re-set the secret every few
  weeks. Failures return `502 linkedin_auth`.
- **No caching.** Add one keyed by `publicIdentifier` if you need throughput.

---

## Project layout

```
src/
  index.ts              Fastify server, routes, auth, rate limit
  config.ts             Environment configuration (no secrets in code)
  schema.ts             Zod response schema + TypeScript types
  linkedin/
    url.ts              Validate / normalise the input profile URL
    client.ts           One authenticated GET (mobile UA) + error mapping
    parse.ts            cheerio parser for the server-rendered profile
    scraper.ts          Orchestration: fetch, parse, validate
.env.example            Documented configuration template
```

## Tech

TypeScript · Fastify 5 · cheerio · Zod · pnpm · native `fetch`
