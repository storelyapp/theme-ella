/*
  Product Card 02 — Limited Time Offer Badge
  Global initializer for collection grids, Shopify section reloads, filters, and infinite scroll.

  Required markup:
  - data-pc02-offer-badge
  - data-pc02-offer-frame
  - data-pc02-offer-countdown
*/

(function () {
  var READY_FLAG = 'pc02OfferBadgeReady';

  if (document.documentElement.dataset[READY_FLAG] === 'true') return;
  document.documentElement.dataset[READY_FLAG] = 'true';

  var BADGE_SELECTOR = '[data-pc02-offer-badge]';
  var FRAME_SELECTOR = '[data-pc02-offer-frame]';
  var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

  function parseTime(value) {
    if (!value) return null;

    var time = new Date(value).getTime();

    return Number.isNaN(time) ? null : time;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  function updateBadgeState(badge) {
    if (!badge) return;

    var start = parseTime(badge.getAttribute('data-start'));
    var end = parseTime(badge.getAttribute('data-end'));
    var now = Date.now();

    badge.classList.remove('is-hidden', 'is-ended');

    /*
      Start date is only a campaign visibility gate.
      Before the campaign starts, the badge stays hidden.
      It does NOT show "Starts in..." because the desired sequence is:
      1. LIMITED TIME OFFER
      2. 25% OFF
      3. Ends in 09:18:42
    */
    if (start && now < start) {
      badge.classList.add('is-hidden');
      return;
    }

    if (end && now >= end) {
      badge.classList.add('is-ended');
      return;
    }
  }

  function getFrames(badge) {
    return Array.prototype.slice
      .call(badge.querySelectorAll(FRAME_SELECTOR))
      .filter(function (frame) {
        return frame.textContent.trim() !== '';
      });
  }

  function initBadge(badge) {
    if (!badge || badge.dataset.pc02OfferReady === 'true') return;

    var frames = getFrames(badge);

    if (!frames.length) return;

    badge.dataset.pc02OfferReady = 'true';
    badge.dataset.pc02OfferIndex = '0';

    frames.forEach(function (frame, index) {
      frame.classList.toggle('is-active', index === 0);
      frame.classList.remove('is-leaving');
    });

    updateBadgeState(badge);

    if (frames.length < 2 || prefersReducedMotion()) return;

    var rotateMs = parseInt(badge.getAttribute('data-rotate-ms') || '2000', 10);

    if (Number.isNaN(rotateMs)) {
      rotateMs = 2000;
    }

    rotateMs = Math.max(1200, rotateMs);

    var intervalId = window.setInterval(function () {
      if (!document.documentElement.contains(badge)) {
        window.clearInterval(intervalId);
        return;
      }

      updateBadgeState(badge);

      if (
        badge.classList.contains('is-hidden') ||
        badge.classList.contains('is-ended')
      ) {
        return;
      }

      var activeIndex = parseInt(badge.dataset.pc02OfferIndex || '0', 10);

      if (Number.isNaN(activeIndex)) {
        activeIndex = 0;
      }

      var current = frames[activeIndex];
      var nextIndex = (activeIndex + 1) % frames.length;
      var next = frames[nextIndex];

      if (!current || !next || current === next) return;

      current.classList.add('is-leaving');
      current.classList.remove('is-active');

      next.classList.remove('is-leaving');
      next.classList.add('is-active');

      badge.dataset.pc02OfferIndex = String(nextIndex);

      window.setTimeout(function () {
        current.classList.remove('is-leaving');
      }, 520);
    }, rotateMs);
  }

  function initAll(root) {
    var scope = root && root.querySelectorAll ? root : document;

    if (scope.matches && scope.matches(BADGE_SELECTOR)) {
      initBadge(scope);
    }

    scope.querySelectorAll(BADGE_SELECTOR).forEach(initBadge);
  }

  function updateAll() {
    document.querySelectorAll(BADGE_SELECTOR).forEach(updateBadgeState);
  }

  function boot() {
    initAll(document);
    updateAll();

    window.setInterval(updateAll, 1000);

    document.addEventListener('shopify:section:load', function (event) {
      initAll(event.target || document);
    });

    document.addEventListener('shopify:section:reorder', function () {
      initAll(document);
    });

    document.addEventListener('shopify:section:select', function () {
      initAll(document);
    });

    try {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;

            initAll(node);
          });
        });
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (error) {
      return;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
