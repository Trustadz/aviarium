import { z } from 'zod'
import { apiMessages } from './api-messages.js'

export const announcementText = z.strictObject({
  title: z.string().trim().min(1).max(120),
  intro: z.string().trim().min(1).max(600),
  body: z.string().trim().max(3000),
  headerAlt: z.string().trim().max(160),
})
export type AnnouncementText = z.infer<typeof announcementText>
export const announcementTranslations = z.strictObject({ en: announcementText, nl: announcementText }).refine(
  ({ en, nl }) => Boolean(en.body) === Boolean(nl.body) && Boolean(en.headerAlt) === Boolean(nl.headerAlt),
  apiMessages.announcement_translation_incomplete,
)
export type AnnouncementTranslations = z.infer<typeof announcementTranslations>
