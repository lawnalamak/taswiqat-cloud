"use strict";
(function installYouTubeConnection() {
  const POLICY_VERSION = "2026-11-17";
  let hooks = null;
  let scope = "";
  let generation = 0;
  let status = "idle";
  let data = null;
  let message = "";
  let revocationState = null;
  let loading = null;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  function context() { return hooks?.context() || {}; }
  function reset() { generation++; scope = ""; status = "idle"; data = null; message = ""; revocationState = null; loading = null; }
  function sync() {
    const c = context();
    const key = c.mode === "live" && c.authenticated && c.loaded ? String(c.workspaceId || "") : "";
    if (key !== scope) { reset(); scope = key; }
    return c;
  }
  function redraw(focus = false) {
    if (context().view === "channels") hooks?.render();
    if (focus) document.getElementById("youtubeConnectCard")?.focus({preventScroll:true});
  }
  function safeChannel(value) {
    if (!value || !/^UC[A-Za-z0-9_-]{22}$/.test(value.channelId || "")) return null;
    const row = {channelId:value.channelId,title:String(value.title || "قناة YouTube").slice(0,200),url:`https://www.youtube.com/channel/${value.channelId}`,thumbnailUrl:""};
    try {
      const u = new URL(value.thumbnailUrl);
      if (u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash && u.href.length <= 2048 && ["yt3.ggpht.com","yt3.googleusercontent.com","i.ytimg.com","img.youtube.com","lh3.googleusercontent.com"].includes(u.hostname)) row.thumbnailUrl = u.href;
    } catch { /* A missing image never prevents a verified identity from rendering. */ }
    return row;
  }
  function validateStatus(value) {
    if (!value || typeof value.ready !== "boolean" || value.policyVersion !== POLICY_VERSION) throw new Error("تعذّر التحقق من إعدادات الربط. أعد تحميل الصفحة.");
    const connection = value.connection && typeof value.connection.status === "string" ? {...value.connection,details:safeChannel(value.connection.details)} : null;
    const candidates = Array.isArray(value.pending?.channels) ? value.pending.channels.map(safeChannel).filter(Boolean) : [];
    return {...value,connection,pending:candidates.length ? {channels:candidates,replacing:value.pending.replacing === true} : null};
  }
  async function refresh() {
    const c = sync();
    if (!scope || c.mode !== "live") return;
    if (loading) return loading;
    const expected = scope, epoch = generation;
    status = "loading"; message = "";
    const work = (async () => {
      try {
        const value = await window.TaswiqatAPI.youtubeStatus(expected);
        sync();
        if (scope !== expected || generation !== epoch) return;
        data = validateStatus(value); status = "ready";
        hooks?.connectionChanged(data.connection,expected);
      } catch (error) {
        sync();
        if (scope !== expected || generation !== epoch) return;
        status = "error"; data = null; message = error.message || "تعذّر تحميل حالة الربط.";
      } finally {
        if (generation === epoch && scope === expected) { loading = null; redraw(); }
      }
    })();
    loading = work;
    return work;
  }
  function scheduleRefresh() {
    if (status === "idle" && scope) {
      status = "loading";
      queueMicrotask(() => { void refresh(); });
    }
  }
  function identity(row) {
    if (!row) return "";
    return `<div class="youtube-identity">${row.thumbnailUrl ? `<img src="${esc(row.thumbnailUrl)}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : ""}<div><strong>${esc(row.title)}</strong><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" dir="ltr">${esc(row.channelId)}</a></div></div>`;
  }
  function renderCard(selected = false) {
    const c = sync();
    scheduleRefresh();
    const busy = status === "busy" || status === "loading";
    const connected = data?.connection?.status === "connected" && data.connection.details;
    const reauth = ["needs_reauth","requires_reauth","revoked"].includes(data?.connection?.status);
    const revocationPending = data?.reason === "revocation_pending";
    const eligible = c.mode === "live" && scope && c.canManage;
    const ready = eligible && data?.ready === true && !revocationPending;
    let reason = "";
    if (c.mode !== "live") reason = "التجربة المحلية لا تربط حسابات حقيقية.";
    else if (!c.canManage) reason = "يتطلب الربط صلاحية صاحب النشاط أو مديره.";
    else if (status === "loading") reason = "جارٍ تحميل إعدادات الربط…";
    else if (status === "error") reason = message;
    else if (revocationPending) reason = "حُذفت بيانات القناة محليًا. إلغاء إذن Google قيد المحاولة؛ لا يمكن بدء ربط بديل حتى انتهاء الطلب. يمكنك سحب الإذن يدويًا ثم تحديث الحالة.";
    else if (!data?.ready) reason = "ربط YouTube غير متاح حاليًا؛ إعداد تطبيق تسويقات لدى قوقل قيد التجهيز.";
    const stateLabel = busy ? (status === "busy" ? "جارٍ تنفيذ طلب الربط…" : "جارٍ التحقق من حالة القناة…") : revocationPending ? "إلغاء الإذن قيد المحاولة" : connected ? "متصلة للقراءة فقط" : reauth ? "يلزم تجديد إذن الوصول" : "لا توجد قناة متصلة";
    const candidates = data?.pending;
    const manualRevoke = revocationPending || ["pending","unavailable"].includes(revocationState);
    const revokeLink = manualRevoke ? '<a class="btn ghost small" href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer">سحب إذن تسويقات من حساب Google</a>' : "";
    const pendingNotice = revocationState === "unavailable" ? '<p class="youtube-unavailable" role="status">حُذفت البيانات محليًا، لكن تعذّر طلب سحب الإذن لدى Google. اسحب إذن تسويقات يدويًا من الرابط أدناه.</p>' : "";
    return `<article class="card channel-card youtube-card" id="youtubeConnectCard" tabindex="-1" aria-labelledby="youtubeCardTitle" aria-busy="${busy}"><div class="row"><span class="channel-logo yt"><img src="assets/channels/yt.svg" alt="" width="32" height="32"></span><div><h3 id="youtubeCardTitle">YouTube</h3><small class="muted">اربط قناة نشاطك</small></div></div><p>اعرض اسم قناتك وصورتها ورابطها داخل تسويقات، دون إعدادات تقنية.</p><div class="youtube-state" role="status" aria-live="polite"><span class="badge ${connected ? "green" : ""}">${esc(stateLabel)}</span>${message && status !== "error" ? `<p>${esc(message)}</p>` : ""}</div>${connected ? identity(data.connection.details) : ""}${candidates ? `<div class="youtube-candidates"><h4>${candidates.replacing ? "أكد القناة التي ستستبدل الاتصال الحالي" : "أي قناة تريد ربطها بهذا النشاط؟"}</h4><p>اختر القناة المقصودة؛ لن نعتمد أول نتيجة تلقائيًا.</p>${candidates.channels.map(row => `<div class="youtube-candidate">${identity(row)}<button class="btn primary small" ${busy || !ready ? "disabled" : ""} onclick="TaswiqatYouTube.confirm('${row.channelId}')">${candidates.replacing ? "اعتماد هذه القناة" : "ربط هذه القناة"}</button></div>`).join("")}<button class="btn ghost small" ${busy || !eligible ? "disabled" : ""} onclick="TaswiqatYouTube.cancel()">إلغاء الاختيار والاحتفاظ بالاتصال السابق</button></div>` : `<button class="btn primary youtube-connect-button" ${ready && !busy ? "" : "disabled"} onclick="TaswiqatYouTube.connect()">${connected ? "تغيير القناة" : reauth ? "إعادة الربط" : "ربط YouTube"}</button>`}<p class="youtube-scope">وصول للقراءة فقط؛ لن ننشر فيديوهات أو نحذف محتوى.</p><p class="youtube-consent">بالضغط على زر الربط، توافق على <a href="/privacy.html" target="_blank" rel="noopener">سياسة الخصوصية</a> و<a href="/terms.html" target="_blank" rel="noopener">شروط الاستخدام</a> الخاصة بهذا التكامل.</p>${reason ? `<p class="youtube-unavailable" role="${status === "error" ? "alert" : "status"}">${esc(reason)}</p>` : ""}${pendingNotice}<div class="youtube-secondary">${status === "error" || manualRevoke ? '<button class="btn small" onclick="TaswiqatYouTube.refresh()">تحديث الحالة</button>' : ""}${revokeLink}<button class="btn ghost small" onclick="selectChannel('yt')" ${c.canManage ? "" : "disabled"}>${selected ? "إلغاء الاختيار للتخطيط" : "اختيار للتخطيط فقط"}</button>${data?.connection && eligible ? `<button class="btn ghost small" ${busy ? "disabled" : ""} onclick="TaswiqatYouTube.disconnect()">فصل القناة وحذف بياناتها من تسويقات</button>` : ""}</div></article>`;
  }
  function outcomeMessage(action,result) {
    if (action === "youtubeDisconnect") {
      return ({completed:"حُذفت بيانات القناة من تسويقات وأكد Google سحب الإذن.",pending:"حُذفت بيانات القناة محليًا. طلب سحب إذن Google قيد المحاولة، ولم يتأكد السحب الخارجي بعد.",unavailable:"حُذفت بيانات القناة محليًا، لكن تعذّر طلب سحب إذن Google؛ يلزم سحبه يدويًا.",not_needed:"لا يوجد اتصال أو رمز محفوظ يحتاج طلب سحب من تسويقات. يمكنك مراجعة صلاحياتك لدى Google."})[result.revocation] || "أكد الخادم الحذف المحلي، لكن لم تتأكد حالة سحب الإذن الخارجي؛ راجع صلاحيات Google.";
    }
    return result?.message || (action === "youtubeCancel" ? "أُلغي طلب الربط. لم نسحب إذن الاتصال السابق." : "اعتمد الخادم القناة المتحققة لهذا النشاط.");
  }
  async function mutate(action,body = {}) {
    const c = sync();
    if (!scope || c.mode !== "live" || !c.canManage || status === "busy") return;
    const expected = scope, epoch = generation;
    status = "busy"; message = ""; redraw();
    try {
      const result = await window.TaswiqatAPI[action](expected,body);
      sync();
      if (scope !== expected || generation !== epoch) return;
      if (result?.ok !== true) throw new Error("لم يؤكد الخادم نتيجة العملية. أعد تحميل الحالة.");
      if (action === "youtubeDisconnect") revocationState = result.revocation || "unavailable";
      else if (action === "youtubeConfirm") revocationState = null;
      const outcome = outcomeMessage(action,result);
      loading = null;
      await refresh();
      if (scope === expected && generation === epoch) {
        message = status === "error" ? `${outcome} تعذّر تحديث بقية الحالة؛ أعد تحميلها.` : outcome;
        redraw(true);
      }
    } catch (error) {
      sync();
      if (scope !== expected || generation !== epoch) return;
      // A timeout does not prove that a mutation failed. Reconcile with the server.
      loading = null;
      await refresh();
      if (scope === expected && generation === epoch) { message = error.message || "تعذّر تأكيد نتيجة العملية. أعد تحميل الحالة."; redraw(true); }
    }
  }
  async function connect() {
    return hooks?.guardLeave(async () => {
      const c = sync();
      if (!scope || c.mode !== "live" || !c.canManage || !data?.ready || data.reason === "revocation_pending" || status === "busy") return;
      const expected = scope, epoch = generation;
      status = "busy"; message = "جارٍ الانتقال إلى Google…"; redraw();
      try {
        const result = await window.TaswiqatAPI.youtubeConnect(expected,POLICY_VERSION);
        sync();
        if (scope !== expected || generation !== epoch) return;
        const u = new URL(result?.url);
        if (u.origin !== "https://accounts.google.com" || u.pathname !== "/o/oauth2/v2/auth" || u.username || u.password || u.searchParams.get("scope") !== "https://www.googleapis.com/auth/youtube.readonly") throw new Error("رفضنا رابط تفويض غير مطابق ليوتيوب للقراءة فقط.");
        try { if (window.top !== window) { window.top.location.href = u.href; return; } } catch { /* Standalone same-tab fallback. */ }
        window.location.assign(u.href);
      } catch (error) {
        sync();
        if (scope !== expected || generation !== epoch) return;
        status = "ready"; message = error.message || "تعذّر بدء الربط."; redraw(true);
      }
    });
  }
  function disconnect() {
    const c = sync();
    if (!scope || !c.canManage || !data?.connection || status === "busy") return;
    if (!window.confirm("فصل القناة وطلب حذف بيانات يوتيوب المحفوظة في تسويقات؟ لا يحذف هذا قناتك أو فيديوهاتك لدى YouTube. قد يؤثر سحب إذن قوقل في خدمات مرتبطة بالمنحة نفسها.")) return;
    return mutate("youtubeDisconnect");
  }
  window.TaswiqatYouTube = Object.freeze({
    configure(value) { hooks = value; reset(); }, reset,refresh,renderCard,connect,disconnect,
    confirm(channelId) { if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId || "") || !data?.ready || data.reason === "revocation_pending" || !data?.pending?.channels.some(row => row.channelId === channelId)) return; return mutate("youtubeConfirm",{channelId}); },
    cancel() { return mutate("youtubeCancel"); },
  });
})();
