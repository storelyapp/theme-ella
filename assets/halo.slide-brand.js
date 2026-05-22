(function ($) {
  var halo = {
    initBrandsSlider: function () {
      var brandsSlider = $('[data-brands-slider]');

      if (!$.fn || typeof $.fn.slick !== 'function') {
        console.warn('[Lagorii] Slick not loaded — skipping brands slider init');
        return;
      }

      brandsSlider.each(function () {
        var self = $(this),
          dataArrows     = String(self.data('arrows')) === 'true',
          dataDots       = String(self.data('dots')) === 'true',
          dataCenterMode = String(self.data('center-mode')) === 'true',
          itemsToShow    = parseInt(self.data('rows'), 10) || 5,
          autoplay       = String(self.data('autoplay')) === 'true',
          autoplaySpeed  = parseInt(self.data('autoplay-speed'), 10) || 3000,
          rowsMobile     = parseInt(self.data('rows-mobile'), 10) || 2,
          itemTotal      = self.find('.halo-item').length;

        if (self.hasClass('slick-initialized')) return;

        self.slick({
          slidesToShow: itemsToShow,
          slidesToScroll: 1,
          arrows: dataArrows,
          dots: dataDots && itemTotal > itemsToShow,
          centerMode: dataCenterMode,
          centerPadding: dataCenterMode ? '10%' : '0',
          infinite: autoplay || dataCenterMode,     // sensible default
          speed: 800,
          autoplay: autoplay,
          autoplaySpeed: autoplaySpeed,
          nextArrow: window.arrows && window.arrows.icon_next || '<button type="button" class="slick-next">Next</button>',
          prevArrow: window.arrows && window.arrows.icon_prev || '<button type="button" class="slick-prev">Prev</button>',
          rtl: !!window.rtl_slick,
          responsive: [
            {
              breakpoint: 1200,
              settings: {
                infinite: false,
                centerMode: false,
                slidesToShow: 4,
                slidesToScroll: 4,
                arrows: dataArrows,
                dots: dataDots && itemTotal > 4
              }
            },
            {
              breakpoint: 992,
              settings: {
                slidesToShow: 3,
                slidesToScroll: 3,
                arrows: dataArrows,
                dots: dataDots && itemTotal > 3
              }
            },
            {
              breakpoint: 768,
              settings: {
                slidesToShow: 2,
                slidesToScroll: 2,
                arrows: dataArrows,
                dots: dataDots && itemTotal > 2
              }
            },
            {
              breakpoint: 480,
              settings: {
                slidesToShow: rowsMobile,
                slidesToScroll: rowsMobile,
                arrows: dataArrows,
                dots: dataDots && itemTotal > rowsMobile
              }
            }
          ]
        });
      });
    }
  };

  // Wait until Slick (deferred) is parsed
  window.addEventListener('DOMContentLoaded', halo.initBrandsSlider);
})(jQuery);