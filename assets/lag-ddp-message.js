/* assets/lag-ddp-message.js
   Shows a region message ONLY for US/UK using geo from lag-geo.js.
   - US: country === "US"
   - UK: country === "GB" or "UK"
   - Reads text from data-* attributes rendered by Liquid blocks
   Reliability:
   - Uses window.lagGetGeo / lag:geo_ready if available
   - Falls back to ipapi.co/json if geo not available (VPN testing)
*/
(function () {
  "use strict";

  function apply(countryCode) {
    var cc = String(countryCode || "").toUpperCase();

    var isUS = cc === "US";
    var isUK = cc === "GB" || cc === "UK";

    var nodes = document.querySelectorAll("[data-lag-ddp-wrap]");
    if (!nodes || !nodes.length) return;

    for (var i = 0; i < nodes.length; i++) {
      var w = nodes[i];

      if (!isUS && !isUK) {
        w.hidden = true;
        continue;
      }

      var title = isUS ? (w.getAttribute("data-us-title") || "") : (w.getAttribute("data-uk-title") || "");
      var text  = isUS ? (w.getAttribute("data-us-text")  || "") : (w.getAttribute("data-uk-text")  || "");

      var tEl = w.querySelector("[data-ddp-title]");
      var xEl = w.querySelector("[data-ddp-text]");

      if (tEl) tEl.textContent = title;
      if (xEl) xEl.textContent = text;

      w.hidden = false;
    }
  }

  function runWithGeo(geo) {
    if (!geo) return false;
    var cc = String(geo.country || "").toUpperCase();
    if (!cc) return false;
    apply(cc);
    return true;
  }

  function fallbackIpapi() {
    // Only run if nothing else produced a country
    try {
      if (window.LAG_GEO && window.LAG_GEO.country) return;
    } catch (e) {}

    fetch("https://ipapi.co/json/", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var cc = String(j && (j.country_code || j.country) || "").toUpperCase();
        if (cc) apply(cc);
      })
      .catch(function () {});
  }

  var resolved = false;

  // Fast path: already present
  try {
    if (window.LAG_GEO && (window.LAG_GEO.country || window.LAG_GEO.currency)) {
      resolved = runWithGeo(window.LAG_GEO) || resolved;
    }
  } catch (e) {}

  // Promise path
  if (!resolved && typeof window.lagGetGeo === "function") {
    window.lagGetGeo().then(function (geo) {
      resolved = runWithGeo(geo) || resolved;
    }).catch(function () {});
  }

  // Event path
  window.addEventListener("lag:geo_ready", function (e) {
    if (resolved) return;
    resolved = runWithGeo(e && e.detail ? e.detail : null) || resolved;
  });

  // Fallback after a short delay (covers pages where lag-geo.js isn't loaded)
  setTimeout(function () {
    if (!resolved) fallbackIpapi();
  }, 700);
})();
