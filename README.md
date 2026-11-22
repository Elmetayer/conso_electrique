# OptiWatt ⚡

Visualisez la consommation de votre compteur Linky sous forme de heatmaps (jour × heure), directement dans votre navigateur.

**Application :** https://elmetayer.github.io/conso_electrique/ · **Documentation :** [docs.html](https://elmetayer.github.io/conso_electrique/docs.html)

- **Ma consommation** : courbe de charge des 1 à 7 derniers jours via [conso.boris.sh](https://conso.boris.sh) (PRM + token).
- **Import d'un fichier Enedis** : CSV de l'espace client, vue « par mois » ou « long », sans limite de durée.
- Indicateurs (énergie, pic), plafond de puissance souscrite, export PNG / SVG / CSV, données d'exemple (`?demo`).

## Architecture

```
web/      Site statique (Vite + Observable Plot) → GitHub Pages
proxy/    Cloudflare Worker : relais CORS vers conso.boris.sh (aucun stockage)
python/   CLI `optiwatt` : récupération longue durée → CSV, indicateurs
legacy/   Ancienne application R Shiny (référence)
```

GitHub Pages ne sert que des fichiers statiques et conso.boris.sh n'envoie pas d'en-têtes CORS : le navigateur passe donc par le petit proxy `proxy/`. L'import CSV, lui, fonctionne sans proxy, entièrement en local.

## Démarrage rapide

```bash
cd web && npm install && npm run dev        # http://localhost:5173/?demo
npm test                                     # tests JS (Vitest)
node --test ../proxy/worker.test.js          # tests du proxy
cd ../python && pip install -e ".[dev]" && pytest
```

## Déploiement

1. Proxy : connecter le repo au Worker dans Cloudflare (*Settings → Build*, root directory `proxy`, deploy command `npx wrangler deploy`) → redéployé automatiquement à chaque push. Les origines autorisées se gèrent dans `proxy/wrangler.toml` (`ALLOWED_ORIGINS`).
2. Variable de dépôt `VITE_PROXY_URL` = URL du worker (*Settings → Secrets and variables → Actions → Variables*).
3. *Settings → Pages → Source : GitHub Actions*. Chaque push sur `main` teste, construit et publie.

Le détail est dans la [documentation](web/docs.html).
