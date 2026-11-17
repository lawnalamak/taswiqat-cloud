"use strict";

// Shared by the customer and operator interfaces. No identity or private state
// is persisted in browser storage. All authority remains on the server.
(function installTaswiqatAPI() {
  let csrfToken = "";
  let sessionRequest = null;

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
    if (write && !csrfToken) await session();
    if (write && !csrfToken) {
      window.dispatchEvent(new CustomEvent("taswiqat:session-expired"));
      throw new APIError("انتهت الجلسة أو تعذّر التحقق منها. سجّل الدخول مجددًا.", 401);
    }
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (write) {
      headers.set("X-CSRF-Token", csrfToken);
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
        : "تعذّر الاتصال بالخادم. لم نتأكد من نتيجة العملية؛ بيانات المحرر بقيت في الذاكرة.");
    } finally {
      clearTimeout(timeout);
    }
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); }
      catch { throw new APIError("استجابة الخادم غير صالحة. لا توجد بيانات تجريبية بديلة.", response.status); }
    }
    if (!response.ok) {
      if (response.status === 401) {
        csrfToken = "";
        window.dispatchEvent(new CustomEvent("taswiqat:session-expired"));
      }
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
  });
})();
