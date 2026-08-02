# resell-agent

A second-hand sales agent. Point it at photos of an item, it figures out what the
item is, prices it from eBay comps, writes optimized listings for eBay and Poshmark,
and can publish the eBay listing for you.

Two halves:

- **Brain** (read-only, safe): photos to attributes to comps to price to listing copy.
- **Hands** (eBay only for now): publishes a real listing via the eBay Sell API.

Poshmark has no public API, so the tool writes you a ready-to-paste Poshmark listing
but does not auto-post there. Automating the Poshmark UI is a possible later add-on
and carries account-ban risk, so it is intentionally left out of the MVP.

## Setup

1. Install and build: `npm install && npm run build` (rebuild after any code change)
2. `cp .env.example .env` and fill in:
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` from developer.ebay.com to My Account to Application Keys
   - `ANTHROPIC_API_KEY`
   - keep `EBAY_ENV=sandbox` until you are ready to list for real

### For pricing only

Nothing else needed. The Browse API uses an app token that the tool fetches
automatically. You do need production Browse access approved on your eBay app if you
set `EBAY_ENV=production`.

### For posting (one-time)

Posting needs a user token plus a few account identifiers:

1. Register a redirect (RuName) on your eBay app and put it in `EBAY_REDIRECT_URI`.
2. `npm run auth-url`, open the printed URL, approve, copy the `code` from the redirect.
3. `npm run auth-exchange -- <code>`, paste the printed `EBAY_USER_REFRESH_TOKEN` into `.env`.
4. Create business policies (payment, return, fulfillment) and a merchant location once,
   via Seller Hub or the eBay Account API. Note the four IDs. You pass them to `post`.

## Usage

Draft (no posting):

```
npm run draft -- --photos front.jpg,back.jpg,tag.jpg --notes "small stain on left cuff"
```

Writes `draft.json` and prints the price and both listings. Review it.

Post the eBay listing:

```
npm run post -- --draft draft.json \
  --images https://your-host/img1.jpg,https://your-host/img2.jpg \
  --category 15687 \
  --location my-location-key \
  --fulfillment <id> --payment <id> --return <id>
```

Image URLs must be publicly reachable (eBay pulls them). Host them somewhere first.

## Design notes

- Pricing uses sold comps when available. Sold data needs the Marketplace Insights API,
  which is separately gated. Until you have it, the tool falls back to active-listing
  asks discounted 15 percent. `getSoldComps` in `src/ebay/browse.ts` is the hook.
- All the platform-specific eBay posting logic is in `src/ebay/sell.ts`. Swap in a
  Poshmark automation module later behind the same `ListingDraft` shape if you go there.
- The brain modules only depend on the Anthropic client, so you can reuse them headless.

## Layout

```
src/
  cli.ts            command line: draft | post | auth-url | auth-exchange
  pipeline.ts       photos -> priced listings
  types.ts
  config.ts         .env loader + eBay endpoint derivation
  brain/
    anthropic.ts    tiny Messages API client
    extract.ts      photos -> attributes (vision)
    price.ts        comps -> price (trimmed stats)
    listing.ts      attributes -> platform-tuned copy
  ebay/
    auth.ts         app token, user consent, refresh
    browse.ts       active comps (sold comps stub)
    sell.ts         inventory item -> offer -> publish
```

## Roadmap

- Marketplace Insights for real sold comps
- Batch mode: a folder of items in, many drafts out
- Poshmark read-only comps via a scraper, for cross-platform pricing
- Optional Poshmark Playwright poster (weigh the ToS risk first)
