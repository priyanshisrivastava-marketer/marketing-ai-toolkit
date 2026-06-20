// ============================================
// Marketing AI Toolkit — Backend API Proxy
// Hides your Gemini API key from the public.
// Rate limit: 5 requests per IP per day.
// Deploy this on Vercel (free).
// ============================================

// Simple in-memory store for rate limiting.
// Resets every time Vercel restarts the function (roughly every 24h).
const ipRequestCount = {};
const RATE_LIMIT = 5; // max requests per IP

export default async function handler(req, res) {

  // ── 1. Only allow POST requests ──────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── 2. Allow your frontend to call this backend (CORS) ───────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ── 3. Check rate limit ──────────────────────────────────────────
  // Get the visitor's IP address
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  // Count how many times this IP has called today
  if (!ipRequestCount[ip]) {
    ipRequestCount[ip] = 0;
  }
  ipRequestCount[ip]++;

  // If they've exceeded the limit, block them politely
  if (ipRequestCount[ip] > RATE_LIMIT) {
    return res.status(429).json({
      error: `You've used all ${RATE_LIMIT} free generations for today. Come back tomorrow! 🙏`
    });
  }

  // ── 4. Get the prompt from the request body ───────────────────────
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 10) {
    return res.status(400).json({ error: "Please provide a valid prompt." });
  }

  // ── 5. Call Gemini API using your secret key ──────────────────────
  // GEMINI_API_KEY is stored safely in Vercel environment variables.
  // It is NEVER sent to the user's browser.
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Server configuration error. API key not set." });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 1500,
          },
        }),
      }
    );

    const data = await geminiRes.json();

    // Handle Gemini API errors
    if (data.error) {
      return res.status(500).json({ error: "AI error: " + data.error.message });
    }

    // Extract the text response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "No response from AI. Please try again." });
    }

    // ── 6. Send back the result + remaining uses ───────────────────
    return res.status(200).json({
      result: text,
      usesRemaining: Math.max(0, RATE_LIMIT - ipRequestCount[ip]),
    });

  } catch (err) {
    console.error("Gemini fetch error:", err);
    return res.status(500).json({ error: "Network error reaching AI. Please try again." });
  }
}
