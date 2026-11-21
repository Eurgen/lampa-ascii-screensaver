/*
 * Lampa: заставка «ASCII-рыбки» на движке ascii-life-engine (сцена koi).
 * Регистрирует тип в Lampa.Screensaver.class_list и пункт в «Тип заставки».
 * ES5, как и сама Lampa.
 */
(function () {
  'use strict';

  var TYPE = 'ascii_koi';
  var TITLE = 'ASCII-рыбки';

  // Настройки движка. Один профиль для всех устройств, рассчитан на слабый GPU Android TV.
  var OPTIONS = {
    scene: 'koi',
    palette: 'mix',       // породы вперемешку: kohaku, sanke, showa, ogon, chagoi
    waterMood: 'sun',     // leaves | clouds | sun | moon
    pointer: 'none',      // на пульте курсора нет
    glow: false,          // пятно света вокруг курсора не нужно
    tapAction: 'none',    // клик всё равно закрывает заставку
    fps: 24,              // на экране 60 Гц даёт ровный шаг 50 мс (20 кадров в секунду)
    maxDpr: 1,            // холст не больше экрана в CSS-пикселях
    cols: 100,            // меньше клеток, чем 150 по умолчанию
    waterScale: 0.5,      // шейдер воды считает в 4 раза меньше пикселей
    bloom: 0              // без размытой копии кадра
  };

  if (window.lampa_ascii_koi_loaded) return;
  window.lampa_ascii_koi_loaded = true;

  function AsciiKoi(params) {
    this.params = params || {};
  }

  AsciiKoi.prototype.create = function () {
    // Шаблон Lampa: градиент и часы с датой поверх нашего холста.
    this.html = Lampa.Template.get('screensaver');
    this.html.find('.screensaver__slides').remove();

    this.stage = $('<div class="ascii-koi-stage"></div>').css({
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0
    });
    this.html.prepend(this.stage);

    var opts = {};
    for (var k in OPTIONS) opts[k] = OPTIONS[k];
    opts.seed = Math.floor(Math.random() * 1e9); // каждый раз новые рыбы

    this.life = new AsciiLife(this.stage[0], opts).start();

    this.time = Lampa.Utils.time(this.html);
    this.time.tik();
  };

  AsciiKoi.prototype.render = function () {
    return this.html;
  };

  AsciiKoi.prototype.destroy = function () {
    if (this.life) this.life.destroy();
    this.life = null;
    if (this.html) this.html.remove();
  };

  function register() {
    if (!window.Lampa || !Lampa.Screensaver || !Lampa.Params) return;

    Lampa.Screensaver.class_list[TYPE] = AsciiKoi;

    var values = Lampa.Params.values.screensaver_type || {};
    if (!values[TYPE]) {
      var next = {};
      for (var k in values) next[k] = values[k];
      next[TYPE] = TITLE;
      Lampa.Params.select('screensaver_type', next, Lampa.Params.defaults.screensaver_type || 'aerial');
    }

    // Первая установка: сразу выбрать нашу заставку. Дальше выбор за пользователем.
    if (!Lampa.Storage.get('ascii_koi_installed', '')) {
      Lampa.Storage.set('ascii_koi_installed', '1');
      Lampa.Storage.set('screensaver_type', TYPE);
    }
  }

  register();
  if (!window.appready && Lampa.Listener) {
    Lampa.Listener.follow('app', function (e) {
      if (e.type == 'ready') register();
    });
  }
})();
