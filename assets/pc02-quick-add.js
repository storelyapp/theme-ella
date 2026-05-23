(function () {
  "use strict";

  if (window.__PC02_QUICKADD_INIT__) return;
  window.__PC02_QUICKADD_INIT__ = true;

  var OVERLAY_ID = "pc02-qa-overlay";
  var PANEL_ID   = "pc02-qa-panel";
  var BODY_ID    = "pc02-qa-body";

  /* Product data cache — persists across opens in the same session */
  var PRODUCT_CACHE = new Map();
  var INFLIGHT      = new Map();

  var LAST_OPEN_TS  = 0;

  /* Scroll-lock state */
  var SCROLL_Y = 0;

  var state = {
    product: null,
    handle: null,
    optionIndex: 0,
    selections: [],
    variant: null,
    kiwi: null
  };

  /* ── Device detection ──────────────────────────────────────────────────── */
  function isDrawer() {
    return window.matchMedia("(max-width: 1024px)").matches ||
           window.matchMedia("(hover: none)").matches;
  }

  /* ── Shell (created once, reused) ─────────────────────────────────────── */
  /* NOTE: All visual CSS has been moved to pc02-carousel.css.
     This function now only builds DOM — no runtime style injection.
     This means the styles are parsed once at page load (stylesheet),
     not lazily on the first quick-add click. */
  function ensureShell() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.className = "pc02-qa-overlay";
      overlay.hidden = true;
      document.body.appendChild(overlay);
    }

    if (!overlay.__pc02_close_bound) {
      overlay.__pc02_close_bound = true;
      overlay.addEventListener("pointerdown", function () {
        if (document.documentElement.classList.contains("pc02-qa-open")) close();
      }, true);
    }

    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "pc02-qa-panel";
      panel.hidden = true;
      panel.innerHTML =
        '<div class="pc02-qa-grab" data-pc02-qa-grab>' +
          '<div class="pc02-qa-grabbar"></div>' +
        '</div>' +
        '<div class="pc02-qa-body" id="' + BODY_ID + '"></div>';
      document.body.appendChild(panel);
    }

    return { overlay: overlay, panel: panel, body: document.getElementById(BODY_ID) };
  }

  /* ── Scroll lock (iOS-safe) ────────────────────────────────────────────── */
  /*
    overflow:hidden on <html> avoids the scroll-to-top jump that
    position:fixed causes on iOS. Inject one tiny rule at boot time —
    not on each open.
  */
  (function injectScrollLockRule() {
    var id = "pc02-qa-scroll-lock-rule";
    if (document.getElementById(id)) return;
    var s = document.createElement("style");
    s.id = id;
    s.textContent =
      "html.pc02-qa-scroll-locked{overflow:hidden!important;}" +
      "html.pc02-qa-scroll-locked body{overflow:hidden!important;}";
    document.head.appendChild(s);
  })();

  function lockScroll() {
    SCROLL_Y = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("pc02-qa-scroll-locked");
    document.documentElement.classList.add("pc02-qa-open");
  }

  function unlockScroll() {
    document.documentElement.classList.remove("pc02-qa-open");
    document.documentElement.classList.remove("pc02-qa-scroll-locked");
    try {
      window.scrollTo({ top: SCROLL_Y, behavior: "instant" });
    } catch (_) {
      window.scrollTo(0, SCROLL_Y);
    }
  }

  /* ── Sticky-header suppression ─────────────────────────────────────────── */
  /*
    Shopify headers often use position:fixed with z-index:auto, which
    creates a stacking context whose paint order is determined by DOM order —
    meaning the header paints on top of our overlay regardless of z-index.

    On open  → find every fixed/sticky element that would cover our panel,
                save its current inline z-index, set it to 0.
    On close → restore all saved values exactly, no side-effects.
  */
  var _suppressedHeaders = [];

  function suppressHeaders() {
    _suppressedHeaders = [];
    var selectors = [
      "header", ".header", ".site-header", ".sticky-header",
      "[class*='header']", "[id*='header']",
      ".announcement-bar", ".header-wrapper", ".shopify-section-header"
    ].join(",");
    try {
      var candidates = document.querySelectorAll(selectors);
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var cs = window.getComputedStyle(el);
        var pos = cs.position;
        if (pos !== "fixed" && pos !== "sticky") continue;
        var z = cs.zIndex;
        var zNum = parseInt(z, 10);
        if (z === "auto" || (!isNaN(zNum) && zNum >= 9990)) {
          _suppressedHeaders.push({ el: el, z: el.style.zIndex });
          el.style.zIndex = "0";
        }
      }
    } catch (_) {}
  }

  function restoreHeaders() {
    for (var i = 0; i < _suppressedHeaders.length; i++) {
      try { _suppressedHeaders[i].el.style.zIndex = _suppressedHeaders[i].z; }
      catch (_) {}
    }
    _suppressedHeaders = [];
  }

  /* ── Open / close ───────────────────────────────────────────────────────── */
  /*
    CLOSE_DURATION_MS must equal the longest CSS exit transition.
    Drawer close = 300ms, popup close = 260ms  →  use 300ms.
    After this delay: hidden=true, DOM cleared, headers restored.
  */
  var CLOSE_DURATION_MS = 300;
  var _closeTimer = null;

  function openShell() {
    /* Cancel any in-flight close so rapid re-open works cleanly */
    if (_closeTimer) {
      clearTimeout(_closeTimer);
      _closeTimer = null;
    }

    var shell = ensureShell();
    shell.panel.classList.toggle("is-drawer", isDrawer());
    shell.panel.classList.remove("is-closing"); /* clear interrupted close */

    shell.overlay.hidden = false;
    shell.panel.hidden   = false;

    lockScroll();
    suppressHeaders();
    return shell;
  }

  function close() {
    if (!document.documentElement.classList.contains("pc02-qa-open")) return;

    var shell = ensureShell();

    /* 1. Add exit class — CSS switches to the fast ease-in curve */
    shell.panel.classList.add("is-closing");

    /* 2. Remove "open" class — triggers CSS fade/slide-out transitions */
    unlockScroll();

    /* 3. After CSS transition finishes: hide DOM, clear content, restore headers */
    if (_closeTimer) clearTimeout(_closeTimer);
    _closeTimer = setTimeout(function () {
      _closeTimer = null;
      var s = ensureShell();
      s.overlay.hidden = true;
      s.panel.hidden   = true;
      s.panel.classList.remove("is-closing");
      if (s.body) s.body.innerHTML = "";
      restoreHeaders();
      state.product     = null;
      state.handle      = null;
      state.optionIndex = 0;
      state.selections  = [];
      state.variant     = null;
      state.kiwi        = null;
    }, CLOSE_DURATION_MS);
  }

  /* ── Product fetch (with deduplication + cache) ──────────────────────── */
  function fetchProduct(handle) {
    if (PRODUCT_CACHE.has(handle)) return Promise.resolve(PRODUCT_CACHE.get(handle));
    if (INFLIGHT.has(handle)) return INFLIGHT.get(handle);

    var p = fetch("/products/" + encodeURIComponent(handle) + ".js", {
      credentials: "same-origin",
      /* Keep-alive reuses the TCP connection — saves ~100 ms on mobile */
      keepalive: true
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load product");
        return res.json();
      })
      .then(function (json) {
        PRODUCT_CACHE.set(handle, json);
        INFLIGHT.delete(handle);
        return json;
      })
      .catch(function (err) {
        INFLIGHT.delete(handle);
        throw err;
      });

    INFLIGHT.set(handle, p);
    return p;
  }

  /* ── Prefetch on hover / touchstart ─────────────────────────────────── */
  function prefetch(handle) {
    if (!handle || PRODUCT_CACHE.has(handle) || INFLIGHT.has(handle)) return;
    fetchProduct(handle).catch(function () {});
  }

  document.addEventListener("mouseover", function (e) {
    var btn = e.target.closest && e.target.closest("[data-pc02-quickadd]");
    if (btn) prefetch(btn.getAttribute("data-product-handle"));
  }, { passive: true });

  document.addEventListener("touchstart", function (e) {
    var btn = e.target.closest && e.target.closest("[data-pc02-quickadd]");
    if (btn) prefetch(btn.getAttribute("data-product-handle"));
  }, { passive: true });

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMoney(cents) {
    try {
      if (window.Shopify && typeof window.Shopify.formatMoney === "function")
        return window.Shopify.formatMoney(cents, window.money_format || window.Shopify.money_format);
    } catch (_) {}
    return "\u20B9 " + (Number(cents || 0) / 100).toFixed(0);
  }

  function salePercent(variant) {
    var price = Number(variant && variant.price || 0);
    var compare = Number(variant && variant.compare_at_price || 0);

    if (!compare || compare <= price) return 0;

    return Math.round(((compare - price) * 100) / compare);
  }

  function renderVariantPrice(variant) {
    if (!variant) return "";

    var price = Number(variant.price || 0);
    var compare = Number(variant.compare_at_price || 0);
    var discount = salePercent(variant);
    var current = '<span class="pc02-qa-current">' + formatMoney(price) + '</span>';

    if (!discount) {
      return '<div class="pc02-qa-price pc02-qa-price--regular" data-pc02-qa-price>' + current + '</div>';
    }

    return '<div class="pc02-qa-price pc02-qa-price--sale" data-pc02-qa-price>' +
      current +
      '<s class="pc02-qa-compare">' + formatMoney(compare) + '</s>' +
      '<span class="pc02-qa-discount">' + discount + '% OFF</span>' +
    '</div>';
  }

  function pickDefaultVariant(p) {
    return (p.variants || []).find(function (x) { return x.available; }) ||
           (p.variants || [])[0] || null;
  }

  function optionIndexForSize(p) {
    var idx = -1;
    if (Array.isArray(p.options)) {
      for (var i = 0; i < p.options.length; i++) {
        if (String(p.options[i] || "").toLowerCase().trim() === "size") {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = 0;
    }
    return Math.max(0, idx);
  }

  function buildSizeValues(p, optionIndex) {
    var seen = Object.create(null);
    var out  = [];
    var key  = "option" + (optionIndex + 1);
    var variants = p.variants || [];

    for (var i = 0; i < variants.length; i++) {
      var val = variants[i][key];
      if (!val || seen[val]) continue;
      seen[val] = true;

      var anyAvail = false;
      for (var j = 0; j < variants.length; j++) {
        if (variants[j][key] === val && variants[j].available) { anyAvail = true; break; }
      }
      out.push({ value: val, available: anyAvail });
    }
    return out;
  }

  function findVariant(p, selections) {
    var variants = p.variants || [];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var match = true;
      for (var j = 0; j < selections.length; j++) {
        if (v["option" + (j + 1)] !== selections[j]) { match = false; break; }
      }
      if (match) return v;
    }
    return null;
  }

  /* ── Skeleton ────────────────────────────────────────────────────────── */
  function renderSkeleton(body) {
    body.innerHTML =
      '<div class="pc02-qa-skel">' +
        '<div class="pc02-qa-skel__thumb"></div>' +
        '<div class="pc02-qa-skel__lines">' +
          '<div class="pc02-qa-skel__line w1"></div>' +
          '<div class="pc02-qa-skel__line w2"></div>' +
          '<div class="pc02-qa-skel__line w3"></div>' +
        '</div>' +
      '</div>' +
      '<div style="height:12px"></div>' +
      '<div class="pc02-qa-skel__line w2"></div>' +
      '<div class="pc02-qa-skel__line w1"></div>' +
      '<div class="pc02-qa-skel__line w2"></div>';
  }

  /* ── Halo / LAG add-to-cart popup ────────────────────────────────────── */
  function showHaloAtcPopup(addedItem) {
    try {
      var popup = document.getElementById("halo-add-to-cart-popup");
      if (!popup) {
        document.body.classList.add("add-to-cart-show");
        return;
      }

      try { popup.setAttribute("data-lag-show-image", "1"); } catch (_) {}

      var url   = (addedItem && addedItem.url)                             ? addedItem.url   : "";
      var title = (addedItem && (addedItem.product_title || addedItem.title)) ? (addedItem.product_title || addedItem.title) : "";

      var imgUrl = "";
      if (addedItem && addedItem.featured_image) {
        if (typeof addedItem.featured_image === "string") imgUrl = addedItem.featured_image;
        else if (addedItem.featured_image.url) imgUrl = addedItem.featured_image.url;
        else if (addedItem.featured_image.src) imgUrl = addedItem.featured_image.src;
      }
      if (!imgUrl && addedItem && addedItem.image) imgUrl = addedItem.image;

      /* Fallback to quick-add state */
      if (!imgUrl && state.product && state.product.images && state.product.images[0])
        imgUrl = state.product.images[0];
      if (!url   && state.product && state.product.url)   url   = state.product.url;
      if (!title && state.product && state.product.title) title = state.product.title;

      var imgLink  = popup.querySelector("a.product-image") || popup.querySelector(".product-image");
      var img      = popup.querySelector(".product-image img") || (imgLink && imgLink.querySelector("img"));
      var titleLink = popup.querySelector(".product-title .title");

      if (imgLink && url) imgLink.href = url;
      if (titleLink) {
        if (url) titleLink.href = url;
        titleLink.textContent = title || "";
      }

      function applyImage(u) {
        if (!img || !u) return;
        if (typeof u === "string" && u.indexOf("//") === 0) u = location.protocol + u;
        var sized = u;
        try {
          sized = u.indexOf("?") === -1 ? u + "?width=240" : u + "&width=240";
        } catch (_) {}
        try { img.loading = "eager"; img.decoding = "async"; } catch (_) {}
        img.setAttribute("src", sized);
        img.setAttribute("srcset", sized);
        img.alt = title || "";
        try {
          if (imgLink && imgLink.style) imgLink.style.backgroundImage = 'url("' + sized + '")';
        } catch (_) {}
      }

      /* Apply immediately — one retry at 200 ms is enough for theme re-renders.
         The original had 4 retries at 120/400/900 ms; two is sufficient and
         avoids unnecessary work on the main thread. */
      applyImage(imgUrl);
      setTimeout(function () { applyImage(imgUrl); }, 200);

      document.body.classList.add("add-to-cart-show");

      document.dispatchEvent(new CustomEvent("cart:refresh",   { detail: { item: addedItem || null } }));
      document.dispatchEvent(new CustomEvent("cart:updated",   { detail: { item: addedItem || null } }));
      document.dispatchEvent(new CustomEvent("ajaxCart:added", { detail: { item: addedItem || null } }));
    } catch (_) {}
  }

  /* ── Kiwi sizing chart ───────────────────────────────────────────────── */
  function renderKiwiChart(product) {
    try {
      var kiwiHost = document.querySelector("#KiwiSizingChart");
      if (!kiwiHost) return;

      window.ks = window.ks || {};
      window.ks.productData = {
        product:     product.id,
        title:       product.title,
        vendor:      product.vendor,
        type:        product.type,
        images:      product.images || [],
        tags:        product.tags || [],
        collections: (product.collections || []).map(function (c) { return c.id; }).join(","),
        options:     product.options_with_values || [],
        variants:    (product.variants || []).map(function (v) {
          return { id: v.id, title: v.title, available: v.available };
        })
      };

      setTimeout(function () {
        try { if (window.ks && window.ks.loadSizing) window.ks.loadSizing(); }
        catch (e) { console.debug("Kiwi loadSizing failed", e); }
      }, 50);
    } catch (_) {}
  }

  /* ── Render product UI ───────────────────────────────────────────────── */
  function renderUI(p, body) {
    state.product = p;

    var v0  = pickDefaultVariant(p);
    var idx = optionIndexForSize(p);

    state.optionIndex = idx;
    state.selections  = [];
    if (Array.isArray(p.options) && p.options.length && v0) {
      for (var i = 0; i < p.options.length; i++) {
        state.selections[i] = v0["option" + (i + 1)];
      }
    }
    state.variant = v0;

    var img        = p.images && p.images[0] ? p.images[0] : "";
    var sizes      = buildSizeValues(p, idx);
    var productUrl = p.url || (state.handle ? "/products/" + encodeURIComponent(state.handle) : "#");

    /* Build HTML as a single string (one innerHTML set = one DOM parse) */
    var thumbHtml = img
      ? '<a class="pc02-qa-thumb-link" href="' + escapeHtml(productUrl) + '" aria-label="' + escapeHtml(p.title) + '">' +
          '<img class="pc02-qa-thumb" src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.title) + '" loading="lazy" decoding="async">' +
        '</a>'
      : '<a class="pc02-qa-thumb-link" href="' + escapeHtml(productUrl) + '"><div class="pc02-qa-thumb"></div></a>';

    var priceHtml = renderVariantPrice(v0);

    body.innerHTML =
      '<div class="pc02-qa-top">' +
        thumbHtml +
        '<div class="pc02-qa-meta">' +
          '<a class="pc02-qa-title-link" href="' + escapeHtml(productUrl) + '">' +
            '<div class="pc02-qa-title">' + escapeHtml(p.title) + '</div>' +
          '</a>' +
          priceHtml +
        '</div>' +
      '</div>' +

      '<div class="pc02-qa-row">' +
        '<div class="pc02-qa-label">SIZE:</div>' +
        '<div class="pc02-qa-kiwi"><div id="KiwiSizingChart"></div></div>' +
      '</div>' +

      '<div class="pc02-qa-sizes" data-pc02-sizes></div>' +
      '<div class="pc02-qa-divider"></div>' +
      '<div class="pc02-qa-cta" data-pc02-cta></div>';

    renderKiwiChart(p);

    var sizesWrap = body.querySelector("[data-pc02-sizes]");
    var ctaWrap   = body.querySelector("[data-pc02-cta]");
    var priceWrap = body.querySelector("[data-pc02-qa-price]");

    /* Build size pills via DocumentFragment — one reflow */
    var frag = document.createDocumentFragment();
    sizes.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pc02-qa-size" +
        (v0 && v0["option" + (idx + 1)] === s.value ? " is-active" : "") +
        (s.available ? "" : " is-oos");
      b.textContent = s.value;
      b.setAttribute("data-pc02-size", s.value);
      frag.appendChild(b);
    });
    sizesWrap.appendChild(frag);

    function updateCTA(variant) {
      ctaWrap.innerHTML = variant && variant.available
        ? '<button type="button" class="pc02-qa-atc" data-pc02-atc>ADD TO CART</button>'
        : '<button type="button" class="pc02-qa-soldout" disabled>SOLD OUT</button>';
    }

    updateCTA(v0);

    /* Single delegated listener on the body — handles pill + ATC clicks */
    body.addEventListener("click", function (e) {
      var pill = e.target.closest(".pc02-qa-size");
      if (pill) {
        sizesWrap.querySelectorAll(".pc02-qa-size").forEach(function (x) {
          x.classList.remove("is-active");
        });
        pill.classList.add("is-active");

        var val = pill.getAttribute("data-pc02-size");
        var selections = state.selections.slice();
        selections[idx] = val;

        var match = findVariant(p, selections);
        state.selections = selections;
        state.variant    = match;

        if (priceWrap && match) {
          priceWrap.outerHTML = renderVariantPrice(match);
          priceWrap = body.querySelector("[data-pc02-qa-price]");
          document.dispatchEvent(new CustomEvent("lag:money_updated", { detail: { source: "pc02-quick-add" } }));
        }

        updateCTA(match);
        return;
      }

      var atc = e.target.closest("[data-pc02-atc]");
      if (!atc) return;
      if (!state.variant || !state.variant.id) return;

      atc.disabled = true;
      atc.textContent = "ADDING\u2026";

      /* ATC fetch — no async/await so we don't need a transpiler */
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ items: [{ id: Number(state.variant.id), quantity: 1 }] })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("ATC failed");
          return res.json().catch(function () { return null; });
        })
        .then(function (addedItem) {
          /* Enrich with cart.js only if image is missing — avoid the extra
             request in the common case */
          var hasImg = addedItem && (
            addedItem.image ||
            (addedItem.featured_image &&
              (addedItem.featured_image.url || addedItem.featured_image.src ||
               typeof addedItem.featured_image === "string"))
          );

          if (addedItem && !hasImg && addedItem.key) {
            return fetch("/cart.js", { credentials: "same-origin" })
              .then(function (r) { return r.json(); })
              .then(function (cart) {
                var matchItem = (cart.items || []).filter(function (it) {
                  return it && it.key === addedItem.key;
                })[0];
                if (matchItem) {
                  if (!addedItem.image && matchItem.image) addedItem.image = matchItem.image;
                  if (!addedItem.url   && matchItem.url)   addedItem.url   = matchItem.url;
                  if (!addedItem.product_title && matchItem.product_title)
                    addedItem.product_title = matchItem.product_title;
                }
                return addedItem;
              })
              .catch(function () { return addedItem; });
          }
          return addedItem;
        })
        .then(function (addedItem) {
          atc.textContent = "ADDED";
          showHaloAtcPopup(addedItem);
          setTimeout(close, 250);
        })
        .catch(function () {
          atc.disabled = false;
          atc.textContent = "ADD TO CART";
        });
    });
  }

  /* ── Quick-add open (capture — stops card link navigation) ──────────── */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-pc02-quickadd]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    var handle = btn.getAttribute("data-product-handle");
    if (!handle) return;

    state.handle = handle;
    state.kiwi = {
      collections: btn.getAttribute("data-kiwi-collections") || "",
      tags:        btn.getAttribute("data-kiwi-tags")        || "",
      product:     btn.getAttribute("data-kiwi-product")     || "",
      vendor:      btn.getAttribute("data-kiwi-vendor")      || "",
      type:        btn.getAttribute("data-kiwi-type")        || "",
      title:       btn.getAttribute("data-kiwi-product-name")|| "",
      images:      btn.getAttribute("data-kiwi-images")      || "[]"
    };

    btn.classList.add("is-loading");

    var shell = openShell();
    LAST_OPEN_TS = Date.now();
    renderSkeleton(shell.body);

    /* If product is already cached, render instantly; otherwise fetch */
    fetchProduct(handle)
      .then(function (p) { renderUI(p, shell.body); })
      .catch(function () {
        if (shell.body) shell.body.innerHTML = "Failed to load. Please try again.";
      })
      .then(function () {
        setTimeout(function () { btn.classList.remove("is-loading"); }, 250);
      });
  }, true);

  /* ── Close on outside click ─────────────────────────────────────────── */
  document.addEventListener("click", function (e) {
    if (!document.documentElement.classList.contains("pc02-qa-open")) return;
    if (e.target.closest && e.target.closest("[data-pc02-quickadd]")) return;

    var shell = ensureShell();
    if (!shell.panel || shell.panel.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    close();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  /* ── Close on browser back (popstate) ──────────────────────────────────── */
  /*
    When the user taps a product title/image inside the drawer they navigate
    to the product page, then hits the browser back button.  The page returns
    via the bfcache (back/forward cache) and fires "pageshow" with
    persisted=true, or fires "popstate" for SPA-style navigation.
    Either way we close the drawer so it doesn't sit open over the collection.
  */
  window.addEventListener("popstate", function () {
    close();
  });

  /* pageshow covers bfcache restores (iOS Safari, Chrome) */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) close();
  });

  /* ── Drag-down-to-close (drawer only) ───────────────────────────────── */
  (function () {
    var startY = 0, startX = 0, currentY = 0;
    var dragging = false, down = false, allow = false;

    function getPanel() { return document.getElementById(PANEL_ID); }
    function getBody()  { return document.getElementById(BODY_ID);  }

    function onDown(e) {
      var panel = getPanel();
      if (!panel || !panel.classList.contains("is-drawer")) return;
      if (!document.documentElement.classList.contains("pc02-qa-open")) return;
      if (!panel.contains(e.target)) return;

      down = true;
      dragging = false;
      allow    = false;

      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      currentY = 0;

      var body    = getBody();
      var rect    = panel.getBoundingClientRect();
      var nearTop = startY - rect.top < 90;
      var atTop   = body ? body.scrollTop <= 0 : true;
      allow = nearTop || atTop;
    }

    function onMove(e) {
      if (!down) return;
      var panel = getPanel();
      if (!panel) return;

      var y = e.touches ? e.touches[0].clientY : e.clientY;
      var x = e.touches ? e.touches[0].clientX : e.clientX;
      var dy = y - startY;
      var dx = x - startX;

      if (!dragging) {
        if (!allow || dy < 8 || Math.abs(dy) <= Math.abs(dx)) return;
        dragging = true;
        panel.style.transition = "none";
      }

      currentY = Math.max(0, dy);
      /* translate3d keeps compositing on the GPU */
      panel.style.transform = "translate3d(0," + currentY + "px,0)";
      if (e.cancelable) e.preventDefault();
    }

    function onUp() {
      if (!down) return;
      down = false;

      var panel = getPanel();
      if (!panel || !dragging) return;

      dragging = false;

      if (currentY > 80) {
        /* Let close() handle the transition — don't reset transform here,
           close() adds is-closing which uses translate3d(0,100%,0). */
        panel.style.transition = "";
        panel.style.transform  = "";
        close();
      } else {
        /* Snap back: re-enable transition, let CSS spring it home */
        panel.style.transition = "";
        panel.style.transform  = "";
      }
    }

    document.addEventListener("touchstart",  onDown, { capture: true, passive: true });
    document.addEventListener("touchmove",   onMove, { capture: true, passive: false });
    document.addEventListener("touchend",    onUp,   true);
    document.addEventListener("touchcancel", onUp,   true);

    document.addEventListener("mousedown",  onDown, true);
    document.addEventListener("mousemove",  onMove, true);
    document.addEventListener("mouseup",    onUp,   true);
  })();

})();
