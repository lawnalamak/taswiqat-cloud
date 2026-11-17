"use strict";

// UI-only release. OAuth URLs deliberately match the existing server.
// Real connections, publishing, auth, metrics and messages belong to the integration agent.
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
let state = loadState();
let storageSnapshot = rawStorage();
let pendingNavigation = null;
let role = "merchant";
let currentView = "overview";
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
function loadState() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
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
  } catch {
    return freshState();
  }
}
function rawStorage() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function persist() {
  try {
    const payload = JSON.stringify(state);
    localStorage.setItem(STORE_KEY, payload);
    storageSnapshot = payload;
    return true;
  } catch {
    notify("تعذّر الحفظ على المتصفح. قلّل حجم الوسائط أو فعّل التخزين المحلي.");
    return false;
  }
}
function changeState(mutator) {
  if (rawStorage() !== storageSnapshot) {
    state = loadState();
    storageSnapshot = rawStorage();
    notify(
      "تغيّرت البيانات في تبويب آخر. مسودتك بقيت في المحرر وحمّلنا أحدث البيانات؛ أعد محاولة الحفظ.",
    );
    return false;
  }
  const before = JSON.stringify(state);
  mutator();
  if (persist()) return true;
  state = JSON.parse(before);
  return false;
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
  return `<span class="channel-logo ${e(c.id)}" aria-hidden="true">${e(c.short)}</span>`;
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
  if (
    changeState(() => {
      state.theme = state.theme === "dark" ? "light" : "dark";
    })
  )
    document.body.classList.toggle("dark", state.theme === "dark");
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
  return `#${role === "employee" ? "employee" : "app"}/${currentView}`;
}
function guardLeave(callback) {
  if (!draft.dirty) {
    callback();
    return;
  }
  pendingNavigation = callback;
  showAction(
    "مغادرة مسودة غير محفوظة؟",
    `<p>تشمل المسودة النص والوسائط والقنوات والموعد. احفظها أو تجاهلها قبل المغادرة.</p><div class="dialog-actions"><button class="btn ghost" onclick="closeAction()">البقاء</button><button class="btn secondary" onclick="resolveLeave(true)">حفظ المسودة</button><button class="btn danger" onclick="resolveLeave(false)">تجاهل</button></div>`,
  );
}
function resolveLeave(save) {
  if (save && !savePost("draft", true)) {
    notify("تعذّر حفظ المسودة. أضف نصًا أو وسيطًا، أو اختر تجاهل التغييرات.");
    return;
  }
  const callback = pendingNavigation;
  pendingNavigation = null;
  draft = blankDraft();
  closeAction();
  if (callback) callback();
}
function openApp(view = "overview") {
  guardLeave(() => {
    role = "merchant";
    showApp(view);
  });
}
function openEmployee() {
  guardLeave(() => {
    role =
      !$("appView").hidden && role === "employee" ? "merchant" : "employee";
    showApp("overview");
  });
}
function showLanding() {
  guardLeave(showLandingNow);
}
function showLandingNow() {
  $("landingView").hidden = false;
  $("appView").hidden = true;
  toggleMenu(false);
  history.pushState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);
}
function showApp(view = "overview", replace = false) {
  const allowed =
    role === "employee" ? EMPLOYEE_VIEWS : [...NAV.map((n) => n.id), "compose"];
  currentView = allowed.includes(view) ? view : "overview";
  $("landingView").hidden = true;
  $("appView").hidden = false;
  toggleMenu(false);
  if (replace) history.replaceState(null, "", routeHash());
  else if (location.hash !== routeHash())
    history.pushState(null, "", routeHash());
  render();
  window.scrollTo(0, 0);
}
function navigate(view) {
  guardLeave(() => showApp(view));
}
function visiblePosts() {
  return role === "employee"
    ? state.posts.filter((p) => p.author === "employee")
    : state.posts;
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
  $("workspaceName").textContent = state.business.name || "نشاطك التجاري";
  $("workspaceType").textContent = state.business.name
    ? state.business.type
    : "كل قنواتك في مكان واحد";
  $("roleName").textContent =
    role === "employee" ? "تجربة الموظف" : "صاحب النشاط";
  $("userAvatar").textContent = (state.business.name || "تسويقات").slice(0, 1);
  $("switchRoleButton").textContent =
    role === "employee" ? "العودة لتجربة صاحب النشاط" : "استكشاف تجربة الموظف";
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
    `<div class="app-banner">نسخة واجهات: البيانات تُحفظ على هذا المتصفح فقط. الربط والنشر والرسائل والنتائج الفعلية لم تُفعّل. ${role === "employee" ? "تبديل الأدوار هنا للاستعراض؛ ليس تسجيل دخول أو حماية صلاحيات فعلية." : ""}</div><div class="view-enter">${views[currentView]()}</div>`;
  if (currentView === "compose") updatePreview();
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
  <div class="summary-grid">${summary("القنوات المختارة", selected.length, "اختيار فقط · لا توجد حسابات مرتبطة", "link")}${summary("المحتوى", posts.length, "مسودات وخطط محفوظة محليًا", "file")}${summary("بانتظار الاعتماد", review.length, "طلبات محتوى تحتاج مراجعة", "users")}${summary("خطط النشر", planned.length, "لا يتم النشر آليًا في هذه النسخة", "calendar")}</div>
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
  ${role === "merchant" ? `<div class="card"><div class="section-head"><div><h3>النتائج في مكان واحد</h3><small>مؤشرات حقيقية بعد الربط، وليس أرقامًا افتراضية</small></div><button class="btn small ghost" onclick="navigate('analytics')">التقارير ←</button></div><p class="muted" style="font-size:12px">لا توجد بيانات أداء متزامنة بعد. عند اكتمال التكامل، يظهر الوصول والتفاعل وأداء المحتوى بحسب ما توفره كل قناة.</p></div>` : ""}</div>
  <div class="stack">${
    role === "merchant"
      ? `<div class="card"><div class="section-head"><div><h3>جهّز مساحة عملك</h3><small>${tasks.filter(Boolean).length} من 3 خطوات مكتملة</small></div><span class="badge">البداية</span></div><div class="setup-progress">${tasks.map((t) => `<span class="${t ? "done" : ""}"></span>`).join("")}</div>${checkItem("عرّف نشاطك التجاري", tasks[0], "startSetup()")}${checkItem("اختر قنواتك التسويقية", tasks[1], "navigate('channels')")}${checkItem("جهّز أول محتوى", tasks[2], "newPost()")}</div>
  <div class="card"><div class="section-head"><div><h3>قنوات نشاطك</h3><small>قنوات تختارها بحسب جمهورك</small></div><button class="btn small ghost" onclick="navigate('channels')">إدارة ←</button></div><div class="channel-strip">${selected.length ? selected.map(logo).join("") : CHANNELS.slice(0, 5).map(logo).join("")}</div><p class="muted" style="font-size:11px">${selected.length ? `${selected.length} قنوات مختارة؛ الربط الفعلي ينتظر تجهيز التكامل.` : "اختر القنوات التي تخدم عملك. لا تحتاج إلى استخدام كل منصة."}</p><button class="btn small" style="margin-top:15px" onclick="navigate('channels')">+ اختيار القنوات</button></div>`
      : `<div class="card"><h3>مساحة تنفيذ، لا إعدادات</h3><p class="muted" style="font-size:12px;margin-top:12px">جهّز المسودات ومعاينات القنوات، ثم أرسل المحتوى لصاحب النشاط للمراجعة. هذه تجربة بصرية للصلاحيات المقترحة.</p></div>`
  }
  <div class="card" style="background:var(--navy);color:white;border-color:var(--navy)"><span class="eyebrow" style="color:#bea574">منشور واحد، أكثر من قناة</span><h3 style="margin-top:8px">نفس الفكرة.<br>الصيغة المناسبة لكل منصة.</h3><p style="color:#aebdcf;font-size:12px;margin:12px 0 17px">معاينة مستقلة وتنبيه لمتطلبات الصورة والفيديو وطول النص.</p><button class="btn primary small" onclick="newPost()">جرّب المحرر ←</button></div></div></div>`;
}
function checkItem(label, done, action) {
  return `<div class="check-item"><span class="check-circle ${done ? "done" : ""}">${done ? "✓" : ""}</span><span>${label}</span><button class="btn small ghost" onclick="${action}">${done ? "تعديل" : "بدء"} ←</button></div>`;
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
      "اختر منصات جمهورك، ثم اربط حساباتك عند تجهيز التكامل.",
    ) +
    `<div class="notice info">اختيار القناة ليس ربطًا للحساب. جميع حالات الربط هنا «غير مربوط» إلى أن يزوّد الوكيل التقني الواجهة باتصال موثّق.</div><div class="filters">${[
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
      )}<button class="btn small" style="margin-right:auto" onclick="connectGoogle()">مسار ربط قوقل الموحد ←</button></div>
  <div class="channel-grid">${rows.map((c) => `<div class="card channel-card"><div class="between"><div class="row">${logo(c)}<div><h3>${c.name}</h3><small class="muted">${c.group === "google" ? "منتجات قوقل" : "منصات التواصل"}</small></div></div></div><p>${c.description}</p><div class="between" style="margin-bottom:16px"><span class="badge">غير مربوط</span>${state.selected.includes(c.id) ? '<span class="badge gold">ضمن قنواتك</span>' : ""}</div><div class="row" style="flex-wrap:wrap"><button class="btn ${state.selected.includes(c.id) ? "" : "primary"}" onclick="selectChannel('${c.id}')">${state.selected.includes(c.id) ? "إلغاء الاختيار" : "اختيار القناة"}</button><button class="btn ghost" onclick="connectChannel('${c.id}')">الربط ←</button></div></div>`).join("")}</div><p class="help-card">يوتيوب وسناب وواتساب تظهر في تخطيط المحتوى، لكن النشر عليها يتطلب صلاحيات وتكاملات مختلفة. Analytics وAds وSearch Console أدوات تحليل وإعلانات ولا تظهر كقنوات منشورات.</p>`
  );
}
function selectChannel(value) {
  if (role !== "merchant") return;
  if (
    changeState(() => {
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
  const c = channel(value);
  if (c) showConnection(c.name, c.url);
}
function showConnection(name, url) {
  if (role !== "merchant") return;
  showAction(
    `ربط ${e(name)}`,
    `<p>حافظنا على مسار OAuth الموجود في مشروعك. هذه نسخة واجهات بلا خادم تكامل، لذلك لا يمكن إكمال الربط هنا ولا سنغيّر حالة الحساب إلى «متصل».</p><div class="notice info">يتولى الوكيل التقني تشغيل الخادم، تبادل رمز التفويض، وحفظ الحساب المتصل ثم إظهار حالته هنا.</div><div class="field" style="margin-top:20px"><label for="oauthPath">مسار الربط الحالي</label><input id="oauthPath" dir="ltr" readonly value="${e(url)}"></div><div class="dialog-actions"><button class="btn ghost" onclick="closeAction()">إغلاق</button><a class="btn primary" href="${e(url)}" onclick="return handleConnect(event,'${e(url)}')">متابعة الربط على الخادم ←</a></div><small class="muted">لن يفتح المسار إلا إذا فعّل الوكيل التقني <code dir="ltr">TASWIQAT_BACKEND_READY</code>.</small>`,
  );
}
function handleConnect(event, url) {
  if (!window.TASWIQAT_BACKEND_READY) {
    event.preventDefault();
    notify("مسار الربط محفوظ، لكن خادم التكامل لم يُفعّل في هذه النسخة.");
    return false;
  }
  return true;
}
function startSetup() {
  if (role === "employee" && !$("appView").hidden) {
    notify("إعداد ملف النشاط متاح لصاحب النشاط في هذه المعاينة.");
    return;
  }
  fillSetup();
  $("setupDialog").showModal();
}
function fillSetup() {
  $("businessName").value = state.business.name;
  $("businessType").value = state.business.type;
  $("businessMarket").value = state.business.market;
  $("businessWebsite").value = state.business.website;
  $("businessBio").value = state.business.bio;
  $("setupError").textContent = "";
  $("setupChannels").innerHTML = CHANNELS.map(
    (c) =>
      `<label class="channel-select"><input type="checkbox" name="channels" value="${c.id}" ${state.selected.includes(c.id) ? "checked" : ""}>${logo(c)}<span><strong>${c.name}</strong><small>اختيار للاستخدام لاحقًا</small></span></label>`,
  ).join("");
}
function closeSetup() {
  $("setupDialog").close();
}
function saveSetup(event) {
  event.preventDefault();
  const name = $("businessName").value.trim();
  if (!name) {
    $("setupError").textContent = "اكتب اسم النشاط أولًا.";
    return;
  }
  const website = $("businessWebsite").value.trim();
  if (website && !/^https?:\/\//i.test(website)) {
    $("setupError").textContent =
      "استخدم رابط موقع يبدأ بـ https:// أو http://";
    return;
  }
  if (
    changeState(() => {
      state.business = {
        name,
        type: $("businessType").value,
        market: $("businessMarket").value.trim(),
        website,
        bio: $("businessBio").value.trim(),
      };
      state.selected = [
        ...$("setupForm").querySelectorAll('[name="channels"]:checked'),
      ].map((n) => n.value);
    })
  ) {
    closeSetup();
    openApp("overview");
    notify("تم حفظ ملف نشاطك واختيار قنواتك على هذا المتصفح.");
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
  if (
    post.media?.type?.startsWith("image/") &&
    /^data:image\/(png|jpeg|webp|gif);base64,/.test(post.media.data || "")
  )
    return `<img class="${cls}" alt="وسيط المنشور" src="${post.media.data}">`;
  return `<span class="${cls}" aria-hidden="true">${post.media ? "▷" : "≡"}</span>`;
}
function postRow(p) {
  return `<article class="post-row">${mediaHTML(p)}<div class="post-text"><h3>${e(p.title || p.text.slice(0, 60) || "مسودة بدون عنوان")}</h3><p>${e(channelNames(p.channels) || "لم تُحدد القنوات")} ${p.campaignId ? `· ${e(state.campaigns.find((c) => c.id === p.campaignId)?.name || "")}` : ""}</p><p>${p.scheduledFor ? formatDateTime(p.scheduledFor) : "بدون موعد"} · ${p.author === "employee" ? "مسودة الموظف" : "صاحب النشاط"}</p></div><div class="post-actions">${postBadge(p)}${role === "merchant" && p.status === "review" ? `<button class="btn small primary" onclick="approvePost('${e(p.id)}')">اعتماد</button>` : ""}<button class="btn small" onclick="editPost('${e(p.id)}')">عرض / تعديل</button><button class="btn small danger" aria-label="حذف المنشور ${e(p.title)}" onclick="deletePost('${e(p.id)}')">×</button></div></article>`;
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
    author: role === "employee" ? "employee" : "merchant",
    dirty: false,
  };
}
function newPost() {
  guardLeave(() => {
    draft = blankDraft();
    draft.channels = state.selected.filter((v) => channel(v)?.publish);
    previewChannel = draft.channels[0] || "ig";
    composeStep = 1;
    showApp("compose");
  });
}
function editPost(value) {
  const post = state.posts.find((p) => p.id === value);
  if (!post || (role === "employee" && post.author !== "employee")) return;
  draft = JSON.parse(JSON.stringify(post));
  draft.dirty = false;
  composeStep = 1;
  previewChannel = draft.channels[0] || "ig";
  showApp("compose");
}
function deletePost(value) {
  const post = state.posts.find((p) => p.id === value);
  if (!post || (role === "employee" && post.author !== "employee")) return;
  showAction(
    "حذف المحتوى المحفوظ؟",
    `<p>سيُحذف «${e(post.title)}» من هذا المتصفح فقط. لا يوجد منشور خارجي لحذفه.</p><div class="dialog-actions"><button class="btn" onclick="closeAction()">إلغاء</button><button class="btn danger" onclick="confirmDeletePost('${e(value)}')">حذف</button></div>`,
  );
}
function confirmDeletePost(value) {
  if (
    changeState(() => {
      state.posts = state.posts.filter((p) => p.id !== value);
    })
  ) {
    closeAction();
    render();
    notify("تم حذف المحتوى المحلي.");
  }
}
function approvePost(value) {
  if (role !== "merchant") return;
  const post = state.posts.find((p) => p.id === value);
  if (!post) return;
  if (post.scheduledFor && new Date(post.scheduledFor) <= new Date()) {
    notify("الموعد المقترح مضى. عدّل الموعد قبل اعتماد خطة الجدولة.");
    return;
  }
  if (
    changeState(() => {
      post.status = post.scheduledFor ? "planned" : "ready";
      post.updatedAt = new Date().toISOString();
    })
  ) {
    render();
    notify("تم اعتماد المحتوى محليًا. لم يتم إرساله لأي منصة.");
  }
}
function composeBody() {
  if (composeStep === 1)
    return `<div class="field"><label for="postTitle">عنوان داخلي للمنشور</label><input id="postTitle" maxlength="120" value="${e(draft.title)}" placeholder="مثال: حملة إطلاق الخدمة الجديدة" oninput="updateDraft('title',this.value)"><small>لتنظيم مكتبتك؛ لن يظهر في نص المنشور.</small></div><div class="field"><label for="postText">ماذا تريد أن تقول لجمهورك؟</label><textarea id="postText" maxlength="10000" placeholder="اكتب محتوى يناسب نشاطك، وسنساعدك على معاينته لكل قناة…" oninput="updateDraft('text',this.value)">${e(draft.text)}</textarea><div class="counter"><span>نص أساسي لجميع القنوات</span><span id="textCounter">${Array.from(draft.text).length} حرف</span></div></div><label class="upload-zone" for="postMedia"><span style="font-size:22px" aria-hidden="true">↥</span><strong>أضف صورة أو فيديو للمعاينة</strong><span>ملف واحد · صور PNG / JPG / WebP / GIF أو فيديو MP4 / WebM · حتى 3 MB</span><input id="postMedia" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onchange="uploadMedia(this)"></label>${draft.media ? `<div class="between" style="margin-top:12px"><small class="muted">${e(draft.media.name)}</small><button class="btn small danger" onclick="removeMedia()">إزالة الوسيط</button></div>` : ""}<div class="field" style="margin-top:20px"><label for="postCampaign">الحملة — اختياري</label><select id="postCampaign" onchange="updateDraft('campaignId',this.value)"><option value="">محتوى مستقل</option>${state.campaigns.map((c) => `<option value="${e(c.id)}" ${draft.campaignId === c.id ? "selected" : ""}>${e(c.name)}</option>`).join("")}</select></div>`;
  if (composeStep === 2)
    return `<h3 style="margin-bottom:7px">اختر أين يظهر محتواك</h3><p class="muted" style="font-size:12px;margin-bottom:18px">هذه قنوات للتخطيط والمعاينة فقط. الإرسال لاحقًا يتطلب ربطًا وصلاحيات فعلية لكل منصة.</p><fieldset style="border:0;padding:0;margin:0"><legend class="hidden">قنوات المنشور</legend><div class="selection-grid">${CHANNELS.filter(
      (c) => c.publish,
    )
      .map(
        (c) =>
          `<label class="channel-select"><input type="checkbox" value="${c.id}" ${draft.channels.includes(c.id) ? "checked" : ""} onchange="toggleDraftChannel('${c.id}',this.checked)">${logo(c)}<span><strong>${c.name}</strong><small>${c.kind === "video" ? "فيديو مطلوب" : c.kind === "visual" ? "صورة أو فيديو مطلوب" : c.id === "wa" ? "موافقات وقوالب مطلوبة" : c.id === "sc" ? "محتوى مرئي، تكامل Ads مختلف" : "نص ومحتوى مناسب للقناة"}</small></span></label>`,
      )
      .join(
        "",
      )}</div></fieldset><div class="notice info" style="margin-top:18px">أدوات التحليل والإعلانات مثل GA4 وGoogle Ads تُدار من مركز القنوات، وليس من محرر المنشورات.</div><div id="requirementsList" style="margin-top:18px">${renderRequirements()}</div>`;
  return `<h3>راجع المحتوى وحدد الموعد</h3><p class="muted" style="font-size:12px;margin:8px 0 20px">استخدم تبويبات المعاينة لمراجعة كل قناة قبل حفظ الخطة.</p><div class="field"><label for="deliveryMode">طريقة تجهيز المحتوى</label><select id="deliveryMode" onchange="changeDelivery(this.value)"><option value="now" ${!draft.scheduledFor ? "selected" : ""}>تجهيز للنشر الآن — بدون إرسال</option><option value="later" ${draft.scheduledFor ? "selected" : ""}>خطة نشر في موعد لاحق</option></select></div><div id="scheduleFields" ${draft.scheduledFor ? "" : "hidden"}><div class="two-cols"><div class="field"><label for="scheduleDate">التاريخ</label><input id="scheduleDate" type="date" min="${localDate(new Date())}" value="${draft.scheduledFor ? localDate(new Date(draft.scheduledFor)) : ""}" onchange="setSchedule()"></div><div class="field"><label for="scheduleTime">الوقت</label><input id="scheduleTime" type="time" value="${draft.scheduledFor ? localTime(new Date(draft.scheduledFor)) : ""}" onchange="setSchedule()"></div></div><small class="muted">المنطقة الزمنية: ${e(Intl.DateTimeFormat().resolvedOptions().timeZone)}، حسب جهازك.</small></div><div class="notice" style="margin-top:20px">${role === "employee" ? "يُحفظ طلبك «بانتظار الاعتماد» لصاحب النشاط." : "تُحفظ الخطة داخل المتصفح فقط؛ لا يوجد إرسال فوري أو مجدول إلى المنصات في هذه النسخة."}</div><div style="margin-top:20px">${renderRequirements()}</div>`;
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
      )}</div><div class="composer-columns"><div class="card">${composeBody()}<div id="composeError" class="form-error" role="alert"></div><div class="compose-foot"><button class="btn" onclick="savePost('draft')">حفظ مسودة</button><div class="row">${composeStep > 1 ? `<button class="btn ghost" onclick="goStep(${composeStep - 1})">رجوع</button>` : ""}${composeStep < 3 ? `<button class="btn primary" onclick="goStep(${composeStep + 1})">التالي ←</button>` : `<button class="btn primary" onclick="savePost('${role === "employee" ? "review" : "final"}')">${role === "employee" ? "إرسال للمراجعة محليًا" : draft.scheduledFor ? "حفظ خطة النشر" : "حفظ كجاهز للنشر"}</button>`}</div></div></div><aside class="preview-panel"><div class="between"><h3>معاينة المحتوى</h3><span class="badge">تصور تقريبي</span></div><p class="muted" style="font-size:11px;margin:6px 0 15px">الصيغة النهائية تخضع لتنسيق كل منصة.</p><div id="previewTabs" class="preview-tabs"></div><div id="postPreview"></div><p class="muted" style="font-size:10px;margin-top:12px">هذه المعاينة ليست منشورًا فعليًا أو حسابًا مرتبطًا.</p></aside></div>`
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
    if (
      m.type?.startsWith("image/") &&
      /^data:image\/(png|jpeg|webp|gif);base64,/.test(m.data || "")
    )
      media = `<img class="preview-media" alt="معاينة وسيط المنشور" src="${m.data}">`;
    else if (
      m.type?.startsWith("video/") &&
      /^data:video\/(mp4|webm);base64,/.test(m.data || "")
    )
      media = `<video class="preview-media" controls preload="metadata" src="${m.data}"></video>`;
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
  reader.onload = () => {
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
  if (btn && role === "merchant")
    btn.textContent = value === "later" ? "حفظ خطة النشر" : "حفظ كجاهز للنشر";
}
function setSchedule() {
  const date = $("scheduleDate").value,
    time = $("scheduleTime").value;
  draft.scheduledFor =
    date && time ? new Date(`${date}T${time}`).toISOString() : "pending";
  draft.dirty = true;
}
function savePost(mode, silent = false) {
  if (!draft.text.trim() && !draft.media) {
    if ($("composeError"))
      $("composeError").textContent = "أضف نصًا أو وسيطًا لحفظ المحتوى.";
    return false;
  }
  if (mode !== "draft") {
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
    mode === "final" ? (draft.scheduledFor ? "planned" : "ready") : mode;
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
  if (
    !changeState(() => {
      const found = state.posts.findIndex((p) => p.id === post.id);
      if (found < 0) state.posts.push(post);
      else state.posts[found] = post;
    })
  )
    return false;
  draft = JSON.parse(JSON.stringify(post));
  draft.dirty = false;
  if (!silent) {
    notify(
      mode === "draft"
        ? "تم حفظ المسودة على هذا المتصفح."
        : "تم حفظ المحتوى محليًا، ولم يُنشر على أي منصة.",
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
              return `<div class="card"><span class="badge gold">خطة حملة</span><h3 style="margin:14px 0 5px">${e(c.name)}</h3><p class="muted" style="font-size:12px;min-height:45px">${e(c.goal || "لم يُحدد هدف")}</p><div class="between" style="margin:20px 0"><span class="muted" style="font-size:12px">${posts.length} محتوى</span><small>${posts.filter((p) => ["ready", "planned"].includes(p.status)).length} معتمد محليًا</small></div><button class="btn small" onclick="draftForCampaign('${e(c.id)}')">+ إضافة محتوى</button></div>`;
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
  if (role !== "merchant") return;
  showAction(
    "حملة جديدة",
    `<p>الحملة هنا تنظّم محتواك محليًا؛ لا تنشئ إعلانًا أو ميزانية لدى المنصات.</p><form onsubmit="saveCampaign(event)"><div class="field"><label for="campaignName">اسم الحملة</label><input id="campaignName" required maxlength="100" placeholder="مثال: إطلاق خدماتنا الجديدة"></div><div class="field"><label for="campaignGoal">هدف الحملة</label><input id="campaignGoal" maxlength="200" placeholder="مثال: تعريف الجمهور بالخدمة"></div><div class="dialog-actions"><button type="button" class="btn" onclick="closeAction()">إلغاء</button><button class="btn primary" type="submit">حفظ الحملة</button></div></form>`,
  );
}
function saveCampaign(event) {
  event.preventDefault();
  const name = $("campaignName").value.trim();
  if (!name) {
    notify("اكتب اسم الحملة.");
    return;
  }
  if (
    changeState(() =>
      state.campaigns.push({
        id: id(),
        name,
        goal: $("campaignGoal").value.trim(),
      }),
    )
  ) {
    closeAction();
    render();
    notify("تم حفظ خطة الحملة محليًا.");
  }
}
function draftForCampaign(value) {
  newPost();
  draft.campaignId = value;
  render();
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
    ) +
    `<div class="card">${emptyBlock("لا توجد محادثات متزامنة", "صندوق التواصل ينتظر التكامل الفعلي. لا توجد رسائل عملاء أو ردود تلقائية في هذه المعاينة.", `<button class="btn secondary" onclick="navigate('channels')">اختيار القنوات</button>`)}</div><p class="help-card">معلومات نشاطك ومنتجاته وخدماته تساعد على تجهيز ردود مناسبة لأي مجال. المنيو أداة تخص المطاعم، وليس أساس تجربة تسويقات للجميع.</p>`
  );
}
function renderTeam() {
  return (
    pageTitle(
      "فريقك التسويقي",
      "تجربة منفصلة لإعداد المحتوى ومراجعته، بعيدًا عن إعدادات الربط.",
      `<button class="btn primary" onclick="newTeamMember()">+ مسودة دعوة</button>`,
    ) +
    `<div class="notice info" style="margin-bottom:22px">هذه صلاحيات مقترحة في الواجهة، وليست حسابات دخول فعلية. تطبيق الصلاحيات وإرسال الدعوات يحتاجان خادمًا موثّقًا.</div><div class="card"><div class="section-head"><h3>أعضاء الفريق المقترحون</h3><button class="btn small" onclick="openEmployee()">استكشف تجربة الموظف ←</button></div>${state.team.length ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور المقترح</th><th>الحالة</th></tr></thead><tbody>${state.team.map((t) => `<tr><td>${e(t.name)}</td><td dir="ltr">${e(t.email)}</td><td>${e(t.permission)}</td><td><span class="badge">مسودة دعوة — لم تُرسل</span></td></tr>`).join("")}</tbody></table></div>` : emptyBlock("لم تضف أعضاء بعد", "أنشئ مسودة دعوة لتنظيم الفريق. لن ننشئ حسابًا أو نرسل بريدًا فعليًا.")}</div>`
  );
}
function newTeamMember() {
  if (role !== "merchant") return;
  showAction(
    "تجهيز دعوة موظف",
    `<p>تُحفظ مسودة الدعوة محليًا فقط. لا يُرسل بريد ولا يُنشأ حساب دخول.</p><form onsubmit="saveTeam(event)"><div class="field"><label for="memberName">اسم الموظف</label><input id="memberName" required maxlength="80"></div><div class="field"><label for="memberEmail">البريد الإلكتروني</label><input id="memberEmail" type="email" required dir="ltr"></div><div class="field"><label for="memberPermission">الدور المقترح</label><select id="memberPermission"><option>إعداد محتوى وإرساله للاعتماد</option><option>مراجعة المحتوى</option><option>متابعة النتائج</option></select></div><div class="dialog-actions"><button class="btn" type="button" onclick="closeAction()">إلغاء</button><button class="btn primary" type="submit">حفظ مسودة الدعوة</button></div></form>`,
  );
}
function saveTeam(event) {
  event.preventDefault();
  const name = $("memberName").value.trim(),
    email = $("memberEmail").value.trim();
  if (!name) return;
  if (state.team.some((t) => t.email.toLowerCase() === email.toLowerCase())) {
    notify("توجد مسودة دعوة بهذا البريد بالفعل.");
    return;
  }
  if (
    changeState(() =>
      state.team.push({
        id: id(),
        name,
        email,
        permission: $("memberPermission").value,
      }),
    )
  ) {
    closeAction();
    render();
    notify("تم حفظ مسودة الدعوة، ولم تُرسل.");
  }
}
function renderSettings() {
  return (
    pageTitle("ملف النشاط", "معلومات مشروعك، بغض النظر عن مجاله أو حجمه.") +
    `<div class="card settings-form"><div class="section-head"><h3>${e(state.business.name || "عرّف نشاطك التجاري")}</h3><button class="btn small" onclick="startSetup()">تعديل البيانات</button></div><dl style="font-size:13px;display:grid;grid-template-columns:110px 1fr;gap:14px;margin:15px 0"><dt class="muted">نوع النشاط</dt><dd style="margin:0">${e(state.business.type)}</dd><dt class="muted">السوق المستهدف</dt><dd style="margin:0">${e(state.business.market || "لم يُحدد")}</dd><dt class="muted">الموقع</dt><dd dir="ltr" style="margin:0;overflow-wrap:anywhere">${e(state.business.website || "—")}</dd><dt class="muted">نبذة</dt><dd style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${e(state.business.bio || "أضف نبذة عن منتجاتك أو خدماتك وجمهورك.")}</dd></dl><div class="notice info">معلومات النشاط ليست منيو افتراضيًا؛ تُستخدم حسب طبيعة عملك لتجهيز المحتوى والردود لاحقًا.</div><div class="danger-area"><h3 style="font-size:14px">نسخة البيانات المحلية</h3><p class="muted" style="font-size:12px;margin:8px 0 15px">احفظ نسخة JSON للوكيل التقني أو امسح بيانات المعاينة من هذا المتصفح فقط.</p><div class="row" style="flex-wrap:wrap"><button class="btn small" onclick="exportLocalData()">تصدير البيانات المحلية</button><button class="btn small danger" onclick="resetLocalData()">مسح بيانات المعاينة</button></div></div></div>`
  );
}
function exportLocalData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "taswiqat-local-data.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("تم تجهيز تصدير بيانات هذا المتصفح فقط.");
}
function resetLocalData() {
  if (role !== "merchant") return;
  showAction(
    "مسح بيانات المعاينة المحلية؟",
    `<p>يشمل ملف النشاط والمسودات وخطط الحملات ودعوات الفريق على هذا المتصفح. لا يتصل بأي حساب أو قاعدة بيانات خارجية. يمكنك تصدير نسخة أولًا من ملف النشاط.</p><div class="dialog-actions"><button class="btn" onclick="closeAction()">إلغاء</button><button class="btn danger" onclick="confirmReset()">مسح البيانات المحلية</button></div>`,
  );
}
function confirmReset() {
  const theme = state.theme;
  if (
    changeState(() => {
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
function restoreRoute() {
  const parts = location.hash.match(/^#(app|employee)\/([a-z]+)$/);
  if (parts) {
    role = parts[1] === "employee" ? "employee" : "merchant";
    showApp(parts[2], true);
  } else {
    $("landingView").hidden = false;
    $("appView").hidden = true;
    toggleMenu(false);
  }
}
window.addEventListener("popstate", restoreRoute);
window.addEventListener("hashchange", restoreRoute);
window.addEventListener("beforeunload", (event) => {
  if (draft.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === STORE_KEY) {
    state = loadState();
    storageSnapshot = rawStorage();
    document.body.classList.toggle("dark", state.theme === "dark");
    if (draft.dirty) {
      notify(
        "تغيّرت بيانات مساحة العمل في تبويب آخر. حمّلنا أحدث البيانات وحافظنا على مسودتك في المحرر.",
      );
      return;
    }
    if (!$("appView").hidden) render();
  }
});
document.body.classList.toggle("dark", state.theme === "dark");
restoreRoute();
