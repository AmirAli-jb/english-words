/* WordJB Dictionary Integration — local, self-hosted Openjam JSON shards.
 * Adds progressive enhancement to the existing Add Word form.
 * Does not replace WordJB's saveWord(), authentication, or review algorithm.
 */
(() => {
  'use strict';
  const termInput = document.getElementById('term');
  const meaningInput = document.getElementById('meaning');
  const exampleInput = document.getElementById('example');
  const form = document.getElementById('wordForm');
  if (!termInput || !meaningInput || !form) {
    console.warn('[WordJB dictionary] Required Add Word controls not found.');
    return;
  }

  const DATA_ROOT = './dictionary';
  const cache = new Map();
  let requestVersion = 0;
  let lookupInProgress = false;

  const el = (tag, cls = '', text = '') => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const normalized = text => String(text || '').trim().toLocaleLowerCase();
  const shardKey = word => /^[a-z]/.test(word) ? word[0] : 'other';
  const currentMeanings = () => meaningInput.value.split(/[،;\n]+/).map(x => x.trim()).filter(Boolean);
  const hasMeaning = value => currentMeanings().some(x => normalized(x) === normalized(value));

  const section = el('section', 'wjd-panel');
  section.setAttribute('aria-label', 'Persian vocabulary dictionary');
  section.innerHTML = `
    <div class="wjd-heading">
      <div><strong>Persian meanings</strong><small>From the WordJB dictionary</small></div>
      <button type="button" class="wjd-btn wjd-search">Suggest meanings</button>
    </div>
    <p class="wjd-status" role="status" aria-live="polite">You can also type any meaning manually below.</p>
    <div class="wjd-results" hidden></div>
    <div class="wjd-preview" hidden><span>Selected meanings</span><p dir="auto"></p></div>
    <div class="wjd-custom">
      <label for="wjd-custom-meaning">Add your own meaning</label>
      <div class="wjd-custom-row">
        <input type="text" id="wjd-custom-meaning" maxlength="200" dir="auto" placeholder="معنی دلخواه..." autocomplete="off">
        <button type="button" class="wjd-btn wjd-add-custom">+ Add</button>
      </div>
    </div>`;
  meaningInput.closest('.word-input-wrap')?.insertAdjacentElement('afterend', section);
  if (!section.isConnected) {
    const label = document.querySelector('label[for="meaning"]');
    if (label?.parentElement) label.before(section);
    else meaningInput.before(section);
  }

  const searchButton = section.querySelector('.wjd-search');
  const customButton = section.querySelector('.wjd-add-custom');
  const customInput = section.querySelector('#wjd-custom-meaning');
  const resultBox = section.querySelector('.wjd-results');
  const status = section.querySelector('.wjd-status');
  const preview = section.querySelector('.wjd-preview');
  const previewText = preview.querySelector('p');

  function syncPreview() {
    const value = meaningInput.value.trim();
    preview.hidden = !value;
    previewText.textContent = value;
  }
  function showStatus(message) { status.textContent = message; }

  function appendMeaning(value) {
    const word = String(value || '').trim();
    if (!word || hasMeaning(word)) return false;
    const existing = meaningInput.value.trim();
    const merged = existing ? `${existing}، ${word}` : word;
    if (merged.length > (Number(meaningInput.maxLength) > 0 ? meaningInput.maxLength : 800)) {
      showStatus('Meaning is too long. Remove some text first.');
      return false;
    }
    meaningInput.value = merged;
    meaningInput.dispatchEvent(new Event('input', { bubbles: true }));
    syncPreview();
    return true;
  }
  function removeMeaning(value) {
    const exact = String(value || '').trim();
    const pieces = currentMeanings();
    const index = pieces.findIndex(x => x === exact);
    if (index < 0) return;
    pieces.splice(index, 1);
    meaningInput.value = pieces.join('، ');
    meaningInput.dispatchEvent(new Event('input', { bubbles: true }));
    syncPreview();
  }
  function addCustom() {
    const value = customInput.value.trim();
    if (!value) return;
    if (appendMeaning(value)) showStatus('Your meaning was added. You can edit the final text below.');
    else if (hasMeaning(value)) showStatus('That meaning is already in your list.');
    customInput.value = '';
  }
  function clearResults() {
    ++requestVersion;
    lookupInProgress = false;
    searchButton.disabled = false;
    resultBox.replaceChildren();
    resultBox.hidden = true;
    showStatus('Enter a word and choose Suggest meanings.');
    syncPreview();
  }
  // Cache promises while they are in flight. Retry after a network error.
  async function loadShard(dir, word) {
    const key = shardKey(word);
    const path = `${DATA_ROOT}/${dir}/${key}.json`;
    if (!cache.has(path)) {
      const promise = fetch(path, { cache: 'default' }).then(res => {
        if (res.status === 404) return {};
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }).catch(err => { cache.delete(path); throw err; });
      cache.set(path, promise);
    }
    return cache.get(path);
  }
  async function findWord(query) {
    const entries = await loadShard('entries', query);
    if (Object.prototype.hasOwnProperty.call(entries, query)) return entries[query];
    const forms = await loadShard('forms', query);
    const lemmas = forms[query] || [];
    for (const lemma of lemmas) {
      const base = await loadShard('entries', lemma);
      if (base[lemma]) return base[lemma];
    }
    return null;
  }
  function createOption(sense, translation, known) {
    const label = el('label', 'wjd-option');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = translation.meaning;
    cb.checked = known.has(normalized(translation.meaning));
    const span = el('span', 'wjd-option-text', translation.meaning);
    span.dir = 'rtl';
    label.append(cb, span);
    cb.addEventListener('change', () => {
      // Keep the original Meaning textarea as the authoritative data for WordJB.
      if (cb.checked) appendMeaning(cb.value);
      else removeMeaning(cb.value);
      // Synchronize duplicate meaning checkboxes in different senses.
      resultBox.querySelectorAll('.wjd-option input').forEach(input => {
        if (input !== cb && input.value === cb.value) input.checked = cb.checked;
      });
    });
    return label;
  }
  function renderEntry(entry, query) {
    resultBox.replaceChildren();
    const head = el('div', 'wjd-result-heading');
    const headingText = `${entry.english}${entry.english !== query ? ` (for “${query}”)` : ''}`;
    head.append(el('strong', '', headingText));
    if (entry.level) head.append(el('span', 'wjd-chip', entry.level));
    const ipa = (entry.phonetics || []).find(p => p.variant === 'us' && p.ipa) ||
      (entry.phonetics || []).find(p => p.ipa);
    if (ipa) head.append(el('span', 'wjd-chip', `${ipa.variant.toUpperCase()}: ${ipa.ipa}`));
    resultBox.append(head);
    const known = new Set(currentMeanings().map(normalized));
    let optionCount = 0;
    const seenTranslation = new Set();
    for (const sense of entry.senses || []) {
      const translations = (sense.translations || []).filter(t => t.language_code === 'fa' && typeof t.meaning === 'string' && t.meaning.trim());
      if (!translations.length) continue;
      const group = el('div', 'wjd-sense');
      const senseTitle = el('div', 'wjd-sense-title');
      senseTitle.append(el('span', 'wjd-chip', sense.part_of_speech || 'word'));
      senseTitle.append(el('span', 'wjd-definition', sense.definition_en || ''));
      group.append(senseTitle);
      if (sense.example_en) {
        const line = el('div', 'wjd-example');
        line.append(el('span', '', sense.example_en));
        const useButton = el('button', 'wjd-use-example', 'Use example');
        useButton.type = 'button';
        useButton.addEventListener('click', () => {
          if (!exampleInput) return;
          if (exampleInput.value.trim() && !window.confirm('Replace the existing example sentence?')) return;
          exampleInput.value = sense.example_en;
          exampleInput.dispatchEvent(new Event('input', { bubbles: true }));
          showStatus('Example added. You can edit it before saving.');
        });
        line.append(useButton);
        group.append(line);
      }
      for (const translation of translations) {
        const key = normalized(translation.meaning);
        if (seenTranslation.has(key)) continue;
        seenTranslation.add(key);
        group.append(createOption(sense, translation, known));
        ++optionCount;
      }
      if (group.querySelector('input')) resultBox.append(group);
    }
    resultBox.hidden = !optionCount;
    showStatus(optionCount ? `${optionCount} Persian suggestions found. Select any number or add your own.` :
      'No Persian meaning found for this word. You can still add your own meaning.');
  }
  async function lookup() {
    if (lookupInProgress) return;
    const query = normalized(termInput.value).replace(/\s+/g, ' ');
    if (!query) { showStatus('Type an English word first.'); termInput.focus(); return; }
    const version = ++requestVersion;
    lookupInProgress = true;
    searchButton.disabled = true;
    resultBox.replaceChildren();
    resultBox.hidden = true;
    showStatus('Searching your WordJB dictionary...');
    try {
      const entry = await findWord(query);
      if (version !== requestVersion || query !== normalized(termInput.value).replace(/\s+/g, ' ')) return;
      if (!entry) { showStatus('No match found. You can add your meaning manually.'); return; }
      renderEntry(entry, query);
    } catch (error) {
      if (version === requestVersion) {
        showStatus(`Could not load dictionary (${error.message}). Check the dictionary/ files on GitHub Pages.`);
      }
    } finally {
      if (version === requestVersion) { lookupInProgress = false; searchButton.disabled = false; }
    }
  }
  searchButton.addEventListener('click', lookup);
  customButton.addEventListener('click', addCustom);
  customInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
  termInput.addEventListener('input', clearResults);
  meaningInput.addEventListener('input', syncPreview);
  form.addEventListener('reset', () => { customInput.value = ''; setTimeout(clearResults, 0); });
  syncPreview();
})();
