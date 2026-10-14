# Android app

A thin native shell around the web app in the repository root. The APK contains
the whole UI — `index.html`, the bundled libraries, and the offline city list —
so the app works with no network connection for everything except live weather.

There is no analytics, no advertising and no crash reporting.

## What the shell does

- Serves the bundled web app from `https://appassets.androidplatform.net/` using
  `WebViewAssetLoader`. That is a real HTTPS origin, which is what the page needs
  for `localStorage`, its Content-Security-Policy and the service worker.
  Serving from `file://` would silently disable all of them.
- **Enforces the network allow-list natively.** Every request is checked against
  an explicit host list in `MainActivity.kt` and anything else is answered with a
  403 before it leaves the device. This holds even if the bundled web assets were
  tampered with, and independently of the CSP in `index.html`.
- **Opens off-origin links in the user's browser** rather than inside the app.
- Supplies the device location through a small `AndroidGeo` JavaScript bridge
  instead of relying on a WebView's own geolocation plumbing, which depends on a
  prompt callback that does not fire reliably.

The two host lists — in `MainActivity.kt` and in the CSP in `index.html` — must
be kept in step. Both are commented to say so.

## Toolchain

Everything installs under `~/Library/Android` with no `sudo`:

```bash
./tools/bootstrap-toolchain.sh    # Temurin JDK 17 + Android SDK (platform 35)
```

This provides `JAVA_HOME=~/Library/Android/jdk17/Contents/Home` and
`ANDROID_HOME=~/Library/Android/sdk`. The build script sets both, falling back to
whatever is already exported.

## Signing key

Android identifies an app by its signing key, so this is the app's identity — not
a formality.

```bash
./tools/make-keystore.sh
```

That creates `keystore/weatherdashboard.jks` and `keystore.properties` (both
git-ignored) and prints the certificate's SHA-256 fingerprint.

**Back both files up somewhere durable and private.** If you lose them you cannot
ship an update that installs over an existing copy — everyone would have to
uninstall and reinstall, losing their saved location. Re-running with `--force`
deliberately changes the app's identity.

The key is self-signed and free. It is not a Google Play upload key, and no paid
account is needed to sideload.

## Building

```bash
./tools/build-apk.sh            # signed release APK
./tools/build-apk.sh debug      # debug APK (installs alongside, suffix .debug)
./tools/build-apk.sh clean
```

Output: `app/build/outputs/apk/release/app-release.apk`.

The web app is copied into the APK's assets on every build by the
`syncWebAssets` Gradle task, so a shipped APK can never contain a stale copy of
the UI.

## Installing on a phone

Copy the APK to the phone and open it, or over USB with `adb`:

```bash
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/release/app-release.apk
```

Android will ask the user to allow installing from that source the first time.
Because the APK is not distributed through Google Play, no account or review is
involved.

## Verifying a build

```bash
BT=$(ls -d ~/Library/Android/sdk/build-tools/* | sort -V | tail -1)
APK=app/build/outputs/apk/release/app-release.apk

# what the app is allowed to do
"$BT/aapt2" dump badging "$APK" | grep -E "package:|uses-permission:"

# who signed it
"$BT/apksigner" verify --print-certs "$APK"
```

The permission list should be:

```
android.permission.ACCESS_COARSE_LOCATION
android.permission.ACCESS_FINE_LOCATION
android.permission.INTERNET
com.smokey7428.weatherdashboard.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

The three `android.permission.*` entries are the ones declared in the manifest.
The fourth is injected by `androidx.core`: it is a signature-level permission
scoped to this app's own `applicationId`, so it grants nothing to any other app.
It exists to protect dynamically registered broadcast receivers and cannot be
dropped without risking a `SecurityException` if a support library registers one.
It is listed here so the intent is explicit — CI fails the build if any
*additional* permission appears.

## Sharing the APK

Two things make an unsigned or unknown-signed APK trustworthy to a recipient:

1. **Publish the certificate fingerprint** printed by `make-keystore.sh`. Anyone
   can compare it against the APK they received:
   ```bash
   apksigner verify --print-certs weather-dashboard.apk
   ```
2. **Say that installation is a one-time "allow from this source" prompt.** It is
   not a sign of a malicious app; it is what sideloading always looks like.

## Continuous integration

`.github/workflows/build.yml` builds the APK on every push and attaches it to a
GitHub Release when you push a `v*` tag. It needs four repository secrets, all
taken from `keystore.properties` plus the key itself:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i android/keystore/weatherdashboard.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` |
| `ANDROID_KEY_ALIAS` | `keyAlias` |
| `ANDROID_KEY_PASSWORD` | `keyPassword` |

The workflow also fails if the APK requests anything beyond the three expected
permissions, and prints both the permission list and the signing certificate into
the run summary.

To cut a release:

```bash
git tag v1.0.0 && git push --tags
```

## Notes and gotchas

- **Minification is off on purpose.** R8 cannot be runtime-verified in this
  environment, and the dex is a small part of the APK (the bundled GeoNames list
  dominates it), so it is not worth risking a stripped class. The keep rules in
  `proguard-rules.pro` are in place for if that changes.
- **`--` is not allowed inside XML comments.** A comment referring to the CSS
  variable `--bg` will fail `mergeReleaseResources`.
- **`set -o pipefail` plus `tr < /dev/urandom | head`** kills the generator script
  with SIGPIPE. `make-keystore.sh` uses `openssl rand` instead.
- The adaptive launcher icon's foreground is padded to ~66% because launchers
  mask the outer region; `tools/make-icons.sh` derives everything from the web
  app's `icon-512.png` so the two never drift apart.
- `tools/bootstrap-toolchain.sh` and `tools/build-apk.sh` are safe to re-run;
  they skip anything already installed.
