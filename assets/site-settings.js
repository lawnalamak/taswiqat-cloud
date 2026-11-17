"use strict";

// Public CMS fields only. Never read operator/client records from localStorage.
(async function () {
  const root = document.getElementById("landingView");
  if (!root) return;
  try {
    const endpoint = window.TASWIQAT_APP_URL
      ? new URL("/api/public/settings", window.TASWIQAT_APP_URL).href
      : "api/public/settings";
    const response = await fetch(endpoint, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
    const data = await response.json();
    if (data.error) return;
    const site = data.site || {};
    const heading = document.getElementById("landingHeroTitle");
    if (heading && typeof site.heroLine1 === "string" && typeof site.heroLine2 === "string") {
      const second = document.createElement("span");
      second.textContent = site.heroLine2;
      heading.replaceChildren(document.createTextNode(site.heroLine1 + " "), second);
    }
    const description = root.querySelector(".landing-hero-description");
    if (description && typeof site.heroDescription === "string") description.textContent = site.heroDescription;
    const plans = Array.isArray(data.plans) ? data.plans : [];
    const cards = [...root.querySelectorAll(".landing-plan")];
    ["basic", "pro", "enterprise"].forEach((id, i) => {
      const plan = plans.find((p) => p && p.id === id);
      const card = cards[i];
      if (!plan || !card) return;
      const price = Number(plan.price);
      const label = card.querySelector(".landing-plan-price strong");
      if (label && Number.isFinite(price) && price >= 0) label.textContent = String(price);
      if (typeof plan.name === "string") card.querySelector("h3").textContent = plan.name;
      card.hidden = plan.enabled === false;
    });
    const footer = root.querySelector(".landing-footer .landing-container");
    if (footer && typeof site.contactEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.contactEmail)) {
      const contact = document.createElement("a");
      contact.id = "operatorContact";
      contact.href = "mailto:" + site.contactEmail;
      contact.textContent = site.contactEmail;
      contact.style.cssText = "display:block;font-size:12px;margin-top:15px;direction:ltr";
      footer.appendChild(contact);
    }
    if (typeof site.notice === "string" && site.notice.trim()) {
      const note = document.createElement("div");
      note.className = "notice info";
      note.id = "operatorSiteNotice";
      note.style.cssText = "margin:18px auto;max-width:1160px;padding:12px 18px";
      note.textContent = site.notice;
      document.getElementById("landingMain")?.prepend(note);
    }
  } catch {
    // Static marketing pages keep their committed public copy when API is unavailable.
    // This is not a local customer/admin data fallback.
  }
})();
