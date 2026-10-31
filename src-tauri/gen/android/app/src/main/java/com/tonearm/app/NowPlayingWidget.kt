package com.tonearm.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.support.v4.media.session.PlaybackStateCompat
import android.widget.RemoteViews
import androidx.media.session.MediaButtonReceiver
import org.json.JSONObject

/**
 * Home-screen widget: what's playing, with previous / play-pause / next. MediaBridge calls [show] whenever
 * the song, its cover or play/pause changes; the buttons are media-button presses, like the notification's.
 * With nothing loaded (or after Android stopped the app) it says so, and tapping it opens Wavelength.
 */
class NowPlayingWidget : AppWidgetProvider() {
  companion object {
    private var title: String? = null
    private var artist: String? = null
    private var playing = false
    private var art: Bitmap? = null

    /** [state] is the page's player state (null: nothing loaded). */
    fun show(ctx: Context, state: JSONObject?, isPlaying: Boolean, cover: Bitmap?) {
      title = state?.optString("title")?.ifEmpty { null }
      artist = state?.optString("artist")?.ifEmpty { null }
      playing = isPlaying
      // RemoteViews go through a size-limited binder call: keep the cover small
      art = cover?.let { Bitmap.createScaledBitmap(it, 192, 192 * it.height / maxOf(1, it.width), true) }
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = try { mgr.getAppWidgetIds(ComponentName(ctx, NowPlayingWidget::class.java)) } catch (e: Exception) { return }
      if (ids.isNotEmpty()) mgr.updateAppWidget(ids, views(ctx))
    }

    private fun views(ctx: Context): RemoteViews {
      val v = RemoteViews(ctx.packageName, R.layout.widget_now_playing)
      val open = PendingIntent.getActivity(
        ctx, 1, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      fun button(action: Long) = MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, action)
      val loaded = title != null
      v.setTextViewText(R.id.widget_title, title ?: "Wavelength")
      v.setTextViewText(R.id.widget_artist, artist ?: if (loaded) "" else "Tap to open")
      if (art != null) v.setImageViewBitmap(R.id.widget_art, art) else v.setImageViewResource(R.id.widget_art, R.mipmap.ic_launcher)
      v.setImageViewResource(R.id.widget_play, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
      v.setContentDescription(R.id.widget_play, if (playing) "Pause" else "Play")
      v.setOnClickPendingIntent(R.id.widget_root, open)
      if (loaded) {
        v.setOnClickPendingIntent(R.id.widget_prev, button(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
        v.setOnClickPendingIntent(R.id.widget_play, button(if (playing) PlaybackStateCompat.ACTION_PAUSE else PlaybackStateCompat.ACTION_PLAY))
        v.setOnClickPendingIntent(R.id.widget_next, button(PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
      } else {
        // the page isn't running, so a media button would have nobody to play: open the app instead
        for (id in listOf(R.id.widget_prev, R.id.widget_play, R.id.widget_next)) v.setOnClickPendingIntent(id, open)
      }
      return v
    }
  }

  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    mgr.updateAppWidget(ids, views(ctx))
  }
}
