# Dust & Redemption

Ein Western-Open-World-Spiel im Browser (Three.js), inspiriert von Red Dead Redemption. Alle Inhalte, Namen und Modelle sind eigen und werden prozedural erzeugt.

## Starten

Einfach `index.html` im Browser öffnen. Three.js liegt lokal in `js/three.min.js`, es wird kein Server gebraucht. Für Pointer-Lock (Maussteuerung) ist ein Server angenehmer:

```
python -m http.server 8123
```

Dann `http://localhost:8123` öffnen.

## Steuerung

| Taste | Aktion |
|---|---|
| WASD, Shift, Leertaste, Strg | Laufen, Sprinten/Galopp, Springen, Schleichen |
| Maus, rechte Maus, linke Maus | Umsehen, Zielen, Schießen |
| 1–9, 0 / Mausrad | Waffe wechseln (Platz in der Reihenfolge deiner Waffen) |
| R | Nachladen |
| E | Interagieren, Auf-/Absteigen, Plündern, Shops |
| H | Pferd rufen |
| Q | Dead Eye |
| G | Dynamit werfen |
| F | Heiltonikum |
| Tab | Rucksack |
| M | Karte |
| N | Musik an/aus |
| O | Raum-Menü: Spielerliste, Admin (Kicken, NPCs, PvP) |
| P / Esc | Pause |

## Inhalt

- 1,6 × 1,6 km große Welt mit Stadt, drei Banditenlagern, Farm, See, Tag/Nacht und Wetter
- Zwölf Waffen (Revolver, LeMat, Mauser, abgesägte Flinte, Karabiner, Vorderschaft-Flinte, Scharfschützengewehr, lautloser Jagdbogen u. a.), Dynamit, explodierende Fässer, Dead Eye
- Acht wählbare Spielfiguren (Revolverheld, Kopfgeldjäger, Vaquero, Glücksspieler, Rancher, Gesetzloser, Marshal, Trapper)
- Rucksack, Kramladen, Waffenhändler, Saloon
- Auftragskette, Kopfgelder, Duell, Wölfe und Jagd

## Technik

Reines JavaScript ohne Build-Schritt. Three.js r128 (MIT-Lizenz).

## Mehrspieler

Im Titelbildschirm **Einzelspieler** (Geschichte, Banditen, Tiere) oder **Mehrspieler** wählen. Mehrspieler ist freies Spiel ohne NPCs.

Peer-to-peer über WebRTC (PeerJS). Raumcode leer lassen = neuen Raum eröffnen, Code an Freunde schicken (oder Link `?room=CODE`). Bis zu 8 Spieler.

- Der Raumbesitzer (Host) öffnet mit **O** das Admin-Menü: Spieler kicken, PvP an/aus.
- Uhrzeit und Wetter kommen vom Host. Mitspieler sieht man mit Figur, Waffe, Pferd und auf der Minikarte.
- Verlässt der Host das Spiel oder wird man gekickt, geht es im Einzelspieler weiter.
