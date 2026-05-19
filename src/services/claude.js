const SYSTEM_PROMPT = `You are an expert at writing personalized Google Review replies for local businesses (cafes, restaurants, salons, hotels, and similar).

Rules:
- POSITIVE reviews (4-5 stars): thank warmly, reference specific details mentioned, invite them back
- NEGATIVE reviews (1-2 stars): open with sincere apology, acknowledge the specific issue, offer concrete solution or invite them to contact you directly
- NEUTRAL reviews (3 stars): acknowledge feedback, show commitment to improvement, invite them back
- Never be defensive or dismissive
- Sound human and genuine — not like a template
- Do NOT use placeholders like [Business Name] or [Manager Name]
- Output ONLY the reply text, nothing else`;

const LENGTH_GUIDE = {
  short:  '2-3 sentences',
  medium: '3-5 sentences',
  long:   '5-7 sentences'
};

const TONE_GUIDE = {
  friendly:     'warm, conversational, and approachable',
  professional: 'polished, courteous, and formal'
};

async function generateReply(reviewText, starRating, tone = 'friendly', length = 'medium') {
  const userPrompt = `Write a reply in ${LENGTH_GUIDE[length] || LENGTH_GUIDE.medium}.
Tone: ${TONE_GUIDE[tone] || TONE_GUIDE.friendly}
Star rating: ${starRating}/5

Review:
"${reviewText}"`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }  // cache system prompt — saves 90% input cost
        }
      ],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || '';
}

module.exports = { generateReply };
