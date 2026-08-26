'use strict';

const mediasoup = require('mediasoup');
const config = require('./config');

/** @type {import('mediasoup').types.Worker[]} */
const workers = [];
let nextWorkerIdx = 0;

async function createWorkers() {
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker(config.workerSettings);
    worker.on('died', () => {
      console.error(`mediasoup worker ${worker.pid} died — restarting in 2s`);
      setTimeout(createWorkers, 2000);
    });
    workers.push(worker);
    console.log(`[sfu] worker ${worker.pid} ready`);
  }
}

function getNextWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

function workerCount() {
  return workers.length;
}

module.exports = {
  createWorkers,
  getNextWorker,
  workerCount,
};
