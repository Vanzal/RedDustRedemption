# SIDEFORGE.md

Projektkontext für SideForge / SideAI Code.

## Überblick

**Dust & Redemption** (`Vanzal/RedDustRedemption`) ist ein prozedurales 3D-Western-Open-World-Spiel im Browser (Einzelspieler & P2P-Mehrspieler), geschrieben in reinem JavaScript (ES6+, `'use strict'`) ohne Build-Schritt, Bundler oder externe Assets. Alle 3D-Modelle, Texturen, Geräusche und Musikstücke werden zur Laufzeit erzeugt.

## Starten & Prüfen

- **Starten:** `index.html` direkt im Browser öffnen oder für zuverlässigen Pointer-Lock lokalen Server nutzen:
  ```sh
  python -m http.server 8123
  ```
- **Kein Build / keine `package.json`:** Änderungen an `.js`, `.css` und `index.html` wirken sofort nach Browser-Reload.
- **Syntaxprüfung (falls Code geändert wurde):**
  ```sh
  node --check js/util.js && node --check js/audio.js && node --check js/world.js && node --check js/entities.js && node --check js/main.js && node --check js/mp.js
  ```

## Dateistruktur & Ladereihenfolge

Die Skripte in `index.html` teilen sich den globalen Scope und müssen **in genau dieser Reihenfolge** geladen werden:

1. `js/three.min.js` — Gebündeltes Three.js r128 (`THREE`).
2. `js/util.js` — Deterministischer PRNG (`mulberry32`, `RNG`, `rand`, `irand`), 2D-Noise/FBM (`noise2`, `fbm`), Mathe-Helfer (`clamp`, `lerp`, `smooth`, `angDiff`, `lerpAngle`, `segDist`), Material-Cache (`lam`), Geometrie-Merging mit Vertexfarben (`MX`, `mergeParts`, `boxGeo`) und prozedurale Canvas-Texturen (`makeWoodTexture`, `makeGritTexture`, `signTex`, `cloudTexture`).
3. `js/audio.js` — `SFX`-Singleton (WebAudio API): prozedurale Schuss-, Explosions-, Huf-, Schritt-, Nachlade-, Glocken-, Wetter- und Dead-Eye-Sounds sowie dynamische Western-/Kampfmusik.
4. `js/world.js` — `scene`, `camera`, `renderer`, 1600×1600m Höhenkarte (`terrainBase`, `heightAt`), Zonen (`TOWN` Copper Creek, 3 `CAMPS`, `HOME` Miller Farm, `LAKES`, `ROADS`), räumliches Kollisionsgitter (`addCircle`, `addBox`, `resolveCollisions`, `tryMove`), Sichtlinien-/Strahlprüfung (`losClear`, `worldRay`), Tag-/Nacht- & Wettersystem (`updateWeather`, `updateEnv`, `gameHours`, `rainTarget`) sowie prozeduraler Aufbau von Natur, Stadt, Lagern und Farm (`buildWorld`).
5. `js/entities.js` — Prozedurale 3D-Modelle (`makeHumanoid`, `makeWeaponModel`, `setHeldWeapon`, `makeQuad`, `animateQuad`), Klassen `Horse`, `Human` (Rollen: `bandit`, `law`, `town`, `shop`, `gunsmith`, `bartender`, `sheriff`, `duelist`), `Animal` (Hirsch, Wolf, Hase), Geier, Dynamit/explodierende Fässer (`spawnBomb`, `explode`, `explodeBarrel`) sowie `populate()` und `updateEntities(dt)`.
6. `js/main.js` — Spielzustand (`game`, `player`, `WEAPONS`, `OUTFITS`, `ITEMS`), Steuerung & Pointer-Lock, Raycasting & Trefferlogik (`castRay`, `processHit`, `fire`), Dead Eye (`toggleDeadEye`, `markTarget`, `executeDeadEye`), Reiten (`mount`, `dismount`, `whistle`), Menüs/Shops/Rucksack (`openMenu`, `renderMenu`, `menuClick`), Duell- & Questsystem (`startDuel`, `talkSheriff`, `updateQuest`), Minikarte/Weltkarte (`drawMinimap`, `drawBigMap`), HUD (`updateHUD`) und Hauptschleife (`frame`, `init`).
7. `js/peerjs.min.js` — Gebündeltes PeerJS für WebRTC-Datenkanäle.
8. `js/mp.js` — `MP`-IIFE (`window.MP`): Peer-to-peer-Multiplayer in Stern-Topologie (Host-Autorität, Raumcode mit Präfix `dustred2-`, Protokoll `PROTO = 2`, bis zu 8 Spieler, 15 Hz Sync, Spielerliste/HUD, PvP-Schalter, Kick-Funktion, Rückfall in den Einzelspieler bei Verbindungsverlust).

## Konventionen im Projekt

- **Sprache:** Alle UI-Texte, HUD-Meldungen, Kommentare und Commit-Nachrichten (optional auch Englisch bei Commits) sind auf Deutsch bzw. im bestehenden Stil gehalten.
- **Keine externen Assets:** Neue Waffen, Outfits, Gebäude, Kreaturen oder Effekte immer prozedural über `mergeParts`/`MX`/`lam` (3D) bzw. WebAudio (`SFX`) bauen.
- **Einzelspieler vs. Mehrspieler:** Im Mehrspieler werden NPCs über `setNpcsEnabled(false)` ausgeblendet; beim Verlassen des Raums wird über `setNpcsEnabled(true)` der Einzelspieler-Zustand wiederhergestellt.
- **Performance:** Geometrien statischer Objekte mit `mergeParts` zusammenfassen oder als `THREE.InstancedMesh` (`instanced`) anlegen; Materialien über `lam(color, opts)` cachen.
  - `bakeParts(node)` verschmilzt die starren Lambert-Teile eines Knotens zu einem Mesh je Textur. Es läuft am Ende von `makeHumanoid`/`makeQuad`/`makeWeaponModel` und in `buildWorld` für alle Gebäudegruppen. Teile, die später einzeln bewegt oder umgefärbt werden, gehören in eine eigene Untergruppe (wie Beine, Arme, Hand, Windmühlen-Rotor) oder brauchen ein Nicht-Lambert-Material (z. B. `WINDOW_MAT`).
  - `cullCharacters()` blendet NPCs, Tiere und das Pferd außerhalb des Blickfelds bzw. jenseits von `CULL_FAR` aus; ausgeblendete Figuren überspringen auch die Matrix-Updates. Spielcode darf deshalb keine Weltmatrizen (`matrixWorld`, `getWorldPosition`) von Figuren lesen – Positionen kommen aus `x/y/z` der Entität.
- **Mehrspieler-Sync:** Zustandspakete (`t: 's'`) tragen die Absenderzeit `ts`; Mitspieler werden `INTERP_MS` verzögert zwischen gepufferten Zuständen interpoliert (`sampleRemote`).
