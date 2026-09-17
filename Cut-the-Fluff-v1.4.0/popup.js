const $ = (selector) => document.querySelector(selector);
const elements = {
  scan: $("#page-scan"), scanCard: $(".scan-card"), scanDescription: $("#scan-description"),
  input: $("#input"), clear: $("#clear"), count: $("#char-count"), tone: $("#tone"),
  run: $("#run"), runLabel: $(".run-label"), status: $("#status"), outputWrap: $("#output-wrap"),
  output: $("#output"), savings: $("#savings"), resultMeta: $("#result-meta"),
  copy: $("#copy"), tryAgain: $("#try-again")
};
let activeTabId = null;
let lastOutput = "";
let isRewriting = false;

init();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "CF_SELECTION_CHANGED" || sender.tab?.id !== activeTabId) return;
  const selected = String(message.payload?.formattedText || message.payload?.text || "").trim();
  if (!selected) return;
  elements.input.value = selected.slice(0, 30000);
  lastOutput = "";
  elements.outputWrap.classList.add("hidden");
  updateEditor();
  chrome.storage.local.set({ draft: elements.input.value });
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  const saved = await chrome.storage.local.get(["draft", "rewriteStyle"]);
  elements.input.value = saved.draft || "";
  elements.tone.value = ["shorten", "human", "professional"].includes(saved.rewriteStyle) ? saved.rewriteStyle : "human";
  updateEditor();
  await syncTabState();
  await importPageSelection({ silent: true });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  await syncTabState();
  await importPageSelection({ silent: true });
});

async function syncTabState() {
  if (!activeTabId) return;
  try {
    const state = await chrome.tabs.sendMessage(activeTabId, { type: "CF_GET_SCAN_STATE" });
    setScanUI(Boolean(state?.enabled), state?.count || 0);
  } catch (_) { setScanUI(false, 0); }
}

elements.input.addEventListener("input", () => {
  updateEditor();
  chrome.storage.local.set({ draft: elements.input.value.slice(0, 30000) });
});
elements.tone.addEventListener("change", () => chrome.storage.local.set({ rewriteStyle: elements.tone.value }));
elements.clear.addEventListener("click", async () => {
  elements.input.value = "";
  lastOutput = "";
  elements.outputWrap.classList.add("hidden");
  updateEditor();
  await chrome.storage.local.set({ draft: "" });
  elements.input.focus();
});

function updateEditor() {
  const length = elements.input.value.length;
  elements.count.textContent = `${length.toLocaleString()} / 30,000`;
  elements.clear.classList.toggle("hidden", !length);
}

$("#settings-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#footer-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#use-selection").addEventListener("click", () => importPageSelection({ silent: false }));

async function importPageSelection({ silent }) {
  clearStatus();
  if (!activeTabId) return false;
  try {
    await ensureContentScript(activeTabId);
    const payload = await chrome.tabs.sendMessage(activeTabId, { type: "CF_GET_SELECTION_PAYLOAD" });
    const selected = String(payload?.formattedText || payload?.text || "").trim();
    if (!selected) {
      if (!silent) showError("Select some text on the page, then reopen the extension.");
      return false;
    }
    elements.input.value = selected.slice(0, 30000);
    lastOutput = "";
    elements.outputWrap.classList.add("hidden");
    updateEditor();
    await chrome.storage.local.set({ draft: elements.input.value });
    return true;
  } catch (_) {
    if (!silent) showError("Chrome does not allow access to this page.");
    return false;
  }
}

elements.scan.addEventListener("change", async () => {
  clearStatus();
  const desired = elements.scan.checked;
  if (!activeTabId) return setScanUI(false, 0);
  try {
    await ensureContentScript(activeTabId);
    if (desired) elements.scanDescription.textContent = "Reviewing visible writing patterns…";
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "CF_SET_SCAN", enabled: desired });
    setScanUI(Boolean(response?.enabled), response?.count || 0);
  } catch (_) {
    setScanUI(false, 0);
    showError("Scanning is unavailable on this Chrome page.");
  }
});

