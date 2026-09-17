const MENU_CUT = "ctf-cut";
const MAX_INPUT_CHARS = 30000;

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_CUT, title: "Cut the Fluff", contexts: ["selection"] });
  });
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_CUT || !tab?.id) return;
  await rewriteSelectionOnTab(tab.id, Number.isInteger(info.frameId) ? info.frameId : 0, info.selectionText || "", "human");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "cut-the-fluff") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await rewriteSelectionOnTab(tab.id, 0, "", "human");
});

async function rewriteSelectionOnTab(tabId, frameId, fallbackText, style) {
  try {
    await ensureContentScript(tabId, frameId);
    const payload = await chrome.tabs.sendMessage(tabId, { type: "CF_GET_SELECTION_PAYLOAD" }, { frameId }).catch(() => null);
    const source = String(payload?.formattedText || payload?.text || fallbackText || "").trim().slice(0, MAX_INPUT_CHARS);
    if (!source) {
      await chrome.tabs.sendMessage(tabId, { type: "CF_RESULT", variant: style, error: "empty-input", detail: "Select some text first." }, { frameId });
      return;
    }
    await chrome.tabs.sendMessage(tabId, { type: "CF_LOADING", variant: style, original: source }, { frameId });
    const result = await rewrite(source, style);
    await chrome.tabs.sendMessage(tabId, { type: "CF_RESULT", variant: style, original: source, ...result }, { frameId });
  } catch (_) {
    // Chrome blocks extension injection on internal and protected pages.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CF_REWRITE_REQUEST") {
    const text = String(message.text || "").slice(0, MAX_INPUT_CHARS);
    const style = normalizeStyle(message.style, message.mode, message.tone);
    rewrite(text, style).then(sendResponse);
    return true;
  }
  if (message?.type === "CF_TEST_CONNECTION") {
    testConnection().then(sendResponse);
    return true;
  }
  if (message?.type === "CF_SCAN_REQUEST") {
    const samples = Array.isArray(message.samples)
      ? message.samples.slice(0, 24).map((sample, index) => ({ index, text: String(sample?.text || "").slice(0, 1800) })).filter((sample) => sample.text.trim())
      : [];
    scanWritingSamples(samples).then(sendResponse);
    return true;
  }
  if (message?.type === "CF_OPEN_OPTIONS") chrome.runtime.openOptionsPage();
});

function normalizeStyle(style, mode, tone) {
  if (["shorten", "human", "professional"].includes(style)) return style;
  if (mode === "condense") return "shorten";
  if (tone === "professional") return "professional";
  return "human";
}

async function ensureContentScript(tabId, frameId = 0) {
  try { await chrome.tabs.sendMessage(tabId, { type: "CF_PING" }, { frameId }); }
  catch (_) {
    const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
    await chrome.scripting.insertCSS({ target, files: ["content.css"] });
    await chrome.scripting.executeScript({ target, files: ["content.js"] });
  }
}

async function getSettings() {
  const defaults = { provider: "anthropic", apiKey: "", model: "claude-sonnet-5" };
  const stored = await chrome.storage.local.get(["provider", "apiKey", "model", "anthropicModel", "openaiModel", "geminiModel"]);
  const legacyModel = stored[`${stored.provider || defaults.provider}Model`];
  return { ...defaults, ...stored, model: stored.model || legacyModel || defaults.model };
}

const FORMAT_RULES = `Non-negotiable output rules:
- Return only the finished rewrite. Do not add a preface, explanation, note, label, or closing comment.
- Do not add a title, heading, section name, bullet list, numbered list, quotation, bold text, italics, or code formatting unless that type of formatting already exists in the source.
- If the source contains Markdown, preserve its structure and apply its existing emphasis only to the equivalent rewritten words. Never expose, escape, duplicate, or invent Markdown markers.
- Do not use an em dash, en dash, or double hyphen as prose punctuation. Use a period, comma, colon, or parentheses instead. Keep ordinary hyphens only inside established compound words, names, numeric ranges, or source code.
- Preserve the source language, meaning, position, names, numbers, dates, links, citations, instructions, necessary qualifications, and factual claims. Do not invent facts or stronger claims.
- Keep technical terms that are necessary for accuracy, but replace unnecessary academic, corporate, and marketing jargon with ordinary words.
- Do not restate the same point in a summary or add a concluding paragraph unless the source contains a distinct conclusion.
- Before returning, silently remove any canned transition, artificial symmetry, unnecessary heading, new Markdown, or dash-based aside that slipped into the draft.`;

