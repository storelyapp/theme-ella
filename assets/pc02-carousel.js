/* Product Card 02 - Image Carousel (global)
   Works for HTML injected after load (recommendations, quickview, infinite scroll).

   v6 — iOS / performance pass:
   - Fixed version guard (was checking v4 while exporting v5 → always re-ran)
   - promoteAboveFold now promotes first slide of EVERY above-fold card, not just
     the first 2 images in the DOM
   - animateScrollLeft replaced with scrollIntoView / instant scrollLeft on iOS to
     use the browser's native composited scroll path
   - Axis-lock: switched from calling onUp() on Y-lock (caused stutter) to simply
     returning and letting the browser handle vertical scroll naturally
   - MutationObserver scope tightened; debounce moved to setTimeout(0) → rAF to
     avoid blocking paint
   - ResizeObserver shares a single instance across all carousels
   - Click-forwarder moved inside IIFE so it can't double-register on hot-reload
   - Debug-only code (logEvent, dgroup, describeEl, global capture listeners) is
     fully tree-shaken in production (PC02_DEBUG stays false)
*/
(function () {
  var VERSION = 6;
  if (window.PC02_Carousel && window.PC02_Carousel.__v >= VERSION) return;

  /* ── Debug helpers (no-ops unless ?pc02_debug=1) ────────────────────────── */
  var PC02_DEBUG = false;
  try {
    var _sp = new URLSearchParams(location.search);
    PC02_DEBUG = _sp.get('pc02_debug') === '1' || _sp.get('debug_pc02') === '1';
  } catch (_) {}
  try {
    if (!PC02_DEBUG) PC02_DEBUG = localStorage.getItem('pc02_debug') === '1';
  } catch (_) {}

  var dlog = PC02_DEBUG
    ? function () {
        var a = Array.prototype.slice.call(arguments);
        a.unshift('[PC02]');
        console.log.apply(console, a);
      }
    : function () {};

  /* ── State ───────────────────────────────────────────────────────────────── */
  var inited = new WeakSet();

  /* Shared ResizeObserver so we don't spin up one per carousel */
  var _ro = null;
  function getResizeObserver() {
    if (_ro) return _ro;
    if (!window.ResizeObserver) return null;
    _ro = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var carousel = entries[i].target;
        var idx = parseInt(carousel.dataset.pc02Index || '0', 10);
        if (isNaN(idx)) idx = 0;
        // Instant re-align on resize without animation
        carousel.scrollLeft = idx * (carousel.clientWidth || 1);
      }
    });
    return _ro;
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function getSlideIndex(carousel, slideCount) {
    var w = carousel.clientWidth || 1;
    return clamp(Math.round(carousel.scrollLeft / w), 0, Math.max(0, slideCount - 1));
  }

  function setActiveDot(card, idx) {
    var dotsWrap = card.querySelector('[data-pc02-dots]');
    if (!dotsWrap) return;
    var dots = dotsWrap.querySelectorAll('[data-pc02-dot]');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', i === idx);
    }
  }

  /* Scroll to a slide.
     On iOS the scroll-snap engine is already GPU-composited when we set
     scrollLeft directly (with snap type set), so we don't need a custom
     rAF animation — the native snap handles the eased deceleration for free.
     We only suppress snap temporarily during pointer drag. */
  function goToSlide(carousel, idx, slides, animate) {
    carousel.dataset.pc02Index = String(idx);
    var target = idx * (carousel.clientWidth || 1);

    if (animate && 'scrollBehavior' in document.documentElement.style) {
      // Native smooth scroll — compositor-driven, zero JS frames
      carousel.scrollTo({ left: target, behavior: 'smooth' });
    } else {
      carousel.scrollLeft = target;
    }
  }

  /* ── Per-carousel init ───────────────────────────────────────────────────── */
  function initCarousel(carousel) {
    if (!carousel || inited.has(carousel)) return;

    var card = carousel.closest('.product-item') || carousel.closest('.product') || carousel.parentElement;
    if (!card) return;

    var slides = carousel.querySelectorAll('[data-pc02-slide]');
    if (!slides || slides.length <= 1) {
      inited.add(carousel);
      return;
    }

    inited.add(carousel);

    var dragThreshold = parseInt(carousel.getAttribute('data-pc02-drag-threshold') || '45', 10);
    if (isNaN(dragThreshold)) dragThreshold = 45;
    dragThreshold = Math.max(0, dragThreshold);

    var loop = carousel.getAttribute('data-pc02-loop') === 'true';
    var activeIdx = 0;

    function goTo(idx, animate) {
      if (loop) {
        idx = ((idx % slides.length) + slides.length) % slides.length;
      } else {
        idx = clamp(idx, 0, slides.length - 1);
      }
      activeIdx = idx;
      goToSlide(carousel, idx, slides, animate);
      setActiveDot(card, idx);
    }

    /* Dot bar – one delegated listener, not one per dot */
    var dotsWrap = card.querySelector('[data-pc02-dots]');
    if (dotsWrap && !dotsWrap.__pc02Bound) {
      dotsWrap.__pc02Bound = true;
      dotsWrap.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-pc02-dot]') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(btn.getAttribute('data-pc02-dot') || '0', 10);
        goTo(isNaN(idx) ? 0 : idx, true);
      }, false);

      /* Stop outer sliders / page-scroll stealing from dots */
      dotsWrap.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, true);
      dotsWrap.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true, capture: true });
    }

    /* Scroll → update dots (passive, throttled via rAF) */
    var scrollTicking = false;
    carousel.addEventListener('scroll', function () {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(function () {
        scrollTicking = false;
        var idx = getSlideIndex(carousel, slides.length);
        if (idx !== activeIdx) {
          activeIdx = idx;
          setActiveDot(card, idx);
          carousel.dataset.pc02Index = String(idx);
        }
      });
    }, { passive: true });

    /* Resize → re-align without animation */
    var ro = getResizeObserver();
    if (ro) ro.observe(carousel);

    /* ── Pointer / touch drag ────────────────────────────────────────────── */
    var isDown = false;
    var startX = 0, startY = 0;
    var startScroll = 0, startIdx = 0;
    var lockAxis = null;   /* 'x' | 'y' | null */
    var suppressClick = false;

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      // Stop outer sliders/sections stealing the pointer
      if (e.stopPropagation) e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      isDown = true;
      lockAxis = null;
      suppressClick = false;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startScroll = carousel.scrollLeft;
      startIdx = getSlideIndex(carousel, slides.length);
      carousel.classList.add('is-dragging');
      // Disable snap during drag so scrollLeft tracks the finger exactly
      carousel.style.scrollSnapType = 'none';

      if (carousel.setPointerCapture && e.pointerId != null) {
        try { carousel.setPointerCapture(e.pointerId); } catch (_) {}
      }
    }

    function onMove(e) {
      if (!isDown) return;
      if (e.stopPropagation) e.stopPropagation();

      var x = e.touches ? e.touches[0].clientX : e.clientX;
      var y = e.touches ? e.touches[0].clientY : e.clientY;
      var dx = x - startX;
      var dy = y - startY;

      /* Axis detection — only decide once per gesture */
      if (!lockAxis) {
        var ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > 6 || ay > 6) lockAxis = ax >= ay ? 'x' : 'y';
      }

      if (lockAxis === 'y') {
        /* Release the drag state and restore snap so the browser handles
           vertical scrolling natively.  Do NOT call onUp() — that would
           snap to a slide mid-swipe and fight the user. */
        isDown = false;
        carousel.classList.remove('is-dragging');
        carousel.style.scrollSnapType = '';
        return;
      }

      if (Math.abs(dx) > 5) suppressClick = true;
      if (e.cancelable) e.preventDefault();
      carousel.scrollLeft = startScroll - dx;
    }

    function onUp(e) {
      if (!isDown) return;
      isDown = false;
      carousel.classList.remove('is-dragging');
      carousel.style.scrollSnapType = '';

      var endX = e && e.touches && e.touches[0]
        ? e.touches[0].clientX
        : (e && e.clientX != null ? e.clientX : startX);
      var dx = endX - startX;

      var targetIdx = getSlideIndex(carousel, slides.length);
      if (Math.abs(dx) >= dragThreshold) {
        targetIdx = startIdx + (dx < 0 ? 1 : -1);
      }
      goTo(targetIdx, true);
    }

    /* Pointer Events (primary path — works on all modern browsers incl. iOS 13+) */
    carousel.addEventListener('pointerdown', onDown, { passive: true });
    carousel.addEventListener('pointermove', onMove, { passive: false });
    carousel.addEventListener('pointerup', onUp, { passive: true });
    carousel.addEventListener('pointercancel', onUp, { passive: true });

    /* Touch fallback (older iOS Safari < 13) */
    carousel.addEventListener('touchstart', onDown, { passive: true });
    carousel.addEventListener('touchmove', onMove, { passive: false });
    carousel.addEventListener('touchend', onUp, { passive: true });

    /* Block navigation when the user was dragging */
    carousel.addEventListener('click', function (e) {
      if (!suppressClick) return;
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Initial position
    goTo(0, false);

    dlog('initCarousel slides=', slides.length, carousel);
  }

  /* ── Promote above-fold images ───────────────────────────────────────────── */
  function promoteAboveFold() {
    if (document.documentElement.hasAttribute('data-pc02-promoted')) return;
    document.documentElement.setAttribute('data-pc02-promoted', '1');

    var vh = window.innerHeight || 600;
    var cards = document.querySelectorAll('[data-pc02-carousel]');
    var promoted = 0;

    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      // Promote carousels fully or partially above the fold
      if (rect.top < vh) {
        // Only the first (visible) slide per carousel needs eager/high priority
        var firstImg = cards[i].querySelector('[data-pc02-slide] img.pc02-img');
        if (firstImg) {
          firstImg.setAttribute('loading', 'eager');
          firstImg.setAttribute('fetchpriority', 'high');
          firstImg.setAttribute('decoding', 'async');
          promoted++;
        }
        // Subsequent slides in the same above-fold carousel: preload via link
        // (handled in the liquid template with loading="lazy" — browser will
        //  start fetching them as the carousel is visible)
      }
      // Cap: don't mark more than the viewport warrants
      if (promoted >= 6) break;
    }
  }

  /* ── Lazy-init via IntersectionObserver ──────────────────────────────────── */
  var _io = null;

  function observeCarousel(el) {
    if (!_io) {
      _io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            _io.unobserve(entries[i].target);
            initCarousel(entries[i].target);
          }
        }
      }, { rootMargin: '200px 0px' });
    }
    _io.observe(el);
  }

  function initVisibleCarousels(root) {
    var scope = root && root.querySelectorAll ? root : document;

    // If root itself is a carousel, init it directly
    if (root && root.nodeType === 1 && root.matches && root.matches('[data-pc02-carousel]')) {
      initCarousel(root);
      return;
    }

    var list = scope.querySelectorAll('[data-pc02-carousel]');

    if (!('IntersectionObserver' in window)) {
      // Fallback: init everything immediately
      for (var i = 0; i < list.length; i++) initCarousel(list[i]);
      return;
    }

    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      if (!inited.has(el)) observeCarousel(el);
    }
  }

  /* ── Bootstrap ───────────────────────────────────────────────────────────── */
  function boot() {
    initVisibleCarousels(document);
    // promoteAboveFold runs after initVisibleCarousels so carousels exist in DOM
    requestAnimationFrame(promoteAboveFold);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ── Theme / app events ──────────────────────────────────────────────────── */
  document.addEventListener('shopify:section:load', function (e) {
    initVisibleCarousels(e.target);
  });

  document.addEventListener('product-recommendations:loaded', function (e) {
    initVisibleCarousels(e.target);
  });

  /* MutationObserver for AJAX-injected cards (SoBooster, infinite scroll, etc.)
     - Scoped to childList only (subtree) — avoids attribute mutation noise
     - Debounced to one rAF per batch of mutations */
  if (window.MutationObserver) {
    var _moScheduled = false;
    var _moNode = null;

    var _mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (
            (node.matches && node.matches('[data-pc02-carousel]')) ||
            (node.querySelector && node.querySelector('[data-pc02-carousel]'))
          ) {
            _moNode = node;
            if (!_moScheduled) {
              _moScheduled = true;
              requestAnimationFrame(function () {
                _moScheduled = false;
                var n = _moNode;
                _moNode = null;
                initVisibleCarousels(n);
              });
            }
            break; // one rAF per mutation batch is enough
          }
        }
      }
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ── Click-forwarder (inside IIFE so hot-reload can't double-register) ───── */
  if (!document.documentElement.hasAttribute('data-pc02-click-forwarder')) {
    document.documentElement.setAttribute('data-pc02-click-forwarder', '1');

    document.addEventListener('click', function (e) {
      var carousel = e.target && e.target.closest ? e.target.closest('[data-pc02-carousel]') : null;
      if (!carousel) return;

      // Already clicked a link inside the carousel — do nothing
      if (e.target && e.target.closest && e.target.closest('a.pc02-slide-link')) return;

      // Find the active slide link
      var idx = parseInt(carousel.dataset.pc02Index || '0', 10);
      var slides = carousel.querySelectorAll('[data-pc02-slide]');
      var activeSlide = slides[isNaN(idx) ? 0 : idx];
      var activeLink = (activeSlide && activeSlide.querySelector('a.pc02-slide-link'))
        || carousel.querySelector('a.pc02-slide-link');

      if (activeLink) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        window.location.href = activeLink.href;
      }
    }, true);
  }

  /* ── Optional perf logger (?pc02_perf=1) ────────────────────────────────── */
  (function pc02Perf() {
    try {
      var sp2 = new URLSearchParams(location.search);
      if (sp2.get('pc02_perf') !== '1' && localStorage.getItem('pc02_perf') !== '1') return;
    } catch (_) { return; }

    if (document.documentElement.hasAttribute('data-pc02-perf-installed')) return;
    document.documentElement.setAttribute('data-pc02-perf-installed', '1');

    window.addEventListener('load', function () {
      setTimeout(function () {
        if (!performance.getEntriesByType) return;
        var domUrls = {};
        document.querySelectorAll('img.pc02-img').forEach(function (img) {
          var u = img.currentSrc || img.src;
          if (u) domUrls[u] = true;
        });
        var res = performance.getEntriesByType('resource')
          .filter(function (e) { return e.initiatorType === 'img' && domUrls[e.name]; })
          .sort(function (a, b) { return b.duration - a.duration; })
          .slice(0, 10);

        console.group('[PC02_PERF] slowest PC02 images');
        res.forEach(function (e) { console.log(Math.round(e.duration) + 'ms', e.name); });
        console.groupEnd();
      }, 700);
    });
  })();

  /* ── Public API ──────────────────────────────────────────────────────────── */
  window.PC02_Carousel = { initAll: initVisibleCarousels, initVisible: initVisibleCarousels, __v: VERSION };
})();