"use strict";
/* Taswiqat account access UI. Sessions, CSRF and all authority belong to the API.
   No account, workspace, invitation, password or token is written to storage. */
(function installTaswiqatAuthPortal() {
  const instances = new WeakMap();
  let lastPanel = null;
  let sequence = 0;
  const views = new Set(["login", "register", "forgot", "reset", "verify"]);
  const EMAIL_UNAVAILABLE = "تسجيل البريد واستعادة كلمة المرور قيد التفعيل";
  const CLOSURE = "إنشاء الحسابات الجديدة متوقف حاليًا. إذا كان لديك حساب، يمكنك تسجيل الدخول.";
  const COPY = {
    login: { title: "أهلًا بعودتك", description: "سجّل الدخول إلى حساب تسويقات للوصول إلى مساحة عملك.", submit: "تسجيل الدخول بالبريد", busy: "جارٍ تسجيل الدخول…" },
    register: { title: "أنشئ حساب تسويقات", description: "نبدأ باسمك وبريدك. تختار كلمة المرور بنفسك بعد التحقق من بريدك.", submit: "متابعة للتحقق من البريد", busy: "جارٍ معالجة طلب التسجيل…" },
    forgot: { title: "نسيت كلمة المرور؟", description: "الاستعادة مخصصة لحسابات البريد وكلمة المرور المحلية في تسويقات. إذا كنت تدخل عبر Google أو Apple أو Manus، استعد الوصول من مزود الدخول نفسه.", submit: "طلب استعادة كلمة المرور", busy: "جارٍ معالجة طلب الاستعادة…" },
    reset: { title: "كلمة مرور جديدة", description: "اختر كلمة مرور جديدة لحسابك في تسويقات، ثم سجّل الدخول بها.", submit: "حفظ كلمة المرور الجديدة", busy: "جارٍ حفظ كلمة المرور…" },
    verify: { title: "أكمل توثيق حسابك", description: "اختر كلمة المرور بعد التحقق من بريدك. لا نطلب كلمة مرور عند إرسال طلب التسجيل الأول.", submit: "توثيق الحساب والمتابعة", busy: "جارٍ توثيق الحساب…" },
  };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const api = () => window.TaswiqatAPI;
  // Only reset/verify read a token. Never interpolate it into HTML or an error.
  function hashToken(view) {
    if (view !== "reset" && view !== "verify") return "";
    try {
      const hash = window.location.hash || "";
      const query = hash.indexOf("?");
      if (query < 0) return "";
      const token = new URLSearchParams(hash.slice(query + 1)).get("token") || "";
      // Keep proof only in this mounted controller, not browser history or analytics URLs.
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#auth/${view}`);
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
    } catch { return ""; }
  }
  function safeError(error, action) {
    // Do not expose error.message/data: upstream bodies may contain sensitive data.
    const code = String(error?.code || "");
    const status = Number(error?.status || 0);
    if (status === 429 || code === "rate_limited") return "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.";
    if (code === "registration_closed" || code === "registration_disabled") return CLOSURE;
    if (["email_unavailable", "email_disabled", "mail_unavailable", "email_not_configured"].includes(code)) return EMAIL_UNAVAILABLE;
    if (["provider_unavailable", "provider_disabled", "provider_not_configured"].includes(code)) return "خيار الدخول هذا قيد التفعيل. اختر وسيلة دخول أخرى متاحة.";
    if (code === "canonical_login_required") return "أكمل هذه الطريقة من صفحة الدخول على عنوان تسويقات الرئيسي، لا من المعاينة المضمّنة.";
    if (action === "login" && (status === 401 || code === "invalid_credentials")) return "تعذّر تسجيل الدخول بهذه البيانات. تحقق من البريد وكلمة المرور.";
    if (action === "verify" || action === "reset") {
      if ([400, 401, 403, 410].includes(status) || /token|expired/.test(code)) return "تعذّر اعتماد الرابط. قد يكون منتهيًا أو مستخدمًا؛ اطلب رابطًا جديدًا.";
    }
    if (code === "email_not_verified" || code === "verification_required") return "يلزم توثيق البريد قبل الدخول. استخدم رابط التحقق الذي يصلك من تسويقات.";
    if (status === 403 || code === "csrf_invalid") return "تعذّر التحقق من الطلب. أعد تحميل خيارات الدخول ثم حاول مجددًا.";
    if (status === 400 || status === 422) return "لم يعتمد الخادم البيانات. راجع الحقول ثم أعد المحاولة.";
    if (!status || status >= 500) return "تعذّر تأكيد نتيجة الطلب بسبب الاتصال بالخادم. لم نؤكد إرسال بريد أو تسجيل دخول؛ انتظر ثم أعد المحاولة.";
    return "لم يؤكد الخادم إتمام العملية. أعد المحاولة أو استخدم وسيلة دخول أخرى متاحة.";
  }
  function fieldHTML(prefix, name, label, type, autocomplete, hint = "") {
    const id = `${prefix}-${name}`;
    const password = type === "password";
    return `<div class="auth-field"><label for="${id}">${label}</label><div class="auth-input-wrap${password ? " auth-password-wrap" : ""}"><input id="${id}" name="${name}" type="${type}" autocomplete="${autocomplete}" required ${name === "name" ? 'maxlength="100" dir="auto"' : 'dir="ltr"'} ${name === "email" ? 'maxlength="254" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com"' : ""} ${password ? 'minlength="12" maxlength="128" autocapitalize="none" spellcheck="false"' : ""} aria-describedby="${id}-error${hint ? ` ${id}-hint` : ""}" aria-invalid="false">${password ? `<button type="button" class="auth-password-toggle" data-toggle="${name}" aria-controls="${id}" aria-pressed="false" aria-label="إظهار ${label}">إظهار</button>` : ""}</div>${hint ? `<small id="${id}-hint" class="auth-hint">${hint}</small>` : ""}<small id="${id}-error" class="auth-field-error" aria-live="polite" hidden></small></div>`;
  }
  function mount(panel, options = {}) {
    if (!panel || panel.nodeType !== 1) throw new TypeError("TaswiqatAuthPortal.mount requires a panel element.");
    const view = views.has(options.view) ? options.view : "login";
    const previous = instances.get(panel);
    const query = (window.location.hash || "").split("?")[1] || "";
    const hasNewProof = new URLSearchParams(query).has("token");
    // Back/forward can emit both popstate and hashchange. The first mount scrubs
    // the URL; the second must not destroy the only in-memory email proof.
    if (["verify", "reset"].includes(view) && previous?.view === view &&
        previous.token && current(previous) && !hasNewProof) {
      previous.options = options;
      if (options.message) setStatus(previous, options.message, "info");
      return Object.freeze({ unmount: () => { if (instances.get(panel) === previous) unmount(panel); }, refreshOptions: () => loadCapabilities(previous) });
    }
    unmount(panel);
    const prefix = `taswiqat-auth-${++sequence}`;
    const state = {
      panel, options, view, prefix, root: null, disposed: false, epoch: 0, capabilitiesEpoch: 0,
      busy: false, busyAction: "", capabilities: null, capabilitiesState: "loading",
      touched: new Set(), submitted: false, completed: false, token: hashToken(view), focusFrame: 0,
    };
    instances.set(panel, state);
    lastPanel = panel;
    panel.classList.add("auth-portal-card");
    const root = document.createElement("div");
    root.className = "auth-portal";
    root.dir = "rtl";
    root.lang = "ar";
    root.dataset.view = view;
    state.root = root;
    const identityView = view === "login" || view === "register";
    const copy = COPY[view];
    let fields = "";
    if (view === "register") fields += fieldHTML(prefix, "name", "الاسم", "text", "name");
    if (["login", "register", "forgot"].includes(view)) fields += fieldHTML(prefix, "email", "البريد الإلكتروني", "email", "username");
    if (["login", "reset", "verify"].includes(view)) fields += fieldHTML(prefix, "password", view === "login" ? "كلمة المرور" : "كلمة المرور الجديدة", "password", view === "login" ? "current-password" : "new-password", "من 12 إلى 128 حرفًا. استخدم كلمة مرور فريدة لهذا الحساب.");
    if (view === "reset" || view === "verify") fields += fieldHTML(prefix, "confirmation", "تأكيد كلمة المرور", "password", "new-password");
    const context = options.invite
      ? "لديك دعوة لمساحة عمل. بعد الدخول، يعود التطبيق إلى الدعوة لتأكيدها؛ الدخول وحده لا يقبلها."
      : options.setup ? "بعد توثيق حسابك، يمكنك متابعة إعداد مساحة نشاطك. إنشاء الحساب لا يبدأ اشتراكًا مدفوعًا." : "";
    root.innerHTML = `<aside class="auth-intro" aria-label="تسويقات"><a href="/" class="brand auth-brand" data-action="home"><span class="brand-mark" aria-hidden="true">⇄</span><span>تسويقات</span></a><div class="auth-intro-content"><span class="auth-eyebrow"><span aria-hidden="true"></span>مساحة نشاطك</span><h2>أعمالك، <br>من مكان واحد.</h2><p>ادخل بحسابك لتنظيم محتوى نشاطك والعمل مع فريقك في مساحة مستقلة.</p><div class="auth-intro-details"><div><strong>حسابك أولًا</strong><span>الدخول يثبت هويتك، والصلاحيات يحددها نشاطك.</span></div><div><strong>قنواتك باختيارك</strong><span>ربط خدمات التسويق خطوة منفصلة داخل مساحة العمل.</span></div></div></div><div class="auth-intro-foot"><span class="auth-intro-rule" aria-hidden="true"></span>تسويقات • لنشاطك وفريقك</div></aside><section class="auth-main" aria-labelledby="${prefix}-title"><div class="auth-topline"><span>حساب تسويقات</span><a href="/" data-action="home" class="auth-home">العودة للموقع <span aria-hidden="true">←</span></a></div><header class="auth-header"><h1 id="${prefix}-title" tabindex="-1">${copy.title}</h1><p>${copy.description}</p></header>${context ? `<p class="auth-context">${context}</p>` : ""}<div class="auth-status" data-status role="status" aria-live="polite" aria-atomic="true" tabindex="-1" hidden></div><div class="auth-capability-note" data-capability-note role="status" aria-live="polite"><span>جارٍ التحقق من خيارات الدخول…</span><button type="button" data-action="retry" class="auth-inline-button" hidden>إعادة المحاولة</button></div><p class="auth-closure" data-closure hidden>${CLOSURE}</p>${identityView ? `<div class="auth-providers" aria-label="خيارات الدخول عبر مزود"><button type="button" class="auth-provider auth-google" data-provider="google" disabled aria-describedby="${prefix}-provider-note"><img src="/assets/auth/google-official.png" width="40" height="40" alt="" aria-hidden="true"><span>المتابعة عبر <bdi>Google</bdi></span><small data-provider-state="google">قيد التفعيل</small></button><button type="button" class="auth-provider auth-apple" data-provider="apple" disabled aria-describedby="${prefix}-provider-note"><span class="auth-apple-icon"><img src="/assets/auth/apple-official.svg" width="40" height="40" alt="" aria-hidden="true"></span><span>المتابعة عبر <bdi>Apple</bdi></span><small data-provider-state="apple">قيد التفعيل</small></button></div><p id="${prefix}-provider-note" class="auth-provider-note">هذه الخيارات للدخول إلى تسويقات فقط؛ لا تربط إعلانات Google أو قنوات التسويق. غير المفعّل موسوم «قيد التفعيل».</p><div class="auth-divider"><span>أو باستخدام البريد</span></div>` : ""}<form class="auth-form" novalidate aria-describedby="${prefix}-email-note">${fields}${view === "login" ? '<div class="auth-form-tools"><a href="#auth/forgot" data-view="forgot" class="auth-text-link">نسيت كلمة المرور؟</a></div>' : ""}<p id="${prefix}-email-note" class="auth-email-note" data-email-note hidden>${EMAIL_UNAVAILABLE}</p><p class="auth-token-note" data-token-note role="alert" hidden>الرابط غير مكتمل. افتح رابط البريد الصحيح أو اطلب رابطًا جديدًا.</p><button type="submit" class="auth-submit" data-submit disabled><span data-submit-label>${copy.submit}</span><span class="auth-spinner" data-submit-spinner aria-hidden="true" hidden></span></button></form><div class="auth-completion" data-completion hidden><a href="#auth/login" class="auth-submit" data-view="login">العودة لتسجيل الدخول <span aria-hidden="true">←</span></a></div><div class="auth-safe-entry" data-safe-entry hidden><button type="button" data-action="manus" class="auth-safe-button" disabled><span>متابعة عبر الدخول الآمن</span><span aria-hidden="true">←</span></button><p>خيار الدخول الآمن يستخدم حساب <bdi>Manus</bdi>، وهو مستقل عن Google وApple والبريد.</p></div><nav class="auth-view-links" aria-label="التنقل بين خيارات الحساب">${view === "login" ? '<span>ليس لديك حساب؟</span> <a href="#auth/register" data-view="register" class="auth-text-link">إنشاء حساب</a>' : view === "register" ? '<span>لديك حساب بالفعل؟</span> <a href="#auth/login" data-view="login" class="auth-text-link">تسجيل الدخول</a>' : `<a href="#auth/login" data-view="login" class="auth-text-link">العودة لتسجيل الدخول</a>${view === "verify" ? ' <span aria-hidden="true">·</span> <a href="#auth/register" data-view="register" class="auth-text-link">طلب رابط تحقق جديد</a>' : view === "reset" ? ' <span aria-hidden="true">·</span> <a href="#auth/forgot" data-view="forgot" class="auth-text-link">طلب رابط استعادة جديد</a>' : ""}`}</nav><footer class="auth-footer"><p class="auth-privacy">كلمات المرور مخصصة لحساب البريد في تسويقات فقط. لا تدخل هنا كلمة مرور Google أو Apple أو Manus.</p>${typeof options.onDemo === "function" ? '<button type="button" class="auth-demo-link" data-action="demo">استكشف الواجهة بدون حساب <span aria-hidden="true">←</span></button><p class="auth-demo-note">تجربة محلية منفصلة؛ لا تربط خدمات ولا ترسل منشورات أو دعوات ولا تنشئ اشتراكًا.</p>' : ""}</footer></section>`;
    panel.replaceChildren(root);
    state.handlers = {
      click: (event) => handleClick(state, event),
      submit: (event) => handleSubmit(state, event),
      input: (event) => handleInput(state, event),
      focusout: (event) => handleBlur(state, event),
    };
    Object.entries(state.handlers).forEach(([name, handler]) => root.addEventListener(name, handler));
    if (typeof options.message === "string" && options.message) setStatus(state, options.message, "info");
    syncControls(state);
    state.focusFrame = window.requestAnimationFrame(() => {
      if (current(state)) root.querySelector("h1")?.focus({ preventScroll: true });
    });
    loadCapabilities(state);
    return Object.freeze({ unmount: () => { if (instances.get(panel) === state) unmount(panel); }, refreshOptions: () => loadCapabilities(state) });
  }
  const current = (state) => !state.disposed && instances.get(state.panel) === state && state.root.parentNode === state.panel;
  const find = (state, selector) => state.root.querySelector(selector);
  function setStatus(state, message, kind = "error", focus = false) {
    if (!current(state)) return;
    const element = find(state, "[data-status]");
    element.textContent = typeof message === "string" ? message : "";
    element.hidden = !element.textContent;
    element.dataset.kind = kind;
    element.setAttribute("role", kind === "error" ? "alert" : "status");
    if (focus && !element.hidden) element.focus({ preventScroll: false });
  }
  function registrationAllowed(state) {
    return state.view !== "register" || state.capabilities?.registrationEnabled === true;
  }
  function emailAllowed(state) {
    return state.capabilitiesState === "ready" && state.capabilities?.email === true && registrationAllowed(state) && (!(state.view === "reset" || state.view === "verify") || !!state.token);
  }
  function syncControls(state) {
    if (!current(state)) return;
    const closed = state.capabilities?.registrationEnabled === false;
    const ready = state.capabilitiesState === "ready";
    const note = find(state, "[data-capability-note]");
    const noteText = note.querySelector("span");
    note.hidden = ready;
    noteText.textContent = state.capabilitiesState === "error" ? "تعذّر تحميل خيارات الدخول. أعد المحاولة للتحقق من الخيارات المتاحة." : "جارٍ التحقق من خيارات الدخول…";
    note.querySelector("button").hidden = state.capabilitiesState !== "error";
    note.querySelector("button").disabled = state.busy;
    find(state, "[data-closure]").hidden = !closed || !["login", "register"].includes(state.view);
    find(state, "[data-email-note]").hidden = !(ready && state.capabilities?.email !== true);
    find(state, "[data-token-note]").hidden = !(["reset", "verify"].includes(state.view) && !state.token);
    state.root.querySelectorAll("[data-provider]").forEach((button) => {
      const provider = button.dataset.provider;
      const enabled = ready && state.capabilities?.[provider] === true;
      button.disabled = state.busy || state.completed || !enabled || !registrationAllowed(state);
      const label = find(state, `[data-provider-state="${provider}"]`);
      label.hidden = enabled && registrationAllowed(state) && state.busyAction !== provider;
      label.textContent = !enabled ? "قيد التفعيل" : !registrationAllowed(state) ? "التسجيل مغلق" : state.busyAction === provider ? "جارٍ الانتقال…" : "";
    });
    const safe = find(state, "[data-safe-entry]");
    // Preserve a previously confirmed fallback during capability retry/failure.
    const manus = state.capabilities?.manus === true && typeof state.options.onManusLogin === "function";
    safe.hidden = !manus || !["login", "register"].includes(state.view) || state.completed;
    safe.querySelector("button").disabled = state.busy || !registrationAllowed(state);
    safe.querySelector("button span").textContent = state.busyAction === "manus" ? "جارٍ فتح الدخول الآمن…" : "متابعة عبر الدخول الآمن";
    const submit = find(state, "[data-submit]");
    submit.disabled = state.busy || state.completed || !emailAllowed(state);
    find(state, "[data-submit-label]").textContent = state.busyAction === "email" ? COPY[state.view].busy : COPY[state.view].submit;
    find(state, "[data-submit-spinner]").hidden = state.busyAction !== "email";
    find(state, "form").setAttribute("aria-busy", String(state.busy));
    state.root.querySelectorAll("input").forEach((input) => { input.readOnly = state.busy; });
    state.root.querySelectorAll("[data-toggle]").forEach((button) => { button.disabled = state.busy; });
    state.root.dataset.busy = String(state.busy);
    state.root.dataset.emailAvailable = String(emailAllowed(state));
  }
  async function loadCapabilities(state) {
    if (!current(state) || state.busy || state.capabilitiesState === "pending") return;
    const epoch = ++state.capabilitiesEpoch;
    state.capabilitiesState = "pending";
    syncControls(state);
    try {
      if (typeof api()?.authOptions !== "function") throw new Error("API unavailable");
      const response = await api().authOptions();
      if (!current(state) || epoch !== state.capabilitiesEpoch) return;
      if (!response || typeof response.manus !== "boolean" || typeof response.email !== "boolean" || typeof response.google !== "boolean" || typeof response.apple !== "boolean" || typeof response.registrationEnabled !== "boolean") throw new Error("Invalid capabilities");
      // Deliberately do not retain csrfToken in the UI; API helpers manage it.
      state.capabilities = { manus: response.manus, email: response.email, google: response.google, apple: response.apple, registrationEnabled: response.registrationEnabled };
      state.capabilitiesState = "ready";
    } catch {
      if (!current(state) || epoch !== state.capabilitiesEpoch) return;
      state.capabilitiesState = "error";
    }
    syncControls(state);
  }
  function validateField(state, input, force = false) {
    if (!input || !["name", "email", "password", "confirmation"].includes(input.name)) return true;
    const value = input.value;
    let message = "";
    if (!value.trim()) message = input.name === "name" ? "أدخل اسمك." : input.name === "email" ? "أدخل بريدك الإلكتروني." : input.name === "confirmation" ? "أعد إدخال كلمة المرور للتأكيد." : "أدخل كلمة المرور.";
    else if (input.name === "name" && value.trim().length < 2) message = "اكتب اسمًا من حرفين على الأقل.";
    else if (input.name === "name" && value.length > 100) message = "الاسم يجب ألا يتجاوز 100 حرف.";
    else if (input.name === "email" && (value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))) message = "أدخل بريدًا إلكترونيًا صحيحًا، مثل name@example.com.";
    else if (input.name === "password" && value.length < 12) message = "كلمة المرور يجب أن تحتوي على 12 حرفًا على الأقل.";
    else if ((input.name === "password" || input.name === "confirmation") && value.length > 128) message = "كلمة المرور يجب ألا تتجاوز 128 حرفًا.";
    else if (input.name === "confirmation" && value !== find(state, '[name="password"]').value) message = "تأكيد كلمة المرور لا يطابق كلمة المرور الجديدة.";
    const show = force || state.submitted || state.touched.has(input.name);
    if (show) {
      const error = find(state, `#${input.id}-error`);
      error.textContent = message;
      error.hidden = !message;
      input.setAttribute("aria-invalid", String(!!message));
    }
    return !message;
  }
  function handleInput(state, event) {
    if (!current(state) || state.busy || !(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    if (input.getAttribute("aria-invalid") === "true") state.touched.add(input.name);
    validateField(state, input);
    if (input.name === "password") validateField(state, find(state, '[name="confirmation"]'));
  }
  function handleBlur(state, event) {
    if (!current(state) || !(event.target instanceof HTMLInputElement) || state.busy) return;
    state.touched.add(event.target.name);
    validateField(state, event.target);
  }
  function clearPasswords(state) {
    state.root.querySelectorAll('input[name="password"], input[name="confirmation"]').forEach((input) => {
      input.value = "";
      input.type = "password";
      input.setAttribute("aria-invalid", "false");
      const error = find(state, `#${input.id}-error`);
      if (error) { error.hidden = true; error.textContent = ""; }
      const toggle = find(state, `[data-toggle="${input.name}"]`);
      if (toggle) { toggle.textContent = "إظهار"; toggle.setAttribute("aria-pressed", "false"); toggle.setAttribute("aria-label", `إظهار ${input.name === "confirmation" ? "تأكيد كلمة المرور" : "كلمة المرور"}`); }
    });
  }
  async function handleSubmit(state, event) {
    event.preventDefault();
    if (!current(state) || state.busy || state.completed || event.target !== find(state, "form")) return;
    if (!emailAllowed(state)) {
      setStatus(state, state.view === "register" && state.capabilities?.registrationEnabled === false ? CLOSURE : ["verify", "reset"].includes(state.view) && !state.token ? "الرابط غير مكتمل. اطلب رابطًا جديدًا." : EMAIL_UNAVAILABLE, "info", true);
      return;
    }
    state.submitted = true;
    const inputs = Array.from(state.root.querySelectorAll("form input"));
    const invalid = inputs.filter((input) => !validateField(state, input, true));
    if (invalid.length) { invalid[0].focus(); return; }
    const epoch = ++state.epoch;
    const action = state.view;
    const payload = {};
    if (["login", "register", "forgot"].includes(action)) payload.email = find(state, '[name="email"]').value.trim();
    if (action === "register") payload.name = find(state, '[name="name"]').value.trim();
    if (["login", "verify", "reset"].includes(action)) payload.password = find(state, '[name="password"]').value;
    if (["verify", "reset"].includes(action)) payload.token = state.token;
    state.busy = true;
    state.busyAction = "email";
    setStatus(state, "");
    syncControls(state);
    try {
      if (typeof api()?.authEmail !== "function") throw new Error("API unavailable");
      const response = await api().authEmail(action, payload);
      if (!current(state) || epoch !== state.epoch) return;
      if (response?.ok !== true || typeof response.message !== "string" || !response.message) throw new Error("Unconfirmed response");
      clearPasswords(state);
      // Only display the success message actually confirmed by the server.
      setStatus(state, response.message, "success", true);
      if (action === "login" || action === "verify") {
        state.completed = true;
        find(state, "form").hidden = true;
        if (action === "verify") state.token = "";
        if (typeof state.options.onAuthenticated === "function") {
          try { await state.options.onAuthenticated(response); }
          catch {
            if (current(state) && epoch === state.epoch) {
              state.completed = false;
              setStatus(state, "أكد الخادم تسجيل الدخول، لكن تعذّر تحديث مساحة العمل. أعد تحميل الصفحة للمتابعة؛ لا تنشئ حسابًا آخر.", "error", true);
            }
          }
        }
      } else {
        state.completed = true;
        if (action === "reset") state.token = "";
        find(state, "form").hidden = true;
        find(state, "[data-completion]").hidden = false;
      }
    } catch (error) {
      if (!current(state) || epoch !== state.epoch) return;
      setStatus(state, safeError(error, action), "error", true);
    } finally {
      // Erase the transient payload even when this mount has been disposed.
      if (payload.password) payload.password = "";
      if (payload.token) payload.token = "";
      if (current(state) && epoch === state.epoch) {
        state.busy = false;
        state.busyAction = "";
        syncControls(state);
      }
    }
  }
  async function handleClick(state, event) {
    if (!current(state) || !(event.target instanceof Element)) return;
    const target = event.target.closest("[data-action], [data-view], [data-toggle], [data-provider]");
    if (!target || !state.root.contains(target)) return;
    event.preventDefault();
    if (target.disabled) return;
    // Navigation stays usable while a request is running. The parent owns routing,
    // and remount/unmount invalidates every late result of this request.
    if (target.dataset.view) {
      const nextView = target.dataset.view;
      if (views.has(nextView) && typeof state.options.onNavigate === "function") {
        ++state.epoch;
        state.busy = false;
        state.busyAction = "";
        clearPasswords(state);
        syncControls(state);
        state.options.onNavigate(nextView);
      }
      return;
    }
    if (target.dataset.action === "home" || target.dataset.action === "demo") {
      const callback = target.dataset.action === "home" ? state.options.onHome : state.options.onDemo;
      if (typeof callback === "function") {
        ++state.epoch;
        state.busy = false;
        state.busyAction = "";
        clearPasswords(state);
        syncControls(state);
        callback();
      }
      return;
    }
    if (state.busy) return;
    if (target.dataset.toggle) {
      const input = find(state, `[name="${target.dataset.toggle}"]`);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      target.textContent = show ? "إخفاء" : "إظهار";
      target.setAttribute("aria-pressed", String(show));
      target.setAttribute("aria-label", `${show ? "إخفاء" : "إظهار"} ${input.name === "confirmation" ? "تأكيد كلمة المرور" : "كلمة المرور"}`);
      input.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.action === "retry") { await loadCapabilities(state); return; }
    const provider = target.dataset.provider;
    const manus = target.dataset.action === "manus";
    if (!provider && !manus) return;
    if (!registrationAllowed(state) || manus && state.capabilities?.manus !== true || provider && (state.capabilitiesState !== "ready" || state.capabilities?.[provider] !== true)) return;
    const epoch = ++state.epoch;
    state.busy = true;
    state.busyAction = manus ? "manus" : provider;
    setStatus(state, "");
    syncControls(state);
    try {
      if (manus) {
        await state.options.onManusLogin();
      } else {
        if (typeof api()?.authProviderStart !== "function") throw new Error("API unavailable");
        const response = await api().authProviderStart(provider);
        if (!current(state) || epoch !== state.epoch) return;
        if (typeof response?.url !== "string" || !response.url) throw new Error("Missing URL");
        const url = new URL(response.url, window.location.origin);
        const endpoint = provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize";
        if (url.username || url.password || `${url.origin}${url.pathname}` !== endpoint) throw new Error("Invalid URL");
        clearPasswords(state);
        try { window.top.location.href = url.href; }
        catch { window.location.assign(url.href); }
      }
    } catch (error) {
      if (current(state) && epoch === state.epoch) setStatus(state, safeError(error, "provider"), "error", true);
    } finally {
      if (current(state) && epoch === state.epoch) { state.busy = false; state.busyAction = ""; syncControls(state); }
    }
  }
  function unmount(panel = lastPanel) {
    if (!panel) return;
    const state = instances.get(panel);
    if (!state) return;
    state.disposed = true;
    ++state.epoch;
    ++state.capabilitiesEpoch;
    state.token = "";
    window.cancelAnimationFrame(state.focusFrame);
    clearPasswords(state);
    Object.entries(state.handlers || {}).forEach(([name, handler]) => state.root.removeEventListener(name, handler));
    // Only remove our owned node; never clear newly rendered workspace content.
    if (state.root.parentNode === panel) state.root.remove();
    panel.classList.remove("auth-portal-card");
    instances.delete(panel);
    if (lastPanel === panel) lastPanel = null;
  }
  window.TaswiqatAuthPortal = Object.freeze({ mount, unmount });
})();
