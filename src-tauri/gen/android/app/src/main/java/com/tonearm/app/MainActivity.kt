package com.tonearm.app

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge (forced on Android 15+) draws the app under the status bar, the navigation
    // bar and camera cutouts. Pad the content so tablets / car head units don't hide the top
    // menus or the bottom player bar behind system UI.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    requestLocalNetworkAccess()
  }

  /** Hook up the native media session (steering wheel / Bluetooth / lock screen controls). */
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    MediaBridge.attach(this, webView)
  }

  /**
   * Android 17 (API 37) blocks connections to the local network (192.168.x.x, *.local, …) unless
   * the app holds ACCESS_LOCAL_NETWORK — a runtime permission. Without it every request to a
   * home server fails with "error sending request".
   */
  private fun requestLocalNetworkAccess() {
    val wanted = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= 37) wanted += LOCAL_NETWORK
    // Android 13+: needed to show the playback notification with media controls
    if (Build.VERSION.SDK_INT >= 33) wanted += android.Manifest.permission.POST_NOTIFICATIONS
    val missing = wanted.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) ActivityCompat.requestPermissions(this, missing.toTypedArray(), 4201)
  }

  companion object {
    private const val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
  }
}
