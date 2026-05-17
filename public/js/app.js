/* ─── ToonReader App ─────────────────────────────────────────────────────────
   Single-page app that talks to the local Express proxy server.
   All toongod.org fetching happens server-side to bypass CORS.
──────────────────────────────────────────────────────────────────────────── */

// ─── Icon helpers (inline SVG, Lucide-style strokes) ─────────────────────────
const ICONS = {
  bookmark:     `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  bookmarkFill: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  star:         `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  starFill:     `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  book:         `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  play:         `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  rotateCcw:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>`,
  arrowLeft:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  currentView: 'home',
  homePage: 1,
  homeNextServerPage: 1,
  homeServerPageHistory: [1], // stack of serverStartPage per logical page, for Prev
  homeFilter: 'sfw',   // 'all' | '18+' | 'sfw'
  homeResults: [],     // cached for client-side filtering
  browsePage: 1,
  browseNextServerPage: 1,
  browseServerPageHistory: [1],
  browseOrder: 'latest',
  browseGenre: '',
  browseRating: '',    // '' | '18+' | 'sfw'
  searchPage: 1,
  searchQuery: '',
  currentMangaSlug: '',
  currentMangaUrl: '',
  currentChapterUrl: '',
  currentChapterPrev: null,
  currentChapterNext: null,
  currentMangaChapters: [],  // full chapter list for dropdown
  imgWidth: 75,
  singlePageMode: false,
  readHistory: JSON.parse(localStorage.getItem('readHistory') || '{}'),
  readChapters: JSON.parse(localStorage.getItem('readChapters') || '{}'),
  bookmarks: JSON.parse(localStorage.getItem('bookmarks') || '{}'),
  favoritesPage: 1,
  historyPage: 1,
  user: null, // set after auth check
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const views = {
  home: $('#view-home'),
  browse: $('#view-browse'),
  search: $('#view-search'),
  manga: $('#view-manga'),
  reader: $('#view-reader'),
  history: $('#view-history'),
  favorites: $('#view-favorites'),
};

const loading = $('#loading-overlay');
const toast = $('#toast');
let toastTimer = null;

// ─── Utilities ────────────────────────────────────────────────────────────────
function showLoading() { loading.classList.remove('hidden'); }
function hideLoading() { loading.classList.add('hidden'); }

function showToast(msg, duration = 3000, type = '') {
  toast.textContent = msg;
  toast.className = '';  // clear previous type classes
  if (type) toast.classList.add(`toast--${type}`);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

/**
 * showConfirm — custom modal replacement for window.confirm()
 * @param {string} title   - Bold heading text
 * @param {string} message - Descriptive body text
 * @returns {Promise<boolean>} resolves true on confirm, false on cancel
 */
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay  = $('#confirm-overlay');
    const titleEl  = $('#confirm-title');
    const msgEl    = $('#confirm-message');
    const okBtn    = $('#confirm-ok-btn');
    const cancelBtn = $('#confirm-cancel-btn');

    titleEl.textContent = title;
    msgEl.textContent   = message;
    overlay.classList.remove('hidden');
    lucide.createIcons({ nodes: [document.getElementById('confirm-icon')] });

    // Focus the cancel button by default (safer UX)
    cancelBtn.focus();

    function close(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onOk()     { close(true);  }
    function onCancel() { close(false); }
    function onOverlayClick(e) {
      // Only close if the click landed on the backdrop, not inside the dialog
      if (!$('#confirm-dialog').contains(e.target)) close(false);
    }
    function onKey(e) {
      if (e.key === 'Enter')  { close(true);  }
      if (e.key === 'Escape') { close(false); }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);
  });
}

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  state.currentView = name;

  $$('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  $$('.mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Hide footer in reader, show everywhere else
  const footer = $('#site-footer');
  if (footer) footer.style.display = name === 'reader' ? 'none' : '';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function proxyImg(url) {
  if (!url) return '';
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function createMangaCard(item) {
  const card = document.createElement('div');
  card.className = 'manga-card';
  card.dataset.slug = item.slug;
  card.dataset.link = item.link;

  const badgeText = item.badge || '';
  let badgeHtml = '';
  if (badgeText.includes('18+')) badgeHtml += `<span class="manga-badge badge-18">18+</span>`;
  if (badgeText.toLowerCase().includes('new')) badgeHtml += `<span class="manga-badge badge-new">New</span>`;
  if (badgeText.toLowerCase().includes('end')) badgeHtml += `<span class="manga-badge badge-end">End</span>`;

  const ratingHtml = item.rating
    ? `<div class="manga-card-rating">${ICONS.starFill} ${item.rating}</div>`
    : '';

  // Resolve the latest chapter title + link from whichever source is available
  const latestChapterTitle = item.latestChapter || (item.chapters && item.chapters[0]?.title) || '';
  const latestChapterLink  = (item.chapters && item.chapters[0]?.link) || '';

  const latestHtml = latestChapterTitle
    ? latestChapterLink
      ? `<button class="manga-card-chapter manga-card-chapter-btn" title="Read ${escHtml(latestChapterTitle)}">${ICONS.play}${escHtml(latestChapterTitle)}</button>`
      : `<div class="manga-card-chapter">${escHtml(latestChapterTitle)}</div>`
    : '';

  const isBookmarked = !!state.bookmarks[item.slug];

  card.innerHTML = `
    <div class="manga-card-cover">
      ${badgeHtml}
      ${item.cover
        ? `<img class="card-cover-img" src="${proxyImg(item.cover)}" alt="${escHtml(item.title)}" loading="lazy" />`
        : `<div class="cover-placeholder">${ICONS.book}</div>`
      }
      ${ratingHtml}
      <button class="card-bookmark-btn${isBookmarked ? ' bookmarked' : ''}" title="${isBookmarked ? 'Remove from favorites' : 'Add to favorites'}" aria-label="Bookmark">
        ${isBookmarked ? ICONS.bookmarkFill : ICONS.bookmark}
      </button>
    </div>
    <div class="manga-card-info">
      <div class="manga-card-title">${escHtml(item.title)}</div>
      ${latestHtml}
    </div>
  `;

  // Handle broken cover image without inline onerror (avoids SVG quote injection)
  const coverImg = card.querySelector('.card-cover-img');
  if (coverImg) {
    coverImg.addEventListener('error', () => {
      coverImg.parentElement.innerHTML = `<div class="cover-placeholder">${ICONS.book}</div>`;
    });
  }

  // Bookmark button — stop propagation so it doesn't open the manga
  const bmBtn = card.querySelector('.card-bookmark-btn');
  bmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBookmark(item, bmBtn);
  });

  // Chapter button — go straight to reading, stop propagation so card click doesn't also fire
  const chBtn = card.querySelector('.manga-card-chapter-btn');
  if (chBtn) {
    chBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadChapter(latestChapterLink, item.slug, item.title);
    });
  }

  card.addEventListener('click', () => loadMangaDetail(item.link, item.slug));
  return card;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function filterByRating(items, ratingFilter) {
  if (!ratingFilter || ratingFilter === 'all') return items;
  if (ratingFilter === '18+') return items.filter(i => i.badge && i.badge.includes('18+'));
  if (ratingFilter === 'sfw')  return items.filter(i => !i.badge || !i.badge.includes('18+'));
  return items;
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────
function toggleBookmark(item, btnEl) {
  const slug = item.slug;
  if (!slug) return;

  if (state.bookmarks[slug]) {
    delete state.bookmarks[slug];
    if (btnEl) {
      btnEl.classList.remove('bookmarked');
      btnEl.innerHTML = ICONS.bookmark;
      btnEl.title = 'Add to favorites';
    }
    showToast('Removed from favorites', 3000, 'success');
  } else {
    state.bookmarks[slug] = {
      slug,
      title: item.title,
      cover: item.cover,
      link: item.link,
      badge: item.badge || '',
      rating: item.rating || '',
      addedAt: Date.now(),
    };
    if (btnEl) {
      btnEl.classList.add('bookmarked');
      btnEl.innerHTML = ICONS.bookmarkFill;
      btnEl.title = 'Remove from favorites';
    }
    showToast('Added to favorites', 3000, 'success');
  }

  localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));

  // Sync to server if logged in
  syncToServer();

  // Refresh favorites view if it's open
  if (state.currentView === 'favorites') loadFavoritesView();
}

function isBookmarked(slug) {
  return !!state.bookmarks[slug];
}

const FAV_PAGE_SIZE = 10;

