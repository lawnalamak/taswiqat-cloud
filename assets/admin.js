"use strict";

/* Operator UI: same-origin session-gated API by default. The backend must enforce
 * admin authorization, CSRF, workspace isolation and optimistic concurrency.
 * A local prototype exists ONLY behind an explicit demo button. No automatic fallback.
 * Canonical backend state and version are accepted only after a successful response.
 */
const ADMIN_STORAGE_KEY = "taswiqat.admin.ui.v1";
const ADMIN_ACTOR = "إدارة المعاينة";
const ADMIN_MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const ADMIN_RECORD_KINDS = ["workspaces", "users", "subscriptions", "tickets"];
const ADMIN_STATUS_LABELS = {
  trial: "تجريبي",
  active: "نشط",
  suspended: "معلّق",
  archived: "مؤرشف",
  resolved: "تم الحل",
  inactive: "غير نشط",
  expired: "منتهٍ",
  cancelled: "ملغى",
  open: "مفتوحة",
  in_progress: "قيد المعالجة",
  closed: "مغلقة",
};
const ADMIN_ROLES = {
  user: "مستخدم",
  manager: "مدير نشاط",
  employee: "موظف",
  owner: "مالك",
  admin: "مدير",
  editor: "محرر",
  reviewer: "مراجع",
  viewer: "مشاهد",
};
const ADMIN_PRIORITIES = {
  low: "منخفضة",
  normal: "عادية",
  high: "عالية",
  urgent: "عاجلة",
};
const ADMIN_VIEWS = {
  overview: {
    title: "نظرة عامة",
    description:
      "مؤشرات من السجلات المحلية في هذا المتصفح فقط؛ ليست إحصاءات مشتركين أو إيرادات فعلية.",
  },
  workspaces: {
    title: "أنشطة العملاء",
    description:
      "نظّم سجلات الأنشطة وخطتها المقترحة وبياناتها التجريبية. لا تُنشئ هذه السجلات مساحات عمل فعلية للعملاء.",
  },
  users: {
    title: "سجلات المستخدمين",
    description:
      "أسماء وأدوار مرتبطة بسجلات الأنشطة للمعاينة. لا كلمات مرور أو حسابات دخول أو دعوات بريدية، والأدوار لا تمنح صلاحيات فعلية.",
  },
  subscriptions: {
    title: "تتبّع الاشتراكات",
    description:
      "تتبّع محلي يدوي للباقات والفترات والحالات. السجلات ليست اشتراكات مدفوعة أو دليلًا على الدفع؛ لا فواتير أو خصم أو تجديد آلي.",
  },
  plans: {
    title: "الباقات المقترحة",
    description:
      "أسعار وحدود مقترحة للعرض المحلي؛ لا تفرض حصصًا فعلية ولا تفعّل الدفع أو تؤثر في حسابات العملاء.",
  },
  connections: {
    title: "جرد القنوات",
    description:
      "القنوات الإحدى عشرة المستهدفة، للقراءة فقط. لا توجد بيانات حسابات موثّقة أو حالة اتصال أو مؤشرات توافر للـAPI.",
  },
  operations: {
    title: "عمليات النشر",
    description:
      "قائمة النشر والطابور تنتظر تكامل التنفيذ. لا تقرأ هذه اللوحة محتوى العميل المحلي ولا تنفّذ نشرًا أو جدولة.",
  },
  tickets: {
    title: "تذاكر الدعم",
    description:
      "أنشئ تذاكر محلية واربطها بسجل نشاط، وحدد الأولوية والمسؤول وحالة المتابعة. لا رسائل أو إشعارات خارجية.",
  },
  audit: {
    title: "سجل التغييرات",
    description:
      "سجل للتغييرات التي حُفظت بالفعل في هذه المعاينة. قابل للتعديل من المتصفح، وليس سجل تدقيق أمنيًا معتمدًا.",
  },
  site: {
    title: "محتوى الموقع",
    description:
      "عدّل نصوص الموقع التعريفي للمعاينة في المتصفح نفسه فقط؛ لا نشر للزوار ولا تغيير للموقع الحي أو مزامنة بين الأجهزة.",
  },
  settings: {
    title: "الإعدادات والنسخ",
    description:
      "مظهر المعاينة ونسخ سجلاتها المحلية واستعادتها. لا تخزّن مفاتيح خاصة أو أسرارًا أو بيانات عملاء حقيقية.",
  },
};
const ADMIN_CHANNELS = [
  {
    id: "ig",
    name: "إنستقرام",
    short: "IG",
    description:
      "محتوى مرئي وصفحات أعمال؛ الربط والنشر الفعلي يتطلبان تفويضًا وصلاحيات موثّقة.",
  },
  {
    id: "tt",
    name: "تيك توك",
    short: "Tk",
    description: "فيديو قصير؛ النشر يتطلب تكاملًا معتمدًا وموافقات المنصة.",
  },
  {
    id: "x",
    name: "إكس",
    short: "X",
    description: "منشورات ومحادثات؛ لا حساب أو رمز وصول في هذه المعاينة.",
  },
  {
    id: "sc",
    name: "سناب شات",
    short: "Sc",
    description:
      "التكامل المقصود حاليًا للإعلانات؛ لا يعني التخطيط دعم نشر القصص.",
  },
  {
    id: "wa",
    name: "واتساب أعمال",
    short: "WA",
    description:
      "رسائل أعمال؛ الإرسال يحتاج موافقات وقوالب معتمدة ولا يعمل هنا.",
  },
  {
    id: "fb",
    name: "فيسبوك",
    short: "f",
    description:
      "محتوى صفحات النشاط؛ لا صفحات مرتبطة أو صلاحيات جرى التحقق منها.",
  },
  {
    id: "gbp",
    name: "ملف النشاط على قوقل",
    short: "G",
    description: "تحديثات وتقييمات البحث والخرائط؛ بانتظار تكامل الخادم.",
  },
  {
    id: "ga4",
    name: "Google Analytics 4",
    short: "GA",
    description: "قراءة وتحليل الزيارات. أداة قياس وليست قناة نشر منشورات.",
  },
  {
    id: "gads",
    name: "Google Ads",
    short: "Ads",
    description: "إدارة الحملات الإعلانية، وليست قناة منشورات اجتماعية.",
  },
  {
    id: "yt",
    name: "يوتيوب",
    short: "YT",
    description:
      "تخطيط محتوى الفيديو فقط؛ صلاحيات الربط السابقة للقراءة وليست تصريح رفع.",
  },
  {
    id: "gsc",
    name: "Google Search Console",
    short: "SC",
    description: "ظهور الموقع في البحث؛ قراءة مؤشرات وليست قناة نشر.",
  },
];

function freshAdminState() {
  return {
    workspaces: [],
    users: [],
    subscriptions: [],
    tickets: [],
    audit: [],
    plans: [
      {
        id: "basic",
        name: "الأساسية",
        price: 199,
        channels: 2,
        members: 1,
        enabled: true,
      },
      {
        id: "pro",
        name: "الاحترافية",
        price: 449,
        channels: 5,
        members: 5,
        enabled: true,
      },
      {
        id: "enterprise",
        name: "المؤسسات",
        price: 899,
        channels: 11,
        members: 20,
        enabled: true,
      },
    ],
    site: {
      heroLine1: "كل قنواتك.",
      heroLine2: "مكان واحد.",
      heroDescription:
        "من أول فكرة إلى خطة النشر: نظّم محتوى نشاطك، وجهّزه للقنوات المناسبة، واجمع عمل فريقك في مساحة واضحة. لمتجرك، بقالتك، شركتك، مطعمك أو خدماتك.",
      contactEmail: "",
      notice: "",
    },
    theme: "light",
  };
}

// Repository boundary: all handlers use read/commit/replace; no other storage writes.
const adminLocalRepository = {
  key: ADMIN_STORAGE_KEY,
  read: function () {
    const snapshot = localStorage.getItem(this.key);
    if (snapshot === null) return { state: freshAdminState(), snapshot: null };
    const parsed = JSON.parse(snapshot);
    validateAdminState(parsed);
    return { state: parsed, snapshot: snapshot };
  },
  commit: async function (next, expectedSnapshot) {
    validateAdminState(next);
    return this.replace(JSON.stringify(next), expectedSnapshot);
  },
  replace: async function (raw, expectedSnapshot) {
    const write = () => {
      if (localStorage.getItem(this.key) !== expectedSnapshot) {
        throw new Error(
          "تغيّرت البيانات في تبويب آخر. لم نحفظ النسخة القديمة. احتفظ بنصك، ثم حدّث العرض وأعد فتح النموذج.",
        );
      }
      // setItem is atomic; quota/security failures leave the previous value intact.
      if (raw === null) localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, raw);
      return this.read();
    };
    // Web Locks serializes writes from other admin tabs where supported.
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request(
        "taswiqat.admin.ui.v1.write",
        { mode: "exclusive" },
        write,
      );
    }
    return write();
  },
};
const adminServerRepository = {
  read: async function () {
    adminAssert(
      adminMode === "server" &&
        adminSession?.authenticated &&
        adminSession.user?.role === "admin",
      "لا توجد جلسة إدارة مخوّلة.",
    );
    const payload = await adminRequest("/api/admin/state");
    adminAssert(
      payload &&
        payload.state &&
        Object.prototype.hasOwnProperty.call(payload, "version"),
      "استجابة بيانات الإدارة لا تطابق عقد الخادم.",
    );
    validateAdminState(payload.state);
    return { state: payload.state, snapshot: payload.version };
  },
  commit: async function (state, version) {
    // Omitted workspaces request archival; their existing child rows stay in the payload.
    validateAdminState(state, adminState);
    const payload = await adminRequest("/api/admin/state", {
      method: "PUT",
      body: { state, version },
    });
    adminAssert(
      payload &&
        payload.state &&
        Object.prototype.hasOwnProperty.call(payload, "version"),
      "لم يؤكد الخادم نسخة البيانات المحفوظة. حدّث العرض للتحقق؛ لن نفترض نجاحًا.",
    );
    validateAdminState(payload.state);
    return { state: payload.state, snapshot: payload.version };
  },
};
const adminRepository = {
  key: ADMIN_STORAGE_KEY,
  read: async function () {
    return adminMode === "demo"
      ? adminLocalRepository.read()
      : adminServerRepository.read();
  },
  commit: async function (state, version) {
    return adminMode === "demo"
      ? adminLocalRepository.commit(state, version)
      : adminServerRepository.commit(state, version);
  },
  replace: async function (raw, version) {
    adminAssert(
      adminMode === "demo",
      "إعادة الضبط متاحة للمعاينة المحلية فقط، ولا تحذف قاعدة البيانات.",
    );
    return adminLocalRepository.replace(raw, version);
  },
};
let adminMode = "locked";
let adminSession = null;
let adminReady = false;
let adminAuthBusy = false;
let adminEventsInstalled = false;
let adminLastError = "";
let adminState = freshAdminState();
let adminSnapshot = null;
let adminStorageBlocked = false;
let adminView = "overview";
let adminEditing = null;
let adminFormDirty = false;
let adminSiteDirty = false;
let adminSiteSnapshot = null;
let adminSaving = false;
let adminToastTimer;
const adminFilters = {};

