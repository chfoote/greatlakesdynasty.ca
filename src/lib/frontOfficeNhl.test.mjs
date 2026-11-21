import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFrontOfficeNhl } from './frontOfficeNhl.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('current scores publish before slow historical reports finish', async () => {
  let finishSkaters, finishGoalies;
  const skaters = [], goalies = [];
  const task = loadFrontOfficeNhl({
    currentSkaters: async () => [{ playerId: 1, goals: 5 }],
    currentGoalies: async () => [{ playerId: 2, wins: 3 }],
    previousSkaters: () => new Promise(resolve => { finishSkaters = resolve; }),
    previousGoalies: () => new Promise(resolve => { finishGoalies = resolve; }),
    onSkaters: rows => skaters.push(rows), onGoalies: rows => goalies.push(rows), onError: error => { throw error; },
  });
  await flush();
  assert.equal(skaters[0][0].goals, 5);
  assert.equal(goalies[0][0].wins, 3);
  finishSkaters([{ playerId: 1, goals: 40 }, { playerId: 3, goals: 10 }]);
  finishGoalies([]);
  await task;
  assert.deepEqual(skaters.at(-1), [{ playerId: 1, goals: 5 }, { playerId: 3, goals: 10 }]);
});

test('a skater failure does not discard loaded goalie scores or request more skater history', async () => {
  let goalieRows, historicalSkaterCalls = 0;
  const errors = [];
  await loadFrontOfficeNhl({
    currentSkaters: async () => { throw Error('429'); },
    previousSkaters: async () => { historicalSkaterCalls++; return []; },
    currentGoalies: async () => [{ playerId: 2, wins: 0 }], previousGoalies: async () => [],
    onSkaters: () => assert.fail('failed stats must not become zeros'), onGoalies: rows => { goalieRows = rows; },
    onError: error => errors.push(error),
  });
  assert.equal(historicalSkaterCalls, 0);
  assert.equal(goalieRows[0].wins, 0);
  assert.equal(errors.length, 1);
});

test('historical request failures preserve already published current statistics', async () => {
  const published = [], errors = [];
  await loadFrontOfficeNhl({
    currentSkaters: async () => [{ playerId: 1 }], previousSkaters: async () => { throw Error('500'); },
    currentGoalies: async () => [], previousGoalies: async () => [],
    onSkaters: rows => published.push(rows), onGoalies: () => {}, onError: error => errors.push(error),
  });
  assert.deepEqual(published, [[{ playerId: 1 }]]);
  assert.equal(errors.length, 1);
});

test('leaving the page prevents optional historical requests from starting', async () => {
  let historicalCalls = 0;
  await loadFrontOfficeNhl({
    isActive: () => false,
    currentSkaters: async () => [{ playerId: 1 }], currentGoalies: async () => [],
    previousSkaters: async () => { historicalCalls++; return []; },
    previousGoalies: async () => { historicalCalls++; return []; },
    onSkaters: () => assert.fail('page has unmounted'), onGoalies: () => assert.fail('page has unmounted'), onError: () => {},
  });
  assert.equal(historicalCalls, 0);
});

test('covered current rosters skip historical NHL requests', async () => {
  let historicalCalls = 0;
  const published = [];
  await loadFrontOfficeNhl({
    currentSkaters: async () => [{ playerId: 1 }], currentGoalies: async () => [{ playerId: 2 }],
    previousSkaters: async () => { historicalCalls++; return []; }, previousGoalies: async () => { historicalCalls++; return []; },
    needsPreviousSkaters: rows => !rows.some(row => row.playerId === 1),
    needsPreviousGoalies: rows => !rows.some(row => row.playerId === 2),
    onSkaters: rows => published.push(rows), onGoalies: rows => published.push(rows), onError: error => {throw error;},
  });
  assert.equal(historicalCalls, 0);
  assert.equal(published.length, 2);
});
