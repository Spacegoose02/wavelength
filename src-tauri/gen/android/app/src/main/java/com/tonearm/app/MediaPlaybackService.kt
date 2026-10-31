package com.tonearm.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.session.MediaButtonReceiver

/**
 * Foreground "media playback" service: keeps the app (and its WebView audio) alive with the
 * screen off and shows the standard media notification. Android treats an app with this +
 * an active MediaSession as THE media app, so steering-wheel / Bluetooth buttons reach it.
 *
 * While in the foreground it also holds a partial wake lock and a Wi-Fi lock, so streaming
 * (and loading the next track) carries on with the screen off instead of stalling when the
 * CPU or Wi-Fi radio naps. MediaBridge keeps it in the foreground for a short grace period
 * after a pause (PlaybackPolicy), because the player pauses between every two tracks.
 */
class MediaPlaybackService : Service() {
  companion object {
    private const val CHANNEL = "wavelength_playback"
    private const val NOTIF_ID = 4202
    private const val TAG = "WavelengthPlayback"
    private var playing = false
    private var foreground = false
    private var running = false

    /** [inForeground]: keep the service (and the locks) in the foreground; false once paused for a while. */
    fun update(ctx: Context, isPlaying: Boolean, inForeground: Boolean) {
      playing = isPlaying
      foreground = inForeground
      try {
        if (!running && inForeground) {
          ContextCompat.startForegroundService(ctx, Intent(ctx, MediaPlaybackService::class.java))
        } else if (running) {
          ctx.startService(Intent(ctx, MediaPlaybackService::class.java))
        }
      } catch (e: Exception) {
        // Android 12+ refuses to (re)start a service from the background in some cases; don't crash the player
        Log.w(TAG, "couldn't update the playback service", e)
      }
    }

    fun stop(ctx: Context) {
      if (running) ctx.stopService(Intent(ctx, MediaPlaybackService::class.java))
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    running = true
    // a media button (notification, lock screen, headset) counts as "now playing" until the page reports back
    if (intent?.action == Intent.ACTION_MEDIA_BUTTON) {
      foreground = true
      MediaBridge.handleMediaButton(intent)
    }
    val n = buildNotification()
    if (foreground) {
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
          startForeground(NOTIF_ID, n)
        }
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (Android 12+, started from the background)
        Log.w(TAG, "couldn't enter the foreground", e)
        foreground = false
      }
    }
    if (!foreground) {
      // paused for a while: drop the "foreground" status but keep the notification so it can resume
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, n)
    }
    holdLocks(foreground)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    holdLocks(false)
    super.onDestroy()
  }

  @Suppress("DEPRECATION", "WakelockTimeout")
  private fun holdLocks(on: Boolean) {
    if (on) {
      if (wakeLock == null) {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Wavelength:playback").apply {
          setReferenceCounted(false)
          acquire()
        }
      }
      if (wifiLock == null) {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        // HIGH_PERF is deprecated on Android 14 but still what keeps the radio awake with the screen off;
        // LOW_LATENCY only applies while the app is in front with the screen on
        wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Wavelength:playback")?.apply {
          setReferenceCounted(false)
          acquire()
        }
      }
    } else {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
      wifiLock?.let { if (it.isHeld) it.release() }
      wifiLock = null
    }
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
