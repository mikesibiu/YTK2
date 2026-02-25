package com.mikesibiu.ytk2kids

object FilterLogic {
    fun isAllowed(video: VideoItem, filterRules: FilterRules): Boolean {
        if (filterRules.blockedChannels.contains(video.channelId)) {
            return false
        }

        // Whitelist is intentionally disabled for now.

        for (rule in filterRules.blockedKeywords) {
            if (rule.keyword.isBlank()) continue
            val blocked = if (rule.caseSensitive) {
                video.title.contains(rule.keyword)
            } else {
                video.title.lowercase().contains(rule.keyword.lowercase())
            }
            if (blocked) {
                return false
            }
        }

        return true
    }
}
