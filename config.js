/* config.js: settings shared by the game (index.html) and the tuner (tools/tuner.html).
   The one place the score server's address is written. Leave scoresApi empty to play
   without the server (bests stay on the device, nothing is sent). */
window.TENSPOT_CONFIG = {
  scoresApi: 'https://ten-spot-scores.onrender.com'
};