const STYLE_PROMPTS = {
  human: `Rewrite the text as a real person would naturally write it to another capable person.

The voice should feel clear, relaxed, and unforced, not polished for effect. Use familiar words, natural contractions where they fit, and a mix of short and medium-length sentences. Keep the writer's original attitude, whether it is casual, serious, skeptical, frustrated, warm, or factual. Prefer simple verbs and concrete wording. Keep necessary technical terms, names, and details, but do not replace ordinary language with jargon.

Do not organize the writing more neatly than a person normally would. Do not create tidy sections, matching sentence patterns, rhetorical three-part lists, dramatic contrasts, or a formal conclusion. Avoid phrases such as "it is important to note," "moreover," "furthermore," "ultimately," "overall," "this highlights," "this underscores," "key takeaway," "strategic implication," "in today's world," "delve," "leverage," "robust," "seamless," "pivotal," and "plays a crucial role."

Do not manufacture spelling mistakes, bad grammar, slang, or fake personality. Human means natural and specific, not careless. Keep every substantive fact, example, question, qualification, and conclusion. Remove only genuine repetition, filler, and robotic phrasing. Keep roughly the same amount of useful information as the source.`,

  professional: `Rewrite the text in the voice of an experienced CEO or operator communicating directly to employees, customers, investors, or the public.

Lead with the point. Use active voice, concrete nouns, direct verbs, and short purposeful paragraphs. Sound informed, calm, decisive, and specific. Keep factual qualifications when they matter, but remove timid wording, repetition, throat-clearing, academic padding, and empty formality. The result may be slightly tighter than the source, but it must retain every material fact, number, condition, action, risk, and conclusion.

Do not sound like a consultant, press release, motivational speaker, or AI assistant. Do not add slogans, hashtags, emojis, inflated claims, artificial urgency, or headings such as "Strategic implication," "Key takeaway," "Why it matters," or "Moving forward" unless they already appear in the source. Avoid corporate filler such as "leverage," "synergy," "robust," "holistic," "seamless," "transformative," "unlock value," and "drive impact."

Write with the confidence of someone who understands the subject and respects the reader's time. Do not imitate any named person or copy a public figure's distinctive wording.`,

  shorten: `Create the shortest clear version that still gives the reader the complete information needed to understand the point or act on it.

Keep the main claim or conclusion, essential facts, names, numbers, dates, decisions, actions, constraints, warnings, and qualifications that change the meaning. Keep supporting reasoning only when the conclusion would be unclear or misleading without it.

Remove repeated ideas, scene-setting, throat-clearing, rhetorical questions that add no information, decorative adjectives, generic transitions, side comments, obvious explanations, and examples that merely repeat the point. Merge related sentences and use direct wording. Aim for a substantial reduction, usually around 40 to 60 percent when the source allows it, but never cut a detail the reader needs.

Do not replace the removed text with a summary heading, bullet list, "key takeaway," or concluding restatement. The result should read like concise human writing, not a generated summary.`
};

async function rewrite(text, style) {
  if (!text.trim()) return { error: "empty-input", detail: "Select or enter some text first." };
  const settings = await getSettings();
  if (!settings.apiKey) return { error: "no-key" };
  const instruction = `${STYLE_PROMPTS[style]}\n\n${FORMAT_RULES}`;
  const maxTokens = Math.min(8192, Math.max(2048, Math.ceil(text.length / 2) + 512));
  try {
    if (settings.provider === "openai") return await callOpenAI(text, instruction, maxTokens, settings);
    if (settings.provider === "gemini") return await callGemini(text, instruction, maxTokens, settings);
    return await callAnthropic(text, instruction, maxTokens, settings);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) return { error: "invalid-key" };
    if (error?.status === 429) return { error: "rate-limit" };
    return { error: "request-failed", detail: cleanMessage(error?.message || String(error)) };
  }
}

