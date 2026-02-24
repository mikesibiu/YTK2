package com.mikesibiu.ytk2kids

data class BlockedKeyword(
    val keyword: String,
    val caseSensitive: Boolean
)

data class ChannelRule(
    val channelId: String,
    val channelName: String?
)

data class FilterConfig(
    val whitelistMode: Boolean,
    val searchIn: String
)

data class FilterRules(
    val blockedKeywords: List<BlockedKeyword>,
    val blockedChannels: Set<String>,
    val allowedChannels: Set<String>,
    val config: FilterConfig
)

data class VideoItem(
    val videoId: String,
    val title: String,
    val channelId: String,
    val channelName: String
)
