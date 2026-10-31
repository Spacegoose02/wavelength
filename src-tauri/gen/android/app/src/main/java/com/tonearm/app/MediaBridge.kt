package com.tonearm.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Native Android media session for the web player.
 *
 * Android only routes steering-wheel / Bluetooth / headset media buttons, lock-screen controls
 * and "now playing" metadata (car stereos, AVRCP) to an app with an active MediaSession —
 * the WebView's <audio> never creates one. The page reports its player state here
 * (window.WavelengthNative.update(json)); button presses go back to the page as commands
 * (window.__wlMedia('next')).
 *
 * It also answers Android Auto (MediaPlaybackService): the car asks for a folder, the page lists it
 * (window.__wlBrowse → WavelengthNative.browseResult, lib/carBrowse.ts), and picking an item or asking the
 * Assistant plays it (__wlMedia('playId:…') / ('search:…')).
 */
object MediaBridge {
  private var session: MediaSessionCompat? = null
  private var webView: WebView? = null
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var artUrl: String? = null
  private var art: Bitmap? = null
  private var last = JSONObject()
  private val policy = PlaybackPolicy()
  private var appCtx: Context? = null
  private var noisyRegistered = false
  /** The page has run enableNativeMedia (it reported its state once), so commands reach it. */
  private var pageReady = false
  private val queued = mutableListOf<String>()
  private var nextRequest = 1L
  private val browsing = HashMap<String, (List<MediaBrowserCompat.MediaItem>) -> Unit>()

  /** MainActivity listens to keep the WebView awake while a track is loaded (see PlaybackPolicy). */
  var onKeepAwakeChanged: ((Boolean) -> Unit)? = null

  fun session(): MediaSessionCompat? = session

  fun keepWebViewAwake() = policy.keepWebViewAwake

