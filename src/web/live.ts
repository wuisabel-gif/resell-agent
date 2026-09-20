interface LiveListing {
  platform?: string;
  price?: number;
  title?: string;
  description?: string;
}

interface LivePayload {
  error?: string;
  attributes?: {
    brand?: string | null;
    brandInferred?: boolean;
    category?: string;
    condition?: string;
  };
  price?: { suggested?: number; low?: number; high?: number };
  retail?: Array<{ retailer?: string; price?: number; url?: string }>;
  listings?: LiveListing[];
}

function money(value: number | undefined): string {
  return typeof value === "number" && value > 0 ? `$${value}` : "";
}

function safeHttpUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : "";
}

type LiveRetail = { retailer?: string; price?: number; url?: string };

const root = document.querySelector("[data-live]");
if (root) {
  const stored = localStorage.getItem("resell-agent-api") || "";
  const hosted = /\.onrender\.com$/i.test(location.hostname);
  const apiBase = (hosted ? "" : root.getAttribute("data-api") || stored || "https://resell-agent.onrender.com").replace(/\/+$/, "");
  const form = root.querySelector("form");
  const photo = root.querySelector<HTMLInputElement>('input[type="file"]');
  const notes = root.querySelector("textarea");
  const button = root.querySelector<HTMLButtonElement>("button[type=submit]");
  const status = root.querySelector<HTMLElement>("[data-live-status]");
  const result = root.querySelector("[data-live-result]");
  const preview = root.querySelector("[data-live-preview]");

  const setStatus = (text: string, kind?: string) => {
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind || "";
  };

  const card = (listing: LiveListing) => {
    const el = document.createElement("article");
    el.className = "live-listing";
    el.innerHTML = `<h3></h3><p class="live-price"></p><p class="live-copy"></p>`;
    const heading = el.querySelector("h3");
    const price = el.querySelector(".live-price");
    const copy = el.querySelector(".live-copy");
    if (heading) heading.textContent = listing.platform ?? "";
    if (price) price.textContent = money(listing.price);
    if (copy) copy.textContent = `${listing.title ?? ""}\n\n${listing.description ?? ""}`;
    return el;
  };

  const retailBlock = (rows: LiveRetail[]) => {
    const wrap = document.createElement("section");
    wrap.className = "live-retail";
    const heading = document.createElement("h3");
    heading.textContent = "New at retail";
    wrap.appendChild(heading);
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "live-copy";
      empty.textContent = "No retail match found.";
      wrap.appendChild(empty);
      return wrap;
    }
    const list = document.createElement("ul");
    list.className = "live-retail-list";
    for (const row of rows) {
      const item = document.createElement("li");
      const label = `${row.retailer || "retailer"} — ${money(row.price) || "price unknown"}`;
      const href = safeHttpUrl(row.url ?? "");
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = label;
        item.appendChild(link);
      } else {
        item.textContent = label;
      }
      list.appendChild(item);
    }
    wrap.appendChild(list);
    return wrap;
  };

  fetch(`${apiBase}/api/health`)
    .then((res) => res.json())
    .then((body: { ok?: boolean; ready?: boolean }) => {
      if (body && body.ok && body.ready) setStatus("Live model is ready. One photo, then draft.", "ok");
      else setStatus("The live model is up, but the key is not set yet.", "warn");
    })
    .catch(() => {
      setStatus("Live model is asleep or not deployed. First open takes a minute.", "warn");
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
      const payload = (await response.json().catch(() => ({}))) as LivePayload;
      if (!response.ok) throw new Error(payload.error || `Draft failed (${response.status})`);
      setStatus("Draft ready. Review before placing.", "ok");
      if (!result) return;
      const attrs = payload.attributes || {};
      const price = payload.price || {};
      const summary = document.createElement("p");
      summary.className = "live-summary";
      const brand = attrs.brand ? attrs.brand + (attrs.brandInferred ? " (verify)" : "") : "unlabelled";
      const range = price.suggested ? `${money(price.low)}–${money(price.high)}` : "set price manually";
      summary.textContent = `${brand} · ${attrs.category || "item"} · ${attrs.condition || ""} · ${range}`;
      result.appendChild(summary);
      result.appendChild(retailBlock(payload.retail || []));
      (payload.listings || []).forEach((listing) => result.appendChild(card(listing)));
    } catch (error) {
      setStatus(String(error instanceof Error ? error.message : error), "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}
