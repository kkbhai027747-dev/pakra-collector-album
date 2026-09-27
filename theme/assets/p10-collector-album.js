(function () {
  'use strict';

  const emptyEntry = () => ({ status: 'unrecorded', quantity: 0, wishlist: false });
  const statuses = ['unrecorded', 'missing', 'owned', 'previously_owned'];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function initialize(root) {
    if (root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const config = JSON.parse(root.querySelector('[data-album-config]').textContent);
    const strings = config.strings;
    const find = name => root.querySelector('[data-album-' + name + ']');
    const text = (key, values = {}) => Object.entries(values).reduce(
      (value, pair) => value.replaceAll('{' + pair[0] + '}', String(pair[1])),
      strings[key] || key
    );
    let catalog;
    let records = {};
    let revision = 0;
    let csrfToken = '';
    let ready = false;
    let saving = false;
    let batch = false;
    let filter = 'all';
    let selected = new Set();
    let activeCard = null;
    let refreshRequest = 0;
    const dialog = find('dialog');
    const state = card => records[card.id] || emptyEntry();
    const statusLabel = status => text('status_' + status);
    const tell = message => {
      find('message').textContent = message;
      find('dialog-message').textContent = message;
    };

    function safeLink(value) {
      if (typeof value !== 'string' || !/^\/products\/[a-z0-9-]+(?:\?variant=\d+)?$/.test(value)) return '';
      return config.storeRoot.replace(/\/$/, '') + value;
    }

    async function request(method, body) {
      const url = new URL(config.endpoint, window.location.origin);
      if (url.origin !== window.location.origin || !/\/apps\/[a-z0-9_-]+\/v1\/collection$/.test(url.pathname)) {
        throw new Error('endpoint');
      }
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const error = new Error('request');
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
          !data.entries || Array.isArray(data.entries) || typeof data.entries !== 'object' ||
          typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('response');
      for (const entry of Object.values(data.entries)) {
        if (!entry || !statuses.includes(entry.status) || typeof entry.wishlist !== 'boolean' ||
            !Number.isSafeInteger(entry.quantity) ||
            (entry.status === 'owned' ? entry.quantity < 1 || entry.quantity > 999 : entry.quantity !== 0)) {
          throw new Error('response');
        }
      }
      return data;
    }

    function adopt(data) {
      records = data.entries;
      revision = data.revision;
      csrfToken = data.csrfToken;
    }

    function account(mode) {
      ready = mode === 'ready';
      const banner = find('account');
      banner.dataset.state = mode;
      find('account-text').textContent = text('account_' + mode);
      find('login').hidden = mode !== 'guest';
      find('retry').hidden = mode !== 'error';
      updateDisabled();
    }

    function updateDisabled() {
      root.querySelectorAll('[data-album-write]').forEach(node => {
        node.disabled = !ready || saving;
      });
      find('quantity').disabled = !ready || saving || find('status-input').value !== 'owned';
      find('apply').disabled = !ready || saving || selected.size === 0;
      find('save').textContent = text(saving ? 'saving' : 'save');
    }

    async function refresh() {
      if (saving) return;
      const current = ++refreshRequest;
      records = {};
      csrfToken = '';
      selected.clear();
      batch = false;
      if (dialog.open) dialog.close();
      account('loading');
      render();
      try {
        const data = await request('GET');
        if (current !== refreshRequest) return;
        adopt(data);
        account('ready');
      } catch (error) {
        if (current !== refreshRequest) return;
        records = {};
        csrfToken = '';
        account(error.status === 401 ? 'guest' : 'error');
      }
      render();
    }

    async function save(changes) {
      if (!ready || saving || !changes.length) return false;
      const current = refreshRequest;
      saving = true;
      updateDisabled();
      tell(text('saving'));
      try {
        const data = await request('POST', { revision, csrfToken, changes });
        if (current !== refreshRequest) return false;
        adopt(data);
        tell(text('saved'));
        return true;
      } catch (error) {
        if (current !== refreshRequest) return false;
        if ([401, 403, 409].includes(error.status)) {
          saving = false;
          await refresh();
          tell(text(error.status === 409 ? 'conflict' : 'session_changed'));
          if (dialog.open) dialog.close();
        } else {
          tell(text(error.status === 429 ? 'rate_limit' : 'save_error'));
        }
        return false;
      } finally {
        saving = false;
        if (current !== refreshRequest && !ready && document.visibilityState === 'visible') await refresh();
        else {
          render();
          updateDisabled();
        }
      }
    }

    function visibleCards() {
      const query = find('search').value.trim().toLocaleLowerCase();
      const rarity = find('rarity').value;
      return catalog.cards.filter(card => {
        const entry = state(card);
        return (!query || [card.code, card.imageAlt, card.rarity].join(' ').toLocaleLowerCase().includes(query)) &&
          (!rarity || card.rarityKey === rarity) &&
          (filter === 'all' || (filter === 'wishlist' ? entry.wishlist : entry.status === filter));
      });
    }

    function renderProgress() {
      const entries = catalog.cards.map(state);
      const owned = entries.filter(entry => entry.status === 'owned').length;
      const missing = entries.filter(entry => entry.status === 'missing').length;
      const wishlist = entries.filter(entry => entry.wishlist).length;
      const duplicates = entries.reduce((count, entry) => count + Math.max(0, entry.quantity - 1), 0);
      const percentage = Math.round(owned / catalog.cards.length * 100);
      find('progress-title').textContent = text('progress_count', { owned, total: catalog.cards.length });
      find('progress-value').textContent = percentage + '%';
      find('progress-bar').style.width = percentage + '%';
      find('progress-track').setAttribute('aria-valuenow', owned);
      find('progress-track').setAttribute('aria-valuemax', catalog.cards.length);
      find('missing-count').textContent = missing;
      find('wishlist-count').textContent = wishlist;
      find('duplicate-count').textContent = duplicates;
      find('milestone').textContent = text(percentage === 100 ? 'milestone_complete' :
        percentage >= 50 ? 'milestone_half' : owned ? 'milestone_started' : 'milestone_empty');
    }

    function cardNode(card) {
      const entry = state(card);
      const article = element('article', 'p10-album__card');
      article.dataset.status = entry.status;
      article.dataset.cardId = card.id;
      const open = element('button', 'p10-album__card-image');
      open.type = 'button';
      open.setAttribute('aria-label', text('open_card', { code: card.code }));
      const image = element('img');
      image.src = card.image;
      image.alt = card.imageAlt || card.code;
      image.loading = 'lazy';
      image.width = 300;
      image.height = 420;
      open.append(image);
      open.addEventListener('click', () => openCard(card));
      article.append(open);
      if (batch) {
        const select = element('label', 'p10-album__select');
        const input = element('input');
        input.type = 'checkbox';
        input.checked = selected.has(card.id);
        input.setAttribute('aria-label', text('select_card', { code: card.code }));
        input.dataset.albumWrite = '';
        input.addEventListener('change', () => {
          if (input.checked) selected.add(card.id); else selected.delete(card.id);
          updateSelection();
        });
        select.append(input);
        article.append(select);
      }
      const body = element('div', 'p10-album__card-body');
      body.append(element('span', 'p10-album__card-rarity', card.rarity),
        element('h3', 'p10-album__card-code', card.code));
      const row = element('div', 'p10-album__card-bottom');
      row.append(element('span', 'p10-album__card-status',
        statusLabel(entry.status) + (entry.quantity > 1 ? ' ×' + entry.quantity : '')));
      const wish = element('button', 'p10-album__card-wish', entry.wishlist ? '♥' : '♡');
      wish.type = 'button';
      wish.dataset.albumWrite = '';
      wish.setAttribute('aria-label', text(entry.wishlist ? 'remove_wishlist' : 'add_wishlist', { code: card.code }));
      wish.setAttribute('aria-pressed', String(entry.wishlist));
      wish.addEventListener('click', () => save([{ cardId: card.id, ...entry, wishlist: !entry.wishlist }]));
      row.append(wish);
      body.append(row);
      article.append(body);
      return article;
    }

    function updateSelection() {
      const shown = visibleCards();
      find('selection-count').textContent = text('selection_count', { count: selected.size });
      find('select-visible').checked = shown.length > 0 && shown.every(card => selected.has(card.id));
      find('select-visible').indeterminate = shown.some(card => selected.has(card.id)) &&
        !find('select-visible').checked;
      updateDisabled();
    }

    function render() {
      if (!catalog) return;
      renderProgress();
      const shown = visibleCards();
      find('grid').replaceChildren(...shown.map(cardNode));
      find('empty').hidden = shown.length !== 0;
      find('results').textContent = text('results', { count: shown.length, total: catalog.cards.length });
      find('batchbar').hidden = !batch;
      find('batch').setAttribute('aria-pressed', String(batch));
      root.querySelectorAll('[data-album-tab]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.albumTab === filter));
      });
      updateSelection();
    }

    function openCard(card) {
      activeCard = card;
      tell('');
      const entry = state(card);
      find('dialog-code').textContent = card.code;
      find('dialog-rarity').textContent = card.rarity;
      find('dialog-image').src = card.image;
      find('dialog-image').alt = card.imageAlt || card.code;
      find('status-input').value = entry.status;
      find('quantity').value = entry.quantity || 1;
      find('wishlist-input').checked = entry.wishlist;
      find('quantity-row').hidden = entry.status !== 'owned';
      const productLink = safeLink(card.productLink);
      find('buy').hidden = !productLink;
      find('buy').href = productLink;
      const boxLink = safeLink(catalog.set.boxLink);
      find('box').hidden = !boxLink;
      find('box').href = boxLink;
      find('dialog-login-notice').hidden = ready;
      updateDisabled();
      if (!dialog.open) dialog.showModal();
    }

    find('retry').addEventListener('click', refresh);
    find('search').addEventListener('input', render);
    find('rarity').addEventListener('change', render);
    root.querySelectorAll('[data-album-tab]').forEach(button => {
      button.addEventListener('click', () => { filter = button.dataset.albumTab; render(); });
    });
    find('clear').addEventListener('click', () => {
      find('search').value = '';
      find('rarity').value = '';
      filter = 'all';
      render();
    });
    find('batch').addEventListener('click', () => {
      batch = !batch;
      selected.clear();
      render();
    });
    find('cancel-batch').addEventListener('click', () => {
      batch = false;
      selected.clear();
      render();
    });
    find('select-visible').addEventListener('change', event => {
      visibleCards().forEach(card => {
        if (event.target.checked) selected.add(card.id); else selected.delete(card.id);
      });
      render();
    });
    find('apply').addEventListener('click', async () => {
      const status = find('batch-status').value;
      const changes = catalog.cards.filter(card => selected.has(card.id)).map(card => ({
        cardId: card.id, ...state(card), status,
        quantity: status === 'owned' ? Math.max(1, state(card).quantity) : 0
      }));
      if (await save(changes)) {
        selected.clear();
        batch = false;
        render();
      }
    });
    find('close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    find('status-input').addEventListener('change', () => {
      find('quantity-row').hidden = find('status-input').value !== 'owned';
      updateDisabled();
    });
    find('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!activeCard) return;
      const status = find('status-input').value;
      const quantity = status === 'owned' ? Number(find('quantity').value) : 0;
      if (!Number.isSafeInteger(quantity) || (status === 'owned' && (quantity < 1 || quantity > 999))) {
        find('quantity').reportValidity();
        return;
      }
      if (await save([{ cardId: activeCard.id, status, quantity, wishlist: find('wishlist-input').checked }])) {
        dialog.close();
      }
    });
    function clearPrivateView() {
      ++refreshRequest;
      records = {};
      csrfToken = '';
      selected.clear();
      batch = false;
      if (dialog.open) dialog.close();
      account('loading');
      tell('');
      render();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearPrivateView();
      else refresh();
    });
    window.addEventListener('pagehide', clearPrivateView);
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });

    try {
      const response = await fetch(config.catalogUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('catalog');
      catalog = await response.json();
      if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.cards) || !catalog.cards.length ||
          new Set(catalog.cards.map(card => card.id)).size !== catalog.cards.length) throw new Error('catalog');
      for (const card of catalog.cards) {
        const image = new URL(card.image);
        if (image.protocol !== 'https:' || image.hostname !== 'cdn.shopify.com' || !safeLink(card.productLink)) {
          throw new Error('catalog');
        }
      }
      const language = config.locale.startsWith('zh') ? 'zh' : 'en';
      find('set-title').textContent = catalog.set.title[language] || catalog.set.title.en;
      find('coverage').textContent = text('coverage', { total: catalog.cards.length });
      [...new Map(catalog.cards.map(card => [card.rarityKey, card.rarity])).entries()].forEach(pair => {
        const option = element('option', '', pair[1]);
        option.value = pair[0];
        find('rarity').append(option);
      });
      const fanCards = [catalog.cards[0], catalog.cards[6], catalog.cards[14]].filter(Boolean);
      find('fan').replaceChildren(...fanCards.map(card => {
        const image = element('img');
        image.src = card.image;
        image.alt = '';
        image.width = 180;
        image.height = 252;
        return image;
      }));
      root.setAttribute('aria-busy', 'false');
      find('content').hidden = false;
      await refresh();
    } catch {
      root.setAttribute('aria-busy', 'false');
      find('account-text').textContent = text('catalog_error');
      find('account').dataset.state = 'error';
      tell(text('catalog_error'));
    }
  }

  function start(scope) {
    scope.querySelectorAll('[data-collector-album]').forEach(root => {
      initialize(root).catch(() => {
        root.setAttribute('aria-busy', 'false');
        const fallback = root.querySelector('[data-album-fallback]');
        if (fallback) fallback.hidden = false;
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start(document));
  else start(document);
  document.addEventListener('shopify:section:load', event => start(event.target));
})();
