# Prototype overlay Tauri

Étape 1 du passage de l'app desktop à Rust (Tauri 2). Ce prototype ne fait
qu'une chose : vérifier que l'overlay peut se comporter comme celui d'Electron
(`desktop/main/windows.ts`, `desktop/main/win32Overlay.ts`). Il ne se connecte
à aucun serveur et ne remplace pas `desktop/`.

## Récupérer l'exe

Chaque push sur `desktop-tauri/` lance le workflow GitHub Actions
« Tauri overlay prototype ». L'installateur et l'exe portable sont dans
l'artefact `screen-ping-tauri-proto` du run.

Build local (Windows, Rust + Node installés) :

```cmd
cd desktop-tauri
npx @tauri-apps/cli@2 dev      :: lancement direct
npx @tauri-apps/cli@2 build    :: installateur dans src-tauri\target\release\bundle\nsis
```

## Ce qu'il faut vérifier

Pour chaque ping (Image, Vidéo + son, Son seul, Image + son, URL), avec
« Attendre 5 s » coché pour avoir le temps de basculer :

1. **Clics** : pendant le ping, cliquer, sélectionner du texte et faire défiler
   dans la fenêtre en dessous fonctionne.
2. **Focus** : en tapant dans un bloc-notes, la frappe continue sans
   interruption quand le ping apparaît.
3. **Son** : le journal indique « son actif » et on l'entend, sans avoir cliqué
   dans l'overlay.
4. **Au-dessus de tout** : le ping reste visible par-dessus une vidéo YouTube
   en plein écran et par-dessus un jeu en plein écran fenêtré.
5. **Discrétion** : l'overlay n'apparaît ni dans la barre des tâches ni dans
   Alt+Tab, et la barre des tâches reste utilisable après le ping.
6. **Poids** : taille de l'installateur, et mémoire de « Screen Ping Proto »
   dans le Gestionnaire des tâches (processus WebView2 compris), à comparer
   avec l'app Electron actuelle.

Si 1 à 5 passent, on peut porter le récepteur (étape 2).
