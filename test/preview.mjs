// Живой просмотр: отдельное окно Vivaldi (временный профиль) с Lampa и подключённым плагином.
// Запуск: ./build.sh && node test/preview.mjs   — окно закрыть, когда насмотритесь.
// Заставка стартует сразу; после закрытия клавишей/кликом вернётся через 1 минуту простоя.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginFile = path.join(root, 'dist/lampa-ascii-koi.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Файл читается на каждый запрос: после ./build.sh достаточно перезагрузить окно.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(pluginFile));
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
// PLUGIN_URL — проверить опубликованную копию (например, GitHub Pages) вместо локальной.
const pluginUrl = process.env.PLUGIN_URL || `http://127.0.0.1:${server.address().port}/lampa-ascii-koi.js`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-koi-'));
const port = 9300 + Math.floor(Math.random() * 600);
const vivaldi = spawn('/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--window-position=80,60', 'about:blank'
], { stdio: 'ignore' });

// Профиль удалять только после выхода Vivaldi: иначе он дописывает файлы и rmSync падает с ENOTEMPTY.
const exited = new Promise(r => vivaldi.on('exit', r));
const cleanup = async () => {
  if (vivaldi.exitCode === null) vivaldi.kill();
  await Promise.race([exited, sleep(5000)]);
  server.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(0); });

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => []);
  target = list.find(t => t.type === 'page' && t.url === 'about:blank');
}
await sleep(3000);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;

for (const p of ['localNetworkAccess', 'localNetwork', 'loopbackNetwork']) {
  await cdp('Browser.grantPermissions', { origin: 'http://lampa.mx', permissions: [p] });
}
await cdp('Page.navigate', { url: 'http://lampa.mx/' });
await sleep(2000);
await js(`localStorage.setItem('language', 'ru'); true`);
await cdp('Page.reload');
for (let i = 0; i < 120 && !(await js('window.appready === true')); i++) await sleep(500);

// Как «Расширения → Добавить плагин», плюс заставка через 1 минуту простоя.
await js(`Lampa.Storage.set('plugins', [{ url: ${JSON.stringify(pluginUrl)}, status: 1, name: 'ASCII-рыбки' }]); true`);
await js(`new Promise(r => Lampa.Utils.putScriptAsync([${JSON.stringify(pluginUrl)}], r, r))`);
await js(`Lampa.Storage.set('screensaver_time', '1'); true`);
await sleep(8000); // Lampa досматривает стартовые переходы, иначе они закроют заставку
await js('Lampa.Screensaver.show(); true');
console.log('Окно открыто. Заставка запущена. Закройте окно Vivaldi, чтобы завершить.');

// Ждём, пока пользователь закроет окно.
await new Promise(r => { ws.onclose = r; exited.then(r); });
await cleanup();
