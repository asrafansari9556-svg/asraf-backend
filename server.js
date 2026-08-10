// backend-example/server.js
//
// Reference implementation of the "Secure Backend" from Section 6 of the
// spec. Its ONLY jobs are:
//   1. Hold the real AI provider API key (never the Android app).
//   2. Validate and rate-limit incoming requests.
//   3. Call the AI provider and return plain text back to the app.
//
// This is a STARTING POINT for local development/testing, not a
// production-hardened service. Before shipping to real users you'd add
// at minimum: real user authentication (Section 25), a managed secrets
// store instead of a .env file, structured logging/monitoring, and TLS
// termination from your hosting platform (Sections 6, 15, 26, 27, 28).
// Do not claim this alone makes the app "unhackable" (Section 37).

require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");

const app = express();

// Section 26: request size limit — reject oversized bodies outright.
app.use(express.json({ limit: "10kb" }));

// Section 26: basic abuse protection. Tune per your real traffic/auth model.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,              // 20 requests / minute / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
app.use("/v1/assistant", limiter);

// Section 6/26: never trust the client. Validate everything server-side.
function validateAssistantRequest(req, res, next) {
  const { message } = req.body ?? {};
  if (typeof message !== "string") {
    return res.status(400).json({ error: "`message` must be a string." });
  }
  if (message.trim().length === 0) {
    return res.status(400).json({ error: "`message` cannot be empty." });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: "`message` is too long." });
  }
  next();
}

app.post("/v1/assistant", validateAssistantRequest, async (req, res) => {
  const { message } = req.body;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set.");
    return res.status(500).json({ error: "Assistant backend is not configured." });
  }

  const systemPrompt =
    "You are ASRAF AI, a concise, helpful voice assistant. Keep replies short and speakable aloud.\n\n" +
    "If — and ONLY if — the user's request clearly matches one of these exact commands, respond with " +
    "NOTHING but a single JSON object in the form {\"command\":\"COMMAND_NAME\",\"target\":\"...\"} " +
    "(omit \"target\" if not applicable). Do not add any other text around the JSON.\n\n" +
    "Allowed COMMAND_NAME values:\n" +
    "GET_BATTERY, GET_DEVICE_INFO, START_TIMER (target = number of minutes as digits), " +
    "OPEN_APP (target = app name, e.g. \"youtube\"), OPEN_BROWSER (target = a full https URL, optional), " +
    "OPEN_SETTINGS, SCAN_BLUETOOTH, OPEN_CAMERA.\n\n" +
    "For anything else — general questions, conversation, or requests that don't match the list above — " +
    "reply normally in plain text. Never invent a command name outside this list; the app will reject " +
    "anything else anyway, so just answer conversationally instead.";

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 512,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
    });

    if (!upstream.ok) {
      const status = upstream.status;
      console.error(`Upstream AI provider error: ${status}`);
      if (status === 429) {
        return res.status(429).json({ error: "Assistant is busy. Please try again shortly." });
      }
      return res.status(502).json({ error: "Assistant backend received an error from the AI provider." });
    }

    const data = await upstream.json();
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();

    if (!reply) {
      return res.status(502).json({ error: "AI provider returned an empty response." });
    }

    return res.json({ reply });
  } catch (err) {
    console.error("Error calling AI provider:", err.message);
    return res.status(502).json({ error: "Failed to reach the AI provider." });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 8443;
app.listen(PORT, () => {
  console.log(`ASRAF AI backend (reference) listening on port ${PORT}`);
});
