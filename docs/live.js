(() => {
  "use strict";
  const root = document.querySelector("[data-live]");
  if (!root) return;

  const stored = localStorage.getItem("resell-agent-api") || "";
  const apiBase = (root.getAttribute("data-api") || stored || "https://resell-agent.onrender.com").replace(/\/+$/, "");
  const form = root.querySelector("form");
  const photo = root.querySelector('input[type="file"]');
  const notes = root.querySelector("textarea");
  const button = root.querySelector("button[type=submit]");
  const status = root.querySelector("[data-live-status]");
  const result = root.querySelector("[data-live-result]");
  const preview = root.querySelector("[data-live-preview]");

  const setStatus = (text, kind) => {
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind || "";
  };

  const card = (listing) => {
    const el = document.createElement("article");
    el.className = "live-listing";
    el.innerHTML = `<h3></h3><p class="live-price"></p><p class="live-copy"></p>`;
    el.querySelector("h3").textContent = listing.platform;
    el.querySelector(".live-price").textContent = listing.price ? `$${listing.price}` : "";
    el.querySelector(".live-copy").textContent = `${listing.title}\n\n${listing.description}`;
    return el;
  };

  fetch(`${apiBase}/api/health`)
    .then((res) => res.json())
    .then((body) => {
      if (body && body.ok && body.ready) setStatus("Live model is ready. One photo, then draft.", "ok");
      else setStatus("The Render service is up, but the model key is not set yet.", "warn");
    })
    .catch(() => {
      setStatus("Live model is asleep or not deployed. First open takes a minute on Render’s free plan.", "warn");
    });

  photo?.addEventListener("change", () => {
    const file = photo.files && photo.files[0];
    if (!preview) return;
    preview.replaceChildren();
    if (!file) return;
    const img = document.createElement("img");
    img.alt = "Selected piece";
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = photo && photo.files && photo.files[0];
    if (!file) {
      setStatus("Choose a photo first.", "error");
      return;
    }
    if (button) button.disabled = true;
    setStatus("Reading the piece…", "ok");
    if (result) result.replaceChildren();
    const data = new FormData();
    data.set("photo", file);
    data.set("notes", notes ? notes.value : "");
    try {
      const response = await fetch(`${apiBase}/api/draft`, { method: "POST", body: data });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Draft failed (${response.status})`);
      setStatus("Draft ready. Review before placing.", "ok");
      if (!result) return;
      const attrs = payload.attributes || {};
      const price = payload.price || {};
      const summary = document.createElement("p");
      summary.className = "live-summary";
      const brand = attrs.brand ? attrs.brand + (attrs.brandInferred ? " (verify)" : "") : "unlabelled";
      const range = price.suggested ? `$${price.low}–${price.high}` : "set price manually";
      summary.textContent = `${brand} · ${attrs.category || "item"} · ${attrs.condition || ""} · ${range}`;
      result.appendChild(summary);
      (payload.listings || []).forEach((listing) => result.appendChild(card(listing)));
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
