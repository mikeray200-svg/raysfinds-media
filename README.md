# raysfinds-media

Public hosting for [Ray's Finds](https://raysfinds.com) video ads.

Each ad is stored as a GitHub Release asset named `vN.mp4` so Buffer can fetch a direct MP4 URL. The files are not kept in the git tree.

## Public URLs

```
https://github.com/mikeray200-svg/raysfinds-media/releases/download/vN/vN.mp4
```

Example: [v17.mp4](https://github.com/mikeray200-svg/raysfinds-media/releases/download/v17/v17.mp4)

This route is the fallback while the Vercel Hobby team `raytheseventh` (`raysfinds-media.vercel.app`) is paused until 23 December 2026.

## Add a new ad

From a machine that has `gh` authenticated as `mikeray200-svg`:

```bash
cp /path/to/master.mp4 /tmp/vN.mp4
sha1sum /tmp/vN.mp4
gh release create vN /tmp/vN.mp4 \
  --repo mikeray200-svg/raysfinds-media \
  --title "vN <theme name>" \
  --notes "Ray's Finds ad vN. Public MP4 for Buffer."
```

Then verify before posting:

```bash
curl -sI -L "https://github.com/mikeray200-svg/raysfinds-media/releases/download/vN/vN.mp4"
# Expect a final HTTP 200, content-type video/mp4 (or a type Buffer accepts), content-length == local bytes

curl -sL -o /tmp/vN-dl.mp4 "https://github.com/mikeray200-svg/raysfinds-media/releases/download/vN/vN.mp4"
sha1sum /tmp/vN-dl.mp4   # must match the local master
```
