// server.js
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- NEW: Lessons proxy (uses env-stored base + key) ---
app.get("/lessons/:id", async (req, res) => {
  try {
    const BASE = process.env.LESSONS_API_BASE; // e.g., https://little-monster.fly.dev/api/lessons
    const KEY = process.env.LESSONS_API_KEY; // e.g., xxxxxx
    const EMAIL_DEFAULT = process.env.LESSONS_USER_EMAIL; // optional default identity

    if (!BASE || !KEY) {
      return res.status(500).json({
        error: "missing_lessons_env",
        message: "LESSONS_API_BASE or LESSONS_API_KEY not set",
      });
    }

    const id = req.params.id;
    // Build upstream URL and forward optional ?user_id= / ?email=
    const baseUrl = `${BASE.replace(/\/+$/, "")}/${encodeURIComponent(id)}`;
    const url = new URL(baseUrl);
    // forward all query params, but we especially care about user_id/email
    for (const [k, v] of Object.entries(req.query || {})) {
      if (v != null) url.searchParams.set(k, String(v));
    }

    url.searchParams.set("email", EMAIL_DEFAULT);

    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": KEY,
        Accept: "application/json",
      },
    });

    const text = await r.text();
    if (!r.ok) {
      console.error("Lessons proxy failed:", r.status, text);
      return res
        .status(r.status)
        .type(r.headers.get("content-type") || "application/json")
        .send(text);
    }

    res
      .status(200)
      .type(r.headers.get("content-type") || "application/json")
      .send(text);
  } catch (e) {
    console.error("Lessons proxy error:", e);
    res.status(500).json({ error: "proxy_error", message: String(e) });
  }
});

// --- existing route (unchanged) ---
app.post("/realtime/token", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "missing_openai_key" });

    const model = process.env.REALTIME_MODEL || "gpt-realtime";
    const payload = { session: { type: "realtime", model } };
    console.log("Mint body:", JSON.stringify(payload));

    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    if (!r.ok) {
      console.error("Mint failed:", r.status, text);
      return res
        .status(500)
        .json({ error: "mint_failed", status: r.status, body: text });
    }
    res.type("application/json").send(text); // {"value":"ek_..."}
  } catch (e) {
    console.error("Token route error:", e);
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => console.log(`✅ server on http://localhost:${PORT}`));
