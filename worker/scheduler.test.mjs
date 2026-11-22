import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerScheduler, WorkerQueueFullError } from './scheduler.ts';

test('Worker scheduler bounds concurrent upstream work and releases failed slots', async () => {
  const schedule = createWorkerScheduler({ maximum: 2, statsGapMs: 0 });
  let active = 0, peak = 0;
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => schedule(false, async () => {
    active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (i === 0) throw new Error('upstream failure');
      return i;
    } finally { active--; }
  })));
  assert.equal(peak, 2);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.equal(await schedule(false, async () => 'recovered'), 'recovered');
});

test('Worker stats lane paces starts without blocking another API origin', async () => {
  const schedule = createWorkerScheduler({ maximum: 4, statsGapMs: 50 });
  let finish;
  const first = schedule(true, () => new Promise(resolve => { finish = resolve; }));
  assert.equal(await schedule(false, async () => 'scoreboard'), 'scoreboard');
  const started = Date.now();
  const second = schedule(true, async () => Date.now());
  finish('stats');
  assert.equal(await first, 'stats');
  assert.ok((await second) - started >= 40);
});

test('Worker queue wait is bounded and does not leak a concurrency slot', async () => {
  let now = 0;
  const schedule = createWorkerScheduler({ maximum: 1, statsGapMs: 0, maximumWaitMs: 50,
    now: () => now, sleep: async ms => { now += ms; } });
  let finish;
  const first = schedule(false, () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(schedule(false, async () => 'must not run'), WorkerQueueFullError);
  finish('done');
  await first;
  assert.equal(await schedule(false, async () => 'available'), 'available');
});

test('reserved live slot stays available while general requests occupy their capacity',async()=>{
  const schedule=createWorkerScheduler({maximum:4,statsGapMs:0,reserveLiveSlot:true});
  const releases=[];
  const general=Array.from({length:3},()=>schedule(false,()=>new Promise(resolve=>releases.push(resolve))));
  assert.equal(releases.length,3);
  assert.equal(await schedule(false,async()=>'live-score',true),'live-score');
  releases.forEach(resolve=>resolve('done'));await Promise.all(general);
});
