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
    private var favorites: List<Favorite> = emptyList()
    private var showingResults = false

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

        // Back from a list of videos returns to the favorites instead of leaving the app.
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (showingResults) {
                    showHome()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        updateStatus("Pick a favorite or a topic")
        loadFavorites()
    }

    // Favorites come from the server so every device shows the same list; they are the home screen.
    private fun loadFavorites() {
        io.execute {
            val loaded = try {
                searchApi.favorites()
            } catch (e: Exception) {
                emptyList()
            }
            runOnUiThread {
                favorites = loaded
                if (!showingResults) showHome()
            }
        }
    }

    private fun showHome() {
        showingResults = false
        binding.tvResultsRecycler.adapter = FavoriteAdapter(favorites) { openFavorite(it) }
        updateStatus("Pick a favorite or a topic")
        binding.tvResultsRecycler.post {
            val first = binding.tvResultsRecycler.getChildAt(0)
            if (first != null) first.requestFocus() else binding.btnAnimals.requestFocus()
        }
    }

    private fun showResults(items: List<VideoItem>) {
        showingResults = true
        if (binding.tvResultsRecycler.adapter !== adapter) binding.tvResultsRecycler.adapter = adapter
        adapter.submitList(items)
    }

    private fun openFavorite(favorite: Favorite) {
        updateStatus("Loading ${favorite.label}...")
        io.execute {
            try {
                val result = searchApi.favoriteVideos(favorite.id)
                runOnUiThread {
                    showResults(result.items)
                    updateStatus("${favorite.label}: ${result.items.size} safe videos")
                    binding.tvResultsRecycler.post { binding.tvResultsRecycler.getChildAt(0)?.requestFocus() }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    showResults(emptyList())
                    updateStatus("Could not load ${favorite.label}. Try again later.")
                }
            }
        }
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
                    showResults(result.items)
                    updateStatus("Showing ${result.items.size} safe videos")
                    binding.tvResultsRecycler.post {
                        binding.tvResultsRecycler.getChildAt(0)?.requestFocus()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    showResults(emptyList())
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
