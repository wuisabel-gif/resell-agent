export function renderSitePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>resell·agent</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600;6..96,700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
    :root {
      --bg: oklch(0.972 0.006 312);
      --surface: oklch(0.995 0.003 312);
      --ink: oklch(0.235 0.028 312);
      --ink-soft: oklch(0.34 0.026 310);
      --muted: oklch(0.47 0.022 308);
      --aubergine: oklch(0.205 0.034 313);
      --gold: oklch(0.80 0.085 80);
      --gold-ink: oklch(0.56 0.085 72);
      --line: oklch(0.88 0.01 310);
      --serif: 'Bodoni Moda', Georgia, serif;
      --sans: 'Hanken Grotesk', system-ui, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: var(--sans); color: var(--ink-soft); background: var(--bg); line-height: 1.6; }
    a { color: inherit; text-decoration: none; }
    h1, h2, h3 { font-family: var(--serif); color: var(--ink); font-weight: 600; line-height: 1.1; }
    .wrap { width: min(720px, calc(100% - 2.4rem)); margin: 0 auto; padding: 2.2rem 0 4rem; }
    .brand { font-family: var(--serif); color: var(--ink); font-size: 1.25rem; }
    .brand span { display: block; font-family: var(--sans); font-size: 0.62rem; letter-spacing: 0.28em; text-transform: uppercase; color: var(--gold-ink); margin-top: 0.35rem; }
    .eyebrow { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold-ink); }
    h1 { font-size: clamp(2rem, 5vw, 3.2rem); margin: 0.8rem 0 0.8rem; }
    h1 em { color: var(--gold-ink); font-style: italic; font-weight: 500; }
    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 1.4rem; margin-top: 1.8rem; }
    form { display: grid; gap: 1rem; margin-top: 1.2rem; }
    label { display: grid; gap: 0.4rem; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gold-ink); }
    input, textarea { padding: 0.7rem 0.8rem; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); font: inherit; text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--ink); }
    button { justify-self: start; border: 0; border-radius: 2px; padding: 0.85rem 1.4rem; background: var(--aubergine); color: var(--bg); font: inherit; font-weight: 600; letter-spacing: 0.04em; cursor: pointer; }
    button:disabled { opacity: 0.55; }
    .preview { margin-top: 1rem; max-width: 220px; }
    .preview img { width: 100%; border-radius: 6px; }
    .status { margin-top: 1rem; font-size: 0.9rem; color: var(--muted); }
    .status[data-kind="ok"] { color: var(--gold-ink); }
    .status[data-kind="error"] { color: #8a2f2f; }
    .summary { margin: 1.2rem 0 0.6rem; color: var(--ink); }
    .listing { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
    .listing h3 { text-transform: capitalize; margin-bottom: 0.3rem; }
    .price { color: var(--gold-ink); font-weight: 600; margin-bottom: 0.5rem; }
    .copy { white-space: pre-wrap; font-size: 0.92rem; }
    footer { margin-top: 2rem; font-size: 0.78rem; color: var(--muted); }
    footer a { color: var(--gold-ink); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">resell·agent<span>Resale, considered</span></div>
    <p class="eyebrow" style="margin-top:2.4rem;">Live draft</p>
    <h1>Photograph the piece.<br><em>Receive the listing.</em></h1>
    <p>Upload one photo. The model key stays on this server. First open after idle can take a minute.</p>
    <div class="panel" data-live data-api="">
      <form>
        <label>Photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Notes<textarea name="notes" rows="3" maxlength="2000" placeholder="stain on the left cuff, original dust bag"></textarea></label>
        <button type="submit">Draft with the live model</button>
      </form>
      <div class="preview" data-live-preview></div>
      <p class="status" data-live-status>Checking the live model…</p>
      <div data-live-result></div>
    </div>
    <footer>Also on <a href="https://wuisabel-gif.github.io/resell-agent/">the guide</a> · review before you place a listing</footer>
  </div>
  <script>
    (function () {
      var root = document.querySelector("[data-live]");
      if (!root) return;
      var form = root.querySelector("form");
      var photo = root.querySelector('input[type="file"]');
      var notes = root.querySelector("textarea");
      var button = root.querySelector("button[type=submit]");
      var status = root.querySelector("[data-live-status]");
      var result = root.querySelector("[data-live-result]");
      var preview = root.querySelector("[data-live-preview]");
      function setStatus(text, kind) {
        if (!status) return;
        status.textContent = text;
        status.dataset.kind = kind || "";
      }
      fetch("/api/health").then(function (res) { return res.json(); }).then(function (body) {
        if (body && body.ok && body.ready) setStatus("Live model is ready. One photo, then draft.", "ok");
        else setStatus("The service is up, but the model key is not set yet.", "warn");
      }).catch(function () { setStatus("The live model is waking up. Try again in a minute.", "warn"); });
      if (photo) photo.addEventListener("change", function () {
        if (!preview) return;
        preview.replaceChildren();
        var file = photo.files && photo.files[0];
        if (!file) return;
        var img = document.createElement("img");
        img.alt = "Selected piece";
        img.src = URL.createObjectURL(file);
        preview.appendChild(img);
      });
      if (form) form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var file = photo && photo.files && photo.files[0];
        if (!file) { setStatus("Choose a photo first.", "error"); return; }
        if (button) button.disabled = true;
        setStatus("Reading the piece…", "ok");
        if (result) result.replaceChildren();
        var data = new FormData();
        data.set("photo", file);
        data.set("notes", notes ? notes.value : "");
        try {
          var response = await fetch("/api/draft", { method: "POST", body: data });
          var payload = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(payload.error || ("Draft failed (" + response.status + ")"));
          setStatus("Draft ready. Review before placing.", "ok");
          if (!result) return;
          var attrs = payload.attributes || {};
          var price = payload.price || {};
          var summary = document.createElement("p");
          summary.className = "summary";
          var brand = attrs.brand ? attrs.brand + (attrs.brandInferred ? " (verify)" : "") : "unlabelled";
          var range = price.suggested ? ("$" + price.low + "–" + price.high) : "set price manually";
          summary.textContent = brand + " · " + (attrs.category || "item") + " · " + (attrs.condition || "") + " · " + range;
          result.appendChild(summary);
          (payload.listings || []).forEach(function (listing) {
            var el = document.createElement("article");
            el.className = "listing";
            el.innerHTML = "<h3></h3><p class=\\"price\\"></p><p class=\\"copy\\"></p>";
            el.querySelector("h3").textContent = listing.platform;
            el.querySelector(".price").textContent = listing.price ? ("$" + listing.price) : "";
            el.querySelector(".copy").textContent = (listing.title || "") + "\\n\\n" + (listing.description || "");
            result.appendChild(el);
          });
        } catch (error) {
          setStatus(String(error && error.message ? error.message : error), "error");
        } finally {
          if (button) button.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}
