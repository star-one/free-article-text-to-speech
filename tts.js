/**
 * Broadsheet Article Text-to-Speech (Web Speech API)
 * Highlights spoken words in-place within formatted article HTML while providing
 * active-only Pause, Stop, Narrator Voice, and Reading Speed controls.
 *
 * License: MIT
 */
(() => {
  'use strict';

  const playerEl = document.getElementById('speechPlayer');
  const textEl = document.getElementById('text');
  const playEl = document.getElementById('play');
  const pauseEl = document.getElementById('pause');
  const stopEl = document.getElementById('stop');

  if (!playerEl || !textEl || !playEl || !pauseEl || !stopEl) return;

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    playEl.disabled = true;
    playEl.textContent = 'Audio Unsupported';
    pauseEl.hidden = true;
    stopEl.hidden = true;
    return;
  }

  const STORAGE_VOICE_KEY = 'broadsheet_tts_voice';
  const STORAGE_RATE_KEY = 'broadsheet_tts_rate';

  // Build active-only Voice & Speed controls inside #speechPlayer
  const activeControlsEl = document.createElement('span');
  activeControlsEl.className = 'tts-active-controls';
  activeControlsEl.hidden = true;

  const voiceLabel = document.createElement('label');
  voiceLabel.className = 'tts-control-group';
  voiceLabel.textContent = 'Voice: ';
  const voiceSelect = document.createElement('select');
  voiceSelect.id = 'tts-voice';
  voiceSelect.className = 'tts-select';
  voiceSelect.setAttribute('aria-label', 'Narrator voice');
  voiceLabel.appendChild(voiceSelect);

  const speedLabel = document.createElement('label');
  speedLabel.className = 'tts-control-group';
  speedLabel.textContent = 'Speed: ';
  const speedSelect = document.createElement('select');
  speedSelect.id = 'tts-speed';
  speedSelect.className = 'tts-select';
  speedSelect.setAttribute('aria-label', 'Reading speed');

  [
    { label: '0.75×', value: '0.75' },
    { label: '0.9×', value: '0.9' },
    { label: '1.0× (Normal)', value: '1' },
    { label: '1.15×', value: '1.15' },
    { label: '1.3×', value: '1.3' },
    { label: '1.5×', value: '1.5' },
    { label: '1.75×', value: '1.75' }
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    speedSelect.appendChild(option);
  });

  speedSelect.value = localStorage.getItem(STORAGE_RATE_KEY) || '1';
  speedLabel.appendChild(speedSelect);

  activeControlsEl.appendChild(voiceLabel);
  activeControlsEl.appendChild(speedLabel);
  playerEl.appendChild(activeControlsEl);

  let availableVoices = [];
  let isActive = false;
  let isPaused = false;
  let isRestarting = false;
  let keepAliveTimer = null;
  let activeMark = null;
  let fullSpeechText = '';
  let charOffsetBase = 0;
  let currentGlobalCharIndex = 0;

  function populateVoices() {
    availableVoices = window.speechSynthesis.getVoices();
    if (!availableVoices.length) return;

    const savedVoiceURI = localStorage.getItem(STORAGE_VOICE_KEY) || '';
    const prevSelected = voiceSelect.value || savedVoiceURI;
    const docLangPrefix = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();

    voiceSelect.innerHTML = '';

    const sorted = [...availableVoices].sort((a, b) => {
      const aMatch = a.lang.toLowerCase().startsWith(docLangPrefix) ? 0 : 1;
      const bMatch = b.lang.toLowerCase().startsWith(docLangPrefix) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.voiceURI;
      opt.textContent = `${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(opt);
    });

    if (prevSelected && sorted.some((v) => v.voiceURI === prevSelected)) {
      voiceSelect.value = prevSelected;
    } else {
      const preferred =
        sorted.find((v) => v.lang.toLowerCase() === (document.documentElement.lang || '').toLowerCase()) ||
        sorted[0];
      if (preferred) voiceSelect.value = preferred.voiceURI;
    }
  }

  populateVoices();
  window.speechSynthesis.addEventListener('voiceschanged', populateVoices);

  function getDomTextMap() {
    const map = [];
    let built = '';

    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parentTag = node.parentElement?.tagName;
        if (parentTag === 'SCRIPT' || parentTag === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const normalized = currentNode.nodeValue.replace(/\s+/g, ' ');
      const start = built.length;
      built += normalized;
      const end = built.length;
      map.push({ node: currentNode, start, end });
      built += ' ';
    }

    return { map, text: built.trim() };
  }

  function clearHighlight() {
    if (activeMark && activeMark.parentNode) {
      const parent = activeMark.parentNode;
      parent.replaceChild(document.createTextNode(activeMark.textContent || ''), activeMark);
      parent.normalize();
    }
    activeMark = null;
  }

  function highlightRange(globalCharIndex, charLength) {
    clearHighlight();

    const { map, text: currentSpeechText } = getDomTextMap();
    if (!currentSpeechText) return;

    let length = charLength;
    if (!length || length <= 0) {
      const match = currentSpeechText.substring(globalCharIndex).match(/^[\p{L}\p{N}'’-]*/u);
      length = match ? match[0].length : 0;
    }
    if (length <= 0) return;

    const entry = map.find((item) => globalCharIndex >= item.start && globalCharIndex <= item.end);
    if (!entry || !entry.node.parentNode) return;

    const raw = entry.node.nodeValue || '';
    const targetWord = currentSpeechText.substring(globalCharIndex, globalCharIndex + length).trim();
    if (!targetWord) return;

    const targetOffsetInNode = Math.max(0, globalCharIndex - entry.start);
    let normCount = 0;
    let rawStart = 0;

    while (rawStart < raw.length && normCount < targetOffsetInNode) {
      if (/\s/.test(raw[rawStart])) {
        while (rawStart + 1 < raw.length && /\s/.test(raw[rawStart + 1])) {
          rawStart++;
        }
      }
      rawStart++;
      normCount++;
    }

    while (rawStart < raw.length && /\s/.test(raw[rawStart])) {
      rawStart++;
    }

    const localIndex = raw.indexOf(targetWord, Math.max(0, rawStart - 2));
    if (localIndex === -1) return;

    try {
      const range = document.createRange();
      range.setStart(entry.node, localIndex);
      range.setEnd(entry.node, Math.min(raw.length, localIndex + targetWord.length));

      const mark = document.createElement('mark');
      mark.className = 'tts-active-word';
      range.surroundContents(mark);
      activeMark = mark;

      const rect = mark.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch {
      // Skip highlighting if a word spans inline HTML tag boundaries
    }
  }

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = window.setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function syncControls(state) {
    if (state === 'idle') {
      isActive = false;
      isPaused = false;
      playEl.hidden = false;
      playEl.disabled = false;
      playEl.innerHTML = '&#9654; Read Aloud';

      pauseEl.hidden = true;
      pauseEl.disabled = true;
      stopEl.hidden = true;
      stopEl.disabled = true;
      activeControlsEl.hidden = true;
    } else if (state === 'playing') {
      isActive = true;
      isPaused = false;
      playEl.hidden = true;
      playEl.disabled = true;

      pauseEl.hidden = false;
      pauseEl.disabled = false;
      pauseEl.innerHTML = '&#10074;&#10074; Pause';

      stopEl.hidden = false;
      stopEl.disabled = false;
      activeControlsEl.hidden = false;
    } else if (state === 'paused') {
      isActive = true;
      isPaused = true;
      playEl.hidden = false;
      playEl.disabled = false;
      playEl.innerHTML = '&#9654; Resume';

      pauseEl.hidden = true;
      pauseEl.disabled = true;

      stopEl.hidden = false;
      stopEl.disabled = false;
      activeControlsEl.hidden = false;
    }
  }

  function resetReader() {
    stopKeepAlive();
    clearHighlight();
    charOffsetBase = 0;
    currentGlobalCharIndex = 0;
    syncControls('idle');
  }

  function speakFromOffset(startIndex = 0) {
    isRestarting = true;
    window.speechSynthesis.cancel();
    clearHighlight();

    const { text: builtText } = getDomTextMap();
    fullSpeechText = builtText;
    if (!fullSpeechText) {
      isRestarting = false;
      return;
    }

    charOffsetBase = Math.max(0, Math.min(startIndex, fullSpeechText.length));
    currentGlobalCharIndex = charOffsetBase;
    const sliceToSpeak = fullSpeechText.slice(charOffsetBase);
    if (!sliceToSpeak.trim()) {
      isRestarting = false;
      resetReader();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sliceToSpeak);
    utterance.lang = document.documentElement.lang || 'en-GB';
    utterance.rate = parseFloat(speedSelect.value) || 1;

    const chosenVoice = availableVoices.find((v) => v.voiceURI === voiceSelect.value);
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    utterance.addEventListener('start', () => {
      isRestarting = false;
      syncControls('playing');
      startKeepAlive();
    });

    utterance.addEventListener('pause', () => {
      if (!isRestarting) {
        stopKeepAlive();
        syncControls('paused');
      }
    });

    utterance.addEventListener('resume', () => {
      syncControls('playing');
      startKeepAlive();
    });

    utterance.addEventListener('boundary', (event) => {
      if (event.name === 'word') {
        currentGlobalCharIndex = charOffsetBase + event.charIndex;
        highlightRange(currentGlobalCharIndex, event.charLength);
      }
    });

    utterance.addEventListener('end', () => {
      if (!isRestarting) {
        resetReader();
      }
    });

    utterance.addEventListener('error', () => {
      if (!isRestarting) {
        resetReader();
      }
    });

    syncControls('playing');
    window.speechSynthesis.speak(utterance);
  }

  function play() {
    if (window.speechSynthesis.paused && isPaused) {
      window.speechSynthesis.resume();
      syncControls('playing');
      startKeepAlive();
      return;
    }
    speakFromOffset(0);
  }

  function pause() {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
    }
  }

  function stop() {
    isRestarting = false;
    window.speechSynthesis.cancel();
    resetReader();
  }

  voiceSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_VOICE_KEY, voiceSelect.value);
    if (isActive) {
      const resumeAt = currentGlobalCharIndex;
      speakFromOffset(resumeAt);
      if (isPaused) {
        window.setTimeout(() => window.speechSynthesis.pause(), 50);
      }
    }
  });

  speedSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_RATE_KEY, speedSelect.value);
    if (isActive) {
      const resumeAt = currentGlobalCharIndex;
      speakFromOffset(resumeAt);
      if (isPaused) {
        window.setTimeout(() => window.speechSynthesis.pause(), 50);
      }
    }
  });

  playEl.addEventListener('click', play);
  pauseEl.addEventListener('click', pause);
  stopEl.addEventListener('click', stop);
  window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());

  syncControls('idle');
})();