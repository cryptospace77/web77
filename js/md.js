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
      /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|youtube\.com\/.*?[?&]v=)([\w-]{11})/i
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

  function replaceWorldmappinSnippets(s) {
    const replaceInner = function (_full, lat, lng, desc) {
      const html = worldmappinEmbedHtml(lat, lng, desc);
      return html ? "\n\n" + html + "\n\n" : "";
    };
    s = s.replace(new RegExp("\\[\\/\\/\\]:\\s*#\\s*\\(" + WORLDMAPPIN_INNER + "\\)", "gi"), replaceInner);
    s = s.replace(new RegExp("<!--\\s*" + WORLDMAPPIN_INNER + "\\s*-->", "gi"), replaceInner);
    s = s.replace(new RegExp("(^|\\n)[ \\t]*" + WORLDMAPPIN_INNER + "[ \\t]*(?=\\n|$)", "gi"), function (
      _full,
      pre,
      lat,
      lng,
      desc
    ) {
      const html = worldmappinEmbedHtml(lat, lng, desc);
      return html ? pre + "\n\n" + html + "\n\n" : pre;
    });
    return s;
  }

  function preprocessHiveMarkdown(src) {
    let s = String(src || "").replace(/\r\n/g, "\n");
    s = replaceWorldmappinSnippets(s);
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
    // Bare 3Speak URLs in markdown → links
    s = s.replace(
      /(^|[\s(])(https?:\/\/(?:www\.)?3speak\.tv\/watch\?v=[^)\s<]+)(?=$|[\s)<])/gim,
      "$1[$2]($2)"
    );
    // Bare X / Twitter status URLs in markdown → links (profiles are left alone)
    s = s.replace(
      /(^|[\s(])(https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:i\/web|[A-Za-z0-9_]+)\/status(?:es)?\/\d+(?:\/(?:photo|video)\/\d+)?(?:[?#][^)\s<]*)?)(?=$|[\s)<])/gim,
      "$1[$2]($2)"
    );
    return s;
  }

  function youtubeEmbedHtml(id) {
    return (
      '<div class="embed">' +
      '<iframe src="https://www.youtube.com/embed/' +
      id +
      '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" title="YouTube"></iframe>' +
      "</div>"
    );
  }

  function threeSpeakEmbedHtml(id) {
    return (
      '<div class="embed">' +
      '<iframe src="https://3speak.tv/embed?v=' +
      id +
      '" allowfullscreen loading="lazy" title="3Speak"></iframe>' +
      "</div>"
    );
  }

  function tweetEmbedHtml(id) {
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
    return '<a href="' + escapeHtml(href) + '">' + imageHtml(url, alt, title) + "</a>";
  }

  function isSafeHref(url) {
    const u = String(url || "").trim();
    if (!u) return false;
    if (/^(?:https?:|mailto:)/i.test(u)) return true;
    if (/^#/.test(u) || (/^\//.test(u) && !/^\/\//.test(u))) return true;
    if (/^\/\//.test(u)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(u);
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
    let html = '<a href="' + escapeHtml(href) + '"';
    if (title) html += ' title="' + escapeHtml(title) + '"';
    html += ">" + escapeHtml(text) + "</a>";
    return html;
  }

  function leftoverMarkdownLinkHtml(text, href, title) {
    const embed = embedFromHref(href);
    if (embed) return embed;
    if (isImageUrl(href) && (!String(text).trim() || String(text).trim() === href)) {
      return imageHtml(href, "");
    }
    if (!isSafeHref(href)) return "";
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
    const m3 = String(href || "").match(/3speak\.tv\/watch\?v=([^"&\s<]+)/i);
    if (m3) return threeSpeakEmbedHtml(m3[1]);
    const tweetId = tweetIdFromUrl(href);
    if (tweetId) return tweetEmbedHtml(tweetId);
    return "";
  }

  function embedImages(html) {
    html = replaceMarkdownImages(html);

    // Bare image URLs in HTML text (e.g. <center>https://i.ecency.com/…</center>).
    // Skip quoted attributes and markdown/HTML destinations: ](url) href="url".
    html = html.replace(
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

  function embedMedia(html) {
    html = embedImages(html);

    // Markdown [text](url) left intact inside HTML blocks (after images, <center>, …)
    html = replaceMarkdownLinks(html);

    // Linked YouTube / 3Speak URLs → responsive iframe
    html = html.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, (full, href) => {
      return embedFromHref(href) || full;
    });

    // Bare YouTube URLs in HTML text (e.g. <th>https://youtube.com/shorts/…</th>).
    // Skip quoted attributes so iframe src= is not rewritten.
    html = html.replace(
      /(^|[^"'=])(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^<\s]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})[^<\s]*)/gi,
      (full, pre, _url, id) => pre + youtubeEmbedHtml(id)
    );

    html = html.replace(
      /(^|[^"'=])(https?:\/\/(?:www\.)?3speak\.tv\/watch\?v=([^"&\s<]+))/gi,
      (full, pre, _url, id) => pre + threeSpeakEmbedHtml(id)
    );

    html = html.replace(
      /(^|[^"'=])(https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:i\/web|[A-Za-z0-9_]+)\/status(?:es)?\/(\d+)[^<\s]*)/gi,
      (full, pre, _url, id) => pre + tweetEmbedHtml(id)
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

  function renderMarkdown(src) {
    ensureMarked();
    const prepared = preprocessHiveMarkdown(src);
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

    html = embedMedia(html);
    html = localizeHiveLinks(html);
    html = linkifyMentionsTags(html);

    if (global.DOMPurify) {
      html = global.DOMPurify.sanitize(html, {
        ADD_TAGS: ["iframe", "center", "video", "source", "figure", "figcaption"],
        ADD_ATTR: [
          "allow",
          "allowfullscreen",
          "frameborder",
          "src",
          "target",
          "rel",
          "loading",
          "title",
        ],
      });
    }
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
