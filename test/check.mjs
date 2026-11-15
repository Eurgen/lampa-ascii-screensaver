// Проверка плагина в настоящей Lampa (lampa.mx) в отдельном чистом профиле Vivaldi.
// Запуск: ./build.sh && node test/check.mjs
// Результат: скриншоты в test/out/, итог в консоли. Основной профиль Vivaldi не трогается.
// Playwright с Vivaldi не работает (не видит вкладки), поэтому здесь голый CDP через WebSocket из Node.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = fs.readFileSync(path.join(root, 'dist/lampa-ascii-koi.js'));
const out = path.join(root, 'test/out');
fs.mkdirSync(out, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const step = m => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's ' + m);
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

// 1. Локальная раздача плагина — так же, как это будет делать хостинг.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
  res.end(plugin);
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const pluginUrl = `http://127.0.0.1:${server.address().port}/lampa-ascii-koi.js`;

// 2. Vivaldi во временном профиле с портом отладки.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-koi-'));
const port = 9300 + Math.floor(Math.random() * 600);
const vivaldi = spawn('/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check', '--headless=new',
  // Retina-масштаб флагом: эмуляция через Emulation.setDeviceMetricsOverride
  // в безголовом Vivaldi даёт скриншот, размноженный плиткой.
  '--window-size=1440,900', '--force-device-scale-factor=2', 'about:blank'
], { stdio: 'ignore' });

let ws;
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => []);
    target = list.find(t => t.type === 'page' && t.url === 'about:blank');
  }
  if (!target) throw new Error('Vivaldi не открыл вкладку с отладкой');
  // Вкладка появляется в списке раньше, чем начинает отвечать: без паузы CDP молча висит.
  await sleep(3000);

  // 3. Минимальный клиент CDP.
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async name => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
  };
  const mouse = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });

  // Плагин раздаётся с 127.0.0.1, а Lampa — публичный сайт. Chromium требует разрешения
  // «доступ к локальной сети» (Local Network Access). В живом Vivaldi его один раз дают кнопкой.
  // Для 127.0.0.1 решает именно loopbackNetwork; остальные — на случай других версий Chromium.
  for (const p of ['localNetworkAccess', 'localNetwork', 'loopbackNetwork']) {
    await cdp('Browser.grantPermissions', { origin: 'http://lampa.mx', permissions: [p] }).catch(() => {});
  }
  // У безголового окна нет фокуса: без этого клавиши из CDP не доходят до window.keydown.
  await cdp('Page.bringToFront');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Runtime.enable');
  await cdp('Page.enable');

  // 4. Открыть Lampa и дождаться готовности.
  step('открываю lampa.mx');
  await cdp('Page.navigate', { url: 'http://lampa.mx/' });
  await sleep(2000);
  // Чистый профиль: Lampa ждёт выбора языка и не доходит до appready. Выбираем заранее.
  await js(`localStorage.setItem('language', 'ru'); true`);
  await cdp('Page.reload');
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (await js('window.appready === true').catch(() => false)) break;
  }
  ok(await js('window.appready === true'), 'Lampa загрузилась');

  // 5. Подключение плагина тем же путём, что и «Расширения → Добавить плагин».
  await js(`new Promise((res, rej) => Lampa.Utils.putScriptAsync([${JSON.stringify(pluginUrl)}], res, rej))`);
  step('плагин подключён');
  // После старта Lampa ещё секунды восстанавливает последние страницы, и каждый переход
  // закрывает заставку. В жизни заставка включается после минут простоя — ждём затишья.
  await sleep(10000);
  const reg = await js(`({
    cls: typeof Lampa.Screensaver.class_list.ascii_koi,
    menu: Lampa.Params.values.screensaver_type.ascii_koi,
    selected: Lampa.Storage.field('screensaver_type')
  })`);
  ok(reg.cls === 'function', 'тип ascii_koi зарегистрирован');
  ok(reg.menu === 'ASCII-рыбки', 'пункт в меню «Тип заставки»: ' + reg.menu);
  ok(reg.selected === 'ascii_koi', 'выбран после установки: ' + reg.selected);

  // 6. Запуск так же, как по таймеру бездействия, плюс движение мыши.
  // Диагностика: кто и когда закрыл заставку (стек вызова stopSlideshow).
  await js(`(() => {
    window.__koiStops = [];
    window.__koiKeys = 0;
    window.addEventListener('keydown', () => window.__koiKeys++, true);
    const orig = Lampa.Screensaver.stopSlideshow;
    Lampa.Screensaver.stopSlideshow = function () {
      window.__koiStops.push(new Error().stack.split('\\n').slice(2, 8).map(s => s.trim()).join(' <- '));
      return orig.apply(this, arguments);
    };
    return true;
  })()`);
  await js('Lampa.Screensaver.show()');
  await sleep(4000);
  const early = await js('window.__koiStops');
  if (early.length) step('заставку закрыли раньше времени: ' + early.join(' || '));
  for (let i = 0; i < 20; i++) { await mouse(600 + i * 10, 450 + i * 5); await sleep(50); }
  await sleep(2000);
  await shot('saver.png');
  step('скриншот test/out/saver.png');

  const st = await js(`(() => {
    const c = document.querySelector('.screensaver-layer .ascii-koi-stage canvas');
    return {
      worked: Lampa.Screensaver.worked,
      canvas: !!c, w: c && c.width, h: c && c.height,
      clock: (document.querySelector('.screensaver-layer .time--clock') || {}).textContent || ''
    };
  })()`);
  ok(st.worked && st.canvas, `холст на экране: ${st.w}×${st.h}`);
  ok(/\d/.test(st.clock), 'часы Lampa поверх: ' + st.clock);

  // 7. Любая клавиша закрывает заставку, движок должен остановиться и убрать холст.
  // Input.dispatchKeyEvent в безголовом Vivaldi до страницы не доходит (проверено счётчиком),
  // поэтому шлём DOM-событие на window — дальше тот же путь, что у настоящей клавиши.
  await js(`(() => {
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => 40 });
    Object.defineProperty(ev, 'which', { get: () => 40 });
    window.dispatchEvent(ev);
    return true;
  })()`);
  await sleep(1000);
  const after = await js(`({ worked: Lampa.Screensaver.worked, stage: !!document.querySelector('.ascii-koi-stage'), stops: window.__koiStops.length, keys: window.__koiKeys })`);
  step('после клавиши: ' + JSON.stringify(after));
  ok(!after.worked && !after.stage, 'клавиша закрыла заставку и убрала холст');
  await shot('after.png');

  // Встроенные скрипты самого Vivaldi (chrome-extension://) к Lampa и плагину отношения не имеют.
  const own = errors.filter(e => !e.includes('chrome-extension://'));
  ok(own.length === 0, 'ошибок JS страницы нет' + (own.length ? ': ' + own.join(' | ') : ''));
} catch (e) {
  ok(false, 'тест упал: ' + e.message);
} finally {
  try { ws && ws.close(); } catch {}
  // Профиль удалять только после выхода Vivaldi, иначе rmSync падает с ENOTEMPTY.
  const exited = new Promise(r => vivaldi.exitCode !== null ? r() : vivaldi.on('exit', r));
  vivaldi.kill();
  await Promise.race([exited, sleep(5000)]);
  server.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
