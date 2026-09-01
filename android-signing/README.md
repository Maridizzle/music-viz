# Android signing key (sideload builds)

`musicviz.jks` signs the release APK built by `.github/workflows/android.yml`.

It is committed **on purpose**: Android only installs an update over an existing app
when both are signed with the same key, so a key that changed on every CI run would
force users to uninstall/reinstall each time. This is a hobby sideload key — it is
**not** a Play Store upload key and protects nothing secret (the app has no
credentials). Anyone could sign an APK with it, but they'd still need you to
install their APK by hand.

If you ever publish to the Play Store, generate a fresh private key, keep it out of
git, and point `android/app/build.gradle` → `signingConfigs.release` at it (e.g. via
CI secrets).

Regenerate (invalidates updates for existing installs):

```bash
keytool -genkeypair -v -keystore musicviz.jks -alias musicviz -keyalg RSA -keysize 2048 \
  -validity 10000 -storepass musicviz-sideload -keypass musicviz-sideload \
  -dname "CN=Music Visualizer, O=maridizzle"
```
