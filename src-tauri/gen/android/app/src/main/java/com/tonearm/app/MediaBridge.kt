package com.tonearm.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
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
 */
object MediaBridge {
  private var session: MediaSessionCompat? = null
  private var webView: WebView? = null
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var artUrl: String? = null
  private var art: Bitmap? = null
  private var last = JSONObject()

  fun session(): MediaSessionCompat? = session

  fun attach(context: Context, view: WebView) {
    webView = view
    if (session == null) {
      session = MediaSessionCompat(context.applicationContext, "Wavelength").apply {
        setCallback(object : MediaSessionCompat.Callback() {
          override fun onPlay() = send("play")
          override fun onPause() = send("pause")
          override fun onStop() = send("pause")
          override fun onSkipToNext() = send("next")
          override fun onSkipToPrevious() = send("prev")
          override fun onSeekTo(pos: Long) = send("seek:" + (pos / 1000.0))
        })
      }
    }
    view.addJavascriptInterface(Js(context.applicationContext), "WavelengthNative")
  }

  /** Deliver a media-button command to the web player. */
  fun send(cmd: String) {
    main.post {
      webView?.evaluateJavascript("window.__wlMedia && window.__wlMedia(${JSONObject.quote(cmd)})", null)
    }
  }

  private class Js(private val ctx: Context) {
    @JavascriptInterface
    fun update(json: String) {
      val s = try { JSONObject(json) } catch (e: Exception) { return }
      main.post { apply(ctx, s) }
    }
  }

  private fun apply(ctx: Context, s: JSONObject) {
    val sess = session ?: return
    val hasTrack = s.optBoolean("hasTrack", false)
    val playing = s.optBoolean("playing", false)
    val live = s.optBoolean("live", false)

    if (!hasTrack) {
      sess.setPlaybackState(PlaybackStateCompat.Builder().setState(PlaybackStateCompat.STATE_NONE, 0, 0f).build())
      sess.isActive = false
      MediaPlaybackService.stop(ctx)
      return
    }

    val trackChanged = s.optString("title") != last.optString("title") || s.optString("artist") != last.optString("artist")
    val url = s.optString("art").takeIf { it.startsWith("http") }
    if (url != artUrl) {
      artUrl = url
      art = null
      if (url != null) loadArt(url) { bmp -> if (artUrl == url) { art = bmp; setMetadata(sess, last) } }
    }
    if (trackChanged || s.optDouble("duration", 0.0) != last.optDouble("duration", 0.0)) setMetadata(sess, s)

    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
      PlaybackStateCompat.ACTION_STOP or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    if (!live) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    val posMs = if (live) PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN else (s.optDouble("position", 0.0) * 1000).toLong()
    sess.setPlaybackState(
      PlaybackStateCompat.Builder().setActions(actions).setState(state, posMs, if (playing) 1f else 0f).build()
    )
    sess.isActive = true
    last = s
    MediaPlaybackService.update(ctx, playing)
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

  fun startService(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, MediaPlaybackService::class.java))
}
