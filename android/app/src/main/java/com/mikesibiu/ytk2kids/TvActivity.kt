package com.mikesibiu.ytk2kids

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.mikesibiu.ytk2kids.databinding.ActivityTvBinding
import java.util.concurrent.Executors

class TvActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTvBinding
    private lateinit var adapter: VideoAdapter

    private val searchApi = SearchApi()
    private val io = Executors.newSingleThreadExecutor()

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
        binding.btnScience.setOnClickListener { searchVideos("kids science") }
        binding.btnSearch.setOnClickListener { submitTypedSearch() }
        binding.tvSearchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                submitTypedSearch()
                true
            } else {
                false
            }
        }

        updateStatus("Pick a topic or type a search")
        binding.btnAnimals.requestFocus()
    }

    private fun submitTypedSearch() {
        val query = binding.tvSearchInput.text?.toString()?.trim().orEmpty()
        if (query.isNotBlank()) searchVideos(query)
    }

    private fun searchVideos(query: String) {
        updateStatus("Searching $query...")

        io.execute {
            try {
                val result = searchApi.search(query)
                runOnUiThread {
                    adapter.submitList(result.items)
                    updateStatus("Showing ${result.items.size} safe videos")
                    binding.tvResultsRecycler.post {
                        binding.tvResultsRecycler.getChildAt(0)?.requestFocus()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    adapter.submitList(emptyList())
                    updateStatus("Search unavailable. Try again later.")
                }
            }
        }
    }

    private fun updateStatus(message: String) {
        binding.tvStatusText.text = message
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
