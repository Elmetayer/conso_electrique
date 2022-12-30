
##############################################################################
# Enedis limite le nombre de requêtes par seconde envoyées par le partenaire. 
# Afin de laisser la possibilité à tout le monde de récupérer ses informations, 
# il est recommandé de ne pas effectuer de demande de données de consommation 
# et/ou production plus d'une fois par jour, d'autant plus qu'Enedis ne les 
# met à jour qu'une fois par jour.
# The requested period must be less than 7 days for an access to the load curve.
##############################################################################

# fonction qui récupère les données d'Enedis par API
# pour un point de comptage et un token API donnés
# sur les n derniers jours, et renvoie les données dans un df
# au format "long"
get_API_df_from_enedis <- function(
    end_date = now("CET"),
    days = 7, 
    usage_point_id = NA, 
    api_enedis_token = NA,
    cap = 6000){
  # date de fin : veille du jour d'appel
  end_day <- floor_date(end_date, unit = "1 day") 
  # date de début : n jours avant la date de début
  start_day <- end_day - days(days)
  # construction des paramètres d'appel de l'API
  api_request_parameters <- list(
    type ="consumption_load_curve",
    usage_point_id = usage_point_id,
    start = format(start_day, "%Y-%m-%d"),
    end = format(end_day, "%Y-%m-%d"))
  # appel de l'API et récupération de la réponse
  api_response <- httr::POST(
    url = Sys.getenv("url_enedis"),
    body =  jsonlite::toJSON(api_request_parameters, pretty = T, auto_unbox = T),
    httr::add_headers(
      "Authorization" = api_enedis_token,
      Accept = "application/json"), 
    httr::content_type('application/json'))
  # conversion du format de réponse
  enedis_data <- jsonlite::fromJSON(rawToChar(api_response$content))
  # extraction des données de la réponse pour créer le df
  df_enedis_measure <- data.frame(enedis_data$meter_reading$interval_reading)
  # mise en forme des données
  df_enedis_measure_clean <- df_enedis_measure %>% 
    select(date, value) %>% 
    rename(Horodate = date) %>% 
    mutate(Valeur = as.numeric(value)) %>% 
    mutate(
      timestamp = ymd_hms(Horodate,tz = "CET") - minutes(30),
      jour_format = format(timestamp, "%Y-%m-%d (%a)"),
      heure = hour(timestamp)) %>% 
    na.omit() %>% 
    group_by(jour_format, heure) %>%
    summarise(valeur = min(cap, max(Valeur))) %>% 
    arrange(desc(jour_format)) %>% 
    ungroup()
}

# end_day <- floor_date(now("CET"), unit = "1 day") 
# # date de début : n jours avant la date de début
# start_day <- end_day - days(7)
# 
# api_request_parameters <- list(
#   type ="consumption_load_curve",
#   usage_point_id = Sys.getenv("usage_point_id"),
#   start = format(start_day, "%Y-%m-%d"),
#   end = format(end_day, "%Y-%m-%d"))
# # appel de l'API et récupération de la réponse
# api_response <- httr::POST(
#   url = Sys.getenv("url_enedis"),
#   body =  jsonlite::toJSON(api_request_parameters, pretty = T, auto_unbox = T),
#   httr::add_headers(
#     "Authorization" = Sys.getenv("api_enedis_token"),
#     Accept = "application/json"), 
#   httr::content_type('application/json'))
# # conversion du format de réponse
# enedis_data <- jsonlite::fromJSON(rawToChar(api_response$content))
# # extraction des données de la réponse pour créer le df
# df_enedis_measure <- data.frame(enedis_data$meter_reading$interval_reading)
# 
# df_enedis_measure_clean <- df_enedis_measure %>% 
#   select(date, value) %>% 
#   rename(Horodate = date) %>% 
#   mutate(Valeur = as.numeric(value)) %>% 
#   mutate(
#     timestamp = ymd_hms(Horodate,tz = "CET") - minutes(30),
#     jour_format = format(timestamp, "%Y-%m-%d"),
#     heure = hour(timestamp))%>% 
#   na.omit() %>% 
#   group_by(jour_format, heure) %>%
#   summarise(P_moy_cap = pmin(12000, mean(Valeur))) %>% 
#   ungroup()
# df_enedis_API <- get_API_df_from_enedis(
#   end_date = ymd("2022-12-30", tz = "CET"),
#   usage_point_id =  "21418957952608",
#   api_enedis_token =  "Mmc2aW4a6Wg9AxhZ8X4riel46paotdhwCs6hk9KAYe0G4buytgHq9b")
# long_heatmap(df_enedis_API) %>% ggplotly()

