package com.mikesibiu.ytk2kids

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.mikesibiu.ytk2kids.databinding.ActivityTvBinding
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors

class TvActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTvBinding
    private lateinit var adapter: VideoAdapter

    private val client = OkHttpClient()
    private val io = Executors.newSingleThreadExecutor()

    private var filterRules = FilterRules(
        blockedKeywords = emptyList(),
        blockedChannels = emptySet(),
        allowedChannels = emptySet(),
        config = FilterConfig(whitelistMode = false, searchIn = "title")
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTvBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = VideoAdapter { item ->
            val intent = Intent(this, PlayerActivity::class.java)
            intent.putExtra(PlayerActivity.EXTRA_VIDEO_ID, item.videoId)
            startActivity(intent)
        }

        binding.tvResultsRecycler.layoutManager = LinearLayoutManager(this)
        binding.tvResultsRecycler.adapter = adapter

        binding.btnAnimals.setOnClickListener { searchVideos("kids animals") }
        binding.btnLearning.setOnClickListener { searchVideos("kids learning") }
        binding.btnMusic.setOnClickListener { searchVideos("kids songs") }
        binding.btnRefresh.setOnClickListener {
            promptForParentPin {
                loadFilters(forceToast = true)
            }
        }

        loadFilters(forceToast = false)
    }

    private fun loadFilters(forceToast: Boolean) {
        updateStatus("Syncing filters...")

        io.execute {
            try {
                val request = Request.Builder()
                    .url("${BuildConfig.FILTER_API_BASE_URL}/api/filters")
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("Filter API failed: HTTP ${response.code}")
                    }
                    val body = response.body?.string().orEmpty()
                    val json = JSONObject(body)
                    filterRules = parseFilterRules(json)
                }

                runOnUiThread {
                    val summary = "Filters ready: ${filterRules.blockedKeywords.size} keywords"
                    updateStatus(summary)
                    if (forceToast) {
                        Toast.makeText(this, "Filters updated", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    updateStatus("Could not load filters")
                    if (forceToast) {
                        Toast.makeText(this, "Filter sync failed", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun searchVideos(query: String) {
        if (BuildConfig.YOUTUBE_API_KEY.isBlank()) {
            Toast.makeText(this, "Missing YOUTUBE_API_KEY", Toast.LENGTH_LONG).show()
            return
        }

        updateStatus("Searching $query...")

        io.execute {
            try {
                val url = "https://www.googleapis.com/youtube/v3/search".toHttpUrl().newBuilder()
                    .addQueryParameter("part", "snippet")
                    .addQueryParameter("type", "video")
                    .addQueryParameter("maxResults", "30")
                    .addQueryParameter("safeSearch", "strict")
                    .addQueryParameter("q", query)
                    .addQueryParameter("key", BuildConfig.YOUTUBE_API_KEY)
                    .build()

                val request = Request.Builder().url(url).build()

                val videos = client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("YouTube API failed: HTTP ${response.code}")
                    }
                    val body = response.body?.string().orEmpty()
                    parseVideoItems(JSONObject(body))
                }

                val allowed = videos.filter { FilterLogic.isAllowed(it, filterRules) }

                runOnUiThread {
                    adapter.submitList(allowed)
                    updateStatus("Showing ${allowed.size} safe videos")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    updateStatus("Search failed")
                    Toast.makeText(this, "Search error", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun parseFilterRules(json: JSONObject): FilterRules {
        val blockedKeywords = mutableListOf<BlockedKeyword>()
        val blockedKeywordArray = json.optJSONArray("blocked_keywords")
        if (blockedKeywordArray != null) {
            for (i in 0 until blockedKeywordArray.length()) {
                val item = blockedKeywordArray.getJSONObject(i)
                blockedKeywords.add(
                    BlockedKeyword(
                        keyword = item.optString("keyword", ""),
                        caseSensitive = item.optBoolean("case_sensitive", false)
                    )
                )
            }
        }

        val blockedChannels = mutableSetOf<String>()
        val blockedChannelArray = json.optJSONArray("blocked_channels")
        if (blockedChannelArray != null) {
            for (i in 0 until blockedChannelArray.length()) {
                val item = blockedChannelArray.getJSONObject(i)
                blockedChannels.add(item.optString("channel_id", ""))
            }
        }

        val allowedChannels = mutableSetOf<String>()
        val allowedChannelArray = json.optJSONArray("allowed_channels")
        if (allowedChannelArray != null) {
            for (i in 0 until allowedChannelArray.length()) {
                val item = allowedChannelArray.getJSONObject(i)
                allowedChannels.add(item.optString("channel_id", ""))
            }
        }

        val configObj = json.optJSONObject("config") ?: JSONObject()

        return FilterRules(
            blockedKeywords = blockedKeywords,
            blockedChannels = blockedChannels,
            allowedChannels = allowedChannels,
            config = FilterConfig(
                whitelistMode = configObj.optBoolean("whitelist_mode", false),
                searchIn = configObj.optString("search_in", "title")
            )
        )
    }

    private fun parseVideoItems(json: JSONObject): List<VideoItem> {
        val out = mutableListOf<VideoItem>()
        val items = json.optJSONArray("items") ?: return out

        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            val idObj = item.optJSONObject("id") ?: continue
            val snippet = item.optJSONObject("snippet") ?: continue

            val videoId = idObj.optString("videoId", "")
            if (videoId.isBlank()) continue

            out.add(
                VideoItem(
                    videoId = videoId,
                    title = snippet.optString("title", ""),
                    channelId = snippet.optString("channelId", ""),
                    channelName = snippet.optString("channelTitle", "Unknown channel")
                )
            )
        }

        return out
    }

    private fun promptForParentPin(onValidPin: () -> Unit) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Parent PIN"
        }

        AlertDialog.Builder(this)
            .setTitle("Parent confirmation")
            .setMessage("Enter PIN to refresh filters")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("OK") { _, _ ->
                val enteredPin = input.text?.toString()?.trim().orEmpty()
                if (enteredPin == BuildConfig.PARENT_PIN) {
                    onValidPin()
                } else {
                    Toast.makeText(this, "Invalid PIN", Toast.LENGTH_SHORT).show()
                }
            }
            .show()
    }

    private fun updateStatus(message: String) {
        binding.tvStatusText.text = message
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