async function ensureContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: "CF_PING" }); }
  catch (_) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

function setScanUI(enabled, count) {
  elements.scan.checked = enabled;
  elements.scanCard.classList.toggle("active", enabled);
  elements.scanDescription.textContent = enabled
    ? `${count} passage${count === 1 ? "" : "s"} highlighted on this tab. Click a badge to rewrite.`
    : "Highlights common filler patterns on this tab. It does not determine who wrote the text.";
}

elements.run.addEventListener("click", runRewrite);
elements.tryAgain.addEventListener("click", runRewrite);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    if (event.target.closest?.("button, select, a, #output")) return;
    event.preventDefault();
    runRewrite();
  }
});

async function runRewrite() {
  if (isRewriting) return;
  const text = elements.input.value.trim();
  if (!text) { showError("Add or select some text first."); elements.input.focus(); return; }
  isRewriting = true;
  setLoading(true);
  clearStatus();
  elements.outputWrap.classList.add("hidden");
  try {
    const style = elements.tone.value;
    const response = await chrome.runtime.sendMessage({ type: "CF_REWRITE_REQUEST", text, style });
    if (!response || response.error) return handleError(response || { error: "unknown" });
    lastOutput = response.text;
    renderMarkdown(elements.output, lastOutput);
    const before = wordCount(text), after = wordCount(lastOutput);
    const reduction = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    elements.savings.textContent = style === "shorten" && reduction > 0 ? `${reduction}% shorter` : `${after} words`;
    elements.resultMeta.textContent = style === "shorten" ? `${before} → ${after} words` : `${labelFor(style)} rewrite`;
    elements.outputWrap.classList.remove("hidden");
    elements.output.focus();
  } catch (_) { showError("Could not reach the extension service. Try again."); }
  finally { isRewriting = false; setLoading(false); }
}

function labelFor(style) { return style === "professional" ? "Professional" : style === "shorten" ? "Shortened" : "Human"; }
function handleError(response) {
  if (response.error === "no-key") {
    showError("Connect an AI provider in Settings first.");
    setTimeout(() => chrome.runtime.openOptionsPage(), 700);
    return;
  }
  const messages = {
    "invalid-key": "That API key was rejected. Check it in Settings.",
    "rate-limit": "Your provider rate limit was reached. Try again shortly.",
    "too-long": "That text is too long for this request.",
    "empty-response": "The provider returned no text. Try again.",
    "truncated-output": "The provider stopped early. Try again or choose a model with a larger output limit."
  };
  showError(messages[response.error] || response.detail || "Rewrite failed. Check Settings and try again.");
}
function setLoading(loading) {
  elements.run.disabled = loading;
  elements.tryAgain.disabled = loading;
  elements.runLabel.textContent = loading ? "Rewriting…" : "Cut the fluff";
}
function wordCount(value) { return value.trim() ? value.trim().split(/\s+/).length : 0; }
function showError(message) { elements.status.textContent = message; elements.status.className = "status error"; }
function clearStatus() { elements.status.textContent = ""; elements.status.className = "status"; }

elements.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastOutput);
    const label = elements.copy.querySelector("span");
    label.textContent = "Copied";
    setTimeout(() => { label.textContent = "Copy result"; }, 1400);
  } catch (_) { showError("Could not copy automatically. Select the result and copy it."); }
});

function renderMarkdown(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown || "").split("\n");
  lines.forEach((line, index) => {
    appendInline(container, line);
    if (index < lines.length - 1) container.append(document.createElement("br"));
  });
}
function appendInline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0, match;
  while ((match = pattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    const element = document.createElement(token.startsWith("**") || token.startsWith("__") ? "strong" : token.startsWith("`") ? "code" : "em");
    element.textContent = token.startsWith("**") || token.startsWith("__") ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(element);
    cursor = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}
