/**
 * Lagorii ETA (PIN-only)
 * - Loads estimate-delivery.json (window.LAG_ETA_URL / window.LAG_ETA_JSON_URL) once
 * - Indexes PIN → record
 * - Exposes: LagETA.byPin(pin), LagETA.resolveByPin(pin), LagETA.getCookie(), LagETA.setCookie(obj), LagETA.hydrateFromCustomer()
 * - No Geoapify / geolocation logic (ETA is PIN-driven)
 */
(function () {
  "use strict";

  const COOKIE = "lag_eta_v1";
  const COOKIE_DAYS = 30;
  const COOKIE_DOMAIN = ".lagorii.com";

  let _ready = false;
  let _dataPromise = null;
  let _pinIndex = null; // Map<pin, record>
  let _lastLoadErr = null;

  const hasEtaUI = () =>
    !!document.querySelector('[data-lag-eta],[data-eta-modal],[data-hero-eta],[data-eta-open],#lagoriiHeroEta');

  const normPin = (v) => String(v || "").replace(/\D+/g, "").slice(0, 6);

  function setCookieRaw(name, value, days) {
    try {
      const maxAge = Math.round((days || 30) * 86400);
      document.cookie =
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Domain=${COOKIE_DOMAIN}`;
    } catch (e) {}
  }

  function getCookieRaw(name) {
    try {
      const n = encodeURIComponent(name) + "=";
      const parts = document.cookie.split("; ");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].indexOf(n) === 0) return decodeURIComponent(parts[i].slice(n.length));
      }
    } catch (e) {}
    return "";
  }

  function setCookieObj(obj) {
    try {
      setCookieRaw(COOKIE, JSON.stringify(obj || {}), COOKIE_DAYS);
    } catch (e) {}
  }

  function getCookieObj() {
    try {
      const raw = getCookieRaw(COOKIE);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function loadETA() {
    if (_dataPromise) return _dataPromise;

    _dataPromise = (async () => {
      const url = (window.LAG_ETA_URL || window.LAG_ETA_JSON_URL || "").toString();
      if (!url) throw new Error("Missing window.LAG_ETA_URL");

      const data = await fetchJson(url);

      // Build PIN index
      const map = new Map();
      const buckets = (data && data.buckets) || {};
      for (const timeline of Object.keys(buckets)) {
        const arr = buckets[timeline] || [];
        for (let i = 0; i < arr.length; i++) {
          const row = arr[i];
          if (!row || row.pin == null) continue;
          const pin = normPin(row.pin);
          if (!pin) continue;
          map.set(pin, { timeline, ...row, pin });
        }
      }

      _pinIndex = map;
      return data;
    })().catch((err) => {
      _lastLoadErr = err;
      console.warn("[LagETA] loadETA failed:", err);
      _pinIndex = new Map();
      return null;
    });

    return _dataPromise;
  }

  async function ensureReady() {
    if (_ready) return true;
    await loadETA();
    _ready = true;
    return true;
  }

  function resolveByPin(pin) {
    const p = normPin(pin);
    if (!p || !_pinIndex) return null;
    return _pinIndex.get(p) || null;
  }

  function emitEta(pin, result) {
    try {
      window.dispatchEvent(
        new CustomEvent("lag:eta", { detail: { pin: String(pin || ""), result: result || null } })
      );
    } catch (e) {}
  }

  async function byPin(pin) {
    const p = normPin(pin);
    if (p.length !== 6) return null;

    await ensureReady();

    const rec = resolveByPin(p);
    if (!rec) return null;

    const payload = {
      pin: rec.pin,
      timeline: rec.timeline,
      label: rec.label || "",
      express: rec.express || "",
      standard: rec.standard || "",
      city: rec.city || "",
      state: rec.state || "",
      ts: Date.now(),
    };

    setCookieObj(payload);
    emitEta(p, payload);
    return payload;
  }

  function hydrateFromCustomer() {
    // If a customer has a saved default ZIP, hydrate once (no UI clicks needed).
    try {
      const pin = normPin(window.LAG_CUSTOMER_PIN);
      if (!pin || pin.length !== 6) return;
      // Don't override if user already chose a pin.
      const existing = getCookieObj();
      if (existing && existing.pin) return;
      byPin(pin);
    } catch (e) {}
  }

  function ready() {
    return !!_ready;
  }

  // Expose API
  window.LagETA = window.LagETA || {};
  window.LagETA.load = loadETA;
  window.LagETA.ready = ready;
  window.LagETA.resolveByPin = resolveByPin;
  window.LagETA.byPin = byPin;
  window.LagETA.getCookie = getCookieObj;
  window.LagETA.setCookie = setCookieObj;
  window.LagETA.hydrateFromCustomer = hydrateFromCustomer;
  window.LagETA._debug = () => ({ ready: _ready, lastLoadErr: _lastLoadErr, pins: _pinIndex ? _pinIndex.size : 0 });

  // Boot only if an ETA UI exists on the page
  document.addEventListener(
    "DOMContentLoaded",
    async () => {
      if (!hasEtaUI()) return;
      await ensureReady();
      hydrateFromCustomer();

      try {
        window.dispatchEvent(new CustomEvent("lageta:ready", { detail: { ok: true } }));
      } catch (e) {}
    },
    { passive: true }
  );
})();
