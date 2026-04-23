import pino from 'pino'

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['body.token', 'encryptedSecret', 'secretNonce'],
  ...(process.env['NODE_ENV'] !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
})
