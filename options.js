const provider = document.getElementById("provider");
const apiKey = document.getElementById("api-key");
const model = document.getElementById("model");
const customModel = document.getElementById("custom-model");
const sensitivity = document.getElementById("sensitivity");
const sensitivityValue = document.getElementById("sensitivity-val");
const state = document.getElementById("connection-state");
const status = document.getElementById("save-status");
const keyLink = document.getElementById("key-link");
const modelHelp = document.getElementById("model-help");

const PROVIDERS = {
  anthropic: {
    keyUrl: "https://console.anthropic.com/settings/keys",
    help: "Sonnet balances quality and speed; Haiku costs less for short rewrites.",
    models: [["claude-sonnet-5", "Claude Sonnet 5 — recommended"], ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 — economical"]]
  },
  openai: {
    keyUrl: "https://platform.openai.com/api-keys",
    help: "Luna is designed for cost-sensitive, high-volume work.",
    models: [["gpt-5.6-luna", "GPT-5.6 Luna — recommended"], ["gpt-5.6-terra", "GPT-5.6 Terra — higher quality"]]
  },
  gemini: {
    keyUrl: "https://aistudio.google.com/apikey",
    help: "Flash-Lite is fast and cost-efficient. Review Google's data-use terms for your plan.",
    models: [["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite — recommended"], ["gemini-3.5-flash", "Gemini 3.5 Flash — higher quality"]]
  }
};
let storedModel = "";

init();
async function init() {
  const data = await chrome.storage.local.get(["provider", "apiKey", "model", "anthropicModel", "openaiModel", "geminiModel", "sensitivity"]);
  provider.value = data.provider || "anthropic";
  apiKey.value = data.apiKey || "";
  storedModel = data.model || data[`${provider.value}Model`] || "";
  sensitivity.value = data.sensitivity ?? 45;
  sensitivityValue.value = `${sensitivity.value}%`;
  renderModels(storedModel);
  const commands = await chrome.commands.getAll();
  const rewriteCommand = commands.find((command) => command.name === "cut-the-fluff");
  document.getElementById("shortcut-value").textContent = rewriteCommand?.shortcut || "Not assigned";
}

document.getElementById("open-shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

provider.addEventListener("change", () => { storedModel = ""; renderModels(); setConnection("Not tested", ""); });
model.addEventListener("change", () => customModel.classList.toggle("hidden", model.value !== "custom"));
sensitivity.addEventListener("input", () => { sensitivityValue.value = `${sensitivity.value}%`; });
document.getElementById("reveal").addEventListener("click", (event) => {
  apiKey.type = apiKey.type === "password" ? "text" : "password";
  event.currentTarget.textContent = apiKey.type === "password" ? "Show" : "Hide";
});

function renderModels(selected = "") {
  const config = PROVIDERS[provider.value];
  model.innerHTML = "";
  for (const [value, label] of config.models) model.add(new Option(label, value));
  model.add(new Option("Custom model ID…", "custom"));
  const known = config.models.some(([value]) => value === selected);
  model.value = selected && known ? selected : selected ? "custom" : config.models[0][0];
  customModel.value = selected && !known ? selected : "";
  customModel.classList.toggle("hidden", model.value !== "custom");
  keyLink.href = config.keyUrl;
  modelHelp.textContent = config.help;
}

function currentModel() { return model.value === "custom" ? customModel.value.trim() : model.value; }
async function saveSettings() {
  const chosenModel = currentModel();
  if (!chosenModel) throw new Error("Enter a model ID.");
  await chrome.storage.local.set({ provider: provider.value, apiKey: apiKey.value.trim(), model: chosenModel, sensitivity: Number(sensitivity.value) });
  storedModel = chosenModel;
}

document.getElementById("save").addEventListener("click", async () => {
  try { await saveSettings(); status.textContent = "Saved"; setTimeout(() => { status.textContent = ""; }, 1500); }
  catch (error) { status.textContent = error.message; }
});

document.getElementById("test").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!apiKey.value.trim()) { setConnection("Add a key", "error"); apiKey.focus(); return; }
  button.disabled = true; button.textContent = "Testing…"; setConnection("Testing", "");
  try {
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: "CF_TEST_CONNECTION" });
    if (response?.ok) setConnection("Connected", "success");
    else setConnection(response?.detail || "Connection failed", "error");
  } catch (error) { setConnection(error.message || "Connection failed", "error"); }
  finally { button.disabled = false; button.textContent = "Test connection"; }
});

function setConnection(text, className) { state.textContent = text; state.className = `pill ${className}`.trim(); }

document.getElementById("clear-data").addEventListener("click", async (event) => {
  const confirmed = confirm("Remove the saved API key, preferences, and draft from this browser?");
  if (!confirmed) return;
  await chrome.storage.local.clear();
  apiKey.value = ""; provider.value = "anthropic"; sensitivity.value = 45; sensitivityValue.value = "45%"; renderModels();
  setConnection("Not tested", ""); event.currentTarget.textContent = "Local data removed";
});
