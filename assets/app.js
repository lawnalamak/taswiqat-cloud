"use strict";

// Customer workspace UI. Authentication, membership and persistence come from
// the server; the old local prototype is available only after explicit consent.
const CHANNELS = [
  {
    id: "ig",
    name: "إنستقرام",
    short: "IG",
    group: "social",
    publish: true,
    kind: "visual",
    limit: 2200,
    description: "منشورات وصور ومقاطع قصيرة لحضور علامتك.",
    url: "/api/oauth/meta/connect?service=instagram",
  },
  {
    id: "tt",
    name: "تيك توك",
    short: "Tk",
    group: "social",
    publish: true,
    kind: "video",
    limit: 2200,
    description: "خطط لمحتوى الفيديو القصير لجمهورك.",
    url: "/api/oauth/tiktok/connect",
  },
  {
    id: "x",
    name: "إكس",
    short: "X",
    group: "social",
    publish: true,
    kind: "text",
    limit: 280,
    description: "تحديثات علامتك ومحتوى المحادثات.",
    url: "/api/oauth/x/connect",
  },
  {
    id: "sc",
    name: "سناب شات",
    short: "Sc",
    group: "social",
    publish: true,
    kind: "vertical",
    limit: 1000,
    description: "تخطيط محتوى سناب؛ التكامل الحالي خاص بالإعلانات.",
    url: "/api/oauth/snapchat/connect",
  },
  {
    id: "wa",
    name: "واتساب أعمال",
    short: "WA",
    group: "social",
    publish: true,
    kind: "message",
    limit: 1024,
    description: "رسائل أعمال؛ الإرسال يخضع للموافقات وقوالب المنصة.",
    url: "/api/oauth/meta/connect?service=whatsapp",
  },
  {
    id: "fb",
    name: "فيسبوك",
    short: "f",
    group: "social",
    publish: true,
    kind: "feed",
    limit: 5000,
    description: "إدارة محتوى صفحة النشاط والتفاعل معها.",
    url: "/api/oauth/meta/connect?service=facebook",
  },
  {
    id: "gbp",
    name: "ملف النشاط على قوقل",
    short: "G",
    group: "google",
    publish: true,
    kind: "business",
    limit: 1500,
    description: "تحديثات نشاطك وتقييماته على البحث والخرائط.",
    url: "/api/oauth/google/connect?service=gbp",
  },
  {
    id: "ga4",
    name: "Google Analytics 4",
    short: "GA",
    group: "google",
    publish: false,
    description: "قراءة زيارات الموقع وتحليل سلوك الجمهور.",
    url: "/api/oauth/google/connect?service=ga4",
  },
  {
    id: "gads",
    name: "Google Ads",
    short: "Ads",
    group: "google",
    publish: false,
    description: "أداة للحملات الإعلانية، وليست قناة منشورات.",
    url: "/api/oauth/google/connect?service=gads",
  },
  {
    id: "yt",
    name: "يوتيوب",
    short: "YT",
    group: "google",
    publish: true,
    kind: "video",
    limit: 5000,
    description: "خطط لمحتوى الفيديو. صلاحية الربط الحالية للقراءة فقط.",
    url: "/api/oauth/google/connect?service=yt",
  },
  {
    id: "gsc",
    name: "Google Search Console",
    short: "SC",
    group: "google",
    publish: false,
    description: "مؤشرات ظهور موقعك في نتائج البحث.",
    url: "/api/oauth/google/connect?service=gsc",
  },
];
const NAV = [
  { id: "overview", title: "نظرة عامة", icon: "home" },
  { id: "content", title: "مكتبة المحتوى", icon: "file" },
  { id: "calendar", title: "تقويم النشر", icon: "calendar" },
  { id: "campaigns", title: "الحملات", icon: "flag" },
  { id: "channels", title: "مركز القنوات", icon: "link" },
  { id: "inbox", title: "صندوق التواصل", icon: "message" },
  { id: "analytics", title: "النتائج والتقارير", icon: "chart" },
  { id: "team", title: "الفريق", icon: "users" },
  { id: "settings", title: "ملف النشاط", icon: "settings" },
];
const EMPLOYEE_VIEWS = ["overview", "content", "compose", "calendar"];
const STORE_KEY = "taswiqat.ui.v2";
const STATUS = {
  draft: "مسودة",
  review: "بانتظار الاعتماد",
  ready: "جاهز للنشر",
  planned: "خطة مجدولة",
};
let state = freshState();
let storageSnapshot = null;
let pendingNavigation = null;
let role = "owner";
let mode = "live";
let sessionInfo = null;
let sessionStatus = "loading";
let sessionError = "";
let workspaceId = null;
let workspaceVersion = null;
let workspaceLoaded = false;
let connections = [];
let capabilities = {};
let subscription = null;
let workspacePlan = null;
let saving = false;
let loadEpoch = 0;
let teamRows = [];
let teamStatus = "idle";
let teamError = "";
let requestedView = "overview";
let setupAfterLogin = false;
let bootPromise;
let currentView = "overview";
let youtubeReturnIntent = null;
let contentFilter = "all";
let channelFilter = "all";
let calendarOffset = 0;
let composeStep = 1;
let draft = blankDraft();
let previewChannel = "ig";
let toastTimer;

