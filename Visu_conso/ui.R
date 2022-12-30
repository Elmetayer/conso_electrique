
library(shinydashboard)

box_API <- box(
  width = 7,
  title = "Consommation",
  status = "primary",
  solidHeader = TRUE,
  collapsible = TRUE,
  height = "600px",
  textInput(inputId = "usage_point_id", 
            label = "PDL"),
  textInput(inputId = "api_enedis_token", 
            label = "token API"),
  sliderInput(
    inputId = "cap_enedis", 
    label = "puissance de l'abonnement (kVA)", 
    min = 6000, 
    max = 24000, 
    value = 6000, 
    step = 1000),
  fluidRow(
    column(6,
           sliderInput(
             inputId = "api_days", 
             label = NULL, 
             min = 1, 
             max = 7, 
             value = 7, 
             step = 1)
           ),
    column(3,
           dateInput(
             inputId = "api_end_date",
             label = "date de fin\n\n")
    ),
    column(3,
           br(),
           actionButton(
             inputId = "call_api_enedis",
             label = "afficher",
             icon = icon("download")))
  ),
  fluidRow(
    column(
      12,
      align = "center",
      plotOutput("plot_api_enedis", height = "300px", width = "400px")
    )
  ),
  fluidRow(
    column(
      12,
      align = "right",
      br(),
      downloadButton(
        "download_api_enedis",
        "télécharger"
      )
    )
  )
)

box_API_info <- box(
  width = 3,
  title = "Mode d'emploi",
  status = "warning",
  solidHeader = TRUE,
  collapsible = TRUE,
  HTML("Pour créer un token d'accès aux API Enedis, aller sur https://enedisgateway.tech/"),
  br(),
  HTML("Enedis limite le nombre de requêtes par seconde envoyées par le partenaire"),
  br(),
  HTML("Afin de laisser la possibilité à tout le monde de récupérer ses informations, il est recommandé de ne pas effectuer de demande de données de consommation et/ou production plus d'une fois par jour, d'autant plus qu'Enedis ne les met à jour qu'une fois par jour."),
  br(),
  HTML("La période demandée ne doit pas dépasser 7 jours.")
)

box_enedis <- box(
  width = 7,
  title = "Mise en forme des données Enedis",
  status = "primary",
  solidHeader = TRUE,
  collapsible = TRUE,
  height = "1200px",
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
    )
  ),
  fluidRow(
    column(
      12,
      align = "center",
      plotOutput("plot_data_enedis", height = "800px", width = "400px")
    )
  ),
  fluidRow(
    column(
      12,
      align = "right",
      br(),
      downloadButton(
        "download_plot_data_enedis",
        "télécharger"
      )
    )
  )
)

ui <- dashboardPage(
  dashboardHeader(title = "Données Enedis"),
  dashboardSidebar(
    sidebarMenu(
      menuItem("Ma consommation", tabName = "live_conso", icon = icon("dashboard")),
      menuItem("Mise en forme", tabName = "format_data",icon = icon("th"))
    )
  ),
  dashboardBody(
    tabItems(
      tabItem(tabName = "live_conso",
              fluidRow(
                box_API,
                box_API_info
              )
      ),
      tabItem(tabName = "format_data",
              fluidRow(box_enedis)
      )
    )
  )
)

shinyUI(ui)
