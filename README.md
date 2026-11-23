# Unlisted

Catalogue de vinyles connecté à Discogs : connexion avec son compte, import de la bibliothèque, recherche par code-barres ou numéro de catalogue.

## Contenu du projet

- `public/index.html` : le site
- `netlify/functions/api.mjs` : la partie serveur (connexion OAuth Discogs, recherche, import)
- `netlify.toml` : configuration Netlify

## Mise en ligne

### 1. Sécuriser l'application Discogs
Dans les paramètres développeur de Discogs, régénère le Consumer Secret si tu l'as partagé quelque part. Il ne doit apparaître dans aucun fichier du projet.

### 2. Envoyer le projet sur GitHub
1. Crée un dépôt GitHub (par exemple `unlisted`).
2. Dézippe le projet, puis glisse **le contenu du dossier** (`public`, `netlify`, `netlify.toml`, `README.md`) dans la page du dépôt (*Add file > Upload files*). Les sous-dossiers doivent être conservés.
3. Valide avec *Commit changes*.

### 3. Relier Netlify au dépôt
1. Sur Netlify : *Add new site > Import an existing project > GitHub*, puis choisis le dépôt.
2. Laisse les réglages par défaut (ils viennent de `netlify.toml`) et lance le déploiement.

### 4. Ajouter les variables d'environnement
Dans Netlify : *Site configuration > Environment variables*, ajoute :

| Nom | Valeur |
|---|---|
| `DISCOGS_KEY` | ton Consumer Key Discogs |
| `DISCOGS_SECRET` | ton Consumer Secret Discogs |
| `SESSION_SECRET` | une longue suite de caractères aléatoires (40 ou plus) |

Puis relance un déploiement (*Deploys > Trigger deploy > Deploy site*), car les variables ne sont prises en compte qu'au déploiement suivant.

### 5. Tester
Ouvre le site, va dans l'onglet **Compte**, clique sur **Se connecter avec Discogs**, autorise l'application, puis lance l'import.

## En cas de souci

- **« La connexion à Discogs n'est pas disponible »** : les variables d'environnement manquent ou le déploiement n'a pas été relancé après leur ajout.
- **La connexion échoue au retour de Discogs** : vérifie que le Consumer Key et le Consumer Secret sont corrects, sans espace en trop.
- **L'import s'arrête avec un message de pause** : Discogs limite le nombre de requêtes par minute. Les disques déjà importés sont gardés, il suffit de relancer.
