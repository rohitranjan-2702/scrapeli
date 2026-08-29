import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type {
  Certification,
  DateRange,
  Education,
  Experience,
  Language,
  Profile,
} from "../schema.js";

type El = Cheerio<Element>;

/** "Oct 2023 - Present", "2013 - 2017", "Jan 2024 - Apr 2024". */
const DATE_RANGE =
  /((?:[A-Z][a-z]{2}\s+)?\d{4})\s*[-–—]\s*((?:[A-Z][a-z]{2}\s+)?\d{4}|Present)/i;

function clean(s: string | undefined | null): string | null {
  const t = s?.replace(/\s+/g, " ").trim();
  return t && t.length ? t : null;
}

function textOf(el: El): string | null {
  return clean(el.text());
}

/**
 * Prepare the document:
 *  - `·` separators are empty spans (the glyph is CSS), so materialise them or
 *    adjacent fields concatenate — "B.Tech.Computer Science".
 *  - "…more" / "See less" toggles and icons are UI chrome that would otherwise
 *    be appended to every truncated description.
 */
function normalise($: CheerioAPI): void {
  $("span.dot-separator").text(" · ");
  $("button, .see-more, .see-less, li-icon, svg, .visually-hidden").remove();
}

function parseDateRange(line: string): DateRange | null {
  const [rangePart, durationPart] = line.split(/\s*·\s*/);
  const m = rangePart?.match(DATE_RANGE);
  if (!m) return null;
  return {
    start: clean(m[1]),
    end: clean(m[2]),
    durationText: clean(durationPart),
  };
}

/** The `<ol>`/`<ul>` that follows a section's `<h2>` heading. */
function sectionList($: CheerioAPI, heading: string): El {
  const h2 = $("h2")
    .filter(
      (_, el) => clean($(el).text())?.toLowerCase() === heading.toLowerCase(),
    )
    .first();
  let node: El = h2 as El;
  for (let i = 0; i < 4 && node.length; i++) {
    const list = node.nextAll("ol, ul").first();
    if (list.length) return list as El;
    node = node.parent() as El;
  }
  return $() as El;
}

/** Fields shared by a flat role and a grouped sub-role. */
function readDetail($: CheerioAPI, scope: El) {
  const description = textOf(scope.find(".description").first());
  const location = textOf(
    scope
      .find('[class*="text-color-text-low-emphasis"]')
      .not(".description")
      .filter((_, el) => {
        const t = clean($(el).text());
        return !!t && !DATE_RANGE.test(t) && t !== description;
      })
      .first() as El,
  );
  let dates: DateRange | null = null;
  scope.find("div").each((_, el) => {
    if (dates) return;
    const t = clean($(el).text());
    if (t && DATE_RANGE.test(t) && t.length < 60) dates = parseDateRange(t);
  });
  return { description, location, dates };
}

function parseExperience($: CheerioAPI): Experience[] {
  const out: Experience[] = [];

  sectionList($, "Experience")
    .children("li")
    .each((_, li) => {
      const $li = $(li) as El;
      const heading = textOf($li.find(".list-item-heading").first());
      const roles = $li.find("li.role-container");

      if (roles.length) {
        // Grouped: the heading is the company, each role-container a position.
        const companyUrl =
          $li
            .find('a[href*="/company/"]')
            .first()
            .attr("href")
            ?.split("?")[0] ?? null;
        roles.each((_, role) => {
          const $role = $(role) as El;
          const { description, location, dates } = readDetail($, $role);
          out.push({
            title: textOf($role.find(".body-small-bold").first()),
            company: heading,
            companyUrl,
            employmentType: null,
            location,
            description,
            dateRange: dates,
          });
        });
        return;
      }

      if (!heading) return;
      const headingEl = $li.find(".list-item-heading").first();
      const companyLine = textOf(
        headingEl.parent().children("div.body-small").first() as El,
      );
      const [company, employmentType] = (companyLine ?? "").split(/\s*·\s*/);
      const { description, location, dates } = readDetail($, $li);
      out.push({
        title: heading,
        company: clean(company),
        companyUrl:
          $li
            .find('a[href*="/company/"]')
            .first()
            .attr("href")
            ?.split("?")[0] ?? null,
        employmentType: clean(employmentType),
        location,
        description,
        dateRange: dates,
      });
    });

  return out;
}

