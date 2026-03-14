(function() {
  const STORAGE_KEY = 'promptLibrary.items.v1';
  const NOTES_KEY = 'promptNotes.v1';
  const HISTORY_KEY = 'promptHistory.v1';
  const BACKUP_SUFFIX = '.backup';

  const MAX_HISTORY_ITEMS = 500;
  const MAX_IMPORT_FILE_SIZE_BYTES = 1024 * 1024;
  const MAX_IMPORT_PROMPTS = 1000;
  const MAX_IMPORT_NOTES = 5000;
  const MAX_NOTE_CONTENT_LENGTH = 2000;
  const MAX_HISTORY_DETAIL_LENGTH = 240;
  const EXPORT_SCHEMA_VERSION = 3;
  const EXPORT_FILE_BASENAME = 'prompt-library-export';
  const VALID_HISTORY_ACTIONS = new Set(['save', 'delete', 'import']);
  const MAX_STARS = 5;

  const state = {
    prompts: null,
    notes: null,
    history: null,
    searchQuery: '',
    modelFilter: '',
    renderFrame: 0,
    importDecisionResolver: null,
    importDecisionContext: null
  };

  const form = document.getElementById('prompt-form');
  const titleInput = document.getElementById('prompt-title');
  const contentInput = document.getElementById('prompt-content');
  const modelSelectInput = document.getElementById('model-select');
  const modelCustomInput = document.getElementById('model-custom');
  const errorEl = document.getElementById('form-error');
  const listEl = document.getElementById('prompts-list');
  const emptyEl = document.getElementById('prompts-empty');
  const countEl = document.getElementById('prompt-count');
  const cardTemplate = document.getElementById('prompt-card-template');
  const savedTabBtn = document.getElementById('tab-saved');
  const historyTabBtn = document.getElementById('tab-history');
  const savedPanelEl = document.getElementById('panel-saved');
  const historyPanelEl = document.getElementById('panel-history');
  const historyListEl = document.getElementById('history-list');
  const historyEmptyEl = document.getElementById('history-empty');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const searchInput = document.getElementById('search-input');
  const filterModelSelect = document.getElementById('filter-model-select');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  const filterSummaryEl = document.getElementById('filter-summary');
  const importModal = document.getElementById('import-modal');
  const importModalForm = document.getElementById('import-modal-form');
  const importModalCopy = document.getElementById('import-modal-copy');
  const importModeReplace = document.getElementById('import-mode-replace');
  const importModeMerge = document.getElementById('import-mode-merge');
  const duplicateOptions = document.getElementById('duplicate-options');
  const duplicateHandlingSelect = document.getElementById('duplicate-handling-select');
  const importCancelBtn = document.getElementById('import-cancel-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const fileInput = document.getElementById('import-file');

  function trim(value) {
    return (value || '').trim();
  }

  function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadJsonArray(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`Failed to parse ${key}`, error);
      return [];
    }
  }

  function cloneNotesStore(store) {
    return JSON.parse(JSON.stringify(store || {}));
  }

  function loadPrompts(forceRefresh) {
    if (!forceRefresh && Array.isArray(state.prompts)) return state.prompts;
    state.prompts = loadJsonArray(STORAGE_KEY)
      .filter(prompt => prompt && typeof prompt.id === 'string')
      .map(hydrateLegacyPrompt)
      .sort((left, right) => new Date(right.metadata?.createdAt || 0) - new Date(left.metadata?.createdAt || 0));
    return state.prompts;
  }

  function savePrompts(prompts) {
    state.prompts = prompts;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  }

  function loadNotesStore(forceRefresh) {
    if (!forceRefresh && state.notes && typeof state.notes === 'object') return state.notes;
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) {
        state.notes = {};
        return state.notes;
      }
      const parsed = JSON.parse(raw);
      state.notes = parsed && typeof parsed === 'object' ? parsed : {};
      return state.notes;
    } catch (error) {
      console.warn('Notes storage corrupted, resetting.', error);
      state.notes = {};
      return state.notes;
    }
  }

  function saveNotesStore(store) {
    state.notes = store;
    localStorage.setItem(NOTES_KEY, JSON.stringify(store));
  }

  function loadHistory(forceRefresh) {
    if (!forceRefresh && Array.isArray(state.history)) return state.history;
    const history = loadJsonArray(HISTORY_KEY)
      .filter(item => item && typeof item.id === 'string' && typeof item.at === 'string')
      .map(validateHistoryRecord)
      .filter(Boolean)
      .sort((left, right) => new Date(right.at) - new Date(left.at));
    state.history = history.slice(0, MAX_HISTORY_ITEMS);
    return state.history;
  }

  function saveHistory(history) {
    state.history = history;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function getSelectedModel() {
    if (!modelSelectInput) return '';
    return modelSelectInput.value === 'custom' ? trim(modelCustomInput?.value) : trim(modelSelectInput.value);
  }

  function updateModelInputState() {
    if (!modelSelectInput || !modelCustomInput) return;
    const isCustom = modelSelectInput.value === 'custom';
    modelCustomInput.hidden = !isCustom;
    modelCustomInput.required = isCustom;
    modelCustomInput.setAttribute('aria-hidden', String(!isCustom));
    if (!isCustom) modelCustomInput.value = '';
  }

  function preview(text) {
    return trim(text);
  }

  function scheduleRender(prompts) {
    if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = 0;
      render(prompts || loadPrompts());
    });
  }

  function getNotes(promptId) {
    const store = loadNotesStore();
    const list = Array.isArray(store[promptId]) ? store[promptId] : [];
    return list
      .filter(note => note && typeof note.id === 'string' && typeof note.content === 'string')
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
  }

  function noteSearchBlob(promptId) {
    return getNotes(promptId).map(note => note.content).join(' ');
  }

  function getFilteredPrompts(prompts) {
    const query = state.searchQuery.toLowerCase();
    const model = state.modelFilter;
    return prompts.filter(prompt => {
      const matchesModel = !model || prompt.metadata?.model === model;
      if (!matchesModel) return false;
      if (!query) return true;
      const haystack = [
        prompt.title,
        prompt.content,
        prompt.metadata?.model || '',
        noteSearchBlob(prompt.id)
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function updateFilterControls(prompts) {
    if (!filterModelSelect) return;
    const models = Array.from(new Set(prompts.map(prompt => prompt.metadata?.model).filter(Boolean))).sort((left, right) => left.localeCompare(right));
    const current = state.modelFilter;
    filterModelSelect.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All models';
    filterModelSelect.appendChild(allOption);
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      filterModelSelect.appendChild(option);
    });
    filterModelSelect.value = models.includes(current) ? current : '';
    state.modelFilter = filterModelSelect.value;
  }

  function setEmptyStateMessage(totalPrompts, filteredPrompts) {
    if (!emptyEl) return;
    const message = emptyEl.querySelector('p');
    if (!message) return;
    if (!totalPrompts) {
      message.textContent = 'No prompts saved yet. Add your first one!';
      return;
    }
    if (!filteredPrompts) {
      message.textContent = 'No prompts match the current search or model filter.';
    }
  }

  function updateFilterSummary(filteredCount, totalCount) {
    if (!filterSummaryEl) return;
    if (!totalCount) {
      filterSummaryEl.textContent = 'Your library is empty.';
      return;
    }
    if (!state.searchQuery && !state.modelFilter) {
      filterSummaryEl.textContent = `Showing all ${totalCount} prompt${totalCount === 1 ? '' : 's'}.`;
      return;
    }
    filterSummaryEl.textContent = `Showing ${filteredCount} of ${totalCount} prompt${totalCount === 1 ? '' : 's'}.`;
  }

  function render(prompts) {
    const source = prompts || loadPrompts();
    const filtered = getFilteredPrompts(source);
    updateFilterControls(source);
    updateFilterSummary(filtered.length, source.length);

    listEl.innerHTML = '';
    countEl.textContent = String(filtered.length);

    if (!filtered.length) {
      emptyEl.hidden = false;
      setEmptyStateMessage(source.length, filtered.length);
      return;
    }

    emptyEl.hidden = true;
    const fragment = document.createDocumentFragment();

    filtered.forEach((prompt, index) => {
      const node = cardTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = prompt.id;
      node.style.setProperty('--card-index', String(index));
      node.querySelector('.card-title').textContent = prompt.title;
      node.querySelector('.card-preview').textContent = preview(prompt.content);
      node.querySelector('.delete-btn').addEventListener('click', () => deletePrompt(prompt.id));

      const metaHost = node.querySelector('[data-role="metadata"]');
      metaHost.replaceChildren(buildMetadataDisplay(prompt.metadata));

      const main = node.querySelector('.card-main');
      main.appendChild(buildRatingElement(prompt));
      main.appendChild(buildNotesSection(prompt.id));
      fragment.appendChild(node);
    });

    listEl.appendChild(fragment);
  }

  function deletePrompt(id) {
    const prompt = loadPrompts().find(item => item.id === id);
    if (!prompt) return;
    if (!window.confirm('Are you sure you want to delete this prompt?')) return;
    const prompts = loadPrompts().filter(item => item.id !== id);
    const notes = loadNotesStore();
    delete notes[id];
    savePrompts(prompts);
    saveNotesStore(notes);
    appendHistoryEvent({
      action: 'delete',
      promptId: prompt.id,
      title: prompt.title,
      model: prompt.metadata?.model || 'unknown'
    });
    scheduleRender(prompts);
  }

  function normalizeHistoryAction(action) {
    return VALID_HISTORY_ACTIONS.has(action) ? action : 'save';
  }

  function appendHistoryEvent(event) {
    const history = loadHistory();
    history.unshift({
      id: createId('h'),
      action: normalizeHistoryAction(event.action),
      promptId: typeof event.promptId === 'string' ? event.promptId : null,
      title: trim(event.title) || 'Untitled',
      model: trim(event.model) || 'unknown',
      at: typeof event.at === 'string' ? event.at : new Date().toISOString(),
      details: trim(event.details || '').slice(0, MAX_HISTORY_DETAIL_LENGTH)
    });
    if (history.length > MAX_HISTORY_ITEMS) history.length = MAX_HISTORY_ITEMS;
    saveHistory(history);
    if (!historyPanelEl.hidden) renderHistory(history);
  }

  function reconcileHistoryWithPrompts(prompts) {
    const history = loadHistory();
    const savedIds = new Set(history.filter(item => item.action === 'save' && item.promptId).map(item => item.promptId));
    let changed = false;
    prompts.forEach(prompt => {
      if (!savedIds.has(prompt.id)) {
        history.push({
          id: createId('h'),
          action: 'save',
          promptId: prompt.id,
          title: prompt.title || 'Untitled',
          model: prompt.metadata?.model || 'unknown',
          at: prompt.metadata?.createdAt || new Date().toISOString(),
          details: 'Recovered from existing saved prompts'
        });
        changed = true;
      }
    });
    if (changed) {
      history.sort((left, right) => new Date(right.at) - new Date(left.at));
      saveHistory(history.slice(0, MAX_HISTORY_ITEMS));
    }
    return loadHistory(true);
  }

  function renderHistory(history) {
    const items = [...history].sort((left, right) => new Date(right.at) - new Date(left.at));
    historyListEl.innerHTML = '';
    historyEmptyEl.hidden = items.length > 0;
    if (!items.length) return;
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.action = normalizeHistoryAction(item.action);

      const header = document.createElement('div');
      header.className = 'history-item-header';

      const title = document.createElement('p');
      title.className = 'history-item-title';
      title.textContent = item.title;

      const time = document.createElement('time');
      time.className = 'history-item-time';
      time.dateTime = item.at;
      time.textContent = formatHistoryTs(item.at);

      const meta = document.createElement('p');
      meta.className = 'history-item-meta';

      const action = document.createElement('span');
      action.className = `history-action ${normalizeHistoryAction(item.action)}`;
      action.textContent = normalizeHistoryAction(item.action);

      meta.append(action, document.createTextNode(` · Model: ${item.model || 'unknown'}`));
      if (item.details) meta.append(document.createTextNode(` · ${item.details}`));
      header.append(title, time);
      li.append(header, meta);
      fragment.appendChild(li);
    });
    historyListEl.appendChild(fragment);
  }

  function formatHistoryTs(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }

  function setActiveTab(tab) {
    const saved = tab === 'saved';
    savedTabBtn.classList.toggle('is-active', saved);
    historyTabBtn.classList.toggle('is-active', !saved);
    savedTabBtn.setAttribute('aria-selected', String(saved));
    historyTabBtn.setAttribute('aria-selected', String(!saved));
    savedPanelEl.hidden = !saved;
    historyPanelEl.hidden = saved;
    if (!saved) renderHistory(loadHistory());
  }

  function normalizeRating(value) {
    if (value == null) return null;
    const numeric = Number(value);
    return numeric >= 1 && numeric <= MAX_STARS ? numeric : null;
  }

  function setRating(promptId, value) {
    const prompts = loadPrompts();
    const prompt = prompts.find(item => item.id === promptId);
    if (!prompt) return;
    const current = normalizeRating(prompt.userRating);
    const next = normalizeRating(value);
    prompt.userRating = current && next && current === next ? null : next;
    savePrompts(prompts);
    updateCardRatingUI(promptId, prompt.userRating);
  }

  function buildRatingElement(prompt) {
    if (!('userRating' in prompt)) prompt.userRating = null;
    const wrap = document.createElement('div');
    wrap.className = 'rating';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', `Rate ${prompt.title}`);
    for (let value = 1; value <= MAX_STARS; value += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `star${prompt.userRating >= value ? ' filled' : ''}`;
      button.dataset.value = String(value);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(prompt.userRating === value));
      button.setAttribute('aria-label', `${value} star${value > 1 ? 's' : ''}`);
      button.textContent = prompt.userRating >= value ? '★' : '☆';
      button.addEventListener('click', () => setRating(prompt.id, value));
      button.addEventListener('keydown', event => handleStarKey(event, prompt.id));
      button.addEventListener('pointerenter', () => previewHover(wrap, value));
      button.addEventListener('pointerleave', () => clearHover(wrap, prompt.userRating));
      wrap.appendChild(button);
    }
    return wrap;
  }

  function updateCardRatingUI(promptId, rating) {
    const card = listEl.querySelector(`[data-id="${promptId}"]`);
    if (!card) return;
    card.querySelectorAll('.rating button.star').forEach(button => {
      const value = Number(button.dataset.value);
      const filled = rating != null && rating >= value;
      button.classList.toggle('filled', filled);
      button.textContent = filled ? '★' : '☆';
      button.setAttribute('aria-checked', String(rating === value));
    });
  }

  function handleStarKey(event, promptId) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const current = Number(target.dataset.value);
    if (['ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      focusStar(promptId, Math.min(MAX_STARS, current + 1));
      setRating(promptId, Math.min(MAX_STARS, current + 1));
      return;
    }
    if (['ArrowLeft', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      focusStar(promptId, Math.max(1, current - 1));
      setRating(promptId, Math.max(1, current - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusStar(promptId, 1);
      setRating(promptId, 1);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusStar(promptId, MAX_STARS);
      setRating(promptId, MAX_STARS);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setRating(promptId, current);
      return;
    }
    if (['Backspace', 'Delete', 'Escape'].includes(event.key)) {
      event.preventDefault();
      setRating(promptId, null);
    }
  }

  function focusStar(promptId, value) {
    const star = listEl.querySelector(`[data-id="${promptId}"] .rating button.star[data-value="${value}"]`);
    if (star instanceof HTMLElement) star.focus();
  }

  function previewHover(wrap, hoverValue) {
    wrap.querySelectorAll('button.star').forEach(button => {
      const value = Number(button.dataset.value);
      button.textContent = value <= hoverValue ? '★' : '☆';
    });
  }

  function clearHover(wrap, rating) {
    wrap.querySelectorAll('button.star').forEach(button => {
      const value = Number(button.dataset.value);
      button.textContent = rating && value <= rating ? '★' : '☆';
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    errorEl.textContent = '';

    const title = trim(titleInput.value);
    const content = trim(contentInput.value);
    const modelName = getSelectedModel();

    if (!title) {
      errorEl.textContent = 'Title is required.';
      titleInput.focus();
      return;
    }
    if (!content) {
      errorEl.textContent = 'Content is required.';
      contentInput.focus();
      return;
    }
    if (!modelName) {
      errorEl.textContent = 'Model is required. Choose one or type a custom model.';
      (modelSelectInput.value === 'custom' ? modelCustomInput : modelSelectInput).focus();
      return;
    }

    let metadata;
    try {
      metadata = trackModel(modelName, content);
    } catch (error) {
      errorEl.textContent = error.message || 'Metadata creation failed.';
      return;
    }

    const prompts = loadPrompts();
    const prompt = { id: createId('p'), title, content, metadata, userRating: null };
    prompts.unshift(prompt);
    savePrompts(prompts);
    appendHistoryEvent({ action: 'save', promptId: prompt.id, title: prompt.title, model: prompt.metadata.model });
    scheduleRender(prompts);

    form.reset();
    if (modelSelectInput) modelSelectInput.value = 'gpt-4.1';
    updateModelInputState();
    titleInput.focus();
  }

  function noteId() {
    return createId('note');
  }

  function addNote(promptId, content) {
    const value = trim(content);
    if (!value) return { error: 'Note cannot be empty.' };
    if (value.length > MAX_NOTE_CONTENT_LENGTH) return { error: `Note cannot exceed ${MAX_NOTE_CONTENT_LENGTH} characters.` };
    const store = loadNotesStore();
    if (!Array.isArray(store[promptId])) store[promptId] = [];
    const timestamp = Date.now();
    const note = { id: noteId(), content: value, createdAt: timestamp, updatedAt: timestamp };
    store[promptId].unshift(note);
    saveNotesStore(store);
    return { note };
  }

  function updateNote(promptId, noteIdValue, nextContent) {
    const value = trim(nextContent);
    if (!value) return { error: 'Note cannot be empty.' };
    if (value.length > MAX_NOTE_CONTENT_LENGTH) return { error: `Note cannot exceed ${MAX_NOTE_CONTENT_LENGTH} characters.` };
    const store = loadNotesStore();
    const list = Array.isArray(store[promptId]) ? store[promptId] : [];
    const note = list.find(item => item.id === noteIdValue);
    if (!note) return { error: 'Note not found.' };
    note.content = value;
    note.updatedAt = Date.now();
    saveNotesStore(store);
    return { note };
  }

  function deleteNote(promptId, noteIdValue) {
    const store = loadNotesStore();
    const list = Array.isArray(store[promptId]) ? store[promptId] : [];
    const index = list.findIndex(item => item.id === noteIdValue);
    if (index === -1) return false;
    list.splice(index, 1);
    saveNotesStore(store);
    return true;
  }

  function buildNotesSection(promptId) {
    const section = document.createElement('section');
    section.className = 'notes';
    section.dataset.promptId = promptId;
    section.setAttribute('aria-labelledby', `notes-title-${promptId}`);

    const header = document.createElement('div');
    header.className = 'notes-header';

    const title = document.createElement('h4');
    title.id = `notes-title-${promptId}`;
    title.className = 'notes-title';
    title.textContent = 'Notes';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'add-note-btn';
    addButton.dataset.action = 'add-note';
    addButton.textContent = 'Add';

    const error = document.createElement('div');
    error.className = 'notes-error';
    error.hidden = true;

    const list = document.createElement('ul');
    list.className = 'notes-list';
    list.setAttribute('role', 'list');

    header.append(title, addButton);
    section.append(header, error, list);
    renderNotesList(promptId, list);
    attachNotesHandlers(section);
    return section;
  }

  function renderNotesList(promptId, listRoot) {
    listRoot.innerHTML = '';
    const notes = getNotes(promptId);
    if (!notes.length) {
      const item = document.createElement('li');
      const text = document.createElement('p');
      text.className = 'note-content';
      text.textContent = 'No notes yet.';
      item.appendChild(text);
      listRoot.appendChild(item);
      return;
    }
    const fragment = document.createDocumentFragment();
    notes.forEach(note => fragment.appendChild(renderNoteItem(promptId, note)));
    listRoot.appendChild(fragment);
  }

  function renderNoteItem(promptId, note) {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.noteId = note.id;

    const content = document.createElement('p');
    content.className = 'note-content';
    content.dataset.role = 'content';
    content.textContent = note.content;

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const time = document.createElement('time');
    const edited = Number(note.updatedAt || 0) > Number(note.createdAt || 0);
    time.textContent = `${formatTs(note.createdAt)}${edited ? ' · Edited' : ''}`;

    const buttons = document.createElement('div');
    buttons.className = 'note-buttons';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.action = 'edit-note';
    edit.textContent = 'Edit';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'delete-note';
    remove.textContent = 'Del';

    buttons.append(edit, remove);
    meta.append(time, buttons);
    li.append(content, meta);
    return li;
  }

  function buildNoteEditor(id, labelText, value) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'visually-hidden';
    label.htmlFor = id;
    label.textContent = labelText;

    const textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.dataset.role = 'editor';
    textarea.value = value || '';
    textarea.placeholder = 'Write a note...';

    const validation = document.createElement('div');
    validation.className = 'note-validation';
    validation.dataset.role = 'validation';

    wrapper.append(label, textarea, validation);
    return wrapper;
  }

  function buildNoteControls() {
    const controls = document.createElement('div');
    controls.className = 'note-controls';

    const save = document.createElement('button');
    save.type = 'button';
    save.dataset.action = 'save-note';
    save.textContent = 'Save';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-note';
    cancel.textContent = 'Cancel';

    controls.append(save, cancel);
    return controls;
  }

  function formatTs(timestamp) {
    try {
      return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return 'Unknown';
    }
  }

  function attachNotesHandlers(section) {
    section.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;
      const promptId = section.dataset.promptId;
      if (!promptId) return;

      if (action === 'add-note') {
        spawnNewNoteEditor(section, promptId);
        return;
      }
      const noteElement = target.closest('.note');
      if (!noteElement) return;

      if (action === 'edit-note') {
        enterEditNote(section, promptId, noteElement.dataset.noteId);
        return;
      }
      if (action === 'delete-note') {
        if (!window.confirm('Delete this note?')) return;
        deleteNote(promptId, noteElement.dataset.noteId);
        renderNotesList(promptId, section.querySelector('.notes-list'));
        return;
      }
      if (action === 'save-note') {
        commitNoteEdit(section, promptId, noteElement);
        return;
      }
      if (action === 'cancel-note') {
        cancelNoteEdit(section, promptId, noteElement);
      }
    });

    section.addEventListener('keydown', event => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const noteElement = target.closest('.note');
      const promptId = section.dataset.promptId;
      if (!noteElement || !promptId) return;
      if (event.key === 'Escape') {
        cancelNoteEdit(section, promptId, noteElement);
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commitNoteEdit(section, promptId, noteElement);
      }
    });
  }

  function spawnNewNoteEditor(section, promptId) {
    const existing = section.querySelector('.note.editing[data-mode="new"] textarea');
    if (existing instanceof HTMLElement) {
      existing.focus();
      return;
    }
    const list = section.querySelector('.notes-list');
    const item = document.createElement('li');
    item.className = 'note editing';
    item.dataset.mode = 'new';
    item.append(buildNoteEditor(`new-note-${promptId}`, 'New note', ''), buildNoteControls());
    list.insertBefore(item, list.firstChild);
    item.querySelector('textarea').focus();
  }

  function enterEditNote(section, promptId, noteIdValue) {
    const item = section.querySelector(`.note[data-note-id="${noteIdValue}"]`);
    if (!item || item.classList.contains('editing')) return;
    const original = item.querySelector('[data-role="content"]')?.textContent || '';
    item.classList.add('editing');
    item.dataset.mode = 'edit';
    item.dataset.original = original;
    item.replaceChildren(buildNoteEditor(`edit-${noteIdValue}`, 'Edit note', original), buildNoteControls());
    item.querySelector('textarea').focus();
  }

  function commitNoteEdit(section, promptId, editorNode) {
    const textarea = editorNode.querySelector('textarea');
    const validation = editorNode.querySelector('[data-role="validation"]');
    if (!(textarea instanceof HTMLTextAreaElement) || !(validation instanceof HTMLElement)) return;
    const mode = editorNode.dataset.mode;
    const value = textarea.value;
    const result = mode === 'new'
      ? addNote(promptId, value)
      : updateNote(promptId, editorNode.dataset.noteId, value);
    if (result.error) {
      validation.textContent = result.error;
      textarea.focus();
      return;
    }
    renderNotesList(promptId, section.querySelector('.notes-list'));
  }

  function cancelNoteEdit(section, promptId, editorNode) {
    if (editorNode.dataset.mode === 'new') {
      editorNode.remove();
      const list = section.querySelector('.notes-list');
      if (!list.querySelector('.note')) renderNotesList(promptId, list);
      return;
    }
    const note = getNotes(promptId).find(item => item.id === editorNode.dataset.noteId);
    if (note) {
      editorNode.replaceWith(renderNoteItem(promptId, note));
    } else {
      editorNode.remove();
    }
  }

  function isIsoString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
  }

  function estimateTokens(text, isCode) {
    if (typeof text !== 'string') throw new Error('estimateTokens: text must be a string');
    if (typeof isCode !== 'boolean') throw new Error('estimateTokens: isCode must be a boolean');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    let min = 0.75 * words;
    let max = 0.25 * chars;
    if (isCode) {
      min *= 1.3;
      max *= 1.3;
    }
    if (min > max) {
      const swap = min;
      min = max;
      max = swap;
    }
    const span = max - min;
    let confidence = 'high';
    if (span >= 1000 && span <= 5000) confidence = 'medium';
    if (span > 5000) confidence = 'low';
    return {
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      confidence
    };
  }

  function looksLikeCode(text) {
    return /[;{}<>]|\b(function|const|let|var|class|def|return|if|for|while)\b/.test(text);
  }

  function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') throw new Error('Metadata invalid: missing object');
    if (typeof metadata.model !== 'string' || !trim(metadata.model)) throw new Error('Metadata invalid: model required');
    if (metadata.model.length > 100) throw new Error('Metadata invalid: model too long');
    if (!isIsoString(metadata.createdAt)) throw new Error('Metadata invalid: createdAt not ISO string');
    if (!isIsoString(metadata.updatedAt)) throw new Error('Metadata invalid: updatedAt not ISO string');
    if (new Date(metadata.updatedAt) < new Date(metadata.createdAt)) throw new Error('Metadata invalid: updatedAt earlier than createdAt');
    if (!metadata.tokenEstimate || typeof metadata.tokenEstimate !== 'object') throw new Error('Metadata invalid: tokenEstimate missing');
    if (typeof metadata.tokenEstimate.min !== 'number' || typeof metadata.tokenEstimate.max !== 'number') throw new Error('Metadata invalid: token bounds');
    if (!['high', 'medium', 'low'].includes(metadata.tokenEstimate.confidence)) throw new Error('Metadata invalid: confidence');
  }

  function trackModel(modelName, content) {
    if (typeof modelName !== 'string' || !trim(modelName)) throw new Error('trackModel: modelName must be a non-empty string');
    if (typeof content !== 'string') throw new Error('trackModel: content must be a string');
    const createdAt = new Date().toISOString();
    const metadata = {
      model: trim(modelName),
      createdAt,
      updatedAt: createdAt,
      tokenEstimate: estimateTokens(content, looksLikeCode(content))
    };
    validateMetadata(metadata);
    return metadata;
  }

  function hydrateLegacyPrompt(prompt) {
    if (prompt && prompt.metadata && typeof prompt.metadata === 'object') {
      try {
        validateMetadata(prompt.metadata);
        return { ...prompt, userRating: normalizeRating(prompt.userRating) };
      } catch {
      }
    }
    return {
      ...prompt,
      metadata: trackModel(prompt.model || 'unknown-model', prompt.content || ''),
      userRating: normalizeRating(prompt.userRating)
    };
  }

  function buildMetadataDisplay(metadata) {
    const wrapper = document.createElement('div');
    wrapper.className = 'prompt-meta';
    if (!metadata) {
      wrapper.textContent = 'No metadata';
      return wrapper;
    }

    const rowOne = document.createElement('div');
    rowOne.className = 'prompt-meta-row';

    const modelTag = document.createElement('span');
    modelTag.className = 'prompt-meta-tag';
    const modelLabel = document.createElement('span');
    modelLabel.className = 'meta-label';
    modelLabel.textContent = 'Model';
    const modelName = document.createElement('span');
    modelName.className = 'model-name';
    modelName.textContent = metadata.model;
    modelTag.append(modelLabel, modelName);

    const tokenTag = document.createElement('span');
    tokenTag.className = 'token-estimate';
    tokenTag.dataset.confidence = metadata.tokenEstimate.confidence;
    const tokenLabel = document.createElement('span');
    tokenLabel.className = 'meta-label';
    tokenLabel.textContent = 'Tokens';
    const tokenRange = document.createElement('span');
    tokenRange.className = 'token-range';
    tokenRange.textContent = `${metadata.tokenEstimate.min}-${metadata.tokenEstimate.max}`;
    tokenTag.append(tokenLabel, tokenRange);
    rowOne.append(modelTag, tokenTag);

    const rowTwo = document.createElement('div');
    rowTwo.className = 'prompt-meta-row';
    const createdLabel = document.createElement('span');
    createdLabel.className = 'meta-label';
    createdLabel.textContent = 'Created';
    const createdTime = document.createElement('time');
    createdTime.dateTime = metadata.createdAt;
    createdTime.textContent = humanTime(metadata.createdAt);
    const updatedLabel = document.createElement('span');
    updatedLabel.className = 'meta-label';
    updatedLabel.textContent = 'Updated';
    const updatedTime = document.createElement('time');
    updatedTime.dateTime = metadata.updatedAt;
    updatedTime.textContent = humanTime(metadata.updatedAt);
    rowTwo.append(createdLabel, createdTime, updatedLabel, updatedTime);

    wrapper.append(rowOne, rowTwo);
    return wrapper;
  }

  function humanTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }

  function computeStats(prompts, notes, history) {
    const ratings = prompts.map(prompt => normalizeRating(prompt.userRating)).filter(Boolean);
    const models = {};
    prompts.forEach(prompt => {
      const model = prompt.metadata?.model || 'unknown';
      models[model] = (models[model] || 0) + 1;
    });
    let mostUsedModel = null;
    let mostUsedCount = -1;
    Object.entries(models).forEach(([model, count]) => {
      if (count > mostUsedCount) {
        mostUsedModel = model;
        mostUsedCount = count;
      }
    });
    const noteCount = Object.values(notes).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    return {
      totalPrompts: prompts.length,
      totalNotes: noteCount,
      totalHistoryEvents: history.length,
      averageRating: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
      mostUsedModel
    };
  }

  function validatePromptRecord(prompt) {
    if (!prompt || typeof prompt !== 'object') throw new Error('Prompt not an object');
    if (typeof prompt.id !== 'string') throw new Error('Prompt missing id');
    if (typeof prompt.title !== 'string') throw new Error('Prompt missing title');
    if (typeof prompt.content !== 'string') throw new Error('Prompt missing content');
    validateMetadata(prompt.metadata);
  }

  function assertPromptIdsUnique(prompts) {
    const seen = new Set();
    prompts.forEach(prompt => {
      if (seen.has(prompt.id)) throw new Error(`Duplicate prompt id found in import file: ${prompt.id}`);
      seen.add(prompt.id);
    });
  }

  function validateNoteRecord(note) {
    if (!note || typeof note !== 'object') return null;
    if (typeof note.id !== 'string') return null;
    const content = trim(note.content);
    if (!content || content.length > MAX_NOTE_CONTENT_LENGTH) return null;
    const createdAt = Number(note.createdAt || Date.now());
    const updatedAt = Number(note.updatedAt || createdAt);
    return {
      id: note.id,
      content,
      createdAt,
      updatedAt
    };
  }

  function sanitizeNotesStore(candidate, validPromptIds) {
    if (!candidate || typeof candidate !== 'object') return {};
    const sanitized = {};
    let total = 0;
    Object.entries(candidate).forEach(([promptId, notes]) => {
      if (!validPromptIds.has(promptId) || !Array.isArray(notes)) return;
      const cleaned = [];
      const seen = new Set();
      notes.forEach(note => {
        if (total >= MAX_IMPORT_NOTES) return;
        const validated = validateNoteRecord(note);
        if (!validated || seen.has(validated.id)) return;
        seen.add(validated.id);
        cleaned.push(validated);
        total += 1;
      });
      if (cleaned.length) {
        cleaned.sort((left, right) => right.createdAt - left.createdAt);
        sanitized[promptId] = cleaned;
      }
    });
    return sanitized;
  }

  function validateHistoryRecord(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !isIsoString(item.at)) return null;
    return {
      id: item.id,
      action: normalizeHistoryAction(item.action),
      promptId: typeof item.promptId === 'string' ? item.promptId : null,
      title: trim(item.title) || 'Untitled',
      model: trim(item.model) || 'unknown',
      at: item.at,
      details: trim(item.details || '').slice(0, MAX_HISTORY_DETAIL_LENGTH)
    };
  }

  function sanitizeHistory(candidate) {
    if (!Array.isArray(candidate)) return [];
    const sanitized = [];
    const seen = new Set();
    candidate.forEach(item => {
      const validated = validateHistoryRecord(item);
      if (!validated || seen.has(validated.id)) return;
      seen.add(validated.id);
      sanitized.push(validated);
    });
    sanitized.sort((left, right) => new Date(right.at) - new Date(left.at));
    return sanitized.slice(0, MAX_HISTORY_ITEMS);
  }

  function buildExportPayload() {
    const prompts = loadPrompts();
    prompts.forEach(validatePromptRecord);
    const notes = sanitizeNotesStore(cloneNotesStore(loadNotesStore()), new Set(prompts.map(prompt => prompt.id)));
    const history = sanitizeHistory(loadHistory());
    return {
      type: 'prompt-library-export',
      version: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      stats: computeStats(prompts, notes, history),
      prompts,
      notes,
      history
    };
  }

  function triggerDownload(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const anchor = document.createElement('a');
    anchor.download = `${EXPORT_FILE_BASENAME}-${stamp}.json`;
    anchor.href = URL.createObjectURL(blob);
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 1000);
  }

  function exportPrompts() {
    try {
      const payload = buildExportPayload();
      triggerDownload(payload);
      showIEMessage(`Export completed: ${payload.prompts.length} prompt(s), ${payload.stats.totalNotes} note(s), ${payload.stats.totalHistoryEvents} history event(s).`, 'success');
    } catch (error) {
      console.error(error);
      showIEMessage(`Export failed: ${error.message || error}`, 'error');
    }
  }

  function parseImportFile(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Import file is empty.');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON file.');
    }

    if (!data || typeof data !== 'object') throw new Error('Import root must be an object.');

    const version = Number(data.version ?? data.schemaVersion ?? 1);
    if (!Number.isFinite(version)) throw new Error('Missing or invalid export version.');
    if (version > EXPORT_SCHEMA_VERSION) throw new Error(`Import version ${version} is newer than supported version ${EXPORT_SCHEMA_VERSION}.`);

    let prompts = [];
    if (Array.isArray(data.prompts)) prompts = data.prompts;
    else if (Array.isArray(data?.data?.prompts)) prompts = data.data.prompts;
    else if (Array.isArray(data.data)) prompts = data.data;
    else if (Array.isArray(data)) prompts = data;
    else throw new Error('Missing prompts array in import file.');

    const hydratedPrompts = prompts.map(hydrateLegacyPrompt);
    if (hydratedPrompts.length > MAX_IMPORT_PROMPTS) throw new Error(`Import contains too many prompts. Limit is ${MAX_IMPORT_PROMPTS}.`);
    hydratedPrompts.forEach(validatePromptRecord);
    assertPromptIdsUnique(hydratedPrompts);

    const promptIds = new Set(hydratedPrompts.map(prompt => prompt.id));
    const notes = sanitizeNotesStore(data.notes || {}, promptIds);
    const history = sanitizeHistory(data.history || []);

    return {
      version,
      prompts: hydratedPrompts,
      notes,
      history
    };
  }

  function mergePrompts(existing, incoming, overwriteConflicts) {
    const map = new Map(existing.map(prompt => [prompt.id, prompt]));
    let duplicateCount = 0;
    incoming.forEach(prompt => {
      if (map.has(prompt.id)) {
        duplicateCount += 1;
        if (overwriteConflicts) map.set(prompt.id, prompt);
        return;
      }
      map.set(prompt.id, prompt);
    });
    return {
      prompts: Array.from(map.values()).sort((left, right) => new Date(right.metadata?.createdAt || 0) - new Date(left.metadata?.createdAt || 0)),
      duplicateCount
    };
  }

  function mergeNotes(existing, incoming, overwriteConflicts, validPromptIds) {
    const merged = cloneNotesStore(existing);
    Object.entries(incoming).forEach(([promptId, notes]) => {
      if (!validPromptIds.has(promptId) || !Array.isArray(notes)) return;
      if (!Array.isArray(merged[promptId]) || overwriteConflicts) {
        merged[promptId] = notes.slice();
        return;
      }
      const seen = new Set(merged[promptId].map(note => note.id));
      notes.forEach(note => {
        if (!seen.has(note.id)) {
          seen.add(note.id);
          merged[promptId].push(note);
        }
      });
      merged[promptId].sort((left, right) => right.createdAt - left.createdAt);
    });
    return sanitizeNotesStore(merged, validPromptIds);
  }

  function mergeHistory(existing, incoming) {
    return sanitizeHistory([...existing, ...incoming]);
  }

  function backupCurrentData() {
    [STORAGE_KEY, NOTES_KEY, HISTORY_KEY].forEach(key => {
      const value = localStorage.getItem(key);
      localStorage.setItem(key + BACKUP_SUFFIX, value == null ? '' : value);
    });
  }

  function rollbackFromBackup() {
    [STORAGE_KEY, NOTES_KEY, HISTORY_KEY].forEach(key => {
      const backup = localStorage.getItem(key + BACKUP_SUFFIX);
      if (backup == null) return;
      if (backup === '') localStorage.removeItem(key);
      else localStorage.setItem(key, backup);
    });
    state.prompts = null;
    state.notes = null;
    state.history = null;
  }

  function updateImportModalVisibility() {
    if (!duplicateOptions || !importModeMerge) return;
    const hasDuplicates = Boolean(state.importDecisionContext?.duplicateCount);
    duplicateOptions.hidden = !(importModeMerge.checked && hasDuplicates);
  }

  function resolveImportDecision(decision) {
    const resolver = state.importDecisionResolver;
    state.importDecisionResolver = null;
    state.importDecisionContext = null;
    if (importModal?.open) importModal.close();
    if (resolver) resolver(decision);
  }

  function openImportDecisionModal(context) {
    if (!importModal || !importModeReplace || !importModeMerge || !duplicateHandlingSelect) {
      return Promise.resolve({ mode: 'replace', overwriteConflicts: true });
    }
    state.importDecisionContext = context;
    importModeReplace.checked = true;
    importModeMerge.checked = false;
    duplicateHandlingSelect.value = 'overwrite';
    updateImportModalVisibility();
    if (importModalCopy) {
      importModalCopy.textContent = `Import file contains ${context.incomingCount} prompt(s)${context.duplicateCount ? ` and ${context.duplicateCount} duplicate prompt id(s).` : '.'}`;
    }
    importModal.showModal();
    return new Promise(resolve => {
      state.importDecisionResolver = resolve;
    });
  }

  async function importFile(file) {
    if (!file) return;
    const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
    if (name && !name.endsWith('.json')) {
      showIEMessage('Import failed: only .json files are supported.', 'error');
      return;
    }
    if (typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      showIEMessage(`Import failed: file is too large. Limit is ${Math.round(MAX_IMPORT_FILE_SIZE_BYTES / 1024)} KB.`, 'error');
      return;
    }
    const text = await file.text();
    try {
      backupCurrentData();
      const existingPrompts = loadPrompts();
      const existingNotes = loadNotesStore();
      const existingHistory = loadHistory();
      const parsed = parseImportFile(text);
      const existingIds = new Set(existingPrompts.map(prompt => prompt.id));
      const duplicateCount = parsed.prompts.reduce((count, prompt) => count + (existingIds.has(prompt.id) ? 1 : 0), 0);
      const decision = await openImportDecisionModal({ incomingCount: parsed.prompts.length, duplicateCount });
      if (!decision) {
        showIEMessage('Import canceled.', 'success');
        return;
      }

      let finalPrompts;
      let finalNotes;
      let finalHistory;
      let details;

      if (decision.mode === 'replace') {
        finalPrompts = parsed.prompts;
        finalNotes = parsed.notes;
        finalHistory = parsed.history;
        details = 'mode=replace';
      } else {
        const mergedPrompts = mergePrompts(existingPrompts, parsed.prompts, decision.overwriteConflicts);
        finalPrompts = mergedPrompts.prompts;
        const validPromptIds = new Set(finalPrompts.map(prompt => prompt.id));
        finalNotes = mergeNotes(existingNotes, parsed.notes, decision.overwriteConflicts, validPromptIds);
        finalHistory = mergeHistory(existingHistory, parsed.history);
        details = `mode=merge, duplicates=${mergedPrompts.duplicateCount}, overwrite=${decision.overwriteConflicts}`;
      }

      savePrompts(finalPrompts);
      saveNotesStore(finalNotes);
      saveHistory(finalHistory);
      appendHistoryEvent({
        action: 'import',
        title: 'Import completed',
        model: 'mixed',
        details: `${parsed.prompts.length} prompt(s) imported, ${details}`
      });
      scheduleRender(finalPrompts);
      renderHistory(loadHistory(true));
      showIEMessage(`Import successful (${decision.mode}). Loaded ${parsed.prompts.length} prompt(s).`, 'success');
    } catch (error) {
      console.error('Import error', error);
      rollbackFromBackup();
      scheduleRender(loadPrompts(true));
      renderHistory(loadHistory(true));
      showIEMessage(`Import failed and was rolled back: ${error.message || error}`, 'error');
    }
  }

  function showIEMessage(message, type) {
    const host = document.getElementById('import-export-messages');
    if (!host) return;
    host.textContent = message;
    host.hidden = false;
    host.className = `iemessages ${type || ''}`;
    clearTimeout(showIEMessage.timeoutId);
    showIEMessage.timeoutId = setTimeout(() => {
      host.hidden = true;
    }, 6000);
  }

  function setupImportModal() {
    if (!importModal || !importModalForm || !importCancelBtn) return;
    importModeReplace?.addEventListener('change', updateImportModalVisibility);
    importModeMerge?.addEventListener('change', updateImportModalVisibility);
    duplicateHandlingSelect?.addEventListener('change', updateImportModalVisibility);
    importCancelBtn.addEventListener('click', () => resolveImportDecision(null));
    importModal.addEventListener('cancel', event => {
      event.preventDefault();
      resolveImportDecision(null);
    });
    importModalForm.addEventListener('submit', event => {
      event.preventDefault();
      resolveImportDecision({
        mode: importModeMerge?.checked ? 'merge' : 'replace',
        overwriteConflicts: duplicateHandlingSelect?.value !== 'keep'
      });
    });
  }

  function setupImportExport() {
    exportBtn?.addEventListener('click', exportPrompts);
    importBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) await importFile(file);
      fileInput.value = '';
    });
  }

  function wireFilters() {
    searchInput?.addEventListener('input', event => {
      state.searchQuery = trim(event.target.value);
      scheduleRender();
    });
    filterModelSelect?.addEventListener('change', event => {
      state.modelFilter = event.target.value;
      scheduleRender();
    });
    clearFiltersBtn?.addEventListener('click', () => {
      state.searchQuery = '';
      state.modelFilter = '';
      if (searchInput) searchInput.value = '';
      if (filterModelSelect) filterModelSelect.value = '';
      scheduleRender();
    });
  }

  function init() {
    form.addEventListener('submit', handleSubmit);
    modelSelectInput?.addEventListener('change', () => {
      updateModelInputState();
      if (modelSelectInput.value === 'custom') modelCustomInput.focus();
    });
    savedTabBtn?.addEventListener('click', () => setActiveTab('saved'));
    historyTabBtn?.addEventListener('click', () => setActiveTab('history'));
    clearHistoryBtn?.addEventListener('click', () => {
      if (!window.confirm('Clear all history entries?')) return;
      saveHistory([]);
      renderHistory([]);
    });

    wireFilters();
    setupImportModal();
    setupImportExport();
    updateModelInputState();

    const prompts = loadPrompts();
    render(prompts);
    renderHistory(reconcileHistoryWithPrompts(prompts));
    setActiveTab('saved');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
