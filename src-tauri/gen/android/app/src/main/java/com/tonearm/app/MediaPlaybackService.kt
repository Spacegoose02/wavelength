package com.tonearm.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver

/**
 * Foreground "media playback" service: keeps the app (and its WebView audio) alive with the
 * screen off and shows the standard media notification. Android treats an app with this +
 * an active MediaSession as THE media app, so steering-wheel / Bluetooth buttons reach it.
 */
class MediaPlaybackService : Service() {
  companion object {
    private const val CHANNEL = "wavelength_playback"
    private const val NOTIF_ID = 4202
    private var playing = false
    private var running = false

    fun update(ctx: Context, isPlaying: Boolean) {
      playing = isPlaying
      if (!running && isPlaying) {
        ContextCompat.startForegroundService(ctx, Intent(ctx, MediaPlaybackService::class.java))
      } else if (running) {
        ctx.startService(Intent(ctx, MediaPlaybackService::class.java))
      }
    }

    fun stop(ctx: Context) {
      if (running) ctx.stopService(Intent(ctx, MediaPlaybackService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    running = true
    if (intent?.action == Intent.ACTION_MEDIA_BUTTON) MediaBridge.handleMediaButton(intent)
    val n = buildNotification()
    if (Build.VERSION.SDK_INT >= 29) {
      ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, n)
    }
    // paused for a while: drop the "foreground" status but keep the notification so it can resume
    if (!playing) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun buildNotification(): android.app.Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW))
    }
    val session = MediaBridge.session()
    val meta = session?.controller?.metadata
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    fun action(icon: Int, title: String, act: Long) =
      NotificationCompat.Action(icon, title, MediaButtonReceiver.buildMediaButtonPendingIntent(this, act))

    val b = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(meta?.description?.title ?: "Wavelength")
      .setContentText(meta?.description?.subtitle)
      .setLargeIcon(meta?.description?.iconBitmap)
      .setContentIntent(open)
      .setOngoing(playing)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
      .addAction(action(android.R.drawable.ic_media_previous, "Previous", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
      .addAction(
        if (playing) action(android.R.drawable.ic_media_pause, "Pause", PlaybackStateCompat.ACTION_PAUSE)
        else action(android.R.drawable.ic_media_play, "Play", PlaybackStateCompat.ACTION_PLAY)
      )
      .addAction(action(android.R.drawable.ic_media_next, "Next", PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
    val style = androidx.media.app.NotificationCompat.MediaStyle().setShowActionsInCompactView(0, 1, 2)
    session?.sessionToken?.let { style.setMediaSession(it) }
    b.setStyle(style)
    return b.build()
  }
}