  /** The media session, made on first use: Android Auto can start the service before the app's window exists. */
  fun ensureSession(context: Context): MediaSessionCompat {
    session?.let { return it }
    appCtx = context.applicationContext
    return MediaSessionCompat(context.applicationContext, "Wavelength").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = send("play")
        override fun onPause() = send("pause")
        override fun onStop() = send("pause")
        override fun onSkipToNext() = send("next")
        override fun onSkipToPrevious() = send("prev")
        override fun onSeekTo(pos: Long) = send("seek:" + (pos / 1000.0))
        override fun onPlayFromMediaId(mediaId: String?, extras: android.os.Bundle?) {
          if (mediaId != null) send("playId:$mediaId")
        }
        override fun onPlayFromSearch(query: String?, extras: android.os.Bundle?) = send("search:" + (query ?: ""))
      })
      session = this
    }
  }

  fun attach(context: Context, view: WebView) {
    webView = view
    pageReady = false
    ensureSession(context)
    view.addJavascriptInterface(Js(context.applicationContext), "WavelengthNative")
  }

  /** Deliver a command to the web player; held until the page is listening (Android Auto may get in first). */
  fun send(cmd: String) {
    main.post {
      val v = webView
      if (v == null || !pageReady) {
        if (queued.size < 10) queued += cmd
        if (v == null) openApp()
        return@post
      }
      v.evaluateJavascript("window.__wlMedia && window.__wlMedia(${JSONObject.quote(cmd)})", null)
    }
  }

  /** The car wants something played but Wavelength isn't open: start it (Android may not allow it from the background). */
  private fun openApp() {
    val ctx = appCtx ?: return
    try {
      ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    } catch (e: Exception) { }
  }

  /**
   * A folder's items for Android Auto, from the page. Without the page (Wavelength not open) the car gets
   * one row asking to open it. Gives up after 10 s with nothing, so the car doesn't spin forever.
   */
  fun browse(parent: String, done: (List<MediaBrowserCompat.MediaItem>) -> Unit) {
    main.post {
      val v = webView
      if (v == null || !pageReady) {
        openApp()
        done(listOf(notice("Open Wavelength on your phone", "Then your music shows up here")))
        return@post
      }
      val id = (nextRequest++).toString()
      browsing[id] = done
      main.postDelayed({ browsing.remove(id)?.invoke(emptyList()) }, 10_000)
      v.evaluateJavascript("window.__wlBrowse && window.__wlBrowse(${JSONObject.quote(id)}, ${JSONObject.quote(parent)})", null)
    }
  }

  private fun notice(title: String, subtitle: String) = MediaBrowserCompat.MediaItem(
    MediaDescriptionCompat.Builder().setMediaId("notice").setTitle(title).setSubtitle(subtitle).build(), 0
  )

  private fun toItems(json: String): List<MediaBrowserCompat.MediaItem> {
    val a = try { JSONArray(json) } catch (e: Exception) { return emptyList() }
    return (0 until a.length()).mapNotNull { i ->
      val o = a.optJSONObject(i) ?: return@mapNotNull null
      val d = MediaDescriptionCompat.Builder()
        .setMediaId(o.optString("id"))
        .setTitle(o.optString("title"))
        .setSubtitle(o.optString("subtitle").ifEmpty { null })
      o.optString("art").takeIf { it.startsWith("http") }?.let { d.setIconUri(ArtProvider.uriFor(it)) }
      MediaBrowserCompat.MediaItem(
        d.build(),
        if (o.optBoolean("browsable")) MediaBrowserCompat.MediaItem.FLAG_BROWSABLE else MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
      )
    }
  }

  private class Js(private val ctx: Context) {
    @JavascriptInterface
    fun update(json: String) {
      val s = try { JSONObject(json) } catch (e: Exception) { return }
      main.post {
        if (!pageReady) {
          pageReady = true
          queued.forEach { send(it) }
          queued.clear()
        }
        apply(ctx, s)
      }
    }

    /** Settings → Notifications: hand an `ntfy://` subscribe link to the ntfy app. False when it isn't installed. */
    @JavascriptInterface
    fun openNtfy(url: String): Boolean {
      if (!url.startsWith("ntfy://")) return false
      return try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (e: Exception) {
        false
      }
    }

    @JavascriptInterface
    fun browseResult(request: String, json: String) {
      val items = toItems(json)
      main.post { browsing.remove(request)?.invoke(items) }
    }
  }

  private fun apply(ctx: Context, s: JSONObject) {
    val sess = session ?: return
    val hasTrack = s.optBoolean("hasTrack", false)
    val playing = s.optBoolean("playing", false)
    val live = s.optBoolean("live", false)

    val wasAwake = policy.keepWebViewAwake
    policy.onPlayerState(hasTrack, playing, SystemClock.elapsedRealtime())
    if (wasAwake != policy.keepWebViewAwake) onKeepAwakeChanged?.invoke(policy.keepWebViewAwake)
    setNoisyReceiver(ctx, playing)

    if (!hasTrack) {
      NowPlayingWidget.show(ctx, null, false, null)
      sess.setPlaybackState(PlaybackStateCompat.Builder().setActions(BROWSE_ACTIONS).setState(PlaybackStateCompat.STATE_NONE, 0, 0f).build())
      sess.isActive = false
      main.removeCallbacks(graceOver)
      MediaPlaybackService.stop(ctx)
      return
    }

    val trackChanged = s.optString("title") != last.optString("title") || s.optString("artist") != last.optString("artist")
    val url = s.optString("art").takeIf { it.startsWith("http") }
    if (url != artUrl) {
      artUrl = url
      art = null
      if (url != null) loadArt(url) { bmp ->
        if (artUrl == url) {
          art = bmp
          setMetadata(sess, last)
          NowPlayingWidget.show(ctx, last, policy.playing, bmp)
        }
      }
    }
    if (trackChanged || s.optDouble("duration", 0.0) != last.optDouble("duration", 0.0)) setMetadata(sess, s)
    if (trackChanged || playing != last.optBoolean("playing", !playing)) NowPlayingWidget.show(ctx, s, playing, art)

    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
      PlaybackStateCompat.ACTION_STOP or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
      BROWSE_ACTIONS
    if (!live) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    val posMs = if (live) PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN else (s.optDouble("position", 0.0) * 1000).toLong()
    sess.setPlaybackState(
      PlaybackStateCompat.Builder().setActions(actions).setState(state, posMs, if (playing) 1f else 0f).build()
    )
    sess.isActive = true
    last = s
    MediaPlaybackService.update(ctx, playing, policy.active(SystemClock.elapsedRealtime()))
    // paused: let the service leave the foreground once the grace period is over
    main.removeCallbacks(graceOver)
    if (!playing) main.postDelayed(graceOver, PlaybackPolicy.GRACE_MS + 500)
  }

  private val graceOver = Runnable {
    val ctx = appCtx ?: return@Runnable
    if (policy.hasTrack) MediaPlaybackService.update(ctx, policy.playing, policy.active(SystemClock.elapsedRealtime()))
  }

  /** Headphones unplugged / Bluetooth dropped while playing → pause (Android sends AUDIO_BECOMING_NOISY). */
  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
      if (i.action == android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY && policy.shouldPauseOnNoisy()) send("pause")
    }
  }

  private fun setNoisyReceiver(ctx: Context, on: Boolean) {
    if (on == noisyRegistered) return
    noisyRegistered = on
    if (on) {
      ContextCompat.registerReceiver(
        ctx, noisy, IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED
      )
    } else {
      try { ctx.unregisterReceiver(noisy) } catch (e: IllegalArgumentException) { }
    }
  }

  private fun setMetadata(sess: MediaSessionCompat, s: JSONObject) {
    val b = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.optString("title"))
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.optString("artist"))
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.optString("album"))
      .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, s.optString("title"))
      .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, s.optString("artist"))
    val dur = s.optDouble("duration", 0.0)
    if (dur > 0 && !s.optBoolean("live")) b.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (dur * 1000).toLong())
    art?.let {
      b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
      b.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, it)
    }
    sess.setMetadata(b.build())
  }

  private fun loadArt(url: String, done: (Bitmap?) -> Unit) {
    io.execute {
      val bmp = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 5000
        c.readTimeout = 8000
        c.inputStream.use { BitmapFactory.decodeStream(it) }?.let { Bitmap.createScaledBitmap(it, 512, 512 * it.height / maxOf(1, it.width), true) }
      } catch (e: Exception) { null }
      main.post { done(bmp) }
    }
  }

  /** Routes MEDIA_BUTTON intents (from the notification / system) into the session. */
  fun handleMediaButton(intent: Intent?) {
    val s = session ?: return
    androidx.media.session.MediaButtonReceiver.handleIntent(s, intent)
  }

  /** What Android Auto and the Assistant may ask for, whether or not something is playing. */
  private const val BROWSE_ACTIONS = PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID or PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH

  fun startService(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, MediaPlaybackService::class.java))
}
