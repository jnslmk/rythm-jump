(function initRhythmJumpUi(global) {
  function byId(id) {
    return document.getElementById(id);
  }

  function setHidden(target, hidden) {
    const element = typeof target === 'string' ? byId(target) : target;
    if (!element) {
      return null;
    }
    element.classList.toggle('hidden', hidden);
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    return element;
  }

  function populateSelect(select, values, options = {}) {
    if (!select) {
      return;
    }
    const {
      placeholder = '',
      selectedValue = '',
      emptyLabel = placeholder,
    } = options;

    const fragment = document.createDocumentFragment();
    const initialOption = document.createElement('option');
    initialOption.value = '';
    initialOption.textContent = values.length ? placeholder : emptyLabel;
    fragment.appendChild(initialOption);

    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      fragment.appendChild(option);
    }

    select.replaceChildren(fragment);
    if (selectedValue && values.includes(selectedValue)) {
      select.value = selectedValue;
    }
  }

  async function fetchJson(url, options = {}, errorMessage = 'Request failed') {
    const response = await fetch(url, options);
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload?.detail || '';
      } catch {
        detail = (await response.text()) || '';
      }
      throw new Error(detail || response.statusText || errorMessage);
    }
    return response.json();
  }

  async function withDisabled(control, task) {
    if (control) {
      control.disabled = true;
    }
    try {
      return await task();
    } finally {
      if (control) {
        control.disabled = false;
      }
    }
  }

  function setStatus(target, message, options = {}) {
    const element = typeof target === 'string' ? byId(target) : target;
    if (!element) {
      return;
    }
    const { clearAfterMs = 0 } = options;
    element.textContent = message;
    if (clearAfterMs > 0) {
      window.setTimeout(() => {
        if (element.textContent === message) {
          element.textContent = '';
        }
      }, clearAfterMs);
    }
  }

  global.RhythmJumpUi = {
    byId,
    fetchJson,
    populateSelect,
    setHidden,
    setStatus,
    withDisabled,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
