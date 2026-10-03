/**
 * Crypto Space 77 — main javascript for router, feed, post, comments, and page processing.
 */
(function () {
  "use strict";

  const APP_ID = "cryptospace77.com";
  const APP_VERSION = "0.15";
  const FEED_TARGET = 20;
  const FILTER_LOW_REP = 20;
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
  const VOTERS_PAGE = 40;
  const VOTERS_SCROLL_PX = 72;
  const IMAGE_HOST = "https://images.hive.blog";
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_TAGS = 10;
  const FAVORITE_TAGS_KEY = "cs77_favorite_tags";
  const MAX_FAVORITE_TAGS = 40;
  const FAVORITE_COMMUNITIES_KEY = "cs77_favorite_communities";
  const WELCOME_SEEN_KEY = "cs77_welcome_seen";
  const PROFILE_IMAGE_KEY = "cs77_profile_image";
  const SESSION_AVATAR_DEFAULT_LARGE = "/assets/satoshi.png";
  const SESSION_AVATAR_DEFAULT_SMALL = "/assets/satoshi-small.png";
  const MAX_FAVORITE_COMMUNITIES = 40;
  const PUBLISH_DRAFT_KEY = "cs77_publish_draft";
  const PUBLISH_DRAFT_SAVE_MS = 2000;
  const LOGO_FAVORITES_SHOW = 10;
  const SUGGESTED_TAGS_SHOW = 24;
  const NOTIF_LIMIT = 100;
  const NOTIF_SCROLL_PX = 72;
  const NOTIF_POLL_MS = 60000;
  const ACCOUNT_STATE_FRESH_MS = 60000;

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const errorBanner = $("#errorBanner");
  const errorText = $("#errorText");
  const sessionSlot = $("#sessionSlot");
  const overlay = $("#loginOverlay");
  const queueSlot = $("#queueSlot");

  const localVotes = new Map();
  const votesCache = new Map();
  const localReblogs = new Map();
  const reblogsCache = new Map();
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
  let publishNavPushed = false;
  let currentViewKey = "";
  let initialPageLoad = true;
  // Set for a click on the profile nav. route() clears it. Those switches
  // keep the scroll position; session and logo links still go to the top.
  let profileNavSwitch = false;
  let welcomeHold = false;
  let currentPost = null;
  const postLayer = {
    open: false,
    author: "",
    permlink: "",
    gen: 0,
    scrollY: 0,
    heldScroll: false,
    hadWelcome: false,
  };
  const postSnaps = new Map();
  const cardContentStamps = new Map();
  const originalPostCache = new Map();
  const revealedMuted = new Set();
  const POST_SNAP_MAX = 6;
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
    walletTx: null,
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
    cursor: "",
    done: false,
    loadingMore: false,
    seen: new Set(),
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
    return kind === "image"
      ? "Signing image…"
      : "Publishing……";
  }

  function isOwnAuthor(author) {
    const user = observer();
    return Boolean(user && author && user === String(author).toLowerCase());
  }
  
  let mousePointerSeen = false;
  
  function hoverFine() {
    return mousePointerSeen;
  }

  function syncHasMouseClass() {
    document.documentElement.classList.toggle("has-mouse", hoverFine());
  }
  
  window.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse") return;
    if (mousePointerSeen) return;
    mousePointerSeen = true;
    syncHasMouseClass();
  },
  { once: true }
  );

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
        if (e.target === nodeOverlay) {
          const active = document.activeElement;
          if (!active || !nodeOverlay.contains(active)) {
            closeNodeOverlay();
          }
        }
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

  function formatCreatedUtc(created) {
    const ts = parseCreatedTs(created);
    if (!Number.isFinite(ts)) return "";
    const iso = new Date(ts).toISOString();
    return iso.slice(0, 10) + " " + iso.slice(11, 19) + " UTC";
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

  function repositionOpenSlider(e) {
    if (e && e.type === "scroll" && votersPanelNode) {
      const t = e.target;
      if (t === votersPanelNode || (t && t.nodeType === 1 && votersPanelNode.contains(t))) {
        return;
      }
    }
    if (openSlider && !openSlider.panel.hidden) {
      placeVoteSlider(openSlider.btn, openSlider.panel);
    }
    if (openVoters && openVoters.el && openVoters.el.isConnected) {
      placeVoteVoters(openVoters.el, votersPanelEl());
    } else if (openVoters) {
      hideVoteVoters();
    }
    if (openReblog && openReblog.btn && openReblog.btn.isConnected && openReblog.panel) {
      placeReblogConfirm(openReblog.btn, openReblog.panel);
    } else if (openReblog) {
      hideReblogConfirm();
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
    hideReblogConfirm();
  }

  function hideVoteUi() {
    hideVoteSlider();
  }

  let openVoters = null;
  let votersGen = 0;
  let votersShowTimer = 0;
  let votersHideTimer = 0;
  let votersPanelNode = null;
  let votersTouching = false;
  let openReblog = null;
  let reblogConfirmGen = 0;

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
        votersHideTimer = 0;
      });
      el.addEventListener("pointerdown", (e) => {
        window.clearTimeout(votersHideTimer);
        votersHideTimer = 0;
        if (e.pointerType !== "mouse") votersTouching = true;
      });
      let touchUnlockTimer = 0;
      const endVotersTouch = () => {
        window.clearTimeout(touchUnlockTimer);
        touchUnlockTimer = window.setTimeout(() => {
          votersTouching = false;
        }, 350);
      };
      el.addEventListener("pointerup", endVotersTouch);
      el.addEventListener("pointercancel", endVotersTouch);
      el.addEventListener("pointerleave", scheduleHideVoters);
      el.addEventListener(
        "scroll",
        () => {
          maybeLoadMoreVoters();
        },
        { passive: true }
      );
      el.addEventListener(
        "wheel",
        (e) => {
          if (e.deltaY > 0) maybeLoadMoreVoters();
          const max = el.scrollHeight - el.clientHeight;
          if (max <= 0) {
            e.preventDefault();
            return;
          }
          if (
            (e.deltaY < 0 && el.scrollTop <= 0) ||
            (e.deltaY > 0 && el.scrollTop >= max - 0.5)
          ) {
            e.preventDefault();
          }
        },
        { passive: false }
      );
    }
    votersPanelNode = el;
    return el;
  }

  function placeVoteVoters(anchor, panel) {
    if (!anchor || !panel || panel.hidden) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      if (votersTouching) return;
      hideVoteVoters();
      return;
    }
    const scrollTop = panel.scrollTop;
    panel.style.position = "fixed";
    panel.style.zIndex = "70";
    panel.style.right = "auto";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const contentH = panel.scrollHeight;
    const placeAbove = contentH > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(80, Math.round(placeAbove ? spaceAbove : spaceBelow));
    panel.style.maxHeight = maxH + "px";
    panel.style.left = Math.round(rect.left) + "px";
    if (placeAbove) {
      panel.style.top =
        Math.max(8, Math.round(rect.top - Math.min(contentH, maxH) - 8)) + "px";
    } else {
      panel.style.top = Math.round(rect.bottom + 8) + "px";
    }
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
    if (panel.scrollTop !== scrollTop) panel.scrollTop = scrollTop;
  }

  function hideVoteVoters() {
    window.clearTimeout(votersShowTimer);
    window.clearTimeout(votersHideTimer);
    votersShowTimer = 0;
    votersHideTimer = 0;
    votersGen += 1;
    votersTouching = false;
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

  function scheduleHideVoters(e) {
    if (votersTouching) return;
    if (e && e.pointerType && e.pointerType !== "mouse") return;
    if (!hoverFine()) return;
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

  function voteVoterRowHtml(v, totalPayout, totalRshares) {
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
  }

  function votersHasMore() {
    return Boolean(
      openVoters &&
        Array.isArray(openVoters.list) &&
        openVoters.shown < openVoters.list.length
    );
  }

  function syncVotersFooter(panel) {
    if (!panel) return;
    let more = panel.querySelector(".vote-voters-more");
    if (!votersHasMore()) {
      if (more) more.remove();
      return;
    }
    const left = openVoters.list.length - openVoters.shown;
    const html = `and ${left} more`;
    if (more) {
      more.textContent = html;
      return;
    }
    panel.insertAdjacentHTML("beforeend", `<p class="vote-voters-more">${html}</p>`);
  }

  function appendVoterRows(n) {
    const panel = votersPanelNode;
    if (!panel || !openVoters || !Array.isArray(openVoters.list)) return 0;
    const ul = panel.querySelector(".vote-voters-list");
    if (!ul) return 0;
    const start = openVoters.shown || 0;
    const end = Math.min(openVoters.list.length, start + Math.max(1, n || VOTERS_PAGE));
    if (end <= start) return 0;
    let html = "";
    for (let i = start; i < end; i++) {
      html +=
        openVoters.kind === "reblog"
          ? rebloggerRowHtml(openVoters.list[i])
          : voteVoterRowHtml(openVoters.list[i], openVoters.totalPayout, openVoters.totalRshares);
    }
    ul.insertAdjacentHTML("beforeend", html);
    openVoters.shown = end;
    syncVotersFooter(panel);
    return end - start;
  }

  function votersNearBottom(panel) {
    if (!panel) return false;
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - VOTERS_SCROLL_PX;
  }

  function maybeLoadMoreVoters() {
    const panel = votersPanelNode;
    if (!panel || panel.hidden || !votersHasMore()) return;
    if (panel.clientHeight < 8) return;
    let guard = 0;
    while (votersHasMore() && guard++ < 40) {
      const overflow = panel.scrollHeight > panel.clientHeight + VOTERS_SCROLL_PX;
      if (overflow && !votersNearBottom(panel)) break;
      const added = appendVoterRows(VOTERS_PAGE);
      if (!added) break;
    }
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
    const keepShown =
      openVoters &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.dir === dir &&
      openVoters.shown
        ? openVoters.shown
        : 0;
    if (openVoters) {
      openVoters.list = list;
      openVoters.totalPayout = totalPayout;
      openVoters.totalRshares = totalRshares;
      openVoters.shown = 0;
    }
    if (!list.length) {
      panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><p class="vote-voters-status">${
        dir === "down" ? "No downvotes yet." : "No upvotes yet."
      }</p>`;
      return;
    }
    panel.innerHTML = `<p class="vote-voters-caption">${caption}</p><ul class="vote-voters-list"></ul>`;
    appendVoterRows(Math.max(VOTERS_PAGE, keepShown));
    maybeLoadMoreVoters();
  }

  function showVoteVoters(el, force) {
    if ((!force && !hoverFine()) || !el || !el.isConnected) return;
    if (openSlider) return;
    if (openReblog) hideReblogConfirm();
    const author = el.getAttribute("data-vote-author");
    const permlink = el.getAttribute("data-vote-permlink");
    const dir = voteDirFromEl(el);
    if (!author || !permlink) return;
    window.clearTimeout(votersHideTimer);
    votersHideTimer = 0;
    const panel = votersPanelEl();
    if (
      openVoters &&
      openVoters.kind === "vote" &&
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
    openVoters = { el, author, permlink, dir, kind: "vote", gen };
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

  function normalizeReblogName(name) {
    return String(name || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
  }

  function reblogCountOf(post) {
    const n = Number(post && post.reblogs);
    if (Number.isFinite(n) && n >= 0) return n;
    const list = post && post.reblogged_by;
    if (Array.isArray(list)) return list.length;
    return 0;
  }

  function reblogPostFor(author, permlink) {
    const item = findLoadedPost(author, permlink);
    if (item) {
      const shown = cardDisplayPost(item);
      if (shown && shown.author) return shown;
    }
    if (currentPost && samePostId(currentPost, author, permlink)) return currentPost;
    const node = findContentNode(author, permlink);
    return node || { author, permlink, reblogs: 0 };
  }

  function reblogView(post) {
    const author = post && post.author;
    const permlink = post && post.permlink;
    if (!author || !permlink) {
      return { count: 0, mine: false, pending: false };
    }
    const key = postKey(author, permlink);
    const serverCount = reblogCountOf(post);
    const local = localReblogs.get(key);
    const cache = reblogsCache.get(key);
    const user = observer();
    let mine = false;
    if (user && cache && Array.isArray(cache.names)) {
      mine = cache.names.indexOf(user) !== -1;
    }
    if (local) {
      return {
        count: Math.max(0, local.count != null ? local.count : serverCount),
        mine: Boolean(local.mine),
        pending: Boolean(local.pending),
      };
    }
    return { count: serverCount, mine, pending: false };
  }

  function loadRebloggedBy(author, permlink) {
    const key = postKey(author, permlink);
    const hit = reblogsCache.get(key);
    if (hit && Array.isArray(hit.names)) return Promise.resolve(hit.names);
    if (hit && hit.promise) return hit.promise;
    const promise = HiveApi.getRebloggedBy(author, permlink)
      .then((names) => {
        reblogsCache.set(key, { names });
        return names;
      })
      .catch((err) => {
        reblogsCache.delete(key);
        throw err;
      });
    reblogsCache.set(key, { promise });
    return promise;
  }

  function mergeLocalRebloggers(names, author, permlink) {
    const user = observer();
    const list = Array.isArray(names) ? names.slice() : [];
    const local = localReblogs.get(postKey(author, permlink));
    if (!user) return list;
    const hasUser = list.indexOf(user) !== -1;
    if (local && local.mine && !hasUser) list.unshift(user);
    if (local && local.mine === false && hasUser) {
      return list.filter((n) => n !== user);
    }
    return list;
  }

  function rebloggerRowHtml(name) {
    const n = normalizeReblogName(name);
    if (!n) return "";
    const href = HiveMd.escapeHtml(appHref("/@" + n));
    const safe = HiveMd.escapeHtml(n);
    return `<li><a class="vote-voter" href="${href}"><span class="vote-voter-name">@${safe}</span></a></li>`;
  }

  function renderReblogUsers(panel, names, author, permlink) {
    const list = mergeLocalRebloggers(names, author, permlink);
    const keepShown =
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.author === author &&
      openVoters.permlink === permlink &&
      openVoters.shown
        ? openVoters.shown
        : 0;
    if (openVoters) {
      openVoters.list = list;
      openVoters.shown = 0;
    }
    if (!list.length) {
      panel.innerHTML =
        `<p class="vote-voters-caption">Reblogs</p><p class="vote-voters-status">No reblogs yet.</p>`;
      return;
    }
    panel.innerHTML = `<p class="vote-voters-caption">Reblogs</p><ul class="vote-voters-list"></ul>`;
    appendVoterRows(Math.max(VOTERS_PAGE, keepShown));
    maybeLoadMoreVoters();
  }

  function showReblogUsers(el, force) {
    if ((!force && !hoverFine()) || !el || !el.isConnected) return;
    if (openSlider || openReblog) return;
    const author = el.getAttribute("data-reblog-author");
    const permlink = el.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    window.clearTimeout(votersHideTimer);
    votersHideTimer = 0;
    const panel = votersPanelEl();
    if (
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.author === author &&
      openVoters.permlink === permlink
    ) {
      openVoters.el = el;
      panel.hidden = false;
      placeVoteVoters(el, panel);
      return;
    }
    const gen = ++votersGen;
    openVoters = { el, author, permlink, dir: "reblog", kind: "reblog", gen };
    panel.classList.remove("is-down");
    panel.innerHTML =
      `<p class="vote-voters-caption">Reblogs</p><p class="vote-voters-status">Loading…</p>`;
    panel.hidden = false;
    document.body.appendChild(panel);
    placeVoteVoters(el, panel);
    loadRebloggedBy(author, permlink)
      .then((names) => {
        if (!openVoters || openVoters.gen !== gen) return;
        renderReblogUsers(panel, names, author, permlink);
        placeVoteVoters(el, panel);
        syncReblogButtons(author, permlink, reblogView(reblogPostFor(author, permlink)));
      })
      .catch(() => {
        if (!openVoters || openVoters.gen !== gen) return;
        panel.innerHTML = `<p class="vote-voters-status">Could not load reblogs.</p>`;
        placeVoteVoters(el, panel);
      });
  }

  function onReblogHitEnter(el) {
    if (!hoverFine() || !el) return;
    if (openReblog) return;
    window.clearTimeout(votersHideTimer);
    window.clearTimeout(votersShowTimer);
    votersHideTimer = 0;
    if (
      openVoters &&
      openVoters.kind === "reblog" &&
      openVoters.el === el &&
      votersPanelEl() &&
      !votersPanelEl().hidden
    ) {
      showReblogUsers(el);
      return;
    }
    votersShowTimer = window.setTimeout(() => {
      votersShowTimer = 0;
      showReblogUsers(el);
    }, 80);
  }

  function placeReblogConfirm(btn, panel) {
    if (!btn || !panel || panel.hidden) return;
    const rect = btn.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.zIndex = "64";
    panel.style.top = Math.round(rect.bottom + 8) + "px";
    panel.style.left = Math.round(rect.left) + "px";
    panel.style.right = "auto";
    const box = panel.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    if (box.right > maxRight) {
      panel.style.left = Math.max(8, Math.round(maxRight - box.width)) + "px";
    }
    if (panel.getBoundingClientRect().left < 8) panel.style.left = "8px";
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    if (box.height > spaceBelow && rect.top - 12 > spaceBelow) {
      panel.style.top =
        Math.max(8, Math.round(rect.top - box.height - 8)) + "px";
    }
  }

  function setReblogConfirmStatus(text, warn) {
    if (!openReblog || !openReblog.panel) return;
    const status = openReblog.panel.querySelector(".reblog-confirm-status");
    if (!status) return;
    if (!text) {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("is-warn");
      return;
    }
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("is-warn", Boolean(warn));
  }

  function setReblogConfirmReady(ready) {
    if (!openReblog || !openReblog.panel) return;
    const confirm = openReblog.panel.querySelector(".reblog-confirm");
    if (confirm) confirm.disabled = !ready;
  }

  function setReblogConfirmCaption(own, undo) {
    if (!openReblog || !openReblog.panel) return;
    const caption = openReblog.panel.querySelector(".reblog-confirm-caption");
    if (!caption) return;
    caption.textContent = undo
      ? "Undo reblog?"
      : own
        ? "Reblog your post?"
        : "Reblog this post?";
  }

  function setReblogConfirmAction(undo) {
    if (!openReblog || !openReblog.panel) return;
    const confirm = openReblog.panel.querySelector(".reblog-confirm");
    if (!confirm) return;
    confirm.textContent = undo ? "Undo" : "Reblog";
    confirm.classList.toggle("is-undo", Boolean(undo));
  }

  function hideReblogConfirm() {
    if (!openReblog) return;
    const { wrap, panel } = openReblog;
    openReblog = null;
    if (!panel) return;
    panel.hidden = true;
    panel.style.position = "";
    panel.style.top = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.zIndex = "";
    if (wrap && panel.parentNode !== wrap) wrap.appendChild(panel);
    if (wrap) wrap.classList.remove("is-open");
  }

  function showReblogConfirm(btn) {
    hideVoteVoters();
    hideVoteSlider();
    const wrap = btn.closest(".reblog-wrap");
    const panel = wrap && wrap.querySelector(".reblog-confirm-panel");
    if (!wrap || !panel) return;
    wrap.classList.add("is-open");
    openReblog = {
      wrap,
      btn,
      panel,
      author: btn.getAttribute("data-reblog-author"),
      permlink: btn.getAttribute("data-reblog-permlink"),
      gen: ++reblogConfirmGen,
      already: false,
      own: observer() === normalizeReblogName(btn.getAttribute("data-reblog-author")),
    };
    setReblogConfirmCaption(openReblog.own, false);
    setReblogConfirmAction(false);
    setReblogConfirmStatus("", false);
    setReblogConfirmReady(false);
    document.body.appendChild(panel);
    panel.hidden = false;
    placeReblogConfirm(btn, panel);
  }

  function reblogWrapsFor(author, permlink) {
    return Array.from(document.querySelectorAll(".reblog-wrap")).filter(
      (el) =>
        el.getAttribute("data-reblog-author") === author &&
        el.getAttribute("data-reblog-permlink") === permlink
    );
  }

  function syncReblogButtons(author, permlink, state) {
    const pending = Boolean(state && state.pending);
    const mine = Boolean(state && state.mine);
    const count = state && state.count != null ? String(state.count) : "0";
    reblogWrapsFor(author, permlink).forEach((root) => {
      const btn = root.querySelector(".reblog-btn");
      if (!btn) return;
      btn.classList.toggle("is-reblogged", mine);
      btn.classList.toggle("is-pending", pending);
      btn.disabled = pending;
      btn.setAttribute("aria-pressed", mine ? "true" : "false");
      btn.setAttribute("aria-label", mine ? "Undo reblog" : "Reblog");
      const n = btn.querySelector(".reblog-n");
      if (n) n.textContent = count;
    });
  }

  function queueReblog(author, permlink, undo) {
    const user = observer();
    if (!user) return;
    const key = postKey(author, permlink);
    const post = reblogPostFor(author, permlink);
    const shown = reblogView(post);
    if (shown.pending) return;
    if (undo && !shown.mine) return;
    if (!undo && shown.mine) return;
    const mine = !undo;
    const nextCount = Math.max(0, shown.count + (undo ? -1 : 1));
    const previous = localReblogs.get(key);
    localReblogs.set(key, { mine, pending: true, count: nextCount });
    syncReblogButtons(author, permlink, { mine, pending: true, count: nextCount });
    hideReblogConfirm();
    const body = { account: user, author, permlink };
    if (undo) body.delete = "delete";
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
            json: JSON.stringify(["reblog", body]),
          },
        ],
      ],
      meta: { type: undo ? "unreblog" : "reblog", author, permlink },
    });
    promise
      .then(() => {
        localReblogs.set(key, { mine, pending: false, count: nextCount });
        const cache = reblogsCache.get(key);
        if (cache && Array.isArray(cache.names)) {
          if (undo) cache.names = cache.names.filter((n) => n !== user);
          else if (cache.names.indexOf(user) === -1) cache.names = [user].concat(cache.names);
        } else if (!undo && (!cache || !cache.promise)) {
          reblogsCache.set(key, { names: [user] });
        }
        if (post && post.author) {
          post.reblogs = nextCount;
        }
        if (currentPost && samePostId(currentPost, author, permlink)) {
          currentPost.reblogs = nextCount;
        }
        syncReblogButtons(author, permlink, { mine, pending: false, count: nextCount });
        if (
          openVoters &&
          openVoters.kind === "reblog" &&
          openVoters.author === author &&
          openVoters.permlink === permlink
        ) {
          const panel = votersPanelEl();
          const names =
            (reblogsCache.get(key) && reblogsCache.get(key).names) || (undo ? [] : [user]);
          renderReblogUsers(panel, names, author, permlink);
          placeVoteVoters(openVoters.el, panel);
        }
      })
      .catch((err) => {
        if (previous) localReblogs.set(key, previous);
        else localReblogs.delete(key);
        syncReblogButtons(author, permlink, reblogView(reblogPostFor(author, permlink)));
        showError(err.message || String(err));
      });
  }

  async function onReblogClick(btn) {
    if (!btn) return;
    if (btn.classList.contains("is-pending") || btn.disabled) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    const author = btn.getAttribute("data-reblog-author");
    const permlink = btn.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    if (openReblog && openReblog.btn === btn) {
      hideReblogConfirm();
      return;
    }
    showReblogConfirm(btn);
    const gen = openReblog && openReblog.gen;
    setReblogConfirmStatus("Checking…", false);
    setReblogConfirmReady(false);
    try {
      const names = await loadRebloggedBy(author, permlink);
      if (!openReblog || openReblog.gen !== gen) return;
      const viewState = reblogView(reblogPostFor(author, permlink));
      const own = user === normalizeReblogName(author);
      const local = localReblogs.get(postKey(author, permlink));
      const already =
        names.indexOf(user) !== -1 ||
        viewState.mine ||
        Boolean(local && local.mine);
      openReblog.already = already;
      openReblog.own = own;
      setReblogConfirmCaption(own, already);
      setReblogConfirmAction(already);
      syncReblogButtons(author, permlink, viewState);
      if (already) {
        setReblogConfirmStatus("This post is on your blog.", false);
        setReblogConfirmReady(true);
      } else {
        setReblogConfirmStatus("", false);
        setReblogConfirmReady(true);
      }
      placeReblogConfirm(btn, openReblog.panel);
    } catch {
      if (!openReblog || openReblog.gen !== gen) return;
      setReblogConfirmStatus("Could not check reblogs.", true);
      setReblogConfirmReady(true);
      placeReblogConfirm(btn, openReblog.panel);
    }
  }

  function onReblogConfirm(confirmBtn) {
    const author =
      (openReblog && openReblog.author) ||
      confirmBtn.getAttribute("data-reblog-author");
    const permlink =
      (openReblog && openReblog.permlink) ||
      confirmBtn.getAttribute("data-reblog-permlink");
    if (!author || !permlink) return;
    const user = observer();
    if (!user) {
      openLogin();
      return;
    }
    if (!hasSigner(user)) {
      showError(signerNeededMessage());
      return;
    }
    queueReblog(author, permlink, Boolean(openReblog && openReblog.already));
  }

  function showVotePanel(btn, mode) {
    hideReblogConfirm();
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
      if (!ownAccountReady(user)) await loadAccountResources();
      if (observer() !== user) return;
      if (ownAccountReady(user)) {
        const hp = hivePowerFromAccount(accountState.account, accountState.props);
        hivePower = hp == null ? 0 : hp;
        setNodeLabel();
        return;
      }
      hivePower = await HiveApi.getHivePower(user);
      setNodeLabel();
    } catch {
      if (observer() !== user) return;
      hivePower = 0;
    }
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

  function mutedKey(author, permlink) {
    return snapKey(author, permlink);
  }

  function isLowReputation(rep) {
    return Math.floor(HiveMd.displayReputation(rep)) < FILTER_LOW_REP;
  }

  function isModerated(node) {
    const stats = node && node.stats;
    return Boolean(stats && (stats.gray || stats.hide));
  }

  function isMutedRevealed(author, permlink) {
    return revealedMuted.has(mutedKey(author, permlink));
  }

  function markMutedRevealed(author, permlink) {
    revealedMuted.add(mutedKey(author, permlink));
  }

  function isMutedHidden(node) {
    if (!node || !node.author) return false;
    if (isOwnAuthor(node.author)) return false;
    if (isMutedRevealed(node.author, node.permlink)) return false;
    return isLowReputation(node.author_reputation) || isModerated(node);
  }

  function mutedNoticeHtml(kind, node) {
    const label = kind === "comment" ? "show comment" : "show post";
    const reason = isLowReputation(node && node.author_reputation)
      ? "content hidden due to low reputation"
      : "content hidden due to moderation";
    return `<p class="muted-notice"><span>${reason}</span><span class="show-muted">${label}</span></p>`;
  }

  function revealMuted(btn) {
    const card = btn.closest("article.post-card");
    if (card) {
      const author = card.getAttribute("data-author");
      const permlink = card.getAttribute("data-permlink");
      if (!author || !permlink) return;
      markMutedRevealed(author, permlink);
      const post = findLoadedPost(author, permlink) || findContentNode(author, permlink);
      if (!post) return;
      replaceFeedCard(card, post);
      return;
    }
    const comment = btn.closest("article.comment");
    if (!comment) return;
    const author = comment.getAttribute("data-author");
    const permlink = comment.getAttribute("data-permlink");
    if (!author || !permlink) return;
    markMutedRevealed(author, permlink);
    const node = findContentNode(author, permlink);
    if (!node) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = String(renderComment(node) || "").trim();
    const next = wrap.firstElementChild;
    if (next) comment.replaceWith(next);
  }

  function isBlacklistedUser(name) {
    return typeof Cs77Blacklist !== "undefined" && Cs77Blacklist.user(name);
  }

  function isBlacklistedPost(post, permlink) {
    if (typeof Cs77Blacklist === "undefined") return false;
    if (post && typeof post === "object") {
      return Cs77Blacklist.post(post.author, post.permlink);
    }
    return Cs77Blacklist.post(post, permlink);
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

  function eventElement(target) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  }

  function inInteractiveSurface(target) {
    const el = eventElement(target);
    if (!el) return false;
    if (view && view.contains(el)) return true;
    const layer = document.getElementById("postLayer");
    return Boolean(layer && !layer.hidden && layer.contains(el));
  }

  function scrollTargetIntoView(el, behavior) {
    if (!el) return false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const chosen = behavior || (reduce.matches ? "auto" : "smooth");
    const layer = document.getElementById("postLayer");
    if (layer && postLayer.open && layer.contains(el)) {
      const top = Math.max(0, window.scrollY + el.getBoundingClientRect().top - 8);
      if (chosen === "auto") scrollWindowInstant(top);
      else window.scrollTo({ top, left: 0, behavior: chosen });
      return true;
    }
    el.scrollIntoView({ behavior: chosen, block: "start" });
    return true;
  }

  function scrollToComments(behavior) {
    const el = document.getElementById("comments");
    if (!el) return false;
    return scrollTargetIntoView(el, behavior);
  }

  function focusRootCommentComposer() {
    const section = document.getElementById("comments");
    const input =
      section && section.querySelector(":scope > .comment-composer .composer-input");
    if (!input) return false;
    input.focus({ preventScroll: true });
    return true;
  }

  function scrollToAnchor(hash, behavior) {
    const raw = String(hash == null ? location.hash : hash).replace(/^#/, "");
    if (!raw || raw.charAt(0) === "/") return false;
    if (raw === "comments") return scrollToComments(behavior);
    let el = document.getElementById(raw);
    if (!el) {
      try {
        el = document.getElementById(decodeURIComponent(raw));
      } catch {
        el = null;
      }
    }
    if (!el) return false;
    return scrollTargetIntoView(el, behavior);
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

  function metadataTags(post) {
    const meta = HiveMd.parseJsonMetadata(post && post.json_metadata);
    let tags = meta.tags;
    if (typeof tags === "string") tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) tags = [];
    return tags
      .map((t) => String(t).replace(/^#/, "").trim().toLowerCase())
      .filter((t, i, arr) => t && arr.indexOf(t) === i)
      .slice(0, MAX_TAGS);
  }

  function tagsForEdit(post) {
    const tags = metadataTags(post);
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
    about: true,
    imprint: true,
    c: true,
  };

  function appHref(path) {
    let p = path || "/";
    if (p.startsWith("#")) {
      const h = p.slice(1);
      p = h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (!p.startsWith("/")) p = "/" + p;
    p = p.split("#")[0].split("?")[0] || "/";
    return HASH_ROUTING ? "#" + p : p;
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
    return path;
  }

  function hrefToPath(href) {
    if (!href) return "/";
    if (href.startsWith("#")) {
      const h = href.slice(1);
      return h ? (h.startsWith("/") ? h : "/" + h) : "/";
    }
    if (href.startsWith("/") && !href.startsWith("//")) {
      return href.split("#")[0].split("?")[0] || "/";
    }
    try {
      const u = new URL(href, location.href);
      if (u.hash && /^#\//.test(u.hash)) {
        const h = u.hash.slice(1);
        return h.startsWith("/") ? h : "/" + h;
      }
      if (HASH_ROUTING) return "/";
      return u.pathname || "/";
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
    if (!page || page === "created" || page === "latest") return "latest";
    if (page === "trending" || page === "hot") return page;
    if (page === "rules" || page === "about") return "rules";
    if (page === "members" || page === "roles") return "members";
    return "";
  }

  function pathForCommunity(name, page) {
    const n = normalizeCommunityName(name);
    if (!n) return "/";
    const p = normalizeCommunityPage(page) || "latest";
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
    if (parts.length === 1 && first === "about") {
      return { name: "about" };
    }
    if (parts.length === 1 && first === "imprint") {
      return { name: "imprint" };
    }

    if (first === "c" && parts.length >= 2) {
      const community = normalizeCommunityName(parts[1]);
      if (!community) return { name: "notfound" };
      if (parts.length === 2) {
        return { name: "community", community, page: "latest" };
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
    if (key === "about") return "/about";
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
    if (sort === "created") return observer() ? "/latest" : "/";
    return "/";
  }

  function tagFeedHref(tag, sort) {
    const t = normalizeRouteTag(tag);
    if (!t) return appHref("/");
    const s = sort === "hot" || sort === "trending" ? sort : "latest";
    if (isCommunityName(t)) return communityHref(t, s);
    return appHref(pathForFeedSort(s, t));
  }

  function tagChipHtml(tag) {
    const t = normalizeRouteTag(tag) || String(tag || "").replace(/^#/, "").trim().toLowerCase();
    if (!t) return "";
    const href = isCommunityName(t) ? communityHref(t, "latest") : appHref("/created/" + t);
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
    publishNavPushed = parseRoute(path).name === "publish" && !replace;
    route();
  }

  function commentsAreShowing() {
    const el = document.getElementById("comments");
    if (!el || el.closest("[hidden]")) return false;
    const layer = document.getElementById("postLayer");
    if (layer && layer.contains(el)) return !layer.hidden;
    return true;
  }

  function commentLinkStaysOnPage(href) {
    if (!href) return false;
    if (href === "#comments") return true;
    try {
      const u = new URL(href, location.href);
      return (
        u.pathname === location.pathname &&
        u.search === location.search &&
        (u.hash === "#comments" || /#comments$/.test(u.hash))
      );
    } catch {
      return false;
    }
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
            history.pushState(history.state, "", u.pathname + u.search + u.hash);
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const toComments =
      a.classList.contains("comment-count-link") || href === "#comments" || /#comments$/.test(href);
    // A feed card's comment count points at the post. Only an in-page
    // #comments link should scroll, and only while that section is visible.
    // A previously opened post leaves #comments in the hidden layer.
    if (toComments && commentsAreShowing() && commentLinkStaysOnPage(href)) {
      e.preventDefault();
      pendingCommentsScroll = false;
      scrollToComments();
      if (a.closest(".post-stats-bar")) focusRootCommentComposer();
      return;
    }
    if (toComments) pendingCommentsScroll = true;
    if (!isInternalHref(href)) return;
    if (HASH_ROUTING) {
      if (href.startsWith("#/") || href === "#") return;
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
      navigate(appHref(hrefToPath(href)));
      return;
    }
    try {
      const u = new URL(href, location.href);
      if (u.pathname === location.pathname && u.hash && !/^#\//.test(u.hash)) return;
      if (u.pathname === location.pathname && u.search === location.search && !u.hash) {
        e.preventDefault();
        // Already on this profile section. Session and logo links still
        // bring the page back to the top; profile-nav clicks do not.
        if (
          a.classList.contains("session-name") ||
          a.closest("#sessionAccountMenu")
        ) {
          window.scrollTo(0, 0);
        }
        return;
      }
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
      navigate(u.pathname + u.search + u.hash);
    } catch {
      e.preventDefault();
      profileNavSwitch = Boolean(a.closest(".profile-nav"));
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
    notifState.cursor = "";
    notifState.done = false;
    notifState.loadingMore = false;
    notifState.seen = new Set();
  }

  let resourceGen = 0;
  let accountLoad = null;
  // Logged-in Hive account from condenser_api.get_accounts, plus mana and RC.
  const accountState = {
    user: "",
    account: null,
    metadata: null,
    profileImage: "",
    props: null,
    votingMana: null,
    voteValue: null,
    rc: null,
    social: null,
    loaded: false,
    loadedAt: 0,
  };

  function resetAccountState() {
    resourceGen += 1;
    accountLoad = null;
    accountState.user = "";
    accountState.account = null;
    accountState.metadata = null;
    accountState.profileImage = "";
    accountState.props = null;
    accountState.votingMana = null;
    accountState.voteValue = null;
    accountState.rc = null;
    accountState.social = null;
    accountState.loaded = false;
    accountState.loadedAt = 0;
  }

  // One record for the signed-in user. Empty image is stored so the next
  // login can show the satoshi fallback immediately.
  function readStoredProfileImage(user) {
    if (!user) return null;
    try {
      const raw = localStorage.getItem(PROFILE_IMAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      if (String(data.user || "") !== user) return null;
      if (!Object.prototype.hasOwnProperty.call(data, "image")) return null;
      return String(data.image || "");
    } catch {
      return null;
    }
  }

  function writeStoredProfileImage(user, image) {
    if (!user) return;
    try {
      localStorage.setItem(
        PROFILE_IMAGE_KEY,
        JSON.stringify({ user: String(user), image: String(image || "") })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }

  function metadataFromAccount(account) {
    const posting = HiveMd.parseJsonMetadata(account && account.posting_json_metadata);
    const legacy = HiveMd.parseJsonMetadata(account && account.json_metadata);
    const postingProfile =
      posting && typeof posting.profile === "object" && posting.profile ? posting.profile : {};
    const legacyProfile =
      legacy && typeof legacy.profile === "object" && legacy.profile ? legacy.profile : {};
    return Object.assign({}, legacy, posting, {
      profile: Object.assign({}, legacyProfile, postingProfile),
    });
  }

  function profileImageFromMetadata(metadata) {
    const profile = metadata && metadata.profile;
    return String((profile && profile.profile_image) || "").trim();
  }

  function knownProfileImage(user) {
    if (accountState.loaded && accountState.user === user) {
      return accountState.profileImage || "";
    }
    return readStoredProfileImage(user);
  }

  function avatarSrcFromImage(user, image, size) {
    if (image != null && !String(image).trim()) {
      return (size === "large") ? SESSION_AVATAR_DEFAULT_LARGE : SESSION_AVATAR_DEFAULT_SMALL;
    }
    return HiveMd.avatarUrl(user, size);
  }

  function sessionAvatarSrc(user) {
    return avatarSrcFromImage(user, knownProfileImage(user), "small");
  }

  function ownAccountReady(name) {
    return Boolean(
      name && accountState.loaded && accountState.user === name && accountState.account
    );
  }

  function accountStateFresh(name) {
    if (!ownAccountReady(name) || !accountState.props || !accountState.loadedAt) return false;
    return Date.now() - accountState.loadedAt < ACCOUNT_STATE_FRESH_MS;
  }

  function accountReputation(user) {
    if (!ownAccountReady(user)) return 0;
    const raw = accountState.account.reputation;
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) return 0;
    return raw;
  }

  function hivePowerFromAccount(account, props) {
    if (!account || !props) return null;
    const vests =
      HiveApi.parseAsset(account.vesting_shares) +
      HiveApi.parseAsset(account.received_vesting_shares) -
      HiveApi.parseAsset(account.delegated_vesting_shares);
    return HiveApi.vestsToHive(Math.max(0, vests), props);
  }

  function profileFromAccountState() {
    const account = accountState.account;
    if (!account) return null;
    const metadata = accountState.metadata || metadataFromAccount(account);
    const social = accountState.social;
    return {
      name: account.name,
      created: account.created,
      post_count: account.post_count,
      reputation: account.reputation,
      metadata,
      profile_image: accountState.profileImage || "",
      stats: {
        post_count: Number(account.post_count) || 0,
        followers: social ? Number(social.followers) || 0 : 0,
        following: social ? Number(social.following) || 0 : 0,
      },
      context: social ? { followed: Boolean(social.followed) } : {},
      statsPending: !social,
    };
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

  function paintSessionAvatar() {
    const user = observer();
    const img = document.querySelector("#sessionMenu .session-avatar-btn img");
    if (!img || !user) return;
    const src = sessionAvatarSrc(user);
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  }

  function paintAccountResources() {
    paintSessionAvatar();
    const el = $("#sessionAccountStats");
    if (!el) return;
    const mana = el.querySelector("[data-stat='mana']");
    const vote = el.querySelector("[data-stat='vote']");
    const rc = el.querySelector("[data-stat='rc']");
    if (!mana || !vote || !rc) return;
    const manaStat = mana.closest(".session-stat");
    const rcStat = rc.closest(".session-stat");
    const ready = accountState.loaded && accountState.user === observer() && accountState.account;
    if (!ready) {
      mana.textContent = "…";
      vote.textContent = "…";
      rc.textContent = "…";
      if (manaStat) manaStat.classList.remove("is-low");
      if (rcStat) rcStat.classList.remove("is-low");
      el.classList.add("is-loading");
      return;
    }
    mana.textContent = formatResourcePercent(accountState.votingMana);
    vote.textContent = formatResourceAmount(accountState.voteValue);
    rc.textContent = accountState.rc == null ? "—" : formatResourcePercent(accountState.rc);
    if (manaStat) manaStat.classList.toggle("is-low", roundedResourcePercent(accountState.votingMana) <= 20);
    if (rcStat) {
      rcStat.classList.toggle(
        "is-low",
        accountState.rc != null && roundedResourcePercent(accountState.rc) <= 20
      );
    }
    el.classList.remove("is-loading");
  }

  function assignAccountState(user, info) {
    const account = info && info.account;
    if (!account) return;
    const metadata = metadataFromAccount(account);
    const profileImage = profileImageFromMetadata(metadata);
    const sameUser = accountState.user === user;
    accountState.user = user;
    accountState.account = account;
    accountState.metadata = metadata;
    accountState.profileImage = profileImage;
    accountState.props = info.props || null;
    accountState.votingMana = info.votingMana;
    accountState.voteValue = info.voteValue;
    accountState.rc = info.rc;
    if (!sameUser) accountState.social = null;
    accountState.loaded = true;
    accountState.loadedAt = Date.now();
    writeStoredProfileImage(user, profileImage);
    const hp = hivePowerFromAccount(account, accountState.props);
    if (hp != null && observer() === user) {
      hivePower = hp;
      hivePowerUser = user;
    }
    paintAccountResources();
    syncOwnProfileBanner();
  }

  function clearAccountForUser(user) {
    accountState.user = user;
    accountState.account = null;
    accountState.metadata = null;
    accountState.profileImage = "";
    accountState.props = null;
    accountState.votingMana = null;
    accountState.voteValue = null;
    accountState.rc = null;
    accountState.social = null;
    accountState.loaded = false;
    accountState.loadedAt = 0;
    paintAccountResources();
  }

  async function loadAccountResources() {
    const user = observer();
    if (!user) return null;
    if (accountLoad && accountLoad.user === user) return accountLoad.promise;
    const gen = ++resourceGen;
    if (accountState.user !== user) clearAccountForUser(user);
    let resolveLoad;
    const promise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    accountLoad = { user, gen, promise };
    (async () => {
      try {
        const info = await HiveApi.getAccountResources(user);
        if (gen !== resourceGen || observer() !== user || !info || !info.account) {
          resolveLoad(null);
          return;
        }
        assignAccountState(user, info);
        resolveLoad(accountState);
      } catch {
        resolveLoad(null);
      } finally {
        if (accountLoad && accountLoad.gen === gen) accountLoad = null;
      }
    })();
    return promise;
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

  function notificationType(item) {
    return String((item && item.type) || "")
      .trim()
      .toLowerCase();
  }

  function notificationHref(url) {
    let raw = String(url || "").trim();
    if (!raw) return "";
    raw = raw.replace(/^https?:\/\/(?:www\.)?(?:hive\.blog|peakd\.com|ecency\.com)\//i, "");
    raw = raw.replace(/^\//, "");
    const community =
      raw.match(/(?:^|\/)(?:trending|hot|created|latest)\/(hive-\d+)\b/i) ||
      raw.match(/^(?:c\/)?(hive-\d+)\b/i);
    if (community) return communityHref(community[1]);
    const at = raw.indexOf("@");
    if (at < 0) return "";
    return appHref("/" + raw.slice(at));
  }

  function notificationActor(item) {
    const m = String((item && item.msg) || "").match(/^@([a-z0-9.\-]{3,16})/i);
    if (m) return m[1].toLowerCase();
    if (notificationType(item) === "follow") {
      const fromUrl = String((item && item.url) || "").match(/@([a-z0-9.\-]{3,16})/i);
      if (fromUrl) return fromUrl[1].toLowerCase();
    }
    return "";
  }

  function notificationItemHref(item) {
    const href = notificationHref(item && item.url);
    if (href) return href;
    if (notificationType(item) === "follow") {
      const actor = notificationActor(item);
      if (actor) return appHref("/@" + actor);
    }
    return "";
  }

  function notificationMessage(item) {
    let msg = String((item && item.msg) || "");
    const t = notificationType(item);
    if (t === "vote" && msg && !/\(-/.test(msg)) {
      msg = msg.replace(" voted on ", " upvoted ");
    }
    if (t === "follow" && !msg) {
      const actor = notificationActor(item);
      msg = actor ? "@" + actor + " followed you" : "Someone followed you";
    }
    return msg;
  }

  function notificationMessageHtml(item, actor, href) {
    const msg = notificationMessage(item);
    const restHref = href ? HiveMd.escapeHtml(href) : "";
    function wrapRest(text) {
      const body = HiveMd.escapeHtml(text);
      if (!body) return "";
      if (!restHref) return body;
      return `<a class="session-notif-text" href="${restHref}">${body}</a>`;
    }
    if (!actor) return wrapRest(msg) || HiveMd.escapeHtml(msg);
    const re = new RegExp("^@(" + actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
    const m = msg.match(re);
    const profile = HiveMd.escapeHtml(profileHref(actor));
    if (!m) {
      return (
        `<a class="session-notif-user" href="${profile}">@${HiveMd.escapeHtml(actor)}</a>` +
        wrapRest(msg ? " " + msg : "")
      );
    }
    return (
      `<a class="session-notif-user" href="${profile}">${HiveMd.escapeHtml(m[0])}</a>` +
      wrapRest(msg.slice(m[0].length))
    );
  }

  function notificationKindLabel(item) {
    const t = notificationType(item);
    if (t === "vote") {
      return /\(-/.test(String((item && item.msg) || "")) ? "downvote" : "upvote";
    }
    if (t === "reply" || t === "reply_comment") return "reply";
    if (t === "reblog") return "reblog";
    if (t === "mention") return "mention";
    if (t === "follow") return "follow";
    if (t === "subscribe") return "subscribe";
    if (t === "set_role") return "role";
    if (t === "set_title" || t === "set_label") return "title";
    if (t === "set_props") return "settings";
    if (t === "pin_post") return "pin";
    if (t === "unpin_post") return "unpin";
    if (t === "flag_post") return "flag";
    if (t === "new_community") return "community";
    return t ? t.replace(/_/g, " ") : "";
  }

  const NOTIF_HIDDEN_TYPES = {
    unfollow: true,
    mute: true,
    unmute: true,
    ignore: true,
    mute_post: true,
    unmute_post: true,
  };

  function isHiddenNotif(item) {
    const t = notificationType(item);
    if (NOTIF_HIDDEN_TYPES[t]) return true;
    const msg = String((item && item.msg) || "").toLowerCase();
    if (/\bunfollowed\b/.test(msg)) return true;
    if (/\b(?:muted|unmuted|ignored) you\b/.test(msg)) return true;
    if (t === "follow" && /\b(?:muted|unmuted|unfollowed|ignored)\b/.test(msg)) return true;
    return false;
  }

  function notificationId(item) {
    return item && item.id != null ? String(item.id) : "";
  }

  function filterNotificationItems(items, seen) {
    const list = Array.isArray(items) ? items : [];
    const known = seen || new Set();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || isHiddenNotif(item)) continue;
      if (!isNotifUnread(item, notifState.lastread)) continue;
      const id = notificationId(item);
      if (id) {
        if (known.has(id)) continue;
        known.add(id);
      }
      out.push(item);
    }
    return out;
  }

  function notifBatchReachedRead(batch) {
    if (!Array.isArray(batch) || !batch.length) return true;
    return !isNotifUnread(batch[batch.length - 1], notifState.lastread);
  }

  function renderNotifItem(item) {
    const actor = notificationActor(item);
    const href = notificationItemHref(item);
    const unread = isNotifUnread(item, notifState.lastread);
    const type = notificationType(item);
    const typeCls = type && /^[a-z0-9_]+$/.test(type) ? " is-" + type.replace(/_/g, "-") : "";
    const cls = "session-notif" + (unread ? " is-unread" : "") + typeCls;
    const profile = actor ? profileHref(actor) : "";
    const avatar = actor
      ? (profile
          ? `<a class="session-notif-actor" href="${HiveMd.escapeHtml(profile)}" aria-label="@${HiveMd.escapeHtml(actor)}"><img class="session-notif-avatar" src="${HiveMd.avatarUrl(actor, "small")}" alt=""></a>`
          : `<img class="session-notif-avatar" src="${HiveMd.avatarUrl(actor, "small")}" alt="">`)
      : "";
    const kind = notificationKindLabel(item);
    const time = timeAgo(item.date);
    const meta = kind ? kind + (time ? " · " + time : "") : time;
    const timeHtml = `<span class="session-notif-time">${HiveMd.escapeHtml(meta)}</span>`;
    const hrefAttr = href ? ` data-href="${HiveMd.escapeHtml(href)}"` : "";
    return (
      `<div class="${cls}"${hrefAttr}>` +
      avatar +
      `<span class="session-notif-body">` +
      `<span class="session-notif-msg">${notificationMessageHtml(item, actor, href)}</span>` +
      timeHtml +
      `</span></div>`
    );
  }

  function notifFooterHtml() {
    if (notifState.loadingMore) {
      return `<p class="session-notifs-empty session-notifs-more">Loading…</p>`;
    }
    return "";
  }

  function syncNotifFooter(wrap) {
    const el = wrap || $("#sessionNotifs");
    if (!el) return;
    const old = el.querySelector(".session-notifs-more");
    if (old) old.remove();
    const html = notifFooterHtml();
    if (html) el.insertAdjacentHTML("beforeend", html);
  }

  function notifsPanelOpen() {
    const menu = $("#sessionMenu");
    return Boolean(menu && menu.classList.contains("is-open"));
  }

  function notifsNearBottom(wrap) {
    if (!wrap) return false;
    return wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - NOTIF_SCROLL_PX;
  }

  function maybeLoadMoreNotifs() {
    if (!notifsPanelOpen() || !notifState.loaded || notifState.done || notifState.loadingMore) return;
    const wrap = $("#sessionNotifs");
    if (!wrap) return;
    if (wrap.clientHeight < 8) return;
    if (notifsNearBottom(wrap)) loadMoreNotifications();
  }

  function bindNotifScroll() {
    const wrap = $("#sessionNotifs");
    if (!wrap || wrap.dataset.scrollBound === "1") return;
    wrap.dataset.scrollBound = "1";
    wrap.addEventListener(
      "scroll",
      () => {
        maybeLoadMoreNotifs();
      },
      { passive: true }
    );
    wrap.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      if (e.target.closest("a[href]")) return;
      const row = e.target.closest(".session-notif");
      if (!row || !wrap.contains(row)) return;
      const href = row.getAttribute("data-href");
      if (!href) return;
      e.preventDefault();
      navigate(href);
    });
  }

  function prependNotifDom(items) {
    const wrap = $("#sessionNotifs");
    if (!wrap || !items.length) return;
    const first = wrap.querySelector(".session-notif");
    if (!first) {
      paintNotifs();
      return;
    }
    const before = wrap.scrollHeight;
    const top = wrap.scrollTop;
    first.insertAdjacentHTML("beforebegin", items.map(renderNotifItem).join(""));
    if (top > 0) wrap.scrollTop = top + (wrap.scrollHeight - before);
  }

  function appendNotifDom(items) {
    const wrap = $("#sessionNotifs");
    if (!wrap || !items.length) return;
    if (!wrap.querySelector(".session-notif")) {
      paintNotifs();
      return;
    }
    const footer = wrap.querySelector(".session-notifs-more");
    const html = items.map(renderNotifItem).join("");
    if (footer) footer.insertAdjacentHTML("beforebegin", html);
    else wrap.insertAdjacentHTML("beforeend", html);
    syncNotifFooter(wrap);
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
    const top = wrap.scrollTop;
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
    wrap.innerHTML = notifState.items.map(renderNotifItem).join("") + notifFooterHtml();
    wrap.scrollTop = top;
  }

  async function loadMoreNotifications() {
    const user = observer();
    if (!user || !notifState.loaded || notifState.loadingMore || notifState.done) return;
    if (!notifsPanelOpen()) return;
    const cursor = notifState.cursor;
    if (!cursor) {
      notifState.done = true;
      syncNotifFooter();
      return;
    }
    const gen = notifGen;
    notifState.loadingMore = true;
    syncNotifFooter();
    try {
      const batch = await HiveApi.accountNotifications(user, {
        limit: NOTIF_LIMIT,
        lastId: cursor,
      });
      if (gen !== notifGen || observer() !== user) return;
      const lastId = notificationId(batch[batch.length - 1]);
      notifState.cursor = lastId;
      if (
        !batch.length ||
        batch.length < NOTIF_LIMIT ||
        !lastId ||
        lastId === cursor ||
        notifBatchReachedRead(batch)
      ) {
        notifState.done = true;
      }
      const more = filterNotificationItems(batch, notifState.seen);
      if (more.length) {
        notifState.items = notifState.items.concat(more);
        appendNotifDom(more);
      }
    } catch {
      /* keep the cursor so the next scroll retries */
    } finally {
      if (gen !== notifGen) return;
      notifState.loadingMore = false;
      syncNotifFooter();
      maybeLoadMoreNotifs();
    }
  }

  async function loadNotifications() {
    const user = observer();
    if (!user) return;
    const gen = ++notifGen;
    notifState.user = user;
    notifState.loadingMore = false;
    try {
      const [unread, batch] = await Promise.all([
        HiveApi.unreadNotifications(user),
        HiveApi.accountNotifications(user, { limit: NOTIF_LIMIT }),
      ]);
      if (gen !== notifGen || observer() !== user) return;
      const markedFresh = notifState.markedAt && Date.now() - notifState.markedAt < 45000;
      if (markedFresh && unread.unread > 0) {
        notifState.unread = 0;
      } else {
        notifState.unread = unread.unread;
        notifState.lastread = unread.lastread || "";
        notifState.markedAt = 0;
      }
      const items = Array.isArray(batch) ? batch : [];
      const lastId = notificationId(items[items.length - 1]);
      const reachedRead = notifBatchReachedRead(items);
      if (!notifState.loaded) {
        notifState.seen = new Set();
        notifState.items = filterNotificationItems(items, notifState.seen);
        notifState.cursor = lastId;
        notifState.done = !items.length || items.length < NOTIF_LIMIT || !lastId || reachedRead;
        notifState.loaded = true;
        notifState.error = "";
        paintNotifs();
      } else {
        const kept = notifState.items.filter((item) => isNotifUnread(item, notifState.lastread));
        if (kept.length !== notifState.items.length) {
          notifState.items = kept;
          paintNotifs();
        }
        const fresh = filterNotificationItems(items, notifState.seen);
        notifState.error = "";
        if (fresh.length) {
          notifState.items = fresh.concat(notifState.items);
          prependNotifDom(fresh);
        }
        if (reachedRead) notifState.done = true;
      }
      paintBadge();
      maybeLoadMoreNotifs();
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
        notifState.items = [];
        notifState.seen = new Set();
        notifState.cursor = "";
        notifState.done = true;
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
    localReblogs.clear();
    reblogsCache.clear();
    payoutByKey.clear();
    voteRefreshGen.clear();
    hideVoteUi();
    pendingPublish = false;
    publishSubs = [];
    publishSubsUser = "";
    resetPublishForm();
    hidePublishOverlay({ persist: false });
    stopNotifPoll();
    resetNotifs();
    resetAccountState();
    renderSession();
    currentViewKey = "";
    if (parseRoute().name === "publish") navigate(appHref("/"), true);
    else route();
  }

  function logoFeedHref() {
    return appHref(pathForFeedSort(observer() ? "feed" : "latest"));
  }

  function paintLogoMenu() {
    const about = $("#logoAboutLink");
    const welcome = $("#logoWelcomeLink");
    const feed = $("#logoFeedLink");
    const tags = $("#logoTagsLink");
    const communities = $("#logoCommunitiesLink");
    const favs = $("#logoFavTags");
    const favComms = $("#logoFavCommunities");
    const trigger = $("#logoTrigger");
    const panel = document.querySelector("#logoDropdown .logo-dropdown-panel");
    const menuLabel = "About, welcome, feed, tags, and communities";
    if (trigger) trigger.setAttribute("aria-label", "Open " + menuLabel.toLowerCase());
    if (panel) panel.setAttribute("aria-label", menuLabel);
    if (about) about.setAttribute("href", appHref("/about"));
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
    const logoWrap = $("#logoWrap");
    const trigger = $("#logoTrigger");
    if (logoWrap) logoWrap.classList.remove("is-open");
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
                <img src="${sessionAvatarSrc(user)}" alt="" width="22" height="22">
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
      bindNotifScroll();
      paintBadge();
      paintNotifs();
      paintAccountResources();
      loadNotifications();
      loadAccountResources();
      startNotifPoll();
    } else {
      stopNotifPoll();
      resetNotifs();
      resetAccountState();
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
      maybeLoadMoreNotifs();
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

  function editingComment() {
    return Boolean(publishEdit && publishEdit.comment);
  }

  function paintPublishChrome() {
    const editing = Boolean(publishEdit);
    const comment = editingComment();
    const h2 = $("#publishPage h2");
    const submit = $("#publishSubmit");
    const dest = $("#publishDest");
    const pageEl = $("#publishPage");
    const title = $("#publishTitle");
    const body = $("#publishBody");
    const tagsHead = document.querySelector("#publishPage .publish-tags-head");
    const tagsWrap = $("#publishTagsWrap");
    if (h2) h2.textContent = comment ? "Edit comment" : editing ? "Edit post" : "New post";
    if (submit) submit.textContent = editing ? "Save" : "Publish";
    if (dest) dest.hidden = editing;
    if (title) title.hidden = comment;
    if (tagsHead) tagsHead.hidden = comment;
    if (tagsWrap) tagsWrap.hidden = comment;
    if (body) body.placeholder = comment ? "Write your comment…" : "Write your post…";
    if (pageEl) {
      pageEl.classList.toggle("is-editing", editing);
      pageEl.classList.toggle("is-editing-comment", comment);
    }
  }

  function focusPublishField() {
    const comment = editingComment();
    const field = comment ? $("#publishBody") : $("#publishTitle");
    if (!field) return;
    field.focus();
    if (!comment || typeof field.setSelectionRange !== "function") return;
    const n = field.value.length;
    field.setSelectionRange(n, n);
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
    const heading = !editingComment() && title ? `<h1>${HiveMd.escapeHtml(title)}</h1>` : "";
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
    // Publish was pushed on top of the open page. Pop that entry so a post
    // opened from the feed stays open, instead of replacing it with the feed.
    if (publishNavPushed) {
      publishNavPushed = false;
      history.back();
      return;
    }
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
    focusPublishField();
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
    const commentEdit = editingComment();
    const title = commentEdit
      ? String((publishEdit && publishEdit.title) || "").trim()
      : (($("#publishTitle") && $("#publishTitle").value) || "").trim();
    const body = (($("#publishBody") && $("#publishBody").value) || "").trim();
    if (!commentEdit) takeTagsFromInput();
    if (!commentEdit && !title) {
      setPublishStatus("Add a title.", true);
      return;
    }
    if (!body) {
      setPublishStatus(commentEdit ? "Write the comment." : "Write the post body.", true);
      return;
    }
    if (!hasSigner(user)) {
      setPublishStatus(signerNeededMessage(), true);
      return;
    }

    const editing = Boolean(publishEdit);
    if (editing && !isOwnAuthor(publishEdit.author)) {
      setPublishStatus(
        commentEdit ? "You can only edit your own comments." : "You can only edit your own posts.",
        true
      );
      return;
    }

    let tags = commentEdit ? (publishEdit.tags || []).slice() : publishTags.slice();
    let parentAuthor = "";
    let parentPermlink;
    let permlink;
    if (editing) {
      parentAuthor = publishEdit.parentAuthor || "";
      parentPermlink = publishEdit.parentPermlink;
      permlink = publishEdit.permlink;
      if (!commentEdit && parentPermlink && tags.indexOf(parentPermlink) === -1) {
        tags.unshift(parentPermlink);
        tags = tags.slice(0, MAX_TAGS);
      }
      if (!commentEdit && !parentAuthor && !tags.length) {
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

      // Wait for the post to actually exist on the blockchain
      let postExists = false;
      let retries = 0;
      const maxRetries = 60; // ~60 seconds with 1 second intervals

      while (!postExists && retries < maxRetries) {
        try {
          const post = await HiveApi.getContent(user, permlink);
          if (post && post.author) {
            postExists = true;
            break;
          }
        } catch (err) {
          // Post doesn't exist yet, continue retrying
        }

        if (!postExists) {
          retries++;
          // Wait 1 second before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (!postExists) {
        // Post never appeared - show error but don't navigate
        setPublishStatus("Post was submitted but failed to appear on blockchain. Refresh the page to check.", true);
        return;
      }

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

  function activeArticle() {
    const pv = document.getElementById("postView");
    if (postLayer.open && pv) {
      const article = pv.querySelector("article.article");
      if (article) return article;
    }
    return view ? view.querySelector("article.article") : null;
  }

  function applyPostEditToView(title, body) {
    const article = activeArticle();
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
    const comment = !isRootPost(post);
    publishEdit = {
      author: post.author,
      permlink: post.permlink,
      parentAuthor: post.parent_author || "",
      parentPermlink: post.parent_permlink || post.category || "",
      jsonMetadata: post.json_metadata,
      comment,
      title: post.title || "",
      tags: comment ? metadataTags(post) : null,
    };
    applyPublishForm({
      title: post.title || "",
      body: post.body || "",
      tags: comment ? publishEdit.tags.slice() : tagsForEdit(post),
      dest: publishDest,
      tagInput: "",
    });
    paintPublishChrome();
    setPublishFabHidden(true);
    pendingPublish = false;
    ov.hidden = false;
    focusPublishField();
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
        const incoming = [];
        for (const post of batch) {
          if (!isRootPost(post)) continue;
          const key = `${post.author}/${post.permlink}`;
          if (feedState.seen.has(key)) continue;
          feedState.seen.add(key);
          added++;
          if (isBlacklistedPost(post)) continue;
          incoming.push(post);
        }
        await resolveCrossPosts(incoming);
        for (let i = 0; i < incoming.length; i++) {
          if (!keepHydratedPost(incoming[i])) continue;
          feedState.items.push(incoming[i]);
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

  function originalCacheKey(author, permlink) {
    return (
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase()
    );
  }

  function crossPostRef(post) {
    if (!post) return null;
    const meta = HiveMd.parseJsonMetadata(post.json_metadata);
    const author = String(meta.original_author || "")
      .replace(/^@/, "")
      .trim();
    const permlink = String(meta.original_permlink || "").trim();
    if (!author || !permlink) return null;
    if (samePostId(post, author, permlink)) return null;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const first = String(tags[0] || "")
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
    if (first === "cross-post") return { author, permlink };
    const body = String(post.body || "").trim();
    if (/^this is a cross post of\b/i.test(body)) return { author, permlink };
    return null;
  }

  function cardDisplayPost(post) {
    if (post && post.original_entry && post.original_entry.author && post.original_entry.permlink) {
      return post.original_entry;
    }
    return post;
  }

  function rebloggerOf(post) {
    let list = post && post.reblogged_by;
    if (typeof list === "string" && list) list = [list];
    if (!Array.isArray(list) || !list.length) {
      const first = post && post.first_reblogged_by;
      if (first) list = [first];
      else return "";
    }
    const author = String((post && post.author) || "")
      .replace(/^@/, "")
      .toLowerCase();
    for (let i = 0; i < list.length; i++) {
      const name = String(list[i] || "")
        .replace(/^@/, "")
        .trim();
      if (name && name.toLowerCase() !== author) return name;
    }
    return "";
  }

  function handleLinkHtml(name) {
    const n = String(name || "").replace(/^@/, "");
    if (!n) return "";
    return `<a class="feed-share-user" href="${HiveMd.escapeHtml(profilePath(n))}">@${HiveMd.escapeHtml(n)}</a>`;
  }

  function isPinnedPost(post) {
    if (!post) return false;
    if (post.is_pinned) return true;
    return Boolean(post.stats && post.stats.is_pinned);
  }

  function shareIconHtml(kind, className) {
    let paths;
    if (kind === "crosspost") {
      paths = `<polygon points="21.4,12 16.8,20.2 7.2,20.2 2.6,12 7.2,3.8 16.8,3.8"/>`;
    } else if (kind === "pin") {
      paths = `<polygon points="12,2.6 18.8,9.4 12,21.4 5.2,9.4"/>
           <polygon fill="currentColor" stroke="none" points="12,2.6 18.8,9.4 5.2,9.4"/>`;
    } else {
      paths = `<polyline points="5,12 5,4.4 18.2,4.4"/>
           <polyline points="14.6,1.2 18.2,4.4 14.6,7.6"/>
           <polyline points="19,12 19,19.6 5.8,19.6"/>
           <polyline points="9.4,22.8 5.8,19.6 9.4,16.4"/>`;
    }
    const cls = className || "feed-share-icon";
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" stroke-linecap="square">${paths}</g></svg>`;
  }

  function reblogIconHtml() {
    return shareIconHtml("reblog", "reblog-icon");
  }

  function reblogControlHtml(post) {
    if (!isRootPost(post)) return "";
    const viewState = reblogView(post);
    const author = HiveMd.escapeHtml(post.author);
    const permlink = HiveMd.escapeHtml(post.permlink);
    const classes = [
      "reblog-btn",
      "stat-pill",
      "reblog-hit",
      viewState.mine ? "is-reblogged" : "",
      viewState.pending ? "is-pending" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const pending = viewState.pending ? "disabled" : "";
    const label = viewState.mine ? "Undo reblog" : "Reblog";
    return `<span class="reblog-wrap" data-reblog-author="${author}" data-reblog-permlink="${permlink}"><button type="button" class="${classes}" data-reblog-author="${author}" data-reblog-permlink="${permlink}" aria-pressed="${viewState.mine ? "true" : "false"}" aria-label="${label}" ${pending}>${reblogIconHtml()}<span class="reblog-n">${viewState.count}</span></button><span class="reblog-confirm-panel" hidden><p class="reblog-confirm-caption">Reblog this post?</p><p class="reblog-confirm-status" hidden></p><span class="reblog-confirm-actions"><button type="button" class="reblog-confirm" data-reblog-author="${author}" data-reblog-permlink="${permlink}">Reblog</button><button type="button" class="reblog-cancel">Cancel</button></span></span></span>`;
  }

  function shareLineHtml(post) {
    if (!post) return "";
    const lines = [];
    if (isPinnedPost(post)) {
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("pin")}pinned</span>`
      );
    }
    const reblogger = rebloggerOf(post);
    if (reblogger) {
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("reblog")}${handleLinkHtml(reblogger)} reblogged</span>`
      );
    }
    if (crossPostRef(post)) {
      const destName = communityNameOf(post);
      const destTitle = (post && post.community_title) || destName;
      let extra = "";
      if (destName && destTitle) {
        extra = ` to <a class="feed-share-community" href="${HiveMd.escapeHtml(
          communityHref(destName)
        )}">${HiveMd.escapeHtml(destTitle)}</a>`;
      }
      lines.push(
        `<span class="feed-share-line">${shareIconHtml("crosspost")}${handleLinkHtml(post.author)} cross-posted${extra}</span>`
      );
    }
    if (!lines.length) return "";
    return `<p class="feed-share">${lines.join("")}</p>`;
  }

  function fetchOriginalPost(author, permlink) {
    const key = originalCacheKey(author, permlink);
    if (originalPostCache.has(key)) return originalPostCache.get(key);
    const pending = HiveApi.getPost(author, permlink)
      .then((post) => (post && post.author && post.permlink ? post : null))
      .catch(() => null);
    originalPostCache.set(key, pending);
    return pending;
  }

  async function resolveCrossPosts(posts) {
    const list = Array.isArray(posts) ? posts : [];
    const jobs = [];
    for (let i = 0; i < list.length; i++) {
      const post = list[i];
      if (!post || post.original_entry) continue;
      const ref = crossPostRef(post);
      if (!ref) continue;
      jobs.push(
        fetchOriginalPost(ref.author, ref.permlink).then((orig) => {
          if (orig) post.original_entry = orig;
        })
      );
    }
    if (jobs.length) await Promise.all(jobs);
  }

  function keepHydratedPost(post) {
    if (!post) return false;
    const shown = cardDisplayPost(post);
    if (shown && isBlacklistedPost(shown)) return false;
    return true;
  }

  function cardHtml(post) {
    const shown = cardDisplayPost(post) || post;
    const share = shareLineHtml(post);
    const authorAttr = HiveMd.escapeHtml(shown.author);
    const permlinkAttr = HiveMd.escapeHtml(shown.permlink);
    const community = communityLabelHtml(shown);
    const rep = Math.floor(HiveMd.displayReputation(shown.author_reputation));
    const meta = `
        <div class="card-meta">
          ${authorLinkHtml(shown.author, "small")}
          <span class="meta-sep">·</span>
          <span>${rep}</span>
          ${community}
          ${metaTimeHtml(shown.created, postPath(shown))}
        </div>`;
    let card;
    if (isMutedHidden(shown)) {
      card = `
      <article class="post-card is-muted" data-author="${authorAttr}" data-permlink="${permlinkAttr}">
        ${meta}
        ${mutedNoticeHtml("post", shown)}
      </article>
    `;
    } else {
      const img = HiveMd.extractImage(shown);
      const thumb = img
        ? `<img class="card-thumb" src="${HiveMd.escapeHtml(HiveMd.proxyImage(img, 480))}" alt="">`
        : "";
      card = `
      <article class="post-card${img ? " has-image" : " no-thumb"}" data-author="${authorAttr}" data-permlink="${permlinkAttr}">
        ${meta}
        <a class="card-hit" href="${HiveMd.escapeHtml(postPath(shown))}">
          <h2>${HiveMd.escapeHtml(shown.title || "(untitled)")}</h2>
          <p class="card-excerpt">${HiveMd.escapeHtml(HiveMd.excerpt(shown, 200))}</p>
          ${thumb}
        </a>
        <div class="card-stats">
          ${voteControlHtml(shown, "pills")}
          ${commentCountHtml(shown.children, postPath(shown))}
          ${reblogControlHtml(shown)}
          ${payoutHtml(shown, true)}
        </div>
      </article>
    `;
    }
    return `<div class="feed-item">${share}${card}</div>`;
  }

  function feedNavHtml(sort, tag) {
    const t = normalizeRouteTag(tag);
    const items = [];
    if (!t && observer()) {
      items.push(["feed", "Feed", appHref("/feed")]);
    }
    items.push(
      ["created", "Latest", appHref(pathForFeedSort("latest", t))],
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
      paintFeedCards(list, cardHtml);
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
      list.innerHTML = `<p class="feed-hint tags-empty">No favorite communities yet.</p>`;
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
    if (isBlacklistedPost(node)) return "";
    rememberContent(node);
    const replies = (node._replies || []).map(renderComment).join("");
    const user = observer();
    const author = HiveMd.escapeHtml(node.author);
    const permlink = HiveMd.escapeHtml(node.permlink);
    const parentAuthor = HiveMd.escapeHtml(node.parent_author || "");
    const parentPermlink = HiveMd.escapeHtml(node.parent_permlink || "");
    const head = `
        <div class="comment-head">
          ${authorLinkHtml(node.author, "small")}
          <span>· ${Math.floor(HiveMd.displayReputation(node.author_reputation))}</span>
          <span>· ${metaTimeHtml(node.created, commentPath(node))}</span>
        </div>`;
    if (isMutedHidden(node)) {
      return `
      <article class="comment is-muted" data-author="${author}" data-permlink="${permlink}" data-parent-author="${parentAuthor}" data-parent-permlink="${parentPermlink}" id="@${author}/${permlink}">
        ${mutedNoticeHtml("comment", node)}
        ${replies ? `<div class="comment-replies">${replies}</div>` : ""}
      </article>
    `;
    }
    const body = HiveMd.renderMarkdown(node.body || "");
    const replyBtn = user
      ? `<button type="button" class="comment-reply-btn" data-reply-author="${author}" data-reply-permlink="${permlink}">Reply</button>`
      : "";
    const editBtn = editButtonHtml("comment", node.author, node.permlink);
    return `
      <article class="comment" data-author="${author}" data-permlink="${permlink}" data-parent-author="${parentAuthor}" data-parent-permlink="${parentPermlink}" id="@${author}/${permlink}">
        ${head}
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
    setCommentCount(n);
    const author = section.getAttribute("data-root-author");
    const permlink = section.getAttribute("data-root-permlink");
    if (!author || !permlink) return;
    const needle = ("/@" + author + "/" + permlink).toLowerCase();
    document.querySelectorAll(".post-card .comment-count-link").forEach((el) => {
      const link = String(el.getAttribute("href") || "").toLowerCase();
      if (link.indexOf(needle) === -1) return;
      const cur = Number(String(el.textContent || "").replace(/[^0-9]/g, "")) || 0;
      el.textContent = "C " + Math.max(0, cur + delta);
    });
    const item = findLoadedPost(author, permlink);
    if (item && item.children != null) {
      item.children = Math.max(0, (Number(item.children) || 0) + delta);
    }
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
      if (!accountReputation(user)) await loadAccountResources();
      const html = renderComment({
        author: user,
        permlink,
        body,
        created: new Date().toISOString(),
        author_reputation: accountReputation(user),
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

  /* ─── Post layer ─── */
  function postLayerEl() {
    return document.getElementById("postLayer");
  }

  function postViewEl() {
    return document.getElementById("postView");
  }

  function snapKey(author, permlink) {
    return (
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase()
    );
  }

  function samePostId(post, author, permlink) {
    if (!post) return false;
    return (
      String(post.author || "")
        .replace(/^@/, "")
        .toLowerCase() ===
        String(author || "")
          .replace(/^@/, "")
          .toLowerCase() &&
      String(post.permlink || "").toLowerCase() === String(permlink || "").toLowerCase()
    );
  }

  function findLoadedPost(author, permlink) {
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (samePostId(item, author, permlink)) return item;
      if (item && item.original_entry && samePostId(item.original_entry, author, permlink)) {
        return item;
      }
    }
    if (samePostId(currentPost, author, permlink)) return currentPost;
    return null;
  }

  function commentsPendingHtml() {
    return `<div class="loading-row post-comments-pending"><span class="btn-loader" aria-hidden="true"></span> Loading comments…</div>`;
  }

  function commentsErrorHtml(msg) {
    return `<p class="feed-hint post-comments-error">${HiveMd.escapeHtml(msg || "Couldn't load comments.")}</p>`;
  }

  function countThreadedReplies(node) {
    const replies = node && node._replies;
    if (!Array.isArray(replies) || !replies.length) return 0;
    let n = 0;
    for (let i = 0; i < replies.length; i++) {
      if (isBlacklistedPost(replies[i])) continue;
      n += 1 + countThreadedReplies(replies[i]);
    }
    return n;
  }

  function discussionCommentCount(discussion, root) {
    // Replies under the opened post. A comment opened from a profile feed is
    // depth 1 in its own discussion, so a depth check would count it.
    if (root && Array.isArray(root._replies)) return countThreadedReplies(root);
    if (discussion && typeof discussion === "object") {
      const self =
        root && root.author
          ? String(root.author).toLowerCase() + "/" + String(root.permlink).toLowerCase()
          : "";
      return Object.values(discussion).filter((node) => {
        if (!node || !node.author || !node.permlink) return false;
        if (Number(node.depth) === 0) return false;
        if (isBlacklistedPost(node)) return false;
        if (!self) return true;
        const key = String(node.author).toLowerCase() + "/" + String(node.permlink).toLowerCase();
        return key !== self;
      }).length;
    }
    return Number(root && root.children) || 0;
  }

  function articleHtml(root, opts) {
    const options = opts || {};
    const community = communityLabelHtml(root, "article-community");
    const commentCount =
      options.commentCount != null ? options.commentCount : Number(root.children) || 0;
    const user = observer();
    const composer = user
      ? composerHtml(root.author, root.permlink, {
          placeholder: "Write a comment…",
          submitLabel: "Comment",
        })
      : "";
    const postEdit = editButtonHtml("post", root.author, root.permlink);
    const commentsBody =
      options.commentsHtml != null ? options.commentsHtml : commentsPendingHtml();
    return `
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
        <div class="post-stats-bar" id="stats">
          ${voteControlHtml(root, "pills")}
          ${commentCountHtml(commentCount, "#comments")}
          ${reblogControlHtml(root)}
          ${payoutHtml(root, true)}
          ${postEdit}
        </div>
        <section class="comments" id="comments" data-root-author="${HiveMd.escapeHtml(root.author)}" data-root-permlink="${HiveMd.escapeHtml(root.permlink)}" data-count="${commentCount}">
          ${composer}
          <div class="comment-list">
            ${commentsBody}
          </div>
        </section>
      </article>
    `;
  }

  function renderedCommentsHtml(root) {
    const comments = (root._replies || []).map(renderComment).join("");
    return comments || `<p class="feed-hint">No comments yet.</p>`;
  }

  function paintPostMessage(html) {
    const pv = postViewEl();
    if (!pv) return;
    pv.innerHTML = html;
  }

  function setPostTitle(root) {
    document.title = `${(root && root.title) || "Post"} — Crypto Space 77`;
  }

  function setCommentCount(n) {
    const section = document.getElementById("comments");
    if (!section) return;
    section.setAttribute("data-count", String(n));
    const article = section.closest(".article");
    if (!article) return;
    article.querySelectorAll(".comment-n").forEach((el) => {
      el.textContent = "C " + n;
    });
  }

  function fillCommentList(html) {
    const section = document.getElementById("comments");
    if (!section || !postLayer.open) return;
    const list = section.querySelector(".comment-list");
    if (list) list.innerHTML = html;
  }

  function refreshArticleCommunity(root) {
    const article = activeArticle();
    if (!article) return;
    const html = communityLabelHtml(root, "article-community");
    const existing = article.querySelector(":scope > .article-community");
    if (!html) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const next = wrap.firstElementChild;
    if (!next) return;
    if (!existing) {
      const h1 = article.querySelector(":scope > h1");
      if (h1) h1.insertAdjacentElement("beforebegin", next);
      return;
    }
    if (
      existing.textContent !== next.textContent ||
      existing.getAttribute("href") !== next.getAttribute("href")
    ) {
      existing.replaceWith(next);
    }
  }

  function refreshArticleVotes(root) {
    if (!root || openSlider) return;
    const article = activeArticle();
    if (!article) return;
    const viewState = voteView(root);
    article.querySelectorAll(".vote-n").forEach((el) => {
      el.textContent = String(viewState.upCount);
    });
    article.querySelectorAll(".downvote-n").forEach((el) => {
      el.textContent = String(viewState.downCount);
    });
    const payout = formatPayout(root);
    article.querySelectorAll(".payout").forEach((el) => {
      el.textContent = payout;
    });
    rememberPayout(root);
  }

  function patchOpenArticle(prev, root) {
    const article = activeArticle();
    if (!article) return false;
    const h1 = article.querySelector(":scope > h1");
    if (h1 && String((prev && prev.title) || "") !== String(root.title || "")) {
      h1.textContent = root.title || "(untitled)";
    }
    if (String((prev && prev.body) || "") !== String(root.body || "")) {
      const bodyEl = article.querySelector(":scope > .post-body");
      if (bodyEl) bodyEl.innerHTML = HiveMd.renderMarkdown(root.body || "");
    }
    if (!prev || tagsOf(prev).join("\n") !== tagsOf(root).join("\n")) {
      const tagsEl = article.querySelector(":scope > .tags");
      if (tagsEl) tagsEl.innerHTML = tagsOf(root).map(tagChipHtml).join("");
    }
    refreshArticleCommunity(root);
    refreshArticleVotes(root);
    setPostTitle(root);
    return true;
  }

  function paintArticle(root, opts) {
    const pv = postViewEl();
    if (!pv || !root) return false;
    const options = opts || {};
    currentPost = root;
    rememberContent(root);
    pv.innerHTML = articleHtml(root, options);
    setPostTitle(root);
    return true;
  }

  function htmlHasPendingComments(html) {
    return String(html || "").indexOf("post-comments-pending") !== -1;
  }

  function rememberPostSnap() {
    if (!postLayer.author || !postLayer.permlink) return;
    const pv = postViewEl();
    if (!pv || !pv.innerHTML.trim()) return;
    const html = pv.innerHTML;
    const key = snapKey(postLayer.author, postLayer.permlink);
    const pending = htmlHasPendingComments(html);
    const prev = postSnaps.get(key);
    if (pending && prev && !htmlHasPendingComments(prev.html)) return;
    postSnaps.delete(key);
    postSnaps.set(key, {
      html,
      scroll: window.scrollY || window.pageYOffset || 0,
      title: document.title,
      root: currentPost,
    });
    while (postSnaps.size > POST_SNAP_MAX) {
      const oldest = postSnaps.keys().next().value;
      postSnaps.delete(oldest);
    }
  }

  function showPostSnap(snap) {
    const pv = postViewEl();
    if (!pv || !snap || !snap.html) return false;
    pv.innerHTML = snap.html;
    if (snap.root) {
      currentPost = snap.root;
      rememberContent(snap.root);
    }
    if (snap.title) document.title = snap.title;
    return true;
  }

  let instantScrollGen = 0;

  function armInstantScroll() {
    const root = document.documentElement;
    const gen = ++instantScrollGen;
    // html { scroll-behavior: smooth } would ease the jump to the top of a
    // post, and putting smooth back in the same turn starts that animation.
    root.style.scrollBehavior = "auto";
    root.style.overflowAnchor = "none";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gen !== instantScrollGen) return;
        root.style.scrollBehavior = "";
        root.style.overflowAnchor = "";
      });
    });
  }

  function scrollWindowInstant(y) {
    armInstantScroll();
    const root = document.documentElement;
    const top = y || 0;
    try {
      window.scrollTo({ top, left: 0, behavior: "instant" });
    } catch (err) {
      window.scrollTo(0, top);
    }
    root.scrollTop = top;
  }

  function setPostBackgroundHidden(hidden) {
    const app = document.querySelector(".app");
    const flyer = document.getElementById("welcomeFlyer");
    [app, flyer].forEach((el) => {
      if (!el) return;
      if (hidden) el.setAttribute("aria-hidden", "true");
      else el.removeAttribute("aria-hidden");
    });
  }

  function ensurePostHistory() {
    const state = history.state;
    // Capture the feed offset once, before the feed is taken out of flow.
    // Later post-to-post opens keep that offset for Back.
    if (!postLayer.heldScroll) {
      if (state && state.cs77 === "post" && Number.isFinite(Number(state.underScroll))) {
        postLayer.scrollY = Number(state.underScroll);
      } else {
        postLayer.scrollY = window.scrollY || window.pageYOffset || 0;
      }
      if (state && state.cs77 === "post" && typeof state.underWelcome === "boolean") {
        postLayer.hadWelcome = state.underWelcome;
      } else {
        postLayer.hadWelcome = document.body.classList.contains("has-welcome");
      }
      postLayer.heldScroll = true;
    }
    const underKey =
      (state && state.cs77 === "post" && state.underKey) || currentViewKey || "";
    history.replaceState(
      {
        cs77: "post",
        underScroll: postLayer.scrollY || 0,
        underKey,
        underWelcome: !!postLayer.hadWelcome,
      },
      "",
      location.href
    );
  }

  function closeWelcomeForPost() {
    if (!postLayer.hadWelcome) return;
    document.body.classList.remove("has-welcome");
    const flyer = document.getElementById("welcomeFlyer");
    if (flyer) flyer.hidden = true;
  }

  function revealPostLayer() {
    const layer = postLayerEl();
    if (!layer) return null;
    ensurePostHistory();
    armInstantScroll();
    closeWelcomeForPost();
    const active = document.activeElement;
    if (active && active !== document.body && active.blur) active.blur();
    document.body.classList.add("is-post-open");
    layer.hidden = false;
    setPostBackgroundHidden(true);
    postLayer.open = true;
    updateScrollTopBtn();
    return layer;
  }

  function cardContentKey(author, permlink) {
    return snapKey(author, permlink);
  }

  function cardContentStamp(post) {
    const tags = tagsOf(post)
      .map((t) => String(t).toLowerCase())
      .sort()
      .join("\n");
    return [
      String(post.title || ""),
      String(post.body || ""),
      HiveMd.extractImage(post) || "",
      tags,
    ].join("\u0001");
  }

  function rememberCardContent(post) {
    if (!post || !post.author || !post.permlink) return;
    cardContentStamps.set(cardContentKey(post.author, post.permlink), cardContentStamp(post));
  }

  function paintFeedCards(list, mapFn) {
    const items = feedState.items || [];
    for (let i = 0; i < items.length; i++) rememberCardContent(cardDisplayPost(items[i]));
    list.innerHTML = items.map(mapFn).join("");
  }

  function feedCardHrefMatches(href, author, permlink) {
    const path = String(href || "")
      .split("#")[0]
      .split("?")[0]
      .toLowerCase();
    const needle =
      "/@" +
      String(author || "")
        .replace(/^@/, "")
        .toLowerCase() +
      "/" +
      String(permlink || "").toLowerCase();
    return path.endsWith(needle);
  }

  function findFeedCard(author, permlink) {
    const cards = document.querySelectorAll("#view article.post-card");
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (
        samePostId(
          {
            author: card.getAttribute("data-author"),
            permlink: card.getAttribute("data-permlink"),
          },
          author,
          permlink
        )
      ) {
        return card;
      }
      const hit = card.querySelector("a.card-hit");
      if (hit && feedCardHrefMatches(hit.getAttribute("href"), author, permlink)) {
        return card;
      }
    }
    return null;
  }

  function postContentEdited(prev, next) {
    if (!prev || !next || prev === next) return false;
    return cardContentStamp(prev) !== cardContentStamp(next);
  }

  function cardContentChanged(post) {
    if (!post || !post.author || !post.permlink) return false;
    const prev = cardContentStamps.get(cardContentKey(post.author, post.permlink));
    if (prev != null) return prev !== cardContentStamp(post);
    const item = findLoadedPost(post.author, post.permlink);
    const shown = cardDisplayPost(item);
    if (!shown || shown === post) return false;
    return postContentEdited(shown, post);
  }

  function commentCountForReturn(post) {
    const section = document.getElementById("comments");
    if (
      section &&
      samePostId(
        {
          author: section.getAttribute("data-root-author"),
          permlink: section.getAttribute("data-root-permlink"),
        },
        post.author,
        post.permlink
      )
    ) {
      const shown = Number(section.getAttribute("data-count"));
      if (Number.isFinite(shown)) return Math.max(0, shown);
    }
    return Number(post && post.children) || 0;
  }

  function copyDefinedFields(dest, src, keys) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (src[key] !== undefined) dest[key] = src[key];
    }
  }

  function copyPostContent(dest, src) {
    copyDefinedFields(dest, src, [
      "title",
      "body",
      "json_metadata",
      "updated",
      "category",
      "community",
      "community_title",
    ]);
  }

  function copyPostStats(dest, src, commentCount) {
    copyDefinedFields(dest, src, [
      "active_votes",
      "stats",
      "payout",
      "pending_payout_value",
      "total_payout_value",
      "curator_payout_value",
      "author_payout_value",
      "net_rshares",
      "is_paidout",
      "cashout_time",
      "payout_at",
      "max_accepted_payout",
      "reblogs",
      "reblogged_by",
    ]);
    dest.children = commentCount;
  }

  function replaceFeedCard(card, post) {
    const shown = cardDisplayPost(post);
    const html =
      profileState.author && !isRootPost(shown) ? profileCardHtml(post) : cardHtml(post);
    const wrap = document.createElement("div");
    wrap.innerHTML = String(html || "").trim();
    const next = wrap.firstElementChild;
    const root = (card && card.closest && card.closest(".feed-item")) || card;
    if (next && root) root.replaceWith(next);
  }

  function patchFeedCardStats(card, post, commentCount) {
    syncVoteButtons(post.author, post.permlink, voteView(post));
    syncReblogButtons(post.author, post.permlink, reblogView(post));
    const payout = formatPayout(post);
    card.querySelectorAll(".payout").forEach((el) => {
      el.textContent = payout;
    });
    const label = "C " + commentCount;
    card.querySelectorAll(".comment-n").forEach((el) => {
      el.textContent = label;
    });
  }

  // The list under a post stays mounted. On the way back, rebuild the card
  // when the post content changed, and otherwise refresh only its figures.
  function syncFeedCardOnReturn() {
    const post = currentPost;
    if (!post || !post.author || !post.permlink) return;
    const item = findLoadedPost(post.author, post.permlink);
    const card = findFeedCard(post.author, post.permlink);
    if (!item && !card) return;
    const target = item ? cardDisplayPost(item) : null;
    const edited = cardContentChanged(post);
    const comments = commentCountForReturn(post);
    if (target && target !== post) {
      if (edited) copyPostContent(target, post);
      copyPostStats(target, post, comments);
    } else if (target) {
      target.children = comments;
    }
    rememberCardContent(target && edited ? target : post);
    if (!card) return;
    if (edited) {
      replaceFeedCard(card, item || post);
      return;
    }
    patchFeedCardStats(card, target || post, comments);
  }

  function suspendPostLayer(opts) {
    if (!postLayer.open) return;
    stopCommentJump();
    rememberPostSnap();
    postLayer.gen += 1;
    const layer = postLayerEl();
    if (layer) layer.hidden = true;
    postLayer.open = false;
    postLayer.author = "";
    postLayer.permlink = "";
    const y = postLayer.scrollY || 0;
    const restore = !(opts && opts.restoreScroll === false);
    const bringWelcome = restore && postLayer.hadWelcome;
    postLayer.heldScroll = false;
    postLayer.hadWelcome = false;
    armInstantScroll();
    document.body.classList.remove("is-post-open");
    setPostBackgroundHidden(false);
    if (bringWelcome) {
      document.body.classList.add("has-welcome");
      const flyer = document.getElementById("welcomeFlyer");
      if (flyer) flyer.hidden = false;
    }
    scrollWindowInstant(restore ? y : 0);
    updateScrollTopBtn();
  }

  function postStill(gen, author, permlink) {
    return (
      postLayer.gen === gen &&
      postLayer.open &&
      postLayer.author === author &&
      postLayer.permlink === permlink
    );
  }

  function stopCommentJump() {
    if (postLayer.jumpCleanup) {
      postLayer.jumpCleanup();
      postLayer.jumpCleanup = null;
    }
    if (postLayer.jumpObserver) {
      postLayer.jumpObserver.disconnect();
      postLayer.jumpObserver = null;
    }
    if (postLayer.jumpTimer) {
      clearTimeout(postLayer.jumpTimer);
      postLayer.jumpTimer = 0;
    }
  }

  function armCommentJump() {
    stopCommentJump();
    const layer = postLayerEl();
    const article = document.querySelector("#postView .article");
    if (!layer || !article || typeof ResizeObserver !== "function") return;
    const gen = postLayer.gen;
    let ignore = false;
    const onUser = () => {
      ignore = true;
      stopCommentJump();
    };
    window.addEventListener("wheel", onUser, { passive: true });
    window.addEventListener("touchstart", onUser, { passive: true });
    const realign = () => {
      if (ignore || !postLayer.open || postLayer.gen !== gen) return;
      scrollToComments("auto");
    };
    const observer = new ResizeObserver(realign);
    observer.observe(article);
    postLayer.jumpObserver = observer;
    postLayer.jumpCleanup = () => {
      window.removeEventListener("wheel", onUser);
      window.removeEventListener("touchstart", onUser);
    };
    postLayer.jumpTimer = setTimeout(stopCommentJump, 4000);
    article.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", realign, { once: true });
    });
  }

  function settlePostAnchor(opts, commentsReady) {
    if (!opts || !postLayer.open) return;
    if (opts.jumpComments) {
      // The post can grow after the first paint (images, then the thread).
      // Keep the comments section in view until that settles, unless the
      // reader has already scrolled away.
      scrollToComments("auto");
      armCommentJump();
      return;
    }
    if (opts.anchor && commentsReady) scrollToAnchor(opts.anchor, "auto");
  }

  async function presentPost(author, permlink, opts) {
    const a = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    const p = String(permlink || "");
    const options = opts || {};
    const layer = postLayerEl();
    const pv = postViewEl();
    if (!layer || !pv) {
      view.innerHTML = notFoundHtml("Could not open this post.");
      return;
    }

    if (isBlacklistedPost(a, p)) {
      if (postLayer.open) rememberPostSnap();
      postLayer.gen += 1;
      postLayer.author = a;
      postLayer.permlink = p;
      currentPost = null;
      document.title = "Not found — Crypto Space 77";
      paintPostMessage(notFoundHtml("This post was blacklisted."));
      revealPostLayer();
      scrollWindowInstant(0);
      return;
    }

    if (postLayer.open && postLayer.author === a && postLayer.permlink === p && pv.innerHTML.trim()) {
      if (currentPost) setPostTitle(currentPost);
      settlePostAnchor(options, !htmlHasPendingComments(pv.innerHTML));
      return;
    }

    if (postLayer.open) rememberPostSnap();

    const gen = ++postLayer.gen;
    postLayer.author = a;
    postLayer.permlink = p;
    const snap = postSnaps.get(snapKey(a, p));
    const useSnap = Boolean(snap && snap.html);
    let restoreScroll = null;
    if (useSnap) {
      showPostSnap(snap);
      if (!options.jumpComments && !options.anchor) restoreScroll = snap.scroll || 0;
    } else {
      const cached = findLoadedPost(a, p);
      if (cached && (cached.title || cached.body)) {
        paintArticle(cached, {
          commentCount: Number(cached.children) || 0,
          commentsHtml: commentsPendingHtml(),
        });
      } else {
        paintPostMessage(
          `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Opening post…</div>`
        );
        currentPost = null;
      }
    }

    revealPostLayer();
    scrollWindowInstant(restoreScroll != null ? restoreScroll : 0);
    const shown = postViewEl();
    const articleShown = Boolean(shown && shown.querySelector("article.article"));
    // "Opening post…" has no article yet. A cached card does, with a pending
    // comment list. Either one still needs the discussion.
    const pendingNow = !articleShown || htmlHasPendingComments(shown.innerHTML);
    settlePostAnchor(options, !pendingNow);
    if (!pendingNow) return;

    try {
      const discussion = await HiveApi.getDiscussion(a, p, observer());
      if (!postStill(gen, a, p)) return;
      setNodeLabel();
      const root = buildCommentTree(discussion, a, p);
      if (!root) {
        if (!activeArticle()) {
          currentPost = null;
          paintPostMessage(notFoundHtml("This post could not be found on Hive."));
        } else {
          fillCommentList(commentsErrorHtml("Couldn't load comments."));
        }
        return;
      }
      clearError();
      const prev = currentPost;
      currentPost = root;
      rememberContent(root);
      const count = discussionCommentCount(discussion, root);
      const commentsHtml = renderedCommentsHtml(root);
      const article = activeArticle();
      if (!article) {
        paintArticle(root, { commentCount: count, commentsHtml });
      } else {
        patchOpenArticle(prev, root);
        setCommentCount(count);
        fillCommentList(commentsHtml);
      }
      settlePostAnchor(options, true);
    } catch (err) {
      if (!postStill(gen, a, p)) return;
      const msg = err.message || String(err);
      if (!activeArticle()) {
        currentPost = null;
        paintPostMessage(notFoundHtml(msg || "Could not load this post."));
      } else {
        fillCommentList(commentsErrorHtml(msg));
      }
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
    claimAnimToken += 1;
    profileState.wallet = null;
    profileState.walletTx = null;
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
    const info = meta && typeof meta.profile === "object" && meta.profile ? meta.profile : {};
    const profileImage = String(
      (info && info.profile_image) || (profile && profile.profile_image) || ""
    ).trim();
    const avatarSrc = avatarSrcFromImage(author, profileImage, "large");
    const about = String(
      (info && info.about) || (profile && profile.about) || ""
    ).trim();
    const display =
      (info && info.name) || (profile && profile.name) || author;
    const stats = (profile && profile.stats) || {};
    const statsPending = Boolean(profile && profile.statsPending);
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
          <img class="avatar" src="${avatarSrc}" alt="">
          <div>
            <h1>${HiveMd.escapeHtml(display)}</h1>
            <p class="profile-handle"><a href="${href}">@${HiveMd.escapeHtml(author)}</a> · <span class="profile-rep">${rep}</span></p>
            ${about ? `<p class="profile-about">${HiveMd.escapeHtml(about)}</p>` : ""}
            ${profileDetailsHtml(profile)}
            <div class="profile-stats">
              <span class="profile-post-count">${posts} posts</span>
              <span class="profile-follower-count">${statsPending ? "… followers" : followers + " followers"}</span>
              <span class="profile-following-count">${statsPending ? "… following" : following + " following"}</span>
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
    const profile = profileState.profile;
    const stats = profile && profile.stats;
    if (!profile || !stats || profile.statsPending) return;
    const count = view.querySelector(".profile-follower-count");
    if (count) count.textContent = Number(stats.followers || 0) + " followers";
    const following = view.querySelector(".profile-following-count");
    if (following) following.textContent = Number(stats.following || 0) + " following";
  }

  function applyOwnProfileSocial(bridge) {
    if (!bridge || !accountState.loaded || accountState.user !== profileState.author) return;
    const stats = bridge.stats || {};
    accountState.social = {
      followers: Number(stats.followers) || 0,
      following: Number(stats.following) || 0,
      followed: profileFollowed(bridge),
    };
    const profile = profileState.profile;
    if (!profile) return;
    if (!profile.stats) profile.stats = {};
    profile.stats.followers = accountState.social.followers;
    profile.stats.following = accountState.social.following;
    profile.statsPending = false;
    if (!profile.context) profile.context = {};
    profile.context.followed = accountState.social.followed;
    // get_accounts reputation is 0. Prefer the raw score already stored on
    // the account; otherwise use the display score from the profile API.
    const raw = accountState.account && accountState.account.reputation;
    const rawNumber = Number(raw);
    if ((!Number.isFinite(rawNumber) || rawNumber === 0) && bridge.reputation != null && bridge.reputation !== "") {
      if (accountState.account) accountState.account.reputation = bridge.reputation;
      profile.reputation = bridge.reputation;
    }
    paintProfileChrome();
    paintProfileRep();
  }

  function syncOwnProfileBanner() {
    if (!accountState.loaded || profileState.author !== accountState.user) return;
    const profile = profileState.profile;
    const account = accountState.account;
    if (!profile || !account) return;
    const metadata = accountState.metadata || metadataFromAccount(account);
    profile.metadata = metadata;
    profile.profile_image = accountState.profileImage || "";
    profile.reputation = account.reputation;
    profile.created = account.created;
    profile.post_count = account.post_count;
    if (profile.stats) profile.stats.post_count = Number(account.post_count) || 0;
    const banner = view.querySelector(".profile-banner");
    if (!banner) return;
    const img = banner.querySelector(".profile-head .avatar");
    if (img) {
      const src = avatarSrcFromImage(accountState.user, accountState.profileImage || "", "large");
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    }
    const info = metadata && metadata.profile;
    const display = (info && info.name) || account.name || accountState.user;
    const heading = banner.querySelector("h1");
    if (heading && display) heading.textContent = display;
    const about = String((info && info.about) || "").trim();
    const aboutEl = banner.querySelector(".profile-about");
    if (aboutEl) aboutEl.textContent = about;
    const postsEl = banner.querySelector(".profile-post-count");
    if (postsEl) postsEl.textContent = (Number(account.post_count) || 0) + " posts";
    const hpText = formatProfileHp(hivePowerFromAccount(account, accountState.props));
    const hpEl = banner.querySelector(".profile-hp");
    if (hpEl && hpText) hpEl.textContent = hpText;
    paintProfileRep();
  }

  function paintProfileRep() {
    const el = view.querySelector(".profile-banner .profile-rep");
    const profile = profileState.profile;
    if (!el || !profile) return;
    el.textContent = String(Math.floor(HiveMd.displayReputation(profile.reputation || 0)));
  }

  function profileCardHtml(post) {
    if (isRootPost(cardDisplayPost(post))) return cardHtml(post);
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
      return formatHiveLike(hive, "hp");
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

  // Keep these names aligned with WALLET_HISTORY_OP_IDS in api.js.
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
    //author_reward: "author award",
    //curation_reward: "curation award",
    //comment_benefactor_reward: "benefactor award",
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

  function walletTxMemo(type, payload) {
    if (
      type !== "transfer" &&
      type !== "transfer_to_savings" &&
      type !== "transfer_from_savings" &&
      type !== "fill_transfer_from_savings"
    ) {
      return "";
    }
    return String((payload && payload.memo) || "").trim();
  }

  function walletTxUrl(rec) {
    const id = String((rec && rec.trx_id) || "")
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(id) || /^0+$/.test(id)) return "";
    return "https://hivescan.info/tx/" + id;
  }

  const WALLET_TX_PAGE = 30;

  function blankWalletTx() {
    return {
      items: [],
      cursor: -1,
      done: false,
      loading: false,
      started: false,
      error: "",
      seen: new Set(),
      pageGoal: WALLET_TX_PAGE,
    };
  }

  function historyRowIndex(rec) {
    const idx = Array.isArray(rec) ? Number(rec[0]) : NaN;
    return Number.isFinite(idx) ? idx : NaN;
  }

  function consumeWalletHistoryBatch(tx, batch) {
    if (!batch.length) {
      tx.done = true;
      return;
    }
    let oldest = NaN;
    for (let i = 0; i < batch.length; i++) {
      const idx = historyRowIndex(batch[i]);
      if (!Number.isFinite(idx)) continue;
      if (!Number.isFinite(oldest) || idx < oldest) oldest = idx;
    }
    let stopAt = NaN;
    for (let j = batch.length - 1; j >= 0; j--) {
      const rec = batch[j];
      const idx = historyRowIndex(rec);
      if (!Number.isFinite(idx) || tx.seen.has(idx)) continue;
      tx.seen.add(idx);
      const op = rec[1] && rec[1].op;
      const type = Array.isArray(op) ? String(op[0] || "") : "";
      if (WALLET_TX_TYPES[type]) tx.items.push(rec);
      if (tx.items.length >= tx.pageGoal) {
        stopAt = idx;
        break;
      }
    }
    const reachedOldest = Number.isFinite(stopAt) && stopAt === oldest;
    if (Number.isFinite(stopAt)) {
      if (stopAt <= 0 || (reachedOldest && batch.length < WALLET_TX_PAGE)) {
        tx.done = true;
      } else {
        tx.cursor = stopAt - 1;
      }
      return;
    }
    if (!Number.isFinite(oldest) || oldest <= 0 || batch.length < WALLET_TX_PAGE) {
      tx.done = true;
      return;
    }
    tx.cursor = oldest - 1;
  }

  async function appendWalletHistory(account, tx) {
    if (tx.done || profileState.walletTx !== tx) return;
    tx.pageGoal = tx.items.length + WALLET_TX_PAGE;
    const batch = await HiveApi.getWalletHistory(account, tx.cursor, WALLET_TX_PAGE);
    if (profileState.walletTx !== tx) return;
    consumeWalletHistoryBatch(tx, batch);
  }

  function walletHistoryHtml(tx, props) {
    const state = tx || blankWalletTx();
    const rows = (state.items || []).map((row) => walletTxHtml(row, props)).filter(Boolean);
    let body = "";
    if (rows.length) {
      body = `<div class="wallet-tx-list">${rows.join("")}</div>`;
    } else if (state.started && !state.loading && state.error) {
      body = `<div class="panel empty-state"><h2>Transactions unavailable</h2><p>${HiveMd.escapeHtml(state.error)}</p></div>`;
    } else if (state.started && !state.loading && state.done) {
      body = `<div class="panel empty-state"><h2>No recent transactions</h2><p>Wallet activity for this account will show up here.</p></div>`;
    }
    const note =
      rows.length && state.error && !state.loading
        ? `<p class="wallet-note">${HiveMd.escapeHtml(state.error)}</p>`
        : "";
    const loading =
      !state.started || state.loading
        ? `<div class="wallet-tx-status"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>`
        : "";
    const more =
      state.started && !state.done && !state.loading
        ? `<div class="feed-actions"><button type="button" class="btn-primary" id="walletMoreBtn">Load more</button></div>`
        : "";
    return body + note + loading + more;
  }

  function paintWalletHistory() {
    const el = $("#walletTxBody");
    if (!el) return;
    const props = profileState.wallet && profileState.wallet.props;
    el.innerHTML = walletHistoryHtml(profileState.walletTx, props);
  }

  async function loadMoreWalletHistory() {
    const tx = profileState.walletTx;
    const name = profileState.author;
    const tab = profileState.page;
    if (!tx || tx.loading || tx.done || !name) return;
    tx.loading = true;
    tx.error = "";
    paintWalletHistory();
    try {
      await appendWalletHistory(name, tx);
    } catch (err) {
      if (profileState.walletTx !== tx) return;
      tx.error = (err && err.message) || String(err);
    } finally {
      if (profileState.walletTx === tx) {
        tx.loading = false;
        tx.started = true;
      }
    }
    if (profileState.walletTx !== tx || !profileRouteStill(name, tab)) return;
    paintWalletHistory();
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
    const memo = walletTxMemo(type, payload);
    const when = rec.timestamp ? timeAgo(rec.timestamp) : "";
    const abs = rec.timestamp ? formatCreatedUtc(rec.timestamp) : "";
    const pop = abs
      ? `<span class="session-stat-tip" role="tooltip">${HiveMd.escapeHtml(abs)}</span>`
      : "";
    const txUrl = walletTxUrl(rec);
    const timeHtml = when
      ? txUrl
        ? `<a class="wallet-tx-time" href="${HiveMd.escapeHtml(txUrl)}" target="_blank" rel="noopener noreferrer">${HiveMd.escapeHtml(when)}${pop}</a>`
        : `<span class="wallet-tx-time">${HiveMd.escapeHtml(when)}${pop}</span>`
      : "";
    return `<div class="wallet-tx">
      <div class="wallet-tx-main">
        <span class="wallet-tx-type">${HiveMd.escapeHtml(WALLET_TX_TYPES[type])}</span>
        ${detail ? `<span class="wallet-tx-detail">${HiveMd.escapeHtml(detail)}</span>` : ""}
        ${memo ? `<span class="wallet-tx-memo">${HiveMd.escapeHtml(memo)}</span>` : ""}
      </div>
      <div class="wallet-tx-side">
        ${amount ? `<span class="wallet-tx-amount">${HiveMd.escapeHtml(amount)}</span>` : ""}
        ${timeHtml}
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
          <button type="button" class="btn-primary btn-compact wallet-claim-btn">Claim</button>
        </div>
      </section>
    `;
  }

  function formatAssetNumber(amount) {
    return formatGroupedNumber(amount, 3);
  }

  function applyClaimedRewards(wallet) {
    const hive = Number(wallet.rewardHive) || 0;
    const hbd = Number(wallet.rewardHbd) || 0;
    const staked = Number(wallet.rewardVestingHive) || 0;
    const vests = Number(wallet.rewardVests) || 0;
    wallet.hive = roundAsset((Number(wallet.hive) || 0) + hive, 3);
    wallet.hbd = roundAsset((Number(wallet.hbd) || 0) + hbd, 3);
    wallet.stakedHive = roundAsset((Number(wallet.stakedHive) || 0) + staked, 3);
    wallet.vestingShares = roundAsset((Number(wallet.vestingShares) || 0) + vests, 6);
    wallet.availableVests = Math.max(0, wallet.vestingShares - (Number(wallet.delegatedVests) || 0));
    wallet.rewardHive = 0;
    wallet.rewardHbd = 0;
    wallet.rewardVests = 0;
    wallet.rewardVestingHive = 0;
    wallet.rewardHiveStr = "0.000 HIVE";
    wallet.rewardHbdStr = "0.000 HBD";
    wallet.rewardVestsStr = "0.000000 VESTS";
    wallet.hiveStr = formatChainAmount(wallet.hive, "HIVE", 3);
    wallet.hbdStr = formatChainAmount(wallet.hbd, "HBD", 3);
    const accounts = [];
    if (wallet.account) accounts.push(wallet.account);
    if (
      accountState.account &&
      accountState.account !== wallet.account &&
      accountState.user === wallet.name
    ) {
      accounts.push(accountState.account);
    }
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      account.balance = wallet.hiveStr;
      account.hbd_balance = wallet.hbdStr;
      account.vesting_shares = formatChainAmount(wallet.vestingShares, "VESTS", 6);
      account.reward_hive_balance = "0.000 HIVE";
      account.reward_hbd_balance = "0.000 HBD";
      account.reward_vesting_balance = "0.000000 VESTS";
      account.reward_vesting_hive = "0.000 HIVE";
    }
  }

  function paintWalletBalanceAmounts(wallet) {
    const rows = view.querySelectorAll(".wallet-table tr");
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i].querySelector(".wallet-label");
      const value = rows[i].querySelector(".wallet-value");
      if (!label || !value) continue;
      const name = label.textContent.trim();
      if (name === "hive") value.textContent = formatAssetNumber(wallet.hive);
      else if (name === "staked hive") value.textContent = formatAssetNumber(wallet.stakedHive);
      else if (name === "hbd") value.textContent = formatAssetNumber(wallet.hbd);
    }
  }

  function walletBalanceTableRow(label) {
    const rows = view.querySelectorAll(".wallet-table tr");
    for (let i = 0; i < rows.length; i++) {
      const name = rows[i].querySelector(".wallet-label");
      if (name && name.textContent.trim() === label) return rows[i];
    }
    return null;
  }

  function rewardBalanceRows(wallet) {
    const labels = [];
    if ((Number(wallet.rewardHive) || 0) > 0) labels.push("hive");
    if ((Number(wallet.rewardHbd) || 0) > 0) labels.push("hbd");
    if ((Number(wallet.rewardVests) || 0) > 0) labels.push("staked hive");
    const rows = [];
    for (let i = 0; i < labels.length; i++) {
      const row = walletBalanceTableRow(labels[i]);
      if (row) rows.push(row);
    }
    return rows;
  }

  let claimAnimToken = 0;

  function claimedBalanceTargets(wallet) {
    return {
      hive: roundAsset((Number(wallet.hive) || 0) + (Number(wallet.rewardHive) || 0), 3),
      hbd: roundAsset((Number(wallet.hbd) || 0) + (Number(wallet.rewardHbd) || 0), 3),
      stakedHive: roundAsset(
        (Number(wallet.stakedHive) || 0) + (Number(wallet.rewardVestingHive) || 0),
        3
      ),
    };
  }

  function countWalletBalances(from, to, ms, token) {
    const fields = [
      ["hive", from.hive, to.hive],
      ["hbd", from.hbd, to.hbd],
      ["staked hive", from.stakedHive, to.stakedHive],
    ];
    if (ms <= 0) {
      paintWalletBalanceAmounts(to);
      return;
    }
    const started = performance.now();
    function frame(now) {
      if (token !== claimAnimToken) return;
      const t = Math.min(1, (now - started) / ms);
      const eased = t === 1 ? 1 : 1 - Math.pow(1 - t, 2);
      for (let i = 0; i < fields.length; i++) {
        const fromValue = fields[i][1];
        const toValue = fields[i][2];
        if (fromValue === toValue) continue;
        const row = walletBalanceTableRow(fields[i][0]);
        const el = row && row.querySelector(".wallet-value");
        if (!el || !el.isConnected) continue;
        el.textContent = formatAssetNumber(t === 1 ? toValue : fromValue + (toValue - fromValue) * eased);
      }
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function animateClaimAwards(wallet) {
    const token = ++claimAnimToken;
    const awards = view.querySelector(".wallet-awards");
    const rows = rewardBalanceRows(wallet);
    const from = {
      hive: Number(wallet.hive) || 0,
      hbd: Number(wallet.hbd) || 0,
      stakedHive: Number(wallet.stakedHive) || 0,
    };
    const targets = claimedBalanceTargets(wallet);
    if (!awards) {
      applyClaimedRewards(wallet);
      profileState.claimPending = false;
      paintWalletBalanceAmounts(wallet);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const countMs = reduced ? 0 : 900;
    awards.remove();
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.remove("is-reward-in");
      void rows[i].offsetWidth;
      rows[i].classList.add("is-reward-in");
    }
    applyClaimedRewards(wallet);
    profileState.claimPending = false;
    countWalletBalances(from, targets, countMs, token);
    window.setTimeout(() => {
      if (token !== claimAnimToken || profileState.wallet !== wallet) return;
      for (let i = 0; i < rows.length; i++) rows[i].classList.remove("is-reward-in");
      if (accountState.account && accountState.user === wallet.name) syncOwnProfileBanner();
    }, countMs + (reduced ? 0 : 240));
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

  function walletPageHtml(wallet, own) {
    const w = wallet || {};
    const props = w.props;
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
          <div id="walletTxBody">${walletHistoryHtml(profileState.walletTx, props)}</div>
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
    const awards = view.querySelector(".wallet-awards");
    showClaimPending(awards);
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
        if (profileState.wallet !== wallet) return;
        animateClaimAwards(wallet);
      })
      .catch((err) => {
        if (profileState.author !== name) return;
        profileState.claimPending = false;
        const box = view.querySelector(".wallet-awards");
        if (box) {
          box.hidden = false;
          restoreClaimButton(box);
        }
        showError(err.message || String(err));
      });
  }

  function showClaimPending(awards) {
    const btn = awards && awards.querySelector(".wallet-claim-btn");
    if (!btn) return;
    const height = btn.getBoundingClientRect().height;
    const status = document.createElement("span");
    status.className = "wallet-claiming";
    status.setAttribute("role", "status");
    status.textContent = "claiming...";
    if (height) status.style.height = height + "px";
    btn.replaceWith(status);
  }

  function restoreClaimButton(awards) {
    const status = awards && awards.querySelector(".wallet-claiming");
    if (!status) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary btn-compact wallet-claim-btn";
    btn.textContent = "Claim";
    status.replaceWith(btn);
  }

  async function renderProfileFeed(author, page) {
    const sort = page === "comments" ? "comments" : page === "replies" ? "replies" : "posts";
    if (!profileRouteStill(author, sort)) return;
    resetFeed(sort, author);
    const emptyTitle =
      page === "comments" ? "No comments" : page === "replies" ? "No replies" : "No posts";
    const emptyDetail =
      page === "comments"
        ? "This account has not written comments yet."
        : page === "replies"
          ? "Nobody has replied to this account yet."
          : "This account has no posts yet.";
    const feedShell = `
        <div id="feedList" class="feed"></div>
        <div id="feedStatus" class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>
        <div class="feed-actions">
          <button type="button" class="btn-primary" id="moreBtn" hidden>Load more</button>
        </div>
      `;
    const section = profileSectionEl();
    if (section) section.insertAdjacentHTML("beforeend", feedShell);
    else view.insertAdjacentHTML("beforeend", feedShell);
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
          const incoming = [];
          for (const post of batch) {
            const key = `${post.author}/${post.permlink}`;
            if (feedState.seen.has(key)) continue;
            feedState.seen.add(key);
            added++;
            if (sort === "posts" && !isRootPost(post)) continue;
            if (isBlacklistedPost(post)) continue;
            incoming.push(post);
          }
          await resolveCrossPosts(incoming);
          for (let i = 0; i < incoming.length; i++) {
            if (!keepHydratedPost(incoming[i])) continue;
            feedState.items.push(incoming[i]);
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
      if (!profileRouteStill(author, sort)) return;
      hideVoteSlider();
      moreBtn.hidden = true;
      status.hidden = false;
      try {
        await loadPage();
        clearError();
      } catch (err) {
        if (!profileRouteStill(author, sort)) return;
        showError(err.message || String(err));
      }
      if (!profileRouteStill(author, sort)) return;
      paintFeedCards(list, profileCardHtml);
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
    if (profileRouteStill(author, sort)) releaseProfileSectionHold();
  }

  function profileRouteStill(name, tab) {
    const r = parseRoute();
    if (!r || r.name !== "profile") return false;
    const author = String(r.author || "")
      .replace(/^@/, "")
      .toLowerCase();
    const page = normalizeProfilePage(r.page) || "posts";
    return author === name && page === tab;
  }

  function profileSectionHtml(html) {
    const status = $("#profileSectionStatus");
    if (status) status.outerHTML = html;
    else view.insertAdjacentHTML("beforeend", html);
  }

  function profileSectionLoadingHtml() {
    return `<div class="loading-row" id="profileSectionStatus"><span class="btn-loader" aria-hidden="true"></span> Loading…</div>`;
  }

  // The banner stays when this author is already on screen. A new profile
  // still loads the account first, then the posts, comments, replies, or wallet.
  function profileBannerReady(name) {
    if (profileState.author !== name || !profileState.profile) return false;
    const banner = view.querySelector(".profile-banner");
    if (!banner || banner.classList.contains("community-banner")) return false;
    return Boolean(view.querySelector(".profile-nav"));
  }

  function paintProfileNavActive(page) {
    const nav = view.querySelector(".profile-nav");
    if (!nav) return;
    const ids = ["posts", "comments", "replies", "wallet"];
    const links = nav.querySelectorAll("a");
    for (let i = 0; i < links.length; i++) {
      links[i].classList.toggle("is-active", ids[i] === page);
    }
  }

  function clearProfileSection() {
    const nav = view.querySelector(".profile-nav");
    if (!nav) return;
    let el = nav.nextElementSibling;
    while (el) {
      const next = el.nextElementSibling;
      el.remove();
      el = next;
    }
  }

  function profileSectionEl() {
    return document.getElementById("profileSection");
  }

  function releaseProfileSectionHold() {
    const section = profileSectionEl();
    if (section) section.style.minHeight = "";
  }

  function showProfileSectionLoading() {
    let section = profileSectionEl();
    if (!section) {
      clearProfileSection();
      view.insertAdjacentHTML(
        "beforeend",
        `<div id="profileSection">${profileSectionLoadingHtml()}</div>`
      );
      return;
    }
    // Keep the old section height so a short loader does not pull the page up.
    const hold = section.offsetHeight;
    section.innerHTML = profileSectionLoadingHtml();
    if (hold > 40) section.style.minHeight = hold + "px";
  }

  async function renderProfileSection(name, tab, pageLoad) {
    if (!profileRouteStill(name, tab)) return;
    if (tab === "wallet") {
      await fillProfileWallet(name, tab, pageLoad);
      return;
    }
    const status = $("#profileSectionStatus");
    if (status && profileRouteStill(name, tab)) status.remove();
    if (!profileRouteStill(name, tab)) return;
    await renderProfileFeed(name, tab);
  }

  // A page load reuses a fresh account snapshot, or waits for the boot load.
  // Opening the wallet later refreshes that snapshot before balances paint.
  async function resolveWalletBalances(name, pageLoad) {
    if (isOwnAuthor(name)) {
      if (pageLoad) {
        if (!accountStateFresh(name)) await loadAccountResources();
      } else {
        await loadAccountResources();
      }
      if (accountStateFresh(name)) {
        return HiveApi.walletFromAccount(accountState.account, accountState.props);
      }
    }
    return HiveApi.getWallet(name);
  }

  function isMissingAccountError(err) {
    const msg = (err && err.message) || String(err || "");
    return /account does not exist|invalid account name/i.test(msg);
  }

  function showMissingProfile(msg) {
    resetProfileState();
    clearError();
    document.body.classList.remove("is-profile");
    document.title = "Not found — Crypto Space 77";
    view.innerHTML = notFoundHtml(msg || "Failed to load account.");
  }

  async function fillProfileWallet(name, tab, pageLoad) {
    let wallet = null;
    try {
      wallet = await resolveWalletBalances(name, pageLoad);
    } catch (err) {
      if (!profileRouteStill(name, tab)) return;
      showError(err.message || String(err));
    }
    if (!profileRouteStill(name, tab)) return;
    if (!wallet) {
      profileSectionHtml(
        `<div class="wallet-page"><div class="panel empty-state"><h2>Wallet unavailable</h2><p>Could not load balances for this account.</p></div></div>`
      );
      releaseProfileSectionHold();
      return;
    }
    profileState.wallet = wallet;
    profileState.walletTx = blankWalletTx();
    profileSectionHtml(walletPageHtml(wallet, isOwnAuthor(name)));
    releaseProfileSectionHold();
    await loadMoreWalletHistory();
  }

  async function renderProfile(author, page) {
    const pageLoad = initialPageLoad;
    const name = String(author || "")
      .replace(/^@/, "")
      .toLowerCase();
    if (isBlacklistedUser(name)) {
      showMissingProfile("This user was blacklisted.");
      return;
    }
    const tab = normalizeProfilePage(page) || "posts";
    const own = isOwnAuthor(name);
    if (profileBannerReady(name)) {
      profileState.page = tab;
      profileState.claimPending = false;
      claimAnimToken += 1;
      profileState.wallet = null;
      profileState.walletTx = null;
      document.title = profilePageTitle(name, tab);
      paintProfileNavActive(tab);
      showProfileSectionLoading();
      try {
        await renderProfileSection(name, tab, pageLoad);
      } catch (err) {
        if (!profileRouteStill(name, tab)) return;
        showError(err.message || String(err));
      }
      return;
    }
    if (!(own && ownAccountReady(name))) {
      view.innerHTML = `<div class="loading-row"><span class="btn-loader" aria-hidden="true"></span> Loading @${HiveMd.escapeHtml(name)}…</div>`;
    }
    try {
      let profile = null;
      let power = null;
      if (own) {
        if (!ownAccountReady(name)) {
          await loadAccountResources();
          if (!profileRouteStill(name, tab)) return;
        }
        if (ownAccountReady(name)) {
          profile = profileFromAccountState();
          power = hivePowerFromAccount(accountState.account, accountState.props);
        }
      }
      if (!profile) {
        const [bridge, hp] = await Promise.all([
          HiveApi.getProfile(name, observer()),
          HiveApi.getHivePower(name).catch(() => null),
        ]);
        if (!profileRouteStill(name, tab)) return;
        profile = bridge;
        power = hp;
      }
      if (!profile || !profile.name) {
        showMissingProfile();
        return;
      }
      setNodeLabel();
      clearError();
      profileState.author = name;
      profileState.page = tab;
      profileState.profile = profile;
      profileState.followed = profileFollowed(profile);
      profileState.pending = false;
      profileState.claimPending = false;
      claimAnimToken += 1;
      profileState.wallet = null;
      profileState.walletTx = null;
      document.title = profilePageTitle(name, tab);
      const chrome = profileBannerHtml(name, profile, power) + profileNavHtml(name, tab);
      if (!profileRouteStill(name, tab)) return;
      view.innerHTML = chrome + `<div id="profileSection">${profileSectionLoadingHtml()}</div>`;

      if (own && accountState.user === name && accountState.account) {
        HiveApi.getProfile(name, observer())
          .then((bridge) => {
            if (profileState.author !== name) return;
            applyOwnProfileSocial(bridge);
          })
          .catch(() => {});
      }

      await renderProfileSection(name, tab, pageLoad);
    } catch (err) {
      if (!profileRouteStill(name, tab)) return;
      if (isMissingAccountError(err)) {
        showMissingProfile();
        return;
      }
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
      ["created", "Latest", communityHref(name, "latest")],
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
    const tab = normalizeCommunityPage(page) || "latest";
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
        paintFeedCards(list, cardHtml);
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

  function renderAbout() {
    document.title = "About — Crypto Space 77";
    view.innerHTML = `
      <section class="about">
        <h2 class="about-title">About</h2>
        <p>Crypto Space 77 is a lightweight and modern, open-source front-end for the hive blockchain, the world's first blockchain-powered, decentralized social network. The hive blockchain is a web3 ecosystem with zero transaction fees, built for social media and dapps.</p>
        <h3>developed by</h3>
        <div class="social-links about-social">
          <a class="btn-social btn-social-red" href="${HiveMd.escapeHtml(appHref("/@vikisecrets"))}">@vikisecrets</a>
          <a class="btn-social btn-social-yellow" href="https://vikisecrets.com/">vikisecrets.com</a>
        </div>
        <h3>social</h3>
        <div class="social-links about-social">
          <a class="btn-social btn-social-gray" href="${HiveMd.escapeHtml(appHref("/@cryptospace77"))}">hive</a>
          <a class="btn-social btn-social-gray" href="https://x.com/cryptospace77x">X</a>
          <a class="btn-social btn-social-gray" href="https://instagram.com/cryptospace77com">instagram</a>
          <a class="btn-social btn-social-gray" href="https://github.com/cryptospace77">github</a>
        </div>
        <h3><a href="${HiveMd.escapeHtml(appHref("/imprint"))}">imprint</a></h3>
      </section>
    `;
  }

  function renderImprint() {
    document.title = "Imprint — Crypto Space 77";
    view.innerHTML = `
      <section class="imprint">
        <h2 class="imprint-title">Imprint</h2>
        <p>This is a local open-source web app running entirely in the user's browser. No user data is stored or processed on or by cryptospace77.com. The site does not use cookies.</p>
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

  function applyWelcome(show) {
    const flyer = $("#welcomeFlyer");
    const was = document.body.classList.contains("has-welcome");
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
  }

  function applyRouteTitle(r) {
    if (!r) return;
    if (r.name === "feed") {
      document.title = r.tag
        ? "#" + r.tag + " — Crypto Space 77"
        : r.sort === "feed"
          ? "Feed — Crypto Space 77"
          : "Crypto Space 77";
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
    } else if (r.name === "about") {
      document.title = "About — Crypto Space 77";
    } else if (r.name === "imprint") {
      document.title = "Imprint — Crypto Space 77";
    }
  }

  async function route() {
    const fromProfileNav = profileNavSwitch;
    profileNavSwitch = false;
    closeLogoMenu();
    hideVoteSlider();
    clearError();
    const r = parseRoute();
    if (r.name === "post") {
      publishNavPushed = false;
      const jumpComments =
        pendingCommentsScroll || (!HASH_ROUTING && location.hash === "#comments");
      const anchor =
        !jumpComments && !HASH_ROUTING && location.hash && location.hash.charAt(1) === "@"
          ? location.hash
          : "";
      pendingCommentsScroll = false;
      hidePublishOverlay();
      await presentPost(r.author, r.permlink, { jumpComments, anchor });
      return;
    }
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
    const key = routeKey(r);
    const sameView = Boolean(key && key === currentViewKey && view.innerHTML.trim());
    // A post opened from the feed stays up under the publish dialog. Closing
    // the dialog returns to that post instead of the feed underneath.
    const keepPost = r.name === "publish" && postLayer.open;
    if (postLayer.open && !keepPost) {
      if (sameView) syncFeedCardOnReturn();
      suspendPostLayer({ restoreScroll: sameView });
    }
    if (!keepPost) currentPost = null;
    if (r.name !== "community") resetCommunityState();
    if (r.name !== "profile") resetProfileState();
    if (r.name !== "publish") {
      document.body.classList.toggle(
        "is-profile",
        r.name === "profile" || r.name === "community"
      );
      document.body.classList.toggle("is-community", r.name === "community");
    }
    pendingCommentsScroll = false;

    if (r.name !== "publish") publishNavPushed = false;

    if (r.name === "publish") {
      const remembered = String(lastNonPublishPath || "").replace(/\/+$/, "") || "/";
      const rememberedName = parseRoute(remembered).name;
      const keepRemembered =
        remembered === "/" || rememberedName === "welcome" || rememberedName === "post";
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
    if (sameView) {
      applyRouteTitle(r);
      return;
    }

    if (!(fromProfileNav && r.name === "profile")) window.scrollTo(0, 0);
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
    if (r.name === "profile") {
      const canonical = pathForProfile(r.author, r.page);
      const here = currentPath().replace(/\/+$/, "") || "/";
      if (here !== canonical) {
        profileNavSwitch = fromProfileNav;
        navigate(appHref(canonical), true);
        return;
      }
      currentViewKey = key;
      await renderProfile(r.author, r.page);
      if (routeKey(parseRoute()) === key) currentViewKey = key;
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
    if (r.name === "about") {
      renderAbout();
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

  function updateScrollTopBtn() {
    const btn = document.getElementById("scrollTopBtn");
    if (!btn) return;
    const top = window.scrollY || window.pageYOffset || 0;
    btn.classList.toggle("is-visible", top > 320);
  }

  function scrollActiveToTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const behavior = reduce.matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, behavior });
  }

  function bindScrollTop() {
    const btn = $("#scrollTopBtn");
    if (!btn) return;
    window.addEventListener("scroll", updateScrollTopBtn, { passive: true });
    btn.addEventListener("click", scrollActiveToTop);
    updateScrollTopBtn();
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
    const logoWrap = $("#logoWrap");
    const trigger = $("#logoTrigger");
    if (!logoWrap || !trigger) return;

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !logoWrap.classList.contains("is-open");
      logoWrap.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (e) => {
      if (!logoWrap.classList.contains("is-open")) return;
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
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
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
        const reblogConfirm = e.target.closest(".reblog-confirm");
        if (reblogConfirm) {
          e.preventDefault();
          e.stopPropagation();
          onReblogConfirm(reblogConfirm);
          return;
        }
        const reblogCancel = e.target.closest(".reblog-cancel");
        if (reblogCancel) {
          e.preventDefault();
          e.stopPropagation();
          hideReblogConfirm();
          return;
        }
        if (e.target.closest(".reblog-confirm-panel")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const reblogBtn = e.target.closest(".reblog-btn");
        if (reblogBtn && inInteractiveSurface(reblogBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onReblogClick(reblogBtn);
          return;
        }
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
        if (downBtn && inInteractiveSurface(downBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onDownvoteClick(downBtn);
          return;
        }
        const countBtn = e.target.closest(".vote-count-btn");
        if (countBtn && inInteractiveSurface(countBtn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteCountClick(countBtn);
          return;
        }
        const btn = e.target.closest(".vote-btn");
        if (btn && inInteractiveSurface(btn)) {
          e.preventDefault();
          e.stopPropagation();
          onVoteClick(btn);
          return;
        }
        if (
          !e.target.closest(".vote-wrap") &&
          !e.target.closest(".vote-voters-panel") &&
          !e.target.closest(".reblog-wrap")
        ) {
          hideVoteUi();
        }
      },
      true
    );

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (openReblog) {
        hideReblogConfirm();
        return;
      }
      if (!openSlider) return;
      hideVoteSlider();
    });

    document.addEventListener("click", (e) => {
      if (!inInteractiveSurface(e.target)) return;
      const removeTag = e.target.closest("[data-remove-tag]");
      if (removeTag && inInteractiveSurface(removeTag)) {
        e.preventDefault();
        removeFavoriteTag(removeTag.getAttribute("data-remove-tag"));
        return;
      }
      const addTag = e.target.closest("[data-add-tag]");
      if (addTag && inInteractiveSurface(addTag)) {
        e.preventDefault();
        addFavoriteTag(addTag.getAttribute("data-add-tag"));
        return;
      }
      const removeCommunity = e.target.closest("[data-remove-community]");
      if (removeCommunity && inInteractiveSurface(removeCommunity)) {
        e.preventDefault();
        removeFavoriteCommunity(removeCommunity.getAttribute("data-remove-community"));
        return;
      }
      const toggleCommunity = e.target.closest("[data-toggle-community]");
      if (toggleCommunity && inInteractiveSurface(toggleCommunity)) {
        e.preventDefault();
        toggleFavoriteCommunity(
          toggleCommunity.getAttribute("data-toggle-community"),
          toggleCommunity.getAttribute("data-community-title")
        );
        return;
      }
      const subBtn = e.target.closest(".community-sub-btn");
      if (subBtn && inInteractiveSurface(subBtn)) {
        e.preventDefault();
        toggleCommunitySubscription();
        return;
      }
      const followBtn = e.target.closest(".profile-follow-btn");
      if (followBtn && inInteractiveSurface(followBtn)) {
        e.preventDefault();
        toggleProfileFollow();
        return;
      }
      const moreWallet = e.target.closest("#walletMoreBtn");
      if (moreWallet && inInteractiveSurface(moreWallet)) {
        e.preventDefault();
        loadMoreWalletHistory();
        return;
      }
      const claimBtn = e.target.closest(".wallet-claim-btn");
      if (claimBtn && inInteractiveSurface(claimBtn)) {
        e.preventDefault();
        claimProfileAwards();
        return;
      }
      const stakeBtn = e.target.closest(".wallet-stake-btn");
      if (stakeBtn && inInteractiveSurface(stakeBtn)) {
        e.preventDefault();
        openWalletOverlay(stakeBtn.getAttribute("data-wallet-op") || "");
        return;
      }
      const showMuted = e.target.closest(".show-muted");
      if (showMuted && inInteractiveSurface(showMuted)) {
        e.preventDefault();
        revealMuted(showMuted);
        return;
      }
      const postEditBtn = e.target.closest(".post-edit-btn");
      if (postEditBtn && inInteractiveSurface(postEditBtn)) {
        e.preventDefault();
        openPostEditor();
        return;
      }
      const editBtn = e.target.closest(".comment-edit-btn");
      if (editBtn && inInteractiveSurface(editBtn)) {
        e.preventDefault();
        toggleCommentEditor(editBtn);
        return;
      }
      const cancelBtn = e.target.closest(".composer-cancel");
      if (cancelBtn && inInteractiveSurface(cancelBtn)) {
        e.preventDefault();
        const comment = cancelBtn.closest(".comment");
        if (comment) closeCommentEditor(comment);
        return;
      }
      const replyBtn = e.target.closest(".comment-reply-btn");
      if (replyBtn && inInteractiveSurface(replyBtn)) {
        e.preventDefault();
        toggleReplyComposer(replyBtn);
        return;
      }
      const attachBtn = e.target.closest(".composer-attach");
      if (attachBtn && inInteractiveSurface(attachBtn)) {
        e.preventDefault();
        const composer = attachBtn.closest(".comment-composer");
        const input = composer && composer.querySelector(".composer-file");
        if (input) input.click();
        return;
      }
      const submitBtn = e.target.closest(".composer-submit");
      if (submitBtn && inInteractiveSurface(submitBtn)) {
        e.preventDefault();
        const composer = submitBtn.closest(".comment-composer");
        if (composer) submitComment(composer);
      }
    });

    document.addEventListener("submit", (e) => {
      if (!e.target || !inInteractiveSurface(e.target)) return;
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

    document.addEventListener("change", (e) => {
      const input = e.target.closest(".composer-file");
      if (!input || !inInteractiveSurface(input)) return;
      const composer = input.closest(".comment-composer");
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (composer && files.length) uploadImagesToComposer(composer, files);
    });

    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      e.preventDefault();
      submitComment(composer);
    });

    document.addEventListener("dragenter", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      composer.classList.add("is-dragover");
    });

    document.addEventListener("dragover", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer) || !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });

    document.addEventListener("dragleave", (e) => {
      const composer = e.target.closest && e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      if (e.relatedTarget && composer.contains(e.relatedTarget)) return;
      composer.classList.remove("is-dragover");
    });

    document.addEventListener("drop", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
      e.preventDefault();
      composer.classList.remove("is-dragover");
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) uploadImagesToComposer(composer, files);
      else composerStatus(composer, "Drop an image file (png, jpg, gif, webp).", true);
    });

    document.addEventListener("paste", (e) => {
      const composer = e.target.closest(".comment-composer");
      if (!composer || !inInteractiveSurface(composer)) return;
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
      const reblogHit = e.target.closest && e.target.closest(".reblog-hit");
      if (reblogHit && inInteractiveSurface(reblogHit)) {
        const fromReblog = e.relatedTarget;
        if (fromReblog && reblogHit.contains(fromReblog)) return;
        onReblogHitEnter(reblogHit);
        return;
      }
      const hit = voteHitFrom(e.target);
      if (!hit || !inInteractiveSurface(hit)) return;
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
      const panel = votersPanelNode;
      const reblogHit = e.target.closest && e.target.closest(".reblog-hit");
      if (reblogHit) {
        const toReblog = e.relatedTarget;
        if (toReblog && reblogHit.contains(toReblog)) return;
        if (toReblog && panel && panel.contains(toReblog)) return;
        scheduleHideVoters(e);
        return;
      }
      const hit = voteHitFrom(e.target);
      if (!hit) return;
      const to = e.relatedTarget;
      if (to && hit.contains(to)) return;
      if (to && panel && panel.contains(to)) return;
      scheduleHideVoters(e);
    });

    window.addEventListener("scroll", repositionOpenSlider, true);
    window.addEventListener("resize", () => {
      repositionOpenSlider();
    });

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
      if (e.target === overlay) {
        const active = document.activeElement;
        if (!active || !overlay.contains(active)) {
          closeLogin();
        }
      }
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
          const active = document.activeElement;
          if (!active || !publishOverlay.contains(active)) {
            closePublish();
          }
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
          if (e.key === " " || e.key === "Enter" || e.key === "," || e.key === "Tab") {
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
      try {
        route();
      } finally {
        initialPageLoad = false;
      }
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
