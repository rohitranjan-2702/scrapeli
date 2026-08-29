import { z } from "zod";

export const DateRangeSchema = z.object({
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  durationText: z.string().nullable().optional(),
});
export type DateRange = z.infer<typeof DateRangeSchema>;

export const ExperienceSchema = z.object({
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  companyUrl: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dateRange: DateRangeSchema.nullable().optional(),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const EducationSchema = z.object({
  school: z.string().nullable().optional(),
  schoolUrl: z.string().nullable().optional(),
  degree: z.string().nullable().optional(),
  fieldOfStudy: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dateRange: DateRangeSchema.nullable().optional(),
});
export type Education = z.infer<typeof EducationSchema>;

export const CertificationSchema = z.object({
  name: z.string().nullable().optional(),
  authority: z.string().nullable().optional(),
  authorityUrl: z.string().nullable().optional(),
  credentialId: z.string().nullable().optional(),
  credentialUrl: z.string().nullable().optional(),
  issued: z.string().nullable().optional(),
  expires: z.string().nullable().optional(),
});
export type Certification = z.infer<typeof CertificationSchema>;

export const LanguageSchema = z.object({
  name: z.string().nullable().optional(),
  proficiency: z.string().nullable().optional(),
});
export type Language = z.infer<typeof LanguageSchema>;

export const ProfileSchema = z.object({
  profileUrl: z.string(),
  publicIdentifier: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  about: z.string().nullable().optional(),
  connections: z.string().nullable().optional(),
  followers: z.string().nullable().optional(),
  currentCompany: z.string().nullable().optional(),
  profilePicture: z.string().nullable().optional(),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(z.string()).default([]),
  certifications: z.array(CertificationSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface ScrapeMeta {
  /** Which LinkedIn surface the data came from. */
  source: "mobile-html";
  scrapedAt: string;
  durationMs: number;
  warnings: string[];
}

export interface ScrapeResult {
  profile: Profile;
  meta: ScrapeMeta;
  raw?: unknown;
}
