// Vercel serverless function — calls Anthropic API securely server-side.
// Set ANTHROPIC_API_KEY in Vercel: Project Settings -> Environment Variables

import crypto from 'crypto';

// Extend Vercel function timeout to 30 seconds (requires Pro on Vercel,
// but maxDuration up to 10s works on Hobby — we'll also shorten the prompt)
export const config = {
  maxDuration: 30,
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_TTL_MS) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, token } = req.body;
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `Anthropic API error: ${response.status} ${errText}` });
    }

    const data = await response.json();

    // Log key details for debugging in Vercel logs
    console.log("Anthropic stop_reason:", data.stop_reason);
    console.log("Anthropic usage:", JSON.stringify(data.usage));
    console.log("Response text length:", data.content?.[0]?.text?.length);

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
