package com.tonearm.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Cover art for Android Auto. The car only loads artwork from content:// links, so browse rows point here
 * (`content://com.tonearm.app.art/<n>`) and this fetches the picture the page gave for row n into the cache.
 * Only addresses the page listed can be fetched (ArtTokens), and only over http(s).
 */
class ArtProvider : ContentProvider() {
  companion object {
    private const val AUTHORITY = "com.tonearm.app.art"
    private const val MAX_BYTES = 4 * 1024 * 1024
    private val tokens = ArtTokens()

    fun uriFor(url: String): Uri = Uri.parse("content://$AUTHORITY/${tokens.tokenFor(url)}")
  }

  override fun onCreate() = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    if (mode != "r") return null
    val url = uri.lastPathSegment?.toLongOrNull()?.let { tokens.urlFor(it) } ?: return null
    if (!url.startsWith("https://") && !url.startsWith("http://")) return null
    val dir = File(context!!.cacheDir, "car-art").apply { mkdirs() }
    val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    val file = File(dir, name)
    if (!file.exists() && !fetch(url, file)) return null
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun fetch(url: String, to: File): Boolean = try {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 5000
    c.readTimeout = 8000
    c.instanceFollowRedirects = false
    val tmp = File(to.path + ".part")
    c.inputStream.use { input ->
      tmp.outputStream().use { out ->
        val buf = ByteArray(16 * 1024)
        var total = 0
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          total += n
          if (total > MAX_BYTES) throw IllegalStateException("too big")
          out.write(buf, 0, n)
        }
      }
    }
    c.responseCode in 200..299 && tmp.renameTo(to)
  } catch (e: Exception) {
    false
  }

  override fun getType(uri: Uri) = "image/*"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
