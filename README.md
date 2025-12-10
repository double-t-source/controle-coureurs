# App Contrôle Coureurs

## 🚀 Démarrer en local

1. Installe les dépendances :
```bash
npm install
```

2. Lance le serveur :
```bash
npm run dev
```

3. Accède à l'application sur [http://localhost:5173](http://localhost:5173)

## 🌍 Déploiement Vercel

1. Va sur https://vercel.com et crée un compte
2. Connecte ton dépôt ou utilise la commande :
```bash
vercel --prod
```

3. Ajoute les variables d'environnement :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 📦 Supabase

Crée une table `controles` avec les colonnes :
- evenement (text)
- epreuve (text)
- dossard (text)
- resultat (text)
- materiel_manquant (text, nullable)
- commentaire (text, nullable)
- created_at (timestamp, default: now())