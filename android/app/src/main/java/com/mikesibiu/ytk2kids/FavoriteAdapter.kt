package com.mikesibiu.ytk2kids

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import coil.load
import coil.transform.RoundedCornersTransformation

class FavoriteAdapter(
    private val favorites: List<Favorite>,
    private val onTap: (Favorite) -> Unit
) : RecyclerView.Adapter<FavoriteAdapter.FavoriteViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): FavoriteViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_favorite, parent, false)
        return FavoriteViewHolder(view)
    }

    override fun onBindViewHolder(holder: FavoriteViewHolder, position: Int) {
        holder.bind(favorites[position], onTap)
    }

    override fun getItemCount(): Int = favorites.size

    class FavoriteViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val icon: ImageView = itemView.findViewById(R.id.favoriteIcon)
        private val label: TextView = itemView.findViewById(R.id.favoriteLabel)

        fun bind(favorite: Favorite, onTap: (Favorite) -> Unit) {
            label.text = favorite.label
            val radius = 16 * itemView.resources.displayMetrics.density
            if (favorite.icon != null) {
                icon.load(favorite.icon) {
                    crossfade(true)
                    transformations(RoundedCornersTransformation(radius))
                }
            } else {
                icon.setImageDrawable(null)
            }
            itemView.setOnClickListener { onTap(favorite) }
        }
    }
}
