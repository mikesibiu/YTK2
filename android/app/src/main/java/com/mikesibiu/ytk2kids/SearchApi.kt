package com.mikesibiu.ytk2kids

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/**
 * Searches through the YTK2 backend. All filtering happens server-side, and the
 * server refuses to answer when it cannot load its rules, so a failure here
 * means "no results", never "unfiltered results".
 */
class SearchApi(private val client: OkHttpClient = OkHttpClient()) {

    @Throws(IOException::class)
    fun search(query: String): SearchResult {
        val url = "${BuildConfig.FILTER_API_BASE_URL.trimEnd('/')}/api/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", query)
            .build()

        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Search failed: HTTP ${response.code}")
            }
            return parse(JSONObject(response.body?.string().orEmpty()))
        }
    }

    @Throws(IOException::class)
    fun favorites(): List<Favorite> {
        val url = "${BuildConfig.FILTER_API_BASE_URL.trimEnd('/')}/api/favorites".toHttpUrl()
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Favorites failed: HTTP ${response.code}")
            }
            return parseFavorites(JSONObject(response.body?.string().orEmpty()))
        }
    }

    @Throws(IOException::class)
    fun favoriteVideos(id: Int): SearchResult {
        val url = "${BuildConfig.FILTER_API_BASE_URL.trimEnd('/')}/api/favorites/$id/videos".toHttpUrl()
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Favorite failed: HTTP ${response.code}")
            }
            return parse(JSONObject(response.body?.string().orEmpty()))
        }
    }

    internal fun parseFavorites(json: JSONObject): List<Favorite> {
        val array = json.optJSONArray("items") ?: return emptyList()
        val favorites = mutableListOf<Favorite>()
        for (i in 0 until array.length()) {
            val item = array.getJSONObject(i)
            val label = item.optString("label", "")
            if (label.isBlank() || !item.has("id")) continue
            favorites.add(
                Favorite(
                    item.getInt("id"),
                    item.optString("kind", ""),
                    label,
                    item.optString("icon", "").takeIf { it.startsWith("https://") }
                )
            )
        }
        return favorites
    }

    internal fun parse(json: JSONObject): SearchResult {
        val array = json.optJSONArray("items")
        val items = mutableListOf<VideoItem>()
        if (array != null) {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                val videoId = item.optString("video_id", "")
                if (videoId.isBlank()) continue
                items.add(
                    VideoItem(
                        videoId = videoId,
                        title = item.optString("title", ""),
                        channelId = item.optString("channel_id", ""),
                        channelName = item.optString("channel_name", "Unknown channel")
                    )
                )
            }
        }
        return SearchResult(items, json.optInt("filtered_count", 0))
    }
}