function loadFavoritesView(page = state.favoritesPage) {
  const list = $('#favorites-list');
  const empty = $('#favorites-empty');
  const bottomControls = $('#fav-bottom-controls');
  list.innerHTML = '';

  const allItems = Object.values(state.bookmarks).sort((a, b) => b.addedAt - a.addedAt);

  if (allItems.length === 0) {
    empty.classList.remove('hidden');
    bottomControls.style.display = 'none';
    updateFavPageControls(1, 1);
    return;
  }

  empty.classList.add('hidden');
  bottomControls.style.display = '';

  const totalPages = Math.ceil(allItems.length / FAV_PAGE_SIZE);
  // Clamp page in case items were removed
  page = Math.max(1, Math.min(page, totalPages));
  state.favoritesPage = page;

  const pageItems = allItems.slice((page - 1) * FAV_PAGE_SIZE, page * FAV_PAGE_SIZE);

  updateFavPageControls(page, totalPages);

  // Render rows immediately with placeholders, then fill chapters async
  pageItems.forEach(item => {
    const row = createFavoriteRow(item, null);
    list.appendChild(row);

    // Fetch latest chapters in background
    apiFetch(`/api/manga/${encodeURIComponent(item.slug)}`)
      .then(data => {
        const chapterEl = row.querySelector('.fav-chapters');
        if (!chapterEl) return;
        const latest = data.chapters.slice(0, 2); // chapters are newest-first
        if (latest.length === 0) {
          chapterEl.innerHTML = '<span class="fav-no-chapters">No chapters</span>';
          return;
        }
        chapterEl.innerHTML = latest.map(ch => `
          <button class="fav-chapter-btn" data-url="${escHtml(ch.link)}" data-slug="${escHtml(item.slug)}" data-title="${escHtml(item.title)}">
            <i data-lucide="book-open"></i>
            <span>${escHtml(ch.title)}</span>
          </button>
        `).join('');
        lucide.createIcons({ nodes: [chapterEl] });
        chapterEl.querySelectorAll('.fav-chapter-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            loadChapter(btn.dataset.url, btn.dataset.slug, btn.dataset.title);
          });
        });
      })
      .catch(() => {
        const chapterEl = row.querySelector('.fav-chapters');
        if (chapterEl) chapterEl.innerHTML = '<span class="fav-no-chapters">Failed to load</span>';
      });
  });
}

function updateFavPageControls(page, totalPages) {
  const info = `Page ${page}${totalPages > 1 ? ' / ' + totalPages : ''}`;
  $('#fav-page-info-bottom').textContent = info;
  $('#fav-prev-bottom').disabled = page <= 1;
  $('#fav-next-bottom').disabled = page >= totalPages;
}

function createFavoriteRow(item, chapters) {
  const row = document.createElement('div');
  row.className = 'fav-row';
  row.dataset.slug = item.slug;

  const badgeText = item.badge || '';
  let badgeHtml = '';
  if (badgeText.includes('18+')) badgeHtml += `<span class="manga-badge badge-18">18+</span>`;

  row.innerHTML = `
    <div class="fav-cover" role="button" tabindex="0" aria-label="Open ${escHtml(item.title)}">
      ${item.cover
        ? `<img src="${proxyImg(item.cover)}" alt="${escHtml(item.title)}" loading="lazy" />`
        : `<div class="cover-placeholder">${ICONS.book}</div>`
      }
      ${badgeHtml}
    </div>
    <div class="fav-info">
      <div class="fav-title-row">
        <div class="fav-title">${escHtml(item.title)}</div>
        <button class="fav-remove-btn" title="Remove from favorites" aria-label="Remove ${escHtml(item.title)} from favorites">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
      ${item.rating ? `<div class="fav-rating"><span class="fav-rating-label">Rating:</span> ${ICONS.starFill} ${escHtml(item.rating)} <span class="fav-rating-star-text">star</span></div>` : ''}
      <div class="fav-chapters">
        <span class="fav-chapters-loading">Loading chapters…</span>
      </div>
    </div>
  `;

  // Cover click → manga detail
  const cover = row.querySelector('.fav-cover');
  cover.addEventListener('click', () => loadMangaDetail(item.link, item.slug));
  cover.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMangaDetail(item.link, item.slug); });

  // Title click → manga detail
  const title = row.querySelector('.fav-title');
  title.addEventListener('click', () => loadMangaDetail(item.link, item.slug));

  // Cover image error fallback
  const img = row.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      img.parentElement.innerHTML = `<div class="cover-placeholder">${ICONS.book}</div>`;
    });
  }

  // Remove button
  const removeBtn = row.querySelector('.fav-remove-btn');
  lucide.createIcons({ nodes: [removeBtn] });
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const confirmed = await showConfirm(
      'Remove Favorite',
      `Remove "${item.title}" from your favorites?`
    );
    if (!confirmed) return;
    delete state.bookmarks[item.slug];
    localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));
    row.classList.add('fav-row-removing');
    row.addEventListener('animationend', () => {
      row.remove();
      // Re-render page (may shift back a page if this was the last item on it)
      loadFavoritesView(state.favoritesPage);
    }, { once: true });
    showToast('Removed from favorites', 3000, 'success');
  });

  return row;
}

function renderGrid(containerId, items) {
  const container = $(`#${containerId}`);
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-msg">No results found.</p>';
    return;
  }
  items.forEach(item => container.appendChild(createMangaCard(item)));
}

function updatePageControls(prefix, page, totalPages) {
  const prevTop = $(`#${prefix}-prev`);
  const nextTop = $(`#${prefix}-next`);
  const infoTop = $(`#${prefix}-page-info`);
  const prevBot = $(`#${prefix}-prev-bottom`);
  const nextBot = $(`#${prefix}-next-bottom`);
  const infoBot = $(`#${prefix}-page-info-bottom`);

  const info = `Page ${page}${totalPages > 1 ? ' / ' + totalPages : ''}`;
  if (infoTop) infoTop.textContent = info;
  if (infoBot) infoBot.textContent = info;
  if (prevTop) prevTop.disabled = page <= 1;
  if (prevBot) prevBot.disabled = page <= 1;
  if (nextTop) nextTop.disabled = totalPages > 0 && page >= totalPages;
  if (nextBot) nextBot.disabled = totalPages > 0 && page >= totalPages;
}

// ─── API Calls ────────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Home / Latest ────────────────────────────────────────────────────────────
const HOME_PAGE_SIZE = 21; // fixed SFW results per page

async function loadHome(page = 1) {
  showLoading();
  try {
    // Determine which server page to start from
    let serverStartPage;
    if (page === 1) {
      // Fresh start
      serverStartPage = 1;
      state.homeServerPageHistory = [1];
    } else if (page > state.homePage) {
      // Going forward — start from where last page ended
      serverStartPage = state.homeNextServerPage;
      state.homeServerPageHistory.push(serverStartPage);
    } else {
      // Going backward — rewind to the server page that started the target page
      state.homeServerPageHistory = state.homeServerPageHistory.slice(0, page);
      serverStartPage = state.homeServerPageHistory[page - 1] || 1;
    }

    // For 'all' filter: collect exactly HOME_PAGE_SIZE items (no filtering)
    if (state.homeFilter === 'all') {
      const allCollected = [];
      const seenSlugs = new Set();
      let lastFetched = serverStartPage - 1;

      while (allCollected.length < HOME_PAGE_SIZE && lastFetched < serverStartPage + 15) {
        lastFetched++;
        try {
          const data = await apiFetch(`/api/latest?page=${lastFetched}`);
          if (!data.results || data.results.length === 0) break;

          for (const item of data.results) {
            if (seenSlugs.has(item.slug)) continue;
            seenSlugs.add(item.slug);
            allCollected.push(item);
            if (allCollected.length >= HOME_PAGE_SIZE) break;
          }
        } catch {
          break;
        }
      }

      state.homePage = page;
      state.homeResults = allCollected;
      state.homeNextServerPage = lastFetched + 1;

      renderGrid('home-grid', allCollected);
      $$('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === state.homeFilter);
      });
      $('#home-prev').disabled = page <= 1;
      $('#home-next').disabled = allCollected.length === 0;
      $('#home-page-info').textContent = `Page ${page}`;
      return;
    }

    // For '18+' filter: collect exactly HOME_PAGE_SIZE 18+ items
    if (state.homeFilter === '18+') {
      const adultCollected = [];
      const seenSlugs = new Set();
      let lastFetched = serverStartPage - 1;

      while (adultCollected.length < HOME_PAGE_SIZE && lastFetched < serverStartPage + 15) {
        lastFetched++;
        try {
          const data = await apiFetch(`/api/latest?page=${lastFetched}`);
          if (!data.results || data.results.length === 0) break;

          for (const item of data.results) {
            if (seenSlugs.has(item.slug)) continue;
            seenSlugs.add(item.slug);
            const isAdult = item.badge && item.badge.includes('18+');
            if (isAdult) adultCollected.push(item);
            if (adultCollected.length >= HOME_PAGE_SIZE) break;
          }
        } catch {
          break;
        }
      }

      state.homePage = page;
      state.homeResults = adultCollected;
      state.homeNextServerPage = lastFetched + 1;

      renderGrid('home-grid', adultCollected);
      $$('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === state.homeFilter);
      });
      $('#home-prev').disabled = page <= 1;
      $('#home-next').disabled = adultCollected.length === 0;
      $('#home-page-info').textContent = `Page ${page}`;
      return;
    }

    // SFW mode: collect exactly HOME_PAGE_SIZE SFW items across as many server pages as needed
    const sfwCollected = [];
    const seenSlugs = new Set();
    let lastFetched = serverStartPage - 1;

    while (sfwCollected.length < HOME_PAGE_SIZE && lastFetched < serverStartPage + 15) {
      lastFetched++;
      try {
        const data = await apiFetch(`/api/latest?page=${lastFetched}`);
        if (!data.results || data.results.length === 0) break;

        for (const item of data.results) {
          if (seenSlugs.has(item.slug)) continue;
          seenSlugs.add(item.slug);
          const isSfw = !item.badge || !item.badge.includes('18+');
          if (isSfw) sfwCollected.push(item);
          if (sfwCollected.length >= HOME_PAGE_SIZE) break;
        }
      } catch {
        break;
      }
    }

    state.homePage = page;
    state.homeResults = sfwCollected;
    state.homeNextServerPage = lastFetched + 1;

    renderGrid('home-grid', sfwCollected);
    $$('.filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === state.homeFilter);
    });

    $('#home-prev').disabled = page <= 1;
    $('#home-next').disabled = sfwCollected.length === 0;
    $('#home-page-info').textContent = `Page ${page}`;
  } catch (err) {
    $('#home-grid').innerHTML = `<div class="error-box"><p>Failed to load: ${escHtml(err.message)}</p><button class="retry-btn" onclick="loadHome(${page})">Retry</button></div>`;
    showToast('Failed to load home page');
  } finally {
    hideLoading();
  }
}

