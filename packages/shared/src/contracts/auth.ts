import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  preferredLocale: z.string().nullable(),
})

export const NewContentCountSchema = z.object({
  count: z.number().int(),
})

export const QueueReorderBodySchema = z.object({
  showIds: z.array(z.string().uuid()).min(1),
}).strict()

export const HealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  redis: z.boolean(),
})

export type User = z.infer<typeof UserSchema>
export type NewContentCount = z.infer<typeof NewContentCountSchema>
export type QueueReorderBody = z.infer<typeof QueueReorderBodySchema>
