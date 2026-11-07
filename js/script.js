// ================================================================
// NASA Space Explorer – script.js
// (dateRange.js runs first and sets up the date inputs for us.)
// ================================================================
// Everything lives inside this function so its variable names
// can't collide with the ones dateRange.js already created.
(function () {
'use strict';

// NASA moved APOD to science.nasa.gov in September 2026. The old
// api.nasa.gov/planetary/apod now sends a "NASA Science" placeholder
// (the NASA logo) for every date, and it shuts down on December 1, 2026.
// This is NASA's new APOD API. It needs no API key.
const APOD_URL = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';

// ----- Grab page elements -----
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const getImagesBtn = document.getElementById('getImagesBtn') || document.querySelector('.filters button');
const gallery = document.getElementById('gallery');

const modal = document.getElementById('modal');
const modalMedia = document.getElementById('modalMedia');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalExplanation = document.getElementById('modalExplanation');
const modalCopyright = document.getElementById('modalCopyright');

let apodItems = [];          // the most recent data from the API
let lastFocusedElement = null;

// ================================================================
// 1. Random "Did You Know?" fact (LevelUp)
// ================================================================
const spaceFacts = [
  'A day on Venus (243 Earth days) is longer than its year (225 Earth days).',
  'Sunlight takes about 8 minutes and 20 seconds to reach Earth.',
  'Saturn is less dense than water — it would float in a big enough bathtub.',
  'Jupiter’s Great Red Spot is a storm wider than the entire Earth.',
  'Olympus Mons on Mars is about two and a half times taller than Mount Everest.',
  'Astronauts on the International Space Station see about 16 sunrises every day.',
  'Uranus is tipped on its side, with an axis tilted about 98 degrees.',
  'Footprints left on the Moon could last for millions of years — there’s no wind to erase them.',
  'A teaspoon of neutron star material would weigh around a billion tons on Earth.',
  'Space is silent: sound needs air (or another medium) to travel through.',
  'The Astronomy Picture of the Day has been posting a new image daily since June 16, 1995.',
  'The Milky Way and the Andromeda galaxy are on course to merge in about 4–5 billion years.'
];

function showRandomFact() {
  const factText = document.getElementById('factText');
  factText.textContent = spaceFacts[Math.floor(Math.random() * spaceFacts.length)];
}

// ================================================================
// 2. Helpers
// ================================================================

// Turn "2025-04-17" into "April 17, 2025" (no timezone shifting)
function formatDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day)
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// The new API wants dates as YYMMDD: "2025-04-17" becomes "250417"
function toApodCode(dateString) {
  return dateString.replace(/-/g, '').slice(2);
}

// List every date from start to end as "YYYY-MM-DD"
function datesBetween(start, end) {
  const dates = [];
  const day = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (day <= last) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}

// The new API sends the explanation and credit as HTML. This turns it into
// plain text, so no outside HTML ends up on our page.
function htmlToText(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

// Keep text from the API from being treated as HTML
function escapeHTML(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Can this video URL be shown inside an iframe?
function isEmbeddable(url = '') {
  return url.includes('youtube.com/embed') || url.includes('player.vimeo.com');
}

// Is this the old "NASA Science" placeholder instead of a real picture?
function isPlaceholder(item) {
  return !item.title || item.title.trim() === 'NASA Science' ||
    String(item.hdurl || '').includes('nasa-logo');
}

function showStatus(message, isError = false) {
  gallery.innerHTML = `<div class="status-message${isError ? ' error' : ''}">${message}</div>`;
}

// ================================================================
// 3. Fetch data from NASA's APOD API
// ================================================================

// Ask NASA for one URL and return a list of entries, or throw a clear error
async function requestApod(path = '', params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${APOD_URL}${path}${query ? `?${query}` : ''}`;

  // Give up if NASA takes longer than 20 seconds, instead of loading forever
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error('NASA’s API took too long to answer. Try a shorter date range.');
      timeout.status = 'timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return [];   // no picture published that day
  if (!response.ok) {
    const error = new Error(`NASA’s API returned an error (${response.status}). Wait a minute and try again.`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [data];   // a single date returns one object
}

// Get every entry between two dates (each "YYYY-MM-DD")
async function fetchApodRange(startDate, endDate) {
  try {
    // One request for the whole range
    return await requestApod('', {
      date_from: toApodCode(startDate),
      date_to: toApodCode(endDate),
      per_page: 100
    });
  } catch (error) {
    if (error instanceof TypeError) throw error;   // no internet: don't retry
  }

  // If the range request failed, ask for each day on its own
  const dates = datesBetween(startDate, endDate);
  const results = await Promise.allSettled(dates.map((date) => requestApod(`/${toApodCode(date)}`)));
  const items = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);

  if (items.length === 0) {
    throw new Error('NASA’s API is having trouble right now. Wait a few minutes, or try a different date range.');
  }
  return items;
}

async function getSpaceImages() {
  const startDate = startInput.value;
  let endDate = endInput.value;

  if (!startDate || !endDate) {
    showStatus('Choose both a start date and an end date, then try again.', true);
    return;
  }
  // APOD runs on US Eastern time, so "today" for NASA can be a day behind your computer
  const nasaToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (endDate > nasaToday) {
    endDate = nasaToday;
    endInput.value = nasaToday;
  }
  if (startDate > endDate) {
    showStatus('The start date must be on or before the end date.', true);
    return;
  }

  // Keep requests quick: one month at most
  const MAX_DAYS = 31;
  if (datesBetween(startDate, endDate).length > MAX_DAYS) {
    showStatus(`Pick a range of ${MAX_DAYS} days or fewer.`, true);
    return;
  }

  // Loading message
  showStatus('<span class="spin">🔄</span> Loading space photos…');
  getImagesBtn.disabled = true;

  try {
    const data = await fetchApodRange(startDate, endDate);

    // Keep only real entries inside the chosen dates, one per day
    const byDate = new Map();
    data.forEach((item) => {
      if (item.date >= startDate && item.date <= endDate && !isPlaceholder(item)) {
        byDate.set(item.date, item);
      }
    });

    if (byDate.size === 0) {
      showStatus('No pictures found for those dates. Try a different range.');
      return;
    }

    // Show entries oldest to newest, matching the date range order
    apodItems = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    renderGallery(apodItems);
  } catch (error) {
    console.error(error);
    const message = error instanceof TypeError
      ? 'Couldn’t reach NASA’s API. Check your internet connection and try again.'
      : escapeHTML(error.message);
    showStatus(message, true);
  } finally {
    getImagesBtn.disabled = false;
  }
}

// ================================================================
// 4. Build the gallery
// ================================================================
// In the new API, "hdurl" is the picture (a still image even for videos)
// and "url" / "permalink" is the entry's page on science.nasa.gov.
function renderGallery(items) {
  gallery.innerHTML = items.map((item, index) => {
    const title = escapeHTML(item.title);
    const isVideo = item.media_type && item.media_type !== 'image';
    let media;

    if (item.hdurl) {
      media = `<img src="${escapeHTML(item.hdurl)}" alt="${escapeHTML(item.alt || item.title)}" loading="lazy" />`;
    } else {
      media = `
        <div class="video-fallback">
          <span class="play" aria-hidden="true">▶</span>
          <span>${item.media_type === 'video' ? 'Video entry' : 'Interactive entry'}</span>
        </div>`;
    }
    if (isVideo) media += '<span class="media-badge">▶ Video</span>';

    return `
      <button class="gallery-item" type="button" data-index="${index}">
        <div class="media-frame">${media}</div>
        <h3>${title}</h3>
        <p class="item-date">${formatDate(item.date)}</p>
      </button>`;
  }).join('');
}

// One click listener on the gallery handles every card
gallery.addEventListener('click', (event) => {
  const card = event.target.closest('.gallery-item');
  if (!card) return;
  openModal(apodItems[Number(card.dataset.index)]);
});

// ================================================================
// 5. Modal
// ================================================================
function openModal(item) {
  lastFocusedElement = document.activeElement;
  const title = escapeHTML(item.title);
  const pageUrl = item.permalink || item.url || 'https://science.nasa.gov/apod/';

  if (item.media_type === 'image' && item.hdurl) {
    modalMedia.innerHTML = `<img src="${escapeHTML(item.hdurl)}" alt="${escapeHTML(item.alt || item.title)}" />`;
  } else if (isEmbeddable(item.url)) {
    modalMedia.innerHTML = `
      <div class="video-wrap">
        <iframe src="${escapeHTML(item.url)}" title="${title}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>`;
  } else {
    // Videos and interactive entries play on NASA's own page
    modalMedia.innerHTML = `
      ${item.hdurl ? `<img src="${escapeHTML(item.hdurl)}" alt="${escapeHTML(item.alt || item.title)}" />` : ''}
      <div class="video-link-box">
        <p>This entry is a ${item.media_type === 'video' ? 'video' : 'special media item'} that plays on NASA’s site.</p>
        <a class="watch-link" href="${escapeHTML(pageUrl)}" target="_blank" rel="noopener">Watch on NASA’s APOD page</a>
      </div>`;
  }

  // Drop a leading "Image Credit:" label if NASA already included one
  const credit = htmlToText(item.credit || item.copyright).replace(/^(image\s+)?credit[^:]*:\s*/i, '');
  modalTitle.textContent = item.title;
  modalDate.textContent = formatDate(item.date);
  modalExplanation.textContent = htmlToText(item.explanation);
  modalCopyright.textContent = credit ? `Image credit: ${credit}` : '';

  modal.hidden = false;
  document.body.classList.add('modal-open');
  modal.querySelector('.modal-close').focus();
}

function closeModal() {
  modal.hidden = true;
  modalMedia.innerHTML = '';       // stops any playing video
  document.body.classList.remove('modal-open');
  if (lastFocusedElement) lastFocusedElement.focus();
}

modal.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
});

