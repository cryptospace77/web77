/**
 * Site blacklist. Edit these arrays to hide users and posts.
 */
var cs77_blacklist_users = [
  // "exampleuser",
];

var cs77_blacklist_posts = [
  // "@exampleuser/example-post",
];

var Cs77Blacklist = (function () {
  function normUser(name) {
    return String(name || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
  }

  function postKey(author, permlink) {
    var a = normUser(author);
    var p = String(permlink || "")
      .trim()
      .toLowerCase()
      .replace(/^\/+/, "");
    if (!a || !p) return "";
    return a + "/" + p;
  }

  function parsePostLink(link) {
    var s = String(link || "")
      .trim()
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    var at = s.lastIndexOf("@");
    if (at >= 0) s = s.slice(at + 1);
    var slash = s.indexOf("/");
    if (slash < 1) return "";
    return postKey(s.slice(0, slash), s.slice(slash + 1));
  }

  function listedUser(name) {
    var n = normUser(name);
    if (!n) return false;
    var list = cs77_blacklist_users || [];
    for (var i = 0; i < list.length; i++) {
      if (normUser(list[i]) === n) return true;
    }
    return false;
  }

  function listedPost(author, permlink) {
    var key = postKey(author, permlink);
    if (!key) return false;
    var list = cs77_blacklist_posts || [];
    for (var i = 0; i < list.length; i++) {
      if (parsePostLink(list[i]) === key) return true;
    }
    return false;
  }

  return {
    user: listedUser,
    post: function (author, permlink) {
      if (listedUser(author)) return true;
      return listedPost(author, permlink);
    },
  };
})();
