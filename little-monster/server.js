//server.js
import { Hono } from "hono";
import { logger } from "hono/logger";
import { nanoid } from "nanoid";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import ejs from "ejs";
import db from "./db.js";
import { createSession, verifySession, sessionCookie } from "./auth.js";

// Renders a page into the layout, injecting `body`
async function render(name, data = {}) {
  const body = await ejs.renderFile(`./views/${name}.ejs`, data, {
    async: true,
  });
  const html = await ejs.renderFile(
    `./views/layout.ejs`,
    { ...data, body },
    { async: true }
  );
  return html;
}

// ---------- tiny utils ----------
const tpl = async (c, name, data = {}) => c.html(await render(name, data));

// Bun-native password hash/verify keeps deps small
const hashPassword = async (plain) =>
  await Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
const checkPassword = async (plain, hash) =>
  await Bun.password.verify(plain, hash);

// ---------- queries ----------
const q = {
  userByEmail: db.query("SELECT * FROM users WHERE email = ?"),
  insertUser: db.query(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  ),

  createLessonRequest: db.query(`
    INSERT INTO lesson_requests (id, user_id, level, focus, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  // new:
  createLesson: db.query(`
    INSERT INTO lessons (id, user_id, level, focus, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'preparing', ?)
  `),
  enqueueJob: db.query(`
    INSERT INTO generation_jobs (id, user_id, lesson_id, payload_json, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `),

  lessonRequestsForUser: db.query(`
    SELECT * FROM lesson_requests WHERE user_id = ? ORDER BY created_at DESC
  `),

  lessonsForUser: db.query(`
    SELECT * FROM lessons WHERE user_id = ? ORDER BY created_at DESC
  `),

  lessonById: db.query(`SELECT * FROM lessons WHERE id = ?`),
  latestLessonForUser: db.query(`
    SELECT * FROM lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `),
  unitsForLesson: db.query(
    `SELECT * FROM lesson_units WHERE lesson_id = ? ORDER BY created_at`
  ),
  vocabForUnit: db.query(
    `SELECT * FROM vocab_items WHERE unit_id = ? ORDER BY created_at`
  ),
  speakingForUnit: db.query(
    `SELECT * FROM speaking_items WHERE unit_id = ? ORDER BY created_at`
  ),
  turnsForUnit: db.query(
    `SELECT * FROM conversation_turns WHERE unit_id = ? ORDER BY order_index`
  ),

  userById: db.query("SELECT * FROM users WHERE id = ?"),
};

// ---------- app ----------
const app = new Hono();

// --- helpers ---
function getBearer(c) {
  const h = c.req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

// Allow either: (a) logged-in cookie user, or (b) service key.
async function requireApiAuth(c, next) {
  const user = c.get("user");
  if (user) return next(); // browser session is fine

  const key = c.req.header("x-api-key") || getBearer(c);
  if (
    key &&
    process.env.INTERNAL_API_KEY &&
    key === process.env.INTERNAL_API_KEY
  ) {
    c.set("service", "internal");
    return next();
  }

  return c.json({ error: "unauthorized" }, 401);
}

// Resolve a "target user" for service calls (by id OR email).
function resolveTargetUser(c) {
  const svc = c.get("service");
  if (!svc) return c.get("user"); // cookie user path

  const id = c.req.query("user_id");
  const email = (c.req.query("email") || "").toLowerCase();
  let u = null;
  if (id) {
    u = q.userById?.get ? q.userById.get(id) : null;
  } else if (email) {
    u = q.userByEmail.get(email);
  }
  return u;
}

app.use("*", logger());

// static
app.get("/public/*", async (c) => {
  const path = c.req.path.slice("/public/".length);
  const file = Bun.file(`./public/${path}`);
  if (!(await file.exists())) return c.notFound();
  return new Response(file); // always return
});

// session middleware
app.use("*", async (c, next) => {
  const token = getCookie(c, "lm_session");
  if (token) {
    const payload = await verifySession(token);
    if (payload) c.set("user", { id: payload.sub, email: payload.email });
  }
  await next();
});

// root -> login or dashboard
app.get("/", (c) => {
  return c.get("user") ? c.redirect("/dashboard") : c.redirect("/login");
});

// ----- Auth pages -----
app.get("/login", async (c) => {
  if (c.get("user")) return c.redirect("/dashboard");
  return tpl(c, "login", {
    title: "Log in · Little Monster",
    error: null,
    success: null,
    email: "",
  });
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");

  const user = q.userByEmail.get(email);
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return tpl(c, "login", {
      title: "Log in · Little Monster",
      error: "Invalid email or password.",
      success: null,
      email,
    });
  }

  const token = await createSession({ sub: user.id, email });
  setCookie(c, "lm_session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14, // 14 days
  });
  return c.redirect("/dashboard");
});

app.get("/logout", (c) => {
  deleteCookie(c, "lm_session", { path: "/" });
  return c.redirect("/login");
});

// ----- Registration / Lesson setup combined flow -----
// This page mimics the style of your reference but streamlined for our lesson MVP.
app.get("/register", (c) => {
  if (c.get("user")) return c.redirect("/dashboard");
  return tpl(c, "register", {
    title: "Start your 15-minute Japanese lesson",
    levels: ["beginner", "intermediate", "advanced"],
    focuses: ["intro", "keigo", "travel", "work", "small talk"],
    error: null, // <-- defaults
    success: null,
    values: {},
  });
});

app.post("/register", async (c) => {
  const form = await c.req.formData();
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");
  const level = String(form.get("level") || "beginner");
  const focus = String(form.get("focus") || "intro");
  const notes = String(form.get("notes") || "").trim();

  if (!email || !password || !name) {
    return tpl(c, "register", {
      title: "Start your 15-minute Japanese lesson",
      levels: ["beginner", "intermediate", "advanced"],
      focuses: ["intro", "keigo", "travel", "work", "small talk"],
      error: "Message here or null",
      success: null,
      values: { name, email, level, focus, notes },
    });
  }

  const existing = q.userByEmail.get(email);
  let userId;
  if (existing) {
    // allow “register” to also create a fresh lesson for existing accounts
    userId = existing.id;
    // (optionally verify password if you want to avoid silent attach)
    const ok = await checkPassword(password, existing.password_hash);
    if (!ok) {
      return tpl(c, "register", {
        title: "Start your 15-minute Japanese lesson",
        error:
          "An account exists for this email, but the password is incorrect.",
        levels: ["beginner", "intermediate", "advanced"],
        focuses: ["intro", "keigo", "travel", "work", "small talk"],
        values: { name, email, level, focus, notes },
      });
    }
  } else {
    userId = nanoid();
    const hash = await hashPassword(password);
    try {
      q.insertUser.run(userId, email, hash, new Date().toISOString());
    } catch (e) {
      return tpl(c, "register", {
        title: "Start your 15-minute Japanese lesson",
        error: "That email is already registered.",
        levels: ["beginner", "intermediate", "advanced"],
        focuses: ["intro", "keigo", "travel", "work", "small talk"],
        values: { name, email, level, focus, notes },
      });
    }
  }

  // Record the learner’s desired 15-min lesson plan (pre-generation happens later)
  q.createLessonRequest.run(
    nanoid(),
    userId,
    level,
    focus,
    notes,
    new Date().toISOString()
  );

  // Create a lesson record in 'preparing' state
  const lessonId = nanoid();
  q.createLesson.run(
    lessonId,
    userId,
    level,
    focus,
    notes,
    new Date().toISOString()
  );

  // Enqueue a generation job containing the request context
  const jobId = nanoid();
  const payload = JSON.stringify({ userId, level, focus, notes, email });
  q.enqueueJob.run(jobId, userId, lessonId, payload, new Date().toISOString());

  const token = await createSession({ sub: userId, email });
  setCookie(c, "lm_session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  });
  return c.redirect("/dashboard");
});

// ----- Dashboard -----
app.get("/dashboard", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const lessons = q.lessonRequestsForUser.all(user.id);
  const generated = q.lessonsForUser.all(user.id);
  return tpl(c, "dashboard", {
    title: "Dashboard",
    user,
    lessons,
    generated, // actual generated lessons
    error: null,
    success: null,
  });
});

async function loadLessonJSON(lesson) {
  const units = q.unitsForLesson.all(lesson.id);
  const result = { lesson, units: [] };

  for (const u of units) {
    if (u.type === "vocab") {
      result.units.push({
        ...u,
        items: q.vocabForUnit.all(u.id),
      });
    } else if (u.type === "speaking") {
      result.units.push({
        ...u,
        items: q.speakingForUnit.all(u.id),
      });
    } else if (u.type === "conversation") {
      result.units.push({
        ...u,
        turns: q.turnsForUnit.all(u.id),
      });
    }
  }
  return result;
}

// ADD authentication to the api routes
app.use("/api/*", requireApiAuth);

// Latest lesson (for cookie user OR service calling with ?user_id=... / ?email=...)
app.get("/api/lessons/latest", async (c) => {
  const target = resolveTargetUser(c);
  if (!target) return c.json({ error: "not found" }, 404);

  const lesson = q.latestLessonForUser.get(target.id);
  if (!lesson) return c.json({ lesson: null });
  const json = await loadLessonJSON(lesson);
  return c.json(json);
});

// Fetch by id (service must also own user context)
app.get("/api/lessons/:id", async (c) => {
  const target = resolveTargetUser(c);
  if (!target) return c.json({ error: "not found" }, 404);

  const id = c.req.param("id");
  const lesson = q.lessonById.get(id);
  if (!lesson || lesson.user_id !== target.id)
    return c.json({ error: "not found" }, 404);
  const json = await loadLessonJSON(lesson);
  return c.json(json);
});

app.notFound((c) => {
  // send them to login rather than plain 404
  return c.redirect("/login");
});

// Health check
app.get("/healthz", (c) => c.json({ ok: true }));

// must be AFTER all your routes/middleware
app.use("*", async (c, next) => {
  await next();
  if (!c.finalized) {
    // send them to login by default (or choose another safe page)
    return c.redirect("/login");
  }
});

app.onError((err, c) => {
  console.error("[error]", err);
  return c.html(
    `<pre style="padding:16px;white-space:pre-wrap">${
      (err && err.stack) || err
    }</pre>`,
    500
  );
});

const port = Number(process.env.PORT || 3000);
console.log(`[little-monster] listening on http://localhost:${port}`);
Bun.serve({
  port,
  fetch: (req) => app.fetch(req),
});
