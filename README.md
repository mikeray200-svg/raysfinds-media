# NaijaGrad Jobs

An app for Nigerian graduates: upload your certificates → the app reads them (Claude) → builds your CV → searches live vacancies → applies on your behalf.

```
backend/   Node API. Holds the Anthropic key, reads documents, writes CVs (PDF), searches jobs (Claude + web search), sends applications by email
web/       The app UI (plain HTML/JS). Served by the backend for browser testing AND bundled inside the APK
android/   Thin Android WebView wrapper that packages web/ into an APK
```

## Why a backend? (your Anthropic key)
Anything inside an APK can be extracted. So the key lives only on the server (`backend/.env`), and the APK talks to your server. Set `ACCESS_CODE` so strangers can't spend your credits.

## 1. Run the backend
```
cd backend && cp .env.example .env   # fill in ANTHROPIC_API_KEY (+ SMTP_* to enable emailing applications)
npm install && npm start             # http://localhost:8787 also serves the app UI for testing
npm test                             # 7 tests against a mock Anthropic server
```
Deploy it anywhere that runs Node 20+ (Render, Railway, Fly.io, a VPS). It must be reachable over **https**.

## 2. Get the APK (no computer needed)
Every push to the branch builds the APK on GitHub (`.github/workflows/build-apk.yml`). It is a **private artifact**: log in to GitHub on your phone, open the repo's **Actions** tab, tap the latest green run, and download **NaijaGradJobs-apk** (a zip containing `app-release.apk`). Unzip, open the APK, and allow "install unknown apps" when Android asks. Artifacts expire after 90 days.

## 3. Build the APK yourself (optional)
Requires JDK 17+, Gradle 8.9+, and the Android SDK (platform 34).
```
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties
keytool -genkeypair -keystore release.keystore -storepass naijagrad -keypass naijagrad -alias naijagrad -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=NaijaGrad Jobs"
gradle assembleRelease      # -> app/build/outputs/apk/release/app-release.apk
```
(For the Play Store, use your own keystore and passwords.) On first launch, open ⚙ Settings and enter your server address and access code.

## How applying works (honest limits)
* Vacancies that print an application **email** are applied to automatically: cover letter written by Claude, your CV PDF attached, replies go to the graduate's own email. The graduate approves each one.
* Vacancies that use an **online portal** can't be auto-submitted (logins, CAPTCHAs). The app prepares the cover letter and opens the page.
* Job results come from live web search and are not guaranteed accurate; the app warns about fee-charging scams.
