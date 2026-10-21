# Learn Home Rover

Short interactive lessons for a two-wheel Raspberry Pi rover (Pi 4, L298N, HC-SR04, Pi Camera v1.3):
wire each part in a 3D model, then run the rover's code on a simulated floor.

Live: https://tiwari91.github.io/learn-home-rover/

Plain static site, no build step. three.js 0.160.0 comes from jsDelivr.

```sh
node tests/serve.mjs                 # http://127.0.0.1:8123/learn-home-rover/
npm install && npx playwright test   # smoke tests (uses the installed Chrome)
```
