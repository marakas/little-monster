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
  lessonRequestsForUser: db.query(`
    SELECT * FROM lesson_requests WHERE user_id = ? ORDER BY created_at DESC
  `),
};

// ---------- app ----------
const app = new Hono();

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
  return tpl(c, "dashboard", {
    title: "Dashboard",
    user,
    lessons,
    error: null,
    success: null,
  });
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
