"use strict";
(async function legalSupportContact() {
  try {
    const response = await fetch("/api/public/settings", {headers:{Accept:"application/json"},credentials:"omit",signal:AbortSignal.timeout(8000)});
    if (!response.ok) return;
    const data = await response.json();
    const email = data?.site?.contactEmail;
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return;
    const box = document.getElementById("legalSupport");
    if (!box) return;
    const link = document.createElement("a");
    link.href = `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
    link.textContent = email;
    link.dir = "ltr";
    box.textContent = "للاستفسارات والشكاوى وطلبات الخصوصية، تواصل مع فريق تسويقات على: ";
    box.append(link);
  } catch { /* Keep the truthful support fallback, never guess an administrator address. */ }
})();
