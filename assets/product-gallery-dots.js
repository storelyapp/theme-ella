/* Lagorii – Product gallery v3
   - Per-section configurable custom dots (NOT slick dots)
   - Applies slick motion settings (speed/easing/swipe/draggable)
   - Minimizes conflicts with base.css slick-dots styles
*/
(function () {
  function safeParseJSON(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function toBool(v, fallback) {
    if (v === true || v === false) return v;
    if (v == null) return !!fallback;
    var s = String(v).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return !!fallback;
  }

  function getSectionRootFromScript(scriptEl) {
    return scriptEl.closest('.shopify-section') || scriptEl.parentElement || document;
  }

  function bestSliderCandidate(root) {
    if (!root || !window.jQuery) return null;
    var $ = window.jQuery;

    var candidates = Array.prototype.slice.call(
      root.querySelectorAll('.slick-initialized, .slick-slider')
    );
    if (!candidates.length) return null;

    function score(el) {
      var s = 0;

      // Prefer larger sliders
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      if (rect.width >= 600) s += 6;
      else if (rect.width >= 420) s += 4;
      else if (rect.width >= 320) s += 2;

      // Prefer something that contains media
      var mediaCount = 0;
      try { mediaCount = el.querySelectorAll('img, video, model-viewer, iframe').length; } catch (e) {}
      if (mediaCount >= 2) s += 4;
      if (mediaCount >= 6) s += 2;

      // Prefer slick instances with slidesToShow == 1 (main gallery)
      try {
        var $el = $(el);
        if ($el.hasClass('slick-initialized') && $el.data('slick')) {
          var slick = $el.slick('getSlick');
          var sts = Number(slick && slick.options && slick.options.slidesToShow);
          if (sts === 1) s += 12;
          if (sts > 1) s -= 8;
          // thumbs are often vertical/narrow
          if (sts >= 4) s -= 4;
        }
      } catch (e) {}

      // Heuristics: main media wrappers often use these words
      var cls = (el.className || '').toLowerCase();
      if (cls.indexOf('main') >= 0) s += 2;
      if (cls.indexOf('thumb') >= 0) s -= 6;
      if (cls.indexOf('nav') >= 0) s -= 4;

      return s;
    }

    var best = candidates[0];
    var bestScore = score(best);
    for (var i = 1; i < candidates.length; i++) {
      var sc = score(candidates[i]);
      if (sc > bestScore) {
        bestScore = sc;
        best = candidates[i];
      }
    }
    return best;
  }

  function applyWrapperVars(wrapperEl, cfg) {
    var size = Number(cfg.dots_size); if (!isFinite(size) || size <= 0) size = 8;
    var gap = Number(cfg.dots_gap); if (!isFinite(gap) || gap < 0) gap = 8;
    var opacity = Number(cfg.dots_opacity); if (!isFinite(opacity) || opacity <= 0) opacity = 35;

    wrapperEl.style.setProperty('--pvd-size', size + 'px');
    wrapperEl.style.setProperty('--pvd-gap', gap + 'px');
    wrapperEl.style.setProperty('--pvd-opacity', (opacity / 100).toString());
    wrapperEl.style.setProperty('--pvd-color', cfg.dots_color || '#111');
    wrapperEl.style.setProperty('--pvd-active', cfg.dots_active_color || '#E87529');

    // pill width derived from size for consistent proportions
    wrapperEl.style.setProperty('--pvd-width', Math.round(size * 2.2) + 'px');
    wrapperEl.style.setProperty('--pvd-radius', Math.max(4, Math.round(size * 0.75)) + 'px');

    wrapperEl.setAttribute('data-pvd-style', (String(cfg.dots_style || 'circle').toLowerCase() === 'pill') ? 'pill' : 'circle');
    wrapperEl.classList.toggle('pvd-hide-dots-desktop', toBool(cfg.dots_desktop, false) === false);
    wrapperEl.classList.toggle('pvd-hide-dots-mobile', toBool(cfg.dots_mobile, true) === false);
  }

  function applySlickMotion(sliderEl, cfg) {
    if (!window.jQuery) return;
    var $ = window.jQuery;
    var $slider = $(sliderEl);
    if (!$slider.hasClass('slick-initialized') || !$slider.data('slick')) return;

    var speed = Number(cfg.slide_speed);
    if (!isFinite(speed) || speed <= 0) speed = 320;

    var easing = cfg.easing || 'cubic-bezier(0.22, 1, 0.36, 1)';
    var swipeToSlide = toBool(cfg.swipe_to_slide, true);
    var draggable = toBool(cfg.draggable, true);

    // Lower threshold = more sensitive swipe
    var touchThreshold = swipeToSlide ? 4 : 6;

    try {
      $slider.slick('slickSetOption', 'speed', speed, true);
      $slider.slick('slickSetOption', 'cssEase', easing, true);
      $slider.slick('slickSetOption', 'useCSS', true, true);
      $slider.slick('slickSetOption', 'useTransform', true, true);
      $slider.slick('slickSetOption', 'waitForAnimate', false, true);
      $slider.slick('slickSetOption', 'swipeToSlide', swipeToSlide, true);
      $slider.slick('slickSetOption', 'draggable', draggable, true);
      $slider.slick('slickSetOption', 'touchThreshold', touchThreshold, true);
      // Try to improve perceived loading on slow connections
      $slider.slick('slickSetOption', 'lazyLoad', 'progressive', true);
    } catch (e) {
      // no-op
    }
  }

  function removeOldDots(wrapperEl) {
    var old = wrapperEl.querySelector('.pvd-dots');
    if (old) old.remove();
  }

  function buildDots(sliderEl, cfg) {
    if (!window.jQuery) return;
    var $ = window.jQuery;
    var $slider = $(sliderEl);
    if (!$slider.hasClass('slick-initialized') || !$slider.data('slick')) return;

    var slick = null;
    try { slick = $slider.slick('getSlick'); } catch (e) {}
    if (!slick || !slick.slideCount || slick.slideCount <= 1) return;

    // Find a stable wrapper to attach dots + vars (prefer parent with slider + dots)
    var wrapperEl = sliderEl.closest('.pvd-gallery-v3') || sliderEl.parentElement;
    if (!wrapperEl) return;

    wrapperEl.classList.add('pvd-gallery-v3');
    applyWrapperVars(wrapperEl, cfg);
    removeOldDots(wrapperEl);

    var dots = document.createElement('div');
    dots.className = 'pvd-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', 'Product gallery');

    for (var i = 0; i < slick.slideCount; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pvd-dot';
      b.setAttribute('data-index', String(i));
      b.setAttribute('aria-label', 'Go to image ' + (i + 1));
      dots.appendChild(b);
    }

    // Insert after slider for predictable spacing
    if (sliderEl.nextSibling) {
      sliderEl.parentNode.insertBefore(dots, sliderEl.nextSibling);
    } else {
      sliderEl.parentNode.appendChild(dots);
    }

    function setActive(index) {
      var btns = dots.querySelectorAll('.pvd-dot');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('is-active', Number(btns[j].getAttribute('data-index')) === index);
      }
    }

    // Click to slide
    dots.addEventListener('click', function (e) {
      var btn = e.target.closest('.pvd-dot');
      if (!btn) return;
      var idx = Number(btn.getAttribute('data-index'));
      if (!isFinite(idx)) return;
      try { $slider.slick('slickGoTo', idx); } catch (err) {}
    });

    // Sync active dot
    var raf = null;
    function scheduleActive(i) {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { setActive(i); });
    }

    // Bind namespaced events (avoid duplicates)
    try {
      $slider.off('.pvdv3');
      $slider.on('afterChange.pvdv3', function (evt, s, current) {
        scheduleActive(Number(current || 0));
      });
    } catch (e) {}

    scheduleActive(Number(slick.currentSlide || 0));
  }

  function initFromScript(scriptEl) {
    var cfg = safeParseJSON(scriptEl.textContent || scriptEl.innerText || '');
    if (!cfg || !toBool(cfg.enabled, false)) return;

    var root = getSectionRootFromScript(scriptEl);
    if (!root) return;

    // Try now; if slick not ready yet, retry a couple times (no long loops)
    var attempts = 0;
    (function tryInit() {
      attempts++;
      var sliderEl = bestSliderCandidate(root);
      if (sliderEl && window.jQuery && window.jQuery(sliderEl).hasClass('slick-initialized')) {
        applySlickMotion(sliderEl, cfg);
        buildDots(sliderEl, cfg);
        return;
      }
      if (attempts < 5) {
        setTimeout(tryInit, 220);
      }
    })();
  }

  function initAll() {
    var scripts = document.querySelectorAll('script[data-pvd-gallery-config]');
    for (var i = 0; i < scripts.length; i++) initFromScript(scripts[i]);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initAll();
    window.addEventListener('load', function () { initAll(); }, { once: true });
  });

  document.addEventListener('shopify:section:load', function (e) {
    if (!e || !e.target) return;
    // Only init within loaded section
    var scripts = e.target.querySelectorAll('script[data-pvd-gallery-config]');
    for (var i = 0; i < scripts.length; i++) initFromScript(scripts[i]);
  });
})();
