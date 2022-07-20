#
# This is the user-interface definition of a Shiny web application. You can
# run the application by clicking 'Run App' above.
#
# Find out more about building applications with Shiny here:
#
#    http://shiny.rstudio.com/
#

library(shinydashboard)

box_enedis <- box(
  width = 7,
  title = "Mise en forme des données Enedis",
  status = "primary",
  solidHeader = TRUE,
  collapsible = TRUE,
  height = "1000px",
  fluidRow(
    column(
      5,
      align = "left",
      fileInput(
        "file_enedis",
        "Importer les données Enedis",
        multiple = FALSE,
        accept = c("text/csv",
                   "text/comma-separated-values,text/plain",
                   ".csv")
      )
    ),
    column(
      4,
      align = "left",
      selectInput(
        "type_plot_enedis",
        "Type de graphique",
        choices = c("par mois", "long")
      )
    ),
    column(
      3,
      align = "left",
      br(),
      downloadButton(
        "download_plot_enedis",
        "Télécharger"
      )
    )
  ),
  fluidRow(
    column(
      12,
      align = "center",
      plotOutput("plot_enedis", height = "800px", width = "400px")
    )
  )
)

ui <- dashboardPage(
  dashboardHeader(title = "Données Enedis"),
  dashboardSidebar(),
  dashboardBody(fluidRow(box_enedis))
)

shinyUI(ui)