function applyHomeFilter() {
  const filtered = filterByRating(state.homeResults, state.homeFilter);
  renderGrid('home-grid', filtered);
  // Update chip active state
  $$('.filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === state.homeFilter);
  });
}

// ─── Browse ───────────────────────────────────────────────────────────────────
const BROWSE_PAGE_SIZE = 21;

async function loadBrowse(page = 1) {
  showLoading();
  try {
    // Determine which server page to start from
    let serverStartPage;
    if (page === 1) {
      serverStartPage = 1;
      state.browseServerPageHistory = [1];
    } else if (page > state.browsePage) {
      serverStartPage = state.browseNextServerPage;
      state.browseServerPageHistory.push(serverStartPage);
    } else {
      state.browseServerPageHistory = state.browseServerPageHistory.slice(0, page);
      serverStartPage = state.browseServerPageHistory[page - 1] || 1;
    }

    const collected = [];
    const seenSlugs = new Set();
    let lastFetched = serverStartPage - 1;
    let reachedEnd = false;

    while (collected.length < BROWSE_PAGE_SIZE && lastFetched < serverStartPage + 20) {
      lastFetched++;
      try {
        const data = await apiFetch(`/api/browse?page=${lastFetched}&order=${state.browseOrder}&genre=${state.browseGenre}`);
        if (!data.results || data.results.length === 0) { reachedEnd = true; break; }

        for (const item of data.results) {
          if (seenSlugs.has(item.slug)) continue;
          seenSlugs.add(item.slug);
          const passesRating =
            !state.browseRating ||
            (state.browseRating === '18+' && item.badge && item.badge.includes('18+')) ||
            (state.browseRating === 'sfw'  && (!item.badge || !item.badge.includes('18+')));
          if (passesRating) collected.push(item);
          if (collected.length >= BROWSE_PAGE_SIZE) break;
        }
      } catch {
        reachedEnd = true;
        break;
      }
    }

    state.browsePage = page;
    state.browseNextServerPage = lastFetched + 1;

    renderGrid('browse-grid', collected);
    updatePageControls('browse', page, 0); // totalPages unknown; use button state instead
    $('#browse-prev-bottom').disabled = page <= 1;
    $('#browse-next-bottom').disabled = reachedEnd && collected.length < BROWSE_PAGE_SIZE;
  } catch (err) {
    $('#browse-grid').innerHTML = `<div class="error-box"><p>Failed to load: ${escHtml(err.message)}</p><button class="retry-btn" onclick="loadBrowse(${page})">Retry</button></div>`;
    showToast('Failed to load browse page');
  } finally {
    hideLoading();
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function doSearch(query, page = 1) {
  if (!query.trim()) return;
  state.searchQuery = query.trim();
  state.searchPage = page;
  showView('search');
  showLoading();
  $('#search-query-label').textContent = `"${query}"`;

  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    renderGrid('search-grid', data.results);

    const prevBtn = $('#search-prev');
    const nextBtn = $('#search-next');
    const info = $('#search-page-info');
    info.textContent = `Page ${page}${data.totalPages > 1 ? ' / ' + data.totalPages : ''}`;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = data.totalPages > 0 && page >= data.totalPages || data.results.length === 0;
  } catch (err) {
    $('#search-grid').innerHTML = `<div class="error-box"><p>Search failed: ${escHtml(err.message)}</p><button class="retry-btn" onclick="doSearch('${escHtml(query)}', ${page})">Retry</button></div>`;
    showToast('Search failed');
  } finally {
    hideLoading();
  }
}

// ─── Manga Detail ─────────────────────────────────────────────────────────────
async function loadMangaDetail(mangaLink, slug) {
  state.currentMangaSlug = slug || mangaLink;
  state.currentMangaUrl = mangaLink;
  showView('manga');
  showLoading();

  const container = $('#manga-detail');
  container.innerHTML = '';

  try {
    const data = await apiFetch(`/api/manga/${encodeURIComponent(slug || mangaLink.replace('https://mangadistrict.com/series/', '').replace(/\/$/, ''))}`);

    // Save to history
    saveHistory(slug, data.title, data.cover, mangaLink);

    // Cache chapters for reader dropdown
    state.currentMangaChapters = data.chapters || [];

    const firstChapter = data.chapters[data.chapters.length - 1]; // chapters are newest-first
    const lastReadChapter = state.readChapters[slug];

    container.innerHTML = `
      <button class="back-btn" id="manga-back-btn">${ICONS.arrowLeft} Back</button>
      <div class="manga-detail-header">
        <div class="manga-detail-cover">
          <img src="${proxyImg(data.cover)}" alt="${escHtml(data.title)}" onerror="this.src=''" />
        </div>
        <div class="manga-detail-info">
          <h1>${escHtml(data.title)}</h1>
          <div class="manga-meta">
            ${data.status ? `<div class="meta-item"><strong>Status:</strong> ${escHtml(data.status)}</div>` : ''}
            ${data.author ? `<div class="meta-item"><strong>Author:</strong> ${escHtml(data.author)}</div>` : ''}
            ${data.rating ? `<div class="meta-item"><strong>Rating:</strong> ${ICONS.starFill} ${escHtml(data.rating)}</div>` : ''}
            <div class="meta-item"><strong>Chapters:</strong> ${data.chapters.length}</div>
          </div>
          ${data.genres.length ? `
            <div class="manga-genres">
              ${data.genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('')}
            </div>
          ` : ''}
          ${data.summary ? `
            <div class="manga-summary manga-summary--desktop" id="manga-summary-text">${escHtml(data.summary)}</div>
            <button class="read-more-btn manga-read-more--desktop" id="read-more-btn">Read more <i data-lucide="chevron-down"></i></button>
          ` : ''}
          <div class="manga-detail-actions manga-detail-actions--desktop">
            ${firstChapter ? `<button class="start-reading-btn" id="start-reading-btn">${ICONS.play} Start Reading</button>` : ''}
            ${lastReadChapter ? `<button class="start-reading-btn" id="continue-reading-btn" style="background:linear-gradient(135deg,#4caf7d,#2e7d52)">${ICONS.rotateCcw} Continue Reading</button>` : ''}
            <button class="bookmark-detail-btn${isBookmarked(slug) ? ' bookmarked' : ''}" id="bookmark-detail-btn">
              ${isBookmarked(slug) ? ICONS.bookmarkFill + ' Bookmarked' : ICONS.bookmark + ' Add to Favorites'}
            </button>
          </div>
        </div>
      </div>
      ${data.summary ? `
        <div class="manga-summary manga-summary--mobile">${escHtml(data.summary)}</div>
        <button class="read-more-btn manga-read-more--mobile" id="read-more-btn-mobile">Read more <i data-lucide="chevron-down"></i></button>
      ` : ''}
      <div class="manga-detail-actions manga-detail-actions--mobile">
        ${firstChapter ? `<button class="start-reading-btn" id="start-reading-btn-mobile">${ICONS.play} Start Reading</button>` : ''}
        ${lastReadChapter ? `<button class="start-reading-btn" id="continue-reading-btn-mobile" style="background:linear-gradient(135deg,#4caf7d,#2e7d52)">${ICONS.rotateCcw} Continue Reading</button>` : ''}
        <button class="bookmark-detail-btn${isBookmarked(slug) ? ' bookmarked' : ''}" id="bookmark-detail-btn-mobile">
          ${isBookmarked(slug) ? ICONS.bookmarkFill + ' Bookmarked' : ICONS.bookmark + ' Add to Favorites'}
        </button>
      </div>
      <div class="chapter-list-section">
        <h3>${data.chapters.length} Chapters</h3>
        <input type="text" class="chapter-search" id="chapter-search" placeholder="Filter chapters..." />
        <div class="chapter-list" id="chapter-list"></div>
      </div>
    `;

    // Render chapter list
    renderChapterList(data.chapters, slug);

    // Activate Lucide icons injected into this container
    lucide.createIcons({ nodes: [container] });

    // Events
    $('#manga-back-btn').addEventListener('click', () => {
      showView(state.currentView === 'manga' ? 'home' : state.currentView);
      // Go back to previous view
      const prev = sessionStorage.getItem('prevView') || 'home';
      showView(prev);
    });

    const readMoreBtn = $('#read-more-btn');
    if (readMoreBtn) {
      readMoreBtn.addEventListener('click', () => {
        const summary = $('#manga-summary-text');
        summary.classList.toggle('expanded');
        readMoreBtn.innerHTML = summary.classList.contains('expanded')
          ? 'Show less <i data-lucide="chevron-up"></i>'
          : 'Read more <i data-lucide="chevron-down"></i>';
        lucide.createIcons({ nodes: [readMoreBtn] });
      });
    }

    const readMoreBtnMobile = $('#read-more-btn-mobile');
    if (readMoreBtnMobile) {
      readMoreBtnMobile.addEventListener('click', () => {
        const summary = readMoreBtnMobile.previousElementSibling;
        summary.classList.toggle('expanded');
        readMoreBtnMobile.innerHTML = summary.classList.contains('expanded')
          ? 'Show less <i data-lucide="chevron-up"></i>'
          : 'Read more <i data-lucide="chevron-down"></i>';
        lucide.createIcons({ nodes: [readMoreBtnMobile] });
      });
    }

    const startBtn = $('#start-reading-btn');
    if (startBtn && firstChapter) {
      startBtn.addEventListener('click', () => loadChapter(firstChapter.link, slug, data.title));
    }

    const startBtnMobile = $('#start-reading-btn-mobile');
    if (startBtnMobile && firstChapter) {
      startBtnMobile.addEventListener('click', () => loadChapter(firstChapter.link, slug, data.title));
    }

    const continueBtn = $('#continue-reading-btn');
    if (continueBtn && lastReadChapter) {
      continueBtn.addEventListener('click', () => loadChapter(lastReadChapter.link, slug, data.title));
    }

    const continueBtnMobile = $('#continue-reading-btn-mobile');
    if (continueBtnMobile && lastReadChapter) {
      continueBtnMobile.addEventListener('click', () => loadChapter(lastReadChapter.link, slug, data.title));
    }

    const bookmarkDetailBtn = $('#bookmark-detail-btn');
    if (bookmarkDetailBtn) {
      bookmarkDetailBtn.addEventListener('click', () => {
        const item = { slug, title: data.title, cover: data.cover, link: mangaLink, badge: '', rating: data.rating || '' };
        toggleBookmark(item, null);
        const bm = isBookmarked(slug);
        bookmarkDetailBtn.innerHTML = bm
          ? ICONS.bookmarkFill + ' Bookmarked'
          : ICONS.bookmark + ' Add to Favorites';
        bookmarkDetailBtn.classList.toggle('bookmarked', bm);
        // sync mobile copy
        const bookmarkDetailBtnMobile = $('#bookmark-detail-btn-mobile');
        if (bookmarkDetailBtnMobile) {
          bookmarkDetailBtnMobile.innerHTML = bm
            ? ICONS.bookmarkFill + ' Bookmarked'
            : ICONS.bookmark + ' Add to Favorites';
          bookmarkDetailBtnMobile.classList.toggle('bookmarked', bm);
        }
      });
    }

    const bookmarkDetailBtnMobile = $('#bookmark-detail-btn-mobile');
    if (bookmarkDetailBtnMobile) {
      bookmarkDetailBtnMobile.addEventListener('click', () => {
        const item = { slug, title: data.title, cover: data.cover, link: mangaLink, badge: '', rating: data.rating || '' };
        toggleBookmark(item, null);
        const bm = isBookmarked(slug);
        bookmarkDetailBtnMobile.innerHTML = bm
          ? ICONS.bookmarkFill + ' Bookmarked'
          : ICONS.bookmark + ' Add to Favorites';
        bookmarkDetailBtnMobile.classList.toggle('bookmarked', bm);
        // sync desktop copy
        if (bookmarkDetailBtn) {
          bookmarkDetailBtn.innerHTML = bm
            ? ICONS.bookmarkFill + ' Bookmarked'
            : ICONS.bookmark + ' Add to Favorites';
          bookmarkDetailBtn.classList.toggle('bookmarked', bm);
        }
      });
    }

    $('#chapter-search').addEventListener('input', (e) => {
      filterChapters(e.target.value, data.chapters, slug);
    });

    $$('.genre-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        state.browseGenre = tag.textContent.toLowerCase().replace(/\s+/g, '-');
        $('#browse-genre').value = state.browseGenre;
        showView('browse');
        loadBrowse(1);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="error-box"><p>Failed to load manga: ${escHtml(err.message)}</p><button class="retry-btn" onclick="loadMangaDetail('${escHtml(mangaLink)}', '${escHtml(slug)}')">Retry</button></div>`;
    showToast('Failed to load manga details');
  } finally {
    hideLoading();
  }
}

function renderChapterList(chapters, slug) {
  const list = $('#chapter-list');
  if (!list) return;
  list.innerHTML = '';

  chapters.forEach(ch => {
    const isRead = state.readChapters[slug]?.link === ch.link ||
      (state.readChapters[`${slug}_all`] || []).includes(ch.link);

    const item = document.createElement('div');
    item.className = `chapter-item${isRead ? ' read' : ''}`;
    item.innerHTML = `
      <span class="chapter-item-title">${escHtml(ch.title)}</span>
      <span class="chapter-item-date">${escHtml(ch.date || '')}</span>
    `;
    item.addEventListener('click', () => {
      const mangaTitle = $('#manga-detail h1')?.textContent || '';
      loadChapter(ch.link, slug, mangaTitle);
    });
    list.appendChild(item);
  });
}

function filterChapters(query, chapters, slug) {
  const list = $('#chapter-list');
  if (!list) return;
  const q = query.toLowerCase();
  list.innerHTML = '';
  const filtered = q ? chapters.filter(ch => ch.title.toLowerCase().includes(q)) : chapters;
  renderChapterList(filtered, slug);
}

// ─── Chapter Reader ───────────────────────────────────────────────────────────
async function loadChapter(chapterUrl, mangaSlug, mangaTitle) {
  if (!chapterUrl) return;
  state.currentChapterUrl = chapterUrl;
  if (mangaSlug && mangaSlug !== state.currentMangaSlug) {
    // Switched to a different manga — clear cached chapter list
    state.currentMangaSlug = mangaSlug;
    state.currentMangaChapters = [];
  } else if (mangaSlug) {
    state.currentMangaSlug = mangaSlug;
  }
  showView('reader');
  showLoading();

  const content = $('#reader-content');
  content.innerHTML = '';

  try {
    const data = await apiFetch(`/api/chapter?url=${encodeURIComponent(chapterUrl)}`);

    state.currentChapterPrev = data.prevChapter;
    state.currentChapterNext = data.nextChapter;

    // Update toolbar
    $('#reader-manga-title').textContent = mangaTitle || data.mangaTitle || '';
    $('#reader-chapter-title').textContent = data.chapterTitle || '';

    // Populate chapter dropdown
    populateChapterDropdown(chapterUrl);

    // Nav buttons
    const prevBtn = $('#reader-prev-ch');
    const nextBtn = $('#reader-next-ch');
    const prevBotBtn = $('#reader-prev-ch-bottom');
    const nextBotBtn = $('#reader-next-ch-bottom');

    prevBtn.disabled = !data.prevChapter;
    nextBtn.disabled = !data.nextChapter;
    prevBotBtn.disabled = !data.prevChapter;
    nextBotBtn.disabled = !data.nextChapter;

    // Render images
    if (data.images.length === 0) {
      content.innerHTML = '<div class="error-box"><p>No images found in this chapter. The site may be blocking access or the chapter uses a different format.</p></div>';
    } else {
      data.images.forEach((imgUrl, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'reader-page';
        wrapper.style.width = `${state.imgWidth}%`;

        const img = document.createElement('img');
        img.src = proxyImg(imgUrl);
        img.alt = `Page ${i + 1}`;
        img.loading = i < 3 ? 'eager' : 'lazy';
        img.onerror = function() {
          this.style.display = 'none';
          wrapper.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text2);font-size:0.8rem;">Page ${i+1} failed to load</div>`;
        };

        wrapper.appendChild(img);
        content.appendChild(wrapper);
      });
    }

    // Mark chapter as read
    markChapterRead(mangaSlug, chapterUrl, data.chapterTitle);

    // Save last read
    if (mangaSlug) {
      state.readChapters[mangaSlug] = { link: chapterUrl, title: data.chapterTitle };
      localStorage.setItem('readChapters', JSON.stringify(state.readChapters));
      syncToServer();
    }

  } catch (err) {
    content.innerHTML = `<div class="error-box"><p>Failed to load chapter: ${escHtml(err.message)}</p><button class="retry-btn" onclick="loadChapter('${escHtml(chapterUrl)}', '${escHtml(mangaSlug)}', '${escHtml(mangaTitle)}')">Retry</button></div>`;
    showToast('Failed to load chapter');
  } finally {
    hideLoading();
  }
}

