// Run after npm run build: electron scripts/test-delivery.cjs
const { app, ipcMain, session } = require('electron');
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => {
  if (error.code !== 'EPIPE') throw error;
});
const testData = path.join(app.getPath('temp'), 'screenping-delivery-test-' + process.pid);
fs.mkdirSync(testData, { recursive: true });
app.setPath('userData', testData);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await wait(25);
  assert(predicate(), 'Timed out waiting for delivery');
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
// One second PCM silence; audio decoding must complete before synchronized start.
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
const payload = (id, extras = {}) => ({ messageId: id, fromUserId: 'test', mediaType: 'image',
  mediaUrl: `https://screenping.xyz/uploads/${id}.png`, durationMs: 150, fadeInMs: 0, ...extras });

app.whenReady().then(async () => {
  const { OverlayQueue } = require('../dist/main/overlayQueue.js');
  const { createOverlayWindow } = require('../dist/main/windows.js');
  await session.defaultSession.protocol.handle('https', async request => {
    if (request.url.includes('slow')) await wait(700);
    const denied = new URL(request.url).pathname.endsWith('/denied.png');
    const audio = request.url.includes('.wav');
    return new Response(denied ? 'Denied' : audio ? wav : png, {
      status: denied ? 403 : 200, headers: { 'Content-Type': denied ? 'text/plain' : audio ? 'audio/wav' : 'image/png' },
    });
  });
  const initialized = new Set();
  ipcMain.on('overlay:initialized', event => initialized.add(event.sender.id));
  const results = [], prepared = new Set(), starts = [];
  const queues = [], windows = [];
  const commonStart = (id, groupId) => {
    assert.equal(groupId, 'group');
    prepared.add(id);
    if (prepared.size === 2) {
      const startAt = Date.now() + 400;
      queues[0].scheduleStart('group-fast', startAt);
      queues[1].scheduleStart('group-slow', startAt);
    }
  };
  for (let i = 0; i < 2; i++) {
    const win = createOverlayWindow();
    const queue = new OverlayQueue((messageId, status) => results.push({ messageId, status }), commonStart);
    queue.setWindow(win);
    const startPrepared = queue.startPrepared.bind(queue);
    queue.startPrepared = async id => { starts.push({ id, at: Date.now() }); return startPrepared(id); };
    windows.push(win); queues.push(queue);
  }
  await until(() => initialized.size === 2);
  await wait(500);
  assert(windows.every(win => !win.isVisible()));
  queues[0].enqueue(payload('idle-first'), false);
  await until(() => results.length === 1);
  assert.deepEqual(results[0], { messageId: 'idle-first', status: 'delivered' });
  console.log('PASS first ping after idle without another ping');
  for (let i = 0; i < 5; i++) queues[0].enqueue(payload('burst-' + i), false);
  queues[0].enqueue(payload('burst-0'), false);
  await until(() => results.length === 6);
  assert.deepEqual(results.slice(1).map(result => result.messageId), ['burst-0', 'burst-1', 'burst-2', 'burst-3', 'burst-4']);
  console.log('PASS burst order and duplicate suppression');
  const execute = windows[0].webContents.executeJavaScript.bind(windows[0].webContents);
  windows[0].webContents.executeJavaScript = () => new Promise(() => {});
  queues[0].enqueue(payload('stalled-cleanup'), false);
  queues[0].enqueue(payload('after-stalled'), false);
  await until(() => results.length === 8);
  windows[0].webContents.executeJavaScript = execute;
  console.log('PASS unresponsive cleanup cannot block next ping');
  queues[0].enqueue(payload('denied'), false);
  queues[0].enqueue(payload('after-denied'), false);
  await until(() => results.length === 10);
  assert.deepEqual(results.slice(8), [{ messageId: 'denied', status: 'failed' }, { messageId: 'after-denied', status: 'delivered' }]);
  console.log('PASS failed download then successful delivery');
  queues[0].enqueue(payload('group-fast', { syncGroupId: 'group' }), false);
  queues[1].enqueue(payload('group-slow', { syncGroupId: 'group' }), false);
  await until(() => prepared.size === 1);
  assert(!starts.some(item => item.id.startsWith('group-')));
  assert.equal(windows[0].getOpacity(), 0);
  await until(() => results.length === 12);
  const groupStarts = starts.filter(item => item.id.startsWith('group-'));
  assert.equal(groupStarts.length, 2);
  const skew = Math.abs(groupStarts[0].at - groupStarts[1].at);
  assert(skew < 100, `Unexpected start skew ${skew}ms`);
  console.log(`PASS shared start after slower download (local skew ${skew}ms)`);
  queues[0].enqueue(payload('audio-sync', { mediaType: 'audio', mediaUrl: 'https://screenping.xyz/uploads/audio.wav', syncGroupId: 'group' }), false);
  await until(() => prepared.has('audio-sync'));
  queues[0].scheduleStart('audio-sync', Date.now() + 100);
  await until(() => results.length === 13);
  assert.equal(results[12].status, 'delivered');
  console.log('PASS audio preparation and synchronized start');
  queues[0].enqueue(payload('slow-cancel'), false);
  await wait(100);
  queues[0].revoke('slow-cancel');
  queues[0].enqueue(payload('after-cancel'), false);
  await until(() => results.length === 15);
  assert.deepEqual(results.slice(13), [{ messageId: 'slow-cancel', status: 'failed' }, { messageId: 'after-cancel', status: 'delivered' }]);
  await wait(900);
  assert.equal(results.length, 15);
  assert.equal(ipcMain.listenerCount('overlay:cleared'), 0);
  assert(results.filter(result => result.status === 'failed').length === 2);
  console.log('PASS cancellation does not revive an old download; no IPC listener leak');
  windows.forEach(win => win.destroy()); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
