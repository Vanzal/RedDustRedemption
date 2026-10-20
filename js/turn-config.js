'use strict';
// TURN-Relay für den Mehrspieler. Ohne TURN klappen nur direkte Verbindungen (viele Heimnetze).
// Hinter strengen NATs (Mobilfunk, Firmen-/Schulnetz, manche Router) braucht es ein Relay.
//
// Variante A: Metered.ca (kostenloser Plan). Nach der Anmeldung unter "TURN Server" die
// Credentials-URL kopieren, z. B. 'https://DEINAPP.metered.live/api/v1/turn/credentials?apiKey=...'
// Variante B: feste Zugangsdaten eintragen, z. B.
//   servers: [{ urls: ['turn:example.com:3478', 'turns:example.com:443?transport=tcp'], username: 'user', credential: 'pass' }]
window.TURN_CONFIG = {
  credentialsUrl: '',
  servers: [],
};
