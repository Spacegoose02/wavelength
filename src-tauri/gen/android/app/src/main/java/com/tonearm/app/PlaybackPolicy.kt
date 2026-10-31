package com.tonearm.app

/**
 * The rules behind background playback, kept free of Android classes so they can be unit tested
 * (app/src/test). MediaBridge feeds it the web player's state and carries out what it decides.
 *
 * - While a track is loaded the WebView is kept "awake": Android tells it the window is hidden and
 *   the activity paused when the screen locks, and the WebView then suspends the page's <audio>.
 *   MainActivity undoes both while [keepWebViewAwake] is true.
 * - The foreground service and the CPU / Wi-Fi locks are held while playing and for [GRACE_MS]
 *   after a pause. The player reports a pause between every two tracks; dropping the foreground
 *   service there means restarting it from the background, which Android 12+ refuses.
 */
class PlaybackPolicy {
  companion object {
    const val GRACE_MS = 60_000L
  }

  var hasTrack = false
    private set
  var playing = false
    private set
  private var pausedAt = Long.MIN_VALUE / 2

  val keepWebViewAwake get() = hasTrack

  fun onPlayerState(hasTrack: Boolean, playing: Boolean, now: Long) {
    if (this.playing && !playing) pausedAt = now
    this.hasTrack = hasTrack
    this.playing = playing
  }

  /** Keep the foreground service, wake lock and Wi-Fi lock. */
  fun active(now: Long) = hasTrack && (playing || now - pausedAt < GRACE_MS)

  /** Headphones unplugged / Bluetooth dropped: pause rather than blast the phone speaker. */
  fun shouldPauseOnNoisy() = playing
}
