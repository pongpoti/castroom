/**
 * api/ocr.js — server-side proxy to Typhoon OCR.
 *
 * The key stays here. A browser-side call would ship it inside the JS bundle,
 * where anyone loading the page can read it and spend it, so the image is
 * posted to this function and the upstream request is made from the server.
 *
 * This is also the one place patient data leaves the device, which is why the
 * image is forwarded and nothing about it is logged or stored.
 */

const TYPHOON_URL = 'https://api.opentyphoon.ai/v1/chat/completions';
const MODEL = process.env.TYPHOON_MODEL || 'typhoon-ocr';

/** Roughly 4.5MB is the platform's body limit; stay well inside it. */
const MAX_IMAGE_CHARS = 3_500_000;

const PROMPT = [
  'Read this Thai hospital form footer and return its text exactly as printed.',
  'Preserve every Thai tone mark, vowel and the karan (ทัณฑฆาต) precisely —',
  'they are part of a patient name and must not be dropped or normalised.',
  'Return the text only, one printed line per output line.',
].join(' ');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const apiKey = process.env.TYPHOON_API_KEY;
  if (!apiKey) {
    // 503 rather than 500: the deployment is simply not configured for remote
    // recognition, and the client should fall back rather than surface a bug.
    return res.status(503).json({ error: 'not-configured' });
  }

  const image = req.body?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'bad-image' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ error: 'image-too-large' });
  }

  try {
    const upstream = await fetch(TYPHOON_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        temperature: 0.1,
        top_p: 0.6,
        repetition_penalty: 1.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({
        error: 'upstream-failed',
        status: upstream.status,
        // Truncated: enough to diagnose, not enough to echo a whole payload.
        detail: detail.slice(0, 400),
      });
    }

    const body = await upstream.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return res.status(502).json({ error: 'no-content' });
    }
    return res.status(200).json({ content });
  } catch (e) {
    return res.status(502).json({ error: 'request-failed', detail: String(e?.message ?? e) });
  }
}
