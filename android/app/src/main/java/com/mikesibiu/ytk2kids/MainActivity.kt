package com.mikesibiu.ytk2kids

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.speech.RecognizerIntent
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.mikesibiu.ytk2kids.databinding.ActivityMainBinding
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: VideoAdapter

    private val searchApi = SearchApi()
    private val io = Executors.newSingleThreadExecutor()

    private val voiceSearch = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val spoken = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (spoken.isNotBlank()) {
                binding.searchInput.setText(spoken)
                searchVideos(spoken)
            }
        }
    }

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
        binding.micButton.setOnClickListener { startVoiceSearch() }
        binding.searchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                submitSearch()
                true
            } else {
                false
            }
        }

        updateStatus("Ready")
        loadFavorites()
    }

    // Favorites come from the server so every device shows the same list; a failure just hides them.
    private fun loadFavorites() {
        io.execute {
            val favorites = try {
                searchApi.favorites()
            } catch (e: Exception) {
                emptyList()
            }
            runOnUiThread { showFavorites(favorites) }
        }
    }

    private fun showFavorites(favorites: List<Favorite>) {
        binding.favoritesRow.removeAllViews()
        binding.favoritesScroll.visibility = if (favorites.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE
        val density = resources.displayMetrics.density
        for (favorite in favorites) {
            val button = Button(this).apply {
                text = favorite.label
                textSize = 17f
                isAllCaps = false
                setTextColor(getColor(R.color.ytk2_text))
                backgroundTintList = android.content.res.ColorStateList.valueOf(getColor(R.color.ytk2_surface))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, (56 * density).toInt()
                ).apply { marginEnd = (8 * density).toInt() }
                setOnClickListener { openFavorite(favorite) }
            }
            binding.favoritesRow.addView(button)
        }
    }

    private fun openFavorite(favorite: Favorite) {
        binding.searchInput.setText("")
        updateStatus("Loading ${favorite.label}...")
        io.execute {
            try {
                val result = searchApi.favoriteVideos(favorite.id)
                runOnUiThread {
                    adapter.submitList(result.items)
                    updateStatus("${favorite.label}: ${result.items.size} safe videos (${result.filteredCount} filtered)")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    adapter.submitList(emptyList())
                    updateStatus("Could not load ${favorite.label}. Try again later.")
                }
            }
        }
    }

    private fun startVoiceSearch() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_prompt))
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            voiceSearch.launch(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Voice search is not available on this device", Toast.LENGTH_SHORT).show()
        }
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
