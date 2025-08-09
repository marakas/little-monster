import amqp from 'amqplib'

import assert from 'node:assert'
import { env } from './env.ts'

const AMQP_URL = env.AMQP_URL
const RECONNECT_DELAY = 5000 // 5 seconds

export const state: {
  connection: amqp.ChannelModel | null
  channel: amqp.Channel | null
} = {
  connection: null,
  channel: null,
}

let isConnecting = false
let isRecoveringConnection = false
let channelRecoveryHandle: NodeJS.Timeout | null = null

export async function connect(callback: (channel: amqp.Channel) => void) {
  if (isConnecting) return
  isConnecting = true

  try {
    console.log('Attempting to connect to RabbitMQ...')

    state.connection = await amqp.connect(AMQP_URL)

    state.connection
      .on('error', (err) => {
        console.error('❌ [Agent] RabbitMQ connection error:', err)
        isRecoveringConnection = true
      })
      .on('close', () => {
        console.error(
          '❌ [Agent] RabbitMQ connection closed, attempting to reconnect...',
        )
        isRecoveringConnection = true
        reconnect(callback)
      })

    await openChannel(callback)

    isRecoveringConnection = false
  } catch (err) {
    console.error('❌ [Agent] Error connecting to RabbitMQ:', err)
    reconnect(callback)
  } finally {
    isConnecting = false
  }
}

async function reconnect(callback: (channel: amqp.Channel) => void) {
  if (channelRecoveryHandle) {
    clearTimeout(channelRecoveryHandle)
    channelRecoveryHandle = null
  }
  setTimeout(
    () => connect(callback),
    RECONNECT_DELAY, // FDEV exponential backoff
  )
}

async function openChannel(callback: (channel: amqp.Channel) => void) {
  assert(state.connection)
  try {
    state.channel = await state.connection.createChannel()

    state.channel
      .on('error', (err) => {
        console.error('❌ [Agent] Channel error:', err)
      })
      .on('close', () => {
        console.error('❌ [Agent] Channel closed.')
        reopenChannel(callback)
      })

    callback(state.channel)
  } catch (err) {
    console.error('❌ [Agent] Error creating channel:', err)
    reopenChannel(callback)
  }
}

function reopenChannel(callback: (channel: amqp.Channel) => void) {
  if (isRecoveringConnection) return

  channelRecoveryHandle = setTimeout(
    () => openChannel(callback),
    RECONNECT_DELAY, // FDEV exponential backoff
  )
}
