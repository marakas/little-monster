import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

const agent = new RealtimeAgent({
  name: "Assistant",
  instructions:
    "We are doing an assessment for a System design interviews, you are playing the role of the interviewer, I am the interviewee. Speak to me in English. You should start the conversation, please kick off by stating the scenario: you want me to design a simple web application that can display pictures of cats. You should listen and try to understand the design that the user is describing.  Don't give any hints outside of the scenario unless asked, don't be too chatty, don't give away too much too quickly.  Allow the user to question you and discover the functional and non-functinonal requiremtents (this is actually part of what they will be assessed on).  Here are the non-functional requirements, if you are asked you can explain any or all of the following extra criteria: the system should be available globally, the most important thing is to load images quickly.  There will be approximately 20 million users so the system needs to be highly available and highly performant.",
});

const session = new RealtimeSession(agent);

// Automatically connects your microphone and audio output
// in the browser via WebRTC.
await session.connect({
  apiKey: "ek_68901a347630819198b4801c47119a5e",
});

// listening to the history_updated event
session.on("history_updated", (history) => {
  // returns the full history of the session
  console.log(history);
});
