# LinkedIn Profile API

A hosted HTTP API that accepts a LinkedIn profile URL and returns most of the
profile as structured JSON — name, headline, location, about, experience,
education, skills, certifications, languages, connection/follower counts, and
profile images.

Built for the "LinkedIn Profile API" hiring challenge.

---

## How it works

A **pure reverse-engineered client — no browser, one HTTP request per profile.**

linkedin.com's desktop profile page is a React Server Components shell with no
embedded profile data, and the legacy `/voyager/api/.../profileView` endpoint
now returns HTTP 410. But requesting the same URL with a **mobile User-Agent**
makes LinkedIn serve its server-rendered mobile template — a single ~200 KB HTML
document containing the entire profile.

The strategy:

1. **One GET** of `https://www.linkedin.com/in/<id>/` with the `li_at` session
   cookie and an iPhone `User-Agent`. Login redirects, authwall pages, 404s and
   throttling (`429` / `999`) are mapped to proper status codes.
2. **Parse** the HTML with [cheerio](https://cheerio.js.org)
   ([`parse.ts`](src/linkedin/parse.ts)). The markup is semantic, so fields are
   selected structurally (`.description`, `.list-item-heading`,
   `.role-container`, …) rather than by position — this is what makes grouped
   roles at one company come out as separate entries with the right titles. Two
   quirks are handled up front: `·` separators are empty CSS-driven spans (so
   they're materialised) and "…more / See less" toggles are stripped.
3. **Validate** against a [Zod schema](src/schema.ts) and return.
   `meta.warnings` surfaces anything that could not be read.

A full scrape is one request, ~1–2 s, a few MB of RAM — versus ~10–20 s and
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

Accepted input URLs (query-string params ignored, locale prefixes allowed):

- `https://www.linkedin.com/in/williamhgates/`
- `https://linkedin.com/in/williamhgates`
- `https://www.linkedin.com/in/williamhgates/?originalSubdomain=us`

#### Example

```bash
curl -s "https://scrapeli.onrender.com/api/profile?url=https://www.linkedin.com/in/williamhgates/" \
  -H "Authorization: Bearer tross_test_9f2b7c1e4a6d8035b1c9e5f7a2d4b6c8" | jq
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

Production build: `pnpm build && pnpm start`.

### Docker

```bash
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 --env-file .env linkedin-profile-api
```

The image is a multi-stage `node:22-alpine` build (~260 MB), runs as a non-root
user, and reads all config from the container environment. `curl localhost:3000/health`.

### Configuration

All configuration is via environment variables. `.env` is git-ignored;
`.env.example` documents every variable.

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
3. Copy the **Value** of the `li_at` cookie into `LINKEDIN_LI_AT` (optionally
   `JSESSIONID` too — surrounding quotes are stripped automatically).

The cookie is a bearer credential for that account. Treat it like a password,
rotate it if it leaks, and expect it to last a few weeks before LinkedIn
invalidates it (the API then returns `502 linkedin_auth`).

---

## Design decisions

- **Mobile UA over a headless browser.** The desktop page is a data-free RSC
  shell and the old REST endpoints return 410. The mobile template is fully
  server-rendered, making the whole problem one `fetch` plus a parse (~1–2 s, a
  few MB) instead of ~10–20 s and ~1 GB for Chromium. It also avoids GraphQL's
  rotating `queryId` hashes entirely.
- **Structural selectors, not positional ones.** Fields are read from meaningful
  classes rather than "the third div", which is what makes grouped positions
  come out correctly.
- **Cookie auth, not username/password.** Programmatic login almost always hits
  a CAPTCHA or e-mail verification; a `li_at` cookie sidesteps that and is
  trivial to rotate.
- **Everything optional in the schema.** Profiles vary; partial data is the
  norm, not an error. Callers get `meta.warnings` instead of a hard failure.
- **Only fields the page actually provides** — the schema omits things this
  surface cannot supply (industry, country code, background image).

---

## Known limitations

- **Not affiliated with LinkedIn.** This automates access using your own account
  and likely runs against LinkedIn's User Agreement. Use it for the challenge /
  evaluation only, at low volume, with an account you're willing to lose.
- **Markup drift.** The parser depends on LinkedIn's mobile template markup.
  When a class is renamed the affected field returns `null` (with a note in
  `meta.warnings`) rather than throwing. `INCLUDE_RAW=true` returns the fetched
  HTML, making a drift diagnosis a one-request job.
- **Bot defenses.** Datacenter IPs frequently get `429` / `999` even with a
  valid cookie; a residential / low-reputation IP and modest volume are
  strongly recommended.
- **Visibility-bound.** Fields the backing account can't see are simply absent.
  Contact info, recommendations, posts/activity, volunteering, projects, honors,
  and courses are out of scope.
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
