# pics

Minimal photo gallery: a random-photo page, a gallery with a full-screen viewer, and a light/dark toggle. It's a static site on GitHub Pages, with photos stored in `photos/`.

## How it works
- `photos/` holds the source images.
- `npm run build` (sharp) creates WebP variants with metadata removed (`thumb` 960×600, `md` 1600, `full` 2560) and `photos.json` (newest first). Output goes to `_site/`.
- Each push to `main` runs `.github/workflows/deploy.yml`, which builds and deploys to Pages.
- `upload.html` (not linked in the nav) uploads from your phone. It resizes each photo to 2560 px in the browser, which strips EXIF/GPS, and commits all selected photos in one commit through the GitHub API.

## Local development
```sh
npm install
npm run dev                          # build + serve on http://localhost:3000
PHOTOS_DIR=/path/to/test npm run dev # build from another folder
```

## One-time setup
1. **Repo:** create `RenRMT/pics_gallery` (must be public for free Pages) and push this folder to `main`. If you pick a different name, update `REPO` at the top of `assets/js/upload.js`.
2. **Pages:** go to Settings → Pages → Source: **GitHub Actions**.
3. **DNS:** at your domain's DNS provider, add `CNAME  pics  →  renrmt.github.io`.
4. **Custom domain:** in Settings → Pages, set the domain to `pics.<yourdomain>`. Tick **Enforce HTTPS** once the certificate is issued (can take up to ~1 h).
5. **Prevent subdomain takeover:** in GitHub → Settings → Pages (account level), verify your domain by adding the TXT record it gives you.
6. **Upload token:** go to GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Use *Only select repositories* → `pics_gallery`, with Permissions → **Contents: Read and write**. Choose an expiry you're comfortable renewing.
7. **Phone:** open `https://pics.<yourdomain>/upload.html` in Vanadium and paste the token. Optionally, use ⋮ → *Add to Home screen* so it opens like an app.

## Adding and removing photos
- **Add:** use the upload page. The site updates ~1–2 min after the commit.
- **Remove:** delete the file from `photos/` on github.com. The next deploy removes it from the site.
- ⚠️ **Avoid uploading through github.com directly.** That commits the original file, including GPS location, to the public repo history. The deployed images are stripped either way, but the original stays in git.
