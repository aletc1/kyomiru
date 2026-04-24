import { z } from 'zod'
import { PROVIDER_KEYS, SERVICE_STATUSES } from '../types/status.js'

export const ProviderKeySchema = z.enum(PROVIDER_KEYS)
export const ServiceStatusSchema = z.enum(SERVICE_STATUSES)

export const ServiceInfoSchema = z.object({
  providerKey: ProviderKeySchema,
  displayName: z.string(),
  status: ServiceStatusSchema,
  lastSyncAt: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  pairingState: z.enum(['none', 'pending']).optional(),
})

export const ConnectServiceBodySchema = z.object({
  token: z.string().min(1),
}).strict()

export const TestServiceBodySchema = z.object({
  token: z.string().min(1),
}).strict()

export const TestServiceResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
})

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>
export type PairingState = NonNullable<ServiceInfo['pairingState']>
export type ConnectServiceBody = z.infer<typeof ConnectServiceBodySchema>
export type TestServiceBody = z.infer<typeof TestServiceBodySchema>
export type TestServiceResponse = z.infer<typeof TestServiceResponseSchema>
