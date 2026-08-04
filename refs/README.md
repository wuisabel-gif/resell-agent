# Reference photos for the brand index

`npm run index -- --dir refs` embeds every image in here and writes
`brand-index.json`. Each draft then matches the item photo against these by visual
similarity (nearest neighbour) to suggest a brand.

## Layout

The **label is the folder name**:

```
refs/
  Coach/        messenger-bag.png, wallet-front.png, ...
  Hermes/       quick-sneakers.png, ...
  Jenni Kayne/  candle-set.png, ...
```

Or, flat, using `Brand__anything.png`:

```
refs/Coach__messenger.png
refs/Hermes__quick.png
```

## Making it good

- More reference photos per brand = sharper matches. A few clean shots per house,
  ideally similar angle to how you photograph items, beats one.
- Add whatever brands you actually resell; there's no fixed list here.
- These three (Coach, Hermès, Jenni Kayne) are just a seed so the index builds out
  of the box — replace them with your own library.

The built `brand-index.json` is gitignored; the reference photos are not, so swap in
your own before committing if this is a private library.