// ─── Chapter Dropdown ────────────────────────────────────────────────────────
function populateChapterDropdown(activeUrl) {
  const list = $('#chapter-dropdown-list');
  list.innerHTML = '';

  const chapters = state.currentMangaChapters;
  if (!chapters || chapters.length === 0) {
    // Chapters not cached yet — fetch them now
    if (state.currentMangaSlug) {
      list.innerHTML = '<div class="chapter-dropdown-empty">Loading chapters…</div>';
      apiFetch(`/api/manga/${encodeURIComponent(state.currentMangaSlug)}`)
        .then(data => {
          state.currentMangaChapters = data.chapters || [];
          populateChapterDropdown(activeUrl);
        })
        .catch(() => {
          list.innerHTML = '<div class="chapter-dropdown-empty">Failed to load chapters</div>';
        });
    } else {
      list.innerHTML = '<div class="chapter-dropdown-empty">No chapters available</div>';
    }
    return;
  }

  chapters.forEach(ch => {
    const isActive = ch.link === activeUrl;
    const isRead = (state.readChapters[`${state.currentMangaSlug}_all`] || []).includes(ch.link);

    const item = document.createElement('div');
    item.className = `chapter-dropdown-item${isActive ? ' active' : ''}${isRead && !isActive ? ' read' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isActive));
    item.innerHTML = `
      <span class="chapter-dd-title">${escHtml(ch.title)}</span>
      ${ch.date ? `<span class="chapter-dd-date">${escHtml(ch.date)}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      closeChapterDropdown();
      if (!isActive) {
        loadChapter(ch.link, state.currentMangaSlug, $('#reader-manga-title').textContent);
      }
    });
    list.appendChild(item);
  });

  // Scroll active item into view after a tick
  requestAnimationFrame(() => {
    const activeItem = list.querySelector('.chapter-dropdown-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
  });
}

function openChapterDropdown() {
  const btn = $('#chapter-dropdown-btn');
  const list = $('#chapter-dropdown-list');

  // On mobile, position fixed dropdown just below the button
  if (window.innerWidth <= 768) {
    const rect = btn.getBoundingClientRect();
    list.style.top = (rect.bottom + 6) + 'px';
  } else {
    list.style.top = '';
  }

  list.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  lucide.createIcons({ nodes: [btn] });
}

function closeChapterDropdown() {
  const btn = $('#chapter-dropdown-btn');
  const list = $('#chapter-dropdown-list');
  list.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
  lucide.createIcons({ nodes: [btn] });
}

function toggleChapterDropdown() {
  const list = $('#chapter-dropdown-list');
  list.classList.contains('hidden') ? openChapterDropdown() : closeChapterDropdown();
}

function markChapterRead(slug, link, title) {
  if (!slug) return;
  const key = `${slug}_all`;
  const all = state.readChapters[key] || [];
  if (!all.includes(link)) {
    all.push(link);
    state.readChapters[key] = all;
    localStorage.setItem('readChapters', JSON.stringify(state.readChapters));
    syncToServer();
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveHistory(slug, title, cover, link) {
  if (!slug || !title) return;
  state.readHistory[slug] = {
    slug, title, cover, link,
    lastRead: Date.now(),
  };
  localStorage.setItem('readHistory', JSON.stringify(state.readHistory));
  syncToServer();
}

const HISTORY_PAGE_SIZE = 21;

function loadHistoryView(page = state.historyPage) {
  const grid = $('#history-grid');
  const empty = $('#history-empty');
  const bottomControls = $('#history-bottom-controls');
  grid.innerHTML = '';

  const items = Object.values(state.readHistory).sort((a, b) => b.lastRead - a.lastRead);

  if (items.length === 0) {
    empty.classList.remove('hidden');
    bottomControls.style.display = 'none';
    updateHistoryPageControls(1, 1);
    return;
  }

  empty.classList.add('hidden');

  const totalPages = Math.ceil(items.length / HISTORY_PAGE_SIZE);
  page = Math.max(1, Math.min(page, totalPages));
  state.historyPage = page;

  const pageItems = items.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  updateHistoryPageControls(page, totalPages);
  bottomControls.style.display = totalPages > 1 ? '' : 'none';

  pageItems.forEach(item => {
    const card = createMangaCard({
      ...item,
      latestChapter: state.readChapters[item.slug]?.title || '',
    });
    grid.appendChild(card);
  });
}

function updateHistoryPageControls(page, totalPages) {
  const info = `Page ${page}${totalPages > 1 ? ' / ' + totalPages : ''}`;
  $('#history-page-info-bottom').textContent = info;
  $('#history-prev-bottom').disabled = page <= 1;
  $('#history-next-bottom').disabled = page >= totalPages;
}

// ─── Burger menu ─────────────────────────────────────────────────────────────
const burgerBtn   = $('#burger-btn');
const mobileNav   = $('#mobile-nav');
const mobileBackdrop = $('#mobile-nav-backdrop');
const mobileClose = $('#mobile-nav-close');

function openMobileNav() {
  mobileNav.classList.add('open');
  mobileBackdrop.classList.add('open');
  burgerBtn.classList.add('open');
  burgerBtn.setAttribute('aria-expanded', 'true');
  mobileNav.setAttribute('aria-hidden', 'false');
  document.body.classList.add('nav-open');
  document.body.style.overflow = 'hidden'; // prevent background scroll
}

function closeMobileNav() {
  mobileNav.classList.remove('open');
  mobileBackdrop.classList.remove('open');
  burgerBtn.classList.remove('open');
  burgerBtn.setAttribute('aria-expanded', 'false');
  mobileNav.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('nav-open');
  document.body.style.overflow = '';
}

burgerBtn.addEventListener('click', () => {
  mobileNav.classList.contains('open') ? closeMobileNav() : openMobileNav();
});

mobileClose.addEventListener('click', closeMobileNav);
mobileBackdrop.addEventListener('click', closeMobileNav);

// Also close when tapping anywhere outside the nav drawer
document.addEventListener('click', (e) => {
  if (
    mobileNav.classList.contains('open') &&
    !mobileNav.contains(e.target) &&
    !burgerBtn.contains(e.target)
  ) {
    closeMobileNav();
  }
});

document.addEventListener('touchstart', (e) => {
  if (
    mobileNav.classList.contains('open') &&
    !mobileNav.contains(e.target) &&
    !burgerBtn.contains(e.target)
  ) {
    closeMobileNav();
  }
}, { passive: true });

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mobileNav.classList.contains('open')) closeMobileNav();
});

// Mobile nav buttons
$$('.mobile-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (!view) return; // skip auth buttons (sign-in, logout) that have no data-view
    closeMobileNav();
    sessionStorage.setItem('prevView', state.currentView);
    showView(view);
    if (view === 'home' && !$('#home-grid').children.length) loadHome(1);
    if (view === 'browse' && !$('#browse-grid').children.length) loadBrowse(1);
    if (view === 'history') loadHistoryView();
    if (view === 'favorites') loadFavoritesView();
  });
});

// Sync mobile nav active state with desktop nav — handled inside showView()

// ─── Nav buttons
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (!view) return; // skip auth buttons (sign-in, user menu) that have no data-view
    sessionStorage.setItem('prevView', state.currentView);
    showView(view);
    if (view === 'home' && !$('#home-grid').children.length) loadHome(1);
    if (view === 'browse' && !$('#browse-grid').children.length) loadBrowse(1);
    if (view === 'history') loadHistoryView();
    if (view === 'favorites') loadFavoritesView();
  });
});

// Logo
$('#logo-link').addEventListener('click', (e) => {
  e.preventDefault();
  showView('home');
  // Always reset to page 1, resetting server page cursor too
  state.homeNextServerPage = 1;
  state.homeServerPageHistory = [1];
  loadHome(1);
});

// Home filter chips
$$('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    state.homeFilter = chip.dataset.filter;
    state.homeNextServerPage = 1; // reset server page cursor on filter change
    state.homeServerPageHistory = [1];
    if (chip.dataset.filter === 'sfw') {
      loadHome(1);
    } else {
      loadHome(state.homePage);
    }
  });
});

// ─── Search Autocomplete ──────────────────────────────────────────────────────
const suggestionsEl = $('#search-suggestions');
let suggestDebounce = null;
let suggestAbort = null;
let activeSuggestionIndex = -1;
let lastSuggestQuery = '';

function highlightMatch(text, query) {
  if (!query) return escHtml(text);
  const safeText = escHtml(text);
  // Escape the query for use in a regex (after HTML-escaping so positions align)
  const safeQuery = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${safeQuery})`, 'gi');
  return safeText.replace(re, '<mark>$1</mark>');
}

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
  suggestionsEl.innerHTML = '';
  activeSuggestionIndex = -1;
}

function showSuggestionLoading() {
  suggestionsEl.innerHTML = '<div class="suggestion-loading">Searching…</div>';
  suggestionsEl.classList.remove('hidden');
}

function renderSuggestions(results, query) {
  suggestionsEl.innerHTML = '';
  activeSuggestionIndex = -1;

  if (!results || results.length === 0) {
    suggestionsEl.innerHTML = '<div class="suggestion-empty">No results found</div>';
    suggestionsEl.classList.remove('hidden');
    return;
  }

  const MAX_SUGGESTIONS = 7;
  const shown = results.slice(0, MAX_SUGGESTIONS);

  shown.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    el.setAttribute('role', 'option');
    el.dataset.index = idx;

    const badgeText = item.badge || '';
    let badgeHtml = '';
    if (badgeText.includes('18+')) badgeHtml += '<span class="suggestion-badge badge-18">18+</span>';
    if (/new/i.test(badgeText))    badgeHtml += '<span class="suggestion-badge badge-new">New</span>';

    const chapterHtml = item.latestChapter
      ? `<span class="suggestion-chapter">${escHtml(item.latestChapter)}</span>`
      : '';

    el.innerHTML = `
      <div class="suggestion-cover">
        ${item.cover
          ? `<img src="${proxyImg(item.cover)}" alt="${escHtml(item.title)}" loading="lazy" />`
          : `<div class="suggestion-cover-placeholder">${ICONS.book}</div>`
        }
      </div>
      <div class="suggestion-info">
        <div class="suggestion-title">${highlightMatch(item.title, query)}</div>
        <div class="suggestion-meta">
          ${chapterHtml}
          ${badgeHtml}
        </div>
      </div>
    `;

    // Cover image error fallback
    const img = el.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        img.parentElement.innerHTML = `<div class="suggestion-cover-placeholder">${ICONS.book}</div>`;
      });
    }

    el.addEventListener('mousedown', (e) => {
      // mousedown fires before blur, so we can act before the dropdown hides
      e.preventDefault();
      hideSuggestions();
      $('#search-input').value = item.title;
      loadMangaDetail(item.link, item.slug);
    });

    suggestionsEl.appendChild(el);
  });

  // "See all results" footer
  if (results.length > 0) {
    const seeAll = document.createElement('div');
    seeAll.className = 'suggestion-see-all';
    seeAll.textContent = `See all results for "${query}"`;
    seeAll.addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideSuggestions();
      doSearch(query, 1);
    });
    suggestionsEl.appendChild(seeAll);
  }

  suggestionsEl.classList.remove('hidden');
}

