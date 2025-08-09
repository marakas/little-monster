import AWS from 'aws-sdk'

import { BOT_ID, HEARTBEAT_INTERVAL } from './constants.ts'
import { env } from './env.ts'
import state from './state.ts'

// Initialize DynamoDB Client
const dynamoDB = new AWS.DynamoDB.DocumentClient({
  endpoint: env.DYNAMODB_ENDPOINT,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region: env.AWS_REGION, // Set the AWS region in environment variables
})

// ✅ Function to Mark Meeting as Completed
export async function completeMeeting(meeting_id: string) {
  try {
    await dynamoDB
      .update({
        TableName: env.DYNAMODB_TABLE,
        Key: { meeting_id },
        UpdateExpression: 'SET meeting_status = :completed, ended_at = :time',
        ExpressionAttributeValues: {
          ':completed': 'completed',
          ':time': new Date().toISOString(),
        },
      })
      .promise()
    console.log(`✅ Meeting ${meeting_id} marked as completed in DynamoDB.`)
  } catch (error) {
    console.error('❌ Error marking meeting as completed:', error)
  }
}

export function startHeartbeatUpdater(meeting_id: string) {
  if (!state.heartbeatInterval) {
    console.log('⏳ Starting heartbeat updater...')
    state.heartbeatInterval = setInterval(async () => {
      if (!state.isBotRunning || !meeting_id) {
        console.log('🛑 Bot stopped or no meeting. Stopping heartbeat updater.')
        if (state.heartbeatInterval) {
          clearInterval(state.heartbeatInterval)
          state.heartbeatInterval = null
        }
        return
      }
      await updateHeartbeat(meeting_id)
    }, HEARTBEAT_INTERVAL)
  }
}

// ✅ Function to Check if a Meeting is Already in Progress
export async function isMeetingAlreadyRecording(meeting_id: string) {
  const result = await dynamoDB
    .get({
      TableName: env.DYNAMODB_TABLE,
      Key: { meeting_id },
      ProjectionExpression: 'meeting_status',
    })
    .promise()

  return result.Item && result.Item.meeting_status === 'recording'
}

// ✅ Function to Register Meeting in DynamoDB
export async function registerMeeting(meeting_id: string) {
  try {
    await dynamoDB
      .transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: env.DYNAMODB_TABLE,
              Item: {
                meeting_id,
                bot_id: BOT_ID,
                meeting_status: 'recording',
                started_at: new Date().toISOString(),
                last_heartbeat: new Date().toISOString(),
              },
              ConditionExpression: 'attribute_not_exists(meeting_id)',
            },
          },
        ],
      })
      .promise()

    console.log(`🔒 Registered meeting ${meeting_id} in DynamoDB.`)
    return true
  } catch (error) {
    if (
      error instanceof Object &&
      'code' in error &&
      error.code === 'TransactionCanceledException'
    ) {
      console.warn(`⚠️ Meeting ${meeting_id} is already being recorded.`)
      return false
    }
    console.error('❌ Error registering meeting in DynamoDB:', error)
    return false
  }
}

// ✅ Function to Update Heartbeat (Keep-Alive)
export async function updateHeartbeat(meeting_id: string) {
  try {
    await dynamoDB
      .update({
        TableName: env.DYNAMODB_TABLE,
        Key: { meeting_id },
        UpdateExpression: 'SET last_heartbeat = :now',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
        },
      })
      .promise()
    console.log(`[${BOT_ID}] 💓 Heartbeat updated for meeting ${meeting_id}`)
  } catch (error) {
    console.error('❌ Error updating heartbeat:', error)
  }
}
