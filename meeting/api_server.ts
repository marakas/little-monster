import "dotenv/config";
import express from "express";
import * as amqp from "amqplib";

import { registerCleanup } from "./cleanup.ts";
import { BOT_ID } from "./constants.ts";
import { registerMeeting, startHeartbeatUpdater } from "./dynamo.ts";
import { pauseMeetBot, resumeMeetBot, startMeetBot } from "./meetbot.ts";
import {
  connect as connectToMessageBroker,
  state as messageBrokerState,
} from "./message_broker.ts";
import state from "./state.ts";
import { stopMeetBot } from "./stop_meet_bot.ts";
import { type MeetingPlatform } from "./utils.ts";

const EXCHANGE_NAME = "meet-bot-exchange";
const START_QUEUE = "start-meetings";
const ephemeralQueues = {} as Record<
  string,
  {
    name: string;
    consumerTag: string;
  }
>;

registerCleanup(async (meetingId) => {
  const queue = ephemeralQueues[meetingId];
  if (queue) {
    await messageBrokerState.channel?.cancel(queue.consumerTag);
    delete ephemeralQueues[meetingId];
    console.log(
      `[RabbitMQ] Removed exclusive consumer of ephemeral queue for ${meetingId} (queue should auto-delete shortly after this)`
    );
  }
});

const app = express();
app.use(express.json());

// ✅ **API to Get Health Status**
app.get("/", (req, res) => {
  //console.log('✅ Health check received.')
  res.status(200).json({ status: "healthy" });
});

async function setupConsumers(channel: amqp.Channel) {
  await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
  await channel.assertQueue(START_QUEUE, { durable: true });
  await channel.bindQueue(START_QUEUE, EXCHANGE_NAME, "start.meeting");

  console.log(
    '[Consumer] Waiting for START commands on "start-meetings" queue...'
  );

  // re-create ephemeral (per-meeting) queues and consumers
  for (const meetingId of Object.keys(ephemeralQueues)) {
    // TODO DRY
    const { queue } = await channel.assertQueue("", {
      exclusive: true,
      durable: false,
      autoDelete: true,
    });

    const routingKey = `meeting.${meetingId}.*`;
    await channel.bindQueue(queue, EXCHANGE_NAME, routingKey);

    console.log(`[Consumer] Bound ephemeral queue "${queue}" for ${meetingId}`);

    const { consumerTag } = await channel.consume(
      queue,
      (meetingMsg) => {
        if (!meetingMsg) return;
        handleMeetingCommand(meetingMsg);
      },
      {
        exclusive: true,
        noAck: true,
      }
    );
    ephemeralQueues[meetingId] = {
      name: queue,
      consumerTag,
    };
  }

  channel.consume(START_QUEUE, async (msg) => {
    if (!msg || state.isBotRunning) return;
    let payload: Record<string, string>;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch (err) {
      console.error("❌ [Consumer] Invalid JSON:", msg.content.toString());
      channel.ack(msg);
      return;
    }

    const { command, meetingId, meetingUrl, platform } = payload;
    if (command === "start" && meetingId) {
      // ✅ Normalize meetingUrl field - handle both meetUrl and meetingUrl naming
      const normalizedMeetingUrl = meetingUrl || payload.meetUrl;

      if (!normalizedMeetingUrl) {
        console.error(
          `❌ [Consumer] Missing meetingUrl in payload for meeting ${meetingId}:`,
          payload
        );
        channel.ack(msg);
        return;
      }

      console.log(
        `[Consumer] Picked up START for meeting ${meetingId} on platform: ${
          platform || "unknown"
        }`
      );
      const { queue } = await channel.assertQueue("", {
        exclusive: true,
        durable: false,
        autoDelete: true,
      });

      const routingKey = `meeting.${meetingId}.*`;
      await channel.bindQueue(queue, EXCHANGE_NAME, routingKey);

      console.log(
        `[Consumer] Bound ephemeral queue "${queue}" for ${meetingId}`
      );

      const { consumerTag } = await channel.consume(
        queue,
        (meetingMsg) => {
          if (!meetingMsg) return;
          handleMeetingCommand(meetingMsg);
        },
        {
          exclusive: true,
          noAck: true, // should help with 406 PRECONDITION_FAILED errors
        }
      );
      ephemeralQueues[meetingId] = {
        name: queue,
        consumerTag,
      };

      if (!state.isBotRunning && (await registerMeeting(meetingId))) {
        console.log(
          `🎥 Starting meeting ${meetingId} on ${
            platform || "unknown"
          } platform...`
        );
        startHeartbeatUpdater(meetingId);
        startMeetBot(
          normalizedMeetingUrl,
          meetingId,
          platform as MeetingPlatform
        ).catch((err) => {
          console.error("❌ Meetbot error:", err);
          stopMeetBot();
        });
      }
      channel.ack(msg);
    } else {
      console.log("[Consumer] Unknown or invalid start message, discarding.");
      channel.ack(msg);
    }
  });
}

function handleMeetingCommand(msg: amqp.ConsumeMessage) {
  let payload: Record<string, string>;
  try {
    payload = JSON.parse(msg.content.toString());
  } catch (err) {
    console.error(
      "❌ Invalid JSON in meeting command:",
      msg.content.toString()
    );
    return;
  }

  const { command, meetingId } = payload;
  console.log(
    `[MeetingConsumer] Received command "${command}" for meeting ${meetingId}`
  );

  let handled = false;

  switch (command) {
    case "pause":
      if (
        state.isBotRunning &&
        state.meetingId === meetingId &&
        !state.isBotPaused
      ) {
        handled = true;
        console.log(`⏸️ Pausing meeting ${meetingId}`);
        pauseMeetBot();
      }
      break;
    case "resume":
      if (
        state.isBotRunning &&
        state.meetingId === meetingId &&
        state.isBotPaused
      ) {
        handled = true;
        console.log(`▶️ Resuming meeting ${meetingId}`);
        resumeMeetBot();
      }
      break;
    case "stop":
      if (state.isBotRunning && state.meetingId === meetingId) {
        handled = true;
        console.log(`🛑 Stopping meeting ${meetingId}`);
        stopMeetBot();
      }
      break;
    default:
      console.log(`[MeetingConsumer] Unrecognized command "${command}"`);
      break;
  }

  if (!handled) {
    console.log(`⚠️ Command '${command}' ignored for meeting ${meetingId}`);
  }
}

process.on("SIGINT", async () => {
  console.log(`⚠️ [${BOT_ID}] Caught SIGINT. Exiting...`);
  try {
    const meetingId = state.meetingId;
    if (meetingId && ephemeralQueues[meetingId] && messageBrokerState.channel) {
      await messageBrokerState.channel.cancel(
        ephemeralQueues[meetingId].consumerTag
      );
      console.log(
        `[Cleanup] Removed consumer of ephemeral queue for ${meetingId}`
      );
    }

    await messageBrokerState.channel?.close();
    await messageBrokerState.connection?.close();

    state.isBotRunning = false;

    if (state.activeProcess && typeof state.activeProcess.kill === "function") {
      state.activeProcess.kill("SIGTERM");
    }
    if (state.activeBrowser) await state.activeBrowser.close();

    process.exit();
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
  } finally {
    process.exit(0);
  }
});

connectToMessageBroker(setupConsumers).then(() => {
  console.log("[Agent] Initial RabbitMQ connection attempt complete.");
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 [${BOT_ID}] API Server running on port ${PORT}`)
);
