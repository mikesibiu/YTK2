package com.mikesibiu.ytk2kids

data class VideoItem(
    val videoId: String,
    val title: String,
    val channelId: String,
    val channelName: String
)

data class SearchResult(
    val items: List<VideoItem>,
    val filteredCount: Int
)
