/**
 * Crypto Space 77 — main javascript for router, feed, post, comments, and pages processing.
 */
(function () {
  "use strict";

  const APP_ID = "cryptospace77.com";
  const APP_VERSION = "0.15";
  const FEED_TARGET = 20;
  const MAX_PAGES_PER_LOAD = 12;
  const SESSION_KEY = "cs77_user";
  const KEYCHAIN_USER_KEY = "cs77_keychain_user";
  const KEYCHAIN_PERSIST_KEY = "cs77_keychain_persist";
  const FEED_VIEW_KEY = "cs77_feed_view";
  const FEED_SORTS = ["feed", "created", "trending", "hot"];
  const VOTE_WEIGHT_KEYS = {
    post: "cs77_vote_weight_post",
    comment: "cs77_vote_weight_comment",
  };
  const DOWNVOTE_WEIGHT_KEYS = {
    post: "cs77_downvote_weight_post",
    comment: "cs77_downvote_weight_comment",
  };
  const VOTE_WEIGHT_KEY_LEGACY = "cs77_vote_weight";
  const HP_SLIDER_THRESHOLD = 500;
  const VOTERS_SHOW = 80;
  const IMAGE_HOST = "https://images.hive.blog";
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_TAGS = 10;
  const FAVORITE_TAGS_KEY = "cs77_favorite_tags";
  const MAX_FAVORITE_TAGS = 40;
  const FAVORITE_COMMUNITIES_KEY = "cs77_favorite_communities";
  const WELCOME_SEEN_KEY = "cs77_welcome_seen";
  const MAX_FAVORITE_COMMUNITIES = 40;
  const PUBLISH_DRAFT_KEY = "cs77_publish_draft";
  const PUBLISH_DRAFT_SAVE_MS = 2000;
  const LOGO_FAVORITES_SHOW = 10;
  const SUGGESTED_TAGS_SHOW = 24;
  const NOTIF_LIMIT = 100;
  const NOTIF_SHOW = 40;
  const NOTIF_POLL_MS = 60000;

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const errorBanner = $("#errorBanner");
  const errorText = $("#errorText");
  const sessionSlot = $("#sessionSlot");
  const overlay = $("#loginOverlay");
  const queueSlot = $("#queueSlot");

  const localVotes = new Map();
  const votesCache = new Map();
  const payoutByKey = new Map();
  const contentByKey = new Map();
  let hivePower = null;
  let hivePowerUser = "";
  let pendingCommentsScroll = false;
  let pendingPublish = false;
  let publishDest = { type: "blog", name: "", title: "My blog" };
  let publishTags = [];
  let publishSubs = [];
  let publishSubsUser = "";
  let lastNonPublishPath = "/";
  let currentViewKey = "";
  let welcomeHold = false;
  let currentPost = null;
  const communityState = {
    name: "",
    info: null,
    subscribed: false,
    pending: false,
  };
  const communityDirState = {
    gen: 0,
    subs: [],
    subsError: "",
    searchQuery: "",
    search: [],
    searchError: "",
    searchLooked: false,
    searchLoading: false,
  };
  const profileState = {
    author: "",
    page: "posts",
    profile: null,
    followed: false,
    pending: false,
    claimPending: false,
    wallet: null,
  };
  const walletOpState = {
    kind: "",
    max: 0,
    symbol: "hive",
    pending: false,
  };
  let publishEdit = null;
  let publishStash = null;
  let publishDraftTimer = 0;
  let publishDraftSaveSoon = 0;
  let notifGen = 0;
  let notifTimer = 0;
  const notifState = {
    user: "",
    unread: 0,
    lastread: "",
    items: [],
    error: "",
    loaded: false,
    markedAt: 0,
  };

  const feedState = {
    sort: "created",
    tag: "",
    items: [],
    seen: new Set(),
    cursor: null,
    loading: false,
    done: false,
  };

  function observer() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  function normalizeLoginUser(name) {
    return String(name || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function validLoginUser(name) {
    return /^[a-z0-9.\-]{3,16}$/.test(name);
  }

  function readKeychainUser() {
    try {
      const name = normalizeLoginUser(localStorage.getItem(KEYCHAIN_USER_KEY));
      return validLoginUser(name) ? name : "";
    } catch {
      return "";
    }
  }

  function keychainPersistStarted() {
    try {
      return localStorage.getItem(KEYCHAIN_PERSIST_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeKeychainUser(username) {
    try {
      localStorage.setItem(KEYCHAIN_USER_KEY, username);
      localStorage.setItem(KEYCHAIN_PERSIST_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clearKeychainUser() {
    try {
      localStorage.removeItem(KEYCHAIN_USER_KEY);
    } catch {
      /* ignore */
    }
  }

  function restoreRememberedSession() {
    const postingUser = (window.HiveAuth && HiveAuth.user()) || "";
    let sessionUser = normalizeLoginUser(sessionStorage.getItem(SESSION_KEY));
    if (!validLoginUser(sessionUser)) sessionUser = "";
    if (!sessionUser) {
      const user = postingUser || readKeychainUser();
      if (user) sessionStorage.setItem(SESSION_KEY, user);
      return;
    }
    // Remember a Keychain username already held by this tab. The marker survives logout,
    // so a stale tab cannot write that username back.
    if (!postingUser && !keychainPersistStarted()) writeKeychainUser(sessionUser);
  }

  function hasSigner(username) {
    const user = username || observer();
    if (window.HiveAuth && HiveAuth.hasKey(user)) return true;
    return Boolean(window.hive_keychain);
  }

  function signerNeededMessage() {
    return "Connect with Hive Keychain or a posting key to continue.";
  }

  function signingLabel(kind) {
    if (window.HiveAuth && HiveAuth.hasKey(observer())) {
      return kind === "image" ? "Signing image…" : "Signing…";
    }
    return kind === "image"
      ? "Waiting for Keychain to sign image…"
      : "Waiting for Keychain…";
  }

  function isOwnAuthor(author) {
    const user = observer();
    return Boolean(user && author && user === String(author).toLowerCase());
  }

  function nodeMenuLabel(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+$/, "");
      return parsed.host + (path && path !== "/" ? path : "");
    } catch {
      return url;
    }
  }

  function setNodeLabel() {
    const active = HiveApi.getActiveNode();
    const label = nodeMenuLabel(active);
    document.querySelectorAll(".status-pill").forEach((el) => {
      el.title = active;
    });
    document.querySelectorAll(".status-pill .node-label").forEach((el) => {
      el.textContent = label;
    });
    document.querySelectorAll(".node-option").forEach((el) => {
      if (el.classList.contains("node-option-custom")) return;
      const selected = el.getAttribute("data-node") === active;
      el.classList.toggle("is-active", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  function closeNodeMenus() {
    document.querySelectorAll(".node-menu.is-open").forEach((menu) => {
      menu.classList.remove("is-open");
      const trigger = menu.querySelector(".status-pill");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function paintNodeMenus() {
    const nodes = HiveApi.getKnownNodes ? HiveApi.getKnownNodes() : [];
    const active = HiveApi.getActiveNode();
    const options = nodes
      .map((url) => {
        const selected = url === active;
        const host = HiveMd.escapeHtml(nodeMenuLabel(url));
        const href = HiveMd.escapeHtml(url);
        return (
          `<button type="button" class="node-option${selected ? " is-active" : ""}" role="option" aria-selected="${selected ? "true" : "false"}" data-node="${href}" title="${href}">` +
          host +
          `</button>`
        );
      })
      .join("");
    const custom =
      `<button type="button" class="node-option node-option-custom" aria-haspopup="dialog">custom…</button>`;
    document.querySelectorAll(".node-dropdown-panel").forEach((panel) => {
      panel.innerHTML = options + custom;
    });
  }

  let nodeTestToken = 0;

  function nodeOverlayOpen() {
    const el = $("#nodeOverlay");
    return Boolean(el && !el.hidden);
  }

  function setNodeStatus(msg, isError) {
    const el = $("#nodeStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError && msg));
  }

  function resetNodeForm() {
    const button = $("#nodeTest");
    const input = $("#nodeServer");
    if (button) button.disabled = false;
    if (input) input.disabled = false;
  }

  function hideNodeOverlay() {
    const el = $("#nodeOverlay");
    if (el) el.hidden = true;
    resetNodeForm();
  }

  function closeNodeOverlay() {
    nodeTestToken += 1;
    hideNodeOverlay();
    setNodeStatus("");
  }

  function openNodeOverlay() {
    const el = $("#nodeOverlay");
    if (!el) return;
    closeLogoMenu();
    el.hidden = false;
    setNodeStatus("");
    resetNodeForm();
    const input = $("#nodeServer");
    if (input) {
      input.focus();
      input.select();
    }
  }

  async function submitCustomNode() {
    if (!nodeOverlayOpen()) return;
    const button = $("#nodeTest");
    const input = $("#nodeServer");
    if (!input || (button && button.disabled)) return;
    const raw = input.value;
    const token = nodeTestToken;
    if (button) button.disabled = true;
    input.disabled = true;
    setNodeStatus("Testing…");
    try {
      const node = await HiveApi.testNode(raw);
      if (token !== nodeTestToken) return;
      if (!HiveApi.saveCustomNode(node)) {
        throw new Error("Could not save that server.");
      }
      paintNodeMenus();
      setNodeLabel();
      input.value = "";
      hideNodeOverlay();
      setNodeStatus("");
    } catch (err) {
      if (token !== nodeTestToken) return;
      setNodeStatus((err && err.message) || "Could not use that server.", true);
      resetNodeForm();
      input.focus();
    }
  }

  function bindNodeMenus() {
    paintNodeMenus();
    setNodeLabel();

    document.querySelectorAll(".node-menu").forEach((menu) => {
      const trigger = menu.querySelector(".status-pill");
      if (!trigger) return;
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = !menu.classList.contains("is-open");
        closeNodeMenus();
        menu.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    document.addEventListener("click", (e) => {
      const custom = e.target.closest(".node-option-custom");
      if (custom) {
        e.preventDefault();
        e.stopPropagation();
        openNodeOverlay();
        return;
      }
      const option = e.target.closest(".node-option");
      if (option) {
        e.preventDefault();
        e.stopPropagation();
        const url = option.getAttribute("data-node");
        if (url && HiveApi.setActiveNode(url)) {
          setNodeLabel();
        }
        closeNodeMenus();
        return;
      }
      if (!e.target.closest(".node-menu")) closeNodeMenus();
    });

    const nodeOverlay = $("#nodeOverlay");
    const nodeServer = $("#nodeServer");
    const nodeTest = $("#nodeTest");
    const nodeCancel = $("#nodeCancel");
    if (nodeTest) nodeTest.addEventListener("click", submitCustomNode);
    if (nodeCancel) nodeCancel.addEventListener("click", closeNodeOverlay);
    if (nodeServer) {
      nodeServer.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCustomNode();
        }
      });
    }
    if (nodeOverlay) {
      nodeOverlay.addEventListener("click", (e) => {
        if (e.target === nodeOverlay) closeNodeOverlay();
      });
    }
  }

  let errorHideTimer = 0;

  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.hidden = false;
    window.clearTimeout(errorHideTimer);
    errorHideTimer = window.setTimeout(clearError, 3000);
  }

  function clearError() {
    window.clearTimeout(errorHideTimer);
    errorHideTimer = 0;
    errorBanner.hidden = true;
    errorText.textContent = "";
  }

  errorBanner.addEventListener("click", clearError);

  function parseCreatedTs(created) {
    if (!created) return NaN;
    const s = String(created);
    if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return Date.parse(s);
    return Date.parse(s + "Z");
  }

  function timeAgo(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    const sec = Math.round((Date.now() - ts) / 1000);
    const abs = Math.abs(sec);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const steps = [
      [60, "second"],
      [60, "minute"],
      [24, "hour"],
      [7, "day"],
      [4.345, "week"],
      [12, "month"],
      [Infinity, "year"],
    ];
    let value = abs;
    let unit = "second";
    let cursor = sec < 0 ? -1 : 1;
    for (const [div, name] of steps) {
      if (value < div) {
        unit = name;
        break;
      }
      value = value / div;
    }
    return rtf.format(-cursor * Math.round(value), unit);
  }

  function formatCreated(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function metaTimeHtml(created, href) {
    const rel = timeAgo(created);
    if (!rel) return "";
    const abs = formatCreated(created);
    const pop = abs
      ? `<span class="meta-time-pop" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    const text = HiveMd.escapeHtml(rel) + pop;
    if (!href) return `<span class="meta-time">${text}</span>`;
    return `<a class="meta-time" href="${HiveMd.escapeHtml(href)}">${text}</a>`;
  }

  function profileJoinedHtml(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    let month = "";
    try {
      month = new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
      }).format(new Date(ts));
    } catch {
      month = "";
    }
    if (!month) return "";
    const abs = formatCreated(created);
    const pop = abs
      ? `<span class="meta-time-pop" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    return `<span class="meta-time profile-joined">joined ${HiveMd.escapeHtml(month)}${pop}</span>`;
  }

  function commentAnchorId(author, permlink) {
    return "@" + String(author || "") + "/" + String(permlink || "");
  }

  function commentPath(node) {
    if (!node || !node.author || !node.permlink) return "";
    const id = commentAnchorId(node.author, node.permlink);
    if (HASH_ROUTING) return "#" + id;
    const root = currentPost;
    if (root && root.author && root.permlink) return postPath(root) + "#" + id;
    return "#" + id;
  }

  function parsePayoutAmount(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return NaN;
    const m = String(value).match(/-?[\d.]+/);
    return m ? Number(m[0]) : NaN;
  }

  function payoutAmount(post) {
    const n = parsePayoutAmount(post && post.payout);
    if (Number.isFinite(n)) return n;
    const pending = parsePayoutAmount(post && post.pending_payout_value);
    if (Number.isFinite(pending)) return pending;
    const total = parsePayoutAmount(post && post.total_payout_value);
    const curator = parsePayoutAmount(post && post.curator_payout_value);
    const paid = (Number.isFinite(total) ? total : 0) + (Number.isFinite(curator) ? curator : 0);
    return paid;
  }

  function formatHiveAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "H 0.00";
    return `H ${Math.abs(n).toFixed(2)}`;
  }

  function formatPayout(post) {
    return formatHiveAmount(payoutAmount(post));
  }

  function payoutHtml(post, pill) {
    const author = HiveMd.escapeHtml(post.author || "");
    const permlink = HiveMd.escapeHtml(post.permlink || "");
    const cls = pill ? "payout stat-pill" : "payout";
    return `<span class="${cls}" data-payout-author="${author}" data-payout-permlink="${permlink}">${HiveMd.escapeHtml(formatPayout(post))}</span>`;
  }

  function rememberPayout(post) {
    if (!post || !post.author || !post.permlink) return;
    const net = Number(post.net_rshares);
    payoutByKey.set(postKey(post.author, post.permlink), {
      payout: payoutAmount(post),
      netRshares: Number.isFinite(net) ? net : 0,
    });
  }

  function voteCount(post) {
    if (post && post.stats && post.stats.total_votes != null) {
      return Number(post.stats.total_votes) || 0;
    }
    return Array.isArray(post && post.active_votes) ? post.active_votes.length : 0;
  }

  function votePolarity(vote) {
    if (!vote || typeof vote !== "object") return 0;
    if (vote.percent != null && vote.percent !== "") {
      const p = Number(vote.percent);
      if (Number.isFinite(p) && p !== 0) return p < 0 ? -1 : 1;
    }
    const r = Number(vote.rshares);
    if (Number.isFinite(r) && r !== 0) return r < 0 ? -1 : 1;
    return 0;
  }

  function downvoteCountOf(post) {
    const votes = post && post.active_votes;
    if (!Array.isArray(votes)) return 0;
    let n = 0;
    for (let i = 0; i < votes.length; i++) {
      if (votePolarity(votes[i]) === -1) n += 1;
    }
    return n;
  }

  function upvoteCountOf(post) {
    const down = downvoteCountOf(post);
    if (post && post.stats && post.stats.total_votes != null) {
      return Math.max(0, (Number(post.stats.total_votes) || 0) - down);
    }
    const votes = post && post.active_votes;
    if (Array.isArray(votes)) {
      let n = 0;
      for (let i = 0; i < votes.length; i++) {
        if (votePolarity(votes[i]) === 1) n += 1;
      }
      return n;
    }
    return voteCount(post);
  }

  function postKey(author, permlink) {
    return `${author}/${permlink}`;
  }

  function rememberContent(node) {
    if (!node || !node.author || !node.permlink) return;
    contentByKey.set(postKey(node.author, node.permlink), {
      author: node.author,
      permlink: node.permlink,
      title: node.title || "",
      body: node.body || "",
      parent_author: node.parent_author || "",
      parent_permlink: node.parent_permlink || "",
      json_metadata: node.json_metadata,
    });
  }

  function contentOf(author, permlink) {
    return contentByKey.get(postKey(author, permlink)) || null;
  }

  function editButtonHtml(kind, author, permlink) {
    if (!isOwnAuthor(author)) return "";
    const cls = kind === "post" ? "post-edit-btn" : "comment-edit-btn";
    return `<button type="button" class="${cls}" data-edit-author="${HiveMd.escapeHtml(author)}" data-edit-permlink="${HiveMd.escapeHtml(permlink)}">Edit</button>`;
  }

  function findUserVote(votes, user) {
    const name = String(user || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (!name || !Array.isArray(votes)) return null;
    for (let i = 0; i < votes.length; i++) {
      const v = votes[i];
      const voter = String((v && v.voter) || "")
        .replace(/^@/, "")
        .toLowerCase();
      if (voter === name) return v;
    }
    return null;
  }

  function userVoteSign(post) {
    const user = observer();
    if (!user || !post) return 0;
    const mine = findUserVote(post.active_votes, user);
    return mine ? votePolarity(mine) : 0;
  }

  function voteView(post) {
    const key = postKey(post.author, post.permlink);
    const serverUp = upvoteCountOf(post);
    const serverDown = downvoteCountOf(post);
    const serverSign = userVoteSign(post);
    const local = localVotes.get(key);
    if (!local) {
      return {
        key,
        upCount: serverUp,
        downCount: serverDown,
        sign: serverSign,
        pending: false,
      };
    }
    let upCount = serverUp;
    let downCount = serverDown;
    if (local.sign !== serverSign) {
      if (serverSign === 1) upCount -= 1;
      else if (serverSign === -1) downCount -= 1;
      if (local.sign === 1) upCount += 1;
      else if (local.sign === -1) downCount += 1;
    }
    return {
      key,
      upCount: Math.max(0, upCount),
      downCount: Math.max(0, downCount),
      sign: local.sign,
      pending: Boolean(local.pending),
    };
  }

  function plainVoteHtml(author, permlink, upCount, downCount) {
    return `<span class="vote-counts" data-vote-author="${author}" data-vote-permlink="${permlink}"><span class="vote-count vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up">▲ <span class="vote-n">${upCount}</span></span><span class="vote-count downvote-count vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down">▼ <span class="downvote-n">${downCount}</span></span></span>`;
  }

  function voteSliderHtml(kind, author, permlink, pct, downPct) {
    return `<span class="vote-slider-panel" hidden data-vote-kind="${kind}"><label class="vote-weight"><span class="vote-weight-caption">weight</span><span class="vote-slider-line" style="--vote-pct: ${pct}%; --p: ${Number(pct) / 100}"><input class="vote-slider" type="range" min="0" max="100" step="1" value="${pct}" aria-label="Vote weight"></span><span class="vote-weight-value">${pct}%</span></label></span><span class="downvote-slider-panel" hidden data-vote-kind="${kind}"><div class="vote-weight downvote-weight"><span class="vote-weight-caption">weight</span><span class="vote-slider-line" style="--vote-pct: ${downPct}%; --p: ${Number(downPct) / 100}"><input class="vote-slider downvote-slider" type="range" min="0" max="100" step="1" value="${downPct}" aria-label="Downvote weight"></span><span class="vote-weight-value">${downPct}%</span><button type="button" class="downvote-confirm" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-kind="${kind}">Downvote</button></div></span>`;
  }

  function voteControlHtml(post, variant) {
    rememberPayout(post);
    const viewState = voteView(post);
    const user = observer();
    const upCount = viewState.upCount;
    const downCount = viewState.downCount;
    const author = HiveMd.escapeHtml(post.author);
    const permlink = HiveMd.escapeHtml(post.permlink);
    if (variant === "plain" || (!user && variant !== "pills")) {
      return plainVoteHtml(author, permlink, upCount, downCount);
    }
    const kind = voteKindFromPost(post);
    const pct = readStoredWeight(kind);
    const downPct = readStoredDownvoteWeight(kind);
    const pending = user && viewState.pending ? "disabled" : "";
    const pill = variant === "pills" ? "stat-pill" : "";
    const upClasses = ["vote-btn", pill, viewState.sign === 1 ? "is-voted" : "", user && viewState.pending ? "is-pending" : ""]
      .filter(Boolean)
      .join(" ");
    const downClasses = ["downvote-btn", pill, viewState.sign === -1 ? "is-voted" : "", user && viewState.pending ? "is-pending" : ""]
      .filter(Boolean)
      .join(" ");
    const upLabel = viewState.sign === 1 ? "Remove upvote" : "Upvote";
    const downLabel = viewState.sign === -1 ? "Remove downvote" : "Downvote";
    const sliders = user ? voteSliderHtml(kind, author, permlink, pct, downPct) : "";
    const upBtn = `<button type="button" class="${upClasses}" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-key="${author}/${permlink}" data-vote-kind="${kind}" data-vote-dir="up" aria-pressed="${viewState.sign === 1 ? "true" : "false"}" aria-label="${upLabel}" ${pending}>▲</button>`;
    const downBtn = `<button type="button" class="${downClasses}" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-key="${author}/${permlink}" data-vote-kind="${kind}" data-vote-dir="down" aria-pressed="${viewState.sign === -1 ? "true" : "false"}" aria-label="${downLabel}" ${pending}>▼</button>`;
    if (variant === "pills") {
      return `<span class="vote-wrap vote-pills" data-vote-kind="${kind}" data-vote-author="${author}" data-vote-permlink="${permlink}"><span class="vote-pair">${upBtn}<button type="button" class="vote-count-btn stat-pill vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up" aria-label="Upvotes"><span class="vote-n">${upCount}</span></button></span><span class="vote-pair">${downBtn}<button type="button" class="vote-count-btn stat-pill vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down" aria-label="Downvotes"><span class="downvote-n">${downCount}</span></button></span>${sliders}</span>`;
    }
    const upCountHtml = `▲ <span class="vote-n vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="up">${upCount}</span>`;
    const downCountHtml = `▼ <span class="downvote-n vote-hit" data-vote-author="${author}" data-vote-permlink="${permlink}" data-vote-dir="down">${downCount}</span>`;
    return `<span class="vote-wrap" data-vote-kind="${kind}" data-vote-author="${author}" data-vote-permlink="${permlink}">${upBtn.replace("▲", upCountHtml)}${downBtn.replace("▼", downCountHtml)}${sliders}</span>`;
  }

  function voteRootsFor(author, permlink) {
    return Array.from(document.querySelectorAll(".vote-wrap, .vote-counts")).filter(
      (el) =>
        el.getAttribute("data-vote-author") === author &&
        el.getAttribute("data-vote-permlink") === permlink
    );
  }

  function voteWrapsFor(author, permlink) {
    return voteRootsFor(author, permlink).filter((el) => el.classList.contains("vote-wrap"));
  }

  function releaseVoteColor(btn) {
    if (!btn) return;
    btn.classList.remove("is-rest");
    btn.removeAttribute("data-vote-left");
    btn.removeAttribute("data-vote-rest-armed");
  }

  function restVoteColor(btn) {
    if (!btn) return;
    btn.classList.add("is-rest");
    btn.removeAttribute("data-vote-left");
    if (!btn.matches(":hover")) {
      btn.setAttribute("data-vote-rest-armed", "1");
      btn.setAttribute("data-vote-left", "1");
      return;
    }
    btn.removeAttribute("data-vote-rest-armed");
    window.setTimeout(() => {
      if (!btn.classList.contains("is-rest")) return;
      btn.setAttribute("data-vote-rest-armed", "1");
      if (!btn.matches(":hover")) btn.setAttribute("data-vote-left", "1");
    }, 0);
  }

  function syncVoteArrow(btn, voted, pending, votedLabel, idleLabel) {
    if (!btn) return;
    const wasVoted = btn.classList.contains("is-voted");
    btn.classList.toggle("is-voted", voted);
    btn.classList.toggle("is-pending", pending);
    btn.disabled = pending;
    btn.setAttribute("aria-pressed", voted ? "true" : "false");
    btn.setAttribute("aria-label", voted ? votedLabel : idleLabel);
    if (voted) releaseVoteColor(btn);
    else if (wasVoted) restVoteColor(btn);
  }

  function syncVoteButtons(author, permlink, state) {
    const pending = Boolean(state.pending);
    const upvoted = state.sign === 1;
    const downvoted = state.sign === -1;
    voteRootsFor(author, permlink).forEach((root) => {
      const upBtn = root.querySelector(".vote-btn");
      const downBtn = root.querySelector(".downvote-btn");
      syncVoteArrow(upBtn, upvoted, pending, "Remove upvote", "Upvote");
      syncVoteArrow(downBtn, downvoted, pending, "Remove downvote", "Downvote");
      root.querySelectorAll(".vote-n").forEach((el) => {
        el.textContent = String(state.upCount);
      });
      root.querySelectorAll(".downvote-n").forEach((el) => {
        el.textContent = String(state.downCount);
      });
    });
  }

  function voteKindFromPost(post) {
    return isRootPost(post) ? "post" : "comment";
  }

  function normalizeVoteKind(kind) {
    return kind === "comment" ? "comment" : "post";
  }

  function voteKindFromEl(el) {
    const node = el && el.closest("[data-vote-kind]");
    return normalizeVoteKind(node && node.getAttribute("data-vote-kind"));
  }

  function parseStoredWeight(raw) {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function readStoredWeight(kind) {
    kind = normalizeVoteKind(kind);
    const specific = parseStoredWeight(localStorage.getItem(VOTE_WEIGHT_KEYS[kind]));
    if (specific != null) return specific;
    const legacy = parseStoredWeight(localStorage.getItem(VOTE_WEIGHT_KEY_LEGACY));
    if (legacy != null) return legacy;
    return 100;
  }

  function storeWeight(percent, kind) {
    kind = normalizeVoteKind(kind);
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    localStorage.setItem(VOTE_WEIGHT_KEYS[kind], String(pct));
    return pct;
  }

  function readStoredDownvoteWeight(kind) {
    kind = normalizeVoteKind(kind);
    const specific = parseStoredWeight(localStorage.getItem(DOWNVOTE_WEIGHT_KEYS[kind]));
    if (specific != null) return specific;
    return 100;
  }

  function storeDownvoteWeight(percent, kind) {
    kind = normalizeVoteKind(kind);
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    localStorage.setItem(DOWNVOTE_WEIGHT_KEYS[kind], String(pct));
    return pct;
  }

  let openSlider = null;

  function sliderModeForBtn(btn) {
    return btn && btn.classList.contains("downvote-btn") ? "down" : "up";
  }

  function sliderPanelFor(btn) {
    const wrap = btn && btn.closest(".vote-wrap");
    if (!wrap) return null;
    const mode = sliderModeForBtn(btn);
    if (openSlider && openSlider.wrap === wrap && openSlider.mode === mode) {
      return openSlider.panel;
    }
    return wrap.querySelector(mode === "down" ? ".downvote-slider-panel" : ".vote-slider-panel");
  }

  function paintVoteSlider(slider, valueEl) {
    if (!slider) return;
    const pct = Math.max(0, Math.min(100, Number(slider.value) || 0));
    const line = slider.closest(".vote-slider-line");
    if (line) {
      line.style.setProperty("--vote-pct", pct + "%");
      line.style.setProperty("--p", String(pct / 100));
    }
    if (valueEl) valueEl.textContent = pct + "%";
  }

  function clearVoteSliderPos(panel) {
    panel.style.position = "";
    panel.style.top = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.zIndex = "";
  }

  function placeVoteSlider(btn, panel) {
    const rect = btn.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.zIndex = "64";
    panel.style.top = Math.round(rect.bottom + 18) + "px";
    panel.style.left = Math.round(rect.left + 6) + "px";
    panel.style.right = "auto";
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
  }

  function repositionOpenSlider() {
    if (openSlider && !openSlider.panel.hidden) {
      placeVoteSlider(openSlider.btn, openSlider.panel);
    }
    if (openVoters && openVoters.el && openVoters.el.isConnected) {
      placeVoteVoters(openVoters.el, votersPanelEl());
    } else if (openVoters) {
      hideVoteVoters();
    }
  }

  function clearUpvoteConfirmStyle() {
    document.querySelectorAll(".vote-btn.is-confirming").forEach((el) => {
      el.classList.remove("is-confirming");
    });
  }

  function hideVoteSlider() {
    hideVoteVoters();
    clearUpvoteConfirmStyle();
    if (openSlider) {
      const { wrap, panel } = openSlider;
      panel.hidden = true;
      clearVoteSliderPos(panel);
      if (wrap && panel.parentNode !== wrap) wrap.appendChild(panel);
      if (wrap) wrap.classList.remove("is-open");
      openSlider = null;
    }
    document.querySelectorAll(".vote-wrap.is-open").forEach((wrap) => {
      wrap.classList.remove("is-open");
    });
  }

  let openVoters = null;
  let votersGen = 0;
  let votersShowTimer = 0;
  let votersHideTimer = 0;
  let votersPanelNode = null;

  function hoverFine() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function voteHitFrom(target) {
    return target && target.closest ? target.closest(".vote-hit") : null;
  }

  function voteDirFromEl(el) {
    if (!el) return "up";
    if (el.getAttribute("data-vote-dir") === "down") return "down";
    if (el.classList.contains("downvote-btn") || el.classList.contains("downvote-count")) {
      return "down";
    }
    return "up";
  }

  function votersPanelEl() {
    if (votersPanelNode && votersPanelNode.isConnected) return votersPanelNode;
    let el = document.getElementById("voteVotersPanel");
    if (!el) {
      el = document.createElement("div");
      el.id = "voteVotersPanel";
      el.className = "vote-voters-panel";
      el.hidden = true;
      el.setAttribute("role", "tooltip");
      document.body.appendChild(el);
      el.addEventListener("pointerenter", () => {
        window.clearTimeout(votersHideTimer);
      });
      el.addEventListener("pointerleave", scheduleHideVoters);
    }
    votersPanelNode = el;
    return el;
  }

  function placeVoteVoters(anchor, panel) {
    if (!anchor || !panel || panel.hidden) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      hideVoteVoters();
      return;
    }
    panel.style.position = "fixed";
    panel.style.zIndex = "70";
    panel.style.right = "auto";
    panel.style.maxHeight = "";
    panel.style.left = Math.round(rect.left) + "px";
    panel.style.top = Math.round(rect.bottom + 8) + "px";
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    if (box.height > spaceBelow && spaceAbove > spaceBelow) {
      const h = Math.max(80, Math.round(spaceAbove));
      panel.style.maxHeight = h + "px";
      panel.style.top = Math.max(8, Math.round(rect.top - Math.min(box.height, h) - 8)) + "px";
    } else {
      panel.style.maxHeight = Math.max(80, Math.round(spaceBelow)) + "px";
    }
  }

  function hideVoteVoters() {
    window.clearTimeout(votersShowTimer);
    window.clearTimeout(votersHideTimer);
    votersShowTimer = 0;
    votersHideTimer = 0;
    votersGen += 1;
    openVoters = null;
    const panel = votersPanelNode || document.getElementById("voteVotersPanel");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
    panel.classList.remove("is-down");
    panel.style.top = "";
    panel.style.left = "";
    panel.style.maxHeight = "";
  }

  function scheduleHideVoters() {
    window.clearTimeout(votersShowTimer);
    window.clearTimeout(votersHideTimer);
    votersShowTimer = 0;
    votersHideTimer = window.setTimeout(hideVoteVoters, 180);
  }

  function voteRshares(vote) {
    const r = Number(vote && vote.rshares);
    return Number.isFinite(r) ? r : 0;
  }

  function totalVoteRshares(votes) {
    let sum = 0;
    const list = Array.isArray(votes) ? votes : [];
    for (let i = 0; i < list.length; i++) sum += voteRshares(list[i]);
    return sum;
  }

  function votePayoutValue(vote, totalPayout, totalRshares) {
    if (!totalRshares || !totalPayout) return 0;
    return totalPayout * (voteRshares(vote) / totalRshares);
  }

  function loadActiveVotes(author, permlink) {
    const key = postKey(author, permlink);
    const hit = votesCache.get(key);
    if (hit && Array.isArray(hit.votes)) return Promise.resolve(hit.votes);
    if (hit && hit.promise) return hit.promise;
    const promise = HiveApi.getActiveVotes(author, permlink)
      .then((votes) => {
        votesCache.set(key, { votes });
        return votes;
      })
      .catch((err) => {
        votesCache.delete(key);
        throw err;
      });
    votesCache.set(key, { promise });
    return promise;
  }

  function mergeLocalVoter(list, author, permlink, dir) {
    const user = observer();
    if (!user) return list;
    const local = localVotes.get(postKey(author, permlink));
    const want = dir === "down" ? -1 : 1;
    const source = Array.isArray(list) ? list : [];
    const withoutUser = source.filter(
      (v) => String((v && v.voter) || "").replace(/^@/, "").toLowerCase() !== user
    );
    if (!local) return source;
    if (local.sign !== want) return withoutUser;
    const unknown = local.rshares == null;
    const real = source.find(
      (v) => String((v && v.voter) || "").replace(/^@/, "").toLowerCase() === user
    );
    const fromChain = real ? voteRshares(real) : 0;
    const rshares = unknown ? 0 : fromChain !== 0 ? fromChain : Number(local.rshares) || 0;
    return [
      {
        voter: user,
        rshares,
        percent: want > 0 ? 10000 : -10000,
        pending: unknown,
      },
      ...withoutUser,
    ];
  }

  function renderVoteVoters(panel, votes, dir, author, permlink) {
    const want = dir === "down" ? -1 : 1;
    const caption = dir === "down" ? "Downvotes" : "Upvotes";
    const ctx = payoutByKey.get(postKey(author, permlink));
    const totalPayout = ctx && Number.isFinite(ctx.payout) ? ctx.payout : 0;
    let totalRshares = ctx && ctx.netRshares ? ctx.netRshares : 0;
    if (!totalRshares) totalRshares = totalVoteRshares(votes);
    let list = (Array.isArray(votes) ? votes : []).filter((v) => votePolarity(v) === want);
    list.sort((a, b) => Math.abs(voteRshares(b)) - Math.abs(voteRshares(a)));
    list = mergeLocalVoter(list, author, permlink, dir);
    if (!list.length) {
      panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><p class="vote-voters-status">${
        dir === "down" ? "No downvotes yet." : "No upvotes yet."
      }</p>`;
      return;
    }
    const extra = list.length > VOTERS_SHOW ? list.length - VOTERS_SHOW : 0;
    const rows = list
      .slice(0, VOTERS_SHOW)
      .map((v) => {
        const name = String((v && v.voter) || "").replace(/^@/, "").toLowerCase();
        if (!name) return "";
        const href = HiveMd.escapeHtml(appHref("/@" + name));
        const safe = HiveMd.escapeHtml(name);
        const pendingRow = Boolean(v && v.pending);
        const pay = pendingRow
          ? "…"
          : HiveMd.escapeHtml(formatHiveAmount(votePayoutValue(v, totalPayout, totalRshares)));
        return `<li><a class="vote-voter" href="${href}"><span class="vote-voter-name">@${safe}</span><span class="vote-voter-payout${
          pendingRow ? " is-pending" : ""
        }">${pay}</span></a></li>`;
      })
      .filter(Boolean)
      .join("");
    const more = extra ? `<p class="vote-voters-more">and ${extra} more</p>` : "";
    panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><ul class="vote-voters-list">${rows}</ul>${more}`;
  }

  function showVoteVoters(el, force) {
    if ((!force && !hoverFine()) || !el || !el.isConnected) return;
    if (openSlider) return;
    const author = el.getAttribute("data-vote-author");
    const permlink = el.getAttribute("data-vote-permlink");
    const dir = voteDirFromEl(el);
    if (!author || !permlink) return;
    window.clearTimeout(votersHideTimer);
    votersHideTimer = 0;
    const panel = votersPanelEl();
    if (
      openVoters &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.dir === dir
    ) {
      openVoters.el = el;
      panel.hidden = false;
      placeVoteVoters(el, panel);
      return;
    }
    const gen = ++votersGen;
    openVoters = { el, author, permlink, dir, gen };
    panel.classList.toggle("is-down", dir === "down");
    panel.innerHTML = `<p class="vote-voters-caption">${
      dir === "down" ? "Downvotes" : "Upvotes"
    }</p><p class="vote-voters-status">Loading…</p>`;
    panel.hidden = false;
    document.body.appendChild(panel);
    placeVoteVoters(el, panel);
    loadActiveVotes(author, permlink)
      .then((votes) => {
        if (!openVoters || openVoters.gen !== gen) return;
        renderVoteVoters(panel, votes, dir, author, permlink);
        placeVoteVoters(el, panel);
      })
      .catch(() => {
        if (!openVoters || openVoters.gen !== gen) return;
        panel.innerHTML = `<p class="vote-voters-status">Could not load votes.</p>`;
        placeVoteVoters(el, panel);
      });
  }

  function onVoteHitEnter(el) {
    if (!hoverFine() || !el) return;
    window.clearTimeout(votersHideTimer);
    window.clearTimeout(votersShowTimer);
    votersHideTimer = 0;
    if (
      openVoters &&
      openVoters.el === el &&
      votersPanelEl() &&
      !votersPanelEl().hidden
    ) {
      showVoteVoters(el);
      return;
    }
    votersShowTimer = window.setTimeout(() => {
      votersShowTimer = 0;
      showVoteVoters(el);
    }, 80);
  }

  function showVotePanel(btn, mode) {
    hideVoteVoters();
    hideVoteSlider();
    const wrap = btn.closest(".vote-wrap");
    const panel =
      wrap &&
      wrap.querySelector(mode === "down" ? ".downvote-slider-panel" : ".vote-slider-panel");
    if (!wrap || !panel) return;
    const slider = panel.querySelector(".vote-slider");
    const valueEl = panel.querySelector(".vote-weight-value");
    const pct =
      mode === "down"
        ? readStoredDownvoteWeight(voteKindFromEl(wrap))
        : readStoredWeight(voteKindFromEl(wrap));
    if (slider) {
      slider.value = String(pct);
      paintVoteSlider(slider, valueEl);
    }
    wrap.classList.add("is-open");
    if (mode === "up") {
      releaseVoteColor(btn);
      btn.classList.add("is-confirming");
    }
    openSlider = { wrap, btn, panel, mode };
    document.body.appendChild(panel);
    panel.hidden = false;
    placeVoteSlider(btn, panel);
  }

  function showVoteSlider(btn) {
    showVotePanel(btn, "up");
  }

  function showDownvoteSlider(btn) {
    showVotePanel(btn, "down");
  }

  function currentVotePercent(btn) {
    const panel = sliderPanelFor(btn);
    if (panel && !panel.hidden) {
      const slider = panel.querySelector(".vote-slider");
      if (slider) return Math.max(0, Math.min(100, Number(slider.value) || 0));
    }
    return readStoredWeight(voteKindFromEl(btn));
  }

  function currentDownvotePercent(el) {
    let panel = null;
    if (openSlider && openSlider.mode === "down" && !openSlider.panel.hidden) {
      panel = openSlider.panel;
    } else if (el) {
      const wrap = el.closest(".vote-wrap");
      panel = wrap && wrap.querySelector(".downvote-slider-panel");
    }
    if (panel && !panel.hidden) {
      const slider = panel.querySelector(".vote-slider");
      if (slider) return Math.max(0, Math.min(100, Number(slider.value) || 0));
    }
    return readStoredDownvoteWeight(voteKindFromEl(el));
  }

  async function refreshHivePower() {
    const user = observer();
    if (!user) {
      hivePower = null;
      hivePowerUser = "";
      return;
    }
    if (hivePowerUser === user && hivePower != null) return;
    hivePowerUser = user;
    try {
      hivePower = await HiveApi.getHivePower(user);
      setNodeLabel();
    } catch {
      hivePower = 0;
    }
    if (observer() !== user) return;
  }

  function renderQueueStatus(size) {
    if (!queueSlot) return;
    const n = typeof size === "number" ? size : ChainQueue.size();
    if (!n) {
      queueSlot.hidden = true;
      queueSlot.innerHTML = "";
      return;
    }
    queueSlot.hidden = false;
    queueSlot.innerHTML = `<span class="queue-pill"><span class="dot"></span>${n} queued</span>`;
  }

  const voteRefreshGen = new Map();

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function cachedVoteList(author, permlink) {
    const hit = votesCache.get(postKey(author, permlink));
    return hit && Array.isArray(hit.votes) ? hit.votes : [];
  }

  function repaintOpenVoters(author, permlink) {
    if (!openVoters || openVoters.author !== author || openVoters.permlink !== permlink) return;
    const panel = votersPanelNode;
    if (!panel || panel.hidden) return;
    renderVoteVoters(panel, cachedVoteList(author, permlink), openVoters.dir, author, permlink);
    if (openVoters.el && openVoters.el.isConnected) placeVoteVoters(openVoters.el, panel);
  }

  function payoutNodesFor(author, permlink) {
    return Array.from(document.querySelectorAll(".payout")).filter(
      (el) =>
        el.getAttribute("data-payout-author") === author &&
        el.getAttribute("data-payout-permlink") === permlink
    );
  }

  function eachContentNode(author, permlink, fn) {
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.author === author && item.permlink === permlink) fn(item);
    }
    const walk = (node) => {
      if (!node) return;
      if (node.author === author && node.permlink === permlink) fn(node);
      const replies = node._replies || [];
      for (let i = 0; i < replies.length; i++) walk(replies[i]);
    };
    walk(currentPost);
  }

  function findContentNode(author, permlink) {
    let found = null;
    eachContentNode(author, permlink, (node) => {
      if (!found) found = node;
    });
    return found;
  }

  function payoutIsMutable(node) {
    if (!node) return true;
    if (node.is_paidout) return false;
    const cashout = String(node.cashout_time || "");
    if (cashout.indexOf("1969") === 0) return false;
    if (node.max_accepted_payout != null && node.max_accepted_payout !== "") {
      const max = parsePayoutAmount(node.max_accepted_payout);
      if (Number.isFinite(max) && max <= 0) return false;
    }
    return true;
  }

  function setDisplayedPayout(author, permlink, amount, netRshares) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    const text = formatHiveAmount(n);
    payoutNodesFor(author, permlink).forEach((el) => {
      el.textContent = text;
    });
    const net = Number(netRshares);
    payoutByKey.set(postKey(author, permlink), {
      payout: n,
      netRshares: Number.isFinite(net) ? net : 0,
    });
    eachContentNode(author, permlink, (node) => {
      node.payout = n;
      if (!node.is_paidout) node.pending_payout_value = n.toFixed(3) + " HBD";
      if (Number.isFinite(net)) node.net_rshares = net;
    });
    repaintOpenVoters(author, permlink);
  }

  function shownVoteState(author, permlink) {
    const roots = voteRootsFor(author, permlink);
    let up = null;
    let down = null;
    let sign = null;
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (up == null) {
        const upN = root.querySelector(".vote-n");
        if (upN) up = Number(upN.textContent) || 0;
      }
      if (down == null) {
        const downN = root.querySelector(".downvote-n");
        if (downN) down = Number(downN.textContent) || 0;
      }
      if (sign == null) {
        const upBtn = root.querySelector(".vote-btn");
        const downBtn = root.querySelector(".downvote-btn");
        if (upBtn || downBtn) {
          sign =
            upBtn && upBtn.classList.contains("is-voted")
              ? 1
              : downBtn && downBtn.classList.contains("is-voted")
                ? -1
                : 0;
        }
      }
    }
    return {
      up: up == null ? 0 : up,
      down: down == null ? 0 : down,
      sign: sign == null ? 0 : sign,
    };
  }

  function snapshotVoteBasis(author, permlink, user) {
    const node = findContentNode(author, permlink);
    let payout = node ? payoutAmount(node) : NaN;
    if (!Number.isFinite(payout)) {
      const el = payoutNodesFor(author, permlink)[0];
      payout = el ? parsePayoutAmount(el.textContent) : 0;
    }
    if (!Number.isFinite(payout)) payout = 0;
    const cached = cachedVoteList(author, permlink);
    const votes = cached.length ? cached : (node && node.active_votes) || [];
    const mine = findUserVote(votes, user);
    const net = Number(node && node.net_rshares);
    return {
      payout,
      rshares: mine ? voteRshares(mine) : 0,
      netRshares: Number.isFinite(net) ? net : 0,
      maxPayout: node && node.max_accepted_payout,
      mutable: payoutIsMutable(node),
    };
  }

  function loadVoteBasis(username) {
    return Promise.all([
      HiveApi.getAccounts([username]),
      HiveApi.getDynamicGlobalProperties(),
      HiveApi.getRewardFund(),
      HiveApi.getMedianHistoryPrice(),
    ]).then((rows) => ({
      account: rows[0] && rows[0][0],
      props: rows[1],
      fund: rows[2],
      price: rows[3],
    }));
  }

  function payoutAfterRshares(before, newRshares, fund, price) {
    const oldR = before && before.rshares ? before.rshares : 0;
    const base = before && Number.isFinite(before.payout) ? before.payout : 0;
    let next = base + HiveApi.rsharesToHbd(newRshares - oldR, fund, price);
    if (!Number.isFinite(next) || next < 0) next = 0;
    const max = parsePayoutAmount(before && before.maxPayout);
    if (Number.isFinite(max) && max > 0 && next > max) next = max;
    return next;
  }

  function applyEstimatedPayout(author, permlink, weight, before, basis) {
    if (!basis || !basis.fund || !basis.price) return null;
    let est = 0;
    if (weight) {
      if (!basis.account || !basis.props) return null;
      est = HiveApi.estimateVoteRshares(basis.account, basis.props, weight);
    }
    if (before && before.mutable !== false) {
      const next = payoutAfterRshares(before, est, basis.fund, basis.price);
      const net = (before && before.netRshares ? before.netRshares : 0) + (est - (before.rshares || 0));
      setDisplayedPayout(author, permlink, next, net);
    }
    return est;
  }

  function chainPayoutAmount(content) {
    if (!content || typeof content !== "object") return NaN;
    const cashout = String(content.cashout_time || "");
    if (cashout.indexOf("1969") === 0) {
      const total = parsePayoutAmount(content.total_payout_value);
      const curator = parsePayoutAmount(content.curator_payout_value);
      return (Number.isFinite(total) ? total : 0) + (Number.isFinite(curator) ? curator : 0);
    }
    const pending = parsePayoutAmount(content.pending_payout_value);
    return Number.isFinite(pending) ? pending : NaN;
  }

  function chainVoteReady(content, user, expectSign, before, weight) {
    const list = content && content.active_votes;
    const mine = findUserVote(list, user);
    const sign = mine ? votePolarity(mine) : 0;
    if (sign !== expectSign) return false;
    if (expectSign !== 0 && voteRshares(mine) === 0) return false;
    if (before && weight && before.rshares && mine && voteRshares(mine) === before.rshares) {
      return false;
    }
    return true;
  }

  function refreshVoteValue(author, permlink, expectSign, before, weight, basis) {
    const key = postKey(author, permlink);
    const user = observer();
    if (!user) return;
    const gen = (voteRefreshGen.get(key) || 0) + 1;
    voteRefreshGen.set(key, gen);
    const run = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (voteRefreshGen.get(key) !== gen) return;
        if (attempt) await waitMs(3000);
        if (voteRefreshGen.get(key) !== gen) return;
        const local = localVotes.get(key);
        if (!local || local.sign !== expectSign) return;
        let content = null;
        try {
          content = await HiveApi.getContent(author, permlink);
        } catch (err) {
          continue;
        }
        if (voteRefreshGen.get(key) !== gen) return;
        if (!content || !content.author) continue;
        if (!chainVoteReady(content, user, expectSign, before, weight)) {
          if (attempt < 7) continue;
          return;
        }
        const list = Array.isArray(content.active_votes) ? content.active_votes : [];
        const mine = findUserVote(list, user);
        votesCache.set(key, { votes: list });
        const chainAmount = chainPayoutAmount(content);
        const chainMoved =
          before && Number.isFinite(chainAmount) && Math.abs(chainAmount - before.payout) >= 0.005;
        if (before && before.mutable !== false && chainMoved) {
          setDisplayedPayout(author, permlink, chainAmount, Number(content.net_rshares));
        } else if (before && before.mutable !== false && basis && basis.fund && basis.price) {
          const mineRshares = mine ? voteRshares(mine) : 0;
          const adjusted = payoutAfterRshares(before, mineRshares, basis.fund, basis.price);
          const net =
            (before && before.netRshares ? before.netRshares : 0) +
            (mineRshares - (before && before.rshares ? before.rshares : 0));
          setDisplayedPayout(author, permlink, adjusted, net);
        }
        eachContentNode(author, permlink, (node) => {
          node.active_votes = list;
          node.stats = Object.assign({}, node.stats || {}, { total_votes: list.length });
          if (content.total_payout_value != null) node.total_payout_value = content.total_payout_value;
          if (content.curator_payout_value != null) node.curator_payout_value = content.curator_payout_value;
        });
        const still = localVotes.get(key);
        if (!still || still.sign !== expectSign || voteRefreshGen.get(key) !== gen) return;
        const postLike = {
          author,
          permlink,
          active_votes: list,
          stats: { total_votes: list.length },
        };
        const next = {
          sign: expectSign,
          pending: false,
          upCount: upvoteCountOf(postLike),
          downCount: downvoteCountOf(postLike),
          rshares: mine ? voteRshares(mine) : 0,
        };
        localVotes.set(key, next);
        syncVoteButtons(author, permlink, next);
        repaintOpenVoters(author, permlink);
        if (!chainMoved && attempt < 7) continue;
        return;
      }
    };
    run();
  }

  function queueVote(author, permlink, percent) {
    const user = observer();
    if (!user) return;
    const key = postKey(author, permlink);
    const queuedGen = (voteRefreshGen.get(key) || 0) + 1;
    voteRefreshGen.set(key, queuedGen);
    const shown = shownVoteState(author, permlink);
    const currentUp = shown.up;
    const currentDown = shown.down;
    const currentSign = shown.sign;
    const nextSign = percent > 0 ? 1 : percent < 0 ? -1 : 0;
    let nextUp = currentUp;
    let nextDown = currentDown;
    if (currentSign !== nextSign) {
      if (currentSign === 1) nextUp -= 1;
      else if (currentSign === -1) nextDown -= 1;
      if (nextSign === 1) nextUp += 1;
      else if (nextSign === -1) nextDown += 1;
    }
    nextUp = Math.max(0, nextUp);
    nextDown = Math.max(0, nextDown);
    const previous = localVotes.get(key);
    const before = snapshotVoteBasis(author, permlink, user);
    const pendingState = {
      sign: nextSign,
      pending: true,
      upCount: nextUp,
      downCount: nextDown,
      rshares: null,
    };
    localVotes.set(key, pendingState);
    syncVoteButtons(author, permlink, pendingState);
    repaintOpenVoters(author, permlink);

    const weight = Math.round(Math.max(-100, Math.min(100, Number(percent) || 0)) * 100);
    const basisPromise = loadVoteBasis(user);
    const { promise } = ChainQueue.vote({
      voter: user,
      author,
      permlink,
      weight,
    });
    promise
      .then(async () => {
        if (voteRefreshGen.get(key) !== queuedGen) return;
        let basis = null;
        try {
          basis = await basisPromise;
        } catch (err) {
          basis = null;
        }
        if (voteRefreshGen.get(key) !== queuedGen) return;
        const est = applyEstimatedPayout(author, permlink, weight, before, basis);
        const done = {
          sign: nextSign,
          pending: false,
          upCount: nextUp,
          downCount: nextDown,
          rshares: est == null ? null : est,
        };
        localVotes.set(key, done);
        syncVoteButtons(author, permlink, done);
        repaintOpenVoters(author, permlink);
        refreshVoteValue(author, permlink, nextSign, before, weight, basis);
      })
      .catch((err) => {
        if (voteRefreshGen.get(key) !== queuedGen) {
          showError(err.message || String(err));
          return;
        }
        voteRefreshGen.set(key, queuedGen + 1);
        if (previous) {
          localVotes.set(key, {
            sign: previous.sign,
            pending: false,
            upCount: previous.upCount != null ? previous.upCount : currentUp,
            downCount: previous.downCount != null ? previous.downCount : currentDown,
            rshares: previous.rshares == null ? null : previous.rshares,
          });
        } else {
          localVotes.delete(key);
        }
        const restored = localVotes.get(key);
        syncVoteButtons(author, permlink, restored || {
          sign: currentSign,
          pending: false,
          upCount: currentUp,
          downCount: currentDown,
        });
        if (before && Number.isFinite(before.payout)) {
          setDisplayedPayout(author, permlink, before.payout, before.netRshares);
        }
        repaintOpenVoters(author, permlink);
        showError(err.message || String(err));
      });
  }

  async function ensureVoteReady(btn) {
    const user = observer();
    if (!user) return false;
    if (btn.classList.contains("is-pending") || btn.disabled) return false;
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return false;
    }
    if (hivePower == null || hivePowerUser !== user) {
      await refreshHivePower();
    }
    if (!btn.isConnected) return false;
    if (btn.classList.contains("is-pending") || btn.disabled) return false;
    return true;
  }

  let voteClickBusy = false;

  async function onVoteClick(btn) {
    if (!btn || voteClickBusy) return;
    if (!observer()) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-vote-author");
    const permlink = btn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    voteClickBusy = true;
    try {
      if (!(await ensureVoteReady(btn))) return;
      if (!btn.isConnected) return;

      if (btn.classList.contains("is-voted")) {
        hideVoteSlider();
        queueVote(author, permlink, 0);
        return;
      }

      if (hivePower > HP_SLIDER_THRESHOLD) {
        const panel = sliderPanelFor(btn);
        const open = Boolean(panel && !panel.hidden);
        if (!open) {
          showVoteSlider(btn);
          return;
        }
        const percent = storeWeight(currentVotePercent(btn), voteKindFromEl(btn));
        hideVoteSlider();
        queueVote(author, permlink, percent);
        return;
      }

      hideVoteSlider();
      queueVote(author, permlink, 100);
    } finally {
      voteClickBusy = false;
    }
  }

  function onVoteCountClick(btn) {
    const panel = votersPanelNode;
    if (openVoters && openVoters.el === btn && panel && !panel.hidden) {
      hideVoteVoters();
      return;
    }
    showVoteVoters(btn, true);
  }

  async function onDownvoteClick(btn) {
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-vote-author");
    const permlink = btn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    if (btn.classList.contains("is-pending") || btn.disabled) return;

    if (btn.classList.contains("is-voted")) {
      if (!(await ensureVoteReady(btn))) return;
      hideVoteSlider();
      queueVote(author, permlink, 0);
      return;
    }

    const panel = sliderPanelFor(btn);
    const open = Boolean(panel && !panel.hidden);
    if (open) {
      hideVoteSlider();
      return;
    }
    showDownvoteSlider(btn);
  }

  async function onDownvoteConfirm(confirmBtn) {
    const author = confirmBtn.getAttribute("data-vote-author");
    const permlink = confirmBtn.getAttribute("data-vote-permlink");
    if (!author || !permlink) return;
    const wrap =
      (openSlider && openSlider.wrap) ||
      confirmBtn.closest(".vote-wrap") ||
      voteWrapsFor(author, permlink)[0];
    const downBtn = wrap && wrap.querySelector(".downvote-btn");
    const readyBtn = downBtn || confirmBtn;
    if (!(await ensureVoteReady(readyBtn))) return;
    const percent = storeDownvoteWeight(
      currentDownvotePercent(downBtn || confirmBtn),
      voteKindFromEl(confirmBtn)
    );
    hideVoteSlider();
    queueVote(author, permlink, -percent);
  }

  function passesFeedFilter(post) {
    const rep = HiveMd.displayReputation(post.author_reputation);
    const votes = voteCount(post);
    const comments = Number(post.children || 0);
    return rep > 50 || votes > 100 || comments > 10;
  }

  function isRootPost(post) {
    if (!post || typeof post !== "object") return false;
    const parent = post.parent_author;
    if (parent != null && String(parent).length > 0) return false;
    if (typeof post.depth === "number" && post.depth > 0) return false;
    return Boolean(post.author && post.permlink);
  }

  function postPath(post) {
    return appHref(`/@${post.author}/${post.permlink}`);
  }

  function commentCountHtml(count, href) {
    const n = Number(count) || 0;
    return `<a class="comment-n comment-count-link" href="${HiveMd.escapeHtml(href)}">C ${n}</a>`;
  }

  function scrollToComments() {
    const el = document.getElementById("comments");
    if (!el) return false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    el.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    return true;
  }

  function scrollToAnchor(hash) {
    const raw = String(hash == null ? location.hash : hash).replace(/^#/, "");
    if (!raw) return false;
    if (raw === "comments") return scrollToComments();
    let el = document.getElementById(raw);
    if (!el) {
      try {
        el = document.getElementById(decodeURIComponent(raw));
      } catch {
        el = null;
      }
    }
    if (!el) return false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    el.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    return true;
  }

  function tagsOf(post) {
    const meta = HiveMd.parseJsonMetadata(post.json_metadata);
    let tags = meta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) tags = [];
    const cat = post.category || post.community;
    if (cat && !tags.includes(cat)) tags = [cat, ...tags];
    return tags
      .map((t) => String(t).replace(/^#/, "").trim())
      .filter((t, i, arr) => t && arr.indexOf(t) === i)
      .slice(0, 10);
  }

  function tagsForEdit(post) {
    const meta = HiveMd.parseJsonMetadata(post && post.json_metadata);
    let tags = meta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) tags = [];
    tags = tags
      .map((t) => String(t).replace(/^#/, "").trim().toLowerCase())
      .filter((t, i, arr) => t && arr.indexOf(t) === i);
    const parent = String((post && (post.parent_permlink || post.category)) || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (parent && tags.indexOf(parent) === -1) tags.unshift(parent);
    return tags.slice(0, MAX_TAGS);
  }

  function mergeJsonMetadata(prevRaw, body, tags) {
    const prev = HiveMd.parseJsonMetadata(prevRaw);
    const images = imagesFromMarkdown(body);
    const next = Object.assign({}, prev, {
      app: APP_ID + "/" + APP_VERSION,
      format: prev.format || "markdown",
      tags,
    });
    if (images.length) next.image = images;
    return next;
  }

  /* ─── Router ─── */
  const HASH_ROUTING = Boolean(window.__CS77_HASH__);
  const APP_ROUTE_HEADS = {
    feed: true,
    created: true,
    latest: true,
    trending: true,
    hot: true,
    tags: true,
    communities: true,
    publish: true,
    welcome: true,
    imprint: true,
    c: true,
  };

  function detectAppBase() {
    if (HASH_ROUTING) {
      const raw = window.__CS77_BASE__;
      if (typeof raw === "string" && raw) return raw;
      return location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
    }
    let given = window.__CS77_BASE__;
    if (typeof given === "string" && given) {
      if (/^[a-z]+:/i.test(given)) {
        try {
          given = new URL(given).pathname || "/";
        } catch {
          given = "/";
        }
      }
      if (!given.startsWith("/")) given = "/" + given;
      if (given !== "/" && !given.endsWith("/")) given += "/";
      return given;
    }
    let path = location.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const parts = path.split("/").filter(Boolean);
    let i = 0;
    for (; i < parts.length; i++) {
      const seg = parts[i];
      if (seg.charAt(0) === "@") break;
      if (APP_ROUTE_HEADS[seg.toLowerCase()]) break;
    }
    return "/" + (i ? parts.slice(0, i).join("/") + "/" : "");
  }

  const APP_BASE = detectAppBase();
  if (!HASH_ROUTING) window.__CS77_BASE__ = APP_BASE;

  function appBasePrefix() {
    if (!APP_BASE || APP_BASE === "/") return "";
    return APP_BASE.replace(/\/+$/, "");
  }

  function stripAppBase(pathname) {
    let path = pathname || "/";
    const prefix = appBasePrefix();
    if (!prefix) return path || "/";
    if (path === prefix || path === prefix + "/") return "/";
    if (path.indexOf(prefix + "/") === 0) {
      path = path.slice(prefix.length) || "/";
      return path.startsWith("/") ? path : "/" + path;
    }
    return path;
  }

  function prefixAppBase(path) {
    let p = path || "/";
    if (!p.startsWith("/")) p = "/" + p;
    const prefix = appBasePrefix();
    if (!prefix) return p;
    return p === "/" ? prefix + "/" : prefix + p;
  }

  function appHref(path) {
    let p = path || "/";
    if (p.startsWith("#")) {
      const h = p.slice(1);
      p = h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (!p.startsWith("/")) p = "/" + p;
    p = stripAppBase(p.split("#")[0].split("?")[0] || "/");
    return HASH_ROUTING ? "#" + p : prefixAppBase(p);
  }

  function currentPath() {
    if (HASH_ROUTING || /^#\//.test(location.hash || "")) {
      const raw = (location.hash || "#/").replace(/^#/, "") || "/";
      try {
        return decodeURIComponent(raw.startsWith("/") ? raw : "/" + raw);
      } catch {
        return raw.startsWith("/") ? raw : "/" + raw;
      }
    }
    let path = location.pathname || "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    return stripAppBase(path);
  }

  function hrefToPath(href) {
    if (!href) return "/";
    if (href.startsWith("#")) {
      const h = href.slice(1);
      return h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (href.startsWith("/") && !href.startsWith("//")) {
      return stripAppBase(href.split("#")[0].split("?")[0] || "/");
    }
    try {
      const u = new URL(href, location.href);
      if (u.hash && /^#\//.test(u.hash)) {
        const h = u.hash.slice(1);
        return h.startsWith("/") ? h : "/" + h;
      }
      if (HASH_ROUTING) return "/";
      return stripAppBase(u.pathname || "/");
    } catch {
      return "/";
    }
  }

  function normalizeRouteTag(raw) {
    const tag = String(raw || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (!tag || tag.length > 24) return "";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) return "";
    return tag;
  }

  function isCommunityName(raw) {
    if (window.HiveApi && typeof HiveApi.isCommunityName === "function") {
      return HiveApi.isCommunityName(raw);
    }
    return /^hive-\d+$/i.test(String(raw || "").trim());
  }

  function normalizeCommunityName(raw) {
    const name = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .replace(/^c\//i, "")
      .toLowerCase();
    return isCommunityName(name) ? name : "";
  }

  function normalizeCommunityPage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "created" || page === "latest") return "created";
    if (page === "trending" || page === "hot") return page;
    if (page === "rules" || page === "about") return "rules";
    if (page === "members" || page === "roles") return "members";
    return "";
  }

  function pathForCommunity(name, page) {
    const n = normalizeCommunityName(name);
    if (!n) return "/";
    const p = normalizeCommunityPage(page) || "created";
    return "/c/" + n + "/" + p;
  }

  function communityHref(name, page) {
    return appHref(pathForCommunity(name, page));
  }

  function normalizeProfilePage(raw) {
    const page = String(raw || "")
      .trim()
      .toLowerCase();
    if (!page || page === "posts" || page === "blog") return "posts";
    if (page === "comments") return "comments";
    if (page === "replies") return "replies";
    if (page === "wallet") return "wallet";
    return "";
  }

  function pathForProfile(author, page) {
    const a = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (!a) return "/";
    const p = normalizeProfilePage(page) || "posts";
    if (p === "posts") return "/@" + a;
    return "/@" + a + "/" + p;
  }

  function profileHref(author, page) {
    return appHref(pathForProfile(author, page));
  }

  function parseRoute(pathname) {
    let path = pathname == null ? currentPath() : pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "index.html") parts.shift();

    if (parts.length === 0) {
      return { name: "feed", sort: "created", tag: "" };
    }

    const first = parts[0].toLowerCase();
    if (parts.length === 1 && first === "publish") {
      return { name: "publish" };
    }
    if (parts.length === 1 && first === "tags") {
      return { name: "tags" };
    }
    if (parts.length === 1 && first === "communities") {
      return { name: "communities" };
    }
    if (parts.length === 1 && first === "welcome") {
      return { name: "welcome" };
    }
    if (parts.length === 1 && first === "imprint") {
      return { name: "imprint" };
    }

    if (first === "c" && parts.length >= 2) {
      const community = normalizeCommunityName(parts[1]);
      if (!community) return { name: "notfound" };
      if (parts.length === 2) {
        return { name: "community", community, page: "created" };
      }
      if (parts.length === 3) {
        const page = normalizeCommunityPage(parts[2]);
        if (page) return { name: "community", community, page };
      }
      return { name: "notfound" };
    }

    let sort = "";
    if (first === "created" || first === "latest") sort = "created";
    else if (first === "feed") sort = "feed";
    else if (first === "trending" || first === "hot") sort = first;

    if (sort) {
      if (parts.length === 1) {
        return { name: "feed", sort, tag: "" };
      }
      if (parts.length === 2 && sort !== "feed") {
        const tag = normalizeRouteTag(parts[1]);
        if (tag) {
          const community = normalizeCommunityName(tag);
          if (community) return { name: "community", community, page: sort };
          return { name: "feed", sort, tag };
        }
      }
      return { name: "notfound" };
    }

    const at = parts.findIndex((p) => p.startsWith("@"));
    if (at >= 0) {
      const author = parts[at].slice(1).toLowerCase();
      if (!/^[a-z0-9.\-]{3,16}$/.test(author)) {
        return { name: "notfound" };
      }
      if (at === 0 && parts.length <= 2) {
        if (parts.length === 1) return { name: "profile", author, page: "posts" };
        const page = normalizeProfilePage(parts[1]);
        if (page) return { name: "profile", author, page };
      }
      const permlink = parts[at + 1];
      if (permlink) return { name: "post", author, permlink };
      return { name: "profile", author, page: "posts" };
    }

    return { name: "notfound" };
  }

  function routeKey(r) {
    if (!r) return "";
    if (r.name === "feed") {
      return r.tag ? "feed:" + r.sort + ":" + r.tag : "feed:" + r.sort;
    }
    if (r.name === "post") return "post:" + r.author + "/" + r.permlink;
    if (r.name === "profile") return "profile:" + r.author + ":" + (r.page || "posts");
    if (r.name === "community") return "community:" + r.community + ":" + r.page;
    return r.name || "";
  }

  function pathFromViewKey(key) {
    if (!key || key === "notfound") return "/";
    if (key === "welcome") return "/welcome";
    if (key === "imprint") return "/imprint";
    if (key === "tags") return "/tags";
    if (key === "communities") return "/communities";
    if (key.indexOf("feed:") === 0) {
      const rest = key.slice(5);
      const colon = rest.indexOf(":");
      if (colon >= 0) return pathForFeedSort(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForFeedSort(rest);
    }
    if (key.indexOf("post:") === 0) return "/@" + key.slice(5);
    if (key.indexOf("profile:") === 0) {
      const rest = key.slice(8);
      const colon = rest.lastIndexOf(":");
      if (colon >= 0) return pathForProfile(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForProfile(rest);
    }
    if (key.indexOf("community:") === 0) {
      const rest = key.slice(11);
      const colon = rest.lastIndexOf(":");
      if (colon >= 0) return pathForCommunity(rest.slice(0, colon), rest.slice(colon + 1));
      return pathForCommunity(rest);
    }
    return "/";
  }

  function isHomePath(pathname) {
    let path = pathname == null ? currentPath() : pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "index.html") parts.shift();
    return parts.length === 0;
  }

  function pathForFeedSort(sort, tag) {
    const t = normalizeRouteTag(tag);
    if (t) {
      if (sort === "trending") return "/trending/" + t;
      if (sort === "hot") return "/hot/" + t;
      return "/created/" + t;
    }
    if (sort === "feed") return "/feed";
    if (sort === "trending") return "/trending";
    if (sort === "hot") return "/hot";
    if (sort === "created") return observer() ? "/created" : "/";
    return "/";
  }

  function tagFeedHref(tag, sort) {
    const t = normalizeRouteTag(tag);
    if (!t) return appHref("/");
    const s = sort === "hot" || sort === "trending" ? sort : "created";
    if (isCommunityName(t)) return communityHref(t, s);
    return appHref(pathForFeedSort(s, t));
  }

  function tagChipHtml(tag) {
    const t = normalizeRouteTag(tag) || String(tag || "").replace(/^#/, "").trim().toLowerCase();
    if (!t) return "";
    const href = isCommunityName(t) ? communityHref(t, "created") : appHref("/created/" + t);
    return `<a class="tag" href="${HiveMd.escapeHtml(href)}">#${HiveMd.escapeHtml(t)}</a>`;
  }

  function readStoredFeedView() {
    try {
      const raw = localStorage.getItem(FEED_VIEW_KEY);
      if (FEED_SORTS.indexOf(raw) >= 0) return raw;
    } catch {
      /* private mode */
    }
    return null;
  }

  function storeFeedView(sort) {
    if (!observer() || FEED_SORTS.indexOf(sort) < 0) return;
    try {
      localStorage.setItem(FEED_VIEW_KEY, sort);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function readFavoriteTags() {
    try {
      const raw = localStorage.getItem(FAVORITE_TAGS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((t) => normalizeRouteTag(t) || normalizeTag(t))
        .filter((t, i, arr) => t && arr.indexOf(t) === i)
        .slice(0, MAX_FAVORITE_TAGS);
    } catch {
      return [];
    }
  }

  function storeFavoriteTags(tags) {
    try {
      localStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(tags));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function communityIdFromInput(raw) {
    const s = String(raw || "")
      .trim()
      .replace(/^@/, "")
      .replace(/^c\//i, "");
    if (/^hive-\d+$/i.test(s)) return s.toLowerCase();
    if (/^\d+$/.test(s)) return "hive-" + s;
    return "";
  }

  function favoriteCommunityRecord(row) {
    if (typeof row === "string") {
      const name = normalizeCommunityName(row) || communityIdFromInput(row);
      return name ? { name, title: name } : null;
    }
    if (!row || typeof row !== "object") return null;
    const name = normalizeCommunityName(row.name) || communityIdFromInput(row.name);
    if (!name) return null;
    const title = String(row.title || name).trim() || name;
    return { name, title };
  }

  function readFavoriteCommunities() {
    try {
      const raw = localStorage.getItem(FAVORITE_COMMUNITIES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out = [];
      const seen = new Set();
      parsed.forEach((row) => {
        const rec = favoriteCommunityRecord(row);
        if (!rec || seen.has(rec.name)) return;
        seen.add(rec.name);
        out.push(rec);
      });
      return out.slice(0, MAX_FAVORITE_COMMUNITIES);
    } catch {
      return [];
    }
  }

  function storeFavoriteCommunities(list) {
    try {
      localStorage.setItem(
        FAVORITE_COMMUNITIES_KEY,
        JSON.stringify(
          list.map((row) => ({
            name: row.name,
            title: row.title || row.name,
          }))
        )
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function isFavoriteCommunity(name) {
    const id = normalizeCommunityName(name);
    if (!id) return false;
    return readFavoriteCommunities().some((c) => c.name === id);
  }

  function defaultFeedSort() {
    if (!observer()) return "created";
    return readStoredFeedView() || "feed";
  }

  function rememberNonPublishPath() {
    const here = currentPath();
    if (parseRoute(here).name !== "publish") lastNonPublishPath = here || "/";
  }

  function hashFragment(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.href);
      if (u.hash && !/^#\//.test(u.hash)) return u.hash;
    } catch {
      const i = String(href).indexOf("#");
      if (i >= 0) {
        const h = href.slice(i);
        if (h && !h.startsWith("#/")) return h;
      }
    }
    return "";
  }

  function navigate(href, replace) {
    const path = hrefToPath(href);
    if (parseRoute(path).name === "publish") rememberNonPublishPath();
    if (HASH_ROUTING) {
      const next = "#" + (path.startsWith("/") ? path : "/" + path);
      const url = location.pathname + location.search + next;
      if (replace) {
        history.replaceState(null, "", url);
        route();
        return;
      }
      if (location.hash === next) {
        route();
        return;
      }
      location.hash = next.slice(1);
      return;
    }
    const url = appHref(path) + hashFragment(href);
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    route();
  }

  function isInternalHref(href) {
    if (!href) return false;
    if (href.startsWith("#/")) return true;
    if (href.startsWith("#")) return false;
    if (href.startsWith("/") && !href.startsWith("//")) return true;
    try {
      const u = new URL(href, location.href);
      if (location.protocol === "file:") return u.protocol === "file:";
      return u.origin === location.origin;
    } catch {
      return false;
    }
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    const commentFrag = hashFragment(href);
    if (commentFrag.startsWith("#@") && scrollToAnchor(commentFrag)) {
      e.preventDefault();
      if (!HASH_ROUTING) {
        try {
          const u = new URL(href, location.href);
          if (u.pathname === location.pathname) {
            history.pushState(null, "", u.pathname + u.search + u.hash);
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const toComments =
      a.classList.contains("comment-count-link") || href === "#comments" || /#comments$/.test(href);
    if (toComments && document.getElementById("comments")) {
      e.preventDefault();
      pendingCommentsScroll = false;
      scrollToComments();
      return;
    }
    if (toComments) pendingCommentsScroll = true;
    if (!isInternalHref(href)) return;
    if (HASH_ROUTING) {
      if (href.startsWith("#/") || href === "#") return;
      e.preventDefault();
      navigate(appHref(hrefToPath(href)));
      return;
    }
    try {
      const u = new URL(href, location.href);
      if (u.pathname === location.pathname && u.hash && !/^#\//.test(u.hash)) return;
      if (u.pathname === location.pathname && u.search === location.search && !u.hash) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      navigate(u.pathname + u.search + u.hash);
    } catch {
      e.preventDefault();
      navigate(href);
    }
  });

  window.addEventListener("popstate", () => {
    if (!HASH_ROUTING) route();
  });
  window.addEventListener("hashchange", () => {
    if (HASH_ROUTING || /^#\//.test(location.hash || "")) route();
  });

  /* ─── Session / login ─── */
  function resetNotifs() {
    notifGen += 1;
    notifState.user = "";
    notifState.unread = 0;
    notifState.lastread = "";
    notifState.items = [];
    notifState.error = "";
    notifState.loaded = false;
    notifState.markedAt = 0;
  }

  let resourceGen = 0;
  const resourceState = {
    user: "",
    mana: "",
    vote: "",
    rc: "",
    manaLow: false,
    rcLow: false,
  };

  function resetResources() {
    resourceGen += 1;
    resourceState.user = "";
    resourceState.mana = "";
    resourceState.vote = "";
    resourceState.rc = "";
    resourceState.manaLow = false;
    resourceState.rcLow = false;
  }

  function roundedResourcePercent(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  function formatResourcePercent(value) {
    return roundedResourcePercent(value) + "%";
  }

  function formatResourceAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0.00";
    return Math.abs(n).toFixed(2);
  }

  function paintAccountResources() {
    const el = $("#sessionAccountStats");
    if (!el) return;
    const mana = el.querySelector("[data-stat='mana']");
    const vote = el.querySelector("[data-stat='vote']");
    const rc = el.querySelector("[data-stat='rc']");
    if (!mana || !vote || !rc) return;
    const manaStat = mana.closest(".session-stat");
    const rcStat = rc.closest(".session-stat");
    const ready = resourceState.user === observer() && resourceState.mana;
    if (!ready) {
      mana.textContent = "…";
      vote.textContent = "…";
      rc.textContent = "…";
      if (manaStat) manaStat.classList.remove("is-low");
      if (rcStat) rcStat.classList.remove("is-low");
      el.classList.add("is-loading");
      return;
    }
    mana.textContent = resourceState.mana;
    vote.textContent = resourceState.vote;
    rc.textContent = resourceState.rc;
    if (manaStat) manaStat.classList.toggle("is-low", resourceState.manaLow);
    if (rcStat) rcStat.classList.toggle("is-low", resourceState.rcLow);
    el.classList.remove("is-loading");
  }

  async function loadAccountResources() {
    const user = observer();
    if (!user) return;
    const gen = ++resourceGen;
    if (resourceState.user !== user) {
      resourceState.user = user;
      resourceState.mana = "";
      resourceState.vote = "";
      resourceState.rc = "";
      resourceState.manaLow = false;
      resourceState.rcLow = false;
      paintAccountResources();
    }
    try {
      const info = await HiveApi.getAccountResources(user);
      if (gen !== resourceGen || observer() !== user || !info) return;
      resourceState.user = user;
      resourceState.mana = formatResourcePercent(info.votingMana);
      resourceState.vote = formatResourceAmount(info.voteValue);
      resourceState.rc = info.rc == null ? "—" : formatResourcePercent(info.rc);
      resourceState.manaLow = roundedResourcePercent(info.votingMana) <= 20;
      resourceState.rcLow = info.rc != null && roundedResourcePercent(info.rc) <= 20;
      paintAccountResources();
    } catch {
      /* keep the last line; the menu still shows notifications */
    }
  }

  function stopNotifPoll() {
    if (notifTimer) {
      window.clearInterval(notifTimer);
      notifTimer = 0;
    }
  }

  function startNotifPoll() {
    stopNotifPoll();
    notifTimer = window.setInterval(() => {
      if (observer()) {
        loadNotifications();
        loadAccountResources();
      } else stopNotifPoll();
    }, NOTIF_POLL_MS);
  }

  function notificationHref(url) {
    let raw = String(url || "").trim();
    if (!raw) return "";
    raw = raw.replace(/^https?:\/\/(?:www\.)?(?:hive\.blog|peakd\.com|ecency\.com)\//i, "");
    raw = raw.replace(/^\//, "");
    const at = raw.indexOf("@");
    if (at < 0) return "";
    return appHref("/" + raw.slice(at));
  }

  function notificationActor(item) {
    const m = String((item && item.msg) || "").match(/^@([a-z0-9.\-]{3,16})/i);
    if (m) return m[1].toLowerCase();
    if (item && item.type === "follow") {
      const fromUrl = String((item && item.url) || "").match(/@([a-z0-9.\-]{3,16})/i);
      if (fromUrl) return fromUrl[1].toLowerCase();
    }
    return "";
  }

  function notificationItemHref(item) {
    const href = notificationHref(item && item.url);
    if (href) return href;
    if (item && item.type === "follow") {
      const actor = notificationActor(item);
      if (actor) return appHref("/@" + actor);
    }
    return "";
  }

  function notificationMessage(item) {
    let msg = String((item && item.msg) || "");
    if (item && item.type === "vote" && msg && !/\(-/.test(msg)) {
      msg = msg.replace(" voted on ", " upvoted ");
    }
    if (item && item.type === "follow" && !msg) {
      const actor = notificationActor(item);
      msg = actor ? "@" + actor + " followed you" : "Someone followed you";
    }
    return msg;
  }

  function notificationKindLabel(item) {
    const t = item && item.type;
    if (t === "vote") return "upvote";
    if (t === "follow") return "follow";
    return "";
  }

  function isPriorityNotif(item) {
    const t = item && item.type;
    return t === "vote" || t === "follow";
  }

  function pickNotificationItems(items) {
    const list = Array.isArray(items) ? items : [];
    if (list.length <= NOTIF_SHOW) return list.slice();
    const seen = new Set();
    const out = [];
    function add(item) {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      out.push(item);
    }
    for (let i = 0; i < list.length && out.length < NOTIF_SHOW; i++) add(list[i]);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!isPriorityNotif(item) || seen.has(item.id)) continue;
      let drop = -1;
      for (let j = out.length - 1; j >= 0; j--) {
        if (!isPriorityNotif(out[j])) {
          drop = j;
          break;
        }
      }
      if (drop < 0) break;
      seen.delete(out[drop].id);
      out.splice(drop, 1);
      add(item);
    }
    out.sort((a, b) => {
      const db = String((b && b.date) || "");
      const da = String((a && a.date) || "");
      if (db !== da) return db.localeCompare(da);
      return String((b && b.id) || "").localeCompare(String((a && a.id) || ""));
    });
    return out;
  }

  function isNotifUnread(item, lastread) {
    if (!lastread) return true;
    const itemTs = parseCreatedTs(item && item.date);
    const readTs = parseCreatedTs(String(lastread).replace(" ", "T"));
    if (!Number.isFinite(itemTs) || !Number.isFinite(readTs)) return false;
    return itemTs > readTs;
  }

  function notificationButtonLabel() {
    const n = notifState.unread;
    if (!n) return "Notifications";
    return n + " unread notification" + (n === 1 ? "" : "s");
  }

  function paintBadge() {
    const badge = $("#sessionBadge");
    const btn = document.querySelector(".session-avatar-btn");
    const label = notificationButtonLabel();
    if (btn) btn.setAttribute("aria-label", label);
    if (badge) {
      const n = notifState.unread;
      if (!n) {
        badge.hidden = true;
        badge.textContent = "";
        badge.removeAttribute("aria-label");
      } else {
        badge.hidden = false;
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.setAttribute("aria-label", label);
      }
    }
    paintMarkRead();
  }

  function hiveUtcDate() {
    return new Date().toISOString().slice(0, 19);
  }

  function paintMarkRead() {
    const btn = $("#markReadBtn");
    if (!btn || btn.dataset.pending === "1") return;
    btn.disabled = !(notifState.loaded && notifState.unread > 0);
  }

  function paintNotifs() {
    const wrap = $("#sessionNotifs");
    if (!wrap) return;
    if (!notifState.loaded && !notifState.error) {
      wrap.innerHTML = `<p class="session-notifs-empty">Loading…</p>`;
      return;
    }
    if (notifState.error && !notifState.items.length) {
      wrap.innerHTML = `<p class="session-notifs-empty">${HiveMd.escapeHtml(notifState.error)}</p>`;
      return;
    }
    if (!notifState.items.length) {
      wrap.innerHTML = `<p class="session-notifs-empty">No notifications</p>`;
      return;
    }
    wrap.innerHTML = notifState.items
      .map((item) => {
        const actor = notificationActor(item);
        const href = notificationItemHref(item);
        const unread = isNotifUnread(item, notifState.lastread);
        const type = item && item.type ? String(item.type) : "";
        const cls =
          "session-notif" +
          (unread ? " is-unread" : "") +
          (type === "vote" ? " is-vote" : "") +
          (type === "follow" ? " is-follow" : "");
        const avatar = actor
          ? `<img class="session-notif-avatar" src="${HiveMd.avatarUrl(actor, "small")}" alt="">`
          : "";
        const kind = notificationKindLabel(item);
        const time = timeAgo(item.date);
        const meta = kind ? kind + (time ? " · " + time : "") : time;
        const body =
          avatar +
          `<span class="session-notif-body">` +
          `<span class="session-notif-msg">${HiveMd.escapeHtml(notificationMessage(item))}</span>` +
          `<span class="session-notif-time">${HiveMd.escapeHtml(meta)}</span>` +
          `</span>`;
        if (href) {
          return `<a class="${cls}" href="${HiveMd.escapeHtml(href)}">${body}</a>`;
        }
        return `<div class="${cls}">${body}</div>`;
      })
      .join("");
  }

  async function loadNotifications() {
    const user = observer();
    if (!user) return;
    const gen = ++notifGen;
    notifState.user = user;
    try {
      const [unread, items] = await Promise.all([
        HiveApi.unreadNotifications(user),
        HiveApi.accountNotifications(user, { limit: NOTIF_LIMIT }),
      ]);
      if (gen !== notifGen || observer() !== user) return;
      const markedFresh = notifState.markedAt && Date.now() - notifState.markedAt < 45000;
      notifState.items = pickNotificationItems(items);
      notifState.loaded = true;
      notifState.error = "";
      if (markedFresh && unread.unread > 0) {
        notifState.unread = 0;
      } else {
        notifState.unread = unread.unread;
        notifState.lastread = unread.lastread || "";
        notifState.markedAt = 0;
      }
      paintBadge();
      paintNotifs();
    } catch (err) {
      if (gen !== notifGen) return;
      notifState.error = (err && err.message) || "Could not load notifications.";
      if (!notifState.loaded) paintNotifs();
    }
  }

  function markNotificationsRead() {
    const user = observer();
    if (!user) return;
    const btn = $("#markReadBtn");
    if (btn && (btn.disabled || btn.dataset.pending === "1")) return;
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    const date = hiveUtcDate();
    if (btn) {
      btn.dataset.pending = "1";
      btn.disabled = true;
      btn.textContent = "Marking…";
    }
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "notify",
            json: JSON.stringify(["setLastRead", { date }]),
          },
        ],
      ],
      meta: { type: "notify", action: "setLastRead" },
    });
    promise
      .then(() => {
        notifState.unread = 0;
        notifState.lastread = date;
        notifState.markedAt = Date.now();
        paintBadge();
        paintNotifs();
      })
      .catch((err) => {
        showError(err.message || String(err));
      })
      .finally(() => {
        const el = $("#markReadBtn");
        if (!el) return;
        el.dataset.pending = "";
        el.textContent = "Mark as read";
        paintMarkRead();
      });
  }

  function logout() {
    closeLogoMenu();
    sessionStorage.removeItem(SESSION_KEY);
    clearKeychainUser();
    if (window.HiveAuth) HiveAuth.clear();
    hivePower = null;
    hivePowerUser = "";
    localVotes.clear();
    votesCache.clear();
    payoutByKey.clear();
    voteRefreshGen.clear();
    hideVoteSlider();
    pendingPublish = false;
    publishSubs = [];
    publishSubsUser = "";
    resetPublishForm();
    hidePublishOverlay({ persist: false });
    stopNotifPoll();
    resetNotifs();
    resetResources();
    renderSession();
    currentViewKey = "";
    if (parseRoute().name === "publish") navigate(appHref("/"), true);
    else route();
  }

  function logoFeedHref() {
    return appHref(pathForFeedSort(observer() ? "feed" : "created"));
  }

  function paintLogoMenu() {
    const user = observer();
    const profile = $("#logoProfileLink");
    const wallet = $("#logoWalletLink");
    const welcome = $("#logoWelcomeLink");
    const feed = $("#logoFeedLink");
    const tags = $("#logoTagsLink");
    const communities = $("#logoCommunitiesLink");
    const favs = $("#logoFavTags");
    const favComms = $("#logoFavCommunities");
    const trigger = $("#logoTrigger");
    const panel = document.querySelector("#logoDropdown .logo-dropdown-panel");
    const menuLabel = user
      ? "Profile, wallet, welcome, feed, tags, and communities"
      : "Welcome, feed, tags, and communities";
    if (trigger) trigger.setAttribute("aria-label", "Open " + menuLabel.toLowerCase());
    if (panel) panel.setAttribute("aria-label", menuLabel);
    if (profile) {
      profile.hidden = !user;
      if (user) profile.setAttribute("href", profileHref(user));
    }
    if (wallet) {
      wallet.hidden = !user;
      if (user) wallet.setAttribute("href", profileHref(user, "wallet"));
    }
    if (welcome) welcome.setAttribute("href", appHref("/welcome"));
    if (feed) feed.setAttribute("href", logoFeedHref());
    if (tags) tags.setAttribute("href", appHref("/tags"));
    if (communities) communities.setAttribute("href", appHref("/communities"));
    if (favs) {
      const list = readFavoriteTags().slice(0, LOGO_FAVORITES_SHOW);
      if (!list.length) {
        favs.hidden = true;
        favs.innerHTML = "";
      } else {
        favs.hidden = false;
        favs.innerHTML = list
          .map((t) => {
            const safe = HiveMd.escapeHtml(t);
            return `<a class="logo-dropdown-link" href="${HiveMd.escapeHtml(tagFeedHref(t))}">#${safe}</a>`;
          })
          .join("");
      }
    }
    if (!favComms) return;
    const comms = readFavoriteCommunities().slice(0, LOGO_FAVORITES_SHOW);
    if (!comms.length) {
      favComms.hidden = true;
      favComms.innerHTML = "";
      return;
    }
    favComms.hidden = false;
    favComms.innerHTML = comms
      .map((c) => {
        const title = HiveMd.escapeHtml(c.title || c.name);
        return `<a class="logo-dropdown-link" href="${HiveMd.escapeHtml(communityHref(c.name))}">${title}</a>`;
      })
      .join("");
  }

  function closeLogoMenu() {
    const menu = $("#logoMenu");
    const trigger = $("#logoTrigger");
    if (menu) menu.classList.remove("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    closeNodeMenus();
  }

  function renderSession() {
    paintLogoMenu();
    const user = observer();
    if (user) {
      const profileUrl = HiveMd.escapeHtml(profileHref(user));
      const commentsUrl = HiveMd.escapeHtml(profileHref(user, "comments"));
      const repliesUrl = HiveMd.escapeHtml(profileHref(user, "replies"));
      const walletUrl = HiveMd.escapeHtml(profileHref(user, "wallet"));
      sessionSlot.innerHTML = `
        <div class="session-menu" id="sessionMenu">
          <div class="session-chip">
            <button type="button" class="session-avatar-btn" aria-haspopup="true" aria-expanded="false" aria-controls="sessionDropdown" aria-label="Notifications">
              <span class="session-avatar-wrap">
                <img src="${HiveMd.avatarUrl(user, "small")}" alt="" width="22" height="22">
                <span class="session-badge" id="sessionBadge" hidden></span>
              </span>
            </button>
            <div class="session-account" id="sessionAccount">
              <a class="session-name" href="${profileUrl}" aria-haspopup="true" aria-expanded="false" aria-controls="sessionAccountMenu">@${HiveMd.escapeHtml(user)}</a>
              <div class="session-account-menu" id="sessionAccountMenu">
                <nav class="session-account-panel" aria-label="Account">
                  <a class="session-account-link" href="${profileUrl}">Profile</a>
                  <a class="session-account-link" href="${commentsUrl}">Comments</a>
                  <a class="session-account-link" href="${repliesUrl}">Replies</a>
                  <a class="session-account-link" href="${walletUrl}">Wallet</a>
                  <button type="button" class="session-account-link" id="accountLogoutBtn">Logout</button>
                </nav>
              </div>
            </div>
          </div>
          <div class="session-dropdown" id="sessionDropdown">
            <div class="session-dropdown-panel">
              <div class="session-account-stats is-loading" id="sessionAccountStats" aria-label="Voting mana, vote value, and resource credits">
                <span class="session-account-stats-main">
                  <span class="session-stat" tabindex="0"><span class="session-stat-label">▲</span><span class="session-stat-value" data-stat="mana">…</span><span class="session-stat-tip" role="tooltip">Voting Mana</span></span>
                  <span class="session-stat" tabindex="0"><span class="session-stat-label">H</span><span class="session-stat-value" data-stat="vote">…</span><span class="session-stat-tip" role="tooltip">Estimated Vote Value</span></span>
                </span>
                <span class="session-stat session-stat-rc" tabindex="0"><span class="session-stat-label">RC</span><span class="session-stat-value" data-stat="rc">…</span><span class="session-stat-tip" role="tooltip">Resource Credits</span></span>
              </div>
              <div class="session-notifs" id="sessionNotifs" aria-label="Notifications"></div>
              <div class="session-menu-actions">
                <button type="button" class="session-mark-read" id="markReadBtn">Mark as read</button>
                <button type="button" class="session-logout" id="logoutBtn">Logout</button>
              </div>
            </div>
          </div>
        </div>
      `;
      $("#logoutBtn").addEventListener("click", logout);
      $("#accountLogoutBtn").addEventListener("click", logout);
      $("#markReadBtn").addEventListener("click", markNotificationsRead);
      bindSessionAccount();
      paintBadge();
      paintNotifs();
      paintAccountResources();
      loadNotifications();
      loadAccountResources();
      startNotifPoll();
    } else {
      stopNotifPoll();
      resetNotifs();
      resetResources();
      sessionSlot.innerHTML = `<button type="button" class="btn-login" id="loginBtn">Login</button>`;
      $("#loginBtn").addEventListener("click", openLogin);
    }
  }

  function setAccountMenuOpen(open) {
    const account = $("#sessionAccount");
    if (!account) return;
    account.classList.toggle("is-open", Boolean(open));
    const name = account.querySelector(".session-name");
    if (name) name.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function bindSessionAccount() {
    const account = $("#sessionAccount");
    if (!account) return;
    const name = account.querySelector(".session-name");
    const expanded = (open) => {
      if (name) name.setAttribute("aria-expanded", open ? "true" : "false");
    };
    account.addEventListener("pointerenter", () => {
      if (!hoverFine()) return;
      setSessionMenuOpen(false);
      closeNodeMenus();
      expanded(true);
    });
    account.addEventListener("pointerleave", () => {
      if (!hoverFine()) return;
      if (!account.classList.contains("is-open")) expanded(false);
    });
    account.addEventListener("focusin", () => {
      setSessionMenuOpen(false);
      expanded(true);
    });
    account.addEventListener("focusout", (e) => {
      if (e.relatedTarget && account.contains(e.relatedTarget)) return;
      if (!account.classList.contains("is-open")) expanded(false);
    });
  }

  function setSessionMenuOpen(open) {
    const menu = $("#sessionMenu");
    if (!menu) return;
    menu.classList.toggle("is-open", Boolean(open));
    const btn = menu.querySelector(".session-avatar-btn");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      setAccountMenuOpen(false);
      loadAccountResources();
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      const menu = $("#sessionMenu");
      if (!menu) return;
      const avatarBtn = e.target.closest(".session-avatar-btn");
      if (avatarBtn && menu.contains(avatarBtn)) {
        e.preventDefault();
        setSessionMenuOpen(!menu.classList.contains("is-open"));
        return;
      }
      const account = $("#sessionAccount");
      const nameLink = e.target.closest(".session-name");
      if (nameLink && account && account.contains(nameLink) && !hoverFine()) {
        e.preventDefault();
        const open = !account.classList.contains("is-open");
        setSessionMenuOpen(false);
        setAccountMenuOpen(open);
        return;
      }
      if (e.target.closest(".session-account-link")) {
        setAccountMenuOpen(false);
        setSessionMenuOpen(false);
        const focused = document.activeElement;
        if (focused && focused.closest && focused.closest("#sessionAccount")) focused.blur();
        return;
      }
      if (
        e.target.closest(".session-name") ||
        e.target.closest(".session-notif") ||
        !menu.contains(e.target)
      ) {
        setSessionMenuOpen(false);
      }
      if (account && !account.contains(e.target)) setAccountMenuOpen(false);
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (publishDiscardOpen()) {
      hidePublishDiscard();
      return;
    }
    if (overlay && !overlay.hidden) {
      closeLogin();
      return;
    }
    const walletOv = $("#walletOverlay");
    if (walletOv && !walletOv.hidden) {
      closeWalletOverlay();
      return;
    }
    if (nodeOverlayOpen()) {
      closeNodeOverlay();
      return;
    }
    setSessionMenuOpen(false);
    const account = $("#sessionAccount");
    if (account && document.activeElement && account.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setAccountMenuOpen(false);
    closeNodeMenus();
    closeLogoMenu();
  });

  function openLogin() {
    overlay.hidden = false;
    const status = $("#loginStatus");
    if (status) status.textContent = "";
    const input = $("#loginUser");
    if (input) input.focus();
  }

  let loginBusy = false;

  function closeLogin() {
    overlay.hidden = true;
    loginBusy = false;
    const keyInput = $("#loginKey");
    if (keyInput) keyInput.value = "";
    const status = $("#loginStatus");
    if (status) status.textContent = "";
    const connectBtn = $("#loginConnect");
    if (connectBtn) connectBtn.disabled = false;
  }

  function finishLogin(username, method) {
    sessionStorage.setItem(SESSION_KEY, username);
    if (method === "keychain") writeKeychainUser(username);
    else clearKeychainUser();
    hivePower = null;
    hivePowerUser = "";
    closeLogin();
    renderSession();
    refreshHivePower();
    currentViewKey = "";
    if (pendingPublish) {
      pendingPublish = false;
      navigate(appHref("/publish"));
    } else if (isHomePath()) {
      navigate(appHref(pathForFeedSort(defaultFeedSort())), true);
    } else {
      route();
    }
  }

  function connectKeychain(username, status) {
    if (!window.hive_keychain) {
      loginBusy = false;
      status.textContent =
        "Enter a posting key to sign in. The public feed stays available.";
      return;
    }
    status.textContent = "Waiting for Keychain…";
    window.hive_keychain.requestSignBuffer(
      username,
      "Crypto Space 77 login",
      "Posting",
      (res) => {
        if (res && res.success) {
          const done = window.HiveAuth ? HiveAuth.clear() : Promise.resolve();
          Promise.resolve(done)
            .catch(() => {})
            .then(() => {
              loginBusy = false;
              finishLogin(username, "keychain");
            });
        } else {
          loginBusy = false;
          status.textContent = (res && res.message) || "Keychain login was cancelled.";
        }
      }
    );
  }

  async function connectLogin() {
    if (loginBusy) return;
    const username = normalizeLoginUser($("#loginUser").value);
    const status = $("#loginStatus");
    const keyInput = $("#loginKey");
    const connectBtn = $("#loginConnect");
    const wif = ((keyInput && keyInput.value) || "").replace(/\s+/g, "");
    if (!status) return;
    if (!validLoginUser(username)) {
      status.textContent = "Enter a valid Hive username.";
      return;
    }
    if (wif) {
      loginBusy = true;
      if (connectBtn) connectBtn.disabled = true;
      status.textContent = "Checking posting key…";
      try {
        await HiveAuth.login(username, wif);
        finishLogin(username, "posting");
      } catch (err) {
        status.textContent = (err && err.message) || String(err);
      } finally {
        loginBusy = false;
        if (connectBtn) connectBtn.disabled = false;
      }
      return;
    }
    loginBusy = true;
    connectKeychain(username, status);
  }

  /* ─── Publish ─── */
  function setPublishStatus(msg, isError) {
    const el = $("#publishStatus");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function paintPublishChrome() {
    const editing = Boolean(publishEdit);
    const h2 = $("#publishPage h2");
    const submit = $("#publishSubmit");
    const dest = $("#publishDest");
    const pageEl = $("#publishPage");
    if (h2) h2.textContent = editing ? "Edit post" : "New post";
    if (submit) submit.textContent = editing ? "Save" : "Publish";
    if (dest) dest.hidden = editing;
    if (pageEl) pageEl.classList.toggle("is-editing", editing);
  }

  function snapshotPublishForm() {
    savePublishDraft();
    const tagInput = $("#publishTagInput");
    return {
      title: publishTitleDraft,
      body: publishBodyDraft,
      tags: publishTags.slice(),
      dest: {
        type: publishDest.type,
        name: publishDest.name,
        title: publishDest.title,
      },
      tagInput: tagInput ? tagInput.value : "",
    };
  }

  function applyPublishForm(state) {
    publishTitleDraft = (state && state.title) || "";
    publishBodyDraft = (state && state.body) || "";
    publishTags = Array.isArray(state && state.tags) ? state.tags.slice() : [];
    if (state && state.dest) {
      publishDest = {
        type: state.dest.type === "community" && state.dest.name ? "community" : "blog",
        name: state.dest.type === "community" ? state.dest.name : "",
        title:
          state.dest.title ||
          (state.dest.type === "community" ? state.dest.name : "My blog"),
      };
    }
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagInput = $("#publishTagInput");
    if (title) title.value = publishTitleDraft;
    if (body) body.value = publishBodyDraft;
    if (tagInput) tagInput.value = (state && state.tagInput) || "";
    paintPublishDest();
    paintPublishTags();
    setPublishStatus("");
    updatePublishPreview();
  }

  function normalizeTag(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^#/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
  }

  function isValidTag(tag) {
    return /^[a-z][a-z0-9-]{1,23}$/.test(tag);
  }

  function postPermlink(title) {
    let slug = String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (!slug) slug = "post";
    return slug + "-" + Date.now().toString(36);
  }

  function paintPublishDest() {
    const user = observer();
    const img = $("#publishDestAvatar");
    const nameEl = $("#publishDestName");
    if (!img || !nameEl) return;
    if (publishDest.type === "community" && publishDest.name) {
      img.src = HiveMd.avatarUrl(publishDest.name, "small");
      nameEl.textContent = publishDest.title || publishDest.name;
    } else {
      img.src = user ? HiveMd.avatarUrl(user, "small") : "";
      nameEl.textContent = "My blog";
    }
  }

  function destOptionHtml(name, title, avatarName, selected) {
    return `<button type="button" class="publish-dest-option${selected ? " is-selected" : ""}" data-dest-type="${name ? "community" : "blog"}" data-dest-name="${HiveMd.escapeHtml(name)}" data-dest-title="${HiveMd.escapeHtml(title)}" role="option">
        <img class="avatar" src="${HiveMd.avatarUrl(avatarName, "small")}" alt="">
        <span>${HiveMd.escapeHtml(title)}</span>
      </button>`;
  }

  function renderDestMenu() {
    const menu = $("#publishDestMenu");
    const user = observer();
    if (!menu) return;
    const blogSelected = publishDest.type !== "community";
    const parts = [destOptionHtml("", "My blog", user, blogSelected)];
    publishSubs.forEach((c) => {
      const selected = publishDest.type === "community" && publishDest.name === c.name;
      parts.push(destOptionHtml(c.name, c.title || c.name, c.name, selected));
    });
    menu.innerHTML = parts.join("");
  }

  async function loadPublishSubs() {
    const user = observer();
    if (!user) {
      publishSubs = [];
      publishSubsUser = "";
      renderDestMenu();
      return;
    }
    if (publishSubsUser === user) {
      renderDestMenu();
      return;
    }
    const menu = $("#publishDestMenu");
    if (menu && !publishSubs.length) {
      menu.innerHTML = `<p class="publish-dest-empty">Loading communities…</p>`;
    }
    try {
      const list = await HiveApi.listAllSubscriptions(user);
      if (observer() !== user) return;
      publishSubs = list.slice().sort((a, b) =>
        String(a.title || a.name).localeCompare(String(b.title || b.name))
      );
      publishSubsUser = user;
    } catch {
      if (observer() !== user) return;
      publishSubs = [];
      publishSubsUser = "";
    }
    renderDestMenu();
  }

  function destMenuOpen() {
    const menu = $("#publishDestMenu");
    return Boolean(menu && !menu.hidden);
  }

  function closeDestMenu() {
    const menu = $("#publishDestMenu");
    const btn = $("#publishDestBtn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleDestMenu() {
    if (publishEdit) return;
    const menu = $("#publishDestMenu");
    const btn = $("#publishDestBtn");
    if (!menu || !btn) return;
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) loadPublishSubs();
  }

  function selectPublishDest(type, name, title) {
    if (publishEdit) return;
    publishDest = {
      type: type === "community" && name ? "community" : "blog",
      name: type === "community" ? name : "",
      title: title || (type === "community" ? name : "My blog"),
    };
    paintPublishDest();
    renderDestMenu();
    closeDestMenu();
    schedulePublishDraftSave();
  }

  function paintPublishTags() {
    const chips = $("#publishTagChips");
    const count = $("#publishTagCount");
    const input = $("#publishTagInput");
    if (chips) {
      chips.innerHTML = publishTags
        .map(
          (t) =>
            `<button type="button" class="publish-tag-chip" data-tag="${HiveMd.escapeHtml(t)}">${HiveMd.escapeHtml(t)} <span aria-hidden="true">×</span></button>`
        )
        .join("");
    }
    if (count) count.textContent = publishTags.length + "/" + MAX_TAGS;
    if (input) {
      input.disabled = publishTags.length >= MAX_TAGS;
      if (publishTags.length >= MAX_TAGS) input.placeholder = "Tag limit reached";
      else input.placeholder = "Add a tag";
    }
  }

  function addPublishTag(raw) {
    const tag = normalizeTag(raw);
    if (!tag) return false;
    if (!isValidTag(tag)) {
      setPublishStatus("Tags use 2–24 letters, numbers, or hyphens.", true);
      return false;
    }
    if (publishTags.indexOf(tag) !== -1) return false;
    if (publishTags.length >= MAX_TAGS) {
      setPublishStatus("You can add up to 10 tags.", true);
      return false;
    }
    publishTags.push(tag);
    setPublishStatus("");
    paintPublishTags();
    schedulePublishDraftSave();
    return true;
  }

  function takeTagsFromInput() {
    const input = $("#publishTagInput");
    if (!input) return;
    const parts = String(input.value || "").split(/[,\s]+/);
    input.value = "";
    parts.forEach((p) => addPublishTag(p));
  }

  let publishTitleDraft = "";
  let publishBodyDraft = "";

  function savePublishDraft() {
    const title = $("#publishTitle");
    const body = $("#publishBody");
    if (title) publishTitleDraft = title.value;
    if (body) publishBodyDraft = body.value;
  }

  function publishDraftStorageKey() {
    const user = observer();
    return user ? PUBLISH_DRAFT_KEY + ":" + user : "";
  }

  function publishFormHasContent() {
    savePublishDraft();
    const tagInput = $("#publishTagInput");
    const tagDraft = tagInput ? String(tagInput.value || "").trim() : "";
    return Boolean(
      String(publishTitleDraft || "").trim() ||
        String(publishBodyDraft || "").trim() ||
        publishTags.length ||
        tagDraft
    );
  }

  function readStoredPublishDraft() {
    const key = publishDraftStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const title = typeof parsed.title === "string" ? parsed.title : "";
      const body = typeof parsed.body === "string" ? parsed.body : "";
      const tagInput = typeof parsed.tagInput === "string" ? parsed.tagInput : "";
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((t) => typeof t === "string" && t)
        : [];
      const dest =
        parsed.dest && typeof parsed.dest === "object"
          ? {
              type: parsed.dest.type,
              name: parsed.dest.name,
              title: parsed.dest.title,
            }
          : null;
      if (!title && !body && !tagInput && !tags.length && !dest) return null;
      return { title, body, tags, dest, tagInput };
    } catch {
      return null;
    }
  }

  function storePublishDraft(state) {
    const key = publishDraftStorageKey();
    if (!key || !state) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          title: state.title || "",
          body: state.body || "",
          tags: Array.isArray(state.tags) ? state.tags : [],
          dest: state.dest || null,
          tagInput: state.tagInput || "",
        })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clearStoredPublishDraft() {
    const key = publishDraftStorageKey();
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function persistPublishDraftNow() {
    if (publishEdit) return;
    savePublishDraft();
    if (!publishFormHasContent()) {
      const ov = $("#publishOverlay");
      if (ov && !ov.hidden) clearStoredPublishDraft();
      return;
    }
    storePublishDraft(snapshotPublishForm());
  }

  function schedulePublishDraftSave() {
    if (publishEdit) return;
    if (publishDraftSaveSoon) clearTimeout(publishDraftSaveSoon);
    publishDraftSaveSoon = setTimeout(() => {
      publishDraftSaveSoon = 0;
      persistPublishDraftNow();
    }, 1000);
  }

  function stopPublishDraftAutosave() {
    if (publishDraftTimer) {
      clearInterval(publishDraftTimer);
      publishDraftTimer = 0;
    }
    if (publishDraftSaveSoon) {
      clearTimeout(publishDraftSaveSoon);
      publishDraftSaveSoon = 0;
    }
  }

  function startPublishDraftAutosave() {
    stopPublishDraftAutosave();
    if (publishEdit) return;
    publishDraftTimer = setInterval(persistPublishDraftNow, PUBLISH_DRAFT_SAVE_MS);
  }

  function hydratePublishDraftFromStorage() {
    if (publishEdit) return;
    const stored = readStoredPublishDraft();
    if (stored) applyPublishForm(stored);
  }

  function publishDiscardOpen() {
    const el = $("#publishDiscard");
    return Boolean(el && !el.hidden);
  }

  function hidePublishDiscard() {
    const el = $("#publishDiscard");
    if (el) el.hidden = true;
  }

  function showPublishDiscard() {
    const el = $("#publishDiscard");
    if (!el) return;
    const title = $("#publishDiscardTitle");
    const lead = $("#publishDiscardLead");
    if (title) title.textContent = publishEdit ? "Discard edits" : "Discard post";
    if (lead) {
      lead.textContent = publishEdit
        ? "Your edits will be discarded."
        : "This unpublished post will be deleted.";
    }
    el.hidden = false;
    const keep = $("#publishDiscardKeep");
    if (keep) keep.focus();
  }

  function cancelPublish() {
    if (publishDiscardOpen()) return;
    if (publishFormHasContent()) {
      showPublishDiscard();
      return;
    }
    discardPublishAndClose();
  }

  function discardPublishAndClose() {
    hidePublishDiscard();
    if (!publishEdit) {
      clearStoredPublishDraft();
      resetPublishForm();
    }
    closePublish({ persist: false });
  }

  function updatePublishPreview() {
    const preview = $("#publishPreview");
    if (!preview) return;
    const title = (($("#publishTitle") && $("#publishTitle").value) || "").trim();
    const body = ($("#publishBody") && $("#publishBody").value) || "";
    const heading = title ? `<h1>${HiveMd.escapeHtml(title)}</h1>` : "";
    const html = body.trim()
      ? HiveMd.renderMarkdown(body)
      : `<p class="feed-hint">Start writing to see a preview.</p>`;
    preview.innerHTML = heading + html;
  }

  function resetPublishForm() {
    publishEdit = null;
    publishStash = null;
    publishDest = { type: "blog", name: "", title: "My blog" };
    publishTags = [];
    publishTitleDraft = "";
    publishBodyDraft = "";
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagInput = $("#publishTagInput");
    if (title) title.value = "";
    if (body) body.value = "";
    if (tagInput) tagInput.value = "";
    paintPublishDest();
    paintPublishTags();
    setPublishStatus("");
    updatePublishPreview();
    const composer = $("#publishComposer");
    if (composer) {
      composer.classList.remove("is-pending", "is-uploading", "is-dragover");
      composerStatus(composer, "");
    }
    const submit = $("#publishSubmit");
    if (submit) submit.disabled = false;
    const pageEl = $("#publishPage");
    if (pageEl) pageEl.classList.remove("is-pending");
    closeDestMenu();
    paintPublishChrome();
  }

  function hidePublishOverlay(opts) {
    stopPublishDraftAutosave();
    hidePublishDiscard();
    const persist = !opts || opts.persist !== false;
    if (persist && !publishEdit) persistPublishDraftNow();
    const ov = $("#publishOverlay");
    if (ov) ov.hidden = true;
    closeDestMenu();
    setPublishFabHidden(false);
    if (publishEdit) {
      publishEdit = null;
      const stash = publishStash;
      publishStash = null;
      if (stash) applyPublishForm(stash);
      paintPublishChrome();
    }
  }

  function closePublish(opts) {
    hidePublishOverlay(opts);
    if (parseRoute().name !== "publish") return;
    let back = lastNonPublishPath || "/";
    if (parseRoute(back).name === "publish") back = "/";
    navigate(appHref(back.startsWith("/") ? back : "/" + back), true);
  }

  function openPublishOverlay() {
    const user = observer();
    const ov = $("#publishOverlay");
    if (!ov) return;
    document.title = "Publish — Crypto Space 77";
    if (!user) {
      pendingPublish = true;
      ov.hidden = true;
      setPublishFabHidden(false);
      openLogin();
      return;
    }
    const alreadyOpen = !ov.hidden;
    setPublishFabHidden(true);
    pendingPublish = false;
    if (publishEdit) {
      publishEdit = null;
      const stash = publishStash;
      publishStash = null;
      if (stash) applyPublishForm(stash);
    }
    if (!alreadyOpen) hydratePublishDraftFromStorage();
    ov.hidden = false;
    paintPublishChrome();
    paintPublishDest();
    paintPublishTags();
    renderDestMenu();
    updatePublishPreview();
    loadPublishSubs();
    startPublishDraftAutosave();
    const title = $("#publishTitle");
    if (title) title.focus();
  }

  async function submitPublish() {
    const user = observer();
    if (!user) {
      pendingPublish = true;
      openLogin();
      return;
    }
    const pageEl = $("#publishPage");
    const submitBtn = $("#publishSubmit");
    const composer = $("#publishComposer");
    if (composer && composer.classList.contains("is-uploading")) {
      setPublishStatus("Wait for the image upload to finish.", true);
      return;
    }
    if (pageEl && pageEl.classList.contains("is-pending")) return;
    const title = (($("#publishTitle") && $("#publishTitle").value) || "").trim();
    const body = (($("#publishBody") && $("#publishBody").value) || "").trim();
    takeTagsFromInput();
    if (!title) {
      setPublishStatus("Add a title.", true);
      return;
    }
    if (!body) {
      setPublishStatus("Write the post body.", true);
      return;
    }
    if (!hasSigner(user)) {
      setPublishStatus(signerNeededMessage(), true);
      return;
    }

    const editing = Boolean(publishEdit);
    if (editing && !isOwnAuthor(publishEdit.author)) {
      setPublishStatus("You can only edit your own posts.", true);
      return;
    }

    let tags = publishTags.slice();
    let parentAuthor = "";
    let parentPermlink;
    let permlink;
    if (editing) {
      parentAuthor = publishEdit.parentAuthor || "";
      parentPermlink = publishEdit.parentPermlink;
      permlink = publishEdit.permlink;
      if (parentPermlink && tags.indexOf(parentPermlink) === -1) {
        tags.unshift(parentPermlink);
        tags = tags.slice(0, MAX_TAGS);
      }
      if (!parentAuthor && !tags.length) {
        setPublishStatus("Add at least one tag for your blog post.", true);
        return;
      }
    } else if (publishDest.type === "community" && publishDest.name) {
      parentPermlink = publishDest.name;
      if (tags.indexOf(parentPermlink) === -1) tags.unshift(parentPermlink);
      tags = tags.slice(0, MAX_TAGS);
    } else {
      if (!tags.length) {
        setPublishStatus("Add at least one tag for your blog post.", true);
        return;
      }
      parentPermlink = tags[0];
    }

    let jsonMetadata;
    if (editing) {
      jsonMetadata = mergeJsonMetadata(publishEdit.jsonMetadata, body, tags);
    } else {
      const images = imagesFromMarkdown(body);
      jsonMetadata = {
        app: APP_ID + "/" + APP_VERSION,
        format: "markdown",
        tags,
      };
      if (images.length) jsonMetadata.image = images;
      if (publishDest.type === "community" && publishDest.name) {
        jsonMetadata.community = publishDest.name;
      }
    }

    if (!editing) permlink = postPermlink(title);
    if (pageEl) pageEl.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    setPublishStatus(signingLabel());

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink,
      title,
      body,
      jsonMetadata,
    });

    try {
      await promise;
      if (editing) {
        if (currentPost && currentPost.permlink === permlink && isOwnAuthor(currentPost.author)) {
          currentPost.title = title;
          currentPost.body = body;
          currentPost.json_metadata = jsonMetadata;
          rememberContent(currentPost);
        }
        applyPostEditToView(title, body);
        hidePublishOverlay();
      } else {
        clearStoredPublishDraft();
        resetPublishForm();
        hidePublishOverlay({ persist: false });
        navigate(appHref("/@" + user + "/" + permlink));
      }
    } catch (err) {
      setPublishStatus(err.message || String(err), true);
    } finally {
      if (pageEl) pageEl.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function applyPostEditToView(title, body) {
    const article = view.querySelector("article.article");
    if (!article) return;
    const h1 = article.querySelector(":scope > h1");
    if (h1) h1.textContent = title || "(untitled)";
    const bodyEl = article.querySelector(":scope > .post-body");
    if (bodyEl) bodyEl.innerHTML = HiveMd.renderMarkdown(body || "");
    const tagsEl = article.querySelector(":scope > .tags");
    if (tagsEl && currentPost) {
      tagsEl.innerHTML = tagsOf(currentPost).map(tagChipHtml).join("");
    }
    document.title = `${title || "Post"} — Crypto Space 77`;
  }

  function openPostEditor() {
    const post = currentPost;
    if (!post) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (!isOwnAuthor(post.author)) return;
    const ov = $("#publishOverlay");
    if (!ov) return;
    if (!publishEdit) {
      persistPublishDraftNow();
      publishStash = snapshotPublishForm();
      stopPublishDraftAutosave();
    }
    publishEdit = {
      author: post.author,
      permlink: post.permlink,
      parentAuthor: post.parent_author || "",
      parentPermlink: post.parent_permlink || post.category || "",
      jsonMetadata: post.json_metadata,
    };
    applyPublishForm({
      title: post.title || "",
      body: post.body || "",
      tags: tagsForEdit(post),
      dest: publishDest,
      tagInput: "",
    });
    paintPublishChrome();
    setPublishFabHidden(true);
    pendingPublish = false;
    ov.hidden = false;
    const titleEl = $("#publishTitle");
    if (titleEl) titleEl.focus();
  }

  /* ─── Feed ─── */
  function resetFeed(sort, tag) {
    feedState.sort = sort || "created";
    feedState.tag = normalizeRouteTag(tag) || "";
    feedState.items = [];
    feedState.seen = new Set();
    feedState.cursor = null;
    feedState.loading = false;
    feedState.done = false;
  }

  function isPersonalFeed() {
    return feedState.sort === "feed" && !feedState.tag;
  }

  async function loadFeedPage() {
    if (feedState.loading || feedState.done) return;
    feedState.loading = true;
    let pages = 0;
    const startCount = feedState.items.length;
    const user = observer();
    const personal = isPersonalFeed();
    const tag = feedState.tag;

    if (personal && !user) {
      feedState.done = true;
      feedState.loading = false;
      return;
    }

    try {
      while (
        pages < MAX_PAGES_PER_LOAD &&
        feedState.items.length < startCount + FEED_TARGET
      ) {
        const cursor = {
          startAuthor: feedState.cursor && feedState.cursor.author,
          startPermlink: feedState.cursor && feedState.cursor.permlink,
          observer: user,
          limit: HiveApi.PAGE_SIZE,
        };
        const batch = personal
          ? await HiveApi.getAccountPosts({
              account: user,
              sort: "feed",
              ...cursor,
            })
          : await HiveApi.getRankedPosts({
              sort: feedState.sort,
              tag: tag || "",
              ...cursor,
            });
        setNodeLabel();
        pages++;

        if (!batch.length) {
          feedState.done = true;
          break;
        }

        let added = 0;
        for (const post of batch) {
          if (!isRootPost(post)) continue;
          const key = `${post.author}/${post.permlink}`;
          if (feedState.seen.has(key)) continue;
          feedState.seen.add(key);
          added++;
          if (post.stats && post.stats.hide) continue;
          if (personal || tag || passesFeedFilter(post)) feedState.items.push(post);
        }

        const last = batch[batch.length - 1];
        if (
          !last ||
          (feedState.cursor &&
            last.author === feedState.cursor.author &&
            last.permlink === feedState.cursor.permlink)
        ) {
          feedState.done = true;
          break;
        }
        feedState.cursor = { author: last.author, permlink: last.permlink };
        if (batch.length < HiveApi.PAGE_SIZE) {
          feedState.done = true;
          break;
        }
        if (added === 0 && pages > 1) {
          feedState.done = true;
          break;
        }
      }
    } finally {
      feedState.loading = false;
    }
  }

  function profilePath(name) {
    return appHref("/@" + name);
  }

  function authorLinkHtml(name, size) {
    const href = HiveMd.escapeHtml(profilePath(name));
    const safe = HiveMd.escapeHtml(name);
    return `<a class="author-link" href="${href}"><img class="avatar" src="${HiveMd.avatarUrl(name, size)}" alt=""><span class="author-name">@${safe}</span></a>`;
  }

  function communityNameOf(post) {
    const community = normalizeCommunityName(post && post.community);
    if (community) return community;
    return normalizeCommunityName(post && post.category);
  }

  function communityLabelHtml(post, className) {
    const cls = className || "community";
    const name = communityNameOf(post);
    const title =
      (post && (post.community_title || post.community || post.category)) || "";
    if (name) {
      const label = (post && post.community_title) || name;
      return `<a class="${cls}" href="${HiveMd.escapeHtml(communityHref(name))}">${HiveMd.escapeHtml(label)}</a>`;
    }
    if (!title) return "";
    return `<span class="${cls}">${HiveMd.escapeHtml(title)}</span>`;
  }

  function cardHtml(post) {
    const img = HiveMd.extractImage(post);
    const thumb = img
      ? `<img class="card-thumb" src="${HiveMd.escapeHtml(HiveMd.proxyImage(img, 480))}" alt="">`
      : "";
    const community = communityLabelHtml(post);
    const rep = Math.floor(HiveMd.displayReputation(post.author_reputation));
    return `
      <article class="post-card${img ? " has-image" : " no-thumb"}">
        <div class="card-meta">
          ${authorLinkHtml(post.author, "small")}
          <span class="meta-sep">·</span>
          <span>${rep}</span>
          ${community}
          ${metaTimeHtml(post.created, postPath(post))}
        </div>
        <a class="card-hit" href="${HiveMd.escapeHtml(postPath(post))}">
          <h2>${HiveMd.escapeHtml(post.title || "(untitled)")}</h2>
          <p class="card-excerpt">${HiveMd.escapeHtml(HiveMd.excerpt(post, 200))}</p>
          ${thumb}
        </a>
        <div class="card-stats">
          ${voteControlHtml(post, "pills")}
          ${commentCountHtml(post.children, postPath(post))}
          ${payoutHtml(post, true)}
        </div>
      </article>
    `;
  }

  function feedNavHtml(sort, tag) {
    const t = normalizeRouteTag(tag);
    const items = [];
    if (!t && observer()) {
      items.push(["feed", "Feed", appHref("/feed")]);
    }
    items.push(
      ["created", "Latest", appHref(pathForFeedSort("created", t))],
      ["trending", "Trending", appHref(pathForFeedSort("trending", t))]    );
    const tagHead = t
      ? `<div class="tag-feed-head">
          <h2 class="tag-feed-title">#${HiveMd.escapeHtml(t)}</h2>
        </div>`
      : "";
    return `
      ${tagHead}
      <nav class="feed-nav" aria-label="Feed sort">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === sort ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  async function renderFeed(sort, reset, tag) {
    const t = normalizeRouteTag(tag) || "";
    if (reset || feedState.sort !== sort || feedState.tag !== t) resetFeed(sort, t);
    const loadingMsg =
      sort === "feed"
        ? "Loading your feed…"
        : t
          ? "Loading #" + t + "…"
          : "Loading feed…";
    view.innerHTML = `
      ${feedNavHtml(sort, t)}
      <div id="feedList" class="feed"></div>
      <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> ${HiveMd.escapeHtml(
        loadingMsg
      )}</div>
      <div class="feed-actions">
        <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
      </div>
    `;
    const list = $("#feedList");
    const status = $("#feedStatus");
    const moreBtn = $("#moreBtn");

    async function fill() {
      hideVoteSlider();
      moreBtn.hidden = true;
      status.hidden = false;
      try {
        await loadFeedPage();
        clearError();
      } catch (err) {
        showError(err.message || String(err));
      }
      list.innerHTML = feedState.items.map(cardHtml).join("");
      if (!feedState.items.length && feedState.done) {
        status.hidden = true;
        const personal = isPersonalFeed();
        list.innerHTML = personal
          ? `
          <div class="panel empty-state">
            <h2>Your feed is empty</h2>
            <p>Posts from accounts you follow will show up here.</p>
          </div>`
          : t
            ? `
          <div class="panel empty-state">
            <h2>No posts for #${HiveMd.escapeHtml(t)}</h2>
            <p>Try another sort, or check back later.</p>
          </div>`
            : `
          <div class="panel empty-state">
            <h2>No posts matched the filter</h2>
            <p>Try a different filter, or load again in a moment.</p>
          </div>`;
        return;
      }
      status.hidden = true;
      moreBtn.hidden = feedState.done;
    }

    moreBtn.addEventListener("click", fill);
    await fill();
  }

  /* ─── Favorite tags ─── */
  function favoriteTagHref(tag) {
    const t = normalizeRouteTag(tag);
    if (!t) return appHref("/");
    return appHref("/created/" + t);
  }

  function setTagsStatus(msg, isError) {
    const el = $("#favTagsStatus");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function paintFavoriteTags() {
    const list = $("#favTagsList");
    if (!list) return;
    const tags = readFavoriteTags();
    if (!tags.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite tags yet. Add one below, or pick a suggestion.</p>`;
      return;
    }
    list.innerHTML = tags
      .map((t) => {
        const safe = HiveMd.escapeHtml(t);
        return `<span class="fav-tag-chip">
          <a class="tag" href="${HiveMd.escapeHtml(favoriteTagHref(t))}">#${safe}</a>
          <button type="button" class="fav-tag-remove" data-remove-tag="${safe}" aria-label="Remove ${safe}">×</button>
        </span>`;
      })
      .join("");
  }

  function tagsFromFeedItems(items) {
    const counts = new Map();
    const fav = new Set(readFavoriteTags());
    (items || []).forEach((post) => {
      tagsOf(post).forEach((raw) => {
        const t = normalizeRouteTag(raw);
        if (!t || t.length < 2 || fav.has(t) || isCommunityName(t)) return;
        counts.set(t, (counts.get(t) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SUGGESTED_TAGS_SHOW)
      .map(([t]) => t);
  }

  function paintSuggestedTags(loading) {
    const list = $("#suggestTagsList");
    if (!list) return;
    if (loading) {
      list.innerHTML = `<div class="loading-row tags-suggest-loading"><span class="btn-loader" aria-hidden="true"></span> Loading suggested tags…</div>`;
      return;
    }
    const tags = tagsFromFeedItems(feedState.items);
    if (!tags.length) {
      const emptyFeed = !feedState.items.length;
      list.innerHTML = emptyFeed
        ? `<p class="feed-hint tags-empty">No tags in the current feed.</p>`
        : `<p class="feed-hint tags-empty">No more suggestions from this feed.</p>`;
      return;
    }
    list.innerHTML = tags
      .map((t) => {
        const safe = HiveMd.escapeHtml(t);
        return `<button type="button" class="tag tag-suggest" data-add-tag="${safe}" aria-label="Add ${safe} to favorites">#${safe}</button>`;
      })
      .join("");
  }

  async function ensureSuggestionFeed() {
    if (feedState.items.length) return;
    const user = observer();
    if (user) {
      resetFeed("feed");
      await loadFeedPage();
      if (feedState.items.length) return;
    }
    resetFeed("trending");
    await loadFeedPage();
  }

  function addFavoriteTag(raw) {
    const tag = normalizeTag(raw) || normalizeRouteTag(raw);
    if (!tag || tag.length < 2 || !normalizeRouteTag(tag)) {
      setTagsStatus("Tags use 2–24 letters, numbers, or hyphens.", true);
      return false;
    }
    const tags = readFavoriteTags();
    if (tags.indexOf(tag) !== -1) {
      setTagsStatus("Already in your list.");
      return false;
    }
    if (tags.length >= MAX_FAVORITE_TAGS) {
      setTagsStatus("You can save up to " + MAX_FAVORITE_TAGS + " favorite tags.", true);
      return false;
    }
    tags.push(tag);
    storeFavoriteTags(tags);
    setTagsStatus("");
    paintFavoriteTags();
    paintLogoMenu();
    if (!$(".tags-suggest-loading")) paintSuggestedTags();
    return true;
  }

  function removeFavoriteTag(raw) {
    const tag = normalizeRouteTag(raw) || normalizeTag(raw);
    if (!tag) return;
    storeFavoriteTags(readFavoriteTags().filter((t) => t !== tag));
    setTagsStatus("");
    paintFavoriteTags();
    paintLogoMenu();
    if (!$(".tags-suggest-loading")) paintSuggestedTags();
  }

  function addFavoriteFromInput() {
    const input = $("#favTagInput");
    if (!input) return;
    const parts = String(input.value || "").split(/[,\s]+/).filter(Boolean);
    input.value = "";
    if (!parts.length) {
      setTagsStatus("Enter a tag to add.", true);
      return;
    }
    parts.forEach((p) => addFavoriteTag(p));
    input.focus();
  }

  async function renderTagsPage() {
    document.title = "Tags — Crypto Space 77";
    view.innerHTML = `
      <section class="tags-page">
        <h2 class="tags-page-title">Favorite tags</h2>
        <p class="feed-hint">Saved in this browser.</p>
        <div class="tags-fav-list" id="favTagsList"></div>
        <form class="tags-add" id="favTagsForm">
          <input id="favTagInput" type="text" maxlength="24" placeholder="Add a tag" autocomplete="off" spellcheck="false" autocapitalize="off">
          <button type="submit" class="btn-primary btn-compact">Add</button>
        </form>
        <p class="tags-status" id="favTagsStatus" hidden></p>
        <h2 class="tags-page-title">Suggested tags</h2>
        <p class="feed-hint">From the current feed.</p>
        <div class="tags-suggest-list" id="suggestTagsList"></div>
      </section>
    `;
    paintFavoriteTags();
    const needFeed = !feedState.items.length;
    paintSuggestedTags(needFeed);
    const input = $("#favTagInput");
    if (input) input.focus();
    if (!needFeed) return;
    try {
      await ensureSuggestionFeed();
      clearError();
    } catch (err) {
      showError(err.message || String(err));
    }
    if (parseRoute().name !== "tags") return;
    paintSuggestedTags();
  }

  /* ─── Communities directory ─── */
  function setCommunitiesStatus(id, msg, isError) {
    const el = $(id);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function communityDirRecord(row) {
    if (!row) return null;
    const name =
      normalizeCommunityName(row.name) || communityIdFromInput(row.name);
    if (!name) return null;
    return {
      name,
      title: String(row.title || name).trim() || name,
      about: String(row.about || "").trim(),
      subscribers: Number(row.subscribers || 0),
    };
  }

  function communityDirRowHtml(row, mode) {
    const rec = communityDirRecord(row);
    if (!rec) return "";
    const name = HiveMd.escapeHtml(rec.name);
    const title = HiveMd.escapeHtml(rec.title);
    const meta = [rec.name];
    if (row && row.subscribers != null && row.subscribers !== "") {
      const n = Number(row.subscribers);
      if (Number.isFinite(n) && n > 0) {
        meta.push(n + (n === 1 ? " subscriber" : " subscribers"));
      }
    }
    const fav = isFavoriteCommunity(rec.name);
    const action =
      mode === "favorite"
        ? `<button type="button" class="fav-tag-remove" data-remove-community="${name}" aria-label="Remove ${title}">×</button>`
        : `<button type="button" class="community-fav-btn${fav ? " is-saved" : ""}" data-toggle-community="${name}" data-community-title="${title}" aria-pressed="${fav ? "true" : "false"}" aria-label="${fav ? "Remove " + title + " from favorites" : "Add " + title + " to favorites"}">${fav ? "Favorite" : "Add"}</button>`;
    return `<div class="community-row">
        <a class="community-row-main" href="${HiveMd.escapeHtml(communityHref(rec.name))}">
          <img class="avatar" src="${HiveMd.avatarUrl(rec.name, "small")}" alt="">
          <span class="community-row-text">
            <span class="community-row-title">${title}</span>
            <span class="community-row-meta">${HiveMd.escapeHtml(meta.join(" · "))}</span>
          </span>
        </a>
        ${action}
      </div>`;
  }

  function paintFavoriteCommunities() {
    const list = $("#favCommunitiesList");
    if (!list) return;
    const rows = readFavoriteCommunities();
    if (!rows.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite communities yet. Search below to add one.</p>`;
      return;
    }
    list.innerHTML = rows.map((row) => communityDirRowHtml(row, "favorite")).join("");
  }

  function paintSubscribedCommunities() {
    const list = $("#subscribedCommunitiesList");
    if (!list) return;
    if (communityDirState.subsError) {
      list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(communityDirState.subsError)}</p>`;
      return;
    }
    if (!communityDirState.subs.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">You are not subscribed to any communities yet.</p>`;
      return;
    }
    list.innerHTML = communityDirState.subs
      .map((row) => communityDirRowHtml(row, "toggle"))
      .join("");
  }

  function paintCommunitySearch(loading) {
    const list = $("#communitySearchList");
    if (!list) return;
    if (loading || communityDirState.searchLoading) {
      list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Searching communities…</div>`;
      return;
    }
    if (!communityDirState.searchLooked) {
      list.innerHTML = "";
      return;
    }
    if (communityDirState.searchError) {
      list.innerHTML = `<p class="feed-hint tags-empty">${HiveMd.escapeHtml(communityDirState.searchError)}</p>`;
      return;
    }
    if (!communityDirState.search.length) {
      list.innerHTML = `<p class="feed-hint tags-empty">No communities matched that search.</p>`;
      return;
    }
    list.innerHTML = communityDirState.search
      .map((row) => communityDirRowHtml(row, "toggle"))
      .join("");
  }

  function refreshCommunityDirectory() {
    paintFavoriteCommunities();
    paintSubscribedCommunities();
    paintCommunitySearch();
    paintLogoMenu();
  }

  function addFavoriteCommunityRecord(row) {
    const rec = favoriteCommunityRecord(row);
    if (!rec) {
      setCommunitiesStatus("#communitySearchStatus", "Enter a community name or hive-id.", true);
      return false;
    }
    const list = readFavoriteCommunities();
    if (list.some((c) => c.name === rec.name)) {
      setCommunitiesStatus("#communitySearchStatus", "Already in your list.");
      return false;
    }
    if (list.length >= MAX_FAVORITE_COMMUNITIES) {
      setCommunitiesStatus(
        "#communitySearchStatus",
        "You can save up to " + MAX_FAVORITE_COMMUNITIES + " favorite communities.",
        true
      );
      return false;
    }
    list.push(rec);
    storeFavoriteCommunities(list);
    setCommunitiesStatus("#communitySearchStatus", "");
    refreshCommunityDirectory();
    return true;
  }

  function removeFavoriteCommunity(raw) {
    const name = normalizeCommunityName(raw) || communityIdFromInput(raw);
    if (!name) return;
    storeFavoriteCommunities(readFavoriteCommunities().filter((c) => c.name !== name));
    setCommunitiesStatus("#communitySearchStatus", "");
    refreshCommunityDirectory();
  }

  function toggleFavoriteCommunity(raw, title) {
    const name = normalizeCommunityName(raw) || communityIdFromInput(raw);
    if (!name) return;
    if (isFavoriteCommunity(name)) {
      removeFavoriteCommunity(name);
      return;
    }
    addFavoriteCommunityRecord({ name, title: title || name });
  }

  function mergeCommunityResults(rows) {
    const out = [];
    const seen = new Set();
    (rows || []).forEach((row) => {
      const rec = communityDirRecord(row);
      if (!rec || seen.has(rec.name)) return;
      seen.add(rec.name);
      out.push({
        name: rec.name,
        title: rec.title,
        about: rec.about,
        subscribers: rec.subscribers,
      });
    });
    return out;
  }

  async function lookupCommunityById(id, observerName) {
    const name = normalizeCommunityName(id) || communityIdFromInput(id);
    if (!name) return null;
    try {
      const info = await HiveApi.getCommunity(name, observerName || "");
      return communityDirRecord(info);
    } catch {
      return null;
    }
  }

  async function searchCommunitiesByQuery(raw) {
    const q = String(raw || "").trim();
    if (!q) return [];
    const observerName = observer();
    const id = communityIdFromInput(q);
    const rows = [];
    if (id) {
      const info = await lookupCommunityById(id, observerName);
      if (info) rows.push(info);
      return mergeCommunityResults(rows);
    }
    const list = await HiveApi.listCommunities({
      query: q,
      limit: SUGGESTED_TAGS_SHOW,
      observer: observerName,
    });
    return mergeCommunityResults(list);
  }

  async function runCommunitySearch() {
    const input = $("#communitySearchInput");
    if (!input) return;
    const raw = String(input.value || "").trim();
    if (!raw) {
      communityDirState.searchQuery = "";
      communityDirState.search = [];
      communityDirState.searchError = "";
      communityDirState.searchLooked = false;
      communityDirState.searchLoading = false;
      setCommunitiesStatus("#communitySearchStatus", "Enter a name, hive-id, or number.", true);
      paintCommunitySearch();
      return;
    }
    const gen = communityDirState.gen;
    communityDirState.searchQuery = raw;
    communityDirState.searchLooked = true;
    communityDirState.searchLoading = true;
    communityDirState.searchError = "";
    setCommunitiesStatus("#communitySearchStatus", "");
    paintCommunitySearch(true);
    try {
      const matches = await searchCommunitiesByQuery(raw);
      if (communityDirState.gen !== gen || parseRoute().name !== "communities") return;
      communityDirState.search = matches;
      communityDirState.searchError = "";
      communityDirState.searchLoading = false;
      paintCommunitySearch();
    } catch (err) {
      if (communityDirState.gen !== gen || parseRoute().name !== "communities") return;
      communityDirState.search = [];
      communityDirState.searchError = err.message || String(err);
      communityDirState.searchLoading = false;
      paintCommunitySearch();
    }
  }

  async function loadSubscribedCommunities(gen) {
    const user = observer();
    const list = $("#subscribedCommunitiesList");
    if (!user || !list) return;
    list.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading subscriptions…</div>`;
    try {
      const rows = await HiveApi.listAllSubscriptions(user);
      if (communityDirState.gen !== gen || parseRoute().name !== "communities") return;
      communityDirState.subs = mergeCommunityResults(rows).sort((a, b) =>
        String(a.title || a.name).localeCompare(String(b.title || b.name))
      );
      communityDirState.subsError = "";
    } catch (err) {
      if (communityDirState.gen !== gen || parseRoute().name !== "communities") return;
      communityDirState.subs = [];
      communityDirState.subsError = err.message || String(err);
    }
    paintSubscribedCommunities();
  }

  async function renderCommunitiesPage() {
    document.title = "Communities — Crypto Space 77";
    communityDirState.gen += 1;
    const gen = communityDirState.gen;
    communityDirState.subs = [];
    communityDirState.subsError = "";
    communityDirState.searchQuery = "";
    communityDirState.search = [];
    communityDirState.searchError = "";
    communityDirState.searchLooked = false;
    communityDirState.searchLoading = false;
    const user = observer();
    const subscribedBlock = user
      ? `
        <h2 class="tags-page-title">Subscribed</h2>
        <p class="feed-hint">Communities you follow on Hive.</p>
        <div class="community-list" id="subscribedCommunitiesList"></div>`
      : "";
    view.innerHTML = `
      <section class="tags-page communities-page">
        <h2 class="tags-page-title">Search communities</h2>
        <p class="feed-hint">Find communities by title, hive-id, or number.</p>
        <form class="tags-add" id="communitySearchForm">
          <input id="communitySearchInput" type="text" maxlength="80" placeholder="" autocomplete="off" spellcheck="false" autocapitalize="off">
          <button type="submit" class="btn-primary btn-compact">Search</button>
        </form>
        <p class="tags-status" id="communitySearchStatus" hidden></p>
        <div class="community-list" id="communitySearchList"></div>
        <h2 class="tags-page-title">Favorite communities</h2>
        <p class="feed-hint">Saved in this browser.</p>
        <div class="community-list" id="favCommunitiesList"></div>
        ${subscribedBlock}
      </section>
    `;
    paintFavoriteCommunities();
    const searchInput = $("#communitySearchInput");
    if (searchInput) searchInput.focus();
    if (user) await loadSubscribedCommunities(gen);
  }

  /* ─── Post + comments ─── */
  function buildCommentTree(discussion, author, permlink) {
    const nodes = Object.values(discussion || {});
    const byKey = {};
    for (const n of nodes) {
      n._replies = [];
      byKey[`${n.author}/${n.permlink}`] = n;
    }
    const rootKey = `${author}/${permlink}`;
    for (const n of nodes) {
      const key = `${n.author}/${n.permlink}`;
      if (key === rootKey) continue;
      const parent = byKey[`${n.parent_author}/${n.parent_permlink}`];
      if (parent) parent._replies.push(n);
    }
    for (const n of nodes) {
      n._replies.sort((a, b) => parseCreatedTs(a.created) - parseCreatedTs(b.created));
    }
    return byKey[rootKey] || null;
  }

  function commentPermlink(parentAuthor, parentPermlink) {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    const parent = String(parentAuthor || "").replace(/\./g, "");
    let slug = `re-${parent}-${parentPermlink}-${stamp}${rand}`;
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (slug.length > 255) slug = slug.slice(0, 255).replace(/-+$/, "");
    return slug;
  }

  function imagesFromMarkdown(body) {
    const urls = [];
    const re =
      /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
    let m;
    while ((m = re.exec(String(body || "")))) {
      if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
    }
    return urls;
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && /^image\//i.test(file.type)) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
  }

  function imageFilesFrom(dt) {
    const out = [];
    if (!dt || !dt.files) return out;
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (isImageFile(file)) out.push(file);
    }
    return out;
  }

  function isFileDrag(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    return Array.from(types).indexOf("Files") !== -1;
  }

  function bufferJson(bytes) {
    return JSON.stringify({ type: "Buffer", data: Array.from(bytes) });
  }

  function signImageBuffer(username, bytes) {
    const prefix = new TextEncoder().encode("ImageSigningChallenge");
    const combined = new Uint8Array(prefix.length + bytes.length);
    combined.set(prefix, 0);
    combined.set(bytes, prefix.length);
    if (window.HiveAuth && HiveAuth.hasKey(username)) {
      return HiveAuth.signBytes(combined, username);
    }
    return new Promise((resolve, reject) => {
      if (!window.hive_keychain) {
        reject(new Error(signerNeededMessage()));
        return;
      }
      window.hive_keychain.requestSignBuffer(
        username,
        bufferJson(combined),
        "Posting",
        (res) => {
          if (res && res.success && res.result) resolve(res.result);
          else {
            reject(
              new Error(
                (res && (res.message || res.error)) || "Image signing was cancelled."
              )
            );
          }
        },
        null,
        "Upload image"
      );
    });
  }

  async function uploadHiveImage(file, username) {
    if (!file) throw new Error("No image selected.");
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Image is too large (max 8 MB).");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const signature = await signImageBuffer(username, bytes);
    const form = new FormData();
    form.append("file", file, file.name || "image.png");
    const res = await fetch(`${IMAGE_HOST}/${encodeURIComponent(username)}/${signature}`, {
      method: "POST",
      body: form,
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
        (data && (data.error || data.message || data.reason)) ||
        text.slice(0, 200) ||
        res.statusText;
      throw new Error(detail || "Image upload failed.");
    }
    const url = data && (data.url || data.secure_url);
    if (!url) throw new Error("Image hoster did not return a URL.");
    return url;
  }

  function markdownImage(file, url) {
    const name = String((file && file.name) || "image")
      .replace(/[\[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "image";
    return `![${name}](${url})`;
  }

  function insertInTextarea(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = before && !/\n$/.test(before) ? "\n" : "";
    const suffix = after && !/^\n/.test(after) ? "\n" : "";
    const chunk = prefix + text + suffix;
    textarea.value = before + chunk + after;
    const pos = (before + chunk).length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function composerStatus(composer, msg, isError) {
    const el = composer && composer.querySelector(".composer-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-error", Boolean(isError));
  }

  function composerHtml(parentAuthor, parentPermlink, opts) {
    const user = observer();
    if (!user) return "";
    const placeholder = (opts && opts.placeholder) || "Write a comment…";
    const submit = (opts && opts.submitLabel) || "Comment";
    const author = HiveMd.escapeHtml(parentAuthor);
    const permlink = HiveMd.escapeHtml(parentPermlink);
    const body = opts && opts.body != null ? String(opts.body) : "";
    const editAuthor = opts && opts.editAuthor ? HiveMd.escapeHtml(opts.editAuthor) : "";
    const editPermlink = opts && opts.editPermlink ? HiveMd.escapeHtml(opts.editPermlink) : "";
    const editAttrs = editAuthor
      ? ` data-edit-author="${editAuthor}" data-edit-permlink="${editPermlink}"`
      : "";
    const cancel =
      opts && opts.cancelLabel
        ? `<button type="button" class="composer-cancel">${HiveMd.escapeHtml(opts.cancelLabel)}</button>`
        : "";
    return `
      <div class="comment-composer" data-parent-author="${author}" data-parent-permlink="${permlink}"${editAttrs}>
        <div class="composer-drop-layer" aria-hidden="true">Drop image to upload</div>
        <textarea class="composer-input" rows="4" placeholder="${HiveMd.escapeHtml(placeholder)}">${HiveMd.escapeHtml(body)}</textarea>
        <input class="composer-file" type="file" accept="image/*" multiple hidden>
        <div class="composer-bar">
          <button type="button" class="composer-attach" title="Attach image">Attach image</button>
          <span class="composer-hint"></span>
          <span class="composer-actions">
            ${cancel}
            <button type="button" class="btn-primary btn-compact composer-submit">${HiveMd.escapeHtml(submit)}</button>
          </span>
        </div>
        <p class="composer-status" hidden></p>
      </div>
    `;
  }

  function renderComment(node) {
    if (!node) return "";
    rememberContent(node);
    const body = HiveMd.renderMarkdown(node.body || "");
    const replies = (node._replies || []).map(renderComment).join("");
    const user = observer();
    const author = HiveMd.escapeHtml(node.author);
    const permlink = HiveMd.escapeHtml(node.permlink);
    const parentAuthor = HiveMd.escapeHtml(node.parent_author || "");
    const parentPermlink = HiveMd.escapeHtml(node.parent_permlink || "");
    const replyBtn = user
      ? `<button type="button" class="comment-reply-btn" data-reply-author="${author}" data-reply-permlink="${permlink}">Reply</button>`
      : "";
    const editBtn = editButtonHtml("comment", node.author, node.permlink);
    return `
      <article class="comment" data-author="${author}" data-permlink="${permlink}" data-parent-author="${parentAuthor}" data-parent-permlink="${parentPermlink}" id="@${author}/${permlink}">
        <div class="comment-head">
          ${authorLinkHtml(node.author, "small")}
          <span>· ${Math.floor(HiveMd.displayReputation(node.author_reputation))}</span>
          <span>· ${metaTimeHtml(node.created, commentPath(node))}</span>
        </div>
        <div class="comment-body">${body}</div>
        <div class="comment-actions">
          ${voteControlHtml(node, "pills")}
          ${payoutHtml(node, true)}
          ${editBtn}
          ${replyBtn}
        </div>
        ${user ? `<div class="comment-reply-slot" hidden></div>` : ""}
        ${replies ? `<div class="comment-replies">${replies}</div>` : ""}
      </article>
    `;
  }

  function findCommentEl(author, permlink) {
    const comments = $("#comments");
    if (!comments) return null;
    const nodes = comments.querySelectorAll(".comment");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (
        el.getAttribute("data-author") === author &&
        el.getAttribute("data-permlink") === permlink
      ) {
        return el;
      }
    }
    return null;
  }

  function bumpCommentCount(delta) {
    const section = $("#comments");
    if (!section) return;
    const n = Math.max(0, (Number(section.getAttribute("data-count")) || 0) + delta);
    section.setAttribute("data-count", String(n));
    document.querySelectorAll(".comment-n").forEach((el) => {
      el.textContent = "C " + n;
    });
  }

  function appendPostedComment(parentAuthor, parentPermlink, html) {
    const section = $("#comments");
    if (!section) return;
    const rootAuthor = section.getAttribute("data-root-author");
    const rootPermlink = section.getAttribute("data-root-permlink");
    if (parentAuthor === rootAuthor && parentPermlink === rootPermlink) {
      let list = section.querySelector(".comment-list");
      if (!list) return;
      const hint = list.querySelector(":scope > .feed-hint");
      if (hint) hint.remove();
      list.insertAdjacentHTML("beforeend", html);
      return;
    }
    const parent = findCommentEl(parentAuthor, parentPermlink);
    if (!parent) return;
    let replies = parent.querySelector(":scope > .comment-replies");
    if (!replies) {
      replies = document.createElement("div");
      replies.className = "comment-replies";
      parent.appendChild(replies);
    }
    replies.insertAdjacentHTML("beforeend", html);
  }

  function toggleReplyComposer(btn) {
    const comment = btn.closest(".comment");
    if (!comment) return;
    if (comment.classList.contains("is-editing")) closeCommentEditor(comment);
    const slot = comment.querySelector(":scope > .comment-reply-slot");
    if (!slot) return;
    const open = !slot.hidden && slot.innerHTML.trim();
    if (open) {
      slot.hidden = true;
      slot.innerHTML = "";
      btn.classList.remove("is-open");
      return;
    }
    const author = btn.getAttribute("data-reply-author");
    const permlink = btn.getAttribute("data-reply-permlink");
    slot.innerHTML = composerHtml(author, permlink, {
      placeholder: "Write a reply…",
      submitLabel: "Reply",
    });
    slot.hidden = false;
    btn.classList.add("is-open");
    const ta = slot.querySelector("textarea");
    if (ta) ta.focus();
  }

  function closeCommentEditor(comment) {
    if (!comment) return;
    const slot = comment.querySelector(":scope > .comment-edit-slot");
    if (slot) {
      slot.hidden = true;
      slot.innerHTML = "";
    }
    const bodyEl = comment.querySelector(":scope > .comment-body");
    if (bodyEl) bodyEl.hidden = false;
    comment.classList.remove("is-editing");
    const btn = comment.querySelector(":scope > .comment-actions .comment-edit-btn");
    if (btn) btn.classList.remove("is-open");
  }

  function toggleCommentEditor(btn) {
    const comment = btn.closest(".comment");
    if (!comment) return;
    const author = comment.getAttribute("data-author");
    const permlink = comment.getAttribute("data-permlink");
    if (!isOwnAuthor(author)) return;
    const open = comment.classList.contains("is-editing");
    if (open) {
      closeCommentEditor(comment);
      return;
    }
    const replySlot = comment.querySelector(":scope > .comment-reply-slot");
    if (replySlot && !replySlot.hidden) {
      replySlot.hidden = true;
      replySlot.innerHTML = "";
      const replyBtn = comment.querySelector(":scope > .comment-actions .comment-reply-btn");
      if (replyBtn) replyBtn.classList.remove("is-open");
    }
    const src = contentOf(author, permlink) || {
      body: "",
      parent_author: comment.getAttribute("data-parent-author") || "",
      parent_permlink: comment.getAttribute("data-parent-permlink") || "",
    };
    const bodyEl = comment.querySelector(":scope > .comment-body");
    if (bodyEl) bodyEl.hidden = true;
    let slot = comment.querySelector(":scope > .comment-edit-slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "comment-edit-slot";
      if (bodyEl && bodyEl.parentNode) bodyEl.insertAdjacentElement("afterend", slot);
      else comment.appendChild(slot);
    }
    slot.innerHTML = composerHtml(src.parent_author, src.parent_permlink, {
      placeholder: "Edit your comment…",
      submitLabel: "Save",
      cancelLabel: "Cancel",
      body: src.body || "",
      editAuthor: author,
      editPermlink: permlink,
    });
    slot.hidden = false;
    comment.classList.add("is-editing");
    btn.classList.add("is-open");
    const ta = slot.querySelector("textarea");
    if (ta) ta.focus();
  }

  async function uploadImagesToComposer(composer, files) {
    const user = observer();
    if (!user) {
      showError("Log in to upload images.");
      return;
    }
    if (composer.classList.contains("is-pending") || composer.classList.contains("is-uploading")) {
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const list = Array.from(files || []).filter(isImageFile);
    if (!list.length) {
      composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    composer.classList.add("is-uploading");
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const label = list.length > 1 ? ` (${i + 1}/${list.length})` : "";
        composerStatus(composer, signingLabel("image") + (label ? " " + label.trim() : ""));
        const url = await uploadHiveImage(file, user);
        insertInTextarea(textarea, markdownImage(file, url));
        composerStatus(composer, "Image uploaded" + label + ".");
      }
      savePublishDraft();
      updatePublishPreview();
      persistPublishDraftNow();
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-uploading");
    }
  }

  function bindComposerMedia(root) {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const attachBtn = e.target.closest(".composer-attach");
      if (!attachBtn || !root.contains(attachBtn)) return;
      e.preventDefault();
      const composer = attachBtn.closest(".comment-composer");
      const input = composer && composer.querySelector(".composer-file");
      if (input) input.click();
    });
    root.addEventListener("change", (e) => {
      const input = e.target.closest(".composer-file");
      if (!input || !root.contains(input)) return;
      const composer = input.closest(".comment-composer");
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (composer && files.length) uploadImagesToComposer(composer, files);
    });
    root.addEventListener("dragenter", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      composer.classList.add("is-dragover");
    });
    root.addEventListener("dragover", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });
    root.addEventListener("dragleave", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer) return;
      if (e.relatedTarget && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-dragover");
    });
    root.addEventListener("drop", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer)) return;
      e.preventDefault();
      composer.classList.remove("is-dragover");
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) uploadImagesToComposer(composer, files);
      else composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
    });
    root.addEventListener("paste", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !root.contains(composer)) return;
      const clip = e.clipboardData;
      const files = clip && clip.files ? Array.from(clip.files).filter(isImageFile) : [];
      if (!files.length) return;
      e.preventDefault();
      uploadImagesToComposer(composer, files);
    });
  }

  async function submitComment(composer) {
    const user = observer();
    if (!user) {
      showError("Log in to write a comment.");
      return;
    }
    if (composer.classList.contains("is-pending") || composer.classList.contains("is-uploading")) {
      return;
    }
    if (composer.getAttribute("data-edit-author")) {
      await submitCommentEdit(composer);
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const submitBtn = composer.querySelector(".composer-submit");
    const body = textarea ? textarea.value.trim() : "";
    if (!body) {
      composerStatus(composer, "Write a comment first.", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    const parentAuthor = composer.getAttribute("data-parent-author");
    const parentPermlink = composer.getAttribute("data-parent-permlink");
    if (!parentAuthor || !parentPermlink) return;
    const permlink = commentPermlink(parentAuthor, parentPermlink);
    const images = imagesFromMarkdown(body);
    const jsonMetadata = {
      app: APP_ID + "/" + APP_VERSION,
      format: "markdown",
      tags: ["cryptospace77"],
    };
    if (images.length) jsonMetadata.image = images;

    composer.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    composerStatus(composer, signingLabel());

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink,
      title: "",
      body,
      jsonMetadata,
    });

    try {
      await promise;
      const html = renderComment({
        author: user,
        permlink,
        body,
        created: new Date().toISOString(),
        author_reputation: 0,
        payout: 0,
        json_metadata: JSON.stringify(jsonMetadata),
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        _replies: [],
      });
      appendPostedComment(parentAuthor, parentPermlink, html);
      bumpCommentCount(1);
      if (textarea) textarea.value = "";
      composerStatus(composer, "");
      const slot = composer.closest(".comment-reply-slot");
      if (slot) {
        slot.hidden = true;
        slot.innerHTML = "";
        const comment = slot.closest(".comment");
        const replyBtn = comment && comment.querySelector(":scope > .comment-actions .comment-reply-btn");
        if (replyBtn) replyBtn.classList.remove("is-open");
      }
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function submitCommentEdit(composer) {
    const user = observer();
    const editAuthor = composer.getAttribute("data-edit-author");
    const editPermlink = composer.getAttribute("data-edit-permlink");
    if (!isOwnAuthor(editAuthor) || user !== String(editAuthor).toLowerCase()) {
      composerStatus(composer, "You can only edit your own comments.", true);
      return;
    }
    const textarea = composer.querySelector(".composer-input");
    const submitBtn = composer.querySelector(".composer-submit");
    const body = textarea ? textarea.value.trim() : "";
    if (!body) {
      composerStatus(composer, "Write a comment first.", true);
      return;
    }
    if (!hasSigner(user)) {
      composerStatus(composer, signerNeededMessage(), true);
      return;
    }
    const src = contentOf(editAuthor, editPermlink) || {};
    const parentAuthor =
      composer.getAttribute("data-parent-author") || src.parent_author || "";
    const parentPermlink =
      composer.getAttribute("data-parent-permlink") || src.parent_permlink || "";
    if (!parentAuthor || !parentPermlink) {
      composerStatus(composer, "Could not find this comment's parent.", true);
      return;
    }
    if (body === String(src.body || "").trim()) {
      closeCommentEditor(composer.closest(".comment"));
      return;
    }
    const prevMeta = HiveMd.parseJsonMetadata(src.json_metadata);
    let tags = prevMeta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags) || !tags.length) tags = ["cryptospace77"];
    const jsonMetadata = mergeJsonMetadata(src.json_metadata, body, tags);

    composer.classList.add("is-pending");
    if (submitBtn) submitBtn.disabled = true;
    composerStatus(composer, signingLabel());

    const { promise } = ChainQueue.comment({
      author: user,
      parentAuthor,
      parentPermlink,
      permlink: editPermlink,
      title: src.title || "",
      body,
      jsonMetadata,
    });

    try {
      await promise;
      rememberContent({
        author: user,
        permlink: editPermlink,
        title: src.title || "",
        body,
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        json_metadata: jsonMetadata,
      });
      const comment = composer.closest(".comment");
      const bodyEl = comment && comment.querySelector(":scope > .comment-body");
      if (bodyEl) bodyEl.innerHTML = HiveMd.renderMarkdown(body);
      closeCommentEditor(comment);
    } catch (err) {
      composerStatus(composer, err.message || String(err), true);
    } finally {
      composer.classList.remove("is-pending");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function renderPost(author, permlink) {
    view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Opening post…</div>`;
    try {
      const discussion = await HiveApi.getDiscussion(author, permlink, observer());
      setNodeLabel();
      const root = buildCommentTree(discussion, author, permlink);
      if (!root) {
        currentPost = null;
        view.innerHTML = notFoundHtml("This post could not be found on Hive.");
        return;
      }
      clearError();
      contentByKey.clear();
      currentPost = root;
      rememberContent(root);
      const community = communityLabelHtml(root, "article-community");
      const comments = (root._replies || []).map(renderComment).join("");
      const commentCount = Object.values(discussion).filter((n) => n.depth > 0).length;
      const user = observer();
      const composer = user
        ? composerHtml(root.author, root.permlink, {
            placeholder: "Write a comment…",
            submitLabel: "Comment",
          })
        : "";
      const postEdit = editButtonHtml("post", root.author, root.permlink);
      view.innerHTML = `
        <article class="article">
          ${community}
          <h1>${HiveMd.escapeHtml(root.title || "(untitled)")}</h1>
          <div class="article-byline">
            ${authorLinkHtml(root.author, "medium")}
            <span>· ${Math.floor(HiveMd.displayReputation(root.author_reputation))}</span>
            <span>· ${metaTimeHtml(root.created, postPath(root))}</span>
            <div class="article-stats">
              ${voteControlHtml(root, "plain")}
              ${commentCountHtml(commentCount, "#comments")}
              ${payoutHtml(root, false)}
            </div>
          </div>
          <div class="tags">
            ${tagsOf(root).map(tagChipHtml).join("")}
          </div>
          <div class="post-body">${HiveMd.renderMarkdown(root.body || "")}</div>
          <div class="post-stats-bar">
            ${voteControlHtml(root, "pills")}
            ${payoutHtml(root, true)}
            ${postEdit}
          </div>
          <section class="comments" id="comments" data-root-author="${HiveMd.escapeHtml(root.author)}" data-root-permlink="${HiveMd.escapeHtml(root.permlink)}" data-count="${commentCount}">
            ${composer}
            <div class="comment-list">
              ${comments || `<p class="feed-hint">No comments yet.</p>`}
            </div>
          </section>
        </article>
      `;
      document.title = `${root.title || "Post"} — Crypto Space 77`;
    } catch (err) {
      currentPost = null;
      showError(err.message || String(err));
      view.innerHTML = notFoundHtml("Could not load this post.");
    }
  }

  /* ─── Profile ─── */
  function resetProfileState() {
    profileState.author = "";
    profileState.page = "posts";
    profileState.profile = null;
    profileState.followed = false;
    profileState.pending = false;
    profileState.claimPending = false;
    profileState.wallet = null;
  }

  function profileFollowed(profile) {
    const ctx = profile && profile.context;
    if (!ctx || typeof ctx !== "object") return false;
    return Boolean(ctx.followed || ctx.follow);
  }

  function profileFollowLabel() {
    if (profileState.pending) {
      return profileState.followed ? "Unfollowing…" : "Following…";
    }
    return profileState.followed ? "Unfollow" : "Follow";
  }

  function profilePageTitle(author, page) {
    const a = "@" + author;
    if (page === "comments") return "Comments · " + a + " — Crypto Space 77";
    if (page === "replies") return "Replies · " + a + " — Crypto Space 77";
    if (page === "wallet") return "Wallet · " + a + " — Crypto Space 77";
    return a + " — Crypto Space 77";
  }

  function profileNavHtml(author, page) {
    const items = [
      ["posts", "All posts", profileHref(author, "posts")],
      ["comments", "Comments", profileHref(author, "comments")],
      ["replies", "Replies", profileHref(author, "replies")],
      ["wallet", "Wallet", profileHref(author, "wallet")],
    ];
    return `
      <nav class="feed-nav profile-nav" aria-label="Profile">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === page ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  function profileWebsiteLink(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    let candidate = text;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
      candidate = "https://" + candidate.replace(/^\/\//, "");
    }
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname &&
        url.hostname.includes(".")
      ) {
        const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
        const label = url.hostname.replace(/^www\./i, "") + path;
        return { href: url.href, label: label || url.hostname };
      }
    } catch {
      return null;
    }
    return null;
  }

  function profileDetailsHtml(profile) {
    const meta =
      (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    const location = String(info.location || "").trim();
    const site = profileWebsiteLink(info.website);
    const parts = [];
    if (site) {
      parts.push(
        `<p class="profile-website"><a href="${HiveMd.escapeHtml(site.href)}" target="_blank" rel="noopener noreferrer">${HiveMd.escapeHtml(site.label)}</a></p>`
      );
    }
    if (location) parts.push(`<p class="profile-location">${HiveMd.escapeHtml(location)}</p>`);
    return parts.join("");
  }

  function formatProfileHp(amount) {
    if (amount == null || amount === "") return "";
    const n = Number(amount);
    if (!Number.isFinite(n)) return "";
    const rounded = Math.max(0, Math.round(n));
    if (rounded >= 100000) {
      if (rounded >= 999500) {
        const millions = Math.round((rounded / 1000000) * 10) / 10;
        const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
        return "HP " + text + "M";
      }
      return "HP " + Math.round(rounded / 1000) + "K";
    }
    return "HP " + formatGroupedNumber(rounded, 0);
  }

  function profileBannerHtml(author, profile, hivePower) {
    const meta =
      (profile && (profile.metadata || profile.posting_json_metadata)) || {};
    const about = String(
      (meta.profile && meta.profile.about) || (profile && profile.about) || ""
    ).trim();
    const display =
      (meta.profile && meta.profile.name) || (profile && profile.name) || author;
    const stats = (profile && profile.stats) || {};
    const posts = Number((profile && profile.post_count) || stats.post_count || 0);
    const followers = Number(stats.followers || 0);
    const following = Number(stats.following || 0);
    const hp = formatProfileHp(hivePower);
    const rep = Math.floor(
      HiveMd.displayReputation((profile && profile.reputation) || 0)
    );
    const href = HiveMd.escapeHtml(profileHref(author, "posts"));
    const own = isOwnAuthor(author);
    const followBtn = own
      ? ""
      : `<div class="profile-head-actions">
          <button type="button" class="btn-primary btn-compact profile-follow-btn" data-author="${HiveMd.escapeHtml(author)}" data-followed="${profileState.followed ? "1" : "0"}"${profileState.pending ? " disabled" : ""}>${profileFollowLabel()}</button>
        </div>`;
    return `
      <div class="profile-banner">
        <div class="profile-head">
          <img class="avatar" src="${HiveMd.avatarUrl(author, "large")}" alt="">
          <div>
            <h1>${HiveMd.escapeHtml(display)}</h1>
            <p class="profile-handle"><a href="${href}">@${HiveMd.escapeHtml(author)}</a> · ${rep}</p>
            ${about ? `<p class="profile-about">${HiveMd.escapeHtml(about)}</p>` : ""}
            ${profileDetailsHtml(profile)}
            <div class="profile-stats">
              <span>${posts} posts</span>
              <span class="profile-follower-count">${followers} followers</span>
              <span>${following} following</span>
              ${hp ? `<span class="profile-hp">${HiveMd.escapeHtml(hp)}</span>` : ""}
              ${profileJoinedHtml(profile && profile.created)}
            </div>
            ${followBtn}
          </div>
        </div>
      </div>
    `;
  }

  function paintProfileChrome() {
    const btn = view.querySelector(".profile-follow-btn");
    if (btn) {
      btn.disabled = profileState.pending;
      btn.textContent = profileFollowLabel();
      btn.setAttribute("data-followed", profileState.followed ? "1" : "0");
      btn.classList.toggle("is-joined", profileState.followed);
    }
    const count = view.querySelector(".profile-follower-count");
    const stats = profileState.profile && profileState.profile.stats;
    if (count && stats) {
      count.textContent = Number(stats.followers || 0) + " followers";
    }
  }

  function profileCardHtml(post) {
    if (isRootPost(post)) return cardHtml(post);
    const rootTitle = String((post && (post.root_title || post.title)) || "").trim();
    const title = rootTitle
      ? String((post && post.title) || "").trim() || "RE: " + rootTitle
      : String((post && post.title) || "").trim() || "Comment";
    return cardHtml(Object.assign({}, post, { title }));
  }

  function toggleProfileFollow() {
    const user = observer();
    const name = profileState.author;
    if (!name) return;
    if (isOwnAuthor(name)) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (profileState.pending) return;
    const follow = !profileState.followed;
    profileState.pending = true;
    paintProfileChrome();
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "follow",
            json: JSON.stringify([
              "follow",
              {
                follower: user,
                following: name,
                what: follow ? ["blog"] : [],
              },
            ]),
          },
        ],
      ],
      meta: { type: "follow", action: follow ? "follow" : "unfollow", following: name },
    });
    promise
      .then(() => {
        if (profileState.author !== name) return;
        profileState.followed = follow;
        if (profileState.profile) {
          if (!profileState.profile.stats) profileState.profile.stats = {};
          const n = Number(profileState.profile.stats.followers || 0);
          profileState.profile.stats.followers = Math.max(0, n + (follow ? 1 : -1));
          if (!profileState.profile.context) profileState.profile.context = {};
          profileState.profile.context.followed = follow;
        }
        paintProfileChrome();
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        showError(err.message || String(err));
      })
      .finally(() => {
        if (profileState.author !== name) return;
        profileState.pending = false;
        paintProfileChrome();
      });
  }

  function formatGroupedNumber(amount, decimals) {
    const n = Number(amount);
    const x = Number.isFinite(n) ? n : 0;
    const d = decimals == null ? 3 : decimals;
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(x);
  }

  function formatLowerAsset(amount, symbol) {
    const dec = symbol === "vests" ? 6 : 3;
    return formatGroupedNumber(amount, dec) + " " + symbol;
  }

  function formatHiveLike(amount, symbol) {
    return formatLowerAsset(amount, symbol);
  }

  function parseAmountInput(raw) {
    const s = String(raw || "")
      .trim()
      .replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n;
  }

  function roundAsset(n, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round((Number(n) || 0) * f) / f;
  }

  function formatChainAmount(n, symbol, decimals) {
    const d = decimals == null ? 3 : decimals;
    return roundAsset(n, d).toFixed(d) + " " + symbol;
  }

  function chainAssetToLower(val, props) {
    const s = String(val || "").trim();
    if (!s) return "";
    const m = s.match(/(-?[\d.]+)\s*([A-Za-z]+)/);
    if (!m) {
      const n = HiveApi.parseAsset(s);
      return n ? n.toFixed(3) : "";
    }
    const amount = Number(m[1]);
    const sym = String(m[2] || "").toUpperCase();
    if (!Number.isFinite(amount)) return "";
    if (sym === "VESTS") {
      const hive = HiveApi.vestsToHive(amount, props);
      return formatHiveLike(hive, "hive");
    }
    if (sym === "HIVE" || sym === "TESTS") return formatHiveLike(amount, "hive");
    if (sym === "HBD" || sym === "TBD") return formatHiveLike(amount, "hbd");
    return formatHiveLike(amount, String(m[2] || "").toLowerCase());
  }

  function walletHasAwards(wallet) {
    if (!wallet) return false;
    return wallet.rewardHive > 0 || wallet.rewardHbd > 0 || wallet.rewardVests > 0;
  }

  function hasActiveSigner() {
    return Boolean(window.hive_keychain);
  }

  function activeSignerNeededMessage() {
    return "Hive Keychain is needed to stake or unstake.";
  }

  const WALLET_TX_TYPES = {
    transfer: "transfer",
    transfer_to_vesting: "staked hive",
    withdraw_vesting: "unstake hive",
    fill_vesting_withdraw: "unstake paid",
    transfer_to_savings: "staked",
    transfer_from_savings: "unstake requested",
    fill_transfer_from_savings: "unstake paid",
    claim_reward_balance: "claimed awards",
    delegate_vesting_shares: "delegation",
    author_reward: "author award",
    curation_reward: "curation award",
    comment_benefactor_reward: "benefactor award",
    interest: "hbd interest",
  };

  function walletTxAmounts(type, payload, props) {
    if (!payload) return "";
    const parts = [];
    function push(val) {
      const t = chainAssetToLower(val, props);
      if (t) parts.push(t);
    }
    if (type === "transfer" || type === "transfer_to_vesting" || type === "transfer_to_savings" || type === "transfer_from_savings" || type === "fill_transfer_from_savings") {
      push(payload.amount);
    } else if (type === "withdraw_vesting") {
      push(payload.vesting_shares);
    } else if (type === "fill_vesting_withdraw") {
      push(payload.deposited || payload.withdrawn);
    } else if (type === "claim_reward_balance") {
      push(payload.reward_hive);
      push(payload.reward_hbd);
      push(payload.reward_vests);
    } else if (type === "delegate_vesting_shares") {
      push(payload.vesting_shares);
    } else if (type === "author_reward" || type === "comment_benefactor_reward") {
      push(payload.hive_payout);
      push(payload.hbd_payout);
      push(payload.vesting_payout);
    } else if (type === "curation_reward") {
      push(payload.reward);
    } else if (type === "interest") {
      push(payload.interest);
    }
    return parts.filter(Boolean).join(" · ");
  }

  function walletTxDetail(type, payload) {
    if (!payload) return "";
    if (type === "transfer") {
      return "@" + (payload.from || "") + " → @" + (payload.to || "");
    }
    if (type === "transfer_to_vesting") {
      return payload.to && payload.to !== payload.from
        ? "staked hive for @" + payload.to
        : "staked hive";
    }
    if (type === "withdraw_vesting") return "power down";
    if (type === "fill_vesting_withdraw") {
      return "@" + (payload.from_account || "") + " → @" + (payload.to_account || "");
    }
    if (type === "transfer_to_savings") {
      const unit = /hbd/i.test(String(payload.amount || "")) ? "hbd" : "hive";
      return "staked " + unit;
    }
    if (type === "transfer_from_savings" || type === "fill_transfer_from_savings") {
      const unit = /hbd/i.test(String(payload.amount || "")) ? "hbd" : "hive";
      return "unstake " + unit;
    }
    if (type === "delegate_vesting_shares") {
      return "@" + (payload.delegator || "") + " → @" + (payload.delegatee || "");
    }
    if (type === "author_reward") return payload.permlink ? String(payload.permlink) : "";
    if (type === "curation_reward") {
      return payload.comment_author ? "@" + payload.comment_author : "";
    }
    if (type === "claim_reward_balance") return "pending awards claimed";
    return "";
  }

  async function loadWalletHistory(account) {
    const wanted = 30;
    const out = [];
    let start = -1;
    for (let i = 0; i < 8 && out.length < wanted; i++) {
      const batch = await HiveApi.getAccountHistory(account, start, 100);
      if (!batch.length) break;
      for (let j = batch.length - 1; j >= 0; j--) {
        const rec = batch[j];
        const op = rec && rec[1] && rec[1].op;
        const type = Array.isArray(op) ? String(op[0] || "") : "";
        if (WALLET_TX_TYPES[type]) out.push(rec);
        if (out.length >= wanted) break;
      }
      const first = batch[0];
      const firstIdx = Array.isArray(first) ? Number(first[0]) : NaN;
      if (!Number.isFinite(firstIdx) || firstIdx <= 0) break;
      if (batch.length < 100) break;
      start = firstIdx - 1;
    }
    return out;
  }

  function walletTxHtml(entry, props) {
    if (!Array.isArray(entry) || !entry[1]) return "";
    const rec = entry[1];
    const op = rec.op;
    if (!Array.isArray(op) || op.length < 2) return "";
    const type = String(op[0] || "");
    if (!WALLET_TX_TYPES[type]) return "";
    const payload = op[1] || {};
    const amount = walletTxAmounts(type, payload, props);
    const detail = walletTxDetail(type, payload);
    const when = rec.timestamp ? timeAgo(rec.timestamp) : "";
    return `<div class="wallet-tx">
      <div class="wallet-tx-main">
        <span class="wallet-tx-type">${HiveMd.escapeHtml(WALLET_TX_TYPES[type])}</span>
        ${detail ? `<span class="wallet-tx-detail">${HiveMd.escapeHtml(detail)}</span>` : ""}
      </div>
      <div class="wallet-tx-side">
        ${amount ? `<span class="wallet-tx-amount">${HiveMd.escapeHtml(amount)}</span>` : ""}
        ${when ? `<span class="wallet-tx-time">${HiveMd.escapeHtml(when)}</span>` : ""}
      </div>
    </div>`;
  }

  function walletAwardsHtml(wallet, own) {
    if (!own || !walletHasAwards(wallet)) return "";
    const rows = [];
    if (wallet.rewardHive > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">hive</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardHive, "hive"))}</span></div>`
      );
    }
    if (wallet.rewardHbd > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">hbd</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardHbd, "hbd"))}</span></div>`
      );
    }
    if (wallet.rewardVests > 0) {
      rows.push(
        `<div class="wallet-row"><span class="wallet-label">staked hive</span><span class="wallet-value">${HiveMd.escapeHtml(formatHiveLike(wallet.rewardVestingHive, "hive"))}</span></div>`
      );
    }
    return `
      <section class="wallet-section wallet-awards">
        <h2>Pending awards</h2>
        ${rows.join("")}
        <div class="wallet-row-actions wallet-claim-actions">
          <button type="button" class="btn-primary btn-compact wallet-claim-btn"${profileState.claimPending ? " disabled" : ""}>${profileState.claimPending ? "Claiming…" : "Claim"}</button>
        </div>
      </section>
    `;
  }

  function formatAssetNumber(amount) {
    return formatGroupedNumber(amount, 3);
  }

  function walletBalanceRow(label, amount, symbol, actionsHtml) {
    return `<tr>
      <td class="wallet-label">${HiveMd.escapeHtml(label)}</td>
      <td class="wallet-value">${HiveMd.escapeHtml(formatAssetNumber(amount))}</td>
      <td class="wallet-unit">${HiveMd.escapeHtml(symbol)}</td>
      <td class="wallet-actions wallet-actions-inline">${
        actionsHtml ? `<div class="wallet-actions-inner">${actionsHtml}</div>` : ""
      }</td>
    </tr>`;
  }

  function walletActionsUnderRow(actionsHtml) {
    if (!actionsHtml) return "";
    return `<tr class="wallet-actions-under">
      <td class="wallet-actions" colspan="4"><div class="wallet-actions-inner">${actionsHtml}</div></td>
    </tr>`;
  }

  function walletStakeButtons(kind) {
    return `
      <button type="button" class="btn-primary btn-compact wallet-stake-btn" data-wallet-op="stake-${kind}">Stake</button>
      <button type="button" class="btn-ghost btn-compact wallet-stake-btn" data-wallet-op="unstake-${kind}">Unstake</button>
    `;
  }

  function walletPowerDownNote(wallet) {
    if (!wallet || wallet.toWithdrawVests <= 0) return "";
    const total = HiveApi.vestsToHive(wallet.toWithdrawVests, wallet.props);
    const done = HiveApi.vestsToHive(wallet.withdrawnVests, wallet.props);
    const left = Math.max(0, total - done);
    if (left <= 0) return "";
    return `<p class="wallet-note">Powering down ${formatHiveLike(left, "hive")} remaining.</p>`;
  }

  function walletPageHtml(wallet, history, own) {
    const w = wallet || {};
    const props = w.props;
    const txs = (history || []).map((row) => walletTxHtml(row, props)).filter(Boolean);
    const hiveActions = own ? walletStakeButtons("hive") : "";
    const hbdActions = own ? walletStakeButtons("hbd") : "";
    return `
      <div class="wallet-page">
        ${walletAwardsHtml(w, own)}
        <section class="wallet-section">
          <h2>Balances</h2>
          <div class="wallet-table-wrap">
            <table class="wallet-table">
              <colgroup>
                <col class="wallet-col-label">
                <col class="wallet-col-amount">
                <col class="wallet-col-unit">
                <col class="wallet-col-actions">
              </colgroup>
              <tbody>
                ${walletBalanceRow("hive", w.hive, "hive", hiveActions)}
                ${walletBalanceRow("staked hive", w.stakedHive, "hive", "")}
                ${walletActionsUnderRow(hiveActions)}
                ${walletBalanceRow("delegated hive", w.delegatedHive, "hive", "")}
                ${walletBalanceRow("hbd", w.hbd, "hbd", hbdActions)}
                ${walletBalanceRow("staked hbd", w.stakedHbd, "hbd", "")}
                ${walletActionsUnderRow(hbdActions)}
              </tbody>
            </table>
          </div>
          ${walletPowerDownNote(w)}
        </section>
        <section class="wallet-section">
          <h2>Transactions</h2>
          ${
            txs.length
              ? `<div class="wallet-tx-list">${txs.join("")}</div>`
              : `<div class="panel empty-state"><h2>No recent transactions</h2><p>Wallet activity for this account will show up here.</p></div>`
          }
        </section>
      </div>
    `;
  }

  function walletOpCopy(kind) {
    if (kind === "stake-hive") {
      return {
        title: "Stake hive",
        lead: "Move liquid hive into staked hive.",
        symbol: "hive",
      };
    }
    if (kind === "unstake-hive") {
      return {
        title: "Unstake hive",
        lead: "Power down staked hive. This takes 13 weeks.",
        symbol: "hive",
      };
    }
    if (kind === "stake-hbd") {
      return {
        title: "Stake hbd",
        lead: "Move liquid hbd into staked hbd.",
        symbol: "hbd",
      };
    }
    return {
      title: "Unstake hbd",
      lead: "Withdraw staked hbd. This takes 3 days.",
      symbol: "hbd",
    };
  }

  function walletMaxFor(kind, wallet) {
    if (!wallet) return 0;
    if (kind === "stake-hive") return wallet.hive;
    if (kind === "unstake-hive") return HiveApi.vestsToHive(wallet.availableVests, wallet.props);
    if (kind === "stake-hbd") return wallet.hbd;
    if (kind === "unstake-hbd") return wallet.stakedHbd;
    return 0;
  }

  function setWalletOpStatus(msg, isError) {
    const el = $("#walletOpStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function closeWalletOverlay() {
    const ov = $("#walletOverlay");
    if (ov) ov.hidden = true;
    walletOpState.kind = "";
    walletOpState.max = 0;
    walletOpState.pending = false;
    const input = $("#walletAmount");
    if (input) input.value = "";
    setWalletOpStatus("");
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = false;
  }

  function openWalletOverlay(kind) {
    if (
      kind !== "stake-hive" &&
      kind !== "unstake-hive" &&
      kind !== "stake-hbd" &&
      kind !== "unstake-hbd"
    ) {
      return;
    }
    const wallet = profileState.wallet;
    if (!wallet || !isOwnAuthor(profileState.author)) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (!hasActiveSigner()) {
      showError(activeSignerNeededMessage());
      return;
    }
    const copy = walletOpCopy(kind);
    const max = walletMaxFor(kind, wallet);
    if (max <= 0) {
      showError("No " + copy.symbol + " available for this.");
      return;
    }
    walletOpState.kind = kind;
    walletOpState.max = max;
    walletOpState.symbol = copy.symbol;
    walletOpState.pending = false;
    const title = $("#walletOpTitle");
    if (title) title.textContent = copy.title;
    const lead = $("#walletOpLead");
    if (lead) {
      lead.textContent = copy.lead + " Available: " + formatHiveLike(max, copy.symbol) + ".";
    }
    const input = $("#walletAmount");
    if (input) {
      input.value = "";
      input.placeholder = formatHiveLike(max, copy.symbol);
    }
    setWalletOpStatus("");
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = false;
    const ov = $("#walletOverlay");
    if (ov) ov.hidden = false;
    if (input) input.focus();
  }

  function fillWalletMax() {
    const input = $("#walletAmount");
    if (!input || !walletOpState.max) return;
    input.value = roundAsset(walletOpState.max, 3).toFixed(3);
  }

  async function nextSavingsRequestId(account) {
    let rows = [];
    try {
      rows = await HiveApi.getSavingsWithdrawFrom(account);
    } catch {
      rows = [];
    }
    const used = new Set(
      rows.map((row) => Number(row && row.request_id)).filter((n) => Number.isFinite(n))
    );
    let id = Math.floor(Date.now() / 1000);
    while (used.has(id)) id += 1;
    return id >>> 0;
  }

  async function submitWalletOp() {
    const kind = walletOpState.kind;
    const wallet = profileState.wallet;
    const user = observer();
    if (!kind || !wallet || !user || !isOwnAuthor(profileState.author)) return;
    if (walletOpState.pending) return;
    if (!hasActiveSigner()) {
      setWalletOpStatus(activeSignerNeededMessage(), true);
      return;
    }
    const amount = roundAsset(parseAmountInput($("#walletAmount") && $("#walletAmount").value), 3);
    if (amount < 0.001) {
      setWalletOpStatus("Enter an amount of at least 0.001.", true);
      return;
    }
    const max = roundAsset(walletMaxFor(kind, wallet), 3);
    if (amount > max + 0.0000001) {
      setWalletOpStatus("That is more than " + formatHiveLike(max, walletOpState.symbol) + ".", true);
      return;
    }
    let operations;
    try {
      if (kind === "stake-hive") {
        operations = [
          [
            "transfer_to_vesting",
            { from: user, to: user, amount: formatChainAmount(amount, "HIVE", 3) },
          ],
        ];
      } else if (kind === "unstake-hive") {
        const vests = Math.min(
          HiveApi.hiveToVests(amount, wallet.props),
          wallet.availableVests
        );
        operations = [
          [
            "withdraw_vesting",
            { account: user, vesting_shares: formatChainAmount(vests, "VESTS", 6) },
          ],
        ];
      } else if (kind === "stake-hbd") {
        operations = [
          [
            "transfer_to_savings",
            {
              from: user,
              to: user,
              amount: formatChainAmount(amount, "HBD", 3),
              memo: "",
            },
          ],
        ];
      } else if (kind === "unstake-hbd") {
        const requestId = await nextSavingsRequestId(user);
        operations = [
          [
            "transfer_from_savings",
            {
              from: user,
              request_id: requestId,
              to: user,
              amount: formatChainAmount(amount, "HBD", 3),
              memo: "",
            },
          ],
        ];
      } else {
        setWalletOpStatus("Unknown wallet action.", true);
        return;
      }
    } catch (err) {
      setWalletOpStatus((err && err.message) || String(err), true);
      return;
    }
    walletOpState.pending = true;
    const submit = $("#walletOpSubmit");
    if (submit) submit.disabled = true;
    setWalletOpStatus(signingLabel());
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Active",
      operations,
      meta: { type: "wallet", action: kind },
    });
    try {
      await promise;
      closeWalletOverlay();
      currentViewKey = "";
      route();
    } catch (err) {
      setWalletOpStatus((err && err.message) || String(err), true);
      walletOpState.pending = false;
      if (submit) submit.disabled = false;
    }
  }

  function claimProfileAwards() {
    const user = observer();
    const wallet = profileState.wallet;
    const name = profileState.author;
    if (!wallet || !isOwnAuthor(name)) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (!walletHasAwards(wallet) || profileState.claimPending) return;
    profileState.claimPending = true;
    const btn = view.querySelector(".wallet-claim-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Claiming…";
    }
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "claim_reward_balance",
          {
            account: user,
            reward_hive: wallet.rewardHiveStr,
            reward_hbd: wallet.rewardHbdStr,
            reward_vests: wallet.rewardVestsStr,
          },
        ],
      ],
      meta: { type: "wallet", action: "claim" },
    });
    promise
      .then(() => {
        if (profileState.author !== name) return;
        currentViewKey = "";
        route();
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        profileState.claimPending = false;
        const claimBtn = view.querySelector(".wallet-claim-btn");
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = "Claim";
        }
        showError(err.message || String(err));
      });
  }

  async function renderProfileFeed(author, page) {
    const sort = page === "comments" ? "comments" : page === "replies" ? "replies" : "posts";
    resetFeed(sort, author);
    const emptyTitle =
      page === "comments" ? "No comments" : page === "replies" ? "No replies" : "No posts";
    const emptyDetail =
      page === "comments"
        ? "This account has not written comments yet."
        : page === "replies"
          ? "Nobody has replied to this account yet."
          : "This account has no root posts yet.";
    view.insertAdjacentHTML(
      "beforeend",
      `
        <div id="feedList" class="feed"></div>
        <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
        </div>
      `
    );
    const list = $("#feedList");
    const status = $("#feedStatus");
    const moreBtn = $("#moreBtn");

    async function loadPage() {
      if (feedState.loading || feedState.done) return;
      feedState.loading = true;
      let pages = 0;
      const startCount = feedState.items.length;
      const user = observer();
      try {
        while (
          pages < MAX_PAGES_PER_LOAD &&
          feedState.items.length < startCount + FEED_TARGET
        ) {
          const batch = await HiveApi.getAccountPosts({
            account: author,
            sort,
            limit: HiveApi.PAGE_SIZE,
            startAuthor: feedState.cursor && feedState.cursor.author,
            startPermlink: feedState.cursor && feedState.cursor.permlink,
            observer: user,
          });
          setNodeLabel();
          pages++;
          if (!batch.length) {
            feedState.done = true;
            break;
          }
          let added = 0;
          for (const post of batch) {
            const key = `${post.author}/${post.permlink}`;
            if (feedState.seen.has(key)) continue;
            feedState.seen.add(key);
            added++;
            if (sort === "posts" && !isRootPost(post)) continue;
            if (post.stats && post.stats.hide) continue;
            feedState.items.push(post);
          }
          const last = batch[batch.length - 1];
          if (
            !last ||
            (feedState.cursor &&
              last.author === feedState.cursor.author &&
              last.permlink === feedState.cursor.permlink)
          ) {
            feedState.done = true;
            break;
          }
          feedState.cursor = { author: last.author, permlink: last.permlink };
          if (batch.length < HiveApi.PAGE_SIZE) {
            feedState.done = true;
            break;
          }
          if (added === 0 && pages > 1) {
            feedState.done = true;
            break;
          }
        }
      } finally {
        feedState.loading = false;
      }
    }

    async function fill() {
      hideVoteSlider();
      moreBtn.hidden = true;
      status.hidden = false;
      try {
        await loadPage();
        clearError();
      } catch (err) {
        showError(err.message || String(err));
      }
      list.innerHTML = feedState.items.map(profileCardHtml).join("");
      if (!feedState.items.length && feedState.done) {
        status.hidden = true;
        list.innerHTML = `
          <div class="panel empty-state">
            <h2>${HiveMd.escapeHtml(emptyTitle)}</h2>
            <p>${HiveMd.escapeHtml(emptyDetail)}</p>
          </div>`;
        return;
      }
      status.hidden = true;
      moreBtn.hidden = feedState.done;
    }

    moreBtn.addEventListener("click", fill);
    await fill();
  }

  async function renderProfile(author, page) {
    const name = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    const tab = normalizeProfilePage(page) || "posts";
    view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading @${HiveMd.escapeHtml(name)}…</div>`;
    try {
      const [profile, hivePower] = await Promise.all([
        HiveApi.getProfile(name, observer()).catch(() => null),
        HiveApi.getHivePower(name).catch(() => null),
      ]);
      setNodeLabel();
      clearError();
      profileState.author = name;
      profileState.page = tab;
      profileState.profile = profile;
      profileState.followed = profileFollowed(profile);
      profileState.pending = false;
      profileState.claimPending = false;
      profileState.wallet = null;
      document.title = profilePageTitle(name, tab);
      const chrome = profileBannerHtml(name, profile, hivePower) + profileNavHtml(name, tab);

      if (tab === "wallet") {
        let wallet = null;
        let history = [];
        try {
          wallet = await HiveApi.getWallet(name);
        } catch (err) {
          showError(err.message || String(err));
        }
        if (!wallet) {
          view.innerHTML =
            chrome +
            `<div class="wallet-page"><div class="panel empty-state"><h2>Wallet unavailable</h2><p>Could not load balances for this account.</p></div></div>`;
          return;
        }
        try {
          history = await loadWalletHistory(name);
        } catch {
          history = [];
        }
        profileState.wallet = wallet;
        view.innerHTML = chrome + walletPageHtml(wallet, history, isOwnAuthor(name));
        return;
      }

      view.innerHTML = chrome;
      await renderProfileFeed(name, tab);
    } catch (err) {
      resetProfileState();
      showError(err.message || String(err));
      view.innerHTML = notFoundHtml("Could not load this account.");
    }
  }

  /* ─── Community ─── */
  function resetCommunityState() {
    communityState.name = "";
    communityState.info = null;
    communityState.subscribed = false;
    communityState.pending = false;
  }

  function communityTitleOf(info, name) {
    return (info && info.title) || name || "";
  }

  function communitySubscribed(info) {
    return Boolean(info && info.context && info.context.subscribed);
  }

  function communityNavHtml(name, page) {
    const items = [
      ["created", "Latest", communityHref(name, "created")],
      ["trending", "Trending", communityHref(name, "trending")],
      ["rules", "Rules", communityHref(name, "rules")],
      ["members", "Members", communityHref(name, "members")],
    ];
    return `
      <nav class="feed-nav community-nav" aria-label="Community">
        ${items
          .map(
            ([id, label, href]) =>
              `<a href="${href}" class="${id === page ? "is-active" : ""}">${label}</a>`
          )
          .join("")}
      </nav>
    `;
  }

  function communitySubscribeLabel() {
    if (communityState.pending) {
      return communityState.subscribed ? "Leaving…" : "Joining…";
    }
    return communityState.subscribed ? "Unsubscribe" : "Subscribe";
  }

  function communityBannerHtml(info) {
    const name = String((info && info.name) || communityState.name || "");
    const title = communityTitleOf(info, name);
    const about = (info && info.about) || "";
    const subscribers = Number((info && info.subscribers) || 0);
    const authors = Number((info && info.num_authors) || 0);
    const nsfw = Boolean(info && info.is_nsfw);
    const href = HiveMd.escapeHtml(communityHref(name));
    return `
      <div class="profile-banner community-banner">
        <div class="profile-head">
          <img class="avatar" src="${HiveMd.avatarUrl(name, "large")}" alt="">
          <div>
            <h1>${HiveMd.escapeHtml(title)}</h1>
            <p class="profile-handle"><a href="${href}">${HiveMd.escapeHtml(name)}</a></p>
            ${about ? `<p class="profile-about">${HiveMd.escapeHtml(about)}</p>` : ""}
            <div class="profile-stats">
              <span class="community-sub-count">${subscribers} subscribers</span>
              <span>${authors} authors</span>
              ${nsfw ? `<span class="community-nsfw">NSFW</span>` : ""}
            </div>
            <div class="community-head-actions">
              <button type="button" class="btn-primary btn-compact community-sub-btn" data-community="${HiveMd.escapeHtml(name)}" data-subscribed="${communityState.subscribed ? "1" : "0"}"${communityState.pending ? " disabled" : ""}>${communitySubscribeLabel()}</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function paintCommunityChrome() {
    const btn = view.querySelector(".community-sub-btn");
    if (btn) {
      btn.disabled = communityState.pending;
      btn.textContent = communitySubscribeLabel();
      btn.setAttribute("data-subscribed", communityState.subscribed ? "1" : "0");
      btn.classList.toggle("is-joined", communityState.subscribed);
    }
    const count = view.querySelector(".community-sub-count");
    if (count && communityState.info) {
      count.textContent = Number(communityState.info.subscribers || 0) + " subscribers";
    }
  }

  function communityRulesHtml(info) {
    const description = String((info && info.description) || "").trim();
    const rules = String((info && info.flag_text) || "").trim();
    if (!description && !rules) {
      return `
        <div class="community-panel">
          <div class="panel empty-state">
            <h2>No rules posted</h2>
            <p>This community has not published rules yet.</p>
          </div>
        </div>
      `;
    }
    return `
      <div class="community-panel community-rules">
        ${
          description
            ? `<section>
                <h2>About</h2>
                <div class="post-body">${HiveMd.renderMarkdown(description)}</div>
              </section>`
            : ""
        }
        ${
          rules
            ? `<section>
                <h2>Rules</h2>
                <div class="post-body">${HiveMd.renderMarkdown(rules)}</div>
              </section>`
            : ""
        }
      </div>
    `;
  }

  function communityMemberHtml(row) {
    const name = String((row && row.name) || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (!name) return "";
    const role = String((row && row.role) || "").toLowerCase();
    const title = String((row && row.title) || "").trim();
    const showRole = role && role !== "guest" && role !== "member";
    return `<tr class="community-member">
        <td class="community-member-who">${authorLinkHtml(name, "small")}</td>
        <td class="community-member-title">${title ? HiveMd.escapeHtml(title) : ""}</td>
        <td class="community-member-role">${showRole ? HiveMd.escapeHtml(role) : ""}</td>
      </tr>`;
  }

  function communityTableHtml(bodyHtml, bodyId) {
    const idAttr = bodyId ? ` id="${HiveMd.escapeHtml(bodyId)}"` : "";
    return `<div class="community-table-wrap">
        <table class="community-table">
          <colgroup>
            <col class="community-col-who">
            <col class="community-col-title">
            <col class="community-col-role">
          </colgroup>
          <tbody${idAttr}>${bodyHtml || ""}</tbody>
        </table>
      </div>`;
  }

  function communityMembersEmptyRow(heading, detail) {
    return `<tr class="community-table-empty">
        <td colspan="3">
          <div class="panel empty-state">
            <h2>${HiveMd.escapeHtml(heading)}</h2>
            <p>${HiveMd.escapeHtml(detail)}</p>
          </div>
        </td>
      </tr>`;
  }

  function communityTeamRows(info) {
    const team = (info && Array.isArray(info.team) && info.team) || [];
    return team
      .map((row) => {
        if (Array.isArray(row)) {
          return { name: String(row[0] || ""), role: String(row[1] || ""), title: String(row[2] || "") };
        }
        if (row && typeof row === "object") {
          return {
            name: String(row.name || ""),
            role: String(row.role || ""),
            title: String(row.title || ""),
          };
        }
        return { name: "", role: "", title: "" };
      })
      .filter((row) => row.name);
  }

  function communityPageTitle(info, name, page) {
    const title = communityTitleOf(info, name);
    if (page === "rules") return "Rules · " + title + " — Crypto Space 77";
    if (page === "members") return "Members · " + title + " — Crypto Space 77";
    return title + " — Crypto Space 77";
  }

  function toggleCommunitySubscription() {
    const user = observer();
    const name = communityState.name;
    if (!name) return;
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    if (communityState.pending) return;
    const subscribe = !communityState.subscribed;
    const action = subscribe ? "subscribe" : "unsubscribe";
    communityState.pending = true;
    paintCommunityChrome();
    const { promise } = ChainQueue.enqueue({
      username: user,
      key: "Posting",
      operations: [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [user],
            id: "community",
            json: JSON.stringify([action, { community: name }]),
          },
        ],
      ],
      meta: { type: "community", action, community: name },
    });
    promise
      .then(() => {
        publishSubs = [];
        publishSubsUser = "";
        if (communityState.name !== name) return;
        communityState.subscribed = subscribe;
        if (communityState.info) {
          const n = Number(communityState.info.subscribers || 0);
          communityState.info.subscribers = Math.max(0, n + (subscribe ? 1 : -1));
          if (!communityState.info.context) communityState.info.context = {};
          communityState.info.context.subscribed = subscribe;
        }
        paintCommunityChrome();
      })
      .catch((err) => {
        if (communityState.name !== name) return;
        showError(err.message || String(err));
      })
      .finally(() => {
        if (communityState.name !== name) return;
        communityState.pending = false;
        paintCommunityChrome();
      });
  }

  async function renderCommunityMembers(info) {
    const name = String((info && info.name) || communityState.name || "");
    const team = communityTeamRows(info);
    const teamHtml = team.map(communityMemberHtml).join("");
    const host = view.querySelector("#communityMembers");
    if (!host) return;
    host.innerHTML = `
      ${
        teamHtml
          ? `<section class="community-people-section">
              <h2>Team</h2>
              ${communityTableHtml(teamHtml)}
            </section>`
          : ""
      }
      <section class="community-people-section">
        <h2>Members</h2>
        ${communityTableHtml("", "communityMemberList")}
        <div id="communityMemberStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading members…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreMembersBtn" hidden>Load more</button>
        </div>
      </section>
    `;
    const list = $("#communityMemberList");
    const status = $("#communityMemberStatus");
    const moreBtn = $("#moreMembersBtn");
    const seen = new Set(team.map((row) => String(row.name || "").toLowerCase()));
    let last = "";
    let done = false;
    let loading = false;

    async function fill() {
      if (loading || done) return;
      loading = true;
      if (moreBtn) moreBtn.hidden = true;
      if (status) status.hidden = false;
      try {
        const batch = await HiveApi.listSubscribers(name, last, 100);
        clearError();
        if (!batch.length) {
          done = true;
        } else {
          const parts = [];
          for (const row of batch) {
            const key = String(row.name || "").toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            parts.push(communityMemberHtml(row));
          }
          if (list && parts.length) list.insertAdjacentHTML("beforeend", parts.join(""));
          const nextLast = String(batch[batch.length - 1].name || "").toLowerCase();
          if (!nextLast || nextLast === last || batch.length < 100) done = true;
          else last = nextLast;
        }
      } catch (err) {
        showError(err.message || String(err));
        done = true;
        loading = false;
        if (status) status.hidden = true;
        if (moreBtn) moreBtn.hidden = true;
        if (list && !list.querySelector("tr.community-member")) {
          list.innerHTML = communityMembersEmptyRow(
            "Could not load members",
            "Try again in a moment."
          );
        }
        return;
      }
      loading = false;
      const empty = list && !list.querySelector("tr.community-member");
      if (empty && done) {
        if (status) status.hidden = true;
        if (list) {
          list.innerHTML = communityMembersEmptyRow(
            "No members yet",
            "Be the first to subscribe."
          );
        }
        return;
      }
      if (status) status.hidden = true;
      if (moreBtn) moreBtn.hidden = done;
    }

    if (moreBtn) moreBtn.addEventListener("click", fill);
    await fill();
  }

  async function renderCommunity(name, page) {
    const id = normalizeCommunityName(name);
    const tab = normalizeCommunityPage(page) || "created";
    view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading community…</div>`;
    try {
      const info = await HiveApi.getCommunity(id, observer());
      setNodeLabel();
      if (!info || !info.name) {
        resetCommunityState();
        view.innerHTML = notFoundHtml("This community could not be found on Hive.");
        return;
      }
      clearError();
      communityState.name = String(info.name).toLowerCase();
      communityState.info = info;
      communityState.subscribed = communitySubscribed(info);
      communityState.pending = false;
      document.title = communityPageTitle(info, communityState.name, tab);
      const chrome = communityBannerHtml(info) + communityNavHtml(communityState.name, tab);

      if (tab === "rules") {
        view.innerHTML = chrome + communityRulesHtml(info);
        return;
      }

      if (tab === "members") {
        view.innerHTML = chrome + `<div class="community-panel" id="communityMembers"></div>`;
        await renderCommunityMembers(info);
        return;
      }

      resetFeed(tab, communityState.name);
      view.innerHTML = `
        ${chrome}
        <div id="feedList" class="feed"></div>
        <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading posts…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
        </div>
      `;
      const list = $("#feedList");
      const status = $("#feedStatus");
      const moreBtn = $("#moreBtn");

      async function fill() {
        hideVoteSlider();
        moreBtn.hidden = true;
        status.hidden = false;
        try {
          await loadFeedPage();
          clearError();
        } catch (err) {
          showError(err.message || String(err));
        }
        list.innerHTML = feedState.items.map(cardHtml).join("");
        if (!feedState.items.length && feedState.done) {
          status.hidden = true;
          list.innerHTML = `
            <div class="panel empty-state">
              <h2>No posts in this community</h2>
              <p>Try another sort, or check back later.</p>
            </div>`;
          return;
        }
        status.hidden = true;
        moreBtn.hidden = feedState.done;
      }

      moreBtn.addEventListener("click", fill);
      await fill();
    } catch (err) {
      resetCommunityState();
      showError(err.message || String(err));
      view.innerHTML = notFoundHtml("Could not load this community.");
    }
  }

  function renderImprint() {
    document.title = "Imprint — Crypto Space 77";
    view.innerHTML = `
      <section class="imprint">
        <h2 class="imprint-title">Imprint</h2>
        <p>This is a local open-source web app running entirely in the user's browser. No data is stored or processed on or by cryptospace77.com. The site does not use cookies.</p>
        <p>Developed by DI Viktor Krammer<br>
        Vienna, Austria<br>
        in the European Union
        </p>
        <h3>Disclaimer</h3>
        <p>Crypto Space 77 is experimental alpha software. Run it at your own risk.</p>
        <p>Powered by the <a href="https://hive.io/">hive blockchain</a></p>
      </section>
    `;
  }

  function notFoundHtml(msg) {
    return `
      <div class="panel empty-state">
        <h2>Signal lost</h2>
        <p>${HiveMd.escapeHtml(msg || "Nothing at this URL.")}</p>
        <p style="margin-top:1rem"><a href="${appHref("/")}">Return to the feed</a></p>
      </div>
    `;
  }

  function setPublishFabHidden(hidden) {
    const fab = $("#publishFab");
    if (fab) fab.hidden = hidden;
  }

  function welcomeSeen() {
    try {
      return localStorage.getItem(WELCOME_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markWelcomeSeen() {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
  }

  function isHomeIndex(r) {
    return Boolean(r && r.name === "feed" && !r.tag && isHomePath());
  }

  function resolveWelcome(r) {
    if (r && r.name === "publish") {
      return document.body.classList.contains("has-welcome");
    }
    if (r && r.name === "welcome") {
      welcomeHold = false;
      return true;
    }
    if (!isHomeIndex(r)) {
      welcomeHold = false;
      return false;
    }
    // Logged-out visitors always get the flyer on the index. The seen flag
    // only suppresses it after a signed-in visit.
    if (!observer()) {
      welcomeHold = true;
      return true;
    }
    if (welcomeHold || !welcomeSeen()) {
      welcomeHold = true;
      markWelcomeSeen();
      return true;
    }
    return false;
  }

  function syncWelcomeHeaderHeight() {
    const header = $(".header");
    if (!header) return;
    document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  }

  function applyWelcome(show) {
    const flyer = $("#welcomeFlyer");
    const was = document.body.classList.contains("has-welcome");
    if (show) syncWelcomeHeaderHeight();
    document.body.classList.toggle("has-welcome", show);
    if (flyer) flyer.hidden = !show;
    if (was && !show) window.scrollTo(0, 0);
  }

  function scrollToFeed() {
    const feed = document.querySelector("#view .feed-nav") || $("#view");
    if (!feed) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    feed.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
  }

  function bindWelcome() {
    const btn = $("#welcomeDown");
    if (btn) btn.addEventListener("click", scrollToFeed);
    const header = $(".header");
    if (header && typeof ResizeObserver === "function") {
      const headerObserver = new ResizeObserver(() => {
        if (document.body.classList.contains("has-welcome")) syncWelcomeHeaderHeight();
      });
      headerObserver.observe(header);
    } else {
      window.addEventListener("resize", () => {
        if (document.body.classList.contains("has-welcome")) syncWelcomeHeaderHeight();
      });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (document.body.classList.contains("has-welcome")) syncWelcomeHeaderHeight();
      });
    }
  }

  async function route() {
    closeLogoMenu();
    hideVoteSlider();
    clearError();
    const r = parseRoute();
    const showWelcome = resolveWelcome(r);
    applyWelcome(showWelcome);
    if (isHomePath() && observer() && !showWelcome) {
      navigate(appHref(pathForFeedSort(defaultFeedSort())), true);
      return;
    }
    if (r.name === "feed" && r.sort === "feed" && !observer()) {
      navigate(appHref("/"), true);
      return;
    }
    if (r.name !== "post") currentPost = null;
    if (r.name !== "community") resetCommunityState();
    if (r.name !== "profile") resetProfileState();
    if (r.name !== "publish") {
      document.body.classList.toggle(
        "is-profile",
        r.name === "profile" || r.name === "community"
      );
      document.body.classList.toggle("is-community", r.name === "community");
    }
    const jumpComments =
      r.name === "post" &&
      (pendingCommentsScroll || (!HASH_ROUTING && location.hash === "#comments"));
    pendingCommentsScroll = false;

    if (r.name === "publish") {
      const remembered = String(lastNonPublishPath || "").replace(/\/+$/, "") || "/";
      const keepRemembered = remembered === "/" || parseRoute(remembered).name === "welcome";
      if (currentViewKey && !keepRemembered) lastNonPublishPath = pathFromViewKey(currentViewKey);
      else if (!currentViewKey && (!lastNonPublishPath || parseRoute(lastNonPublishPath).name === "publish")) {
        lastNonPublishPath = "/";
      }
      if (!currentViewKey) {
        window.scrollTo(0, 0);
        const sort = defaultFeedSort();
        document.title =
          sort === "feed" ? "Feed — Crypto Space 77" : "Crypto Space 77";
        await renderFeed(sort, true);
        currentViewKey = "feed:" + sort;
        storeFeedView(sort);
      }
      openPublishOverlay();
      return;
    }

    hidePublishOverlay();
    const key = routeKey(r);
    if (key && key === currentViewKey && view.innerHTML.trim()) {
      if (r.name === "feed") {
        document.title = r.tag
          ? "#" + r.tag + " — Crypto Space 77"
          : r.sort === "feed"
            ? "Feed — Crypto Space 77"
            : "Crypto Space 77";
      } else if (r.name === "post") {
        requestAnimationFrame(() => {
          if (jumpComments) scrollToComments();
          else scrollToAnchor();
        });
      } else if (r.name === "profile") {
        document.title = profilePageTitle(r.author, r.page);
      } else if (r.name === "community") {
        document.title = communityPageTitle(communityState.info, r.community, r.page);
      } else if (r.name === "tags") {
        document.title = "Tags — Crypto Space 77";
      } else if (r.name === "communities") {
        document.title = "Communities — Crypto Space 77";
      } else if (r.name === "welcome") {
        document.title = "Crypto Space 77";
      } else if (r.name === "imprint") {
        document.title = "Imprint — Crypto Space 77";
      }
      return;
    }

    window.scrollTo(0, 0);
    if (r.name === "welcome") {
      document.title = "Crypto Space 77";
      await renderFeed("created", true, "");
      currentViewKey = key;
      return;
    }
    if (r.name === "feed") {
      if (!r.tag && !(showWelcome && isHomePath())) storeFeedView(r.sort);
      if (r.tag) {
        document.title = "#" + r.tag + " — Crypto Space 77";
      } else {
        document.title =
          r.sort === "feed" ? "Feed — Crypto Space 77" : "Crypto Space 77";
      }
      await renderFeed(r.sort, true, r.tag || "");
      currentViewKey = key;
      return;
    }
    if (r.name === "post") {
      await renderPost(r.author, r.permlink);
      currentViewKey = key;
      requestAnimationFrame(() => {
        if (jumpComments) scrollToComments();
        else scrollToAnchor();
      });
      return;
    }
    if (r.name === "profile") {
      const canonical = pathForProfile(r.author, r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        navigate(appHref(canonical), true);
        return;
      }
      await renderProfile(r.author, r.page);
      currentViewKey = key;
      return;
    }
    if (r.name === "community") {
      const canonical = pathForCommunity(r.community, r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        navigate(appHref(canonical), true);
        return;
      }
      await renderCommunity(r.community, r.page);
      currentViewKey = key;
      return;
    }
    if (r.name === "tags") {
      await renderTagsPage();
      currentViewKey = key;
      return;
    }
    if (r.name === "communities") {
      await renderCommunitiesPage();
      currentViewKey = key;
      return;
    }
    if (r.name === "imprint") {
      renderImprint();
      currentViewKey = key;
      return;
    }
    document.title = "Not found — Crypto Space 77";
    view.innerHTML = notFoundHtml();
    currentViewKey = "notfound";
  }

  function bindScrollTop() {
    const btn = $("#scrollTopBtn");
    if (!btn) return;
    const toggle = () => {
      btn.classList.toggle("is-visible", window.scrollY > 320);
    };
    window.addEventListener("scroll", toggle, { passive: true });
    btn.addEventListener("click", () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      window.scrollTo({ top: 0, behavior: reduce.matches ? "auto" : "smooth" });
    });
    toggle();
  }

  function bindLogoSpin() {
    const logo = $(".app-logo");
    if (!logo) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let angle = 0;

    logo.addEventListener("pointerenter", () => {
      if (reduce.matches) return;
      logo.classList.add("is-spinning");
    });

    logo.addEventListener("pointermove", (e) => {
      if (reduce.matches) return;
      angle += e.movementX;
      logo.style.transform = "rotate(" + angle + "deg)";
    });

    logo.addEventListener("pointerleave", () => {
      angle = 0;
      logo.classList.remove("is-spinning");
      logo.style.transform = "rotate(0deg)";
    });
  }

  function bindLogoMenu() {
    paintLogoMenu();
    const menu = $("#logoMenu");
    const trigger = $("#logoTrigger");
    if (!menu || !trigger) return;

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !menu.classList.contains("is-open");
      menu.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (e) => {
      if (!menu.classList.contains("is-open")) return;
      if (e.target.closest("#logoMenu")) {
        if (e.target.closest(".logo-dropdown-link")) closeLogoMenu();
        return;
      }
      closeLogoMenu();
    });
  }

  function bindRootLinks() {
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      a.setAttribute("href", appHref(href));
    });
  }

  function boot() {
    bindRootLinks();
    bindLogoSpin();
    bindLogoMenu();
    bindNodeMenus();
    bindScrollTop();
    bindWelcome();
    const versionEl = document.getElementById("appVersion");
    if (versionEl) versionEl.textContent = "version " + APP_VERSION;

    document.addEventListener("input", (e) => {
      const slider = e.target.closest(".vote-slider");
      if (slider) {
        const panel =
          slider.closest(".downvote-slider-panel") || slider.closest(".vote-slider-panel");
        if (!panel) return;
        const valueEl = panel.querySelector(".vote-weight-value");
        const isDown = Boolean(slider.closest(".downvote-slider-panel"));
        paintVoteSlider(slider, valueEl);
        if (isDown) storeDownvoteWeight(slider.value, voteKindFromEl(slider));
        else storeWeight(slider.value, voteKindFromEl(slider));
        return;
      }
      if (
        e.target.id === "publishTitle" ||
        e.target.id === "publishBody" ||
        e.target.id === "publishTagInput"
      ) {
        if (e.target.id !== "publishTagInput") {
          savePublishDraft();
          updatePublishPreview();
        }
        schedulePublishDraftSave();
      }
    });

    document.addEventListener(
      "click",
      (e) => {
        const confirm = e.target.closest(".downvote-confirm");
        if (confirm) {
          e.preventDefault();
          e.stopPropagation();
          onDownvoteConfirm(confirm);
          return;
        }
        if (
          e.target.closest(".vote-slider-panel") ||
          e.target.closest(".downvote-slider-panel")
        ) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const downBtn = e.target.closest(".downvote-btn");
        if (downBtn && view.contains(downBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onDownvoteClick(downBtn);
          return;
        }
        const countBtn = e.target.closest(".vote-count-btn");
        if (countBtn && view.contains(countBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteCountClick(countBtn);
          return;
        }
        const btn = e.target.closest(".vote-btn");
        if (btn && view.contains(btn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteClick(btn);
          return;
        }
        if (
          !e.target.closest(".vote-wrap") &&
          !e.target.closest(".vote-voters-panel")
        ) {
          hideVoteSlider();
        }
      },
      true
    );

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !openSlider) return;
      hideVoteSlider();
    });

    view.addEventListener("click", (e) => {
      const removeTag = e.target.closest("[data-remove-tag]");
      if (removeTag && view.contains(removeTag)) {
        e.preventDefault();
        removeFavoriteTag(removeTag.getAttribute("data-remove-tag"));
        return;
      }
      const addTag = e.target.closest("[data-add-tag]");
      if (addTag && view.contains(addTag)) {
        e.preventDefault();
        addFavoriteTag(addTag.getAttribute("data-add-tag"));
        return;
      }
      const removeCommunity = e.target.closest("[data-remove-community]");
      if (removeCommunity && view.contains(removeCommunity)) {
        e.preventDefault();
        removeFavoriteCommunity(removeCommunity.getAttribute("data-remove-community"));
        return;
      }
      const toggleCommunity = e.target.closest("[data-toggle-community]");
      if (toggleCommunity && view.contains(toggleCommunity)) {
        e.preventDefault();
        toggleFavoriteCommunity(
          toggleCommunity.getAttribute("data-toggle-community"),
          toggleCommunity.getAttribute("data-community-title")
        );
        return;
      }
      const subBtn = e.target.closest(".community-sub-btn");
      if (subBtn && view.contains(subBtn)) {
        e.preventDefault();
        toggleCommunitySubscription();
        return;
      }
      const followBtn = e.target.closest(".profile-follow-btn");
      if (followBtn && view.contains(followBtn)) {
        e.preventDefault();
        toggleProfileFollow();
        return;
      }
      const claimBtn = e.target.closest(".wallet-claim-btn");
      if (claimBtn && view.contains(claimBtn)) {
        e.preventDefault();
        claimProfileAwards();
        return;
      }
      const stakeBtn = e.target.closest(".wallet-stake-btn");
      if (stakeBtn && view.contains(stakeBtn)) {
        e.preventDefault();
        openWalletOverlay(stakeBtn.getAttribute("data-wallet-op") || "");
        return;
      }
      const postEditBtn = e.target.closest(".post-edit-btn");
      if (postEditBtn && view.contains(postEditBtn)) {
        e.preventDefault();
        openPostEditor();
        return;
      }
      const editBtn = e.target.closest(".comment-edit-btn");
      if (editBtn && view.contains(editBtn)) {
        e.preventDefault();
        toggleCommentEditor(editBtn);
        return;
      }
      const cancelBtn = e.target.closest(".composer-cancel");
      if (cancelBtn && view.contains(cancelBtn)) {
        e.preventDefault();
        const comment = cancelBtn.closest(".comment");
        if (comment) closeCommentEditor(comment);
        return;
      }
      const replyBtn = e.target.closest(".comment-reply-btn");
      if (replyBtn && view.contains(replyBtn)) {
        e.preventDefault();
        toggleReplyComposer(replyBtn);
        return;
      }
      const attachBtn = e.target.closest(".composer-attach");
      if (attachBtn) {
        e.preventDefault();
        const composer = attachBtn.closest(".comment-composer");
        const input = composer && composer.querySelector(".composer-file");
        if (input) input.click();
        return;
      }
      const submitBtn = e.target.closest(".composer-submit");
      if (submitBtn) {
        e.preventDefault();
        const composer = submitBtn.closest(".comment-composer");
        if (composer) submitComment(composer);
      }
    });

    view.addEventListener("submit", (e) => {
      if (!e.target) return;
      if (e.target.id === "favTagsForm") {
        e.preventDefault();
        addFavoriteFromInput();
        return;
      }
      if (e.target.id === "communitySearchForm") {
        e.preventDefault();
        runCommunitySearch();
      }
    });

    view.addEventListener("change", (e) => {
      const input = e.target.closest(".composer-file");
      if (!input) return;
      const composer = input.closest(".comment-composer");
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (composer && files.length) uploadImagesToComposer(composer, files);
    });

    view.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      const composer = e.target.closest(".comment-composer");
      if (!composer || !view.contains(composer)) return;
      e.preventDefault();
      submitComment(composer);
    });

    view.addEventListener("dragenter", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !view.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      composer.classList.add("is-dragover");
    });

    view.addEventListener("dragover", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !view.contains(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });

    view.addEventListener("dragleave", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer) return;
      if (e.relatedTarget && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-dragover");
    });

    view.addEventListener("drop", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !view.contains(composer)) return;
      e.preventDefault();
      composer.classList.remove("is-dragover");
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) uploadImagesToComposer(composer, files);
      else composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
    });

    view.addEventListener("paste", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !view.contains(composer)) return;
      const clip = e.clipboardData;
      const files = clip && clip.files ? Array.from(clip.files).filter(isImageFile) : [];
      if (!files.length) return;
      e.preventDefault();
      uploadImagesToComposer(composer, files);
    });

    document.addEventListener("pointerover", (e) => {
      const arrow = e.target.closest && e.target.closest(".vote-btn, .downvote-btn");
      if (arrow && arrow.getAttribute("data-vote-left") === "1") {
        const fromArrow = e.relatedTarget;
        if (!fromArrow || !arrow.contains(fromArrow)) releaseVoteColor(arrow);
      }
      if (!hoverFine()) return;
      const hit = voteHitFrom(e.target);
      if (!hit || !view.contains(hit)) return;
      const from = e.relatedTarget;
      if (from && hit.contains(from)) return;
      onVoteHitEnter(hit);
    });
    document.addEventListener("pointerout", (e) => {
      const arrow = e.target.closest && e.target.closest(".vote-btn, .downvote-btn");
      if (arrow && arrow.classList.contains("is-rest") && arrow.getAttribute("data-vote-rest-armed") === "1") {
        const toArrow = e.relatedTarget;
        if (!toArrow || !arrow.contains(toArrow)) arrow.setAttribute("data-vote-left", "1");
      }
      const hit = voteHitFrom(e.target);
      if (!hit) return;
      const to = e.relatedTarget;
      if (to && hit.contains(to)) return;
      const panel = votersPanelNode;
      if (to && panel && panel.contains(to)) return;
      scheduleHideVoters();
    });

    window.addEventListener("scroll", repositionOpenSlider, true);
    window.addEventListener("resize", repositionOpenSlider);

    ChainQueue.subscribe((event) => {
      if (event && typeof event.size === "number") renderQueueStatus(event.size);
    });

    $("#loginCancel").addEventListener("click", closeLogin);
    $("#loginConnect").addEventListener("click", connectLogin);
    $("#loginUser").addEventListener("keydown", (e) => {
      if (e.key === "Enter") connectLogin();
    });
    const loginKey = $("#loginKey");
    if (loginKey) {
      loginKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") connectLogin();
      });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeLogin();
    });

    const walletOverlay = $("#walletOverlay");
    if (walletOverlay) {
      const walletCancel = $("#walletOpCancel");
      const walletSubmit = $("#walletOpSubmit");
      const walletMax = $("#walletOpMax");
      const walletAmount = $("#walletAmount");
      if (walletCancel) walletCancel.addEventListener("click", closeWalletOverlay);
      if (walletSubmit) walletSubmit.addEventListener("click", submitWalletOp);
      if (walletMax) walletMax.addEventListener("click", fillWalletMax);
      if (walletAmount) {
        walletAmount.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submitWalletOp();
        });
      }
      walletOverlay.addEventListener("click", (e) => {
        if (e.target === walletOverlay) closeWalletOverlay();
      });
    }

    const publishFab = $("#publishFab");
    if (publishFab) publishFab.setAttribute("href", appHref("/publish"));
    const publishOverlay = $("#publishOverlay");
    if (publishOverlay) {
      bindComposerMedia(publishOverlay);
      publishOverlay.addEventListener("click", (e) => {
        if (e.target === publishOverlay) {
          closePublish();
          return;
        }
        if (e.target.closest("#publishCancel")) {
          e.preventDefault();
          cancelPublish();
          return;
        }
        if (e.target.closest("#publishSubmit")) {
          e.preventDefault();
          submitPublish();
          return;
        }
        if (e.target.closest("#publishDestBtn")) {
          e.preventDefault();
          e.stopPropagation();
          toggleDestMenu();
          return;
        }
        const destOpt = e.target.closest(".publish-dest-option");
        if (destOpt) {
          e.preventDefault();
          selectPublishDest(
            destOpt.getAttribute("data-dest-type"),
            destOpt.getAttribute("data-dest-name") || "",
            destOpt.getAttribute("data-dest-title") || ""
          );
          return;
        }
        const chip = e.target.closest(".publish-tag-chip");
        if (chip) {
          e.preventDefault();
          const tag = chip.getAttribute("data-tag");
          publishTags = publishTags.filter((t) => t !== tag);
          paintPublishTags();
          schedulePublishDraftSave();
        }
      });
      publishOverlay.addEventListener("keydown", (e) => {
        if (e.target.id === "publishTagInput") {
          if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
            if (e.key !== "Tab" || e.target.value.trim()) e.preventDefault();
            takeTagsFromInput();
            return;
          }
          if (e.key === "Backspace" && !e.target.value && publishTags.length) {
            publishTags.pop();
            paintPublishTags();
            schedulePublishDraftSave();
          }
          return;
        }
        if (e.key === "Escape") {
          if (publishDiscardOpen()) {
            hidePublishDiscard();
            return;
          }
          if (destMenuOpen()) {
            closeDestMenu();
            return;
          }
          closePublish();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submitPublish();
        }
      });
      publishOverlay.addEventListener("focusout", (e) => {
        if (e.target && e.target.id === "publishTagInput") takeTagsFromInput();
      });
    }
    const publishDiscard = $("#publishDiscard");
    if (publishDiscard) {
      publishDiscard.addEventListener("click", (e) => {
        if (e.target === publishDiscard || e.target.closest("#publishDiscardKeep")) {
          hidePublishDiscard();
          return;
        }
        if (e.target.closest("#publishDiscardConfirm")) {
          e.preventDefault();
          discardPublishAndClose();
        }
      });
    }
    window.addEventListener("pagehide", persistPublishDraftNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistPublishDraftNow();
    });
    document.addEventListener("click", (e) => {
      if (!destMenuOpen()) return;
      if (e.target.closest("#publishDest")) return;
      closeDestMenu();
    });

    function start() {
      restoreRememberedSession();
      renderSession();
      hydratePublishDraftFromStorage();
      refreshHivePower();
      renderQueueStatus(ChainQueue.size());
      route();
    }

    if (window.HiveAuth && typeof HiveAuth.ready === "function") {
      HiveAuth.ready().then(start, start);
    } else {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