function setActiveSuggestion(index) {
  const items = suggestionsEl.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => el.classList.toggle('active', i === index));
  activeSuggestionIndex = index;
}

async function fetchSuggestions(query) {
  if (suggestAbort) suggestAbort.abort();
  suggestAbort = new AbortController();

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=1`, {
      signal: suggestAbort.signal,
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    // Extra client-side guard: only show results whose title contains the query
    const normQuery = query.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    const words = normQuery.split(' ').filter(Boolean);
    const filtered = (data.results || []).filter(item => {
      const normTitle = item.title.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ');
      return words.every(word => normTitle.includes(word));
    });
    return filtered;
  } catch (err) {
    if (err.name === 'AbortError') return null; // cancelled
    throw err;
  }
}

$('#search-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();

  clearTimeout(suggestDebounce);

  if (q.length < 2) {
    hideSuggestions();
    return;
  }

  if (q === lastSuggestQuery) return;
  lastSuggestQuery = q;

  showSuggestionLoading();

  suggestDebounce = setTimeout(async () => {
    try {
      const results = await fetchSuggestions(q);
      if (results === null) return; // aborted
      renderSuggestions(results, q);
    } catch {
      hideSuggestions();
    }
  }, 300);
});

$('#search-input').addEventListener('keydown', (e) => {
  const items = suggestionsEl.querySelectorAll('.suggestion-item');
  const isOpen = !suggestionsEl.classList.contains('hidden');

  if (e.key === 'ArrowDown') {
    if (!isOpen) return;
    e.preventDefault();
    const next = Math.min(activeSuggestionIndex + 1, items.length - 1);
    setActiveSuggestion(next);
    return;
  }

  if (e.key === 'ArrowUp') {
    if (!isOpen) return;
    e.preventDefault();
    const prev = Math.max(activeSuggestionIndex - 1, 0);
    setActiveSuggestion(prev);
    return;
  }

  if (e.key === 'Escape') {
    hideSuggestions();
    return;
  }

  if (e.key === 'Enter') {
    if (isOpen && activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
      items[activeSuggestionIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else {
      const q = e.target.value.trim();
      if (q) {
        hideSuggestions();
        doSearch(q, 1);
      }
    }
  }
});

$('#search-input').addEventListener('blur', () => {
  // Small delay so mousedown on a suggestion fires first
  setTimeout(hideSuggestions, 150);
});

$('#search-input').addEventListener('focus', (e) => {
  const q = e.target.value.trim();
  if (q.length >= 2 && q === lastSuggestQuery && suggestionsEl.innerHTML) {
    suggestionsEl.classList.remove('hidden');
  }
});

// Search
$('#search-btn').addEventListener('click', () => {
  const q = $('#search-input').value.trim();
  if (q) {
    hideSuggestions();
    doSearch(q, 1);
  }
});

// Home pagination
$('#home-prev').addEventListener('click', () => { loadHome(state.homePage - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#home-next').addEventListener('click', () => { loadHome(state.homePage + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });

// Browse pagination
$('#browse-prev-bottom').addEventListener('click', () => { loadBrowse(state.browsePage - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#browse-next-bottom').addEventListener('click', () => { loadBrowse(state.browsePage + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });

// Browse filter toggle (mobile)
const browseFilterToggle = $('#browse-filter-toggle');
const browseFiltersPanel = $('#browse-filters-panel');

function isMobile() { return window.innerWidth <= 768; }

function initBrowseFilterPanel() {
  if (isMobile()) {
    // Start collapsed on mobile
    browseFiltersPanel.classList.add('collapsed');
    browseFilterToggle.setAttribute('aria-expanded', 'false');
  } else {
    browseFiltersPanel.classList.remove('collapsed');
    browseFilterToggle.setAttribute('aria-expanded', 'true');
  }
}

browseFilterToggle.addEventListener('click', () => {
  const isCollapsed = browseFiltersPanel.classList.toggle('collapsed');
  browseFilterToggle.setAttribute('aria-expanded', String(!isCollapsed));
});

// Re-evaluate on resize (e.g. rotating device)
window.addEventListener('resize', () => {
  if (!isMobile()) {
    browseFiltersPanel.classList.remove('collapsed');
    browseFilterToggle.setAttribute('aria-expanded', 'true');
  }
});

initBrowseFilterPanel();

// Browse filters — update state only, apply on button click
$('#browse-order').addEventListener('change', (e) => {
  state.browseOrder = e.target.value;
});

$('#browse-genre').addEventListener('change', (e) => {
  state.browseGenre = e.target.value;
});

$('#browse-rating').addEventListener('change', (e) => {
  state.browseRating = e.target.value;
});

$('#browse-apply-btn').addEventListener('click', () => {
  loadBrowse(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Search pagination
$('#search-prev').addEventListener('click', () => doSearch(state.searchQuery, state.searchPage - 1));
$('#search-next').addEventListener('click', () => doSearch(state.searchQuery, state.searchPage + 1));

// Reader navigation
$('#reader-back').addEventListener('click', () => {
  if (state.currentMangaSlug) {
    showView('manga');
  } else {
    showView('home');
  }
});

$('#reader-prev-ch').addEventListener('click', () => {
  if (state.currentChapterPrev) {
    loadChapter(state.currentChapterPrev, state.currentMangaSlug, $('#reader-manga-title').textContent);
  }
});

$('#reader-next-ch').addEventListener('click', () => {
  if (state.currentChapterNext) {
    loadChapter(state.currentChapterNext, state.currentMangaSlug, $('#reader-manga-title').textContent);
  }
});

$('#reader-prev-ch-bottom').addEventListener('click', () => {
  if (state.currentChapterPrev) {
    loadChapter(state.currentChapterPrev, state.currentMangaSlug, $('#reader-manga-title').textContent);
  }
});

$('#reader-next-ch-bottom').addEventListener('click', () => {
  if (state.currentChapterNext) {
    loadChapter(state.currentChapterNext, state.currentMangaSlug, $('#reader-manga-title').textContent);
  }
});

$('#reader-home-btn').addEventListener('click', () => {
  showView('home');
  if (!$('#home-grid').children.length) {
    loadHome(1);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
});

// Reader settings
$('#reader-settings-btn').addEventListener('click', () => {
  $('#reader-settings-panel').classList.toggle('hidden');
});

// Chapter dropdown toggle
$('#chapter-dropdown-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleChapterDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrap = $('#chapter-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) {
    closeChapterDropdown();
  }
});

$('#img-width-slider').addEventListener('input', (e) => {
  state.imgWidth = parseInt(e.target.value);
  $('#img-width-val').textContent = `${state.imgWidth}%`;
  $$('.reader-page').forEach(p => p.style.width = `${state.imgWidth}%`);
  localStorage.setItem('imgWidth', state.imgWidth);
});

$('#single-page-mode').addEventListener('change', (e) => {
  state.singlePageMode = e.target.checked;
  $('#reader-content').classList.toggle('single-page', state.singlePageMode);
});

// Clear history
$('#clear-history-btn').addEventListener('click', async () => {
  const confirmed = await showConfirm(
    'Clear Reading History',
    'This will permanently remove all your reading history and progress. This action cannot be undone.'
  );
  if (confirmed) {
    state.readHistory = {};
    state.readChapters = {};
    state.historyPage = 1;
    localStorage.removeItem('readHistory');
    localStorage.removeItem('readChapters');
    loadHistoryView();
    showToast('History cleared', 3000, 'success');
  }
});

// Clear favorites
$('#clear-favorites-btn').addEventListener('click', async () => {
  const confirmed = await showConfirm(
    'Clear All Favorites',
    'This will permanently remove all your saved favorites. This action cannot be undone.'
  );
  if (confirmed) {
    state.bookmarks = {};
    state.favoritesPage = 1;
    localStorage.removeItem('bookmarks');
    loadFavoritesView(1);
    showToast('Favorites cleared', 3000, 'success');
  }
});

// History pagination
$('#history-prev-bottom').addEventListener('click', () => { loadHistoryView(state.historyPage - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#history-next-bottom').addEventListener('click', () => { loadHistoryView(state.historyPage + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });

// Favorites pagination
$('#fav-prev-bottom').addEventListener('click', () => { loadFavoritesView(state.favoritesPage - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#fav-next-bottom').addEventListener('click', () => { loadFavoritesView(state.favoritesPage + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (state.currentView !== 'reader') return;
  if (e.target.tagName === 'INPUT') return;

  if (e.key === 'ArrowLeft' || e.key === 'a') {
    if (state.currentChapterPrev) {
      loadChapter(state.currentChapterPrev, state.currentMangaSlug, $('#reader-manga-title').textContent);
    }
  }
  if (e.key === 'ArrowRight' || e.key === 'd') {
    if (state.currentChapterNext) {
      loadChapter(state.currentChapterNext, state.currentMangaSlug, $('#reader-manga-title').textContent);
    }
  }
  if (e.key === 'Escape') {
    const list = $('#chapter-dropdown-list');
    if (list && !list.classList.contains('hidden')) {
      closeChapterDropdown();
      return;
    }
    showView('manga');
  }
});

// ─── Scroll to Top ────────────────────────────────────────────────────────────
const scrollTopBtn = $('#scroll-top-btn');

window.addEventListener('scroll', () => {
  scrollTopBtn.classList.toggle('visible', window.scrollY > 300);
}, { passive: true });

scrollTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
const authOverlay      = $('#auth-overlay');
const authLoginForm    = $('#auth-login-form');
const authRegisterForm = $('#auth-register-form');
const authLoginBtn     = $('#auth-login-btn');
const authUserMenu     = $('#auth-user-menu');
const authUserBtn      = $('#auth-user-btn');
const authDropdown     = $('#auth-dropdown');
const authLogoutBtn    = $('#auth-logout-btn');
const authUsernameDisplay = $('#auth-username-display');

function showAuthModal(tab = 'login') {
  switchAuthTab(tab);
  authOverlay.classList.remove('hidden');
  lucide.createIcons({ nodes: [authOverlay] });

  // Restore remembered credentials
  if (tab === 'login') {
    const rememberedUser = localStorage.getItem('rememberedUsername');
    const rememberedPass = localStorage.getItem('rememberedPassword');
    if (rememberedUser) {
      $('#login-username').value = rememberedUser;
      $('#login-password').value = rememberedPass || '';
      $('#login-remember').checked = true;
    } else {
      $('#login-remember').checked = false;
    }
  }

  setTimeout(() => {
    const firstInput = authOverlay.querySelector('.auth-form:not(.hidden) input');
    if (firstInput) firstInput.focus();
  }, 50);
}

function hideAuthModal() {
  authOverlay.classList.add('hidden');
  clearAuthErrors();
}

function switchAuthTab(tab) {
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  authLoginForm.classList.toggle('hidden', tab !== 'login');
  authRegisterForm.classList.toggle('hidden', tab !== 'register');
  clearAuthErrors();
}

function clearAuthErrors() {
  $$('.auth-error').forEach(el => { el.classList.add('hidden'); el.textContent = ''; });
}

function showAuthError(formId, msg) {
  const el = $(`#${formId}-error`);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function setAuthUser(user) {
  state.user = user;
  if (user) {
    authLoginBtn.classList.add('hidden');
    authUserMenu.classList.remove('hidden');
    authUsernameDisplay.textContent = user.username;
    lucide.createIcons({ nodes: [authUserMenu] });
    // Mobile nav
    $('#mobile-auth-login-btn').classList.add('hidden');
    $('#mobile-auth-user').classList.remove('hidden');
    $('#mobile-auth-username').textContent = user.username;
    lucide.createIcons({ nodes: [$('#mobile-auth-user')] });
    // Footer — hide sign-in/register, they're already logged in
    $('#footer-signin-btn').classList.add('hidden');
    $('#footer-register-btn').classList.add('hidden');
  } else {
    authLoginBtn.classList.remove('hidden');
    authUserMenu.classList.add('hidden');
    authDropdown.classList.add('hidden');
    // Mobile nav
    $('#mobile-auth-login-btn').classList.remove('hidden');
    $('#mobile-auth-user').classList.add('hidden');
    // Footer
    $('#footer-signin-btn').classList.remove('hidden');
    $('#footer-register-btn').classList.remove('hidden');
  }
}

