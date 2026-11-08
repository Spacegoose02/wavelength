package com.tonearm.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Wake-up alarm (src/lib/alarm.ts). The page hands over the next time it should go off; this sets an
 * "alarm clock" alarm, which Android delivers on time even in Doze, shows as an alarm icon in the status bar,
 * and may open the app from the background. When it goes off, MainActivity opens (over the lock screen) and
 * tells the page "alarm" through MediaBridge; the page decides what to play.
 *
 * The time is kept in SharedPreferences so [AlarmBootReceiver] can set it again after the phone restarts
 * (Android forgets alarms on reboot).
 */
object AlarmBridge {
  const val EXTRA = "com.tonearm.app.ALARM"
  private const val PREFS = "wavelength.alarm"
  private const val REQUEST = 7301

  private fun open(ctx: Context): PendingIntent =
    PendingIntent.getActivity(
      ctx, REQUEST,
      Intent(ctx, MainActivity::class.java).putExtra(EXTRA, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /** Tapping the status bar alarm icon's details: just open the app. */
  private fun show(ctx: Context): PendingIntent =
    PendingIntent.getActivity(ctx, REQUEST + 1, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  /** Returns false when Android only allows an inexact alarm (it may then go off a few minutes late). */
  fun set(ctx: Context, at: Long, label: String): Boolean {
    val app = ctx.applicationContext
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("at", at).putString("label", label).apply()
    val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val op = open(app)
    return try {
      if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op)
        false
      } else {
        am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show(app)), op)
        true
      }
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op)
      false
    }
  }

  fun cancel(ctx: Context) {
    val app = ctx.applicationContext
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    (app.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(open(app))
  }

  /** After a reboot: set the saved alarm again if it's still ahead. */
  fun restore(ctx: Context) {
    val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val at = prefs.getLong("at", 0L)
    if (at > System.currentTimeMillis()) set(ctx, at, prefs.getString("label", "Wavelength") ?: "Wavelength")
  }
}

/** Android forgets alarms when the phone restarts; set the wake-up alarm again. */
class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.LOCKED_BOOT_COMPLETED") AlarmBridge.restore(context)
  }
}
