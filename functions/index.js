/*
 * Firebase Cloud Functions (v2) – AI assistant endpoint
 *
 * - Uses Firebase secret: OPENAI_API_KEY
 * - Exposes HTTPS endpoint: /api/ai (via hosting rewrite)
 * - Returns { text } on success
 */

const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true });
const { defineSecret } = require('firebase-functions/params');

// Secret stored via: firebase functions:secrets:set OPENAI_API_KEY
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildSystemPrompt() {
  return (
    'Sei un assistente per un gestionale (clienti, ordini, incassi, scadenze, preventivi).\n' +
    'Rispondi in italiano in modo pratico e breve.\n' +
    'Se ti chiedono riepiloghi: fai un elenco puntato con totali e date.\n' +
    'Se ti chiedono di scrivere messaggi: produci testo pronto da copiare.\n' +
    'Se mancano dati, fai 1 sola domanda mirata.'
  );
}

async function callOpenAI({ apiKey, prompt, context, model }) {
  // Prefer Responses API; fallback to Chat Completions-like schema in parsing.
  const body = {
    model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: buildSystemPrompt() }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              (context ? `Contesto:\n${context}\n\n` : '') +
              `Richiesta:\n${prompt}`,
          },
        ],
      },
    ],
  };

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  const data = safeJsonParse(text, null);
  if (!resp.ok) {
    const msg = (data && (data.error?.message || data.message)) || text || 'Errore OpenAI';
    throw new Error(msg);
  }

  // Responses API: data.output_text is commonly present
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Fallback: try to extract from output array
  if (data && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item && item.type === 'message' && Array.isArray(item.content)) {
        const chunk = item.content
          .map((c) => (c && c.type && (c.text || c.transcript)) || '')
          .join('')
          .trim();
        if (chunk) return chunk;
      }
    }
  }

  return 'Ok.';
}

exports.aiAssistant = onRequest(
  {
    region: 'europe-west1',
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  (req, res) =>
    cors(req, res, async () => {
      try {
        if (req.method === 'OPTIONS') {
          res.status(204).send('');
          return;
        }

        if (req.method !== 'POST') {
          res.status(405).json({ error: 'Method not allowed' });
          return;
        }

        const prompt = (req.body && (req.body.prompt || req.body.message)) || '';
        const context = (req.body && req.body.context) || '';
        if (!String(prompt).trim()) {
          res.status(400).json({ error: 'Missing prompt' });
          return;
        }

        const apiKey = OPENAI_API_KEY.value();
        if (!apiKey) {
          res.status(500).json({ error: 'Missing OPENAI_API_KEY secret' });
          return;
        }

        const model =
          (req.body && req.body.model) ||
          process.env.AI_MODEL ||
          'gpt-4o-mini';

        const outText = await callOpenAI({ apiKey, prompt, context, model });
        res.status(200).json({ text: outText });
      } catch (err) {
        logger.error('aiAssistant error', err);
        res.status(500).json({ error: String(err?.message || err || 'Errore') });
      }
    })
);


/*
 * DCR GROUP orders portal helpers
 * Questa build include solo scaffolding base per il portale ordini.
 * Le push FCM reali richiedono configurazione Messaging/VAPID e token dispositivi.
 */

/*
 * analyzeInvoice – GPT-4o Vision OCR for supplier invoices.
 * POST /api/analyze-invoice
 * Body: { imageBase64: string, mimeType: string }
 * Returns: { invoiceNumber, date, dueDate, amount, vat, description, supplierName }
 */
exports.analyzeInvoice = onRequest(
  {
    region: 'europe-west1',
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  (req, res) =>
    cors(req, res, async () => {
      try {
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

        const imageBase64 = (req.body && req.body.imageBase64) || '';
        const mimeType = (req.body && req.body.mimeType) || 'image/jpeg';
        if (!imageBase64) { res.status(400).json({ error: 'Missing imageBase64' }); return; }

        const apiKey = OPENAI_API_KEY.value();
        if (!apiKey) { res.status(500).json({ error: 'Missing OPENAI_API_KEY secret' }); return; }

        const systemPrompt =
          'Sei un sistema OCR specializzato in fatture italiane. ' +
          'Analizza l\'immagine della fattura e restituisci SOLO un oggetto JSON valido con questi campi ' +
          '(usa null se non trovi il valore): ' +
          '{ "invoiceNumber": string|null, "date": "YYYY-MM-DD"|null, "dueDate": "YYYY-MM-DD"|null, ' +
          '"amount": number|null, "vat": number|null, "description": string|null, "supplierName": string|null }. ' +
          'amount = imponibile (senza IVA). vat = percentuale IVA (es. 22). ' +
          'Non aggiungere testo prima o dopo il JSON.';

        const body = {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' },
                },
                { type: 'text', text: 'Estrai i dati dalla fattura e restituisci solo il JSON.' },
              ],
            },
          ],
          max_tokens: 512,
          temperature: 0,
        };

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const text = await resp.text();
        const data = safeJsonParse(text, null);
        if (!resp.ok) {
          const msg = (data && (data.error?.message || data.message)) || text || 'Errore OpenAI';
          throw new Error(msg);
        }

        const raw = data?.choices?.[0]?.message?.content || '';
        // GPT models sometimes wrap JSON in markdown code fences (e.g. ```json ... ```)
        // despite explicit instructions not to. Strip them before parsing.
        const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = safeJsonParse(jsonStr, {});
        res.status(200).json(parsed);
      } catch (err) {
        logger.error('analyzeInvoice error', err);
        res.status(500).json({ error: String(err?.message || err || 'Errore') });
      }
    })
);