// Tab switching
$$('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
});

// Close on backdrop click
authOverlay.addEventListener('click', (e) => {
  if (!$('#auth-dialog').contains(e.target)) hideAuthModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !authOverlay.classList.contains('hidden')) hideAuthModal();
});

// Open modal
authLoginBtn.addEventListener('click', () => showAuthModal('login'));

// Mobile nav — open modal
$('#mobile-auth-login-btn').addEventListener('click', () => {
  // Close the mobile nav drawer first
  document.getElementById('mobile-nav').classList.remove('open');
  document.getElementById('mobile-nav-backdrop').classList.remove('open');
  document.body.classList.remove('nav-open');
  document.getElementById('burger-btn').classList.remove('open');
  document.getElementById('burger-btn').setAttribute('aria-expanded', 'false');
  document.getElementById('mobile-nav').setAttribute('aria-hidden', 'true');
  showAuthModal('login');
});

// Mobile nav — logout
$('#mobile-auth-logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  setAuthUser(null);
  closeMobileNav();
  showToast('Signed out', 3000, 'success');
  showView('home');
  if (!$('#home-grid').children.length) loadHome(1);
});

// Notification toggle — desktop dropdown
$('#notif-toggle').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const ok = await subscribeToPush();
    if (!ok) e.target.checked = false;
  } else {
    await unsubscribeFromPush();
  }
});

