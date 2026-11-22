# OptiWatt ⚡

Visualisez la consommation de votre compteur Linky sous forme de heatmaps (jour × heure), directement dans votre navigateur.

**Application :** https://elmetayer.github.io/conso_electrique/ · **Documentation :** [docs.html](https://elmetayer.github.io/conso_electrique/docs.html)

- **Ma consommation** : courbe de charge des 1 à 7 derniers jours via [conso.boris.sh](https://conso.boris.sh) (PRM + token).
- **Import d'un fichier Enedis** : CSV de l'espace client, vue « par mois » ou « long », sans limite de durée.
- Indicateurs (énergie, pic), plafond de puissance souscrite, export PNG / SVG / CSV, données d'exemple (`?demo`).

## Architecture

```
Navigateur ──► GitHub Pages (web/, site statique)
     │
     └─ onglet API ──► Relais Python sur Railway (server/) ──► conso.boris.sh ──► Enedis
```

| Dossier | Rôle |
|---|---|
| `web/` | Site statique (Vite + [Observable Plot](https://observablehq.com/plot/)), publié sur GitHub Pages |
| `server/` | Relais Python (bibliothèque standard) hébergé sur Railway |
| `python/` | CLI `optiwatt` : récupération longue durée → CSV, indicateurs |
| `legacy/` | Ancienne application R Shiny (référence) |

**Pourquoi un relais ?** conso.boris.sh n'envoie pas d'en-têtes CORS : un navigateur ne peut pas l'appeler depuis github.io. Le relais fait l'appel côté serveur et ajoute ces en-têtes. Un premier essai avec un Cloudflare Worker a été abandonné : conso.boris.sh bloque les IP partagées de Cloudflare. L'IP sortante de Railway, elle, est acceptée.

L'import CSV n'utilise pas le relais : il est traité entièrement dans le navigateur.

## Le relais : cache et limite

Pour ménager le quota Enedis, partagé par tous les utilisateurs de conso.boris.sh, et ne pas faire bloquer son IP :

- **Cache de 12 h par requête.** Une réponse réussie est gardée en mémoire 12 h. La clé est l'empreinte (SHA-256) du type de données, des paramètres (PRM, dates) et du token. Redemander exactement la même chose pendant ce délai ne génère aucun appel à Enedis (en-tête `X-OptiWatt-Cache: HIT`). Les erreurs ne sont pas mises en cache.
- **10 requêtes par heure et par IP.** Chaque adresse IP cliente peut déclencher au plus 10 appels réels vers conso.boris.sh sur une heure glissante. Les réponses servies par le cache ne sont pas comptées. Au-delà, le relais répond `429` sans contacter conso.boris.sh.

Ces deux valeurs se règlent avec les variables `CACHE_HOURS` et `RATE_LIMIT`. Le détail est dans la [documentation](https://elmetayer.github.io/conso_electrique/docs.html#relais).

## Démarrage rapide

```bash
cd web && npm install && npm run dev        # http://localhost:5173/?demo
npm test                                     # tests JS (Vitest)
cd ../server && python main.py               # relais local sur http://localhost:8787
python -m pytest                             # tests du relais
cd ../python && pip install -e ".[dev]" && pytest
```

## Déploiement

| Élément | Où | Comment |
|---|---|---|
| Site | GitHub Pages | *Settings → Pages → Source : GitHub Actions*. Chaque push sur `master` teste, construit et publie (`.github/workflows/deploy.yml`). |
| Relais | Railway | Service relié au repo, *Root Directory* = `server`. Redéployé à chaque push touchant `server/`. |
| Lien entre les deux | GitHub | Variable de dépôt `VITE_PROXY_URL` = URL Railway (*Settings → Secrets and variables → Actions → Variables*). |