function freshState() {
  return {
    business: {
      name: "",
      type: "متجر وتجارة إلكترونية",
      market: "",
      website: "",
      bio: "",
    },
    selected: [],
    posts: [],
    campaigns: [],
    team: [],
    theme: "light",
  };
}
function normalizeState(data) {
    if (!data || typeof data !== "object") return freshState();
    const empty = freshState();
    const business =
      data.business && typeof data.business === "object" ? data.business : {};
    Object.keys(empty.business).forEach((key) => {
      if (typeof business[key] === "string")
        empty.business[key] = business[key];
    });
    empty.selected = Array.isArray(data.selected)
      ? data.selected.filter((id) => CHANNELS.some((c) => c.id === id))
      : [];
    empty.posts = Array.isArray(data.posts)
      ? data.posts
          .filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.title === "string" &&
              typeof p.text === "string" &&
              Array.isArray(p.channels) &&
              Object.hasOwn(STATUS, p.status),
          )
          .map((p) => ({
            ...p,
            channels: p.channels.filter((id) =>
              CHANNELS.some((c) => c.id === id && c.publish),
            ),
          }))
      : [];
    empty.campaigns = Array.isArray(data.campaigns)
      ? data.campaigns.filter(
          (c) => c && typeof c.id === "string" && typeof c.name === "string",
        )
      : [];
    empty.team = Array.isArray(data.team)
      ? data.team.filter(
          (t) => t && typeof t.id === "string" && typeof t.name === "string",
        )
      : [];
    empty.theme = data.theme === "dark" ? "dark" : "light";
    return empty;
}
function loadDemoState() {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORE_KEY) || "null")); }
  catch { return freshState(); }
}
function rawStorage() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
async function persist() {
  if (mode === "demo") {
    const payload = JSON.stringify(state);
    localStorage.setItem(STORE_KEY, payload);
    storageSnapshot = payload;
    return;
  }
  const response = await api().saveWorkspaceState(workspaceId, state, workspaceVersion);
  applyWorkspace(response, workspaceId);
}
async function changeState(mutator) {
  if (saving) { notify("انتظر اكتمال العملية الحالية."); return false; }
  if (mode !== "demo" && (!sessionInfo?.authenticated || !workspaceLoaded)) {
    notify("يلزم تسجيل الدخول وتحميل مساحة عملك قبل الحفظ."); return false;
  }
  if (mode === "demo" && rawStorage() !== storageSnapshot) {
    state = loadDemoState();
    storageSnapshot = rawStorage();
    notify(
      "تغيّرت البيانات في تبويب آخر. مسودتك بقيت في المحرر وحمّلنا أحدث البيانات؛ أعد محاولة الحفظ.",
    );
    return false;
  }
  const before = JSON.stringify(state);
  setSaving(true);
  try {
    mutator();
    await persist();
    return true;
  } catch (error) {
    state = JSON.parse(before);
    if (mode === "live" && error.status === 409) {
      try {
        applyWorkspace(await api().workspaceState(workspaceId), workspaceId);
        render();
        notify(`${error.message} لم يُحفظ التعديل؛ حمّلنا أحدث بيانات الخادم وحافظنا على مسودتك في المحرر. راجعها وحدود الباقة قبل إعادة الحفظ.`);
      } catch (reloadError) {
        workspaceLoaded = false;
        notify(`لم يُحفظ التعديل وتعذّر تحميل النسخة الأحدث. مسودتك باقية في الذاكرة. ${reloadError.message}`);
      }
    } else {
      notify(mode === "demo" ? "تعذّر حفظ التجربة على هذا المتصفح." : error.message);
    }
    if (!sessionInfo?.authenticated && mode === "live") clearPrivateState();
    return false;
  } finally {
    setSaving(false);
  }
}
function setSaving(value) {
  saving = value;
  if (value) {
    document.body.dataset.saving = "true";
    document.querySelectorAll("#appMain button, #appMain input, #appMain select, #appMain textarea, #sessionPanel button, dialog button, dialog input, dialog select, dialog textarea").forEach((control) => {
      if (!control.disabled) { control.dataset.busyDisabled = "true"; control.disabled = true; }
    });
  } else {
    delete document.body.dataset.saving;
    document.querySelectorAll('[data-busy-disabled="true"]').forEach((control) => {
      control.disabled = false; delete control.dataset.busyDisabled;
    });
  }
}
function api() {
  if (!window.TaswiqatAPI) throw new Error("ناقل الاتصال غير محمّل؛ حمّل client-api.js قبل app.js.");
  return window.TaswiqatAPI;
}
function remoteAppURL(view = "overview") {
  if (!window.TASWIQAT_APP_URL) return null;
  try {
    const url = new URL(window.TASWIQAT_APP_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.origin === location.origin) return null;
    url.hash = pendingInvite() ? `invite/${encodeURIComponent(pendingInvite())}` : `app/${view}`;
    return url;
  } catch { return null; }
}
function forwardRealEntry(view = "overview") {
  const url = remoteAppURL(view);
  if (!url) return false;
  window.location.assign(url.href);
  return true;
}
function isManager() {
  return ["owner", "manager"].includes(role) && (mode === "demo" || (sessionInfo?.authenticated && workspaceLoaded));
}
function roleLabel(value) {
  return ({ owner: "صاحب النشاط", manager: "مدير مساحة العمل", employee: "موظف" })[value] || "عضو";
}
function clearPrivateState() {
  state = freshState();
  draft = blankDraft();
  workspaceId = null;
  workspaceVersion = null;
  workspaceLoaded = false;
  connections = [];
  window.TaswiqatYouTube?.reset();
  capabilities = {};
  subscription = null;
  workspacePlan = null;
  teamRows = [];
  teamStatus = "idle";
}
function applyWorkspace(data, expectedId) {
  // PUT may return only canonical {state, version}; retain the membership
  // already obtained from GET, never derive it from the global user role.
  const nextRole = data?.role || (workspaceLoaded && workspaceId === String(expectedId) ? role : null);
  if (!data?.state || !Number.isInteger(data.version) || !["owner", "manager", "employee"].includes(nextRole) ||
      (data.workspaceId && String(data.workspaceId) !== String(expectedId))) {
    throw new Error("استجابة مساحة العمل غير مكتملة؛ لم نعتمدها كحفظ ناجح.");
  }
  state = normalizeState(data.state);
  workspaceId = String(expectedId);
  workspaceVersion = data.version;
  role = nextRole;
  workspaceLoaded = true;
  if (Array.isArray(data.connections)) connections = data.connections;
  if (data.capabilities && typeof data.capabilities === "object") capabilities = data.capabilities;
  if (data.subscription) subscription = data.subscription;
  if (data.plan) workspacePlan = data.plan;
}
function activeWorkspaces() {
  return (sessionInfo?.workspaces || []).filter((w) =>
    ["owner", "manager", "employee"].includes(w.role) && !["suspended", "disabled", "deleted"].includes(w.status));
}
function ownPost(post) {
  return mode === "demo" ? post.author === "employee" : String(post.author || "") === String(sessionInfo?.user?.id || "");
}
function postAuthorLabel(post) {
  if (mode === "demo") return post.author === "employee" ? "موظف التجربة" : "صاحب نشاط التجربة";
  if (String(post.author) === String(sessionInfo?.user?.id)) return sessionInfo.user.name || "أنت";
  return state.team.find((member) => String(member.id) === String(post.author))?.name || "عضو مساحة العمل";
}
function e(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function $(id) {
  return document.getElementById(id);
}
function id() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function channel(idValue) {
  return CHANNELS.find((c) => c.id === idValue);
}
function channelNames(ids) {
  return (ids || [])
    .map((v) => channel(v)?.name)
    .filter(Boolean)
    .join("، ");
}
function logo(c) {
  return `<span class="channel-logo ${e(c.id)}" aria-hidden="true"><img src="assets/channels/${e(c.id)}.svg" width="24" height="24" alt="" decoding="async"></span>`;
}
function icon(name) {
  const paths = {
    home: "M3 10l9-7 9 7v10H3z M9 20v-7h6v7",
    file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
    calendar: "M4 6h16v15H4z M4 10h16 M8 3v5 M16 3v5 M8 14h2 M14 14h2 M8 18h2",
    flag: "M5 21V3 M5 4h14l-3 4 3 4H5",
    link: "M9 15l6-6 M8 13l-2 2a3 3 0 004 4l3-3 M11 8l3-3a3 3 0 014 4l-2 2",
    message: "M3 4h18v13H8l-5 4z M7 8h10 M7 12h6",
    chart: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4",
    users:
      "M9 12a4 4 0 100-8 4 4 0 000 8 M2 21v-2a7 7 0 0114 0v2 M17 4a4 4 0 010 8 M18 16a5 5 0 014 5",
    settings:
      "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 11-8 0 4 4 0 018 0",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(
    paths[name] || paths.file
  )
    .split(" M")
    .map((p, i) => `<path d="${i ? "M" : ""}${p}"/>`)
    .join("")}</svg>`;
}
function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 5000);
}
function toggleTheme() {
  const dark = !document.body.classList.contains("dark");
  document.body.classList.toggle("dark", dark);
  try { localStorage.setItem("taswiqat.theme", dark ? "dark" : "light"); } catch { /* Cosmetic preference only. */ }
}
function toggleMenu(force) {
  document.body.classList.toggle(
    "menu-open",
    typeof force === "boolean"
      ? force
      : !document.body.classList.contains("menu-open"),
  );
}
function routeHash() {
  return `#${mode === "demo" ? "demo" : "app"}/${currentView}`;
}
function guardLeave(callback) {
  if (saving) { notify("انتظر اكتمال الحفظ قبل المغادرة."); return; }
  if (!draft.dirty) {
    return Promise.resolve().then(callback).catch((error) => notify(error.message));
  }
  pendingNavigation = callback;
  showAction(
    "مغادرة مسودة غير محفوظة؟",
    `<p>تشمل المسودة النص والوسائط والقنوات والموعد. احفظها أو تجاهلها قبل المغادرة.</p><div class="dialog-actions"><button class="btn ghost" onclick="closeAction()">البقاء</button><button class="btn secondary" onclick="resolveLeave(true)">حفظ المسودة</button><button class="btn danger" onclick="resolveLeave(false)">تجاهل</button></div>`,
  );
}
async function resolveLeave(save) {
  if (save && !(await savePost("draft", true))) return;
  const callback = pendingNavigation;
  pendingNavigation = null;
  draft = blankDraft();
  closeAction();
  if (callback) await Promise.resolve().then(callback).catch((error) => notify(error.message));
}
function openApp(view = "overview") {
  requestedView = view;
  return guardLeave(async () => {
    if ($("appView").hidden && mode === "demo") { mode = "live"; clearPrivateState(); }
    if (mode !== "demo" && forwardRealEntry(view)) return;
    if (mode !== "demo" && !(await ensureWorkspace())) return;
    showApp(view);
  });
}
function openEmployee() {
  // Legacy landing CTA: never grants or changes a membership role.
  return openApp("overview");
}
function showLanding() {
  guardLeave(showLandingNow);
}
function showLandingNow() {
  window.TaswiqatAuthPortal?.unmount();
  $("landingView").hidden = false;
  $("appView").hidden = true;
  $("sessionView").hidden = true;
  toggleMenu(false);
  history.pushState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);
}
function showApp(view = "overview", replace = false) {
  if (mode !== "demo" && (!sessionInfo?.authenticated || !workspaceLoaded)) {
    requestedView = view;
    showSessionPanel();
    return;
  }
  window.TaswiqatAuthPortal?.unmount();
  const allowed =
    role === "employee" ? EMPLOYEE_VIEWS : [...NAV.map((n) => n.id), "compose"];
  currentView = allowed.includes(view) ? view : "overview";
  $("landingView").hidden = true;
  $("appView").hidden = false;
  $("sessionView").hidden = true;
  toggleMenu(false);
  if (replace) history.replaceState(null, "", routeHash());
  else if (location.hash !== routeHash())
    history.pushState(null, "", routeHash());
  render();
  window.scrollTo(0, 0);
}
function navigate(view) {
  return guardLeave(() => showApp(view));
}
function visiblePosts() {
  return role === "employee"
    ? state.posts.filter(ownPost)
    : state.posts;
}
function pendingInvite() {
  try { return sessionStorage.getItem("taswiqat.invite") || ""; } catch { return invitationInMemory; }
}
let invitationInMemory = "";
function rememberInvite(token) {
  invitationInMemory = token;
  try { if (token) sessionStorage.setItem("taswiqat.invite", token); else sessionStorage.removeItem("taswiqat.invite"); } catch { /* Token only; no identity stored. */ }
}
let authView = "login";
const AUTH_VIEWS = ["login", "register", "forgot", "reset", "verify"];
function authRouteView(hash = location.hash) {
  return hash.match(/^#auth\/(login|register|forgot|reset|verify)(?:\?[^#]*)?$/)?.[1] || "";
}
function openAuth(view = "login", setup = false) {
  if (!AUTH_VIEWS.includes(view)) view = "login";
  return guardLeave(async () => {
    if (mode === "demo") { mode = "live"; clearPrivateState(); }
    const remote = remoteAppURL("overview");
    if (remote) { remote.hash = `#auth/${view}`; window.location.assign(remote.href); return; }
    if (bootPromise) await bootPromise;
    if (setup) setupAfterLogin = true;
    const sensitive = ["reset", "verify"].includes(authRouteView());
    if (sensitive && view === "login") await refreshSession();
    if (sessionInfo?.authenticated && ["login", "register"].includes(view)) {
      if (setup || view === "register") return startSetup(true);
      if (await ensureWorkspace()) showApp(requestedView);
      else showSessionPanel();
      return;
    }
    authView = view;
    history[sensitive ? "replaceState" : "pushState"](null, "", `#auth/${view}`);
    showSessionPanel();
    window.scrollTo(0, 0);
  });
}
async function finishAccountLogin() {
  api().clearSession();
  history.replaceState(null, "", "#app/overview");
  if (!(await refreshSession()) || !sessionInfo?.authenticated) {
    showSessionPanel("لم تكتمل جلسة الحساب. أعد التحقق من الاتصال أو سجّل الدخول مجددًا.");
    return;
  }
  workspaceLoaded = false;
  if (pendingInvite()) { showSessionPanel(); return; }
  if (setupAfterLogin) { await startSetup(); return; }
  if (await ensureWorkspace()) showApp(requestedView);
  else showSessionPanel();
}
function showSessionPanel(message = "") {
  $("landingView").hidden = true;
  $("appView").hidden = true;
  $("sessionView").hidden = false;
  toggleMenu(false);
  const authenticated = sessionInfo?.authenticated;
  const view = authRouteView() || authView;
  if (!remoteAppURL(requestedView) && !["loading", "error"].includes(sessionStatus) &&
      (!authenticated || ["forgot", "reset", "verify"].includes(authRouteView())) && window.TaswiqatAuthPortal) {
    window.TaswiqatAuthPortal.mount($("sessionPanel"), {
      view, message, invite: Boolean(pendingInvite()), setup: setupAfterLogin,
      onManusLogin: startLogin, onAuthenticated: finishAccountLogin,
      onHome: showLanding, onDemo: startDemo, onNavigate: (next) => openAuth(next),
    });
    return;
  }
  window.TaswiqatAuthPortal?.unmount();
  let title = "مساحة عملك تبدأ بحسابك";
  let text = "سجّل الدخول الآمن للوصول إلى نشاطك ومحتواه. لا تُحمّل مسودات المتصفح القديمة داخل أي حساب تلقائيًا.";
  let actions = '<button class="btn primary" onclick="startLogin()">تسجيل الدخول الآمن ←</button>';
  if (remoteAppURL(requestedView)) {
    title = "التطبيق الحقيقي يعمل على الخادم";
    text = "هذا الموقع يعرض التعريف والتجربة المحلية. الدخول ومساحات العمل والبيانات الخاصة متاحة على خادم التطبيق، دون طلبات محمية بين أصلين.";
    actions = `<a class="btn primary" href="${e(remoteAppURL(requestedView).href)}">فتح التطبيق الحقيقي ←</a>`;
  } else if (sessionStatus === "loading") {
    title = "جارٍ التحقق من الجلسة…";
    text = "ننتظر استجابة الخادم؛ لن نستبدل بيانات حسابك ببيانات تجريبية.";
    actions = "";
  } else if (sessionStatus === "error") {
    title = "تعذّر تحميل الجلسة أو مساحة العمل";
    text = sessionError || "لم يكتمل الاتصال بالخادم. لا توجد بيانات محلية بديلة لحسابك.";
    actions = '<button class="btn primary" onclick="retrySession()">إعادة المحاولة</button>';
  } else if (authenticated && pendingInvite()) {
    title = "لديك رابط دعوة للانضمام";
    text = `أنت مسجّل باسم ${sessionInfo.user.name || sessionInfo.user.email}. تُتحقق الدعوة والبريد والصلاحيات على الخادم؛ لن تنضم إلا بعد التأكيد.`;
    actions = '<button class="btn primary" onclick="acceptPendingInvite()">قبول الدعوة</button><button class="btn" onclick="cancelPendingInvite()">تجاهل الرابط</button><button class="btn ghost" onclick="logout()">تسجيل الخروج</button>';
  } else if (authenticated) {
    title = `أهلًا، ${sessionInfo.user.name || "بك"}`;
    text = activeWorkspaces().length ? "اختر مساحة العمل التي لديك عضوية فيها. دورك داخل النشاط مستقل عن أي دور إداري عام." : "حسابك موثّق. أنشئ مساحة نشاطك الأولى، أو استخدم رابط دعوة من فريقك.";
    actions = '<button class="btn primary" onclick="startSetup(true)">إنشاء مساحة عمل</button><button class="btn ghost" onclick="logout()">تسجيل الخروج</button>';
  } else if (pendingInvite()) {
    title = "سجّل الدخول لقبول الدعوة";
    text = "حُفظ رابط الدعوة في هذه الجلسة للعودة إليه بعد تسجيل الدخول. الرابط لا يمنح هوية أو صلاحية بحد ذاته.";
  }
  $("sessionPanel").innerHTML = `<a class="brand" href="#" onclick="showLanding();return false"><span class="brand-mark" aria-hidden="true">⇄</span><span>تسويقات</span></a><h1>${e(title)}</h1><p>${e(text)}</p>${authenticated && sessionStatus !== "loading" && sessionStatus !== "error" && !pendingInvite() ? `<div class="session-workspace-list">${activeWorkspaces().map((w) => `<button class="btn" data-workspace="${e(w.id)}"><strong>${e(w.name)}</strong><span>${roleLabel(w.role)}</span></button>`).join("")}</div>` : ""}<div class="session-actions">${actions}<button class="btn ghost" onclick="showLanding()">العودة للموقع</button></div>${message ? `<div class="notice session-message" role="alert">${e(message)}</div>` : ""}<div class="session-demo-note"><button class="btn" onclick="startDemo()">تجربة الواجهة بدون حساب</button><p>تجربة محلية منفصلة بوسم دائم. لا تربط حسابات ولا ترسل دعوات أو منشورات ولا تنشئ اشتراكًا.</p></div>`;
  $("sessionPanel").querySelectorAll("[data-workspace]").forEach((button) => {
    button.addEventListener("click", () => switchWorkspace(button.dataset.workspace));
  });
}
async function refreshSession() {
  sessionStatus = "loading";
  try {
    const data = await api().session();
    if (data?.authenticated && (!data.user?.id || !Array.isArray(data.workspaces))) throw new Error("استجابة الجلسة غير مكتملة.");
    const previousUserId = sessionInfo?.user?.id;
    sessionInfo = data?.authenticated ? data : null;
    if (mode === "live" && String(previousUserId || "") !== String(sessionInfo?.user?.id || "")) clearPrivateState();
    sessionStatus = sessionInfo ? "authenticated" : "anonymous";
    sessionError = "";
    return true;
  } catch (error) {
    sessionStatus = "error";
    sessionError = error.message;
    return false;
  }
}
async function ensureWorkspace() {
  if (forwardRealEntry(requestedView)) return false;
  if (bootPromise) await bootPromise;
  if (sessionStatus === "loading") { showSessionPanel(); return false; }
  if (!sessionInfo?.authenticated || sessionStatus === "error" || pendingInvite()) { showSessionPanel(); return false; }
  const memberships = activeWorkspaces();
  const returnScope = youtubeReturnIntent?.workspaceId;
  if (returnScope && !memberships.some(w => String(w.id) === returnScope)) {
    youtubeReturnIntent = null;
    showSessionPanel("لا توجد عضوية متاحة في النشاط الذي بدأ ربط القناة. لم نفتح نشاطًا آخر بدلًا منه.");
    return false;
  }
  if (workspaceLoaded && (!returnScope || workspaceId === returnScope)) return true;
  const preferred = memberships.find((w) => String(w.id) === String(returnScope || sessionInfo.workspaceId)) || memberships[0];
  if (!preferred) { showSessionPanel(); return false; }
  return loadWorkspace(preferred.id);
}
async function loadWorkspace(value) {
  if (!activeWorkspaces().some((w) => String(w.id) === String(value))) {
    showSessionPanel("لا توجد عضوية متاحة في مساحة العمل المطلوبة."); return false;
  }
  const epoch = ++loadEpoch;
  workspaceLoaded = false;
  sessionStatus = "loading";
  showSessionPanel();
  try {
    const response = await api().workspaceState(value);
    if (epoch !== loadEpoch || mode !== "live" || !sessionInfo?.authenticated) return false;
    applyWorkspace(response, value);
    teamRows = []; teamStatus = "idle"; connections = response.connections || []; capabilities = response.capabilities || {};
    sessionStatus = "authenticated";
    return true;
  } catch (error) {
    if (epoch !== loadEpoch) return false;
    sessionStatus = "error";
    sessionError = error.message;
    showSessionPanel();
    return false;
  }
}
function switchWorkspace(value) {
  if (mode !== "live") return;
  if (forwardRealEntry("overview")) return;
  if ($("workspaceSelect")) $("workspaceSelect").value = workspaceId || "";
  return guardLeave(async () => {
    draft = blankDraft();
    clearPrivateState();
    if (await loadWorkspace(value)) showApp("overview");
  });
}
async function retrySession() {
  if (saving) return;
  if (forwardRealEntry(requestedView)) return;
  sessionStatus = "loading"; showSessionPanel();
  if (!(await refreshSession())) { showSessionPanel(); return; }
  workspaceLoaded = false;
  if (pendingInvite()) { showSessionPanel(); return; }
  if (await ensureWorkspace()) showApp(requestedView);
}
async function startLogin() {
  if (saving || sessionStatus === "loading") return;
  const previousStatus = sessionStatus;
  try {
    if (mode === "demo") { mode = "live"; clearPrivateState(); }
    if (forwardRealEntry(requestedView)) return;
    if (setupAfterLogin) { try { sessionStorage.setItem("taswiqat.afterLogin", "setup"); } catch { /* Navigation intent only. */ } }
    sessionStatus = "loading";
    showSessionPanel("جارٍ تجهيز رابط تسجيل الدخول…");
    const result = await api().authStart("app");
    if (!result?.url) throw new Error("الخادم لم يوفر رابط تسجيل الدخول.");
    const url = new URL(result.url, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.protocol !== "https:" && url.origin !== window.location.origin)) throw new Error("رابط تسجيل الدخول غير صالح.");
    try { window.top.location.href = url.href; } catch { window.location.assign(url.href); }
  } catch (error) { sessionStatus = previousStatus; showSessionPanel(error.message); }
}
function startDemo() {
  return guardLeave(() => {
    if (!window.confirm("هذه تجربة محلية بدون حساب. قد تظهر مسودات تجربة سابقة من هذا المتصفح، ولن تُستورد إلى حسابك الحقيقي. هل تريد المتابعة؟")) return;
    ++loadEpoch;
    clearPrivateState();
    mode = "demo"; role = "owner";
    state = loadDemoState(); storageSnapshot = rawStorage();
    showApp("overview");
  });
}
function sessionAction() {
  if (mode === "live") return logout();
  return guardLeave(async () => {
    mode = "live"; clearPrivateState();
    if (forwardRealEntry("overview")) return;
    history.replaceState(null, "", "#app/overview");
    await refreshSession();
    showSessionPanel();
  });
}
function logout() {
  return guardLeave(async () => {
    setSaving(true);
    try {
      await api().logout();
      ++loadEpoch;
      sessionInfo = null; sessionStatus = "anonymous"; mode = "live";
      clearPrivateState();
      history.replaceState(null, "", "#app/overview");
      showSessionPanel("تم تسجيل الخروج. بيانات مساحة العمل لم تُحفظ في التخزين المحلي.");
    } catch (error) { notify(`لم يؤكد الخادم تسجيل الخروج. ${error.message}`); }
    finally { setSaving(false); }
  });
}
async function acceptPendingInvite() {
  const token = pendingInvite();
  if (!token || !sessionInfo?.authenticated || saving) return;
  setSaving(true);
  try {
    const result = await api().acceptInvitation(token);
    rememberInvite("");
    clearPrivateState();
    if (!(await refreshSession())) {
      showSessionPanel("أكد الخادم قبول الدعوة، لكن تعذّر تحديث الجلسة. أعد المحاولة للوصول إلى مساحة العمل."); return;
    }
    history.replaceState(null, "", "#app/overview");
    if (result?.workspaceId && await loadWorkspace(result.workspaceId)) showApp("overview");
    else showSessionPanel("تم قبول الدعوة. اختر مساحة العمل للمتابعة.");
  } catch (error) { showSessionPanel(error.message); }
  finally { setSaving(false); }
}
function cancelPendingInvite() {
  if (saving) return;
  rememberInvite("");
  history.replaceState(null, "", "#app/overview");
  showSessionPanel();
}
function postBadge(post) {
  return `<span class="badge ${post.status === "planned" ? "gold" : post.status === "ready" ? "green" : ""}">${STATUS[post.status]}</span>`;
}
function pageTitle(title, desc, action = "") {
  return `<div class="between page-title"><div><h2>${title}</h2><p>${desc}</p></div>${action}</div>`;
}
function emptyBlock(title, text, button = "") {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">＋</div><h3>${title}</h3><p>${text}</p>${button}</div>`;
}
function summary(label, value, foot, ic) {
  return `<div class="card summary"><div class="summary-label"><span>${label}</span>${icon(ic)}</div><strong>${value}</strong><small>${foot}</small></div>`;
}
function render() {
  if (mode !== "demo" && !workspaceLoaded) { showSessionPanel(); return; }
  if (role === "employee" && !EMPLOYEE_VIEWS.includes(currentView)) currentView = "overview";
  $("workspaceName").textContent = state.business.name || "نشاطك التجاري";
  $("workspaceType").textContent = state.business.name
    ? state.business.type
    : "كل قنواتك في مكان واحد";
  $("roleName").textContent = roleLabel(role);
  $("sessionUserName").textContent = mode === "demo" ? "بدون حساب" : sessionInfo.user.name || sessionInfo.user.email;
  $("userAvatar").textContent = (mode === "demo" ? "ت" : sessionInfo.user.name || sessionInfo.user.email || "ت").slice(0, 1);
  $("sessionMode").textContent = mode === "demo" ? "تجربة محلية · بدون حساب" : "مساحة عمل حقيقية";
  $("sessionActionButton").textContent = mode === "demo" ? "إنهاء التجربة / تسجيل الدخول" : "تسجيل الخروج";
  const memberships = activeWorkspaces();
  $("workspaceSelect").hidden = mode === "demo" || memberships.length < 2;
  $("workspaceSelect").innerHTML = memberships.map((w) => `<option value="${e(w.id)}" ${String(w.id) === workspaceId ? "selected" : ""}>${e(w.name)} · ${roleLabel(w.role)}</option>`).join("");
  $("primaryNav").innerHTML = NAV.filter(
    (n) => role !== "employee" || EMPLOYEE_VIEWS.includes(n.id),
  )
    .map(
      (n) =>
        `<button class="nav-link ${currentView === n.id ? "active" : ""}" onclick="navigate('${n.id}')" ${currentView === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${n.title}</span></button>`,
    )
    .join("");
  $("breadcrumb").textContent =
    currentView === "compose"
      ? "إنشاء منشور"
      : NAV.find((n) => n.id === currentView)?.title || "نظرة عامة";
  const views = {
    overview: renderOverview,
    channels: renderChannels,
    content: renderContent,
    calendar: renderCalendar,
    campaigns: renderCampaigns,
    analytics: renderAnalytics,
    inbox: renderInbox,
    team: renderTeam,
    settings: renderSettings,
    compose: renderComposer,
  };
  $("appMain").innerHTML =
    `<div class="app-banner ${mode === "demo" ? "session-demo-banner" : ""}">${mode === "demo" ? 'تجربة الواجهة بدون حساب — البيانات محلية فقط، وليست مساحة عميل حقيقية. <button class="btn small" onclick="sessionAction()">الدخول بحساب حقيقي</button>' : "الحفظ مرتبط بحسابك ومساحة العمل الحالية على الخادم. المسودات والمراجعات والمواعيد خطط فقط؛ لا يوجد نشر خارجي أو دفع مفعّل هنا."}</div><div class="view-enter">${views[currentView]()}</div>`;
  if (currentView === "compose") updatePreview();
  if (currentView === "team" && mode === "live" && teamStatus === "idle") void loadTeam();
}
function renderOverview() {
  const posts = visiblePosts(),
    planned = posts.filter((p) => p.status === "planned"),
    review = posts.filter((p) => p.status === "review");
  const selected = CHANNELS.filter((c) => state.selected.includes(c.id));
  const tasks = [
    !!state.business.name,
    state.selected.length > 0,
    state.posts.length > 0,
  ];
  return `<div class="welcome"><div class="between"><div><span class="eyebrow">مساحة تسويقك اليومية</span><h1>${state.business.name ? `كل شيء لنشاطك، ${e(state.business.name)}` : "تسويقك يبدأ من هنا"}</h1><p>${role === "employee" ? "جهّز المحتوى وأرسله للاعتماد. إعدادات النشاط والربط تبقى لصاحب النشاط." : "خطط لمحتواك، نظّم قنواتك، وتابع ما يحتاج انتباهك."}</p></div><button class="btn primary" onclick="newPost()">+ إنشاء منشور</button></div></div>
  <div class="summary-grid">${summary("القنوات المختارة", selected.length, `اختيار للتخطيط · ${verifiedConnections().length} اتصال موثّق`, "link")}${summary("المحتوى", posts.length, mode === "demo" ? "مسودات وخطط التجربة المحلية" : "مسودات وخطط مساحة العمل", "file")}${summary("بانتظار الاعتماد", review.length, "طلبات محتوى تحتاج مراجعة", "users")}${summary("خطط النشر", planned.length, "لا يتم النشر آليًا في هذه النسخة", "calendar")}</div>
  <div class="home-columns"><div class="stack"><div class="card"><div class="section-head"><div><h3>ماذا تريد أن تنجز اليوم؟</h3><small>ابدأ بالمهمة، وليس بالتنقل بين المنصات</small></div><span class="badge gold">عملك اليومي</span></div><div class="quick-actions"><button class="btn primary" onclick="newPost()">+ إعداد محتوى</button><button class="btn" onclick="navigate('calendar')">${icon("calendar")} خطة النشر</button><button class="btn" onclick="navigate('content')">${icon("file")} مراجعة المسودات</button></div></div>
  <div class="card"><div class="section-head"><div><h3>المحتوى القادم</h3><small>أحدث ما حفظته في مساحة العمل</small></div><button class="btn small ghost" onclick="navigate('content')">عرض الكل ←</button></div>${
    posts.length
      ? `<div class="content-list">${posts
          .slice()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 3)
          .map((p) => postRow(p))
          .join("")}</div>`
      : emptyBlock(
          "أول منشور، بداية حضورك",
          "اكتب المحتوى مرة واحدة، واختر قنواتك ثم عاينه لكل قناة.",
          `<button class="btn small secondary" onclick="newPost()">إنشاء أول منشور</button>`,
        )
  }</div>
  ${isManager() ? `<div class="card"><div class="section-head"><div><h3>النتائج في مكان واحد</h3><small>مؤشرات حقيقية بعد الربط، وليس أرقامًا افتراضية</small></div><button class="btn small ghost" onclick="navigate('analytics')">التقارير ←</button></div><p class="muted" style="font-size:12px">لا توجد بيانات أداء متزامنة بعد. عند اكتمال التكامل، يظهر الوصول والتفاعل وأداء المحتوى بحسب ما توفره كل قناة.</p></div>` : ""}</div>
  <div class="stack">${
    isManager()
      ? `<div class="card"><div class="section-head"><div><h3>جهّز مساحة عملك</h3><small>${tasks.filter(Boolean).length} من 3 خطوات مكتملة</small></div><span class="badge">البداية</span></div><div class="setup-progress">${tasks.map((t) => `<span class="${t ? "done" : ""}"></span>`).join("")}</div>${checkItem("عرّف نشاطك التجاري", tasks[0], "startSetup()")}${checkItem("اختر قنواتك التسويقية", tasks[1], "navigate('channels')")}${checkItem("جهّز أول محتوى", tasks[2], "newPost()")}</div>
  <div class="card"><div class="section-head"><div><h3>قنوات نشاطك</h3><small>قنوات تختارها بحسب جمهورك</small></div><button class="btn small ghost" onclick="navigate('channels')">إدارة ←</button></div><div class="channel-strip">${selected.length ? selected.map(logo).join("") : CHANNELS.slice(0, 5).map(logo).join("")}</div><p class="muted" style="font-size:11px">${selected.length ? `${selected.length} قنوات مختارة؛ الربط الفعلي ينتظر تجهيز التكامل.` : "اختر القنوات التي تخدم عملك. لا تحتاج إلى استخدام كل منصة."}</p><button class="btn small" style="margin-top:15px" onclick="navigate('channels')">+ اختيار القنوات</button></div>`
      : `<div class="card"><h3>مساحة تنفيذ، لا إعدادات</h3><p class="muted" style="font-size:12px;margin-top:12px">جهّز المسودات ومعاينات القنوات، ثم أرسل المحتوى لصاحب النشاط للمراجعة. صلاحيتك محددة بعضويتك داخل مساحة العمل، وتُفرض على الخادم.</p></div>`
  }
  <div class="card" style="background:var(--navy);color:white;border-color:var(--navy)"><span class="eyebrow" style="color:#bea574">منشور واحد، أكثر من قناة</span><h3 style="margin-top:8px">نفس الفكرة.<br>الصيغة المناسبة لكل منصة.</h3><p style="color:#aebdcf;font-size:12px;margin:12px 0 17px">معاينة مستقلة وتنبيه لمتطلبات الصورة والفيديو وطول النص.</p><button class="btn primary small" onclick="newPost()">جرّب المحرر ←</button></div></div></div>`;
}
function checkItem(label, done, action) {
  return `<div class="check-item"><span class="check-circle ${done ? "done" : ""}">${done ? "✓" : ""}</span><span>${label}</span><button class="btn small ghost" onclick="${action}">${done ? "تعديل" : "بدء"} ←</button></div>`;
}
function verifiedConnections() {
  return mode === "live" ? connections.filter((c) => ["connected", "active", "verified"].includes(c.status) && c.verified !== false) : [];
}
function connectionFor(value) {
  const providers = { instagram: "ig", tiktok: "tt", twitter: "x", snapchat: "sc", whatsapp: "wa", facebook: "fb", google_business: "gbp", youtube: "yt", google_analytics: "ga4", google_ads: "gads", search_console: "gsc" };
  return verifiedConnections().find((c) => {
    const key = c.channelId || c.channel || c.service || c.details?.service || c.provider;
    return (providers[key] || key) === value;
  });
}
function canConnect(value) {
  const enabled = capabilities?.connect;
  return mode === "live" && isManager() && (enabled === true || (Array.isArray(enabled) && enabled.includes(value)));
}
function renderChannels() {
  const rows = CHANNELS.filter((c) =>
    channelFilter === "all" || channelFilter === "selected"
      ? channelFilter !== "selected" || state.selected.includes(c.id)
      : c.group === channelFilter,
  );
  return (
    pageTitle(
      "قنواتك، تحت سقف واحد",
      "اختر منصات جمهورك للتخطيط، واربط القنوات التي يتيحها الخادم لنشاطك.",
    ) +
    `<div class="notice info">اختيار القناة ليس ربطًا للحساب. نعرض الاتصال فقط حين يعيده الخادم موثّقًا؛ غياب إمكانات الربط يعطّل الزر ولا يفعّل نشرًا أو مزامنة.</div><div class="filters">${[
      ["all", "كل القنوات"],
      ["selected", "المختارة"],
      ["social", "منصات التواصل"],
      ["google", "منتجات قوقل"],
    ]
      .map(
        ([v, t]) =>
          `<button class="filter-btn ${channelFilter === v ? "active" : ""}" onclick="channelFilter='${v}';render()">${t}</button>`,
      )
      .join(
        "",
      )}<button class="btn small" style="margin-right:auto" onclick="connectGoogle()" ${canConnect("google") ? "" : 'disabled title="تكامل الربط غير جاهز"'}>مسار ربط قوقل الموحد ←</button></div>
  <div class="channel-grid">${rows.map((c) => c.id === "yt" && window.TaswiqatYouTube ? window.TaswiqatYouTube.renderCard(state.selected.includes("yt")) : `<div class="card channel-card"><div class="between"><div class="row">${logo(c)}<div><h3>${c.name}</h3><small class="muted">${c.group === "google" ? "منتجات قوقل" : "منصات التواصل"}</small></div></div></div><p>${c.description}</p><div class="between" style="margin-bottom:16px"><span class="badge ${connectionFor(c.id) ? "green" : ""}">${connectionFor(c.id) ? "اتصال موثّق من الخادم" : "لا يوجد اتصال موثّق"}</span>${state.selected.includes(c.id) ? '<span class="badge gold">مختارة للتخطيط</span>' : ""}</div><div class="row" style="flex-wrap:wrap"><button class="btn ${state.selected.includes(c.id) ? "" : "primary"}" onclick="selectChannel('${c.id}')">${state.selected.includes(c.id) ? "إلغاء الاختيار" : "اختيار القناة"}</button><button class="btn ghost" onclick="connectChannel('${c.id}')" ${canConnect(c.id) ? "" : 'disabled title="تكامل الربط غير جاهز"'}>${canConnect(c.id) ? "الربط ←" : "الربط غير جاهز"}</button></div></div>`).join("")}</div><p class="help-card">يوتيوب وسناب وواتساب تظهر في تخطيط المحتوى، لكن النشر عليها يتطلب صلاحيات وتكاملات مختلفة. Analytics وAds وSearch Console أدوات تحليل وإعلانات ولا تظهر كقنوات منشورات.</p>`
  );
}
async function selectChannel(value) {
  if (!isManager()) return;
  if (mode === "live" && state.selected.includes(value) && state.posts.some((p) => p.channels.includes(value))) {
    notify("هذه القناة مستخدمة في محتوى محفوظ. أزلها من المنشورات أولًا قبل إلغاء اختيارها من مساحة العمل."); return;
  }
  if (
    await changeState(() => {
      state.selected = state.selected.includes(value)
        ? state.selected.filter((v) => v !== value)
        : [...state.selected, value];
    })
  ) {
    render();
    notify("تم تحديث اختيار القنوات. لم يتم ربط أي حساب.");
  }
}
function connectGoogle() {
  showConnection("منتجات قوقل", "/api/oauth/google/connect?scope=unified");
}
function connectChannel(value) {
  if (value === "yt") return window.TaswiqatYouTube?.connect();
  const c = channel(value);
  if (c) showConnection(c.name, c.url);
}
function showConnection(name, url) {
  if (!isManager()) return;
  showAction(
    `ربط ${e(name)}`,
    `<p>مسار OAuth الأصلي محفوظ. لا يدل فتحه على نجاح الربط أو تفعيل النشر؛ ننتظر اتصالًا موثّقًا من الخادم.</p><div class="field" style="margin-top:20px"><label for="oauthPath">مسار الربط الحالي</label><input id="oauthPath" dir="ltr" readonly value="${e(url)}"></div><div class="dialog-actions"><button class="btn ghost" onclick="closeAction()">إغلاق</button><a class="btn primary" href="${e(url)}" onclick="return handleConnect(event,'${e(url)}')">متابعة الربط على الخادم ←</a></div>`,
  );
}
function handleConnect(event, url) {
  const targetChannel = CHANNELS.find((c) => c.url === url)?.id || "google";
  if (!canConnect(targetChannel)) {
    event.preventDefault();
    notify("مسار الربط محفوظ، لكن الخادم لم يوفّر قدرة الربط لهذه القناة.");
    return false;
  }
  return true;
}
let creatingWorkspace = false;
function startSetup(createNew = false) {
  return guardLeave(async () => {
    if ($("appView").hidden && mode === "demo") { mode = "live"; clearPrivateState(); }
    if (mode !== "demo" && forwardRealEntry("setup")) return;
    if (bootPromise) await bootPromise;
    if (mode !== "demo" && (!sessionInfo?.authenticated || sessionStatus === "error" || pendingInvite())) {
      setupAfterLogin = true;
      authView = "register";
      showSessionPanel();
      return;
    }
    if (mode === "live" && !createNew && !workspaceLoaded && activeWorkspaces().length) {
      if (!(await ensureWorkspace())) return;
    }
    if (workspaceLoaded && role === "employee" && !createNew) {
      notify("إعداد ملف النشاط متاح لصاحب النشاط ومدير مساحة العمل فقط."); return;
    }
    creatingWorkspace = mode === "live" && (createNew || !workspaceLoaded);
    fillSetup(creatingWorkspace ? freshState() : state);
    $("setupDescription").textContent = mode === "demo" ? "تجربة محلية بدون حساب؛ هذه المعلومات تُحفظ على المتصفح فقط ولا تُستورد إلى حساب حقيقي." : creatingWorkspace ? "أنشئ مساحة مرتبطة بحسابك. حدود القنوات والأعضاء يحددها الخادم؛ لا يفعّل هذا الإعداد أي دفع أو نشر." : "تُحفظ المعلومات في مساحة العمل الحالية على الخادم بعد نجاح الاتصال.";
    if (!$("setupDialog").open) $("setupDialog").showModal();
  });
}
function fillSetup(source = state) {
  $("businessName").value = source.business.name;
  $("businessType").value = source.business.type;
  $("businessMarket").value = source.business.market;
  $("businessWebsite").value = source.business.website;
  $("businessBio").value = source.business.bio;
  $("setupError").textContent = "";
  $("setupChannels").innerHTML = CHANNELS.map(
    (c) =>
      `<label class="channel-select"><input type="checkbox" name="channels" value="${c.id}" ${source.selected.includes(c.id) ? "checked" : ""}>${logo(c)}<span><strong>${c.name}</strong><small>اختيار للاستخدام لاحقًا</small></span></label>`,
  ).join("");
}
function closeSetup() {
  $("setupDialog").close();
}
async function saveSetup(event) {
  event.preventDefault();
  if (saving || (mode !== "demo" && !sessionInfo?.authenticated)) return;
  const name = $("businessName").value.trim();
  if (!name) {
    $("setupError").textContent = "اكتب اسم النشاط أولًا.";
    return;
  }
  const website = $("businessWebsite").value.trim();
  let validWebsite = true;
  try { if (website) { const u = new URL(website); validWebsite = u.protocol === "https:" && !u.username && !u.password; } }
  catch { validWebsite = false; }
  if (!validWebsite) {
    $("setupError").textContent =
      "استخدم رابط موقع HTTPS صالحًا دون اسم مستخدم أو كلمة مرور.";
    return;
  }
  const business = {
    name, type: $("businessType").value, market: $("businessMarket").value.trim(),
    website, bio: $("businessBio").value.trim(),
  };
  const selected = [...$("setupForm").querySelectorAll('[name="channels"]:checked')].map((n) => n.value);
  if (creatingWorkspace && mode === "live") {
    setSaving(true);
    try {
      const result = await api().createWorkspace(business, selected);
      if (!result?.workspaceId) throw new Error("لم يرجع الخادم معرّف مساحة العمل.");
      applyWorkspace(result, result.workspaceId);
      closeSetup();
      if (!(await refreshSession())) {
        showSessionPanel("أكد الخادم إنشاء مساحة العمل، لكن تعذّر تحديث الجلسة. أعد تحميلها ولا تنشئ مساحة مكررة.");
        return;
      }
      setupAfterLogin = false;
      if (!(await loadWorkspace(result.workspaceId))) {
        showSessionPanel("أكد الخادم إنشاء مساحة العمل، لكن تعذّر تحميل تفاصيلها. أعد المحاولة ولا تنشئ مساحة مكررة."); return;
      }
      showApp("overview");
      notify("تم إنشاء مساحة عملك وحفظ اختيار القنوات على الخادم. لم يُفعّل دفع أو ربط خارجي.");
    } catch (error) { $("setupError").textContent = error.message; }
    finally { setSaving(false); }
    return;
  }
  if (!isManager()) return;
  if (await changeState(() => { state.business = business; state.selected = selected; })) {
    closeSetup();
    showApp("overview");
    notify(mode === "demo" ? "تم حفظ ملف تجربة النشاط محليًا." : "تم حفظ ملف النشاط واختيار القنوات على الخادم.");
  }
}
function renderContent() {
  const rows = visiblePosts()
    .filter((p) => contentFilter === "all" || p.status === contentFilter)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    pageTitle(
      "مكتبة المحتوى",
      "كل مسوداتك وطلبات المراجعة وخطط النشر في مكان واحد.",
      `<button class="btn primary" onclick="newPost()">+ إنشاء منشور</button>`,
    ) +
    `<div class="filters">${[
      ["all", "الكل"],
      ["draft", "المسودات"],
      ["review", "للاعتماد"],
      ["ready", "جاهز للنشر"],
      ["planned", "خطط مجدولة"],
    ]
      .map(
        ([v, t]) =>
          `<button class="filter-btn ${contentFilter === v ? "active" : ""}" onclick="contentFilter='${v}';render()">${t}</button>`,
      )
      .join(
        "",
      )}</div>${rows.length ? `<div class="content-list">${rows.map((p) => postRow(p)).join("")}</div>` : emptyBlock("لا يوجد محتوى في هذا القسم", "أنشئ مسودة أو غيّر الفلتر لعرض المحتوى المحفوظ.", `<button class="btn secondary" onclick="newPost()">إعداد محتوى جديد</button>`)}`
  );
}
function mediaHTML(post, cls = "post-thumb") {
  const src = mediaSource(post.media);
  if (post.media?.type?.startsWith("image/") && src)
    return `<img class="${cls}" alt="وسيط المنشور" src="${e(src)}">`;
  return `<span class="${cls}" aria-hidden="true">${post.media ? "▷" : "≡"}</span>`;
}
function mediaSource(media) {
  if (!media) return "";
  if (/^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,/.test(media.data || "")) return media.data;
  if (mode === "live" && /^\/manus-storage\/taswiqat\/[a-zA-Z0-9_/-]+\.[a-z0-9]+$/.test(media.url || "")) return media.url;
  return "";
}
function postRow(p) {
  return `<article class="post-row">${mediaHTML(p)}<div class="post-text"><h3>${e(p.title || p.text.slice(0, 60) || "مسودة بدون عنوان")}</h3><p>${e(channelNames(p.channels) || "لم تُحدد القنوات")} ${p.campaignId ? `· ${e(state.campaigns.find((c) => c.id === p.campaignId)?.name || "")}` : ""}</p><p>${p.scheduledFor ? formatDateTime(p.scheduledFor) : "بدون موعد"} · ${e(postAuthorLabel(p))}</p></div><div class="post-actions">${postBadge(p)}${isManager() && p.status === "review" ? `<button class="btn small primary" onclick="approvePost('${e(p.id)}')">اعتماد</button>` : ""}<button class="btn small" onclick="editPost('${e(p.id)}')">${role === "employee" && !["draft", "review"].includes(p.status) ? "عرض فقط" : "عرض / تعديل"}</button>${isManager() ? `<button class="btn small danger" aria-label="حذف المنشور ${e(p.title)}" onclick="deletePost('${e(p.id)}')">×</button>` : ""}</div></article>`;
}
function blankDraft() {
  return {
    id: null,
    title: "",
    text: "",
    channels: [],
    media: null,
    campaignId: "",
    scheduledFor: "",
    author: mode === "live" ? sessionInfo?.user?.id || "" : role === "employee" ? "employee" : "merchant",
    dirty: false,
  };
}
function newPost(campaignId = "") {
  return guardLeave(async () => {
    if (mode !== "demo" && !(await ensureWorkspace())) return;
    draft = blankDraft();
    draft.campaignId = campaignId;
    draft.channels = state.selected.filter((v) => channel(v)?.publish);
    previewChannel = draft.channels[0] || "ig";
    composeStep = 1;
    showApp("compose");
  });
}
function editPost(value) {
  const post = state.posts.find((p) => p.id === value);
  if (!post || (role === "employee" && !ownPost(post))) return;
  if (role === "employee" && !["draft", "review"].includes(post.status)) {
    showAction("محتوى معتمد — للعرض فقط", `<p>${e(post.title)}</p><p style="white-space:pre-wrap">${e(post.text)}</p><p>${e(channelNames(post.channels))}</p><div class="notice info">تعديل المحتوى المعتمد متاح لإدارة النشاط فقط.</div><div class="dialog-actions"><button class="btn" onclick="closeAction()">إغلاق</button></div>`);
    return;
  }
  return guardLeave(() => {
    draft = JSON.parse(JSON.stringify(post));
    draft.dirty = false;
    composeStep = 1;
    previewChannel = draft.channels[0] || "ig";
    showApp("compose");
  });
}
function deletePost(value) {
  if (!isManager()) return;
  const post = state.posts.find((p) => p.id === value);
  if (!post || (role === "employee" && !ownPost(post))) return;
  showAction(
    "حذف المحتوى المحفوظ؟",
    `<p>سيُحذف «${e(post.title)}» من ${mode === "demo" ? "التجربة المحلية" : "مساحة العمل على الخادم"}. لا يوجد منشور خارجي لحذفه.</p><div class="dialog-actions"><button class="btn" onclick="closeAction()">إلغاء</button><button class="btn danger" onclick="confirmDeletePost('${e(value)}')">حذف</button></div>`,
  );
}
async function confirmDeletePost(value) {
  if (!isManager()) return;
  const post = state.posts.find((p) => p.id === value);
  if (!post || (role === "employee" && !ownPost(post))) return;
  if (
    await changeState(() => {
      state.posts = state.posts.filter((p) => p.id !== value);
    })
  ) {
    closeAction();
    render();
    notify(mode === "demo" ? "تم حذف محتوى التجربة المحلية." : "تم حذف المحتوى من مساحة العمل.");
  }
}
async function approvePost(value) {
  if (!isManager()) return;
  const post = state.posts.find((p) => p.id === value);
  if (!post) return;
  if (post.scheduledFor && new Date(post.scheduledFor) <= new Date()) {
    notify("الموعد المقترح مضى. عدّل الموعد قبل اعتماد خطة الجدولة.");
    return;
  }
  if (
    await changeState(() => {
      post.status = post.scheduledFor ? "planned" : "ready";
      post.updatedAt = new Date().toISOString();
    })
  ) {
    render();
    notify("تم حفظ اعتماد المحتوى. لم يتم إرساله لأي منصة.");
  }
}
function composeBody() {
  if (composeStep === 1)
    return `<div class="field"><label for="postTitle">عنوان داخلي للمنشور</label><input id="postTitle" maxlength="120" value="${e(draft.title)}" placeholder="مثال: حملة إطلاق الخدمة الجديدة" oninput="updateDraft('title',this.value)"><small>لتنظيم مكتبتك؛ لن يظهر في نص المنشور.</small></div><div class="field"><label for="postText">ماذا تريد أن تقول لجمهورك؟</label><textarea id="postText" maxlength="10000" placeholder="اكتب محتوى يناسب نشاطك، وسنساعدك على معاينته لكل قناة…" oninput="updateDraft('text',this.value)">${e(draft.text)}</textarea><div class="counter"><span>نص أساسي لجميع القنوات</span><span id="textCounter">${Array.from(draft.text).length} حرف</span></div></div><label class="upload-zone" for="postMedia"><span style="font-size:22px" aria-hidden="true">↥</span><strong>أضف صورة أو فيديو للمعاينة</strong><span>ملف واحد · صور PNG / JPG / WebP / GIF أو فيديو MP4 / WebM · حتى 3 MB</span><input id="postMedia" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onchange="uploadMedia(this)"></label>${draft.media ? `<div class="between" style="margin-top:12px"><small class="muted">${e(draft.media.name)}</small><button class="btn small danger" onclick="removeMedia()">إزالة الوسيط</button></div>` : ""}<div class="field" style="margin-top:20px"><label for="postCampaign">الحملة — اختياري</label><select id="postCampaign" onchange="updateDraft('campaignId',this.value)"><option value="">محتوى مستقل</option>${state.campaigns.map((c) => `<option value="${e(c.id)}" ${draft.campaignId === c.id ? "selected" : ""}>${e(c.name)}</option>`).join("")}</select></div>`;
  if (composeStep === 2)
    return `<h3 style="margin-bottom:7px">اختر أين يظهر محتواك</h3><p class="muted" style="font-size:12px;margin-bottom:18px">هذه قنوات للتخطيط والمعاينة فقط. الإرسال لاحقًا يتطلب ربطًا وصلاحيات فعلية لكل منصة.</p><fieldset style="border:0;padding:0;margin:0"><legend class="hidden">قنوات المنشور</legend><div class="selection-grid">${CHANNELS.filter(
      (c) => c.publish && (mode === "demo" || state.selected.includes(c.id)),
    )
      .map(
        (c) =>
          `<label class="channel-select"><input type="checkbox" value="${c.id}" ${draft.channels.includes(c.id) ? "checked" : ""} onchange="toggleDraftChannel('${c.id}',this.checked)">${logo(c)}<span><strong>${c.name}</strong><small>${c.kind === "video" ? "فيديو مطلوب" : c.kind === "visual" ? "صورة أو فيديو مطلوب" : c.id === "wa" ? "موافقات وقوالب مطلوبة" : c.id === "sc" ? "محتوى مرئي، تكامل Ads مختلف" : "نص ومحتوى مناسب للقناة"}</small></span></label>`,
      )
      .join(
        "",
      )}</div></fieldset><div class="notice info" style="margin-top:18px">أدوات التحليل والإعلانات مثل GA4 وGoogle Ads تُدار من مركز القنوات، وليس من محرر المنشورات.</div><div id="requirementsList" style="margin-top:18px">${renderRequirements()}</div>`;
  return `<h3>راجع المحتوى وحدد الموعد</h3><p class="muted" style="font-size:12px;margin:8px 0 20px">استخدم تبويبات المعاينة لمراجعة كل قناة قبل حفظ الخطة.</p><div class="field"><label for="deliveryMode">طريقة تجهيز المحتوى</label><select id="deliveryMode" onchange="changeDelivery(this.value)"><option value="now" ${!draft.scheduledFor ? "selected" : ""}>تجهيز للنشر الآن — بدون إرسال</option><option value="later" ${draft.scheduledFor ? "selected" : ""}>خطة نشر في موعد لاحق</option></select></div><div id="scheduleFields" ${draft.scheduledFor ? "" : "hidden"}><div class="two-cols"><div class="field"><label for="scheduleDate">التاريخ</label><input id="scheduleDate" type="date" min="${localDate(new Date())}" value="${draft.scheduledFor ? localDate(new Date(draft.scheduledFor)) : ""}" onchange="setSchedule()"></div><div class="field"><label for="scheduleTime">الوقت</label><input id="scheduleTime" type="time" value="${draft.scheduledFor ? localTime(new Date(draft.scheduledFor)) : ""}" onchange="setSchedule()"></div></div><small class="muted">المنطقة الزمنية: ${e(Intl.DateTimeFormat().resolvedOptions().timeZone)}، حسب جهازك.</small></div><div class="notice" style="margin-top:20px">${role === "employee" ? "يُحفظ طلبك «بانتظار الاعتماد» لصاحب النشاط." : "تُحفظ الخطة في مساحة العمل بعد نجاح الحفظ؛ لا يوجد إرسال فوري أو مجدول إلى المنصات."}</div><div style="margin-top:20px">${renderRequirements()}</div>`;
}
function renderComposer() {
  return (
    pageTitle(
      draft.id ? "تعديل المحتوى" : "من فكرة إلى منشور",
      "اكتب مرة واحدة، واختر قنواتك، وراجع كل صيغة قبل اعتمادها.",
    ) +
    `<div class="steps">${[
      ["المحتوى والوسائط", 1],
      ["اختيار القنوات", 2],
      ["المراجعة والموعد", 3],
    ]
      .map(
        ([title, step]) =>
          `<button class="step ${composeStep === step ? "active" : ""}" onclick="goStep(${step})" ${composeStep === step ? 'aria-current="step"' : ""}><b>${step}</b>${title}</button>`,
      )
      .join(
        "",
      )}</div><div class="composer-columns"><div class="card">${composeBody()}<div id="composeError" class="form-error" role="alert"></div><div class="compose-foot"><button class="btn" onclick="savePost('draft')">حفظ مسودة</button><div class="row">${composeStep > 1 ? `<button class="btn ghost" onclick="goStep(${composeStep - 1})">رجوع</button>` : ""}${composeStep < 3 ? `<button class="btn primary" onclick="goStep(${composeStep + 1})">التالي ←</button>` : `<button class="btn primary" onclick="savePost('${role === "employee" ? "review" : "final"}')">${role === "employee" ? "إرسال للمراجعة — بدون نشر" : draft.scheduledFor ? "حفظ خطة النشر" : "حفظ كجاهز للنشر"}</button>`}</div></div></div><aside class="preview-panel"><div class="between"><h3>معاينة المحتوى</h3><span class="badge">تصور تقريبي</span></div><p class="muted" style="font-size:11px;margin:6px 0 15px">الصيغة النهائية تخضع لتنسيق كل منصة.</p><div id="previewTabs" class="preview-tabs"></div><div id="postPreview"></div><p class="muted" style="font-size:10px;margin-top:12px">هذه المعاينة ليست منشورًا فعليًا أو حسابًا مرتبطًا.</p></aside></div>`
  );
}
function updateDraft(key, value) {
  draft[key] = value;
  draft.dirty = true;
  if ($("textCounter"))
    $("textCounter").textContent = `${Array.from(draft.text).length} حرف`;
  updatePreview();
}
function toggleDraftChannel(value, checked) {
  draft.channels = checked
    ? [...new Set([...draft.channels, value])]
    : draft.channels.filter((c) => c !== value);
  draft.dirty = true;
  if (!draft.channels.includes(previewChannel))
    previewChannel = draft.channels[0] || "ig";
  if ($("requirementsList"))
    $("requirementsList").innerHTML = renderRequirements();
  updatePreview();
}
function updatePreview() {
  if (!$("postPreview")) return;
  const ids = draft.channels.length ? draft.channels : ["ig"];
  if (!ids.includes(previewChannel)) previewChannel = ids[0];
  const c = channel(previewChannel) || CHANNELS[0];
  $("previewTabs").innerHTML = ids
    .map(
      (v) =>
        `<button class="filter-btn ${previewChannel === v ? "active" : ""}" onclick="previewChannel='${v}';updatePreview()">${e(channel(v)?.name)}</button>`,
    )
    .join("");
  let media = "";
  if (draft.media) {
    const m = draft.media;
    const src = mediaSource(m);
    if (m.type?.startsWith("image/") && src)
      media = `<img class="preview-media" alt="معاينة وسيط المنشور" src="${e(src)}">`;
    else if (m.type?.startsWith("video/") && src)
      media = `<video class="preview-media" controls preload="metadata" src="${e(src)}"></video>`;
  }
  const vertical = ["video", "vertical"].includes(c.kind),
    text = e(draft.text || "سيظهر محتوى منشورك هنا…");
  $("postPreview").innerHTML =
    `<article class="preview-card ${vertical ? "vertical" : ""} ${c.id === "wa" ? "whatsapp" : ""}"><div class="preview-header">${logo(c)}<div><strong>${e(state.business.name || "اسم نشاطك")}</strong><small>${c.name} · معاينة فقط</small></div><span style="margin-right:auto" aria-hidden="true">···</span></div>${media || (["visual", "video", "vertical"].includes(c.kind) ? '<div style="padding:50px 16px;text-align:center;background:var(--bg);color:var(--muted);font-size:12px">أضف وسيطًا لمعاينة المحتوى المرئي</div>' : "")}<div class="preview-content">${text}</div><div class="preview-bottom">${c.id === "wa" ? "رسالة أعمال · بدون إرسال" : c.id === "gbp" ? "تحديث النشاط · بدون نشر" : "تفاعل · تعليق · مشاركة"}</div></article>`;
}
function requirementIssues() {
  const issues = [];
  draft.channels.forEach((value) => {
    const c = channel(value);
    if (!c) return;
    const len = Array.from(draft.text).length;
    if (len > c.limit)
      issues.push(
        `${c.name}: النص يتجاوز الحد الإرشادي للمعاينة (${c.limit} حرفًا).`,
      );
    if (c.kind === "video" && !draft.media?.type?.startsWith("video/"))
      issues.push(`${c.name}: أضف فيديو لهذا النوع من المحتوى.`);
    if (["visual", "vertical"].includes(c.kind) && !draft.media)
      issues.push(`${c.name}: أضف صورة أو فيديو.`);
  });
  return issues;
}
function renderRequirements() {
  return draft.channels
    .map((value) => {
      const c = channel(value);
      const special =
        c.id === "yt"
          ? "الربط الحالي للقراءة فقط؛ رفع الفيديو يحتاج صلاحية إضافية."
          : c.id === "sc"
            ? "التكامل الحالي للإعلانات؛ خطة المحتوى لا تعني نشر قصص مباشرًا."
            : c.id === "wa"
              ? "الإرسال التجاري يحتاج موافقات وقوالب وسياسة رسائل."
              : c.id === "x"
                ? "280 حرفًا حد إرشادي للحساب القياسي."
                : c.kind === "video"
                  ? "الفيديو مطلوب؛ تحقق من مدته وأبعاده عند تجهيز التكامل."
                  : c.kind === "visual"
                    ? "صورة أو فيديو مطلوب؛ اختر الصيغة المناسبة قبل النشر."
                    : `حد النص الإرشادي في هذه المعاينة: ${c.limit} حرفًا.`;
      return `<div class="requirement">${logo(c)}<div><strong>${c.name}</strong><br>${special}</div></div>`;
    })
    .join("");
}
function goStep(step) {
  if (step > composeStep) {
    if (composeStep === 1 && !draft.text.trim() && !draft.media) {
      $("composeError").textContent = "اكتب نصًا أو أضف وسيطًا قبل المتابعة.";
      return;
    }
    if (step === 3 && !draft.channels.length) {
      $("composeError").textContent = "اختر قناة واحدة على الأقل.";
      return;
    }
  }
  composeStep = step;
  render();
}
function uploadMedia(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (saving) return;
  const valid = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
  ];
  if (!valid.includes(file.type) || file.size > 3 * 1024 * 1024) {
    notify("اختر صورة أو فيديو مدعومًا لا يتجاوز 3 MB للمعاينة المحلية.");
    input.value = "";
    return;
  }
  const reader = new FileReader();
  const editor = draft;
  const scope = workspaceId;
  draft.dirty = true;
  reader.onload = () => {
    if (draft !== editor || workspaceId !== scope) return;
    draft.media = {
      name: file.name,
      type: file.type,
      data: String(reader.result),
    };
    draft.dirty = true;
    render();
  };
  reader.onerror = () => notify("تعذّرت قراءة الملف.");
  reader.readAsDataURL(file);
}
function removeMedia() {
  draft.media = null;
  draft.dirty = true;
  render();
}
function localDate(d) {
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localTime(d) {
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function changeDelivery(value) {
  draft.scheduledFor = value === "later" ? "pending" : "";
  draft.dirty = true;
  $("scheduleFields").hidden = value !== "later";
  const btn = $("appMain").querySelector(".compose-foot .btn.primary");
  if (btn && isManager())
    btn.textContent = value === "later" ? "حفظ خطة النشر" : "حفظ كجاهز للنشر";
}
function setSchedule() {
  const date = $("scheduleDate").value,
    time = $("scheduleTime").value;
  draft.scheduledFor =
    date && time ? new Date(`${date}T${time}`).toISOString() : "pending";
  draft.dirty = true;
}
async function savePost(saveMode, silent = false) {
  if (saving || !["draft", "review", "final"].includes(saveMode)) return false;
  if (role === "employee" && saveMode === "final") saveMode = "review";
  if (role === "employee" && draft.id && !ownPost(draft)) return false;
  if (!draft.text.trim() && !draft.media) {
    if ($("composeError"))
      $("composeError").textContent = "أضف نصًا أو وسيطًا لحفظ المحتوى.";
    return false;
  }
  if (saveMode !== "draft") {
    if (!draft.channels.length) {
      $("composeError").textContent =
        "اختر قناة واحدة على الأقل قبل اعتماد المحتوى.";
      return false;
    }
    const issues = requirementIssues();
    if (issues.length) {
      $("composeError").textContent = issues.join(" ");
      return false;
    }
    if (
      draft.scheduledFor &&
      (draft.scheduledFor === "pending" ||
        !Number.isFinite(Date.parse(draft.scheduledFor)) ||
        new Date(draft.scheduledFor) <= new Date())
    ) {
      $("composeError").textContent = "اختر تاريخًا ووقتًا صحيحين في المستقبل.";
      return false;
    }
  }
  const target =
    saveMode === "final" ? (draft.scheduledFor ? "planned" : "ready") : saveMode;
  const post = {
    ...draft,
    id: draft.id || id(),
    title: draft.title.trim() || draft.text.trim().slice(0, 55) || "محتوى مرئي",
    text: draft.text.trim(),
    status: target,
    scheduledFor: draft.scheduledFor === "pending" ? "" : draft.scheduledFor,
    updatedAt: new Date().toISOString(),
    dirty: false,
  };
  if (mode === "live") {
    delete post.dirty;
    delete post.authorId;
    post.campaignId = post.campaignId || null;
    post.scheduledFor = post.scheduledFor || null;
  }
  if (
    !(await changeState(() => {
      const found = state.posts.findIndex((p) => p.id === post.id);
      if (found < 0) state.posts.push(post);
      else state.posts[found] = post;
    }))
  )
    return false;
  draft = JSON.parse(JSON.stringify(state.posts.find((p) => p.id === post.id) || post));
  draft.dirty = false;
  if (!silent) {
    notify(
      mode === "demo" ? "تم حفظ محتوى التجربة على هذا المتصفح فقط."
        : saveMode === "draft" ? "تم حفظ المسودة على الخادم."
        : "تم حفظ المحتوى على الخادم، ولم يُنشر على أي منصة.",
    );
    contentFilter = "all";
    showApp("content");
  }
  return true;
}
function formatDateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? e(
        date.toLocaleString("ar", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      )
    : "موعد غير محدد";
}
function renderCalendar() {
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + calendarOffset, 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const rows = visiblePosts()
    .filter(
      (p) =>
        p.scheduledFor &&
        new Date(p.scheduledFor) >= month &&
        new Date(p.scheduledFor) < end,
    )
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const days = [
    ...new Set(rows.map((p) => localDate(new Date(p.scheduledFor)))),
  ];
  return (
    pageTitle(
      "تقويم النشر",
      "خطط زمنية للمحتوى، وليست مهام إرسال فعلية.",
      `<button class="btn primary" onclick="newPost()">+ خطة محتوى</button>`,
    ) +
    `<div class="between" style="margin-bottom:22px"><h3>${e(month.toLocaleDateString("ar", { month: "long", year: "numeric" }))}</h3><div class="row"><button class="btn small" aria-label="الشهر السابق" onclick="calendarOffset--;render()">→</button><button class="btn small" onclick="calendarOffset=0;render()">هذا الشهر</button><button class="btn small" aria-label="الشهر التالي" onclick="calendarOffset++;render()">←</button></div></div><div class="notice info" style="margin-bottom:22px">الأوقات حسب ${e(Intl.DateTimeFormat().resolvedOptions().timeZone)}. لن يُرسل المحتوى تلقائيًا في الموعد قبل إضافة خدمة النشر والجدولة.</div>${
      days.length
        ? days
            .map((day) => {
              const date = new Date(`${day}T12:00:00`);
              return `<div class="timeline-group"><div class="timeline-date"><strong>${date.getDate()}</strong>${e(date.toLocaleDateString("ar", { weekday: "long" }))}</div><div class="timeline-posts">${rows
                .filter((p) => localDate(new Date(p.scheduledFor)) === day)
                .map(postRow)
                .join("")}</div></div>`;
            })
            .join("")
        : emptyBlock(
            "لا توجد خطط في هذا الشهر",
            "حدد موعدًا في خطوة المراجعة داخل محرر المنشور، وسيظهر هنا.",
            `<button class="btn secondary" onclick="newPost()">تجهيز منشور</button>`,
          )
    }`
  );
}
function renderCampaigns() {
  return (
    pageTitle(
      "حملات تجمع محتواك",
      "اربط المنشورات بهدف أو موسم واحد، مهما كان نوع نشاطك.",
      `<button class="btn primary" onclick="newCampaign()">+ حملة جديدة</button>`,
    ) +
    `${
      state.campaigns.length
        ? `<div class="campaign-grid">${state.campaigns
            .map((c) => {
              const posts = state.posts.filter((p) => p.campaignId === c.id);
              return `<div class="card"><span class="badge gold">خطة حملة</span><h3 style="margin:14px 0 5px">${e(c.name)}</h3><p class="muted" style="font-size:12px;min-height:45px">${e(c.goal || "لم يُحدد هدف")}</p><div class="between" style="margin:20px 0"><span class="muted" style="font-size:12px">${posts.length} محتوى</span><small>${posts.filter((p) => ["ready", "planned"].includes(p.status)).length} محتوى معتمد — بدون نشر</small></div><button class="btn small" onclick="draftForCampaign('${e(c.id)}')">+ إضافة محتوى</button></div>`;
            })
            .join("")}</div>`
        : emptyBlock(
            "ابدأ بحملة لها هدف",
            "إطلاق منتج، تعريف بخدمة، عروض موسم، أو بناء حضور علامتك.",
            `<button class="btn secondary" onclick="newCampaign()">إنشاء أول حملة</button>`,
          )
    }`
  );
}
function newCampaign() {
  if (!isManager()) return;
  showAction(
    "حملة جديدة",
    `<p>الحملة تنظّم محتوى مساحة العمل فقط؛ لا تنشئ إعلانًا أو ميزانية لدى المنصات.</p><form onsubmit="saveCampaign(event)"><div class="field"><label for="campaignName">اسم الحملة</label><input id="campaignName" required maxlength="100" placeholder="مثال: إطلاق خدماتنا الجديدة"></div><div class="field"><label for="campaignGoal">هدف الحملة</label><input id="campaignGoal" maxlength="200" placeholder="مثال: تعريف الجمهور بالخدمة"></div><div class="dialog-actions"><button type="button" class="btn" onclick="closeAction()">إلغاء</button><button class="btn primary" type="submit">حفظ الحملة</button></div></form>`,
  );
}
async function saveCampaign(event) {
  event.preventDefault();
  if (!isManager() || saving) return;
  const name = $("campaignName").value.trim();
  if (!name) {
    notify("اكتب اسم الحملة.");
    return;
  }
  if (
    await changeState(() =>
      state.campaigns.push({
        id: id(),
        name,
        goal: $("campaignGoal").value.trim(),
      }),
    )
  ) {
    closeAction();
    render();
    notify(mode === "demo" ? "تم حفظ خطة حملة التجربة محليًا." : "تم حفظ خطة الحملة على الخادم.");
  }
}
function draftForCampaign(value) {
  return newPost(value);
}
function renderAnalytics() {
  return (
    pageTitle(
      "النتائج والتقارير",
      "اعرف ما ينجح في تسويقك، عندما تتوفر بيانات فعلية.",
    ) +
    `<div class="summary-grid">${summary("الوصول", "—", "بانتظار بيانات المنصات", "chart")}${summary("التفاعل", "—", "لا يوجد حساب متزامن", "message")}${summary("المحتوى المنشور", "—", "لا يوجد نشر فعلي بعد", "file")}${summary("زيارات الموقع", "—", "يتطلب ربط أداة التحليل", "link")}</div><div class="card">${emptyBlock("لا توجد نتائج متزامنة بعد", "تحتاج التقارير إلى حسابات مرتبطة وبيانات أداء موثقة. لن نعرض أرقامًا أو نموًا افتراضيًا على أنها نتائج حقيقية.", `<button class="btn secondary" onclick="navigate('channels')">استعرض مركز القنوات</button>`)}</div><div class="notice info" style="margin-top:20px">عند إضافة التكامل، يجب عرض مصدر المؤشر والفترة الزمنية وآخر مزامنة. تتفاوت المؤشرات المتاحة بحسب القناة وصلاحيات الحساب.</div>`
  );
}
function renderInbox() {
  return (
    pageTitle(
      "صندوق التواصل",
      "مكان واحد للرسائل والتعليقات والتقييمات التي تسمح القنوات بجلبها.",
      mode === "live" ? '<button class="btn primary" onclick="newTicket()">طلب دعم أو حذف بيانات</button>' : "",
    ) +
    `<div class="card">${emptyBlock("لا توجد محادثات متزامنة", "صندوق التواصل ينتظر التكامل الفعلي. لا توجد رسائل عملاء أو ردود تلقائية في هذه المعاينة.", `<button class="btn secondary" onclick="navigate('channels')">اختيار القنوات</button>`)}</div><p class="help-card">معلومات نشاطك ومنتجاته وخدماته تساعد على تجهيز ردود مناسبة لأي مجال. المنيو أداة تخص المطاعم، وليس أساس تجربة تسويقات للجميع.</p>`
  );
}
function renderTeam() {
  const rows = mode === "demo" ? state.team : teamRows;
  const description = mode === "demo" ? "فريق التجربة المحلية فقط؛ لا توجد حسابات أو دعوات فعلية." : "أعضاء مساحة العمل والدعوات بحسب سجلات الخادم. الدور داخل النشاط لا يتبدل من الواجهة.";
  return (
    pageTitle(
      "فريقك التسويقي",
      description,
      `<button class="btn primary" onclick="newTeamMember()">${mode === "demo" ? "+ مسودة دعوة تجريبية" : "+ إنشاء رابط دعوة"}</button>`,
    ) +
    `<div class="notice info" style="margin-bottom:22px">${mode === "demo" ? "البيانات في هذه التجربة محلية فقط." : "الدعوات روابط مشاركة وليست رسائل بريد مرسلة. يجب تسجيل الدخول بالحساب الموافق للدعوة لقبولها؛ الخادم يفرض صلاحيات الفريق وحدود الباقة."}</div><div class="card"><div class="section-head"><h3>أعضاء الفريق</h3>${mode === "live" ? '<button class="btn small" onclick="loadTeam()">تحديث</button>' : ""}</div>${mode === "live" && teamStatus === "loading" ? '<p class="muted" role="status">جارٍ تحميل أعضاء الفريق من الخادم…</p>' : mode === "live" && teamStatus === "error" ? `<div class="notice" role="alert">${e(teamError)} <button class="btn small" onclick="loadTeam()">إعادة المحاولة</button></div>` : rows.length ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th></tr></thead><tbody>${rows.map((t) => `<tr><td>${e(t.name || t.user?.name)}</td><td dir="ltr">${e(t.email || t.user?.email)}</td><td>${roleLabel(t.role)}</td><td><span class="badge">${mode === "demo" ? "مسودة تجريبية — لم تُرسل" : e(({ active: "عضو نشط", pending: "بانتظار قبول الدعوة", invited: "رابط دعوة", accepted: "تم القبول", expired: "منتهية", revoked: "ملغاة" })[t.status] || t.status || "عضوية مسجلة")}</span></td></tr>`).join("")}</tbody></table></div>` : emptyBlock("لا يوجد أعضاء إضافيون بعد", mode === "demo" ? "أضف مسودة محلية للتجربة فقط." : "أنشئ رابط دعوة وشاركه مع فريقك. لن نعلن عن إرسال بريد إلكتروني.")}</div>`
  );
}
async function loadTeam() {
  if (mode !== "live" || !isManager() || !workspaceId || teamStatus === "loading") return;
  const scope = workspaceId;
  teamStatus = "loading"; teamError = "";
  if (currentView === "team") render();
  try {
    const result = await api().team(scope);
    if (mode !== "live" || workspaceId !== scope) return;
    const rows = Array.isArray(result) ? result : Array.isArray(result?.team) ? result.team
      : Array.isArray(result?.members) ? [...result.members, ...(Array.isArray(result.invitations) ? result.invitations : [])] : null;
    if (!Array.isArray(rows)) throw new Error("استجابة أعضاء الفريق غير مكتملة.");
    teamRows = rows; teamStatus = "loaded";
  } catch (error) {
    if (workspaceId !== scope) return;
    teamStatus = "error"; teamError = error.message;
  }
  if (currentView === "team" && workspaceLoaded) render();
}
function newTeamMember() {
  if (!isManager()) return;
  showAction(
    mode === "demo" ? "مسودة دعوة محلية" : "إنشاء رابط دعوة للفريق",
    `<p>${mode === "demo" ? "تُحفظ مسودة محلية فقط، ولا يُنشأ حساب أو رابط صالح." : "سننشئ رابط مشاركة بعد موافقة الخادم. هذا ليس بريدًا مرسلًا، ولا يمنح عضوية قبل قبول المدعو."}</p><form onsubmit="saveTeam(event)"><div class="field"><label for="memberName">الاسم</label><input id="memberName" required maxlength="80"></div><div class="field"><label for="memberEmail">بريد الحساب المدعو</label><input id="memberEmail" type="email" required dir="ltr" maxlength="254"></div><div class="field"><label for="memberPermission">الدور داخل مساحة العمل</label><select id="memberPermission"><option value="employee">موظف — إعداد المحتوى وإرساله للمراجعة</option><option value="manager">مدير — المحتوى والفريق والإعدادات</option></select></div><div class="form-error" id="teamFormError" role="alert"></div><div class="dialog-actions"><button class="btn" type="button" onclick="closeAction()">إلغاء</button><button class="btn primary" type="submit">${mode === "demo" ? "حفظ مسودة محلية" : "إنشاء رابط الدعوة"}</button></div></form>`,
  );
}
async function saveTeam(event) {
  event.preventDefault();
  if (!isManager() || saving) return;
  const name = $("memberName").value.trim(),
    email = $("memberEmail").value.trim();
  const memberRole = $("memberPermission").value;
  if (!name || !email || !["employee", "manager"].includes(memberRole)) return;
  if (mode === "demo") {
    if (await changeState(() => state.team.push({ id: id(), name, email, role: memberRole }))) {
      closeAction(); render(); notify("تم حفظ مسودة محلية؛ لا رابط صالح ولا بريد مرسل.");
    }
    return;
  }
  setSaving(true);
  try {
    const result = await api().invite(workspaceId, { name, email, role: memberRole });
    if (!result?.path || !result.token) throw new Error("لم يرجع الخادم رابط دعوة مكتملًا.");
    const url = new URL(result.path, location.origin);
    if (url.origin !== location.origin || !url.hash.startsWith("#invite/")) throw new Error("رابط الدعوة غير صالح للمشاركة.");
    showAction("رابط الدعوة جاهز للمشاركة", `<div class="notice info">رابط مشاركة وليس بريدًا مرسلًا. شاركه مع ${e(email)}؛ الخادم يتحقق من هوية المدعو قبل قبول الدعوة.</div><div class="field" style="margin-top:20px"><label for="invitationLink">رابط الدعوة</label><input class="session-invitation-link" id="invitationLink" readonly value="${e(url.href)}"></div><div class="dialog-actions"><button class="btn primary" onclick="copyInvitationLink()">نسخ الرابط</button><button class="btn" onclick="closeAction()">إغلاق</button></div>`);
    teamStatus = "idle";
    await loadTeam();
    try { applyWorkspace(await api().workspaceState(workspaceId), workspaceId); }
    catch (error) { notify(`تم إنشاء رابط الدعوة، لكن تعذّر تحديث نسخة مساحة العمل. ${error.message}`); }
  } catch (error) {
    if ($("teamFormError")) $("teamFormError").textContent = error.message;
    else notify(error.message);
  } finally { setSaving(false); }
}
async function copyInvitationLink() {
  const input = $("invitationLink");
  if (!input) return;
  try { await navigator.clipboard.writeText(input.value); notify("تم نسخ رابط المشاركة. لم يُرسل بريد."); }
  catch { input.focus(); input.select(); notify("انسخ الرابط المحدد يدويًا. لم يُرسل بريد."); }
}
function newTicket() {
  if (mode !== "live" || !sessionInfo?.authenticated || !workspaceLoaded) { notify("الدعم عبر التذاكر متاح داخل مساحة عمل حقيقية محمّلة."); return; }
  showAction("تذكرة دعم لمساحة العمل", '<p>يُرسل الطلب إلى سجل الدعم على الخادم بعد نجاح الاتصال.</p><form onsubmit="saveTicket(event)"><div class="field"><label for="ticketSubject">الموضوع</label><input id="ticketSubject" required maxlength="160"></div><div class="field"><label for="ticketMessage">تفاصيل الطلب</label><textarea id="ticketMessage" required maxlength="5000"></textarea></div><div id="ticketError" class="form-error" role="alert"></div><div class="dialog-actions"><button class="btn" type="button" onclick="closeAction()">إلغاء</button><button class="btn primary" type="submit">إرسال طلب الدعم</button></div></form>');
}
async function saveTicket(event) {
  event.preventDefault();
  if (mode !== "live" || !workspaceLoaded || saving) return;
  const subject = $("ticketSubject").value.trim(), message = $("ticketMessage").value.trim();
  if (!subject || !message) return;
  setSaving(true);
  try {
    await api().ticket(workspaceId, subject, message);
    closeAction(); notify("تم تسجيل تذكرة الدعم على الخادم.");
  } catch (error) { if ($("ticketError")) $("ticketError").textContent = error.message; else notify(error.message); }
  finally { setSaving(false); }
  }
function renderSettings() {
  const planInfo = mode === "live" && subscription ? `<div class="card" style="margin-bottom:20px"><h3>باقة مساحة العمل</h3><p class="muted" style="margin:12px 0">${e(workspacePlan?.name || subscription.planId || "الباقة الحالية")} · ${e(({ trial: "فترة تجريبية", active: "سجل اشتراك نشط", suspended: "موقوف", expired: "منتهي", cancelled: "ملغى" })[subscription.status] || subscription.status)}</p>${workspacePlan ? `<p class="muted">حد القنوات: ${e(workspacePlan.channels)} · حد أعضاء الفريق: ${e(workspacePlan.members)}؛ الدعوات المعلقة تحتسب ضمن الحد.</p>` : ""}${subscription.trialEndsAt ? `<p class="muted">نهاية التجربة: ${formatDateTime(subscription.trialEndsAt)}</p>` : ""}<div class="notice info">هذا سجل باقة على الخادم وليس إثبات دفع. لا يوجد شراء أو تحصيل مفعّل هنا. تجاوز الحدود أو انتهاء التجربة يظهر كرفض صريح من الخادم.</div></div>` : "";
  return (
    pageTitle("ملف النشاط", "معلومات مشروعك، بغض النظر عن مجاله أو حجمه.") + planInfo +
    `<div class="card settings-form"><div class="section-head"><h3>${e(state.business.name || "عرّف نشاطك التجاري")}</h3><button class="btn small" onclick="startSetup()">تعديل البيانات</button></div><dl style="font-size:13px;display:grid;grid-template-columns:110px 1fr;gap:14px;margin:15px 0"><dt class="muted">نوع النشاط</dt><dd style="margin:0">${e(state.business.type)}</dd><dt class="muted">السوق المستهدف</dt><dd style="margin:0">${e(state.business.market || "لم يُحدد")}</dd><dt class="muted">الموقع</dt><dd dir="ltr" style="margin:0;overflow-wrap:anywhere">${e(state.business.website || "—")}</dd><dt class="muted">نبذة</dt><dd style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${e(state.business.bio || "أضف نبذة عن منتجاتك أو خدماتك وجمهورك.")}</dd></dl><div class="notice info">معلومات النشاط ليست منيو افتراضيًا؛ تُستخدم حسب طبيعة عملك لتجهيز المحتوى والردود لاحقًا.</div><div class="danger-area"><h3 style="font-size:14px">نسخة بيانات مساحة العمل</h3><p class="muted" style="font-size:12px;margin:8px 0 15px">صدّر نسخة JSON من المساحة الحالية فقط. قد يحتوي الملف معلومات خاصة. إعادة الضبط متاحة للتجربة المحلية فقط، ولا تحذف مساحة العمل الحقيقية.</p><div class="row" style="flex-wrap:wrap"><button class="btn small" onclick="exportLocalData()">تصدير مساحة العمل</button><button class="btn small danger" onclick="resetLocalData()" ${mode === "demo" ? "" : 'disabled title="لا يمكن حذف مساحة العمل الحقيقية عبر إعادة الضبط"'}>مسح بيانات التجربة</button></div></div></div>`
  );
}
function exportLocalData() {
  if (mode !== "demo" && !workspaceLoaded) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = mode === "demo" ? "taswiqat-demo-data.json" : `taswiqat-workspace-${workspaceId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(mode === "demo" ? "تم تجهيز تصدير بيانات التجربة المحلية." : "تم تجهيز نسخة JSON لمساحة العمل الحالية فقط. الملف قد يحتوي بيانات خاصة؛ شاركه بحذر.");
}
function resetLocalData() {
  if (mode !== "demo" || !isManager()) { notify("إعادة ضبط مساحة العمل الحقيقية غير متاحة هنا. يمكن تصدير نسخة دون حذفها."); return; }
  showAction(
    "مسح بيانات المعاينة المحلية؟",
    `<p>يشمل ملف النشاط والمسودات وخطط الحملات ودعوات الفريق على هذا المتصفح. لا يتصل بأي حساب أو قاعدة بيانات خارجية. يمكنك تصدير نسخة أولًا من ملف النشاط.</p><div class="dialog-actions"><button class="btn" onclick="closeAction()">إلغاء</button><button class="btn danger" onclick="confirmReset()">مسح البيانات المحلية</button></div>`,
  );
}
async function confirmReset() {
  if (mode !== "demo" || !isManager()) return;
  const theme = state.theme;
  if (
    await changeState(() => {
      state = freshState();
      state.theme = theme;
    })
  ) {
    closeAction();
    draft = blankDraft();
    render();
    notify("تم مسح بيانات المعاينة المحلية.");
  }
}
function showAction(title, body) {
  $("actionDialog").innerHTML =
    `<div class="dialog-head"><span class="eyebrow">تسويقات</span><button class="icon-btn" aria-label="إغلاق" onclick="closeAction()">×</button></div><h2 id="actionTitle">${title}</h2>${body}`;
  if (!$("actionDialog").open) $("actionDialog").showModal();
}
function closeAction() {
  pendingNavigation = null;
  $("actionDialog").close();
}
function captureInvite(hash) {
  const match = hash.match(/^#invite\/([^/?#\s]{1,512})$/);
  if (!match) return false;
  try { rememberInvite(decodeURIComponent(match[1])); return true; } catch { return false; }
}
async function routeTo(hash) {
  const accountView = authRouteView(hash);
  if (accountView) {
    if (mode === "demo") { mode = "live"; clearPrivateState(); }
    const remote = remoteAppURL("overview");
    if (remote) { remote.hash = hash; window.location.assign(remote.href); return; }
    authView = accountView;
    const providerFailed = new URLSearchParams(hash.split("?")[1] || "").get("error") === "provider_login_failed";
    showSessionPanel(providerFailed ? "تعذّر إكمال تسجيل الدخول؛ حاول مجددًا أو استخدم طريقة الدخول المعتادة." : "");
    return;
  }
  if (captureInvite(hash)) {
    if (forwardRealEntry("overview")) return;
    if (mode === "demo") { mode = "live"; clearPrivateState(); }
    showSessionPanel();
    return;
  }
  const parts = hash.match(/^#(app|employee|demo)(?:\/([a-z]+))?$/);
  if (parts) {
    const view = youtubeReturnIntent ? "channels" : parts[2] || "overview";
    requestedView = view === "setup" ? "overview" : view;
    if (parts[1] === "demo") {
      if (mode === "demo") showApp(view, true);
      else showSessionPanel("للدخول إلى التجربة المحلية، اختر «تجربة الواجهة بدون حساب» صراحةً.");
      return;
    }
    if (mode === "demo") { mode = "live"; clearPrivateState(); }
    if (forwardRealEntry(view)) return;
    if (view === "setup") { await startSetup(); return; }
    if (await ensureWorkspace()) {
      showApp(view, true);
      if (youtubeReturnIntent) {
        const outcome = youtubeReturnIntent.outcome;
        youtubeReturnIntent = null;
        const messages = {cancelled:"لم يكتمل تفويض يوتيوب. بقي الاتصال السابق كما هو إن كان موجودًا.",missing_channel:"لم نعثر على قناة متاحة للحساب المختار. اختر حسابًا آخر.",failed:"تعذّر إكمال تفويض القناة. لم نفترض نجاح الاتصال.",requires_reauth:"يلزم تجديد إذن الوصول إلى القناة."};
        if (messages[outcome]) notify(messages[outcome]);
        void window.TaswiqatYouTube?.refresh().then(() => $("youtubeConnectCard")?.focus({preventScroll:true}));
      }
    }
    return;
  }
  if (pendingInvite() && sessionInfo?.authenticated) { showSessionPanel(); return; }
  window.TaswiqatAuthPortal?.unmount();
  $("landingView").hidden = false;
  $("appView").hidden = true;
  $("sessionView").hidden = true;
  toggleMenu(false);
}
function restoreRoute() {
  const hash = location.hash;
  if (saving) { history.replaceState(null, "", routeHash()); return; }
  if (draft.dirty && hash !== routeHash()) {
    history.replaceState(null, "", routeHash());
    return guardLeave(() => routeTo(hash));
  }
  return routeTo(hash).catch((error) => { sessionError = error.message; sessionStatus = "error"; showSessionPanel(); });
}
function initializeCustomerApp() {
  if (!$("appView") || !$("sessionPanel")) return;
  window.TaswiqatYouTube?.configure({
    context: () => ({mode,authenticated:!!sessionInfo?.authenticated,loaded:workspaceLoaded,workspaceId,canManage:isManager(),view:currentView}),
    render, guardLeave,
    connectionChanged: (connection, expectedId) => {
      if (mode !== "live" || workspaceId !== expectedId) return;
      connections = connections.filter(row => !["yt","youtube"].includes(row.provider));
      if (connection) connections.push(connection);
    },
  });
  const returnedURL = new URL(location.href);
  const outcome = returnedURL.searchParams.get("youtube");
  const returnedWorkspace = returnedURL.searchParams.get("workspace");
  if (["connected","choose","cancelled","missing_channel","failed","requires_reauth"].includes(outcome) && /^[A-Za-z0-9_-]{1,80}$/.test(returnedWorkspace || "")) {
    youtubeReturnIntent = {workspaceId:returnedWorkspace,outcome};
    returnedURL.searchParams.delete("youtube"); returnedURL.searchParams.delete("workspace");
    history.replaceState(null, "", `${returnedURL.pathname}${returnedURL.search}#app/channels`);
  }
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  });
  try { document.body.classList.toggle("dark", localStorage.getItem("taswiqat.theme") === "dark"); } catch { /* Theme is optional. */ }
  captureInvite(location.hash);
  try {
    setupAfterLogin = sessionStorage.getItem("taswiqat.afterLogin") === "setup";
    sessionStorage.removeItem("taswiqat.afterLogin");
  } catch { /* Navigation intent only. */ }
  const demoEntry = document.createElement("button");
  demoEntry.type = "button";
  demoEntry.className = "btn ghost session-demo-entry";
  demoEntry.textContent = "تجربة الواجهة بدون حساب";
  demoEntry.addEventListener("click", startDemo);
  const landingActions = document.querySelector(".landing-hero-actions");
  if (landingActions) landingActions.append(demoEntry);
  // deployment.js must precede this script. Static hosting never contacts the
  // protected API on another origin; normal entry is a full-page navigation.
  if (remoteAppURL()) {
    sessionStatus = "remote";
    bootPromise = Promise.resolve(true);
  } else {
    if (/^#(app|employee|invite|auth)/.test(location.hash)) showSessionPanel();
    bootPromise = refreshSession();
  }
  bootPromise.then(() => {
    if (setupAfterLogin && sessionInfo?.authenticated && !pendingInvite() && !authRouteView()) return startSetup();
    return restoreRoute();
  }).catch((error) => { sessionStatus = "error"; sessionError = error.message; showSessionPanel(); });
}
window.addEventListener("hashchange", restoreRoute);
window.addEventListener("popstate", restoreRoute);
window.addEventListener("beforeunload", (event) => {
  if (draft.dirty || saving) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("taswiqat:session-expired", () => {
  sessionInfo = null; sessionStatus = "anonymous";
  if (mode === "live") {
    ++loadEpoch; clearPrivateState();
    $("setupDialog")?.close(); $("actionDialog")?.close();
    showSessionPanel("انتهت الجلسة. سجّل الدخول مجددًا للوصول إلى بياناتك.");
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === "taswiqat.theme") document.body.classList.toggle("dark", event.newValue === "dark");
  if (mode === "demo" && event.key === STORE_KEY) {
    state = loadDemoState(); storageSnapshot = rawStorage();
    if (draft.dirty) notify("تغيّرت بيانات التجربة في تبويب آخر. مسودتك بقيت في المحرر.");
    if (!$("appView").hidden) render();
  }
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeCustomerApp, { once: true });
else initializeCustomerApp();
