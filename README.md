# lampa-ascii-screensaver

Заставка «ASCII-рыбки» для [Lampa](http://lampa.mx): пруд с карпами кои из ASCII-плиток.
Движок — [howdeploy/ascii-life-engine](https://github.com/howdeploy/ascii-life-engine) (MIT),
сцена `koi`. Цель — Lampa в Vivaldi на Маке.

## Как устроено

```
Lampa: N минут без ввода
        │
        ▼
Lampa.Screensaver.class_list.ascii_koi → create()
        │   шаблон Lampa 'screensaver' (градиент, часы, дата)
        │   + <div> с new AsciiLife(div, {scene:'koi', ...}).start()
        ▼
клавиша / клик → destroy() → life.destroy(): rAF и слушатели сняты
```

Плагин регистрирует тип `ascii_koi` и пункт «ASCII-рыбки» в «Настройки → Остальное →
Тип заставки». При первой установке он сразу выбирает этот тип (флаг `ascii_koi_installed`
в Storage Lampa). Потом выбор остаётся за пользователем.

## Файлы

```
src/screensaver.js              класс заставки и регистрация в Lampa (ES5)
vendor/ascii-life-engine/       зафиксированная копия движка, коммит в VERSION
build.sh                        склейка → dist/lampa-ascii-koi.js (один файл плагина)
test/check.mjs                  проверка в настоящей Lampa в чистом профиле Vivaldi
```

Настройки сцены (палитра, свет на воде, FPS) — объект `OPTIONS` в `src/screensaver.js`.
Полный список — в начале `vendor/ascii-life-engine/ascii-life.js`.

## Сборка и проверка

```sh
npm test        # = ./build.sh && node test/check.mjs
```

Тест запускает отдельный безголовый Vivaldi во временном профиле (основной не трогает),
открывает lampa.mx, подключает плагин через `Lampa.Utils.putScriptAsync` — так же, как
«Расширения → Добавить плагин», — запускает заставку и закрывает её клавишей.
Скриншот — `test/out/saver.png`.

Особенности стенда, найденные при отладке:

- Playwright с Vivaldi не работает (не видит вкладки) — тест говорит с CDP напрямую.
- Вкладка отвечает по CDP только через ~3 с после запуска.
- Чистый профиль Lampa ждёт выбора языка — тест заранее пишет `language=ru`.
- Первые секунды Lampa восстанавливает страницы, и каждый переход закрывает заставку.
- `Input.dispatchKeyEvent` до страницы не доходит — клавиша шлётся DOM-событием.

## Обновление движка

Копия движка зафиксирована намеренно: обновление чужого репозитория не должно молча
попадать в Lampa. Обновлять вручную: скопировать новый `ascii-life.js`, прочитать diff,
записать коммит в `vendor/ascii-life-engine/VERSION`, `npm test`.

## Локальная сеть

Lampa открыта с публичного адреса `lampa.mx`. Если плагин лежит на `127.0.0.1` или в
домашней сети, Chromium требует разрешения «доступ к локальной сети» (Local Network Access).
Vivaldi спросит его один раз при первой загрузке плагина.
