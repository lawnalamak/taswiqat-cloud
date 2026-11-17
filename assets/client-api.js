"use strict";

// No account identity, passwords or CSRF tokens are persisted in browser storage.
(function installTaswiqatAPI() {
  let csrfToken = "";
  let sessionRequest = null;
  let preAuthToken = "";
  let authOptionsRequest = null;

  class APIError extends Error {
    constructor(message, status = 0, data = null) {
      super(message);
      this.name = "TaswiqatAPIError";
      this.status = status;
      this.data = data;
      this.code = data?.code || data?.error?.code ||
        (typeof data?.error === "string" ? data.error : "request_failed");
    }
  }

  async function request(path, options = {}) {
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      throw new APIError("طلبات التطبيق يجب أن تستخدم API من نفس الموقع.");
    }
    const method = (options.method || "GET").toUpperCase();
    const write = !["GET", "HEAD", "OPTIONS"].includes(method);
    const preAuth = options.preAuth === true;
    if (preAuth && (!write || !/^\/api\/auth\/email\/(register|verify|login|forgot|reset)$/.test(url.pathname))) {
      throw new APIError("مسار حساب غير صالح.");
    }
    if (write && !preAuth && !csrfToken) await session();
    if (write && !preAuth && !csrfToken) {
      window.dispatchEvent(new CustomEvent("taswiqat:session-expired"));
      throw new APIError("انتهت الجلسة أو تعذّر التحقق منها. سجّل الدخول مجددًا.", 401);
    }
    if (preAuth) {
      await authOptions();
      if (!preAuthToken) throw new APIError("تعذّر تجهيز حماية طلب الحساب. أعد المحاولة.");
    }
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (write) {
      headers.set("X-CSRF-Token", preAuth ? preAuthToken : csrfToken);
      headers.set("X-Taswiqat-Origin", window.location.origin);
    }
    let body;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 25000);
    let response;
    try {
      response = await fetch(url.href, {
        method, headers, body, credentials: "same-origin", cache: "no-store",
        redirect: "error", signal: controller.signal,
      });
    } catch (error) {
      throw new APIError(error.name === "AbortError"
        ? "انتهت مهلة الاتصال. لم نتأكد من نتيجة العملية؛ أعد تحميل البيانات قبل المحاولة مجددًا."
        : "تعذّر الاتصال بالخادم. لم نتأكد من نتيجة العملية؛ لم يُؤكد حفظ أي تغيير.");
    } finally {
      clearTimeout(timeout);
    }
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); }
      catch { throw new APIError("استجابة الخادم غير صالحة. لا توجد بيانات تجريبية بديلة.", response.status); }
    }
    if (!response.ok) {
      if (response.status === 401 && !preAuth) {
        csrfToken = "";
        window.dispatchEvent(new CustomEvent("taswiqat:session-expired"));
      }
      if (preAuth && response.status === 403) preAuthToken = "";
      const message = data?.message || data?.error?.message ||
        (response.status === 409 ? "تغيّرت بيانات مساحة العمل في جلسة أخرى."
          : response.status === 403 ? "لا تملك صلاحية لهذه العملية، أو يلزم تجديد الجلسة."
          : response.status === 429 ? "طلبات كثيرة؛ انتظر قليلًا ثم أعد المحاولة."
          : response.status === 402 ? "هذه العملية تتجاوز حدود الباقة الحالية. لا يوجد دفع مفعّل هنا."
          : "رفض الخادم العملية. لم يُعتمد الحفظ.");
      throw new APIError(message, response.status, data);
    }
    return data;
  }

  async function session() {
    if (sessionRequest) return sessionRequest;
    sessionRequest = request("/api/session").then((data) => {
      csrfToken = typeof data?.csrfToken === "string" ? data.csrfToken : "";
      return data;
    }).finally(() => { sessionRequest = null; });
    return sessionRequest;
  }
  async function authOptions() {
    if (authOptionsRequest) return authOptionsRequest;
    authOptionsRequest = request(`/api/auth/options?origin=${encodeURIComponent(window.location.origin)}`).then((data) => {
      preAuthToken = typeof data?.csrfToken === "string" ? data.csrfToken : "";
      return data;
    }).finally(() => { authOptionsRequest = null; });
    return authOptionsRequest;
  }
  const workspacePath = (workspaceId, suffix = "") =>
    `/api/workspaces/${encodeURIComponent(workspaceId)}${suffix}`;

  window.TaswiqatAPI = Object.freeze({
    APIError, request, session,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    delete: (path, body) => request(path, { method: "DELETE", body }),
    setCSRFToken: (token) => { csrfToken = typeof token === "string" ? token : ""; },
    clearSession: () => { csrfToken = ""; },
    authStart: (target = "app") => request(`/api/auth/start?origin=${encodeURIComponent(window.location.origin)}&target=${encodeURIComponent(target)}`),
    authOptions,
    authEmail: (action, body) => request(`/api/auth/email/${encodeURIComponent(action)}`, { method: "POST", body, preAuth: true }),
    authProviderStart: async (provider) => {
      if (!["google", "apple"].includes(provider)) throw new APIError("طريقة الدخول غير مدعومة.");
      await authOptions();
      if (!preAuthToken) throw new APIError("تعذّر تجهيز حماية طلب الدخول. أعد المحاولة.");
      return request(`/api/auth/${provider}/start?origin=${encodeURIComponent(window.location.origin)}`, {
        headers: { "X-CSRF-Token": preAuthToken, "X-Taswiqat-Origin": window.location.origin },
      });
    },
    logout: async () => {
      const result = await request("/api/auth/logout", { method: "POST", body: {} });
      csrfToken = "";
      return result;
    },
    createWorkspace: (business, selected) => request("/api/workspaces", { method: "POST", body: { business, selected } }),
    workspaceState: (workspaceId) => request(workspacePath(workspaceId, "/state")),
    saveWorkspaceState: (workspaceId, state, version) => request(workspacePath(workspaceId, "/state"), { method: "PUT", body: { state, version } }),
    team: (workspaceId) => request(workspacePath(workspaceId, "/team")),
    invite: (workspaceId, invitation) => request(workspacePath(workspaceId, "/invitations"), { method: "POST", body: invitation }),
    acceptInvitation: (token) => request("/api/invitations/accept", { method: "POST", body: { token } }),
    ticket: (workspaceId, subject, message) => request(workspacePath(workspaceId, "/tickets"), { method: "POST", body: { subject, message } }),
    youtubeStatus: (workspaceId) => request(`/api/oauth/google/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    youtubeConnect: (workspaceId, policyVersion) => request("/api/oauth/google/connect?service=yt", { method: "POST", body: { workspaceId, policyVersion } }),
    youtubeConfirm: (workspaceId, value) => request("/api/oauth/google/confirm", { method: "POST", body: { workspaceId, channelId: value.channelId } }),
    youtubeCancel: (workspaceId) => request("/api/oauth/google/cancel", { method: "POST", body: { workspaceId } }),
    youtubeDisconnect: (workspaceId) => request("/api/oauth/google/disconnect", { method: "POST", body: { workspaceId } }),
  });
})();
