(function () {
  function init(root) {
    const track = root.querySelector("[data-pgm-track]");
    if (!track) return;

    const outerFrame = root.querySelector(".pgm__frame--outer");
    const slides = Array.from(root.querySelectorAll("[data-pgm-slide]"));
    const dots = Array.from(root.querySelectorAll("[data-pgm-dot]"));

    // Sync outer frame aspect ratio to the currently-visible slide (per-image AR)
    function syncOuterAR(index) {
      const slide = slides[index];
      if (!slide || !outerFrame) return;
      const w = slide.style.getPropertyValue("--pgm-ar-w") || slide.getAttribute("data-ar-w");
      const h = slide.style.getPropertyValue("--pgm-ar-h") || slide.getAttribute("data-ar-h");
      // Pull from inline style variables
      const sw = slide.style.getPropertyValue("--pgm-ar-w") || "1";
      const sh = slide.style.getPropertyValue("--pgm-ar-h") || "1";
      outerFrame.style.setProperty("--pgm-ar-w", sw.trim() || "1");
      outerFrame.style.setProperty("--pgm-ar-h", sh.trim() || "1");
    }

    function setActive(index) {
      dots.forEach((d) => d.classList.toggle("is-active", Number(d.dataset.index) === index));
      syncOuterAR(index);
    }

    function scrollToIndex(index) {
      const slide = slides[index];
      if (!slide) return;
      track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
      setActive(index);
    }

    dots.forEach((btn) => {
      btn.addEventListener("click", () => scrollToIndex(Number(btn.dataset.index)), { passive: true });
    });

    // Initial AR
    setActive(0);

    // Active tracking via IntersectionObserver
    if (slides.length && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          let best = null;
          for (const e of entries) {
            if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
          }
          if (best && best.isIntersecting) {
            setActive(Number(best.target.dataset.index));
          }
        },
        { root: track, threshold: [0.35, 0.5, 0.65, 0.8] }
      );
      slides.forEach((s) => io.observe(s));
    }
  }

  function initAll(ctx) {
    (ctx || document).querySelectorAll(".pgm[data-pgm]").forEach(init);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAll(document);
  });

  document.addEventListener("shopify:section:load", function (e) {
    if (e && e.target) initAll(e.target);
  });
})();