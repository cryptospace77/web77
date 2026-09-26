/**
 * Blockchain operation queue. Jobs are handed to a worker thread and
 * broadcast in the background, one at a time, with a stored posting key
 * or Hive Keychain.
 */
(function (global) {
  "use strict";

  const listeners = new Set();
  const pending = new Map();
  let seq = 0;
  let worker = null;
  let fallback = null;
  let queueSize = 0;

  function emit(event) {
    listeners.forEach((fn) => {
      try {
        fn(event);
      } catch {
        /* listener errors stay local */
      }
    });
  }

  function nextId() {
    seq += 1;
    return "cs77-op-" + seq + "-" + Date.now();
  }

  function executeOp(op) {
    return new Promise((resolve, reject) => {
      const username = op && op.username;
      const operations = op && op.operations;
      const key = (op && op.key) || "Posting";
      const role = String(key);
      if (!username || !Array.isArray(operations) || !operations.length) {
        reject(new Error("Invalid blockchain operation."));
        return;
      }
      const auth = global.HiveAuth;
      const usePostingKey = role === "Posting" && auth && auth.hasKey(username);
      if (usePostingKey) {
        auth
          .broadcast(username, operations)
          .then((result) => resolve(result || { success: true }))
          .catch(reject);
        return;
      }
      if (!global.hive_keychain) {
        reject(
          new Error(
            role === "Active"
              ? "Hive Keychain is needed to sign this with the active key."
              : "Connect with Hive Keychain or a posting key to continue."
          )
        );
        return;
      }
      global.hive_keychain.requestBroadcast(username, operations, key, (res) => {
        if (res && res.success) resolve(res);
        else {
          reject(
            new Error(
              (res && (res.message || res.error)) || "Broadcast was cancelled."
            )
          );
        }
      });
    });
  }

  function settle(id, success, error, result) {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (success) job.resolve(result);
    else job.reject(error instanceof Error ? error : new Error(error || "Operation failed."));
  }

  function handleWorkerMessage(msg) {
    if (!msg || !msg.type) return;
    if (typeof msg.size === "number") queueSize = msg.size;

    if (msg.type === "queued") {
      emit({ type: "queued", id: msg.id, size: queueSize });
      return;
    }

    if (msg.type === "process") {
      emit({ type: "process", id: msg.id, op: msg.op, size: queueSize });
      executeOp(msg.op)
        .then((result) => {
          postResult(msg.id, true, "", result);
        })
        .catch((err) => {
          postResult(msg.id, false, (err && err.message) || String(err), null);
        });
      return;
    }

    if (msg.type === "done") {
      emit({ type: "done", id: msg.id, result: msg.result, size: queueSize });
      settle(msg.id, true, null, msg.result);
      return;
    }

    if (msg.type === "failed") {
      emit({ type: "failed", id: msg.id, error: msg.error, size: queueSize });
      settle(msg.id, false, msg.error, null);
      return;
    }

    if (msg.type === "idle") {
      queueSize = 0;
      emit({ type: "idle", size: 0 });
    }
  }

  function cloneResult(result) {
    try {
      return JSON.parse(JSON.stringify(result || null));
    } catch {
      return successPayload();
    }
  }

  function successPayload() {
    return { success: true };
  }

  function postResult(id, success, error, result) {
    const payload = {
      type: "result",
      id,
      success,
      error: error || "",
      result: success ? cloneResult(result) : null,
    };
    if (worker) {
      try {
        worker.postMessage(payload);
      } catch {
        worker.postMessage({
          type: "result",
          id,
          success,
          error: error || "",
          result: success ? successPayload() : null,
        });
      }
      return;
    }
    if (fallback) fallback.result(id, success, error, payload.result);
  }

  function FallbackQueue() {
    this.queue = [];
    this.inflight = null;
  }

  FallbackQueue.prototype.size = function () {
    return this.queue.length + (this.inflight ? 1 : 0);
  };

  FallbackQueue.prototype.enqueue = function (job) {
    this.queue.push(job);
    handleWorkerMessage({ type: "queued", id: job.id, size: this.size() });
    this.pump();
  };

  FallbackQueue.prototype.result = function (id, success, error, result) {
    if (!this.inflight || this.inflight.id !== id) return;
    this.inflight = null;
    handleWorkerMessage({
      type: success ? "done" : "failed",
      id,
      error,
      result,
      size: this.size(),
    });
    this.pump();
  };

  FallbackQueue.prototype.pump = function () {
    if (this.inflight) return;
    if (!this.queue.length) {
      handleWorkerMessage({ type: "idle", size: 0 });
      return;
    }
    this.inflight = this.queue.shift();
    const job = this.inflight;
    setTimeout(() => {
      handleWorkerMessage({
        type: "process",
        id: job.id,
        op: job.op,
        size: this.size(),
      });
    }, 0);
  };

  function startWorker() {
    try {
      const url = new URL("js/chain-worker.js", document.baseURI || location.href);
      worker = new Worker(url.href);
      worker.onmessage = (event) => handleWorkerMessage(event.data);
      worker.onerror = () => {
        if (worker) {
          try {
            worker.terminate();
          } catch {
            /* ignore */
          }
          worker = null;
        }
        if (!fallback) fallback = new FallbackQueue();
      };
    } catch {
      worker = null;
      fallback = new FallbackQueue();
    }
  }

  function enqueue(op) {
    if (!op || typeof op !== "object") {
      return {
        id: null,
        promise: Promise.reject(new Error("Invalid blockchain operation.")),
      };
    }
    const id = nextId();
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, op });
    });
    if (worker) {
      worker.postMessage({ type: "enqueue", id, op });
    } else {
      if (!fallback) fallback = new FallbackQueue();
      fallback.enqueue({ id, op });
    }
    return { id, promise };
  }

  function vote({ voter, author, permlink, weight }) {
    const w = Math.max(-10000, Math.min(10000, Math.round(Number(weight) || 0)));
    return enqueue({
      username: voter,
      key: "Posting",
      operations: [
        [
          "vote",
          {
            voter,
            author,
            permlink,
            weight: w,
          },
        ],
      ],
      meta: { type: "vote", author, permlink, weight: w },
    });
  }

  function comment({
    author,
    parentAuthor,
    parentPermlink,
    permlink,
    title,
    body,
    jsonMetadata,
  }) {
    const meta =
      typeof jsonMetadata === "string"
        ? jsonMetadata
        : JSON.stringify(jsonMetadata || {});
    return enqueue({
      username: author,
      key: "Posting",
      operations: [
        [
          "comment",
          {
            parent_author: parentAuthor || "",
            parent_permlink: parentPermlink,
            author,
            permlink,
            title: title || "",
            body,
            json_metadata: meta,
          },
        ],
      ],
      meta: {
        type: "comment",
        author,
        permlink,
        parentAuthor: parentAuthor || "",
        parentPermlink,
      },
    });
  }

  function subscribe(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function size() {
    return queueSize;
  }

  startWorker();

  global.ChainQueue = {
    enqueue,
    vote,
    comment,
    subscribe,
    size,
  };
})(window);
