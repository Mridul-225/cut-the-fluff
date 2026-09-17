# Cut the Fluff

Cut the Fluff is a Chrome extension for rewriting wordy, repetitive, or overly formal text without leaving the page you are working on. Select text, choose a writing style, and get a cleaner version that keeps the original meaning and structure.

The extension runs from Chrome's side panel and can also open a draggable result card beside the selected text. Rewrites are sent directly from the browser to the AI provider configured by the user.

## Preview

### Side-panel workflow

Select text on a page and open the extension to review it, choose a style, and rewrite it without changing tabs.

![Cut the Fluff side panel showing selected text and a Human rewrite](docs/screenshots/side-panel-human.png)

The result stays inside the panel so it can be reviewed and copied before use.

<p align="center">
  <img src="docs/screenshots/side-panel-professional.png" alt="Professional rewrite result in the Cut the Fluff side panel" width="480">
</p>

### In-page result card

The context-menu and keyboard-shortcut workflows open a movable, resizable result card beside the selected passage.

| Human style | Professional style |
| --- | --- |
| ![Human rewrite displayed in the in-page result card](docs/screenshots/result-card-human.png) | ![Professional rewrite displayed in the in-page result card](docs/screenshots/result-card-professional.png) |

## What it does

- Rewrites selected or pasted text from a persistent side panel.
- Automatically imports a new page selection into the editor.
- Offers three focused writing styles: Human, Professional, and Shorten.
- Preserves supported headings, lists, paragraph breaks, bold text, italics, and inline code.
- Lets users copy the result or replace the original selection where the page permits editing.
- Provides a draggable and resizable result card for in-page rewriting.
- Includes a writing-pattern scan for formulaic wording, generic transitions, repetition, and filler.
- Supports Anthropic, OpenAI, and Google Gemini through the user's own API key.

## Rewrite styles

### Human

Produces natural, direct writing with varied sentence rhythm and familiar wording. It removes robotic transitions and inflated language while preserving the writer's point, details, and tone.

### Professional

Rewrites the text in a concise executive voice. It is intended for emails, reports, proposals, and workplace communication where clarity and authority matter.

### Shorten

Removes repetition, filler, and unnecessary transitions while retaining the facts, qualifications, names, numbers, questions, and conclusions in the source.

## Writing-pattern scan

The optional scan reviews visible text on the active tab for patterns such as canned phrasing, overly uniform sentence structure, generic formal wording, inflated claims, and repeated transitions.

This feature is a writing aid, not an AI detector. A highlighted passage is not proof that AI wrote it, and unhighlighted text is not proof that a person wrote it.

## Installation

### Install from a GitHub release

1. Open the repository's **Releases** page.
2. Download the latest `Cut-the-Fluff` ZIP file.
3. Extract the ZIP to a permanent folder.
4. Open `chrome://extensions` in Chrome.
5. Enable **Developer mode**.
6. Select **Load unpacked**.
7. Choose the extracted folder containing `manifest.json`.

Chrome must continue to have access to this folder. Do not delete it after loading the extension.

### Install from the source code

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder.

Cut the Fluff requires Chrome 114 or later.

## Provider setup

Cut the Fluff does not include a shared AI account. Each user connects their own supported provider.

1. Open the extension's **Settings** page.
2. Choose Anthropic, OpenAI, or Google Gemini.
3. Paste the API key issued by that provider.
4. Select a model.
5. Click **Save settings**, then **Test connection**.

Provider usage may be billed by the selected provider. Review its pricing, data-use terms, and account limits before using the extension.

## Using the extension

### Side panel

1. Select text on a webpage or paste text into the editor.
2. Open Cut the Fluff from the Chrome toolbar.
3. Select Human, Professional, or Shorten.
4. Click **Cut the fluff** or press **Enter**.
5. Review the result before copying or using it.

Use **Shift + Enter** to add a new line without starting a rewrite.

### Context menu

Select text on a webpage, right-click it, and choose **Cut the Fluff**. The rewritten version will appear in a movable result card. Where supported, **Replace selection** inserts the result into the original editable field.

### Keyboard shortcut

The default shortcut is:

- Windows and Linux: **Alt + Shift + F**
- macOS: **Command + Shift + F**

The shortcut can be changed from Settings or from `chrome://extensions/shortcuts`.

## Privacy

- The API key and extension preferences are stored in Chrome's local extension storage.
- Rewrite requests go directly from the browser to the provider selected by the user.
- The developer does not operate an intermediate text-processing server.
- Page text is accessed only when a feature requires it.
- Writing-pattern scanning is disabled until the user turns it on for a tab.
- When scanning is enabled, bounded samples of visible text may be sent to the selected provider for analysis.

Read the included [Privacy Policy](privacy.html) and [Terms & Conditions](terms.html) before distribution.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Accesses the current tab when the user invokes a feature. |
| `contextMenus` | Adds the Cut the Fluff option to selected text. |
| `scripting` | Loads the selection, result card, and scan interface into the active page. |
| `storage` | Saves the provider configuration, preferences, and current draft locally. |
| `sidePanel` | Runs the main editor in Chrome's persistent side panel. |

Network access is limited to the official API domains for Anthropic, OpenAI, and Google Gemini.

## Known limitations

- Chrome blocks extensions from modifying internal pages such as `chrome://` pages and the Chrome Web Store.
- Some websites use custom editors that do not allow reliable replacement of selected text. The rewritten result can still be copied.
- Formatting preservation covers common Markdown-style structure; complex webpage layouts may not reproduce exactly.
- Output quality and availability depend on the selected model and provider.
- Writing-pattern results are probabilistic signals and should be reviewed with judgment.

## Project structure

```text
├── manifest.json       Chrome extension configuration
├── background.js       Context menu, shortcuts, and provider requests
├── content.js          Page selection, result card, replacement, and scanning
├── content.css         In-page result card and scan styling
├── popup.html          Side-panel interface
├── popup.js            Side-panel behavior
├── popup.css           Side-panel styling
├── options.html        Provider and extension settings
├── options.js          Settings behavior
├── options.css         Settings styling
├── privacy.html        Privacy policy
├── terms.html          Terms and conditions
└── icons/              Extension icons
```

## Development

No build step is required. After changing a file:

1. Open `chrome://extensions`.
2. Find Cut the Fluff.
3. Click the reload button.
4. Refresh the webpage where you are testing the extension.

Never commit API keys, `.env` files, personal drafts, or provider credentials to the repository.


Made by MOB.
