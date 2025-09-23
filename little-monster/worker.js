// worker.js
import { nanoid } from "nanoid";

import db from "./db.js";

const q = {
  // Atomic-ish claim: try to mark one pending job as running
  claimJob: db.query(`
    UPDATE generation_jobs
       SET status = 'running', started_at = ?
     WHERE id = (
       SELECT id FROM generation_jobs
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
     )
     RETURNING id, user_id, lesson_id, payload_json, created_at
  `),

  finishJobOk: db.query(`
    UPDATE generation_jobs SET status='done', finished_at=? WHERE id=?
  `),
  finishJobErr: db.query(`
    UPDATE generation_jobs SET status='error', error=?, finished_at=? WHERE id=?
  `),

  setLessonReady: db.query(`
    UPDATE lessons SET status='ready', ready_at=? WHERE id=?
  `),
  setLessonError: db.query(`
    UPDATE lessons SET status='error', error=? WHERE id=?
  `),

  insertUnit: db.query(`
    INSERT INTO lesson_units (id, lesson_id, type, intro_text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  insertVocab: db.query(`
    INSERT INTO vocab_items (id, unit_id, jp, en, description, example_jp, example_en, audio_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertSpeaking: db.query(`
    INSERT INTO speaking_items (id, unit_id, jp, en, description, example_jp, example_en, audio_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertTurn: db.query(`
    INSERT INTO conversation_turns (id, unit_id, speaker, jp, en, order_index, audio_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

async function openaiJSON(system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(text);
}

function buildPrompt({ level, focus, notes }) {
  // Keep it explicit & schema-first so the worker can parse reliably
  const system = `You are generating concise Japanese lesson content for 15 minutes total: 3 units × 5 minutes (vocab, speaking, conversation).
Return STRICT JSON that matches exactly this schema:
{
  "vocab": {
    "intro": "one paragraph",
    "items": [
      { "jp": "...", "en": "...", "description": "...", "example_jp": "...", "example_en": "..." }
      // 10 items total
    ]
  },
  "speaking": {
    "intro": "one paragraph",
    "items": [
      { "jp": "full sentence to say", "en": "meaning", "description": "coaching tip", "example_jp": "...", "example_en": "..." }
      // 5-8 items
    ]
  },
  "conversation": {
    "intro": "one paragraph",
    "turns": [
      { "speaker": "bot", "jp": "...", "en": "..." },
      { "speaker": "user", "jp": "...", "en": "..." }
      // 10-14 alternating turns, small and natural
    ]
  }
}
Use only UTF-8. DO NOT add extra keys. Keep content focused on the requested level/focus/context.`;

  const user = `Learner profile:
- Level: ${level}
- Focus: ${focus}
- Context/Notes: ${notes || "n/a"}

Constraints:
- Vocab: 10 items max; prefer domain-appropriate keigo/formality if advanced.
- Speaking: 5–8 short sentences learners can say; keigo if requested; avoid romaji; kana/kanji OK but keep readable.
- Conversation: 10–14 turns; situational to the context; keep user lines realistic for practice.

Output ONLY valid JSON.`;

  return { system, user };
}

async function generateForJob(job) {
  const payload = JSON.parse(job.payload_json);
  const { level, focus, notes } = payload;
  const { system, user } = buildPrompt({ level, focus, notes });

  const json = await openaiJSON(system, user);

  const now = new Date().toISOString();

  // Insert 3 units, then items
  // Vocab
  const vocabUnitId = nanoid();
  q.insertUnit.run(
    vocabUnitId,
    job.lesson_id,
    "vocab",
    json.vocab?.intro || "",
    now
  );
  for (const it of json.vocab?.items || []) {
    q.insertVocab.run(
      nanoid(),
      vocabUnitId,
      it.jp || "",
      it.en || "",
      it.description || "",
      it.example_jp || "",
      it.example_en || "",
      null, // audio_url placeholder (later TTS)
      now
    );
  }

  // Speaking
  const speakingUnitId = nanoid();
  q.insertUnit.run(
    speakingUnitId,
    job.lesson_id,
    "speaking",
    json.speaking?.intro || "",
    now
  );
  for (const it of json.speaking?.items || []) {
    q.insertSpeaking.run(
      nanoid(),
      speakingUnitId,
      it.jp || "",
      it.en || "",
      it.description || "",
      it.example_jp || "",
      it.example_en || "",
      null, // audio_url placeholder
      now
    );
  }

  // Conversation
  const convUnitId = nanoid();
  q.insertUnit.run(
    convUnitId,
    job.lesson_id,
    "conversation",
    json.conversation?.intro || "",
    now
  );
  let order = 0;
  for (const t of json.conversation?.turns || []) {
    q.insertTurn.run(
      nanoid(),
      convUnitId,
      (t.speaker || "bot").toLowerCase() === "user" ? "user" : "bot",
      t.jp || "",
      t.en || "",
      order++,
      null, // audio_url placeholder
      now
    );
  }

  // Mark lesson ready
  q.setLessonReady.run(now, job.lesson_id);
}

async function loop() {
  console.log("[worker] started");
  while (true) {
    try {
      const now = new Date().toISOString();
      const claimed = q.claimJob.get(now);
      if (!claimed) {
        // No work; sleep a bit
        await Bun.sleep(3000);
        continue;
      }

      const job = claimed; // {id, user_id, lesson_id, payload_json}
      console.log("[worker] running job", job.id);

      try {
        await generateForJob(job);
        q.finishJobOk.run(new Date().toISOString(), job.id);
        console.log("[worker] done job", job.id);
      } catch (err) {
        console.error("[worker] job error", job.id, err);
        q.setLessonError.run(String(err?.message || err), job.lesson_id);
        q.finishJobErr.run(
          String(err?.message || err),
          new Date().toISOString(),
          job.id
        );
      }
    } catch (e) {
      console.error("[worker] loop error", e);
      await Bun.sleep(3000);
    }
  }
}

if (!OPENAI_API_KEY) {
  console.warn(
    "[worker] OPENAI_API_KEY is not set; generator will fail. Set it in Fly secrets."
  );
}
loop();
