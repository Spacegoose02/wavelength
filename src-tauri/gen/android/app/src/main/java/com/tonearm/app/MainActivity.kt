package com.tonearm.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var host: PlaybackHost? = null

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

  /** Hook up the native media session (steering wheel / Bluetooth / lock screen controls) and in-app updates. */
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    this.webView = webView
    MediaBridge.attach(this, webView)
    UpdateBridge.attach(this, webView)
    MediaBridge.onKeepAwakeChanged = { keep ->
      host?.refresh()
      // already in the background: apply the change now instead of at the next pause / resume
      if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
        if (keep) webView.onResume() else webView.onPause()
      }
    }
  }

  /**
   * Wry hands us its WebView with setContentView(webView). Wrap it in a [PlaybackHost] so that
   * locking the screen doesn't suspend the music (see below).
   */
  override fun setContentView(view: View?) {
    if (view is WebView) {
      val wrap = PlaybackHost(this)
      wrap.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      host = wrap
      super.setContentView(wrap)
    } else {
      super.setContentView(view)
    }
  }

  /**
   * Wry calls webView.onPause() whenever the activity pauses (screen lock, home button), and
   * the WebView suspends media while paused. Undo that while a track is loaded, the same way a
   * browser keeps a playing tab alive; the foreground MediaPlaybackService keeps the process up.
   */
  override fun onPause() {
    super.onPause()
    if (MediaBridge.keepWebViewAwake()) webView?.onResume()
  }

  override fun onDestroy() {
    if (isFinishing) MediaBridge.onKeepAwakeChanged = null
    super.onDestroy()
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

/**
 * Holds the WebView. When the screen locks, Android tells every view in the window that the
 * window is now hidden, and the WebView reacts by suspending the page's <audio> — the music
 * stops. While a track is loaded this host tells the WebView its window is still visible (the
 * same trick flutter_inappwebview's allowBackgroundAudioPlaying uses). The page then also keeps
 * its normal timers, so the queue moves on to the next track with the screen off.
 */
class PlaybackHost(context: Context) : FrameLayout(context) {
  override fun dispatchWindowVisibilityChanged(visibility: Int) {
    super.dispatchWindowVisibilityChanged(if (MediaBridge.keepWebViewAwake()) View.VISIBLE else visibility)
  }

  /** Re-send the window's real visibility, or VISIBLE while a track is loaded. */
  fun refresh() {
    if (isAttachedToWindow) dispatchWindowVisibilityChanged(windowVisibility)
  }
}
