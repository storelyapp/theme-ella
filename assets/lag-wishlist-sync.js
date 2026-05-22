/* assets/lag-wishlist-sync.js
   Fixes:
   - true removals + clears
   - multi-device concurrent edits via delta merge
   - de-dupe everywhere
   - periodic reconciliation (pull remote changes)
*/
(function () {
  'use strict';

  // ---- debug ----
  var DEBUG = false;
  var INTERNAL_WRITE = false;
  try {
    var sp = new URLSearchParams(location.search);
    DEBUG = sp.get('lag_debug') === '1' || sp.get('debug') === '1';
  } catch (_) {}
  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[LAG_WISHLIST_SYNC]');
    try { console.log.apply(console, args); } catch (_) {}
  }

  // ---- helpers ----
  function uniq(arr) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < (arr || []).length; i++) {
      var v = String(arr[i] || '').trim();
      if (!v) continue;
      if (seen[v]) continue;
      seen[v] = 1;
      out.push(v);
    }
    return out;
  }
  function safeJsonParse(s, fallback) { try { return JSON.parse(s); } catch (_) { return fallback; } }
  function stableStringify(arr) { return JSON.stringify(uniq(arr).slice().sort()); }
  function eqSet(a, b) { return stableStringify(a) === stableStringify(b); }

  async function fetchJson(url, opts) {
    var res = await fetch(url, opts || {});
    if (!res.ok) return null;
    try { return await res.json(); } catch (_) { return null; }
  }

  // ---- local storage ----
  function getLocalHandles() {
    var raw = null;
    try { raw = localStorage.getItem('wishlistItem') || localStorage.getItem('wishlist'); } catch (_) {}
    if (!raw) return [];
    var parsed = safeJsonParse(raw, null);
    if (Array.isArray(parsed)) return uniq(parsed);
    if (typeof parsed === 'string') return uniq(parsed.split(',').map(function (s) { return s.trim(); }));
    if (typeof raw === 'string' && raw.indexOf(',') >= 0) return uniq(raw.split(',').map(function (s) { return s.trim(); }));
    return [];
  }
  function setLocalHandles(handles) {
    var arr = uniq(Array.isArray(handles) ? handles : []);
    try {
      var payload = JSON.stringify(arr);
      localStorage.setItem('wishlistItem', payload);
      localStorage.setItem('wishlist', payload);
    } catch (_) {}
  }


  // ---- cookie mirror ----
  function setCookie(name, value, days) {
    try {
      var maxAge = (days || 365) * 24 * 60 * 60;
      document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAge + '; samesite=lax';
    } catch (_) {}
  }
  function maybeMirrorToCookie(handles) {
    try {
      var payload = JSON.stringify({ v: 1, items: uniq(handles || []) });
      if (payload.length > 3200) return;
      setCookie('lag_wishlist', payload, 365);
    } catch (_) {}
  }

  function emit(reason, handles) {
    try {
      window.dispatchEvent(new CustomEvent('lag:wishlist_change', {
        detail: { reason: reason, count: (handles || []).length, handles: handles || [] }
      }));
    } catch (_) {}
  }

  // ---- identity ----
  function getCustomerId() {
    if (window.LAG_CUSTOMER_ID != null) return window.LAG_CUSTOMER_ID;
    try {
      var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
      if (meta && meta.page && meta.page.customerId != null) return meta.page.customerId;
    } catch (_) {}
    return null;
  }
  function getOrCreateDeviceId() {
    var key = 'lag_device_id';
    var id = null;
    try { id = localStorage.getItem(key); } catch (_) {}
    if (id) return id;
    id = 'd_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    try { localStorage.setItem(key, id); } catch (_) {}
    return id;
  }

  // ---- backend ----
  function getApiBase() {
    var apiBase = String(window.LAG_API_BASE || '').trim();
    if (!apiBase) return '';
    if (apiBase === 'https://YOUR_DOMAIN_HERE') return '';
    return apiBase.replace(/\/+$/, '');
  }
  function hasBackend() { return !!getApiBase(); }

  async function apiGetCustomerWishlist(customerId) {
    var base = getApiBase();
    if (!base) return null;
    var url = base + '/wishlist/customer/' + encodeURIComponent(String(customerId));
    return fetchJson(url, { method: 'GET', credentials: 'include', headers: { accept: 'application/json' } });
  }

  async function apiUpsertCustomerWishlist(customerId, items, meta) {
    var base = getApiBase();
    if (!base) return null;
    meta = meta || {};
    var url = base + '/wishlist/customer/' + encodeURIComponent(String(customerId));
    var body = {
      items: uniq(items || []),
      event: meta.event || 'wishlist_update',
      url: meta.url || (typeof location !== 'undefined' ? location.href : ''),
      handle: meta.handle || '',
      ts: meta.ts || Date.now(),
      device_id: getOrCreateDeviceId(),
      vid: meta.vid || null,
      sid: meta.sid || null
    };
    return fetchJson(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
  }

  // ---- storage patch ----
  var DIRTY_KEY = 'lag_wl_dirty';
  var SNAP_KEY = 'lag_wl_last_synced_snapshot'; // per-customer snapshot

  // ---- edit backoff (lets users remove multiple items without sync fighting them) ----
  var EDIT_BACKOFF_MS = 2500; // wait this long after the *last* change before syncing
  var _editUntil = 0;

  function noteUserEditing(reason) {
    _editUntil = Date.now() + EDIT_BACKOFF_MS;
    markDirty(reason);
  }

  function isInEditWindow() {
    return Date.now() < _editUntil;
  }

  function snapKeyForCustomer(cid) { return SNAP_KEY + ':' + String(cid); }

  function markDirty(reason) {
    try { localStorage.setItem(DIRTY_KEY, String(Date.now())); } catch (_) {}
    scheduleSync(reason);
  }

  function clearDirty() { try { localStorage.removeItem(DIRTY_KEY); } catch (_) {} }
  function isDirty() { try { return !!localStorage.getItem(DIRTY_KEY); } catch (_) { return true; } }

  (function patchStorage() {
    try {
      if (window.__LAG_WL_STORAGE_PATCHED) return;
      window.__LAG_WL_STORAGE_PATCHED = true;

      var nativeSet = Storage.prototype.setItem;
      var nativeRemove = Storage.prototype.removeItem;

      Storage.prototype.setItem = function (key, value) {
        var ret = nativeSet.apply(this, arguments);
        try {
          if (!INTERNAL_WRITE && this === window.localStorage && (key === 'wishlistItem' || key === 'wishlist')) {
            var handles = getLocalHandles();
            maybeMirrorToCookie(handles);
            noteUserEditing('local_change');
            emit('setItem', handles);
          }
        } catch (_) {}
        return ret;
      };

      Storage.prototype.removeItem = function (key) {
        var ret2 = nativeRemove.apply(this, arguments);
        try {
          if (!INTERNAL_WRITE && this === window.localStorage && (key === 'wishlistItem' || key === 'wishlist')) {
            var handles2 = getLocalHandles();
            maybeMirrorToCookie(handles2);
            noteUserEditing('local_change');
            emit('removeItem', handles2);
          }
        } catch (_) {}
        return ret2;
      };

      log('storage patch ok');
    } catch (e) {
      log('storage patch failed', e);
    }
  })();

  // ---- delta merge (multi-device safe) ----
  function getLastSnapshot(cid) {
    try { return safeJsonParse(localStorage.getItem(snapKeyForCustomer(cid)) || '[]', []); } catch (_) { return []; }
  }
  function setLastSnapshot(cid, items) {
    try { localStorage.setItem(snapKeyForCustomer(cid), JSON.stringify(uniq(items || []))); } catch (_) {}
  }
  function diffAddedRemoved(prev, next) {
    var p = uniq(prev || []);
    var n = uniq(next || []);
    var ps = Object.create(null);
    var ns = Object.create(null);
    for (var i = 0; i < p.length; i++) ps[p[i]] = 1;
    for (var j = 0; j < n.length; j++) ns[n[j]] = 1;

    var added = [];
    var removed = [];
    for (var k = 0; k < n.length; k++) if (!ps[n[k]]) added.push(n[k]);
    for (var m = 0; m < p.length; m++) if (!ns[p[m]]) removed.push(p[m]);
    return { added: added, removed: removed };
  }
  function applyDelta(remoteItems, delta) {
    var base = uniq(remoteItems || []);
    var removeSet = Object.create(null);
    for (var i = 0; i < (delta.removed || []).length; i++) removeSet[delta.removed[i]] = 1;

    var out = [];
    for (var j = 0; j < base.length; j++) if (!removeSet[base[j]]) out.push(base[j]);
    out = uniq(out.concat(delta.added || []));
    return out;
  }

  // ---- sync ----
  var syncTimer = null;
  var syncInFlight = false;
  var syncPending = false;

  function scheduleSync(reason) {
    if (!hasBackend()) return;
    if (getCustomerId() == null) return;

    if (syncTimer) clearTimeout(syncTimer);

    // If user is still editing, schedule for right after the window closes.
    var now = Date.now();
    var wait = 700;
    if (now < _editUntil) {
      wait = Math.max(wait, (_editUntil - now) + 50);
    }

    syncTimer = setTimeout(function () {
      syncTimer = null;
      syncNow(reason || 'debounced');
    }, wait);
  }


  async function syncNow(reason, opts) {
    opts = opts || {};
    if (!opts.force && isInEditWindow()) {
      scheduleSync('backoff');
      return;
    }

    if (!hasBackend()) return;
    var cid = getCustomerId();
    if (cid == null) return;

    if (syncInFlight) { syncPending = true; return; }
    syncInFlight = true;

    try {
      var local = getLocalHandles();
      var remote = await apiGetCustomerWishlist(cid);
      var remoteItems = (remote && Array.isArray(remote.items)) ? uniq(remote.items) : [];

      var dirty = isDirty();

      // If dirty, compute delta vs last snapshot and apply to latest remote.
      // This preserves removals and handles concurrent edits from other devices.
      var desired;
      if (dirty) {
        var prevSnap = getLastSnapshot(cid);
        var delta = diffAddedRemoved(prevSnap, local);

        // If user cleared all locally, that should clear remote too.
        if (local.length === 0 && prevSnap.length > 0) {
          desired = [];
        } else {
          desired = applyDelta(remoteItems, delta);
        }
      } else {
        // Not dirty: just reconcile (pull remote additions)
        desired = uniq(remoteItems.concat(local));
      }

      // Update local to desired if needed
      if (!eqSet(local, desired)) {
        INTERNAL_WRITE = true;
        try {
          setLocalHandles(desired);
        } finally {
          INTERNAL_WRITE = false;
        }

        maybeMirrorToCookie(desired);
        emit('sync_local_updated', desired);
      }

      // Push to server if needed
      if (!eqSet(remoteItems, desired)) {
        await apiUpsertCustomerWishlist(cid, desired, {
          event: dirty ? 'wishlist_update' : 'wishlist_sync',
          url: (typeof location !== 'undefined' ? location.href : ''),
          ts: Date.now()
        });
        emit('sync_remote_updated', desired);
      }

      // Update snapshot to what we believe is the truth now
      setLastSnapshot(cid, desired);
      clearDirty();
      log('sync ok', { reason: reason, customerId: cid, dirty: dirty, count: desired.length });
    } catch (e) {
      log('sync failed', e);
      // keep dirty so it retries later
    } finally {
      syncInFlight = false;
      if (syncPending) {
        syncPending = false;
        try { await syncNow('pending'); } catch (_) {}
      }
    }
  }

  // ---- login watcher ----
  var lastKnownCustomerId = null;
  function startCustomerWatcher() {
    lastKnownCustomerId = getCustomerId();

    // initial sync if logged in
    if (lastKnownCustomerId != null) syncNow('init_logged_in');

    setInterval(function () {
      var current = getCustomerId();

      if (lastKnownCustomerId == null && current != null) {
        lastKnownCustomerId = current;
        emit('login_detected', getLocalHandles());
        // union happens naturally; delta logic prevents lost updates
        markDirty('login_merge');
        syncNow('login_merge');
        return;
      }

      if (lastKnownCustomerId != null && current == null) {
        lastKnownCustomerId = null;
        emit('logout_detected', getLocalHandles());
        return;
      }

      if (lastKnownCustomerId != null && current != null && String(lastKnownCustomerId) !== String(current)) {
        lastKnownCustomerId = current;
        emit('customer_changed', getLocalHandles());
        markDirty('customer_changed');
        syncNow('customer_changed');
      }
    }, 3000);
  }

  // ---- public API ----
  window.LAG_WISHLIST = window.LAG_WISHLIST || {};
  window.LAG_WISHLIST.getItems = function () { return getLocalHandles(); };
  window.LAG_WISHLIST.setItems = function (handles) {
    setLocalHandles(handles);
    var h = getLocalHandles();
    maybeMirrorToCookie(h);
    markDirty('set_api');
    emit('set', h);
    return h;
  };
  window.LAG_WISHLIST.syncNow = function (reason) { return syncNow(reason || 'manual'); };

  // ---- init ----
  (function init() {
    var h = getLocalHandles();
    maybeMirrorToCookie(h);
    emit('init', h);
    startCustomerWatcher();

    function flushNow() {
      try { syncNow('pagehide_flush', { force: true }); } catch (_) {}
    }

    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushNow();
    });


    // periodic reconcile to pull other-device changes even without local edits
    setInterval(function () {
      if (hasBackend() && getCustomerId() != null && !isDirty()) syncNow('periodic_reconcile');
    }, 45000);

    log('init ok');
  })();
})();