function parseEducation($: CheerioAPI): Education[] {
  const out: Education[] = [];

  sectionList($, "Education")
    .children("li")
    .each((_, li) => {
      const $li = $(li) as El;
      const headingEl = $li.find(".list-item-heading").first();
      const school = textOf(headingEl);
      if (!school) return;

      const siblings = headingEl.parent().children("div");
      let degreeLine: string | null = null;
      let dates: DateRange | null = null;
      const extra: string[] = [];

      siblings.each((_, div) => {
        const $div = $(div) as El;
        if ($div.is(headingEl)) return;
        const t = clean($div.text());
        if (!t) return;
        if (DATE_RANGE.test(t) && t.length < 60) {
          dates ??= parseDateRange(t);
        } else if (degreeLine === null) {
          degreeLine = t;
        } else {
          extra.push(t);
        }
      });

      const [degree, fieldOfStudy] = (degreeLine ?? "").split(/\s*·\s*/);
      out.push({
        school,
        schoolUrl:
          $li
            .find('a[href*="/school/"], a[href*="/company/"]')
            .first()
            .attr("href")
            ?.split("?")[0] ?? null,
        degree: clean(degree),
        fieldOfStudy: clean(fieldOfStudy),
        description: extra.join("\n") || null,
        dateRange: dates,
      });
    });

  return out;
}

/** Accomplishment sub-sections, keyed by their lower-cased `<h3>` heading. */
function parseAccomplishments($: CheerioAPI): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  $("#accomplishment-section .accomplishment-type").each((_, el) => {
    const $el = $(el) as El;
    const name = clean($el.find("h3").first().text())?.toLowerCase();
    if (!name) return;
    const items: string[][] = [];
    $el.find("li").each((_, li) => {
      const $li = $(li) as El;
      if ($li.find("li").length) return;
      const lines: string[] = [];
      $li
        .children()
        .find("*")
        .addBack()
        .each((_, node) => {
          const $n = $(node) as El;
          if ($n.children().length) return; // leaf nodes only
          const t = clean($n.text());
          if (t && !lines.includes(t)) lines.push(t);
        });
      if (lines.length) items.push(lines);
    });
    if (items.length) out[name] = items;
  });
  return out;
}

function mapCertifications(items: string[][]): Certification[] {
  return items.map((lines) => ({
    name: lines[0] ?? null,
    authority: lines[1] ?? null,
    authorityUrl: null,
    credentialId:
      lines
        .find((l) => /credential id/i.test(l))
        ?.replace(/.*credential id\s*:?\s*/i, "")
        .trim() ?? null,
    credentialUrl: null,
    issued:
      lines
        .find((l) => /issued/i.test(l))
        ?.replace(/.*issued\s*:?\s*/i, "")
        .trim() ?? null,
    expires:
      lines
        .find((l) => /expir/i.test(l))
        ?.replace(/.*expir(?:es|ed|ation)\s*:?\s*/i, "")
        .trim() ?? null,
  }));
}

function mapLanguages(items: string[][]): Language[] {
  return items.map((lines) => ({
    name: lines[0] ?? null,
    proficiency: lines[1] ?? null,
  }));
}

/** Images are lazy-loaded via `data-delayed-url`, falling back to `src`. */
function imageFrom($img: El): string | null {
  const url = $img.attr("data-delayed-url") ?? $img.attr("src");
  return url?.startsWith("http") ? url : null;
}

export function parseProfileHtml(
  html: string,
  profileUrl: string,
  publicIdentifier: string,
): { profile: Partial<Profile>; warnings: string[] } {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  normalise($);

  // ---- Top card ----
  const fullName = textOf($("h1").first() as El);
  const [firstName, ...rest] = (fullName ?? "").split(" ");

  const nameCard = $("h1").first().parent().parent() as El;
  const headline = textOf(nameCard.children("div.body-small").first() as El);
  const currentCompany = textOf($(".member-current-company").first() as El);

  // The location line also carries connection / follower counts, dot-separated.
  const locationLine = textOf(
    $(".member-current-company").first().parent().next("div") as El,
  );
  const [locationPart, ...tail] = (locationLine ?? "").split(/\s*·\s*/);
  const findCount = (re: RegExp) =>
    tail.find((t) => re.test(t)) ??
    clean(
      $("span")
        .filter(
          (_, el) => re.test($(el).text()) && $(el).children().length === 0,
        )
        .first()
        .text(),
    ) ??
    null;

  const about = textOf($(".summary-container .description").first() as El);

  const skills: string[] = [];
  $(".skills-list .skill-item").each((_, li) => {
    const t = clean($(li).text().replace(/·/g, ""));
    if (t && !skills.includes(t)) skills.push(t);
  });

  const acc = parseAccomplishments($);
  const experience = parseExperience($);

  if (!fullName) warnings.push("Could not read the name from the top card");
  if (!experience.length) warnings.push("No experience entries found");

  return {
    profile: {
      profileUrl,
      publicIdentifier,
      fullName,
      firstName: fullName ? firstName : null,
      lastName: fullName && rest.length ? rest.join(" ") : null,
      headline,
      location: clean(locationPart),
      about,
      connections: findCount(/connection/i),
      followers: findCount(/follower/i),
      currentCompany,
      experience,
      education: parseEducation($),
      skills,
      certifications: mapCertifications(
        acc["licenses & certifications"] ?? acc["certifications"] ?? [],
      ),
      languages: mapLanguages(acc["languages"] ?? []),
      profilePicture: imageFrom($('img[class*="rounded-[50%]"]').first() as El),
    },
    warnings,
  };
}
