
library(shinydashboard)
library(tidyverse)
library(lubridate)
library(ggplot2)
library(plotly)
library(RcppRoll)
library(ggExtra)
library(httr)
library(jsonlite)

source("R_functions/df_functions.R")
source("R_functions/plot_functions.R")
source("R_functions/enedis.R")

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
  
  plot_data_enedis <- reactive({
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
  
  output$plot_data_enedis <- renderPlot({
    if(is.null(plot_data_enedis()$plot_enedis)) {
      empty_plot(message = "données manquantes")
    } else {
      plot_data_enedis()$plot_enedis
    }
  })
  
  api_enedis <- eventReactive(input$call_api_enedis,{
    status <- "ko"
    df_enedis <- NULL
    df_enedis <- tryCatch({
      status <- "ok"
      get_API_df_from_enedis(
        end_date = ymd(req(input$api_end_date), tz = "CET"),
        cap = req(input$cap_enedis),
        usage_point_id = req(input$usage_point_id), 
        api_enedis_token = req(input$api_enedis_token))
    },
    error = function(e){
      status <- "ko"
      NULL},
    silent = TRUE) 
    return(
      list(
        status = status,
        df_enedis = df_enedis
      )
    )
  })
  
  plot_api_enedis <- reactive({
    status <- "ko"
    plot_enedis <- NULL
    plot_enedis <- tryCatch({
      status <- "ok"
      print(df_enedis)
      long_heatmap(api_enedis()$df_enedis)
    },
    error = function(e){
      status <- "ko"
      NULL},
    silent = TRUE)
    return(
      list(
        status = status,
        plot_enedis = plot_enedis
      )
    )
  })
  
  output$plot_api_enedis <- renderPlot({
    if(is.null(plot_api_enedis()$plot_enedis)) {
      empty_plot(message = "données manquantes")
    } else {
      if(is.null(plot_api_enedis()$status == "ok")) {
        empty_plot(message = "données à afficher")
        # plot_api_enedis()$plot_enedis %>% ggplotly()
      } else {
        empty_plot(message = "erreur de données")
      }
    }
  })
  
  output$download_plot_data_enedis <- downloadHandler(
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
