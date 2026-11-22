# Relais Python OptiWatt (Railway)

Relaie `GET /api/<type>` vers conso.boris.sh avec CORS, cache (12 h) et limite par IP.
Bibliothèque standard uniquement.

```bash
python main.py                 # http://localhost:8787
python -m pytest               # tests
```

Variables d'environnement : `ALLOWED_ORIGINS`, `CACHE_HOURS` (12), `CACHE_MAX_ENTRIES` (1000), `RATE_LIMIT` (10/h/IP), `PORT` (fourni par Railway).

Déploiement Railway : New Project → Deploy from GitHub repo → `conso_electrique`,
puis Settings → Root Directory = `server`, et Networking → Generate Domain.
