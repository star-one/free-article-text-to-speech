# Broadsheet Article Text-to-Speech (`tts.js`)

A lightweight, zero-dependency vanilla JavaScript module that adds a newspaper-style **Audio Edition** reader to any HTML article using the browser's native [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).

Unlike simple text-to-speech snippets that replace article markup with plain text while reading, `tts.js` walks live DOM text nodes and wraps each spoken word in a `<mark>` element **in place**—preserving headings, links, inline formatting, and multi-column CSS layouts.

## Features

- **In-Place DOM Word Highlighting:** Uses `TreeWalker` and the `Range` API to highlight the active word directly inside formatted HTML without breaking layout or stripping markup.
- **Uncluttered Idle State:** Displays only a **Read Aloud** button until playback begins, then reveals **Pause / Resume**, **Stop**, **Voice**, and **Speed** controls.
- **Live Mid-Article Switching:** Changing the narrator voice or playback speed (`0.75×` to `1.75×`) restarts seamlessly from the current word.
- **Preference Persistence:** Remembers the reader's preferred voice and speed in `localStorage`.
- **Chromium Keep-Alive Guard:** Works around Chromium's ~15-second `speechSynthesis` timeout on long-form articles and cancels playback automatically when navigating away.
- **Zero Dependencies:** Pure ES2022+ JavaScript with no build step or external libraries required.

## Quick Start

1. Add a player bar and an article body container with `id="text"` to your HTML:

```html
<div id="speechPlayer" class="tts-console" role="region" aria-label="Audio edition reader">
  <span class="tts-label">Audio Edition:</span>
  <button type="button" id="play" class="tts-btn">&#9654; Read Aloud</button>
  <button type="button" id="pause" class="tts-btn" hidden disabled>&#10074;&#10074; Pause</button>
  <button type="button" id="stop" class="tts-btn" hidden disabled>&#9632; Stop</button>
</div>

<div id="text">
  <p>Your formatted HTML article content goes here.</p>
</div>

<script src="tts.js" defer></script>