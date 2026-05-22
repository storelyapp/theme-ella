(function ($) {
  var halo = {
    imageBannderSlide: function () {
      var imageBanner = $('[data-image-banner-slide]');

      if (!$.fn || typeof $.fn.slick !== 'function') {
        console.warn('[Lagorii] Slick not loaded — skipping image banner init');
        return;
      }

      imageBanner.each(function () {
        var self = $(this),
          arrowEnable   = String(self.data('arrows')) === 'true',
          dotEnable     = String(self.data('dots')) === 'true',
          autoplay      = String(self.data('autoplay')) === 'true',
          autoplaySpeed = parseInt(self.data('autoplay-speed'), 10) || 3000;

        if (self.hasClass('slick-initialized')) return;

        if (!self.hasClass('slick-initialized')) self.slick({
          // if your .item is wrapped: slide: '> div > .item',
          slide: '> div > .item',
          slidesToShow: 1,
          slidesToScroll: 1,
          arrows: arrowEnable,
          dots: dotEnable,
          infinite: true,
          fade: true,                // hero crossfade
          speed: 600,                // animation speed
          autoplay: autoplay,
          autoplaySpeed: autoplaySpeed,
          nextArrow: window.arrows && window.arrows.icon_next || '<button type="button" class="slick-next">Next</button>',
          prevArrow: window.arrows && window.arrows.icon_prev || '<button type="button" class="slick-prev">Prev</button>',
          rtl: !!window.rtl_slick,
          responsive: [
            { breakpoint: 1500, settings: { arrows: false } }
          ]
        });
      });
    }
  };

  window.addEventListener('DOMContentLoaded', halo.imageBannderSlide);
})(jQuery);
