# Node Card Reader

This project provides a local Web Services API for chip card readers. It is capable of connecting to local card reader devices and provides API services for monitoring the card status and for performing EMV chip operations - such as reading card data or verifying or creating cryptograms with the card's chip.

In particular, the Node Card Reader is capable of creating ChipTAN one-time codes used for online banking authorization in Germany and Austria.

This project aims to help build the bridge from physical, card-based banking to digital Internet-based banking services.

The following card readers are supported:

* SANKYO ICM330-2 via Windows HID
* Any PC/SC compliant card reader

Note: Please comment-in the appropriate line in reader.js to select SANKYO HID or PC/SC.

Installation:

    npm install

Note: You may remove the pcsclite dependency in package.json if you encounter problems during installation unless you are using a PC/SC device.

Connect the card reader before starting. Start with:

    npm start

## API

The API is usually used from a local, secure browser context. The API uses a self-signed certificate. To allow the browser to access the API in a cross-site scenario, permanently accept the self-signed certificate in the browser first.

### Monitor card status

    wss://localhost:3004/status
    
Reports card status changes (IN or OUT) on live websocket. Upon websocket connect, the current status is reported immediately so that the caller knows whether a card is currently present or not:

Result:

     {"cardstatus":"IN"}

### TAN Generation

    https://localhost:3004/tan?flickercode=11048816650405262080595614312C303009

Generates a TAN for the given flickercode.

Result:

    {"tan":"262170"}

### Read card data

    https://localhost:3004/card
    
Reads and returns basic card data from EMV tag 57.

Result:

    {
        "routingcode": "52104",
        "branch": "104",
        "account": "0234175800",
        "shortaccount": "2341758",
        "subaccount": "00",
        "t2emv": "6725210402341758003D019093487215325......"
    }
