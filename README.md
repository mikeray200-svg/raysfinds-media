# raysfinds-media

Public hosting for [Ray's Finds](https://raysfinds.com) video ads.

Each ad is stored as a GitHub Release asset named `vN.mp4`. Buffer should fetch the Cloudflare Worker URL, not this repo's download link directly:

```
https://media.raysfinds.workers.dev/vN.mp4
```

Example: [v17.mp4](https://media.raysfinds.workers.dev/v17.mp4)

The Worker proxies the Release asset and serves `Content-Type: video/mp4` with `Content-Length` and HTTP Range support. A bare `releases/download` URL 302s and is served as `application/octet-stream`.

This route is the fallback while the Vercel Hobby team `raytheseventh` (`raysfinds-media.vercel.app`) is paused until 23 December 2026.

## Add a new ad

From a machine that has `gh` authenticated as `mikeray200-svg`:

```bash
ln -sfn /path/to/master.mp4 /tmp/vN.mp4
sha1sum /tmp/vN.mp4
gh release create vN /tmp/vN.mp4 \
  --repo mikeray200-svg/raysfinds-media \
  --title "vN <theme name>" \
  --notes "Ray's Finds ad vN. Public MP4; Buffer fetches via https://media.raysfinds.workers.dev/vN.mp4"
```

Then verify the Worker URL before posting:

```bash
curl -sI "https://media.raysfinds.workers.dev/vN.mp4"
# Expect: HTTP/2 200, content-type: video/mp4, content-length == local bytes

curl -sL "https://media.raysfinds.workers.dev/vN.mp4" | sha1sum
# must match the local master
```