function adminEscape(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}
function adminUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function adminValidId(id) {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}
function adminEmailValid(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  );
}
function adminDateValid(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function adminTimestampValid(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
function adminAssert(condition, message) {
  if (!condition) throw new Error(message);
}
function adminNonblank(value, max) {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function adminOptionalText(value, max) {
  return typeof value === "string" && value.length <= max;
}
function validateAdminState(data, previous = null) {
  adminAssert(
    data && typeof data === "object" && !Array.isArray(data),
    "بنية البيانات المحلية غير صالحة. صدّر النسخة الخام قبل إعادة الضبط.",
  );
  const live = adminMode === "server";
  const expectedKeys = (
    live
      ? [
          "workspaces",
          "users",
          "subscriptions",
          "plans",
          "connections",
          "operations",
          "tickets",
          "audit",
          "site",
          "settings",
        ]
      : Object.keys(freshAdminState())
  )
    .sort()
    .join(",");
  adminAssert(
    Object.keys(data).sort().join(",") === expectedKeys,
    "النسخة لا تطابق بنية إدارة تسويقات v1. لم تُستبدل البيانات الحالية.",
  );
  [...ADMIN_RECORD_KINDS, "audit", "plans"].forEach((key) =>
    adminAssert(Array.isArray(data[key]), `القائمة ${key} غير صالحة.`),
  );
  if (live) {
    adminAssert(
      Array.isArray(data.connections) && Array.isArray(data.operations),
      "قوائم القنوات والعمليات غير صالحة.",
    );
    adminAssert(
      data.settings &&
        typeof data.settings === "object" &&
        !Array.isArray(data.settings),
      "إعدادات الإدارة غير صالحة.",
    );
  } else
    adminAssert(
      ["light", "dark"].includes(data.theme),
      "قيمة المظهر غير صالحة.",
    );
  adminAssert(
    data.site && typeof data.site === "object" && !Array.isArray(data.site),
    "إعدادات الموقع غير صالحة.",
  );
  adminAssert(
    Object.keys(data.site).sort().join(",") ===
      Object.keys(freshAdminState().site).sort().join(","),
    "حقول إعدادات الموقع لا تطابق النسخة الحالية.",
  );
  ["heroLine1", "heroLine2"].forEach((key) =>
    adminAssert(
      live
        ? adminOptionalText(data.site[key], 160)
        : adminNonblank(data.site[key], 140),
      live ? "سطر العنوان بحد أقصى 160 حرفًا." : "سطر العنوان مطلوب، بحد أقصى 140 حرفًا.",
    ),
  );
  adminAssert(
    live
      ? adminOptionalText(data.site.heroDescription, 2000)
      : adminNonblank(data.site.heroDescription, 1500),
    live ? "وصف الموقع بحد أقصى 2000 حرف." : "وصف الموقع مطلوب، بحد أقصى 1500 حرف.",
  );
  adminAssert(
    adminOptionalText(data.site.notice, live ? 2000 : 700),
    live ? "التنبيه أطول من 2000 حرف أو غير صالح." : "التنبيه أطول من 700 حرف أو غير صالح.",
  );
  adminAssert(
    data.site.contactEmail === "" || adminEmailValid(data.site.contactEmail),
    "بريد التواصل غير صالح.",
  );
  adminAssert(
    live ? data.plans.length >= 1 && data.plans.length <= 20 : data.plans.length === 3,
    live ? "يجب أن تحتوي النسخة على 1 إلى 20 باقة." : "يجب أن تحتوي النسخة على الباقات الثلاث المقترحة.",
  );
  const planIds = new Set();
  data.plans.forEach((plan) => {
    adminAssert(
      plan &&
        (live
          ? typeof plan.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(plan.id)
          : ["basic", "pro", "enterprise"].includes(plan.id)) &&
        !planIds.has(plan.id),
      "معرّف الباقة غير صالح أو مكرر.",
    );
    planIds.add(plan.id);
    adminAssert(
      live
        ? adminOptionalText(plan.name, 160) && plan.name.length > 0
        : adminNonblank(plan.name, 100),
      "اسم الباقة مطلوب.",
    );
    adminAssert(
      typeof plan.price === "number" &&
        Number.isFinite(plan.price) &&
        plan.price >= 0 &&
        plan.price <= (live ? 1000000 : 100000000),
      "سعر الباقة يجب أن يكون رقمًا غير سالب.",
    );
    ["channels", "members"].forEach((key) =>
      adminAssert(
        Number.isSafeInteger(plan[key]) &&
          plan[key] >= (live ? 1 : 0) &&
          plan[key] <= (live ? (key === "channels" ? 11 : 100) : 1000000),
        live ? "حد القنوات من 1 إلى 11 والأعضاء من 1 إلى 100." : "حدود الباقة أعداد صحيحة غير سالبة.",
      ),
    );
    adminAssert(typeof plan.enabled === "boolean", "حالة الباقة غير صالحة.");
  });
  // Like the backend's before/next validation, allow references to rows being archived.
  // Reads and canonical responses omit previous, so still require all workspace rows.
  const workspaceIds = new Set(
    [...data.workspaces, ...(live && previous ? previous.workspaces : [])]
      .map((record) => record && record.id),
  );
  ADMIN_RECORD_KINDS.forEach((kind) => {
    const ids = new Set();
    data[kind].forEach((record) => {
      adminAssert(
        record && adminValidId(record.id) && !ids.has(record.id),
        "معرّف سجل غير صالح أو مكرر.",
      );
      ids.add(record.id);
      adminAssert(
        adminTimestampValid(record.createdAt) &&
          adminTimestampValid(record.updatedAt),
        "تواريخ السجل غير صالحة.",
      );
      if (kind === "workspaces") {
        adminAssert(
          adminNonblank(record.name, 160) &&
            (live
              ? adminOptionalText(record.businessType, 120)
              : adminNonblank(record.businessType, 120)),
          "اسم النشاط ونوعه مطلوبان.",
        );
        adminAssert(
          (live && record.ownerEmail === "") ||
            adminEmailValid(record.ownerEmail),
          "بريد مالك النشاط غير صالح.",
        );
        adminAssert(planIds.has(record.planId), "باقة النشاط غير موجودة.");
        adminAssert(
          (live
            ? ["trial", "active", "suspended", "archived"]
            : ["trial", "active", "suspended"]
          ).includes(record.status),
          "حالة النشاط غير صالحة.",
        );
        adminAssert(
          adminOptionalText(record.notes, 2000),
          "ملاحظات النشاط غير صالحة.",
        );
      } else {
        adminAssert(
          workspaceIds.has(record.workspaceId) ||
            ((kind === "tickets" || (live && kind === "users")) &&
              record.workspaceId === ""),
          "أحد السجلات مرتبط بنشاط غير موجود.",
        );
      }
      if (kind === "users") {
        adminAssert(
          (live
            ? adminOptionalText(record.name, 160)
            : adminNonblank(record.name, 160)) &&
            ((live && record.email === "") || adminEmailValid(record.email)),
          "اسم المستخدم أو بريده غير صالح.",
        );
        adminAssert(
          Object.prototype.hasOwnProperty.call(ADMIN_ROLES, record.role),
          "الدور غير صالح.",
        );
        adminAssert(
          live
            ? ["active", "inactive", "suspended", "archived"].includes(
                record.status,
              )
            : ["active", "inactive"].includes(record.status),
          "حالة المستخدم غير صالحة.",
        );
      }
      if (kind === "subscriptions") {
        adminAssert(planIds.has(record.planId), "باقة الاشتراك غير موجودة.");
        adminAssert(
          adminDateValid(record.startDate) &&
            adminDateValid(record.endDate) &&
            record.endDate > record.startDate,
          "نهاية الاشتراك يجب أن تكون بعد بدايته بتاريخ صحيح.",
        );
        adminAssert(
          (live
            ? ["trial", "active", "suspended", "expired", "cancelled"]
            : ["trial", "active", "expired", "cancelled"]
          ).includes(record.status),
          "حالة الاشتراك غير صالحة.",
        );
        adminAssert(
          adminOptionalText(record.notes, 2000),
          "ملاحظات الاشتراك غير صالحة.",
        );
      }
      if (kind === "tickets") {
        adminAssert(
          live
            ? adminOptionalText(record.title, 240) && record.title.length > 0 &&
              adminOptionalText(record.description, 10000) && record.description.length > 0
            : adminNonblank(record.title, 180) &&
              adminNonblank(record.description, 3000),
          "عنوان التذكرة وتفاصيلها مطلوبان.",
        );
        adminAssert(
          Object.prototype.hasOwnProperty.call(
            ADMIN_PRIORITIES,
            record.priority,
          ),
          "أولوية التذكرة غير صالحة.",
        );
        adminAssert(
          (live
            ? ["open", "in_progress", "resolved", "closed"]
            : ["open", "in_progress", "closed"]
          ).includes(record.status),
          "حالة التذكرة غير صالحة.",
        );
        adminAssert(
          adminOptionalText(record.assignee, 160),
          "اسم مسؤول المتابعة غير صالح.",
        );
      }
    });
  });
  const auditIds = new Set();
  data.audit.forEach((entry) => {
    adminAssert(
      entry &&
        (live
          ? typeof entry.id === "string" &&
            /^[a-zA-Z0-9_-]{1,80}$/.test(entry.id)
          : adminValidId(entry.id)) &&
        !auditIds.has(entry.id) &&
        adminTimestampValid(entry.date) &&
        adminNonblank(entry.message, 1000) &&
        (live ? adminNonblank(entry.actor, 254) : entry.actor === ADMIN_ACTOR),
      "سجل التغييرات المحلي غير صالح.",
    );
    auditIds.add(entry.id);
  });
}
async function readAdminRepository() {
  try {
    const result = await adminRepository.read();
    adminState = result.state;
    adminSnapshot = result.snapshot;
    adminStorageBlocked = false;
    return true;
  } catch (error) {
    adminStorageBlocked = true;
    adminLastError = adminErrorMessage(error);
    adminShowError(adminLastError);
    return false;
  }
}
function adminErrorMessage(error) {
  if (
    error &&
    ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name)
  )
    return "مساحة التخزين ممتلئة. لم يُحفظ التغيير؛ النموذج محفوظ على الشاشة. صدّر نسخة أو قلّل السجلات ثم أعد المحاولة.";
  if (error && error.name === "SecurityError")
    return "المتصفح يمنع التخزين المحلي. اسمح بالتخزين أو افتح الموقع في متصفح مناسب؛ لم يُحفظ التغيير.";
  return error && error.message ? error.message : "تعذّر حفظ التغيير المحلي.";
}
async function commitAdminChange(
  mutator,
  message,
  expectedSnapshot = adminSnapshot,
) {
  if (adminSaving || !adminReady) return false;
  if (adminStorageBlocked) {
    adminShowError(
      "بيانات الإدارة غير متاحة. أعد تحميل النسخة الموثّقة قبل الحفظ؛ لا يوجد حفظ بديل.",
    );
    return false;
  }
  adminSaving = true;
  setAdminSaving(true);
  try {
    // Never silently merge an old form. The authoritative PUT also checks version.
    let next;
    if (adminMode === "demo") {
      const latest = await adminRepository.read();
      adminAssert(
        latest.snapshot === expectedSnapshot,
        "تغيّرت بيانات المعاينة في تبويب آخر. احتفظ بنص النموذج ثم حدّث العرض وأعد فتحه.",
      );
      next = JSON.parse(JSON.stringify(latest.state));
    } else {
      adminAssert(
        adminSnapshot === expectedSnapshot,
        "نسخة النموذج قديمة. احتفظ بنصك وأعد تحميل البيانات بعد التأكيد.",
      );
      next = JSON.parse(JSON.stringify(adminState));
    }
    mutator(next);
    // Server owns the real audit actor, timestamp and audit trail. Client audit is demo-only.
    if (adminMode === "demo")
      next.audit.push({
        id: adminUuid(),
        date: new Date().toISOString(),
        message,
        actor: ADMIN_ACTOR,
      });
    const saved = await adminRepository.commit(next, expectedSnapshot);
    adminState = saved.state;
    adminSnapshot = saved.snapshot;
    document.getElementById("adminStorageNotice").hidden = true;
    applyAdminTheme();
    adminToast(
      adminMode === "demo"
        ? "حُفظ التغيير للمعاينة المحلية فقط."
        : "أكد الخادم حفظ التغيير في قاعدة البيانات.",
    );
    return true;
  } catch (error) {
    adminShowError(adminErrorMessage(error));
    if (error.status === 409)
      showAdminStorageNotice(
        "تعارض نسخة البيانات (409). لم يُحفظ النموذج ولم نُعد المحاولة. انسخ نصك ثم اضغط إعادة تحميل؛ سيُطلب تأكيد قبل إزالة النص.",
      );
    return false;
  } finally {
    adminSaving = false;
    setAdminSaving(false);
  }
}
function adminShowError(message) {
  const dialog = document.getElementById("adminDialog");
  const siteError = document.getElementById("adminSiteError");
  if (dialog.open)
    document.getElementById("adminFormError").textContent = message;
  else if (adminView === "site" && siteError) siteError.textContent = message;
  else showAdminStorageNotice(message);
}
function showAdminStorageNotice(message) {
  const notice = document.getElementById("adminStorageNotice");
  if (!notice) return;
  notice.innerHTML = `<div>${adminEscape(message)}</div><button class="btn small" type="button" onclick="refreshAdminWorkspace()">${adminMode === "server" ? "إعادة تحميل النسخة من الخادم" : "تحديث المعاينة من التخزين"}</button>`;
  notice.hidden = false;
}
function adminToast(message) {
  const element = document.getElementById("adminToast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}
function adminNumber(value) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(
    value,
  );
}
function adminTime(value) {
  if (!adminTimestampValid(value)) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
  }).format(new Date(value));
}
function adminDay(value) {
  if (!adminDateValid(value)) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    calendar: "gregory",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
}
function adminBadge(status) {
  const color = ["active", "closed"].includes(status)
    ? "green"
    : ["suspended", "cancelled", "expired", "inactive"].includes(status)
      ? "red"
      : status === "in_progress"
        ? "purple"
        : "gold";
  return `<span class="badge ${color}">${adminEscape(ADMIN_STATUS_LABELS[status] || status)}</span>`;
}
function adminWorkspaceName(id) {
  if (!id) return "دون نشاط مرتبط";
  const workspace = adminState.workspaces.find((item) => item.id === id);
  return workspace ? workspace.name : "نشاط غير موجود";
}
function adminPlanName(id) {
  const plan = adminState.plans.find((item) => item.id === id);
  return plan ? plan.name : "باقة غير موجودة";
}
function adminEmpty(title, description, action = "", symbol = "◇") {
  return `<div class="empty admin-empty"><span class="admin-empty-symbol" aria-hidden="true">${symbol}</span><h3>${adminEscape(title)}</h3><p>${adminEscape(description)}</p>${action}</div>`;
}
function adminAddButton(kind) {
  if (adminMode === "server" && kind === "users")
    return `<span class="badge purple">الحسابات من تسجيل الدخول الموثّق</span>`;
  if (adminMode === "server" && kind === "subscriptions")
    return `<span class="badge purple">الاشتراك يُنشأ مع النشاط</span>`;
  const labels = {
    workspaces: "إضافة نشاط",
    users: "إضافة سجل مستخدم",
    subscriptions: "إضافة سجل اشتراك",
    tickets: "إنشاء تذكرة",
  };
  return `<button class="btn primary" type="button" onclick="openAdminRecord('${kind}')">+ ${labels[kind]}</button>`;
}
function adminLatest(records) {
  return records
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
}
function adminListPanel(title, link, items, emptyDescription) {
  return `<section class="card"><div class="section-head"><h2>${title}</h2><a class="btn small ghost" href="#${link}">عرض الكل ←</a></div>${items.length ? `<ul class="admin-list">${items.join("")}</ul>` : adminEmpty("لا سجلات بعد", emptyDescription, "", "▤")}</section>`;
}
function renderAdminOverview() {
  if (adminMode === "server") {
    renderAdminServerOverview();
    return;
  }
  const summaries = [
    [
      "سجلات الأنشطة",
      adminState.workspaces.length,
      `${adminNumber(adminState.workspaces.filter((item) => item.status === "active").length)} بحالة نشط محليًا`,
    ],
    ["سجلات المستخدمين", adminState.users.length, "لا تمثل حسابات دخول حقيقية"],
    [
      "سجلات الاشتراكات",
      adminState.subscriptions.length,
      "تتبّع محلي، وليس مشتركين مدفوعين",
    ],
    [
      "تذاكر تحتاج متابعة",
      adminState.tickets.filter((item) => item.status !== "closed").length,
      "تذاكر مفتوحة أو قيد المعالجة محليًا",
    ],
  ];
  const workspaces = adminLatest(adminState.workspaces).map(
    (item) =>
      `<li><div class="between"><div><strong>${adminEscape(item.name)}</strong><small>${adminEscape(item.businessType)} · ${adminEscape(adminPlanName(item.planId))}</small></div>${adminBadge(item.status)}</div><small>${adminTime(item.updatedAt)}</small></li>`,
  );
  const tickets = adminLatest(adminState.tickets).map(
    (item) =>
      `<li><div class="between"><div><strong>${adminEscape(item.title)}</strong><small>${adminEscape(adminWorkspaceName(item.workspaceId))} · ${ADMIN_PRIORITIES[item.priority]}</small></div>${adminBadge(item.status)}</div><small>${adminTime(item.updatedAt)}</small></li>`,
  );
  const audit = adminState.audit
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(
      (entry) =>
        `<li><strong>${adminEscape(entry.message)}</strong><small>${adminEscape(entry.actor)} · ${adminTime(entry.date)}</small></li>`,
    );
  const subscriptions = adminLatest(adminState.subscriptions).map(
    (item) =>
      `<li><div class="between"><div><strong>${adminEscape(adminWorkspaceName(item.workspaceId))}</strong><small>${adminEscape(adminPlanName(item.planId))} · ينتهي ${adminDay(item.endDate)}</small></div>${adminBadge(item.status)}</div></li>`,
  );
  document.getElementById("adminView").innerHTML = `
    <section class="card admin-overview-intro"><div><div class="eyebrow">من التنظيم إلى التشغيل</div><h2>إدارة واضحة. بياناتك التجريبية فقط.</h2><p>ابدأ بسجل نشاط، ثم نظّم مستخدميه ومتابعة اشتراكه وتذاكره. كل حالة هنا وصف يدوي للمعاينة، لا إجراء على حساب أو خدمة فعلية.</p></div>${adminAddButton("workspaces")}</section>
    <div class="summary-grid">${summaries.map(([label, value, detail]) => `<section class="card summary"><div class="summary-label">${label}</div><strong>${adminNumber(value)}</strong><small>${detail}</small></section>`).join("")}</div>
    <div class="home-columns">${adminListPanel("أحدث الأنشطة", "workspaces", workspaces, "أنشئ سجلًا تجريبيًا لنشاطك. لا توجد بيانات عملاء افتراضية.")}${adminListPanel("متابعة الدعم", "tickets", tickets, "لن تظهر تذاكر حتى تنشئها محليًا.")}</div>
    <div class="home-columns">${adminListPanel("أحدث التغييرات", "audit", audit, "يظهر هنا ما حُفظ فعليًا في المتصفح؛ لا أحداث تشغيل وهمية.")}${adminListPanel("تتبّع الاشتراكات", "subscriptions", subscriptions, "لم تُضف سجلات اشتراكات. الدفع والتحصيل غير مفعّلين.")}</div>
    <div class="notice info">القنوات والنشر والفوترة تنتظر تكاملاتها. لا إيرادات محسوبة، ولا بيانات من لوحات العملاء، ولا مراقبة اتصال فعلية في هذه المعاينة.</div>`;
}
function adminOptions(options, selected, placeholder = "") {
  const first = placeholder
    ? `<option value="">${adminEscape(placeholder)}</option>`
    : "";
  return (
    first +
    options
      .map(
        ([value, label]) =>
          `<option value="${adminEscape(value)}" ${value === selected ? "selected" : ""}>${adminEscape(label)}</option>`,
      )
      .join("")
  );
}
function adminStatusOptions(kind) {
  const statuses = {
    workspaces:
      adminMode === "server"
        ? ["trial", "active", "suspended", "archived"]
        : ["trial", "active", "suspended"],
    users:
      adminMode === "server"
        ? ["active", "suspended", "archived"]
        : ["active", "inactive"],
    subscriptions:
      adminMode === "server"
        ? ["trial", "active", "suspended", "expired", "cancelled"]
        : ["trial", "active", "expired", "cancelled"],
    tickets:
      adminMode === "server"
        ? ["open", "in_progress", "resolved", "closed"]
        : ["open", "in_progress", "closed"],
  };
  return statuses[kind].map((status) => [status, ADMIN_STATUS_LABELS[status]]);
}
function renderAdminRecordSection(kind) {
  const filter = adminFilters[kind] || {
    search: "",
    status: "",
    workspaceId: "",
  };
  adminFilters[kind] = filter;
  const workspaceFilter =
    kind !== "workspaces"
      ? `<div class="field"><label for="adminFilterWorkspace">النشاط</label><select id="adminFilterWorkspace" onchange="filterAdminRecords('${kind}')">${adminOptions(
          adminState.workspaces.map((item) => [item.id, item.name]),
          filter.workspaceId,
          "كل الأنشطة",
        )}${kind === "tickets" ? `<option value="general" ${filter.workspaceId === "general" ? "selected" : ""}>عام — دون نشاط</option>` : ""}</select></div>`
      : `<div class="field"><label for="adminFilterPlan">الباقة المقترحة</label><select id="adminFilterPlan" onchange="filterAdminRecords('${kind}')">${adminOptions(
          adminState.plans.map((item) => [item.id, item.name]),
          filter.workspaceId,
          "كل الباقات",
        )}</select></div>`;
  document.getElementById("adminView").innerHTML =
    `<section class="card"><div class="admin-filters"><div class="field"><label for="adminFilterSearch">البحث في السجلات</label><input id="adminFilterSearch" type="search" maxlength="200" placeholder="اسم، بريد أو ملاحظة…" value="${adminEscape(filter.search)}" oninput="filterAdminRecords('${kind}')" /></div><div class="field"><label for="adminFilterStatus">حالة السجل</label><select id="adminFilterStatus" onchange="filterAdminRecords('${kind}')">${adminOptions(adminStatusOptions(kind), filter.status, "كل الحالات")}</select></div>${workspaceFilter}</div><div id="adminRecordResults"></div></section>${kind === "users" ? `<div class="notice info">تغيير الدور أو الحالة لا يقيّد وصولًا فعليًا. يلزم تطبيق الصلاحيات والمصادقة على الخادم قبل استخدام بيانات حقيقية.</div>` : kind === "subscriptions" ? `<div class="notice info">الحالات والتواريخ يدوية. إلغاء سجل أو تغييره إلى نشط لا يوقف أو يفعّل أي اشتراك حقيقي، ولا يُرسل إيصالًا أو يخصم مبلغًا.</div>` : kind === "workspaces" ? `<div class="notice info">تعليق نشاط يغيّر حالة السجل المحلي فقط. لا يمكن حذف نشاط له مستخدمون أو اشتراكات أو تذاكر مرتبطة؛ حرّر روابطها أو احذفها أولًا.</div>` : `<div class="notice info">اسم المسؤول نص للمتابعة المحلية، وليس تكليفًا لحساب موظف أو إشعارًا أُرسل إليه.</div>`}`;
  renderAdminRecordResults(kind);
  if (adminMode === "server") {
    const note = document
      .getElementById("adminView")
      .querySelector(":scope > .notice");
    if (note)
      note.textContent =
        kind === "workspaces"
          ? "التعليق والأرشفة يغيّران حالة النشاط في الخادم. الأرشفة لا تحذف المستخدمين أو الاشتراكات أو التذاكر المرتبطة؛ يعيد الخادم السجلات الكانونية. لا تحصيل أو دفع."
          : kind === "users"
            ? "حسابات دخول موثّقة، حتى دون نشاط مرتبط. الاسم وحالة غير المدير المثبت قابلان للتعديل؛ البريد ودور النظام والعضوية للقراءة فقط. الخادم يفرض حالة الحساب وصلاحياته، ولا تُرسل دعوة هنا."
            : kind === "subscriptions"
              ? "الاشتراك سجل وصول يدوي يُنشأ مع النشاط. الحالة والباقة تؤثران في الوصول والحصص على الخادم؛ لا تحصيل أو دفع أو فواتير أو تفعيل خدمة خارجية."
              : "المسؤول اسم للمتابعة؛ لا نُرسل تكليفًا أو إشعارًا خارج هذه اللوحة.";
  }
}
function filterAdminRecords(kind) {
  adminFilters[kind] = {
    search: document.getElementById("adminFilterSearch").value,
    status: document.getElementById("adminFilterStatus").value,
    workspaceId: document.getElementById(
      kind === "workspaces" ? "adminFilterPlan" : "adminFilterWorkspace",
    ).value,
  };
  renderAdminRecordResults(kind);
}
function renderAdminRecordResults(kind) {
  const filter = adminFilters[kind];
  const query = filter.search.trim().toLocaleLowerCase("ar");
  const records = adminState[kind]
    .filter((item) => {
      if (filter.status && item.status !== filter.status) return false;
      if (
        filter.workspaceId &&
        (kind === "workspaces"
          ? item.planId !== filter.workspaceId
          : filter.workspaceId === "general"
            ? item.workspaceId !== ""
            : item.workspaceId !== filter.workspaceId)
      )
        return false;
      const searchable = [
        item.name,
        item.title,
        item.description,
        item.email,
        item.ownerEmail,
        item.notes,
        item.businessType,
        item.assignee,
        adminWorkspaceName(item.workspaceId),
        adminPlanName(item.planId),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ar");
      return !query || searchable.includes(query);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const result = document.getElementById("adminRecordResults");
  result.innerHTML = `<p class="admin-result-count" role="status">${adminNumber(records.length)} من ${adminNumber(adminState[kind].length)} سجل</p>`;
  if (!records.length) {
    result.innerHTML += adminState[kind].length
      ? adminEmpty(
          "لا نتائج مطابقة",
          "جرّب تغيير البحث أو الحالة أو النشاط.",
          `<button class="btn ghost" type="button" onclick="clearAdminFilters('${kind}')">مسح الفلاتر</button>`,
          "⌕",
        )
      : adminEmpty(
          "لا سجلات بعد",
          adminMode === "server"
            ? "لا سجلات في نسخة الخادم الحالية. هويات المستخدمين تأتي من تسجيل الدخول الموثّق، والاشتراك يُنشأ مع النشاط."
            : "ابدأ بسجل تجريبي فقط. لا تدخل بيانات عملاء حقيقية في هذه اللوحة غير المحمية.",
          adminAddButton(kind),
          "▤",
        );
    return;
  }
  const headers = {
    workspaces: [
      "النشاط / النوع",
      "بريد المالك",
      "الباقة المقترحة",
      "الحالة",
      "آخر تعديل",
      "إجراءات السجل",
    ],
    users: [
      "الاسم / البريد",
      "النشاط",
      adminMode === "server" ? "دور النظام" : "الدور المطلوب",
      "الحالة",
      "آخر تعديل",
      "إجراءات السجل",
    ],
    subscriptions: [
      "النشاط / الباقة",
      "بداية الفترة",
      "نهاية الفترة",
      "الحالة اليدوية",
      "آخر تعديل",
      "إجراءات السجل",
    ],
    tickets: [
      "العنوان / النشاط",
      "الأولوية",
      "مسؤول المتابعة",
      "الحالة",
      "آخر تعديل",
      "إجراءات السجل",
    ],
  };
  result.innerHTML += `<p class="admin-table-hint">يمكن تمرير الجدول أفقيًا على الشاشات الصغيرة. ${adminMode === "server" ? "الإجراءات تُرسل إلى الخادم ولا تُعتمد إلا بعد تأكيده؛ الأرشفة ليست حذفًا فعليًا." : "جميع الإجراءات محلية."}</p><div class="table-wrap" tabindex="0" role="region" aria-label="جدول ${adminEscape(ADMIN_VIEWS[kind].title)} القابل للتمرير"><table><caption class="hidden">${adminEscape(ADMIN_VIEWS[kind].title)}، ${adminMode === "server" ? "سجلات الخادم" : "سجلات للمعاينة"}</caption><thead><tr>${headers[kind].map((header) => `<th scope="col">${header}</th>`).join("")}</tr></thead><tbody>${records.map((item) => adminRecordRow(kind, item)).join("")}</tbody></table></div>`;
}
function clearAdminFilters(kind) {
  adminFilters[kind] = { search: "", status: "", workspaceId: "" };
  renderAdminRecordSection(kind);
}
function adminRecordRow(kind, item) {
  const deleteLabel =
    adminMode === "server"
      ? {
          workspaces: "أرشفة",
          users: "أرشفة",
          subscriptions: "إلغاء",
          tickets: "إغلاق",
        }[kind]
      : "حذف";
  let cells;
  if (kind === "workspaces")
    cells = [
      `<strong>${adminEscape(item.name)}</strong><small>${adminEscape(item.businessType)}</small>`,
      `<span dir="ltr">${adminEscape(item.ownerEmail)}</span>`,
      adminEscape(adminPlanName(item.planId)),
    ];
  if (kind === "users")
    cells = [
      `<strong>${adminEscape(item.name)}</strong><small dir="ltr">${adminEscape(item.email)}</small>`,
      adminEscape(adminWorkspaceName(item.workspaceId)),
      `${adminEscape(ADMIN_ROLES[item.role] || item.role)}${item.globalRole || (adminMode === "server" && ["admin", "user"].includes(item.role)) ? `<small>دور النظام: ${adminEscape((item.globalRole || item.role) === "admin" ? "إدارة النظام" : "مستخدم")}</small>` : ""}`,
    ];
  if (kind === "subscriptions")
    cells = [
      `<strong>${adminEscape(adminWorkspaceName(item.workspaceId))}</strong><small>${adminEscape(adminPlanName(item.planId))}</small>`,
      adminDay(item.startDate),
      `${adminDay(item.endDate)}${item.endDate < new Date().toISOString().slice(0, 10) && !["expired", "cancelled"].includes(item.status) ? `<small>التاريخ مضى؛ الحالة يدوية</small>` : ""}`,
    ];
  if (kind === "tickets")
    cells = [
      `<strong>${adminEscape(item.title)}</strong><small>${adminEscape(adminWorkspaceName(item.workspaceId))}</small>`,
      `<span class="badge ${["urgent", "high"].includes(item.priority) ? "red" : "purple"}">${ADMIN_PRIORITIES[item.priority]}</span>`,
      adminEscape(item.assignee || "لم يُحدد"),
    ];
  const transition =
    kind === "workspaces" && item.status !== "suspended"
      ? `<button class="btn small" type="button" onclick="changeAdminRecordStatus('${kind}','${item.id}','suspended')">تعليق</button>`
      : kind === "tickets"
        ? item.status === "open"
          ? `<button class="btn small" type="button" onclick="changeAdminRecordStatus('${kind}','${item.id}','in_progress')">بدء المعالجة</button>`
          : item.status === "in_progress"
            ? `<button class="btn small" type="button" onclick="changeAdminRecordStatus('${kind}','${item.id}','closed')">إغلاق</button>`
            : `<button class="btn small" type="button" onclick="changeAdminRecordStatus('${kind}','${item.id}','open')">إعادة فتح</button>`
        : "";
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}<td>${adminBadge(item.status)}</td><td><small>${adminTime(item.updatedAt)}</small></td><td><div class="record-actions"><button class="btn small" type="button" onclick="openAdminRecord('${kind}','${item.id}')" aria-label="تحرير ${adminEscape(item.name || item.title || adminWorkspaceName(item.workspaceId))}">تحرير</button>${transition}<button class="btn small danger" type="button" onclick="deleteAdminRecord('${kind}','${item.id}')">${deleteLabel}</button></div></td></tr>`;
}
function renderAdminPlans() {
  if (adminMode === "server") {
    renderAdminServerPlans();
    return;
  }
  document.getElementById("adminView").innerHTML =
    `<div class="notice info">الباقات والأسعار والحدود مقترحة وليست عرض دفع. تشغيل الباقة أو إيقاف عرضها يؤثر في المعاينة المحلية للموقع فقط؛ لا يُحدّث اشتراكات أو حصص العملاء.</div><div class="admin-plan-grid">${adminState.plans.map((plan) => `<section class="card admin-plan-card"><div class="between"><div class="eyebrow">باقة مقترحة</div><span class="badge ${plan.enabled ? "purple" : "red"}">${plan.enabled ? "مفعّلة للعرض المحلي" : "موقوفة للعرض المحلي"}</span></div><h2>${adminEscape(plan.name)}</h2><div class="admin-plan-price"><strong>${adminNumber(plan.price)}</strong><small>ر.س / شهر مقترح</small></div><p class="muted"><small>لا فوترة أو تحصيل فعلي</small></p><div class="admin-plan-limits"><div>${adminNumber(plan.channels)} قناة مقترحة</div><div>${adminNumber(plan.members)} عضو مقترح</div><small class="muted">حدود وصفية غير مفروضة على النظام</small></div><button class="btn secondary" type="button" onclick="openAdminRecord('plans','${plan.id}')">تعديل الباقة المقترحة</button></section>`).join("")}</div><a class="btn ghost" href="index.html">عرض الموقع في المتصفح نفسه وتحديث الصفحة ←</a>`;
}
function renderAdminConnections() {
  document.getElementById("adminView").innerHTML =
    `<div class="notice info">الجرد وصفي فقط. لا نجري فحص اتصال، ولا نستنتج حسابًا مربوطًا من التخزين المحلي أو من الرجوع بعد تفويض. حالة الحساب الفعلية تحتاج تحققًا موثّقًا من تكامل القناة.</div><div class="channel-grid">${ADMIN_CHANNELS.map((channel) => `<section class="card channel-card"><div class="row"><span class="channel-logo ${channel.id}" aria-hidden="true">${channel.short}</span><div><h3>${channel.name}</h3><small class="muted">قناة مستهدفة / للقراءة فقط</small></div></div><p>${channel.description}</p><span class="badge gold">حالة الحساب تحتاج تحقق التكامل</span></section>`).join("")}</div>`;
}
function renderAdminOperations() {
  if (adminMode === "server") {
    renderAdminServerOperations();
    return;
  }
  document.getElementById("adminView").innerHTML =
    `<div class="two-cols"><section class="card"><div class="section-head"><h2>طابور النشر</h2><span class="badge gold">بانتظار الخادم</span></div>${adminEmpty("لا مهام نشر متاحة", "تكامل تنفيذ الطابور غير متاح. لا تُضاف المهام المحلية للعميل هنا ولا يُرسل أي محتوى للقنوات.", "", "≋")}</section><section class="card"><div class="section-head"><h2>نتائج التنفيذ</h2><span class="badge gold">لا بيانات فعلية</span></div>${adminEmpty("لا سجل تنفيذ", "لن نعرض نجاحًا أو فشلًا أو إعادة محاولة قبل وجود استجابة حقيقية مستقلة لكل قناة.", "", "◷")}</section></div><section class="card"><div class="section-head"><h2>ما يلزم لتشغيل هذا القسم</h2></div><ol class="admin-list admin-checklist"><li><span class="admin-step-number">١</span><div><strong>وصول موثّق وعزل الأنشطة</strong><small>صلاحية إدارة المشغّل على الخادم، ومصدر موثوق لكل مهمة.</small></div></li><li><span class="admin-step-number">٢</span><div><strong>طابور وجدولة فعلية</strong><small>مواعيد ومنطقة زمنية، منع التكرار، وإعادة محاولة آمنة.</small></div></li><li><span class="admin-step-number">٣</span><div><strong>نتائج موثّقة لكل قناة</strong><small>حالة التنفيذ ومعرّف المنشور الخارجي وسبب الخطأ عند حدوثه.</small></div></li></ol></section>`;
}
function renderAdminAudit() {
  if (adminMode === "server") {
    renderAdminServerAudit();
    return;
  }
  document.getElementById("adminView").innerHTML = `<section class="card">${
    adminState.audit.length
      ? `<p class="admin-table-hint">الأوقات حسب منطقة جهازك. لا يتضمن هذا السجل محاولات حفظ فاشلة أو أحداث تشغيل افتراضية.</p><div class="table-wrap" role="region" aria-label="سجل التغييرات المحلي القابل للتمرير" tabindex="0"><table><thead><tr><th scope="col">التاريخ والوقت</th><th scope="col">التغيير المحلي</th><th scope="col">الفاعل</th></tr></thead><tbody>${adminState.audit
          .slice()
          .reverse()
          .map(
            (entry) =>
              `<tr><td>${adminTime(entry.date)}</td><td class="admin-text-preserve">${adminEscape(entry.message)}</td><td>${adminEscape(entry.actor)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : adminEmpty(
          "لا تغييرات محفوظة بعد",
          "تظهر عمليات الإضافة والتعديل والحذف وحفظ إعدادات المعاينة بعد نجاح الحفظ المحلي فقط.",
          "",
          "◷",
        )
  }</section><div class="notice info">الفاعل «إدارة المعاينة» تسمية محلية، وليس مستخدمًا مصادقًا عليه. هذا السجل غير محمي وقابل لإعادة الضبط أو الاستعادة.</div>`;
}
function adminInputField(name, label, value, options = {}) {
  const id = "adminField_" + name;
  const attrs = `${options.required ? "required" : ""} ${options.type === "email" ? 'dir="ltr" autocomplete="off"' : ""} ${options.max ? `maxlength="${options.max}"` : ""} ${options.type === "number" ? `min="${options.min ?? 0}" max="${options.limit ?? 100000000}" step="${options.step || 1}"` : ""}`;
  const input = options.textarea
    ? `<textarea id="${id}" name="${name}" ${attrs}>${adminEscape(value)}</textarea>`
    : `<input id="${id}" name="${name}" type="${options.type || "text"}" value="${adminEscape(value)}" ${attrs} />`;
  return `<div class="field"><label for="${id}">${label}${options.required ? " *" : ""}</label>${input}${options.help ? `<small>${options.help}</small>` : ""}</div>`;
}
function adminSelectField(name, label, value, options, placeholder = "") {
  return `<div class="field"><label for="adminField_${name}">${label}</label><select id="adminField_${name}" name="${name}" ${placeholder ? "required" : ""}>${adminOptions(options, value, placeholder)}</select></div>`;
}
function adminWorkspaceField(value, optional = false) {
  if (adminMode === "server" && adminEditing?.kind === "users")
    return adminSelectField(
      "workspaceId",
      "النشاط (اختياري للمستخدم المسجل)",
      value,
      [
        ["", "دون نشاط مرتبط"],
        ...adminState.workspaces.map((item) => [item.id, item.name]),
      ],
    );
  return (
    adminSelectField(
      "workspaceId",
      "سجل النشاط",
      value,
      adminState.workspaces.map((item) => [
        item.id,
        `${item.name}${item.status === "suspended" ? (adminMode === "server" ? " — معلّق" : " — معلّق محليًا") : ""}`,
      ]),
      optional ? "" : "اختر النشاط",
    ) + (optional ? "" : "")
  );
}
function adminPlanField(value) {
  return adminSelectField(
    "planId",
    "الباقة المقترحة",
    value,
    adminState.plans.map((plan) => [
      plan.id,
      plan.name + (plan.enabled ? "" : " — موقوفة للعرض"),
    ]),
  );
}
function adminBlankRecord(kind) {
  if (kind === "workspaces")
    return {
      name: "",
      businessType: "",
      ownerEmail: "",
      planId: "basic",
      status: "trial",
      notes: "",
    };
  if (kind === "users")
    return {
      name: "",
      email: "",
      workspaceId: "",
      role: "editor",
      status: "active",
    };
  if (kind === "subscriptions")
    return {
      workspaceId: "",
      planId: "basic",
      startDate: "",
      endDate: "",
      status: "trial",
      notes: "",
    };
  return {
    title: "",
    description: "",
    workspaceId: "",
    priority: "normal",
    status: "open",
    assignee: "",
  };
}
function openAdminRecord(kind, id = "") {
  if (adminSaving || !adminReady) return;
  if (
    adminMode === "server" &&
    !id &&
    ["users", "subscriptions"].includes(kind)
  ) {
    adminToast(
      kind === "users"
        ? "هويات الدخول تأتي من تسجيل الدخول الموثّق؛ لا تُنشأ من لوحة الإدارة."
        : "الاشتراك يُنشأ مع النشاط؛ عدّل سجل الاشتراك الموجود.",
    );
    return;
  }
  if (![...ADMIN_RECORD_KINDS, "plans"].includes(kind)) return;
  if (adminStorageBlocked) {
    adminShowError(
      "التخزين غير متاح. انتقل إلى الإعدادات للنسخ أو إعادة الضبط قبل إضافة سجلات.",
    );
    return;
  }
  if (
    ["users", "subscriptions"].includes(kind) &&
    !adminState.workspaces.length &&
    (adminMode !== "server" || !id)
  ) {
    adminToast("أضف سجل نشاط أولًا لتتمكن من ربط هذا السجل به.");
    location.hash = "workspaces";
    return;
  }
  if (
    id &&
    (kind === "plans" ? !/^[a-zA-Z0-9_-]{1,80}$/.test(id) : !adminValidId(id))
  )
    return;
  const record = id
    ? adminState[kind].find((item) => item.id === id)
    : adminBlankRecord(kind);
  if (!record) {
    adminToast("لم يعد السجل موجودًا. حدّث العرض.");
    return;
  }
  adminEditing = { kind: kind, id: id, snapshot: adminSnapshot };
  const live = adminMode === "server";
  adminFormDirty = false;
  const titles = {
    workspaces: "نشاط",
    users: "سجل مستخدم",
    subscriptions: "سجل اشتراك",
    tickets: "تذكرة دعم",
    plans: "باقة مقترحة",
  };
  document.getElementById("adminDialogTitle").textContent =
    `${id ? "تعديل" : "إضافة"} ${titles[kind]} للمعاينة`;
  const descriptions = {
    workspaces:
      "سجل فقط. لا يُنشأ حساب للمالك ولا مساحة عمل فعلية، ولا تُرسل رسالة بريد.",
    users:
      "سجل وصفي فقط. لا حساب دخول أو كلمة مرور أو إرسال دعوة، والدور لا يمنح صلاحية أمنية.",
    subscriptions:
      "تتبّع محلي يدوي فقط. لا دفع أو فوترة أو تفعيل اشتراك أو تجديد آلي.",
    tickets:
      "تذكرة محلية فقط. تغيير الحالة أو المسؤول لا يُرسل إشعارًا أو ردًا إلى عميل.",
    plans:
      "سعر وحدود مقترحة للعرض المحلي. لا تغيير لأسعار فعلية أو حصص مفروضة.",
  };
  document.getElementById("adminDialogDescription").textContent =
    descriptions[kind];
  let fields = "";
  if (kind === "workspaces")
    fields = `<div class="two-cols">${adminInputField("name", "اسم النشاط", record.name, { required: true, max: 160 })}${adminInputField("businessType", "نوع النشاط", record.businessType, { required: !live, max: 120 })}</div>${adminInputField("ownerEmail", "بريد مالك النشاط", record.ownerEmail, { required: !live || !id, type: "email", max: 254 })}<div class="two-cols">${adminPlanField(record.planId)}${adminSelectField("status", "حالة السجل", record.status, adminStatusOptions(kind))}</div>${adminInputField("notes", "ملاحظات داخلية", record.notes, { textarea: true, max: 2000 })}`;
  if (kind === "users")
    fields = `<div class="two-cols">${adminInputField("name", "الاسم", record.name, { required: !live || !id, max: 160 })}${adminInputField("email", "البريد", record.email, { required: !live, type: "email", max: 254 })}</div>${adminWorkspaceField(record.workspaceId)}<div class="two-cols">${adminSelectField(
      "role",
      live ? "دور النظام (للقراءة فقط)" : "الدور المطلوب",
      record.role,
      Object.entries(ADMIN_ROLES).filter(
        ([role]) => live ? ["admin", "user"].includes(role) : role !== "user",
      ),
    )}${adminSelectField("status", "حالة السجل", record.status, adminStatusOptions(kind))}</div>`;
  if (kind === "subscriptions")
    fields = `<div class="two-cols">${adminWorkspaceField(record.workspaceId)}${adminPlanField(record.planId)}</div><div class="two-cols">${adminInputField("startDate", "تاريخ البداية", record.startDate, { required: true, type: "date" })}${adminInputField("endDate", "تاريخ النهاية", record.endDate, { required: true, type: "date" })}</div>${adminSelectField("status", "الحالة اليدوية", record.status, adminStatusOptions(kind))}${adminInputField("notes", "ملاحظات التتبّع", record.notes, { textarea: true, max: 2000 })}`;
  if (kind === "tickets")
    fields = `${adminInputField("title", "عنوان التذكرة", record.title, { required: true, max: live ? 240 : 180 })}${adminSelectField("workspaceId", live ? "النشاط" : "سجل النشاط (اختياري)", record.workspaceId, [["", "عام — دون نشاط"], ...adminState.workspaces.map((item) => [item.id, item.name])])}${adminInputField("description", "تفاصيل التذكرة", record.description, { required: true, textarea: true, max: live ? 10000 : 3000 })}<div class="two-cols">${adminSelectField("priority", "الأولوية", record.priority, Object.entries(ADMIN_PRIORITIES))}${adminSelectField("status", "حالة المتابعة", record.status, adminStatusOptions(kind))}</div>${adminInputField("assignee", "اسم مسؤول المتابعة (اختياري)", record.assignee, { max: 160, help: live ? "اسم للمتابعة؛ لا تكليف أو إشعار لحساب فعلي." : "اسم وصفي محلي؛ لا تكليف أو إشعار لحساب فعلي." })}`;
  if (kind === "plans")
    fields = `${adminInputField("name", "اسم الباقة المقترحة", record.name, { required: true, max: live ? 160 : 100 })}${adminInputField("price", "السعر الشهري المقترح (ر.س)", record.price, { required: true, type: "number", step: live ? "any" : "0.01", limit: live ? 1000000 : 100000000, help: "رقم غير سالب؛ ليس مبلغًا للتحصيل أو سعرًا نهائيًا." })}<div class="two-cols">${adminInputField("channels", live ? "حد القنوات" : "عدد القنوات المقترح", record.channels, { required: true, type: "number", min: live ? 1 : 0, limit: live ? 11 : 1000000 })}${adminInputField("members", live ? "حد الأعضاء" : "عدد الأعضاء المقترح", record.members, { required: true, type: "number", min: live ? 1 : 0, limit: live ? 100 : 1000000 })}</div><label class="admin-checkbox"><input name="enabled" type="checkbox" ${record.enabled ? "checked" : ""} /> ${live ? "مفعّلة للعرض في الموقع العام" : "مفعّلة للعرض في المعاينة المحلية"}</label><div class="notice info admin-form-note">المعرّف الثابت: ${record.id}. ${live ? "يفرض الخادم حدود القنوات والأعضاء؛ تعديل الباقة لا يُحصّل دفعة ولا يفعّل تكاملًا." : "لا تؤثر هذه الحدود في استخدام العملاء الفعلي."}</div>`;
  document.getElementById("adminDialogFields").innerHTML = fields;
  document.getElementById("adminFormError").textContent = "";
  document.getElementById("adminSaveButton").textContent =
    kind === "plans" ? "حفظ الباقة المقترحة محليًا" : "حفظ السجل المحلي";
  if (adminMode === "server") {
    document.getElementById("adminDialogTitle").textContent =
      `${id ? "تعديل" : "إضافة"} ${titles[kind]}`;
    document.getElementById("adminDialogDescription").textContent =
      kind === "plans"
        ? "حفظ الباقة وحدود القنوات والأعضاء التي يفرضها الخادم، والأسعار المقترحة في الموقع العام. لا دفع أو تحصيل أو تفعيل تكامل."
        : kind === "users"
          ? "حفظ سجل ودور مطلوب. لا دعوة مرسلة ولا هوية مصادقة جديدة بمجرد حفظه."
          : kind === "subscriptions"
            ? "حفظ التتبّع اليدوي في الخادم؛ لا دفع أو تفعيل اشتراك خارجي."
            : "حفظ السجل في الخادم بعد التأكيد فقط. لا إرسال رسالة أو إجراء نشر.";
    document.getElementById("adminSaveButton").textContent = "حفظ في الخادم";
  }
  if (adminMode === "server") {
    if (kind === "users") {
      ["email", "workspaceId", "role"].forEach((key) => {
        const input = document.getElementById("adminField_" + key);
        if (input) input.disabled = true;
      });
      document.getElementById("adminDialogDescription").textContent =
        "حساب مسجّل بالفعل. يمكنك تعديل الاسم وحالة غير المدير المثبت. البريد ودور النظام والعضوية من الهوية الموثّقة ولا تُعدّل هنا؛ العضويات عبر دعوات الفريق فقط.";
      if (record.role === "admin")
        document.getElementById("adminField_status").disabled = true;
    }
    if (kind === "workspaces") {
      if (id) document.getElementById("adminField_ownerEmail").readOnly = true;
      document.getElementById("adminDialogDescription").textContent = id
        ? "تعديل بيانات النشاط. المالك ثابت، وتغيير الباقة يحدّث سجل اشتراكه اليدوي دون تحصيل أو دفع."
        : "تهيئة نشاط لمالك موجود ببريد OAuth موثّق وحساب نشط. لا يُنشأ حساب دخول جديد من البريد هنا.";
    }
    if (kind === "subscriptions" && id)
      document.getElementById("adminField_workspaceId").disabled = true;
    if (kind === "tickets") {
      const workspaceInput = document.getElementById("adminField_workspaceId");
      if (id) workspaceInput.disabled = true;
      else {
        workspaceInput.required = true;
        workspaceInput.options[0].textContent = "اختر نشاطًا موجودًا";
      }
    }
  }
  const dialog = document.getElementById("adminDialog");
  dialog.showModal();
  const firstInput = dialog.querySelector("input, select, textarea");
  if (firstInput) firstInput.focus();
}
function closeAdminDialog(force = false) {
  if (adminSaving && !force) return;
  if (
    !force &&
    adminFormDirty &&
    !confirm("إغلاق النموذج دون حفظ التغييرات المحلية؟")
  )
    return;
  document.getElementById("adminDialog").close();
  adminEditing = null;
  adminFormDirty = false;
}
function adminReadRecordForm(kind, form) {
  const data = new FormData(form);
  const text = (key) => String(data.get(key) || "").trim();
  if (adminMode === "server" && adminEditing?.id) {
    const previous = adminState[kind].find(
      (item) => item.id === adminEditing.id,
    );
    if (kind === "users")
      return {
        name: text("name"),
        email: previous.email,
        workspaceId: previous.workspaceId || "",
        role: previous.role,
        status: previous.role === "admin" ? previous.status : text("status"),
      };
    if (kind === "workspaces") data.set("ownerEmail", previous.ownerEmail);
    if (["subscriptions", "tickets"].includes(kind))
      data.set("workspaceId", previous.workspaceId);
  }
  if (kind === "workspaces")
    return {
      name: text("name"),
      businessType: text("businessType"),
      ownerEmail: text("ownerEmail"),
      planId: text("planId"),
      status: text("status"),
      notes: text("notes"),
    };
  if (kind === "users")
    return {
      name: text("name"),
      email: text("email"),
      workspaceId: text("workspaceId"),
      role: text("role"),
      status: text("status"),
    };
  if (kind === "subscriptions")
    return {
      workspaceId: text("workspaceId"),
      planId: text("planId"),
      startDate: text("startDate"),
      endDate: text("endDate"),
      status: text("status"),
      notes: text("notes"),
    };
  if (kind === "tickets")
    return {
      title: text("title"),
      description: text("description"),
      workspaceId: text("workspaceId"),
      priority: text("priority"),
      status: text("status"),
      assignee: text("assignee"),
    };
  return {
    name: text("name"),
    price: Number(text("price")),
    channels: Number(text("channels")),
    members: Number(text("members")),
    enabled: data.has("enabled"),
  };
}
async function submitAdminRecord(event) {
  event.preventDefault();
  if (!adminEditing || adminSaving) return;
  const form = document.getElementById("adminRecordForm");
  if (!form.reportValidity()) return;
  document.getElementById("adminFormError").textContent = "";
  const editing = { ...adminEditing };
  const record = adminReadRecordForm(editing.kind, form);
  const recordId = editing.id || adminUuid();
  const entityLabel = {
    workspaces: "النشاط",
    users: "سجل المستخدم",
    subscriptions: "سجل الاشتراك",
    tickets: "تذكرة الدعم",
    plans: "الباقة المقترحة",
  }[editing.kind];
  const name =
    record.name || record.title || adminWorkspaceName(record.workspaceId);
  const success = await commitAdminChange(
    (next) => {
      const now = new Date().toISOString();
      const previous = next[editing.kind].find((item) => item.id === recordId);
      if (editing.id)
        adminAssert(previous, "السجل لم يعد موجودًا. حدّث العرض.");
      if (adminMode === "server" && editing.kind === "workspaces")
        next.subscriptions
          .filter((item) => item.workspaceId === recordId)
          .forEach((item) => {
            item.planId = record.planId;
          });
      if (adminMode === "server" && editing.kind === "subscriptions") {
        const workspace = next.workspaces.find(
          (item) => item.id === record.workspaceId,
        );
        if (workspace) workspace.planId = record.planId;
      }
      if (editing.kind === "plans") Object.assign(previous, record);
      else {
        const saved = {
          ...previous,
          ...record,
          id: recordId,
          createdAt: previous ? previous.createdAt : now,
          updatedAt: now,
        };
        if (previous)
          next[editing.kind][
            next[editing.kind].findIndex((item) => item.id === recordId)
          ] = saved;
        else next[editing.kind].push(saved);
      }
    },
    `${editing.id ? "تعديل" : "إضافة"} ${entityLabel}: ${name} (محليًا)`,
    editing.snapshot,
  );
  if (success) {
    closeAdminDialog(true);
    renderAdminCurrentView();
  }
}
async function deleteAdminRecord(kind, id) {
  if (!ADMIN_RECORD_KINDS.includes(kind) || !adminValidId(id) || adminSaving)
    return;
  const record = adminState[kind].find((item) => item.id === id);
  if (!record) return;
  if (
    adminMode === "server" &&
    kind === "users" &&
    (record.globalRole === "admin" || record.role === "admin")
  ) {
    adminShowError(
      "حذف سجلات الإدارة غير متاح هنا. استخدم سياسة التعليق والصلاحيات على الخادم؛ لا يجوز حذف آخر مدير.",
    );
    return;
  }
  if (adminMode !== "server" && kind === "workspaces") {
    const related = adminWorkspaceReferences(adminState, id);
    if (related) {
      adminToast(
        `لا يمكن حذف النشاط: مرتبط بـ ${adminNumber(related)} سجل. يمكنك تعليقه محليًا أو إزالة الروابط أولًا.`,
      );
      return;
    }
  }
  const name =
    record.name || record.title || adminWorkspaceName(record.workspaceId);
  const expected = adminSnapshot;
  if (
    adminMode === "server" &&
    !confirm(
      `تأكيد إجراء الخادم على «${name}»: أرشفة المستخدم/النشاط، أو إلغاء الاشتراك، أو إغلاق التذكرة، وليس حذفًا فعليًا. يحتفظ الخادم بالسجل وبالسجلات المرتبطة ويعيد النسخة الكانونية. لا دفع أو إرسال خارجي. هل تريد المتابعة؟`,
    )
  )
    return;
  if (
    adminMode !== "server" &&
    !confirm(
      `حذف «${name}» من سجلات المعاينة المحلية؟ لا نفترض إلغاء اشتراك أو حذف هوية مصادقة. لا يمكن التراجع إلا باستعادة نسخة احتياطية.`,
    )
  )
    return;
  const success = await commitAdminChange(
    (next) => {
      if (adminMode !== "server" && kind === "workspaces")
        adminAssert(
          !adminWorkspaceReferences(next, id),
          "لا يمكن حذف نشاط مرتبط بسجلات أخرى. علّقه محليًا بدلًا من الحذف.",
        );
      adminAssert(
        next[kind].some((item) => item.id === id),
        "السجل لم يعد موجودًا.",
      );
      // In server mode only omit this row: the backend archives it and retains children.
      next[kind] = next[kind].filter((item) => item.id !== id);
    },
    `حذف سجل ${ADMIN_VIEWS[kind].title}: ${name} (محليًا)`,
    expected,
  );
  if (success) renderAdminCurrentView();
}
function adminWorkspaceReferences(data, id) {
  return ["users", "subscriptions", "tickets"].reduce(
    (total, kind) =>
      total + data[kind].filter((item) => item.workspaceId === id).length,
    0,
  );
}
async function changeAdminRecordStatus(kind, id, status) {
  if (
    !ADMIN_RECORD_KINDS.includes(kind) ||
    !adminValidId(id) ||
    !adminStatusOptions(kind).some(([value]) => value === status) ||
    adminSaving
  )
    return;
  const record = adminState[kind].find((item) => item.id === id);
  if (!record) return;
  const expected = adminSnapshot;
  const name =
    record.name || record.title || adminWorkspaceName(record.workspaceId);
  if (
    kind === "workspaces" &&
    !confirm(
      `تعليق «${name}» في السجلات؟ لا نفترض إلغاء اشتراك أو خدمة خارجية؛ سياسة الوصول يفرضها الخادم.`,
    )
  )
    return;
  const success = await commitAdminChange(
    (next) => {
      const current = next[kind].find((item) => item.id === id);
      adminAssert(current, "السجل لم يعد موجودًا.");
      current.status = status;
      current.updatedAt = new Date().toISOString();
    },
    `تغيير حالة ${name} إلى ${ADMIN_STATUS_LABELS[status]} (محليًا)`,
    expected,
  );
  if (success) renderAdminCurrentView();
}
function renderAdminSite() {
  if (adminMode === "server") {
    renderAdminServerSite();
    return;
  }
  adminSiteSnapshot = adminSnapshot;
  adminSiteDirty = false;
  const site = adminState.site;
  document.getElementById("adminView").innerHTML =
    `<section class="card admin-site-form"><form id="adminSiteForm" onsubmit="saveAdminSite(event)" oninput="adminSiteDirty = true"><div class="notice info admin-form-note">الحفظ للمعاينة المحلية فقط. افتح index.html في هذا المتصفح ثم حدّث الصفحة لتطبيق النصوص؛ لا يصل التعديل إلى زوار الموقع أو أجهزة أخرى.</div><div class="two-cols">${adminInputField("heroLine1", "السطر الأول للعنوان", site.heroLine1, { required: true, max: 140 })}${adminInputField("heroLine2", "السطر الثاني للعنوان", site.heroLine2, { required: true, max: 140 })}</div>${adminInputField("heroDescription", "وصف الموقع", site.heroDescription, { required: true, textarea: true, max: 1500 })}${adminInputField("contactEmail", "بريد التواصل (اختياري)", site.contactEmail, { type: "email", max: 254, help: "عرض بريد فقط؛ لا إرسال رسائل من لوحة المعاينة." })}${adminInputField("notice", "تنبيه للمعاينة (اختياري)", site.notice, { textarea: true, max: 700 })}<p id="adminSiteError" class="form-error" role="alert"></p><div class="admin-form-footer"><button id="adminSiteSave" class="btn primary" type="submit">حفظ للمعاينة المحلية</button><a class="btn ghost" href="index.html" target="_blank" rel="noopener">عرض الموقع ثم تحديث الصفحة ↗</a></div></form></section><div class="notice">تغيير نص التنبيه لا يزيل تحذير المعاينة غير المحمية أو يفعّل أي خدمة. لا تضع بيانات خاصة في النصوص أو البريد.</div>`;
}
async function saveAdminSite(event) {
  event.preventDefault();
  if (adminSaving) return;
  const form = document.getElementById("adminSiteForm");
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const site = {};
  Object.keys(freshAdminState().site).forEach((key) => {
    site[key] = String(data.get(key) || "").trim();
  });
  const button = document.getElementById("adminSiteSave");
  button.disabled = true;
  const success = await commitAdminChange(
    (next) => {
      next.site = site;
    },
    "تعديل نصوص الموقع للمعاينة المحلية",
    adminSiteSnapshot,
  );
  button.disabled = false;
  if (success) {
    adminSiteDirty = false;
    adminSiteSnapshot = adminSnapshot;
    if (document.getElementById("adminSiteError"))
      document.getElementById("adminSiteError").textContent = "";
  }
}
function renderAdminSettings() {
  if (adminMode === "server") {
    renderAdminServerSettings();
    return;
  }
  const bytes = adminSnapshot === null ? 0 : new Blob([adminSnapshot]).size;
  document.getElementById("adminView").innerHTML =
    `<div class="admin-settings-columns"><section class="card"><h2>نسخة احتياطية للمعاينة</h2><p>تصدير JSON يحتوي سجلات الإدارة والباقات ونصوص الموقع وسجل التغييرات. هذا الملف غير مشفّر؛ لا تشاركه إن احتوى معلومات لا تريد كشفها.</p><button class="btn secondary" type="button" onclick="exportAdminBackup()">تنزيل النسخة المحلية</button><div class="danger-area"><h3>استعادة نسخة محلية</h3><p>الاستعادة تستبدل سجلات المعاينة الحالية بالكامل بعد التحقق والتأكيد. صدّر نسختك أولًا. تُقبل بنية تسويقات v1 فقط، دون ملفات تنفيذية أو مفاتيح خاصة.</p><div class="field"><label for="adminBackupFile">اختر ملف JSON (حتى 2 ميجابايت)</label><input id="adminBackupFile" class="admin-file-input" type="file" accept=".json,application/json" /></div><button class="btn ghost" type="button" onclick="importAdminBackup()">فحص النسخة واستعادتها محليًا</button><p id="adminBackupError" class="form-error" role="alert"></p></div></section><section class="card"><h2>المظهر ونطاق الحفظ</h2><p>التخزين خاص بأصل الموقع في هذا المتصفح. لا مزامنة مع أجهزة أخرى، ولا حماية للبيانات بمجرد إخفاء رابط اللوحة.</p><button class="btn ghost" type="button" onclick="toggleAdminTheme()">${adminCurrentTheme() === "dark" ? "استخدام المظهر الفاتح" : "استخدام المظهر الداكن"}</button><dl class="admin-storage-stats"><div><dt>مفتاح المعاينة</dt><dd dir="ltr">${ADMIN_STORAGE_KEY}</dd></div><div><dt>حجم JSON المحلي</dt><dd>${adminNumber(bytes)} بايت</dd></div><div><dt>سجلات النشاط</dt><dd>${adminNumber(adminState.workspaces.length)}</dd></div><div><dt>مصدر البيانات</dt><dd>هذا المتصفح فقط</dd></div><div><dt>المصادقة والدفع</dt><dd>غير مفعّلين</dd></div></dl><div class="notice info">لا مفاتيح API أو رموز وصول أو كلمات مرور في هذه الواجهة. الربط الفعلي يحتاج خادمًا وصلاحيات وعزلًا للأنشطة.</div></section></div><section class="card admin-danger-card"><h2>إعادة ضبط المعاينة المحلية</h2><p class="muted">يمحو سجلات الإدارة المحلية ويعيد الباقات ونصوص الموقع والمظهر إلى القيم الأولى. لا يمس مفتاح لوحة العميل، ولا يحذف بيانات خادم، ولا يغيّر الموقع الحي. سجل التغييرات يُصفّر أيضًا.</p><div class="quick-actions" style="margin-top:18px"><button class="btn danger" type="button" onclick="resetAdminWorkspace()">مسح بيانات الإدارة المحلية</button>${adminStorageBlocked ? `<button class="btn ghost" type="button" onclick="exportAdminBackup(true)">تصدير النسخة الخام قبل المسح</button>` : ""}</div></section>`;
}
async function exportAdminBackup(rawOnly = false) {
  try {
    let output;
    if (adminMode === "demo") {
      const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
      output =
        rawOnly || adminStorageBlocked
          ? raw || "null"
          : JSON.stringify((await adminRepository.read()).state, null, 2);
    } else {
      adminAssert(adminReady, "لا توجد جلسة إدارة مخوّلة.");
      // Export already-loaded canonical state; never read local demo data in server mode.
      output = JSON.stringify(
        { state: adminState, version: adminSnapshot },
        null,
        2,
      );
    }
    const blob = new Blob([output], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `taswiqat-admin-${adminMode}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    adminToast("جُهّز تنزيل JSON غير مشفّر. احتفظ به في مكان آمن.");
  } catch (error) {
    adminShowError(adminErrorMessage(error));
  }
}
async function importAdminBackup() {
  if (adminSaving) return;
  if (adminMode !== "demo") {
    adminShowError(
      "استعادة JSON مباشرة إلى قاعدة البيانات غير متاحة في هذه الواجهة.",
    );
    return;
  }
  const input = document.getElementById("adminBackupFile");
  const errorElement = document.getElementById("adminBackupError");
  errorElement.textContent = "";
  const file = input.files[0];
  if (!file) {
    errorElement.textContent = "اختر ملف JSON أولًا.";
    return;
  }
  if (file.size > ADMIN_MAX_BACKUP_BYTES) {
    errorElement.textContent = "النسخة أكبر من 2 ميجابايت. لم تتغير بياناتك.";
    return;
  }
  const expected = adminSnapshot;
  try {
    const imported = JSON.parse(await file.text());
    validateAdminState(imported);
    if (
      !confirm(
        "استبدال جميع سجلات إدارة المعاينة المحلية بهذه النسخة؟ الملف غير مشفّر. صدّر النسخة الحالية أولًا؛ لا يمكن التراجع تلقائيًا.",
      )
    )
      return;
    const success = await commitAdminChange(
      (next) => {
        Object.keys(freshAdminState()).forEach((key) => {
          next[key] = imported[key];
        });
      },
      "استعادة نسخة احتياطية لإدارة المعاينة المحلية",
      expected,
    );
    if (success) {
      adminFilters.workspaces = null;
      adminFilters.users = null;
      adminFilters.subscriptions = null;
      adminFilters.tickets = null;
      renderAdminCurrentView();
    }
  } catch (error) {
    errorElement.textContent = "لم تُستعد النسخة: " + adminErrorMessage(error);
  }
}
async function resetAdminWorkspace() {
  if (adminSaving) return;
  if (adminMode !== "demo") {
    adminShowError(
      "إعادة الضبط للمعاينة المحلية فقط. لا مسح جماعي لقاعدة البيانات.",
    );
    return;
  }
  const expected = (() => {
    try {
      return localStorage.getItem(ADMIN_STORAGE_KEY);
    } catch (error) {
      adminShowError(adminErrorMessage(error));
      return undefined;
    }
  })();
  if (expected === undefined) return;
  if (
    !confirm(
      "تحذير: ستُمسح سجلات إدارة المعاينة المحلية والباقات المعدّلة ونصوص الموقع وسجل التغييرات. صدّر نسخة أولًا. لا يمس ذلك بيانات العميل أو الخادم. هل تريد المتابعة؟",
    )
  )
    return;
  if (prompt("للتأكيد اكتب: مسح المعاينة") !== "مسح المعاينة") return;
  adminSaving = true;
  try {
    const result = await adminRepository.replace(null, expected);
    adminState = result.state;
    adminSnapshot = result.snapshot;
    adminStorageBlocked = false;
    adminSiteDirty = false;
    Object.keys(adminFilters).forEach((key) => {
      delete adminFilters[key];
    });
    document.getElementById("adminStorageNotice").hidden = true;
    applyAdminTheme();
    renderAdminCurrentView();
    adminToast("مُسحت بيانات إدارة المعاينة المحلية فقط وأُعيدت القيم الأولى.");
  } catch (error) {
    adminShowError(adminErrorMessage(error));
  } finally {
    adminSaving = false;
  }
}
function applyAdminTheme() {
  document.body.classList.toggle("dark", adminCurrentTheme() === "dark");
  const button = document.getElementById("adminThemeButton");
  button.textContent =
    adminCurrentTheme() === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
  button.setAttribute("aria-pressed", String(adminCurrentTheme() === "dark"));
}
async function toggleAdminTheme() {
  if (adminSaving) return;
  if (document.getElementById("adminDialog").open || adminSiteDirty) {
    adminToast(
      "احفظ النموذج أو أغلقه قبل تغيير المظهر لتجنّب تعارض نسخة الحفظ.",
    );
    return;
  }
  const theme = adminCurrentTheme() === "dark" ? "light" : "dark";
  const success = await commitAdminChange(
    (next) => {
      if (adminMode === "demo") next.theme = theme;
      else next.settings.theme = theme;
    },
    `تغيير مظهر المعاينة إلى ${theme === "dark" ? "الداكن" : "الفاتح"}`,
  );
  if (success) renderAdminCurrentView();
}
function toggleAdminMenu(open) {
  const show =
    typeof open === "boolean"
      ? open
      : !document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", show);
  document
    .getElementById("adminMenuButton")
    .setAttribute("aria-expanded", String(show));
  if (show) document.querySelector(".admin-menu-close").focus();
  else document.getElementById("adminMenuButton").focus();
}
function renderAdminCurrentView() {
  const metadata = ADMIN_VIEWS[adminView];
  document.getElementById("adminPageTitle").textContent = metadata.title;
  document.getElementById("adminPageDescription").textContent =
    adminMode === "server"
      ? ADMIN_SERVER_DESCRIPTIONS[adminView]
      : metadata.description;
  document.getElementById("adminCrumb").textContent = metadata.title;
  document.title = `${metadata.title} | إدارة تسويقات`;
  document.querySelectorAll("[data-view]").forEach((link) => {
    const active = link.dataset.view === adminView;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("adminPageActions").innerHTML =
    ADMIN_RECORD_KINDS.includes(adminView) ? adminAddButton(adminView) : "";
  if (ADMIN_RECORD_KINDS.includes(adminView))
    renderAdminRecordSection(adminView);
  else
    ({
      overview: renderAdminOverview,
      plans: renderAdminPlans,
      connections: renderAdminConnections,
      operations: renderAdminOperations,
      audit: renderAdminAudit,
      site: renderAdminSite,
      settings: renderAdminSettings,
    })[adminView]();
}
function navigateAdminHash() {
  if (!adminReady) return;
  if (adminSaving) {
    history.replaceState(null, "", "#" + adminView);
    return;
  }
  const hash = location.hash.slice(1);
  const next = Object.prototype.hasOwnProperty.call(ADMIN_VIEWS, hash)
    ? hash
    : "overview";
  if (next !== adminView && adminSiteDirty) {
    if (!confirm("مغادرة محرر الموقع دون حفظ التغييرات المحلية؟")) {
      history.replaceState(null, "", "#" + adminView);
      return;
    }
    adminSiteDirty = false;
  }
  if (document.getElementById("adminDialog").open) {
    if (adminSaving) {
      history.replaceState(null, "", "#" + adminView);
      return;
    }
    if (adminFormDirty && !confirm("مغادرة النموذج دون حفظ؟")) {
      history.replaceState(null, "", "#" + adminView);
      return;
    }
    closeAdminDialog(true);
  }
  adminView = next;
  if (hash !== next) history.replaceState(null, "", "#" + next);
  renderAdminCurrentView();
  if (document.body.classList.contains("menu-open")) toggleAdminMenu(false);
}
async function refreshAdminWorkspace() {
  if (adminSaving || !adminReady) return;
  if (
    (adminFormDirty || adminSiteDirty) &&
    !confirm(
      "إعادة التحميل ستزيل نص النموذج غير المحفوظ. انسخه أولًا إن احتجت إليه. هل تريد تحميل النسخة الحالية؟",
    )
  )
    return;
  closeAdminDialog(true);
  adminSiteDirty = false;
  setAdminSaving(true);
  adminSaving = true;
  const success = await readAdminRepository();
  adminSaving = false;
  setAdminSaving(false);
  if (success) {
    document.getElementById("adminStorageNotice").hidden = true;
    applyAdminTheme();
    renderAdminCurrentView();
    adminToast(
      adminMode === "server"
        ? "حُمّلت النسخة الحالية من الخادم."
        : "حُدّثت المعاينة المحلية.",
    );
  }
}
async function initAdminWorkspace() {
  installAdminEvents();
  if (!(await readAdminRepository())) return false;
  adminReady = true;
  document.getElementById("adminGate").hidden = true;
  document.getElementById("adminShell").hidden = false;
  updateAdminModeChrome();
  applyAdminTheme();
  navigateAdminHash();
  return true;
}
function installAdminEvents() {
  if (adminEventsInstalled) return;
  adminEventsInstalled = true;
  document.getElementById("adminRecordForm").addEventListener("input", () => {
    adminFormDirty = true;
  });
  document.getElementById("adminRecordForm").addEventListener("change", () => {
    adminFormDirty = true;
  });
  document.getElementById("adminDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAdminDialog();
  });
  window.addEventListener("hashchange", navigateAdminHash);
  window.addEventListener("storage", async (event) => {
    if (adminMode !== "demo" || !adminReady) return;
    if (event.key !== ADMIN_STORAGE_KEY && event.key !== null) return;
    // Never rerender an open form: retain entered text and reject its old snapshot.
    if (
      document.getElementById("adminDialog").open ||
      adminSiteDirty ||
      adminSaving
    ) {
      showAdminStorageNotice(
        "تغيّرت بيانات إدارة المعاينة في تبويب آخر. احتفظ بنص النموذج ثم حدّث العرض؛ لن تُحفظ نسخة قديمة فوق البيانات الجديدة.",
      );
      return;
    }
    if (await readAdminRepository()) {
      applyAdminTheme();
      renderAdminCurrentView();
      adminToast(
        "تحديث محلي من تبويب آخر في المتصفح نفسه؛ ليس مزامنة مع الخادم.",
      );
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!adminFormDirty && !adminSiteDirty && !adminSaving) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      document.body.classList.contains("menu-open") &&
      !document.getElementById("adminDialog").open
    )
      toggleAdminMenu(false);
    if (
      event.key !== "Tab" ||
      !document.body.classList.contains("menu-open") ||
      document.getElementById("adminDialog").open
    )
      return;
    const focusable = Array.from(
      document.getElementById("adminSidebar").querySelectorAll("a, button"),
    ).filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  return true;
}

// Integration handoff: a single adapter plus explicit handlers and a state factory.
// Exposed for the integration owner; this object does NOT activate a backend.
window.TaswiqatAdminUI = {
  repository: adminRepository,
  localRepository: adminLocalRepository,
  serverRepository: adminServerRepository,
  freshState: freshAdminState,
  validateState: validateAdminState,
  handlers: {
    submitRecord: submitAdminRecord,
    deleteRecord: deleteAdminRecord,
    changeStatus: changeAdminRecordStatus,
    saveSite: saveAdminSite,
    importBackup: importAdminBackup,
    reset: resetAdminWorkspace,
  },
  refresh: refreshAdminWorkspace,
};
bootstrapAdminSession();

function adminCurrentTheme() {
  return adminMode === "demo"
    ? adminState.theme
    : adminState.settings?.theme || "light";
}
function setAdminSaving(saving) {
  const shell = document.getElementById("adminShell");
  shell.setAttribute("aria-busy", String(saving));
  document.getElementById("adminSavingStatus").hidden = !saving;
  document.getElementById("adminSavingStatus").textContent =
    adminMode === "server" ? "جارٍ انتظار تأكيد الخادم…" : "جارٍ حفظ المعاينة…";
  document
    .querySelectorAll(
      "#adminShell button, #adminShell input, #adminShell select, #adminShell textarea, #adminDialog button, #adminDialog input, #adminDialog select, #adminDialog textarea",
    )
    .forEach((control) => {
      if (saving) {
        control.dataset.adminBusyWasDisabled = String(control.disabled);
        control.disabled = true;
      } else if (
        Object.prototype.hasOwnProperty.call(
          control.dataset,
          "adminBusyWasDisabled",
        )
      ) {
        control.disabled = control.dataset.adminBusyWasDisabled === "true";
        delete control.dataset.adminBusyWasDisabled;
      }
    });
}
async function adminRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    adminAssert(
      adminSession?.csrfToken,
      "لا يوجد رمز CSRF للجلسة. أعد تسجيل الدخول؛ لم يُرسل التغيير.",
    );
    headers["X-CSRF-Token"] = adminSession.csrfToken;
    headers["X-Taswiqat-Origin"] = window.location.origin;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        "الخادم لم يُرجع JSON صالحًا. لا يوجد تحويل إلى الحفظ المحلي.",
      );
    }
    if (!response.ok) {
      const error = new Error(
        payload?.error?.message || "تعذّر تنفيذ طلب الإدارة.",
      );
      error.status = response.status;
      error.code = payload?.error?.code || "REQUEST_FAILED";
      if (
        (response.status === 401 || response.status === 403) &&
        path !== "/api/session"
      ) {
        lockAdminWorkspace(
          response.status === 403
            ? "لا تملك الجلسة صلاحية الإدارة."
            : "انتهت جلسة الإدارة. أعد الدخول.",
        );
      }
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(
        "انتهت مهلة الاتصال. لا نعرف إن وصل طلب الحفظ للخادم؛ احتفظ بالنموذج وأعد تحميل النسخة للتحقق، ولا تكرر الطلب تلقائيًا.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function renderAdminGate(title, message, allowLogin = true) {
  document.getElementById("adminShell").hidden = true;
  document.getElementById("adminGate").hidden = false;
  document.getElementById("adminGateTitle").textContent = title;
  document.getElementById("adminGateMessage").textContent = message;
  document.getElementById("adminLoginButton").hidden = !allowLogin;
  document.getElementById("adminLoginButton").disabled = adminAuthBusy;
  document.getElementById("adminGateError").textContent = "";
  document.getElementById("adminGateLogout").hidden = true;
}
function lockAdminWorkspace(message) {
  adminReady = false;
  adminMode = "locked";
  adminSession = null;
  closeAdminDialog(true);
  adminState = freshAdminState();
  adminSnapshot = null;
  adminSiteDirty = false;
  document.getElementById("adminView").innerHTML = "";
  document.getElementById("adminDialogFields").innerHTML = "";
  renderAdminGate("الدخول إلى إدارة تسويقات", message);
}
async function bootstrapAdminSession() {
  if (adminAuthBusy || adminSaving) return;
  if (forwardAdminToDeployment()) return;
  adminAuthBusy = true;
  adminReady = false;
  adminMode = "locked";
  adminState = freshAdminState();
  adminSnapshot = null;
  renderAdminGate(
    "التحقق من جلسة الإدارة",
    "جارٍ طلب الجلسة من الخادم. لن تُحمّل أي سجلات قبل التحقق من دور الإدارة.",
    false,
  );
  try {
    const session = await adminRequest("/api/session");
    if (!session?.authenticated) {
      adminSession = null;
      renderAdminGate(
        "الدخول إلى إدارة تسويقات",
        "سجّل الدخول عبر الخادم. لا توجد لوحة إدارة عامة أو بيانات محفوظة محليًا تُستخدم كهوية.",
      );
      return;
    }
    if (session.user?.role !== "admin") {
      adminSession = session;
      renderAdminGate(
        "الوصول غير مسموح",
        "هذه الجلسة ليست لإدارة الشركة المشغلة. لم تُطلب بيانات الإدارة.",
        false,
      );
      document.getElementById("adminGateLogout").hidden = false;
      return;
    }
    adminAssert(
      typeof session.csrfToken === "string" && session.csrfToken.length > 0,
      "جلسة الخادم لم تتضمن رمز CSRF. لن نفعّل الحفظ.",
    );
    adminSession = session;
    adminMode = "server";
    if (!(await initAdminWorkspace())) {
      renderAdminGate(
        "تعذّر تحميل الإدارة",
        "فشل تحميل النسخة الموثّقة من الخادم. اضغط إعادة التحقق؛ لا يوجد بديل محلي تلقائي.",
        false,
      );
      document.getElementById("adminGateError").textContent = adminLastError;
    }
  } catch (error) {
    adminSession = null;
    adminMode = "locked";
    renderAdminGate(
      "خادم الإدارة غير متاح",
      "تعذّر التحقق من الجلسة. لا بيانات عملاء ولا حفظ محلي بديل. يمكنك إعادة المحاولة أو فتح المعاينة المنفصلة.",
    );
    document.getElementById("adminGateError").textContent =
      adminErrorMessage(error);
  } finally {
    adminAuthBusy = false;
    document.getElementById("adminLoginButton").disabled = false;
  }
}
async function startAdminLogin() {
  if (adminAuthBusy) return;
  adminAuthBusy = true;
  document.getElementById("adminLoginButton").disabled = true;
  try {
    const params = new URLSearchParams({
      origin: window.location.origin,
      target: "admin",
    });
    const result = await adminRequest("/api/auth/start?" + params.toString());
    adminAssert(
      typeof result?.url === "string",
      "لم يرجع الخادم رابط دخول صالحًا.",
    );
    const url = new URL(result.url, window.location.origin);
    adminAssert(
      url.protocol === "https:" ||
        (url.protocol === "http:" && url.origin === window.location.origin),
      "رابط الدخول غير آمن.",
    );
    window.location.assign(url.href);
  } catch (error) {
    document.getElementById("adminGateError").textContent =
      adminErrorMessage(error);
  } finally {
    adminAuthBusy = false;
    document.getElementById("adminLoginButton").disabled = false;
  }
}
async function logoutAdminSession() {
  if (adminSaving || adminAuthBusy) return;
  if (adminMode === "demo") {
    lockAdminWorkspace(
      "أُغلقت المعاينة المحلية. لا توجد هوية تجريبية مصادق عليها.",
    );
    return;
  }
  if ((adminFormDirty || adminSiteDirty) && !confirm("الخروج دون حفظ النموذج؟"))
    return;
  adminAuthBusy = true;
  try {
    await adminRequest("/api/auth/logout", { method: "POST", body: {} });
    lockAdminWorkspace("تم تسجيل الخروج من الخادم.");
  } catch (error) {
    if (adminReady) adminShowError(adminErrorMessage(error));
    else
      document.getElementById("adminGateError").textContent =
        adminErrorMessage(error);
  } finally {
    adminAuthBusy = false;
  }
}
async function startAdminDemo() {
  if (adminAuthBusy || adminSaving) return;
  if (
    !confirm(
      "فتح معاينة إدارة غير محمية منفصلة؟ لا تدخل بيانات عملاء حقيقية. الحفظ محلي على هذا المتصفح فقط، وليست جلسة إدارة مصادقًا عليها.",
    )
  )
    return;
  adminSession = null;
  adminMode = "demo";
  adminStorageBlocked = false;
  if (!(await initAdminWorkspace())) {
    // Explicit demo can surface corrupted storage, but never silently overwrites it.
    adminReady = true;
    document.getElementById("adminGate").hidden = true;
    document.getElementById("adminShell").hidden = false;
    updateAdminModeChrome();
    navigateAdminHash();
  }
}
function updateAdminModeChrome() {
  const live = adminMode === "server";
  document.getElementById("adminSafety").innerHTML = live
    ? `<span class="admin-safety-mark" aria-hidden="true">!</span><div><strong>إدارة عبر الخادم — الجلسة تحقّق منها الخادم، والحفظ في قاعدة البيانات بعد تأكيده فقط.</strong><p>سجلات المستخدمين والأدوار لا تعني إرسال دعوة، وتتبع الاشتراكات لا يعني تحصيل دفعة. تكاملات القنوات والنشر مستقلة.</p></div>`
    : `<span class="admin-safety-mark" aria-hidden="true">!</span><div><strong>معاينة إدارة غير محمية — لا تدخل بيانات عملاء حقيقية. الحفظ محلي على هذا المتصفح.</strong><p>لا مصادقة أو دفع أو اشتراكات فعلية أو مزامنة بين العملاء. الأدوار والحالات سجلات للمعاينة فقط.</p></div>`;
  document.getElementById("adminModeBadge").textContent = live
    ? "بيانات الخادم"
    : "معاينة محلية فقط";
  document.getElementById("adminWorkspaceTitle").textContent = live
    ? "إدارة الشركة المشغلة"
    : "مساحة إدارة المعاينة";
  document.getElementById("adminWorkspaceSubtitle").textContent = live
    ? adminSession.user.name || adminSession.user.email
    : "سجلات محلية · بلا تسجيل دخول";
  document.getElementById("adminSideNote").textContent = live
    ? "الوصول والحفظ يخضعان لصلاحيات الخادم. الربط والنشر والدفع لا يُفترض نجاحها من السجلات."
    : "لا اتصال بالخادم، ولا صلاحيات فعلية. هذه اللوحة ليست بوابة دخول آمنة.";
  document.getElementById("adminLogoutButton").textContent = live
    ? "تسجيل الخروج"
    : "إغلاق المعاينة المحلية";
}
const ADMIN_SERVER_DESCRIPTIONS = {
  overview:
    "مؤشرات من سجلات الخادم الحالية. سجلات الاشتراك ليست دليلًا على الدفع، ولا نعرض إيرادات أو توافر API غير موثّق.",
  workspaces:
    "إدارة سجلات أنشطة العملاء على الخادم. إضافة السجل تهيئة بيانات وليست إنشاء هوية دخول لمالكه.",
  users:
    "هويات الدخول الموثّقة وأدوار النظام، حتى دون نشاط مرتبط. البريد والدور والعضوية للقراءة فقط؛ الحالة والصلاحيات يفرضهما الخادم، ولا دعوة مرسلة هنا.",
  subscriptions:
    "سجل وصول يدوي يُنشأ مع النشاط؛ الباقة والحالة تؤثران في الوصول والحصص على الخادم. لا دفع أو فواتير أو تحصيل أو تجديد آلي.",
  plans:
    "تعديل الباقات والأسعار المقترحة وحدود القنوات والأعضاء التي يفرضها الخادم. لا عملية دفع أو تفعيل تكامل أو تعديل تحصيل سابق.",
  connections:
    "جرد القنوات المستهدفة للقراءة. لا نحول بيانات الجرد إلى إثبات اتصال أو صلاحيات نشر.",
  operations:
    "النشر والطابور بانتظار تكامل التنفيذ. لا تنفيذ تجريبي ولا نجاح مفترض.",
  tickets:
    "تذاكر الدعم المحفوظة في الخادم وأولوياتها ومسؤول متابعتها. لا تُرسل رسائل خارجية من هذه الواجهة.",
  audit:
    "أحداث التغيير التي يعيدها الخادم. الفاعل والتاريخ والسجل يحددها الخادم، لا هوية المعاينة.",
  site: "تعديل محتوى الموقع في قاعدة البيانات. الحفظ يؤثر في النسخة العامة التي تقرأ إعدادات الخادم، وليس في المتصفح وحده.",
  settings:
    "إعدادات الإدارة ونسخة JSON من البيانات التي حمّلها الخادم. لا مفاتيح خاصة ولا مسح جماعي لقاعدة البيانات.",
};
function renderAdminServerOverview() {
  const counts = [
    ["أنشطة العملاء", adminState.workspaces.length, "سجلات محفوظة في الخادم"],
    ["سجلات المستخدمين", adminState.users.length, "ليست عدد جلسات مصادقة"],
    [
      "سجلات الاشتراكات",
      adminState.subscriptions.length,
      "ليست إثبات اشتراكات مدفوعة",
    ],
    [
      "تذاكر تحتاج متابعة",
      adminState.tickets.filter((x) => x.status !== "closed").length,
      "مفتوحة أو قيد المعالجة",
    ],
  ];
  const workspaces = adminLatest(adminState.workspaces).map(
    (x) =>
      `<li><div class="between"><div><strong>${adminEscape(x.name)}</strong><small>${adminEscape(x.businessType)} · ${adminEscape(adminPlanName(x.planId))}</small></div>${adminBadge(x.status)}</div></li>`,
  );
  const tickets = adminLatest(adminState.tickets).map(
    (x) =>
      `<li><div class="between"><div><strong>${adminEscape(x.title)}</strong><small>${adminEscape(adminWorkspaceName(x.workspaceId))}</small></div>${adminBadge(x.status)}</div></li>`,
  );
  const audit = adminState.audit
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(
      (x) =>
        `<li><strong>${adminEscape(x.message)}</strong><small>${adminEscape(x.actor)} · ${adminTime(x.date)}</small></li>`,
    );
  document.getElementById("adminView").innerHTML =
    `<section class="card admin-overview-intro"><div><div class="eyebrow">الشركة المشغلة</div><h2>رؤية أوضح لإدارة الأنشطة.</h2><p>نظّم سجلات العملاء والمستخدمين وتتبّع اشتراكاتهم ودعمهم. لن يُعد أي تعديل محفوظًا قبل تأكيد الخادم، ولن تُفترض دفعة أو دعوة أو عملية نشر.</p></div>${adminAddButton("workspaces")}</section><div class="summary-grid">${counts.map(([label, value, detail]) => `<section class="card summary"><div class="summary-label">${label}</div><strong>${adminNumber(value)}</strong><small>${detail}</small></section>`).join("")}</div><div class="home-columns">${adminListPanel("أحدث الأنشطة", "workspaces", workspaces, "لا توجد سجلات أنشطة من الخادم.")}${adminListPanel("متابعة الدعم", "tickets", tickets, "لا توجد تذاكر مسجلة.")}</div>${adminListPanel("أحدث تغييرات الخادم", "audit", audit, "لا أحداث تغيير من الخادم بعد.")}`;
}
function renderAdminServerPlans() {
  document.getElementById("adminView").innerHTML =
    `<div class="notice info">الحفظ يحدّث الباقات في قاعدة البيانات والصفحة العامة التي تقرأها. يفرض الخادم حدود القنوات والأعضاء بحسب باقة النشاط؛ السعر مقترح ولا يُحصّل مبلغًا أو يفعّل دفعًا أو تكاملًا.</div><div class="admin-plan-grid">${adminState.plans.map((p) => `<section class="card admin-plan-card"><div class="between"><div class="eyebrow">باقة وحدود الخادم</div><span class="badge ${p.enabled ? "purple" : "red"}">${p.enabled ? "مفعّلة للعرض" : "موقوفة للعرض"}</span></div><h2>${adminEscape(p.name)}</h2><div class="admin-plan-price"><strong>${adminNumber(p.price)}</strong><small>ر.س / شهر مقترح</small></div><div class="admin-plan-limits"><div>حد القنوات: ${adminNumber(p.channels)}</div><div>حد الأعضاء: ${adminNumber(p.members)}</div><small class="muted">حصص يفرضها الخادم؛ لا رسوم محصّلة ولا دفع أو تكامل مفعّل</small></div><button class="btn secondary" type="button" onclick="openAdminRecord('plans','${p.id}')">تعديل الباقة</button></section>`).join("")}</div><a class="btn ghost" href="index.html" target="_blank" rel="noopener">عرض الموقع العام ↗</a>`;
}
function renderAdminServerSite() {
  adminSiteSnapshot = adminSnapshot;
  adminSiteDirty = false;
  const x = adminState.site;
  document.getElementById("adminView").innerHTML =
    `<section class="card admin-site-form"><form id="adminSiteForm" onsubmit="saveAdminSite(event)" oninput="adminSiteDirty = true"><div class="notice info admin-form-note">حفظ فعلي في قاعدة البيانات. التعديلات تظهر في الموقع الذي يقرأ إعدادات الخادم بعد تحديثه. ليست معاينة محلية.</div><div class="two-cols">${adminInputField("heroLine1", "السطر الأول للعنوان", x.heroLine1, { max: 160 })}${adminInputField("heroLine2", "السطر الثاني للعنوان", x.heroLine2, { max: 160 })}</div>${adminInputField("heroDescription", "وصف الموقع", x.heroDescription, { textarea: true, max: 2000 })}${adminInputField("contactEmail", "بريد التواصل العام (اختياري)", x.contactEmail, { type: "email", max: 254 })}${adminInputField("notice", "تنبيه الموقع العام (اختياري)", x.notice, { textarea: true, max: 2000 })}<p id="adminSiteError" class="form-error" role="alert"></p><div class="admin-form-footer"><button id="adminSiteSave" class="btn primary" type="submit">حفظ محتوى الموقع في الخادم</button><a class="btn ghost" href="index.html" target="_blank" rel="noopener">عرض الموقع العام ↗</a></div></form></section>`;
}
function renderAdminServerSettings() {
  document.getElementById("adminView").innerHTML =
    `<div class="admin-settings-columns"><section class="card"><h2>نسخة من سجلات الخادم الحالية</h2><p>ملف JSON غير مشفّر للنسخة التي حمّلتها، مع رقم إصدارها. قد يحتوي بيانات خاصة؛ احتفظ به في مكان آمن. لا استعادة مباشرة أو مسح جماعي لقاعدة البيانات من هذه الواجهة.</p><button class="btn secondary" type="button" onclick="exportAdminBackup()">تنزيل نسخة JSON</button><div class="notice info" style="margin-top:18px">النسخة تشمل سجلات الإدارة الحالية وليس كلمات مرور أو مفاتيح API. لا تستخدمها بديلًا عن نسخ الخادم الاحتياطية.</div></section><section class="card"><h2>المظهر ومصدر البيانات</h2><p>المصادقة وصلاحية الإدارة من جلسة الخادم، والحفظ باستخدام CSRF ورقم إصدار لمنع الكتابة فوق نسخة أحدث.</p><button class="btn ghost" type="button" onclick="toggleAdminTheme()">${adminCurrentTheme() === "dark" ? "المظهر الفاتح" : "المظهر الداكن"}</button><dl class="admin-storage-stats"><div><dt>مصدر البيانات</dt><dd>الخادم / قاعدة البيانات</dd></div><div><dt>رقم الإصدار</dt><dd>${adminEscape(adminSnapshot)}</dd></div><div><dt>الدفع والنشر</dt><dd>لا تنفيذ من هذه اللوحة</dd></div></dl><button class="btn ghost" type="button" onclick="refreshAdminWorkspace()">تحميل أحدث نسخة من الخادم</button></section></div>`;
}
function renderAdminServerAudit() {
  document.getElementById("adminView").innerHTML = `<section class="card">${
    adminState.audit.length
      ? `<p class="admin-table-hint">السجل والفاعل والتاريخ من الخادم؛ الوقت معروض بمنطقة جهازك.</p><div class="table-wrap" tabindex="0" role="region" aria-label="سجل الخادم القابل للتمرير"><table><thead><tr><th scope="col">الوقت</th><th scope="col">التغيير</th><th scope="col">الفاعل</th></tr></thead><tbody>${adminState.audit
          .slice()
          .reverse()
          .map(
            (x) =>
              `<tr><td>${adminTime(x.date)}</td><td class="admin-text-preserve">${adminEscape(x.message)}</td><td>${adminEscape(x.actor)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : adminEmpty(
          "لا أحداث من الخادم",
          "ستظهر أحداث التغيير التي يعيدها الخادم، لا أحداث تشغيل وهمية.",
          "",
          "◷",
        )
  }</section>`;
}

function forwardAdminToDeployment() {
  const configured = window.TASWIQAT_APP_URL;
  if (!configured) return false;
  try {
    const base = new URL(String(configured));
    adminAssert(
      base.protocol === "https:" ||
        (base.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(base.hostname)),
      "عنوان تطبيق الإدارة غير آمن.",
    );
    adminAssert(
      !base.username && !base.password,
      "عنوان التطبيق لا يجوز أن يحتوي بيانات اعتماد.",
    );
    if (base.origin === window.location.origin) return false;
    base.search = "";
    base.hash = "";
    const target = new URL(base.href.replace(/\/+$/, "") + "/admin.html");
    const hash = window.location.hash.slice(1);
    if (Object.prototype.hasOwnProperty.call(ADMIN_VIEWS, hash))
      target.hash = hash;
    window.location.replace(target.href);
    return true;
  } catch (error) {
    renderAdminGate(
      "عنوان تطبيق الإدارة غير صالح",
      "لم يُرسل أي طلب API ولم تُستخدم بيانات محلية كبديل.",
      false,
    );
    document.getElementById("adminGateError").textContent =
      adminErrorMessage(error);
    return true;
  }
}

function renderAdminServerOperations() {
  const operations = adminState.operations || [];
  document.getElementById("adminView").innerHTML =
    `<div class="notice info">هذه خطط محتوى من الخادم وليست مهام إرسال. لا يوجد تنفيذ نشر مفعّل من هذه اللوحة ولا نجاح يُستنتج من موعد الخطة.</div><section class="card"><div class="section-head"><h2>خطط النشر المسجلة</h2><span class="badge gold">التنفيذ ينتظر التكامل</span></div>${operations.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="خطط النشر القابلة للتمرير"><table><thead><tr><th scope="col">العنوان</th><th scope="col">النشاط</th><th scope="col">الموعد</th><th scope="col">الحالة</th></tr></thead><tbody>${operations.map((item) => `<tr><td>${adminEscape(item.title)}</td><td>${adminEscape(adminWorkspaceName(item.workspaceId))}</td><td>${adminTime(item.scheduledFor)}</td><td><span class="badge gold">خطة — لا إثبات إرسال</span></td></tr>`).join("")}</tbody></table></div>` : adminEmpty("لا خطط نشر مسجلة", "الطابور والتنفيذ الفعلي ينتظران تكامل القنوات. لا مهام أو نتائج افتراضية.", "", "≋")}</section>`;
}
