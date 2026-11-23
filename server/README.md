# Relais Python OptiWatt (Railway)

Relaie `GET /api/<type>` vers conso.boris.sh avec CORS, cache (12 h) et limite par IP.
Sert aussi `GET /api/prix_day_ahead?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` : prix day-ahead France
au pas de 15 min, lus sur ENTSO-E (`marche.py`) et mis en cache par mois.
Bibliothèque standard uniquement.

```bash
python main.py                 # http://localhost:8787
python -m pytest               # tests
```

Variables d'environnement : `ALLOWED_ORIGINS`, `CACHE_HOURS` (12), `CACHE_MAX_ENTRIES` (1000), `RATE_LIMIT` (10/h/IP),
`ENTSOE_TOKEN` (token API ENTSO-E, active les prix de gros), `MARKET_RATE_LIMIT` (60 mois/h/IP), `PORT` (fourni par Railway).

Déploiement Railway : New Project → Deploy from GitHub repo → `conso_electrique`,
puis Settings → Root Directory = `server`, et Networking → Generate Domain.
