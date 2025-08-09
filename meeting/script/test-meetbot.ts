import ms from "ms";

import { pauseMeetBot, resumeMeetBot, startMeetBot } from "../meetbot.ts";
import state from "../state.ts";
import { stopMeetBot } from "../stop_meet_bot.ts";

const [, , meetingId] = process.argv;

const meetUrl = new URL(meetingId, "https://meet.google.com");

const meetingPromise = startMeetBot(meetUrl.href, meetingId);
setTimeout(stopMeetBot, ms("30m"));

/*await delay(ms('30s'))
pauseMeetBot()
await delay(ms('15s'))
resumeMeetBot()

await meetingPromise
await state.activeBrowser?.close()
*/
// HELPERS
async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
