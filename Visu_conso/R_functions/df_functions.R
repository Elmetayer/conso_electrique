
# mise en forme des données Enedis
get_df_from_enedis <- function(enedis_path, cap = 12000){
  df_enedis <- read.csv2(enedis_path, skip = 2, header = TRUE) %>% 
    mutate(
      timestamp = ymd_hms(Horodate,tz = "CET") - minutes(30),
      annee = year(timestamp),
      mois = format(timestamp, "%Y-%m"),
      jour = day(timestamp),
      heure = hour(timestamp)) %>% 
    na.omit() %>% 
    group_by(annee, mois, jour, heure) %>%
    summarise(valeur = min(cap, mean(Valeur))) %>% 
    ungroup()
  return(df_enedis)
}

# mise en forme des données Enedis, format "long"
get_df_long_from_enedis <- function(enedis_path, cap = 12000){
  df_enedis_long <- read.csv2(enedis_path, skip = 2, header = TRUE) %>% 
    mutate(
      timestamp = ymd_hms(Horodate,tz = "CET") - minutes(30),
      jour_format = format(timestamp, "%Y-%m-%d"),
      heure = hour(timestamp)) %>% 
    na.omit() %>% 
    group_by(jour_format, heure) %>%
    summarise(valeur = min(cap, mean(Valeur))) %>% 
    ungroup()
  return(df_enedis_long)
}