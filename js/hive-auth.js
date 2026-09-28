/**
 * Posting-key login. The Hive WIF is wrapped with a non-extractable
 * AES-GCM CryptoKey and stored in IndexedDB, then used to sign Hive calls.
 */
(function (global) {
  "use strict";

  const DB_NAME = "cs77-auth";
  const DB_VERSION = 1;
  const STORE = "keys";
  const RECORD_ID = "posting";
  const HIVE_TX_URL = "https://cdn.jsdelivr.net/npm/hive-tx@7.2/dist/index.mjs";

  let sessionBytes = null;
  let sessionUser = "";
  let hiveTxMod = null;
  let hiveTxPromise = null;
  let readyPromise = null;

  function wipe(bytes) {
    if (bytes && bytes.fill) bytes.fill(0);
  }

  function unlockMemory(username, bytes) {
    wipe(sessionBytes);
    sessionBytes = bytes;
    sessionUser = String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function lockMemory() {
    wipe(sessionBytes);
    sessionBytes = null;
    sessionUser = "";
  }

  function hasSubtle() {
    return Boolean(global.crypto && crypto.subtle);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB could not be opened."));
    });
  }

  function idbRequest(mode, fn) {
    return openDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let req;
        try {
          req = fn(tx.objectStore(STORE));
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction failed."));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction aborted."));
        };
      });
    });
  }

  function idbGet() {
    return idbRequest("readonly", (store) => store.get(RECORD_ID)).then(
      (record) => record || null
    );
  }

  function idbPut(record) {
    return idbRequest("readwrite", (store) => store.put(record));
  }

  function idbDelete() {
    return idbRequest("readwrite", (store) => store.delete(RECORD_ID));
  }

  async function wrapBytes(bytes) {
    if (!hasSubtle()) {
      throw new Error(
        "This page needs HTTPS or localhost to store a posting key."
      );
    }
    const wrappingKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      bytes
    );
    return { wrappingKey, iv: iv.buffer, ciphertext };
  }

  async function unwrapBytes(record) {
    const ivSrc = record.iv;
    const iv = ivSrc instanceof Uint8Array ? ivSrc : new Uint8Array(ivSrc);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      record.wrappingKey,
      record.ciphertext
    );
    return new Uint8Array(plain);
  }

  function hiveNodes() {
    if (global.HiveApi && typeof HiveApi.getNodes === "function") {
      return HiveApi.getNodes();
    }
    return ["https://api.hive.blog"];
  }

  function loadHiveTx() {
    if (hiveTxMod) return Promise.resolve(hiveTxMod);
    if (!hiveTxPromise) {
      hiveTxPromise = import(HIVE_TX_URL)
        .then((mod) => {
          hiveTxMod = mod;
          if (mod.config && Array.isArray(mod.config.nodes)) {
            const nodes = hiveNodes();
            mod.config.nodes = [...new Set(nodes.concat(mod.config.nodes))];
          }
          return mod;
        })
        .catch((err) => {
          hiveTxPromise = null;
          throw new Error(
            (err && err.message) || "Could not load the Hive signer."
          );
        });
    }
    return hiveTxPromise;
  }

  function postingPubs(account) {
    const auths =
      (account && account.posting && account.posting.key_auths) || [];
    const out = [];
    for (let i = 0; i < auths.length; i++) {
      const row = auths[i];
      const pub = Array.isArray(row) ? row[0] : row && row[0];
      if (pub) out.push(String(pub));
    }
    return out;
  }

  function requireSession(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) {
      throw new Error("No posting key is stored in this browser.");
    }
    if (username && sessionUser !== String(username).toLowerCase().replace(/^@/, "")) {
      throw new Error("Stored posting key belongs to a different account.");
    }
    return sessionBytes;
  }

  function hasKey(username) {
    if (!sessionBytes || sessionBytes.length !== 32 || !sessionUser) return false;
    if (!username) return true;
    return sessionUser === String(username).toLowerCase().replace(/^@/, "");
  }

  async function persist(username, bytes) {
    const wrapped = await wrapBytes(bytes);
    await idbPut({
      id: RECORD_ID,
      username,
      wrappingKey: wrapped.wrappingKey,
      iv: wrapped.iv,
      ciphertext: wrapped.ciphertext,
    });
  }

  async function login(username, wif) {
    const name = String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    const secret = String(wif || "").replace(/\s+/g, "");
    if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
      throw new Error("Enter a valid Hive username.");
    }
    if (!secret) throw new Error("Enter a posting key.");

    const lib = await loadHiveTx();
    let pk;
    try {
      pk = lib.PrivateKey.from(secret);
    } catch {
      throw new Error("That posting key is not valid.");
    }
    const pub = pk.createPublic().toString();
    const bytes = pk.key.slice();
    wipe(pk.key);

    let accounts;
    try {
      accounts = await HiveApi.getAccounts([name]);
    } catch (err) {
      wipe(bytes);
      throw err;
    }
    const account = accounts && accounts[0];
    if (!account) {
      wipe(bytes);
      throw new Error("Unknown Hive account @" + name + ".");
    }
    if (postingPubs(account).indexOf(pub) < 0) {
      wipe(bytes);
      throw new Error("This posting key does not match @" + name + ".");
    }

    try {
      await persist(name, bytes);
    } catch (err) {
      wipe(bytes);
      throw new Error(
        (err && err.message) || "Could not store the posting key in this browser."
      );
    }
    unlockMemory(name, bytes);
    return name;
  }

  async function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      let record;
      try {
        record = await idbGet();
      } catch {
        return;
      }
      if (!record || !record.wrappingKey || !record.ciphertext || !record.username) {
        return;
      }
      try {
        const bytes = await unwrapBytes(record);
        if (!bytes || bytes.length !== 32) {
          wipe(bytes);
          await idbDelete().catch(() => {});
          return;
        }
        unlockMemory(record.username, bytes);
      } catch {
        lockMemory();
        await idbDelete().catch(() => {});
      }
    })();
    return readyPromise;
  }

  function clear() {
    lockMemory();
    return idbDelete().catch(() => {});
  }

  async function signBytes(bytes, username) {
    const lib = await loadHiveTx();
    const keyBytes = requireSession(username);
    const pk = lib.PrivateKey.from(keyBytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sig = pk.sign(digest);
    if (sig && typeof sig.customToString === "function") return sig.customToString();
    if (sig && typeof sig.toString === "function") return sig.toString();
    throw new Error("Could not encode the Hive signature.");
  }

  async function broadcast(username, operations) {
    if (!Array.isArray(operations) || !operations.length) {
      throw new Error("Invalid blockchain operation.");
    }
    const lib = await loadHiveTx();
    const keyBytes = requireSession(username);
    if (lib.config && Array.isArray(lib.config.nodes)) {
      lib.config.nodes = hiveNodes();
    }
    const pk = lib.PrivateKey.from(keyBytes);
    const tx = new lib.Transaction();
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (!Array.isArray(op) || op.length < 2) {
        throw new Error("Invalid blockchain operation.");
      }
      await tx.addOperation(op[0], op[1]);
    }
    tx.sign(pk);
    const result = await tx.broadcast();
    return { success: true, result: result || null };
  }

  global.HiveAuth = {
    ready,
    login,
    clear,
    hasKey,
    user: function () {
      return sessionUser;
    },
    signBytes,
    broadcast,
  };
})(window);
