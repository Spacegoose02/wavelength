package com.tonearm.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackPolicyTest {
  private val grace = PlaybackPolicy.GRACE_MS

  @Test fun idleAppStaysAsleep() {
    val p = PlaybackPolicy()
    assertFalse(p.keepWebViewAwake)
    assertFalse(p.active(1_000))
  }

  @Test fun restoredQueueKeepsWebViewAwakeButNotTheService() {
    val p = PlaybackPolicy()
    p.onPlayerState(hasTrack = true, playing = false, now = 1_000)
    assertTrue(p.keepWebViewAwake)
    assertFalse(p.active(1_000))
  }

  @Test fun playingHoldsEverything() {
    val p = PlaybackPolicy()
    p.onPlayerState(hasTrack = true, playing = true, now = 1_000)
    assertTrue(p.keepWebViewAwake)
    assertTrue(p.active(1_000 + 10 * grace))
  }

  @Test fun pauseBetweenTracksKeepsTheServiceInTheForeground() {
    val p = PlaybackPolicy()
    p.onPlayerState(true, true, 1_000)
    p.onPlayerState(true, false, 5_000) // <audio> pauses while the next track loads
    assertTrue(p.active(5_200))
    p.onPlayerState(true, true, 5_400)
    assertTrue(p.active(5_400 + 10 * grace))
  }

  @Test fun longPauseLetsTheServiceGo() {
    val p = PlaybackPolicy()
    p.onPlayerState(true, true, 1_000)
    p.onPlayerState(true, false, 5_000)
    assertTrue(p.active(5_000 + grace - 1))
    assertFalse(p.active(5_000 + grace))
    assertTrue(p.keepWebViewAwake) // so the lock-screen play button still works
  }

  @Test fun repeatedPauseReportsDontExtendTheGrace() {
    val p = PlaybackPolicy()
    p.onPlayerState(true, true, 1_000)
    p.onPlayerState(true, false, 5_000)
    p.onPlayerState(true, false, 5_000 + grace - 10) // position / metadata push while paused
    assertFalse(p.active(5_000 + grace))
  }

  @Test fun clearingTheQueueReleasesEverything() {
    val p = PlaybackPolicy()
    p.onPlayerState(true, true, 1_000)
    p.onPlayerState(false, false, 2_000)
    assertFalse(p.keepWebViewAwake)
    assertFalse(p.active(2_000))
  }

  @Test fun noisyPausesOnlyWhilePlaying() {
    val p = PlaybackPolicy()
    p.onPlayerState(true, true, 1_000)
    assertTrue(p.shouldPauseOnNoisy())
    p.onPlayerState(true, false, 2_000)
    assertFalse(p.shouldPauseOnNoisy())
  }
}
