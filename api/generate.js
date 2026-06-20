export default async function handler(req, res) {

  // ── CORS — allow all origins ──────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request browsers send before POST
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  // ── Rate limiting ─────────────────────────────────────────────────
  const ipRequestCount = global.ipRequestCount || (global.ipRequestCount = {});
  const RATE_LIMIT = 5;

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!ipRequestCount[ip]) ipRequestCount[ip] = 0;
  ipRequestCount[ip]++;

  if (ipRequestCount[ip] > RATE_LIMIT) {
    return res.status(429).json({
      error: `You've used all ${RATE_LIMIT} free generations for today. Come back tomorrow! 🙏`
    });
  }

  // ── Get prompt ────────────────────────────────────────────────────
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 10) {
    return res.status(400).json({ error: "Please provide a valid prompt." });
  }

  // ── Call Gemini ───────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Server config error: API key not set." });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4000 },
        }),
      }
    );

    const data = await geminiRes.json();

    if (data.error) {
      return res.status(500).json({ error: "Gemini error: " + data.error.message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "No response from AI. Please try again." });
    }

    return res.status(200).json({
      result: text,
      usesRemaining: Math.max(0, RATE_LIMIT - ipRequestCount[ip]),
    });

  } catch (err) {
    console.error("Gemini fetch error:", err);
    return res.status(500).json({ error: "Failed to reach Gemini: " + err.message });
  }
}
