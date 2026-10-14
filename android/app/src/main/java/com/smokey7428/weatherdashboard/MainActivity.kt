package com.smokey7428.weatherdashboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/* Native shell around the bundled web app.
 *
 * The UI is the same index.html that runs as the website, served from the APK
 * by WebViewAssetLoader under https://appassets.androidplatform.net/. That host
 * is a real HTTPS origin, which is what the page needs for localStorage, the
 * Content-Security-Policy and (where supported) the service worker — file://
 * would silently disable all of them.
 *
 * Two things are enforced here rather than trusted to the page:
 *
 *   1. Network reach. Requests are filtered against an explicit host list, so
 *      even a tampered asset bundle cannot send anything anywhere else. This
 *      holds independently of the CSP in index.html.
 *   2. Navigation. Anything off the local asset origin opens in the user's
 *      browser instead of loading inside the app.
 *
 * There is no analytics, no advertising and no crash reporting.
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private val handler = Handler(Looper.getMainLooper())

    private var locationListener: LocationListener? = null
    private var locationTimeout: Runnable? = null

    /* Location is only ever returned to our own page, which supplies the
     * coordinates to a weather API after rounding them to ~1 km. */
    private inner class GeoBridge {
        @JavascriptInterface
        fun requestLocation() {
            handler.post { beginLocationRequest() }
        }
    }

    private val requestLocationPermission =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            if (result.values.any { it }) fetchLocation()
            else sendLocationError("Location permission denied")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        /* Android 15 targets are edge-to-edge whether or not the app asks for it,
         * so opt in explicitly and inset the content ourselves. That keeps the
         * page clear of the status and navigation bars on every version, rather
         * than only on the ones that inset automatically. */
        enableEdgeToEdge()

        webView = WebView(this)
        configureWebView()

        root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(START_URL)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(BACKGROUND)

        if (0 != applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // the saved location lives here
            setGeolocationEnabled(true)       // fallback path only; see GeoBridge
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            /* No user-agent override: a custom string would make this device
               more identifiable, not less. */
        }

        webView.addJavascriptInterface(GeoBridge(), "AndroidGeo")

        webView.webViewClient = object : WebViewClient() {

            /* Enforce the network allow-list. Returning a response short-circuits
             * the request before it can leave the device. */
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url
                val scheme = url.scheme ?: return null
                if (scheme != "https" && scheme != "http") return null

                if (url.host == ASSET_HOST) {
                    return assetLoader.shouldInterceptRequest(url) ?: blocked(url)
                }
                if (url.host != null && ALLOWED_HOSTS.contains(url.host)) return null

                return blocked(url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                if (url.host == ASSET_HOST) return false
                openExternally(url)
                return true
            }
        }

        /* Only needed for the navigator.geolocation fallback. The native bridge
         * above is the path actually used, because a WebView's own geolocation
         * depends on this prompt firing, which it does not always do. */
        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                val granted = hasLocationPermission()
                callback?.invoke(origin, granted, false)
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Network policy
     * ------------------------------------------------------------------ */

    private fun blocked(url: Uri): WebResourceResponse {
        Log.w(TAG, "blocked request to ${url.host}")
        return WebResourceResponse(
            "text/plain", "utf-8", 403, "Forbidden",
            emptyMap(), ByteArrayInputStream(ByteArray(0))
        )
    }

    private fun openExternally(url: Uri) {
        val scheme = url.scheme ?: return
        if (scheme != "https" && scheme != "http") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (e: Exception) {
            Log.w(TAG, "no app can open $url")
        }
    }

    /* ------------------------------------------------------------------
     *  Location
     * ------------------------------------------------------------------ */

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    private fun beginLocationRequest() {
        if (hasLocationPermission()) {
            fetchLocation()
        } else {
            requestLocationPermission.launch(
                arrayOf(
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION
                )
            )
        }
    }

    private fun fetchLocation() {
        val manager = getSystemService(LOCATION_SERVICE) as? LocationManager
        if (manager == null) {
            sendLocationError("Location unavailable")
            return
        }

        /* Prefer a recent cached fix. It is instant, it does not power up the GPS
         * radio just to put a name on the screen, and a fix this fresh is already
         * accurate to the ~1 km the weather request is rounded to anyway. */
        val cached = mostRecentCached(manager)
        if (cached != null && System.currentTimeMillis() - cached.time <= CACHED_FIX_MAX_AGE_MS) {
            sendLocation(cached)
            return
        }

        val providers = ArrayList<String>(2)
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            providers.add(LocationManager.NETWORK_PROVIDER)
        }
        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            providers.add(LocationManager.GPS_PROVIDER)
        }
        if (providers.isEmpty()) {
            sendLocationError("Location is turned off")
            return
        }

        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                sendLocation(location)
            }

            @Deprecated("Required on API levels below 30.")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

            override fun onProviderEnabled(provider: String) = Unit

            override fun onProviderDisabled(provider: String) = Unit
        }
        locationListener = listener

        try {
            for (provider in providers) {
                manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
            }
        } catch (e: SecurityException) {
            stopLocationUpdates()
            sendLocationError("Location permission denied")
            return
        } catch (e: IllegalArgumentException) {
            stopLocationUpdates()
            sendLocationError("Location unavailable")
            return
        }

        val timeout = Runnable { sendLocationError("Location timed out") }
        locationTimeout = timeout
        handler.postDelayed(timeout, LOCATION_TIMEOUT_MS)
    }

    private fun mostRecentCached(manager: LocationManager): Location? {
        if (!hasLocationPermission()) return null
        val candidates = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (e: SecurityException) {
                    null
                } catch (e: IllegalArgumentException) {
                    null
                }
            }
        return candidates.maxByOrNull { it.time }
    }

    private fun stopLocationUpdates() {
        locationTimeout?.let { handler.removeCallbacks(it) }
        locationTimeout = null
        locationListener?.let { listener ->
            val manager = getSystemService(LOCATION_SERVICE) as? LocationManager
            try {
                manager?.removeUpdates(listener)
            } catch (e: Exception) {
                // already gone
            }
        }
        locationListener = null
    }

    private fun sendLocation(location: Location) {
        stopLocationUpdates()
        val js = "window.__onLocation && window.__onLocation(" +
            location.latitude + ", " + location.longitude + ")"
        evaluate(js)
    }

    private fun sendLocationError(message: String) {
        stopLocationUpdates()
        evaluate("window.__onLocationError && window.__onLocationError(${jsString(message)})")
    }

    private fun evaluate(script: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.evaluateJavascript(script, null)
        } else {
            handler.post { webView.evaluateJavascript(script, null) }
        }
    }

    private fun jsString(value: String): String {
        val out = StringBuilder(value.length + 2)
        out.append('"')
        for (c in value) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (c.code < 0x20) {
                    out.append(String.format("\\u%04x", c.code))
                } else {
                    out.append(c)
                }
            }
        }
        out.append('"')
        return out.toString()
    }

    /* ------------------------------------------------------------------
     *  Lifecycle
     * ------------------------------------------------------------------ */

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        stopLocationUpdates()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        stopLocationUpdates()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "WeatherDashboard"

        /* The local asset origin created by WebViewAssetLoader. */
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html"

        /* The complete set of upstream hosts this app may reach. Must stay in
         * step with the connect-src/img-src directives in index.html. */
        private val ALLOWED_HOSTS = setOf(
            "api.open-meteo.com",
            "air-quality-api.open-meteo.com",
            "geocoding-api.open-meteo.com",
            "archive-api.open-meteo.com",
            "api.rainviewer.com",
            "server.arcgisonline.com",
            "tilecache.rainviewer.com"
        )

        private val BACKGROUND = Color.parseColor("#0b1220")
        private const val CACHED_FIX_MAX_AGE_MS = 15 * 60 * 1000L
        private const val LOCATION_TIMEOUT_MS = 20 * 1000L
    }
}