// Notification toggle — mobile nav
$('#mobile-notif-toggle').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const ok = await subscribeToPush();
    if (!ok) e.target.checked = false;
    // Sync state to desktop toggle too
    const desktopToggle = $('#notif-toggle');
    if (desktopToggle) desktopToggle.checked = !!ok;
  } else {
    await unsubscribeFromPush();
    const desktopToggle = $('#notif-toggle');
    if (desktopToggle) desktopToggle.checked = false;
  }
});

// User menu dropdown toggle
authUserBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  authDropdown.classList.toggle('hidden');
});
document.addEventListener('click', () => authDropdown.classList.add('hidden'));

// Password visibility toggles
$$('.auth-eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(`#${btn.dataset.target}`);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.innerHTML = isPassword
      ? '<i data-lucide="eye-off"></i>'
      : '<i data-lucide="eye"></i>';
    lucide.createIcons({ nodes: [btn] });
  });
});

// Login submit
authLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const remember = $('#login-remember').checked;
  const btn = authLoginForm.querySelector('.auth-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  clearAuthErrors();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError('login', data.error || 'Login failed'); return; }

    // Save or clear remembered credentials
    if (remember) {
      localStorage.setItem('rememberedUsername', username);
      localStorage.setItem('rememberedPassword', password);
    } else {
      localStorage.removeItem('rememberedUsername');
      localStorage.removeItem('rememberedPassword');
    }

    setAuthUser(data.user);
    hideAuthModal();
    await syncFromServer();
    await initPushToggle();
    showToast(`Welcome back, ${data.user.username}!`, 3000, 'success');
    showView('home');
    if (!$('#home-grid').children.length) loadHome(1);
  } catch {
    showAuthError('login', 'Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Register submit
authRegisterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#reg-username').value.trim();
  const password = $('#reg-password').value;
  const confirm  = $('#reg-confirm').value;
  if (password !== confirm) { showAuthError('register', 'Passwords do not match'); return; }

  const btn = authRegisterForm.querySelector('.auth-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  clearAuthErrors();

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError('register', data.error || 'Registration failed'); return; }
    setAuthUser(data.user);
    hideAuthModal();
    // Push existing localStorage data to server for new account
    await syncToServer();
    await initPushToggle();
    showToast(`Account created! Welcome, ${data.user.username}!`, 3000, 'success');
    showView('home');
    if (!$('#home-grid').children.length) loadHome(1);
  } catch {
    showAuthError('register', 'Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});

// Logout
authLogoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  setAuthUser(null);
  authDropdown.classList.add('hidden');
  showToast('Signed out', 3000, 'success');
  showView('home');
  if (!$('#home-grid').children.length) loadHome(1);
});

// ─── Sync helpers ─────────────────────────────────────────────────────────────
async function syncToServer() {
  if (!state.user) return;
  try {
    await fetch('/api/sync/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarks: state.bookmarks }),
    });
    await fetch('/api/sync/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readHistory: state.readHistory, readChapters: state.readChapters }),
    });
  } catch (err) {
    console.warn('Sync to server failed:', err.message);
  }
}