// ================================================================
// 6. Animated starry background
// ================================================================
function startStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width, height, stars = [], shootingStars = [];

  function makeStars() {
    const count = Math.floor((width * height) / 3500);   // density scales with screen size
    stars = Array.from({ length: count }, () => {
      const depth = Math.random();                       // 0 = far, 1 = near
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.3 + depth * 1.4,
        speed: 0.02 + depth * 0.18,                      // near stars drift faster (parallax)
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.01 + Math.random() * 0.03,
        hue: Math.random() < 0.15 ? (Math.random() < 0.5 ? 210 : 30) : 0  // a few blue/orange stars
      };
    });
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    makeStars();
  }

  function drawStar(star) {
    const alpha = 0.5 + Math.sin(star.twinkle) * 0.5;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fillStyle = star.hue
      ? `hsla(${star.hue}, 90%, 80%, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`;
    ctx.fill();
  }

  function maybeAddShootingStar() {
    if (Math.random() < 0.004 && shootingStars.length < 2) {
      shootingStars.push({
        x: Math.random() * width * 0.8,
        y: Math.random() * height * 0.4,
        vx: 6 + Math.random() * 4,
        vy: 2 + Math.random() * 2,
        life: 0,
        maxLife: 60 + Math.random() * 30
      });
    }
  }

  function drawShootingStars() {
    shootingStars = shootingStars.filter((s) => s.life < s.maxLife);
    shootingStars.forEach((s) => {
      const fade = 1 - s.life / s.maxLife;
      const gradient = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${fade})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12);
      ctx.stroke();
      s.x += s.vx;
      s.y += s.vy;
      s.life++;
    });
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    stars.forEach((star) => {
      star.x -= star.speed;                 // slow drift to the left
      star.twinkle += star.twinkleSpeed;
      if (star.x < -2) {                    // wrap around to the right edge
        star.x = width + 2;
        star.y = Math.random() * height;
      }
      drawStar(star);
    });
    maybeAddShootingStar();
    drawShootingStars();
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);

  if (reduceMotion) {
    stars.forEach(drawStar);                // draw once, no animation
  } else {
    requestAnimationFrame(frame);
  }
}

// ================================================================
// 7. Start everything
// ================================================================
getImagesBtn.addEventListener('click', getSpaceImages);
showRandomFact();
startStarfield();

// If dateRange.js didn't fill in the dates, default to the last 9 days
function toInputDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
if (!startInput.value || !endInput.value) {
  const today = new Date();
  const nineDaysAgo = new Date();
  nineDaysAgo.setDate(today.getDate() - 8);
  endInput.value = toInputDate(today);
  startInput.value = toInputDate(nineDaysAgo);
}

// Show a gallery right away instead of an empty page
getSpaceImages();

})();