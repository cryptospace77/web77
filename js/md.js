/**
 * Hive markdown rendering, excerpts, images, and reputation helpers.
 */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function displayReputation(rep) {
    const n = Number(rep);
    if (!Number.isFinite(n) || n === 0) return 25;
    if (Math.abs(n) < 10000) return n;
    const sign = n < 0 ? -1 : 1;
    let log = Math.log10(Math.abs(n));
    log = Math.max(log - 9, 0);
    return sign * log * 9 + 25;
  }

  function parseJsonMetadata(meta) {
    if (!meta) return {};
    if (typeof meta === "object") return meta;
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }

  function extractImage(post) {
    const meta = parseJsonMetadata(post && post.json_metadata);
    const list = meta.image || meta.images || [];
    if (Array.isArray(list) && list.length && typeof list[0] === "string") {
      return list[0];
    }
    const body = String((post && post.body) || "");
    const md = firstMarkdownImageUrl(body);
    if (md) return md;
    const html = body.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (html) return html[1];
    const host = body.match(
      /https?:\/\/(?:(?:i|images)\.ecency\.com|(?:i|img|images|cdn|files|media)\.inleo\.io)\/[^\s)"']+/i
    );
    if (host) return host[0];
    const bare = body.match(
      /https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif|svg|bmp|avif)(?:\?[^\s)]*)?/i
    );
    return bare ? bare[0] : "";
  }

  function proxyImage(url, width) {
    if (!url) return "";
    if (/^data:/i.test(url)) return url;
    const w = width || 0;
    try {
      const abs = new URL(url, location.href).href;
      return `https://images.hive.blog/${w}x0/${abs}`;
    } catch {
      return url;
    }
  }

  function avatarUrl(username, size) {
    const name = String(username || "").replace(/^@/, "");
    const dim = size === "small" ? "small" : size === "large" ? "large" : "medium";
    return `https://images.hive.blog/u/${encodeURIComponent(name)}/avatar/${dim}`;
  }

  const WORLDMAPPIN_INNER =
    "!(?:worldmappin|pinmapple)\\s+(-?\\d+(?:\\.\\d+)?)\\s+lat\\s+(-?\\d+(?:\\.\\d+)?)\\s+long\\s*(.*?)\\s*d3scr";

  function stripWorldmappinSnippets(src) {
    return String(src || "")
      .replace(new RegExp("\\[\\/\\/\\]:\\s*#\\s*\\(" + WORLDMAPPIN_INNER + "\\)", "gi"), " ")
      .replace(new RegExp("<!--\\s*" + WORLDMAPPIN_INNER + "\\s*-->", "gi"), " ")
      .replace(new RegExp(WORLDMAPPIN_INNER, "gi"), " ");
  }

  function stripMarkdown(src) {
    return stripWorldmappinSnippets(src)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/[#>*_~]/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function excerpt(post, maxLen) {
    const limit = maxLen || 180;
    const raw = stripMarkdown(post && post.body);
    if (raw.length <= limit) return raw;
    return raw.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  }

  /** Extract a YouTube video id from a URL string, or empty string. */
  function youtubeIdFromUrl(url) {
    if (!url) return "";
    const s = String(url);
    const m = s.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|youtube(?:-nocookie)?\.com\/.*?[?&]v=)([\w-]{11})/i
    );
    return m ? m[1] : "";
  }

  /** Extract a tweet/status id from an x.com or twitter.com URL, or empty string. */
  function tweetIdFromUrl(url) {
    if (!url) return "";
    const m = String(url).match(
      /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:i\/web|[A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/i
    );
    return m ? m[1] : "";
  }

  /** Turn a lone ---/*** /___ line into <hr> so HTML blocks cannot swallow it. */
  function promoteThematicBreaks(s) {
    const lines = s.split("\n");
    let inFence = false;
    let fenceMark = "";
    const thematic = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/;
    const setextUnderline = /^[ \t]{0,3}-{3,}[ \t]*$/;
    for (let i = 0; i < lines.length; i++) {
      const fence = lines[i].match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const mark = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceMark = mark;
        } else if (mark === fenceMark) {
          inFence = false;
          fenceMark = "";
        }
        continue;
      }
      if (inFence) continue;
      if (!thematic.test(lines[i])) continue;
      // Setext underlines are hyphens only; *** and ___ are always <hr>.
      if (setextUnderline.test(lines[i])) {
        const prev = i > 0 ? lines[i - 1].trim() : "";
        const looksLikeSetext =
          !!prev &&
          !/[<>]/.test(prev) &&
          !/^(?:-{3,}|\*{3,}|_{3,})$/.test(prev) &&
          !/^(?:#{1,6}(?:\s|$)|[-*+]\s|\d+\.\s|>)/.test(prev);
        if (looksLikeSetext) continue;
      }
      lines[i] = "<hr>";
    }
    return lines.join("\n");
  }

  function parseAtxHeadingLine(line) {
    const m = String(line).match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
    if (!m) return null;
    const level = m[1].length;
    let text = m[2] || "";
    text = text.replace(/[ \t]+$/, "");
    text = text.replace(/[ \t]+#+$/, "");
    text = text.replace(/[ \t]+$/, "");
    return { level, text };
  }

  /** Turn ATX headings into <h1>–<h6> so HTML blocks cannot swallow them. */
  function promoteAtxHeadings(s) {
    const lines = s.split("\n");
    const out = [];
    let inFence = false;
    let fenceMark = "";
    const parseInline =
      global.marked && typeof global.marked.parseInline === "function"
        ? global.marked.parseInline.bind(global.marked)
        : null;
    for (let i = 0; i < lines.length; i++) {
      const fence = lines[i].match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const mark = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceMark = mark;
        } else if (mark === fenceMark) {
          inFence = false;
          fenceMark = "";
        }
        out.push(lines[i]);
        continue;
      }
      if (inFence) {
        out.push(lines[i]);
        continue;
      }
      const heading = parseAtxHeadingLine(lines[i]);
      if (!heading) {
        out.push(lines[i]);
        continue;
      }
      let inner = heading.text;
      if (parseInline) {
        try {
          inner = parseInline(inner);
        } catch {
          inner = escapeHtml(inner);
        }
      } else {
        inner = escapeHtml(inner);
      }
      out.push("<h" + heading.level + ">" + inner + "</h" + heading.level + ">");
      if (i + 1 < lines.length && lines[i + 1] !== "") out.push("");
    }
    return out.join("\n");
  }

  function worldmappinEmbedHtml(lat, lng, description) {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return "";
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) return "";
    const q = encodeURIComponent(latN + "," + lngN);
    const title = String(description || "").trim() || "Map";
    return (
      '<div class="embed embed-map">' +
      '<iframe src="https://maps.google.com/maps?q=' +
      q +
      '&amp;z=14&amp;output=embed" allowfullscreen loading="lazy" title="' +
      escapeHtml(title) +
      '"></iframe>' +
      "</div>"
    );
  }

  function worldmappinLine(lat, lng, desc) {
    return "!worldmappin " + lat + " lat " + lng + " long " + (desc || "") + " d3scr";
  }

  // Comments and reference definitions would not survive markdown and the
  // whitelist. A plain line does, and the embed step turns it into the map.
  function replaceWorldmappinSnippets(s) {
    const toLine = function (_full, lat, lng, desc) {
      return "\n\n" + worldmappinLine(lat, lng, desc) + "\n\n";
    };
    s = s.replace(new RegExp("\\[\\/\\/\\]:\\s*#\\s*\\(" + WORLDMAPPIN_INNER + "\\)", "gi"), toLine);
    s = s.replace(new RegExp("<!--\\s*" + WORLDMAPPIN_INNER + "\\s*-->", "gi"), toLine);
    return s;
  }

  // Bare 3Speak URLs become links so the embed step can see them. Fences and
  // inline code stay literal. A URL that is already a markdown destination,
  // including the [<img>](url) player placeholder and [0:30](url&t=30), stays.
  function linkifyBareThreeSpeak(src) {
    const s = String(src || "");
    const re =
      /(^|[\s(])(https?:\/\/(?:www\.)?(?:play\.)?3speak\.tv\/(?:watch|embed)\?v=[^)\s<]+)(?=$|[\s)<])/gim;
    let out = "";
    let i = 0;
    let chunkStart = 0;
    const fence = { inFence: false, fenceMark: "" };
    function flush(to) {
      if (to <= chunkStart) return;
      out += s.slice(chunkStart, to).replace(re, function (full, pre, url, offset, str) {
        if (pre === "(" && str.charAt(offset - 1) === "]") return full;
        return pre + "[" + url + "](" + url + ")";
      });
      chunkStart = to;
    }
    while (i < s.length) {
      const fenceEnd = skipFenceLine(s, i, fence);
      if (fenceEnd >= 0) {
        flush(i);
        out += s.slice(i, fenceEnd);
        i = fenceEnd;
        chunkStart = i;
        continue;
      }
      if (fence.inFence) {
        flush(i);
        out += s.charAt(i);
        i++;
        chunkStart = i;
        continue;
      }
      if (s.charAt(i) === "`") {
        const span = readCodeSpan(s, i);
        if (span) {
          flush(i);
          out += span.raw;
          i = span.end;
          chunkStart = i;
          continue;
        }
      }
      i++;
    }
    flush(s.length);
    return out;
  }

  function preprocessHiveMarkdown(src) {
    let s = String(src || "").replace(/\r\n/g, "\n");
    s = replaceWorldmappinSnippets(s);
    s = rewriteKnownMediaPlayers(s);
    s = promoteThematicBreaks(s);
    s = promoteAtxHeadings(s);
    // Bare image URLs on their own line → markdown image
    s = s.replace(
      /^(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?)\s*$/gim,
      "![]($1)"
    );
    // Ecency / InLeo image hosts (extension optional) on their own line
    s = s.replace(
      /^(https?:\/\/(?:(?:i|images)\.ecency\.com|(?:i|img|images|cdn|files|media)\.inleo\.io)\/[^\s]+)\s*$/gim,
      "![]($1)"
    );
    // ![alt](url "title") → <img> so HTML blocks cannot swallow it
    s = replaceMarkdownImages(s);
    // Bare YouTube URLs in markdown (never inside HTML) → links so marked turns them into <a>.
    // Query/hash only after the id; do not consume "<" or the rest of a table row.
    s = s.replace(
      /(^|[\s(])(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^)\s<]*v=[\w-]+|embed\/[\w-]+|shorts\/[\w-]+|live\/[\w-]+)(?:[?#][^)\s<]*)?|youtu\.be\/[\w-]+(?:[?#][^)\s<]*)?))(?=$|[\s)<])/gim,
      "$1[$2]($2)"
    );
    s = linkifyBareThreeSpeak(s);
    // Bare X / Twitter status URLs in markdown → links (profiles are left alone)
    s = s.replace(
      /(^|[\s(])(https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:i\/web|[A-Za-z0-9_]+)\/status(?:es)?\/\d+(?:\/(?:photo|video)\/\d+)?(?:[?#][^)\s<]*)?)(?=$|[\s)<])/gim,
      "$1[$2]($2)"
    );
    return s;
  }

  function youtubeEmbedHtml(id) {
    if (!/^[\w-]{11}$/.test(id)) return "";
    return (
      '<div class="embed">' +
      '<iframe src="https://www.youtube.com/embed/' +
      id +
      '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" title="YouTube"></iframe>' +
      "</div>"
    );
  }

  // watch stays on /watch (legacy videos). embed stays on /embed (direct uploads).
  // Both play from play.3speak.tv; the old 3speak.tv iframe host does not.
  function threeSpeakFromUrl(href) {
    const raw = unescapeHtml(String(href || "")).trim();
    if (!raw) return null;
    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "3speak.tv" && host !== "play.3speak.tv") return null;
    let path = url.pathname.toLowerCase();
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    if (path !== "/watch" && path !== "/embed") return null;
    const id = url.searchParams.get("v") || "";
    if (!/^[\w./-]{1,160}$/.test(id) || id.indexOf("..") !== -1) return null;
    return { id: id, route: path.slice(1) };
  }

  function threeSpeakEmbedHtml(id, route) {
    const safe = String(id || "");
    if (!/^[\w./-]{1,160}$/.test(safe) || safe.indexOf("..") !== -1) return "";
    const kind = route === "watch" ? "watch" : "embed";
    return (
      '<div class="embed">' +
      '<iframe src="https://play.3speak.tv/' +
      kind +
      "?v=" +
      safe +
      '&mode=iframe" allowfullscreen loading="lazy" title="3Speak"></iframe>' +
      "</div>"
    );
  }

  // Image placeholders, including 3Speak's empty <img>, and a link whose text
  // is the video URL become a player. [0:30](…&t=30) stays a timestamp link.
  function isThreeSpeakPlayerAnchor(full) {
    const m = /^<a\b[^>]*>([\s\S]*)<\/a>$/i.exec(full);
    if (!m) return false;
    const text = unescapeHtml(
      m[1]
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<br\s*\/?>/gi, "")
        .replace(/<[^>]+>/g, "")
    )
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!text) return true;
    return !!threeSpeakFromUrl(text);
  }

  function tweetEmbedHtml(id) {
    if (!/^\d{1,22}$/.test(id)) return "";
    const href = "https://x.com/i/status/" + id;
    return (
      '<div class="tweet-embed">' +
      '<blockquote class="twitter-tweet" data-theme="dark">' +
      '<a href="' +
      href +
      '">View on X</a>' +
      "</blockquote>" +
      "</div>"
    );
  }

  let twitterWidgetsQueued = false;

  function ensureTwitterWidgets() {
    if (typeof document === "undefined") return;
    const t = (global.twttr = global.twttr || {});
    t._e = t._e || [];
    if (typeof t.ready !== "function") {
      t.ready = function (f) {
        t._e.push(f);
      };
    }
    if (!document.getElementById("twitter-wjs")) {
      const script = document.createElement("script");
      script.id = "twitter-wjs";
      script.src = "https://platform.x.com/widgets.js";
      script.async = true;
      const first = document.getElementsByTagName("script")[0];
      if (first && first.parentNode) {
        first.parentNode.insertBefore(script, first);
      } else {
        (document.head || document.body || document.documentElement).appendChild(script);
      }
    }
    t.ready(function (twttr) {
      if (twttr && twttr.widgets && typeof twttr.widgets.load === "function") {
        twttr.widgets.load();
      }
    });
  }

  function queueTwitterWidgets() {
    if (twitterWidgetsQueued) return;
    twitterWidgetsQueued = true;
    const run = function () {
      twitterWidgetsQueued = false;
      ensureTwitterWidgets();
    };
    if (typeof requestAnimationFrame === "function") {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(function () {
          requestAnimationFrame(run);
        });
      } else {
        requestAnimationFrame(run);
      }
    } else {
      setTimeout(run, 0);
    }
  }

  const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#/]|$)/i;
  const IMAGE_HOST_RE =
    /^(?:(?:i|images)\.ecency\.com|(?:i|img|images|cdn|files|media)\.inleo\.io)$/i;

  function isImageUrl(url) {
    const raw = String(url || "").trim();
    if (!/^https?:\/\//i.test(raw)) return false;
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./i, "");
      if (IMAGE_HOST_RE.test(host)) return true;
      const path = decodeURIComponent(u.pathname || "");
      if (IMAGE_EXT_RE.test(path) || IMAGE_EXT_RE.test(path + "/")) return true;
    } catch {
      /* ignore invalid URL */
    }
    return IMAGE_EXT_RE.test(raw);
  }

  function unescapeMd(s) {
    return String(s || "").replace(/\\(.)/g, "$1");
  }

  function skipMdWs(s, i) {
    while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++;
    return i;
  }

  function parseMdDestination(s, i) {
    i = skipMdWs(s, i);
    if (i >= s.length) return null;
    if (s[i] === "<") {
      let j = i + 1;
      while (j < s.length && s[j] !== ">" && s[j] !== "\n") {
        if (s[j] === "\\" && j + 1 < s.length) j += 2;
        else j++;
      }
      if (s[j] !== ">") return null;
      const url = unescapeMd(s.slice(i + 1, j)).trim();
      return url ? { url, next: j + 1 } : null;
    }
    let j = i;
    let depth = 0;
    while (j < s.length) {
      const c = s[j];
      if (c === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
      if (c === "(") {
        depth++;
        j++;
        continue;
      }
      if (c === ")") {
        if (depth === 0) break;
        depth--;
        j++;
        continue;
      }
      j++;
    }
    if (j === i) return null;
    const url = unescapeMd(s.slice(i, j)).trim();
    return url ? { url, next: j } : null;
  }

  function parseMdTitle(s, i) {
    const start = skipMdWs(s, i);
    if (start >= s.length) return { title: "", next: i };
    const q = s[start];
    if (q !== '"' && q !== "'" && q !== "(") return { title: "", next: i };
    const close = q === "(" ? ")" : q;
    let j = start + 1;
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        j += 2;
        continue;
      }
      if (s[j] === close) {
        return { title: unescapeMd(s.slice(start + 1, j)), next: j + 1 };
      }
      if (s[j] === "\n") return { title: "", next: i };
      j++;
    }
    return { title: "", next: i };
  }

  function parseMarkdownImageAt(s, i) {
    if (s.charAt(i) !== "!" || s.charAt(i + 1) !== "[") return null;
    let j = i + 2;
    let alt = "";
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        alt += s[j + 1];
        j += 2;
        continue;
      }
      if (s[j] === "]") break;
      if (s[j] === "\n") return null;
      alt += s[j];
      j++;
    }
    if (s.charAt(j) !== "]") return null;
    j++;
    if (s.charAt(j) !== "(") return null;
    j++;
    const dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    const title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return { alt, url: dest.url, title: title.title, start: i, end: j + 1 };
  }

  function parseLinkedMarkdownImageAt(s, i) {
    if (s.charAt(i) !== "[") return null;
    const img = parseMarkdownImageAt(s, i + 1);
    if (!img) return null;
    if (s.charAt(img.end) !== "]") return null;
    let j = img.end + 1;
    if (s.charAt(j) !== "(") return null;
    j++;
    const dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    const title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return {
      alt: img.alt,
      url: img.url,
      title: img.title,
      href: dest.url,
      start: i,
      end: j + 1,
    };
  }

  function firstMarkdownImageUrl(src) {
    const s = String(src || "");
    let i = 0;
    while (i < s.length) {
      const at = s.indexOf("![", i);
      if (at < 0) return "";
      const img = parseMarkdownImageAt(s, at);
      if (img) return img.url;
      i = at + 2;
    }
    return "";
  }

  function imageHtml(url, alt, title) {
    if (!isSafePostUrl(url, "src")) return "";
    let html =
      '<img src="' +
      escapeHtml(url) +
      '" alt="' +
      escapeHtml(alt || "") +
      '"';
    if (title) html += ' title="' + escapeHtml(title) + '"';
    html += ">";
    return html;
  }

  function linkedImageHtml(href, url, alt, title) {
    const img = imageHtml(url, alt, title);
    if (!img) return "";
    if (!isSafePostUrl(href, "href")) return img;
    return '<a href="' + escapeHtml(href) + '">' + img + "</a>";
  }

  function parseMarkdownLinkAt(s, i) {
    if (s.charAt(i) !== "[") return null;
    if (i > 0 && s.charAt(i - 1) === "!") return null;
    if (s.charAt(i + 1) === "!" && s.charAt(i + 2) === "[") return null;
    let j = i + 1;
    let text = "";
    while (j < s.length) {
      if (s[j] === "\\" && j + 1 < s.length) {
        text += s[j + 1];
        j += 2;
        continue;
      }
      if (s[j] === "]") break;
      if (s[j] === "\n") return null;
      text += s[j];
      j++;
    }
    if (s.charAt(j) !== "]") return null;
    j++;
    if (s.charAt(j) !== "(") return null;
    j++;
    const dest = parseMdDestination(s, j);
    if (!dest) return null;
    j = dest.next;
    const title = parseMdTitle(s, j);
    j = title.next;
    j = skipMdWs(s, j);
    if (s.charAt(j) !== ")") return null;
    return { text, url: dest.url, title: title.title, start: i, end: j + 1 };
  }

  function linkHtml(href, text, title) {
    const label = escapeHtml(text);
    if (!isSafePostUrl(href, "href")) return label;
    let html = '<a href="' + escapeHtml(href) + '"';
    if (title) html += ' title="' + escapeHtml(title) + '"';
    html += ">" + label + "</a>";
    return html;
  }

  function leftoverMarkdownLinkHtml(text, href, title) {
    if (isImageUrl(href) && (!String(text).trim() || String(text).trim() === href)) {
      return imageHtml(href, "") || escapeHtml(text);
    }
    return linkHtml(href, text, title);
  }

  function replaceMarkdownLinks(src) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "<") {
        const skipTag = s.slice(i).match(/^<(pre|code|script|style|a)\b/i);
        if (skipTag) {
          const close = new RegExp("</" + skipTag[1] + "\\s*>", "i");
          const rest = s.slice(i);
          const m = rest.search(close);
          if (m < 0) {
            out += rest;
            break;
          }
          const end = m + rest.slice(m).match(close)[0].length;
          out += rest.slice(0, end);
          i += end;
          continue;
        }
      }
      const link = parseMarkdownLinkAt(s, i);
      if (link) {
        const html = leftoverMarkdownLinkHtml(link.text, link.url, link.title);
        if (html) {
          out += html;
          i = link.end;
          continue;
        }
      }
      out += s[i];
      i++;
    }
    return out;
  }

  function replaceMarkdownImages(src) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    let inFence = false;
    let fenceMark = "";
    while (i < s.length) {
      if (i === 0 || s[i - 1] === "\n") {
        const nl = s.indexOf("\n", i);
        const line = nl < 0 ? s.slice(i) : s.slice(i, nl);
        const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
        if (fence) {
          const mark = fence[1][0];
          if (!inFence) {
            inFence = true;
            fenceMark = mark;
          } else if (mark === fenceMark) {
            inFence = false;
            fenceMark = "";
          }
          out += nl < 0 ? line : line + "\n";
          i = nl < 0 ? s.length : nl + 1;
          continue;
        }
      }
      if (inFence) {
        out += s[i];
        i++;
        continue;
      }
      if (s[i] === "<") {
        const skipTag = s.slice(i).match(/^<(pre|code|script)\b/i);
        if (skipTag) {
          const close = new RegExp("</" + skipTag[1] + "\\s*>", "i");
          const rest = s.slice(i);
          const m = rest.search(close);
          if (m < 0) {
            out += rest;
            break;
          }
          const end = m + rest.slice(m).match(close)[0].length;
          out += rest.slice(0, end);
          i += end;
          continue;
        }
      }
      if (s[i] === "`") {
        let n = 0;
        while (s[i + n] === "`") n++;
        let j = i + n;
        let closed = false;
        while (j < s.length) {
          if (s[j] !== "`") {
            j++;
            continue;
          }
          let k = 0;
          while (s[j + k] === "`") k++;
          if (k === n) {
            out += s.slice(i, j + k);
            i = j + k;
            closed = true;
            break;
          }
          j += k;
        }
        if (!closed) {
          out += s.slice(i);
          break;
        }
        continue;
      }
      const linked = parseLinkedMarkdownImageAt(s, i);
      if (linked) {
        out += linkedImageHtml(linked.href, linked.url, linked.alt, linked.title);
        i = linked.end;
        continue;
      }
      const img = parseMarkdownImageAt(s, i);
      if (img) {
        out += imageHtml(img.url, img.alt, img.title);
        i = img.end;
        continue;
      }
      out += s[i];
      i++;
    }
    return out;
  }

  function embedFromHref(href) {
    const id = youtubeIdFromUrl(href);
    if (id) return youtubeEmbedHtml(id);
    const tweetId = tweetIdFromUrl(href);
    if (tweetId) return tweetEmbedHtml(tweetId);
    return "";
  }

  function embedWorldmappin(html) {
    const re = new RegExp("(?:<p>\\s*)?" + WORLDMAPPIN_INNER + "(?:\\s*</p>)?", "gi");
    return String(html || "").replace(re, function (_full, lat, lng, desc) {
      const embed = worldmappinEmbedHtml(lat, lng, unescapeHtml(desc));
      return embed || _full;
    });
  }

  function embedImages(html) {
    // Bare image URLs left in text (e.g. <center>https://i.ecency.com/…</center>).
    // Skip quoted attributes and markdown/HTML destinations: ](url) href="url".
    html = String(html || "").replace(
      /(^|[\s>])(https?:\/\/[^\s<)"']+)/gi,
      function (full, pre, raw) {
        const trimmed = raw.replace(/[.,;:!?]+$/, "");
        if (!isImageUrl(trimmed)) return full;
        const trail = raw.slice(trimmed.length);
        return pre + imageHtml(trimmed, "") + trail;
      }
    );

    return html;
  }

  // Code, pre, and other raw blocks keep their text. A 3Speak URL in a fence
  // must not become a player after markdown has wrapped it in <code>.
  function replaceOutsideRawHtml(html, re, fn) {
    const raw = /<(pre|code|script|style|textarea|kbd|samp)\b[^>]*>[\s\S]*?<\/\1>/gi;
    const src = String(html || "");
    let out = "";
    let last = 0;
    let m;
    while ((m = raw.exec(src))) {
      out += src.slice(last, m.index).replace(re, fn);
      out += m[0];
      last = m.index + m[0].length;
    }
    out += src.slice(last).replace(re, fn);
    return out;
  }

  function embedMedia(html) {
    html = embedWorldmappin(html);
    html = embedImages(html);

    // Linked YouTube / 3Speak / X URLs → our player. The href was already
    // checked by the whitelist. A 3Speak timestamp citation stays a link.
    html = html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, (full, href) => {
      const decoded = unescapeHtml(href);
      const speak = threeSpeakFromUrl(decoded);
      if (speak) {
        if (!isThreeSpeakPlayerAnchor(full)) return full;
        return threeSpeakEmbedHtml(speak.id, speak.route) || full;
      }
      return embedFromHref(decoded) || full;
    });

    // Bare YouTube URLs in HTML text (e.g. <th>https://youtube.com/shorts/…</th>).
    // Skip quoted attributes so iframe src= is not rewritten.
    html = html.replace(
      /(^|[^"'=])(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^<\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})[^<\s]*)/gi,
      (full, pre, _url, id) => {
        const embed = youtubeEmbedHtml(id);
        return embed ? pre + embed : full;
      }
    );

    html = replaceOutsideRawHtml(
      html,
      /(^|[^"'=])(https?:\/\/(?:www\.)?(?:play\.)?3speak\.tv\/(?:watch|embed)\?[^\s<)"']+)/gi,
      (full, pre, raw) => {
        const trimmed = raw.replace(/[.,;:!?]+$/, "");
        const info = threeSpeakFromUrl(trimmed);
        if (!info) return full;
        const embed = threeSpeakEmbedHtml(info.id, info.route);
        return embed ? pre + embed + raw.slice(trimmed.length) : full;
      }
    );

    html = html.replace(
      /(^|[^"'=])(https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:i\/web|[A-Za-z0-9_]+)\/status(?:es)?\/(\d+)[^<\s]*)/gi,
      (full, pre, _url, id) => {
        const embed = tweetEmbedHtml(id);
        return embed ? pre + embed : full;
      }
    );

    return html;
  }

  function localAppPrefix() {
    if (global.__CS77_HASH__) return "#/";
    const base = global.__CS77_BASE__ || "/";
    return base === "/" ? "/" : String(base).replace(/\/+$/, "") + "/";
  }

  function localizeHiveLinks(html) {
    const prefix = localAppPrefix();
    html = html.replace(
      /https?:\/\/(?:www\.)?(?:peakd\.com|hive\.blog|ecency\.com)\/(?:[^"'/\s]+\/)?@([a-z0-9.\-]+)\/([a-zA-Z0-9\-\._]+)/gi,
      prefix + "@$1/$2"
    );
    return html.replace(
      /https?:\/\/(?:www\.)?(?:peakd\.com|hive\.blog|ecency\.com)\/@([a-z0-9.\-]{3,16})\/?(?=[?#"'<\s]|$)/gi,
      prefix + "@$1"
    );
  }

  function isMentionBoundary(ch) {
    if (!ch) return true;
    return !/[a-zA-Z0-9@＠/]/.test(ch);
  }

  // Hive tags are 2–24 chars: a letter, then letters, digits, or hyphens, ending alnum.
  // Also refuse a match glued to another word, an entity, or a second hash.
  function isTagBoundary(ch) {
    if (!ch) return true;
    return !/[a-zA-Z0-9_#＃&@＠/]/.test(ch);
  }

  function tagContinues(ch) {
    if (!ch) return false;
    if (/[a-zA-Z0-9_-]/.test(ch)) return true;
    return /\p{L}|\p{N}/u.test(ch);
  }

  function mentionHtml(at, name) {
    const user = String(name || "").toLowerCase();
    return (
      '<a class="mention" href="' +
      escapeHtml(localAppPrefix() + "@" + user) +
      '">' +
      at +
      escapeHtml(name) +
      "</a>"
    );
  }

  function tagHtml(hash, name) {
    const tag = String(name || "").toLowerCase();
    const community = /^hive-(\d+)$/.exec(tag);
    const path = community ? "subspace/" + community[1] : "space/" + tag;
    return (
      '<a class="hashtag" href="' +
      escapeHtml(localAppPrefix() + path) +
      '">' +
      hash +
      escapeHtml(name) +
      "</a>"
    );
  }

  /** Turn bare @username mentions and #tags into local links. Skip HTML tags and existing links. */
  function linkifyMentionsTags(html) {
    const s = String(html || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "<") {
        const skipTag = s.slice(i).match(/^<(a|code|pre|script|style|textarea|kbd|samp)\b/i);
        if (skipTag) {
          const close = new RegExp("</" + skipTag[1] + "\\s*>", "i");
          const rest = s.slice(i);
          const m = rest.search(close);
          if (m < 0) {
            out += rest;
            break;
          }
          const end = m + rest.slice(m).match(close)[0].length;
          out += rest.slice(0, end);
          i += end;
          continue;
        }
        const gt = s.indexOf(">", i + 1);
        if (gt < 0) {
          out += s.slice(i);
          break;
        }
        out += s.slice(i, gt + 1);
        i = gt + 1;
        continue;
      }
      const at = s[i];
      if ((at === "@" || at === "＠") && isMentionBoundary(s[i - 1])) {
        const m = s.slice(i + 1).match(/^([a-z][a-z0-9.\-]*[a-z0-9])/i);
        if (m && m[1].length >= 3 && m[1].length <= 16) {
          out += mentionHtml(at, m[1]);
          i += 1 + m[1].length;
          continue;
        }
      }
      if ((at === "#" || at === "＃") && isTagBoundary(s[i - 1])) {
        const m = s.slice(i + 1).match(/^([a-z][a-z0-9-]{0,22}[a-z0-9])/i);
        if (m && !tagContinues(s[i + 1 + m[1].length])) {
          out += tagHtml(at, m[1]);
          i += 1 + m[1].length;
          continue;
        }
      }
      out += s[i];
      i++;
    }
    return out;
  }

  // Presentational tags and the text containers Hive posts use the same way.
  // CommonMark treats many of these as raw HTML and does not parse inside them.
  const STYLING_HTML_TAGS = new Set(
    (
      "center div span font p blockquote figure figcaption " +
      "h1 h2 h3 h4 h5 h6 td th caption li dt dd " +
      "section article header footer aside address details summary " +
      "b i u s strike big small sup sub mark tt em strong del ins cite abbr q"
    ).split(" ")
  );

  // Tags whose element, once opened at the start of a line, swallows following markdown.
  const HTML_BLOCK_TAGS = new Set(
    (
      "address article aside blockquote caption center dd details dialog div dl dt " +
      "fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav " +
      "ol p pre section script style summary table tbody td textarea tfoot th thead tr ul"
    ).split(" ")
  );

  const SKIP_MARKDOWN_TAGS = new Set(["pre", "code", "script", "style", "textarea"]);
  const VOID_HTML_TAGS = new Set([
    "hr",
    "br",
    "img",
    "source",
    "col",
    "link",
    "meta",
    "input",
    "wbr",
    "area",
    "base",
    "embed",
    "param",
    "track",
  ]);

  function parseHtmlTagAt(s, i) {
    if (s.charAt(i) !== "<") return null;
    if (s.startsWith("<!--", i) || s.startsWith("<!", i) || s.startsWith("<?", i)) return null;
    let j = i + 1;
    let closing = false;
    if (s.charAt(j) === "/") {
      closing = true;
      j++;
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(j));
    if (!nameMatch) return null;
    const name = nameMatch[0];
    j += name.length;
    let quote = "";
    let selfClosing = false;
    for (; j < s.length; j++) {
      const ch = s.charAt(j);
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "/" && s.charAt(j + 1) === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      if (ch === ">") {
        j++;
        break;
      }
    }
    if (quote || s.charAt(j - 1) !== ">") return null;
    return {
      name: name,
      raw: s.slice(i, j),
      end: j,
      closing: closing,
      selfClosing: selfClosing || VOID_HTML_TAGS.has(name.toLowerCase()),
    };
  }

  function findCloseTag(s, from, name) {
    let depth = 1;
    let i = from;
    const want = name.toLowerCase();
    while (i < s.length) {
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        i = end < 0 ? s.length : end + 3;
        continue;
      }
      if (s.charAt(i) !== "<") {
        i++;
        continue;
      }
      const tag = parseHtmlTagAt(s, i);
      if (!tag) {
        i++;
        continue;
      }
      if (!tag.selfClosing && tag.name.toLowerCase() === want) {
        if (tag.closing) {
          depth--;
          if (depth === 0) return { start: i, end: tag.end, raw: tag.raw };
        } else {
          depth++;
        }
      }
      i = tag.end;
    }
    return null;
  }

  function readCodeSpan(s, i) {
    let n = 0;
    while (s.charAt(i + n) === "`") n++;
    if (!n) return null;
    let j = i + n;
    while (j < s.length) {
      if (s.charAt(j) === "\n") return null;
      if (s.charAt(j) !== "`") {
        j++;
        continue;
      }
      let k = 0;
      while (s.charAt(j + k) === "`") k++;
      if (k === n) return { raw: s.slice(i, j + k), end: j + k };
      j += k;
    }
    return null;
  }

  function skipFenceLine(s, i, state) {
    if (!(i === 0 || s.charAt(i - 1) === "\n")) return -1;
    const nl = s.indexOf("\n", i);
    const line = nl < 0 ? s.slice(i) : s.slice(i, nl);
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence) return -1;
    const mark = fence[1][0];
    if (!state.inFence) {
      state.inFence = true;
      state.fenceMark = mark;
    } else if (mark === state.fenceMark) {
      state.inFence = false;
      state.fenceMark = "";
    } else {
      return -1;
    }
    return nl < 0 ? s.length : nl + 1;
  }

  function markdownSignalText(s) {
    return String(s)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?[A-Za-z][^>\n]*>/g, " ");
  }

  function looksLikeMarkdown(s) {
    const text = markdownSignalText(s);
    if (/[*_~`\[!]/.test(text)) return true;
    // A bare URL is an autolink. Inside <sup> and other styling tags, marked
    // would otherwise leave it as text.
    if (/https?:\/\//i.test(text)) return true;
    if (/<[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) return true;
    if (/^#{1,6}(?:\s|$)/m.test(text)) return true;
    if (/^[ \t]{0,3}(?:>|[-+*](?:\s|$)|\d+\.\s)/m.test(text)) return true;
    if (/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m.test(text)) return true;
    return false;
  }

  function parseWithMarked(src) {
    ensureMarked();
    const parse =
      global.marked &&
      (typeof global.marked.parse === "function"
        ? global.marked.parse.bind(global.marked)
        : typeof global.marked === "function"
          ? global.marked
          : null);
    if (!parse) return null;
    try {
      return parse(src);
    } catch {
      return null;
    }
  }

  function unwrapSingleParagraph(html) {
    const m = /^<p>([\s\S]*)<\/p>\n?$/.exec(html);
    if (!m || /<\/p>/i.test(m[1])) return html;
    return m[1];
  }

  function renderTextSegment(src) {
    if (!src || !looksLikeMarkdown(src)) return src;
    const html = parseWithMarked(src);
    if (html == null) return src;
    return unwrapSingleParagraph(html);
  }

  // Parse markdown that sits beside HTML blocks. A block element on a line would
  // otherwise swallow the rest of that line, including a sibling *italic*.
  function parseMarkdownAroundHtmlBlocks(src) {
    const s = String(src || "");
    if (!looksLikeMarkdown(s)) return s;
    const parts = [];
    let i = 0;
    let textStart = 0;
    const fence = { inFence: false, fenceMark: "" };
    while (i < s.length) {
      const fenceEnd = skipFenceLine(s, i, fence);
      if (fenceEnd >= 0) {
        i = fenceEnd;
        continue;
      }
      if (fence.inFence) {
        i++;
        continue;
      }
      if (s.charAt(i) === "`") {
        const span = readCodeSpan(s, i);
        if (span) {
          i = span.end;
          continue;
        }
      }
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        i = end < 0 ? s.length : end + 3;
        continue;
      }
      if (s.charAt(i) !== "<") {
        i++;
        continue;
      }
      const tag = parseHtmlTagAt(s, i);
      if (!tag || tag.closing || !HTML_BLOCK_TAGS.has(tag.name.toLowerCase())) {
        i = tag && !tag.closing ? tag.end : i + 1;
        continue;
      }
      let end = tag.end;
      if (!tag.selfClosing) {
        const close = findCloseTag(s, tag.end, tag.name);
        if (!close) {
          i = tag.end;
          continue;
        }
        end = close.end;
      }
      if (i > textStart) parts.push(s.slice(textStart, i));
      parts.push({ html: s.slice(i, end) });
      i = end;
      textStart = end;
    }
    if (!parts.length) return renderTextSegment(s);
    if (textStart < s.length) parts.push(s.slice(textStart));
    let out = "";
    for (let n = 0; n < parts.length; n++) {
      const part = parts[n];
      out += typeof part === "string" ? renderTextSegment(part) : part.html;
    }
    return out;
  }

  function renderMarkdownInStylingTags(src) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    const fence = { inFence: false, fenceMark: "" };
    while (i < s.length) {
      const fenceEnd = skipFenceLine(s, i, fence);
      if (fenceEnd >= 0) {
        out += s.slice(i, fenceEnd);
        i = fenceEnd;
        continue;
      }
      if (fence.inFence) {
        out += s.charAt(i);
        i++;
        continue;
      }
      if (s.charAt(i) === "`") {
        const span = readCodeSpan(s, i);
        if (span) {
          out += span.raw;
          i = span.end;
          continue;
        }
      }
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        const to = end < 0 ? s.length : end + 3;
        out += s.slice(i, to);
        i = to;
        continue;
      }
      if (s.charAt(i) === "<") {
        const tag = parseHtmlTagAt(s, i);
        if (tag && !tag.closing && !tag.selfClosing) {
          const name = tag.name.toLowerCase();
          if (SKIP_MARKDOWN_TAGS.has(name)) {
            const close = findCloseTag(s, tag.end, tag.name);
            if (close) {
              out += s.slice(i, close.end);
              i = close.end;
              continue;
            }
          } else if (STYLING_HTML_TAGS.has(name)) {
            const close = findCloseTag(s, tag.end, tag.name);
            if (close) {
              let inner = s.slice(tag.end, close.start);
              inner = renderMarkdownInStylingTags(inner);
              inner = parseMarkdownAroundHtmlBlocks(inner);
              out += tag.raw + inner + close.raw;
              i = close.end;
              continue;
            }
          }
        }
        if (tag) {
          out += tag.raw;
          i = tag.end;
          continue;
        }
      }
      out += s.charAt(i);
      i++;
    }
    return out;
  }

  let markedReady = false;

  function ensureMarked() {
    if (markedReady || !global.marked) return;
    if (typeof global.marked.use === "function") {
      global.marked.use({ gfm: true, breaks: true });
    } else if (typeof global.marked.setOptions === "function") {
      global.marked.setOptions({ gfm: true, breaks: true });
    }
    markedReady = true;
  }

  // .post-body / .comment-body use overflow:hidden, which clips a table
  // whose min-content is wider than the column. A scroll box keeps that
  // width bounded so the table can move sideways instead of being cut off.
  function wrapWideTables(html) {
    const src = String(html || "");
    const re = /<\/?table\b[^>]*>/gi;
    let out = "";
    let last = 0;
    let depth = 0;
    let start = -1;
    let m;
    while ((m = re.exec(src))) {
      const isClose = m[0].charAt(1) === "/";
      if (!isClose) {
        if (depth === 0) start = m.index;
        depth++;
      } else if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out += src.slice(last, start);
          out += '<div class="md-table-scroll">';
          out += src.slice(start, re.lastIndex);
          out += "</div>";
          last = re.lastIndex;
          start = -1;
        }
      }
    }
    if (depth !== 0) return src;
    return out + src.slice(last);
  }

  // Posts and comments: explicit element and attribute whitelist.
  // script, style, iframe, object, embed, svg, math, font, and article never pass.
  // style, class, color, and bgcolor never pass. id is kept so authors can
  // link to anchors in the post, including when that id matches an element
  // elsewhere on the page.
  const POST_ALLOWED_TAGS = [
    "a", "abbr", "address", "aside", "audio", "b", "blockquote", "br",
    "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "details",
    "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "mark",
    "ol", "p", "pre", "q", "s", "samp", "section", "small", "source", "span",
    "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
    "th", "thead", "time", "tr", "track", "u", "ul", "var", "video", "wbr",
  ];

  const POST_ALLOWED_ATTR = [
    "id", "title", "dir", "lang", "href", "rel", "target", "name", "cite",
    "src", "alt", "width", "height", "loading", "align", "valign", "colspan",
    "rowspan", "span", "headers", "scope", "border", "cellpadding", "cellspacing",
    "start", "reversed", "type", "value", "datetime", "controls", "poster",
    "preload", "loop", "muted", "playsinline", "open", "kind", "srclang", "label",
  ];

  const POST_SANITIZE_CONFIG = {
    ALLOWED_TAGS: POST_ALLOWED_TAGS,
    ALLOWED_ATTR: POST_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    // Keep author ids even when they match a document property or another
    // element on the page. Anchors inside the post should still work.
    SANITIZE_DOM: false,
    KEEP_CONTENT: true,
    FORBID_TAGS: [
      "script", "style", "iframe", "object", "embed", "applet", "frame",
      "frameset", "base", "link", "meta", "form", "input", "button", "textarea",
      "select", "option", "svg", "math", "noscript", "template", "noembed",
      "noframes", "canvas", "font", "article",
    ],
    FORBID_ATTR: [
      "style", "class", "srcset", "srcdoc", "formaction", "xlink:href",
      "color", "bgcolor", "face", "size",
    ],
    FORBID_CONTENTS: [
      "script", "style", "iframe", "object", "embed", "noscript", "noembed",
      "noframes", "svg", "math", "template",
    ],
  };

  const SRC_TAGS = { img: 1, video: 1, audio: 1, source: 1, track: 1 };
  const MEASURE_TAGS = {
    img: 1, video: 1, audio: 1, td: 1, th: 1, table: 1, col: 1, colgroup: 1,
  };
  const ALIGN_TAGS = {
    img: 1, p: 1, div: 1, td: 1, th: 1, tr: 1, table: 1, caption: 1, h1: 1,
    h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, col: 1,
  };
  const REL_OK = { noopener: 1, noreferrer: 1, nofollow: 1, ugc: 1, external: 1 };

  function isSafeAnchorId(value) {
    const v = String(value || "");
    if (!v || v.length > 200) return false;
    return !/[\u0000-\u0020\u007F"'<>&=]/.test(v);
  }

  function isSafeMeasure(value) {
    return /^\d{1,4}(?:\.\d+)?(?:%|px)?$/.test(String(value || "").trim());
  }

  function isSafeInt(value, max) {
    const v = String(value || "").trim();
    if (!/^\d{1,4}$/.test(v)) return false;
    return Number(v) <= max;
  }

  // http(s) for images and media. Links may also be mailto, a fragment, or a
  // same-document path. javascript:, data:, and protocol-relative URLs are not.
  function isSafePostUrl(value, kind) {
    const v = String(value == null ? "" : value).trim();
    if (!v || /[\u0000-\u001F\u007F]/.test(v)) return false;
    if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch (err) {
        return false;
      }
    }
    if (kind === "src" || kind === "poster") return false;
    if (/^mailto:/i.test(v)) return kind === "href";
    if (v.charAt(0) === "#") return true;
    if (v.slice(0, 2) === "//" || v.slice(0, 2) === "/\\" || v.charAt(0) === "\\") return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
    return true;
  }

  function keepPostAttribute(tag, attr, value, data) {
    switch (attr) {
      case "href":
        return tag === "a" && isSafePostUrl(value, "href");
      case "cite":
        return (
          (tag === "blockquote" || tag === "q" || tag === "del" || tag === "ins") &&
          isSafePostUrl(value, "href")
        );
      case "rel": {
        if (tag !== "a") return false;
        const kept = String(value || "")
          .split(/\s+/)
          .filter(function (part) {
            return REL_OK[part.toLowerCase()];
          });
        if (!kept.length) return false;
        data.attrValue = kept.join(" ");
        return true;
      }
      case "target": {
        if (tag !== "a") return false;
        const target = String(value || "").toLowerCase();
        if (target !== "_blank" && target !== "_self") return false;
        data.attrValue = target;
        return true;
      }
      case "name":
        return tag === "a" && isSafeAnchorId(value);
      case "src":
        return !!SRC_TAGS[tag] && isSafePostUrl(value, "src");
      case "poster":
        return tag === "video" && isSafePostUrl(value, "poster");
      case "alt":
        return tag === "img";
      case "width":
      case "height":
        return !!MEASURE_TAGS[tag] && isSafeMeasure(value);
      case "loading":
        return (tag === "img" || tag === "video") && /^(?:lazy|eager)$/i.test(value);
      case "align":
        return !!ALIGN_TAGS[tag] && /^(?:left|right|center|justify)$/i.test(String(value).trim());
      case "valign":
        return (
          (tag === "td" || tag === "th" || tag === "tr") &&
          /^(?:top|middle|bottom|baseline)$/i.test(String(value).trim())
        );
      case "colspan":
      case "rowspan":
        return (tag === "td" || tag === "th") && isSafeInt(value, 100);
      case "span":
        return (tag === "col" || tag === "colgroup") && isSafeInt(value, 100);
      case "border":
        return (tag === "table" || tag === "img") && isSafeInt(value, 50);
      case "cellpadding":
      case "cellspacing":
        return tag === "table" && isSafeInt(value, 50);
      case "start":
        return tag === "ol" && /^-?\d{1,6}$/.test(String(value).trim());
      case "reversed":
        return tag === "ol";
      case "type":
        if (tag === "ol") return /^[1aAiI]$/.test(String(value).trim());
        if (tag === "source" || tag === "track") {
          return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(value).trim());
        }
        return false;
      case "value":
        return tag === "li" && /^-?\d{1,6}$/.test(String(value).trim());
      case "datetime":
        return tag === "time" && /^[\dT:Z.+-]{1,40}$/.test(String(value).trim());
      case "controls":
      case "loop":
      case "muted":
      case "playsinline":
        return tag === "video" || tag === "audio";
      case "preload":
        return (tag === "video" || tag === "audio") && /^(?:none|metadata|auto)$/i.test(String(value).trim());
      case "open":
        return tag === "details";
      case "headers":
        if (tag !== "td" && tag !== "th") return false;
        return String(value || "")
          .split(/\s+/)
          .every(isSafeAnchorId);
      case "scope":
        return (tag === "td" || tag === "th") && /^(?:col|row|colgroup|rowgroup)$/i.test(String(value).trim());
      case "kind":
        return (
          tag === "track" &&
          /^(?:subtitles|captions|descriptions|chapters|metadata)$/i.test(String(value).trim())
        );
      case "srclang":
        return tag === "track" && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})?$/i.test(String(value).trim());
      case "label":
        return tag === "track" && String(value || "").length <= 200;
      default:
        return false;
    }
  }

  let postSanitizeHooksReady = false;

  function ensurePostSanitizeHooks() {
    if (postSanitizeHooksReady || !global.DOMPurify || typeof global.DOMPurify.addHook !== "function") {
      return;
    }
    global.DOMPurify.addHook("uponSanitizeAttribute", function (node, data) {
      const attr = data.attrName;
      const tag = node && node.nodeName ? String(node.nodeName).toLowerCase() : "";
      if (
        !attr ||
        attr === "style" ||
        attr === "class" ||
        attr === "color" ||
        attr === "bgcolor" ||
        attr === "face" ||
        attr === "size" ||
        attr.indexOf("on") === 0 ||
        attr === "srcset" ||
        attr === "srcdoc"
      ) {
        data.keepAttr = false;
        return;
      }
      if (attr === "id") {
        if (!isSafeAnchorId(data.attrValue)) data.keepAttr = false;
        return;
      }
      if (attr === "title") return;
      if (attr === "dir") {
        const dir = String(data.attrValue || "").toLowerCase();
        if (dir !== "ltr" && dir !== "rtl" && dir !== "auto") data.keepAttr = false;
        else data.attrValue = dir;
        return;
      }
      if (attr === "lang") {
        if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(String(data.attrValue || "").trim())) {
          data.keepAttr = false;
        }
        return;
      }
      if (!keepPostAttribute(tag, attr, data.attrValue, data)) data.keepAttr = false;
    });
    global.DOMPurify.addHook("afterSanitizeAttributes", function (node) {
      if (!node || !node.getAttribute) return;
      const tag = node.nodeName;
      if (tag === "IMG" || tag === "SOURCE" || tag === "TRACK") {
        if (!isSafePostUrl(node.getAttribute("src"), "src")) node.remove();
        return;
      }
      if (tag === "VIDEO" || tag === "AUDIO") {
        const src = node.getAttribute("src");
        if (src && !isSafePostUrl(src, "src")) node.removeAttribute("src");
        const poster = node.getAttribute("poster");
        if (poster && !isSafePostUrl(poster, "poster")) node.removeAttribute("poster");
        return;
      }
      if (tag === "A" && (node.getAttribute("target") || "").toLowerCase() === "_blank") {
        const parts = (node.getAttribute("rel") || "").split(/\s+/).filter(Boolean);
        if (parts.indexOf("noopener") < 0) parts.push("noopener");
        if (parts.indexOf("noreferrer") < 0) parts.push("noreferrer");
        node.setAttribute("rel", parts.join(" "));
      }
    });
    postSanitizeHooksReady = true;
  }

  function unescapeHtml(s) {
    return String(s || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function htmlAttr(raw, name) {
    const re = new RegExp(
      "\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i"
    );
    const match = re.exec(raw);
    if (!match) return "";
    return unescapeHtml(match[1] || match[2] || match[3] || "").trim();
  }

  // A pasted player becomes a plain watch URL so the whitelist does not
  // throw the address away with the iframe. The embed step builds our player.
  function plainMediaUrl(raw) {
    let src = htmlAttr(raw, "src") || htmlAttr(raw, "data");
    if (!src || /[\u0000-\u001F\u007F]/.test(src)) return "";
    if (src.slice(0, 2) === "//") src = "https:" + src;
    let url;
    try {
      url = new URL(src);
    } catch (err) {
      return "";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (
      host === "youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be"
    ) {
      const id = youtubeIdFromUrl(src);
      return id ? "https://www.youtube.com/watch?v=" + id : "";
    }
    if (host === "3speak.tv" || host === "play.3speak.tv") {
      const info = threeSpeakFromUrl(url.href);
      return info ? "https://play.3speak.tv/" + info.route + "?v=" + info.id : "";
    }
    return "";
  }

  const RAW_SKIP_TAGS = new Set(["pre", "code", "script", "style", "textarea"]);

  // Keep a YouTube or 3Speak address that an author pasted as a player.
  // Fences, inline code, and code blocks stay untouched.
  function rewriteKnownMediaPlayers(src) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    const fence = { inFence: false, fenceMark: "" };
    while (i < s.length) {
      const fenceEnd = skipFenceLine(s, i, fence);
      if (fenceEnd >= 0) {
        out += s.slice(i, fenceEnd);
        i = fenceEnd;
        continue;
      }
      if (fence.inFence) {
        out += s.charAt(i);
        i++;
        continue;
      }
      if (s.charAt(i) === "`") {
        const span = readCodeSpan(s, i);
        if (span) {
          out += span.raw;
          i = span.end;
          continue;
        }
      }
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        const to = end < 0 ? s.length : end + 3;
        out += s.slice(i, to);
        i = to;
        continue;
      }
      if (s.charAt(i) !== "<") {
        out += s.charAt(i);
        i++;
        continue;
      }
      const tag = parseHtmlTagAt(s, i);
      if (!tag) {
        out += s.charAt(i);
        i++;
        continue;
      }
      const name = tag.name.toLowerCase();
      if (!tag.closing && !tag.selfClosing && RAW_SKIP_TAGS.has(name)) {
        const close = findCloseTag(s, tag.end, tag.name);
        if (close) {
          out += s.slice(i, close.end);
          i = close.end;
          continue;
        }
      }
      if (!tag.closing && (name === "iframe" || name === "object" || name === "embed")) {
        const media = plainMediaUrl(tag.raw);
        if (media) {
          out += "\n\n" + media + "\n\n";
          if (!tag.selfClosing) {
            const close = findCloseTag(s, tag.end, tag.name);
            i = close ? close.end : tag.end;
          } else {
            i = tag.end;
          }
          continue;
        }
      }
      out += tag.raw;
      i = tag.end;
    }
    return out;
  }

  function sanitizePostHtml(html) {
    if (!global.DOMPurify || typeof global.DOMPurify.sanitize !== "function") return String(html || "");
    ensurePostSanitizeHooks();
    try {
      return global.DOMPurify.sanitize(String(html || ""), POST_SANITIZE_CONFIG);
    } catch (err) {
      return "";
    }
  }

  function renderMarkdown(src) {
    ensureMarked();
    const prepared = renderMarkdownInStylingTags(
      preprocessHiveMarkdown(String(src || "").replace(/\r\n/g, "\n"))
    );
    let html;
    try {
      const parse =
        global.marked &&
        (typeof global.marked.parse === "function"
          ? global.marked.parse.bind(global.marked)
          : typeof global.marked === "function"
            ? global.marked
            : null);
      if (parse) {
        html = parse(prepared);
      } else {
        html = `<p>${escapeHtml(prepared).replace(/\n/g, "<br>")}</p>`;
      }
    } catch {
      html = `<p>${escapeHtml(prepared).replace(/\n/g, "<br>")}</p>`;
    }

    // Leftover markdown inside HTML blocks becomes tags, then the whitelist
    // sees the whole post. Embeds, mentions, and tags are added after that.
    html = replaceMarkdownImages(html);
    html = replaceMarkdownLinks(html);
    html = sanitizePostHtml(html);
    html = embedMedia(html);
    html = localizeHiveLinks(html);
    html = linkifyMentionsTags(html);
    html = wrapWideTables(html);
    if (html.indexOf("twitter-tweet") !== -1) queueTwitterWidgets();
    return html;
  }

  global.HiveMd = {
    escapeHtml,
    displayReputation,
    parseJsonMetadata,
    extractImage,
    proxyImage,
    avatarUrl,
    excerpt,
    renderMarkdown,
  };
})(window);
