// Vercel serverless function — calls Anthropic API securely server-side.
// Set ANTHROPIC_API_KEY in Vercel: Project Settings -> Environment Variables

// Extend Vercel function timeout to 30 seconds (requires Pro on Vercel,
// but maxDuration up to 10s works on Hobby — we'll also shorten the prompt)
export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;
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
