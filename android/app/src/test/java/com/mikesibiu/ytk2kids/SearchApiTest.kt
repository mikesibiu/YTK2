package com.mikesibiu.ytk2kids

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchApiTest {

    @Test
    fun parses_items_and_filtered_count() {
        val json = JSONObject(
            """{"filtered_count":3,"items":[
                {"video_id":"abc123XYZ_-","title":"Songs","channel_id":"c1","channel_name":"Kids"},
                {"video_id":"","title":"No id"}
            ]}"""
        )

        val result = SearchApi().parse(json)

        assertEquals(1, result.items.size)
        assertEquals("abc123XYZ_-", result.items[0].videoId)
        assertEquals("Kids", result.items[0].channelName)
        assertEquals(3, result.filteredCount)
    }

    @Test
    fun missing_items_gives_empty_list() {
        val result = SearchApi().parse(JSONObject("{}"))
        assertEquals(0, result.items.size)
    }
}
