/* assets/lag-share.js
   Lagorii Share
   - Product: overlay strip (copy + channels)
   - Wishlist: native share when data-share-ui="native"

   Events (for analytics later):
     lag:share_overlay_open, lag:copy_success, lag:channel_click, lag:share_arrival
*/
(function () {
  'use strict';

  var DEBUG = false;
  try {
    var sp = new URLSearchParams(location.search);
    DEBUG = sp.get('lag_debug') === '1' || sp.get('debug') === 'lag';
  } catch (_) {}

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[LAG_SHARE]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function uuidv4() {
    // good enough for client-side tracking ids
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
  }

  function ensureShareId() {
    try {
      var key = 'lag_share_client_id';
      var id = localStorage.getItem(key);
      if (!id) { id = uuidv4(); localStorage.setItem(key, id); }
      return id;
    } catch (_) {
      return uuidv4();
    }
  }

  function getApiBase() {
    var base = (window.LAG_API_BASE || '').trim();
    if (!base) return '';
    if (base.indexOf('YOUR_DOMAIN_HERE') !== -1) return '';
    if (!/^https?:\/\//i.test(base)) return '';
    return base.replace(/\/+$/, '');
  }

  function beacon(path, payload) {
    try {
      var base = getApiBase();
      if (!base) return;
      var url = base + path;
      var body = JSON.stringify(payload || {});
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  function buildUrl(baseUrl, params) {
    var u = new URL(baseUrl, location.origin);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      u.searchParams.set(k, String(params[k]));
    });
    return u.toString();
  }

  function copyToClipboard(text) {
    if (!text) return Promise.reject(new Error('no text'));

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    // fallback
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  // --- Overlay UI (product) -------------------------------------------------

  function closeOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function openOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function ensureOverlay() {
    var existing = document.getElementById('lag-share-overlay');
    if (existing) return existing;

    var overlay = document.createElement('div');
    overlay.id = 'lag-share-overlay';
    overlay.className = 'lagShareOverlay';
    overlay.setAttribute('aria-hidden', 'true');

    overlay.innerHTML = '' +
      '<div class="lagShareOverlay__panel" role="dialog" aria-label="Share">' +
        '<div class="lagShareOverlay__head">' +
          '<div class="lagShareOverlay__title">Share</div>' +
          '<button type="button" class="lagShareOverlay__close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="lagShareOverlay__grid">' +
          '<button type="button" class="lagShareBtn" data-channel="copy">Copy link</button>' +
          '<button type="button" class="lagShareBtn" data-channel="whatsapp">WhatsApp</button>' +
          '<button type="button" class="lagShareBtn" data-channel="facebook">Facebook</button>' +
          '<button type="button" class="lagShareBtn" data-channel="x">X</button>' +
          '<button type="button" class="lagShareBtn" data-channel="email">Email</button>' +
          '<button type="button" class="lagShareBtn" data-channel="sms">SMS</button>' +
        '</div>' +
        '<div class="lagShareOverlay__toast" role="status" aria-live="polite"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeOverlay(overlay);
    });
    overlay.querySelector('.lagShareOverlay__close').addEventListener('click', function () {
      closeOverlay(overlay);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeOverlay(overlay);
    });

    return overlay;
  }

  function showOverlayToast(overlay, msg) {
    if (!overlay) return;
    var el = overlay.querySelector('.lagShareOverlay__toast');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 1400);
  }

  function openChannel(channel, url, title) {
    var encodedUrl = encodeURIComponent(url);
    var encodedTitle = encodeURIComponent(title || '');

    var href = url;
    switch (channel) {
      case 'whatsapp':
        href = 'https://wa.me/?text=' + encodedTitle + (title ? '%0A' : '') + encodedUrl;
        break;
      case 'facebook':
        href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl;
        break;
      case 'x':
        href = 'https://twitter.com/intent/tweet?url=' + encodedUrl + (title ? '&text=' + encodedTitle : '');
        break;
      case 'email':
        href = 'mailto:?subject=' + encodedTitle + '&body=' + encodedUrl;
        break;
      case 'sms':
        // iOS uses &body, Android uses ?body. Use ?body and append properly.
        href = 'sms:?&body=' + encodedTitle + (title ? '%0A' : '') + encodedUrl;
        break;
      default:
        href = url;
    }

    window.open(href, '_blank', 'noopener');
  }

  // --- Wishlist integration -------------------------------------------------

  function getWishlistShareMeta() {
    // lag-wishlist-sync.js exposes window.LAG_WISHLIST
    var wl = window.LAG_WISHLIST;
    if (!wl || typeof wl.getSharePayload !== 'function') return null;
    return wl.getSharePayload();
  }

  // --- Main click handler ---------------------------------------------------

  function getBtnMode(btn) {
    var m = btn.getAttribute('data-share-ui') || btn.getAttribute('data-lag-share-ui') || '';
    return (m || '').toLowerCase();
  }

  function getShareType(btn) {
    var t = btn.getAttribute('data-lag-share-type') || btn.getAttribute('data-share-type') || '';
    t = (t || '').toLowerCase();
    return t || 'product';
  }

  function buildShareUrlForProduct(btn, shareId) {
    var url = btn.getAttribute('data-share-url') || location.href;
    // remove existing share params, keep everything else
    var u = new URL(url, location.origin);
    u.searchParams.delete('lag_share');
    u.searchParams.delete('lag_share_id');
    u.searchParams.delete('lag_share_type');

    u.searchParams.set('lag_share', '1');
    u.searchParams.set('lag_share_type', 'product');
    u.searchParams.set('lag_share_id', shareId);

    return u.toString();
  }

  function buildShareUrlForWishlist(shareId) {
    var meta = getWishlistShareMeta();
    if (!meta) {
      // fallback: share the wishlist page itself
      return buildUrl((window.LAG_WISHLIST_PATH || '/pages/wish-list'), {
        lag_share: 1,
        lag_share_type: 'wishlist',
        lag_share_id: shareId
      });
    }

    // meta.url already includes w=... or s=...
    var u = new URL(meta.url, location.origin);
    u.searchParams.set('lag_share', '1');
    u.searchParams.set('lag_share_type', 'wishlist');
    u.searchParams.set('lag_share_id', shareId);
    return u.toString();
  }

  function handleNativeShare(btn, payload) {
    // payload: { title, text, url }
    if (navigator.share) {
      return navigator.share(payload);
    }
    // fallback: copy
    return copyToClipboard(payload.url);
  }

  function init() {
    if (window.__LAG_SHARE_INIT) return;
    window.__LAG_SHARE_INIT = true;

    // Track arrivals (referee)
    try {
      var sp = new URLSearchParams(location.search);
      if (sp.get('lag_share') === '1' && sp.get('lag_share_id')) {
        dispatch('lag:share_arrival', {
          share_id: sp.get('lag_share_id'),
          share_type: sp.get('lag_share_type') || null,
          url: location.href,
          customer_id: window.LAG_CUSTOMER_ID || null
        });
        beacon('/share/arrival', {
          share_id: sp.get('lag_share_id'),
          share_type: sp.get('lag_share_type') || null,
          url: location.href,
          customer_id: window.LAG_CUSTOMER_ID || null
        });
        log('share arrival', sp.get('lag_share_type'), sp.get('lag_share_id'));
      }
    } catch (_) {}

    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-lag-share-btn]') : null;
      if (!btn) return;

      e.preventDefault();

      var shareId = ensureShareId();
      var shareType = getShareType(btn);
      var mode = getBtnMode(btn);

      var title = btn.getAttribute('data-share-title') || document.title || '';
      var text = btn.getAttribute('data-share-text') || '';

      if (shareType === 'wishlist') {
        // Always prefer native for wishlist unless explicitly overridden
        var wlMeta = getWishlistShareMeta();

        var shareUrl = buildShareUrlForWishlist(shareId);
        var payload = { title: title || (wlMeta && wlMeta.title) || 'Wishlist', text: text || '', url: shareUrl };

        beacon('/share/intent', {
          share_id: shareId,
          share_type: 'wishlist',
          ui: mode,
          url: shareUrl,
          customer_id: window.LAG_CUSTOMER_ID || null
        });

        dispatch('lag:channel_click', { channel: 'native', share_type: 'wishlist', share_id: shareId });
        log('wishlist share', payload.url);

        handleNativeShare(btn, payload)
          .then(function () {
            // if navigator.share succeeded, great. if fallback copy succeeded, also ok.
            dispatch('lag:share_success', { share_type: 'wishlist', share_id: shareId });
          })
          .catch(function (err) {
            log('native share failed', err);
            dispatch('lag:share_fail', { share_type: 'wishlist', share_id: shareId, error: String(err && err.message || err) });
          });

        return;
      }

      // Product share (overlay by default)
      var overlay = ensureOverlay();
      openOverlay(overlay);
      dispatch('lag:share_overlay_open', { share_type: 'product', share_id: shareId });

      var shareUrlP = buildShareUrlForProduct(btn, shareId);

      // bind button clicks inside overlay
      overlay.onclick = function (evt) {
        var cbtn = evt.target && evt.target.closest ? evt.target.closest('[data-channel]') : null;
        if (!cbtn) {
          if (evt.target === overlay) closeOverlay(overlay);
          return;
        }

        var channel = cbtn.getAttribute('data-channel');
        if (!channel) return;

        if (channel === 'copy') {
          copyToClipboard(shareUrlP)
            .then(function () {
              showOverlayToast(overlay, 'Link copied');
              dispatch('lag:copy_success', { share_type: 'product', share_id: shareId });
            })
            .catch(function (err) {
              showOverlayToast(overlay, 'Copy failed');
              dispatch('lag:copy_fail', { share_type: 'product', share_id: shareId, error: String(err && err.message || err) });
            });
          return;
        }

        openChannel(channel, shareUrlP, title);
        dispatch('lag:channel_click', { channel: channel, share_type: 'product', share_id: shareId });
      };

      log('product share url', shareUrlP, 'mode', mode);
    });

    log('init ok');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
