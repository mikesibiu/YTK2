package com.mikesibiu.ytk2kids

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.mikesibiu.ytk2kids.databinding.ActivityMainBinding
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: VideoAdapter

    private val searchApi = SearchApi()
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = VideoAdapter { item ->
            val intent = Intent(this, PlayerActivity::class.java)
            intent.putExtra(PlayerActivity.EXTRA_VIDEO_ID, item.videoId)
            startActivity(intent)
        }

        binding.resultsRecycler.layoutManager = LinearLayoutManager(this)
        binding.resultsRecycler.adapter = adapter

        binding.searchButton.setOnClickListener { submitSearch() }
        binding.searchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                submitSearch()
                true
            } else {
                false
            }
        }

        updateStatus("Ready")
    }

    private fun submitSearch() {
        val query = binding.searchInput.text?.toString()?.trim().orEmpty()
        if (query.isBlank()) {
            Toast.makeText(this, "Enter a search term", Toast.LENGTH_SHORT).show()
            return
        }
        searchVideos(query)
    }

    private fun searchVideos(query: String) {
        updateStatus("Searching...")

        io.execute {
            try {
                val result = searchApi.search(query)
                runOnUiThread {
                    adapter.submitList(result.items)
                    updateStatus("Showing ${result.items.size} safe results (${result.filteredCount} filtered)")
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
        binding.statusText.text = message
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
