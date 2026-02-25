package com.mikesibiu.ytk2kids

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterLogicTest {

    @Test
    fun blocks_when_channel_is_in_blocklist() {
        val rules = FilterRules(
            blockedKeywords = emptyList(),
            blockedChannels = setOf("abc123"),
            allowedChannels = emptySet(),
            config = FilterConfig(whitelistMode = false, searchIn = "title")
        )

        val video = VideoItem("v1", "Kids animals", "abc123", "Blocked Channel")
        assertFalse(FilterLogic.isAllowed(video, rules))
    }

    @Test
    fun blocks_case_insensitive_keyword_match() {
        val rules = FilterRules(
            blockedKeywords = listOf(BlockedKeyword("scary", caseSensitive = false)),
            blockedChannels = emptySet(),
            allowedChannels = emptySet(),
            config = FilterConfig(whitelistMode = false, searchIn = "title")
        )

        val video = VideoItem("v2", "ScArY bedtime stories", "chan1", "Any")
        assertFalse(FilterLogic.isAllowed(video, rules))
    }

    @Test
    fun allows_when_no_block_rules_match() {
        val rules = FilterRules(
            blockedKeywords = listOf(BlockedKeyword("monster", caseSensitive = false)),
            blockedChannels = setOf("blocked1"),
            allowedChannels = setOf("allowed1"),
            config = FilterConfig(whitelistMode = true, searchIn = "title")
        )

        val video = VideoItem("v3", "Learning numbers", "chan2", "Good Channel")
        assertTrue(FilterLogic.isAllowed(video, rules))
    }

    @Test
    fun ignores_whitelist_mode_for_now() {
        val rules = FilterRules(
            blockedKeywords = emptyList(),
            blockedChannels = emptySet(),
            allowedChannels = setOf("some-other-channel"),
            config = FilterConfig(whitelistMode = true, searchIn = "title")
        )

        val video = VideoItem("v4", "Kids music", "not-in-allowlist", "Any")
        assertTrue(FilterLogic.isAllowed(video, rules))
    }
}