async function syncFromServer() {
  if (!state.user) return;
  try {
    const [bmRes, histRes] = await Promise.all([
      fetch('/api/sync/bookmarks').then(r => r.json()),
      fetch('/api/sync/history').then(r => r.json()),
    ]);

    // Merge server data with localStorage (server wins on conflict)
    state.bookmarks    = { ...state.bookmarks,    ...bmRes.bookmarks };
    state.readHistory  = { ...state.readHistory,  ...histRes.readHistory };
    state.readChapters = { ...state.readChapters, ...histRes.readChapters };

    localStorage.setItem('bookmarks',    JSON.stringify(state.bookmarks));
    localStorage.setItem('readHistory',  JSON.stringify(state.readHistory));
    localStorage.setItem('readChapters', JSON.stringify(state.readChapters));

    // Refresh current view if relevant
    if (state.currentView === 'favorites') loadFavoritesView(1);
    if (state.currentView === 'history')   loadHistoryView(1);
  } catch (err) {
    console.warn('Sync from server failed:', err.message);
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────
let pushSubscription = null;

function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getPushSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribeToPush() {
  if (!isPushSupported()) {
    showToast('Push notifications are not supported on this browser', 3000, 'error');
    return false;
  }
  if (!state.user) {
    showToast('Sign in to enable notifications', 3000, 'error');
    return false;
  }

  try {
    // Get VAPID public key from server
    const { key } = await fetch('/api/push/vapid-public-key').then(r => r.json());

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notification permission denied', 3000, 'error');
      return false;
    }

    // Subscribe via service worker
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });

    // Save subscription to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });

    pushSubscription = sub;
    localStorage.setItem('pushEnabled', '1');
    updateNotifToggleUI(true);
    showToast('Notifications enabled', 3000, 'success');
    return true;
  } catch (err) {
    console.error('Push subscribe error:', err);
    showToast('Could not enable notifications', 3000, 'error');
    return false;
  }
}

async function unsubscribeFromPush() {
  try {
    const sub = await getPushSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    pushSubscription = null;
    localStorage.removeItem('pushEnabled');
    updateNotifToggleUI(false);
    showToast('Notifications disabled', 3000, 'success');
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    showToast('Could not disable notifications', 3000, 'error');
  }
}

function updateNotifToggleUI(enabled) {
  const toggle       = $('#notif-toggle');
  const label        = $('#notif-toggle-label');
  const mobileToggle = $('#mobile-notif-toggle');
  const mobileLabel  = $('#mobile-notif-toggle-label');
  if (toggle) toggle.checked = enabled;
  if (label)  label.textContent = enabled ? 'Notifications On' : 'Notifications Off';
  if (mobileToggle) mobileToggle.checked = enabled;
  if (mobileLabel)  mobileLabel.textContent = enabled ? 'Notifications On' : 'Notifications Off';
}

async function initPushToggle() {
  if (!isPushSupported()) {
    const wrap = $('#notif-toggle-wrap');
    if (wrap) wrap.style.display = 'none';
    return;
  }
  const sub = await getPushSubscription();
  pushSubscription = sub;
  updateNotifToggleUI(!!sub);
}

// Convert VAPID base64 key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Handle notification click navigation from service worker
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type === 'NAVIGATE' && event.data.url) {
    window.location.href = event.data.url;
  }
  // New service worker activated — reload to get fresh assets
  if (event.data?.type === 'SW_UPDATED') {
    window.location.reload();
  }
});

// ─── Version polling — auto-reload when a new build is deployed ──────────────
(function initVersionCheck() {
  const CURRENT_BUILD = document.documentElement.dataset.buildTime || '0';
  const VERSION_URL   = '/version.json';
  const CHECK_EVERY   = 5 * 60 * 1000; // check every 5 minutes

  async function checkVersion() {
    try {
      const res  = await fetch(VERSION_URL + '?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data.buildTime && String(data.buildTime) !== CURRENT_BUILD && CURRENT_BUILD !== '0') {
        console.log('[version] New build detected, reloading...');
        // Unregister SW so it re-installs fresh, then reload
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        window.location.reload(true);
      }
    } catch { /* network error, try again next interval */ }
  }

  // Start polling after 30s (give the app time to load first)
  setTimeout(() => {
    checkVersion();
    setInterval(checkVersion, CHECK_EVERY);
  }, 30000);
})();

// ─── Footer ───────────────────────────────────────────────────────────────────
$('#footer-year').textContent = new Date().getFullYear();

$$('.footer-nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    sessionStorage.setItem('prevView', state.currentView);
    showView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'home' && !$('#home-grid').children.length) loadHome(1);
    if (view === 'browse' && !$('#browse-grid').children.length) loadBrowse(1);
    if (view === 'history') loadHistoryView();
    if (view === 'favorites') loadFavoritesView();
  });
});

$('#footer-signin-btn').addEventListener('click', () => showAuthModal('login'));
$('#footer-register-btn').addEventListener('click', () => showAuthModal('register'));

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Restore settings
  const savedWidth = localStorage.getItem('imgWidth');
  if (savedWidth) {
    state.imgWidth = parseInt(savedWidth);
    $('#img-width-slider').value = state.imgWidth;
    $('#img-width-val').textContent = `${state.imgWidth}%`;
  }

  // Check if already logged in
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        setAuthUser(data.user);
        await syncFromServer();
        await initPushToggle();
      }
    }
  } catch { /* network error, continue as guest */ }

  // Load home on start
  loadHome(1);
})();
