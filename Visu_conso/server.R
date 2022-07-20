
library(shinydashboard)
source("R_functions/df_functions.R")
source("R_functions/plot_functions.R")

server <- function(input, output) {
  
  data_enedis <- reactive({
    status <- "ko"
    df_enedis <- NULL
    df_enedis <- tryCatch({
      switch(
        req(input$type_plot_enedis),
        "par mois" = get_df_from_enedis(req(input$file_enedis$datapath), cap = 12000), 
        "long" = get_df_long_from_enedis(req(input$file_enedis$datapath), cap = 12000)
      )
    },
    error = function(e){NULL},
    silent = TRUE) 
    return(
      list(
        status = status,
        df_enedis = df_enedis
      )
    )
  })
  
  plot_enedis <- reactive({
    status <- "ko"
    plot_enedis <- NULL
    plot_enedis <- tryCatch({
      status <- "ok"
      switch(
        req(input$type_plot_enedis),
        "par mois" = month_heatmap(req(data_enedis()$df_enedis)), 
        "long" = long_heatmap(req(data_enedis()$df_enedis))
      )
    },
    error = function(e){NULL},
    silent = TRUE)
    return(
      list(
        status = status,
        plot_enedis = plot_enedis
      )
    )
  })
  
  output$plot_enedis <- renderPlot({
    if(is.null(plot_enedis()$plot_enedis)) {
      empty_plot(message = "données manquantes")
    } else {
      plot_enedis()$plot_enedis
    }
  })
  
  output$download_plot_enedis <- downloadHandler(
    filename = function() {
      switch(
        req(input$type_plot_enedis),
        "par mois" = "graphique_enedis.pdf", 
        "long" = "graphique_enedis_long.pdf"
      )
    },
    content = function(file) {
      switch(
        req(input$type_plot_enedis),
        "par mois" = ggsave(
          filename = file,
          plot = req(plot_enedis()$plot_enedis),
          width = 16,
          height = 24),
        "long" = ggsave(
          filename = file,
          plot = req(plot_enedis()$plot_enedis),
          width = 16,
          height = 240,
          limitsize = FALSE)
      )
    }
  )
}

shinyServer(server)
