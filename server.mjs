import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'node:http';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not set');
  process.exit(1);
}

const NARA_API_KEY = process.env.NARA_API_KEY;

const GEMINI_MODELS = ['gemini-3-flash','gemini-2.5-flash','gemini-3.5-flash'];
const FALLBACK_MODEL = 'mimo-v2.5-pro-free';
const NARA_BASE_URL = 'https://router.bynara.id/v1';

const SYSTEM_PROMPT = `You are an expert Prompt Engineer. Transform user requests into optimized prompts.

OUTPUT FORMAT:
**Suggested Improvements** (3 max, 1 sentence each):
- [What was improved and why]
- [What was improved and why]
- [What was improved and why]

---

**Best Prompt** (single comprehensive version):
[The full optimized prompt - detailed, specific, actionable. Ready to copy-paste.]

RULES:
1. ONLY output Suggested Improvements and Best Prompt.
2. Max 3 bullet points in Suggested Improvements.
3. Best Prompt is ONE single prompt.
4. No intro or concluding text.
5. Use markdown formatting.
6. Keep total response under 500 words.`;

// ─── Gemini attempt ──────────────────────────────────────────────
async function tryGemini(userRequest) {
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: userRequest }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
          })
        }
      );
      const data = await r.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return { ok: true, text: data.candidates[0].content.parts[0].text, model };
      }
    } catch (e) {
      console.log(`Gemini ${model} failed:`, e.message);
    }
  }
  return { ok: false };
}

// ─── NaraRouter fallback (mimo only) ──────────────────────────────
async function tryMimo(userRequest) {
  if (!NARA_API_KEY) return { ok: false };

  try {
    const r = await fetch(`${NARA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NARA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userRequest }
        ],
        temperature: 0.3,
        max_tokens: 2048
      })
    });
    const data = await r.json();
    if (data.choices?.[0]?.message?.content) {
      return { ok: true, text: data.choices[0].message.content, model: FALLBACK_MODEL };
    }
  } catch (e) {
    console.log(`Mimo fallback failed:`, e.message);
  }
  return { ok: false };
}

// ─── Route ─────────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { userRequest } = req.body;

  const gemini = await tryGemini(userRequest);
  if (gemini.ok) {
    return res.json({ success: true, text: gemini.text, model: gemini.model });
  }

  const mimo = await tryMimo(userRequest);
  if (mimo.ok) {
    return res.json({ success: true, text: mimo.text, model: mimo.model });
  }

  res.status(500).json({ success: false, message: 'All providers failed' });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Running at http://0.0.0.0:${PORT}`);
});
