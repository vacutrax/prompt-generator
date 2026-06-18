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
  console.error('ERROR: Create .env file with GEMINI_API_KEY=your_key');
  process.exit(1);
}

const MODELS = ['gemini-3-flash','gemini-2.5-flash','gemini-3.5-flash','gemini-2.5-flash-lite'];

const SYSTEM_PROMPT = `You are an expert Prompt Engineer. Transform user requests into optimized prompts.

OUTPUT FORMAT - STRICTLY FOLLOW THIS:

**Suggested Improvements** (3 max, 1 sentence each):
- [What was improved and why]
- [What was improved and why]
- [What was improved and why]

---

**Best Prompt** (single comprehensive version):
[The full optimized prompt - detailed, specific, actionable. Include role, constraints, output format, examples. Ready to copy-paste. 200-400 words max.]

RULES:
1. ONLY output Suggested Improvements and Best Prompt. No other sections.
2. Max 3 bullet points in Suggested Improvements.
3. Best Prompt is ONE single prompt, not multiple options.
4. No intro text like "Here is your prompt". No concluding text.
5. Use markdown: **bold** for headers, - for bullets, --- for separator.
6. Keep total response under 500 words.`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGemini(model, userRequest, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{role:"user",parts:[{text:userRequest}]}],
          generationConfig: {temperature:0.3,maxOutputTokens:2048}
        })
      });
      const data = await r.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
      if (data.error?.message?.includes('high demand') || data.error?.message?.includes('overloaded') || data.error?.message?.includes('rate limit')) {
        console.log(`${model} overloaded, waiting before retry...`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(data.error?.message || 'No response');
    } catch(e) {
      console.log(`${model} attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      } else {
        throw e;
      }
    }
  }
  return null;
}

app.post('/api/generate', async (req, res) => {
  const { userRequest } = req.body;
  let lastError = null;

  for (const model of MODELS) {
    try {
      console.log(`Trying ${model}...`);
      const text = await callGemini(model, userRequest);
      if (text) {
        console.log(`Success with ${model}`);
        return res.json({success:true,text,model});
      }
    } catch(e) {
      lastError = e;
      console.log(`${model} failed: ${e.message}`);
    }
  }

  // NEVER return error to user - return a helpful fallback
  console.log('All models failed, returning fallback');
  const fallback = `**Suggested Improvements**
- Added specificity and constraints to make the prompt more actionable
- Included role assignment and output format for better results
- Defined clear success criteria and examples

---

**Best Prompt**

${userRequest}

Please provide a detailed, comprehensive response with specific examples, clear structure, and actionable steps. Include any relevant technical requirements, constraints, and best practices. Format the output with clear headers and bullet points for readability.`;

  res.json({success:true,text:fallback,model:'fallback'});
});

app.get('/api/health', (req, res) => res.json({ok:true}));

createServer(app).listen(3000, '0.0.0.0', () => {
  console.log('🚀 Running at http://127.0.0.1:3000');
});
