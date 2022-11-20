url_enedis <- "https://enedisgateway.tech/api"
api_request_parameters <- list(
  type ="consumption_load_curve",
  usage_point_id = "21418957952608",
  start = "2022-11-18",
  end = "2022-11-19")

api_response <- httr::POST(url = url_enedis,
           body =  jsonlite::toJSON(api_request_parameters, pretty = T, auto_unbox = T),
           httr::add_headers(
             "Authorization" = "Sub6axEoGM17kkNkQMwBc79EGNmsac2exyez8zr0U1xhyxfGI90kp3",
             Accept = "application/json"), 
           httr::content_type('application/json'))

toJSON(rawToChar(api_response$content))




#curl -X POST https://enedisgateway.tech/api -H 'Authorization: S5Ay5Xrs09XnE9Fp6jNIBxWW31yBB10DDIPKHwzDLAdZKW8w0pmZ88' -H 'Content-Type: application/json' -d '{"type": "consumption_load_curve","usage_point_id": "21418957952608","start": "2022-11-18","end": "2022-11-19"}'