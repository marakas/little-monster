// server.js
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/realtime/token", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "missing_openai_key" });

    const model = process.env.REALTIME_MODEL || "gpt-realtime";
    const payload = { session: { type: "realtime", model } }; // ✅ ONLY these fields
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
