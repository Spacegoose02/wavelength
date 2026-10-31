package com.tonearm.app

/**
 * Who may browse Wavelength's library through [MediaPlaybackService] (it has to be exported for Android
 * Auto to find it): the system and the apps that show media to a person, not any app on the phone.
 * Others get an empty root, so they can still send play / pause to the session.
 */
object CarAccess {
  private val trusted = setOf(
    "com.google.android.projection.gearhead", // Android Auto
    "com.google.android.autosimulator", // Desktop Head Unit, for testing
    "com.google.android.wearable.app", // Wear OS
    "com.google.android.googlequicksearchbox", // Assistant: "play … on Wavelength"
    "com.google.android.carassistant",
    "com.android.systemui", // the media picker in quick settings
    "com.android.car.media", // Android Automotive
  )

  fun mayBrowse(packageName: String, uid: Int, myUid: Int, systemUid: Int = 1000): Boolean =
    uid == myUid || uid == systemUid || packageName in trusted
}

/**
 * Cover art for the car, by number: [MediaPlaybackService] hands Android Auto `content://…/art/<n>` links
 * and [ArtProvider] fetches only the addresses registered here, so the provider can't be used to make the
 * phone fetch other URLs. Keeps the most recent [max].
 */
class ArtTokens(private val max: Int = 500) {
  private val byToken = object : LinkedHashMap<Long, String>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, String>?) = size > max
  }
  private val byUrl = HashMap<String, Long>()
  private var next = 1L

  @Synchronized fun tokenFor(url: String): Long {
    byUrl[url]?.let { t -> if (byToken[t] == url) return t }
    val t = next++
    byToken[t] = url
    byUrl[url] = t
    if (byUrl.size > max * 2) byUrl.entries.retainAll { byToken[it.value] == it.key }
    return t
  }

  @Synchronized fun urlFor(token: Long): String? = byToken[token]
}
