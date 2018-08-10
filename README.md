# Node Card Reader

Contains card reader API for Sankyo DIP card reader.

    npm install

Connect the card reader before starting.    

    npm start

## API

Note: In Firefox, permanently accept the self-signed certificate to use the API in a secure cross-site scenario.

### Card status

    wss://localhost:3004/status
    
Reports card status changes (IN or OUT) on live websocket. Upon websocket connect, the current status is reported immediately so the caller knows whether a card is currently present or not:

Result:

     {"cardstatus":"IN"}

### TAN Generation

    https://localhost:3004/tan?flickercode=11048816650405262080595614312C303009

Generates TAN for the given flickercode.

    {"tan":"262170"}
