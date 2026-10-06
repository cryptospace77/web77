/**
 * Hive Bridge JSON-RPC client with public-node failover.
 */
(function (global) {
  "use strict";

  const RPC_TIMEOUT_MS = 45000;
  const NODE_TEST_TIMEOUT_MS = 12000;
  const PAGE_SIZE = 20;
  const NODE_STORAGE_KEY = "cs77_hive_node";
  const CUSTOM_NODES_KEY = "cs77_hive_custom_nodes";
  const CUSTOM_NODE_LIMIT = 8;

  // Hive public nodes
  const FALLBACK_NODES = [
    "https://api.hive.blog",
    "https://api.openhive.network",
    "https://api.c0ff33a.uk",
    "https://api.deathwing.me",
    "https://rpc.mahdiyari.info",
    "https://api.syncad.com",
    "https://techcoderx.com",
  ];
  
  function parseNodeInput(input) {
    const raw = String(input || "").trim();
    if (!raw) return { url: "", error: "Enter a Hive API server." };
    let withScheme = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withScheme)) withScheme = "https://" + withScheme;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch {
      return { url: "", error: "Enter a Hive API address, like https://api.hive.blog." };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { url: "", error: "Use an http or https address." };
    }
    if (parsed.username || parsed.password) {
      return { url: "", error: "Leave the username and password off the address." };
    }
    if (!parsed.hostname) {
      return { url: "", error: "Enter a Hive API address, like https://api.hive.blog." };
    }
    parsed.hash = "";
    parsed.search = "";
    return { url: parsed.toString().replace(/\/+$/, ""), error: "" };
  }

  function readCustomNodes() {
    try {
      const raw = localStorage.getItem(CUSTOM_NODES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      const seen = new Set(FALLBACK_NODES);
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const parsed = parseNodeInput(list[i]);
        if (!parsed.url || seen.has(parsed.url)) continue;
        seen.add(parsed.url);
        out.push(parsed.url);
      }
      return out;
    } catch {
      return [];
    }
  }

  function writeCustomNodes(list) {
    try {
      localStorage.setItem(CUSTOM_NODES_KEY, JSON.stringify(list));
    } catch {
      /* private mode / quota */
    }
  }

  function readStoredNode() {
    let raw = "";
    try {
      raw = localStorage.getItem(NODE_STORAGE_KEY) || "";
    } catch {
      return "";
    }
    const parsed = parseNodeInput(raw);
    if (!parsed.url) return "";
    if (FALLBACK_NODES.includes(parsed.url)) return parsed.url;
    const customs = readCustomNodes();
    if (!customs.includes(parsed.url)) {
      customs.push(parsed.url);
      writeCustomNodes(customs.slice(-CUSTOM_NODE_LIMIT));
    }
    return parsed.url;
  }

  function writeStoredNode(url) {
    try {
      localStorage.setItem(NODE_STORAGE_KEY, url);
    } catch {
      /* private mode / quota */
    }
  }

  let activeNode = readStoredNode() || FALLBACK_NODES[0];

  function getKnownNodes() {
    return FALLBACK_NODES.concat(readCustomNodes());
  }

  function setActiveNode(url) {
    const parsed = parseNodeInput(url);
    if (!parsed.url) return false;
    if (!FALLBACK_NODES.includes(parsed.url) && !readCustomNodes().includes(parsed.url)) {
      return false;
    }
    activeNode = parsed.url;
    writeStoredNode(parsed.url);
    return true;
  }

  function saveCustomNode(url) {
    const parsed = parseNodeInput(url);
    if (!parsed.url) return false;
    if (!FALLBACK_NODES.includes(parsed.url)) {
      const customs = readCustomNodes().filter((item) => item !== parsed.url);
      customs.push(parsed.url);
      writeCustomNodes(customs.slice(-CUSTOM_NODE_LIMIT));
    }
    return setActiveNode(parsed.url);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function nodeList() {
    return [...new Set([activeNode, ...FALLBACK_NODES])];
  }

  function isNetworkError(err) {
    const msg = (err && err.message) || String(err);
    return (
      err instanceof TypeError ||
      /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
    );
  }

  function isRetryableRpcError(err) {
    const msg = (err && err.message) || String(err);
    return (
      isNetworkError(err) ||
      /timed out|HTTP 5\d\d|HTTP 429|HTTP 408|HTTP 400|ECONN|ENOTFOUND|fetch/i.test(msg)
    );
  }

  function hostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // JSON.stringify cannot carry a uint64. Wallet history sets bit 63.
  function rpcBody(value) {
    return JSON.stringify(value, function (_key, item) {
      if (typeof item === "bigint") return "UINT64:" + item.toString();
      return item;
    }).replace(/"UINT64:(-?\d+)"/g, "$1");
  }

  async function hiveRpcOnce(node, method, params, timeoutMs) {
    const timeout = Math.max(1000, timeoutMs || RPC_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const payload = { jsonrpc: "2.0", method, params, id: 1 };

    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rpcBody(payload),
        signal: controller.signal,
        mode: "cors",
        cache: "no-store",
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON */
      }

      if (!res.ok) {
        const detail =
          (data && data.error && (data.error.message || JSON.stringify(data.error))) ||
          text.slice(0, 200) ||
          res.statusText ||
          "Bad Request";
        throw new Error(`Node HTTP ${res.status}: ${detail}`);
      }
      if (!data) throw new Error("Empty or invalid JSON from node");
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      return data.result;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function friendlyNodeError(err) {
    const msg = (err && err.message) || String(err);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      return "The browser could not reach that server. It may be offline, or it may be blocking this site.";
    }
    if (/timed out/i.test(msg)) return "That server did not answer in time.";
    return msg;
  }

  async function testNode(url) {
    const parsed = parseNodeInput(url);
    if (!parsed.url) throw new Error(parsed.error);
    let props;
    try {
      props = await hiveRpcOnce(
        parsed.url,
        "condenser_api.get_dynamic_global_properties",
        [],
        NODE_TEST_TIMEOUT_MS
      );
    } catch (err) {
      throw new Error(friendlyNodeError(err));
    }
    const head = Number(props && props.head_block_number);
    if (!Number.isFinite(head) || head < 1) {
      throw new Error("That server did not answer as a Hive API.");
    }
    try {
      const posts = await hiveRpcOnce(
        parsed.url,
        "bridge.get_ranked_posts",
        { sort: "created", tag: "", limit: 1, observer: "" },
        NODE_TEST_TIMEOUT_MS
      );
      if (!Array.isArray(posts)) {
        throw new Error("That server does not support the Hive bridge API.");
      }
    } catch (err) {
      if (err && err.message === "That server does not support the Hive bridge API.") throw err;
      throw new Error("That server does not support the Hive bridge API.");
    }
    return parsed.url;
  }

  async function hiveRpc(method, params) {
    const nodes = nodeList();
    let lastErr;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      try {
        const result = await hiveRpcOnce(node, method, params);
        activeNode = node;
        return result;
      } catch (err) {
        lastErr = err;
        if (!isRetryableRpcError(err) || i === nodes.length - 1) {
          if (isNetworkError(err)) {
            throw new Error(
              `Failed to reach ${hostname(node)}. ` +
                (location.protocol === "file:"
                  ? "This browser blocked the Hive API from a local file page."
                  : "A Hive API node is unreachable.")
            );
          }
          throw err;
        }
        await sleep(120);
      }
    }

    throw lastErr || new Error("All Hive API nodes failed.");
  }

  function getActiveNode() {
    return activeNode;
  }

  function getActiveHost() {
    return hostname(activeNode);
  }

  async function getRankedPosts({ sort, tag, limit, startAuthor, startPermlink, observer }) {
    if (sort == "latest") sort="created";
    const params = {
      sort: sort || "created",
      tag: tag || "",
      limit: Math.min(Math.max(limit || PAGE_SIZE, 1), PAGE_SIZE),
      observer: observer || "",
    };
    if (startAuthor && startPermlink) {
      params.start_author = startAuthor;
      params.start_permlink = startPermlink;
    }
    const result = await hiveRpc("bridge.get_ranked_posts", params);
    return Array.isArray(result) ? result : [];
  }

  async function getDiscussion(author, permlink, observer) {
    const result = await hiveRpc("bridge.get_discussion", {
      author,
      permlink,
      observer: observer || "",
    });
    return result && typeof result === "object" ? result : {};
  }

  async function getPost(author, permlink) {
    const a = String(author || "")
      .trim()
      .replace(/^@/, "");
    const p = String(permlink || "").trim();
    if (!a || !p) return null;
    const result = await hiveRpc("bridge.get_post", {
      author: a,
      permlink: p,
      observer: "",
    });
    return result && typeof result === "object" ? result : null;
  }

  async function getAccountPosts({ account, sort, limit, startAuthor, startPermlink, observer }) {
    const params = {
      account,
      sort: sort || "posts",
      limit: Math.min(Math.max(limit || PAGE_SIZE, 1), PAGE_SIZE),
      observer: observer || "",
    };
    if (startAuthor && startPermlink) {
      params.start_author = startAuthor;
      params.start_permlink = startPermlink;
    }
    const result = await hiveRpc("bridge.get_account_posts", params);
    return Array.isArray(result) ? result : [];
  }

  async function getProfile(account, observer) {
    return hiveRpc("bridge.get_profile", {
      account,
      observer: observer || "",
    });
  }

  function normalizeSubscription(row) {
    if (Array.isArray(row)) {
      return {
        name: String(row[0] || ""),
        title: String(row[1] || row[0] || ""),
        role: String(row[2] || ""),
      };
    }
    if (row && typeof row === "object") {
      return {
        name: String(row.name || row.id || ""),
        title: String(row.title || row.name || ""),
        role: String(row.role || ""),
      };
    }
    return { name: "", title: "", role: "" };
  }

  async function listAllSubscriptions(account) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return [];
    const result = await hiveRpc("bridge.list_all_subscriptions", { account: name });
    const list = Array.isArray(result) ? result : [];
    return list
      .map(normalizeSubscription)
      .filter((row) => /^hive-\d+$/i.test(row.name));
  }

  function isCommunityName(raw) {
    return /^hive-\d+$/i.test(String(raw || "").trim());
  }

  function normalizeCommunityAccount(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    return isCommunityName(name) ? name : "";
  }

  function normalizeSubscriber(row) {
    if (Array.isArray(row)) {
      return {
        name: String(row[0] || ""),
        role: String(row[1] || ""),
        title: String(row[2] || ""),
        created: String(row[3] || ""),
      };
    }
    if (row && typeof row === "object") {
      return {
        name: String(row.name || row.account || ""),
        role: String(row.role || ""),
        title: String(row.title || ""),
        created: String(row.created_at || row.created || ""),
      };
    }
    return { name: "", role: "", title: "", created: "" };
  }

  async function getCommunity(name, observer) {
    const id = normalizeCommunityAccount(name);
    if (!id) return null;
    const result = await hiveRpc("bridge.get_community", {
      name: id,
      observer: observer || "",
    });
    return result && typeof result === "object" ? result : null;
  }

  async function listSubscribers(community, last, limit) {
    const id = normalizeCommunityAccount(community);
    if (!id) return [];
    const params = {
      community: id,
      limit: Math.min(Math.max(limit || PAGE_SIZE, 1), 100),
    };
    if (last) params.last = last;
    const result = await hiveRpc("bridge.list_subscribers", params);
    const list = Array.isArray(result) ? result : [];
    return list.map(normalizeSubscriber).filter((row) => row.name);
  }

  async function listCommunities({ last, limit, query, sort, observer } = {}) {
    const params = {
      limit: Math.min(Math.max(limit || PAGE_SIZE, 1), 100),
      sort: sort || "rank",
      observer: observer || "",
    };
    const q = String(query || "").trim();
    if (q) params.query = q;
    const lastName = String(last || "").trim();
    if (lastName) params.last = lastName;
    const result = await hiveRpc("bridge.list_communities", params);
    return Array.isArray(result) ? result : [];
  }

  function parseAsset(val) {
    if (typeof val === "number") return val;
    if (!val) return 0;
    const m = String(val).match(/-?[\d.]+/);
    return m ? Number(m[0]) : 0;
  }

  async function getAccounts(names) {
    const list = Array.isArray(names) ? names : [names];
    const result = await hiveRpc("condenser_api.get_accounts", [list]);
    return Array.isArray(result) ? result : [];
  }

  async function getDynamicGlobalProperties() {
    return hiveRpc("condenser_api.get_dynamic_global_properties", []);
  }

  async function unreadNotifications(account, minScore) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return { unread: 0, lastread: "" };
    const result = await hiveRpc("bridge.unread_notifications", {
      account: name,
      min_score: minScore == null ? 0 : minScore,
    });
    if (!result || typeof result !== "object") return { unread: 0, lastread: "" };
    return {
      unread: Number(result.unread) || 0,
      lastread: result.lastread || "",
    };
  }

  async function accountNotifications(account, opts) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return [];
    const options = opts || {};
    const params = {
      account: name,
      limit: Math.min(Math.max(options.limit || 20, 1), 100),
      min_score: options.minScore == null ? 0 : options.minScore,
    };
    if (options.lastId) params.last_id = String(options.lastId);
    const result = await hiveRpc("bridge.account_notifications", params);
    return Array.isArray(result) ? result : [];
  }

  async function getActiveVotes(author, permlink) {
    const a = String(author || "")
      .trim()
      .replace(/^@/, "");
    const p = String(permlink || "").trim();
    if (!a || !p) return [];
    const result = await hiveRpc("condenser_api.get_active_votes", [a, p]);
    return Array.isArray(result) ? result : [];
  }

  // Hivemind serves this list (same backend as bridge). bridge.get_reblogged_by is not registered.
  async function getRebloggedBy(author, permlink) {
    const a = String(author || "")
      .trim()
      .replace(/^@/, "");
    const p = String(permlink || "").trim();
    if (!a || !p) return [];
    const result = await hiveRpc("condenser_api.get_reblogged_by", [a, p]);
    if (!Array.isArray(result)) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < result.length; i++) {
      const name = String(result[i] || "")
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }

  async function getContent(author, permlink) {
    const a = String(author || "")
      .trim()
      .replace(/^@/, "");
    const p = String(permlink || "").trim();
    if (!a || !p) return null;
    const result = await hiveRpc("condenser_api.get_content", [a, p]);
    return result && typeof result === "object" ? result : null;
  }

  async function getRewardFund() {
    return hiveRpc("condenser_api.get_reward_fund", ["post"]);
  }

  async function getMedianHistoryPrice() {
    return hiveRpc("condenser_api.get_current_median_history_price", []);
  }

  const VOTE_MANA_REGEN_SECONDS = 5 * 24 * 60 * 60;
  const VOTE_DUST_RSHARES = 50000000n;

  function vestMicrosBig(value) {
    if (typeof value === "bigint") return value;
    const s = String(value == null ? "" : value).trim();
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0n;
    const neg = m[0].startsWith("-");
    const body = neg ? m[0].slice(1) : m[0];
    const parts = body.split(".");
    const whole = parts[0] || "0";
    let frac = parts[1] || "";
    if (frac.length > 6) frac = frac.slice(0, 6);
    while (frac.length < 6) frac += "0";
    const n = BigInt(whole + frac);
    return neg ? -n : n;
  }

  function estimateVoteRshares(account, props, weight) {
    const w = Math.round(Number(weight) || 0);
    if (!w || !account || !props) return 0;
    let vests =
      vestMicrosBig(account.vesting_shares) +
      vestMicrosBig(account.received_vesting_shares) -
      vestMicrosBig(account.delegated_vesting_shares);
    if (vests < 0n) vests = 0n;
    if (vests === 0n) return 0;
    const absWeight = BigInt(Math.min(10000, Math.abs(w)));
    const reserve = BigInt(Math.round(Number(props.vote_power_reserve_rate) || 10));
    const maxVoteDenom = reserve * BigInt(VOTE_MANA_REGEN_SECONDS);
    if (maxVoteDenom <= 0n) return 0;
    const raw = (vests * absWeight * 86400n) / 10000n;
    let used = (raw + maxVoteDenom - 1n) / maxVoteDenom;
    if (used > VOTE_DUST_RSHARES) used -= VOTE_DUST_RSHARES;
    else used = 0n;
    const n = Number(used);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return w < 0 ? -n : n;
  }

  function hbdPerHivePrice(price) {
    const base = parseAsset(price && price.base);
    const quote = parseAsset(price && price.quote);
    if (!base || !quote) return 0;
    return base / quote;
  }

  function rsharesToHbd(rshares, fund, price) {
    const recent = Number(fund && fund.recent_claims);
    const reward = parseAsset(fund && fund.reward_balance);
    const rate = hbdPerHivePrice(price);
    const rs = Number(rshares);
    if (!recent || !reward || !rate || !rs) return 0;
    return (rs * reward * rate) / recent;
  }

  function intBig(value) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return 0n;
      return BigInt(Math.trunc(value));
    }
    const s = String(value == null ? "" : value).trim();
    if (!s) return 0n;
    if (/e/i.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return 0n;
      return BigInt(Math.trunc(n));
    }
    const m = s.match(/-?\d+/);
    if (!m) return 0n;
    try {
      return BigInt(m[0]);
    } catch {
      return 0n;
    }
  }

  function effectiveVestMicros(account) {
    if (!account) return 0n;
    let vests =
      vestMicrosBig(account.vesting_shares) +
      vestMicrosBig(account.received_vesting_shares) -
      vestMicrosBig(account.delegated_vesting_shares);
    if (vests < 0n) vests = 0n;
    return vests;
  }

  function manabarPercent(bar, maxMana, nowSec) {
    if (maxMana <= 0n) return 0;
    let current = intBig(bar && bar.current_mana);
    const last = Number(bar && bar.last_update_time) || 0;
    const now = Number(nowSec) || 0;
    const elapsed = now > last ? now - last : 0;
    const regen = BigInt(VOTE_MANA_REGEN_SECONDS);
    if (elapsed > 0) current += (BigInt(elapsed) * maxMana) / regen;
    if (current < 0n) current = 0n;
    if (current > maxMana) current = maxMana;
    const pct = Number((current * 100n + maxMana / 2n) / maxMana);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    if (pct >= 100) return 100;
    return pct;
  }

  function accountName(username) {
    return String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  async function findRcAccount(username) {
    const name = accountName(username);
    if (!name) return null;
    const result = await hiveRpc("rc_api.find_rc_accounts", { accounts: [name] });
    const list = result && result.rc_accounts;
    return Array.isArray(list) && list.length ? list[0] : null;
  }

  async function getAccountReputation(username) {
    const name = accountName(username);
    if (!name) return null;
    // get_accounts leaves reputation at 0. This returns accounts from the
    // lower bound, so the row has to be the requested account.
    const result = await hiveRpc("condenser_api.get_account_reputations", [name, 1]);
    const row = Array.isArray(result) ? result[0] : null;
    if (!row || accountName(row.account) !== name) return null;
    if (row.reputation == null || row.reputation === "") return null;
    return row.reputation;
  }

  async function getAccountResources(username) {
    const name = accountName(username);
    if (!name) return null;
    const now = Math.floor(Date.now() / 1000);
    const [accounts, props, fund, price, rcAccount, reputation] = await Promise.all([
      getAccounts([name]),
      getDynamicGlobalProperties(),
      getRewardFund(),
      getMedianHistoryPrice(),
      findRcAccount(name).catch(() => null),
      getAccountReputation(name).catch(() => null),
    ]);
    const account = accounts && accounts[0];
    if (!account || !props) return null;
    if (reputation != null) account.reputation = reputation;
    // A full upvote. HF28 prices rshares from vesting shares, not leftover mana.
    const rshares = estimateVoteRshares(account, props, 10000);
    const rcMax = rcAccount ? intBig(rcAccount.max_rc) : 0n;
    return {
      account,
      props,
      votingMana: manabarPercent(account.voting_manabar, effectiveVestMicros(account), now),
      voteValue: rsharesToHbd(rshares, fund, price),
      rc: rcAccount ? manabarPercent(rcAccount.rc_manabar, rcMax, now) : null,
    };
  }

  function fundHive(props) {
    if (!props) return 0;
    return (
      parseAsset(props.total_vesting_fund_hive) ||
      parseAsset(props.total_vesting_fund)
    );
  }

  function vestsToHive(vests, props) {
    const totalVests = parseAsset(props && props.total_vesting_shares);
    const totalHive = fundHive(props);
    if (!totalVests || !totalHive) return 0;
    return (parseAsset(vests) * totalHive) / totalVests;
  }

  function hiveToVests(hive, props) {
    const totalVests = parseAsset(props && props.total_vesting_shares);
    const totalHive = fundHive(props);
    if (!totalVests || !totalHive) return 0;
    return (parseAsset(hive) * totalVests) / totalHive;
  }

  function parseVestUnits(val) {
    if (val == null || val === "") return 0;
    if (typeof val === "number") {
      if (!Number.isFinite(val)) return 0;
      if (Number.isInteger(val) && Math.abs(val) >= 1e6) return val / 1e6;
      return val;
    }
    const s = String(val).trim();
    if (!s) return 0;
    if (/vests/i.test(s)) return parseAsset(s);
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    if (Number.isInteger(n) && Math.abs(n) >= 1e6) return n / 1e6;
    return n;
  }

  async function getHivePower(username) {
    const name = String(username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return 0;
    const [accounts, props] = await Promise.all([
      getAccounts([name]),
      getDynamicGlobalProperties(),
    ]);
    const account = accounts[0];
    if (!account || !props) return 0;
    const vests =
      parseAsset(account.vesting_shares) +
      parseAsset(account.received_vesting_shares) -
      parseAsset(account.delegated_vesting_shares);
    return vestsToHive(vests, props);
  }

  function walletFromAccount(account, props) {
    if (!account || !props) return null;
    const name = accountName(account.name);
    if (!name) return null;
    const vestingShares = parseAsset(account.vesting_shares);
    const delegatedVests = parseAsset(account.delegated_vesting_shares);
    const receivedVests = parseAsset(account.received_vesting_shares);
    const rewardVests = parseAsset(account.reward_vesting_balance);
    return {
      name,
      account,
      props,
      hive: parseAsset(account.balance),
      hbd: parseAsset(account.hbd_balance),
      stakedHive: vestsToHive(vestingShares, props),
      delegatedHive: vestsToHive(delegatedVests, props),
      receivedHive: vestsToHive(receivedVests, props),
      stakedHbd: parseAsset(account.savings_hbd_balance),
      savingsHive: parseAsset(account.savings_balance),
      rewardHive: parseAsset(account.reward_hive_balance),
      rewardHbd: parseAsset(account.reward_hbd_balance),
      rewardVests,
      rewardVestingHive:
        parseAsset(account.reward_vesting_hive) || vestsToHive(rewardVests, props),
      vestingShares,
      delegatedVests,
      receivedVests,
      availableVests: Math.max(0, vestingShares - delegatedVests),
      toWithdrawVests: parseVestUnits(account.to_withdraw),
      withdrawnVests: parseVestUnits(account.withdrawn),
      withdrawRate: parseAsset(account.vesting_withdraw_rate),
      nextWithdrawal: account.next_vesting_withdrawal || "",
      rewardHiveStr: account.reward_hive_balance || "0.000 HIVE",
      rewardHbdStr: account.reward_hbd_balance || "0.000 HBD",
      rewardVestsStr: account.reward_vesting_balance || "0.000000 VESTS",
      hiveStr: account.balance || "0.000 HIVE",
      hbdStr: account.hbd_balance || "0.000 HBD",
    };
  }

  async function getWallet(username) {
    const name = accountName(username);
    if (!name) return null;
    const [accounts, props] = await Promise.all([
      getAccounts([name]),
      getDynamicGlobalProperties(),
    ]);
    const account = accounts && accounts[0];
    if (!account || !props) return null;
    return walletFromAccount(account, props);
  }

  async function getAccountHistory(account, start, limit) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return [];
    const from = start == null ? -1 : start;
    const lim = Math.min(Math.max(limit || 100, 1), 1000);
    const result = await hiveRpc("condenser_api.get_account_history", [name, from, lim]);
    return Array.isArray(result) ? result : [];
  }

  // Bit index is the operation's place in hive/protocol/operations.hpp.
  // Same set as WALLET_TX_TYPES in app.js. author_reward and curation_reward stay out.
  const WALLET_HISTORY_OP_IDS = [
    2, // transfer
    3, // transfer_to_vesting
    4, // withdraw_vesting
    32, // transfer_to_savings
    33, // transfer_from_savings
    39, // claim_reward_balance
    40, // delegate_vesting_shares
    55, // interest
    56, // fill_vesting_withdraw
    59, // fill_transfer_from_savings
    63, // comment_benefactor_reward
  ];

  const ASSET_NAI = {
    "@@000000013": "HBD",
    "@@000000021": "HIVE",
    "@@000000037": "VESTS",
  };

  function walletHistoryMask() {
    let low = 0n;
    let high = 0n;
    for (let i = 0; i < WALLET_HISTORY_OP_IDS.length; i++) {
      const id = WALLET_HISTORY_OP_IDS[i];
      if (id < 64) low |= 1n << BigInt(id);
      else high |= 1n << BigInt(id - 64);
    }
    return { low: low, high: high };
  }

  function legacyAsset(val) {
    if (!val || typeof val !== "object" || typeof val.nai !== "string" || val.amount == null) return null;
    const sym = ASSET_NAI[val.nai];
    if (!sym) return null;
    const precision = Number(val.precision);
    const places = Number.isFinite(precision) && precision >= 0 ? precision : 3;
    const raw = String(val.amount);
    const neg = raw.charAt(0) === "-";
    const digits = neg ? raw.slice(1) : raw;
    if (!/^\d+$/.test(digits)) return null;
    const padded = places > 0 ? digits.padStart(places + 1, "0") : digits;
    const whole = places > 0 ? padded.slice(0, -places) : padded;
    const frac = places > 0 ? padded.slice(-places) : "";
    return (neg ? "-" : "") + whole + (frac ? "." + frac : "") + " " + sym;
  }

  function legacyValue(value) {
    if (Array.isArray(value)) return value.map(legacyValue);
    const asset = legacyAsset(value);
    if (asset) return asset;
    if (!value || typeof value !== "object") return value;
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = legacyValue(value[keys[i]]);
    return out;
  }

  function normalizeHistoryEntry(row) {
    if (!Array.isArray(row) || !row[1] || typeof row[1] !== "object") return null;
    const rec = row[1];
    const op = rec.op;
    let type = "";
    let payload = {};
    if (Array.isArray(op)) {
      type = String(op[0] || "");
      payload = op[1] && typeof op[1] === "object" ? op[1] : {};
    } else if (op && typeof op.type === "string") {
      type = op.type.replace(/_operation$/, "");
      payload = op.value && typeof op.value === "object" ? op.value : {};
    } else {
      return null;
    }
    const idx = Number(row[0]);
    if (!Number.isFinite(idx)) return null;
    return [
      idx,
      {
        trx_id: rec.trx_id || "",
        block: rec.block,
        trx_in_block: rec.trx_in_block,
        op_in_trx: rec.op_in_trx,
        virtual_op: rec.virtual_op,
        timestamp: rec.timestamp || "",
        op: [type, legacyValue(payload)],
      },
    ];
  }

  function historyRows(result) {
    let rows = [];
    if (Array.isArray(result)) rows = result;
    else if (result && Array.isArray(result.history)) rows = result.history;
    else if (result && result.history && typeof result.history === "object") {
      rows = Object.keys(result.history).map(function (key) {
        return [Number(key), result.history[key]];
      });
    }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const entry = normalizeHistoryEntry(rows[i]);
      if (entry) out.push(entry);
    }
    out.sort(function (a, b) {
      return a[0] - b[0];
    });
    return out;
  }

  async function getWalletHistory(account, start, limit) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return [];
    const from = start == null ? -1 : start;
    const lim = Math.min(Math.max(limit || 100, 1), 1000);
    const mask = walletHistoryMask();
    const result = await hiveRpc("account_history_api.get_account_history", {
      account: name,
      start: from,
      limit: lim,
      operation_filter_low: mask.low,
      operation_filter_high: mask.high,
    });
    return historyRows(result);
  }

  async function getSavingsWithdrawFrom(account) {
    const name = String(account || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return [];
    const result = await hiveRpc("condenser_api.get_savings_withdraw_from", [name]);
    return Array.isArray(result) ? result : [];
  }

  global.HiveApi = {
    PAGE_SIZE,
    hiveRpc,
    getNodes: nodeList,
    getKnownNodes,
    setActiveNode,
    testNode,
    saveCustomNode,
    getRankedPosts,
    getDiscussion,
    getPost,
    getAccountPosts,
    getProfile,
    listAllSubscriptions,
    isCommunityName,
    getCommunity,
    listSubscribers,
    listCommunities,
    unreadNotifications,
    accountNotifications,
    getAccounts,
    getDynamicGlobalProperties,
    getActiveVotes,
    getRebloggedBy,
    getContent,
    getRewardFund,
    getMedianHistoryPrice,
    estimateVoteRshares,
    rsharesToHbd,
    getAccountResources,
    getHivePower,
    walletFromAccount,
    getWallet,
    getAccountHistory,
    getWalletHistory,
    getSavingsWithdrawFrom,
    parseAsset,
    vestsToHive,
    hiveToVests,
    getActiveNode,
    getActiveHost,
  };
})(window);
