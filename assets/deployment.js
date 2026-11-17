"use strict";
// Public routing only. Server publication confirmed; no credentials belong here.
(function () {
  const publishedApp = "https://taswiqat-ayt7ghj3.manus.space";
  const githubPages = window.location.hostname === "lawnalamak.github.io";
  window.TASWIQAT_APP_URL = githubPages ? publishedApp : "";
})();
