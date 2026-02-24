package com.ytk2.app

import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import androidx.appcompat.app.AppCompatActivity
import com.ytk2.app.databinding.ActivityPlayerBinding

class PlayerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPlayerBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val videoId = intent.getStringExtra(EXTRA_VIDEO_ID) ?: return

        binding.playerWebView.settings.javaScriptEnabled = true
        binding.playerWebView.settings.domStorageEnabled = true
        binding.playerWebView.settings.mediaPlaybackRequiresUserGesture = false
        binding.playerWebView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        binding.playerWebView.webChromeClient = WebChromeClient()

        val url = "https://www.youtube-nocookie.com/embed/$videoId?autoplay=1&rel=0"
        binding.playerWebView.loadUrl(url)
    }

    override fun onDestroy() {
        binding.playerWebView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_VIDEO_ID = "video_id"
    }
}