async function callAnthropic(text, instruction, maxTokens, settings) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: settings.model, max_tokens: maxTokens, temperature: 0.15, system: instruction, messages: [{ role: "user", content: text }] })
  });
  await assertOk(response);
  const data = await response.json();
  if (data.stop_reason === "max_tokens") return { error: "truncated-output" };
  return normalizeOutput((data.content || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n"));
}

async function callOpenAI(text, instruction, maxTokens, settings) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model, instructions: instruction, input: text, max_output_tokens: maxTokens })
  });
  await assertOk(response);
  const data = await response.json();
  if (data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens") return { error: "truncated-output" };
  const output = data.output_text || (data.output || []).flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text || "").join("\n");
  return normalizeOutput(output);
}

async function callGemini(text, instruction, maxTokens, settings) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.15, maxOutputTokens: maxTokens } })
  });
  await assertOk(response);
  const data = await response.json();
  if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") return { error: "truncated-output" };
  const output = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n");
  return normalizeOutput(output);
}

function normalizeOutput(output) {
  const text = String(output || "").trim();
  return text ? { text } : { error: "empty-response" };
}

async function scanWritingSamples(samples) {
  if (!samples.length) return { results: [] };
  const settings = await getSettings();
  if (!settings.apiKey) return { error: "no-key", results: [] };
  const instruction = `Act as a careful writing-style reviewer. Assess each numbered sample for clusters of AI-like writing patterns, not authorship. Look for formulaic transitions, overly uniform sentence rhythm, generic formal wording, inflated abstractions, symmetrical list structures, repetition, canned framing, and unnatural filler. A single polished phrase is not enough. Score each sample from 0 to 100 for how strongly those patterns appear. Give up to three short, concrete reasons. Return ONLY a valid JSON array in this exact shape: [{"index":0,"score":72,"reasons":["formulaic transitions","uniform sentence rhythm"]}]. Include every supplied index exactly once. Do not use Markdown.`;
  const input = JSON.stringify(samples);
  try {
    let response;
    if (settings.provider === "openai") response = await callOpenAI(input, instruction, 2500, settings);
    else if (settings.provider === "gemini") response = await callGemini(input, instruction, 2500, settings);
    else response = await callAnthropic(input, instruction, 2500, settings);
    if (response.error) return { error: response.error, results: [] };
    const parsed = parseJsonArray(response.text);
    const results = parsed.map((item) => ({
      index: Number(item.index),
      score: Math.max(0, Math.min(100, Number(item.score) || 0)),
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3).map((reason) => cleanMessage(reason).slice(0, 60)) : []
    })).filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < samples.length);
    return { results };
  } catch (error) {
    return { error: "scan-failed", detail: cleanMessage(error?.message || String(error)), results: [] };
  }
}

function parseJsonArray(value) {
  const cleaned = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("["); const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try { const parsed = JSON.parse(cleaned.slice(start, end + 1)); return Array.isArray(parsed) ? parsed : []; }
  catch (_) { return []; }
}

async function assertOk(response) {
  if (response.ok) return;
  let message = "";
  try { const data = await response.json(); message = data.error?.message || data.message || ""; }
  catch (_) { message = await response.text().catch(() => ""); }
  const error = new Error(cleanMessage(message) || `Provider returned HTTP ${response.status}`);
  error.status = response.status;
  throw error;
}

function cleanMessage(value) { return String(value).replace(/[\r\n]+/g, " ").slice(0, 220); }

async function testConnection() {
  const settings = await getSettings();
  if (!settings.apiKey) return { ok: false, detail: "Add a key" };
  try {
    let response;
    if (settings.provider === "anthropic") response = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    else if (settings.provider === "openai") response = await fetch("https://api.openai.com/v1/models", { headers: { "authorization": `Bearer ${settings.apiKey}` } });
    else response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(settings.apiKey)}`);
    await assertOk(response);
    return { ok: true };
  } catch (error) { return { ok: false, detail: cleanMessage(error.message) }; }
}
