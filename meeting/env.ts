import 'dotenv/config'

import * as z from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'staging', 'production'])
    .default('development'),
  // https://github.com/colinhacks/zod/issues/4103
  AMQP_URL: z.string().refine((val) => {
    try {
      new URL(val)
      return true
    } catch {
      return false
    }
  }),

  AWS_REGION: z.string().default('ap-northeast-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  DYNAMODB_ENDPOINT: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().optional(),
  SQS_ENDPOINT: z.string().optional(),
  SCHEDULER_ENDPOINT: z.string().optional(),

  DYNAMODB_TABLE: z.string().min(1),
  MEET_BOT_MAX_DURATION_MINUTES: z.coerce.number().default(40),
  MEET_BOT_S3_BUCKET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  PUPPETEER_EXECUTABLE_PATH: z.string().min(1),
  RECORD_VIDEO: z.stringbool().default(true),
  ENABLE_FULL_AUDIO_ACCUMULATION: z.stringbool().default(false),
})

export const env = EnvSchema.parse(process.env)

if (env.NODE_ENV === 'development') {
  console.log(env)
}
