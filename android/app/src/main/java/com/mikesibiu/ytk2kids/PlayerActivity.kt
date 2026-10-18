package com.mikesibiu.ytk2kids

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.mikesibiu.ytk2kids.databinding.ActivityPlayerBinding

class PlayerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPlayerBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val videoId = intent.getStringExtra(EXTRA_VIDEO_ID)
        if (videoId.isNullOrBlank() || !VIDEO_ID_PATTERN.matches(videoId)) {
            finish()
            return
        }

        with(binding.playerWebView) {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            webChromeClient = WebChromeClient()
            webViewClient = LockedWebViewClient(videoId)
            loadUrl(embedUrl(videoId))
        }
    }

    // The child must not be able to leave the embed (title links, end screens,
    // "watch on YouTube"), because everything outside it is unfiltered.
    private class LockedWebViewClient(private val videoId: String) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val isOurEmbed = url.scheme == "https" &&
                url.host == EMBED_HOST &&
                url.path == "/embed/$videoId"
            return !isOurEmbed
        }
    }

    // Stop playback (and audio) when the screen locks or the app is backgrounded.
    override fun onPause() {
        binding.playerWebView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.playerWebView.onResume()
    }

    override fun onDestroy() {
        binding.playerWebView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_VIDEO_ID = "video_id"
        private const val EMBED_HOST = "www.youtube-nocookie.com"
        private val VIDEO_ID_PATTERN = Regex("^[A-Za-z0-9_-]{6,20}$")

        private fun embedUrl(videoId: String) =
            "https://$EMBED_HOST/embed/$videoId?autoplay=1&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&fs=0&disablekb=0"
    }
}
