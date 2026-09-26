/**
 * Background worker for the Hive blockchain operation queue.
 * Jobs are released one at a time to the page, which signs and broadcasts
 * them with a stored posting key or Hive Keychain.
 */
"use strict";

const queue = [];
let inflight = null;

function size() {
  return queue.length + (inflight ? 1 : 0);
}

function pump() {
  if (inflight) return;
  if (!queue.length) {
    self.postMessage({ type: "idle", size: 0 });
    return;
  }
  inflight = queue.shift();
  self.postMessage({
    type: "process",
    id: inflight.id,
    op: inflight.op,
    size: size(),
  });
}

self.onmessage = (event) => {
  const msg = event.data || {};

  if (msg.type === "enqueue") {
    queue.push({ id: msg.id, op: msg.op });
    self.postMessage({ type: "queued", id: msg.id, size: size() });
    pump();
    return;
  }

  if (msg.type === "result") {
    if (!inflight || inflight.id !== msg.id) return;
    const id = inflight.id;
    inflight = null;
    self.postMessage({
      type: msg.success ? "done" : "failed",
      id,
      error: msg.error || "",
      result: msg.result || null,
      size: size(),
    });
    pump();
  }
};
