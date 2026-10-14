# The web layer talks to native code only through the AndroidGeo bridge.
# R8 is disabled for this project, but keep these rules so enabling it later
# cannot silently break that bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclasseswithmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# WebView JavascriptInterface entry point
-keep class com.smokey7428.weatherdashboard.MainActivity$GeoBridge { *; }
