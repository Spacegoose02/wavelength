package com.tonearm.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarAccessTest {
  @Test fun androidAutoAndTheAppItselfMayBrowse() {
    assertTrue(CarAccess.mayBrowse("com.google.android.projection.gearhead", 10_200, myUid = 10_100))
    assertTrue(CarAccess.mayBrowse("com.tonearm.app", 10_100, myUid = 10_100))
    assertTrue(CarAccess.mayBrowse("android", 1000, myUid = 10_100))
  }

  @Test fun otherAppsMayNot() {
    assertFalse(CarAccess.mayBrowse("com.example.snoop", 10_300, myUid = 10_100))
  }

  @Test fun artTokensOnlyResolveRegisteredUrls() {
    val t = ArtTokens(max = 2)
    val a = t.tokenFor("https://x/a.jpg")
    assertEquals(a, t.tokenFor("https://x/a.jpg"))
    val b = t.tokenFor("https://x/b.jpg")
    assertEquals("https://x/b.jpg", t.urlFor(b))
    assertNull(t.urlFor(999))
    t.tokenFor("https://x/c.jpg") // the oldest one (a) drops out
    assertNull(t.urlFor(a))
    assertEquals(4L, t.tokenFor("https://x/a.jpg"))
  }
}
