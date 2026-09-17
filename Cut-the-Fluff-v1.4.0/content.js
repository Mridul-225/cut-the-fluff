(() => {
  if (window.__cutTheFluffLoaded) return;
  window.__cutTheFluffLoaded = true;

  let card = null;
  let cardGeometry = null;
  let scanEnabled = false;
  let scanObserver = null;
  let scanTimer = null;
  let scanInProgress = false;
  let lastRect = null;
  let lastEditable = null;
  let lastRange = null;
  let lastInputSelection = null;
  let lastPayload = { text: "", formattedText: "" };

  document.addEventListener("contextmenu", () => captureSelection(true), true);
  document.addEventListener("mouseup", () => captureSelection(true), true);
  document.addEventListener("keyup", () => captureSelection(true), true);
  captureSelection();

  function captureSelection(notify = false) {
    const active = document.activeElement;
    if ((active?.tagName === "TEXTAREA" || active?.tagName === "INPUT") && active.selectionStart !== active.selectionEnd) {
      const start = active.selectionStart ?? 0, end = active.selectionEnd ?? start;
      const text = active.value.slice(start, end);
      lastEditable = active;
      lastInputSelection = { start, end };
      lastRange = null;
      lastRect = active.getBoundingClientRect();
      lastPayload = { text, formattedText: text };
      if (notify) notifySelectionChanged();
      return lastPayload;
    }
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const text = selection.toString();
      if (text.trim()) {
        lastRect = range.getBoundingClientRect();
        lastEditable = findEditable(range.commonAncestorContainer);
        lastRange = range.cloneRange();
        lastInputSelection = null;
        lastPayload = { text, formattedText: rangeToMarkdown(range) || text };
      }
    }
    if (notify && lastPayload.text.trim()) notifySelectionChanged();
    return lastPayload;
  }

  function notifySelectionChanged() {
    chrome.runtime.sendMessage({ type: "CF_SELECTION_CHANGED", payload: lastPayload }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "CF_PING") { sendResponse({ ok: true }); return; }
    if (message.type === "CF_GET_SELECTION_PAYLOAD") { captureSelection(); sendResponse(lastPayload); return; }
    if (message.type === "CF_GET_SCAN_STATE") { sendResponse({ enabled: scanEnabled, count: badgeCount() }); return; }
    if (message.type === "CF_SET_SCAN") {
      setScan(Boolean(message.enabled)).then((count) => sendResponse({ enabled: scanEnabled, count }));
      return true;
    }
    if (message.type === "CF_LOADING") {
      removeCard(false);
      cardGeometry = defaultCardGeometry();
      showCard({ loading: true, variant: message.variant || "human", original: message.original });
    }
    if (message.type === "CF_RESULT") showCard({ loading: false, variant: message.variant || "human", original: message.original, text: message.text, error: message.error, detail: message.detail });
  });

  async function setScan(enabled) {
    scanEnabled = enabled;
    if (!enabled) {
      scanObserver?.disconnect(); scanObserver = null; clearScan(); return 0;
    }
    const { sensitivity = 45 } = await chrome.storage.local.get("sensitivity");
    clearScan();
    await scanPage(sensitivity);
    if (!scanObserver) {
      scanObserver = new MutationObserver(() => {
        if (scanInProgress) return;
        clearTimeout(scanTimer);
        scanTimer = setTimeout(async () => {
          if (!scanEnabled) return;
          const settings = await chrome.storage.local.get("sensitivity");
          await scanPage(settings.sensitivity ?? 45);
        }, 700);
      });
      scanObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
    return badgeCount();
  }

  function showCard({ loading, variant = "human", original, text, error, detail }) {
    rememberCardGeometry();
    removeCard(false);
    card = document.createElement("section");
    card.className = "ctf-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Cut the Fluff result");

    const head = document.createElement("div"); head.className = "ctf-card-head";
    const title = document.createElement("div"); title.className = "ctf-title";
    const mark = document.createElement("span"); mark.className = "ctf-mark"; mark.textContent = "≡";
    const titleText = document.createElement("span"); titleText.textContent = loading ? "Rewriting…" : error ? "Couldn’t rewrite" : "Cut the Fluff";
    const dragHint = document.createElement("span"); dragHint.className = "ctf-drag-hint"; dragHint.textContent = "Made by MOB · Drag";
    const close = document.createElement("button"); close.className = "ctf-close"; close.type = "button"; close.setAttribute("aria-label", "Close"); close.textContent = "×";
    title.append(mark, titleText, dragHint); head.append(title, close); card.append(head);

    const body = document.createElement("div"); body.className = "ctf-card-body";
    if (loading) { body.classList.add("ctf-loading"); body.textContent = "Keeping every detail and the original formatting"; }
    else if (error === "no-key") body.textContent = "Connect an AI provider in Settings before rewriting.";
    else if (error) { body.classList.add("ctf-error"); body.textContent = errorMessage(error, detail); }
    else renderMarkdown(body, text);
    card.append(body);

    if (!loading && !error && original) card.append(makeVariants(variant, original));
    if (!loading) {
      const actions = document.createElement("div"); actions.className = "ctf-card-actions";
      if (error === "no-key") actions.append(makeButton("Open settings", "ctf-primary", () => chrome.runtime.sendMessage({ type: "CF_OPEN_OPTIONS" })));
      else if (!error) {
        actions.append(makeButton("Copy", "", async (button) => {
          await navigator.clipboard.writeText(text);
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = "Copy"; }, 1200);
        }));
        if (lastEditable || lastRange) actions.append(makeButton("Replace selection", "ctf-primary", () => { replaceSelection(text); removeCard(); }));
      }
      if (actions.children.length) card.append(actions);
    }

    (document.body || document.documentElement).append(card);
    if (cardGeometry) applyGeometry(cardGeometry); else positionCard(card);
    enableDragging(card, head);
    close.addEventListener("click", () => removeCard());
    setTimeout(() => document.addEventListener("mousedown", outsideClick, true), 0);
  }

  function makeVariants(activeVariant, original) {
    const variants = document.createElement("label"); variants.className = "ctf-style-control";
    const label = document.createElement("span"); label.textContent = "Style";
    const select = document.createElement("select"); select.className = "ctf-style-select"; select.setAttribute("aria-label", "Rewrite style");
    const choices = [
      { id: "human", label: "Human" },
      { id: "professional", label: "Professional" },
      { id: "shorten", label: "Shorten" }
    ];
    choices.forEach((choice) => {
      const option = document.createElement("option"); option.value = choice.id; option.textContent = choice.label; option.selected = choice.id === activeVariant; select.append(option);
    });
    select.addEventListener("change", async () => {
      const style = select.value;
      showCard({ loading: true, variant: style, original });
      const result = await chrome.runtime.sendMessage({ type: "CF_REWRITE_REQUEST", text: original, style });
      showCard({ loading: false, variant: style, original, ...result });
    });
    variants.append(label, select);
    return variants;
  }

  function errorMessage(error, detail) {
    if (error === "truncated-output") return "The provider stopped before finishing. Try again or choose a model with a larger output limit.";
    if (error === "empty-input") return detail || "Select some text first.";
    return detail || "The provider could not complete this request.";
  }

  function makeButton(label, extraClass, handler) {
    const button = document.createElement("button"); button.type = "button"; button.className = `ctf-btn ${extraClass}`.trim(); button.textContent = label;
    button.addEventListener("click", () => handler(button)); return button;
  }
  function rememberCardGeometry() {
    if (!card?.isConnected) return;
    const rect = card.getBoundingClientRect();
    cardGeometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  function applyGeometry(geometry) {
    const width = Math.min(geometry.width, innerWidth - 24), height = Math.min(geometry.height, innerHeight - 24);
    card.style.width = `${Math.max(300, width)}px`;
    card.style.height = `${Math.max(220, height)}px`;
    card.style.left = `${Math.max(12, Math.min(geometry.left, innerWidth - width - 12))}px`;
    card.style.top = `${Math.max(12, Math.min(geometry.top, innerHeight - height - 12))}px`;
  }
  function defaultCardGeometry() {
    const anchor = lastRect || { left: 24, right: 24, top: 96, bottom: 96 };
    const width = Math.min(430, Math.max(300, innerWidth - 24));
    const height = Math.min(500, Math.max(280, innerHeight - 32));
    let left;
    if (innerWidth - anchor.right >= width + 16) left = anchor.right + 12;
    else if (anchor.left >= width + 16) left = anchor.left - width - 12;
    else left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12));
    const top = Math.max(12, Math.min(anchor.top - 24, innerHeight - height - 12));
    return { left, top, width, height };
  }
  function removeCard(saveGeometry = true) {
    if (saveGeometry) rememberCardGeometry();
    card?.remove(); card = null;
    document.removeEventListener("mousedown", outsideClick, true);
  }
  function outsideClick(event) { if (card && !card.contains(event.target)) removeCard(); }
  function positionCard(element) { cardGeometry = defaultCardGeometry(); applyGeometry(cardGeometry); }
  function enableDragging(element, handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = element.getBoundingClientRect();
      const offsetX = event.clientX - rect.left, offsetY = event.clientY - rect.top;
      handle.setPointerCapture(event.pointerId);
      element.classList.add("ctf-dragging");
      const move = (moveEvent) => {
        const left = Math.max(8, Math.min(moveEvent.clientX - offsetX, innerWidth - element.offsetWidth - 8));
        const top = Math.max(8, Math.min(moveEvent.clientY - offsetY, innerHeight - element.offsetHeight - 8));
        element.style.left = `${left}px`; element.style.top = `${top}px`;
      };
      const up = () => {
        element.classList.remove("ctf-dragging");
        rememberCardGeometry();
        handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
    });
  }

  function findEditable(node) {
    let element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (element) {
      if (element.tagName === "TEXTAREA" || element.tagName === "INPUT" || element.isContentEditable) return element;
      element = element.parentElement;
    }
    return null;
  }

  function replaceSelection(markdown) {
    if (lastEditable?.tagName === "TEXTAREA" || lastEditable?.tagName === "INPUT") {
      const start = lastInputSelection?.start ?? lastEditable.selectionStart ?? 0;
      const end = lastInputSelection?.end ?? lastEditable.selectionEnd ?? start;
      const setter = Object.getOwnPropertyDescriptor(lastEditable.constructor.prototype, "value")?.set;
      const next = lastEditable.value.slice(0, start) + markdown + lastEditable.value.slice(end);
      setter ? setter.call(lastEditable, next) : (lastEditable.value = next);
      lastEditable.selectionStart = lastEditable.selectionEnd = start + markdown.length;
      lastEditable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: markdown }));
      return;
    }
    if (lastRange && document.contains(lastRange.commonAncestorContainer)) {
      const fragment = markdownToFragment(markdown);
      const lastNode = fragment.lastChild;
      lastRange.deleteContents();
      lastRange.insertNode(fragment);
      if (lastNode) {
        const selection = window.getSelection(); const range = document.createRange();
        range.setStartAfter(lastNode); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
      }
      lastEditable?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: markdown.replace(/[*_`]/g, "") }));
    }
  }

  function renderMarkdown(container, markdown) { container.replaceChildren(markdownToFragment(markdown)); }
  function markdownToFragment(markdown) {
    const fragment = document.createDocumentFragment();
    String(markdown || "").split("\n").forEach((line, index, lines) => {
      appendInline(fragment, line);
      if (index < lines.length - 1) fragment.append(document.createElement("br"));
    });
    return fragment;
  }
  function appendInline(parent, text) {
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0, match;
    while ((match = pattern.exec(text))) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      const element = document.createElement(token.startsWith("**") || token.startsWith("__") ? "strong" : token.startsWith("`") ? "code" : "em");
      element.textContent = token.startsWith("**") || token.startsWith("__") ? token.slice(2, -2) : token.slice(1, -1);
      parent.append(element); cursor = match.index + token.length;
    }
    parent.append(document.createTextNode(text.slice(cursor)));
  }

  function rangeToMarkdown(range) {
    const holder = document.createElement("div"); holder.append(range.cloneContents());
    return childrenToMarkdown(holder).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function childrenToMarkdown(node) { return Array.from(node.childNodes).map(nodeToMarkdown).join(""); }
  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase(), content = childrenToMarkdown(node);
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return content.trim() ? `**${content}**` : content;
    if (tag === "em" || tag === "i") return content.trim() ? `*${content}*` : content;
    if (tag === "code") return content.trim() ? `\`${content}\`` : content;
    if (tag === "li") return `${node.parentElement?.tagName === "OL" ? "1." : "-"} ${content.trim()}\n`;
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (["p", "div", "section", "article", "blockquote"].includes(tag)) return `${content.trim()}\n\n`;
    return content;
  }

  const SIGNAL_GROUPS = [
    { name: "canned phrasing", patterns: [/in (today'?s|this) .{0,20}world/i,/it'?s (important|worth) (to note|noting)/i,/\b(delving|delve) into\b/i,/a testament to/i,/plays? a (crucial|vital|significant|key|essential) role/i,/in the realm of/i,/a myriad of/i,/in conclusion/i] },
    { name: "corporate wording", patterns: [/\bleverage\b/i,/seamless(ly)?/i,/\brobust\b/i,/\bholistic\b/i,/\bstreamline(s|d)?\b/i,/actionable insights/i,/strategic advantage/i,/comprehensive (approach|overview|framework|solution)/i,/advanced (technology|technologies|capabilities|solution)/i] },
    { name: "formulaic transitions", patterns: [/\bfurthermore\b/i,/\bmoreover\b/i,/\badditionally\b/i,/\bultimately\b/i,/\boverall\b/i,/moving forward/i,/to break (that|this) down/i,/high-level overview/i] },
    { name: "inflated language", patterns: [/unlock (the|your) (full )?potential/i,/navigate the complexit/i,/cutting-edge/i,/game[- ]chang/i,/paradigm shift/i,/\bunderscore(s|d)?\b/i,/\belevate(s|d)?\b/i,/unique strategic advantage/i] },
    { name: "filler", patterns: [/\b(basically|literally|essentially|fundamentally)\b/i,/\b(sort of|kind of|you know)\b/i,/initiating .{0,20}protocol/i,/dynamic .{0,24}(matrix|mechanics|framework)/i] }
  ];

  function analyzeText(text) {
    const words = text.trim().split(/\s+/).filter(Boolean); if (words.length < 10) return { score: 0, reasons: [] };
    const reasons = []; let phraseHits = 0;
    SIGNAL_GROUPS.forEach((group) => {
      const hits = group.patterns.reduce((sum, pattern) => sum + Number(pattern.test(text)), 0);
      if (hits) { phraseHits += hits; reasons.push(group.name); }
    });
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length > 10);
    let structureScore = 0;
    if (sentences.length >= 3) {
      const lengths = sentences.map((sentence) => sentence.trim().split(/\s+/).length);
      const average = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const deviation = Math.sqrt(lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length);
      if (average >= 18 && deviation < 6) { structureScore += 18; reasons.push("uniform sentence rhythm"); }
      const openings = sentences.map((sentence) => sentence.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase());
      if (new Set(openings).size <= Math.ceil(openings.length * .65)) { structureScore += 12; reasons.push("repeated sentence openings"); }
    }
    const formalHits = text.match(/\b(significant|essential|innovative|transformative|comprehensive|increasingly|multifaceted|pivotal|critical|sophisticated)\b/gi)?.length || 0;
    if (formalHits >= 2) reasons.push("generic formal wording");
    const fillerHits = text.match(/\b(like|um|basically|literally|actually|you know)\b/gi)?.length || 0;
    const density = phraseHits / Math.max(1, words.length / 75);
    const score = Math.min(100, Math.round(density * 25 + Math.min(22, formalHits * 5) + Math.min(18, fillerHits * 4) + structureScore));
    return { score, reasons: [...new Set(reasons)].slice(0, 3) };
  }

  async function scanPage(threshold) {
    scanInProgress = true;
    try {
      const analyses = candidateBlocks().filter((element) => !element.dataset.ctfScanned).map((element) => {
        element.dataset.ctfScanned = "true";
        const text = element.innerText?.trim() || element.textContent.trim();
        return { element, text, ...analyzeText(text) };
      }).slice(0, 24);
      let reviewed = analyses;
      if (analyses.length) {
        const providerReview = await chrome.runtime.sendMessage({ type: "CF_SCAN_REQUEST", samples: analyses.map((item) => ({ text: item.text })) }).catch(() => null);
        if (providerReview?.results?.length) {
          const byIndex = new Map(providerReview.results.map((item) => [item.index, item]));
          reviewed = analyses.map((item, index) => {
            const external = byIndex.get(index);
            if (!external) return item;
            return {
              ...item,
              score: Math.round(external.score * .75 + item.score * .25),
              reasons: [...new Set([...(external.reasons || []), ...item.reasons])].slice(0, 3)
            };
          });
        }
      }
      reviewed.sort((a, b) => b.score - a.score);
      let matches = reviewed.filter((item) => item.score >= threshold);
      if (!matches.length && threshold <= 50) matches = reviewed.filter((item) => item.score >= 18).slice(0, 3);
      matches.forEach(addSignalBadge);
    } finally { scanInProgress = false; }
  }
  function addSignalBadge({ element, score, reasons }) {
    element.classList.add("ctf-flagged");
    const badge = document.createElement("button"); badge.type = "button"; badge.className = "ctf-badge";
    badge.textContent = `${Math.max(1, reasons.length)} AI-style pattern${reasons.length === 1 ? "" : "s"}`;
    badge.title = `${reasons.join(", ") || "formulaic wording"}. This is a writing signal, not proof of AI authorship.`;
    badge.dataset.score = String(score);
    badge.addEventListener("click", (event) => {
      event.stopPropagation(); lastRect = badge.getBoundingClientRect(); lastEditable = null; lastRange = null; cardGeometry = defaultCardGeometry();
      const source = rangeFreeElementMarkdown(element);
      showCard({ loading: true, variant: "human", original: source });
      chrome.runtime.sendMessage({ type: "CF_REWRITE_REQUEST", text: source, style: "human" }).then((result) => showCard({ loading: false, variant: "human", original: source, ...result }));
    });
    element.append(badge);
  }
  function candidateBlocks() {
    const blocks = new Set();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue?.trim() || "";
        if (text.length < 18 || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest(".ctf-card, .ctf-badge, [contenteditable='true'], input, textarea, script, style, nav")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement.closest("p, li, blockquote, article, section, [role='article'], [role='main'] div, main div, div");
      if (element) blocks.add(element);
    }
    return Array.from(blocks).filter((element) => {
      const style = getComputedStyle(element); if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const text = element.innerText?.trim() || ""; if (text.length < 55 || text.length > 8000) return false;
      const rect = element.getBoundingClientRect(); return rect.width > 80 && rect.height > 14;
    });
  }
  function rangeFreeElementMarkdown(element) { return childrenToMarkdown(element).replace(/\n{3,}/g, "\n\n").trim() || element.innerText.trim(); }
  function badgeCount() { return document.querySelectorAll(".ctf-badge").length; }
  function clearScan() {
    document.querySelectorAll(".ctf-badge").forEach((item) => item.remove());
    document.querySelectorAll(".ctf-flagged").forEach((item) => item.classList.remove("ctf-flagged"));
    document.querySelectorAll("[data-ctf-scanned]").forEach((item) => delete item.dataset.ctfScanned);
  }
})();
