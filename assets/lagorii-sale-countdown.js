(function () {
  "use strict";

  var ROOT_SELECTOR = "[data-sale-root], [data-lagorii-sale-root], [data-lagorii-sale-announcement], [data-lagorii-sale-fomo]";
  var COUNTDOWN_SELECTOR = "[data-sale-countdown], [data-lagorii-sale-countdown]";
  var ROTATE_TARGET_SELECTOR = "[data-sale-rotate-target]";
  var URGENCY_LABEL_SELECTOR = "[data-lagorii-sale-urgency-label]";
  var READY_FLAG = "lagoriiSaleCountdownReady";
  var SIX_HOURS = 6 * 60 * 60 * 1000;
  var REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  var stickyFrameRequested = false;

  if (document.documentElement.dataset[READY_FLAG] === "true") return;
  document.documentElement.dataset[READY_FLAG] = "true";

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseEnd(value) {
    if (!value) return null;

    var time = new Date(value).getTime();

    return Number.isNaN(time) ? null : time;
  }

  function getCountdownFormat(el) {
    var format = el.getAttribute("data-sale-countdown-format") || el.getAttribute("data-countdown-format") || "hh_mm_ss";

    return format === "dd_hh_mm_ss" ? "dd_hh_mm_ss" : "hh_mm_ss";
  }

  function splitRemaining(ms, format) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var totalHours = Math.floor(totalSeconds / 3600);
    var days = Math.floor(totalSeconds / 86400);
    var hours = format === "dd_hh_mm_ss" ? Math.floor((totalSeconds % 86400) / 3600) : totalHours;

    return {
      days: format === "dd_hh_mm_ss" ? days : null,
      hours: hours,
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60
    };
  }

  function formatRemaining(parts, format) {
    if (format === "dd_hh_mm_ss") {
      return pad(parts.days) + ":" + pad(parts.hours) + ":" + pad(parts.minutes) + ":" + pad(parts.seconds);
    }

    return pad(parts.hours) + ":" + pad(parts.minutes) + ":" + pad(parts.seconds);
  }

  function getCountdownClassBase(el) {
    return el.getAttribute("data-countdown-class") || "lagorii-sale-countdown";
  }

  function renderUnit(baseClass, value, label) {
    return (
      '<span class="' + baseClass + '__countdown-unit">' +
        '<span class="' + baseClass + '__countdown-value">' + pad(value) + "</span>" +
        '<span class="' + baseClass + '__countdown-label">' + label + "</span>" +
      "</span>"
    );
  }

  function renderBoxedUnits(el, parts, format) {
    var baseClass = getCountdownClassBase(el);
    var daysMarkup = "";

    if (format === "dd_hh_mm_ss") {
      daysMarkup = renderUnit(baseClass, parts.days, "DAYS") + '<span class="' + baseClass + '__countdown-sep" aria-hidden="true">:</span>';
    }

    return (
      '<span class="' + baseClass + '__countdown-units">' +
        daysMarkup +
        renderUnit(baseClass, parts.hours, "HRS") +
        '<span class="' + baseClass + '__countdown-sep" aria-hidden="true">:</span>' +
        renderUnit(baseClass, parts.minutes, "MIN") +
        '<span class="' + baseClass + '__countdown-sep" aria-hidden="true">:</span>' +
        renderUnit(baseClass, parts.seconds, "SEC") +
      "</span>"
    );
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  function findRoot(el) {
    return el && el.closest ? el.closest(ROOT_SELECTOR) : null;
  }

  function getScope(root) {
    return root && root.querySelectorAll ? root : document;
  }

  function getRoots(root) {
    var scope = getScope(root);
    var items = [];

    if (scope.matches && scope.matches(ROOT_SELECTOR)) {
      items.push(scope);
    }

    return items.concat(Array.prototype.slice.call(scope.querySelectorAll(ROOT_SELECTOR)));
  }

  function getCountdowns(root) {
    var scope = getScope(root);
    var items = [];

    if (scope.matches && scope.matches(COUNTDOWN_SELECTOR)) {
      items.push(scope);
    }

    return items.concat(Array.prototype.slice.call(scope.querySelectorAll(COUNTDOWN_SELECTOR)));
  }

  function uniqueFrames(frames) {
    var seen = {};

    return frames
      .map(function (frame) {
        return typeof frame === "string" ? frame.trim() : "";
      })
      .filter(function (frame) {
        var key = frame.toLowerCase();

        if (!frame || seen[key]) return false;

        seen[key] = true;
        return true;
      });
  }

  function parseFrames(root) {
    var value;
    var parsed;

    if (!root) return [];

    value = root.getAttribute("data-sale-frames") || "[]";

    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = [];
    }

    return Array.isArray(parsed) ? uniqueFrames(parsed) : [];
  }

  function getRotateTarget(root) {
    return root && root.querySelector ? root.querySelector(ROTATE_TARGET_SELECTOR) : null;
  }

  function setRotateText(root, text, animate) {
    var target = getRotateTarget(root);

    if (!target || !text) return;

    if (!animate || prefersReducedMotion()) {
      target.textContent = text;
      return;
    }

    root.classList.add("is-rotating");

    window.setTimeout(function () {
      target.textContent = text;
      root.classList.remove("is-rotating");
    }, 170);
  }

  function updateUrgencyLabel(root, urgent) {
    var label;
    var normalText;
    var urgentText;

    if (!root) return;

    label = root.querySelector(URGENCY_LABEL_SELECTOR);
    if (!label) return;

    normalText = label.getAttribute("data-normal-text") || "";
    urgentText = label.getAttribute("data-urgency-text") || "Sale ends soon";

    label.hidden = !urgent && normalText === "";
    label.textContent = urgent ? urgentText : normalText;
  }

  function hideRoot(root, fallbackEl) {
    var target = root || fallbackEl;

    if (!target) return;

    target.hidden = true;
    target.setAttribute("aria-hidden", "true");
  }

  function restoreFrame(root) {
    var frames = parseFrames(root);
    var index;

    if (!frames.length) return;

    index = parseInt(root.dataset.saleFrameIndex || "0", 10);

    if (Number.isNaN(index) || index >= frames.length) {
      index = 0;
    }

    setRotateText(root, frames[index], false);
  }

  function setUrgencyState(root, urgent) {
    var wasUrgent;
    var urgentFrame;

    if (!root) return;

    wasUrgent = root.classList.contains("is-urgent");

    root.classList.toggle("is-urgent", urgent);
    root.setAttribute("data-countdown-urgency", urgent ? "urgent" : "normal");
    updateUrgencyLabel(root, urgent);

    if (urgent) {
      urgentFrame = root.getAttribute("data-sale-urgent-frame") || "";
      setRotateText(root, urgentFrame, !wasUrgent);
    } else if (wasUrgent) {
      restoreFrame(root);
    }
  }

  function getCountdownStyle(el) {
    return el.getAttribute("data-sale-countdown-style") || el.getAttribute("data-countdown-style") || "compact_text";
  }

  function getCountdownEnd(el) {
    return el.getAttribute("data-sale-countdown-end") || el.getAttribute("data-end");
  }

  function getExpiredBehavior(el) {
    var explicit = el.getAttribute("data-sale-expired-behavior");

    if (explicit) return explicit;

    return el.getAttribute("data-hide-expired") === "true" ? "hide_root" : "none";
  }

  function setCountdownFallback(el) {
    var text = el.getAttribute("data-fallback") || "Ends soon";
    var root = findRoot(el);

    el.hidden = false;
    el.textContent = text;
    el.setAttribute("data-countdown-state", "fallback");
    el.removeAttribute("aria-label");
    setUrgencyState(root, false);
  }

  function setCountdownActive(el, remaining) {
    var format = getCountdownFormat(el);
    var parts = splitRemaining(remaining, format);
    var style = getCountdownStyle(el);
    var prefix = el.getAttribute("data-prefix") || "Ends in";
    var formatted = formatRemaining(parts, format);
    var text = prefix + " " + formatted;

    el.hidden = false;
    el.setAttribute("data-countdown-state", "active");
    el.setAttribute("aria-label", text);

    if (style === "boxed_units") {
      el.innerHTML = renderBoxedUnits(el, parts, format);
    } else {
      el.textContent = text;
    }
  }

  function updateCountdown(el) {
    var root = findRoot(el);
    var end = parseEnd(getCountdownEnd(el));
    var expiredBehavior = getExpiredBehavior(el);
    var remaining;

    if (!end) {
      setCountdownFallback(el);
      return;
    }

    remaining = end - Date.now();

    if (remaining <= 0) {
      if (expiredBehavior === "hide_root") {
        hideRoot(root, el);
      } else if (expiredBehavior === "hide_countdown") {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
      } else {
        setCountdownFallback(el);
      }
      return;
    }

    setUrgencyState(root, remaining <= SIX_HOURS);
    setCountdownActive(el, remaining);
  }

  function rotateMessages(root) {
    var frames;
    var intervalSeconds;
    var interval;
    var index;
    var intervalId;

    if (!root || root.dataset.saleRotationReady === "true") return;
    if (!getRotateTarget(root)) return;

    frames = parseFrames(root);

    if (!frames.length) return;

    root.dataset.saleRotationReady = "true";
    root.dataset.saleFrameIndex = "0";
    setRotateText(root, frames[0], false);

    if (root.getAttribute("data-rotation-enabled") !== "true") return;
    if (frames.length < 2 || prefersReducedMotion()) return;

    intervalSeconds = parseInt(root.getAttribute("data-rotation-interval"), 10);
    interval = Math.max(2, Number.isNaN(intervalSeconds) ? 3 : intervalSeconds) * 1000;
    index = 0;

    intervalId = window.setInterval(function () {
      if (!document.documentElement.contains(root)) {
        window.clearInterval(intervalId);
        return;
      }

      if (root.hidden || root.classList.contains("is-urgent")) return;

      index = (index + 1) % frames.length;
      root.dataset.saleFrameIndex = String(index);
      setRotateText(root, frames[index], true);
    }, interval);
  }

  function isMobileViewport() {
    return window.matchMedia && window.matchMedia("(max-width: 749px)").matches;
  }

  function isStickyEnabled(root) {
    var mode = root && root.getAttribute("data-sticky-mode");
    var mobile = isMobileViewport();

    return mode === "both" || (mobile && mode === "mobile") || (!mobile && mode === "desktop");
  }

  function isVisibleHeader(el) {
    var rect;

    if (!el || el.classList.contains("shopify-section-header-hidden")) return false;

    rect = el.getBoundingClientRect();

    return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function getStickyOffset(root) {
    var selector = isMobileViewport()
      ? ".section-header-mobile.shopify-section-header-sticky, .section-header-mobile.shopify-section-header-show"
      : ".section-header-navigation.shopify-section-header-sticky, .section-header-navigation.shopify-section-header-show";
    var headers = Array.prototype.slice.call(document.querySelectorAll(selector));
    var offset = 0;

    if (!isStickyEnabled(root)) return 0;

    headers.forEach(function (header) {
      var rect;

      if (!isVisibleHeader(header)) return;

      rect = header.getBoundingClientRect();
      offset = Math.max(offset, rect.bottom);
    });

    return Math.max(0, Math.round(offset));
  }

  function updateStickyOffset(root) {
    if (!root || !root.hasAttribute("data-sticky-mode")) return;

    root.style.setProperty("--lsa-sticky-offset", getStickyOffset(root) + "px");
  }

  function updateStickyOffsets(scope) {
    getRoots(scope).forEach(updateStickyOffset);
  }

  function requestStickyOffsetUpdate() {
    if (stickyFrameRequested) return;

    stickyFrameRequested = true;

    window.requestAnimationFrame(function () {
      stickyFrameRequested = false;
      updateStickyOffsets(document);
    });
  }

  function updateAll(root) {
    getCountdowns(root).forEach(updateCountdown);
  }

  function init(root) {
    getRoots(root).forEach(rotateMessages);
    updateAll(root);
    updateStickyOffsets(root);
  }

  function observeAddedNodes() {
    try {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;

            init(node);
          });
        });
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (error) {}
  }

  function boot() {
    init(document);

    window.setInterval(function () {
      updateAll(document);
    }, 1000);

    document.addEventListener("shopify:section:load", function (event) {
      init(event.target || document);
    });

    document.addEventListener("shopify:section:reorder", function () {
      init(document);
    });

    document.addEventListener("shopify:section:select", function () {
      init(document);
    });

    window.addEventListener("resize", requestStickyOffsetUpdate);
    window.addEventListener("scroll", requestStickyOffsetUpdate, { passive: true });
    observeAddedNodes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
