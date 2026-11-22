
# affichage d'une heatmap par jour affichée de manière verticale
long_heatmap <- function(df_enedis_long){
  ggplot() +
    geom_tile(
      data = df_enedis_long,
      aes(x = heure , y = jour_format , fill = valeur),
      color = "white",
      size = 0.1
    ) +
    scale_fill_gradient(low = "#f0f0f0", high = "red") +
    theme_minimal(base_size = 8) +
    labs(title = "", x = "", y = "") +
    theme(legend.position = "bottom") +
    theme(plot.title = element_text(size = 14)) +
    theme(axis.text.y = element_text(size = 6)) +
    theme(strip.background = element_rect(colour = "white")) +
    theme(plot.title = element_text(hjust = 0)) +
    theme(axis.ticks = element_blank()) +
    theme(axis.text = element_text(size = 7)) +
    theme(legend.title = element_text(size = 8)) +
    theme(legend.text = element_text(size = 6)) +
    removeGrid() +
    coord_equal()
}

# affichage d'une heatmap par mois et par colonnes de 3 mois
month_heatmap <- function(df_enedis){
  ggplot() +
    geom_tile(
      data = df_enedis,
      aes(x = jour , y = heure , fill = valeur),
      color = "white",
      size = 0.1
    ) +
    scale_fill_gradient(low = "#f0f0f0", high = "red") +
    facet_wrap( ~ mois, ncol = 3) +
    scale_y_continuous(trans = "reverse",
                       breaks = unique(df_enedis$heure)) +
    scale_x_continuous(breaks = c(1, 10, 20, 31)) +
    theme_minimal(base_size = 8) +
    labs(title = "", x = "", y = "") +
    theme(legend.position = "bottom") +
    theme(plot.title = element_text(size = 14)) +
    theme(axis.text.y = element_text(size = 6)) +
    theme(strip.background = element_rect(colour = "white")) +
    theme(plot.title = element_text(hjust = 0)) +
    theme(axis.ticks = element_blank()) +
    theme(axis.text = element_text(size = 7)) +
    theme(legend.title = element_text(size = 8)) +
    theme(legend.text = element_text(size = 6)) +
    removeGrid() +
    coord_equal()
}

# affichage d'un plot vide avec un message
empty_plot <- function(message = "", color = "red") {
  p <- ggplot() +
    geom_rect(aes(
      xmin = 0,
      xmax = 10,
      ymin = 0,
      ymax = 10
    ),
    fill = "white")
  p +
    annotate(
      "text",
      x = 5,
      y = 5,
      label = message,
      color = color
    ) +
    labs(title = "",
         x = "",
         y = "") +
    theme_bw() +
    theme(
      panel.border = element_blank(),
      panel.grid.major.x = element_blank(),
      panel.grid.major.y = element_blank(),
      axis.ticks = element_blank(),
      axis.text.x = element_blank(),
      axis.text.y = element_blank()
    )
}
