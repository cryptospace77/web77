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

  const EXCERPT_ABBREV = {
    mr: 1, mrs: 1, ms: 1, mz: 1, dr: 1, prof: 1, sr: 1, jr: 1, vs: 1,
    etc: 1, eg: 1, ie: 1, st: 1, fig: 1, al: 1, ed: 1, vol: 1,
    pp: 1, ca: 1, approx: 1, dept: 1, inc: 1, ltd: 1, co: 1,
  };

  function decodeHtmlEntities(src) {
    return String(src || "").replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, function (full, body) {
      if (body.charAt(0) === "#") {
        const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
        const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!cp || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return full;
        if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) return "";
        const ch = String.fromCodePoint(cp);
        if (/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/.test(ch)) return " ";
        return ch;
      }
      const named = {
        amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
        nbsp: " ", ensp: " ", emsp: " ", emspc: " ",
        emsp13: " ", emsp14: " ", numsp: " ", puncsp: " ", thinsp: " ", hairsp: " ",
        hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
        bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
      };
      const ch = named[body.toLowerCase()];
      return ch == null ? full : ch;
    });
  }

  function stripFencedCode(src) {
    const lines = String(src || "").split("\n");
    const out = [];
    let inFence = false;
    let mark = "";
    let len = 0;
    for (let i = 0; i < lines.length; i++) {
      const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (open) {
        const ch = open[1].charAt(0);
        if (!inFence) {
          inFence = true;
          mark = ch;
          len = open[1].length;
          continue;
        }
        if (ch === mark && open[1].length >= len) {
          inFence = false;
          mark = "";
          len = 0;
          continue;
        }
      }
      if (!inFence) out.push(lines[i]);
    }
    return out.join("\n");
  }

  function stripHtml(src) {
    let s = String(src || "");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    s = s.replace(/<(https?:\/\/[^>\s]+)>/gi, "$1");
    s = s.replace(
      /<(script|style|iframe|object|embed|svg|math|noscript|template|textarea|noembed|noframes|canvas|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );
    s = s.replace(
      /<(script|style|iframe|object|embed|svg|math|noscript|template|textarea|noembed|noframes|canvas|form)\b[^>]*\/?>/gi,
      " "
    );
    s = s.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, "\n");
    s = s.replace(/<img\b[^>]*>/gi, " ");
    s = s.replace(/<hr\b[^>]*\/?>/gi, "\n");
    s = s.replace(/<br\b[^>]*\/?>/gi, "\n");
    s = s.replace(/<\/(p|h[1-6]|blockquote|ul|ol|table|pre|figure|address)>/gi, "\n\n");
    s = s.replace(/<\/(div|li|tr|section|header|footer|center|caption|figcaption|article)>/gi, "\n");
    s = s.replace(/<\/t[dh]>/gi, " ");
    s = s.replace(/<\/?[a-z][a-z0-9:-]*\b[^>]*>/gi, "");
    return decodeHtmlEntities(s);
  }

  // Punctuation and an unmatched closer stay in the excerpt. The address does not.
  function excerptUrlTrail(raw) {
    let url = String(raw || "");
    let trail = "";
    while (url) {
      const parts = splitPlainUrl(url);
      if (parts.url !== url) {
        trail = parts.trail + trail;
        url = parts.url;
        continue;
      }
      const ch = url.charAt(url.length - 1);
      let peel = false;
      if (ch === "]" || ch === "}") {
        const open = ch === "]" ? "[" : "{";
        let opens = 0;
        let closes = 0;
        for (let k = 0; k < url.length; k++) {
          const c = url.charAt(k);
          if (c === open) opens++;
          else if (c === ch) closes++;
        }
        peel = closes > opens;
      } else if (ch === '"' || ch === "'" || ch === "”" || ch === "’") {
        peel = true;
      }
      if (!peel) break;
      trail = ch + trail;
      url = url.slice(0, -1);
    }
    return trail;
  }

  function tidyExcerptGaps(src, preserve) {
    let out = String(src || "");
    out = out.replace(/\(\s*\)/g, "");
    out = out.replace(/\[\s*\]/g, "");
    out = out.replace(/\{\s*\}/g, "");
    out = out.replace(/(?:["“”]){2}/g, "");
    out = out.replace(/(?:['’]){2}/g, "");
    out = out.replace(/[ \t]{2,}/g, " ");
    out = out.replace(/[ \t]+([.,;:!?])/g, "$1");
    out = out.replace(/[ \t]*\n[ \t]*/g, "\n");
    if (preserve) out = out.replace(/\n{3,}/g, "\n\n");
    else out = out.replace(/\n{2,}/g, "\n");
    return out.trim();
  }

  // Bare http(s) addresses are not excerpt text. Drop them before measuring maxLen.
  function stripPlainUrls(src, preserve) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      const match = /https?:\/\/[^\s<]+/i.exec(s.slice(i));
      if (!match) {
        out += s.slice(i);
        break;
      }
      const at = i + match.index;
      if (at > 0 && /[A-Za-z0-9@＠/]/.test(s.charAt(at - 1))) {
        out += s.slice(i, at + match[0].length);
        i = at + match[0].length;
        continue;
      }
      out += s.slice(i, at);
      out += excerptUrlTrail(match[0]);
      i = at + match[0].length;
    }
    return tidyExcerptGaps(out, preserve);
  }

  function mapOutsideUrls(src, fn) {
    const s = String(src || "");
    const re = /https?:\/\/[^\s<]+/gi;
    let out = "";
    let last = 0;
    let match;
    while ((match = re.exec(s))) {
      out += fn(s.slice(last, match.index));
      out += match[0];
      last = match.index + match[0].length;
    }
    out += fn(s.slice(last));
    return out;
  }

  function stripEmphasisMarkers(src) {
    return mapOutsideUrls(src, function (chunk) {
      let out = chunk;
      for (let n = 0; n < 4; n++) {
        const next = out
          .replace(/~~([^~\n]+)~~/g, "$1")
          .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
          .replace(/___([^_\n]+)___/g, "$1")
          .replace(/\*\*([^*\n]+)\*\*/g, "$1")
          .replace(/__([^_\n]+)__/g, "$1")
          .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
          .replace(/(^|[^\w_])_([^_\n]+)_(?!_)/g, "$1$2");
        if (next === out) {
          out = next;
          break;
        }
        out = next;
      }
      return out.replace(/\*\*|__|~~/g, "");
    });
  }

  function stripInlineMarkdown(src) {
    const s = String(src || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === "!" && s.charAt(i + 1) === "[") {
        const img = parseMarkdownImageAt(s, i);
        if (img) {
          i = img.end;
          continue;
        }
      }
      if (s.charAt(i) === "[") {
        const linked = parseLinkedMarkdownImageAt(s, i);
        if (linked) {
          i = linked.end;
          continue;
        }
        const link = parseMarkdownLinkAt(s, i);
        if (link) {
          const label = String(link.text || "").trim();
          if (label) out += label;
          i = link.end;
          continue;
        }
      }
      if (s.charAt(i) === "`") {
        let n = 0;
        while (s.charAt(i + n) === "`") n++;
        const fence = "`".repeat(n);
        const close = s.indexOf(fence, i + n);
        if (close > i) {
          out += s.slice(i + n, close);
          i = close + n;
          continue;
        }
      }
      if (s.charAt(i) === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(s.charAt(i + 1))) {
        out += s.charAt(i + 1);
        i += 2;
        continue;
      }
      out += s.charAt(i);
      i++;
    }
    out = out.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
    out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
    out = out.replace(/\[\^[^\]]+\]/g, "");
    return stripEmphasisMarkers(out);
  }

  function isMdTableDelimiter(line) {
    let t = String(line || "").trim();
    if (!t || t.indexOf("|") < 0) return false;
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    const cells = t.split("|");
    if (!cells.length) return false;
    for (let i = 0; i < cells.length; i++) {
      if (!/^\s*:?-+\:?\s*$/.test(cells[i])) return false;
    }
    return true;
  }

  function isMdTableRow(line) {
    const t = String(line || "").trim();
    if (!t || t.indexOf("|") < 0) return false;
    return !isMdTableDelimiter(t);
  }

  function formatMdTableRow(line) {
    let t = String(line || "").trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    const cells = t.split("|").map(function (cell) {
      return stripInlineMarkdown(cell).replace(/\s+/g, " ").trim();
    });
    return cells.join(" ").replace(/[ \t]{2,}/g, " ").trim();
  }

  function isThematicBreakLine(line) {
    return /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(line);
  }

  function isSetextUnderline(line) {
    return /^[ \t]{0,3}(?:={3,}|-{3,})[ \t]*$/.test(line);
  }

  function looksLikeSetextText(line) {
    const prev = String(line || "").trim();
    if (!prev) return false;
    if (/[<>]/.test(prev)) return false;
    if (/^(?:-{3,}|\*{3,}|_{3,}|={3,})$/.test(prev)) return false;
    if (/^(?:#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d{1,9}[.)][ \t]|>)/.test(prev)) return false;
    return true;
  }

  function renderInlineLine(raw) {
    let content = String(raw || "");
    content = content.replace(/^(?:[ \t]{0,3}>[ \t]*)+/, "");
    content = content.replace(/^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/, "");
    return stripInlineMarkdown(content).replace(/[ \t]+/g, " ").trim();
  }

  function excerptBreakRank(kind) {
    if (kind === "para") return 3;
    if (kind === "sep") return 2;
    return 1;
  }

  function cleanExcerptPiece(part, preserve) {
    const lines = String(part.text || "")
      .split("\n")
      .map(function (line) {
        return line.replace(/[ \t]+/g, " ").trim();
      })
      .filter(Boolean);
    if (!lines.length) return "";
    if (part.rows || preserve) return lines.join("\n");
    return lines.join(" ");
  }

  function excerptSeparator(brk, preserve, prevRows, nextRows) {
    if (prevRows || nextRows) {
      if (preserve && brk === "para") return "\n\n";
      return "\n";
    }
    if (!preserve) return " ";
    if (brk === "para") return "\n\n";
    return "\n";
  }

  function joinExcerptParts(parts, preserve) {
    const items = [];
    let brk = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.break) {
        if (items.length && (!brk || excerptBreakRank(part.break) > excerptBreakRank(brk))) brk = part.break;
        continue;
      }
      const text = cleanExcerptPiece(part, preserve);
      if (!text) continue;
      if (items.length) {
        const prev = items[items.length - 1];
        items.push({
          text: excerptSeparator(brk, preserve, prev.rows, !!part.rows),
          rows: false,
        });
      }
      items.push({ text: text, rows: !!part.rows });
      brk = "";
    }
    let out = "";
    for (let i = 0; i < items.length; i++) out += items[i].text;
    out = out.replace(/[ \t]*\n[ \t]*/g, "\n");
    if (preserve) out = out.replace(/\n{3,}/g, "\n\n");
    else out = out.replace(/[ \t]{2,}/g, " ");
    return out.replace(/[ \t]{2,}/g, " ").trim();
  }

  function stripMarkdownBlocks(src, preserve) {
    const lines = String(src || "").split("\n");
    const parts = [];
    let buf = [];

    function flushBuf() {
      if (!buf.length) return;
      const text = buf
        .map(renderInlineLine)
        .filter(Boolean)
        .join("\n");
      buf = [];
      if (text.trim()) parts.push({ text: text });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        flushBuf();
        parts.push({ break: "para" });
        continue;
      }
      if (/^[ \t]{0,3}\[[^\]]+\]:[ \t]+\S/.test(line)) continue;
      if (isMdTableRow(line) && i + 1 < lines.length && isMdTableDelimiter(lines[i + 1])) {
        flushBuf();
        const rows = [];
        const header = formatMdTableRow(line);
        if (header) rows.push(header);
        i += 2;
        while (i < lines.length && isMdTableRow(lines[i])) {
          const row = formatMdTableRow(lines[i]);
          if (row) rows.push(row);
          i++;
        }
        i--;
        if (rows.length) parts.push({ text: rows.join("\n"), rows: true });
        parts.push({ break: "para" });
        continue;
      }
      if (isSetextUnderline(trimmed) && buf.length && buf.every(looksLikeSetextText)) {
        const heading = buf.map(renderInlineLine).filter(Boolean).join(preserve ? "\n" : " ");
        buf = [];
        if (heading) parts.push({ text: heading });
        parts.push({ break: "para" });
        continue;
      }
      if (isThematicBreakLine(line) || isSetextUnderline(trimmed)) {
        flushBuf();
        parts.push({ break: "sep" });
        continue;
      }
      const heading = parseAtxHeadingLine(line);
      if (heading) {
        flushBuf();
        const text = stripInlineMarkdown(heading.text).replace(/\s+/g, " ").trim();
        if (text) parts.push({ text: text });
        parts.push({ break: "para" });
        continue;
      }
      buf.push(line);
    }
    flushBuf();
    return joinExcerptParts(parts, preserve);
  }

  function stripMarkdown(src, preserveLineBreaks) {
    let text = String(src || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    text = stripWorldmappinSnippets(text);
    text = stripFencedCode(text);
    return stripMarkdownBlocks(text, !!preserveLineBreaks);
  }

  function sanitizeExcerptText(src) {
    // Tags are already gone. Drop controls, then linkify escapes the rest.
    return String(src || "")
      .replace(/\r/g, "")
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }

  function isDecimalDot(s, i) {
    return /\d/.test(s.charAt(i - 1)) && /\d/.test(s.charAt(i + 1));
  }

  function isAbbreviationDot(s, i) {
    let j = i - 1;
    while (j >= 0 && /[A-Za-z]/.test(s.charAt(j))) j--;
    const word = s.slice(j + 1, i);
    if (!word) return false;
    if (word.length === 1) return true;
    if (word.toLowerCase() === "no") {
      let k = i + 1;
      while (k < s.length && /\s/.test(s.charAt(k))) k++;
      return /\d/.test(s.charAt(k));
    }
    return !!EXCERPT_ABBREV[word.toLowerCase()];
  }

  function firstSentenceEnd(text) {
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…" && ch !== "。" && ch !== "！" && ch !== "？") {
        continue;
      }
      if ((ch === "." || ch === "!" || ch === "?") && /[.!?]/.test(s.charAt(i + 1))) continue;
      if (ch === "." && (isDecimalDot(s, i) || isAbbreviationDot(s, i))) continue;
      let end = i + 1;
      while (end < s.length && /['"”’)\]]/.test(s.charAt(end))) end++;
      if (/[。！？…]/.test(ch) || end >= s.length || /\s/.test(s.charAt(end))) return end;
    }
    return -1;
  }

  // maxLen is the length of the returned text. The ellipsis is one of those characters.
  // A word that ends inside the budget stays. A word cut in half is left off.
  function clipExcerpt(text, maxLen, firstSentence) {
    const limit = Number(maxLen) > 0 ? Math.floor(Number(maxLen)) : 180;
    const src = String(text || "").replace(/^\s+/, "");
    if (!src || limit < 1) return "";
    if (firstSentence) {
      const sentence = firstSentenceEnd(src);
      if (sentence > 0 && sentence <= limit) {
        return src.slice(0, sentence).replace(/[ \t]+$/, "");
      }
    }
    if (src.length <= limit) return src.replace(/\s+$/, "");
    const budget = limit - 1;
    if (budget <= 0) return "…";
    let end = budget;
    if (end < src.length) {
      const lead = src.charCodeAt(end - 1);
      const tail = src.charCodeAt(end);
      if (lead >= 0xd800 && lead <= 0xdbff && tail >= 0xdc00 && tail <= 0xdfff) end -= 1;
    }
    let slice = end > 0 ? src.slice(0, end) : "";
    const next = src.charAt(end);
    const last = slice.charAt(slice.length - 1);
    if (slice && next && !/\s/.test(next) && !/\s/.test(last)) {
      const trimmed = slice.replace(/\s+\S*$/, "");
      if (trimmed.trim()) slice = trimmed;
    }
    slice = slice.replace(/[\s\u00a0]+$/, "");
    if (!slice) return "…";
    return slice + "…";
  }

  function excerptLineLimit(value) {
    const n = Math.floor(Number(value));
    return n > 0 ? n : 0;
  }

  function excerptMode(preserveLineBreaks, firstSentence, compactNewlines, maxLines) {
    if (preserveLineBreaks && typeof preserveLineBreaks === "object") {
      return {
        preserveLineBreaks: !!preserveLineBreaks.preserveLineBreaks,
        firstSentence: !!(preserveLineBreaks.firstSentence || preserveLineBreaks.sentence),
        compactNewlines: !!preserveLineBreaks.compactNewlines,
        maxLines: excerptLineLimit(preserveLineBreaks.maxLines),
      };
    }
    return {
      preserveLineBreaks: !!preserveLineBreaks,
      firstSentence: !!firstSentence,
      compactNewlines: !!compactNewlines,
      maxLines: excerptLineLimit(maxLines),
    };
  }

  // Keep the first maxLines output lines. A later line adds the ellipsis.
  function clipExcerptLines(text, maxLines) {
    const limit = excerptLineLimit(maxLines);
    const src = String(text || "");
    if (!src || !limit) return src;
    const lines = src.split("\n");
    if (lines.length <= limit) return src;
    const kept = lines.slice(0, limit).join("\n").replace(/[ \t\u00a0]+$/, "");
    if (!kept) return "…";
    if (kept.charAt(kept.length - 1) === "…") return kept;
    return kept + "…";
  }

  function linkifyUsernames(text) {
    const s = String(text || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      const at = s.charAt(i);
      if ((at === "@" || at === "＠") && isMentionBoundary(s.charAt(i - 1))) {
        const mention = /^([a-z][a-z0-9.\-]*[a-z0-9])/i.exec(s.slice(i + 1));
        if (mention && mention[1].length >= 3 && mention[1].length <= 16) {
          out += mentionHtml(at, mention[1]);
          i += 1 + mention[1].length;
          continue;
        }
      }
      out += escapeHtml(s.charAt(i));
      i++;
    }
    return out;
  }

  // Strip markdown, then HTML, then plain URLs. maxLen counts that text.
  // maxLines counts newline-separated output lines and abbreviates after that.
  // The ellipsis counts. Only @usernames become links.
  // compactNewlines folds every break into one line when preserveLineBreaks is on.
  function excerpt(post, maxLen, preserveLineBreaks, firstSentence, compactNewlines, maxLines) {
    const opts = excerptMode(preserveLineBreaks, firstSentence, compactNewlines, maxLines);
    let text = stripMarkdown(post && post.body, opts.preserveLineBreaks);
    text = stripHtml(text);
    text = stripPlainUrls(text, opts.preserveLineBreaks);
    text = sanitizeExcerptText(text);
    if (opts.preserveLineBreaks && opts.compactNewlines) text = text.replace(/\n{2,}/g, "\n");
    text = clipExcerptLines(text, opts.maxLines);
    return linkifyUsernames(clipExcerpt(text, maxLen, opts.firstSentence));
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
    const parseInline = global.marked?.parseInline || null;
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

  // A line of nothing but tags. Quote-aware, so a ">" inside an attribute
  // does not end the tag early.
  function isOpaqueHtmlLine(line) {
    let i = 0;
    let sawTag = false;
    while (i < line.length) {
      const ch = line.charAt(i);
      if (ch === " " || ch === "\t") {
        i++;
        continue;
      }
      if (line.startsWith("<!--", i)) {
        const end = line.indexOf("-->", i + 4);
        if (end < 0) return false;
        sawTag = true;
        i = end + 3;
        continue;
      }
      if (ch !== "<") return false;
      const tag = parseHtmlTagAt(line, i);
      if (!tag) return false;
      sawTag = true;
      i = tag.end;
    }
    return sawTag;
  }

  // <img> on its own line, or a line whose only content is an image wrapped
  // in presentational tags such as <center> or <a>.
  function isImageBlockLine(line) {
    return /<img\b/i.test(line) && isOpaqueHtmlLine(line);
  }

  function renderSwallowedMarkdown(text) {
    const styled = renderMarkdownInStylingTags(text);
    const html = renderTextSegment(styled);
    const trimmed = unwrapSingleParagraph(String(html).replace(/^\n+|\n+$/g, ""));
    return trimmed || text;
  }

  // CommonMark treats a line that is only an <img> as an HTML block and keeps
  // every following line, up to a blank line, as raw HTML. *caption* under a
  // photo then stays literal asterisks. Parse that swallowed markdown first
  // so the italics are already <em> when the block is copied through.
  function revealMarkdownAfterImages(src) {
    const lines = String(src || "").split("\n");
    const out = [];
    const fence = { inFence: false, fenceMark: "" };
    let rawSkip = "";
    let i = 0;

    function inRawRegion(line) {
      if (fence.inFence) {
        const end = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
        if (end && end[1][0] === fence.fenceMark) {
          fence.inFence = false;
          fence.fenceMark = "";
        }
        return true;
      }
      const start = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (start) {
        fence.inFence = true;
        fence.fenceMark = start[1][0];
        return true;
      }
      if (rawSkip) {
        if (new RegExp("</" + rawSkip + "\\s*>", "i").test(line)) rawSkip = "";
        return true;
      }
      const rawOpen = /^[ \t]{0,3}<(pre|script|style|textarea)\b/i.exec(line);
      if (rawOpen && !new RegExp("</" + rawOpen[1] + "\\s*>", "i").test(line)) {
        rawSkip = rawOpen[1];
        return true;
      }
      return false;
    }

    while (i < lines.length) {
      const line = lines[i];
      if (inRawRegion(line) || !isImageBlockLine(line)) {
        out.push(line);
        i++;
        continue;
      }
      out.push(line);
      i++;
      const bucket = [];
      while (i < lines.length && lines[i].trim() !== "") {
        const next = lines[i];
        if (
          !fence.inFence &&
          !rawSkip &&
          (/^[ \t]{0,3}(`{3,}|~{3,})/.test(next) ||
            /^[ \t]{0,3}<(pre|script|style|textarea)\b/i.test(next))
        ) {
          break;
        }
        bucket.push(next);
        i++;
      }
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const text = run.join("\n");
        run = [];
        out.push(looksLikeMarkdown(text) ? renderSwallowedMarkdown(text) : text);
      };
      for (let n = 0; n < bucket.length; n++) {
        const part = bucket[n];
        if (isImageBlockLine(part) || isOpaqueHtmlLine(part)) {
          flush();
          out.push(part);
        } else {
          run.push(part);
        }
      }
      flush();
    }
    return out.join("\n");
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
    // ![alt](url "title") → <img> so HTML blocks cannot swallow the image.
    // Bare media URLs stay plain text. embedMedia turns those into players,
    // and the last step links whatever URL text is left. A markdown link
    // such as [source](url) is not wrapped again.
    s = replaceMarkdownImages(s);
    s = revealMarkdownAfterImages(s);
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

  function tweetEmbedHtml(id) {
    if (!/^\d{1,22}$/.test(id)) return "";
    const href = "https://x.com/i/status/" + id;
    return (
      '<div class="tweet-embed">' +
      '<blockquote class="twitter-tweet" data-theme="dark" data-align="center">' +
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
    // A markdown link stays a link, including when the href is an image or a
    // media URL. Own-line plain image URLs are already markdown images.
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

  function embedWorldmappin(html) {
    const re = new RegExp("(?:<p>\\s*)?" + WORLDMAPPIN_INNER + "(?:\\s*</p>)?", "gi");
    return String(html || "").replace(re, function (_full, lat, lng, desc) {
      const embed = worldmappinEmbedHtml(lat, lng, unescapeHtml(desc));
      return embed || _full;
    });
  }

  // Walk rendered HTML text. Tags are copied through. The inside of a link or
  // a raw block is copied through too, so a URL that is already a link, or
  // that sits in code, is neither embedded nor linkified.
  function walkHtmlText(html, onText) {
    const s = String(html || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) === "<") {
        const skipTag = /^<(a|code|pre|script|style|textarea|kbd|samp)\b/i.exec(s.slice(i));
        if (skipTag) {
          const close = new RegExp("</" + skipTag[1] + "\\s*>", "i");
          const rest = s.slice(i);
          const found = rest.search(close);
          if (found < 0) {
            out += rest;
            break;
          }
          const end = found + rest.slice(found).match(close)[0].length;
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
      const next = s.indexOf("<", i);
      const end = next < 0 ? s.length : next;
      out += onText(s.slice(i, end));
      i = end;
    }
    return out;
  }

  // Trailing sentence punctuation stays outside the URL. A closing paren is
  // kept when the URL itself opened it.
  function splitPlainUrl(raw) {
    let url = String(raw || "");
    let trail = "";
    while (url.length) {
      const ch = url.charAt(url.length - 1);
      if (/[.,;:!?]/.test(ch)) {
        trail = ch + trail;
        url = url.slice(0, -1);
        continue;
      }
      if (ch === ")") {
        let open = 0;
        let close = 0;
        for (let k = 0; k < url.length; k++) {
          if (url.charAt(k) === "(") open++;
          else if (url.charAt(k) === ")") close++;
        }
        if (close > open) {
          trail = ch + trail;
          url = url.slice(0, -1);
          continue;
        }
      }
      break;
    }
    return { url: url, trail: trail };
  }

  function embedPlainText(text) {
    return String(text || "").replace(/https?:\/\/[^\s<]+/gi, function (raw) {
      const parts = splitPlainUrl(raw);
      if (!parts.url) return raw;
      const url = unescapeHtml(parts.url);
      const yt = youtubeIdFromUrl(url);
      if (yt) {
        const embed = youtubeEmbedHtml(yt);
        if (embed) return embed + parts.trail;
      }
      const speak = threeSpeakFromUrl(url);
      if (speak) {
        const embed = threeSpeakEmbedHtml(speak.id, speak.route);
        if (embed) return embed + parts.trail;
      }
      const tweet = tweetIdFromUrl(url);
      if (tweet) {
        const embed = tweetEmbedHtml(tweet);
        if (embed) return embed + parts.trail;
      }
      if (isImageUrl(url)) {
        const img = imageHtml(url, "");
        if (img) return img + parts.trail;
      }
      return raw;
    });
  }

  // A block player inside <p> is invalid. Split the paragraph so the player
  // is a sibling and the surrounding text stays in the post body.
  function liftBlockEmbeds(html) {
    return String(html || "").replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, function (full, attrs, inner) {
      if (!/<div class="(?:tweet-embed|embed)\b/.test(inner)) return full;
      const re = /<div class="(?:tweet-embed|embed)\b[^>]*>[\s\S]*?<\/div>/gi;
      const pieces = [];
      let last = 0;
      let found = false;
      let m;
      let firstText = true;
      while ((m = re.exec(inner))) {
        found = true;
        const before = inner.slice(last, m.index).replace(/^\s+|\s+$/g, "");
        if (before) {
          pieces.push(firstText ? "<p" + attrs + ">" + before + "</p>" : "<p>" + before + "</p>");
          firstText = false;
        }
        pieces.push(m[0]);
        last = m.index + m[0].length;
      }
      if (!found) return full;
      const after = inner.slice(last).replace(/^\s+|\s+$/g, "");
      if (after) {
        pieces.push(firstText ? "<p" + attrs + ">" + after + "</p>" : "<p>" + after + "</p>");
      }
      return pieces.join("");
    });
  }

  function embedMedia(html) {
    html = embedWorldmappin(html);
    // Only text nodes. Markdown links and raw HTML links are already <a>,
    // and this walk does not read their contents.
    html = walkHtmlText(html, embedPlainText);
    html = liftBlockEmbeds(html);
    return html;
  }

  function linkifyPlainText(text) {
    return String(text || "").replace(/https?:\/\/[^\s<]+/gi, function (raw) {
      const parts = splitPlainUrl(raw);
      if (!parts.url) return raw;
      const url = unescapeHtml(parts.url);
      const linked = linkHtml(url, url);
      if (!linked || linked === escapeHtml(url)) return raw;
      return linked + parts.trail;
    });
  }

  // Last URL step. Media text was embedded above. Angle-bracket autolinks and
  // markdown links are already anchors. Hive hosts are rewritten next.
  function linkifyPlainUrls(html) {
    return walkHtmlText(html, linkifyPlainText);
  }

  function localAppPrefix() {
    if (global.__CS77_HASH__) return "#/";
    const base = global.__CS77_BASE__ || "/";
    return base === "/" ? "/" : String(base).replace(/\/+$/, "") + "/";
  }

  function localizeHiveLinks(html) {
    const prefix = localAppPrefix();
    html = String(html || "").replace(
      /https?:\/\/(?:www\.)?(?:peakd\.com|hive\.blog|ecency\.com)\/(?:[^"'/\s]+\/)?@([a-z0-9.\-]+)\/([a-zA-Z0-9\-\._]+)/gi,
      prefix + "@$1/$2"
    );
    html = html.replace(
      /https?:\/\/(?:www\.)?(?:peakd\.com|hive\.blog|ecency\.com)\/@([a-z0-9.\-]{3,16})\/?(?=[?#"'<\s]|$)/gi,
      prefix + "@$1"
    );
    // Href stays /@user/permlink (or #/@user/permlink). A label that is that
    // same path drops the slash before @, so the visible text is @user/permlink.
    return normalizeHiveAtAnchorText(html);
  }

  function hiveAtAnchorLabel(href) {
    const h = String(href || "").trim();
    if (!h) return "";
    const prefix = localAppPrefix();
    let rest = "";
    if (prefix && h.startsWith(prefix)) rest = h.slice(prefix.length);
    else if (h.startsWith("/@")) rest = h.slice(1);
    else if (h.startsWith("#/@")) rest = h.slice(2);
    else return "";
    if (!/^@[a-z0-9.\-]{3,16}(?=$|[/?#])/i.test(rest)) return "";
    return rest;
  }

  function normalizeHiveAtAnchorText(html) {
    return String(html || "").replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (full) => {
      const openEnd = full.indexOf(">");
      if (openEnd < 0) return full;
      const href = htmlAttr(full.slice(0, openEnd + 1), "href");
      const label = hiveAtAnchorLabel(href);
      if (!label || label === href) return full;
      const closeAt = full.toLowerCase().lastIndexOf("</a>");
      if (closeAt <= openEnd) return full;
      const inner = full.slice(openEnd + 1, closeAt);
      if (/<[a-z!/]/i.test(inner)) return full;
      const text = unescapeHtml(inner).trim();
      if (!text || text === label) return full;
      if (text !== href && text !== "/" + label && text !== "#/" + label) return full;
      return full.slice(0, openEnd + 1) + escapeHtml(label) + full.slice(closeAt);
    });
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

  // Hive permlinks are 1–256 chars: a letter or digit, then letters, digits, or
  // hyphens, ending on a letter or digit. A following hyphen or underscore is
  // not a post. A period or comma stays outside the link.
  function postPermlinkAt(s, index) {
    if (s.charAt(index) !== "/") return "";
    const m = /^[a-z0-9](?:[a-z0-9-]{0,254}[a-z0-9])?/i.exec(s.slice(index + 1));
    if (!m) return "";
    const perm = m[0];
    const next = s.charAt(index + 1 + perm.length);
    if (next && /[a-z0-9_-]/i.test(next)) return "";
    return perm;
  }

  function postRefHtml(at, name, permlink) {
    const user = String(name || "").toLowerCase();
    const perm = String(permlink || "").toLowerCase();
    return (
      '<a class="mention" href="' +
      escapeHtml(localAppPrefix() + "@" + user + "/" + perm) +
      '">' +
      at +
      escapeHtml(name) +
      "/" +
      escapeHtml(permlink) +
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

  /** Turn bare @username and @username/permlink mentions, and #tags, into local links. */
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
          const perm = postPermlinkAt(s, i + 1 + m[1].length);
          if (perm) {
            out += postRefHtml(at, m[1], perm);
            i += 1 + m[1].length + 1 + perm.length;
            continue;
          }
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
    // Angle-bracket autolinks. A bare https:// URL stays text here so the
    // embed step can see it; linkifyPlainUrls links what remains.
    if (/<[A-Za-z][A-Za-z0-9+.-]*:/.test(text)) return true;
    if (/^#{1,6}(?:\s|$)/m.test(text)) return true;
    if (/^[ \t]{0,3}(?:>|[-+*](?:\s|$)|\d+\.\s)/m.test(text)) return true;
    if (/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m.test(text)) return true;
    return false;
  }

  function parseWithMarked(src) {
    ensureMarked();
    const parse = global.marked?.parse || null;
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
    // GFM's bare-URL tokenizer is off. A pasted URL stays text until after
    // embedMedia. Angle-bracket autolinks (<https://…>) still become links.
    // undefined disables the tokenizer; false falls through and still autolinks.
    const opts = {
      gfm: true,
      breaks: true,
      tokenizer: {
        url: function () {
          return;
        },
      },
    };
    if (typeof global.marked.use === "function") {
      global.marked.use(opts);
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
      const parse = global.marked?.parse || null;
      if (parse) {
        html = parse(prepared);
      } else {
        html = `<p>${escapeHtml(prepared).replace(/\n/g, "<br>")}</p>`;
      }
    } catch {
      html = `<p>${escapeHtml(prepared).replace(/\n/g, "<br>")}</p>`;
    }

    // Leftover markdown inside HTML blocks becomes tags, then the whitelist
    // sees the whole post. Plain-text media is embedded next. Remaining
    // http(s) text is linked after that, then Hive hosts, mentions, and tags.
    html = replaceMarkdownImages(html);
    html = replaceMarkdownLinks(html);
    html = sanitizePostHtml(html);
    html = embedMedia(html);
    html = linkifyPlainUrls(html);
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
