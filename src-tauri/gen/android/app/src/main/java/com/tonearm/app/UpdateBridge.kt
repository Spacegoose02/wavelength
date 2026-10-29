package com.tonearm.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File

/**
 * In-app updates: Rust (update.rs) downloads the new APK into the cache folder; this hands it to
 * Android's package installer. The user still confirms the install, and Android only accepts it
 * if it's signed with the same key as the installed app.
 *
 * JS: window.WavelengthUpdater.canInstall() / allowInstalls() / install(path)
 */
object UpdateBridge {
  fun attach(context: Context, view: WebView) {
    view.addJavascriptInterface(Js(context.applicationContext), "WavelengthUpdater")
  }

  class Js(private val ctx: Context) {
    /** Android 8+ asks per app before it may install APKs ("Install unknown apps"). */
    @JavascriptInterface
    fun canInstall(): Boolean =
      Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    /** Open the "Install unknown apps" switch for Wavelength. */
    @JavascriptInterface
    fun allowInstalls() {
      if (Build.VERSION.SDK_INT < 26) return
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try { ctx.startActivity(intent) } catch (e: Exception) {
        // some TVs have no such screen: fall back to the app's info page
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    /** Show the system install prompt for a downloaded APK. Returns "" or an error message. */
    @JavascriptInterface
    fun install(path: String): String {
      return try {
        val file = File(path).canonicalFile
        val updates = File(ctx.cacheDir, "updates").canonicalFile
        if (file.parentFile != updates || !file.name.endsWith(".apk") || !file.exists()) return "not a downloaded update"
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        ""
      } catch (e: Exception) {
        e.message ?: "couldn't open the installer"
      }
    }
  }
}
