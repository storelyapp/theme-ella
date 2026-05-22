(function () {
  function formatMoney(cents, format) {
    if (typeof cents === "string") cents = cents.replace(".", "");
    const value = Number(cents);

    const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
    const match = format.match(placeholderRegex);
    const placeholder = match ? match[1] : "amount";

    function formatWithDelimiters(number, precision, thousands, decimal) {
      precision = precision == null ? 2 : precision;
      thousands = thousands == null ? "," : thousands;
      decimal = decimal == null ? "." : decimal;

      const num = (number / 100.0).toFixed(precision);
      const parts = num.split(".");
      const dollars = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      const centsPart = parts[1] ? decimal + parts[1] : "";
      return dollars + centsPart;
    }

    switch (placeholder) {
      case "amount":
        return formatWithDelimiters(value, 2, ",", ".");
      case "amount_no_decimals":
        return formatWithDelimiters(value, 0, ",", ".");
      case "amount_with_comma_separator":
        return formatWithDelimiters(value, 2, ".", ",");
      case "amount_no_decimals_with_comma_separator":
        return formatWithDelimiters(value, 0, ".", ",");
      default:
        return formatWithDelimiters(value, 2, ",", ".");
    }
  }

  function initGallery(sectionEl) {
    const track = sectionEl.querySelector("[data-cpi-track]");
    if (!track) return;

    const slides = Array.from(sectionEl.querySelectorAll("[data-cpi-slide]"));
    const dots = Array.from(sectionEl.querySelectorAll("[data-cpi-dot]"));
    const thumbs = Array.from(sectionEl.querySelectorAll("[data-cpi-thumb]"));

    const hasNav = dots.length || thumbs.length;

    function setActive(index) {
      dots.forEach((d) => {
        const active = Number(d.dataset.index) === index;
        d.classList.toggle("is-active", active);
        if (active) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
      thumbs.forEach((t) => t.classList.toggle("is-active", Number(t.dataset.index) === index));
    }

    function scrollToIndex(index) {
        const slide = slides[index];
        if (!slide) return;

        const isRTL = getComputedStyle(track).direction === "rtl";
        let left = slide.offsetLeft;

        // RTL fix: convert logical position to scrollLeft position
        if (isRTL) {
            left = track.scrollWidth - slide.offsetLeft - slide.offsetWidth;
        }

        track.scrollTo({ left, behavior: "smooth" });
        setActive(index);
        }


    dots.forEach((btn) => {
      btn.addEventListener("click", () => scrollToIndex(Number(btn.dataset.index)), { passive: true });
    });
    thumbs.forEach((btn) => {
      btn.addEventListener("click", () => scrollToIndex(Number(btn.dataset.index)), { passive: true });
    });

    if (hasNav && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          let best = null;
          for (const e of entries) {
            if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
          }
          if (best && best.isIntersecting) setActive(Number(best.target.dataset.index));
        },
        { root: track, threshold: [0.35, 0.5, 0.65, 0.8] }
      );
      slides.forEach((s) => io.observe(s));
    }
  }

  function initVariants(sectionEl) {
    const jsonEl = sectionEl.querySelector("[data-cpi-product-json]");
    if (!jsonEl) return;

    let product;
    try {
      product = JSON.parse(jsonEl.textContent);
    } catch (e) {
      return;
    }

    const moneyFormat = sectionEl.getAttribute("data-money-format") || "{{amount}}";
    const priceEl = sectionEl.querySelector("[data-cpi-price]");
    const variantIdInput = sectionEl.querySelector("[data-cpi-variant-id]");
    const optionGroups = Array.from(sectionEl.querySelectorAll("[data-cpi-option]"));

    if (!variantIdInput || optionGroups.length === 0) return;

    function getSelectedOptions() {
      return optionGroups.map((group) => {
        const checked = group.querySelector('input[type="radio"]:checked');
        return checked ? checked.value : null;
      });
    }

    function findVariantByOptions(selectedOptions) {
      return product.variants.find((v) => {
        if (!v.options) return false;
        for (let i = 0; i < selectedOptions.length; i++) {
          if (v.options[i] !== selectedOptions[i]) return false;
        }
        return true;
      });
    }

    function updateUI(variant) {
      if (!variant) return;
      variantIdInput.value = variant.id;

      if (priceEl) {
        const formatted = formatMoney(variant.price, moneyFormat);
        priceEl.textContent = formatted;
      }
    }

    function onOptionChange() {
      const selected = getSelectedOptions();
      if (selected.some((x) => !x)) return;
      const variant = findVariantByOptions(selected);
      updateUI(variant);
    }

    optionGroups.forEach((group) => {
      group.addEventListener("change", onOptionChange);
    });

    // initial sync
    onOptionChange();
  }

  function init(sectionEl) {
    initGallery(sectionEl);
    initVariants(sectionEl);
  }

  function initAll(root = document) {
    root.querySelectorAll(".cpi[data-section-id]").forEach(init);
  }

  document.addEventListener("DOMContentLoaded", () => initAll());

  document.addEventListener("shopify:section:load", (event) => {
    const sectionEl = event.target;
    if (sectionEl && sectionEl.matches(".cpi")) init(sectionEl);
    else initAll(sectionEl);
  });
})();
