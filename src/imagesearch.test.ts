// Check the brittle reverse-image "best guess" parser against fixture HTML.
// Run: npm run build && node dist/imagesearch.test.js
import assert from "node:assert";
import { parseGuess } from "./imagesearch.js";

// Classic "Best guess for this image:" markup.
assert.equal(
  parseGuess(`<div>Best guess for this image: </div><a class="fKDtNb">coach messenger bag</a>`),
  "coach messenger bag"
);

// JSON-embedded bestGuess, with entities decoded.
assert.ok(
  (parseGuess(`...,"bestGuess":"Herm&amp;#39;s Quick sneaker",...`) ?? "").includes("Herm")
);

// og:title fallback (ignores a bare "Google" title).
assert.equal(parseGuess(`<meta property="og:title" content="Google">`), null);
assert.equal(
  parseGuess(`<meta property="og:title" content="Vintage Coach briefcase">`),
  "Vintage Coach briefcase"
);

// Nothing to find.
assert.equal(parseGuess("<html><body>no result</body></html>"), null);

console.log("imagesearch.test ok");
