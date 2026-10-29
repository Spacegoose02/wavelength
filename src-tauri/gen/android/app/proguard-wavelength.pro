# The media bridge is called from JavaScript (window.WavelengthNative.update) — R8 can't see that.
-keepclassmembers class com.tonearm.app.MediaBridge$Js {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.tonearm.app.MediaBridge$Js
-keep class com.tonearm.app.MediaPlaybackService

# Same for the update bridge (window.WavelengthUpdater.*)
-keepclassmembers class com.tonearm.app.UpdateBridge$Js {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.tonearm.app.UpdateBridge$Js
